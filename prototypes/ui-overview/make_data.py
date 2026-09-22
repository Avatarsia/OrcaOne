#!/usr/bin/env python3
"""Build sample data for the overview UI drafts: writes data.js (window.ORFIX_DATA).

Reads the real slicer data directories strictly read-only and never starts a
slicer. The rules are a simplified version of docs/FINDINGS.md 4.6 and 4.7:
installed system printers from "models", compatibility via compatible_printers,
the library exclusion by alias, visibility via the "filaments" list.
Filament colours come from default_filament_colour or, in SnOrca, from the vendor's
filaments_colours.json; printer pictures are the copies in assets/.
Own printers the slicer loads get a model entry of their own, with the picture of their
base model. Everything marked "example" does not exist on disk; the drafts hide it by default.
Per instance it also builds the data for the pages "Slicer" (facts, packages, folder
tree, FINDINGS 4.2/4.3), "Drucker" (printers, default, stale orca_presets entries,
packages the slicer drops, FINDINGS 4.2/4.9) and "Sicherungen" (example backups sized like
a real one, hard rule 4), plus why a slicer counts as running (FINDINGS 4.1).
Standard library only. The .opc files are read with prototypes/opc/opc_read.py.

Usage: python3 make_data.py
"""
import colorsys
import io
import json
import os
import re
import sys
import zipfile
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from pathlib import Path, PurePosixPath

HERE = Path(__file__).resolve().parent
sys.dont_write_bytecode = True  # keep prototypes/opc free of __pycache__
sys.path.insert(0, str(HERE.parent / "opc"))
import opc_read  # noqa: E402

LIBRARY = "OrcaFilamentLibrary"

# Meta keys of a profile JSON; everything else is a setting (FINDINGS 4.4).
META_KEYS = {"version", "name", "type", "from", "inherits", "instantiation", "setting_id",
             "filament_id", "description", "renamed_from", "url", "is_custom_defined"}
# Keys a helper profile may carry besides the meta keys: the printer binding and the id the
# slicer always writes when saving.
BINDING_KEYS = {"compatible_printers", "compatible_printers_condition", "filament_settings_id"}

# Core values shown per filament: key, label, unit.
CORE_VALUES = [
    ("nozzle_temperature", "Düsentemperatur", "°C"),
    ("hot_plate_temp", "Bett", "°C"),
    ("filament_flow_ratio", "Flow", ""),
    ("filament_max_volumetric_speed", "Max. Volumengeschwindigkeit", "mm³/s"),
    ("filament_density", "Dichte", "g/cm³"),
    ("filament_cost", "Preis", "je kg"),
]

# Values a user may change per filament: key, label, unit, group, type, slicer default, min, max.
# Defaults and limits from PrintConfigDef (src/libslic3r/PrintConfig.cpp), identical in
# SnOrca 2.4.0 and Orca main. The default applies when no profile in the chain sets the key.
# The colour is default_filament_colour: the filament tab shows that one, filament_colour is the
# colour of a slot in the project and commented out there (Tab.cpp, TabFilament::build).
EDITABLE_FIELDS = [
    ("filament_vendor", "Hersteller", "", "Allgemein", "text", "(Undefined)", None, None),
    ("default_filament_colour", "Farbe", "", "Allgemein", "colour", "", None, None),
    ("nozzle_temperature", "Düse", "°C", "Temperaturen", "int", "200", 0, 1500),
    ("nozzle_temperature_initial_layer", "Düse, erste Schicht", "°C", "Temperaturen", "int", "200", 0, 1500),
    ("hot_plate_temp", "Bett", "°C", "Temperaturen", "int", "45", 0, 300),
    ("hot_plate_temp_initial_layer", "Bett, erste Schicht", "°C", "Temperaturen", "int", "45", None, 300),
    ("filament_flow_ratio", "Flussrate", "", "Fluss", "float", "1", 0, 2),
    ("filament_max_volumetric_speed", "Max. Durchfluss", "mm³/s", "Fluss", "float", "2", 0, None),
    ("filament_density", "Dichte", "g/cm³", "Material", "float", "0", 0, None),
    ("filament_diameter", "Durchmesser", "mm", "Material", "float", "1.75", 0, None),
    ("filament_cost", "Preis", "je kg", "Material", "float", "0", 0, None),
    ("fan_min_speed", "Lüfter mindestens", "%", "Kühlung", "float", "20", 0, 100),
    ("fan_max_speed", "Lüfter höchstens", "%", "Kühlung", "float", "100", 0, 100),
]
EDITABLE_DEFAULTS = {f[0]: f[5] for f in EDITABLE_FIELDS}
VALUE_KEYS = [k for k, _, _ in CORE_VALUES] + [f[0] for f in EDITABLE_FIELDS
                                                 if f[0] not in {k for k, _, _ in CORE_VALUES}]
SLICER_DEFAULT = "Standardwert des Slicers"

# Printer pictures copied unchanged from the Orca resources into assets/ (<model>_cover.png).
# Orfix itself would read them from the installed slicer; everything else gets the outline.
COVERS = {
    "Snapmaker U1": "assets/printer-snapmaker-u1.png",
    "Generic Klipper Printer": "assets/printer-generic-klipper.png",
}
PLACEHOLDER_COVER = "assets/printer-placeholder.png"

HEX_COLOUR = re.compile(r"#[0-9A-Fa-f]{6}")

LABELS = {
    "status": {"visible": "Sichtbar", "hidden": "Ausgeblendet", "displaced": "Verdrängt",
               "orphaned": "Verwaist"},
    "origin_kind": {"vendor": "Herstellerpaket", "library": "Orca-Bibliothek",
                    "user": "Eigenes Profil"},
    # Folder tree on the page "Slicer".
    "category": {"managed": "Verwaltet Orfix", "system": "Vom Hersteller", "unmanaged": "Gehört dem Slicer",
                 "sensitive": "Vertraulich", "temp": "Flüchtig"},
    "kind": {"machine": "Drucker", "process": "Prozesse", "filament": "Filamente"},
    "source": {"auto": "Standardort", "flatpak": "Flatpak", "appimage_portable": "AppImage, portabel",
               "manual": "Von Hand hinzugefügt"},
}


@dataclass
class Profile:
    name: str
    kind: str          # filament, process, machine
    package: str       # vendor package ("Snapmaker", "Custom", LIBRARY) or "" for own profiles
    inherits: str
    instantiation: str
    renamed_from: list
    values: dict       # own settings only: key -> str or list of str
    example: bool = False

    @property
    def selectable(self):
        return self.instantiation != "false"

    @property
    def alias(self):
        return alias_of(self.name)

    @property
    def origin_kind(self):
        if not self.package:
            return "user"
        return "library" if self.package == LIBRARY else "vendor"

    @property
    def origin(self):
        return {"user": "Eigenes Profil", "library": "Orca-Bibliothek"}.get(self.origin_kind, self.package)


def alias_of(name):
    # Text before the first "@", right-trimmed (PresetBundle::load_vendor_configs_from_json).
    pos = name.find("@")
    alias = name[:pos].rstrip() if pos >= 0 else ""
    return alias or name


def split_list(text):
    # "a;b" or with quotes, as written by escape_strings_cstyle; good enough for names and variants.
    return [part.strip().strip('"') for part in text.split(";") if part.strip()]


def implicit_renamed_from(name, renamed_from):
    # Without an explicit renamed_from, the name with the first "@" removed counts as an old name
    # ("Generic PLA @System" -> "Generic PLA System"), see FINDINGS 4.4.
    if renamed_from or "@" not in name:
        return list(renamed_from)
    pos = name.find("@")
    return [name[:pos] + name[pos + 1:]]


def profile_from_json(data, kind, package):
    renamed = data.get("renamed_from", [])
    if isinstance(renamed, str):
        renamed = split_list(renamed)
    name = data.get("name", "")
    return Profile(
        name=name, kind=kind, package=package,
        inherits=data.get("inherits", ""), instantiation=data.get("instantiation", "true"),
        renamed_from=implicit_renamed_from(name, renamed),
        values={k: v for k, v in data.items() if k not in META_KEYS},
    )


