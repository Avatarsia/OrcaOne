# Orfix

Orfix ist eine lokale Web-App, mit der man die Profile von OrcaSlicer und Snapmaker Orca überblickt, aufräumt und zwischen beiden überträgt. Orfix läuft auf dem Rechner, auf dem auch der Slicer läuft, und ist nur dort erreichbar (127.0.0.1).

**Stand: Phase 0, das Grundgerüst.** Orfix findet die Installationen und zeigt, ob der Slicer gerade läuft. Profile zeigt es erst ab Phase 1. Orfix ändert noch nichts an den Slicer-Daten.

## Starten

Linux:

```bash
./orfix.sh
```

Windows: `orfix.cmd` doppelklicken.

Beim ersten Start legen die Skripte die Python-Umgebung `.lenv` an und installieren die Abhängigkeiten aus `requirements.txt`. Dafür braucht es Python ab 3.11, unter Linux mit dem Paket `python3-venv`. Danach öffnet sich der Browser. Beenden mit Strg+C im Terminal.

Ohne Skript geht es so:

```bash
.lenv/bin/python -m orfix
```

Optionen: `--port 8765` für einen festen Port, `--no-browser`, wenn der Browser nicht aufgehen soll.

## Was Phase 0 kann

- Installationen finden:
  - Linux: `~/.config` bzw. `$XDG_CONFIG_HOME`, Flatpak und portable AppImages (`<Datei>.AppImage.config`);
  - Windows: `%APPDATA%`;
  - macOS: `~/Library/Application Support`;
  - dazu Slicer, die gerade mit `--datadir` laufen.
- Datenordner von Hand hinzufügen und wieder entfernen. Die Liste liegt in `~/.local/share/orfix/instances.json` bzw. `%LOCALAPPDATA%\orfix\instances.json`.
- Je Installation zeigen: Slicer, Version, Datenordner, woher sie gefunden wurde, Ordner der eigenen Profile, Anmeldung, Format der Systemprofile (JSON oder `.opc`), Format der `.conf`.
- Erkennen, ob der Slicer läuft. Dann heißt es „Läuft – nur lesen“ samt Grund.
- Hell- und Dunkelmodus folgen der Systemeinstellung.

## Manuell testen

1. Orfix starten. Deine Installationen erscheinen oben in der Auswahl und in der Liste „Alle gefundenen Installationen“.
2. SnOrca oder OrcaSlicer starten und auf „Neu einlesen“ klicken. Der Status wechselt auf „Läuft – nur lesen“, darunter steht ein Hinweis mit der PID.
3. Slicer beenden und wieder „Neu einlesen“ klicken. Der Status ist wieder „Geschlossen“.
4. Unter „Datenordner hinzufügen“ einen falschen Ordner eintragen, etwa den Home-Ordner. Es erscheint eine Fehlermeldung, die sagt, was zu tun ist.
5. Eine Kopie eines Datenordners hinzufügen, zum Beispiel `cp -r ~/.config/Snapmaker_Orca /tmp/snorca-kopie`. Sie erscheint als „Von Hand hinzugefügt“ und lässt sich mit „Entfernen“ wieder entfernen. Dabei wird nur der Eintrag in Orfix gelöscht, nicht der Ordner.
6. Die Systemeinstellung zwischen hell und dunkel wechseln. Orfix zieht mit.

## Tests

```bash
.lenv/bin/python -m pytest
```

Die Tests laufen nur gegen die Fixtures in `tests/fixtures/` und gegen temporäre Ordner, nie gegen echte Slicer-Daten.

## Aufbau

| Pfad | Inhalt |
|---|---|
| `orfix/__main__.py` | Start: freier Port, Server, Browser |
| `orfix/app.py` | FastAPI-App, API unter `/api`, Oberfläche unter `/` |
| `orfix/instances.py` | Installationen finden, manuelle Pfade |
| `orfix/guard.py` | Prüfen, ob ein Slicer läuft (nur lesend) |
| `orfix/conf.py` | `.conf` byte-genau lesen und schreiben |
| `orfix/model.py` | Dataclasses |
| `orfix/static/` | Oberfläche: Vue 3 ohne Build-Schritt, Texte in `texts.js` |
| `prototypes/opc/` | Prototyp für das `.opc`-Format der OrcaSlicer-Nightly |
| `docs/` | Befunde (`FINDINGS.md`) und Plan (`PLAN.md`) |
| `ORFIX_SPEC.md` | Spezifikation |

## Offene Punkte nach Phase 0

- **Windows ist bisher nur mit nachgebauten Dateien getestet.** Die `.conf` mit Prüfsummenzeile ist synthetisch. Bitte vom Windows-Rechner eine echte `Snapmaker_Orca.conf` bzw. `OrcaSlicer.conf` besorgen. Vorher `devices` bzw. `local_machines` leeren, weil dort Zugangsdaten stehen. Außerdem einmal `orfix.cmd` starten.
- **Flatpak ist ungetestet**, auf diesem Rechner gibt es keins.
- **Praxistest „Bibliothek freischalten“** (FINDINGS 4.7): Er läuft mit einer Kopie des Datenordners und `--datadir`, bevor Phase 2 ihn anbietet.
- **Das Formular „Datenordner hinzufügen“** reagierte im Test-Browser der App nicht auf die Enter-Taste, nur auf den Knopf. In einem normalen Browser bitte kurz prüfen.
