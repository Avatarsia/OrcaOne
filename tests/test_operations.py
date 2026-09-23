"""Changes planned and written by orcaone/operations.py, always on a copy of a fixture in tmp_path
that is registered as added by hand (hard rule 1). Each result is read back with OrcaOne's own
scanner and resolver, the way the page shows it."""

import json
import os
import sys

import pytest

from conftest import BUNDLE, FIXTURES, add_bundle, copy_fixture
from orcaone import backup, guard, instances, operations, overview
from orcaone.conf import ConfFile, dump_conf, parse_conf
from orcaone.guard import SlicerProcess

U1 = [f"Snapmaker U1 ({d} nozzle)" for d in ("0.2", "0.4", "0.6", "0.8")]
U1_02, U1_04 = U1[0], U1[1]
FOLDER = "user/default/filament"
WITHOUT_PRINTER = ["Snapmaker ABS", "Snapmaker ABS @0.2 nozzle", "Snapmaker ABS @Dual", "Snapmaker ABS @Dual 0.2 nozzle",
                   "Snapmaker ABS @Dual 0.8 nozzle", "Snapmaker ABS @J1", "Snapmaker ABS @J1 0.2 nozzle",
                   "Snapmaker ABS @J1 0.8 nozzle"]


@pytest.fixture
def isolated(fake_home, monkeypatch):
    monkeypatch.setattr(guard, "find_processes", lambda: [])
    monkeypatch.setattr(instances.platform, "system", lambda: "Linux")
    return fake_home


def manual_copy(tmp_path, fixture="snorca"):
    key = "Snapmaker_Orca" if fixture == "snorca" else "OrcaSlicer"
    data_dir = copy_fixture(fixture, tmp_path / "copy" / key)
    instances.add_manual_path(str(data_dir))
    return instance_of(data_dir)


def instance_of(data_dir):
    return operations.find_instance(instances.instance_id(data_dir.resolve()))[0]


@pytest.fixture
def snorca(isolated, tmp_path):
    return manual_copy(tmp_path)


@pytest.fixture
def orca(isolated, tmp_path):
    return manual_copy(tmp_path, "orca")


def plan(instance, *changes, processes=()):
    return operations.make_plan(instance, list(processes), list(changes))


def run(instance, *changes):
    """Plan and write; the plan must not be blocked."""
    made = plan(instance, *changes)
    assert made["blocked"] is None, made
    result = operations.apply(instance.id, made["id"])
    assert result["ok"] and result["warnings"] == [], result
    return made, result


def view(instance):
    return overview.build_instance(instance_of(instance.data_dir), [], manual=True)


def shown(data, printer, kind=None):
    return {f["name"] for f in data["filaments"] if f["printers"].get(printer, {}).get("status") == "visible"
            and (kind is None or (f["origin_kind"] == "user") == (kind == "user"))}


def conf_path(instance):
    return instance.data_dir / f"{instance.slicer}.conf"


def conf_of(instance):
    return json.loads(conf_path(instance).read_text(encoding="utf-8"))


def edit_conf(instance, change):
    """Change the .conf of the copy by hand, in the slicer's format."""
    conf = parse_conf(conf_path(instance).read_bytes())
    change(conf.data)
    conf_path(instance).write_bytes(dump_conf(conf))


def restorable_files(instance):
    """Bytes of everything a restore puts back: the .conf and user/**."""
    root = instance.data_dir
    out = {conf_path(instance).name: conf_path(instance).read_bytes()}
    for path in sorted((root / "user").rglob("*")) if (root / "user").is_dir() else []:
        out[path.relative_to(root).as_posix() + ("/" if path.is_dir() else "")] = \
            None if path.is_dir() else path.read_bytes()
    return out


# ---------------------------------------------------------------- filament_visible

def test_unlock_library_filament_way_a(snorca):
    """TEST-VERGLEICH B1: SUNLU PLA+ shows at every U1 nozzle, the .conf changes in one key only."""
    before = conf_path(snorca).read_bytes()
    made, result = run(snorca, {"op": "filament_visible", "name": "SUNLU PLA+ @System", "visible": True})
    assert made["ops"] == [{"action": "modify", "path": "Snapmaker_Orca.conf", "what": "conf",
                            "params": {"keys": ["filaments"]}}]
    [diff] = made["conf_diff"]
    assert diff["path"] == "filaments" and diff["after"] == sorted(diff["before"] + ["SUNLU PLA+ @System"])
    assert {"code": "unlock_fragile", "name": "SUNLU PLA+ @System"} in made["warnings"]
    # Byte for byte the old file except for the one key.
    after = parse_conf(conf_path(snorca).read_bytes())
    original = parse_conf(before)
    original.data["filaments"] = after.data["filaments"]
    assert dump_conf(original) == conf_path(snorca).read_bytes()
    data = view(snorca)
    for printer in U1 + ["Mein U1"]:
        assert "SUNLU PLA+ @System" in shown(data, printer), printer
    assert instances.load_unlocks(snorca.id) == ["SUNLU PLA+ @System"]
    assert not any(w["code"] == "unlock_lost" for w in data["warnings"])
    assert result["backup"]["reason"] == "before_change" and result["applied"] == 1


def test_the_wizard_drops_an_unlock(snorca):
    """TEST-VERGLEICH B6: the wizard rewrites "filaments", OrcaOne reports the lost unlock."""
    run(snorca, {"op": "filament_visible", "name": "SUNLU PLA+ @System", "visible": True})
    edit_conf(snorca, lambda c: c["filaments"].remove("SUNLU PLA+ @System"))
    lost = next(w for w in view(snorca)["warnings"] if w["code"] == "unlock_lost")
    assert (lost["names"], lost["level"]) == (["SUNLU PLA+ @System"], "warning")


def test_hide_filaments_without_printer(snorca):
    """TEST-VERGLEICH B3: the 8 names go, the U1 looks the same, the list never gets empty."""
    before = view(snorca)
    run(snorca, *[{"op": "filament_visible", "name": n, "visible": False} for n in WITHOUT_PRINTER])
    after = view(snorca)
    assert conf_of(snorca)["filaments"] == ["Snapmaker ABS @U1 0.2 nozzle", "Snapmaker ABS @U1 0.4 nozzle",
                                            "Snapmaker ABS @U1 0.6 nozzle", "Snapmaker ABS @U1 0.8 nozzle",
                                            "Snapmaker PLA Basic @U1"]
    # Only names the fixture does not have are left over.
    assert [w["exists"] for w in after["without_printer"]] == [False, False]
    for printer in U1:
        assert shown(after, printer) == shown(before, printer)


