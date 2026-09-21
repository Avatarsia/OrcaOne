#!/usr/bin/env python3
"""Compare a vendor .opc cache with the JSON profiles it was built from.

Usage: opc_compare.py FILE.opc PROFILES_DIR PRINTCONFIG_CPP
"""
import json
import math
import os
import re
import sys
from collections import Counter, defaultdict

import opc_read as opc

META_KEYS = {"type", "name", "inherits", "from", "instantiation", "setting_id", "filament_id",
             "renamed_from", "description", "version", "is_custom_defined", "url"}


def is_meta(key):
    return key in META_KEYS or key.startswith("compatible_printers") or key.startswith("compatible_prints")


def option_defs(printconfig_cpp):
    """opt_key -> (type code, nullable) of print_config_def, scraped from PrintConfig.cpp.
    Good enough for a probe: literal this->add("key", coX) plus the generated
    filament_* override keys."""
    src = open(printconfig_cpp, encoding="utf-8").read()
    start = src.index("PrintConfigDef::PrintConfigDef()")
    end = src.index("void PrintConfigDef::handle_legacy(")
    body = src[start:end]
    type_codes = {v: k for k, v in opc.TYPE_NAMES.items()}
    defs, last = {}, None
    for m in re.finditer(r'this->add\("([^"]+)",\s*(co\w+)\)|def->nullable\s*=\s*true', body):
        if m.group(1):
            last = m.group(1)
            defs[last] = [type_codes[m.group(2)], False]
        elif last:
            defs[last][1] = True
    # Generated in a loop over the axes (init_fff_params).
    for axis in "xyze":
        for prefix in ("machine_max_speed_", "machine_max_acceleration_", "machine_max_jerk_"):
            defs[prefix + axis] = [opc.CO_FLOATS, False]
    for key in ("print_plugin_config_overrides", "printer_plugin_config_overrides",
                "filament_plugin_config_overrides"):
        defs[key] = [opc.CO_STRING, False]
    block = re.search(r"filament_extruder_override_keys = \{(.*?)\};", src, re.S).group(1)
    for key in re.findall(r'^\s*"([^"]+)"', block, re.M):
        base = defs.get(key[len("filament_"):])
        if base:
            defs[key] = [base[0], True]
    return {k: tuple(v) for k, v in defs.items()}


def legacy_renames(printconfig_cpp):
    """old key -> new key from PrintConfigDef::handle_legacy (some are conditional)."""
    src = open(printconfig_cpp, encoding="utf-8").read()
    body = src[src.index("void PrintConfigDef::handle_legacy("):src.index("static std::set<std::string> ignore")]
    renames = {}
    for chunk in re.split(r"\belse\s+if\b", body):
        olds = re.findall(r'opt_key\s*==\s*"([^"]+)"', chunk)
        new = re.findall(r'opt_key\s*=\s*"([^"]*)"', chunk)
        if olds and new:
            for old in olds:
                renames.setdefault(old, new[0])
    return renames


# ----------------------------------------------------------- JSON -> value, as Orca parses it

NUM_RE = re.compile(r"\s*[+-]?(?:inf(?:inity)?|nan|(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)", re.I)
INT_RE = re.compile(r"\s*[+-]?\d+")


def parse_double(s):
    # istringstream >> double: leading number, rest ignored ("15%" -> 15).
    m = NUM_RE.match(s)
    return float(m.group(0)) if m else 0.0


def parse_int(s):
    m = INT_RE.match(s)
    return int(m.group(0)) if m else 0


def unescape_string(s):
    out, i = [], 0
    while i < len(s):
        c = s[i]
        if c == "\\" and i + 1 < len(s):
            i += 1
            c = {"r": "\r", "n": "\n"}.get(s[i], s[i])
        out.append(c)
        i += 1
    return "".join(out)


def unescape_strings(s):
    """unescape_strings_cstyle from Config.cpp (simplified, for normalisation only)."""
    out, i, n = [], 0, len(s)
    if not s:
        return out
    while True:
        while i < n and s[i] in " \t":
            i += 1
        if i == n:
            return out
        buf = []
        if s[i] == '"':
            i += 1
            while i < n and s[i] != '"':
                c = s[i]
                if c == "\\" and i + 1 < n:
                    i += 1
                    c = {"r": "\r", "n": "\n"}.get(s[i], s[i])
                buf.append(c)
                i += 1
            i += 1
        else:
            while i < n and s[i] != ";":
                buf.append(s[i])
                i += 1
        out.append("".join(buf))
        while i < n and s[i] in " \t":
            i += 1
        if i >= n:
            return out
        i += 1  # ';'
        if i == n:
            out.append("")
            return out


