// Page "Filamente": printer cards first, then one printer with its nozzle, the active filaments
// and one tree Eigene / Vom Hersteller / Orca-Bibliothek.
// app.js mounts it fresh for every route, so no state leaks from one printer to the next.
// Every way to a new or changed filament opens the form from filament-editor.js ("Bearbeiten",
// "Neues Filament", the drop target); its result is one more pending change.
// Cards and own filaments follow `live` (common.js), so what the page "Drucker" changes shows up
// here, too. Nothing is written here: the change list in app.js collects all of it, ops.js turns
// the state below (`store`) into the ops of POST /plan.
import {
  INSTANCES, FIELDS, live, flash, go, hashOf, plural, nozzleLabel, printerShortName,
  setLeaveGuard, clearLeaveGuard, onReset,
} from "../common.js";
import { T, plainName } from "../texts.js";
import FilamentEditor, { hexOf, changeText } from "./filament-editor.js";

const { ref, reactive, computed, watch, nextTick, onMounted, onUnmounted } = Vue;

const F = T.filaments;
// The spool always shows the material group: real filament colours exist for few profiles
// only, and a made-up colour would look real. Known colours are listed in the side panel.
// "Weitere" is not grey, because grey means "switched off".
const MATERIALS = [
  { id: "pla", colour: "#8CC7A6", test: (m) => /^PLA/i.test(m) },
  { id: "petg", colour: "#84ACDA", test: (m) => /^(PETG|PCTG|PET)/i.test(m) },
  { id: "abs", colour: "#E5A46C", test: (m) => /^(ABS|ASA)/i.test(m) },
  { id: "tpu", colour: "#B89AD8", test: (m) => /^(TPU|PEBA|TPE)/i.test(m) },
  { id: "other", colour: "#D2B98A", test: () => true },
].map((g) => ({ ...g, label: F.materials[g.id] }));
// Only values a layman can check on the spool label or the receipt.
const VALUES = [
  { key: "nozzle_temperature", icon: "temp" },
  { key: "hot_plate_temp", icon: "bed" },
  { key: "filament_cost", icon: "price" },
].map((v) => ({ ...v, ...F.values[v.key] }));
// Own profiles first: they are few and the ones people change.
// Bundles next: imported by the user, but OrcaSlicer's to change.
const KIND_ORDER = ["user", "bundle", "vendor", "library"];
const KIND_ICON = { user: "user", bundle: "package", vendor: "factory", library: "books" };
const ALL_PRINTERS = "*";  // a list profile of the Orca library counts for every printer

const materialGroup = (m) => MATERIALS.find((g) => g.test(m || ""));
const byName = (a, b) => a.name.localeCompare(b.name, "de", { sensitivity: "base" });
const fmt = (v) => String(v).replace(".", ",");
const key = (profile, printer) => profile + "|" + printer;
// "Snapmaker PLA SnapSpeed" -> "PLA SnapSpeed": the brand is shown on its own line or heading.
// Own filaments keep their full name, the user chose it.
function shortName(e) {
  const b = e.brand.toLowerCase() + " ";
  const rest = e.name.slice(b.length).trim();
  return e.kind !== "user" && e.kind !== "bundle" && e.brand && e.name.toLowerCase().startsWith(b) && rest ? rest : e.name;
}
// The tree groups manufacturer and library filaments by brand, bundle profiles by their bundle.
const groupOf = (e) => e.kind === "bundle" ? e.pack : e.brand;
// Rows nobody can switch or build on: not loaded by the slicer, or part of a bundle.
const fixed = (e) => e.orphan || e.kind === "bundle";
const subOf = (e) => e.kind === "user" ? F.ownShort : e.brand || e.material || "";
// The slicer does not load it: its template is missing or the file is broken. "unresolved": its
// template may sit in a package Orfix cannot read, so Orfix cannot show or change it either.
const notLoaded = (f) => f.status === "orphaned" || f.status === "ignored" || f.status === "unresolved";

// How a switch reaches the slicer (concept 4a-c): system filaments go through the global
// "filaments" list, except the library in SnOrca, which is switched per printer here; ops.js
// writes it to the list when it is on everywhere (way A) and as a hidden helper profile
// otherwise (way B, FINDINGS 4.7). Own profiles carry their printers themselves. Both kinds
// are kept in memory only.
const usesList = (inst, e) => e.kind === "vendor" || (e.kind === "library" && !inst.snorca);

function initialState(inst) {
  const listed = new Set(), bound = new Set();
  for (const f of inst.filaments) {
    if (f.helper) {
      // A helper profile only unlocks its library profile, so the library row counts as on.
      for (const [p, s] of Object.entries(f.printers)) if (s.status === "visible") bound.add(key(f.chain[0], p));
      continue;
    }
    if (usesList(inst, { kind: f.origin_kind })) {
      if (f.in_list) listed.add(f.name);
      continue;
    }
    for (const [p, s] of Object.entries(f.printers)) if (s.status === "visible") bound.add(key(f.name, p));
  }
  return { listed, bound };
}

// Module level, so switches and new filaments survive a trip to another page. Rebuilt from the
// data after every load and after "Verwerfen" (common.js).
// edits: entry id -> { name, own } for own filaments changed with "Bearbeiten"; own maps a
// field key to { value, high_flow? }, the values the profile sets itself.
// base is what the data says, i.e. what is on disk.
export const store = reactive({});
const entryCache = new Map();
onReset(() => {
  entryCache.clear();
  for (const id of Object.keys(store)) delete store[id];
  for (const inst of INSTANCES) {
    const { listed, bound } = initialState(inst);
    store[inst.id] = { listed, bound, created: [], deleted: new Set(), edits: {}, base: { listed: new Set(listed), bound: new Set(bound) } };
  }
});
const clone = (x) => JSON.parse(JSON.stringify(x));

// ------------------------------------------------------------ own values
// A value from the data as the editor needs it; null when nothing can be resolved.
const pick = (v) => v && v.value !== null && v.value !== undefined
  ? { value: v.value, ...(v.high_flow !== undefined && { high_flow: v.high_flow }), ...(v.default && { default: true }) }
  : null;
const recordOwnCache = new WeakMap();
function recordOwn(f) {
  if (!recordOwnCache.has(f)) {
    const own = {};
    for (const [k, v] of Object.entries(f.values)) if (v.own && pick(v)) own[k] = pick(v);
    recordOwnCache.set(f, own);
  }
  return recordOwnCache.get(f);
}
// What an own entry sets itself before any edit: from the data, or given when it was created.
function ownInitial(inst, e) {
  if (e.kind !== "user") return {};
  if (e.own) return e.own;
  return e.record ? recordOwn(inst.byName.get(e.record)) : {};
}
// Name and own values an own entry has at the start, by entry id.
export function initialOf(inst, id) {
  const c = store[inst.id].created.find((x) => x.entry.id === id);
  if (c) return { name: c.entry.name, own: c.entry.own || {} };
  const f = id.startsWith("user:") ? inst.byName.get(id.slice("user:".length)) : null;
  return f && f.origin_kind === "user" ? { name: f.name, own: recordOwn(f) } : null;
}
export const sameValue = (a, b) => (a?.value ?? null) === (b?.value ?? null) && (a?.high_flow ?? null) === (b?.high_flow ?? null);
const stateKey = (x) => x.name + "\n" + Object.keys(x.own).sort()
  .map((k) => k + "=" + x.own[k].value + "/" + (x.own[k].high_flow ?? "")).join(";");
