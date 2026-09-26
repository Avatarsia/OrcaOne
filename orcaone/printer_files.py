"""The files on a Klipper printer, for the page "Dateien" (the user's wish of 24.09.2026; since
26.09.2026 on every Klipper printer with an address, with folders in "gcodes", sorting, uploads and
moves by drag and drop).

Moonraker shares four folders and says itself which of them may be written (/server/files/roots;
on the U1 only "gcodes", checked 24.09.2026). The time-lapse videos belong to Snapmaker's camera
service (unisrv): it keeps their list in /userdata/.tmp_timelapse/timelapse.json, the files in
"camera" are only links. So the videos are read and deleted through the service over Moonraker's
WebSocket, as Snapmaker Orca does (SSWCP.cpp, sw_DeleteCameraTimelapse). A print starts as Snapmaker
Orca starts it (server.files.start_local_print in snapmakercloud.py on the U1), with the options of
the printer's display (print_task_config.py: BED_LEVEL, FLOW_CALIBRATE, SHAPER_CALIBRATE,
TIME_LAPSE_CAMERA, MAP_TABLE). Snapmaker's Moonraker takes that call, like the emergency stop, on
every way but HTTP (Snapmaker/u1-moonraker: TransportType.all() & ~TransportType.HTTP; over HTTP the
U1 answered 404, 24.09.2026), so both go over the WebSocket.

What it sends a printer, only when the user asks for it: delete a print file or a folder in "gcodes",
delete a video, upload a print file, move files and folders within "gcodes", make a folder there,
start a print; from the top bar and the page "Steuerung" also on any Klipper printer start,
pause, resume, cancel, emergency stop and a restart of Klipper or its firmware.
"""

import json
import os
import urllib.error
import urllib.parse
import urllib.request

from . import camera
from .camera import TIMEOUT, CameraError, _direct, _get

FOLDERS = ("gcodes", "camera", "logs", "config")  # in the order of the page
# The service deletes videos although Moonraker shares "camera" for reading only.
DELETABLE = ("gcodes", "camera")
PRINTABLE = (".gcode", ".3mf", ".zip")  # snapmakercloud.py, process_local_file
# Folders in "gcodes" the U1 keeps for itself, next to Moonraker's hidden ones (".thumbs"): not
# shown, and nothing is written into them.
OWN_DIRS = ("calibration_data", "shaper_calibrate")
# Characters a new name may not have: the path would change, or the multipart header of the upload.
_NAME_BAD = set('/\\"\r\n\0')
# The options of the display, as start_local_print takes them, and their names in the status of
# print_task_config (the values of the last print, which the display offers again).
OPTIONS = {"bed_level": "auto_bed_leveling", "flow_calibrate": "flow_calibrate",
           "shaper_calibrate": "shaper_calibrate", "time_lapse_camera": "time_lapse_camera"}
HEADS = 4    # PHYSICAL_EXTRUDER_NUM in print_task_config.py
TOOLS = 32   # LOGICAL_EXTRUDER_NUM: the T0 … T31 a print file may use
# Seconds a command may take until the printer answers: a print start while the U1 reads the file's
# metadata, a pause or a resume while its macro parks or heats. As long as Snapmaker Orca waits for
# any answer (add_response_target in MoonRaker.hpp, 80 000 ms).
ORDER_TIMEOUT = 80


def folders(host: str, u1: bool = True) -> list[dict]:
    """[{"name", "delete"}]: the folders Moonraker shares, and whether their files can be deleted.
    OrcaOne changes only print files and the U1's videos: "config" stays read only, although
    Moonraker lets it be written on other Klipper printers."""
    writable = {r.get("name"): "w" in str(r.get("permissions", "")) for r in _get(host, "/server/files/roots") if isinstance(r, dict)}
    return [{"name": n, "delete": (n == "gcodes" and writable[n]) or n == "camera"}
            for n in FOLDERS if n in writable and (u1 or n != "camera")]


def _at(values, i: int):
    return values[i] if isinstance(values, list) and i < len(values) else None


