// Page "Sicherungen": every backup of the chosen installation with time, kind and size, the
// total on top and "Jetzt sichern". A click on a backup opens the side panel with
// "Wiederherstellen" and "Löschen". Orfix never deletes a backup by itself (hard rule 4).
// Data: instances[].backups_page of GET /api/data. Orfix writes nothing yet, so the list is empty;
// a backup there has id, time (ISO), kind ("change", "restore" or "manual"), size, files, file
// and maybe a detail line. "Jetzt sichern", "Wiederherstellen" and "Löschen" go into the change
// list (`live` in common.js, app.js).
import {
  INSTANCES, live, flash, fmtSize, plural, dayLabel, clockText, whenText,
} from "../common.js";
import { T } from "../texts.js";

const { ref, computed, watch, nextTick, onMounted, onUnmounted } = Vue;

const B = T.backups;
const KIND_ICON = { change: "pencil", restore: "backup", manual: "user" };

export default {
  name: "SicherungenPage",
  props: { instId: { type: String, required: true } },

  setup(props) {
    const inst = computed(() => INSTANCES.find((i) => i.id === props.instId));
    const state = computed(() => live[props.instId]);
    const bp = computed(() => inst.value.backups_page);
    const readOnly = computed(() => !!inst.value.running);

    // Newest first; the ones marked for deleting stay out, "Verwerfen" brings them back.
    const backups = computed(() => bp.value.backups
      .map((b) => ({ ...b, time: new Date(b.time) }))
      .filter((b) => !state.value.dropBackups.has(b.id))
      .sort((a, b) => b.time - a.time));
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
    const titleOf = (b) => B.kinds[b.kind] || B.kinds.change;
    const clock = (d) => T.clock(clockText(d));

    // ------------------------------------------------------------ back up now
    function backupManual() {
      state.value.backup = true;
      flash(B.queued.backup);
    }

    // ------------------------------------------------------------ panel
    const panel = ref(null);  // { type: "backup" | "delete", id }
    let lastFocus = null;
    const pb = computed(() => panel.value && backups.value.find((b) => b.id === panel.value.id) || null);
    function openPanel(type, b) {
      if (!panel.value) lastFocus = document.activeElement;
      panel.value = { type, id: b.id };
      nextTick(() => document.getElementById("panel-title")?.focus());
    }
    function closePanel() {
      panel.value = null;
      const target = lastFocus && document.contains(lastFocus) ? lastFocus : document.getElementById("page-title");
      target?.focus();
      lastFocus = null;
    }
    watch(() => props.instId, () => { panel.value = null; lastFocus = null; });

    function restore() {
      const b = pb.value;
      if (!b || readOnly.value) return;
      state.value.restore = b.id;
      closePanel();
      flash(B.queued.restore(whenText(b.time)));
    }
    function removeBackup() {
      const b = pb.value;
      if (!b) return;
      state.value.dropBackups.add(b.id);
      closePanel();
      flash(B.queued.delete);
    }
    const panelTitle = computed(() => panel.value && B.panelTitles[panel.value.type]);

    const onKey = (ev) => { if (ev.key === "Escape" && panel.value) closePanel(); };
    onMounted(() => window.addEventListener("keydown", onKey));
    onUnmounted(() => window.removeEventListener("keydown", onKey));

    return {
      T, B, KIND_ICON, inst, state, bp, readOnly, backups, total, groups, panel, pb, panelTitle,
      backupManual, openPanel, closePanel, restore, removeBackup, titleOf, whenText, clock, fmtSize, plural,
    };
  },

  template: `
    <div :class="['page-host', { 'with-panel': panel }]">
      <div class="page">
        <div class="page-head head-row">
          <div class="grow">
            <h1 id="page-title" tabindex="-1">{{ B.title }}</h1>
            <p>{{ inst.slicer }} {{ inst.version }}</p>
          </div>
          <run-status :inst="inst"/>
        </div>
        <p v-if="readOnly" class="banner">{{ T.busy(inst) }} {{ B.busy }}</p>

        <section class="box bk-summary" :aria-label="B.summary">
          <span class="bk-summary-icon"><ui-icon name="backup" :size="34"/></span>
          <div class="bk-summary-text">
            <p class="bk-total">{{ fmtSize(total) }}</p>
            <p class="bk-total-sub">
              {{ plural(backups.length, ...T.words.backup) }}<template v-if="backups.length"> · {{ B.newest(whenText(backups[0].time)) }}</template>
            </p>
          </div>
          <button class="btn btn-primary" type="button" :disabled="state.backup" @click="backupManual"><ui-icon name="plus"/>{{ B.now }}</button>
          <p class="bk-summary-note">{{ B.auto(fmtSize(bp.now.zip_size)) }}</p>
          <p class="secret-note bk-secret"><ui-icon name="key"/><span>{{ T.backupsSecret }}</span></p>
        </section>

        <section class="box" aria-labelledby="list-h">
          <div class="box-head">
            <h2 id="list-h">{{ B.all }}</h2>
            <span class="count">{{ backups.length }}</span>
            <span class="sub">{{ B.newestFirst }}</span>
          </div>
          <p v-if="!backups.length" class="empty">{{ B.none }}</p>
          <template v-for="g in groups" :key="g.label">
            <h3 class="day-h">{{ g.label }}</h3>
            <ul class="bk-list">
              <li v-for="b in g.items" :key="b.id">
                <button type="button" :class="['bk-row', { 'is-selected': panel && panel.id === b.id }]"
                        :aria-current="panel && panel.id === b.id ? 'true' : null" @click="openPanel('backup', b)">
                  <span class="kind-icon"><ui-icon :name="KIND_ICON[b.kind] || 'backup'"/></span>
                  <span class="bk-text">
                    <span class="bk-title">{{ titleOf(b) }}</span>
                    <span class="bk-sub">{{ clock(b.time) }}<template v-if="b.detail"> · {{ b.detail }}</template></span>
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
        <button class="icon-btn" type="button" :aria-label="T.close" @click="closePanel"><ui-icon name="close"/></button>
      </div>
      <div class="panel-body">
        <p v-if="!pb" class="note">{{ B.gone }}</p>
        <template v-else>
          <div class="hero">
            <span class="hero-icon"><ui-icon :name="KIND_ICON[pb.kind] || 'backup'" :size="36"/></span>
            <div class="hero-text">
              <p class="hero-name">{{ B.stateOf(whenText(pb.time)) }}</p>
              <p class="hero-sub">{{ titleOf(pb) }}<template v-if="pb.detail"> · {{ pb.detail }}</template></p>
              <p class="hero-sub">{{ fmtSize(pb.size) }}</p>
            </div>
          </div>

          <template v-if="panel.type === 'backup'">
            <p :class="['state-note', { 'is-busy': readOnly }]">
              <run-status :inst="inst"/>
              <span>{{ readOnly ? B.mustClose(inst.slicer) : B.staysClosed(inst.slicer) }}</span>
            </p>
            <p class="note">{{ B.restoreNote }}</p>
            <p class="safe-note"><ui-icon name="backup"/><span>{{ B.restoreSafe }}</span></p>

            <details class="more">
              <summary>{{ B.details }}</summary>
              <dl class="facts">
                <div><dt>{{ B.file }}</dt><dd><code>{{ pb.file }}</code></dd></div>
                <div><dt>{{ B.content }}</dt><dd>{{ plural(pb.files, ...T.words.file) }}</dd></div>
              </dl>
            </details>

            <div class="actions">
              <button class="btn btn-danger" type="button" @click="openPanel('delete', pb)"><ui-icon name="trash"/>{{ B.deleteOpen }}</button>
              <button class="btn btn-primary right" type="button" :disabled="readOnly || state.restore === pb.id" @click="restore"><ui-icon name="backup"/>{{ B.restore }}</button>
            </div>
          </template>

          <template v-else>
            <p class="plan-line"><ui-icon name="trash" class="ch-delete"/><span>{{ B.deletePlan(fmtSize(pb.size)) }}</span></p>
            <p v-if="backups.length === 1" class="alert">{{ B.lastOne }}</p>
            <div class="actions">
              <button class="btn" type="button" @click="openPanel('backup', pb)">{{ T.back }}</button>
              <button class="btn btn-danger-solid right" type="button" @click="removeBackup"><ui-icon name="trash"/>{{ B.delete }}</button>
            </div>
          </template>
        </template>
      </div>
    </aside>
  `,
};