// An edited own entry shows its new name, and its own colour on the spool: a colour the user
// picked is real, unlike a made-up one (see MATERIALS).
function withEdits(inst, e) {
  if (e.kind !== "user") return e;
  const ed = store[inst.id].edits[e.id];
  const own = ed ? ed.own : ownInitial(inst, e);
  const colour = hexOf(own.default_filament_colour?.value), vendor = own.filament_vendor?.value;
  if (!ed && !colour && !vendor) return e;
  const before = initialOf(inst, e.id);
  return {
    ...e, name: ed ? ed.name : e.name, colour, brand: vendor || e.brand,
    pending: !!ed && (!before || stateKey(ed) !== stateKey(before)),
  };
}

// One tree entry per short name (text before "@") and printer model; the profile per nozzle
// sits in slots. Profiles hidden by a vendor profile of the same name never show up.
let uid = 0;
function makeEntry(kind, name, f) {
  return {
    uid: ++uid, id: kind + ":" + name, kind, name: plainName(name), pack: f.bundle || "", brand: f.vendor || "", material: f.material || "",
    colours: f.colours || null, slots: {}, record: null, parent: null, orphan: false, template: null, fresh: false,
  };
}
function baseEntries(inst, model) {
  const cacheKey = inst.id + "|" + model.model;
  if (entryCache.has(cacheKey)) return entryCache.get(cacheKey);
  const printers = model.printers.map((p) => p.name);
  const map = new Map();
  for (const f of inst.filaments) {
    if (f.origin_kind === "user") continue;
    for (const p of printers) {
      const s = f.printers[p];
      if (!s || s.status === "displaced") continue;
      const id = f.origin_kind + ":" + f.alias;
      if (!map.has(id)) map.set(id, makeEntry(f.origin_kind, f.alias, f));
      const e = map.get(id);
      e.slots[p] ??= f.name;
      e.colours ||= f.colours || null;
    }
  }
  for (const f of inst.filaments) {
    // Helper profiles never show up as own filaments, the library row stands for them.
    if (f.origin_kind !== "user" || f.helper) continue;
    const e = makeEntry("user", f.name, f);
    e.record = f.name;
    const parent = f.chain.length ? inst.byName.get(f.chain[0]) : null;
    // name is what the page shows, profile the real name a new filament on top of it inherits.
    if (parent) e.parent = { id: parent.origin_kind + ":" + parent.alias, name: parent.alias, profile: parent.name };
    if (notLoaded(f)) {
      e.orphan = true;
      e.unresolved = f.status === "unresolved";
      const cps = f.compatible_printers;
      if (!cps.length || cps.some((p) => printers.includes(p))) map.set(e.id, e);
      continue;
    }
    // An own profile can be switched on wherever its template exists (concept 4d).
    for (const p of printers) {
      if (f.printers[p] || (parent ? parent.printers[p] : !f.compatible_printers.length)) e.slots[p] = f.name;
    }
    if (Object.keys(e.slots).length) map.set(e.id, e);
  }
  const list = [...map.values()];
  entryCache.set(cacheKey, list);
  return list;
}
// Own entries on disk follow `live`: "Mitlöschen" on the page "Drucker" takes them away here, too.
const stillThere = (inst, e) => e.kind !== "user" || !e.record || live[inst.id].own.has(e.record);
function entriesOf(inst, model) {
  const s = store[inst.id];
  return baseEntries(inst, model).filter((e) => !s.deleted.has(e.id))
    .concat(s.created.filter((c) => c.model === model.model && !s.deleted.has(c.entry.id)).map((c) => c.entry))
    .filter((e) => stillThere(inst, e))
    .map((e) => withEdits(inst, e));
}
// A printer card shows while the slicer shows the printer: a model switched on in "models", an
// own printer while its file and its vendor package are there.
function modelShown(inst, m) {
  const s = live[inst.id];
  return m.own ? s.own.has(m.model) && (!m.origin || s.packages.has(m.origin)) : s.models.has(m.model);
}
function isOn(inst, e, printer) {
  const profile = e.slots[printer];
  if (!profile) return null;
  const s = store[inst.id];
  return usesList(inst, e) ? s.listed.has(profile) : s.bound.has(key(profile, printer));
}
function stateOf(inst, e, printers) {
  let available = 0, on = 0;
  for (const p of printers) {
    const v = isOn(inst, e, p);
    if (v === null) continue;
    available++;
    if (v) on++;
  }
  if (!available) return "na";
  return on === 0 ? "off" : on === available ? "on" : "some";
}
const materialColour = (e) => materialGroup(e.material).colour;
const colourOf = (e) => e.colour || materialColour(e);

// ------------------------------------------------------------ changes
// "alle Düsen" instead of every single nozzle; the printer name only when there are several.
function whereText(i, names) {
  if (names.has(ALL_PRINTERS)) return T.changes.allPrinters;
  const parts = [];
  for (const m of i.models) {
    const hit = m.printers.filter((p) => names.has(p.name));
    if (!hit.length) continue;
    const nz = hit.length === m.printers.length ? T.changes.allNozzles
      : T.changes.nozzles(hit.map((p) => nozzleLabel(p.variant)).join(" · "));
    parts.push(i.models.length > 1 ? printerShortName(m.printers[0].name) + " · " + nz : nz);
  }
  return parts.join("; ");
}
// Pending filament changes of all installations. Module level, so the main menu and the change
// list show them on every page (app.js).
export const changes = computed(() => {
  const out = [];
  for (const i of INSTANCES) {
    const s = store[i.id];
    if (!s) continue;
    const add = (type, name, where) => out.push({ inst: i, page: "filamente", type, name, where });
    const createdNames = new Set(s.created.map((c) => c.entry.name));
    const deletedNames = new Set([...s.deleted].map((id) => id.slice("user:".length)));
    // An own profile shows up under its new name; n is the name it has on disk.
    const shownName = (n, fallback) => s.edits["user:" + n]?.name ?? fallback;
    const agg = new Map();
    const note = (name, on, printerNames) => {
      const k = name + "|" + on;
      if (!agg.has(k)) agg.set(k, { type: on ? "on" : "off", name, printers: new Set() });
      printerNames.forEach((p) => agg.get(k).printers.add(p));
    };
    for (const n of new Set([...s.listed, ...s.base.listed])) {
      const on = s.listed.has(n);
      if (on === s.base.listed.has(n)) continue;
      const f = i.byName.get(n);
      if (!f) continue;
      note(f.alias, on, f.origin_kind === "library" ? [ALL_PRINTERS] : Object.keys(f.printers));
    }
    for (const k of new Set([...s.bound, ...s.base.bound])) {
      const on = s.bound.has(k);
      if (on === s.base.bound.has(k)) continue;
      const cut = k.lastIndexOf("|"), n = k.slice(0, cut);
      if (createdNames.has(n) || deletedNames.has(n)) continue;
      const f = i.byName.get(n);
      note(shownName(n, f ? f.alias : n), on, [k.slice(cut + 1)]);
    }
    for (const a of agg.values()) add(a.type, a.name, whereText(i, a.printers));
    for (const c of s.created) {
      if (s.deleted.has(c.entry.id)) continue;
      const now = s.edits[c.entry.id] || c.entry, count = Object.keys(now.own || {}).length;
      const where = [c.entry.parent ? F.template(c.entry.parent.name) : "",
        count ? plural(count, ...T.words.ownValue) : ""].filter(Boolean).join(" · ");
      add("new", now.name, where);
    }
    // Edited own profiles: a new name and changed values are two steps in the slicer, too.
    for (const id of Object.keys(s.edits)) {
      if (s.deleted.has(id) || s.created.some((x) => x.entry.id === id)) continue;  // new ones are listed above
      const init = initialOf(i, id);
      if (!init) continue;
      const now = s.edits[id];
      if (init.name !== now.name) add("rename", init.name, T.changes.renameTo(now.name));
      const diff = FIELDS.filter((f) => !sameValue(init.own[f.key], now.own[f.key])).map((f) => changeText(f, now.own[f.key]));
      if (diff.length) add("edit", now.name, diff.join(" · "));
    }
    for (const n of deletedNames) add("delete", n, "");
  }
  return out;
});

