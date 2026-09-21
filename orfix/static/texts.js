// All user-facing texts. German, sentence case; an action and its message use the
// same word (button "Hinzufügen" -> message "Hinzugefügt").

export const T = {
  appName: "Orfix",
  instanceLabel: "Installation",
  reload: "Neu einlesen",
  loading: "Lese Installationen …",
  tabs: {
    label: "Seiten",
    overview: "Übersicht",
    manage: "Verwalten",
    manageLater: "Kommt in Phase 2",
  },
  slicerNames: {
    Snapmaker_Orca: "Snapmaker Orca",
    OrcaSlicer: "OrcaSlicer",
  },
  sources: {
    auto: "Standardort",
    flatpak: "Flatpak",
    flatpak_legacy: "Flatpak, alte ID (veraltete Kopie)",
    appimage_portable: "AppImage, portabel",
    process: "Laufender Slicer mit --datadir",
    manual: "Von Hand hinzugefügt",
  },
  status: {
    running: "Läuft – nur lesen",
    maybeRunning: "Läuft vielleicht – nur lesen",
    closed: "Geschlossen",
  },
  runDetail(state, slicer) {
    const pids = state.pids.join(", ");
    if (state.reason === "lock" || state.reason === "process") {
      return `${slicer} läuft gerade (PID ${pids}). Schließe das Programm, um Änderungen zu speichern.`;
    }
    if (state.reason === "process_unmapped") {
      return `Ein ${slicer}-Prozess läuft (PID ${pids}), sein Datenordner ist unbekannt. Deshalb ist jede ${slicer}-Installation schreibgeschützt. Schließe das Programm, um Änderungen zu speichern.`;
    }
    return `${slicer} ist geschlossen.`;
  },
  facts: {
    title: "Installation",
    slicer: "Slicer",
    version: "Version",
    versionUnknown: "unbekannt",
    path: "Datenordner",
    source: "Gefunden als",
    userFolder: "Eigene Profile",
    userFolderActive: "aktiv",
    loggedIn: "Angemeldet – Profile werden womöglich mit der Cloud synchronisiert",
    notLoggedIn: "Nicht angemeldet",
    account: "Konto",
    systemFormat: "Systemprofile",
    formats: { json: "JSON", opc: ".opc (OrcaSlicer 2.5, binär)" },
    noSystem: "keine",
    confFormat: "Format der .conf",
    indentTab: "Tab-Einrückung",
    indentSpaces: "4 Leerzeichen",
    checksum: "mit Windows-Prüfsumme",
    problems: "Probleme",
  },
  problems: {
    conf_unreadable: "Die .conf ließ sich nicht lesen. Ist sie beschädigt, setzt der Slicer beim nächsten Start alle Einstellungen zurück (unter Windows versucht er vorher die .bak). Sichere die Datei vorher, wenn du sie reparieren willst.",
    dir_unreadable: "Ein Ordner im Datenverzeichnis ist nicht lesbar. Prüfe die Zugriffsrechte, etwa ob er nach einem Start mit sudo root gehört.",
  },
  profilesPending: {
    title: "Profile",
    text: "Die Übersicht der Drucker, Filamente und Prozesse kommt in Phase 1.",
  },
  drafts: {
    title: "Entwurf für die Übersicht",
    hint: "Gewählte Richtung für Phase 1, öffnet sich in einem neuen Tab. Die Daten stammen aus deinen Installationen, eigene Profile sind Beispiele.",
    links: [
      { href: "/prototypes/ui-overview/variante-d.html", label: "D – Nur das Nötigste, Rest in der Seitenleiste" },
    ],
  },
  list: {
    title: "Alle gefundenen Installationen",
    slicer: "Slicer",
    version: "Version",
    path: "Datenordner",
    source: "Gefunden als",
    status: "Status",
    remove: "Entfernen",
    removed: "Entfernt",
  },
  add: {
    title: "Datenordner hinzufügen",
    hint: "Für portable Installationen oder einen Slicer, der mit --datadir startet. Gemeint ist der Ordner, in dem die Snapmaker_Orca.conf bzw. OrcaSlicer.conf liegt.",
    placeholder: "/pfad/zum/datenordner",
    button: "Hinzufügen",
    added: "Hinzugefügt",
  },
  empty: {
    title: "Keine Slicer-Installation gefunden",
    text: "Orfix hat weder Snapmaker Orca noch OrcaSlicer an den üblichen Orten gefunden. Starte den Slicer einmal, damit er seinen Datenordner anlegt, oder füge den Ordner unten von Hand hinzu.",
  },
  errors: {
    path_not_found: "Diesen Ordner gibt es nicht. Prüfe den Pfad.",
    not_a_data_dir: "In diesem Ordner liegt weder Snapmaker_Orca.conf noch OrcaSlicer.conf. Wähle den Ordner, in dem die .conf liegt.",
    already_listed: "Diese Installation findet Orfix schon von selbst. Sie steht bereits in der Liste.",
    not_listed: "Dieser Eintrag war schon entfernt.",
    save_failed: "Orfix konnte seine Liste nicht speichern. Prüfe, ob der Ordner von Orfix beschreibbar ist.",
    forbidden: "Die Anfrage wurde abgelehnt. Öffne Orfix über 127.0.0.1.",
    network: "Orfix antwortet nicht. Läuft das Programm noch? Starte es neu und lade die Seite.",
    unknown: "Etwas ist schiefgegangen. Lade die Seite neu.",
  },
};
