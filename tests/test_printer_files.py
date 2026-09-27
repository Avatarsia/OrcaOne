"""The files on a Klipper printer (orcaone/printer_files.py) against a small stand-in for Moonraker,
never a real printer: the folders and what may be deleted, deleting one by one, folders in
"gcodes", moving, uploading, and a print with the options of the display."""

import email.parser
import email.policy
import json
import re
import socket
import threading
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest

from conftest import call
from orcaone import app as app_module
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
VIDEO_FILE = (b"\x00\x00\x00 ftypisom", "video/mp4")
TASK_CONFIG = {"filament_type": ["PLA", "PLA", "PETG", "PLA"], "filament_sub_type": ["Matte", "SnapSpeed", "Basic", "Basic"],
               "filament_vendor": ["Snapmaker"] * 4, "filament_exist": [True, True, True, False],
               "filament_color_rgba": ["FFFFFFFF", "080A0DFF", "E72F1DFF", "F78E0EFF"],
               "auto_bed_leveling": True, "flow_calibrate": False, "shaper_calibrate": False, "time_lapse_camera": True}


@pytest.fixture
def moonraker():
    """GETs as the U1 answers them; DELETE and POST are recorded. A file in "busy" is being printed."""
    seen = {"deleted": [], "started": [], "busy": set(), "start_answer": {"state": "success", "message": "Print started"},
            "dirs_deleted": [], "made": [], "moved": [], "uploads": [], "printing": None}
    top = {"files": [{**PRINT_FILE, "filename": "old.gcode", "modified": 1.0, "filament_weight": [3.0]}, PRINT_FILE],
           "dirs": [{"dirname": ".thumbs"}, {"dirname": "calibration_data"}, {"dirname": "Projekte", "modified": 5.0, "size": 4096}],
           "disk_usage": {"total": 100, "used": 40, "free": 60}}
    # Moonraker names the pictures relative to the file's own folder.
    inner = {"files": [{**PRINT_FILE, "filename": "Box.gcode", "thumbnails": [{"width": 300, "relative_path": ".thumbs/Box-300x300.png"}]}],
             "dirs": [{"dirname": "Alt", "modified": 6.0}, {"dirname": ".thumbs"}], "disk_usage": top["disk_usage"]}

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
                "/server/files/directory?path=gcodes&extended=true": top,
                "/server/files/directory?path=gcodes": top,
                "/server/files/directory?path=gcodes/Projekte&extended=true": inner,
                "/server/files/directory?path=gcodes/Projekte": inner,
                "/server/files/directory?path=gcodes/Projekte/Alt": {"files": [], "dirs": []},
                "/printer/objects/query?print_stats": {"status": {"print_stats": {
                    "state": "printing" if seen["printing"] else "standby", "filename": seen["printing"] or ""}}},
                "/server/files/list?root=logs": [{"path": "moonraker.log", "size": 12, "modified": 2.0},
                                                 {"path": "klippy.log", "size": 7, "modified": 1.0}],
                "/printer/objects/query?print_task_config&print_stats": {
                    "status": {"print_task_config": TASK_CONFIG, "print_stats": {"state": "standby"}}},
            }
            files = {"/server/files/gcodes/Puzzel_PLA_1h28m.gcode": (GCODE, "application/octet-stream")}
            data, kind = VIDEO_FILE if self.path.startswith("/server/files/camera/") else files.get(self.path, (None, None))
            if data is not None:
                # A piece on request, as Moonraker sends it (Tornado's StaticFileHandler).
                wanted = re.fullmatch(r"bytes=(\d+)-(\d*)", self.headers.get("Range") or "")
                if wanted:
                    first, last = int(wanted[1]), int(wanted[2] or len(data) - 1)
                    return self._send(206, body=data[first:last + 1], kind=kind,
                                      headers=[("Content-Range", f"bytes {first}-{last}/{len(data)}"), ("Accept-Ranges", "bytes")])
                return self._send(200, body=data, kind=kind, headers=[("Accept-Ranges", "bytes")])
            if self.path in answers:
                return self._send(200, {"result": answers[self.path]})
            self._send(404, {"error": {"code": 404, "message": "Not Found"}})

        def do_DELETE(self):
            if self.path.startswith("/server/files/directory?"):
                query = urllib.parse.parse_qs(urllib.parse.urlsplit(self.path).query)
                seen["dirs_deleted"].append((query["path"][0], query.get("force")))
                return self._send(200, {"result": {"item": {"path": query["path"][0]}, "action": "delete_dir"}})
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
            if self.path == "/server/files/upload":
                # Broken off before its end: Moonraker drops what came (on_connection_close).
                if len(raw) < int(self.headers["Content-Length"]) or not raw.endswith(b"--\r\n"):
                    return self._send(400, {"error": {"code": 400, "message": "Incomplete upload"}})
                # The form as Moonraker reads it: root, path, the file with its name.
                form = email.parser.BytesParser(policy=email.policy.HTTP).parsebytes(
                    b"Content-Type: " + self.headers["Content-Type"].encode() + b"\r\n\r\n" + raw)
                parts = {part.get_param("name", header="content-disposition"): part for part in form.iter_parts()}
                seen["uploads"].append({key: part.get_payload(decode=True) for key, part in parts.items()}
                                       | {"filename": parts["file"].get_filename()})
                return self._send(201, {"result": {"item": {"path": parts["file"].get_filename(), "root": "gcodes"}, "action": "create_file"}})
            if self.path in ("/server/files/directory", "/server/files/move"):
                body = json.loads(raw)
                if body.get("dest") == "gcodes/Projekte/refused.gcode":
                    return self._send(400, {"error": {"code": 400, "message": "Refused by Moonraker"}})
                seen["made" if self.path.endswith("directory") else "moved"].append(body)
                return self._send(200, {"result": {"item": {}, "action": "ok"}})
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
        if method in ("printer.firmware_restart", "printer.restart"):
            return {"result": "ok"}
        if method.startswith("printer.print."):
            if method == "printer.print.cancel" and "cancel" in seen["busy"]:
                return {"error": {"code": 400, "message": "No print in progress"}}
            return {"result": "ok"}
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
    assert seen["timeouts"]["server.files.start_local_print"] == printer_files.ORDER_TIMEOUT and seen["started"] == []

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


