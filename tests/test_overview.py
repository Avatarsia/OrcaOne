import json

import pytest

from conftest import FIXTURES, copy_fixture
from orfix import instances, overview
from orfix.guard import SlicerProcess
from test_opc import patched

U1_02, U1_04 = "Snapmaker U1 (0.2 nozzle)", "Snapmaker U1 (0.4 nozzle)"


def build(path, processes=()):
    instance = instances.load_instance(path.resolve(), "manual")
    return overview.build_instance(instance, list(processes), manual=True)


@pytest.fixture
def snorca(fake_home):
    # fake_home keeps the web view folders and Orfix' own folder out of the real home.
    return build(FIXTURES / "snorca")


@pytest.fixture
def orca(fake_home):
    return build(FIXTURES / "orca")


def by_name(data):
    return {f["name"]: f for f in data["filaments"]}


def on(data, printer, status="visible", kind=None):
    return {f["name"] for f in data["filaments"] if f["printers"].get(printer, {}).get("status") == status
            and (kind is None or (f["origin_kind"] == "user") == (kind == "user"))}


def test_snorca_what_the_slicer_shows(snorca):
    """docs/STAND.md, reported on 22.09.: U1 0.4 shows ABS and PLA from Snapmaker."""
    assert on(snorca, U1_04, kind="system") == {"Snapmaker ABS @U1 0.4 nozzle", "Snapmaker PLA Basic @U1"}
    assert on(snorca, U1_04, kind="user") == {"Mein PLA"}
    assert on(snorca, U1_02) == {"Snapmaker ABS @U1 0.2 nozzle"}
    assert snorca["stats"]["per_printer"][U1_04] == {"visible": 3, "hidden": 5, "displaced": 1, "processes": 2}


def test_snorca_library(snorca):
    filaments = by_name(snorca)
    # SUNLU is hidden only by the list, nothing displaces it (FINDINGS 4.6, 4.7).
    for name in ("SUNLU PLA+ @System", "SUNLU PLA Marble @System"):
        assert {e["status"] for e in filaments[name]["printers"].values()} == {"hidden"}
        assert all(e["unlockable"] for e in filaments[name]["printers"].values())
    generic = filaments["Generic PLA @System"]["printers"]
    assert generic[U1_04] == {"status": "displaced", "displaced_by": ["Generic PLA"]}
    assert generic[U1_02] == {"status": "displaced", "displaced_by": ["Generic PLA @U1 0.2 nozzle"]}
    sunlu = filaments["SUNLU PLA+ @System"]
    assert (sunlu["chain"], sunlu["chain_complete"], sunlu["origin_kind"], sunlu["package"]) == (
        ["SUNLU PLA+ @base", "fdm_filament_pla", "fdm_filament_common"], True, "library", "OrcaFilamentLibrary")
    assert sunlu["values"]["filament_cost"] == {"value": "18.99", "own": False, "source": "SUNLU PLA+ @base"}
    hidden = next(w for w in snorca["warnings"] if w["code"] == "library_hidden")
    assert "SUNLU PLA+ @System" in hidden["names"]


def test_snorca_own_profiles(snorca):
    filaments = by_name(snorca)
    mine = filaments["Mein PLA"]
    assert (mine["origin_kind"], mine["file"], mine["in_list"]) == ("user", "user/default/filament/Mein PLA.json", True)
    assert mine["values"]["nozzle_temperature"]["inherited"] == {"value": "220", "source": "Snapmaker PLA Basic @U1"}
    # Account and cloud ids of the .info stay in the backend.
    assert mine["info"] == {"sync_info": "", "updated_time": 1758520000}
    orphan = filaments["Altes PETG"]
    assert (orphan["status"], orphan["problem"], orphan["inherits"], orphan["printers"]) == (
        "orphaned", "parent_missing", "Snapmaker PETG @U1 alt", {})
    warning = next(w for w in snorca["warnings"] if w["code"] == "orphaned")
    assert (warning["names"], warning["problem"], warning["level"]) == (["Altes PETG"], "parent_missing", "error")
    assert snorca["slicer_page"]["tree"][0]["name"] == "user"


def test_snorca_own_printer(snorca):
    own_model = snorca["models"][-1]
    assert (own_model["model"], own_model["own"], own_model["based_on"], own_model["origin"]) == (
        "Mein U1", True, "Snapmaker U1", "Snapmaker")
    # An own printer takes the filaments of its direct parent (FINDINGS 4.6).
    assert on(snorca, "Mein U1") == on(snorca, U1_04)
    page = snorca["printers_page"]
    [mine] = page["own"]
    assert (mine["visible"], mine["based_on_found"], mine["package"], mine["origin"], mine["cover"]) == (
        True, True, "Snapmaker", "own", "assets/printer-snapmaker-u1.png")
    [card] = page["system"]
    assert card["own_printers"] == ["Mein U1"] and card["drops_package"] is False
    assert page["default_printer"] == {"name": U1_04, "exists": True, "own": False, "model": "Snapmaker U1",
                                       "variant": "0.4", "cover": "assets/printer-snapmaker-u1.png"}


