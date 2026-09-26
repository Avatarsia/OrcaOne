"""Errors of a printer, for the page "Fehler" (the user's wish of 26.09.2026): what it reports now and
reported before, what a code means and what helps. Read only: never RAISE_EXCEPTION, CLEAR_EXCEPTION,
server.exception.raise or server.exception.clear; the display acknowledges errors.

The U1 names an error by a code LLLL-MMMM-IIII-CCCC: level (1 note, 2 warning, the print pauses,
3 error, the print is cancelled), module (522 motion and system, 523 toolhead, ...), index (a head or
a board) and code (Snapmaker/u1-klipper, exception_manager.py and coded_exception.py; its lines in
klippy.log checked on the user's U1 on 26.09.2026). Any other Klipper printer has no codes, only
its messages, sorted here by a table of patterns (Klipper's sources, klipper3d.org).

Now: Klipper's object exception_manager (the codes that stay until acknowledged), webhooks (a
shutdown; on the U1 its first line is {"coded": ..., "msg": ...}) and print_stats. Before: in
klippy.log the lines "Raising exception: id:.. index:.. code:.. oneshot:.. level:.., message: .."
and "Transition to shutdown state: ..", and the answers starting with "!!" in Moonraker's G-code
store. Snapmaker's own words come from the device panel of Snapmaker Orca on this computer, read
at run time and never shipped (the user's choice of 26.09.2026): <data dir>/web/flutter_web/assets/
assets/i10n/en.json, keys error_<16 digits>_title and _desc, 442 codes (checked 26.09.2026).
"""

import json
import re

from . import instances, printer_logs
from .camera import CameraError, _get

TAIL = 2 * 1024 * 1024   # bytes at the end of klippy.log read for what came before (about 1 s on the U1)
HISTORY = 100            # entries of what came before, newest first
TEXT_FILE = ("web", "flutter_web", "assets", "assets", "i10n", "en.json")
TEXT_MAX = 4 * 1024 * 1024
MESSAGE_MAX = 2000

_CODE = re.compile(r"(\d{4})-(\d{4})-(\d{4})-(\d{4})")
_CODED = re.compile(r'\{"coded":\s*"(\d{4}(?:-\d{4}){3})"')
_MSG = re.compile(r'"msg":\s*"(.*?)"\s*(?:,\s*"\w+":[^}]*)?\}\s*$')
_STAMP = r"(?:(\d\d-\d\d \d\d:\d\d:\d\d)\.\d{3}:)?"   # the U1 writes the time before each line
_RAISED = re.compile(_STAMP + r"Raising exception: id:(\d+) index:(\d+) code:(\d+) oneshot:(\d+) level:(\d+)[^,]*, message: (.*)$")
_SHUTDOWN = re.compile(_STAMP + r"Transition to shutdown state: (.*)$")

