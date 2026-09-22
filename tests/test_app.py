import json
import os
import posixpath
import re
import sys
import threading
import time
import urllib.error
import urllib.request

import pytest
import uvicorn

from conftest import copy_fixture
from orfix import guard, instances
from orfix.__main__ import free_port
from orfix.app import app


@pytest.fixture
def server(fake_home, monkeypatch):
    """The real app on 127.0.0.1, isolated from the real slicers."""
    monkeypatch.setattr(guard, "find_processes", lambda: [])
    monkeypatch.setattr(instances.platform, "system", lambda: "Linux")
    port = free_port()
    srv = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning"))
    thread = threading.Thread(target=srv.run, daemon=True)
    thread.start()
    while not srv.started:
        assert thread.is_alive(), "server did not start"
        time.sleep(0.02)
    yield f"http://127.0.0.1:{port}"
    srv.should_exit = True
    thread.join(timeout=5)


def call(url, method="GET", body=None, headers=None):
    data = json.dumps(body).encode() if body is not None else None
    request = urllib.request.Request(url, data=data, method=method, headers={"Content-Type": "application/json", **(headers or {})})
    try:
        with urllib.request.urlopen(request, timeout=5) as response:
            return response.status, response.read()
    except urllib.error.HTTPError as err:
        return err.code, err.read()


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
