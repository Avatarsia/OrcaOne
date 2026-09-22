// Page "Slicer", the technical overview: per installation where its data lives, how big each part
// is and what Orfix does with it (FINDINGS 4.2 and 4.3). Paths and file names are welcome here,
// but every entry says in plain words what it is. It takes over the start page of orfix/static:
// all installations, why one is read-only, account, problems, hints, adding a data directory.
// Data: ORFIX_DATA.instances[].slicer_page and .warnings.
import {
  INSTANCES, LABELS, ui, showExample, runReason, go, hashOf, flash, fmtSize, plural, generatedText,
} from "../common.js";
import { T } from "../../../../orfix/static/texts.js";

const { ref, reactive, computed, watch } = Vue;

// Order of the size overview: what Orfix writes to first.
const CATEGORIES = ["managed", "system", "unmanaged", "temp", "sensitive"];
const KINDS = [
  { id: "machine", icon: "printer", one: "Drucker", many: "Drucker" },
  { id: "process", icon: "layers", one: "Prozess", many: "Prozesse" },
  { id: "filament", icon: "spool", one: "Filament", many: "Filamente" },
];
// Credentials in the .conf, only counted by make_data.py (FINDINGS 4.3). Orfix never shows the values.
const CREDENTIALS = {
  access_code: ["Zugangscode", "Zugangscodes"],
  api_key: ["API-Schlüssel", "API-Schlüssel"],
  user: ["Benutzername", "Benutzernamen"],
  password: ["Passwort", "Passwörter"],
  ca: ["Zertifikat", "Zertifikate"],
  cert: ["Zertifikat", "Zertifikate"],
  key: ["privater Schlüssel", "private Schlüssel"],
  clientId: ["Geräte-Kennung", "Geräte-Kennungen"],
};
// Stand-in logo from the capital letters: "Snapmaker Orca" -> "SO", "OrcaSlicer" -> "OS".
const logoText = (name) => (name.match(/[A-Z]/g) || [name[0] || "?"]).slice(0, 2).join("");
const DONE = " – im Entwurf wird nichts gespeichert.";
// Hints from make_data.py (inst.warnings): always a word next to the colour.
const LEVELS = {
  error: { icon: "warn", text: "Fehler" },
  warning: { icon: "warn", text: "Achtung" },
  info: { icon: "info", text: "Hinweis" },
};
// Size and files without the example profiles while they are hidden.
const sizeOf = (n) => n.size === null ? null : n.size - (ui.examples ? 0 : n.example_size || 0);
const filesOf = (n) => n.files - (ui.examples ? 0 : n.example_files || 0);
const childrenOf = (n) => (n.children || []).filter(showExample);

