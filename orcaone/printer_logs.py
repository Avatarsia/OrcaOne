"""The logs of a printer, for the page "Logs" of the printer part (the user's wish of 26.09.2026):
Klipper's, Moonraker's and on the U1 also the display's and the system's, from Moonraker's shared
folder "logs", read only. Every line as written (the user: "1:1", no masking, no filter while
loading), only marked for its colour: starts, shutdowns, errors.

Large files come in pieces: Moonraker answers a Range with 206, from the end too (checked on the U1
26.09.2026: 48 files, 384 MB, klippy.log 10 MB). A search runs through the whole file here and
sends the page only the hits with their context.
"""

import collections
import re
import time

from . import printer_files
from .camera import CameraError

WINDOW = 256 * 1024      # bytes a view reads at once: some thousand lines
BACK = 1024 * 1024       # bytes per step while looking for the last start from the end
BACK_STEPS = 20          # so at most 20 MB back
HITS = 200               # a search stops after this many hits
CONTEXT_MAX = 10         # lines before and after a hit
QUERY_MAX = 200          # characters of a search; Python's re has no time limit
SEARCH_SECONDS = 60      # then the answer says it is not complete
LINE_MAX = 4000          # characters of one line on the page, the rest cut

# What a line is, only for its colour; the page shows every line. From Klipper's and Moonraker's
# sources (klippy.py, mcu.py, queuelogger.py, loghelper.py) and the U1's klippy.log (26.09.2026).
_KINDS = (
    ("start", re.compile(r"Start printer at|Restarting printer|Log rollover at|---- Log Start")),
    ("shutdown", re.compile(r"Transition to shutdown state|MCU '[^']*' shutdown|Lost communication with MCU|Shutdown due to")),
    ("error", re.compile(r"Traceback|Unhandled exception|Config error|Protocol error|MCU error|Internal error|Raising exception|^!! |\] - Error")),
)
_START = re.compile(rb"Start printer at|Restarting printer|Log rollover at|---- Log Start")
# Older parts of a log: klippy.log.1, klippy.log.2026-09-25, gui.log.0, on the U1 also unisrv.1.log.
_ROTATED = (re.compile(r"(?P<base>.+\.log)\.(?:\d{1,3}|\d{4}-\d\d-\d\d)"), re.compile(r"(?P<head>.+?)\.\d{1,3}(?P<tail>\.log)"),
            re.compile(r"(?P<base>syslog)\.\d{1,3}"))


def _kind(text: str) -> str:
    return next((kind for kind, pattern in _KINDS if pattern.search(text)), "")


def _group(path: str) -> str:
    """The log a file belongs to: its own name, or that of the log it is an older part of."""
    for pattern in _ROTATED:
        found = pattern.fullmatch(path)
        if found:
            return found["base"] if "base" in pattern.groupindex else found["head"] + found["tail"]
    return path


def files(host: str) -> dict:
    """The files of the folder "logs" with the log they belong to, newest first in each; Klipper's
    and Moonraker's logs first, as they are the ones asked for most."""
    found = printer_files.listing(host, "logs")["files"]
    for f in found:
        f["group"] = _group(f["path"])
    order = lambda g: (0 if "klippy" in g else 1 if "moonraker" in g else 2, g.lower())
    found.sort(key=lambda f: (order(f["group"]), -(f["modified"] or 0)))
    return {"files": found}


def _piece(host: str, path: str, byte_range: str) -> tuple[bytes, int, int]:
    """A piece of the file: its bytes, where it starts and the size of the file. Beyond the end
    (nothing new while following): no bytes, and the size Moonraker names."""
    try:
        response = printer_files.open_file(host, "logs", path, byte_range)
    except CameraError as exc:
        if exc.code != "range_unsatisfiable":
            raise
        size = re.fullmatch(r"bytes \*/(\d+)", exc.detail or "")
        return b"", 0, int(size[1]) if size else 0
    with response:
        body = response.read()
        span = re.fullmatch(r"bytes (\d+)-\d+/(\d+)", response.headers.get("Content-Range") or "")
    return (body, int(span[1]), int(span[2])) if span else (body, 0, len(body))


def _lines(body: bytes, first: int, size: int) -> tuple[list[dict], int, int]:
    """The whole lines of a piece with their offset in the file: the cut one at its start goes
    (unless the piece starts the file), and so does the one at its end still being written."""
    start = 0 if first == 0 else body.find(b"\n") + 1
    if first > 0 and start == 0:
        return [], first, first   # no line ends in this piece
    stop = body.rfind(b"\n") + 1 if not body.endswith(b"\n") else len(body)
    out, at = [], first + start
    for raw in body[start:stop].split(b"\n")[:-1] if stop > start else []:
        text = raw.decode("utf-8", "replace").rstrip("\r")
        out.append({"at": at, "text": text[:LINE_MAX] + ("…" if len(text) > LINE_MAX else ""), "kind": _kind(text)})
        at += len(raw) + 1
    return out, first + start, first + stop


