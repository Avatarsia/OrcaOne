// Page "Slicer", the technical overview: per installation where its data lives, how big each part
// is and what Orfix does with it (FINDINGS 4.2 and 4.3). Paths and file names are welcome here,
// but every entry says in plain words what it is. Data: ORFIX_DATA.instances[].slicer_page.
import { INSTANCES, LABELS, DATA, ui, flash, fmtSize, plural, timeText } from "../common.js";

const { reactive, computed, watch } = Vue;

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

// One entry of the folder tree; it renders its sub-folders with itself.
const FsNode = {
  name: "FsNode",
  props: {
    node: { type: Object, required: true },
    open: { type: Object, required: true },        // Set of open paths, shared by the whole tree
    parentSize: { type: Number, default: 0 },      // 0 = no size bar
    shareOf: { type: String, default: "" },        // "vom Datenordner", "von system/"
  },

  setup(props) {
    // Files next to the profiles that are no profiles (FINDINGS 4.2), shown inside their folder.
    const extras = computed(() => (props.node.extra_files || []).map((x) => ({
      name: x.path.slice(props.node.path.length + 1), path: x.path, type: "file", files: 1,
      category: props.node.category, note: x.note, size: null, backup: props.node.backup,
    })));
    const expandable = computed(() => !!((props.node.children || []).length || extras.value.length));
    const isOpen = computed(() => props.open.has(props.node.path));
    function toggle() {
      if (isOpen.value) props.open.delete(props.node.path);
      else props.open.add(props.node.path);
    }
    const icon = computed(() => props.node.type !== "dir" ? "file" : isOpen.value ? "folderOpen" : "folder");
    const share = computed(() => props.parentSize > 0 && props.node.size ? props.node.size / props.parentSize : 0);
    // At least a sliver, so a tiny folder still shows it is not empty.
    const barWidth = computed(() => share.value ? Math.max(share.value * 100, 3).toFixed(1) + "%" : "0");
    const shareText = computed(() => {
      if (!share.value) return "";
      const pct = share.value * 100;
      return (pct < 1 ? "unter 1" : Math.round(pct)) + " % " + props.shareOf;
    });
    const sizeText = computed(() => props.node.size === 0 && !props.node.files ? "leer" : fmtSize(props.node.size));
    return { LABELS, extras, expandable, isOpen, toggle, icon, barWidth, shareText, sizeText, plural };
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
            <span class="fs-name">{{ node.name }}<span v-if="node.type === 'dir'" class="fs-slash">/</span></span>
            <span v-if="node.type === 'dir' && node.files" class="fs-files">{{ plural(node.files, 'Datei', 'Dateien') }}</span>
            <span v-if="node.active" class="badge" title="Diesen Ordner nutzt der Slicer gerade">aktiv</span>
            <span v-if="node.example" class="tag-example" title="Nur im Entwurf, im echten Ordner gibt es diese Datei nicht">Beispiel</span>
            <span v-if="node.secret" class="fs-flag"><ui-icon name="key" :size="14"/>Zugangsdaten</span>
          </span>
          <span class="fs-note">{{ node.note }}</span>
        </span>
        <span class="fs-meta">
          <span v-if="node.size !== null" class="fs-size" :title="shareText">
            <span v-if="parentSize" class="bar" aria-hidden="true"><span class="bar-fill" :style="{ width: barWidth }"></span></span>
            <span class="fs-bytes">{{ sizeText }}</span>
          </span>
          <span class="cat"><span class="cat-dot"></span>{{ LABELS.category[node.category] }}</span>
          <span v-if="node.backup === false" class="fs-nobackup">Nicht in der Sicherung</span>
        </span>
      </div>
      <ul v-if="expandable && isOpen" class="fs-children">
        <fs-node v-for="c in node.children || []" :key="c.path" :node="c" :open="open"
                 :parent-size="node.size" :share-of="'von ' + node.name + '/'"/>
        <fs-node v-for="x in extras" :key="x.path" :node="x" :open="open"/>
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
    const pick = (id) => { ui.instId = id; };
    const generated = timeText(new Date(DATA.generated));

    // ------------------------------------------------------------ tree
    // Open at first: user/ and the folder the slicer uses right now, the parts Orfix writes to.
    const open = reactive(new Set());
    const expandablePaths = computed(() => {
      const out = [];
      const walk = (nodes) => nodes.forEach((n) => {
        if ((n.children || []).length || (n.extra_files || []).length) out.push(n.path);
        walk(n.children || []);
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
      for (const n of sp.value.tree) sums[n.category] = (sums[n.category] || 0) + n.size;
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
      + (c.own_examples ? " · " + plural(c.own_examples, "Beispiel", "Beispiele") + " im Entwurf" : "");

    return {
      INSTANCES, LABELS, KINDS, inst, sp, bp, cards, pick, generated, open, allOpen, toggleAll, outside,
      usage, usageText, credText, ownText, fmtSize, plural, flash,
    };
  },

  template: `
    <div class="page">
      <div class="page-head">
        <h1 id="page-title" tabindex="-1">Slicer</h1>
        <p>Wo deine Slicer ihre Daten ablegen und was Orfix damit macht. Stand {{ generated }} Uhr.</p>
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
            <p>Vor jeder Änderung, jederzeit zurückzuholen.</p>
          </div>
        </div>
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
                <span :class="['status', { 'status--busy': c.i.running }]">{{ c.i.running ? 'Läuft – nur ansehen' : 'Geschlossen' }}</span>
                <span v-if="c.i.id === inst.id && cards.length > 1" class="shown"><ui-icon name="check" :size="14"/>Unten gezeigt</span>
              </span>
            </button>
          </h2>
          <dl class="facts">
            <div><dt>Datenordner</dt><dd><code>{{ c.sp.path }}</code></dd></div>
            <div><dt>Gefunden als</dt><dd>{{ LABELS.source[c.sp.source] || c.sp.source }}</dd></div>
            <div><dt>Eigene Profile</dt><dd><code>{{ c.sp.user_folder }}/</code> · {{ c.sp.logged_in ? 'angemeldet' : 'nicht angemeldet' }}</dd></div>
            <div><dt>Herstellerprofile</dt><dd>{{ c.sp.system_format_text }}</dd></div>
            <div><dt>Größe</dt><dd>{{ fmtSize(c.sp.totals.size) }} · {{ plural(c.sp.totals.files, 'Datei', 'Dateien') }}</dd></div>
          </dl>
        </article>
      </section>

      <p v-if="inst.running" class="banner">{{ inst.slicer }} läuft. Solange zeigt Orfix alles nur an und ändert nichts.</p>

      <div class="section-head">
        <h2>Datenordner von {{ inst.slicer }}</h2>
        <code>{{ sp.path }}</code>
      </div>

      <section class="box" aria-labelledby="usage-h">
        <div class="box-head">
          <h3 id="usage-h">Platz</h3>
          <span class="sub">{{ fmtSize(sp.totals.size) }} in {{ plural(sp.totals.files, 'Datei', 'Dateien') }}</span>
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
          <fs-node v-for="n in sp.tree" :key="n.path" :node="n" :open="open" :parent-size="sp.totals.size" share-of="vom Datenordner"/>
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
        <form class="add-form" @submit.prevent="flash('Im Entwurf nicht möglich.')">
          <input class="input" type="text" autocomplete="off" placeholder="/pfad/zum/datenordner" aria-label="Datenordner">
          <button class="btn" type="submit">Hinzufügen</button>
        </form>
      </section>
    </div>
  `,
};
