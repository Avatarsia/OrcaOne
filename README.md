# OrcaOne

OrcaOne ist eine lokale Web-App für OrcaSlicer und Snapmaker Orca, dazu mit Werkzeugen für den Snapmaker U1 und andere Klipper-Drucker.

**Slicer-Profile**
- Findet die Installationen auf Linux und Windows und zeigt übersichtlich, was drin ist und was sich seit dem letzten Mal geändert hat, etwa nach einem Update.
- Filamente je Drucker und Düse ein- und ausschalten, bearbeiten und neu anlegen, als Spulen in echten Farben statt als lange Listen.
- Profile zwischen OrcaSlicer und Snapmaker Orca übertragen und nebeneinander vergleichen.
- Import aus JSON, ZIP, `.orca_*`, 3MF und den Sicherungen des Slicers, dabei an den eigenen Drucker hängen und umbenennen; Export der eigenen Profile als ZIP.
- Aufräumen: alte Drucker und Einträge entfernen, fremde Drucker und Profile aus 3MF-Projekten entfernen.
- Sicher: OrcaOne schreibt nur bei geschlossenem Slicer und zeigt vorher genau, was passiert. Vor jeder Änderung legt es eine Sicherung an, die sich wiederherstellen lässt.

**Drucker**
- Übersicht und Status live: Druckfortschritt, Köpfe mit Spulen und Temperaturen, Lüfter, Position, System.
- Snapmaker U1: Kamera mit Licht, Dateien (Druckdateien und Zeitraffer löschen, Druck starten wie am Display) und ein Assistent fürs Kalibrieren von Filamenten.
- G-Code-Konsole und SSH im Browser, für jeden Klipper-Drucker.

**Sonst**
- Deutsch und Englisch, hell und dunkel. OrcaOne läuft lokal auf dem Rechner mit dem Slicer und ist nur dort erreichbar (127.0.0.1).

**Stand: Phase 1 (Übersicht) und der erste Teil von Phase 2 (Schreiben).** OrcaOne liest beide Slicer live ein und zeigt Drucker, Filamente, Sicherungen und die Datenordner. Die Oberfläche folgt dem Entwurf E2.

Änderungen schreibt OrcaOne direkt in die Datenordner der Slicer, aber nur, solange der Slicer geschlossen ist. Ablauf:

1. Plan mit „Das passiert“ anzeigen.
2. Nach „Übernehmen“ eine Sicherung anlegen.
3. Schreiben. Scheitert das mittendrin, kommen die berührten Dateien aus der Sicherung zurück.
4. Neu einlesen.

## Starten

Linux:

```bash
./orcaone.sh
```

Windows: `orcaone.cmd` doppelklicken. Den OrcaOne-Ordner dafür ins eigene Benutzerprofil legen, etwa `C:\Users\<Name>\OrcaOne`: Er muss beschreibbar sein (also nicht unter `C:\Programme`), nur du solltest ihn lesen können, und er gehört nicht in einen OneDrive-Ordner wie „Dokumente“ oder „Desktop“, denn die Sicherungen in `data/` enthalten Zugangsdaten. Bei „Im LAN suchen“ fragt die Windows-Firewall beim ersten Mal, ob Python im Netz empfangen darf: für private Netzwerke zulassen, sonst findet die Suche nichts.

Beim ersten Start legen die Skripte die Python-Umgebung `.lenv` an und installieren die Abhängigkeiten aus `requirements.txt`. Dafür braucht es Python ab 3.11, unter Linux mit dem Paket `python3-venv`. Danach öffnet sich der Browser. Beenden mit Strg+C im Terminal.

Ohne Skript geht es so:

```bash
.lenv/bin/python -m orcaone
```

OrcaOne lauscht auf `http://127.0.0.1:4711/`. Ein anderer Port geht mit `--port 8765`, ein freier mit `--port 0`. Hat ein anderes Programm 4711 belegt, nimmt OrcaOne einen freien. Läuft OrcaOne schon, öffnet ein zweiter Start nur ein Fenster. `--no-browser` startet ohne Browser.

Beim Start öffnet OrcaOne die Seite im Standardbrowser, und zwar möglichst wie eine App:

- Chrome, Chromium, Edge, Brave und Vivaldi zeigen sie als App-Fenster ohne Tabs und Adressleiste.
- Firefox und Opera öffnen ein neues Fenster.
- Andere Browser zeigen die Seite als neuen Tab.

OrcaOne hat ein eigenes Symbol und ein Web-App-Manifest und lässt sich damit im Browser als App installieren.

Per Symbol starten, als App installieren und OrcaOne selbst zu einem Programm bauen, das ohne Python läuft (Windows, Linux, macOS): [docs/STARTEN-UND-BAUEN.md](docs/STARTEN-UND-BAUEN.md).

## Eigene Daten

Alles, was OrcaOne selbst ablegt, liegt im Ordner `data/` im OrcaOne-Ordner:

- `settings.json`: alle Einstellungen, also von Hand hinzugefügte Datenordner, die IP-Adressen der Drucker samt Bildtakt der Kamera, die Bibliotheksfilamente, die OrcaOne in Snapmaker Orca freigeschaltet hat, die Sprache und die Häkchen der Seite „Kalibrieren“;
- `backups/<id>/`: die Sicherungen, nur für den Nutzer lesbar;
- `snapshots/<id>.json`: je Installation der Stand, mit dem die Seite „Änderungen“ vergleicht. Zugangsdaten stehen darin nur als Prüfsumme.

