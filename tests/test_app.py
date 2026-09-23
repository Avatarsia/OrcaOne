import json
import os
import posixpath
import re
import sys
import urllib.parse
import urllib.request

import pytest

from conftest import call, copy_fixture


def test_lists_instances_and_adds_a_manual_path(server, fake_home):
    status, body = call(f"{server}/api/instances")
    assert status == 200 and json.loads(body)["instances"] == []

    data_dir = fake_home / "portable" / "Snapmaker_Orca"
    data_dir.mkdir(parents=True)
    (data_dir / "Snapmaker_Orca.conf").write_text('{\n    "header": "Snapmaker Orca 2.4.0"\n}\n')
    status, body = call(f"{server}/api/instances/manual", "POST", {"path": str(data_dir)})
    assert status == 200 and json.loads(body)["instance"]["version"] == "2.4.0"

    found = json.loads(call(f"{server}/api/instances")[1])["instances"]
    assert [(i["source"], i["manual"], i["run_state"]["running"]) for i in found] == [("manual", True, False)]

    status, _ = call(f"{server}/api/instances/manual?path={urllib.request.quote(str(data_dir))}", "DELETE")
    assert status == 200
    assert json.loads(call(f"{server}/api/instances")[1])["instances"] == []


def test_manual_path_error_codes(server, fake_home):
    status, body = call(f"{server}/api/instances/manual", "POST", {"path": str(fake_home)})
    assert (status, json.loads(body)) == (400, {"error": "not_a_data_dir"})


def test_data_is_read_live(server, fake_home):
    status, body = call(f"{server}/api/data")
    assert status == 200 and json.loads(body)["instances"] == []
    # A slicer that appears later shows up on the next call, nothing is cached.
    copy_fixture("snorca", fake_home / ".config" / "Snapmaker_Orca")
    status, body = call(f"{server}/api/data")
    data = json.loads(body)
    assert status == 200 and [i["kind"] for i in data["instances"]] == ["snorca"]
    inst = data["instances"][0]
    assert set(inst) >= {"models", "filaments", "warnings", "stats", "slicer_page", "printers_page", "backups_page"}
    assert inst["models"][0]["cover"] == "assets/printer-snapmaker-u1.png"
    status, body = call(f"{server}/{inst['models'][0]['cover']}")
    assert status == 200 and body[:4] == b"\x89PNG"


@pytest.mark.skipif(not sys.platform.startswith("linux"), reason="file names are bytes on Linux only")
def test_data_survives_file_names_that_are_not_utf8(server, fake_home):
    # From a ZIP with Latin-1 names: Python sees surrogate escapes, strict UTF-8 refuses them.
    data_dir = copy_fixture("snorca", fake_home / ".config" / "Snapmaker_Orca")
    for folder in (data_dir / "user" / "default" / "filament", data_dir):
        with open(os.path.join(os.fsencode(folder), b"Mein PLA f\xfcr U1.json"), "wb") as file:
            file.write(b'{"version": "2.3.3.3", "inherits": "Snapmaker PLA Basic @U1"}')
    status, body = call(f"{server}/api/data")
    assert status == 200
    assert "Mein PLA f?r U1" in [f["name"] for f in json.loads(body)["instances"][0]["filaments"]]


def test_manual_data_dir_shows_in_data_and_goes_again(server, fake_home):
    data_dir = copy_fixture("snorca", fake_home / "portable" / "Snapmaker_Orca")
    status, _ = call(f"{server}/api/instances/manual", "POST", {"path": str(data_dir)})
    assert status == 200
    inst = json.loads(call(f"{server}/api/data")[1])["instances"][0]
    assert (inst["source"], inst["manual"], inst["data_dir"]) == ("manual", True, str(data_dir.resolve()))
    # "Entfernen" on the page "Slicer" sends data_dir back.
    status, _ = call(f"{server}/api/instances/manual?path={urllib.request.quote(inst['data_dir'])}", "DELETE")
    assert status == 200
    assert json.loads(call(f"{server}/api/data")[1])["instances"] == []


def test_serves_the_ui(server):
    status, body = call(f"{server}/")
    assert status == 200 and b'<div id="app">' in body and b'src="app.js"' in body
    for path in ("style.css", "vendor/vue.global.prod.js", "vendor/inter/InterVariable.woff2",
                 "vendor/jetbrains-mono/JetBrainsMono-Regular.woff2", "assets/printer-placeholder.png"):
        assert call(f"{server}/{path}")[0] == 200, path


def test_serves_every_module_the_ui_imports(server):
    # A missing module stops the whole page, so follow the imports from app.js.
    seen, todo = set(), ["app.js"]
    while todo:
        path = todo.pop()
        if path in seen:
            continue
        seen.add(path)
        status, body = call(f"{server}/{path}")
        assert status == 200, path
        for rel in re.findall(r'from "(\.{1,2}/[^"]+)"', body.decode("utf-8")):
            todo.append(posixpath.normpath(posixpath.join(posixpath.dirname(path), rel)))
    assert {"common.js", "api.js", "texts.js", "pages/filamente.js", "pages/filament-editor.js",
            "pages/drucker.js", "pages/sicherungen.js", "pages/slicer.js"} <= seen


def test_no_draft_routes(server):
    assert call(f"{server}/prototypes/ui-overview/variante-e.html")[0] == 404
    assert call(f"{server}/orfix/static/style.css")[0] == 404


