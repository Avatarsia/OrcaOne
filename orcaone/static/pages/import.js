// Page "Import/Export" (under "Filamente", orcaone/importer.py). Import: a file of any kind the
// Orca family writes, or one of the slicer's own copies of user/ (user_backup-v…), goes to the
// backend, which says per profile what an import would do here;
// the user ticks what to take, it joins the change list, and "Übernehmen" writes it with plan and
// backup ("profile_import" in ops.js). Export: own profiles as a ZIP, as they are or complete.
import { INSTANCES, LOCALE, DECIMAL, flash, loadState, onReset, printerText, saveBlob, timeText, writeBlock } from "../common.js";
import { T, plainName } from "../texts.js";
import { api } from "../api.js";

const { ref, reactive, computed, watch } = Vue;
const I = T.importExport;
const KINDS = ["filament", "process", "machine"];
const KIND_ICON = { filament: "spool", process: "layers", machine: "printer" };
// Status as text plus colour: what can be taken, what needs a choice, what cannot. What is here
// already cannot be taken: it would only land a second time as a copy.
const STATUS_CLASS = { new: "is-new", same: "is-same", system_here: "is-same", name_taken: "is-choice", system_name: "is-choice", template: "is-same" };
const TAKES = new Set(["new", "name_taken", "system_name"]);

// Profiles ticked and queued, per target installation; the change list and ops.js read them.
export const importQueue = reactive([]);
onReset(() => importQueue.splice(0));
export const importChanges = computed(() => importQueue.map((q) => {
  const inst = INSTANCES.find((i) => i.id === q.to);
  return inst ? { inst, page: "import", type: "import", name: plainName(q.target || q.name), where: q.replace ? I.replaces(q.source) : q.source } : null;
}).filter(Boolean));

const keyOf = (p) => `${p.kind}/${p.name}`;
// What a filament hung onto a printer takes from the file (importer.MATERIAL_KEYS), as a few words.
const GROUPS = ["temps", "flow", "volumetric", "fans", "vendor", "type", "colour", "density", "cost", "diameter", "shrink", "support", "hardness", "other"];
const GROUP_OF = {
  filament_flow_ratio: "flow", filament_max_volumetric_speed: "volumetric", filament_vendor: "vendor", filament_type: "type",
  default_filament_colour: "colour", filament_density: "density", filament_cost: "cost", filament_diameter: "diameter",
  filament_shrink: "shrink", filament_shrinkage_compensation_z: "shrink", filament_soluble: "support", filament_is_support: "support",
  required_nozzle_HRC: "hardness",
};
const groupOf = (key) => GROUP_OF[key] || (key.includes("temp") ? "temps" : key.includes("fan") || key.startsWith("slow_down") ? "fans" : "other");
const groupsText = (keys) => GROUPS.filter((g) => keys.some((k) => groupOf(k) === g)).map((g) => I.groups[g]).join(", ");
// The name up to "@", by which the slicers group profiles (alias_of in scanner.py).
const aliasOf = (name) => (name.includes("@") ? name.slice(0, name.indexOf("@")).trimEnd() : "") || name;
const nozzles = (variant) => String(variant).split("+").map(Number);  // "0.4+0.6": a U1 with two kinds
const number = (v, digits) => isNaN(Number(v)) ? String(v) : Number(v).toLocaleString(LOCALE, { maximumFractionDigits: digits });
// The values of a row: temperature, flow, max. volumetric speed, material and maker; for a process
// layer height, walls and infill; for a printer model and nozzle.
function valuesText(p) {
  const v = p.values || {};
  const out = [];
  if (v.nozzle_temperature) out.push(`${number(v.nozzle_temperature, 0)} °C`);
  if (v.filament_flow_ratio) out.push(I.flow(number(v.filament_flow_ratio, 3)));
  if (v.filament_max_volumetric_speed) out.push(`${number(v.filament_max_volumetric_speed, 1)} mm³/s`);
  if (v.layer_height) out.push(`${number(v.layer_height, 2)} mm`);
  if (v.wall_loops) out.push(I.walls(number(v.wall_loops, 0)));
  if (v.sparse_infill_density) out.push(I.infill(v.sparse_infill_density));
  if (v.nozzle_diameter) out.push(I.nozzle(String(v.nozzle_diameter).replace(".", DECIMAL)));
  for (const k of ["filament_type", "filament_vendor", "printer_model"]) if (v[k]) out.push(v[k]);
  return out.join(" · ");
}

