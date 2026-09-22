"""Find slicer data directories.

Sources: the default location per platform, Flatpak, portable AppImages, running
slicers started with --datadir, and paths the user added by hand. Where each
slicer puts its data directory is documented in docs/FINDINGS.md, section 4.1.
"""

import hashlib
import json
import os
import platform
import re
import time
from pathlib import Path

from .conf import RETRY_DELAY, read_conf
from .model import SLICERS, Instance

# Known Flatpak IDs. OrcaSlicer used io.github.softfever.OrcaSlicer up to v2.3.1
# and copies that folder once on migration; the old one stays behind.
FLATPAK_IDS = {
    "Snapmaker_Orca": [("io.github.Snapmaker.Snapmaker_Orca", "flatpak")],
    "OrcaSlicer": [
        ("com.orcaslicer.OrcaSlicer", "flatpak"),
        ("io.github.softfever.OrcaSlicer", "flatpak_legacy"),
    ],
}

# Where AppImages usually live. An AppImage with a folder "<file>.config" next to
# it runs in portable mode: the runtime points XDG_CONFIG_HOME there.
APPIMAGE_DIRS = ["Applications", "AppImages", "Apps", "Downloads", "Desktop", "bin", ".local/bin"]

# Temporary folders the slicer creates inside user/, not account folders
# (export dialog: user/Temp).
_NOT_USER_FOLDERS = {"Temp"}

_VERSION = re.compile(r"(\d+\.\d+\.\d+\S*)\s*$")


def orfix_data_dir(system: str | None = None, env=None, home: Path | None = None) -> Path:
    """Orfix' own folder for manual paths, snapshots and backups."""
    system = system or platform.system()
    env = os.environ if env is None else env
    home = home or Path.home()
    if system == "Windows":
        base = Path(env["LOCALAPPDATA"]) if env.get("LOCALAPPDATA") else home / "AppData" / "Local"
    elif system == "Darwin":
        base = home / "Library" / "Application Support"
    else:
        base = Path(env["XDG_DATA_HOME"]) if env.get("XDG_DATA_HOME") else home / ".local" / "share"
    return base / "orfix"


def candidate_dirs(system: str, env, home: Path) -> list[tuple[Path, str]]:
    """Possible data directories as (path, source). Existence is checked later."""
    found = []
    if system == "Windows":
        base = Path(env["APPDATA"]) if env.get("APPDATA") else home / "AppData" / "Roaming"
        found += [(base / key, "auto") for key in SLICERS]
    elif system == "Darwin":
        found += [(home / "Library" / "Application Support" / key, "auto") for key in SLICERS]
    else:
        config = Path(env["XDG_CONFIG_HOME"]) if env.get("XDG_CONFIG_HOME") else home / ".config"
        found += [(config / key, "auto") for key in SLICERS]
        flatpak_root = home / ".var" / "app"
        for key, ids in FLATPAK_IDS.items():
            found += [(flatpak_root / app_id / "config" / key, source) for app_id, source in ids]
            # Builds under other IDs, e.g. a self-built Flatpak.
            found += [(path, "flatpak") for path in sorted(flatpak_root.glob(f"*/config/{key}"))]
        found += _portable_appimage_dirs(home)
    return found


def _portable_appimage_dirs(home: Path) -> list[tuple[Path, str]]:
    found = []
    for folder in APPIMAGE_DIRS:
        for file in sorted((home / folder).glob("*")):
            if file.suffix.lower() != ".appimage" or not file.is_file():
                continue
            for key in SLICERS:
                found.append((Path(f"{file}.config") / key, "appimage_portable"))
                found.append((Path(f"{file}.home") / ".config" / key, "appimage_portable"))
    return found


def slicer_of(path: Path) -> str | None:
    """APP_KEY of a data directory, recognised by its <APP_KEY>.conf. The slicer deletes the
    .conf right before it renames the new one into place, so look twice (FINDINGS 4.3)."""
    for attempt in range(2):
        for key in SLICERS:
            if (path / f"{key}.conf").is_file():
                return key
        if not attempt:
            time.sleep(RETRY_DELAY)
    return None


def instance_id(path: Path) -> str:
    return hashlib.sha1(str(path).encode("utf-8")).hexdigest()[:12]


