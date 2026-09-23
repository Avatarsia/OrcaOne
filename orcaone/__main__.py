"""Start OrcaOne: pick a free port on 127.0.0.1, run the server, open the page in a new window of
the default browser (browser.py)."""

import argparse
import socket
import threading
import time

import uvicorn

from . import browser, settings
from .app import app


def free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def _open_when_ready(server: uvicorn.Server, url: str) -> None:
    while not server.started:
        time.sleep(0.05)
    browser.open_window(url)


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="orcaone", description="OrcaOne – Profile von OrcaSlicer und Snapmaker Orca verwalten")
    parser.add_argument("--port", type=int, default=0, help="fester Port statt eines freien")
    parser.add_argument("--no-browser", action="store_true", help="Browser nicht öffnen")
    args = parser.parse_args(argv)

    settings.migrate()
    port = args.port or free_port()
    url = f"http://127.0.0.1:{port}/"
    server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning"))
    if not args.no_browser:
        threading.Thread(target=_open_when_ready, args=(server, url), daemon=True).start()
    print(f"OrcaOne läuft auf {url} – beenden mit Strg+C")
    server.run()


if __name__ == "__main__":
    main()
