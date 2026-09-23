// App frame: top bar, main menu on the left (ionpy device window), one page per hash route,
// and the change list that all pages fill. The data comes live from GET /api/data (common.js).
// "Übernehmen …" writes in two steps (hard rule 5): POST /plan shows "Das passiert" (plan.js),
// its "Übernehmen" sends POST /apply; the backend backs up first, then the data is read again. What
// the backend's check after writing reports stays in the panel (DoneView).
import {
  INSTANCES, FAILED, BACKUPS, PRINTER_PAGES, route, ui, loadState, load, go, hashOf, syncRoute, leave, flash, statusText, generatedText,
  liveChanges, resetChanges, addDataDir, removeDataDir, writeBlock, refreshBackups, registerCommon,
} from "./common.js";
import { T, LANG, LANGUAGES } from "./texts.js";
import { api } from "./api.js";
import { changesOf } from "./ops.js";
import PlanView, { DoneView, problemText } from "./plan.js";
import FilamentePage, { changes as filamentChanges } from "./pages/filamente.js";
import DruckerPage from "./pages/drucker.js";
import SicherungenPage from "./pages/sicherungen.js";
import SlicerPage from "./pages/slicer.js";
import ProzessePage from "./pages/prozesse.js";
import DetailsPage from "./pages/details.js";
import TransferPage, { transferChanges } from "./pages/transfer.js";
import VergleichenPage from "./pages/vergleichen.js";
import KameraPage from "./pages/kamera.js";
import LogsPage from "./pages/logs.js";
import KalibrierenPage, { calibrationChanges } from "./pages/kalibrieren.js";

const { createApp, ref, reactive, computed, watch, nextTick, onMounted, onUnmounted } = Vue;

document.documentElement.lang = LANG;

// Order = reading order. "Slicer" sits under its own heading, so it reads as the technical extra.
// sub: a page about the one above, set in a little under it: Kalibrieren, Übertragen and Vergleichen
// work on filament profiles, the camera belongs to the printer (its address is on the printer's card).
const PAGES = [
  { id: "filamente", icon: "spool", component: FilamentePage },
  { id: "kalibrieren", icon: "calibrate", component: KalibrierenPage, sub: true },
  { id: "transfer", icon: "transfer", component: TransferPage, sub: true },
  { id: "vergleichen", icon: "compare", component: VergleichenPage, sub: true },
  { id: "prozesse", icon: "layers", component: ProzessePage },
  { id: "drucker", icon: "printer", component: DruckerPage },
  // Needs no slicer data: shows at once and stays through "Neu einlesen".
  { id: "kamera", icon: "camera", component: KameraPage, standalone: true, sub: true },
  { id: "sicherungen", icon: "backup", component: SicherungenPage },
  { id: "slicer", icon: "folder", group: T.nav.technik, component: SlicerPage },
  { id: "details", icon: "info", component: DetailsPage },
  { id: "logs", icon: "log", component: LogsPage },
].map((p) => ({ ...p, label: T.nav.pages[p.id] }));

// Icon and colour class per type of change; the verbs are in texts.js.
const CHANGE = {
  on: { icon: "check", cls: "ch-on" }, off: { icon: "minus", cls: "ch-off" },
  new: { icon: "plus", cls: "ch-new" }, delete: { icon: "trash", cls: "ch-delete" },
  rename: { icon: "pencil", cls: "ch-rename" }, edit: { icon: "pencil", cls: "ch-edit" },
  remove: { icon: "minus", cls: "ch-off" }, default: { icon: "star", cls: "ch-on" },
  clean: { icon: "broom", cls: "ch-off" }, hide: { icon: "minus", cls: "ch-off" },
  copy: { icon: "transfer", cls: "ch-new" },
};

