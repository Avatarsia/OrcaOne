// Shared data, state, icons and small components for all pages.
// The data comes live from GET /api/data (orcaone/overview.py): load() fetches it at the start
// and again for "Neu einlesen". Pages are plain component objects; app.js picks one by the hash
// route and mounts it fresh for every route and every load.
import { T, plainName } from "./texts.js";
import { api } from "./api.js";

const { reactive, ref, shallowReactive, computed } = Vue;

const LOCALE = "de-DE";

// ------------------------------------------------------------ data
// shallowReactive: a load replaces the list, the megabyte of nested data inside stays plain.
export const INSTANCES = shallowReactive([]);
// Installations OrcaOne found but could not read (failed[] of GET /api/data); the others still show.
export const FAILED = shallowReactive([]);
// editable_fields with label and unit from texts.js, for the filament form.
export const FIELDS = shallowReactive([]);
// status: "loading" until the first answer, then "ready" or "error". version counts the loads,
// it is part of the page key in app.js.
export const loadState = reactive({ status: "loading", error: null, busy: false, generated: null, version: 0 });

// ------------------------------------------------------------ routing
// #/<page>/<installation>, for one printer #/filamente/<installation>/<model index> (the same
// for "prozesse"). The installation is part of the address, so a reload stays with it.
export const PAGE_IDS = ["filamente", "prozesse", "drucker", "transfer", "sicherungen", "slicer", "details"];
// Pages that show one printer at a time: the menu keeps the printer when switching between them.
export const PRINTER_PAGES = ["filamente", "prozesse"];

