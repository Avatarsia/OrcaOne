# Arbeitsstand

Stand 23.09.2026. Übergabe zwischen Sessions. Das Wichtigste zuerst, Details in [FINDINGS](FINDINGS.md) und [PLAN](PLAN.md).

## Erledigt

- **Phase 0 (Grundgerüst):** fertig und committet.
  - OrcaOne startet mit `./orcaone.sh` und erkennt SnOrca 2.4.0 und OrcaSlicer 2.5.0-dev.
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
| Name | OrcaOne, der Ordner heißt `~/dev/orcaone` |
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
4. **Recherche:** Wo stolpern Nutzer in Orca und SnOrca oft, und was davon kann OrcaOne vereinfachen? Quellen: GitHub-Issues, Foren, Reddit. **Erledigt am 22.09.:** [RECHERCHE-STOLPERSTEINE](RECHERCHE-STOLPERSTEINE.md) enthält die Top 10 mit Belegen. Neu gegenüber dem Plan sind vier Ideen:
   - Profile aus anderen `user/`-Ordnern zurückholen (nach Update oder Anmeldung „alles weg“);
   - eine Import-Prüfung „warum nimmt der Slicer das nicht?“;
   - unsichtbare Profile reparieren;
   - einzelne Profile aus einer Sicherung zurückholen.

   Außerdem: Orca main hat ein „Troubleshoot Center“, SnOrca 2.4.0 hat nichts davon.
5. **Entwürfe** für die Seiten „Drucker“ und „Sicherungen“ im Stil von E. Danach den **Plan für Phase 1** auf Grundlage von E neu schreiben. Der Designplan im PLAN ist als überholt markiert.
6. **Technische Seite „Slicer“ (neu am 22.09.):** eine Übersicht je Installation (was liegt wo, Verzeichnisse, Größen, Erklärung je Ordner). Sie ist wie die jetzige Startseite, aber schön im Stil von E.

**Erledigt am 22.09. bis 09:20:** Entwurf E2 mit Menü und den Seiten Filamente, Drucker, Sicherungen und Slicer, im Browser geprüft (`754d706`).

**In Arbeit seit 09:25:** Workflow `orcaone-e2-into-app` (Run `wf_1844b1d4-b0c`), vier Agenten nacheinander: Backend → Oberfläche → Review → Nachbessern. Nach einem Abbruch fortsetzen mit `Workflow({scriptPath: …/workflows/scripts/orcaone-e2-into-app-wf_1844b1d4-b0c.js, resumeFromRunId: "wf_1844b1d4-b0c"})`. Ziel (Wunsch vom 22.09., 08:07): E2 wird die echte App.
- **Backend: fertig.** `GET /api/data` liefert die Struktur von E2 live aus beiden Installationen, Texte als Codes. Neu sind `orcaone/opc.py`, `scanner.py`, `resolver.py` und `overview.py` samt Tests. Gegen `make_data.py` ohne Beispiele gibt es keine Abweichung.
- **Oberfläche: fertig, noch nicht im Browser geprüft.** Sie besteht aus:
  - `orcaone/static/index.html` und `app.js`, dazu `common.js`, `pages/*.js` und `style.css`;
  - `texts.js`, darin alle Texte;
  - `api.js`.

  Das ersetzt die Startseite von Phase 0, sie geht in der Seite „Slicer“ auf. Die Daten kommen per `fetch('/api/data')`, „Neu einlesen“ holt sie neu. Beispiele und erfundene Sicherungen sind raus. „Datenordner hinzufügen“ und „Entfernen“ laufen über die echte API. Alles Ändernde sammelt sich in einer gemeinsamen Änderungsliste, „Übernehmen“ ist aus („Änderungen speichern kommt mit dem nächsten Schritt“). Nichts schreibt.
- **Aufgeräumt:** Die Mounts `/prototypes/ui-overview` und `/orcaone/static` sind raus aus `orcaone/app.py`, `prototypes/ui-overview/` ist gelöscht.
- 81 Tests sind grün.
- **Offen:** Review und Nachbessern, danach die Sichtprüfung im Browser durch den Hauptagenten.

