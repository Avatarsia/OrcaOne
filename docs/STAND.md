# Arbeitsstand

Stand 24.09.2026. Übergabe zwischen Sessions: was OrcaOne kann, was offen ist, wo was liegt. Was eine Seite genau tut, steht im [README](../README.md), geprüfte Fakten stehen in [FINDINGS](FINDINGS.md), der Verlauf in `git log`.

## Überblick

- **Seiten:**
  - Übersicht, die Startseite;
  - Drucker, darunter Status, Dateien (U1), 3D-Ansicht, 2D-Ansicht, Kamera (U1, mit Druckstatus), Konsole (G-Code) und SSH;
  - Prozesse, nur zum Ansehen;
  - Filamente, darunter Übertragen, Vergleichen, Kalibrieren (U1), Import/Export und Details;
  - 3MF bereinigen;
  - Slicer, darunter Sicherungen, Änderungen und Logs (Reihenfolge vom Nutzer, 24.09.).
- **Sprachen:** Deutsch und Englisch.
- **Start:** `./orcaone.sh` bzw. `orcaone.cmd`, Port 4711, auf Wunsch als App-Fenster mit eigenem Symbol ([STARTEN-UND-BAUEN](STARTEN-UND-BAUEN.md)).
- **Schreiben:** nur in `user/**` und in die `.conf`, immer mit Plan, Sicherung und erneutem Einlesen. An Drucker schickt OrcaOne nur auf Klick: Licht, Löschen und Druckstart beim U1, oben in der Leiste Druckstart, Abbruch und Notstopp bei jedem Klipper-Drucker; sonst liest es über Moonraker. Dazu G-Code auf der Seite „Konsole“ und SSH auf der Seite „SSH“.
- **Tests:** 278. Unter Windows 267 grün und 11 nur für Linux übersprungen (24.09.). Unter Linux liefen die sieben neuen noch nicht, davor waren alle 271 grün (`.lenv/bin/python -m pytest`).
- **Zuletzt (24.09.), die Leiste oben bedient den Druck** (Wünsche des Nutzers):
  - Kürzer: die Installation mit „Läuft“ statt „Läuft – nur ansehen“, „Neu einlesen“ nur als Symbol, alle Knöpfe auf einer Linie.
  - Die Druckdatei für 3D und 2D steht neben dem Drucker, mit Vorschaubild (`ui.printFile`, `app.js`); gewählt oben oder auf „Dateien“ (Klick auf den Namen, „3D“, „2D“), „Dateien“ steht im Menü jetzt über den Ansichten. Startet der Drucker einen Druck, auch vom Slicer, setzt OrcaOne dessen Datei (alle 5 s `camera.status`, nur lesend). Ohne Wahl die gedruckte, sonst die neueste.
  - Daneben Drucken, Abbrechen, Notstopp: „Drucken“ öffnet die Leiste von „Dateien“ (jetzt `pages/print-panel.js`; beim U1 mit den Optionen des Displays, sonst `POST /api/printers/print`), „Abbrechen“ fragt nach (`/api/printers/cancel`), der Notstopp löst beim zweiten Klick binnen 4 s aus (`/api/printers/emergency-stop`). Was nicht geht, ist aus, der Tooltip sagt warum. In Handybreite nur der Knopf, der gerade geht, dazu ohne Logo und Pfeile.
  - Die Düse in 3D plastisch (Messingspitze mit Sechskant, gerundete Socke, Halsrohr aus Stahl, Licht mit der Kamera) und beim U1 in der Farbe des arbeitenden Kopfs mit seiner Nummer; in 2D Punkt und Nummer.
  - Behoben nach dem ersten echten Versuch (der Nutzer: „Der Drucker lehnt ab: Not Found“): Der Druckstart des U1 und der Notstopp gingen über HTTP, und Snapmakers Moonraker sperrt HTTP für beide (404, im Log des U1). Jetzt über den WebSocket: der Start mit dem Aufruf von Snapmaker Orca (`server.files.start_local_print`, das Zeitlimit wie dort 80 s), der Notstopp als `printer.emergency_stop`; ein Start ohne U1-Optionen wie OrcaSlicer (`POST /printer/print/start` mit JSON-Body). Quellen: Snapmaker Orca und OrcaSlicer in `slicer-src/` neu geklont, Snapmakers Moonraker und Klipper auf GitHub gelesen (FINDINGS). Der nachgebaute Moonraker der Tests weist beide über HTTP jetzt ab wie der U1; vorher nahm er jeden POST an, darum blieb der Fehler unbemerkt. Ausgelöst hat OrcaOne am Drucker nichts, Klipper blieb „ready“.
  - Behoben: 3D zeigte das Bett nach unten verschoben, bis man drehte (der Nutzer).
  - Behoben: Die Schichtregler von 3D und 2D liefen auseinander (der Nutzer), weil nur die Knöpfe „2D-Ansicht“ und „3D-Ansicht“ die Schicht mitgaben, das Menü nicht. Jetzt ist `ui.viewLayer` die Schicht beider Ansichten: jede Änderung landet dort, eine neue Datei setzt sie zurück. Ohne Wahl beginnen beide oben, auch 2D, das vorher bei Schicht 1 begann. Folgt 2D einem Druck, bleibt die gemeinsame Schicht unberührt, 3D zeigt dann weiter das ganze Modell. Im Browser geprüft über Menü, Knöpfe und Dateiwechsel.
  - Frage des Nutzers: Das Vorschaubild von `seife_PLA_1h9m.gcode` zeigt nur Orange, obwohl die Datei zwei Farben nutzt. Das Bild malt Snapmaker Orca aus dem 3D-Modell mit der Farbe jedes Teils (`render_thumbnail_internal`); das Schwarz ist ein Filamentwechsel ab Schicht 105 (Z 25,16 mm) und kommt darin nicht vor. Eine Datei aus dem Zwischenspeicher erscheint vor der ersten Antwort des Druckers; mit der Antwort kam das echte Bett, gezeichnet wurde es aber erst beim nächsten Drehen. Jetzt sofort.
  - Geprüft im Browserfenster am U1: Dateiwahl, Setzen beim Druckstart mit eingesetztem Druckzustand, „Drucken“ bis zum Start, „Abbrechen“ mit Rückfrage und Escape, Notstopp mit Ablauf und zweitem Klick, Handybreite 375 px. Alle Befehle gingen nur an einen Stub im Browser, am Drucker ist nichts ausgelöst. Backend mit Test gegen den nachgebauten Moonraker. **Offen:** Start, Abbruch und Notstopp einmal am echten Drucker (Nutzer).