`data/` steht nicht im Git, denn die Sicherungen enthalten Zugangsdaten. Wer OrcaOne verschiebt, nimmt den Ordner mit. Daten älterer Versionen aus `~/.local/share/orcaone` bzw. `%LOCALAPPDATA%\orcaone` holt OrcaOne beim Start einmal hierher.

## Seiten

Links steht das Menü: Übersicht, Drucker, Prozesse, Filamente, 3MF bereinigen und Slicer, jeweils mit ihren Unterseiten. OrcaOne startet auf der „Übersicht“, das Symbol oben links führt dorthin zurück. Oben stehen die Wahl der Installation (der Datenordner als Tooltip), daneben der Drucker, mit dem OrcaOne arbeitet, und „Neu einlesen“. Den Drucker wählst du nur dort: Übersicht, Filamente, Prozesse, Kalibrieren, Status, Dateien, Kamera, Konsole und SSH nehmen ihn von oben. Beim Start ist es der Drucker, mit dem der Slicer startet; eine andere Installation behält ihn, wenn sie ihn auch hat. Kalibrieren, Dateien und Kamera stehen nur im Menü, solange oben ein U1 gewählt ist. Der Knopf ☰ oben links blendet das Menü aus und wieder ein; in einem schmalen Fenster klappt er es über die Seite. Unten im Menü zwei Schalter: die Sprache (DE oder EN) und hell oder dunkel. Beides merkt sich OrcaOne in `data/settings.json`; ohne Wahl gilt die Sprache des Browsers und das Design des Systems.

