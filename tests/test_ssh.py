"""The page "SSH" (orcaone/ssh.py): the WebSocket between the page and an SSH server, here a
small paramiko server that takes a password only and sends every input back, never a printer."""

import json
import socket
import threading

import paramiko
import pytest
from websockets.exceptions import ConnectionClosed, InvalidStatus
from websockets.sync.client import connect

from orcaone import camera, ssh


class Printer(paramiko.ServerInterface):
    """root with a password, "secret" unless a test sets another; keys never fit."""

    def __init__(self):
        self.shell = threading.Event()
        self.pty = self.size = None
        self.password, self.tried = "secret", []

    def check_channel_request(self, kind, chanid):
        return paramiko.OPEN_SUCCEEDED if kind == "session" else paramiko.OPEN_FAILED_ADMINISTRATIVELY_PROHIBITED

    def get_allowed_auths(self, username):
        return "password,publickey"

    def check_auth_password(self, username, password):
        self.tried.append(password)
        return paramiko.AUTH_SUCCESSFUL if (username, password) == ("root", self.password) else paramiko.AUTH_FAILED

    def check_auth_publickey(self, username, key):
        return paramiko.AUTH_FAILED

    def check_channel_pty_request(self, channel, term, width, height, pixelwidth, pixelheight, modes):
        self.pty = (term, width, height)
        return True

    def check_channel_shell_request(self, channel):
        self.shell.set()
        return True

    def check_channel_window_change_request(self, channel, width, height, pixelwidth, pixelheight):
        self.size = (width, height)
        return True


@pytest.fixture
def printer(monkeypatch):
    """A listening SSH server; the bridge's port 22 points to it."""
    key = paramiko.ECDSAKey.generate()
    listener = socket.create_server(("127.0.0.1", 0))
    monkeypatch.setattr(ssh, "PORT", listener.getsockname()[1])
    monkeypatch.delenv("SSH_AUTH_SOCK", raising=False)  # no agent of the real user
    served = Printer()

    def session(conn):
        transport = paramiko.Transport(conn)
        transport.add_server_key(key)
        transport.start_server(server=served)
        channel = transport.accept(20)
        if channel is None:
            return
        served.shell.wait(10)
        channel.sendall(b"welcome\r\n$ ")
        while (data := channel.recv(1024)) and b"exit" not in data:
            channel.sendall(data)
        channel.close()
        transport.close()

    # A new connection for every login attempt, as the bridge makes them.
    def serve():
        while True:
            try:
                conn, _ = listener.accept()
            except OSError:
                return
            threading.Thread(target=session, args=(conn,), daemon=True).start()

    threading.Thread(target=serve, daemon=True).start()
    yield key, served
    listener.close()


def _url(server):
    return server.replace("http://", "ws://") + "/api/ssh?model=Snapmaker%20U1"


def test_a_session_with_password(server, printer):
    key, served = printer
    # Moonraker's port stays out: SSH has its own.
    camera.set_host("Snapmaker U1", "127.0.0.1:7125")
    with connect(_url(server), origin=server, open_timeout=5) as ws:
        ws.send(json.dumps({"type": "start", "user": "root", "cols": 100, "rows": 30}))
        # No key in the test's home and no agent, and the U1's password as shipped does not fit
        # this one: the page asks.
        assert json.loads(ws.recv(timeout=15)) == {"type": "password", "again": False}
        ws.send(json.dumps({"type": "password", "password": "wrong"}))
        assert json.loads(ws.recv(timeout=15)) == {"type": "password", "again": True}
        ws.send(json.dumps({"type": "password", "password": "secret"}))
        assert json.loads(ws.recv(timeout=15)) == {"type": "open", "host": "127.0.0.1", "user": "root",
                                                   "fingerprint": ssh.fingerprint(key)}
        seen = b""
        while b"$ " not in seen:
            seen += ws.recv(timeout=10)
        ws.send(json.dumps({"type": "data", "data": "grüß dich"}))
        while "grüß dich".encode() not in seen:
            seen += ws.recv(timeout=10)
        ws.send(json.dumps({"type": "resize", "cols": 120, "rows": 40}))
        ws.send(json.dumps({"type": "data", "data": "exit\r"}))
        texts = []
        with pytest.raises(ConnectionClosed):
            while True:
                message = ws.recv(timeout=10)
                if isinstance(message, str):
                    texts.append(json.loads(message))
        assert texts[-1] == {"type": "closed"}
    assert served.pty == (b"xterm-256color", 100, 30) and served.size == (120, 40)
    assert served.tried == ["snapmaker", "wrong", "secret"]