def test_filaments_never_become_empty(snorca):
    names = conf_of(snorca)["filaments"]
    before = conf_path(snorca).read_bytes()
    made = plan(snorca, *[{"op": "filament_visible", "name": n, "visible": False} for n in names])
    assert made["blocked"] == "filaments_would_be_empty"
    assert made["blocked_params"]["change"] == len(names) - 1
    with pytest.raises(operations.OperationError) as err:
        operations.apply(snorca.id, made["id"])
    assert err.value.code == "filaments_would_be_empty"
    assert conf_path(snorca).read_bytes() == before
    assert backup.list_backups(snorca.id) == []


def test_orca_switches_default_materials_on_again(orca):
    """FINDINGS 4.6: at its start OrcaSlicer switches the default_materials of a printer model on
    again for a printer without a listed filament that fits. The plan says so."""
    names = sorted(shown(view(orca), U1_04, "system"))
    made = plan(orca, *[{"op": "filament_visible", "name": n, "visible": False} for n in names])
    back = [w for w in made["warnings"] if w["code"] == "default_materials_back"]
    u1 = next(w for w in back if U1_04 in w["printers"])
    # The SnapSpeed ones of the model stay in the list, only the rest comes back.
    assert u1["names"] == ["Generic PLA @System", "Panchroma PLA @Snapmaker U1"]
    assert U1_02 not in u1["printers"]
    made = plan(orca, {"op": "filament_visible", "name": names[0], "visible": False})
    assert not [w for w in made["warnings"] if w["code"] == "default_materials_back"]


def test_visible_when_everything_is_visible(snorca):
    edit_conf(snorca, lambda c: c.update(filaments=None))
    made = plan(snorca, {"op": "filament_visible", "name": "SUNLU PLA+ @System", "visible": True})
    assert (made["ops"], made["blocked"]) == ([], None)
    assert [w["code"] for w in made["warnings"]] == ["already_visible", "nothing_to_do"]
    # Hiding one then needs a list of all the others.
    made = plan(snorca, {"op": "filament_visible", "name": "SUNLU PLA+ @System", "visible": False})
    [diff] = made["conf_diff"]
    assert "SUNLU PLA+ @System" not in diff["after"] and "SUNLU PLA Marble @System" in diff["after"]
    assert {"code": "list_created", "count": len(diff["after"])} in made["warnings"]


def test_visible_unknown_names(snorca):
    for visible in (True, False):
        made = plan(snorca, {"op": "filament_visible", "name": "Gibt es nicht", "visible": visible})
        assert (made["blocked"], made["blocked_params"]) == ("unknown_profile", {"change": 0, "name": "Gibt es nicht"})
    # Abstract profiles are not selectable.
    assert plan(snorca, {"op": "filament_visible", "name": "SUNLU PLA+ @base", "visible": True})["blocked"] == "unknown_profile"


# ---------------------------------------------------------------- filament_bind

def test_bind_library_filament_way_b(snorca):
    """TEST-VERGLEICH B2: an own profile on top of the library profile, for U1 0.4 only."""
    made, _ = run(snorca, {"op": "filament_bind", "base": "SUNLU PLA Marble @System", "name": "SUNLU Marble U1",
                           "printers": [U1_04]})
    assert [(o["action"], o["path"]) for o in made["ops"]] == [
        ("create", f"{FOLDER}/SUNLU Marble U1.json"), ("create", f"{FOLDER}/SUNLU Marble U1.info")]
    raw = (snorca.data_dir / FOLDER / "SUNLU Marble U1.json").read_bytes()
    assert raw == (b'{\n    "compatible_printers": [\n        "Snapmaker U1 (0.4 nozzle)"\n    ],\n'
                   b'    "filament_settings_id": [\n        "SUNLU Marble U1"\n    ],\n    "from": "User",\n'
                   b'    "inherits": "SUNLU PLA Marble @System",\n    "name": "SUNLU Marble U1",\n'
                   b'    "version": "2.4.0"\n}\n')
    info = (snorca.data_dir / FOLDER / "SUNLU Marble U1.info").read_text(encoding="utf-8").splitlines()
    assert info[:4] == ["sync_info = ", "user_id = ", "setting_id = ", "base_id = OSNLS06"]
    assert info[4].startswith("updated_time = ") and int(info[4].split(" = ")[1]) > 1758520000
    data = view(snorca)
    record = next(f for f in data["filaments"] if f["name"] == "SUNLU Marble U1")
    assert record["helper"] is True and "status" not in record
    assert set(record["printers"]) == {U1_04, "Mein U1"}
    assert "SUNLU Marble U1" in shown(data, U1_04, "user")
    assert "SUNLU Marble U1" not in shown(data, U1_02)


@pytest.mark.parametrize("name, code", [
    ("Mein PLA", "name_taken"), ("mein pla", "name_taken"), ("SUNLU PLA+ @System", "name_taken"),
    ("Default Filament", "name_taken"), ("a/b", "name_invalid"), ("a\\b", "name_invalid"), ("CON", "name_invalid"),
    ("x.json", "name_invalid"), (" PLA", "name_invalid"), ("PLA.", "name_invalid"), ("", "name_invalid"),
    ("PLA: gut", "name_invalid"), ("x" * 121, "name_too_long"), ("\U0001F600" * 63, "name_too_long"),
])
def test_bind_refuses_names(snorca, name, code):
    made = plan(snorca, {"op": "filament_bind", "base": "SUNLU PLA+ @System", "name": name, "printers": [U1_04]})
    assert made["blocked"] == code


def test_bind_refuses_parents_and_printers(snorca):
    def blocked(base, printers):
        return plan(snorca, {"op": "filament_bind", "base": base, "name": "Neu", "printers": printers})["blocked"]
    assert blocked("Gibt es nicht", [U1_04]) == "unknown_profile"
    assert blocked("SUNLU PLA+ @base", [U1_04]) == "parent_not_selectable"
    assert blocked("fdm_filament_pla", [U1_04]) == "parent_not_selectable"
    assert blocked("SUNLU PLA+ @System", ["Kein Drucker"]) == "unknown_profile"
    assert blocked("SUNLU PLA+ @System", ["Mein U1"]) is None


