// Page "Fehler" (the user's wish of 26.09.2026): what the printer reports now and reported before,
// what it means and what helps (orcaone/errors.py). The U1's codes in their parts (level, module,
// head or board), Snapmaker's own words from Snapmaker Orca on this computer (English, read at run
// time), OrcaOne's own for the most important codes and for Klipper's messages, links to Snapmaker's
// list of codes, to klipper3d.org and to the line in the log. Read only: acknowledging is the
// display's; the page sends nothing. Anew when Klipper's state or the list of codes changes (live).
import { go, hashOf, ui, activeName, LOCALE } from "../common.js";
import { T } from "../texts.js";
import { api } from "../api.js";
import { useLive } from "../live.js";

const { ref, computed, watch, onMounted } = Vue;
const F = T.faults;
const WIKI = "https://wiki.snapmaker.com/en/snapmaker_u1/troubleshooting/u1_error_codes";
const LEVEL_CLASS = { 1: "wait", 2: "warn", 3: "err" };

// What an error means, the same under "Jetzt" and in "Vorher": the labels in a column of their own,
// the texts beside them in line; the printer's own text below its label as it is (the user's wish
// of 26.09.2026: aligned, a line break after the label).
const FaultDetails = {
  name: "FaultDetails",
  props: { e: { type: Object, required: true }, snap: { type: Object, default: null }, own: { type: Object, default: null } },
  emits: ["log"],
  setup() {
    return { F, WIKI };
  },
  template: `
    <dl v-if="snap?.desc || own" class="fault-facts">
      <template v-if="snap?.desc"><dt>{{ F.snapmakerSays }}</dt><dd>{{ snap.desc }}</dd></template>
      <template v-if="own"><dt>{{ F.meaning }}</dt><dd>{{ own.what }}</dd><dt>{{ F.fix }}</dt><dd>{{ own.fix }}</dd></template>
    </dl>
    <div v-if="e.message" class="fault-printer"><span class="fault-label">{{ F.printerSays }}</span><pre class="fault-message">{{ e.message }}</pre></div>
    <p class="fault-links">
      <a v-if="e.code" class="link" :href="WIKI" target="_blank" rel="noopener">{{ F.wiki }}</a>
      <a v-if="e.doc" class="link" :href="e.doc" target="_blank" rel="noopener">{{ F.docs }}</a>
      <button v-if="e.log" class="link" type="button" @click="$emit('log')">{{ F.toLog }}</button>
    </p>`,
};

