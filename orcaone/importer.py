"""Page "Import/Export": profiles from a file into an installation, and own profiles out as a ZIP.

The import reads what the Orca family writes (docs/IMPORT-QUELLEN.md): a profile JSON, a ZIP of
profiles (the slicers' export dialog, OrcaOne's export, vendor packs), the bundles .orca_filament,
.orca_printer and .orca_bundle, OrcaOne's backups (a data directory as ZIP) and 3MF projects. No
slicer shows beforehand what a file holds; here read() lists it, analyse() tells per profile
what an import would do in the chosen installation, and the planner writes the chosen ones
(operations.op_profile_import) like every change: plan, backup, write, scan. Archives are read in
memory with limits, never unpacked to disk.

How a profile lands (convert): as the child of its parent if the installation has that one,
else as a root profile with every value, the way the page "Übertragen" copies (transfer.py).
Parents from the same file go into it. A 3MF holds complete profiles, so these land even without
their parent.
"""

import hashlib
import io
import json
import re
import zipfile
from dataclasses import dataclass
from pathlib import PurePosixPath

from . import transfer
from .resolver import Resolver, as_list
from .scanner import META_KEYS

KINDS = ("filament", "process", "machine")
SETTINGS_ID = {"filament": "filament_settings_id", "process": "print_settings_id", "machine": "printer_settings_id"}
# The slicers know the kind of a file only by its settings id (FINDINGS 4.8); "type" and the
# folder help where it is missing.
_TYPES = {"filament": "filament", "process": "process", "print": "process", "machine": "machine", "printer": "machine"}
# Own profiles a 3MF project embeds, as complete JSON (bbs_3mf.cpp, FINDINGS 4.8).
_EMBEDDED = re.compile(r"Metadata/(machine|filament|process)_settings_\d+\.config", re.IGNORECASE)
_PROJECT = "Metadata/project_settings.config"
_APPLICATION = re.compile(r'<metadata name="Application">([^<]*)</metadata>')
# A data directory or one of OrcaOne's backups: the own profiles of every user folder.
_USER_FILE = re.compile(r"user/[^/]+/(machine|process|filament)/(?:base/)?[^/]+\.json")
# Files beside the profiles: bundle descriptions, vendor manifests, metadata of archives.
_NOT_PROFILES = {"bundle_structure.json", "bundle_metadata.json", "orcaone-backup.json", "orfix-backup.json"}
# A printer's connection and its credentials; the slicers' export drops them too (FINDINGS 4.8).
_CONNECTION = re.compile(r"print_?host")
# Values the page shows per profile, besides name and printers.
CORE = {"filament": ("filament_vendor", "filament_type", "nozzle_temperature", "filament_flow_ratio", "filament_max_volumetric_speed"),
        "process": ("layer_height", "wall_loops", "sparse_infill_density"),
        "machine": ("printer_model", "nozzle_diameter")}
MAX_FILE = 300 * 1024 * 1024   # the whole upload: a 3MF carries its meshes
MAX_ENTRY = 8 * 1024 * 1024    # one profile or config in an archive
MAX_ENTRIES = 50000


class ImportFailed(Exception):
    def __init__(self, code: str, **params):
        super().__init__(code)
        self.code, self.params = code, params


@dataclass
class Found:
    kind: str
    name: str
    data: dict           # the profile as the file has it, meta keys included
    where: str           # its place in the file, for the page
    full: bool = False   # every value, not only the differences to its parent (3MF)


# ---------------------------------------------------------------- reading

def _json(raw: bytes):
    try:
        data = json.loads(raw.decode("utf-8-sig"))
    except (UnicodeDecodeError, ValueError):
        return None
    return data if isinstance(data, dict) else None


def _kind(data: dict, where: str) -> str | None:
    for kind, key in SETTINGS_ID.items():
        if key in data:
            return kind
    if isinstance(data.get("type"), str) and data["type"] in _TYPES:
        return _TYPES[data["type"]]
    return next((_TYPES[p] for p in reversed(PurePosixPath(where).parts[:-1]) if p in _TYPES), None)


def _name(data: dict, kind: str, where: str) -> str:
    if isinstance(data.get("name"), str) and data["name"].strip():
        return data["name"]
    sid = data.get(SETTINGS_ID[kind])
    sid = sid[0] if isinstance(sid, list) and sid else sid
    return sid if isinstance(sid, str) and sid.strip() else PurePosixPath(where).stem


