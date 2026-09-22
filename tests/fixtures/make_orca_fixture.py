"""Build tests/fixtures/orca from a real OrcaSlicer 2.5 (nightly) data directory.

Reads the source strictly read only and never runs during tests. Copies the vendor caches
system/*.opc as shipped (vendor data, no personal data) and an anonymised OrcaSlicer.conf.
The replacements are those of make_snorca_fixture.py; the access codes of LAN printers are
masked as well (FINDINGS 4.3).

Usage: python tests/fixtures/make_orca_fixture.py ~/.config/OrcaSlicer
"""

import json
import re
import shutil
import sys
from pathlib import Path

TARGET = Path(__file__).parent / "orca"
CACHES = ["Custom.opc", "OrcaFilamentLibrary.opc", "Snapmaker.opc"]
HOME = str(Path.home())


def check_source(source: Path) -> None:
    """Refuse sources whose .conf holds personal data the text replacements miss."""
    conf = json.loads((source / "OrcaSlicer.conf").read_text(encoding="utf-8"))
    for key in ("devices", "local_machines"):
        if conf.get(key):
            sys.exit(f"{key} is not empty: remove the printer connections by hand first")
    # Keys of access_code are printer serial numbers; only the empty default entry may be there.
    if any(conf.get("access_code") or {}):
        sys.exit("access_code names a printer: remove the printer connections by hand first")
    if conf.get("app", {}).get("preset_folder"):
        sys.exit("preset_folder holds a user id: sign out and start the slicer once first")


def anonymised_conf(source: Path) -> None:
    raw = (source / "OrcaSlicer.conf").read_text(encoding="utf-8")
    # Text replacements keep the slicer's exact formatting (tab indent).
    raw = re.sub(r'("slicer_uuid": ")[^"]*"', r'\g<1>00000000-0000-0000-0000-000000000000"', raw)
    raw = re.sub(r'"access_code": \{[^{}]*\}',
                 lambda m: re.sub(r'(:\s*")[^"]*"', r'\g<1>00000000"', m.group(0)), raw)
    raw = raw.replace(HOME, "/home/user")
    (TARGET / "OrcaSlicer.conf").write_text(raw, encoding="utf-8")


def main() -> None:
    source = Path(sys.argv[1]).expanduser()
    check_source(source)
    if TARGET.exists():
        shutil.rmtree(TARGET)
    (TARGET / "system").mkdir(parents=True)
    anonymised_conf(source)
    for name in CACHES:
        shutil.copyfile(source / "system" / name, TARGET / "system" / name)
    print(f"written: {sum(1 for p in TARGET.rglob('*') if p.is_file())} files in {TARGET}")


if __name__ == "__main__":
    main()
