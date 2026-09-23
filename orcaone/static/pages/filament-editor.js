// Form for one filament, shown in the side panel of the page "Filamente". It is the only way
// to change or create a filament: "edit" changes an own one, "copy" saves a manufacturer or
// library profile as an own one, "new" creates one on top of a template.
// The fields come from editable_fields of GET /api/data (FIELDS in common.js). An empty field
// takes the value of the template, shown grey as placeholder; a typed value that differs from it
// counts as changed. The form only reports name and own values, the page files them as a change.
// It reports "dirty" while something is typed, so the page can ask before throwing it away.
import { FIELDS } from "../common.js";
import { T } from "../texts.js";

const { reactive, ref, computed, watch, nextTick } = Vue;

// Sensible ranges for a hobby printer. The slicer's own limits in editable_fields are much
// wider (the nozzle goes up to 1500 °C there), so a typo like 2150 would pass them.
const RANGES = {
  nozzle_temperature: [150, 350],
  nozzle_temperature_initial_layer: [150, 350],
  hot_plate_temp: [0, 130],
  hot_plate_temp_initial_layer: [0, 130],
  filament_flow_ratio: [0.4, 1.6],
  filament_max_volumetric_speed: [0.5, 100],
  filament_density: [0.5, 3],
  filament_diameter: [1, 3.5],
  filament_cost: [0, 5000],
  fan_min_speed: [0, 100],
  fan_max_speed: [0, 100],
};

