"""FastAPI app: JSON API under /api, the static UI under /."""

import json
import mimetypes
import re
from dataclasses import asdict
from pathlib import Path
from urllib.parse import quote, urlparse

from fastapi import Body, FastAPI, Request, WebSocket
from fastapi.responses import HTMLResponse, JSONResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles
from starlette.concurrency import run_in_threadpool

from . import (__version__, backup, calibration, camera, console, control, guard, importer, instances, logs, monitor, operations,
               overview, printer_files, scanner, settings, snapshot, ssh)
from .resolver import Resolver

STATIC_DIR = Path(__file__).parent / "static"
_LOCAL_HOSTS = {"127.0.0.1", "localhost"}

# On Windows the registry can map .js to text/plain, and browsers then refuse to
# run ES modules.
mimetypes.add_type("text/javascript", ".js")
mimetypes.add_type("text/javascript", ".mjs")
mimetypes.add_type("text/css", ".css")


class Utf8Response(JSONResponse):
    """JSONResponse that does not fail on odd file names: on Linux a name that is not valid UTF-8
    (from a Latin-1 ZIP, say) reaches Python with surrogate escapes, which strict UTF-8 refuses.
    Those characters become "?"."""

    def render(self, content) -> bytes:
        text = json.dumps(content, ensure_ascii=False, allow_nan=False, separators=(",", ":"))
        return text.encode("utf-8", "replace")


app = FastAPI(title="OrcaOne", version=__version__, docs_url=None, redoc_url=None, openapi_url=None,
              default_response_class=Utf8Response)


def _hostname(value: str) -> str | None:
    return urlparse(f"//{value}").hostname


@app.middleware("http")
async def local_only(request: Request, call_next):
    # The server listens on 127.0.0.1 only. Checking Host blocks DNS rebinding,
    # checking Origin blocks other pages (even other local ports) from sending
    # changes, and refusing frames blocks clickjacking.
    host = request.headers.get("host", "")
    if _hostname(host) not in _LOCAL_HOSTS:
        return Utf8Response({"error": "forbidden"}, status_code=403)
    origin = request.headers.get("origin")
    if request.method not in ("GET", "HEAD") and origin and origin != f"http://{host}":
        return Utf8Response({"error": "forbidden"}, status_code=403)
    response = await call_next(request)
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Content-Security-Policy"] = "frame-ancestors 'none'"
    # Revalidate every file: browsers otherwise keep old ES modules after an
    # update of OrcaOne and mix them with new ones.
    response.headers["Cache-Control"] = "no-cache"
    return response


def _error(code: str, status: int = 400, **params) -> JSONResponse:
    return Utf8Response({"error": code, **params}, status_code=status)


@app.exception_handler(operations.OperationError)
def _operation_error(request: Request, exc: operations.OperationError):
    return _error(exc.code, exc.status, **exc.params)


@app.exception_handler(operations.InvalidChange)
def _invalid_change(request: Request, exc: operations.InvalidChange):
    return _error("invalid_change", index=exc.index, field=exc.field)


@app.exception_handler(backup.BackupError)
def _backup_error(request: Request, exc: backup.BackupError):
    return _error(exc.code, 404 if exc.code == "backup_not_found" else 500)


@app.websocket("/api/ssh")
async def ssh_terminal(websocket: WebSocket, model: str = ""):
    # The page "SSH" (orcaone/ssh.py). The HTTP guard above does not see WebSockets, and
    # browsers let any page open one: so Host and Origin are checked here, and closing before
    # accepting refuses the connection.
    host = websocket.headers.get("host", "")
    if _hostname(host) not in _LOCAL_HOSTS or websocket.headers.get("origin") != f"http://{host}":
        await websocket.close(code=1008)
        return
    await ssh.session(websocket, model)


@app.exception_handler(camera.CameraError)
def _camera_error(request: Request, exc: camera.CameraError):
    status = {"camera_not_found": 404, "printer_not_found": 404, "camera_host_invalid": 400, "printer_invalid": 400, "printer_name_taken": 400, "search_failed": 500,
              "camera_every_invalid": 400, "object_invalid": 400, "pause_invalid": 400, "folder_unknown": 404, "file_not_found": 404, "file_invalid": 400,
              "folder_read_only": 400, "print_invalid": 400, "print_refused": 409, "gcode_invalid": 400}.get(exc.code, 502)
    return _error(exc.code, status, **({"detail": exc.detail} if exc.detail else {}))