@dataclass
class Instance:
    key: str
    slicer: str
    path: Path
    conf: dict
    storage: str
    profiles: dict = field(default_factory=dict)  # (package, kind, name) -> Profile
    colours: dict = field(default_factory=dict)   # (package, alias) -> [{"hex", "name"}]
    packages: list = field(default_factory=list)  # vendor packages in system/, filled by the loaders

    def add(self, profile):
        self.profiles[(profile.package, profile.kind, profile.name)] = profile

    def of_kind(self, kind):
        return [p for p in self.profiles.values() if p.kind == kind]


# ---------------------------------------------------------------- loading

def load_json_vendors(inst):
    """system/<Vendor>.json manifests. A library with an empty manifest is read from its folder."""
    system = inst.path / "system"
    for manifest_path in sorted(system.glob("*.json")):
        package = manifest_path.stem
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        folder = system / package
        lists = ("machine_model_list", "machine_list", "process_list", "filament_list")
        info = {"name": package, "format": "json", "file": f"system/{manifest_path.name}",
                "folder": f"system/{package}", "version": manifest.get("version", ""),
                "models": len(manifest.get("machine_model_list", [])), "manifest_empty": False,
                "counts": {"machine": 0, "process": 0, "filament": 0}}
        inst.packages.append(info)
        if not any(manifest.get(k) for k in lists):
            # SnOrca loads the library straight from disk since 2.3.5 (FINDINGS 4.7).
            info["manifest_empty"] = True
            for path in sorted(folder.rglob("*.json")):
                data = json.loads(path.read_text(encoding="utf-8"))
                kind = data.get("type", "filament")
                inst.add(profile_from_json(data, kind, package))
                info["counts"][kind] = info["counts"].get(kind, 0) + 1
            continue
        for list_key, kind in (("machine_list", "machine"), ("process_list", "process"),
                               ("filament_list", "filament")):
            info["counts"][kind] = len(manifest.get(list_key, []))
            for item in manifest.get(list_key, []):
                data = json.loads((folder / item["sub_path"]).read_text(encoding="utf-8"))
                inst.add(profile_from_json(data, kind, package))
        # Files the manifest does not list are no system profiles (FINDINGS 4.2).
        listed = {item["sub_path"] for k in lists for item in manifest.get(k, [])}
        info["extra_files"] = sorted(rel for rel in (f.relative_to(folder).as_posix() for f in folder.rglob("*")
                                                     if f.is_file()) if rel not in listed)


def load_colour_files(inst):
    """system/<Vendor>/filament/filaments_colours.json, only SnOrca ships it (FilamentColorLibrary.cpp).
    Keyed by alias, because one entry ("Snapmaker ABS @U1") stands for all nozzle profiles."""
    for path in sorted((inst.path / "system").glob("*/filament/filaments_colours.json")):
        package = path.parent.parent.name
        data = json.loads(path.read_text(encoding="utf-8"))
        for entry in data.get("filaments", []):
            items = [{"hex": c["filament_color"][0], "name": (c.get("color_name") or {}).get("en", "")}
                     for c in entry.get("filament_color", [])
                     if c.get("enabled", True) and c.get("filament_color")]
            if entry.get("enabled", True) and items:
                inst.colours.setdefault((package, alias_of(entry.get("filament_name", ""))), items)


def load_opc_vendors(inst):
    for path in sorted((inst.path / "system").glob("*.opc")):
        cache = opc_read.read_opc(str(path))
        package = cache.vendor_name
        # The stamp is the vendor version in the BBS 4-part form ("2.4.0.15").
        inst.packages.append({
            "name": package, "format": "opc", "file": f"system/{path.name}", "folder": None,
            "version": cache.vendor_version, "models": sum(len(v.models) for v in cache.vendors.values()),
            "manifest_empty": False,
            "counts": {kind: len(getattr(cache, kind)) for kind in ("machine", "process", "filament")},
        })
        for kind in ("machine", "process", "filament"):
            for entry in getattr(cache, kind):
                inst.add(Profile(
                    name=entry.name, kind=kind, package=package, inherits=entry.inherits,
                    instantiation=entry.instantiation or "true",
                    renamed_from=implicit_renamed_from(entry.name, entry.renamed_from),
                    values={k: opc_read.to_json_value(opt) for k, opt in entry.config.items()},
                ))


# ---------------------------------------------------------------- resolving

def find_parent(inst, profile):
    """System profiles resolve within their package, filaments fall back to the library.
    Own profiles resolve against selectable system profiles: exact name, then renamed_from
    (find_preset2 without the Generic fallback)."""
    name = profile.inherits
    if profile.package:
        for package in (profile.package, LIBRARY):
            found = inst.profiles.get((package, profile.kind, name))
            if found:
                return found
        return None
    candidates = [p for p in inst.of_kind(profile.kind) if p.package and p.selectable]
    for p in candidates:
        if p.name == name:
            return p
    for p in candidates:
        if name in p.renamed_from:
            return p
    return None


def chain_of(inst, profile):
    """Parents from the direct one to the root; complete is False if a parent is missing."""
    chain, seen, current = [], {profile.name}, profile
    while current.inherits:
        parent = find_parent(inst, current)
        if parent is None or parent.name in seen:
            return chain, False
        chain.append(parent)
        seen.add(parent.name)
        current = parent
    return chain, True


def lookup(profile, chain, key):
    """(value, source profile) for key, the first profile in self + chain that sets it."""
    for p in [profile] + chain:
        if key in p.values:
            return p.values[key], p
    return None, None


def as_list(value):
    if value is None:
        return []
    return value if isinstance(value, list) else [value]


def first(value):
    values = as_list(value)
    return values[0] if values else None


# ---------------------------------------------------------------- building

def installed_printers(inst):
    """Selectable system printers whose model and variant are enabled in "models"."""
    by_model = []
    for entry in inst.conf.get("models", []):
        package, model = entry.get("vendor", ""), entry.get("model", "")
        variants = split_list(entry.get("nozzle_diameter", ""))
        printers = []
        for p in inst.of_kind("machine"):
            if p.package != package or not p.selectable:
                continue
            chain, _ = chain_of(inst, p)
            p_model = first(lookup(p, chain, "printer_model")[0])
            p_variant = first(lookup(p, chain, "printer_variant")[0])
            if p_model == model and p_variant in variants:
                printers.append((variants.index(p_variant), p_variant, p))
        printers.sort(key=lambda t: t[0])
        by_model.append({"model": model, "package": package,
                         "printers": [(variant, p) for _, variant, p in printers]})
    return by_model


def compatible_printers(inst, profile):
    chain, _ = chain_of(inst, profile)
    return as_list(lookup(profile, chain, "compatible_printers")[0])


def library_exclusions(inst, snorca):
    """library profile name -> {printer name: [names of the profiles that displace it]}.

    update_library_profile_excluded_from(): library filaments with an empty printer list are
    keyed by alias (a later name overwrites an earlier one, like the slicer's std::map);
    every other filament with the same alias and an explicit printer list excludes those
    printers. SnOrca only counts other packages, Orca main also the library itself."""
    filaments = sorted((p for p in inst.of_kind("filament") if p.package and p.selectable),
                       key=lambda p: p.name)
    by_alias = {}
    for p in filaments:
        if p.package == LIBRARY and not compatible_printers(inst, p):
            by_alias[p.alias] = p.name
    excluded = {}
    for p in filaments:
        if snorca and p.package == LIBRARY:
            continue
        printers = compatible_printers(inst, p)
        target = by_alias.get(p.alias)
        if not printers or not target or target == p.name:
            continue
        for printer in printers:
            excluded.setdefault(target, {}).setdefault(printer, []).append(p.name)
    return excluded


def example_profiles(u1_printers):
    """Synthetic own profiles; nobody on this machine has saved one yet."""
    return [
        Profile("Mein PLA", "filament", "", "Snapmaker PLA Basic @U1", "true", [],
                {"nozzle_temperature": ["215"]}, example=True),
        Profile("SUNLU PLA+ für U1", "filament", "", "SUNLU PLA+ @System", "true", [],
                {"compatible_printers": list(u1_printers)}, example=True),
        Profile("Altes PETG", "filament", "", "Snapmaker PETG @U1 alt", "true", [],
                {"nozzle_temperature": ["245"], "hot_plate_temp": ["75"],
                 "compatible_printers": ["Snapmaker U1 (0.4 nozzle)"]}, example=True),
    ]