def test_rejects_foreign_hosts_and_origins(server):
    status, _ = call(f"{server}/api/instances", headers={"Host": "evil.example"})
    assert status == 403
    status, _ = call(f"{server}/api/instances/manual", "POST", {"path": "/"}, headers={"Origin": "http://evil.example"})
    assert status == 403
    # Another program on this computer, e.g. a local dev server on another port.
    status, _ = call(f"{server}/api/instances/manual", "POST", {"path": "/"}, headers={"Origin": "http://127.0.0.1:1"})
    assert status == 403
    status, body = call(f"{server}/api/instances/manual", "POST", {"path": "/"}, headers={"Origin": server})
    assert (status, json.loads(body)) == (400, {"error": "not_a_data_dir"})


def test_refuses_to_be_framed(server):
    request = urllib.request.Request(f"{server}/")
    with urllib.request.urlopen(request, timeout=5) as response:
        assert response.headers["X-Frame-Options"] == "DENY"
        assert "frame-ancestors 'none'" in response.headers["Content-Security-Policy"]
    with urllib.request.urlopen(f"{server}/app.js", timeout=5) as response:
        assert response.headers["Content-Type"].startswith("text/javascript")


def test_change_backup_and_restore_through_the_api(server, fake_home):
    data_dir = copy_fixture("snorca", fake_home / "orfix-test" / "Snapmaker_Orca")
    call(f"{server}/api/instances/manual", "POST", {"path": str(data_dir)})
    inst = json.loads(call(f"{server}/api/data")[1])["instances"][0]
    base = f"{server}/api/instances/{inst['id']}"
    change = {"op": "filament_visible", "name": "SUNLU PLA+ @System", "visible": True}
    status, body = call(f"{base}/plan", "POST", {"changes": [change]})
    plan = json.loads(body)["plan"]
    assert status == 200 and plan["blocked"] is None and plan["ops"][0]["path"] == "Snapmaker_Orca.conf"
    status, body = call(f"{base}/apply", "POST", {"plan_id": plan["id"]})
    result = json.loads(body)
    assert status == 200 and result["ok"] and result["applied"] == 1
    assert (call(f"{base}/apply", "POST", {"plan_id": plan["id"]})[0]) == 404

    status, body = call(f"{base}/backups", "POST")
    manual = json.loads(body)["backup"]
    assert status == 200 and manual["reason"] == "manual"
    listed = json.loads(call(f"{base}/backups")[1])
    assert [b["reason"] for b in listed["backups"]] == ["manual", "before_change"]
    assert listed["total_size"] == sum(b["size"] for b in listed["backups"])
    assert listed["location"].startswith("~/.local/share/orfix/backups/")
    page = json.loads(call(f"{server}/api/data")[1])["instances"][0]["backups_page"]
    assert page["count"] == 2 and page["backups"] == listed["backups"]

    before = result["backup"]["name"]
    status, body = call(f"{base}/backups/{before}/restore-plan", "POST")
    restore = json.loads(body)["plan"]
    assert status == 200 and [d["path"] for d in restore["conf_diff"]] == ["filaments"]
    status, body = call(f"{base}/apply", "POST", {"plan_id": restore["id"]})
    assert status == 200 and json.loads(body)["backup"]["reason"] == "before_restore"
    assert "SUNLU PLA+ @System" not in json.loads((data_dir / "Snapmaker_Orca.conf").read_text(encoding="utf-8"))["filaments"]

    assert call(f"{base}/backups/{manual['name']}", "DELETE")[0] == 200
    assert call(f"{base}/backups/{manual['name']}", "DELETE")[0] == 404
    assert call(f"{base}/backups/nope/restore-plan", "POST")[0] == 404


def test_api_error_codes(server, fake_home):
    status, body = call(f"{server}/api/instances/nope/plan", "POST", {"changes": []})
    assert (status, json.loads(body)) == (404, {"error": "instance_not_found"})
    copy_fixture("snorca", fake_home / ".config" / "Snapmaker_Orca")
    inst = json.loads(call(f"{server}/api/data")[1])["instances"][0]
    base = f"{server}/api/instances/{inst['id']}"
    status, body = call(f"{base}/plan", "POST", {"changes": [{"op": "zaubern"}]})
    assert (status, json.loads(body)) == (400, {"error": "invalid_change", "index": 0, "field": "op"})
    status, body = call(f"{base}/plan", "POST", {"changes": "alles"})
    assert status == 400 and json.loads(body)["error"] == "invalid_change"
    status, body = call(f"{base}/apply", "POST", {"plan_id": "nope"})
    assert (status, json.loads(body)) == (404, {"error": "plan_not_found"})


def test_profile_details_on_demand(server, fake_home):
    copy_fixture("snorca", fake_home / ".config" / "Snapmaker_Orca")
    inst = json.loads(call(f"{server}/api/data")[1])["instances"][0]
    base = f"{server}/api/instances/{inst['id']}/profile"
    status, body = call(f"{base}?kind=process&name={urllib.parse.quote('0.20mm Standard @Snapmaker U1 (0.4 nozzle)')}")
    assert status == 200 and json.loads(body)["values"]["layer_height"]["value"] == "0.2"
    assert call(f"{base}?kind=process&name=nope")[0] == 404
    assert call(f"{base}?kind=zauber&name=nope")[0] == 404

