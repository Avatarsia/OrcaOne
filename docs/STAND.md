# Arbeitsstand

Stand 22.09.2026, 11:05. Übergabe zwischen Sessions. Das Wichtigste zuerst, Details in [FINDINGS](FINDINGS.md) und [PLAN](PLAN.md).

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
- **Oberflächen-Entwürfe:** A bis C sind verworfen. D war eine Zwischenstufe. E und E2 sind die Richtung, E2 ist jetzt die App. Alle Entwürfe liegen nur noch in der Git-Geschichte, zuletzt in `deee0f2` unter `prototypes/ui-overview/`.

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
4. **Recherche:** Wo stolpern Nutzer in Orca und SnOrca oft, und was davon kann Orfix vereinfachen? Quellen: GitHub-Issues, Foren, Reddit. **Erledigt am 22.09.:** [RECHERCHE-STOLPERSTEINE](RECHERCHE-STOLPERSTEINE.md) enthält die Top 10 mit Belegen. Neu gegenüber dem Plan sind vier Ideen:
   - Profile aus anderen `user/`-Ordnern zurückholen (nach Update oder Anmeldung „alles weg“);
   - eine Import-Prüfung „warum nimmt der Slicer das nicht?“;
   - unsichtbare Profile reparieren;
   - einzelne Profile aus einer Sicherung zurückholen.

   Außerdem: Orca main hat ein „Troubleshoot Center“, SnOrca 2.4.0 hat nichts davon.
5. **Entwürfe** für die Seiten „Drucker“ und „Sicherungen“ im Stil von E. Danach den **Plan für Phase 1** auf Grundlage von E neu schreiben. Der Designplan im PLAN ist als überholt markiert.
6. **Technische Seite „Slicer“ (neu am 22.09.):** eine Übersicht je Installation (was liegt wo, Verzeichnisse, Größen, Erklärung je Ordner). Sie ist wie die jetzige Startseite, aber schön im Stil von E.

**Erledigt am 22.09. bis 09:20:** Entwurf E2 mit Menü und den Seiten Filamente, Drucker, Sicherungen und Slicer, im Browser geprüft (`754d706`).

**In Arbeit seit 09:25:** Workflow `orfix-e2-into-app` (Run `wf_1844b1d4-b0c`), vier Agenten nacheinander: Backend → Oberfläche → Review → Nachbessern. Nach einem Abbruch fortsetzen mit `Workflow({scriptPath: …/workflows/scripts/orfix-e2-into-app-wf_1844b1d4-b0c.js, resumeFromRunId: "wf_1844b1d4-b0c"})`. Ziel (Wunsch vom 22.09., 08:07): E2 wird die echte App.
- **Backend: fertig.** `GET /api/data` liefert die Struktur von E2 live aus beiden Installationen, Texte als Codes. Neu sind `orfix/opc.py`, `scanner.py`, `resolver.py` und `overview.py` samt Tests. Gegen `make_data.py` ohne Beispiele gibt es keine Abweichung.
- **Oberfläche: fertig, noch nicht im Browser geprüft.** Sie besteht aus:
  - `orfix/static/index.html` und `app.js`, dazu `common.js`, `pages/*.js` und `style.css`;
  - `texts.js`, darin alle Texte;
  - `api.js`.

  Das ersetzt die Startseite von Phase 0, sie geht in der Seite „Slicer“ auf. Die Daten kommen per `fetch('/api/data')`, „Neu einlesen“ holt sie neu. Beispiele und erfundene Sicherungen sind raus. „Datenordner hinzufügen“ und „Entfernen“ laufen über die echte API. Alles Ändernde sammelt sich in einer gemeinsamen Änderungsliste, „Übernehmen“ ist aus („Änderungen speichern kommt mit dem nächsten Schritt“). Nichts schreibt.
- **Aufgeräumt:** Die Mounts `/prototypes/ui-overview` und `/orfix/static` sind raus aus `orfix/app.py`, `prototypes/ui-overview/` ist gelöscht.
- 81 Tests sind grün.
- **Offen:** Review und Nachbessern, danach die Sichtprüfung im Browser durch den Hauptagenten.

**Danach (Wunsch vom 22.09.):** ein gemeinsamer Test „Was sehe ich in SnOrca, was in Orfix, und kommt eine Änderung richtig an?“, siehe [TEST-VERGLEICH](TEST-VERGLEICH.md).
- **Teil A** (nur lesen) geht jetzt mit der App.
- **Teil B** (Änderungen) braucht echte Schreibfunktionen. Sie kommen als erster Teil von Phase 2: Sicherung, `.conf` ändern, eigenes Profil anlegen.