- **Übersicht:** die Startseite, als Bild statt als Werteliste. Oben der gewählte Drucker mit Bild, IP-Adresse und, wenn er eine hat, seinem Zustand alle 5 Sekunden, bei einem Druck mit Fortschritt, Schicht und Restzeit. Daneben seine Köpfe als eigene Zeichnung: über jedem die Spule in ihrer Farbe (beim U1), das Filament läuft hinein, darunter Temperatur und Material; die Düse glüht orange, solange sie heiß ist, und im Druck sitzt der arbeitende Kopf tiefer, als wäre er aufgenommen. Darunter das Bett, das beim Heizen orange wird, dazu Bauraum und Licht. Knöpfe zu Status, Kamera, Dateien, Konsole, SSH und Weboberfläche. Darunter Kacheln mit großer Zahl: Filamente (sichtbar bei der gewählten Düse, die eigenen als Spulen, dazu Import/Export, Kalibrieren, Übertragen), Prozesse, Sicherungen, Änderungen seit dem letzten Mal; die ganze Kachel führt zur Seite. „3MF bereinigen“ zum Hineinziehen und unten die Installationen mit Zustand.
- **Drucker:** den Drucker festlegen, mit dem der Slicer startet, Drucker entfernen und dabei Filamente mitlöschen, die nur zu ihm gehören, veraltete Einträge der `.conf` aufräumen. Auf jeder Karte die IP-Adresse des Druckers: selbst eingetragen oder aus dem Dialog „Physischer Drucker“ des Slicers (`print_host` eines eigenen Druckerprofils); fehlt sie, steht dort „Keine IP-Adresse“. Die Karte eines U1 kann ihn auch im LAN suchen, wie Snapmaker Orca es tut (mDNS, etwa 6 Sekunden, nur im selben LAN, nicht über VPN); ein Treffer geht mit „Übernehmen“ hinein. Kamera und Kalibrieren nehmen die Adresse von hier. Hat ein Drucker eine Adresse, zeigt seine Karte, was er über sich sagt, nur lesend über Moonraker und bei jedem Klipper-Drucker: Zustand (alle 10 Sekunden), Firmware, Speicher und Drucke insgesamt, Einzelheiten im Tooltip. Ein U1 zeigt dazu seinen Namen, die Snapmaker-Firmware und je Kopf Düse und Spule; dazu Links zur Weboberfläche, zum Status, zu den Dateien, zur Kamera, zur Konsole und zu SSH.
- **Status** (unter „Drucker“): was der Drucker gerade tut, alle 2 Sekunden neu gelesen und nur lesend, bei jedem Klipper-Drucker mit IP-Adresse (Moonrakers REST-API), als Bild statt als Tabelle. Oben der Druck als Ring mit Datei, Schicht, Restzeit, Druckzeit, Filament, Geschwindigkeits- und Flussfaktor, daneben die Köpfe wie auf der Übersicht, hier je Kopf mit Düse, Pressure Advance, Kopfwechseln, Fehlern und Filamentsensor. Darunter die Temperaturen als Balken mit Sollmarke und Heizleistung (Sensoren mit ihrem Tiefst- und Höchstwert), die Druckplatte von oben mit dem Kopf darauf (X und Y an seinen Linien, der Bereich hinter der Platte, wo der U1 seine Köpfe parkt, blass), die Höhe als Lineal, die Geschwindigkeit als Tacho bis zum Höchstwert des Druckers und der Durchfluss, die Lüfter, die sich mit ihrer Leistung drehen, weitere Filamentsensoren und das System im Drucker als Kacheln (Klipper, Prozessor, Temperatur, Arbeitsspeicher, Netzwerk, Laufzeit). Beim U1 dazu die Optionen des Displays für den Druck und ob das Licht an ist. Diagramme über die Zeit gibt es noch nicht.
- **Dateien** (unter „Drucker“): die Ordner jedes U1 mit IP-Adresse: Druckdateien mit Vorschaubild, Druckzeit und Filamentfarben, Zeitraffer-Videos, Logs und Einstellungen. Logs und Einstellungen zeigt der U1 nur, das steht dabei. Druckdateien und Zeitraffer lassen sich löschen, einzeln, mehrere oder alle; die Videos über Snapmakers Kameradienst, damit auch seine Liste stimmt. Eine Druckdatei druckt „Drucken“ mit den Optionen des Displays: Bett vermessen, Fluss kalibrieren, Schwingungen messen, Zeitraffer aufnehmen, dazu welcher Kopf welches Filament druckt. Öffnen, Abspielen und Herunterladen gehen über OrcaOne. Befehle an den Drucker schickt OrcaOne nur auf deinen Klick.
- **Kamera** (unter „Drucker“): das Bild jedes Snapmaker U1 mit Originalfirmware, der unter „Drucker“ eine IP-Adresse hat. Solange die Seite offen und sichtbar ist, weckt OrcaOne die Kamera alle 10 Sekunden und holt das Bild alle 1 bis 10 Sekunden; der Takt wird gemerkt. Unter dem Bild steht alle 5 Sekunden der Druckstatus: Zustand, Datei, Fortschritt, Schicht, Restzeit (Schätzung des Slicers minus bisherige Druckzeit). Drei Ansichten wie bei YouTube: in der Seite, fensterfüllend und Vollbild. In den großen blendet sich die Leiste nach 3 Sekunden ohne Mausbewegung aus, die Zeile mit dem Druckstatus und der Fortschrittsbalken unten bleiben. Esc führt zurück. Ist das Licht im Drucker aus, bleibt das Bild schwarz; die Seite sagt das und schaltet es auf Knopfdruck ein und aus (`SET_LED`).
- **Konsole** (unter „Drucker“): G-Code direkt an Klipper, über Moonraker und ohne SSH, bei jedem Klipper-Drucker mit IP; jede Druckerkarte mit IP hat einen Link. Der Verlauf zeigt Befehle und Antworten mit Uhrzeit, auch die anderer Programme wie Mainsail; Fehler rot, eigene Befehle fett, Pfeil hoch und runter holt frühere Befehle zurück. Abfragen wie STATUS, M115, GET_POSITION oder BED_MESH_OUTPUT gehen aus der Liste sofort ab, Befehle wie G28 landen nur in der Eingabezeile. Vor jedem Befehl leert sich die Anzeige, „Leeren“ tut das von Hand.
- **SSH** (unter „Drucker“): eine Kommandozeile über SSH auf jedem Drucker mit IP-Adresse, etwa jedem Klipper-Drucker (xterm.js im Browser, paramiko in OrcaOne); jede Druckerkarte mit IP hat dafür einen Link. Ein eingetipptes Passwort nimmt OrcaOne direkt. Ohne versucht es erst die SSH-Schlüssel des Rechners, beim U1 dann sein Standardpasswort „snapmaker“, und fragt sonst nach. Passwörter werden nicht gespeichert. Über dem Terminal liegt eine Liste nützlicher Befehle, eigene für den U1 und für andere Klipper-Drucker, in Gruppen: Dateien (Druckdateien, Zeitraffer, was Platz belegt), Drucker und Klipper (Bettnetz als Raster, Input Shaper, Pressure Advance, Fehler und Logs, auch live), System (Speicher, Temperatur, Prozesse, htop) und Netzwerk (IP, WLAN-Signal, Gateway, DNS, Internet, Ports). Diese laufen sofort; vorher leert sich die Anzeige, dann stehen nur Aufruf und Ergebnis im Terminal. „Leeren“ tut das jederzeit von Hand. Klipper, Moonraker oder den Drucker neu starten trägt die Liste nur ein, Enter drückst du selbst. Der Benutzer ist beim U1 `root`, sonst `pi`. Beim U1 muss am Touchscreen Root Access an sein. Sein Schlüssel wird nach jedem Neustart neu erzeugt; die Seite zeigt ihn an, merkt ihn sich aber nicht.
- **Prozesse:** dieselbe Druckerwahl, dann je Düse die Prozesse als Kacheln mit Schichthöhe und Art, der zuletzt im Slicer gewählte ist markiert. Ein Klick zeigt die wichtigsten Werte in fünf Gruppen, dazu „Alle Werte“. Nur zum Ansehen.
- **Filamente:** für den oben gewählten Drucker die Düse, die aktiven Filamente als Spulen und der Baum aus „Eigene“, „Vom Hersteller“ und „Orca-Bibliothek“. Jede Zeile zeigt ihren Zustand: ausgegraut, teilweise an (halber Kreis) oder an (Haken). Ein- und ausschalten per Düse im Seitenpanel oder per Ziehen nach „Aktiv“, dazu „Bearbeiten“ und „Neues Filament“. Ein eigenes Filament, das bei keiner Düse mehr an ist, blendet OrcaOne im Slicer aus (`instantiation: "false"`), die Datei bleibt. Fehlt ein Filament an einer Düse, weil der Hersteller es nur für eine andere liefert (etwa „Polymaker General PLA Family @U1“ nur für 0,4 mm), legt „Für andere Düse“ im Seitenpanel ein eigenes an: Kind des Filaments dieser Düse mit demselben Material, mit den Werten des Materials, wie „An Drucker hängen“ beim Import.
- **Übertragen** (unter „Filamente“): zwei Installationen nebeneinander, links und rechts je eine Liste mit Suche und dem Schalter „Nur was drüben fehlt“. Filamente und Prozesse auswählen, auch mehrere oder eine ganze Gruppe, und mit dem Pfeil hinüberschieben. OrcaOne legt sie drüben als eigene Profile mit allen Werten an. Was nicht mitkommt, nennt „Das passiert“.
- **Vergleichen** (unter „Filamente“): zwei Filamente nebeneinander, jedes aus einer eigenen Liste mit Suche und auf Wunsch aus einer anderen Installation, etwa ein eigenes Profil und sein Original oder dasselbe Filament in OrcaSlicer und Snapmaker Orca. Die Tabelle zeigt die Werte, die sich unterscheiden, mit dem Profil, das sie setzt; „Gleiche Werte auch zeigen“ zeigt alle. „1.0“ und „1“ gelten als gleich. Nur zum Ansehen.
- **Kalibrieren** (unter „Filamente“): nur für den Snapmaker U1. Oben den U1 und die Düse wählen, dann ein eigenes Filament, das dazu passt. Die Anleitung zum Kalibrieren eines Filaments auf dem U1 als Liste zum Abhaken: Trocknen, Temperatur, Flow, Pressure Advance, Max. Durchfluss, Retraction, Shrinkage, dazu die Schritte einmal pro Drucker. Rechenhilfen je Schritt, etwa Flow + Wert des besten Felds oder die Retraction-Länge aus der gemessenen Höhe. „Eintragen“ merkt den Wert für das eigene Filament vor, „Übernehmen“ schreibt ihn wie jede Änderung. Ist der U1 unter „Kamera“ eingetragen, liest die Seite ihn alle 5 Sekunden, nur lesend: Spule je Kopf samt RFID-Daten und den Pressure-Advance-Wert je Kopf, ob gemessen oder rund. Ändert sich die Temperatur nach dem Abhaken, verlangt sie Flow und Pressure Advance neu. Aus dem Seitenpanel auf „Filamente“ führt „Kalibrieren“ hierher.
- **Import/Export** (unter „Filamente“): Profile aus einer Datei holen und eigene als ZIP speichern.
  - **Importieren:** OrcaOne liest ein Profil-JSON, eine ZIP mit Profilen (Export-Dialog des Slicers, Export von OrcaOne, Herstellerpakete), die Profilpakete `.orca_filament`, `.orca_printer` und `.orca_bundle`, eine Sicherung von OrcaOne oder einen Datenordner als ZIP und ein 3MF-Projekt. Ohne Datei geht es aus den Sicherungskopien des Slicers: Beim ersten Start jeder neuen Version kopiert er `user/` nach `user_backup-v<Version>`, die Seite listet diese Ordner und liest einen davon ein. Aus dem 3MF kommen die eingebetteten eigenen Profile und die Änderungen an Systemprofilen, die das Projekt nie gespeichert hat. Dazu zeigt die Seite, was das Projekt nutzt, mit seinen Werten und Farben, und was hier dazu passt: Drucker mit derselben Düse, deren Prozesse mit derselben Schichthöhe, Filamente mit demselben Namen. „Was ein Import braucht“ erklärt, woran ein Import scheitern kann.
  - **Vorher auswerten:** Je Profil zeigt die Seite, was ein Import hier täte: neu, schon da, Systemprofil (gibt es hier), Name vergeben (dann als Kopie oder ersetzen), Elternprofil fehlt, kein passender Drucker. Was schon da ist, lässt sich nicht anhaken, eine Kopie würde es nur doppeln; ausgeblendete eigene Profile zählen dabei mit. Dazu kommen das Elternprofil, die passenden Drucker und die wichtigsten Werte. Vorlagen eines Herstellerpakets gehen in die Profile ein, die darauf aufbauen.
  - **Schreiben:** Was du anhakst, kommt in die Änderungsliste, „Übernehmen“ schreibt es mit Plan und Sicherung. Ein Profil wird Kind seines Elternprofils, wenn es das hier gibt, sonst ein Wurzelprofil mit allen Werten. Druckern fehlen danach Adresse und Zugangsdaten.
  - **An Drucker hängen:** Ein Filament, etwa eines für einen anderen Drucker, lässt sich an einen deiner Drucker hängen. Es wird dann ein Kind eines Filaments dieses Druckers mit demselben Material (zuerst „Generic …“) und übernimmt aus der Datei nur die Werte des Materials: Temperaturen, Flow, max. Durchfluss, Lüfter, Hersteller, Dichte, Preis und Ähnliches. Alles, was zur Maschine gehört, etwa Start-G-Code und Rückzug, kommt vom Drucker. Das geht bei jeder Quelle.
  - **Name:** Jedes Profil lässt sich vor dem Vormerken umbenennen. Ist der Name vergeben, hängt der Plan „(2)“ an.
  - **Exportieren:** eigene Filamente, Prozesse und Drucker, wie im Slicer oder vollständig ohne Elternprofil. Die ZIP importiert der Slicer mit „Konfigurationen importieren“.
