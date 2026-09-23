# Filament-Kalibrierung — Snapmaker U1

> **Stand:** 23.09.2026, gegengeprüft gegen den Quellcode von Snapmaker Orca 2.4.0, die OrcaSlicer-Wiki und einen U1 (Belege: `docs/FINDINGS.md`, „Kalibrierung am U1") · Basis: Snapmaker Orca (OrcaSlicer-Fork) + Firmware mit Dynamic Flow Calibration
> **Pflicht sind nur Schritt 3 (Flow) und 4 (Pressure Advance)** — alles andere nur bei Bedarf.

---

## Einmalige Vorarbeit (pro Drucker, nicht pro Filament)

### A. Fluidd einrichten
- IP-Adresse des U1 im Browser aufrufen (`http://<drucker-ip>`), Lesezeichen setzen.
- Wird gebraucht für: PA-Werte auslesen (Konsole) und Live-Check, welcher PA-Wert gerade aktiv ist.
- Alternative: den U1 in OrcaOne eintragen (Seite „Kamera"). Die Seite „Kalibrieren" zeigt dann die PA-Werte aller vier Köpfe live.

### B. Vierer-Spread-Test (einmalig)
- Dasselbe Filament auf alle vier Köpfe laden.
- Printables-Modell [Snapmaker U1 4 Colour Flowrate Calibration](https://www.printables.com/model/1503374-snapmaker-u1-4-colour-flowrate-calibration) drucken, Flow Ratio pro Kopf ausrechnen.
- **Alle Werte innerhalb ±1–2 %** → ein Profil pro Filament reicht dauerhaft. Thema erledigt. ✅
- **Ein Kopf weicht deutlich ab** → Spulen künftig auf ihrem Stamm-Kopf kalibrieren und den Kopf in den Profilnamen schreiben, z. B. `eSun PLA+ Schwarz T2 F0.97`.

### C. Profilkopien anlegen
- Die Standardprofile sind schreibgeschützt → pro Filament einmal eine **Kopie** anlegen.
- Alle Kalibrierwerte landen ausschließlich in dieser Kopie.

### D. Maschinenkalibrierung aktuell halten
- Vibrationskompensation (Input Shaping), Bett-Leveling und 4-Kopf-Offset müssen **vor** jeder Filamentkalibrierung sauber durchgelaufen sein — Input Shaping ändert die reale Beschleunigung, und PA hängt davon ab.
- Nach Transport, Umbau (z. B. Düsenwechsel) oder größeren Firmware-Updates einmal neu ausführen.

---

## Pro Filament

### 1. Trocknen — nur bei Bedarf
- PLA frisch aus der Vakuumverpackung → direkt drucken.
- **Pflicht:** PVA (immer, extrem hygroskopisch), PETG/TPU nach offener Lagerung.
- Warnzeichen für feuchtes Filament: Knistern/Zischen an der Düse, plötzliches Stringing, matte raue Oberflächen.
- Der U1 hat keinen eingebauten Trockner → extern trocknen.

### 2. Temperatur festlegen
- Bekannte Marke: **Mitte des Herstellerbereichs** eintragen — fertig, kein Testdruck.
- Faustregel statt Tower: Innerhalb des Herstellerbereichs ist die Temperatur eine Zweckentscheidung — **kühler** = schönere Oberflächen, weniger Stringing; **heißer** = bessere Haftung, Festigkeit und mehr Flow-Reserve für Speed.
- Temp-Tower (Kalibrierung → Temperature) nur bei unbekannten Herstellern oder sichtbaren Problemen. Der Tower stellt die Düsentemperatur im Filamentprofil vorübergehend auf seinen Startwert — diese Änderung **nicht** in die Kopie speichern.
- ⚠️ **Ab jetzt Temperatur nicht mehr ändern** — sonst Schritt 3 + 4 wiederholen.

### 3. Flow Ratio kalibrieren — PFLICHT
1. Flow Ratio muss **nicht** auf `1.0` zurückgesetzt werden: YOLO rechnet relativ zum aktuellen Wert (`alter Wert ± Modifier`). Der Wert aus dem Herstellerprofil (U1-PLA: 0,98) ist meist der bessere Startpunkt.
2. Kalibrierung → Flow Rate → **YOLO (Recommended)** drucken. Testbereich ±0,05 in 0,01er-Schritten; die Variante „Perfectionist" misst feiner (−0,04 bis +0,035 in 0,005er-Schritten).
3. Bestes Feld ablesen, neuen Wert in der Profilkopie speichern. Liegt das beste Feld am **Rand** des Bereichs, den Test mit dem neuen Wert einmal wiederholen.

**Tipp:** Mehrere Spulen derselben Sorte → alle vier Köpfe auf einmal mit dem 4-Farben-Modell (siehe Vorarbeit B).

### 4. Pressure Advance — PFLICHT (vereinfachter Weg)
Das Häkchen **„Enable Pressure Advance" bleibt dauerhaft an** — kein Häkchen-Jonglieren nötig. Ab Werk ist es in den U1-Profilen **aus** (z. B. Generic PLA @U1: aus, PA 0,02) → in der Profilkopie einmal einschalten, sonst nutzt der Slicer den eingetragenen Wert gar nicht.

1. Beim **ersten Druck** mit dem Filament die Kalibrierung aktivieren — beide Wege sind gleichwertig und stoßen dieselbe Routine an:
   - **Aus Snapmaker Orca:** Häkchen „Flow Calibration" im Sendedialog beim Absenden des Jobs.
   - **Am Drucker:** Start → Next → „Print Preferences" → „Dynamic Flow Calibration" anhaken → Print.
2. Dieser eine Druck läuft automatisch mit dem frisch **gemessenen** Wert; der Slicer-Wert im G-Code wird dabei ignoriert.
3. Fluidd → Konsole → `Got pressure advance: 0.0xxx` ablesen. Alternativ gezielt abfragen: `SET_PRESSURE_ADVANCE EXTRUDER=extruder1` (ohne Wert-Parameter) zeigt den aktuellen Firmware-Wert des Extruders an. Die vier Köpfe heißen `extruder`, `extruder1`, `extruder2`, `extruder3` (am U1 bestätigt). Die genaue Konsolenmeldung ist nicht geprüft, im Forum heißt sie auch „measure k: …". Einfacher: OrcaOne, Seite „Kalibrieren" — sie liest den Wert je Kopf direkt vom Drucker und übernimmt ihn per Klick.
4. Wert in die Profilkopie eintragen. Ab dem nächsten Druck gilt der Profilwert.

**Gut zu wissen:**
- Beim **PA-Linientest** (und generell bei allen Kalibrier-Testdrucken) die Druckstart-Option „Dynamic Flow Calibration" **nicht** anhaken — während eines Kalibrierdrucks wird der PA-G-Code ignoriert, der Test wäre wertlos.
- Kalibriert werden nur die Köpfe, die der Job auch nutzt: 1-Farb-Druck = 1 Kopf, 4-Farb-Druck = alle 4. Ein einzelner Kopf lässt sich innerhalb eines Multi-Color-Jobs nicht gezielt kalibrieren. → Vier neue Filamente = ein kleiner 4-Farb-Druck erfasst alle auf einmal.
- Die Messwerte landen in der **Firmware** — der Slicer zeigt immer nur die Default-K-Werte an. Deshalb läuft das Auslesen zwingend über Fluidd.
- **0,2-mm-Düsen:** Dynamische Flow-Kompensation ist dort unzuverlässig, Snapmaker rät von der automatischen Kalibrierung ab → manuell per PA-Linientest.

**Materialabhängig:**
| Material | Vorgehen |
|---|---|
| PLA | Messwert direkt übernehmen (Community-Erfahrung: trifft gut, z. B. 0,0169 auto vs. 0,0175–0,018 manuell) |
| PETG / technische Materialien | Messwert nur als Startpunkt → einmal mit dem **PA-Linientest** aus Orca gegenprüfen (Beispiel: 0,033 auto vs. 0,051 manuell) |

**Plausibilitätscheck** (live in Fluidd während des Drucks):
- Krumme Zahl (`0.0169`) = Messwert aktiv
- Glatte Zahl (`0.020`) = Slicer-Wert aktiv

> ⚠️ Snapmaker hat angekündigt, die Prioritätslogik zu überarbeiten. Nach Firmware-Updates einmal in Fluidd verifizieren, ob sich das Verhalten geändert hat.

### 5. Max Volumetric Flow — nur bei Speed-Profilen
- Kalibrierung → Max Flowrate drucken. Test-Standardwerte: 5 → 20 mm³/s in 0,5er-Schritten. Für schnelles PLA auf dem U1 den **Endwert auf ~30 erhöhen** — sonst endet der Test unterhalb des wahren Limits (Hotend-Spec: 32 mm³/s).
- Auswertung: Höhe messen, ab der die Qualität einbricht → Limit = `Start + Höhe × Schrittweite`.
- Abgelesenen Wert **minus 10–20 % Sicherheitsabstand** ins Filamentprofil (Wiki-Empfehlung — der Test ist ein Best-Case ohne Retraction & Co.).
- **Weglassen:** wenn ohnehin langsam gedruckt wird (Limit wird nie erreicht).

### 6. Retraction — nur bei Stringing
- U1-Defaults erst mal lassen (Direct-Drive-Werte passen fast immer).
- Nur testen, wenn **trotz trockenem Filament + korrektem PA** noch Fäden auftreten. Feuchtes Filament nie mit Retraction bekämpfen — sonst kalibrierst du am Symptom vorbei.

**So läuft der Test:**
1. Kalibrierung → Retraction test in Orca. Start-/Endwert und Schrittweite setzen — für Direct Drive reicht z. B. 0 → 2 mm.
2. Der Testturm erhöht die Retraction-Länge je vollem Millimeter Bauhöhe, beginnend bei 0,4 mm. Nach dem Druck die niedrigste Höhe suchen, ab der keine Fäden mehr zwischen den Türmen hängen.
3. Höhe mit dem Messschieber messen, Wert ausrechnen (`Start + ⌊Höhe − 0,4⌋ × Schrittweite`, also die Höhe minus 0,4 mm auf ganze Millimeter abrunden; Beispiel: 7,8 mm bei Schritt 0,1 → 7 × 0,1 = 0,7 mm) und eintragen: ins **Druckerprofil** — oder als **Filament-Override** in den Filamenteinstellungen, wenn nur ein Material betroffen ist (bei einer Mehrmaterial-Maschine meist der sauberere Weg).

**Faustregeln:**
- Immer den **kleinsten** fädenfreien Wert nehmen — zu viel Retraction fördert Verstopfungen und Blobs, besonders bei PETG.
- TPU verträgt fast keine Retraction (kurz und langsam).
- Retraction-Speed auf Default lassen; die Länge ist der Haupthebel.
- Hartnäckiges Stringing kann auch ein Temperatur-Thema sein (zu heiß). Falls du deswegen die Temperatur senkst, gilt die Grundregel: Flow + PA neu.

### 7. Shrinkage — nur für Passungen
- Nur bei maßhaltigen Teilen nötig (Steck-/Schraubverbindungen, technische Teile); für Optik/Deko irrelevant.
- Hintergrund: Kunststoff schrumpft beim Abkühlen — Teile fallen in XY etwas kleiner aus als gesliced. Grobe Richtwerte: PLA 0,2–0,4 %, PETG 0,3–0,8 %, ABS/ASA ca. 0,5–1 % (ASA meist etwas weniger als ABS; stark abhängig von Kammer und Abkühlung). Der genaue Wert hängt an Material **und** Hersteller → pro Filament messen.

**So läuft der Test:**
1. Kalibriermodell drucken: [Umpteenth Filament Shrinkage Calibration Models](https://www.printables.com/model/1803161-umpteenth-filament-shrinkage-calibration-models)
2. Vollständig auf Raumtemperatur abkühlen lassen (bei ABS/ASA ruhig eine Stunde warten), dann X und Y mit dem Messschieber messen.
3. Wert berechnen und in Orca im **Filamentprofil** unter „Shrinkage" eintragen: `Ist ÷ Soll × 100` — misst du 99,6 mm statt 100 mm, trägst du 99,6 % ein. Orca skaliert künftige Drucke dann automatisch hoch.

**Gut zu wissen:**
- Löcher fallen zusätzlich aus anderen Gründen zu klein aus (Bahnverkürzung in Bögen). Dafür gibt es separat die **„X-Y hole compensation"** in den Prozesseinstellungen — nicht mit Shrinkage verwechseln.
- Ganz am Ende kalibrieren — beeinflusst keine anderen Schritte.

---

## Kurzprogramm (bekanntes Marken-PLA)
1. Schritt 3: YOLO-Flow drucken, Wert speichern.
2. Schritt 4 beim ersten richtigen Druck miterledigen: Kalibrier-Option anhaken, Wert aus Fluidd abtippen.

→ Effektiv **ein Kalibrierdruck + ein Wert abtippen**, ca. 30 Minuten.

## Wie andere Maker es machen (und warum)

| Quelle | Reihenfolge (Kern) | Begründung |
|---|---|---|
| **Ellis' Print Tuning Guide** (Klipper/Voron-Standard) | Erst PA, dann Flow (EM); Retraction spät | PA verschiebt Material nur zeitlich, ändert die Menge nicht. Ellis' Flow-Methode beurteilt Top-Surfaces ästhetisch — dafür muss PA schon sitzen. |
| **Offizielles OrcaSlicer-Wiki** | Temp → Max Flow → PA → Flow | Erst das Geschwindigkeits-Limit kennen — dann laufen alle weiteren Tests sicher unterhalb des Machbaren. (= „Video 2") |
| **bobstro** (Prusa-Forum) | Flow (EM) zuerst; Retraction erledigt sich damit meist; LA/PA als „Finishing Touch" | Flow ist der größte Hebel und beeinflusst alles andere. Temperatur ist für ihn eine Zweckentscheidung statt Temp-Tower: kühl = Optik/wenig Stringing, heiß = Haftung/Festigkeit. |
| **Teaching Tech** | Hardware zuerst (Rahmen, PID, E-Steps) → First Layer → Flow → Temp → Retraction → LA | Zielgruppe Budget-Bedslinger: dort dominiert die Mechanik die Qualität; Linear Advance ist optional. |
| **Legacy-Orca-Doku** | Flow → PA → Temp → Retraction → MVS | Ursprung vieler „Video 1"-artiger Anleitungen; klassische Flow-zuerst-Schule. |

**Worin sich alle einig sind (die Invarianten):**
- **Maschine vor Filament:** E-Steps/Rotation Distance, Input Shaping bzw. Vibrationskompensation und Bett-Leveling zuerst — Input Shaping ändert die reale Beschleunigung, und PA ist beschleunigungsabhängig.
- **Temperatur vor PA:** Temperatur ändert die Viskosität und damit den Gegendruck; großer Temp-Wechsel = PA neu.
- **Retraction nach PA:** PA zieht am Zeilenende bereits Filament zurück — vorher kalibrierte Retraction fällt zu lang aus (Marlin-Doku: danach „may even be as low as 0").
- **Shrinkage zuletzt** und nur bei Bedarf.

**Warum der Flow↔PA-Lagerstreit auf dem U1 egal ist:** Die Automatik misst PA beim Druckstart — faktisch immer zuletzt, unter realen Bedingungen, nach allem anderen. Genau da wollen beide Lager am Ende hin.

**Einordnung dieses Guides:** Sichtbare Reihenfolge = Flow-zuerst-Schule (Video 1 / bobstro / Legacy-Doku); durch die automatische PA-Messung beim ersten Realdruck wird zugleich Ellis' Kernanliegen erfüllt (PA zuletzt, unter Realbedingungen). Die Lager streiten nur, weil sich ihre *manuellen* Messmethoden gegenseitig stören — sobald PA sensorbasiert gemessen wird, entfällt die Abhängigkeit. Bei den Invarianten, auf die sich alle einigen, ist der Guide voll konform.

---

## Grundregeln
- **Temperatur später geändert → Flow + PA neu.** Alles andere bleibt gültig.
- **G-Code ist eingefroren:** Profiländerungen (Flow, PA, Temperatur) wirken erst nach neuem Slicen. Ein Re-Print vom Drucker-Display nutzt die Werte vom Zeitpunkt des Slicens. Die Druckstart-Optionen (Bed Leveling, Dynamic Flow Calibration) werden dagegen bei jedem Start frisch gewählt — sie lösen nur die *Messroutine* aus; der PA-**Wert** aus dem Profil steckt weiterhin im G-Code, der **gemessene** Wert liegt in der Firmware.
- Reihenfolge einhalten: Trocknen → Temperatur → Flow → PA → (MVF → Retraction → Shrinkage).
- Einen Weg konsequent fahren: **feste Profilwerte** (dieser Guide) *oder* **Voll-Automatik** (PA-Häkchen aus + vor jedem neuen Filament kalibrieren). Mischbetrieb führt zu ständig überschriebenen Werten.
- Nach jedem Kalibrier-Testdruck in Orca ein **neues Projekt** anlegen — sonst bleibt der Slicer im Kalibriermodus. Die Änderungen an den Voreinstellungen dabei **verwerfen**: Die Tests stellen Werte vorübergehend um (Temp-Tower: Düsentemperatur, Retraction-Test: Firmware-Retraction aus).
- **Fußnote zur Reihenfolge:** Das offizielle OrcaSlicer-Wiki empfiehlt Temp → Max Flow → PA → Flow. Die Reihenfolge hier (Flow vor PA, MVF optional später) ist verbreitete Community-Praxis, weil PA-Muster mit korrektem Flow besser lesbar sind. Beides funktioniert — und auf dem U1 wird PA ohnehin automatisch gemessen, wodurch die Frage weitgehend entfällt.

---

## Quellen
- Forum: [Wie man Dynamic Flow Calibration wirklich nutzt](https://forum.snapmaker.com/t/wie-man-dynamic-flow-calibration-wirklich-nutzt/41169)
- Snapmaker Wiki: [Pressure Advance Calibration (U1)](https://wiki.snapmaker.com/en/snapmaker_u1/print_quality/parameter_calibration/pressure_advance_calibration) · [U1 FAQ](https://wiki.snapmaker.com/en/FAQ/u1)
- OrcaSlicer Wiki: [Calibration Guide](https://www.orcaslicer.com/wiki/guides/calibration_guide) · [Flow Ratio (YOLO)](https://github.com/OrcaSlicer/OrcaSlicer/wiki/flow_ratio_calib) · [Max Volumetric Speed](https://www.orcaslicer.com/wiki/calibration/volumetric_speed_calib)
- Community-Guides: [Ellis' Print Tuning Guide](https://ellis3dp.com/Print-Tuning-Guide/) · [Teaching Tech Calibration](https://teachingtechyt.github.io/calibration.html)
- Printables: [4 Colour Flowrate Calibration](https://www.printables.com/model/1503374-snapmaker-u1-4-colour-flowrate-calibration) · [Shrinkage-Modelle](https://www.printables.com/model/1803161-umpteenth-filament-shrinkage-calibration-models)
