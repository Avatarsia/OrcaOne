# Plan für Phase 0 und Phase 1

Stand 21.09.2026, freigegeben am selben Tag. Grundlage: [Spezifikation](../ORFIX_SPEC.md), [Befunde](FINDINGS.md) und die Wünsche aus dem Gespräch vom 21.09.

## Leitlinien aus dem Gespräch

- **Sehr einfach.** Es gibt zwei Seiten: **Übersicht** (Ist-Zustand, nur lesend) und **Verwalten** (ab Phase 2). Technische Details sind aufklappbar oder stehen im Seitenpanel und bekommen keine eigenen Seiten.
- **Der Kern ist das Filament-Handling.** Es soll klar sein, was zu welchem Drucker gehört, worauf ein Profil aufbaut und wie neue Filamente wie SUNLU nach SnOrca kommen. Außerdem sollen U1-Profile in beide Richtungen zwischen SnOrca und Orca wandern können.
- **Unterstützte Slicer:** SnOrca 2.4 sowie OrcaSlicer stabil (2.4.x, JSON) **und** Nightly (2.5.0-dev, `.opc`).
- **Plattformen:** Linux und Windows gleichwertig. macOS läuft über die Pfaderkennung mit, wird aber nicht getestet.
- **Stil:** Orfix lehnt sich am ionpy-Styleguide an. Alle nötigen Dateien werden **kopiert**, Orfix läuft eigenständig ohne ionpy und ohne CDN.
- **Name:** Orfix. Paket `orfix/`, Start mit `python -m orfix`, eigener Datenordner `~/.local/share/orfix` bzw. `%LOCALAPPDATA%\orfix`.
- **Python-Umgebung:** `.lenv` im Projektordner, Abhängigkeiten in `requirements.txt`.

## Abweichungen von der Spezifikation

Das hier folgt aus den Befunden oder aus dem Gespräch. Am 21.09.2026 in die Spezifikation eingearbeitet.

1. **Regel 6:** Die `.conf` wird im Format der vorgefundenen Datei geschrieben: Einrückung (4 Leerzeichen oder Tab), `sort_keys=True`, UTF-8 roh, `\n` am Ende. OrcaSlicer ab 2.4.0 nutzt Tab, 4 Leerzeichen stimmen nur für SnOrca.
2. **Regel 4 (Backup):** Das Backup lässt außer `log/` und Caches auch `web/`, `hms/`, `ota/`, `user/Temp/`, `user/*/temp/` und `user_backup-v*/` weg. Backups enthalten Zugangsdaten aus der `.conf` und gelten als vertraulich. Sie liegen im Orfix-Datenordner und werden nie weitergegeben.
3. **Regel 7:** Alles, was Orfix nach `user/` schreibt, wird vorher geparst und geprüft. Fehlerhafte Profile löscht der Slicer sonst samt `.info`.
4. **4.2 „rekursiv scannen“:** Orfix scannt rekursiv, markiert aber, welche Dateien der Slicer wirklich lädt: `<typ>/*.json`, `<typ>/base/`, bei Orca main zusätzlich `_local/` und `_subscribed/`.
5. **Abschnitt 6:** In zwei Punkten weicht Orfix vom ionpy-Stil ab: Satzschreibung statt Großbuchstaben und Status immer als Text plus Farbe (siehe Designplan).
6. **Offener Punkt „Vue lokal oder CDN“:** erledigt, Vue wird lokal kopiert.

---

## Phase 0 – Grundgerüst

Jeder Schritt endet mit lauffähigem Stand und grünen Tests. Commits mache ich nur auf deinen Auftrag.

**0.1 Projekt**

- `git init`.
- Umbenennen: `ORCIX_SPEC.md` → `ORFIX_SPEC.md`, Name im Text ersetzt.
- `requirements.txt`: fastapi, uvicorn, pytest, ggf. psutil (siehe Entscheidungen).
- Startskripte `orfix.sh` und `orfix.cmd`: legen `.lenv` an, falls sie fehlt, installieren die Abhängigkeiten und starten Orfix.
- `python -m orfix` sucht einen freien Port, lauscht nur auf 127.0.0.1 und öffnet den Browser.
- `.claude/launch.json` zeigt dann auf Orfix statt auf den ionpy-Styleguide.

**0.2 Instanzen erkennen** (`instances.py`)