- **Details** (unter „Filamente“): ein Filament aus einer Liste mit Suche wählen und alles dazu sehen: Drucker und Düsen mit Status, die Vererbungskette bis zum Originalprofil, die Dateien, die `.info` und jeden Wert mit dem Profil, das ihn setzt. Das Seitenpanel auf „Filamente“ springt mit „Alle Details“ hierher.
- **3MF bereinigen:** ein 3MF hineinziehen, zurück kommt es als Download „<Name> (bereinigt).3mf“, ohne Drucker, Prozess, Filamente und G-Code seines Projekts. So öffnet der Slicer es mit deinem Drucker und legt keinen fremden an, der danach in der `.conf` hängen bleibt. Modell, Platten und Bemalung bleiben, die Farben kommen von deinen Filamenten. Braucht keine Installation und schreibt nichts außer dem Download.
- **Slicer:** alle Installationen, Hinweise, Platz, Ordnerbaum mit Erklärung je Ordner, Herstellerpakete, `.conf` und Datenordner von Hand hinzufügen oder entfernen.
- **Sicherungen** (unter „Slicer“): alle Sicherungen mit Größe, Anlass und Gesamtgröße.
  - „Jetzt sichern“ legt sofort eine an.
  - „Löschen …“ fragt vorher nach.
  - „Wiederherstellen …“ zeigt erst „Das passiert“: was zurückkommt und was wegfällt.
