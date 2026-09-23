import json
import os
import sys

import pytest

from conftest import FIXTURES, copy_fixture
from orcaone import scanner
from test_opc import patched

SNORCA = FIXTURES / "snorca"
ORCA = FIXTURES / "orca"


def write_profile(folder, name, body):
    folder.mkdir(parents=True, exist_ok=True)
    (folder / f"{name}.json").write_text(json.dumps(body, indent=4) + "\n", encoding="utf-8")


def test_snorca_packages_and_library_without_manifest():
    scan = scanner.scan(SNORCA, "Snapmaker_Orca")
    packages = {p.name: p for p in scan.packages}
    assert scan.storage == "json" and sorted(packages) == ["OrcaFilamentLibrary", "Snapmaker"]
    library, vendor = packages["OrcaFilamentLibrary"], packages["Snapmaker"]
    assert library.manifest_empty and library.counts["filament"] == 12
    assert vendor.version == "02.03.03.03" and vendor.models == 1
    # Files the manifest does not list are no profiles (FINDINGS 4.2).
    assert vendor.extra_files == ["filament/filament_allow_list.json", "process/0.24 Standard @Snapmaker (0.8 nozzle).json"]
    assert ("Snapmaker", "process", "0.24 Standard @Snapmaker (0.8 nozzle)") not in scan.profiles
    # The name counts, not the file name ("SUNLU Marble PLA @System.json").
    marble = scan.profiles[("OrcaFilamentLibrary", "filament", "SUNLU PLA Marble @System")]
    assert marble.inherits == "SUNLU PLA Marble @base"


def test_implicit_renamed_from():
    scan = scanner.scan(SNORCA, "Snapmaker_Orca")
    assert scan.profiles[("OrcaFilamentLibrary", "filament", "SUNLU PLA+ @System")].renamed_from == ["SUNLU PLA+ System"]
    # An explicit renamed_from replaces the implicit one.
    assert scan.profiles[("OrcaFilamentLibrary", "filament", "Generic PLA @System")].renamed_from == ["My Generic PLA"]


def test_own_profiles_of_the_fixture():
    scan = scanner.scan(SNORCA, "Snapmaker_Orca")
    assert scan.active_folder == "default"
    own = [(p.kind, p.name, p.inherits, p.problem) for p in scan.own]
    assert own == [
        ("filament", "Altes PETG", "Snapmaker PETG @U1 alt", None),
        ("filament", "Mein PLA", "Snapmaker PLA Basic @U1", None),
        ("machine", "Mein U1", "Snapmaker U1 (0.4 nozzle)", None),
    ]
    mein_pla = scan.own[1]
    assert mein_pla.file == "user/default/filament/Mein PLA.json"
    assert mein_pla.values == {"filament_settings_id": ["Mein PLA"], "nozzle_temperature": ["215"]}
    assert mein_pla.info == {"sync_info": "", "user_id": "", "setting_id": "", "base_id": "1195313935011",
                             "updated_time": "1758520000"}


def test_names_problems_and_load_order(tmp_path):
    data = copy_fixture("snorca", tmp_path / "snorca")
    filament = data / "user" / "default" / "filament"
    write_profile(filament, "Datei", {"name": "Anderer Name", "version": "2.3.3.3", "from": "User"})
    write_profile(filament, "Ohne Version", {"name": "Ohne Version", "from": "User"})
    write_profile(filament, "Drucker hier", {"name": "Drucker hier", "version": "1.0", "type": "machine"})
    write_profile(filament / "base", "Wurzel", {"name": "Wurzel", "version": "2.3.3.3"})
    (filament / "Kaputt.json").write_text("{ nicht json", encoding="utf-8")

    scan = scanner.scan(data, "Snapmaker_Orca")
    own = {p.file.rsplit("/", 1)[-1]: p for p in scan.own}
    # Snapmaker Orca takes the name field (FINDINGS 4.4).
    assert (own["Datei.json"].name, own["Datei.json"].json_name) == ("Anderer Name", "Anderer Name")
    assert own["Ohne Version.json"].problem == "bad_version"
    assert own["Drucker hier.json"].problem == "wrong_type"
    assert own["Kaputt.json"].problem == "invalid_json"
    # base/ is loaded before the folder itself.
    assert own["Wurzel.json"].load_pass < own["Datei.json"].load_pass


