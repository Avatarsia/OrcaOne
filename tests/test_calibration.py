"""The page "Kalibrieren": its ticks (orcaone/calibration.py) and what it reads from the printer
(camera.status) against a small stand-in for Moonraker, never a real printer."""

import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest

from conftest import call, copy_fixture
from orcaone import calibration, camera

# Trimmed from the answer of the user's U1 on 23.09.2026: heads 1 to 3 with an RFID spool, head 4
# with a spool typed in at the printer and a measured pressure advance.
TAG = {"VENDOR": "Snapmaker", "MANUFACTURER": "Polymaker", "MAIN_TYPE": "PLA", "SUB_TYPE": "Matte",
       "HOTEND_MIN_TEMP": 190, "HOTEND_MAX_TEMP": 230, "OTHER_LAYER_TEMP": 220, "DRYING_TEMP": 55, "DRYING_TIME": 6}
STATUS = {
    **{name: {"pressure_advance": 0.02, "temperature": 22.0, "target": 0.0} for name in camera.HEADS[:3]},
    "extruder3": {"pressure_advance": 0.017665, "temperature": 22.0, "target": 0.0},
    "print_stats": {"state": "complete", "filename": "Puzzel_Schwarz_PLA_1h28m.gcode", "print_duration": 5333.19,
                    "total_duration": 5556.51, "info": {"total_layer": 19, "current_layer": 19}},
    "display_status": {"progress": 1.0},
    "heater_bed": {"temperature": 20.0, "target": 0.0},
    "temperature_sensor cavity": {"temperature": 24.0},
    "toolhead": {"extruder": "extruder"},
    "print_task_config": {
        "filament_vendor": ["Snapmaker"] * 4, "filament_type": ["PLA"] * 4,
        "filament_sub_type": ["Matte", "SnapSpeed", "SnapSpeed", "Basic"],
        "filament_color_rgba": ["FFFFFFFF", "080A0DFF", "E72F1DFF", "F78E0EFF"],
        "filament_exist": [True, True, True, True], "flow_calibrate": False, "flow_calib_extruders": [True] * 4,
    },
    "filament_detect": {"info": [TAG, TAG, TAG, {"VENDOR": "NONE", "HOTEND_MIN_TEMP": 0}]},
}
# Trimmed from /server/files/metadata of that print: the slicer's time for the whole file.
METADATA = {"slicer": "SnapmakerOrca", "estimated_time": 5289, "layer_count": 19}


@pytest.fixture
def moonraker():
    """Answers /printer/objects/query with STATUS and /server/files/metadata with METADATA, a file
    called Fehlt.gcode with 404; the paths asked for land in `asked`."""
    asked = []

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            asked.append(self.path)
            if self.path.startswith("/server/files/metadata"):
                result = None if "Fehlt" in self.path else METADATA
            else:
                result = {"eventtime": 1.0, "status": STATUS}
            body = json.dumps({"result": result}).encode()
            self.send_response(200 if result else 404)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *args):
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    yield f"127.0.0.1:{server.server_address[1]}", asked
    server.shutdown()


def test_status_of_the_printer(moonraker):
    host, asked = moonraker
    got = camera.status(host)
    assert asked[0].startswith("/printer/objects/query?extruder=pressure_advance")
    assert (got["state"], got["file"], got["progress"], got["active"], got["flow_calibrate"]) == (
        "complete", "Puzzel_Schwarz_PLA_1h28m.gcode", 1.0, "extruder", False)
    first, last = got["heads"][0], got["heads"][3]
    assert first["spool"] == {"vendor": "Snapmaker", "type": "PLA", "subtype": "Matte", "colour": "#FFFFFF", "rfid": True,
                              "maker": "Polymaker", "temp_min": 190, "temp_max": 230, "temp": 220, "dry_temp": 55, "dry_hours": 6}
    # Without a tag the spool is what was typed in at the printer, nothing more.
    assert last["spool"] == {"vendor": "Snapmaker", "type": "PLA", "subtype": "Basic", "colour": "#F78E0E", "rfid": False}
    assert (last["extruder"], last["pa"], last["calibrate"]) == ("extruder3", 0.017665, True)


def test_whether_the_light_is_on(moonraker, monkeypatch):
    # The U1 on 24.09.2026: the LED off, the camera sent a black picture.
    host, _ = moonraker
    assert camera.status(host)["light"] is None   # a printer without that LED
    monkeypatch.setitem(STATUS, "led cavity_led", {"color_data": [[0.0, 0.0, 0.0, 0.0]]})
    assert camera.status(host)["light"] is False
    monkeypatch.setitem(STATUS, "led cavity_led", {"color_data": [[0.0, 0.0, 0.0, 1.0]]})
    assert camera.status(host)["light"] is True


