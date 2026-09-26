"""The page "Logs" of the printer part (orcaone/printer_logs.py): a printer's logs as written, read in
pieces over Range, the last start from the end back, a search through the whole file. Against a
stand-in for Moonraker, never a real printer (hard rule 1)."""

import json
import re
import threading
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest

from conftest import call
from orcaone import camera, printer_logs
from orcaone.camera import CameraError

STATS = "09-26 07:10:{:02d}.000:Stats {}.0: gcodein=0 mcu: mcu_awake=0.007 sysload=0.25\n"
# As the U1 writes klippy.log (the time before each line, checked 26.09.2026); made up, no real data.
KLIPPY = ("09-26 07:10:00.000:Starting Klippy...\n"
          "09-26 07:10:00.100:Start printer at Sat Sep 26 07:10:00 2026 (1.0 2.0)\n"
          + "".join(STATS.format(i % 60, i) for i in range(300))
          + "09-26 07:12:51.285:Transition to shutdown state: Shutdown due to webhooks request\n"
          "09-26 07:12:51.355:Raising exception: id:522 index:0 code:18 oneshot:0 level:3 is_persistent:0, message: Shutdown due to webhooks request\n"
          + "".join(STATS.format(i % 60, i) for i in range(50))
          + "09-26 07:29:58.313:Start printer at Sat Sep 26 07:29:58 2026 (2.0 3.0)\n"
          + "".join(STATS.format(i % 60, i) for i in range(100))).encode()
MOONRAKER = b"2026-09-26 07:30:00,001 [server.py:main()] - Moonraker starting\n2026-09-26 07:30:01,000 [x.py:y()] - access_code: 12345678\n"
FILES = {"klippylogs/klippy.log": KLIPPY, "klippylogs/klippy.log.1": b"old\n", "moonraker.log": MOONRAKER,
         "unisrv.1.log": b"u1\n", "unisrv.log": b"u\n", "gui.log.0": b"g0\n", "gui.log": b"g\n", "sysinfo_0.csv": b"a,b\n"}
MODIFIED = {"klippylogs/klippy.log": 9, "klippylogs/klippy.log.1": 5, "moonraker.log": 8, "unisrv.1.log": 2, "unisrv.log": 7,
            "gui.log.0": 1, "gui.log": 6, "sysinfo_0.csv": 3}


@pytest.fixture
def moonraker():
    """The folder "logs" and its files as Moonraker hands them out: a Range from the start, from a
    place on, or from the end (bytes=-N) with 206; beyond the end 416 with the size."""
    class Handler(BaseHTTPRequestHandler):
        def _send(self, status, body, kind="application/json", headers=()):
            self.send_response(status)
            self.send_header("Content-Type", kind)
            self.send_header("Content-Length", str(len(body)))
            for name, value in headers:
                self.send_header(name, value)
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            if self.path == "/server/files/list?root=logs":
                listing = [{"path": p, "size": len(b), "modified": MODIFIED[p], "permissions": "r"} for p, b in FILES.items()]
                return self._send(200, json.dumps({"result": listing}).encode())
            name = urllib.parse.unquote(self.path.removeprefix("/server/files/logs/"))
            if not self.path.startswith("/server/files/logs/") or name not in FILES:
                return self._send(404, b'{"error": {"code": 404, "message": "Not Found"}}')
            body = FILES[name]
            wanted = re.fullmatch(r"bytes=(\d*)-(\d*)", self.headers.get("Range") or "")
            if not wanted:
                return self._send(200, body, "text/plain")
            if wanted[1] == "":
                first, last = max(0, len(body) - int(wanted[2])), len(body) - 1
            else:
                first, last = int(wanted[1]), min(len(body) - 1, int(wanted[2] or len(body) - 1))
            if first >= len(body):
                return self._send(416, b"", headers=[("Content-Range", f"bytes */{len(body)}")])
            self._send(206, body[first:last + 1], "text/plain", [("Content-Range", f"bytes {first}-{last}/{len(body)}")])

        def log_message(self, *args):
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    yield f"127.0.0.1:{server.server_address[1]}"
    server.shutdown()


def _check(lines):
    """Each line is the file's own, whole, at the offset it names."""
    for line in lines:
        assert KLIPPY[line["at"]:].split(b"\n", 1)[0].decode() == line["text"], line


def test_the_files_by_log(moonraker):
    """Older parts with the log they belong to (klippy.log.1, on the U1 also unisrv.1.log), the
    newest first; Klipper's and Moonraker's logs first."""
    found = printer_logs.files(moonraker)["files"]
    assert [(f["path"], f["group"]) for f in found] == [
        ("klippylogs/klippy.log", "klippylogs/klippy.log"), ("klippylogs/klippy.log.1", "klippylogs/klippy.log"),
        ("moonraker.log", "moonraker.log"), ("gui.log", "gui.log"), ("gui.log.0", "gui.log"),
        ("sysinfo_0.csv", "sysinfo_0.csv"), ("unisrv.log", "unisrv.log"), ("unisrv.1.log", "unisrv.log")]