def _print_file(f: dict, folder: str = "") -> dict:
    """One print file with what its list line and its details show; its metadata comes from the
    slicer. folder: the folder in "gcodes" it lies in, "" at the top; Moonraker names its pictures
    relative to that folder."""
    types = str(f.get("filament_type") or "").split(";")
    colours = str(f.get("filament_colour") or "").split(";")
    used = f.get("filament_weight") or f.get("filament_used_mm")
    tools = [{"tool": i, "type": types[i] if i < len(types) else "", "colour": colours[i] if i < len(colours) else "",
              "grams": used[i] if f.get("filament_weight") else None}
             for i in range(min(TOOLS, max(len(types), len(colours))))
             if isinstance(_at(used, i), (int, float)) and _at(used, i) > 0]
    thumbs = sorted((t for t in f.get("thumbnails") or [] if isinstance(t, dict) and t.get("relative_path")),
                    key=lambda t: t.get("width") or 0)
    small = next((t for t in thumbs if (t.get("width") or 0) >= 90), thumbs[-1] if thumbs else None)
    name, prefix = f["filename"], folder + "/" if folder else ""
    return {"name": name, "path": prefix + name, "size": f.get("size"), "modified": f.get("modified"), "time": f.get("estimated_time"),
            "layers": f.get("layer_count"), "tools": tools, "printable": name.lower().endswith(PRINTABLE),
            "thumb": prefix + small["relative_path"] if small else None, "picture": prefix + thumbs[-1]["relative_path"] if thumbs else None,
            # For the details panel, as Moonraker read them from the file (metadata.py).
            **{key: f.get(source) for key, source in DETAILS.items()}}


# What the details of a print file show besides its list line: its name there and Moonraker's.
DETAILS = {"slicer": "slicer", "slicer_version": "slicer_version", "layer_height": "layer_height",
           "first_layer_height": "first_layer_height", "height": "object_height", "nozzle": "nozzle_diameter",
           "filament_name": "filament_name", "filament_mm": "filament_total", "filament_g": "filament_weight_total",
           "printed": "print_start_time"}


def _entry(d: dict, folder: str) -> dict:
    """A folder in "gcodes" as the list shows it."""
    name = d["dirname"]
    return {"name": name, "path": (folder + "/" if folder else "") + name, "size": d.get("size"), "modified": d.get("modified")}


def _shown(name: str, folder: str) -> bool:
    """Not Moonraker's hidden folders, nor at the top the U1's own."""
    return not name.startswith(".") and not (not folder and name in OWN_DIRS)


def _video(v: dict) -> dict | None:
    """One time-lapse of the camera service; "id" is its date_index, which deleting takes."""
    url = str(v.get("video_local_url_suffix") or "")
    if not v.get("date_index") or not url.startswith("/files/camera/"):
        return None
    path = url[len("/files/camera/"):]
    # Next to "<name>.mp4" the service links "<name>.jpg", a small picture of the print.
    return {"id": str(v["date_index"]), "name": v.get("gcode_name") or path, "path": path, "size": v.get("video_file_size"),
            "modified": v.get("unix_timestamp_s"), "duration": v.get("video_duration"),
            "thumb": path[:-len(".mp4")] + ".jpg" if path.endswith(".mp4") else None}


def listing(host: str, folder: str, path: str = "", u1: bool = True) -> dict:
    """{"files": [...], "dirs"?, "disk"?}. In "gcodes" the files and folders of one folder in it
    (path, "" for the top), without the printer's own (.thumbs, the U1's calibration_data and
    shaper_calibrate). The videos only on the U1 (u1), through its camera service."""
    if folder == "gcodes":
        path = _check_path(folder, path) if path else ""
        data = _get(host, "/server/files/directory?path=" + urllib.parse.quote("gcodes/" + path if path else "gcodes") + "&extended=true")
        files = [_print_file(f, path) for f in data.get("files") or [] if isinstance(f, dict) and f.get("filename")]
        dirs = [_entry(d, path) for d in data.get("dirs") or []
                if isinstance(d, dict) and isinstance(d.get("dirname"), str) and _shown(d["dirname"], path)]
        return {"files": sorted(files, key=lambda f: -(f["modified"] or 0)), "dirs": sorted(dirs, key=lambda d: d["name"].lower()),
                "disk": data.get("disk_usage")}
    if folder == "camera" and u1:
        answer = _call(host, "camera.get_timelapse_instance", {})
        videos = [_video(v) for v in (answer.get("instances") or []) if isinstance(v, dict)]
        return {"files": sorted((v for v in videos if v), key=lambda v: -(v["modified"] or 0))}
    if folder in FOLDERS and folder != "camera":
        files = [{"name": f["path"], "path": f["path"], "size": f.get("size"), "modified": f.get("modified")}
                 for f in _get(host, f"/server/files/list?root={folder}") if isinstance(f, dict) and f.get("path")]
        return {"files": sorted(files, key=lambda f: f["name"].lower())}
    raise CameraError("folder_unknown")