@app.exception_handler(calibration.CalibrationError)
def _calibration_error(request: Request, exc: calibration.CalibrationError):
    return _error(str(exc))


@app.exception_handler(logs.LogError)
def _log_error(request: Request, exc: logs.LogError):
    return _error(str(exc), 404 if str(exc) == "log_not_found" else 400)


@app.exception_handler(snapshot.SnapshotError)
def _snapshot_error(request: Request, exc: snapshot.SnapshotError):
    return _error(exc.code, 409)


@app.exception_handler(importer.ImportFailed)
def _import_error(request: Request, exc: importer.ImportFailed):
    status = {"file_too_big": 413, "unknown_profile": 404, "folder_unknown": 404, "profile_invalid": 409}.get(exc.code, 400)
    return _error(exc.code, status, **exc.params)


@app.get("/api/instances")
def list_instances():
    processes = guard.find_processes()
    process_dirs = [p.data_dir for p in processes if p.data_dir]
    found = instances.discover(process_dirs)
    manual = set(instances.manual_paths())
    return {
        "version": __version__,
        "instances": [
            {
                **asdict(instance),
                "manual": str(instance.data_dir) in manual,
                "run_state": asdict(guard.run_state(instance, processes)),
            }
            for instance in found
        ],
    }


# ---------------------------------------------------------------- OrcaOne's own settings (orcaone/settings.py)

LANGUAGES = ("de", "en")
THEMES = ("light", "dark")
# The two parts of OrcaOne (the user's wish of 25.09.2026): the slicers' profiles and the printers.
AREAS = ("slicer", "printer")


@app.get("/api/settings")
def get_settings():
    stored = settings.load()
    language, theme, area = stored.get("language"), stored.get("theme"), stored.get("area")
    return {"language": language if language in LANGUAGES else None, "menu_collapsed": stored.get("menu_collapsed") is True,
            "theme": theme if theme in THEMES else None, "area": area if area in AREAS else None}


@app.get("/api/progress")
def scan_progress():
    """What the running GET /api/data does, for the boot screen (overview.progress)."""
    return overview.progress()


@app.post("/api/settings")
def set_settings(payload: dict = Body(...)):
    """Any of: "language" ("de", "en"), "menu_collapsed" (the menu folded away), "theme" ("light", "dark"),
    "area" ("slicer", "printer": the part of OrcaOne used last, where the next start begins)."""
    changed = {key: payload[key] for key in ("language", "menu_collapsed", "theme", "area") if key in payload}
    if (not changed or ("language" in changed and changed["language"] not in LANGUAGES)
            or not isinstance(changed.get("menu_collapsed", False), bool)
            or ("theme" in changed and changed["theme"] not in THEMES)
            or ("area" in changed and changed["area"] not in AREAS)):
        return _error("setting_invalid")
    try:
        settings.change(lambda data: data.update(changed))
    except OSError:
        return _error("save_failed", 500)
    return get_settings()


@app.get("/api/data")
def data():
    # Read fresh on every call: the slicer may have changed its files or started meanwhile.
    # A response directly: FastAPI's jsonable_encoder is slow for a megabyte of nested dicts.
    return Utf8Response(overview.build_all())


@app.post("/api/instances/manual")
def add_manual(payload: dict = Body(...)):
    path = payload.get("path")
    if not isinstance(path, str):
        return _error("path_not_found")
    try:
        instance = instances.add_manual_path(path)
    except ValueError as exc:
        return _error(str(exc))
    except OSError:
        return _error("save_failed", 500)
    return {"instance": asdict(instance)}


@app.delete("/api/instances/manual")
def remove_manual(path: str):
    try:
        instances.remove_manual_path(path)
    except ValueError as exc:
        return _error(str(exc), 404)
    except OSError:
        return _error("save_failed", 500)
    return {"removed": path}


