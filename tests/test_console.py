"""The page "Konsole" (orcaone/console.py) against a small stand-in for
Moonraker, never a real printer: the store of commands and answers, and sending one line."""

import json
import threading
import time
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest

from conftest import call
from orcaone import camera, console

# As the U1 answers /server/gcode_store (24.09.2026), plus an answer and an error.
STORE = [{"message": "SET_LED LED=cavity_led WHITE=1", "time": 1790226933.7, "type": "command"},
         {"message": "STATUS", "time": 1790226940.1, "type": "command"},
         {"message": "// Klipper state: Ready", "time": 1790226940.2, "type": "response"},
         {"message": "!! Unknown command:\"FOO\"", "time": 1790226950.0, "type": "response"}]


@pytest.fixture
def moonraker():
    sent = []

    class Handler(BaseHTTPRequestHandler):
        def _answer(self, result):
            body = json.dumps({"result": result}).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            assert self.path == f"/server/gcode_store?count={console.LINES}"
            self._answer({"gcode_store": STORE})

        def do_POST(self):
            query = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
            sent.append((urllib.parse.urlparse(self.path).path, query["script"][0]))
            self._answer("ok")

        def log_message(self, *args):
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    yield f"127.0.0.1:{server.server_address[1]}", sent
    server.shutdown()


def _wait_for(sent, n):
    for _ in range(100):
        if len(sent) >= n:
            return
        time.sleep(0.02)


def test_the_store_since_a_time(moonraker):
    host, _ = moonraker
    assert [l["message"] for l in console.history(host)["lines"]] == [e["message"] for e in STORE]
    newer = console.history(host, 1790226940.1)["lines"]
    assert newer == [{"time": 1790226940.2, "type": "response", "message": "// Klipper state: Ready"},
                     {"time": 1790226950.0, "type": "response", "message": "!! Unknown command:\"FOO\""}]
    assert len(console.history(host, "gestern")["lines"]) == 4


def test_one_line_goes_out(moonraker):
    host, sent = moonraker
    assert console.send(host, "  BED_MESH_OUTPUT  ") == {"sent": "BED_MESH_OUTPUT"}
    _wait_for(sent, 1)
    assert sent == [("/printer/gcode/script", "BED_MESH_OUTPUT")]
    for wrong in ("", "   ", "G28\nM84", "G28\r", "X" * 2001, None, 5):
        with pytest.raises(camera.CameraError) as err:
            console.send(host, wrong)
        assert err.value.code == "gcode_invalid"
    assert len(sent) == 1


def test_api(server, moonraker):
    host, sent = moonraker
    camera.set_host("MyKlipper", host)
    status, body = call(f"{server}/api/printers/gcode?model=MyKlipper&since=1790226940.1")
    assert status == 200 and [l["type"] for l in json.loads(body)["lines"]] == ["response", "response"]
    status, body = call(f"{server}/api/printers/gcode", "POST", {"model": "MyKlipper", "script": "M115"})
    assert (status, json.loads(body)) == (200, {"sent": "M115"})
    _wait_for(sent, 1)
    assert sent == [("/printer/gcode/script", "M115")]
    status, body = call(f"{server}/api/printers/gcode", "POST", {"model": "MyKlipper", "script": ""})
    assert (status, json.loads(body)) == (400, {"error": "gcode_invalid"})
    assert call(f"{server}/api/printers/gcode?model=Unbekannt")[0] == 404