def _call(host: str, method: str, params: dict, timeout: float = TIMEOUT) -> dict:
    """The result of a JSON-RPC call over Moonraker's WebSocket, or CameraError."""
    try:
        answer = camera._rpc(host, method, params, timeout)
    except (OSError, ValueError, ConnectionError, TimeoutError) as exc:
        raise CameraError("camera_unreachable", f"{type(exc).__name__}: {exc}") from None
    if "error" in answer:
        error = answer["error"]
        raise CameraError("camera_refused", error.get("message", str(error)) if isinstance(error, dict) else str(error))
    result = answer.get("result")
    return result if isinstance(result, dict) else {}


def _check_path(folder: str, path) -> str:
    """A path inside a shared folder: relative, without "..", as Moonraker's own list gives it."""
    if folder not in FOLDERS:
        raise CameraError("folder_unknown")
    if not isinstance(path, str) or not path or path.startswith("/") or "\\" in path or ".." in path.split("/"):
        raise CameraError("file_invalid")
    return path


def open_file(host: str, folder: str, path: str, byte_range: str | None = None):
    """Moonraker's answer with one file, for OrcaOne to pass on to the browser; the caller closes it.
    With byte_range ("bytes=100-199") only that piece: Moonraker answers 206 (checked on the U1)."""
    url = f"http://{host}/server/files/{folder}/{urllib.parse.quote(_check_path(folder, path))}"
    try:
        return _direct.open(urllib.request.Request(url, headers={"Range": byte_range} if byte_range else {}), timeout=TIMEOUT)
    except urllib.error.HTTPError as exc:
        if exc.code == 416:
            # Beyond the end: with the size Moonraker names ("bytes */9784307"), for a log followed.
            raise CameraError("range_unsatisfiable", exc.headers.get("Content-Range") or "") from None
        raise CameraError("file_not_found" if exc.code == 404 else "camera_refused", f"HTTP {exc.code}") from None
    except OSError as exc:
        raise CameraError("camera_unreachable", str(exc)) from None


def _message(exc: urllib.error.HTTPError) -> str:
    """Moonraker's own words for a refusal, e.g. that the file is being printed."""
    try:
        error = json.loads(exc.read())["error"]
        return str(error.get("message") or error) if isinstance(error, dict) else str(error)
    except (OSError, ValueError, KeyError, TypeError):
        return f"HTTP {exc.code}"


def _writable(path) -> str:
    """A file or folder in "gcodes" OrcaOne may change: not in the printer's own folders."""
    path = _check_path("gcodes", path)
    parts = path.split("/")
    if any(not p or p.startswith(".") for p in parts) or parts[0] in OWN_DIRS:
        raise CameraError("file_invalid")
    return path


def _folder(path) -> str:
    """A folder in "gcodes" as a target, "" for the top."""
    return "" if path in ("", None) else _writable(path)


def _name(name) -> str:
    """A new name for a file or folder in "gcodes": one part of a path, nothing hidden."""
    if (not isinstance(name, str) or not name.strip() or name.startswith(".") or len(name.encode("utf-8")) > 255
            or any(c in _NAME_BAD or ord(c) < 32 for c in name)):
        raise CameraError("name_invalid")
    return name


def _inside(path: str, folder: str) -> bool:
    return path == folder or path.startswith(folder + "/")


def _printing(host: str) -> str | None:
    """The file in "gcodes" Klipper prints or holds paused, None without one or without Klipper."""
    try:
        stats = (_get(host, "/printer/objects/query?print_stats").get("status") or {}).get("print_stats") or {}
    except CameraError:
        return None
    return (stats.get("filename") or None) if stats.get("state") in ("printing", "paused") else None


