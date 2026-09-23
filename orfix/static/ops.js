// The one place that turns what the pages collected into the "changes" of POST /plan
// (orfix/app.py): the switches, new and edited filaments of the page "Filamente" (`store` in
// pages/filamente.js), and the printers, the clean-up and the hidden list entries of the pages
// "Drucker" and "Slicer" (`live` in common.js). One list per installation, in the order the
// backend applies it: new files, changed files, renames, the "filaments" list, deletions, and
// the other .conf entries last. Every op names profiles as they are on disk.
import { FIELDS, live, profileInfo, unusedListNames } from "./common.js";
import { store, initialOf, sameValue } from "./pages/filamente.js";
import { queued } from "./pages/transfer.js";

const ORDER = [
  "profile_copy", "filament_create", "filament_bind", "filament_update", "filament_rename", "filament_visible",
  "filament_delete", "printer_model_off", "printer_delete", "default_printer", "cleanup_presets",
];

// A value with a second one for the high-flow hotend of Snapmaker Orca goes out as both
// (FINDINGS 4.4). A single value goes out as a string: the backend shapes it like the inherited
// one and keeps a high-flow value it does not replace (operations.py, _shape).
const asValue = (x) => x.high_flow !== undefined ? [String(x.value), String(x.high_flow)] : String(x.value);
function valuesOf(own) {
  const out = {};
  for (const [k, x] of Object.entries(own || {})) out[k] = asValue(x);
  return out;
}

// Printers of the switch keys "<profile>|<printer>" that belong to one profile.
function boundAt(keys, name) {
  const out = new Set();
  for (const k of keys) {
    const cut = k.lastIndexOf("|");
    if (k.slice(0, cut) === name) out.add(k.slice(cut + 1));
  }
  return out;
}
const sameSet = (a, b) => a.size === b.size && [...a].every((x) => b.has(x));
const visibleAt = (f) => Object.keys(f.printers).filter((p) => f.printers[p].status === "visible");

// compatible_printers of an own profile that goes off at `off` and stays or goes on at `on`.
// An empty list means "every printer" to the slicer (FINDINGS 4.6), so without a list of its own
// it starts from the printers it shows today. `on` goes in by name: an own printer may fit only
// through its parent, which can be the printer that goes off (FINDINGS 4.6, rule 3). Printers
// that are not set up stay in the list.
function printerList(f, off, on) {
  const list = new Set(f.compatible_printers.length ? f.compatible_printers : visibleAt(f));
  off.forEach((p) => list.delete(p));
  on.forEach((p) => list.add(p));
  return [...list].sort();
}

