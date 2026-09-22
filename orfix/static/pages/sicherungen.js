// Page "Sicherungen": every backup of the chosen installation with time, reason and size, the
// total on top and "Jetzt sichern". A click on a backup opens the side panel with
// "Wiederherstellen" and "Löschen". Orfix never deletes a backup by itself (hard rule 4).
// Data: GET /api/instances/{id}/backups (BACKUPS in common.js). The actions go straight to the
// API, not into the change list: "Jetzt sichern" makes one, "Löschen" asks first, and
// "Wiederherstellen" shows the plan of /restore-plan ("Das passiert", plan.js), its
// "Ausführen" sends /apply. Before restoring, the backend backs up the current state
// (reason before_restore).
import {
  INSTANCES, BACKUPS, refreshBackups, writeBlock, load, resetChanges, flash, fmtSize, plural, dayLabel, clockText, whenText,
} from "../common.js";
import { T } from "../texts.js";
import { api } from "../api.js";
import { changesOf } from "../ops.js";
import PlanView, { DoneView, problemText } from "../plan.js";

const { ref, computed, watch, nextTick, onMounted, onUnmounted } = Vue;

const B = T.backups;
const REASON_ICON = { manual: "user", before_restore: "backup" };
// What the check after a restore reported: { instId, warnings }. Module level, because the load
// right after the restore mounts this page fresh (app.js); the new one shows it in its panel.
const restoreDone = ref(null);

