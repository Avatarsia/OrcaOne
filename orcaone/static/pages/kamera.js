// Page "Kamera": the picture of every Snapmaker U1 (stock firmware) whose address is set on its
// card on the page "Drucker" (orcaone/camera.py), after the user's prototypes/U1Cam/u1cam.py.
// While the page is open and visible, OrcaOne wakes the camera every few seconds and fetches the
// picture the printer wrote last; the browser never talks to the printer itself.
// Three views, as on YouTube: in the page, filling the browser window, and the whole screen
// (Fullscreen API). In the two big ones the bar hides after a few seconds without a mouse move,
// so a spare screen shows the picture and how far the print is; Esc goes back.
import { flash, go, hashOf, loadState, ui, U1_MODELS } from "../common.js";
import { T } from "../texts.js";
import { api } from "../api.js";

const { ref, reactive, computed, watch, nextTick, onMounted, onUnmounted } = Vue;
const K = T.camera;
const U1 = T.u1;
const WAKE_EVERY = 10000;   // ms, as u1cam.py does
const STATUS_EVERY = 5000;  // ms, as on the page "Kalibrieren"
const EVERY = [1, 2, 3, 5, 10];
const IDLE = 3000;          // ms without a mouse move before the bar of a big view hides

// ------------------------------------------------------------ how far a print is (camera.py, status)
const running = (p) => !!p && (p.state === "printing" || p.state === "paused");
const percent = (p) => Math.round(Math.min(1, Math.max(0, p.progress || 0)) * 100);
// The colours of the picture's state line: status always as text plus colour; "Bereit" green, as
// on the printer cards of "Drucker".
const jobClass = (p) => ({ standby: "ok", printing: "ok", complete: "ok", paused: "warn", cancelled: "warn", error: "err" })[p.state] || "wait";
const hasLayer = (p) => !!p.layers && p.layer != null;
function time(seconds) {
  const minutes = Math.max(1, Math.round(seconds / 60));
  return K.print.duration(Math.floor(minutes / 60), minutes % 60);
}
// The big views have room for one line only.
function printFacts(p) {
  if (!running(p)) return p.file || "";
  return [`${percent(p)} %`, hasLayer(p) && K.print.layer(p.layer, p.layers), p.left != null && K.print.left(time(p.left))]
    .filter(Boolean).join(" · ");
}

// Also on the page "Übersicht".
export const PrintStatus = {
  name: "PrintStatus",
  props: { p: { type: Object, required: true } },
  setup: () => ({ K, U1, running, percent, jobClass, hasLayer, time }),
  template: `
    <div class="cam-print">
      <div class="cam-job">
        <span :class="['cam-status', 'is-' + jobClass(p)]"><span class="cam-dot"></span>{{ U1.states[p.state] || p.state }}</span>
        <span v-if="p.file && p.state !== 'standby'" class="cam-file" :title="p.file">{{ p.file }}</span>
        <strong v-if="running(p)" class="cam-percent">{{ percent(p) }} %</strong>
      </div>
      <div v-if="running(p)" class="cam-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" :aria-valuenow="percent(p)">
        <span :style="{ width: percent(p) + '%' }"></span>
      </div>
      <div v-if="p.state !== 'standby'" class="cam-facts">
        <span v-if="hasLayer(p)">{{ K.print.layer(p.layer, p.layers) }}</span>
        <span v-if="running(p) && p.left != null">{{ K.print.left(time(p.left)) }}</span>
        <span v-if="p.printed">{{ K.print.printed(time(p.printed)) }}</span>
      </div>
    </div>
  `,
};

