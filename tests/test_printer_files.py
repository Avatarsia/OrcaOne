"""The files on the U1 (orcaone/printer_files.py) against a small stand-in for Moonraker, never a
real printer: the folders and what may be deleted, deleting one by one, and a print with the
options of the display."""

import json
import re
import threading
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest

from conftest import call
from orcaone import camera, printer_files

# Trimmed from the answers of the user's U1 on 24.09.2026.
ROOTS = [{"name": "config", "permissions": "r"}, {"name": "logs", "permissions": "r"},
         {"name": "gcodes", "permissions": "rw"}, {"name": "camera", "permissions": "r"}]
PRINT_FILE = {"filename": "Puzzel_PLA_1h28m.gcode", "size": 2989333, "modified": 1790084407.5, "estimated_time": 5289,
              "layer_count": 19, "filament_type": "PLA;PLA;PLA;PLA", "filament_colour": "#E2DEDB;#080A0D;#E72F1D;#F4C032",
              "filament_weight": [29.18, 28.62, 0.0, 7.16],
              "thumbnails": [{"width": 300, "height": 300, "relative_path": ".thumbs/Puzzel_PLA_1h28m-300x300.png"},
                             {"width": 48, "height": 48, "relative_path": ".thumbs/Puzzel_PLA_1h28m-48x48.png"},
                             {"width": 96, "height": 96, "relative_path": ".thumbs/Puzzel_PLA_1h28m-96x96.png"}]}
GCODE = b";LAYER_CHANGE\n;Z:0.2\nG1 X10 Y10 E1\n"
TASK_CONFIG = {"filament_type": ["PLA", "PLA", "PETG", "PLA"], "filament_sub_type": ["Matte", "SnapSpeed", "Basic", "Basic"],
               "filament_vendor": ["Snapmaker"] * 4, "filament_exist": [True, True, True, False],
               "filament_color_rgba": ["FFFFFFFF", "080A0DFF", "E72F1DFF", "F78E0EFF"],
               "auto_bed_leveling": True, "flow_calibrate": False, "shaper_calibrate": False, "time_lapse_camera": True}


@pytest.fixture
def moonraker():
    """GETs as the U1 answers them; DELETE and POST are recorded. A file in "busy" is being printed."""
    seen = {"deleted": [], "started": [], "busy": set(), "start_answer": {"state": "success", "message": "Print started"}}

    class Handler(BaseHTTPRequestHandler):
        def _send(self, status, result=None, body=None, kind="application/json", headers=()):
            data = body if body is not None else json.dumps(result).encode()
            self.send_response(status)
            self.send_header("Content-Type", kind)
            self.send_header("Content-Length", str(len(data)))
            for name, value in headers:
                self.send_header(name, value)
            self.end_headers()
            self.wfile.write(data)

        def do_GET(self):
            answers = {
                "/server/files/roots": ROOTS,
                "/server/files/directory?path=gcodes&extended=true": {
                    "files": [{**PRINT_FILE, "filename": "old.gcode", "modified": 1.0, "filament_weight": [3.0]}, PRINT_FILE],
                    "dirs": [{"dirname": ".thumbs"}], "disk_usage": {"total": 100, "used": 40, "free": 60}},
                "/server/files/list?root=logs": [{"path": "moonraker.log", "size": 12, "modified": 2.0},
                                                 {"path": "klippy.log", "size": 7, "modified": 1.0}],
                "/printer/objects/query?print_task_config&print_stats": {
                    "status": {"print_task_config": TASK_CONFIG, "print_stats": {"state": "standby"}}},
            }
            if self.path.startswith("/server/files/camera/"):
                return self._send(200, body=b"\x00\x00\x00 ftypisom", kind="video/mp4")
            if self.path == "/server/files/gcodes/Puzzel_PLA_1h28m.gcode":
                # A piece on request, as Moonraker sends it (Tornado's StaticFileHandler).
                wanted = re.fullmatch(r"bytes=(\d+)-(\d*)", self.headers.get("Range") or "")
                if wanted:
                    first, last = int(wanted[1]), int(wanted[2] or len(GCODE) - 1)
                    return self._send(206, body=GCODE[first:last + 1], kind="application/octet-stream",
                                      headers=[("Content-Range", f"bytes {first}-{last}/{len(GCODE)}")])
                return self._send(200, body=GCODE, kind="application/octet-stream")
            if self.path in answers:
                return self._send(200, {"result": answers[self.path]})
            self._send(404, {"error": {"code": 404, "message": "Not Found"}})

        def do_DELETE(self):
            name = urllib.parse.unquote(self.path[len("/server/files/gcodes/"):])
            if name in seen["busy"]:
                return self._send(403, {"error": {"code": 403, "message": f"File is in use: {name}"}})
            seen["deleted"].append(name)
            self._send(200, {"result": {"item": {"path": name, "root": "gcodes"}, "action": "delete_file"}})

        def do_POST(self):
            # As Snapmaker's Moonraker: these two on every way but HTTP (checked on the U1, 24.09.2026).
            if self.path in ("/server/files/start_local_print", "/printer/emergency_stop"):
                return self._send(404, {"error": {"code": 404, "message": "Not Found"}})
            raw = self.rfile.read(int(self.headers.get("Content-Length") or 0))
            seen["started"].append((self.path, json.loads(raw) if raw else None))
            if self.path == "/printer/print/cancel" and "cancel" in seen["busy"]:
                return self._send(400, {"error": {"code": 400, "message": "No print in progress"}})
            self._send(200, {"result": "ok"})

        def log_message(self, *args):
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    yield f"127.0.0.1:{server.server_address[1]}", seen
    server.shutdown()


