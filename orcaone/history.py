"""The page "Diagramme" (the user's wishes of 27.09.2026): OrcaOne records every printer with an address
itself, as Moonraker keeps only the temperatures of the last 20 minutes. live.py holds a connection to
each of them, also without a page watching, and hands its shaped values (monitor.shape) here once a
second; this module turns them into one row of numbers and appends it to
data/history/<printer>-<hash>/<day>.csv, a file per printer and local day. Works with every Klipper
printer with Moonraker; the U1 only adds its four heads and which of them prints.

The format is plain CSV: a line "#t,<series>,…" opens a segment (a new one whenever the printer's set of
series changes, say after a Klipper restart, and at the top of every day's file), then rows "<unix
seconds>,<value>,…", an empty field for a value missing at that moment. "#file,<unix seconds>,<name>"
marks the print file from its start on, so a moment and its file_position lead to a line in "2D
Ansicht" and "3D Ansicht"; a print over midnight marks it again in the new day's file, with its start. A day that is over is packed
with gzip. Kept KEEP_DAYS days; the two last prints of each print file come later with the view "Druck".
While the printer prints or heats a row every STEP seconds, at rest every IDLE_STEP seconds (the user's
decisions of 27.09.2026). Read only towards the printer: this only listens.
"""

import gzip
import hashlib
import math
import re
import shutil
import time
import zlib
from datetime import date, timedelta
from pathlib import Path

from . import settings

STEP = 1           # s between two rows while the printer prints or heats
IDLE_STEP = 10     # s between two rows at rest
KEEP_DAYS = 7      # days of rows kept (the user's decision of 27.09.2026)
SECONDS_MAX = KEEP_DAYS * 86400
POINTS_MAX = 5000  # time steps one answer holds at most; more are thinned to the least and most per step
GAP = 3 * IDLE_STEP  # s without a row that the charts show as a gap: the printer did not answer
TAIL = 65536       # bytes at the end of a day's file enough to find its newest row

# printer: {"t": time of its last row, "names": its series, "counters": {name: bytes}, "clock": Moonraker's
# time of those counters, "rates": the traffic last computed, "file": the print file marked last}
_last: dict[str, dict] = {}
_tidied: dict[Path, date] = {}      # folder: the day it was tidied last


def folder(printer: str) -> Path:
    """data/history/<name>-<hash>: the name readable, the hash keeping two names apart that read alike."""
    safe = re.sub(r"[^A-Za-z0-9._-]+", "_", printer).strip("._")[:40] or "printer"
    return settings.DATA_DIR / "history" / f"{safe}-{hashlib.sha1(printer.encode('utf-8')).hexdigest()[:6]}"


def values(monitor: dict) -> dict[str, float]:
    """The numbers of one moment by series name, from live.py's shaped values; power and fans in %."""
    out = {}

    def put(name, value, scale=1):
        if isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value):
            out[name.replace(",", " ")] = round(value * scale, 2)

    for t in monitor.get("temperatures") or []:
        name = t.get("name")
        put(f"temp:{name}", t.get("temp"))
        put(f"target:{name}", t.get("target"))
        put(f"power:{name}", t.get("power"), 100)
    for f in monitor.get("fans") or []:
        put(f"fan:{f.get('name')}", f.get("speed"), 100)
        put(f"rpm:{f.get('name')}", f.get("rpm"))
    motion, job, system = monitor.get("motion") or {}, monitor.get("job") or {}, monitor.get("system") or {}
    put("speed", motion.get("speed"))
    put("flow", motion.get("flow"))
    position = motion.get("position") or []
    put("z", position[2] if len(position) > 2 else None)
    put("speed_factor", job.get("speed_factor"), 100)
    put("flow_factor", job.get("flow_factor"), 100)
    put("layer", job.get("layer"))
    put("progress", job.get("progress"), 100)
    if _printing(monitor):
        # Where in the print file Klipper reads (bytes): links a moment to its line in "2D Ansicht" and
        # "3D Ansicht" (the user's idea of 27.09.2026); about a second or two ahead of the nozzle. Only
        # while printing: afterwards it stays at the end of the last file.
        put("file_position", job.get("file_position"))
    active = job.get("active")
    if isinstance(active, str) and re.fullmatch(r"extruder\d*", active):
        put("head", int(active[8:] or 0) + 1)   # 1 to 4 on the U1: which head prints
    put("cpu", system.get("cpu"))
    put("cpu_temp", system.get("cpu_temp"))
    memory = system.get("memory") or {}
    if memory.get("total"):
        put("memory", (memory.get("used") or 0) / memory["total"], 100)
    return out


