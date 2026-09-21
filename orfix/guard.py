"""Tell whether a slicer is running on a data directory. Strictly read only.

Linux and macOS: the slicer holds a POSIX write lock on <data_dir>/cache/<hash>.lock
(InstanceCheck.cpp). F_GETLK reports the holder without taking the lock. Orfix must
never take that lock itself: a starting slicer would think it is a second instance.
The lock alone is not enough: the slicer reads the .conf before it takes the lock
and writes it once more after deleting the lock file on exit. So a slicer counts as
running as long as its process or its AppImage runtime exists.
Windows uses a named mutex instead, so there only the process list helps.
A slicer process whose data directory is unknown makes every instance of that
slicer read only. Details: docs/FINDINGS.md, section 4.1.
"""

import os
import struct
import sys
from dataclasses import dataclass
from pathlib import Path

import psutil

from .model import SLICERS, Instance, RunState

_EXECUTABLES = {name.lower(): key for key, info in SLICERS.items() for name in info["executables"]}
# The AppImage runtime (FUSE) process is named after the .appimage file. It is not a
# parent of the slicer: the start process becomes the slicer by exec, the runtime
# detaches. It lives before and after the slicer, so it counts as running too.
_APPIMAGE_MARKERS = {
    "Snapmaker_Orca": ("snapmaker_orca", "snapmaker-orca", "snapmaker orca"),
    "OrcaSlicer": ("orcaslicer", "orca-slicer", "orca_slicer"),
}


@dataclass
class SlicerProcess:
    pid: int
    slicer: str
    data_dir: Path | None


def lock_holder(data_dir: Path) -> int | None:
    """PID holding a lock file in <data_dir>/cache, if any."""
    if os.name != "posix":
        return None
    import fcntl

    # struct flock differs: Linux starts with l_type/l_whence, macOS ends with them.
    if sys.platform == "darwin":
        layout = "qqihh"
        request = struct.pack(layout, 0, 1, 0, fcntl.F_WRLCK, os.SEEK_SET)
    else:
        layout = "hhqqi"
        request = struct.pack(layout, fcntl.F_WRLCK, os.SEEK_SET, 0, 1, 0)

    for lock in sorted((data_dir / "cache").glob("*.lock")):
        try:
            fd = os.open(lock, os.O_RDONLY)
        except OSError:
            continue
        try:
            reply = fcntl.fcntl(fd, fcntl.F_GETLK, request)
        except OSError:
            continue
        finally:
            os.close(fd)
        fields = struct.unpack(layout, reply)
        lock_type, pid = (fields[3], fields[2]) if sys.platform == "darwin" else (fields[0], fields[4])
        # pid is 0 when the holder lives in another PID namespace (Flatpak).
        if lock_type != fcntl.F_UNLCK:
            return pid
    return None


def process_data_dir(cmdline: list[str], cwd: str | None) -> Path | None:
    """Data directory of a slicer process: --datadir, otherwise its working
    directory, because the slicer changes into <data_dir>/log at start."""
    datadir = None
    for index, arg in enumerate(cmdline):
        if arg == "--datadir" and index + 1 < len(cmdline):
            datadir = cmdline[index + 1]
        elif arg.startswith("--datadir="):
            datadir = arg.split("=", 1)[1]
    if datadir:
        # With --datadir the slicer does not change directory, so a relative
        # path is relative to the working directory it was started in.
        path = Path(datadir)
        if path.is_absolute():
            return path
        return Path(cwd) / path if cwd else None
    if cwd and Path(cwd).name == "log":
        return Path(cwd).parent
    return None


def _appimage_slicer(exe: str) -> str | None:
    name = Path(exe).name.lower()
    if not name.endswith(".appimage"):
        return None
    return next((key for key, markers in _APPIMAGE_MARKERS.items() if any(m in name for m in markers)), None)


def _normalized(path: str) -> str:
    return os.path.normcase(os.path.realpath(path))


def uncovered_runtimes(runtimes: list[tuple[int, str, str]], covered_appimages: set[str]) -> list[SlicerProcess]:
    """AppImage runtimes (pid, slicer, exe) whose slicer is not running with a
    known data directory, e.g. while it starts or exits."""
    return [SlicerProcess(pid, slicer, None) for pid, slicer, exe in runtimes if _normalized(exe) not in covered_appimages]


def find_processes() -> list[SlicerProcess]:
    slicers, runtimes, covered = [], [], set()
    for proc in psutil.process_iter(["pid", "name", "exe", "cmdline"]):
        info = proc.info
        exe = info["exe"] or ""
        names = {Path(exe).name.lower(), (info["name"] or "").lower()}
        slicer = next((_EXECUTABLES[n] for n in names if n in _EXECUTABLES), None)
        if slicer is not None:
            try:
                cwd = proc.cwd()
            except (psutil.Error, OSError):
                cwd = None
            process = SlicerProcess(info["pid"], slicer, process_data_dir(info["cmdline"] or [], cwd))
            slicers.append(process)
            if process.data_dir:
                # The AppImage runtime sets $APPIMAGE for the slicer inside it.
                try:
                    appimage = proc.environ().get("APPIMAGE")
                except (psutil.Error, OSError):
                    appimage = None
                if appimage:
                    covered.add(_normalized(appimage))
        elif (runtime_slicer := _appimage_slicer(exe)) is not None:
            runtimes.append((info["pid"], runtime_slicer, exe))
    return slicers + uncovered_runtimes(runtimes, covered)


def _same_path(a: Path, b: Path) -> bool:
    try:
        return os.path.normcase(a.resolve()) == os.path.normcase(b.resolve())
    except OSError:
        return False


def run_state(instance: Instance, processes: list[SlicerProcess]) -> RunState:
    pid = lock_holder(instance.data_dir)
    if pid is not None:
        return RunState(True, "lock", [pid])
    same_slicer = [p for p in processes if p.slicer == instance.slicer]
    mine = [p.pid for p in same_slicer if p.data_dir and _same_path(p.data_dir, instance.data_dir)]
    if mine:
        return RunState(True, "process", mine)
    unknown = [p.pid for p in same_slicer if p.data_dir is None]
    if unknown:
        return RunState(True, "process_unmapped", unknown)
    return RunState(False)