export default {
  name: "FilamentePage",
  components: { FilamentEditor },
  props: {
    instId: { type: String, required: true },
    modelIdx: { type: Number, default: null },  // null = printer cards
  },

  setup(props) {
    const inst = computed(() => INSTANCES.find((i) => i.id === props.instId));
    const model = computed(() => props.modelIdx === null ? null : inst.value.models[props.modelIdx]);
    // Removed under "Drucker": the change list takes it away.
    const gone = computed(() => !!model.value && !modelShown(inst.value, model.value));
    const nozzle = ref("all");
    const printers = computed(() => !model.value ? []
      : nozzle.value === "all" ? model.value.printers.map((p) => p.name) : [nozzle.value]);
    const entries = computed(() => model.value ? entriesOf(inst.value, model.value) : []);
    const readOnly = computed(() => !!inst.value.running);
    const printerTitle = computed(() => model.value && printerShortName(model.value.printers[0]?.name || model.value.model));
    const nozzleText = computed(() => {
      const p = model.value && model.value.printers.find((x) => x.name === nozzle.value);
      return p ? T.changes.nozzles(nozzleLabel(p.variant)) : T.changes.allNozzles;
    });

    const query = ref("");
    const materials = reactive(new Set());
    const closedKinds = reactive(new Set());
    const expanded = reactive(new Set());   // brands opened by hand
    const collapsed = reactive(new Set());  // brands closed by hand while searching
    const panel = ref(null);
    const dragging = ref(null);
    const pickQuery = ref("");
    let dragSource = null, lastFocus = null;

    const filterActive = computed(() => query.value.trim() !== "" || materials.size > 0);
    watch(() => query.value + "|" + [...materials].join(), () => collapsed.clear());

    // ------------------------------------------------------------ printer cards
    // All installations; the one chosen in the top bar comes first.
    // Only printers the slicer shows; idx stays the position in the data, it is part of the address.
    // Library filaments Orfix switched on for every nozzle (way A) that the slicer hid again, e.g.
    // after its setup wizard (FINDINGS 4.7). The backend compares on every read ("unlock_lost").
    const lostText = (i) => {
      const w = i.warnings.find((x) => x.code === "unlock_lost");
      return w ? `${T.warnings.unlock_lost.text(w)} ${T.warnings.unlock_lost.action}` : "";
    };
    const homeGroups = computed(() => [...INSTANCES].sort((a, b) => (b.id === inst.value.id) - (a.id === inst.value.id)).map((i) => ({
      inst: i,
      lost: lostText(i),
      // Two installations of one slicer, e.g. a copy for a test next to the real one: the path tells.
      twin: INSTANCES.some((x) => x !== i && x.slicer === i.slicer),
      cards: i.models.map((m, idx) => ({ m, idx })).filter(({ m }) => modelShown(i, m)).map(({ m, idx }) => {
        const all = m.printers.map((p) => p.name);
        const active = entriesOf(i, m).filter((e) => ["on", "some"].includes(stateOf(i, e, all))).sort(byName);
        const name = printerShortName(m.printers[0]?.name || m.model);
        const own = m.bundle !== undefined ? F.bundlePrinter(m.bundle) : F.ownPrinter;
        return { m, idx, name, sub: m.own ? own : name === m.model ? "" : m.model, active };
      }),
    })));

    // ------------------------------------------------------------ tree
    const kindTitle = (kind) => ({
      user: F.kinds.user,
      vendor: model.value && model.value.origin && model.value.origin !== "Custom" ? F.kinds.vendorFrom(model.value.origin) : F.kinds.vendor,
      library: F.kinds.library,
      bundle: F.kinds.bundle,
    })[kind];
    const labelsOf = (names) => model.value.printers.filter((p) => names.includes(p.name))
      .map((p) => nozzleLabel(p.variant)).join(" · ");
    const ownCounts = computed(() => {
      const counts = new Map();
      for (const e of entries.value) if (e.kind === "user" && e.parent) counts.set(e.parent.id, (counts.get(e.parent.id) || 0) + 1);
      return counts;
    });
    // System filaments switched on per printer: Orca refills an empty printer with its
    // default materials, so the last one stays on (concept 4a).
    const onCount = computed(() => {
      const counts = {};
      if (!model.value) return counts;
      for (const p of model.value.printers) counts[p.name] = 0;
      for (const e of entries.value) {
        if (e.kind === "user" || e.kind === "bundle") continue;
        for (const p in counts) if (isOn(inst.value, e, p)) counts[p]++;
      }
      return counts;
    });
    function lockedOff(e, ps = printers.value) {
      const i = inst.value;
      if (e.kind === "user") return ownLocked(i, e, ps);
      if (!usesList(i, e)) return false;
      if (i.snorca) {
        // An empty list means "everything visible" in SnOrca (FINDINGS 4.6).
        const listed = store[i.id].listed;
        const leaving = new Set(ps.map((p) => e.slots[p]).filter((n) => n && listed.has(n)));
        return leaving.size > 0 && listed.size - leaving.size < 1;
      }
      return ps.some((p) => isOn(i, e, p) && onCount.value[p] <= 1);
    }
    // An own filament carries its printers in compatible_printers. An empty list means "every
    // printer" to the slicer (FINDINGS 4.6), so its last printer stays on; "Löschen" removes it.
    function ownLocked(i, e, ps) {
      const names = new Set(Object.values(e.slots));
      let on = 0, leaving = 0;
      for (const k of store[i.id].bound) {
        const cut = k.lastIndexOf("|");
        if (!names.has(k.slice(0, cut))) continue;
        on++;
        if (ps.includes(k.slice(cut + 1))) leaving++;
      }
      return leaving > 0 && on - leaving < 1;
    }
    const lockText = (e) => e.kind === "bundle" ? F.bundleLocked : e.kind === "user" ? F.lastNozzle : F.lastOne;
    function rowOf(e) {
      const i = inst.value, st = stateOf(i, e, printers.value);
      const locked = e.kind === "bundle" || (st === "on" && lockedOff(e));
      const row = { e, st, hint: null, locked, ownCount: ownCounts.value.get(e.id) || 0 };
      if (e.orphan) row.hint = e.unresolved ? { text: F.hints.unresolved, cls: "" } : { text: F.hints.notLoaded, cls: "bad" };
      else if (e.pending) row.hint = { text: F.hints.pending, cls: "changed" };
      else if (st === "some") row.hint = { text: F.hints.activeAt(labelsOf(printers.value.filter((p) => isOn(i, e, p)))), cls: "on" };
      else if (e.parent) row.hint = { text: F.template(e.parent.name), cls: "" };
      return row;
    }
    const rows = computed(() => entries.value.map(rowOf).filter((r) => r.st !== "na" || r.e.orphan));
    const isActive = (r) => r.st === "on" || r.st === "some";
    const shelf = computed(() => rows.value.filter(isActive).sort((a, b) => byName(a.e, b.e)));
    // Templates for "Neues Filament": a bundle profile is none, OrcaSlicer keeps it to itself.
    const pickShelf = computed(() => shelf.value.filter((r) => !fixed(r.e)));
    const tree = computed(() => {
      const q = query.value.trim().toLowerCase();
      const match = (e) => (!q || (e.name + " " + e.brand + " " + e.material).toLowerCase().includes(q))
        && (!materials.size || materials.has(materialGroup(e.material).id));
      return KIND_ORDER.map((kind) => {
        const all = rows.value.filter((r) => r.e.kind === kind);
        if (!all.length && kind !== "user") return null;
        // A profile the slicer does not load goes last: it is broken, but not the first thing to see.
        const shown = all.filter((r) => match(r.e)).sort((a, b) => (a.e.orphan - b.e.orphan) || byName(a.e, b.e));
        let groups;
        if (kind === "user") {
          groups = [{ key: "user", label: null, rows: shown }];
        } else {
          const brands = new Map();
          for (const r of all) {
            const g = groupOf(r.e), k = g.toLowerCase();
            if (!brands.has(k)) brands.set(k, { key: kind + "|" + k, label: g || F.noBrand, rows: [], total: 0, active: [] });
            const b = brands.get(k);
            b.total++;
            if (isActive(r)) b.active.push(r.e);
            if (!/^[A-Z]/.test(b.label) && /^[A-Z]/.test(g)) b.label = g;
          }
          for (const b of brands.values()) {
            b.on = b.active.length;
            b.active.sort(byName);
          }
          for (const r of shown) brands.get(groupOf(r.e).toLowerCase()).rows.push(r);
          groups = [...brands.values()].filter((b) => !filterActive.value || b.rows.length)
            .sort((a, b) => a.label.localeCompare(b.label, "de", { sensitivity: "base" }));
        }
        const on = all.filter(isActive).length;
        let note = null;
        if (kind === "library") note = !inst.value.snorca ? F.libraryNote.orca : on ? null : F.libraryNote.snorcaOff;
        if (kind === "bundle") note = F.bundleNote;
        return { kind, title: kindTitle(kind), icon: KIND_ICON[kind], total: all.length, on, hits: shown.length, groups, note };
      }).filter((k) => k && (!filterActive.value || k.hits || k.kind === "user"));
    });
    const brandOpen = (k) => filterActive.value ? !collapsed.has(k) : expanded.has(k);
    function toggleBrand(k) {
      const set = filterActive.value ? collapsed : expanded;
      set.has(k) ? set.delete(k) : set.add(k);
    }
    function toggleKind(kind) { closedKinds.has(kind) ? closedKinds.delete(kind) : closedKinds.add(kind); }
    function toggleMaterial(id) { materials.has(id) ? materials.delete(id) : materials.add(id); }

    // ------------------------------------------------------------ switching
    function setEntry(e, ps, on) {
      const i = inst.value, s = store[i.id];
      for (const p of ps) {
        const profile = e.slots[p];
        if (!profile) continue;
        if (usesList(i, e)) on ? s.listed.add(profile) : s.listed.delete(profile);
        else on ? s.bound.add(key(profile, p)) : s.bound.delete(key(profile, p));
      }
    }
    function toggle(e) {
      if (readOnly.value || fixed(e)) return;
      const st = stateOf(inst.value, e, printers.value);
      if (st === "on" && lockedOff(e)) return flash(lockText(e));
      setEntry(e, printers.value, st !== "on");
    }
    function switchOn(e, on) {
      if (readOnly.value || fixed(e)) return;
      if (!on && lockedOff(e)) return flash(lockText(e));
      setEntry(e, printers.value, on);
      flash(F.switched(e.name, on));
    }
    function toggleAt(e, p) {
      if (readOnly.value || fixed(e)) return;
      const on = isOn(inst.value, e, p);
      if (on && lockedOff(e, [p])) return flash(lockText(e));
      setEntry(e, [p], !on);
    }

    // ------------------------------------------------------------ panel
    function openPanel(p, focusId = "panel-title") {
      if (!panel.value) lastFocus = document.activeElement;
      panel.value = p;
      nextTick(() => document.getElementById(focusId)?.focus());
    }
    function closePanel() {
      panel.value = null;
      if (lastFocus && document.contains(lastFocus)) lastFocus.focus();
      lastFocus = null;
    }

    // A typed form is not thrown away without asking: Escape, the X, another row or tile, the
    // menu and the other buttons of the page pass through here. "Abbrechen" in the form is the
    // explicit way out and does not ask.
    const editDirty = ref(false);
    const leaveAsk = ref(null);  // the step that waits for "Verwerfen"
    watch(() => panel.value && panel.value.type === "edit" ? panel.value.seq : null, () => {
      editDirty.value = false;
      leaveAsk.value = null;
    });
    function guarded(step) {
      if (!(panel.value && panel.value.type === "edit" && editDirty.value)) return step();
      leaveAsk.value = step;
      nextTick(() => document.getElementById("leave-stay")?.focus());
    }
    function confirmLeave() {
      const step = leaveAsk.value;
      leaveAsk.value = null;
      editDirty.value = false;
      step();
    }
    function stayHere() {
      leaveAsk.value = null;
      nextTick(() => document.getElementById("edit-name")?.focus());
    }
    const requestClose = () => guarded(closePanel);
    onMounted(() => setLeaveGuard(guarded));
    onUnmounted(() => clearLeaveGuard(guarded));
    // By mouse the list keeps the focus; by keyboard the focus moves into the panel, Esc brings it back.
    function openDetails(e, byKeyboard = false) {
      if (!panel.value) lastFocus = document.activeElement;
      panel.value = { type: "details", id: e.id };
      if (byKeyboard) nextTick(() => document.getElementById("panel-title")?.focus());
    }
    const pickRow = (e, byKeyboard = false) => guarded(() => openDetails(e, byKeyboard));
    const detail = computed(() => {
      if (!panel.value || panel.value.type !== "details") return null;
      const e = entries.value.find((x) => x.id === panel.value.id);
      return e ? rowOf(e) : null;
    });
    // Why the slicer does not load an own filament, in the words of texts.js.
    const problemText = (e) => {
      const f = e.record && inst.value.byName.get(e.record);
      const text = f && T.profileProblems[f.problem];
      return text ? text(f) : F.notLoaded;
    };
    function profilesOf(e) {
      const i = inst.value;
      if (e.template) return profilesOf(e.template);
      if (e.record) return [i.byName.get(e.record)].filter(Boolean);
      const names = printers.value.map((p) => e.slots[p]).filter(Boolean);
      return [...new Set(names.length ? names : Object.values(e.slots))].map((n) => i.byName.get(n)).filter(Boolean);
    }
    // Own values of an entry, with the edits so far.
    const ownOf = (e) => store[inst.value.id].edits[e.id]?.own ?? ownInitial(inst.value, e);
    // A manufacturer entry can have one profile per nozzle. A new own filament on top of it
    // takes the values of one: that of the printer selected in the slicer, else the first in view.
    function templateProfile(e) {
      const recs = profilesOf(e);
      const ps = model.value.printers.filter((p) => printers.value.includes(p.name) && e.slots[p.name]);
      if (recs.length < 2 || !ps.length) return { rec: recs[0], variant: null };
      const p = ps.find((x) => x.selected) || ps[0];
      return { rec: inst.value.byName.get(e.slots[p.name]), variant: p.variant };
    }
    // What the template gives for key k. For a manufacturer or library profile that is its own
    // value: "Bearbeiten" saves it as a new own filament on top of it.
    function inheritedOf(e, k) {
      if (e.kind !== "user") return pick(templateProfile(e).rec?.values[k]);
      if (e.template) return inheritedOf(e.template, k);
      const v = inst.value.byName.get(e.record)?.values[k];
      return v && v.own ? pick(v.inherited) : pick(v);
    }
    const valueText = (v, x) => x && x.value !== "" ? fmt(x.value) + (v.unit ? " " + v.unit : "") : "–";
    const detailValues = computed(() => {
      if (!detail.value) return [];
      const e = detail.value.e;
      if (e.kind === "user" && !e.orphan) {
        const own = ownOf(e);
        return VALUES.map((v) => ({ ...v, text: valueText(v, own[v.key] || inheritedOf(e, v.key)), own: !!own[v.key] }));
      }
      const recs = profilesOf(e);
      return VALUES.map((v) => {
        const found = recs.map((r) => r.values[v.key]).filter((x) => x && x.value !== null && x.value !== "");
        const distinct = [...new Set(found.map((x) => x.value))];
        let text = "–";
        if (distinct.length === 1) text = fmt(distinct[0]);
        if (distinct.length > 1) {
          // Profiles per nozzle can differ, so show the range.
          const nums = distinct.map(Number).filter((n) => !isNaN(n)).sort((a, b) => a - b);
          text = nums.length ? fmt(nums[0]) + "–" + fmt(nums[nums.length - 1]) : fmt(distinct[0]);
        }
        if (text !== "–" && v.unit) text += " " + v.unit;
        return { ...v, text, own: e.kind === "user" && !e.template && found.some((x) => x.own) };
      });
    });
    const detailPrinters = computed(() => detail.value
      ? model.value.printers.filter((p) => detail.value.e.slots[p.name]) : []);
    // Buttons per nozzle only where one nozzle can really be switched alone: own profiles and
    // the SnOrca library bind per printer, list profiles only if each nozzle has its own profile.
    const nozzleSwitches = computed(() => {
      if (!detail.value || fixed(detail.value.e)) return false;
      const e = detail.value.e, ps = detailPrinters.value;
      return ps.length > 1 && (!usesList(inst.value, e) || new Set(ps.map((p) => e.slots[p.name])).size === ps.length);
    });
    const scopeText = computed(() => {
      const ps = detailPrinters.value;
      if (!detail.value || nozzleSwitches.value || !ps.length) return "";
      const e = detail.value.e;
      if (e.kind === "library" && usesList(inst.value, e)) return F.scope.everywhere;
      return ps.length === model.value.printers.length ? F.scope.allNozzles : F.scope.only(labelsOf(ps.map((p) => p.name)));
    });
    function jumpTo(id) {
      const e = entries.value.find((x) => x.id === id);
      if (!e) return flash(F.templateNotFound);
      if (stateOf(inst.value, e, printers.value) === "na") nozzle.value = "all";
      query.value = "";
      materials.clear();
      closedKinds.delete(e.kind);
      expanded.add(e.kind + "|" + groupOf(e).toLowerCase());
      openDetails(e);
      nextTick(() => scrollToRow(e));
    }
    function scrollToRow(e) {
      const row = document.getElementById("row-" + e.uid);
      if (!row) return;
      row.scrollIntoView({ block: "center", behavior: "smooth" });
      row.querySelector(".row-main")?.focus({ preventScroll: true });
    }

    // ------------------------------------------------------------ new filament
    // "Neues Filament" first asks for the template: the active filaments as spools, everything
    // else by search. Then the same form opens as for "Bearbeiten".
    const PICK_LIMIT = 12;
    const templateHits = computed(() => {
      const q = pickQuery.value.trim().toLowerCase();
      if (!q) return [];
      return rows.value.filter((r) => !fixed(r.e) && (r.e.name + " " + r.e.brand + " " + r.e.material).toLowerCase().includes(q))
        .map((r) => r.e).sort(byName);
    });
    function openPicker() {
      if (readOnly.value) return;
      pickQuery.value = "";
      openPanel({ type: "pick" });
    }
    // Names of all profiles, new ones and edited names; exceptId is the entry being edited.
    // A name given up by a rename stays taken until the change is written.
    function nameTaken(name, exceptId = null) {
      const n = name.toLowerCase(), i = inst.value, s = store[i.id];
      return i.filaments.some((f) => (f.name.toLowerCase() === n || f.alias.toLowerCase() === n) && "user:" + f.name !== exceptId)
        || s.created.some((c) => c.entry.id !== exceptId && c.entry.name.toLowerCase() === n)
        || Object.entries(s.edits).some(([id, ed]) => id !== exceptId && ed.name.toLowerCase() === n);
    }
    // "Generic PLA (eigen)", or "Generic PLA (eigen 2)" if that one exists already.
    function freeName(base) {
      let name = base;
      for (let k = 2; nameTaken(name); k++) name = base.replace(/\)$/, " " + k + ")");
      return name;
    }
    // The profile a new filament on top of tpl inherits (filament_create in ops.js): for a
    // manufacturer or library entry the one whose values the form showed, for an own one its
    // template. An own root profile without template is a template itself (FINDINGS 4.5).
    function baseOf(tpl) {
      if (tpl.kind !== "user") return templateProfile(tpl).rec?.name || null;
      return tpl.base || tpl.parent?.profile || tpl.record || null;
    }
    // A new own filament on top of tpl, switched on for the nozzles in view. On top of an own
    // filament it takes that one's template and copies its own values.
    function createOwn(tpl, name, own) {
      const s = store[inst.value.id];
      const base = baseOf(tpl);
      const e = {
        uid: ++uid, id: "user:" + name, kind: "user", name, brand: tpl.brand, material: tpl.material,
        colours: null, slots: {}, record: null,
        parent: tpl.kind === "user" ? tpl.parent : { id: tpl.id, name: tpl.name, profile: base },
        orphan: false, template: tpl, fresh: true, own, base,
      };
      for (const p of Object.keys(tpl.slots)) e.slots[p] = name;
      s.created.push({ model: model.value.model, entry: e });
      for (const p of printers.value) if (e.slots[p]) s.bound.add(key(name, p));
      closedKinds.delete("user");
      return e;
    }
    function removeOwn(e) {
      const s = store[inst.value.id];
      // By profile name, so the switches of other printer models go, too.
      const names = new Set(Object.values(e.slots));
      for (const k of [...s.bound]) if (names.has(k.slice(0, k.lastIndexOf("|")))) s.bound.delete(k);
      const idx = s.created.findIndex((c) => c.entry.id === e.id);
      if (idx >= 0) {
        // Only planned so far: it simply goes, with its edits.
        s.created.splice(idx, 1);
        delete s.edits[e.id];
      } else {
        s.deleted.add(e.id);
      }
      closePanel();
      flash(F.deleted(e.name));
    }

    // ------------------------------------------------------------ edit
    // One form for all of it. mode "edit": an own filament changes in place. "copy": "Bearbeiten"
    // on a manufacturer or library profile, which stays as it is; the result becomes a new own
    // filament on top of it. "new": a new own filament on top of e, an own e passes on its
    // template and its own values.
    let editSeq = 0;
    function openEditor(e, mode) {
      if (readOnly.value || fixed(e)) return;
      if (!panel.value) lastFocus = document.activeElement;
      panel.value = { type: "edit", id: e.id, mode, seq: ++editSeq };
      nextTick(() => document.getElementById("edit-name")?.focus());
    }
    const editing = computed(() => {
      if (!panel.value || panel.value.type !== "edit") return null;
      const e = entries.value.find((x) => x.id === panel.value.id);
      if (!e) return null;
      const mode = panel.value.mode, own = e.kind === "user";
      const variant = own ? null : templateProfile(e).variant;
      return {
        e, mode,
        name: mode === "edit" ? e.name : freeName(e.name + (own ? F.copySuffix : F.ownSuffix)),
        own: mode === "edit" ? ownOf(e) : own ? clone(ownOf(e)) : {},
        base: Object.fromEntries(FIELDS.map((f) => [f.key, inheritedOf(e, f.key)])),
        templateName: own ? (e.parent ? e.parent.name : "") : variant ? F.templateNozzle(e.name, nozzleLabel(variant)) : e.name,
        taken: (n) => nameTaken(n, mode === "edit" ? e.id : null),
      };
    });
    function saveEdit({ name, own }) {
      const ed = editing.value;
      if (!ed) return;
      const i = inst.value, s = store[i.id];
      let id = ed.e.id;
      editDirty.value = false;
      if (ed.mode === "copy" && !Object.keys(own).length && name === ed.name) {
        // Nothing typed: a copy would only be a second name for the same profile.
        flash(F.nothingChanged);
        nextTick(() => document.getElementById("panel-title")?.focus());
      } else if (ed.mode !== "edit") {
        const e = createOwn(ed.e, name, own);
        id = e.id;
        flash(F.created(name));
        nextTick(() => scrollToRow(e));
      } else {
        const init = initialOf(i, id), next = { name, own }, now = s.edits[id] || init;
        flash(now && stateKey(now) === stateKey(next) ? F.nothingChanged : F.changed(name));
        // Back at the start: no edit left, so no change in the list either.
        if (init && stateKey(init) === stateKey(next)) delete s.edits[id];
        else s.edits[id] = next;
        nextTick(() => document.getElementById("panel-title")?.focus());
      }
      panel.value = { type: "details", id };
    }
    function cancelEdit() {
      panel.value = { type: "details", id: panel.value.id };
      nextTick(() => document.getElementById("panel-title")?.focus());
    }

    // ------------------------------------------------------------ drag and drop
    // Rows are dragged as a whole; drop on "Aktiv" = on, back on the list = off, on the dock
    // target "Neues Filament daraus" = new filament. The switch and the buttons do the same by keyboard.
    function dragStart(ev, e, from) {
      if (readOnly.value || fixed(e)) return ev.preventDefault();
      ev.dataTransfer.setData("text/plain", e.name);
      ev.dataTransfer.effectAllowed = "copyMove";
      dragSource = { e, from };
      // Changing the DOM inside dragstart cancels the drag in Chromium.
      setTimeout(() => { if (dragSource) dragging.value = { from }; }, 0);
    }
    function dragEnd() {
      dragSource = null;
      dragging.value = null;
    }
    function accepts(target) {
      if (!dragSource) return false;
      if (target === "on") return dragSource.from === "tree";
      if (target === "off") return dragSource.from === "shelf";
      return true;
    }
    function dragOver(ev, target) {
      if (!accepts(target)) return;
      ev.preventDefault();
      ev.stopPropagation();
      ev.dataTransfer.dropEffect = "copy";
    }
    function drop(ev, target) {
      if (!accepts(target)) return;
      ev.preventDefault();
      ev.stopPropagation();
      const e = dragSource.e;
      dragEnd();
      if (target === "new") guarded(() => openEditor(e, "new"));
      else switchOn(e, target === "on");
    }

    const onKey = (ev) => {
      if (ev.key !== "Escape" || dragSource) return;
      if (leaveAsk.value) stayHere();
      else if (panel.value) requestClose();
    };
    onMounted(() => window.addEventListener("keydown", onKey));
    onUnmounted(() => window.removeEventListener("keydown", onKey));
    const activate = (ev, fn) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); fn(); } };
    const panelTitle = computed(() => {
      if (!panel.value) return "";
      if (panel.value.type === "edit") return panel.value.mode === "new" ? F.newFilament : F.edit;
      return { details: F.filament, pick: F.newFilament }[panel.value.type];
    });

    return {
      T, F, MATERIALS, inst, model, gone, nozzle, printers, readOnly, printerTitle, nozzleText,
      query, materials, closedKinds, panel, dragging, pickQuery,
      homeGroups, lostText, tree, shelf, pickShelf, fixed, detail, detailValues, detailPrinters, nozzleSwitches, scopeText, problemText,
      templateHits, PICK_LIMIT, openPicker, leaveAsk, editDirty, confirmLeave, stayHere, requestClose, guarded,
      panelTitle, editing, openEditor, saveEdit, cancelEdit,
      nozzleLabel, colourOf, materialColour, shortName, subOf, kindTitle, isOn, activate, go, hashOf, plural,
      brandOpen, toggleBrand, toggleKind, toggleMaterial, toggle, switchOn, toggleAt, lockText,
      openPanel, closePanel, openDetails, pickRow, jumpTo, removeOwn,
      dragStart, dragEnd, dragOver, drop, KIND_ICON,
    };
  },

  template: `
    <div :class="['page-host', { 'with-panel': panel }]">
      <!-- Screen 1: printer cards -->
      <div v-if="!model" class="page home">
        <h1 id="page-title" tabindex="-1">{{ F.homeTitle }}</h1>
        <section v-for="g in homeGroups" :key="g.inst.id" class="install" :aria-label="g.inst.slicer">
          <div class="install-head">
            <h2>{{ g.inst.slicer }}</h2>
            <span class="version">{{ g.inst.version }}</span>
            <span v-if="g.twin" class="inst-path">{{ g.inst.path }}</span>
            <run-status :inst="g.inst"/>
          </div>
          <p v-if="g.lost" class="banner">{{ g.lost }}</p>
          <div v-if="g.cards.length" class="cards">
            <a v-for="c in g.cards" :key="c.idx" class="card" :href="hashOf('filamente', g.inst.id, c.idx)"
               @click="go($event, hashOf('filamente', g.inst.id, c.idx))">
              <span class="card-img"><img :src="c.m.cover" alt="" width="170" height="170"></span>
              <span class="card-name">{{ c.name }}</span>
              <span v-if="c.sub" class="card-sub">{{ c.sub }}</span>
              <span class="card-meta"><nozzle-icon :sizes="[0.4]" :height="20"/><span class="sr-only">{{ F.nozzlesLabel }}</span> {{ c.m.printers.map((p) => nozzleLabel(p.variant)).join(' · ') }} mm</span>
              <span class="card-spools" aria-hidden="true">
                <spool-icon v-for="e in c.active.slice(0, 9)" :key="e.uid" :colour="colourOf(e)" :size="28"/>
                <span v-if="c.active.length > 9">+{{ c.active.length - 9 }}</span>
              </span>
              <span class="card-meta">{{ F.activeCount(c.active.length) }}</span>
            </a>
          </div>
          <p v-else class="empty">{{ F.noPrinter }}</p>
        </section>
        <p class="credits">{{ F.credits }}</p>
      </div>

      <!-- Screen 2 without a printer: removed on the page "Drucker" -->
      <div v-else-if="gone" class="page">
        <div class="printer-bar">
          <a class="btn" :href="hashOf('filamente', inst.id)" @click="go($event, hashOf('filamente', inst.id))"><ui-icon name="back"/><span class="back-label">{{ F.allPrinters }}</span></a>
          <div class="bar-title">
            <h1 id="page-title" tabindex="-1">{{ printerTitle }}</h1>
            <span>{{ inst.slicer }} {{ inst.version }}</span>
          </div>
        </div>
        <p class="empty">{{ F.printerGone }}</p>
      </div>

      <!-- Screen 2: one printer -->
      <div v-else class="page">
        <div class="printer-bar">
          <a class="btn" :href="hashOf('filamente', inst.id)" :aria-label="F.backToPrinters" @click="go($event, hashOf('filamente', inst.id))"><ui-icon name="back"/><span class="back-label">{{ F.allPrinters }}</span></a>
          <img class="bar-img" :src="model.cover" alt="" width="48" height="48">
          <div class="bar-title">
            <h1 id="page-title" tabindex="-1">{{ printerTitle }}</h1>
            <span>{{ model.own ? F.ownPrinter + ' · ' : '' }}{{ inst.slicer }} {{ inst.version }}</span>
          </div>
          <run-status :inst="inst"/>
        </div>
        <p v-if="readOnly" class="banner">{{ T.busy(inst) }} {{ T.closeToChange }}</p>
        <p v-if="lostText(inst)" class="banner">{{ lostText(inst) }}</p>

        <section class="box nozzles" aria-labelledby="nozzle-h">
          <h2 id="nozzle-h">{{ F.nozzle }}</h2>
          <div class="nozzle-row">
            <button type="button" class="nozzle-tile" :aria-pressed="nozzle === 'all'" @click="nozzle = 'all'">
              <nozzle-icon :sizes="[0.2, 0.4, 0.8]"/>{{ F.allNozzlesTile }}
            </button>
            <button v-for="p in model.printers" :key="p.name" type="button" class="nozzle-tile"
                    :aria-pressed="nozzle === p.name" @click="nozzle = p.name">
              <nozzle-icon :sizes="p.variant.split('+').map(Number)"/>{{ nozzleLabel(p.variant) }} mm
            </button>
          </div>
        </section>

        <section :class="['box', 'shelf', { 'drop-ready': dragging && dragging.from === 'tree' }]" aria-labelledby="shelf-h"
                 @dragover="dragOver($event, 'on')" @drop="drop($event, 'on')">
          <div class="box-head">
            <h2 id="shelf-h">{{ F.active }}</h2>
            <span class="count">{{ shelf.length }}</span>
            <span class="sub">{{ F.shelfSub(nozzleText) }}</span>
          </div>
          <ul v-if="shelf.length" class="shelf-grid">
            <li v-for="r in shelf" :key="r.e.uid" class="tile" :draggable="!readOnly && !fixed(r.e)"
                @dragstart="dragStart($event, r.e, 'shelf')" @dragend="dragEnd">
              <div class="tile-main" role="button" tabindex="0" :aria-current="panel && panel.id === r.e.id ? 'true' : null"
                   @click="pickRow(r.e)" @keydown="activate($event, () => pickRow(r.e, true))">
                <spool-icon :colour="colourOf(r.e)" :size="48"/>
                <span class="tile-name" :title="r.e.name">{{ shortName(r.e) }}</span>
                <span class="tile-sub">{{ subOf(r.e) }}<span v-if="r.e.pending" class="tile-changed">{{ F.changedTag }}</span><span v-else-if="r.st === 'some'" class="partly" :title="r.hint.text"> · {{ F.partly }}</span></span>
              </div>
              <button class="icon-btn tile-off" type="button" :aria-label="F.switchOffLabel(r.e.name)" :title="r.locked ? lockText(r.e) : F.switchOff"
                      :disabled="readOnly || r.locked" @click="switchOn(r.e, false)"><ui-icon :name="r.locked ? 'lock' : 'close'"/></button>
            </li>
          </ul>
          <p v-else class="empty">{{ F.shelfEmpty }}</p>
        </section>

        <section class="box" :aria-label="F.allFilaments">
          <div class="toolbar">
            <label class="search">
              <ui-icon name="search"/>
              <input v-model="query" class="input" type="search" :placeholder="F.search" :aria-label="F.search">
            </label>
            <button class="btn btn-primary" type="button" :disabled="readOnly" @click="guarded(openPicker)"><ui-icon name="plus"/>{{ F.newFilament }}</button>
          </div>
          <div class="toolbar chips" role="group" :aria-label="F.material">
            <button v-for="g in MATERIALS" :key="g.id" type="button" class="chip" :aria-pressed="materials.has(g.id)" @click="toggleMaterial(g.id)">
              <span class="dot" :style="{ background: g.colour }"></span>{{ g.label }}
            </button>
          </div>

          <div class="tree" @dragover="dragOver($event, 'off')" @drop="drop($event, 'off')">
            <section v-for="k in tree" :key="k.kind" class="kind">
              <h3>
                <button :class="['kind-head', { 'is-empty': !k.on }]" type="button" :aria-expanded="!closedKinds.has(k.kind)" @click="toggleKind(k.kind)">
                  <ui-icon name="chevron" class="chev"/>
                  <span class="kind-icon"><ui-icon :name="k.icon"/></span>
                  <span class="kind-title">{{ k.title }}</span>
                  <span :class="['stand', { 'has-on': k.on }]">{{ F.onOfActive(k.on, k.total) }}</span>
                </button>
              </h3>
              <template v-if="!closedKinds.has(k.kind)">
                <p v-if="k.note" class="kind-note">{{ k.note }}</p>
                <div class="kind-body">
                  <div v-for="g in k.groups" :key="g.key" :class="{ 'brand-group': g.label }">
                    <h4 v-if="g.label" class="brand-h">
                      <button :class="['brand-head', { 'is-empty': !g.on }]" type="button" :aria-expanded="brandOpen(g.key)" @click="toggleBrand(g.key)">
                        <ui-icon name="chevron" class="chev"/>
                        <span class="brand-title">{{ g.label }}</span>
                        <span v-if="g.on" class="mini-spools" aria-hidden="true">
                          <spool-icon v-for="e in g.active.slice(0, 5)" :key="e.uid" :colour="colourOf(e)" :size="20"/>
                        </span>
                        <span :class="['stand', { 'has-on': g.on }]">{{ F.onOf(g.on, g.total) }}</span>
                      </button>
                    </h4>
                    <ul v-if="!g.label || brandOpen(g.key)" class="rows">
                      <li v-for="r in g.rows" :key="r.e.uid" :id="'row-' + r.e.uid"
                          :class="['row', 'is-' + (r.st === 'na' ? 'off' : r.st), { 'is-selected': panel && panel.id === r.e.id, 'is-fresh': r.e.fresh }]"
                          :draggable="!readOnly && !fixed(r.e)" @dragstart="dragStart($event, r.e, 'tree')" @dragend="dragEnd">
                        <span class="grip" aria-hidden="true"><ui-icon name="grip"/></span>
                        <div class="row-main" role="button" tabindex="0" @click="pickRow(r.e)" @keydown="activate($event, () => pickRow(r.e, true))">
                          <spool-icon :colour="colourOf(r.e)" :size="28"/>
                          <span class="row-text">
                            <span class="row-name" :title="r.e.name">{{ shortName(r.e) }}</span>
                            <span v-if="r.hint" :class="['row-hint', r.hint.cls]">{{ r.hint.text }}</span>
                          </span>
                          <span v-if="r.ownCount" class="badge">{{ F.ownCount(r.ownCount) }}</span>
                          <span v-if="r.e.material" class="mat">{{ r.e.material }}</span>
                        </div>
                        <span v-if="r.locked" class="lock" :title="lockText(r.e)"><ui-icon name="lock"/></span>
                        <button v-if="!r.e.orphan" class="switch" type="button" role="checkbox"
                                :aria-checked="r.st === 'on' ? 'true' : r.st === 'some' ? 'mixed' : 'false'"
                                :aria-label="F.activeLabel(r.e.name)" :disabled="readOnly || r.locked" @click="toggle(r.e)"></button>
                        <span v-else class="switch-gap"></span>
                      </li>
                    </ul>
                  </div>
                  <p v-if="k.kind === 'user' && !k.total" class="no-hits">{{ F.noOwn }}</p>
                  <p v-else-if="k.kind === 'user' && !k.groups[0].rows.length" class="no-hits">{{ F.noHits }}</p>
                </div>
              </template>
            </section>
            <p v-if="!tree.some((k) => k.hits)" class="no-hits">{{ F.nothingFound }}</p>
          </div>
        </section>
      </div>
    </div>

    <div v-if="dragging" class="dock">
      <div v-if="dragging.from === 'tree'" class="dock-target" @dragover="dragOver($event, 'on')" @drop="drop($event, 'on')"><ui-icon name="check"/>{{ F.dock.on }}</div>
      <div v-else class="dock-target" @dragover="dragOver($event, 'off')" @drop="drop($event, 'off')"><ui-icon name="minus"/>{{ F.dock.off }}</div>
      <div class="dock-target" @dragover="dragOver($event, 'new')" @drop="drop($event, 'new')"><ui-icon name="plus"/>{{ F.newFrom }}</div>
    </div>

    <aside v-if="panel" :class="['panel', { 'is-asking': leaveAsk }]" aria-labelledby="panel-title">
      <div class="panel-head">
        <h2 id="panel-title" tabindex="-1">{{ panelTitle }}</h2>
        <button class="icon-btn" type="button" :aria-label="T.close" @click="requestClose"><ui-icon name="close"/></button>
      </div>
      <filament-editor v-if="editing" :key="panel.seq" :start-name="editing.name" :own="editing.own" :base="editing.base"
                       :mode="editing.mode" :template-name="editing.templateName" :material-colour="materialColour(editing.e)"
                       :name-taken="editing.taken" :scope-text="nozzleText" @save="saveEdit" @cancel="cancelEdit"
                       @dirty="editDirty = $event"/>
      <div v-if="editing && leaveAsk" class="leave-ask" role="alertdialog" aria-labelledby="leave-q" aria-describedby="leave-d">
        <p id="leave-q" class="leave-q">{{ F.leave.question }}</p>
        <p id="leave-d" class="note">{{ F.leave.detail }}</p>
        <div class="actions">
          <button id="leave-stay" class="btn" type="button" @click="stayHere">{{ F.leave.stay }}</button>
          <button class="btn btn-danger-solid right" type="button" @click="confirmLeave">{{ F.leave.discard }}</button>
        </div>
      </div>
      <div v-if="!editing" class="panel-body">
        <template v-if="panel.type === 'details'">
          <p v-if="!detail" class="note">{{ F.notForNozzle }}</p>
          <template v-else>
            <div class="hero">
              <spool-icon :colour="colourOf(detail.e)" :size="104" :class="{ dim: detail.st === 'off' || detail.st === 'na' }"/>
              <div class="hero-text">
                <p class="hero-name">{{ detail.e.name }}</p>
                <p class="hero-sub">
                  <span v-if="detail.e.brand">{{ detail.e.brand }}</span>
                  <span class="mat">{{ detail.e.material || '–' }}</span>
                </p>
                <p class="kind-chip"><ui-icon :name="KIND_ICON[detail.e.kind]"/>{{ kindTitle(detail.e.kind) }}</p>
                <div v-if="!detail.e.orphan" class="hero-switch">
                  <button class="switch" type="button" role="checkbox"
                          :aria-checked="detail.st === 'on' ? 'true' : detail.st === 'some' ? 'mixed' : 'false'"
                          :aria-label="F.activeLabel(detail.e.name)" :disabled="readOnly || detail.locked || detail.st === 'na'" @click="toggle(detail.e)"></button>
                  <span :class="{ 'ch-on': detail.st === 'on' || detail.st === 'some' }">{{ F.state[detail.st] }}</span>
                  <span v-if="detail.locked" class="lock" :title="lockText(detail.e)"><ui-icon name="lock"/></span>
                </div>
              </div>
            </div>
            <p v-if="detail.e.orphan" class="alert">{{ problemText(detail.e) }}</p>
            <p v-if="detail.e.kind === 'bundle'" class="from"><ui-icon name="package"/> {{ F.fromBundle(detail.e.pack) }}</p>
            <p v-if="detail.e.parent" class="from">{{ F.templateLabel }} <button class="link" type="button" @click="jumpTo(detail.e.parent.id)">{{ detail.e.parent.name }}</button></p>

            <template v-if="detail.e.colours && detail.e.kind !== 'user'">
              <h3>{{ F.colours }}</h3>
              <div class="swatches">
                <span v-for="c in detail.e.colours" :key="c.hex + c.name" class="swatch" :style="{ background: c.hex }" :title="c.name" role="img" :aria-label="c.name"></span>
              </div>
            </template>

            <h3>{{ F.valuesTitle }}</h3>
            <dl class="values">
              <div v-for="v in detailValues" :key="v.key" class="value">
                <ui-icon :name="v.icon"/>
                <dt>{{ v.label }}</dt>
                <dd>{{ v.text }}<span v-if="v.own" class="own-dot" :title="F.ownValue"></span></dd>
              </div>
            </dl>
            <p v-if="detailValues.some((v) => v.own)" class="legend"><span class="own-dot"></span> {{ F.ownLegend }}</p>

            <template v-if="nozzleSwitches">
              <h3>{{ F.activeAtNozzle }}</h3>
              <div class="nz-toggles">
                <button v-for="p in detailPrinters" :key="p.name" class="nz-toggle" type="button" role="checkbox"
                        :aria-checked="isOn(inst, detail.e, p.name) ? 'true' : 'false'" :disabled="readOnly" @click="toggleAt(detail.e, p.name)">
                  <ui-icon :name="isOn(inst, detail.e, p.name) ? 'check' : 'box'"/>{{ nozzleLabel(p.variant) }} mm
                </button>
              </div>
            </template>
            <p v-else-if="scopeText" class="scope"><nozzle-icon :sizes="[0.4]" :height="20"/>{{ scopeText }}</p>

            <!-- One way per result: "Bearbeiten" on a manufacturer or library profile creates the own copy. -->
            <div class="actions">
              <button v-if="!fixed(detail.e)" class="btn btn-primary" type="button" :disabled="readOnly"
                      @click="openEditor(detail.e, detail.e.kind === 'user' ? 'edit' : 'copy')"><ui-icon name="pencil"/>{{ F.edit }}</button>
              <button v-if="detail.e.kind === 'user' && !detail.e.orphan" class="btn" type="button" :disabled="readOnly"
                      @click="openEditor(detail.e, 'new')"><ui-icon name="plus"/>{{ F.newFrom }}</button>
              <button v-if="detail.e.kind === 'user'" class="btn btn-danger right" type="button" :disabled="readOnly" @click="removeOwn(detail.e)"><ui-icon name="trash"/>{{ F.delete }}</button>
            </div>
          </template>
        </template>

        <template v-else-if="panel.type === 'pick'">
          <p class="note pick-lead">{{ F.pick.lead }}</p>
          <h3 v-if="pickShelf.length">{{ F.active }}</h3>
          <div v-if="pickShelf.length" class="pick-grid">
            <button v-for="r in pickShelf" :key="r.e.uid" type="button" class="pick" :title="r.e.name" @click="openEditor(r.e, 'new')">
              <spool-icon :colour="colourOf(r.e)" :size="36"/>
              <span class="pick-name">{{ shortName(r.e) }}</span>
              <span class="pick-sub">{{ subOf(r.e) }}</span>
            </button>
          </div>
          <h3>{{ F.pick.more }}</h3>
          <label class="search">
            <ui-icon name="search"/>
            <input id="tpl-search" v-model="pickQuery" class="input" type="search" autocomplete="off" :placeholder="F.search" :aria-label="F.pick.searchLabel">
          </label>
          <div v-if="templateHits.length" class="pick-grid pick-hits">
            <button v-for="e in templateHits.slice(0, PICK_LIMIT)" :key="e.uid" type="button" class="pick" :title="e.name" @click="openEditor(e, 'new')">
              <spool-icon :colour="colourOf(e)" :size="36"/>
              <span class="pick-name">{{ shortName(e) }}</span>
              <span class="pick-sub">{{ subOf(e) }}</span>
            </button>
          </div>
          <p v-if="templateHits.length > PICK_LIMIT" class="note">{{ F.pick.moreHits(templateHits.length - PICK_LIMIT) }}</p>
          <p v-else-if="pickQuery.trim() && !templateHits.length" class="note">{{ F.nothingFound }}</p>
          <div class="actions">
            <button class="btn" type="button" @click="closePanel">{{ T.cancel }}</button>
          </div>
        </template>
        <p v-else class="note">{{ F.goneFilament }}</p>
      </div>
    </aside>
  `,
};
