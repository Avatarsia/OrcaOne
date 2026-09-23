"""Start OrcaOne: run the server on 127.0.0.1, open the page in a window of the default browser
(browser.py).

The port is fixed, so a web app installed from the page (manifest.json) finds OrcaOne again after
a restart. Is an OrcaOne there already, a second start only opens a window; has another program
taken the port, OrcaOne takes a free one."""

import argparse
import http.client
import json
import os
import socket
import threading
import time

import uvicorn

from . import browser, settings
from .app import app

PORT = 4711


def free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def _can_listen(port: int) -> bool:
    """Tried as uvicorn binds (asyncio sets SO_REUSEADDR on POSIX only), so a port that still has
    connections of the last run in TIME_WAIT counts as free."""
    with socket.socket() as sock:
        if os.name != "nt":
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            sock.bind(("127.0.0.1", port))
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


def choose_port(wanted: int) -> tuple[int, bool]:
    """The port to use, and whether an OrcaOne runs there already. 0 asks for a free port."""
    if wanted and _can_listen(wanted):
        return wanted, False
    if wanted and _is_orcaone(wanted):
        return wanted, True
    return free_port(), False


def _open_when_ready(server: uvicorn.Server, url: str) -> None:
    while not server.started:
        time.sleep(0.05)
    browser.open_window(url)


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="orcaone", description="OrcaOne – Profile von OrcaSlicer und Snapmaker Orca verwalten")
    parser.add_argument("--port", type=int, default=PORT, help=f"Port, Standard {PORT}; 0 für einen freien")
    parser.add_argument("--no-browser", action="store_true", help="Browser nicht öffnen")
    args = parser.parse_args(argv)

    port, running = choose_port(args.port)
    url = f"http://127.0.0.1:{port}/"
    if running:
        print(f"OrcaOne läuft schon auf {url}")
        if not args.no_browser:
            browser.open_window(url)
        return
    if args.port and port != args.port:
        print(f"Port {args.port} ist belegt, OrcaOne nimmt {port}.")
    settings.migrate()
    server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning"))
    if not args.no_browser:
        threading.Thread(target=_open_when_ready, args=(server, url), daemon=True).start()
    print(f"OrcaOne läuft auf {url} – beenden mit Strg+C")
    server.run()


if __name__ == "__main__":
    main()
