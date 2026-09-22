# Entwürfe für die Übersicht

Klickbare Entwürfe mit echten Daten, am 21.09.2026 entstanden. Gewählt ist **Entwurf D** (`variante-d.html`):

- Der Kern zeigt nur den Drucker mit Düse, die Filamente, die im Slicer sichtbar sind, und „+ Filament dazuholen“.
- Alles andere öffnet sich auf Klick über die Seitenleiste rechts: Details, Dazuholen, Hinweise.

Die Entwürfe A bis C waren zu voll und sind nur noch in der Git-Geschichte zu finden.

**Entwurf E** (`variante-e.html`, 22.09.2026) ist der Neuanfang nach der Kritik „zu technisch, keine Bilder“:

- Startseite mit Druckerbildern, darunter Düsenwahl und ein Baum „Eigene“ / „Von Snapmaker“ / „Orca-Bibliothek“ mit einem Schalter je Filament.
- Filamente per Drag & Drop einschalten oder als „Neues Filament daraus“ anlegen, alles nur im Speicher.
- Die Spule zeigt das Material, nicht die Farbe. Bekannte Farben stehen im Seitenpanel unter „Gibt es in“.
- Das Hilfsprofil, mit dem SnOrca ein Bibliotheksfilament sieht, erscheint nicht unter „Eigene“. Es gilt als eingeschaltete Bibliothekszeile (`helper` in `data.js`).
- Farben wie OrcaSlicer, Schrift Inter (OFL, `orfix/static/vendor/inter/`). HarmonyOS Sans, die Schrift von Orca, wurde verglichen und sah kaum anders aus.
- Direkt zu einem Drucker: `variante-e.html#/snorca/0`.

**Entwurf E2** (`e2/index.html`, 22.09.2026) teilt E in Seiten auf:

- Links ein Menü nach dem Gerätefenster von ionpy: Filamente, Drucker, Sicherungen und unter „Technik“ die Seite „Slicer“. Unter 900 px wird es eine Reihe mit vier Reitern.
- Oben rechts wählt man die Installation. „Drucker“, „Sicherungen“ und „Slicer“ zeigen nur sie, die Druckerauswahl unter „Filamente“ zeigt wie E alle Installationen, die gewählte zuerst.
- „Filamente“ ist E als Komponente (`e2/pages/filamente.js`). Beispielprofile aus `make_data.py` tragen das Etikett „Beispiel“.
- „Bearbeiten“ im Seitenpanel eines Filaments öffnet ein Formular (`e2/pages/filament-editor.js`) mit den Feldern aus `editable_fields`, gruppiert nach Allgemein, Temperaturen, Fluss, Material und Kühlung:
  - Oben stehen der Name, groß und änderbar, und die Spule als Vorschau der Farbe.
  - Ein leeres Feld zeigt grau den Wert der Vorlage („von Vorlage“). Ein abweichender Wert ist orange markiert, wie „Wert geändert“ in Orca, und hat „Zurücksetzen“. Werte mit zweitem Wert für High Flow bekommen zwei kleine Felder.
  - Ein Profil vom Hersteller oder aus der Bibliothek bleibt unverändert. Das Ergebnis wird ein eigenes Filament „<Name> (eigen)“, das oben im Formular angekündigt wird.
  - Geprüft wird direkt am Feld: Name nicht leer, nicht doppelt und ohne die Zeichen, die der Slicer ablehnt, außerdem Zahlen in sinnvollen Grenzen (Düse 150–350 °C).
  - „Übernehmen“ legt einen Eintrag in der Änderungsliste an („umbenennen“, „ändern“, „neu anlegen“) und aktualisiert Kachel und Baum. Geschrieben wird nichts.
  - Für eigene Profile liefert `make_data.py` je selbst gesetztem Wert auch den Wert der Vorlage (`inherited`).
- „Slicer“ ist die technische Seite. Sie zeigt je Installation Ordner, Größen und Pakete und sagt, was Orfix ändert (nur `user/` und die `.conf`).
- „Drucker“ zeigt je Druckermodell und je eigenem Drucker eine Karte mit Bild, Düsen und Etikett („Vom Hersteller“, „Eigener“, „Aus einem Projekt übernommen“, „Standard“). „Als Standard“ und „Entfernen“ bzw. „Löschen“ öffnen das Seitenpanel mit dem Plan. Beim Entfernen lassen sich Filamente und Prozesse mitlöschen, die nur zu diesem Drucker gehören. Darunter steht „Aufräumen“ für gemerkte Einträge ohne Drucker.
- „Sicherungen“ zeigt oben die Gesamtgröße und „Jetzt sichern“, darunter alle Sicherungen nach Tagen. „Wiederherstellen“ zeigt im Seitenpanel, was zurückkommt und was wegfällt. Gelöscht wird nur von Hand.
- Jede Aktion legt vorher eine Sicherung an, auch „Übernehmen“ unter „Filamente“. Eine Wiederherstellung wirkt sofort auf der Seite „Drucker“. Alles bleibt im Speicher (`live` und `backupNow` in `e2/common.js`).
- Die Filamentschalter und die Bearbeitungen setzt eine Wiederherstellung noch nicht zurück. Umbenannte und neue Filamente kennen „Drucker“ und „Sicherungen“ noch nicht.
- Adressen: `#/filamente`, `#/filamente/<installation>/<nummer>`, `#/drucker`, `#/sicherungen`, `#/slicer`.
- E2 lädt ES-Module und läuft deshalb nur über den Orfix-Server, nicht per `file://`.

## Ansehen

Orfix starten und auf der Startseite den Link „D – Nur das Nötigste“ öffnen, oder direkt aufrufen: http://127.0.0.1:8765/prototypes/ui-overview/variante-d.html bei `--port 8765`. E2 liegt unter http://127.0.0.1:8765/prototypes/ui-overview/e2/index.html.

Die Daten in `data.js` liegen nicht im Git. Sie stammen aus den eigenen Installationen, gelesen wird nur. Neu erzeugen:

```bash
python3 prototypes/ui-overview/make_data.py
```
