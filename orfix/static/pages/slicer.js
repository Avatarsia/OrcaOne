// Page "Slicer", the technical overview: per installation where its data lives, how big each part
// is and what Orfix does with it (FINDINGS 4.2 and 4.3). Paths and file names are welcome here,
// but every entry says in plain words what it is. It also lists all installations, why one is
// read-only, account, problems, hints, and adds or removes data directories by hand.
// Data: instances[].slicer_page and .warnings of GET /api/data; the backend sends codes, their
// words are in texts.js. The one change made here: hiding the list entries that fit no printer
// (warning visible_without_printer), it goes into the change list (`live` in common.js).
import {
  INSTANCES, live, ui, go, hashOf, flash, fmtSize, plural, generatedText, addDataDir, removeDataDir, unusedListNames,
} from "../common.js";
import { T } from "../texts.js";

const { ref, reactive, computed, watch } = Vue;

const S = T.slicer;
// Order of the size overview: what Orfix writes to first.
const CATEGORIES = ["managed", "system", "unmanaged", "temp", "sensitive"];
const KINDS = [
  { id: "machine", icon: "printer" },
  { id: "process", icon: "layers" },
  { id: "filament", icon: "spool" },
].map((k) => ({ ...k, words: T.words[k.id] }));
// Stand-in logo from the capital letters: "Snapmaker Orca" -> "SO", "OrcaSlicer" -> "OS".
const logoText = (name) => (name.match(/[A-Z]/g) || [name[0] || "?"]).slice(0, 2).join("");
const LEVEL_ICON = { error: "warn", warning: "warn", info: "info" };
const noteOf = (n, sp) => {
  const t = T.notes[n.note];
  const text = typeof t === "function" ? t(n, sp) : t || "";
  return n.ignored ? text + " " + T.ignoredShort[n.ignored] + "." : text;
};

