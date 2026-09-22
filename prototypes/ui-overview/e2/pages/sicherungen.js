// Page "Sicherungen": every backup of the chosen installation with time, reason and size, the
// total on top and "Jetzt sichern". A click on a backup opens the side panel with what restoring
// would change, "Wiederherstellen" and "Löschen". Orfix never deletes a backup by itself (hard
// rule 4). Data: ORFIX_DATA.instances[].backups_page plus the backups made in this session
// (common.js). Restoring puts the saved state back into `live`, so "Drucker" and "Filamente"
// show it at once. Memory only.
import {
  INSTANCES, live, ui, showExample, busyText, initialLive, copyLive, sessionBackups, backupNow, flash, fmtSize,
  plural, printerShortName, printerText, profileInfo, profileSub, KIND_ICON,
} from "../common.js";

const { ref, reactive, computed, watch, nextTick, onMounted, onUnmounted } = Vue;

const KINDS = {
  change: { icon: "pencil", text: "Vor einer Änderung" },
  restore: { icon: "backup", text: "Vor dem Wiederherstellen" },
  manual: { icon: "user", text: "Von Hand" },
};
const KIND_ORDER = ["machine", "filament", "process"];
const DONE = " – im Entwurf wird nichts gespeichert.";

// Example backups from make_data.py: the state back then is today's state without the example
// profiles in "missing"; printers and the default printer were as today.
const EXAMPLES = new Map(INSTANCES.map((inst) => {
  const base = initialLive(inst);
  return [inst.id, inst.backups_page.backups.map((b) => ({
    ...b, instId: inst.id, time: new Date(b.time), session: false,
    snapshot: { ...copyLive(base), own: new Set([...base.own].filter((n) => !b.missing.includes(n))) },
  }))];
}));
// Backups deleted in this session; module level, so they stay gone after a trip to another page.
const deleted = reactive(new Set());
const keyOf = (b) => b.instId + ":" + b.id;
// All backups of an installation, also deleted and hidden ones, for "Danach wiederhergestellt".
const knownOf = (instId) => [...sessionBackups.filter((b) => b.instId === instId), ...(EXAMPLES.get(instId) || [])];
// What the list shows, newest first. The main menu shows the number, too (app.js).
export const backupsOf = (instId) => knownOf(instId)
  .filter((b) => !deleted.has(keyOf(b)) && showExample(b)).sort((a, b) => b.time - a.time);

// "Heute", "Gestern", else weekday and date.
function dayLabel(d) {
  const day = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate());
  const diff = Math.round((day(new Date()) - day(d)) / 86400000);
  if (diff === 0) return "Heute";
  if (diff === 1) return "Gestern";
  return d.toLocaleDateString("de-DE", { weekday: "long", day: "2-digit", month: "2-digit", year: "numeric" });
}
const clock = (d) => d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" }) + " Uhr";
// "heute, 07:29 Uhr", "gestern, 16:40 Uhr", "Montag, 21.09.2026, 16:40 Uhr"; reads after "Stand von".
function whenText(d) {
  const l = dayLabel(d);
  return (l === "Heute" || l === "Gestern" ? l.toLowerCase() : l) + ", " + clock(d);
}
// The data says "vor „Drucker entfernt“"; as a title it starts with a capital letter.
const titleOf = (b) => b.reason.charAt(0).toUpperCase() + b.reason.slice(1);

