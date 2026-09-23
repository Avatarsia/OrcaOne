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


def test_list_of_printers(fake_home):
    first = camera.add("http://10.30.40.174/")
    assert first["host"] == "10.30.40.174" and camera.cameras() == [first]
    with pytest.raises(camera.CameraError) as err:
        camera.add("10.30.40.174")
    assert err.value.code == "camera_already_listed"
    with pytest.raises(camera.CameraError) as err:
        camera.add("10.30.40.174/../x")
    assert err.value.code == "camera_host_invalid"
    assert camera.set_every(first["id"], 5)["every"] == 5 and camera.cameras()[0]["every"] == 5
    with pytest.raises(camera.CameraError) as err:
        camera.set_every(first["id"], 0)
    assert err.value.code == "camera_every_invalid"
    camera.remove(first["id"])
    assert camera.cameras() == []
    with pytest.raises(camera.CameraError):
        camera.find(first["id"])


def test_api(server, monkeypatch):
    status, body = call(f"{server}/api/cameras", "POST", {"host": "10.30.40.174", "name": "Werkstatt"})
    cam = json.loads(body)["camera"]
    assert status == 200 and cam["name"] == "Werkstatt"
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
    assert call(f"{server}/api/cameras/{cam['id']}", "DELETE")[0] == 200
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