def test_snorca_dead_orca_presets_entry(snorca):
    """docs/STAND.md: the entry "Default Printer" was not found before."""
    page = snorca["printers_page"]
    assert page["remembered"] == 3
    assert page["dead_entries"] == [{"machine": "Default Printer", "process": "Default Setting",
                                     "filaments": ["AliZ PLA @System"], "reason": "default_printer"}]


def test_snorca_slicer_and_backups_page(snorca, fake_home):
    page = snorca["slicer_page"]
    assert (page["slicer"], page["version"], page["source"], page["user_folder"]) == (
        "Snapmaker Orca", "2.4.0", "manual", "user/default")
    assert page["conf"] == {"file": "Snapmaker_Orca.conf", "size": 6650, "indent": "spaces", "indent_width": 4,
                            "checksum": False, "sections": 9, "credentials": {}}
    assert page["system_refresh"] == {"value": True, "code": "every_start"}
    notes = {p["name"]: p["note"] for p in page["packages"]}
    assert notes == {"OrcaFilamentLibrary": "library", "Snapmaker": "installed_for"}
    assert page["profile_counts"]["filament"] == {"system": 24, "system_selectable": 11, "own": 2}
    backups = snorca["backups_page"]
    assert (backups["backups"], backups["count"], backups["total_size"]) == ([], 0, 0)
    assert backups["now"]["files"] == page["totals"]["backup_files"] > 0
    assert backups["location"].startswith("~/.local/share/orfix/backups/")


def test_snorca_top_level(snorca):
    assert (snorca["slicer"], snorca["app_key"], snorca["kind"], snorca["storage"]) == (
        "Snapmaker Orca", "Snapmaker_Orca", "snorca", "json")
    assert (snorca["running"], snorca["running_reason"], snorca["manual"]) == (False, None, True)
    assert snorca["filament_list"] == {"mode": "list", "count": 13}
    assert snorca["selected_printer"] == U1_04
    assert [w["name"] for w in snorca["without_printer"]][:2] == ["Snapmaker ABS", "Snapmaker ABS @0.2 nozzle"]
    json.dumps(snorca, allow_nan=False)


def test_running_slicer_is_reported(fake_home):
    process = SlicerProcess(4711, "Snapmaker_Orca", (FIXTURES / "snorca").resolve())
    data = build(FIXTURES / "snorca", [process])
    assert (data["running"], data["running_reason"]) == (True, {"code": "process", "pids": [4711], "lock": None})
    assert data["slicer_page"]["running"] is True


def test_orca(orca):
    assert (orca["kind"], orca["storage"], orca["version"]) == ("orca", "opc", "2.5.0-dev")
    models = {m["model"]: [p["variant"] for p in m["printers"]] for m in orca["models"]}
    assert models == {"Generic Klipper Printer": ["0.2", "0.4", "0.6", "0.8"],
                      "Snapmaker U1": ["0.2", "0.4", "0.4+0.6", "0.6", "0.8"]}
    # In Orca main Generic PLA @System stays for the U1, 23 other library profiles go (FINDINGS 4.6).
    assert "Generic PLA @System" in on(orca, U1_04)
    assert len(on(orca, U1_04, "displaced")) == 23
    assert orca["slicer_page"]["system_refresh"] == {"value": False, "code": "missing_only"}
    assert orca["slicer_page"]["conf"]["indent"] == "tab"
    assert orca["slicer_page"]["conf"]["credentials"] == {"access_code": 1}
    assert [c["drops_package"] for c in orca["printers_page"]["system"]] == [False, False]
    assert [p["format"] for p in orca["slicer_page"]["packages"]] == ["opc", "opc", "opc"]
    assert orca["warnings"] == [] and orca["printers_page"]["dead_entries"] == []


def test_unknown_opc_version_is_a_warning(fake_home, tmp_path):
    data_dir = copy_fixture("orca", tmp_path / "orca")
    cache = data_dir / "system" / "Snapmaker.opc"
    cache.write_bytes(patched(cache.read_bytes(), cache_version=2))
    data = build(data_dir)
    warning = next(w for w in data["warnings"] if w["code"] == "package_unreadable")
    assert (warning["names"], warning["problem"]) == (["Snapmaker"], "opc_unsupported_version")
    assert [m["model"] for m in data["models"] if m["printers"]] == ["Generic Klipper Printer"]
    package = next(p for p in data["slicer_page"]["packages"] if p["name"] == "Snapmaker")
    assert package["error"] == "opc_unsupported_version"