- **Davor (24.09.), 3D-Ansicht wie in OrcaSlicer und FreeCAD** (Wunsch des Nutzers):
  - Achsen X rot, Y grün, Z blau an der Plattenecke, ein Zehntel der Platte lang, mit Buchstaben; Strichstärke (2 px) und Buchstabengröße (16 px) werden bei jedem Bild aus dem Abstand gerechnet, damit sie nah herangezoomt nicht klobig werden (der Nutzer).
  - Würfel unten rechts (`pages/view-cube.js`, eigene kleine Leinwand): 6 Flächen mit Namen, 12 Kanten, 8 Ecken, jedes Teil anklickbar, die Kamera dreht sich in 0,4 s dorthin; Tooltip nennt die Ansicht, z. B. „Vorne rechts oben“.
  - Knöpfe unten neben dem Würfel: zurücksetzen, von oben, einpassen, 90° links/rechts (auch die Ansicht von oben), als PNG speichern, Vollbild. Der Schichtregler endet über dem Würfel.
  - Die Startansicht („Ansicht zurücksetzen“) schaut gerade von vorne und ist nur nach vorne geneigt, nicht mehr leicht von links (der Nutzer: „nicht gedreht“).
  - Geprüft im Browserfenster mit einer Datei vom U1: Treffer auf alle Teile, Klick auf die senkrechte Kante „vorne links“, Drehen, Einpassen, hell und dunkel. Nicht geprüft: Vollbild und Bild speichern (im Testfenster nicht sinnvoll).