def _printing(monitor: dict) -> bool:
    return (monitor.get("job") or {}).get("state") in ("printing", "paused")


def _busy(monitor: dict) -> bool:
    """Prints, pauses or heats: then a row every STEP seconds."""
    return _printing(monitor) or any((t.get("target") or 0) > 0 for t in monitor.get("temperatures") or [])


def sample(printer: str, monitor: dict, now: float | None = None) -> dict | None:
    """One row for the printer if one is due, written and returned as {"t", "v": {series: value}}, else None."""
    now = time.time() if now is None else now
    last = _last.setdefault(printer, {"t": None, "names": None, "counters": {}, "clock": None, "rates": {}, "file": None,
                                      "started": None, "day": None})
    if last["t"] is not None and now - last["t"] < (STEP if _busy(monitor) else IDLE_STEP) - 0.05:
        return None
    row = values(monitor)
    row.update(_traffic(last, monitor.get("system") or {}))
    t = round(now)
    day = date.fromtimestamp(t)
    names = sorted(row)
    lines = []
    job = monitor.get("job") or {}
    file = job.get("file") if _printing(monitor) and isinstance(job.get("file"), str) else None
    # Each day's file readable on its own (review 27.09.2026): its header, and a print going on its mark
    # with the time the print began, so the page draws no second start at midnight.
    started = last["started"] if file and file == last["file"] else t
    if file and (file != last["file"] or day != last["day"]):
        lines.append(f"#file,{started},{file}")
    if names != last["names"] or day != last["day"]:
        lines.append("#t," + ",".join(names))
    lines.append(f"{t}," + ",".join(_text(row[n]) for n in names))
    if not _write(printer, day, lines):
        return None   # a full disk or a locked file: the next second tries again
    last.update(t=now, names=names, file=file, started=started if file else None, day=day)
    return {"t": t, "v": row}


def _traffic(last: dict, system: dict) -> dict:
    """Bytes per second per interface over Moonraker's own clock of its counters (system.time): its notes
    come once a second, and dividing by OrcaOne's clock gave 0 and then double (review 27.09.2026). No new
    counters since the last row: the rate of that row again."""
    counters = {f"{way}:{i.get('name')}".replace(",", " "): i.get(way)
                for i in system.get("network") or [] for way in ("rx", "tx") if isinstance(i.get(way), (int, float))}
    clock = system.get("time")
    if not isinstance(clock, (int, float)) or clock == last["clock"]:
        return dict(last["rates"]) if clock == last["clock"] else {}
    rates = {}
    if last["clock"] is not None and clock > last["clock"]:
        for name, value in counters.items():
            before = last["counters"].get(name)
            if before is not None and value >= before:
                rates[name] = round((value - before) / (clock - last["clock"]), 1)
    last.update(counters=counters, clock=clock, rates=rates)
    return rates


def _write(printer: str, day: date, lines: list[str]) -> bool:
    """Appends lines to the printer's file of that day; the first write of a day tidies the folder."""
    where = folder(printer)
    try:
        where.mkdir(parents=True, exist_ok=True)
        today = date.today()
        if _tidied.get(where) != today:
            _tidy(where, today)
            _tidied[where] = today
        with open(where / f"{day.isoformat()}.csv", "a", encoding="utf-8", newline="\n") as f:
            f.write("\n".join(lines) + "\n")
        return True
    except OSError:
        return False


