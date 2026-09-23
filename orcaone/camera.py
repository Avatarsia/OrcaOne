"""Printers in the network: the address of a printer, typed in at its card on the page "Drucker",
and what OrcaOne does with it for a Snapmaker U1 with its stock firmware: the camera (page
"Kamera", after the user's prototypes/U1Cam/u1cam.py) and the status the page "Kalibrieren" reads
(status()).

The camera sleeps until Moonraker's JSON-RPC method camera.start_monitor wakes it, sent over the
printer's WebSocket as its own web page does. Then the printer writes
/server/files/camera/monitor.jpg every few seconds. OrcaOne wakes it while the page shows the
picture and passes the picture through, so the browser needs no access of its own to the printer.

Only addresses the user typed in are asked (section "printers" of OrcaOne's settings): the pages
name a camera by its id, never by an address, so no other page can make OrcaOne fetch from
elsewhere. Standard library only.
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

import psutil

from . import settings

TIMEOUT = 5
# Straight to the printer in the LAN, never through a proxy: on Windows urllib would take the
# system proxy from the registry (urllib.request.getproxies), which cannot reach it.
_direct = urllib.request.build_opener(urllib.request.ProxyHandler({}))
# A host name or IPv4 address with an optional port: nothing that could become a path.
_HOST = re.compile(r"[A-Za-z0-9](?:[A-Za-z0-9.-]{0,251}[A-Za-z0-9])?(?::\d{1,5})?")


class CameraError(Exception):
    """An error code for the API; detail is the technical reason, shown as it is."""

    def __init__(self, code: str, detail: str = ""):
        super().__init__(code)
        self.code, self.detail = code, detail


# Printer models whose camera and status OrcaOne knows; both slicers call the U1 so.
U1_MODELS = {"Snapmaker U1"}


# The addresses the slicers have, {"<model>": {"host", "slicer"}}: "Hostname, IP or URL" of their
# dialog "Physical Printer", saved as print_host in an own printer. Taken from every scan of GET
# /api/data (overview.build_all), so the files stay the only source.
_slicer_hosts: dict = {}


def remember_slicer_hosts(found: dict) -> None:
    global _slicer_hosts
    _slicer_hosts = {model: {**p, "host": host} for model, p in found.items() if (host := normalize(p["host"]))}


def printers() -> dict:
    """The address per printer model: {"<model>": {"host": "10.30.40.174", "from": "orcaone" or
    "slicer", "slicer"?, "every"?}}. One typed in on the page "Drucker" goes before the slicer's;
    every is the seconds between two camera pictures. By model, so the same U1 has one address in
    Snapmaker Orca and in OrcaSlicer."""
    found = settings.load().get("printers")
    own = {m: p for m, p in found.items() if isinstance(p, dict)} if isinstance(found, dict) else {}
    out = {}
    for model in sorted(set(own) | set(_slicer_hosts)):
        mine, theirs = own.get(model, {}), _slicer_hosts.get(model)
        every = {"every": mine["every"]} if isinstance(mine.get("every"), int) else {}
        if isinstance(mine.get("host"), str):
            out[model] = {"host": mine["host"], "from": "orcaone", **every}
        elif theirs:
            out[model] = {"host": theirs["host"], "from": "slicer", "slicer": theirs["slicer"], **every}
    return out


def normalize(raw: str) -> str | None:
    """"http://10.30.40.174/" -> "10.30.40.174"; None if it is no host."""
    host = raw.strip().removeprefix("http://").removeprefix("https://").strip("/")
    return host if _HOST.fullmatch(host) else None


def set_host(model, raw) -> dict:
    """Sets the address of a printer model; an empty one takes it away."""
    if not isinstance(model, str) or not model.strip() or len(model) > 200 or not isinstance(raw, str):
        raise CameraError("printer_invalid")
    host = normalize(raw) if raw.strip() else None
    if raw.strip() and host is None:
        raise CameraError("camera_host_invalid")

    def edit(data):
        found = data.get("printers") if isinstance(data.get("printers"), dict) else {}
        entry = found.get(model) if isinstance(found.get(model), dict) else {}
        if host is None:
            entry.pop("host", None)   # then the slicer's address counts again, if it has one
        else:
            entry["host"] = host
        if entry:
            found[model] = entry
        else:
            found.pop(model, None)
        data["printers"] = found

    settings.change(edit)
    return printers()


def _id(model: str) -> str:
    return hashlib.sha1(model.encode("utf-8")).hexdigest()[:10]


def cameras() -> list[dict]:
    """Every U1 with an address has a camera: [{"id", "model", "host", "every"?}]."""
    return [{"id": _id(model), "model": model, "host": p["host"], **({"every": p["every"]} if "every" in p else {})}
            for model, p in printers().items() if model in U1_MODELS]


def find(camera_id: str) -> dict:
    camera = next((c for c in cameras() if c["id"] == camera_id), None)
    if camera is None:
        raise CameraError("camera_not_found")
    return camera


def set_every(camera_id: str, every) -> dict:
    """Seconds between two pictures on the page, kept for the next visit."""
    if not isinstance(every, int) or isinstance(every, bool) or not 1 <= every <= 60:
        raise CameraError("camera_every_invalid")
    model = find(camera_id)["model"]

    def edit(data):
        found = data.get("printers") if isinstance(data.get("printers"), dict) else {}
        entry = found.get(model) if isinstance(found.get(model), dict) else {}
        found[model] = {**entry, "every": every}   # also for an address from the slicer
        data["printers"] = found

    settings.change(edit)
    return find(camera_id)


# ---------------------------------------------------------------- finding a U1 in the LAN

MDNS_GROUP, MDNS_PORT = "224.0.0.251", 5353
_IPV4 = re.compile(r"\d{1,3}(?:\.\d{1,3}){3}")


def _mdns_query(name: str) -> bytes:
    """A PTR question as Snapmaker Orca asks it (slic3r/Utils/Bonjour.cpp, BonjourRequest::make_PTR):
    id 0, one question, type PTR, class ANY."""
    labels = b"".join(bytes([len(part)]) + part.encode() for part in name.split("."))
    return struct.pack(">6H", 0, 0, 1, 0, 0, 0) + labels + b"\0" + struct.pack(">HH", 12, 255)


def _read_name(data: bytes, pos: int) -> tuple[str, int]:
    """A DNS name at pos, following compression pointers; also the position after it."""
    labels, end = [], None
    for _ in range(64):
        size = data[pos]
        if size & 0xC0 == 0xC0:
            end = end or pos + 2
            pos = ((size & 0x3F) << 8) | data[pos + 1]
        elif size == 0:
            return ".".join(labels), end or pos + 1
        else:
            labels.append(data[pos + 1:pos + 1 + size].decode("utf-8", "replace"))
            pos += 1 + size
    raise ValueError("name too long or a loop")


def _parse_answer(data: bytes, source: str) -> list[dict]:
    """The Snapmaker printers in one mDNS answer: [{"host", "name", "machine_type", "version"}].
    The address is the TXT field "ip", else the A record of the SRV target, else the sender;
    Snapmaker Orca reads the same fields (SSWCP.cpp, sw_StartMachineFind)."""
    try:
        flags, questions, answers, authority, additional = struct.unpack(">5H", data[2:12])
        if not flags & 0x8000:
            return []   # a question, maybe our own
        pos = 12
        for _ in range(questions):
            pos = _read_name(data, pos)[1] + 4
        txt, srv, addresses = {}, {}, {}
        for _ in range(answers + authority + additional):
            name, pos = _read_name(data, pos)
            rtype, _, _, size = struct.unpack(">HHIH", data[pos:pos + 10])
            pos += 10
            if rtype == 16:
                i, fields = pos, {}
                while i < pos + size:
                    entry = data[i + 1:i + 1 + data[i]].decode("utf-8", "replace")
                    key, _, value = entry.partition("=")
                    fields[key.lower()] = value
                    i += 1 + data[i]
                txt[name.lower()] = fields
            elif rtype == 33:
                srv[name.lower()] = _read_name(data, pos + 6)[0].lower()
            elif rtype == 1 and size == 4:
                addresses[name.lower()] = socket.inet_ntoa(data[pos:pos + 4])
            pos += size
    except (IndexError, struct.error, ValueError):
        return []
    found = []
    for instance in set(txt) | set(srv):
        if not instance.endswith("._snapmaker._tcp.local"):
            continue
        fields = txt.get(instance, {})
        ip = fields.get("ip", "")
        host = normalize(ip if _IPV4.fullmatch(ip) else addresses.get(srv.get(instance, ""), source))
        found.append({"host": host, "name": fields.get("device_name") or instance.split("._snapmaker")[0],
                      "machine_type": fields.get("machine_type", ""), "version": fields.get("version", "")})
    return [p for p in found if p["host"]]


def search(seconds: float = 6.0) -> list[dict]:
    """Snapmaker printers in the LAN, found as Snapmaker Orca finds them (SSWCP.cpp, sw_WakeupFind
    and sw_StartMachineFind): on port 5353 in the group 224.0.0.251 of every IPv4 interface, first
    the DNS-SD question that makes access points forward multicast, then _snapmaker._tcp.local every
    2 s. Only in the same LAN: mDNS passes neither routers nor a VPN (docs/FINDINGS.md)."""
    interfaces = [a.address for addrs in psutil.net_if_addrs().values() for a in addrs
                  if a.family == socket.AF_INET and not a.address.startswith("127.")]
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM, socket.IPPROTO_UDP)
    try:
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        if hasattr(socket, "SO_REUSEPORT"):
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEPORT, 1)
        sock.bind(("", MDNS_PORT))
    except OSError as exc:
        sock.close()
        raise CameraError("search_failed", str(exc)) from None
    joined = []
    for address in interfaces:
        try:
            sock.setsockopt(socket.IPPROTO_IP, socket.IP_ADD_MEMBERSHIP, socket.inet_aton(MDNS_GROUP) + socket.inet_aton(address))
            joined.append(address)
        except OSError:
            pass   # a network without multicast, e.g. a VPN

    def ask(name: str) -> None:
        for address in joined:
            try:
                sock.setsockopt(socket.IPPROTO_IP, socket.IP_MULTICAST_IF, socket.inet_aton(address))
                sock.sendto(_mdns_query(name), (MDNS_GROUP, MDNS_PORT))
            except OSError:
                pass

    found = {}
    with sock:
        sock.settimeout(0.3)
        ask("_services._dns-sd._udp.local")
        ask("_snapmaker._tcp.local")
        deadline, next_ask = time.time() + seconds, time.time() + 2
        while time.time() < deadline:
            if time.time() >= next_ask:
                ask("_snapmaker._tcp.local")
                next_ask += 2
            try:
                data, (source, _) = sock.recvfrom(9000)
            except socket.timeout:
                continue
            except OSError:
                continue   # Windows reports an ICMP "unreachable" of an earlier send here
            for printer in _parse_answer(data, source):
                found.setdefault(printer["host"], printer)
    return sorted(found.values(), key=lambda p: p["host"])


HEADS = ["extruder", "extruder1", "extruder2", "extruder3"]
_COLOUR = re.compile(r"[0-9A-Fa-f]{6}")


def _at(values, i: int):
    return values[i] if isinstance(values, list) and i < len(values) else None


def status(host: str) -> dict:
    """Read only, one query to Moonraker (checked on the U1 on 23.09.2026): per head the spool the
    printer knows (print_task_config; with RFID also its data from filament_detect) and the
    pressure advance the firmware uses now. A value the Flow Calibration at print start measured
    is not round (0.017665), one from the slicer or the firmware is (0.02). Plus what the printer
    is doing and whether the job calibrates."""
    objects = [f"{h}=pressure_advance,temperature,target" for h in HEADS]
    objects += ["print_stats=state,filename", "display_status=progress", "toolhead=extruder", "print_task_config", "filament_detect"]
    try:
        with _direct.open(f"http://{host}/printer/objects/query?{'&'.join(objects)}", timeout=TIMEOUT) as response:
            found = json.loads(response.read())["result"]["status"]
        if not isinstance(found, dict):
            raise ValueError("no status")
    except (OSError, ValueError, KeyError, TypeError) as exc:
        raise CameraError("camera_unreachable", str(exc)) from None
    task = found.get("print_task_config") if isinstance(found.get("print_task_config"), dict) else {}
    rfid = (found.get("filament_detect") or {}).get("info") if isinstance(found.get("filament_detect"), dict) else None
    heads = []
    for i, name in enumerate(HEADS):
        extruder = found.get(name)
        if not isinstance(extruder, dict):
            continue
        spool = None
        if _at(task.get("filament_exist"), i):
            colour = str(_at(task.get("filament_color_rgba"), i) or "")[:6]
            spool = {"vendor": _at(task.get("filament_vendor"), i), "type": _at(task.get("filament_type"), i),
                     "subtype": _at(task.get("filament_sub_type"), i),
                     "colour": "#" + colour.upper() if _COLOUR.fullmatch(colour) else None, "rfid": False}
            tag = _at(rfid, i)
            # A spool without a tag reads "NONE" everywhere; its data was typed in at the printer.
            if isinstance(tag, dict) and tag.get("VENDOR") not in (None, "", "NONE"):
                spool.update(rfid=True, maker=tag.get("MANUFACTURER"), temp_min=tag.get("HOTEND_MIN_TEMP"),
                             temp_max=tag.get("HOTEND_MAX_TEMP"), temp=tag.get("OTHER_LAYER_TEMP"),
                             dry_temp=tag.get("DRYING_TEMP"), dry_hours=tag.get("DRYING_TIME"))
        heads.append({"extruder": name, "pa": extruder.get("pressure_advance"), "temp": extruder.get("temperature"),
                      "target": extruder.get("target"), "calibrate": bool(_at(task.get("flow_calib_extruders"), i)),
                      "spool": spool})
    stats = found.get("print_stats") if isinstance(found.get("print_stats"), dict) else {}
    return {"state": stats.get("state"), "file": stats.get("filename") or None,
            "progress": (found.get("display_status") or {}).get("progress"),
            "active": (found.get("toolhead") or {}).get("extruder"),
            "flow_calibrate": bool(task.get("flow_calibrate")), "heads": heads}


def image(host: str) -> tuple[bytes, float | None]:
    """The picture the printer wrote last, and its age in seconds when sent: Date minus
    Last-Modified, both by the printer's clock, so the computer's clock does not matter."""
    url = f"http://{host}/server/files/camera/monitor.jpg?t={time.time():.0f}"
    try:
        with _direct.open(url, timeout=TIMEOUT) as response:
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