@pytest.fixture
def service(monkeypatch, moonraker):
    """Moonraker's WebSocket: the camera service (unisrv) with its list of time-lapses, and what the
    U1 takes only this way, the print start of Snapmaker Orca and the emergency stop."""
    _, seen = moonraker
    calls = []
    videos = [{"date_index": "20260915044700", "gcode_name": "holder", "video_file_size": 17992551, "video_duration": "00:08",
               "unix_timestamp_s": 1789464369, "video_local_url_suffix": "/files/camera/holder_20260915044700.mp4"},
              {"date_index": "20260916140019", "gcode_name": "hex-key", "video_file_size": 19816849, "video_duration": "00:08",
               "unix_timestamp_s": 1789570588, "video_local_url_suffix": "/files/camera/hex-key_20260916140019.mp4"},
              {"date_index": "", "video_local_url_suffix": "/files/camera/broken.mp4"}]

    def rpc(host, method, params, timeout=camera.TIMEOUT):
        calls.append((method, params))
        seen.setdefault("timeouts", {})[method] = timeout
        if method == "camera.get_timelapse_instance":
            return {"result": {"count": len(videos), "instances": videos}}
        if method in ("server.files.start_local_print", "printer.emergency_stop"):
            if seen.get("rpc_error"):
                return {"error": {"code": 400, "message": seen["rpc_error"]}}
            return {"result": seen["start_answer"] if method.startswith("server.") else "ok"}
        if params.get("date_index") == "gone":
            return {"error": {"code": 400, "message": "No valid parameter"}}
        return {"result": {"state": "success"}}
    monkeypatch.setattr(camera, "_rpc", rpc)
    return calls