def is_helper(inst, p):
    """Own profile without own settings on top of a library profile: the helper that unlocks
    the library in SnOrca (FINDINGS 4.7, way B). The UI shows it as the switched-on library row."""
    if p.origin_kind != "user" or set(p.values) - BINDING_KEYS:
        return False
    parent = find_parent(inst, p)
    return parent is not None and parent.origin_kind == "library"


def lively(hexes):
    """First colour that is neither near white, black nor grey, so the spools differ at a glance."""
    for h in hexes:
        r, g, b = (int(h[i:i + 2], 16) / 255 for i in (1, 3, 5))
        _, lightness, saturation = colorsys.rgb_to_hls(r, g, b)
        if saturation > 0.35 and 0.2 < lightness < 0.85:
            return h
    return hexes[0] if hexes else None


def colours_of(inst, p, chain):
    """(colour for the spool, list of known colours). default_filament_colour wins, then the
    vendor colour file of the first profile in the chain that has an entry there."""
    known = []
    for q in [p] + chain:
        known = inst.colours.get((q.package, q.alias), [])
        if known:
            break
    value = first(lookup(p, chain, "default_filament_colour")[0]) or ""
    match = HEX_COLOUR.match(value.strip())
    if match:
        return match.group(0).upper(), known
    return lively([c["hex"] for c in known]), known


def value_entry(p, chain, complete, key):
    """Effective value of key, whether the profile sets it itself, and where it comes from.

    A value an own profile sets itself also carries "inherited", the value its template
    gives: the editor on the page "Filamente" shows it as placeholder and goes back to it
    with "Zurücksetzen"."""
    value, source = lookup(p, chain, key)
    if source is None:
        if not complete or key not in EDITABLE_DEFAULTS:
            # A broken chain is not loaded by the slicer at all, so there is no effective value.
            return {"value": None, "own": False, "source": None}
        # No profile sets it: the slicer takes the PrintConfigDef default (FINDINGS 4.5).
        return {"value": EDITABLE_DEFAULTS[key], "own": False, "source": SLICER_DEFAULT, "default": True}
    items = as_list(value)
    entry = {"value": items[0] if items else None, "own": source is p, "source": source.name}
    if len(items) > 1:
        # SnOrca keeps a second value for the high-flow hotend (FINDINGS 4.4).
        entry["high_flow"] = items[1]
    if source is p and p.origin_kind == "user" and complete:
        if chain:
            inherited = value_entry(chain[0], chain[1:], True, key)
            inherited.pop("own")
        else:
            # A root profile (user/<folder>/filament/base/) has no template, only the slicer default.
            inherited = {"value": EDITABLE_DEFAULTS.get(key), "source": SLICER_DEFAULT, "default": True}
        entry["inherited"] = inherited
    return entry


def filament_record(inst, p, in_list):
    chain, complete = chain_of(inst, p)
    colour, colours = colours_of(inst, p, chain)
    values = {key: value_entry(p, chain, complete, key) for key in VALUE_KEYS}
    record = {
        "name": p.name, "alias": p.alias, "origin": p.origin, "origin_kind": p.origin_kind,
        "material": first(lookup(p, chain, "filament_type")[0]),
        "vendor": first(lookup(p, chain, "filament_vendor")[0]),
        "chain": [c.name for c in chain], "chain_complete": complete,
        "compatible_printers": compatible_printers(inst, p) if complete else as_list(p.values.get("compatible_printers")),
        "in_list": in_list, "values": values, "printers": {},
        "colour": colour,
    }
    if colours:
        record["colours"] = colours
    if p.example:
        record["example"] = True
    if not complete:
        record["status"] = "orphaned"
        record["problem"] = f"Baut auf „{p.inherits}“ auf, das es nicht gibt. Der Slicer lädt dieses Profil nicht."
    return record


def lock_holder(path):
    """(PID, lock file) of the lock the slicer holds in cache/, or None. F_GETLK only asks,
    it never takes the lock (FINDINGS 4.1, orfix/guard.py). Linux layout of struct flock."""
    if not sys.platform.startswith("linux"):
        return None
    import fcntl
    import struct
    layout = "hhqqi"
    request = struct.pack(layout, fcntl.F_WRLCK, os.SEEK_SET, 0, 1, 0)
    for lock in sorted((path / "cache").glob("*.lock")):
        try:
            fd = os.open(lock, os.O_RDONLY)
        except OSError:
            continue
        try:
            reply = fcntl.fcntl(fd, fcntl.F_GETLK, request)
        except OSError:
            continue
        finally:
            os.close(fd)
        lock_type, _, _, _, pid = struct.unpack(layout, reply)
        if lock_type != fcntl.F_UNLCK:
            return pid, f"cache/{lock.name}"
    return None


def process_data_dir(proc):
    """Data directory of a slicer process: --datadir, else its working directory, because the
    slicer changes into <data_dir>/log at start (FINDINGS 4.1). None if unknown."""
    try:
        args = (proc / "cmdline").read_bytes().split(b"\0")
        cwd = Path(os.readlink(proc / "cwd"))
    except OSError:
        return None
    for index, arg in enumerate(args):
        text = arg.decode("utf-8", "replace")
        if text == "--datadir" and index + 1 < len(args):
            return cwd / args[index + 1].decode("utf-8", "replace")
        if text.startswith("--datadir="):
            return cwd / text.split("=", 1)[1]
    return cwd.parent if cwd.name == "log" else None


def run_state(path, process_names, appimage_markers):
    """Whether the slicer runs on this data directory, and why Orfix thinks so, like
    orfix/guard.py: the lock, a process with this data directory, or a process (or AppImage
    runtime) whose data directory is unknown. Read-only look at /proc."""
    held = lock_holder(path)
    if held:
        return {"running": True, "reason": "lock", "pids": [held[0]], "lock": held[1]}
    mine, unknown, runtimes, any_slicer = [], [], [], False
    for proc in Path("/proc").glob("[0-9]*"):
        try:
            comm = (proc / "comm").read_text().strip()  # cut to 15 characters
        except OSError:
            continue
        if comm in process_names:
            any_slicer = True
            data_dir = process_data_dir(proc)
            if data_dir is None:
                unknown.append(int(proc.name))
            elif data_dir.resolve() == path.resolve():
                mine.append(int(proc.name))
            continue
        try:
            exe = os.readlink(proc / "exe").lower()
        except OSError:
            continue
        if exe.endswith(".appimage") and any(m in Path(exe).name for m in appimage_markers):
            runtimes.append(int(proc.name))
    if mine:
        return {"running": True, "reason": "process", "pids": sorted(mine), "lock": None}
    # A runtime without its slicer process: the slicer starts or has just quit.
    if unknown or (runtimes and not any_slicer):
        return {"running": True, "reason": "process_unmapped", "pids": sorted(unknown or runtimes), "lock": None}
    return {"running": False, "reason": None, "pids": [], "lock": None}


def problems_of(path):
    """Problem codes as orfix/instances.py reports them. A .conf that does not parse stops
    this script earlier, so only dir_unreadable can show up here."""
    errors = []
    for _ in os.walk(path, onerror=errors.append):
        pass
    return ["dir_unreadable"] if errors else []


def ota_enabled(inst):
    return (inst.conf.get("app") or {}).get("enable_ota") in (True, "true", "1")


def drops_unused_package(inst, package):
    """Whether the slicer deletes this vendor package at its next start once no model of it is
    left in "models" (FINDINGS 4.2, PresetUpdater::check_installed_vendor_profiles). Each slicer
    keeps its own package: Snapmaker in SnOrca, Custom in Orca. Orca main (.opc) only touches
    installed vendors with app.enable_ota."""
    if package == LIBRARY:
        return False
    if inst.key == "snorca":
        return package != "Snapmaker"
    if inst.storage == "opc" and not ota_enabled(inst):
        return False
    return package != "Custom"


def display_version(version):
    # "02.03.03.03" -> "2.3.3.3"; the .opc stamp "2.4.0.15" stays as it is.
    return ".".join(str(int(part)) if part.isdigit() else part for part in version.split("."))


