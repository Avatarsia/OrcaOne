// App frame: top bar, main menu on the left (ionpy device window), one page per hash route,
// and the change list that all pages fill. The data comes live from GET /api/data (common.js).
// "Übernehmen …" writes in two steps (hard rule 5): POST /plan shows "Das passiert" (plan.js),
// its "Übernehmen" sends POST /apply; the backend backs up first, then the data is read again. What
// the backend's check after writing reports stays in the panel (DoneView).
import {
  INSTANCES, FAILED, BACKUPS, NEWS, PRINTER_PAGES, route, ui, loadState, load, go, hashOf, syncRoute, leave, flash, statusText, generatedText,
  liveChanges, resetChanges, addDataDir, removeDataDir, writeBlock, refreshBackups, registerCommon, darkQuery, isDark,
  printerModels, slicerModel, modelName, modelShown, U1_MODELS, fmtSize, whenText, setLocalPrintFile,
} from "./common.js";
import { T, LANG, LANGUAGES, SETTINGS } from "./texts.js";
import { api } from "./api.js";
import { changesOf } from "./ops.js";
import PlanView, { DoneView, problemText } from "./plan.js";
import UebersichtPage from "./pages/uebersicht.js";
import FilamentePage, { changes as filamentChanges } from "./pages/filamente.js";
import DruckerPage from "./pages/drucker.js";
import SicherungenPage from "./pages/sicherungen.js";
import SlicerPage from "./pages/slicer.js";
import ProzessePage from "./pages/prozesse.js";
import DetailsPage from "./pages/details.js";
import TransferPage, { transferChanges } from "./pages/transfer.js";
import VergleichenPage from "./pages/vergleichen.js";
import ImportPage, { importChanges } from "./pages/import.js";
import AenderungenPage from "./pages/aenderungen.js";
import BereinigenPage from "./pages/bereinigen.js";
import KameraPage from "./pages/kamera.js";
import StatusPage from "./pages/status.js";
import Druck3dPage from "./pages/druck3d.js";
import Druck2dPage from "./pages/druck2d.js";
import DateienPage from "./pages/dateien.js";
import KonsolePage from "./pages/konsole.js";
import SshPage from "./pages/ssh.js";
import LogsPage from "./pages/logs.js";
import KalibrierenPage, { calibrationChanges } from "./pages/kalibrieren.js";
import LizenzPage from "./pages/lizenz.js";
import PrintPanel from "./pages/print-panel.js";

const { createApp, ref, reactive, computed, watch, nextTick, onMounted, onUnmounted } = Vue;

// The boot screen stays at least this long (the user: 1.2 s was too short, 3 s of waiting only looked
// slow) and a little after the last step, so its tick shows. Fading in takes 0.9 s.
const SPLASH_MS = 1500;
const SPLASH_HOLD_MS = 700;
const PROGRESS_MS = 150;   // how often the boot screen asks what the scan does
const JOB_MS = 5000;       // how often the top bar looks whether the printer started a print
const STOP_ARMED_MS = 4000; // how long the emergency stop waits for its second click

document.documentElement.lang = LANG;
// The design chosen in the menu; GET / brings it already (app.py), /index.html does not.
if (SETTINGS.theme) document.documentElement.dataset.theme = SETTINGS.theme;

// Order = reading order, as the user set it on 24.09.2026: the start page "Übersicht", Drucker,
// then Prozesse and Filamente, the quick tool "3MF bereinigen", and Slicer.
// sub: a page about the one above, set in a little under it: status, 3D and 2D view, files, camera, G-code
// console and SSH of the printer (its address is on the printer's card); Übertragen, Vergleichen, Kalibrieren,
// Import/Export and Details work on filament profiles; backups, "Änderungen" and logs are the
// slicer's. u1: in the menu only while a U1 is the printer in the top bar (the user's wish);
// printer: built anew for another printer there ("Filamente" and "Prozesse" have it in the address).
const PAGES = [
  { id: "uebersicht", icon: "home", component: UebersichtPage, printer: true },
  { id: "drucker", icon: "printer", component: DruckerPage },
  // Need no slicer data: show at once and stay through "Neu einlesen".
  { id: "status", icon: "pulse", component: StatusPage, standalone: true, sub: true, printer: true },
  // "Dateien" before the views: a print file chosen there is the one they show (the user's wish).
  { id: "dateien", icon: "folderOpen", component: DateienPage, standalone: true, sub: true, u1: true, printer: true },
  { id: "druck3d", icon: "cube", component: Druck3dPage, standalone: true, sub: true, printer: true },
  { id: "druck2d", icon: "toolpath", component: Druck2dPage, standalone: true, sub: true, printer: true },
  { id: "kamera", icon: "camera", component: KameraPage, standalone: true, sub: true, u1: true, printer: true },
  { id: "konsole", icon: "code", component: KonsolePage, standalone: true, sub: true, printer: true },
  { id: "ssh", icon: "terminal", component: SshPage, standalone: true, sub: true, printer: true },
  { id: "prozesse", icon: "layers", component: ProzessePage },
  { id: "filamente", icon: "spool", component: FilamentePage },
  { id: "transfer", icon: "transfer", component: TransferPage, sub: true },
  { id: "vergleichen", icon: "compare", component: VergleichenPage, sub: true },
  { id: "kalibrieren", icon: "calibrate", component: KalibrierenPage, sub: true, u1: true, printer: true },
  { id: "import", icon: "import", component: ImportPage, sub: true },
  { id: "details", icon: "info", component: DetailsPage, sub: true },
  { id: "bereinigen", icon: "broom", component: BereinigenPage, standalone: true },
  { id: "slicer", icon: "folder", component: SlicerPage },
  { id: "sicherungen", icon: "backup", component: SicherungenPage, sub: true },
  { id: "aenderungen", icon: "diff", component: AenderungenPage, sub: true },
  { id: "logs", icon: "log", component: LogsPage, sub: true },
  // Not in the menu: "by Dr. Klipper" at its bottom leads here.
  { id: "lizenz", icon: "info", component: LizenzPage, standalone: true, hidden: true },
].map((p) => ({ ...p, label: T.nav.pages[p.id] }));