export default {
  name: "ImportPage",
  props: { instId: { type: String, required: true } },

  setup(props) {
    const inst = computed(() => INSTANCES.find((i) => i.id === props.instId));
    const block = computed(() => inst.value ? writeBlock(inst.value) : null);

    // ------------------------------------------------------------ import
    const source = ref(null);     // { file } as picked or dropped, or { backup } by name; read again after every load
    const result = ref(null);     // POST /import, GET /import/slicer-backup
    const error = ref("");
    const reading = ref(false);
    const picked = reactive({});  // key -> { on, replace, name }
    const attached = reactive({}); // key -> { printer, ...what the backend says of it hung onto that printer }
    const dragging = ref(false);
    let seq = 0;

    const errorText = (code) => I.errors[code] || T.errors[code] || T.errors.unknown;
    async function read() {
      const from = source.value;
      if (!from) return;
      const mine = ++seq;
      reading.value = true;
      error.value = "";
      try {
        const got = from.file ? await api.importFile(props.instId, from.file, from.file.name)
          : await api.importSlicerBackup(props.instId, from.backup);
        if (mine !== seq) return;
        for (const k of Object.keys(picked)) delete picked[k];
        for (const k of Object.keys(attached)) delete attached[k];
        // Ticked at first: what lands as it is or under another name; not what is there already.
        // name: null until the user types another one.
        for (const p of got.profiles) picked[keyOf(p)] = { on: TAKES.has(p.status), replace: false, name: null };
        result.value = got;
      } catch (err) {
        if (mine === seq) {
          result.value = null;
          error.value = errorText(err.code);
        }
      } finally {
        if (mine === seq) reading.value = false;
      }
    }
    function choose(f) {
      if (!f) return;
      source.value = { file: f };
      read();
    }
    // The slicer copies user/ at the first start of every new version (FINDINGS 4.2).
    const backups = ref([]);
    api.slicerBackups(props.instId).then((got) => { backups.value = got.backups; }).catch(() => {});
    const readBackup = (name) => { source.value = { backup: name }; read(); };
    const onPick = (ev) => { choose(ev.target.files[0]); ev.target.value = ""; };
    const onDrop = (ev) => { dragging.value = false; choose(ev.dataTransfer.files[0]); };
    // After "Übernehmen" or "Neu einlesen" the installation changed: the same file, analysed again.
    watch(() => [props.instId, loadState.version], read);

    const queuedHere = (p) => importQueue.some((q) => q.to === props.instId && keyOf(q) === keyOf(p));
    const groups = computed(() => KINDS.map((kind) => ({ kind, rows: (result.value?.profiles || []).filter((p) => p.kind === kind) }))
      .filter((g) => g.rows.length));
    // A row as it would land: hung onto a printer (attached) it says what the backend said then.
    const view = (p) => ({ ...p, ...(attached[keyOf(p)] || {}) });
    const target = (p) => view(p).target || p.name;
    // A name the user typed that differs from the one it would get.
    const renamed = (p) => { const n = picked[keyOf(p)]?.name; return n != null && n.trim() !== target(p); };
    const nameOk = (p) => !renamed(p) || !!picked[keyOf(p)].name.trim();
    const toQueue = computed(() => (result.value?.profiles || []).filter((p) => TAKES.has(view(p).status) && picked[keyOf(p)]?.on
      && !queuedHere(p) && nameOk(p)));
    function queue() {
      const count = toQueue.value.length;
      for (const p of toQueue.value) {
        const key = keyOf(p), pick = picked[key];
        importQueue.push({ to: props.instId, kind: p.kind, name: p.name, profile: p.profile, parents: p.parents, full: p.full,
                           replace: view(p).status === "name_taken" && !renamed(p) && pick.replace, source: result.value.file,
                           printer: attached[key]?.printer || "", rename: renamed(p) ? pick.name.trim() : "",
                           target: renamed(p) ? pick.name.trim() : target(p) });
      }
      flash(I.queuedDone(count));
    }

    // "An Drucker hängen": a filament of the file onto a printer here, as the child of one of its
    // filaments with only the material's values (importer.attach). Every source, also a filament the
    // file made for a printer that is not here.
    const canAttach = (p) => p.kind === "filament" && !["same", "system_here", "template"].includes(p.status);
    const printerOptions = computed(() => (inst.value?.models || []).flatMap((m) => m.printers)
      .map((pr) => ({ name: pr.name, label: printerText(inst.value, pr.name) })));
    async function attachTo(p, printer) {
      const key = keyOf(p);
      if (!printer) {
        delete attached[key];
        picked[key] = { on: TAKES.has(p.status), replace: false, name: null };
        return;
      }
      try {
        const got = await api.importAttach(props.instId, { profile: p.profile, parents: p.parents, printer });
        attached[key] = { params: {}, ...got, printer };
        picked[key] = { on: TAKES.has(got.status), replace: false, name: null };
      } catch (err) {
        flash(errorText(err.code));
      }
    }

    function statusText(p) {
      if (renamed(p)) return I.status.renamed;
      return I.status[view(p).status] || I.status.unknown_kind;
    }
    const tagClass = (p) => (renamed(p) ? "is-new" : STATUS_CLASS[view(p).status] || "is-no");
    function detailText(p) {
      const v = view(p);
      if (v.status === "parent_missing") return I.missingParent(v.params.parent);
      if (v.status === "no_target_printer") return I.noPrinter((v.params.printers || []).map(plainName).join(", "));
      if (v.status === "no_base" || v.status === "unknown_printer") return T.blocked[v.status](inst.value, v.params);
      if (v.status === "template") return I.template;
      if (v.status === "system_here") return I.systemHere;
      if (!TAKES.has(v.status)) return "";
      const parts = [v.parent ? I.parent(plainName(v.parent)) : I.root];
      if (!attached[keyOf(p)] && p.from_file.length) parts.push(I.fromFile(p.from_file.map(plainName)));
      if (p.kind !== "machine") parts.push(v.printers.length ? I.printers(v.printers.map(plainName).join(", ")) : I.allPrinters);
      if (attached[keyOf(p)]) parts.push(v.taken.length ? I.takes(groupsText(v.taken)) : I.takesNothing);
      return parts.join(" · ");
    }

    // A 3MF: the profiles the project uses, and for those not here what fits instead: the printers
    // with its nozzle, their processes with its layer height, and the filaments these printers show
    // under the same name up to "@", hidden ones marked (the page "Filamente" can show them).
    const uses = computed(() => {
      const project = result.value?.project, i = inst.value;
      if (!project || !i) return [];
      const printers = i.models.flatMap((m) => m.printers).filter((p) => nozzles(p.variant).includes(Number(project.nozzle)));
      const processes = new Set(printers.flatMap((p) => p.processes));
      function fitting(u) {
        if (u.here) return [];
        if (u.kind === "machine") return printers.map((p) => ({ name: p.name }));
        if (u.kind === "process") {
          return i.processes.filter((p) => processes.has(p.name) && Number(p.layer_height) === Number(u.values.layer_height))
            .map((p) => ({ name: p.name }));
        }
        return i.filaments.filter((f) => f.alias === aliasOf(u.name)).map((f) => {
          const states = printers.map((p) => f.printers[p.name]?.status);
          return states.includes("visible") ? { name: f.name } : states.includes("hidden") ? { name: f.name, hidden: true } : null;
        }).filter(Boolean);
      }
      return project.uses.map((u) => ({ ...u, fitting: fitting(u) }));
    });
    const fittingText = (u) => I.fitting(u.fitting.map((f) => plainName(f.name) + (f.hidden ? ` (${I.hiddenHere})` : "")).join(", "));
    const foreignPrinter = computed(() => uses.value.some((u) => u.kind === "machine" && !u.here));

    // ------------------------------------------------------------ export
    const own = computed(() => {
      const i = inst.value;
      if (!i) return [];
      const rows = [
        ...i.filaments.filter((f) => f.origin_kind === "user").map((f) => ({ kind: "filament", name: f.name })),
        ...i.processes.filter((p) => p.origin_kind === "user").map((p) => ({ kind: "process", name: p.name })),
        ...i.printers_page.own.map((p) => ({ kind: "machine", name: p.name })),
      ];
      return KINDS.map((kind) => ({ kind, rows: rows.filter((r) => r.kind === kind).sort((a, b) => a.name.localeCompare(b.name, LOCALE)) }))
        .filter((g) => g.rows.length);
    });
    const exportPicked = reactive(new Set());
    const flat = ref(false);
    const exporting = ref(false);
    const toggleGroup = (g) => {
      const all = g.rows.every((r) => exportPicked.has(keyOf(r)));
      for (const r of g.rows) all ? exportPicked.delete(keyOf(r)) : exportPicked.add(keyOf(r));
    };
    async function exportNow() {
      exporting.value = true;
      try {
        const wanted = own.value.flatMap((g) => g.rows).filter((r) => exportPicked.has(keyOf(r)));
        const blob = await api.exportProfiles(props.instId, wanted.map(({ kind, name }) => ({ kind, name })), flat.value);
        saveBlob(blob, I.fileName(inst.value.slicer, new Date().toISOString().slice(0, 10)));
        flash(I.exported);
      } catch (err) {
        flash(I.errors[err.code] || T.blocked[err.code]?.(inst.value, err.data || {}) || T.errors[err.code] || T.errors.unknown);
      } finally {
        exporting.value = false;
      }
    }

    return {
      T, I, KIND_ICON, STATUS_CLASS, TAKES, inst, block, result, error, reading, picked, dragging, onPick, onDrop, groups,
      attached, view, target, renamed, canAttach, printerOptions, attachTo, tagClass,
      backups, readBackup, timeText,
      toQueue, queue, queuedHere, keyOf, statusText, detailText, valuesText, uses, fittingText, foreignPrinter, own, exportPicked,
      flat, exporting, toggleGroup, exportNow, plainName,
    };
  },

  template: `
    <div class="page import-page">
      <h1 id="page-title" tabindex="-1">{{ I.title }}</h1>
      <p class="note">{{ I.lead }}</p>

      <section class="box">
        <div class="box-head"><h2>{{ I.importTitle }}</h2></div>
        <label :class="['imp-drop', { 'is-over': dragging }]" @dragover.prevent="dragging = true" @dragleave="dragging = false" @drop.prevent="onDrop">
          <ui-icon name="import" :size="28"/>
          <span><strong>{{ I.pick }}</strong> {{ I.drop }}</span>
          <small>{{ I.kinds }}</small>
          <input type="file" accept=".json,.zip,.orca_filament,.orca_printer,.orca_bundle,.3mf" @change="onPick">
        </label>
        <div v-if="backups.length" class="imp-backups">
          <p class="note">{{ I.slicerBackups }}</p>
          <ul class="imp-backup-list">
            <li v-for="b in backups" :key="b.name">
              <ui-icon name="backup"/>
              <span><strong>{{ b.name }}</strong> <small class="imp-note">{{ I.slicerBackup(timeText(new Date(b.modified * 1000)), b.profiles) }}</small></span>
              <button class="btn" type="button" :disabled="!b.profiles || reading" @click="readBackup(b.name)">{{ I.readBackup }}</button>
            </li>
          </ul>
        </div>
        <details class="more imp-help">
          <summary>{{ I.help }}</summary>
          <ul><li v-for="t in I.helpItems" :key="t">{{ t }}</li></ul>
        </details>
        <p v-if="reading" class="note">{{ I.reading }}</p>
        <p v-else-if="error" class="alert" role="alert">{{ error }}</p>
        <template v-else-if="result">
          <p class="imp-found"><strong>{{ result.file }}</strong> · {{ I.formats[result.format] }} · {{ I.found(result.profiles.length) }}
            <span v-if="result.skipped.length" class="imp-note" :title="result.skipped.map((s) => s.where + ': ' + (I.skipped[s.code] || s.code)).join('\\n')">
              · {{ I.skippedCount(result.skipped.length) }}</span></p>
          <div v-if="result.project" class="imp-project">
            <p>{{ result.project.application ? I.project(result.project.application) : I.projectUses }}</p>
            <ul class="imp-uses">
              <li v-for="u in uses" :key="u.kind + '/' + u.name">
                <ui-icon :name="KIND_ICON[u.kind]"/>
                <div class="imp-main">
                  <div class="imp-line">
                    <span>{{ plainName(u.name) }}</span>
                    <span v-if="u.colours" class="imp-spools" role="img" :aria-label="u.colours.join(', ')" :title="u.colours.join(', ')">
                      <spool-icon v-for="(c, n) in u.colours" :key="n" :colour="c" :size="18"/></span>
                    <small :class="u.here ? 'st-on' : 'st-warn'">{{ u.here ? I.here : I.notHere }}</small>
                  </div>
                  <small v-if="valuesText(u)" class="imp-values">{{ valuesText(u) }}</small>
                  <small v-if="u.fitting.length" class="imp-note">{{ fittingText(u) }}</small>
                </div>
              </li>
            </ul>
            <p v-if="!result.profiles.length" class="note">{{ I.onlySystem }}</p>
            <p v-if="foreignPrinter" class="note">{{ I.projectPrinter }}</p>
          </div>
          <p v-else-if="!result.profiles.length" class="empty">{{ I.none }}</p>
          <div v-for="g in groups" :key="g.kind" class="imp-group">
            <h3><ui-icon :name="KIND_ICON[g.kind]"/>{{ I.kindsTitle[g.kind] }}</h3>
            <ul class="imp-list">
              <li v-for="p in g.rows" :key="keyOf(p)" :class="{ 'is-off': !TAKES.has(view(p).status) }">
                <input type="checkbox" :aria-label="plainName(p.name)" :disabled="!TAKES.has(view(p).status) || queuedHere(p)"
                       :checked="queuedHere(p) || !!picked[keyOf(p)]?.on" @change="picked[keyOf(p)].on = $event.target.checked">
                <div class="imp-main">
                  <div class="imp-line">
                    <strong>{{ plainName(p.name) }}</strong>
                    <span :class="['imp-tag', tagClass(p)]">{{ queuedHere(p) ? I.queued : statusText(p) }}</span>
                    <select v-if="view(p).status === 'name_taken' && !renamed(p) && !queuedHere(p)" class="input imp-choice"
                            :value="picked[keyOf(p)].replace ? 'replace' : 'copy'" @change="picked[keyOf(p)].replace = $event.target.value === 'replace'">
                      <option value="copy">{{ I.asCopy }}</option>
                      <option value="replace">{{ I.replace }}</option>
                    </select>
                  </div>
                  <div v-if="!queuedHere(p) && (TAKES.has(view(p).status) || canAttach(p))" class="imp-edit">
                    <label v-if="TAKES.has(view(p).status)" class="imp-field"><span>{{ I.newName }}</span>
                      <input class="input imp-name" type="text" spellcheck="false" :value="picked[keyOf(p)].name ?? plainName(target(p))"
                             @input="picked[keyOf(p)].name = $event.target.value"></label>
                    <label v-if="canAttach(p)" class="imp-field"><span>{{ I.attachTo }}</span>
                      <select class="input" :value="attached[keyOf(p)]?.printer || ''" @change="attachTo(p, $event.target.value)">
                        <option value="">{{ TAKES.has(p.status) ? I.asInFile : I.choosePrinter }}</option>
                        <option v-for="o in printerOptions" :key="o.name" :value="o.name">{{ o.label }}</option>
                      </select></label>
                  </div>
                  <small v-if="detailText(p)" class="imp-note">{{ detailText(p) }}</small>
                  <small v-if="valuesText(view(p))" class="imp-values">{{ valuesText(view(p)) }}</small>
                  <small class="imp-where">{{ p.where }}</small>
                </div>
              </li>
            </ul>
          </div>
          <div v-if="result.profiles.length" class="imp-actions">
            <p v-if="block" class="note">{{ T.blocked[block](inst) }}</p>
            <button class="btn btn-primary" type="button" :disabled="!toQueue.length" @click="queue"><ui-icon name="plus"/>{{ I.queue(toQueue.length) }}</button>
          </div>
        </template>
      </section>

      <section class="box">
        <div class="box-head"><h2>{{ I.exportTitle }}</h2></div>
        <p class="note">{{ I.exportLead }}</p>
        <p v-if="!own.length" class="empty">{{ I.noneOwn }}</p>
        <template v-else>
          <div v-for="g in own" :key="g.kind" class="imp-group">
            <h3><ui-icon :name="KIND_ICON[g.kind]"/>{{ I.kindsTitle[g.kind] }}
              <button class="link imp-all" type="button" @click="toggleGroup(g)">{{ I.all }}</button></h3>
            <div class="imp-export">
              <label v-for="r in g.rows" :key="keyOf(r)" class="imp-pick">
                <input type="checkbox" :checked="exportPicked.has(keyOf(r))"
                       @change="$event.target.checked ? exportPicked.add(keyOf(r)) : exportPicked.delete(keyOf(r))">{{ plainName(r.name) }}
              </label>
            </div>
          </div>
          <button type="button" class="compare-toggle" role="switch" :aria-checked="flat ? 'true' : 'false'" @click="flat = !flat">
            <span class="switch" aria-hidden="true"></span>{{ I.flat }}
          </button>
          <div class="imp-actions">
            <button class="btn btn-primary" type="button" :disabled="!exportPicked.size || exporting" @click="exportNow">
              <ui-icon name="export"/>{{ I.exportButton(exportPicked.size) }}</button>
          </div>
        </template>
      </section>
    </div>
  `,
};
