import json
import os
import posixpath
import re
import socket
import struct
import sys
import urllib.parse
import urllib.request
from collections import namedtuple
from types import SimpleNamespace

import pytest

from conftest import call, copy_fixture
from orcaone import app as app_module
from orcaone import settings


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


def test_is_an_installable_web_app(server):
    """The manifest with the fields and icon sizes Chrome wants for installing
    (web.dev/articles/install-criteria); __main__.choose_port also knows a running OrcaOne by it."""
    body = call(f"{server}/")[1]
    assert b'rel="manifest" href="manifest.json"' in body and b'rel="icon" href="assets/app-icon.svg"' in body
    status, body = call(f"{server}/manifest.json")
    manifest = json.loads(body)
    assert status == 200 and manifest["name"] == "OrcaOne" and manifest["start_url"] == "/" and manifest["display"] == "standalone"
    assert {"192x192", "512x512"} <= {icon["sizes"] for icon in manifest["icons"]}
    for icon in manifest["icons"]:
        status, data = call(f"{server}/{icon['src']}")
        assert status == 200, icon["src"]
        if icon["type"] == "image/png":
            assert "%dx%d" % struct.unpack(">II", data[16:24]) == icon["sizes"]
    status, data = call(f"{server}/assets/app-icon.ico")
    assert status == 200 and struct.unpack("<HHH", data[:6]) == (0, 1, 4)
    # Plain shapes only: Qt SVG, which draws launcher icons in KDE, knows no clipPath.
    assert b"clipPath" not in call(f"{server}/assets/app-icon.svg")[1]


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
    assert {"common.js", "api.js", "texts.js", "texts/de.js", "texts/en.js", "texts/names.js", "pages/kalibrieren.js", "pages/filamente.js",
            "pages/filament-editor.js", "pages/filament-picker.js", "pages/vergleichen.js", "pages/aenderungen.js", "pages/import.js", "pages/bereinigen.js", "pages/uebersicht.js", "pages/status.js", "pages/druck3d.js", "pages/druck2d.js", "pages/print-view.js", "pages/dateien.js", "pages/konsole.js", "pages/ssh.js", "pages/drucker.js", "pages/sicherungen.js",
            "pages/slicer.js", "pages/zusammenhaenge.js", "pages/steuern.js", "pages/hoehenkarte.js"} <= seen


def test_language_is_a_setting(server, data_dir):
    assert json.loads(call(f"{server}/api/settings")[1]) == {"language": None, "menu_collapsed": False, "theme": None, "area": None, "chosen_printer": {}, "view3d": None}
    status, body = call(f"{server}/api/settings", "POST", {"language": "en"})
    assert status == 200 and json.loads(body) == {"language": "en", "menu_collapsed": False, "theme": None, "area": None, "chosen_printer": {}, "view3d": None}
    assert json.loads(call(f"{server}/api/settings")[1]) == {"language": "en", "menu_collapsed": False, "theme": None, "area": None, "chosen_printer": {}, "view3d": None}
    assert json.loads((data_dir / "settings.json").read_text(encoding="utf-8"))["language"] == "en"
    for wrong in ({"language": "fr"}, {"language": None}, {"language": 1}, {"menu_collapsed": "yes"}, {"colour": "red"}, {"area": "profile"}, {}):
        status, body = call(f"{server}/api/settings", "POST", wrong)
        assert status == 400 and json.loads(body) == {"error": "setting_invalid"}
    # Changed by hand to something unknown: the page takes the browser's language.
    settings.change(lambda data: data.update(language="xx"))
    assert json.loads(call(f"{server}/api/settings")[1]) == {"language": None, "menu_collapsed": False, "theme": None, "area": None, "chosen_printer": {}, "view3d": None}


def test_the_design_is_a_setting(server, data_dir):
    # Without a choice the page follows the system: no data-theme on the page.
    status, body = call(f"{server}/")
    assert status == 200 and b"data-theme" not in body and b'<html lang="de">' in body
    status, body = call(f"{server}/api/settings", "POST", {"theme": "dark"})
    assert status == 200 and json.loads(body)["theme"] == "dark"
    assert json.loads((data_dir / "settings.json").read_text(encoding="utf-8"))["theme"] == "dark"
    # The part of OrcaOne used last: the next start begins there.
    status, body = call(f"{server}/api/settings", "POST", {"area": "printer"})
    assert status == 200 and json.loads(body)["area"] == "printer"
    # From the first frame on: the page comes with the design.
    assert b'<html data-theme="dark" lang="de">' in call(f"{server}/")[1]
    for wrong in ({"theme": "blue"}, {"theme": None}, {"theme": True}):
        assert call(f"{server}/api/settings", "POST", wrong)[0] == 400
    settings.change(lambda data: data.update(theme="pink"))
    assert json.loads(call(f"{server}/api/settings")[1])["theme"] is None
    assert b"data-theme" not in call(f"{server}/")[1]