def test_profiles_on_an_unreadable_package_are_unresolved_not_orphaned(fake_home, tmp_path):
    """FINDINGS, .opc rules: with a package Orfix cannot read, own profiles whose parent is not
    found are "nicht auflösbar". They must not look orphaned and land in the clean-up."""
    data_dir = copy_fixture("orca", tmp_path / "orca")
    cache = data_dir / "system" / "Snapmaker.opc"
    cache.write_bytes(patched(cache.read_bytes(), cache_version=2))
    user = data_dir / "user" / "default"
    for kind, name, parent in (("filament", "Mein PLA", "Panchroma PLA @Snapmaker U1"),
                               ("machine", "Mein U1", "Snapmaker U1 (0.4 nozzle)")):
        (user / kind).mkdir(parents=True)
        (user / kind / f"{name}.json").write_text(json.dumps(
            {"name": name, "version": "2.5.0.0", "inherits": parent, "from": "User"}), encoding="utf-8")
    data = build(data_dir)
    filament = next(f for f in data["filaments"] if f["name"] == "Mein PLA")
    printer = next(p for p in data["printers_page"]["own"] if p["name"] == "Mein U1")
    assert (filament["status"], filament["problem"]) == ("unresolved", "parent_unreadable")
    assert (printer["status"], printer["problem"]) == ("unresolved", "parent_unreadable")
    assert {(w["code"], w["level"]) for w in data["warnings"] if w.get("problem") == "parent_unreadable"} == {
        ("unresolved", "warning")}
    # The last choice for the U1 may still be valid: no clean-up offer.
    assert data["printers_page"]["dead_entries"] == []


def test_build_all_finds_default_and_manual_instances(fake_home, monkeypatch, tmp_path):
    monkeypatch.setattr(overview.guard, "find_processes", lambda: [])
    monkeypatch.setattr(instances.platform, "system", lambda: "Linux")
    copy_fixture("snorca", fake_home / ".config" / "Snapmaker_Orca")
    manual = copy_fixture("orca", tmp_path / "portable" / "OrcaSlicer")
    instances.add_manual_path(str(manual))
    data = overview.build_all()
    assert [(i["kind"], i["source"], i["manual"]) for i in data["instances"]] == [
        ("snorca", "auto", False), ("orca", "manual", True)]
    assert [f["key"] for f in data["core_values"]][:2] == ["nozzle_temperature", "hot_plate_temp"]
    field = next(f for f in data["editable_fields"] if f["key"] == "hot_plate_temp")
    assert field == {"key": "hot_plate_temp", "group": "temperatures", "type": "int", "default": "45", "min": 0, "max": 300}
    assert data["instances"][0]["slicer_page"]["path"] == "~/.config/Snapmaker_Orca"


def test_one_unreadable_installation_does_not_hide_the_others(fake_home, monkeypatch, tmp_path):
    monkeypatch.setattr(overview.guard, "find_processes", lambda: [])
    monkeypatch.setattr(instances.platform, "system", lambda: "Linux")
    copy_fixture("snorca", fake_home / ".config" / "Snapmaker_Orca")
    copy_fixture("orca", fake_home / ".config" / "OrcaSlicer")
    real = overview.build_instance

    def build_instance(instance, *args, **kwargs):
        if instance.slicer == "OrcaSlicer":
            raise TypeError("a bug in Orfix")
        return real(instance, *args, **kwargs)

    monkeypatch.setattr(overview, "build_instance", build_instance)
    data = overview.build_all()
    assert [i["kind"] for i in data["instances"]] == ["snorca"]
    assert [(f["slicer"], f["path"], f["code"]) for f in data["failed"]] == [
        ("OrcaSlicer", "~/.config/OrcaSlicer", "scan_failed")]


def test_odd_types_in_hand_edited_files(fake_home, tmp_path):
    data_dir = copy_fixture("snorca", tmp_path / "snorca")
    conf_path = data_dir / "Snapmaker_Orca.conf"
    conf = json.loads(conf_path.read_text(encoding="utf-8"))
    conf["orca_presets"].append({"machine": ["Liste"], "process": ""})
    conf["models"].append({"vendor": ["Snapmaker"], "model": "Snapmaker U1", "nozzle_diameter": "0.4"})
    conf["models"].append({"vendor": "Snapmaker", "model": ["Snapmaker U1"], "nozzle_diameter": "0.4"})
    conf_path.write_text(json.dumps(conf, indent=4), encoding="utf-8")
    filament = data_dir / "user" / "default" / "filament"
    profile = json.loads((filament / "Mein PLA.json").read_text(encoding="utf-8"))
    profile["compatible_printers"] = [["Snapmaker U1 (0.4 nozzle)"], "Snapmaker U1 (0.4 nozzle)"]
    (filament / "Mein PLA.json").write_text(json.dumps(profile), encoding="utf-8")
    (filament / "Mein PLA.info").write_text("updated_time = " + "9" * 5000 + "\n", encoding="utf-8")
    data = build(data_dir)
    mein_pla = by_name(data)["Mein PLA"]
    assert mein_pla["compatible_printers"] == ["Snapmaker U1 (0.4 nozzle)"]
    assert mein_pla["info"]["updated_time"] is None
    assert [m["model"] for m in data["models"] if not m.get("own")] == ["Snapmaker U1"]
    assert all(isinstance(d["machine"], str) for d in data["printers_page"]["dead_entries"])