// Name of the helper profile that unlocks a library filament for single nozzles in Snapmaker
// Orca: "<short name> @<printer model>". The name is a file name as well: characters Windows
// forbids in one become "-" (the backend refuses them with name_invalid).
const helperName = (alias, model) => `${alias} @${model}`.replace(/[<>:"\/\\|?*\u0000-\u001f]/g, "-");

// A library filament in Snapmaker Orca, switched per printer on the page "Filamente". On at all
// nozzles of the printer models it is on at, and without helpers: an entry in the "filaments"
// list (way A); it then shows at every printer. Otherwise own helper profiles with inherits on
// it, one per printer model (way B, FINDINGS 4.7): a helper on disk keeps the printers that stay
// on and takes the new ones of its model, the rest gets a new one. Way A is lost when the wizard
// runs, way B stays.
function libraryOps(inst, s, f, gone, add, printersOf, deleted) {
  const keep = (set) => new Set([...set].filter((p) => !gone.has(p)));
  const before = keep(boundAt(s.base.bound, f.name)), after = keep(boundAt(s.bound, f.name));
  if (sameSet(before, after)) return;
  const fits = new Set(Object.keys(f.printers).filter((p) => f.printers[p].status !== "displaced" && !gone.has(p)));
  const everywhere = fits.size > 0 && [...fits].every((p) => after.has(p));
  const fitsOf = (m) => m.printers.map((p) => p.name).filter((p) => fits.has(p));
  const touched = inst.models.filter((m) => fitsOf(m).some((p) => after.has(p)));
  const wholeModels = touched.length > 0 && touched.every((m) => fitsOf(m).every((p) => after.has(p)));
  const helpers = inst.filaments.filter((h) => h.helper && h.chain[0] === f.name && !deleted.has(h.name));
  if (f.in_list) {
    if (everywhere) return;
    add({ op: "filament_visible", name: f.name, visible: false });
  } else if (wholeModels && !helpers.length) {
    add({ op: "filament_visible", name: f.name, visible: true });
    return;
  }
  const modelOf = (p) => inst.models.find((m) => m.printers.some((x) => x.name === p))?.model || p;
  const byHelper = new Map(), covered = new Set();
  for (const h of helpers) {
    const had = visibleAt(h).filter((p) => !gone.has(p));
    const stays = had.filter((p) => after.has(p));
    stays.forEach((p) => covered.add(p));
    byHelper.set(h.name, { h, off: had.filter((p) => !after.has(p)), on: stays, grows: false });
  }
  const fresh = new Map();
  for (const p of after) {
    if (covered.has(p)) continue;
    const name = helperName(f.alias, modelOf(p)), mine = byHelper.get(name);
    if (mine) {
      mine.on.push(p);
      mine.grows = true;
    } else {
      fresh.set(name, [...(fresh.get(name) || []), p]);
    }
  }
  for (const { h, off, on, grows } of byHelper.values()) {
    if (!off.length && !grows) continue;
    const list = printerList(h, off, on);
    if (list.length) printersOf.set(h.name, list);
    else {
      add({ op: "filament_delete", name: h.name });
      deleted.add(h.name);
    }
  }
  for (const [name, printers] of fresh) add({ op: "filament_bind", base: f.name, name, printers: printers.sort() });
}

// All pending changes of one installation as ops; [] when there are none.
export function changesOf(inst) {
  const s = store[inst.id], now = live[inst.id], was = inst.initial;
  if (!s || !now) return [];
  const out = [];
  const add = (op) => out.push(op);
  const deleted = new Set();      // own profiles that go, by their name on disk
  const gone = new Set();         // printers that go
  const printersOf = new Map();   // own profile -> its new compatible_printers

  // ---------------------------------------------------------- pages "Drucker" and "Slicer"
  const pp = inst.printers_page;
  for (const m of pp.system) {
    if (!was.models.has(m.model) || now.models.has(m.model)) continue;
    // Only whole models: Snapmaker Orca switches all nozzles of a model back on (FINDINGS 4.6).
    add({ op: "printer_model_off", vendor: m.origin, model: m.model });
    m.printers.forEach((p) => gone.add(p.name));
  }
  for (const p of pp.own) {
    if (!was.own.has(p.name) || now.own.has(p.name)) continue;
    const along = p.only_here.map((x) => x.name).filter((n) => !now.own.has(n));
    add({ op: "printer_delete", name: p.name, with: along });
    gone.add(p.name);
    [p.name, ...along].forEach((n) => deleted.add(n));
  }
  // Own filaments ticked under "Mitlöschen" of a manufacturer's model.
  for (const n of was.own) {
    if (now.own.has(n) || deleted.has(n) || profileInfo(inst, n).kind !== "filament") continue;
    add({ op: "filament_delete", name: n });
    deleted.add(n);
  }
  if (now.defaultPrinter && now.defaultPrinter !== was.defaultPrinter) add({ op: "default_printer", printer: now.defaultPrinter });
  const cleaned = was.dead.filter((d) => !now.dead.includes(d));
  if (cleaned.length) add({ op: "cleanup_presets", machines: cleaned });

  // ---------------------------------------------------------- page "Filamente"
  for (const id of s.deleted) {
    const n = id.slice("user:".length);
    if (deleted.has(n)) continue;
    add({ op: "filament_delete", name: n });
    deleted.add(n);
  }

  // The "filaments" list: manufacturer profiles, and the library in OrcaSlicer.
  const visible = new Map();
  for (const n of new Set([...s.listed, ...s.base.listed])) {
    if (s.listed.has(n) !== s.base.listed.has(n)) visible.set(n, s.listed.has(n));
  }
  if (now.hideUnused) for (const n of unusedListNames(inst)) if (!visible.has(n)) visible.set(n, false);

  // Per-printer switches: the library in Snapmaker Orca and own profiles on disk. New ones take
  // their printers along in filament_create below.
  const createdNames = new Set(s.created.map((c) => c.entry.name));
  const switched = new Set();
  for (const k of new Set([...s.bound, ...s.base.bound])) {
    if (s.bound.has(k) !== s.base.bound.has(k)) switched.add(k.slice(0, k.lastIndexOf("|")));
  }
  for (const n of switched) {
    const f = inst.byName.get(n);
    if (!f || createdNames.has(n) || deleted.has(n)) continue;
    if (f.origin_kind === "library") {
      if (inst.snorca) libraryOps(inst, s, f, gone, add, printersOf, deleted);
      continue;
    }
    if (f.origin_kind !== "user") continue;
    const before = boundAt(s.base.bound, n), after = boundAt(s.bound, n);
    const list = printerList(f, [...before].filter((p) => !after.has(p)), after);
    // The page keeps one printer on (pages/filamente.js); an empty list would mean "every printer".
    if (list.length) printersOf.set(n, list);
  }

  // New own filaments. They inherit the template's printer list (printers null) while their
  // switches match the template on the printers the page showed: the model the filament was made
  // on, and wherever it was switched on since. Printers elsewhere then stay as the template has
  // them, e.g. an own printer that fits through its parent. Otherwise the switched printers
  // become its own list.
  for (const c of s.created) {
    const e = c.entry, cur = s.edits[e.id] || e;
    const on = boundAt(s.bound, e.name);
    const base = inst.byName.get(e.base);
    const model = inst.models.find((m) => m.model === c.model);
    const seen = new Set([...(model ? model.printers.map((p) => p.name) : []), ...on]);
    const inherits = !on.size || (!!base && sameSet(on, new Set(visibleAt(base).filter((p) => seen.has(p)))));
    add({ op: "filament_create", base: e.base, name: cur.name, values: valuesOf(cur.own), printers: inherits ? null : [...on].sort() });
  }

  // Changed own filaments on disk: values, the printer list from the switches, then the new name.
  const createdIds = new Set(s.created.map((c) => c.entry.id));
  const changed = new Set(printersOf.keys());
  for (const id of Object.keys(s.edits)) if (!createdIds.has(id)) changed.add(id.slice("user:".length));
  for (const n of changed) {
    if (deleted.has(n)) continue;
    const init = initialOf(inst, "user:" + n), ed = s.edits["user:" + n];
    if (!init) continue;
    const values = {}, reset = [];
    if (ed) {
      for (const f of FIELDS) {
        const a = init.own[f.key], b = ed.own[f.key];
        if (sameValue(a, b)) continue;
        if (b) values[f.key] = asValue(b);
        else reset.push(f.key);
      }
    }
    if (printersOf.has(n)) values.compatible_printers = printersOf.get(n);
    if (Object.keys(values).length || reset.length) add({ op: "filament_update", name: n, values, reset });
    if (ed && ed.name !== init.name) add({ op: "filament_rename", name: n, new_name: ed.name });
  }
  for (const [name, on] of visible) add({ op: "filament_visible", name, visible: on });

  // ---------------------------------------------------------- page "Übertragen"
  for (const q of queued) if (q.to === inst.id) add({ op: "profile_copy", from: q.from, kind: q.kind, name: q.name });

  // Array.prototype.sort is stable: the order within one kind of op stays.
  return out.sort((a, b) => ORDER.indexOf(a.op) - ORDER.indexOf(b.op));
}