## Offene Fehler und Punkte

- **`geckodriver`-Prozess:** Ein Agent hat einen `geckodriver` übrig gelassen (PID 98327, Snap-Firefox). Ihn darf nur der Nutzer beenden: `kill 98327`.
- **Enter-Taste:** Im Formular „Datenordner hinzufügen“ hat die Enter-Taste im Test-Browser der App nicht abgeschickt, nur der Knopf. In einem echten Browser prüfen.
- **Windows:** nur mit nachgebauter `.conf` getestet. Eine echte Windows-`.conf` fehlt, vorher `devices` bzw. `local_machines` leeren.
- **Praxistests offen:** „Bibliothek freischalten“ (Weg A und B, Teil B) und Flatpak.
- **Gemeldet am 22.09. zu Entwurf E, alle erledigt:** „Läuft“ bei geschlossenem SnOrca (die Daten kommen jetzt live), die verwirrenden Beispielprofile (entfernt), die Ansicht, die Klicks nicht folgte (in E2 behoben), und die toten `orca_presets`-Einträge („Default Printer“ wird erkannt).
- **Sicherungen:** Was eine Wiederherstellung zurückbringt und was wegfällt, zeigt die App noch nicht. Das braucht einen Vergleich im Backend, er kommt mit Phase 2.

## Wo was liegt

| Pfad | Inhalt |
|---|---|
| `ORFIX_SPEC.md` | Spezifikation mit eingearbeiteten Befunden |
| `docs/FINDINGS.md` | geprüfte Fakten. Gehen der Spezifikation vor |
| `docs/PLAN.md` | Plan Phase 0 und 1. Der Designplan ist überholt, die Oberfläche folgt E2 |
| `orfix/` | App: `app.py`, `overview.py`, `scanner.py`, `resolver.py`, `opc.py`, `instances.py`, `guard.py`, `conf.py`, dazu die Oberfläche in `static/` (Seiten in `static/pages/`, Texte in `static/texts.js`) |
| `prototypes/opc/` | `.opc`-Leser (Machbarkeit, jetzt in `orfix/opc.py`) |
| `prototypes/U1Cam/` | Kamera des U1, vom Nutzer |
| `slicer-src/` | Sparse-Clones von SnOrca v2.4.0 und OrcaSlicer main, nicht im Git |
| `tests/fixtures/snorca/`, `tests/fixtures/orca/` | anonymisierte Ausschnitte aus den echten Installationen, dazu synthetische eigene Profile |

## Teil B in Arbeit (22.09.2026, ab 11:50)

- **Teil A** des Tests ist mit SnOrca bestanden: alle Düsen stimmen.
- **Workflow `orfix-writes-part-b`** (Run `wf_9ea0a07b-6fd`). Backend und Oberfläche entstehen parallel gegen eine feste Schnittstelle:
  - `changes` mit ops wie `filament_visible`, `filament_bind`, `filament_create`, `filament_update`, `filament_rename`, `filament_delete`, `default_printer`, `printer_delete`, `printer_model_off`, `cleanup_presets`;
  - `/plan` → `/apply`, dazu die Sicherungs-API.

  Danach folgen Zusammenführen samt Ende-zu-Ende-Test, Review und Nachbessern.
- **Sicherheitsregel bis 23.09.:** Orfix schrieb nur in von Hand hinzugefügte Ordner. Aufgehoben, siehe unten.
- **Nach einem Abbruch** fortsetzen mit `resumeFromRunId: "wf_9ea0a07b-6fd"`, Skript unter `…/workflows/scripts/orfix-writes-part-b-wf_9ea0a07b-6fd.js`.

## Nächster Wunsch (22.09.2026): Seite „Prozesse“ – vom Nutzer bestätigt, nach Teil B bauen

Die Seite soll die Prozessprofile im Überblick zeigen, als neuer Menüpunkt zwischen Filamente und Drucker.
- **Aufbau:** Drucker und Düse, die Wahl teilt sich die Seite mit „Filamente“. Darunter die Prozesse als Kacheln: groß die Schichthöhe, darunter die Art. Markiert ist der zuletzt gewählte Prozess aus `orca_presets`.
- **Aufteilung:** Vom Hersteller und Eigene. Im Seitenpanel Kernwerte (Schichthöhe, Wände, Infill, Geschwindigkeit, Stützen) und „baut auf … auf“.
- **Umfang:** zuerst nur Übersicht, Anlegen, Umbenennen und Löschen danach.
- **Wann:** erst bauen, wenn der Workflow für Teil B fertig ist, weil er dieselben Dateien bearbeitet.
- **Zuordnung** zur Erklärung für den Nutzer: Drucker → Düse (Druckerprofil) → Prozesse und Filamente getrennt, beide über ihre Druckerliste. Prozess und Filament sind unabhängig, `compatible_prints` nutzt niemand.

