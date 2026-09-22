"""Part B of docs/TEST-VERGLEICH.md end to end over HTTP: the real server in a thread, a copy of
tests/fixtures/snorca in tmp_path added by hand (only such folders may be written), and every step
the way the page sends it (orfix/static/ops.js): POST /plan, POST /apply, then GET /api/data as
the page reads it. At the end the backup from before the first step brings the copy back byte for
byte."""

import json

from conftest import call, copy_fixture
from orfix.conf import dump_conf, parse_conf

U1 = [f"Snapmaker U1 ({d} nozzle)" for d in ("0.2", "0.4", "0.6", "0.8")]
U1_04 = U1[1]
FOLDER = "user/default/filament"


def tree(root):
    """Every file and folder of a data directory with its bytes, to compare the whole copy."""
    return {p.relative_to(root).as_posix(): None if p.is_dir() else p.read_bytes() for p in sorted(root.rglob("*"))}


class Page:
    """What the page does: read /api/data, plan, apply."""

    def __init__(self, server, data_dir):
        self.server, self.data_dir = server, data_dir
        status, body = call(f"{server}/api/instances/manual", "POST", {"path": str(data_dir)})
        assert status == 200, body
        self.id = self.data()["id"]
        self.base = f"{server}/api/instances/{self.id}"

    def data(self):
        status, body = call(f"{self.server}/api/data")
        assert status == 200
        found = [i for i in json.loads(body)["instances"] if i["data_dir"] == str(self.data_dir.resolve())]
        assert len(found) == 1
        return found[0]

    def plan(self, *changes):
        status, body = call(f"{self.base}/plan", "POST", {"changes": list(changes)})
        assert status == 200, body
        return json.loads(body)["plan"]

    def apply(self, *changes):
        """Plan and apply one step; returns (plan, result, /api/data afterwards)."""
        plan = self.plan(*changes)
        assert plan["blocked"] is None, plan
        status, body = call(f"{self.base}/apply", "POST", {"plan_id": plan["id"]})
        result = json.loads(body)
        assert status == 200 and result["ok"] and result["warnings"] == [], result
        assert result["backup"]["reason"] == "before_change"
        return plan, result, self.data()

    def conf(self):
        return json.loads((self.data_dir / "Snapmaker_Orca.conf").read_text(encoding="utf-8"))


def shown(inst, printer):
    """Filaments the page shows as active at this printer, i.e. what the slicer's dropdown lists."""
    return {f["name"] for f in inst["filaments"] if f["printers"].get(printer, {}).get("status") == "visible"}


def record(inst, name):
    return next(f for f in inst["filaments"] if f["name"] == name)


def own_file(page, name):
    return json.loads((page.data_dir / FOLDER / f"{name}.json").read_text(encoding="utf-8"))


