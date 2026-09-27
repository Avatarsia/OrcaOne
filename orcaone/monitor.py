"""The page "Status" (the user's wish of 24.09.2026): what a printer with Klipper and Moonraker is
doing right now, for any Klipper printer with an address. Read only; per look Klipper's list of
objects, one query of those shown, and Moonraker's view of the computer inside
(/machine/proc_stats). Checked on the U1 on 24.09.2026: 196 objects, four heads with a part fan,
a hotend fan and a filament sensor each. Klipper names its heaters and temperature sensors itself
(heaters: available_heaters, available_sensors); fans and filament sensors are found by the kind
of object, the first word of its name.

No charts: Moonraker keeps the temperatures of the last 20 minutes for them
(/server/temperature_store), a topic of its own (the user).

The page "Höhenkarte" (the user's wish of 25.09.2026) reads the bed mesh Klipper uses (mesh()).
"""

import math
import re

from . import camera, errors, printer_files
from .camera import CameraError, _get, _part

FANS = ("fan", "fan_generic", "heater_fan", "controller_fan", "temperature_fan")
FILAMENT_SENSORS = ("filament_switch_sensor", "filament_motion_sensor")
TEMPERATURES = ("heater_bed", "heater_generic", "temperature_sensor", "temperature_fan")
EXTRUDER = re.compile(r"extruder\d*")
# Stepper drivers with a thermometer of their own (the user missed them, 25.09.2026): Klipper lists
# them under available_monitors and reads them only while the motors are on, else None (the U1's
# X and Y, checked 25.09.2026).
MONITORS = ("tmc2240",)
# Always asked for, the objects of camera.status among them; what a printer lacks is missing in
# the answer. Of toolhead, gcode_move and motion_report only the fields shown: subscribed whole
# (live.py), toolhead's print times alone change four times a second at rest. Its stalls count how
# often the moves ran dry (marks on "Diagramme", history.py).
FIXED = ["webhooks", "print_stats", "display_status", "gcode_move=speed_factor,extrude_factor",
         "toolhead=extruder,homed_axes,position,axis_minimum,axis_maximum,max_velocity,max_accel,stalls",
         "motion_report=live_position,live_velocity,live_extruder_velocity", "heaters",
         "print_task_config", "filament_detect", "led cavity_led", "bed_mesh=mesh_min,mesh_max", "virtual_sdcard=file_position",
         "exception_manager"]   # the U1's error codes that stay until acknowledged (orcaone/errors.py)
# mm² of 1.75 mm filament, as on the U1: the flow from the speed of the extruder. Klipper keeps the
# diameter in its configuration only, which is too big to read every two seconds.
FILAMENT_AREA = math.pi * (1.75 / 2) ** 2


def _number(value):
    return value if isinstance(value, (int, float)) and not isinstance(value, bool) else None


def _kind(name: str) -> str:
    return name.split(" ", 1)[0]


def _groups(listed: list) -> tuple[list, list, list, list, list]:
    """Heads, temperatures, fans, filament sensors and drivers with a thermometer in Klipper's list."""
    return ([o for o in listed if EXTRUDER.fullmatch(o)], [o for o in listed if _kind(o) in TEMPERATURES],
            [o for o in listed if _kind(o) in FANS], [o for o in listed if _kind(o) in FILAMENT_SENSORS],
            [o for o in listed if _kind(o) in MONITORS])


def _mcus(listed: list) -> list[str]:
    """The microcontrollers Klipper talks to: "mcu", on the U1 also "mcu e0" … one per head."""
    return [o for o in listed if o == "mcu" or o.startswith("mcu ")]


def objects(listed: list) -> list[str]:
    """What the page shows, as Klipper's objects "name" or "name=field,…", from Klipper's list: asked
    for once here (read), subscribed to for live values (live.py)."""
    extruders, temps, fans, sensors, monitors = _groups(listed)
    return list(dict.fromkeys(FIXED + extruders + temps + fans + sensors + [f"{m}=temperature" for m in monitors]
                              + [f"{m}=last_stats" for m in _mcus(listed)]))


def read(host: str) -> dict:
    """Raises CameraError if the printer does not answer; the computer inside is optional."""
    listed = _get(host, "/printer/objects/list").get("objects") or []
    found = camera.query(host, objects(listed))
    try:
        system = _get(host, "/machine/proc_stats")
    except CameraError:
        system = {}
    return shape(host, listed, found, system)


