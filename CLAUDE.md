# OrcaOne

Lokale Web-App zum Überblicken, Aufräumen, Importieren und Exportieren der Profile von OrcaSlicer und Snapmaker Orca (SnOrca).

- Spezifikation: [ORCAONE_SPEC.md](ORCAONE_SPEC.md)
- Geprüfte Fakten, gehen der Spezifikation vor: [docs/FINDINGS.md](docs/FINDINGS.md)
- Plan und Designplan: [docs/PLAN.md](docs/PLAN.md)
- Quellcode der Slicer zum Nachlesen (nur lesen, nicht im Git): `slicer-src/snorca-v2.4.0` (Snapmaker Orca, Tag v2.4.0) und `slicer-src/orcaslicer-main` (OrcaSlicer main). Befehle zum Neuanlegen stehen in FINDINGS unter „Quellen“. Keine Quellen woanders ablegen.
- Nie über das ganze Dateisystem oder das Home-Verzeichnis suchen (`find /`, `find ~`, `grep -r /`). Das dauert Minuten und blockiert. Gesucht wird nur in diesen Orten:
  - `slicer-src/`
  - dem Projekt
  - `.lenv/lib/` bzw. unter Windows `.wenv/Lib/` (Python-Pakete)
  - den bekannten Slicer-Datenordnern

## Harte Regeln (Vorrang vor allem anderen)

1. Automatische Tests laufen nur gegen Fixtures im Repo oder Kopien in einem temporären Verzeichnis, nie gegen echte Slicer-Datenverzeichnisse (`~/.config/Snapmaker_Orca`, `~/.config/OrcaSlicer`, Flatpak-Pfade unter `~/.var/app/`, `%APPDATA%\…`). Auf dem Entwicklungsrechner sind SnOrca und OrcaSlicer nur Testinstallationen: Beim Ausprobieren schreibt OrcaOne direkt in die echten Ordner, abgesichert durch seine Sicherungen (Entscheidung vom 23.09.2026). Keinen Slicer starten oder beenden.
2. OrcaOne schreibt ausschließlich in `user/**` und in die `<APP_KEY>.conf` eines Datenverzeichnisses. Nie in `system/`, Programmressourcen, Logs oder Caches.
3. Schreiben nur, wenn der betroffene Slicer nicht läuft, also weder sein Prozess noch seine AppImage-Runtime existiert. Sonst die Instanz schreibgeschützt anzeigen und den Grund nennen. Die Sperrdatei in `cache/` nie selbst setzen.
4. Vor jedem Schreibvorgang ein vollständiges ZIP-Backup des Datenverzeichnisses, ohne `log/`, `cache/`, `web/`, `hms/`, `ota/`, `user/Temp/`, `user/*/temp/` und `user_backup-v*/`. Backups sind vertraulich, weil sie Zugangsdaten enthalten. Jedes Backup lässt sich in der Oberfläche wiederherstellen.
5. Jede Änderung in zwei Schritten: Plan (alle Dateioperationen plus Diff der .conf, Zugangsdaten maskiert) → Bestätigung → Ausführung → erneuter Scan zur Kontrolle.
6. Die .conf lesen, nur einzelne Schlüssel ändern, vollständig zurückschreiben, und zwar im vorgefundenen Format (`orcaone/conf.py`):
   - Einrückung 4 Leerzeichen (SnOrca) oder Tab (Orca ab 2.4.0);
   - `sort_keys=True`, UTF-8 roh, `\n` am Ende;
   - unter Windows die MD5-Zeile neu berechnen;
   - atomar schreiben.
7. JSON tolerant lesen: unbekannte Schlüssel behalten, kein starres Schema, unveränderte Dateien nie neu schreiben. Alles Geschriebene vorher neu parsen und die Typen prüfen, sonst löscht der Slicer das Profil. `"filaments"` nie leer schreiben, denn leer heißt „alles sichtbar“.
8. Der Server lauscht nur auf 127.0.0.1 und lehnt fremde Host- und Origin-Header ab.

## Stack und Konventionen