def test_folders_in_print_files(moonraker, service):
    """The file explorer (the user's wish of 26.09.2026): a folder in "gcodes" with its files and
    folders, pictures relative to it, the printer's own folders hidden; details for the side panel."""
    host, _ = moonraker
    top = printer_files.listing(host, "gcodes")
    assert top["dirs"] == [{"name": "Projekte", "path": "Projekte", "size": 4096, "modified": 5.0}]
    assert top["files"][0]["path"] == "Puzzel_PLA_1h28m.gcode"
    inner = printer_files.listing(host, "gcodes", "Projekte")
    box = inner["files"][0]
    assert (box["name"], box["path"], box["thumb"]) == ("Box.gcode", "Projekte/Box.gcode", "Projekte/.thumbs/Box-300x300.png")
    assert [d["path"] for d in inner["dirs"]] == ["Projekte/Alt"]
    for key in printer_files.DETAILS:
        assert key in box
    for wrong in ("../x", "/abs", "a\\b"):
        with pytest.raises(camera.CameraError) as err:
            printer_files.listing(host, "gcodes", wrong)
        assert err.value.code == "file_invalid"
    # Another Klipper printer has no camera service: no videos, "config" read only although writable.
    assert printer_files.folders(host, u1=False) == [{"name": "gcodes", "delete": True}, {"name": "logs", "delete": False},
                                                     {"name": "config", "delete": False}]
    with pytest.raises(camera.CameraError) as err:
        printer_files.listing(host, "camera", u1=False)
    assert err.value.code == "folder_unknown"


