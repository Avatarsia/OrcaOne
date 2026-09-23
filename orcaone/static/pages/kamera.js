// Page "Kamera": the picture of the Snapmaker U1 camera (stock firmware), after the user's
// prototypes/U1Cam/u1cam.py. While the page is open and visible, OrcaOne wakes the camera every
// few seconds and fetches the picture the printer wrote last (orcaone/camera.py); the browser
// never talks to the printer itself. The printers are added here by address, once.
import { flash } from "../common.js";
import { T } from "../texts.js";
import { api } from "../api.js";

const { ref, reactive, onMounted, onUnmounted } = Vue;
const K = T.camera;
const WAKE_EVERY = 10000;  // ms, as u1cam.py does
const EVERY = [1, 2, 3, 5, 10];

export default {
  name: "KameraPage",
  props: { instId: { type: String, default: null } },  // the page does not depend on an installation

  setup() {
    const list = ref(null);  // null while loading
    const loadError = ref("");
    // Per camera: the picture as object URL, when it came, how waking went.
    const live = reactive({});
    const host = ref("");
    const name = ref("");
    const addError = ref("");
    const busy = ref(false);
    const now = ref(Date.now());
    let timers = [];

    const errorText = (code) => K.errors[code] || T.errors[code] || T.errors.unknown;
    // Created once, then always read through the reactive object, so changes show.
    const stateOf = (id) => {
      if (!live[id]) live[id] = { url: "", at: 0, every: 3, wakeOk: null, wakeDetail: "", error: "", errorDetail: "", fetching: false };
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
    function start() {
      stop();
      for (const c of list.value || []) {
        const s = stateOf(c.id);
        // The last picture right away, however old; a fresh one once the camera is awake.
        fetchImage(c);
        wake(c).then(() => setTimeout(() => fetchImage(c), 1500));
        timers.push(setInterval(() => wake(c), WAKE_EVERY));
        timers.push(setInterval(() => fetchImage(c), s.every * 1000));
      }
      timers.push(setInterval(() => { now.value = Date.now(); }, 1000));
    }
    function stop() {
      timers.forEach(clearInterval);
      timers = [];
    }
    function setEvery(c, seconds) {
      stateOf(c.id).every = seconds;
      start();
      // Kept for the next visit; the page works on without it.
      api.cameraEvery(c.id, seconds).catch((err) => flash(errorText(err.code)));
    }

    async function load() {
      try {
        list.value = (await api.cameras()).cameras;
        for (const c of list.value) if (c.every) stateOf(c.id).every = c.every;
        loadError.value = "";
        start();
      } catch (err) {
        loadError.value = errorText(err.code);
      }
    }
    async function add() {
      if (!host.value.trim() || busy.value) return;
      busy.value = true;
      addError.value = "";
      try {
        await api.addCamera(host.value, name.value);
        host.value = "";
        name.value = "";
        flash(K.added);
        await load();
      } catch (err) {
        addError.value = errorText(err.code);
      } finally {
        busy.value = false;
      }
    }
    async function remove(c) {
      try {
        await api.removeCamera(c.id);
        if (live[c.id]?.url) URL.revokeObjectURL(live[c.id].url);
        delete live[c.id];
        flash(K.removed);
        await load();
      } catch (err) {
        flash(errorText(err.code));
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
    function fullscreen(ev) {
      const img = ev.currentTarget;
      document.fullscreenElement ? document.exitFullscreen() : img.requestFullscreen?.();
    }

    const onVisible = () => { if (!document.hidden) (list.value || []).forEach((c) => fetchImage(c)); };
    onMounted(() => { load(); document.addEventListener("visibilitychange", onVisible); });
    onUnmounted(() => {
      stop();
      document.removeEventListener("visibilitychange", onVisible);
      Object.values(live).forEach((s) => s.url && URL.revokeObjectURL(s.url));
    });

    return { T, K, EVERY, list, loadError, live, host, name, addError, busy, stateOf, status, setEvery, add, remove, fullscreen };
  },

  template: `
    <div class="page camera-page">
      <h1 id="page-title" tabindex="-1">{{ K.title }}</h1>
      <p class="note">{{ K.lead }}</p>

      <p v-if="loadError" class="alert" role="alert">{{ loadError }}</p>
      <p v-else-if="list === null" class="note">{{ T.loading }}</p>
      <div v-else class="cam-grid">
        <article v-for="c in list" :key="c.id" class="box cam-card" :aria-label="c.name">
          <div class="cam-head">
            <ui-icon name="camera" :size="20"/>
            <strong>{{ c.name }}</strong>
            <span class="cam-host">{{ c.host }}</span>
            <span :class="['cam-status', 'is-' + status(c).cls]"><span class="cam-dot"></span>{{ status(c).text }}</span>
          </div>
          <div class="cam-frame">
            <img v-if="stateOf(c.id).url" :src="stateOf(c.id).url" :alt="K.alt(c.name)" :title="K.fullscreen" @click="fullscreen">
            <div v-else class="cam-empty"><ui-icon name="camera" :size="40"/><span>{{ K.waking }}</span></div>
          </div>
          <div class="cam-foot">
            <label class="cam-every">{{ K.every }}
              <select class="input" :value="stateOf(c.id).every" @change="setEvery(c, Number($event.target.value))">
                <option v-for="s in EVERY" :key="s" :value="s">{{ s }} s</option>
              </select>
            </label>
            <span v-if="stateOf(c.id).wakeOk === false" class="cam-wake" :title="stateOf(c.id).wakeDetail">{{ K.wakeFailed }}</span>
            <span v-if="stateOf(c.id).errorDetail" class="cam-detail" :title="stateOf(c.id).errorDetail">{{ stateOf(c.id).errorDetail }}</span>
            <button class="btn right" type="button" @click="remove(c)"><ui-icon name="trash"/>{{ K.remove }}</button>
          </div>
        </article>

        <section class="box cam-add" aria-labelledby="cam-add-h">
          <div class="box-head"><h2 id="cam-add-h">{{ list.length ? K.addAnother : K.addTitle }}</h2></div>
          <p class="note">{{ K.addHint }}</p>
          <form class="cam-form" @submit.prevent="add">
            <label class="field"><span>{{ K.host }}</span>
              <input v-model="host" class="input" type="text" autocomplete="off" :placeholder="K.hostHint" required>
            </label>
            <label class="field"><span>{{ K.name }}</span>
              <input v-model="name" class="input" type="text" autocomplete="off" :placeholder="K.nameHint">
            </label>
            <button class="btn btn-primary" type="submit" :disabled="busy || !host.trim()"><ui-icon name="plus"/>{{ K.add }}</button>
          </form>
          <p v-if="addError" class="field-error" role="alert">{{ addError }}</p>
        </section>
      </div>
    </div>
  `,
};