def shape(host: str, listed: list, found: dict, system: dict) -> dict:
    """The page's values from Klipper's objects as read (found) and the computer inside (system,
    /machine/proc_stats or its notifications)."""
    extruders, temps, fans, sensors, monitors = _groups(listed)

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
    for name in monitors:
        temperatures.append({"name": name, "temp": _number(part(name).get("temperature")), "target": None, "power": None,
                             "min": None, "max": None, "driver": True})
    # The U1: the options of the display for this print (printer_files.OPTIONS), None elsewhere.
    task = part("print_task_config")
    options = {o: task.get(key) is True for o, key in printer_files.OPTIONS.items()} if task else None
    stats, gcode, toolhead, motion = part("print_stats"), part("gcode_move"), part("toolhead"), part("motion_report")
    mesh = part("bed_mesh")
    extrusion = _number(motion.get("live_extruder_velocity"))
    position = motion.get("live_position") or toolhead.get("position") or []
    webhooks = part("webhooks")
    memory = system.get("system_memory") if isinstance(system.get("system_memory"), dict) else {}
    # Moonraker's own time of its counters: a list of the last 30 from machine.proc_stats, one from
    # notify_proc_stat_update. The charts divide the traffic by it (history._traffic).
    moonraker = system.get("moonraker_stats")
    moonraker = moonraker[-1] if isinstance(moonraker, list) and moonraker else moonraker if isinstance(moonraker, dict) else {}
    network = system.get("network") if isinstance(system.get("network"), dict) else {}
    # The load of each microcontroller as Klipper's scripts/graphstats.py reckons it (the formula only):
    # one pass of its task loop on average plus three times its spread, against 2.5 ms; awake: of the
    # 5 s it reports over, the share it worked (the user's wish of 27.09.2026).
    mcus = []
    for name in _mcus(listed):
        s = part(name).get("last_stats") if isinstance(part(name).get("last_stats"), dict) else {}
        avg, dev, awake = _number(s.get("mcu_task_avg")), _number(s.get("mcu_task_stddev")), _number(s.get("mcu_awake"))
        # The counters of trouble on its line since the connection, for the charts (history.py makes rates of
        # them over "at", Klipper's time of these statistics, live.py): bytes sent again, bytes that arrived
        # broken, and on the U1 its own receive errors (err_len, err_dest, err_sync, err_crc).
        faults = [_number(v) for k, v in s.items() if k.startswith("err_")]
        mcus.append({"name": name, "load": round((avg + 3 * dev) / 0.0025 * 100, 1) if avg is not None and dev is not None else None,
                     "awake": round(awake / 5 * 100, 1) if awake is not None else None,
                     "retransmit": _number(s.get("bytes_retransmit")), "invalid": _number(s.get("bytes_invalid")),
                     "errors": sum(faults) if faults and None not in faults else None, "at": _number(part(name).get("stats_at"))})
    return {
        # The U1's shutdown message begins with {"coded": ...}: its code and words apart.
        "klipper": dict(zip(("code", "message"), errors.split_coded(webhooks.get("state_message"))), state=webhooks.get("state")),
        # Klipper's objects known: false while Moonraker answers but cannot reach Klipper (live.py puts a
        # state of its own then), so the marks on "Diagramme" take nothing of it for Klipper's (history.py).
        "listed": bool(listed),
        "exceptions": [{k: e[k] for k in ("code", "level", "message")} for e in
                       map(errors._exception, part("exception_manager").get("exceptions") or []) if e],
        "job": {**job, "filament": _number(stats.get("filament_used")), "message": stats.get("message") or None,
                # Seconds since the print started, pauses included: the span "Dieser Druck" of "Diagramme".
                "elapsed": _number(stats.get("total_duration")),
                # How often the moves ran dry since Klipper started: the printer stood waiting for G-code.
                "stalls": _number(toolhead.get("stalls")),
                "speed_factor": _number(gcode.get("speed_factor")), "flow_factor": _number(gcode.get("extrude_factor")),
                "options": options},
        "heads": heads,
        "temperatures": temperatures,
        "fans": [{"name": n, "speed": _number(part(n).get("speed")), "rpm": _number(part(n).get("rpm"))} for n in fans],
        "filament": [{"name": n, "detected": part(n).get("filament_detected"), "enabled": part(n).get("enabled")} for n in sensors],
        "motion": {"speed": _number(motion.get("live_velocity")),
                   "flow": extrusion * FILAMENT_AREA if extrusion is not None else None,
                   "position": [_number(v) for v in position[:3]], "homed": toolhead.get("homed_axes") or "",
                   # Where the head can go (U1: X 0 to 271, Y 0 to 335, Z -6 to 275 mm), for the map of the bed.
                   "min": [_number(v) for v in (toolhead.get("axis_minimum") or [])[:3]],
                   "max": [_number(v) for v in (toolhead.get("axis_maximum") or [])[:3]],
                   # The area the bed mesh covers (U1: 3 to 267 mm): nearly the whole bed, while the axes
                   # reach further, on the U1 to the heads parked behind it (Y 335).
                   "mesh": [[_number(v) for v in mesh.get(k) or []] for k in ("mesh_min", "mesh_max")],
                   "max_velocity": _number(toolhead.get("max_velocity")), "max_accel": _number(toolhead.get("max_accel"))},
        "mcus": mcus,
        "system": {"cpu": _number((system.get("system_cpu_usage") or {}).get("cpu")), "cpu_temp": _number(system.get("cpu_temp")),
                   # Each core ("cpu0" …), the pages that watch Moonraker, and Moonraker's own share (tab "System" on "Status")
                   "cores": [_number(v) for k, v in sorted((system.get("system_cpu_usage") or {}).items(),
                                                           key=lambda kv: int(kv[0][3:]) if re.fullmatch(r"cpu\d+", kv[0]) else -1)
                             if re.fullmatch(r"cpu\d+", k)],
                   "websockets": _number(system.get("websocket_connections")),
                   "moonraker": {"cpu": _number(moonraker.get("cpu_usage")), "memory": _number(moonraker.get("memory"))},
                   "memory": {"total": _number(memory.get("total")), "used": _number(memory.get("used"))},
                   "uptime": _number(system.get("system_uptime")), "time": _number(moonraker.get("time")),
                   # Only interfaces that carried something: the U1 lists an unused second WLAN.
                   # rx and tx count up; the page "Netzwerk" draws the traffic from them.
                   "network": [{"name": name, "bandwidth": _number(i.get("bandwidth")), "rx": _number(i.get("rx_bytes")),
                                "tx": _number(i.get("tx_bytes")), "errors": _sum(i, "rx_errs", "tx_errs"), "drops": _sum(i, "rx_drop", "tx_drop")}
                               for name, i in network.items() if name != "lo" and isinstance(i, dict) and i.get("rx_bytes")]},
    }


