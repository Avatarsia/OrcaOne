# Test: SnOrca gegen OrcaOne

Entwurf vom 22.09.2026. Ziel: prüfen, ob OrcaOne genau das zeigt, was SnOrca zeigt, und ob eine Änderung in OrcaOne im Slicer genau so ankommt wie angekündigt.

**Grundregel:** Getestet wird direkt im echten Ordner `~/.config/Snapmaker_Orca`, SnOrca startet ganz normal. Auf diesem Rechner ist SnOrca nur eine Testinstallation, und vor jeder Änderung legt OrcaOne eine Sicherung an (Entscheidung vom 23.09.2026). B7 stellt am Ende den Stand von vor B1 wieder her.

## Teil A: Anzeigen vergleichen (nur lesen)

Für jede Düse gilt: In SnOrca den Drucker „Snapmaker U1 (x nozzle)“ wählen und das Filament-Dropdown ansehen. In OrcaOne denselben Drucker und dieselbe Düse wählen und „Aktiv“ ansehen. Beispielprofile in OrcaOne sind dabei ausgeblendet.

| # | Düse | Erwartung in SnOrca und OrcaOne (laut Daten vom 22.09.) | SnOrca | OrcaOne |
|---|---|---|---|---|
| A1 | 0.4 | Snapmaker ABS, Snapmaker PLA Basic | ☐ | ☐ |
| A2 | 0.2 | Snapmaker ABS | ☐ | ☐ |
| A3 | 0.6 | Snapmaker ABS | ☐ | ☐ |
| A4 | 0.8 | Snapmaker ABS | ☐ | ☐ |
| A5 | – | Filamente in der Liste, die zu keinem installierten Drucker passen (8 × `@J1`, `@Dual` …), stehen in OrcaOne unter Hinweise, in SnOrca nirgends | ☐ | ☐ |
| A6 | – | Die Orca-Bibliothek fehlt in SnOrca komplett und steht in OrcaOne ausgegraut, SUNLU mit 7 Einträgen | ☐ | ☐ |
| A7 | – | Druckerliste: nur Snapmaker U1 mit 4 Düsen | ☐ | ☐ |

## Teil B: Änderungen

OrcaOne kann jetzt schreiben: Sicherung, `.conf` ändern, eigene Profile anlegen, umbenennen und löschen, Sicherung wiederherstellen. Solange SnOrca läuft, bleibt „Übernehmen“ aus.

**Schon geprüft, ohne SnOrca (22.09.2026):**

- `tests/test_writes_e2e.py` spielt B1 bis B5 und B7 per HTTP gegen eine Kopie der Fixtures durch.
- Dieselben Schritte liefen auf einer Kopie des echten Datenordners, mit dem Seitencode von OrcaOne und dem Resolver als Prüfer: alle Düsen wie erwartet. B6 ist nachgestellt, indem SUNLU PLA+ in der `.conf` von Hand gestrichen wurde. Nach B7 war die Kopie Byte für Byte wie vorher.

Offen ist nur die Spalte „SnOrca“.

**Vor dem ersten Schritt:** Oben rechts unter „Installation“ Snapmaker Orca wählen, Pfad `~/.config/Snapmaker_Orca`. Die Seiten „Drucker“, „Sicherungen“ und „Slicer“ zeigen immer die gewählte Installation. Auf „Filamente“ stehen beide Installationen untereinander, jeweils mit ihrem Pfad.

**Ablauf je Schritt:**

1. SnOrca schließen. In OrcaOne „Neu einlesen“ klicken. Bei Snapmaker Orca steht dann „Geschlossen“ statt „Läuft – nur ansehen“.
2. In OrcaOne ändern, wie in der Klickfolge unten beschrieben. Unten erscheint die Leiste „1 Änderung“.
3. Übernehmen:
   - Unten „Übernehmen …“ klicken. Das Seitenpanel „Das passiert“ zeigt jede Datei und jede Änderung der `.conf`, dazu „Vorher wird automatisch gesichert“.
   - Dort „Übernehmen“ klicken. Die Meldung „Übernommen“ erscheint, und die Leiste ist leer.
4. SnOrca starten und prüfen.

