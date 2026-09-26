"""The page "Fehler" (orcaone/errors.py): the U1's codes in their parts, Klipper's messages sorted,
what the printer reports now and reported before, Snapmaker's words from Snapmaker Orca's device
panel. Against a stand-in for Moonraker and a made-up data folder, never a real printer or slicer."""

import json
import re
import threading
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from types import SimpleNamespace

import pytest

from conftest import call
from orcaone import camera, errors

ROOT = Path(__file__).resolve().parent.parent
# As the U1 writes klippy.log (checked 26.09.2026), made up: an emergency stop, logged twice in the
# same second, once with its code; a homing that failed because of it; an old note.
KLIPPY = """09-25 17:19:29.304:Raising exception: id:522 index:0 code:0 oneshot:1 level:3 is_persistent:0, message: !! Not in paused state and cannot be resumed!
09-25 17:19:29.304:Raising exception: id:522 index:0 code:0 oneshot:1 level:3 is_persistent:0, message: !! Not in paused state and cannot be resumed!
09-26 07:10:00.100:Start printer at Sat Sep 26 07:10:00 2026 (1.0 2.0)
09-26 07:12:51.285:Transition to shutdown state: Shutdown due to webhooks request
09-26 07:12:51.355:Raising exception: id:522 index:0 code:18 oneshot:0 level:3 is_persistent:0, message: Shutdown due to webhooks request
09-26 07:12:52.120:Raising exception: id:528 index:0 code:7 oneshot:1 level:3 is_persistent:0, message: Homing failed due to printer shutdown
""".encode()
STORE = [{"time": 1790000000.0, "type": "command", "message": "!!"},   # typed in, not Klipper's answer
         {"time": 1790000000.5, "type": "command", "message": "G1 X999"},
         {"time": 1790000001.0, "type": "response", "message": "!! Move out of range: 999.000 0.000 0.000 [0.000]"}]
NOW = {"exception_manager": {"exceptions": [{"id": 523, "index": 1, "code": 0, "level": 2, "message": "Filament runout"}]},
       "webhooks": {"state": "shutdown", "state_message": '{"coded": "0003-0522-0000-0018", "oneshot": 0, "msg":"Shutdown due to webhooks request"}\nOnce the underlying issue is corrected, use FIRMWARE_RESTART'},
       "print_stats": {"state": "error", "message": "Shutdown due to webhooks request", "exception": {}}}


@pytest.fixture
def moonraker():
    """Moonraker's answers the page asks for: the objects now, the G-code store, the folder "logs"."""
    state = {"now": NOW}

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
            result = None
            if self.path == "/printer/objects/query?exception_manager&webhooks&print_stats":
                result = {"eventtime": 1.0, "status": state["now"]}
            elif self.path == "/server/gcode_store?count=1000":
                result = {"gcode_store": STORE}
            elif self.path == "/server/files/list?root=logs":
                result = [{"path": "klippylogs/klippy.log", "size": len(KLIPPY), "modified": 9}, {"path": "gui.log", "size": 1, "modified": 8}]
            elif self.path == "/server/files/logs/" + urllib.parse.quote("klippylogs/klippy.log"):
                wanted = re.fullmatch(r"bytes=-(\d+)", self.headers.get("Range") or "")
                first = max(0, len(KLIPPY) - int(wanted[1])) if wanted else 0
                return self._send(206, KLIPPY[first:], "text/plain", [("Content-Range", f"bytes {first}-{len(KLIPPY) - 1}/{len(KLIPPY)}")])
            if result is None:
                return self._send(404, b'{"error": {"code": 404, "message": "Not Found"}}')
            self._send(200, json.dumps({"result": result}).encode())

        def log_message(self, *args):
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    yield f"127.0.0.1:{server.server_address[1]}", state
    server.shutdown()


@pytest.fixture
def snorca(tmp_path, monkeypatch):
    """A Snapmaker Orca data folder with the device panel's English texts, as found 26.09.2026."""
    folder = tmp_path / "Snapmaker_Orca"
    texts = folder.joinpath(*errors.TEXT_FILE)
    texts.parent.mkdir(parents=True)
    texts.write_text(json.dumps({"error_0003052800000007_title": "System Anomaly",
                                 "error_0003052800000007_desc": "System is in shutdown protection, cannot home.",
                                 "error_0002052300010000_title": "Filament Anomaly", "default_exception_title": "Exception",
                                 "error_12_title": "not a code"}), encoding="utf-8")
    monkeypatch.setattr(errors.instances, "discover", lambda *a: [SimpleNamespace(slicer="OrcaSlicer", data_dir=tmp_path / "x"),
                                                                  SimpleNamespace(slicer="Snapmaker_Orca", data_dir=folder)])
    errors._texts_cache.update(key=None, texts={})
    return texts