// One entry of the folder tree; it renders its sub-folders with itself. The category label only
// shows where it differs from the folder above, so the tree stays calm.
const FsNode = {
  name: "FsNode",
  props: {
    node: { type: Object, required: true },
    sp: { type: Object, default: null },           // slicer_page, some notes need it
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
    const children = computed(() => props.node.children || []);
    const expandable = computed(() => !!(children.value.length || extras.value.length));
    const isOpen = computed(() => props.open.has(props.node.path));
    function toggle() {
      if (isOpen.value) props.open.delete(props.node.path);
      else props.open.add(props.node.path);
    }
    const icon = computed(() => props.node.type === "dir" ? (isOpen.value ? "folderOpen" : "folder") : "file");
    const size = computed(() => props.node.size);
    const share = computed(() => props.parentSize > 0 && size.value ? size.value / props.parentSize : 0);
    // At least a sliver, so a tiny folder still shows it is not empty.
    const barWidth = computed(() => share.value ? Math.max(share.value * 100, 3).toFixed(1) + "%" : "0");
    const shareText = computed(() => share.value ? S.share(share.value * 100, props.shareOf) : "");
    const sizeText = computed(() => size.value === 0 && !props.node.files ? S.empty : fmtSize(size.value));
    const showCategory = computed(() => props.node.category !== props.parentCategory);
    const note = computed(() => noteOf(props.node, props.sp));
    return { T, S, extras, children, expandable, isOpen, toggle, icon, size, barWidth, shareText, sizeText, showCategory, note, plural };
  },

  template: `
    <li :class="['fs-item', 'cat-' + node.category]">
      <div class="fs-row">
        <button v-if="expandable" class="fs-toggle" type="button" :aria-expanded="isOpen ? 'true' : 'false'"
                :aria-label="S.toggle(node.name, isOpen)" @click="toggle"><ui-icon name="chevron" class="chev"/></button>
        <span v-else class="fs-toggle" aria-hidden="true"></span>
        <span class="fs-icon"><ui-icon :name="icon"/></span>
        <span :class="['fs-text', { 'can-open': expandable }]" @click="expandable && toggle()">
          <span class="fs-line">
            <span v-if="node.type === 'profile'" class="fs-name">{{ node.name }}.json<span class="fs-slash"> + .info</span></span>
            <span v-else class="fs-name">{{ node.name }}<span v-if="node.type === 'dir'" class="fs-slash">/</span></span>
            <span v-if="node.type === 'dir' && node.files" class="fs-files">{{ plural(node.files, ...T.words.file) }}</span>
            <span v-if="node.active" class="badge" :title="S.activeTitle">{{ S.active }}</span>
            <span v-if="node.secret" class="fs-flag"><ui-icon name="key" :size="14"/>{{ S.credentials }}</span>
          </span>
          <span class="fs-note">{{ note }}</span>
        </span>
        <span class="fs-meta">
          <span v-if="size !== null" class="fs-size" :title="shareText">
            <span v-if="parentSize" class="bar" aria-hidden="true"><span class="bar-fill" :style="{ width: barWidth }"></span></span>
            <span class="fs-bytes">{{ sizeText }}</span>
          </span>
          <span v-if="showCategory" class="cat"><span class="cat-dot"></span>{{ T.labels.category[node.category] }}</span>
          <span v-if="node.backup === false" class="fs-nobackup">{{ S.notInBackup }}</span>
        </span>
      </div>
      <ul v-if="expandable && isOpen" class="fs-children">
        <fs-node v-for="c in children" :key="c.path" :node="c" :sp="sp" :open="open"
                 :parent-size="size || 0" :share-of="S.shareOfFolder(node.name)" :parent-category="node.category"/>
        <fs-node v-for="x in extras" :key="x.path" :node="x" :sp="sp" :open="open" :parent-category="node.category"/>
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
    const cards = computed(() => INSTANCES.map((i) => ({ i, sp: i.slicer_page, logo: logoText(i.slicer) })));
    // The address carries the installation, so a card switches it there (app.js follows).
    const pick = (id) => { if (id !== ui.instId) go(null, hashOf("slicer", id)); };
    const hints = computed(() => inst.value.warnings);
    const hintText = (w) => T.warnings[w.code]?.text(w, T) ?? w.code;
    const hintAction = (w) => T.warnings[w.code]?.action ?? "";
    // "Ausblenden" for the filaments that fit no printer: into the change list, like on the other pages.
    const canHide = (w) => w.code === "visible_without_printer" && unusedListNames(inst.value).length > 0;
    const hideQueued = computed(() => !!live[props.instId]?.hideUnused);
    function hideUnused() {
      if (inst.value.running || hideQueued.value) return;
      live[props.instId].hideUnused = true;
      flash(S.hints.hideQueued);
    }
    const formatText = (s) => S.systemFormats[s.system_format] || s.system_format;

    // ------------------------------------------------------------ data directories added by hand
    const newPath = ref("");
    const busy = ref(false);
    const addError = ref("");
    const errorText = (code) => T.errors[code] || T.errors.unknown;
    async function addManual() {
      const path = newPath.value.trim();
      if (!path || busy.value) return;
      busy.value = true;
      addError.value = "";
      const code = await addDataDir(path);
      busy.value = false;
      if (code) {
        addError.value = errorText(code);
        return;
      }
      newPath.value = "";
      flash(T.add.added);
    }
    async function removeManual(i) {
      if (busy.value) return;
      busy.value = true;
      const code = await removeDataDir(i);
      busy.value = false;
      flash(code ? errorText(code) : S.removed);
    }

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
    const usageText = computed(() => usage.value.map((u) => T.labels.category[u.c] + " " + fmtSize(u.size)).join(", "));
    // Credentials in the .conf, only counted by the backend (FINDINGS 4.3). Orfix never shows the values.
    const credText = computed(() => {
      const parts = Object.entries(sp.value.conf.credentials).filter(([, n]) => n > 0)
        .map(([k, n]) => plural(n, ...(S.credentialWords[k] || [k, k])));
      return parts.length ? S.credentialsList(parts.join(", ")) : S.noCredentials;
    });
    const indentText = computed(() => {
      const c = sp.value.conf;
      return c.indent ? T.confIndent[c.indent](c.indent_width) : "–";
    });
    const ownText = (c) => c.own ? plural(c.own, ...T.words.ownProfile) : S.noOwn;
    const packageNote = (p) => T.packageNotes[p.note](p) + (p.error ? " " + (T.packageErrors[p.error] || "") : "");

    return {
      T, S, KINDS, LEVEL_ICON, inst, sp, bp, cards, pick, generatedText, open, allOpen, toggleAll, outside,
      usage, usageText, credText, indentText, ownText, packageNote, formatText, hints, hintText, hintAction,
      canHide, hideQueued, hideUnused, newPath, busy, addError, addManual, removeManual, fmtSize, plural,
    };
  },

  template: `
    <div class="page">
      <div class="page-head">
        <h1 id="page-title" tabindex="-1">{{ S.title }}</h1>
        <p>{{ S.lead(generatedText) }}</p>
      </div>

      <div class="scope-grid">
        <div class="scope-card is-write">
          <span class="scope-icon"><ui-icon name="pencil"/></span>
          <div>
            <strong>{{ S.scope.writeTitle }}</strong>
            <p><code>user/</code> {{ S.scope.and }} <code>{{ sp.conf.file }}</code>{{ S.scope.writeText }}</p>
          </div>
        </div>
        <div class="scope-card">
          <span class="scope-icon"><ui-icon name="eye"/></span>
          <div>
            <strong>{{ S.scope.readTitle }}</strong>
            <p>{{ S.scope.readText }}</p>
          </div>
        </div>
        <div class="scope-card">
          <span class="scope-icon"><ui-icon name="backup"/></span>
          <div>
            <strong>{{ S.scope.backupTitle }}</strong>
            <p>{{ S.scope.backupText }}</p>
          </div>
        </div>
      </div>

      <div class="section-head">
        <h2>{{ S.allTitle }}</h2>
        <span class="sub">{{ S.found(cards.length) }}</span>
      </div>
      <section class="inst-cards" :aria-label="S.installations">
        <article v-for="c in cards" :key="c.i.id" :class="['inst-card', { 'is-current': c.i.id === inst.id }]" @click="pick(c.i.id)">
          <h2>
            <button class="inst-card-head" type="button" :aria-pressed="c.i.id === inst.id ? 'true' : 'false'" @click.stop="pick(c.i.id)">
              <span :class="['slicer-logo', 'slicer-logo--' + c.i.kind]" aria-hidden="true">{{ c.logo }}</span>
              <span class="inst-card-title">
                <span class="inst-card-name">{{ c.i.slicer }}</span>
                <span class="inst-card-version">{{ S.version(c.i.version) }}</span>
              </span>
              <span class="inst-card-state">
                <run-status :inst="c.i"/>
                <span v-if="c.i.id === inst.id && cards.length > 1" class="shown"><ui-icon name="check" :size="14"/>{{ S.shownBelow }}</span>
              </span>
            </button>
          </h2>
          <p v-if="c.i.running" class="run-reason"><ui-icon name="lock"/><span>{{ T.runReason(c.i) }} {{ S.closeAndReload(c.i.slicer) }}</span></p>
          <p v-for="p in c.i.problems" :key="p" class="alert">{{ T.problems[p] || p }}</p>
          <dl class="facts">
            <div><dt>{{ S.facts.path }}</dt><dd><code>{{ c.sp.path }}</code></dd></div>
            <div><dt>{{ S.facts.source }}</dt><dd>{{ T.sources[c.sp.source] || c.sp.source }}</dd></div>
            <div><dt>{{ S.facts.userFolder }}</dt><dd><code>{{ c.sp.user_folder }}/</code></dd></div>
            <div><dt>{{ S.facts.account }}</dt><dd>{{ c.sp.logged_in ? S.loggedIn : S.notLoggedIn }}</dd></div>
            <div><dt>{{ S.facts.systemFormat }}</dt><dd>{{ formatText(c.sp) }}</dd></div>
            <div><dt>{{ S.facts.size }}</dt><dd>{{ fmtSize(c.sp.totals.size) }} · {{ plural(c.sp.totals.files, ...T.words.file) }}</dd></div>
          </dl>
          <div v-if="c.i.manual" class="actions">
            <button class="btn" type="button" :disabled="busy" @click.stop="removeManual(c.i)">{{ S.remove }}</button>
          </div>
        </article>
      </section>

      <p v-if="inst.running" class="banner">{{ T.runReason(inst) }} {{ S.onlyShows }}</p>

      <div class="section-head">
        <h2>{{ S.dataDirOf(inst.slicer) }}</h2>
        <code>{{ sp.path }}</code>
      </div>

      <section class="box" aria-labelledby="hints-h">
        <div class="box-head">
          <h3 id="hints-h">{{ S.hints.title }}</h3>
          <span v-if="hints.length" class="count">{{ hints.length }}</span>
          <span class="sub">{{ S.hints.sub }}</span>
        </div>
        <ul v-if="hints.length" class="hint-list">
          <li v-for="(w, n) in hints" :key="n" :class="['hint', 'hint--' + w.level]">
            <span class="hint-icon"><ui-icon :name="LEVEL_ICON[w.level]"/></span>
            <div class="hint-text">
              <p class="hint-title">
                <span class="hint-level">{{ S.levels[w.level] }}</span>
                {{ hintText(w) }}
              </p>
              <p class="note">{{ hintAction(w) }}</p>
              <p v-if="canHide(w)" class="hint-actions">
                <span v-if="hideQueued" class="row-hint changed">{{ S.hints.hideMarked }}</span>
                <button v-else class="btn" type="button" :disabled="inst.running" @click="hideUnused"><ui-icon name="minus"/>{{ S.hints.hide }}</button>
              </p>
              <details v-if="w.names.length > 1" class="more">
                <summary>{{ S.hints.show(w.names.length) }}</summary>
                <ul class="file-list"><li v-for="name in w.names" :key="name"><code>{{ name }}</code></li></ul>
              </details>
            </div>
          </li>
        </ul>
        <p v-else class="all-clean"><ui-icon name="check"/>{{ S.hints.none }}</p>
      </section>

      <section class="box" aria-labelledby="usage-h">
        <div class="box-head">
          <h3 id="usage-h">{{ S.usage.title }}</h3>
          <span class="sub">{{ S.usage.sub(fmtSize(sp.totals.size), plural(sp.totals.files, ...T.words.file)) }}</span>
        </div>
        <div class="usage-bar" role="img" :aria-label="usageText">
          <span v-for="u in usage" :key="u.c" :class="['usage-seg', 'cat-' + u.c]" :style="{ flex: u.share + ' 1 0' }"
                :title="T.labels.category[u.c] + ': ' + fmtSize(u.size)"></span>
        </div>
        <ul class="usage-legend">
          <li v-for="u in usage" :key="u.c" :class="['cat', 'cat-' + u.c]"><span class="cat-dot"></span>{{ T.labels.category[u.c] }} <b>{{ fmtSize(u.size) }}</b></li>
        </ul>
      </section>

      <section class="box" aria-labelledby="tree-h">
        <div class="box-head">
          <h3 id="tree-h">{{ S.tree.title }}</h3>
          <span class="sub">{{ S.tree.sub }}</span>
          <button class="link right" type="button" @click="toggleAll">{{ allOpen ? S.tree.closeAll : S.tree.openAll }}</button>
        </div>
        <ul class="fs">
          <fs-node v-for="n in sp.tree" :key="n.path" :node="n" :sp="sp" :open="open" :parent-size="sp.totals.size" :share-of="S.shareOfDataDir"/>
        </ul>
      </section>

      <section v-if="outside.length" class="box" aria-labelledby="outside-h">
        <div class="box-head">
          <h3 id="outside-h">{{ S.outside.title }}</h3>
          <span class="sub">{{ S.outside.sub }}</span>
        </div>
        <ul class="fs">
          <fs-node v-for="n in outside" :key="n.path" :node="n" :sp="sp" :open="open"/>
        </ul>
      </section>

      <section class="box" aria-labelledby="pkg-h">
        <div class="box-head">
          <h3 id="pkg-h">{{ S.packages.title }}</h3>
          <span class="sub">{{ S.packages.in }} <code>system/</code> · {{ formatText(sp) }}</span>
        </div>
        <ul class="pkg-list">
          <li v-for="p in sp.packages" :key="p.name" class="pkg">
            <span class="kind-icon"><ui-icon :name="p.role === 'library' ? 'books' : 'factory'"/></span>
            <div class="pkg-text">
              <p class="pkg-line">
                <span class="pkg-name">{{ p.name }}</span>
                <span class="mat">{{ S.packages.roles[p.role] }}</span>
                <span class="version">{{ S.version(p.version_display) }}</span>
              </p>
              <p class="fs-note">{{ packageNote(p) }}</p>
              <p class="pkg-counts">
                <span v-for="k in KINDS.filter((x) => p.counts[x.id])" :key="k.id" class="pkg-count">
                  <ui-icon :name="k.icon" :size="14"/>{{ plural(p.counts[k.id], ...k.words) }}
                </span>
                <span v-if="p.models" class="pkg-count"><ui-icon name="printer" :size="14"/>{{ plural(p.models, ...T.words.model) }}</span>
              </p>
              <p class="pkg-file">
                <code>{{ p.file }}</code><template v-if="p.folder"> {{ S.scope.and }} <code>{{ p.folder }}/</code></template>
                · {{ fmtSize(p.size) }} · {{ plural(p.files, ...T.words.file) }}
                <template v-if="p.extra_files"> · {{ S.packages.extra(p.extra_files.length) }}</template>
              </p>
            </div>
          </li>
        </ul>
        <p class="note refresh"><ui-icon name="refresh"/>{{ T.systemRefresh[sp.system_refresh.code](sp.slicer) }}</p>
      </section>

      <section class="box" aria-labelledby="stats-h">
        <div class="box-head">
          <h3 id="stats-h">{{ S.stats.title }}</h3>
          <span class="sub">{{ S.stats.sub }}</span>
        </div>
        <div class="stats">
          <div v-for="k in KINDS" :key="k.id" class="stat">
            <span class="kind-icon"><ui-icon :name="k.icon"/></span>
            <span class="stat-label">{{ T.labels.kind[k.id] }}</span>
            <span class="stat-big">{{ sp.profile_counts[k.id].system_selectable }}</span>
            <span class="stat-sub">{{ S.stats.selectable }}</span>
            <span class="stat-sub" :title="S.stats.baseTitle">{{ S.stats.base(sp.profile_counts[k.id].system - sp.profile_counts[k.id].system_selectable) }}</span>
            <span class="stat-own">{{ ownText(sp.profile_counts[k.id]) }}</span>
          </div>
        </div>
      </section>

      <div class="grid-2">
        <section class="box" aria-labelledby="conf-h">
          <div class="box-head"><h3 id="conf-h">{{ S.conf.title }}</h3></div>
          <dl class="facts">
            <div><dt>{{ S.conf.file }}</dt><dd><code>{{ sp.conf.file }}</code></dd></div>
            <div><dt>{{ S.conf.size }}</dt><dd>{{ fmtSize(sp.conf.size) }} · {{ plural(sp.conf.sections, ...T.words.section) }}</dd></div>
            <div><dt>{{ S.conf.indent }}</dt><dd>{{ indentText }}</dd></div>
            <div><dt>{{ S.conf.checksum }}</dt><dd>{{ sp.conf.checksum ? S.conf.checksumYes : S.conf.checksumNo }}</dd></div>
            <div><dt>{{ S.credentials }}</dt><dd>{{ credText }}</dd></div>
          </dl>
          <p class="note">{{ S.conf.note }}</p>
        </section>

        <section class="box" aria-labelledby="backup-h">
          <div class="box-head"><h3 id="backup-h">{{ S.backup.title }}</h3></div>
          <p>{{ S.backup.text(plural(sp.totals.backup_files, ...T.words.file), fmtSize(sp.totals.backup_size), fmtSize(sp.totals.backup_zip_size)) }}</p>
          <p class="note">{{ S.backup.notIn }}</p>
          <p class="chip-list"><code v-for="x in bp.excluded" :key="x">{{ x }}</code></p>
          <p class="note">{{ S.backup.location }} <code>{{ bp.location }}</code></p>
          <p class="secret-note"><ui-icon name="key"/><span>{{ T.backupsSecret }}</span></p>
        </section>
      </div>

      <section class="box" aria-labelledby="add-h">
        <div class="box-head"><h3 id="add-h">{{ T.add.title }}</h3></div>
        <p class="note">{{ T.add.hint }}</p>
        <form class="add-form" @submit.prevent="addManual">
          <input v-model="newPath" class="input" type="text" autocomplete="off" :placeholder="T.add.placeholder" :aria-label="T.add.label"
                 :aria-invalid="addError ? 'true' : 'false'" aria-describedby="add-error">
          <button class="btn" type="submit" :disabled="busy || !newPath.trim()">{{ T.add.button }}</button>
        </form>
        <p id="add-error" class="field-error" aria-live="polite">{{ addError }}</p>
      </section>
    </div>
  `,
};