def test_bind_twice_in_one_plan(snorca):
    made = plan(snorca, *[{"op": "filament_bind", "base": "SUNLU PLA+ @System", "name": "Doppelt", "printers": []}] * 2)
    assert (made["blocked"], made["blocked_params"]["change"]) == ("name_taken", 1)


def test_invalid_changes(snorca):
    for change in ({"op": "nope"}, {"name": "x"}, "text", {"op": "filament_visible", "name": "x"},
                   {"op": "filament_visible", "name": 1, "visible": True},
                   {"op": "filament_bind", "base": "SUNLU PLA+ @System", "name": "x", "printers": "U1"},
                   {"op": "filament_create", "base": "SUNLU PLA+ @System", "name": "x", "values": {"name": "y"}},
                   {"op": "filament_create", "base": "SUNLU PLA+ @System", "name": "x", "values": {"a": 1}},
                   {"op": "filament_update", "name": "Mein PLA", "reset": ["inherits"]}):
        with pytest.raises(operations.InvalidChange):
            plan(snorca, change)


# ---------------------------------------------------------------- filament_create

def test_create_own_variant(snorca):
    """TEST-VERGLEICH B4: inherits and nozzle_temperature only, the rest as PLA Basic."""
    made, _ = run(snorca, {"op": "filament_create", "base": "Snapmaker PLA Basic @U1", "name": "PLA 215",
                           "values": {"nozzle_temperature": "215", "hot_plate_temp": "65"}, "printers": None})
    assert made["ops"][0]["params"] == {"name": "PLA 215", "kind": "filament", "inherits": "Snapmaker PLA Basic @U1",
                                        "keys": ["nozzle_temperature"]}
    saved = json.loads((snorca.data_dir / FOLDER / "PLA 215.json").read_text(encoding="utf-8"))
    # hot_plate_temp 65 is what PLA Basic has anyway: only differences are saved.
    assert saved == {"filament_settings_id": ["PLA 215"], "from": "User", "inherits": "Snapmaker PLA Basic @U1",
                     "name": "PLA 215", "nozzle_temperature": ["215"], "version": "2.4.0"}
    assert "base_id = 1195313935011" in (snorca.data_dir / FOLDER / "PLA 215.info").read_text(encoding="utf-8")
    data = view(snorca)
    record = next(f for f in data["filaments"] if f["name"] == "PLA 215")
    assert record["values"]["nozzle_temperature"]["value"] == "215"
    assert record["values"]["hot_plate_temp"] == {"value": "65", "own": False, "source": "Snapmaker PLA Basic @U1"}
    assert "PLA 215" in shown(data, U1_04, "user") and "PLA 215" not in shown(data, U1_02)


def test_create_from_an_own_profile(snorca):
    """A copy of an own child keeps its parent and its values (save_current_preset)."""
    run(snorca, {"op": "filament_create", "base": "Mein PLA", "name": "Mein PLA 0.2",
                 "values": {"filament_flow_ratio": "0.95"}, "printers": [U1_02]})
    saved = json.loads((snorca.data_dir / FOLDER / "Mein PLA 0.2.json").read_text(encoding="utf-8"))
    assert (saved["inherits"], saved["nozzle_temperature"], saved["filament_flow_ratio"], saved["compatible_printers"]) == (
        "Snapmaker PLA Basic @U1", ["215"], ["0.95"], [U1_02])
    assert "Mein PLA 0.2" in shown(view(snorca), U1_02, "user")


def test_create_refuses_orphans_as_template(snorca):
    made = plan(snorca, {"op": "filament_create", "base": "Altes PETG", "name": "Neu", "values": {}})
    assert made["blocked"] == "parent_not_selectable"


def test_create_in_orcaslicer_with_tabs(orca):
    run(orca, {"op": "filament_create", "base": "Generic PLA @System", "name": "PLA warm",
               "values": {"nozzle_temperature": "230"}, "printers": [U1_04]})
    raw = (orca.data_dir / FOLDER / "PLA warm.json").read_bytes()
    assert raw.startswith(b'{\n\t"compatible_printers": [\n\t\t"Snapmaker U1 (0.4 nozzle)"\n\t],\n')
    assert json.loads(raw)["version"] == "2.5.0"
    data = view(orca)
    assert "PLA warm" in shown(data, U1_04, "user") and "PLA warm" not in shown(data, U1_02)
    record = next(f for f in data["filaments"] if f["name"] == "PLA warm")
    assert record["values"]["nozzle_temperature"]["value"] == "230"


# ---------------------------------------------------------------- filament_update

def test_update_keeps_unknown_keys_and_saves_differences_only(snorca):
    path = snorca.data_dir / FOLDER / "Mein PLA.json"
    data = json.loads(path.read_text(encoding="utf-8"))
    data["x_orcaone_test"] = "bleibt"
    path.write_text(json.dumps(data, indent=4, sort_keys=True) + "\n", encoding="utf-8")
    other = (snorca.data_dir / FOLDER / "Altes PETG.json").stat().st_mtime_ns
    # 220 is the inherited temperature: the own value goes.
    made, _ = run(snorca, {"op": "filament_update", "name": "Mein PLA",
                           "values": {"nozzle_temperature": "220", "filament_cost": "25"}})
    assert [o["params"].get("keys") for o in made["ops"]] == [["filament_cost", "nozzle_temperature"], None]
    saved = json.loads(path.read_text(encoding="utf-8"))
    assert "nozzle_temperature" not in saved
    assert (saved["filament_cost"], saved["x_orcaone_test"]) == (["25"], "bleibt")
    assert (snorca.data_dir / FOLDER / "Altes PETG.json").stat().st_mtime_ns == other
    run(snorca, {"op": "filament_update", "name": "Mein PLA", "reset": ["filament_cost"]})
    assert "filament_cost" not in json.loads(path.read_text(encoding="utf-8"))


def test_update_refuses_other_profiles(snorca):
    def blocked(name):
        return plan(snorca, {"op": "filament_update", "name": name, "values": {"filament_cost": "1"}})["blocked"]
    assert blocked("Snapmaker PLA Basic @U1") == "not_own_profile"
    assert blocked("Gibt es nicht") == "unknown_profile"


