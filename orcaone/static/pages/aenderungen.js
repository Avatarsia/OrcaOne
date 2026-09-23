// Page "Änderungen" (under "Drucker"): what changed in the chosen installation since the user
// last marked it seen, e.g. after an update, a login, a cloud sync or saving in the slicer.
// orcaone/snapshot.py compares per profile; what OrcaOne writes itself counts as seen. Only
// "Als gesehen markieren" writes, and only into OrcaOne's own folder data/.
import { INSTANCES, NEWS, LOCALE, loadState, flash, whenText, nozzleLabel } from "../common.js";
import { T, plainName } from "../texts.js";
import { api } from "../api.js";

const { ref, reactive, computed, watch, onMounted } = Vue;
const N = T.news;
const SHOW = 12;   // names of a list before "Alle zeigen"
const LONG = 160;  // characters of a value; the whole in the tooltip
const KIND_ICON = { filament: "spool", process: "layers", machine: "printer" };
// Status as text plus colour, as on every page.
const TAG = { added: "is-added", changed: "is-changed", removed: "is-removed" };
const LIBRARY = "OrcaFilamentLibrary";

const state = (x) => x.old === null ? "added" : x.new === null ? "removed" : "changed";
const isHidden = (v) => typeof v === "string" && v.startsWith("***");
function valueText(v) {
  if (v === null || v === undefined) return N.unset;
  if (isHidden(v)) return N.hidden;
  const text = (Array.isArray(v) ? v : [v]).join(", ") || "–";
  return text.length > LONG ? text.slice(0, LONG) + " …" : text;
}
const fullText = (v) => v === null || v === undefined || isHidden(v) ? "" : (Array.isArray(v) ? v : [v]).join(", ");
const nozzleList = (text) => String(text || "").split(";").filter(Boolean).map(nozzleLabel).join(", ");
const nozzles = (p) => N.nozzles(p.old !== null && p.new !== null ? `${nozzleList(p.old)} → ${nozzleList(p.new)}` : nozzleList(p.new ?? p.old));
const packageName = (name) => name === LIBRARY ? T.labels.origin_kind.library : name;

