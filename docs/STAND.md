# Arbeitsstand

Stand 24.09.2026. Übergabe zwischen Sessions: was OrcaOne kann, was offen ist, wo was liegt. Was eine Seite genau tut, steht im [README](../README.md), geprüfte Fakten stehen in [FINDINGS](FINDINGS.md), der Verlauf in `git log`.

## Überblick

- **Seiten:**
  - Filamente, darunter Kalibrieren (U1), Übertragen, Vergleichen und Import/Export;
  - Prozesse, nur zum Ansehen;
  - Drucker, darunter Kamera (U1, mit Druckstatus) und Änderungen;
  - 3MF bereinigen;
  - Sicherungen;
  - unter „Technik“ Slicer, Details und Logs.
- **Sprachen:** Deutsch und Englisch.
- **Start:** `./orcaone.sh` bzw. `orcaone.cmd`, Port 4711, auf Wunsch als App-Fenster mit eigenem Symbol ([STARTEN-UND-BAUEN](STARTEN-UND-BAUEN.md)).
- **Schreiben:** nur in `user/**` und in die `.conf`, immer mit Plan, Sicherung und erneutem Einlesen. Den U1 liest OrcaOne nur, über Moonraker.
- **Tests:** 244, alle grün (`.lenv/bin/python -m pytest`).
- **Zuletzt gebaut (24.09.):** Import aus den Sicherungskopien des Slicers (`user_backup-v*`) auf „Import/Export“. Geprüft mit Tests und im Browser; die Kopien auf diesem Rechner sind leer, weil es beim ersten Start noch keine eigenen Profile gab.
- **Davor (23.09.):** Import/Export mit „Hier passend“ und „Was ein Import braucht“, die Seite „3MF bereinigen“, „Änderungen“, „Vergleichen“, der Druckstatus auf „Kamera“ und das App-Fenster. Ideen des Nutzers stehen in [IDEEN](IDEEN.md).

## Offen beim Nutzer

- **„Im LAN suchen“** zu Hause testen. Von diesem Rechner aus findet die Suche wegen WireGuard nichts.
- **Windows-Rechner,** Prüfliste:
  - `orcaone.cmd` starten; alte Daten aus `%LOCALAPPDATA%\orcaone` ziehen nach `data/` um;
  - Sprache umschalten;
  - eine Änderung mit Sicherung und Wiederherstellen;
  - „Logs“ bei laufendem Slicer;
  - IP-Adresse beim U1 eintragen, dann „Kamera“ im Vollbild und „Kalibrieren“;
  - „Im LAN suchen“ im selben LAN;
  - eine echte Windows-`.conf` mitbringen, vorher `devices` bzw. `local_machines` leeren. Hat sie CRLF, und schreibt Windows die MD5 in Großbuchstaben?
- **Im Slicer ausprobieren:**
  - „Bibliothek freischalten“, Weg A und B, mit `SUNLU PLA+ @System`;
  - [TEST-VERGLEICH](TEST-VERGLEICH.md) Teil B, die Spalte „SnOrca“;
  - die „Abnahme-Checkliste Resolver“ in FINDINGS: acht Profile, Werte in OrcaOne und im Slicer vergleichen;
  - ein eigenes Filament, das bei keiner Düse an ist: Blendet OrcaSlicer es aus? Snapmaker Orca tut es;
  - einen Druck mit Flow Calibration von Anfang bis Ende mit „Kalibrieren“ begleiten.
- **Im normalen Browser:** „Kamera“ im echten Vollbild und Enter im Formular „Datenordner hinzufügen“. Beides kann das Testfenster nicht.

## Nächste Bausteine, der Nutzer wählt

- **Import** ([IMPORT-QUELLEN](IMPORT-QUELLEN.md)): G-Code und Drucke direkt vom U1, Profile aus anderen Benutzerordnern (`user/<id>/`, etwa nach einer Anmeldung), die Orca-Bibliothek von GitHub, „An Zielprofil hängen“.
- **Drucker übertragen** zwischen den Installationen, bisher zurückgestellt (FINDINGS, „Übertragung“).
- **„Details“** auch für Prozesse und Drucker. Die Abfrage im Backend kann das schon.
- **Ideen** ([IDEEN](IDEEN.md)): Druck in 3D, dafür braucht es das Okay für three.js. Ein Datei-Browser für den U1; Löschen oder Hochladen hieße, dass OrcaOne erstmals auf den U1 schreibt.

## Offene Prüfpunkte

In FINDINGS unter „Offen: nur am laufenden Slicer prüfbar“:
- Flatpak;
- eine echte Material4Print-ZIP;
- die Cloud-Synchronisation bei angemeldetem Konto;
- `version` eines Bundles, das Snapmaker Orca ohne Anmeldung exportiert;
- das Update-Verhalten von Orca main bei `enable_ota = false`;
- die Standardwerte im G-Code mit High-Flow-Düse;
- ob ein übertragenes Filament im Assistenten unter „Eigene Filamente“ erscheint;
- ob Snapmaker Orca bei fehlendem oder `null`-`"filaments"` wirklich alle Herstellerfilamente zeigt.

## Bekannte Punkte

