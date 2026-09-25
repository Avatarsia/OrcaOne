"""The page "Status" (orcaone/monitor.py) against a small stand-in for Moonraker, never a real
printer: once as a plain Klipper printer, once with the objects of the U1 (as it answered on
24.09.2026)."""

import json
import math
import threading
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest

from conftest import call
from orcaone import camera, monitor

COMMON = {
    "webhooks": {"state": "ready", "state_message": "Printer is ready"},
    "print_stats": {"filename": "Benchy.gcode", "print_duration": 600.0, "filament_used": 1234.5, "state": "printing",
                    "message": "", "info": {"total_layer": 100, "current_layer": 12}},
    "display_status": {"progress": 0.25, "message": None},
    "gcode_move": {"speed_factor": 1.1, "extrude_factor": 0.95},
    "toolhead": {"extruder": "extruder", "homed_axes": "xyz", "max_velocity": 300.0, "max_accel": 5000.0, "position": [1, 2, 3, 4],
                 "axis_minimum": [0.0, 0.0, -6.0, 0.0], "axis_maximum": [271.0, 335.0, 275.0, 0.0]},
    "motion_report": {"live_velocity": 120.5, "live_extruder_velocity": 2.0, "live_position": [10.25, 20.5, 0.4, 100.0]},
    "heater_bed": {"temperature": 59.8, "target": 60.0, "power": 0.35},
    "bed_mesh": {"mesh_min": [3.0, 3.0], "mesh_max": [267.0, 267.0], "profile_name": "default", "probed_matrix": [[0.1]]},
}
PLAIN = {**COMMON,
         "heaters": {"available_heaters": ["heater_bed", "extruder"],
                     "available_sensors": ["heater_bed", "extruder", "temperature_sensor raspberry_pi"]},
         "extruder": {"temperature": 214.6, "target": 215.0, "power": 0.52, "pressure_advance": 0.04},
         "temperature_sensor raspberry_pi": {"temperature": 48.3, "measured_min_temp": 40.1, "measured_max_temp": 55.0},
         "fan": {"speed": 1.0, "rpm": None},
         "heater_fan hotend_fan": {"speed": 1.0, "rpm": 5400.0},
         "controller_fan electronics": {"speed": 0.5},
         "filament_switch_sensor runout": {"filament_detected": True, "enabled": True},
         "configfile": {"settings": {}}, "mcu": {"mcu_version": "v0.12"}}
U1 = {**COMMON,
      "heaters": {"available_heaters": ["heater_bed", "extruder", "extruder1"],
                  "available_sensors": ["heater_bed", "temperature_sensor cavity", "extruder", "extruder1"]},
      "extruder": {"temperature": 220.1, "target": 220.0, "power": 0.4, "pressure_advance": 0.022024, "nozzle_diameter": 0.4,
                   "switch_count": 665, "retry_count": 28, "error_count": 0},
      "extruder1": {"temperature": 23.0, "target": 0.0, "power": 0.0, "pressure_advance": 0.02, "nozzle_diameter": 0.4,
                    "switch_count": 12, "retry_count": 0, "error_count": 1},
      "temperature_sensor cavity": {"temperature": 24.0, "measured_min_temp": 21.0, "measured_max_temp": 26.0},
      "fan": {"speed": 0.8, "rpm": 7000.0}, "fan_generic e1_fan": {"speed": 0.0, "rpm": 0.0},
      "heater_fan e0_nozzle_fan": {"speed": 1.0, "rpm": 9000.0},
      "filament_motion_sensor e0_filament": {"filament_detected": True, "enabled": True},
      "filament_motion_sensor e1_filament": {"filament_detected": False, "enabled": True},
      "filament_entangle_detect e0_filament": {"detect_factor": 1.0},
      "print_task_config": {"filament_exist": [True, False], "filament_type": ["PLA", ""], "filament_sub_type": ["Matte", ""],
                            "filament_vendor": ["Snapmaker", ""], "filament_color_rgba": ["FFFFFFFF", ""],
                            "auto_bed_leveling": True, "flow_calibrate": False, "shaper_calibrate": False, "time_lapse_camera": True},
      "led cavity_led": {"color_data": [[0.0, 0.0, 0.0, 1.0]]},
      # The drivers of X and Y measure their own temperature, but only while the motors are on.
      "tmc2240 stepper_x": {"temperature": 41.5, "run_current": 1.2}, "tmc2240 stepper_y": {"temperature": None, "run_current": 1.2},
      "tmc2209 stepper_z": {"run_current": 0.8}}
