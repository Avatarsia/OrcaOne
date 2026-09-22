#!/usr/bin/env python3
"""Build sample data for the overview UI drafts: writes data.js (window.ORFIX_DATA).

Reads the real slicer data directories strictly read-only and never starts a
slicer. The rules are a simplified version of docs/FINDINGS.md 4.6 and 4.7:
installed system printers from "models", compatibility via compatible_printers,
the library exclusion by alias, visibility via the "filaments" list.
Filament colours come from default_filament_colour or, in SnOrca, from the vendor's
filaments_colours.json; printer pictures are the copies in assets/.
Standard library only. The .opc files are read with prototypes/opc/opc_read.py.

Usage: python3 make_data.py
"""
import colorsys
import json
import re
import sys
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path

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
        if not any(manifest.get(k) for k in lists):
            # SnOrca loads the library straight from disk since 2.3.5 (FINDINGS 4.7).
            for path in sorted(folder.rglob("*.json")):
                data = json.loads(path.read_text(encoding="utf-8"))
                inst.add(profile_from_json(data, data.get("type", "filament"), package))
            continue
        for list_key, kind in (("machine_list", "machine"), ("process_list", "process"),
                               ("filament_list", "filament")):
            for item in manifest.get(list_key, []):
                data = json.loads((folder / item["sub_path"]).read_text(encoding="utf-8"))
                inst.add(profile_from_json(data, kind, package))


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


def filament_record(inst, p, in_list):
    chain, complete = chain_of(inst, p)
    colour, colours = colours_of(inst, p, chain)
    values = {}
    for key, _, _ in CORE_VALUES:
        value, source = lookup(p, chain, key)
        items = as_list(value)
        values[key] = {"value": items[0] if items else None, "own": source is p,
                       "source": source.name if source else None}
        if len(items) > 1:
            # SnOrca keeps a second value for the high-flow hotend (FINDINGS 4.4).
            values[key]["high_flow"] = items[1]
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


def running(process_names):
    # Read-only look at the process list (comm is cut to 15 characters).
    for comm in Path("/proc").glob("[0-9]*/comm"):
        try:
            if comm.read_text().strip() in process_names:
                return True
        except OSError:
            continue
    return False


def build(key, slicer, path, conf_name, process_names):
    conf = json.loads((path / conf_name).read_text(encoding="utf-8"))
    has_opc = any((path / "system").glob("*.opc"))
    inst = Instance(key, slicer, path, conf, "opc" if has_opc else "json")
    load_json_vendors(inst)
    load_opc_vendors(inst)
    load_colour_files(inst)
    snorca = key == "snorca"

    models = installed_printers(inst)
    all_printers = [p for m in models for _, p in m["printers"]]
    u1 = [p.name for p in all_printers if p.name.startswith("Snapmaker U1")]
    for example in example_profiles(u1):
        inst.add(example)

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
            cps = record["compatible_printers"]
            if cps and printer.name not in cps:
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
    out_models = []
    same_alias = []
    for m in models:
        variants = []
        for variant, printer in m["printers"]:
            rows, counts = [], {"visible": 0, "hidden": 0, "displaced": 0}
            for r in records.values():
                entry = r["printers"].get(printer.name)
                if not entry:
                    continue
                counts[entry["status"]] += 1
                rows.append({"name": r["name"], **entry})
            proc_names = sorted(p.name for p in processes
                                if not compatible_printers(inst, p) or printer.name in compatible_printers(inst, p))
            if snorca:
                # SnOrca's sidebar shows only one system filament per alias (FINDINGS 4.6).
                seen = {}
                for row in rows:
                    r = records[row["name"]]
                    if row["status"] == "visible" and r["origin_kind"] != "user":
                        seen.setdefault(r["alias"], []).append(r["name"])
                same_alias += [(printer.name, names) for names in seen.values() if len(names) > 1]
            variants.append({
                "name": printer.name, "variant": variant, "selected": printer.name == selected,
                "counts": counts,
                "process_count": len(proc_names), "processes": proc_names,
            })
        out_models.append({"model": m["model"], "origin": m["package"], "printers": variants,
                           "cover": COVERS.get(m["model"], PLACEHOLDER_COVER)})

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
            })
    for printer_name, names in same_alias:
        warnings.append({
            "code": "same_alias", "level": "warning", "count": len(names),
            "text": f"Für {printer_name} zeigt der Slicer von {', '.join(names)} nur eins.",
            "action": "Eins davon ausblenden.", "names": names,
        })
    if snorca:
        unlockable = {r["name"] for r in records.values()
                      if any(e.get("hint") for e in r["printers"].values())}
        if unlockable:
            warnings.append({
                "code": "library_hidden", "level": "info", "count": len(unlockable),
                "text": f"{len(unlockable)} Profile der Orca-Bibliothek passen zu deinen Druckern, "
                        "sind aber ausgeblendet. Snapmaker Orca bietet sie selbst nicht an.",
                "action": "Einzelne Profile freischalten.", "names": sorted(unlockable),
            })

    header = conf.get("header", "")
    return {
        "id": key, "slicer": slicer, "header": header, "version": header.rsplit(" ", 1)[-1],
        "path": "~/" + str(path.relative_to(Path.home())), "storage": inst.storage,
        "running": running(process_names),
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
    }


def main():
    home = Path.home()
    instances = [
        build("snorca", "Snapmaker Orca", home / ".config" / "Snapmaker_Orca", "Snapmaker_Orca.conf",
              {"snapmaker-orca", "Snapmaker_Orca", "Snapmaker Orca"}),
        build("orca", "OrcaSlicer", home / ".config" / "OrcaSlicer", "OrcaSlicer.conf",
              {"orca-slicer", "OrcaSlicer"}),
    ]
    data = {"generated": datetime.now().isoformat(timespec="seconds"), "labels": LABELS,
            "core_values": [{"key": k, "label": label, "unit": unit} for k, label, unit in CORE_VALUES],
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
    print(f"wrote {out} ({out.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
