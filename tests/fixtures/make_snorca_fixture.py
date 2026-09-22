"""Build tests/fixtures/snorca from a real Snapmaker Orca data directory.

Reads the source strictly read only and never runs during tests. Copies a small,
complete slice: the U1 printers, two processes, a few filaments with their full
inherits chains, library profiles for the acceptance checklist in
docs/FINDINGS.md, and an anonymised .conf. Adds synthetic own profiles in
user/default/, written like Preset::save and Preset::save_info (FINDINGS 4.4),
because the real installation has none.

Usage: python tests/fixtures/make_snorca_fixture.py ~/.config/Snapmaker_Orca
"""

import json
import re
import shutil
import sys
from pathlib import Path

TARGET = Path(__file__).parent / "snorca"

VENDOR_PROFILES = {
    "machine_model_list": ["Snapmaker U1"],
    "machine_list": [
        "Snapmaker U1 (0.2 nozzle)", "Snapmaker U1 (0.4 nozzle)",
        "Snapmaker U1 (0.6 nozzle)", "Snapmaker U1 (0.8 nozzle)",
    ],
    "process_list": [
        "0.20mm Standard @Snapmaker U1 (0.4 nozzle)",
        "0.08mm Standard @Snapmaker U1 (0.4 nozzle)",
    ],
    "filament_list": [
        "Snapmaker PLA Basic @U1", "Snapmaker ABS @U1 0.4 nozzle", "Snapmaker ABS @U1 0.2 nozzle",
        "Snapmaker ABS @J1",
        "Generic PLA", "Generic PLA @U1 0.2 nozzle",
    ],
}
# Files in the vendor folder that are no profiles or not in the manifest.
VENDOR_EXTRA_FILES = [
    "filament/filament_allow_list.json",
    "process/0.24 Standard @Snapmaker (0.8 nozzle).json",
]
LIBRARY_PROFILES = [
    "SUNLU PLA+ @System", "SUNLU PLA Marble @System", "AliZ PETG-CF @System",
    "Generic PLA @System", "Generic PETG @System",
]
HOME = str(Path.home())
# Synthetic own profiles: (kind, name, own values). Parent and version come from the copied
# system profiles, like the slicer takes them when saving.
OWN_PROFILES = [
    ("filament", "Mein PLA", {"inherits": "Snapmaker PLA Basic @U1", "filament_settings_id": ["Mein PLA"],
                              "nozzle_temperature": ["215"]}),
    # Its parent does not exist: the slicer skips it ("can not find parent").
    ("filament", "Altes PETG", {"inherits": "Snapmaker PETG @U1 alt", "filament_settings_id": ["Altes PETG"],
                                "nozzle_temperature": ["245"], "hot_plate_temp": ["75"],
                                "compatible_printers": ["Snapmaker U1 (0.4 nozzle)"]}),
    ("machine", "Mein U1", {"inherits": "Snapmaker U1 (0.4 nozzle)", "printer_settings_id": "Mein U1",
                            "printable_height": "260"}),
]
UPDATED_TIME = 1758520000


def copy(source: Path, relative: str) -> None:
    """Copy <source data dir>/<relative> to the same place in TARGET."""
    target = TARGET / relative
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(source / relative, target)


def vendor_slice(source: Path, vendor: str) -> None:
    manifest = json.loads((source / "system" / f"{vendor}.json").read_text(encoding="utf-8"))
    entries = {e["name"]: (key, e) for key in VENDOR_PROFILES for e in manifest[key]}
    wanted = set()
    for names in VENDOR_PROFILES.values():
        for name in names:
            while name and name not in wanted:
                wanted.add(name)
                profile = json.loads((source / "system" / vendor / entries[name][1]["sub_path"]).read_text(encoding="utf-8"))
                name = profile.get("inherits", "")
    for key in VENDOR_PROFILES:
        manifest[key] = [e for e in manifest[key] if e["name"] in wanted]
        for entry in manifest[key]:
            copy(source, f"system/{vendor}/{entry['sub_path']}")
    for relative in VENDOR_EXTRA_FILES:
        copy(source, f"system/{vendor}/{relative}")
    target = TARGET / "system" / f"{vendor}.json"
    target.write_text(json.dumps(manifest, indent=4, ensure_ascii=False) + "\n", encoding="utf-8")


def library_slice(source: Path) -> None:
    # The manifest is empty in Snapmaker Orca, so profiles are found by their name field.
    by_name = {}
    for file in (source / "system" / "OrcaFilamentLibrary").rglob("*.json"):
        by_name[json.loads(file.read_text(encoding="utf-8"))["name"]] = file.relative_to(source).as_posix()
    for name in LIBRARY_PROFILES:
        while name:
            copy(source, by_name[name])
            name = json.loads((source / by_name[name]).read_text(encoding="utf-8")).get("inherits", "")
    copy(source, "system/OrcaFilamentLibrary.json")


def own_profiles() -> None:
    """Write OWN_PROFILES as Preset::save does: only the differences plus version, name, from,
    inherits and the *_settings_id, sorted, 4 spaces, newline at the end; the .info carries the
    parent's setting_id as base_id (PresetCollection::save_current_preset)."""
    manifest = json.loads((TARGET / "system" / "Snapmaker.json").read_text(encoding="utf-8"))
    version = ".".join(str(int(part)) for part in manifest["version"].split("."))
    sub_paths = {e["name"]: e["sub_path"] for key in VENDOR_PROFILES for e in manifest[key]}
    for kind, name, values in OWN_PROFILES:
        parent = sub_paths.get(values["inherits"])
        base_id = ""
        if parent:
            base_id = json.loads((TARGET / "system" / "Snapmaker" / parent).read_text(encoding="utf-8")).get("setting_id", "")
        folder = TARGET / "user" / "default" / kind
        folder.mkdir(parents=True, exist_ok=True)
        body = {"version": version, "name": name, "from": "User", **values}
        (folder / f"{name}.json").write_text(json.dumps(body, indent=4, ensure_ascii=False, sort_keys=True) + "\n",
                                            encoding="utf-8")
        info = f"sync_info = \nuser_id = \nsetting_id = \nbase_id = {base_id}\nupdated_time = {UPDATED_TIME}\n"
        (folder / f"{name}.info").write_text(info, encoding="utf-8")


def check_source(source: Path) -> None:
    """Refuse sources whose .conf holds personal data the text replacements miss."""
    conf = json.loads((source / "Snapmaker_Orca.conf").read_text(encoding="utf-8"))
    if conf.get("devices"):
        sys.exit("devices is not empty: remove the printer connections by hand first")
    if conf.get("app", {}).get("preset_folder"):
        sys.exit("preset_folder holds a user id: sign out and start the slicer once first")


def anonymised_conf(source: Path) -> None:
    raw = (source / "Snapmaker_Orca.conf").read_text(encoding="utf-8")
    # Text replacements keep the slicer's exact formatting.
    raw = re.sub(r'("slicer_uuid": ")[^"]*"', r'\g<1>00000000-0000-0000-0000-000000000000"', raw)
    raw = raw.replace(HOME, "/home/user")
    (TARGET / "Snapmaker_Orca.conf").write_text(raw, encoding="utf-8")


def main() -> None:
    source = Path(sys.argv[1]).expanduser()
    check_source(source)
    if TARGET.exists():
        shutil.rmtree(TARGET)
    TARGET.mkdir()
    anonymised_conf(source)
    vendor_slice(source, "Snapmaker")
    library_slice(source)
    own_profiles()
    print(f"written: {sum(1 for p in TARGET.rglob('*') if p.is_file())} files in {TARGET}")


if __name__ == "__main__":
    main()
