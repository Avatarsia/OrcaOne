// Page "Diagramme" (the user's wishes of 27.09.2026): what OrcaOne recorded of a printer over time
// (orcaone/history.py, data/history/), live and back up to seven days, drawn with uPlot (vendor/uplot,
// MIT). A cockpit that fills the window and never scrolls, like "2D Ansicht" (the user: scrolling means
// not seeing what happens): one lane per unit instead of one chart with two axes where the hotend
// squeezes the chamber flat (Mainsail, Fluidd), their cursors and zoom coupled; above them a band of
// the working head and the layer changes, the glowing "now", below an overview of the whole span to
// drag a window in. Beside it the panel choosing what to see, remembered per printer
// (data/settings.json "charts"). The printer comes from the tabs above (app.js). Read only.
import { ui, partLabel, isU1Printer, darkQuery, LOCALE } from "../common.js";
import { T, SETTINGS } from "../texts.js";
import { api } from "../api.js";
import { live, watchPrinters } from "../live.js";

const { ref, computed, watch, nextTick, onMounted, onUnmounted } = Vue;
const D = T.charts;
const SPANS = [900, 3600, 6 * 3600, 86400, 7 * 86400];
const GAP = 30;   // s without a row: a gap in the lines, as history.GAP
const BACK = 4;   // the overview shows four spans, to drag the window back in time
const KEPT = 7 * 86400;   // what history.py keeps
// Colours that stay apart on the dark and the light stage (the user: too close, heads 3 and 4 alike,
// 27.09.2026): the heads fixed, 1 to 4, the rest per lane in this order, so no two lines of a lane share one.
const HEAD_COLOURS = ["#F28E2B", "#3D8FE0", "#4CB050", "#C061D6"];
const PALETTE = ["#17BECF", "#E15759", "#D4A92A", "#FF8FA3", "#9C755F", "#8C8C8C", "#A3C93A", "#76B7B2"];
// The lanes in this order, one per unit; network traffic comes in bytes per second.
const UNITS = ["°C", "%", "mm³/s", "mm/s", "1/min", "mm", "layer", "KB/s"];
function unitOf(n) {
  if (/^(temp|target):|^cpu_temp$/.test(n)) return "°C";
  if (/^(power|fan):|^(cpu|memory|progress|speed_factor|flow_factor)$/.test(n)) return "%";
  if (n === "flow") return "mm³/s";
  if (n === "speed") return "mm/s";
  if (n.startsWith("rpm:")) return "1/min";
  if (n === "z") return "mm";
  if (n === "layer") return "layer";
  if (/^(rx|tx):/.test(n)) return "KB/s";
  return null;   // head, file_position: not drawn as lines
}
const factorOf = (n) => (/^(rx|tx):/.test(n) ? 1 / 1024 : 1);
// The panel: the groups of what can be chosen; a temperature brings its target along.
const GROUPS = [
  { id: "heads", fits: (n) => /^temp:extruder\d*$/.test(n) },
  { id: "heat", fits: (n) => /^temp:(?!extruder|tmc)/.test(n) },
  { id: "power", fits: (n) => n.startsWith("power:") },
  { id: "motion", fits: (n) => ["flow", "speed", "z"].includes(n) },
  { id: "fans", fits: (n) => n.startsWith("fan:") || n.startsWith("rpm:") },
  { id: "print", fits: (n) => ["progress", "layer", "speed_factor", "flow_factor"].includes(n) },
  { id: "computer", fits: (n) => ["cpu", "memory", "cpu_temp"].includes(n) || n.startsWith("temp:tmc") },
  { id: "network", fits: (n) => /^(rx|tx):/.test(n) },
];
// The usual views in one list, "Alles aus" first for ticking by hand (the user's wishes of 27.09.2026).
// The part fans: [fan], on the U1 also its fan_generic eN_fan; a chamber by its usual names (U1: cavity).
const CHAMBER = /^(temp|power):\S+ .*(chamber|cavity|enclosure)/i;
const PRESETS = {
  none: () => false,
  print: (n) => /^temp:(extruder\d*|heater_bed)$/.test(n) || n === "flow" || /^fan:(fan|fan_generic e\d+_fan)$/.test(n),
  temps: (n) => /^temp:(?!tmc)/.test(n) || /^power:(extruder\d*|heater_bed)$/.test(n),
  heads: (n) => /^(temp|power):extruder\d*$/.test(n),
  chamber: (n) => /^(temp|power):heater_bed$/.test(n) || CHAMBER.test(n),
  progress: (n) => ["progress", "layer", "z"].includes(n),
  motion: (n) => ["speed", "flow", "speed_factor", "flow_factor"].includes(n),
  fans: (n) => /^(fan|rpm):/.test(n),
  electronics: (n) => ["cpu", "memory", "cpu_temp"].includes(n) || n.startsWith("temp:tmc"),
  network: (n) => /^(rx|tx):/.test(n),
};
// One view per head, when there are several (the user's wish of 27.09.2026): its temperature, heating and
// fans. On the U1 [fan] is the part fan of head 1, fan_generic eN_fan and heater_fan eN_nozzle_fan are head N+1's.
const headView = (k) => (n) => new RegExp(`^(temp|power):extruder${k || ""}$`).test(n)
  || new RegExp(`^(fan|rpm):\\S+ e${k}_(fan|nozzle_fan)$`).test(n) || (k === 0 && /^(fan|rpm):fan$/.test(n));
const fitsOf = (id) => (id.startsWith("head:") ? headView(+id.slice(5)) : PRESETS[id]);

