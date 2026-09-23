// Page "Kalibrieren": the user's guide for calibrating a filament on the Snapmaker U1
// (prototypes/U1 Filament Kalibrierung.md, checked in docs/FINDINGS.md "Kalibrierung") as a list
// to tick off. A result goes into the chosen own filament through the change list (`pending`,
// ops.js, "Übernehmen"); the ticks go into data/settings.json (orcaone/calibration.py). While the
// page is visible, OrcaOne reads the U1 every few seconds, read only (camera.status): the spools
// and the pressure advance the firmware uses.
import { INSTANCES, ui, flash, go, hashOf, onReset, LOCALE } from "../common.js";
import { T, plainName } from "../texts.js";
import { api } from "../api.js";

const { ref, reactive, computed, watch, onMounted, onUnmounted } = Vue;
const C = T.calibration;
const S = C.steps;
const EVERY = 5000;  // ms between two reads of the printer
const PRINTER_STEPS = ["connect", "spread", "machine"];
const STEPS = [
  { id: "dry" }, { id: "temp" }, { id: "flow", required: true }, { id: "pa", required: true },
  { id: "mvs" }, { id: "retraction" }, { id: "shrink" },
];
// The keys each step writes into the filament.
const KEYS_OF = {
  temp: ["nozzle_temperature"], flow: ["filament_flow_ratio"], pa: ["pressure_advance", "enable_pressure_advance"],
  mvs: ["filament_max_volumetric_speed"], retraction: ["filament_retraction_length"], shrink: ["filament_shrink"],
};
const LINKS = {
  spread: "https://www.printables.com/model/1503374-snapmaker-u1-4-colour-flowrate-calibration",
  shrink: "https://www.printables.com/model/1803161-umpteenth-filament-shrinkage-calibration-models",
};

// Values waiting for "Übernehmen": installation id -> filament -> { key: value as the profile
// writes it }. ops.js adds them to the filament_update of that filament. Empty after every load
// and after "Verwerfen", like the switches of the page "Filamente".
export const pending = reactive({});
onReset(() => { for (const id of Object.keys(pending)) delete pending[id]; });
export const calibrationChanges = computed(() => INSTANCES.flatMap((inst) =>
  Object.entries(pending[inst.id] || {}).map(([name, values]) => ({
    inst, page: "kalibrieren", type: "edit", name: plainName(name),
    where: C.changeWhere(Object.keys(values).map((k) => C.keys[k] || k)),
  }))));
// The filament last chosen per installation, for the next visit.
const lastChosen = {};

// "0,02" and "0.02" both count; anything else is NaN.
function num(text) {
  const t = String(text ?? "").trim().replace(",", ".");
  return /^-?(\d+(\.\d*)?|\.\d+)$/.test(t) ? Number(t) : NaN;
}
const show = (x, digits = 4) => Number(x).toLocaleString(LOCALE, { maximumFractionDigits: digits });
// A profile value for reading: "0.926" -> "0,926" in German, "99.6%" -> "99,6 %".
function shownValue(v) {
  const x = num(v);
  if (Number.isFinite(x)) return show(x, 6);
  const pct = /^(-?[\d.]+)%$/.exec(String(v));
  return pct ? `${show(Number(pct[1]), 2)} %` : String(v);
}
// As the profiles write numbers: with a dot, without trailing zeros.
const raw = (x, digits) => String(Number(Number(x).toFixed(digits)));
// The Flow Calibration measures with more than three decimals (0.017665); 0.02 comes from the
// slicer or the firmware (checked on the U1, docs/FINDINGS.md).
const measured = (pa) => typeof pa === "number" && Math.abs(pa * 1000 - Math.round(pa * 1000)) > 1e-6;

