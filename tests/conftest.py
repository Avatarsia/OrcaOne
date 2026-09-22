import shutil
from pathlib import Path

import pytest

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
