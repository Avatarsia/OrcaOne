"""Live values over Moonraker's WebSocket, instead of asking every two seconds (the user's wish of
25.09.2026: the REST looks were slow and wasteful, above all for "3D Ansicht" and "2D Ansicht").

One connection per printer, while a page watches it: OrcaOne subscribes to what the pages show
(printer.objects.subscribe, the objects of monitor.py and control.py); Klipper then sends only what
changed, at most every 0.25 s, Moonraker the computer inside every second (notify_proc_stat_update).
Checked on the U1 on 25.09.2026: the answer to the subscription holds all values, then at rest about
11 updates in 8 s from the temperatures. The values are shaped as the REST answers (monitor.shape,
control.shape) and pushed over OrcaOne's own WebSocket (GET /api/live) to every page that watches the
printer; the browser never talks to a printer itself. Read only: nothing here sends a printer a command.

For the page "Diagramme" (the user's wishes of 27.09.2026) every printer with an address stays connected
also without a page (recording), and once a second its values become a row of history.py, which also
goes to the pages watching.
"""

import asyncio
import copy
import json
import logging
import time

from fastapi import WebSocket, WebSocketDisconnect
from websockets.asyncio.client import connect
from websockets.exceptions import WebSocketException

from . import camera, control, history, monitor, overview, settings
from .camera import TIMEOUT, CameraError

log = logging.getLogger(__name__)

PUSH_EVERY = 0.25        # s between two pushes of a printer: Klipper's own step, a burst goes out once
LINGER = 10              # s a connection stays after the last page left: the next page takes it over
RETRY = (0.5, 1, 2, 5, 10)  # s before the next try, longer with every failure in a row
MAX_WATCHED = 20         # printers one page may watch
MAX_MESSAGE = 16 * 2 ** 20  # bytes of one message from Moonraker; the answer to the subscription is the biggest
RECORD = True            # tests switch it off: they have no printers to record
LOOK_EVERY = 30          # s between two looks at which printers have an address
QUIET = 5                # s without a word from Moonraker (it sends every second) after which no row is written


def subscription(wanted: list[str]) -> dict:
    """Klipper's objects as printer.objects.subscribe takes them, {"name": ["field", …] or None for all},
    from "name" or "name=field,…" as monitor.py and control.py ask for them; the same object asked for
    twice gets the fields of both."""
    objects = {}
    for item in wanted:
        name, _, fields = item.partition("=")
        if not fields:
            objects[name] = None
        elif name not in objects:
            objects[name] = fields.split(",")
        elif objects[name] is not None:
            objects[name] = list(dict.fromkeys(objects[name] + fields.split(",")))
    return objects


class _Page:
    """One page's WebSocket: the newest message per printer, sent in turn; older ones are dropped."""

    def __init__(self):
        self.latest = {}
        self.ready = asyncio.Event()

    def put(self, printer: str, message: str) -> None:
        self.latest[printer] = message
        self.ready.set()