- **Kalibrieren:** Ein umbenanntes Filament verliert seine Häkchen.
- **Terminal:** Die Meldungen von `__main__.py` und `orcaone.sh` bleiben deutsch.
- **Bauen:** `tools/build.py` ist nur unter Linux ausprobiert, unter Windows und macOS nicht.
- **Snapmaker Orca** meldet in allen Logs dieses Rechners „Update install failed“ für `printers/`. Das ist ein Problem von Snapmaker, nicht von OrcaOne.

## Hinweise für die nächste Session

- **Gedächtnis** unter `-home-dominiks-dev-OrcaOne`. Die Ordner `-orfix` und `-orcaone` sind alte Kopien, der Projektordner heißt seit 23.09. `~/dev/OrcaOne`.
- **`.lenv`** ist zweimal umgezogen. `.lenv/bin/python -m …` läuft, Skripte wie `.lenv/bin/pip` haben alte Pfade im Shebang, also `.lenv/bin/python -m pip` nehmen.
- **Vorschau** aus `.claude/launch.json` auf Port 8765, die App selbst auf 4711.
- **Commits:** jeden in einem sauberen Worktree testen (`git worktree add --detach …`, dort `pytest`). Zwischenstände einer Datei lassen sich mit `git hash-object -w` und `git update-index --cacheinfo` einreihen.
- **Brave als Snap** bleibt ohne Fenster (`--headless`) hängen und lässt sich nur mit `snap run --shell brave -c "kill …"` beenden.
- **Am U1** (10.30.40.174) nur lesende Anfragen. Moonraker vertraut dem ganzen LAN (`trusted_clients: 10.0.0.0/8`), Steuerbefehle gingen also ohne Anmeldung.

## Entscheidungen

| Thema | Entscheidung |
|---|---|
| Name | OrcaOne (Orca + U1), Ordner `~/dev/OrcaOne` |
| Slicer | SnOrca 2.4 sowie OrcaSlicer stabil (2.4.x, JSON) und Nightly (2.5.0-dev, `.opc`) |
| Plattformen | Linux und Windows gleichwertig, ein Windows-Rechner zum Testen ist vorhanden |
| Abhängigkeiten | fastapi, uvicorn, psutil, pytest in `.lenv`; Vue und Schrift liegen lokal; neue nur nach Rücksprache |
| Stil | Farben von OrcaSlicer (Teal `#009688`), Schrift Inter, Druckerbilder, Spulen, wenig Text; eigenes App-Symbol, nichts aus Orca oder SnOrca |
| Grundsatz | kein zweites Orca bauen, sondern ein einfaches Filament-System für Normalos; neue Seiten nur auf Auftrag |
| Prozesse | nur ansehen, nicht bearbeiten (22.09.) |
| Echte Ordner | SnOrca und OrcaSlicer sind auf diesem Rechner Testinstallationen. OrcaOne schreibt direkt hinein, abgesichert durch seine Sicherungen (23.09.) |
| Sicherungen | vor jedem Schreiben automatisch, alle behalten, Gesamtgröße anzeigen |
| U1 | nur lesend über Moonraker; schreibend erst nach Entscheidung des Nutzers |
| Commits | nur auf Auftrag, kleine Schritte, deutsche Commit-Texte |

## Wo was liegt

| Pfad | Inhalt |
|---|---|
| `ORCAONE_SPEC.md` | Spezifikation |
| `docs/FINDINGS.md` | geprüfte Fakten, gehen der Spezifikation vor; am Ende die offenen Prüfpunkte |
| `docs/PLAN.md` | Plan und Designplan; der Designplan ist überholt, die Oberfläche folgt Entwurf E2 |
| `docs/IDEEN.md` | Ideen des Nutzers, noch nicht beauftragt |
| `docs/IMPORT-QUELLEN.md` | was sich woher importieren lässt |
| `docs/RECHERCHE-STOLPERSTEINE.md` | wo Nutzer in Orca und SnOrca oft stolpern |
| `docs/TEST-VERGLEICH.md` | Test „was zeigt SnOrca, was OrcaOne“ |
| `docs/STARTEN-UND-BAUEN.md` | per Symbol starten, selbst bauen |
| `README.md` | Seiten, Module, Tests |
| `orcaone/` | die App; Oberfläche in `static/`, Seiten in `static/pages/`, Texte in `static/texts/de.js` und `en.js` |
| `tools/` | `make_icons.py` (App-Symbol), `make_options.py` (`options.json` aus dem Quellcode der Slicer), `build.py` (PyInstaller) |
| `prototypes/` | `opc/` (`.opc`-Leser), `U1Cam/` (vom Nutzer), `U1 Filament Kalibrierung.md` (Anleitung des Nutzers); Testdateien des Nutzers wie die 3MF liegen dort ohne Git |
| `slicer-src/` | Sparse-Clones von SnOrca v2.4.0 und OrcaSlicer main samt deutscher Übersetzung, nicht im Git |
| `tests/fixtures/` | anonymisierte Ausschnitte aus den echten Installationen |
| `data/` | Einstellungen, Sicherungen und Schnappschüsse; nicht im Git, weil die Sicherungen Zugangsdaten enthalten |
