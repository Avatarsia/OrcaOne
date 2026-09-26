"""A terminal on a printer over SSH, for the page "SSH" (the user's wish of 24.09.2026). The
browser shows it with xterm.js, OrcaOne speaks SSH with paramiko and passes the bytes on over a
WebSocket. Only to a printer whose address OrcaOne knows (camera.printers), never to any host.

The login, as chosen per printer (login_of; the user's wish of 26.09.2026: the password first,
as most use it): a password typed on the page, else the printer's password as shipped
(DEFAULT_PASSWORDS); or the keys, first the one chosen for the printer (a file in ~/.ssh, the user's
wish of 25.09.2026: a key with another name than id_* was never tried), the keys in ~/.ssh and the
SSH agent, as ssh would try them, then the password as shipped. If none fits, the page asks. This
computer's keys and agent only for a page on this computer (app.is_remote): from the LAN anyone
could name a "printer" at any host. Passwords only pass through, nothing keeps them. The printer's host key is
taken as it comes and shown: the U1 makes a new one whenever Root Access is switched on after a
start, since its /etc/dropbear lies in the overlay that /etc/init.d/S01aoverlayfs clears at every
start (checked 24.09.2026). A remembered key would only raise false alarms.

Messages from the page are JSON: {"type": "start", "user", "password"?, "cols", "rows"}, {"type": "password",
"password"}, {"type": "data", "data"}, {"type": "resize", "cols", "rows"}. To the page: the
terminal's bytes as binary messages, and JSON {"type": "password", "again"}, {"type": "open",
"host", "user", "fingerprint"}, {"type": "error", "code", "detail"?}, {"type": "closed"}.
"""

import asyncio
import base64
import hashlib
import json
import re
import shlex
import socket
from pathlib import Path

import paramiko
from starlette.websockets import WebSocket, WebSocketDisconnect

from . import camera, settings
from .camera import CameraError

PORT = 22
TIMEOUT = 10  # s, for the connection, the greeting and the login each
# s, for the look whether SSH is on (probe): Windows says "refused" only after about 2 s, as it
# tries twice more (measured 26.09.2026), so more than that.
PROBE_TIMEOUT = 4
USER = re.compile(r"^[a-z_][a-z0-9_.-]{0,31}$")
TERM = "xterm-256color"
# The root password of a U1 as shipped, for root and lava, public in the docs of the Extended
# Firmware (docs/ssh_access.md); tried without a typed password on the user's wish of 24.09.2026.
DEFAULT_PASSWORDS = {"Snapmaker U1": "snapmaker"}
# A key is a file name in ~/.ssh, never a path: the API cannot be made to read anything else.
KEY_NAME = re.compile(r"[A-Za-z0-9][A-Za-z0-9._@+-]{0,99}")
_PRIVATE = re.compile(rb"-----BEGIN (OPENSSH|RSA|EC) PRIVATE KEY-----")   # what paramiko loads
_PUBLIC = re.compile(r"(ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp(?:256|384|521)) ([A-Za-z0-9+/]+={0,2})(?: .*)?")


class _TakeKey(paramiko.MissingHostKeyPolicy):
    """Takes the printer's host key without keeping it (see above); the page shows its fingerprint."""

    def missing_host_key(self, client, hostname, key):
        pass


def fingerprint(key: paramiko.PKey) -> str:
    """As OpenSSH writes it: SHA256 of the key, Base64 without padding."""
    return "SHA256:" + base64.b64encode(hashlib.sha256(key.asbytes()).digest()).decode().rstrip("=")


def hostname(host: str) -> str:
    """The printer's address without Moonraker's port: "10.30.40.174:7125" → "10.30.40.174"."""
    host = host.removeprefix("https://")
    return host.rsplit(":", 1)[0] if host.count(":") == 1 else host.strip("[]")


def probe(host: str) -> str:
    """Whether a printer lets SSH in, without a login (the user's wish of 26.09.2026: see on the page
    "Drucker" that it must be switched on first): "on" when port 22 greets with SSH, "off" when it
    refuses (the U1 with Root Access off, checked 23.09.2026), "unknown" when nothing answers."""
    try:
        with socket.create_connection((hostname(host), PORT), timeout=PROBE_TIMEOUT) as conn:
            greeting = conn.recv(64)
    except ConnectionRefusedError:
        return "off"
    except OSError:
        return "unknown"
    return "on" if greeting.startswith(b"SSH-") else "unknown"