def test_orca_takes_the_file_name_and_reads_bundles(tmp_path):
    data = copy_fixture("orca", tmp_path / "orca")
    user = data / "user" / "default"
    write_profile(user / "filament", "Datei", {"name": "Anderer Name", "version": "2.5.0.0", "type": "machine"})
    bundle = user / "_local" / "ordner"
    write_profile(bundle / "filament", "Paket PLA", {"name": "Paket PLA", "version": "2.5.0.0"})
    (bundle / "bundle_metadata.json").write_text(json.dumps({"id": "abc123", "name": "Paket"}), encoding="utf-8")
    write_profile(user / "_local" / "ohne-metadaten" / "filament", "Fehlt", {"name": "Fehlt", "version": "2.5.0.0"})

    scan = scanner.scan(data, "OrcaSlicer")
    names = [(p.name, p.json_name, p.problem, p.bundle) for p in scan.own]
    # OrcaSlicer takes the file name and has no type check. Bundles come first
    # (PresetBundle::load_user_presets), a folder without metadata is ignored.
    assert names == [("_local/abc123/Paket PLA", None, None, "_local/abc123"),
                     ("Datei", "Anderer Name", None, None)]
    assert [p.origin_kind for p in scan.own] == ["bundle", "user"]
    assert scan.bundles == {"_local/abc123": "Paket"}


def test_orca_packages_come_from_opc():
    scan = scanner.scan(ORCA, "OrcaSlicer")
    assert scan.storage == "opc"
    assert [(p.name, p.format, p.version) for p in scan.packages] == [
        ("Custom", "opc", "2.4.0.5"), ("OrcaFilamentLibrary", "opc", "2.4.0.8"), ("Snapmaker", "opc", "2.4.0.15")]
    printer = scan.profiles[("Snapmaker", "machine", "Snapmaker U1 (0.4+0.6 nozzle)")]
    assert printer.values["printer_variant"] == "0.4+0.6"


def test_unknown_opc_version_marks_the_package(tmp_path):
    data = copy_fixture("orca", tmp_path / "orca")
    cache = data / "system" / "Snapmaker.opc"
    cache.write_bytes(patched(cache.read_bytes(), header_version=7))
    scan = scanner.scan(data, "OrcaSlicer")
    snapmaker = next(p for p in scan.packages if p.name == "Snapmaker")
    assert (snapmaker.format, snapmaker.error) == ("opc", "opc_unsupported_version")
    assert not any(key[0] == "Snapmaker" for key in scan.profiles)


def test_json_beside_an_older_opc_wins(tmp_path):
    data = copy_fixture("orca", tmp_path / "orca")
    manifest = {"name": "Custom", "version": "02.05.00.00", "machine_model_list": [], "machine_list": [],
                "process_list": [], "filament_list": [{"name": "Nur JSON", "sub_path": "filament/Nur JSON.json"}]}
    (data / "system" / "Custom.json").write_text(json.dumps(manifest), encoding="utf-8")
    write_profile(data / "system" / "Custom" / "filament", "Nur JSON", {"name": "Nur JSON", "type": "filament"})
    scan = scanner.scan(data, "OrcaSlicer")
    custom = next(p for p in scan.packages if p.name == "Custom")
    assert custom.format == "json" and ("Custom", "filament", "Nur JSON") in scan.profiles