**Danach (Wunsch vom 22.09.):** ein gemeinsamer Test „Was sehe ich in SnOrca, was in OrcaOne, und kommt eine Änderung richtig an?“, siehe [TEST-VERGLEICH](TEST-VERGLEICH.md).
- **Teil A** (nur lesen) geht jetzt mit der App.
- **Teil B** (Änderungen) braucht echte Schreibfunktionen. Sie kommen als erster Teil von Phase 2: Sicherung, `.conf` ändern, eigenes Profil anlegen.

## Offene Fehler und Punkte

- **`geckodriver`-Prozess:** Ein Agent hat einen `geckodriver` übrig gelassen (PID 98327, Snap-Firefox). Ihn darf nur der Nutzer beenden: `kill 98327`.
- **Enter-Taste:** Im Formular „Datenordner hinzufügen“ schickt Enter im Test-Browser der App nicht ab. Grund (23.09.): Das Werkzeug sendet Enter nur als `keydown` ohne Zeichen, das reicht Browsern nicht zum Abschicken eines Formulars. Tasten, die OrcaOne selbst auswertet, etwa in der Klappliste auf „Details“, gehen. In einem normalen Browser kurz prüfen.
- **Windows:** nur mit nachgebauter `.conf` getestet. Eine echte Windows-`.conf` fehlt, vorher `devices` bzw. `local_machines` leeren.
- **Praxistests offen:** „Bibliothek freischalten“ (Weg A und B, Teil B) und Flatpak.
- **Gemeldet am 22.09. zu Entwurf E, alle erledigt:** „Läuft“ bei geschlossenem SnOrca (die Daten kommen jetzt live), die verwirrenden Beispielprofile (entfernt), die Ansicht, die Klicks nicht folgte (in E2 behoben), und die toten `orca_presets`-Einträge („Default Printer“ wird erkannt).
- **Sicherungen:** Was eine Wiederherstellung zurückbringt und was wegfällt, zeigt die App noch nicht. Das braucht einen Vergleich im Backend, er kommt mit Phase 2.

## Wo was liegt

| Pfad | Inhalt |
|---|---|
| `ORCAONE_SPEC.md` | Spezifikation mit eingearbeiteten Befunden |
| `docs/FINDINGS.md` | geprüfte Fakten. Gehen der Spezifikation vor |
| `docs/PLAN.md` | Plan Phase 0 und 1. Der Designplan ist überholt, die Oberfläche folgt E2 |
| `orcaone/` | App: `app.py`, `overview.py`, `scanner.py`, `resolver.py`, `opc.py`, `instances.py`, `guard.py`, `conf.py`, dazu die Oberfläche in `static/` (Seiten in `static/pages/`, Texte in `static/texts.js`) |
| `prototypes/opc/` | `.opc`-Leser (Machbarkeit, jetzt in `orcaone/opc.py`) |
| `prototypes/U1Cam/` | Kamera des U1, vom Nutzer |
| `slicer-src/` | Sparse-Clones von SnOrca v2.4.0 und OrcaSlicer main, nicht im Git |
| `tests/fixtures/snorca/`, `tests/fixtures/orca/` | anonymisierte Ausschnitte aus den echten Installationen, dazu synthetische eigene Profile |

## Teil B in Arbeit (22.09.2026, ab 11:50)

- **Teil A** des Tests ist mit SnOrca bestanden: alle Düsen stimmen.
- **Workflow `orcaone-writes-part-b`** (Run `wf_9ea0a07b-6fd`). Backend und Oberfläche entstehen parallel gegen eine feste Schnittstelle:
  - `changes` mit ops wie `filament_visible`, `filament_bind`, `filament_create`, `filament_update`, `filament_rename`, `filament_delete`, `default_printer`, `printer_delete`, `printer_model_off`, `cleanup_presets`;
  - `/plan` → `/apply`, dazu die Sicherungs-API.

  Danach folgen Zusammenführen samt Ende-zu-Ende-Test, Review und Nachbessern.