def test_folders_and_what_they_hold(moonraker, service):
    host, _ = moonraker
    # Moonraker shares "camera" for reading, but the camera service deletes its videos.
    assert printer_files.folders(host) == [{"name": "gcodes", "delete": True}, {"name": "camera", "delete": True},
                                           {"name": "logs", "delete": False}, {"name": "config", "delete": False}]
    gcodes = printer_files.listing(host, "gcodes")
    assert gcodes["disk"] == {"total": 100, "used": 40, "free": 60}
    newest = gcodes["files"][0]
    assert [f["name"] for f in gcodes["files"]] == ["Puzzel_PLA_1h28m.gcode", "old.gcode"]
    # Only the heads the print uses, each with material, colour and grams.
    assert newest["tools"] == [{"tool": 0, "type": "PLA", "colour": "#E2DEDB", "grams": 29.18},
                               {"tool": 1, "type": "PLA", "colour": "#080A0D", "grams": 28.62},
                               {"tool": 3, "type": "PLA", "colour": "#F4C032", "grams": 7.16}]
    assert (newest["thumb"], newest["picture"]) == (".thumbs/Puzzel_PLA_1h28m-96x96.png", ".thumbs/Puzzel_PLA_1h28m-300x300.png")
    assert newest["printable"] and (newest["time"], newest["layers"]) == (5289, 19)
    videos = printer_files.listing(host, "camera")["files"]
    assert videos[0] == {"id": "20260916140019", "name": "hex-key", "path": "hex-key_20260916140019.mp4", "size": 19816849,
                         "modified": 1789570588, "duration": "00:08", "thumb": "hex-key_20260916140019.jpg"}
    assert len(videos) == 2  # one without date_index cannot be deleted, nor shown
    assert [f["name"] for f in printer_files.listing(host, "logs")["files"]] == ["klippy.log", "moonraker.log"]
    with pytest.raises(camera.CameraError) as err:
        printer_files.listing(host, "userdata")
    assert err.value.code == "folder_unknown"


def test_deleting_one_by_one(moonraker, service):
    host, seen = moonraker
    seen["busy"].add("printing now.gcode")
    result = printer_files.delete(host, "gcodes", ["a b.gcode", "printing now.gcode", "c.gcode", "a b.gcode"])
    assert result["deleted"] == ["a b.gcode", "c.gcode"] and seen["deleted"] == ["a b.gcode", "c.gcode"]
    assert result["failed"] == [{"name": "printing now.gcode", "detail": "File is in use: printing now.gcode"}]
    # Videos go through the camera service, by date_index, as Snapmaker Orca deletes them.
    result = printer_files.delete(host, "camera", ["20260915044700", "gone"])
    assert result == {"deleted": ["20260915044700"], "failed": [{"name": "gone", "detail": "No valid parameter"}]}
    assert ("camera.delete_timelapse_instance", {"date_index": "20260915044700"}) in service
    for folder, names, code in (("logs", ["klippy.log"], "folder_read_only"), ("config", ["printer.cfg"], "folder_read_only"),
                                ("gcodes", [], "file_invalid"), ("gcodes", "a.gcode", "file_invalid")):
        with pytest.raises(camera.CameraError) as err:
            printer_files.delete(host, folder, names)
        assert err.value.code == code
    assert printer_files.delete(host, "gcodes", ["../moonraker.conf"])["failed"][0]["detail"] == "file_invalid"
    assert seen["deleted"] == ["a b.gcode", "c.gcode"]


def test_a_print_with_the_options_of_the_display(moonraker, service):
    host, seen = moonraker
    setup = printer_files.print_setup(host)
    assert setup["state"] == "standby"
    assert setup["options"] == {"bed_level": True, "flow_calibrate": False, "shaper_calibrate": False, "time_lapse_camera": True}
    assert setup["heads"][2] == {"type": "PETG", "sub_type": "Basic", "vendor": "Snapmaker", "loaded": True, "colour": "#E72F1D"}
    assert setup["heads"][3]["loaded"] is False

    answer = printer_files.start_print(host, "Puzzel_PLA_1h28m.gcode", {"bed_level": True, "time_lapse_camera": "ja"}, [[0, 2], [1, 0]])
    assert answer == {"started": "Puzzel_PLA_1h28m.gcode"}
    # All four options as the display sets them, the heads as MAP_TABLE reads them (ast.literal_eval),
    # with Snapmaker Orca's call and patience over the WebSocket; nothing over HTTP.
    assert service[-1] == ("server.files.start_local_print", {"path": "Puzzel_PLA_1h28m.gcode", "options": {
        "bed_level": 1, "flow_calibrate": 0, "shaper_calibrate": 0, "time_lapse_camera": 0, "map_table": "[[0,2],[1,0]]"}})
    assert seen["timeouts"]["server.files.start_local_print"] == printer_files.START_TIMEOUT and seen["started"] == []

    seen["start_answer"] = {"state": "error", "message": "Printer is busy, cannot start print"}
    with pytest.raises(camera.CameraError) as err:
        printer_files.start_print(host, "Puzzel_PLA_1h28m.gcode", {}, [])
    assert (err.value.code, err.value.detail) == ("print_refused", "Printer is busy, cannot start print")
    # A refusal of the call itself, as a firmware without it would answer.
    seen["rpc_error"] = "Method not found"
    with pytest.raises(camera.CameraError) as err:
        printer_files.start_print(host, "Puzzel_PLA_1h28m.gcode", {}, [])
    assert (err.value.code, err.value.detail) == ("print_refused", "Method not found")
    for path, mapping, code in (("notes.txt", [], "file_invalid"), ("../x.gcode", [], "file_invalid"),
                                ("a.gcode", [[0, 4]], "print_invalid"), ("a.gcode", [[32, 0]], "print_invalid"),
                                ("a.gcode", [[0, True]], "print_invalid"), ("a.gcode", "[[0,1]]", "print_invalid")):
        with pytest.raises(camera.CameraError) as err:
            printer_files.start_print(host, path, {}, mapping)
        assert err.value.code == code
    assert [method for method, _ in service].count("server.files.start_local_print") == 3


