"""Backups as ZIP (hard rule 4), always of a copy in tmp_path."""

import json
import os
import sys
import zipfile

import pytest

from conftest import copy_fixture
from orcaone import backup, instances


@pytest.fixture
def snorca(fake_home, tmp_path):
    data_dir = copy_fixture("snorca", tmp_path / "copy" / "Snapmaker_Orca")
    return instances.load_instance(data_dir.resolve(), "manual")


def names_in(zip_path):
    with zipfile.ZipFile(zip_path) as zf:
        return {backup.entry_path(info) + ("/" if info.is_dir() else "") for info in zf.infolist()}


def test_backup_holds_everything_but_the_excluded(snorca):
    root = snorca.data_dir
    for rel in ("log/a.log", "cache/1.lock", "web/x.js", "hms/h.json", "ota/o.bin", "user/Temp/p.json",
                "user/default/temp/rest.json", "user_backup-v2.4.0/default/x.json", "user/hints.cereal",
                "printers/p.json", ".snapmaker_orca_machine_id"):
        (root / rel).parent.mkdir(parents=True, exist_ok=True)
        (root / rel).write_text("x", encoding="utf-8")
    made = backup.create(snorca, "manual")
    zip_path = backup.backup_dir(snorca.id) / f"{made['name']}.zip"
    names = names_in(zip_path)
    for rel in ("Snapmaker_Orca.conf", "user/default/filament/Mein PLA.json", "user/default/filament/Mein PLA.info",
                "system/Snapmaker.json", "system/OrcaFilamentLibrary/filament/SUNLU/SUNLU PLA+ @System.json",
                "user/hints.cereal", "printers/p.json", ".snapmaker_orca_machine_id", "user/default/filament/",
                backup.MANIFEST):
        assert rel in names, rel
    for rel in names:
        assert not rel.startswith(("log/", "cache/", "web/", "hms/", "ota/", "user/Temp", "user/default/temp",
                                   "user_backup-v")), rel
    with zipfile.ZipFile(zip_path) as zf:
        manifest = json.loads(zf.read(backup.MANIFEST))
        assert zf.read("Snapmaker_Orca.conf") == (root / "Snapmaker_Orca.conf").read_bytes()
    assert (manifest["reason"], manifest["slicer"], manifest["version"], manifest["data_dir"]) == (
        "manual", "Snapmaker_Orca", "2.4.0", str(root))
    assert "user/default/filament/Mein PLA.json" in manifest["files"]
    assert len(manifest["files"]) == made["files"]
    assert made["name"].endswith("_manual") and made["size"] == zip_path.stat().st_size
    assert zip_path.parent == instances.orcaone_data_dir() / "backups" / snorca.id
    if os.name == "posix":
        assert zip_path.stat().st_mode & 0o777 == 0o600
        assert zip_path.parent.stat().st_mode & 0o777 == 0o700


@pytest.mark.skipif(not sys.platform.startswith("linux"), reason="file names are bytes on Linux only")
def test_names_that_are_not_utf8_come_back_unchanged(snorca):
    raw = b"Mein PLA f\xfcr U1.json"
    folder = os.fsencode(snorca.data_dir / "user" / "default" / "filament")
    with open(os.path.join(folder, raw), "wb") as file:
        file.write(b"{}")
    made = backup.create(snorca, "manual")
    files, _ = backup.restorable(snorca, made["name"])
    rel = os.fsdecode(b"user/default/filament/" + raw)
    assert files[rel] == b"{}"
    assert os.fsencode(rel) == b"user/default/filament/" + raw


def test_list_sort_and_delete(snorca):
    first = backup.create(snorca, "manual")
    second = backup.create(snorca, "before_change", {"ops": ["filament_visible"]})
    third = backup.create(snorca, "manual")
    listed = backup.list_backups(snorca.id)
    assert [b["name"] for b in listed] == [third["name"], second["name"], first["name"]]
    assert listed[1]["reason_params"] == {"ops": ["filament_visible"]}
    backup.delete(snorca.id, second["name"])
    assert [b["name"] for b in backup.list_backups(snorca.id)] == [third["name"], first["name"]]
    for name in (second["name"], "../x", "x.zip", ""):
        with pytest.raises(backup.BackupError) as err:
            backup.delete(snorca.id, name)
        assert err.value.code == "backup_not_found"


def test_a_broken_backup_is_listed_as_such(snorca):
    folder = backup.backup_dir(snorca.id)
    folder.mkdir(parents=True)
    (folder / "2026-09-22_120000_manual.zip").write_bytes(b"kein zip")
    [entry] = backup.list_backups(snorca.id)
    assert entry["error"] == "backup_unreadable"
    with pytest.raises(backup.BackupError) as err:
        backup.restorable(snorca, entry["name"])
    assert err.value.code == "backup_unreadable"


def test_restorable_is_conf_and_user_only(snorca):
    made = backup.create(snorca, "manual")
    files, dirs = backup.restorable(snorca, made["name"])
    assert set(files) == {"Snapmaker_Orca.conf", "user/default/filament/Mein PLA.json",
                          "user/default/filament/Mein PLA.info", "user/default/filament/Altes PETG.json",
                          "user/default/filament/Altes PETG.info", "user/default/machine/Mein U1.json",
                          "user/default/machine/Mein U1.info"}
    assert dirs == {"user", "user/default", "user/default/filament", "user/default/machine"}


def test_unreadable_file_fails_the_backup(snorca):
    if os.name != "posix" or os.geteuid() == 0:
        pytest.skip("needs file permissions")
    locked = snorca.data_dir / "user" / "default" / "filament" / "Mein PLA.json"
    os.chmod(locked, 0)
    try:
        with pytest.raises(backup.BackupError) as err:
            backup.create(snorca, "manual")
    finally:
        os.chmod(locked, 0o644)
    assert err.value.code == "backup_failed"
    assert backup.list_backups(snorca.id) == []
    assert not list(backup.backup_dir(snorca.id).iterdir())


def test_unreadable_folder_fails_the_backup(snorca):
    if os.name != "posix" or os.geteuid() == 0:
        pytest.skip("needs file permissions")
    locked = snorca.data_dir / "user" / "default" / "process"
    locked.mkdir()
    os.chmod(locked, 0)
    try:
        with pytest.raises(backup.BackupError) as err:
            backup.create(snorca, "manual")
    finally:
        os.chmod(locked, 0o755)
    assert err.value.code == "backup_failed"
    assert backup.list_backups(snorca.id) == []


def test_backups_made_as_orfix_stay_readable(snorca):
    made = backup.create(snorca, "manual")
    path = backup.backup_path(snorca.id, made["name"])
    # The same ZIP as the app wrote it under its old name.
    with zipfile.ZipFile(path) as zf:
        items = [(i, zf.read(i)) for i in zf.infolist()]
    with zipfile.ZipFile(path, "w") as zf:
        for info, data in items:
            if info.filename == backup.MANIFEST:
                info.filename = backup.OLD_MANIFEST
            zf.writestr(info, data)
    listed = [b for b in backup.list_backups(snorca.id) if b["name"] == made["name"]][0]
    assert "error" not in listed and listed["reason"] == "manual" and listed["files"] == made["files"]
    files, _ = backup.restorable(snorca, made["name"])
    assert "Snapmaker_Orca.conf" in files

