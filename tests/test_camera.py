"""The camera of the U1 (orcaone/camera.py): the list of printers, the API, and the WebSocket call
against a small stand-in for Moonraker, never a real printer."""

import json
import socket
import struct
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest

from conftest import call
from orcaone import camera


def test_hosts():
    assert camera.normalize(" http://10.30.40.174/ ") == "10.30.40.174"
    assert camera.normalize("u1.local:8080") == "u1.local:8080"
    assert [camera.normalize(x) for x in ("", "10.0.0.1/admin", "a b", "http://x/../y")] == [None] * 4


def test_address_per_printer_model():
    assert camera.set_host("Snapmaker U1", " http://10.30.40.174/ ") == {"Snapmaker U1": {"host": "10.30.40.174", "from": "orcaone"}}
    camera.set_host("Generic Klipper Printer", "klipper.local")
    # Only a U1 has a camera.
    cams = camera.cameras()
    assert [(c["model"], c["host"]) for c in cams] == [("Snapmaker U1", "10.30.40.174")]
    assert camera.find(cams[0]["id"])["host"] == "10.30.40.174"
    assert camera.set_every(cams[0]["id"], 5)["every"] == 5
    # Another address keeps the picture interval, and the camera its id.
    camera.set_host("Snapmaker U1", "10.30.40.175")
    assert camera.cameras() == [{"id": cams[0]["id"], "model": "Snapmaker U1", "host": "10.30.40.175", "every": 5}]
    assert camera.printers()["Snapmaker U1"] == {"host": "10.30.40.175", "from": "orcaone", "every": 5}
    for model, host, code in (("Snapmaker U1", "10.0.0.1/admin", "camera_host_invalid"), ("Snapmaker U1", "a b", "camera_host_invalid"),
                              ("", "10.0.0.1", "printer_invalid"), (None, "10.0.0.1", "printer_invalid"),
                              ("Snapmaker U1", None, "printer_invalid")):
        with pytest.raises(camera.CameraError) as err:
            camera.set_host(model, host)
        assert err.value.code == code
    with pytest.raises(camera.CameraError) as err:
        camera.set_every(cams[0]["id"], 0)
    assert err.value.code == "camera_every_invalid"
    # Saved empty, the address goes, and the camera with it.
    assert camera.set_host("Snapmaker U1", "  ") == {"Generic Klipper Printer": {"host": "klipper.local", "from": "orcaone"}}
    assert camera.cameras() == []
    with pytest.raises(camera.CameraError):
        camera.find(cams[0]["id"])


def test_address_from_the_slicer():
    """"Hostname, IP or URL" of the slicer's dialog "Physical Printer" counts until one is typed in
    on the page "Drucker"; saved empty there, the slicer's counts again."""
    camera.remember_slicer_hosts({"Snapmaker U1": {"host": "http://10.30.40.174:7125/", "slicer": "OrcaSlicer"},
                                  "Generic Klipper Printer": {"host": "http://x/octoprint", "slicer": "OrcaSlicer"}})
    assert camera.printers() == {"Snapmaker U1": {"host": "10.30.40.174:7125", "from": "slicer", "slicer": "OrcaSlicer"}}
    cam = camera.cameras()[0]
    assert camera.set_every(cam["id"], 2)["every"] == 2
    assert camera.printers()["Snapmaker U1"]["every"] == 2
    camera.set_host("Snapmaker U1", "10.30.40.9")
    assert camera.printers()["Snapmaker U1"] == {"host": "10.30.40.9", "from": "orcaone", "every": 2}
    camera.set_host("Snapmaker U1", "")
    assert camera.printers()["Snapmaker U1"] == {"host": "10.30.40.174:7125", "from": "slicer", "slicer": "OrcaSlicer", "every": 2}


# Trimmed from the answers of the user's U1 on 24.09.2026. "logs" is missing: that part stays None.
U1_SYSTEM = {"system_info": {
    "product_info": {"device_name": "Dr. Klippers U1", "firmware_version": "1.6.0", "nozzle_diameter": [0.4, 0.4, 0.4, 0.4],
                     "machine_type": "Snapmaker U1", "serial_number": "GEHEIM"},
    "distribution": {"name": "Buildroot 2024.02"},
    "network": {"lo": {"ip_addresses": [{"family": "ipv4", "address": "127.0.0.1"}]},
                "wlan0": {"ip_addresses": [{"family": "ipv4", "address": "10.30.40.174"}]}}}}