// One entry of the folder tree; it renders its sub-folders with itself. The category label only
// shows where it differs from the folder above, so the tree stays calm.
const FsNode = {
  name: "FsNode",
  props: {
    node: { type: Object, required: true },
    open: { type: Object, required: true },        // Set of open paths, shared by the whole tree
    parentSize: { type: Number, default: 0 },      // 0 = no size bar
    shareOf: { type: String, default: "" },        // "vom Datenordner", "von system/"
    parentCategory: { type: String, default: "" },
  },

  setup(props) {
    // Files next to the profiles that are no profiles (FINDINGS 4.2), shown inside their folder.
    const extras = computed(() => (props.node.extra_files || []).map((x) => ({
      name: x.path.slice(props.node.path.length + 1), path: x.path, type: "file", files: 1,
      category: props.node.category, note: x.note, size: null, backup: props.node.backup,
    })));
    const children = computed(() => childrenOf(props.node));
    const expandable = computed(() => !!(children.value.length || extras.value.length));
    const isOpen = computed(() => props.open.has(props.node.path));
    function toggle() {
      if (isOpen.value) props.open.delete(props.node.path);
      else props.open.add(props.node.path);
    }
    const icon = computed(() => props.node.type === "dir" ? (isOpen.value ? "folderOpen" : "folder") : "file");
    const size = computed(() => sizeOf(props.node));
    const files = computed(() => filesOf(props.node));
    const share = computed(() => props.parentSize > 0 && size.value ? size.value / props.parentSize : 0);
    // At least a sliver, so a tiny folder still shows it is not empty.
    const barWidth = computed(() => share.value ? Math.max(share.value * 100, 3).toFixed(1) + "%" : "0");
    const shareText = computed(() => {
      if (!share.value) return "";
      const pct = share.value * 100;
      return (pct < 1 ? "unter 1" : Math.round(pct)) + " % " + props.shareOf;
    });
    const sizeText = computed(() => size.value === 0 && !files.value ? "leer" : fmtSize(size.value));
    const showCategory = computed(() => props.node.category !== props.parentCategory);
    return { LABELS, extras, children, expandable, isOpen, toggle, icon, size, files, barWidth, shareText, sizeText, showCategory, plural };
  },

  template: `
    <li :class="['fs-item', 'cat-' + node.category]">
      <div class="fs-row">
        <button v-if="expandable" class="fs-toggle" type="button" :aria-expanded="isOpen ? 'true' : 'false'"
                :aria-label="node.name + (isOpen ? ' zuklappen' : ' aufklappen')" @click="toggle"><ui-icon name="chevron" class="chev"/></button>
        <span v-else class="fs-toggle" aria-hidden="true"></span>
        <span class="fs-icon"><ui-icon :name="icon"/></span>
        <span :class="['fs-text', { 'can-open': expandable }]" @click="expandable && toggle()">
          <span class="fs-line">
            <span v-if="node.type === 'profile'" class="fs-name">{{ node.name }}.json<span class="fs-slash"> + .info</span></span>
            <span v-else class="fs-name">{{ node.name }}<span v-if="node.type === 'dir'" class="fs-slash">/</span></span>
            <span v-if="node.type === 'dir' && files" class="fs-files">{{ plural(files, 'Datei', 'Dateien') }}</span>
            <span v-if="node.active" class="badge" title="Diesen Ordner nutzt der Slicer gerade">aktiv</span>
            <span v-if="node.example" class="tag-example" title="Nur im Entwurf, im echten Ordner gibt es diese Datei nicht">Beispiel</span>
            <span v-if="node.secret" class="fs-flag"><ui-icon name="key" :size="14"/>Zugangsdaten</span>
          </span>
          <span class="fs-note">{{ node.note }}</span>
        </span>
        <span class="fs-meta">
          <span v-if="size !== null" class="fs-size" :title="shareText">
            <span v-if="parentSize" class="bar" aria-hidden="true"><span class="bar-fill" :style="{ width: barWidth }"></span></span>
            <span class="fs-bytes">{{ sizeText }}</span>
          </span>
          <span v-if="showCategory" class="cat"><span class="cat-dot"></span>{{ LABELS.category[node.category] }}</span>
          <span v-if="node.backup === false" class="fs-nobackup">Nicht in der Sicherung</span>
        </span>
      </div>
      <ul v-if="expandable && isOpen" class="fs-children">
        <fs-node v-for="c in children" :key="c.path" :node="c" :open="open"
                 :parent-size="size || 0" :share-of="'von ' + node.name + '/'" :parent-category="node.category"/>
        <fs-node v-for="x in extras" :key="x.path" :node="x" :open="open" :parent-category="node.category"/>
      </ul>
    </li>
  `,
};