export function parseHash(hash) {
  const [page, instId, idx] = hash.replace(/^#\/?/, "").split("/");
  if (!PAGE_IDS.includes(page)) return { page: "filamente", instId: null, modelIdx: null };
  const inst = INSTANCES.find((i) => i.id === instId) || null;
  const ok = PRINTER_PAGES.includes(page) && !!inst && /^\d+$/.test(idx || "") && !!inst.models[+idx];
  return { page, instId: inst ? inst.id : null, modelIdx: ok ? +idx : null };
}
export const hashOf = (page, instId, modelIdx = null) =>
  "#/" + page + (instId ? "/" + instId : "") + (modelIdx === null ? "" : "/" + modelIdx);

export const route = ref(parseHash(location.hash));

export function syncRoute(hash = location.hash) {
  const next = parseHash(hash), cur = route.value;
  if (next.page !== cur.page || next.instId !== cur.instId || next.modelIdx !== cur.modelIdx) route.value = next;
}

// A page with input that is not saved yet (the filament form) sets a guard. The guard gets the
// step that leaves the page and runs it, after asking if needed. Back and forward in the
// browser do not pass here.
let leaveGuard = null;
export const setLeaveGuard = (fn) => { leaveGuard = fn; };
export const clearLeaveGuard = (fn) => { if (leaveGuard === fn) leaveGuard = null; };
export const leave = (step) => (leaveGuard ? leaveGuard(step) : step());

// Internal links set the route right away, so the view never depends on the "hashchange"
// event alone. Back, forward and typed URLs still arrive through the listener in app.js.
export function go(ev, hash) {
  if (ev && (ev.button > 0 || ev.ctrlKey || ev.metaKey || ev.shiftKey || ev.altKey)) return;  // new tab or window
  if (ev) ev.preventDefault();
  leave(() => {
    if (location.hash !== hash) location.hash = hash;
    syncRoute(hash);
  });
}

// ------------------------------------------------------------ shared state
// The chosen installation follows the address (app.js).
// detailsFor: a filament the page "Details" opens with (from the page "Filamente"), and
// filamentFocus the other way round: the page "Filamente" shows that filament's row and panel.
export const ui = reactive({ instId: null, toast: "", detailsFor: null, filamentFocus: null });

// One word per state on every page.
export function statusText(inst) {
  if (!inst.running) return T.status.closed;
  return inst.running_reason?.code === "process_unmapped" ? T.status.maybeRunning : T.status.running;
}

// Why OrcaOne may not write to this installation now: a code of T.blocked, or null. The backend
// checks the same, in the same order, when it plans and applies (environment_block in
// orcaone/operations.py); checked here as well, so "Übernehmen" is off right away. Not with a
// .conf OrcaOne cannot read, and never while the slicer runs (hard rule 3). A restore writes the
// whole .conf back, so a broken one does not stop it: it is the way to repair it.
export function writeBlock(inst, restore = false) {
  if (inst.problems.includes("conf_unreadable") && !restore) return "conf_unreadable";
  if (inst.running) return inst.running_reason?.code === "process_unmapped" ? "slicer_maybe_running" : "slicer_running";
  return null;
}

// Entries of the "filaments" list that fit no printer set up (the 8 × @J1, @Dual … the wizard
// took along, FINDINGS 4.6), also those without a profile of that name: the backend removes a
// listed name either way. The page "Slicer" offers to hide them.
export const unusedListNames = (inst) => inst.without_printer.map((w) => w.name);

// What the pages "Drucker" and "Slicer" change, per installation: own profiles (files in
// user/), the printer models switched on and the vendor packages in system/, the default
// printer, the stale "orca_presets" entries and the unused "filaments" entries (in the .conf).
// Memory only: the change list collects it, ops.js turns it into the ops of POST /plan.
function initialLive(inst) {
  const pp = inst.printers_page;
  const own = new Set(inst.filaments.filter((f) => f.origin_kind === "user").map((f) => f.name));
  for (const p of pp.own) own.add(p.name);
  for (const x of [...pp.system, ...pp.own].flatMap((c) => c.only_here)) own.add(x.name);
  return {
    own,
    models: new Set(pp.system.map((m) => m.model)),
    packages: new Set(pp.system.map((m) => m.origin)),
    defaultPrinter: pp.default_printer.name,
    dead: pp.dead_entries.map((d) => d.machine),
    hideUnused: false,
  };
}
const copyLive = (s) => ({
  own: new Set(s.own), models: new Set(s.models), packages: new Set(s.packages),
  defaultPrinter: s.defaultPrinter, dead: [...s.dead], hideUnused: s.hideUnused,
});
export const live = reactive({});

// A printer card shows while the slicer shows the printer: a model switched on in "models", an
// own printer while its file and its vendor package are there. "Entfernen" on the page
// "Drucker" takes it away before it is written.
export function modelShown(inst, m) {
  const s = live[inst.id];
  return m.own ? s.own.has(m.model) && (!m.origin || s.packages.has(m.origin)) : s.models.has(m.model);
}

// Heading of a profile in the lists of the pages "Details" and "Übertragen", as in the tree on
// "Filamente": own ones, bundles, then per maker and, for filaments, brand. key sorts the headings.
export function originGroup(f) {
  const F = T.filaments;
  if (f.origin_kind === "user") return { key: "0", label: F.kinds.user };
  if (f.origin_kind === "bundle") return { key: "1" + f.bundle, label: F.bundlePrinter(f.bundle) };
  const kind = f.origin_kind === "vendor" ? F.kinds.vendorFrom(f.package) : F.kinds.library;
  const prefix = (f.origin_kind === "vendor" ? "2" + f.package : "3") + "|";
  if (f.material === undefined) return { key: prefix, label: kind };  // a process: no brand
  const brand = f.vendor || F.noBrand;
  return { key: prefix + brand.toLowerCase(), label: `${kind} · ${brand}` };
}

// The nozzle chosen per printer model, the same on the pages "Filamente" and "Prozesse": a
// printer name, or "all" (only the page "Filamente" offers that).
export const chosenNozzle = reactive({});
export const nozzleKey = (inst, model) => inst.id + "|" + model.model;

// Pages with state of their own (the filament switches) rebuild it here after every load and
// after "Verwerfen".
const resetHooks = [];
export const onReset = (fn) => resetHooks.push(fn);
export function resetChanges() {
  for (const id of Object.keys(live)) delete live[id];
  for (const i of INSTANCES) live[i.id] = copyLive(i.initial);
  for (const fn of resetHooks) fn();
}

// Own profiles by name, for the change list, "Mitlöschen" and the printer cards.
const orphaned = (x) => x.status === "orphaned" || x.status === "ignored";
function profileMap(inst) {
  const pp = inst.printers_page, map = new Map();
  for (const f of inst.filaments) {
    if (f.origin_kind === "user") map.set(f.name, { name: f.name, kind: "filament", helper: !!f.helper, orphaned: orphaned(f) });
  }
  for (const x of [...pp.system, ...pp.own].flatMap((c) => c.only_here)) {
    if (!map.has(x.name)) map.set(x.name, { name: x.name, kind: x.kind, helper: !!x.helper, orphaned: !!x.orphaned });
  }
  for (const p of pp.own) map.set(p.name, { name: p.name, kind: "machine", helper: false, orphaned: orphaned(p) });
  return map;
}
export const profileInfo = (inst, name) => inst.profiles.get(name) || { name, kind: "filament", helper: false, orphaned: false };
export const KIND_ICON = { machine: "printer", filament: "spool", process: "layers" };
// One short line under a profile name, in the words of the page "Filamente".
export function profileSub(p) {
  if (p.orphaned) return T.profileSub.orphaned;
  if (p.helper) return T.profileSub.helper;
  return T.kindText[p.kind];
}

// "Snapmaker U1 · 0,4 mm" for a printer of a manufacturer, the plain name for an own one.
export function printerText(inst, name) {
  for (const m of inst.printers_page.system) {
    const p = m.printers.find((x) => x.name === name);
    if (p) return T.printerWithNozzle(printerShortName(p.name), nozzleLabel(p.variant));
  }
  return plainName(name);
}

// Pending changes of the pages "Drucker" and "Slicer": where `live` differs from the data.
// The page "Filamente" adds its own (pages/filamente.js); app.js shows both in one list.
// Backups are no pending change: the page "Sicherungen" makes, restores and deletes them directly.
export const liveChanges = computed(() => {
  const out = [];
  for (const i of INSTANCES) {
    const now = live[i.id], was = i.initial;
    if (!now) continue;
    const add = (page, type, name, where = "") => out.push({ inst: i, page, type, name, where });
    for (const m of i.printers_page.system) {
      if (!was.models.has(m.model) || now.models.has(m.model)) continue;
      const dropped = was.packages.has(m.origin) && !now.packages.has(m.origin);
      add("drucker", "remove", printerShortName(m.printers[0]?.name || m.model), dropped ? T.changes.packageGoes(m.origin) : "");
    }
    for (const n of was.own) {
      if (!now.own.has(n)) add("drucker", "delete", n, T.kindText[profileInfo(i, n).kind]);
    }
    if (now.defaultPrinter !== was.defaultPrinter) add("drucker", "default", printerText(i, now.defaultPrinter));
    const cleaned = was.dead.filter((d) => !now.dead.includes(d));
    if (cleaned.length) add("drucker", "clean", plural(cleaned.length, ...T.words.staleEntry), cleaned.join(", "));
    if (now.hideUnused) add("slicer", "hide", plural(unusedListNames(i).length, ...T.words.filament), T.changes.withoutPrinter);
  }
  return out;
});

// ------------------------------------------------------------ backups
// Backups per installation from GET /api/instances/{id}/backups: the page "Sicherungen" and the
// main menu show them. Read after every load and after every backup action. `error` holds the
// code when the list could not be read; the last list read stays then.
export const BACKUPS = reactive({});
export async function refreshBackups(instId) {
  try {
    const data = await api.backups(instId);
    BACKUPS[instId] = {
      backups: data.backups || [], total_size: data.total_size || 0, location: data.location || "", error: null,
    };
  } catch (err) {
    BACKUPS[instId] = { backups: [], total_size: 0, location: "", ...BACKUPS[instId], error: err.code || "unknown" };
  }
}

let toastTimer = 0;
export function flash(text) {
  ui.toast = text;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { ui.toast = ""; }, 2800);
}