- **Änderungen** (unter „Slicer“): was sich in der gewählten Installation geändert hat, seit du zuletzt „Als gesehen markieren“ gewählt hast. Etwa ein Update des Slicers, eine Anmeldung (dann liest der Slicer eigene Profile aus einem anderen Ordner), ein Cloud-Abgleich oder Speichern im Slicer. Die Seite zeigt eigene Profile (neu, geändert mit den geänderten Werten, entfernt), Drucker in der Auswahl, die Liste der sichtbaren Filamente, Herstellerpakete und Herstellerprofile. Änderungen, die der Slicer von sich aus macht, erklärt sie, etwa „nur die Versionsnummer“. Was OrcaOne selbst schreibt, zählt als gesehen. Die Zahl im Menü nennt die Änderungen. Den ersten Stand legt OrcaOne an, wenn es eine Installation zum ersten Mal einliest.
- **Logs** (unter „Slicer“): was der Slicer bei jedem Start in `<Datenordner>/log/` schreibt. Einen Start wählen, „Alles“, „Warnungen und Fehler“ oder „Nur Fehler“ zeigen, im Log suchen. Gezeigt werden die letzten 2000 Einträge und von einem Eintrag höchstens 2000 Zeichen; die Suche läuft über alles. Nur zum Ansehen.

Alles Ändernde landet in der Änderungsliste unten. So wird daraus eine Änderung am Slicer:

1. „Übernehmen …“ in der Leiste unten holt den Plan.
2. Das Seitenpanel zeigt „Das passiert“:
   - jede Datei, die neu entsteht, sich ändert, umbenannt oder gelöscht wird;
   - die Änderungen an der `.conf` in Worten, etwa „SUNLU PLA+ wird sichtbar“;
   - Hinweise;
   - bei einem Stopp den Grund und was zu tun ist.
3. Erst „Übernehmen“ im Seitenpanel schreibt. Davor sichert OrcaOne den Datenordner, danach liest es ihn neu ein.

Eine Liste der Änderungen kommt nur dazwischen, wenn Änderungen an mehreren Installationen vorgemerkt sind oder OrcaOne gerade nicht schreiben darf, etwa weil der Slicer läuft. Dann sagt sie, warum.

## Was OrcaOne kann

- Installationen finden:
  - Linux: `~/.config` bzw. `$XDG_CONFIG_HOME`, Flatpak und portable AppImages (`<Datei>.AppImage.config`);
  - Windows: `%APPDATA%`;
  - macOS: `~/Library/Application Support`;
  - dazu Slicer, die gerade mit `--datadir` laufen.