def test_making_moving_and_deleting_folders(moonraker, service):
    host, seen = moonraker
    assert printer_files.make_dir(host, "Projekte", "Neu") == {"created": "Projekte/Neu"}
    assert printer_files.make_dir(host, "", "Serie 2") == {"created": "Serie 2"}
    assert seen["made"] == [{"path": "gcodes/Projekte/Neu"}, {"path": "gcodes/Serie 2"}]
    for parent, name, code in (("", "Projekte", "name_taken"), ("Projekte/", "x", "file_invalid"), ("a//b", "x", "file_invalid"), ("", ".versteckt", "name_invalid"), ("", "a/b", "name_invalid"),
                               ("", 'a"b', "name_invalid"), ("", " ", "name_invalid"), ("", 5, "name_invalid"),
                               (".thumbs", "x", "file_invalid"), ("calibration_data", "x", "file_invalid"), ("../x", "y", "file_invalid")):
        with pytest.raises(camera.CameraError) as err:
            printer_files.make_dir(host, parent, name)
        assert err.value.code == code, (parent, name)
    assert len(seen["made"]) == 2

    # One by one: already there is skipped, the same name, into itself, the printer's own and a refusal fail.
    seen["printing"] = "Projekte/Alt/running.gcode"
    result = printer_files.move(host, ["old.gcode", "Projekte/Box.gcode", "Projekte/Alt", "refused.gcode", ".thumbs/x.png"], "Projekte")
    assert result["moved"] == ["old.gcode"]
    assert seen["moved"] == [{"source": "gcodes/old.gcode", "dest": "gcodes/Projekte/old.gcode"}]
    assert result["failed"] == [{"name": "refused.gcode", "detail": "Refused by Moonraker"}, {"name": ".thumbs/x.png", "detail": "file_invalid"}]
    result = printer_files.move(host, ["Projekte", "Projekte/Alt", "Projekte/Alt/Box.gcode"], "")
    assert result["failed"] == [{"name": "Projekte/Alt", "detail": "file_in_use"}]
    assert result["moved"] == ["Projekte/Alt/Box.gcode"]    # "Projekte" is there already, it stays
    assert printer_files.move(host, ["Projekte/Alt/Box.gcode"], "Projekte")["failed"] == [{"name": "Projekte/Alt/Box.gcode", "detail": "exists"}]
    assert printer_files.move(host, ["Projekte"], "Projekte/Alt")["failed"] == [{"name": "Projekte", "detail": "move_into_itself"}]
    for paths, target in (([], ""), ("old.gcode", ""), (["old.gcode"], "../x")):
        with pytest.raises(camera.CameraError):
            printer_files.move(host, paths, target)
    assert len(seen["moved"]) == 2

    # A folder with all it holds, but not the one with the print in it.
    result = printer_files.delete(host, "gcodes", ["old.gcode"], ["Serie 2", "Projekte", "calibration_data"])
    assert result["deleted"] == ["old.gcode", "Serie 2"]
    assert result["failed"] == [{"name": "Projekte", "detail": "file_in_use"}, {"name": "calibration_data", "detail": "file_invalid"}]
    assert seen["dirs_deleted"] == [("gcodes/Serie 2", ["true"])]
    with pytest.raises(camera.CameraError) as err:
        printer_files.delete(host, "camera", [], ["x"])
    assert err.value.code == "file_invalid"


