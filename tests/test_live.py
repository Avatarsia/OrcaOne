"""Live values over Moonraker's WebSocket (orcaone/live.py) against a small stand-in for Moonraker,
never a real printer: the one subscription for all pages, the updates Klipper and Moonraker push, a
restart of Klipper, and the page's WebSocket with its checks."""

import json
import threading
import time

import pytest
from websockets.exceptions import InvalidStatus
from websockets.sync.client import connect
from websockets.sync.server import serve

from orcaone import camera, live
from test_monitor import SYSTEM, U1


class FakeMoonraker:
    """Answers printer.objects.list, printer.objects.subscribe and machine.proc_stats as Moonraker does;
    notify() pushes to every connection. subscribed: what each subscription asked for."""

    def __init__(self, objects):
        self.objects = objects
        self.subscribed = []
        self.connections = []
        self.server = serve(self.handle, "127.0.0.1", 0)
        self.host = f"127.0.0.1:{self.server.socket.getsockname()[1]}"
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def handle(self, ws):
        self.connections.append(ws)
        for raw in ws:
            request = json.loads(raw)
            method = request["method"]
            if method == "printer.objects.list":
                result = {"objects": list(self.objects)}
            elif method == "printer.objects.subscribe":
                wanted = request["params"]["objects"]
                self.subscribed.append(wanted)
                result = {"eventtime": 1.0, "status": {
                    name: value if wanted[name] is None else {f: value[f] for f in wanted[name] if f in value}
                    for name, value in self.objects.items() if name in wanted}}
            elif method == "machine.proc_stats":
                result = SYSTEM
            else:
                ws.send(json.dumps({"jsonrpc": "2.0", "id": request["id"], "error": {"code": 404, "message": "Method not found"}}))
                continue
            ws.send(json.dumps({"jsonrpc": "2.0", "id": request["id"], "result": result}))

    def notify(self, method, *params):
        for ws in self.connections:
            try:
                ws.send(json.dumps({"jsonrpc": "2.0", "method": method, "params": list(params)}))
            except Exception:
                pass   # a connection OrcaOne closed already


@pytest.fixture
def moonraker():
    fake = FakeMoonraker({**U1, "virtual_sdcard": {"file_position": 0, "progress": 0.25, "is_active": True}})
    camera.set_host("Snapmaker U1", fake.host)
    yield fake
    fake.server.shutdown()


def _open(server):
    return connect(server.replace("http://", "ws://") + "/api/live", origin=server, open_timeout=5)


def _next(ws, test=lambda message: True, printer="Snapmaker U1"):
    """The next message about the printer that passes the test."""
    end = time.monotonic() + 5
    while time.monotonic() < end:
        message = json.loads(ws.recv(timeout=max(0.01, end - time.monotonic())))
        if message["printer"] == printer and test(message):
            return message
    raise AssertionError("no such message")


def _until(test):
    end = time.monotonic() + 5
    while not test():
        assert time.monotonic() < end, "never happened"
        time.sleep(0.05)


def test_one_subscription_for_all_pages():
    # "virtual_sdcard" for "Status" and for "Steuerung": asked for once, with the fields of both;
    # "toolhead" whole, as one of them wants all of it.
    wanted = ["toolhead", "virtual_sdcard=file_position", "bed_mesh=mesh_min,mesh_max", "virtual_sdcard=progress",
              "toolhead=axis_minimum,axis_maximum", "bed_mesh=mesh_min,mesh_max"]
    assert live.subscription(wanted) == {"toolhead": None, "virtual_sdcard": ["file_position", "progress"],
                                         "bed_mesh": ["mesh_min", "mesh_max"]}


