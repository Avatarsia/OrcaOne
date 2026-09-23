# OrcaOne starten und bauen

Zwei Wege, OrcaOne ohne Tippen im Terminal zu starten:

1. **Per Symbol mit dem mitgelieferten venv** (`.lenv`). Dafür muss Python installiert sein.
2. **Als eigenes Programm, das du selbst baust.** Es läuft danach ohne Python und ohne `.lenv`.

Linux ist geprüft (Ubuntu 26.04, Python 3.14, PyInstaller 6.22.3). Windows und macOS sind nach den Quellen beschrieben, aber noch nicht ausprobiert.

## Was beim Start passiert

- OrcaOne startet seinen Server auf `127.0.0.1` mit einem freien Port.
- Sobald er bereit ist, öffnet es die Seite in einem **neuen Fenster deines Standardbrowsers**. Den Standardbrowser fragt OrcaOne bei jedem Start beim System nach: unter Linux mit `xdg-settings`, unter Windows in den Standard-Apps, unter macOS über LaunchServices. Es gibt keinen festen Browser.
  - Firefox, Chrome, Chromium, Edge, Brave, Vivaldi und Opera bekommen ein neues Fenster.
  - Andere Browser, etwa Safari, zeigen die Seite als neuen Tab.
  - Unter macOS gilt das neue Fenster nur für die Chromium-Familie, Firefox öffnet dort einen Tab.
- **Beenden:** das Terminal- bzw. Konsolenfenster von OrcaOne schließen oder darin Strg+C drücken. Das Browserfenster bleibt offen, zeigt dann aber nichts mehr an.
- **Deine Daten**, also Einstellungen und Sicherungen, liegen im Ordner `data/`: neben `orcaone.sh` bzw. neben dem gebauten Programm.

---

## 1. Per Symbol starten (mit `.lenv`)

**Voraussetzung:** Python ab 3.11.

- **Windows:** von python.org, bei der Installation „Add python.exe to PATH“ anhaken.
- **Linux:** die Pakete `python3` und `python3-venv`.
- **macOS:** von python.org oder mit Homebrew.

Beim ersten Start legt das Startskript `.lenv` an und installiert die Abhängigkeiten aus `requirements.txt`, dafür braucht es einmal Internet. Danach startet es OrcaOne direkt.

### Windows

