import os
import subprocess
import sys
from pathlib import Path

import psutil
import pytest

from orcaone import guard
from orcaone.guard import SlicerProcess, process_data_dir, run_state
from orcaone.model import Instance

# Takes the same kind of lock as the slicer: a POSIX write lock on byte 0.
HOLD_LOCK = """
import fcntl, os, sys, time
fd = os.open(sys.argv[1], os.O_WRONLY | os.O_CREAT)
fcntl.lockf(fd, fcntl.LOCK_EX, 1, 0)
print("locked", flush=True)
time.sleep(60)
"""


@pytest.mark.skipif(os.name != "posix", reason="the lock file exists on Linux and macOS only")
def test_lock_holder_reports_the_pid(tmp_path):
    (tmp_path / "cache").mkdir()
    lock = tmp_path / "cache" / "11911699295906290287.lock"
    holder = subprocess.Popen([sys.executable, "-c", HOLD_LOCK, str(lock)], stdout=subprocess.PIPE, text=True)
    try:
        assert holder.stdout.readline().strip() == "locked"
        assert guard.lock_holder(tmp_path) == holder.pid
        assert guard.held_lock(tmp_path) == (holder.pid, "cache/11911699295906290287.lock")
    finally:
        holder.kill()
        holder.wait()
        holder.stdout.close()
    # After a crash the file stays behind without a lock.
    assert lock.exists()
    assert guard.lock_holder(tmp_path) is None


def test_lock_holder_without_cache(tmp_path):
    assert guard.lock_holder(tmp_path) is None


def test_process_data_dir():
    copy = Path("/tmp/copy").absolute()  # with a drive letter on Windows
    assert process_data_dir(["snapmaker-orca", "--datadir", str(copy)], None) == copy
    assert process_data_dir(["orca-slicer", f"--datadir={copy}"], "/somewhere") == copy
    assert process_data_dir(["orca-slicer"], "/home/u/.config/OrcaSlicer/log") == Path("/home/u/.config/OrcaSlicer")
    assert process_data_dir(["orca-slicer"], "/home/u") is None
    assert process_data_dir(["orca-slicer", "--datadir"], None) is None
    assert process_data_dir(["orca-slicer", "--datadir", "copy"], "/home/u") == Path("/home/u/copy")
    assert process_data_dir(["orca-slicer", "--datadir", "copy"], None) is None


def test_appimage_runtime_names():
    assert guard._appimage_slicer("/home/u/Downloads/Snapmaker_Orca_Linux_AppImage_Ubuntu2404_V2.4.0.appimage") == "Snapmaker_Orca"
    assert guard._appimage_slicer("/opt/OrcaSlicer_Linux_AppImage_Ubuntu2404_nightly.AppImage") == "OrcaSlicer"
    assert guard._appimage_slicer("/opt/Mayo-0.10.0-x86_64.appimage") is None
    assert guard._appimage_slicer("/usr/bin/orca") is None
    assert guard._appimage_slicer("/home/u/Downloads/Snapmaker-Luban-4.15.0-linux-x86_64.AppImage") is None


def test_appimage_runtime_is_covered_by_its_slicer(tmp_path):
    snorca = tmp_path / "Snapmaker_Orca_V2.4.0.appimage"
    orca = tmp_path / "OrcaSlicer_nightly.AppImage"
    runtimes = [(10, "Snapmaker_Orca", str(snorca)), (11, "OrcaSlicer", str(orca))]
    covered = {guard._normalized(str(snorca))}
    # SnOrca runs inside its runtime; the OrcaSlicer runtime is starting or exiting.
    assert guard.uncovered_runtimes(runtimes, covered) == [SlicerProcess(11, "OrcaSlicer", None)]


def test_run_state(tmp_path):
    instance = Instance(id="x", slicer="OrcaSlicer", data_dir=tmp_path, source="auto")
    assert run_state(instance, []).running is False

    other_slicer = SlicerProcess(1, "Snapmaker_Orca", None)
    elsewhere = SlicerProcess(2, "OrcaSlicer", tmp_path / "other")
    assert run_state(instance, [other_slicer, elsewhere]).running is False

    mine = SlicerProcess(3, "OrcaSlicer", tmp_path)
    state = run_state(instance, [elsewhere, mine])
    assert (state.running, state.reason, state.pids) == (True, "process", [3])

    unknown = SlicerProcess(4, "OrcaSlicer", None)
    state = run_state(instance, [elsewhere, unknown])
    assert (state.running, state.reason, state.pids) == (True, "process_unmapped", [4])


def test_lock_held_from_another_pid_namespace(tmp_path, monkeypatch):
    # F_GETLK reports pid 0 for a holder inside a Flatpak sandbox.
    monkeypatch.setattr(guard, "held_lock", lambda data_dir: (0, "cache/1.lock"))
    instance = Instance(id="x", slicer="OrcaSlicer", data_dir=tmp_path, source="flatpak")
    state = run_state(instance, [])
    assert (state.running, state.reason, state.pids, state.lock) == (True, "lock", [0], "cache/1.lock")


def test_find_processes_runs():
    assert isinstance(guard.find_processes(), list)


def test_find_processes_sees_a_slicer(monkeypatch):
    # The test's own Python stands in for a slicer; on Windows this covers the Toolhelp32 snapshot.
    name = Path(psutil.Process().exe()).name.lower()
    monkeypatch.setattr(guard, "_EXECUTABLES", {name: "OrcaSlicer"})
    assert os.getpid() in [p.pid for p in guard.find_processes() if p.slicer == "OrcaSlicer"]
