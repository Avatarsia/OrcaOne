# Prototyp: `.opc`-Leser

Machbarkeitsprüfung vom 21.09.2026, kein Anwendungscode. Wird nach Freigabe des Plans sauber und mit Tests ins Paket übernommen.

OrcaSlicer ab 2.5.0-dev (Nightly) liefert die Systemprofile nicht mehr als JSON aus, sondern je Hersteller als eine Binärdatei `<Vendor>.opc`. In `system/` des Datenverzeichnisses kann es dann nur noch die `.opc` geben. Die stabile 2.4.2 nutzt noch JSON.

## Ergebnis

- Das Format lässt sich mit reinem Python lesen, nur mit der Standardbibliothek.
- Alle 65 `.opc` der Nightly vom 21.09.2026 wurden fehlerfrei gelesen, zusammen 12.618 Profile in 2 s.
- Namen, `inherits`, `setting_id`, `filament_id` und `instantiation` stimmen mit den JSON-Quellen gleicher Version überein.
- Die Werte stimmen zu 99,95 % überein. Den Rest verursacht Orca selbst, weil es beim Laden alte Werte umschreibt.
- Das Format ist in `src/libslic3r/PresetCacheFormat.{hpp,cpp}` von OrcaSlicer definiert (`CACHE_VERSION` 1). Die Beschreibung Byte für Byte steht in `docs/FINDINGS.md`.

## Aufruf

```bash
python3 opc_read.py Snapmaker.opc
```

```bash
python3 opc_read.py Snapmaker.opc --dump > snapmaker.json
```

`--dump` gibt alle Profile in der JSON-Form aus, wie sie in Profildateien steht.

```bash
python3 opc_compare.py Snapmaker.opc ../../slicer-src/orcaslicer-main/resources/profiles ../../slicer-src/orcaslicer-main/src/libslic3r/PrintConfig.cpp
```

`opc_compare.py` vergleicht eine `.opc` mit den JSON-Quellen aus dem OrcaSlicer-Repo in `slicer-src/`. Eine aktuelle `.opc` liegt nach dem ersten Start der Nightly auch unter `~/.config/OrcaSlicer/system/`.

Eine `.opc` bekommt man aus der AppImage, ohne sie auszuführen:

```bash
unsquashfs -q -o <offset> -d out -f OrcaSlicer_Linux_AppImage_Ubuntu2404_nightly.appimage 'resources/profiles/Snapmaker.opc'
```

Der Offset ist das Ende der ELF-Section-Header, also `e_shoff + e_shentsize * e_shnum`. Bei der Nightly vom 21.09.2026 war das 944632.