def _names_in(host: str, folder: str) -> set:
    """The names of the files and folders in a folder of "gcodes" ("" for the top)."""
    data = _get(host, "/server/files/directory?path=" + urllib.parse.quote("gcodes/" + folder if folder else "gcodes"))
    return ({f.get("filename") for f in data.get("files") or [] if isinstance(f, dict)}
            | {d.get("dirname") for d in data.get("dirs") or [] if isinstance(d, dict)})


def _send(host: str, method: str, path: str, body: dict | None = None):
    """A change of files over Moonraker's HTTP API; its refusal as file_refused, with its words."""
    request = urllib.request.Request(f"http://{host}{path}", method=method, data=None if body is None else json.dumps(body).encode(),
                                     headers={} if body is None else {"Content-Type": "application/json"})
    try:
        with _direct.open(request, timeout=TIMEOUT) as response:
            return json.loads(response.read())["result"]
    except urllib.error.HTTPError as exc:
        raise CameraError("file_refused", _message(exc)) from None
    except (OSError, ValueError, KeyError, TypeError) as exc:
        raise CameraError("camera_unreachable", str(exc)) from None


def delete(host: str, folder: str, names, dirs=None) -> dict:
    """Deletes print files (by path) or videos (by date_index) one by one, so one that fails, the
    file being printed for instance, leaves the others done: {"deleted": [...], "failed": [{"name", "detail"}]}.
    dirs: folders in "gcodes", each with all it holds (Moonraker's force), but none with the file
    being printed in it."""
    if folder not in DELETABLE:
        raise CameraError("folder_read_only")
    dirs = [] if dirs is None else dirs
    if (not isinstance(names, list) or not isinstance(dirs, list) or not (names or dirs)
            or not all(isinstance(n, str) and n for n in names + dirs) or (dirs and folder != "gcodes")):
        raise CameraError("file_invalid")
    printing = _printing(host) if dirs else None
    deleted, failed = [], []
    for name in dict.fromkeys(names + dirs):
        try:
            if name in dirs:
                path = _writable(name)
                if printing and _inside(printing, path):
                    raise CameraError("file_in_use")
                _send(host, "DELETE", "/server/files/directory?path=" + urllib.parse.quote("gcodes/" + path) + "&force=true")
            elif folder == "gcodes":
                url = f"http://{host}/server/files/gcodes/{urllib.parse.quote(_writable(name))}"
                with _direct.open(urllib.request.Request(url, method="DELETE"), timeout=TIMEOUT) as response:
                    json.loads(response.read())["result"]
            else:
                _call(host, "camera.delete_timelapse_instance", {"date_index": name})
            deleted.append(name)
        except urllib.error.HTTPError as exc:
            failed.append({"name": name, "detail": _message(exc)})
        except CameraError as exc:
            failed.append({"name": name, "detail": exc.detail or exc.code})
        except (OSError, ValueError, KeyError, TypeError) as exc:
            failed.append({"name": name, "detail": str(exc)})
    return {"deleted": deleted, "failed": failed}


def make_dir(host: str, parent, name) -> dict:
    """A new folder in a folder of "gcodes" ("" for the top)."""
    parent, name = _folder(parent), _name(name)
    if name in _names_in(host, parent):
        raise CameraError("name_taken", name)
    path = (parent + "/" if parent else "") + name
    _send(host, "POST", "/server/files/directory", {"path": "gcodes/" + path})
    return {"created": path}


def move(host: str, paths, target) -> dict:
    """Files and folders of "gcodes" into another folder there ("" for the top), one by one: never
    over one of the same name, a folder never into itself, nothing being printed.
    {"moved": [...], "failed": [{"name", "detail"}]}, detail an error code or the printer's words."""
    if not isinstance(paths, list) or not paths or not all(isinstance(p, str) and p for p in paths):
        raise CameraError("file_invalid")
    target = _folder(target)
    there = _names_in(host, target)
    printing = _printing(host)
    moved, failed = [], []
    for source in dict.fromkeys(paths):
        try:
            _writable(source)
            parent, _, name = source.rpartition("/")
            if parent == target:
                continue    # already there
            if _inside(target, source):
                raise CameraError("move_into_itself")
            if name in there:
                raise CameraError("exists")
            if printing and _inside(printing, source):
                raise CameraError("file_in_use")
            _send(host, "POST", "/server/files/move", {"source": "gcodes/" + source, "dest": "gcodes/" + (target + "/" if target else "") + name})
            there.add(name)
            moved.append(source)
        except CameraError as exc:
            failed.append({"name": source, "detail": exc.detail or exc.code})
    return {"moved": moved, "failed": failed}


