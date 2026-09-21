# Fixtures

## `snorca/`

Ein Ausschnitt aus einem echten Snapmaker-Orca-2.4.0-Datenverzeichnis vom 21.09.2026. Erzeugt wird er mit:

```bash
python3 tests/fixtures/make_snorca_fixture.py ~/.config/Snapmaker_Orca
```

Das Skript liest die Quelle nur und läuft nie während der Tests.

- **`Snapmaker_Orca.conf`:** Nur Textersetzungen, deshalb bleibt die Formatierung des Slicers byte-genau erhalten. `slicer_uuid` ist durch Nullen ersetzt, der Home-Pfad durch `/home/user`. `devices` muss vorher leer sein, sonst bricht das Skript ab. `.snapmaker_orca_machine_id` wird nie kopiert.
- **`system/Snapmaker/`:**
  - die vier U1-Drucker mit ihrer Kette, das Modell `Snapmaker U1`, zwei Prozesse und einige Filamente, jeweils mit vollständiger `inherits`-Kette;
  - eine Regeldatei (`filament_allow_list.json`), die kein Profil ist;
  - ein Prozess, der nicht im Manifest steht und deshalb nicht geladen wird.

  Das Manifest `Snapmaker.json` ist auf diese Einträge gekürzt, die Reihenfolge ist die des Originals.
- **`system/OrcaFilamentLibrary/`:** SUNLU PLA+, SUNLU PLA Marble (Dateiname ≠ `name`), AliZ PETG-CF (Kette mit 5 Gliedern), Generic PLA und Generic PETG mit ihren Ketten. Das Manifest ist leer, wie in SnOrca.

## `conf/`

Nachgebaute `.conf`-Dateien für die Formate, die auf diesem Rechner nicht vorkommen:

- `orca_tab.conf`: Tab-Einrückung wie OrcaSlicer ab 2.4.0, mit Umlauten.
- `snorca_windows.conf`: CRLF und Prüfsummenzeile. Die MD5 wurde mit `md5sum` über den JSON-Text ohne abschließenden Zeilenumbruch berechnet. Bis eine echte Windows-Datei vorliegt, ist das nur eine Annahme aus dem Quellcode (FINDINGS 4.3).
- `snorca_linux.conf`: Kurzform der Linux-Datei.
