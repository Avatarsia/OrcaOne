"""The page "Netzwerk" (the user's wish of 25.09.2026, grown out of the page "WLAN": sending from
Snapmaker Orca crawled now and then, only switching the U1 off and on helped): how a printer is in
the network, and where it gets stuck. docs/FINDINGS.md, "WLAN des U1" and "Netzwerk des U1".

Without SSH, over Moonraker, for any Klipper printer: its interfaces with MAC and addresses and the
one OrcaOne speaks to (machine.system_info), USB network adapters (machine/peripherals/usb), how
long it takes to answer, its clock, and this computer's side (in the printer's network or not).
The traffic per interface comes live (live.py, monitor.shape).

With SSH, on the U1 (Root Access on; this computer's keys only for a page on it, app.is_remote):
every EVERY seconds the WLAN chip (signal, rates, access point, power saving) and the links (state,
speed of a cable, errors), after the login the default route and DNS; on click the checks (router,
internet by address and by name), the WLANs around, and the actions: connect anew, power saving
off, start anew, each waiting until the printer answers again; and the speed test, without SSH.

Messages to the page, JSON: {"type": "info", "interfaces", "usb", "computer"}, {"type": "ssh",
"state": "open" | "failed" | "none", "code"?, "via"?}, {"type": "values", "time", …parse(),
"links"} while the chip answers, {"type": "lost", "code"} while SSH does not, {"type": "route",
"gateway", "device", "dns"}, {"type": "check", "item", "state", "ms"?, "value"?}, {"type": "scan",
"networks"}, {"type": "waiting" | "back", "action", "seconds"}, {"type": "failed", "action",
"code", "detail"?}, {"type": "speed", "latency", "down", "bytes"}, {"type": "error", "code"}
before the page ends. From the page: {"do": one of ACTIONS}.
"""

import asyncio
import ipaddress
import json
import re
import socket
import statistics
import time
import urllib.parse
import urllib.request
from email.utils import parsedate_to_datetime

import paramiko
import psutil
from starlette.websockets import WebSocket, WebSocketDisconnect

from . import camera, ssh
from .camera import CameraError

USER = "root"
EVERY = 2            # s between two readings of the chip while the page is open
TIMEOUT = 10         # s for one command
SETTLE = 3           # s after "connect anew" before waiting: the link goes two seconds after the command
WAIT = {"reconnect": 90, "reboot": 240}   # s from the click until the printer must answer again
GONE = 60            # s until a printer starting anew must stop answering
POLL = 1             # s between two tries whether it answers
LIMIT = 4 * 1024 * 1024   # bytes of a print file the speed test reads, and only reads
ACTIONS = ("check", "scan", "speed", "reconnect", "power_save_off", "reboot")
CHECKS = ("printer", "clock", "router", "internet", "dns")
# A well-known name, to see whether the printer's DNS answers.
NAME = "snapmaker.com"

READ = ("iw dev wlan0 link; echo @@; iw dev wlan0 get power_save; echo @@; iw dev wlan0 station dump; echo @@; "
        "ip -j -s link; echo @@; grep -H . /sys/class/net/*/speed /sys/class/net/*/duplex 2>/dev/null")
ROUTE = "ip -j route; echo @@; cat /etc/resolv.conf"
# Connecting anew with the printer's own supplicant: the U1 runs wpa_supplicant (the Extended
# Firmware puts it in the stock cgroup "apps"), and "reassociate" makes it scan and connect to the
# best access point again. Without wpa_cli, or if it cannot reach wpa_supplicant, the link is
# dropped, and wpa_supplicant connects again as after any drop. Detached and two seconds later, so
# the SSH command returns before the link goes; trap: not ended with the SSH session.
RECONNECT = ("(trap '' HUP; sleep 2; wpa_cli -i wlan0 reassociate | grep -q OK || iw dev wlan0 disconnect)"
             " </dev/null >/dev/null 2>&1 &")
