# Contributing to OrcaOne

**[English](#english) · [Deutsch](#deutsch)**

## English

Thanks for helping! Bugs and ideas go to [GitHub Issues](https://github.com/DrKlipper/OrcaOne/issues). For a bigger change, open an issue first, so we agree on the idea before you write code.

### License grant (required)

OrcaOne is licensed under the [PolyForm Noncommercial License 1.0.0](LICENSE.md), and the author offers separate licenses for commercial use. To keep that possible, every contribution needs this grant. By submitting a contribution (pull request, patch, code, text, images) you agree that:

1. The contribution is your own work, or you have the right to submit it under these terms (if your employer has rights to your work, you have its permission), and it does not infringe the rights of others. AI tools are fine; you check their output like your own code.
2. You keep the copyright to your contribution.
3. You grant Dominik Schmidt (Dr. Klipper) a perpetual, worldwide, non-exclusive, royalty-free and irrevocable license to use, copy, modify, publish, make available to the public (also as an online service) and distribute your contribution, and to sublicense and relicense it under any terms, including commercial licenses, as part of OrcaOne or on its own. This includes a license under any patent you can license that your contribution would otherwise infringe. He may transfer this license, for example to his heirs or to a company that takes over OrcaOne.
4. OrcaOne publishes your contribution under its license, today the PolyForm Noncommercial License 1.0.0.
5. There is no claim to payment or to your contribution being accepted. Credit in the Git history of the public repository is enough, also when OrcaOne is shipped without it; as far as the law allows, you do not assert moral rights against the uses in item 3.
6. Code, text or images by others: name the source and license in the pull request. They keep their license and are not covered by item 3. No code or images from OrcaSlicer, Snapmaker Orca or other GPL or AGPL sources.

Every author of a commit in the pull request confirms this with the following line, in the description or in a comment:

> I agree to the license grant in CONTRIBUTING.md.

Pull requests without this confirmation are not merged. The same applies to pull requests opened before this file existed and to code or images sent in issues or by mail. The English text is binding; the German translation below is for understanding only.

### How to contribute

- One topic per pull request; small is better.
- Tests: `python -m pytest`, all green; new behavior comes with tests. Tests run only against fixtures in the repo or copies in a temporary folder, never against real slicer data folders.
- Code, names and comments in English. Every UI text goes into both `orcaone/static/texts/de.js` and `en.js`.
- No new dependencies without asking first.
- OrcaOne writes only to `user/**` and the slicer's `.conf`, always with a backup and a plan first. Commands reach a printer only on the user's click. A change to these rules needs a very good reason.
- Conventions and all pages of the app: [CLAUDE.md](CLAUDE.md) and [docs/HANDBUCH.md](docs/HANDBUCH.md) (both in German).

## Deutsch

Danke fürs Mithelfen! Fehler und Ideen gehören in die [GitHub Issues](https://github.com/DrKlipper/OrcaOne/issues). Vor einer größeren Änderung bitte erst ein Issue anlegen, damit wir uns über die Idee einig sind, bevor du Code schreibst.

### Rechteeinräumung (Pflicht)

OrcaOne steht unter der [PolyForm Noncommercial License 1.0.0](LICENSE.md), und der Autor vergibt gesonderte Lizenzen für kommerzielle Nutzung. Damit das möglich bleibt, braucht jeder Beitrag diese Rechteeinräumung. Mit dem Einreichen eines Beitrags (Pull Request, Patch, Code, Text, Bilder) stimmst du Folgendem zu:

1. Der Beitrag ist dein eigenes Werk, oder du darfst ihn zu diesen Bedingungen einreichen (hat dein Arbeitgeber Rechte an deiner Arbeit, hast du seine Erlaubnis), und er verletzt keine Rechte anderer. KI-Werkzeuge sind in Ordnung; ihre Ergebnisse prüfst du wie deinen eigenen Code.
2. Das Urheberrecht an deinem Beitrag bleibt bei dir.
3. Du räumst Dominik Schmidt (Dr. Klipper) ein einfaches, zeitlich und räumlich unbeschränktes, unwiderrufliches und unentgeltliches Nutzungsrecht ein, deinen Beitrag zu nutzen, zu vervielfältigen, zu bearbeiten, zu veröffentlichen, öffentlich zugänglich zu machen (auch als Onlinedienst) und zu verbreiten sowie Dritten Rechte daran einzuräumen und ihn zu beliebigen Bedingungen zu lizenzieren, auch unter kommerziellen Lizenzen, als Teil von OrcaOne oder einzeln. Das schließt eine Lizenz an deinen Patenten ein, soweit du sie vergeben kannst und dein Beitrag sie sonst verletzen würde. Er darf dieses Recht übertragen, etwa an Erben oder eine Firma, die OrcaOne übernimmt.
4. OrcaOne veröffentlicht deinen Beitrag unter seiner Lizenz, heute der PolyForm Noncommercial License 1.0.0.
5. Es besteht kein Anspruch auf Bezahlung oder darauf, dass dein Beitrag angenommen wird. Die Nennung in der Git-Historie des öffentlichen Repositorys genügt, auch wenn OrcaOne ohne sie weitergegeben wird; soweit gesetzlich möglich, machst du gegen die Nutzungen aus Punkt 3 keine Urheberpersönlichkeitsrechte geltend.
6. Code, Texte oder Bilder anderer: Quelle und Lizenz im Pull Request nennen. Sie behalten ihre Lizenz und fallen nicht unter Punkt 3. Kein Code und keine Bilder aus OrcaSlicer, Snapmaker Orca oder anderen Quellen unter GPL oder AGPL.

Jeder Autor eines Commits im Pull Request bestätigt das mit dieser Zeile, in der Beschreibung oder in einem Kommentar:

> I agree to the license grant in CONTRIBUTING.md.

Pull Requests ohne diese Bestätigung werden nicht übernommen. Das gilt auch für Pull Requests, die vor dieser Datei eröffnet wurden, und für Code oder Bilder aus Issues oder Mails. Rechtlich maßgeblich ist der englische Text; diese Übersetzung dient nur dem Verständnis.

### So trägst du bei

- Ein Thema je Pull Request; klein ist besser.
- Tests: `python -m pytest`, alle grün; neues Verhalten kommt mit Tests. Tests laufen nur gegen Fixtures im Repo oder Kopien in einem temporären Ordner, nie gegen echte Datenordner eines Slicers.
- Code, Bezeichner und Kommentare auf Englisch. Jeder Text der Oberfläche gehört in `orcaone/static/texts/de.js` und `en.js`.
- Keine neuen Abhängigkeiten ohne vorherige Absprache.
- OrcaOne schreibt nur in `user/**` und die `.conf` des Slicers, immer mit Sicherung und vorher einem Plan. Befehle gehen nur auf Klick des Nutzers an einen Drucker. Wer daran etwas ändern will, braucht einen sehr guten Grund.
- Konventionen und alle Seiten der App: [CLAUDE.md](CLAUDE.md) und [docs/HANDBUCH.md](docs/HANDBUCH.md).