## Teil B bereit zum Test (22.09.2026, 13:30)

- **Schreibfunktionen fertig** (`a2b06ad`, `e6b9938`), 175 Tests grün. Der Ende-zu-Ende-Test und ein Lauf auf einer Kopie des echten Ordners sind in Ordnung.
- **Offen:** die Spalte „SnOrca“ in [TEST-VERGLEICH](TEST-VERGLEICH.md) Teil B.
- **23.09.: Test direkt im echten Ordner** `~/.config/Snapmaker_Orca`, ohne Kopie und ohne `--datadir`. Auf diesem Rechner sind SnOrca und Orca nur Testinstallationen, zurück geht es über die Sicherungen. Die Sperre für Ordner, die nicht von Hand hinzugefügt wurden (`write_not_allowed`), ist entfernt, Regel 1 in CLAUDE.md angepasst.
- **Orca 2.5 geprüft (23.09.)** auf einer Kopie des echten Ordners `~/.config/OrcaSlicer` mit B1, B4, B5 und B7:
  - ein neues eigenes Profil baut auf einem Profil aus `Snapmaker.opc` auf, `version` 2.5.0, `.info` mit `base_id` aus der `.opc`;
  - die `.conf` bleibt mit Tab eingerückt, Wiederherstellen ergibt die Kopie Byte für Byte.
  - Das Format eigener Profile ist in Orca main unverändert: JSON plus `.info` (`Preset::save`, `load_presets` in `Preset.cpp`). `.opc` liegt nur in `system/`, dort schreibt Orfix nie.
- **Übernehmen in zwei Klicks (23.09.):** „Übernehmen …“ in der Leiste zeigt gleich „Das passiert“, dort schreibt „Übernehmen“ (vorher Liste → „Übernehmen“ → „Ausführen“). Die Liste kommt nur noch bei Änderungen an mehreren Installationen oder wenn Orfix nicht schreiben darf. Beim Wiederherstellen heißt der Knopf „Wiederherstellen“.
- **Profilpakete von Orca 2.5 (23.09.):** eigene Herkunft `bundle`, auf „Filamente“ unter „Aus Paketen“ nach Paketname, auf „Drucker“ mit dem Paketnamen als Etikett. Ändern, Löschen und „Neues Filament daraus“ sperrt Orfix (Code `bundle_profile`). Drucker aus Paketen lassen sich als Standard wählen und an eigene Filamente binden. Im Browser mit einem Beispielpaket geprüft.
- **Danach:** Seite „Prozesse“ **nur zum Anzeigen**, ohne Bearbeiten. Das hat der Nutzer am 22.09. entschieden: „klingt fast wie ein Slicer-Nachbau … Overkill“.
  - Gezeigt werden die eingestellten Werte in den Gruppen Qualität, Stabilität, Geschwindigkeit, Stützen und Haftung, dazu „Alle Werte“ aufklappbar.

## Nächste Schritte (23.09.2026)

1. **Teil B zu Ende testen** (Nutzer, im echten Ordner), Abweichungen beheben.
2. **Seite „Prozesse“**, nur zum Anzeigen.
3. **Übertragung OrcaSlicer → SnOrca** (Phase 3, vom Nutzer gewünscht):
   - Zuerst Filamente aus der Orca-Bibliothek, die SnOrca fehlen. Die Bibliothek in OrcaSlicer 2.5 (2.4.0.8) hat 286 Einträge, die in SnOrca 2.4.0 (02.03.01.10) 142. Neu sind elf Marken, vor allem FilAr, Elegoo, Eolas Prints, COEX 3D und FILL3D.
   - Vorher im Quellcode klären, wie ein übertragenes Profil in SnOrca aussehen muss: alle Werte ausgeschrieben oder auf einem SnOrca-Profil aufbauend, High-Flow-Werte, Schlüssel, die SnOrca nicht kennt, `compatible_printers`. Dann ein Praxistest mit einem einzelnen Profil.
   - Danach Druckerprofile (U1) in beide Richtungen.
4. **Kleinkram:** eine echte Windows-`.conf`, Flatpak, `version` neuer Profile am Slicer prüfen, PLAN.md und STAND aufräumen.