def test_part_b_end_to_end(server, fake_home):
    data_dir = copy_fixture("snorca", fake_home / "orfix-test" / "Snapmaker_Orca")
    start = tree(data_dir)
    page = Page(server, data_dir)
    inst = page.data()
    assert (inst["source"], inst["write_allowed"], inst["running"]) == ("manual", True, False)
    # Part A as a starting point: the vendor filaments per nozzle, nothing of the library.
    assert {"Snapmaker ABS @U1 0.4 nozzle", "Snapmaker PLA Basic @U1"} <= shown(inst, U1_04)
    assert all("SUNLU PLA+ @System" not in shown(inst, p) for p in U1)
    before = {p: shown(inst, p) for p in U1}

    # B1, way A: SUNLU PLA+ goes into "filaments" and shows at every nozzle of the U1.
    plan, result, inst = page.apply({"op": "filament_visible", "name": "SUNLU PLA+ @System", "visible": True})
    assert [(o["action"], o["path"]) for o in plan["ops"]] == [("modify", "Snapmaker_Orca.conf")]
    assert [d["path"] for d in plan["conf_diff"]] == ["filaments"]
    assert {"code": "unlock_fragile", "name": "SUNLU PLA+ @System"} in plan["warnings"]
    assert "SUNLU PLA+ @System" in page.conf()["filaments"]
    assert all("SUNLU PLA+ @System" in shown(inst, p) for p in U1)
    first_backup = result["backup"]["name"]

    # B2, way B: an own profile on SUNLU PLA Marble, bound to U1 0.4 only. (The fixture has no
    # SUNLU PLA Matte; the Marble one stands in, the real run on a copy takes the Matte one.)
    helper = "SUNLU PLA Marble @Snapmaker U1"
    plan, _, inst = page.apply({"op": "filament_bind", "base": "SUNLU PLA Marble @System", "name": helper,
                                "printers": [U1_04]})
    assert [(o["action"], o["path"]) for o in plan["ops"]] == [
        ("create", f"{FOLDER}/{helper}.json"), ("create", f"{FOLDER}/{helper}.info")]
    assert plan["conf_diff"] == []
    assert own_file(page, helper) == {
        "compatible_printers": [U1_04], "filament_settings_id": [helper], "from": "User",
        "inherits": "SUNLU PLA Marble @System", "name": helper, "version": "2.4.0"}
    assert [p for p in U1 if helper in shown(inst, p)] == [U1_04]
    assert record(inst, helper)["origin_kind"] == "user"

    # B3: the list entries without a printer go, the list itself stays and the U1 sees no difference.
    unused = [w["name"] for w in inst["without_printer"]]
    assert "Snapmaker ABS @J1" in unused and len(unused) >= 8
    plan, _, inst = page.apply(*({"op": "filament_visible", "name": n, "visible": False} for n in unused))
    listed = page.conf()["filaments"]
    assert listed and not set(unused) & set(listed)
    assert inst["without_printer"] == []
    for p in U1:
        assert shown(inst, p) - {"SUNLU PLA+ @System", helper} == before[p], p

    # B4: an own variant of PLA Basic with 215 °C. "Mein PLA" is taken in the fixture, so first
    # the refusal, then another name.
    create = {"op": "filament_create", "base": "Snapmaker PLA Basic @U1", "values": {"nozzle_temperature": "215"},
              "printers": None}
    refused = page.plan({**create, "name": "Mein PLA"})
    assert (refused["blocked"], refused["blocked_params"]) == ("name_taken", {"change": 0, "name": "Mein PLA"})
    assert call(f"{page.base}/apply", "POST", {"plan_id": refused["id"]})[0] == 409
    mine = "Mein PLA neu"
    plan, _, inst = page.apply({**create, "name": mine})
    assert own_file(page, mine) == {
        "filament_settings_id": [mine], "from": "User", "inherits": "Snapmaker PLA Basic @U1", "name": mine,
        "nozzle_temperature": ["215"], "version": "2.4.0"}
    assert mine in shown(inst, U1_04)
    value = record(inst, mine)["values"]["nozzle_temperature"]
    assert (value["value"], value["own"], value["inherited"]["value"]) == ("215", True, "220")

    # B5: rename it while SnOrca has it chosen at U1 0.4 (set here as SnOrca saves its choice).
    conf = parse_conf((data_dir / "Snapmaker_Orca.conf").read_bytes())
    entry = next(e for e in conf.data["orca_presets"] if e["machine"] == U1_04)
    entry["filament"] = entry["filament_01"] = mine
    (data_dir / "Snapmaker_Orca.conf").write_bytes(dump_conf(conf))
    plan, _, inst = page.apply({"op": "filament_rename", "name": mine, "new_name": "Mein PLA hell"})
    assert [(o["action"], o["path"], o["params"].get("to")) for o in plan["ops"][:2]] == [
        ("rename", f"{FOLDER}/{mine}.json", f"{FOLDER}/Mein PLA hell.json"),
        ("rename", f"{FOLDER}/{mine}.info", f"{FOLDER}/Mein PLA hell.info")]
    assert not (data_dir / FOLDER / f"{mine}.json").exists()
    renamed = own_file(page, "Mein PLA hell")
    assert (renamed["name"], renamed["filament_settings_id"], renamed["nozzle_temperature"]) == \
        ("Mein PLA hell", ["Mein PLA hell"], ["215"])
    entry = next(e for e in page.conf()["orca_presets"] if e["machine"] == U1_04)
    assert (entry["filament"], entry["filament_01"]) == ("Mein PLA hell", "Mein PLA hell")
    assert "Mein PLA hell" in shown(inst, U1_04) and mine not in {f["name"] for f in inst["filaments"]}

    # B7: the backups, newest first, one per step; the oldest is the one from before B1.
    status, body = call(f"{page.base}/backups")
    listed = json.loads(body)
    assert status == 200
    assert [b["reason"] for b in listed["backups"]] == ["before_change"] * 5
    assert listed["backups"][-1]["name"] == first_backup
    assert listed["backups"][-1]["reason_params"] == {"ops": ["filament_visible"]}
    assert listed["total_size"] == sum(b["size"] for b in listed["backups"])
    assert page.data()["backups_page"]["backups"] == listed["backups"]

    status, body = call(f"{page.base}/backups/{first_backup}/restore-plan", "POST")
    restore = json.loads(body)["plan"]
    assert status == 200 and restore["blocked"] is None
    assert {(o["action"], o["path"]) for o in restore["ops"]} == {
        ("modify", "Snapmaker_Orca.conf"),
        ("delete", f"{FOLDER}/{helper}.json"), ("delete", f"{FOLDER}/{helper}.info"),
        ("delete", f"{FOLDER}/Mein PLA hell.json"), ("delete", f"{FOLDER}/Mein PLA hell.info")}
    status, body = call(f"{page.base}/apply", "POST", {"plan_id": restore["id"]})
    result = json.loads(body)
    assert status == 200 and result["ok"] and result["warnings"] == []
    assert (result["backup"]["reason"], result["backup"]["reason_params"]) == ("before_restore", {"backup": first_backup})

    inst = page.data()
    assert {p: shown(inst, p) for p in U1} == before
    assert tree(data_dir) == start
