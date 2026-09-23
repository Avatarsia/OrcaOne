"""The camera of the U1 (orcaone/camera.py): the list of printers, the API, and the WebSocket call
against a small stand-in for Moonraker, never a real printer."""

import json
import socket
import struct
import threading

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