- **Davor (24.09.), Lizenz und Startbildschirm** (Wünsche des Nutzers):
  - `LICENSE.md`: PolyForm Noncommercial 1.0.0 wie ionpy, mit Kurzfassung auf Deutsch und Englisch; der Lizenztext ist Zeichen für Zeichen der von ionpy. Verkauf, Einbau in verkaufte Produkte und bezahlte Dienste stehen ausdrücklich in der Kurzfassung. Fremde Dateien in `vendor/` sind ausgenommen, `vendor/README.md` nennt jetzt auch three.js und xterm.js. README mit Abschnitt „Lizenz“.
  - Startbildschirm in `app.js` und `style.css`: Symbol, „OrcaOne“, „by Dr. Klipper“, Ladebalken, „Lese Installationen …“, unten Lizenz und „Keine kommerzielle Nutzung“. Mindestens 3 s (1,2 s waren dem Nutzer zu kurz) und bis `loadState.status` nicht mehr „loading“ ist; bei einem Fehler weg. Geprüft hell, dunkel und in Handybreite.
  - Unten im Menü „by Dr. Klipper“ (Text `T.by`, auch auf dem Startbildschirm); ein Klick öffnet die Seite „Lizenz“ (`pages/lizenz.js`, `#/lizenz`, nicht im Menü): Kurzfassung, Kontakt, Fremddateien und der englische Lizenztext aus `LICENSE.md` über `GET /api/license`. `tools/build.py` packt `LICENSE.md` mit ins Programm.
  - Lizenztext in der Seite (Wunsch des Nutzers: „als MD-Datei geht gar nicht“): die 15 Abschnitte des PolyForm-Texts in `texts/en.js` (Original) und `texts/de.js` (Übersetzung, nicht verbindlich), jeder aufklappbar, dazu „Alle aufklappen“; auf Deutsch das Original darunter zum Aufklappen. `LICENSE.md` wieder eine Datei mit Deutsch und Englisch und am Ende der Übersetzung; `tests/test_license.py` hält Seite und Datei gleich. Der zwischenzeitliche Endpunkt `GET /api/license` und `LICENSE.de.md` sind wieder weg.
  - Strg+C in der Konsole von OrcaOne: kein Traceback mehr, sondern „OrcaOne beendet.“ (`__main__.py`, Test). Ob cmd.exe danach bei `orcaone.cmd` noch „Batchvorgang abbrechen (J/N)?“ fragt, ist ungeprüft; die Frage käme von cmd selbst.
  - Konsole: Nur ein Befehl aus der Liste leert die Anzeige, ein eingetippter nicht mehr (Wunsch des Nutzers). Am Drucker noch nicht ausprobiert, Befehle schickt nur der Nutzer.
  - Englisch: „3D View“ und „2D View“ mit großem V (Wunsch des Nutzers).
  - **Druckerbilder:** Die drei PNG (U1, Generic Klipper, Platzhalter) stammen aus den Quellen von OrcaSlicer (AGPL-3.0), das Klipper-Bild ist das Klipper-Logo. Der Nutzer will sie ersetzen, am liebsten durch echte Fotos mit passender Lizenz; bis dahin nennt `LICENSE.md` sie als Ausnahme.
- **Davor (24.09.), erster Start auf dem Windows-Rechner** (`D:\Projekte\OrcaOne`):
  - `orcaone.cmd` scheiterte: `py -3` nahm die Variante „free-threaded“ 3.13t, dort baut `cffi` für paramiko nicht. Das Skript probiert jetzt jede Version aus `py -0` und nimmt die erste normale ab 3.11, sonst `python`.
  - Die Umgebung heißt unter Windows `.wenv` (Wunsch des Nutzers), `.lenv` bleibt Linux.
  - Wunsch des Nutzers, die Installation in der Konsole zu verfolgen: pip läuft ohne `--quiet`, aber nur, wenn sich `requirements.txt` von der Kopie in `.wenv` unterscheidet. Ein normaler Start ruft pip nicht auf.
  - OrcaOne hing bei „Lese Installationen …“: psutil braucht hier bis 0,25 s je Prozess für den Namen, `guard.find_processes` über 60 s. Jetzt eine Toolhelp32-Momentaufnahme (0,2 s), psutil nur für Slicer-Prozesse; `/api/data` in 2 s mit beiden Installationen.
  - Die Tests liefen zum ersten Mal unter Windows, zwei waren rot: ein Testpfad ohne Laufwerk und Sicherungen derselben Sekunde in falscher Reihenfolge. Beides behoben, Letzteres mit eigenem Test.
  - Die echten `.conf` haben CRLF und die MD5 in Großbuchstaben, OrcaOne schreibt sie Byte für Byte gleich (FINDINGS, „Windows am echten Rechner“).
  - Geprüft: Erststart ohne `.wenv`, `/api/data` und Übersicht im Browser, Tests. Nicht geprüft: Schreiben unter Windows.
  - Frage des Nutzers, warum die IP des U1 fehlt, obwohl SnOrca sie kennt: SnOrca hält einen verbundenen Drucker in `.conf` → `devices[].ip`, nicht als `print_host`. OrcaOne liest das jetzt (`overview._printers_page`, Test), hinter „Physischer Drucker“. Die Karte nennt die Quelle nur noch „aus <Slicer>“.
  - **Offen, Nutzer fragen:** Adressen gelten je Druckermodell. Die zwei Voron des Nutzers in OrcaSlicer sind beide „Voron 2.4 300“ (192.168.30.70 und 10.30.40.71), OrcaOne zeigt nur die erste.