def join_json_array(t, arr):
    """parse_str_arr() in ConfigBase::load_from_json."""
    if t == opc.CO_STRINGS:
        return ";".join('"' + x.replace("\\", "\\\\").replace('"', '\\"').replace("\r", "\\r")
                        .replace("\n", "\\n") + '"' for x in arr)
    sep = "#" if t == opc.CO_POINTS_GROUPS else ","
    return sep.join(arr)


def parse_point(s):
    s = s.strip()
    parts = s.split("x") if "x" in s else s.split(",")
    return (parse_double(parts[0]), parse_double(parts[1]) if len(parts) > 1 else 0.0)


def deserialize(t, s):
    """Value as ConfigOption*::deserialize() would build it from string s."""
    split = [x.strip() for x in s.split(",")] if s else []
    if t in (opc.CO_FLOAT, opc.CO_PERCENT):
        return parse_double(s)
    if t == opc.CO_INT:
        return parse_int(s)
    if t == opc.CO_STRING:
        return unescape_string(s)
    if t == opc.CO_FLOAT_OR_PERCENT:
        return (parse_double(s), "%" in s)
    if t == opc.CO_POINT:
        return parse_point(s.replace(",", "x", 1) if "x" not in s else s)
    if t == opc.CO_POINT3:
        return tuple(parse_double(x) for x in s.split(","))
    if t == opc.CO_BOOL:
        return split[0] in ("1", "true") if split else False
    if t == opc.CO_ENUM:
        return s
    if t in (opc.CO_FLOATS, opc.CO_PERCENTS):
        if not s:
            return [0.0]
        return [math.nan if x == "nil" else parse_double(x) for x in split]
    if t == opc.CO_INTS:
        return [opc.INT_MAX if x == "nil" else parse_int(x) for x in split]
    if t == opc.CO_STRINGS:
        return unescape_strings(s)
    if t == opc.CO_FLOATS_OR_PERCENTS:
        return [(math.nan, False) if x == "nil" else (parse_double(x), "%" in x) for x in split]
    if t == opc.CO_POINTS:
        return [parse_point(x) for x in split]
    if t == opc.CO_BOOLS:
        return [opc.BOOL_NIL if x == "nil" else (1 if x in ("1", "true") else 0) for x in split]
    if t == opc.CO_ENUMS:
        return [opc.INT_MAX if x == "nil" else x for x in split]
    if t == opc.CO_POINTS_GROUPS:
        return [[parse_point(p) for p in g.split(",")] for g in s.split("#")] if s else []
    if t == opc.CO_INTS_GROUPS:
        return [[parse_int(x) for x in g.split(",")] for g in s.split("#")] if s else []
    raise ValueError(t)


def same(a, b):
    if isinstance(a, float) and isinstance(b, float):
        return a == b or (math.isnan(a) and math.isnan(b))
    if isinstance(a, (list, tuple)) and isinstance(b, (list, tuple)):
        return len(a) == len(b) and all(same(x, y) for x, y in zip(a, b))
    if isinstance(a, bool) or isinstance(b, bool):
        return bool(a) == bool(b)
    return a == b


def json_to_value(t, jv):
    if isinstance(jv, list):
        return deserialize(t, join_json_array(t, jv))
    return deserialize(t, jv)


# ----------------------------------------------------------- comparison