def _add(out: dict, data, where: str, full: bool = False) -> None:
    if data is None:
        out["skipped"].append({"where": where, "code": "not_readable"})
        return
    if "filament_list" in data or "machine_model_list" in data:
        return  # the manifest of a vendor pack, no profile
    kind = _kind(data, where)
    if kind is None:
        out["skipped"].append({"where": where, "code": "not_a_profile"})
        return
    name = _name(data, kind, where)
    data = {**data, "name": name}
    if any(f.kind == kind and f.name == name for f in out["profiles"]):
        out["skipped"].append({"where": where, "code": "twice", "name": name})
        return
    out["profiles"].append(Found(kind, name, data, where, full))


def _entry(archive: zipfile.ZipFile, info: zipfile.ZipInfo) -> bytes | None:
    """An entry up to MAX_ENTRY bytes, None if it is bigger: its header may lie about the size."""
    with archive.open(info) as f:
        data = f.read(MAX_ENTRY + 1)
    return data if len(data) <= MAX_ENTRY else None


def read(raw: bytes, filename: str) -> dict:
    """What a file holds: {"format", "profiles": [Found], "skipped": [{"where", "code"}]}.
    Raises ImportFailed."""
    if len(raw) > MAX_FILE:
        raise ImportFailed("file_too_big")
    out = {"format": "json", "profiles": [], "skipped": []}
    if not zipfile.is_zipfile(io.BytesIO(raw)):
        data = _json(raw)
        if data is None:
            raise ImportFailed("file_unknown")
        _add(out, data, filename)
        return out
    try:
        with zipfile.ZipFile(io.BytesIO(raw)) as archive:
            entries = [e for e in archive.infolist() if not e.is_dir() and not e.filename.startswith("__MACOSX/")]
            if len(entries) > MAX_ENTRIES:
                raise ImportFailed("file_too_big")
            names = {e.filename for e in entries}
            if _PROJECT in names or any(_EMBEDDED.fullmatch(n) for n in names):
                out["format"] = "3mf"
                _read_3mf(archive, entries, out, PurePosixPath(filename).stem)
                return out
            data_dir = any(_USER_FILE.fullmatch(n) for n in names)
            out["format"] = "backup" if data_dir else "bundle" if "bundle_structure.json" in names else "zip"
            for e in entries:
                path = PurePosixPath(e.filename)
                if data_dir and not _USER_FILE.fullmatch(e.filename) or path.suffix.lower() != ".json" \
                        or path.name in _NOT_PROFILES:
                    continue
                raw_entry = _entry(archive, e)
                if raw_entry is None:
                    out["skipped"].append({"where": e.filename, "code": "too_big"})
                    continue
                _add(out, _json(raw_entry), e.filename)
    except (zipfile.BadZipFile, zipfile.LargeZipFile, OSError, EOFError, NotImplementedError, RuntimeError) as exc:
        raise ImportFailed("file_unknown", detail=str(exc)) from None
    return out


def _read_3mf(archive: zipfile.ZipFile, entries: list, out: dict, stem: str) -> None:
    """The own profiles a project embeds, complete, and the changes it made to others without
    saving them: those are in project_settings.config only, as the keys that differ from the
    profile it used (different_settings_to_system; order process, filament 1…n, printer)."""
    for e in sorted((e for e in entries if _EMBEDDED.fullmatch(e.filename)), key=lambda e: e.filename):
        raw = _entry(archive, e)
        _add(out, _json(raw) if raw is not None else None, e.filename, full=True)
    model = next((e for e in entries if e.filename.lower() == "3d/3dmodel.model"), None)
    found = None
    if model is not None:
        # The model holds the meshes, often more than MAX_ENTRY; its metadata come first.
        with archive.open(model) as f:
            found = _APPLICATION.search(f.read(65536).decode("utf-8", "replace"))
    info = next((e for e in entries if e.filename == _PROJECT), None)
    project = _json(_entry(archive, info) or b"") if info is not None else None
    if project is None:
        return
    filaments = [f for f in as_list(project.get("filament_settings_id")) if isinstance(f, str)]
    slots = [("process", project.get("print_settings_id"))] + [("filament", f) for f in filaments] \
        + [("machine", project.get("printer_settings_id"))]
    # What the project uses, for the page: system profiles stand in a 3MF by their name only.
    out["project"] = {"application": found.group(1).replace("-", " ") if found else "",
                      "uses": [{"kind": k, "name": n} for k, n in dict.fromkeys((k, n) for k, n in slots if isinstance(n, str) and n)]}
    parents, changed = as_list(project.get("inherits_group")), as_list(project.get("different_settings_to_system"))
    if len(changed) != len(slots):
        return
    embedded = {(f.kind, f.name) for f in out["profiles"]}
    for i, ((kind, name), keys) in enumerate(zip(slots, changed)):
        if not isinstance(name, str) or not name or not isinstance(keys, str) or (kind, name) in embedded:
            continue
        parent = parents[i] if i < len(parents) and isinstance(parents[i], str) and parents[i] else name
        values = {}
        for key in dict.fromkeys(k for k in keys.split(";") if k):
            if key in META_KEYS or key.endswith("_settings_id") or key not in project:
                continue
            value = project[key]
            # Per filament the project keeps one value, or one per hotend variant (Snapmaker Orca).
            if kind == "filament" and isinstance(value, list) and filaments and len(value) % len(filaments) == 0:
                size = len(value) // len(filaments)
                value = value[(i - 1) * size:i * size]
            values[key] = value
        if values:
            new_name = f"{name.removesuffix(' @System').removesuffix(' @base')} ({stem})"
            out["profiles"].append(Found(kind, new_name, {"name": new_name, "inherits": parent, **values},
                                         f"{_PROJECT} · {kind} {i}"))