let loading = null;
function loadUplot() {
  if (!loading) {
    const css = document.createElement("link");
    css.rel = "stylesheet";
    css.href = "vendor/uplot/uPlot.min.css";
    document.head.append(css);
    loading = import("../vendor/uplot/uPlot.esm.js").then((m) => m.default);
  }
  return loading;
}
// Relative luminance (WCAG): the number on the head band dark on a light colour, else light.
const luminance = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return [n >> 16, (n >> 8) & 255, n & 255]
    .map((c) => (c / 255 <= 0.03928 ? c / 255 / 12.92 : ((c / 255 + 0.055) / 1.055) ** 2.4))
    .reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i], 0);
};

export default {
  name: "DiagrammePage",
  props: { instId: { type: String, default: null } },  // the page does not depend on an installation

  setup() {
    const printer = computed(() => ui.printer);
    const isU1 = computed(() => isU1Printer(ui.printer));
    watchPrinters(() => [printer.value]);
    const monitor = computed(() => live[printer.value]?.data?.monitor || null);
    const span = ref(SPANS[0]);
    const follow = ref(true);         // the lanes move with the newest values; a zoom stops it
    const busy = ref(false);
    const failed = ref("");
    const names = ref([]);            // the series with values in the rows loaded
    const picked = ref([]);           // the panel's choice, without targets
    const panelOpen = ref(window.innerWidth > 900);
    const opened = ref({});           // panel groups opened or closed by hand
    const hover = ref(null);          // { idx, left, top, width, height } of the mouse in a lane
    const view = ref(null);           // { min, max } the lanes show, for the overview's window
    const laneBoxes = ref({});
    const lanesBox = ref(null);
    const overviewBox = ref(null);
    const tick = ref(0);              // counts redraws: panel and hover read the rows, which are not reactive
    // cols: the rows of the lanes, the span up to now or a window of the past (detail); wide: the overview's.
    let uPlot = null, lanePlots = [], overview = null, cols = { t: [], series: {}, files: [] }, wide = cols, detail = false;
    let asked = 0, builds = 0, builtKey = "", gone = false, saveTimer = 0, fetchTimer = 0, activeLane = -1, look = null, zooming = false;
    let seenFile;   // the print file of the last live row: undefined after a load, null while not printing
    let backSeconds = 0, overviewNames = [];   // what the overview spans back from its newest row, and its lines
    let observer = null, themeWatch = null;

    // ------------------------------------------------------------ names and colours
    const heads = computed(() => monitor.value?.heads || []);
    const partOf = (n) => (n.includes(":") ? n.slice(n.indexOf(":") + 1) : n);
    function label(n) {
      if (!n.includes(":")) return D.series[n] || n;
      const kind = n.slice(0, n.indexOf(":")), part = partOf(n);
      if (kind === "rx" || kind === "tx") return `${D.series[kind]} · ${part}`;
      const text = partLabel(part, isU1.value);
      return ["rpm", "power", "target"].includes(kind) ? `${text} · ${D.series[kind]}` : text;
    }
    // A head in its fixed colour everywhere (lines, band, hover); any other line the next free colour of its
    // lane, its target with it. A series in no lane has none: the panel shows it grey.
    const headOf = (n) => {
      const m = /^(?:temp|target|power):extruder(\d*)$/.exec(n);
      return m ? +(m[1] || 0) : null;
    };
    const laneColours = computed(() => {
      const out = {};
      for (const lane of lanes.value) {
        let next = 0;
        for (const n of mainOf(lane)) if (headOf(n) == null) out[n] = PALETTE[next++ % PALETTE.length];
      }
      return out;
    });
    function colour(n) {
      const k = headOf(n);
      if (k != null) return HEAD_COLOURS[k % HEAD_COLOURS.length];
      return laneColours.value[n.startsWith("target:") ? `temp:${partOf(n)}` : n] || null;
    }

    // ------------------------------------------------------------ the choice
    const catalogue = computed(() => GROUPS.map((g) => ({ id: g.id, items: names.value.filter((n) => g.fits(n)) }))
      .filter((g) => g.items.length));
    const isOpen = (g, i) => opened.value[g.id] ?? (i < 2 || g.items.some((n) => picked.value.includes(n)));
    // Sent a moment after the last click, for this printer only, at the latest when the page or the
    // printer changes; SETTINGS at once, restore() reads it.
    let unsent = null;
    function send() {
      clearTimeout(saveTimer);
      unsent?.();
      unsent = null;
    }
    function choose(list) {
      picked.value = [...new Set(list)];
      const name = printer.value, chosen = picked.value;
      SETTINGS.charts = { ...(SETTINGS.charts || {}), [name]: chosen };
      clearTimeout(saveTimer);
      unsent = () => api.setCharts(name, chosen).catch(() => {});
      saveTimer = setTimeout(send, 600);
    }
    const toggle = (n) => choose(picked.value.includes(n) ? picked.value.filter((x) => x !== n) : [...picked.value, n]);
    // The views this printer has values for; the one the choice matches, "" for one of the user's own.
    const headIds = computed(() => {
      const ks = [...new Set(names.value.map((n) => /^temp:extruder(\d*)$/.exec(n)).filter(Boolean).map((m) => +(m[1] || 0)))];
      return ks.length > 1 ? ks.sort((a, b) => a - b).map((k) => `head:${k}`) : [];
    });
    const presetIds = computed(() => Object.keys(PRESETS).filter((id) => id === "none" || names.value.some(PRESETS[id]))
      .flatMap((id) => (id === "heads" ? [id, ...headIds.value] : [id])));
    const presetLabel = (id) => (id.startsWith("head:") ? partLabel(`extruder${+id.slice(5) || ""}`, isU1.value) : D.presets[id]);
    const presetNow = computed(() => {
      const shown = picked.value.filter((n) => names.value.includes(n));
      if (!shown.length) return "none";
      return presetIds.value.find((id) => {
        const want = names.value.filter(fitsOf(id));
        return want.length === shown.length && want.every((n) => shown.includes(n));
      }) || "";
    });
    const presetChoice = computed({ get: () => presetNow.value, set: (id) => choose(names.value.filter(fitsOf(id))) });
    // What this printer showed last, else "Drucken", else its temperatures.
    function restore() {
      const kept = (SETTINGS.charts || {})[printer.value];
      if (Array.isArray(kept)) picked.value = kept;
      else picked.value = names.value.filter(PRESETS.print).length ? names.value.filter(PRESETS.print) : names.value.filter(PRESETS.temps);
    }

    // The lanes: per unit the chosen series, a temperature followed by its target.
    const lanes = computed(() => {
      const target = (n) => (n.startsWith("temp:") && names.value.includes(`target:${partOf(n)}`) ? [n, `target:${partOf(n)}`] : [n]);
      const all = picked.value.filter((n) => names.value.includes(n)).flatMap(target);
      return UNITS.map((unit) => ({ unit, names: all.filter((n) => unitOf(n) === unit) })).filter((l) => l.names.length);
    });
    const lanesKey = computed(() => lanes.value.map((l) => l.names.join()).join("|"));
    const mainOf = (lane) => lane.names.filter((n) => !n.startsWith("target:"));

    // ------------------------------------------------------------ data
    const printing = computed(() => ["printing", "paused"].includes(monitor.value?.job?.state) && monitor.value?.job?.elapsed > 0);
    const spans = computed(() => (printing.value ? [...SPANS, "print"] : SPANS));
    // "Dieser Druck": from its start, with a minute before it.
    const seconds = () => (span.value === "print" ? Math.min(KEPT, Math.ceil(monitor.value?.job?.elapsed || 840) + 60) : span.value);
    const namesOf = () => [...new Set([cols, wide].flatMap((c) => Object.keys(c.series).filter((k) => unitOf(k) && c.series[k].some((v) => v != null))))].sort();
    // Following: the span for the lanes and four spans for the overview; a window of the past: its rows only.
    async function load(window_ = null) {
      const name = printer.value, mine = ++asked;
      if (!name) return;
      clearTimeout(fetchTimer);
      busy.value = true;
      try {
        const points = Math.min(5000, Math.max(300, lanesBox.value?.clientWidth || 900) * 2);
        const [got, back] = await Promise.all([
          window_ ? api.history(name, window_.max - window_.min, points, window_.max) : api.history(name, seconds(), points),
          window_ ? null : api.history(name, (backSeconds = Math.min(KEPT, seconds() * BACK)), Math.min(2000, (overviewBox.value?.clientWidth || 900) * 2)),
        ]);
        if (gone || mine !== asked) return;   // left, or asked again meanwhile
        cols = got;
        detail = Boolean(window_);
        if (back) wide = back;
        seenFile = undefined;
        failed.value = "";
        names.value = namesOf();
        if (!picked.value.length) restore();
        if (lanesKey.value !== builtKey) await build();
        else redraw();
      } catch (err) {
        if (mine === asked) failed.value = T.errors[err.code] || T.errors.unknown;
      } finally {
        if (mine === asked) busy.value = false;
      }
    }
    // A new row of the recording (live.py) into rows: added, a gap before it if the printer was quiet,
    // the rows older than keep seconds dropped.
    function append(rows, sample, keep) {
      const n = rows.t.length;
      if (n && sample.t <= rows.t[n - 1]) return;
      for (const k of Object.keys(sample.v)) if (!rows.series[k]) rows.series[k] = new Array(n).fill(null);
      if (n && sample.t - rows.t[n - 1] > GAP) {
        rows.t.push(rows.t[n - 1] + 1);
        for (const list of Object.values(rows.series)) list.push(null);
      }
      rows.t.push(sample.t);
      for (const [k, list] of Object.entries(rows.series)) list.push(sample.v[k] ?? null);
      let drop = 0;
      while (keep && drop < rows.t.length - 1 && rows.t[drop] < sample.t - keep) drop++;
      if (drop) {
        rows.t.splice(0, drop);
        for (const list of Object.values(rows.series)) list.splice(0, drop);
      }
    }
    // The overview always, the lanes while they show the present; zoomed in, nothing is dropped from them.
    function add(sample) {
      if (!sample || busy.value || gone) return;
      // Back after a while without samples (the browser tab hidden, OrcaOne restarted): the recording went
      // on meanwhile, so read it instead of drawing a gap (review 27.09.2026).
      const end = wide.t[wide.t.length - 1];
      if (!detail && end != null && sample.t - end > GAP) return load();
      // While the lanes show the overview's own rows (dragged back), nothing is dropped from them.
      append(wide, sample, cols === wide ? 0 : seconds() * BACK);
      if (!detail) append(cols, sample, follow.value ? seconds() : 0);
      const job = monitor.value?.job, file = ["printing", "paused"].includes(job?.state) && job.file ? job.file : null;
      if (file && seenFile !== undefined && file !== seenFile) {
        for (const rows of new Set(detail ? [wide] : [wide, cols])) (rows.files ||= []).push([sample.t, file]);
      }
      seenFile = file;
      if (Object.keys(sample.v).some((k) => sample.v[k] != null && unitOf(k) && !names.value.includes(k))) {
        names.value = namesOf();
        if (!picked.value.length) restore();
      }
      if (lanesKey.value !== builtKey) build();
      else redraw();
    }
    watch(() => live[printer.value]?.sample, add);

    // ------------------------------------------------------------ drawing
    // The page's colours for the canvas: a variable holds light-dark(…), so resolved from an element;
    // accent and warn as "r, g, b" for rgba().
    function colours() {
      const probe = document.body.appendChild(document.createElement("span"));
      const v = (name) => { probe.style.color = `var(${name})`; return getComputedStyle(probe).color; };
      const rgb = (name) => (v(name).match(/[\d.]+/g) || [0, 150, 136]).slice(0, 3).join(", ");
      const out = { axis: v("--muted"), grid: v("--divider"), accent: rgb("--accent-line"), warn: rgb("--warn"), surface: rgb("--surface") };
      probe.remove();
      return out;
    }
    // The overview, to find a stretch back in time: the heads' temperatures as thin lines in their colours,
    // the same curves as above in small, on a teal ground where the printer printed. Always the whole four
    // spans, also where nothing was recorded, so the window is a quarter of it (the user: a fat bar that
    // said nothing, 27.09.2026).
    function wideRange() {
      const last = wide.t[wide.t.length - 1];
      return last == null ? null : { first: last - backSeconds, last };
    }
    function overviewData() {
      const printing = wide.series.file_position || [];
      return [x(wide), wide.t.map((_, i) => (printing[i] != null ? 1 : null)), ...ys(overviewNames, wide)];
    }
    const clock = (t, withSeconds) => new Date(t * 1000).toLocaleTimeString(LOCALE, { hour: "2-digit", minute: "2-digit", ...(withSeconds ? { second: "2-digit" } : {}) });
    const day = (t) => new Date(t * 1000).toLocaleDateString(LOCALE, { day: "numeric", month: "numeric" });
    // Time ticks by their distance: seconds below a minute, the date once a day changes or ticks are hours apart.
    const timeTicks = (_, ticks, _axis, _space, incr) => ticks.map((t, i) =>
      (incr >= 6 * 3600 || (i > 0 && day(t) !== day(ticks[i - 1])) ? `${day(t)} ` : "") + clock(t, incr < 60));
    const number = (v, unit) => (v == null ? "–"
      : `${v.toLocaleString(LOCALE, { maximumFractionDigits: Math.abs(v) < 10 ? 1 : 0 })}${unit === "layer" ? "" : ` ${unit}`}`);
    const x = (rows = cols) => rows.t.slice();   // a copy: add() changes the rows between two redraws
    // A target of 0 is a heater switched off: not drawn, else the axis runs down to 0 °C and the
    // temperatures of an idle printer lie flat at its top (the user, 27.09.2026).
    const ys = (list, rows = cols) => list.map((n) => {
      const f = factorOf(n), off = n.startsWith("target:") ? 0 : null;
      return (rows.series[n] || []).map((v) => (v == null || v === off ? null : v * f));
    });

    function drop() {
      lanePlots.forEach((u) => u.destroy());
      lanePlots = [];
      overview?.destroy();
      overview = null;
    }
    // Above the first lane, only while printing (file_position; at rest the U1 still names a head and the
    // last layer): which head works, with more than one, each stretch with the head's number as on "Status"
    // (the user did not know the bar, and "Kopf" at the axis read like its label, 27.09.2026); each layer
    // change as a tick; each print start as a line.
    const headAt = (i) => (cols.series.file_position?.[i] != null ? cols.series.head?.[i] ?? null : null);
    const headName = (k) => label(`temp:extruder${k > 1 ? k - 1 : ""}`);
    // Several heads, from the rows: also with the printer off, for last night's print (review 27.09.2026).
    const multiHead = computed(() => names.value.filter((n) => /^temp:extruder\d*$/.test(n)).length > 1);
    function drawBand(u) {
      const ctx = u.ctx, dpr = devicePixelRatio, top = u.bbox.top - 22 * dpr, h = 12 * dpr;
      const left = u.bbox.left, right = u.bbox.left + u.bbox.width;
      const at = (t) => u.valToPos(t, "x", true);
      ctx.save();
      if (cols.series.head && multiHead.value) {
        ctx.font = `700 ${9 * dpr}px Inter, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        let from = 0;
        for (let i = 1; i <= cols.t.length; i++) {
          const k = headAt(from);
          if (i < cols.t.length && headAt(i) === k) continue;
          const a = Math.max(left, at(cols.t[from])), b = Math.min(right, at(cols.t[Math.min(i, cols.t.length - 1)]));
          if (k != null && b > a) {
            const fill = colour(`temp:extruder${k > 1 ? k - 1 : ""}`);
            ctx.fillStyle = fill;
            ctx.fillRect(a, top, b - a, h);
            if (b - a >= 12 * dpr) {
              ctx.fillStyle = luminance(fill) > 0.35 ? "#000" : "#fff";
              ctx.fillText(String(k), (a + b) / 2, top + h / 2 + 0.5 * dpr);
            }
          }
          from = i;
        }
      }
      const layer = cols.series.layer, printing = cols.series.file_position;
      if (layer && printing) {
        ctx.strokeStyle = look.axis;
        ctx.lineWidth = dpr;
        let last = -Infinity;
        for (let i = 1; i < layer.length; i++) {
          if (printing[i] == null || layer[i] == null || layer[i - 1] == null || layer[i] === layer[i - 1]) continue;
          const px = at(cols.t[i]);
          if (px < left || px > right || px - last < 3 * dpr) continue;
          ctx.beginPath();
          ctx.moveTo(px, top + h + 2 * dpr);
          ctx.lineTo(px, top + h + 6 * dpr);
          ctx.stroke();
          last = px;
        }
      }
      ctx.strokeStyle = `rgb(${look.accent})`;
      ctx.lineWidth = 2 * dpr;
      for (const [t] of cols.files || []) {
        const px = at(t);
        if (px < left || px > right) continue;
        ctx.beginPath();
        ctx.moveTo(px, top - 4 * dpr);
        ctx.lineTo(px, u.bbox.top + u.bbox.height);
        ctx.stroke();
      }
      ctx.restore();
    }
    // At the end of each line while following: a glowing dot, the value now.
    function drawNow(u, lane) {
      if (!follow.value) return;
      const ctx = u.ctx, dpr = devicePixelRatio;
      lane.names.forEach((n, i) => {
        if (n.startsWith("target:")) return;
        const list = u.data[i + 1];
        let k = list.length - 1;
        while (k >= 0 && list[k] == null) k--;
        if (k < 0 || u.data[0][k] < u.scales.x.min) return;
        const px = u.valToPos(u.data[0][k], "x", true), py = u.valToPos(list[k], "y", true);
        ctx.save();
        ctx.globalAlpha = u.series[i + 1].alpha ?? 1;   // faded with its line (spotlight)
        ctx.fillStyle = colour(n);
        ctx.shadowColor = colour(n);
        ctx.shadowBlur = 10 * dpr;
        ctx.beginPath();
        ctx.arc(px, py, 3.5 * dpr, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      });
    }
    async function build() {
      const mine = ++builds;
      builtKey = lanesKey.value;
      await nextTick();
      uPlot = uPlot || await loadUplot();
      if (gone || mine !== builds) return;   // left, or a newer build started meanwhile
      drop();
      look = colours();
      const axis = { stroke: look.axis, grid: { stroke: look.grid, width: 1 }, ticks: { show: false }, font: "11px Inter, sans-serif" };
      lanes.value.forEach((lane, li) => {
        const el = laneBoxes.value[lane.unit];
        if (!el) return;
        const u = new uPlot({
          width: el.clientWidth || 600, height: Math.max(50, el.clientHeight || 120),
          padding: [li === 0 ? 28 : 8, 10, li === lanes.value.length - 1 ? 0 : 4, 0],
          legend: { show: false },
          focus: { alpha: 0.2 },
          cursor: {
            sync: { key: "orcaone-charts" }, points: { size: 7 },
            // Dragging zooms all lanes at once, and they stop following (setSelect below).
            drag: { x: true, y: false, setScale: false },
            bind: { dblclick: () => () => { showAll(); return null; } },
          },
          scales: {
            x: { time: true },
            // Percent from 0 to at least 100, so a fan at 30 % looks like 30 %.
            y: lane.unit === "%" ? { range: (_, min, max) => [0, Math.max(100, max)] } : {},
          },
          series: [{}, ...lane.names.map((n) => {
            const target = n.startsWith("target:");
            return {
              stroke: () => colour(n), width: target ? 1.2 : 1.8, dash: target ? [5, 4] : undefined,
              paths: target || /^(fan|power):|^layer$/.test(n) ? uPlot.paths.stepped({ align: 1 }) : undefined,
              points: { show: false },
            };
          })],
          axes: [
            { ...axis, show: li === lanes.value.length - 1, size: 28, values: timeTicks },
            // The unit turned along the axis, in its middle (the user's wish of 27.09.2026).
            { ...axis, size: 44, label: D.units[lane.unit] || lane.unit, labelSize: 18, labelFont: "600 11px Inter, sans-serif",
              values: (_, ticks) => ticks.map((v) => v.toLocaleString(LOCALE)) },
          ],
          hooks: {
            // No fill under the lines (with several only colour noise, the user 27.09.2026): the plot area itself
            // fades from the colour of a card at the top into the stage; teal looked baby blue (the user).
            drawClear: [(u2) => {
              const { left, top, width, height } = u2.bbox, g = u2.ctx.createLinearGradient(0, top, 0, top + height);
              g.addColorStop(0, `rgb(${look.surface})`);
              g.addColorStop(1, `rgba(${look.surface}, 0)`);
              u2.ctx.fillStyle = g;
              u2.ctx.fillRect(left, top, width, height);
            }],
            draw: [(u2) => {
              if (li === 0) drawBand(u2);
              drawNow(u2, lane);
            }],
            // The hover box belongs to the lane under the mouse; the others only follow its cursor.
            setCursor: [(u2) => {
              if (li !== activeLane) return;
              const idx = u2.cursor.idx;
              if (idx == null || u2.cursor.left < 0) { hover.value = null; return; }
              const r = u2.over.getBoundingClientRect(), box = lanesBox.value.getBoundingClientRect();
              hover.value = { idx, left: r.left - box.left + u2.cursor.left, top: r.top - box.top + u2.cursor.top, width: box.width, height: box.height };
            }],
            // The lanes share the mouse (cursor.sync): the others get the same mouseup and their own selection
            // right after this one, in the same event; only the first zooms (review 27.09.2026).
            setSelect: [(u2) => {
              if (zooming || u2.select.width < 3) return;
              const min = u2.posToVal(u2.select.left, "x"), max = u2.posToVal(u2.select.left + u2.select.width, "x");
              zooming = true;
              queueMicrotask(() => {
                zooming = false;
                lanePlots.forEach((p) => p.setSelect({ left: 0, width: 0, top: 0, height: 0 }, false));
              });
              zoom(min, max);
            }],
          },
        }, [x(), ...ys(lane.names)], el);
        lanePlots.push(u);
        // The lane under the mouse by its plot, not its place: lanes come and go (review 27.09.2026).
        u.over.addEventListener("pointerenter", () => { activeLane = li; });
      });
      if (overviewBox.value) {
        overviewNames = Object.keys(wide.series).filter((k) => /^temp:extruder\d*$/.test(k)).sort();
        overview = new uPlot({
          width: overviewBox.value.clientWidth || 600, height: overviewBox.value.clientHeight || 44, padding: [3, 0, 3, 0],
          legend: { show: false }, cursor: { show: false }, axes: [{ show: false }, { show: false }],
          scales: {
            x: { time: true, range: (_, lo, hi) => (hi == null ? [lo, hi] : [hi - backSeconds, hi]) },
            act: { range: [0, 1] },
            // From 0 to at least 60 °C: at rest the heads lie low and flat, heating shows.
            y: { range: (_, lo, hi) => [Math.min(0, lo ?? 0), Math.max(60, hi ?? 60)] },
          },
          series: [{}, { scale: "act", width: 0, fill: `rgba(${look.accent}, 0.2)`, paths: uPlot.paths.stepped({ align: 1 }), points: { show: false } },
                   ...overviewNames.map((n) => ({ stroke: () => colour(n), width: 1, points: { show: false } }))],
        }, overviewData(), overviewBox.value);
      }
      redraw();
    }
    // The newest values in view: the span up to now while following, else the zoom kept.
    function redraw() {
      const last = cols.t[cols.t.length - 1], data = x();
      lanePlots.forEach((u, i) => {
        const lane = lanes.value[i];
        if (!lane) return;
        u.batch(() => {
          u.setData([data, ...ys(lane.names)], false);
          if (follow.value && last) u.setScale("x", { min: last - seconds(), max: last });
          else if (view.value) u.setScale("x", view.value);
        });
      });
      overview?.setData(overviewData());
      if (follow.value && last) view.value = { min: last - seconds(), max: last };
      tick.value++;
      // New rows under a resting mouse: the hover box to the row the cursor stands at now.
      const under = lanePlots[activeLane];
      if (under && under.cursor.left >= 0) under.setCursor({ left: under.cursor.left, top: under.cursor.top });
    }
    // Zoomed in or moved back: the rows of the window fetched a moment later, unless the lanes have them
    // finely enough already (at least a third of what they hold, or an hour).
    function zoom(min, max, fetch = true) {
      if (!(max > min)) return;
      follow.value = false;
      view.value = { min, max };
      lanePlots.forEach((u) => u.batch(() => u.setScale("x", { min, max })));
      tick.value++;
      clearTimeout(fetchTimer);
      const first = cols.t[0], last = cols.t[cols.t.length - 1];
      const fine = first <= min + GAP && last >= max - GAP && ((max - min) * 3 >= last - first || last - first <= 3600);
      if (fetch && !fine) fetchTimer = setTimeout(() => load({ min, max }), 300);
    }
    function showAll() {
      follow.value = true;
      view.value = null;
      clearTimeout(fetchTimer);
      if (detail || busy.value) load();   // a load on its way may be a window: asked again, it is dropped
      else redraw();
    }
    // The line under the mouse in the panel stands out in its lane, the others fade (the user's wish of
    // 27.09.2026); null: all as they were. A lane without it fades as a whole.
    function spotlight(n) {
      lanePlots.forEach((u, i) => {
        const at = n == null ? null : (lanes.value[i]?.names.indexOf(n) ?? -1);
        u.setSeries(at == null ? null : at >= 0 ? at + 1 : -1, { focus: true });
      });
    }
    function toggleFollow() {
      if (!follow.value) return showAll();
      follow.value = false;
      redraw();
    }

    // ------------------------------------------------------------ the overview window
    const windowStyle = computed(() => {
      void tick.value;
      const v = view.value, r = wideRange(), first = r?.first, last = r?.last;
      if (!v || !(last > first)) return { display: "none" };
      const a = Math.max(0, (v.min - first) / (last - first)), b = Math.min(1, (v.max - first) / (last - first));
      return { left: `${a * 100}%`, width: `${Math.max(0.5, (b - a) * 100)}%` };
    });
    // Drag inside the window moves it, elsewhere draws a new one; while dragging the lanes show the
    // overview's rows, then those of the window. A click, or the window dragged to now, follows again.
    // The time the overview starts at, in front of it; with a day or more the date.
    const overviewFrom = computed(() => {
      void tick.value;
      const r = wideRange();
      return r ? (backSeconds >= 86400 ? day(r.first) : clock(r.first)) : "";
    });
    let dragging = null;
    function overviewDown(ev) {
      const box = overviewBox.value?.getBoundingClientRect(), r = wideRange(), first = r?.first, last = r?.last;
      if (!box || !(last > first)) return;
      const timeAt = (clientX) => first + Math.min(1, Math.max(0, (clientX - box.left) / box.width)) * (last - first);
      const start = timeAt(ev.clientX), v = view.value;
      const inside = v && start >= v.min && start <= v.max;
      dragging = { timeAt, start, from: inside ? { ...v } : null, step: (last - first) / box.width * 4, moved: false };
      ev.currentTarget.setPointerCapture(ev.pointerId);
    }
    function overviewMove(ev) {
      if (!dragging) return;
      const t = dragging.timeAt(ev.clientX), { first, last } = wideRange();
      if (!dragging.moved && Math.abs(t - dragging.start) < dragging.step) return;
      if (!dragging.moved) {
        dragging.moved = true;
        asked++;   // an answer on its way is not wanted any more, and it will not end busy
        busy.value = false;
        clearTimeout(fetchTimer);
        cols = wide;
        detail = true;
      }
      if (dragging.from) {
        const width = dragging.from.max - dragging.from.min;
        const min = Math.min(last - width, Math.max(first, dragging.from.min + t - dragging.start));
        zoom(min, min + width, false);
      } else {
        zoom(Math.min(t, dragging.start), Math.max(t, dragging.start), false);
      }
      redraw();
    }
    function overviewUp() {
      const done = dragging, v = view.value, last = wide.t[wide.t.length - 1];
      dragging = null;
      if (!done) return;
      if (!done.moved || (v && v.max >= last - done.step)) showAll();
      else zoom(v.min, v.max);
    }

    // ------------------------------------------------------------ values for the panel and the hover box
    function valueAt(n, idx, rows = cols) {
      void tick.value;
      const list = rows.series[n] || [];
      let i = idx ?? list.length - 1;
      if (idx == null) while (i > 0 && list[i] == null) i--;
      return list[i] == null ? null : list[i] * factorOf(n);
    }
    // In the panel the value under the mouse, else the newest (the overview's rows get every new one).
    const shownValue = (n) => number(hover.value ? valueAt(n, hover.value.idx) : valueAt(n, null, wide), unitOf(n));
    const hoverBox = computed(() => {
      const h = hover.value;
      void tick.value;
      const t = h && cols.t[h.idx];
      if (t == null) return null;
      const layer = valueAt("layer", h.idx);
      // The file printed then: the last print start before, as long as Klipper was reading a file.
      const printing = valueAt("file_position", h.idx) != null;
      const file = printing ? (cols.files || []).filter(([s]) => s <= t).pop()?.[1] : null;
      const head = multiHead.value ? headAt(h.idx) : null;
      return {
        title: `${day(t)} ${clock(t, true)}${printing && layer != null ? ` · ${D.layer(layer)}` : ""}`, file,
        head: head ? { n: `temp:extruder${head > 1 ? head - 1 : ""}`, text: D.working(headName(head)) } : null,
        rows: lanes.value.flatMap((l) => mainOf(l).map((n) => ({
          n, text: label(n), value: number(valueAt(n, h.idx), l.unit),
          target: l.names.includes(`target:${partOf(n)}`) && valueAt(`target:${partOf(n)}`, h.idx) ? number(valueAt(`target:${partOf(n)}`, h.idx), l.unit) : null,
        }))),
        // Beside the mouse, on the side with room.
        style: { left: `${h.left}px`, top: `${h.top}px`,
                 transform: `translate(${h.left > h.width / 2 ? "calc(-100% - 14px)" : "14px"}, ${h.top > h.height / 2 ? "-100%" : "0"})` },
      };
    });
    function leaveLanes() {
      activeLane = -1;
      hover.value = null;
    }

    // ------------------------------------------------------------ keeping it together
    function resize() {
      lanePlots.forEach((u, i) => {
        const el = laneBoxes.value[lanes.value[i]?.unit];
        if (el) u.setSize({ width: el.clientWidth, height: Math.max(50, el.clientHeight) });
      });
      if (overview && overviewBox.value) overview.setSize({ width: overviewBox.value.clientWidth, height: overviewBox.value.clientHeight || 44 });
    }
    function pick(s) {
      if (s === span.value) return showAll();
      span.value = s;
      follow.value = true;
    }
    // A print over: "Dieser Druck" goes, the span that covered it stays.
    watch(spans, (list) => {
      if (!list.includes(span.value)) span.value = SPANS.find((s) => s >= (monitor.value?.job?.elapsed || 0) + 60) || SPANS[SPANS.length - 1];
    });
    watch(printer, () => {
      send();
      picked.value = [];
      opened.value = {};
      leaveLanes();
      follow.value = true;
      view.value = null;
      cols = wide = { t: [], series: {}, files: [] };
      detail = false;
      names.value = [];
      load();
    });
    watch(span, () => load());   // not load itself: it would take the new span for a window
    watch(lanesKey, (key) => key !== builtKey && build());
    watch(() => heads.value.map((h) => h.spool?.colour).join(), () => lanePlots.length && build());
    const rebuild = () => build();
    onMounted(() => {
      load();
      observer = new ResizeObserver(resize);
      observer.observe(lanesBox.value);
      themeWatch = new MutationObserver(rebuild);
      themeWatch.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
      darkQuery.addEventListener("change", rebuild);
    });
    onUnmounted(() => {
      gone = true;
      drop();
      send();
      clearTimeout(fetchTimer);
      observer?.disconnect();
      themeWatch?.disconnect();
      darkQuery.removeEventListener("change", rebuild);
    });

    return { D, presetIds, presetLabel, presetNow, presetChoice, printer, spans, span, follow, busy, failed, names, picked, panelOpen, opened, lanes, laneBoxes, lanesBox,
             overviewBox, overviewFrom, catalogue, windowStyle, hoverBox, label, colour, partOf, shownValue, isOpen, toggle,
             pick, toggleFollow, spotlight, leaveLanes, overviewDown, overviewMove, overviewUp };
  },

  template: `
    <div class="page fill-page charts-page">
      <div class="v3d-head">
        <h1 id="page-title" tabindex="-1">{{ D.title }}</h1>
        <span class="spacer"></span>
        <div class="chips" role="group" :aria-label="D.span">
          <button v-for="s in spans" :key="s" type="button" class="chip" :aria-pressed="s === span ? 'true' : 'false'"
                  @click="pick(s)">{{ D.spans[s] }}</button>
        </div>
        <button type="button" class="chip chip-icon" :aria-pressed="follow ? 'true' : 'false'" :aria-label="D.follow" :title="D.followHint"
                @click="toggleFollow"><ui-icon name="live" :size="16"/></button>
        <button type="button" class="chip chip-icon" :aria-expanded="panelOpen ? 'true' : 'false'" aria-controls="charts-panel"
                :aria-label="D.choose" :title="D.chooseHint" @click="panelOpen = !panelOpen"><ui-icon name="sliders" :size="16"/></button>
      </div>

      <div :class="['charts-body', { 'has-panel': panelOpen }]">
        <section class="v3d-stage charts-stage" :aria-label="D.stage">
          <p v-if="!printer" class="charts-empty">{{ D.noPrinters }}</p>
          <p v-else-if="failed" class="charts-empty alert" role="alert">{{ failed }}</p>
          <p v-else-if="!names.length" class="charts-empty">{{ busy ? D.loading : D.nothingYet }}</p>
          <p v-else-if="!lanes.length" class="charts-empty">{{ D.nothingPicked }}</p>
          <div ref="lanesBox" class="charts-lanes" :title="lanes.length ? D.zoomHint : null" @pointerleave="leaveLanes">
            <div v-for="l in lanes" :key="l.unit" class="charts-lane">
              <div :ref="(el) => { if (el) laneBoxes[l.unit] = el; }" class="charts-plot"></div>
            </div>
            <div v-if="hoverBox" class="charts-hover" :style="hoverBox.style" aria-hidden="true">
              <p class="charts-hover-title">{{ hoverBox.title }}</p>
              <p v-if="hoverBox.file" class="charts-hover-file">{{ hoverBox.file }}</p>
              <p v-if="hoverBox.head" class="charts-hover-row"><span class="charts-swatch" :style="{ '--c': colour(hoverBox.head.n) }"></span>
                <span>{{ hoverBox.head.text }}</span></p>
              <p v-for="r in hoverBox.rows" :key="r.n" class="charts-hover-row">
                <span class="charts-swatch" :style="{ '--c': colour(r.n) }"></span><span>{{ r.text }}</span>
                <b>{{ r.value }}<small v-if="r.target"> / {{ r.target }}</small></b></p>
            </div>
          </div>
          <div v-show="lanes.length" class="charts-overview-row">
            <span class="charts-overview-from">{{ overviewFrom }}</span>
            <div class="charts-overview" :title="D.overviewHint"
                 @pointerdown="overviewDown" @pointermove="overviewMove" @pointerup="overviewUp" @pointercancel="overviewUp">
              <div ref="overviewBox" class="charts-overview-plot"></div>
              <div class="charts-window" :style="windowStyle"></div>
            </div>
          </div>
        </section>

        <aside v-show="panelOpen" id="charts-panel" class="charts-panel" :aria-label="D.choose">
          <div class="charts-panel-head">
            <h2>{{ D.choose }}</h2>
            <button type="button" class="icon-btn" :aria-label="D.closePanel" :title="D.closePanel" @click="panelOpen = false">
              <ui-icon name="close" :size="16"/></button>
          </div>
          <label class="charts-preset">
            <span>{{ D.presetsLabel }}</span>
            <select v-model="presetChoice" class="input">
              <option v-if="presetNow === ''" value="" disabled>{{ D.presetOwn }}</option>
              <option v-for="id in presetIds" :key="id" :value="id">{{ presetLabel(id) }}</option>
            </select>
          </label>
          <div class="charts-groups">
            <section v-for="(g, i) in catalogue" :key="g.id" class="charts-group">
              <button type="button" class="charts-group-head" :aria-expanded="isOpen(g, i) ? 'true' : 'false'"
                      @click="opened = { ...opened, [g.id]: !isOpen(g, i) }">
                <ui-icon name="chevron" :size="14" class="chev"/>
                <span>{{ D.groups[g.id] }}</span>
              </button>
              <ul v-if="isOpen(g, i)" class="charts-items">
                <li v-for="n in g.items" :key="n">
                  <label :class="['charts-item', { 'is-on': picked.includes(n) }]" @mouseenter="picked.includes(n) && spotlight(n)"
                         @mouseleave="spotlight(null)" @focusin="picked.includes(n) && spotlight(n)" @focusout="spotlight(null)">
                    <input type="checkbox" :checked="picked.includes(n)" @change="toggle(n)">
                    <span class="charts-swatch" :style="{ '--c': colour(n) || 'var(--muted)' }"></span>
                    <span class="charts-item-name">{{ label(n) }}<small v-if="n.startsWith('temp:') && names.includes('target:' + partOf(n))">{{ D.withTarget }}</small></span>
                    <b class="charts-item-value">{{ shownValue(n) }}</b>
                  </label>
                </li>
              </ul>
            </section>
          </div>
        </aside>
      </div>
    </div>
  `,
};