def upload(host: str, folder, name, size, chunks, replace: bool = False) -> dict:
    """A print file from the browser into a folder of "gcodes" ("" for the top), passed on block by
    block as it comes (chunks), in Moonraker's form (POST /server/files/upload), without a copy on
    this computer. Over a file of the same name only with replace: Moonraker overwrites silently."""
    folder, name = _folder(folder), _name(name)
    if not isinstance(size, int) or isinstance(size, bool) or size < 0:
        raise CameraError("upload_failed", "size")
    if not replace and name in _names_in(host, folder):
        raise CameraError("name_taken", name)
    boundary = "OrcaOne" + os.urandom(12).hex()

    def field(key, value):
        return f'--{boundary}\r\nContent-Disposition: form-data; name="{key}"\r\n\r\n{value}\r\n'
    head = (field("root", "gcodes") + (field("path", folder) if folder else "")
            + f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="{name}"\r\n'
            + "Content-Type: application/octet-stream\r\n\r\n").encode("utf-8")
    tail = f"\r\n--{boundary}--\r\n".encode()

    def body():
        yield head
        sent = 0
        for block in chunks:
            sent += len(block)
            if sent > size:
                raise ValueError("more bytes than announced")
            yield block
        if sent != size:
            raise ValueError(f"{sent} of {size} bytes")
        yield tail
    request = urllib.request.Request(f"http://{host}/server/files/upload", data=body(), method="POST",
                                     headers={"Content-Type": f"multipart/form-data; boundary={boundary}",
                                              "Content-Length": str(len(head) + size + len(tail))})
    try:
        # Moonraker answers once the file is written and read: allowed as long as a print start.
        with _direct.open(request, timeout=ORDER_TIMEOUT) as response:
            response.read()
    except urllib.error.HTTPError as exc:
        raise CameraError("file_refused", _message(exc)) from None
    except ValueError as exc:
        # The browser sent less or more than it announced, or went away.
        raise CameraError("upload_failed", str(exc)) from None
    except OSError as exc:
        raise CameraError("camera_unreachable", str(exc)) from None
    return {"uploaded": (folder + "/" if folder else "") + name}


def print_setup(host: str) -> dict:
    """What the display offers before a print: the options as set for the last print, the spool in
    each head, and whether the printer is busy (Klipper's print_stats)."""
    status = _get(host, "/printer/objects/query?print_task_config&print_stats").get("status") or {}
    config = status.get("print_task_config") or {}
    heads = []
    for i in range(HEADS):
        rgba = str(_at(config.get("filament_color_rgba"), i) or "")
        heads.append({"type": _at(config.get("filament_type"), i) or "", "sub_type": _at(config.get("filament_sub_type"), i) or "",
                      "vendor": _at(config.get("filament_vendor"), i) or "", "loaded": _at(config.get("filament_exist"), i) is True,
                      "colour": "#" + rgba[:6] if len(rgba) >= 6 else None})
    return {"state": (status.get("print_stats") or {}).get("state"), "heads": heads,
            "options": {o: config.get(key) is True for o, key in OPTIONS.items()}}


