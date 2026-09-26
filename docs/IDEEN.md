# Ideen

Stand 25.09.2026. Ideen des Nutzers; was davon gebaut ist, steht bei der Idee. Was geprüft ist, steht mit Quelle dabei; am U1 nur lesend über Moonraker abgefragt.

## 1. Druck in 3D

Wunsch: die Druckdatei in 3D ansehen und den Druck live mitverfolgen. Mainsail kann das auch, aber „hakelig“ und ohne Farben.

**Gebaut am 24.09.2026** als Seite „3D Ansicht“ unter „Drucker“ (three.js, vom Nutzer freigegeben): Datei vom Drucker oder vom Rechner, Farben nach Filament oder Linienart, Schichtregler, beim laufenden Druck Gedrucktes fest und der Rest als durchsichtige Hülle mit der Düse; „Dateien“ verlinkt jede Druckdatei. Dazu am selben Tag die Seite „2D Ansicht“: eine Schicht von oben mit Geschwindigkeit, Volumenstrom, Beschleunigung, Lüfter und Temperatur als Farbe, Fahrwegen, Linien einzeln und dem G-Code jeder Linie. Noch offen aus dieser Idee: Kamerabild daneben, die Farben nach Geschwindigkeit usw. auch in 3D, Spulenfarben vom U1 statt aus der Datei, eine WebSocket-Brücke zu Moonraker (`printer.objects.subscribe`) für schnellere Live-Daten.

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

**Gebaut am 24.09.2026** als Seite „Dateien“ (nur beim U1): Ordner ansehen, Druckdateien und Zeitraffer löschen, Drucken mit den Optionen des Displays. Dazu die Seiten „Konsole“ (G-Code) und „SSH“. Noch offen aus dieser Idee: Speicher nach Verbrauchern, Verlauf („zuletzt gedruckt“), Hochladen, Umbenennen.

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
- **Druckverlauf** (`/server/history`): Status, Dauer, verbrauchtes Filament und ob die Datei noch da ist. Zurzeit stehen dort 28 Drucke (am 23.09. irrtümlich 3 notiert, weil nur mit `limit=3` abgefragt).
- **Speicher:** 27,4 GB, davon 24,2 GB frei.
- **Kamera:** In Moonraker ist keine Webcam eingetragen. Die Kamera läuft über Snapmakers eigenen Weg (`camera.start_monitor`, `monitor.jpg`).
- **Videos löschen:**
  - Über die Dateien in Moonraker geht es nicht, `camera` ist nur lesbar. Unter den 220 G-Code-Befehlen des U1 gibt es nur `TIMELAPSE_START`, `TIMELAPSE_STOP` und `TIMELAPSE_TAKE_FRAME`.
  - **Aber über den Kameradienst (geprüft 24.09.2026, per SSH nur gelesen):** Snapmakers Dienst `unisrv` führt die Liste selbst, in `/userdata/.tmp_timelapse/timelapse.json`. Die Videos liegen in `/userdata/.tmp_timelapse/<date_index>/`, in `camera` stehen nur Verknüpfungen darauf; 14 Videos, zusammen 281 MB. Über Moonraker (WebSocket, wie `camera.start_monitor`) liefert `camera.get_timelapse_instance` die Liste mit Größe, Dauer und Adresse zum Herunterladen (von hier aus abgefragt). `camera.delete_timelapse_instance` mit `{"date_index": …}` löscht ein Video samt Eintrag in der Liste; so macht es Snapmaker Orca (`SSWCP.cpp`, `sw_DeleteCameraTimelapse`). `unisrv` nimmt laut seinen Meldungen auch `date_indices` oder `all`. Nicht ausprobiert: Löschen bräuchte die Entscheidung des Nutzers. Dateien per SSH zu löschen ließe die Liste veraltet zurück.
  - Laut Snapmaker-Forum verwalten Nutzer die Videos am Touchscreen. Die Snapmaker-App soll sie löschen können, kann es laut Forum aber nicht.
  - Exportieren geht auf einen USB-Stick: am Touchscreen unter Einstellungen → „Export Time-lapse“ (Snapmaker-Wiki).
  - Platz ist genug: 24,2 GB frei reichen bei etwa 19 MB je Video für rund 1.200 Videos. Beim bisherigen Tempo, 14 Videos in drei Wochen, sind das Jahre.
  - **Über SSH ginge es.**
    - Einschalten: Seit Firmware 1.2.0 lässt sich SSH am Touchscreen einschalten, unter Settings → Maintenance → Root Access, zustimmen, dann Open (Doku der Extended Firmware).
    - Stand am U1: Firmware 1.6.0 laut Moonraker (`/machine/system_info`); `snapmaker/product_info.json` im Konfigurationsordner nennt noch 1.4.0 und ist veraltet. SSH war aus, Port 22 lehnte ab (geprüft 23.09.2026). Am 24.09. hat der Nutzer Root Access eingeschaltet: Port 22 antwortet mit `SSH-2.0-dropbear_2022.83`, Anmeldung mit Schlüssel oder Passwort (`publickey,password`, ohne Zugangsdaten abgefragt).
    - Anmeldung laut Doku mit `root` oder `lava`, Passwort `snapmaker`. Ein geändertes Passwort übersteht einen Neustart nur mit „data persistence“.
    - Die Videos liegen in `/oem/printer_data/camera`, je Video drei Dateien: `<Name>.mp4`, `<Name>_cover.jpg` und `<Name>.jpg`.
  - **Für OrcaOne hieße SSH:**
    - Python hat SSH nicht an Bord. Möglich wären das `ssh` des Systems (Linux, Windows ab 10) mit einem Schlüssel oder `paramiko` als neue Abhängigkeit, die das Okay des Nutzers braucht.
    - Zugangsdaten gehören nicht im Klartext in `settings.json`. Ein Schlüssel auf dem U1 übersteht einen Neustart vermutlich auch nur mit „data persistence“.
    - Die Liste der Videos führt `unisrv` (siehe oben), deshalb nicht per SSH löschen.
    - Ein Schlüssel in `/root/.ssh` überlebt keinen Neustart: `/etc/init.d/S01aoverlayfs` leert beim Start das Overlay des Systems (`/oem/overlay`), außer es gibt `/oem/.debug` (gibt es nicht, geprüft 24.09.2026).
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