# ---------------------------------------------------------------- one profile in the target

def _chain_values(res: Resolver, p) -> dict:
    values = {}
    for q in [p] + res.chain(p)[0]:
        for key, value in q.values.items():
            values.setdefault(key, value)
    return values


def _selectable(res: Resolver, kind: str, name: str):
    """The profile of that name a new own one can inherit from, as Planner.template allows."""
    system = res.collection[kind].get(name)
    if system is not None:
        return system if res.chain(system)[1] else None
    return next((p for p in res.own_profiles(kind) if p.name == name and not p.bundle and res.loaded(p)), None)


def convert(res: Resolver, app: str, kind: str, profile: dict, parents: list, full: bool) -> transfer.Copy:
    """How profile lands in the installation of res: its values in the form the slicer app reads,
    and the parent there, None for a root profile. parents: its parents from the same file,
    nearest first. Raises ImportFailed."""
    if kind not in KINDS:
        raise ImportFailed("unknown_kind")
    chain = [profile] + parents
    values = {}
    for q in reversed(chain):
        values.update({k: v for k, v in q.items() if k not in META_KEYS})
    wanted = chain[-1].get("inherits") if isinstance(chain[-1].get("inherits"), str) else ""
    target_parent = _selectable(res, kind, wanted) if wanted else None
    if wanted and target_parent is None:
        # A template (@base, fdm_*) cannot be a parent (FINDINGS 4.4): its values go in.
        template = next((p for p in res.scan.profiles.values() if p.kind == kind and p.name == wanted), None)
        if template is not None and res.chain(template)[1]:
            values = {**_chain_values(res, template), **values}
        elif not full:
            raise ImportFailed("parent_missing", parent=wanted)
    if kind == "machine":
        values = {k: v for k, v in values.items() if not _CONNECTION.match(k)}
    printers_wanted = [n for n in as_list(values.get("compatible_printers")) if isinstance(n, str)] if kind != "machine" else []
    have = transfer.target_printers(res)
    printers = [n for n in printers_wanted if n in have]
    if printers_wanted and not printers:
        raise ImportFailed("no_target_printer", printers=printers_wanted)
    data, dropped, cut = transfer.adapt({k: v for k, v in values.items() if k not in transfer.OWN_KEYS},
                                        transfer.OPTIONS[app], kind, same_app=True)
    if kind != "machine" and (target_parent is None or printers_wanted):
        data["compatible_printers"] = printers
    if kind != "machine" and target_parent is None:
        condition = values.get("compatible_printers_condition")
        data["compatible_printers_condition"] = condition if isinstance(condition, str) else ""
    name = profile.get("name") if isinstance(profile.get("name"), str) and profile["name"].strip() else ""
    if not name:
        raise ImportFailed("unknown_kind")
    return transfer.Copy(name=name, data=data, parent=target_parent,
                         base_id=target_parent.setting_id if target_parent is not None else "",
                         dropped=dropped, cut=cut, printers_left=[n for n in printers_wanted if n not in have])


def _comparable(values: dict, app: str, kind: str) -> dict:
    """Only what an import would write, on both sides: keys the target does not know and those
    OrcaOne never copies (transfer.OWN_KEYS) do not make two profiles differ."""
    data = transfer.adapt({k: v for k, v in values.items() if k not in transfer.OWN_KEYS}, transfer.OPTIONS[app], kind, True)[0]
    return {k: as_list(v) for k, v in data.items()}


def _name_state(res: Resolver, app: str, kind: str, copy: transfer.Copy) -> str:
    if any(p.kind == kind and p.name == copy.name for p in res.scan.profiles.values()):
        return "system_name"
    own = next((p for p in res.own_profiles(kind) if p.name == copy.name and not p.bundle), None)
    if own is None:
        return "new"
    mine = {**(_chain_values(res, copy.parent) if copy.parent is not None else {}), **copy.data}
    same = res.loaded(own) and _comparable(mine, app, kind) == _comparable(_chain_values(res, own), app, kind)
    return "same" if same else "name_taken"