def test_uploading_block_by_block(moonraker, service):
    host, seen = moonraker
    blocks = [b";Model\n", b"G1 X1\n" * 1000, "; Ä\n".encode()]
    size = sum(map(len, blocks))
    assert printer_files.upload(host, "Projekte", "Würfel 2.gcode", size, iter(blocks)) == {"uploaded": "Projekte/Würfel 2.gcode"}
    assert seen["uploads"] == [{"root": b"gcodes", "path": b"Projekte", "file": b"".join(blocks), "filename": "Würfel 2.gcode"}]
    assert printer_files.upload(host, "", "neu.gcode", 3, iter([b"G28"]))["uploaded"] == "neu.gcode"
    assert "path" not in seen["uploads"][-1]
    # Over a file of the same name only when asked, as Moonraker would overwrite it silently.
    with pytest.raises(camera.CameraError) as err:
        printer_files.upload(host, "", "old.gcode", 3, iter([b"G28"]))
    assert (err.value.code, err.value.detail) == ("name_taken", "old.gcode")
    printer_files.upload(host, "", "old.gcode", 3, iter([b"G28"]), replace=True)
    # A browser that sends less or more than it announced: nothing lands on the printer.
    for sent in ([b"G2"], [b"G28", b"X"]):
        with pytest.raises(camera.CameraError) as err:
            printer_files.upload(host, "", "kurz.gcode", 3, iter(sent))
        assert err.value.code == "upload_failed"
    for folder, name, code in (("", "../x.gcode", "name_invalid"), (".thumbs", "x.gcode", "file_invalid"), ("", ".hidden", "name_invalid")):
        with pytest.raises(camera.CameraError) as err:
            printer_files.upload(host, folder, name, 1, iter([b"x"]))
        assert err.value.code == code
    assert len(seen["uploads"]) == 3
    # The printer gone: unreachable, not a refusal.
    with pytest.raises(camera.CameraError) as err:
        printer_files.upload("127.0.0.1:1", "", "x.gcode", 1, iter([b"x"]), replace=True)
    assert err.value.code == "camera_unreachable"


def send_file(url, data):
    """A file as the page sends it: the bytes as the body."""
    request = urllib.request.Request(url, data=data, method="POST", headers={"Content-Type": "application/octet-stream"})
    try:
        with urllib.request.urlopen(request, timeout=5) as response:
            return response.status, response.read()
    except urllib.error.HTTPError as err:
        return err.code, err.read()


