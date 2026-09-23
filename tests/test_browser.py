"""The default browser and how it shows OrcaOne in a window of its own (orcaone/browser.py), from
what the systems store."""

import plistlib

from orcaone import browser

URL = "http://127.0.0.1:4711/"
APP = [f"--app={URL}"]
NEW_WINDOW = ["--new-window", URL]


def test_desktop_files():
    snap = "[Desktop Entry]\nName=Firefox\nExec=/snap/bin/firefox %u\n[Desktop Action new-window]\nExec=/snap/bin/firefox -new-window\n"
    assert browser.exec_of(snap) == ["/snap/bin/firefox"]
    assert browser.window_args(["/snap/bin/firefox"], URL) == NEW_WINDOW
    flatpak = ("[Desktop Entry]\nExec=/usr/bin/flatpak run --branch=stable --arch=x86_64 --command=brave "
               "--file-forwarding com.brave.Browser @@u %U @@\n")
    command = browser.exec_of(flatpak)
    assert command[-1] == "com.brave.Browser" and browser.window_args(command, URL) == APP
    command = browser.exec_of('[Desktop Entry]\nExec=env BAMF_DESKTOP_FILE_HINT=/x.desktop "/opt/Google Chrome/chrome" %U\n')
    assert command == ["env", "BAMF_DESKTOP_FILE_HINT=/x.desktop", "/opt/Google Chrome/chrome"] and browser.window_args(command, URL) == APP
    assert browser.exec_of("[Desktop Entry]\nName=Kein Exec\n") is None
    assert browser.window_args(["/usr/bin/epiphany"], URL) is None


def test_windows_open_command():
    command = browser.exe_of('"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" --single-argument %1')
    assert command == ["C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"] and browser.window_args(command, URL) == APP
    assert browser.window_args(browser.exe_of('"C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe" -- "%1"'), URL) == APP
    assert browser.window_args(browser.exe_of('"C:\\Program Files\\Mozilla Firefox\\firefox.exe" -osint -url "%1"'), URL) == NEW_WINDOW
    assert browser.exe_of("") is None


def test_macos_launch_services():
    plist = plistlib.dumps({"LSHandlers": [{"LSHandlerURLScheme": "mailto", "LSHandlerRoleAll": "com.apple.mail"},
                                           {"LSHandlerURLScheme": "http", "LSHandlerRoleAll": "com.brave.browser"}]})
    assert browser.bundle_of(plist) == "com.brave.browser"
    assert browser.bundle_of(plistlib.dumps({"LSHandlers": []})) is None
    assert browser.bundle_of(b"no plist") is None
    assert browser.window_args(["open", "-n", "-b", "com.microsoft.edgemac", "--args"], URL) == APP
    assert browser.window_args(["open", "-n", "-b", "com.operasoftware.opera", "--args"], URL) == NEW_WINDOW


def test_open_window(monkeypatch):
    started, opened = [], []
    monkeypatch.setattr(browser.subprocess, "Popen", lambda command, **kwargs: started.append(command))
    monkeypatch.setattr(browser.webbrowser, "open_new", opened.append)
    for command in (["/snap/bin/brave"], ["/usr/bin/epiphany"], None):
        monkeypatch.setattr(browser, "default_browser", lambda: command)
        browser.open_window(URL)
    # An unknown browser, or none found: the system shows the page as it likes.
    assert started == [["/snap/bin/brave", *APP]] and opened == [URL, URL]