## 3. Diagramme auf „Status“

Die Seite „Status“ gibt es seit dem 24.09.2026, bewusst ohne Diagramme: die sind ein eigenes Thema (der Nutzer).

**Was da ist (geprüft am U1):** Moonraker hält die Temperaturen der letzten 20 Minuten selbst, je Heizung und Sensor 1200 Werte, bei Heizungen auch Soll und Heizleistung (`/server/temperature_store`, FINDINGS „Was ein Drucker gerade tut“). Ein Diagramm bräuchte also keinen eigenen Speicher. Für laufende Werte ginge Moonrakers WebSocket mit Abo (`printer.objects.subscribe`), wie Mainsail es nutzt, statt Abfragen alle zwei Sekunden.

**Offen:** zeichnen mit schlichtem SVG oder mit einer Bibliothek (neue Abhängigkeit, braucht das Okay des Nutzers).

## 4. Genauere Restzeit und „fertig um“

Frage des Nutzers (24.09.2026): Kann man vom Drucker die ETA auslesen?

**Was da ist (geprüft am U1):**
- Klipper meldet keine Restzeit: `display_status` hat nur `progress` und `message`, `print_stats` Druckdauer und Filament. Die Restzeit aus `M73 … R…` im G-Code liest Klipper nicht aus.
- OrcaOne rechnet heute auf Status, Übersicht und Kamera: Zeit des Slicers aus den Metadaten minus gedruckte Zeit (`camera._left`).
- Das Display des U1 zeigt eine Restzeit („Estimated time remaining“), die seine Oberfläche (`/usr/bin/gui`) selbst rechnet: `estimated_time` aus Moonrakers Metadaten und der Fortschritt, im `gui.log` als „print progress: …, remain_time: …“. Abrufen lässt sie sich nicht. Die Formel steht nirgends; der einzige Wert im Log (hex-key, 1,97 %: 2903 s übrig bei 2901 s laut Slicer) passt nicht zu „Slicerzeit minus gedruckte Zeit“. Die Snapmaker-App bekommt über `snapmakercloud` ebenfalls nur `estimated_time`.
- Snapmaker Orca schreibt `M73 P<Prozent> R<Minuten>` etwa jede Minute Druckzeit in die Datei (188-mal im Puzzle-Druck von 1 h 28 min). Die 2D Ansicht nutzt das schon für die Zeit je Schicht.

