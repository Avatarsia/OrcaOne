// Page "Status" (the user's wish of 24.09.2026): what the printer of the top bar is doing right
// now, for any Klipper printer with an address; read only, every two seconds while the page is
// visible (orcaone/monitor.py, Moonraker's REST API). The job, temperatures, motion, fans,
// filament sensors and the computer inside; a U1 shows more: its heads with spool, nozzle,
// pressure advance and tool changes, the options of its display for the print, its light.
// No charts yet, a topic of its own (the user).
import { go, hashOf, ui, U1_MODELS, LOCALE, activeName, fmtSize } from "../common.js";
import { T } from "../texts.js";
import { api } from "../api.js";
import { PrintStatus } from "./kamera.js";

const { ref, computed, onMounted, onUnmounted } = Vue;
const S = T.monitor;
const U1 = T.u1;
const EVERY = 2000;  // ms between two looks at the printer

export default {
  name: "StatusPage",
  components: { PrintStatus },
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
    onUnmounted(() => clearInterval(timer));

    // ------------------------------------------------------------ numbers and names
    const num = (v, digits = 0) => (v == null ? "–" : v.toLocaleString(LOCALE, { minimumFractionDigits: digits, maximumFractionDigits: digits }));
    const pct = (v) => (v == null ? "–" : `${num(v * 100)} %`);
    const deg = (v) => (v == null ? "–" : `${num(v, 1)} °C`);
    function duration(seconds) {
      const minutes = Math.round(seconds / 60);
      if (minutes < 60) return T.printers.live.minutes(minutes);
      if (minutes < 48 * 60) return T.printers.live.hours(Math.floor(minutes / 60), minutes % 60);
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

    // ------------------------------------------------------------ what the page shows
    const running = computed(() => ["printing", "paused"].includes(data.value?.job.state));
    // A table of the heads where there is something per head: the U1 with spools and tool changes.
    const showHeads = computed(() => !!data.value?.heads.some((h) => h.spool || h.changes != null));
    // On the U1 the filament sensor of a head is called e0_filament … e3_filament.
    const sensorOf = (i) => data.value.filament.find((f) => f.name.endsWith(` e${i}_filament`)) || null;
    const otherSensors = computed(() => (data.value?.filament || []).filter((f) => !(showHeads.value && / e\d+_filament$/.test(f.name))));
    const options = computed(() => Object.entries(data.value?.job.options || {}).filter(([, on]) => on).map(([o]) => T.files.options[o]));
    const memory = computed(() => {
      const m = data.value?.system.memory;
      return m?.total ? `${fmtSize(m.used * 1024)} / ${fmtSize(m.total * 1024)}` : "–";
    });
    const homed = computed(() => (data.value?.motion.homed ? data.value.motion.homed.toUpperCase().split("").join(" ") : S.notHomed));
    const position = computed(() => ["X", "Y", "Z"].map((a, i) => `${a} ${num(data.value?.motion.position[i], 1)}`).join(" · "));

    return {
      T, S, U1, host, data, failed, isU1, running, showHeads, sensorOf, otherSensors, options, memory, homed, position,
      num, pct, deg, duration, label, netLabel, activeName, fmtSize, go, hashOf,
    };
  },

  template: `
    <div class="page status-page">
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

          <section class="box" aria-labelledby="mon-job">
            <div class="box-head"><h2 id="mon-job">{{ S.job }}</h2><span class="sub">{{ activeName() }} · {{ host }}</span></div>
            <print-status :p="data.job"/>
            <div class="mon-facts">
              <span v-if="data.job.filament">{{ S.filamentUsed(num(data.job.filament / 1000, 2)) }}</span>
              <span v-if="data.job.speed_factor != null">{{ S.speedFactor(pct(data.job.speed_factor)) }}</span>
              <span v-if="data.job.flow_factor != null">{{ S.flowFactor(pct(data.job.flow_factor)) }}</span>
              <span v-if="data.job.light != null"><ui-icon name="bulb" :size="14"/>{{ data.job.light ? S.lightOn : S.lightOff }}</span>
            </div>
            <p v-if="running && options.length" class="mon-facts">{{ S.options }} {{ options.join(' · ') }}</p>
            <p v-if="data.job.message" class="note">{{ data.job.message }}</p>
          </section>

          <div class="mon-grid">
            <section class="box" aria-labelledby="mon-temps">
              <h2 id="mon-temps" class="mon-title"><ui-icon name="temp"/>{{ S.temperatures }}</h2>
              <table class="mon-table">
                <thead><tr><th></th><th>{{ S.cols.actual }}</th><th>{{ S.cols.target }}</th><th>{{ S.cols.power }}</th></tr></thead>
                <tbody>
                  <tr v-for="t in data.temperatures" :key="t.name" :class="{ 'is-heating': t.target > 0 }">
                    <th scope="row">{{ label(t.name) }}</th>
                    <td>{{ deg(t.temp) }}</td>
                    <template v-if="t.power != null">
                      <td>{{ t.target ? deg(t.target) : S.off }}</td>
                      <td>{{ pct(t.power) }}</td>
                    </template>
                    <td v-else colspan="2" class="mon-quiet">{{ t.min != null ? S.measured(deg(t.min), deg(t.max)) : '' }}</td>
                  </tr>
                </tbody>
              </table>
            </section>

            <section class="box" aria-labelledby="mon-motion">
              <h2 id="mon-motion" class="mon-title"><ui-icon name="arrowRight"/>{{ S.motion }}</h2>
              <dl class="mon-list">
                <div><dt>{{ S.speed }}</dt><dd>{{ num(data.motion.speed) }} mm/s</dd></div>
                <div><dt>{{ S.flow }}</dt><dd>{{ num(data.motion.flow, 1) }} mm³/s</dd></div>
                <div><dt>{{ S.position }}</dt><dd>{{ position }}</dd></div>
                <div><dt>{{ S.homed }}</dt><dd>{{ homed }}</dd></div>
                <div v-if="data.heads.length > 1"><dt>{{ S.activeHead }}</dt><dd>{{ data.job.active ? label(data.job.active) : '–' }}</dd></div>
                <div v-if="!showHeads && data.heads[0]?.pa != null"><dt>{{ S.pa }}</dt><dd>{{ num(data.heads[0].pa, 3) }}</dd></div>
                <div><dt>{{ S.limits }}</dt><dd>{{ num(data.motion.max_velocity) }} mm/s · {{ num(data.motion.max_accel) }} mm/s²</dd></div>
              </dl>
            </section>

            <section v-if="showHeads" class="box mon-wide" aria-labelledby="mon-heads">
              <h2 id="mon-heads" class="mon-title"><ui-icon name="spool"/>{{ S.heads }}</h2>
              <div class="mon-scroll">
                <table class="mon-table">
                  <thead><tr>
                    <th></th><th>{{ S.cols.spool }}</th><th>{{ S.cols.nozzle }}</th><th>{{ S.cols.filament }}</th>
                    <th :title="S.paTitle">{{ S.cols.pa }}</th><th :title="S.changesTitle">{{ S.cols.changes }}</th><th>{{ S.cols.errors }}</th>
                  </tr></thead>
                  <tbody>
                    <tr v-for="(h, i) in data.heads" :key="h.extruder" :class="{ 'is-active': data.job.active === h.extruder }">
                      <th scope="row">{{ U1.head(i + 1) }}<small v-if="data.job.active === h.extruder && running">{{ S.active }}</small></th>
                      <td><span class="mon-spool"><spool-icon :colour="h.spool?.colour || '#D9D9D9'" :size="20"/>{{ h.spool ? [h.spool.type, h.spool.subtype].filter(Boolean).join(' ') : T.printers.live.empty }}</span></td>
                      <td>{{ h.nozzle != null ? num(h.nozzle, 1) + ' mm' : '–' }}</td>
                      <td>
                        <span v-if="sensorOf(i)" :class="sensorOf(i).detected ? 'st-on' : 'mon-quiet'">
                          {{ sensorOf(i).enabled === false ? S.disabled : sensorOf(i).detected ? S.detected : S.missing }}</span>
                        <template v-else>–</template>
                      </td>
                      <td>{{ h.pa != null ? num(h.pa, 3) : '–' }}</td>
                      <td>{{ h.changes != null ? num(h.changes) : '–' }}</td>
                      <td :title="h.retries != null ? S.retries(num(h.retries)) : null">{{ h.errors != null ? num(h.errors) : '–' }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </section>

            <section class="box" aria-labelledby="mon-fans">
              <h2 id="mon-fans" class="mon-title"><ui-icon name="gear"/>{{ S.fans }}</h2>
              <p v-if="!data.fans.length" class="note">{{ S.none }}</p>
              <table v-else class="mon-table">
                <thead><tr><th></th><th>{{ S.cols.speed }}</th><th>{{ S.cols.rpm }}</th></tr></thead>
                <tbody>
                  <tr v-for="f in data.fans" :key="f.name" :class="{ 'is-heating': f.speed > 0 }">
                    <th scope="row" :title="f.name">{{ label(f.name) }}</th>
                    <td>{{ pct(f.speed) }}</td>
                    <td>{{ f.rpm != null ? num(f.rpm) : '' }}</td>
                  </tr>
                </tbody>
              </table>
            </section>

            <section v-if="otherSensors.length" class="box" aria-labelledby="mon-sensors">
              <h2 id="mon-sensors" class="mon-title"><ui-icon name="spool"/>{{ S.sensors }}</h2>
              <dl class="mon-list">
                <div v-for="f in otherSensors" :key="f.name"><dt :title="f.name">{{ label(f.name) }}</dt>
                  <dd :class="f.detected ? 'st-on' : 'mon-quiet'">{{ f.enabled === false ? S.disabled : f.detected ? S.detected : S.missing }}</dd></div>
              </dl>
            </section>

            <section class="box" aria-labelledby="mon-system">
              <h2 id="mon-system" class="mon-title"><ui-icon name="window"/>{{ S.system }}</h2>
              <dl class="mon-list">
                <div><dt>{{ S.klipper }}</dt><dd>{{ S.klipperStates[data.klipper.state] || data.klipper.state || '–' }}</dd></div>
                <div><dt>{{ S.cpu }}</dt><dd>{{ data.system.cpu != null ? num(data.system.cpu) + ' %' : '–' }}<template v-if="data.system.cpu_temp != null"> · {{ deg(data.system.cpu_temp) }}</template></dd></div>
                <div><dt>{{ S.memory }}</dt><dd>{{ memory }}</dd></div>
                <div v-for="n in data.system.network" :key="n.name"><dt :title="n.name">{{ netLabel(n.name) }}</dt><dd>{{ n.bandwidth != null ? S.perSecond(fmtSize(n.bandwidth)) : '–' }}</dd></div>
                <div v-if="data.system.uptime != null"><dt>{{ S.uptime }}</dt><dd>{{ duration(data.system.uptime) }}</dd></div>
              </dl>
            </section>
          </div>
        </template>
      </template>
    </div>
  `,
};