def main(opc_path, profiles_dir, printconfig_cpp):
    cache = opc.read_opc(opc_path)
    defs = option_defs(printconfig_cpp)
    renames = legacy_renames(printconfig_cpp)
    vendor = cache.vendor_name
    vjson = json.load(open(os.path.join(profiles_dir, vendor + ".json"), encoding="utf-8"))
    print(f"== {vendor}: cache stamp {cache.vendor_version}, JSON version {vjson.get('version')}")

    stats = Counter()
    examples = defaultdict(list)
    distinct = defaultdict(set)

    def note(cat, text, limit=6):
        stats[cat] += 1
        if len(examples[cat]) < limit:
            examples[cat].append(text)

    lists = {"process": "process_list", "filament": "filament_list", "machine": "machine_list"}
    for kind, list_key in lists.items():
        entries = getattr(cache, kind)
        cache_names = [e.name for e in entries]
        listed = {x["name"]: x["sub_path"] for x in vjson.get(list_key, [])}
        print(f"{kind}: cache {len(cache_names)} / vendor list {len(listed)}; "
              f"names equal: {set(cache_names) == set(listed)}; "
              f"sub_path equal: {all(listed.get(e.name) == e.sub_path for e in entries)}")
        for e in entries:
            path = os.path.join(profiles_dir, vendor, e.sub_path)
            j = json.load(open(path, encoding="utf-8"))
            stats["profiles"] += 1
            # metadata
            meta = {
                "name": (e.name, j.get("name", "")),
                "inherits": (e.inherits, j.get("inherits", "")),
                "instantiation": (e.instantiation, j.get("instantiation", "")),
                "setting_id": (e.setting_id, j.get("setting_id", "")),
                "filament_id": (e.filament_id, j.get("filament_id", "")),
                "description": (e.description, j.get("description", "")),
            }
            rf = j.get("renamed_from")
            meta["renamed_from"] = (e.renamed_from, unescape_strings(rf) if isinstance(rf, str) else (rf or []))
            for k, (c, js) in meta.items():
                if c != js:
                    note(f"meta mismatch: {k}", f"{e.name}: cache={c!r} json={js!r}")
                else:
                    stats[f"meta ok: {k}"] += 1
            # keys
            jkeys = {k for k in j if not is_meta(k)}
            ckeys = {k for k in e.config if not is_meta(k)}
            renamed = {renames[k] for k in jkeys if renames.get(k)}
            for k in sorted(jkeys - ckeys):
                if renames.get(k) in ckeys:
                    note("json key absent from cache: legacy key, renamed by handle_legacy",
                         f"{k} -> {renames[k]}", 0)
                    distinct["legacy renamed"].add(f"{k} -> {renames[k]}")
                elif k not in defs:
                    note("json key absent from cache: unknown to print_config_def", f"{e.name}: {k}", 0)
                    distinct["unknown"].add(k)
                else:
                    note("json key absent from cache: KNOWN key", f"{e.name}: {k}", 12)
            for k in sorted(ckeys - jkeys):
                if k in renamed:
                    continue
                note("cache key absent from json", f"{e.name}: {k}", 12)
            expected = {renames.get(k) or k for k in jkeys}
            if {k for k in expected if k in defs} == ckeys:
                stats["profiles with equal key set (unknown keys dropped, legacy renames applied)"] += 1
            # values
            for k in sorted(set(j) & set(e.config)):
                opt = e.config[k]
                stats["values compared"] += 1
                jv = j[k]
                cjson = opc.to_json_value(opt)
                if cjson == jv:
                    stats["values: raw JSON form identical"] += 1
                else:
                    note(f"values: raw form differs ({opc.TYPE_NAMES[opt.type]})",
                         f"{e.name}: {k}: json={jv!r} cache={cjson!r}", 4)
                if same(json_to_value(opt.type, jv), opt.value):
                    stats["values: equal after normalisation"] += 1
                else:
                    note("values: DIFFER after normalisation",
                         f"{e.name}: {k} ({opc.TYPE_NAMES[opt.type]}): json={jv!r} cache={cjson!r}", 15)
            # type check against this source tree's print_config_def
            for k, opt in e.config.items():
                d = defs.get(k)
                if d is None:
                    note("cache key not in scraped print_config_def", k, 5)
                elif d[0] != opt.type:
                    note("cache type != print_config_def type", f"{k}: {opt.type:#x} vs {d[0]:#x}", 5)

    for cat in sorted(stats):
        print(f"  {stats[cat]:7d}  {cat}")
        for ex in examples.get(cat, []):
            print(f"             - {ex}"[:260])
    for cat, keys in distinct.items():
        print(f"  distinct keys, {cat}: {sorted(keys)}")
    print()


if __name__ == "__main__":
    main(*sys.argv[1:4])