// Icon and colour class per type of change; the verbs are in texts.js.
const CHANGE = {
  on: { icon: "check", cls: "ch-on" }, off: { icon: "minus", cls: "ch-off" },
  new: { icon: "plus", cls: "ch-new" }, delete: { icon: "trash", cls: "ch-delete" },
  rename: { icon: "pencil", cls: "ch-rename" }, edit: { icon: "pencil", cls: "ch-edit" },
  remove: { icon: "minus", cls: "ch-off" }, default: { icon: "star", cls: "ch-on" },
  clean: { icon: "broom", cls: "ch-off" }, hide: { icon: "minus", cls: "ch-off" },
  copy: { icon: "transfer", cls: "ch-new" }, import: { icon: "import", cls: "ch-new" },
};

const app = createApp({
  components: { PlanView, DoneView, PrintPanel },
  setup() {
    const inst = computed(() => INSTANCES.find((i) => i.id === ui.instId) || null);
    const page = computed(() => PAGES.find((p) => p.id === route.value.page));
    // A new key per route and per load mounts the page fresh, so a printer view never patches
    // over the last one and never keeps state from old data.
    const pageKey = computed(() => {
      const printer = page.value?.printer ? ui.printer : "";
      return page.value?.standalone ? [route.value.page, printer].join("|")
        : [route.value.page, ui.instId, route.value.modelIdx, printer, loadState.version].join("|");
    });
    const pageProps = computed(() => PRINTER_PAGES.includes(route.value.page)
      ? { instId: ui.instId, modelIdx: route.value.modelIdx }
      : { instId: ui.instId });

    // ------------------------------------------------------------ the printer in the top bar
    // The one printer OrcaOne works with, for every page (the user's wish of 24.09.2026): at the
    // start the one the slicer starts with; another installation keeps the model if it has it.
    const printers = computed(() => printerModels(inst.value));
    const activeModel = computed(() => printers.value.find((m) => m.model === ui.printer) || null);
    const activeIdx = computed(() => (activeModel.value ? inst.value.models.indexOf(activeModel.value) : null));
    const isU1 = computed(() => U1_MODELS.includes(ui.printer));
    watch([inst, printers], () => {
      if (inst.value && !activeModel.value) ui.printer = slicerModel(inst.value)?.model || null;
    }, { immediate: true });
    // "Filamente" and "Prozesse" carry the printer in the address (#/filamente/<inst>/<idx>): an
    // address without one gets it, one with another (the back button) chooses that one.
    watch([route, activeIdx], ([r]) => {
      if (!PRINTER_PAGES.includes(r.page) || !inst.value || r.instId !== inst.value.id) return;
      if (r.modelIdx === null) {
        if (activeIdx.value === null) return;
        history.replaceState(null, "", hashOf(r.page, inst.value.id, activeIdx.value));
        return syncRoute();
      }
      const m = inst.value.models[r.modelIdx];
      if (m && modelShown(inst.value, m) && m.model !== ui.printer) ui.printer = m.model;
    }, { immediate: true });
    watch(() => ui.printer, () => {
      const r = route.value;
      if (PRINTER_PAGES.includes(r.page) && activeIdx.value !== null && r.modelIdx !== activeIdx.value) {
        go(null, hashOf(r.page, ui.instId, activeIdx.value));
      }
    });
    const navHash = (p) => hashOf(p.id, ui.instId, PRINTER_PAGES.includes(p.id) ? activeIdx.value : null);
    // The pages for a U1 only while a U1 is chosen, without "(U1)" in their name.
    const menuPages = computed(() => PAGES.filter((p) => !p.hidden && (!p.u1 || isU1.value)));

    // ------------------------------------------------------------ change list
    // All pages, all installations. Each installation is planned and written on its own, with
    // its own backup. "Übernehmen" is off where OrcaOne may not write (writeBlock in common.js);
    // the plan can still refuse, then it says why.
    const changes = computed(() => [...filamentChanges.value, ...calibrationChanges.value, ...liveChanges.value, ...transferChanges.value, ...importChanges.value]);
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
      printPanel.value = null;  // both sit on the right
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
    // The menu: in a wide window a column that the button in the top bar folds away (saved in
    // data/settings.json), in a narrow one a drawer over the page that the button opens.
    const narrowQuery = window.matchMedia("(max-width: 900px)");
    const narrow = ref(narrowQuery.matches);
    const navOpen = ref(false);
    const navCollapsed = ref(SETTINGS.menu_collapsed === true);
    const navBtn = ref(null);
    narrowQuery.addEventListener("change", (ev) => {
      narrow.value = ev.matches;
      navOpen.value = false;
    });
    const navShown = computed(() => narrow.value ? navOpen.value : !navCollapsed.value);
    async function toggleNav() {
      if (narrow.value) {
        navOpen.value = !navOpen.value;
        return;
      }
      navCollapsed.value = !navCollapsed.value;
      try {
        await api.setMenuCollapsed(navCollapsed.value);
      } catch (err) {
        flash(T.errors[err.code] || T.errors.unknown);
      }
    }
    function closeNav() {
      navOpen.value = false;
      navBtn.value?.focus();
    }
    // Escape closes the change list first, then the menu drawer; the page's own panel lies below.
    const onKey = (ev) => {
      if (ev.key !== "Escape") return;
      if (changesOpen.value) closeChanges();
      else if (narrow.value && navOpen.value) closeNav();
      else return;
      ev.stopPropagation();
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
      const news = inst.value ? NEWS[inst.value.id] || 0 : 0;
      if (!out.aenderungen && news) out.aenderungen = { n: news, text: T.nav.news, changed: false };
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

    // ------------------------------------------------------------ boot screen
    // On every page load until the installations are read (the user's wish of 24.09.2026: logo,
    // "by Dr. Klipper", the licence), with the steps the backend works through (GET /api/progress)
    // and a bar that fills with them. An error shows at once; "Neu einlesen" never brings it back.
    const splash = reactive({ shown: true, leaving: false, steps: [], total: 0 });
    const splashFrom = performance.now();
    let seenRunning = false;
    async function askProgress(final = false) {
      try {
        const got = await api.progress();
        // Until this load's scan starts, the answer is the last scan's, every step done: not shown.
        if (got.steps.some((s) => !s.done)) seenRunning = true;
        if (seenRunning || final) Object.assign(splash, { steps: got.steps, total: got.total });
      } catch {
        // No answer: the bar just keeps running.
      }
    }
    const progressTimer = setInterval(askProgress, PROGRESS_MS);
    function hideSplash(wait) {
      setTimeout(() => {
        splash.leaving = true;
        setTimeout(() => { splash.shown = false; }, 400);
      }, wait);
    }
    const stopSplash = watch(() => loadState.status, async (status) => {
      if (status === "loading") return;
      stopSplash();
      clearInterval(progressTimer);
      if (status === "error") return hideSplash(0);
      await askProgress(true);
      hideSplash(Math.max(SPLASH_MS - (performance.now() - splashFrom), SPLASH_HOLD_MS));
    });
    // The last six steps; the list only grows, so the position is the key.
    const splashSteps = computed(() => {
      const from = Math.max(0, splash.steps.length - 6);
      return splash.steps.slice(from).map((s, i) => ({ ...s, key: from + i }));
    });
    const splashPct = computed(() => (splash.total ? Math.min(100, (100 * splash.steps.filter((s) => s.done).length) / splash.total) : 0));
    const stepText = (s) => (s.failed ? T.splash.failed(s) : T.splash.steps[s.code]?.(s, fmtSize(s.size || 0)) || s.code);

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

    // Light or dark at the bottom of the menu: at once, and saved for the next start. Without a
    // choice the page follows the system, also when it changes.
    const dark = ref(isDark());
    darkQuery.addEventListener("change", () => { dark.value = isDark(); });
    async function toggleTheme() {
      const next = dark.value ? "light" : "dark";
      document.documentElement.dataset.theme = next;
      dark.value = next === "dark";
      try {
        await api.setTheme(next);
      } catch (err) {
        flash(T.errors[err.code] || T.errors.unknown);
      }
    }
    const otherLanguage = computed(() => LANGUAGES.find((l) => l.code !== LANG));

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
    // After a page switch the focus moves to the page title; the drawer closes.
    watch(route, () => {
      instOpen.value = false;
      printerOpen.value = false;
      fileOpen.value = false;
      cancelAsk.value = false;
      printPanel.value = null;
      navOpen.value = false;
      window.scrollTo(0, 0);
      nextTick(() => document.getElementById("page-title")?.focus());
    });

    function toggleInst() {
      instOpen.value = !instOpen.value;
      printerOpen.value = fileOpen.value = false;
      if (instOpen.value) nextTick(() => instMenu.value?.querySelector('[aria-checked="true"]')?.focus());
    }
    function closeInst() {
      instOpen.value = false;
      instBtn.value?.focus();
    }
    // The printer stays if the other installation has the model (watcher above), the page too.
    function pickInst(i) {
      closeInst();
      if (i.id !== ui.instId) go(null, hashOf(route.value.page, i.id));
    }
    const printerOpen = ref(false);
    const printerBtn = ref(null);
    const printerMenu = ref(null);
    function togglePrinter() {
      printerOpen.value = !printerOpen.value;
      instOpen.value = fileOpen.value = false;
      if (printerOpen.value) nextTick(() => printerMenu.value?.querySelector('[aria-checked="true"]')?.focus());
    }
    function closePrinter() {
      printerOpen.value = false;
      printerBtn.value?.focus();
    }
    function pickPrinter(m) {
      closePrinter();
      leave(() => { ui.printer = m.model; });
    }

    // ------------------------------------------------------------ the print file in the top bar
    // One print file for "2D-Ansicht" and "3D-Ansicht" (the user's wish of 24.09.2026): chosen here or
    // on "Dateien"; when the printer starts a print, from the slicer as from its display, its file.
    // At the start the file it prints, else its newest. Looked at every JOB_MS while the page shows,
    // read only (camera.status).
    const fileHost = ref("");       // the address of the printer in the top bar, "" without one
    const printFiles = ref(null);   // its print files, newest first; null until read
    const jobFile = ref(undefined); // the file it printed at the last look; undefined before the first
    const jobState = ref(null);     // Klipper's print_stats.state then (printing, paused, standby, …)
    const fileOpen = ref(false);
    const fileBtn = ref(null);
    const fileMenu = ref(null);
    const pathOf = (f) => f.path || f.name;
    async function readFiles() {
      const model = ui.printer;
      try {
        const files = (await api.printFiles(model)).files || [];
        if (model === ui.printer) printFiles.value = files;
      } catch {
        if (model === ui.printer) printFiles.value = [];
      }
      return printFiles.value || [];
    }
    async function lookAtJob() {
      const model = ui.printer;
      if (document.hidden || !model) return;
      try {
        if (!fileHost.value) fileHost.value = (await api.printers()).printers[model]?.host || "";
        if (!fileHost.value || model !== ui.printer) return;
        const job = await api.printerState(model);
        if (model !== ui.printer) return;
        jobState.value = job.state || null;
        const printing = ["printing", "paused"].includes(job.state) ? job.file : null;
        // The list at the first look (for the pictures) and when a print starts: the slicer may just have sent it.
        const first = jobFile.value === undefined;
        if (first || (printing && printing !== jobFile.value)) await readFiles();
        if (model !== ui.printer) return;
        if (printing && printing !== jobFile.value) ui.printFile = { model, path: printing };
        else if (first && !ui.printFile && printFiles.value?.[0]) ui.printFile = { model, path: pathOf(printFiles.value[0]) };
        jobFile.value = printing;
      } catch {
        // Not reachable right now: the file stays; what it does is unknown.
        if (model === ui.printer) jobState.value = null;
      }
    }
    // Another printer: its files; one of the other printer is not the file any more.
    watch(() => ui.printer, (model) => {
      fileHost.value = "";
      printFiles.value = null;
      jobFile.value = undefined;
      jobState.value = null;
      cancelAsk.value = false;
      disarmStop();
      printPanel.value = null;
      if (ui.printFile?.model && ui.printFile.model !== model) ui.printFile = null;
      lookAtJob();
    });
    setInterval(lookAtJob, JOB_MS);
    document.addEventListener("visibilitychange", lookAtJob);
    function toggleFile() {
      fileOpen.value = !fileOpen.value;
      instOpen.value = printerOpen.value = false;
      if (!fileOpen.value) return;
      if (fileHost.value) readFiles();
      nextTick(() => (fileMenu.value?.querySelector('[aria-checked="true"]') || fileMenu.value?.querySelector(".inst-item"))?.focus());
    }
    function closeFile() {
      fileOpen.value = false;
      fileBtn.value?.focus();
    }
    function pickFile(f) {
      ui.printFile = { model: ui.printer, path: pathOf(f) };
      closeFile();
    }
    function pickLocal(ev) {
      const file = ev.target.files[0];
      ev.target.value = "";
      if (file) setLocalPrintFile(file);
      closeFile();
    }
    const fileIsSet = (f) => ui.printFile?.model === ui.printer && ui.printFile.path === pathOf(f);
    // The slicer's picture of a print file (the user's wish), from the top of "gcodes" like the files.
    const thumbOf = (f) => (f?.thumb ? api.printFileUrl(ui.printer, f.thumb) : "");
    const fileThumb = computed(() => thumbOf(ui.printFile?.path && printFiles.value?.find((f) => pathOf(f) === ui.printFile.path)));
    const fileName = computed(() => {
      const f = ui.printFile;
      return f ? (f.local || f.path.split("/").pop()).replace(/\.(gcode|gco|g)$/i, "") : "";
    });
    const fileFacts = (f) => [jobFile.value === pathOf(f) ? T.fileMenu.printing : "", f.size != null ? fmtSize(f.size) : "",
      f.modified ? whenText(new Date(f.modified * 1000)) : ""].filter(Boolean).join(" · ");

    // ------------------------------------------------------------ print, cancel, emergency stop
    // Next to the print file, so the top bar runs almost everything (the user's wish of 24.09.2026).
    // Each only on a click: a print through the panel of "Dateien" (on the U1 with the options of its
    // display), cancelling after a question, the emergency stop on a second click.
    const printPanel = ref(null);   // { camera, file } while the panel shows
    const cancelAsk = ref(false);
    const stopArmed = ref(false);
    let stopTimer = 0;
    const jobBusy = computed(() => ["printing", "paused"].includes(jobState.value));
    // Why "Drucken" is off; "" when it is on.
    const startBlock = computed(() => {
      if (!ui.printFile) return T.printBar.noFile;
      if (ui.printFile.local || ui.printFile.model !== ui.printer) return T.printBar.localFile;
      if (!jobState.value) return T.printBar.unknown;
      return jobBusy.value ? T.printBar.busy : "";
    });
    const errorText = (err) => [T.files.errors[err.code] || T.errors[err.code] || T.errors.unknown, err.data?.detail].filter(Boolean).join(" ");
    // At once and again when Klipper has taken the command in.
    const lookSoon = () => { lookAtJob(); setTimeout(lookAtJob, 1500); };
    async function openPrint() {
      const model = ui.printer, path = ui.printFile.path;
      try {
        // The list anew: the slicer may just have sent the file, with the filaments for the heads.
        const file = (await readFiles()).find((f) => pathOf(f) === path);
        const camera = file && isU1.value ? (await api.cameras()).cameras.find((c) => c.model === model)?.id || null : null;
        if (model !== ui.printer) return;
        if (!file) return flash(T.printBar.gone);
        if (changesOpen.value) closeChanges();
        printPanel.value = { camera, file };
      } catch (err) {
        flash(errorText(err));
      }
    }
    async function cancelPrint() {
      cancelAsk.value = false;
      try {
        await api.printCancel(ui.printer);
        flash(T.printBar.cancelled);
      } catch (err) {
        flash(errorText(err));
      }
      lookSoon();
    }
    function disarmStop() {
      clearTimeout(stopTimer);
      stopArmed.value = false;
    }
    async function emergencyStop() {
      if (!stopArmed.value) {
        stopArmed.value = true;
        stopTimer = setTimeout(disarmStop, STOP_ARMED_MS);
        return;
      }
      disarmStop();
      try {
        await api.emergencyStop(ui.printer);
        flash(T.printBar.stopped);
      } catch (err) {
        flash(errorText(err));
      }
      lookSoon();
    }
    // Both menus in the top bar: arrows move, Escape and Tab go back to the button.
    function menuKeys(ev, menu, close) {
      if (ev.key === "Escape") {
        ev.stopPropagation();  // the page's own Escape (side panel) stays untouched
        close();
      } else if (ev.key === "Tab") {
        ev.preventDefault();  // back to the button, as with Escape; the removed item cannot keep the focus
        close();
      } else if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
        ev.preventDefault();
        const items = [...menu.querySelectorAll(".inst-item")];
        const n = items.indexOf(document.activeElement), down = ev.key === "ArrowDown";
        const next = n < 0 ? (down ? 0 : items.length - 1) : (n + (down ? 1 : items.length - 1)) % items.length;
        items[next].focus();
      }
    }
    const instKey = (ev) => instOpen.value && menuKeys(ev, instMenu.value, closeInst);
    const printerKey = (ev) => printerOpen.value && menuKeys(ev, printerMenu.value, closePrinter);
    const fileKey = (ev) => fileOpen.value && menuKeys(ev, fileMenu.value, closeFile);
    document.addEventListener("pointerdown", (ev) => {
      const at = (sel) => ev.target instanceof Element && ev.target.closest(sel);
      if (instOpen.value && !at(".inst-pick")) instOpen.value = false;
      if (printerOpen.value && !at(".printer-pick")) printerOpen.value = false;
      if (fileOpen.value && !at(".file-pick")) fileOpen.value = false;
      if (cancelAsk.value && !at(".cancel-pick")) cancelAsk.value = false;
      if (stopArmed.value && !at(".estop")) disarmStop();
    });

    return {
      INSTANCES, FAILED, PAGES, CHANGE, T, route, ui, loadState, inst, page, pageKey, pageProps, navHash, badges, go, hashOf, leave,
      statusText, generatedText, instOpen, instBtn, instMenu, toggleInst, pickInst, instKey, reread, load, loadError,
      printers, activeModel, modelName, printerOpen, printerBtn, printerMenu, togglePrinter, pickPrinter, printerKey, menuPages,
      newPath, addError, addDir, removeFailed, changes, changeGroups, changesOpen, openChanges, closeChanges, discard,
      planned, done, plan, makePlan, backToList, runPlan, LANG, LANGUAGES, setLanguage, otherLanguage, dark, toggleTheme,
      narrow, navOpen, navCollapsed, navBtn, navShown, toggleNav, splash, splashSteps, splashPct, stepText,
      fileHost, printFiles, fileOpen, fileBtn, fileMenu, toggleFile, pickFile, pickLocal, fileKey, fileIsSet, fileName, fileFacts, pathOf,
      thumbOf, fileThumb, jobBusy, startBlock, printPanel, openPrint, cancelAsk, cancelPrint, stopArmed, emergencyStop, lookSoon, api,
    };
  },

  template: `
    <header class="topbar">
      <button ref="navBtn" class="bar-btn nav-toggle" type="button" aria-controls="main-nav" :aria-expanded="navShown ? 'true' : 'false'"
              :aria-label="T.nav.toggle" :title="T.nav.toggle" @click="toggleNav"><ui-icon name="menu" :size="22"/></button>
      <a class="brand" :href="hashOf('uebersicht', ui.instId)" @click="go($event, hashOf('uebersicht', ui.instId))"><spool-icon colour="#009688" :size="26"/><span class="brand-name">{{ T.appName }}</span></a>
      <span class="spacer"></span>
      <div v-if="INSTANCES.length > 1" class="inst inst-pick" @keydown="instKey">
        <button ref="instBtn" class="inst-btn" type="button" aria-haspopup="menu" :aria-expanded="instOpen ? 'true' : 'false'"
                :title="inst.slicer + ' ' + inst.version + ' · ' + statusText(inst)" @click="toggleInst">
          <!-- On a phone the short name, so the printer next to it keeps its name -->
          <span class="inst-name"><span class="name-long">{{ inst.slicer }}</span><span class="name-short">{{ inst.snorca ? 'SnOrca' : 'Orca' }}</span></span>
          <run-status :inst="inst" short/>
          <ui-icon name="chevronDown"/>
        </button>
        <div v-if="instOpen" ref="instMenu" class="inst-menu" role="menu" :aria-label="T.instMenu">
          <div class="inst-menu-label" aria-hidden="true">{{ T.instMenu }}</div>
          <!-- The data folder as a tooltip only (the user's wish) -->
          <button v-for="i in INSTANCES" :key="i.id" class="inst-item" type="button" role="menuitemradio" :title="i.path"
                  :aria-checked="i.id === inst.id ? 'true' : 'false'" @click="pickInst(i)">
            <ui-icon name="check" class="check"/>
            <span class="inst-item-text">
              <span>{{ i.slicer }} <span class="version">{{ i.version }}</span></span>
              <run-status :inst="i"/>
            </span>
          </button>
        </div>
      </div>
      <span v-else-if="inst" class="inst-single">{{ inst.slicer }}</span>
      <div v-if="printers.length" class="inst printer-pick" @keydown="printerKey">
        <button ref="printerBtn" class="inst-btn" type="button" aria-haspopup="menu" :aria-expanded="printerOpen ? 'true' : 'false'"
                :title="T.printerMenu" @click="togglePrinter">
          <img v-if="activeModel" class="printer-pick-img" :src="activeModel.cover" alt="" width="24" height="24">
          <span class="inst-name">{{ activeModel ? modelName(activeModel) : T.printerMenu }}</span>
          <ui-icon name="chevronDown"/>
        </button>
        <div v-if="printerOpen" ref="printerMenu" class="inst-menu" role="menu" :aria-label="T.printerMenu">
          <div class="inst-menu-label" aria-hidden="true">{{ T.printerMenu }}</div>
          <button v-for="m in printers" :key="m.model" class="inst-item" type="button" role="menuitemradio"
                  :aria-checked="m.model === ui.printer ? 'true' : 'false'" @click="pickPrinter(m)">
            <ui-icon name="check" class="check"/>
            <img class="printer-pick-img" :src="m.cover" alt="" width="28" height="28">
            <span class="inst-item-text">
              <span>{{ modelName(m) }}</span>
              <span v-if="modelName(m) !== m.model" class="inst-item-path">{{ m.model }}</span>
            </span>
          </button>
        </div>
      </div>
      <!-- The print file for "2D-Ansicht" and "3D-Ansicht", next to the printer (the user's wish) -->
      <div v-if="printers.length" class="inst file-pick" @keydown="fileKey">
        <button ref="fileBtn" class="inst-btn" type="button" aria-haspopup="menu" :aria-expanded="fileOpen ? 'true' : 'false'"
                :title="ui.printFile ? T.fileMenu.title(fileName) : T.fileMenu.label" @click="toggleFile">
          <img v-if="fileThumb" class="file-thumb" :src="fileThumb" alt="" width="24" height="24">
          <ui-icon v-else :name="ui.printFile?.local ? 'folderOpen' : 'file'"/>
          <span class="inst-name file-name">{{ fileName || T.fileMenu.none }}</span>
          <ui-icon name="chevronDown"/>
        </button>
        <div v-if="fileOpen" ref="fileMenu" class="inst-menu file-menu" role="menu" :aria-label="T.fileMenu.label">
          <div class="inst-menu-label" aria-hidden="true">{{ T.fileMenu.label }}</div>
          <p v-if="!fileHost" class="file-menu-note">{{ T.fileMenu.noHost }}</p>
          <p v-else-if="printFiles === null" class="file-menu-note">{{ T.fileMenu.reading }}</p>
          <p v-else-if="!printFiles.length" class="file-menu-note">{{ T.fileMenu.empty }}</p>
          <button v-for="f in printFiles || []" :key="pathOf(f)" class="inst-item" type="button" role="menuitemradio"
                  :aria-checked="fileIsSet(f) ? 'true' : 'false'" @click="pickFile(f)">
            <ui-icon name="check" class="check"/>
            <img v-if="f.thumb" class="file-thumb" :src="thumbOf(f)" alt="" width="40" height="40" loading="lazy">
            <span v-else class="file-thumb is-empty"><ui-icon name="file"/></span>
            <span class="inst-item-text"><span>{{ f.name }}</span><span class="file-facts">{{ fileFacts(f) }}</span></span>
          </button>
          <button class="inst-item file-local" type="button" role="menuitem" @click="$refs.localInput.click()">
            <ui-icon name="folderOpen"/><span class="inst-item-text">{{ ui.printFile?.local ? T.fileMenu.localNow(ui.printFile.local) : T.fileMenu.local }}</span>
          </button>
          <input ref="localInput" class="file-local-input" type="file" accept=".gcode,.gco,.g" tabindex="-1" aria-hidden="true" @change="pickLocal">
        </div>
      </div>
      <!-- Print that file, cancel, emergency stop (the user's wish); the tooltip says why one is off -->
      <div v-if="printers.length && fileHost" class="print-ctl" role="group" :aria-label="T.printBar.label">
        <button class="bar-btn" type="button" :disabled="!!startBlock" :title="startBlock || T.printBar.start(fileName)"
                :aria-label="T.printBar.start(fileName)" @click="openPrint"><ui-icon name="play"/></button>
        <div class="inst cancel-pick" @keydown.esc.stop="cancelAsk = false; $refs.cancelBtn.focus()">
          <button ref="cancelBtn" class="bar-btn" type="button" :disabled="!jobBusy" :title="jobBusy ? T.printBar.cancel : T.printBar.cancelIdle"
                  :aria-label="T.printBar.cancel" aria-haspopup="dialog" :aria-expanded="cancelAsk ? 'true' : 'false'"
                  @click="cancelAsk = !cancelAsk; cancelAsk && $nextTick(() => $refs.cancelNo.focus())"><ui-icon name="stop"/></button>
          <div v-if="cancelAsk" class="inst-menu bar-ask" role="alertdialog" aria-labelledby="cancel-ask">
            <p id="cancel-ask" class="bar-ask-q">{{ T.printBar.cancelAsk }}</p>
            <div class="bar-ask-actions">
              <button class="btn btn-danger-solid" type="button" @click="cancelPrint">{{ T.printBar.cancelYes }}</button>
              <button ref="cancelNo" class="btn" type="button" @click="cancelAsk = false">{{ T.printBar.cancelNo }}</button>
            </div>
          </div>
        </div>
        <button :class="['bar-btn', 'estop', { 'is-armed': stopArmed }]" type="button" :title="stopArmed ? T.printBar.stopArmedHint : T.printBar.stop"
                :aria-label="stopArmed ? T.printBar.stopArmedHint : T.printBar.stop" @click="emergencyStop">
          <ui-icon name="estop"/><span v-if="stopArmed">{{ T.printBar.stopArmed }}</span></button>
      </div>
      <!-- The icon alone (the user); what it does and the time of the data in the tooltip -->
      <button v-if="loadState.status === 'ready'" class="bar-btn" type="button" :aria-label="T.reload" :disabled="loadState.busy"
              :title="T.reload + ' · ' + T.dataFrom(generatedText)" @click="leave(reread)">
        <ui-icon name="refresh"/>
      </button>
    </header>

    <div :class="['shell', { 'nav-collapsed': !narrow && navCollapsed, 'nav-open': narrow && navOpen }]">
      <nav id="main-nav" class="nav" :aria-label="T.nav.label">
        <a v-for="p in menuPages" :key="p.id" :class="['nav-item', { 'is-sub': p.sub }]" :href="navHash(p)"
           :aria-current="route.page === p.id ? 'page' : null" @click="navOpen = false; go($event, navHash(p))">
          <ui-icon :name="p.icon"/><span class="nav-text">{{ p.label }}</span>
          <span v-if="badges[p.id]" :class="['nav-count', { 'is-changed': badges[p.id].changed }]"
                :title="badges[p.id].n + ' ' + badges[p.id].text">{{ badges[p.id].n }}<span class="sr-only"> {{ badges[p.id].text }}</span></span>
        </a>
        <!-- Two switches: the language (the page loads anew) and light or dark -->
        <div class="nav-switches">
          <button :class="['nav-switch', { 'is-second': LANG === 'en' }]" type="button" :title="T.nav.language"
                  :aria-label="T.nav.languageTo(otherLanguage.name)" @click="setLanguage(otherLanguage.code)">
            <span :class="['nav-switch-side', { 'is-on': LANG === 'de' }]" lang="de">DE</span>
            <span :class="['nav-switch-side', { 'is-on': LANG === 'en' }]" lang="en">EN</span>
          </button>
          <button :class="['nav-switch', { 'is-second': dark }]" type="button" role="switch" :aria-checked="dark ? 'true' : 'false'"
                  :title="dark ? T.nav.toLight : T.nav.toDark" :aria-label="T.nav.dark" @click="toggleTheme">
            <span :class="['nav-switch-side', { 'is-on': !dark }]"><ui-icon name="sun" :size="16"/></span>
            <span :class="['nav-switch-side', { 'is-on': dark }]"><ui-icon name="moon" :size="16"/></span>
          </button>
        </div>
        <a class="nav-by" :href="hashOf('lizenz', ui.instId)" :title="T.nav.byHint" :aria-current="route.page === 'lizenz' ? 'page' : null"
           @click="navOpen = false; go($event, hashOf('lizenz', ui.instId))">{{ T.by }}</a>
      </nav>
      <div v-if="narrow && navOpen" class="nav-backdrop" @click="navOpen = false"></div>
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

        <!-- "Drucken" in the top bar: the panel of "Dateien" -->
        <print-panel v-if="printPanel" :key="printPanel.file.name" :camera="printPanel.camera" :model="ui.printer" :file="printPanel.file"
                     :picture="printPanel.file.picture ? api.printFileUrl(ui.printer, printPanel.file.picture) : ''"
                     @close="printPanel = null" @started="lookSoon"/>

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

    <!-- Boot screen; the page below says "Lese Installationen …" for screen readers -->
    <div v-if="splash.shown" :class="['splash', { 'is-leaving': splash.leaving }]">
      <div class="splash-main">
        <img class="splash-logo" src="assets/app-icon.svg" alt="" width="112" height="112">
        <p class="splash-name">{{ T.appName }}</p>
        <p class="splash-by">{{ T.by }}</p>
        <span :class="['splash-bar', { 'is-known': splash.total }]" aria-hidden="true"><span class="splash-fill" :style="{ width: splashPct + '%' }"></span></span>
        <ul class="splash-steps" aria-hidden="true">
          <li v-for="s in splashSteps" :key="s.key" :class="{ 'is-running': !s.done, 'is-failed': s.failed }">
            <ui-icon v-if="s.failed" name="warn" :size="14"/>
            <ui-icon v-else-if="s.done" name="check" :size="14"/>
            <span v-else class="splash-spin"></span>
            <span class="splash-step-text">{{ stepText(s) }}</span>
          </li>
          <li v-if="!splash.steps.length" class="is-running"><span class="splash-spin"></span><span class="splash-step-text">{{ T.loading }}</span></li>
        </ul>
      </div>
      <p class="splash-license">{{ T.splash.license }}<span class="splash-dot" aria-hidden="true"> · </span><strong>{{ T.splash.noncommercial }}</strong></p>
    </div>
  `,
});

registerCommon(app);
app.mount("#app");
