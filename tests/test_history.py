"""The recording for the page "Diagramme" (orcaone/history.py, live.recording): rows from the shaped live
values, written per printer and day into data/history/ of the test's temporary folder, read back and
thinned; never a real printer."""

import asyncio
import gzip
import json
import time
from datetime import date, datetime, timedelta

from conftest import call
from orcaone import history, live

# As monitor.shape gives them, made up: the U1 printing with its second head.
MONITOR = {
    "temperatures": [{"name": "extruder", "temp": 219.6, "target": 220, "power": 0.34},
                     {"name": "heater_bed", "temp": 64.9, "target": 65, "power": 0.2},
                     {"name": "temperature_sensor cavity", "temp": 30, "target": None, "power": None}],
    "fans": [{"name": "fan", "speed": 0.5, "rpm": 6000}, {"name": "heater_fan power_fan", "speed": 1.0, "rpm": None}],
    "motion": {"speed": 120.5, "flow": 9.8, "position": [10, 20, 1.2]},
    "job": {"state": "printing", "speed_factor": 1.0, "flow_factor": 0.95, "layer": 12, "progress": 0.25,
            "active": "extruder1", "file_position": 12345},
    "system": {"cpu": 12.5, "cpu_temp": 41, "memory": {"total": 1000, "used": 250}, "time": 1000.0,
               "network": [{"name": "wlan0", "rx": 1000, "tx": 500}]},
}
IDLE = {**MONITOR, "job": {"state": "standby"}, "temperatures": [{"name": "extruder", "temp": 25, "target": 0, "power": 0}]}


def at(day: date, hour: int = 12, second: int = 0) -> float:
    return datetime(day.year, day.month, day.day, hour, 0, 0).timestamp() + second


def test_one_moment_as_numbers():
    assert history.values(MONITOR) == {
        "temp:extruder": 219.6, "target:extruder": 220, "power:extruder": 34.0,
        "temp:heater_bed": 64.9, "target:heater_bed": 65, "power:heater_bed": 20.0,
        "temp:temperature_sensor cavity": 30,
        "fan:fan": 50.0, "rpm:fan": 6000, "fan:heater_fan power_fan": 100.0,
        "speed": 120.5, "flow": 9.8, "z": 1.2, "speed_factor": 100.0, "flow_factor": 95.0, "layer": 12,
        "progress": 25.0, "file_position": 12345, "head": 2, "cpu": 12.5, "cpu_temp": 41, "memory": 25.0}


def test_rows_every_second_while_busy_every_ten_at_rest(data_dir):
    today = date.today()
    t0 = at(today)
    assert history.sample("U1", MONITOR, t0)["v"]["temp:extruder"] == 219.6
    assert history.sample("U1", MONITOR, t0 + 0.5) is None
    # Bytes per second over Moonraker's clock of its counters (0.8 s here), not over OrcaOne's.
    traffic = {**MONITOR, "system": {**MONITOR["system"], "time": 1000.8, "network": [{"name": "wlan0", "rx": 3000, "tx": 900}]}}
    row = history.sample("U1", traffic, t0 + 1)
    assert (row["v"]["rx:wlan0"], row["v"]["tx:wlan0"]) == (2500.0, 500.0)
    # No new counters since: the same rate again, not 0.
    assert history.sample("U1", traffic, t0 + 2)["v"]["rx:wlan0"] == 2500.0
    assert history.sample("U1", IDLE, t0 + 5) is None
    assert history.sample("U1", IDLE, t0 + 12)["t"] == round(t0 + 12)
    lines = (history.folder("U1") / f"{today.isoformat()}.csv").read_text(encoding="utf-8").splitlines()
    # A new segment when the set of series changes: the first row, the one with traffic, the idle one.
    assert [line.startswith("#t,") for line in lines] == [True, False, True, False, False, True, False]
    assert lines[-1].startswith(f"{round(t0 + 12)},")


