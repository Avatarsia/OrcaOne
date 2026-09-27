"""Printer pictures from the slicers' program folders or GitHub (orcaone/covers.py), against made-up
folders in the test's temporary folder and a stand-in for GitHub; conftest keeps every test away from
the real program folders and the internet."""

import os
import threading
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from types import SimpleNamespace

import pytest

from orcaone import covers
from orcaone.covers import candidates as real_candidates   # before conftest replaces it in each test

PNG = b"\x89PNG\r\n\x1a\n" + b"\0" * 16


def put(path: Path) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(PNG)
    return path


def test_where_the_resources_may_lie(tmp_path, monkeypatch):
    """The running program's folder first (Windows: next to the exe; AppImage, /opt: <exe>/../../resources),
    then the usual places of an installed slicer."""
    exe = tmp_path / "orca" / "bin" / "orca-slicer"
    running = [SimpleNamespace(slicer="OrcaSlicer", exe=str(exe)), SimpleNamespace(slicer="Snapmaker_Orca", exe="/x/snapmaker-orca"),
               SimpleNamespace(slicer="OrcaSlicer", exe=None)]
    if os.name == "nt":
        monkeypatch.setenv("ProgramFiles", str(tmp_path / "pf"))
        monkeypatch.setenv("ProgramW6432", str(tmp_path / "pf"))
        monkeypatch.setattr(covers, "_registered", lambda slicer: [tmp_path / "custom" / "resources"])
    got = real_candidates("OrcaSlicer", running)
    assert got[:2] == [exe.parent / "resources", exe.parent.parent / "resources"]
    if os.name == "nt":
        assert got[2:] == [tmp_path / "pf" / "OrcaSlicer" / "resources", tmp_path / "custom" / "resources"]
    else:
        # Flatpak: /app/share/<APP_KEY> in the sandbox; packages built with SLIC3R_FHS: <prefix>/share/<APP_KEY>.
        assert got[2:] == [Path("/var/lib/flatpak/app/com.orcaslicer.OrcaSlicer/current/active/files/share/OrcaSlicer"),
                           Path.home() / ".local/share/flatpak/app/com.orcaslicer.OrcaSlicer/current/active/files/share/OrcaSlicer",
                           Path("/var/lib/flatpak/app/io.github.softfever.OrcaSlicer/current/active/files/share/OrcaSlicer"),
                           Path.home() / ".local/share/flatpak/app/io.github.softfever.OrcaSlicer/current/active/files/share/OrcaSlicer",
                           Path("/usr/share/OrcaSlicer"), Path("/usr/local/share/OrcaSlicer")]


def test_the_pictures_of_both_slicers(tmp_path, monkeypatch):
    snorca = tmp_path / "Snapmaker_Orca" / "resources"
    orca = tmp_path / "OrcaSlicer" / "resources"
    u1 = put(snorca / "profiles" / "Snapmaker" / "Snapmaker U1_cover.png")
    ginger = put(snorca / "profiles" / "Ginger Additive" / "ginger G1_cover.png")   # as in Snapmaker Orca 2.4.0
    x1 = put(orca / "web" / "image" / "printer" / "Bambu Lab X1_cover.png")
    (orca / "profiles").mkdir()
    # Only a folder with profiles/ counts; a candidate that is not there is left out.
    monkeypatch.setattr(covers, "candidates", lambda slicer, processes: [tmp_path / slicer / "resources", tmp_path / "gone"])
    assert covers.program_dirs("OrcaSlicer", []) == [orca]

    cover = covers.finder([])
    file_of = lambda address: covers.file_of(address.removeprefix("api/covers/"))
    # From the other slicer when the own has none; regardless of case; without a known vendor in all.
    assert cover("Snapmaker", "Snapmaker U1").startswith("api/covers/") and file_of(cover("Snapmaker", "Snapmaker U1")) == u1
    assert file_of(cover("Ginger Additive", "Ginger G1")) == ginger
    assert file_of(cover(None, "Snapmaker U1")) == u1
    assert file_of(cover("BBL", "Bambu Lab X1")) == x1
    # Else OrcaOne's own drawings.
    assert cover("Custom", "Generic Klipper Printer") == "assets/printer-klipper.svg"
    assert cover("Voron", "Voron 2.4 300") == covers.PLACEHOLDER
    for model in ("../Snapmaker U1", "a\\b", "", None):
        assert cover("Snapmaker", model) == covers.PLACEHOLDER
    assert covers.file_of("0123456789ab") is None


def test_the_api_serves_only_what_was_found(server, tmp_path, monkeypatch):
    res = tmp_path / "Snapmaker_Orca" / "resources"
    put(res / "profiles" / "Snapmaker" / "Snapmaker U1_cover.png")
    monkeypatch.setattr(covers, "candidates", lambda slicer, processes: [res] if slicer == "Snapmaker_Orca" else [])
    address = covers.finder([])("Snapmaker", "Snapmaker U1")
    with urllib.request.urlopen(f"{server}/{address}", timeout=5) as response:
        assert response.status == 200 and response.read() == PNG
        assert response.headers["Content-Type"] == "image/png" and response.headers["X-Content-Type-Options"] == "nosniff"
        assert response.headers["Cache-Control"] == "max-age=3600"
    try:
        urllib.request.urlopen(f"{server}/api/covers/0123456789ab", timeout=5)
        raise AssertionError("an unknown picture must not be served")
    except urllib.error.HTTPError as err:
        assert err.code == 404