- **Davor (24.09.):** „2D-Ansicht“ unter „Drucker“ (Wunsch des Nutzers: „etwas technischer, mit ein paar mehr Infos“), noch nicht committet, ebenso die 3D-Ansicht darunter.
  - `pages/druck2d.js`, Canvas 2D: eine Schicht von oben, Farben nach Filament, Linienart, Geschwindigkeit, Volumenstrom, Beschleunigung, Lüfter, Temperatur, Linienbreite; Fahrwege und Rückzüge; Linien einzeln durchgehen; Linie zeigen oder anklicken mit Werten und G-Code. Seite: Schicht und Datei mit allen Einstellungen.
  - Auf Rückmeldung des Nutzers („schlecht erkennbar, was gerade gedruckt wird und was die vorherige Schicht ist“): Gedrucktes voll und mindestens 1,6 px breit, was noch kommt als feine Linie, die letzten 30 Linien mit Leuchtrand, die Schicht darunter blaugrau; Legende dazu.
  - Gemeinsam mit 3D in `pages/print-view.js`: Dateiwahl, Einlesen, Zwischenspeicher, Folgen, Teilabruf. Der Einleser (`gcode-worker.js`) teilt jetzt Bögen (G2/G3) in Stücke wie Klipper, merkt je Linie Geschwindigkeit, Beschleunigung, Lüfter, Temperatur und Zeile, dazu Fahrwege, Rückzüge, `M73 R` und Filament je Schicht, alle Einstellungen der Datei. Die 3D-Ansicht hat „2D-Ansicht“ oben, die 2D-Ansicht „3D-Ansicht“, jeweils mit Datei und Schicht; „Dateien“ hat „3D“ und „2D“.
  - Backend: `/api/printers/file` reicht `Range` an Moonraker durch (206), Test gegen den nachgebauten Moonraker.
  - Geprüft im Browserfenster der App mit Dateien des U1 (Puzzle, Dragon mit 60.000 Bögen), hell und dunkel, Handybreite, G-Code-Zeilen gegen die Datei; 3D nach dem Umbau in Firefox ohne Fenster.
  - Fragen des Nutzers nebenbei beantwortet: ETA vom Drucker (Klipper meldet keine, siehe IDEEN) und Spoolman (REST-API, siehe IDEEN).
- **Davor (24.09.):** „3D-Ansicht“ unter „Drucker“ (Wunsch des Nutzers: „die Superlative von Mainsail 3D View“).
  - `pages/druck3d.js` mit three.js 0.186 (`vendor/three`, vom Nutzer freigegeben), `pages/gcode-worker.js` liest die Datei im Web Worker während des Ladens (Bytes statt Text, Typed Arrays, 1/50 mm). Gezeichnet über Instancing, ein Strang je Linie in echter Breite und Höhe.
  - Datei aus der Liste des Druckers (mit Größe), vom Rechner oder hineingezogen; „3D“ auf „Dateien“. Farben nach Filament oder Linienart, Schichtregler, schräg oder von oben, hell und dunkel.
  - Beim Druck der gezeigten Datei alle 3 s `file_position`: Gedrucktes fest, der Rest als eine durchsichtige Hülle (Tiefe zuerst, dann Farbe einmal je Pixel über den Stencil), die Düse bleibt auf dem Bildschirm gleich groß.
  - Neu im Backend: `GET /api/printers/files` und `/api/printers/file` (je mit `model`), Tests gegen den nachgebauten Moonraker.
  - Geprüft in Firefox ohne Fenster (WebGL mit llvmpipe, das Browserfenster der App hat keins) mit Dateien des U1 bis 98,8 MB und dem Druckfall mit eingesetzten Werten. **Offen:** in einem Browser mit Grafikkarte ansehen und einem echten Druck folgen.
