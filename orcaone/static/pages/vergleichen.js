// Page "Vergleichen" (under "Filamente"): two filaments side by side, also from two installations,
// e.g. an own profile and its original, or the same filament in OrcaSlicer and Snapmaker Orca:
// which values differ and which profile sets them. Only to look at. Data: GET /api/data for the
// lists, GET /api/instances/{id}/profile for the values, as on the page "Details".
import { INSTANCES } from "../common.js";
import { T, plainName } from "../texts.js";
import { api } from "../api.js";
import { problemText } from "../plan.js";
import FilamentPicker from "./filament-picker.js";

const { ref, reactive, computed } = Vue;
const V = T.compare;
const D = T.details;

const asList = (v) => Array.isArray(v) ? v : [v];
// "220" and ["220"] say the same, and so do "1.0" and "1": the slicers write both.
const NUMBER = /^-?\d+(?:\.\d+)?$/;
const equal = (x, y) => x === y || (NUMBER.test(x) && NUMBER.test(y) && Number(x) === Number(y));
function same(a, b) {
  const x = asList(a), y = asList(b);
  return x.length === y.length && x.every((v, i) => equal(v, y[i]));
}
const LONG = 240;  // characters; start G-code and the like show shortened, the whole in the tooltip
function valueText(raw) {
  const text = asList(raw).join(", ") || "–";
  return text.length > LONG ? text.slice(0, LONG) + " …" : text;
}

export default {
  name: "VergleichenPage",
  components: { FilamentPicker },
  props: { instId: { type: String, required: true } },

  setup(props) {
    // Each side its own installation, at first the chosen one.
    const sides = [0, 1].map(() => reactive({ instId: props.instId, chosen: null, details: null, error: "", seq: 0 }));
    const instOf = (s) => INSTANCES.find((i) => i.id === s.instId) || INSTANCES[0];

    async function choose(s, name) {
      const inst = instOf(s);
      const f = inst.byName.get(name);
      if (!f) return;
      Object.assign(s, { chosen: f, details: null, error: "" });
      const mine = ++s.seq;
      try {
        const data = await api.profile(inst.id, "filament", f.name);
        if (mine === s.seq) s.details = data;
      } catch (err) {
        if (mine === s.seq) s.error = problemText(err.code, inst, err.data);
      }
    }
    // Another installation on one side: its filament of the same name, if there is one.
    function setInst(s, id) {
      const name = s.chosen?.name;
      Object.assign(s, { instId: id, chosen: null, details: null, error: "" });
      s.seq++;
      if (name) choose(s, name);
    }

    const filter = ref("");
    const showSame = ref(false);
    const rows = computed(() => {
      const [a, b] = sides.map((s) => s.details?.values);
      if (!a || !b) return [];
      return [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()
        .map((key) => ({ key, a: a[key], b: b[key], same: !!a[key] && !!b[key] && same(a[key].value, b[key].value) }));
    });
    const differ = computed(() => rows.value.filter((r) => !r.same).length);
    const shown = computed(() => {
      const q = filter.value.trim().toLowerCase();
      return rows.value.filter((r) => (showSame.value || !r.same) && (!q || r.key.toLowerCase().includes(q)));
    });
    const fullText = (v) => asList(v.value).join(", ");
    const sourceText = (v) => v.own ? D.setHere : plainName(v.source);

    return { T, V, D, INSTANCES, sides, instOf, choose, setInst, filter, showSame, rows, differ, shown, valueText, fullText, sourceText, plainName };
  },

  template: `
    <div class="page compare-page">
      <h1 id="page-title" tabindex="-1">{{ V.title }}</h1>
      <p class="note">{{ V.lead }}</p>

      <section class="box compare-pick">
        <div v-for="(s, i) in sides" :key="i" class="compare-side">
          <label v-if="INSTANCES.length > 1" class="compare-inst">
            <span class="combo-label">{{ V.installation }}</span>
            <select class="input" :value="instOf(s).id" @change="setInst(s, $event.target.value)">
              <option v-for="inst in INSTANCES" :key="inst.id" :value="inst.id">{{ inst.slicer }} {{ inst.version }} · {{ inst.path }}</option>
            </select>
          </label>
          <filament-picker :id="'compare-combo-' + i" :inst="instOf(s)" :chosen="s.chosen" :label="V.pick(i)" @pick="(name) => choose(s, name)"/>
          <div v-if="s.chosen" class="compare-hero">
            <spool-icon :colour="s.chosen.colour || undefined" :size="36"/>
            <div class="compare-hero-text">
              <strong>{{ plainName(s.chosen.name) }}</strong>
              <small>{{ [s.chosen.vendor, s.chosen.material].filter(Boolean).join(' · ') }}</small>
            </div>
          </div>
          <p v-if="s.error" class="alert" role="alert">{{ s.error }}</p>
        </div>
      </section>

      <p v-if="!sides[0].chosen || !sides[1].chosen" class="empty">{{ V.empty }}</p>
      <p v-else-if="!sides[0].details || !sides[1].details" class="note">{{ sides[0].error || sides[1].error ? '' : D.loading }}</p>
      <section v-else class="box">
        <div class="box-head">
          <h2>{{ V.valuesTitle }}</h2>
          <span class="sub">{{ V.count(differ, rows.length - differ) }}</span>
        </div>
        <div class="compare-tools">
          <label class="search">
            <ui-icon name="search"/>
            <input v-model="filter" class="input" type="search" autocomplete="off" :placeholder="D.filter" :aria-label="D.filter">
          </label>
          <button type="button" class="compare-toggle" role="switch" :aria-checked="showSame ? 'true' : 'false'" @click="showSame = !showSame">
            <span class="switch" aria-hidden="true"></span>{{ V.showSame }}
          </button>
        </div>
        <p v-if="!shown.length" class="note">{{ differ || showSame ? V.noMatch : V.allSame }}</p>
        <table v-else class="compare-table">
          <colgroup><col class="compare-key"><col><col></colgroup>
          <thead>
            <tr>
              <th scope="col">{{ V.key }}</th>
              <th v-for="(s, i) in sides" :key="i" scope="col">{{ plainName(s.chosen.name) }}<small v-if="sides[0].instId !== sides[1].instId">{{ instOf(s).slicer }}</small></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in shown" :key="r.key" :class="r.same ? 'is-same' : 'is-diff'">
              <th scope="row"><code>{{ r.key }}</code>
                <small v-if="showSame" :class="['compare-mark', r.same ? 'st-off' : 'st-warn']">{{ r.same ? V.same : V.differs }}</small></th>
              <td v-for="(v, n) in [r.a, r.b]" :key="n">
                <template v-if="v"><span :title="fullText(v)">{{ valueText(v.value) }}</span><small>{{ sourceText(v) }}</small></template>
                <template v-else>–<small>{{ V.notSet }}</small></template>
              </td>
            </tr>
          </tbody>
        </table>
      </section>
    </div>
  `,
};
