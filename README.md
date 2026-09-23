# OrcaOne

OrcaOne ist eine lokale Web-App, mit der man die Profile von OrcaSlicer und Snapmaker Orca überblickt, aufräumt und zwischen beiden überträgt. OrcaOne läuft auf dem Rechner, auf dem auch der Slicer läuft, und ist nur dort erreichbar (127.0.0.1).

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

Windows: `orcaone.cmd` doppelklicken.

Beim ersten Start legen die Skripte die Python-Umgebung `.lenv` an und installieren die Abhängigkeiten aus `requirements.txt`. Dafür braucht es Python ab 3.11, unter Linux mit dem Paket `python3-venv`. Danach öffnet sich der Browser. Beenden mit Strg+C im Terminal.

Ohne Skript geht es so:

```bash
.lenv/bin/python -m orcaone
```

Optionen: `--port 8765` für einen festen Port, `--no-browser`, wenn der Browser nicht aufgehen soll.

## Eigene Daten

Alles, was OrcaOne selbst ablegt, liegt im Ordner `data/` im OrcaOne-Ordner:

- `settings.json`: alle Einstellungen, also von Hand hinzugefügte Datenordner, die Kameras samt Bildtakt, die Bibliotheksfilamente, die OrcaOne in Snapmaker Orca freigeschaltet hat, und die Sprache;
- `backups/<id>/`: die Sicherungen, nur für den Nutzer lesbar.

`data/` steht nicht im Git, denn die Sicherungen enthalten Zugangsdaten. Wer OrcaOne verschiebt, nimmt den Ordner mit. Daten älterer Versionen aus `~/.local/share/orcaone` bzw. `%LOCALAPPDATA%\orcaone` holt OrcaOne beim Start einmal hierher.

## Seiten

Links steht das Menü, oben die Wahl der Installation und „Neu einlesen“. Unten im Menü wählst du die Sprache, Deutsch oder English; ohne Wahl gilt die des Browsers.

- **Filamente:** erst die Drucker als Bilder, dann je Drucker die Düse, die aktiven Filamente als Spulen und der Baum aus „Eigene“, „Vom Hersteller“ und „Orca-Bibliothek“. Jede Zeile zeigt ihren Zustand: ausgegraut, teilweise an (halber Kreis) oder an (Haken). Ein- und ausschalten per Düse im Seitenpanel oder per Ziehen nach „Aktiv“, dazu „Bearbeiten“ und „Neues Filament“. Ein eigenes Filament, das bei keiner Düse mehr an ist, blendet OrcaOne im Slicer aus (`instantiation: "false"`), die Datei bleibt.
- **Prozesse:** dieselbe Druckerwahl, dann je Düse die Prozesse als Kacheln mit Schichthöhe und Art, der zuletzt im Slicer gewählte ist markiert. Ein Klick zeigt die wichtigsten Werte in fünf Gruppen, dazu „Alle Werte“. Nur zum Ansehen.
- **Übertragen:** zwei Installationen nebeneinander, links und rechts je eine Liste mit Suche und dem Schalter „Nur was drüben fehlt“. Filamente und Prozesse auswählen, auch mehrere oder eine ganze Gruppe, und mit dem Pfeil hinüberschieben. OrcaOne legt sie drüben als eigene Profile mit allen Werten an. Was nicht mitkommt, nennt „Das passiert“.
- **Drucker:** den Drucker festlegen, mit dem der Slicer startet, Drucker entfernen und dabei Filamente mitlöschen, die nur zu ihm gehören, veraltete Einträge der `.conf` aufräumen.
- **Kamera:** das Bild der Kamera des Snapmaker U1 mit Originalfirmware. Den Drucker einmal über seine Adresse hinzufügen. Solange die Seite offen und sichtbar ist, weckt OrcaOne die Kamera alle 10 Sekunden und holt das Bild alle 1 bis 10 Sekunden; der Takt wird gemerkt. Ein Klick aufs Bild zeigt es bildschirmfüllend.
- **Sicherungen:** alle Sicherungen mit Größe, Anlass und Gesamtgröße.
  - „Jetzt sichern“ legt sofort eine an.
  - „Löschen …“ fragt vorher nach.
  - „Wiederherstellen …“ zeigt erst „Das passiert“: was zurückkommt und was wegfällt.
