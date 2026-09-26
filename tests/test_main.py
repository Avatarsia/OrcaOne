"""The start (orcaone/__main__.py): a fixed port, and a second start only opens a window; every
interface, or with --local only this computer."""

import socket
import threading
from collections import namedtuple
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from orcaone import __main__ as start


def test_a_free_port_is_taken():
    port = start.free_port()
    assert start.choose_port(port) == (port, False)
    other, running = start.choose_port(0)
    assert other > 0 and not running


def test_a_second_start_opens_a_window_only(server, monkeypatch):
    port = int(server.rsplit(":", 1)[1])
    assert start.choose_port(port) == (port, True)
    opened = []
    monkeypatch.setattr(start.browser, "open_window", opened.append)
    start.main(["--port", str(port)])   # returns at once, no second server
    assert opened == [f"http://127.0.0.1:{port}/"]


def test_ctrl_c_ends_without_a_traceback(monkeypatch, capsys):
    monkeypatch.setattr(start, "choose_port", lambda wanted, host: (wanted, False))
    monkeypatch.setattr(start.settings, "migrate", lambda: None)

    def pressed(self):
        raise KeyboardInterrupt

    monkeypatch.setattr(start.uvicorn.Server, "run", pressed)
    start.main(["--port", "4711", "--no-browser"])   # returns instead of raising
    assert capsys.readouterr().out.endswith("OrcaOne beendet.\n")


def test_another_program_on_the_port():
    class Other(BaseHTTPRequestHandler):
        def do_GET(self):
            self.send_response(404)
            self.end_headers()

        def log_message(self, *args):
            pass

    other = ThreadingHTTPServer(("127.0.0.1", 0), Other)
    threading.Thread(target=other.serve_forever, daemon=True).start()
    try:
        port = other.server_address[1]
        chosen, running = start.choose_port(port)
        assert chosen != port and not running
    finally:
        other.shutdown()


def test_every_interface_or_only_this_computer(monkeypatch, capsys):
    """Any device in the LAN reaches OrcaOne (the user's wish of 25.09.2026), --local keeps it on
    127.0.0.1; the window opens over 127.0.0.1 either way, and the LAN addresses are printed."""
    monkeypatch.setattr(start, "choose_port", lambda wanted, host: (wanted, False))
    monkeypatch.setattr(start.settings, "migrate", lambda: None)
    monkeypatch.setattr(start, "lan_addresses", lambda: ["192.168.1.20"])
    seen = []

    def run(self):
        seen.append((self.config.host, self.config.proxy_headers))
        raise KeyboardInterrupt

    monkeypatch.setattr(start.uvicorn.Server, "run", run)
    start.main(["--port", "4711", "--no-browser"])
    out = capsys.readouterr().out
    assert "http://127.0.0.1:4711/" in out and "Im LAN: http://192.168.1.20:4711/" in out
    start.main(["--port", "4711", "--no-browser", "--local"])
    assert "Im LAN" not in capsys.readouterr().out
    # A header never names the client: proxy_headers off.
    assert seen == [("0.0.0.0", False), ("127.0.0.1", False)]


def test_lan_addresses(monkeypatch):
    """Private IPv4 addresses of interfaces that are up; virtual adapters last; no loopback,
    link-local, public or IPv6 address."""
    Addr = namedtuple("Addr", "family address")
    Stat = namedtuple("Stat", "isup")
    addrs = {"VMware Network Adapter VMnet8": [Addr(socket.AF_INET, "192.168.56.1")],
             "WLAN": [Addr(socket.AF_INET6, "fe80::1"), Addr(socket.AF_INET, "192.168.1.20")],
             "Loopback Pseudo-Interface 1": [Addr(socket.AF_INET, "127.0.0.1")],
             "LAN-Verbindung* 11": [Addr(socket.AF_INET, "169.254.10.2")],
             "Ethernet 2": [Addr(socket.AF_INET, "10.0.0.5")],
             "Provider": [Addr(socket.AF_INET, "8.8.8.8")]}
    stats = {name: Stat(name != "Ethernet 2") for name in addrs}
    monkeypatch.setattr(start.psutil, "net_if_addrs", lambda: addrs)
    monkeypatch.setattr(start.psutil, "net_if_stats", lambda: stats)
    assert start.lan_addresses() == ["192.168.1.20", "192.168.56.1"]

    # The address the default route goes out from first, whatever the order of the interfaces.
    class Probe:
        def __init__(self, *args):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *args):
            pass

        def connect(self, address):
            pass

        def getsockname(self):
            return ("192.168.1.30", 9)
    addrs["Ethernet"] = [Addr(socket.AF_INET, "192.168.1.30")]
    stats["Ethernet"] = Stat(True)
    monkeypatch.setattr(start.socket, "socket", Probe)
    assert start.lan_addresses() == ["192.168.1.30", "192.168.1.20", "192.168.56.1"]
