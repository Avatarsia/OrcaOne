# Import: woher, was steckt drin, geht das mit Python?

Stand 23.09.2026. Übersicht vor dem Bau der Seite „Import/Export“ unter „Filamente“. Ziel des Nutzers: Der Import soll alles lesen können, egal wo man etwas exportiert hat. Er wertet vorher aus, dann wählt der Nutzer, was er übernimmt. Den Export mit einer eigenen ZIP hält der Nutzer für trivial, deshalb geht es hier nur um den Import.

## Kurz

- **Alles aus der Orca-Familie** lässt sich mit Pythons Standardbibliothek lesen: `zipfile`, `json` und Textzeilen. Es braucht keine neue Abhängigkeit.
- **Hochladen** geht ohne `python-multipart`: Die Seite schickt die Datei als rohen Body (`fetch(url, {method: "POST", body: file})`), FastAPI liest ihn mit `await request.body()`.
- **Schwierig** sind nur fremde Slicer-Familien, weil ihre Schlüssel anders heißen: PrusaSlicer teilweise machbar, Cura nicht sinnvoll.
- **Kein Slicer der Orca-Familie wertet vorher aus.** OrcaSlicer und Snapmaker Orca importieren mit „Import Configs“ (`MainFrame::load_config_file`) alle gewählten Dateien auf einmal:
  - ohne Vorschau und ohne Auswahl;
  - bei gleichem Namen nur „Ja / Nein / für alle“, ohne Umbenennen;
  - Profile ohne gültige `version` oder mit fehlendem Elternprofil überspringt der Slicer ohne Meldung (FINDINGS 4.8).
  - 3MF-Projekte kann dieser Import gar nicht.

## Die Quellen

| # | Quelle | Woher | Was drinsteckt | Mit Python | Aufwand | Geprüft |
|---|---|---|---|---|---|---|
| 1 | Profil-JSON (`.json`) | eigener `user/`-Ordner, Downloads, Forum | eigenes Profil: `inherits` und nur die Abweichungen; Wurzelprofil: alle Werte | `json` | klein | FINDINGS 4.4 |
| 2 | ZIP mit Profilen (`.zip`) | Export-Dialog des Slicers (`Filament presets.zip` usw.), der Export von OrcaOne, Herstellerpakete | mehrere JSON-Dateien, Eltern vor ihren Kindern | `zipfile`, `json` | klein | FINDINGS 4.8 |
| 3 | Profilpakete (`.orca_filament`, `.orca_printer`, `.orca_bundle`) | Export-Dialog von OrcaSlicer und Snapmaker Orca | ZIP mit `bundle_structure.json` und den Profilen; Drucker ohne `print_host` | `zipfile`, `json` | klein | FINDINGS 4.8, `PresetBundle::import_presets` |
| 4 | 3MF-Projekt (`.3mf`) | eigene Projekte, MakerWorld und Printables (Bambu-Format), andere Nutzer | eingebettete eigene Profile `Metadata/{machine,filament,process}_settings_N.config`: vollständige JSON mit `inherits`, `"from": "project"`. Dazu `Metadata/project_settings.config`: die ganze Konfiguration mit `inherits_group` und `different_settings_to_system`, daraus lassen sich auch nie gespeicherte Änderungen an Systemprofilen zurückholen | `zipfile`, `json` | mittel | `bbs_3mf.cpp` |
| 5 | G-Code (`.gcode`, Bambus `.gcode.3mf`) | jeder Druck | Block `; CONFIG_BLOCK_START` … `; CONFIG_BLOCK_END` am Ende (Bambu-Drucker: am Anfang) mit allen Werten, `*_settings_id`, `inherits_group` und `different_settings_to_system` | Textzeilen | mittel | `GCode.cpp`; am U1: 564 Werte, Filament „M4P Orange“ (Material4Print) auf „Snapmaker PLA Basic @U1“ |
| 6 | Drucke auf dem U1 | die G-Code-Dateien auf dem Drucker (Moonraker, nur lesen) | wie 5; das Ende der Datei reicht (HTTP-Range) | `urllib` | mittel | am U1 am 23.09. |
| 7 | Sicherungen von OrcaOne | `data/backups/` | der Datenordner als ZIP, darin `user/<ordner>/<typ>/*.json` | `zipfile` | klein | `backup.py` |
| 8 | Andere Ordner im Datenordner | `user_backup-v<Version>/` (Kopie vor jedem Update), andere `user/<id>/` (vor oder nach einer Anmeldung) | eigene Profile wie in 1 | Dateien | klein | FINDINGS 4.2; Stolperstein „nach Update oder Anmeldung alles weg“ |
| 9 | Andere Installation auf diesem Rechner | Orca ↔ Snapmaker Orca | – | – | – | gibt es schon: „Übertragen“ |
| 10 | Anderer Rechner, anderer Nutzer | Datenordner als ZIP, Export | wie 2 und 7 | `zipfile` | klein | – |
| 11 | Orca-Filamentbibliothek auf GitHub | neueste Profile, auch Hersteller, die Snapmaker Orca nicht mitbringt | Manifest `OrcaFilamentLibrary.json` plus `filament/*.json` | `urllib` (HTTPS) | mittel, braucht Internet | Spezifikation Phase 3 |
| 12 | Andere Slicer der Orca-Familie | Bambu Studio, Creality Print, Elegoo Slicer, Anycubic Slicer Next, QIDI Studio | dasselbe JSON-Format; einzelne Schlüssel kennt das Ziel nicht, sie fallen weg wie beim Übertragen | wie 1 bis 5 | mittel | nicht geprüft |
| 13 | PrusaSlicer, SuperSlicer | `.ini`, Konfig-Bündel, 3MF mit `Slic3r_PE.config` | INI mit anderen Schlüsselnamen (`temperature` statt `nozzle_temperature` …) | `configparser`, dazu eine Zuordnungstabelle | groß, nur teilweise | Orca selbst importiert keine INI |
| 14 | Cura | `.curaprofile`, `.xml.fdm_material` | anderes Modell für Profile und Material | – | nicht sinnvoll | – |
| 15 | Spulen | RFID der Spule im U1 (`filament_detect`: Hersteller, Typ, Temperaturen, Trocknen), Spoolman (REST) | keine Profile, aber Werte für ein neues | `urllib` | Idee für später | am U1 am 23.09. |