class _Hub:
    """One printer: its connection to Moonraker, Klipper's objects as subscribed and updated since, the
    pages watching. Lives on the event loop of the server, so it needs no locks."""

    def __init__(self, printer: str):
        self.printer = printer
        self.pages: set[_Page] = set()
        self.glancers: set[_Page] = set()   # pages that want only the glance: the printer tabs (app.js)
        self.glance = None          # the glance sent last, as text
        self.listed: list = []      # printer.objects.list
        self.found: dict = {}       # the objects, merged with every notify_status_update
        self.system: dict = {}      # machine.proc_stats, then notify_proc_stat_update
        self.uptime = None          # (seconds, when): system_uptime comes with machine.proc_stats only
        self.last = None            # the message pushed last, for a page that comes later
        self.data = None            # the values shaped last while connected, for the recording
        self.heard = 0.0            # time.monotonic() of the last message from Moonraker
        self.changed = asyncio.Event()
        self.loop = asyncio.get_running_loop()
        self.stopping = None        # the stop LINGER seconds after the last page left
        self.tasks: set = set()     # started and not awaited, kept so they are not collected
        self.task = asyncio.create_task(self.run())

    def join(self, page: _Page, glance: bool = False) -> None:
        (self.glancers if glance else self.pages).add(page)
        if self.stopping:
            self.stopping.cancel()
            self.stopping = None
        if glance and self.glance:
            page.put(self.printer + "\x00glance", self.glance)
        elif not glance and self.last:
            page.put(self.printer, self.last)

    def leave(self, page: _Page, glance: bool = False) -> None:
        (self.glancers if glance else self.pages).discard(page)
        if not self.pages and not self.glancers and self.stopping is None:
            self.stopping = self.loop.call_later(LINGER, self._stop)

    def _stop(self) -> None:
        """At once, without waiting on anything: a page coming after gets a new hub."""
        self.stopping = None
        if self.pages or self.glancers or self.printer in _kept:
            return
        self.task.cancel()
        if _hubs.get(self.printer) is self:
            del _hubs[self.printer]

    def _push(self, message: dict) -> None:
        self.last = json.dumps(message)
        for page in self.pages:
            page.put(self.printer, self.last)

    def _fail(self, code: str, detail: str | None = None) -> None:
        self.data = None   # no row while the printer does not answer: a gap in the charts
        self._push({"printer": self.printer, "error": code, "detail": detail})
        self._glanced({"error": code})

    def _glanced(self, glance: dict) -> None:
        """What a printer tab shows (the user's wish of 27.09.2026): the state of the print and of Klipper,
        or why the printer does not answer; sent only when it changed."""
        text = json.dumps({"printer": self.printer, "glance": glance})
        if text != self.glance:
            self.glance = text
            for page in self.glancers:
                page.put(self.printer + "\x00glance", text)

    async def run(self) -> None:
        """Connected until _stop cancels it; after a failure again and again, a little later each time."""
        failures = 0
        while True:
            try:
                await self._session()
                failures = 0       # Moonraker closed, say for a restart: soon again
            except CameraError as exc:
                self._fail(exc.code, exc.detail)
                failures += 1
            except (OSError, WebSocketException, TimeoutError, ValueError, KeyError, TypeError) as exc:
                self._fail("camera_unreachable", str(exc) or type(exc).__name__)
                failures += 1
            await asyncio.sleep(RETRY[min(failures, len(RETRY) - 1)])

    async def _session(self) -> None:
        """One connection, until Moonraker closes it or the task is cancelled."""
        host = camera.host_of(self.printer)
        async with connect(f"ws://{host}/websocket", origin=f"http://{host}", proxy=None, open_timeout=TIMEOUT,
                           max_size=MAX_MESSAGE) as ws:
            waiting = {}   # request id: future of the answer
            counter = iter(range(1, 2 ** 31))

            async def call(method: str, params: dict | None = None):
                ident = next(counter)
                waiting[ident] = asyncio.get_running_loop().create_future()
                try:
                    await ws.send(json.dumps({"jsonrpc": "2.0", "id": ident, "method": method, "params": params or {}}))
                    answer = await asyncio.wait_for(waiting[ident], TIMEOUT)
                finally:
                    waiting.pop(ident, None)
                error = answer.get("error")
                if error is not None:
                    raise CameraError("camera_refused", str(error.get("message") if isinstance(error, dict) else error))
                return answer.get("result")

            async def subscribe() -> None:
                try:
                    listed = (await call("printer.objects.list") or {}).get("objects") or []
                    wanted = subscription(monitor.objects(listed) + control.objects(set(listed)))
                    # Without a time for the statistics in it: they may be up to a second older than the
                    # answer, so the rates begin with the first note that renews them (review 27.09.2026).
                    found = (await call("printer.objects.subscribe", {"objects": wanted}) or {}).get("status") or {}
                except CameraError as exc:
                    # Klipper not there (restarting, or before it answers): its state, and the next
                    # notify_klippy_ready subscribes anew.
                    listed, found = [], {"webhooks": {"state": "startup", "state_message": exc.detail}}
                self.listed, self.found = listed, found
                self.changed.set()

            async def reading() -> None:
                async for raw in ws:
                    self.heard = time.monotonic()
                    message = json.loads(raw)
                    if not isinstance(message, dict):
                        continue
                    future = waiting.get(message.get("id"))
                    if future is not None:
                        if not future.done():
                            future.set_result(message)
                        continue
                    method, params = message.get("method"), message.get("params") or [None]
                    if method == "notify_status_update" and isinstance(params[0], dict):
                        for name, fields in params[0].items():
                            if isinstance(fields, dict):
                                self.found.setdefault(name, {}).update(fields)
                        _stamp(self.found, params[0], params[1] if len(params) > 1 else None)
                        self.changed.set()
                    elif method == "notify_proc_stat_update" and isinstance(params[0], dict):
                        self.system.update(params[0])
                        self.changed.set()
                    elif method == "notify_klippy_ready":
                        # Klipper restarted: its objects may differ, the old subscription is gone.
                        task = asyncio.create_task(subscribe())
                        self.tasks.add(task)
                        task.add_done_callback(self.tasks.discard)
                    elif method in ("notify_klippy_shutdown", "notify_klippy_disconnected"):
                        webhooks = self.found.setdefault("webhooks", {})
                        webhooks["state"] = "shutdown" if method == "notify_klippy_shutdown" else "startup"
                        self.changed.set()
                    elif method == "notify_gcode_response":
                        # Klipper answered: "Konsole" reads Moonraker's store now, which also has the
                        # commands of other programs (Mainsail); a burst goes out as one note.
                        note = json.dumps({"printer": self.printer, "gcode": True})
                        for page in self.pages:
                            page.put(self.printer + "\x00gcode", note)

            reader = asyncio.create_task(reading())
            pusher = None
            try:
                try:
                    stats = await call("machine.proc_stats") or {}
                except CameraError:
                    stats = {}   # the computer inside is optional, as on "Status"
                self.system = dict(stats)
                uptime = stats.get("system_uptime")
                self.uptime = (uptime, time.monotonic()) if isinstance(uptime, (int, float)) else None
                await subscribe()
                if RECORD and self.printer in _kept:
                    # The gap since the last row (OrcaOne or the printer was off) from Moonraker's
                    # temperatures of the last 20 minutes, so the charts do not begin empty.
                    try:
                        store = await call("server.temperature_store", {"include_monitors": True}) or {}
                        await asyncio.to_thread(history.backfill, self.printer, store, None, record_idle())
                    except (CameraError, OSError):
                        pass   # without it the recording begins now
                # Only now: Moonraker's notes on the computer come before the answer to the subscription,
                # and a page would first see a printer without any values.
                pusher = asyncio.create_task(self._pushing(host))
                await reader     # until Moonraker closes
            finally:
                reader.cancel()
                self.data = None
                if pusher:
                    pusher.cancel()

    async def _pushing(self, host: str) -> None:
        """Shapes and pushes after every change, at most every PUSH_EVERY seconds; shaped in a thread,
        as the time left of a print reads the file's metadata once (camera._left)."""
        while True:
            await self.changed.wait()
            self.changed.clear()
            listed, found, system = list(self.listed), copy.deepcopy(self.found), dict(self.system)
            if self.uptime:
                system["system_uptime"] = self.uptime[0] + time.monotonic() - self.uptime[1]
            try:
                data = await asyncio.to_thread(lambda: {"monitor": monitor.shape(host, listed, found, system),
                                                        "control": control.shape(found, set(listed))})
            except Exception:   # a value of an unknown kind must not end the pushing
                log.exception("Shaping the live values of %s failed", self.printer)
            else:
                self.data = data
                self._push({"printer": self.printer, "data": data})
                job, klipper = data["monitor"].get("job") or {}, data["monitor"].get("klipper") or {}
                progress = job.get("progress")
                # Whole percent, rounded as the top bar does (Math.round), so tab and bar agree.
                self._glanced({"state": job.get("state"), "klipper": klipper.get("state"),
                               "percent": int(min(1, max(0, progress)) * 100 + 0.5) if isinstance(progress, (int, float)) else None})
            await asyncio.sleep(PUSH_EVERY)


