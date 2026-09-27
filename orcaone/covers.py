"""Printer pictures, read at run time: nothing of the slicers' sources (AGPL-3.0) ships with OrcaOne
(the user's decisions of 27.09.2026). Both slicers load <resources>/profiles/<vendor>/<model>_cover.png
(OrcaSlicer Plater.cpp update_printer_thumbnail, WebGuideDialog.cpp BuildProfileJson) and never copy
it into the data folder. Per model OrcaSlicer's picture first, then Snapmaker Orca's (ORDER), each:
1. from the installed slicer's program folder. <resources> lies next to the program (Windows: the
   folder of the exe; AppImage and /opt: <exe>/../../resources) or at a fixed place for Flatpak and
   packages (<prefix>/share/<APP_KEY>, SLIC3R_FHS);
2. from data/covers/<slicer>/, what OrcaOne fetched before;
3. from the slicer's repository on GitHub, fetched the first time the page shows it and kept in
   data/covers/ (the user's wish: an AppImage that is not running, or a slicer only unpacked
   somewhere, has pictures too).
Else OrcaOne's own drawings.
Details: docs/FINDINGS.md, "Druckerbilder der Slicer"."""

import hashlib
import os
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

from . import instances, settings

# OrcaOne's own drawings where no picture is found (paths relative to orcaone/static).
FALLBACK = {"Snapmaker U1": "assets/printer-snapmaker-u1.svg", "Generic Klipper Printer": "assets/printer-klipper.svg"}
PLACEHOLDER = "assets/printer-placeholder.svg"
# OrcaSlicer's pictures first: they differ, and the user finds OrcaSlicer's nicer (27.09.2026: its U1
# with spools and a print, Snapmaker Orca's a large plain one set off-centre).
ORDER = ["OrcaSlicer", "Snapmaker_Orca"]
# The profiles folder of each slicer's repository (checked 27.09.2026: 200 with image/png, 404 for none).
SOURCES = {
    "Snapmaker_Orca": "https://raw.githubusercontent.com/Snapmaker/OrcaSlicer/main/resources/profiles",
    "OrcaSlicer": "https://raw.githubusercontent.com/OrcaSlicer/OrcaSlicer/main/resources/profiles",
}
FETCH_TIMEOUT = 5            # seconds per try; the page shows the picture when it comes
FETCH_MAX = 2 * 1024 * 1024  # a cover is 5 KB to 350 KB
OFFLINE_PAUSE = 600          # seconds without a try after GitHub could not be reached
_PNG = b"\x89PNG\r\n\x1a\n"

# key -> (the steps: a Path, or (slicer, vendor, model) to fetch; the model, for its drawing): GET /api/covers/<key>
_files: dict[str, tuple] = {}
_missing: set = set()            # (slicer, vendor, model) not on GitHub: no second try this run
_locks: dict = {}                # one lock per picture: the page asks for all at once, each its own
_offline_until = 0.0             # time.monotonic() until which no fetch is tried


def candidates(slicer: str, processes: list) -> list[Path]:
    """Where a slicer's resources may lie, the running program first; nothing looked at yet."""
    out = []
    for p in processes:
        if p.slicer == slicer and getattr(p, "exe", None):
            exe = Path(p.exe)
            out += [exe.parent / "resources", exe.parent.parent / "resources"]
    if os.name == "nt":
        out += [Path(base, slicer, "resources") for base in {os.environ.get(v) for v in ("ProgramFiles", "ProgramW6432")} if base]
        out += _registered(slicer)
    else:
        home = Path.home()
        for app_id, _ in instances.FLATPAK_IDS.get(slicer, []):
            # The program's files lie in the Flatpak installation, /app inside the sandbox.
            for root in (Path("/var/lib/flatpak/app"), home / ".local/share/flatpak/app"):
                out.append(root / app_id / "current/active/files/share" / slicer)
        out += [Path("/usr/share", slicer), Path("/usr/local/share", slicer)]
    return out


