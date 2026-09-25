// Page "Status" (the user's wish of 24.09.2026): what the printer of the top bar is doing right
// now, for any Klipper printer with an address; read only, every two seconds while the page is
// visible (orcaone/monitor.py, Moonraker's REST API). As pictures where they help (the user: not so
// "trocken"): the print as a ring, the heads on their stage, the temperatures as bars, the head on
// a map of the bed, fans that turn with their speed, the computer inside as tiles. A U1 shows more:
// per head nozzle, pressure advance, tool changes and filament sensor, the options of its display
// for the print, its light. No charts over time yet, a topic of its own (the user).
import { go, hashOf, ui, U1_MODELS, LOCALE, activeName, fmtSize } from "../common.js";
import { T } from "../texts.js";
import { api } from "../api.js";

const { ref, computed, onMounted, onUnmounted } = Vue;
const S = T.monitor;
const U1 = T.u1;
const K = T.camera.print;
const EVERY = 2000;              // ms between two looks at the printer
const RING = 2 * Math.PI * 52;   // length of the progress ring, radius 52
const ARC = Math.PI * 50;        // length of the speed gauge, a half circle of radius 50
const GRID = 50;                 // mm between two lines on the bed
// Where a temperature bar ends: heads and bed as hot as they get, sensors as warm as a room gets.
const scaleOf = (name) => (/^extruder\d*$/.test(name) ? 300 : name === "heater_bed" ? 120 : 80);
const JOB_CLASS = { standby: "ok", printing: "ok", complete: "ok", paused: "warn", cancelled: "warn", error: "err" };