- **Linux:** `$XDG_CONFIG_HOME` bzw. `~/.config`, die Flatpak-Pfade für `io.github.Snapmaker.Snapmaker_Orca`, `com.orcaslicer.OrcaSlicer` und die alte ID `io.github.softfever.OrcaSlicer` (als „veraltete Kopie“) sowie `<AppImage>.config/<Key>` neben gefundenen AppImages.
- **Windows:** `%APPDATA%\<Key>`. **macOS:** `~/Library/Application Support/<Key>`.
- **Manuelle Pfade** für portable Installationen oder `--datadir`. Sie werden in `<orfix-daten>/instances.json` gespeichert.
- **Je Instanz:** Slicer (aus dem Namen der `.conf`), Version aus `header`, Formate (JSON, `.opc`), Benutzerordner, und ob ein Konto angemeldet ist (`preset_folder` ≠ `""`).

**0.3 Laufprüfung** (`guard.py`)

- **Linux und macOS:** Sperre auf `cache/*.lock` rein lesend per `F_GETLK` prüfen, dazu die Prozessliste.
- **Windows:** Prozessliste mit `snapmaker-orca.exe` bzw. `orca-slicer.exe`.
- Läuft der Slicer, gilt die Instanz als schreibgeschützt, mit Begründung im Klartext.

**0.4 Oberflächen-Grundgerüst**

- Dateien: `static/index.html`, `app.js`, `api.js`, `texts.js`, `style.css`, `vendor/` (Vue 3.5.28, JetBrains Mono Regular samt OFL.txt).
- Kopfzeile mit Instanzauswahl und Status. Seite „Übersicht“ als leerer Rahmen, der den nächsten Schritt zeigt.

**0.5 Fixtures** (vor dem Kopieren frage ich dich, siehe Entscheidungen)

- Anonymisierte Ausschnitte aus deiner SnOrca-Installation:
  - `.conf` ohne `devices`, mit Platzhalter statt `slicer_uuid`;
  - gekürzte Manifeste;
  - die Ketten für die 8 Abnahmeprofile aus FINDINGS;
  - `Generic PLA @System` für die Ausschlussregel.
- Eine Orca-Variante mit Tab-Einrückung.
- Eine Windows-`.conf` mit Prüfsummenzeile.
- `OrcaFilamentLibrary.opc` aus der Nightly (210 KB).
- **Eigene Profile:** In deiner Installation gibt es noch keine. Deshalb baut Orfix sie im Format von `Preset::save` nach und kennzeichnet sie als synthetisch. Das geschieht in Phase 1, zusammen mit dem Resolver. Die `.opc`-Fixture kommt ebenfalls in Phase 1, mit dem `.opc`-Leser.

**0.6 Tests**

- Erkennung mit gefälschtem Home-Verzeichnis und `XDG_CONFIG_HOME`.
- Laufprüfung mit einer Datei, die ein Hilfsprozess sperrt.
- `.conf` lesen und unverändert zurückschreiben: Das Ergebnis muss byte-identisch sein, für 4 Leerzeichen, Tab und Windows mit Prüfsumme.

**Ende von Phase 0:** Orfix startet, zeigt die gefundenen Instanzen und sagt, ob der Slicer läuft. README mit Start, Neuerungen und Testschritten.

---

## Phase 1 – Übersicht (nur lesend)

**1.1 Scanner** (`scanner.py`, `model.py`)

- **Systemprofile** über das Manifest. Die SnOrca-Bibliothek mit leerem Manifest wird direkt aus dem Ordner gelesen.
- **`.opc`-Leser**, übernommen aus dem Prototyp, mit Tests. Unbekannte `CACHE_VERSION` ergibt „Format nicht unterstützt“, ohne Absturz.
- **Benutzerprofile** mit `.info`, dazu die Bundles von Orca main.
- **Dateibaum:** je Datei der Typ und ob der Slicer sie lädt, mit Grund („keine gültige `version`“, „Name schon vergeben“, „Ordner wird ignoriert“ …).

**1.2 Resolver** (`resolver.py`)

- **Vererbung:** System innerhalb des Pakets, Bibliothek zuerst. Benutzerprofile nach `find_preset2`: exakter Name, dann `renamed_from` samt implizitem Eintrag, dann der Generic-Rückgriff.
- **Status:** in Ordnung, verwaist, Ersatz-Elternprofil, Zyklus, Elternprofil abstrakt, wird vom Slicer ignoriert.
- **Werte je Kettenglied:** selbst gesetzt, geerbt (mit Quelle) oder „Standardwert des Slicers“.

**1.3 Sichtbarkeit und Kompatibilität**

- Systemdrucker aus `"models"` mit `printer_variant`.
- `"filaments"` in drei Zuständen.
- Ausschlussregel der Bibliothek, getrennt nach SnOrca und Orca.
- Kompatibilität je Drucker. „Im Dropdown“ heißt sichtbar und kompatibel.
- Warnung bei gleichem Alias (SnOrca).

