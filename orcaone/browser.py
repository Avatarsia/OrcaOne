"""The page in a window of its own in the default browser, when OrcaOne starts (__main__.py).

webbrowser.open only asks the system to show the page, which usually becomes a tab in a window that
is open already. So OrcaOne looks up the default browser as the system does: on Linux with
xdg-settings and its .desktop file, on Windows with the user's choice for http in the registry, on
macOS with LaunchServices (Chromium family only: a second Firefox would refuse the profile).
The Chromium family (Chrome, Chromium, Edge, Brave, Vivaldi) takes --app=<url> and shows the page as
an app: a window without tabs, address bar and bookmarks. Firefox and Opera take --new-window.
Any other browser, or any error: webbrowser.open_new.
"""

import os
import platform
import plistlib
import shlex
import subprocess
import webbrowser
from pathlib import Path

_APP = ("chrome", "chromium", "msedge", "microsoft-edge", "edgemac", "brave", "vivaldi")
_NEW_WINDOW = ("firefox", "opera")
_MAC_CHROMIUM = {"com.google.chrome", "org.chromium.chromium", "com.microsoft.edgemac", "com.brave.browser",
                 "com.vivaldi.vivaldi", "com.operasoftware.opera"}


def window_args(command: list[str], url: str) -> list[str] | None:
    """What makes this browser show url in a window of its own; None for a browser OrcaOne does
    not know."""
    names = [Path(part).name.lower() for part in command]
    if any(family in name for name in names for family in _APP):
        return [f"--app={url}"]
    if any(family in name for name in names for family in _NEW_WINDOW):
        return ["--new-window", url]
    return None


def exec_of(desktop_entry: str) -> list[str] | None:
    """The command in Exec= of [Desktop Entry], without field codes (%u) and Flatpak's @@ marks."""
    in_entry = False
    for line in desktop_entry.splitlines():
        line = line.strip()
        if line.startswith("["):
            in_entry = line == "[Desktop Entry]"
        elif in_entry and line.startswith("Exec="):
            try:
                parts = shlex.split(line[len("Exec="):])
            except ValueError:
                return None
            return [p for p in parts if not p.startswith(("%", "@@"))] or None
    return None


def exe_of(open_command: str) -> list[str] | None:
    """The program in a Windows open command: '"C:\\...\\chrome.exe" --single-argument %1'."""
    parts = shlex.split(open_command, posix=False)
    return [parts[0].strip('"')] if parts else None


def bundle_of(plist: bytes) -> str | None:
    """The app that opens http links, from com.apple.launchservices.secure.plist."""
    try:
        handlers = plistlib.loads(plist).get("LSHandlers", [])
    except (plistlib.InvalidFileException, ValueError):
        return None
    return next((h.get("LSHandlerRoleAll") for h in handlers if isinstance(h, dict) and h.get("LSHandlerURLScheme") == "http"), None)


def _linux() -> list[str] | None:
    try:
        desktop = subprocess.run(["xdg-settings", "get", "default-web-browser"], capture_output=True, text=True, timeout=5).stdout.strip()
    except (OSError, subprocess.SubprocessError):
        return None
    home = Path.home()
    dirs = [os.environ.get("XDG_DATA_HOME") or str(home / ".local" / "share")]
    dirs += (os.environ.get("XDG_DATA_DIRS") or "/usr/local/share:/usr/share").split(":")
    dirs += ["/var/lib/snapd/desktop", "/var/lib/flatpak/exports/share", str(home / ".local/share/flatpak/exports/share")]
    for folder in dirs:
        file = Path(folder) / "applications" / desktop
        if desktop.endswith(".desktop") and file.is_file():
            return exec_of(file.read_text(encoding="utf-8", errors="replace"))
    return None


def _windows() -> list[str] | None:
    import winreg
    try:
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER,
                            r"Software\Microsoft\Windows\Shell\Associations\UrlAssociations\http\UserChoice") as key:
            prog_id = winreg.QueryValueEx(key, "ProgId")[0]
        with winreg.OpenKey(winreg.HKEY_CLASSES_ROOT, prog_id + r"\shell\open\command") as key:
            return exe_of(winreg.QueryValueEx(key, "")[0])
    except OSError:
        return None


def _mac() -> list[str] | None:
    plist = Path.home() / "Library/Preferences/com.apple.LaunchServices/com.apple.launchservices.secure.plist"
    try:
        bundle = bundle_of(plist.read_bytes())
    except OSError:
        return None
    return ["open", "-n", "-b", bundle, "--args"] if bundle and bundle.lower() in _MAC_CHROMIUM else None


def default_browser() -> list[str] | None:
    """The default browser's command, to put window_args after, or None."""
    return {"Linux": _linux, "Windows": _windows, "Darwin": _mac}.get(platform.system(), lambda: None)()


def open_window(url: str) -> None:
    command = default_browser()
    args = window_args(command, url) if command else None
    if args:
        try:
            # Its own session, so the browser stays when OrcaOne is ended with Ctrl+C.
            extra = {} if os.name == "nt" else {"start_new_session": True}
            subprocess.Popen(command + args, stdin=subprocess.DEVNULL,
                             stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, **extra)
            return
        except OSError:
            pass
    webbrowser.open_new(url)
