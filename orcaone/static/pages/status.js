// Page "Status" (the user's wish of 24.09.2026): what the printer of the top bar is doing right
// now, for any Klipper printer with an address; read only, live over Moonraker's WebSocket while the
// page is visible, at most four times a second (live.js, orcaone/live.py, shaped by orcaone/monitor.py). As pictures where they help (the user: not so
// "trocken"): the print as a ring, the heads on their stage, the temperatures as bars, the head on
// a map of the bed, fans that turn with their speed, the computer inside as tiles. A U1 shows more:
// per head nozzle, pressure advance, tool changes and filament sensor, the options of its display
// for the print, its light. A page to watch (the user's wish of 27.09.2026: no scrolling, "System" was
// out of sight): it fills the window, the print on top, the motion on the left, the rest in tabs on the
// right; on a phone it stays one column. The values over time are on "Diagramme".
import { go, hashOf, ui, isU1Printer, partLabel, LOCALE, activeName, fmtSize } from "../common.js";
import { T } from "../texts.js";
import { api } from "../api.js";
import { useLive } from "../live.js";
import { usePrintFile } from "./print-view.js";

const { ref, reactive, computed, watch, onMounted, onUnmounted } = Vue;
const S = T.monitor;
const U1 = T.u1;
const K = T.camera.print;
const RING = 2 * Math.PI * 52;   // length of the progress ring, radius 52
const ARC = Math.PI * 50;        // length of the speed gauge, a half circle of radius 50
const GRID = 50;                 // mm between two lines on the bed
// Where a temperature bar ends: heads and bed as hot as they get, drivers up to their limit (about
// 120 °C), sensors as warm as a room gets.
const scaleOf = (name) => (/^extruder\d*$/.test(name) ? 300 : name === "heater_bed" || /^tmc/.test(name) ? 120 : 80);
const JOB_CLASS = { standby: "ok", printing: "ok", complete: "ok", paused: "warn", cancelled: "warn", error: "err" };
let lastPanel = "temps";   // the tab on the right, kept while OrcaOne is open
const folds = { software: false, mcus: true };   // the parts of "System" open, kept as well