## Wie OrcaOne das einheitlich behandelt

1. **Lesen:** Je Quelle ein kleiner Leser. Jeder liefert dieselbe Liste von Kandidaten:
   - Art (Drucker, Filament, Prozess) und Name;
   - Werte, dazu ob sie vollständig sind oder nur die Abweichungen;
   - `inherits` und die Herkunft, etwa „3MF Benchy.3mf, Filament 2“.

   Die Art erkennt OrcaOne wie der Slicer an `printer_settings_id`, `print_settings_id` oder `filament_settings_id`.
2. **Auswerten** gegen die gewählte Installation, je Kandidat:
   - **Elternprofil:** vorhanden, in derselben Datei oder fehlt.
   - **Name:** frei, schon vergeben mit gleichem Inhalt (dann „schon da“) oder schon vergeben mit anderem Inhalt (dann umbenennen oder ersetzen).
   - **Drucker:** zu welchen Druckern und Düsen es passt.
   - **Werte:** die wichtigsten auf einen Blick, etwa Temperatur, Flow und max. Durchfluss.
3. **Auswählen:** Der Nutzer hakt an, was er will.
4. **Schreiben** wie jede Änderung, also Plan, Sicherung, Schreiben und neu einlesen:
   - als Kind des Elternprofils, wenn es das in der Installation gibt;
   - sonst als Wurzelprofil mit allen Werten, soweit die Kette auflösbar ist.

   „Übertragen“ schreibt schon so (`transfer.py`, `op_profile_copy`).
5. **Später:** Ein Filament für einen fremden Drucker an ein Profil des eigenen Druckers hängen („An Zielprofil hängen“, Spezifikation Phase 3).

## Sicherheit

- **Archive:** ZIP-Dateien und 3MF liest OrcaOne nur im Speicher, nie auf die Platte entpackt, mit Grenzen für Größe und Anzahl der Einträge. Pfade in Archiven sind nur Namen.
- **Zugangsdaten:** Aus Druckerprofilen fallen `print_host` und `printhost_*` weg, wie beim Export des Slicers.
- **Schreiben:** nur nach `user/**` und in die `.conf` (Regel 2), mit Sicherung vorher (Regel 4).

## Stand

- **23.09.2026 gebaut** (Wunsch des Nutzers: „die ersten 3 und 3MF“): Quellen 1 bis 4 und 7 sowie der Export. Code in `orcaone/importer.py`, Seite `pages/import.js`.
- **23.09.2026 ergänzt:** Bei einem 3MF die Werte und Farben der genutzten Profile und „Hier passend“; die Erklärung „Was ein Import braucht“. Dazu die eigene Seite „3MF bereinigen“: ein 3MF ohne Drucker, Prozess, Filamente und G-Code des Projekts zurück.
- **Offen:** 5 und 6 (G-Code, Drucke vom U1), 8 (`user_backup-v*`, andere Benutzerordner), 11 (GitHub), „An Zielprofil hängen“, 12 und 13.

## Vorschlag für die Reihenfolge

1. **Grundgerüst mit Quellen 1, 2, 3 und 7:** die Seite mit Datei wählen, Auswertung, Auswahl und Schreiben, dazu der Export.
2. **Quellen 4 bis 6:** 3MF und G-Code, auch direkt vom U1. Das holt Profile aus jedem Druck zurück.
3. **Quelle 8:** Profile aus `user_backup-v*` und anderen Benutzerordnern, ein häufiger Stolperstein.
4. **Quelle 11 und „An Zielprofil hängen“.**
5. **Quellen 12 und 13 nur bei Bedarf.**