def test_tree_categories_and_notes():
    scan = scanner.scan(SNORCA, "Snapmaker_Orca")
    tree = scanner.tree(scan, {"user/default/filament/Altes PETG.json": "parent_missing"}, False)
    top = {n["name"]: n for n in tree}
    assert [n["category"] for n in tree] == sorted((n["category"] for n in tree), key=scanner.CATEGORY_ORDER.index)
    assert (top["Snapmaker_Orca.conf"]["category"], top["Snapmaker_Orca.conf"]["note"]) == ("managed", "conf")
    assert "secret" not in top["Snapmaker_Orca.conf"]
    account = top["user"]["children"][0]
    assert (account["name"], account["note"], account["active"]) == ("default", "account_default", True)
    filaments = next(k for k in account["children"] if k["name"] == "filament")
    rows = {r["name"]: r for r in filaments["children"]}
    assert rows["Mein PLA"]["type"] == "profile" and rows["Mein PLA"]["files"] == 2
    assert rows["Altes PETG"]["ignored"] == "parent_missing"
    system = {n["name"]: n for n in top["system"]["children"]}
    library = system["OrcaFilamentLibrary"]
    assert (library["note"], library["manifest_empty"], library["package"]) == ("package_folder", True, "OrcaFilamentLibrary")
    assert system["Snapmaker.json"]["note"] == "package_manifest" and system["Snapmaker.json"]["version"] == "2.3.3.3"
    extras = {x["path"]: x["note"] for x in system["Snapmaker"]["extra_files"]}
    assert extras == {"system/Snapmaker/filament/filament_allow_list.json": "vendor_extra",
                      "system/Snapmaker/process/0.24 Standard @Snapmaker (0.8 nozzle).json": "unlisted_profile"}


def test_backup_leaves_out_logs_caches_and_temp(tmp_path):
    data = copy_fixture("snorca", tmp_path / "snorca")
    for rel in ("log/a.log", "cache/1.lock", "web/x", "hms/x", "ota/x", "user/Temp/x.json",
                "user/default/temp/x.json", "user_backup-v2.4.0/x.json"):
        (data / rel).parent.mkdir(parents=True, exist_ok=True)
        (data / rel).write_text("x", encoding="utf-8")
    raw, zipped, files = scanner.backup_measure(data)
    expected = [p for p in (data).rglob("*") if p.is_file() and scanner.in_backup(p.relative_to(data))]
    assert files == len(expected) == sum(1 for p in SNORCA.rglob("*") if p.is_file())
    assert raw == sum(p.stat().st_size for p in expected) and 0 < zipped < raw


@pytest.mark.skipif(not sys.platform.startswith("linux"), reason="the web view folders exist on Linux only")
def test_outside_folders(fake_home):
    (fake_home / ".cache" / "snapmaker-orca").mkdir(parents=True)
    (fake_home / ".cache" / "snapmaker-orca" / "x").write_text("12345", encoding="utf-8")
    assert scanner.outside("Snapmaker_Orca") == [
        {"path": "~/.cache/snapmaker-orca", "size": 5, "files": 1, "category": "temp", "note": "webview_cache", "backup": False}]


def test_json_is_read_as_strictly_as_the_slicer_reads_it(tmp_path):
    data = copy_fixture("snorca", tmp_path / "snorca")
    filament = data / "user" / "default" / "filament"
    body = '{"name": "%s", "version": "2.3.3.3", "inherits": "Snapmaker PLA Basic @U1"%s}'
    # nlohmann::json skips a BOM (older Notepad), but knows neither NaN nor unpaired surrogates.
    (filament / "Mit BOM.json").write_bytes(b"\xef\xbb\xbf" + (body % ("Mit BOM", "")).encode())
    (filament / "NaN.json").write_text(body % ("NaN", ', "nozzle_temperature": [NaN]'), encoding="utf-8")
    (filament / "Surrogat.json").write_text(body % ("Surrogat\\ud800", ""), encoding="utf-8")
    (filament / "Emoji.json").write_text(body % ("Emoji \\ud83d\\ude00", ""), encoding="utf-8")
    # Every meta key is a string for the slicer (ConfigBase::load_from_json), "type" as well.
    write_profile(filament, "Typ Liste", {"name": "Typ Liste", "version": "2.3.3.3", "type": ["filament"]})
    scan = scanner.scan(data, "Snapmaker_Orca")
    own = {p.file.rsplit("/", 1)[-1]: p for p in scan.own}
    assert (own["Mit BOM.json"].name, own["Mit BOM.json"].problem) == ("Mit BOM", None)
    assert own["Emoji.json"].name == "Emoji \U0001F600" and own["Emoji.json"].problem is None
    assert [own[f].problem for f in ("NaN.json", "Surrogat.json", "Typ Liste.json")] == ["invalid_json"] * 3