def test_update_without_change_writes_nothing(snorca):
    made = plan(snorca, {"op": "filament_update", "name": "Mein PLA", "values": {"nozzle_temperature": "215"}})
    assert made["ops"] == [] and [w["code"] for w in made["warnings"]] == ["nothing_changed", "nothing_to_do"]


# ---------------------------------------------------------------- filament_rename

def test_rename_follows_references(snorca):
    """TEST-VERGLEICH B5: file and .info renamed, name set, orca_presets follow."""
    def remember(c):
        c["orca_presets"][2]["filament_02"] = "Mein PLA"
        c["presets"]["filaments"] = ["Snapmaker ABS @U1 0.4 nozzle", "Mein PLA"]
    edit_conf(snorca, remember)
    info_before = (snorca.data_dir / FOLDER / "Mein PLA.info").read_text(encoding="utf-8")
    made, _ = run(snorca, {"op": "filament_rename", "name": "Mein PLA", "new_name": "Mein PLA hell"})
    assert [(o["action"], o["path"], o["params"].get("to")) for o in made["ops"][:2]] == [
        ("rename", f"{FOLDER}/Mein PLA.json", f"{FOLDER}/Mein PLA hell.json"),
        ("rename", f"{FOLDER}/Mein PLA.info", f"{FOLDER}/Mein PLA hell.info")]
    assert {d["path"] for d in made["conf_diff"]} == {f"orca_presets[{U1_04}].filament_02", "presets.filaments"}
    assert not (snorca.data_dir / FOLDER / "Mein PLA.json").exists()
    assert not (snorca.data_dir / FOLDER / "Mein PLA.info").exists()
    saved = json.loads((snorca.data_dir / FOLDER / "Mein PLA hell.json").read_text(encoding="utf-8"))
    assert (saved["name"], saved["filament_settings_id"], saved["nozzle_temperature"]) == (
        "Mein PLA hell", ["Mein PLA hell"], ["215"])
    info = (snorca.data_dir / FOLDER / "Mein PLA hell.info").read_text(encoding="utf-8")
    assert "base_id = 1195313935011" in info and info != info_before
    conf = conf_of(snorca)
    assert conf["orca_presets"][2]["filament_02"] == "Mein PLA hell"
    assert conf["presets"]["filaments"] == ["Snapmaker ABS @U1 0.4 nozzle", "Mein PLA hell"]
    names = shown(view(snorca), U1_04, "user")
    assert "Mein PLA hell" in names and "Mein PLA" not in names


def test_rename_changes_children_and_case(snorca):
    # A root profile in base/ with a child on top of it.
    base = snorca.data_dir / FOLDER / "base"
    base.mkdir()
    (base / "Wurzel.json").write_text(json.dumps({"name": "Wurzel", "version": "2.4.0", "from": "User",
                                                  "filament_settings_id": ["Wurzel"], "nozzle_temperature": ["200"]},
                                                 indent=4, sort_keys=True) + "\n", encoding="utf-8")
    (snorca.data_dir / FOLDER / "Kind.json").write_text(json.dumps({"name": "Kind", "version": "2.4.0", "from": "User",
                                                                    "inherits": "Wurzel"}), encoding="utf-8")
    run(snorca, {"op": "filament_rename", "name": "Wurzel", "new_name": "wurzel"})
    assert sorted(p.name for p in base.iterdir()) == ["wurzel.info", "wurzel.json"]
    assert json.loads((snorca.data_dir / FOLDER / "Kind.json").read_text(encoding="utf-8"))["inherits"] == "wurzel"
    record = next(f for f in view(snorca)["filaments"] if f["name"] == "Kind")
    assert "status" not in record and record["chain"][0] == "wurzel"
    # The child blocks deleting its parent, as in the slicer.
    made = plan(snorca, {"op": "filament_delete", "name": "wurzel"})
    assert (made["blocked"], made["blocked_params"]["children"]) == ("has_children", ["Kind"])


def test_rename_refuses_taken_names(snorca):
    made = plan(snorca, {"op": "filament_rename", "name": "Mein PLA", "new_name": "altes petg"})
    assert made["blocked"] == "name_taken"


# ---------------------------------------------------------------- filament_delete

def test_delete_replaces_references(snorca):
    edit_conf(snorca, lambda c: c["orca_presets"][2].update(filament_01="Mein PLA"))
    made, _ = run(snorca, {"op": "filament_delete", "name": "Mein PLA"})
    assert [(o["action"], o["path"]) for o in made["ops"][:2]] == [
        ("delete", f"{FOLDER}/Mein PLA.json"), ("delete", f"{FOLDER}/Mein PLA.info")]
    assert not (snorca.data_dir / FOLDER / "Mein PLA.json").exists()
    # A filament the slicer shows for U1 0.4 takes the slot.
    replacement = conf_of(snorca)["orca_presets"][2]["filament_01"]
    assert replacement in shown(view(snorca), U1_04)


def test_delete_an_orphan(snorca):
    run(snorca, {"op": "filament_delete", "name": "Altes PETG"})
    assert not any(w["code"] == "orphaned" for w in view(snorca)["warnings"])


def test_delete_refuses_system_profiles(snorca):
    assert plan(snorca, {"op": "filament_delete", "name": "SUNLU PLA+ @System"})["blocked"] == "not_own_profile"


# ---------------------------------------------------------------- printers

def test_default_printer(snorca):
    made, _ = run(snorca, {"op": "default_printer", "printer": U1_02})
    assert made["conf_diff"] == [{"path": "presets.machine", "before": U1_04, "after": U1_02}]
    assert view(snorca)["printers_page"]["default_printer"]["name"] == U1_02
    run(snorca, {"op": "default_printer", "printer": "Mein U1"})
    assert plan(snorca, {"op": "default_printer", "printer": "Gibt es nicht"})["blocked"] == "unknown_profile"