@pytest.fixture
def github(monkeypatch):
    """A stand-in for raw.githubusercontent.com: the profiles folders of both repositories. Returns
    the paths asked for."""
    asked = []
    files = {"/snorca/Snapmaker/Snapmaker%20U1_cover.png": PNG, "/orca/Bad/Text_cover.png": b"<html>not a picture"}

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            asked.append(self.path)
            body = files.get(self.path, b"404: Not Found")
            self.send_response(200 if self.path in files else 404)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *args):
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{server.server_address[1]}"
    monkeypatch.setattr(covers, "SOURCES", {"Snapmaker_Orca": base + "/snorca", "OrcaSlicer": base + "/orca"})
    yield asked
    server.shutdown()


def test_fetched_from_github_and_kept(github, data_dir):
    """No slicer shows the picture: the first look fetches it, OrcaSlicer's repository first, and keeps
    it in data/covers/<slicer>/; after that it is never fetched again."""
    cover = covers.finder([])
    key = cover("Snapmaker", "Snapmaker U1").removeprefix("api/covers/")
    assert github == []   # the scan only names it
    path = covers.file_of(key)
    assert github == ["/orca/Snapmaker/Snapmaker%20U1_cover.png", "/snorca/Snapmaker/Snapmaker%20U1_cover.png"]
    assert path == data_dir / "covers" / "Snapmaker_Orca" / "Snapmaker" / "Snapmaker U1_cover.png" and path.read_bytes() == PNG
    assert covers.file_of(key) == path
    assert covers.file_of(covers.finder([])("Snapmaker", "Snapmaker U1").removeprefix("api/covers/")) == path
    assert len(github) == 2
    # Not a PNG, or none at all: nothing kept, asked once only, then OrcaOne's own drawing.
    for vendor, model in (("Bad", "Text"), ("Voron", "Voron 2.4 300"), ("Custom", "Generic Klipper Printer")):
        key = cover(vendor, model).removeprefix("api/covers/")
        asked = len(github)
        assert covers.file_of(key) is None and len(github) == asked + 2
        assert covers.file_of(key) is None and len(github) == asked + 2
        assert covers.fallback_of(key) == covers.FALLBACK.get(model, covers.PLACEHOLDER)
        assert cover(vendor, model) == covers.FALLBACK.get(model, covers.PLACEHOLDER)
    assert not (data_dir / "covers" / "OrcaSlicer" / "Bad").exists()
    # A vendor unknown, or a name that would leave its folder: nothing to fetch.
    assert cover(None, "Snapmaker U1") == covers.FALLBACK["Snapmaker U1"]
    assert cover("..", "x") == cover("a:b", "x") == covers.PLACEHOLDER


def test_the_api_shows_the_drawing_without_a_picture(server, github):
    key = covers.finder([])("Voron", "Voron 2.4 300").removeprefix("api/covers/")
    with urllib.request.urlopen(f"{server}/api/covers/{key}", timeout=10) as response:
        assert response.url.endswith("/assets/printer-placeholder.svg") and response.read().startswith(b"<svg")


def test_without_internet_no_waiting(data_dir, monkeypatch):
    """GitHub not reachable (here a port nobody listens on): the first picture gives up, and for
    OFFLINE_PAUSE no other one tries; nothing is noted as missing, a later run tries again."""
    closed = ThreadingHTTPServer(("127.0.0.1", 0), BaseHTTPRequestHandler)
    port = closed.server_address[1]
    closed.server_close()
    monkeypatch.setattr(covers, "SOURCES", {"OrcaSlicer": f"http://127.0.0.1:{port}/orca", "Snapmaker_Orca": f"http://127.0.0.1:{port}/snorca"})
    cover = covers.finder([])
    key = cover("Snapmaker", "Snapmaker U1").removeprefix("api/covers/")
    assert covers.file_of(key) is None and covers.fallback_of(key) == covers.FALLBACK["Snapmaker U1"]
    assert cover("Voron", "Voron 2.4 300") == covers.PLACEHOLDER and covers._missing == set()
    monkeypatch.setattr(covers, "_offline_until", 0.0)
    assert cover("Voron", "Voron 2.4 300").startswith("api/covers/")


def test_a_picture_gone_since_shows_the_drawing(tmp_path, monkeypatch):
    """An AppImage's picture lies in its mount only while it runs: gone since the scan, the page
    gets OrcaOne's drawing of the model instead."""
    res = tmp_path / "mount" / "resources"
    u1 = put(res / "profiles" / "Snapmaker" / "Snapmaker U1_cover.png")
    monkeypatch.setattr(covers, "candidates", lambda slicer, processes: [res])
    key = covers.finder([])("Snapmaker", "Snapmaker U1").removeprefix("api/covers/")
    u1.unlink()
    assert covers.file_of(key) is None and covers.fallback_of(key) == covers.FALLBACK["Snapmaker U1"]


def test_orcaslicers_picture_first(github, data_dir, tmp_path, monkeypatch):
    """OrcaSlicer's pictures go before Snapmaker Orca's (the user finds them nicer), also before an
    installed Snapmaker Orca's; that one stands in when OrcaSlicer's repository has none."""
    snorca = tmp_path / "Snapmaker_Orca" / "resources"
    local = put(snorca / "profiles" / "Snapmaker" / "Snapmaker U1_cover.png")
    monkeypatch.setattr(covers, "candidates", lambda slicer, processes: [snorca] if slicer == "Snapmaker_Orca" else [])
    key = covers.finder([])("Snapmaker", "Snapmaker U1").removeprefix("api/covers/")
    assert covers.file_of(key) == local and github == ["/orca/Snapmaker/Snapmaker%20U1_cover.png"]
    # One fetched from OrcaSlicer's repository before goes first, without asking again.
    kept = put(data_dir / "covers" / "OrcaSlicer" / "Snapmaker" / "Snapmaker U1_cover.png")
    key = covers.finder([])("Snapmaker", "Snapmaker U1").removeprefix("api/covers/")
    assert covers.file_of(key) == kept and len(github) == 1