def connect(host: str, user: str, password: str | None = None, key: Path | None = None) -> paramiko.SSHClient:
    """The chosen key, then the default keys and the agent; with a password only the password
    (never both: paramiko would take the password as the key's passphrase)."""
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(_TakeKey())
    # Loaded here, not as key_filename: paramiko tries a file as RSA, ECDSA and Ed25519 and ends
    # with the load error of the last, an SSHException, so a key that does not fit would never let
    # the password as shipped follow. One with a passphrase goes through the agent.
    chosen = _load(key) if password is None and key is not None and key.is_file() else None
    try:
        client.connect(hostname(host), port=PORT, username=user, password=password, pkey=chosen, timeout=TIMEOUT,
                       banner_timeout=TIMEOUT, auth_timeout=TIMEOUT, look_for_keys=password is None,
                       allow_agent=password is None)
    except paramiko.SSHException as exc:
        client.close()
        # Without any key paramiko has nothing to try and says so as a plain SSHException:
        # for the page that means the same as a key that does not fit, ask for the password.
        if password is None and "No authentication methods available" in str(exc):
            raise paramiko.AuthenticationException(str(exc)) from None
        raise
    except BaseException:
        client.close()
        raise
    return client


# ---------------------------------------------------------------- a key per printer
def keys_dir() -> Path:
    return Path.home() / ".ssh"


def _load(path: Path):
    """The private key, or None if it has a passphrase (then only through an agent)."""
    try:
        return paramiko.PKey.from_path(path)
    except TypeError:
        return None   # "Password was not given but private key is encrypted" (cryptography)


def list_keys() -> list[dict]:
    """The private keys in ~/.ssh paramiko can load, for the choice per printer: name, type,
    fingerprint, and whether it has a passphrase. Never key material, not even the public part."""
    out = []
    try:
        entries = sorted(keys_dir().iterdir())
    except OSError:
        return out
    for path in entries:
        name = path.name
        if not KEY_NAME.fullmatch(name) or name.endswith(".pub"):
            continue
        try:
            if not path.is_file() or path.stat().st_size > 32768:
                continue
            with path.open("rb") as f:
                if not _PRIVATE.match(f.readline()):
                    continue
            key = _load(path)
            if key is None:
                blob = paramiko.PublicBlob.from_file(str(path.with_name(name + ".pub")))
                key = paramiko.PKey.from_type_string(blob.key_type, blob.key_blob)
                locked = True
            else:
                locked = False
        except Exception:   # noqa: BLE001 - whatever paramiko or the file system says: no key to offer
            continue
        out.append({"name": name, "type": key.algorithm_name, "fingerprint": key.fingerprint, "passphrase": locked})
    return out


def setting(printer: str) -> dict:
    """{"user", "key", "login"} chosen for a printer, each may be missing (camera.printers)."""
    found = camera.printers().get(printer) if isinstance(printer, str) else None
    return (found or {}).get("ssh") or {}


def key_of(printer: str) -> Path | None:
    name = setting(printer).get("key")
    return keys_dir() / name if isinstance(name, str) and KEY_NAME.fullmatch(name) else None


def login_of(printer: str) -> str:
    """How a printer's SSH logs in: "key" (the chosen one first, then as "auto"), "auto" (this
    computer's keys and agent as ssh tries them, then the password as shipped) or "password", also
    when nothing is chosen (the user's wish of 26.09.2026: most use one)."""
    return "key" if key_of(printer) else "auto" if setting(printer).get("login") == "auto" else "password"


def save_setting(printer, user, key, login=None) -> dict:
    """The user and the login for a printer's SSH: a key (one of list_keys()), else login "auto"
    or none, the password; None or "" takes one away."""
    if not isinstance(printer, str) or printer not in camera.printers():
        raise CameraError("printer_not_found")
    if user not in (None, "") and not (isinstance(user, str) and USER.match(user)):
        raise CameraError("ssh_user_invalid")
    if key not in (None, "") and key not in {k["name"] for k in list_keys()}:
        raise CameraError("ssh_key_invalid")
    if login not in (None, "", "password", "auto"):
        raise CameraError("ssh_login_invalid")
    chosen = {k: v for k, v in (("user", user), ("key", key), ("login", "auto" if login == "auto" and not key else None)) if v}

    def edit(data):
        found = data.get("printers") if isinstance(data.get("printers"), dict) else {}
        entry = found.get(printer) if isinstance(found.get(printer), dict) else {}
        entry = {k: v for k, v in entry.items() if k != "ssh"}
        found[printer] = {**entry, "ssh": chosen} if chosen else entry   # also for an address from the slicer
        if not found[printer]:
            found.pop(printer)
        data["printers"] = found

    settings.change(edit)
    return camera.printers()


