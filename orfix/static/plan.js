// "Das passiert": the side panel content for a plan of POST /plan or /restore-plan, shared by the
// change list (app.js) and the page "Sicherungen". It shows which file is created, changed,
// renamed or deleted, what changes in the .conf, the warnings and, if the backend refuses, why
// and what to do next. Its "Übernehmen" (or "Wiederherstellen") is the explicit confirmation of
// hard rule 5; the caller then sends /apply with the plan id. DoneView shows what /apply reports
// afterwards.
// The backend sends codes (orfix/operations.py); their words are in texts.js.
import { T } from "./texts.js";
import { printerText } from "./common.js";

const { computed } = Vue;

const P = T.plan;
// Lines per list before the rest folds away: a restore can touch dozens of files.
const LIMIT = 10;

// Text for an error or blocking code of /plan, /apply or the backup API, with the next step.
// data is the rest of the answer ({"error": code, …}) or blocked_params of a plan.
export function problemText(code, inst, data = {}) {
  const blocked = T.blocked[code];
  if (blocked) return blocked(inst, data || {});
  return T.errors[code] || T.errors.unknown;
}

// Names as the page shows them: a printer with its nozzle, a filament by its short name.
const namesOf = (inst) => ({
  printer: (name) => printerText(inst, String(name ?? "")),
  filament: (name) => inst.byName.get(name)?.alias || String(name ?? ""),
});

// Warnings of a plan and of an apply; "nothing_to_do" is the empty plan, which says so itself.
export function warningLines(warnings, inst) {
  const names = namesOf(inst);
  return (warnings || []).filter((w) => w.code !== "nothing_to_do").map((w) => {
    const text = T.planWarnings[w.code];
    return line("info", "ch-edit", "", text ? text(w, names) : P.warningUnknown(w));
  });
}

const line = (icon, cls, name, verb, sub = "") => ({ icon, cls, name, verb, sub });
const ACTION = {
  create: { icon: "plus", cls: "ch-new" },
  modify: { icon: "pencil", cls: "ch-edit" },
  rename: { icon: "pencil", cls: "ch-rename" },
  delete: { icon: "trash", cls: "ch-delete" },
};
const fileName = (path) => path.slice(path.lastIndexOf("/") + 1);
const folderOf = (path) => path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
const stem = (path) => path.replace(/\.(json|info)$/, "");
const keyLabel = (key) => T.fields[key]?.label || P.keyNames[key] || key;

// One line per file. The .info of a profile goes into the line of its .json; both are named.
function fileLines(ops, restore) {
  const verbs = restore ? P.restoreVerbs : P.verbs;
  const profiles = new Set(ops.filter((o) => o.what === "own_profile").map((o) => stem(o.path)));
  const infos = new Map(ops.filter((o) => o.what === "profile_info").map((o) => [stem(o.path), o]));
  const out = [];
  for (const o of ops) {
    if (o.what === "profile_info" && profiles.has(stem(o.path))) continue;
    const look = ACTION[o.action] || ACTION.modify, params = o.params || {};
    const verb = (verbs[o.action] || verbs.modify)(params.to ? fileName(params.to) : "");
    const what = P.what[o.what];
    const info = o.what === "own_profile" ? infos.get(stem(o.path)) : null;
    const sub = [
      typeof what === "function" ? what(params) : what,
      params.inherits ? P.inherits(params.inherits) : "",
      params.keys?.length && o.what === "own_profile" ? P.keys(params.keys.map(keyLabel)) : "",
      info ? P.withInfo(fileName(info.params?.to || info.path)) : "",
      folderOf(o.path),
    ].filter(Boolean).join(" · ");
    out.push(line(look.icon, look.cls, fileName(o.path), verb, sub));
  }
  return out;
}

const asList = (v) => Array.isArray(v) ? v : v === null || v === undefined || v === "" ? [] : [v];
// Short form of a .conf value for the generic lines: strings in quotes, the rest as JSON.
function short(v) {
  if (v === null || v === undefined || (Array.isArray(v) && !v.length)) return P.conf.empty;
  const text = typeof v === "string" ? `„${v}“` : JSON.stringify(v);
  return text.length > 80 ? text.slice(0, 77) + " …" : text;
}
const SLOT = /^filament(_\d\d)?$|^filaments$/;

