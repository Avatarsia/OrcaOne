# Orfix

Orfix ist eine lokale Web-App, mit der man die Profile von OrcaSlicer und Snapmaker Orca überblickt, aufräumt und zwischen beiden überträgt. Orfix läuft auf dem Rechner, auf dem auch der Slicer läuft, und ist nur dort erreichbar (127.0.0.1).

**Stand: Phase 1 (Übersicht), in Arbeit.** Orfix liest beide Slicer live ein und zeigt Drucker, Filamente, Sicherungen und die Datenordner. Die Oberfläche folgt dem Entwurf E2. Änderungen lassen sich schon zusammenstellen, gespeichert wird aber noch nichts. Orfix schreibt nichts in die Slicer-Daten.

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

## Seiten

Links steht das Menü, oben die Wahl der Installation und „Neu einlesen“.

- **Filamente:** erst die Drucker als Bilder, dann je Drucker die Düse, die aktiven Filamente als Spulen und der Baum aus „Eigene“, „Vom Hersteller“ und „Orca-Bibliothek“. Ein- und ausschalten per Schalter oder Ziehen, dazu „Bearbeiten“ und „Neues Filament“.
- **Drucker:** den Drucker festlegen, mit dem der Slicer startet, Drucker entfernen und dabei Filamente mitlöschen, die nur zu ihm gehören, veraltete Einträge der `.conf` aufräumen.
- **Sicherungen:** alle Sicherungen mit Größe, „Jetzt sichern“ und „Wiederherstellen“. Orfix legt erst ab Phase 2 Sicherungen an, bis dahin ist die Liste leer.
- **Slicer** (unter „Technik“): alle Installationen, Hinweise, Platz, Ordnerbaum mit Erklärung je Ordner, Herstellerpakete, `.conf` und Datenordner von Hand hinzufügen oder entfernen.

Alles Ändernde landet in der Änderungsliste unten. „Übernehmen“ ist noch aus, das Speichern kommt mit dem nächsten Schritt.

## Was Phase 1 kann

- Installationen finden:
  - Linux: `~/.config` bzw. `$XDG_CONFIG_HOME`, Flatpak und portable AppImages (`<Datei>.AppImage.config`);
  - Windows: `%APPDATA%`;
  - macOS: `~/Library/Application Support`;
  - dazu Slicer, die gerade mit `--datadir` laufen.
- Datenordner von Hand hinzufügen und wieder entfernen. Die Liste liegt in `~/.local/share/orfix/instances.json` bzw. `%LOCALAPPDATA%\orfix\instances.json`.
- Herstellerpakete aus JSON und aus `.opc` (OrcaSlicer-Nightly) lesen, eigene Profile samt `.info`, die Bundles von OrcaSlicer main.
- Vererbung, Sichtbarkeit und Kompatibilität so auflösen wie der Slicer. Dazu gehört auch, welche Bibliotheksprofile ein Herstellerprofil verdrängt.
- Hinweise geben, etwa zu verwaisten eigenen Profilen, zu versteckten Bibliotheksprofilen in Snapmaker Orca und zu toten Einträgen in `orca_presets`.
- Erkennen, ob der Slicer läuft. Dann heißt es „Läuft – nur ansehen“ samt Grund, und alle ändernden Knöpfe sind aus.
- Hell- und Dunkelmodus folgen der Systemeinstellung.

## Manuell testen

1. Orfix starten. Unter „Filamente“ erscheinen die Drucker beider Installationen.
2. Einen Drucker anklicken, etwa den U1, und eine Düse wählen. „Aktiv“ zeigt dieselben Filamente wie die Auswahl im Slicer (Vergleich nach `docs/TEST-VERGLEICH.md`, Teil A).
3. Ein Filament einschalten. Unten erscheint „1 Änderung“. „Übernehmen …“ zeigt die Liste, der Knopf „Übernehmen“ ist aus und sagt, dass das Speichern später kommt. „Verwerfen“ stellt den Stand wieder her.
4. Unter „Drucker“ „Als Standard“ oder „Entfernen“ wählen. Beides erscheint ebenfalls in der Änderungsliste. Die Seite „Filamente“ zeigt einen entfernten Drucker nicht mehr an.
5. Unter „Sicherungen“ steht „Noch keine Sicherungen – Orfix legt vor jeder Änderung automatisch eine an“. „Jetzt sichern“ landet in der Änderungsliste.
6. Unter „Slicer“ eine Kopie eines Datenordners hinzufügen, zum Beispiel nach `cp -r ~/.config/Snapmaker_Orca /tmp/snorca-kopie`. Sie erscheint als „Von Hand hinzugefügt“ und lässt sich mit „Entfernen“ wieder entfernen. Dabei wird nur der Eintrag in Orfix gelöscht, nicht der Ordner. Ein falscher Ordner, etwa der Home-Ordner, ergibt eine Fehlermeldung, die sagt, was zu tun ist.
7. Einen Slicer starten und „Neu einlesen“ klicken. Die Installation heißt dann „Läuft – nur ansehen“, die Seiten nennen den Grund. Den Slicer beenden und wieder neu einlesen.
8. Orfix im Terminal beenden und „Neu einlesen“ klicken. Es erscheint „Orfix antwortet nicht …“. Nach einem Neuladen der Seite steht dort, was zu tun ist, samt „Erneut versuchen“.
9. Prüfen, dass nichts geschrieben wurde: `ls -l --time-style=full-iso ~/.config/Snapmaker_Orca/Snapmaker_Orca.conf` vor und nach den Schritten 3 bis 5 vergleichen.
10. Die Systemeinstellung zwischen hell und dunkel wechseln. Orfix zieht mit.

