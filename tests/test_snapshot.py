"""The page "Änderungen" (orcaone/snapshot.py): a snapshot per installation in data/snapshots/,
compared per profile. Always on a copy of tests/fixtures/snorca, never a real data directory."""

import json

import pytest

from conftest import call, copy_fixture
from orcaone import snapshot
from orcaone.model import Instance

FILAMENTS = "user/default/filament"


@pytest.fixture
def inst(tmp_path):
    return Instance(id="snorca1", slicer="Snapmaker_Orca", source="manual",
                    data_dir=copy_fixture("snorca", tmp_path / "Snapmaker_Orca"))


def edit_json(path, change):
    data = json.loads(path.read_text(encoding="utf-8"))
    change(data)
    path.write_text(json.dumps(data, indent=4), encoding="utf-8")


def test_the_first_look_takes_the_snapshot(inst, data_dir):
    got = snapshot.news(inst)
    assert (got["first"], got["count"]) == (True, 0) and (data_dir / "snapshots" / "snorca1.json").is_file()
    again = snapshot.news(inst)
    assert (again["first"], again["count"], again["since"]) == (True, 0, got["since"])
    # Until the user marks it seen, the page says OrcaOne just started to compare.
    assert snapshot.seen(inst)["first"] is False and snapshot.news(inst)["first"] is False


def test_own_profiles(inst):
    snapshot.news(inst)
    folder = inst.data_dir / FILAMENTS
    edit_json(folder / "Mein PLA.json", lambda d: d.update(nozzle_temperature=["220"]))
    edit_json(inst.data_dir / "user/default/machine/Mein U1.json", lambda d: d.update(version="2.4.0.0"))
    mine = json.loads((folder / "Mein PLA.json").read_text(encoding="utf-8"))
    (folder / "Neues PLA.json").write_text(json.dumps({**mine, "name": "Neues PLA"}), encoding="utf-8")
    (folder / "Altes PETG.json").unlink()

    got = snapshot.news(inst)
    own = {(o["kind"], o["name"]): o for o in got["own"]}
    assert own["filament", "Mein PLA"]["change"] == "changed"
    assert own["filament", "Mein PLA"]["keys"] == [{"key": "nozzle_temperature", "old": ["215"], "new": ["220"]}]
    assert (own["filament", "Neues PLA"]["change"], own["filament", "Altes PETG"]["change"]) == ("added", "removed")
    # Only the version: the slicer writes it anew when saving (FINDINGS 4.4).
    assert own["machine", "Mein U1"]["why"] == "version"
    assert got["count"] == 4 and got["system"] == [] and got["slicer"] is None
    assert snapshot.seen(inst)["count"] == 0 and snapshot.news(inst)["count"] == 0


def test_the_conf(inst):
    snapshot.news(inst)
    conf = inst.data_dir / "Snapmaker_Orca.conf"

    def update(c):
        c["header"] = "Snapmaker Orca 2.4.1"
        c["models"][0]["nozzle_diameter"] = "0.4;0.6"
        c["filaments"].append("Generic PLA @System")

    edit_json(conf, update)
    got = snapshot.news(inst)
    assert got["slicer"] == {"old": "Snapmaker Orca 2.4.0", "new": "Snapmaker Orca 2.4.1"}
    assert got["printers"] == [{"model": "Snapmaker U1", "vendor": "Snapmaker", "old": "0.2;0.4;0.6;0.8", "new": "0.4;0.6"}]
    assert got["visible"] == {"old": "list", "new": "list", "added": ["Generic PLA @System"], "removed": []}
    # Logged in: the slicer reads another user folder, the own profiles there are others.
    edit_json(conf, lambda c: c["app"].update(preset_folder="12345"))
    got = snapshot.news(inst)
    assert got["folder"] == {"old": "default", "new": "12345"} and {o["change"] for o in got["own"]} == {"removed"}
    # Without a list the slicer shows every filament (FINDINGS 4.3).
    edit_json(conf, lambda c: c.pop("filaments"))
    assert snapshot.news(inst)["visible"]["new"] == "all"