def _stamp(found: dict, changed: dict, eventtime) -> None:
    """Klipper's time with each microcontroller's statistics that came (its "stats_at"): Klipper renews them
    once a second, and history.py divides their counters by this time, not by OrcaOne's clock."""
    if not isinstance(eventtime, (int, float)):
        return
    for name, fields in changed.items():
        if isinstance(fields, dict) and "last_stats" in fields and isinstance(found.get(name), dict):
            found[name]["stats_at"] = eventtime


_hubs: dict[str, _Hub] = {}
_kept: set[str] = set()   # the printers with an address: connected also without a page


def _hub(printer: str) -> _Hub:
    hub = _hubs.get(printer)
    # A hub of another event loop (a test's earlier server) is dead even if not done.
    if hub is None or hub.task.done() or hub.loop is not asyncio.get_running_loop():
        hub = _hubs[printer] = _Hub(printer)
    return hub


def record_idle() -> bool:
    """The switch on "Diagramme": keep rows at rest too (the user's wish of 27.09.2026), off unless set."""
    return settings.load().get("record_idle") is True


async def recording() -> None:
    """Every printer with an address connected, and once a second a row of its values (history.sample):
    written to data/history/ and sent to the pages watching it as {"printer", "sample": {"t", "v"}}. Runs
    as long as the server does (app.py)."""
    looked = None
    try:
        # The slicers' addresses (print_host, the printer Snapmaker Orca is connected to) are known after a
        # scan only (overview.build_all): once at the start, else a printer with such an address alone
        # were recorded only after a page was opened (review 27.09.2026).
        await asyncio.to_thread(overview.build_all)
    except Exception:
        log.exception("Reading the slicers' printer addresses for the recording failed")
    while True:
        if looked is None or time.monotonic() - looked >= LOOK_EVERY:
            looked = time.monotonic()
            try:
                names = set(await asyncio.to_thread(camera.printers))
            except Exception:   # settings unreadable for a moment: the printers of the last look
                log.exception("Reading the printers to record failed")
                names = set(_kept)
            gone = _kept - names
            _kept.clear()
            _kept.update(names)
            for name in gone:
                hub = _hubs.get(name)
                if hub and not hub.pages and hub.stopping is None:
                    hub.stopping = hub.loop.call_later(LINGER, hub._stop)
            for name in names:
                _hub(name)
        idle = await asyncio.to_thread(record_idle)
        for hub in list(_hubs.values()):
            monitor_values = (hub.data or {}).get("monitor")
            # Nothing heard for a while (a WLAN gone quiet before the socket notices): no frozen rows.
            if hub.printer not in _kept or not monitor_values or time.monotonic() - hub.heard > QUIET:
                continue
            try:
                row = await asyncio.to_thread(history.sample, hub.printer, monitor_values, None, idle)
            except Exception:   # a value of an unknown kind must not end the recording
                log.exception("Recording %s failed", hub.printer)
                continue
            if row:
                note = json.dumps({"printer": hub.printer, "sample": row})
                for page in hub.pages:
                    page.put(hub.printer + "\x00sample", note)
        await asyncio.sleep(history.STEP)