@app.get("/api/instances/{instance_id}/profile")
def profile(instance_id: str, kind: str, name: str):
    # Read on demand: every value of every profile would make GET /api/data megabytes larger.
    details = overview.profile_details(operations.find_instance(instance_id)[0], kind, name) \
        if kind in ("filament", "process", "machine") else None
    if details is None:
        return _error("unknown_profile", 404, name=name)
    return details


# ---------------------------------------------------------------- changes (hard rule 5)

@app.post("/api/instances/{instance_id}/plan")
def make_plan(instance_id: str, payload: dict = Body(...)):
    changes = payload.get("changes")
    if not isinstance(changes, list):
        raise operations.InvalidChange(None, "changes")
    return {"plan": operations.make_plan(*operations.find_instance(instance_id), changes)}


@app.post("/api/instances/{instance_id}/apply")
def apply_plan(instance_id: str, payload: dict = Body(...)):
    return operations.apply(instance_id, payload.get("plan_id"))


# ---------------------------------------------------------------- backups (hard rule 4)

@app.get("/api/instances/{instance_id}/backups")
def list_backups(instance_id: str):
    operations.find_instance(instance_id)
    made = backup.list_backups(instance_id)
    return {"backups": made, "total_size": sum(b["size"] for b in made),
            "location": overview.home_path(backup.backup_dir(instance_id))}


@app.post("/api/instances/{instance_id}/backups")
def backup_now(instance_id: str):
    # Reads the data directory only, so every installation may have one.
    instance, _ = operations.find_instance(instance_id)
    return {"backup": backup.create(instance, "manual")}


@app.delete("/api/instances/{instance_id}/backups/{name}")
def delete_backup(instance_id: str, name: str):
    # Works without the installation, too: its folder may be gone, its backups not.
    backup.delete(instance_id, name)
    return {"deleted": name}


@app.post("/api/instances/{instance_id}/backups/{name}/restore-plan")
def restore_plan(instance_id: str, name: str):
    return {"plan": operations.restore_plan(*operations.find_instance(instance_id), name)}


# ---------------------------------------------------------------- the slicers' logs (orcaone/logs.py)

@app.get("/api/instances/{instance_id}/logs")
def list_logs(instance_id: str):
    instance, _ = operations.find_instance(instance_id)
    return {"files": logs.files(instance.data_dir), "location": overview.home_path(instance.data_dir / "log")}


@app.get("/api/instances/{instance_id}/logs/{name}")
def read_log(instance_id: str, name: str, show: str = "all", q: str = ""):
    instance, _ = operations.find_instance(instance_id)
    return logs.read(instance.data_dir, name, show, q)


# ---------------------------------------------------------------- page "Änderungen" (orcaone/snapshot.py)

@app.get("/api/instances/{instance_id}/news")
def news(instance_id: str):
    return snapshot.news(operations.find_instance(instance_id)[0])


@app.post("/api/instances/{instance_id}/news/seen")
def news_seen(instance_id: str):
    # Writes only into OrcaOne's own folder data/, no plan needed (PLAN 1.5).
    return snapshot.seen(operations.find_instance(instance_id)[0])


# ---------------------------------------------------------------- page "Import/Export" (orcaone/importer.py)

def _answer(instance, source: dict, name: str) -> dict:
    """What a file or folder holds (importer.read, read_backup) and what an import would do here."""
    res = Resolver(scanner.scan(instance.data_dir, instance.slicer))
    project = {**source["project"], "uses": importer.uses(source, res)} if source.get("project") else None
    return {"file": name, "format": source["format"], "skipped": source["skipped"], "project": project,
            "profiles": importer.analyse(source, res, instance.slicer)}


def _read_file(instance_id: str, raw: bytes, name: str) -> dict:
    return _answer(operations.find_instance(instance_id)[0], importer.read(raw, name), name)


@app.post("/api/instances/{instance_id}/import")
async def import_read(instance_id: str, request: Request, name: str = ""):
    """What a file holds and what an import would do; writes nothing. The file is the body itself,
    no multipart and so no further package (docs/IMPORT-QUELLEN.md)."""
    if int(request.headers.get("content-length") or 0) > importer.MAX_FILE:
        raise importer.ImportFailed("file_too_big")
    raw = await request.body()
    # A 3MF of many megabytes takes a moment: not on the server's event loop.
    return await run_in_threadpool(_read_file, instance_id, raw, name or "import")