export default {
  name: "FehlerPage",
  components: { FaultDetails },
  props: { instId: { type: String, default: null } },  // the page does not depend on an installation

  setup() {
    const printers = ref(null);
    const loadError = ref("");
    const model = ref("");
    const host = computed(() => printers.value?.[ui.printer]?.host || "");
    const data = ref(null);        // errors.read: { codes, klipper, exceptions, print, history, texts }
    const busy = ref(false);
    const failed = ref("");
    const open = ref(null);        // the entry of the history shown in full
    const errorText = (err) => [T.errors[err.code] || T.errors.unknown, err.data?.detail].filter(Boolean).join(" ");

    async function load() {
      if (!model.value) return;
      busy.value = true;
      try {
        data.value = await api.printerErrors(model.value);
        failed.value = "";
      } catch (err) {
        failed.value = errorText(err);
      } finally {
        busy.value = false;
      }
    }
    // Anew when the printer changes its state or its list of codes (live values, live.js).
    const live = useLive(() => model.value);
    watch(() => {
      const m = live.value?.data?.monitor;
      return m ? `${m.klipper?.state}|${(m.exceptions || []).map((e) => e.code).join(",")}` : "";
    }, (now, before) => before && now && load());

    // What shows under "Jetzt": Klipper down, the codes that stay, the print's own error.
    const current = computed(() => {
      const d = data.value;
      if (!d) return [];
      const out = [];
      if (["shutdown", "error"].includes(d.klipper.state)) out.push({ ...d.klipper, what: "klipper" });
      for (const e of d.exceptions) if (!out.some((o) => o.code && o.code === e.code)) out.push({ ...e, what: "code" });
      if (d.print.exception && !out.some((o) => o.code === d.print.exception.code)) out.push({ ...d.print.exception, what: "print" });
      else if (d.print.state === "error" && d.print.message) out.push({ message: d.print.message, what: "print" });
      return out;
    });

    // The words for an entry: Snapmaker's (from Snapmaker Orca), OrcaOne's own, the headline.
    const shortCode = (e) => (e.code ? `${String(e.module).padStart(4, "0")}-${String(e.number).padStart(4, "0")}` : null);
    const snap = (e) => (e.code && data.value?.texts[e.code]) || null;
    const own = (e) => (e.code && F.snapmaker[shortCode(e)]) || (e.kind && F.klipper[e.kind]) || null;
    const headline = (e) => snap(e)?.title || own(e)?.title || (e.message || "").split("\n")[0] || F.noMessage;
    const levelText = (e) => (e.level ? F.levels[e.level] || String(e.level) : "");
    const levelShort = (e) => (e.level ? F.levelsShort[e.level] || String(e.level) : F.fault);
    const levelClass = (e) => LEVEL_CLASS[e.level] || "err";
    function place(e) {
      if (!e.code) return "";
      const parts = [F.modules[e.module] || `${F.module} ${e.module}`];
      if (e.module === 523) parts.push(F.head(e.index + 1));
      else if (e.module === 522 && (e.number === 6 || e.number === 16)) parts.push(F.boards[e.index] || F.board(e.index));
      else if (e.index) parts.push(`${F.index} ${e.index}`);
      return parts.join(" · ");
    }
    // One form for both: "26.09. 07:12:51". klippy.log in the printer's time, the console in this computer's.
    const pad = (n) => String(n).padStart(2, "0");
    function when(e) {
      if (e.stamp) return `${e.stamp.slice(3, 5)}.${e.stamp.slice(0, 2)}. ${e.stamp.slice(6)}`;
      if (!e.time) return "";
      const d = new Date(e.time * 1000);
      return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}. ${d.toLocaleTimeString(LOCALE, { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`;
    }
    // To the line in the log: the page "Logs" searches for its time (or its words) in that file.
    function toLog(e) {
      ui.logFocus = { printer: model.value, path: e.log, query: e.stamp || e.message.split("\n")[0].slice(0, 120) };
      go(null, hashOf("druckerlogs", null));
    }

    onMounted(async () => {
      try {
        printers.value = (await api.printers()).printers;
        model.value = host.value ? ui.printer : "";
        await load();
      } catch (err) {
        printers.value = {};
        loadError.value = errorText(err);
      }
    });

    return {
      T, F, WIKI, printers, loadError, model, host, activeName, go, hashOf, data, busy, failed, open, load, current,
      snap, own, headline, levelText, levelShort, levelClass, place, when, toLog,
    };
  },

  template: `
    <div class="page">
      <h1 id="page-title" tabindex="-1">{{ F.title }}</h1>
      <p class="note">{{ F.lead }}</p>

      <p v-if="loadError" class="alert" role="alert">{{ loadError }}</p>
      <p v-else-if="printers === null" class="note">{{ T.loading }}</p>
      <p v-else-if="!model" class="empty">{{ F.noHost(activeName()) }}
        <a class="link" :href="hashOf('drucker', instId)" @click="go($event, hashOf('drucker', instId))">{{ F.toPrinters }}</a></p>
      <template v-else>
        <p v-if="failed" class="alert" role="alert">{{ failed }}</p>
        <p v-if="!data && !failed" class="note">{{ T.loading }}</p>
        <template v-if="data">
          <!-- Now -->
          <section class="box" aria-labelledby="faults-now-h">
            <div class="box-head"><h2 id="faults-now-h">{{ F.now }}</h2>
              <button class="btn" type="button" :disabled="busy" @click="load"><ui-icon name="refresh"/>{{ F.reload }}</button></div>
            <p v-if="!current.length" class="cam-status is-ok"><span class="cam-dot"></span>{{ F.none }}</p>
            <article v-for="(e, i) in current" :key="i" class="fault">
              <div class="fault-head">
                <span :class="['cam-status', 'is-' + levelClass(e)]"><span class="cam-dot"></span>{{ levelText(e) || F.whatNow[e.what] }}</span>
                <code v-if="e.code" class="fault-code">{{ e.code }}</code>
                <span class="fault-place">{{ place(e) }}</span>
              </div>
              <h3 class="fault-title">{{ headline(e) }}</h3>
              <div class="fault-body"><fault-details :e="e" :snap="snap(e)" :own="own(e)"/></div>
            </article>
            <p v-if="!data.codes" class="note">{{ F.noCodes }}</p>
          </section>

          <!-- Before, newest first; a click shows it in full -->
          <section class="box" aria-labelledby="faults-before-h">
            <div class="box-head"><h2 id="faults-before-h">{{ F.before }}</h2></div>
            <p class="note">{{ F.beforeLead }}</p>
            <p v-if="!data.history.length" class="empty">{{ F.nothingBefore }}</p>
            <ul v-else class="fault-list">
              <li v-for="(e, i) in data.history" :key="i" :class="{ 'is-open': open === i }">
                <button class="fault-row" type="button" :aria-expanded="open === i ? 'true' : 'false'" @click="open = open === i ? null : i">
                  <span class="fault-when">{{ when(e) }}</span>
                  <span :class="['cam-status', 'is-' + levelClass(e)]" :title="levelText(e)"><span class="cam-dot"></span>{{ levelShort(e) }}</span>
                  <span class="fault-row-title">{{ headline(e) }}<small v-if="e.count > 1"> · {{ F.times(e.count) }}</small></span>
                  <code v-if="e.code" class="fault-code">{{ e.code }}</code>
                  <span class="fault-source">{{ F.origins[e.source] }}</span>
                </button>
                <div v-if="open === i" class="fault-body">
                  <p v-if="levelText(e) || place(e)" class="fault-place">{{ [levelText(e), place(e)].filter(Boolean).join(' · ') }}</p>
                  <fault-details :e="e" :snap="snap(e)" :own="own(e)" @log="toLog(e)"/>
                </div>
              </li>
            </ul>
          </section>
        </template>
      </template>
    </div>
  `,
};