export default {
  name: "KalibrierenPage",
  props: { instId: { type: String, required: true } },

  setup(props) {
    const inst = computed(() => INSTANCES.find((i) => i.id === props.instId));
    const errorText = (code) => C.errors[code] || T.errors[code] || T.errors.unknown;
    const own = computed(() => inst.value.filaments.filter((f) => f.origin_kind === "user").map((f) => f.name)
      .sort((a, b) => a.localeCompare(b, "de", { sensitivity: "base" })));
    const start = [ui.calibrateFor, lastChosen[props.instId]].find((n) => n && own.value.includes(n));
    ui.calibrateFor = null;
    const name = ref(start || own.value[0] || "");

    // ------------------------------------------------------------ the filament as it is now
    const profile = ref(null);
    let seq = 0;
    async function loadProfile() {
      profile.value = null;
      if (!name.value) return;
      const mine = ++seq;
      try {
        const data = await api.profile(props.instId, "filament", name.value);
        if (mine === seq) profile.value = data;
      } catch (err) {
        if (mine === seq) flash(errorText(err.code));
      }
    }
    const queuedFor = () => pending[props.instId]?.[name.value] || {};
    const onDisk = (key) => {
      const v = profile.value?.values?.[key]?.value;
      const first = Array.isArray(v) ? v[0] : v;
      return first === undefined || first === null || first === "" || first === "nil" ? null : String(first);
    };
    // With a value waiting for "Übernehmen" over the one on disk.
    const valueOf = (key) => queuedFor()[key] ?? onDisk(key);
    // "Im Filament": what the slicer has now, so what the test prints were made with.
    const nowText = (key, unit = "") => {
      const v = onDisk(key);
      return v === null ? C.notSet : shownValue(v) + unit;
    };
    const material = computed(() => (onDisk("filament_type") || "").toUpperCase());

    // ------------------------------------------------------------ ticks
    const ticks = ref({ printer: {}, filaments: {} });
    const open = ref(null);
    const tickOf = (step) => ticks.value.filaments[name.value]?.[step] || null;
    const tempNow = computed(() => num(valueOf("nozzle_temperature")));
    async function mark(step, done, filament = name.value) {
      const temp = filament && done && Number.isFinite(tempNow.value) ? tempNow.value : undefined;
      try {
        ticks.value = await api.markCalibration(props.instId, filament, step, done, temp);
      } catch (err) {
        flash(errorText(err.code));
      }
    }
    // Flow ratio and pressure advance hold for the temperature they were ticked at.
    const redo = (step) => {
      const t = tickOf(step);
      return (step === "flow" || step === "pa") && t?.temp !== undefined && Number.isFinite(tempNow.value) && t.temp !== tempNow.value
        ? C.redo(show(t.temp, 0), show(tempNow.value, 0)) : "";
    };
    const doneCount = computed(() => STEPS.filter((s) => tickOf(s.id)).length);
    const dateText = (iso) => new Date(iso + "T12:00:00").toLocaleDateString(LOCALE);
    // The first step not ticked yet is open, so the page shows what comes next.
    function openNext() {
      open.value = (STEPS.find((s) => !tickOf(s.id)) || STEPS[0]).id;
    }

    // ------------------------------------------------------------ results into the filament
    const form = reactive({});
    function clearForm() {
      Object.assign(form, { tempLo: "", tempHi: "", temp: "", flowField: "", pa: "", mvsStart: "5", mvsStep: "0.5",
        mvsHeight: "", mvsMargin: "15", retStart: "0", retStep: "0.1", retHeight: "", shrinkTarget: "100", shrinkX: "", shrinkY: "" });
    }
    clearForm();
    // The inputs a result comes from; empty again once it is entered, so it cannot go in twice.
    const INPUTS = { temp: ["tempLo", "tempHi", "temp"], flow: ["flowField"], pa: ["pa"], mvs: ["mvsHeight"],
      retraction: ["retHeight"], shrink: ["shrinkX", "shrinkY"] };
    function enter(values, step) {
      if (!pending[props.instId]) pending[props.instId] = {};
      pending[props.instId][name.value] = { ...queuedFor(), ...values };
      for (const key of INPUTS[step] || []) form[key] = "";
      flash(C.queued(plainName(name.value)));
      if (!tickOf(step)) mark(step, true);
    }
    function undo(keys) {
      const now = pending[props.instId]?.[name.value];
      if (!now) return;
      for (const k of keys) delete now[k];
      if (!Object.keys(now).length) delete pending[props.instId][name.value];
    }
    const queuedText = (keys) => keys.filter((k) => queuedFor()[k] !== undefined)
      .map((k) => k === "enable_pressure_advance" ? C.keys[k] : `${C.keys[k]} ${shownValue(queuedFor()[k])}`).join(", ");

    // Middle of the vendor's range (the guide: known brands need no temperature tower).
    const tempMiddle = computed(() => {
      const lo = num(form.tempLo), hi = num(form.tempHi);
      return Number.isFinite(lo) && Number.isFinite(hi) && hi >= lo ? Math.round((lo + hi) / 2) : NaN;
    });
    const tempValue = computed(() => Number.isFinite(num(form.temp)) ? Math.round(num(form.temp)) : tempMiddle.value);
    // YOLO adds the field's value to the flow ratio the test was printed with, the one on disk
    // (SnOrca Plater::calib_flowrate), not to a value still waiting for "Übernehmen".
    const flowNow = computed(() => num(onDisk("filament_flow_ratio")));
    const flowNext = computed(() => {
      const f = num(form.flowField);
      const next = Number.isFinite(f) && Number.isFinite(flowNow.value) ? Number((flowNow.value + f).toFixed(3)) : NaN;
      return next > 0 && next <= 2 ? next : NaN;
    });
    const flowEdge = computed(() => Math.abs(num(form.flowField)) >= 0.05 - 1e-9);
    const paValue = computed(() => {
      const v = num(form.pa);
      return v >= 0 && v < 1 ? v : NaN;
    });
    // Not set in the chain means the slicer's default, which is off (PrintConfig.cpp).
    const paOff = computed(() => onDisk("enable_pressure_advance") !== "1");
    // Max flowrate test: start + height × step (GCode.cpp, Calib_Vol_speed_Tower), minus a margin.
    const mvsLimit = computed(() => {
      const [s, st, h] = [num(form.mvsStart), num(form.mvsStep), num(form.mvsHeight)];
      return [s, st, h].every(Number.isFinite) && h > 0 ? s + h * st : NaN;
    });
    const mvsSafe = computed(() => {
      const m = num(form.mvsMargin);
      return Number.isFinite(mvsLimit.value) && m >= 0 && m < 100 ? Math.floor(mvsLimit.value * (1 - m / 100) * 10) / 10 : NaN;
    });
    // Retraction test: start + ⌊height − 0.4⌋ × step (GCode.cpp, Calib_Retraction_tower).
    const retLength = computed(() => {
      const [s, st, h] = [num(form.retStart), num(form.retStep), num(form.retHeight)];
      return [s, st, h].every(Number.isFinite) && h > 0 ? Number((s + Math.floor(Math.max(0, h - 0.4)) * st).toFixed(3)) : NaN;
    });
    // Shrinkage (XY): measured ÷ target × 100, from X and Y (tooltip of filament_shrink).
    const shrinkPct = computed(() => {
      const t = num(form.shrinkTarget);
      const xs = [num(form.shrinkX), num(form.shrinkY)].filter((x) => x > 0);
      return t > 0 && xs.length ? Number((xs.reduce((a, b) => a + b, 0) / xs.length / t * 100).toFixed(2)) : NaN;
    });

    // ------------------------------------------------------------ the U1, live and read only
    const cameras = ref(null);
    const printer = ref(null);
    const printerError = ref("");
    const cam = computed(() => cameras.value?.[0] || null);
    let timer = null;
    async function readPrinter() {
      if (!cam.value || document.hidden) return;
      try {
        printer.value = await api.printerStatus(cam.value.id);
        printerError.value = "";
      } catch (err) {
        printerError.value = err.code === "camera_unreachable" ? C.printer.unreachable : errorText(err.code);
      }
    }
    const headName = (i) => C.printer.head(i + 1);
    const spoolText = (h) => h.spool
      ? [h.spool.type, h.spool.subtype, h.spool.maker || h.spool.vendor].filter((x) => x && x !== "NONE").join(" · ")
      : C.printer.empty;
    const matches = (h) => !!material.value && (h.spool?.type || "").toUpperCase() === material.value;
    const stateText = computed(() => {
      const p = printer.value;
      if (!p) return "";
      const parts = [C.printer.states[p.state] || p.state];
      if (p.file && p.state !== "standby") parts.push(p.file);
      if (p.state === "printing" && typeof p.progress === "number") parts.push(`${show(p.progress * 100, 0)} %`);
      if (p.flow_calibrate && p.state === "printing") parts.push(C.printer.calibrates);
      return parts.join(" · ");
    });
    // Spools with a tag and the filament's material: their drying and temperature data apply.
    const rfidHeads = computed(() => (printer.value?.heads || []).map((h, i) => ({ h, i }))
      .filter(({ h }) => h.spool?.rfid && (!material.value || matches(h))));
    const onVisible = () => { if (!document.hidden) readPrinter(); };

    watch(name, () => {
      lastChosen[props.instId] = name.value;
      clearForm();
      loadProfile();
      openNext();
    });
    onMounted(async () => {
      loadProfile();
      try {
        ticks.value = await api.calibration(props.instId);
      } catch (err) {
        flash(errorText(err.code));
      }
      openNext();
      try {
        cameras.value = (await api.cameras()).cameras;
      } catch {
        cameras.value = [];
      }
      readPrinter();
      timer = setInterval(readPrinter, EVERY);
      document.addEventListener("visibilitychange", onVisible);
    });
    onUnmounted(() => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    });

    return {
      T, C, S, STEPS, PRINTER_STEPS, KEYS_OF, LINKS, inst, own, name, profile, valueOf, nowText, material, ticks, open, tickOf, mark, redo,
      doneCount, dateText, form, enter, undo, queuedText, tempMiddle, tempValue, flowNow, flowNext, flowEdge, paValue,
      paOff, mvsLimit, mvsSafe, retLength, shrinkPct, cameras, cam, printer, printerError, headName, spoolText, matches,
      stateText, rfidHeads, measured, show, raw, plainName, go, hashOf,
    };
  },

  template: `
    <div class="page cal-page">
      <h1 id="page-title" tabindex="-1">{{ C.title }}</h1>
      <p class="note">{{ C.lead }}</p>

      <section class="box cal-pick">
        <p v-if="!own.length" class="empty">{{ C.noOwn }}
          <a class="link" :href="hashOf('filamente', instId)" @click="go($event, hashOf('filamente', instId))">{{ C.toFilaments }}</a></p>
        <template v-else>
          <label class="log-file"><span>{{ C.filament }}</span>
            <select v-model="name" class="input">
              <option v-for="f in own" :key="f" :value="f">{{ plainName(f) }}</option>
            </select>
          </label>
          <div class="cal-progress" :aria-label="C.progress(doneCount, STEPS.length)">
            <span class="cal-bar"><span :style="{ width: (doneCount / STEPS.length * 100) + '%' }"></span></span>
            <small>{{ C.progress(doneCount, STEPS.length) }}</small>
          </div>
        </template>
      </section>

      <section class="box cal-printer" :aria-label="C.printer.title">
        <div class="box-head">
          <h2>{{ C.printer.title }}</h2>
          <span v-if="cam" class="sub">{{ cam.name }} · {{ cam.host }}</span>
          <span v-if="printer && !printerError" :class="['cal-state', 'is-' + printer.state]">{{ stateText }}</span>
        </div>
        <p v-if="cameras && !cam" class="note">{{ C.printer.none }}
          <a class="link" :href="hashOf('kamera', instId)" @click="go($event, hashOf('kamera', instId))">{{ C.printer.toCamera }}</a></p>
        <p v-else-if="printerError" class="alert" role="alert">{{ printerError }}</p>
        <div v-else-if="printer" class="cal-heads">
          <div v-for="(h, i) in printer.heads" :key="h.extruder" :class="['cal-head', { 'is-match': matches(h), 'is-active': printer.active === h.extruder }]">
            <span class="cal-dot" :style="{ background: h.spool?.colour || 'transparent' }"></span>
            <strong>{{ headName(i) }}</strong>
            <span class="cal-pa" :title="C.printer.paLabel + ': ' + (measured(h.pa) ? C.printer.measuredTitle : C.printer.roundTitle)">
              <small>PA</small> <strong>{{ h.pa == null ? '–' : show(h.pa, 6) }}</strong>
              <span v-if="h.pa != null" :class="['tag', measured(h.pa) ? 'is-measured' : '']">{{ measured(h.pa) ? C.printer.measured : C.printer.round }}</span>
            </span>
            <small class="cal-spool">{{ spoolText(h) }}</small>
          </div>
        </div>
      </section>

      <template v-if="name">
        <section class="box">
          <div class="box-head"><h2>{{ C.filamentSteps }}</h2><span class="sub">{{ plainName(name) }}</span></div>
          <ol class="cal-steps">
            <li v-for="(s, idx) in STEPS" :key="s.id" :class="['cal-step', { 'is-done': tickOf(s.id), 'is-open': open === s.id }]">
              <div class="cal-step-head">
                <button class="cal-check" type="button" role="checkbox" :aria-checked="tickOf(s.id) ? 'true' : 'false'"
                        :aria-label="C.tick(S[s.id].title)" @click="mark(s.id, !tickOf(s.id))"><ui-icon name="check" :size="16"/></button>
                <button class="cal-step-title" type="button" :aria-expanded="open === s.id ? 'true' : 'false'" @click="open = open === s.id ? null : s.id">
                  <span class="cal-num">{{ idx + 1 }}</span>
                  <strong>{{ S[s.id].title }}</strong>
                  <span :class="['tag', { 'is-required': s.required }]">{{ s.required ? C.required : C.optional }}</span>
                  <small v-if="tickOf(s.id)" class="cal-date">{{ C.doneOn(dateText(tickOf(s.id).date)) }}</small>
                  <ui-icon name="chevronDown" class="cal-chev"/>
                </button>
              </div>
              <p v-if="redo(s.id)" class="cal-redo" role="status"><ui-icon name="warn" :size="16"/>{{ redo(s.id) }}</p>

              <div v-if="open === s.id" class="cal-body">
                <ul class="cal-points"><li v-for="(p, k) in S[s.id].points" :key="k">{{ p }}</li></ul>

                <!-- 1 drying: what the spools' tags say -->
                <template v-if="s.id === 'dry'">
                  <p v-for="x in rfidHeads.filter((x) => x.h.spool.dry_temp)" :key="x.i" class="note">
                    {{ S.dry.spool(headName(x.i), spoolText(x.h), x.h.spool.dry_temp, x.h.spool.dry_hours) }}</p>
                </template>

                <!-- 2 temperature: the middle of the vendor's range -->
                <template v-if="s.id === 'temp'">
                  <p class="cal-now">{{ C.inProfile }} <strong>{{ nowText('nozzle_temperature', ' °C') }}</strong>
                    <template v-if="valueOf('nozzle_temperature_range_low')"> · {{ S.temp.profileRange(valueOf('nozzle_temperature_range_low'), valueOf('nozzle_temperature_range_high')) }}</template></p>
                  <p v-if="rfidHeads.length" class="cal-takes">
                    <button v-for="x in rfidHeads" :key="x.i" class="chip" type="button" @click="form.tempLo = String(x.h.spool.temp_min); form.tempHi = String(x.h.spool.temp_max)">
                      {{ S.temp.fromHead(headName(x.i), x.h.spool.temp_min, x.h.spool.temp_max) }}</button>
                  </p>
                  <div class="cal-form">
                    <label class="field"><span>{{ S.temp.rangeFrom }}</span><input v-model="form.tempLo" class="input" inputmode="numeric"></label>
                    <label class="field"><span>{{ S.temp.rangeTo }}</span><input v-model="form.tempHi" class="input" inputmode="numeric"></label>
                    <label class="field"><span>{{ S.temp.valueLabel }}</span><input v-model="form.temp" class="input" inputmode="numeric" :placeholder="Number.isFinite(tempMiddle) ? String(tempMiddle) : ''"></label>
                    <button class="btn btn-primary" type="button" :disabled="!Number.isFinite(tempValue)"
                            @click="enter({ nozzle_temperature: String(tempValue) }, 'temp')">{{ C.enter((Number.isFinite(tempValue) ? tempValue : '…') + ' °C') }}</button>
                  </div>
                  <p v-if="Number.isFinite(tempMiddle)" class="note">{{ S.temp.middle(tempMiddle) }}</p>
                  <p class="cal-warn">{{ S.temp.warn }}</p>
                </template>

                <!-- 3 flow ratio: the current value plus the best field -->
                <template v-if="s.id === 'flow'">
                  <p class="cal-now">{{ C.inProfile }} <strong>{{ nowText('filament_flow_ratio') }}</strong></p>
                  <div class="cal-form">
                    <label class="field"><span>{{ S.flow.fieldLabel }}</span><input v-model="form.flowField" class="input" inputmode="decimal" :placeholder="S.flow.fieldHint"></label>
                    <span v-if="Number.isFinite(flowNext)" class="cal-result">{{ S.flow.result(show(flowNow, 3), show(flowNext, 3)) }}</span>
                    <button class="btn btn-primary" type="button" :disabled="!Number.isFinite(flowNext)"
                            @click="enter({ filament_flow_ratio: raw(flowNext, 3) }, 'flow')">{{ C.enter(Number.isFinite(flowNext) ? show(flowNext, 3) : '…') }}</button>
                  </div>
                  <p v-if="flowEdge" class="cal-warn">{{ S.flow.edge }}</p>
                </template>

                <!-- 4 pressure advance: measured by the U1, read here -->
                <template v-if="s.id === 'pa'">
                  <p class="cal-now">{{ C.inProfile }} <strong>{{ nowText('pressure_advance') }}</strong>
                    · {{ C.printer.paLabel }} {{ paOff ? C.off : C.on }}</p>
                  <p v-if="paOff" class="cal-warn">{{ S.pa.off }}</p>
                  <p v-if="printer" class="cal-takes"><span class="note">{{ S.pa.takeFrom }}</span>
                    <button v-for="(h, i) in printer.heads" :key="h.extruder" :class="['chip', { 'is-match': matches(h) }]" type="button"
                            :disabled="h.pa == null" @click="form.pa = show(h.pa, 6)">
                      <span class="cal-dot" :style="{ background: h.spool?.colour || 'transparent' }"></span>
                      {{ headName(i) }}: {{ h.pa == null ? '–' : show(h.pa, 6) }}
                      <small v-if="h.pa != null">{{ measured(h.pa) ? C.printer.measured : C.printer.round }}</small></button>
                  </p>
                  <p v-else-if="cameras && !cam" class="note">{{ S.pa.noPrinter }}</p>
                  <div class="cal-form">
                    <label class="field"><span>{{ S.pa.valueLabel }}</span><input v-model="form.pa" class="input" inputmode="decimal" placeholder="0,0177"></label>
                    <button class="btn btn-primary" type="button" :disabled="!Number.isFinite(paValue)"
                            @click="enter({ pressure_advance: raw(paValue, 4), enable_pressure_advance: '1' }, 'pa')">{{ S.pa.enter(Number.isFinite(paValue) ? show(paValue, 4) : '…') }}</button>
                  </div>
                </template>

                <!-- 5 max volumetric speed -->
                <template v-if="s.id === 'mvs'">
                  <p class="cal-now">{{ C.inProfile }} <strong>{{ nowText('filament_max_volumetric_speed', ' mm³/s') }}</strong></p>
                  <div class="cal-form">
                    <label class="field"><span>{{ S.mvs.start }}</span><input v-model="form.mvsStart" class="input" inputmode="decimal"></label>
                    <label class="field"><span>{{ S.mvs.step }}</span><input v-model="form.mvsStep" class="input" inputmode="decimal"></label>
                    <label class="field"><span>{{ S.mvs.height }}</span><input v-model="form.mvsHeight" class="input" inputmode="decimal"></label>
                    <label class="field"><span>{{ S.mvs.margin }}</span><input v-model="form.mvsMargin" class="input" inputmode="numeric"></label>
                  </div>
                  <div v-if="Number.isFinite(mvsSafe)" class="cal-form">
                    <span class="cal-result">{{ S.mvs.result(show(mvsLimit, 1), show(mvsSafe, 1)) }}</span>
                    <button class="btn btn-primary" type="button" @click="enter({ filament_max_volumetric_speed: raw(mvsSafe, 1) }, 'mvs')">{{ C.enter(show(mvsSafe, 1) + ' mm³/s') }}</button>
                  </div>
                </template>

                <!-- 6 retraction -->
                <template v-if="s.id === 'retraction'">
                  <p class="cal-now">{{ C.inProfile }} <strong>{{ nowText('filament_retraction_length') === C.notSet ? S.retraction.fromPrinter : nowText('filament_retraction_length', ' mm') }}</strong></p>
                  <div class="cal-form">
                    <label class="field"><span>{{ S.retraction.start }}</span><input v-model="form.retStart" class="input" inputmode="decimal"></label>
                    <label class="field"><span>{{ S.retraction.step }}</span><input v-model="form.retStep" class="input" inputmode="decimal"></label>
                    <label class="field"><span>{{ S.retraction.height }}</span><input v-model="form.retHeight" class="input" inputmode="decimal"></label>
                  </div>
                  <p class="note">{{ S.retraction.formula }}</p>
                  <div v-if="Number.isFinite(retLength)" class="cal-form">
                    <span class="cal-result">{{ S.retraction.result(show(retLength, 2)) }}</span>
                    <button class="btn btn-primary" type="button" @click="enter({ filament_retraction_length: raw(retLength, 2) }, 'retraction')">{{ C.enter(show(retLength, 2) + ' mm') }}</button>
                  </div>
                </template>

                <!-- 7 shrinkage -->
                <template v-if="s.id === 'shrink'">
                  <p class="cal-now">{{ C.inProfile }} <strong>{{ nowText('filament_shrink') }}</strong></p>
                  <p><a class="link" :href="LINKS.shrink" target="_blank" rel="noopener">{{ S.shrink.link }}</a></p>
                  <div class="cal-form">
                    <label class="field"><span>{{ S.shrink.target }}</span><input v-model="form.shrinkTarget" class="input" inputmode="decimal"></label>
                    <label class="field"><span>{{ S.shrink.measuredX }}</span><input v-model="form.shrinkX" class="input" inputmode="decimal"></label>
                    <label class="field"><span>{{ S.shrink.measuredY }}</span><input v-model="form.shrinkY" class="input" inputmode="decimal"></label>
                  </div>
                  <div v-if="Number.isFinite(shrinkPct)" class="cal-form">
                    <span class="cal-result">{{ S.shrink.result(show(shrinkPct, 2)) }}</span>
                    <button class="btn btn-primary" type="button" @click="enter({ filament_shrink: raw(shrinkPct, 2) + '%' }, 'shrink')">{{ C.enter(show(shrinkPct, 2) + ' %') }}</button>
                  </div>
                </template>

                <p v-if="queuedText(KEYS_OF[s.id] || [])" class="cal-queued">{{ C.queuedValue(queuedText(KEYS_OF[s.id])) }}
                  <button class="link" type="button" @click="undo(KEYS_OF[s.id])">{{ C.undo }}</button></p>
              </div>
            </li>
          </ol>
        </section>

        <section class="box">
          <div class="box-head"><h2>{{ C.printerSteps }}</h2></div>
          <ul class="cal-steps cal-once">
            <li v-for="id in PRINTER_STEPS" :key="id" :class="['cal-step', 'is-open', { 'is-done': id === 'connect' ? !!cam : ticks.printer[id] }]">
              <div class="cal-step-head">
                <button v-if="id !== 'connect'" class="cal-check" type="button" role="checkbox" :aria-checked="ticks.printer[id] ? 'true' : 'false'"
                        :aria-label="C.tick(S[id].title)" @click="mark(id, !ticks.printer[id], null)"><ui-icon name="check" :size="16"/></button>
                <span v-else class="cal-check" aria-hidden="true"><ui-icon name="check" :size="16"/></span>
                <span class="cal-step-title is-static"><strong>{{ S[id].title }}</strong>
                  <small v-if="id !== 'connect' && ticks.printer[id]" class="cal-date">{{ C.doneOn(dateText(ticks.printer[id].date)) }}</small></span>
              </div>
              <div class="cal-body">
                <ul class="cal-points"><li v-for="(p, k) in S[id].points" :key="k">{{ p }}</li></ul>
                <p v-if="id === 'connect' && cam" class="note">{{ S.connect.connected(cam.name, cam.host) }}</p>
                <p v-else-if="id === 'connect'"><a class="link" :href="hashOf('kamera', instId)" @click="go($event, hashOf('kamera', instId))">{{ C.printer.toCamera }}</a></p>
                <p v-if="id === 'spread'"><a class="link" :href="LINKS.spread" target="_blank" rel="noopener">{{ S.spread.link }}</a></p>
              </div>
            </li>
          </ul>
        </section>

        <section class="box">
          <div class="box-head"><h2>{{ C.rulesTitle }}</h2></div>
          <ul class="cal-points"><li v-for="(r, k) in C.rules" :key="k">{{ r }}</li></ul>
        </section>
      </template>
    </div>
  `,
};