def test_the_chosen_printer_is_a_setting(server, data_dir):
    """The printer chosen last in each part: the next start takes it again (app.js, the user's wish of
    25.09.2026). One part at a time, the other stays."""
    status, body = call(f"{server}/api/settings", "POST", {"chosen_printer": {"printer": "Snapmaker U1"}})
    assert status == 200 and json.loads(body)["chosen_printer"] == {"printer": "Snapmaker U1"}
    call(f"{server}/api/settings", "POST", {"chosen_printer": {"slicer": "Voron 2.4 300"}})
    assert json.loads(call(f"{server}/api/settings")[1])["chosen_printer"] == {"printer": "Snapmaker U1", "slicer": "Voron 2.4 300"}
    for wrong in ({"chosen_printer": {}}, {"chosen_printer": "Snapmaker U1"}, {"chosen_printer": {"printer": ""}},
                  {"chosen_printer": {"profile": "Snapmaker U1"}}, {"chosen_printer": {"printer": 1}},
                  {"chosen_printer": {"printer": "x" * 201}}, {"chosen_printer": None}):
        status, body = call(f"{server}/api/settings", "POST", wrong)
        assert status == 400 and json.loads(body) == {"error": "setting_invalid"}, wrong
    # Changed by hand to something odd: only what could be a name is passed on.
    settings.change(lambda data: data.update(chosen_printer={"printer": 5, "slicer": "Snapmaker U1", "other": "x"}))
    assert json.loads(call(f"{server}/api/settings")[1])["chosen_printer"] == {"slicer": "Snapmaker U1"}


def test_the_3d_camera_is_a_setting(server, data_dir):
    """Where the user left the camera of "3D Ansicht": the page takes it again instead of the standard
    view (the user's wish of 25.09.2026)."""
    view = {"position": [135.5, -210, 180.25], "target": [135, 135, 20]}
    status, body = call(f"{server}/api/settings", "POST", {"view3d": view})
    assert status == 200 and json.loads(body)["view3d"] == view
    assert json.loads(call(f"{server}/api/settings")[1])["view3d"] == view
    for wrong in ({"view3d": {"position": [1, 2], "target": [0, 0, 0]}}, {"view3d": {"position": [1, 2, "3"], "target": [0, 0, 0]}},
                  {"view3d": {"position": [1, 2, True], "target": [0, 0, 0]}}, {"view3d": {"position": [1, 2, 3]}},
                  {"view3d": {**view, "zoom": 2}}, {"view3d": [1, 2, 3]}, {"view3d": {"position": [1e9, 0, 0], "target": [0, 0, 0]}}):
        status, body = call(f"{server}/api/settings", "POST", wrong)
        assert status == 400 and json.loads(body) == {"error": "setting_invalid"}, wrong
    # Changed by hand to something odd: no camera, the page starts with the standard view.
    settings.change(lambda data: data.update(view3d={"position": "oben"}))
    assert json.loads(call(f"{server}/api/settings")[1])["view3d"] is None


def test_the_folded_menu_is_a_setting(server, data_dir):
    """The button in the top bar folds the menu away; the next start keeps it so (app.js)."""
    status, body = call(f"{server}/api/settings", "POST", {"menu_collapsed": True})
    assert status == 200 and json.loads(body) == {"language": None, "menu_collapsed": True, "theme": None, "area": None, "chosen_printer": {}, "view3d": None}
    assert json.loads((data_dir / "settings.json").read_text(encoding="utf-8"))["menu_collapsed"] is True
    call(f"{server}/api/settings", "POST", {"language": "de"})
    assert json.loads(call(f"{server}/api/settings")[1]) == {"language": "de", "menu_collapsed": True, "theme": None, "area": None, "chosen_printer": {}, "view3d": None}
    call(f"{server}/api/settings", "POST", {"menu_collapsed": False})
    assert json.loads(call(f"{server}/api/settings")[1]) == {"language": "de", "menu_collapsed": False, "theme": None, "area": None, "chosen_printer": {}, "view3d": None}


def test_no_draft_routes(server):
    assert call(f"{server}/prototypes/ui-overview/variante-e.html")[0] == 404
    assert call(f"{server}/orcaone/static/style.css")[0] == 404


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
    data_dir = copy_fixture("snorca", fake_home / "orcaone-test" / "Snapmaker_Orca")
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
    assert listed["location"] == str(settings.DATA_DIR / "backups" / inst["id"])
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


def test_any_device_in_the_lan(server):
    """OrcaOne listens on every interface (the user's wish of 25.09.2026): a page at an IP address
    or at this computer's name works; any other name (DNS rebinding) and another page's Origin not."""
    for host in ("192.168.1.20:4711", "[::1]:4711", f"{socket.gethostname()}:4711", f"{socket.gethostname()}.local"):
        assert call(f"{server}/api/settings", headers={"Host": host})[0] == 200, host
    for host in ("evil.example", "192.168.1.20.evil.example", "0.0.0.0:4711", "224.0.0.1", "["):
        assert call(f"{server}/api/settings", headers={"Host": host})[0] == 403, host
    lan = {"Host": "192.168.1.20:4711", "Origin": "http://192.168.1.20:4711"}
    assert call(f"{server}/api/settings", "POST", {"theme": "dark"}, headers=lan)[0] == 200
    assert call(f"{server}/api/settings", "POST", {"theme": "dark"}, headers={**lan, "Origin": "http://192.168.1.21:4711"})[0] == 403


