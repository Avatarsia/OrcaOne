# Ideen

Stand 26.09.2026. Ideen des Nutzers; was davon gebaut ist, steht bei der Idee. Was geprüft ist, steht mit Quelle dabei; am U1 nur lesend über Moonraker abgefragt.

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

**Anders gelöst (27.09.2026):** als eigene Seite „Diagramme“ mit uPlot, siehe Idee 11.

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

## 8. SSH-Schlüssel dauerhaft auf dem U1 (`/oem/.debug`)

Frage des Nutzers (26.09.2026): Kriegen wir das mit `/oem/.debug` geklärt? Entscheidung: erst so lassen, später genauer prüfen.

**Was feststeht (FINDINGS „Netzwerk des U1 und SSH-Schlüssel“):**
- `/etc/init.d/S01aoverlayfs` leert bei jedem Start `/oem/overlay`, das beschreibbare Overlay über `/`, außer es gibt `/oem/.debug`. Ohne die Datei sind nach einem Neustart Schlüssel, geändertes Passwort und der Host-Schlüssel von Dropbear weg.
- OrcaOne braucht die Datei nicht: Das Passwort ist nach jedem Start wieder `snapmaker`, damit meldet sich OrcaOne an, solange Root Access an ist. Der Schlüssel ist Bequemlichkeit, etwa fürs eigene Terminal.
- Mit der Datei bleibt alles im Overlay, auch jeder Fehler; ein Neustart repariert dann nichts mehr. Jedes Firmware-Update löscht sie. Die „Data Persistence“ der Extended Firmware ist genau dieses `touch /oem/.debug`, mit Rettung per USB-Stick (`full-recover.txt`); die Originalfirmware hat keine.
- OrcaOne legt die Datei nie an (CLAUDE.md).

**Noch zu prüfen:**
- Ob die Originalfirmware mit `/oem/.debug` noch mehr einschaltet; der Name klingt nach Debug-Modus. Nur lesend auf der Seite „SSH“: `grep -rInF /oem/.debug /etc /usr /opt 2>/dev/null | head -40`.
- Wie man einen U1 zurückholt, dessen Overlay mit der Datei kaputt ist, ohne Extended Firmware: ob ein Firmware-Update per USB-Stick die Datei auch dann löscht, wenn der Drucker nicht mehr sauber startet.

**Was dann ginge:** ein Schalter „Schlüssel dauerhaft“ im Reiter „SSH-Schlüssel“ der Seite „Netzwerk“, mit deutlicher Warnung, nur auf Klick (`touch` bzw. `rm /oem/.debug`, danach Neustart). Erst bauen, wenn die Prüfung zeigt, dass die Datei nichts anderes einschaltet, und der Nutzer es will.

## 9. Firmware-Update des U1 aus OrcaOne

Wunsch des Nutzers (26.09.2026): „Datei lokal auswählen, Update klicken, fertig“, am liebsten eine Firmware wählen, Original oder Extended Firmware von paxx, „install“ klicken. Recherchiert von einem Agenten, am Drucker noch nichts geprüft.