def read(host: str, path: str, start: int | None = None, end: int | None = None) -> dict:
    """A view of the log: its end, or before end ("older"), or from start (a jump, "newer", or
    following). from and next: where the lines shown start and where the next ones would."""
    if (start is not None and start < 0) or (end is not None and end < 0):
        raise CameraError("file_invalid")
    if start is not None:
        # One byte earlier: start is where a line begins, and the piece drops what it cuts at its start.
        before = max(0, start - 1)
        byte_range = f"bytes={before}-{before + WINDOW - 1}"
    elif end is not None:
        if end == 0:
            return {"path": path, "lines": [], "from": 0, "next": 0, "size": None}
        byte_range = f"bytes={max(0, end - WINDOW)}-{end - 1}"
    else:
        byte_range = f"bytes=-{WINDOW}"
    body, first, size = _piece(host, path, byte_range)
    if not body:
        at = start if start is not None else size
        return {"path": path, "lines": [], "from": at, "next": at, "size": size}
    lines, begin, after = _lines(body, first, size)
    return {"path": path, "lines": lines, "from": begin, "next": after, "size": size}


def tail(host: str, path: str, count: int) -> bytes:
    """The last count bytes of a log, from where its first whole line begins (orcaone/errors.py)."""
    body, first, _ = _piece(host, path, f"bytes=-{count}")
    return body[body.find(b"\n") + 1:] if first > 0 else body


def last_start(host: str, path: str) -> int | None:
    """Where the last start of Klipper or Moonraker begins, looked for from the end back, BACK at a
    time with a little overlap so a mark cut by a piece is found; None if there is none."""
    end = None
    for _ in range(BACK_STEPS):
        byte_range = f"bytes=-{BACK}" if end is None else f"bytes={max(0, end - BACK)}-{end - 1}"
        body, first, size = _piece(host, path, byte_range)
        found = list(_START.finditer(body))
        if found:
            line = body.rfind(b"\n", 0, found[-1].start())
            if line >= 0 or first == 0:
                return first + line + 1
            end = first + found[-1].end()   # its line began before this piece: the next one holds it
            continue
        if first == 0:
            return None
        end = first + min(200, BACK // 2)   # the next piece reaches a little into this one
    return None


def search(host: str, path: str, query, regex: bool = False, context: int = 0) -> dict:
    """The whole file searched here, line by line: plain text or a regular expression, both
    regardless of case; the hits with context lines around them, overlapping ones joined. At most
    HITS hits and SEARCH_SECONDS, then complete is false."""
    if not isinstance(query, str) or not query.strip() or len(query) > QUERY_MAX:
        raise CameraError("log_query_invalid")
    try:
        pattern = re.compile(query if regex else re.escape(query), re.IGNORECASE)
    except re.error:
        raise CameraError("log_query_invalid") from None
    context = max(0, min(CONTEXT_MAX, int(context)))
    groups, before, current, after = [], collections.deque(maxlen=context), None, 0
    hits, at, number, complete, began = 0, 0, 0, True, time.monotonic()
    response = printer_files.open_file(host, "logs", path)
    with response:
        rest = b""
        while complete:
            block = response.read(65536)
            parts = (rest + block).split(b"\n")
            rest = parts.pop() if block else b""
            for raw in parts if block or parts[0] else []:
                number += 1
                text = raw.decode("utf-8", "replace").rstrip("\r")
                line = {"at": at, "n": number, "text": text[:LINE_MAX] + ("…" if len(text) > LINE_MAX else ""), "kind": _kind(text)}
                at += len(raw) + 1
                # Only what the page shows: a regular expression like ".*x" takes quadratic time on a
                # line of megabytes, and one call cannot be stopped at SEARCH_SECONDS.
                if pattern.search(text[:LINE_MAX]):
                    hits += 1
                    line["hit"] = True
                    if current is None:
                        current = list(before)
                        groups.append({"lines": current})
                    current.append(line)
                    after = context
                    before.clear()
                    if hits >= HITS:
                        complete = False
                        break
                elif current is not None and after > 0:
                    current.append(line)
                    after -= 1
                else:
                    current = None
                    before.append(line)
            if not block:
                break
            if time.monotonic() - began > SEARCH_SECONDS:
                complete = False
    return {"groups": groups, "hits": hits, "complete": complete, "scanned": at}
