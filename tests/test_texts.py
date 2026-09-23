"""The backend sends codes, orcaone/static/texts/de.js and en.js have their words. Every code needs
a text in both, else the page shows nothing or stops."""
import re
from pathlib import Path

import pytest

from conftest import FIXTURES
from orcaone import scanner
from orcaone.resolver import STATUS_OF_PROBLEM
from test_overview import build

LANGUAGES = {lang: (Path(__file__).parent.parent / "orcaone" / "static" / "texts" / f"{lang}.js").read_text(encoding="utf-8")
             for lang in ("de", "en")}
OPERATIONS = (Path(__file__).parent.parent / "orcaone" / "operations.py").read_text(encoding="utf-8")


def section(text: str, name: str) -> str:
    """The body of `name: { ... }` in a texts file; braces of ${...} are balanced, too."""
    match = re.search(rf"(?<![\w.]){re.escape(name)}: \{{", text)
    assert match, name
    depth, i = 0, match.end() - 1
    while True:
        depth += {"{": 1, "}": -1}.get(text[i], 0)
        if depth == 0:
            return text[match.end():i]
        i += 1


def keys(name: str) -> set:
    """The keys of a section that both languages have."""
    found = [set(re.findall(r'(?:^|[\s{,])"?([\w-]+)"?\s*[:(]', section(text, name))) for text in LANGUAGES.values()]
    return set.intersection(*found)


def tree_codes(nodes, notes, ignored):
    for node in nodes:
        notes.add(node["note"])
        notes.update(x["note"] for x in node.get("extra_files", []))
        if node.get("ignored"):
            ignored.add(node["ignored"])
        tree_codes(node.get("children", []), notes, ignored)


@pytest.fixture
def data(fake_home):
    return [build(FIXTURES / "snorca"), build(FIXTURES / "orca")]


def test_every_code_of_the_fixtures_has_a_text(data):
    notes, ignored = set(), set()
    for inst in data:
        tree_codes(inst["slicer_page"]["tree"], notes, ignored)
        assert {w["code"] for w in inst["warnings"]} <= keys("warnings")
        assert {p["note"] for p in inst["slicer_page"]["packages"]} <= keys("packageNotes")
        assert {d["reason"] for d in inst["printers_page"]["dead_entries"]} <= keys("deadEntries")
        assert {inst["slicer_page"]["system_refresh"]["code"]} <= keys("systemRefresh")
        assert {inst["source"]} <= keys("sources")
    assert notes <= keys("notes")
    assert ignored <= keys("ignoredShort")


def test_every_code_the_backend_knows_has_a_text():
    notes = {note for _, note in scanner.TOP_LEVEL.values()} | {scanner.OTHER[1]}
    notes |= {note for entries in scanner.OUTSIDE.values() for _, _, note in entries}
    assert notes <= keys("notes")
    assert set(STATUS_OF_PROBLEM) <= keys("profileProblems") & keys("ignoredShort")
    assert set(STATUS_OF_PROBLEM.values()) <= keys("warnings")
    assert {"scan_failed"} <= keys("failed")  # failed[] of orcaone/overview.py build_all
    assert set(scanner.CATEGORY_ORDER) <= keys("category")
    assert {"auto", "flatpak", "flatpak_legacy", "appimage_portable", "process", "manual"} <= keys("sources")
    # orcaone/app.py and orcaone/instances.py, plus "network" and "unknown" from api.js
    assert {"path_not_found", "not_a_data_dir", "already_listed", "not_listed", "save_failed", "forbidden", "setting_invalid",
            "network", "unknown"} <= keys("errors")


def test_every_code_of_plans_and_writes_has_a_text():
    # POST /plan, /apply, /restore-plan and the backup API (orcaone/operations.py, orcaone/backup.py)
    problems = set(re.findall(r'(?:Blocked|OperationError)\("(\w+)"', OPERATIONS))
    problems |= {"slicer_running", "slicer_maybe_running", "conf_unreadable", "name_invalid",
                 "name_too_long", "path_outside_backup", "backup_unreadable", "backup_failed", "backup_not_found",
                 "delete_failed", "invalid_change"}
    assert problems <= keys("blocked") | keys("errors")
    warnings = set(re.findall(r'"code": "(\w+)"', OPERATIONS)) - {"nothing_to_do"}
    assert "default_materials_back" in warnings and warnings <= keys("planWarnings")