def _registered(slicer: str) -> list[Path]:
    """Windows: the folder the installer names (Snapmaker Orca: HKLM\\SOFTWARE\\WOW6432Node\\...\\
    Uninstall\\Snapmaker_Orca, without InstallLocation; the folder of its Uninstall.exe)."""
    import winreg
    out = []
    for root, sub in ((winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\WOW6432Node"), (winreg.HKEY_LOCAL_MACHINE, "SOFTWARE"),
                      (winreg.HKEY_CURRENT_USER, "SOFTWARE")):
        try:
            with winreg.OpenKey(root, rf"{sub}\Microsoft\Windows\CurrentVersion\Uninstall\{slicer}") as key:
                uninstall = winreg.QueryValueEx(key, "UninstallString")[0]
        except OSError:
            continue
        if isinstance(uninstall, str) and uninstall.strip('" '):
            out.append(Path(uninstall.strip('" ')).parent / "resources")
    return out


def program_dirs(slicer: str, processes: list) -> list[Path]:
    """The resources folders of a slicer found on this computer, each once."""
    out = []
    for path in candidates(slicer, processes):
        try:
            if (path / "profiles").is_dir() and path not in out:
                out.append(path)
        except OSError:
            continue
    return out


def _safe(name) -> bool:
    """A name that stays one folder or file name, in a path and in a URL."""
    return isinstance(name, str) and bool(name) and not name.startswith(".") and not any(c in name for c in '/\\:*?"<>|')


def _key(thing, model: str) -> str:
    key = hashlib.sha1(repr(thing).encode("utf-8")).hexdigest()[:12]
    _files[key] = (thing, model)
    return key


def _offline() -> bool:
    return time.monotonic() < _offline_until


def _kept(slicer: str, vendor: str, model: str) -> Path:
    return settings.DATA_DIR / "covers" / slicer / vendor / f"{model}_cover.png"


def finder(processes: list):
    """(vendor, model) -> the picture's address for the page. vendor is the folder under profiles
    (the package), None for a printer whose package is unknown: then only the program folders, all
    vendors. The steps behind an address are tried when the page asks (file_of)."""
    dirs = {s: program_dirs(s, processes) for s in ORDER}
    listed = {}

    def names_in(folder: Path) -> dict:
        if folder not in listed:
            try:
                listed[folder] = {f.name.lower(): f for f in folder.iterdir() if f.name.endswith("_cover.png")}
            except OSError:
                listed[folder] = {}
        return listed[folder]

    def installed(slicer: str, vendor, name: str) -> Path | None:
        for d in dirs[slicer]:
            if _safe(vendor):
                vendors = [d / "profiles" / vendor]
            else:
                try:
                    vendors = sorted(f for f in (d / "profiles").iterdir() if f.is_dir())
                except OSError:
                    vendors = []
            for folder in vendors + [d / "web" / "image" / "printer"]:
                # Exactly, or else regardless of case: three pictures in Snapmaker Orca 2.4.0 differ
                # in case from their model ("ginger G1_cover.png" for "Ginger G1").
                path = folder / name if (folder / name).is_file() else names_in(folder).get(name.lower())
                if path is not None:
                    return path
        return None

    def cover(vendor, model) -> str:
        if not _safe(model):
            return PLACEHOLDER
        steps = []
        for slicer in ORDER:
            path = installed(slicer, vendor, f"{model}_cover.png")
            kept = _kept(slicer, vendor, model) if _safe(vendor) else None
            if path is None and kept is not None and kept.is_file():
                path = kept
            if path is not None:
                steps.append(path)
                break   # a picture at hand: no fetching
            if kept is not None and slicer in SOURCES and (slicer, vendor, model) not in _missing and not _offline():
                steps.append((slicer, vendor, model))
        return f"api/covers/{_key(tuple(steps), model)}" if steps else FALLBACK.get(model, PLACEHOLDER)

    return cover


def _fetch(slicer: str, vendor: str, model: str) -> Path | None:
    """The picture from the slicer's repository, kept in data/covers/<slicer>/; only a PNG of at most
    FETCH_MAX bytes. None if there is none, or no internet: then no try for OFFLINE_PAUSE, so a
    computer without internet does not wait for every picture (review 27.09.2026)."""
    global _offline_until
    what = (slicer, vendor, model)
    kept = _kept(slicer, vendor, model)
    if kept.is_file():
        return kept
    if what in _missing or _offline() or slicer not in SOURCES:
        return None
    with _locks.setdefault(what, threading.Lock()):
        if kept.is_file():
            return kept
        if what in _missing or _offline():
            return None
        url = f"{SOURCES[slicer]}/{urllib.parse.quote(vendor)}/{urllib.parse.quote(model + '_cover.png')}"
        try:
            with urllib.request.urlopen(url, timeout=FETCH_TIMEOUT) as response:
                data = response.read(FETCH_MAX + 1)
        except urllib.error.HTTPError:
            data = None   # not there (404)
        except (urllib.error.URLError, OSError, ValueError):
            _offline_until = time.monotonic() + OFFLINE_PAUSE   # no internet, or GitHub not reachable
            return None
        if data is None or len(data) > FETCH_MAX or not data.startswith(_PNG):
            _missing.add(what)
            return None
        try:
            kept.parent.mkdir(parents=True, exist_ok=True)
            part = kept.with_name(kept.name + ".part")
            part.write_bytes(data)
            os.replace(part, kept)
        except OSError:
            return None
        return kept


def file_of(key: str) -> Path | None:
    """The picture behind an address cover() gave out: its steps in order, a fetch the first time;
    nothing else is ever served. None if none gives one, e.g. an AppImage's that no longer runs."""
    for step in _files.get(key, ((), None))[0]:
        path = _fetch(*step) if isinstance(step, tuple) else step if step.is_file() else None
        if path is not None:
            return path
    return None


def fallback_of(key: str) -> str | None:
    """OrcaOne's own drawing for an address cover() gave out whose picture could not be had."""
    entry = _files.get(key)
    return FALLBACK.get(entry[1], PLACEHOLDER) if entry else None
