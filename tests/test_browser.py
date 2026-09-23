"""The default browser's command for a new window (orcaone/browser.py), from what the systems store."""

import plistlib

from orcaone import browser


def test_desktop_files():
    snap = "[Desktop Entry]\nName=Firefox\nExec=/snap/bin/firefox %u\n[Desktop Action new-window]\nExec=/snap/bin/firefox -new-window\n"
    assert browser.exec_of(snap) == ["/snap/bin/firefox"]
    flatpak = ("[Desktop Entry]\nExec=/usr/bin/flatpak run --branch=stable --arch=x86_64 --command=brave "
               "--file-forwarding com.brave.Browser @@u %U @@\n")
    command = browser.exec_of(flatpak)
    assert command[-1] == "com.brave.Browser" and browser.knows_new_window(command)
    assert browser.exec_of('[Desktop Entry]\nExec=env BAMF_DESKTOP_FILE_HINT=/x.desktop "/opt/Google Chrome/chrome" %U\n') == [
        "env", "BAMF_DESKTOP_FILE_HINT=/x.desktop", "/opt/Google Chrome/chrome"]
    assert browser.exec_of("[Desktop Entry]\nName=Kein Exec\n") is None
    assert not browser.knows_new_window(["/usr/bin/epiphany"])


def test_windows_open_command():
    command = browser.exe_of('"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" --single-argument %1')
    assert command == ["C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"] and browser.knows_new_window(command)
    assert browser.knows_new_window(browser.exe_of('"C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe" -- "%1"'))
    assert browser.exe_of("") is None


def test_macos_launch_services():
    plist = plistlib.dumps({"LSHandlers": [{"LSHandlerURLScheme": "mailto", "LSHandlerRoleAll": "com.apple.mail"},
                                           {"LSHandlerURLScheme": "http", "LSHandlerRoleAll": "com.brave.browser"}]})
    assert browser.bundle_of(plist) == "com.brave.browser"
    assert browser.bundle_of(plistlib.dumps({"LSHandlers": []})) is None
    assert browser.bundle_of(b"no plist") is None