- **Davor (24.09.):** Nach dem Aufteilen der Arbeit des Tages in 13 Commits zwei neue Seiten auf Wunsch des Nutzers.
  - **Bewegung auf „Status“ neu (Nutzer: „komisch“, X Y Z „sinnlos im Raum“):** die Druckplatte von oben aus dem Bereich des Bettnetzes (U1: Netz 3 bis 267 mm, Platte 0 bis 270), dahinter blass der Rest der Achsen (beim U1 der Parkbereich bis Y 335), 50-mm-Raster ab dem Nullpunkt, der Kopf mit Fadenkreuz und X und Y an den Linien, Z als Lineal mit Marke, die Geschwindigkeit als Tacho bis `max_velocity`. Nicht referenziert: kein Punkt, nur der Hinweis.
  - **Status umgebaut (nach dem Commit), Wunsch des Nutzers („trocken“):** Druck als Ring, die Köpfe als Bühne wie auf der Übersicht (jetzt `printer-stage` in common.js) mit Düse, PA, Wechseln, Fehlern und Filamentsensor je Kopf, Temperaturbalken mit Sollmarke, der Kopf auf einer Karte des Betts (Achsgrenzen aus `toolhead`, U1: X 0–271, Y 0–335, Z −6–275 mm), Lüfter, die sich mit ihrer Leistung drehen, System als Kacheln. Den Druckfall mit eingesetzten Werten im Browser angesehen, auch dunkel und in Handybreite.
  - **Zwei Schalter unten im Menü:** Sprache DE/EN und hell/dunkel. Das Design steht als `"theme"` in `data/settings.json`, `GET /` liefert die Seite schon mit `data-theme` (kein Aufblitzen). Die Farben stehen dafür nur noch einmal im CSS, als `light-dark()`; `color-scheme` wählt. Das SSH-Terminal folgt dem Schalter.
  - **Übersicht umgebaut (nach dem Commit):** statt Wertelisten der Drucker auf einer „Bühne“ mit seinen Köpfen als eigener Zeichnung (Spule, Filament, Temperatur, glühende Düse, abgesenkter aktiver Kopf, Bett darunter; Wunsch des Nutzers, kein Snapmaker-Orca-Nachbau) und Kacheln mit großer Zahl, die ganze Kachel ist der Absprung. Der Druckfall ist mit eingesetzten Werten im Browser angesehen, ein echter Druck steht aus. Übersicht und Status fragen sofort, wenn der Tab wieder sichtbar wird.
  - **Übersicht** (`pages/uebersicht.js`), die neue Startseite, erster Punkt im Menü, das Logo führt hin. Der gewählte Drucker mit Zustand alle 5 s (`camera.status`), beim U1 die Spulen; Filamente und Prozesse der gewählten Düse, die eigenen Filamente als Spulen; beide Installationen, letzte Sicherung, Änderungen seit dem letzten Mal; „3MF bereinigen“ zum Hineinziehen (dieselbe Komponente wie auf der Seite). Knöpfe zu den passenden Seiten. Geprüft im Browser am U1, auch in Handybreite.
  - **Status** (`orcaone/monitor.py`, `pages/status.js`, `GET /api/printers/monitor`), unter „Drucker“, für jeden Klipper-Drucker mit IP: alle 2 s über Moonrakers REST-API, nur lesend. Druck, Temperaturen, Bewegung, Lüfter, Filamentsensoren, System; beim U1 dazu die Köpfe mit Spule, Düse, PA, Kopfwechseln und Fehlern, die Druckoptionen und das Licht. Keine Diagramme, die sind ein eigenes Thema (der Nutzer). Geprüft mit Tests (nachgebauter Moonraker, einmal als normaler Klipper, einmal als U1) und im Browser am U1; eine Abfrage dauert über WireGuard etwa 0,5 s.
  - Nebenbei: „Bereit“ ist auf „Kamera“ jetzt grün wie auf der Druckerkarte; totes CSS der alten Druckerübersicht entfernt; `camera.query` und `camera.status_of` für beide Seiten.
