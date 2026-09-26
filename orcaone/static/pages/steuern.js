// Page "Druck steuern" (the user's wish of 25.09.2026: everything about the running print in one place,
// "alles behandelt ja den aktuellen Druck-Workflow"), for any Klipper printer with an address: the
// print with pause, resume and cancel as in the top bar, a pause at a layer, and the objects on the
// bed from above, one left out on a click. All three show without a print too, greyed, with what
// they do and need (the user: one wants to see what there is to control). Live over Moonraker's
// WebSocket while the page is visible (live.js, shaped by orcaone/control.py); a command goes to the
// printer only on a click, cancelling and leaving an object out after a question, as they cannot be
// taken back.
import { go, hashOf, ui, activeName, flash, LOCALE } from "../common.js";
import { T } from "../texts.js";
import { api } from "../api.js";
import { useLive } from "../live.js";

const { ref, computed, onMounted } = Vue;
const C = T.control;
const JOB_CLASS = { standby: "ok", printing: "ok", complete: "ok", paused: "warn", cancelled: "warn", error: "err" };

export default {
  name: "SteuernPage",
  props: { instId: { type: String, default: null } },  // the page does not depend on an installation

  setup() {
    const host = ref(null);   // null while OrcaOne looks it up, "" without an address
    const busy = ref(false);  // a command on its way
    const errorText = (err) => [C.errors[err.code] || T.files.errors[err.code] || T.errors[err.code] || T.errors.unknown,
      err.data?.detail].filter(Boolean).join(" ");
    // control.state, live; the last values stay while the printer does not answer.
    const printer = useLive(() => ui.printer);
    const data = computed(() => printer.value?.data?.control || null);
    const lookup = ref("");   // the address could not be looked up
    const failed = computed(() => lookup.value || (printer.value?.error ? errorText({ code: printer.value.error }) : ""));
    // The address only for the note without one; the values come live.
    onMounted(async () => {
      try {
        host.value = (await api.printers()).printers[ui.printer]?.host || "";
      } catch (err) {
        host.value = null;
        lookup.value = errorText(err);
      }
    });
    // A command; what it changes comes back with the next live values, within a quarter of a second.
    async function order(fn, done) {
      busy.value = true;
      try {
        await fn();
        if (done) flash(done);
      } catch (err) {
        flash(errorText(err));
      } finally {
        busy.value = false;
      }
    }

    // ------------------------------------------------------------ the print
    const running = computed(() => ["printing", "paused"].includes(data.value?.state));
    const paused = computed(() => data.value?.state === "paused");
    const jobClass = computed(() => JOB_CLASS[data.value?.state] || "ok");
    const pct = computed(() => Math.round((data.value?.progress || 0) * 100));
    const pauseResume = () => order(() => (paused.value ? api.resumePrint(ui.printer) : api.pausePrint(ui.printer)),
      paused.value ? T.printBar.resumed : T.printBar.pausing);
    const cancelAsk = ref(false);
    function cancel() {
      cancelAsk.value = false;
      order(() => api.printCancel(ui.printer), T.printBar.cancelled);
    }

    // ------------------------------------------------------------ pause at a layer
    const layerWanted = ref(null);
    const layerMin = computed(() => (data.value?.layer || 0) + 1);
    const hasLayers = computed(() => !!data.value?.layers);
    const pauseText = computed(() => {
      const p = data.value?.pause;
      if (!p) return "";
      return [p.next ? C.atLayer.next : "", p.layer ? C.atLayer.at(p.layer) : ""].filter(Boolean).join(" ") || C.atLayer.none;
    });
    function setLayer() {
      const k = Number(layerWanted.value || layerMin.value);
      if (!Number.isInteger(k) || k < layerMin.value || k > data.value.layers) return flash(C.errors.pause_invalid);
      order(() => api.pauseAt(ui.printer, { layer: k }), C.atLayer.at(k));
    }
    const pauseNext = () => order(() => api.pauseAt(ui.printer, { next: true }), C.atLayer.next);
    // Where the print is among its layers (the user: now, up to the pause, in all), as a bar with the
    // pause as a mark; a layer typed in says how far off it is.
    const layerShare = (k) => `${Math.min(100, Math.max(0, k / data.value.layers * 100))}%`;
    const toStop = computed(() => {
      const d = data.value, p = d?.pause;
      if (!p || !d.layer) return null;
      if (p.next) return 0;
      return p.layer && p.layer > d.layer ? p.layer - d.layer : null;
    });
    const wantedIn = computed(() => {
      const k = Number(layerWanted.value), d = data.value;
      return Number.isInteger(k) && d?.layer && k > d.layer && k <= d.layers ? k - d.layer : null;
    });
    function clearPause() {
      const p = data.value.pause;
      order(async () => {
        if (p.next) await api.pauseAt(ui.printer, { next: false });
        return p.layer ? api.pauseAt(ui.printer, { layer: null }) : null;
      }, C.atLayer.cleared);
    }

    // ------------------------------------------------------------ the objects from above
    // The bed with the front at the bottom; each object numbered as in the list below it.
    const plate = computed(() => {
      const d = data.value, b = d?.bed;
      if (!b) return null;
      const [[x0, y0], [x1, y1]] = b, w = x1 - x0, h = y1 - y0;
      const at = ([x, y]) => [x - x0, y1 - y];
      return {
        w, h, grid: [...Array(Math.floor(w / 50)).keys()].map((i) => (i + 1) * 50).filter((v) => v < w),
        rows: [...Array(Math.floor(h / 50)).keys()].map((i) => (i + 1) * 50).filter((v) => v < h),
        objects: d.objects.map((o, k) => ({
          ...o, n: k + 1, points: o.polygon.map((p) => at(p).join(",")).join(" "),
          label: o.center ? at(o.center) : at(o.polygon[0] || [x0, y0]),
        })),
      };
    });
    const asking = ref(null);   // the object to leave out, while the page asks
    const ask = (o) => { if (!o.excluded && running.value) asking.value = o; };
    function leaveOut() {
      const o = asking.value;
      asking.value = null;
      order(() => api.excludeObject(ui.printer, o.name), C.objects.done(o.name));
    }
    const shortName = (name) => name.replace(/_ID_\d+_COPY_\d+$/i, "").replace(/\.(stl|3mf|obj|step|stp)$/i, "");

    const num = (v) => (v == null ? "–" : v.toLocaleString(LOCALE));
    return {
      T, C, host, data, failed, busy, running, paused, jobClass, pct, pauseResume, cancelAsk, cancel,
      layerWanted, layerMin, hasLayers, pauseText, setLayer, pauseNext, clearPause, layerShare, toStop, wantedIn,
      plate, asking, ask, leaveOut, shortName, num, activeName, go, hashOf,
    };
  },

  template: `
    <div class="page">
      <h1 id="page-title" tabindex="-1">{{ C.title }}</h1>
      <p class="note">{{ C.lead }}</p>

      <p v-if="host === ''" class="empty">{{ T.monitor.noHost(activeName()) }}
        <a class="link" :href="hashOf('drucker', instId)" @click="go($event, hashOf('drucker', instId))">{{ T.monitor.toPrinters }}</a></p>
      <p v-else-if="!data && !failed" class="note">{{ T.printers.live.asking }}</p>
      <template v-else>
        <p v-if="failed" class="alert" role="alert">{{ failed }}</p>
        <template v-if="data">
          <!-- The print, and pause, resume and cancel as in the top bar -->
          <section class="box ctl-job" aria-labelledby="ctl-file">
            <p class="ctl-who">{{ activeName() }} · {{ host }}</p>
            <h2 id="ctl-file" class="ctl-file" :title="data.file">{{ running && data.file ? data.file : C.noJob }}</h2>
            <p :class="['cam-status', 'is-' + jobClass]"><span class="cam-dot"></span>{{ T.u1.states[data.state] || data.state || '–' }}
              <template v-if="running && data.layers"> · {{ T.camera.print.layer(data.layer, data.layers) }}</template>
              <template v-if="running"> · {{ pct }} %</template></p>
            <div v-if="running" class="ctl-bar" role="progressbar" :aria-valuenow="pct" aria-valuemin="0" aria-valuemax="100"><span :style="{ width: pct + '%' }"></span></div>
            <div class="ctl-actions">
              <button class="btn btn-primary" type="button" :disabled="busy || !running" :title="running ? null : T.printBar.cancelIdle" @click="pauseResume">
                <ui-icon :name="paused ? 'resume' : 'pause'"/>{{ paused ? C.resume : C.pause }}</button>
              <button v-if="!cancelAsk" class="btn" type="button" :disabled="busy || !running" :title="running ? null : T.printBar.cancelIdle"
                      @click="cancelAsk = true"><ui-icon name="stop"/>{{ C.cancel }}</button>
              <span v-else class="ctl-ask" role="alertdialog" aria-labelledby="ctl-cancel-q">
                <span id="ctl-cancel-q">{{ T.printBar.cancelAsk }}</span>
                <button class="btn btn-danger-solid" type="button" @click="cancel">{{ T.printBar.cancelYes }}</button>
                <button class="btn" type="button" @click="cancelAsk = false">{{ T.printBar.cancelNo }}</button>
              </span>
            </div>
          </section>

          <!-- A pause at a layer: to put in magnets or nuts -->
          <section class="box" aria-labelledby="ctl-layer-h">
            <div class="box-head"><h2 id="ctl-layer-h">{{ C.atLayer.title }}</h2></div>
            <p class="note">{{ C.atLayer.lead }}</p>
            <p v-if="!data.pause" class="note">{{ C.atLayer.missing }}</p>
            <template v-else>
              <p v-if="!running" class="ctl-idle"><ui-icon name="info" :size="16"/>{{ C.idle }}</p>
              <p v-else-if="!hasLayers" class="note">{{ C.atLayer.noLayers }}</p>
              <template v-else>
                <p class="ctl-now"><ui-icon name="pause" :size="16"/>{{ pauseText }}</p>
                <div class="ctl-layers">
                  <div class="ctl-layerbar" role="img" :aria-label="C.atLayer.nowOf(data.layer, data.layers)">
                    <span class="ctl-layerbar-fill" :style="{ width: layerShare(data.layer) }"></span>
                    <span v-if="data.pause.layer && data.pause.layer > data.layer" class="ctl-layerbar-stop"
                          :style="{ left: layerShare(data.pause.layer - 1) }" :title="C.atLayer.at(data.pause.layer)"></span>
                  </div>
                  <p class="ctl-layerfacts">
                    <span><small>{{ C.atLayer.now }}</small><strong>{{ data.layer }}</strong></span>
                    <span><small>{{ C.atLayer.toStop }}</small><strong>{{ toStop == null ? '–' : toStop === 0 ? C.atLayer.thisOne : toStop }}</strong></span>
                    <span><small>{{ C.atLayer.total }}</small><strong>{{ data.layers }}</strong></span>
                  </p>
                </div>
              </template>
              <form class="ctl-actions" @submit.prevent="setLayer">
                <label class="ctl-layer">{{ C.atLayer.layer }}
                  <input v-model.number="layerWanted" class="input" type="number" :min="layerMin" :max="data.layers" :placeholder="running ? layerMin : ''"
                         :disabled="!running || !hasLayers"></label>
                <small v-if="wantedIn" class="ctl-in">{{ C.atLayer.inLayers(wantedIn) }}</small>
                <button class="btn btn-primary" type="submit" :disabled="busy || !running || !hasLayers">{{ C.atLayer.set }}</button>
                <button class="btn" type="button" :disabled="busy || !running || !hasLayers || data.pause.next" @click="pauseNext">{{ C.atLayer.nextBtn }}</button>
                <button v-if="running && (data.pause.next || data.pause.layer)" class="link" type="button" :disabled="busy" @click="clearPause">{{ C.atLayer.clear }}</button>
              </form>
            </template>
          </section>

          <!-- The objects on the bed: one left out, the rest prints on -->
          <section class="box" aria-labelledby="ctl-obj-h">
            <div class="box-head"><h2 id="ctl-obj-h">{{ C.objects.title }}</h2></div>
            <p class="note">{{ C.objects.lead }}</p>
            <p v-if="!data.exclude" class="note">{{ C.objects.missing }}</p>
            <template v-else>
              <p v-if="!running" class="ctl-idle"><ui-icon name="info" :size="16"/>{{ C.objects.idle }}</p>
              <p v-else-if="!data.objects.length" class="ctl-idle"><ui-icon name="info" :size="16"/>{{ C.objects.none }}</p>
              <div :class="['ctl-objects', { 'is-empty': !data.objects.length }]">
                <svg v-if="plate" class="ctl-plate" :viewBox="'0 0 ' + plate.w + ' ' + plate.h" aria-hidden="true">
                  <rect class="ctl-bed" x="0" y="0" :width="plate.w" :height="plate.h" rx="4"/>
                  <line v-for="x in plate.grid" :key="'x' + x" class="ctl-grid" :x1="x" y1="0" :x2="x" :y2="plate.h"/>
                  <line v-for="y in plate.rows" :key="'y' + y" class="ctl-grid" x1="0" :y1="plate.h - y" :x2="plate.w" :y2="plate.h - y"/>
                  <g v-for="o in plate.objects" :key="o.name" :class="['ctl-obj', { 'is-current': o.current, 'is-excluded': o.excluded, 'is-asked': asking && asking.name === o.name }]"
                     @click="ask(o)">
                    <title>{{ o.n }} · {{ o.name }}</title>
                    <polygon :points="o.points"/>
                    <text :x="o.label[0]" :y="o.label[1]" text-anchor="middle" dominant-baseline="central">{{ o.n }}</text>
                  </g>
                </svg>
                <ol v-if="data.objects.length" class="ctl-list">
                  <li v-for="(o, k) in data.objects" :key="o.name">
                    <button :class="['ctl-item', { 'is-current': o.current, 'is-excluded': o.excluded }]" type="button" :disabled="o.excluded || busy"
                            :title="o.name" @click="ask({ ...o, n: k + 1 })">
                      <span class="ctl-n">{{ k + 1 }}</span><span class="ctl-name">{{ shortName(o.name) }}</span>
                      <small v-if="o.current">{{ C.objects.current }}</small><small v-else-if="o.excluded">{{ C.objects.excluded }}</small></button>
                  </li>
                </ol>
              </div>
              <div v-if="asking" class="ctl-ask ctl-ask-box" role="alertdialog" aria-labelledby="ctl-obj-q">
                <span id="ctl-obj-q">{{ C.objects.ask(asking.n, shortName(asking.name)) }}</span>
                <button class="btn btn-danger-solid" type="button" @click="leaveOut">{{ C.objects.yes }}</button>
                <button class="btn" type="button" @click="asking = null">{{ C.objects.no }}</button>
              </div>
            </template>
          </section>
        </template>
      </template>
    </div>
  `,
};
