"""Camera of the Snapmaker U1 with its stock firmware (page "Kamera"), after the user's
prototypes/U1Cam/u1cam.py.

The camera sleeps until Moonraker's JSON-RPC method camera.start_monitor wakes it, sent over the
printer's WebSocket as its own web page does. Then the printer writes
/server/files/camera/monitor.jpg every few seconds. OrcaOne wakes it while the page shows the
picture and passes the picture through, so the browser needs no access of its own to the printer.

Only printers the user added are asked (section "cameras" of OrcaOne's settings): the page names
a camera by its id, never by an address, so no other page can make OrcaOne fetch from elsewhere.
Standard library only.
"""

import base64
import hashlib
import json
import os
import re
import socket
import struct
import time
import urllib.request
from email.utils import parsedate_to_datetime

from . import settings

TIMEOUT = 5
# A host name or IPv4 address with an optional port: nothing that could become a path.
_HOST = re.compile(r"[A-Za-z0-9](?:[A-Za-z0-9.-]{0,251}[A-Za-z0-9])?(?::\d{1,5})?")


class CameraError(Exception):
    """An error code for the API; detail is the technical reason, shown as it is."""

    def __init__(self, code: str, detail: str = ""):
        super().__init__(code)
        self.code, self.detail = code, detail


def cameras() -> list[dict]:
    """[{"id", "host", "name", "every"?}] as added; every: seconds between two pictures."""
    items = settings.load().get("cameras")
    return [c for c in items if isinstance(c, dict) and isinstance(c.get("host"), str) and isinstance(c.get("id"), str)] \
        if isinstance(items, list) else []


def _save(items: list[dict]) -> None:
    settings.change(lambda data: data.update(cameras=items))


def normalize(raw: str) -> str | None:
    """"http://10.30.40.174/" -> "10.30.40.174"; None if it is no host."""
    host = raw.strip().removeprefix("http://").removeprefix("https://").strip("/")
    return host if _HOST.fullmatch(host) else None


def add(raw: str, name: str = "") -> dict:
    host = normalize(raw) if isinstance(raw, str) else None
    if host is None:
        raise CameraError("camera_host_invalid")
    items = cameras()
    if any(c["host"] == host for c in items):
        raise CameraError("camera_already_listed")
    camera = {"id": hashlib.sha1(host.encode()).hexdigest()[:10], "host": host, "name": name.strip() or "Snapmaker U1"}
    _save(items + [camera])
    return camera


def remove(camera_id: str) -> None:
    items = cameras()
    if not any(c["id"] == camera_id for c in items):
        raise CameraError("camera_not_found")
    _save([c for c in items if c["id"] != camera_id])


def set_every(camera_id: str, every) -> dict:
    """Seconds between two pictures on the page, kept for the next visit."""
    if not isinstance(every, int) or isinstance(every, bool) or not 1 <= every <= 60:
        raise CameraError("camera_every_invalid")
    items = cameras()
    camera = next((c for c in items if c["id"] == camera_id), None)
    if camera is None:
        raise CameraError("camera_not_found")
    camera["every"] = every
    _save(items)
    return camera


def find(camera_id: str) -> dict:
    camera = next((c for c in cameras() if c["id"] == camera_id), None)
    if camera is None:
        raise CameraError("camera_not_found")
    return camera


def image(host: str) -> tuple[bytes, float | None]:
    """The picture the printer wrote last, and its age in seconds when sent: Date minus
    Last-Modified, both by the printer's clock, so the computer's clock does not matter."""
    url = f"http://{host}/server/files/camera/monitor.jpg?t={time.time():.0f}"
    try:
        with urllib.request.urlopen(url, timeout=TIMEOUT) as response:
            data, headers = response.read(), response.headers
    except OSError as exc:
        raise CameraError("camera_unreachable", str(exc)) from None
    try:
        age = (parsedate_to_datetime(headers["Date"]) - parsedate_to_datetime(headers["Last-Modified"])).total_seconds()
    except (TypeError, ValueError):
        age = None
    return data, max(0.0, age) if age is not None else None


def wake(host: str) -> dict:
    """camera.start_monitor, as the printer's web page sends it; returns Moonraker's result."""
    try:
        answer = _rpc(host, "camera.start_monitor", {"domain": "lan", "interval": 0})
    except (OSError, ValueError, ConnectionError, TimeoutError) as exc:
        raise CameraError("camera_unreachable", f"{type(exc).__name__}: {exc}") from None
    if "error" in answer:
        error = answer["error"]
        raise CameraError("camera_refused", error.get("message", str(error)) if isinstance(error, dict) else str(error))
    return answer.get("result") or {}


def _rpc(host: str, method: str, params: dict) -> dict:
    """One JSON-RPC call over Moonraker's WebSocket: handshake, one masked text frame, then frames
    until the answer with our id (Moonraker sends notifications in between)."""
    name, _, port = host.partition(":")
    key = base64.b64encode(os.urandom(16)).decode()
    request_id = int(time.time() * 1000) % 1_000_000
    payload = json.dumps({"jsonrpc": "2.0", "id": request_id, "method": method,
                          "params": dict(params, req_id=request_id)}).encode()
    with socket.create_connection((name, int(port or 80)), timeout=TIMEOUT) as sock:
        sock.sendall((f"GET /websocket HTTP/1.1\r\nHost: {host}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
                      f"Sec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\nOrigin: http://{host}\r\n\r\n").encode())
        buf = b""
        while b"\r\n\r\n" not in buf:
            chunk = sock.recv(4096)
            if not chunk:
                raise ConnectionError("closed during the handshake")
            buf += chunk
        head, buf = buf.split(b"\r\n\r\n", 1)
        status = head.split(b"\r\n")[0].decode(errors="replace")
        if " 101 " not in status:
            raise ConnectionError(f"WebSocket refused: {status}")
        mask = os.urandom(4)
        size = len(payload)
        header = bytes([0x81, 0x80 | size]) if size < 126 else bytes([0x81, 0x80 | 126]) + struct.pack(">H", size)
        sock.sendall(header + mask + bytes(b ^ mask[i % 4] for i, b in enumerate(payload)))

        def read(n: int) -> bytes:
            nonlocal buf
            while len(buf) < n:
                chunk = sock.recv(4096)
                if not chunk:
                    raise ConnectionError("closed before the answer")
                buf += chunk
            out, buf = buf[:n], buf[n:]
            return out

        deadline = time.time() + TIMEOUT
        while time.time() < deadline:
            first, second = read(2)
            length = second & 0x7F
            if length == 126:
                length = struct.unpack(">H", read(2))[0]
            elif length == 127:
                length = struct.unpack(">Q", read(8))[0]
            if second & 0x80:
                read(4)
            frame = read(length)
            opcode = first & 0x0F
            if opcode == 8:
                raise ConnectionError("the printer closed the WebSocket")
            if opcode != 1:
                continue
            try:
                message = json.loads(frame)
            except ValueError:
                continue
            if isinstance(message, dict) and message.get("id") == request_id:
                sock.sendall(bytes([0x88, 0x80]) + os.urandom(4))  # close frame
                return message
        raise TimeoutError("no answer from the printer")