def test_printer_delete_with_its_filaments(snorca):
    run(snorca, {"op": "filament_bind", "base": "SUNLU PLA+ @System", "name": "SUNLU für Mein U1", "printers": ["Mein U1"]},
        {"op": "default_printer", "printer": "Mein U1"})
    edit_conf(snorca, lambda c: c["orca_presets"].append({"machine": "Mein U1", "filament": "SUNLU für Mein U1",
                                                          "process": "0.20mm Standard @Snapmaker U1 (0.4 nozzle)"}))
    only_here = next(p for p in view(snorca)["printers_page"]["own"] if p["name"] == "Mein U1")["only_here"]
    assert only_here == [{"name": "SUNLU für Mein U1", "kind": "filament", "helper": True}]
    made, _ = run(snorca, {"op": "printer_delete", "name": "Mein U1", "with": ["SUNLU für Mein U1"]})
    assert {"code": "default_printer_changed", "before": "Mein U1", "after": U1[0]} in made["warnings"]
    assert not (snorca.data_dir / "user/default/machine/Mein U1.json").exists()
    assert not (snorca.data_dir / FOLDER / "SUNLU für Mein U1.json").exists()
    conf = conf_of(snorca)
    assert "Mein U1" not in [e["machine"] for e in conf["orca_presets"]]
    assert conf["presets"]["machine"] == U1[0]
    assert view(snorca)["printers_page"]["own"] == []


def test_printer_delete_refuses_others(snorca):
    assert plan(snorca, {"op": "printer_delete", "name": U1_04})["blocked"] == "not_own_profile"
    made = plan(snorca, {"op": "printer_delete", "name": "Mein U1", "with": ["Snapmaker PLA Basic @U1"]})
    assert made["blocked"] == "not_own_profile"


def test_printer_model_off(orca):
    made, _ = run(orca, {"op": "printer_model_off", "vendor": "Custom", "model": "Generic Klipper Printer"})
    # OrcaSlicer main without OTA keeps the package; Custom stays anyway.
    assert not any(w["code"] == "package_removed" for w in made["warnings"])
    assert [m["model"] for m in conf_of(orca)["models"]] == ["Snapmaker U1"]
    assert [m["model"] for m in view(orca)["models"]] == ["Snapmaker U1"]
    assert plan(orca, {"op": "printer_model_off", "vendor": "Custom", "model": "Generic Klipper Printer"})["blocked"] == \
        "unknown_profile"


def test_last_printer_model_off(snorca):
    made = plan(snorca, {"op": "printer_model_off", "vendor": "Snapmaker", "model": "Snapmaker U1"})
    codes = [w["code"] for w in made["warnings"]]
    assert "no_printer_left" in codes and "package_removed" not in codes
    assert {"code": "default_printer_changed", "before": U1_04, "after": "Mein U1"} in made["warnings"]


def test_two_models_off_in_one_plan(orca):
    # The second model takes the default the first one handed on: no printer is left for it.
    made = plan(orca, {"op": "printer_model_off", "vendor": "Snapmaker", "model": "Snapmaker U1"},
                {"op": "printer_model_off", "vendor": "Custom", "model": "Generic Klipper Printer"})
    assert not [d for d in made["conf_diff"] if d["path"] == "presets.machine"]
    assert [w for w in made["warnings"] if w["code"].startswith("default_printer")] == [
        {"code": "default_printer_removed", "name": U1_04}]
    made = plan(orca, {"op": "printer_model_off", "vendor": "Snapmaker", "model": "Snapmaker U1"},
                {"op": "default_printer", "printer": U1_02})
    assert made["blocked"] == "unknown_profile"


def test_default_printer_chosen_by_the_page_replaces_the_automatic_one(snorca):
    # The page "Drucker" sends the next default itself (ops.js); no second word on it in the plan.
    made = plan(snorca, {"op": "printer_model_off", "vendor": "Snapmaker", "model": "Snapmaker U1"},
                {"op": "default_printer", "printer": "Mein U1"})
    codes = [w["code"] for w in made["warnings"]]
    assert "default_printer_changed" not in codes and "nothing_changed" not in codes
    assert {"path": "presets.machine", "before": U1_04, "after": "Mein U1"} in made["conf_diff"]


def test_cleanup_presets(snorca):
    made, _ = run(snorca, {"op": "cleanup_presets", "machines": ["Default Printer"]})
    assert made["conf_diff"][0]["path"] == "orca_presets[Default Printer]"
    assert made["conf_diff"][0]["after"] is None
    assert view(snorca)["printers_page"]["dead_entries"] == []
    assert plan(snorca, {"op": "cleanup_presets", "machines": ["Nie da"]})["blocked"] == "unknown_profile"


# ---------------------------------------------------------------- guards

def test_default_location_is_written_like_any_other(isolated):
    data_dir = copy_fixture("snorca", isolated / ".config" / "Snapmaker_Orca")
    instance = instance_of(data_dir)
    assert instance.source == "auto"
    run(instance, {"op": "filament_visible", "name": "SUNLU PLA+ @System", "visible": True})
    assert "SUNLU PLA+ @System" in json.loads(conf_path(instance).read_text(encoding="utf-8"))["filaments"]


def test_running_slicer_blocks(snorca, monkeypatch):
    change = {"op": "filament_visible", "name": "SUNLU PLA+ @System", "visible": True}
    running = [SlicerProcess(4711, "Snapmaker_Orca", snorca.data_dir)]
    assert plan(snorca, change, processes=running)["blocked"] == "slicer_running"
    unmapped = [SlicerProcess(4712, "Snapmaker_Orca", None)]
    assert plan(snorca, change, processes=unmapped)["blocked"] == "slicer_maybe_running"
    # Started between plan and apply: nothing is written.
    made = plan(snorca, change)
    monkeypatch.setattr(guard, "find_processes", lambda: running)
    with pytest.raises(operations.OperationError) as err:
        operations.apply(snorca.id, made["id"])
    assert err.value.code == "slicer_running"
    assert "SUNLU PLA+ @System" not in conf_of(snorca)["filaments"]
    assert backup.list_backups(snorca.id) == []


def test_started_during_the_backup(snorca, monkeypatch):
    made = plan(snorca, {"op": "filament_visible", "name": "SUNLU PLA+ @System", "visible": True})
    real = backup.create

    def create(*args, **kwargs):
        made_backup = real(*args, **kwargs)
        monkeypatch.setattr(guard, "find_processes", lambda: [SlicerProcess(4711, "Snapmaker_Orca", None)])
        return made_backup

    monkeypatch.setattr(backup, "create", create)
    with pytest.raises(operations.OperationError) as err:
        operations.apply(snorca.id, made["id"])
    assert err.value.code == "slicer_maybe_running" and err.value.params["backup"]["reason"] == "before_change"
    assert "SUNLU PLA+ @System" not in conf_of(snorca)["filaments"]