def public_line(path: Path) -> str:
    """The line for authorized_keys: type and key, and "orcaone" as its comment (no quotes can
    come in). From the key itself, or from its .pub if it has a passphrase."""
    key = _load(path)
    if key is not None:
        return f"{key.get_name()} {key.get_base64()} orcaone"
    try:
        found = _PUBLIC.fullmatch(path.with_name(path.name + ".pub").read_text(encoding="ascii").strip())
    except (OSError, UnicodeError):
        found = None
    if not found:
        raise CameraError("ssh_key_no_public")
    return f"{found.group(1)} {found.group(2)} orcaone"


def install_key(printer: str, password: str | None = None) -> dict:
    """On the user's click: the printer's chosen key into ~/.ssh/authorized_keys on the printer,
    once (a line that is there already stays alone), then a login with only that key as a check.
    The login for it: a typed password, else the keys and the password as shipped. forgets: the
    U1 clears the overlay the file lies in at every start (docs/FINDINGS.md)."""
    found = camera.printers().get(printer) if isinstance(printer, str) else None
    if not found:
        raise CameraError("printer_not_found")
    path = key_of(printer)
    if path is None or not path.is_file():
        raise CameraError("ssh_key_missing")
    line = public_line(path)
    blob = line.split(" ")[1]
    user = setting(printer).get("user") or ("root" if found["model"] in camera.U1_MODELS else "pi")
    tries = [password] if password else [None] + ([DEFAULT_PASSWORDS[found["model"]]] if found["model"] in DEFAULT_PASSWORDS else [])
    client = None
    for p in tries:
        try:
            client = connect(found["host"], user, p, path)
            break
        except paramiko.AuthenticationException:
            continue
        except paramiko.SSHException as exc:
            raise CameraError("ssh_failed", str(exc)) from None
        except OSError as exc:
            raise CameraError("ssh_unreachable", str(exc) or type(exc).__name__) from None
    if client is None:
        raise CameraError("ssh_login")
    keys = "~/.ssh/authorized_keys"
    command = (f"umask 077 && mkdir -p ~/.ssh && touch {keys} && chmod 700 ~/.ssh && chmod 600 {keys} && "
               f"if grep -qF -- {shlex.quote(blob)} {keys}; then echo present; else "
               f"{{ if [ -s {keys} ] && [ -n \"$(tail -c 1 {keys})\" ]; then echo; fi; printf '%s\\n' {shlex.quote(line)}; }} >> {keys} && echo added; fi")
    try:
        _, out, _ = client.exec_command(command, timeout=TIMEOUT)
        result = out.read().decode("utf-8", "replace").strip()
        status = out.channel.recv_exit_status()
    except (OSError, EOFError, paramiko.SSHException) as exc:
        raise CameraError("ssh_key_write", str(exc) or type(exc).__name__) from None
    finally:
        client.close()
    if status != 0 or result not in ("added", "present"):
        raise CameraError("ssh_key_write", result)
    return {"result": result, "verified": _works(found["host"], user, path), "forgets": found["model"] in camera.U1_MODELS}


def _works(host: str, user: str, path: Path) -> bool:
    """A login with only that key; one with a passphrase as the agent holds it, found by its
    fingerprint (any other key of the agent would prove nothing)."""
    key, agent = _load(path), None
    try:
        if key is None:
            blob = paramiko.PublicBlob.from_file(str(path.with_name(path.name + ".pub")))
            wanted = paramiko.PKey.from_type_string(blob.key_type, blob.key_blob).fingerprint
            agent = paramiko.Agent()
            key = next((k for k in agent.get_keys() if k.fingerprint == wanted), None)
            if key is None:
                return False
    except (OSError, ValueError, paramiko.SSHException):
        return False
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(_TakeKey())
    try:
        client.connect(hostname(host), port=PORT, username=user, pkey=key, timeout=TIMEOUT,
                       banner_timeout=TIMEOUT, auth_timeout=TIMEOUT, look_for_keys=False, allow_agent=False)
        return True
    except (OSError, paramiko.SSHException):
        return False
    finally:
        client.close()
        if agent is not None:
            agent.close()