def test_api(server, moonraker, service):
    host, seen = moonraker
    camera.set_host("Snapmaker U1", host)
    cam = json.loads(call(f"{server}/api/cameras")[1])["cameras"][0]
    base = f"{server}/api/cameras/{cam['id']}"
    status, body = call(f"{base}/files?folder=gcodes")
    data = json.loads(body)
    assert status == 200 and [f["name"] for f in data["folders"]] == ["gcodes", "camera", "logs", "config"]
    assert data["folder"] == "gcodes" and len(data["files"]) == 2 and data["disk"]["free"] == 60
    # A video through OrcaOne, and as a download under its own name.
    with urllib.request.urlopen(f"{base}/file?folder=camera&path=hex-key_20260916140019.mp4") as response:
        assert response.headers["Content-Type"] == "video/mp4" and response.read().endswith(b"ftypisom")
    with urllib.request.urlopen(f"{base}/file?folder=camera&path=hex-key_20260916140019.mp4&download=true") as response:
        assert response.headers["Content-Disposition"] == "attachment; filename*=UTF-8''hex-key_20260916140019.mp4"
    assert json.loads(call(f"{base}/file?folder=gcodes&path=../x")[1]) == {"error": "file_invalid"}
    assert call(f"{base}/file?folder=gcodes&path=missing.gcode")[0] == 404
    status, body = call(f"{base}/files/delete", "POST", {"folder": "gcodes", "names": ["old.gcode"]})
    assert (status, json.loads(body)) == (200, {"deleted": ["old.gcode"], "failed": []})
    status, body = call(f"{base}/files/delete", "POST", {"folder": "logs", "names": ["klippy.log"]})
    assert (status, json.loads(body)) == (400, {"error": "folder_read_only"})
    assert json.loads(call(f"{base}/print")[1])["state"] == "standby"
    status, body = call(f"{base}/print", "POST", {"path": "old.gcode", "options": {"bed_level": True}, "map": [[0, 0]]})
    assert (status, json.loads(body)) == (200, {"started": "old.gcode"})
    seen["start_answer"] = {"state": "error", "message": "Printer is busy, cannot start print"}
    status, body = call(f"{base}/print", "POST", {"path": "old.gcode", "options": {}, "map": []})
    assert (status, json.loads(body)) == (409, {"error": "print_refused", "detail": "Printer is busy, cannot start print"})
    assert call(f"{server}/api/cameras/nope/files")[0] == 404