- **Davor (24.09.):** Der Drucker, mit dem OrcaOne arbeitet, wird nur noch oben gewählt, neben der Installation (Wunsch des Nutzers, `ui.printer`, app.js). Beim Start der Standarddrucker des Slicers, eine andere Installation behält das Modell, wenn sie es hat. Filamente und Prozesse ohne Druckerübersicht, die Adresse folgt der Wahl oben (und der Zurück-Knopf der Adresse). Kalibrieren, Dateien, Kamera, Konsole und SSH ohne eigene Druckerwahl; Kalibrieren, Dateien und Kamera nur bei einem U1 im Menü, ohne „(U1)“. Auf „Drucker“ markiert „In OrcaOne gewählt“ die aktive Karte, ein Klick auf Bild oder Namen wählt sie. Der Datenordner steht in der Installationswahl nur noch im Tooltip. Am Handy heißt die Installation oben kurz „SnOrca“ oder „Orca“. Geprüft im Browser mit beiden Installationen, MyKlipper und U1.
- **Davor (24.09.):** Zwei neue Seiten unter „Drucker“ (Wünsche des Nutzers).
  - **Dateien (U1):** Druckdateien, Zeitraffer, Logs, Einstellungen, nur lesbare Ordner gekennzeichnet (`orcaone/printer_files.py`, `pages/dateien.js`). Druckdateien und Zeitraffer löschen, einzeln, Auswahl oder alle; Zeitraffer über den Kameradienst. „Drucken“ mit den Optionen des Displays und der Zuordnung Filament → Kopf. Dateien, Bilder und Videos gehen über OrcaOne. Geprüft: Lesen am echten U1 und im Browser, Löschen und Druckstart nur gegen einen nachgebauten Moonraker und im Browser bis zur Rückfrage. **Offen:** einmal am U1 ein unwichtiges Video und eine Druckdatei löschen und einen Druck starten.
  - **SSH** (früher „Terminal“): SSH im Browser (`orcaone/ssh.py`, `pages/ssh.js`, xterm.js 6.0 in `vendor/xterm`, neu `websockets` und `paramiko`, vom Nutzer freigegeben). Erst die Schlüssel des Rechners, sonst Passwort, das nicht gespeichert wird. Der WebSocket prüft Host und Origin selbst, verbindet nur zu Druckern mit IP-Adresse. Geprüft mit Tests (paramiko-Server) und am echten U1 per Schlüssel (`uptime`). Danach auf Wunsch: Passwortfeld (leer: Schlüssel, beim U1 dann „snapmaker“, sonst fragen), Link auf jeder Druckerkarte mit IP, Farben der Seite, keine Scrollleiste, Befehlsliste je Druckerart (U1 oder anderer Klipper-Drucker; Ansehen läuft sofort, Neustarts nur eintragen). Am U1 geprüft: `df`, `uptime`, „Klipper neu starten“ nur eingetragen und verworfen. Die Liste für andere Klipper-Drucker ist ungeprüft, hier gibt es keinen. Danach: Liste in fünf Gruppen mit 36 Befehlen für den U1, jeder vorher am U1 ausprobiert (nur lesend), dazu htop. G-Code-Konsole als zweite Ansicht (`orcaone/console.py`, `/server/gcode_store` und `/printer/gcode/script`), am U1 geprüft mit STATUS und M115; G28 aus der Liste landet nur in der Eingabezeile. Danach: Knopf „Leeren“ in beiden Ansichten und Leeren vor jedem Befehl (SSH: vor Befehlen aus der Liste, G-Code: vor jedem gesendeten), am U1 geprüft. Danach auf Wunsch: die G-Code-Konsole als eigene Seite „Konsole“ (`pages/konsole.js`), „Terminal“ heißt jetzt „SSH“ (`pages/ssh.js`, `#/ssh`); doppelte Zeilen in der Konsole behoben (zwei Abfragen gleichzeitig).
  - Auf dem U1 liegt seit heute ein SSH-Schlüssel dieses Rechners (`~/.ssh/id_ed25519`); nach einem Neustart des U1 ist er weg (FINDINGS).
