"""Printers in the network: the address of a printer, typed in at its card on the page "Drucker",
and what OrcaOne does with it for a Snapmaker U1 with its stock firmware: the camera (page
"Kamera", after the user's prototypes/U1Cam/u1cam.py) and the status the pages "Kamera" and
"Kalibrieren" read (status()). For any printer with Klipper and Moonraker, the card on the page
"Drucker" shows what info() and status() read.

The camera sleeps until Moonraker's JSON-RPC method camera.start_monitor wakes it, sent over the
printer's WebSocket as its own web page does. Then the printer writes
/server/files/camera/monitor.jpg every few seconds. OrcaOne wakes it while the page shows the
picture and passes the picture through, so the browser needs no access of its own to the printer.

In this module OrcaOne sends a printer one command, on the user's wish of 24.09.2026: the light in
the U1 on or off (set_light), since the camera sees nothing without it.

Only addresses the user typed in are asked (section "printers" of OrcaOne's settings): the pages
name a camera by its id, never by an address, so no other page can make OrcaOne fetch from
elsewhere. Standard library only.
"""

import base64
import hashlib
import http.client
import json
import os
import re
import socket
import struct
import time
import urllib.error
import urllib.parse
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


# The addresses the slicers have, {"<name>": {"host", "slicer", "model"}}: "Hostname, IP or URL" of
# their dialog "Physical Printer", saved as print_host in an own printer, else the address of a
# printer Snapmaker Orca connected to (.conf "devices"). Taken from every scan of GET /api/data
# (overview.build_all), so the files stay the only source.
_slicer_hosts: dict = {}


def remember_slicer_hosts(found: list) -> None:
    """found: [{"model", "host", "slicer", "name"}], the one that counts first; name is the printer
    profile of the address, None for a printer Snapmaker Orca connected to. The first address of a
    model goes by the model, as addresses always did. Another printer profile of the same model with
    an address of its own is a second printer of it (the user's two Voron), by the profile's name.
    Otherwise the first address counts: the same profile in another installation, or a connected
    printer, may only have an old one."""
    global _slicer_hosts
    out, hosts, names = {}, set(), set()
    for f in found:
        host, name = normalize(f["host"]), f.get("name")
        if not host or host in hosts:
            continue
        if f["model"] not in out:
            key = f["model"]
        elif name and name not in names and name not in out:
            key = name
        else:
            continue
        hosts.add(host)
        if name:
            names.add(name)
        out[key] = {"host": host, "slicer": f["slicer"], "model": f["model"]}
    _slicer_hosts = out


def printers() -> dict:
    """The printers with an address, by name: {"<name>": {"host": "10.30.40.174", "from": "orcaone"
    or "slicer", "slicer"?, "model", "every"?, "ssh"?}}. The first printer of a model goes by the model, so
    the same U1 has one address in Snapmaker Orca and in OrcaSlicer; a second one of the same model
    by a name of its own (add_printer, or its printer profile in the slicer). One typed in on the
    page "Drucker" goes before the slicer's, and the slicer's address of a printer typed in under
    another name is that printer. every is the seconds between two camera pictures."""
    found = settings.load().get("printers")
    own = {m: p for m, p in found.items() if isinstance(p, dict)} if isinstance(found, dict) else {}
    typed = {p["host"] for p in own.values() if isinstance(p.get("host"), str)}
    out = {}
    for key in sorted(set(own) | set(_slicer_hosts)):
        mine, theirs = own.get(key, {}), _slicer_hosts.get(key)
        model = mine["model"] if isinstance(mine.get("model"), str) else theirs["model"] if theirs else key
        extra = {"every": mine["every"]} if isinstance(mine.get("every"), int) else {}
        # SSH user and key (ssh.save_setting), only what could be one.
        ssh = mine.get("ssh") if isinstance(mine.get("ssh"), dict) else {}
        ssh = {k: v for k, v in ssh.items() if k in ("user", "key", "login") and isinstance(v, str) and 0 < len(v) <= 100}
        extra = {**extra, **({"ssh": ssh} if ssh else {})}
        if isinstance(mine.get("host"), str):
            out[key] = {"host": mine["host"], "from": "orcaone", "model": model, **extra}
        elif theirs and theirs["host"] not in typed:
            out[key] = {"host": theirs["host"], "from": "slicer", "slicer": theirs["slicer"], "model": model, **extra}
    return out


def normalize(raw: str) -> str | None:
    """"http://10.30.40.174/" -> "10.30.40.174"; None if it is no host."""
    host = raw.strip().removeprefix("http://").removeprefix("https://").strip("/")
    return host if _HOST.fullmatch(host) else None