- **Backend:** Python ≥ 3.11, FastAPI mit uvicorn, Dataclasses, sonst Standardbibliothek. Zusatzabhängigkeiten: `psutil`, dazu für die Seite „SSH“ `websockets` und `paramiko` (mit dem Nutzer abgestimmt am 24.09.2026). Keine Pydantic-Modelle, kein ORM, keine Datenbank. Das Dateisystem ist die einzige Quelle der Wahrheit.
- **Umgebung:** `.lenv` im Projektordner, unter Windows `.wenv` (vom Nutzer festgelegt am 24.09.2026, damit ein Ordner für beide Systeme beide behält), und `requirements.txt`. Start mit `./orcaone.sh` bzw. `orcaone.cmd` oder `.lenv/bin/python -m orcaone` (Windows: `.wenv\Scripts\python`). Tests mit `.lenv/bin/python -m pytest`.
- **Zusätzliche Abhängigkeiten** nur nach Rücksprache.
- **Eigene Daten** nur im Ordner `data/` im OrcaOne-Ordner (nicht im Git): alle Einstellungen in der einen Datei `data/settings.json` (`orcaone/settings.py`), dazu `data/backups/` und `data/snapshots/` (Seite „Änderungen“). Keine weiteren Dateien oder Orte.
- **Frontend:** Vue 3, für „SSH“ xterm.js und für „3D-Ansicht“ three.js (vom Nutzer freigegeben am 24.09.2026; alle lokal in `orcaone/static/vendor/`) ohne Build-Schritt, ES-Module, eine CSS-Datei.
  - Stil wie die heutige Oberfläche in `orcaone/static/` (hervorgegangen aus Entwurf E und E2): Farben von OrcaSlicer (Teal `#009688`), Schrift Inter (`orcaone/static/vendor/inter/`), Druckerbilder, Spulen, wenig Text.
  - Alle Fremddateien kopieren, nie auf andere Projekte verweisen.
  - App-Symbol: ein eigenes (`tools/make_icons.py`), nichts aus OrcaSlicer oder Snapmaker Orca. Druckerbilder ebenso: nichts aus den Quellen der Slicer (AGPL-3.0), nur eigene oder frei lizenzierte (vom Nutzer entschieden am 24.09.2026).
  - Beim Laden ein Startbildschirm, mindestens 3 s und bis die Installationen eingelesen sind: Symbol, „OrcaOne“, „by Dr. Klipper“ (in beiden Sprachen so), Lizenz und „Keine kommerzielle Nutzung“ (Wunsch des Nutzers vom 24.09.2026). „by Dr. Klipper“ auch unten im Menü, ein Klick zeigt die Seite „Lizenz“ (nicht im Menü).
  - Satzschreibung, Status immer als Text plus Farbe.
