import json
import os
from pathlib import Path

import pytest

from orcaone import camera, instances, settings


def test_one_file_for_all_settings(data_dir):
    instances._save_manual_paths(["/portable/OrcaSlicer"])
    instances.save_unlocks("inst1", ["B @System", "A @System", "A @System"])
    camera.set_host("Snapmaker U1", "10.0.0.5")
    data = json.loads((data_dir / "settings.json").read_text(encoding="utf-8"))
    assert list(data) == ["manual_paths", "printers", "unlocks"]
    assert data["manual_paths"] == ["/portable/OrcaSlicer"] and data["unlocks"] == {"inst1": ["A @System", "B @System"]}
    assert instances.load_unlocks("inst1") == ["A @System", "B @System"] and instances.load_unlocks("inst2") == []
    assert [c["host"] for c in camera.cameras()] == ["10.0.0.5"]
    # A section OrcaOne does not know, e.g. from a newer version, stays.
    settings.change(lambda data: data.update(future={"x": 1}))
    instances._save_manual_paths([])
    assert settings.load()["future"] == {"x": 1} and instances.manual_paths() == []
    assert [p.name for p in data_dir.iterdir()] == ["settings.json"]


def test_a_broken_file_reads_as_empty(data_dir):
    data_dir.mkdir()
    (data_dir / "settings.json").write_text("[1, 2", encoding="utf-8")
    assert settings.load() == {} and instances.manual_paths() == [] and camera.cameras() == []
    (data_dir / "settings.json").write_text('{"manual_paths": "x", "unlocks": [], "printers": []}', encoding="utf-8")
    assert instances.manual_paths() == [] and instances.load_unlocks("inst1") == [] and camera.printers() == {}


def test_the_old_folders_move_into_data_once(fake_home, data_dir, monkeypatch):
    monkeypatch.setattr(settings.platform, "system", lambda: "Linux")
    share = fake_home / ".local" / "share"
    old = share / "orcaone"
    (old / "backups" / "abc").mkdir(parents=True)
    zip_path = old / "backups" / "abc" / "2026-09-23_070418_before_change.zip"
    zip_path.write_bytes(b"zip")
    os.chmod(zip_path, 0o600)
    (old / "instances.json").write_text(json.dumps({"manual": ["/portable/OrcaSlicer"]}), encoding="utf-8")
    cam = {"id": "c1", "host": "10.0.0.5", "name": "U1", "every": 5}
    (old / "cameras.json").write_text(json.dumps({"cameras": [cam]}), encoding="utf-8")
    (old / "unlocks").mkdir()
    (old / "unlocks" / "inst1.json").write_text(json.dumps({"names": ["SUNLU PLA+ @System"]}), encoding="utf-8")
    # Up to the rename the folder was called orfix; its backups come along as well.
    (share / "orfix" / "backups" / "def").mkdir(parents=True)
    (share / "orfix" / "backups" / "def" / "2026-09-22_120000_manual.zip").write_bytes(b"old")

    settings.migrate()
    assert not old.exists() and not (share / "orfix").exists()
    moved = data_dir / "backups" / "abc" / zip_path.name
    assert moved.read_bytes() == b"zip"
    assert (data_dir / "backups" / "def" / "2026-09-22_120000_manual.zip").read_bytes() == b"old"
    assert instances.manual_paths() == ["/portable/OrcaSlicer"]
    assert instances.load_unlocks("inst1") == ["SUNLU PLA+ @System"]
    # The cameras of that time were U1s; the address now belongs to the printer.
    assert settings.load()["printers"] == {"Snapmaker U1": {"host": "10.0.0.5", "every": 5}} and "cameras" not in settings.load()
    if os.name == "posix":
        assert moved.stat().st_mode & 0o777 == 0o600
        assert (data_dir / "backups").stat().st_mode & 0o777 == 0o700
        assert moved.parent.stat().st_mode & 0o777 == 0o700

    # Nothing left to move: nothing changes.
    before = (data_dir / "settings.json").read_bytes()
    settings.migrate()
    assert (data_dir / "settings.json").read_bytes() == before


def test_the_move_loses_nothing(fake_home, data_dir, monkeypatch):
    """A section already in settings.json wins, and a backup already there under its name stays;
    what did not move stays in the old folder."""
    monkeypatch.setattr(settings.platform, "system", lambda: "Linux")
    instances._save_manual_paths(["/new"])
    old = fake_home / ".local" / "share" / "orcaone"
    (old / "backups" / "abc").mkdir(parents=True)
    (old / "backups" / "abc" / "same.zip").write_bytes(b"old")
    (data_dir / "backups" / "abc").mkdir(parents=True)
    (data_dir / "backups" / "abc" / "same.zip").write_bytes(b"new")
    (old / "instances.json").write_text(json.dumps({"manual": ["/old"]}), encoding="utf-8")

    settings.migrate()
    assert instances.manual_paths() == ["/new"] and (old / "instances.json").is_file()
    assert (old / "backups" / "abc" / "same.zip").read_bytes() == b"old"
    assert (data_dir / "backups" / "abc" / "same.zip").read_bytes() == b"new"


def test_the_camera_list_becomes_the_printer_address(fake_home, monkeypatch):
    """Between the data folder and the address on the page "Drucker" (both 23.09.2026) the page
    "Kamera" had a list of its own in settings.json."""
    monkeypatch.setattr(settings.platform, "system", lambda: "Linux")
    settings.change(lambda data: data.update(cameras=[{"id": "f3cf6aad58", "host": "10.30.40.174", "name": "Werkstatt", "every": 5}]))
    settings.migrate()
    assert settings.load() == {"printers": {"Snapmaker U1": {"host": "10.30.40.174", "every": 5}}}
    # An address typed in on the page "Drucker" wins.
    settings.change(lambda data: data.update(cameras=[{"host": "10.0.0.9"}]))
    settings.migrate()
    assert camera.printers() == {"Snapmaker U1": {"host": "10.30.40.174", "from": "orcaone", "every": 5}}


def test_a_file_that_cannot_be_read_is_not_written_over(data_dir, monkeypatch):
    """Windows: while another program has settings.json open, reading or replacing it can fail.
    Readers then get {}, but a change must not write {} over the settings."""
    settings.change(lambda data: data.update(language="de"))
    before = (data_dir / "settings.json").read_bytes()
    real_read_text = Path.read_text

    def locked(self, *args, **kwargs):
        if self.name == "settings.json":
            raise PermissionError(13, "in use")
        return real_read_text(self, *args, **kwargs)

    monkeypatch.setattr(Path, "read_text", locked)
    assert settings.load() == {}
    with pytest.raises(PermissionError):
        settings.change(lambda data: data.update(language="en"))
    assert (data_dir / "settings.json").read_bytes() == before


def test_replacing_retries_a_moment(data_dir, monkeypatch):
    calls = []
    real_replace = os.replace

    def busy_once(src, dst):
        calls.append(dst)
        if len(calls) == 1:
            raise PermissionError(13, "in use")
        real_replace(src, dst)

    monkeypatch.setattr(settings.os, "replace", busy_once)
    monkeypatch.setattr(settings.time, "sleep", lambda s: None)
    settings.change(lambda data: data.update(language="en"))
    assert len(calls) == 2 and settings.load()["language"] == "en"