def test_a_page_watches_a_printer(server, moonraker, monkeypatch):
    monkeypatch.setattr(live, "LINGER", 0.2)
    with _open(server) as ws:
        ws.send(json.dumps({"watch": ["Snapmaker U1"]}))
        data = _next(ws)["data"]
        # The values as the REST answers shape them: the job, the heads, the computer inside.
        monitor, control = data["monitor"], data["control"]
        assert (monitor["job"]["state"], monitor["job"]["file"], monitor["job"]["layer"]) == ("printing", "Benchy.gcode", 12)
        assert [h["extruder"] for h in monitor["heads"]] == ["extruder", "extruder1"]
        assert monitor["system"]["cpu"] == 3.8 and monitor["system"]["uptime"] >= 21980
        assert (control["state"], control["progress"]) == ("printing", 0.25)
        # One subscription for everything the pages show.
        wanted = moonraker.subscribed[0]
        assert wanted["virtual_sdcard"] == ["file_position", "progress"] and "estimated_print_time" not in wanted["toolhead"]
        assert "extruder1" in wanted and "tmc2240 stepper_x" in wanted and "exclude_object" not in wanted

        # What Klipper sends is merged into what was there.
        moonraker.notify("notify_status_update", {"virtual_sdcard": {"file_position": 4321}, "print_stats": {"state": "paused"}}, 2.0)
        monitor = _next(ws, lambda m: m["data"]["monitor"]["job"]["file_position"] == 4321)["data"]["monitor"]
        assert (monitor["job"]["state"], monitor["job"]["layer"], monitor["job"]["file"]) == ("paused", 12, "Benchy.gcode")
        moonraker.notify("notify_proc_stat_update", {"system_cpu_usage": {"cpu": 55.5}, "cpu_temp": 61.0})
        monitor = _next(ws, lambda m: m["data"]["monitor"]["system"]["cpu"] == 55.5)["data"]["monitor"]
        assert monitor["system"]["cpu_temp"] == 61.0 and monitor["job"]["state"] == "paused"

        # Klipper shuts down, then comes back: the page sees it, and OrcaOne subscribes anew.
        moonraker.notify("notify_klippy_shutdown")
        assert _next(ws, lambda m: m["data"]["monitor"]["klipper"]["state"] == "shutdown")
        moonraker.notify("notify_klippy_ready")
        _until(lambda: len(moonraker.subscribed) == 2)
        assert _next(ws, lambda m: m["data"]["monitor"]["klipper"]["state"] == "ready")

        # Klipper answers G-code: a note, and "Konsole" reads Moonraker's store then.
        moonraker.notify("notify_gcode_response", "// Klipper state: Ready")
        assert _next(ws, lambda m: "gcode" in m) == {"printer": "Snapmaker U1", "gcode": True}

        # A second page on the same printer gets the last values at once, over the same connection.
        with _open(server) as other:
            other.send(json.dumps({"watch": ["Snapmaker U1"]}))
            assert _next(other)["data"]["monitor"]["job"]["file"] == "Benchy.gcode"
        assert len(moonraker.connections) == 1

    # The last page gone: after LINGER the connection closes and the printer is no longer watched.
    _until(lambda: "Snapmaker U1" not in live._hubs)


def test_the_glance_of_a_printer_tab(server, moonraker, monkeypatch):
    """The printer tabs want only the state: {"glance": {...}}, sent when it changes, and nothing else."""
    monkeypatch.setattr(live, "LINGER", 0.2)
    with _open(server) as ws:
        ws.send(json.dumps({"watch": [], "glance": ["Snapmaker U1", "Unbekannt"]}))
        seen = {}
        while len(seen) < 2:
            message = json.loads(ws.recv(timeout=5))
            assert "glance" in message   # nothing but glances
            seen[message["printer"]] = message["glance"]
        assert seen == {"Snapmaker U1": {"state": "printing", "klipper": "ready", "percent": 25},
                        "Unbekannt": {"error": "printer_not_found"}}
        moonraker.notify("notify_status_update", {"print_stats": {"state": "paused"}}, 2.0)
        assert _next(ws, lambda m: "glance" in m)["glance"]["state"] == "paused"
        # Watched as well: the full values come too; no longer glanced: its hub stays for the watch only.
        ws.send(json.dumps({"watch": ["Snapmaker U1"], "glance": []}))
        assert _next(ws, lambda m: "data" in m)["data"]["monitor"]["job"]["state"] == "paused"
        assert not live._hubs["Snapmaker U1"].glancers
    _until(lambda: "Snapmaker U1" not in live._hubs)


def test_a_printer_that_does_not_answer(server):
    camera.set_host("Snapmaker U1", "127.0.0.1:9")   # nothing listens there
    with _open(server) as ws:
        ws.send(json.dumps({"watch": ["Snapmaker U1", "Unbekannt"]}))
        assert _next(ws)["error"] == "camera_unreachable"
        assert _next(ws, printer="Unbekannt")["error"] == "printer_not_found"
        # Nonsense and too many printers are ignored, the connection stays.
        ws.send("kein JSON")
        ws.send(json.dumps({"watch": [f"Drucker {i}" for i in range(live.MAX_WATCHED + 1)]}))
        ws.send(json.dumps({"watch": ["Noch einer"]}))
        assert _next(ws, printer="Noch einer")["error"] == "printer_not_found"


def test_live_refuses_other_pages(server):
    # Hard rule 8: as for "SSH", only OrcaOne's own page on 127.0.0.1.
    for origin in ("http://evil.example", server.replace("127.0.0.1", "localhost")):
        with pytest.raises(InvalidStatus):
            connect(server.replace("http://", "ws://") + "/api/live", origin=origin, open_timeout=5)
