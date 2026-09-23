# Ideen

Stand 23.09.2026. Ideen des Nutzers, noch nicht beauftragt. Was geprüft ist, steht mit Quelle dabei; am U1 nur lesend über Moonraker abgefragt.

## 1. Druck in 3D

Wunsch: die Druckdatei in 3D ansehen und den Druck live mitverfolgen. Mainsail kann das auch, aber „hakelig“ und ohne Farben.

**Was da ist (geprüft):**
- **In der Druckdatei:**
  - jede Bewegung;
  - die Schichtwechsel (`;BEFORE_LAYER_CHANGE`, `;AFTER_LAYER_CHANGE`, aus `fdm_toolchanger.json`);
  - die Art jeder Linie (Wand, Füllung, Stütze);
  - die Kopfwechsel als `T0` bis `T3` (`GCodeWriter::toolchange_prefix`, Flavor `klipper`);
  - die Farben im Konfigurationsblock am Ende, beim letzten Druck `filament_colour = #E2DEDB;#080A0D;#E72F1D;#F4C032;#FF8000`.
- **Von Moonraker:**
  - die Datei selbst (`/server/files/gcodes/<Datei>`);
  - ihre Metadaten mit Schichtzahl, Höhe, Filament und Farbe je Kopf und Vorschaubildern;
  - live die Stelle in der Datei, die der U1 gerade druckt (`virtual_sdcard.file_position`), und die Kopfposition.
- **Größe:** 25 Druckdateien auf dem U1, 3 bis 99 MB je Datei.

**Was besser wäre als in Mainsail:**
- Farben aus der Datei oder von den echten Spulen je Kopf; die RFID-Daten liest „Kalibrieren“ schon.
- Aussehen wie die Vorschau in Orca: Linien als beleuchtete Stränge in echter Breite statt dünner Striche.
- Live: Gedrucktes voll, der Rest blass, die aktuelle Schicht hervorgehoben, die Düse als Punkt, daneben das Kamerabild.
- Flüssig auch bei 100 MB: Einlesen im Hintergrund (Web Worker), Zeichnen über die Grafikkarte (Instancing).
- Schichtregler, Fahrwege und Stützen ein- und ausblenden, Farbe nach Filament, Linienart oder Geschwindigkeit.
- Nur lesend, wie „Kamera“ und „Kalibrieren“.

**Was es braucht:**
- **Bibliothek:** three.js (MIT-Lizenz, als Datei in `orcaone/static/vendor/`). Das ist eine neue Abhängigkeit und braucht das Okay des Nutzers. Ohne sie ginge es mit reinem WebGL und mehr eigenem Code.
- **Risiko:** die Geschwindigkeit bei großen Mehrfarbdrucken mit Millionen Linien. Ein Prototyp mit der größten Datei (99 MB) zeigt das früh.
- **Platz:** unter „Drucker“ neben „Kamera“ oder als zweite Ansicht auf „Kamera“.
- **Vorgehen:**
  1. Prototyp in `prototypes/` mit einer echten Datei: laden, Farben, Schichtregler.
  2. Danach das Live-Mitverfolgen in OrcaOne.

## 2. Dateien auf dem U1

Wunsch: ein brauchbarer Datei-Browser für den U1, etwa für Druckdateien und Kameraaufnahmen.

**Was der U1 anbietet (Moonraker 1.6.0):**

| Ordner in Moonraker | Pfad auf dem U1 | Rechte | Inhalt |
|---|---|---|---|
| `gcodes` | `/userdata/gcodes` | lesen und schreiben | 25 Druckdateien, nur `.gcode`, zusammen 434 MB; Vorschaubilder mit 48, 96 und 300 px in `.thumbs/` |
| `camera` | `/oem/printer_data/camera` | nur lesen | 14 Zeitraffer-Videos (`.mp4`, je 18 bis 20 MB, vom 26.08. bis 16.09.2026) mit Titelbild, dazu `monitor.jpg`, das Livebild |
| `logs` | `/userdata/logs` | nur lesen | 48 Dateien, 413 MB: `moonraker.log`, `gui.log`, `syslog`, `sysinfo_*.csv`, `klippylogs/` |
| `config` | `/oem/printer_data/config` | nur lesen | 43 Dateien: `printer.cfg` und weitere `.cfg`, `snapmaker/*.json` (etwa `print_task.json`, `bed_mesh_default.json`), `persistent/` |

- **STL-Dateien** liegen nicht auf dem U1. Er druckt nur G-Code, die Modelle bleiben auf dem Rechner.
- **Metadaten je Druckdatei** (`/server/files/metadata`):
  - Slicer und Version;
  - geschätzte Zeit;
  - Filament je Kopf mit Name, Typ, Farbe, Länge und Gewicht;
  - Schichtzahl, Schichthöhe, Objekthöhe, Düse;
  - Vorschaubilder.