**Was feststeht (mit Quellen):**
- **Offiziell** zwei Wege ([Snapmaker-Wiki](https://wiki.snapmaker.com/en/snapmaker_u1/firmware_update_procedure)): am Display über WLAN (Settings → About → Firmware Version, nur mit Snapmaker-Cloud, nicht im LAN-Modus) oder „Local Update“ von einem FAT32-Stick. Die Dateien verlinken die [Release Notes](https://wiki.snapmaker.com/en/snapmaker_u1/firmware/release_notes), etwa `U1_2.0.0.205_20260914173503_upgrade.bin` (V2.0.0 vom 15.09.2026); der U1 des Nutzers hat 1.6.0. Keine Prüfsumme, keine Signatur veröffentlicht.
- **Die Datei:** Magic „SNMK“, bis zu vier Teile (`update.img` für den SoC, Firmware der Mikrocontroller at32f403a und at32f415, `MCU_DESC`), geschützt nur durch Summen und MD5, keine kryptografische Signatur (Extended Firmware, `tools/upfile/upfile.c`, GPL-3.0, nicht übernehmen).
- **Über Moonraker geht es nicht:** Snapmakers Moonraker hat keinen Endpunkt dafür, nur den `update_manager` für Git-, Zip- und apt-Pakete (Snapmaker/u1-moonraker). Snapmaker Orca kann beim U1 kein Firmware-Update (`MoonRaker.cpp` fragt nur die Version ab; der Update-Code in `DeviceManager.cpp` ist Bambus Weg).
- **Über SSH als root schon:** Die Extended Firmware legt die Datei nach `/userdata/web_upgrade.bin` und ruft `/home/lava/bin/systemUpgrade.sh upgrade all <datei>` auf; fertig bei „upgrade soc finish, prepare to reboot“ (`overlays/firmware-extended/02-firmware-config/.../30_upgrade.yaml`). Das Skript gehört zur Originalfirmware. Der U1 hat zwei Systemslots A/B.
- **Extended Firmware** installiert man wie die Originalfirmware per „Local Update“; zurück ebenso mit der offiziellen `.bin`. Rettung (`full-recover.txt`) nur in der Extended Firmware.
- **Nach einem Update** laut Release Notes V2.0.0: Düsenkonfiguration aktualisieren, Kopfversatz kalibrieren, Bett neu vermessen. Ein Update löscht `/oem/.debug` (Idee 8).

**Was ginge:** auf „Dateien“ oder einer eigenen Seite, nur vom Rechner selbst (harte Regel 8), mit Root Access: Datei wählen (Name `U1_*_upgrade.bin`, Größe prüfen), prüfen, dass kein Druck läuft und `/userdata` Platz hat, per SFTP kopieren, nach Rückfrage `systemUpgrade.sh upgrade all` starten, die Ausgabe zeigen, warten, bis Moonraker wieder antwortet, dann die Version aus `/machine/system_info` vergleichen. Original oder Extended Firmware zur Wahl hieße: die Datei von Snapmaker bzw. aus den Releases der Extended Firmware laden, rund 300 MB, oder nur verlinken.

**Vorher am U1 nur lesend prüfen** (Seite „SSH“): `cat /home/lava/bin/systemUpgrade.sh` (Parameter, ob es einen Druck abfängt, welcher Slot, welche Ausgaben), `cat /proc/cmdline` (aktiver Slot), `df -h /userdata`, `ls -l $(which updateEngine)`.

**Offen:** was ein Stromausfall mitten im Update anrichtet; ob ältere Versionen abgelehnt werden; ob Root Access das Update überlebt; ob ein Update während eines Drucks gesperrt ist.

**Nachgeprüft (26.09.2026, Recherche mit Gegenprüfung; paxx-Quellen bei Commit `87df4f1`):**
- **Original → paxx:** offiziell per „Local Update“ vom FAT32-Stick (`docs/install.md`), technisch auch per SSH mit demselben Skript `systemUpgrade.sh upgrade all <datei>`, wie paxx' Seite „firmware-config“ es tut (Datei nach `/userdata/`, fertig bei „upgrade soc finish, prepare to reboot“). Für den U1 des Nutzers (Original 1.6.0.267) passt paxx stable `v1.6.0-paxx12-22` auf derselben Basis; 2.0.0 gibt es bei paxx nur als Vorabversion „rolling“. Danach: `printer_data` bleibt, `/oem/.debug` ist weg, `config/extended/` entsteht, Updates des Originals über das Display sind blockiert (Standard `upgrade: none`).
- **paxx → Original:** die Original-`.bin` aus dem Wiki auf demselben Weg. Ältere Versionen werden nicht abgelehnt (Issue #732). `config/extended/` bleibt liegen; Reste können eine ältere Firmware stören (#732). paxx' „Switch to Backup Firmware“ bootet den anderen Slot, löscht dabei aber `/oem/.printer_data` und `/oem/.debug`, laut paxx heißt das Druckerdaten auf Standard: kein bequemer Rückweg.
- **paxx aus OrcaOne laden:** sauber über die GitHub-API (`/releases/latest` = stable, testing = neueste ohne `rolling`, develop = `/releases/tags/rolling`), Dateien `U1_extended_<version>-paxx12-<n>_upgrade.bin`, 238 bis 298 MB, SHA256 im Feld `digest`; 60 Anfragen pro Stunde ohne Token reichen.
- **Original aus OrcaOne laden:** kein dokumentierter Weg und keine Versionsliste; die Dateien liegen auf `public.resource.snapmaker.com/firmware/U1/`, verlinkt nur auf den Wiki-Unterseiten, die Cloud-API braucht das Token des Druckers. Snapmakers Nutzungsbedingungen (§6.7.3, §8.5) sprechen gegen automatisches Laden. Sauber: Der Nutzer lädt die Datei im Browser (OrcaOne verlinkt die Release Notes) und wählt sie aus; OrcaOne vergleicht die SHA256 mit der Liste, die paxx in `vars.mk` führt (16 Originaldateien, darunter 1.6.0.267 und 2.0.0.205, ohne 1.5.0), sonst „unbekannt“.
- **Prüfen vor dem Flashen:** Name, Größe (paxx verlangt mindestens 50 MB), SHA256. Korrektur zu oben: Der Kopf ist per Ersetzungstabelle kodiert, roh steht dort `88 1A 47 DF`, „SNMK“ erst nach dem Entschlüsseln; die Tabelle gibt es nur in GPL-Code, also Kopf und Version nicht selbst lesen.
- **Noch am U1 lesend zu klären:** ob `systemUpgrade.sh` beim Entpacken die MD5 prüft und einen Druck abfängt; ob SFTP/scp auf der Originalfirmware geht; ob Root Access das Update überlebt; was ein Stromausfall anrichtet.

## 10. Fehler verstehen: eine Seite für Snapmakers Codes und Klippers Meldungen

**Umgesetzt (26.09.2026) als Seite „Fehler“** (`pages/fehler.js`, `orcaone/errors.py`), mit Snapmakers Texten aus Snapmaker Orca zur Laufzeit (Entscheidung des Nutzers). Am U1 geprüft: `exception_manager` und `print_stats.exception` gibt es, `klippy.log` schreibt „Raising exception: id:522 index:0 code:18 oneshot:0 level:3 …“; die Texte stehen als `error_<16 Ziffern>_title/_desc` in `en.json` (442 Codes), der Notstopp `0522-0018` und `0531-0021/-0024` fehlen dort. Offen: die WebSocket-Meldungen `notify_exception_*` und `server.exception.query` (nur beim nächsten echten Fehler beobachtbar).

Wunsch des Nutzers (26.09.2026): eine Seite, die einen Fehler zeigt, was er bedeutet und wie man ihn behebt; Snapmakers Codes wie `0003-0522-0000-0018` sind „tricky“, Klippers Meldungen „manchmal verwirrend“. Recherchiert von einem Agenten (u1-klipper `10f2f69`, u1-moonraker `a308cfa`, Klipper `ce7002b`, SnOrca 2.4.0), am U1 noch nichts geprüft.

**Die Codes des U1:** Stufe-Modul-Index-Code, je vier Dezimalstellen (`coded_exception.py`). Stufe 0001 Hinweis, 0002 Warnung mit Pause, 0003 Fehler mit Abbruch. Module 522 Bewegung/System, 523 Druckkopf, 524 Kamera, 525 Zuführung, 526 Heizbett, 527 Bauraum, 528 Referenzfahrt, 529 G-Code, 530 Kalibrieren, 531 Druckdatei, 532 Fehlererkennung, 533 Luftreiniger, 2052 System (`exception_manager.py`). Der Index ist meist Kopf oder Platine (0 host, 1 mcu, 2 bis 5 die Köpfe). Beispiel: `0003-0522-0000-0018` ist „Shutdown due to webhooks request“, also ein Notstopp über Moonraker, wie OrcaOnes Knopf ihn schickt; `-0019` ist M112 (`klippy.py:555-560`). Weitere: `-0006` Platine beim Start nicht erreichbar, `-0016` Timer too close, `-0002` jeder andere Shutdown; ADC out of range je nach Fühler `0003-0523-<Kopf>-0002` (Düse), `0003-0526-0000-0000` (Bett).

**Wie der U1 sie meldet (über Moonraker):** Objekt `exception_manager` mit `{"exceptions": [{id, index, code, level, message}]}`; WebSocket-Meldungen `notify_exception_notification` und `notify_exception_status`; `server.exception.query` nur über den WebSocket; `print_stats.exception` beim Druck; beim Shutdown beginnt `webhooks.state_message` mit `{"coded": "0003-…", "oneshot": 0, "msg": …}`. Woher das Display seine Codes nimmt, ist offen.

**Texte:** Snapmakers Wiki ([Fehlercodes](https://wiki.snapmaker.com/en/snapmaker_u1/troubleshooting/u1_error_codes), 393 Codes, nur Englisch und Chinesisch) und das Flutter-Gerätepanel von Snapmaker Orca im Datenordner (`web/flutter_web/assets/assets/i10n/en.json`, 442 Codes als `error_<16 Ziffern>_title`/`_desc`). Beide nicht immer treffend (`0003-0531-0000-0010`). Lizenz: Die Wiki ist „All Rights Reserved“, Snapmakers Nutzungsbedingungen verbieten Kopieren und Crawlen: nicht mitliefern, nur verlinken; höchstens zur Laufzeit die `en.json` des Nutzers lesen (Grauzone). Für Klipper eigene Kurztexte mit Link auf klipper3d.org schreiben, nichts wörtlich übernehmen (GPL-3.0).

**Klippers Meldungen:** `webhooks.state`/`state_message`, `print_stats.state == "error"` mit `message`, `!!`-Zeilen der G-Code-Antworten, klippy.log. Häufige, mit eigener Erklärung: Timer too close (Rechner überlastet), ADC out of range (Fühler, Kabel, min/max_temp), Move out of range, Must home axis first, Heater not heating at expected rate (Heizung, Fühler, PID), Lost communication with MCU (USB, Kabel, Netzteil), Unable to connect, TMC reports error (ot, Kurzschluss, Unterspannung), Probe triggered prior to movement, Endstop still triggered, Notstopp (FIRMWARE_RESTART), Extrude below minimum temp.

**Was ginge:** `exception_manager` mit abonnieren (`monitor.py`), die zwei Meldungen und `server.exception.query` auswerten, den `{"coded": …}`-Anfang von `state_message` erkennen; eine eigene Tabelle mit Mustern für Klippers Meldungen, Texte in `de.js` und `en.js`; zu Snapmaker-Codes Code, Modul, Stufe, die Meldung des Druckers, eigene Texte für die wichtigsten und der Link zur Wiki. Anzeigen im Streifen über den Seiten (schon da für Klipper abgeschaltet) mit Link auf eine Seite „Fehler“, die auch den Verlauf aus klippy.log („Raising exception“) zeigt.

**Vorher am U1 nur lesend prüfen:** `exception_manager` in `printer.objects.list` und was es liefert; `print_stats.exception` im Leerlauf; Antwort von `server.exception.query`; ob `state_message` beim nächsten echten Shutdown mit `{"coded"` beginnt (oder in klippy.log „Transition to shutdown state“); Zeilen „Raising exception“ in klippy.log. Nichts auslösen: kein `RAISE_EXCEPTION`, `CLEAR_EXCEPTION`, `server.exception.raise`/`clear`, und den Notstopp nicht zum Testen.

## 11. Diagramme: eine Seite für Verläufe (angefragt 27.09.2026)

Der Nutzer: die Kurven in Mainsail und Fluidd wirken unausgereift, und es fehlen Kennzahlen, weil nur Temperaturen gezeigt werden. Eine eigene Seite nur für Verläufe, als Bibliothek uPlot. Entschieden (27.09.2026): OrcaOne schreibt die Historie selbst mit, in `data/history/` (vom Nutzer bestätigt), die Seite zeigt live und nachträglich (etwa einen abgeschlossenen Druck), und mehrere Drucker. Weiter entschieden (27.09.2026): uPlot als Bibliothek; aufgezeichnet werden alle Drucker mit IP-Adresse; `klippy.log` (die „Stats“-Zeilen, beim U1 alle 2 s mit 0,1 °C) füllt nur Lücken und wird dafür in `data/history/` übernommen, nie dauernd mitgelesen. Aufbewahrung: alles 7 Tage in Sekundenwerten; je Druckteil die letzten zwei Drucke ohne Zeitgrenze, wobei ein Druckteil genau ein Dateiname ist (neue Datei, neues Teil, nichts abgeschnitten); Kennzahlen je Druck immer; eine Obergrenze für den Platz. Reihenfolge: zuerst „Live“ mit Aufzeichnung, dann die Ansicht „Druck“, dann Vergleich und Kennzahlen. **„Live“ umgesetzt (27.09.2026):** Seite „Diagramme“ mit Aufzeichnung aller Drucker, `file_position` wird schon mitgeschrieben für den späteren Sprung zwischen Kurve und 2D/3D Ansicht (Idee des Nutzers). **Cockpit (27.09.2026):** die erste Fassung war dem Nutzer zu fad und zu lang; jetzt Spuren je Einheit ohne Scrollen, Übersicht zum Zurückziehen, Auswahl je Drucker in einer Seitenleiste. Offen: Ansicht „Druck“, Vergleich, Kennzahlen, `klippy.log` für Lücken, Sprung zu 2D/3D, WLAN-Qualität als Kurve (Wunsch des Nutzers; über SSH, beim U1 mit Root Access), Obergrenze für den Platz.

## 12. Druckerbereich: Reiter für mehrere Drucker (Wunsch eines Nutzers, 27.09.2026)

„im Drucker-Layout mehrere Tabs für mehrere aktive Drucker wären cool zum Wechseln“. Heute wählt man den Drucker oben in einer Liste. Reiter für die Drucker mit IP-Adresse, die gerade antworten, würden das Umschalten verkürzen. Passt zu Idee 11 (mehrere Drucker). **Umgesetzt (27.09.2026):** erst als Reiter über der Seite; dem Nutzer war die Reihenfolge falsch (Reiter zwischen Datei und Seite), darum jetzt oben in der Kopfzeile, in beiden Bereichen (Installationen als Reiter), nur Drucker, die antworten, die Werkzeuge des Reiters in einer Leiste darunter. Offen: die Installationskarten auf „Übersicht“ und die hervorgehobene Karte auf „Drucker“ wählen dasselbe wie die Reiter, verschlanken.

## 13. Eigene Druckerprofile je Düse zusammenführen (Wunsch eines Nutzers, 27.09.2026)

„Wäre es cool, wenn man irgendwie die Profile mergen kann bzw. Profile einstellen kann? … meine Vorons haben durchgängig zwar Profile für andere Düsengrößen, aber immer nur eine Düse hinterlegt.“ Gemeint sind eigene Druckerprofile wie „Voron 2.4 0.4 Düse“ und „Voron 2.4 0.5 Düse“: je Düse ein eigener Drucker statt eines Druckers mit mehreren Düsen. Offen: wie OrcaSlicer und Snapmaker Orca Düsen zu einem Drucker gruppieren (bei Systemprofilen über `machine_model` und seine Varianten; bei eigenen Profilen?), ob OrcaOne sie nur gemeinsam anzeigen oder im Slicer wirklich zusammenführen soll, und was dabei mit Filamenten und Prozessen passiert, die an einer Düse hängen. Erst prüfen, dann entscheiden.

## 14. Klipper-Werte und klippy.log auswerten (Recherche vom 27.09.2026)

Der Nutzer wollte wissen, was bestehende Analysewerkzeuge können: FracktalWorks KlipperLogAnalyzer, Klippers `scripts/graphstats.py` und `logextract.py`, dazu Sineos' Log Visualizer und Advanced Log Inspector, Klippy Detective, Klippylyzer, Shake&Tune, klipper_estimator, Obico.

**Lizenz:** Code übernehmen geht nicht. graphstats, logextract, Sineos, Shake&Tune, Obico, Mainsail und Fluidd stehen unter GPL-3.0 oder AGPL-3.0, der KlipperLogAnalyzer hat gar keine Lizenz. Formeln, Schwellen und Bedienideen sind frei, also nur eigener Code und eigene Texte.

**Den klippy.log des U1 liest keines davon:** Der U1 schreibt `MM-DD HH:MM:SS.mmm:` (ohne Jahr) vor jede Meldung, die Werkzeuge erwarten die Zeile mit `Stats` am Anfang. Klipper selbst schreibt keine Uhrzeit; die Wanduhr ergibt sich aus `Start printer at … (<Unix-Zeit> <monoton>)`. Der U1 wechselt die Datei nach 10 MiB und hebt 15 alte auf.

**Wichtigster Fund (aus dem Quelltext, am U1 noch nicht geprüft):** Die Werte der Stats-Zeilen gibt es live über Moonraker, jede Sekunde:
- `mcu`, `mcu e0` … `mcu e3` → `last_stats` (`mcu_awake`, `mcu_task_avg`, `mcu_task_stddev`, `bytes_write`, `bytes_retransmit`, `bytes_invalid`, `srtt`, `rttvar`, `rto`, `freq`, `adj`);
- `toolhead` → `print_time`, `estimated_print_time`, `stalls`;
- `system_stats` → `sysload`, `cputime`, `memavail`.

`history.py` könnte sie also direkt mitschreiben; `klippy.log` bräuchte man nur für die Zeit vor der Aufzeichnung und für Ereignisse (Starts, Shutdowns, Konfiguration, Versionen).

**Für „Diagramme“:** neue Spuren je MCU, als Formeln nachgebaut wie bei graphstats:
- MCU-Last = 100·(avg+3σ)/0,0025;
- wach = 100·awake/5;
- Wiederholungen und `bytes_invalid` als Rate;
- `srtt` in ms, Taktabweichung;
- Puffer = print_time − estimated_print_time (unter 1 s beim Druck heißt knapp);
- Stalls, Rechnerlast je Kern, freier Speicher.

Dazu senkrechte Marken für Klipper-Start, Shutdown, Druckstart und -ende, Pause und Fehlercodes; ein Klick führt ins Log. Beim U1 die Wiederholungen je Kopf neben dem Band der Kopfwechsel, eine Häufung beim Wechsel spricht für die Kontakte dieses Kopfes.

**Eigene Seite „Befund“ (nur lesend):**
- Zeitleiste der Klipper-Läufe mit Shutdowns und Drucken;
- eine Befundliste mit Stufe als Text und Farbe und „Was heißt das / Was hilft“: Timer too close, Lost communication mit den Wiederholungen davor, Puffer knapp, MCU-Last über 80 bzw. 95 %, Speicher knapp, Heizung erreicht das Soll nicht, Versionen von Host und MCU verschieden;
- ein Bericht je Druck;
- eine Absturzakte wie bei logextract (letzte G-Code-Zeilen, Stats davor);
- die Konfiguration je Start mit Unterschied zum vorigen Start.

**Reihenfolge laut Recherche:** MCU-Werte aufzeichnen, Marken in „Diagramme“, „Befund“ mit wenigen Prüfungen, Bericht je Druck, Absturzakte. Lieber nicht: Fehldruckerkennung per KI, Riemen- und Schwingungsanalyse, klipper_estimator nachbauen.

**Offen:** am U1 nur lesend prüfen, ob `mcu e0` … `last_stats` so im Abo ankommen und wie oft.
