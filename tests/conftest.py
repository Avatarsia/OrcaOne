import json
import shutil
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path

import pytest
import uvicorn

from orfix import guard, instances
from orfix.__main__ import free_port
from orfix.app import app

FIXTURES = Path(__file__).parent / "fixtures"


@pytest.fixture
def fake_home(tmp_path, monkeypatch):
    """An empty home directory; every location Orfix looks at points into it.

    Tests never read the real slicer directories (hard rule 1)."""
    home = tmp_path / "home"
    home.mkdir()
    monkeypatch.setattr(Path, "home", lambda: home)
    monkeypatch.delenv("XDG_CONFIG_HOME", raising=False)
    monkeypatch.setenv("XDG_DATA_HOME", str(home / ".local" / "share"))
    monkeypatch.setenv("APPDATA", str(home / "AppData" / "Roaming"))
    monkeypatch.setenv("LOCALAPPDATA", str(home / "AppData" / "Local"))
    return home


def copy_fixture(name: str, target: Path) -> Path:
    """A copy of tests/fixtures/<name> to change in a test; the fixture itself stays untouched."""
    shutil.copytree(FIXTURES / name, target)
    return target


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