- **Sicherheitsregel bis 23.09.:** OrcaOne schrieb nur in von Hand hinzugefügte Ordner. Aufgehoben, siehe unten.
- **Nach einem Abbruch** fortsetzen mit `resumeFromRunId: "wf_9ea0a07b-6fd"`, Skript unter `…/workflows/scripts/orcaone-writes-part-b-wf_9ea0a07b-6fd.js`.

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
  - Das Format eigener Profile ist in Orca main unverändert: JSON plus `.info` (`Preset::save`, `load_presets` in `Preset.cpp`). `.opc` liegt nur in `system/`, dort schreibt OrcaOne nie.
- **Übernehmen in zwei Klicks (23.09.):** „Übernehmen …“ in der Leiste zeigt gleich „Das passiert“, dort schreibt „Übernehmen“ (vorher Liste → „Übernehmen“ → „Ausführen“). Die Liste kommt nur noch bei Änderungen an mehreren Installationen oder wenn OrcaOne nicht schreiben darf. Beim Wiederherstellen heißt der Knopf „Wiederherstellen“.
- **Profilpakete von Orca 2.5 (23.09.):** eigene Herkunft `bundle`, auf „Filamente“ unter „Aus Paketen“ nach Paketname, auf „Drucker“ mit dem Paketnamen als Etikett. Ändern, Löschen und „Neues Filament daraus“ sperrt OrcaOne (Code `bundle_profile`). Drucker aus Paketen lassen sich als Standard wählen und an eigene Filamente binden. Im Browser mit einem Beispielpaket geprüft.
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

## Prozesse und Details (23.09.2026)

- **Seite „Prozesse“** (nur ansehen): Druckerwahl wie auf „Filamente“, die Düse gilt für beide Seiten (`chosenNozzle` in `common.js`). Kacheln mit Schichthöhe und Art, markiert ist die letzte Wahl aus `presets.process` bzw. `orca_presets`. Das Seitenpanel zeigt Qualität, Stabilität, Geschwindigkeit, Stützen und Haftung, dazu „Alle Werte“. Fehlt ein Wert in der ganzen Kette, zeigt OrcaOne den Standardwert des Slicers (`PROCESS_DEFAULTS` in `overview.py`, geprüft in `PrintConfig.cpp` beider Slicer).
- **Seite „Details“** (unter „Technik“, Wunsch vom 23.09.): ein Filament aus einer Liste mit Suche, dazu Drucker und Düsen mit Status, die Vererbungskette mit Originalprofil, die Dateien, die `.info` und alle Werte. Aus dem Seitenpanel von „Filamente“ führt „Alle Details“ hierher.
- **Backend:** `GET /api/instances/{id}/profile?kind=…&name=…` liefert ein Profil mit Kette, Dateien und Werten. Herstellerprofile tragen jetzt ihren Dateipfad, bei `.opc` die Cache-Datei.
- **Auswahl auf „Details“ (Rückmeldung 23.09.):** eine eigene Klappliste statt `datalist`: Suche mit Wörtern in beliebiger Reihenfolge, kleine Überschriften nach Herkunft und Marke, eigene Filamente mit „abgeleitet von …“. Beim Klick ins Feld ist der Text markiert, man muss nichts löschen. Pfeiltasten, Enter und Escape gehen. „Abgeleitet von“ steht von oben nach unten: Grundprofil oben, das gewählte Profil unten.
- **Offen:** Die Seite „Details“ kann bisher nur Filamente. Prozesse und Drucker gingen mit derselben Abfrage.

## Übertragung Orca → SnOrca: Prüfung fertig (23.09.2026)