# ---------------------------------------------------------------- page "Slicer"

# Top-level entries of a data directory: category and a short note (FINDINGS 4.2).
TOP_LEVEL = {
    # The note gets the sentence from system_refresh in slicer_page(): not every slicer renews them.
    "system": ("system", "Profile der Hersteller. Orfix liest sie nur."),
    "user": ("managed", "Deine eigenen Profile. Nur hier und in der .conf schreibt Orfix."),
    "log": ("temp", "Protokolle des Slicers."),
    "cache": ("temp", "Zwischenspeicher und die Sperrdatei, solange der Slicer läuft."),
    "web": ("unmanaged", "Oberfläche des Geräte-Panels, wird vom Slicer verwaltet."),
    "hms": ("unmanaged", "Texte für Gerätemeldungen, wird vom Slicer verwaltet."),
    "ota": ("unmanaged", "Updates, die der Slicer selbst herunterlädt."),
    "log_upload_spool": ("temp", "Warteschlange für Nutzungsdaten, die der Slicer sendet."),
    "printers": ("unmanaged", "Gerätebeschreibungen für die Druckerverbindung, keine Profile."),
    "plugins": ("unmanaged", "Erweiterungen, wird vom Slicer verwaltet."),
    "orca_plugins": ("unmanaged", "Erweiterungen, wird vom Slicer verwaltet."),
    "python": ("unmanaged", "Python für Erweiterungen, wird vom Slicer verwaltet."),
    "simplyprint_oauth.json": ("sensitive", "Anmeldung bei SimplyPrint. Vertraulich."),
    "3dprinteros_api_cred.json": ("sensitive", "Anmeldung bei 3DPrinterOS. Vertraulich."),
    "orca_refresh_token.sec": ("sensitive", "Anmeldung beim Konto. Vertraulich."),
}
OTHER = ("unmanaged", "Gehört dem Slicer. Orfix fasst das nicht an.")
PACKAGE_FOLDERS = {"machine": "Drucker und Druckermodelle.", "process": "Prozesse: Schichthöhe, Tempo, Stützen.",
                   "filament": "Filamente."}
INFO_NOTE = " Zu jedem Profil gehört eine .info mit Konto und Zeitstempel."
USER_KIND_FOLDERS = {"machine": "Eigene Drucker." + INFO_NOTE, "process": "Eigene Prozesse." + INFO_NOTE,
                     "filament": "Eigene Filamente." + INFO_NOTE, "base": "Eigene Profile ohne Vorlage."}
# Order of the top level on the page "Slicer", as in its size bar: what Orfix writes to first.
CATEGORY_ORDER = ["managed", "system", "unmanaged", "temp", "sensitive"]
# Hard rule 4: everything goes into the backup except these.
BACKUP_SKIP_TOP = {"log", "cache", "web", "hms", "ota"}
BACKUP_EXCLUDED = ["log/", "cache/", "web/", "hms/", "ota/", "user/Temp/", "user/*/temp/", "user_backup-v*/"]
# Sections of the .conf that hold credentials (FINDINGS 4.3). Only counted, never shown.
CREDENTIAL_SECTIONS = ("devices", "local_machines", "access_code")
# Folders of the built-in web view (WebKitGTK) outside the data directory, named after the program.
OUTSIDE = {
    "snorca": [
        (".local/share/snapmaker-orca", "sensitive",
         "Speicher der eingebauten Web-Oberfläche, u. a. für die Snapmaker-Anmeldung. "
         "Alle Snapmaker-Orca-Datenordner teilen ihn."),
        (".cache/snapmaker-orca", "temp", "Zwischenspeicher der eingebauten Web-Oberfläche."),
    ],
    "orca": [
        (".local/share/orca-slicer", "unmanaged", "Speicher der eingebauten Web-Oberfläche."),
        (".cache/orca-slicer", "temp", "Zwischenspeicher der eingebauten Web-Oberfläche."),
    ],
}


def home_path(path):
    try:
        return "~/" + path.relative_to(Path.home()).as_posix()
    except ValueError:
        return str(path)


def measure(path):
    """(bytes, files) of a file or a whole folder. Symlinks are not followed."""
    if path.is_symlink() or not path.is_dir():
        try:
            return path.lstat().st_size, 1
        except OSError:
            return 0, 0
    size = files = 0
    for root, _, names in os.walk(path):
        for name in names:
            try:
                size += (Path(root) / name).lstat().st_size
                files += 1
            except OSError:
                continue
    return size, files


def in_backup(rel):
    parts = PurePosixPath(rel).parts
    if not parts:
        return True
    if parts[0] in BACKUP_SKIP_TOP or parts[0].startswith("user_backup-v"):
        return False
    if parts[0] == "user" and len(parts) >= 2 and parts[1] == "Temp":
        return False
    return not (parts[0] == "user" and len(parts) >= 3 and parts[2] == "temp")


def backup_measure(path):
    """(bytes, ZIP bytes, files) of what a backup would hold today. Zipped in memory only."""
    raw = files = 0
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as zf:
        for root, dirs, names in os.walk(path):
            rel_root = PurePosixPath(Path(root).relative_to(path).as_posix())
            dirs[:] = [d for d in dirs if in_backup(rel_root / d)]
            for name in names:
                file, rel = Path(root) / name, rel_root / name
                if file.is_symlink() or not in_backup(rel):
                    continue
                try:
                    zf.write(file, rel.as_posix())
                except OSError:
                    continue
                raw += file.stat().st_size
                files += 1
    return raw, len(buffer.getvalue()), files


def node(path, rel, category, note, children=None, **extra):
    size, files = measure(path)
    out = {"name": path.name, "path": rel.as_posix(), "type": "dir" if path.is_dir() else "file",
           "size": size, "files": files, "category": category, "note": note, "backup": in_backup(rel)}
    out.update(extra)
    if children is not None:
        out["children"] = children
    return out


def top_level_info(name, app_key):
    if name == f"{app_key}.conf":
        return ("managed", "Einstellungen des Slicers: eingerichtete Drucker, sichtbare Filamente, "
                           "zuletzt gewählte Profile. Orfix ändert hier nur einzelne Einträge.")
    if name == f"{app_key}.conf.bak":
        return "managed", "Vorige Fassung der .conf, legt der Slicer nur unter Windows an."
    if name.startswith(f"{app_key}.conf."):
        return "temp", "Zwischendatei beim Speichern. Liegt sie da, schreibt der Slicer gerade."
    if name.startswith("user_backup-v"):
        return ("unmanaged", f"Kopie von user/ beim ersten Start von Version {name[len('user_backup-v'):]}. "
                             "Der Slicer aktualisiert sie nie.")
    if name.startswith(".") and name.endswith("_machine_id"):
        return ("sensitive", "Zufällige Kennung dieses Rechners für Update-Prüfung und Nutzungsdaten. "
                             "Orfix zeigt sie nie an.")
    return TOP_LEVEL.get(name, OTHER)


def extra_file_note(path):
    """Files in a vendor folder that the manifest does not list (FINDINGS 4.2)."""
    if path.name == "filaments_colours.json":
        return "Farbtabelle der Filamente."
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        data = None
    if isinstance(data, dict) and "name" in data and path.parent.name in PACKAGE_FOLDERS:
        return "Profil, das nicht im Inhaltsverzeichnis steht. Der Slicer lädt es nicht."
    return "Zusatzdatei des Herstellers, kein Profil."