// The .conf entries a plan changes, in words (conf_diff of orfix/operations.py): which filaments
// get visible, which printer the slicer starts with, which printer models go, which remembered
// choices change. Anything else generic.
function confLines(d, inst) {
  const names = namesOf(inst), path = d.path || "", C = P.conf;
  if (path === "filaments") {
    const was = asList(d.before), now = asList(d.after);
    // No list means "every filament visible" to the slicer (FINDINGS 4.6).
    if (!was.length) return [line("pencil", "ch-edit", C.listCreated, "", C.listCreatedSub(now.length))];
    if (!now.length) return [line("pencil", "ch-edit", C.listDropped, "", C.listDroppedSub)];
    const had = new Set(was), has = new Set(now);
    const named = (icon, cls, n, verb) => {
      const alias = names.filament(n);
      return line(icon, cls, alias, verb, alias !== n ? n : "");
    };
    return [
      ...now.filter((n) => !had.has(n)).map((n) => named("check", "ch-on", n, C.shown)),
      ...was.filter((n) => !has.has(n)).map((n) => named("minus", "ch-off", n, C.hidden)),
    ];
  }
  if (path === "presets.machine") {
    return [line("star", "ch-on", names.printer(d.after), C.startPrinter, d.before ? C.insteadOf(names.printer(d.before)) : "")];
  }
  if (path === "models") {
    const keyOf = (x) => `${x?.vendor}\n${x?.model}`;
    const was = new Map(asList(d.before).map((x) => [keyOf(x), x])), now = new Map(asList(d.after).map((x) => [keyOf(x), x]));
    const out = [];
    for (const [k, x] of now) if (!was.has(k)) out.push(line("plus", "ch-new", String(x?.model ?? ""), C.modelOn));
    for (const [k, x] of was) if (!now.has(k)) out.push(line("minus", "ch-off", String(x?.model ?? ""), C.modelOff));
    for (const [k, x] of now) {
      if (was.has(k) && JSON.stringify(was.get(k)) !== JSON.stringify(x)) out.push(line("pencil", "ch-edit", String(x?.model ?? ""), C.modelChanged));
    }
    return out;
  }
  // orca_presets[<printer>] is the remembered choice of one printer, .<key> one value of it.
  const entry = /^orca_presets\[(.*)\](?:\.([^.\]]+))?$/.exec(path);
  if (entry && !entry[2]) {
    const printer = names.printer(entry[1]);
    return [d.after === null || d.after === undefined
      ? line("minus", "ch-off", printer, C.presetGone)
      : line("plus", "ch-new", printer, C.presetNew)];
  }
  if (entry || path.startsWith("presets.")) {
    const key = entry ? entry[2] : path.slice("presets.".length);
    const who = entry ? names.printer(entry[1]) : C.lastUsed;
    const show = (v) => SLOT.test(key) ? asList(v).map((x) => names.filament(x)).join(", ") || C.empty : null;
    const before = show(d.before) ?? short(d.before), after = show(d.after) ?? short(d.after);
    return [line("pencil", "ch-edit", who, SLOT.test(key) ? C.remembersFilament : C.remembers(key), C.value(before, after))];
  }
  return [line("pencil", "ch-edit", path, C.changed, C.value(short(d.before), short(d.after)))];
}

// A list of lines; beyond LIMIT the rest folds into "N weitere".
const PlanLines = {
  name: "PlanLines",
  props: { lines: { type: Array, required: true } },
  setup() { return { LIMIT, P }; },
  template: `
    <ul class="plain-list">
      <li v-for="(l, n) in lines.slice(0, LIMIT)" :key="n">
        <span :class="l.cls"><ui-icon :name="l.icon"/></span>
        <span class="grow"><strong v-if="l.name">{{ l.name }}</strong> {{ l.verb }}<small v-if="l.sub">{{ l.sub }}</small></span>
      </li>
    </ul>
    <details v-if="lines.length > LIMIT" class="more">
      <summary>{{ P.more(lines.length - LIMIT) }}</summary>
      <ul class="plain-list">
        <li v-for="(l, n) in lines.slice(LIMIT)" :key="n">
          <span :class="l.cls"><ui-icon :name="l.icon"/></span>
          <span class="grow"><strong v-if="l.name">{{ l.name }}</strong> {{ l.verb }}<small v-if="l.sub">{{ l.sub }}</small></span>
        </li>
      </ul>
    </details>
  `,
};

