// A bundle profile of OrcaSlicer 2.5 is called "_local/<id>/<name>" inside (scanner.py); people see <name>.
// Its own module, as both languages need it (texts/de.js, texts/en.js).
export const plainName = (name) => name.replace(/^_(?:local|subscribed)\/.*\//, "");