ANSWERS = {
    "/printer/info": {"state": "ready", "software_version": "1.6.0.267_20260815150420"},
    "/server/info": {"moonraker_version": "1.6.0"},
    "/server/files/directory?path=gcodes&extended=false": {"disk_usage": {"total": 27_400_000_000, "used": 3_200_000_000, "free": 24_200_000_000}},
    "/server/files/list?root=gcodes": [{"path": "a.gcode", "size": 300}, {"path": "b.gcode", "size": 200}],
    "/server/files/list?root=camera": [{"path": "x.mp4", "size": 1000}, {"path": "x_cover.jpg", "size": 10}],
    "/server/history/totals": {"job_totals": {"total_jobs": 28.0, "total_print_time": 318806.1, "total_filament_used": 759323.5, "longest_print": 74923.7}},
    "/machine/proc_stats": {"system_uptime": 5078.2, "cpu_temp": 40.1, "system_memory": {"total": 984740, "used": 187516}},
}


@pytest.fixture
def moonraker():
    """Answers the GETs of camera.info with ANSWERS, /machine/system_info with answers["system"]."""
    answers = {**ANSWERS, "/machine/system_info": U1_SYSTEM}

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            result = answers.get(self.path)
            body = json.dumps({"result": result} if result is not None else {"error": {"code": 404}}).encode()
            self.send_response(200 if result is not None else 404)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *args):
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    yield f"127.0.0.1:{server.server_address[1]}", answers
    server.shutdown()


def test_info_of_a_klipper_printer(moonraker):
    host, answers = moonraker
    got = camera.info(host)
    assert (got["name"], got["firmware"], got["nozzles"], got["os"], got["network"]) == (
        "Dr. Klippers U1", "1.6.0", [0.4, 0.4, 0.4, 0.4], "Buildroot 2024.02", "wlan0")
    assert (got["klipper"], got["state"], got["moonraker"]) == ("1.6.0.267_20260815150420", "ready", "1.6.0")
    assert got["disk"]["free"] == 24_200_000_000 and got["folders"] == {"gcodes": 500, "camera": 1010, "logs": None}
    assert got["videos"] == 1 and got["jobs"]["total_jobs"] == 28.0 and got["system"]["cpu_temp"] == 40.1
    assert "GEHEIM" not in json.dumps(got)
    # Any other Klipper printer: no product_info, the rest as it is.
    answers["/machine/system_info"] = {"system_info": {"distribution": {"name": "Debian GNU/Linux 12"}}}
    plain = camera.info(host)
    assert (plain["name"], plain["firmware"], plain["nozzles"], plain["os"], plain["klipper"]) == (
        None, None, [], "Debian GNU/Linux 12", "1.6.0.267_20260815150420")
    with pytest.raises(camera.CameraError) as err:
        camera.info("127.0.0.1:9")
    assert err.value.code == "camera_unreachable"


def test_info_only_for_a_printer_with_an_address(server, moonraker):
    host, _ = moonraker
    camera.set_host("MyKlipper", host)
    status, body = call(f"{server}/api/printers/info?model=MyKlipper")
    assert status == 200 and json.loads(body)["name"] == "Dr. Klippers U1"
    assert call(f"{server}/api/printers/info?model=Unbekannt")[0] == 404


def test_a_picture_cut_off_while_the_printer_rewrites_it():
    """The U1 now and then overwrites monitor.jpg while sending it: the answer ends short of its
    Content-Length. One more try gets the new picture whole; short twice is "unreachable"."""
    state, sent = {"cuts": 1}, []

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            whole, short = b"\xff\xd8" + b"x" * 98, len(sent) < state["cuts"]
            sent.append(self.path)
            self.send_response(200)
            self.send_header("Content-Type", "image/jpeg")
            self.send_header("Content-Length", str(len(whole)))
            self.end_headers()
            self.wfile.write(whole[:40] if short else whole)

        def log_message(self, *args):
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    host = f"127.0.0.1:{server.server_address[1]}"
    try:
        data, _ = camera.image(host)
        assert len(data) == 100 and len(sent) == 2
        state["cuts"] = 99
        with pytest.raises(camera.CameraError) as err:
            camera.image(host)
        assert err.value.code == "camera_unreachable" and len(sent) == 4
    finally:
        server.shutdown()