// What /apply reported: "Übernommen" (or "Wiederhergestellt") and the warnings of the check after
// writing, e.g. a profile the slicer would not load. Shown only when there are warnings.
export const DoneView = {
  name: "DoneView",
  components: { PlanLines },
  props: { warnings: { type: Array, required: true }, inst: { type: Object, required: true }, text: { type: String, required: true } },
  emits: ["close"],
  setup(props) {
    const lines = computed(() => warningLines(props.warnings, props.inst));
    return { T, P, lines };
  },
  template: `
    <div class="plan-view">
      <p class="state-note"><span class="ch-on"><ui-icon name="check"/></span><strong>{{ text }}</strong></p>
      <h3>{{ P.afterTitle }}</h3>
      <plan-lines :lines="lines"/>
      <div class="actions">
        <button class="btn btn-primary right" type="button" @click="$emit('close')">{{ T.close }}</button>
      </div>
    </div>
  `,
};

export default {
  name: "PlanView",
  components: { PlanLines },
  props: {
    plan: { type: Object, required: true },
    inst: { type: Object, required: true },
    busy: { type: Boolean, default: false },
    error: { type: String, default: "" },     // text of the last apply error
    canReplan: { type: Boolean, default: false },
    lead: { type: String, default: "" },      // one sentence above the plan
    restore: { type: Boolean, default: false },  // a plan of /restore-plan: files come back or go
  },
  emits: ["apply", "back", "replan"],

  setup(props) {
    const ops = computed(() => fileLines(props.plan.ops || [], props.restore));
    const conf = computed(() => (props.plan.conf_diff || []).flatMap((d) => confLines(d, props.inst)));
    const warnings = computed(() => warningLines(props.plan.warnings, props.inst));
    const blocked = computed(() => props.plan.blocked ? problemText(props.plan.blocked, props.inst, props.plan.blocked_params) : "");
    const empty = computed(() => !(props.plan.ops || []).length);
    const confFile = computed(() => props.inst.slicer_page?.conf?.file || ".conf");
    return { T, P, ops, conf, warnings, blocked, empty, confFile };
  },

  template: `
    <div class="plan-view">
      <p v-if="blocked" class="alert" role="alert">{{ blocked }}</p>
      <p v-if="lead" class="quiet-note"><ui-icon name="info"/>{{ lead }}</p>
      <p v-if="empty" class="note">{{ P.nothing }}</p>
      <template v-if="ops.length">
        <h3>{{ P.files }}</h3>
        <plan-lines :lines="ops"/>
      </template>
      <template v-if="conf.length">
        <h3>{{ P.confTitle(confFile) }}</h3>
        <plan-lines :lines="conf"/>
      </template>
      <template v-if="warnings.length">
        <h3>{{ P.warningsTitle }}</h3>
        <plan-lines :lines="warnings"/>
      </template>
      <p v-if="error" class="alert" role="alert">{{ error }}</p>
      <p v-if="!blocked && !empty" class="safe-note"><ui-icon name="backup"/><span>{{ P.safe }}</span></p>
      <div class="actions">
        <button class="btn" type="button" :disabled="busy" @click="$emit('back')">{{ T.back }}</button>
        <button v-if="canReplan" class="btn" type="button" :disabled="busy" @click="$emit('replan')"><ui-icon name="refresh"/>{{ P.replan }}</button>
        <button class="btn btn-primary right" type="button" :disabled="busy || !!plan.blocked || empty" @click="$emit('apply')">
          {{ restore ? (busy ? P.restoring : P.restore) : (busy ? P.running : P.run) }}
        </button>
      </div>
    </div>
  `,
};
