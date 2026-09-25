"""Tell whether a slicer is running on a data directory. Strictly read only.

Linux and macOS: the slicer holds a POSIX write lock on <data_dir>/cache/<hash>.lock
(InstanceCheck.cpp). F_GETLK reports the holder without taking the lock. OrcaOne must
never take that lock itself: a starting slicer would think it is a second instance.
The lock alone is not enough: the slicer reads the .conf before it takes the lock
and writes it once more after deleting the lock file on exit. So a slicer counts as
running as long as its process or its AppImage runtime exists.
Windows uses a named mutex instead, so there only the process list helps.
A slicer process whose data directory is unknown makes every instance of that
slicer read only. Details: docs/FINDINGS.md, section 4.1.
"""

import ctypes
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
    held = held_lock(data_dir)
    return held[0] if held else None


def held_lock(data_dir: Path) -> tuple[int, str] | None:
    """(PID, "cache/<file>") of the lock the slicer holds in <data_dir>/cache, if any."""
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
            return pid, f"cache/{lock.name}"
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


_ATTRS = ["pid", "name", "exe", "cmdline"]


class _ProcessEntry(ctypes.Structure):
    """PROCESSENTRY32W from tlhelp32.h."""
    _fields_ = [("dwSize", ctypes.c_uint32), ("cntUsage", ctypes.c_uint32), ("th32ProcessID", ctypes.c_uint32),
                ("th32DefaultHeapID", ctypes.c_size_t), ("th32ModuleID", ctypes.c_uint32),
                ("cntThreads", ctypes.c_uint32), ("th32ParentProcessID", ctypes.c_uint32),
                ("pcPriClassBase", ctypes.c_int32), ("dwFlags", ctypes.c_uint32), ("szExeFile", ctypes.c_wchar * 260)]


def _windows_names() -> list[tuple[int, str]]:
    """(PID, program file name) of every process, from one Toolhelp32 snapshot."""
    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel32.CreateToolhelp32Snapshot.restype = ctypes.c_void_p
    kernel32.Process32FirstW.argtypes = kernel32.Process32NextW.argtypes = [ctypes.c_void_p, ctypes.POINTER(_ProcessEntry)]
    kernel32.CloseHandle.argtypes = [ctypes.c_void_p]
    snapshot = kernel32.CreateToolhelp32Snapshot(0x2, 0)  # TH32CS_SNAPPROCESS
    if snapshot == ctypes.c_void_p(-1).value:  # INVALID_HANDLE_VALUE
        raise ctypes.WinError(ctypes.get_last_error())
    entry = _ProcessEntry(dwSize=ctypes.sizeof(_ProcessEntry))
    names = []
    try:
        more = kernel32.Process32FirstW(snapshot, ctypes.byref(entry))
        while more:
            names.append((entry.th32ProcessID, entry.szExeFile))
            more = kernel32.Process32NextW(snapshot, ctypes.byref(entry))
    finally:
        kernel32.CloseHandle(snapshot)
    return names


def _candidates():
    """Processes that may be a slicer, each with .info as psutil.process_iter sets it.

    On Windows psutil takes every process name from the program path, one query per process.
    On the Windows test machine that took 0.1 to 0.25 s per process, over 40 s for all, and the
    page hung while loading. The snapshot names all processes in 0.2 s, so psutil only looks at
    the slicers."""
    if os.name != "nt":
        return psutil.process_iter(_ATTRS)
    found = []
    for pid, name in _windows_names():
        if name.lower() not in _EXECUTABLES:
            continue
        try:
            proc = psutil.Process(pid)
            proc.info = proc.as_dict(_ATTRS)
        except psutil.Error:  # ended in between
            continue
        found.append(proc)
    return found


def find_processes() -> list[SlicerProcess]:
    slicers, runtimes, covered = [], [], set()
    for proc in _candidates():
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
    held = held_lock(instance.data_dir)
    if held is not None:
        return RunState(True, "lock", [held[0]], lock=held[1])
    same_slicer = [p for p in processes if p.slicer == instance.slicer]
    mine = [p.pid for p in same_slicer if p.data_dir and _same_path(p.data_dir, instance.data_dir)]
    if mine:
        return RunState(True, "process", mine)
    unknown = [p.pid for p in same_slicer if p.data_dir is None]
    if unknown:
        return RunState(True, "process_unmapped", unknown)
    return RunState(False)