- Datenordner von Hand hinzufügen und wieder entfernen. Die Liste steht in `data/settings.json`.
- Herstellerpakete aus JSON und aus `.opc` (OrcaSlicer-Nightly) lesen, eigene Profile samt `.info`, die Bundles von OrcaSlicer main.
- Vererbung, Sichtbarkeit und Kompatibilität so auflösen wie der Slicer. Dazu gehört auch, welche Bibliotheksprofile ein Herstellerprofil verdrängt.
- Hinweise geben, etwa zu verwaisten eigenen Profilen, zu versteckten Bibliotheksprofilen in Snapmaker Orca und zu toten Einträgen in `orca_presets`.
- Erkennen, ob der Slicer läuft. Dann heißt es „Läuft – nur ansehen“ samt Grund, und alle ändernden Knöpfe sind aus.
- Schreiben, nur bei geschlossenem Slicer:
  - Filamente sichtbar machen oder ausblenden (Liste `"filaments"`, nie leer);
  - Bibliotheksfilamente in Snapmaker Orca für alle Düsen (Weg A) oder für einzelne Düsen über ein eigenes Hilfsprofil (Weg B, FINDINGS 4.7);
  - eigene Filamente anlegen, ändern, umbenennen (samt `inherits` der Kinder und `orca_presets`) und löschen;
  - Standarddrucker festlegen, Drucker entfernen, tote `orca_presets`-Einträge aufräumen.
- Vor jedem Schreiben eine ZIP-Sicherung in `data/backups/<id>/`, nur für den Nutzer lesbar. Lässt sich ein Ordner nicht lesen, legt OrcaOne keine Sicherung an und schreibt nichts. Wiederherstellen schreibt `.conf` und `user/` zurück, vorher sichert OrcaOne den jetzigen Stand. Das geht auch, wenn die `.conf` beschädigt ist; alle anderen Änderungen sperrt OrcaOne dann.
- Nie über Symlinks schreiben: Ein Ordner in `user/`, der ein Symlink ist, fehlt in der Sicherung. Änderungen dort sperrt OrcaOne (`path_outside_backup`).
- Profilpakete von OrcaSlicer 2.5 (`_local/`, `_subscribed/`) stehen unter „Aus Paketen“, gruppiert nach Paket und ohne den internen Vorsatz `_local/<id>/`. Ändern, löschen oder als Vorlage nehmen lassen sie sich nicht, das bleibt OrcaSlicer vorbehalten. Einen Drucker aus einem Paket kann man als Standard wählen.
- Meldet, wenn der Einrichtungsassistent ein freigeschaltetes Bibliotheksfilament wieder ausgeblendet hat („Freischaltung verloren“), auf „Filamente“ und unter „Slicer“ → „Hinweise“.
- Hell- und Dunkelmodus folgen der Systemeinstellung.

## Manuell testen

1. OrcaOne starten. Unter „Filamente“ erscheinen die Drucker beider Installationen.
2. Einen Drucker anklicken, etwa den U1, und eine Düse wählen. „Aktiv“ zeigt dieselben Filamente wie die Auswahl im Slicer (Vergleich nach `docs/TEST-VERGLEICH.md`, Teil A).
3. Ein Filament einschalten. Unten erscheint „1 Änderung“. „Übernehmen …“ zeigt „Das passiert“, „Übernehmen“ schreibt. Läuft der Slicer, zeigt „Übernehmen …“ nur die Liste mit dem Grund. „Verwerfen“ stellt den Stand wieder her.
4. Unter „Drucker“ „Als Standard“ oder „Entfernen“ wählen. Beides erscheint ebenfalls in der Änderungsliste. Die Seite „Filamente“ zeigt einen entfernten Drucker nicht mehr an.
5. Unter „Sicherungen“ „Jetzt sichern“ klicken. Die Sicherung erscheint sofort in der Liste, samt Größe. Sichern darf OrcaOne jede Installation, weil es dabei nur liest.
6. Schreiben: siehe `docs/TEST-VERGLEICH.md`, Teil B, mit der Klickfolge je Schritt.
7. Unter „Slicer“ eine Kopie eines Datenordners hinzufügen, zum Beispiel nach `cp -r ~/.config/Snapmaker_Orca /tmp/snorca-kopie`. Sie erscheint als „Von Hand hinzugefügt“ und lässt sich mit „Entfernen“ wieder entfernen. Dabei wird nur der Eintrag in OrcaOne gelöscht, nicht der Ordner. Ein falscher Ordner, etwa der Home-Ordner, ergibt eine Fehlermeldung, die sagt, was zu tun ist.
8. Einen Slicer starten und „Neu einlesen“ klicken. Die Installation heißt dann „Läuft – nur ansehen“, die Seiten nennen den Grund. Den Slicer beenden und wieder neu einlesen.
9. OrcaOne im Terminal beenden und „Neu einlesen“ klicken. Es erscheint „OrcaOne antwortet nicht …“. Nach einem Neuladen der Seite steht dort, was zu tun ist, samt „Erneut versuchen“.
10. Prüfen, dass „Verwerfen“ nichts schreibt: `ls -l --time-style=full-iso ~/.config/Snapmaker_Orca/Snapmaker_Orca.conf` vor und nach Schritt 4 vergleichen.
11. Die Systemeinstellung zwischen hell und dunkel wechseln. OrcaOne zieht mit.

## Tests

```bash
.lenv/bin/python -m pytest
```

Die Tests laufen nur gegen die Fixtures in `tests/fixtures/` und gegen temporäre Ordner, nie gegen echte Slicer-Daten.

- `tests/test_operations.py` und `tests/test_backup.py` prüfen jede Änderung und die Sicherungen auf Kopien der Fixtures.
- `tests/test_writes_e2e.py` spielt Teil B aus `docs/TEST-VERGLEICH.md` per HTTP durch, vom Einschalten bis zum Wiederherstellen. Am Ende ist die Kopie Byte für Byte wie am Anfang.