def _size(message: dict) -> tuple[int, int]:
    """Columns and rows as the page measured them, within reason."""
    cols, rows = message.get("cols"), message.get("rows")
    ok = lambda v, low, high: isinstance(v, int) and not isinstance(v, bool) and low <= v <= high
    return (cols if ok(cols, 10, 1000) else 80), (rows if ok(rows, 4, 500) else 24)


async def session(ws: WebSocket, model: str, keys: bool = True) -> None:
    """One terminal: login, then bytes both ways until one side ends. keys: this computer's SSH keys
    and agent may be tried, only for a page on this computer (app.is_remote)."""
    await ws.accept()
    client = None
    try:
        try:
            printer = camera.host_of(model)
        except camera.CameraError as exc:
            await ws.send_json({"type": "error", "code": exc.code})
            return
        start = json.loads(await ws.receive_text())
        user = start.get("user") if isinstance(start, dict) else None
        if not isinstance(user, str) or not USER.match(user):
            await ws.send_json({"type": "error", "code": "ssh_user_invalid"})
            return
        cols, rows = _size(start)
        # What to try, in order, each as (password or None for the keys, typed by the user).
        typed = start.get("password") if isinstance(start.get("password"), str) else ""
        kind = camera.printers()[model]["model"]   # by the model: a second U1 goes by a name of its own
        use_keys = keys and login_of(model) != "password"
        key = key_of(model) if use_keys else None
        # Each as (password or None for the keys, how it logged in).
        tries = ([(typed, "typed")] if typed
                 else ([(None, "key")] if use_keys else []) + ([(DEFAULT_PASSWORDS[kind], "default")] if kind in DEFAULT_PASSWORDS else []))
        # The chosen key, if it was tried: the pages warn only when that one no longer fits.
        tried = key.name if key is not None and not typed else None
        again = False  # the last password the user typed did not fit
        while client is None:
            if not tries:
                await ws.send_json({"type": "password", "again": again})
                answer = json.loads(await ws.receive_text())
                asked = answer.get("password") if isinstance(answer, dict) else None
                if not isinstance(asked, str) or not asked:
                    return
                tries = [(asked, "typed")]
            password, via = tries.pop(0)
            try:
                client = await asyncio.to_thread(connect, printer, user, password, key)
            except paramiko.AuthenticationException:
                again = via == "typed"
            except (OSError, paramiko.SSHException) as exc:
                # Refused or silent: SSH is off (on the U1: Root Access on its display), or no printer there.
                code = "ssh_failed" if isinstance(exc, paramiko.SSHException) else "ssh_unreachable"
                await ws.send_json({"type": "error", "code": code, "detail": str(exc) or type(exc).__name__})
                return
        transport = client.get_transport()
        transport.set_keepalive(30)
        # via: "key", "default" or "typed"; key: the chosen key, if tried: with "default" the printer
        # forgot it (the U1 at every start). keys: this computer's keys may be used (not from the LAN).
        await ws.send_json({"type": "open", "host": hostname(printer), "user": user, "via": via, "keys": keys, "key": tried,
                            "fingerprint": fingerprint(transport.get_remote_server_key())})
        channel = await asyncio.to_thread(client.invoke_shell, TERM, cols, rows)

        async def printer_to_page():
            try:
                while data := await asyncio.to_thread(channel.recv, 32768):
                    await ws.send_bytes(data)
                await ws.send_json({"type": "closed"})
                await ws.close()
            except (WebSocketDisconnect, RuntimeError, OSError):
                pass  # the page went first

        reader = asyncio.create_task(printer_to_page())
        try:
            while True:
                message = await ws.receive()
                if message["type"] == "websocket.disconnect":
                    break
                data = json.loads(message.get("text") or "{}")
                if not isinstance(data, dict):
                    continue
                if data.get("type") == "data" and isinstance(data.get("data"), str):
                    await asyncio.to_thread(channel.sendall, data["data"].encode("utf-8"))
                elif data.get("type") == "resize":
                    channel.resize_pty(*_size(data))
        finally:
            reader.cancel()
    except (WebSocketDisconnect, ValueError, RuntimeError, OSError):
        pass  # the page closed, sent nonsense, or the printer went away
    finally:
        if client is not None:
            client.close()
        try:
            await ws.close()
        except RuntimeError:
            pass  # closed already
