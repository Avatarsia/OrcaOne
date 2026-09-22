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

## Ansehen

Orfix starten und auf der Startseite den Link „D – Nur das Nötigste“ öffnen, oder direkt aufrufen: http://127.0.0.1:8765/prototypes/ui-overview/variante-d.html bei `--port 8765`.

Die Daten in `data.js` liegen nicht im Git. Sie stammen aus den eigenen Installationen, gelesen wird nur. Neu erzeugen:

```bash
python3 prototypes/ui-overview/make_data.py
```