**1.4 Schnappschuss** („Neu seit dem letzten Scan“)

- **Gespeichert** wird je Instanz in `<orfix-daten>/snapshots/`: Pfad, Größe, Änderungszeit und SHA-256 je Datei, dazu `models`, `filaments`, `presets`, `orca_presets` und die Projekt-Einstellungen aus `app`.
- **„Als gesehen markieren“** aktualisiert den Schnappschuss.
- **Änderungen durch den Slicer** (siehe FINDINGS 4.4) werden als solche erklärt.

**1.5 API** (`app.py`)

- `GET /api/instances`
- `GET /api/instances/{id}/overview`
- `GET /api/instances/{id}/profiles/{kind}/{name}`
- `GET /api/instances/{id}/files`
- `GET /api/instances/{id}/changes`
- `POST /api/instances/{id}/changes/seen`: der einzige schreibende Aufruf, er schreibt nur in den Orfix-Datenordner.

**1.6 Seite „Übersicht“**

Aufbau siehe Designplan.

- **Kopf:** Slicer, Version, Pfad, läuft oder nicht, angemeldet oder nicht.
- **Hinweisleiste:** „Neu seit dem letzten Scan“ und Warnungen, je mit einem Satz, was zu tun ist.
- **Tabelle der Drucker**, nach Modell gruppiert. Ein Klick filtert die Filamente und Prozesse darunter auf diesen Drucker.
- **Tabelle der Filamente** mit Filtern für Herkunft (Snapmaker, Orca-Bibliothek, eigenes Profil, Bundle) und Status (sichtbar, ausgeblendet, verwaist, inkompatibel, bedingt). Die Prozesse stehen als einfache Liste darunter.
- **Seitenpanel** für das gewählte Profil:
  - „Baut auf … auf“ als Kette;
  - die selbst gesetzten Werte, dann aufklappbar alle Werte mit Quelle;
  - kompatible Drucker und Dateipfade.
- **Aufklappbarer Abschnitt „Dateien“** mit dem Baum des Datenverzeichnisses und einer Erklärung je Ordner.

**1.7 Abnahme**

Die Checkliste aus FINDINGS gehen wir gemeinsam im Slicer durch.

**Ende von Phase 1:** README aktualisiert, offene Punkte gesammelt. Danach halte ich an.

---

## Ausblick (nur zur Einordnung, nicht freigegeben)

- **Phase 2 – Verwalten:**
  - Filamente je Drucker ein- und ausblenden.
  - **SUNLU und andere Bibliotheksprofile in SnOrca freischalten**, vorher den Test mit `--datadir`-Kopie. Das ziehe ich aus Phase 3 vor, weil es dein Hauptwunsch ist und technisch nur `"filaments"` ändert.
  - Eigene Profile löschen.
  - Eigene Filamente Druckern zuordnen.
  - Backups verwalten.
- **Phase 3 – Übertragen, Import, Export:**
  - U1-Drucker und -Profile SnOrca ↔ Orca. Die Druckernamen sind gleich, die Filamentnamen oft nicht. Orfix schlägt eine Zuordnung vor.
  - Import der Material4Print-ZIP, Export als Bundle.
- **Phase 4:** 3MF-Inspektor.
- **Ideen für später:**
  - Die Kamera des U1 abfragen und aktivieren. Außerhalb des bisherigen Umfangs, weil das eine Geräteverbindung braucht.
  - Spoolman nur lesend anbinden. Orfix zeigt je Spule das passende Profil, blendet Filamente ohne Spule aus und legt aus einer neuen Spule ein eigenes Profil an. Weder SnOrca 2.4 noch OrcaSlicer main haben das eingebaut.

---

## Designplan

> **Stand 22.09.2026: überholt durch Entwurf E.** Die Oberfläche richtet sich jetzt nach `prototypes/ui-overview/variante-e.html`:
> - **Farben:** von OrcaSlicer (Teal `#009688`, Palette in FINDINGS-Umfeld belegt).
> - **Schrift:** Inter statt JetBrains Mono und ionpy-Stil.
> - **Seiten:** Filamente, Drucker, Sicherungen, mit Druckerbildern und Spulen.
>
> Die Abschnitte unten beschreiben den früheren ionpy-Ansatz und bleiben nur zur Nachvollziehbarkeit stehen. Phase 1 wird auf Grundlage von E neu geplant.


Er beruht auf dem ionpy-Styleguide (`~/dev/ionpy/static/dev/styleguide/`): dunkel, flach, kantig (Radius 0), 1-px-Rahmen, dicht (Zeilen 28 px), ein sparsamer Akzent, Mono-Schrift für technische Werte. Übernommen werden die Tokens und Bausteine Tabelle, Knopf, Status, Seitenpanel, Dialog und leerer Zustand. Das ganze Layout-System, die vier Themes, die Desktop-Metapher und die Icon-Schrift (730 KB) bleiben draußen.