def set_host(model, raw) -> dict:
    """Sets the address of a printer by its name (printers()); an empty one takes it away, and a
    printer added under a name of its own (add_printer) with it."""
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
            if "model" in entry:
                entry = {}
        else:
            entry["host"] = host
        if entry:
            found[model] = entry
        else:
            found.pop(model, None)
        data["printers"] = found

    settings.change(edit)
    return printers()


def add_printer(model, name, raw) -> dict:
    """Another printer of a model that has one already (the user's wish of 25.09.2026: two printers
    of one model), under a name of its own; its model gives its picture and what OrcaOne knows of it."""
    if not all(isinstance(x, str) and x.strip() and len(x) <= 200 for x in (model, name)) or not isinstance(raw, str):
        raise CameraError("printer_invalid")
    name, model, host = name.strip(), model.strip(), normalize(raw)
    if host is None:
        raise CameraError("camera_host_invalid")
    if name in printers():
        raise CameraError("printer_name_taken")

    def edit(data):
        found = data.get("printers") if isinstance(data.get("printers"), dict) else {}
        found[name] = {"host": host, "model": model}
        data["printers"] = found

    settings.change(edit)
    return printers()


def host_of(model) -> str:
    """The address of a printer by its name, only one printers() knows: the pages name a printer,
    never an address."""
    found = printers().get(model) if isinstance(model, str) else None
    if not found:
        raise CameraError("printer_not_found")
    return found["host"]


def _id(model: str) -> str:
    return hashlib.sha1(model.encode("utf-8")).hexdigest()[:10]


def cameras() -> list[dict]:
    """Every U1 with an address has a camera: [{"id", "printer", "model", "host", "every"?}], printer
    its name in printers()."""
    return [{"id": _id(key), "printer": key, "model": p["model"], "host": p["host"], **({"every": p["every"]} if "every" in p else {})}
            for key, p in printers().items() if p["model"] in U1_MODELS]


def find(camera_id: str) -> dict:
    camera = next((c for c in cameras() if c["id"] == camera_id), None)
    if camera is None:
        raise CameraError("camera_not_found")
    return camera


def set_every(camera_id: str, every) -> dict:
    """Seconds between two pictures on the page, kept for the next visit."""
    if not isinstance(every, int) or isinstance(every, bool) or not 1 <= every <= 60:
        raise CameraError("camera_every_invalid")
    key = find(camera_id)["printer"]

    def edit(data):
        found = data.get("printers") if isinstance(data.get("printers"), dict) else {}
        entry = found.get(key) if isinstance(found.get(key), dict) else {}
        found[key] = {**entry, "every": every}   # also for an address from the slicer
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


def _part(found: dict, name: str) -> dict:
    return found.get(name) if isinstance(found.get(name), dict) else {}


# The slicer's print time for a whole file, by (host, file): it never changes for a file.
_estimates: dict = {}


def _estimate(host: str, file: str) -> float | None:
    """estimated_time from Moonraker's metadata of the file, which the slicer wrote into it."""
    if (host, file) not in _estimates:
        url = f"http://{host}/server/files/metadata?filename={urllib.parse.quote(file)}"
        with _direct.open(url, timeout=TIMEOUT) as response:
            estimate = json.loads(response.read())["result"].get("estimated_time")
        _estimates[(host, file)] = estimate if isinstance(estimate, (int, float)) and estimate > 0 else None
    return _estimates[(host, file)]


def _left(host: str, stats: dict, progress) -> float | None:
    """Seconds left in a print: the slicer's time for the file minus the time printed so far.
    Klipper's print_duration leaves out the heating before the first extrusion and pauses; on the
    U1 a print of 5289 s by the slicer took 5333 s. Without a slicer time: from the progress."""
    printed, file = stats.get("print_duration"), stats.get("filename")
    if stats.get("state") not in ("printing", "paused") or not file or not isinstance(printed, (int, float)):
        return None
    try:
        estimate = _estimate(host, file)
    except (OSError, ValueError, KeyError, TypeError, AttributeError):
        estimate = None   # not kept, asked again with the next status
    if estimate:
        return max(0.0, estimate - printed)
    if isinstance(progress, (int, float)) and progress > 0:
        return printed / progress - printed
    return None


# What status() asks Klipper for, "object=field,field" for some fields only.
STATUS_OBJECTS = [f"{h}=pressure_advance,temperature,target" for h in HEADS] + [
    "print_stats", "display_status=progress", "toolhead=extruder", "heater_bed=temperature,target",
    "temperature_sensor cavity=temperature", "print_task_config", "filament_detect", "led cavity_led=color_data",
    "virtual_sdcard=file_position"]