@app.get("/api/instances/{instance_id}/import/slicer-backups")
def import_slicer_backups(instance_id: str):
    """The slicer's own copies of user/ (user_backup-v…) in the data directory, to import from."""
    return {"backups": importer.slicer_backups(operations.find_instance(instance_id)[0].data_dir)}


@app.get("/api/instances/{instance_id}/import/slicer-backup")
def import_slicer_backup(instance_id: str, name: str = ""):
    """What one of those copies holds and what an import would do; writes nothing."""
    instance = operations.find_instance(instance_id)[0]
    return _answer(instance, importer.read_backup(instance.data_dir, name), name)


@app.post("/api/instances/{instance_id}/import/attach")
def import_attach(instance_id: str, payload: dict = Body(...)):
    """What a filament of the file would become, hung onto a printer here (importer.attach);
    writes nothing."""
    profile, parents, printer = payload.get("profile"), payload.get("parents") or [], payload.get("printer")
    if not isinstance(profile, dict) or not isinstance(parents, list) or not all(isinstance(p, dict) for p in parents) \
            or not isinstance(printer, str) or not printer:
        return _error("attach_invalid")
    instance = operations.find_instance(instance_id)[0]
    res = Resolver(scanner.scan(instance.data_dir, instance.slicer))
    return importer.analyse_attach(res, instance.slicer, profile, parents, printer)


@app.post("/api/clean-3mf")
async def clean_3mf(request: Request):
    """Page "3MF bereinigen": the 3MF back without the printer, process and filaments of its project,
    so the slicer does not set them up when opening it. Writes nothing; the page saves the answer."""
    if int(request.headers.get("content-length") or 0) > importer.MAX_FILE:
        raise importer.ImportFailed("file_too_big")
    raw = await request.body()
    return Response(content=await run_in_threadpool(importer.clean_3mf, raw), media_type="model/3mf")


@app.post("/api/instances/{instance_id}/export")
def export(instance_id: str, payload: dict = Body(...)):
    wanted = payload.get("profiles")
    if not isinstance(wanted, list) or not wanted or not all(
            isinstance(p, dict) and p.get("kind") in importer.KINDS and isinstance(p.get("name"), str) for p in wanted):
        return _error("export_invalid")
    instance = operations.find_instance(instance_id)[0]
    res = Resolver(scanner.scan(instance.data_dir, instance.slicer))
    data = importer.export(res, [(p["kind"], p["name"]) for p in wanted], payload.get("flat") is True)
    return Response(content=data, media_type="application/zip",
                    headers={"Content-Disposition": 'attachment; filename="OrcaOne-Export.zip"'})


# ---------------------------------------------------------------- page "Kalibrieren" (orcaone/calibration.py)

@app.get("/api/instances/{instance_id}/calibration")
def get_calibration(instance_id: str):
    return calibration.state(instance_id)


@app.post("/api/instances/{instance_id}/calibration")
def mark_calibration(instance_id: str, payload: dict = Body(...)):
    operations.find_instance(instance_id)
    try:
        return calibration.mark(instance_id, payload.get("filament"), payload.get("step"), payload.get("done"), payload.get("temp"))
    except OSError:
        return _error("save_failed", 500)


# ---------------------------------------------------------------- camera of the U1 (orcaone/camera.py)

@app.get("/api/cameras")
def list_cameras():
    return {"cameras": camera.cameras()}


@app.get("/api/printers")
def list_printers():
    return {"printers": camera.printers()}


@app.get("/api/printers/info")
def printer_info(model: str = ""):
    # Read only, any printer with Klipper and Moonraker: what its card on the page "Drucker" shows.
    return camera.info(camera.host_of(model))


@app.get("/api/printers/status")
def printer_status(model: str = ""):
    # Read only: state, progress and heads for the card, as "Kamera" reads them (camera.status).
    return camera.status(camera.host_of(model))


