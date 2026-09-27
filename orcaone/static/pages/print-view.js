// Shared by the pages "3D Ansicht" and "2D Ansicht": they show the print file set in the top bar
// (ui.printFile, app.js; one of the printer there or one from this computer), read with the worker
// (pages/gcode-worker.js), and follow the printer's job while it prints that file. A file dropped
// on the page becomes the one set. The last file read stays while OrcaOne is open: going from one
// page to the other, it shows at once.
import { ui, localPrintFile, setLocalPrintFile } from "../common.js";
import { T } from "../texts.js";
import { api } from "../api.js";
import { useLive } from "../live.js";

const { ref, shallowRef, computed, watch, onMounted, onUnmounted } = Vue;
const V = T.view3d;          // texts of the file choice, shared by both pages

// Line types in the colours of the slicers' preview (PrusaSlicer's defaults, which OrcaSlicer kept;
// OrcaSlicer's own table lives in libvgcode, which slicer-src lacks: not checked one by one).
export const TYPE_COLOURS = {
  "Inner wall": "#FFE64D", "Outer wall": "#FF7D38", "Overhang wall": "#1F1FFF", "Sparse infill": "#B03029",
  "Internal solid infill": "#9654CC", "Top surface": "#F04040", "Bottom surface": "#7359D9", "Ironing": "#FF8C69",
  "Bridge": "#4D80BA", "Internal Bridge": "#4D80BA", "Gap infill": "#FFFFFF", "Skirt": "#00876E", "Brim": "#00876E",
  "Support": "#00FF00", "Support interface": "#008000", "Support transition": "#008000", "Prime tower": "#B3E3AB",
  "Custom": "#5ED194", "Other": "#9A9A9A",
};
// Filaments without a colour in the file.
export const TOOL_COLOURS = ["#009688", "#F4C032", "#E72F1D", "#4D80BA", "#9654CC", "#FF7D38", "#5ED194", "#E2DEDB"];
export const toolColour = (d, i) => (/^#[0-9a-f]{6}$/i.test(d.colours[i] || "") ? d.colours[i] : TOOL_COLOURS[i % TOOL_COLOURS.length]);
export const typeColour = (name) => TYPE_COLOURS[name] || TYPE_COLOURS.Other;

// The head printing now, from the printer's answer (monitor.read, toolhead.extruder): its number
// from 0, the colour of its spool (U1) or else of its filament in the file, and whether the printer
// has several heads, so its number is worth showing (the user's wish of 24.09.2026).
export function activeHead(job, d) {
  const name = job?.job.active || "extruder";
  const index = name === "extruder" ? 0 : Number(name.slice(8)) || 0;
  const heads = job?.heads || [];
  return { index, colour: heads[index]?.spool?.colour || (d ? toolColour(d, index) : TOOL_COLOURS[0]), many: heads.length > 1 };
}
// Whether dark writing reads better on the colour than white.
export function isLight(hex) {
  const v = parseInt(String(hex).slice(1), 16);
  return ((v >> 16 & 255) * 0.299 + (v >> 8 & 255) * 0.587 + (v & 255) * 0.114) / 255 > 0.6;
}

// The bed from above in mm, [x0, y0, x1, y1]: the printer's if it has an address (the area of its
// bed mesh, as on "Status"), else around the model, on 10 mm.
export function bedArea(d, m) {
  const [lo, hi] = m?.mesh || [];
  if (lo?.length === 2 && hi?.length === 2 && hi[0] > lo[0]) {
    const x0 = m.min[0], y0 = m.min[1];
    return [x0, y0, Math.min(m.max[0], hi[0] + lo[0] - x0), Math.min(m.max[1], hi[1] + lo[1] - y0)];
  }
  if (!d?.bounds) return null;
  const b = d.bounds, pad = 10;
  return [Math.floor((b.minX - pad) / 10) * 10, Math.floor((b.minY - pad) / 10) * 10,
          Math.ceil((b.maxX + pad) / 10) * 10, Math.ceil((b.maxY + pad) / 10) * 10];
}

let cache = null;  // { key, data, source }

// onShow(data): the page draws the file just read (or taken from the cache). whilePrinting: read the
// file only while the printer prints it (page "Status": the path under the head, no file read for nothing).
export function usePrintFile(onShow, { whilePrinting = false } = {}) {
  const host = ref(null);         // null while OrcaOne looks it up, "" without an address
  // What the printer is doing (monitor.read), live: at most four times a second while it moves (live.js).
  const printer = useLive(() => ui.printer);
  const job = computed(() => printer.value?.data?.monitor || null);
  const loading = ref(null);      // { loaded, total } while reading
  const error = ref("");
  const data = shallowRef(null);  // the worker's result
  const follow = ref(true);       // follow the print if the file shown is printed
  const dragging = ref(false);
  let source = null;              // { url } or { file }: where the file shown comes from
  const errorText = (code) => V.errors[code] || T.errors[code] || T.errors.unknown;

  const layers = computed(() => data.value?.layerStart.length || 0);
  // The file on the printer shown; "" for one from this computer.
  const current = computed(() => (ui.printFile?.model && ui.printFile.model === ui.printer ? ui.printFile.path : ""));
  // Printed right now: the file shown is the printer's job.
  const printing = computed(() => !!current.value && job.value?.job.file === current.value
    && ["printing", "paused", "complete"].includes(job.value.job.state));
  const wanted = computed(() => !whilePrinting || (printing.value && job.value.job.state !== "complete"));
  const printedCount = computed(() => {
    const d = data.value, pos = job.value?.job.file_position;
    if (!d || !printing.value) return d?.count || 0;
    if (job.value.job.state === "complete" || pos == null) return d.count;
    let lo = 0, hi = d.count;  // the first segment at or behind the position
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (d.offset[mid] < pos) lo = mid + 1; else hi = mid;
    }
    return lo;
  });
  const layerOf = (segment) => {
    const s = data.value.layerStart;
    let lo = 0, hi = s.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (s[mid] <= segment) lo = mid + 1; else hi = mid;
    }
    return Math.max(1, lo);
  };
  const printedLayer = computed(() => (data.value && printing.value ? layerOf(Math.max(0, printedCount.value - 1)) : 0));
  // While the file shown prints and the page follows it, the layer and line sliders show the print and
  // cannot be moved (the user's wish of 27.09.2026); "Druck folgen" off frees them.
  const locked = computed(() => follow.value && printing.value && ["printing", "paused"].includes(job.value.job.state));
  const zOf = (k) => data.value?.layerZ[k - 1] ?? 0;

  // ------------------------------------------------------------ reading a file
  let worker = null;
  function read(src, key) {
    worker?.terminate();
    error.value = "";
    if (cache?.key === key) return show(cache);
    ui.viewLayer = null;  // another file: its own layers
    data.value = null;
    loading.value = { loaded: 0, total: 0 };
    worker = new Worker(new URL("./gcode-worker.js", import.meta.url), { type: "module" });
    worker.onmessage = ({ data: m }) => {
      if (m.type === "progress") loading.value = { loaded: m.loaded, total: m.total };
      else if (m.type === "error") {
        loading.value = null;
        error.value = errorText(m.code);
        worker.terminate();
      } else if (m.type === "done") {
        loading.value = null;
        worker.terminate();
        if (!m.count) {
          error.value = V.noMoves;
          return;
        }
        cache = { key, data: m, source: src };
        show(cache);
      }
    };
    worker.postMessage(src);
  }
  function show(c) {
    source = c.source;
    data.value = c.data;
    onShow(c.data);
  }
  // What ui.printFile names: a file of the printer through OrcaOne, or the one from this computer.
  function open(f) {
    if (f?.local) {
      const file = localPrintFile();
      if (file) read({ file }, `local|${f.local}|${f.size}|${f.stamp}`);
    } else if (f?.model && f.model === ui.printer) {
      read({ url: api.printFileUrl(f.model, f.path) }, `${f.model}|${f.path}`);
    }
  }
  watch(() => ui.printFile, (f) => wanted.value && open(f));
  watch(wanted, (w) => w && open(ui.printFile));
  const onDrop = (ev) => {
    dragging.value = false;
    const file = ev.dataTransfer.files[0];
    if (file) setLocalPrintFile(file);
  };

  // A piece of the file shown, bytes from … to (not included): the G-code around one line. The
  // printer's file through OrcaOne as a Range request, which Moonraker answers with just that.
  async function piece(from, to) {
    if (source.file) return new Uint8Array(await source.file.slice(from, to).arrayBuffer());
    const res = await fetch(source.url, { headers: { Range: `bytes=${from}-${to - 1}` } });
    if (res.status !== 206) {
      res.body?.cancel();  // not the whole file for a few lines
      throw new Error(`HTTP ${res.status}`);
    }
    return new Uint8Array(await res.arrayBuffer());
  }

  // ------------------------------------------------------------ the printer
  // Its address only for the note without one; the values come live (job above).
  onMounted(async () => {
    if (wanted.value) open(ui.printFile);
    try {
      host.value = (await api.printers()).printers[ui.printer]?.host || "";
    } catch {
      host.value = "";
    }
  });
  onUnmounted(() => worker?.terminate());

  const percent = computed(() => (loading.value?.total ? Math.round(loading.value.loaded / loading.value.total * 100) : null));
  const fileName = computed(() => ui.printFile?.local || current.value);

  return {
    host, job, loading, error, data, follow, dragging, layers, current, printing, printedCount,
    printedLayer, locked, layerOf, zOf, percent, fileName, onDrop, piece, errorText,
  };
}

// While reading, a failure, or nothing yet: the middle of the stage, alike on both pages.
export const STAGE_STATE = `
        <div v-if="loading" class="v3d-center">
          <p>{{ V3.reading }}<template v-if="percent != null"> {{ percent }} %</template></p>
          <span class="sys-bar v3d-bar"><span :style="{ width: (percent || 0) + '%' }"></span></span>
          <small v-if="loading.total">{{ fmtSize(loading.loaded) }} / {{ fmtSize(loading.total) }}</small>
        </div>
        <p v-else-if="error" class="v3d-center alert" role="alert">{{ error }}</p>
        <p v-else-if="!data" class="v3d-center note">{{ V3.dropHint }}</p>`;
