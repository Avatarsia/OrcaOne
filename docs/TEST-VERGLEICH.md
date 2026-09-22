# Test: SnOrca gegen Orfix

Entwurf vom 22.09.2026. Ziel: prüfen, ob Orfix genau das zeigt, was SnOrca zeigt, und ob eine Änderung in Orfix im Slicer genau so ankommt wie angekündigt.

**Grundregel:** Geändert wird nur eine **Kopie** des Datenordners. Der echte Ordner `~/.config/Snapmaker_Orca` bleibt unangetastet (harte Regel 1). SnOrca startet für den Test mit `--datadir` auf der Kopie.

## Vorbereitung (einmal)

1. SnOrca schließen.
2. Kopie anlegen:

   ```bash
   mkdir -p ~/orfix-test && cp -a ~/.config/Snapmaker_Orca ~/orfix-test/
   ```

3. SnOrca auf der Kopie starten:

   ```bash
   ~/Downloads/Snapmaker_Orca_Linux_AppImage_Ubuntu2404_V2.4.0.appimage --datadir ~/orfix-test/Snapmaker_Orca
   ```

4. In Orfix unter „Slicer“ den Ordner `~/orfix-test/Snapmaker_Orca` hinzufügen. Er erscheint als eigene Installation „von Hand hinzugefügt“.

## Teil A: Anzeigen vergleichen (nur lesen)

Für jede Düse gilt: In SnOrca den Drucker „Snapmaker U1 (x nozzle)“ wählen und das Filament-Dropdown ansehen. In Orfix denselben Drucker und dieselbe Düse wählen und „Aktiv“ ansehen. Beispielprofile in Orfix sind dabei ausgeblendet.

| # | Düse | Erwartung in SnOrca und Orfix (laut Daten vom 22.09.) | SnOrca | Orfix |
|---|---|---|---|---|
| A1 | 0.4 | Snapmaker ABS, Snapmaker PLA Basic | ☐ | ☐ |
| A2 | 0.2 | Snapmaker ABS | ☐ | ☐ |
| A3 | 0.6 | Snapmaker ABS | ☐ | ☐ |
| A4 | 0.8 | Snapmaker ABS | ☐ | ☐ |
| A5 | – | Filamente in der Liste, die zu keinem installierten Drucker passen (8 × `@J1`, `@Dual` …), stehen in Orfix unter Hinweise, in SnOrca nirgends | ☐ | ☐ |
| A6 | – | Die Orca-Bibliothek fehlt in SnOrca komplett und steht in Orfix ausgegraut, SUNLU mit 7 Einträgen | ☐ | ☐ |
| A7 | – | Druckerliste: nur Snapmaker U1 mit 4 Düsen | ☐ | ☐ |

## Teil B: Änderungen (nur auf der Kopie)

Dafür braucht Orfix echte Schreibfunktionen: Sicherung, `.conf` ändern, eigenes Profil anlegen. Sie entstehen vor dem Test als erster Teil von Phase 2. Orfix schreibt dabei **nur** in von Hand hinzugefügte Ordner, nie in die Standardorte.

Ablauf je Schritt:
1. SnOrca (Kopie) schließen.
2. In Orfix ändern und die Änderungsliste bestätigen. Orfix legt vorher eine Sicherung an.
3. SnOrca auf der Kopie wieder starten.
4. Prüfen.

| # | Änderung in Orfix | Was Orfix im Hintergrund tut | Erwartung in SnOrca | Ergebnis |
|---|---|---|---|---|
| B1 | SUNLU PLA+ einschalten, Weg A | `"SUNLU PLA+ @System"` in `"filaments"` eintragen | „SUNLU PLA+“ erscheint bei **allen** U1-Düsen im Dropdown | ☐ |
| B2 | SUNLU PLA Matte nur für U1 0.4 einschalten, Weg B | eigenes Profil mit `inherits` auf das Bibliotheksprofil, `compatible_printers` = U1 0.4 | erscheint **nur** bei Düse 0.4, bei den eigenen Profilen | ☐ |
| B3 | Die 8 Filamente ohne passenden Drucker ausblenden | aus `"filaments"` streichen, die Liste bleibt nie leer | kein sichtbarer Unterschied beim U1, die Liste in der `.conf` ist kürzer | ☐ |
| B4 | Eigene Variante von PLA Basic anlegen, Düse 215 °C, Name „Mein PLA“ | eigenes Profil mit `inherits` und nur `nozzle_temperature` | „Mein PLA“ erscheint bei Düse 0.4, Temperatur 215 °C, der Rest wie PLA Basic | ☐ |
| B5 | „Mein PLA“ in „Mein PLA hell“ umbenennen | Datei und `.info` umbenennen, `name` setzen, Verweise in `orca_presets` nachziehen | neuer Name im Dropdown, war es ausgewählt, bleibt es ausgewählt | ☐ |
| B6 | Einrichtungsassistent in SnOrca einmal durchklicken | – | B1 ist weg (bekannt, FINDINGS 4.7). B2 und B4 bleiben. Orfix meldet „Freischaltung verloren“ | ☐ |
| B7 | Sicherung von vor B1 wiederherstellen | `.conf` und `user/` zurückschreiben | Zustand wie in Teil A | ☐ |

## Auswertung

Jede Abweichung kommt mit Schritt, Düse und Screenshot nach [FINDINGS](FINDINGS.md) bzw. als Fehler nach [STAND](STAND.md).