# Klipper's messages that confuse, each with a page of klipper3d.org; the words for them are
# OrcaOne's own (texts/*.js, faults.klipper.<id>), nothing taken from Klipper's docs (GPL-3.0).
DOCS = "https://www.klipper3d.org/"
PATTERNS = [
    ("timer_too_close", r"Timer too close", "FAQ.html#why-does-klipper-report-errors-i-lost-my-print"),
    ("missed_scheduling", r"Missed scheduling of next ", "FAQ.html#why-does-klipper-report-errors-i-lost-my-print"),
    ("stepper_too_fast", r"Rescheduled timer in the past|Stepper too far in past", "FAQ.html#why-does-klipper-report-errors-i-lost-my-print"),
    ("adc_out_of_range", r"ADC out of range", "Config_checks.html#verify-temperature"),
    ("heater_not_heating", r"Heater \S+ not heating at expected rate", "Config_Reference.html#verify_heater"),
    ("lost_communication", r"Lost communication with MCU", "FAQ.html#i-keep-getting-random-lost-communication-with-mcu-errors"),
    ("homing_timeout", r"Communication timeout during homing", "FAQ.html#i-keep-getting-random-lost-communication-with-mcu-errors"),
    ("mcu_connect", r"Unable to connect|MCU error during connect|Serial connection closed", "FAQ.html#wheres-my-serial-port"),
    ("protocol_error", r"Protocol error", "FAQ.html#how-do-i-upgrade-to-the-latest-software"),
    ("move_out_of_range", r"Move out of range", "Config_Reference.html#stepper"),
    ("must_home", r"Must home axis first", "FAQ.html#why-cant-i-move-the-stepper-before-homing-the-printer"),
    ("no_trigger", r"No trigger on \S+ after full movement", "Config_checks.html#verify-endstops"),
    ("endstop_stuck", r"Endstop \S+ still triggered after retract", "Config_checks.html#verify-endstops"),
    ("probe_early", r"Probe triggered prior to movement", "Config_Reference.html#probe"),
    ("probe_tolerance", r"Probe samples exceed samples_tolerance", "Config_Reference.html#probe"),
    ("tmc_error", r"TMC '[^']+' reports error", "TMC_Drivers.html#why-did-i-get-a-tmc-reports-error-error"),
    ("tmc_bus", r"Unable to (?:read|write) tmc (?:uart|spi) '[^']+' register", "TMC_Drivers.html"),
    ("extrude_cold", r"Extrude below minimum temp", "Config_Reference.html#extruder"),
    ("extrude_limit", r"Extrude only move too long|Move exceeds maximum extrusion", "Config_Reference.html#extruder"),
    ("emergency_stop", r"Shutdown due to (?:M112 command|webhooks request)", "G-Codes.html#firmware_restart"),
    ("unknown_command", r'Unknown command:\s*"', "G-Codes.html"),
    ("config_error", r"Option '[^']+' in section '[^']+' must be specified|is not a valid config section|Unable to parse option|Config error", "Config_Reference.html"),
]
_PATTERNS = [(key, re.compile(pattern), DOCS + doc) for key, pattern, doc in PATTERNS]


def classify(message: str) -> tuple[str | None, str | None]:
    """Which of Klipper's known messages it is, and its page of klipper3d.org."""
    return next(((key, doc) for key, pattern, doc in _PATTERNS if pattern.search(message or "")), (None, None))


def split_coded(text: str | None) -> tuple[str | None, str]:
    """A message as the U1 writes it at a shutdown, {"coded": "0003-0522-0000-0018", "oneshot": 0,
    "msg":"..."} in its first line: the code and the words, without the JSON. The U1 joins the
    words in without escaping them (klippy.py), so a pattern, not json.loads."""
    text = text or ""
    first, _, rest = text.partition("\n")
    code = _CODED.match(first.strip())
    if not code:
        return None, text
    words = _MSG.search(first)
    return code[1], ((words[1] if words else "") + ("\n" + rest if rest else "")).strip()


def _code(level, module, index, number) -> str:
    return f"{int(level):04d}-{int(module):04d}-{int(index):04d}-{int(number):04d}"


def _entry(message: str, code: str | None = None, **more) -> dict:
    """One error as the page shows it: the code in its parts, which Klipper message it is."""
    message = (message or "").strip()
    kind, doc = classify(message)
    parts = _CODE.fullmatch(code or "")
    return {"code": code if parts else None, "level": int(parts[1]) if parts else None, "module": int(parts[2]) if parts else None,
            "index": int(parts[3]) if parts else None, "number": int(parts[4]) if parts else None,
            "message": message[:MESSAGE_MAX], "kind": kind, "doc": doc, **more}


def _exception(found) -> dict | None:
    """An exception as Klipper keeps it ({id, index, code, level, message}), None if it is none."""
    if not isinstance(found, dict) or not all(isinstance(found.get(k), int) for k in ("id", "index", "code")):
        return None
    level = found.get("level") if isinstance(found.get("level"), int) else 0
    return _entry(str(found.get("message") or ""), _code(level, found["id"], found["index"], found["code"]))


def now(host: str) -> dict:
    """What the printer reports right now."""
    found = _get(host, "/printer/objects/query?exception_manager&webhooks&print_stats")["status"]
    manager = found.get("exception_manager")
    webhooks, stats = found.get("webhooks") or {}, found.get("print_stats") or {}
    code, message = split_coded(webhooks.get("state_message"))
    state = webhooks.get("state")
    klipper = {"state": state, **(_entry(message, code) if state in ("shutdown", "error") else {"message": message})}
    return {"codes": isinstance(manager, dict),   # the printer names its errors by code (the U1)
            "klipper": klipper,
            "exceptions": [e for e in map(_exception, (manager or {}).get("exceptions") or []) if e],
            "print": {"state": stats.get("state"), "message": stats.get("message") or None, "exception": _exception(stats.get("exception"))}}


