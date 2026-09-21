import json
import threading
import time
import urllib.error
import urllib.request

import pytest
import uvicorn

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


def test_serves_the_ui(server):
    status, body = call(f"{server}/")
    assert status == 200 and b'<div id="app">' in body


def test_rejects_foreign_hosts_and_origins(server):
    status, _ = call(f"{server}/api/instances", headers={"Host": "evil.example"})
    assert status == 403
    status, _ = call(f"{server}/api/instances/manual", "POST", {"path": "/"}, headers={"Origin": "http://evil.example"})
    assert status == 403
