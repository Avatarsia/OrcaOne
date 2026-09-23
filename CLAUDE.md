# Orfix

Lokale Web-App zum Überblicken, Aufräumen, Importieren und Exportieren der Profile von OrcaSlicer und Snapmaker Orca (SnOrca).

- Spezifikation: [ORFIX_SPEC.md](ORFIX_SPEC.md)
- Geprüfte Fakten, gehen der Spezifikation vor: [docs/FINDINGS.md](docs/FINDINGS.md)
- Plan und Designplan: [docs/PLAN.md](docs/PLAN.md)
- Quellcode der Slicer zum Nachlesen (nur lesen, nicht im Git): `slicer-src/snorca-v2.4.0` (Snapmaker Orca, Tag v2.4.0) und `slicer-src/orcaslicer-main` (OrcaSlicer main). Befehle zum Neuanlegen stehen in FINDINGS unter „Quellen“. Keine Quellen woanders ablegen.
- Nie über das ganze Dateisystem oder das Home-Verzeichnis suchen (`find /`, `find ~`, `grep -r /`). Das dauert Minuten und blockiert. Gesucht wird nur in diesen Orten:
  - `slicer-src/`
  - dem Projekt
  - `.lenv/lib/` (Python-Pakete)
  - den bekannten Slicer-Datenordnern

## Harte Regeln (Vorrang vor allem anderen)

1. Automatische Tests laufen nur gegen Fixtures im Repo oder Kopien in einem temporären Verzeichnis, nie gegen echte Slicer-Datenverzeichnisse (`~/.config/Snapmaker_Orca`, `~/.config/OrcaSlicer`, Flatpak-Pfade unter `~/.var/app/`, `%APPDATA%\…`). Auf dem Entwicklungsrechner sind SnOrca und OrcaSlicer nur Testinstallationen: Beim Ausprobieren schreibt Orfix direkt in die echten Ordner, abgesichert durch seine Sicherungen (Entscheidung vom 23.09.2026). Keinen Slicer starten oder beenden.
2. Orfix schreibt ausschließlich in `user/**` und in die `<APP_KEY>.conf` eines Datenverzeichnisses. Nie in `system/`, Programmressourcen, Logs oder Caches.
3. Schreiben nur, wenn der betroffene Slicer nicht läuft, also weder sein Prozess noch seine AppImage-Runtime existiert. Sonst die Instanz schreibgeschützt anzeigen und den Grund nennen. Die Sperrdatei in `cache/` nie selbst setzen.
4. Vor jedem Schreibvorgang ein vollständiges ZIP-Backup des Datenverzeichnisses, ohne `log/`, `cache/`, `web/`, `hms/`, `ota/`, `user/Temp/`, `user/*/temp/` und `user_backup-v*/`. Backups sind vertraulich, weil sie Zugangsdaten enthalten. Jedes Backup lässt sich in der Oberfläche wiederherstellen.
5. Jede Änderung in zwei Schritten: Plan (alle Dateioperationen plus Diff der .conf, Zugangsdaten maskiert) → Bestätigung → Ausführung → erneuter Scan zur Kontrolle.
6. Die .conf lesen, nur einzelne Schlüssel ändern, vollständig zurückschreiben, und zwar im vorgefundenen Format (`orfix/conf.py`):
   - Einrückung 4 Leerzeichen (SnOrca) oder Tab (Orca ab 2.4.0);
   - `sort_keys=True`, UTF-8 roh, `\n` am Ende;
   - unter Windows die MD5-Zeile neu berechnen;
   - atomar schreiben.
7. JSON tolerant lesen: unbekannte Schlüssel behalten, kein starres Schema, unveränderte Dateien nie neu schreiben. Alles Geschriebene vorher neu parsen und die Typen prüfen, sonst löscht der Slicer das Profil. `"filaments"` nie leer schreiben, denn leer heißt „alles sichtbar“.
8. Der Server lauscht nur auf 127.0.0.1 und lehnt fremde Host- und Origin-Header ab.

## Stack und Konventionen

- **Backend:** Python ≥ 3.11, FastAPI mit uvicorn, Dataclasses, sonst Standardbibliothek. Einzige Zusatzabhängigkeit ist `psutil`. Keine Pydantic-Modelle, kein ORM, keine Datenbank. Das Dateisystem ist die einzige Quelle der Wahrheit.
- **Umgebung:** `.lenv` im Projektordner und `requirements.txt`. Start mit `./orfix.sh` bzw. `orfix.cmd` oder `.lenv/bin/python -m orfix`. Tests mit `.lenv/bin/python -m pytest`.
- **Zusätzliche Abhängigkeiten** nur nach Rücksprache.
- **Frontend:** Vue 3 (lokal in `orfix/static/vendor/`) ohne Build-Schritt, ES-Module, eine CSS-Datei.
  - Stil wie die heutige Oberfläche in `orfix/static/` (hervorgegangen aus Entwurf E und E2): Farben von OrcaSlicer (Teal `#009688`), Schrift Inter (`orfix/static/vendor/inter/`), Druckerbilder, Spulen, wenig Text.
  - Alle Fremddateien kopieren, nie auf andere Projekte verweisen.
  - Satzschreibung, Status immer als Text plus Farbe.
- **Oberfläche:**
  - **Filamente:** Drucker wählen → Düse → Baum aus Eigene, Vom Hersteller und Orca-Bibliothek.
  - **Prozesse:** dieselbe Drucker- und Düsenwahl, nur zum Ansehen.
  - **Drucker:** Standard festlegen, aufräumen.
  - **Übertragen:** Profile zwischen zwei Installationen in beide Richtungen kopieren.
  - **Sicherungen.**
  - Unter „Technik“: **Slicer** (Datenordner) und **Details** (alles zu einem Filament).

  Details nur auf Anforderung im Seitenpanel. Kein zweites Orca bauen, sondern ein einfaches Filament-System für Normalos.
- **Plattformen:** Linux und Windows gleichwertig. Pfade nur mit `pathlib`.
- **Sprache:** Code, Bezeichner und Kommentare auf Englisch. UI-Texte auf Deutsch, zentral in `orfix/static/texts.js`. Das Backend liefert Fehlercodes, keine Texte.
- **KISS:** wenige Schichten, keine Abstraktionen auf Vorrat. Keine Platzhalter, jede Datei ist nach jedem Schritt vollständig und lauffähig.
- **Tests:** pytest. Resolver und alle Schreiboperationen brauchen Tests gegen Fixtures. Fixtures entstehen mit `tests/fixtures/make_snorca_fixture.py`, anonymisiert.
- **Commits:** kleine Commits pro abgeschlossenem Schritt, aber nur auf Auftrag.
- **Phasenende:** Jede Phase endet mit lauffähiger App, grünen Tests, aktualisierter README und offenen Punkten. Danach anhalten und auf Feedback warten.