## Tests

```bash
.lenv/bin/python -m pytest
```

Die Tests laufen nur gegen die Fixtures in `tests/fixtures/` und gegen temporäre Ordner, nie gegen echte Slicer-Daten.

## Aufbau

| Pfad | Inhalt |
|---|---|
| `orfix/__main__.py` | Start: freier Port, Server, Browser |
| `orfix/app.py` | FastAPI-App, API unter `/api`, Oberfläche unter `/`. `GET /api/data` liefert alle Seiten live |
| `orfix/overview.py` | baut `GET /api/data`: je Installation Drucker, Filamente, Hinweise und die Seiten „Slicer“, „Drucker“, „Sicherungen“. Texte kommen als Codes |
| `orfix/scanner.py` | liest `system/`, eigene Profile und den Ordnerbaum (nur lesend) |
| `orfix/resolver.py` | Vererbung, Sichtbarkeit, Kompatibilität, Bibliotheks-Ausschluss |
| `orfix/opc.py` | Leser für das `.opc`-Format der OrcaSlicer-Nightly |
| `orfix/instances.py` | Installationen finden, manuelle Pfade |
| `orfix/guard.py` | Prüfen, ob ein Slicer läuft (nur lesend) |
| `orfix/conf.py` | `.conf` byte-genau lesen und schreiben |
| `orfix/model.py` | Dataclasses |
| `orfix/static/` | Oberfläche: Vue 3 ohne Build-Schritt. `app.js` (Rahmen, Menü, Änderungsliste), `common.js` (Daten, Zustand, Symbole), `pages/` (eine Datei je Seite), `texts.js` (alle Texte), `style.css`, Druckerbilder in `assets/` |
| `prototypes/opc/` | Prototyp für das `.opc`-Format, jetzt in `orfix/opc.py` |
| `prototypes/U1Cam/` | Kamera des U1 wecken und Bilder holen, kein Teil von Orfix |
| `docs/` | Befunde (`FINDINGS.md`), Plan (`PLAN.md`), Arbeitsstand (`STAND.md`) |
| `ORFIX_SPEC.md` | Spezifikation |

Die Entwürfe D, E und E2 liegen nur noch in der Git-Geschichte, zuletzt in Commit `deee0f2` unter `prototypes/ui-overview/`.

## Offene Punkte

- **Speichern fehlt noch.** „Übernehmen“ ist aus. Sicherung, `.conf` ändern und eigene Profile anlegen kommen als erster Teil von Phase 2.
- **„Neu einlesen“ verwirft die Änderungsliste**, weil sie sich auf den alten Stand bezieht. Orfix sagt es in der Meldung danach.
- **Sicherungen:** Das Seitenpanel zeigt noch nicht, was eine Wiederherstellung zurückbringt und was wegfällt. Dafür muss das Backend eine Sicherung mit dem jetzigen Stand vergleichen. Die Felder einer Sicherung (`id`, `time`, `kind`, `size`, `files`, `file`, `detail`) sind angenommen und werden mit Phase 2 festgelegt.
- **Schnappschuss „Neu seit dem letzten Scan“** (PLAN 1.4) fehlt noch.
- **Windows ist bisher nur mit nachgebauten Dateien getestet.** Die `.conf` mit Prüfsummenzeile ist synthetisch. Bitte vom Windows-Rechner eine echte `Snapmaker_Orca.conf` bzw. `OrcaSlicer.conf` besorgen. Vorher `devices` bzw. `local_machines` leeren, weil dort Zugangsdaten stehen. Außerdem einmal `orfix.cmd` starten.
- **Flatpak ist ungetestet**, auf diesem Rechner gibt es keins.
- **Praxistest „Bibliothek freischalten“** (FINDINGS 4.7): Er läuft mit einer Kopie des Datenordners und `--datadir`, bevor Phase 2 ihn anbietet.
- **Das Formular „Datenordner hinzufügen“** reagierte im Test-Browser der App nicht auf die Enter-Taste, nur auf den Knopf. In einem normalen Browser bitte kurz prüfen.
- **Vom Backend nicht nachgeprüft:** Den Druckernamen nach „@“ bei eigenen Wurzel-Filamenten setzt Orfix für jede OrcaSlicer-Version ein, geprüft ist das nur im Code von Orca main. Versionen wie „2.5.0-dev“ gelten als gültig, ohne Abgleich mit `semver.c`.