- Ergebnis in [FINDINGS](FINDINGS.md) unter „Übertragung OrcaSlicer → SnOrca“. Empfehlung: Wurzelprofil mit allen Werten der Orca-Kette in `filament/base/`, Name `<Alias> @U1`, eigene `filament_id`, gebunden an die vier U1-Düsen.
- Beispiel `Elegoo PLA @U1.json` und die Skripte der Prüfung liegen im Scratchpad der Sitzung vom 23.09., nicht im Repo.
- **Nächster Schritt, wenn der Nutzer zustimmt:** Übertragung als Schreibfunktion mit Plan und Sicherung bauen. Oberfläche: In SnOrca stehen unter „Orca-Bibliothek“ die fehlenden Filamente ausgegraut mit „nur in OrcaSlicer“; Einschalten legt das eigene Profil an. Danach Praxistest im Slicer (offene Punkte in FINDINGS).

## Seite „Übertragen“ (23.09.2026)

- **Wunsch des Nutzers:** Übertragen in beide Richtungen, zwei Installationen nebeneinander, beliebige Profile und mehrere auf einmal, etwa Profile aus Orca nach SnOrca und fertige eigene Profile von SnOrca nach Orca.
- **Gebaut:** Filamente und Prozesse. Drucker kommen später, dort ist mehr zu prüfen (FINDINGS, Übertragung, Stichpunkte).
  - Backend: Änderung `profile_copy` in `operations.py`, Umwandlung in `orcaone/transfer.py`, Einstellungen je Slicer in `orcaone/options.json`, erzeugt aus dem Quellcode mit `tools/make_options.py`.
  - Zwischen verschiedenen Slicern ein Wurzelprofil mit allen Werten der Kette, innerhalb desselben Slicers bleibt ein eigenes Profil Kind seiner Vorlage. Name mit Herkunft in Klammern, etwa „Elegoo PLA (Orca)“, bei Doppelten „(2)“.
  - Werte: Was das Ziel kennt, im Format des Ziels. Alte Namen, die das Ziel beim Laden übersetzt (`handle_legacy`), unverändert. Was es nicht kennt oder als veraltet ignoriert, bleibt weg, der Plan nennt es. Zwei Werte in einem Feld (High Flow, Extruder-Varianten): nur der erste.
  - Probelauf ohne Schreiben mit allen echten Profilen: Orca-Bibliothek → SnOrca 145 von 166 ohne Verlust, 21 abgelehnt (Drucker fehlen in SnOrca). SnOrca → Orca: alle 222 Filamente und 85 Prozesse, weg fallen nur SnOrca- oder Bambu-eigene Einstellungen.
- **Praxistest 23.09.:** „COEX ABS (Orca)“ Orca → SnOrca geht, SnOrca lädt und speichert es (FINDINGS, Offen-Liste). Danach dazugekommen: freundlichere Liste (Spulen, Haken „drüben schon da“, HF-Abzeichen, runde Pfeile), Kopien erscheinen sofort drüben unter „Eigene“, Gruppen zuklappbar (anfangs nur „Eigene“ offen).
- **Gegenrichtung 23.09.:** „Snapmaker Support For PLA @U1 0.4 nozzle (SnOrca)“ SnOrca → Orca geht, Orcas Log meldet das Laden ohne Fehler.
- **Offen:** Drucker übertragen. Neuer Name für die App (Vorschläge Spulo, Layro), weil die U1-Kamera dazukommen soll.

## Umbenennung: Orfix → OrcaOne (23.09.2026)

- **Name:** OrcaOne = Orca + U1 („One“), vom Nutzer gewählt; Kunstwörter ohne Bezug hat er verworfen. Auf PyPI und GitHub frei (geprüft 23.09.).
- **Umbenannt:** Paket `orcaone/`, `orcaone.sh`/`orcaone.cmd`, `ORCAONE_SPEC.md`, alle Texte und die Doku, `.claude/launch.json` (Konfiguration „orcaone“). Nur die historische Zeile in PLAN.md zur ersten Umbenennung bleibt.
- **Bestehende Daten:** Beim Start zieht OrcaOne `~/.local/share/orfix` einmal nach `~/.local/share/orcaone` um (`instances.move_old_data_dir`); am 23.09. auf diesem Rechner geschehen, alle 6 Sicherungen sind da. Seit dem Datenordner (unten) übernimmt `settings.migrate` diesen Umzug. Sicherungen mit `orfix-backup.json` bleiben lesbar und wiederherstellbar.
- **Für den Nutzer offen:** den Projektordner `~/dev/orfix` in `~/dev/orcaone` umbenennen. Das Gedächtnis liegt schon unter `-home-dominiks-dev-orcaone`. `.lenv` zieht mit um, `./orcaone.sh` läuft weiter (es ruft Python mit `-m` auf).
- **Nächste Schritte:** U1-Kamera (`prototypes/U1Cam/u1cam.py`), eine Seite „Logs“ unter „Technik“ (die Slicer schreiben nach `<Datenordner>/log/`), Drucker übertragen zurückgestellt.