def test_api(server, moonraker, service):
    host, seen = moonraker
    camera.set_host("Snapmaker U1", host)
    base, model = f"{server}/api/printers/folder", "model=Snapmaker%20U1"
    status, body = call(f"{base}?{model}&folder=gcodes")
    data = json.loads(body)
    assert status == 200 and [f["name"] for f in data["folders"]] == ["gcodes", "camera", "logs", "config"]
    assert data["folder"] == "gcodes" and len(data["files"]) == 2 and data["disk"]["free"] == 60
    assert [d["name"] for d in data["dirs"]] == ["Projekte"]
    data = json.loads(call(f"{base}?{model}&folder=gcodes&path=Projekte")[1])
    assert (data["path"], [f["path"] for f in data["files"]]) == ("Projekte", ["Projekte/Box.gcode"])
    # A video through OrcaOne, and as a download under its own name.
    with urllib.request.urlopen(f"{base}/file?{model}&folder=camera&path=hex-key_20260916140019.mp4") as response:
        assert response.headers["Content-Type"] == "video/mp4" and response.read().endswith(b"ftypisom")
        assert response.headers["Accept-Ranges"] == "bytes"
    # The player asks for pieces: the U1's time-lapses keep their index at the end (moov after mdat).
    piece = urllib.request.Request(f"{base}/file?{model}&folder=camera&path=hex-key_20260916140019.mp4", headers={"Range": "bytes=4-"})
    with urllib.request.urlopen(piece) as response:
        size = len(VIDEO_FILE[0])
        assert (response.status, response.headers["Content-Range"]) == (206, f"bytes 4-{size - 1}/{size}")
        assert response.read() == b"ftypisom"
    with urllib.request.urlopen(f"{base}/file?{model}&folder=camera&path=hex-key_20260916140019.mp4&download=true") as response:
        assert response.headers["Content-Disposition"] == "attachment; filename*=UTF-8''hex-key_20260916140019.mp4"
    assert json.loads(call(f"{base}/file?{model}&folder=gcodes&path=../x")[1]) == {"error": "file_invalid"}
    assert call(f"{base}/file?{model}&folder=gcodes&path=missing.gcode")[0] == 404
    status, body = call(f"{base}/delete", "POST", {"model": "Snapmaker U1", "folder": "gcodes", "names": ["old.gcode"]})
    assert (status, json.loads(body)) == (200, {"deleted": ["old.gcode"], "failed": []})
    status, body = call(f"{base}/delete", "POST", {"model": "Snapmaker U1", "folder": "logs", "names": ["klippy.log"]})
    assert (status, json.loads(body)) == (400, {"error": "folder_read_only"})
    status, body = call(f"{base}/move", "POST", {"model": "Snapmaker U1", "paths": ["old.gcode"], "target": "Projekte"})
    assert (status, json.loads(body)) == (200, {"moved": ["old.gcode"], "failed": []})
    status, body = call(f"{base}/make", "POST", {"model": "Snapmaker U1", "parent": "", "name": "Projekte"})
    assert (status, json.loads(body)) == (409, {"error": "name_taken", "detail": "Projekte"})
    # The file itself as the body, passed on to Moonraker; without a length it is refused.
    status, body = send_file(f"{base}/upload?{model}&folder=Projekte&name=Teil.gcode", b"G28\nG1 X5\n")
    assert (status, json.loads(body)) == (200, {"uploaded": "Projekte/Teil.gcode"})
    assert seen["uploads"][-1]["file"] == b"G28\nG1 X5\n"
    status, body = send_file(f"{base}/upload?{model}&name=old.gcode", b"G28")
    assert (status, json.loads(body)) == (409, {"error": "name_taken", "detail": "old.gcode"})
    status, body = send_file(f"{base}/upload?{model}&name=chunked.gcode", iter([b"G28"]))  # chunked, no length
    assert (status, json.loads(body)) == (411, {"error": "upload_failed"})
    assert len(seen["uploads"]) == 1
    assert call(f"{server}/api/printers/folder?model=Unbekannt")[0] == 404

    # Another Klipper printer: no videos, neither listed nor deleted.
    camera.set_host("Voron 2.4", host)
    data = json.loads(call(f"{base}?model=Voron%202.4&folder=gcodes")[1])
    assert [f["name"] for f in data["folders"]] == ["gcodes", "logs", "config"]
    status, body = call(f"{base}/delete", "POST", {"model": "Voron 2.4", "folder": "camera", "names": ["20260915044700"]})
    assert (status, json.loads(body)) == (400, {"error": "folder_read_only"})

    # The print with the options of the U1's display stays by camera id.
    cam = json.loads(call(f"{server}/api/cameras")[1])["cameras"][0]
    assert json.loads(call(f"{server}/api/cameras/{cam['id']}/print")[1])["state"] == "standby"
    status, body = call(f"{server}/api/cameras/{cam['id']}/print", "POST", {"path": "old.gcode", "options": {"bed_level": True}, "map": [[0, 0]]})
    assert (status, json.loads(body)) == (200, {"started": "old.gcode"})
    seen["start_answer"] = {"state": "error", "message": "Printer is busy, cannot start print"}
    status, body = call(f"{server}/api/cameras/{cam['id']}/print", "POST", {"path": "old.gcode", "options": {}, "map": []})
    assert (status, json.loads(body)) == (409, {"error": "print_refused", "detail": "Printer is busy, cannot start print"})
    assert call(f"{server}/api/cameras/nope/print")[0] == 404


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
    printer as OrcaSlicer starts it; pausing, resuming, cancelling and the emergency stop over the
    WebSocket, the first three waiting as long as Snapmaker Orca for the U1's macros."""
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
    assert seen["started"] == [("/printer/print/start", {"filename": "Puzzel_PLA_1h28m.gcode"})]
    assert service == [("printer.print.pause", {}), ("printer.print.resume", {}), ("printer.print.cancel", {}), ("printer.emergency_stop", {})]
    assert all(seen["timeouts"][f"printer.print.{what}"] == printer_files.ORDER_TIMEOUT for what in ("pause", "resume", "cancel"))
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
    assert len(seen["started"]) == 1 and len(service) == 6