def test_plan_outdated(snorca):
    made = plan(snorca, {"op": "filament_update", "name": "Mein PLA", "values": {"filament_cost": "3"}})
    # The slicer saved the .conf meanwhile.
    edit_conf(snorca, lambda c: c["app"].update(window_mainframe="1; 2; 3; 4; 0"))
    with pytest.raises(operations.OperationError) as err:
        operations.apply(snorca.id, made["id"])
    assert err.value.code == "plan_outdated"
    assert "filament_cost" not in json.loads((snorca.data_dir / FOLDER / "Mein PLA.json").read_text(encoding="utf-8"))
    assert backup.list_backups(snorca.id) == []


def test_plan_outdated_for_a_new_file(snorca):
    made = plan(snorca, {"op": "filament_bind", "base": "SUNLU PLA+ @System", "name": "Neu", "printers": []})
    (snorca.data_dir / FOLDER / "Neu.json").write_text("{}", encoding="utf-8")
    with pytest.raises(operations.OperationError) as err:
        operations.apply(snorca.id, made["id"])
    assert err.value.code == "plan_outdated"


def test_a_plan_is_applied_once(snorca):
    made, _ = run(snorca, {"op": "default_printer", "printer": U1_02})
    with pytest.raises(operations.OperationError) as err:
        operations.apply(snorca.id, made["id"])
    assert err.value.code == "plan_not_found"
    with pytest.raises(operations.OperationError) as err:
        operations.apply("other", made["id"])
    assert err.value.code == "plan_not_found"
    with pytest.raises(operations.OperationError) as err:
        operations.find_instance("other")
    assert err.value.code == "instance_not_found"


def test_permissions_of_the_conf_stay(snorca):
    os.chmod(conf_path(snorca), 0o640)
    run(snorca, {"op": "default_printer", "printer": U1_02})
    if os.name == "posix":
        assert conf_path(snorca).stat().st_mode & 0o777 == 0o640
    assert not [p for p in snorca.data_dir.iterdir() if p.name.endswith(".tmp")]


def test_a_plan_is_outdated_after_another_one(snorca):
    """Plan A deletes an own root profile, plan B builds on it. B first, then A would leave B's
    profile without its parent: A must be outdated."""
    base = snorca.data_dir / FOLDER / "base"
    base.mkdir()
    root = {"name": "Wurzel", "from": "User", "version": "2.4.0", "filament_settings_id": ["Wurzel"],
            "filament_type": ["PLA"], "compatible_printers": []}
    (base / "Wurzel.json").write_text(json.dumps(root, indent=4, sort_keys=True) + "\n", encoding="utf-8")
    a = plan(snorca, {"op": "filament_delete", "name": "Wurzel"})
    b = plan(snorca, {"op": "filament_create", "base": "Wurzel", "name": "Kind",
                      "values": {"nozzle_temperature": "220"}, "printers": None})
    assert a["blocked"] is None and b["blocked"] is None
    operations.apply(snorca.id, b["id"])
    with pytest.raises(operations.OperationError) as err:
        operations.apply(snorca.id, a["id"])
    assert err.value.code == "plan_outdated"
    assert (base / "Wurzel.json").is_file()


def test_a_failed_write_is_rolled_back(snorca, monkeypatch):
    start = restorable_files(snorca)
    real, calls = operations.write_atomic, []

    def full_disk(path, content):
        calls.append(path)
        if len(calls) == 2:
            raise OSError(28, "No space left on device")
        real(path, content)

    monkeypatch.setattr(operations, "write_atomic", full_disk)
    # The .json is renamed and written, then writing the .info fails.
    made = plan(snorca, {"op": "filament_rename", "name": "Mein PLA", "new_name": "Mein PLA hell"})
    with pytest.raises(operations.OperationError) as err:
        operations.apply(snorca.id, made["id"])
    assert err.value.code == "write_failed" and err.value.params["rolled_back"] is True
    assert err.value.params["backup"]["reason"] == "before_change"
    assert restorable_files(snorca) == start


def test_long_names_are_written(snorca):
    # 245 bytes with ".json": a temporary file named after it would pass the 255 bytes.
    name = "ä" * operations.MAX_NAME
    run(snorca, {"op": "filament_bind", "base": "SUNLU PLA+ @System", "name": name, "printers": []})
    assert (snorca.data_dir / FOLDER / f"{name}.json").is_file()


@pytest.mark.skipif(os.name != "posix", reason="symlinks need extra rights on Windows")
def test_no_writes_through_a_symlink(snorca, tmp_path):
    """The backup leaves symlinks out (backup.walk): whatever OrcaOne changed behind one could not be
    restored, and it would write outside the data directory (hard rules 2 and 4)."""
    folder = snorca.data_dir / FOLDER
    synced = tmp_path / "synced"
    folder.rename(synced)
    folder.symlink_to(synced, target_is_directory=True)
    made = plan(snorca, {"op": "filament_delete", "name": "Mein PLA"})
    assert made["blocked"] == "path_outside_backup"
    assert made["blocked_params"] == {"path": f"{FOLDER}/Mein PLA.json"}
    with pytest.raises(operations.OperationError) as err:
        operations.apply(snorca.id, made["id"])
    assert err.value.code == "path_outside_backup"
    assert (synced / "Mein PLA.json").is_file()
    new = {"op": "filament_bind", "base": "SUNLU PLA+ @System", "name": "Neu", "printers": []}
    assert plan(snorca, new)["blocked"] == "path_outside_backup"
    # The .conf is no symlink: that change goes.
    assert plan(snorca, {"op": "default_printer", "printer": U1_02})["blocked"] is None


def test_no_writes_outside_user(snorca):
    edit_conf(snorca, lambda c: c["app"].update(preset_folder=".."))
    made = plan(snorca, {"op": "filament_bind", "base": "SUNLU PLA+ @System", "name": "Neu", "printers": []})
    assert made["blocked"] == "path_outside_backup"


# ---------------------------------------------------------------- restore