async def serve(ws: WebSocket) -> None:
    """One page: it names the printers it watches ({"watch": [name, …], "glance": [name, …]}, every time
    all of them), and gets {"printer", "data": {"monitor", "control"}} or {"printer", "error", "detail"}
    for each watched, {"printer", "gcode": true} when Klipper answered G-code, {"printer", "sample"} with
    each row of the recording (history.py), and for each glanced only {"printer", "glance": {"state",
    "klipper", "percent"} or {"error"}} when it changes."""
    await ws.accept()
    page, watched, glanced = _Page(), set(), set()

    async def sending() -> None:
        try:
            while True:
                await page.ready.wait()
                page.ready.clear()
                while page.latest:
                    await ws.send_text(page.latest.popitem()[1])
        except (WebSocketDisconnect, RuntimeError, OSError):
            pass   # the page went; the loop below ends with it

    sender = asyncio.create_task(sending())
    try:
        while True:
            try:
                message = json.loads(await ws.receive_text())
            except ValueError:
                continue   # nonsense: ignored, the page stays connected
            wanted = message.get("watch") if isinstance(message, dict) else None
            glimpse = message.get("glance", []) if isinstance(message, dict) else None
            if not isinstance(wanted, list) or not isinstance(glimpse, list):
                continue
            names = {n for n in wanted if isinstance(n, str) and n}
            looks = {n for n in glimpse if isinstance(n, str) and n}
            if len(names) > MAX_WATCHED:
                continue
            looks = set(sorted(looks)[:MAX_WATCHED])   # the tabs of many printers: the first ones, the watched ones stay
            for name in watched - names:
                if name in _hubs:
                    _hubs[name].leave(page)
            for name in names - watched:
                _hub(name).join(page)
            for name in glanced - looks:
                if name in _hubs:
                    _hubs[name].leave(page, glance=True)
            for name in looks - glanced:
                _hub(name).join(page, glance=True)
            watched, glanced = names, looks
    except (WebSocketDisconnect, RuntimeError):
        pass   # the page closed
    finally:
        sender.cancel()
        for name in watched:
            if name in _hubs:
                _hubs[name].leave(page)
        for name in glanced:
            if name in _hubs:
                _hubs[name].leave(page, glance=True)
        try:
            await ws.close()
        except RuntimeError:
            pass   # closed already
