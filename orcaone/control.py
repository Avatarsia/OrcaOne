"""The page "Druck steuern" (the user's wish of 25.09.2026: everything about the running print in one
place), for any printer with Klipper and an address: what it prints, and on the user's click leave
one object out or pause at a layer. Pause, resume and cancel go through printer_files.py, as from
the top bar.

Klipper knows the objects of a print when the slicer labels them for it (option "Objekte
ausschließen", exclude_object; Snapmaker Orca's U1 processes have it on, fdm_process_U1_common.json):
their names and outlines come from EXCLUDE_OBJECT_DEFINE in the file (checked on the U1, 25.09.2026).
The pause at a layer is Mainsail's pair of macros SET_PAUSE_AT_LAYER and SET_PAUSE_NEXT_LAYER, which
keep their setting in the variables of SET_PRINT_STATS_INFO; the U1 has them, and the slicer writes
the layers with SET_PRINT_STATS_INFO CURRENT_LAYER=… A printer without them gets no pause at a layer.
"""

import re
import urllib.parse

from .camera import CameraError, _get
from .printer_files import _command

PAUSE_MACROS = ("SET_PAUSE_AT_LAYER", "SET_PAUSE_NEXT_LAYER", "SET_PRINT_STATS_INFO")
# A name Klipper takes after NAME= (EXCLUDE_OBJECT): nothing that splits or ends the line.
_NAME = re.compile(r"[^\s;\"'=]{1,200}")


def state(host: str) -> dict:
    """What the page shows: {"state", "file", "progress", "layer", "layers", "bed": [[x0, y0], [x1, y1]],
    "exclude": whether Klipper can leave objects out, "objects": [{"name", "center", "polygon",
    "excluded", "current"}], "pause": None or {"next": bool, "layer": int or None}}. layer and layers
    as the slicer writes them; bed as on "Status": the bed mesh widened by its margin, else the area
    the axes reach."""
    names = set(_get(host, "/printer/objects/list").get("objects") or [])
    wanted = ["print_stats", "virtual_sdcard=progress", "exclude_object", "toolhead=axis_minimum,axis_maximum",
              "bed_mesh=mesh_min,mesh_max"]
    pausing = all(f"gcode_macro {m}" in names for m in PAUSE_MACROS)
    if pausing:
        wanted.append("gcode_macro SET_PRINT_STATS_INFO=pause_next_layer,pause_at_layer")
    query = "&".join(urllib.parse.quote(w, safe="=,") for w in wanted if w.split("=")[0] in names)
    status = _get(host, "/printer/objects/query?" + query).get("status") or {}
    stats, excl = status.get("print_stats") or {}, status.get("exclude_object") or {}
    info = stats.get("info") if isinstance(stats.get("info"), dict) else {}
    gone, now = set(excl.get("excluded_objects") or []), excl.get("current_object")
    objects = [{"name": o["name"], "center": o.get("center"), "polygon": o.get("polygon") or [],
                "excluded": o["name"] in gone, "current": o["name"] == now}
               for o in excl.get("objects") or [] if isinstance(o, dict) and isinstance(o.get("name"), str)]
    pause = None
    if pausing:
        v = status.get("gcode_macro SET_PRINT_STATS_INFO") or {}
        at, following = v.get("pause_at_layer") or {}, v.get("pause_next_layer") or {}
        pause = {"next": bool(following.get("enable")), "layer": at.get("layer") if at.get("enable") else None}
    return {"state": stats.get("state"), "file": stats.get("filename") or None,
            "progress": (status.get("virtual_sdcard") or {}).get("progress"),
            "layer": info.get("current_layer"), "layers": info.get("total_layer"),
            "bed": _bed(status.get("toolhead") or {}, status.get("bed_mesh") or {}),
            "exclude": "exclude_object" in names, "objects": objects, "pause": pause}


def _bed(toolhead: dict, mesh: dict):
    """The bed from above; U1: mesh 3 to 267 mm, so the bed 0 to 270, the axes reach Y 335."""
    lo, hi = (toolhead.get("axis_minimum") or [])[:2], (toolhead.get("axis_maximum") or [])[:2]
    if len(lo) != 2 or len(hi) != 2 or not (hi[0] > lo[0] and hi[1] > lo[1]):
        return None
    m0, m1 = mesh.get("mesh_min") or [], mesh.get("mesh_max") or []
    if len(m0) == 2 and len(m1) == 2 and m1[0] > m0[0] and m1[1] > m0[1]:
        return [lo, [min(hi[0], m1[0] + m0[0] - lo[0]), min(hi[1], m1[1] + m0[1] - lo[1])]]
    return [lo, hi]


def exclude(host: str, name) -> dict:
    """Leaves one object of the running print out, the rest prints on; only an object the printer
    names now, so nothing else goes to Klipper."""
    if not isinstance(name, str) or not _NAME.fullmatch(name) or name not in {o["name"] for o in state(host)["objects"]}:
        raise CameraError("object_invalid")
    _command(host, "/printer/gcode/script", {"script": f"EXCLUDE_OBJECT NAME={name}"})
    return state(host)


def pause_at(host: str, layer=None, following=None) -> dict:
    """A pause after the layer printing now (following True, or False to take it back), else at the
    layer given (None takes it back)."""
    if following is not None:
        if not isinstance(following, bool):
            raise CameraError("pause_invalid")
        script = f"SET_PAUSE_NEXT_LAYER ENABLE={int(following)}"
    elif layer is None:
        script = "SET_PAUSE_AT_LAYER ENABLE=0"
    elif isinstance(layer, int) and not isinstance(layer, bool) and 1 <= layer <= 100000:
        script = f"SET_PAUSE_AT_LAYER ENABLE=1 LAYER={layer}"
    else:
        raise CameraError("pause_invalid")
    _command(host, "/printer/gcode/script", {"script": script})
    return state(host)
