// Page "2D Ansicht" (the user's wish of 24.09.2026: like "3D Ansicht", "etwas technischer, mit ein
// paar mehr Infos"): one layer of a print file from above, the same file as on "3D Ansicht"
// (pages/print-view.js reads it). Every line in its real width, coloured by filament, line type,
// speed, volumetric flow, acceleration, part fan, nozzle temperature or width; travels and
// retractions on request, the layer below faint. A second slider steps through the lines of the
// layer. Pointing at a line tells what it is; a click keeps it and shows its G-code, read as a
// piece of the file. At the side the layer (height, time by the slicer, filament, travels, line
// types) and the file (slicer, profiles, filament per head, all its settings). While the printer
// prints the file shown, the page follows it: the layer printed, what is done in colour, the
// nozzle. A 2D canvas, so no WebGL needed.
import { go, hashOf, ui, LOCALE, activeName, fmtSize, darkQuery } from "../common.js";
import { T } from "../texts.js";
import { usePrintFile, bedArea, STAGE_STATE, typeColour, toolColour, activeHead, isLight } from "./print-view.js";

const { ref, computed, watch, nextTick, onMounted, onUnmounted } = Vue;
const V = T.view2d, V3 = T.view3d;
// Low to high: PrusaSlicer's range colours, which OrcaSlicer's legend shows as well.
const SCALE = ["#0B2C7A", "#135985", "#1C8891", "#04D60F", "#AAF200", "#FCF903", "#F5CE0A", "#D16830", "#C2523C", "#942616"];
const STEPS = 24;              // colours of the scale drawn
const TRAIL = 30;              // lines printed last, with a halo: where the nozzle has just been
const RETRACT = "#E5484D", PRIME = "#30A46C";
const BELOW = "#6F86AD";       // the layer below: blue-grey, so it differs even from black or grey filament
const RAMP = Array.from({ length: STEPS }, (_, s) => {
  const v = (s / (STEPS - 1)) * (SCALE.length - 1), i = Math.min(SCALE.length - 2, Math.floor(v)), k = v - i;
  const [a, b] = [SCALE[i], SCALE[i + 1]].map((c) => [1, 3, 5].map((n) => parseInt(c.slice(n, n + 2), 16)));
  return `rgb(${a.map((x, n) => Math.round(x + (b[n] - x) * k)).join(",")})`;
});
const SCALE_CSS = `linear-gradient(90deg, ${SCALE.join(", ")})`;

// Cross-section of a line as the slicers reckon it: a rectangle with round sides (Flow::mm3_per_mm).
const area = (d, i) => {
  const w = d.wh[2 * i] / 100, h = d.wh[2 * i + 1] / 100;
  return h * (w - h * (1 - Math.PI / 4));
};
// What the colours can tell besides filament and line type: a value per line.
const VALUES = {
  speed: { unit: "mm/s", digits: 0, of: (d, i) => d.speed[i] / 60 },
  flow: { unit: "mm³/s", digits: 1, of: (d, i) => (area(d, i) * d.speed[i]) / 60 },
  accel: { unit: "mm/s²", digits: 0, of: (d, i) => d.accel[i] },
  fan: { unit: "%", digits: 0, of: (d, i) => d.fan[i] / 2.55, fixed: [0, 100] },
  temp: { unit: "°C", digits: 0, of: (d, i) => d.temp[i] },
  width: { unit: "mm", digits: 2, of: (d, i) => d.wh[2 * i] / 100 },
};
const MODES = ["filament", "type", ...Object.keys(VALUES)];

// The first index in the sorted list at or above v.
function lowerBound(list, v) {
  let lo = 0, hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid] < v) lo = mid + 1; else hi = mid;
  }
  return lo;
}

// The lines around the one starting at bytes[at], numbered: five before, ten after. The first
// line of the piece counts only if the piece starts the file.
function around(bytes, at, no, fromStart) {
  const decoder = new TextDecoder();
  const text = (a, b) => decoder.decode(bytes.subarray(a, b)).replace(/\r$/, "");
  const rows = [];
  let s = at;
  for (let k = 1; k <= 5 && s > 0; k++) {
    let p = s - 2;
    while (p >= 0 && bytes[p] !== 10) p--;
    if (p < 0 && !fromStart) break;
    rows.unshift({ no: no - k, text: text(p + 1, s - 1), here: false });
    s = p + 1;
  }
  for (let k = 0, q = at; k <= 10 && q < bytes.length; k++) {
    const end = bytes.indexOf(10, q);
    if (end < 0 && k > 0) break;  // cut off by the end of the piece
    rows.push({ no: no + k, text: text(q, end < 0 ? bytes.length : end), here: k === 0 });
    if (end < 0) break;
    q = end + 1;
  }
  return rows;
}