def test_restore_brings_back_the_state_byte_for_byte(snorca):
    """TEST-VERGLEICH B7."""
    start = restorable_files(snorca)
    _, first = run(snorca, {"op": "filament_visible", "name": "SUNLU PLA+ @System", "visible": True})
    run(snorca, {"op": "filament_bind", "base": "SUNLU PLA Marble @System", "name": "SUNLU Marble U1", "printers": [U1_04]},
        {"op": "filament_create", "base": "Snapmaker PLA Basic @U1", "name": "PLA 215",
         "values": {"nozzle_temperature": "215"}},
        {"op": "filament_rename", "name": "Mein PLA", "new_name": "Mein PLA hell"},
        {"op": "filament_delete", "name": "Altes PETG"},
        {"op": "default_printer", "printer": U1_02})
    run(snorca, {"op": "filament_rename", "name": "PLA 215", "new_name": "PLA 216"})
    # A folder that came later goes again.
    (snorca.data_dir / FOLDER / "base").mkdir()
    made = operations.restore_plan(snorca, [], first["backup"]["name"])
    assert made["blocked"] is None
    actions = {(o["action"], o["path"]) for o in made["ops"]}
    assert ("create", f"{FOLDER}/Altes PETG.json") in actions
    assert ("delete", f"{FOLDER}/PLA 216.json") in actions
    assert ("modify", "Snapmaker_Orca.conf") in actions
    assert {d["path"] for d in made["conf_diff"]} == {"filaments", "presets.machine"}
    result = operations.apply(snorca.id, made["id"])
    assert result["backup"]["reason"] == "before_restore"
    assert result["backup"]["reason_params"] == {"backup": first["backup"]["name"]}
    assert restorable_files(snorca) == start
    # The unlock went with the restore, no false alarm.
    assert instances.load_unlocks(snorca.id) == []
    assert not any(w["code"] == "unlock_lost" for w in view(snorca)["warnings"])


def test_restore_keeps_what_is_not_backed_up(snorca):
    _, first = run(snorca, {"op": "default_printer", "printer": U1_02})
    temp = snorca.data_dir / "user" / "default" / "temp"
    temp.mkdir()
    (temp / "rest.json").write_text("{}", encoding="utf-8")
    (snorca.data_dir / "log").mkdir()
    (snorca.data_dir / "log" / "a.log").write_text("x", encoding="utf-8")
    made = operations.restore_plan(snorca, [], first["backup"]["name"])
    assert [o["path"] for o in made["ops"]] == ["Snapmaker_Orca.conf"]
    operations.apply(snorca.id, made["id"])
    assert (temp / "rest.json").exists() and (snorca.data_dir / "log" / "a.log").exists()
    assert conf_of(snorca)["presets"]["machine"] == U1_04


def test_restore_plan_outdated_and_unknown(snorca):
    _, first = run(snorca, {"op": "default_printer", "printer": U1_02})
    made = operations.restore_plan(snorca, [], first["backup"]["name"])
    (snorca.data_dir / FOLDER / "Neu.json").write_text("{}", encoding="utf-8")
    with pytest.raises(operations.OperationError) as err:
        operations.apply(snorca.id, made["id"])
    assert err.value.code == "plan_outdated"
    with pytest.raises(backup.BackupError) as err:
        operations.restore_plan(snorca, [], "../../etc")
    assert err.value.code == "backup_not_found"


def test_restore_in_orcaslicer_removes_new_folders(orca):
    start = restorable_files(orca)
    _, first = run(orca, {"op": "default_printer", "printer": U1_02})
    run(orca, {"op": "filament_bind", "base": "Generic PLA @System", "name": "PLA U1", "printers": [U1_04]})
    made = operations.restore_plan(orca, [], first["backup"]["name"])
    operations.apply(orca.id, made["id"])
    assert restorable_files(orca) == start
    assert not (orca.data_dir / "user").exists()


def test_restore_repairs_an_unreadable_conf(snorca):
    """Starting the slicer would reset every setting (FINDINGS 4.3): restoring is the way out, so a
    broken .conf stops every change but a restore."""
    made = backup.create(snorca, "manual")
    good = conf_path(snorca).read_bytes()
    conf_path(snorca).write_bytes(good[:-20])
    broken = instance_of(snorca.data_dir)
    assert "conf_unreadable" in broken.problems
    assert plan(broken, {"op": "default_printer", "printer": U1_02})["blocked"] == "conf_unreadable"
    restore = operations.restore_plan(broken, [], made["name"])
    assert restore["blocked"] is None
    assert [op["path"] for op in restore["ops"]] == [conf_path(snorca).name]
    operations.apply(broken.id, restore["id"])
    assert conf_path(snorca).read_bytes() == good


@pytest.mark.skipif(os.name != "posix", reason="symlinks need extra rights on Windows")
def test_no_restore_through_a_symlink(snorca, tmp_path):
    made = backup.create(snorca, "manual")
    folder = snorca.data_dir / FOLDER
    folder.rename(tmp_path / "synced")
    folder.symlink_to(tmp_path / "synced", target_is_directory=True)
    restore = operations.restore_plan(snorca, [], made["name"])
    assert restore["blocked"] == "path_outside_backup"
    assert restore["blocked_params"]["path"].startswith(FOLDER)


# ---------------------------------------------------------------- helpers

def test_conf_diff_masks_credentials():
    before = {"devices": [{"dev_id": "1", "password": "geheim", "api_key": ""}], "access_code": {"x": "1234"},
              "local_machines": {"x": {"access_code": "5678", "dev_name": "U1"}}}
    after = {"devices": [{"dev_id": "1", "password": "anders", "api_key": ""}], "access_code": {"x": "9999"},
             "local_machines": {"x": {"access_code": "0000", "dev_name": "U1 neu"}}}
    diff = operations.conf_diff(before, after)
    text = json.dumps(diff)
    for secret in ("geheim", "anders", "1234", "9999", "5678", "0000"):
        assert secret not in text
    assert {"path": "local_machines.x.dev_name", "before": "U1", "after": "U1 neu"} in diff
    assert {"path": "devices", "before": [{"dev_id": "1", "password": "***", "api_key": ""}],
            "after": [{"dev_id": "1", "password": "***", "api_key": ""}]} in diff


