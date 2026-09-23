// Page "Details" (under "Technik"): everything about one filament of the chosen installation,
// picked from a list with search. Where the slicer shows it (per printer and nozzle, with the
// reason), what it builds on (the chain of templates up to the original), which files hold it,
// the .info of an own profile and every value with the profile that sets it. Only to look at.
// Data: GET /api/data for the status per printer, GET /api/instances/{id}/profile for chain,
// files and values. The side panel of the page "Filamente" opens this page for one filament
// (detailsFor in common.js).
import { INSTANCES, ui, go, hashOf, modelShown, nozzleLabel, printerShortName, whenText } from "../common.js";
import { T, plainName } from "../texts.js";
import { api } from "../api.js";
import { problemText } from "../plan.js";

const { ref, computed, nextTick } = Vue;
const D = T.details;
const F = T.filaments;

const asList = (v) => Array.isArray(v) ? v : [v];
const valueText = (raw) => asList(raw).join(", ") || "–";
// Status as text plus colour, as on every page.
const STATUS_CLASS = { visible: "st-on", hidden: "st-off", displaced: "st-warn" };

export default {
  name: "DetailsPage",
  props: { instId: { type: String, required: true } },

  setup(props) {
    const inst = computed(() => INSTANCES.find((i) => i.id === props.instId));
    const query = ref("");      // what the field shows: the chosen name, or what is typed
    const open = ref(false);
    const active = ref(0);      // the entry the arrow keys are on
    const chosen = ref(null);   // the record of GET /api/data
    const details = ref(null);  // GET /profile
    const error = ref("");
    const filter = ref("");
    let seq = 0;

    const originText = (f) => f.origin_kind === "vendor" ? F.kinds.vendorFrom(f.package)
      : f.origin_kind === "bundle" ? F.bundlePrinter(f.bundle) : T.labels.origin_kind[f.origin_kind];

    // ------------------------------------------------------------ the list to pick from
    // Headings as in the tree on "Filamente": own ones, bundles, then per maker and brand. Own
    // ones say what they derive from, the others their material.
    function groupOf(f) {
      if (f.origin_kind === "user") return { key: "0", label: F.kinds.user };
      if (f.origin_kind === "bundle") return { key: "1" + f.bundle, label: F.bundlePrinter(f.bundle) };
      const brand = f.vendor || F.noBrand;
      if (f.origin_kind === "vendor") return { key: "2" + f.package + "|" + brand, label: `${F.kinds.vendorFrom(f.package)} · ${brand}` };
      return { key: "3" + brand.toLowerCase(), label: `${F.kinds.library} · ${brand}` };
    }
    const subOf = (f) => f.origin_kind === "user" || f.origin_kind === "bundle"
      ? f.chain[0] ? D.derivedFrom(plainName(f.chain[0])) : D.root
      : f.material || "";
    // Typed words filter, in any order; the chosen name standing in the field shows the whole list.
    const words = computed(() => query.value === shownName(chosen.value) ? [] : query.value.toLowerCase().split(/\s+/).filter(Boolean));
    const groups = computed(() => {
      const map = new Map();
      for (const f of inst.value.filaments) {
        const hay = `${f.name} ${f.vendor || ""} ${f.material || ""}`.toLowerCase();
        if (!words.value.every((w) => hay.includes(w))) continue;
        const g = groupOf(f);
        if (!map.has(g.key)) map.set(g.key, { ...g, items: [] });
        map.get(g.key).items.push({ f, name: plainName(f.name), sub: subOf(f) });
      }
      const list = [...map.values()].sort((a, b) => a.key.localeCompare(b.key, "de"));
      let idx = 0;
      for (const g of list) {
        g.items.sort((a, b) => a.name.localeCompare(b.name, "de"));
        for (const it of g.items) it.idx = idx++;
      }
      return list;
    });
    const flat = computed(() => groups.value.flatMap((g) => g.items));
    function shownName(f) { return f ? plainName(f.name) : ""; }
    function openList() {
      if (!open.value) active.value = Math.max(0, flat.value.findIndex((it) => it.f === chosen.value));
      open.value = true;
      nextTick(scrollToActive);
    }
    // A click or Tab into the field marks its text, so typing replaces it right away. The click
    // that brought the focus would put the caret in and undo that, so it marks again.
    let focusedAt = 0;
    function onFocus(ev) {
      focusedAt = Date.now();
      openList();
      ev.target.select();
    }
    function onClick(ev) {
      if (!open.value || Date.now() - focusedAt < 400) ev.target.select();
      openList();
    }
    function closeList() {
      open.value = false;
      query.value = shownName(chosen.value);
    }
    function pick(it) {
      open.value = false;
      choose(it.f.name);
      // The field keeps the focus; its text marked, the next typing starts a new search.
      nextTick(() => document.getElementById("details-combo")?.select());
    }
    function scrollToActive() {
      document.getElementById("combo-opt-" + active.value)?.scrollIntoView({ block: "nearest" });
    }
    function onKey(ev) {
      if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
        ev.preventDefault();
        if (!open.value) return openList();
        const n = flat.value.length;
        if (n) active.value = (active.value + (ev.key === "ArrowDown" ? 1 : n - 1)) % n;
        nextTick(scrollToActive);
      } else if (ev.key === "Enter" && open.value && flat.value[active.value]) {
        ev.preventDefault();
        pick(flat.value[active.value]);
      } else if (ev.key === "Escape" && open.value) {
        ev.stopPropagation();
        closeList();
      }
    }
    function onInput() {
      open.value = true;
      active.value = 0;
    }

    async function choose(name) {
      const f = inst.value.byName.get(name);
      if (!f) return;
      chosen.value = f;
      query.value = shownName(f);
      details.value = null;
      error.value = "";
      filter.value = "";
      const mine = ++seq;
      try {
        const data = await api.profile(inst.value.id, "filament", f.name);
        if (mine === seq) details.value = data;
      } catch (err) {
        if (mine === seq) error.value = problemText(err.code, inst.value, err.data);
      }
    }
    // Opened from the page "Filamente" for one filament.
    if (ui.detailsFor) {
      const name = ui.detailsFor;
      ui.detailsFor = null;
      choose(name);
    }

    // ------------------------------------------------------------ where it shows
    const printerRows = computed(() => {
      const f = chosen.value;
      if (!f) return [];
      const rows = [];
      for (const m of inst.value.models) {
        for (const p of m.printers) {
          const s = f.printers[p.name];
          if (!s) continue;
          const reason = s.status === "displaced" ? D.displacedBy(s.displaced_by) : s.conditional ? D.conditional : "";
          rows.push({ key: p.name, printer: printerShortName(p.name), nozzle: p.variant ? nozzleLabel(p.variant) + " mm" : "",
                      status: T.labels.status[s.status], cls: STATUS_CLASS[s.status] || "", reason });
        }
      }
      return rows;
    });
    const nowhere = computed(() => chosen.value && !printerRows.value.length);

    // The printer on the page "Filamente" that shows the filament: the one the slicer starts
    // with if it fits, else the first. An own profile the slicer does not load shows under the
    // printers of its list there, or under any.
    const filamentHash = computed(() => {
      const i = inst.value, f = chosen.value;
      if (!f) return null;
      const models = i.models.map((m, idx) => ({ m, idx })).filter(({ m }) => modelShown(i, m));
      const fits = ({ m }) => m.printers.some((p) => f.printers[p.name] && f.printers[p.name].status !== "displaced");
      let hit = models.find((x) => x.m.printers.some((p) => p.selected) && fits(x)) || models.find(fits);
      if (!hit && f.origin_kind === "user") {
        hit = models.find(({ m }) => m.printers.some((p) => f.compatible_printers.includes(p.name))) || models[0];
      }
      return hit ? hashOf("filamente", i.id, hit.idx) : null;
    });
    function toFilaments() {
      ui.filamentFocus = chosen.value.name;
      go(null, filamentHash.value);
    }

    // ------------------------------------------------------------ chain and files
    // From the base profile at the top down to this one; a template the slicer cannot find on top.
    const chain = computed(() => details.value ? [...details.value.chain].reverse().concat([details.value]) : []);
    const missing = computed(() => {
      const d = details.value;
      if (!d || d.chain_complete) return null;
      return (d.chain.length ? d.chain[d.chain.length - 1] : d).inherits;
    });
    // The original: the nearest selectable profile of a manufacturer or the library, going up from
    // this one; for those it is the profile itself.
    const original = computed(() => {
      const up = [...chain.value].reverse().filter((c) => c.origin_kind === "vendor" || c.origin_kind === "library");
      return up.find((c) => !c.abstract) || up[0] || null;
    });
    const files = computed(() => {
      const d = details.value;
      if (!d) return [];
      const out = [];
      const add = (file, what) => { if (file && !out.some((x) => x.file === file)) out.push({ file, what }); };
      add(d.file, D.files.profile);
      if (d.info) add(d.file.replace(/\.json$/, ".info"), D.files.info);
      for (const c of d.chain) add(c.file, c.file.endsWith(".opc") ? D.files.cache : D.files.template);
      return out;
    });
    const info = computed(() => {
      const i = details.value && details.value.info;
      if (!i) return null;
      return { sync: i.sync_info || D.infoNone, updated: i.updated_time ? whenText(new Date(i.updated_time * 1000)) : D.infoNone };
    });
    const problem = computed(() => {
      const d = details.value;
      const text = d && d.problem && T.profileProblems[d.problem];
      return text ? text(d) : "";
    });

    // ------------------------------------------------------------ values
    const values = computed(() => {
      const d = details.value;
      if (!d) return [];
      const q = filter.value.trim().toLowerCase();
      return Object.entries(d.values).filter(([key]) => !q || key.toLowerCase().includes(q))
        .map(([key, v]) => ({ key, text: valueText(v.value), source: v.source, own: v.own }));
    });

    return {
      T, D, F, inst, query, open, active, chosen, details, error, filter, choose, originText, groups, flat,
      onFocus, onClick, closeList, pick, onKey, onInput, filamentHash, toFilaments, printerRows, nowhere, chain, missing, original, files, info,
      problem, values, plainName,
    };
  },

  template: `
    <div class="page details-page">
      <h1 id="page-title" tabindex="-1">{{ D.title }}</h1>
      <p class="note">{{ D.lead(inst.slicer) }}</p>

      <section class="box">
        <div class="combo">
          <label class="combo-label" for="details-combo">{{ D.pick }}</label>
          <span class="search">
            <ui-icon name="search"/>
            <input id="details-combo" v-model="query" class="input" type="text" role="combobox" autocomplete="off"
                   aria-autocomplete="list" aria-controls="details-list" :aria-expanded="open ? 'true' : 'false'"
                   :aria-activedescendant="open && flat[active] ? 'combo-opt-' + active : null" :placeholder="D.pickHint"
                   @focus="onFocus" @click="onClick" @input="onInput" @keydown="onKey" @blur="closeList">
            <ui-icon name="chevronDown" class="combo-chev"/>
          </span>
          <div v-if="open" id="details-list" class="combo-list" role="listbox" :aria-label="D.pick">
            <template v-for="g in groups" :key="g.key">
              <div class="combo-head" role="presentation">{{ g.label }}</div>
              <div v-for="it in g.items" :key="it.f.name" :id="'combo-opt-' + it.idx" role="option"
                   :aria-selected="chosen && chosen.name === it.f.name ? 'true' : 'false'"
                   :class="['combo-opt', { 'is-active': it.idx === active }]" @mousedown.prevent="pick(it)" @mousemove="active = it.idx">
                <span class="combo-name">{{ it.name }}</span><small>{{ it.sub }}</small>
              </div>
            </template>
            <p v-if="!flat.length" class="combo-none">{{ D.noMatch }}</p>
          </div>
        </div>
        <p class="note">{{ D.count(inst.filaments.length) }}</p>
      </section>

      <p v-if="!chosen" class="empty">{{ D.empty }}</p>
      <template v-else>
        <section class="box">
          <div class="hero">
            <spool-icon :colour="chosen.colour || undefined" :size="56"/>
            <div class="hero-text">
              <p class="hero-name">{{ plainName(chosen.name) }}</p>
              <p class="hero-sub">{{ [chosen.vendor, chosen.material].filter(Boolean).join(' · ') }}</p>
              <p class="tags hero-tags"><span class="tag">{{ originText(chosen) }}</span>
                <span v-if="chosen.package !== null && chosen.origin_kind !== 'user' && chosen.origin_kind !== 'bundle'" class="tag"
                      :title="D.inListTitle">{{ chosen.in_list ? D.inList : D.notInList }}</span></p>
            </div>
          </div>
          <p v-if="problem" class="alert">{{ problem }}</p>
        </section>

        <section class="box">
          <div class="box-head"><h2>{{ D.where }}</h2></div>
          <p v-if="nowhere" class="note">{{ D.nowhere }}</p>
          <ul v-else class="plain-list">
            <li v-for="r in printerRows" :key="r.key">
              <span class="grow"><strong>{{ r.printer }}</strong><small v-if="r.nozzle">{{ D.nozzle }} {{ r.nozzle }}</small></span>
              <span :class="['status-text', r.cls]">{{ r.status }}</span>
              <small v-if="r.reason" class="status-reason">{{ r.reason }}</small>
            </li>
          </ul>
          <p v-if="details && details.values.compatible_printers" class="note">
            {{ D.compatible }} {{ details.values.compatible_printers.value.length ? details.values.compatible_printers.value.map(plainName).join(', ') : D.allPrinters }}
          </p>
          <p v-if="details && details.values.compatible_printers_condition && details.values.compatible_printers_condition.value" class="note">
            {{ D.condition }} <code>{{ details.values.compatible_printers_condition.value }}</code>
          </p>
        </section>

        <p v-if="error" class="alert" role="alert">{{ error }}</p>
        <p v-else-if="!details" class="note">{{ D.loading }}</p>
        <template v-else>
          <section class="box">
            <div class="box-head"><h2>{{ D.chainTitle }}</h2></div>
            <p v-if="original" class="note">{{ D.original }} <strong>{{ plainName(original.name) }}</strong></p>
            <ol class="chain">
              <li v-if="missing" class="chain-missing">
                <span class="chain-name">{{ plainName(missing) }}</span>
                <small>{{ D.missing }}</small>
              </li>
              <li v-for="(c, n) in chain" :key="c.name + n" :class="{ 'chain-this': n === chain.length - 1 }">
                <button v-if="n === chain.length - 1 && filamentHash" class="link chain-name chain-link" type="button"
                        :title="D.toFilaments" @click="toFilaments">{{ plainName(c.name) }}<ui-icon name="chevron"/></button>
                <span v-else class="chain-name">{{ plainName(c.name) }}</span>
                <small>{{ n === chain.length - 1 ? D.thisProfile : c.abstract ? D.abstract : D.template }}<template v-if="c.package"> · {{ c.package }}</template></small>
              </li>
            </ol>
            <p v-if="details.renamed_from && details.renamed_from.length" class="note">{{ D.renamedFrom }} {{ details.renamed_from.join(', ') }}</p>
          </section>

          <section class="box">
            <div class="box-head"><h2>{{ D.filesTitle }}</h2></div>
            <ul class="plain-list">
              <li v-for="f in files" :key="f.file"><span class="grow"><code>{{ f.file }}</code><small>{{ f.what }}</small></span></li>
            </ul>
            <dl v-if="info" class="kv">
              <dt>sync_info</dt><dd>{{ info.sync }}</dd>
              <dt>updated_time</dt><dd>{{ info.updated }}</dd>
            </dl>
          </section>

          <section class="box">
            <div class="box-head">
              <h2>{{ D.valuesTitle }}</h2>
              <span class="sub">{{ D.valuesCount(Object.keys(details.values).length) }}</span>
            </div>
            <label class="search details-filter">
              <ui-icon name="search"/>
              <input v-model="filter" class="input" type="search" autocomplete="off" :placeholder="D.filter" :aria-label="D.filter">
            </label>
            <dl class="kv">
              <template v-for="v in values" :key="v.key">
                <dt>{{ v.key }}</dt>
                <dd>{{ v.text }}<small>{{ v.own ? D.setHere : plainName(v.source) }}</small></dd>
              </template>
            </dl>
          </section>
        </template>
      </template>
    </div>
  `,
};