**Was ginge:** Die letzte `M73`-Zeile vor `virtual_sdcard.file_position` lesen, per Teilabruf von wenigen KB (Moonraker kann Range). Das ist die Restzeit laut Slicer an genau dieser Stelle; dazu „fertig um 17:40“. Abweichungen im Tempo (Geschwindigkeitsfaktor, Pausen) ließen sich mit dem Verhältnis aus tatsächlicher und geplanter Zeit bis hier ausgleichen.

## 5. Spoolman anbinden

Frage des Nutzers (24.09.2026): Hat Spoolman eine REST-API?

**Was da ist (geprüft):**
- Spoolman hat eine REST-API unter `/api/v1`: `spool`, `filament`, `vendor` lesen und anlegen, `PUT /api/v1/spool/{id}/use` bucht Verbrauch ab, dazu `info`, `health` und ein WebSocket für Änderungen. Quelle: [Spoolman](https://github.com/Donkie/Spoolman), [API-Doku](https://donkie.github.io/Spoolman/).
- Moonraker bringt eine Anbindung mit (`[spoolman]` in `moonraker.conf`, Endpunkte `/server/spoolman/…`). Auf dem U1 ist sie nicht geladen: Moonraker 1.6.0 ohne Komponente `spoolman`, `/server/spoolman/status` gibt 404.

**Was ginge:** OrcaOne spricht Spoolman direkt an (Adresse in `data/settings.json`): Spulen mit Restgewicht auf Übersicht und Status, ein Spoolman-Filament als Vorlage für ein eigenes Filamentprofil (Material, Farbe, Dichte, Durchmesser, Temperaturen), Abgleich mit den RFID-Spulen des U1. Schreiben in Spoolman nur auf Wunsch.

## 6. Was dem Druckerbereich noch fehlt

Analyse vom 25.09.2026 auf Frage des Nutzers. Beim Zuschauen ist der Druckerbereich stark (Status, 3D/2D, Kamera, Konsole, SSH). Es fehlt beim Eingreifen in den laufenden Druck, bei Druckern, die kein U1 sind, und bei mehreren Druckern desselben Modells. Am U1 lesend geprüft (`/printer/objects/list`): `pause_resume`, `exclude_object`, die Makros `SET_PAUSE_AT_LAYER`, `SET_PAUSE_NEXT_LAYER` und `M600`, Moonraker ohne eingetragene Webcam (`/server/webcams/list` leer), Druckverlauf lesbar (`/server/history/list`).

**Beauftragt am 25.09. und gebaut** (der Nutzer: „1 und 2 machen, 4 auch … und 13“; siehe STAND):
- **Pause und Fortsetzen** (`/printer/print/pause`, `/resume`), in der Leiste und auf einer eigenen Seite.
- **Mehrere Drucker desselben Modells:** Adressen gelten je Modell, von zwei gleichen Druckern geht nur einer. Adresse je Gerät.
- **Seite „Druck steuern“:** alles zum laufenden Druck an einer Stelle (der Nutzer: „alles behandelt ja den aktuellen Druck-Workflow“): Pause und Fortsetzen, Objekte ausschließen (Klipper `exclude_object`, der Prozess im Slicer muss „Objekte ausschließen“ an haben), Pause bei Schicht (`SET_PAUSE_AT_LAYER`). Nicht in der 2D Ansicht, die ist zum Ansehen einer Datei da.
- **Höhenkarte** der Bettvermessung (`bed_mesh`).

**Weitere Ideen:**
- **Dateien und Kamera für jeden Klipper-Drucker:** Moonrakers Datei-API ist überall gleich, Kameras stehen bei Druckern mit Mainsail oder Fluidd in `/server/webcams/list`. Der U1 behält seine Extras (Licht, Druckoptionen, Zeitraffer).
- **Hochladen:** eine Druckdatei vom Rechner auf den Drucker ziehen und gleich drucken (`/server/files/upload`).
- **Nachjustieren** während des Drucks: Geschwindigkeit, Fluss, Lüfter, Z-Offset, Temperaturen. Passt auf „Druck steuern“.
- **Makros als Knöpfe**, etwa `M600` (Filamentwechsel) oder Düse reinigen. Der U1 hat über 100 Makros, viele intern; also auswählen.
- **Diagramme** und **Restzeit** (Ideen 3 und 4).
- **Druckverlauf** als Liste: Datei, Dauer, Filament, fertig oder abgebrochen, Vorschaubild, „Nochmal drucken“.
- **Benachrichtigung**, wenn ein Druck fertig ist, pausiert oder abbricht, solange OrcaOne offen ist.
- **Moonraker mit Anmeldung** (API-Key): heute nicht unterstützt, ein solcher Drucker bleibt stumm.
- **Suche im LAN** für jeden Klipper-Drucker, heute nur für den U1.
- **Spoolman** (Idee 5).

## 7. Live-Werte über Moonrakers WebSocket

Frage des Nutzers (25.09.2026): Das Mitzeichnen in 3D und 2D ist träge; sollte OrcaOne statt REST-Abfragen Moonrakers WebSocket nutzen, etwa mit 0,3 s?

**Was da ist (geprüft):**
- Heute fragt jede Seite selbst per REST über OrcaOne: 3D und 2D Ansicht alle 3 s (`FOLLOW_EVERY` in `print-view.js`), Status und Druck steuern alle 2 s, die Leiste oben alle 5 s (`JOB_MS` in `app.js`). Über VPN dauert eine Abfrage 0,3 bis 1 s.
- Klipper schickt abonnierte Werte (`printer.objects.subscribe` über Moonrakers WebSocket, wie Mainsail und Fluidd) höchstens alle 0,25 s und nur, wenn sich etwas geändert hat (Klipper, `klippy/webhooks.py`: `SUBSCRIPTION_REFRESH_TIME = .25`). Schneller geht es nicht.
- Am U1 gemessen: 6 s Abo im Leerlauf, keine Meldung, weil sich nichts ändert. Den Takt beim Drucken erst an einem laufenden Druck messen.

**Was ginge:** OrcaOne hält je Drucker eine WebSocket-Verbindung zu Moonraker, nur solange eine Seite zuschaut, und abonniert, was die Seiten brauchen (Position, `virtual_sdcard.file_position`, Temperaturen, Lüfter, Schicht, Objekte). Der Browser bekommt die Änderungen über einen WebSocket von OrcaOne, wie bei „SSH“ mit Prüfung von Host und Origin; nicht direkt zum Drucker, die Seiten sprechen nur mit OrcaOne. Leiste, Status, Druck steuern, 3D, 2D und Kamera lesen aus einem Strom statt aus eigenen Takten; ohne WebSocket wie heute. Die Düse in 3D und 2D wandert dann viermal pro Sekunde, dazwischen ließe sie sich glätten. Aufwand mittel, `websockets` ist schon eine Abhängigkeit.

**Umgesetzt (25.09.2026, „leg los“ des Nutzers):** `orcaone/live.py` hält je beobachtetem Drucker eine Verbindung mit einem Abo für alle Seiten und schiebt die Werte, wie `monitor.shape` und `control.shape` sie formen, höchstens alle 0,25 s über `GET /api/live` an den Browser (`static/live.js`, ein WebSocket je Tab, zu, solange der Tab versteckt ist). Status, Druck steuern, 3D, 2D, Leiste oben, Kamera, Kalibrieren und die Druckerkarten fragen nicht mehr im Takt; die Konsole liest Moonrakers Verlauf, sobald Klipper antwortet. Gemessen am U1 im Leerlauf: 17 Nachrichten in 8 s (Temperaturen, Rechner), die erste 4,4 KB. Offen: der Takt an einem echten Druck.