REBOOT = "(trap '' HUP; sleep 2; reboot) </dev/null >/dev/null 2>&1 &"
# Until the chip or the printer starts anew; the Extended Firmware switches it off every minute
# for that reason (/usr/sbin/wlan-powersave-disable).
POWER_SAVE_OFF = "iw dev wlan0 set power_save off"
# The WLANs around: a fresh scan takes the radio off its channel for a moment, so only on click;
# while wpa_supplicant scans itself ("busy"), what the chip found last.
SCAN = "iw dev wlan0 scan 2>/dev/null || iw dev wlan0 scan dump"
# A USB device that is a network adapter, by what it says of itself.
_ADAPTER = re.compile(r"ethernet|\blan\b|network|rtl81[0-9]{2}|ax88|asix|r815", re.IGNORECASE)

# A field of iw's answers, its value on the same line only: a heading like "Information elements
# from Probe Response frame:" would else take the next line ("SSID: …") as its value.
_FIELD = re.compile(r"^[ \t]*([A-Za-z][A-Za-z ]*?):[ \t]*(.*?)[ \t]*$", re.M)
_NUMBER = re.compile(r"-?\d+(?:\.\d+)?")


# ---------------------------------------------------------------- what the printer's tools say
def channel(frequency: int | None) -> int | None:
    """The channel of a frequency in MHz, in the 2.4 GHz band, the only one of the U1: 2412 is 1,
    then one every 5 MHz, 2484 is 14."""
    if frequency == 2484:
        return 14
    if frequency and 2412 <= frequency <= 2472 and (frequency - 2407) % 5 == 0:
        return (frequency - 2407) // 5
    return None


def _number(found: dict, key: str) -> float | None:
    match = _NUMBER.match(found.get(key, ""))
    return float(match.group()) if match else None


def _whole(found: dict, key: str) -> int | None:
    value = _number(found, key)
    return None if value is None else int(value)


def parse(text: str) -> dict:
    """What iw says (the first three parts of READ), for the page: connected (None if iw says
    nothing useful), SSID, the access point's address, frequency and channel, signal in dBm, the
    rates in MBit/s the chip receives and sends with, power saving; from the station dump, where the
    driver gives them, the seconds connected and the counters of sent packets, retries, failures."""
    link, _, rest = text.partition("@@")
    power, _, rest = rest.partition("@@")
    station = rest.partition("@@")[0]
    saving = re.search(r"Power save:\s*(on|off)", power)
    out = {"connected": None, "power_save": saving.group(1) == "on" if saving else None}
    head = re.search(r"Connected to ([0-9a-fA-F:]{17})", link)
    if head is None:
        if "Not connected" in link:
            out["connected"] = False
        return out
    values, stats = dict(_FIELD.findall(link)), dict(_FIELD.findall(station))
    frequency = _whole(values, "freq")
    out.update(connected=True, ssid=values.get("SSID"), access_point=head.group(1).lower(), frequency=frequency,
               channel=channel(frequency), signal=_number(values, "signal"), rx_rate=_number(values, "rx bitrate"),
               tx_rate=_number(values, "tx bitrate"), connected_time=_whole(stats, "connected time"),
               tx_packets=_whole(stats, "tx packets"), tx_retries=_whole(stats, "tx retries"), tx_failed=_whole(stats, "tx failed"))
    return out


