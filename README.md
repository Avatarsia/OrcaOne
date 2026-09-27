# OrcaOne

**[English](#english) · [Deutsch](#deutsch)**

[![OrcaOne on YouTube](https://img.youtube.com/vi/346GJLCj2xk/maxresdefault.jpg)](https://youtu.be/346GJLCj2xk)

[![Version](https://img.shields.io/github/v/tag/DrKlipper/OrcaOne?label=version)](https://github.com/DrKlipper/OrcaOne/tags)
[![License](https://img.shields.io/badge/license-PolyForm%20Noncommercial-009688)](LICENSE.md)

## English

A local web app for your **OrcaSlicer** and **Snapmaker Orca** profiles and your **Klipper** printers, the **Snapmaker U1** included.

> [!WARNING]
> **Use at your own risk.** OrcaOne writes into your slicers' configuration (the profiles in `user/` and `Snapmaker_Orca.conf` or `OrcaSlicer.conf`) and, on your click, sends commands to printers. It makes a backup before every change and only writes while the slicer is closed, but that is no guarantee. The author accepts no liability for any damage to data, slicers, printers or prints, as far as the law allows; OrcaOne comes as is, without warranty ([license](LICENSE.md), “No Liability”). You confirm this once after the first start.
>
> Version 0.9 is a beta and barely tested on Linux. An independent project, not affiliated with Snapmaker or OrcaSlicer.

### Features

**Slicer**
- Finds OrcaSlicer and Snapmaker Orca installations (Windows, Linux) and shows what is in them and what changed
- Filaments per printer and nozzle: switch on and off, edit, create, shown as spools in their colours
- Transfer and compare profiles between the slicers
- Import from JSON, ZIP, `.orca_*`, 3MF and slicer backups; export your own profiles as ZIP
- Clean up old entries; strip foreign printers from 3MF projects

**Printer**
- Live status, print control (pause, cancel, pause at layer, exclude objects), restart Klipper
- Errors explained: the U1's codes and Klipper's messages, what they mean and what helps
- 3D and 2D view of the print file, following the running print
- Bed mesh, G-code console, logs with search, SSH in the browser, network and Wi-Fi diagnostics
- Snapmaker U1: camera, files, start prints like on its display, filament calibration

English and German, light and dark, reachable from any device on your LAN.

### Start

Needs Python 3.11 or newer.

- **Windows:** put the folder under `C:\Users\<name>\OrcaOne` (not in OneDrive: backups hold credentials) and double-click `orcaone.cmd`.
- **Linux:** run `./orcaone.sh` (needs `python3-venv`).

The first start sets up a Python environment, then the browser opens `http://127.0.0.1:4711/`. The terminal shows the LAN address for your phone. `--local` keeps OrcaOne on this computer only.

Desktop icon, app window and a build without Python: [docs/STARTEN-UND-BAUEN.md](docs/STARTEN-UND-BAUEN.md) (German).

### Safety

- A backup before every change; each one can be restored in the app.
- Changes are shown as a plan first and written only while the slicer is closed.
- Anyone on your LAN can use OrcaOne without a login. SSH keys, printer addresses and deleting backups work only on the computer itself.
- Commands reach a printer only when you click.

### Documentation

German, in `docs/`: the [Handbuch](docs/HANDBUCH.md) (every page, own data, structure, tests), [Findings](docs/FINDINGS.md) (checked facts about the slicers and the U1) and [Ideas](docs/IDEEN.md).

### Issues

Bugs and ideas: [GitHub Issues](https://github.com/DrKlipper/OrcaOne/issues). Pull requests are welcome, with the license grant in [CONTRIBUTING.md](CONTRIBUTING.md).

### License

[PolyForm Noncommercial 1.0.0](LICENSE.md): free for private and other noncommercial use; selling it needs a separate license. Third-party files keep their own licenses ([list](orcaone/static/vendor/README.md)).

By Dr. Klipper (Dominik Schmidt).

## Deutsch

Eine lokale Web-App für deine Profile in **OrcaSlicer** und **Snapmaker Orca** und deine **Klipper-Drucker**, auch den **Snapmaker U1**.

> [!WARNING]
> **Nutzung auf eigene Gefahr.** OrcaOne schreibt in die Konfiguration deiner Slicer (die Profile in `user/` und `Snapmaker_Orca.conf` bzw. `OrcaSlicer.conf`) und schickt auf deinen Klick Befehle an Drucker. Es legt vor jeder Änderung eine Sicherung an und schreibt nur bei geschlossenem Slicer, eine Garantie ist das nicht. Der Autor übernimmt keine Haftung für Schäden an Daten, Slicern, Druckern oder Drucken, soweit das gesetzlich zulässig ist; OrcaOne kommt, wie es ist, ohne Gewähr ([Lizenz](LICENSE.md), „No Liability“). Das bestätigst du einmal nach dem ersten Start.
>
> Version 0.9 ist eine Beta, unter Linux kaum getestet. Ein unabhängiges Projekt, nicht verbunden mit Snapmaker oder OrcaSlicer.

### Funktionen

**Slicer**
- Findet die Installationen von OrcaSlicer und Snapmaker Orca (Windows, Linux) und zeigt, was drin ist und was sich geändert hat
- Filamente je Drucker und Düse ein- und ausschalten, bearbeiten, neu anlegen, als Spulen in ihren Farben
- Profile zwischen den Slicern übertragen und vergleichen
- Import aus JSON, ZIP, `.orca_*`, 3MF und Sicherungen des Slicers; eigene Profile als ZIP exportieren
- Alte Einträge aufräumen; fremde Drucker aus 3MF-Projekten entfernen

**Drucker**
- Status live, Druck steuern (Pause, Abbruch, Pause bei Schicht, Objekte ausschließen), Klipper neu starten
- Fehler erklärt: die Codes des U1 und Klippers Meldungen, was sie heißen und was hilft
- 3D und 2D Ansicht der Druckdatei, folgt dem laufenden Druck
- Höhenkarte, G-Code-Konsole, Logs mit Suche, SSH im Browser, Netzwerk und WLAN
- Snapmaker U1: Kamera, Dateien, Druckstart wie am Display, Filament kalibrieren

Deutsch und Englisch, hell und dunkel, erreichbar von jedem Gerät im LAN.

### Starten

Braucht Python 3.11 oder neuer.

- **Windows:** den Ordner nach `C:\Users\<Name>\OrcaOne` legen (nicht in OneDrive: die Sicherungen enthalten Zugangsdaten) und `orcaone.cmd` doppelklicken.
- **Linux:** `./orcaone.sh` starten (braucht `python3-venv`).

Der erste Start richtet die Python-Umgebung ein, dann öffnet sich der Browser mit `http://127.0.0.1:4711/`. Die Adresse fürs Handy steht im Terminal. `--local` hält OrcaOne auf diesem Rechner.

Symbol, App-Fenster und ein Build ohne Python: [docs/STARTEN-UND-BAUEN.md](docs/STARTEN-UND-BAUEN.md).

### Sicherheit

- Vor jeder Änderung eine Sicherung, jede lässt sich in OrcaOne wiederherstellen.
- Änderungen erst als Plan, geschrieben nur bei geschlossenem Slicer.
- Im LAN kann jeder OrcaOne ohne Anmeldung bedienen. SSH-Schlüssel, Druckeradressen und das Löschen von Sicherungen gehen nur am Rechner selbst.
- Befehle gehen nur auf Klick an einen Drucker.

### Dokumentation

In `docs/`: das [Handbuch](docs/HANDBUCH.md) (jede Seite, eigene Daten, Aufbau, Tests), [FINDINGS](docs/FINDINGS.md) (geprüfte Fakten zu den Slicern und dem U1) und die [Ideen](docs/IDEEN.md).

### Fehler und Ideen

Über [GitHub Issues](https://github.com/DrKlipper/OrcaOne/issues). Pull Requests sind willkommen, mit der Rechteeinräumung aus [CONTRIBUTING.md](CONTRIBUTING.md).

### Lizenz

[PolyForm Noncommercial 1.0.0](LICENSE.md): frei für private und andere nicht kommerzielle Nutzung; verkaufen braucht eine gesonderte Lizenz. Fremde Dateien behalten ihre Lizenz ([Liste](orcaone/static/vendor/README.md)).

Von Dr. Klipper (Dominik Schmidt).
