# Arbeitsstand

Stand 23.09.2026. Übergabe zwischen Sessions. Das Wichtigste zuerst, Details in [FINDINGS](FINDINGS.md) und [PLAN](PLAN.md).

## Aktuell (23.09.2026)

- **Ordner umbenannt:** Der Nutzer hat `~/dev/orfix` am 23.09. in `~/dev/OrcaOne` umbenannt, mit großen Buchstaben. Das Gedächtnis liegt deshalb unter `-home-dominiks-dev-OrcaOne`, die Ordner `-orfix` und `-orcaone` sind alte Kopien. Vorher geprüft:
  - Es gibt keine weiteren Worktrees, und `.claude/launch.json` nutzt relative Pfade.
  - Den Starter `~/.local/share/applications/orcaone.desktop` hat der Nutzer auf `~/dev/OrcaOne` umgestellt.
  - `.lenv` ist schon einmal umgezogen (von `orcix`). `.lenv/bin/python -m …` läuft weiter, nur Skripte wie `.lenv/bin/pip` haben noch alte Pfade im Shebang.
- **App-Fenster: gebaut** (Wunsch vom 23.09.), ohne Tabs, Adressleiste und Lesezeichenleiste.
  - Eigenes Symbol: ein „O“ aus gedruckten Schichten um eine „1“, auf Teal. Der Nutzer will ausdrücklich nichts aus Orca oder SnOrca. `tools/make_icons.py` zeichnet es ohne Zusatzpakete als SVG, PNG 192/512 und ICO (16 bis 256 px). Das SVG besteht nur aus einfachen Formen: Qt SVG, mit dem KDE Starter und Menüs zeichnet, kennt kein `clipPath` ([Qt-Doku](https://doc.qt.io/qt-6/svgextensions.html)) und zeigte die Ringschichten der ersten Fassung als durchgehende Balken (Nutzer, 23.09.; nachgestellt mit `ksvgtopng`). Jetzt: ganzer Ring, darüber die Fugen im Farbverlauf der Kachel.
  - `manifest.json`, Favicon und `theme-color`. Chrome verlangt fürs Installieren Symbole in 192 und 512 px, einen Service Worker nicht mehr ([Kriterien](https://web.dev/articles/install-criteria)).
  - Fester Port 4711 statt eines freien, denn eine installierte Web-App merkt sich den Port. Läuft OrcaOne schon, öffnet ein zweiter Start nur ein Fenster. Ist der Port anderweitig belegt, nimmt OrcaOne einen freien (`__main__.choose_port`). Die Vorschau in `.claude/launch.json` bleibt auf 8765.
  - `browser.py`: Chrome, Chromium, Edge, Brave und Vivaldi bekommen `--app=<Adresse>`, Firefox und Opera `--new-window`.
  - Unterstützung, geprüft am 23.09.: Chrome, Edge, Brave und Chromium installieren Web-Apps unter Windows, Linux und macOS. Safari kann das ab macOS 14 („Zum Dock hinzufügen“). Firefox kann es ab 143 nur unter Windows, unter Linux ist es abgeschaltet und geht nur ohne Sandbox oder als Flatpak, unter macOS gar nicht ([Firefox-Doku](https://firefox-source-docs.mozilla.org/browser/components/taskbartabs/docs/index.html)).
  - Auf diesem Rechner ist Firefox als Snap der Standard, dort bleibt es beim neuen Fenster. Brave ist installiert. Brave ohne Fenster (`--headless --screenshot`) blieb als Snap hängen und ließ sich weder von Claude noch aus dem Terminal-Panel beenden, nur mit `snap run --shell brave -c "kill …"`.
- **Druckstatus zur Kamera: gebaut.** Unter dem Bild: Zustand (Text und Farbe), Datei, Fortschritt als Balken, Schicht x von y, Restzeit, Druckzeit, Temperaturen der vier Köpfe (heizende in Teal, der aktive fett), Bett und Bauraum. In den großen Ansichten eine Zeile unten links und ein dünner Balken am Rand, beide bleiben stehen. Die Seite liest `GET /api/cameras/{id}/status` alle 5 s; `camera.status` fragt dafür zusätzlich `print_stats` ganz, `heater_bed` und `temperature_sensor cavity` ab. Restzeit: `estimated_time` aus den Metadaten der Datei (einmal je Datei gemerkt) minus `print_duration`, sonst aus dem Fortschritt. Zustände und Kopfnamen stehen jetzt in `T.u1` (für „Kamera“ und „Kalibrieren“). Einen laufenden Druck gab es beim Bauen nicht: geprüft mit dem ruhenden U1 („Fertig“) und einem im Browser gestellten Druck.
- **Vergleichen: gebaut**, eingerückt unter „Filamente“ (`pages/vergleichen.js`). Zwei Filamente, jedes mit eigener Installation; wechselt eine Seite die Installation, nimmt sie das gleichnamige Filament, wenn es dort eines gibt. Die Werte kommen wie auf „Details“ aus `GET /api/instances/{id}/profile`, verglichen wird im Browser: Einzelwert und Liste mit einem Element gelten als gleich, Zahlen als Zahlen („1.0“ = „1“). Die Filamentwahl mit Suche ist jetzt die Komponente `pages/filament-picker.js` für „Details“ und „Vergleichen“. Geprüft: eigenes „SUNLU PLA+ (1DS)“ gegen „SUNLU PLA+ @System“ (4 Unterschiede: Flow, Temperatur, Druckerliste, Farbe) und „Generic PLA @System“ in SnOrca gegen OrcaSlicer (9 Einstellungen, die nur einer der beiden kennt).
- **„Änderungen“: gebaut** (unter „Drucker“, `orcaone/snapshot.py`, `pages/aenderungen.js`; zuerst „Was ist neu“ genannt, der Nutzer fand das zu sehr nach einer Liste neuer Funktionen). Schnappschuss je Installation in `data/snapshots/<id>.json` als flache Einträge: Slicer-Version (`header`), Benutzerordner (Anmeldung), Herstellerpakete mit Version, Drucker aus `models`, die Liste `filaments`, jedes wählbare Systemprofil mit Hash seiner aufgelösten Werte und jedes eigene Profil mit ganzem Inhalt (Zugangsdaten nur als Hash).
  - Vergleich je Profil statt je Datei (PLAN 1.4 geändert, siehe dort). Erklärungen als Codes: nur `version` geändert, `inherits` geändert, Druckerliste gefüllt, Datei unlesbar, Hersteller entfernt, weil kein Drucker mehr ausgewählt ist.
  - Den ersten Stand legt `GET /api/data` an (`first`, die Seite sagt dann „Ab jetzt merkt sich OrcaOne …“). „Als gesehen markieren“ (`POST …/news/seen`) schreibt nur nach `data/`, geht also auch bei laufendem Slicer.
  - Was OrcaOne schreibt, zählt als gesehen: `operations.apply` merkt sich den Stand vor dem Schreiben und übernimmt danach nur die Einträge, die sich dabei geändert haben (`snapshot.accept`). Offene Änderungen von außen bleiben sichtbar.
  - Ist die `.conf` gerade nicht lesbar (der Slicer löscht sie beim Speichern kurz), vergleicht OrcaOne nicht (`conf_unreadable`).
  - Geprüft: 7 Tests auf einer Kopie der Fixture und die Seite im Browser mit einem Beispiel aus 14 bzw. 16 Änderungen. Auf diesem Rechner stehen die ersten Schnappschüsse seit 23.09., 13:07.
- **Import/Export: erste Runde gebaut** (unter „Filamente“, `orcaone/importer.py`, `pages/import.js`). Auf Wunsch des Nutzers nach der Übersicht [IMPORT-QUELLEN](IMPORT-QUELLEN.md): Quellen 1 bis 4 und 7 (JSON, ZIP, `.orca_*`, Sicherungen und Datenordner-ZIPs, 3MF) und der Export.
  - Ablauf: `POST /import` mit der Datei als Body liest und wertet aus, ohne zu schreiben. Die Seite merkt Angehaktes vor (`profile_import` in `ops.js`), „Übernehmen“ schreibt mit Plan und Sicherung. `op_profile_import` wandelt erneut um, für den dann aktuellen Stand.
  - Umwandlung (`importer.convert`, nach `transfer.convert`): Kind des Elternprofils, wenn es das hier wählbar gibt. Sonst ein Wurzelprofil, dabei gehen die Werte einer Vorlage (`fdm_filament_pla`) ein. Elternprofile aus derselben Datei gehen ins Kind ein. Werte im Format des Ziels (`transfer.adapt`), Drucker ohne Adresse und Zugangsdaten.
  - Auswertung: neu, schon da (gleiche Werte, nur was ein Import schreiben würde), Name vergeben (als Kopie „(2)“ oder ersetzen), Name eines Systemprofils, Elternprofil fehlt, kein passender Drucker, Vorlage.
  - 3MF: eingebettete Profile vollständig; dazu die ungespeicherten Änderungen an Systemprofilen aus `project_settings.config` als eigenes Profil „<Name> (<Datei>)“.
  - Geprüft: 5 Tests und im Browser gegen die echte Snapmaker-Orca-Installation (nur ausgewertet und Plan angesehen, nichts übernommen); Export mit echten Profilen über die API.
  - Menü 212 statt 200 px breit, sonst schnitt es „Import/Export“ ab.
  - Test des Nutzers mit `prototypes/m3Sorter_04_mini.3mf` (Bambu Studio 1.8.4, A1 mini): „kein Profil“ war richtig, aber zu knapp. Jetzt zeigt die Seite bei einem 3MF Herkunft und genutzte Profile samt „gibt es hier“ bzw. „gibt es hier nicht“ (FINDINGS 4.8). Aus den 335 Werten solcher Projekte eigene Profile zu machen, wäre ein weiterer Schritt; für den U1 bräuchte es dafür „An Zielprofil hängen“.
  - Zweiter Test des Nutzers mit `prototypes/Happy_Shark_3MF.3mf` (Bambu Studio 1.9.3, A1): Die Herkunft fehlte, weil das Modell 11 MB groß ist und OrcaOne Einträge über 8 MB übersprang. Jetzt liest es vom Modell nur den Anfang.
  - Danach, auf Wunsch des Nutzers: Bei einem 3MF zeigt die Seite je genutztem Profil die Werte des Projekts, die Farben der Filamente als Spulen und „Hier passend“. Das sind die Drucker mit derselben Düse, deren Prozesse mit derselben Schichthöhe und die Filamente mit demselben Namen bis „@“, die diese Drucker zeigen; ausgeblendete sind markiert. Die Seite rechnet das aus den Daten von „Filamente“ (`pages/import.js`), das Backend liefert Werte, Farben und Düse (`importer._read_3mf`).
  - Dazu „Was ein Import braucht“ zum Aufklappen und bei einem fremden Drucker der Hinweis auf „Nur Geometrie importieren“ bzw. „Immer fragen“ (FINDINGS 4.8).
- **Als Nächstes, beim Import (Übersicht, Reihenfolge des Nutzers offen):** G-Code-Dateien und Drucke direkt vom U1, `user_backup-v*` und andere Benutzerordner, die Orca-Bibliothek auf GitHub, „An Zielprofil hängen“.
- **Als Nächstes, in dieser Reihenfolge:**
- **Beim Nutzer:** „Im LAN suchen“ zu Hause testen, die Prüfliste auf dem Windows-Rechner (unten, „Windows-Durchsicht“).

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
| Name | OrcaOne, der Ordner heißt `~/dev/OrcaOne` |
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
- **Projektordner:** seit 23.09. `~/dev/OrcaOne`, siehe „Aktuell“ oben. `.lenv` zieht mit um, `./orcaone.sh` läuft weiter (es ruft Python mit `-m` auf).
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

## Logs (23.09.2026)

- **Seite „Logs“** unter „Technik“, nur lesend: Start wählen (neuester zuerst, mit Uhrzeit und Größe), „Alles“, „Warnungen und Fehler“ oder „Nur Fehler“ mit Anzahl, Suche mit mehreren Wörtern in beliebiger Reihenfolge. Fehler rot hinterlegt, Warnungen mit orangem Wort, Stufe immer als Text.
- **Format** beider Slicer: `[warning]⇥2026-09-23 09:24:21.294249[Thread 0x…]:Text`, eine Datei je Start in `<Datenordner>/log/`. Zeilen ohne diesen Anfang gehören zum Eintrag davor (etwa OrcaSlicers Systeminfo). SnOrca schreibt fast alles als „warning“, OrcaSlicer als „info“.
- **Große Dateien:** OrcaSlicers Logs erreichen 10 MB mit rund 21.600 Einträgen; zwei davon sind je 2,7 MB groß (die ganze Profilliste als JSON, `SaveProfile` und `on_profile_loaded`). Deshalb filtert und sucht der Server über alles und schickt nur die letzten 2000 Einträge mit höchstens 2000 Zeichen je Eintrag (Antwort 380 KB, 190 ms). Dateien über 20 MB liest OrcaOne nur vom Ende.
- **Sicherheit:** Gelesen wird nur eine Datei, die in `log/` liegt und kein Symlink ist; der Name muss in der Liste stehen.
- **Aufgefallen beim Ansehen:** SnOrcas eingebauter Updater meldet „Update install failed“ für `printers/`, und zwar in allen 16 Logs dieses Rechners. Das ist ein Problem von Snapmaker, nicht von OrcaOne.

## Zwei Sprachen (23.09.2026)

- **Wunsch des Nutzers:** die Oberfläche auf Deutsch und Englisch. Umschalter unten im Menü, gespeichert als `language` in `data/settings.json`; ohne Wahl gilt die Sprache des Browsers. Beim Umschalten lädt die Seite neu, vorgemerkte Änderungen müssen vorher übernommen oder verworfen sein.
- **Aufbau:** `texts/de.js` (die bisherigen Texte) und `texts/en.js` mit denselben 1051 Schlüsseln, im Browser verglichen. `texts.js` wählt die Sprache per `GET /api/settings`; fehlt ein englischer Text, zeigt es den deutschen. Zahlen, Daten und Dezimalzeichen folgen der Sprache (`LOCALE`, `DECIMAL` in `common.js`, bisher fest „de-DE“ und Komma an fünf Stellen).
- **Tests:** `tests/test_texts.py` prüft die Codes des Backends in beiden Dateien, `tests/test_app.py` die Einstellung.
- **Offen:** Die Meldungen im Terminal (`__main__.py`, `orcaone.sh`) bleiben deutsch.

## Kalibrieren (23.09.2026)

- **Wunsch des Nutzers:** seine Anleitung `prototypes/U1 Filament Kalibrierung.md` gegenprüfen und als Wizard zum Abhaken einbauen, am besten mit Verbindung zum Drucker. Die Prüfung steht in FINDINGS unter „Kalibrierung am U1“; die Seite folgt der korrigierten Fassung (Retraction-Formel, Pressure Advance ab Werk aus, Testdrucke ändern Einstellungen vorübergehend, Flow nicht auf 1,0 zurücksetzen).
- **Seite „Kalibrieren“** nach „Prozesse“: eigenes Filament wählen, sieben Schritte (Pflicht: Flow und Pressure Advance) mit Rechenhilfen, dazu drei Schritte einmal pro Drucker. „Eintragen“ merkt Werte vor (`pending` in `pages/kalibrieren.js`), `ops.js` legt sie in dasselbe `filament_update` wie „Bearbeiten“. Häkchen in `data/settings.json` (`calibration.py`), mit der Düsentemperatur beim Abhaken.
- **U1 live:** `GET /api/cameras/{id}/status` liest in einer Anfrage Spulen (RFID und von Hand), Pressure Advance je Kopf und den Druckstatus, alle 5 s solange die Seite sichtbar ist. OrcaOne sendet dem Drucker dabei nichts.
- **Im Browser geprüft:** Rechenwege (0,926 − 0,02 = 0,906; 5 + 20 × 0,5 = 15, minus 15 % = 12,7; ⌊7,8 − 0,4⌋ × 0,1 = 0,7; 99,5 %), Übernahme des gemessenen PA von Kopf 4, der Plan „COEX ABS (Orca).json ändern · Flussrate“ (nicht ausgeführt, danach verworfen), Deutsch und Englisch.
- **Offen:** Einen Druck mit Flow Calibration von Anfang bis Ende im Wizard begleiten. Umbenannte Filamente verlieren ihre Häkchen.

## IP-Adresse beim Drucker, Kamera im Vollbild (23.09.2026)

- **Wunsch des Nutzers:** Die IP gehört zum Drucker, nicht zur Kamera. Jede Karte auf „Drucker“ zeigt sie oder „Keine IP-Adresse“ in Warnfarbe, „Eintragen“ und „Ändern“ speichern sofort (OrcaOnes eigene Einstellung, `printers` in `data/settings.json`, je Modell, also für denselben U1 in beiden Slicern). Ohne eigene Adresse gilt `print_host` aus einem eigenen Druckerprofil des Slicers („Hostname, IP or URL“ im Dialog „Physischer Drucker“), mit dem Hinweis „aus dem Druckerprofil in …“. Die Übersicht merkt sich diese Adressen bei jedem Einlesen (`camera.remember_slicer_hosts`).
- **Kamera und Kalibrieren** nehmen die Adresse von dort: Jeder U1 mit Adresse hat eine Kamera, die eigene Liste der Kamera-Seite ist weg. Der alte Eintrag zog beim Start um (`settings._cameras_to_printers`).
- **Kamera-Ansichten:** in der Seite, fensterfüllend, Vollbild. In den großen Ansichten blendet sich die Leiste nach 3 Sekunden ohne Maus aus, Esc führt zurück; aus dem Vollbild zurück in die Ansicht davor. Fensterfüllend im Browser geprüft; echtes Vollbild erlaubt das eingebaute Testfenster nicht („Permissions check failed“), dort fällt die Seite auf fensterfüllend zurück. In Chrome oder Firefox noch zu prüfen.
- **Im LAN suchen** (Karte eines U1): `camera.search` fragt wie SnOrca per mDNS (Ablauf in FINDINGS), etwa 6 s, und listet die Snapmaker-Drucker mit „Übernehmen“. Geprüft: Die Anfrage gleicht Byte für Byte SnOrcas `make_PTR`, die Auswertung mit nachgebauten Antworten (PTR, SRV mit Kompression, TXT, A). Von diesem Rechner findet sie wegen WireGuard nichts und sagt das; **der Nutzer testet sie zu Hause im selben LAN.**
- **Kalibrieren nur für den U1** (Wunsch des Nutzers: „bei einem normalen Klipper-Drucker wäre der Vorgang anders“): Oben U1 und Düse wählen, angeboten werden nur U1-Modelle; die Filamentliste zeigt eigene Filamente, die zu diesem Drucker passen. Hat die Installation keinen U1, sagt die Seite das. Bei der 0,2-mm-Düse warnt der PA-Schritt. Im Browser geprüft: SnOrca (0,4: zwei SUNLU, 0,2: COEX ABS samt Warnung) und OrcaSlicer (nur der U1, nicht der Klipper-Drucker).
- **Menü (Wunsch des Nutzers):** „Kalibrieren“ und „Übertragen“ stehen leicht eingerückt unter „Filamente“, „Kamera“ unter „Drucker“ (`sub` in `app.js`). „Filamente“ bleibt oben, weil dort die Hauptarbeit liegt und die Druckerwahl ihr erster Schritt ist.

## Windows-Durchsicht (23.09.2026)

Auf Wunsch des Nutzers geprüft, ob alles unter Windows läuft; ohne Windows-Rechner, per Quellcode.

- **Behoben:**
  - `data/settings.json`: Python öffnet Dateien unter Windows ohne `FILE_SHARE_DELETE`, ein offener Leser verhindert also das atomare Ersetzen. Lesen läuft jetzt unter derselben Sperre wie Schreiben. `change()` liest streng: Kann es die Datei nicht lesen, bricht es ab, statt `{}` darüberzuschreiben. `os.replace` versucht es bei `PermissionError` dreimal (Virenscanner). Tests dazu in `tests/test_settings.py`.
  - LAN-Suche: `recvfrom` meldet unter Windows bei UDP ein früheres ICMP „unreachable“ als `ConnectionResetError`, die Suche läuft jetzt weiter.
  - Anfragen an den U1 gehen ohne Proxy: `urllib` nähme unter Windows den System-Proxy aus der Registry.
- **Geprüft, passt:** Programmnamen `snapmaker-orca.exe` und `orca-slicer.exe` (GUI-Hülle mit `OUTPUT_NAME`, `src/CMakeLists.txt`); `fcntl` nur unter POSIX; Pfade über `pathlib`; Rechte (`chmod`) nur unter POSIX; Logs lesen, während der Slicer schreibt (MSVC öffnet sie ohne Schreibsperre für andere); alter Datenordner `%LOCALAPPDATA%\orcaone`; `SO_REUSEPORT` gibt es unter Windows nicht und wird dort übersprungen.
- **Hinweise im README:** OrcaOne ins eigene Benutzerprofil, nicht unter `C:\Programme` und nicht in OneDrive (Sicherungen mit Zugangsdaten in `data/`; unter Windows setzt OrcaOne keine Rechte); die Firewall-Frage bei „Im LAN suchen“ zulassen.
- **Prüfliste für den Windows-Rechner:** `orcaone.cmd` starten; alte Daten aus `%LOCALAPPDATA%\orcaone` ziehen nach `data/` um; Sprache umschalten; eine Änderung mit Sicherung und Wiederherstellen; „Logs“ bei laufendem Slicer; IP beim U1 eintragen, dann Kamera (Vollbild) und „Kalibrieren“; „Im LAN suchen“ im selben LAN.

## Starten per Symbol, selbst bauen (23.09.2026)

- **Dokument** `docs/STARTEN-UND-BAUEN.md` für Windows, Linux und macOS: per Symbol mit `.lenv` starten (Verknüpfung, `.desktop`, `.command`/Automator) und mit `tools/build.py` selbst bauen.
- **Neues Browserfenster:** `browser.py` fragt beim Start den Standardbrowser beim System ab und gibt Firefox und der Chromium-Familie `--new-window` mit; sonst wie bisher. Unter Linux geprüft (hier Firefox als Snap), Windows und macOS nur nach Registry und LaunchServices.
- **Bauen:** `tools/build.py` (PyInstaller, Ordner statt Einzeldatei); im gebauten Programm liegt `data/` neben der Programmdatei (`settings.DATA_DIR`). Probe-Bau unter Linux: PyInstaller 6.22.3, 18 s, 34 MB; das Programm startet ohne venv, liest beide Installationen und legt `data/settings.json` neben sich an. Windows und macOS nicht gebaut.