**Farben:** hell und dunkel automatisch über `prefers-color-scheme`. Die Werte stammen aus ionpy, nur die Statusfarben sind für lesbaren Text (Kontrast ≥ 4,5:1) eine Stufe angepasst.

| Rolle | Dunkel | Hell |
|---|---|---|
| Hintergrund | `#161619` | `#ebebeb` |
| Fläche (Tabellen, Panel) | `#202024` | `#f9f9f9` |
| Rahmen | `#44444b` | `#bbbbbb` |
| Text | `#f4f4f5` | `#2c2c2c` |
| Nebentext | `#a1a1aa` | `#595959` |
| Akzent, Fokus | `#0ea5e9` | `#0f766e` |
| Status OK / Warnung / Fehler | `#10b981` / `#f59e0b` / `#f87171` | `#166534` / `#854d0e` / `#b91c1c` |

**Schriften**

- Oberfläche: `system-ui, "Segoe UI", sans-serif`, unter Linux also Noto Sans, unter Windows Segoe UI. ionpy nennt Inter, liefert sie aber nicht mit.
- Profilnamen, Pfade und Werte: **JetBrains Mono** Regular, lokal (92 KB, OFL).
- Grundgröße 13 px, Tabellenkopf 12 px halbfett. Keine Großbuchstaben-Beschriftungen.

**Status:** immer ein Wort plus Farbe, etwa `● Sichtbar`, `● Ausgeblendet`, `● Verwaist`. Der Punkt ist nur Zusatz.

**Tastatur:** Alle Bedienelemente sind per Tab erreichbar, mit sichtbarem Fokusring (`:focus-visible`, 2 px Akzent). Dialoge nutzen das native `<dialog>`, das den Fokus selbst festhält.

**Layout der Übersicht**

```
┌────────────────────────────────────────────────────────────────────────────────┐
│ Orfix   [Snapmaker Orca 2.4.0 · ~/.config/Snapmaker_Orca ▾]   ● Läuft – nur lesen│
│ Übersicht | Verwalten                                                           │
├────────────────────────────────────────────────────────────────────────────────┤
│ ⚠ 3 Änderungen seit dem letzten Scan  [Ansehen] [Als gesehen markieren]        │
│ ⚠ 8 sichtbare Filamente passen zu keinem installierten Drucker  [Zeigen]       │
├──────────────────────────────────────────────────────┬─────────────────────────┤
│ Drucker                                               │ SUNLU PLA+ @System      │
│ Name                      Herkunft   Filamente Prozesse│ Orca-Bibliothek         │
│ ▸ Snapmaker U1 (0.4 nozzle) Snapmaker    133      8   │ ● Ausgeblendet          │
│   Snapmaker U1 (0.2 nozzle) Snapmaker     …       …   │                         │
│                                                       │ Baut auf               │
│ Filamente für Snapmaker U1 (0.4 nozzle)               │  SUNLU PLA+ @base      │
│ [Suche…] Herkunft: [alle ▾]  Status: [alle ▾]         │  → fdm_filament_pla    │
│ Name                       Herkunft        Status     │  → fdm_filament_common │
│ Snapmaker PLA Basic @U1    Snapmaker       ● Sichtbar │                         │
│ SUNLU PLA+ @System         Orca-Bibliothek ● Ausgebl. │ Selbst gesetzt (12)    │
│ Generic PLA @System        Orca-Bibliothek ● Verdrängt│  filament_cost  18.99  │
│ …                                                     │  …                     │
│                                                       │ ▸ Alle Werte (184)     │
│ Prozesse für Snapmaker U1 (0.4 nozzle)                │ ▸ Dateien              │
│ …                                                     │                         │
│ ▸ Dateien im Datenverzeichnis                         │                         │
└──────────────────────────────────────────────────────┴─────────────────────────┘
```

Die Tabelle nutzt die volle Breite, das Seitenpanel ist fest 320 px breit. Unter 900 px Fensterbreite legt sich das Panel als Schublade über die Tabelle.

---

## Entscheidungen vom 21.09.2026

1. Plan freigegeben.
2. `psutil`: ja.
3. Fixtures: anonymisiert aus SnOrca kopieren (erledigt, `tests/fixtures/snorca`). Eigene Profile baut Orfix im Format von `Preset::save` nach (für Phase 1).
4. Ein Windows-Rechner für Tests ist vorhanden.
5. Spezifikation in `ORFIX_SPEC.md` umbenannt, Abweichungen eingearbeitet.
