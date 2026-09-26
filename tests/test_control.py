"""The page "Steuerung" (orcaone/control.py) against a small stand-in for Moonraker, never a real
printer: the running print with its objects, leaving one out, and a pause at a layer."""

import json
import threading
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest

from conftest import call
from orcaone import camera, control

MACROS = ["gcode_macro SET_PAUSE_AT_LAYER", "gcode_macro SET_PAUSE_NEXT_LAYER", "gcode_macro SET_PRINT_STATS_INFO"]
# Shaped as the user's U1 answered on 25.09.2026, with two objects as EXCLUDE_OBJECT_DEFINE gives them.
OBJECTS = [{"name": "SEIFE.STL_ID_0_COPY_0", "center": [100.0, 120.0], "polygon": [[90, 110], [110, 110], [110, 130], [90, 130]]},
           {"name": "SEIFE.STL_ID_1_COPY_0", "center": [160.0, 120.0], "polygon": [[150, 110], [170, 110], [170, 130], [150, 130]]}]


@pytest.fixture
def printer():
    """A printer in the middle of a print; scripts are recorded and do what Klipper would."""
    seen = {"objects": ["print_stats", "virtual_sdcard", "exclude_object", "toolhead", "bed_mesh", *MACROS], "scripts": [],
            "excluded": [], "at": {"enable": False, "layer": 0, "call": "PAUSE"}, "next": {"enable": False, "call": "PAUSE"}}

    class Handler(BaseHTTPRequestHandler):
        def _send(self, status, payload):
            data = json.dumps(payload).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def do_GET(self):
            if self.path == "/printer/objects/list":
                return self._send(200, {"result": {"objects": seen["objects"]}})
            if self.path.startswith("/printer/objects/query?"):
                asked = [urllib.parse.unquote(q).split("=")[0] for q in self.path.split("?", 1)[1].split("&")]
                seen["asked"] = asked
                everything = {
                    "print_stats": {"state": "printing", "filename": "seife_PLA_1h9m.gcode", "info": {"total_layer": 121, "current_layer": 12}},
                    "virtual_sdcard": {"progress": 0.1},
                    "exclude_object": {"objects": OBJECTS, "excluded_objects": list(seen["excluded"]), "current_object": OBJECTS[0]["name"]},
                    "toolhead": {"axis_minimum": [0.0, 0.0, -6.0, 0.0], "axis_maximum": [271.0, 335.0, 275.0, 0.0]},
                    "bed_mesh": {"mesh_min": [3.0, 3.0], "mesh_max": [267.0, 267.0]},
                    "gcode_macro SET_PRINT_STATS_INFO": {"pause_next_layer": seen["next"], "pause_at_layer": seen["at"]},
                }
                return self._send(200, {"result": {"status": {k: v for k, v in everything.items() if k in asked}}})
            self._send(404, {"error": {"code": 404, "message": "Not Found"}})

        def do_POST(self):
            body = json.loads(self.rfile.read(int(self.headers.get("Content-Length") or 0)) or b"{}")
            if self.path != "/printer/gcode/script":
                return self._send(404, {"error": {"code": 404, "message": "Not Found"}})
            script = body["script"]
            seen["scripts"].append(script)
            words = dict(w.split("=", 1) for w in script.split()[1:])
            if script.startswith("EXCLUDE_OBJECT "):
                seen["excluded"].append(words["NAME"])
            elif script.startswith("SET_PAUSE_AT_LAYER "):
                seen["at"] = {"enable": words["ENABLE"] == "1", "layer": int(words.get("LAYER", seen["at"]["layer"])), "call": "PAUSE"}
            elif script.startswith("SET_PAUSE_NEXT_LAYER "):
                seen["next"] = {"enable": words["ENABLE"] == "1", "call": "PAUSE"}
            else:
                return self._send(400, {"error": {"code": 400, "message": f"Unknown command:\"{script.split()[0]}\""}})
            self._send(200, {"result": "ok"})

        def log_message(self, *args):
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    yield f"127.0.0.1:{server.server_address[1]}", seen
    server.shutdown()


def test_the_running_print(printer):
    host, seen = printer
    got = control.state(host)
    assert {k: got[k] for k in ("state", "file", "progress", "layer", "layers", "exclude")} == {
        "state": "printing", "file": "seife_PLA_1h9m.gcode", "progress": 0.1, "layer": 12, "layers": 121, "exclude": True}
    # The bed as on "Status": the mesh widened by its margin, not the heads' parking place behind it.
    assert got["bed"] == [[0.0, 0.0], [270.0, 270.0]]
    assert [(o["name"], o["current"], o["excluded"]) for o in got["objects"]] == [
        ("SEIFE.STL_ID_0_COPY_0", True, False), ("SEIFE.STL_ID_1_COPY_0", False, False)]
    assert got["pause"] == {"next": False, "layer": None}


def test_leave_an_object_out_and_pause_at_a_layer(server, printer):
    host, seen = printer
    camera.set_host("Snapmaker U1", host)
    model = "Snapmaker U1"
    status, body = call(f"{server}/api/printers/exclude", "POST", {"model": model, "name": "SEIFE.STL_ID_1_COPY_0"})
    assert status == 200 and [o["excluded"] for o in json.loads(body)["objects"]] == [False, True]
    # Only an object the printer names now, and nothing that could carry a second command.
    for name in ("SEIFE.STL_ID_9_COPY_0", "SEIFE.STL_ID_0_COPY_0 X=1", "A;G28", None):
        status, body = call(f"{server}/api/printers/exclude", "POST", {"model": model, "name": name})
        assert (status, json.loads(body)) == (400, {"error": "object_invalid"}), name
    status, body = call(f"{server}/api/printers/pause-at", "POST", {"model": model, "layer": 50})
    assert status == 200 and json.loads(body)["pause"] == {"next": False, "layer": 50}
    status, body = call(f"{server}/api/printers/pause-at", "POST", {"model": model, "next": True})
    assert json.loads(body)["pause"] == {"next": True, "layer": 50}
    call(f"{server}/api/printers/pause-at", "POST", {"model": model, "next": False})
    status, body = call(f"{server}/api/printers/pause-at", "POST", {"model": model, "layer": None})
    assert json.loads(body)["pause"] == {"next": False, "layer": None}
    for wrong in ({"layer": 0}, {"layer": "5"}, {"layer": True}, {"next": "ja"}):
        status, body = call(f"{server}/api/printers/pause-at", "POST", {"model": model, **wrong})
        assert (status, json.loads(body)) == (400, {"error": "pause_invalid"}), wrong
    assert seen["scripts"] == ["EXCLUDE_OBJECT NAME=SEIFE.STL_ID_1_COPY_0", "SET_PAUSE_AT_LAYER ENABLE=1 LAYER=50",
                               "SET_PAUSE_NEXT_LAYER ENABLE=1", "SET_PAUSE_NEXT_LAYER ENABLE=0", "SET_PAUSE_AT_LAYER ENABLE=0"]


def test_a_printer_without_the_macros(printer):
    """No [exclude_object] and none of Mainsail's macros: nothing to offer, and not asked for."""
    host, seen = printer
    seen["objects"] = ["print_stats", "virtual_sdcard", "toolhead"]
    got = control.state(host)
    assert (got["exclude"], got["objects"], got["pause"], got["bed"]) == (False, [], None, [[0.0, 0.0], [271.0, 335.0]])
    assert seen["asked"] == ["print_stats", "virtual_sdcard", "toolhead"]
