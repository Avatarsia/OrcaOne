// Page "Filamente", draft E as a component: printer cards first, then one printer with its
// nozzle, the active filaments and one tree Eigene / Vom Hersteller / Orca-Bibliothek.
// app.js mounts it fresh for every route, so no state leaks from one printer to the next.
// "Bearbeiten" opens the form from filament-editor.js; its result is one more pending change.
import { INSTANCES, flash, go, asset, backupNow, plural, nozzleLabel, printerShortName } from "../common.js";
import FilamentEditor, { FIELDS, nameProblem, hexOf, changeText } from "./filament-editor.js";

const { ref, reactive, computed, watch, nextTick, onMounted, onUnmounted } = Vue;

// The spool always shows the material group: real filament colours exist for few profiles
// only, and a made-up colour would look real. Known colours are listed in the side panel.
// "Weitere" is not grey, because grey means "switched off".
const MATERIALS = [
  { id: "pla", label: "PLA", colour: "#8CC7A6", test: (m) => /^PLA/i.test(m) },
  { id: "petg", label: "PETG", colour: "#84ACDA", test: (m) => /^(PETG|PCTG|PET)/i.test(m) },
  { id: "abs", label: "ABS/ASA", colour: "#E5A46C", test: (m) => /^(ABS|ASA)/i.test(m) },
  { id: "tpu", label: "TPU", colour: "#B89AD8", test: (m) => /^(TPU|PEBA|TPE)/i.test(m) },
  { id: "other", label: "Weitere", colour: "#D2B98A", test: () => true },
];
// Only values a layman can check on the spool label or the receipt.
const VALUES = [
  { key: "nozzle_temperature", label: "Düse", unit: "°C", icon: "temp" },
  { key: "hot_plate_temp", label: "Bett", unit: "°C", icon: "bed" },
  { key: "filament_cost", label: "Preis je kg", unit: "", icon: "price" },
];
// Own profiles first: they are few and the ones people change.
const KIND_ORDER = ["user", "vendor", "library"];
const KIND_ICON = { user: "user", vendor: "factory", library: "books" };
const LAST_ONE = "Mindestens ein Filament bleibt an.";
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
  return e.kind !== "user" && e.brand && e.name.toLowerCase().startsWith(b) && rest ? rest : e.name;
}
const subOf = (e) => e.kind === "user" ? "Eigenes" : e.brand || e.material || "";

// How a switch reaches the slicer (concept 4a-c): system filaments go through the global
// "filaments" list, except the library in SnOrca, which gets a hidden helper profile per
// printer; own profiles carry their printers themselves. Both kinds are kept in memory only.
const usesList = (inst, e) => e.kind === "vendor" || (e.kind === "library" && !inst.snorca);

// make_data.py adds example own profiles the real slicer does not have. A library row that is
// only on because of such a helper profile counts as example, too.
const EXAMPLE_UNLOCKS = new Map(INSTANCES.map((i) => [i.id,
  new Set(i.filaments.filter((f) => f.helper && f.example).map((f) => f.chain[0]))]));

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

// Module level, so switches and new filaments survive a trip to another page.
// edits: entry id -> { name, own } for own filaments changed with "Bearbeiten"; own maps a
// field key to { value, high_flow? }, the values the profile sets itself.
const store = reactive(Object.fromEntries(INSTANCES.map((inst) => {
  const { listed, bound } = initialState(inst);
  return [inst.id, {
    listed, bound, created: [], deleted: new Set(), edits: {},
    base: { listed: new Set(listed), bound: new Set(bound), created: [], deleted: new Set(), edits: {} },
  }];
})));
const clone = (x) => JSON.parse(JSON.stringify(x));

// ------------------------------------------------------------ own values
// A value from data.js as the editor needs it; null when nothing can be resolved.
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
// What an own entry sets itself before any edit: from data.js, or given when it was created.
function ownInitial(inst, e) {
  if (e.kind !== "user") return {};
  if (e.own) return e.own;
  return e.record ? recordOwn(inst.byName.get(e.record)) : {};
}
// Name and own values an own entry had at the start of the session, by entry id.
function initialOf(inst, id) {
  const c = store[inst.id].created.find((x) => x.entry.id === id);
  if (c) return { name: c.entry.name, own: c.entry.own || {} };
  const f = id.startsWith("user:") ? inst.byName.get(id.slice("user:".length)) : null;
  return f && f.origin_kind === "user" ? { name: f.name, own: recordOwn(f) } : null;
}
const sameValue = (a, b) => (a?.value ?? null) === (b?.value ?? null) && (a?.high_flow ?? null) === (b?.high_flow ?? null);
const stateKey = (x) => x.name + "\n" + Object.keys(x.own).sort()
  .map((k) => k + "=" + x.own[k].value + "/" + (x.own[k].high_flow ?? "")).join(";");
// An edited own entry shows its new name, and its own colour on the spool: a colour the user
// picked is real, unlike a made-up one (see MATERIALS).
function withEdits(inst, e) {
  if (e.kind !== "user") return e;
  const s = store[inst.id], ed = s.edits[e.id];
  const own = ed ? ed.own : ownInitial(inst, e);
  const colour = hexOf(own.default_filament_colour?.value), vendor = own.filament_vendor?.value;
  if (!ed && !colour && !vendor) return e;
  const before = s.base.edits[e.id] || initialOf(inst, e.id);
  return {
    ...e, name: ed ? ed.name : e.name, colour, brand: vendor || e.brand,
    pending: !!ed && (!before || stateKey(ed) !== stateKey(before)),
  };
}