- **Davor (24.09.):** „Für andere Düse“ im Seitenpanel von „Filamente“ (Frage des Nutzers zu „Polymaker General PLA Family“, das Snapmaker nur für 0,4 mm liefert): Knöpfe wie „+ 0,6“ für Düsen ohne Profil, wo es ein Grundprofil desselben Materials gibt; die Änderung `filament_attach` legt ein eigenes Filament wie „An Drucker hängen“ an (`importer.attach_here`). Geprüft mit Tests und im Browser bis zum Plan, der nicht ausgeführt wurde. Danach auf Wunsch des Nutzers: ein Hinweis über der Reihe („Gibt es nur für 0,4 mm (siehe Details). Für eine andere Düse legt OrcaOne ein eigenes Filament an.“), „siehe Details“ springt auf „Details“, wo die Druckerliste des Profils steht; eine Düse, für die es das Filament schon gibt, wird nicht mehr angeboten (sonst entstünde „… (2)“).
- **Behoben (24.09.), Handybreite (Frage des Nutzers):** Bei 375 px läuft keine Seite seitlich über (alle 14 Seiten gemessen). Die Druckerkarte war zerschossen, weil eine alte Regel für schmale Bildschirme noch zum früheren Aufbau passte; jetzt Bild links, Rest darunter. In „Logs“ steht die Meldung unter Uhrzeit und Stufe. Danach auf Wunsch des Nutzers ein Menüknopf (☰) oben links statt der Reiterleiste: in einem schmalen Fenster (bis 900 px) klappt das Menü als Leiste von links über die Seite (schließt mit Eintrag, Escape oder Tippen daneben), am Rechner blendet der Knopf das Menü aus; das merkt sich `data/settings.json` (`menu_collapsed`, `POST /api/settings`). Vom Handy aus erreichbar ist OrcaOne nicht, der Server lauscht nur auf 127.0.0.1 (harte Regel 8).
- **Behoben (24.09.):** Kamerabild mit Fehler 500 (`http.client.IncompleteRead`): Der U1 schreibt `monitor.jpg` manchmal neu, während er es sendet. `camera.image` fragt dann ein zweites Mal.
- **Davor (24.09.):** Seite „Kamera“: keine Temperaturen mehr (der Nutzer: „deplatziert, hat nix mit Cam zu tun“). Ist das Licht im Drucker aus, sagt es ein Hinweis über dem Bild; ein Knopf schaltet es ein und aus (`camera.set_light`, `POST /api/cameras/{id}/light`), damals der einzige Befehl an einen Drucker. Am U1 einmal ein- und wieder ausgeschaltet.
- **Davor (24.09.):** Karte je Drucker auf „Drucker“ ausgebaut (Wunsch des Nutzers: Firmware, Speicher, „nicht zu wild“). Breiter, Bild links; mit Adresse Zustand, Firmware, Köpfe und Spulen (U1), Speicher und Drucke, Einzelheiten im Tooltip, Links zu Weboberfläche und Kamera. Für jeden Klipper-Drucker (`camera.info`, `GET /api/printers/info` und `/status` mit `model`). Geprüft mit Tests und im Browser am echten U1.
- **Davor (24.09.):** „An Drucker hängen“ und Umbenennen beim Import. Ein Filament wird Kind eines Filaments des gewählten Druckers mit demselben Material („Generic …“ zuerst) und übernimmt aus der Datei nur die Werte des Materials (`importer.MATERIAL_KEYS`, `attach`, `POST /import/attach`). Geprüft mit Tests und im Browser bis zum Plan, der nicht ausgeführt wurde. Dazu im Seitenpanel von „Filamente“ Düsen und Knöpfe in je einer Reihe (Wunsch des Nutzers).
- **Davor (24.09.):** Import aus den Sicherungskopien des Slicers (`user_backup-v*`) auf „Import/Export“. Geprüft mit Tests und im Browser; die Kopien auf diesem Rechner sind leer, weil es beim ersten Start noch keine eigenen Profile gab.
- **Behoben (24.09.), nach dem Test des Nutzers mit `data/Snapmaker U1 (0.4 nozzle).orca_printer`:** Ein Druckerbündel des Slicers enthält den Systemdrucker komplett ausgeschrieben. OrcaOne hielt ihn für ein fremdes Profil gleichen Namens und hätte ihn als „… (2)“ gedoppelt, vorab angehakt. Jetzt „Systemprofil, gibt es hier“, nicht wählbar. „Schon da“ lässt sich nicht mehr anhaken, und ausgeblendete eigene Profile zählen als schon da.
- **Davor (23.09.):** Import/Export mit „Hier passend“ und „Was ein Import braucht“, die Seite „3MF bereinigen“, „Änderungen“, „Vergleichen“, der Druckstatus auf „Kamera“ und das App-Fenster. Ideen des Nutzers stehen in [IDEEN](IDEEN.md).

## Offen beim Nutzer

- **„Im LAN suchen“** zu Hause testen. Von diesem Rechner aus findet die Suche wegen WireGuard nichts.
- **Windows-Rechner,** Prüfliste. Start, Einlesen beider Installationen und das Format der `.conf` sind geprüft (24.09.):
  - alte Daten aus `%LOCALAPPDATA%\orcaone` ziehen nach `data/` um (auf dem Rechner gab es keine);
  - Sprache umschalten;
  - eine Änderung mit Sicherung und Wiederherstellen;
  - „Logs“ bei laufendem Slicer;
  - IP-Adresse beim U1 eintragen, dann „Kamera“ im Vollbild und „Kalibrieren“;
  - „Im LAN suchen“ im selben LAN: findet den U1 (Nutzer, 24.09.).
- **Im Slicer ausprobieren:**
  - „Bibliothek freischalten“, Weg A und B, mit `SUNLU PLA+ @System`;
  - [TEST-VERGLEICH](TEST-VERGLEICH.md) Teil B, die Spalte „SnOrca“;
  - die „Abnahme-Checkliste Resolver“ in FINDINGS: acht Profile, Werte in OrcaOne und im Slicer vergleichen;
  - ein eigenes Filament, das bei keiner Düse an ist: Blendet OrcaSlicer es aus? Snapmaker Orca tut es;
  - einen Druck mit Flow Calibration von Anfang bis Ende mit „Kalibrieren“ begleiten.
- **Im normalen Browser:** „Kamera“ im echten Vollbild und Enter im Formular „Datenordner hinzufügen“. Beides kann das Testfenster nicht.

## Nächste Bausteine, der Nutzer wählt

