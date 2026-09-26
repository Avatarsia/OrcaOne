"""Start OrcaOne: run the server on every interface, so any device in the LAN reaches it (the
user's wish of 25.09.2026), or with --local on 127.0.0.1 only; open the page in a window of the
default browser (browser.py), always over 127.0.0.1.

The port is fixed, so a web app installed from the page (manifest.json) finds OrcaOne again after
a restart. Is an OrcaOne there already, a second start only opens a window; has another program
taken the port, OrcaOne takes a free one."""

import argparse
import http.client
import ipaddress
import json
import os
import re
import socket
import threading
import time

import psutil
import uvicorn

from . import browser, settings
from .app import app

PORT = 4711
EVERYWHERE, LOCAL = "0.0.0.0", "127.0.0.1"   # IPv4: what phones and PCs in a home network use
# Adapters of virtual machines, containers and VPNs: their addresses are listed last.
_VIRTUAL = re.compile(r"vethernet|vmware|virtualbox|loopback|bluetooth|tailscale|zerotier|npcap|\btap|docker|^br-|veth|virbr|"
                      r"vmnet|vboxnet|^tun|^wg|lxc|lxd|podman|cni", re.IGNORECASE)


def _probe() -> socket.socket:
    """A socket that binds a port only if no other program listens on it, on any address. Windows
    lets a plain bind of 0.0.0.0 succeed beside another program's listener on 127.0.0.1 and the
    other way round, SO_EXCLUSIVEADDRUSE refuses every such pair (Microsoft, "Using SO_REUSEADDR and
    SO_EXCLUSIVEADDRUSE"). On POSIX SO_REUSEADDR as asyncio sets it for the server, so a port that
    still has connections of the last run in TIME_WAIT counts as free."""
    sock = socket.socket()
    if os.name == "nt":
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
    else:
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    return sock


def free_port(host: str = LOCAL) -> int:
    with _probe() as sock:
        sock.bind((host, 0))
        return sock.getsockname()[1]


def _can_listen(port: int, host: str) -> bool:
    with _probe() as sock:
        try:
            sock.bind((host, port))
        except OSError:
            return False
    return True


def _is_orcaone(port: int) -> bool:
    """Whether the program on the port is an OrcaOne, by the name in its web app manifest."""
    connection = http.client.HTTPConnection("127.0.0.1", port, timeout=3)
    try:
        connection.request("GET", "/manifest.json")
        response = connection.getresponse()
        data = json.loads(response.read()) if response.status == 200 else None
    except (OSError, ValueError, http.client.HTTPException):
        return False
    finally:
        connection.close()
    return isinstance(data, dict) and data.get("name") == "OrcaOne"


def choose_port(wanted: int, host: str = EVERYWHERE) -> tuple[int, bool]:
    """The port to use, and whether an OrcaOne runs there already. 0 asks for a free port."""
    if wanted and _can_listen(wanted, host):
        return wanted, False
    if wanted and _is_orcaone(wanted):
        return wanted, True
    return free_port(host), False


def lan_addresses() -> list[str]:
    """The IPv4 addresses other devices reach this computer at: private, not link-local, on an
    interface that is up. The one of the default route first (a UDP socket connected to a
    documentation address, RFC 5737, sends nothing), virtual adapters last."""
    stats = psutil.net_if_stats()
    found = []
    for name, addresses in psutil.net_if_addrs().items():
        if not getattr(stats.get(name), "isup", False):
            continue
        for a in addresses:
            if a.family != socket.AF_INET:
                continue
            ip = ipaddress.ip_address(a.address)
            if ip.is_private and not ip.is_loopback and not ip.is_link_local:
                found.append((bool(_VIRTUAL.search(name)), a.address))
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
            sock.connect(("192.0.2.1", 9))
            primary = sock.getsockname()[0]
    except OSError:
        primary = None
    found.sort(key=lambda f: (f[1] != primary, f[0]))
    return list(dict.fromkeys(address for _, address in found))


def _open_when_ready(server: uvicorn.Server, url: str) -> None:
    while not server.started:
        time.sleep(0.05)
    browser.open_window(url)


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="orcaone", description="OrcaOne – Profile von OrcaSlicer und Snapmaker Orca verwalten")
    parser.add_argument("--port", type=int, default=PORT, help=f"Port, Standard {PORT}; 0 für einen freien")
    parser.add_argument("--no-browser", action="store_true", help="Browser nicht öffnen")
    parser.add_argument("--local", action="store_true", help="nur auf diesem Rechner erreichbar (127.0.0.1), nicht im LAN")
    args = parser.parse_args(argv)

    host = LOCAL if args.local else EVERYWHERE
    port, running = choose_port(args.port, host)
    url = f"http://127.0.0.1:{port}/"
    if running:
        print(f"OrcaOne läuft schon auf {url}")
        if not args.no_browser:
            browser.open_window(url)
        return
    if args.port and port != args.port:
        print(f"Port {args.port} ist belegt, OrcaOne nimmt {port}.")
    settings.migrate()
    # proxy_headers off: the address of the client is the one of the connection, never one a
    # header claims (app.is_remote decides by it).
    server = uvicorn.Server(uvicorn.Config(app, host=host, port=port, log_level="warning", proxy_headers=False))
    if not args.no_browser:
        threading.Thread(target=_open_when_ready, args=(server, url), daemon=True).start()
    print(f"OrcaOne läuft auf {url} – beenden mit Strg+C")
    if not args.local:
        for address in lan_addresses():
            print(f"Im LAN: http://{address}:{port}/")
    try:
        server.run()
    except KeyboardInterrupt:
        # Strg+C: uvicorn has shut down already, then asyncio passes the key on. Without this the
        # console showed a traceback (the user, 24.09.2026).
        pass
    print("OrcaOne beendet.")


if __name__ == "__main__":
    main()
