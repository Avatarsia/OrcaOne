"""LICENSE.md and the page "Lizenz" hold the licence twice: the page's sections in texts/en.js (the
binding English text) and texts/de.js (the German translation) must match the file, section for
section and paragraph for paragraph."""

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def sections(md: str) -> list[tuple[str, list[str]]]:
    """(title, paragraphs) per "## " section, paragraphs on one line each."""
    out = []
    for block in re.split(r"\n\s*\n", md.strip()):
        block = block.strip()
        if block.startswith("# ") or block.startswith("<http"):
            continue
        if block.startswith("## "):
            out.append((block[3:].strip(), []))
        else:
            out[-1][1].append(" ".join(line.strip() for line in block.splitlines()))
    return out


def test_the_page_holds_the_licence_of_license_md():
    head, english, german = (ROOT / "LICENSE.md").read_text(encoding="utf-8").split("\n---\n")
    assert "Required Notice: Copyright (c) 2026 Dominik Schmidt (OrcaOne)" in head
    assert english.lstrip().startswith("# PolyForm Noncommercial License 1.0.0\n")
    for part, js in ((english, "en.js"), (german, "de.js")):
        text = (ROOT / "orcaone" / "static" / "texts" / js).read_text(encoding="utf-8").replace('\\"', '"')
        found = sections(part)
        assert len(found) == 15, js
        for title, paragraphs in found:
            assert f'{{ title: "{title}", text: [' in text, (js, title)
            for paragraph in paragraphs:
                assert f'"{paragraph}",' in text, (js, paragraph[:60])