@app.get("/api/printers/monitor")
def printer_monitor(model: str = ""):
    # The page "Status" (orcaone/monitor.py): what the printer is doing now, read only.
    return monitor.read(camera.host_of(model))


@app.get("/api/printers/gcode")
def gcode_history(model: str = "", since: float = 0):
    # The page "Konsole" (orcaone/console.py): what Klipper said since then.
    return console.history(camera.host_of(model), since)


@app.post("/api/printers/gcode")
def gcode_send(payload: dict = Body(...)):
    # G-code the user typed or chose, for any printer with Klipper and an address.
    return console.send(camera.host_of(payload.get("model")), payload.get("script"))


@app.post("/api/printers/search")
def search_printers():
    # About 6 s: Snapmaker printers that answer in the LAN (mDNS, orcaone/camera.py search).
    return {"found": camera.search()}


@app.post("/api/printers")
def set_printer(payload: dict = Body(...)):
    # The address of a printer by its name, from its card on the page "Drucker"; empty takes it away.
    # With "name": another printer of the model "model" (camera.add_printer).
    try:
        if "name" in payload:
            return {"printers": camera.add_printer(payload.get("model"), payload.get("name"), payload.get("host"))}
        return {"printers": camera.set_host(payload.get("model"), payload.get("host"))}
    except OSError:
        return _error("save_failed", 500)


@app.post("/api/cameras/{camera_id}")
def update_camera(camera_id: str, payload: dict = Body(...)):
    try:
        return {"camera": camera.set_every(camera_id, payload.get("every"))}
    except OSError:
        return _error("save_failed", 500)


@app.post("/api/cameras/{camera_id}/wake")
def wake_camera(camera_id: str):
    return {"result": camera.wake(camera.find(camera_id)["host"])}


@app.post("/api/cameras/{camera_id}/light")
def camera_light(camera_id: str, payload: dict = Body(...)):
    # On the user's wish (24.09.2026): the light in the U1 on or off.
    on = payload.get("on")
    if not isinstance(on, bool):
        return _error("light_invalid")
    return {"light": camera.set_light(camera.find(camera_id)["host"], on)}


@app.get("/api/cameras/{camera_id}/status")
def camera_status(camera_id: str):
    # Read only: spools, pressure advance and print state for the page "Kalibrieren".
    return camera.status(camera.find(camera_id)["host"])


@app.get("/api/cameras/{camera_id}/image")
def camera_image(camera_id: str):
    data, age = camera.image(camera.find(camera_id)["host"])
    return Response(content=data, media_type="image/jpeg", headers={} if age is None else {"X-Image-Age": f"{age:.0f}"})


# ---------------------------------------------------------------- files on the U1 (orcaone/printer_files.py)
# By camera id as the page "Kamera": every U1 with an address. Text files open as text in the browser.
_TEXT_FILES = (".gcode", ".log", ".cfg", ".conf", ".json", ".txt", ".bkp")


@app.get("/api/cameras/{camera_id}/files")
def printer_folder(camera_id: str, folder: str = "gcodes"):
    host = camera.find(camera_id)["host"]
    return {"folders": printer_files.folders(host), "folder": folder, **printer_files.listing(host, folder)}


@app.get("/api/cameras/{camera_id}/file")
def printer_file(camera_id: str, folder: str = "", path: str = "", download: bool = False):
    # Pictures, videos and files pass through OrcaOne: the browser never talks to the printer itself.
    return _passed_on(printer_files.open_file(camera.find(camera_id)["host"], folder, path), path, download)


def _passed_on(response, path: str, download: bool = False):
    """Moonraker's answer with a file, handed on to the browser block by block."""
    name = path.rsplit("/", 1)[-1]
    kind = response.headers.get("Content-Type") or mimetypes.guess_type(name)[0] or "application/octet-stream"
    if not download and name.lower().endswith(_TEXT_FILES):
        kind = "text/plain; charset=utf-8"
    headers = {"Content-Disposition": f"attachment; filename*=UTF-8''{quote(name)}"} if download else {}
    for name in ("Content-Length", "Content-Range"):
        if response.headers.get(name):
            headers[name] = response.headers[name]

    def chunks():
        try:
            while block := response.read(65536):
                yield block
        finally:
            response.close()
    return StreamingResponse(chunks(), status_code=response.status, media_type=kind, headers=headers)