def backfill(printer: str, store: dict, now: float | None = None) -> int:
    """Moonraker's temperatures of the last 20 minutes (server.temperature_store: per heater and sensor up
    to 1200 values a second apart, the last one now, without times) for the seconds after the last row
    on record, say after OrcaOne or the printer was off. Returns the rows written."""
    now = time.time() if now is None else now
    columns = {}
    for name, found in (store or {}).items():
        if not isinstance(found, dict):
            continue
        for key, kind, scale in (("temperatures", "temp", 1), ("targets", "target", 1), ("powers", "power", 100)):
            if isinstance(found.get(key), list) and found[key]:
                columns[f"{kind}:{name}".replace(",", " ")] = (found[key], scale)
    if not columns:
        return 0
    length = max(len(v) for v, _ in columns.values())
    last = _last_on_record(printer, now)
    days = {}
    for i in range(length):
        t = round(now - (length - 1 - i))
        if last is not None and t <= last:
            continue
        row = {}
        for name, (found, scale) in columns.items():
            j = i - (length - len(found))
            v = found[j] if j >= 0 else None
            if isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v):
                row[name] = round(v * scale, 2)
        if row:
            days.setdefault(date.fromtimestamp(t), []).append((t, row))
    written = 0
    for day, rows in days.items():
        names = sorted({n for _, r in rows for n in r})
        lines = ["#t," + ",".join(names)] + [f"{t}," + ",".join(_text(r[n]) if n in r else "" for n in names) for t, r in rows]
        if _write(printer, day, lines):
            written += len(rows)
    if written:
        last_row = _last.get(printer)
        if last_row:
            last_row["names"] = None   # the next live row opens a segment of its own
    return written


def _last_on_record(printer: str, now: float) -> int | None:
    """The time of the newest row on record: from this run, else from the end of today's or yesterday's
    file (yesterday's only while not packed yet), so nothing is written twice around midnight."""
    found = []
    known = (_last.get(printer) or {}).get("t")
    if known is not None:
        found.append(round(known))
    today = date.fromtimestamp(now)
    for day in (today, today - timedelta(days=1)):
        path = folder(printer) / f"{day.isoformat()}.csv"
        if path.exists():
            found.append(_newest(path))
    found = [t for t in found if t is not None]
    return max(found) if found else None


def _newest(path: Path) -> int | None:
    """The time of the last row of a day's file, read from its end only."""
    try:
        with open(path, "rb") as f:
            f.seek(max(0, path.stat().st_size - TAIL))
            tail = f.read().decode("utf-8", "replace").splitlines()
    except OSError:
        return None
    for line in reversed(tail):
        head = line.split(",", 1)[0]
        if head.isdigit():
            return int(head)
    return None


def _text(value: float) -> str:
    return str(int(value)) if value == int(value) else repr(value)


def _tidy(where: Path, today: date) -> None:
    """The days before today packed (added to a packed day that exists), those older than KEEP_DAYS gone.
    The day's file is renamed first: Windows refuses that while a page reads it, and then nothing happens,
    where packing it and failing to delete it would leave its rows twice (review 27.09.2026)."""
    for path in where.glob("*.csv*"):
        try:
            day = date.fromisoformat(path.name[:10])
        except ValueError:
            continue
        try:
            if day < today - timedelta(days=KEEP_DAYS):
                path.unlink(missing_ok=True)
            elif day < today and path.suffix in (".csv", ".packing"):
                packing = path if path.suffix == ".packing" else path.rename(path.with_name(path.name + ".packing"))
                # gzip reads several members one after the other: a late row of a packed day stays.
                with open(packing, "rb") as raw, gzip.open(where / f"{day.isoformat()}.csv.gz", "ab") as out:
                    shutil.copyfileobj(raw, out)
                packing.unlink()
        except OSError:
            continue   # a file in use: the next day tries again