def test_a_code_and_its_words_apart():
    """The U1's shutdown message begins with {"coded": ...}; its words are joined in without escaping."""
    assert errors.split_coded(NOW["webhooks"]["state_message"]) == (
        "0003-0522-0000-0018", "Shutdown due to webhooks request\nOnce the underlying issue is corrected, use FIRMWARE_RESTART")
    assert errors.split_coded('{"coded": "0002-0531-0000-0024", "msg": "auto feeding batch has not yet begun", "action": "none"}') == (
        "0002-0531-0000-0024", "auto feeding batch has not yet begun")
    assert errors.split_coded('{"coded": "0003-0529-0000-0001", "oneshot": 1, "msg":"Unknown command:"G999""}')[1] == 'Unknown command:"G999"'
    assert errors.split_coded("MCU 'mcu' shutdown: Timer too close") == (None, "MCU 'mcu' shutdown: Timer too close")
    assert errors.split_coded(None) == (None, "")
    entry = errors._entry("Filament runout", "0002-0523-0001-0000")
    assert (entry["level"], entry["module"], entry["index"], entry["number"]) == (2, 523, 1, 0)
    assert errors._entry("x", "0002-523")["code"] is None


@pytest.mark.parametrize("message, kind", [
    ("MCU 'mcu' shutdown: Timer too close", "timer_too_close"),
    ("ADC out of range", "adc_out_of_range"),
    ("Heater extruder not heating at expected rate", "heater_not_heating"),
    ("Lost communication with MCU 'mcu'", "lost_communication"),
    ("Move out of range: 999.000 0.000 0.000 [0.000]", "move_out_of_range"),
    ("Must home axis first: 10.000 10.000 0.000 [0.000]", "must_home"),
    ("TMC 'stepper_x' reports error: GSTAT: 00000001 reset=1(Reset)", "tmc_error"),
    ("Shutdown due to webhooks request", "emergency_stop"),
    ('Unknown command:"G999"', "unknown_command"),
    ("Probe triggered prior to movement", "probe_early"),
    ("Something nobody knows", None),
])
def test_klippers_messages_sorted(message, kind):
    assert errors.classify(message)[0] == kind


def test_every_message_has_words_in_both_languages():
    """Each Klipper message and each own code has a title, what it means and what helps, in both."""
    for lang in ("de", "en"):
        text = (ROOT / "orcaone" / "static" / "texts" / f"{lang}.js").read_text(encoding="utf-8")
        faults = text[text.index("  faults: {"):]
        faults = faults[:faults.index("\n  },\n")]
        for key, _, _ in errors.PATTERNS:
            assert re.search(rf"\n      {key}: {{ title: \"[^\"]+\", what: \"[^\"]+\", fix: \"", faults), (lang, key)


def test_now_before_and_snapmakers_words(moonraker, snorca):
    host, _ = moonraker
    found = errors.read(host)
    assert found["codes"] is True
    assert (found["klipper"]["state"], found["klipper"]["code"], found["klipper"]["kind"]) == ("shutdown", "0003-0522-0000-0018", "emergency_stop")
    assert found["klipper"]["message"].startswith("Shutdown due to webhooks request")
    assert [(e["code"], e["index"]) for e in found["exceptions"]] == [("0002-0523-0001-0000", 1)]
    assert found["print"] == {"state": "error", "message": "Shutdown due to webhooks request", "exception": None}
    # Before, newest first: the log (a shutdown logged twice in one second once, with its code; a
    # note logged twice counted), then the console's "!!" answers.
    got = [(e["source"], e["code"], e.get("stamp"), e.get("count", 1)) for e in found["history"]]
    assert got == [("log", "0003-0528-0000-0007", "09-26 07:12:52", 1), ("log", "0003-0522-0000-0018", "09-26 07:12:51", 1),
                   ("log", "0003-0522-0000-0000", "09-25 17:19:29", 2), ("console", None, None, 1)]
    assert found["history"][-1]["kind"] == "move_out_of_range" and found["history"][-1]["time"] == 1790000001.0
    assert found["history"][0]["log"] == "klippylogs/klippy.log"
    # Snapmaker's words only for the codes on the page, by the code with dashes.
    assert found["texts"] == {"0003-0528-0000-0007": {"title": "System Anomaly", "desc": "System is in shutdown protection, cannot home."},
                              "0002-0523-0001-0000": {"title": "Filament Anomaly"}}


