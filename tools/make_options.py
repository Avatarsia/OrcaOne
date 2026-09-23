"""Writes orfix/options.json: the settings each slicer knows per profile kind, with their shape.

Transferring a profile to the other slicer needs to know which keys the target takes, whether a
value is one string or a list, whether "nil" is allowed and which choices an enum has. A key the
slicer does not know it drops silently, an unknown choice it replaces by its default, but a value
it cannot read makes it delete the whole profile (FINDINGS, "Übertragung OrcaSlicer → SnOrca").

Read from the slicer sources in slicer-src/ (not in git, see FINDINGS "Quellen"):
- PrintConfig.cpp: every `def = this->add("key", coType)` or `add_nullable`, its enum_values, and
  the retraction keys a filament overrides (declared in a loop, nullable, "filament_" + key);
- Preset.cpp: s_Preset_print_options, s_Preset_filament_options, s_Preset_printer_options and
  s_Preset_machine_limits_options, which decide what belongs to a process, filament or printer;
- PrintConfig.cpp, handle_legacy: old names the slicer translates while loading ("legacy", e.g.
  wall_infill_order to wall_sequence) and those it ignores as obsolete ("obsolete"). A copy keeps
  the first, the slicer converts them; the others the target would drop anyway.

Run after updating slicer-src: .lenv/bin/python tools/make_options.py
"""

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SOURCES = {
    "Snapmaker_Orca": ("Snapmaker Orca v2.4.0", ROOT / "slicer-src/snorca-v2.4.0/src/libslic3r"),
    "OrcaSlicer": ("OrcaSlicer main", ROOT / "slicer-src/orcaslicer-main/src/libslic3r"),
}
ADD = re.compile(r'def\s*=\s*this->add(_nullable)?\(\s*"([^"]+)"\s*,\s*(co\w+)\s*\)')
ENUM = re.compile(r'def->enum_values\.(?:push_back|emplace_back)\(\s*"([^"]*)"\s*\)')
ENUM_INIT = re.compile(r'def->enum_values\s*=\s*\{([^}]*)\}')
LISTS = {"process": ["s_Preset_print_options"], "filament": ["s_Preset_filament_options"],
         "machine": ["s_Preset_printer_options", "s_Preset_machine_limits_options"]}


def strip_comments(text: str) -> str:
    return re.sub(r"//[^\n]*", "", re.sub(r"/\*.*?\*/", "", text, flags=re.S))


def definitions(text: str) -> dict:
    body = text[text.find("void PrintConfigDef::init_common_params"):]
    matches = list(ADD.finditer(body))
    out = {}
    for i, m in enumerate(matches):
        block = body[m.end():matches[i + 1].start() if i + 1 < len(matches) else len(body)]
        enums = ENUM.findall(block)
        for init in ENUM_INIT.findall(block):
            enums += re.findall(r'"([^"]*)"', init)
        entry = {"type": m.group(3), "nullable": bool(m.group(1))}
        if enums:
            entry["enums"] = sorted(set(enums))
        out.setdefault(m.group(2), entry)
    # Machine limits per axis, added in a loop: this->add("machine_max_speed_" + axis.name, coFloats).
    for m in re.finditer(r'this->add\(\s*"(machine_max_\w+_)"\s*\+\s*axis\.name\s*,\s*(co\w+)\s*\)', body):
        for axis in "xyze":
            out.setdefault(m.group(1) + axis, {"type": m.group(2), "nullable": False})
    # Keys added in a loop over their names: for (const char* key : {...}) { def = this->add(key, coString); }
    for m in re.finditer(r'for \(const char\s*\*\s*key\s*:\s*\{([^}]*)\}\)\s*\{\s*def\s*=\s*this->add\(key,\s*(co\w+)\)', body):
        for key in re.findall(r'"([^"]+)"', m.group(1)):
            out.setdefault(key, {"type": m.group(2), "nullable": False})
    # Retraction values a filament overrides: added in a loop as nullable vectors.
    loop = re.search(r"for \(const char \*opt_key : \{([^}]*)\}\)\s*\{\s*auto\s+it_opt\s*=\s*options\.find\(opt_key\)", text) \
        or re.search(r"filament_extruder_override_keys\s*=\s*\{([^}]*)\}", text)
    if loop:
        for key in re.findall(r'"([^"]+)"', strip_comments(loop.group(1))):
            name = key if key.startswith("filament_") else "filament_" + key
            base = out.get(name[len("filament_"):])
            if base and name not in out:
                out[name] = dict(base, nullable=True)
    return out


def option_list(text: str, name: str) -> list:
    m = re.search(rf"static std::vector<std::string> {name}\s*\{{(.*?)\}};", text, re.S)
    return re.findall(r'"([^"]+)"', strip_comments(m.group(1))) if m else []


def extruder_keys(text: str) -> list:
    """print_config_def.extruder_option_keys(): a printer's options per nozzle."""
    m = re.search(r"m_extruder_option_keys\s*=\s*\{(.*?)\};", text, re.S)
    return re.findall(r'"([^"]+)"', strip_comments(m.group(1))) if m else []


def legacy(text: str, defs: dict) -> tuple:
    """(old names handle_legacy translates, names it ignores as obsolete)."""
    start = text.find("void PrintConfigDef::handle_legacy(")
    body = text[start:text.find("\nvoid ", start + 10)]
    ignore = re.search(r"static std::set<std::string> ignore\s*=\s*\{(.*?)\};", body, re.S)
    obsolete = set(re.findall(r'"([^"]+)"', strip_comments(ignore.group(1)))) if ignore else set()
    named = set(re.findall(r'opt_key\s*==\s*"([^"]+)"', strip_comments(body)))
    return sorted(named - obsolete - set(defs)), sorted(obsolete)


def build() -> dict:
    out = {}
    for app_key, (label, src) in SOURCES.items():
        config = (src / "PrintConfig.cpp").read_text(encoding="utf-8", errors="replace")
        preset = (src / "Preset.cpp").read_text(encoding="utf-8", errors="replace")
        defs = definitions(config)
        kinds = {}
        for kind, lists in LISTS.items():
            keys = [k for name in lists for k in option_list(preset, name)]
            if kind == "machine":
                keys += extruder_keys(config)
            kinds[kind] = {k: defs[k] for k in sorted(set(keys)) if k in defs}
        old, obsolete = legacy(config, defs)
        out[app_key] = {"source": label, "options": kinds, "legacy": old, "obsolete": obsolete}
    return out


if __name__ == "__main__":
    data = build()
    target = ROOT / "orfix" / "options.json"
    target.write_text(json.dumps(data, indent=1, ensure_ascii=False, sort_keys=True) + "\n", encoding="utf-8")
    for app_key, entry in data.items():
        print(app_key, {kind: len(keys) for kind, keys in entry["options"].items()})