def test_the_one_command_the_light(server, monkeypatch):
    """The light in the U1 on and off: SET_LED on its white channel, as Moonraker's own web page sends it."""
    sent = []

    class Handler(BaseHTTPRequestHandler):
        def do_POST(self):
            sent.append(self.path)
            body = json.dumps({"result": "ok"}).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *args):
            pass

    printer = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=printer.serve_forever, daemon=True).start()
    try:
        host = f"127.0.0.1:{printer.server_address[1]}"
        assert camera.set_light(host, True) is True and camera.set_light(host, False) is False
        assert sent == ["/printer/gcode/script?script=SET_LED%20LED%3Dcavity_led%20WHITE%3D1",
                        "/printer/gcode/script?script=SET_LED%20LED%3Dcavity_led%20WHITE%3D0"]
        camera.set_host("Snapmaker U1", host)
        cam = json.loads(call(f"{server}/api/cameras")[1])["cameras"][0]
        status, body = call(f"{server}/api/cameras/{cam['id']}/light", "POST", {"on": True})
        assert (status, json.loads(body)) == (200, {"light": True})
        assert call(f"{server}/api/cameras/{cam['id']}/light", "POST", {"on": "ja"})[0] == 400
    finally:
        printer.shutdown()
    with pytest.raises(camera.CameraError) as err:
        camera.set_light("127.0.0.1:9", True)
    assert err.value.code == "camera_unreachable"


def test_api(server, monkeypatch):
    status, body = call(f"{server}/api/printers", "POST", {"model": "Snapmaker U1", "host": "10.30.40.174"})
    mine = {"Snapmaker U1": {"host": "10.30.40.174", "from": "orcaone"}}
    assert status == 200 and json.loads(body) == {"printers": mine}
    assert json.loads(call(f"{server}/api/printers")[1]) == {"printers": mine}
    status, body = call(f"{server}/api/printers", "POST", {"model": "Snapmaker U1", "host": "10.0.0.1/x"})
    assert (status, json.loads(body)) == (400, {"error": "camera_host_invalid"})
    cam = json.loads(call(f"{server}/api/cameras")[1])["cameras"][0]
    assert cam["model"] == "Snapmaker U1"
    monkeypatch.setattr(camera, "image", lambda host: (b"\xff\xd8jpeg", 4.0))
    monkeypatch.setattr(camera, "_rpc", lambda host, method, params: {"result": {"state": "ok"}})
    with __import__("urllib.request").request.urlopen(f"{server}/api/cameras/{cam['id']}/image") as response:
        assert response.headers["Content-Type"] == "image/jpeg" and response.read() == b"\xff\xd8jpeg"
        assert response.headers["X-Image-Age"] == "4"
    assert json.loads(call(f"{server}/api/cameras/{cam['id']}/wake", "POST")[1]) == {"result": {"state": "ok"}}
    monkeypatch.setattr(camera, "_rpc", lambda host, method, params: {"error": {"message": "busy"}})
    status, body = call(f"{server}/api/cameras/{cam['id']}/wake", "POST")
    assert (status, json.loads(body)) == (502, {"error": "camera_refused", "detail": "busy"})
    assert call(f"{server}/api/cameras/nope/image")[0] == 404
    status, body = call(f"{server}/api/cameras/{cam['id']}", "POST", {"every": 5})
    assert status == 200 and json.loads(body)["camera"]["every"] == 5
    call(f"{server}/api/printers", "POST", {"model": "Snapmaker U1", "host": ""})
    assert json.loads(call(f"{server}/api/cameras")[1]) == {"cameras": []}


def _moonraker(sock):
    """Answers one call: the handshake, a notification first, then the result for the call's id."""
    conn, _ = sock.accept()
    with conn:
        request = b""
        while b"\r\n\r\n" not in request:
            request += conn.recv(4096)
        assert b"GET /websocket" in request
        conn.sendall(b"HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n")
        first, second = conn.recv(2)
        size = second & 0x7F
        if size == 126:
            size = struct.unpack(">H", conn.recv(2))[0]
        mask = conn.recv(4)
        data = b""
        while len(data) < size:
            data += conn.recv(size - len(data))
        message = json.loads(bytes(b ^ mask[i % 4] for i, b in enumerate(data)))
        assert message["method"] == "camera.start_monitor" and message["params"]["domain"] == "lan"
        for reply in ({"jsonrpc": "2.0", "method": "notify_status_update", "params": []},
                      {"jsonrpc": "2.0", "id": message["id"], "result": {"state": "ok"}}):
            payload = json.dumps(reply).encode()
            conn.sendall(bytes([0x81, len(payload)]) + payload if len(payload) < 126
                         else bytes([0x81, 126]) + struct.pack(">H", len(payload)) + payload)