export default {
  name: "StatusPage",
  props: { instId: { type: String, default: null } },  // the page does not depend on an installation

  setup() {
    const host = ref(null);   // null while OrcaOne looks it up, "" without an address
    const isU1 = isU1Printer(ui.printer);
    const errorText = (code) => S.errors[code] || T.errors[code] || T.errors.unknown;
    // monitor.read, live; the last values stay while the printer does not answer.
    const printer = useLive(() => ui.printer);
    const data = computed(() => printer.value?.data?.monitor || null);
    const lookup = ref("");   // the address could not be looked up
    const failed = computed(() => lookup.value || (printer.value?.error ? errorText(printer.value.error) : ""));
    // The address only for the note without one; the values come live.
    onMounted(async () => {
      try {
        host.value = (await api.printers()).printers[ui.printer]?.host || "";
      } catch (err) {
        host.value = null;
        lookup.value = errorText(err.code);
      }
    });

    // ------------------------------------------------------------ numbers and names
    const num = (v, digits = 0) => (v == null ? "–" : v.toLocaleString(LOCALE, { minimumFractionDigits: digits, maximumFractionDigits: digits }));
    const pct = (v) => (v == null ? "–" : `${num(v * 100)} %`);
    const deg = (v) => (v == null ? "–" : `${num(v, 1)} °C`);
    function duration(seconds) {
      const minutes = Math.max(1, Math.round(seconds / 60));
      if (minutes < 48 * 60) return K.duration(Math.floor(minutes / 60), minutes % 60);
      return T.printers.live.days(Math.floor(minutes / 1440));
    }
    // Klipper's names as a person says them (common.js, also for "Diagramme").
    const label = (name) => partLabel(name, isU1);
    const netLabel = (name) => S.nets[Object.keys(S.nets).find((k) => name.startsWith(k))] || name;

    // ------------------------------------------------------------ the print and the heads
    const job = computed(() => data.value?.job || {});
    const running = computed(() => ["printing", "paused"].includes(job.value.state));
    const progress = computed(() => Math.min(1, Math.max(0, job.value.progress || 0)));
    const jobClass = computed(() => JOB_CLASS[job.value.state] || "wait");
    const options = computed(() => Object.entries(job.value.options || {}).filter(([, on]) => on).map(([o]) => T.files.options[o]));
    // The stage takes camera.status: the job with its heads.
    const stage = computed(() => ({ ...job.value, heads: data.value?.heads || [] }));
    // On the U1 the filament sensor of a head is called e0_filament … e3_filament.
    const headSensors = computed(() => (data.value?.heads || []).map((h, i) =>
      (data.value.filament.find((f) => f.name.endsWith(` e${i}_filament`)) || null)));
    const otherSensors = computed(() => (data.value?.filament || []).filter((f) => !(isU1 && / e\d+_filament$/.test(f.name))));
    // The tabs on the right: temperatures, fans, sensors that belong to no head, the computer inside.
    const panel = ref(lastPanel);
    const panels = computed(() => [
      { id: "temps", icon: "temp", label: S.temperatures }, { id: "fans", icon: "fan", label: S.fans },
      ...(otherSensors.value.length ? [{ id: "sensors", icon: "spool", label: S.sensors }] : []),
      { id: "system", icon: "window", label: S.system },
    ]);
    watch(panel, (p) => { lastPanel = p; });
    // What the computer inside is and its software, read once when "System" opens (camera.info, as the
    // cards on "Drucker"); the loads come live. {} when the printer did not say.
    const facts = ref(null);
    watch(panel, async (p) => {
      if (p !== "system" || facts.value) return;
      try {
        facts.value = await api.printerInfo(ui.printer);
      } catch {
        facts.value = {};
      }
    }, { immediate: true });
    // A microcontroller as a person says it: the main board, on the U1 the heads (mcu e0 …).
    function mcuLabel(name) {
      if (name === "mcu") return S.mainBoard;
      const m = /^mcu e(\d+)$/.exec(name);
      return m && isU1 ? U1.head(+m[1] + 1) : name.slice(4);
    }
    // The microcontrollers: live their load (monitor.shape), once their chip and firmware (camera.info).
    const mcuRows = computed(() => {
      const now = data.value?.mcus || [], known = facts.value?.mcus || [];
      return [...new Set([...now, ...known].map((m) => m.name))]
        .map((name) => ({ ...known.find((m) => m.name === name), ...now.find((m) => m.name === name), name }));
    });
    // "Software" and "Mikrocontroller" fold away (the user's wish of 27.09.2026).
    const open = reactive({ ...folds });
    function fold(key) {
      open[key] = folds[key] = !open[key];
    }
    const L = T.printers.live;
    const totals = computed(() => {
      const j = facts.value?.jobs;
      return j ? [L.prints(j.total_jobs || 0), L.printed(num((j.total_print_time || 0) / 3600, 1)), L.filament(num((j.total_filament_used || 0) / 1000))] : null;
    });
    watch(panels, (list) => { if (!list.some((p) => p.id === panel.value)) panel.value = "temps"; }, { immediate: true });
    // Arrows, Home and End move between the tabs, as a tab list does.
    function panelKey(ev) {
      const list = panels.value, i = list.findIndex((p) => p.id === panel.value);
      const at = { ArrowRight: i + 1, ArrowLeft: i - 1 + list.length, Home: 0, End: list.length - 1 }[ev.key];
      if (at == null || ev.altKey || ev.ctrlKey || ev.metaKey) return;
      ev.preventDefault();
      panel.value = list[at % list.length].id;
      Vue.nextTick(() => document.getElementById(`mon-tab-${panel.value}`)?.focus());
    }

    // ------------------------------------------------------------ bars, map, fans, tiles
    const barOf = (t) => `${Math.min(100, Math.max(0, (t.temp || 0) / scaleOf(t.name) * 100))}%`;
    const markOf = (t) => `${Math.min(100, (t.target || 0) / scaleOf(t.name) * 100)}%`;
    // The map, seen from above with the front at the bottom: the area the axes reach, in it the bed,
    // the head with its X and Y at its lines, the height as a ruler beside it. The bed is the area of
    // the bed mesh widened by its margin (U1: mesh 3 to 267 mm, bed 0 to 270); the axes reach
    // further, on the U1 to the heads parked behind the bed (Y 335). Without a mesh: the whole area.
    const map = computed(() => {
      const m = data.value?.motion;
      if (!m || m.min.length < 3 || m.max.length < 3) return null;
      const [x0, y0, z0] = m.min, [x1, y1, z1] = m.max, [x, y, z] = m.position.map((v) => v ?? 0);
      const w = x1 - x0, h = y1 - y0;
      if (!(w > 0 && h > 0 && z1 > z0)) return null;
      const [lo, hi] = m.mesh || [];
      const meshed = lo?.length === 2 && hi?.length === 2 && hi[0] > lo[0] && hi[1] > lo[1];
      const bw = meshed ? Math.min(x1, hi[0] + lo[0] - x0) - x0 : w, bh = meshed ? Math.min(y1, hi[1] + lo[1] - y0) - y0 : h;
      const share = (v, from, span) => Math.min(100, Math.max(0, (v - from) / span * 100));
      return {
        ratio: `${w} / ${h}`, r: w / h,
        bed: { left: 0, bottom: 0, width: `${bw / w * 100}%`, height: `${bh / h * 100}%`,
               backgroundSize: `${GRID / bw * 100}% ${GRID / bh * 100}%` },
        hx: share(x, x0, w), hy: share(y, y0, h), zp: share(z, z0, z1 - z0), top: z1,
        homed: m.homed.includes("x") && m.homed.includes("y"), zHomed: m.homed.includes("z"),
      };
    });
    // The path of the layer in work under the head (the user's wish of 25.09.2026: "schemenhaft die
    // Druckbahn vom aktuellen Layer"): the print file as "2D Ansicht" reads it (print-view.js, only
    // while the printer prints it), the whole layer faint, what of it is printed stronger. A canvas
    // over the map in the printer's coordinates, drawn anew with every live value.
    const file = usePrintFile(() => {}, { whilePrinting: true });
    const pathCanvas = ref(null);
    const pathLayer = computed(() => (file.data.value && file.printing.value && map.value?.homed ? file.printedLayer.value : 0));
    function drawPath() {
      const c = pathCanvas.value;
      if (!c) return;
      const dpr = window.devicePixelRatio || 1, cw = Math.round(c.clientWidth * dpr), ch = Math.round(c.clientHeight * dpr);
      if (c.width !== cw || c.height !== ch) Object.assign(c, { width: cw, height: ch });
      const g = c.getContext("2d"), d = file.data.value, m = data.value?.motion, L = pathLayer.value;
      g.clearRect(0, 0, cw, ch);
      if (!L || !d || !m || !cw || !ch) return;
      const [x0, y0] = m.min, [x1, y1] = m.max, u = d.unit, pos = d.pos;
      const kx = cw / (x1 - x0), ky = ch / (y1 - y0);
      const a = L <= 1 ? 0 : d.layerStart[L - 1], b = L >= d.layerStart.length ? d.count : d.layerStart[L];
      // The page's colours hold light-dark(…): resolved through the canvas itself.
      const colour = (name) => {
        c.style.color = `var(${name})`;
        return getComputedStyle(c).color;
      };
      const stroke = (from, to, name, alpha, width) => {
        g.beginPath();
        let lx = NaN, ly = NaN;
        for (let i = from; i < to; i++) {
          const p = i * 5, sx = (pos[p] / u - x0) * kx, sy = (y1 - pos[p + 1] / u) * ky;
          if (sx !== lx || sy !== ly) g.moveTo(sx, sy);
          lx = (pos[p + 3] / u - x0) * kx;
          ly = (y1 - pos[p + 4] / u) * ky;
          g.lineTo(lx, ly);
        }
        Object.assign(g, { strokeStyle: colour(name), globalAlpha: alpha, lineWidth: width * dpr, lineJoin: "round" });
        g.stroke();
      };
      stroke(a, b, "--muted", 0.5, 1);
      stroke(a, Math.min(b, file.printedCount.value), "--accent-text", 0.9, 1.5);
      g.globalAlpha = 1;
    }
    watch([pathLayer, file.printedCount, file.data, () => data.value?.motion.min?.join()], drawPath);
    let resizer = null;
    watch(pathCanvas, (c) => {
      resizer?.disconnect();
      resizer = c ? new ResizeObserver(drawPath) : null;
      resizer?.observe(c);
    });
    onUnmounted(() => resizer?.disconnect());
    const speedShare = computed(() => {
      const m = data.value?.motion;
      return m?.max_velocity ? Math.min(1, Math.max(0, (m.speed || 0) / m.max_velocity)) : 0;
    });
    // A fan turns faster with its speed; standing still it does not turn.
    const spin = (f) => (f.speed > 0 ? { animationDuration: `${(0.6 / f.speed).toFixed(2)}s` } : null);
    const memory = computed(() => {
      const m = data.value?.system.memory;
      return m?.total ? { text: `${fmtSize(m.used * 1024)} / ${fmtSize(m.total * 1024)}`, pct: m.used / m.total } : null;
    });

    return {
      T, S, U1, K, RING, host, data, failed, isU1, job, running, progress, jobClass, options, stage, headSensors, otherSensors, panel, panels, panelKey,
      facts, mcuLabel, totals, mcuRows, open, fold,
      barOf, markOf, map, pathCanvas, pathLayer, speedShare, ARC, spin, memory, num, pct, deg, duration, label, netLabel, activeName, fmtSize, go, hashOf,
    };
  },

  template: `
    <div class="page fill-page status-page">
      <h1 id="page-title" tabindex="-1">{{ S.title }}</h1>

      <p v-if="host === ''" class="empty">{{ S.noHost(activeName()) }}
        <a class="link" :href="hashOf('drucker', instId)" @click="go($event, hashOf('drucker', instId))">{{ S.toPrinters }}</a></p>
      <p v-else-if="!data && !failed" class="note">{{ T.printers.live.asking }}</p>
      <template v-else>
        <p v-if="failed" class="alert" role="alert">{{ failed }}</p>
        <template v-if="data">

          <!-- The print as a ring, the heads on their stage -->
          <section class="box mon-hero" aria-labelledby="mon-job">
            <div class="mon-job">
              <svg class="mon-ring" viewBox="0 0 120 120" width="120" height="120" role="img" :aria-label="S.progress(Math.round(progress * 100))">
                <circle class="mon-ring-track" cx="60" cy="60" r="52"/>
                <circle :class="['mon-ring-fill', 'is-' + jobClass]" cx="60" cy="60" r="52" transform="rotate(-90 60 60)"
                        :stroke-dasharray="RING" :stroke-dashoffset="RING * (1 - (running || job.state === 'complete' ? progress : 0))"/>
                <text class="mon-ring-pct" x="60" y="64" text-anchor="middle">{{ running || job.state === 'complete' ? Math.round(progress * 100) + ' %' : '–' }}</text>
              </svg>
              <div class="mon-job-text">
                <p class="mon-job-who">{{ activeName() }} · {{ host }}</p>
                <h2 id="mon-job" class="mon-job-title" :title="job.file">{{ job.file && job.state !== 'standby' ? job.file : S.noJob }}</h2>
                <p :class="['cam-status', 'mon-state', 'is-' + jobClass]"><span class="cam-dot"></span>{{ U1.states[job.state] || job.state || '–' }}</p>
                <p v-if="job.state !== 'standby'" class="mon-facts">
                  <span v-if="job.layers && job.layer != null">{{ K.layer(job.layer, job.layers) }}</span>
                  <span v-if="running && job.left != null">{{ K.left(duration(job.left)) }}</span>
                  <span v-if="job.printed">{{ K.printed(duration(job.printed)) }}</span>
                  <span v-if="job.filament">{{ S.filamentUsed(num(job.filament / 1000, 2)) }}</span>
                </p>
                <p class="mon-facts">
                  <span v-if="job.speed_factor != null">{{ S.speedFactor(pct(job.speed_factor)) }}</span>
                  <span v-if="job.flow_factor != null">{{ S.flowFactor(pct(job.flow_factor)) }}</span>
                </p>
                <p v-if="running && options.length" class="mon-facts">{{ S.options }} {{ options.join(' · ') }}</p>
                <p v-if="job.message" class="note">{{ job.message }}</p>
              </div>
            </div>
            <printer-stage v-if="data.heads.length" :p="stage" :u1="isU1" details :sensors="headSensors"/>
          </section>

          <div class="mon-grid">
            <section class="box mon-motion" aria-labelledby="mon-motion">
              <h2 id="mon-motion" class="mon-title"><ui-icon name="arrowRight"/>{{ S.motion }}</h2>
              <div v-if="map" class="motion-map" :style="{ '--r': map.r }">
                <div class="xy-frame">
                  <div class="xy" :style="{ aspectRatio: map.ratio }" role="img"
                       :aria-label="map.homed ? S.headAt(num(data.motion.position[0], 1), num(data.motion.position[1], 1)) : S.notHomed">
                    <div class="xy-bed" :style="map.bed"><span v-if="!map.homed" class="xy-note">{{ S.notHomed }}</span></div>
                    <canvas ref="pathCanvas" class="xy-path" aria-hidden="true"></canvas>
                    <template v-if="map.homed">
                      <span class="xy-vline" :style="{ left: map.hx + '%' }"></span>
                      <span class="xy-hline" :style="{ bottom: map.hy + '%' }"></span>
                      <span class="xy-head" :style="{ left: map.hx + '%', bottom: map.hy + '%' }"></span>
                      <span class="xy-label is-x" :style="{ left: map.hx + '%' }">X {{ num(data.motion.position[0], 1) }}</span>
                      <span class="xy-label is-y" :style="{ bottom: map.hy + '%' }">Y {{ num(data.motion.position[1], 1) }}</span>
                    </template>
                  </div>
                </div>
                <div class="zruler" :title="S.height">
                  <span>{{ num(map.top) }}</span>
                  <span class="zruler-bar">
                    <span v-if="map.zHomed" class="zruler-mark" :style="{ bottom: map.zp + '%' }"><b>Z {{ num(data.motion.position[2], 1) }}</b></span>
                  </span>
                  <span>0 mm</span>
                </div>
              </div>
              <p v-if="pathLayer" class="xy-path-note">{{ S.pathNote(pathLayer) }}</p>
              <div class="motion-gauges">
                <div class="gauge">
                  <svg viewBox="0 0 120 66" aria-hidden="true">
                    <path class="gauge-track" d="M10 60 A50 50 0 0 1 110 60"/>
                    <path class="gauge-fill" d="M10 60 A50 50 0 0 1 110 60" :stroke-dasharray="ARC" :stroke-dashoffset="ARC * (1 - speedShare)"/>
                  </svg>
                  <strong>{{ num(data.motion.speed) }}</strong><small>mm/s · {{ S.speed }}</small>
                </div>
                <div class="gauge is-flat"><strong>{{ num(data.motion.flow, 1) }}</strong><small>mm³/s · {{ S.flow }}</small></div>
              </div>
              <p class="mon-quiet mon-limits">{{ S.limits }}: {{ num(data.motion.max_velocity) }} mm/s · {{ num(data.motion.max_accel) }} mm/s²</p>
            </section>

            <!-- Beside it the rest as tabs: what gets warm, what turns, the sensors, the computer inside -->
            <section class="box mon-more">
              <div class="mon-tabs" role="tablist" :aria-label="S.panels" @keydown="panelKey">
                <button v-for="p in panels" :id="'mon-tab-' + p.id" :key="p.id" :class="['mon-tab', { 'is-current': panel === p.id }]" type="button"
                        role="tab" :aria-selected="panel === p.id ? 'true' : 'false'" aria-controls="mon-panel" :tabindex="panel === p.id ? 0 : -1"
                        @click="panel = p.id"><ui-icon :name="p.icon" :size="16"/>{{ p.label }}</button>
              </div>
              <div id="mon-panel" class="mon-panel" role="tabpanel" :aria-labelledby="'mon-tab-' + panel">
              <!-- Temperatures as bars: the fill up to now, a mark at the target -->
              <template v-if="panel === 'temps'">
                <!-- A driver from green to red over its scale (the user: 90 °C for long is not good), warm from 70 °C, hot from 90 °C -->
                <div v-for="t in data.temperatures" :key="t.name"
                     :class="['thermo', { 'is-heating': t.target > 0, 'is-driver': t.driver, 'is-warm': t.driver && t.temp >= 70, 'is-hot': t.driver && t.temp >= 90 }]">
                  <span class="thermo-name">{{ label(t.name) }}</span>
                  <span class="thermo-bar"><span class="thermo-fill" :style="t.driver ? { '--w': barOf(t) } : { width: barOf(t) }"></span>
                    <span v-if="t.target" class="thermo-target" :style="{ left: markOf(t) }"></span></span>
                  <span class="thermo-value">{{ deg(t.temp) }}<small v-if="t.target"> → {{ deg(t.target) }}</small></span>
                  <!-- A heater's power as a bar of its own, always there: a line that came and went made the rows jump (the user) -->
                  <span v-if="t.power != null" class="thermo-power">
                    <span class="thermo-power-bar"><span :style="{ width: Math.min(100, Math.max(0, t.power * 100)) + '%' }"></span></span>
                    <small>{{ S.heaterPower(pct(t.power)) }}</small></span>
                  <small v-else-if="t.min != null" class="thermo-note">{{ S.measured(deg(t.min), deg(t.max)) }}</small>
                  <small v-else-if="t.driver && t.temp == null" class="thermo-note">{{ S.driverIdle }}</small>
                </div>
              </template>
              <!-- Fans turn with their speed -->
              <template v-else-if="panel === 'fans'">
                <p v-if="!data.fans.length" class="note">{{ S.none }}</p>
                <!-- As the temperatures (the user's wish of 27.09.2026): the speed as a bar, the fan turning with it, the rpm below -->
                <div v-for="f in data.fans" :key="f.name" :class="['thermo', 'fanrow', { 'is-on': f.speed > 0 }]" :title="f.name">
                  <ui-icon name="fan" :size="20" :style="spin(f)"/>
                  <span class="thermo-name">{{ label(f.name) }}</span>
                  <span class="thermo-bar"><span class="thermo-fill" :style="{ width: Math.min(100, Math.max(0, (f.speed || 0) * 100)) + '%' }"></span></span>
                  <span class="thermo-value">{{ pct(f.speed) }}</span>
                  <small v-if="f.rpm != null" class="thermo-note">{{ num(f.rpm) }} {{ S.rpm }}</small>
                </div>
              </template>
              <!-- Filament sensors that belong to no head -->
              <template v-else-if="panel === 'sensors'">
                <dl class="mon-list">
                  <div v-for="f in otherSensors" :key="f.name"><dt :title="f.name">{{ label(f.name) }}</dt>
                    <dd :class="f.detected ? 'st-on' : 'is-warn'">{{ f.enabled === false ? S.disabled : f.detected ? S.filamentIn : S.filamentOut }}</dd></div>
                </dl>
              </template>
              <!-- The computer inside, as tiles -->
              <div v-else class="mon-sys">
                <div class="thermo is-text"><span class="thermo-name">{{ S.klipper }}</span>
                  <span :class="['thermo-value', data.klipper.state === 'ready' ? 'st-on' : 'is-warn']">{{ S.klipperStates[data.klipper.state] || data.klipper.state || '–' }}</span></div>
                <!-- The load, and below it each core as a little column -->
                <div v-if="data.system.cpu != null" class="thermo is-system">
                  <span class="thermo-name">{{ S.cpu }}</span>
                  <span class="thermo-bar"><span class="thermo-fill" :style="{ width: Math.min(100, data.system.cpu) + '%' }"></span></span>
                  <span class="thermo-value">{{ num(data.system.cpu) }} %</span>
                  <span v-if="data.system.cores.length > 1" class="thermo-note sys-cores" :title="data.system.cores.map((c) => num(c) + ' %').join(' · ')">
                    <span v-for="(c, i) in data.system.cores" :key="i" :style="{ height: Math.max(8, Math.min(100, c || 0)) + '%' }"></span></span>
                </div>
                <!-- The temperature from green to red as the drivers: warm from 70 °C, hot from 85 °C -->
                <div v-if="data.system.cpu_temp != null"
                     :class="['thermo', 'is-driver', { 'is-warm': data.system.cpu_temp >= 70, 'is-hot': data.system.cpu_temp >= 85 }]">
                  <span class="thermo-name">{{ S.cpuTemp }}</span>
                  <span class="thermo-bar"><span class="thermo-fill" :style="{ '--w': Math.min(100, data.system.cpu_temp / 120 * 100) + '%' }"></span></span>
                  <span class="thermo-value">{{ deg(data.system.cpu_temp) }}</span>
                </div>
                <div v-if="memory" class="thermo is-system"><span class="thermo-name">{{ S.memory }}</span>
                  <span class="thermo-bar"><span class="thermo-fill" :style="{ width: memory.pct * 100 + '%' }"></span></span>
                  <span class="thermo-value">{{ memory.text }}</span></div>
                <div v-if="facts?.disk" class="thermo is-system"><span class="thermo-name">{{ S.disk }}</span>
                  <span class="thermo-bar"><span class="thermo-fill" :style="{ width: (facts.disk.used / facts.disk.total * 100) + '%' }"></span></span>
                  <span class="thermo-value">{{ fmtSize(facts.disk.used) }} / {{ fmtSize(facts.disk.total) }}</span></div>
                <div v-for="n in data.system.network" :key="n.name" class="thermo is-text" :title="n.name"><span class="thermo-name">{{ netLabel(n.name) }}</span>
                  <span class="thermo-value">{{ n.bandwidth != null ? S.perSecond(fmtSize(n.bandwidth)) : '–' }}</span></div>
                <div v-if="data.system.uptime != null" class="thermo is-text"><span class="thermo-name">{{ S.uptime }}</span>
                  <span class="thermo-value">{{ duration(data.system.uptime) }}</span></div>
                <!-- Right below: the prints in total, who watches Moonraker, what Moonraker itself takes -->
                <div v-if="totals" class="thermo is-text"><span class="thermo-name">{{ S.totals }}</span>
                  <span class="thermo-value thermo-lines"><span v-for="t in totals" :key="t">{{ t }}</span></span></div>
                <div v-if="data.system.websockets != null" class="thermo is-text" :title="S.clientsHint"><span class="thermo-name">{{ S.clients }}</span>
                  <span class="thermo-value">{{ num(data.system.websockets) }}</span></div>
                <div v-if="data.system.moonraker.cpu != null" class="thermo is-system"><span class="thermo-name">{{ S.moonrakerLoad }}</span>
                  <span class="thermo-bar"><span class="thermo-fill" :style="{ width: Math.min(100, data.system.moonraker.cpu) + '%' }"></span></span>
                  <span class="thermo-value">{{ num(data.system.moonraker.cpu, 1) }} %<small v-if="data.system.moonraker.memory != null"> · {{ fmtSize(data.system.moonraker.memory * 1024) }}</small></span></div>
                <!-- Each microcontroller's load (graphstats' reckoning), its firmware and chip below; the U1: board and heads -->
                <section v-if="mcuRows.length" class="mon-fold">
                  <button type="button" class="mon-fold-head" :aria-expanded="open.mcus ? 'true' : 'false'" @click="fold('mcus')">
                    <ui-icon name="chevron" :size="14" class="chev"/>{{ S.mcus }}<small>{{ mcuRows.length }}</small></button>
                  <template v-if="open.mcus">
                    <!-- Firmware and chip only in the tooltip (the user: too much for nothing on the page) -->
                    <div v-for="m in mcuRows" :key="m.name" :class="['thermo', 'is-system', { 'is-hot': m.load >= 90 }]"
                         :title="[m.name, m.version, m.chip, m.awake != null ? S.awake(num(m.awake, 1)) : ''].filter(Boolean).join(' · ')">
                      <span class="thermo-name">{{ mcuLabel(m.name) }}</span>
                      <span class="thermo-bar"><span class="thermo-fill" :style="{ width: Math.min(100, m.load || 0) + '%' }"></span></span>
                      <span class="thermo-value">{{ m.load != null ? num(m.load, 1) + ' %' : '–' }}</span>
                    </div>
                  </template>
                </section>
                <p v-if="!facts" class="note">{{ T.printers.live.asking }}</p>
                <section v-else class="mon-fold">
                  <button type="button" class="mon-fold-head" :aria-expanded="open.software ? 'true' : 'false'" @click="fold('software')">
                    <ui-icon name="chevron" :size="14" class="chev"/>{{ S.software }}</button>
                  <dl v-if="open.software" class="mon-list">
                    <div v-if="facts.cpu?.model || facts.cpu?.cores"><dt>{{ S.processor }}</dt>
                      <dd>{{ [facts.cpu.model, facts.cpu.cores ? S.cores(facts.cpu.cores) : ''].filter(Boolean).join(' · ') }}</dd></div>
                    <div v-if="facts.os"><dt>{{ S.os }}</dt><dd>{{ facts.os }}</dd></div>
                    <div v-if="facts.firmware"><dt>{{ T.printers.live.firmware }}</dt><dd>{{ facts.firmware }}</dd></div>
                    <div v-if="facts.klipper"><dt>Klipper</dt><dd class="mono">{{ facts.klipper }}</dd></div>
                    <div v-if="facts.moonraker"><dt>Moonraker</dt><dd class="mono">{{ facts.moonraker }}</dd></div>
                    <div v-if="facts.python"><dt>Python</dt><dd>{{ facts.python }}</dd></div>
                  </dl>
                </section>
              </div>
              </div>
            </section>
          </div>
        </template>
      </template>
    </div>
  `,
};
