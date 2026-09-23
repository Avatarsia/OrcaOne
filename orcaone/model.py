"""Data classes shared by detection, scanning and the API."""

from dataclasses import dataclass, field
from pathlib import Path

# SLIC3R_APP_KEY from version.inc of each slicer. It names the data directory and
# the <APP_KEY>.conf inside it. "executables" are the program file names per
# platform (Linux, Windows, macOS bundle), see docs/FINDINGS.md 4.1.
SLICERS = {
    "Snapmaker_Orca": {
        "name": "Snapmaker Orca",
        "executables": ["snapmaker-orca", "snapmaker-orca.exe", "Snapmaker_Orca"],
    },
    "OrcaSlicer": {
        "name": "OrcaSlicer",
        "executables": ["orca-slicer", "orca-slicer.exe", "OrcaSlicer"],
    },
}


@dataclass
class Instance:
    id: str
    slicer: str                      # key of SLICERS
    data_dir: Path
    source: str                      # auto, flatpak, flatpak_legacy, appimage_portable, process, manual
    version: str | None = None       # from the "header" of the .conf, e.g. "2.4.0"
    active_user_folder: str = "default"
    user_folders: list[str] = field(default_factory=list)
    logged_in: bool = False          # preset_folder is a user id instead of ""
    system_formats: list[str] = field(default_factory=list)   # "json" and/or "opc"
    conf_indent: str | None = None   # "    " or "\t"
    conf_checksum: bool = False      # Windows MD5 line present
    problems: list[str] = field(default_factory=list)


@dataclass
class RunState:
    running: bool
    reason: str | None = None        # lock, process, process_unmapped
    pids: list[int] = field(default_factory=list)
    lock: str | None = None          # "cache/<hash>.lock" the slicer holds, for reason "lock"