def test_only_at_this_computer(server, monkeypatch):
    """From another device no data folder is added or removed and no backup deleted: a folder of
    another device (\\\\host\\share) would make Windows send the user's NTLM hash, a backup is the
    way back after every change."""
    local = app_module.is_remote
    monkeypatch.setattr(app_module, "is_remote", lambda client: True)
    assert json.loads(call(f"{server}/api/instances/manual", "POST", {"path": "\\\\evil\\share"})[1]) == {"error": "local_only"}
    assert call(f"{server}/api/instances/manual?path=x", "DELETE")[0] == 403
    assert json.loads(call(f"{server}/api/instances/3b40ea9c4721/backups/x", "DELETE")[1]) == {"error": "local_only"}
    monkeypatch.setattr(app_module, "is_remote", local)
    # Not an installation's id: nothing outside OrcaOne's own backups.
    assert json.loads(call(f"{server}/api/instances/..%5C..%5Cx/backups/y", "DELETE")[1]) == {"error": "backup_not_found"}


def test_who_is_this_computer():
    client = namedtuple("Client", "host")
    assert not any(app_module.is_remote(client(h)) for h in ("127.0.0.1", "127.0.0.2", "::1", "::ffff:127.0.0.1"))
    assert all(app_module.is_remote(c) for c in (client("192.168.1.5"), client("fe80::1"), client("testclient"), None))


def test_answers_of_the_api_never_run_as_a_page(server):
    """A printer's file opened in a tab (HTML or SVG of a printer, or of a host posing as one) must
    not run script as OrcaOne: files keep only the types the pages show, the API is sandboxed."""
    with urllib.request.urlopen(f"{server}/api/settings", timeout=5) as response:
        assert response.headers["X-Content-Type-Options"] == "nosniff"
        assert response.headers["Content-Security-Policy"].startswith("sandbox")
    with urllib.request.urlopen(f"{server}/", timeout=5) as response:
        assert "sandbox" not in response.headers["Content-Security-Policy"]

    class Answer:
        status = 200

        def __init__(self, kind):
            self.headers = {"Content-Type": kind}

        def read(self, size):
            return b""

        def close(self):
            pass
    kinds = {name: app_module._passed_on(Answer(kind), f"x/{name}").media_type
             for name, kind in (("evil.html", "text/html; charset=utf-8"), ("a.svg", "image/svg+xml"), ("a.png", "image/png"),
                                ("a.mp4", "video/mp4"), ("a.gcode", "application/octet-stream"))}
    assert kinds == {"evil.html": "application/octet-stream", "a.svg": "application/octet-stream", "a.png": "image/png",
                     "a.mp4": "video/mp4", "a.gcode": "text/plain; charset=utf-8"}


def test_websockets_refuse_a_rebound_name():
    """DNS rebinding: a page of evil.example whose name resolves to this computer sends its own
    name as Host and its own Origin; only the Host check stops it, for /api/ssh, /api/network, /api/live."""
    page = lambda host, origin: SimpleNamespace(headers={"host": host, "origin": origin})
    assert not app_module._own_page(page("evil.example:4711", "http://evil.example:4711"))
    assert app_module._own_page(page("127.0.0.1:4711", "http://127.0.0.1:4711"))
    assert app_module._own_page(page("192.168.1.20:4711", "http://192.168.1.20:4711"))
    assert not app_module._own_page(page("192.168.1.20:4711", "http://evil.example"))


def test_printer_addresses_and_backups_only_at_this_computer(server, monkeypatch):
    """A device in the LAN could point a printer at its own host, where the pages on this computer
    log in with its SSH keys; and a backup is the way back. Neither from there."""
    monkeypatch.setattr(app_module, "is_remote", lambda client: True)
    for body in ({"model": "Snapmaker U1", "host": "192.168.1.66"}, {"model": "Snapmaker U1", "name": "Zweiter", "host": "192.168.1.66"}):
        assert json.loads(call(f"{server}/api/printers", "POST", body)[1]) == {"error": "local_only"}


def test_a_backup_outside_an_installation_is_never_touched(server, monkeypatch):
    monkeypatch.setattr(app_module.backup, "delete", lambda *a: pytest.fail("reached backup.delete"))
    for instance_id in ("..%5C..%5Cx", "3B40EA9C4721", "3b40ea9c472"):
        status, body = call(f"{server}/api/instances/{instance_id}/backups/2026-09-25_120000_manual", "DELETE")
        assert (status, json.loads(body)) == (404, {"error": "backup_not_found"}), instance_id


def test_a_huge_number_for_the_3d_camera(server, data_dir):
    view = {"position": [10 ** 400, 0, 0], "target": [0, 0, 0]}
    assert call(f"{server}/api/settings", "POST", {"view3d": view})[0] == 400