def test_check_profile():
    good = b'{"name": "A", "version": "2.4.0", "inherits": "B", "x": ["1"]}'
    assert operations.check_profile(good, "A")
    assert not operations.check_profile(good, "B")
    for bad in (b'{"name": "A", "version": "x"}', b'{"name": "A", "version": "2.4.0", "x": 1}',
                b'{"name": "A", "version": "2.4.0", "inherits": ["B"]}', b'{"name": "A", "version": "2.4.0", "x": NaN}',
                b"[]", b"{"):
        assert not operations.check_profile(bad, "A"), bad


def test_check_conf():
    assert operations.check_conf(json.loads((FIXTURES / "snorca/Snapmaker_Orca.conf").read_text(encoding="utf-8")))
    assert not operations.check_conf({"filaments": ["a", 1]})
    assert not operations.check_conf({"orca_presets": [{"machine": "a", "filament": ["b"]}]})
    assert not operations.check_conf({"presets": {"machine": None}})
    assert operations.check_conf({"presets": {"machine": "a", "filaments": None}})


def test_profile_version():
    assert [operations.profile_version(v) for v in ("2.4.0", "2.5.0-dev", None, "x")] == ["2.4.0", "2.5.0", "1.0.0", "1.0.0"]


def test_windows_conf_keeps_crlf_and_checksum(snorca):
    raw = (FIXTURES / "conf/snorca_windows.conf").read_bytes()
    conf = parse_conf(raw)
    conf_path(snorca).write_bytes(dump_conf(ConfFile(parse_conf(conf_path(snorca).read_bytes()).data, "    ",
                                                     checksum=True, crlf=True)))
    run(snorca, {"op": "filament_bind", "base": "SUNLU PLA+ @System", "name": "Windows", "printers": [U1_04]},
        {"op": "default_printer", "printer": U1_02})
    written = conf_path(snorca).read_bytes()
    after = parse_conf(written)
    assert (after.crlf, after.checksum, after.data["presets"]["machine"]) == (True, True, U1_02)
    assert dump_conf(after) == written and conf.checksum
    assert (snorca.data_dir / FOLDER / "Windows.json").read_bytes().count(b"\r\n") > 3


def test_manual_folder_the_slicer_runs_on(snorca, monkeypatch):
    """SnOrca started with --datadir on the copy: the folder shows as "process", it stays writable
    once the slicer is closed, and blocks with slicer_running while it runs."""
    running = [SlicerProcess(4711, "Snapmaker_Orca", snorca.data_dir)]
    monkeypatch.setattr(guard, "find_processes", lambda: running)
    instance, processes = operations.find_instance(snorca.id)
    assert instance.source == "process"
    made = plan(instance, {"op": "default_printer", "printer": U1_02}, processes=processes)
    assert made["blocked"] == "slicer_running"


@pytest.mark.skipif(not sys.platform.startswith("linux"), reason="file names are bytes on Linux only")
def test_restore_brings_back_names_that_are_not_utf8(snorca):
    raw_name = os.path.join(os.fsencode(snorca.data_dir / FOLDER), b"Mein PLA f\xfcr U1.json")
    with open(raw_name, "wb") as file:
        file.write(b'{"version": "2.4.0", "inherits": "Snapmaker PLA Basic @U1"}')
    start = restorable_files(snorca)
    _, first = run(snorca, {"op": "default_printer", "printer": U1_02})
    os.remove(raw_name)
    made = operations.restore_plan(snorca, [], first["backup"]["name"])
    json.dumps(made)  # the API sends it; Utf8Response replaces what is not UTF-8
    operations.apply(snorca.id, made["id"])
    assert restorable_files(snorca) == start
    with open(raw_name, "rb") as file:
        assert file.read().startswith(b'{"version": "2.4.0"')


def test_bundle_profiles_are_never_changed(orca):
    folder = add_bundle(orca.data_dir)
    files = lambda: {p: p.read_bytes() for p in sorted(folder.rglob("*")) if p.is_file()}
    before = files()
    pla, u1 = f"{BUNDLE}/Paket PLA", f"{BUNDLE}/Paket U1"
    for change in ({"op": "filament_update", "name": pla, "values": {"nozzle_temperature": "215"}},
                   {"op": "filament_rename", "name": pla, "new_name": "Neu"},
                   {"op": "filament_delete", "name": pla},
                   {"op": "filament_create", "base": pla, "name": "Kopie", "values": {}},
                   {"op": "printer_delete", "name": u1}):
        made = plan(orca, change)
        assert (made["blocked"], made["blocked_params"]["name"]) == ("bundle_profile", change.get("base", change["name"])), change
    # Its printer can be the default one and carry own filaments: that changes the .conf and
    # own files only.
    run(orca, {"op": "default_printer", "printer": u1},
        {"op": "filament_create", "base": "Generic PLA @System", "name": "Mein PLA", "values": {}, "printers": [u1]})
    assert json.loads(conf_path(orca).read_text(encoding="utf-8"))["presets"]["machine"] == u1
    assert json.loads((orca.data_dir / FOLDER / "Mein PLA.json").read_text(encoding="utf-8"))["compatible_printers"] == [u1]
    assert files() == before


def test_own_filament_off_everywhere_is_hidden(snorca):
    """No printer left would mean every printer (FINDINGS 4.6): the profile is hidden instead,
    its printer list stays for when it comes back."""
    made, _ = run(snorca, {"op": "filament_update", "name": "Mein PLA", "values": {}, "hidden": True})
    assert {"code": "filament_hidden", "name": "Mein PLA"} in made["warnings"]
    data = json.loads((snorca.data_dir / FOLDER / "Mein PLA.json").read_text(encoding="utf-8"))
    # Its printers still come from the template, nothing else changed.
    assert data["instantiation"] == "false" and "compatible_printers" not in data
    record = next(f for f in view(snorca)["filaments"] if f["name"] == "Mein PLA")
    assert record["hidden"] is True and record["printers"][U1_04]["status"] == "hidden"
    run(snorca, {"op": "filament_update", "name": "Mein PLA", "values": {"compatible_printers": [U1_02, U1_04]},
                 "hidden": False})
    data = json.loads((snorca.data_dir / FOLDER / "Mein PLA.json").read_text(encoding="utf-8"))
    assert "instantiation" not in data and data["compatible_printers"] == [U1_02, U1_04]
    record = next(f for f in view(snorca)["filaments"] if f["name"] == "Mein PLA")
    assert "hidden" not in record and record["printers"][U1_02]["status"] == "visible"

