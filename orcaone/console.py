"""The page "Konsole" (the user's wish of 24.09.2026): G-code to Klipper through
Moonraker, and what Klipper answered, for any printer with Klipper and an address; no SSH needed.

Moonraker keeps the last commands and answers with their time (/server/gcode_store, checked on the
U1 on 24.09.2026); the page asks for the new ones every second. A command goes out in the
background, since Moonraker only answers once Klipper has finished it (G28 takes a while). Its
answer comes through the store, errors too: Klipper writes them there as "!! …".
"""

import threading
import urllib.parse
import urllib.request

from . import camera
from .camera import CameraError, _direct, _get

WAIT = 600    # s a command may run; Moonraker's own answer only closes the request
LINES = 200   # how much of the store the page gets at once
LONGEST = 2000


def history(host: str, since=0) -> dict:
    """{"lines": [{"time", "type": "command" or "response", "message"}]}, those after since."""
    since = since if isinstance(since, (int, float)) and not isinstance(since, bool) else 0
    store = _get(host, f"/server/gcode_store?count={LINES}").get("gcode_store") or []
    return {"lines": [{"time": e["time"], "type": e.get("type"), "message": str(e.get("message", ""))}
                      for e in store
                      if isinstance(e, dict) and isinstance(e.get("time"), (int, float)) and e["time"] > since]}


def send(host: str, script) -> dict:
    """One line of G-code, as Moonraker's own web page sends it."""
    if not isinstance(script, str) or not script.strip() or len(script) > LONGEST or "\n" in script or "\r" in script:
        raise CameraError("gcode_invalid")
    url = camera.moonraker_url(host, f"/printer/gcode/script?script={urllib.parse.quote(script.strip())}")

    def run():
        try:
            with _direct.open(urllib.request.Request(url, data=b"", method="POST"), timeout=WAIT) as response:
                response.read()
        except (OSError, ValueError):
            pass  # refusals and errors come through the store

    threading.Thread(target=run, daemon=True).start()
    return {"sent": script.strip()}