- **Lizenz:** PolyForm Noncommercial 1.0.0 wie ionpy: keine kommerzielle Nutzung, auch kein Verkauf ohne gesonderte Lizenz. `LICENSE.md` auf Deutsch und Englisch: Kurzfassungen, der englische PolyForm-Text unverändert und rechtlich maßgeblich, am Ende die deutsche Übersetzung (nicht verbindlich). Die Seite „Lizenz“ hat denselben Text abschnittsweise in `texts/en.js` und `texts/de.js`; `tests/test_license.py` vergleicht sie mit `LICENSE.md`, jede Änderung also an beiden Stellen. Fremde Dateien behalten ihre Lizenz; jede neue Fremddatei in `orcaone/static/vendor/README.md` eintragen.
- **Oberfläche** (Menü in dieser Reihenfolge, vom Nutzer festgelegt am 24.09.2026). Oben neben der Installation die Wahl des Druckers, mit dem OrcaOne arbeitet (`ui.printer`), für alle Seiten, die einen Drucker brauchen; beim Start der Standarddrucker des Slicers. Daneben die Druckdatei für 3D und 2D mit Vorschaubild (`ui.printFile`; gewählt oben oder auf „Dateien“, beim Druckstart die Datei des Druckers) und die Knöpfe Drucken (die Leiste von „Dateien“, `pages/print-panel.js`), Abbrechen (mit Rückfrage) und Notstopp (zweiter Klick binnen 4 s), damit die Leiste fast alles bedient (Wunsch des Nutzers vom 24.09.2026). Seiten nur für den U1 (Kalibrieren, Dateien, Kamera) stehen nur bei einem U1 im Menü:
  - **Übersicht:** die Startseite, bildhaft statt Wertelisten (der Nutzer: kein Snapmaker-Orca-Nachbau, etwas Eigenes). Der gewählte Drucker live mit seinen Köpfen als eigene Zeichnung (Spule, Filament, Temperatur, heiße Düse, aktiver Kopf), darunter das Bett; Kacheln mit großer Zahl für Filamente, Prozesse, Sicherungen, Änderungen, die ganze Kachel führt zur Seite; „3MF bereinigen“ zum Hineinziehen.
  - **Drucker:** Standard festlegen, aufräumen, IP-Adresse je Drucker (selbst eingetragen, `print_host` aus dem Slicer, der mit SnOrca verbundene Drucker aus `devices` der `.conf` oder beim U1 im LAN gesucht). Mit Adresse zeigt die Karte, was der Drucker über sich sagt (Zustand, Firmware, Speicher, Drucke; beim U1 Köpfe und Spulen), nur lesend und schlicht, Einzelheiten im Tooltip.
    - **Status:** was der Drucker gerade tut, für jeden Klipper-Drucker mit IP, alle 2 s über Moonrakers REST-API (`orcaone/monitor.py`), nur lesend und bildhaft: Druck als Ring, die Köpfe wie auf der Übersicht (beim U1 mit Düse, PA, Kopfwechseln, Filamentsensor), Temperaturbalken, der Kopf auf der Druckplatte von oben mit Z als Lineal und der Geschwindigkeit als Tacho, drehende Lüfter, System als Kacheln. Diagramme über die Zeit sind ein eigenes Thema.
    - **3D-Ansicht:** eine Druckdatei vom Drucker (jeder Klipper-Drucker mit IP) oder vom Rechner in 3D, eingelesen in einem Web Worker (`pages/gcode-worker.js`), gezeichnet mit three.js über Instancing (`pages/druck3d.js`); die Datei kommt aus der Leiste oben, Einlesen und Folgen teilt sie mit der 2D-Ansicht (`pages/print-view.js`). Farben nach Filament oder Linienart, Schichtregler, Ansicht schräg oder von oben. Wie in OrcaSlicer die Achsen X, Y, Z an der Plattenecke; unten rechts ein Würfel wie FreeCADs NaviCube (Flächen, alle Kanten, Ecken anklickbar, `pages/view-cube.js`), links daneben die Knöpfe der Ansicht (Wunsch des Nutzers vom 24.09.2026). Folgt dem laufenden Druck (`virtual_sdcard.file_position`): Gedrucktes fest, der Rest als durchsichtige Hülle, dazu die Düse (beim U1 in der Farbe des arbeitenden Kopfs, mit Nummer). Nur lesend; „Dateien“ verlinkt jede Druckdatei hierher.
    - **2D-Ansicht:** dieselbe Datei, eine Schicht von oben, technischer (Wunsch des Nutzers): Farben auch nach Geschwindigkeit, Volumenstrom, Beschleunigung, Lüfter, Temperatur, Linienbreite; Fahrwege und Rückzüge; die Linien der Schicht einzeln durchgehen; zu jeder Linie ihre Werte und ihr G-Code (Teilabruf per Range). An der Seite Schicht (Zeit laut Slicer aus `M73 R`, Filament, Linienarten) und Datei (Slicer, Profile, Filament je Kopf, alle Einstellungen). Gedruckt, noch offen und die Schicht darunter klar unterscheidbar (der Nutzer). Canvas 2D, ohne WebGL (`pages/druck2d.js`).
    - **Dateien:** die Ordner jedes U1 mit IP-Adresse (Druckdateien, Zeitraffer, Logs, Einstellungen), nur lesbare gekennzeichnet. Druckdateien und Zeitraffer löschen (einzeln, Auswahl, alle), Druckdateien drucken mit den Optionen des Displays (Bett vermessen, Fluss, Schwingungen, Zeitraffer, Kopf je Filament). Befehle an einen Drucker nur auf Klick des Nutzers: Licht, Löschen, Druckstart, G-Code auf „Konsole“, oben in der Leiste Druckstart, Abbruch und Notstopp.
    - **Kamera:** Bild jedes U1 mit IP-Adresse samt Druckstatus (Fortschritt, Schicht, Restzeit), in der Seite, fensterfüllend oder im Vollbild; das Licht im Drucker ein- und ausschalten.
    - **Konsole:** G-Code an Klipper über Moonraker (`orcaone/console.py`), für jeden Klipper-Drucker mit IP, ohne SSH; Verlauf aus Moonrakers Speicher, Abfragen aus der Liste sofort, Befehle wie G28 nur eintragen.
    - **SSH:** SSH auf jeden Drucker mit IP-Adresse (xterm.js, paramiko), verlinkt von jeder Druckerkarte mit IP. Ein eingetipptes Passwort, sonst die Schlüssel des Rechners, beim U1 dann sein Standardpasswort „snapmaker“, sonst fragt die Seite; Passwörter werden nicht gespeichert. Eine Befehlsliste je Druckerart (U1: `/userdata`, Init-Skripte; sonst `~/printer_data`, systemd): Ansehen läuft sofort, Neustarts nur eintragen. Beim U1 muss Root Access an sein.
  - **Prozesse:** dieselbe Drucker- und Düsenwahl, nur zum Ansehen.
  - **Filamente:** Drucker wählen → Düse → Baum aus Eigene, Vom Hersteller und Orca-Bibliothek. Fehlt ein Filament an einer Düse, legt „Für andere Düse“ ein eigenes an (wie „An Drucker hängen“).
    - **Übertragen:** Profile zwischen zwei Installationen in beide Richtungen kopieren.
    - **Vergleichen:** zwei Filamente nebeneinander, auch aus zwei Installationen; welche Werte sich unterscheiden und woher sie kommen. Nur zum Ansehen.
    - **Kalibrieren:** nur für den U1: U1 und Düse wählen, dann ein passendes eigenes Filament; die Kalibrieranleitung des Nutzers als Liste zum Abhaken, liest den U1 live und nur lesend.
    - **Import/Export:** Profile aus Dateien holen (JSON, ZIP, `.orca_*`, Sicherungen, 3MF) und aus den Sicherungskopien des Slicers (`user_backup-v*`), vorher auswerten, auswählen, Filamente an einen Drucker hängen, umbenennen, über die Änderungsliste schreiben; eigene Profile als ZIP exportieren.
    - **Details:** alles zu einem Filament (Drucker, Düsen, Dateien, Vererbung, Werte).
  - **3MF bereinigen:** ein Schnellwerkzeug. 3MF hineinziehen, zurück kommt es als Download ohne Drucker, Prozess, Filamente und G-Code des Projekts, damit der Slicer keinen fremden Drucker anlegt.
  - **Slicer** (Datenordner):
    - **Sicherungen.**
    - **Änderungen:** was sich seit dem letzten „Als gesehen markieren“ geändert hat (Update, Anmeldung, Cloud-Abgleich), je Profil; was OrcaOne selbst schreibt, zählt als gesehen.
    - **Logs** (Logdateien der Slicer, nur lesen).
  - Unten im Menü zwei Schalter: Sprache (DE/EN) und hell/dunkel (`data/settings.json`, ohne Wahl Browser bzw. System).

  Details nur auf Anforderung im Seitenpanel. Kein zweites Orca bauen, sondern ein einfaches Filament-System für Normalos.
- **Plattformen:** Linux und Windows gleichwertig. Pfade nur mit `pathlib`.
- **Sprache:** Code, Bezeichner und Kommentare auf Englisch. Die Oberfläche gibt es auf Deutsch und Englisch: Texte in `orcaone/static/texts/de.js` und `en.js` mit denselben Schlüsseln, jeder neue Text in beide. Das Backend liefert Fehlercodes, keine Texte.
- **KISS:** wenige Schichten, keine Abstraktionen auf Vorrat. Keine Platzhalter, jede Datei ist nach jedem Schritt vollständig und lauffähig.
- **Tests:** pytest. Resolver und alle Schreiboperationen brauchen Tests gegen Fixtures. Fixtures entstehen mit `tests/fixtures/make_snorca_fixture.py`, anonymisiert.
- **Commits:** kleine Commits pro abgeschlossenem Schritt, aber nur auf Auftrag.
- **Phasenende:** Jede Phase endet mit lauffähiger App, grünen Tests, aktualisierter README und offenen Punkten. Danach anhalten und auf Feedback warten.
