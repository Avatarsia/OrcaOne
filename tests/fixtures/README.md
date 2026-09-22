# Fixtures

## `snorca/`

Ein Ausschnitt aus einem echten Snapmaker-Orca-2.4.0-Datenverzeichnis vom 21.09.2026. Erzeugt wird er mit:

```bash
python3 tests/fixtures/make_snorca_fixture.py ~/.config/Snapmaker_Orca
```

Das Skript liest die Quelle nur und läuft nie während der Tests.

- **`Snapmaker_Orca.conf`:** Nur Textersetzungen, deshalb bleibt die Formatierung des Slicers byte-genau erhalten. `slicer_uuid` ist durch Nullen ersetzt, der Home-Pfad durch `/home/user`. `devices` muss vorher leer sein und `preset_folder` ohne Konto-ID, sonst bricht das Skript ab, bevor es etwas löscht. `.snapmaker_orca_machine_id` wird nie kopiert.
- **`system/Snapmaker/`:**
  - die vier U1-Drucker mit ihrer Kette, das Modell `Snapmaker U1`, zwei Prozesse und einige Filamente (darunter `Snapmaker ABS @U1 0.4 nozzle` und `… 0.2 nozzle`), jeweils mit vollständiger `inherits`-Kette;
  - eine Regeldatei (`filament_allow_list.json`), die kein Profil ist;
  - ein Prozess, der nicht im Manifest steht und deshalb nicht geladen wird.

  Das Manifest `Snapmaker.json` ist auf diese Einträge gekürzt, die Reihenfolge ist die des Originals.
- **`system/OrcaFilamentLibrary/`:** SUNLU PLA+, SUNLU PLA Marble (Dateiname ≠ `name`), AliZ PETG-CF (Kette mit 5 Gliedern), Generic PLA und Generic PETG mit ihren Ketten. Das Manifest ist leer, wie in SnOrca.
- **`user/default/` ist synthetisch.** Die echte Installation hat keine eigenen Profile. Das Skript schreibt sie im Format von `Preset::save` und `Preset::save_info` (FINDINGS 4.4): nur die Abweichungen plus `version`, `name`, `from`, `inherits` und `*_settings_id`, sortiert, 4 Leerzeichen; in der `.info` steht die `setting_id` des Elternprofils als `base_id`.
  - `filament/Mein PLA`: baut auf `Snapmaker PLA Basic @U1` auf, eigene `nozzle_temperature` 215.
  - `filament/Altes PETG`: baut auf `Snapmaker PETG @U1 alt` auf, das es nicht gibt, ist also verwaist.
  - `machine/Mein U1`: eigener Drucker auf Basis von `Snapmaker U1 (0.4 nozzle)`.

Die `.conf` in `snorca/` stammt noch vom 21.09. Beim Neuerzeugen am 22.09. unterschied sich nur `last_backup_path`, deshalb blieb die alte Datei stehen.

## `orca/`

Ein Ausschnitt aus einem echten OrcaSlicer-2.5.0-dev-Datenverzeichnis (Nightly) vom 21.09.2026. Erzeugt wird er mit:

```bash
python3 tests/fixtures/make_orca_fixture.py ~/.config/OrcaSlicer
```

- **`OrcaSlicer.conf`:** Tab-Einrückung, Anonymisierung wie bei `snorca/`. Zusätzlich werden die Werte unter `access_code` durch Nullen ersetzt. `devices` und `local_machines` müssen leer sein, und `access_code` darf keinen Drucker nennen, sonst bricht das Skript ab. `.orcaslicer_machine_id` wird nie kopiert.
- **`system/*.opc`:** `Custom.opc`, `OrcaFilamentLibrary.opc` und `Snapmaker.opc` unverändert, das sind Herstellerdaten. Eingerichtet sind „Generic Klipper Printer“ und der U1 mit der Variante `0.4+0.6`.
- Eigene Profile gibt es nicht. Tests, die welche brauchen, legen sie in einer Kopie im temporären Verzeichnis an.

## `conf/`

Nachgebaute `.conf`-Dateien für die Formate, die auf diesem Rechner nicht vorkommen:

- `orca_tab.conf`: Tab-Einrückung wie OrcaSlicer ab 2.4.0, mit Umlauten.
- `snorca_windows.conf`: CRLF und Prüfsummenzeile. Die MD5 wurde mit `md5sum` über den JSON-Text ohne abschließenden Zeilenumbruch berechnet. Bis eine echte Windows-Datei vorliegt, ist das nur eine Annahme aus dem Quellcode (FINDINGS 4.3).
- `snorca_linux.conf`: Kurzform der Linux-Datei.