def analyse(source: dict, res: Resolver, app: str) -> list:
    """Per profile of the file what an import would do in the installation of res, for the page.
    profile, parents and full go back in the change "profile_import"."""
    by_name = {(f.kind, f.name): f for f in source["profiles"]}
    # Invisible bases of a vendor pack (instantiation "false", "@base"): they go into the profiles
    # built on them; alone they would become a visible profile.
    templates = {(f.kind, f.data["inherits"]) for f in source["profiles"] if isinstance(f.data.get("inherits"), str)}
    out = []
    for f in source["profiles"]:
        parents, seen, current = [], {(f.kind, f.name)}, f
        while isinstance(current.data.get("inherits"), str) and (f.kind, current.data["inherits"]) in by_name:
            current = by_name[(f.kind, current.data["inherits"])]
            if (current.kind, current.name) in seen:
                break
            seen.add((current.kind, current.name))
            parents.append(current)
        entry = {"kind": f.kind, "name": f.name, "where": f.where, "full": f.full,
                 "profile": f.data, "parents": [p.data for p in parents], "from_file": [p.name for p in parents]}
        if (f.kind, f.name) in templates and f.data.get("instantiation") == "false":
            out.append({**entry, "status": "template", "params": {}})
            continue
        try:
            copy = convert(res, app, f.kind, f.data, entry["parents"], f.full)
        except ImportFailed as exc:
            entry.update(status=exc.code, params=exc.params)
            out.append(entry)
            continue
        resolved = {**(_chain_values(res, copy.parent) if copy.parent is not None else {}), **copy.data}
        printers = [n for n in as_list(resolved.get("compatible_printers")) if isinstance(n, str)]
        entry.update(status=_name_state(res, app, f.kind, copy), parent=copy.parent.name if copy.parent is not None else None,
                     printers=printers, dropped=copy.dropped, printers_left=copy.printers_left,
                     values={k: as_list(resolved[k])[0] for k in CORE[f.kind] if as_list(resolved.get(k))})
        out.append(entry)
    return out


def uses(source: dict, res: Resolver) -> list:
    """The profiles a 3MF project uses, and whether the installation of res has them."""
    project = source.get("project") or {}
    have = {(p.kind, p.name) for p in res.scan.profiles.values()} | {(p.kind, p.name) for p in res.own_profiles()}
    return [{**u, "here": (u["kind"], u["name"]) in have} for u in project.get("uses", [])]


def filament_id(name: str) -> str:
    """For an own root filament, as op_profile_copy gives it: Snapmaker Orca's filament dialogs find
    one by its id (FINDINGS, "Übertragung")."""
    return "P" + hashlib.md5(name.encode("utf-8")).hexdigest()[:7]


# ---------------------------------------------------------------- export

def export(res: Resolver, wanted: list, flat: bool) -> bytes:
    """Own profiles as a ZIP the slicers import ("Import Configs") and OrcaOne reads again:
    as the files are, with their parent, or flat, every value and no parent, for another slicer or
    a computer without that parent. Parents come before their children, as the slicers' import
    needs (FINDINGS 4.8); a printer goes without its connection. wanted: [(kind, name)].
    Raises ImportFailed."""
    own = {(p.kind, p.name): p for p in res.own_profiles() if not p.bundle}
    chosen = []
    for kind, name in wanted:
        p = own.get((kind, name))
        if p is None:
            raise ImportFailed("unknown_profile", name=name)
        chosen.append(p)
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        for p in sorted(chosen, key=lambda p: p.load_pass):
            data = _json((res.scan.data_dir / p.file).read_bytes())
            if data is None:
                raise ImportFailed("profile_invalid", name=p.name)
            if flat:
                chain, complete = res.chain(p)
                if not complete:
                    raise ImportFailed("profile_invalid", name=p.name)
                # Not the cloud's id: it belongs to this profile in this account (FINDINGS 4.8).
                meta = {k: v for k, v in data.items() if k in META_KEYS and k != "setting_id"}
                data = {**_chain_values(res, p), **meta, "inherits": "", "name": p.name, "from": "User",
                        SETTINGS_ID[p.kind]: [p.name] if p.kind == "filament" else p.name}
                if p.kind == "filament":
                    data["filament_id"] = filament_id(p.name)
            if p.kind == "machine":
                data = {k: v for k, v in data.items() if not _CONNECTION.match(k)}
            folder = f"{p.kind}/base" if flat or not data.get("inherits") else p.kind
            archive.writestr(f"{folder}/{p.name}.json", json.dumps(data, indent=4, ensure_ascii=False, sort_keys=True) + "\n")
    return buffer.getvalue()