def test_wake_speaks_websocket():
    sock = socket.socket()
    sock.bind(("127.0.0.1", 0))
    sock.listen(1)
    thread = threading.Thread(target=_moonraker, args=(sock,), daemon=True)
    thread.start()
    assert camera.wake(f"127.0.0.1:{sock.getsockname()[1]}") == {"state": "ok"}
    thread.join(timeout=5)
    sock.close()


# ---------------------------------------------------------------- finding a U1 in the LAN (mDNS)

def _name(text):
    return b"".join(bytes([len(p)]) + p.encode() for p in text.split(".")) + b"\0"


def _record(name: bytes, rtype: int, rdata: bytes) -> bytes:
    return name + struct.pack(">HHIH", rtype, 1, 120, len(rdata)) + rdata


def _answer(txt=(), with_a=True, service="_snapmaker._tcp.local"):
    """An mDNS answer as a U1 would send it: PTR, then SRV (its name compressed), TXT and A."""
    head = struct.pack(">6H", 0, 0x8400, 0, 1, 0, 2 + bool(with_a))
    ptr_name = _name(service)
    instance = _name(f"lava.{service}")
    ptr = _record(ptr_name, 12, instance)
    instance_at = 12 + len(ptr_name) + 10   # where the PTR's data, the instance name, starts
    pointer = struct.pack(">H", 0xC000 | instance_at)
    srv = _record(pointer, 33, struct.pack(">HHH", 0, 0, 80) + _name("lava.local"))
    txt_data = b"".join(bytes([len(t)]) + t.encode() for t in txt) or b"\0"
    records = ptr + srv + _record(pointer, 16, txt_data)
    if with_a:
        records += _record(_name("lava.local"), 1, socket.inet_aton("10.30.40.174"))
    return head + records


def test_the_question_snapmaker_orca_asks():
    # BonjourRequest::make_PTR: id 0, one question, "_snapmaker._tcp.local", type PTR, class ANY.
    assert camera._mdns_query("_snapmaker._tcp.local").hex() == \
        "000000000001000000000000" + "0a5f736e61706d616b6572045f746370056c6f63616c00" + "000c00ff"


def test_answers_of_a_u1():
    fields = ("sn=ABC123", "machine_type=Snapmaker U1", "device_name=Werkstatt", "ip=10.30.40.174", "version=1.6.0")
    assert camera._parse_answer(_answer(fields), "10.30.40.9") == [
        {"host": "10.30.40.174", "name": "Werkstatt", "machine_type": "Snapmaker U1", "version": "1.6.0"}]
    # Without the TXT field "ip": the A record of the SRV target, else the sender.
    assert camera._parse_answer(_answer(("machine_type=Snapmaker U1",)), "10.0.0.9")[0]["host"] == "10.30.40.174"
    assert camera._parse_answer(_answer((), with_a=False), "10.0.0.9") == [
        {"host": "10.0.0.9", "name": "lava", "machine_type": "", "version": ""}]
    # Another service, a question, or broken data: nothing.
    assert camera._parse_answer(_answer(fields, service="_http._tcp.local"), "10.0.0.9") == []
    assert camera._parse_answer(camera._mdns_query("_snapmaker._tcp.local"), "10.0.0.9") == []
    assert camera._parse_answer(_answer(fields)[:40], "10.0.0.9") == []


def test_search_api(server, monkeypatch):
    found = [{"host": "10.30.40.174", "name": "lava", "machine_type": "Snapmaker U1", "version": "1.6.0"}]
    monkeypatch.setattr(camera, "search", lambda: found)
    assert json.loads(call(f"{server}/api/printers/search", "POST")[1]) == {"found": found}

    def refused():
        raise camera.CameraError("search_failed", "[Errno 98] Address already in use")
    monkeypatch.setattr(camera, "search", refused)
    status, body = call(f"{server}/api/printers/search", "POST")
    assert (status, json.loads(body)) == (500, {"error": "search_failed", "detail": "[Errno 98] Address already in use"})