SYSTEM = {"cpu_temp": 40.1, "system_cpu_usage": {"cpu": 3.8}, "system_uptime": 21980.0,
          "system_memory": {"total": 984740, "available": 770828, "used": 213912},
          "network": {"lo": {"rx_bytes": 10, "bandwidth": 1.0}, "wlan0": {"rx_bytes": 964, "bandwidth": 379.4},
                      "wlan1": {"rx_bytes": 0, "bandwidth": 0.0}}}


@pytest.fixture
def moonraker():
    """A printer with the objects of `printer[0]`; the objects Klipper was asked for land in `asked`."""
    printer, asked = [PLAIN], []

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            url = urllib.parse.urlparse(self.path)
            if url.path == "/printer/objects/list":
                result = {"objects": list(printer[0])}
            elif url.path == "/printer/objects/query":
                names = [urllib.parse.unquote(part.split("=")[0]) for part in url.query.split("&")]
                asked.append(names)
                result = {"eventtime": 1.0, "status": {n: printer[0][n] for n in names if n in printer[0]}}
            elif url.path == "/machine/proc_stats":
                result = SYSTEM
            elif url.path == "/server/files/metadata":
                result = {"estimated_time": 3600}
            else:
                result = None
            body = json.dumps({"result": result}).encode()
            self.send_response(200 if result is not None else 404)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *args):
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    yield f"127.0.0.1:{server.server_address[1]}", printer, asked
    server.shutdown()


def test_a_plain_klipper_printer(moonraker):
    host, _, asked = moonraker
    got = monitor.read(host)
    # One query, with the objects found by their kind; nothing it did not need.
    assert len(asked) == 1 and "configfile" not in asked[0] and "mcu" not in asked[0]
    assert {"extruder", "heater_bed", "fan", "heater_fan hotend_fan", "filament_switch_sensor runout"} <= set(asked[0])
    assert got["klipper"] == {"state": "ready", "message": "Printer is ready"}
    job = got["job"]
    assert (job["state"], job["file"], job["progress"], job["layer"], job["layers"]) == ("printing", "Benchy.gcode", 0.25, 12, 100)
    assert (job["left"], job["filament"], job["speed_factor"], job["flow_factor"]) == (3000.0, 1234.5, 1.1, 0.95)
    assert job["options"] is None and job["light"] is None
    # Klipper's own order, heaters with target and power, a sensor with what it measured.
    assert [t["name"] for t in got["temperatures"]] == ["heater_bed", "extruder", "temperature_sensor raspberry_pi"]
    assert got["temperatures"][1] == {"name": "extruder", "temp": 214.6, "target": 215.0, "power": 0.52, "min": None, "max": None}
    assert got["temperatures"][2] == {"name": "temperature_sensor raspberry_pi", "temp": 48.3, "target": None, "power": None,
                                      "min": 40.1, "max": 55.0}
    assert got["fans"] == [{"name": "fan", "speed": 1.0, "rpm": None}, {"name": "heater_fan hotend_fan", "speed": 1.0, "rpm": 5400.0},
                           {"name": "controller_fan electronics", "speed": 0.5, "rpm": None}]
    assert got["filament"] == [{"name": "filament_switch_sensor runout", "detected": True, "enabled": True}]
    assert [(h["extruder"], h["pa"], h["spool"], h["changes"]) for h in got["heads"]] == [("extruder", 0.04, None, None)]
    motion = got["motion"]
    assert (motion["speed"], motion["position"], motion["homed"]) == (120.5, [10.25, 20.5, 0.4], "xyz")
    assert (motion["min"], motion["max"]) == ([0.0, 0.0, -6.0], [271.0, 335.0, 275.0])
    assert motion["mesh"] == [[3.0, 3.0], [267.0, 267.0]]
    assert motion["flow"] == pytest.approx(2.0 * math.pi * 0.875 ** 2)
    system = got["system"]
    assert (system["cpu"], system["cpu_temp"], system["uptime"]) == (3.8, 40.1, 21980.0)
    assert system["memory"] == {"total": 984740, "used": 213912}
    assert system["network"] == [{"name": "wlan0", "bandwidth": 379.4}]