// ------------------------------------------------------------ loading
function enrich(raw) {
  const inst = { ...raw, snorca: raw.kind === "snorca", byName: new Map(raw.filaments.map((f) => [f.name, f])) };
  inst.profiles = profileMap(inst);
  inst.initial = initialLive(inst);
  return inst;
}

// The installation in the address, else the one chosen so far, else the first. An address
// without an installation gets it added, so a reload stays with it.
function pickInstance() {
  const wanted = parseHash(location.hash);
  const kept = INSTANCES.some((i) => i.id === ui.instId) ? ui.instId : null;
  ui.instId = wanted.instId || kept || INSTANCES[0]?.id || null;
  if (!wanted.instId && ui.instId) history.replaceState(null, "", hashOf(wanted.page, ui.instId));
  syncRoute();
}

function setData(data) {
  FIELDS.splice(0, FIELDS.length, ...data.editable_fields.map((f) => ({ ...f, ...(T.fields[f.key] || { label: f.key, unit: "" }) })));
  INSTANCES.splice(0, INSTANCES.length, ...data.instances.map(enrich));
  FAILED.splice(0, FAILED.length, ...(data.failed || []));
  loadState.generated = data.generated;
  resetChanges();
  pickInstance();
  loadState.version++;
}

// Reads everything again. Pending changes are gone afterwards: they refer to the old state.
// Returns whether it worked; loadState.error holds the code otherwise.
export async function load() {
  loadState.busy = true;
  try {
    setData(await api.data());
    loadState.error = null;
    loadState.status = "ready";
    // Not awaited: the pages show while the lists come in.
    for (const i of INSTANCES) refreshBackups(i.id);
    return true;
  } catch (err) {
    if (!err.code) console.error(err);
    loadState.error = err.code || "unknown";
    if (loadState.status !== "ready") loadState.status = "error";
    return false;
  } finally {
    loadState.busy = false;
  }
}

