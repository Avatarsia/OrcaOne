"""Ticks of the page "Kalibrieren", which follows the user's guide (prototypes/U1 Filament
Kalibrierung.md). Per installation in data/settings.json, section "calibration":
{"<installation>": {"printer": {"<step>": {"date": "2026-09-23"}},
                    "filaments": {"<filament>": {"<step>": {"date": "2026-09-23", "temp": 220}}}}}
temp is the nozzle temperature when the step was ticked: flow ratio and pressure advance hold for
that temperature only, so the page asks for them again once the profile has another one.
"""

from datetime import date

from . import settings

PRINTER_STEPS = ("connect", "spread", "machine")
FILAMENT_STEPS = ("dry", "temp", "flow", "pa", "mvs", "retraction", "shrink")


class CalibrationError(Exception):
    """calibration_invalid: an unknown step, or a value of the wrong type."""


def _dict(parent: dict, key: str) -> dict:
    if not isinstance(parent.get(key), dict):
        parent[key] = {}
    return parent[key]


def state(instance_id: str) -> dict:
    data = settings.load()
    mine = _dict(_dict(data, "calibration"), instance_id)
    return {"printer": _dict(mine, "printer"), "filaments": _dict(mine, "filaments")}


def mark(instance_id: str, filament, step, done, temp=None) -> dict:
    """Ticks a step (done=True) or takes the tick back; filament None is a step of the printer."""
    if filament is None:
        if step not in PRINTER_STEPS:
            raise CalibrationError("calibration_invalid")
    elif not isinstance(filament, str) or not filament or step not in FILAMENT_STEPS:
        raise CalibrationError("calibration_invalid")
    if not isinstance(done, bool) or temp is not None and (isinstance(temp, bool) or not isinstance(temp, (int, float))):
        raise CalibrationError("calibration_invalid")

    def edit(data):
        mine = _dict(_dict(data, "calibration"), instance_id)
        steps = _dict(mine, "printer") if filament is None else _dict(_dict(mine, "filaments"), filament)
        if done:
            steps[step] = {"date": date.today().isoformat(), **({"temp": temp} if temp is not None else {})}
        else:
            steps.pop(step, None)
            if filament is not None and not steps:
                del mine["filaments"][filament]

    settings.change(edit)
    return state(instance_id)