1. Den OrcaOne-Ordner ins eigene Benutzerprofil legen, etwa `C:\Users\<Name>\OrcaOne`. Nicht nach `C:\Programme`, dort darf OrcaOne `data\` nicht anlegen. Nicht in einen OneDrive-Ordner wie „Dokumente“ oder „Desktop“, denn die Sicherungen enthalten Zugangsdaten.
2. Rechtsklick auf `orcaone.cmd` → „Verknüpfung erstellen“. Unter Windows 11 steht das unter „Weitere Optionen anzeigen“.
3. Die Verknüpfung in „OrcaOne“ umbenennen und auf den Desktop ziehen. Fürs Startmenü kopierst du sie nach `%APPDATA%\Microsoft\Windows\Start Menu\Programs`.
4. Rechtsklick auf die Verknüpfung → Eigenschaften → „Ausführen: **Minimiert**“. Dann liegt die Konsole nur unten in der Taskleiste. Unter „Anderes Symbol …“ kannst du auch ein eigenes Symbol wählen.
5. Doppelklick: Die Konsole startet minimiert, und das Browserfenster geht auf. Zum Beenden schließt du die Konsole in der Taskleiste.

Beim ersten „Im LAN suchen“ fragt die Windows-Firewall, ob Python im Netz empfangen darf. Für private Netzwerke zulassen.

### Linux

Ein Starter fürs Anwendungsmenü; die Pfade an deinen OrcaOne-Ordner anpassen:

```bash
cat > ~/.local/share/applications/orcaone.desktop <<'EOF'
[Desktop Entry]
Type=Application
Name=OrcaOne
Comment=Profile von OrcaSlicer und Snapmaker Orca verwalten
Exec=/home/NAME/dev/orcaone/orcaone.sh
Path=/home/NAME/dev/orcaone
Icon=/home/NAME/dev/orcaone/orcaone/static/assets/spool.svg
Terminal=true
Categories=Graphics;3DGraphics;
EOF
```

- Nach kurzer Zeit steht „OrcaOne“ im Anwendungsmenü. Ein Symbol auf dem Schreibtisch bekommst du, wenn du die Datei nach `~/Desktop` kopierst. Unter GNOME dann Rechtsklick → „Starten erlauben“.
- `Terminal=true` öffnet ein Terminalfenster mit der Ausgabe von OrcaOne. Schließt du es, endet OrcaOne. Mit `Terminal=false` gibt es kein Fenster, dann lässt sich OrcaOne aber nur noch mit `pkill -f "python -m orcaone"` beenden.

### macOS (nicht getestet)

Eine Datei zum Doppelklicken, im OrcaOne-Ordner:

```bash
cd ~/OrcaOne
printf '#!/bin/sh\nexec "$(dirname "$0")/orcaone.sh"\n' > OrcaOne.command
chmod +x OrcaOne.command orcaone.sh
```

- Ein Doppelklick auf `OrcaOne.command` öffnet das Terminal, startet OrcaOne und das Browserfenster. Zum Beenden schließt du das Terminalfenster.
- `.command`-Dateien lassen sich rechts ins Dock ziehen, neben den Papierkorb.
- Für ein richtiges Programmsymbol im Dock und im Launchpad: Automator → „Programm“ → Aktion „Shell-Skript ausführen“ mit `cd ~/OrcaOne && ./orcaone.sh`, gespeichert als `OrcaOne.app` unter „Programme“. OrcaOne läuft dann ohne Terminal. Beenden lässt es sich über das Zahnrad, das Automator oben in der Menüleiste zeigt.

---

## 2. Selbst bauen (danach ohne Python)

Das Bauskript `tools/build.py` nutzt **PyInstaller**. Es packt Python, alle Pakete und OrcaOne in einen Ordner:

- `dist/OrcaOne/` mit der Programmdatei `OrcaOne` (unter Windows `OrcaOne.exe`) und dem Unterordner `_internal`.
- **Der ganze Ordner ist das Programm.** Du kannst ihn verschieben, aber nicht einzelne Dateien daraus.
- Etwa 35 MB, gebaut in rund 20 Sekunden.
- **Gebaut wird auf dem System, für das es sein soll.** Eine Windows-Fassung entsteht unter Windows, eine Linux-Fassung unter Linux, eine macOS-Fassung unter macOS.
- `data/` legt das Programm beim ersten Speichern neben `OrcaOne` an. Deine bisherigen Einstellungen und Sicherungen nimmst du mit, indem du den Ordner `data` aus dem OrcaOne-Ordner neben das gebaute Programm kopierst.
- **Neue Version:** Code holen, neu bauen, den alten Programmordner ersetzen. `data` dabei behalten.

**Einmal vorbereiten:** OrcaOne einmal mit dem Startskript starten, damit `.lenv` entsteht, und wieder beenden. Dann PyInstaller in `.lenv` installieren. Das ist nur fürs Bauen nötig, nicht fürs Starten.

### Linux

```bash
cd ~/dev/orcaone
.lenv/bin/python -m pip install pyinstaller
.lenv/bin/python tools/build.py
```

- Ergebnis: `dist/OrcaOne/OrcaOne`. Starten mit `dist/OrcaOne/OrcaOne` oder über einen Starter wie oben mit `Exec=…/dist/OrcaOne/OrcaOne` und `Terminal=true`.
- Das Programm läuft auf Linux-Systemen mit gleicher oder neuerer glibc. Willst du es auch auf einem älteren System nutzen, bau es auf dem ältesten.

### Windows (nicht getestet)

```bat
cd %USERPROFILE%\OrcaOne
.lenv\Scripts\python -m pip install pyinstaller
.lenv\Scripts\python tools\build.py
```

- Ergebnis: `dist\OrcaOne\OrcaOne.exe`. Die Verknüpfung dazu legst du an wie oben, am besten mit „Ausführen: Minimiert“.
- Meldet der Virenschutz das selbst gebaute Programm, ist das bei PyInstaller ein häufiger Fehlalarm. OrcaOne baut deshalb einen Ordner und keine einzelne EXE-Datei, die Scanner noch öfter anschlagen lassen.

### macOS (nicht getestet)

```bash
cd ~/OrcaOne
.lenv/bin/python -m pip install pyinstaller
.lenv/bin/python tools/build.py
```

- Ergebnis: `dist/OrcaOne/OrcaOne`. Starten im Terminal oder mit einer `.command`-Datei wie oben, die `dist/OrcaOne/OrcaOne` aufruft.
- Selbst gebaute Programme sperrt Gatekeeper nicht. Kopierst du den Ordner auf einen anderen Mac, beim ersten Mal Rechtsklick → „Öffnen“.