| # | Änderung in OrcaOne | Was OrcaOne im Hintergrund tut | Erwartung in SnOrca | OrcaOne | SnOrca |
|---|---|---|---|---|---|
| B1 | SUNLU PLA+ bei allen Düsen einschalten, Weg A | `"SUNLU PLA+ @System"` in `"filaments"` eintragen | „SUNLU PLA+“ erscheint bei **allen** U1-Düsen im Dropdown | ☑ | ☐ |
| B2 | SUNLU PLA Matte nur für U1 0,4 einschalten, Weg B | eigenes Profil `SUNLU PLA Matte @Snapmaker U1` mit `inherits` auf das Bibliotheksprofil, `compatible_printers` = U1 0.4 | erscheint **nur** bei Düse 0.4, bei den eigenen Profilen | ☑ | ☐ |
| B3 | Die 8 Filamente ohne passenden Drucker ausblenden | aus `"filaments"` streichen, die Liste bleibt nie leer | kein sichtbarer Unterschied beim U1, die Liste in der `.conf` ist kürzer | ☑ | ☐ |
| B4 | Eigene Variante von PLA Basic anlegen, Düse 215 °C, Name „Mein PLA“ | eigenes Profil mit `inherits` und nur `nozzle_temperature` | „Mein PLA“ erscheint bei Düse 0.4, Temperatur 215 °C, der Rest wie PLA Basic | ☑ | ☐ |
| B5 | „Mein PLA“ in „Mein PLA hell“ umbenennen | `.json` und `.info` umbenennen, `name` und `filament_settings_id` setzen, Verweise in `orca_presets` nachziehen | neuer Name im Dropdown, war es ausgewählt, bleibt es ausgewählt | ☑ | ☐ |
| B6 | Einrichtungsassistent in SnOrca einmal durchklicken | – | B1 ist weg (bekannt, FINDINGS 4.7). B2 und B4 bleiben. OrcaOne meldet „Freischaltung verloren“ | ☑ (nachgestellt) | ☐ |
| B7 | Sicherung von vor B1 wiederherstellen | `.conf` und `user/` zurückschreiben, was danach dazukam, fällt weg | Zustand wie in Teil A | ☑ | ☐ |

### Klickfolge in OrcaOne

**B1 – SUNLU PLA+ bei allen Düsen (Weg A)**

1. „Filamente“ → Karte „Snapmaker U1“ bei Snapmaker Orca.
2. Unter „Düse“ die Kachel „Alle“ wählen, sie ist schon voreingestellt.
3. Unter „Alle Filamente“ ins Suchfeld „Filament suchen“ `SUNLU` tippen. Unter „Orca-Bibliothek“ klappt „SUNLU“ auf.
4. Die Zeile „PLA+“ anklicken und im Seitenpanel unter „Aktiv bei Düse“ alle Düsen anwählen. Oben unter „Aktiv“ steht jetzt „PLA+“ mit „SUNLU“ darunter. (Bis 23.09. hatte jede Zeile einen Schalter.)
5. Übernehmen wie oben. „Das passiert“ zeigt:
   - `Snapmaker_Orca.conf` wird geändert;
   - „SUNLU PLA+ wird sichtbar“;
   - unter „Gut zu wissen“: Der Einrichtungsassistent nimmt es wieder weg.

**B2 – SUNLU PLA Matte nur für 0,4 mm (Weg B)**

1. „Filamente“ → „Snapmaker U1“ → Kachel „0,4 mm“.
2. Ins Suchfeld `SUNLU` tippen, die Zeile „PLA Matte“ anklicken und im Seitenpanel die Düse 0,4 anwählen.
3. Übernehmen. „Das passiert“ zeigt:
   - `SUNLU PLA Matte @Snapmaker U1.json` wird neu angelegt;
   - Zusatz: baut auf „SUNLU PLA Matte @System“ auf, Werte: Druckerliste, dazu die `.info`.
4. Danach ist „PLA Matte“ unter „Orca-Bibliothek“ nur bei der Kachel „0,4 mm“ an, bei „Alle“ steht in der Zeile „aktiv bei 0,4“. Das Hilfsprofil selbst zeigt OrcaOne nicht unter „Eigene“, SnOrca dagegen schon.

**B3 – Filamente ohne Drucker ausblenden**

1. Im Bereich „Slicer“ die Seite „Installationen“ öffnen. Oben muss Snapmaker Orca gewählt sein.
2. Unter „Hinweise“ steht „8 sichtbare Filamente passen zu keinem installierten Drucker“. Dort „Ausblenden“ klicken. Es erscheint „Zum Ausblenden vorgemerkt …“.
3. Übernehmen. „Das passiert“ zeigt acht Zeilen „… wird ausgeblendet“, etwa „Snapmaker ABS“ mit dem vollen Namen `Snapmaker ABS @J1` darunter.
4. Unter „Filamente“ → „Snapmaker U1“ ist bei jeder Düse dasselbe aktiv wie vorher.