def _from_log(host: str) -> list[dict]:
    """The errors in the last TAIL bytes of klippy.log, oldest first; a log elsewhere or none: none."""
    files = printer_logs.files(host)["files"]
    klippy = sorted((f for f in files if f["group"].endswith("klippy.log")), key=lambda f: -(f["modified"] or 0))
    if not klippy:
        return []
    body = printer_logs.tail(host, klippy[0]["path"], TAIL)
    out = []
    for line in body.decode("utf-8", "replace").splitlines():
        raised = _RAISED.search(line)
        if raised:
            stamp, module, index, number, oneshot, level, message = raised.groups()
            entry = _entry(message, _code(level, module, index, number), stamp=stamp, source="log", oneshot=oneshot == "1",
                           log=klippy[0]["path"])
            # The U1 writes a shutdown twice in the same second, without and then with its code: once.
            if out and out[-1]["code"] is None and (out[-1]["message"], out[-1].get("stamp")) == (entry["message"], stamp):
                out[-1] = entry
            else:
                out.append(entry)
            continue
        down = _SHUTDOWN.search(line)
        if down:
            code, message = split_coded(down[2])
            out.append(_entry(message, code, stamp=down[1], source="log", log=klippy[0]["path"]))
    return out


def _from_console(host: str) -> list[dict]:
    """Klipper's answers starting with "!!" in Moonraker's G-code store, oldest first; not a command
    someone typed ("!!" typed in on the U1's console, 26.09.2026)."""
    store = _get(host, "/server/gcode_store?count=1000").get("gcode_store") or []
    return [_entry(str(e["message"])[2:].strip(), time=e["time"], source="console") for e in store
            if isinstance(e, dict) and e.get("type") == "response" and isinstance(e.get("time"), (int, float))
            and str(e.get("message", "")).startswith("!!")]


def _joined(entries: list[dict]) -> list[dict]:
    """The same error twice in a row (the U1 logs some twice within milliseconds): once, counted."""
    out = []
    for e in entries:
        last = out[-1] if out else None
        if last and (last["code"], last["message"], last.get("stamp"), last.get("source")) == (e["code"], e["message"], e.get("stamp"), e.get("source")):
            last["count"] = last.get("count", 1) + 1
        else:
            out.append(e)
    return out


def history(host: str) -> list[dict]:
    """What came before, newest first: klippy.log and the console, each read as far as it goes."""
    out = []
    for read in (_from_log, _from_console):
        try:
            out += _joined(read(host))[::-1]
        except CameraError:
            pass   # no klippy.log in "logs", or no G-code store: the other source still counts
    return out[:HISTORY]


_texts_cache = {"key": None, "texts": {}}


def snapmaker_texts() -> dict:
    """Snapmaker's words per code (16 digits) from the device panel of the newest Snapmaker Orca on
    this computer, {} without one; read again only when the file changed."""
    found = []
    for instance in instances.discover():
        if instance.slicer != "Snapmaker_Orca":
            continue
        path = instance.data_dir.joinpath(*TEXT_FILE)
        try:
            stat = path.stat()
        except OSError:
            continue
        if stat.st_size <= TEXT_MAX:
            found.append((stat.st_mtime, str(path)))
    if not found:
        return {}
    key = max(found)
    if _texts_cache["key"] != key:
        try:
            data = json.loads(open(key[1], encoding="utf-8").read())
        except (OSError, ValueError):
            return {}
        texts = {}
        for name, value in data.items() if isinstance(data, dict) else []:
            part = re.fullmatch(r"error_(\d{16})_(title|desc)", name)
            if part and isinstance(value, str):
                texts.setdefault(part[1], {})[part[2]] = value[:MESSAGE_MAX]
        _texts_cache.update(key=key, texts=texts)
    return _texts_cache["texts"]


def read(host: str) -> dict:
    """For the page: now, before, and Snapmaker's words for the codes among them."""
    current, before = now(host), history(host)
    codes = {e["code"] for e in [current["klipper"], *current["exceptions"], current["print"]["exception"] or {}, *before] if e.get("code")}
    words = snapmaker_texts() if codes else {}
    return {**current, "history": before, "texts": {c: words[c.replace("-", "")] for c in codes if c.replace("-", "") in words}}