def test_read_back_thinned_packed_and_kept_seven_days(data_dir):
    today = date.today()
    old, yesterday = today - timedelta(days=9), today - timedelta(days=1)
    history.sample("U1", MONITOR, at(old))
    for s in range(0, 600):
        hot = {**MONITOR, "temperatures": [{"name": "extruder", "temp": 200 + (s == 300) * 30, "target": 220, "power": 0.5}]}
        history.sample("U1", hot, at(yesterday, second=s))
    history._tidied.clear()   # a new day for OrcaOne: its first row tidies the folder
    history.sample("U1", MONITOR, at(today))
    where = history.folder("U1")
    # The first row of a day packs the days before and drops those older than KEEP_DAYS.
    assert sorted(p.name for p in where.iterdir()) == [f"{yesterday.isoformat()}.csv.gz", f"{today.isoformat()}.csv"]
    with gzip.open(where / f"{yesterday.isoformat()}.csv.gz", "rt", encoding="utf-8") as f:
        assert f.readline().startswith("#t,")
    found = history.read("U1", at(yesterday), at(yesterday, second=599))
    assert len(found["t"]) == 600 and found["series"]["temp:extruder"][300] == 230
    assert found["series"]["temp:extruder"][:2] == [200, 200]
    # Thinned: two rows per step, the least and the most, so the spike stays.
    thin = history.read("U1", at(yesterday), at(yesterday, second=599), points=20)
    assert len(thin["t"]) <= 20 and max(thin["series"]["temp:extruder"]) == 230 and min(thin["series"]["temp:extruder"]) == 200
    assert thin["t"] == sorted(thin["t"])
    assert history.read("Unbekannt", at(yesterday), at(today)) == {"t": [], "series": {}, "files": []}


def test_the_gap_filled_from_moonraker(data_dir):
    """server.temperature_store: per heater and sensor the last values a second apart, the last one now;
    written for the seconds after the newest row on record only, as a segment of its own."""
    today = date.today()
    now = at(today, second=600)
    history.sample("U1", MONITOR, now - 100)
    store = {"extruder": {"temperatures": [200, 210, 215, 218, 219.6], "targets": [220] * 5, "powers": [1, 0.9, 0.6, 0.4, 0.34]},
             "temperature_sensor cavity": {"temperatures": [30, 30, 31]}, "tmc2240 stepper_x": {"temperatures": [None, 41]}}
    assert history.backfill("U1", store, now) == 5
    found = history.read("U1", now - 200, now)
    # 96 s without a row between: a row of None there, so the charts break their lines.
    assert found["t"] == [round(now - 100), round(now - 99)] + [round(now - k) for k in (4, 3, 2, 1, 0)]
    assert found["series"]["temp:extruder"] == [219.6, None, 200, 210, 215, 218, 219.6]
    assert found["series"]["power:extruder"][2:] == [100, 90, 60, 40, 34]
    assert found["series"]["temp:temperature_sensor cavity"][2:] == [None, None, 30, 30, 31]
    assert found["series"]["temp:tmc2240 stepper_x"][2:] == [None, None, None, None, 41]
    # Nothing twice: the seconds on record now are left alone.
    assert history.backfill("U1", store, now) == 0
    # The next live row opens a segment of its own again.
    history.sample("U1", MONITOR, now + 1)
    lines = (history.folder("U1") / f"{today.isoformat()}.csv").read_text(encoding="utf-8").splitlines()
    assert sum(line.startswith("#t,") for line in lines) == 3


def test_the_print_file_marked_and_where_klipper_reads(data_dir):
    """While printing: the file as a mark once per print, file_position in the rows; afterwards neither."""
    t0 = at(date.today())
    printing = {**MONITOR, "job": {**MONITOR["job"], "file": "Benchy, 0.2mm.gcode"}}
    history.sample("U1", printing, t0)
    history.sample("U1", printing, t0 + 1)
    done = {**printing, "job": {**printing["job"], "state": "complete"}}
    history.sample("U1", done, t0 + 2)
    history.sample("U1", printing, t0 + 3)   # the same file printed again: marked again
    found = history.read("U1", t0 - 1, t0 + 5)
    assert found["files"] == [[round(t0), "Benchy, 0.2mm.gcode"], [round(t0 + 3), "Benchy, 0.2mm.gcode"]]
    assert found["series"]["file_position"] == [12345, 12345, None, 12345]


def test_tidied_also_when_the_gap_is_filled_first(data_dir):
    """The usual morning: the printer connects, Moonraker's minutes are written first, then the live rows;
    the days before are packed and those older than seven days gone all the same (review 27.09.2026)."""
    today = date.today()
    history.sample("U1", MONITOR, at(today - timedelta(days=9)))
    history.sample("U1", MONITOR, at(today - timedelta(days=2)))
    history._tidied.clear()
    history._last.clear()
    history.backfill("U1", {"extruder": {"temperatures": [20, 21]}}, at(today, second=10))
    history.sample("U1", MONITOR, at(today, second=11))
    names = sorted(p.name for p in history.folder("U1").iterdir())
    assert names == [f"{(today - timedelta(days=2)).isoformat()}.csv.gz", f"{today.isoformat()}.csv"]