**B4 – „Mein PLA“ mit 215 °C**

1. „Filamente“ → „Snapmaker U1“ → Kachel „0,4 mm“.
2. Unter „Von Snapmaker“ → „Snapmaker“ die Zeile „PLA Basic“ anklicken. Rechts öffnen sich die Details.
3. „Bearbeiten“ klicken. Das Formular sagt: „Wird als eigenes Filament gespeichert – das Original bleibt.“
4. Den Namen „Snapmaker PLA Basic (eigen)“ durch `Mein PLA` ersetzen, bei „Düse“ `215` eintragen und „Fertig“ klicken.
5. Übernehmen. „Das passiert“ zeigt:
   - `Mein PLA.json` wird neu angelegt;
   - baut auf „Snapmaker PLA Basic @U1“ auf, Werte: Düse.
6. In den Details von „Mein PLA“ steht „Düse 215 °C“ mit dem Punkt für „selbst geändert“, alles andere kommt von der Vorlage.
7. Für den zweiten Teil von B5 in SnOrca „Mein PLA“ bei U1 0.4 auswählen und SnOrca wieder schließen. Dann merkt sich SnOrca die Auswahl in `orca_presets`.

**B5 – Umbenennen in „Mein PLA hell“**

1. „Filamente“ → „Snapmaker U1“ → unter „Eigene“ die Zeile „Mein PLA“ anklicken.
2. „Bearbeiten“ klicken, den Namen in `Mein PLA hell` ändern und „Fertig“ klicken.
3. Übernehmen. „Das passiert“ zeigt:
   - „Mein PLA.json umbenennen in ‚Mein PLA hell.json‘“, dazu die `.info`;
   - war „Mein PLA“ in SnOrca ausgewählt, zusätzlich „Snapmaker U1 · 0,4 mm merkt sich ein anderes Filament (Mein PLA → Mein PLA hell)“.

**B6 – Einrichtungsassistent**

1. In SnOrca den Assistenten durchklicken und SnOrca schließen.
2. In OrcaOne „Neu einlesen“ klicken.
3. Unter „Filamente“ steht bei Snapmaker Orca der Hinweis „Freischaltung verloren: ‚SUNLU PLA+ @System‘ aus der Orca-Bibliothek ist wieder ausgeblendet …“. Derselbe Hinweis steht unter „Slicer“ → „Hinweise“ als „Achtung“.
4. „SUNLU PLA Matte @Snapmaker U1“ und „Mein PLA hell“ sind weiter aktiv.

**B7 – Wiederherstellen**

1. „Sicherungen“ öffnen, oben muss Snapmaker Orca gewählt sein. Die Liste steht neueste zuerst: je Schritt eine Sicherung „Vor einer Änderung“ mit Uhrzeit und Zusatz, etwa „Filament umbenannt“ oder „Freischaltung“.
2. Die **unterste** Sicherung von heute anklicken. Das ist die von B1, mit dem Zusatz „Sichtbarkeit“.
3. „Wiederherstellen …“ klicken. „Das passiert“ zeigt:
   - `Snapmaker_Orca.conf` bekommt den Stand der Sicherung;
   - `SUNLU PLA Matte @Snapmaker U1.json` und `Mein PLA hell.json` fallen weg;
   - die acht Filamente aus B3 werden wieder sichtbar.
4. „Wiederherstellen“ klicken. Die Meldung „Wiederhergestellt“ erscheint. Vorher legt OrcaOne die Sicherung „Vor dem Wiederherstellen …“ an, damit lässt sich auch das zurücknehmen.
5. Unter „Filamente“ ist der Stand wie in Teil A, auch der Hinweis aus B6 ist weg.

**Wenn etwas nicht geht:**

- Läuft SnOrca noch, ist „Übernehmen“ aus. Das Panel sagt dann: „Snapmaker Orca läuft gerade. Schließe das Programm …“.
- Hat sich der Datenordner seit dem Plan geändert, etwa weil SnOrca kurz lief, meldet „Übernehmen“ einen veralteten Plan und bietet „Neu planen“ an.

## Auswertung

Jede Abweichung kommt mit Schritt, Düse und Screenshot nach [FINDINGS](FINDINGS.md) bzw. als Fehler nach [STAND](STAND.md).