def test_vendor_profiles_by_their_resolved_values(inst):
    snapshot.news(inst)
    library = inst.data_dir / "system/OrcaFilamentLibrary/filament"
    edit_json(library / "Generic PLA @System.json", lambda d: d.update(nozzle_temperature=["225"]))
    assert snapshot.news(inst)["system"] == [{"kind": "filament", "package": "OrcaFilamentLibrary",
                                              "added": [], "changed": ["Generic PLA @System"], "removed": []}]
    # A template changes every profile built on it.
    edit_json(library / "base/fdm_filament_pla.json", lambda d: d.update(filament_notes=["neu"]))
    changed = snapshot.news(inst)["system"][0]["changed"]
    assert "Generic PLA @System" in changed and "SUNLU PLA+ @System" in changed


def test_credentials_stay_hidden(inst, data_dir):
    snapshot.news(inst)
    edit_json(inst.data_dir / "user/default/machine/Mein U1.json",
              lambda d: d.update(print_host="10.0.0.5", printhost_apikey="geheim123"))
    keys = {k["key"]: k for k in snapshot.news(inst)["own"][0]["keys"]}
    assert keys["print_host"]["new"] == "10.0.0.5" and keys["printhost_apikey"]["new"].startswith("***")
    snapshot.seen(inst)
    assert "geheim123" not in (data_dir / "snapshots" / "snorca1.json").read_text(encoding="utf-8")


def test_an_unreadable_conf_is_not_compared(inst):
    """The slicer deletes the .conf for a moment while saving it: every printer would look gone."""
    snapshot.news(inst)
    (inst.data_dir / "Snapmaker_Orca.conf").write_text("{", encoding="utf-8")
    with pytest.raises(snapshot.SnapshotError) as err:
        snapshot.news(inst)
    assert err.value.code == "conf_unreadable"


def test_what_orcaone_writes_counts_as_seen(server, fake_home):
    data_dir = copy_fixture("snorca", fake_home / ".config" / "Snapmaker_Orca")
    inst = json.loads(call(f"{server}/api/data")[1])["instances"][0]
    assert inst["news"] == 0  # the first look took the snapshot
    base = f"{server}/api/instances/{inst['id']}"
    # From elsewhere, e.g. saved in the slicer:
    edit_json(data_dir / FILAMENTS / "Mein PLA.json", lambda d: d.update(nozzle_temperature=["220"]))
    assert json.loads(call(f"{server}/api/data")[1])["instances"][0]["news"] == 1

    change = {"op": "filament_visible", "name": "SUNLU PLA+ @System", "visible": True}
    plan = json.loads(call(f"{base}/plan", "POST", {"changes": [change]})[1])["plan"]
    status, body = call(f"{base}/apply", "POST", {"plan_id": plan["id"]})
    assert status == 200 and json.loads(body)["ok"]
    got = json.loads(call(f"{base}/news")[1])
    assert got["count"] == 1 and [o["name"] for o in got["own"]] == ["Mein PLA"] and got["visible"] is None

    status, body = call(f"{base}/news/seen", "POST")
    assert status == 200 and json.loads(body)["count"] == 0
    assert json.loads(call(f"{server}/api/data")[1])["instances"][0]["news"] == 0
    (data_dir / "Snapmaker_Orca.conf").write_text("{", encoding="utf-8")
    status, body = call(f"{base}/news")
    assert (status, json.loads(body)) == (409, {"error": "conf_unreadable"})


def test_changed_secrets_show_no_hash(inst):
    """The page "Änderungen" (any device in the LAN may open it): a changed password as "***" only,
    the hash in the snapshot would let one try passwords offline."""
    snapshot.news(inst)
    edit_json(inst.data_dir / "user/default/machine/Mein U1.json", lambda d: d.update(printhost_password="Sommer2024"))
    keys = {k["key"]: k for k in snapshot.news(inst)["own"][0]["keys"]}
    assert keys["printhost_password"]["new"] == "***"