def system_tree(inst):
    system = inst.path / "system"
    by_file = {pk["file"]: pk for pk in inst.packages}
    by_folder = {pk["folder"]: pk for pk in inst.packages if pk["folder"]}
    out = []
    for child in sorted(system.iterdir(), key=lambda c: c.name.lower()):
        rel = PurePosixPath("system", child.name)
        pk = by_file.get(rel.as_posix()) or by_folder.get(rel.as_posix())
        if pk and child.is_file() and pk["format"] == "opc":
            out.append(node(child, rel, "system", f"Alle Profile von „{pk['name']}“ in einer Datei, Version "
                                                  f"{display_version(pk['version'])}. Format ab OrcaSlicer 2.5."))
        elif pk and child.is_file():
            out.append(node(child, rel, "system", f"Inhaltsverzeichnis von „{pk['name']}“, Version "
                                                  f"{display_version(pk['version'])}."))
        elif pk:
            note = f"Profile von „{pk['name']}“."
            if pk["manifest_empty"]:
                note += " Das Inhaltsverzeichnis ist leer, Snapmaker Orca liest die Dateien direkt aus diesem Ordner."
            subs = [node(sub, rel / sub.name, "system", PACKAGE_FOLDERS.get(sub.name, OTHER[1]))
                    for sub in sorted(child.iterdir()) if sub.is_dir()]
            extra = [{"path": f"{rel.as_posix()}/{name}", "note": extra_file_note(child / name)}
                     for name in pk.get("extra_files", [])]
            out.append(node(child, rel, "system", note, subs, **({"extra_files": extra} if extra else {})))
        elif child.suffix in (".new", ".old"):
            out.append(node(child, rel, "temp", "Rest eines abgebrochenen Updates."))
        else:
            out.append(node(child, rel, *OTHER))
    return out


def example_file(inst, p, rel_dir, indent):
    """One row for the .json and .info an example profile would have, sized like the slicer
    writes them."""
    body = {"from": "User", "inherits": p.inherits, "name": p.name, "version": "2.4.0.0", **p.values}
    text = json.dumps(body, indent=indent, ensure_ascii=False, sort_keys=True) + "\n"
    info = "sync_info = \nuser_id = \nsetting_id = \nbase_id = \nupdated_time = 1758520000\n"
    what = {"machine": "Eigener Drucker", "process": "Eigener Prozess", "filament": "Eigenes Filament"}[p.kind]
    if not p.inherits:
        note = f"{what} ohne Vorlage."
    elif chain_of(inst, p)[1]:
        note = f"{what}, baut auf „{p.inherits}“ auf."
    else:
        note = f"{what}. Die Vorlage „{p.inherits}“ fehlt, der Slicer lädt es nicht."
    return {"name": p.name, "path": f"{rel_dir}/{p.name}.json", "type": "profile",
            "size": len(text.encode("utf-8")) + len(info), "files": 2, "note": note,
            "category": "managed", "backup": True, "example": True}


def example_size(inst, p, indent):
    return example_file(inst, p, "", indent)["size"]


def profile_nodes(folder, rel):
    """One row per profile, <Name>.json and <Name>.info together (FINDINGS 4.2); other files alone."""
    files = sorted((f for f in folder.iterdir() if f.is_file()), key=lambda f: f.name.lower())
    pairs = {f.stem for f in files if f.suffix == ".json"} & {f.stem for f in files if f.suffix == ".info"}
    out = []
    for f in files:
        if f.stem not in pairs:
            out.append(node(f, rel / f.name, "managed", "Eigenes Profil." if f.suffix == ".json"
                            else "Verwaltungsdaten zum Profil."))
        elif f.suffix == ".json":
            size = measure(f)[0] + measure(f.with_suffix(".info"))[0]
            out.append({"name": f.stem, "path": (rel / f.name).as_posix(), "type": "profile", "size": size,
                        "files": 2, "category": "managed", "note": "Eigenes Profil.", "backup": in_backup(rel / f.name)})
    return out


def add_example(target, item):
    """Count an example row into a folder, and separately, so the page can take it out again."""
    target["size"] += item["size"]
    target["files"] += item["files"]
    target["example_size"] = target.get("example_size", 0) + item["size"]
    target["example_files"] = target.get("example_files", 0) + item["files"]


def user_tree(inst, active, indent):
    """Children of user/ plus the example profiles in the active folder.
    Returns (children, bytes and files the examples add)."""
    user = inst.path / "user"
    examples = [p for p in inst.profiles.values() if p.example]
    out, added_size, added_files = [], 0, 0
    for child in sorted(user.iterdir(), key=lambda c: c.name.lower()) if user.is_dir() else []:
        rel = PurePosixPath("user", child.name)
        if child.is_file():
            info = ("unmanaged", "Zustand der Tipps beim Start, kein Profil.") if child.name == "hints.cereal" else OTHER
            out.append(node(child, rel, *info))
            continue
        if child.name == "Temp":
            out.append(node(child, rel, "temp", "Flüchtige Kopien, solange der Export-Dialog offen ist."))
            continue
        kinds, added = [], []
        for sub in sorted(child.iterdir(), key=lambda c: c.name.lower()):
            srel = rel / sub.name
            if sub.name == "temp":
                kinds.append(node(sub, srel, "temp", "Rest eines abgebrochenen Imports."))
                continue
            if sub.name not in USER_KIND_FOLDERS:
                kinds.append(node(sub, srel, *OTHER))
                continue
            files = profile_nodes(sub, srel)
            base = sub / "base"
            if base.is_dir():
                files.insert(0, node(base, srel / "base", "managed", USER_KIND_FOLDERS["base"]))
            kind_node = node(sub, srel, "managed", USER_KIND_FOLDERS[sub.name], files)
            if child.name == active:
                for p in sorted((p for p in examples if p.kind == sub.name), key=lambda p: p.name.lower()):
                    item = example_file(inst, p, srel.as_posix(), indent)
                    files.append(item)
                    add_example(kind_node, item)
                    added.append(item)
            kinds.append(kind_node)
        note = "Eigene Profile ohne Anmeldung." if child.name == "default" else "Eigene Profile des angemeldeten Kontos."
        account = node(child, rel, "managed", note, kinds, active=child.name == active)
        for item in added:
            add_example(account, item)
            added_size += item["size"]
            added_files += item["files"]
        out.append(account)
    return out, added_size, added_files


def credential_counts(conf):
    """How many entries of each credential section are filled. Values never leave this function."""
    counts = {}
    for key in CREDENTIAL_SECTIONS:
        section = conf.get(key)
        items = section.values() if isinstance(section, dict) else section if isinstance(section, list) else []
        filled = sum(1 for item in items if item)
        if filled:
            counts[key] = filled
    return counts


def own_file_count(inst, kind):
    user = inst.path / "user"
    folders = [d for d in user.iterdir() if d.is_dir() and d.name != "Temp"] if user.is_dir() else []
    return sum(len(list((d / kind).glob("*.json"))) + len(list((d / kind / "base").glob("*.json"))) for d in folders)


