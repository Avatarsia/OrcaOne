"""A terminal on a printer over SSH, for the page "SSH" (the user's wish of 24.09.2026). The
browser shows it with xterm.js, OrcaOne speaks SSH with paramiko and passes the bytes on over a
WebSocket. Only to a printer whose address OrcaOne knows (camera.printers), never to any host.

The login: a password typed on the page, else first the keys in the user's ~/.ssh and the SSH
agent, as ssh would try them, then the printer's password as shipped (DEFAULT_PASSWORDS); if none
fits, the page asks. Passwords only pass through, nothing keeps them. The printer's host key is
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

import paramiko
from starlette.websockets import WebSocket, WebSocketDisconnect

from . import camera

PORT = 22
TIMEOUT = 10  # s, for the connection, the greeting and the login each
USER = re.compile(r"^[a-z_][a-z0-9_.-]{0,31}$")
TERM = "xterm-256color"
# The root password of a U1 as shipped, for root and lava, public in the docs of the Extended
# Firmware (docs/ssh_access.md); tried without a typed password on the user's wish of 24.09.2026.
DEFAULT_PASSWORDS = {"Snapmaker U1": "snapmaker"}


class _TakeKey(paramiko.MissingHostKeyPolicy):
    """Takes the printer's host key without keeping it (see above); the page shows its fingerprint."""

    def missing_host_key(self, client, hostname, key):
        pass


def fingerprint(key: paramiko.PKey) -> str:
    """As OpenSSH writes it: SHA256 of the key, Base64 without padding."""
    return "SHA256:" + base64.b64encode(hashlib.sha256(key.asbytes()).digest()).decode().rstrip("=")


def hostname(host: str) -> str:
    """The printer's address without Moonraker's port: "10.30.40.174:7125" → "10.30.40.174"."""
    return host.rsplit(":", 1)[0] if host.count(":") == 1 else host.strip("[]")


def connect(host: str, user: str, password: str | None = None) -> paramiko.SSHClient:
    """Keys first; with a password only the password."""
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(_TakeKey())
    try:
        client.connect(hostname(host), port=PORT, username=user, password=password, timeout=TIMEOUT,
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


def _size(message: dict) -> tuple[int, int]:
    """Columns and rows as the page measured them, within reason."""
    cols, rows = message.get("cols"), message.get("rows")
    ok = lambda v, low, high: isinstance(v, int) and not isinstance(v, bool) and low <= v <= high
    return (cols if ok(cols, 10, 1000) else 80), (rows if ok(rows, 4, 500) else 24)


async def session(ws: WebSocket, model: str) -> None:
    """One terminal: login, then bytes both ways until one side ends."""
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
        typed = start.get("password")
        tries = ([(typed, True)] if isinstance(typed, str) and typed
                 else [(None, False)] + ([(DEFAULT_PASSWORDS[model], False)] if model in DEFAULT_PASSWORDS else []))
        again = False  # the last password the user typed did not fit
        while client is None:
            if not tries:
                await ws.send_json({"type": "password", "again": again})
                answer = json.loads(await ws.receive_text())
                asked = answer.get("password") if isinstance(answer, dict) else None
                if not isinstance(asked, str) or not asked:
                    return
                tries = [(asked, True)]
            password, by_user = tries.pop(0)
            try:
                client = await asyncio.to_thread(connect, printer, user, password)
            except paramiko.AuthenticationException:
                again = by_user
            except (OSError, paramiko.SSHException) as exc:
                # Refused or silent: SSH is off (on the U1: Root Access on its display), or no printer there.
                code = "ssh_failed" if isinstance(exc, paramiko.SSHException) else "ssh_unreachable"
                await ws.send_json({"type": "error", "code": code, "detail": str(exc) or type(exc).__name__})
                return
        transport = client.get_transport()
        transport.set_keepalive(30)
        await ws.send_json({"type": "open", "host": hostname(printer), "user": user,
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