export default {
  name: "SlicerPage",
  components: { FsNode },
  props: { instId: { type: String, required: true } },

  setup(props) {
    const inst = computed(() => INSTANCES.find((i) => i.id === props.instId));
    const sp = computed(() => inst.value.slicer_page);
    const bp = computed(() => inst.value.backups_page);
    const cards = INSTANCES.map((i) => ({ i, sp: i.slicer_page, logo: logoText(i.slicer) }));
    // The address carries the installation, so a card switches it there (app.js follows).
    const pick = (id) => { if (id !== ui.instId) go(null, hashOf("slicer", id)); };
    const totalOf = (s) => ({ size: sizeOf(s.totals), files: filesOf(s.totals) });

    // ------------------------------------------------------------ hints
    const hints = computed(() => inst.value.warnings.filter(showExample));

    // ------------------------------------------------------------ data directories added by hand
    // In the draft only a list in memory; the real app keeps it and reads the folder.
    const newPath = ref("");
    const manual = reactive([]);
    function addManual() {
      const path = newPath.value.trim();
      if (!path) return;
      if (!manual.includes(path)) manual.push(path);
      newPath.value = "";
      flash("Hinzugefügt" + DONE);
    }
    function removeManual(path) {
      manual.splice(manual.indexOf(path), 1);
      flash("Entfernt" + DONE);
    }

    // ------------------------------------------------------------ tree
    // Open at first: user/ and the folder the slicer uses right now, the parts Orfix writes to.
    const open = reactive(new Set());
    const expandablePaths = computed(() => {
      const out = [];
      const walk = (nodes) => nodes.forEach((n) => {
        if (childrenOf(n).length || (n.extra_files || []).length) out.push(n.path);
        walk(childrenOf(n));
      });
      walk(sp.value.tree);
      return out;
    });
    watch(() => props.instId, () => {
      open.clear();
      const walk = (nodes) => nodes.forEach((n) => {
        if (n.children && n.category === "managed" && (n.active || !n.path.includes("/"))) open.add(n.path);
        walk(n.children || []);
      });
      walk(sp.value.tree);
    }, { immediate: true });
    const allOpen = computed(() => expandablePaths.value.every((p) => open.has(p)));
    function toggleAll() {
      if (allOpen.value) open.clear();
      else expandablePaths.value.forEach((p) => open.add(p));
    }
    const outside = computed(() => sp.value.outside.map((n) => ({ ...n, name: n.path, type: "dir" })));

    // ------------------------------------------------------------ figures
    const usage = computed(() => {
      const sums = {};
      for (const n of sp.value.tree) sums[n.category] = (sums[n.category] || 0) + sizeOf(n);
      const total = Object.values(sums).reduce((a, b) => a + b, 0) || 1;
      return CATEGORIES.filter((c) => sums[c] > 0).map((c) => ({ c, size: sums[c], share: sums[c] / total }));
    });
    const usageText = computed(() => usage.value.map((u) => LABELS.category[u.c] + " " + fmtSize(u.size)).join(", "));
    const credText = computed(() => {
      const parts = Object.entries(sp.value.conf.credentials).filter(([, n]) => n > 0)
        .map(([k, n]) => plural(n, ...(CREDENTIALS[k] || [k, k])));
      return parts.length ? parts.join(", ") + ". Orfix zeigt sie nie an." : "keine";
    });
    const ownText = (c) => (c.own ? plural(c.own, "eigenes Profil", "eigene Profile") : "Keine eigenen Profile")
      + (c.own_examples && ui.examples ? " · " + plural(c.own_examples, "Beispiel", "Beispiele") + " im Entwurf" : "");

    return {
      INSTANCES, LABELS, KINDS, LEVELS, T, DONE, inst, sp, bp, cards, pick, generatedText, open, allOpen, toggleAll, outside,
      usage, usageText, credText, ownText, totalOf, hints, newPath, manual, addManual, removeManual,
      fmtSize, plural, flash, runReason,
    };
  },


  template: `
    <div class="page">
      <div class="page-head">
        <h1 id="page-title" tabindex="-1">Slicer</h1>
        <p>Wo deine Slicer ihre Daten ablegen und was Orfix damit macht. Stand {{ generatedText }} Uhr.</p>
      </div>

      <div class="scope-grid">
        <div class="scope-card is-write">
          <span class="scope-icon"><ui-icon name="pencil"/></span>
          <div>
            <strong>Orfix ändert nur</strong>
            <p><code>user/</code> und <code>{{ sp.conf.file }}</code>, und nur bei geschlossenem Slicer.</p>
          </div>
        </div>
        <div class="scope-card">
          <span class="scope-icon"><ui-icon name="eye"/></span>
          <div>
            <strong>Alles andere liest Orfix nur</strong>
            <p>Herstellerpakete, Protokolle, Zwischenspeicher und die Web-Oberfläche.</p>
          </div>
        </div>
        <div class="scope-card">
          <span class="scope-icon"><ui-icon name="backup"/></span>
          <div>
            <strong>Vorher eine Sicherung</strong>
            <p>Vor jeder Änderung. Damit lässt sich jederzeit alles wiederherstellen.</p>
          </div>
        </div>
      </div>

      <div class="section-head">
        <h2>Alle Installationen</h2>
        <span class="sub">{{ plural(cards.length + manual.length, 'Installation', 'Installationen') }} gefunden</span>
      </div>
      <section class="inst-cards" aria-label="Installationen">
        <article v-for="c in cards" :key="c.i.id" :class="['inst-card', { 'is-current': c.i.id === inst.id }]" @click="pick(c.i.id)">
          <h2>
            <button class="inst-card-head" type="button" :aria-pressed="c.i.id === inst.id ? 'true' : 'false'" @click.stop="pick(c.i.id)">
              <span :class="['slicer-logo', 'slicer-logo--' + c.i.id]" aria-hidden="true">{{ c.logo }}</span>
              <span class="inst-card-title">
                <span class="inst-card-name">{{ c.i.slicer }}</span>
                <span class="inst-card-version">Version {{ c.i.version }}</span>
              </span>
              <span class="inst-card-state">
                <run-status :inst="c.i"/>
                <span v-if="c.i.id === inst.id && cards.length > 1" class="shown"><ui-icon name="check" :size="14"/>Unten gezeigt</span>
              </span>
            </button>
          </h2>
          <p v-if="c.i.running" class="run-reason"><ui-icon name="lock"/><span>{{ runReason(c.i) }} Zum Ändern {{ c.i.slicer }} schließen und neu einlesen.</span></p>
          <p v-for="p in c.i.problems" :key="p" class="alert">{{ T.problems[p] || p }}</p>
          <dl class="facts">
            <div><dt>Datenordner</dt><dd><code>{{ c.sp.path }}</code></dd></div>
            <div><dt>Gefunden als</dt><dd>{{ LABELS.source[c.sp.source] || c.sp.source }}</dd></div>
            <div><dt>Eigene Profile</dt><dd><code>{{ c.sp.user_folder }}/</code></dd></div>
            <div><dt>Konto</dt><dd>{{ c.sp.logged_in ? T.facts.loggedIn : T.facts.notLoggedIn }}</dd></div>
            <div><dt>Herstellerprofile</dt><dd>{{ c.sp.system_format_text }}</dd></div>
            <div><dt>Größe</dt><dd>{{ fmtSize(totalOf(c.sp).size) }} · {{ plural(totalOf(c.sp).files, 'Datei', 'Dateien') }}</dd></div>
          </dl>
          <div v-if="c.sp.source === 'manual'" class="actions">
            <button class="btn" type="button" @click.stop="flash('Entfernt' + DONE)">Entfernen</button>
          </div>
        </article>
        <article v-for="m in manual" :key="m" class="inst-card is-manual">
          <div class="inst-card-head is-static">
            <span class="slicer-logo slicer-logo--manual" aria-hidden="true"><ui-icon name="folder" :size="24"/></span>
            <span class="inst-card-title">
              <span class="inst-card-name">{{ LABELS.source.manual }}</span>
              <span class="inst-card-version">Im Entwurf nicht eingelesen</span>
            </span>
          </div>
          <dl class="facts">
            <div><dt>Datenordner</dt><dd><code>{{ m }}</code></dd></div>
          </dl>
          <div class="actions">
            <button class="btn" type="button" @click="removeManual(m)">Entfernen</button>
          </div>
        </article>
      </section>

      <p v-if="inst.running" class="banner">{{ runReason(inst) }} Solange zeigt Orfix alles nur an und ändert nichts.</p>

      <div class="section-head">
        <h2>Datenordner von {{ inst.slicer }}</h2>
        <code>{{ sp.path }}</code>
      </div>

      <section class="box" aria-labelledby="hints-h">
        <div class="box-head">
          <h3 id="hints-h">Hinweise</h3>
          <span v-if="hints.length" class="count">{{ hints.length }}</span>
          <span class="sub">Was Orfix beim Einlesen aufgefallen ist.</span>
        </div>
        <ul v-if="hints.length" class="hint-list">
          <li v-for="w in hints" :key="w.code + w.text" :class="['hint', 'hint--' + w.level]">
            <span class="hint-icon"><ui-icon :name="LEVELS[w.level].icon"/></span>
            <div class="hint-text">
              <p class="hint-title">
                <span class="hint-level">{{ LEVELS[w.level].text }}</span>
                {{ w.text }}
                <span v-if="w.example" class="tag-example" title="Nur im Entwurf, das Profil gibt es im Slicer nicht">Beispiel</span>
              </p>
              <p class="note">{{ w.action }}</p>
              <details v-if="w.names.length > 1" class="more">
                <summary>{{ plural(w.names.length, 'Profil', 'Profile') }} zeigen</summary>
                <ul class="file-list"><li v-for="n in w.names" :key="n"><code>{{ n }}</code></li></ul>
              </details>
            </div>
          </li>
        </ul>
        <p v-else class="all-clean"><ui-icon name="check"/>Nichts aufgefallen.</p>
      </section>

      <section class="box" aria-labelledby="usage-h">
        <div class="box-head">
          <h3 id="usage-h">Platz</h3>
          <span class="sub">{{ fmtSize(totalOf(sp).size) }} in {{ plural(totalOf(sp).files, 'Datei', 'Dateien') }}</span>
        </div>
        <div class="usage-bar" role="img" :aria-label="usageText">
          <span v-for="u in usage" :key="u.c" :class="['usage-seg', 'cat-' + u.c]" :style="{ flex: u.share + ' 1 0' }"
                :title="LABELS.category[u.c] + ': ' + fmtSize(u.size)"></span>
        </div>
        <ul class="usage-legend">
          <li v-for="u in usage" :key="u.c" :class="['cat', 'cat-' + u.c]"><span class="cat-dot"></span>{{ LABELS.category[u.c] }} <b>{{ fmtSize(u.size) }}</b></li>
        </ul>
      </section>

      <section class="box" aria-labelledby="tree-h">
        <div class="box-head">
          <h3 id="tree-h">Ordner und Dateien</h3>
          <span class="sub">Aufklappen zeigt, was drinliegt.</span>
          <button class="link right" type="button" @click="toggleAll">{{ allOpen ? 'Alle zuklappen' : 'Alle aufklappen' }}</button>
        </div>
        <ul class="fs">
          <fs-node v-for="n in sp.tree" :key="n.path" :node="n" :open="open" :parent-size="totalOf(sp).size" share-of="vom Datenordner"/>
        </ul>
      </section>

      <section v-if="outside.length" class="box" aria-labelledby="outside-h">
        <div class="box-head">
          <h3 id="outside-h">Außerhalb des Datenordners</h3>
          <span class="sub">Legt der Slicer selbst an. Orfix nennt die Ordner nur.</span>
        </div>
        <ul class="fs">
          <fs-node v-for="n in outside" :key="n.path" :node="n" :open="open"/>
        </ul>
      </section>

      <section class="box" aria-labelledby="pkg-h">
        <div class="box-head">
          <h3 id="pkg-h">Herstellerpakete</h3>
          <span class="sub">in <code>system/</code> · {{ sp.system_format_text }}</span>
        </div>
        <ul class="pkg-list">
          <li v-for="p in sp.packages" :key="p.name" class="pkg">
            <span class="kind-icon"><ui-icon :name="p.role === 'library' ? 'books' : 'factory'"/></span>
            <div class="pkg-text">
              <p class="pkg-line">
                <span class="pkg-name">{{ p.name }}</span>
                <span class="mat">{{ p.role === 'library' ? 'Bibliothek' : 'Hersteller' }}</span>
                <span class="version">Version {{ p.version_display }}</span>
              </p>
              <p class="fs-note">{{ p.note }}</p>
              <p class="pkg-counts">
                <span v-for="k in KINDS.filter((x) => p.counts[x.id])" :key="k.id" class="pkg-count">
                  <ui-icon :name="k.icon" :size="14"/>{{ plural(p.counts[k.id], k.one, k.many) }}
                </span>
                <span v-if="p.models" class="pkg-count"><ui-icon name="printer" :size="14"/>{{ plural(p.models, 'Druckermodell', 'Druckermodelle') }}</span>
              </p>
              <p class="pkg-file">
                <code>{{ p.file }}</code><template v-if="p.folder"> und <code>{{ p.folder }}/</code></template>
                · {{ fmtSize(p.size) }} · {{ plural(p.files, 'Datei', 'Dateien') }}
                <template v-if="p.extra_files"> · {{ plural(p.extra_files.length, 'Datei', 'Dateien') }} außerhalb des Inhaltsverzeichnisses</template>
              </p>
            </div>
          </li>
        </ul>
        <p class="note refresh"><ui-icon name="refresh"/>{{ sp.system_refresh.text }}</p>
      </section>

      <section class="box" aria-labelledby="stats-h">
        <div class="box-head">
          <h3 id="stats-h">Profile</h3>
          <span class="sub">So viele kennt der Slicer.</span>
        </div>
        <div class="stats">
          <div v-for="k in KINDS" :key="k.id" class="stat">
            <span class="kind-icon"><ui-icon :name="k.icon"/></span>
            <span class="stat-label">{{ LABELS.kind[k.id] }}</span>
            <span class="stat-big">{{ sp.profile_counts[k.id].system_selectable }}</span>
            <span class="stat-sub">zur Auswahl vom Hersteller</span>
            <span class="stat-sub" title="Vorlagen, von denen die wählbaren Profile ihre Werte erben. Im Slicer nicht wählbar.">
              + {{ sp.profile_counts[k.id].system - sp.profile_counts[k.id].system_selectable }} Grundprofile im Hintergrund
            </span>
            <span class="stat-own">{{ ownText(sp.profile_counts[k.id]) }}</span>
          </div>
        </div>
      </section>

      <div class="grid-2">
        <section class="box" aria-labelledby="conf-h">
          <div class="box-head"><h3 id="conf-h">Einstellungsdatei</h3></div>
          <dl class="facts">
            <div><dt>Datei</dt><dd><code>{{ sp.conf.file }}</code></dd></div>
            <div><dt>Größe</dt><dd>{{ fmtSize(sp.conf.size) }} · {{ plural(sp.conf.sections, 'Abschnitt', 'Abschnitte') }}</dd></div>
            <div><dt>Einrückung</dt><dd>{{ sp.conf.indent_text }}</dd></div>
            <div><dt>Prüfsumme</dt><dd>{{ sp.conf.checksum ? 'MD5-Zeile am Ende' : 'keine, die gibt es nur unter Windows' }}</dd></div>
            <div><dt>Zugangsdaten</dt><dd>{{ credText }}</dd></div>
          </dl>
          <p class="note">Hier stehen die eingerichteten Drucker, die sichtbaren Filamente und die zuletzt gewählten Profile. Orfix ändert nur einzelne Einträge und schreibt die Datei im selben Format zurück.</p>
        </section>

        <section class="box" aria-labelledby="backup-h">
          <div class="box-head"><h3 id="backup-h">Sicherung</h3></div>
          <p>Vor jeder Änderung packt Orfix {{ plural(sp.totals.backup_files, 'Datei', 'Dateien') }} ({{ fmtSize(sp.totals.backup_size) }}) in ein ZIP von etwa {{ fmtSize(sp.totals.backup_zip_size) }}.</p>
          <p class="note">Nicht dabei:</p>
          <p class="chip-list"><code v-for="x in bp.excluded" :key="x">{{ x }}</code></p>
          <p class="note">Ablage: <code>{{ bp.location }}</code></p>
          <p class="secret-note"><ui-icon name="key"/><span>{{ bp.note }}</span></p>
        </section>
      </div>

      <section class="box" aria-labelledby="add-h">
        <div class="box-head"><h3 id="add-h">Datenordner hinzufügen</h3></div>
        <p class="note">Für eine portable Installation oder einen Slicer, der mit <code>--datadir</code> startet. Gemeint ist der Ordner, in dem die <code>.conf</code> liegt.</p>
        <form class="add-form" @submit.prevent="addManual">
          <input v-model="newPath" class="input" type="text" autocomplete="off" placeholder="/pfad/zum/datenordner" aria-label="Datenordner">
          <button class="btn" type="submit" :disabled="!newPath.trim()">Hinzufügen</button>
        </form>
      </section>
    </div>
  `,
};
