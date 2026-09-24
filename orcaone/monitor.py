"""The page "Status" (the user's wish of 24.09.2026): what a printer with Klipper and Moonraker is
doing right now, for any Klipper printer with an address. Read only; per look Klipper's list of
objects, one query of those shown, and Moonraker's view of the computer inside
(/machine/proc_stats). Checked on the U1 on 24.09.2026: 196 objects, four heads with a part fan,
a hotend fan and a filament sensor each. Klipper names its heaters and temperature sensors itself
(heaters: available_heaters, available_sensors); fans and filament sensors are found by the kind
of object, the first word of its name.

No charts: Moonraker keeps the temperatures of the last 20 minutes for them
(/server/temperature_store), a topic of its own (the user).
"""

import math
import re

from . import camera, printer_files
from .camera import CameraError, _get, _part

FANS = ("fan", "fan_generic", "heater_fan", "controller_fan", "temperature_fan")
FILAMENT_SENSORS = ("filament_switch_sensor", "filament_motion_sensor")
TEMPERATURES = ("heater_bed", "heater_generic", "temperature_sensor", "temperature_fan")
EXTRUDER = re.compile(r"extruder\d*")
# Always asked for, the objects of camera.status among them; what a printer lacks is missing in
# the answer.
FIXED = ["webhooks", "print_stats", "display_status", "gcode_move", "toolhead", "motion_report", "heaters",
         "print_task_config", "filament_detect", "led cavity_led"]
# mm² of 1.75 mm filament, as on the U1: the flow from the speed of the extruder. Klipper keeps the
# diameter in its configuration only, which is too big to read every two seconds.
FILAMENT_AREA = math.pi * (1.75 / 2) ** 2


def _number(value):
    return value if isinstance(value, (int, float)) and not isinstance(value, bool) else None


def _kind(name: str) -> str:
    return name.split(" ", 1)[0]


def read(host: str) -> dict:
    """Raises CameraError if the printer does not answer; the computer inside is optional."""
    listed = _get(host, "/printer/objects/list").get("objects") or []
    extruders = [o for o in listed if EXTRUDER.fullmatch(o)]
    temps = [o for o in listed if _kind(o) in TEMPERATURES]
    fans = [o for o in listed if _kind(o) in FANS]
    sensors = [o for o in listed if _kind(o) in FILAMENT_SENSORS]
    found = camera.query(host, list(dict.fromkeys(FIXED + extruders + temps + fans + sensors)))

    def part(name):
        return _part(found, name)

    job = camera.status_of(host, found)
    heads = job.pop("heads")
    # Per head what Klipper counts on the U1 (tool changes, retries, errors), and the nozzle.
    for h in heads:
        e = part(h["extruder"])
        h.update(nozzle=_number(e.get("nozzle_diameter")), changes=_number(e.get("switch_count")),
                 retries=_number(e.get("retry_count")), errors=_number(e.get("error_count")))
    heaters = part("heaters")
    heating = set(heaters.get("available_heaters") or [])
    temperatures = []
    # In Klipper's order; without its "heaters" object the ones found by kind. A sensor also keeps
    # the lowest and highest temperature it measured since Klipper started.
    for name in heaters.get("available_sensors") or extruders + temps:
        t = part(name)
        temperatures.append({"name": name, "temp": _number(t.get("temperature")),
                             "target": _number(t.get("target")) if name in heating else None,
                             "power": _number(t.get("power")) if name in heating else None,
                             "min": _number(t.get("measured_min_temp")), "max": _number(t.get("measured_max_temp"))})
    # The U1: the options of the display for this print (printer_files.OPTIONS), None elsewhere.
    task = part("print_task_config")
    options = {o: task.get(key) is True for o, key in printer_files.OPTIONS.items()} if task else None
    stats, gcode, toolhead, motion = part("print_stats"), part("gcode_move"), part("toolhead"), part("motion_report")
    extrusion = _number(motion.get("live_extruder_velocity"))
    position = motion.get("live_position") or toolhead.get("position") or []
    webhooks = part("webhooks")
    try:
        system = _get(host, "/machine/proc_stats")
    except CameraError:
        system = {}
    memory = system.get("system_memory") if isinstance(system.get("system_memory"), dict) else {}
    network = system.get("network") if isinstance(system.get("network"), dict) else {}
    return {
        "klipper": {"state": webhooks.get("state"), "message": webhooks.get("state_message") or None},
        "job": {**job, "filament": _number(stats.get("filament_used")), "message": stats.get("message") or None,
                "speed_factor": _number(gcode.get("speed_factor")), "flow_factor": _number(gcode.get("extrude_factor")),
                "options": options},
        "heads": heads,
        "temperatures": temperatures,
        "fans": [{"name": n, "speed": _number(part(n).get("speed")), "rpm": _number(part(n).get("rpm"))} for n in fans],
        "filament": [{"name": n, "detected": part(n).get("filament_detected"), "enabled": part(n).get("enabled")} for n in sensors],
        "motion": {"speed": _number(motion.get("live_velocity")),
                   "flow": extrusion * FILAMENT_AREA if extrusion is not None else None,
                   "position": [_number(v) for v in position[:3]], "homed": toolhead.get("homed_axes") or "",
                   "max_velocity": _number(toolhead.get("max_velocity")), "max_accel": _number(toolhead.get("max_accel"))},
        "system": {"cpu": _number((system.get("system_cpu_usage") or {}).get("cpu")), "cpu_temp": _number(system.get("cpu_temp")),
                   "memory": {"total": _number(memory.get("total")), "used": _number(memory.get("used"))},
                   "uptime": _number(system.get("system_uptime")),
                   # Only interfaces that carried something: the U1 lists an unused second WLAN.
                   "network": [{"name": name, "bandwidth": _number(i.get("bandwidth"))} for name, i in network.items()
                               if name != "lo" and isinstance(i, dict) and i.get("rx_bytes")]},
    }
