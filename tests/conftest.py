import json
import shutil
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path

import pytest
import uvicorn

from orcaone import camera, guard, instances, settings
from orcaone.__main__ import free_port
from orcaone.app import app

FIXTURES = Path(__file__).parent / "fixtures"


@pytest.fixture(autouse=True)
def data_dir(tmp_path, monkeypatch):
    """OrcaOne's own folder data/ (settings, backups) in the test's temporary folder, never the
    real one next to orcaone.sh."""
    folder = tmp_path / "orcaone-data"
    monkeypatch.setattr(settings, "DATA_DIR", folder)
    # What the last scan found in the slicers' printer profiles (overview.build_all).
    monkeypatch.setattr(camera, "_slicer_hosts", {})
    return folder


@pytest.fixture
def fake_home(tmp_path, monkeypatch):
    """An empty home directory; every location OrcaOne looks at points into it.

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


BUNDLE = "_local/abc123"  # prefix of the profiles add_bundle puts in


def add_bundle(data_dir: Path) -> Path:
    """A bundle as OrcaSlicer 2.5 imports it (FINDINGS 4.2) into a copy of tests/fixtures/orca:
    a filament for the U1 with 0.4 nozzle only, and a printer on the U1 with 0.4 nozzle."""
    folder = data_dir / "user" / "default" / "_local" / "paket1"
    profiles = {"filament": ("Paket PLA", {"inherits": "Generic PLA @System",
                                           "compatible_printers": ["Snapmaker U1 (0.4 nozzle)"]}),
                "machine": ("Paket U1", {"inherits": "Snapmaker U1 (0.4 nozzle)"})}
    for kind, (name, data) in profiles.items():
        (folder / kind).mkdir(parents=True)
        body = {"name": name, "from": "Bundle", "version": "2.5.0", **data}
        (folder / kind / f"{name}.json").write_text(json.dumps(body, indent=4) + "\n", encoding="utf-8")
    (folder / "bundle_metadata.json").write_text(json.dumps({"id": "abc123", "name": "Mein Paket"}), encoding="utf-8")
    return folder


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
