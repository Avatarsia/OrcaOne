# Arbeitsstand

Stand 22.09.2026, 07:30. Übergabe zwischen Sessions. Das Wichtigste zuerst, Details in [FINDINGS](FINDINGS.md) und [PLAN](PLAN.md).

## Erledigt

- **Phase 0 (Grundgerüst):** fertig und committet.
  - Orfix startet mit `./orfix.sh` und erkennt SnOrca 2.4.0 und OrcaSlicer 2.5.0-dev.
  - Es zeigt, ob ein Slicer läuft, und nimmt Datenordner auch von Hand auf.
  - 38 Tests sind grün (`.lenv/bin/python -m pytest`).
- **Faktenprüfung** von Abschnitt 4 der Spezifikation gegen Quellcode und echte Installation: [FINDINGS](FINDINGS.md). Das schließt ein:
  - das `.opc`-Format der Orca-Nightly, lesbar mit dem Prototyp in `prototypes/opc/`;
  - die Tab-Einrückung von Orca ab 2.4.0;
  - wie die Laufprüfung arbeitet;
  - die versteckte Bibliothek in SnOrca;
  - wie fremde Drucker über 3MF-Projekte in die Auswahl kommen.
- **Review von Phase 0** mit 10 Agenten, alle bestätigten Funde sind behoben.
- **Oberflächen-Entwürfe:** A bis C sind verworfen und nur noch in der Git-Geschichte. D war eine Zwischenstufe. **E ist die Richtung:** `prototypes/ui-overview/variante-e.html`.

## Entscheidungen

| Thema | Entscheidung |
|---|---|
| Name | Orfix, der Ordner heißt `~/dev/orfix` |
| Slicer | SnOrca 2.4 sowie OrcaSlicer stabil (2.4.x, JSON) und Nightly (2.5.0-dev, `.opc`) |
| Plattformen | Linux und Windows gleichwertig. Ein Windows-Rechner zum Testen ist vorhanden |
| Abhängigkeiten | fastapi, uvicorn, psutil, pytest in `.lenv`. Vue und Schrift liegen lokal |
| Stil | Farben von OrcaSlicer (Teal `#009688`), Schrift **Inter**, Druckerbilder, Spulen, wenig Text |
| Seiten | **Filamente** (Hauptmenü mit Druckerbildern → Düse → Baum aus Eigene, Vom Hersteller, Orca-Bibliothek; Bibliothek ausgegraut und aktivierbar; Drag & Drop und „Neu“), **Drucker** (Standard festlegen, aufräumen, Filamente mitlöschen, die nur zu diesem Drucker gehören), **Sicherungen** |
| Sicherungen | vor jedem Schreiben automatisch, alle behalten, Gesamtgröße anzeigen |
| Grundsatz | kein zweites Orca bauen, sondern ein einfaches Filament-System für Normalos. Details nur auf Anforderung |
| Commits | Der Nutzer hat am 21.09. für diese Arbeit Commits erlaubt, kleine Schritte, deutsche Commit-Texte |

## Offene Aufträge (22.09.2026)

1. **Menü:** Die Seite braucht ein ordentliches Menü. Vorlage ist das Menü von ionpy (`~/dev/ionpy`: Kopfleiste bzw. die Navigation links im Gerätefenster, siehe `_images/ksnip_20260827-075151.png` und den Styleguide unter `static/dev/styleguide/desktop/`). Noch nicht angesehen.
2. **Filamentprofile bearbeiten:** Name ändern und Eigenschaften umschreiben.
   - Bei eigenen Profilen direkt.
   - Bei System- und Bibliotheksprofilen entsteht eine eigene Variante mit `inherits`.
   - Das hebt das Nicht-Ziel „kein Bearbeiten einzelner Werte“ der Spezifikation auf.
3. **U1Cam:** Das Skript `prototypes/U1Cam/u1cam.py` stammt vom Nutzer und ist seit 22.09. im Repo. Es weckt die Kamera der Stock-Firmware alle 10 s per Moonraker-WebSocket `camera.start_monitor` (`{"domain": "lan", "interval": 0}`) und holt `http://<drucker>/server/files/camera/monitor.jpg`. Nur Standardbibliothek. Kein Orca-Thema, gehört zu den Ideen rund um den U1 (Kamera, Spoolman).
4. **Recherche:** Wo stolpern Nutzer in Orca und SnOrca oft, und was davon kann Orfix vereinfachen? Quellen: GitHub-Issues, Foren, Reddit. **Läuft seit 22.09. 07:35** als Workflow `orfix-orca-pain-points`. Das Ergebnis landet in `docs/RECHERCHE-STOLPERSTEINE.md`.
5. **Entwürfe** für die Seiten „Drucker“ und „Sicherungen“ im Stil von E. Danach den **Plan für Phase 1** auf Grundlage von E neu schreiben. Der Designplan im PLAN ist als überholt markiert.
6. **Technische Seite „Slicer“ (neu am 22.09.):** eine Übersicht je Installation (was liegt wo, Verzeichnisse, Größen, Erklärung je Ordner). Sie ist wie die jetzige Startseite, aber schön im Stil von E.

**In Arbeit seit 22.09. 07:45:** Workflow `orfix-draft-e2` baut die Punkte 1, 2, 5 und 6 als mehrteiligen Entwurf in `prototypes/ui-overview/e2/`:
- `index.html`, `app.js` mit Menü und Hash-Routing;
- `pages/filamente.js`, `drucker.js`, `sicherungen.js`, `slicer.js`.

Dazu erweitert er `make_data.py` um `slicer_page`, `printers_page`, `backups_page` und `editable_fields`. Die Sichtprüfung im Browser macht der Hauptagent, die Agenten starten keinen Browser.

## Offene Fehler und Punkte

- **`geckodriver`-Prozess:** Ein Agent hat einen `geckodriver` übrig gelassen (PID 98327, Snap-Firefox). Ihn darf nur der Nutzer beenden: `kill 98327`.
- **Enter-Taste:** Im Formular „Datenordner hinzufügen“ hat die Enter-Taste im Test-Browser der App nicht abgeschickt, nur der Knopf. In einem echten Browser prüfen.
- **Windows:** nur mit nachgebauter `.conf` getestet. Eine echte Windows-`.conf` fehlt, vorher `devices` bzw. `local_machines` leeren.
- **Praxistests offen:** „Bibliothek freischalten“ (Weg A und B, mit `--datadir`-Kopie) und Flatpak.
- **Entwürfe:** `prototypes/ui-overview/data.js` ist nicht im Git. Neu erzeugen mit `python3 prototypes/ui-overview/make_data.py`, das liest nur.

## Wo was liegt

| Pfad | Inhalt |
|---|---|
| `ORFIX_SPEC.md` | Spezifikation mit eingearbeiteten Befunden |
| `docs/FINDINGS.md` | geprüfte Fakten. Gehen der Spezifikation vor |
| `docs/PLAN.md` | Plan Phase 0 und 1. Der Designplan ist überholt, Phase 1 wird nach E neu geplant |
| `orfix/` | App: `conf.py`, `instances.py`, `guard.py`, `app.py`, `static/` |
| `prototypes/opc/` | `.opc`-Leser (Machbarkeit, in Phase 1 ins Paket übernehmen) |
| `prototypes/ui-overview/` | Entwürfe D und E, `make_data.py`, Bilder und Symbole |
| `slicer-src/` | Sparse-Clones von SnOrca v2.4.0 und OrcaSlicer main, nicht im Git |
| `tests/fixtures/snorca/` | anonymisierter Ausschnitt aus der echten SnOrca-Installation |
