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
  - Rechts im Menü stehen die Zahl der offenen Änderungen (oranger Punkt) und die Zahl der Sicherungen.
- Oben rechts wählt man die Installation, daneben steht „Neu einlesen“. Überall heißt der Zustand gleich: „Geschlossen“, „Läuft – nur ansehen“ oder „Läuft vielleicht – nur ansehen“. Unter 700 px bleibt der Name, das Statuswort steht im Seitenkopf.
- Am Etikett „Entwurf“ sitzt der Schalter „Beispiele“. Er ist aus, dann zeigt E2 nur, was es wirklich gibt (Teil A von `docs/TEST-VERGLEICH.md`). Eingeschaltet kommen die Beispielprofile aus `make_data.py` dazu, mit dem Etikett „Beispiel“, auch im Ordnerbaum und bei den Größen.
- „Filamente“ ist E als Komponente (`e2/pages/filamente.js`). Sie folgt den anderen Seiten: Ein entfernter Drucker verschwindet, mitgelöschte oder wiederhergestellte eigene Filamente ebenso. Eigene Drucker bekommen eine eigene Karte mit dem Bild ihres Basismodells.
- Ein Formular für alles (`e2/pages/filament-editor.js`):
  - „Bearbeiten“ ändert ein eigenes Filament. Bei einem Profil vom Hersteller oder aus der Bibliothek wird daraus ein eigenes Filament „<Name> (eigen)“. Ohne Änderung meldet es „Nichts geändert“ und legt nichts an.
  - „Neues Filament“ fragt zuerst nach der Vorlage, dann kommt dasselbe Formular. Das Ablageziel „Neues Filament daraus“ beim Ziehen öffnet es direkt.
  - Die Felder kommen aus `editable_fields`, gruppiert nach Allgemein, Temperaturen, Fluss, Material und Kühlung. Ein leeres Feld zeigt grau den Wert der Vorlage, ein abweichender ist orange markiert und hat „Zurücksetzen“.
  - Der Knopf heißt „Fertig“ (bzw. „Anlegen“). Er legt nur einen Eintrag in der Änderungsliste an, geschrieben wird erst mit „Übernehmen …“.
  - Wer Eingetipptes verlassen würde (Escape, X, andere Zeile, Menü), bekommt „Änderungen verwerfen?“. Vor- und Zurück im Browser fragen nicht.
- „Drucker“ zeigt je Druckermodell und je eigenem Drucker eine Karte. „Als Standard“ und „Entfernen“ bzw. „Löschen“ öffnen das Seitenpanel mit dem Plan.
  - Beim Entfernen lassen sich Filamente und Prozesse mitlöschen, die nur zu diesem Drucker gehören.
  - Ist es das letzte Modell eines Herstellers und löscht der Slicer dann das Paket (`drops_package`, FINDINGS 4.2), nennt der Plan das Paket und die eigenen Drucker, die unsichtbar werden. Mit den Daten dieses Rechners kommt das nicht vor: SnOrca behält Snapmaker, Orca 2.5 ohne `enable_ota` löscht nichts.
  - Darunter steht „Aufräumen“ für gemerkte Einträge ohne Drucker.
- „Sicherungen“ zeigt oben die Gesamtgröße und „Jetzt sichern“, darunter alle Sicherungen nach Tagen. Ein Klick auf eine Sicherung öffnet das Seitenpanel mit „Kommt zurück“, „Fällt weg“, „Wiederherstellen“ und „Löschen“.
- „Slicer“ ist die technische Seite und übernimmt die jetzige Startseite:
  - alle Installationen mit Grund für „nur ansehen“ (Sperrdatei, Prozess, PID), Konto samt Cloud-Hinweis und Problemen (`conf_unreadable`, `dir_unreadable`);
  - „Hinweise“ aus `warnings`;
  - Ordnerbaum nach Kategorie sortiert, Profile als eine Zeile `.json + .info`, das Kategorie-Etikett nur, wo es vom Ordner darüber abweicht;
  - Pakete, Einstellungsdatei, Sicherung und „Datenordner hinzufügen“. Ein hinzugefügter Ordner erscheint als Karte mit „Entfernen“, eingelesen wird er im Entwurf nicht.
- Jede Aktion legt vorher eine Sicherung an. Alles bleibt im Speicher (`live` und `backupNow` in `e2/common.js`).
- Eine Wiederherstellung setzt die Filamentschalter, offene Bearbeitungen und unter „Filamente“ gelöschte Filamente noch nicht zurück.
- Adressen tragen die Installation: `#/filamente/<installation>`, `#/filamente/<installation>/<nummer>`, `#/drucker/<installation>`, `#/sicherungen/<installation>`, `#/slicer/<installation>`.
- Zustände zum Ansehen ohne passenden Rechner: `index.html?laeuft` (erste Installation läuft), `?vielleicht` (Prozess ohne bekannten Datenordner), `?leer` (keine Installation gefunden).
- E2 lädt ES-Module und läuft deshalb nur über den Orfix-Server, nicht per `file://`. Texte zu Problemen, Konto und „keine Installation“ kommen aus `orfix/static/texts.js`.

## Ansehen

Orfix starten und auf der Startseite den Link „D – Nur das Nötigste“ öffnen, oder direkt aufrufen: http://127.0.0.1:8765/prototypes/ui-overview/variante-d.html bei `--port 8765`. E2 liegt unter http://127.0.0.1:8765/prototypes/ui-overview/e2/index.html.

Die Daten in `data.js` liegen nicht im Git. Sie stammen aus den eigenen Installationen, gelesen wird nur. Neu erzeugen:

```bash
python3 prototypes/ui-overview/make_data.py
```
