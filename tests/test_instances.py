import json
from pathlib import Path

import pytest

from orfix import instances
from orfix.instances import add_manual_path, candidate_dirs, discover, load_instance, manual_paths, remove_manual_path


def make_data_dir(path: Path, key="Snapmaker_Orca", header="Snapmaker Orca 2.4.0", preset_folder="") -> Path:
    path.mkdir(parents=True)
    conf = {"app": {"preset_folder": preset_folder}, "header": header}
    (path / f"{key}.conf").write_text(json.dumps(conf, indent=4, sort_keys=True) + "\n", encoding="utf-8")
    return path


def test_linux_default_location_and_xdg(tmp_path):
    found = candidate_dirs("Linux", {}, tmp_path)
    assert (tmp_path / ".config" / "Snapmaker_Orca", "auto") in found
    assert (tmp_path / ".config" / "OrcaSlicer", "auto") in found

    found = candidate_dirs("Linux", {"XDG_CONFIG_HOME": str(tmp_path / "cfg")}, tmp_path)
    assert (tmp_path / "cfg" / "OrcaSlicer", "auto") in found
    assert (tmp_path / ".config" / "OrcaSlicer", "auto") not in found


def test_linux_flatpak_locations(tmp_path):
    other = tmp_path / ".var" / "app" / "org.example.Orca" / "config" / "OrcaSlicer"
    other.mkdir(parents=True)
    found = candidate_dirs("Linux", {}, tmp_path)
    app = tmp_path / ".var" / "app"
    assert (app / "io.github.Snapmaker.Snapmaker_Orca" / "config" / "Snapmaker_Orca", "flatpak") in found
    assert (app / "com.orcaslicer.OrcaSlicer" / "config" / "OrcaSlicer", "flatpak") in found
    assert (app / "io.github.softfever.OrcaSlicer" / "config" / "OrcaSlicer", "flatpak_legacy") in found
    assert (other, "flatpak") in found


def test_linux_portable_appimage(tmp_path):
    appimage = tmp_path / "Downloads" / "Snapmaker_Orca_V2.4.0.AppImage"
    appimage.parent.mkdir()
    appimage.write_bytes(b"")
    found = candidate_dirs("Linux", {}, tmp_path)
    assert (Path(f"{appimage}.config") / "Snapmaker_Orca", "appimage_portable") in found
    assert (Path(f"{appimage}.home") / ".config" / "Snapmaker_Orca", "appimage_portable") in found


def test_windows_and_macos_locations(tmp_path):
    found = candidate_dirs("Windows", {"APPDATA": str(tmp_path / "Roaming")}, tmp_path)
    assert found == [(tmp_path / "Roaming" / "Snapmaker_Orca", "auto"), (tmp_path / "Roaming" / "OrcaSlicer", "auto")]
    found = candidate_dirs("Windows", {}, tmp_path)
    assert (tmp_path / "AppData" / "Roaming" / "OrcaSlicer", "auto") in found
    found = candidate_dirs("Darwin", {}, tmp_path)
    assert (tmp_path / "Library" / "Application Support" / "OrcaSlicer", "auto") in found


def test_orfix_data_dir(tmp_path):
    assert instances.orfix_data_dir("Linux", {}, tmp_path) == tmp_path / ".local" / "share" / "orfix"
    assert instances.orfix_data_dir("Linux", {"XDG_DATA_HOME": "/data"}, tmp_path) == Path("/data/orfix")
    assert instances.orfix_data_dir("Windows", {"LOCALAPPDATA": "/local"}, tmp_path) == Path("/local/orfix")
    assert instances.orfix_data_dir("Darwin", {}, tmp_path) == tmp_path / "Library" / "Application Support" / "orfix"


def test_load_instance_reads_the_basic_facts(tmp_path):
    data_dir = make_data_dir(tmp_path / "Snapmaker_Orca", preset_folder="1234567")
    for folder in ("default", "1234567", "Temp"):
        (data_dir / "user" / folder).mkdir(parents=True)
    (data_dir / "system").mkdir()
    (data_dir / "system" / "Snapmaker.json").write_text("{}")
    (data_dir / "system" / "OrcaFilamentLibrary.opc").write_bytes(b"ZCRO")

    instance = load_instance(data_dir, "auto")
    assert instance.slicer == "Snapmaker_Orca"
    assert instance.version == "2.4.0"
    assert instance.logged_in and instance.active_user_folder == "1234567"
    assert instance.user_folders == ["1234567", "default"]
    assert instance.system_formats == ["json", "opc"]
    assert instance.conf_indent == "    " and not instance.conf_checksum
    assert instance.problems == []


def test_load_instance_versions_of_both_slicers(tmp_path):
    orca = make_data_dir(tmp_path / "OrcaSlicer", key="OrcaSlicer", header="OrcaSlicer 2.5.0-dev")
    instance = load_instance(orca, "auto")
    assert (instance.slicer, instance.version, instance.logged_in) == ("OrcaSlicer", "2.5.0-dev", False)
    assert instance.active_user_folder == "default"


def test_load_instance_with_broken_conf(tmp_path):
    data_dir = tmp_path / "OrcaSlicer"
    data_dir.mkdir()
    (data_dir / "OrcaSlicer.conf").write_text("{ not json")
    instance = load_instance(data_dir, "manual")
    assert instance.problems == ["conf_unreadable"]
    assert instance.version is None


def test_load_instance_on_the_snorca_fixture():
    fixture = Path(__file__).parent / "fixtures" / "snorca"
    instance = load_instance(fixture, "auto")
    assert (instance.slicer, instance.version, instance.logged_in) == ("Snapmaker_Orca", "2.4.0", False)
    assert instance.system_formats == ["json"]
    assert instance.conf_indent == "    "


def test_load_instance_ignores_folders_without_conf(tmp_path):
    assert load_instance(tmp_path, "auto") is None


def test_discover_finds_each_directory_once(fake_home, monkeypatch):
    monkeypatch.setattr(instances.platform, "system", lambda: "Linux")
    data_dir = make_data_dir(fake_home / ".config" / "Snapmaker_Orca")
    add_manual_path(str(data_dir))
    found = discover([data_dir])
    assert [(i.data_dir, i.source) for i in found] == [(data_dir.resolve(), "auto")]


def test_manual_paths(fake_home):
    data_dir = make_data_dir(fake_home / "portable" / "OrcaSlicer", key="OrcaSlicer", header="OrcaSlicer 2.4.2")
    instance = add_manual_path(f"  {data_dir}  ")
    assert instance.source == "manual" and instance.version == "2.4.2"
    add_manual_path(str(data_dir))
    assert manual_paths() == [str(data_dir.resolve())]

    remove_manual_path(str(data_dir.resolve()))
    assert manual_paths() == []


def test_manual_path_errors(fake_home):
    with pytest.raises(ValueError, match="path_not_found"):
        add_manual_path(str(fake_home / "missing"))
    with pytest.raises(ValueError, match="path_not_found"):
        add_manual_path("   ")
    with pytest.raises(ValueError, match="not_a_data_dir"):
        add_manual_path(str(fake_home))
    with pytest.raises(ValueError, match="path_not_found"):
        remove_manual_path("/never/added")
