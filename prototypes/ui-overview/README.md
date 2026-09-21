# Entwürfe für die Übersicht

Klickbare Entwürfe mit echten Daten, am 21.09.2026 entstanden. Gewählt ist **Entwurf D** (`variante-d.html`):

- Der Kern zeigt nur den Drucker mit Düse, die Filamente, die im Slicer sichtbar sind, und „+ Filament dazuholen“.
- Alles andere öffnet sich auf Klick über die Seitenleiste rechts: Details, Dazuholen, Hinweise.

Die Entwürfe A bis C waren zu voll und sind nur noch in der Git-Geschichte zu finden.

## Ansehen

Orfix starten und auf der Startseite den Link „D – Nur das Nötigste“ öffnen, oder direkt aufrufen: http://127.0.0.1:8765/prototypes/ui-overview/variante-d.html bei `--port 8765`.

Die Daten in `data.js` liegen nicht im Git. Sie stammen aus den eigenen Installationen, gelesen wird nur. Neu erzeugen:

```bash
python3 prototypes/ui-overview/make_data.py
```
