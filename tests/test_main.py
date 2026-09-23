"""The start (orcaone/__main__.py): a fixed port, and a second start only opens a window."""

import threading
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
