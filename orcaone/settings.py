"""OrcaOne's own data, all in one place: the folder data/ in the OrcaOne folder, next to
orcaone.sh, or next to the program file of a build (the user's wish of 23.09.2026). In it:
- settings.json: everything OrcaOne remembers, one section each:
  "manual_paths": data directories added by hand (instances.py);
  "unlocks": per installation, the library filaments OrcaOne switched on in Snapmaker Orca, to
  notice when the setup wizard switches them off again (instances.py, FINDINGS 4.7);
  "printers": the network address per printer model, typed in on the page "Drucker", and the
  seconds between two camera pictures (camera.py);
  "language": the language of the page, "de" or "en" (app.py); missing: the browser's;
  "menu_collapsed": true while the menu on the left is folded away (app.js);
  "theme": the design chosen at the bottom of the menu, "light" or "dark" (app.py); missing: the system's;
  "area": the part of OrcaOne used last, "slicer" or "printer" (app.js); the next start begins there;
  "chosen_printer": per part the printer chosen last, {"slicer": model, "printer": name} (app.js);
  "chosen_instance": the installation chosen last, its id (common.js);
  "print_file": per printer of the printer part the print file chosen last, {name: path} (app.js);
  "charts": per printer the curves shown on the page "Diagramme", {name: [series]} (pages/diagramme.js);
  "view3d": the camera of the page "3D Ansicht", {"position", "target"} in mm (pages/druck3d.js);
  "calibration": the ticks of the page "Kalibrieren" (calibration.py).
- backups/: the backups (backup.py). They hold credentials, so data/ is not in Git.
- snapshots/: per installation the state the page "Änderungen" compares with (snapshot.py).
- covers/<slicer>/<vendor>/<model>_cover.png: printer pictures fetched from the slicer's repository
  on GitHub where no installed slicer has them (covers.py).
"""

import json
import os
import platform
import shutil
import sys
import threading
import time
from pathlib import Path

# Built into a program of its own (tools/build.py, PyInstaller), data/ sits next to that program;
# its code lives in a folder the build may replace, or in a temporary one.
DATA_DIR = (Path(sys.executable).resolve().parent if getattr(sys, "frozen", False)
            else Path(__file__).resolve().parent.parent) / "data"
# Reads, too: on Windows a file open for reading cannot be replaced (Python opens it without
# FILE_SHARE_DELETE), and the pages read the settings every few seconds (camera.py).
_lock = threading.RLock()


def _file() -> Path:
    return DATA_DIR / "settings.json"


def _stored() -> dict:
    """{} without a file or with a broken one; any other OSError goes up, e.g. while Windows has
    the file open elsewhere, so that change() never writes over settings it could not read."""
    try:
        data = json.loads(_file().read_text(encoding="utf-8"))
    except (FileNotFoundError, ValueError):
        return {}
    return data if isinstance(data, dict) else {}


def load() -> dict:
    with _lock:
        try:
            return _stored()
        except OSError:
            return {}


def change(edit) -> None:
    """Read the settings, let edit(settings) change them in place, write them back atomically.
    Under a lock, so two changes at the same time cannot undo each other."""
    with _lock:
        data = _stored()
        edit(data)
        file = _file()
        file.parent.mkdir(parents=True, exist_ok=True)
        tmp = file.with_name(file.name + ".tmp")
        tmp.write_text(json.dumps(data, indent=4, ensure_ascii=False, sort_keys=True) + "\n", encoding="utf-8")
        replace(tmp, file)


def replace(tmp: Path, file: Path) -> None:
    """os.replace, tried three times: on Windows another program (a virus scanner, a backup tool)
    may have the file open for a moment."""
    for attempt in range(3):
        try:
            os.replace(tmp, file)
            return
        except PermissionError:
            if attempt == 2:
                raise
            time.sleep(0.1)


# ---------------------------------------------------------------- data up to 23.09.2026

def _old_dirs() -> list[Path]:
    """Where OrcaOne kept its data before: in the user's data folder, as Orfix under "orfix"."""
    home = Path.home()
    if platform.system() == "Windows":
        base = Path(os.environ["LOCALAPPDATA"]) if os.environ.get("LOCALAPPDATA") else home / "AppData" / "Local"
    elif platform.system() == "Darwin":
        base = home / "Library" / "Application Support"
    else:
        base = Path(os.environ["XDG_DATA_HOME"]) if os.environ.get("XDG_DATA_HOME") else home / ".local" / "share"
    return [base / "orcaone", base / "orfix"]


def _read(path: Path) -> dict:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    return data if isinstance(data, dict) else {}


def _cameras_to_printers(data: dict) -> None:
    """Up to 23.09.2026 the page "Kamera" had a list of its own; the address now belongs to the
    printer. All those cameras were U1s, so the first one becomes the address of that model."""
    cameras = data.pop("cameras", None)
    printers = data.get("printers") if isinstance(data.get("printers"), dict) else {}
    for cam in cameras if isinstance(cameras, list) else []:
        if isinstance(cam, dict) and isinstance(cam.get("host"), str) and "Snapmaker U1" not in printers:
            printers["Snapmaker U1"] = {"host": cam["host"], **({"every": cam["every"]} if isinstance(cam.get("every"), int) else {})}
    data["printers"] = printers


def migrate() -> None:
    """Moves the old data here once: the backups as they are, the separate settings files
    (instances.json, cameras.json, unlocks/<installation>.json) into settings.json. A section
    that is already there wins; its old file then stays, nothing is lost. The old folder goes
    once it is empty. A list "cameras" of that time becomes "printers" (_cameras_to_printers)."""
    for old in _old_dirs():
        if not old.is_dir():
            continue
        for zip_path in sorted(old.glob("backups/*/*.zip")):
            target = DATA_DIR / "backups" / zip_path.parent.name / zip_path.name
            if target.exists():
                continue
            # Readable by the owner only, as backup.py makes it (the ZIPs keep their mode).
            target.parent.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
            target.parent.mkdir(mode=0o700, exist_ok=True)
            shutil.move(zip_path, target)

        found = {}
        if (old / "instances.json").is_file():
            found["manual_paths"] = ([old / "instances.json"], _read(old / "instances.json").get("manual", []))
        if (old / "cameras.json").is_file():
            found["cameras"] = ([old / "cameras.json"], _read(old / "cameras.json").get("cameras", []))
        unlock_files = sorted((old / "unlocks").glob("*.json"))
        if unlock_files:
            found["unlocks"] = (unlock_files, {f.stem: _read(f).get("names", []) for f in unlock_files})
        taken = []

        def edit(data):
            for key, (files, value) in found.items():
                if key not in data:
                    data[key] = value
                    taken.extend(files)

        if found:
            change(edit)
        for file in taken:
            file.unlink()
        for folder in sorted((p for p in old.rglob("*") if p.is_dir()), reverse=True) + [old]:
            try:
                folder.rmdir()
            except OSError:
                pass  # not empty: something stays that was not moved
    if "cameras" in load():
        change(_cameras_to_printers)