def start_print(host: str, path, options, mapping) -> dict:
    """Starts a print file with the display's options and which head prints which filament of it:
    mapping [[tool, head], …], 0-based as MAP_TABLE takes it. The printer checks the rest itself
    (PRINT_PRESTART_CHECK) and says no while it prints."""
    path = _check_path("gcodes", path)
    if not path.lower().endswith(PRINTABLE):
        raise CameraError("file_invalid")
    if not isinstance(options, dict) or not isinstance(mapping, list):
        raise CameraError("print_invalid")
    for pair in mapping:
        if (not isinstance(pair, list) or len(pair) != 2 or not all(isinstance(v, int) and not isinstance(v, bool) for v in pair)
                or not 0 <= pair[0] < TOOLS or not 0 <= pair[1] < HEADS):
            raise CameraError("print_invalid")
    chosen = {o: 1 if options.get(o) is True else 0 for o in OPTIONS}
    if mapping:
        # Written into the G-code command as MAP_TABLE="…" and read back with ast.literal_eval:
        # without spaces, so it stays one parameter.
        chosen["map_table"] = json.dumps(mapping, separators=(",", ":"))
    # The call of Snapmaker Orca (sw_StartLocalPrint), which sends it over MQTT. The U1 checks the file
    # and that it is idle, then sends SDCARD_PRINT_FILE_WITH_PARAMETERS with each option in capitals.
    result = _order(host, "server.files.start_local_print", {"path": path, "options": chosen}, ORDER_TIMEOUT)
    if result.get("state") != "success":
        raise CameraError("print_refused", str(result.get("message") or result))
    return {"started": result.get("filename") or path}


# Commands from the top bar, only on the user's click (the user's wish of 24.09.2026): start a print
# on any Klipper printer (the U1 takes start_print, with its display's options), cancel it, stop
# everything at once. Moonraker's own calls, on the U1 too.
def start_plain(host: str, path) -> dict:
    """As OrcaSlicer starts a print (Moonraker::start_print): the name in a JSON body."""
    path = _check_path("gcodes", path)
    if not path.lower().endswith(PRINTABLE):
        raise CameraError("file_invalid")
    _command(host, "/printer/print/start", {"filename": path})
    return {"started": path}


# Cancel, pause and resume (the user's wish of 25.09.2026) as Snapmaker Orca sends them
# (Moonraker_Mqtt::async_pause_print_job and the like): over the WebSocket, waiting up to
# ORDER_TIMEOUT. Moonraker answers only when the macro is done, and the U1's PAUSE parks the head
# first: over HTTP with TIMEOUT the printer paused, but OrcaOne reported a timeout (checked 25.09.2026).
def cancel(host: str) -> dict:
    _order(host, "printer.print.cancel", {}, ORDER_TIMEOUT)
    return {"cancelled": True}


def pause(host: str) -> dict:
    _order(host, "printer.print.pause", {}, ORDER_TIMEOUT)
    return {"paused": True}


def resume(host: str) -> dict:
    _order(host, "printer.print.resume", {}, ORDER_TIMEOUT)
    return {"resumed": True}


def emergency_stop(host: str) -> dict:
    """Klipper stops at once and stays shut down until FIRMWARE_RESTART. Over the WebSocket, as the
    U1 does not take it over HTTP (see above); neither slicer has an emergency stop to copy."""
    _order(host, "printer.emergency_stop", {})
    return {"stopped": True}


def restart(host: str, firmware: bool) -> dict:
    """FIRMWARE_RESTART, Klipper with its boards anew: the way out of a shutdown, after an emergency
    stop too (the user's wish of 26.09.2026: there was none); or RESTART, printer.cfg read anew.
    Over the WebSocket like the emergency stop. Moonraker answers once Klipper went down."""
    _order(host, "printer.firmware_restart" if firmware else "printer.restart", {}, ORDER_TIMEOUT)
    return {"restarted": True}


def _command(host: str, path: str, body: dict | None = None):
    request = urllib.request.Request(f"http://{host}{path}", data=json.dumps(body or {}).encode(), method="POST",
                                     headers={"Content-Type": "application/json"})
    try:
        with _direct.open(request, timeout=TIMEOUT) as response:
            return json.loads(response.read())["result"]
    except urllib.error.HTTPError as exc:
        raise CameraError("print_refused", _message(exc)) from None
    except (OSError, ValueError, KeyError, TypeError) as exc:
        raise CameraError("camera_unreachable", str(exc)) from None


def _order(host: str, method: str, params: dict, timeout: float = TIMEOUT) -> dict:
    """A command over the WebSocket; the printer's refusal as print_refused, with its words."""
    try:
        return _call(host, method, params, timeout)
    except CameraError as exc:
        if exc.code != "camera_refused":
            raise
        raise CameraError("print_refused", exc.detail) from None