def load_instance(path: Path, source: str) -> Instance | None:
    """Read the basic facts of a data directory, or None if it is none."""
    key = slicer_of(path)
    if key is None:
        return None
    instance = Instance(id=instance_id(path), slicer=key, data_dir=path, source=source)

    try:
        conf = read_conf(path / f"{key}.conf")
    except (OSError, ValueError):
        instance.problems.append("conf_unreadable")
        conf = None
    if conf is not None:
        instance.conf_indent = conf.indent
        instance.conf_checksum = conf.checksum
        header = conf.data.get("header")
        match = _VERSION.search(header) if isinstance(header, str) else None
        instance.version = match.group(1) if match else None
        app = conf.data.get("app")
        preset_folder = app.get("preset_folder") if isinstance(app, dict) else None
        # "" and a missing key both mean user/default; the slicer sets a user id
        # here on every start while an account is signed in.
        if isinstance(preset_folder, str) and preset_folder:
            instance.active_user_folder = preset_folder
            instance.logged_in = True

    # A folder without read permission must not take the whole list down.
    try:
        user_dir = path / "user"
        if user_dir.is_dir():
            instance.user_folders = sorted(
                child.name for child in user_dir.iterdir()
                if child.is_dir() and child.name not in _NOT_USER_FOLDERS
            )
        system_dir = path / "system"
        if system_dir.is_dir():
            suffixes = {child.suffix for child in system_dir.iterdir() if child.is_file()}
            instance.system_formats = [name for name in ("json", "opc") if f".{name}" in suffixes]
    except OSError:
        instance.problems.append("dir_unreadable")
    return instance


def _default_candidates() -> list[tuple[Path, str]]:
    return candidate_dirs(platform.system(), os.environ, Path.home())


def discover(process_dirs: list[Path] | None = None) -> list[Instance]:
    """All data directories found on this computer, each path once."""
    candidates = _default_candidates()
    candidates += [(path, "process") for path in process_dirs or []]
    candidates += [(Path(path), "manual") for path in manual_paths()]

    instances, seen = [], set()
    for path, source in candidates:
        try:
            resolved = path.resolve()
        except OSError:
            continue
        if resolved in seen or not resolved.is_dir():
            continue
        instance = load_instance(resolved, source)
        if instance is not None:
            seen.add(resolved)
            instances.append(instance)
    return instances


def _manual_file() -> Path:
    return orfix_data_dir() / "instances.json"


def manual_paths() -> list[str]:
    try:
        data = json.loads(_manual_file().read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return []
    paths = data.get("manual") if isinstance(data, dict) else None
    return [p for p in paths if isinstance(p, str)] if isinstance(paths, list) else []


def _save_manual_paths(paths: list[str]) -> None:
    file = _manual_file()
    file.parent.mkdir(parents=True, exist_ok=True)
    tmp = file.with_suffix(".tmp")
    tmp.write_text(json.dumps({"manual": paths}, indent=4, ensure_ascii=False) + "\n", encoding="utf-8")
    os.replace(tmp, file)


def add_manual_path(raw: str) -> Instance:
    """Remember a data directory. Raises ValueError with an error code,
    OSError if Orfix' own folder cannot be written."""
    # File managers copy paths with quotes ("Copy as path" on Windows).
    raw = raw.strip().strip('"').strip()
    try:
        path = Path(raw).expanduser()
    except RuntimeError:  # "~name" with an unknown user
        raise ValueError("path_not_found") from None
    if not raw or not path.is_dir():
        raise ValueError("path_not_found")
    path = path.resolve()
    instance = load_instance(path, "manual")
    if instance is None:
        raise ValueError("not_a_data_dir")
    found = set()
    for candidate, _ in _default_candidates():
        try:
            found.add(candidate.resolve())
        except OSError:
            continue
    if path in found:
        raise ValueError("already_listed")
    paths = manual_paths()
    if str(path) not in paths:
        _save_manual_paths(paths + [str(path)])
    return instance


def remove_manual_path(raw: str) -> None:
    paths = manual_paths()
    if raw not in paths:
        raise ValueError("not_listed")
    _save_manual_paths([p for p in paths if p != raw])


# ---------------------------------------------------------------- unlocked library filaments

def _unlocks_file(instance_id: str) -> Path:
    return orfix_data_dir() / "unlocks" / f"{instance_id}.json"


def load_unlocks(instance_id: str) -> list[str]:
    """Library filaments Orfix put into "filaments" (way A, FINDINGS 4.7). The wizard and a few
    dialogs rewrite that list and drop them; overview.py compares on every scan."""
    try:
        data = json.loads(_unlocks_file(instance_id).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return []
    names = data.get("names") if isinstance(data, dict) else None
    return [n for n in names if isinstance(n, str)] if isinstance(names, list) else []


def save_unlocks(instance_id: str, names: list[str]) -> None:
    file = _unlocks_file(instance_id)
    file.parent.mkdir(parents=True, exist_ok=True)
    tmp = file.with_suffix(".tmp")
    tmp.write_text(json.dumps({"names": sorted(set(names))}, indent=4, ensure_ascii=False) + "\n", encoding="utf-8")
    os.replace(tmp, file)


def write_allowed(instance: Instance) -> bool:
    """Whether Orfix may write into this data directory at all.

    Until the user allows writing to the real slicer folders, only data directories added by
    hand qualify, e.g. a copy the slicer runs on with --datadir (docs/TEST-VERGLEICH.md). The
    default locations, Flatpak, portable AppImages and folders known only from a running slicer
    stay read only. A manual folder the slicer is running on shows up as "process"."""
    if instance.source == "manual":
        return True
    return instance.source == "process" and str(instance.data_dir) in manual_paths()