def links(text: str) -> list[dict]:
    """The network interfaces (the last two parts of READ: `ip -j -s link` and the speed and duplex
    of each from /sys/class/net): name, state, MAC, the counters of errors and dropped packets, how
    often the link came and went (carrier_changes, where the kernel says), a cable's Mbit/s and
    duplex. Only ethernet-like ones: no loopback, CAN or tunnel."""
    parts = text.split("@@")
    try:
        found = json.loads(parts[3]) if len(parts) > 3 else []
    except ValueError:
        found = []
    sysfs = {}
    for line in (parts[4] if len(parts) > 4 else "").splitlines():
        match = re.fullmatch(r"/sys/class/net/([^/]+)/(speed|duplex):(.+)", line.strip())
        if match:
            sysfs.setdefault(match.group(1), {})[match.group(2)] = match.group(3)
    out = []
    for i in found if isinstance(found, list) else []:
        if not isinstance(i, dict) or i.get("link_type") != "ether" or not isinstance(i.get("ifname"), str):
            continue
        stats = i.get("stats64") if isinstance(i.get("stats64"), dict) else {}
        rx, tx = stats.get("rx") or {}, stats.get("tx") or {}
        speed = sysfs.get(i["ifname"], {}).get("speed", "")
        out.append({"name": i["ifname"], "state": str(i.get("operstate", "")).lower(), "mac": i.get("address"),
                    "errors": (rx.get("errors") or 0) + (tx.get("errors") or 0), "dropped": (rx.get("dropped") or 0) + (tx.get("dropped") or 0),
                    "carrier_changes": i.get("carrier_changes"),
                    # -1 while no cable is in (the kernel's SPEED_UNKNOWN).
                    "speed": int(speed) if speed.isdigit() and int(speed) > 0 else None,
                    "duplex": sysfs.get(i["ifname"], {}).get("duplex")})
    return out


def route(text: str) -> dict:
    """The default route and the DNS servers (ROUTE): {"gateway", "device", "dns": [...]}."""
    table, _, resolv = text.partition("@@")
    try:
        found = json.loads(table)
    except ValueError:
        found = []
    default = next((r for r in found if isinstance(r, dict) and r.get("dst") == "default"), {}) if isinstance(found, list) else {}
    dns = re.findall(r"^\s*nameserver\s+(\S+)", resolv, re.M)
    return {"gateway": default.get("gateway"), "device": default.get("dev"), "dns": dns}


def ping(text: str) -> dict:
    """ping's summary, iputils and BusyBox alike: {"loss": percent, "ms": average} or None each."""
    loss = re.search(r"(\d+(?:\.\d+)?)% packet loss", text)
    average = re.search(r"= [\d.]+/([\d.]+)/", text)
    return {"loss": float(loss.group(1)) if loss else None, "ms": round(float(average.group(1))) if average else None}


def networks(text: str) -> list[dict]:
    """The WLANs iw found (SCAN): per access point SSID, address, frequency, channel, signal, and
    whether the printer is connected to it; strongest first, at most 40."""
    out = []
    for block in re.split(r"^BSS ", text, flags=re.M)[1:]:
        head = re.match(r"([0-9a-fA-F:]{17})", block)
        if not head:
            continue
        values = dict(_FIELD.findall(block))
        frequency = _whole(values, "freq")
        out.append({"bssid": head.group(1).lower(), "ssid": values.get("SSID", ""), "frequency": frequency,
                    "channel": channel(frequency), "signal": _number(values, "signal"),
                    "associated": "-- associated" in block.split("\n", 1)[0]})
    return sorted(out, key=lambda n: -(n["signal"] if n["signal"] is not None else -999))[:40]


# ---------------------------------------------------------------- what Moonraker says, no SSH
def interfaces(host: str) -> list[dict]:
    """The printer's interfaces as Moonraker lists them (up, with an address): name, MAC, IPv4 and
    IPv6, and whether OrcaOne speaks to the printer over it."""
    network = (camera._get(host, "/machine/system_info").get("system_info") or {}).get("network")
    target = ssh.hostname(host)
    try:
        target = socket.gethostbyname(target)
    except OSError:
        pass
    out = []
    for name, i in (network.items() if isinstance(network, dict) else []):
        if not isinstance(i, dict):
            continue
        addresses = [a for a in i.get("ip_addresses") or [] if isinstance(a, dict) and isinstance(a.get("address"), str)]
        out.append({"name": name, "mac": i.get("mac_address"),
                    "ipv4": [a["address"] for a in addresses if a.get("family") == "ipv4"],
                    "ipv6": [a["address"] for a in addresses if a.get("family") == "ipv6" and not a.get("is_link_local")],
                    "used": any(a["address"] == target for a in addresses)})
    return out