# One shutdown each, as the U1 (Snapmaker/u1-klipper) and Klipper write them: the "Transition" line,
# maybe with its code, the "Raising exception" line milliseconds later (maybe in the next second),
# and for an MCU the reason in a line of its own, before (U1) or after it (Klipper, without times).
SHUTDOWNS = b"""09-26 08:00:00.100:Transition to shutdown state: {"coded": "0003-0523-0001-0003", "oneshot": 0, "msg":"Heater extruder1 not heating at expected rate"}
See the 'verify_heater' section in docs/Config_Reference.md
09-26 08:00:00.180:Raising exception: id:523 index:1 code:3 oneshot:0 level:3 is_persistent:0, message: Heater extruder1 not heating at expected rate
09-26 09:00:00.100:Transition to shutdown state: MCU shutdown
09-26 09:00:00.180:Raising exception: id:522 index:1 code:16 oneshot:0 level:3 is_persistent:0, message: MCU 'mcu' shutdown: Timer too close
09-26 10:00:00.950:Transition to shutdown state: Shutdown due to webhooks request
09-26 10:00:01.020:Raising exception: id:522 index:0 code:18 oneshot:0 level:3 is_persistent:0, message: Shutdown due to webhooks request
09-26 11:00:00.050:MCU 'mcu' shutdown: ADC out of range
clocksync state: mcu_freq=72000000
09-26 11:00:00.100:Transition to shutdown state: MCU shutdown
09-26 11:00:00.150:Raising exception: id:522 index:0 code:2 oneshot:0 level:3 is_persistent:0, message: MCU shutdown
Transition to shutdown state: MCU shutdown
Dumping serial stats: bytes_write=1 bytes_read=2
MCU 'mcu' shutdown: Timer too close
This often indicates the host computer is overloaded.
"""


def test_one_shutdown_is_one_entry_with_its_reason(monkeypatch):
    monkeypatch.setattr(errors.printer_logs, "files", lambda host: {"files": [{"path": "klippy.log", "group": "klippy.log", "modified": 1}]})
    monkeypatch.setattr(errors.printer_logs, "tail", lambda host, path, size: SHUTDOWNS)
    got = [(e["stamp"], e["code"], e["kind"], e["message"], e.get("count", 1)) for e in errors._joined(errors._from_log("x"))]
    assert got == [
        ("09-26 08:00:00", "0003-0523-0001-0003", "heater_not_heating", "Heater extruder1 not heating at expected rate", 1),
        ("09-26 09:00:00", "0003-0522-0001-0016", "timer_too_close", "MCU 'mcu' shutdown: Timer too close", 1),
        ("09-26 10:00:01", "0003-0522-0000-0018", "emergency_stop", "Shutdown due to webhooks request", 1),
        ("09-26 11:00:00", "0003-0522-0000-0002", "adc_out_of_range", "MCU 'mcu' shutdown: ADC out of range", 1),
        (None, None, "timer_too_close", "MCU 'mcu' shutdown: Timer too close", 1),
    ]


def test_without_snapmaker_orca_or_codes(moonraker, monkeypatch):
    """A plain Klipper printer (no exception_manager) and no Snapmaker Orca here: no codes, no words."""
    host, state = moonraker
    state["now"] = {"webhooks": {"state": "ready", "state_message": "Printer is ready"}, "print_stats": {"state": "standby"}}
    monkeypatch.setattr(errors.instances, "discover", lambda *a: [])
    errors._texts_cache.update(key=None, texts={})
    found = errors.read(host)
    assert (found["codes"], found["exceptions"], found["klipper"]) == (False, [], {"state": "ready", "message": "Printer is ready"})
    assert found["texts"] == {}


def test_the_api(server, moonraker, snorca):
    host, _ = moonraker
    camera.set_host("Snapmaker U1", host)
    status, body = call(f"{server}/api/printers/errors?model=Snapmaker%20U1")
    assert status == 200 and json.loads(body)["klipper"]["code"] == "0003-0522-0000-0018"
    assert call(f"{server}/api/printers/errors?model=Unbekannt")[0] == 404