def test_typed_or_default_password(server, printer):
    _, served = printer
    start = {"type": "start", "user": "root", "cols": 80, "rows": 24}
    # Nothing typed: the keys (none here), then the U1's password as shipped, without a question.
    camera.set_host("Snapmaker U1", "127.0.0.1")
    served.password = "snapmaker"
    with connect(_url(server), origin=server, open_timeout=5) as ws:
        ws.send(json.dumps(start))
        assert json.loads(ws.recv(timeout=15))["type"] == "open"
    # Typed in the bar: only that one.
    served.password, served.tried = "geheim", []
    with connect(_url(server), origin=server, open_timeout=5) as ws:
        ws.send(json.dumps({**start, "password": "geheim"}))
        assert json.loads(ws.recv(timeout=15))["type"] == "open"
    assert served.tried == ["geheim"]
    # Any other Klipper printer has no such password: after the keys the page asks at once.
    camera.set_host("MyKlipper", "127.0.0.1")
    served.tried = []
    with connect(server.replace("http://", "ws://") + "/api/ssh?model=MyKlipper", origin=server, open_timeout=5) as ws:
        ws.send(json.dumps(start))
        assert json.loads(ws.recv(timeout=15)) == {"type": "password", "again": False}
    assert served.tried == []


def test_only_this_page_and_known_printers(server, printer):
    # Any other page may open a WebSocket to 127.0.0.1: Origin decides.
    for origin in ("http://evil.example", server.replace("127.0.0.1", "localhost")):
        with pytest.raises(InvalidStatus) as err:
            connect(_url(server), origin=origin, open_timeout=5)
        assert err.value.response.status_code == 403
    # A printer without an address: no connection anywhere.
    with connect(_url(server), origin=server, open_timeout=5) as ws:
        assert json.loads(ws.recv(timeout=5)) == {"type": "error", "code": "printer_not_found"}
    camera.set_host("Snapmaker U1", "127.0.0.1")
    with connect(_url(server), origin=server, open_timeout=5) as ws:
        ws.send(json.dumps({"type": "start", "user": "root; reboot", "cols": 80, "rows": 24}))
        assert json.loads(ws.recv(timeout=5)) == {"type": "error", "code": "ssh_user_invalid"}


def test_ssh_off(server, monkeypatch):
    # Nothing listens: on the U1 Root Access is off.
    closed = socket.create_server(("127.0.0.1", 0))
    monkeypatch.setattr(ssh, "PORT", closed.getsockname()[1])
    closed.close()
    camera.set_host("Snapmaker U1", "127.0.0.1")
    with connect(_url(server), origin=server, open_timeout=5) as ws:
        ws.send(json.dumps({"type": "start", "user": "root", "cols": 80, "rows": 24}))
        answer = json.loads(ws.recv(timeout=15))
        assert answer["type"] == "error" and answer["code"] == "ssh_unreachable"


def test_hostname_and_size():
    assert ssh.hostname("10.30.40.174:7125") == "10.30.40.174"
    assert ssh.hostname("u1.local") == "u1.local" and ssh.hostname("[fe80::1]") == "fe80::1"
    assert ssh._size({"cols": 120, "rows": 40}) == (120, 40)
    assert ssh._size({"cols": True, "rows": 99999}) == (80, 24)