// Data directories added by hand (orcaone/instances.py). Both read everything again and
// return an error code for T.errors, or null.
export async function addDataDir(path) {
  let result;
  try {
    result = await api.addManual(path);
  } catch (err) {
    return err.code || "unknown";
  }
  if (!(await load())) return loadState.error;
  go(null, hashOf(route.value.page, result.instance.id));
  return null;
}
export async function removeDataDir(inst) {
  let code = null;
  try {
    await api.removeManual(inst.data_dir);
  } catch (err) {
    code = err.code || "unknown";
  }
  // Also after "not_listed": the list on the page is out of date then.
  if (!(await load())) return loadState.error;
  return code;
}

// ------------------------------------------------------------ formatting
export const nozzleLabel = (v) => v.split("+").map((d) => d.replace(".", ",")).join(" + ");
export const printerShortName = (name) => plainName(name).replace(/\s*\(?[\d.+]+ nozzle\)?$/, "");
export const plural = (n, one, many) => n.toLocaleString(LOCALE) + " " + (n === 1 ? one : many);

// Decimal units (kB, MB), as the file managers on Linux show them.
export function fmtSize(bytes) {
  if (bytes < 1000) return bytes + " B";
  const units = ["kB", "MB", "GB"];
  let v = bytes / 1000, u = 0;
  while (v >= 999.5 && u < units.length - 1) { v /= 1000; u++; }
  return v.toLocaleString(LOCALE, { maximumFractionDigits: v < 100 ? 1 : 0 }) + " " + units[u];
}

export const timeText = (d) => d.toLocaleString(LOCALE, {
  day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
});
export const clockText = (d) => d.toLocaleTimeString(LOCALE, { hour: "2-digit", minute: "2-digit" });
export const generatedText = computed(() => loadState.generated ? timeText(new Date(loadState.generated)) : "");

// "Heute", "Gestern", else weekday and date.
export function dayLabel(d) {
  const day = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate());
  const diff = Math.round((day(new Date()) - day(d)) / 86400000);
  if (diff === 0) return T.today;
  if (diff === 1) return T.yesterday;
  return d.toLocaleDateString(LOCALE, { weekday: "long", day: "2-digit", month: "2-digit", year: "numeric" });
}
// "heute, 07:29 Uhr", "gestern, 16:40 Uhr", "Montag, 21.09.2026, 16:40 Uhr"; reads after "Stand von".
export function whenText(d) {
  const l = dayLabel(d);
  return T.when(l === T.today || l === T.yesterday ? l.toLowerCase() : l, clockText(d));
}

