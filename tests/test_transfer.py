"""Copying profiles between two installations (orfix/transfer.py, op profile_copy): copies of
tests/fixtures/snorca and tests/fixtures/orca at the default places of a fake home."""

import json

import pytest

from conftest import copy_fixture
from orfix import guard, instances, operations, scanner
from orfix.resolver import Resolver

U1_04 = "Snapmaker U1 (0.4 nozzle)"
BASE = "user/default/filament/base"


@pytest.fixture
def both(fake_home, monkeypatch):
    """(Snapmaker Orca, OrcaSlicer), both closed."""
    monkeypatch.setattr(guard, "find_processes", lambda: [])
    monkeypatch.setattr(instances.platform, "system", lambda: "Linux")
    copy_fixture("snorca", fake_home / ".config" / "Snapmaker_Orca")
    copy_fixture("orca", fake_home / ".config" / "OrcaSlicer")
    found = {i.slicer: i for i in instances.discover()}
    return found["Snapmaker_Orca"], found["OrcaSlicer"]


def plan(target, source, kind, name):
    return operations.make_plan(target, [], [{"op": "profile_copy", "from": source.id, "kind": kind, "name": name}])


def run(target, source, kind, name):
    made = plan(target, source, kind, name)
    assert made["blocked"] is None, made
    result = operations.apply(target.id, made["id"])
    assert result["ok"] and result["warnings"] == [], result
    return made


def written(instance, rel):
    return json.loads((instance.data_dir / rel).read_text(encoding="utf-8"))


def loaded(instance, kind, name):
    res = Resolver(scanner.scan(instance.data_dir, instance.slicer))
    return next((p for p in res.own_profiles(kind) if p.name == name and res.loaded(p)), None), res


def codes(made):
    return {w["code"]: w for w in made["warnings"]}


def test_library_filament_from_orca_to_snorca(both):
    snorca, orca = both
    made = run(snorca, orca, "filament", "AliZ PLA @System")
    name = "AliZ PLA (Orca)"
    assert [(o["action"], o["path"]) for o in made["ops"]] == [
        ("create", f"{BASE}/{name}.json"), ("create", f"{BASE}/{name}.info")]
    data = written(snorca, f"{BASE}/{name}.json")
    # A root profile with every value of the chain, for every printer like in the library.
    assert (data["name"], data["from"], data["inherits"], data["compatible_printers"]) == (name, "User", "", [])
    assert data["filament_id"].startswith("P") and len(data["filament_id"]) == 8
    assert data["filament_settings_id"] == [name] and data["filament_type"] == ["PLA"]
    assert codes(made)["transfer_from"] == {"code": "transfer_from", "name": name, "source": "AliZ PLA @System",
                                            "slicer": "OrcaSlicer"}
    profile, res = loaded(snorca, "filament", name)
    assert profile is not None and res.chain(profile) == ([], True)


def test_own_filament_from_snorca_to_orca_takes_its_values_and_printers(both):
    snorca, orca = both
    run(orca, snorca, "filament", "Mein PLA")
    data = written(orca, f"{BASE}/Mein PLA.json")
    # Its own 215 °C over the 220 °C of Snapmaker PLA Basic, and everything else of that chain.
    assert (data["inherits"], data["nozzle_temperature"], data["compatible_printers"]) == ("", ["215"], [U1_04])
    assert data["filament_vendor"] == ["Snapmaker"]
    assert loaded(orca, "filament", "Mein PLA")[0] is not None


def test_process_keeps_the_standard_value_and_names_what_goes(both):
    snorca, orca = both
    made = run(orca, snorca, "process", "0.20mm Standard @Snapmaker U1 (0.4 nozzle)")
    name = "0.20mm Standard @Snapmaker U1 (0.4 nozzle) (SnOrca)"
    data = written(orca, f"user/default/process/base/{name}.json")
    # 200 mm/s standard hotend, 500 mm/s high flow in Snapmaker Orca: OrcaSlicer has one value.
    assert data["outer_wall_speed"] == ["200"] and data["print_settings_id"] == name
    assert "process_flow_support" not in data
    warnings = codes(made)
    assert "outer_wall_speed" in warnings["transfer_first_value"]["keys"]
    assert "process_flow_support" in warnings["transfer_dropped"]["keys"]
    assert loaded(orca, "process", name)[0] is not None


def test_a_second_copy_gets_a_free_name(both):
    snorca, orca = both
    run(snorca, orca, "filament", "AliZ PLA @System")
    run(snorca, orca, "filament", "AliZ PLA @System")
    first, second = written(snorca, f"{BASE}/AliZ PLA (Orca).json"), written(snorca, f"{BASE}/AliZ PLA (Orca) (2).json")
    assert second["name"] == "AliZ PLA (Orca) (2)" and first["filament_id"] != second["filament_id"]


def test_refused_copies(both):
    snorca, orca = both
    assert plan(snorca, snorca, "filament", "Mein PLA")["blocked"] == "same_installation"
    # Bound to "Mein U1" only, a printer OrcaSlicer does not have: it would show nowhere there.
    own = {"name": "Nur Mein U1", "from": "User", "version": "2.4.0", "inherits": "Snapmaker PLA Basic @U1",
           "compatible_printers": ["Mein U1"]}
    (snorca.data_dir / "user/default/filament/Nur Mein U1.json").write_text(json.dumps(own), encoding="utf-8")
    made = plan(orca, snorca, "filament", "Nur Mein U1")
    assert (made["blocked"], made["blocked_params"]["name"]) == ("no_target_printer", "Nur Mein U1")
    assert plan(orca, snorca, "filament", "Gibt es nicht")["blocked"] == "unknown_profile"
    assert plan(orca, snorca, "filament", "Altes PETG")["blocked"] == "unknown_profile"  # not loaded
    with pytest.raises(operations.InvalidChange):
        operations.make_plan(orca, [], [{"op": "profile_copy", "from": snorca.id, "kind": "machine", "name": "Mein U1"}])