export default {
  name: "StatusPage",
  props: { instId: { type: String, default: null } },  // the page does not depend on an installation

  setup() {
    const host = ref(null);   // null while OrcaOne looks it up, "" without an address
    const data = ref(null);   // monitor.read
    const failed = ref("");
    const isU1 = U1_MODELS.includes(ui.printer);
    const errorText = (err) => S.errors[err.code] || T.errors[err.code] || T.errors.unknown;
    let timer = 0, reading = false;
    // One look at a time: over a slow network one takes about half a second (the U1 over VPN).
    async function read() {
      if (document.hidden || !host.value || reading) return;
      reading = true;
      try {
        data.value = await api.printerMonitor(ui.printer);
        failed.value = "";
      } catch (err) {
        failed.value = errorText(err);
      } finally {
        reading = false;
      }
    }
    onMounted(async () => {
      try {
        host.value = (await api.printers()).printers[ui.printer]?.host || "";
      } catch (err) {
        host.value = null;
        failed.value = errorText(err);
        return;
      }
      read();
      timer = setInterval(read, EVERY);
    });
    // Back in view: at once, not only with the next tick.
    document.addEventListener("visibilitychange", read);
    onUnmounted(() => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", read);
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
    // Klipper's names as a person says them; on the U1 its heads and their fans by number
    // (printer.cfg: [fan] and e1_fan … e3_fan cool the part, e0_nozzle_fan … the hotends).
    function label(name) {
      const rest = name.includes(" ") ? name.slice(name.indexOf(" ") + 1) : "";
      let m;
      if (name === "heater_bed") return S.names.bed;
      if ((m = /^extruder(\d*)$/.exec(name))) return isU1 ? U1.head(+(m[1] || 0) + 1) : S.names.extruder(m[1]);
      if (name === "fan") return isU1 ? `${U1.head(1)} · ${S.names.partFan}` : S.names.partFan;
      if (isU1 && (m = /^e(\d+)_fan$/.exec(rest))) return `${U1.head(+m[1] + 1)} · ${S.names.partFan}`;
      if (isU1 && (m = /^e(\d+)_nozzle_fan$/.exec(rest))) return `${U1.head(+m[1] + 1)} · ${S.names.hotendFan}`;
      return S.names[rest] || (rest || name).replace(/_/g, " ");
    }
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
        ratio: `${w} / ${h}`,
        bed: { left: 0, bottom: 0, width: `${bw / w * 100}%`, height: `${bh / h * 100}%`,
               backgroundSize: `${GRID / bw * 100}% ${GRID / bh * 100}%` },
        hx: share(x, x0, w), hy: share(y, y0, h), zp: share(z, z0, z1 - z0), top: z1,
        homed: m.homed.includes("x") && m.homed.includes("y"), zHomed: m.homed.includes("z"),
      };
    });
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
      T, S, U1, K, RING, host, data, failed, isU1, job, running, progress, jobClass, options, stage, headSensors, otherSensors,
      barOf, markOf, map, speedShare, ARC, spin, memory, num, pct, deg, duration, label, netLabel, activeName, fmtSize, go, hashOf,
    };
  },

  template: `
    <div class="page">
      <h1 id="page-title" tabindex="-1">{{ S.title }}</h1>
      <p class="note">{{ S.lead }}</p>

      <p v-if="host === ''" class="empty">{{ S.noHost(activeName()) }}
        <a class="link" :href="hashOf('drucker', instId)" @click="go($event, hashOf('drucker', instId))">{{ S.toPrinters }}</a></p>
      <p v-else-if="!data && !failed" class="note">{{ T.loading }}</p>
      <template v-else>
        <p v-if="failed" class="alert" role="alert">{{ failed }}</p>
        <template v-if="data">
          <p v-if="data.klipper.state && data.klipper.state !== 'ready'" class="banner">
            {{ S.klipperNotReady(S.klipperStates[data.klipper.state] || data.klipper.state) }} {{ data.klipper.message }}</p>

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
            <!-- Temperatures as bars: the fill up to now, a mark at the target -->
            <section class="box" aria-labelledby="mon-temps">
              <h2 id="mon-temps" class="mon-title"><ui-icon name="temp"/>{{ S.temperatures }}</h2>
              <div v-for="t in data.temperatures" :key="t.name" :class="['thermo', { 'is-heating': t.target > 0 }]">
                <span class="thermo-name">{{ label(t.name) }}</span>
                <span class="thermo-bar"><span class="thermo-fill" :style="{ width: barOf(t) }"></span>
                  <span v-if="t.target" class="thermo-target" :style="{ left: markOf(t) }"></span></span>
                <span class="thermo-value">{{ deg(t.temp) }}<small v-if="t.target"> → {{ deg(t.target) }}</small></span>
                <small v-if="t.power" class="thermo-note">{{ S.heaterPower(pct(t.power)) }}</small>
                <small v-else-if="t.min != null" class="thermo-note">{{ S.measured(deg(t.min), deg(t.max)) }}</small>
              </div>
            </section>

            <!-- The bed from above with the head on it, the height as a ruler, the speed as a gauge -->
            <section class="box" aria-labelledby="mon-motion">
              <h2 id="mon-motion" class="mon-title"><ui-icon name="arrowRight"/>{{ S.motion }}</h2>
              <div v-if="map" class="motion-map">
                <div class="xy-frame">
                  <div class="xy" :style="{ aspectRatio: map.ratio }" role="img"
                       :aria-label="map.homed ? S.headAt(num(data.motion.position[0], 1), num(data.motion.position[1], 1)) : S.notHomed">
                    <div class="xy-bed" :style="map.bed"><span v-if="!map.homed" class="xy-note">{{ S.notHomed }}</span></div>
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

            <!-- Fans turn with their speed -->
            <section class="box" aria-labelledby="mon-fans">
              <h2 id="mon-fans" class="mon-title"><ui-icon name="fan"/>{{ S.fans }}</h2>
              <p v-if="!data.fans.length" class="note">{{ S.none }}</p>
              <div v-else class="fans">
                <div v-for="f in data.fans" :key="f.name" :class="['fan', { 'is-on': f.speed > 0 }]" :title="f.name">
                  <ui-icon name="fan" :size="26" :style="spin(f)"/>
                  <span class="fan-text"><span>{{ label(f.name) }}</span>
                    <strong>{{ pct(f.speed) }}<small v-if="f.rpm"> · {{ num(f.rpm) }} {{ S.rpm }}</small></strong></span>
                </div>
              </div>
            </section>

            <!-- Filament sensors that belong to no head -->
            <section v-if="otherSensors.length" class="box" aria-labelledby="mon-sensors">
              <h2 id="mon-sensors" class="mon-title"><ui-icon name="spool"/>{{ S.sensors }}</h2>
              <dl class="mon-list">
                <div v-for="f in otherSensors" :key="f.name"><dt :title="f.name">{{ label(f.name) }}</dt>
                  <dd :class="f.detected ? 'st-on' : 'is-warn'">{{ f.enabled === false ? S.disabled : f.detected ? S.filamentIn : S.filamentOut }}</dd></div>
              </dl>
            </section>

            <!-- The computer inside, as tiles -->
            <section class="box" aria-labelledby="mon-system">
              <h2 id="mon-system" class="mon-title"><ui-icon name="window"/>{{ S.system }}</h2>
              <div class="sys-tiles">
                <div class="sys-tile"><small>{{ S.klipper }}</small><strong :class="data.klipper.state === 'ready' ? 'st-on' : 'is-warn'">{{ S.klipperStates[data.klipper.state] || data.klipper.state || '–' }}</strong></div>
                <div v-if="data.system.cpu != null" class="sys-tile"><small>{{ S.cpu }}</small><strong>{{ num(data.system.cpu) }} %</strong>
                  <span class="sys-bar"><span :style="{ width: Math.min(100, data.system.cpu) + '%' }"></span></span></div>
                <div v-if="data.system.cpu_temp != null" class="sys-tile"><small>{{ S.cpuTemp }}</small><strong>{{ deg(data.system.cpu_temp) }}</strong></div>
                <div v-if="memory" class="sys-tile"><small>{{ S.memory }}</small><strong class="sys-small">{{ memory.text }}</strong>
                  <span class="sys-bar"><span :style="{ width: memory.pct * 100 + '%' }"></span></span></div>
                <div v-for="n in data.system.network" :key="n.name" class="sys-tile" :title="n.name"><small>{{ netLabel(n.name) }}</small>
                  <strong>{{ n.bandwidth != null ? S.perSecond(fmtSize(n.bandwidth)) : '–' }}</strong></div>
                <div v-if="data.system.uptime != null" class="sys-tile"><small>{{ S.uptime }}</small><strong>{{ duration(data.system.uptime) }}</strong></div>
              </div>
            </section>
          </div>
        </template>
      </template>
    </div>
  `,
};