def test_the_end_older_newer_and_following(moonraker, monkeypatch):
    """The end first: whole lines only, each at its offset, as written; older ones join without a
    gap; from a line on it starts with that line; following finds nothing new, and a file that got
    smaller says its new size."""
    monkeypatch.setattr(printer_logs, "WINDOW", 1000)
    end = printer_logs.read(moonraker, "klippylogs/klippy.log")
    assert (end["size"], end["next"]) == (len(KLIPPY), len(KLIPPY)) and 10 < len(end["lines"]) < 20
    _check(end["lines"])
    assert end["from"] == end["lines"][0]["at"] > 0
    older = printer_logs.read(moonraker, "klippylogs/klippy.log", end=end["from"])
    _check(older["lines"])
    assert older["next"] == end["from"] and older["lines"][-1]["at"] < end["from"]
    at = older["lines"][3]["at"]
    jump = printer_logs.read(moonraker, "klippylogs/klippy.log", start=at)
    assert jump["lines"][0]["at"] == at
    _check(jump["lines"])
    start = printer_logs.read(moonraker, "klippylogs/klippy.log", start=0)
    assert start["lines"][0] == {"at": 0, "text": "09-26 07:10:00.000:Starting Klippy...", "kind": ""}
    assert start["lines"][1]["kind"] == "start"
    assert printer_logs.read(moonraker, "klippylogs/klippy.log", start=len(KLIPPY))["lines"] == []
    shrunk = printer_logs.read(moonraker, "klippylogs/klippy.log", start=len(KLIPPY) + 500)
    assert (shrunk["lines"], shrunk["size"]) == ([], len(KLIPPY))
    # Every line as written, nothing masked (the user's wish of 26.09.2026: "1:1").
    assert printer_logs.read(moonraker, "moonraker.log")["lines"][1]["text"].endswith("access_code: 12345678")


def test_the_last_start(moonraker, monkeypatch):
    """From the end back, a piece at a time: the second start, found across pieces; a file without a
    start has none."""
    monkeypatch.setattr(printer_logs, "BACK", 700)
    at = printer_logs.last_start(moonraker, "klippylogs/klippy.log")
    assert at == KLIPPY.rindex(b"09-26 07:29:58.313:Start printer at")
    monkeypatch.setattr(printer_logs, "BACK", 60)   # the mark is cut by the pieces
    monkeypatch.setattr(printer_logs, "BACK_STEPS", 1000)
    assert printer_logs.last_start(moonraker, "klippylogs/klippy.log") == at
    assert printer_logs.last_start(moonraker, "gui.log") is None


def test_the_search(moonraker, monkeypatch):
    """Through the whole file: plain text or a regular expression, regardless of case, with lines
    around each hit and their numbers; overlapping ones joined; at most HITS."""
    found = printer_logs.search(moonraker, "klippylogs/klippy.log", "raising EXCEPTION", context=1)
    assert (found["hits"], found["complete"], len(found["groups"])) == (1, True, 1)
    lines = found["groups"][0]["lines"]
    assert [l.get("hit", False) for l in lines] == [False, True, False]
    assert [l["kind"] for l in lines[:2]] == ["shutdown", "shutdown"] and lines[1]["n"] == 304
    assert lines[1]["text"] == KLIPPY.split(b"\n")[303].decode()
    joined = printer_logs.search(moonraker, "klippylogs/klippy.log", "shutdown", context=2)
    assert (joined["hits"], len(joined["groups"]), len(joined["groups"][0]["lines"])) == (2, 1, 6)
    assert printer_logs.search(moonraker, "klippylogs/klippy.log", r"code:1[89]\b", regex=True)["hits"] == 1
    assert printer_logs.search(moonraker, "klippylogs/klippy.log", "code:1[89]")["hits"] == 0   # plain: the brackets as they are
    for wrong, regex in (("(", True), ("", False), ("   ", False), ("x" * 201, False), (None, False)):
        with pytest.raises(CameraError) as err:
            printer_logs.search(moonraker, "klippylogs/klippy.log", wrong, regex)
        assert err.value.code == "log_query_invalid", wrong
    monkeypatch.setattr(printer_logs, "HITS", 3)
    many = printer_logs.search(moonraker, "klippylogs/klippy.log", "Stats")
    assert (many["hits"], many["complete"]) == (3, False)


def test_the_api(server, moonraker):
    """Only printers OrcaOne knows, only inside the folder "logs"; the download as the file is."""
    camera.set_host("Snapmaker U1", moonraker)
    base = f"{server}/api/printers"
    assert json.loads(call(f"{base}/logs?model=Snapmaker%20U1")[1])["files"][0]["path"] == "klippylogs/klippy.log"
    status, body = call(f"{base}/log?model=Snapmaker%20U1&path=klippylogs/klippy.log")
    assert status == 200 and json.loads(body)["next"] == len(KLIPPY)
    assert json.loads(call(f"{base}/log/start?model=Snapmaker%20U1&path=klippylogs/klippy.log")[1])["at"] == KLIPPY.rindex(b"09-26 07:29:58.313:Start")
    status, body = call(f"{base}/log/search?model=Snapmaker%20U1&path=klippylogs/klippy.log&q=code:1%5B89%5D&regex=true&context=0")
    assert status == 200 and json.loads(body)["hits"] == 1
    assert json.loads(call(f"{base}/log/search?model=Snapmaker%20U1&path=klippylogs/klippy.log&q=(&regex=true")[1]) == {"error": "log_query_invalid"}
    with urllib.request.urlopen(f"{base}/log/download?model=Snapmaker%20U1&path=moonraker.log", timeout=5) as response:
        assert response.read() == MOONRAKER and response.headers["Content-Disposition"].startswith("attachment")
    for wrong in ("../x", "/etc/passwd", "a\\b"):
        status, body = call(f"{base}/log?model=Snapmaker%20U1&path={urllib.parse.quote(wrong)}")
        assert (status, json.loads(body)["error"]) == (400, "file_invalid"), wrong
    assert call(f"{base}/log?model=Snapmaker%20U1&path=gibt_es_nicht.log")[0] == 404
    assert call(f"{base}/logs?model=Unbekannt")[0] == 404