# ---------------------------------------------------------------- print files of any Klipper printer
# By model, for the pages "3D Ansicht" and "2D Ansicht": the files in "gcodes" and one of them to
# read, whole or a piece of it (Range, for the G-code of one line).
@app.get("/api/printers/files")
def printer_print_files(model: str = ""):
    return printer_files.listing(camera.host_of(model), "gcodes")


@app.get("/api/printers/file")
def printer_print_file(request: Request, model: str = "", path: str = ""):
    wanted = request.headers.get("range", "")
    wanted = wanted if re.fullmatch(r"bytes=\d+-\d*", wanted) else None
    return _passed_on(printer_files.open_file(camera.host_of(model), "gcodes", path, wanted), path)


@app.post("/api/printers/print")
def printer_print(payload: dict = Body(...)):
    # On the user's click in the top bar: a print file of any Klipper printer; the U1 starts through
    # /api/cameras/{id}/print with its display's options.
    return printer_files.start_plain(camera.host_of(str(payload.get("model", ""))), payload.get("path"))


@app.get("/api/printers/mesh")
def printer_mesh(model: str = ""):
    # The page "Höhenkarte": the bed mesh Klipper uses (orcaone/monitor.py), read only.
    return monitor.mesh(camera.host_of(model))


@app.get("/api/printers/control")
def printer_control(model: str = ""):
    # The page "Druck steuern" (orcaone/control.py): the running print, its objects, a pause at a layer.
    return control.state(camera.host_of(model))


@app.post("/api/printers/exclude")
def printer_exclude(payload: dict = Body(...)):
    # On the user's click, after asking: one object of the running print left out.
    return control.exclude(camera.host_of(str(payload.get("model", ""))), payload.get("name"))


@app.post("/api/printers/pause-at")
def printer_pause_at(payload: dict = Body(...)):
    # On the user's click: a pause at a layer, or after the one printing now ("next").
    return control.pause_at(camera.host_of(str(payload.get("model", ""))), payload.get("layer"), payload.get("next"))


@app.post("/api/printers/pause")
def printer_pause(payload: dict = Body(...)):
    # On the user's click (the top bar, the page "Druck steuern").
    return printer_files.pause(camera.host_of(str(payload.get("model", ""))))


@app.post("/api/printers/resume")
def printer_resume(payload: dict = Body(...)):
    return printer_files.resume(camera.host_of(str(payload.get("model", ""))))


@app.post("/api/printers/cancel")
def printer_cancel(payload: dict = Body(...)):
    # On the user's click, after asking (the top bar).
    return printer_files.cancel(camera.host_of(str(payload.get("model", ""))))


@app.post("/api/printers/emergency-stop")
def printer_emergency_stop(payload: dict = Body(...)):
    # On the user's second click (the top bar).
    return printer_files.emergency_stop(camera.host_of(str(payload.get("model", ""))))


@app.post("/api/cameras/{camera_id}/files/delete")
def delete_printer_files(camera_id: str, payload: dict = Body(...)):
    # Print files and videos, on the user's wish (orcaone/printer_files.py).
    return printer_files.delete(camera.find(camera_id)["host"], payload.get("folder"), payload.get("names"))


@app.get("/api/cameras/{camera_id}/print")
def print_setup(camera_id: str):
    return printer_files.print_setup(camera.find(camera_id)["host"])


@app.post("/api/cameras/{camera_id}/print")
def start_print(camera_id: str, payload: dict = Body(...)):
    # On the user's wish: a print with the options of the printer's display.
    return printer_files.start_print(camera.find(camera_id)["host"], payload.get("path"), payload.get("options"), payload.get("map"))


@app.get("/", include_in_schema=False)
def index():
    # The page in the design chosen in the menu, so it shows so from the first frame; without a
    # choice the system's (color-scheme in style.css).
    html = (STATIC_DIR / "index.html").read_text(encoding="utf-8")
    theme = settings.load().get("theme")
    if theme in THEMES:
        html = html.replace("<html ", f'<html data-theme="{theme}" ', 1)
    return HTMLResponse(html)


app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="static")