## Filamente ohne Schalter (23.09.2026)

- **Wunsch des Nutzers:** Der Schalter war verwirrend, bei eigenen Filamenten mit Schloss. Jetzt zeigt jede Zeile ihren Zustand (ausgegraut, halber Kreis für „teilweise“, Haken für „an“), die Düsen im Seitenpanel sind die Bedienung, dazu Ziehen nach „Aktiv“ und das ✕ an den Kacheln.
- **Eigene Filamente bei keiner Düse an:** ausgeblendet mit `instantiation: "false"` (`filament_update` mit `hidden`), die Druckerliste bleibt. Eine Düse anwählen blendet es wieder ein, dann gilt nur diese Düse. Ein eigenes Filament ohne Vorlage (etwa eine Kopie aus dem anderen Slicer) lässt sich bei jeder Düse anwählen.
- **Praxistest 23.09.:** SnOrca blendet das Profil aus, die Datei bleibt. OrcaSlicer noch offen.

## U1-Kamera (23.09.2026)

- **Seite „Kamera“** im Hauptmenü, unabhängig von den Installationen. Drucker einmal über die Adresse hinzufügen, danach je Drucker eine Karte mit Bild, Zustand in Text und Farbe („Bild ist aktuell“, „Kein neues Bild seit 40 s“) und Bildtakt 1 bis 10 s, der gemerkt wird.
- **Ablauf wie `prototypes/U1Cam/u1cam.py`:** Solange die Seite sichtbar ist, schickt OrcaOne alle 10 s `camera.start_monitor` über Moonrakers WebSocket und reicht `monitor.jpg` durch. Der Browser spricht nie selbst mit dem Drucker. Das Alter des Bilds rechnet OrcaOne mit der Uhr des Druckers (Date minus Last-Modified). Ist die Seite verdeckt, pausiert sie.
- **Sicherheit:** Die Seite nennt Kameras nur über ihre ID, nie über eine Adresse; OrcaOne fragt also nur Drucker, die der Nutzer eingetragen hat.
- **Am echten U1 geprüft (10.30.40.174):** Moonraker 1.6.0, Wecken antwortet in 185 ms mit „success“, Bild 117 KB. Tests mit einem nachgebauten Moonraker in `tests/test_camera.py`.

## Ein Datenordner (23.09.2026)

- **Wunsch des Nutzers:** keine über die Platte verteilten Daten. Alles, was OrcaOne ablegt, liegt jetzt in `data/` im OrcaOne-Ordner: `settings.json` für alle Einstellungen (von Hand hinzugefügte Datenordner, Kameras, freigeschaltete Bibliotheksfilamente) und `backups/`. Künftige Einstellungen kommen als weiterer Abschnitt in dieselbe Datei.
- **Umzug:** Beim Start holt `settings.migrate` Sicherungen und Einstellungsdateien aus `~/.local/share/orcaone` und `~/.local/share/orfix` (Windows `%LOCALAPPDATA%`) und löscht die leeren alten Ordner. Was schon da ist, gewinnt; was nicht umziehen konnte, bleibt am alten Ort.
- **Git:** `data/` steht in `.gitignore`, weil die Sicherungen Zugangsdaten enthalten.
- **Tests:** Eine automatische Fixture in `tests/conftest.py` legt `data/` in den temporären Ordner des Tests.