## Aufbau

| Pfad | Inhalt |
|---|---|
| `orcaone/__main__.py` | Start: Port 4711, Server, Browser; ein zweiter Start öffnet nur ein Fenster |
| `orcaone/browser.py` | die Seite als App-Fenster bzw. neues Fenster des Standardbrowsers |
| `orcaone/app.py` | FastAPI-App, API unter `/api`, Oberfläche unter `/`. `GET /api/data` liefert alle Seiten live. Schreiben über `POST /api/instances/{id}/plan` und `/apply`, Sicherungen über `/api/instances/{id}/backups` (Liste, anlegen, löschen, `…/{name}/restore-plan`), Logs über `/api/instances/{id}/logs`, Häkchen der Kalibrierung über `/api/instances/{id}/calibration`, IP-Adressen über `/api/printers` (Suche im LAN: `POST /api/printers/search`), Kameras und der Status des U1 über `/api/cameras`, Import und Export über `/api/instances/{id}/import` (die Datei als Body), `/import/slicer-backups` und `/import/slicer-backup` (Sicherungskopien des Slicers) und `/export`, 3MF bereinigen über `/api/clean-3mf`, „Änderungen“ über `/api/instances/{id}/news` (`…/news/seen` merkt den Stand), Einstellungen wie die Sprache über `/api/settings` |
| `orcaone/operations.py` | Änderungen planen und schreiben (harte Regeln 2 bis 7): Plan mit Dateioperationen, Diff der `.conf` mit maskierten Zugangsdaten und Fingerabdruck von `.conf` und `user/` vor dem Planen; ein anderer Plan, der inzwischen lief, macht ihn veraltet. Beim Ausführen: Laufprüfung, Sicherung, erneute Laufprüfung, atomar schreiben und neu prüfen (sonst zurück auf die Sicherung), neu einlesen |
| `orcaone/transfer.py` | Profile in eine andere Installation übertragen: Werte ans Ziel anpassen nach `orcaone/options.json` (erzeugt aus dem Quellcode der Slicer mit `tools/make_options.py`) |
| `orcaone/backup.py` | ZIP-Sicherungen ohne `log/`, `cache/` usw., Liste, Löschen und was ein Wiederherstellen zurückschreibt |
| `orcaone/overview.py` | baut `GET /api/data`: je Installation Drucker, Filamente, Hinweise und die Seiten „Slicer“, „Drucker“, „Sicherungen“. Texte kommen als Codes |
| `orcaone/scanner.py` | liest `system/`, eigene Profile und den Ordnerbaum (nur lesend) |
| `orcaone/resolver.py` | Vererbung, Sichtbarkeit, Kompatibilität, Bibliotheks-Ausschluss |
| `orcaone/opc.py` | Leser für das `.opc`-Format der OrcaSlicer-Nightly |
| `orcaone/instances.py` | Installationen finden, manuelle Pfade |
| `orcaone/settings.py` | der Ordner `data/`: `settings.json` lesen und schreiben, alte Daten einmal umziehen |
| `orcaone/camera.py` | Der U1 im Netz: Kamera wecken über Moonrakers WebSocket, Bild holen, Druckstatus, Spulen und Pressure Advance lesen; für jeden Klipper-Drucker die Karte auf „Drucker“ |
| `orcaone/monitor.py` | Seite „Status“: was ein Klipper-Drucker gerade tut, in einem Rutsch über Moonrakers REST-API (nur lesend) |
| `orcaone/printer_files.py` | Seite „Dateien“: Ordner des U1, Druckdateien und Zeitraffer löschen, Druck starten |
| `orcaone/console.py` | Seite „Konsole“: G-Code über Moonraker, Verlauf aus Moonrakers Speicher |
| `orcaone/ssh.py` | Seite „SSH“: SSH mit paramiko, über einen WebSocket an xterm.js im Browser |
| `orcaone/snapshot.py` | Seite „Änderungen“: Schnappschuss je Installation in `data/snapshots/`, Vergleich je Profil |
| `orcaone/importer.py` | Seite „Import/Export“: Dateien lesen (JSON, ZIP, `.orca_*`, Sicherungen, 3MF), vorher auswerten, eigene Profile als ZIP; Seite „3MF bereinigen“ |
| `orcaone/calibration.py` | Häkchen der Seite „Kalibrieren“ |
| `orcaone/logs.py` | Logdateien der Slicer lesen, zählen und filtern (nur lesend) |
| `orcaone/guard.py` | Prüfen, ob ein Slicer läuft (nur lesend) |
| `orcaone/conf.py` | `.conf` byte-genau lesen und schreiben |
| `orcaone/model.py` | Dataclasses |
| `orcaone/static/` | Oberfläche: Vue 3 ohne Build-Schritt. `app.js` (Rahmen, Menü, Änderungsliste), `common.js` (Daten, Zustand, Symbole), `ops.js` (macht aus der Änderungsliste die `changes` für den Plan), `plan.js` („Das passiert“), `pages/` (eine Datei je Seite, dazu `filament-editor.js` und die Filamentwahl `filament-picker.js`), `texts.js` (wählt die Sprache), `texts/de.js` und `texts/en.js` (alle Texte), `style.css`, `manifest.json` (Web-App), Druckerbilder und das App-Symbol in `assets/` |
| `tools/build.py` | OrcaOne mit PyInstaller zu einem Programm ohne Python bauen |
| `tools/make_icons.py` | das eigene App-Symbol: zeichnet es als SVG, PNG und ICO |
| `prototypes/opc/` | Prototyp für das `.opc`-Format, jetzt in `orcaone/opc.py` |
| `prototypes/U1Cam/` | Skript des Nutzers, Vorlage für die Seite „Kamera“ |
| `docs/` | Befunde (`FINDINGS.md`), Plan (`PLAN.md`), Arbeitsstand (`STAND.md`), Ideen (`IDEEN.md`), Import-Quellen, Recherche, Test-Vergleich, Starten und Bauen |
| `ORCAONE_SPEC.md` | Spezifikation |