// One tree entry per short name (text before "@") and printer model; the profile per nozzle
// sits in slots. Profiles hidden by a vendor profile of the same name never show up.
let uid = 0;
const entryCache = new Map();
function makeEntry(kind, name, f) {
  return {
    uid: ++uid, id: kind + ":" + name, kind, name, brand: f.vendor || "", material: f.material || "",
    colours: f.colours || null, slots: {},
    record: null, parent: null, orphan: false, template: null, fresh: false, example: !!f.example,
  };
}
function baseEntries(inst, model) {
  const cacheKey = inst.id + "|" + model.model;
  if (entryCache.has(cacheKey)) return entryCache.get(cacheKey);
  const printers = model.printers.map((p) => p.name);
  const unlocks = EXAMPLE_UNLOCKS.get(inst.id);
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
      e.example ||= unlocks.has(f.name);
    }
  }
  for (const f of inst.filaments) {
    // Helper profiles never show up as own filaments, the library row stands for them.
    if (f.origin_kind !== "user" || f.helper) continue;
    const e = makeEntry("user", f.name, f);
    e.record = f.name;
    const parent = f.chain.length ? inst.byName.get(f.chain[0]) : null;
    if (parent) e.parent = { id: parent.origin_kind + ":" + parent.alias, name: parent.alias };
    if (f.status === "orphaned") {
      e.orphan = true;
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
function entriesOf(inst, model) {
  const s = store[inst.id];
  return baseEntries(inst, model).filter((e) => !s.deleted.has(e.id))
    .concat(s.created.filter((c) => c.model === model.model && !s.deleted.has(c.entry.id)).map((c) => c.entry))
    .map((e) => withEdits(inst, e));
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
    const nozzle = ref("all");
    const printers = computed(() => !model.value ? []
      : nozzle.value === "all" ? model.value.printers.map((p) => p.name) : [nozzle.value]);
    const entries = computed(() => model.value ? entriesOf(inst.value, model.value) : []);
    const readOnly = computed(() => !!inst.value.running);
    const printerTitle = computed(() => model.value && printerShortName(model.value.printers[0]?.name || model.value.model));
    const nozzleText = computed(() => {
      const p = model.value && model.value.printers.find((x) => x.name === nozzle.value);
      return p ? "Düse " + nozzleLabel(p.variant) : "alle Düsen";
    });

    const query = ref("");
    const materials = reactive(new Set());
    const closedKinds = reactive(new Set());
    const expanded = reactive(new Set());   // brands opened by hand
    const collapsed = reactive(new Set());  // brands closed by hand while searching
    const panel = ref(null);
    const dragging = ref(null);
    const draft = reactive({ templateId: null, picking: false, query: "", name: "", tried: false });
    let dragSource = null, lastFocus = null;

    const filterActive = computed(() => query.value.trim() !== "" || materials.size > 0);
    watch(() => query.value + "|" + [...materials].join(), () => collapsed.clear());

    // ------------------------------------------------------------ printer cards
    // All installations as in draft E; the one chosen in the top bar comes first.
    const homeGroups = computed(() => [...INSTANCES].sort((a, b) => (b.id === inst.value.id) - (a.id === inst.value.id)).map((i) => ({
      inst: i,
      cards: i.models.map((m, idx) => {
        const all = m.printers.map((p) => p.name);
        const active = entriesOf(i, m).filter((e) => ["on", "some"].includes(stateOf(i, e, all))).sort(byName);
        const name = printerShortName(m.printers[0]?.name || m.model);
        return { m, idx, name, sub: name === m.model ? "" : m.model, active };
      }),
    })));

    // ------------------------------------------------------------ tree
    const kindTitle = (kind) => ({
      user: "Eigene",
      vendor: model.value && model.value.origin !== "Custom" ? "Von " + model.value.origin : "Vom Hersteller",
      library: "Orca-Bibliothek",
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
        if (e.kind === "user") continue;
        for (const p in counts) if (isOn(inst.value, e, p)) counts[p]++;
      }
      return counts;
    });
    function lockedOff(e, ps = printers.value) {
      const i = inst.value;
      if (!usesList(i, e)) return false;
      if (i.snorca) {
        // An empty list means "everything visible" in SnOrca (FINDINGS 4.6).
        const listed = store[i.id].listed;
        const leaving = new Set(ps.map((p) => e.slots[p]).filter((n) => n && listed.has(n)));
        return leaving.size > 0 && listed.size - leaving.size < 1;
      }
      return ps.some((p) => isOn(i, e, p) && onCount.value[p] <= 1);
    }
    function rowOf(e) {
      const i = inst.value, st = stateOf(i, e, printers.value);
      const row = { e, st, hint: null, locked: st === "on" && lockedOff(e), ownCount: ownCounts.value.get(e.id) || 0 };
      if (e.orphan) row.hint = { text: "Im Slicer nicht sichtbar", cls: "bad" };
      else if (e.pending) row.hint = { text: "Geändert, noch nicht übernommen", cls: "changed" };
      else if (st === "some") row.hint = { text: "aktiv bei " + labelsOf(printers.value.filter((p) => isOn(i, e, p))), cls: "on" };
      else if (e.parent) row.hint = { text: "Vorlage: " + e.parent.name, cls: "" };
      return row;
    }
    const rows = computed(() => entries.value.map(rowOf).filter((r) => r.st !== "na" || r.e.orphan));
    const isActive = (r) => r.st === "on" || r.st === "some";
    const shelf = computed(() => rows.value.filter(isActive).sort((a, b) => byName(a.e, b.e)));
    const tree = computed(() => {
      const q = query.value.trim().toLowerCase();
      const match = (e) => (!q || (e.name + " " + e.brand + " " + e.material).toLowerCase().includes(q))
        && (!materials.size || materials.has(materialGroup(e.material).id));
      return KIND_ORDER.map((kind) => {
        const all = rows.value.filter((r) => r.e.kind === kind);
        if (!all.length && kind !== "user") return null;
        // A profile without template goes last: it is broken, but not the first thing to see.
        const shown = all.filter((r) => match(r.e)).sort((a, b) => (a.e.orphan - b.e.orphan) || byName(a.e, b.e));
        let groups;
        if (kind === "user") {
          groups = [{ key: "user", label: null, rows: shown }];
        } else {
          const brands = new Map();
          for (const r of all) {
            const k = r.e.brand.toLowerCase();
            if (!brands.has(k)) brands.set(k, { key: kind + "|" + k, label: r.e.brand || "Ohne Marke", rows: [], total: 0, active: [] });
            const b = brands.get(k);
            b.total++;
            if (isActive(r)) b.active.push(r.e);
            if (!/^[A-Z]/.test(b.label) && /^[A-Z]/.test(r.e.brand)) b.label = r.e.brand;
          }
          for (const b of brands.values()) {
            b.on = b.active.length;
            b.active.sort(byName);
          }
          for (const r of shown) brands.get(r.e.brand.toLowerCase()).rows.push(r);
          groups = [...brands.values()].filter((b) => !filterActive.value || b.rows.length)
            .sort((a, b) => a.label.localeCompare(b.label, "de", { sensitivity: "base" }));
        }
        const on = all.filter(isActive).length;
        let note = null;
        if (kind === "library") {
          note = !inst.value.snorca ? "Ein Schalter gilt hier für alle Drucker."
            : on ? null : "Ausgeschaltet – einzeln einschalten";
        }
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
      if (readOnly.value || e.orphan) return;
      const st = stateOf(inst.value, e, printers.value);
      if (st === "on" && lockedOff(e)) return flash(LAST_ONE);
      setEntry(e, printers.value, st !== "on");
    }
    function switchOn(e, on) {
      if (readOnly.value || e.orphan) return;
      if (!on && lockedOff(e)) return flash(LAST_ONE);
      setEntry(e, printers.value, on);
      flash(`„${e.name}“ ${on ? "eingeschaltet" : "ausgeschaltet"}`);
    }
    function toggleAt(e, p) {
      if (readOnly.value) return;
      const on = isOn(inst.value, e, p);
      if (on && lockedOff(e, [p])) return flash(LAST_ONE);
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
    // By mouse the list keeps the focus; by keyboard the focus moves into the panel, Esc brings it back.
    function openDetails(e, byKeyboard = false) {
      if (!panel.value) lastFocus = document.activeElement;
      panel.value = { type: "details", id: e.id };
      if (byKeyboard) nextTick(() => document.getElementById("panel-title")?.focus());
    }
    const detail = computed(() => {
      if (!panel.value || panel.value.type !== "details") return null;
      const e = entries.value.find((x) => x.id === panel.value.id);
      return e ? rowOf(e) : null;
    });
    function profilesOf(e) {
      const i = inst.value;
      if (e.template) return profilesOf(e.template);
      if (e.record) return [i.byName.get(e.record)].filter(Boolean);
      const names = printers.value.map((p) => e.slots[p]).filter(Boolean);
      return [...new Set(names.length ? names : Object.values(e.slots))].map((n) => i.byName.get(n)).filter(Boolean);
    }
    // Own values of an entry, with the edits of this session.
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
    const detailValues = computed(() => {
      if (!detail.value) return [];
      const e = detail.value.e;
      if (e.kind === "user" && !e.orphan) {
        const own = ownOf(e);
        return VALUES.map((v) => {
          const x = own[v.key] || inheritedOf(e, v.key);
          const text = x && x.value !== "" ? fmt(x.value) + (v.unit ? " " + v.unit : "") : "–";
          return { ...v, text, own: !!own[v.key] };
        });
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
      if (!detail.value) return false;
      const e = detail.value.e, ps = detailPrinters.value;
      return ps.length > 1 && (!usesList(inst.value, e) || new Set(ps.map((p) => e.slots[p.name])).size === ps.length);
    });
    const scopeText = computed(() => {
      const ps = detailPrinters.value;
      if (!detail.value || nozzleSwitches.value || !ps.length) return "";
      const e = detail.value.e;
      if (e.kind === "library" && usesList(inst.value, e)) return "Gilt für alle Düsen und alle Drucker.";
      return ps.length === model.value.printers.length ? "Gilt für alle Düsen."
        : "Nur für Düse " + labelsOf(ps.map((p) => p.name)) + " mm.";
    });
    const STATE_TEXT = { on: "An", some: "Teilweise an", off: "Aus", na: "Für diese Düse nicht da" };
    function jumpTo(id) {
      const e = entries.value.find((x) => x.id === id);
      if (!e) return flash("Vorlage nicht gefunden.");
      if (stateOf(inst.value, e, printers.value) === "na") nozzle.value = "all";
      query.value = "";
      materials.clear();
      closedKinds.delete(e.kind);
      expanded.add(e.kind + "|" + e.brand.toLowerCase());
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
    const draftTemplate = computed(() => entries.value.find((e) => e.id === draft.templateId) || null);
    // Template picker: the active filaments as spools, everything else by search.
    const PICK_LIMIT = 12;
    const templateHits = computed(() => {
      const q = draft.query.trim().toLowerCase();
      if (!q) return [];
      return rows.value.filter((r) => !r.e.orphan && (r.e.name + " " + r.e.brand + " " + r.e.material).toLowerCase().includes(q))
        .map((r) => r.e).sort(byName);
    });
    const templateError = computed(() => draft.tried && !draftTemplate.value ? "Bitte eine Vorlage wählen." : "");
    function pickTemplate(e) {
      draft.templateId = e.id;
      draft.picking = false;
      nextTick(() => document.getElementById("new-name")?.focus());
    }
    function otherTemplate() {
      draft.picking = true;
      nextTick(() => document.getElementById("tpl-search")?.focus());
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
    const nameError = computed(() => !draft.name.trim() && !draft.tried ? "" : nameProblem(draft.name, (n) => nameTaken(n)));
    // From a filament (panel or drag) the template is set; from the big button the user picks one.
    function openNew(template) {
      if (readOnly.value) return;
      const pick = template && !template.orphan ? template : null;
      draft.templateId = pick ? pick.id : null;
      draft.picking = !pick;
      draft.query = "";
      draft.name = "";
      draft.tried = false;
      openPanel({ type: "new" }, pick ? "new-name" : "panel-title");
    }
    // A new own filament on top of tpl, switched on for the nozzles in view. On top of an own
    // filament it takes that one's template and copies its own values.
    function createOwn(tpl, name, own) {
      const s = store[inst.value.id];
      const e = {
        uid: ++uid, id: "user:" + name, kind: "user", name, brand: tpl.brand, material: tpl.material,
        colours: null, slots: {}, record: null,
        parent: tpl.kind === "user" ? tpl.parent : { id: tpl.id, name: tpl.name },
        orphan: false, template: tpl, fresh: true, example: false, own,
      };
      for (const p of Object.keys(tpl.slots)) e.slots[p] = name;
      s.created.push({ model: model.value.model, entry: e });
      for (const p of printers.value) if (e.slots[p]) s.bound.add(key(name, p));
      closedKinds.delete("user");
      return e;
    }
    function submitNew() {
      draft.tried = true;
      const tpl = draftTemplate.value;
      if (nameError.value || !tpl) return;
      const name = draft.name.trim();
      const e = createOwn(tpl, name, tpl.kind === "user" ? clone(ownOf(tpl)) : {});
      panel.value = { type: "details", id: e.id };
      flash(`„${name}“ angelegt`);
      nextTick(() => scrollToRow(e));
    }
    function removeOwn(e) {
      const s = store[inst.value.id];
      // By profile name, so the switches of other printer models go, too.
      const names = new Set(Object.values(e.slots));
      for (const k of [...s.bound]) if (names.has(k.slice(0, k.lastIndexOf("|")))) s.bound.delete(k);
      const idx = s.created.findIndex((c) => c.entry.id === e.id);
      if (idx >= 0 && !s.base.created.includes(s.created[idx])) {
        // Not written yet: it simply goes, with its edits.
        s.created.splice(idx, 1);
        delete s.edits[e.id];
      } else {
        s.deleted.add(e.id);
      }
      closePanel();
      flash(`„${e.name}“ gelöscht`);
    }

    // ------------------------------------------------------------ edit
    // Own filaments change in place; a manufacturer or library profile stays as it is and the
    // result becomes a new own filament on top of it (STAND, open task 2).
    let editSeq = 0;
    function openEdit(e) {
      if (readOnly.value || e.orphan) return;
      if (!panel.value) lastFocus = document.activeElement;
      panel.value = { type: "edit", id: e.id, seq: ++editSeq };
      nextTick(() => document.getElementById("edit-name")?.focus());
    }
    const editing = computed(() => {
      if (!panel.value || panel.value.type !== "edit") return null;
      const e = entries.value.find((x) => x.id === panel.value.id);
      if (!e) return null;
      const copy = e.kind !== "user", variant = copy ? templateProfile(e).variant : null;
      return {
        e, copy,
        name: copy ? freeName(e.name + " (eigen)") : e.name,
        own: copy ? {} : ownOf(e),
        base: Object.fromEntries(FIELDS.map((f) => [f.key, inheritedOf(e, f.key)])),
        templateName: !copy ? (e.parent ? e.parent.name : "")
          : e.name + (variant ? " · Düse " + nozzleLabel(variant) + " mm" : ""),
        taken: (n) => nameTaken(n, copy ? null : e.id),
      };
    });
    function saveEdit({ name, own }) {
      const ed = editing.value;
      if (!ed) return;
      const i = inst.value, s = store[i.id];
      let id = ed.e.id;
      if (ed.copy) {
        const e = createOwn(ed.e, name, own);
        id = e.id;
        flash(`„${name}“ angelegt`);
        nextTick(() => scrollToRow(e));
      } else {
        const init = initialOf(i, id), next = { name, own }, now = s.edits[id] || init;
        flash(now && stateKey(now) === stateKey(next) ? "Nichts geändert" : `„${name}“ geändert`);
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
      if (readOnly.value || e.orphan) return ev.preventDefault();
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
      if (target === "new") openNew(e);
      else switchOn(e, target === "on");
    }

    // ------------------------------------------------------------ changes
    // "alle Düsen" instead of every single nozzle; the printer name only when there are several.
    function whereText(i, names) {
      if (names.has(ALL_PRINTERS)) return "alle Drucker";
      const parts = [];
      for (const m of i.models) {
        const hit = m.printers.filter((p) => names.has(p.name));
        if (!hit.length) continue;
        const nz = hit.length === m.printers.length ? "alle Düsen"
          : "Düse " + hit.map((p) => nozzleLabel(p.variant)).join(" · ");
        parts.push(i.models.length > 1 ? printerShortName(m.printers[0].name) + " · " + nz : nz);
      }
      return parts.join("; ");
    }
    // Changes of all installations: one "Übernehmen" handles each with its own backup.
    const changes = computed(() => {
      const out = [];
      for (const i of INSTANCES) {
        const s = store[i.id];
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
        for (const a of agg.values()) out.push({ inst: i, type: a.type, name: a.name, where: whereText(i, a.printers) });
        for (const c of s.created) {
          if (s.base.created.includes(c) || s.deleted.has(c.entry.id)) continue;
          const now = s.edits[c.entry.id] || c.entry, count = Object.keys(now.own || {}).length;
          const where = [c.entry.parent ? "Vorlage: " + c.entry.parent.name : "",
            count ? plural(count, "eigener Wert", "eigene Werte") : ""].filter(Boolean).join(" · ");
          out.push({ inst: i, type: "new", name: now.name, where });
        }
        // Edited own profiles: a new name and changed values are two steps in the slicer, too.
        for (const id of new Set([...Object.keys(s.edits), ...Object.keys(s.base.edits)])) {
          if (s.deleted.has(id)) continue;
          const c = s.created.find((x) => x.entry.id === id);
          if (c && !s.base.created.includes(c)) continue;  // still new, listed above with its current name
          const init = initialOf(i, id);
          if (!init) continue;
          const before = s.base.edits[id] || init, now = s.edits[id] || init;
          if (before.name !== now.name) out.push({ inst: i, type: "rename", name: before.name, where: `in „${now.name}“` });
          const diff = FIELDS.filter((f) => !sameValue(before.own[f.key], now.own[f.key])).map((f) => changeText(f, now.own[f.key]));
          if (diff.length) out.push({ inst: i, type: "edit", name: now.name, where: diff.join(" · ") });
        }
        for (const n of deletedNames) {
          if (!s.base.deleted.has("user:" + n)) out.push({ inst: i, type: "delete", name: s.base.edits["user:" + n]?.name ?? n, where: "" });
        }
      }
      return out;
    });
    const changeGroups = computed(() => INSTANCES.map((i) => ({ inst: i, items: changes.value.filter((c) => c.inst === i) }))
      .filter((g) => g.items.length));
    const CHANGE = {
      on: { icon: "check", verb: "einschalten" }, off: { icon: "minus", verb: "ausschalten" },
      new: { icon: "plus", verb: "neu anlegen" }, delete: { icon: "trash", verb: "löschen" },
      rename: { icon: "pencil", verb: "umbenennen" }, edit: { icon: "pencil", verb: "ändern" },
    };
    function apply() {
      for (const g of changeGroups.value) {
        const s = store[g.inst.id];
        backupNow(g.inst, { kind: "change", reason: "vor „Filamente geändert“", detail: plural(g.items.length, "Änderung", "Änderungen") });
        s.base = {
          listed: new Set(s.listed), bound: new Set(s.bound), created: [...s.created], deleted: new Set(s.deleted),
          edits: clone(s.edits),
        };
      }
      closePanel();
      flash("Übernommen – im Entwurf wird aber nichts gespeichert.");
    }
    function discard() {
      for (const i of INSTANCES) {
        const s = store[i.id];
        s.listed = new Set(s.base.listed);
        s.bound = new Set(s.base.bound);
        s.created = [...s.base.created];
        s.deleted = new Set(s.base.deleted);
        s.edits = clone(s.base.edits);
      }
      if (panel.value) closePanel();
      flash("Änderungen verworfen");
    }

    const onKey = (ev) => { if (ev.key === "Escape" && panel.value && !dragSource) closePanel(); };
    onMounted(() => window.addEventListener("keydown", onKey));
    onUnmounted(() => window.removeEventListener("keydown", onKey));
    const activate = (ev, fn) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); fn(); } };
    const panelTitle = computed(() => panel.value && ({
      details: "Filament", new: "Neues Filament", apply: "Übernehmen", edit: "Bearbeiten",
    })[panel.value.type]);

    return {
      MATERIALS, store, inst, model, nozzle, printers, readOnly, printerTitle, nozzleText,
      query, materials, closedKinds, panel, dragging, draft,
      homeGroups, tree, shelf, detail, detailValues, detailPrinters, nozzleSwitches, scopeText, STATE_TEXT,
      draftTemplate, templateHits, templateError, PICK_LIMIT, pickTemplate, otherTemplate, nameError,
      changes, changeGroups, CHANGE, panelTitle, editing, openEdit, saveEdit, cancelEdit,
      nozzleLabel, colourOf, materialColour, shortName, subOf, kindTitle, isOn, activate, go, asset,
      brandOpen, toggleBrand, toggleKind, toggleMaterial, toggle, switchOn, toggleAt,
      openPanel, closePanel, openDetails, jumpTo, openNew, submitNew, removeOwn,
      dragStart, dragEnd, dragOver, drop, apply, discard, KIND_ICON,
    };
  },

  template: `
    <div :class="['page-host', { 'with-panel': panel }]">
      <!-- Screen 1: printer cards -->
      <div v-if="!model" class="page home">
        <h1 id="page-title" tabindex="-1">Welchen Drucker möchtest du bearbeiten?</h1>
        <section v-for="g in homeGroups" :key="g.inst.id" class="install" :aria-label="g.inst.slicer">
          <div class="install-head">
            <h2>{{ g.inst.slicer }}</h2>
            <span class="version">{{ g.inst.version }}</span>
            <span :class="['status', { 'status--busy': g.inst.running }]">{{ g.inst.running ? 'Läuft – nur ansehen' : 'Geschlossen' }}</span>
          </div>
          <div class="cards">
            <a v-for="c in g.cards" :key="c.idx" class="card" :href="'#/filamente/' + g.inst.id + '/' + c.idx"
               @click="go($event, '#/filamente/' + g.inst.id + '/' + c.idx)">
              <span class="card-img"><img :src="asset(c.m.cover)" alt="" width="170" height="170"></span>
              <span class="card-name">{{ c.name }}</span>
              <span v-if="c.sub" class="card-sub">{{ c.sub }}</span>
              <span class="card-meta"><nozzle-icon :sizes="[0.4]" :height="20"/><span class="sr-only">Düsen</span> {{ c.m.printers.map((p) => nozzleLabel(p.variant)).join(' · ') }} mm</span>
              <span class="card-spools" aria-hidden="true">
                <spool-icon v-for="e in c.active.slice(0, 9)" :key="e.uid" :colour="colourOf(e)" :size="28"/>
                <span v-if="c.active.length > 9">+{{ c.active.length - 9 }}</span>
              </span>
              <span class="card-meta">{{ c.active.length }} {{ c.active.length === 1 ? 'Filament' : 'Filamente' }} aktiv</span>
            </a>
          </div>
        </section>
        <p class="credits">
          Druckerbilder und Symbole aus OrcaSlicer
        </p>
      </div>

      <!-- Screen 2: one printer -->
      <div v-else class="page">
        <div class="printer-bar">
          <a class="btn" href="#/filamente" aria-label="Zurück zur Druckerauswahl" @click="go($event, '#/filamente')"><ui-icon name="back"/><span class="back-label">Alle Drucker</span></a>
          <img class="bar-img" :src="asset(model.cover)" alt="" width="48" height="48">
          <div class="bar-title">
            <h1 id="page-title" tabindex="-1">{{ printerTitle }}</h1>
            <span>{{ inst.slicer }} {{ inst.version }}</span>
          </div>
          <span :class="['status', { 'status--busy': inst.running }]">{{ inst.running ? 'Läuft – nur ansehen' : 'Geschlossen' }}</span>
        </div>
        <p v-if="readOnly" class="banner">{{ inst.slicer }} ist offen. Zum Ändern bitte den Slicer schließen.</p>

        <section class="box nozzles" aria-labelledby="nozzle-h">
          <h2 id="nozzle-h">Düse</h2>
          <div class="nozzle-row">
            <button type="button" class="nozzle-tile" :aria-pressed="nozzle === 'all'" @click="nozzle = 'all'">
              <nozzle-icon :sizes="[0.2, 0.4, 0.8]"/>Alle
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
            <h2 id="shelf-h">Aktiv</h2>
            <span class="count">{{ shelf.length }}</span>
            <span class="sub">Diese Filamente zeigt der Slicer · {{ nozzleText }}</span>
          </div>
          <ul v-if="shelf.length" class="shelf-grid">
            <li v-for="r in shelf" :key="r.e.uid" class="tile" :draggable="!readOnly"
                @dragstart="dragStart($event, r.e, 'shelf')" @dragend="dragEnd">
              <div class="tile-main" role="button" tabindex="0" :aria-current="panel && panel.id === r.e.id ? 'true' : null"
                   @click="openDetails(r.e)" @keydown="activate($event, () => openDetails(r.e, true))">
                <spool-icon :colour="colourOf(r.e)" :size="48"/>
                <span class="tile-name" :title="r.e.name">{{ shortName(r.e) }}</span>
                <span class="tile-sub">{{ subOf(r.e) }}<span v-if="r.e.pending" class="tile-changed">geändert</span><span v-else-if="r.st === 'some'" class="partly" :title="r.hint.text"> · teilweise</span><span v-if="r.e.example"> · Beispiel</span></span>
              </div>
              <button class="icon-btn tile-off" type="button" :aria-label="r.e.name + ' ausschalten'" :title="r.locked ? 'Mindestens ein Filament bleibt an.' : 'Ausschalten'"
                      :disabled="readOnly || r.locked" @click="switchOn(r.e, false)"><ui-icon :name="r.locked ? 'lock' : 'close'"/></button>
            </li>
          </ul>
          <p v-else class="empty">Noch nichts aktiv. Unten einschalten oder hierher ziehen.</p>
        </section>

        <section class="box" aria-label="Alle Filamente">
          <div class="toolbar">
            <label class="search">
              <ui-icon name="search"/>
              <input v-model="query" class="input" type="search" placeholder="Filament suchen" aria-label="Filament suchen">
            </label>
            <button class="btn btn-primary" type="button" :disabled="readOnly" @click="openNew()"><ui-icon name="plus"/>Neues Filament</button>
          </div>
          <div class="toolbar chips" role="group" aria-label="Material">
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
                  <span :class="['stand', { 'has-on': k.on }]">{{ k.on }} von {{ k.total }} aktiv</span>
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
                        <span :class="['stand', { 'has-on': g.on }]">{{ g.on }} von {{ g.total }}</span>
                      </button>
                    </h4>
                    <ul v-if="!g.label || brandOpen(g.key)" class="rows">
                      <li v-for="r in g.rows" :key="r.e.uid" :id="'row-' + r.e.uid"
                          :class="['row', 'is-' + (r.st === 'na' ? 'off' : r.st), { 'is-selected': panel && panel.id === r.e.id, 'is-fresh': r.e.fresh }]"
                          :draggable="!readOnly && !r.e.orphan" @dragstart="dragStart($event, r.e, 'tree')" @dragend="dragEnd">
                        <span class="grip" aria-hidden="true"><ui-icon name="grip"/></span>
                        <div class="row-main" role="button" tabindex="0" @click="openDetails(r.e)" @keydown="activate($event, () => openDetails(r.e, true))">
                          <spool-icon :colour="colourOf(r.e)" :size="28"/>
                          <span class="row-text">
                            <span class="row-name" :title="r.e.name">{{ shortName(r.e) }}</span>
                            <span v-if="r.hint" :class="['row-hint', r.hint.cls]">{{ r.hint.text }}</span>
                          </span>
                          <span v-if="r.e.example" class="tag-example" :title="r.e.kind === 'user' ? 'Nur im Entwurf, im Slicer gibt es dieses Filament nicht' : 'Nur im Entwurf eingeschaltet, als Beispiel'">Beispiel</span>
                          <span v-if="r.ownCount" class="badge">+{{ r.ownCount }} {{ r.ownCount === 1 ? 'eigenes' : 'eigene' }}</span>
                          <span v-if="r.e.material" class="mat">{{ r.e.material }}</span>
                        </div>
                        <span v-if="r.locked" class="lock" title="Mindestens ein Filament bleibt an."><ui-icon name="lock"/></span>
                        <button v-if="!r.e.orphan" class="switch" type="button" role="checkbox"
                                :aria-checked="r.st === 'on' ? 'true' : r.st === 'some' ? 'mixed' : 'false'"
                                :aria-label="r.e.name + ' aktiv'" :disabled="readOnly || r.locked" @click="toggle(r.e)"></button>
                        <span v-else class="switch-gap"></span>
                      </li>
                    </ul>
                  </div>
                  <p v-if="k.kind === 'user' && !k.total" class="no-hits">Noch keine eigenen Filamente.</p>
                  <p v-else-if="k.kind === 'user' && !k.groups[0].rows.length" class="no-hits">Keine Treffer.</p>
                </div>
              </template>
            </section>
            <p v-if="!tree.some((k) => k.hits)" class="no-hits">Nichts gefunden.</p>
          </div>
        </section>
      </div>
    </div>

    <div v-if="dragging" class="dock">
      <div v-if="dragging.from === 'tree'" class="dock-target" @dragover="dragOver($event, 'on')" @drop="drop($event, 'on')"><ui-icon name="check"/>Einschalten</div>
      <div v-else class="dock-target" @dragover="dragOver($event, 'off')" @drop="drop($event, 'off')"><ui-icon name="minus"/>Ausschalten</div>
      <div class="dock-target" @dragover="dragOver($event, 'new')" @drop="drop($event, 'new')"><ui-icon name="plus"/>Neues Filament daraus</div>
    </div>

    <aside v-if="panel" class="panel" aria-labelledby="panel-title">
      <div class="panel-head">
        <h2 id="panel-title" tabindex="-1">{{ panelTitle }}</h2>
        <button class="icon-btn" type="button" aria-label="Schließen" @click="closePanel"><ui-icon name="close"/></button>
      </div>
      <filament-editor v-if="editing" :key="panel.seq" :start-name="editing.name" :own="editing.own" :base="editing.base"
                       :copy="editing.copy" :template-name="editing.templateName" :material-colour="materialColour(editing.e)"
                       :name-taken="editing.taken" :scope-text="nozzleText" @save="saveEdit" @cancel="cancelEdit"/>
      <div v-else class="panel-body">
        <template v-if="panel.type === 'details'">
          <p v-if="!detail" class="note">Für diese Düse nicht vorhanden.</p>
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
                          :aria-label="detail.e.name + ' aktiv'" :disabled="readOnly || detail.locked || detail.st === 'na'" @click="toggle(detail.e)"></button>
                  <span :class="{ 'ch-on': detail.st === 'on' || detail.st === 'some' }">{{ STATE_TEXT[detail.st] }}</span>
                  <span v-if="detail.locked" class="lock" title="Mindestens ein Filament bleibt an."><ui-icon name="lock"/></span>
                </div>
              </div>
            </div>
            <p v-if="detail.e.example" class="note">
              <span class="tag-example">Beispiel</span>
              {{ detail.e.kind === 'user' ? 'Nur im Entwurf, im Slicer gibt es dieses Filament nicht.' : 'Nur im Entwurf eingeschaltet, als Beispiel.' }}
            </p>
            <p v-if="detail.e.orphan" class="alert">Die Vorlage fehlt. Der Slicer zeigt dieses Filament deshalb nicht an.</p>
            <p v-if="detail.e.parent" class="from">Vorlage: <button class="link" type="button" @click="jumpTo(detail.e.parent.id)">{{ detail.e.parent.name }}</button></p>

            <template v-if="detail.e.colours && detail.e.kind !== 'user'">
              <h3>Gibt es in</h3>
              <div class="swatches">
                <span v-for="c in detail.e.colours" :key="c.hex + c.name" class="swatch" :style="{ background: c.hex }" :title="c.name" role="img" :aria-label="c.name"></span>
              </div>
            </template>

            <h3>Werte</h3>
            <dl class="values">
              <div v-for="v in detailValues" :key="v.key" class="value">
                <ui-icon :name="v.icon"/>
                <dt>{{ v.label }}</dt>
                <dd>{{ v.text }}<span v-if="v.own" class="own-dot" title="selbst geändert"></span></dd>
              </div>
            </dl>
            <p v-if="detailValues.some((v) => v.own)" class="legend"><span class="own-dot"></span> selbst geändert, der Rest kommt von der Vorlage</p>

            <template v-if="nozzleSwitches">
              <h3>Aktiv bei Düse</h3>
              <div class="nz-toggles">
                <button v-for="p in detailPrinters" :key="p.name" class="nz-toggle" type="button" role="checkbox"
                        :aria-checked="isOn(inst, detail.e, p.name) ? 'true' : 'false'" :disabled="readOnly" @click="toggleAt(detail.e, p.name)">
                  <ui-icon :name="isOn(inst, detail.e, p.name) ? 'check' : 'box'"/>{{ nozzleLabel(p.variant) }} mm
                </button>
              </div>
            </template>
            <p v-else-if="scopeText" class="scope"><nozzle-icon :sizes="[0.4]" :height="20"/>{{ scopeText }}</p>

            <div class="actions">
              <button v-if="!detail.e.orphan" class="btn btn-primary" type="button" :disabled="readOnly" @click="openEdit(detail.e)"><ui-icon name="pencil"/>Bearbeiten</button>
              <button v-if="!detail.e.orphan" class="btn" type="button" :disabled="readOnly" @click="openNew(detail.e)"><ui-icon name="plus"/>Neues Filament daraus</button>
              <button v-if="detail.e.kind === 'user'" class="btn btn-danger right" type="button" :disabled="readOnly" @click="removeOwn(detail.e)"><ui-icon name="trash"/>Löschen</button>
            </div>
          </template>
        </template>

        <form v-else-if="panel.type === 'new'" @submit.prevent="submitNew" novalidate>
          <div v-if="draftTemplate && !draft.picking" class="hero">
            <spool-icon :colour="colourOf(draftTemplate)" :size="72"/>
            <div class="hero-text">
              <p class="hero-name">{{ draft.name.trim() || 'Neues Filament' }}</p>
              <p class="hero-sub">Vorlage: {{ draftTemplate.name }}</p>
              <button class="link" type="button" @click="otherTemplate">Andere Vorlage</button>
            </div>
          </div>
          <fieldset v-else class="picker" aria-describedby="tpl-error">
            <legend>Vorlage wählen</legend>
            <p class="note">Das neue Filament übernimmt alle Werte der Vorlage.</p>
            <h3 v-if="shelf.length">Aktiv</h3>
            <div v-if="shelf.length" class="pick-grid">
              <button v-for="r in shelf" :key="r.e.uid" type="button" class="pick" :aria-pressed="draft.templateId === r.e.id" :title="r.e.name" @click="pickTemplate(r.e)">
                <spool-icon :colour="colourOf(r.e)" :size="36"/>
                <span class="pick-name">{{ shortName(r.e) }}</span>
                <span class="pick-sub">{{ subOf(r.e) }}</span>
              </button>
            </div>
            <h3>Weitere</h3>
            <label class="search">
              <ui-icon name="search"/>
              <input id="tpl-search" v-model="draft.query" class="input" type="search" autocomplete="off" placeholder="Filament suchen" aria-label="Vorlage suchen">
            </label>
            <div v-if="templateHits.length" class="pick-grid pick-hits">
              <button v-for="e in templateHits.slice(0, PICK_LIMIT)" :key="e.uid" type="button" class="pick" :aria-pressed="draft.templateId === e.id" :title="e.name" @click="pickTemplate(e)">
                <spool-icon :colour="colourOf(e)" :size="36"/>
                <span class="pick-name">{{ shortName(e) }}</span>
                <span class="pick-sub">{{ subOf(e) }}</span>
              </button>
            </div>
            <p v-if="templateHits.length > PICK_LIMIT" class="note">{{ templateHits.length - PICK_LIMIT }} weitere – genauer suchen</p>
            <p v-else-if="draft.query.trim() && !templateHits.length" class="note">Nichts gefunden.</p>
            <p id="tpl-error" class="field-error" aria-live="polite">{{ templateError }}</p>
          </fieldset>
          <label class="field">
            <span>Name</span>
            <input id="new-name" v-model="draft.name" class="input" autocomplete="off"
                   :placeholder="draftTemplate ? draftTemplate.name + ' matt' : ''"
                   :aria-invalid="nameError ? 'true' : 'false'" aria-describedby="new-name-error">
          </label>
          <p id="new-name-error" class="field-error" aria-live="polite">{{ nameError }}</p>
          <p class="note">Aktiv für: {{ nozzleText }}.</p>
          <div class="actions">
            <button class="btn" type="button" @click="closePanel">Abbrechen</button>
            <button class="btn btn-primary right" type="submit">Anlegen</button>
          </div>
        </form>

        <template v-else-if="panel.type === 'apply'">
          <p v-if="!changes.length" class="note">Nichts zu übernehmen.</p>
          <div v-for="g in changeGroups" :key="g.inst.id">
            <h3>{{ g.inst.slicer }}</h3>
            <ul class="plain-list">
              <li v-for="(c, n) in g.items" :key="n">
                <span :class="'ch-' + c.type"><ui-icon :name="CHANGE[c.type].icon"/></span>
                <span class="grow"><strong>{{ c.name }}</strong> {{ CHANGE[c.type].verb }}<small v-if="c.where">{{ c.where }}</small></span>
              </li>
            </ul>
          </div>
          <p class="note">Vorher legt Orfix eine Sicherung an. Die kannst du jederzeit zurückholen.</p>
          <div class="actions">
            <button class="btn" type="button" @click="closePanel">Zurück</button>
            <button class="btn btn-primary right" type="button" :disabled="!changes.length" @click="apply">Übernehmen</button>
          </div>
        </template>
        <p v-else class="note">Dieses Filament gibt es nicht mehr.</p>
      </div>
    </aside>

    <div v-if="changes.length" :class="['changebar', { 'with-panel': panel }]">
      <span class="what">{{ changes.length }} {{ changes.length === 1 ? 'Änderung' : 'Änderungen' }}</span>
      <button class="btn" type="button" @click="discard">Verwerfen</button>
      <button class="btn btn-primary" type="button" @click="openPanel({ type: 'apply' })">Übernehmen …</button>
    </div>
  `,
};