def test_print_progress(moonraker, monkeypatch):
    """What the page "Kamera" shows about a print: layer, time printed and left, temperatures."""
    host, asked = moonraker
    got = camera.status(host)
    assert (got["layer"], got["layers"], got["printed"], got["left"]) == (19, 19, 5333.19, None)   # done, nothing left
    assert got["bed"] == {"temp": 20.0, "target": 0.0} and got["cavity"] == 24.0

    running = {"state": "printing", "filename": "Puzzel.gcode", "print_duration": 1289.0, "info": {"total_layer": 19, "current_layer": 5}}
    monkeypatch.setitem(STATUS, "print_stats", running)
    monkeypatch.setitem(STATUS, "display_status", {"progress": 0.25})
    asked.clear()
    assert camera.status(host)["left"] == camera.status(host)["left"] == 4000   # 5289 by the slicer minus 1289 printed
    assert [p for p in asked if p.startswith("/server/files/metadata")] == ["/server/files/metadata?filename=Puzzel.gcode"]
    # A file without the slicer's time, or one Moonraker does not know: from the progress.
    monkeypatch.setitem(STATUS, "print_stats", {**running, "filename": "Fehlt.gcode"})
    assert camera.status(host)["left"] == 1289 / 0.25 - 1289
    monkeypatch.delitem(METADATA, "estimated_time")
    monkeypatch.setitem(STATUS, "print_stats", {**running, "filename": "Ohne Zeit.gcode"})
    assert camera.status(host)["left"] == 1289 / 0.25 - 1289
    assert asked[-1] == "/server/files/metadata?filename=Ohne%20Zeit.gcode"


def test_status_of_an_unreachable_printer():
    with pytest.raises(camera.CameraError) as err:
        camera.status("127.0.0.1:9")
    assert err.value.code == "camera_unreachable"


def test_ticks():
    assert calibration.state("inst1") == {"printer": {}, "filaments": {}}
    got = calibration.mark("inst1", "Mein PLA", "flow", True, 220)
    assert got["filaments"]["Mein PLA"]["flow"]["temp"] == 220 and "date" in got["filaments"]["Mein PLA"]["flow"]
    got = calibration.mark("inst1", None, "machine", True)
    assert list(got["printer"]) == ["machine"] and "temp" not in got["printer"]["machine"]
    # Each installation has its own ticks.
    other = calibration.mark("inst2", "Mein PLA", "pa", True)
    assert list(other["filaments"]) == ["Mein PLA"] and other["printer"] == {}
    # Taking the last tick back removes the filament.
    assert calibration.mark("inst1", "Mein PLA", "flow", False)["filaments"] == {}
    assert calibration.state("inst1")["printer"]["machine"]["date"]
    for args in (("Mein PLA", "machine", True), (None, "flow", True), ("", "flow", True), ("Mein PLA", "flow", "yes"),
                 ("Mein PLA", "flow", True, "220"), ("Mein PLA", "flow", True, True), (1, "flow", True)):
        with pytest.raises(calibration.CalibrationError):
            calibration.mark("inst1", *args)


def test_api(server, fake_home, moonraker):
    copy_fixture("snorca", fake_home / ".config" / "Snapmaker_Orca")
    inst = json.loads(call(f"{server}/api/data")[1])["instances"][0]
    base = f"{server}/api/instances/{inst['id']}/calibration"
    assert json.loads(call(base)[1]) == {"printer": {}, "filaments": {}}
    status, body = call(base, "POST", {"filament": "Mein PLA", "step": "pa", "done": True, "temp": 215})
    assert status == 200 and json.loads(body)["filaments"]["Mein PLA"]["pa"]["temp"] == 215
    assert json.loads(call(base)[1])["filaments"]["Mein PLA"]["pa"]["temp"] == 215
    status, body = call(base, "POST", {"filament": "Mein PLA", "step": "nope", "done": True})
    assert (status, json.loads(body)) == (400, {"error": "calibration_invalid"})
    assert call(f"{server}/api/instances/nope/calibration", "POST", {"step": "machine", "done": True})[0] == 404

    host, _ = moonraker
    call(f"{server}/api/printers", "POST", {"model": "Snapmaker U1", "host": host})
    cam = json.loads(call(f"{server}/api/cameras")[1])["cameras"][0]
    status, body = call(f"{server}/api/cameras/{cam['id']}/status")
    assert status == 200 and json.loads(body)["heads"][3]["pa"] == 0.017665