Die Entwürfe D, E und E2 liegen nur noch in der Git-Geschichte, zuletzt in Commit `deee0f2` unter `prototypes/ui-overview/`.

## Offene Punkte

- **Sichtprüfung im Browser fehlt** für „Das passiert“, die Meldungen nach dem Schreiben und die Seite „Sicherungen“. Die Abläufe sind nur mit dem echten Seitencode ohne Browser durchgespielt.
- **Praxistest Teil B mit SnOrca steht aus.** Er läuft nach `docs/TEST-VERGLEICH.md` direkt im echten Ordner. Ohne SnOrca liefen die Schritte schon auf einer Kopie des echten Ordners, geprüft mit dem Resolver von OrcaOne: alles wie erwartet.
- **`version` neuer Profile** kommt aus der Slicerversion (2.4.0 bzw. 2.5.0). SnOrca übernimmt beim Speichern die Version der Vorlage. Laut Quellcode zählt nur gültiges Semver, am Slicer ist das noch nicht geprüft.
- **Zeichenkette oder Liste:** OrcaOne schreibt einen Wert so, wie der geerbte Wert aussieht, weil die Optionsdefinitionen fehlen. Bei zwei Werten (High Flow) ersetzt ein einzelner Wert nur den ersten.
- **Pläne leben nur im Speicher.** Nach einem Neustart von OrcaOne heißt es „Plan abgelaufen“, dann einfach neu planen.
- **Neues Filament auf einem eigenen:** Es baut auf dessen Vorlage auf und übernimmt nur die Werte aus dem Formular, keine anderen eigenen Werte der Quelle.
- **Weg-B-Name:** Das Hilfsprofil heißt „<Kurzname> @<Druckermodell>“. Der Plan zeigt den Namen, ändern lässt er sich nicht.
- **Verweise in `orca_presets`** auf mitgelöschte Prozesse bleiben stehen.
- **Temporäre Datei der `.conf`:** Beim atomaren Schreiben liegt kurz `.orcaone-<pid>.tmp` im Datenordner.
- **Namen** eigener Profile dürfen höchstens 120 Zeichen lang sein. Ob lange Pfade unter Windows (MAX_PATH) trotzdem stören, ist ungeprüft.
- **Rohe Dateinamen in Sicherungen** (Namen, die kein gültiges UTF-8 sind) nutzen die private Methode `zipfile.ZipInfo._encodeFilenameFlags`, geprüft mit Python 3.14.
- **„Neu einlesen“ verwirft die Änderungsliste**, weil sie sich auf den alten Stand bezieht. OrcaOne sagt es in der Meldung danach.
- **Schnappschuss „Neu seit dem letzten Scan“** (PLAN 1.4) fehlt noch.
- **Windows ist bisher nur mit nachgebauten Dateien getestet.** Die `.conf` mit Prüfsummenzeile ist synthetisch. Bitte vom Windows-Rechner eine echte `Snapmaker_Orca.conf` bzw. `OrcaSlicer.conf` besorgen. Vorher `devices` bzw. `local_machines` leeren, weil dort Zugangsdaten stehen. Außerdem einmal `orcaone.cmd` starten. Schreiben unter Windows ist ungetestet: CRLF in Profilen folgt der `.conf`, beim Wiederherstellen löscht OrcaOne erst und schreibt dann, damit Namen, die sich nur in der Groß- und Kleinschreibung unterscheiden, nicht verloren gehen.
- **Flatpak ist ungetestet**, auf diesem Rechner gibt es keins.
- **Das Formular „Datenordner hinzufügen“** reagierte im Test-Browser der App nicht auf die Enter-Taste, nur auf den Knopf. In einem normalen Browser bitte kurz prüfen.
- **Vom Backend nicht nachgeprüft:** Den Druckernamen nach „@“ bei eigenen Wurzel-Filamenten setzt OrcaOne für jede OrcaSlicer-Version ein, geprüft ist das nur im Code von Orca main. Versionen wie „2.5.0-dev“ gelten als gültig, ohne Abgleich mit `semver.c`.
- **„Status“ bei einem normalen Klipper-Drucker** ist nur mit einem nachgebauten Moonraker getestet, am echten Gerät nur mit dem U1. Den Durchfluss rechnet die Seite mit 1,75 mm Filament.