def _rows(path: Path, files: list | None = None, since: float = -math.inf, until: float = math.inf):
    """(time, {series: value}) of one day's file between since and until, packed or not; the print file
    marks into files. A row outside is skipped before its values are read: a busy day has 86400."""
    opener = gzip.open if path.suffix == ".gz" else open
    names = []
    with opener(path, "rt", encoding="utf-8", errors="replace") as f:
        for line in f:
            line = line.rstrip("\n")
            if line.startswith("#file,"):
                stamp, _, name = line[6:].partition(",")
                if files is not None and stamp.isdigit():
                    files.append((int(stamp), name))
                continue
            parts = line.split(",")
            if parts[0] == "#t":
                names = parts[1:]
            elif names and len(parts) == len(names) + 1:
                try:
                    t = int(parts[0])
                    if since <= t <= until:
                        yield t, {n: float(v) for n, v in zip(names, parts[1:]) if v}
                except ValueError:
                    continue   # a line cut off when the computer went down


def read(printer: str, since: float, until: float | None = None, points: int = POINTS_MAX) -> dict:
    """The rows between since and until as columns, {"t": [...], "series": {name: [...]}, "files": [[t, name]]},
    None where a series had no value or the printer did not answer (a gap longer than GAP gets a row of
    None, so a chart breaks its line there). A span longer than `points` seconds is thinned while reading,
    per time step to its least and most value (two rows per step, in the order they came), so a spike stays
    visible and seven days never sit in memory as rows."""
    now = time.time()
    until = now if until is None else min(until, now + 86400)
    since = max(since, until - SECONDS_MAX, now - SECONDS_MAX - 86400)   # older days are gone anyway
    if since > until:
        return {"t": [], "series": {}, "files": []}
    points = max(10, min(points, POINTS_MAX))
    steps = points // 2
    width = (until - since) / steps if until - since > points * STEP else None
    rows, buckets, files = [], {}, []
    where = folder(printer)
    day = date.fromtimestamp(since)
    while day <= date.fromtimestamp(until):
        for path in (where / f"{day.isoformat()}.csv.gz", where / f"{day.isoformat()}.csv"):
            if not path.exists():
                continue
            try:
                for t, v in _rows(path, files, since, until):
                    if width is None:
                        rows.append((t, v))
                        continue
                    # Per series its least and most value with their times.
                    least, most, seen = buckets.setdefault(min(int((t - since) // width), steps - 1), ({}, {}, []))
                    seen.append(t)
                    for n, x in v.items():
                        if n not in least or x < least[n][0]:
                            least[n] = (x, t)
                        if n not in most or x > most[n][0]:
                            most[n] = (x, t)
            except (OSError, EOFError, zlib.error):
                pass   # a packed day cut off or broken: the rest of the answer stays
        day += timedelta(days=1)
    if width is not None:
        for step in sorted(buckets):
            least, most, seen = buckets[step]
            start = since + step * width
            # The one that came first in the first row, so a falling curve does not become a saw (review 27.09.2026).
            first = {n: least[n][0] if least[n][1] <= most[n][1] else most[n][0] for n in least}
            second = {n: most[n][0] if least[n][1] <= most[n][1] else least[n][0] for n in least}
            rows += [(max(min(seen), round(start)), first), (min(max(seen), round(start + width / 2)), second)]
    rows.sort(key=lambda r: r[0])
    gap = max(GAP, 2.5 * width) if width else GAP
    t_out, v_out = [], []
    for t, v in rows:
        if t_out and t - t_out[-1] > gap:
            t_out.append(t_out[-1] + 1)
            v_out.append({})
        t_out.append(t)
        v_out.append(v)
    names = sorted({n for v in v_out for n in v})
    files = [list(f) for f in sorted(set(files)) if f[0] <= until]   # a print over midnight is marked in both days
    return {"t": t_out, "series": {n: [v.get(n) for v in v_out] for n in names}, "files": files}