export default {
  name: "SicherungenPage",
  props: { instId: { type: String, required: true } },

  setup(props) {
    const inst = computed(() => INSTANCES.find((i) => i.id === props.instId));
    const bp = computed(() => inst.value.backups_page);
    const readOnly = computed(() => !!inst.value.running);

    const known = computed(() => knownOf(props.instId));
    const backups = computed(() => backupsOf(props.instId));
    const total = computed(() => backups.value.reduce((sum, b) => sum + b.size, 0));
    const groups = computed(() => {
      const out = [];
      for (const b of backups.value) {
        const label = dayLabel(b.time);
        if (!out.length || out[out.length - 1].label !== label) out.push({ label, items: [] });
        out[out.length - 1].items.push(b);
      }
      return out;
    });
    function restoredText(b) {
      const r = known.value.find((x) => x.id === b.restored);
      return r ? "Stand von " + whenText(r.time) + (deleted.has(keyOf(r)) ? " (inzwischen gelöscht)" : "") : "";
    }

    // ------------------------------------------------------------ back up now
    const fresh = ref(null);
    function backupManual() {
      fresh.value = backupNow(inst.value, { kind: "manual", reason: "von Hand" }).id;
      flash("Sicherung angelegt" + DONE);
    }

    // ------------------------------------------------------------ panel
    const panel = ref(null);  // { type: "backup" | "delete", key }
    let lastFocus = null;
    const pb = computed(() => panel.value && backups.value.find((b) => keyOf(b) === panel.value.key) || null);
    function openPanel(type, b) {
      if (!panel.value) lastFocus = document.activeElement;
      panel.value = { type, key: keyOf(b) };
      nextTick(() => document.getElementById("panel-title")?.focus());
    }
    function closePanel() {
      panel.value = null;
      const target = lastFocus && document.contains(lastFocus) ? lastFocus : document.getElementById("page-title");
      target?.focus();
      lastFocus = null;
    }
    watch(() => props.instId, () => { panel.value = null; lastFocus = null; });

    // What restoring changes compared with now. In the real app the backend compares the ZIP with
    // the data directory; here the saved state stands in for it.
    const diff = computed(() => {
      const b = pb.value;
      if (!b) return null;
      const i = inst.value, now = live[i.id], then = b.snapshot, back = [], gone = [];
      for (const m of i.printers_page.system) {
        const was = then.models.has(m.model), is = now.models.has(m.model);
        const name = printerShortName(m.printers[0]?.name || m.model);
        if (was && !is) back.push({ icon: "printer", name, sub: "Drucker vom Hersteller, wird wieder eingeschaltet" });
        if (!was && is) gone.push({ icon: "printer", name, sub: "Drucker vom Hersteller, wird abgeschaltet" });
      }
      for (const p of then.packages) {
        if (!now.packages.has(p)) back.push({ icon: "factory", name: p, sub: "Herstellerpaket, der Slicer installiert es beim nächsten Start wieder" });
      }
      const own = (names) => [...names].map((n) => profileInfo(i, n)).filter(showExample)
        .sort((x, y) => KIND_ORDER.indexOf(x.kind) - KIND_ORDER.indexOf(y.kind) || x.name.localeCompare(y.name, "de"))
        .map((p) => ({ icon: KIND_ICON[p.kind], name: p.name, sub: profileSub(p), example: p.example }));
      back.push(...own([...then.own].filter((n) => !now.own.has(n))));
      gone.push(...own([...now.own].filter((n) => !then.own.has(n))));
      for (const d of then.dead) if (!now.dead.includes(d)) back.push({ icon: "broom", name: d, sub: "Veralteter Eintrag von der Seite „Drucker“" });
      const defaultPrinter = then.defaultPrinter !== now.defaultPrinter ? printerText(i, then.defaultPrinter) : null;
      return { back, gone, defaultPrinter };
    });
    function restore() {
      const b = pb.value;
      if (!b || readOnly.value) return;
      const when = whenText(b.time);
      // First the current state goes into a backup of its own, so the restore can be undone.
      fresh.value = backupNow(inst.value, { kind: "restore", reason: "vor Wiederherstellen", restored: b.id }).id;
      Object.assign(live[inst.value.id], copyLive(b.snapshot));
      closePanel();
      flash(`Wiederhergestellt: Stand von ${when}` + DONE);
    }
    function removeBackup() {
      const b = pb.value;
      if (!b) return;
      deleted.add(keyOf(b));
      closePanel();
      flash("Sicherung gelöscht" + DONE);
    }
    const panelTitle = computed(() => panel.value && ({ backup: "Sicherung", delete: "Sicherung löschen" })[panel.value.type]);

    const onKey = (ev) => { if (ev.key === "Escape" && panel.value) closePanel(); };
    onMounted(() => window.addEventListener("keydown", onKey));
    onUnmounted(() => window.removeEventListener("keydown", onKey));

    return {
      KINDS, ui, inst, bp, readOnly, backups, total, groups, fresh, panel, pb, diff, panelTitle,
      backupManual, openPanel, closePanel, restore, removeBackup, restoredText, keyOf,
      titleOf, whenText, clock, fmtSize, plural, busyText,
    };
  },

  template: `
    <div :class="['page-host', { 'with-panel': panel }]">
      <div class="page">
        <div class="page-head head-row">
          <div class="grow">
            <h1 id="page-title" tabindex="-1">Sicherungen</h1>
            <p>{{ inst.slicer }} {{ inst.version }}</p>
          </div>
          <run-status :inst="inst"/>
        </div>
        <p v-if="readOnly" class="banner">{{ busyText(inst) }} Sichern geht, zum Wiederherstellen bitte den Slicer schließen.</p>

        <section class="box bk-summary" aria-label="Überblick">
          <span class="bk-summary-icon"><ui-icon name="backup" :size="34"/></span>
          <div class="bk-summary-text">
            <p class="bk-total">{{ fmtSize(total) }}</p>
            <p class="bk-total-sub">
              {{ plural(backups.length, 'Sicherung', 'Sicherungen') }}<template v-if="backups.length"> · die neueste von {{ whenText(backups[0].time) }}</template>
            </p>
          </div>
          <button class="btn btn-primary" type="button" @click="backupManual"><ui-icon name="plus"/>Jetzt sichern</button>
          <p class="bk-summary-note">
            Orfix sichert vor jeder Änderung automatisch und löscht keine Sicherung von selbst. Eine neue braucht etwa {{ fmtSize(bp.now.zip_size) }}.
          </p>
          <p class="secret-note bk-secret"><ui-icon name="key"/><span>Sicherungen enthalten die Zugangsdaten deiner Drucker. Bitte nicht weitergeben.</span></p>
        </section>

        <section class="box" aria-labelledby="list-h">
          <div class="box-head">
            <h2 id="list-h">Alle Sicherungen</h2>
            <span class="count">{{ backups.length }}</span>
            <span class="sub">Neueste zuerst</span>
          </div>
          <p v-if="!backups.length" class="empty">
            Noch keine Sicherung. Orfix legt vor jeder Änderung eine an.
            <template v-if="!ui.examples"><br>Beispiele zeigt der Schalter „Beispiele“ oben.</template>
          </p>
          <template v-for="g in groups" :key="g.label">
            <h3 class="day-h">{{ g.label }}</h3>
            <ul class="bk-list">
              <li v-for="b in g.items" :key="keyOf(b)">
                <button type="button" :class="['bk-row', { 'is-fresh': b.id === fresh, 'is-selected': panel && panel.key === keyOf(b) }]"
                        :aria-current="panel && panel.key === keyOf(b) ? 'true' : null" @click="openPanel('backup', b)">
                  <span class="kind-icon" :title="KINDS[b.kind].text"><ui-icon :name="KINDS[b.kind].icon"/></span>
                  <span class="bk-text">
                    <span class="bk-title">
                      {{ titleOf(b) }}
                      <span v-if="b.example" class="tag-example" title="Nur im Entwurf, diese Sicherung gibt es nicht">Beispiel</span>
                    </span>
                    <span class="bk-sub">{{ clock(b.time) }}<template v-if="b.detail"> · {{ b.detail }}</template></span>
                    <span v-if="b.restored" class="bk-sub">Danach wiederhergestellt: {{ restoredText(b) }}</span>
                  </span>
                  <span class="bk-size">{{ fmtSize(b.size) }}</span>
                  <ui-icon name="chevron" class="chev"/>
                </button>
              </li>
            </ul>
          </template>
        </section>
      </div>
    </div>

    <aside v-if="panel" class="panel" aria-labelledby="panel-title">
      <div class="panel-head">
        <h2 id="panel-title" tabindex="-1">{{ panelTitle }}</h2>
        <button class="icon-btn" type="button" aria-label="Schließen" @click="closePanel"><ui-icon name="close"/></button>
      </div>
      <div class="panel-body">
        <p v-if="!pb" class="note">Diese Sicherung gibt es nicht mehr.</p>
        <template v-else>
          <div class="hero">
            <span class="hero-icon"><ui-icon :name="KINDS[pb.kind].icon" :size="36"/></span>
            <div class="hero-text">
              <p class="hero-name">Stand von {{ whenText(pb.time) }}</p>
              <p class="hero-sub">{{ titleOf(pb) }}<template v-if="pb.detail"> · {{ pb.detail }}</template></p>
              <p class="hero-sub">{{ fmtSize(pb.size) }} <span v-if="pb.example" class="tag-example">Beispiel</span></p>
            </div>
          </div>

          <template v-if="panel.type === 'backup'">
            <p :class="['state-note', { 'is-busy': readOnly }]">
              <run-status :inst="inst"/>
              <span>{{ readOnly ? inst.slicer + ' muss geschlossen sein. Bitte erst schließen.' : inst.slicer + ' muss geschlossen bleiben, bis Orfix fertig ist.' }}</span>
            </p>

            <h3>Kommt zurück</h3>
            <ul v-if="diff.back.length" class="plain-list">
              <li v-for="x in diff.back" :key="'b' + x.name">
                <span class="ch-on"><ui-icon :name="x.icon"/></span>
                <span class="grow"><strong>{{ x.name }}</strong><small>{{ x.sub }}</small></span>
                <span v-if="x.example" class="tag-example">Beispiel</span>
              </li>
            </ul>
            <p v-else class="note">Nichts, das jetzt fehlt.</p>

            <h3>Fällt weg</h3>
            <ul v-if="diff.gone.length" class="plain-list">
              <li v-for="x in diff.gone" :key="'g' + x.name">
                <span class="ch-delete"><ui-icon :name="x.icon"/></span>
                <span class="grow"><strong>{{ x.name }}</strong><small>{{ x.sub }}</small></span>
                <span v-if="x.example" class="tag-example">Beispiel</span>
              </li>
            </ul>
            <p v-else class="note">Nichts, das seitdem dazugekommen ist.</p>

            <p v-if="diff.defaultPrinter" class="plan-line"><ui-icon name="star" class="star"/><span>Standard wird wieder <strong>{{ diff.defaultPrinter }}</strong>.</span></p>
            <p class="note">Auch die Einstellungen des Slicers kommen auf diesen Stand, etwa welche Filamente sichtbar sind.</p>
            <p class="safe-note"><ui-icon name="backup"/><span>Vorher sichert Orfix den jetzigen Stand. Du kannst also wieder zurück.</span></p>

            <details class="more">
              <summary>Einzelheiten</summary>
              <dl class="facts">
                <div><dt>Datei</dt><dd><code>{{ pb.file }}</code></dd></div>
                <div><dt>Inhalt</dt><dd>{{ plural(pb.files, 'Datei', 'Dateien') }}</dd></div>
              </dl>
              <template v-if="pb.changed.length">
                <p class="note">Danach von Orfix geändert:</p>
                <ul class="file-list"><li v-for="f in pb.changed" :key="f"><code>{{ f }}</code></li></ul>
              </template>
            </details>

            <div class="actions">
              <button class="btn btn-danger" type="button" @click="openPanel('delete', pb)"><ui-icon name="trash"/>Löschen …</button>
              <button class="btn btn-primary right" type="button" :disabled="readOnly" @click="restore"><ui-icon name="backup"/>Wiederherstellen</button>
            </div>
          </template>

          <template v-else>
            <p class="plan-line"><ui-icon name="trash" class="ch-delete"/><span>Die Sicherung wird endgültig gelöscht. Das macht {{ fmtSize(pb.size) }} frei.</span></p>
            <p v-if="backups.length === 1" class="alert">Das ist die letzte Sicherung. Danach lässt sich nichts mehr wiederherstellen.</p>
            <div class="actions">
              <button class="btn" type="button" @click="openPanel('backup', pb)">Zurück</button>
              <button class="btn btn-danger-solid right" type="button" @click="removeBackup"><ui-icon name="trash"/>Löschen</button>
            </div>
          </template>
        </template>
      </div>
    </aside>
  `,
};