export default {
  name: "SicherungenPage",
  components: { PlanView, DoneView },
  props: { instId: { type: String, required: true } },

  setup(props) {
    const inst = computed(() => INSTANCES.find((i) => i.id === props.instId));
    const bp = computed(() => inst.value.backups_page);
    const list = computed(() => BACKUPS[props.instId] || null);
    const readOnly = computed(() => !!inst.value.running);
    // Why restoring is not possible now, as a sentence with the next step; "" if it is.
    const block = computed(() => {
      const code = writeBlock(inst.value, true);
      return code ? problemText(code, inst.value) : "";
    });

    // Newest first, as the backend sorts them (by the time in the file name). name is the file
    // name of the ZIP, it identifies the backup in the API. A backup whose manifest cannot be read
    // has no time.
    const backups = computed(() => (list.value ? list.value.backups : [])
      .map((b) => ({ ...b, id: b.name, time: b.created ? new Date(b.created) : null, size: b.size || 0, files: b.files || 0 })));
    const total = computed(() => list.value ? list.value.total_size : 0);
    const groups = computed(() => {
      const out = [];
      for (const b of backups.value) {
        const label = b.time ? dayLabel(b.time) : B.unknownTime;
        if (!out.length || out[out.length - 1].label !== label) out.push({ label, items: [] });
        out[out.length - 1].items.push(b);
      }
      return out;
    });
    // Automatic backups come before a change; the backend names the reason by a code, and what
    // the change did (reason_params.ops) or which backup was restored (reason_params.backup).
    function titleOf(b) {
      if (b.reason === "before_restore") {
        const from = backups.value.find((x) => x.name === b.reason_params?.backup);
        if (from?.time) return B.restoreOf(whenText(from.time));
      }
      return B.reasons[b.reason] || B.reasons.before_change;
    }
    function whatOf(b) {
      const ops = b.reason === "before_change" ? b.reason_params?.ops || [] : [];
      return [...new Set(ops.map((op) => B.opWords[op]).filter(Boolean))].join(", ");
    }
    const iconOf = (b) => REASON_ICON[b.reason] || "pencil";
    const clock = (d) => d ? T.clock(clockText(d)) : B.unknownTime;
    const stateText = (b) => b.time ? B.stateOf(whenText(b.time)) : B.unknownTime;

    // ------------------------------------------------------------ actions
    const busy = ref(false);
    const actionError = ref("");
    const errorOf = (err) => problemText(err.code, inst.value, err.data);

    async function backupNow() {
      if (busy.value) return;
      busy.value = true;
      try {
        await api.backupNow(props.instId);
        flash(B.backedUp);
      } catch (err) {
        flash(errorOf(err));
      }
      await refreshBackups(props.instId);
      busy.value = false;
    }

    // ------------------------------------------------------------ panel
    // type "backup" (details), "delete" (asks first) or "restore" (the plan).
    const panel = ref(null);
    const restorePlan = ref(null);
    // Warnings of the check after a restore of this installation, if there were any (DoneView).
    const doneWarnings = computed(() => restoreDone.value?.instId === props.instId ? restoreDone.value.warnings : null);
    const outdated = ref(false);
    let lastFocus = null;
    const pb = computed(() => panel.value && backups.value.find((b) => b.id === panel.value.id) || null);
    function openPanel(type, b) {
      if (!panel.value) lastFocus = document.activeElement;
      panel.value = { type, id: b.id };
      actionError.value = "";
      nextTick(() => document.getElementById("panel-title")?.focus());
    }
    function closePanel() {
      panel.value = null;
      restorePlan.value = null;
      restoreDone.value = null;
      actionError.value = "";
      const target = lastFocus && document.contains(lastFocus) ? lastFocus : document.getElementById("page-title");
      target?.focus();
      lastFocus = null;
    }
    watch(() => props.instId, () => { panel.value = null; restorePlan.value = null; lastFocus = null; });

    async function removeBackup() {
      const b = pb.value;
      if (!b || busy.value) return;
      busy.value = true;
      try {
        await api.deleteBackup(props.instId, b.name);
        closePanel();
        flash(B.deleted);
      } catch (err) {
        actionError.value = errorOf(err);
      }
      await refreshBackups(props.instId);
      busy.value = false;
    }

    async function planRestore() {
      const b = pb.value;
      if (!b || busy.value || block.value) return;
      busy.value = true;
      actionError.value = "";
      outdated.value = false;
      try {
        const data = await api.restorePlan(props.instId, b.name);
        restorePlan.value = data.plan;
        openPanel("restore", b);
      } catch (err) {
        actionError.value = errorOf(err);
      }
      busy.value = false;
    }
    // Reading everything again discards the pending changes of all installations; the plan says so.
    const pending = computed(() => INSTANCES.some((i) => changesOf(i).length > 0));
    async function runRestore() {
      if (!restorePlan.value || busy.value) return;
      busy.value = true;
      actionError.value = "";
      outdated.value = false;
      let result;
      try {
        result = await api.apply(props.instId, restorePlan.value.id);
      } catch (err) {
        actionError.value = errorOf(err);
        outdated.value = err.code === "plan_outdated" || err.code === "plan_not_found";
        // The backup of the state before is made already: the list must show it, it is the one
        // to restore after a write that failed.
        if (err.data?.backup) await refreshBackups(props.instId);
        busy.value = false;
        return;
      }
      const had = pending.value, warnings = result.warnings || [];
      closePanel();
      if (warnings.length) restoreDone.value = { instId: props.instId, warnings };
      // The files changed: pending changes of the old state must not stay, even if reading fails.
      // After a load the page is mounted fresh (app.js), with the new list.
      if (!(await load())) resetChanges();
      busy.value = false;
      flash(had ? B.restoredDiscarded : B.restored);
    }
    function backFromPlan() {
      const b = pb.value;
      restorePlan.value = null;
      if (b) openPanel("backup", b);
      else closePanel();
    }
    const panelTitle = computed(() => doneWarnings.value ? B.restored : panel.value && B.panelTitles[panel.value.type]);
    const panelOpen = computed(() => !!panel.value || !!doneWarnings.value);

    const onKey = (ev) => { if (ev.key === "Escape" && panelOpen.value && !busy.value) closePanel(); };
    onMounted(() => {
      window.addEventListener("keydown", onKey);
      if (!list.value) refreshBackups(props.instId);
    });
    onUnmounted(() => window.removeEventListener("keydown", onKey));

    return {
      T, B, inst, bp, list, readOnly, block, backups, total, groups, busy, actionError, panel, pb, panelTitle,
      restorePlan, doneWarnings, panelOpen, outdated, pending, backupNow, openPanel, closePanel, removeBackup, planRestore,
      runRestore, backFromPlan, refreshBackups, titleOf, whatOf, iconOf, whenText, clock, stateText, fmtSize, plural,
    };
  },

  template: `
    <div :class="['page-host', { 'with-panel': panelOpen }]">
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
            <p class="bk-total-label">{{ B.totalLabel }}</p>
            <p class="bk-total">{{ fmtSize(total) }}</p>
            <p class="bk-total-sub">
              {{ plural(backups.length, ...T.words.backup) }}<template v-if="backups.length && backups[0].time"> · {{ B.newest(whenText(backups[0].time)) }}</template>
            </p>
          </div>
          <button class="btn btn-primary" type="button" :disabled="busy" @click="backupNow">
            <ui-icon name="plus"/>{{ busy && !panel ? B.backingUp : B.now }}
          </button>
          <p class="bk-summary-note">{{ B.auto(fmtSize(bp.now.zip_size)) }}</p>
          <p v-if="list && list.location" class="bk-summary-note">{{ B.where(list.location) }}</p>
          <p class="secret-note bk-secret"><ui-icon name="key"/><span>{{ T.backupsSecret }}</span></p>
        </section>

        <section class="box" aria-labelledby="list-h">
          <div class="box-head">
            <h2 id="list-h">{{ B.all }}</h2>
            <span class="count">{{ backups.length }}</span>
            <span class="sub">{{ B.newestFirst }}</span>
          </div>
          <p v-if="!list" class="loading" role="status">{{ B.loading }}</p>
          <div v-else-if="list.error && !backups.length" class="alert" role="alert">
            {{ B.loadError }}
            <button class="link" type="button" @click="refreshBackups(inst.id)">{{ T.retry }}</button>
          </div>
          <p v-else-if="!backups.length" class="empty">{{ B.none }}</p>
          <template v-for="g in groups" :key="g.label">
            <h3 class="day-h">{{ g.label }}</h3>
            <ul class="bk-list">
              <li v-for="b in g.items" :key="b.id">
                <button type="button" :class="['bk-row', { 'is-selected': panel && panel.id === b.id }]"
                        :aria-current="panel && panel.id === b.id ? 'true' : null" @click="openPanel('backup', b)">
                  <span class="kind-icon"><ui-icon :name="iconOf(b)"/></span>
                  <span class="bk-text">
                    <span class="bk-title">{{ titleOf(b) }}</span>
                    <span class="bk-sub">{{ clock(b.time) }} · {{ plural(b.files, ...T.words.file) }}<template v-if="whatOf(b)"> · {{ whatOf(b) }}</template></span>
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

    <aside v-if="panelOpen" class="panel" aria-labelledby="panel-title">
      <div class="panel-head">
        <h2 id="panel-title" tabindex="-1">{{ panelTitle }}</h2>
        <button class="icon-btn" type="button" :aria-label="T.close" :disabled="busy" @click="closePanel"><ui-icon name="close"/></button>
      </div>
      <div class="panel-body">
        <done-view v-if="doneWarnings" :warnings="doneWarnings" :inst="inst" :text="B.restoredCheck" @close="closePanel"/>
        <p v-else-if="!pb" class="note">{{ B.gone }}</p>
        <template v-else>
          <div class="hero">
            <span class="hero-icon"><ui-icon :name="iconOf(pb)" :size="36"/></span>
            <div class="hero-text">
              <p class="hero-name">{{ stateText(pb) }}</p>
              <p class="hero-sub">{{ titleOf(pb) }}</p>
              <p class="hero-sub">{{ fmtSize(pb.size) }}</p>
            </div>
          </div>

          <template v-if="panel.type === 'backup'">
            <p v-if="block" class="alert">{{ block }}</p>
            <p v-else class="state-note"><run-status :inst="inst"/><span>{{ B.staysClosed(inst.slicer) }}</span></p>
            <p class="note">{{ B.restoreNote }}</p>
            <p class="safe-note"><ui-icon name="backup"/><span>{{ B.restoreSafe }}</span></p>

            <details class="more">
              <summary>{{ B.details }}</summary>
              <dl class="facts">
                <div><dt>{{ B.file }}</dt><dd><code>{{ pb.name }}</code></dd></div>
                <div><dt>{{ B.content }}</dt><dd>{{ plural(pb.files, ...T.words.file) }}</dd></div>
                <div v-if="list.location"><dt>{{ B.location }}</dt><dd><code>{{ list.location }}</code></dd></div>
              </dl>
            </details>

            <p v-if="actionError" class="alert" role="alert">{{ actionError }}</p>
            <div class="actions">
              <button class="btn btn-danger" type="button" :disabled="busy" @click="openPanel('delete', pb)"><ui-icon name="trash"/>{{ B.deleteOpen }}</button>
              <button class="btn btn-primary right" type="button" :disabled="busy || !!block" @click="planRestore">
                <ui-icon name="backup"/>{{ busy ? B.planning : B.restoreOpen }}
              </button>
            </div>
          </template>

          <template v-else-if="panel.type === 'restore' && restorePlan">
            <plan-view :plan="restorePlan" :inst="inst" :busy="busy" :error="actionError" :can-replan="outdated" restore
                       :lead="pending ? B.pendingLost : ''" @apply="runRestore" @back="backFromPlan" @replan="planRestore"/>
          </template>

          <template v-else-if="panel.type === 'delete'">
            <p class="plan-line"><ui-icon name="trash" class="ch-delete"/><span>{{ B.deletePlan(fmtSize(pb.size)) }}</span></p>
            <p v-if="backups.length === 1" class="alert">{{ B.lastOne }}</p>
            <p v-if="actionError" class="alert" role="alert">{{ actionError }}</p>
            <div class="actions">
              <button class="btn" type="button" :disabled="busy" @click="openPanel('backup', pb)">{{ T.back }}</button>
              <button class="btn btn-danger-solid right" type="button" :disabled="busy" @click="removeBackup">
                <ui-icon name="trash"/>{{ busy ? B.deleting : B.delete }}
              </button>
            </div>
          </template>
        </template>
      </div>
    </aside>
  `,
};