export default {
  name: "KameraPage",
  components: { PrintStatus },
  props: { instId: { type: String, default: null } },  // the page does not depend on an installation

  setup() {
    const list = ref(null);  // null while loading
    const loadError = ref("");
    // Per camera: the picture as object URL, when it came, how waking went.
    const live = reactive({});
    const now = ref(Date.now());
    let timers = [];

    const errorText = (code) => K.errors[code] || T.errors[code] || T.errors.unknown;
    // Created once, then always read through the reactive object, so changes show.
    const stateOf = (id) => {
      if (!live[id]) live[id] = { url: "", at: 0, every: 3, wakeOk: null, wakeDetail: "", error: "", errorDetail: "", fetching: false, print: null };
      return live[id];
    };

    async function fetchImage(c) {
      const s = stateOf(c.id);
      if (s.fetching || document.hidden) return;
      s.fetching = true;
      try {
        const response = await fetch(`/api/cameras/${encodeURIComponent(c.id)}/image?t=${Date.now()}`);
        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          s.error = errorText(data.error);
          s.errorDetail = data.detail || "";
          return;
        }
        // How old the picture was when the printer sent it, by the printer's clock.
        const age = Number(response.headers.get("X-Image-Age"));
        const url = URL.createObjectURL(await response.blob());
        if (s.url) URL.revokeObjectURL(s.url);
        Object.assign(s, { url, at: Date.now() - (Number.isFinite(age) ? age * 1000 : 0), error: "", errorDetail: "" });
      } catch {
        s.error = errorText("network");
      } finally {
        s.fetching = false;
      }
    }
    async function wake(c) {
      if (document.hidden) return;
      const s = stateOf(c.id);
      try {
        await api.wakeCamera(c.id);
        Object.assign(s, { wakeOk: true, wakeDetail: "" });
      } catch (err) {
        Object.assign(s, { wakeOk: false, wakeDetail: err.data?.detail || errorText(err.code) });
      }
    }
    async function readStatus(c) {
      if (document.hidden) return;
      try {
        stateOf(c.id).print = await api.printerStatus(c.id);
      } catch {
        stateOf(c.id).print = null;  // the picture's state line says why
      }
    }
    function start() {
      stop();
      for (const c of list.value || []) {
        const s = stateOf(c.id);
        // The last picture right away, however old; a fresh one once the camera is awake.
        fetchImage(c);
        wake(c).then(() => setTimeout(() => fetchImage(c), 1500));
        readStatus(c);
        timers.push(setInterval(() => wake(c), WAKE_EVERY));
        timers.push(setInterval(() => fetchImage(c), s.every * 1000));
        timers.push(setInterval(() => readStatus(c), STATUS_EVERY));
      }
      timers.push(setInterval(() => { now.value = Date.now(); }, 1000));
    }
    function stop() {
      timers.forEach(clearInterval);
      timers = [];
    }
    // The light in the printer: off, the camera sends a black picture.
    const lightBusy = reactive({});
    async function setLight(c, on) {
      lightBusy[c.id] = true;
      try {
        await api.cameraLight(c.id, on);
        const s = stateOf(c.id);
        if (s.print) s.print = { ...s.print, light: on };
        setTimeout(() => fetchImage(c), 800);
      } catch (err) {
        flash(K.light.failed + (err.data?.detail ? ` (${err.data.detail})` : ""));
      } finally {
        lightBusy[c.id] = false;
      }
    }
    function setEvery(c, seconds) {
      stateOf(c.id).every = seconds;
      start();
      // Kept for the next visit; the page works on without it.
      api.cameraEvery(c.id, seconds).catch((err) => flash(errorText(err.code)));
    }
    async function load() {
      try {
        // Only the printer chosen in the top bar (app.js); every U1 with an address has a camera.
        list.value = (await api.cameras()).cameras.filter((c) => c.model === ui.printer);
        for (const c of list.value) if (c.every) stateOf(c.id).every = c.every;
        loadError.value = "";
        start();
      } catch (err) {
        loadError.value = errorText(err.code);
      }
    }

    // Text and colour of the state line (status always as text plus colour).
    function status(c) {
      const s = stateOf(c.id);
      if (s.error) return { cls: "err", text: s.error };
      if (!s.at) return { cls: "wait", text: K.waking };
      const age = Math.max(0, Math.round((now.value - s.at) / 1000));
      return age > s.every * 3 ? { cls: "warn", text: K.stale(age) } : { cls: "ok", text: K.lastImage(age) };
    }

    // ------------------------------------------------------------ the three views
    const view = ref("normal");  // "normal", "window" or "screen"
    const bigId = ref(null);
    const big = computed(() => (list.value || []).find((c) => c.id === bigId.value) || null);
    const overlay = ref(null);
    const idle = ref(false);
    let idleTimer = null;
    // From "window" to "screen" and back with Esc lands in "window" again, as on YouTube.
    let beforeScreen = "normal";
    function stir() {
      idle.value = false;
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => { idle.value = true; }, IDLE);
    }
    async function showBig(c, mode) {
      bigId.value = c.id;
      if (mode === "screen") {
        beforeScreen = view.value === "screen" ? beforeScreen : view.value;
        view.value = "screen";
        await nextTick();
        try {
          await overlay.value.requestFullscreen();
        } catch {
          view.value = "window";  // the browser refused: at least the whole window
        }
      } else {
        if (document.fullscreenElement) await document.exitFullscreen().catch(() => {});
        view.value = "window";
      }
      stir();
    }
    async function back() {
      if (document.fullscreenElement) await document.exitFullscreen().catch(() => {});
      view.value = "normal";
      bigId.value = null;
    }
    // The browser leaves full screen by itself on Esc.
    const onFullscreen = () => {
      if (!document.fullscreenElement && view.value === "screen") {
        view.value = beforeScreen;
        if (view.value === "normal") bigId.value = null;
      }
    };
    const onKey = (ev) => { if (ev.key === "Escape" && view.value === "window") back(); };
    const onVisible = () => {
      if (!document.hidden) (list.value || []).forEach((c) => { fetchImage(c); readStatus(c); });
    };

    // The page shows before the slicers are read; an address from a printer profile comes with
    // that read (overview.build_all), so the list is asked again after every one.
    watch(() => loadState.version, load);
    onMounted(() => {
      load();
      document.addEventListener("visibilitychange", onVisible);
      document.addEventListener("fullscreenchange", onFullscreen);
      document.addEventListener("keydown", onKey);
    });
    onUnmounted(() => {
      stop();
      clearTimeout(idleTimer);
      document.removeEventListener("visibilitychange", onVisible);
      document.removeEventListener("fullscreenchange", onFullscreen);
      document.removeEventListener("keydown", onKey);
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      Object.values(live).forEach((s) => s.url && URL.revokeObjectURL(s.url));
    });

    return {
      T, K, U1, ui, U1_MODELS, EVERY, list, loadError, stateOf, status, setEvery, view, big, overlay, idle, stir, showBig, back, go, hashOf,
      running, percent, jobClass, printFacts, lightBusy, setLight,
    };
  },

  template: `
    <div class="page camera-page">
      <h1 id="page-title" tabindex="-1">{{ K.title }}</h1>
      <p class="note">{{ K.lead }}</p>

      <p v-if="loadError" class="alert" role="alert">{{ loadError }}</p>
      <p v-else-if="list === null" class="note">{{ T.loading }}</p>
      <p v-else-if="!U1_MODELS.includes(ui.printer)" class="empty">{{ K.notU1 }}</p>
      <p v-else-if="!list.length" class="empty">{{ K.none }}
        <a class="link" :href="hashOf('drucker', instId)" @click="go($event, hashOf('drucker', instId))">{{ K.toPrinters }}</a></p>
      <div v-else class="cam-grid">
        <article v-for="c in list" :key="c.id" class="box cam-card" :aria-label="c.model">
          <div class="cam-head">
            <ui-icon name="camera" :size="20"/>
            <strong>{{ c.model }}</strong>
            <span class="cam-host">{{ c.host }}</span>
            <span :class="['cam-status', 'is-' + status(c).cls]"><span class="cam-dot"></span>{{ status(c).text }}</span>
          </div>
          <div class="cam-frame">
            <img v-if="stateOf(c.id).url" :src="stateOf(c.id).url" :alt="K.alt(c.model)" :title="K.views.window" @click="showBig(c, 'window')">
            <div v-else class="cam-empty"><ui-icon name="camera" :size="40"/><span>{{ K.waking }}</span></div>
            <span v-if="stateOf(c.id).print?.light === false" class="cam-light"><ui-icon name="bulb" :size="16"/>{{ K.lightOff }}
              <button class="cam-light-btn" type="button" :disabled="lightBusy[c.id]" @click.stop="setLight(c, true)">{{ K.light.turnOn }}</button></span>
          </div>
          <print-status v-if="stateOf(c.id).print?.state" :p="stateOf(c.id).print"/>
          <div class="cam-foot">
            <label class="cam-every">{{ K.every }}
              <select class="input" :value="stateOf(c.id).every" @change="setEvery(c, Number($event.target.value))">
                <option v-for="s in EVERY" :key="s" :value="s">{{ s }} s</option>
              </select>
            </label>
            <span v-if="stateOf(c.id).wakeOk === false" class="cam-wake" :title="stateOf(c.id).wakeDetail">{{ K.wakeFailed }}</span>
            <span v-if="stateOf(c.id).errorDetail" class="cam-detail" :title="stateOf(c.id).errorDetail">{{ stateOf(c.id).errorDetail }}</span>
            <button v-if="stateOf(c.id).print && stateOf(c.id).print.light != null" class="btn" type="button" :disabled="lightBusy[c.id]"
                    @click="setLight(c, !stateOf(c.id).print.light)"><ui-icon name="bulb"/>{{ stateOf(c.id).print.light ? K.light.off : K.light.on }}</button>
            <span class="cam-views right">
              <button class="btn" type="button" @click="showBig(c, 'window')"><ui-icon name="window"/>{{ K.views.window }}</button>
              <button class="btn" type="button" @click="showBig(c, 'screen')"><ui-icon name="fullscreen"/>{{ K.views.screen }}</button>
            </span>
          </div>
        </article>
      </div>

      <div v-if="view !== 'normal' && big" ref="overlay" :class="['cam-overlay', { 'is-idle': idle }]"
           role="dialog" :aria-label="K.alt(big.model)" @mousemove="stir" @click="stir">
        <img v-if="stateOf(big.id).url" :src="stateOf(big.id).url" :alt="K.alt(big.model)">
        <div v-else class="cam-empty"><ui-icon name="camera" :size="56"/><span>{{ K.waking }}</span></div>
        <span v-if="stateOf(big.id).print?.light === false" class="cam-light"><ui-icon name="bulb" :size="16"/>{{ K.lightOff }}
          <button class="cam-light-btn" type="button" :disabled="lightBusy[big.id]" @click.stop="setLight(big, true)">{{ K.light.turnOn }}</button></span>
        <div v-if="stateOf(big.id).print?.state && stateOf(big.id).print.state !== 'standby'" class="cam-overlay-print">
          <span :class="['cam-status', 'is-' + jobClass(stateOf(big.id).print)]"><span class="cam-dot"></span>{{ U1.states[stateOf(big.id).print.state] || stateOf(big.id).print.state }}</span>
          <span>{{ printFacts(stateOf(big.id).print) }}</span>
        </div>
        <div v-if="running(stateOf(big.id).print)" class="cam-overlay-progress"><span :style="{ width: percent(stateOf(big.id).print) + '%' }"></span></div>
        <div class="cam-overlay-bar">
          <strong>{{ big.model }}</strong>
          <span :class="['cam-status', 'is-' + status(big).cls]"><span class="cam-dot"></span>{{ status(big).text }}</span>
          <small class="cam-overlay-hint">{{ K.back }}</small>
          <button v-if="view === 'window'" class="cam-overlay-btn" type="button" :title="K.views.screen" :aria-label="K.views.screen"
                  @click.stop="showBig(big, 'screen')"><ui-icon name="fullscreen"/></button>
          <button v-else class="cam-overlay-btn" type="button" :title="K.views.window" :aria-label="K.views.window"
                  @click.stop="showBig(big, 'window')"><ui-icon name="shrink"/></button>
          <button class="cam-overlay-btn" type="button" :title="K.views.normal" :aria-label="K.views.normal" @click.stop="back"><ui-icon name="close"/></button>
        </div>
      </div>
    </div>
  `,
};