def usb(host: str) -> list[dict] | None:
    """USB network adapters on the printer (a USB-to-LAN adapter shows up here even without a
    driver); None if Moonraker has no such list."""
    try:
        found = camera._get(host, "/machine/peripherals/usb").get("usb_devices")
    except (CameraError, AttributeError):
        return None
    out = []
    for d in found if isinstance(found, list) else []:
        if not isinstance(d, dict):
            continue
        text = " ".join(str(d.get(k) or "") for k in ("manufacturer", "product", "description", "class"))
        if _ADAPTER.search(text):
            out.append({"name": " ".join(str(d.get(k)) for k in ("manufacturer", "product") if d.get(k)) or str(d.get("description") or ""),
                        "id": f"{d.get('vendor_id', '')}:{d.get('product_id', '')}"})
    return out


def computer(host: str) -> dict:
    """This computer's side: the address it speaks to the printer from, and whether the printer is
    in its network (else a router or a VPN lies between, and "Im LAN suchen" cannot find it). A UDP
    socket connected to the printer sends nothing."""
    try:
        target = socket.gethostbyname(ssh.hostname(host))
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
            sock.connect((target, 9))
            mine = sock.getsockname()[0]
    except OSError:
        return {"address": None, "same_net": None}
    for addresses in psutil.net_if_addrs().values():
        for a in addresses:
            if a.family == socket.AF_INET and a.address == mine and a.netmask:
                net = ipaddress.ip_interface(f"{mine}/{a.netmask}").network
                return {"address": mine, "same_net": ipaddress.ip_address(target) in net}
    return {"address": mine, "same_net": None}


def answer_time(host: str) -> dict:
    """How long Moonraker takes to answer (median of five, ms), and how far the printer's clock is
    off this computer's (s, from the Date of the last answer; positive: the printer is ahead)."""
    took, offset = [], None
    for _ in range(5):
        start = time.monotonic()
        try:
            with camera._direct.open(f"http://{host}/server/info", timeout=5) as response:
                response.read()
                date = response.headers.get("Date")
        except OSError as exc:
            raise CameraError("camera_unreachable", str(exc)) from None
        took.append(time.monotonic() - start)
        if date:
            try:
                offset = round(parsedate_to_datetime(date).timestamp() - time.time())
            except (TypeError, ValueError):
                pass
    return {"ms": round(statistics.median(took) * 1000), "clock": offset}


def measure(host: str) -> dict:
    """Read only, over Moonraker, no SSH: how long the printer takes to answer (median of five, ms),
    and how fast the start of its largest print file comes (MBit/s, at most LIMIT bytes, only read)."""
    took = []
    for _ in range(5):
        start = time.monotonic()
        camera._get(host, "/server/info")
        took.append(time.monotonic() - start)
    files = [f for f in camera._get(host, "/server/files/list?root=gcodes") or []
             if isinstance(f, dict) and isinstance(f.get("path"), str) and isinstance(f.get("size"), int)]
    if not files:
        raise CameraError("wifi_no_file")
    biggest = max(files, key=lambda f: f["size"])
    request = urllib.request.Request(f"http://{host}/server/files/gcodes/{urllib.parse.quote(biggest['path'])}",
                                     headers={"Range": f"bytes=0-{LIMIT - 1}"})
    got, start = 0, time.monotonic()
    try:
        with camera._direct.open(request, timeout=TIMEOUT) as response:
            while got < LIMIT and (chunk := response.read(65536)):
                got += len(chunk)
    except OSError as exc:
        raise CameraError("camera_unreachable", str(exc)) from None
    seconds = max(time.monotonic() - start, 1e-6)
    return {"latency": round(statistics.median(took) * 1000), "down": round(got * 8 / seconds / 1e6, 1), "bytes": got}