def slicer_page(inst, app_key, conf_text, indent, backup, running_now):
    conf = inst.conf
    snorca = inst.key == "snorca"
    app = conf.get("app") or {}
    preset_folder = app.get("preset_folder", "")
    active = preset_folder or "default"
    credentials = credential_counts(conf)

    if snorca:
        refresh = {"value": True, "text": "Snapmaker Orca erneuert die Herstellerpakete bei jedem Start."}
    elif inst.storage == "opc":
        # Orca main refreshes installed vendors only with app.enable_ota (FINDINGS 4.2).
        on = ota_enabled(inst)
        refresh = {"value": on, "text": "OrcaSlicer erneuert die Herstellerpakete beim Start." if on else
                   "OrcaSlicer erneuert installierte Herstellerpakete nicht, er ergänzt nur fehlende. "
                   "Die Bibliothek kopiert er bei jedem Start neu."}
    else:
        refresh = {"value": True, "text": "OrcaSlicer erneuert die Herstellerpakete bei jedem Start."}

    set_up = {}
    for entry in conf.get("models") or []:
        set_up.setdefault(entry.get("vendor", ""), []).append(entry.get("model", ""))
    packages = []
    for pk in inst.packages:
        size = files = 0
        for rel in (pk["file"], pk["folder"]):
            if rel:
                s, f = measure(inst.path / rel)
                size, files = size + s, files + f
        library = pk["name"] == LIBRARY
        if library:
            note = "Filamente für alle Drucker. Der Slicer kopiert sie bei jedem Start neu."
            if pk["manifest_empty"]:
                note += " Das Inhaltsverzeichnis ist leer, Snapmaker Orca liest die Dateien direkt aus dem Ordner."
        elif set_up.get(pk["name"]):
            note = f"Installiert für {', '.join(set_up[pk['name']])}."
        else:
            note = "Kein Drucker davon ist eingerichtet."
        entry = {"name": pk["name"], "role": "library" if library else "vendor", "format": pk["format"],
                 "file": pk["file"], "folder": pk["folder"], "version": pk["version"],
                 "version_display": display_version(pk["version"]), "size": size, "files": files,
                 "models": pk["models"], "printers_set_up": set_up.get(pk["name"], []),
                 "counts": pk["counts"], "note": note}
        if pk.get("extra_files"):
            entry["extra_files"] = [f"{pk['folder']}/{name}" for name in pk["extra_files"]]
        packages.append(entry)

    counts = {}
    for kind in ("machine", "process", "filament"):
        system = [p for p in inst.of_kind(kind) if p.package]
        counts[kind] = {"system": len(system), "system_selectable": sum(1 for p in system if p.selectable),
                        "own": own_file_count(inst, kind),
                        "own_examples": sum(1 for p in inst.of_kind(kind) if p.example)}

    tree = []
    for child in inst.path.iterdir():
        rel = PurePosixPath(child.name)
        category, note = top_level_info(child.name, app_key)
        if child.name == "system" and child.is_dir():
            note = f"Profile der Hersteller. {refresh['text']} Orfix liest sie nur."
            tree.append(node(child, rel, category, note, system_tree(inst)))
        elif child.name == "user" and child.is_dir():
            children, size, files = user_tree(inst, active, indent)
            entry = node(child, rel, category, note, children)
            if files:
                add_example(entry, {"size": size, "files": files})
            tree.append(entry)
        elif child.name == f"{app_key}.conf" and credentials:
            tree.append(node(child, rel, category, note + " Enthält Zugangsdaten zu Druckern.", secret=True))
        else:
            tree.append(node(child, rel, category, note))
    tree.sort(key=lambda e: (CATEGORY_ORDER.index(e["category"]), e["type"] != "dir", e["name"].lower()))

    outside = []
    for rel, category, note in OUTSIDE.get(inst.key, []):
        path = Path.home() / rel
        if path.is_dir():
            size, files = measure(path)
            outside.append({"path": "~/" + rel, "size": size, "files": files, "category": category,
                            "note": note, "backup": False})

    header = conf.get("header", "")
    raw, zipped, backup_files = backup
    return {
        "slicer": inst.slicer, "header": header, "version": header.rsplit(" ", 1)[-1],
        "path": home_path(inst.path), "source": "auto", "running": running_now,
        "logged_in": preset_folder != "", "preset_folder": preset_folder,
        "user_folder": f"user/{active}",
        "conf": {"file": f"{app_key}.conf", "size": len(conf_text.encode("utf-8")),
                 "indent": "tab" if indent == "\t" else "spaces",
                 "indent_text": "Tab" if indent == "\t" else f"{len(indent)} Leerzeichen",
                 "checksum": bool(re.search(r"\n# MD5 checksum [0-9A-Fa-f]{32}\n?\Z", conf_text)),
                 "sections": len(conf), "credentials": credentials},
        "system_format": inst.storage,
        "system_format_text": ".opc (binär, OrcaSlicer 2.5)" if inst.storage == "opc" else "JSON",
        "system_refresh": refresh,
        "packages": packages,
        "profile_counts": counts,
        "tree": tree,
        "outside": outside,
        "totals": {"size": sum(e["size"] for e in tree), "files": sum(e["files"] for e in tree),
                   "example_size": sum(e.get("example_size", 0) for e in tree),
                   "example_files": sum(e.get("example_files", 0) for e in tree),
                   "backup_size": raw, "backup_zip_size": zipped, "backup_files": backup_files},
    }


# ---------------------------------------------------------------- page "Drucker"

U1_04 = "Snapmaker U1 (0.4 nozzle)"
PROJECT_NAME = re.compile(r"\(.*\.3mf\)$", re.IGNORECASE)
# How the example printers came in, shown instead of "Eigener Drucker".
EXAMPLE_ORIGINS = {"Mein U1": "Selbst angelegt",
                   "Bambu Lab X1 Carbon 0.4 nozzle - Kopie": "Aus einem Projekt übernommen"}


def pick_process(inst, printer, prefix):
    """A selectable system process for printer, preferably "<prefix>… Standard …"."""
    names = sorted(p.name for p in inst.of_kind("process")
                   if p.package and p.selectable and printer in compatible_printers(inst, p))
    for test in (lambda n: n.startswith(prefix) and "Standard" in n, lambda n: n.startswith(prefix), lambda n: True):
        found = [n for n in names if test(n)]
        if found:
            return found[0]
    return ""


def printer_examples(inst):
    """Own printers and profiles that belong to one printer only; nobody has saved any yet.
    The Bambu copy inherits a printer whose vendor is not installed, so the slicer skips it
    (FINDINGS 4.9: "… - Kopie.json", invisible orphan)."""
    fine, coarse = pick_process(inst, U1_04, "0.20"), pick_process(inst, U1_04, "0.28")
    return [
        Profile("Mein U1", "machine", "", U1_04, "true", [], {"printer_settings_id": "Mein U1"}, example=True),
        Profile("Bambu Lab X1 Carbon 0.4 nozzle - Kopie", "machine", "", "Bambu Lab X1 Carbon 0.4 nozzle", "true", [],
                {"printer_settings_id": "Bambu Lab X1 Carbon 0.4 nozzle - Kopie"}, example=True),
        Profile("PLA für Mein U1", "filament", "", "Snapmaker PLA Basic @U1", "true", [],
                {"compatible_printers": ["Mein U1"], "nozzle_temperature": ["210"]}, example=True),
        Profile(f"{alias_of(fine)} @Mein U1", "process", "", fine, "true", [],
                {"compatible_printers": ["Mein U1"]}, example=True),
        Profile("Schnell und grob", "process", "", coarse, "true", [],
                {"compatible_printers": [U1_04], "sparse_infill_density": "10%"}, example=True),
    ]


def only_on(inst, printer_names):
    """Own filaments and processes usable on these printers only: offered for deleting along."""
    out = []
    for q in inst.profiles.values():
        if q.package or q.kind == "machine":
            continue
        _, complete = chain_of(inst, q)
        cps = compatible_printers(inst, q) if complete else as_list(q.values.get("compatible_printers"))
        if not cps or not set(cps) <= printer_names:
            continue
        item = {"name": q.name, "kind": q.kind}
        if q.example:
            item["example"] = True
        if not complete:
            item["orphaned"] = True
        if inst.key == "snorca" and q.kind == "filament" and is_helper(inst, q):
            item["helper"] = True
        out.append(item)
    return sorted(out, key=lambda i: (i["kind"], i["name"].lower()))


