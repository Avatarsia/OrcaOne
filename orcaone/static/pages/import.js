// Page "Import/Export" (under "Filamente", orcaone/importer.py). Import: a file of any kind the
// Orca family writes goes to the backend, which says per profile what an import would do here;
// the user ticks what to take, it joins the change list, and "Übernehmen" writes it with plan and
// backup ("profile_import" in ops.js). Export: own profiles as a ZIP, as they are or complete.
import { INSTANCES, LOCALE, DECIMAL, flash, loadState, onReset, writeBlock } from "../common.js";
import { T, plainName } from "../texts.js";
import { api } from "../api.js";

const { ref, reactive, computed, watch } = Vue;
const I = T.importExport;
const KINDS = ["filament", "process", "machine"];
const KIND_ICON = { filament: "spool", process: "layers", machine: "printer" };
// Status as text plus colour: what can be taken, what needs a choice, what cannot.
const STATUS_CLASS = { new: "is-new", same: "is-same", name_taken: "is-choice", system_name: "is-choice", template: "is-same" };
const TAKES = new Set(["new", "same", "name_taken", "system_name"]);

// Profiles ticked and queued, per target installation; the change list and ops.js read them.
export const importQueue = reactive([]);
onReset(() => importQueue.splice(0));
export const importChanges = computed(() => importQueue.map((q) => {
  const inst = INSTANCES.find((i) => i.id === q.to);
  return inst ? { inst, page: "import", type: "import", name: plainName(q.name), where: q.replace ? I.replaces(q.source) : q.source } : null;
}).filter(Boolean));

const keyOf = (p) => `${p.kind}/${p.name}`;
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
    const file = ref(null);       // the File as picked; read again after every load
    const result = ref(null);     // POST /import
    const error = ref("");
    const reading = ref(false);
    const picked = reactive({});  // key -> { on, replace }
    const dragging = ref(false);
    let seq = 0;

    const errorText = (code) => I.errors[code] || T.errors[code] || T.errors.unknown;
    async function read() {
      if (!file.value) return;
      const mine = ++seq;
      reading.value = true;
      error.value = "";
      try {
        const got = await api.importFile(props.instId, file.value, file.value.name);
        if (mine !== seq) return;
        for (const k of Object.keys(picked)) delete picked[k];
        // Ticked at first: what lands as it is or under another name; not what is there already.
        for (const p of got.profiles) picked[keyOf(p)] = { on: p.status === "new" || p.status === "name_taken" || p.status === "system_name", replace: false };
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
      file.value = f;
      read();
    }
    const onPick = (ev) => { choose(ev.target.files[0]); ev.target.value = ""; };
    const onDrop = (ev) => { dragging.value = false; choose(ev.dataTransfer.files[0]); };
    // After "Übernehmen" or "Neu einlesen" the installation changed: the same file, analysed again.
    watch(() => [props.instId, loadState.version], read);

    const queuedHere = (p) => importQueue.some((q) => q.to === props.instId && keyOf(q) === keyOf(p));
    const groups = computed(() => KINDS.map((kind) => ({ kind, rows: (result.value?.profiles || []).filter((p) => p.kind === kind) }))
      .filter((g) => g.rows.length));
    const toQueue = computed(() => (result.value?.profiles || []).filter((p) => TAKES.has(p.status) && picked[keyOf(p)]?.on && !queuedHere(p)));
    function queue() {
      const count = toQueue.value.length;
      for (const p of toQueue.value) {
        importQueue.push({ to: props.instId, kind: p.kind, name: p.name, profile: p.profile, parents: p.parents, full: p.full,
                           replace: p.status === "name_taken" && picked[keyOf(p)].replace, source: result.value.file });
      }
      flash(I.queuedDone(count));
    }
    function statusText(p) {
      if (p.status === "parent_missing") return I.status.parent_missing;
      return I.status[p.status] || I.status.unknown_kind;
    }
    function detailText(p) {
      if (p.status === "parent_missing") return I.missingParent(p.params.parent);
      if (p.status === "no_target_printer") return I.noPrinter((p.params.printers || []).map(plainName).join(", "));
      if (p.status === "template") return I.template;
      if (!TAKES.has(p.status)) return "";
      const parts = [p.parent ? I.parent(plainName(p.parent)) : I.root];
      if (p.from_file.length) parts.push(I.fromFile(p.from_file.map(plainName)));
      if (p.kind !== "machine") parts.push(p.printers.length ? I.printers(p.printers.map(plainName).join(", ")) : I.allPrinters);
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
        const url = URL.createObjectURL(blob);
        const a = Object.assign(document.createElement("a"), { href: url, download: I.fileName(inst.value.slicer, new Date().toISOString().slice(0, 10)) });
        document.body.append(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        flash(I.exported);
      } catch (err) {
        flash(I.errors[err.code] || T.blocked[err.code]?.(inst.value, err.data || {}) || T.errors[err.code] || T.errors.unknown);
      } finally {
        exporting.value = false;
      }
    }

    return {
      T, I, KIND_ICON, STATUS_CLASS, TAKES, inst, block, file, result, error, reading, picked, dragging, onPick, onDrop, groups,
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
            <p v-if="foreignPrinter" class="note">{{ I.geometryOnly }}</p>
          </div>
          <p v-else-if="!result.profiles.length" class="empty">{{ I.none }}</p>
          <div v-for="g in groups" :key="g.kind" class="imp-group">
            <h3><ui-icon :name="KIND_ICON[g.kind]"/>{{ I.kindsTitle[g.kind] }}</h3>
            <ul class="imp-list">
              <li v-for="p in g.rows" :key="keyOf(p)" :class="{ 'is-off': !TAKES.has(p.status) }">
                <input type="checkbox" :aria-label="plainName(p.name)" :disabled="!TAKES.has(p.status) || queuedHere(p)"
                       :checked="queuedHere(p) || !!picked[keyOf(p)]?.on" @change="picked[keyOf(p)].on = $event.target.checked">
                <div class="imp-main">
                  <div class="imp-line">
                    <strong>{{ plainName(p.name) }}</strong>
                    <span :class="['imp-tag', STATUS_CLASS[p.status] || 'is-no']">{{ queuedHere(p) ? I.queued : statusText(p) }}</span>
                    <select v-if="p.status === 'name_taken' && !queuedHere(p)" class="input imp-choice" :value="picked[keyOf(p)].replace ? 'replace' : 'copy'"
                            @change="picked[keyOf(p)].replace = $event.target.value === 'replace'">
                      <option value="copy">{{ I.asCopy }}</option>
                      <option value="replace">{{ I.replace }}</option>
                    </select>
                  </div>
                  <small v-if="detailText(p)" class="imp-note">{{ detailText(p) }}</small>
                  <small v-if="valuesText(p)" class="imp-values">{{ valuesText(p) }}</small>
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
