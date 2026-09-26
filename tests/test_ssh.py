"""The page "SSH" (orcaone/ssh.py): the WebSocket between the page and an SSH server, here a
small paramiko server that takes a password only and sends every input back, never a printer."""

import json
import os
import re
import shutil
import socket
import subprocess
import threading

import paramiko
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec, ed25519, rsa
from websockets.exceptions import ConnectionClosed, InvalidStatus
from websockets.sync.client import connect

from conftest import call
from orcaone import app as app_module
from orcaone import camera, settings, ssh


class Printer(paramiko.ServerInterface):
    """root with a password, "secret" unless a test sets another; keys never fit."""

    def __init__(self):
        self.shell = threading.Event()
        self.pty = self.size = None
        self.password, self.tried = "secret", []
        self.keys, self.authorized, self.commands = set(), [], []   # public keys (base64) that fit; the file

    def check_channel_request(self, kind, chanid):
        return paramiko.OPEN_SUCCEEDED if kind == "session" else paramiko.OPEN_FAILED_ADMINISTRATIVELY_PROHIBITED

    def get_allowed_auths(self, username):
        return "password,publickey"

    def check_auth_password(self, username, password):
        self.tried.append(password)
        return paramiko.AUTH_SUCCESSFUL if (username, password) == ("root", self.password) else paramiko.AUTH_FAILED

    def check_auth_publickey(self, username, key):
        return paramiko.AUTH_SUCCESSFUL if username == "root" and key.get_base64() in self.keys else paramiko.AUTH_FAILED

    def check_channel_exec_request(self, channel, command):
        # Only the command that brings a key (ssh.install_key): the key is added once, and fits then.
        command = command.decode()
        self.commands.append(command)
        blob = re.search(r"grep -qF -- (\S+) ", command).group(1).strip("'")
        answer = "present" if blob in self.authorized else "added"
        if answer == "added":
            self.authorized.append(blob)
        self.keys.add(blob)

        def reply():
            channel.sendall(answer.encode() + b"\n")
            channel.send_exit_status(0)
            channel.shutdown_write()
        threading.Thread(target=reply, daemon=True).start()
        return True

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
        try:
            channel.sendall(b"welcome\r\n$ ")
            while (data := channel.recv(1024)) and b"exit" not in data:
                channel.sendall(data)
        except OSError:
            pass   # the test left after the login already
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
        assert json.loads(ws.recv(timeout=15)) == {"type": "open", "host": "127.0.0.1", "user": "root", "via": "typed", "keys": True, "key": None,
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


def test_from_another_device_no_keys_of_this_computer(server, printer, monkeypatch):
    """A page from the LAN: only the U1's password as shipped or a typed one, never this computer's
    keys or agent, since anyone there could name a "printer" at any host."""
    monkeypatch.setattr(app_module, "is_remote", lambda client: True)
    tried, real = [], ssh.connect
    monkeypatch.setattr(ssh, "connect", lambda host, user, password=None, key=None: tried.append(password) or real(host, user, password, key))
    _, served = printer
    served.password = "snapmaker"
    camera.set_host("Snapmaker U1", "127.0.0.1")
    ssh.save_setting("Snapmaker U1", None, None, "auto")   # at the computer the keys would come first
    with connect(_url(server), origin=server, open_timeout=5) as ws:
        ws.send(json.dumps({"type": "start", "user": "root", "cols": 80, "rows": 24}))
        answer = json.loads(ws.recv(timeout=15))
        assert (answer["type"], answer["keys"], answer["key"]) == ("open", False, None)
    assert tried == ["snapmaker"]


def _key(folder, name, private, password=None, public=True, traditional=False):
    """A throwaway key in the test's ~/.ssh, as ssh-keygen writes it; its public part as base64."""
    folder.mkdir(exist_ok=True)
    encryption = serialization.BestAvailableEncryption(password) if password else serialization.NoEncryption()
    kind = serialization.PrivateFormat.TraditionalOpenSSL if traditional else serialization.PrivateFormat.OpenSSH
    (folder / name).write_bytes(private.private_bytes(serialization.Encoding.PEM, kind, encryption))
    line = private.public_key().public_bytes(serialization.Encoding.OpenSSH, serialization.PublicFormat.OpenSSH)
    if public:
        (folder / (name + ".pub")).write_bytes(line + b" test@pc\n")
    return line.split()[1].decode()


def test_the_keys_of_this_computer(fake_home):
    """The choice per printer (the user's wish of 25.09.2026: a key named other than id_* was never
    tried): the private keys in ~/.ssh paramiko loads, with type, fingerprint and whether it has a
    passphrase; nothing else in the folder, and never key material."""
    folder = fake_home / ".ssh"
    plain = _key(folder, "id_ed25519_pendler", ed25519.Ed25519PrivateKey.generate())
    _key(folder, "locked", ed25519.Ed25519PrivateKey.generate(), password=b"geheim")
    _key(folder, "old_rsa", rsa.generate_private_key(public_exponent=65537, key_size=2048), traditional=True, public=False)
    (folder / "config").write_text("Host *\n", encoding="utf-8")
    (folder / "known_hosts").write_text("x ssh-ed25519 AAAA\n", encoding="utf-8")
    (folder / "only.pub").write_text("ssh-ed25519 AAAA x\n", encoding="utf-8")
    (folder / "fake").write_text("-----BEGIN OPENSSH PRIVATE KEY-----\nkaputt\n", encoding="utf-8")
    found = {k["name"]: k for k in ssh.list_keys()}
    assert set(found) == {"id_ed25519_pendler", "locked", "old_rsa"}
    assert (found["id_ed25519_pendler"]["type"], found["id_ed25519_pendler"]["passphrase"]) == ("ED25519", False)
    assert (found["locked"]["passphrase"], found["old_rsa"]["type"]) == (True, "RSA")
    key = paramiko.PKey.from_path(folder / "id_ed25519_pendler")
    assert found["id_ed25519_pendler"]["fingerprint"] == key.fingerprint and key.get_base64() == plain
    assert plain not in json.dumps(found) and "PRIVATE" not in json.dumps(found)


def test_a_key_per_printer(server, printer, fake_home):
    """Chosen once per printer (a file name in ~/.ssh, never a path); the page logs in with it
    first, and says how it logged in: with the key, or with the password as shipped when the U1
    forgot it at its last start."""
    _, served = printer
    blob = _key(fake_home / ".ssh", "id_ed25519_pendler", ed25519.Ed25519PrivateKey.generate())
    camera.set_host("Snapmaker U1", "127.0.0.1")
    for wrong in ("../x", "/etc/passwd", "C:\\x", "id_ed25519_pendler.pub", "config", "gibt_es_nicht"):
        status, body = call(f"{server}/api/printers/ssh", "POST", {"model": "Snapmaker U1", "key": wrong}, headers={"Origin": server})
        assert (status, json.loads(body)) == (400, {"error": "ssh_key_invalid"}), wrong
    status, body = call(f"{server}/api/printers/ssh", "POST", {"model": "Snapmaker U1", "user": "root", "key": "id_ed25519_pendler"},
                        headers={"Origin": server})
    assert status == 200 and json.loads(body)["printers"]["Snapmaker U1"]["ssh"] == {"user": "root", "key": "id_ed25519_pendler"}
    assert json.loads(call(f"{server}/api/ssh/keys")[1])["keys"][0]["name"] == "id_ed25519_pendler"
    start = {"type": "start", "user": "root", "cols": 80, "rows": 24}
    served.keys, served.password = {blob}, "snapmaker"
    with connect(_url(server), origin=server, open_timeout=5) as ws:
        ws.send(json.dumps(start))
        answer = json.loads(ws.recv(timeout=15))
        assert (answer["type"], answer["via"]) == ("open", "key")
    assert served.tried == []   # no password needed
    served.keys = set()         # the U1 started anew: the key is gone
    with connect(_url(server), origin=server, open_timeout=5) as ws:
        ws.send(json.dumps(start))
        assert json.loads(ws.recv(timeout=15))["via"] == "default"


def test_the_login_per_printer(server, printer, fake_home):
    """One choice per printer (the user's wish of 26.09.2026): the password when nothing is chosen,
    as most use one, without trying any key; "auto" tries this computer's keys as ssh does; a
    chosen key goes before them. A key and "auto" never both."""
    _, served = printer
    blob = _key(fake_home / ".ssh", "id_ed25519", ed25519.Ed25519PrivateKey.generate())
    _key(fake_home / ".ssh", "u1_key", ed25519.Ed25519PrivateKey.generate())
    served.keys, served.password = {blob}, "snapmaker"
    camera.set_host("Snapmaker U1", "127.0.0.1")
    start = {"type": "start", "user": "root", "cols": 80, "rows": 24}

    def via():
        with connect(_url(server), origin=server, open_timeout=5) as ws:
            ws.send(json.dumps(start))
            answer = json.loads(ws.recv(timeout=15))
            assert answer["key"] == (ssh.setting("Snapmaker U1").get("key") if ssh.login_of("Snapmaker U1") == "key" else None)
            return answer["via"]

    def choose(**payload):
        status, body = call(f"{server}/api/printers/ssh", "POST", {"model": "Snapmaker U1", "user": "root", **payload}, headers={"Origin": server})
        return status, json.loads(body)

    # Nothing chosen: the password, though id_ed25519 would fit.
    assert (ssh.login_of("Snapmaker U1"), via()) == ("password", "default")
    status, body = choose(login="auto")
    assert status == 200 and body["printers"]["Snapmaker U1"]["ssh"] == {"user": "root", "login": "auto"}
    assert (ssh.login_of("Snapmaker U1"), via()) == ("auto", "key")
    status, body = choose(key="u1_key", login="auto")
    assert status == 200 and body["printers"]["Snapmaker U1"]["ssh"] == {"user": "root", "key": "u1_key"}
    assert (ssh.login_of("Snapmaker U1"), via()) == ("key", "key")   # u1_key does not fit, id_ed25519 after it does
    status, body = choose(login="password")
    assert status == 200 and body["printers"]["Snapmaker U1"]["ssh"] == {"user": "root"}
    assert (ssh.login_of("Snapmaker U1"), via()) == ("password", "default")
    assert choose(login="keys") == (400, {"error": "ssh_login_invalid"})
    # A typed password goes before everything, as before.
    served.tried = []
    with connect(_url(server), origin=server, open_timeout=5) as ws:
        ws.send(json.dumps({**start, "password": "snapmaker"}))
        assert json.loads(ws.recv(timeout=15))["via"] == "typed"
    assert served.tried == ["snapmaker"]


def test_bring_the_key_onto_the_printer(server, printer, fake_home, monkeypatch):
    """On the user's click: the key into authorized_keys on the printer, once; logged in with the
    password as shipped, then checked with only the key. Never from another device."""
    _, served = printer
    served.password = "snapmaker"
    blob = _key(fake_home / ".ssh", "id_ed25519_pendler", ed25519.Ed25519PrivateKey.generate())
    camera.set_host("Snapmaker U1", "127.0.0.1")
    ssh.save_setting("Snapmaker U1", None, "id_ed25519_pendler")
    status, body = call(f"{server}/api/printers/ssh-key", "POST", {"model": "Snapmaker U1"}, headers={"Origin": server})
    assert (status, json.loads(body)) == (200, {"result": "added", "verified": True, "forgets": True})
    assert served.authorized == [blob] and served.tried == ["snapmaker"]
    assert f"'ssh-ed25519 {blob} orcaone'" in served.commands[0]
    # Again: logged in with the key now, and the line is there already.
    assert json.loads(call(f"{server}/api/printers/ssh-key", "POST", {"model": "Snapmaker U1"}, headers={"Origin": server})[1])["result"] == "present"
    assert served.authorized == [blob] and served.tried == ["snapmaker"]
    # A typed password only passes through, it is never kept.
    served.keys, served.password = set(), "Pw-7-geheim"
    status, body = call(f"{server}/api/printers/ssh-key", "POST", {"model": "Snapmaker U1", "password": "Pw-7-geheim"}, headers={"Origin": server})
    assert (status, json.loads(body)["result"], served.tried[-1]) == (200, "present", "Pw-7-geheim")
    assert "Pw-7-geheim" not in (settings.DATA_DIR / "settings.json").read_text(encoding="utf-8")
    monkeypatch.setattr(app_module, "is_remote", lambda client: True)
    for path, method in (("/api/printers/ssh-key", "POST"), ("/api/printers/ssh", "POST"), ("/api/ssh/keys", "GET")):
        status, body = call(f"{server}{path}", method, {"model": "Snapmaker U1"} if method == "POST" else None)
        assert (status, json.loads(body)) == (403, {"error": "local_only"}), path


@pytest.mark.skipif(shutil.which("sh") is None, reason="no POSIX shell")
def test_the_command_that_brings_the_key(tmp_path, fake_home, monkeypatch):
    """The shell command of install_key in a real sh: the line once, a last line without a newline
    kept whole, the folder and file only for their owner."""
    blob = _key(fake_home / ".ssh", "k", ed25519.Ed25519PrivateKey.generate())
    home = tmp_path / "printer"
    (home / ".ssh").mkdir(parents=True)
    (home / ".ssh" / "authorized_keys").write_text("ssh-rsa AAAAold other", encoding="utf-8")
    commands = []

    class Channel:
        def recv_exit_status(self):
            return 0

    class Out:
        def __init__(self, text):
            self.text, self.channel = text, Channel()

        def read(self):
            return self.text

    class Client:
        def exec_command(self, command, timeout):
            commands.append(command)
            done = subprocess.run(["sh", "-c", command], env={**os.environ, "HOME": str(home)}, capture_output=True, timeout=10)
            return None, Out(done.stdout), None

        def close(self):
            pass

    camera.set_host("Snapmaker U1", "127.0.0.1")
    ssh.save_setting("Snapmaker U1", None, "k")
    monkeypatch.setattr(ssh, "connect", lambda *a, **k: Client())
    monkeypatch.setattr(ssh, "_works", lambda *a: True)
    assert ssh.install_key("Snapmaker U1")["result"] == "added"
    assert ssh.install_key("Snapmaker U1")["result"] == "present"
    lines = (home / ".ssh" / "authorized_keys").read_text(encoding="utf-8").splitlines()
    assert lines == ["ssh-rsa AAAAold other", f"ssh-ed25519 {blob} orcaone"]
    if os.name == "posix":
        assert (home / ".ssh").stat().st_mode & 0o777 == 0o700
        assert (home / ".ssh" / "authorized_keys").stat().st_mode & 0o777 == 0o600


def test_a_key_that_does_not_fit_leaves_the_password(server, printer, fake_home):
    """An RSA or ECDSA key the printer refuses (the U1 forgot it at its start): the password as
    shipped follows, as for an Ed25519 key. paramiko would end a key file tried as every key type
    with the load error of the last, so OrcaOne hands it the loaded key."""
    _, served = printer
    served.password = "snapmaker"
    camera.set_host("Snapmaker U1", "127.0.0.1")
    for name, private in (("u1_rsa", rsa.generate_private_key(public_exponent=65537, key_size=2048)),
                          ("u1_ecdsa", ec.generate_private_key(ec.SECP256R1()))):
        _key(fake_home / ".ssh", name, private)
        ssh.save_setting("Snapmaker U1", None, name)
        with connect(_url(server), origin=server, open_timeout=5) as ws:
            ws.send(json.dumps({"type": "start", "user": "root", "cols": 80, "rows": 24}))
            answer = json.loads(ws.recv(timeout=15))
            assert (answer["type"], answer["via"], answer["keys"]) == ("open", "default", True), name