def query(host: str, objects: list) -> dict:
    """Klipper's objects by name, in one query to Moonraker; objects the printer lacks are missing
    in the answer. Raises CameraError."""
    names = "&".join(urllib.parse.quote(o, safe="=,") for o in objects)
    try:
        with _direct.open(f"http://{host}/printer/objects/query?{names}", timeout=TIMEOUT) as response:
            found = json.loads(response.read())["result"]["status"]
        if not isinstance(found, dict):
            raise ValueError("no status")
    except (OSError, ValueError, KeyError, TypeError) as exc:
        raise CameraError("camera_unreachable", str(exc)) from None
    return found


def status(host: str) -> dict:
    """Read only, one query to Moonraker (checked on the U1 on 23.09.2026): per head the spool the
    printer knows (print_task_config; with RFID also its data from filament_detect) and the
    pressure advance the firmware uses now. A value the Flow Calibration at print start measured
    is not round (0.017665), one from the slicer or the firmware is (0.02). Plus what the printer
    is doing: the job, whether it calibrates, layer, time printed and left, the temperatures of
    heads, bed and inside the printer. light: whether the LED in the printer is on (None without one);
    off, the camera sends a black picture (checked on the U1 on 24.09.2026)."""
    return status_of(host, query(host, STATUS_OBJECTS))


def status_of(host: str, found: dict) -> dict:
    """status() from objects read already: those of STATUS_OBJECTS, or more of them (monitor.py)."""
    task = _part(found, "print_task_config")
    rfid = _part(found, "filament_detect").get("info")
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
    stats, bed = _part(found, "print_stats"), _part(found, "heater_bed")
    info = stats.get("info") if isinstance(stats.get("info"), dict) else {}
    progress = _part(found, "display_status").get("progress")
    return {"state": stats.get("state"), "file": stats.get("filename") or None, "progress": progress,
            "active": _part(found, "toolhead").get("extruder"),
            "flow_calibrate": bool(task.get("flow_calibrate")), "heads": heads,
            "layer": info.get("current_layer"), "layers": info.get("total_layer"),
            "printed": stats.get("print_duration"), "left": _left(host, stats, progress),
            "bed": {"temp": bed.get("temperature"), "target": bed.get("target")},
            "cavity": _part(found, "temperature_sensor cavity").get("temperature"), "light": _light(_part(found, "led cavity_led")),
            # Where in the print file Klipper reads, in bytes: "3D Ansicht" and "2D Ansicht" follow the print with it.
            "file_position": _part(found, "virtual_sdcard").get("file_position")}


def set_light(host: str, on: bool) -> bool:
    """The light in the U1 on or off: its LED has a white channel only (printer.cfg, [led
    cavity_led] white_pin), so Klipper's SET_LED with WHITE, sent as Moonraker's web page sends G-code."""
    script = urllib.parse.quote(f"SET_LED LED=cavity_led WHITE={1 if on else 0}")
    request = urllib.request.Request(f"http://{host}/printer/gcode/script?script={script}", data=b"", method="POST")
    try:
        with _direct.open(request, timeout=TIMEOUT) as response:
            json.loads(response.read())["result"]
    except urllib.error.HTTPError as exc:
        raise CameraError("camera_refused", f"HTTP {exc.code}") from None
    except (OSError, ValueError, KeyError, TypeError) as exc:
        raise CameraError("camera_unreachable", str(exc)) from None
    return on


def _light(led: dict) -> bool | None:
    """On if any channel of any LED of the chain shines: color_data is [[r, g, b, w], …]."""
    data = led.get("color_data")
    if not isinstance(data, list) or not data:
        return None
    return any(isinstance(v, (int, float)) and v > 0 for colour in data if isinstance(colour, list) for v in colour)


def _get(host: str, path: str):
    """The "result" of a GET to Moonraker."""
    try:
        with _direct.open(f"http://{host}{path}", timeout=TIMEOUT) as response:
            return json.loads(response.read())["result"]
    except (OSError, ValueError, KeyError, TypeError) as exc:
        raise CameraError("camera_unreachable", str(exc)) from None