# ---------------------------------------------------------------- SSH
def _printer(printer) -> tuple[str, str]:
    """Address and model of a printer OrcaOne knows by name."""
    found = camera.printers().get(printer) if isinstance(printer, str) else None
    if not found:
        raise CameraError("printer_not_found")
    return found["host"], found["model"]


def _login(printer: str, host: str, model: str, keys: bool = True) -> tuple[paramiko.SSHClient, str]:
    """The key chosen for the printer, this computer's keys and agent (only for a page on this
    computer, app.is_remote), then the password as shipped (ssh.DEFAULT_PASSWORDS); and how it
    logged in, "key" or "default"."""
    key = ssh.key_of(printer) if keys else None
    for password, via in ([(None, "key")] if keys else []) + ([(ssh.DEFAULT_PASSWORDS[model], "default")] if model in ssh.DEFAULT_PASSWORDS else []):
        try:
            client = ssh.connect(host, USER, password, key)
        except paramiko.AuthenticationException:
            continue
        except paramiko.SSHException as exc:
            raise CameraError("ssh_failed", str(exc)) from None
        except OSError as exc:
            # Refused or silent: Root Access is off, or the printer is not there.
            raise CameraError("ssh_unreachable", str(exc) or type(exc).__name__) from None
        client.get_transport().set_keepalive(15)
        return client, via
    raise CameraError("ssh_login")


def _run(client: paramiko.SSHClient, command: str) -> str:
    try:
        _, out, _ = client.exec_command(command, timeout=TIMEOUT)
        text = out.read().decode("utf-8", "replace")
        out.channel.recv_exit_status()
        return text
    except (OSError, EOFError, paramiko.SSHException) as exc:
        raise CameraError("ssh_lost", str(exc) or type(exc).__name__) from None


def _answers(host: str) -> bool:
    """Whether Moonraker answers, within 2 s."""
    try:
        with camera._direct.open(f"http://{host}/server/info", timeout=2) as response:
            response.read()
        return True
    except (OSError, ValueError):
        return False


def _printing(host: str) -> bool:
    """A print running or paused: then no new start. Klipper not ready (shut down, starting) prints
    nothing; but without an answer at all nobody knows, and then no start either."""
    try:
        state = (camera.query(host, ["print_stats=state"]).get("print_stats") or {}).get("state")
    except CameraError:
        try:
            klippy = camera._get(host, "/server/info").get("klippy_state")
        except (CameraError, AttributeError):
            raise CameraError("wifi_printing_unknown") from None
        if klippy == "ready":
            raise CameraError("wifi_printing_unknown") from None
        return False
    return state in ("printing", "paused")