export default {
  name: "AenderungenPage",
  props: { instId: { type: String, required: true } },

  setup(props) {
    const inst = computed(() => INSTANCES.find((i) => i.id === props.instId));
    const news = ref(null);           // GET /news
    const error = ref("");
    const busy = ref(false);
    const whole = reactive(new Set()); // lists shown in full, by key
    let seq = 0;

    const errorText = (code) => N.errors[code] || T.errors[code] || T.errors.unknown;
    async function load() {
      const mine = ++seq;
      error.value = "";
      try {
        const got = await api.news(props.instId);
        if (mine !== seq) return;
        news.value = got;
        NEWS[props.instId] = got.count;
      } catch (err) {
        if (mine === seq) error.value = errorText(err.code);
      }
    }
    async function markSeen() {
      busy.value = true;
      try {
        news.value = await api.newsSeen(props.instId);
        NEWS[props.instId] = 0;
        whole.clear();
        flash(N.seenDone);
      } catch (err) {
        flash(errorText(err.code));
      } finally {
        busy.value = false;
      }
    }
    // Another installation, or "Neu einlesen": compare again.
    watch(() => [props.instId, loadState.version], () => { news.value = null; whole.clear(); load(); });
    onMounted(load);

    const since = computed(() => news.value ? whenText(new Date(news.value.since)) : "");
    function folderText(f) {
      if (f.old === "default") return N.loggedIn(f.new);
      if (f.new === "default") return N.loggedOut(f.old);
      return N.folder(f.old, f.new);
    }
    const names = (key, list) => whole.has(key) ? list : list.slice(0, SHOW);
    const rest = (key, list) => whole.has(key) ? 0 : Math.max(0, list.length - SHOW);
    const groupSummary = (g) => ["added", "changed", "removed"].filter((s) => g[s].length)
      .map((s) => `${g[s].length.toLocaleString(LOCALE)} ${N.states[s]}`).join(", ");

    return {
      T, N, KIND_ICON, TAG, inst, news, error, busy, since, markSeen, folderText, names, rest, whole, groupSummary,
      state, valueText, fullText, nozzles, packageName, plainName,
    };
  },

  template: `
    <div class="page news-page">
      <h1 id="page-title" tabindex="-1">{{ N.title }}</h1>
      <p class="note">{{ N.lead(inst.slicer) }}</p>

      <p v-if="error" class="alert" role="alert">{{ error }}</p>
      <p v-else-if="!news" class="note">{{ N.loading }}</p>
      <template v-else>
        <section class="box news-head">
          <span><strong>{{ news.count ? N.count(news.count) : N.nothing }}</strong> <span class="news-note">{{ N.since(since) }}</span></span>
          <button class="btn btn-primary" type="button" :disabled="busy || !news.count" @click="markSeen"><ui-icon name="check"/>{{ N.seen }}</button>
        </section>
        <p v-if="news.first && !news.count" class="empty">{{ N.first }}</p>

        <section v-if="news.slicer" class="box">
          <div class="box-head"><h2>{{ N.slicer }}</h2></div>
          <p>{{ N.update(news.slicer.old, news.slicer.new) }}</p>
        </section>

        <section v-if="news.folder" class="box">
          <div class="box-head"><h2>{{ N.login }}</h2></div>
          <p>{{ folderText(news.folder) }}</p>
        </section>

        <section v-if="news.own.length" class="box">
          <div class="box-head"><h2>{{ N.own }}</h2></div>
          <ul class="news-list">
            <li v-for="o in news.own" :key="o.kind + '/' + o.name">
              <ui-icon :name="KIND_ICON[o.kind]" :title="N.kinds[o.kind]"/>
              <strong>{{ plainName(o.name) }}</strong>
              <span :class="['news-tag', TAG[o.change]]">{{ N.states[o.change] }}</span>
              <span v-if="o.why" class="news-note">{{ N.why[o.why] }}</span>
              <dl v-if="o.keys.length && o.why !== 'version'" class="news-keys">
                <template v-for="k in o.keys" :key="k.key">
                  <dt>{{ k.key }}</dt>
                  <dd><span :title="fullText(k.old)">{{ valueText(k.old) }}</span> → <span :title="fullText(k.new)">{{ valueText(k.new) }}</span></dd>
                </template>
              </dl>
            </li>
          </ul>
        </section>

        <section v-if="news.printers.length" class="box">
          <div class="box-head"><h2>{{ N.printers }}</h2></div>
          <ul class="news-list">
            <li v-for="p in news.printers" :key="p.model">
              <ui-icon name="printer"/>
              <strong>{{ p.model }}</strong>
              <span :class="['news-tag', TAG[state(p)]]">{{ N.states[state(p)] }}</span>
              <span class="news-note">{{ nozzles(p) }}</span>
            </li>
          </ul>
        </section>

        <section v-if="news.visible" class="box">
          <div class="box-head"><h2>{{ N.visible }}</h2></div>
          <p v-if="news.visible.new === 'all'" class="note">{{ N.visibleAll }}</p>
          <template v-else>
            <p v-if="news.visible.old === 'all'" class="note">{{ N.visibleList }}</p>
            <template v-for="s in ['added', 'removed']" :key="s">
              <p v-if="news.visible[s].length" class="news-names">
                <span :class="['news-tag', TAG[s]]">{{ N.states[s] }}</span>
                <span v-for="name in names('visible/' + s, news.visible[s])" :key="name">{{ plainName(name) }}</span>
                <button v-if="rest('visible/' + s, news.visible[s])" class="link" type="button"
                        @click="whole.add('visible/' + s)">{{ N.more(rest('visible/' + s, news.visible[s])) }}</button>
              </p>
            </template>
          </template>
        </section>

        <section v-if="news.packages.length" class="box">
          <div class="box-head"><h2>{{ N.packages }}</h2></div>
          <ul class="news-list">
            <li v-for="p in news.packages" :key="p.name">
              <ui-icon name="package"/>
              <strong>{{ packageName(p.name) }}</strong>
              <span :class="['news-tag', TAG[state(p)]]">{{ N.states[state(p)] }}</span>
              <span v-if="state(p) === 'added'" class="news-note">{{ N.packageAdded(p.new) }}</span>
              <span v-else-if="state(p) === 'changed'" class="news-note">{{ N.packageVersion(p.old, p.new) }}</span>
              <span v-if="p.why" class="news-note">{{ N.unused }}</span>
            </li>
          </ul>
        </section>

        <section v-if="news.system.length" class="box">
          <div class="box-head"><h2>{{ N.system }}</h2></div>
          <details v-for="g in news.system" :key="g.kind + '/' + g.package" class="news-group">
            <summary><ui-icon :name="KIND_ICON[g.kind]"/>{{ N.kinds[g.kind] }} · {{ packageName(g.package) }}
              <span class="news-note">{{ groupSummary(g) }}</span></summary>
            <template v-for="s in ['added', 'changed', 'removed']" :key="s">
              <p v-if="g[s].length" class="news-names">
                <span :class="['news-tag', TAG[s]]">{{ N.states[s] }}</span>
                <span v-for="name in names(g.kind + '/' + g.package + '/' + s, g[s])" :key="name">{{ plainName(name) }}</span>
                <button v-if="rest(g.kind + '/' + g.package + '/' + s, g[s])" class="link" type="button"
                        @click="whole.add(g.kind + '/' + g.package + '/' + s)">{{ N.more(rest(g.kind + '/' + g.package + '/' + s, g[s])) }}</button>
              </p>
            </template>
          </details>
        </section>
      </template>
    </div>
  `,
};