def test_the_u1_shows_more(moonraker):
    host, printer, _ = moonraker
    printer[0] = U1
    got = monitor.read(host)
    first, second = got["heads"]
    assert (first["spool"]["type"], first["nozzle"], first["changes"], first["retries"], first["errors"]) == ("PLA", 0.4, 665, 28, 0)
    assert (second["spool"], second["changes"], second["errors"]) == (None, 12, 1)
    assert got["job"]["options"] == {"bed_level": True, "flow_calibrate": False, "shaper_calibrate": False, "time_lapse_camera": True}
    assert got["job"]["light"] is True
    assert [t["name"] for t in got["temperatures"]] == ["heater_bed", "temperature_sensor cavity", "extruder", "extruder1",
                                                        "tmc2240 stepper_x", "tmc2240 stepper_y"]
    assert [(t["temp"], t.get("driver")) for t in got["temperatures"][-2:]] == [(41.5, True), (None, True)]
    assert [f["name"] for f in got["fans"]] == ["fan", "fan_generic e1_fan", "heater_fan e0_nozzle_fan"]
    assert [(f["name"], f["detected"]) for f in got["filament"]] == [
        ("filament_motion_sensor e0_filament", True), ("filament_motion_sensor e1_filament", False)]


def test_without_the_computer_inside(moonraker, monkeypatch):
    # Moonraker without /machine/proc_stats: the page shows the rest.
    host, _, _ = moonraker
    real = monitor._get
    monkeypatch.setattr(monitor, "_get", lambda h, path: real(h, "/nothing") if path == "/machine/proc_stats" else real(h, path))
    got = monitor.read(host)
    assert got["system"] == {"cpu": None, "cpu_temp": None, "memory": {"total": None, "used": None}, "uptime": None, "network": []}


def test_api(server, moonraker):
    host, _, _ = moonraker
    camera.set_host("MyKlipper", host)
    status, body = call(f"{server}/api/printers/monitor?model=MyKlipper")
    assert status == 200 and json.loads(body)["job"]["file"] == "Benchy.gcode"
    assert call(f"{server}/api/printers/monitor?model=Unbekannt")[0] == 404


def test_the_bed_mesh(server, moonraker):
    """The page "Höhenkarte": the mesh Klipper uses, as the U1 gave it on 25.09.2026 (trimmed to 3 x 3)."""
    host, printer, _ = moonraker
    camera.set_host("MyKlipper", host)
    printer[0] = {k: v for k, v in PLAIN.items() if k != "bed_mesh"}
    assert monitor.mesh(host) == {"profile": None, "min": None, "max": None, "probed": None, "smooth": None, "profiles": [], "known": False}
    printer[0] = {**PLAIN, "bed_mesh": {
        "profile_name": "default", "mesh_min": [3.0, 3.0], "mesh_max": [267.0, 267.0],
        "probed_matrix": [[0.002, -0.025, -0.007], [0.01, 0.0, 0.139], [-0.114, 0.02, 0.03]],
        "mesh_matrix": [[0.002, -0.01], [0.01, 0.02]], "profiles": {"default": {}, "warm": {}}}}
    status, body = call(f"{server}/api/printers/mesh?model=MyKlipper")
    got = json.loads(body)
    assert status == 200 and (got["profile"], got["min"], got["max"], got["profiles"], got["known"]) == (
        "default", [3.0, 3.0], [267.0, 267.0], ["default", "warm"], True)
    assert got["probed"][2][0] == -0.114 and len(got["smooth"]) == 2
    # Klipper without a mesh loaded: nothing to draw, but it knows [bed_mesh].
    printer[0]["bed_mesh"] = {"profile_name": "", "probed_matrix": [[]], "mesh_matrix": [[]], "profiles": {}}
    assert (monitor.mesh(host)["probed"], monitor.mesh(host)["known"]) == (None, True)