def printers_page(inst, out_models, all_printers, selected):
    own_printers = sorted((p for p in inst.of_kind("machine") if not p.package), key=lambda p: p.name.lower())
    loadable = {p.name for p in own_printers if chain_of(inst, p)[1]}
    known = {p.name for p in all_printers} | loadable
    folder = (inst.conf.get("app") or {}).get("preset_folder") or "default"

    def parent_name(p):
        parent = find_parent(inst, p)
        return parent.name if parent else None

    system = []
    for m in out_models:
        names = {v["name"] for v in m["printers"]}
        based = [p.name for p in own_printers if parent_name(p) in names]
        system.append({
            "model": m["model"], "origin": m["origin"], "cover": m["cover"],
            "printers": [{"name": v["name"], "variant": v["variant"], "default": v["selected"],
                          "visible_filaments": v["counts"]["visible"], "processes": v["process_count"]}
                         for v in m["printers"]],
            "own_printers": based, "only_here": only_on(inst, names),
            # Whether it is the last model of its package is up to the page: it can change there.
            "drops_package": drops_unused_package(inst, m["origin"]),
        })

    own = []
    for p in own_printers:
        chain, complete = chain_of(inst, p)
        model = first(lookup(p, chain, "printer_model")[0]) if complete else None
        base = next((c for c in chain if c.package), None) if complete else None
        entry = {
            "name": p.name, "based_on": p.inherits or None, "based_on_found": complete and bool(p.inherits),
            "package": base.package if base else None,
            "model": model, "variant": first(lookup(p, chain, "printer_variant")[0]) if complete else None,
            "cover": COVERS.get(model, PLACEHOLDER_COVER), "visible": complete, "default": p.name == selected,
            "origin": EXAMPLE_ORIGINS.get(p.name, "Eigener Drucker"),
            "file": f"user/{folder}/machine/{'' if p.inherits else 'base/'}{p.name}.json",
            "only_here": only_on(inst, {p.name}),
        }
        if p.example:
            entry["example"] = True
        if not complete:
            entry["status"] = "orphaned"
            entry["problem"] = (f"Der Slicer findet die Vorlage „{p.inherits}“ nicht, meist weil ihr Hersteller "
                                "nicht installiert ist. Er lädt diesen Drucker deshalb nicht.")
        own.append(entry)

    # orca_presets keeps the last choice per printer and is never cleaned up (FINDINGS 4.3, 4.9).
    presets = [e for e in inst.conf.get("orca_presets") or [] if isinstance(e, dict)]
    dead = []
    for e in presets:
        machine = e.get("machine", "")
        if machine in known:
            continue
        if machine == "Default Printer":
            reason, text = "default_printer", "Platzhalter vom ersten Start, bevor ein Drucker eingerichtet war."
        elif PROJECT_NAME.search(machine):
            reason, text = "project", "Drucker aus einem Projekt, das einmal geöffnet war."
        else:
            reason, text = "missing", "Diesen Drucker gibt es hier nicht mehr."
        dead.append({"machine": machine, "process": e.get("process", ""),
                     "filaments": [e[k] for k in sorted(e) if k == "filament" or re.fullmatch(r"filament_\d\d", k)],
                     "reason": reason, "text": text,
                     "action": "Kann weg. Der Slicer räumt solche Einträge nicht selbst auf."})

    default = {"name": selected, "exists": selected in known, "own": selected in loadable}
    for m in out_models:
        for v in m["printers"]:
            if v["name"] == selected:
                default.update(model=m["model"], variant=v["variant"], cover=m["cover"])
    return {"default_printer": default, "system": system, "own": own,
            "remembered": len(presets), "dead_entries": dead}


# ---------------------------------------------------------------- page "Sicherungen"

def backups_page(inst, app_key, backup, indent):
    """Four example backups; Orfix has not written anything yet. The base size is what a backup
    of this data directory would be today (hard rule 4, zipped in memory), plus the example
    profiles present at that time (uncompressed, an upper bound)."""
    raw, zipped, files = backup
    by_name = {p.name: p for p in inst.profiles.values() if p.example}
    mine = ["Mein U1", "PLA für Mein U1"] + [n for n in by_name if n.endswith("@Mein U1")]
    helper = "SUNLU PLA+ für U1"
    conf = f"{app_key}.conf"

    def paths(names):
        out = []
        for n in names:
            folder = f"user/default/{by_name[n].kind}"
            out += [f"{folder}/{n}.json", f"{folder}/{n}.info"]
        return out

    def present(names):
        names = [n for n in names if n in by_name]
        return zipped + sum(example_size(inst, by_name[n], indent) for n in names), files + 2 * len(names)

    everything = list(by_name)
    now = datetime.now().replace(microsecond=0)
    day = (now - timedelta(days=1)).replace(second=0)
    rows = [
        # time, kind, reason, detail, example profiles present, changed files
        (now - timedelta(minutes=18), "change", "vor „SUNLU PLA+ eingeschaltet“", None,
         [n for n in everything if n != helper],
         paths([helper]) if inst.key == "snorca" else [conf]),
        (day.replace(hour=19, minute=5), "restore", "vor Wiederherstellen", None,
         [n for n in everything if n != helper and n not in mine], [conf] + paths(mine)),
        (day.replace(hour=16, minute=40), "change", "vor „Drucker entfernt“", "Mein U1",
         [n for n in everything if n != helper], [conf] + paths(mine)),
        (day.replace(hour=14, minute=10), "manual", "von Hand", None, ["Mein PLA", "Altes PETG"], []),
    ]
    backups = []
    for index, (time, kind, reason, detail, names, changed) in enumerate(rows, 1):
        size, count = present(names)
        # "missing": example profiles there today but not in this backup; restoring removes them.
        entry = {"id": f"b{index}", "time": time.isoformat(), "kind": kind, "reason": reason,
                 "file": f"{app_key}-{time:%Y-%m-%d-%H%M%S}.zip", "size": size, "files": count,
                 "changed": changed, "missing": sorted(set(everything) - set(names), key=str.lower),
                 "example": True}
        if detail:
            entry["detail"] = detail
        backups.append(entry)
    backups[1]["restored"] = "b3"  # the restore brought "Mein U1" back from the backup before removing it
    return {
        "location": f"~/.local/share/orfix/backups/{inst.key}",
        "backups": backups, "count": len(backups), "total_size": sum(b["size"] for b in backups),
        "now": {"size": raw, "zip_size": zipped, "files": files},
        "excluded": BACKUP_EXCLUDED,
        "note": "Sicherungen enthalten Zugangsdaten aus der .conf. Nicht weitergeben.",
    }


def fits(printer, cps):
    """is_compatible_with_printer without the condition: an empty list fits every printer, an own
    printer also takes the profiles of its direct parent (FINDINGS 4.6, rule 3)."""
    return not cps or printer.name in cps or (not printer.package and printer.inherits in cps)


def own_printer_models(inst):
    """Own printers the slicer loads, one model each: base model, variant and vendor package
    come from the template chain. A printer with a broken chain is not loaded (FINDINGS 4.4)."""
    out = []
    for p in sorted((p for p in inst.of_kind("machine") if not p.package and p.selectable),
                    key=lambda p: p.name.lower()):
        chain, complete = chain_of(inst, p)
        if not complete:
            continue
        base = next((c for c in chain if c.package), None)
        out.append({"printer": p, "model": first(lookup(p, chain, "printer_model")[0]) or "",
                    "variant": first(lookup(p, chain, "printer_variant")[0]) or "",
                    "package": base.package if base else ""})
    return out