def test_klipper_anew_after_the_emergency_stop(server, moonraker, service):
    """The way out of a shutdown (the user's wish of 26.09.2026: after the emergency stop there was
    no restart): FIRMWARE_RESTART or RESTART on a click, over the WebSocket, waiting as for pause."""
    host, seen = moonraker
    camera.set_host("Snapmaker U1", host)
    for firmware, method in ((True, "printer.firmware_restart"), (False, "printer.restart"), ("yes", "printer.restart")):
        service.clear()
        status, body = call(f"{server}/api/printers/restart", "POST", {"model": "Snapmaker U1", "firmware": firmware})
        assert (status, json.loads(body), service) == (200, {"restarted": True}, [(method, {})]), firmware
        assert seen["timeouts"][method] == printer_files.ORDER_TIMEOUT
    assert call(f"{server}/api/printers/restart", "POST", {"model": "Unbekannt", "firmware": True})[0] == 404


def test_what_the_review_of_the_explorer_found(server, moonraker, service, monkeypatch):
    """The review of 27.09.2026: a folder that is gone is not a printer away; the U1's own folders only
    on the U1, and no new name like them at its top; 3MF and ZIP printable only on the U1; the top bar
    reads a file in its own folder; a browser gone quiet ends its upload and frees its thread."""
    host, seen = moonraker
    with pytest.raises(camera.CameraError) as err:
        printer_files.listing(host, "gcodes", "Weg")
    assert err.value.code == "folder_missing"
    with pytest.raises(camera.CameraError) as err:
        printer_files.make_dir(host, "", "calibration_data")
    assert err.value.code == "name_invalid"
    # On another printer a folder of that name is the user's: shown, and taken like any other.
    assert "calibration_data" in [d["name"] for d in printer_files.listing(host, "gcodes", "", u1=False)["dirs"]]
    with pytest.raises(camera.CameraError) as err:
        printer_files.make_dir(host, "", "calibration_data", u1=False)
    assert err.value.code == "name_taken"
    assert printer_files._print_file({"filename": "a.3mf"})["printable"] is True
    assert printer_files._print_file({"filename": "a.3mf"}, "", u1=False)["printable"] is False
    assert printer_files._print_file({"filename": "a.gco"}, "", u1=False)["printable"] is True

    camera.set_host("Snapmaker U1", host)
    status, body = call(f"{server}/api/printers/folder?model=Snapmaker%20U1&folder=gcodes&path=Weg")
    assert (status, json.loads(body)["error"]) == (404, "folder_missing")
    status, body = call(f"{server}/api/printers/files?model=Snapmaker%20U1&path=Projekte")
    assert status == 200 and [f["path"] for f in json.loads(body)["files"]] == ["Projekte/Box.gcode"]

    # 100 bytes announced, 3 sent, then nothing: after UPLOAD_WAIT the upload ends with upload_failed.
    monkeypatch.setattr(app_module, "UPLOAD_WAIT", 0.5)
    port = int(server.rsplit(":", 1)[1])
    with socket.create_connection(("127.0.0.1", port), timeout=10) as conn:
        conn.sendall(f"POST /api/printers/folder/upload?model=Snapmaker%20U1&name=still.gcode HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\n"
                     "Content-Type: application/octet-stream\r\nContent-Length: 100\r\n\r\nG28".encode())
        answer = b""
        while b"upload_failed" not in answer:
            try:
                block = conn.recv(4096)
            except OSError:
                break    # the server closed the connection after answering
            if not block:
                break
            answer += block
    assert answer.split(b"\r\n", 1)[0].endswith(b"400 Bad Request") and b"upload_failed" in answer
