// Shared by the pages "3D-Ansicht" and "2D-Ansicht": which print file they show (one of the printer
// in the top bar, or one from this computer), reading it with the worker (pages/gcode-worker.js),
// and the printer's job, which they follow while it prints that file. The last file read stays
// while OrcaOne is open, for both pages: going from one to the other, it shows at once.
import { ui, fmtSize } from "../common.js";
import { T } from "../texts.js";
import { api } from "../api.js";

const { ref, shallowRef, computed, onMounted, onUnmounted } = Vue;
const V = T.view3d;          // texts of the file choice, shared by both pages
const FOLLOW_EVERY = 3000;   // ms between two looks at the printer

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

// onShow(data): the page draws the file just read (or taken from the cache).
export function usePrintFile(onShow) {
  const files = ref([]);          // print files of the printer, newest first
  const host = ref(null);         // null while OrcaOne looks it up, "" without an address
  const job = ref(null);          // what the printer is doing (monitor.read)
  const choice = ref("");         // "printer:<path>" or "local:<name>"
  const localSize = ref(0);       // bytes of the file from this computer
  const loading = ref(null);      // { loaded, total } while reading
  const error = ref("");
  const data = shallowRef(null);  // the worker's result
  const follow = ref(true);       // follow the print if the file shown is printed
  const dragging = ref(false);
  let source = null;              // { url } or { file }: where the file shown comes from
  const errorText = (code) => V.errors[code] || T.errors[code] || T.errors.unknown;
  // A print file of the list by its path in "gcodes": the list gives files at the top by name only.
  const pathOf = (f) => f.path || f.name;

  const layers = computed(() => data.value?.layerStart.length || 0);
  const current = computed(() => (choice.value.startsWith("printer:") ? choice.value.slice(8) : ""));
  // Printed right now: the file shown is the printer's job.
  const printing = computed(() => !!current.value && job.value?.job.file === current.value
    && ["printing", "paused", "complete"].includes(job.value.job.state));
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
  const zOf = (k) => data.value?.layerZ[k - 1] ?? 0;

  // ------------------------------------------------------------ reading a file
  let worker = null;
  function read(src, key) {
    worker?.terminate();
    error.value = "";
    if (cache?.key === key) return show(cache);
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
  function choose(value) {
    choice.value = value;
    if (value.startsWith("printer:")) read({ url: api.printFileUrl(ui.printer, value.slice(8)) }, `${ui.printer}|${value}`);
  }
  function openLocal(file) {
    if (!file) return;
    choice.value = `local:${file.name}`;
    localSize.value = file.size;
    read({ file }, `local|${file.name}|${file.size}|${file.lastModified}`);
  }
  const onPick = (ev) => { openLocal(ev.target.files[0]); ev.target.value = ""; };
  const onDrop = (ev) => { dragging.value = false; openLocal(ev.dataTransfer.files[0]); };

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
  let timer = 0, looking = false;
  async function look() {
    if (document.hidden || !host.value || looking) return;
    looking = true;
    try {
      job.value = await api.printerMonitor(ui.printer);
    } catch {
      // Not reachable right now: the file stays, only the following pauses.
    } finally {
      looking = false;
    }
  }
  onMounted(async () => {
    try {
      host.value = (await api.printers()).printers[ui.printer]?.host || "";
    } catch {
      host.value = "";
    }
    if (host.value) {
      await look();
      try {
        files.value = (await api.printFiles(ui.printer)).files || [];
      } catch (err) {
        error.value = errorText(err.code);
      }
      timer = setInterval(look, FOLLOW_EVERY);
    }
    // What to show: the file "Dateien" opened here, else the one printed, else the newest.
    const asked = ui.viewFile;
    ui.viewFile = null;
    const printed = job.value && ["printing", "paused"].includes(job.value.job.state) ? job.value.job.file : "";
    const pick = asked || printed || (files.value[0] ? pathOf(files.value[0]) : "");
    // The file shown last, if it was a local one or one of this printer.
    if (cache && !asked && (cache.key.startsWith("local|") || cache.key.startsWith(`${ui.printer}|`))) {
      choice.value = cache.key.startsWith("local|") ? `local:${cache.key.split("|")[1]}` : cache.key.slice(ui.printer.length + 1);
      localSize.value = Number(cache.key.split("|")[2]) || 0;
      return show(cache);
    }
    if (pick) choose(`printer:${pick}`);
  });
  document.addEventListener("visibilitychange", look);
  onUnmounted(() => {
    clearInterval(timer);
    document.removeEventListener("visibilitychange", look);
    worker?.terminate();
  });

  const percent = computed(() => (loading.value?.total ? Math.round(loading.value.loaded / loading.value.total * 100) : null));
  const withSize = (name, size) => (size ? `${name} · ${fmtSize(size)}` : name);
  const fileName = computed(() => (choice.value.startsWith("local:") ? choice.value.slice(6) : current.value));

  return {
    files, host, job, choice, localSize, loading, error, data, follow, dragging, pathOf, layers, current, printing, printedCount,
    printedLayer, layerOf, zOf, percent, withSize, fileName, choose, onPick, onDrop, piece, errorText,
  };
}

// The file choice in the head of both pages; the names are those usePrintFile returns, V3 the texts.
export const FILE_PICKER = `
        <label v-if="host" class="v3d-field">{{ V3.file }}
          <select class="input" :value="choice" @change="choose($event.target.value)">
            <option v-if="choice.startsWith('local:')" :value="choice">{{ withSize(choice.slice(6), localSize) }}</option>
            <option v-if="!files.length && !choice" value="">{{ V3.noFiles }}</option>
            <option v-for="f in files" :key="pathOf(f)" :value="'printer:' + pathOf(f)">
              {{ job && job.job.file === pathOf(f) && ['printing', 'paused'].includes(job.job.state) ? V3.nowPrinting + ' · ' : '' }}{{ withSize(f.name, f.size) }}</option>
          </select>
        </label>
        <label class="btn v3d-open"><ui-icon name="folderOpen"/>{{ V3.openLocal }}
          <input type="file" accept=".gcode,.gco,.g" @change="onPick"></label>`;

// While reading, a failure, or nothing yet: the middle of the stage, alike on both pages.
export const STAGE_STATE = `
        <div v-if="loading" class="v3d-center">
          <p>{{ V3.reading }}<template v-if="percent != null"> {{ percent }} %</template></p>
          <span class="sys-bar v3d-bar"><span :style="{ width: (percent || 0) + '%' }"></span></span>
          <small v-if="loading.total">{{ fmtSize(loading.loaded) }} / {{ fmtSize(loading.total) }}</small>
        </div>
        <p v-else-if="error" class="v3d-center alert" role="alert">{{ error }}</p>
        <p v-else-if="!data" class="v3d-center note">{{ V3.dropHint }}</p>`;