- **Druckverlauf** (`/server/history`): Status, Dauer, verbrauchtes Filament und ob die Datei noch da ist. Zurzeit stehen dort nur 3 Drucke.
- **Speicher:** 27,4 GB, davon 24,2 GB frei.
- **Kamera:** In Moonraker ist keine Webcam eingetragen. Die Kamera läuft über Snapmakers eigenen Weg (`camera.start_monitor`, `monitor.jpg`).
- **Videos löschen:**
  - Über Moonraker geht es nicht. `camera` ist nur lesbar, und unter den 220 G-Code-Befehlen des U1 gibt es nur `TIMELAPSE_START`, `TIMELAPSE_STOP` und `TIMELAPSE_TAKE_FRAME`. Das Klipper-Objekt `timelapse` meldet nur `is_active`, in `printer.cfg` steht nur `[timelapse] frame_rate: 24`. Angemeldete Erweiterungen gibt es keine.
  - Laut Snapmaker-Forum verwalten Nutzer die Videos am Touchscreen. Die Snapmaker-App soll sie löschen können, kann es laut Forum aber nicht.
  - Exportieren geht auf einen USB-Stick: am Touchscreen unter Einstellungen → „Export Time-lapse“ (Snapmaker-Wiki).
  - Platz ist genug: 24,2 GB frei reichen bei etwa 19 MB je Video für rund 1.200 Videos. Beim bisherigen Tempo, 14 Videos in drei Wochen, sind das Jahre.
  - **Über SSH ginge es.**
    - Einschalten: Seit Firmware 1.2.0 lässt sich SSH am Touchscreen einschalten, unter Settings → Maintenance → Root Access, zustimmen, dann Open (Doku der Extended Firmware).
    - Stand am U1: Firmware 1.4.0 (`snapmaker/product_info.json`). SSH ist aus, Port 22 lehnt ab (geprüft 23.09.2026, der Nutzer bestätigt es).
    - Anmeldung laut Doku mit `root` oder `lava`, Passwort `snapmaker`. Ein geändertes Passwort übersteht einen Neustart nur mit „data persistence“.
    - Die Videos liegen in `/oem/printer_data/camera`, je Video drei Dateien: `<Name>.mp4`, `<Name>_cover.jpg` und `<Name>.jpg`.
  - **Für OrcaOne hieße SSH:**
    - Python hat SSH nicht an Bord. Möglich wären das `ssh` des Systems (Linux, Windows ab 10) mit einem Schlüssel oder `paramiko` als neue Abhängigkeit, die das Okay des Nutzers braucht.
    - Zugangsdaten gehören nicht im Klartext in `settings.json`. Ein Schlüssel auf dem U1 übersteht einen Neustart vermutlich auch nur mit „data persistence“.
    - Offen ist, ob der Touchscreen eine eigene Liste der Videos führt. Dann bliebe nach dem Löschen ein leerer Eintrag. Deshalb erst mit einem einzigen Video testen.
    - SSH gibt vollen Zugriff auf den Drucker. Laut Doku soll es nur im eigenen Netz und nur bei Bedarf an sein.
    - Quelle: [Extended Firmware: SSH Access](https://github.com/paxx12-snapmaker-u1/SnapmakerU1-Extended-Firmware/blob/develop/docs/ssh_access.md).
  - Quellen: [Forum: Problems with time-lapse on Snapmaker U1](https://forum.snapmaker.com/t/problems-with-time-lapse-on-snapmaker-u1/40544), [Wiki: How to export time-lapse videos](https://wiki.snapmaker.com/en/snapmaker_u1/export_timelapse), [Wiki: Snapmaker App](https://wiki.snapmaker.com/en/snapmaker_app/qsg).
- **Warteschlange:** Die Druckwarteschlange (`job_queue`) ist leer.

**Was ein Datei-Browser könnte:**
- Druckdateien als Kacheln mit Vorschaubild, Druckzeit, Farben je Kopf, Gewicht und Datum, sortier- und durchsuchbar. Aus dem Verlauf: zuletzt gedruckt am …, fertig oder abgebrochen.
- Zeitraffer-Videos als Galerie: im Browser abspielen, herunterladen. Das passt auch auf die Seite „Kamera“. Löschen nur am Touchscreen, siehe oben.
- Speicher im Blick: frei, belegt, und was am meisten Platz braucht (Druckdateien, Videos, Logs).
- Logs und Konfiguration des U1 ansehen und herunterladen, wie „Logs“ es für die Slicer schon tut.
- Aus einer Druckdatei direkt in „Druck in 3D“ (Idee 1).
- **Schreibend**, das müsste der Nutzer entscheiden, denn bisher greift OrcaOne auf den U1 nur lesend zu:
  - Druckdateien löschen, umbenennen, in Ordner sortieren oder hochladen; `gcodes` ist beschreibbar.
  - Einen Druck starten.
  - Videos, Logs und Konfiguration kann Moonraker nicht löschen, diese Ordner sind nur lesbar.