// Characters the slicer refuses in a profile name (SavePresetDialog.cpp, Item::update), plus
// "@", which separates the short name from the printer (FINDINGS 4.6).
const BAD_CHARS = /[@<>[\]:/\\|?*"]/;
// Longest name in characters, as MAX_NAME in orcaone/operations.py (file names, Windows paths).
const MAX_NAME = 120;
const E = T.editor;

export function nameProblem(name, taken) {
  const n = name.trim();
  if (!n) return E.nameMissing;
  const bad = n.match(BAD_CHARS);
  if (bad) return E.nameBadChar(bad[0]);
  if ([...n].length > MAX_NAME) return E.nameTooLong(MAX_NAME);
  return taken(n) ? E.nameTaken : "";
}

export const hexOf = (v) => (/^#[0-9A-Fa-f]{6}/.exec((v || "").trim()) || [""])[0].toUpperCase();
const shown = (v) => String(v).replace(".", ",");
// "0,95" and "0.95" both count; anything else is not a number.
function num(text) {
  const t = text.trim().replace(",", ".");
  return /^-?(\d+(\.\d+)?|\.\d+)$/.test(t) ? Number(t) : NaN;
}
const de = (n) => n.toLocaleString("de-DE");

// Short text of one value for the list of changes: "Düse 225 °C", "Bett wie Vorlage".
export function changeText(f, x) {
  if (f.type === "colour") return x ? E.newColour : E.colourAsTemplate;
  if (!x) return E.asTemplate(f.label);
  if (f.type === "text") return E.textValue(f.label, x.value);
  const v = shown(x.value) + (x.high_flow !== undefined ? " / " + shown(x.high_flow) : "");
  return f.label + " " + v + (f.unit ? " " + f.unit : "");
}

export default {
  name: "FilamentEditor",
  props: {
    startName: { type: String, required: true },
    own: { type: Object, required: true },        // key -> {value, high_flow?}, set by the profile itself
    base: { type: Object, required: true },       // key -> what the template gives, or null
    mode: { type: String, default: "edit" },      // "edit", "copy" or "new", see above
    templateName: { type: String, default: "" },
    materialColour: { type: String, required: true },
    nameTaken: { type: Function, required: true },
    scopeText: { type: String, default: "" },
  },
  emits: ["save", "cancel", "dirty"],

  setup(props, { emit }) {
    function initial(f) {
      const x = props.own[f.key];
      if (!x) return { a: "", b: "" };
      if (f.type === "colour") return { a: hexOf(x.value), b: "" };
      if (f.type === "text") return { a: x.value, b: "" };
      return { a: shown(x.value), b: x.high_flow !== undefined ? shown(x.high_flow) : "" };
    }
    const form = reactive({ name: props.startName, values: Object.fromEntries(FIELDS.map((f) => [f.key, initial(f)])) });
    const tried = ref(false);
    const touched = reactive(new Set());
    const groups = [...new Set(FIELDS.map((f) => f.group))]
      .map((g) => ({ name: T.fieldGroups[g] || g, fields: FIELDS.filter((f) => f.group === g) }));

    // SnOrca keeps a second value for the high-flow hotend (FINDINGS 4.4): two small fields.
    const twoOf = (f) => props.base[f.key]?.high_flow !== undefined || props.own[f.key]?.high_flow !== undefined;
    const slotsOf = (f) => twoOf(f)
      ? [{ key: "a", id: "ef-" + f.key, caption: E.standard }, { key: "b", id: "ef-" + f.key + "-hf", caption: E.highFlow }]
      : [{ key: "a", id: "ef-" + f.key, caption: "" }];
    const baseOf = (f, slot) => {
      const inh = props.base[f.key];
      if (!inh || inh.value === null || inh.value === undefined) return null;
      return slot === "b" ? inh.high_flow ?? inh.value : inh.value;
    };
    function placeholder(f, slot) {
      const v = baseOf(f, slot);
      if (v === null || (f.type === "text" && props.base[f.key].default)) return "";
      return f.type === "text" ? v : shown(v);
    }
    const empty = (f) => !form.values[f.key].a.trim() && !form.values[f.key].b.trim();
    function fromText(f) {
      if (f.type === "colour") return hexOf(baseOf(f, "a")) ? E.fromTemplate : E.noColour;
      if (f.type === "text" && props.base[f.key]?.default) return E.noValue;
      return E.fromTemplate;
    }

    // What is typed into a field, or null when it is empty. One empty field of a pair takes
    // the template's value for its slot.
    function typed(f) {
      const v = form.values[f.key];
      if (f.type === "colour") return hexOf(v.a) ? { value: hexOf(v.a) } : null;
      if (f.type === "text") return v.a.trim() ? { value: v.a.trim() } : null;
      const a = v.a.trim(), b = v.b.trim();
      if (!a && !b) return null;
      const va = a ? String(num(a)) : baseOf(f, "a") ?? f.default;
      if (!twoOf(f)) return { value: va };
      return { value: va, high_flow: b ? String(num(b)) : baseOf(f, "b") ?? va };
    }
    // Equal as the slicer reads it: numbers by value ("1.0" = "1"), colours in any case.
    function same(f, x, y) {
      if (!x || !y) return !x && !y;
      const eq = f.type === "colour" ? (p, q) => hexOf(p) === hexOf(q)
        : f.type === "text" ? (p, q) => (p ?? "") === (q ?? "")
        : (p, q) => Number(p) === Number(q);
      return eq(x.value, y.value) && (!twoOf(f) || eq(x.high_flow ?? x.value, y.high_flow ?? y.value));
    }
    const baseValue = (f) => baseOf(f, "a") === null ? null : props.base[f.key];
    // The own value this field ends up with, or null for "take the template's value". A value
    // equal to the template's is dropped, the slicer only saves differences (FINDINGS 4.4);
    // a value the profile had already stays exactly as it was.
    function result(f) {
      const r = typed(f), orig = props.own[f.key];
      if (!r) return null;
      if (orig && same(f, r, orig)) return { ...orig };
      return same(f, r, baseValue(f)) ? null : r;
    }
    const changed = (f) => {
      const r = result(f);
      return !!r && !same(f, r, baseValue(f));
    };

    function fieldError(f) {
      if (f.type === "text" || f.type === "colour") return "";
      for (const s of slotsOf(f)) {
        const text = form.values[f.key][s.key].trim();
        if (!text) continue;
        const prefix = s.caption ? s.caption + ": " : "";
        const n = num(text);
        if (isNaN(n)) return prefix + E.needNumber;
        if (f.type === "int" && !Number.isInteger(n)) return prefix + E.needInteger;
        // Values that are there already always pass, even outside the range.
        const orig = props.own[f.key];
        if (n === Number(baseOf(f, s.key)) || (orig && n === Number(s.key === "b" ? orig.high_flow ?? orig.value : orig.value))) continue;
        const [lo, hi] = RANGES[f.key] || [f.min ?? -Infinity, f.max ?? Infinity];
        const unit = f.unit ? " " + f.unit : "";
        if (n < lo || n > hi) return prefix + (hi === Infinity ? E.atLeast(de(lo), unit) : E.between(de(lo), de(hi), unit));
      }
      return "";
    }
    // Errors show after leaving the field or after "Fertig", not while typing.
    const shownError = (f) => tried.value || touched.has(f.key) ? fieldError(f) : "";
    const touch = (f) => touched.add(f.key);
    const nameError = computed(() => nameProblem(form.name, props.nameTaken));

    function reset(f) {
      form.values[f.key] = { a: "", b: "" };
      touched.delete(f.key);
      nextTick(() => document.getElementById("ef-" + f.key)?.focus());
    }

    const colourField = FIELDS.find((f) => f.type === "colour");
    const colourValue = (f) => (hexOf(form.values[f.key].a) || hexOf(baseOf(f, "a")) || props.materialColour).toLowerCase();
    function setColour(f, ev) { form.values[f.key].a = ev.target.value.toUpperCase(); }
    const preview = computed(() => colourField ? colourValue(colourField) : props.materialColour);

    function save() {
      tried.value = true;
      const bad = FIELDS.find((f) => fieldError(f));
      if (nameError.value || bad) {
        nextTick(() => document.getElementById(nameError.value ? "edit-name" : "ef-" + bad.key)?.focus());
        return;
      }
      const own = {};
      for (const f of FIELDS) {
        const r = result(f);
        if (r) own[f.key] = r;
      }
      emit("save", { name: form.name.trim(), own });
    }
    const cancel = () => emit("cancel");

    // Anything typed since the form opened; the page asks before it gets lost.
    const startName = form.name.trim(), startValues = JSON.stringify(form.values);
    const dirty = computed(() => form.name.trim() !== startName || JSON.stringify(form.values) !== startValues);
    watch(dirty, (v) => emit("dirty", v));

    return {
      T, E, form, groups, slotsOf, placeholder, empty, fromText, changed, shownError, touch, nameError,
      reset, colourValue, setColour, preview, save, cancel,
    };
  },

  template: `
    <form class="edit-form" novalidate @submit.prevent="save">
      <div class="panel-body">
        <p v-if="mode === 'copy'" class="quiet-note"><ui-icon name="info"/>{{ E.copyNote }}</p>
        <p v-else-if="mode === 'new'" class="quiet-note"><ui-icon name="info"/>{{ E.newNote }}</p>
        <div class="hero edit-hero">
          <spool-icon :colour="preview" :size="72"/>
          <div class="hero-text">
            <label class="name-label" for="edit-name">{{ E.name }}</label>
            <input id="edit-name" v-model="form.name" class="name-input" autocomplete="off" spellcheck="false"
                   :aria-invalid="nameError ? 'true' : 'false'" aria-describedby="edit-name-error">
            <p v-if="templateName" class="hero-sub">{{ T.filaments.template(templateName) }}</p>
          </div>
        </div>
        <p id="edit-name-error" class="field-error" aria-live="polite">{{ nameError }}</p>

        <section v-for="g in groups" :key="g.name" class="ef-group" :aria-label="g.name">
          <h3>{{ g.name }}</h3>
          <div v-for="f in g.fields" :key="f.key" :class="['ef', { 'is-changed': changed(f) }]">
            <label class="ef-label" :for="'ef-' + f.key">{{ f.label }}</label>
            <span class="ef-sub">
              <template v-if="changed(f)">
                <span class="ef-mark">{{ E.changed }}</span>
                <button class="ef-reset" type="button" :aria-label="E.resetLabel(f.label)" @click="reset(f)"><ui-icon name="undo" :size="14"/>{{ E.reset }}</button>
              </template>
              <span v-else-if="empty(f)" class="ef-from">{{ fromText(f) }}</span>
            </span>
            <div class="ef-inputs">
              <input v-if="f.type === 'colour'" :id="'ef-' + f.key" class="ef-colour" type="color"
                     :value="colourValue(f)" @input="setColour(f, $event)">
              <span v-else-if="f.type === 'text'" class="ef-box ef-box--text">
                <input :id="'ef-' + f.key" v-model="form.values[f.key].a" autocomplete="off" :placeholder="placeholder(f, 'a')">
              </span>
              <template v-else>
                <span v-for="s in slotsOf(f)" :key="s.id" class="ef-slot">
                  <span v-if="s.caption" class="ef-cap" aria-hidden="true">{{ s.caption }}</span>
                  <span :class="['ef-box', { 'is-bad': shownError(f) }]">
                    <input :id="s.id" v-model="form.values[f.key][s.key]" inputmode="decimal" autocomplete="off"
                           :placeholder="placeholder(f, s.key)" :aria-label="s.caption ? f.label + ', ' + s.caption : null"
                           :aria-invalid="shownError(f) ? 'true' : 'false'" :aria-describedby="'ef-' + f.key + '-error'" @blur="touch(f)">
                    <span v-if="f.unit" class="ef-unit" aria-hidden="true">{{ f.unit }}</span>
                  </span>
                </span>
              </template>
            </div>
            <p :id="'ef-' + f.key + '-error'" class="field-error ef-error" aria-live="polite">{{ shownError(f) }}</p>
          </div>
        </section>
        <p v-if="mode !== 'edit' && scopeText" class="note">{{ E.activeFor(scopeText) }}</p>
      </div>
      <div class="panel-foot">
        <button class="btn" type="button" @click="cancel">{{ T.cancel }}</button>
        <button class="btn btn-primary right" type="submit">{{ mode === 'new' ? E.create : E.done }}</button>
      </div>
    </form>
  `,
};
