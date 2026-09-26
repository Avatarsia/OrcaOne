// Page "Logs" of the printer part (the user's wish of 26.09.2026): the logs of any Klipper printer
// with an address, from Moonraker's folder "logs" (orcaone/printer_logs.py). Every line as written
// (the user: "1:1", no filter while loading), only coloured: starts, shutdowns, errors. The end
// first, older lines on request, the last start of Klipper at a click, following it live. The search
// runs through the whole file on OrcaOne's side, plain or as a regular expression, and lists the
// hits with lines around them; a click shows the hit in the log. Typing marks what matches in the
// lines loaded, it hides none.
import { go, hashOf, ui, activeName, flash, fmtSize, whenText, LOCALE } from "../common.js";
import { T } from "../texts.js";
import { api } from "../api.js";
import { RegexHelp } from "./regex-help.js";

const { ref, computed, watch, nextTick, onMounted, onUnmounted } = Vue;
const L = T.printerLogs;
const KEEP = 20000;       // lines the view holds at most; beyond, those at the far end go
const FOLLOW_MS = 3000;   // how often following looks for new lines
const CONTEXTS = [0, 2, 5, 10];

export default {
  name: "DruckerLogsPage",
  components: { RegexHelp },
  props: { instId: { type: String, default: null } },  // the page does not depend on an installation

  setup() {
    const printers = ref(null);   // the addresses per printer (api.printers), null while loading
    const loadError = ref("");
    const model = ref("");        // the printer of the top bar, once it has an address
    const host = computed(() => printers.value?.[ui.printer]?.host || "");
    const files = ref(null);      // [{ path, size, modified, group }], null while loading
    const path = ref("");
    const lines = ref([]);        // [{ at, text, kind }]
    const from = ref(0);          // offset of the first line shown
    const next = ref(0);          // offset where the next line after those shown begins
    const size = ref(0);
    const busy = ref(false);
    const failed = ref("");
    const follow = ref(false);
    const followed = ref(null);   // { at, added }: the last look while following, in the switch's tooltip
    // While following, always the newest line in view (the user: "Ende anzeigen", besides the tail).
    const showEnd = ref(true);
    const wrap = ref(true);       // long lines wrapped; off: one line each, the list scrolls sideways
    const box = ref(null);
    const focusAt = ref(null);    // the line a jump went to, marked
    const query = ref("");
    const regex = ref(false);
    const context = ref(2);
    const results = ref(null);    // { groups, hits, complete }
    const searching = ref(false);
    let timer = 0;
    const errorText = (err) => [T.errors[err.code] || T.errors.unknown, err.data?.detail].filter(Boolean).join(" ");

    // The files by the log they belong to, the newest part first (as the server sorts them).
    const groups = computed(() => {
      const out = [];
      for (const f of files.value || []) {
        const g = out.find((x) => x.name === f.group) || out[out.push({ name: f.group, files: [] }) - 1];
        g.files.push(f);
      }
      return out;
    });
    const fileLabel = (f, i) => [f.path, i === 0 ? L.current : "", f.size != null ? fmtSize(f.size) : "",
      f.modified ? whenText(new Date(f.modified * 1000)) : ""].filter(Boolean).join(" · ");
    const atEnd = computed(() => next.value >= size.value);
    const download = computed(() => (model.value && path.value ? api.printerLogDownload(model.value, path.value) : null));

    const scrollDown = () => box.value && (box.value.scrollTop = box.value.scrollHeight);
    const atBottom = () => !box.value || box.value.scrollTop + box.value.clientHeight >= box.value.scrollHeight - 24;
    // Whether an answer is still for the printer and file shown: a search through 10 MB takes seconds.
    const isStill = ([m, p]) => m === model.value && p === path.value;
    // A piece of the log: in place of what shows, before it ("older") or after it ("newer").
    async function view(where = {}, how = "replace") {
      busy.value = true;
      failed.value = "";
      const asked = [model.value, path.value];
      try {
        const v = await api.printerLog(model.value, path.value, where);
        if (!isStill(asked)) return null;   // another file was chosen meanwhile: its offsets are others
        if (v.size != null) size.value = v.size;
        if (how === "replace") {
          lines.value = v.lines;
          from.value = v.from;
          next.value = v.next;
        } else if (how === "older") {
          const el = box.value, height = el?.scrollHeight || 0;
          const all = [...v.lines, ...lines.value];
          if (all.length > KEEP) next.value = all[KEEP].at;
          lines.value = all.slice(0, KEEP);
          from.value = v.from;
          nextTick(() => el && (el.scrollTop += el.scrollHeight - height));   // the lines read stay where they were
        } else {
          const all = [...lines.value, ...v.lines];
          lines.value = all.slice(-KEEP);
          from.value = lines.value[0]?.at ?? v.from;
          next.value = v.next;
        }
        return v;
      } catch (err) {
        failed.value = errorText(err);
        return null;
      } finally {
        busy.value = false;
      }
    }
    async function toEnd() {
      focusAt.value = null;
      await view();
      nextTick(scrollDown);
    }
    const older = () => view({ end: from.value }, "older");
    const newer = () => view({ start: next.value }, "newer");
    // From a line on (top), marking another one (a hit) that follows it.
    async function jump(top, mark = top) {
      follow.value = false;
      if (!(await view({ start: top }))) return;
      focusAt.value = mark;
      nextTick(() => box.value?.querySelector(`[data-at="${top}"]`)?.scrollIntoView({ block: "start" }));
    }
    async function lastStart() {
      try {
        const { at } = await api.printerLogStart(model.value, path.value);
        if (at == null) flash(L.noStart);
        else jump(at);
      } catch (err) {
        flash(errorText(err));
      }
    }

    // Following: what came since, every few seconds while the tab shows; a smaller file than before
    // was turned over (the printer began a new one), so its end anew.
    // The time of each look in the switch's tooltip, nothing more (the user: following seemed not to
    // work, as klippy.log of an idle U1 does not grow at all, checked 26.09.2026; a line next to the
    // switch was too much).
    async function tick() {
      if (document.hidden || busy.value || !path.value) return;
      const stick = showEnd.value || atBottom();
      const asked = [model.value, path.value];
      const v = await api.printerLog(model.value, path.value, { start: next.value }).catch(() => null);
      if (!v || !follow.value || !isStill(asked)) return;
      if (v.size != null && v.size < next.value) return toEnd();
      if (v.size != null) size.value = v.size;
      followed.value = { at: new Date(), added: v.lines.length };
      if (v.lines.length) {
        lines.value = [...lines.value, ...v.lines].slice(-KEEP);
        from.value = lines.value[0].at;
        next.value = v.next;
        if (stick) nextTick(scrollDown);
      }
    }
    const followTitle = computed(() => [L.follow + ": " + L.followHint, followed.value
      && L.lastLook(followed.value.at.toLocaleTimeString(LOCALE, { hour: "2-digit", minute: "2-digit", second: "2-digit" }))].filter(Boolean).join(" "));
    watch(follow, async (on) => {
      clearInterval(timer);
      followed.value = null;
      if (!on) return;
      if (!atEnd.value || focusAt.value != null) await toEnd();
      tick();   // a look at once, not only after the first interval
      timer = setInterval(tick, FOLLOW_MS);
    });
    // Back in view: a look at once (the looks rest while the tab is hidden).
    const onVisible = () => follow.value && !document.hidden && tick();
    watch(showEnd, (on) => on && follow.value && nextTick(scrollDown));
    document.addEventListener("visibilitychange", onVisible);

    // The search: typing marks what matches in the lines loaded; Enter goes through the whole file.
    const marker = computed(() => {
      if (!query.value.trim()) return null;
      try {
        return new RegExp(regex.value ? query.value : query.value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
      } catch {
        return null;   // a regular expression half typed
      }
    });
    function parts(text) {
      const m = marker.value;
      if (!m) return [{ t: text }];
      const out = [];
      let last = 0;
      m.lastIndex = 0;   // matchAll begins where the last test() of "marked" stopped
      for (const found of text.matchAll(m)) {
        if (!found[0]) continue;   // an empty match marks nothing
        if (found.index > last) out.push({ t: text.slice(last, found.index) });
        out.push({ t: found[0], m: true });
        last = found.index + found[0].length;
      }
      if (last < text.length) out.push({ t: text.slice(last) });
      return out;
    }
    const marked = computed(() => (marker.value ? lines.value.filter((l) => { marker.value.lastIndex = 0; return marker.value.test(l.text); }).length : 0));
    let searchSeq = 0;   // the search in progress; an answer to an older one is dropped
    async function searchAll() {
      if (!query.value.trim()) return;
      searching.value = true;
      results.value = null;
      failed.value = "";
      const mine = ++searchSeq;
      try {
        const found = await api.printerLogSearch(model.value, path.value, query.value, regex.value, context.value);
        if (mine === searchSeq) results.value = found;   // hits of another file would jump to its offsets here
      } catch (err) {
        if (mine === searchSeq) failed.value = errorText(err);
      } finally {
        if (mine === searchSeq) searching.value = false;
      }
    }

    // An example of the cheat sheet: as a regular expression, through the whole file at once.
    function useExample(pattern) {
      query.value = pattern;
      regex.value = true;
      searchAll();
    }
    async function loadFiles() {
      files.value = null;
      try {
        files.value = (await api.printerLogs(model.value)).files;
      } catch (err) {
        files.value = [];
        failed.value = errorText(err);
        return;
      }
      // Klipper's current log first: the newest file of a log named klippy, else the first one.
      const klippy = files.value.filter((f) => f.group.includes("klippy")).sort((a, b) => (b.modified || 0) - (a.modified || 0))[0];
      // From "Fehler" ("Im Log zeigen"): that file, searched for the time of the error.
      const focus = ui.logFocus;
      ui.logFocus = null;
      const wanted = focus && focus.printer === model.value && files.value.find((f) => f.path === focus.path);
      path.value = (wanted || klippy || files.value[0])?.path || "";
      if (wanted && focus.query) {
        query.value = focus.query;
        regex.value = false;
        nextTick(searchAll);   // after watch(path), which drops a search begun before it
      }
    }
    watch(path, () => {
      follow.value = false;
      searchSeq++;   // a search still running was for the file before
      searching.value = false;
      results.value = null;
      lines.value = [];
      if (path.value) toEnd();
    });
    watch(model, () => model.value && loadFiles());
    onMounted(async () => {
      try {
        printers.value = (await api.printers()).printers;
        model.value = host.value ? ui.printer : "";
      } catch (err) {
        printers.value = {};
        loadError.value = errorText(err);
      }
    });
    onUnmounted(() => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    });

    return {
      T, L, CONTEXTS, printers, loadError, model, host, activeName, go, hashOf, files, path, groups, fileLabel, lines, from, next, size,
      busy, failed, follow, followTitle, showEnd, wrap, box, focusAt, query, regex, context, results, searching, atEnd, download, toEnd, older, newer, jump,
      lastStart, parts, marker, marked, searchAll, fmtSize, useExample,
    };
  },

  template: `
    <div class="page fill-page">
      <h1 id="page-title" tabindex="-1">{{ L.title }}</h1>
      <p class="note">{{ L.lead }}</p>

      <p v-if="loadError" class="alert" role="alert">{{ loadError }}</p>
      <p v-else-if="printers === null" class="note">{{ T.loading }}</p>
      <p v-else-if="!model" class="empty">{{ L.noHost(activeName()) }}
        <a class="link" :href="hashOf('drucker', instId)" @click="go($event, hashOf('drucker', instId))">{{ L.toPrinters }}</a></p>
      <p v-else-if="files === null" class="note">{{ T.loading }}</p>
      <p v-else-if="!files.length" class="empty">{{ failed || L.noFiles }}</p>
      <template v-else>
        <div class="log-bar">
          <label class="log-file"><span>{{ L.file }}</span>
            <!-- :value, not v-model: v-model sets the choice anew on every update, which closed the open
                 list each time following looked (the user) -->
            <select :value="path" class="input" @change="path = $event.target.value">
              <optgroup v-for="g in groups" :key="g.name" :label="g.name">
                <option v-for="(f, i) in g.files" :key="f.path" :value="f.path">{{ fileLabel(f, i) }}</option>
              </optgroup>
            </select></label>
          <button class="btn" type="button" :disabled="busy" @click="toEnd">{{ L.toEnd }}</button>
          <button class="btn" type="button" :disabled="busy" @click="lastStart">{{ L.lastStart }}</button>
          <!-- Symbols only, what they do in the tooltip (the user's wish of 26.09.2026) -->
          <button class="chip chip-icon" type="button" :aria-pressed="wrap ? 'true' : 'false'" :aria-label="L.wrap"
                  :title="L.wrap + ': ' + L.wrapHint" @click="wrap = !wrap"><ui-icon name="wrap" :size="17"/></button>
          <button class="chip chip-icon" type="button" :aria-pressed="follow ? 'true' : 'false'" :aria-label="L.follow"
                  :title="followTitle" @click="follow = !follow"><ui-icon name="live" :size="17"/></button>
          <button v-if="follow" class="chip chip-icon" type="button" :aria-pressed="showEnd ? 'true' : 'false'" :aria-label="L.showEnd"
                  :title="L.showEnd + ': ' + L.showEndHint" @click="showEnd = !showEnd"><ui-icon name="toEnd" :size="17"/></button>
          <a v-if="download" class="btn" :href="download" download>{{ L.download }}</a>
        </div>
        <form class="plog-search" role="search" @submit.prevent="searchAll">
          <input v-model="query" class="input" type="search" :placeholder="L.find" :aria-label="L.find" spellcheck="false" autocomplete="off">
          <button class="chip" type="button" :aria-pressed="regex ? 'true' : 'false'" :title="L.regexHint" @click="regex = !regex">{{ L.regex }}</button>
          <regex-help examples="printer" @use="useExample"/>
          <label class="plog-context">{{ L.context }}
            <select :value="context" class="input" @change="context = Number($event.target.value)"><option v-for="n in CONTEXTS" :key="n" :value="n">{{ n }}</option></select></label>
          <button class="btn btn-primary" type="submit" :disabled="!query.trim() || searching">{{ searching ? L.searching : L.searchAll }}</button>
          <span v-if="marker" class="note">{{ L.marked(marked) }}</span>
        </form>
        <p v-if="failed" class="alert" role="alert">{{ failed }}</p>

        <!-- The hits in the whole file, with lines around them; a click shows it in the log -->
        <section v-if="results" class="plog-results" :aria-label="L.searchAll">
          <p class="plog-results-head"><strong>{{ L.hits(results.hits, results.complete) }}</strong>
            <button class="link" type="button" @click="results = null">{{ L.close }}</button></p>
          <div v-for="(g, k) in results.groups" :key="k" class="plog-hit-group">
            <button v-for="l in g.lines" :key="l.at" :class="['plog-hit-line', { 'is-hit': l.hit }]" type="button"
                    :title="L.showInLog" @click="jump(g.lines[0].at, l.at)">
              <span class="plog-hit-n">{{ l.n }}</span><span class="plog-hit-text"><template v-for="(p, i) in parts(l.text)" :key="i"><mark v-if="p.m">{{ p.t }}</mark><template v-else>{{ p.t }}</template></template></span>
            </button>
          </div>
        </section>

        <p v-if="lines.length" class="plog-window">{{ L.window(fmtSize(from), fmtSize(next), fmtSize(size)) }}</p>
        <div ref="box" :class="['log-list', 'plog-list', { 'is-nowrap': !wrap }]">
          <button v-if="from > 0 && lines.length" class="link plog-more" type="button" :disabled="busy" @click="older">{{ L.older }}</button>
          <div v-for="l in lines" :key="l.at" :data-at="l.at" :title="l.kind ? L.kinds[l.kind] : null"
               :class="['plog-line', l.kind ? 'is-' + l.kind : '', { 'is-focus': l.at === focusAt }]"><span v-if="l.kind" class="sr-only">{{ L.kinds[l.kind] }}: </span><template v-for="(p, i) in parts(l.text)" :key="i"><mark v-if="p.m">{{ p.t }}</mark><template v-else>{{ p.t }}</template></template></div>
          <button v-if="!atEnd && lines.length" class="link plog-more" type="button" :disabled="busy" @click="newer">{{ L.newer }}</button>
          <p v-if="!lines.length" class="note plog-more">{{ busy ? T.loading : L.empty }}</p>
        </div>
      </template>
    </div>
  `,
};