def test_only_snorca_reads_the_library_from_its_folder(tmp_path):
    # OrcaSlicer loads nothing a manifest does not list, not even from the library (FINDINGS 4.2).
    data = copy_fixture("orca", tmp_path / "orca")
    (data / "system" / "OrcaFilamentLibrary.opc").unlink()
    manifest = {"name": "OrcaFilamentLibrary", "version": "02.04.00.09", "filament_list": [],
                "machine_model_list": [], "machine_list": [], "process_list": []}
    (data / "system" / "OrcaFilamentLibrary.json").write_text(json.dumps(manifest), encoding="utf-8")
    write_profile(data / "system" / "OrcaFilamentLibrary" / "filament", "Foo PLA", {"name": "Foo PLA", "type": "filament"})
    scan = scanner.scan(data, "OrcaSlicer")
    library = next(p for p in scan.packages if p.name == "OrcaFilamentLibrary")
    assert not library.manifest_empty and library.counts["filament"] == 0
    assert library.extra_files == ["filament/Foo PLA.json"]
    # Snapmaker Orca takes only filament/ and loads everything there as a filament.
    data = copy_fixture("snorca", tmp_path / "snorca")
    library = data / "system" / "OrcaFilamentLibrary"
    write_profile(library / "machine", "Drucker", {"name": "Drucker", "type": "machine"})
    write_profile(library / "filament", "Als Drucker", {"name": "Als Drucker", "type": "machine"})
    scan = scanner.scan(data, "Snapmaker_Orca")
    assert ("OrcaFilamentLibrary", "filament", "Als Drucker") in scan.profiles
    assert not any(key[2] == "Drucker" for key in scan.profiles)


def test_bundles_the_slicer_skips(tmp_path):
    data = copy_fixture("orca", tmp_path / "orca")
    local = data / "user" / "default" / "_local"
    for folder, meta in (("kaputt", "{ nicht json"), ("falscher-typ", '{"id": 5}'), ("ohne-id", '{"name": "Paket"}')):
        write_profile(local / folder / "filament", f"PLA {folder}", {"name": "x", "version": "2.5.0.0"})
        (local / folder / "bundle_metadata.json").write_text(meta, encoding="utf-8")
    scan = scanner.scan(data, "OrcaSlicer")
    # Unreadable metadata: the slicer skips the bundle. Without an id the name has no prefix
    # (get_preset_canonical_name).
    assert [(p.name, p.bundle) for p in scan.own if p.bundle] == [("PLA ohne-id", "_local/")]


def test_odd_types_in_system_files_do_not_stop_the_scan(tmp_path):
    data = copy_fixture("snorca", tmp_path / "snorca")
    manifest_path = data / "system" / "Snapmaker.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest["filament_list"] += [{"name": "a", "sub_path": 5}, {"name": "b", "sub_path": ["x"]}]
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
    colours = {"filaments": [
        {"filament_name": "Snapmaker PLA Basic @U1", "filament_color": [
            {"filament_color": ["#FF0000"], "color_name": "rot"}, {"filament_color": "#00FF00"}, 7]},
        {"filament_name": 5, "filament_color": [{"filament_color": ["#0000FF"]}]}]}
    (data / "system" / "Snapmaker" / "filament" / "filaments_colours.json").write_text(json.dumps(colours), encoding="utf-8")
    scan = scanner.scan(data, "Snapmaker_Orca")
    assert scan.colours == {("Snapmaker", "Snapmaker PLA Basic"): [{"hex": "#FF0000", "name": ""}]}
    assert next(p for p in scan.packages if p.name == "Snapmaker").counts["filament"] > 0


@pytest.mark.skipif(not sys.platform.startswith("linux"), reason="file names are bytes on Linux only")
def test_file_names_that_are_not_utf8(tmp_path):
    data = copy_fixture("snorca", tmp_path / "snorca")
    name = os.path.join(os.fsencode(data / "user" / "default" / "filament"), b"Mein PLA f\xfcr U1.json")
    with open(name, "wb") as file:
        file.write(b'{"name": "Mein PLA fuer U1", "version": "2.3.3.3", "inherits": "Snapmaker PLA Basic @U1"}')
    scan = scanner.scan(data, "Snapmaker_Orca")
    assert any(p.name == "Mein PLA fuer U1" for p in scan.own)
    assert scanner.backup_measure(data)[2] == sum(1 for p in data.rglob("*") if p.is_file())