class _Watch:
    """One page: the SSH connection, the readings, and one action at a time."""

    def __init__(self, ws: WebSocket, printer: str, host: str, model: str, keys: bool = True):
        self.ws, self.printer, self.host, self.model, self.keys = ws, printer, host, model, keys
        self.client: paramiko.SSHClient | None = None
        self.login = asyncio.Lock()
        self.ssh = model in ssh.DEFAULT_PASSWORDS   # the tools and the login are known on the U1 only
        self.gateway: str | None = None
        self.clock: int | None = None   # s the printer's clock is off, from the last check
        self.ready = asyncio.Event()     # the first login is decided: the readings may begin
        self.away = False     # the printer connects or starts anew: no readings meanwhile
        self.action: asyncio.Task | None = None

    async def send(self, **message) -> None:
        await self.ws.send_json(message)

    def drop(self) -> None:
        if self.client is not None:
            self.client.close()
            self.client = None

    async def logged_in(self) -> tuple[paramiko.SSHClient, str]:
        """A login in a thread; one whose page went meanwhile is closed when it is done."""
        task = asyncio.ensure_future(asyncio.to_thread(_login, self.printer, self.host, self.model, self.keys))
        try:
            return await asyncio.shield(task)
        except asyncio.CancelledError:
            task.add_done_callback(lambda t: t.cancelled() or t.exception() or t.result()[0].close())
            raise

    async def run(self, command: str) -> str:
        async with self.login:
            if self.client is None:
                self.client, via = await self.logged_in()
                # Anew, after a drop or a start of the printer: it may have forgotten its key.
                await self.send(type="ssh", state="open", via=via, keys=self.keys)
            client = self.client
        try:
            return await asyncio.to_thread(_run, client, command)
        except CameraError:
            if self.client is client:
                self.drop()
            raise

    async def start(self) -> None:
        """What Moonraker says, the login, the route, and the checks once."""
        try:
            info = await asyncio.gather(asyncio.to_thread(interfaces, self.host), asyncio.to_thread(usb, self.host),
                                        asyncio.to_thread(computer, self.host))
            await self.send(type="info", interfaces=info[0], usb=info[1], computer=info[2])
        except CameraError:
            await self.send(type="info", interfaces=None, usb=None, computer=await asyncio.to_thread(computer, self.host))
        if self.ssh:
            try:
                async with self.login:
                    self.client, via = await self.logged_in()
                await self.send(type="ssh", state="open", via=via, keys=self.keys)
            except CameraError as exc:
                self.ssh = False
                await self.send(type="ssh", state="failed", code=exc.code, **({"detail": exc.detail} if exc.detail else {}))
            if self.ssh:
                try:
                    await self.read_route()
                except CameraError as exc:
                    await self.send(type="lost", code=exc.code)   # the readings log in again
        else:
            await self.send(type="ssh", state="none")
        self.ready.set()
        await self.checks()

    async def read_route(self) -> None:
        found = route(await self.run(ROUTE))
        self.gateway = found["gateway"]
        await self.send(type="route", **found)

    async def reading(self) -> None:
        """What the chip says, every EVERY seconds; a lost connection is said, and tried again."""
        try:
            await self.ready.wait()
            while True:
                if self.ssh and not self.away:
                    try:
                        text = await self.run(READ)
                        if not self.away:
                            await self.send(type="values", time=time.time(), **parse(text), links=links(text))
                    except CameraError as exc:
                        if not self.away:
                            await self.send(type="lost", code=exc.code)
                await asyncio.sleep(EVERY)
        except (WebSocketDisconnect, RuntimeError):
            pass   # the page went

    async def check(self, item: str, work) -> None:
        await self.send(type="check", item=item, state="running")
        try:
            await self.send(type="check", item=item, **await work())
        except CameraError as exc:
            await self.send(type="check", item=item, state="err", code=exc.code)

    async def checks(self) -> None:
        """One after the other, each said when done: the printer and its clock (Moonraker), then over
        SSH its router, the internet by address and by name."""
        async def printer():
            found = await asyncio.to_thread(answer_time, self.host)
            self.clock = found["clock"]
            return {"state": "ok" if found["ms"] < 100 else "warn" if found["ms"] < 300 else "err", "ms": found["ms"]}

        async def clock():
            if self.clock is None:
                return {"state": "none"}
            return {"state": "ok" if abs(self.clock) <= 120 else "warn", "value": self.clock}

        def pinged(text, good):
            # All lost: nothing gets through; some lost or slow: it does, but not well.
            found = ping(text)
            if found["loss"] is None or found["loss"] >= 100:
                return {"state": "err", **found}
            return {"state": "ok" if found["loss"] == 0 and (found["ms"] or 0) < good else "warn", **found}

        async def router():
            if not self.gateway:
                return {"state": "err", "code": "no_gateway"}
            return pinged(await self.run(f"ping -c 3 -W 1 {self.gateway} 2>&1"), 20)

        async def internet():
            return pinged(await self.run("ping -c 3 -W 1 1.1.1.1 2>&1"), 80)

        async def dns():
            text = (await self.run(f"timeout 5 python3 -c \"import socket;print(socket.gethostbyname('{NAME}'))\" 2>&1")).strip()
            return {"state": "ok", "value": text} if re.fullmatch(r"\d{1,3}(\.\d{1,3}){3}", text) else {"state": "err", "value": NAME}

        await self.check("printer", printer)
        await self.check("clock", clock)
        for item, work in (("router", router), ("internet", internet), ("dns", dns)):
            if self.ssh:
                await self.check(item, work)
            else:
                await self.send(type="check", item=item, state="ssh")

    async def wait(self, what: str, start: float, gone: bool = False) -> int:
        """Until the printer answers again, or with gone no longer: the seconds since the click."""
        while True:
            seconds = round(time.monotonic() - start)
            await self.send(type="waiting", action=what, seconds=seconds)
            if await asyncio.to_thread(_answers, self.host) != gone:
                return seconds
            if seconds >= (GONE if gone else WAIT[what]):
                raise CameraError("wifi_not_gone" if gone else "wifi_timeout")
            await asyncio.sleep(POLL)

    async def act(self, what: str) -> None:
        try:
            if what == "check":
                if self.ssh:
                    await self.read_route()
                await self.checks()
            elif what == "speed":
                await self.send(type="speed", **await asyncio.to_thread(measure, self.host))
            elif not self.ssh:
                raise CameraError("ssh_needed")
            elif what == "scan":
                await self.send(type="scan", networks=networks(await self.run(SCAN)))
            elif what == "power_save_off":
                text = await self.run(f"{POWER_SAVE_OFF}; {READ}")
                await self.send(type="values", time=time.time(), **parse(text), links=links(text))
            else:
                if what == "reboot" and await asyncio.to_thread(_printing, self.host):
                    raise CameraError("wifi_printing")
                await self.run(RECONNECT if what == "reconnect" else REBOOT)
                start = time.monotonic()
                self.away = True
                self.drop()
                if what == "reboot":
                    await self.wait(what, start, gone=True)
                else:
                    await asyncio.sleep(SETTLE)
                await self.send(type="back", action=what, seconds=await self.wait(what, start))
        except CameraError as exc:
            await self.send(type="failed", action=what, code=exc.code, **({"detail": exc.detail} if exc.detail else {}))
        except (WebSocketDisconnect, RuntimeError):
            pass   # the page went
        finally:
            self.away = False


