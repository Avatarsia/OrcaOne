"""OrcaOne's own data, all in one place: the folder data/ in the OrcaOne folder, next to
orcaone.sh (the user's wish of 23.09.2026). In it:
- settings.json: everything OrcaOne remembers, one section each:
  "manual_paths": data directories added by hand (instances.py);
  "unlocks": per installation, the library filaments OrcaOne switched on in Snapmaker Orca, to
  notice when the setup wizard switches them off again (instances.py, FINDINGS 4.7);
  "cameras": the printers of the page "Kamera" (camera.py).
- backups/: the backups (backup.py). They hold credentials, so data/ is not in Git.
"""

import json
import os
import platform
import shutil
import threading
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
_lock = threading.Lock()


def _file() -> Path:
    return DATA_DIR / "settings.json"


def load() -> dict:
    try:
        data = json.loads(_file().read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    return data if isinstance(data, dict) else {}


def change(edit) -> None:
    """Read the settings, let edit(settings) change them in place, write them back atomically.
    Under a lock, so two changes at the same time cannot undo each other."""
    with _lock:
        data = load()
        edit(data)
        file = _file()
        file.parent.mkdir(parents=True, exist_ok=True)
        tmp = file.with_name(file.name + ".tmp")
        tmp.write_text(json.dumps(data, indent=4, ensure_ascii=False, sort_keys=True) + "\n", encoding="utf-8")
        os.replace(tmp, file)


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


def migrate() -> None:
    """Moves the old data here once: the backups as they are, the separate settings files
    (instances.json, cameras.json, unlocks/<installation>.json) into settings.json. A section
    that is already there wins; its old file then stays, nothing is lost. The old folder goes
    once it is empty."""
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