def test_no_second_filling_after_midnight(data_dir):
    """Reconnected right after midnight without a row today yet: the minutes before midnight on record
    in yesterday's file are not written twice."""
    today = date.today()
    midnight = at(today, hour=0)
    history.sample("U1", MONITOR, midnight - 30)
    history._last.clear()
    store = {"extruder": {"temperatures": list(range(60))}}
    assert history.backfill("U1", store, midnight + 29) == 59   # 23:59:31 to 00:00:29, not from 23:59:00
    found = history.read("U1", midnight - 120, midnight + 60)
    assert found["t"] == sorted(set(found["t"]))


def test_each_day_readable_on_its_own(data_dir):
    """Recorded through midnight, printing: the new day's file has its header and the print's mark with
    the time the print began, so a window after midnight has rows and the file, and no second start."""
    today = date.today()
    midnight = at(today, hour=0)
    printing = {**MONITOR, "job": {**MONITOR["job"], "file": "Benchy.gcode"}}
    for s in (-3, -2, -1, 0, 1, 2):
        history.sample("U1", printing, midnight + s)
    after = history.read("U1", midnight, midnight + 60)
    assert after["t"] == [round(midnight + s) for s in (0, 1, 2)]
    assert after["files"] == [[round(midnight - 3), "Benchy.gcode"]]
    around = history.read("U1", midnight - 60, midnight + 60)
    assert len(around["t"]) == 6 and around["files"] == [[round(midnight - 3), "Benchy.gcode"]]


def test_thinned_in_the_order_the_values_came(data_dir):
    """A falling curve stays falling when thinned: per step the first value first (review 27.09.2026)."""
    t0 = at(date.today())
    for s in range(0, 600):
        cooling = {**MONITOR, "temperatures": [{"name": "extruder", "temp": 220 - s * 0.3, "target": 0, "power": 0}]}
        history.sample("U1", cooling, t0 + s)
    thin = history.read("U1", t0, t0 + 599, points=20)["series"]["temp:extruder"]
    assert thin == sorted(thin, reverse=True)


def test_the_api(server, data_dir):
    now = time.time()
    history.sample("Snapmaker U1", MONITOR, now - 5)
    history.sample("Snapmaker U1", MONITOR, now - 4)
    status, body = call(f"{server}/api/history?printer=Snapmaker%20U1&seconds=60")
    found = json.loads(body)
    assert status == 200 and len(found["t"]) == 2 and found["series"]["temp:extruder"] == [219.6, 219.6]
    # A window of the past: only its rows.
    status, body = call(f"{server}/api/history?printer=Snapmaker%20U1&seconds=2&until={now - 4.5}")
    assert status == 200 and len(json.loads(body)["t"]) == 1
    assert call(f"{server}/api/history?printer=U1&until=inf")[0] == 400
    # Long gone or before 1970: nothing, not an error.
    for until in (0, -5, 1):
        status, body = call(f"{server}/api/history?printer=Snapmaker%20U1&until={until}")
        assert status == 200 and json.loads(body)["t"] == []
    assert call(f"{server}/api/history?printer=")[0] == 400
    assert call(f"{server}/api/history?printer=U1&seconds=nan")[0] == 400
    assert call(f"{server}/api/history?printer=Snapmaker+U1&seconds=NaN&points=2510")[0] == 400   # the page once sent this
    assert call(f"{server}/api/history?printer=U1&seconds=-5")[0] == 400


def test_recording_writes_and_tells_the_pages(data_dir, monkeypatch):
    """live.recording: every printer with an address kept connected, a row a second written and sent
    to the pages watching it."""
    class Hub:
        printer, data, stopping, heard = "U1", {"monitor": MONITOR}, None, time.monotonic() + 60

    hub = Hub()
    made = []
    monkeypatch.setattr(live, "_hubs", {"U1": hub})
    monkeypatch.setattr(live, "_hub", lambda name: made.append(name) or hub)
    monkeypatch.setattr(live.camera, "printers", lambda: {"U1": {"host": "10.0.0.2"}})
    # Not the slicers of this computer: the scan for their addresses is left out (hard rule 1).
    monkeypatch.setattr(live.overview, "build_all", lambda: None)

    async def run():
        page = live._Page()
        hub.pages = {page}
        task = asyncio.create_task(live.recording())
        await asyncio.sleep(0.3)
        task.cancel()
        return page

    page = asyncio.run(run())
    assert made == ["U1"] and live._kept == {"U1"}
    note = json.loads(page.latest["U1\x00sample"])
    assert note["printer"] == "U1" and note["sample"]["v"]["temp:extruder"] == 219.6
    assert (history.folder("U1") / f"{date.today().isoformat()}.csv").exists()