const app = createApp({
  components: { PlanView, DoneView },
  setup() {
    const inst = computed(() => INSTANCES.find((i) => i.id === ui.instId) || null);
    const page = computed(() => PAGES.find((p) => p.id === route.value.page));
    // A new key per route and per load mounts the page fresh, so a printer view never patches
    // over the last one and never keeps state from old data.
    const pageKey = computed(() => page.value?.standalone ? route.value.page
      : [route.value.page, ui.instId, route.value.modelIdx, loadState.version].join("|"));
    const pageProps = computed(() => PRINTER_PAGES.includes(route.value.page)
      ? { instId: ui.instId, modelIdx: route.value.modelIdx }
      : { instId: ui.instId });
    // Between "Filamente" and "Prozesse" the menu keeps the printer.
    const navHash = (p) => hashOf(p.id, ui.instId,
      PRINTER_PAGES.includes(p.id) && PRINTER_PAGES.includes(route.value.page) ? route.value.modelIdx : null);

    // ------------------------------------------------------------ change list
    // All pages, all installations. Each installation is planned and written on its own, with
    // its own backup. "Übernehmen" is off where OrcaOne may not write (writeBlock in common.js);
    // the plan can still refuse, then it says why.
    const changes = computed(() => [...filamentChanges.value, ...calibrationChanges.value, ...liveChanges.value, ...transferChanges.value]);
    const changeGroups = computed(() => INSTANCES.map((i) => {
      const block = writeBlock(i);
      return { inst: i, items: changes.value.filter((c) => c.inst === i), block: block ? problemText(block, i) : "" };
    }).filter((g) => g.items.length));
    // planned: { inst, plan } after POST /plan; the panel shows "Das passiert" then.
    const planned = ref(null);
    // done: { inst, warnings } after POST /apply, if its check reported something.
    const done = ref(null);
    const plan = reactive({ busy: false, error: "", outdated: false, groupError: {} });
    const changesOpen = ref(false);
    let changesFocus = null;
    // "Übernehmen …" shows "Das passiert" right away: one click shows the plan, the next one
    // writes it (hard rule 5). The list of changes comes first only if there is a choice or a
    // stop: changes for several installations, or one OrcaOne may not write to now.
    const direct = () => changeGroups.value.length === 1 && !changeGroups.value[0].block;
    function openChanges() {
      if (!changesOpen.value) changesFocus = document.activeElement;
      changesOpen.value = true;
      done.value = null;
      if (direct()) makePlan(changeGroups.value[0].inst);
      nextTick(() => document.getElementById("changes-title")?.focus());
    }
    function closeChanges() {
      changesOpen.value = false;
      planned.value = null;
      done.value = null;
      if (changesFocus && document.contains(changesFocus)) changesFocus.focus();
      changesFocus = null;
    }
    function discard() {
      resetChanges();
      closeChanges();
      flash(T.changes.discarded);
    }

    // ------------------------------------------------------------ plan and apply
    // A change on a page while the plan shows makes it stale: plan again, or back to the list.
    watch(changes, () => {
      if (plan.busy) return;
      planned.value = null;
      if (changesOpen.value && !done.value && direct()) makePlan(changeGroups.value[0].inst);
    });
    const focusTitle = () => nextTick(() => document.getElementById("changes-title")?.focus());

    async function makePlan(i) {
      if (plan.busy || writeBlock(i)) return;
      plan.busy = true;
      plan.error = "";
      plan.outdated = false;
      plan.groupError = {};
      try {
        const data = await api.plan(i.id, changesOf(i));
        done.value = null;
        planned.value = { inst: i, plan: data.plan };
        focusTitle();
      } catch (err) {
        if (planned.value) planned.value = null;
        plan.groupError = { [i.id]: problemText(err.code, i, err.data) };
      } finally {
        plan.busy = false;
      }
    }
    function backToList() {
      if (direct()) return closeChanges();
      planned.value = null;
      plan.error = "";
      plan.outdated = false;
      focusTitle();
    }
    // The backend checks again right before writing, backs up, writes and checks after. Then
    // everything is read again: the pending changes of all installations are gone with that.
    async function runPlan() {
      const p = planned.value;
      if (!p || plan.busy) return;
      plan.busy = true;
      plan.error = "";
      plan.outdated = false;
      let result;
      try {
        result = await api.apply(p.inst.id, p.plan.id);
      } catch (err) {
        plan.error = problemText(err.code, p.inst, err.data);
        // A plan that is stale or gone (OrcaOne restarted) can be made again from the list.
        plan.outdated = err.code === "plan_outdated" || err.code === "plan_not_found";
        if (err.data?.backup) {
          // The backup was made already, the list must show it. After a write that failed and
          // could not be rolled back the files changed: read everything again, like after a
          // write. The pending changes refer to the old state then; the panel keeps the error.
          if (err.code === "write_failed" && !err.data.rolled_back) {
            if (!(await load())) resetChanges();
          } else {
            await refreshBackups(p.inst.id);
          }
        }
        plan.busy = false;
        return;
      }
      const others = changes.value.some((c) => c.inst.id !== p.inst.id);
      // The files changed: pending changes of the old state must not stay, even if reading fails.
      if (!(await load())) resetChanges();
      plan.busy = false;
      const text = others ? T.changes.appliedOthersGone : T.changes.applied;
      flash(text);
      const warnings = result.warnings || [];
      if (!warnings.length) return closeChanges();
      // The installation as read again, so names show as they are now.
      planned.value = null;
      done.value = { inst: INSTANCES.find((i) => i.id === p.inst.id) || p.inst, warnings, text: T.changes.appliedCheck };
      focusTitle();
    }
    // Escape closes the change list first; the page's own panel lies below it.
    const onKey = (ev) => {
      if (ev.key !== "Escape" || !changesOpen.value) return;
      ev.stopPropagation();
      closeChanges();
    };
    onMounted(() => window.addEventListener("keydown", onKey, true));
    onUnmounted(() => window.removeEventListener("keydown", onKey, true));

    // What the menu shows on the right: pending changes per page (orange, all installations, as
    // the change bar counts them), else the backups of the chosen installation.
    const badges = computed(() => {
      const out = {};
      for (const p of PAGES) {
        const n = changes.value.filter((c) => c.page === p.id).length;
        if (n) out[p.id] = { n, text: T.nav.pending, changed: true };
      }
      const backups = inst.value ? BACKUPS[inst.value.id]?.backups.length || 0 : 0;
      if (!out.sicherungen && backups) out.sicherungen = { n: backups, text: T.nav.backups, changed: false };
      return out;
    });

    // ------------------------------------------------------------ loading
    // "Neu einlesen" reads everything again and checks whether the slicers run.
    async function reread() {
      if (loadState.busy) return;
      const had = changes.value.length;
      if (await load()) flash(had ? T.reloadedDiscarded : T.reloaded);
      else flash(T.errors[loadState.error] || T.errors.unknown);
    }
    const loadError = computed(() => T.loadError[loadState.error === "network" ? "network" : "other"]);
    load();

    // The language at the bottom of the menu: saved in data/settings.json, then the page loads
    // anew, as every page reads its texts once. Queued changes would be lost, so they go first.
    function setLanguage(code) {
      if (code === LANG) return;
      if (changes.value.length) return flash(T.nav.languageBlocked);
      leave(async () => {
        try {
          await api.setLanguage(code);
          location.reload();
        } catch (err) {
          flash(T.errors[err.code] || T.errors.unknown);
        }
      });
    }

    // First start without any installation: the form adds one by hand.
    const newPath = ref("");
    const addError = ref("");
    async function addDir() {
      const path = newPath.value.trim();
      if (!path) return;
      addError.value = "";
      const code = await addDataDir(path);
      if (code) addError.value = T.errors[code] || T.errors.unknown;
      else flash(T.add.added);
    }
    // A data directory added by hand that cannot be read can still be removed.
    async function removeFailed(f) {
      if (loadState.busy) return;
      const code = await removeDataDir(f);
      flash(code ? T.errors[code] || T.errors.unknown : T.slicer.removed);
    }

    // ------------------------------------------------------------ installation picker
    const instOpen = ref(false);
    const instBtn = ref(null);
    const instMenu = ref(null);

    window.addEventListener("hashchange", () => syncRoute());
    // The address carries the installation; one without it gets the chosen one added.
    watch(route, (r) => {
      if (r.instId) ui.instId = r.instId;
      else if (ui.instId) history.replaceState(null, "", hashOf(r.page, ui.instId));
    }, { immediate: true });
    // After a page switch the focus moves to the page title.
    watch(route, () => {
      instOpen.value = false;
      window.scrollTo(0, 0);
      nextTick(() => document.getElementById("page-title")?.focus());
    });

    function toggleInst() {
      instOpen.value = !instOpen.value;
      if (instOpen.value) nextTick(() => instMenu.value?.querySelector('[aria-checked="true"]')?.focus());
    }
    function closeInst() {
      instOpen.value = false;
      instBtn.value?.focus();
    }
    function pickInst(i) {
      closeInst();
      if (i.id === ui.instId) return;
      const r = route.value;
      const current = r.page === "filamente" && r.modelIdx !== null ? inst.value.models[r.modelIdx] : null;
      if (!current) return go(null, hashOf(r.page, i.id));
      // Stay with the same printer model if the other installation has it, else show its printers.
      const idx = i.models.findIndex((m) => m.model === current.model);
      go(null, hashOf("filamente", i.id, idx >= 0 ? idx : null));
    }
    function instKey(ev) {
      if (!instOpen.value) return;
      if (ev.key === "Escape") {
        ev.stopPropagation();  // the page's own Escape (side panel) stays untouched
        closeInst();
      } else if (ev.key === "Tab") {
        ev.preventDefault();  // back to the button, as with Escape; the removed item cannot keep the focus
        closeInst();
      } else if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
        ev.preventDefault();
        const items = [...instMenu.value.querySelectorAll(".inst-item")];
        const n = items.indexOf(document.activeElement), down = ev.key === "ArrowDown";
        const next = n < 0 ? (down ? 0 : items.length - 1) : (n + (down ? 1 : items.length - 1)) % items.length;
        items[next].focus();
      }
    }
    document.addEventListener("pointerdown", (ev) => {
      if (instOpen.value && !(ev.target instanceof Element && ev.target.closest(".inst"))) instOpen.value = false;
    });

    return {
      INSTANCES, FAILED, PAGES, CHANGE, T, route, ui, loadState, inst, page, pageKey, pageProps, navHash, badges, go, hashOf, leave,
      statusText, generatedText, instOpen, instBtn, instMenu, toggleInst, pickInst, instKey, reread, load, loadError,
      newPath, addError, addDir, removeFailed, changes, changeGroups, changesOpen, openChanges, closeChanges, discard,
      planned, done, plan, makePlan, backToList, runPlan, LANG, LANGUAGES, setLanguage,
    };
  },

  template: `
    <header class="topbar">
      <a class="brand" :href="hashOf('filamente', ui.instId)" @click="go($event, hashOf('filamente', ui.instId))"><spool-icon colour="#009688" :size="26"/><span class="brand-name">{{ T.appName }}</span></a>
      <span class="spacer"></span>
      <div v-if="INSTANCES.length > 1" class="inst" @keydown="instKey">
        <button ref="instBtn" class="inst-btn" type="button" aria-haspopup="menu" :aria-expanded="instOpen ? 'true' : 'false'"
                :title="inst.slicer + ' ' + inst.version + ' · ' + statusText(inst)" @click="toggleInst">
          <span class="inst-name">{{ inst.slicer }}</span>
          <run-status :inst="inst"/>
          <ui-icon name="chevronDown"/>
        </button>
        <div v-if="instOpen" ref="instMenu" class="inst-menu" role="menu" :aria-label="T.instMenu">
          <div class="inst-menu-label" aria-hidden="true">{{ T.instMenu }}</div>
          <button v-for="i in INSTANCES" :key="i.id" class="inst-item" type="button" role="menuitemradio"
                  :aria-checked="i.id === inst.id ? 'true' : 'false'" @click="pickInst(i)">
            <ui-icon name="check" class="check"/>
            <span class="inst-item-text">
              <span>{{ i.slicer }} <span class="version">{{ i.version }}</span></span>
              <span class="inst-item-path">{{ i.path }}</span>
              <run-status :inst="i"/>
            </span>
          </button>
        </div>
      </div>
      <span v-else-if="inst" class="inst-single">{{ inst.slicer }}</span>
      <button v-if="loadState.status === 'ready'" class="bar-btn" type="button" :aria-label="T.reload" :disabled="loadState.busy"
              :title="T.dataFrom(generatedText)" @click="leave(reread)">
        <ui-icon name="refresh"/><span class="bar-btn-label">{{ T.reload }}</span>
      </button>
    </header>

    <div class="shell">
      <nav class="nav" :aria-label="T.nav.label">
        <template v-for="p in PAGES" :key="p.id">
          <div v-if="p.group" class="nav-label">{{ p.group }}</div>
          <a :class="['nav-item', { 'is-sub': p.sub }]" :href="navHash(p)" :aria-current="route.page === p.id ? 'page' : null" @click="go($event, navHash(p))">
            <ui-icon :name="p.icon"/><span class="nav-text">{{ p.label }}</span>
            <span v-if="badges[p.id]" :class="['nav-count', { 'is-changed': badges[p.id].changed }]"
                  :title="badges[p.id].n + ' ' + badges[p.id].text">{{ badges[p.id].n }}<span class="sr-only"> {{ badges[p.id].text }}</span></span>
          </a>
        </template>
        <div class="nav-lang" role="group" :aria-label="T.nav.language">
          <button v-for="l in LANGUAGES" :key="l.code" class="nav-lang-btn" type="button" :lang="l.code"
                  :aria-pressed="l.code === LANG ? 'true' : 'false'" @click="setLanguage(l.code)">{{ l.name }}</button>
        </div>
      </nav>
      <main class="main">
        <div v-if="FAILED.length" class="page failed-list" role="alert">
          <p v-for="f in FAILED" :key="f.id" class="alert">
            {{ T.failed[f.code] ? T.failed[f.code](f) : f.code }}
            <button v-if="f.manual" class="link" type="button" :disabled="loadState.busy" @click="leave(() => removeFailed(f))">{{ T.slicer.remove }}</button>
          </p>
        </div>
        <component v-if="inst || page.standalone" :is="page.component" :key="pageKey" v-bind="pageProps"/>
        <div v-else class="page">
          <p v-if="loadState.status === 'loading'" class="loading" role="status">{{ T.loading }}</p>
          <section v-else-if="loadState.status === 'error'" class="soon" role="alert">
            <span class="soon-icon is-bad"><ui-icon name="warn" :size="44"/></span>
            <h1 id="page-title" tabindex="-1" class="soon-title">{{ loadError.title }}</h1>
            <p class="soon-text">{{ loadError.text }}</p>
            <button class="btn btn-primary" type="button" :disabled="loadState.busy" @click="load">{{ T.retry }}</button>
          </section>
          <section v-else class="soon">
            <span class="soon-icon"><ui-icon name="folder" :size="44"/></span>
            <h1 id="page-title" tabindex="-1" class="soon-title">{{ FAILED.length ? T.add.title : T.empty.title }}</h1>
            <p v-if="!FAILED.length" class="soon-text">{{ T.empty.text }}</p>
            <form class="add-form" @submit.prevent="addDir">
              <input v-model="newPath" class="input" type="text" autocomplete="off" :placeholder="T.add.placeholder" :aria-label="T.add.label"
                     :aria-invalid="addError ? 'true' : 'false'" aria-describedby="add-error">
              <button class="btn btn-primary" type="submit" :disabled="!newPath.trim()">{{ T.add.button }}</button>
            </form>
            <p id="add-error" class="field-error" aria-live="polite">{{ addError }}</p>
            <button class="btn" type="button" :disabled="loadState.busy" @click="reread"><ui-icon name="refresh"/>{{ T.reload }}</button>
          </section>
        </div>

        <aside v-if="changesOpen" class="panel changes-panel" aria-labelledby="changes-title">
          <div class="panel-head">
            <h2 id="changes-title" tabindex="-1">{{ done ? T.changes.applied : planned ? T.plan.title : T.changes.title }}</h2>
            <button class="icon-btn" type="button" :aria-label="T.close" @click="closeChanges"><ui-icon name="close"/></button>
          </div>
          <div class="panel-body">
            <template v-if="done">
              <p class="note plan-for">{{ T.plan.forInst(done.inst.slicer, done.inst.path) }}</p>
              <done-view :warnings="done.warnings" :inst="done.inst" :text="done.text" @close="closeChanges"/>
            </template>
            <template v-else-if="planned">
              <p class="note plan-for">{{ T.plan.forInst(planned.inst.slicer, planned.inst.path) }}</p>
              <plan-view :plan="planned.plan" :inst="planned.inst" :busy="plan.busy" :error="plan.error" :can-replan="plan.outdated"
                         @apply="runPlan" @back="backToList" @replan="makePlan(planned.inst)"/>
            </template>
            <p v-else-if="plan.busy" class="note">{{ T.changes.planning }}</p>
            <template v-else>
              <p v-if="!changes.length" class="note">{{ T.changes.none }}</p>
              <section v-for="g in changeGroups" :key="g.inst.id" class="change-group" :aria-label="g.inst.slicer">
                <h3>{{ g.inst.slicer }}<small class="change-path">{{ g.inst.path }}</small></h3>
                <ul class="plain-list">
                  <li v-for="(c, n) in g.items" :key="n">
                    <span :class="CHANGE[c.type].cls"><ui-icon :name="CHANGE[c.type].icon"/></span>
                    <span class="grow"><strong>{{ c.name }}</strong> {{ T.changes.verbs[c.type] }}<small v-if="c.where">{{ c.where }}</small></span>
                  </li>
                </ul>
                <p v-if="g.block" class="alert">{{ g.block }}</p>
                <p v-else-if="plan.groupError[g.inst.id]" class="alert" role="alert">{{ plan.groupError[g.inst.id] }}</p>
                <div v-if="changeGroups.length > 1" class="actions">
                  <button class="btn btn-primary right" type="button" :disabled="!!g.block || plan.busy"
                          :aria-label="T.changes.applyFor(g.inst.slicer)" @click="makePlan(g.inst)">{{ plan.busy ? T.changes.planning : T.changes.apply }}</button>
                </div>
              </section>
              <p v-if="changes.length" class="note">{{ T.changes.safe }}</p>
              <div class="actions">
                <button class="btn" type="button" @click="closeChanges">{{ T.back }}</button>
                <button v-if="changeGroups.length === 1" class="btn btn-primary right" type="button"
                        :disabled="!!changeGroups[0].block || plan.busy" @click="makePlan(changeGroups[0].inst)">
                  {{ plan.busy ? T.changes.planning : T.changes.apply }}
                </button>
              </div>
            </template>
          </div>
        </aside>
      </main>
    </div>

    <div v-if="changes.length" class="changebar">
      <span class="what">{{ T.changes.count(changes.length) }}</span>
      <button class="btn" type="button" @click="leave(discard)">{{ T.changes.discard }}</button>
      <button class="btn btn-primary" type="button" @click="leave(openChanges)">{{ T.changes.open }}</button>
    </div>

    <div :class="['toast', { show: ui.toast }]" role="status" aria-live="polite">{{ ui.toast }}</div>
  `,
});

registerCommon(app);
app.mount("#app");