async def session(ws: WebSocket, printer: str, keys: bool = True) -> None:
    """One page "Netzwerk" on one printer: what Moonraker says, the login, then readings until the
    page goes."""
    await ws.accept()
    watch, reader = None, None
    try:
        try:
            host, model = _printer(printer)
        except CameraError as exc:
            await ws.send_json({"type": "error", "code": exc.code})
            return
        watch = _Watch(ws, printer, host, model, keys)
        watch.action = asyncio.create_task(watch.start())
        reader = asyncio.create_task(watch.reading())
        while True:
            try:
                message = json.loads(await ws.receive_text())
            except ValueError:
                continue   # nonsense: ignored
            what = message.get("do") if isinstance(message, dict) else None
            if what not in ACTIONS:
                continue
            if watch.action is None or watch.action.done():
                watch.action = asyncio.create_task(watch.act(what))
            else:
                # One at a time, and the first checks run after the login: said, so the page waits no more.
                await ws.send_json({"type": "failed", "action": what, "code": "wifi_busy"})
    except (WebSocketDisconnect, RuntimeError):
        pass   # the page closed
    finally:
        for task in (reader, watch.action if watch else None):
            if task is not None:
                task.cancel()
        if watch is not None:
            watch.drop()
        try:
            await ws.close()
        except RuntimeError:
            pass   # closed already