def info(host: str) -> dict:
    """Read only, standard Moonraker of any Klipper printer (checked on the U1 on 24.09.2026): what
    the card on the page "Drucker" shows. A Snapmaker printer adds its name, firmware and the nozzle
    per head (product_info of /machine/system_info; snapmaker/product_info.json in its config folder
    kept an older firmware). Then Klipper and Moonraker, the storage and what fills it, the prints in
    total and the computer inside. Nothing of the serial number. A part the printer does not answer
    is None; without /machine/system_info the printer counts as unreachable."""
    system = _get(host, "/machine/system_info").get("system_info") or {}
    product = system.get("product_info") if isinstance(system.get("product_info"), dict) else {}
    cpu = system.get("cpu_info") if isinstance(system.get("cpu_info"), dict) else {}
    python = system.get("python") if isinstance(system.get("python"), dict) else {}
    network = system.get("network") if isinstance(system.get("network"), dict) else {}

    def optional(path, pick):
        try:
            return pick(_get(host, path))
        except (CameraError, AttributeError, KeyError, TypeError, ValueError):
            return None

    klipper = optional("/printer/info", lambda r: {"version": r.get("software_version"), "state": r.get("state")}) or {}
    return {
        "name": product.get("device_name") or None, "firmware": product.get("firmware_version") or None,
        "nozzles": [d for d in product.get("nozzle_diameter") or [] if isinstance(d, (int, float))],
        "os": (system.get("distribution") or {}).get("name") or None,
        # The interface that carries the address: wlan… or eth…
        "network": next((name for name, i in network.items() if name != "lo" and isinstance(i, dict)
                         and any(a.get("family") == "ipv4" for a in i.get("ip_addresses") or [])), None),
        "klipper": klipper.get("version"), "state": klipper.get("state"),
        "moonraker": optional("/server/info", lambda r: r.get("moonraker_version")),
        "disk": optional("/server/files/directory?path=gcodes&extended=false", lambda r: r["disk_usage"]),
        "folders": {root: optional(f"/server/files/list?root={root}", lambda r: sum(f.get("size", 0) for f in r))
                    for root in ("gcodes", "camera", "logs")},
        # The U1 keeps its time-lapse videos in "camera" (FINDINGS, "Dateien auf dem U1").
        "videos": optional("/server/files/list?root=camera", lambda r: sum(1 for f in r if str(f.get("path", "")).endswith(".mp4"))),
        "jobs": optional("/server/history/totals", lambda r: r["job_totals"]),
        "system": optional("/machine/proc_stats", lambda r: {"uptime": r.get("system_uptime"), "cpu_temp": r.get("cpu_temp"),
                                                             "memory": r.get("system_memory")}),
        # For the tab "System" on "Status" (the user's wish of 27.09.2026): what the computer inside is, and
        # each microcontroller with its chip and firmware (the U1: its board and one per head). Never the
        # serial number of cpu_info.
        "cpu": {"model": next((str(cpu[k]) for k in ("cpu_desc", "model", "hardware_desc", "processor") if cpu.get(k)), None),
                "cores": cpu.get("cpu_count") if isinstance(cpu.get("cpu_count"), int) else None} if cpu else None,
        "python": str(python.get("version_string") or "").split(" ")[0] or None,
        "mcus": optional("/printer/objects/list", lambda r: _mcus(host, r["objects"])),
    }


def _mcus(host: str, objects: list) -> list[dict]:
    """Every microcontroller in Klipper's list ("mcu", "mcu e0" …): {"name", "chip", "version"}."""
    names = [o for o in objects if isinstance(o, str) and (o == "mcu" or o.startswith("mcu "))]
    if not names:
        return []
    query = "&".join(f"{urllib.parse.quote(n)}=mcu_version,mcu_constants" for n in names)
    found = _get(host, f"/printer/objects/query?{query}").get("status") or {}
    return [{"name": n, "chip": ((found.get(n) or {}).get("mcu_constants") or {}).get("MCU"), "version": (found.get(n) or {}).get("mcu_version")}
            for n in names]


def image(host: str) -> tuple[bytes, float | None]:
    """The picture the printer wrote last, and its age in seconds when sent: Date minus
    Last-Modified, both by the printer's clock, so the computer's clock does not matter."""
    url = f"http://{host}/server/files/camera/monitor.jpg?t={time.time():.0f}"
    for attempt in range(2):
        try:
            with _direct.open(url, timeout=TIMEOUT) as response:
                data, headers = response.read(), response.headers
            break
        except http.client.IncompleteRead as exc:
            # The printer rewrote the picture while sending it (seen on the U1, 24.09.2026);
            # asking again gets the new one whole.
            if attempt:
                raise CameraError("camera_unreachable", str(exc)) from None
        except (OSError, http.client.HTTPException) as exc:
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


def _rpc(host: str, method: str, params: dict, timeout: float = TIMEOUT) -> dict:
    """One JSON-RPC call over Moonraker's WebSocket: handshake, one masked text frame, then frames
    until the answer with our id (Moonraker sends notifications in between)."""
    name, _, port = host.partition(":")
    key = base64.b64encode(os.urandom(16)).decode()
    request_id = int(time.time() * 1000) % 1_000_000
    payload = json.dumps({"jsonrpc": "2.0", "id": request_id, "method": method,
                          "params": dict(params, req_id=request_id)}).encode()
    with socket.create_connection((name, int(port or 80)), timeout=timeout) as sock:
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

        deadline = time.time() + timeout
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