def build(key, slicer, path, conf_name, process_names, appimage_markers):
    conf_text = (path / conf_name).read_text(encoding="utf-8")
    # A Windows .conf ends with an MD5 line after the JSON (FINDINGS 4.3).
    conf = json.loads(re.sub(r"\n# MD5 checksum [0-9A-Fa-f]{32}\n?\Z", "\n", conf_text))
    has_opc = any((path / "system").glob("*.opc"))
    inst = Instance(key, slicer, path, conf, "opc" if has_opc else "json")
    load_json_vendors(inst)
    load_opc_vendors(inst)
    load_colour_files(inst)
    snorca = key == "snorca"

    models = installed_printers(inst)
    system_printers = [p for m in models for _, p in m["printers"]]
    u1 = [p.name for p in system_printers if p.name.startswith("Snapmaker U1")]
    # All examples come in before anything is resolved, so every page sees the same ones and the
    # example printer "Mein U1" gets its own card on the page "Filamente".
    for example in example_profiles(u1) + printer_examples(inst):
        inst.add(example)
    own_models = own_printer_models(inst)
    all_printers = system_printers + [o["printer"] for o in own_models]

    filament_list = conf.get("filaments") or []
    list_names = set(filament_list)
    system_filaments = [p for p in inst.of_kind("filament") if p.package and p.selectable]
    excluded = library_exclusions(inst, snorca)
    selected = (conf.get("presets") or {}).get("machine", "")

    def in_list(p):
        return not list_names or p.name in list_names or any(n in list_names for n in p.renamed_from)

    selectable = sorted((p for p in inst.of_kind("filament") if p.selectable),
                        key=lambda p: (p.origin_kind != "user", p.name.lower()))
    records = {}
    for p in selectable:
        record = filament_record(inst, p, in_list(p) if p.package else True)
        if snorca and is_helper(inst, p):
            record["helper"] = True
        if record.get("status") == "orphaned":
            records[p.name] = record
            continue
        for printer in all_printers:
            if not fits(printer, record["compatible_printers"]):
                continue
            by = excluded.get(p.name, {}).get(printer.name)
            if not by and not snorca:
                # Orca main also matches the printer's parent (Preset.cpp is_compatible_with_printer).
                by = excluded.get(p.name, {}).get(printer.inherits)
            if by:
                record["printers"][printer.name] = {"status": "displaced", "displaced_by": by}
            elif record["in_list"]:
                record["printers"][printer.name] = {"status": "visible"}
            else:
                entry = {"status": "hidden"}
                if snorca and p.origin_kind == "library":
                    entry["hint"] = "Kann freigeschaltet werden."
                record["printers"][printer.name] = entry
        if record["printers"] or (list_names and record["in_list"]):
            records[p.name] = record

    processes = [p for p in inst.of_kind("process") if p.selectable]
    same_alias = []

    def variant_entry(variant, printer):
        rows, counts = [], {"visible": 0, "hidden": 0, "displaced": 0}
        for r in records.values():
            entry = r["printers"].get(printer.name)
            if not entry:
                continue
            counts[entry["status"]] += 1
            rows.append({"name": r["name"], **entry})
        proc_names = sorted(p.name for p in processes if fits(printer, compatible_printers(inst, p)))
        if snorca and not printer.example:
            # SnOrca's sidebar shows only one system filament per alias (FINDINGS 4.6).
            seen = {}
            for row in rows:
                r = records[row["name"]]
                if row["status"] == "visible" and r["origin_kind"] != "user":
                    seen.setdefault(r["alias"], []).append(r["name"])
            same_alias.extend((printer.name, names) for names in seen.values() if len(names) > 1)
        return {"name": printer.name, "variant": variant, "selected": printer.name == selected,
                "counts": counts, "process_count": len(proc_names), "processes": proc_names}

    system_models = [{"model": m["model"], "origin": m["package"],
                      "printers": [variant_entry(variant, printer) for variant, printer in m["printers"]],
                      "cover": COVERS.get(m["model"], PLACEHOLDER_COVER)} for m in models]
    # Own printers after the system models, so a model keeps its index (and its address).
    out_models = system_models + [
        {"model": o["printer"].name, "origin": o["package"], "own": True, "based_on": o["model"],
         "printers": [variant_entry(o["variant"], o["printer"])],
         "cover": COVERS.get(o["model"], PLACEHOLDER_COVER), **({"example": True} if o["printer"].example else {})}
        for o in own_models]

    without_printer = []
    for name in filament_list:
        matches = [p for p in system_filaments if p.name == name or name in p.renamed_from]
        if any(records.get(p.name, {}).get("printers") for p in matches):
            continue
        without_printer.append({"name": name, "exists": bool(matches)})

    warnings = []
    if without_printer:
        n = len(without_printer)
        warnings.append({
            "code": "visible_without_printer", "level": "info", "count": n,
            "text": f"{n} sichtbare Filamente passen zu keinem installierten Drucker.",
            "action": "Kein Handlungsbedarf, sie stören nicht. Ausblenden räumt die Liste auf.",
            "names": [w["name"] for w in without_printer],
        })
    for r in records.values():
        if r.get("status") == "orphaned":
            warnings.append({
                "code": "orphaned", "level": "error", "count": 1, "text": f"„{r['name']}“: {r['problem']}",
                "action": "Einem vorhandenen Profil zuordnen oder löschen.", "names": [r["name"]],
                **({"example": True} if r.get("example") else {}),
            })
    for printer_name, names in same_alias:
        warnings.append({
            "code": "same_alias", "level": "warning", "count": len(names),
            "text": f"Für {printer_name} zeigt der Slicer von {', '.join(names)} nur eins.",
            "action": "Eins davon ausblenden.", "names": names,
        })
    if snorca:
        # Real printers only: the example printer "Mein U1" does not exist in the slicer.
        real = {p.name for p in all_printers if not p.example}
        unlockable = {r["name"] for r in records.values()
                      if any(e.get("hint") for name, e in r["printers"].items() if name in real)}
        if unlockable:
            warnings.append({
                "code": "library_hidden", "level": "info", "count": len(unlockable),
                "text": f"{len(unlockable)} Profile der Orca-Bibliothek passen zu deinen Druckern, "
                        "sind aber ausgeblendet. Snapmaker Orca bietet sie selbst nicht an.",
                "action": "Einzelne Profile freischalten.", "names": sorted(unlockable),
            })

    app_key = conf_name.rsplit(".", 1)[0]
    state = run_state(path, process_names, appimage_markers)
    running_now = state["running"]
    backup = backup_measure(path)
    # Profiles are written with the indent of the .conf: tab in Orca >= 2.4.0 (FINDINGS 4.3).
    indent_match = re.match(r"\{\n([ \t]+)\S", conf_text)
    indent = indent_match.group(1) if indent_match else "    "

    header = conf.get("header", "")
    return {
        "id": key, "slicer": slicer, "header": header, "version": header.rsplit(" ", 1)[-1],
        "path": "~/" + str(path.relative_to(Path.home())), "storage": inst.storage,
        "running": running_now,
        # Why Orfix only shows: "lock", "process" or "process_unmapped" (orfix/guard.py).
        "running_reason": {"code": state["reason"], "pids": state["pids"], "lock": state["lock"]} if running_now else None,
        "problems": problems_of(path),
        "logged_in": (conf.get("app") or {}).get("preset_folder", "") != "",
        "selected_printer": selected,
        "filament_list": {"mode": "list" if filament_list else "all", "count": len(filament_list)},
        "models": out_models,
        "filaments": list(records.values()),
        "without_printer": without_printer,
        "warnings": warnings,
        "stats": {
            "models": len(out_models), "printers": len(all_printers),
            "system_filaments_selectable": len(system_filaments),
            "filaments_shown": len(records),
            "examples": sum(1 for r in records.values() if r.get("example")),
            "warnings": len(warnings),
            "per_printer": {v["name"]: {**v["counts"], "processes": v["process_count"]}
                            for m in out_models for v in m["printers"]},
        },
        "slicer_page": slicer_page(inst, app_key, conf_text, indent, backup, running_now),
        "printers_page": printers_page(inst, system_models, system_printers, selected),
        "backups_page": backups_page(inst, app_key, backup, indent),
    }


def main():
    home = Path.home()
    # Process names and the AppImage name markers as in orfix/guard.py.
    instances = [
        build("snorca", "Snapmaker Orca", home / ".config" / "Snapmaker_Orca", "Snapmaker_Orca.conf",
              {"snapmaker-orca", "Snapmaker_Orca", "Snapmaker Orca"},
              ("snapmaker_orca", "snapmaker-orca", "snapmaker orca")),
        build("orca", "OrcaSlicer", home / ".config" / "OrcaSlicer", "OrcaSlicer.conf",
              {"orca-slicer", "OrcaSlicer"}, ("orcaslicer", "orca-slicer", "orca_slicer")),
    ]
    data = {"generated": datetime.now().isoformat(timespec="seconds"), "labels": LABELS,
            "core_values": [{"key": k, "label": label, "unit": unit} for k, label, unit in CORE_VALUES],
            "editable_fields": [{"key": k, "label": label, "unit": unit, "group": group, "type": kind,
                                 "default": default, "min": low, "max": high}
                                for k, label, unit, group, kind, default, low, high in EDITABLE_FIELDS],
            "instances": instances}
    out = HERE / "data.js"
    out.write_text("window.ORFIX_DATA = " + json.dumps(data, ensure_ascii=False, separators=(",", ":")) + ";\n",
                   encoding="utf-8")
    for inst in instances:
        s = inst["stats"]
        print(f"{inst['header']}: {s['printers']} printers, {s['filaments_shown']} filaments shown, "
              f"{s['warnings']} warnings")
        for name, c in s["per_printer"].items():
            print(f"  {name}: visible {c['visible']}, hidden {c['hidden']}, displaced {c['displaced']}, "
                  f"processes {c['processes']}")
        sp, pp, bp = inst["slicer_page"], inst["printers_page"], inst["backups_page"]
        print(f"  slicer page: {len(sp['packages'])} packages, {len(sp['tree'])} top-level entries, "
              f"backup today {sp['totals']['backup_zip_size'] // 1024} KB zipped "
              f"({sp['totals']['backup_size'] // 1024} KB, {sp['totals']['backup_files']} files)")
        print(f"  printers page: {sum(len(m['printers']) for m in pp['system'])} system, {len(pp['own'])} own, "
              f"{len(pp['dead_entries'])} dead entries; backups page: {bp['count']} examples, "
              f"{bp['total_size'] // 1024} KB")
    print(f"wrote {out} ({out.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