export default {
  name: "Druck2dPage",
  props: { instId: { type: String, default: null } },  // the page does not depend on an installation

  setup(props) {
    const layer = ref(1);           // the layer shown
    const step = ref(0);            // lines of the layer drawn in full: 0 … lines
    const mode = ref("filament");   // what the colours tell
    const travels = ref(false);     // travels and retractions
    const below = ref(true);        // the layer below, faint
    const hover = ref(-1);          // the line under the pointer
    const picked = ref(-1);         // the line clicked
    const tip = ref(null);          // { x, y } of the pointer, for the tooltip
    const gcode = ref(null);        // [{ no, text, here }] around a line, or "error"
    const filter = ref("");         // in the settings of the file
    const settingsOpen = ref(false);
    const canvas = ref(null), stage = ref(null);
    const file = usePrintFile(show);
    const { data, layers, job, printing, printedCount, printedLayer, follow } = file;

    const firstOf = (L) => (L <= 1 ? 0 : data.value.layerStart[L - 1]);
    const endOf = (L) => (L >= layers.value ? data.value.count : data.value.layerStart[L]);
    const lines = computed(() => (data.value ? endOf(layer.value) - firstOf(layer.value) : 0));
    const following = () => follow.value && printing.value;
    const num = (v, digits = 0) => (v == null || Number.isNaN(v) ? "–"
      : v.toLocaleString(LOCALE, { minimumFractionDigits: digits, maximumFractionDigits: digits }));

    // ------------------------------------------------------------ colours
    let ranges = new Map();  // mode → [lowest, highest] of the file's lines
    function rangeOf(m) {
      if (!ranges.has(m)) {
        const d = data.value, of = VALUES[m].of;
        let lo = Infinity, hi = -Infinity;
        for (let i = 0; i < d.count; i++) {
          const v = of(d, i);
          if (v < lo) lo = v;
          if (v > hi) hi = v;
        }
        ranges.set(m, VALUES[m].fixed || [lo, hi]);
      }
      return ranges.get(m);
    }
    // key(i): a small number per colour, css(key): the colour.
    function colouring(d) {
      const m = mode.value;
      if (m === "filament") return { key: (i) => d.tool[i], css: (k) => toolColour(d, k) };
      if (m === "type") return { key: (i) => d.kind[i], css: (k) => typeColour(d.types[k]) };
      const [lo, hi] = rangeOf(m), of = VALUES[m].of, span = hi - lo;
      const key = span > 0 ? (i) => Math.max(0, Math.min(STEPS - 1, Math.round(((of(d, i) - lo) / span) * (STEPS - 1)))) : () => STEPS >> 1;
      return { key, css: (k) => RAMP[k] };
    }
    // The page's colours, resolved (the variables hold light-dark(…)).
    let colours = {};
    function readColours() {
      const probe = document.body.appendChild(document.createElement("span"));
      const get = (name) => { probe.style.color = `var(${name})`; return getComputedStyle(probe).color; };
      colours = { back: get("--surface-2"), plate: get("--surface"), fine: get("--divider"), strong: get("--line-box"),
                  travel: get("--accent-text"), accent: get("--accent-line"), text: get("--text") };
      probe.remove();
    }

    // ------------------------------------------------------------ the drawing
    let ctx = null, frame = 0, width = 0, height = 0, dpr = 1, fitted = false, observer = null, themeWatch = null;
    const view = { scale: 1, tx: 0, ty: 0 };  // px per mm, where x = 0 and y = 0 are on the canvas
    const draw = () => { if (ctx && !frame) frame = requestAnimationFrame(paint); };

    function start() {
      if (ctx || !canvas.value) return;
      ctx = canvas.value.getContext("2d");
      readColours();
      observer = new ResizeObserver(resize);
      observer.observe(stage.value);
      themeWatch = new MutationObserver(recolour);
      themeWatch.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
      darkQuery.addEventListener("change", recolour);
      resize();
    }
    function recolour() {
      readColours();
      draw();
    }
    function resize() {
      if (!stage.value || !canvas.value) return;
      width = stage.value.clientWidth;
      height = stage.value.clientHeight;
      dpr = window.devicePixelRatio || 1;
      canvas.value.width = Math.round(width * dpr);
      canvas.value.height = Math.round(height * dpr);
      if (!fitted) fit();
      draw();
    }
    // The print without the start G-code, whose purge line runs along the edge of the bed.
    let box = null;
    function boxOf(d) {
      const custom = d.types.indexOf("Custom"), pos = d.pos;
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (let i = 0; i < d.count; i++) {
        if (d.kind[i] === custom) continue;
        const p = i * 5;
        minX = Math.min(minX, pos[p], pos[p + 3]); maxX = Math.max(maxX, pos[p], pos[p + 3]);
        minY = Math.min(minY, pos[p + 1], pos[p + 4]); maxY = Math.max(maxY, pos[p + 1], pos[p + 4]);
      }
      return minX <= maxX ? { minX: minX / d.unit, minY: minY / d.unit, maxX: maxX / d.unit, maxY: maxY / d.unit } : d.bounds;
    }
    // The print in view, beside the legend, the sliders on the right and at the bottom.
    function fit() {
      const b = box;
      if (!b || !width || !height) return;
      const left = 16, right = 76, top = 72, bottom = 64;  // room for the legend and the sliders
      const w = Math.max(b.maxX - b.minX, 5), h = Math.max(b.maxY - b.minY, 5);
      view.scale = Math.max(0.1, Math.min((width - left - right) / w, (height - top - bottom) / h));
      view.tx = left + (width - left - right) / 2 - ((b.minX + b.maxX) / 2) * view.scale;
      view.ty = top + (height - top - bottom) / 2 + ((b.minY + b.maxY) / 2) * view.scale;
      fitted = true;
    }
    function refit() {
      fit();
      draw();
    }

    function paint() {
      frame = 0;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.globalAlpha = 1;
      ctx.fillStyle = colours.back;
      ctx.fillRect(0, 0, width, height);
      const d = data.value;
      if (!d) return;
      paintBed(d);
      // Told apart at a glance (the user's wish): the layer below as a blue-grey footprint, what is
      // printed in full width and colour, what is still to come as thin lines; the lines printed
      // last with a halo that fades with their age, the one printed now with the strongest.
      const L = layer.value, a = firstOf(L), b = endOf(L), s = a + step.value, colour = colouring(d);
      if (below.value && L > 1) paintLines(d, firstOf(L - 1), a, 0.3, () => 0, () => BELOW);
      if (s > a && s < b) {
        const from = Math.max(a, s - TRAIL);
        for (let i = from; i < s - 1; i++) paintHalo(d, i, i + 1, 0.12 + (0.5 * (i - from)) / TRAIL, 8);
        paintHalo(d, s - 1, s, 1, 11);
      }
      paintLines(d, a, s, 1, colour.key, colour.css);
      if (s < b) paintLines(d, s, b, 0.6, colour.key, colour.css, true);
      if (travels.value) paintTravels(d, a, s);
      for (const i of [hover.value, picked.value]) if (i >= a && i < b) paintMark(d, i, colour, i === picked.value);
      // The nozzle: the printer's while following it, else at the end of the last line drawn.
      const p = job.value?.motion.position;
      if (following() && p) paintNozzle(p[0], p[1], activeHead(job.value, d));
      else if (s > a && s < b) paintNozzle(d.pos[(s - 1) * 5 + 3] / d.unit, d.pos[(s - 1) * 5 + 4] / d.unit);
    }
    function paintBed(d) {
      const area = bedArea(d, job.value?.motion);
      if (!area) return;
      const [x0, y0, x1, y1] = area, k = view.scale;
      const X = (x) => view.tx + x * k, Y = (y) => view.ty - y * k;
      ctx.fillStyle = colours.plate;
      ctx.fillRect(X(x0), Y(y1), (x1 - x0) * k, (y1 - y0) * k);
      ctx.lineWidth = 1;
      for (const [every, colour] of [[10, colours.fine], [50, colours.strong]]) {
        if (every * k < 6) continue;  // too close to see
        ctx.strokeStyle = colour;
        ctx.beginPath();
        for (let x = Math.ceil(x0 / every) * every; x <= x1; x += every) {
          const sx = Math.round(X(x)) + 0.5;
          ctx.moveTo(sx, Y(y0));
          ctx.lineTo(sx, Y(y1));
        }
        for (let y = Math.ceil(y0 / every) * every; y <= y1; y += every) {
          const sy = Math.round(Y(y)) + 0.5;
          ctx.moveTo(X(x0), sy);
          ctx.lineTo(X(x1), sy);
        }
        ctx.stroke();
      }
    }
    // Lines a … b in one path per colour and width, as they follow each other. At least 1.6 px wide,
    // so a printed area looks filled even from afar; thin: a fine trace of what is still to come.
    function paintLines(d, a, b, alpha, key, css, thin = false) {
      const pos = d.pos, wh = d.wh, k = view.scale / d.unit, tx = view.tx, ty = view.ty;
      ctx.globalAlpha = alpha;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      let last = -1, lx = NaN, ly = NaN;
      for (let i = a; i < b; i++) {
        const c = key(i), next = c * 256 + wh[2 * i];
        if (next !== last) {
          if (last !== -1) ctx.stroke();
          last = next;
          ctx.beginPath();
          lx = NaN;
          ctx.strokeStyle = css(c);
          ctx.lineWidth = thin ? 0.8 : Math.max(1.6, (wh[2 * i] / 100) * view.scale);
        }
        const p = i * 5, x0 = tx + pos[p] * k, y0 = ty - pos[p + 1] * k;
        if (x0 !== lx || y0 !== ly) ctx.moveTo(x0, y0);
        lx = tx + pos[p + 3] * k;
        ly = ty - pos[p + 4] * k;
        ctx.lineTo(lx, ly);
      }
      if (last !== -1) ctx.stroke();
      ctx.globalAlpha = 1;
    }
    // A halo in the accent colour under lines a … b, `more` px wider than they are.
    function paintHalo(d, a, b, alpha, more) {
      const pos = d.pos, k = view.scale / d.unit;
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = colours.accent;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.lineWidth = Math.max(1, (d.wh[2 * Math.max(a, b - 1)] / 100) * view.scale) + more;
      ctx.beginPath();
      for (let i = a; i < b; i++) {
        const p = i * 5;
        ctx.moveTo(view.tx + pos[p] * k, view.ty - pos[p + 1] * k);
        ctx.lineTo(view.tx + pos[p + 3] * k, view.ty - pos[p + 4] * k);
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    // Travels between the lines drawn, dashed, and the retractions (red) and primes (green).
    function paintTravels(d, a, s) {
      const k = view.scale / d.unit, tx = view.tx, ty = view.ty;
      const [t0, t1] = [lowerBound(d.travelAt, a), lowerBound(d.travelAt, s)];
      ctx.lineWidth = 1;
      ctx.strokeStyle = colours.travel;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      for (let j = t0; j < t1; j++) {
        const p = j * 4;
        ctx.moveTo(tx + d.travel[p] * k, ty - d.travel[p + 1] * k);
        ctx.lineTo(tx + d.travel[p + 2] * k, ty - d.travel[p + 3] * k);
      }
      ctx.stroke();
      ctx.setLineDash([]);
      const [r0, r1] = [lowerBound(d.retractAt, a), lowerBound(d.retractAt, s)];
      for (const [which, colour] of [[1, RETRACT], [2, PRIME]]) {
        ctx.fillStyle = colour;
        ctx.beginPath();
        for (let j = r0; j < r1; j++) {
          if (d.retractKind[j] !== which) continue;
          const x = tx + d.retract[j * 2] * k, y = ty - d.retract[j * 2 + 1] * k;
          ctx.moveTo(x + 3, y);
          ctx.arc(x, y, 3, 0, 2 * Math.PI);
        }
        ctx.fill();
      }
    }
    // A line pointed at or picked: edged in the colour of the text.
    function paintMark(d, i, colour, strong) {
      const p = i * 5, k = view.scale / d.unit, w = Math.max(1, (d.wh[2 * i] / 100) * view.scale);
      ctx.beginPath();
      ctx.moveTo(view.tx + d.pos[p] * k, view.ty - d.pos[p + 1] * k);
      ctx.lineTo(view.tx + d.pos[p + 3] * k, view.ty - d.pos[p + 4] * k);
      ctx.lineCap = "round";
      ctx.globalAlpha = strong ? 1 : 0.75;
      ctx.strokeStyle = colours.text;
      ctx.lineWidth = w + (strong ? 6 : 4);
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = colour.css(colour.key(i));
      ctx.lineWidth = w;
      ctx.stroke();
    }
    // head (activeHead) while following a print: a dot in the colour of the head printing, and its
    // number beside it when the printer has several (the user's wish).
    function paintNozzle(x, y, head = null) {
      const sx = view.tx + x * view.scale, sy = view.ty - y * view.scale;
      ctx.globalAlpha = 1;
      if (head) {
        ctx.fillStyle = head.colour;
        ctx.beginPath();
        ctx.arc(sx, sy, 5, 0, 2 * Math.PI);
        ctx.fill();
      }
      ctx.strokeStyle = colours.accent;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(sx, sy, 7, 0, 2 * Math.PI);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        ctx.moveTo(sx + dx * 4, sy + dy * 4);
        ctx.lineTo(sx + dx * 13, sy + dy * 13);
      }
      ctx.stroke();
      if (!head?.many) return;
      const bx = sx + 17, by = sy - 17;
      ctx.fillStyle = head.colour;
      ctx.beginPath();
      ctx.arc(bx, by, 9, 0, 2 * Math.PI);
      ctx.fill();
      ctx.strokeStyle = "#FFFFFF";
      ctx.stroke();
      ctx.fillStyle = isLight(head.colour) ? "#1A1A1A" : "#FFFFFF";
      ctx.font = "700 11px Inter, system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(String(head.index + 1), bx, by + 0.5);
    }

    // The line of the layer nearest to the pointer, if it is on it (half its width, at least 6 px).
    function lineAt(mx, my) {
      const d = data.value;
      if (!d) return -1;
      const u = d.unit, px = ((mx - view.tx) / view.scale) * u, py = ((view.ty - my) / view.scale) * u;
      let best = -1, near = Infinity;
      for (let i = firstOf(layer.value), b = endOf(layer.value); i < b; i++) {
        const p = i * 5, x0 = d.pos[p], y0 = d.pos[p + 1], dx = d.pos[p + 3] - x0, dy = d.pos[p + 4] - y0;
        const len2 = dx * dx + dy * dy;
        const t = len2 ? Math.max(0, Math.min(1, ((px - x0) * dx + (py - y0) * dy) / len2)) : 0;
        const ex = x0 + t * dx - px, ey = y0 + t * dy - py, dist = ex * ex + ey * ey;
        if (dist < near) { near = dist; best = i; }
      }
      const reach = best < 0 ? 0 : Math.max((d.wh[2 * best] / 200) * u, (6 / view.scale) * u);
      return near <= reach * reach ? best : -1;
    }

    // ------------------------------------------------------------ pointer and keys
    let drag = null;
    const pointer = (ev) => {
      const r = canvas.value.getBoundingClientRect();
      return [ev.clientX - r.left, ev.clientY - r.top];
    };
    function onDown(ev) {
      if (ev.button !== 0) return;
      stage.value.focus({ preventScroll: true });
      drag = { x: ev.clientX, y: ev.clientY, tx: view.tx, ty: view.ty, moved: false };
      canvas.value.setPointerCapture(ev.pointerId);
    }
    function onMove(ev) {
      if (drag) {
        const dx = ev.clientX - drag.x, dy = ev.clientY - drag.y;
        if (!drag.moved && Math.hypot(dx, dy) < 4) return;
        drag.moved = true;
        view.tx = drag.tx + dx;
        view.ty = drag.ty + dy;
        tip.value = null;
        return draw();
      }
      const [mx, my] = pointer(ev), i = lineAt(mx, my);
      if (i !== hover.value) {
        hover.value = i;
        draw();
      }
      tip.value = i >= 0 ? { x: mx, y: my } : null;
    }
    function onUp(ev) {
      if (drag && !drag.moved) {
        picked.value = lineAt(...pointer(ev));
        draw();
      }
      drag = null;
    }
    function onLeave() {
      if (drag) return;
      hover.value = -1;
      tip.value = null;
      draw();
    }
    // Zoom around the pointer.
    function onWheel(ev) {
      const [mx, my] = pointer(ev);
      const scale = Math.min(2000, Math.max(0.1, view.scale * Math.exp(-ev.deltaY * (ev.deltaMode === 1 ? 0.05 : 0.0015))));
      const g = scale / view.scale;
      view.tx = mx - (mx - view.tx) * g;
      view.ty = my - (my - view.ty) * g;
      view.scale = scale;
      draw();
    }
    const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
    // The user takes over from following the print.
    function setLayer(L) {
      if (printing.value) follow.value = false;
      layer.value = clamp(L, 1, layers.value);
    }
    function setStep(k) {
      if (printing.value) follow.value = false;
      step.value = clamp(k, 0, lines.value);
    }
    // Keys on the stage itself; the sliders on it take their arrows themselves.
    function onKey(ev) {
      if (ev.target !== stage.value) return;
      const n = ev.shiftKey ? 10 : 1;
      const keys = {
        ArrowUp: () => setLayer(layer.value + 1), ArrowDown: () => setLayer(layer.value - 1),
        PageUp: () => setLayer(layer.value + 10), PageDown: () => setLayer(layer.value - 10),
        ArrowRight: () => setStep(step.value + n), ArrowLeft: () => setStep(step.value - n),
        Home: () => setStep(0), End: () => setStep(lines.value),
      };
      if (!keys[ev.key] || !data.value) return;
      ev.preventDefault();
      keys[ev.key]();
    }

    // ------------------------------------------------------------ a file read, following the print
    function show(d) {
      ranges = new Map();
      box = boxOf(d);
      hover.value = picked.value = -1;
      gcode.value = null;
      fitted = false;
      // Following the print, its layer; else the one both views stand at, or the top.
      const asked = ui.viewLayer;
      if (following()) {
        layer.value = printedLayer.value;
        step.value = clamp(printedCount.value - firstOf(layer.value), 0, lines.value);
      } else {
        layer.value = asked >= 1 && asked <= d.layerStart.length ? asked : d.layerStart.length;
        ui.viewLayer = layer.value;
        step.value = lines.value;
      }
      nextTick(() => {
        start();
        resize();
      });
    }
    watch(layer, () => {
      if (!data.value) return;
      // The layer the user picks is the one of both views; the one followed is the printer's.
      if (!following()) {
        step.value = lines.value;
        ui.viewLayer = layer.value;
      }
      picked.value = -1;
      draw();
    });
    watch([step, mode, travels, below], draw);
    watch([printedCount, printing, follow], () => {
      if (!data.value) return draw();
      if (!following()) {
        ui.viewLayer = layer.value;  // stopped following: the layer it stands at is the one of both
        return draw();
      }
      layer.value = printedLayer.value;
      step.value = clamp(printedCount.value - firstOf(layer.value), 0, lines.value);
      draw();
    });
    watch(() => job.value?.motion, draw);
    // To "3D Ansicht", which shows the same file and layer (ui.viewLayer).
    const to3d = (ev) => go(ev, hashOf("druck3d", props.instId));
    onMounted(() => nextTick(start));
    onUnmounted(() => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
      themeWatch?.disconnect();
      darkQuery.removeEventListener("change", recolour);
      clearTimeout(waiting);
    });

    // ------------------------------------------------------------ what the side tells
    // One line: what it is and the values it was printed with.
    function describe(i) {
      const d = data.value;
      if (!d || i < 0 || i >= d.count) return null;
      const p = i * 5, u = d.unit, name = d.types[d.kind[i]], tool = d.tool[i];
      const x0 = d.pos[p] / u, y0 = d.pos[p + 1] / u, x1 = d.pos[p + 3] / u, y1 = d.pos[p + 4] / u;
      return {
        i, type: V3.types[name] || name, typeColour: typeColour(name), tool, colour: toolColour(d, tool),
        filament: [`T${tool}`, d.materials[tool]].filter(Boolean).join(" · "),
        width: d.wh[2 * i] / 100, height: d.wh[2 * i + 1] / 100, length: Math.hypot(x1 - x0, y1 - y0),
        speed: VALUES.speed.of(d, i), flow: VALUES.flow.of(d, i), accel: d.accel[i], fan: VALUES.fan.of(d, i), temp: d.temp[i],
        from: [x0, y0], to: [x1, y1], z: d.pos[p + 2] / u, line: d.line[i],
      };
    }
    // The line the side shows: the one picked, else pointed at, else the last one stepped to.
    const stepped = computed(() => (data.value && step.value > 0 && step.value < lines.value ? firstOf(layer.value) + step.value - 1 : -1));
    const lineInfo = computed(() => describe(picked.value >= 0 ? picked.value : hover.value >= 0 ? hover.value : stepped.value));
    const hoverInfo = computed(() => describe(hover.value));
    const tipStyle = computed(() => {
      if (!tip.value) return {};
      const left = tip.value.x + 280 > width ? tip.value.x - 270 : tip.value.x + 16;
      const top = tip.value.y + 110 > height ? tip.value.y - 100 : tip.value.y + 16;
      return { left: `${Math.max(4, left)}px`, top: `${Math.max(4, top)}px` };
    });

    // Its G-code: for the line picked at once, for a line stepped to a moment later.
    const gcodeOf = computed(() => (picked.value >= 0 ? picked.value : following() ? -1 : stepped.value));
    let asking = 0, waiting = 0;
    watch(gcodeOf, (i) => {
      clearTimeout(waiting);
      const mine = ++asking;
      if (i < 0) {
        gcode.value = null;
        return;
      }
      waiting = setTimeout(async () => {
        const d = data.value, at = d.offset[i], from = Math.max(0, at - 700);
        try {
          const bytes = await file.piece(from, at + 1500);
          if (mine === asking) gcode.value = around(bytes, at - from, d.line[i], from === 0);
        } catch {
          if (mine === asking) gcode.value = "error";
        }
      }, i === picked.value ? 0 : 250);
    });

    const minutes = (m) => (m == null || !Number.isFinite(m) ? null : m < 1 ? V.underMinute
      : m < 60 ? `${Math.round(m)} min` : `${Math.floor(m / 60)} h ${Math.round(m % 60)} min`);
    const layerInfo = computed(() => {
      const d = data.value;
      if (!d) return null;
      const L = layer.value, a = firstOf(L), b = endOf(L), u = d.unit;
      let length = 0, changes = 0;
      const share = new Map();
      for (let i = a; i < b; i++) {
        const p = i * 5, len = Math.hypot(d.pos[p + 3] - d.pos[p], d.pos[p + 4] - d.pos[p + 1]) / u;
        length += len;
        share.set(d.kind[i], (share.get(d.kind[i]) || 0) + len);
        if (i > a && d.tool[i] !== d.tool[i - 1]) changes++;
      }
      const [t0, t1] = [lowerBound(d.travelAt, a), lowerBound(d.travelAt, b)];
      let travelled = 0;
      for (let j = t0; j < t1; j++) {
        const p = j * 4;
        travelled += Math.hypot(d.travel[p + 2] - d.travel[p], d.travel[p + 3] - d.travel[p + 1]) / u;
      }
      let retracts = 0;
      for (let j = lowerBound(d.retractAt, a), end = lowerBound(d.retractAt, b); j < end; j++) if (d.retractKind[j] === 1) retracts++;
      // Minutes left by the slicer (M73 R) where this layer starts and where the next one does.
      const z = d.layerZ[L - 1], left = d.layerLeft[L - 1], next = L < layers.value ? d.layerLeft[L] : 0;
      return {
        z, height: z - (L > 1 ? d.layerZ[L - 2] : 0), lines: b - a, length, filament: d.layerE[L - 1], travels: t1 - t0, travelled,
        retracts, changes, time: minutes(left - next), after: next > 0 ? minutes(next) : null,
        types: [...share].sort((x, y) => y[1] - x[1]).map(([k, len]) => ({
          key: k, text: V3.types[d.types[k]] || d.types[k], colour: typeColour(d.types[k]), share: length ? len / length : 0 })),
      };
    });
    // The file: who sliced it how, from its settings ("; key = value" at its end).
    const fileInfo = computed(() => {
      const d = data.value;
      if (!d) return null;
      const s = d.settings;
      const list = (key, sep) => (s[key] ? s[key].split(sep).map((v) => v.trim().replace(/^"(.*)"$/, "$1")) : []);
      const names = list("filament_settings_id", ";"), grams = list("filament used [g]", ","), mm = list("filament used [mm]", ",");
      const temps = list("nozzle_temperature", ","), nozzles = [...new Set(list("nozzle_diameter", ","))];
      const infill = [s.sparse_infill_density, s.sparse_infill_pattern].filter(Boolean).join(" · ");
      return {
        slicer: [d.generator, d.generated].filter(Boolean).join(" · "), time: s["estimated printing time (normal mode)"],
        printer: s.printer_settings_id, process: s.print_settings_id,
        filaments: [...new Set(d.tool)].sort((a, b) => a - b).map((i) => ({
          tool: i, colour: toolColour(d, i), name: names[i] || d.materials[i] || "",
          text: [d.materials[i], grams[i] && `${num(Number(grams[i]), 1)} g`, mm[i] && `${num(Number(mm[i]) / 1000, 2)} m`,
                 temps[i] && `${temps[i]} °C`].filter(Boolean).join(" · ") })),
        layerHeight: [s.initial_layer_print_height, s.layer_height].filter(Boolean).map((v) => `${num(Number(v), 2)} mm`).join(" / "),
        nozzle: nozzles.length ? `${nozzles.map((v) => num(Number(v), 2)).join(" / ")} mm` : "",
        bed: [s.curr_bed_type, d.bed && `${num(d.bed)} °C`].filter(Boolean).join(" · "),
        infill, walls: s.wall_loops, support: s.enable_support == null ? "" : s.enable_support === "1" ? (s.support_type || V.yes) : V.no,
        tower: s.enable_prime_tower == null ? "" : s.enable_prime_tower === "1" ? V.yes : V.no,
        changes: s["total filament change"], total: s["total filament used [g]"] && `${num(Number(s["total filament used [g]"]), 1)} g`,
        counts: V.counts(num(d.lines), num(d.count), num(d.travels), num(d.retracts)),
      };
    });
    const settingsCount = computed(() => (data.value ? Object.keys(data.value.settings).length : 0));
    const settingsList = computed(() => {
      if (!settingsOpen.value || !data.value) return [];
      const q = filter.value.trim().toLowerCase();
      return Object.entries(data.value.settings)
        .filter(([k, v]) => !q || k.toLowerCase().includes(q) || v.toLowerCase().includes(q))
        .sort(([a], [b]) => a.localeCompare(b));
    });
    // The legend: filaments or line types of the file, or the scale with its ends.
    const legend = computed(() => {
      const d = data.value;
      if (!d) return null;
      const m = mode.value;
      if (m === "filament") {
        return { items: [...new Set(d.tool)].sort((a, b) => a - b)
          .map((i) => ({ key: i, colour: toolColour(d, i), text: [`T${i}`, d.materials[i]].filter(Boolean).join(" · "), spool: true })) };
      }
      if (m === "type") {
        const used = new Set(d.kind);
        return { items: d.types.map((name, i) => ({ key: name, colour: typeColour(name), text: V3.types[name] || name, used: used.has(i) }))
          .filter((x) => x.used) };
      }
      const [lo, hi] = rangeOf(m), def = VALUES[m];
      return { low: num(lo, def.digits), high: `${num(hi, def.digits)} ${def.unit}` };
    });

    return {
      ...file, T, V, V3, MODES, VALUES, SCALE_CSS, layer, step, mode, travels, below, picked, tip, gcode, filter, settingsOpen,
      canvas, stage, lines, num, fmtSize, activeName, hashOf, refit, setLayer, setStep, onDown, onMove, onUp, onLeave, onWheel,
      onKey, to3d, lineInfo, hoverInfo, tipStyle, layerInfo, fileInfo, settingsCount, settingsList, legend,
    };
  },

  template: `
    <div class="page fill-page view3d-page view2d-page">
      <div class="v3d-head">
        <h1 id="page-title" tabindex="-1">{{ V.title }}</h1>
        <span class="spacer"></span>
        <template v-if="data">
          <label class="v3d-field v2d-mode">{{ V.colourBy }}
            <select v-model="mode" class="input"><option v-for="m in MODES" :key="m" :value="m">{{ V.modes[m] }}</option></select>
          </label>
          <button class="chip" type="button" :aria-pressed="travels ? 'true' : 'false'" @click="travels = !travels">{{ V.travels }}</button>
          <button class="chip" type="button" :aria-pressed="below ? 'true' : 'false'" @click="below = !below">{{ V.below }}</button>
        </template>
        <label v-if="printing" class="v3d-follow"><input v-model="follow" type="checkbox">{{ V3.follow }}</label>
        <a class="btn" :href="hashOf('druck3d', instId)" @click="to3d"><ui-icon name="cube"/>{{ V.to3d }}</a>
      </div>
      <p v-if="host === ''" class="note">{{ V3.noHost(activeName()) }}</p>

      <div class="v2d-body">
        <div ref="stage" :class="['v3d-stage', 'v2d-stage', { 'is-over': dragging }]" tabindex="0" :aria-label="V.stage" @keydown="onKey"
             @dragover.prevent="dragging = true" @dragleave="dragging = false" @drop.prevent="onDrop">
          <canvas ref="canvas" class="v2d-canvas" @pointerdown="onDown" @pointermove="onMove" @pointerup="onUp" @pointerleave="onLeave"
                  @wheel.prevent="onWheel" @dblclick="refit"></canvas>
${STAGE_STATE}
          <template v-if="data && !loading && !error">
            <div v-if="legend" class="v2d-legend">
              <ul v-if="legend.items">
                <li v-for="l in legend.items" :key="l.key">
                  <spool-icon v-if="l.spool" :colour="l.colour" :size="16"/><span v-else class="v3d-swatch" :style="{ background: l.colour }"></span>{{ l.text }}</li>
              </ul>
              <template v-else>
                <span class="v2d-scale" :style="{ background: SCALE_CSS }"></span>
                <span class="v2d-scale-ends"><span>{{ legend.low }}</span><span>{{ legend.high }}</span></span>
              </template>
              <div v-if="step < lines || (below && layer > 1)" class="v2d-key">
                <template v-if="step < lines">
                  <span><i class="v2d-key-now"></i>{{ V.now }}</span>
                  <span><i class="v2d-key-done"></i>{{ V.done }}</span>
                  <span><i class="v2d-key-todo"></i>{{ V.todo }}</span>
                </template>
                <span v-if="below && layer > 1"><i class="v2d-key-below"></i>{{ V.below }}</span>
              </div>
            </div>
            <div class="v3d-views">
              <button class="icon-btn" type="button" :title="V.fit" :aria-label="V.fit" @click="refit"><ui-icon name="refresh"/></button>
            </div>
            <div v-if="layers > 1" class="v3d-layers v2d-layers">
              <span class="v3d-layer-text">{{ layer }}<small>/ {{ layers }}</small></span>
              <input :value="layer" class="v3d-slider" type="range" min="1" :max="layers" step="1" :aria-label="V.layer" @input="setLayer(+$event.target.value)">
              <span class="v3d-layer-z">{{ num(layerInfo.z, 2) }} mm</span>
            </div>
            <div class="v2d-steps">
              <button class="icon-btn" type="button" :title="V.back" :aria-label="V.back" @click="setStep(step - 1)"><ui-icon name="arrowLeft"/></button>
              <input :value="step" class="v2d-step-slider" type="range" min="0" :max="lines" step="1" :aria-label="V.steps" @input="setStep(+$event.target.value)">
              <button class="icon-btn" type="button" :title="V.forward" :aria-label="V.forward" @click="setStep(step + 1)"><ui-icon name="arrowRight"/></button>
              <span class="v2d-step-text">{{ V.stepOf(num(step), num(lines)) }}</span>
            </div>
            <div v-if="tip && hoverInfo" class="v2d-tip" :style="tipStyle">
              <strong><span class="v3d-swatch" :style="{ background: hoverInfo.typeColour }"></span>{{ hoverInfo.type }}</strong>
              <span><spool-icon :colour="hoverInfo.colour" :size="14"/> {{ hoverInfo.filament }}</span>
              <span>{{ num(hoverInfo.speed) }} mm/s · {{ num(hoverInfo.flow, 1) }} mm³/s · {{ num(hoverInfo.width, 2) }} × {{ num(hoverInfo.height, 2) }} mm</span>
              <span v-if="['accel', 'fan', 'temp'].includes(mode)">{{ V.modes[mode] }}: {{ num(VALUES[mode].of(data, hoverInfo.i), VALUES[mode].digits) }} {{ VALUES[mode].unit }}</span>
            </div>
          </template>
        </div>

        <aside v-if="data && !loading" class="v2d-side">
          <section class="v2d-card">
            <h2>{{ V.layerOf(num(layer), num(layers)) }}</h2>
            <dl class="v2d-rows">
              <dt>{{ V.z }}</dt><dd>{{ num(layerInfo.z, 2) }} mm · {{ V.thick(num(layerInfo.height, 2)) }}</dd>
              <dt>{{ V.linesRow }}</dt><dd>{{ num(layerInfo.lines) }} · {{ num(layerInfo.length / 1000, 2) }} m</dd>
              <dt>{{ V.filament }}</dt><dd>{{ num(layerInfo.filament / 1000, 2) }} m</dd>
              <dt>{{ V.travels }}</dt><dd>{{ num(layerInfo.travels) }} · {{ num(layerInfo.travelled / 1000, 2) }} m</dd>
              <dt>{{ V.retracts }}</dt><dd>{{ num(layerInfo.retracts) }}</dd>
              <template v-if="layerInfo.changes"><dt>{{ V.changes }}</dt><dd>{{ num(layerInfo.changes) }}</dd></template>
              <template v-if="layerInfo.time"><dt>{{ V.time }}</dt><dd>{{ layerInfo.time }}<span v-if="layerInfo.after" class="v2d-muted"> · {{ V.leftThen(layerInfo.after) }}</span></dd></template>
            </dl>
            <ul class="v2d-types">
              <li v-for="t in layerInfo.types" :key="t.key">
                <span class="v3d-swatch" :style="{ background: t.colour }"></span><span>{{ t.text }}</span><span class="v2d-muted">{{ num(t.share * 100) }} %</span>
                <span class="v2d-share"><span :style="{ width: (t.share * 100) + '%', background: t.colour }"></span></span>
              </li>
            </ul>
          </section>

          <section class="v2d-card">
            <h2>{{ V.line }}<small v-if="lineInfo" class="v2d-muted"> · {{ V.lineNo(num(lineInfo.line)) }}</small></h2>
            <p v-if="!lineInfo" class="v2d-muted v2d-hint">{{ V.lineHint }}</p>
            <template v-else>
              <dl class="v2d-rows">
                <dt>{{ V.kind }}</dt><dd><span class="v3d-swatch" :style="{ background: lineInfo.typeColour }"></span> {{ lineInfo.type }}</dd>
                <dt>{{ V.filament }}</dt><dd><spool-icon :colour="lineInfo.colour" :size="14"/> {{ lineInfo.filament }}</dd>
                <dt>{{ V.size }}</dt><dd>{{ num(lineInfo.width, 2) }} × {{ num(lineInfo.height, 2) }} mm · {{ num(lineInfo.length, 2) }} mm</dd>
                <dt>{{ V.modes.speed }}</dt><dd>{{ num(lineInfo.speed) }} mm/s</dd>
                <dt>{{ V.modes.flow }}</dt><dd>{{ num(lineInfo.flow, 1) }} mm³/s</dd>
                <dt>{{ V.modes.accel }}</dt><dd>{{ lineInfo.accel ? num(lineInfo.accel) + ' mm/s²' : '–' }}</dd>
                <dt>{{ V.modes.fan }}</dt><dd>{{ num(lineInfo.fan) }} %</dd>
                <dt>{{ V.nozzle }}</dt><dd>{{ lineInfo.temp ? num(lineInfo.temp) + ' °C' : '–' }}</dd>
                <dt>{{ V.where }}</dt><dd>X {{ num(lineInfo.from[0], 2) }} Y {{ num(lineInfo.from[1], 2) }} → X {{ num(lineInfo.to[0], 2) }} Y {{ num(lineInfo.to[1], 2) }}, Z {{ num(lineInfo.z, 2) }}</dd>
              </dl>
              <p v-if="gcode === 'error'" class="v2d-muted v2d-hint">{{ V.gcodeError }}</p>
              <ol v-else-if="gcode" class="v2d-gcode" :aria-label="V.gcode">
                <li v-for="r in gcode" :key="r.no" :class="{ 'is-here': r.here }"><span class="no">{{ num(r.no) }}</span><span>{{ r.text }}</span></li>
              </ol>
            </template>
            <p class="v2d-muted v2d-hint">{{ V.keys }}</p>
          </section>

          <section class="v2d-card">
            <h2>{{ V.fileTitle }}</h2>
            <dl class="v2d-rows">
              <template v-if="fileInfo.slicer"><dt>{{ V.slicer }}</dt><dd>{{ fileInfo.slicer }}</dd></template>
              <template v-if="fileInfo.time"><dt>{{ V.printTime }}</dt><dd>{{ fileInfo.time }}</dd></template>
              <template v-if="fileInfo.printer"><dt>{{ V.printer }}</dt><dd>{{ fileInfo.printer }}</dd></template>
              <template v-if="fileInfo.process"><dt>{{ V.process }}</dt><dd>{{ fileInfo.process }}</dd></template>
              <template v-if="fileInfo.layerHeight"><dt>{{ V.layerHeight }}</dt><dd>{{ fileInfo.layerHeight }}</dd></template>
              <template v-if="fileInfo.nozzle"><dt>{{ V.nozzle }}</dt><dd>{{ fileInfo.nozzle }}</dd></template>
              <template v-if="fileInfo.bed"><dt>{{ V.bed }}</dt><dd>{{ fileInfo.bed }}</dd></template>
              <template v-if="fileInfo.infill"><dt>{{ V.infill }}</dt><dd>{{ fileInfo.infill }}</dd></template>
              <template v-if="fileInfo.walls"><dt>{{ V.walls }}</dt><dd>{{ fileInfo.walls }}</dd></template>
              <template v-if="fileInfo.support"><dt>{{ V.support }}</dt><dd>{{ fileInfo.support }}</dd></template>
              <template v-if="fileInfo.tower"><dt>{{ V.tower }}</dt><dd>{{ fileInfo.tower }}</dd></template>
              <template v-if="fileInfo.changes"><dt>{{ V.changes }}</dt><dd>{{ fileInfo.changes }}</dd></template>
              <template v-if="fileInfo.total"><dt>{{ V.total }}</dt><dd>{{ fileInfo.total }}</dd></template>
              <dt>{{ V.content }}</dt><dd>{{ fileInfo.counts }}</dd>
            </dl>
            <ul class="v2d-filaments">
              <li v-for="f in fileInfo.filaments" :key="f.tool"><spool-icon :colour="f.colour" :size="22"/>
                <span><strong>T{{ f.tool }} · {{ f.name }}</strong><small class="v2d-muted">{{ f.text }}</small></span></li>
            </ul>
          </section>

          <details v-if="settingsCount" class="v2d-card v2d-settings" @toggle="settingsOpen = $event.target.open">
            <summary>{{ V.settings(num(settingsCount)) }}</summary>
            <input v-model="filter" class="input" type="search" :placeholder="V.search" :aria-label="V.search">
            <dl class="v2d-settings-list">
              <div v-for="[k, v] in settingsList" :key="k"><dt>{{ k }}</dt><dd :title="v">{{ v }}</dd></div>
            </dl>
            <p v-if="!settingsList.length" class="v2d-muted v2d-hint">{{ V.nothingFound }}</p>
          </details>
        </aside>
      </div>
    </div>
  `,
};