def test_print_files_for_the_3d_and_2d_view(server, moonraker):
    # The pages "3D Ansicht" and "2D Ansicht" name the printer by its model, like the page
    # "Drucker", and read the file as text block by block, or a piece of it.
    host, _ = moonraker
    camera.set_host("Snapmaker U1", host)
    status, body = call(f"{server}/api/printers/files?model=Snapmaker%20U1")
    assert status == 200 and [f["name"] for f in json.loads(body)["files"]] == ["Puzzel_PLA_1h28m.gcode", "old.gcode"]
    with urllib.request.urlopen(f"{server}/api/printers/file?model=Snapmaker%20U1&path=Puzzel_PLA_1h28m.gcode") as response:
        assert response.headers["Content-Type"] == "text/plain; charset=utf-8"
        assert response.headers["Content-Length"] == str(len(GCODE)) and response.read() == GCODE
    piece = urllib.request.Request(f"{server}/api/printers/file?model=Snapmaker%20U1&path=Puzzel_PLA_1h28m.gcode",
                                   headers={"Range": "bytes=14-19"})
    with urllib.request.urlopen(piece) as response:
        assert (response.status, response.headers["Content-Range"]) == (206, f"bytes 14-19/{len(GCODE)}")
        assert response.read() == b";Z:0.2"
    # Anything else than one plain range: the whole file.
    odd = urllib.request.Request(f"{server}/api/printers/file?model=Snapmaker%20U1&path=Puzzel_PLA_1h28m.gcode",
                                 headers={"Range": "bytes=0-1,5-9"})
    with urllib.request.urlopen(odd) as response:
        assert response.status == 200 and response.read() == GCODE
    assert call(f"{server}/api/printers/file?model=Snapmaker%20U1&path=missing.gcode")[0] == 404
    assert json.loads(call(f"{server}/api/printers/file?model=Snapmaker%20U1&path=../x")[1]) == {"error": "file_invalid"}
    assert call(f"{server}/api/printers/files?model=Unbekannt")[0] == 404


def test_start_cancel_and_stop_from_the_top_bar(server, moonraker, service):
    """The buttons next to the print file (app.js), each on the user's click: a print on any Klipper
    printer as OrcaSlicer starts it, pausing, resuming and cancelling it, the emergency stop over the
    WebSocket."""
    host, seen = moonraker
    camera.set_host("Snapmaker U1", host)
    model = "Snapmaker U1"
    status, body = call(f"{server}/api/printers/print", "POST", {"model": model, "path": "Puzzel_PLA_1h28m.gcode"})
    assert (status, json.loads(body)) == (200, {"started": "Puzzel_PLA_1h28m.gcode"})
    for what, answer in (("pause", {"paused": True}), ("resume", {"resumed": True}), ("cancel", {"cancelled": True})):
        status, body = call(f"{server}/api/printers/{what}", "POST", {"model": model})
        assert (status, json.loads(body)) == (200, answer)
    status, body = call(f"{server}/api/printers/emergency-stop", "POST", {"model": model})
    assert (status, json.loads(body)) == (200, {"stopped": True})
    assert seen["started"] == [("/printer/print/start", {"filename": "Puzzel_PLA_1h28m.gcode"}), ("/printer/print/pause", {}),
                               ("/printer/print/resume", {}), ("/printer/print/cancel", {})]
    assert service == [("printer.emergency_stop", {})]
    # Nothing to cancel, or Klipper gone: the printer says no, OrcaOne passes on why.
    seen["busy"].add("cancel")
    status, body = call(f"{server}/api/printers/cancel", "POST", {"model": model})
    assert (status, json.loads(body)) == (409, {"error": "print_refused", "detail": "No print in progress"})
    seen["rpc_error"] = "Klippy Disconnected"
    status, body = call(f"{server}/api/printers/emergency-stop", "POST", {"model": model})
    assert (status, json.loads(body)) == (409, {"error": "print_refused", "detail": "Klippy Disconnected"})
    for path in ("notes.txt", "../x.gcode", None):
        status, body = call(f"{server}/api/printers/print", "POST", {"model": model, "path": path})
        assert json.loads(body)["error"] == "file_invalid", path
    assert call(f"{server}/api/printers/emergency-stop", "POST", {"model": "Unbekannt"})[0] == 404
    assert len(seen["started"]) == 5 and len(service) == 2