- **Slicer** (unter „Technik“): alle Installationen, Hinweise, Platz, Ordnerbaum mit Erklärung je Ordner, Herstellerpakete, `.conf` und Datenordner von Hand hinzufügen oder entfernen.
- **Details** (unter „Technik“): ein Filament aus einer Liste mit Suche wählen und alles dazu sehen: Drucker und Düsen mit Status, die Vererbungskette bis zum Originalprofil, die Dateien, die `.info` und jeden Wert mit dem Profil, das ihn setzt. Das Seitenpanel auf „Filamente“ springt mit „Alle Details“ hierher.
- **Logs** (unter „Technik“): was der Slicer bei jedem Start in `<Datenordner>/log/` schreibt. Einen Start wählen, „Alles“, „Warnungen und Fehler“ oder „Nur Fehler“ zeigen, im Log suchen. Gezeigt werden die letzten 2000 Einträge und von einem Eintrag höchstens 2000 Zeichen; die Suche läuft über alles. Nur zum Ansehen.

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
| `orcaone/__main__.py` | Start: freier Port, Server, Browser |
| `orcaone/app.py` | FastAPI-App, API unter `/api`, Oberfläche unter `/`. `GET /api/data` liefert alle Seiten live. Schreiben über `POST /api/instances/{id}/plan` und `/apply`, Sicherungen über `/api/instances/{id}/backups` (Liste, anlegen, löschen, `…/{name}/restore-plan`), Logs über `/api/instances/{id}/logs`, Kameras über `/api/cameras`, Einstellungen wie die Sprache über `/api/settings` |
| `orcaone/operations.py` | Änderungen planen und schreiben (harte Regeln 2 bis 7): Plan mit Dateioperationen, Diff der `.conf` mit maskierten Zugangsdaten und Fingerabdruck von `.conf` und `user/` vor dem Planen; ein anderer Plan, der inzwischen lief, macht ihn veraltet. Beim Ausführen: Laufprüfung, Sicherung, erneute Laufprüfung, atomar schreiben und neu prüfen (sonst zurück auf die Sicherung), neu einlesen |
| `orcaone/transfer.py` | Profile in eine andere Installation übertragen: Werte ans Ziel anpassen nach `orcaone/options.json` (erzeugt aus dem Quellcode der Slicer mit `tools/make_options.py`) |
| `orcaone/backup.py` | ZIP-Sicherungen ohne `log/`, `cache/` usw., Liste, Löschen und was ein Wiederherstellen zurückschreibt |
| `orcaone/overview.py` | baut `GET /api/data`: je Installation Drucker, Filamente, Hinweise und die Seiten „Slicer“, „Drucker“, „Sicherungen“. Texte kommen als Codes |
| `orcaone/scanner.py` | liest `system/`, eigene Profile und den Ordnerbaum (nur lesend) |
| `orcaone/resolver.py` | Vererbung, Sichtbarkeit, Kompatibilität, Bibliotheks-Ausschluss |
| `orcaone/opc.py` | Leser für das `.opc`-Format der OrcaSlicer-Nightly |
| `orcaone/instances.py` | Installationen finden, manuelle Pfade |
| `orcaone/settings.py` | der Ordner `data/`: `settings.json` lesen und schreiben, alte Daten einmal umziehen |
| `orcaone/camera.py` | Kamera des U1: wecken über Moonrakers WebSocket, Bild holen |
| `orcaone/logs.py` | Logdateien der Slicer lesen, zählen und filtern (nur lesend) |
| `orcaone/guard.py` | Prüfen, ob ein Slicer läuft (nur lesend) |
| `orcaone/conf.py` | `.conf` byte-genau lesen und schreiben |
| `orcaone/model.py` | Dataclasses |
| `orcaone/static/` | Oberfläche: Vue 3 ohne Build-Schritt. `app.js` (Rahmen, Menü, Änderungsliste), `common.js` (Daten, Zustand, Symbole), `ops.js` (macht aus der Änderungsliste die `changes` für den Plan), `plan.js` („Das passiert“), `pages/` (eine Datei je Seite), `texts.js` (wählt die Sprache), `texts/de.js` und `texts/en.js` (alle Texte), `style.css`, Druckerbilder in `assets/` |
| `prototypes/opc/` | Prototyp für das `.opc`-Format, jetzt in `orcaone/opc.py` |
| `prototypes/U1Cam/` | Skript des Nutzers, Vorlage für die Seite „Kamera“ |
| `docs/` | Befunde (`FINDINGS.md`), Plan (`PLAN.md`), Arbeitsstand (`STAND.md`) |
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