// ------------------------------------------------------------ icons
// 24x24, stroke = currentColor, so hover, the active menu entry and dark mode colour them.
export const ICONS = {
  back: '<path d="M14.5 5.5 8 12l6.5 6.5"/>',
  chevron: '<path d="m9.5 6 6 6-6 6"/>',
  chevronDown: '<path d="m6 9.5 6 6 6-6"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/>',
  close: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  trash: '<path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13M10 11v5.5M14 11v5.5"/>',
  lock: '<rect x="5.5" y="10.5" width="13" height="9.5" rx="1.5"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/>',
  user: '<circle cx="12" cy="8.5" r="3.5"/><path d="M5 20c.8-3.8 3.6-6 7-6s6.2 2.2 7 6"/>',
  factory: '<path d="M3.5 20.5h17M5 20.5V12l4.5 3v-3l4.5 3v-3l4.5 3v5.5M15.5 12.5V4.5h3v8.2"/>',
  package: '<path d="m12 3.5 8 4v9l-8 4-8-4v-9z"/><path d="m4 7.5 8 4 8-4M12 11.5v9M8 5.5l8 4"/>',
  transfer: '<path d="M4 8.5h14.5M15 5l3.5 3.5L15 12M20 15.5H5.5M9 12l-3.5 3.5L9 19"/>',
  arrowRight: '<path d="M4 12h15.5M13.5 6l6 6-6 6"/>',
  arrowLeft: '<path d="M20 12H4.5M10.5 6l-6 6 6 6"/>',
  bolt: '<path d="M13.5 3 5.5 13.5h6L10.5 21l8-10.5h-6z"/>',
  checkCircle: '<circle cx="12" cy="12" r="8.5"/><path d="m8.3 12.2 2.5 2.5 4.9-5.1"/>',
  books: '<rect x="3.5" y="4.5" width="4" height="15.5" rx="1"/><rect x="9" y="4.5" width="4" height="15.5" rx="1"/><path d="m14.7 6.2 3.8-1 3 14.4-3.8 1z"/>',
  temp: '<path d="M10 14.5V5a2 2 0 0 1 4 0v9.5a4 4 0 1 1-4 0z"/><path d="M12 9v7"/>',
  bed: '<rect x="3" y="15" width="18" height="3.5" rx="1"/><path d="M8 12c1-1.2-.6-2.3.4-4M12 12c1-1.2-.6-2.3.4-4M16 12c1-1.2-.6-2.3.4-4"/>',
  box: '<rect x="5.5" y="5.5" width="13" height="13" rx="2.5"/>',
  price: '<path d="M3.5 12.5v-8h8l9 9-8 8z"/><circle cx="7.8" cy="8.8" r="1.3"/>',
  backup: '<path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3"/><path d="M4.5 4.5v4h4"/><path d="M12 8.5V12l2.5 2"/>',
  grip: '<circle cx="9" cy="7" r=".8"/><circle cx="15" cy="7" r=".8"/><circle cx="9" cy="12" r=".8"/><circle cx="15" cy="12" r=".8"/><circle cx="9" cy="17" r=".8"/><circle cx="15" cy="17" r=".8"/>',
  spool: '<ellipse cx="16.5" cy="12" rx="3" ry="7.5"/><path d="M16.5 4.5H8c-1.9 0-3.5 3.4-3.5 7.5s1.6 7.5 3.5 7.5h8.5"/><ellipse cx="16.5" cy="12" rx="1" ry="2.5"/>',
  printer: '<rect x="3.5" y="3.5" width="17" height="17" rx="2"/><path d="M3.5 8h17M10 8v3.5h4V8M12 11.5V13M7 17h10"/>',
  folder: '<path d="M3.5 7a2 2 0 0 1 2-2h4l2 2.5h7a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/>',
  folderOpen: '<path d="M3.5 17V7a2 2 0 0 1 2-2h4l2 2.5h6a2 2 0 0 1 2 2v1"/><path d="M3.5 17l2.3-6a1.5 1.5 0 0 1 1.4-1h12.6a1 1 0 0 1 .9 1.4L18.4 17.8a1.8 1.8 0 0 1-1.7 1.2H5.2a1.7 1.7 0 0 1-1.7-2z"/>',
  file: '<path d="M6.5 3.5h7l4 4v13h-11z"/><path d="M13.5 3.5v4h4"/>',
  layers: '<path d="M12 4 3.5 8.5 12 13l8.5-4.5z"/><path d="m3.5 12.5 8.5 4.5 8.5-4.5"/><path d="m3.5 16.5 8.5 4.5 8.5-4.5"/>',
  pencil: '<path d="M4.5 19.5l1-4.5L15.5 5l3.5 3.5-10 10z"/><path d="m13 7.5 3.5 3.5"/>',
  undo: '<path d="M9 13.5 4.5 9 9 4.5"/><path d="M4.5 9H14a5.5 5.5 0 0 1 0 11h-3"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/>',
  key: '<circle cx="8" cy="15.5" r="4"/><path d="m11 12.5 8.5-8.5M16 7.5l2.5 2.5M13.5 10l2 2"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 3.5V6M12 18v2.5M3.5 12H6M18 12h2.5M6 6l1.8 1.8M16.2 16.2 18 18M6 18l1.8-1.8M16.2 7.8 18 6"/>',
  refresh: '<path d="M19.5 12a7.5 7.5 0 0 1-13 5.1"/><path d="M4.5 12a7.5 7.5 0 0 1 13-5.1"/><path d="M17.5 3.5v3.4h-3.4M6.5 20.5v-3.4h3.4"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5M12 7.8v.2"/>',
  warn: '<path d="M12 4 2.8 19.5h18.4z"/><path d="M12 10v4.5M12 17.2v.2"/>',
  star: '<path d="m12 3.8 2.5 5.2 5.7.8-4.1 4 1 5.7L12 16.8l-5.1 2.7 1-5.7-4.1-4 5.7-.8z"/>',
  broom: '<path d="M14.5 3.5 11 11"/><path d="M7.5 11.5h7l2 9h-11z"/><path d="M9 16v4.5M12 16v4.5"/>',
};