- **Import** ([IMPORT-QUELLEN](IMPORT-QUELLEN.md)): G-Code und Drucke direkt vom U1, Profile aus anderen Benutzerordnern (`user/<id>/`, etwa nach einer Anmeldung), die Orca-Bibliothek von GitHub. „An Drucker hängen“ gibt es bisher nur für Filamente, nicht für Prozesse.
- **Drucker übertragen** zwischen den Installationen, bisher zurückgestellt (FINDINGS, „Übertragung“).
- **„Details“** auch für Prozesse und Drucker. Die Abfrage im Backend kann das schon.
- **Ideen** ([IDEEN](IDEEN.md)): genauere Restzeit und „fertig um“ aus `M73 R`; Spoolman anbinden; Live-Daten über Moonrakers WebSocket statt Abfragen; Diagramme auf „Status“.

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
- **Terminal:** Die Meldungen von `__main__.py`, `orcaone.sh` und `orcaone.cmd` bleiben deutsch. In `orcaone.cmd` ohne Umlaute, denn cmd.exe liest die Datei in der OEM-Codepage. Die Datei braucht CRLF (`.gitattributes`), sonst findet `goto` die Sprungmarken nicht sicher.
- **Bauen:** `tools/build.py` ist nur unter Linux ausprobiert, unter Windows und macOS nicht.
- **Snapmaker Orca** meldet in allen Logs dieses Rechners „Update install failed“ für `printers/`. Das ist ein Problem von Snapmaker, nicht von OrcaOne.

## Hinweise für die nächste Session

- **Gedächtnis** unter `-home-dominiks-dev-OrcaOne`. Die Ordner `-orfix` und `-orcaone` sind alte Kopien, der Projektordner heißt seit 23.09. `~/dev/OrcaOne`.
- **`.lenv`** ist zweimal umgezogen. `.lenv/bin/python -m …` läuft, Skripte wie `.lenv/bin/pip` haben alte Pfade im Shebang, also `.lenv/bin/python -m pip` nehmen.
- **Vorschau** aus `.claude/launch.json` auf Port 8765, die App selbst auf 4711. Unter Windows heißt der Eintrag „orcaone-windows“ (`.wenv`).
- **Windows-Rechner:** Projekt unter `D:\Projekte\OrcaOne`, Umgebung `.wenv`. Nie `.wenv` löschen, solange OrcaOne daraus läuft: Windows sperrt nur die geladenen Dateien, der Rest verschwindet, und die laufende Instanz geht kaputt.
- **Commits:** jeden in einem sauberen Worktree testen (`git worktree add --detach …`, dort `pytest`). Zwischenstände einer Datei lassen sich mit `git hash-object -w` und `git update-index --cacheinfo` einreihen.
- **Brave als Snap** bleibt ohne Fenster (`--headless`) hängen und lässt sich nur mit `snap run --shell brave -c "kill …"` beenden.
- **Am U1** (10.30.40.174) nur lesende Anfragen, außer dem Licht (siehe Entscheidungen); beim Ausprobieren danach den alten Zustand wiederherstellen. Moonraker vertraut dem ganzen LAN (`trusted_clients: 10.0.0.0/8`), Steuerbefehle gingen also ohne Anmeldung.

## Entscheidungen

| Thema | Entscheidung |
|---|---|
| Name | OrcaOne (Orca + U1), Ordner `~/dev/OrcaOne` |
| Slicer | SnOrca 2.4 sowie OrcaSlicer stabil (2.4.x, JSON) und Nightly (2.5.0-dev, `.opc`) |
| Plattformen | Linux und Windows gleichwertig, ein Windows-Rechner zum Testen ist vorhanden |
| Abhängigkeiten | fastapi, uvicorn, psutil, pytest in `.lenv` bzw. unter Windows `.wenv` (24.09.); Vue und Schrift liegen lokal; neue nur nach Rücksprache |
| Stil | Farben von OrcaSlicer (Teal `#009688`), Schrift Inter, Druckerbilder, Spulen, wenig Text; eigenes App-Symbol, nichts aus Orca oder SnOrca |
| Grundsatz | kein zweites Orca bauen, sondern ein einfaches Filament-System für Normalos; neue Seiten nur auf Auftrag |
| Prozesse | nur ansehen, nicht bearbeiten (22.09.) |
| Echte Ordner | SnOrca und OrcaSlicer sind auf diesem Rechner Testinstallationen. OrcaOne schreibt direkt hinein, abgesichert durch seine Sicherungen (23.09.) |
| Sicherungen | vor jedem Schreiben automatisch, alle behalten, Gesamtgröße anzeigen |
| U1 | nur lesend über Moonraker. Einzige Ausnahme, auf Wunsch des Nutzers vom 24.09.: das Licht im U1 auf der Seite „Kamera“ (`SET_LED`). Alles andere Schreibende erst nach seiner Entscheidung |
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
