"""FastAPI app: JSON API under /api, the static UI under /."""

import json
import mimetypes
from dataclasses import asdict
from pathlib import Path
from urllib.parse import urlparse

from fastapi import Body, FastAPI, Request
from fastapi.responses import JSONResponse, Response
from fastapi.staticfiles import StaticFiles

from . import __version__, backup, camera, guard, instances, logs, operations, overview, settings

STATIC_DIR = Path(__file__).parent / "static"
_LOCAL_HOSTS = {"127.0.0.1", "localhost"}

# On Windows the registry can map .js to text/plain, and browsers then refuse to
# run ES modules.
mimetypes.add_type("text/javascript", ".js")
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


@app.exception_handler(camera.CameraError)
def _camera_error(request: Request, exc: camera.CameraError):
    status = {"camera_not_found": 404, "camera_host_invalid": 400, "camera_already_listed": 400,
              "camera_every_invalid": 400}.get(exc.code, 502)
    return _error(exc.code, status, **({"detail": exc.detail} if exc.detail else {}))


@app.exception_handler(logs.LogError)
def _log_error(request: Request, exc: logs.LogError):
    return _error(str(exc), 404 if str(exc) == "log_not_found" else 400)


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


@app.get("/api/settings")
def get_settings():
    language = settings.load().get("language")
    return {"language": language if language in LANGUAGES else None}


@app.post("/api/settings")
def set_settings(payload: dict = Body(...)):
    language = payload.get("language")
    if language not in LANGUAGES:
        return _error("setting_invalid")
    try:
        settings.change(lambda data: data.update(language=language))
    except OSError:
        return _error("save_failed", 500)
    return {"language": language}


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


# ---------------------------------------------------------------- camera of the U1 (orcaone/camera.py)

@app.get("/api/cameras")
def list_cameras():
    return {"cameras": camera.cameras()}


@app.post("/api/cameras")
def add_camera(payload: dict = Body(...)):
    name = payload.get("name")
    try:
        return {"camera": camera.add(payload.get("host"), name if isinstance(name, str) else "")}
    except OSError:
        return _error("save_failed", 500)


@app.delete("/api/cameras/{camera_id}")
def remove_camera(camera_id: str):
    try:
        camera.remove(camera_id)
    except OSError:
        return _error("save_failed", 500)
    return {"removed": camera_id}


@app.post("/api/cameras/{camera_id}")
def update_camera(camera_id: str, payload: dict = Body(...)):
    try:
        return {"camera": camera.set_every(camera_id, payload.get("every"))}
    except OSError:
        return _error("save_failed", 500)


@app.post("/api/cameras/{camera_id}/wake")
def wake_camera(camera_id: str):
    return {"result": camera.wake(camera.find(camera_id)["host"])}


@app.get("/api/cameras/{camera_id}/image")
def camera_image(camera_id: str):
    data, age = camera.image(camera.find(camera_id)["host"])
    return Response(content=data, media_type="image/jpeg", headers={} if age is None else {"X-Image-Age": f"{age:.0f}"})


app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="static")