// ------------------------------------------------------------ components
export function registerCommon(app) {
  // Spool shape from assets/spool-color.svg (Orca's filament_green.svg); the band takes the filament colour.
  app.component("spool-icon", {
    props: { colour: { type: String, default: "#009688" }, size: { type: Number, default: 24 } },
    template: `
      <svg class="spool" viewBox="0 0 30 40" :width="Math.round(size * 0.75)" :height="size" fill="none" aria-hidden="true">
        <path d="M23.26 37.51C25.52 37.51 27.36 29.58 27.36 19.79C27.36 10 25.52 2.06 23.26 2.06C22.38 2.06 21.38 3.56 20.71 5.6H22.3C22.78 6.94 23.74 11.47 23.74 20.51C23.74 29.55 22.47 33.01 22.3 34H20.83C21.53 36.41 22.3 37.51 23.26 37.51Z" fill="#F2F2F2"/>
        <path d="M20.71 5.6C21.38 3.56 22.38 2.06 23.26 2.06C25.52 2.06 27.36 10 27.36 19.79C27.36 29.58 25.52 37.51 23.26 37.51C22.3 37.51 21.41 36.08 20.71 33.67" stroke="#5C5C5C" stroke-width="2"/>
        <path d="M22.33 5.6H8.93L9.23 6.79L10.14 12.4L10.44 24.51L9.84 30.42L8.93 33.97H22.33C23.14 30.72 23.73 25.71 23.73 20.08C23.73 14.1 23.23 8.81 22.33 5.6Z" :fill="colour"/>
        <path d="M8.63 5.6H22.31C23.22 8.81 23.73 14.1 23.73 20.08C23.73 25.71 23.13 30.72 22.31 33.97H8.63" stroke="#5C5C5C"/>
        <ellipse cx="6.51" cy="19.79" rx="3.93" ry="17.73" fill="#F2F2F2" stroke="#5C5C5C" stroke-width="2"/>
        <ellipse cx="6.21" cy="20.08" rx="0.6" ry="2.66" fill="#5C5C5C"/>
      </svg>`,
  });

  // Hot end with the extruded line below; the line width grows with the nozzle diameter.
  app.component("nozzle-icon", {
    props: { sizes: { type: Array, required: true }, height: { type: Number, default: 34 } },
    methods: { w(d) { return Math.max(1.6, d * 10); } },
    template: `
      <svg class="nozzle" :viewBox="'0 0 ' + (sizes.length * 26 + 2) + ' 40'" :width="Math.round((sizes.length * 26 + 2) * height / 40)" :height="height" aria-hidden="true">
        <g v-for="(d, n) in sizes" :key="n" :transform="'translate(' + (n * 26) + ' 0)'">
          <rect x="4" y="2" width="20" height="12" rx="2" class="nz-body"/>
          <path :d="'M8 14h12l-' + (5.5 - w(d) / 2) + ' 9h-' + (w(d) + 1) + 'z'" class="nz-tip"/>
          <rect :x="14 - w(d) / 2" y="24" :width="w(d)" height="14" :rx="Math.min(2, w(d) / 2)" class="nz-flow"/>
        </g>
      </svg>`,
  });

  app.component("ui-icon", {
    props: { name: { type: String, required: true }, size: { type: Number, default: 18 } },
    computed: { paths() { return ICONS[this.name] || ""; } },
    template: `<svg class="icon" viewBox="0 0 24 24" :width="size" :height="size" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" v-html="paths"></svg>`,
  });

  // State of an installation as text plus colour, the same words on every page.
  app.component("run-status", {
    props: { inst: { type: Object, required: true } },
    computed: { text() { return statusText(this.inst); } },
    template: `<span :class="['status', { 'status--busy': inst.running }]">{{ text }}</span>`,
  });
}