def _sum(found: dict, *keys) -> float | None:
    """Moonraker's counters of an interface added up; None if it gives none of them."""
    values = [_number(found.get(k)) for k in keys]
    return sum(v for v in values if v is not None) if any(v is not None for v in values) else None


def mesh(host: str) -> dict:
    """The bed mesh Klipper uses now, read only: {"profile", "min": [x, y], "max": [x, y], "probed":
    rows of heights from the front, "smooth": the same interpolated, "profiles": the names it keeps};
    probed None without [bed_mesh] or before a mesh is loaded. The U1 probes 11 x 11 points from 3 to
    267 mm when a print starts with "Bett vermessen" and interpolates 31 x 31 (checked 25.09.2026)."""
    names = set(_get(host, "/printer/objects/list").get("objects") or [])
    found = {}
    if "bed_mesh" in names:
        found = (_get(host, "/printer/objects/query?bed_mesh").get("status") or {}).get("bed_mesh") or {}

    def matrix(rows):
        rows = [[_number(v) for v in row] for row in rows or [] if isinstance(row, list)]
        return rows if rows and rows[0] and all(len(r) == len(rows[0]) and None not in r for r in rows) else None

    return {"profile": found.get("profile_name") or None, "min": found.get("mesh_min"), "max": found.get("mesh_max"),
            "probed": matrix(found.get("probed_matrix")), "smooth": matrix(found.get("mesh_matrix")),
            "profiles": sorted(found.get("profiles") or {}), "known": "bed_mesh" in names}
