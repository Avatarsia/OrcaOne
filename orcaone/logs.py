"""The slicers' own log files (page "Logs" under "Technik"), read only.

Both slicers write one file per start into <data dir>/log/ (Snapmaker Orca
"2026-09-23-09-24-20.log.0", OrcaSlicer "debug_Wed_Sep_23_08_55_19_55230.log.0"), each entry as
"[warning]\t2026-09-23 09:24:21.294249[Thread 0x00007e678804e700]:text". Lines without that start
continue the entry before, e.g. the system information OrcaSlicer writes at the start.
OrcaSlicer's files reach 10 MB, so the filter runs here and only the last entries go to the page.
"""

import re
from pathlib import Path

LIMIT = 2000               # entries sent to the page, the last ones
QUERY_MAX = 200   # characters of a regular expression; Python's re has no time limit
TEXT_MAX = 2000            # characters of one entry sent; OrcaSlicer logs whole profile lists (2.7 MB)
MAX_BYTES = 20 * 1024 * 1024  # of a larger file only its end is read
SHOW = {"all": None, "problems": {"fatal", "error", "warning"}, "errors": {"fatal", "error"}}
# A secret in a line, from its name to the end of the line: Snapmaker Orca logs the MQTT login of
# the U1 at level info ("…, username: …, password: …", MQTT.cpp), and any device in the LAN may
# read the logs (the user's wish of 25.09.2026).
_SECRET = re.compile(r"(\b(?:password|passwd|api_?key|access_?code|token|secret)\b[\"']?\s*[:=]\s*).*", re.IGNORECASE)
_ENTRY = re.compile(r"\[(trace|debug|info|warning|error|fatal)\]\t(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d)[.\d]*(?:\[Thread [^\]]*\])?:?")


class LogError(Exception):
    """An error code for the API: log_not_found or log_filter_invalid."""


def files(data_dir: Path) -> list[dict]:
    """The files in log/, newest first; started is the time of the first entry."""
    found = []
    try:
        children = list((data_dir / "log").iterdir())
    except OSError:
        return []
    for child in children:
        try:
            # A link could point anywhere; the slicers write plain files.
            if child.is_symlink() or not child.is_file():
                continue
            stat = child.stat()
            with child.open("rb") as fh:
                first = _ENTRY.match(fh.read(200).decode("utf-8", "replace"))
        except OSError:
            continue
        found.append({"name": child.name, "size": stat.st_size, "modified": stat.st_mtime,
                      "started": first.group(2) if first else None})
    return sorted(found, key=lambda f: f["modified"], reverse=True)


def read(data_dir: Path, name: str, show: str = "all", query: str = "", limit: int = LIMIT, regex: bool = False) -> dict:
    """The entries of one file, counted per level, then filtered by level and text (all words, or
    with regex a regular expression, the user's wish of 26.09.2026; case never matters); the last
    `limit` of them, a long text cut to TEXT_MAX with "more" = the characters left out. The name
    has to be one of files(), so nothing outside log/ can be read."""
    if show not in SHOW:
        raise LogError("log_filter_invalid")
    pattern = None
    if regex and query:
        try:
            pattern = re.compile(query, re.IGNORECASE) if len(query) <= QUERY_MAX else None
        except re.error:
            pattern = None
        if pattern is None:
            raise LogError("log_query_invalid")
    if name not in {f["name"] for f in files(data_dir)}:
        raise LogError("log_not_found")
    path = data_dir / "log" / name
    try:
        with path.open("rb") as fh:
            size = fh.seek(0, 2)
            cut = size > MAX_BYTES
            fh.seek(size - MAX_BYTES if cut else 0)
            raw = fh.read()
    except OSError:
        raise LogError("log_not_found") from None
    lines = [_SECRET.sub(r"\1***", line) for line in raw.decode("utf-8", "replace").splitlines()]
    if cut:
        lines = lines[1:]  # begins in the middle of a line

    entries = []
    for n, line in enumerate(lines, 1):
        match = _ENTRY.match(line)
        if match:
            entries.append({"n": n, "level": match.group(1), "time": match.group(2), "text": line[match.end():]})
        elif entries:
            entries[-1]["text"] += "\n" + line
        else:
            entries.append({"n": n, "level": "", "time": "", "text": line})
    counts = {}
    for entry in entries:
        counts[entry["level"]] = counts.get(entry["level"], 0) + 1

    levels, words = SHOW[show], query.lower().split()
    # A regular expression only on what is sent: ".*timeout" on OrcaSlicer's profile list (2.7 MB in
    # one entry) takes hours and keeps a thread of the server busy meanwhile.
    matched = [e for e in entries if (levels is None or e["level"] in levels)
               and (pattern.search(e["text"][:TEXT_MAX]) if pattern else all(w in e["text"].lower() for w in words))]
    shown = [dict(e, text=e["text"][:TEXT_MAX], more=len(e["text"]) - TEXT_MAX) if len(e["text"]) > TEXT_MAX else e
             for e in matched[-limit:]]
    return {"name": name, "size": size, "cut": cut, "counts": counts, "total": len(entries),
            "matched": len(matched), "entries": shown}
