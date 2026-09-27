// Page "Dateien": the files on the Klipper printer of the top bar (orcaone/printer_files.py, the
// user's wish of 24.09.2026; since 26.09.2026 on every Klipper printer with an address). A file
// manager as people know it from their computer (the user's wish of 27.09.2026: the folder button
// with its tree "fühlt sich nicht nach Dateimanager an"): Moonraker's three or four shares as tabs
// (a tree or a sidebar for so few wasted room, the user), the way in a share as a path, the entries
// as a table sorted by a click on a column, picked with a click, Ctrl and Shift, opened with a
// double click, the rest on a right click and as icons with a tooltip (grey buttons looked
// overloaded, the user). What is picked shows in the side panel "Info", the same panel as "Drucken"
// and never beside it (one panel on the right, the user); a button shows and hides it, kept in
// data/settings.json. In "Druckdateien" files dropped from the computer are
// uploaded, entries dragged onto a folder, the path or "Eine Ebene höher" are moved. Pictures,
// videos and files come through OrcaOne: the browser never talks to the printer itself.
import { flash, go, hashOf, fmtSize, whenText, dayLabel, clockText, ui, isU1Printer, LOCALE } from "../common.js";
import { T, SETTINGS } from "../texts.js";
import { api } from "../api.js";
import { useLive } from "../live.js";
import PrintPanel, { BUSY, duration } from "./print-panel.js";
import FolderTree from "./folder-tree.js";

const { ref, reactive, computed, onMounted, onUnmounted, nextTick } = Vue;
const D = T.files;
const DRAG_TYPE = "application/x-orcaone-paths";
const ZOOM_DELAY = 1000;  // ms resting on a preview until it shows large
const HERE = "\0here";   // dropOn for the list itself: no path can be it
const DISK_FULL = 0.9;   // share of the disk used from which "fast voll" shows
const PAGE_ROWS = 10;    // rows Page Up and Page Down move
const ICON = { gcodes: "file", camera: "camera", logs: "log", config: "gear" };
// Below this width the info pane is a drawer over the table, opened only when asked for.
const NARROW = matchMedia("(max-width: 900px)");
const parentOf = (p) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");
// The date in its column: today and yesterday with the time, else the day; all of it in the tooltip.
function shortWhen(seconds) {
  if (!seconds) return "";
  const d = new Date(seconds * 1000), day = dayLabel(d);
  return day === T.today || day === T.yesterday ? `${day}, ${clockText(d)}`
    : d.toLocaleDateString(LOCALE, { day: "2-digit", month: "2-digit", year: "numeric" });
}

export default {
  name: "DateienPage",
  components: { PrintPanel, FolderTree },
  props: { instId: { type: String, default: null } },  // the page does not depend on an installation

  setup(props) {
    const model = computed(() => ui.printer || "");
    const u1 = computed(() => isU1Printer(ui.printer));
    const cameraId = ref(null);   // the U1's camera id for the print panel with the display's options
    const folder = ref("gcodes");
    const path = ref("");         // the folder shown in the share, "" for its top
    const folders = ref([]);      // the shares: [{ name, delete }]
    const files = ref(null);      // null while loading
    const dirs = ref([]);
    const disk = ref(null);
    const listError = ref("");
    const picked = reactive(new Set());   // the keys of the rows picked
    const cursor = ref(null);     // the row the arrow keys are on
    let anchor = null;            // the row Shift extends the choice from
    let touch = false;            // the last pointer was a finger: a tap opens a folder, as on a phone
    const asking = ref(false);    // the question to delete what is picked
    const deleting = ref(false);
    const printing = ref(null);   // the file in the print panel (print-panel.js)
    const newDir = ref(null);     // the name typed for a new folder, null while its row is closed
    const moveOpen = ref(false);  // the tree to choose where the picked go
    const moveTarget = ref(null); // the folder chosen there, moved only on the button's click
    const menu = ref(null);       // the context menu: { x, y, items }
    const infoOpen = ref(SETTINGS.files_info !== false && !NARROW.matches);
    const infoShown = computed(() => infoOpen.value && !printing.value);   // one panel on the right
    const sort = reactive(SETTINGS.files_sort ? { ...SETTINGS.files_sort } : { key: "modified", desc: true });
    const uploads = ref([]);      // [{ id, model, file, target, sent, state: wait|run|done|ask|fail|skip, error }]
    const dropOn = ref(null);     // the folder a drag hovers: its path, "" for the top, HERE for the list
    let dragging = null;          // the paths dragged within the page
    let uploading = false;
    let reading = 0;              // the latest readFolder: an older answer arriving later is dropped
    const leaving = new AbortController();   // stops a running upload when the page goes
    // The time-lapse playing, in the page over everything like a camera on "Kamera". Not in a tab of
    // its own: the API's answers are sandboxed (app.py), and there the browser refuses the video.
    const watching = ref(null);
    const player = ref(null);
    let opener = null;
    const grid = ref(null), moveBox = ref(null), menuBox = ref(null), fileInput = ref(null);

    const live = useLive(() => ui.printer);
    const job = computed(() => live.value?.data?.monitor?.job || null);
    const busy = computed(() => BUSY.includes(job.value?.state));
    // The file Klipper prints or holds paused: it and the folders around it stay where they are.
    const printingPath = computed(() => (busy.value && job.value?.file) || null);
    const inUse = (p) => !!printingPath.value && (printingPath.value === p || printingPath.value.startsWith(p + "/"));
    const locked = (p) => folder.value === "gcodes" && inUse(p);
    const printTag = computed(() => D.printTag(job.value?.state));

    const errorText = (err) => [D.errors[err.code] || T.errors[err.code] || T.errors.unknown, err.data?.detail].filter(Boolean).join(" ");
    const detailText = (detail) => D.errors[detail] || detail;
    const current = computed(() => folders.value.find((f) => f.name === folder.value) || null);
    const writable = computed(() => folder.value === "gcodes" && !!current.value?.delete);
    const pickable = computed(() => !!current.value?.delete);   // what is in it can be deleted
    const videos = computed(() => folder.value === "camera");
    const keyOf = (f) => (videos.value ? f.id : f.path || f.name);
    const dirKey = (d) => "dir:" + d.path;
    const pathOf = (f) => f.path || f.name;
    const parts = computed(() => (path.value ? path.value.split("/") : []));
    const here = computed(() => (parts.value.length ? parts.value[parts.value.length - 1] : D.folders[folder.value]));
    // The path at the top: the share and each folder on the way, each a place to go to and to drop on.
    const crumbs = computed(() => [{ name: D.folders[folder.value], path: "" },
                                   ...parts.value.map((name, i) => ({ name, path: parts.value.slice(0, i + 1).join("/") }))]);
    const hereFull = computed(() => crumbs.value.map((c) => c.name).join(" › "));
    const known = computed(() => (folder.value === "gcodes" && files.value ? { path: path.value, dirs: dirs.value } : null));
    const diskShare = computed(() => (disk.value?.total ? Math.min(1, disk.value.used / disk.value.total) : 0));
    const diskFull = computed(() => diskShare.value >= DISK_FULL);
    // A print file becomes the one "2D Ansicht" and "3D Ansicht" show, the one in the top bar (the
    // user's wish of 24.09.2026). Not while the printer prints another one (app.js fileLocked).
    const viewable = (f) => folder.value === "gcodes" && /\.gcode$/i.test(pathOf(f));
    function setFile(f) {
      if (ui.fileLocked && ui.printFile?.path !== pathOf(f)) {
        flash(T.fileMenu.locked);
        return false;
      }
      ui.printFile = { model: ui.printer, path: pathOf(f) };
      return true;
    }
    const isSet = (f) => viewable(f) && ui.printFile?.model === ui.printer && ui.printFile.path === pathOf(f);
    function openView(f, page) {
      if (setFile(f)) go(null, hashOf(page, props.instId));
    }
    function play(f) {
      opener = document.activeElement;
      watching.value = f;
      nextTick(() => player.value?.focus());
    }
    function stopWatching() {
      watching.value = null;
      opener?.focus();
    }
    // A log on the page "Logs", as it is written there (the rules of that page).
    function openLog(f) {
      ui.logFocus = { printer: model.value, path: pathOf(f) };
      go(null, hashOf("druckerlogs", props.instId));
    }
    const fileUrl = (p, download = false) => api.printerFileUrl(model.value, folder.value, p, download);
    // OrcaOne answers with "attachment": the browser saves the file and stays on the page.
    function download(f) {
      const a = document.createElement("a");
      a.href = fileUrl(pathOf(f), true);
      a.click();
    }

    // ---- the table: folders first, by name; then the files as chosen, those without the value at the end
    const byName = (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
    const sortKey = computed(() => (sort.key === "time" && folder.value !== "gcodes" ? "modified" : sort.key));
    const sortedDirs = computed(() => [...dirs.value].sort((a, b) => {
      if (sortKey.value === "modified") return ((a.modified || 0) - (b.modified || 0)) * (sort.desc ? -1 : 1) || byName(a, b);
      return byName(a, b) * (sortKey.value === "name" && sort.desc ? -1 : 1);
    }));
    const sortedFiles = computed(() => [...(files.value || [])].sort((a, b) => {
      const key = sortKey.value;
      if (key === "name") return byName(a, b) * (sort.desc ? -1 : 1);
      const x = a[key], y = b[key];
      if (x == null || y == null) return x == null ? (y == null ? byName(a, b) : 1) : -1;
      return (x - y) * (sort.desc ? -1 : 1) || byName(a, b);
    }));
    function sortBy(key) {
      if (sortKey.value === key) sort.desc = !sort.desc;
      else Object.assign(sort, { key, desc: key !== "name" });
      SETTINGS.files_sort = { ...sort };
      api.setFilesSort({ ...sort }).catch(() => {});
    }
    // The columns: the print time in "Druckdateien", the length of the time-lapses, else size and date.
    const timeCol = computed(() => (folder.value === "gcodes" ? "time" : videos.value ? "length" : null));
    const columns = computed(() => ["name", timeCol.value, "size", "modified"].filter(Boolean));
    const cols = computed(() => [pickable.value && "32px", "minmax(0, 1fr)", timeCol.value && "96px", "88px", "150px"].filter(Boolean).join(" "));
    const rows = computed(() => [
      ...sortedDirs.value.map((d) => ({ key: dirKey(d), dir: true, item: d, path: d.path, name: d.name })),
      ...sortedFiles.value.map((f) => ({ key: keyOf(f), dir: false, item: f, path: pathOf(f), name: f.name })),
    ]);
    const rowIndex = (key) => rows.value.findIndex((r) => r.key === key);
    const cursorId = computed(() => (rowIndex(cursor.value) < 0 ? null : "files-r" + rowIndex(cursor.value)));
    const timeText = (r) => (r.dir ? "" : timeCol.value === "time" ? (r.item.time ? duration(r.item.time) : "") : r.item.duration || "");
    const sizeText = (r) => (r.dir || r.item.size == null ? "" : fmtSize(r.item.size));
    // On a phone one line under the name instead of the columns.
    const factsOf = (r) => [timeCol.value && timeText(r), sizeText(r), shortWhen(r.item.modified)].filter(Boolean).join(" · ");

    // ---- picking: a click one, Ctrl one more, Shift all from the last one; the arrow keys the same
    const pickedRows = computed(() => rows.value.filter((r) => picked.has(r.key)));
    const one = computed(() => (pickedRows.value.length === 1 ? pickedRows.value[0] : null));
    const oneFile = computed(() => (one.value && !one.value.dir ? one.value : null));
    const printOne = computed(() => (folder.value === "gcodes" && oneFile.value?.item.printable ? oneFile.value.item : null));
    const pickedLocked = computed(() => pickedRows.value.some((r) => locked(r.path)));
    const pickedSize = computed(() => pickedRows.value.reduce((sum, r) => sum + (r.dir ? 0 : r.item.size || 0), 0));
    const filesSize = computed(() => (files.value || []).reduce((sum, f) => sum + (f.size || 0), 0));
    // "Alle auswählen" leaves out what is printing, so that the rest can still be moved or deleted.
    const free = computed(() => rows.value.filter((r) => !locked(r.path)));
    const allPicked = computed(() => !!free.value.length && free.value.every((r) => picked.has(r.key)));
    const countText = (nFiles, nDirs) => D.items(nFiles, nDirs, videos.value);
    const doneText = (k) => (videos.value ? D.things(k, true) : D.entries(k));
    function reveal(key) {
      nextTick(() => document.getElementById("files-r" + rowIndex(key))?.scrollIntoView({ block: "nearest" }));
    }
    function pickOnly(key) {
      picked.clear();
      picked.add(key);
      anchor = cursor.value = key;
      asking.value = false;
    }
    function pickRange(key) {
      const keys = rows.value.map((r) => r.key);
      if (!keys.includes(anchor)) anchor = keys.includes(cursor.value) ? cursor.value : key;
      const a = keys.indexOf(anchor), b = keys.indexOf(key);
      picked.clear();
      for (let i = Math.min(a, b); i <= Math.max(a, b); i++) picked.add(keys[i]);
      cursor.value = key;
      asking.value = false;
    }
    function toggle(key) {
      if (picked.has(key)) picked.delete(key);
      else picked.add(key);
      anchor = cursor.value = key;
      asking.value = false;
    }
    function pickAll(on) {
      picked.clear();
      if (on) for (const r of free.value) picked.add(r.key);
      asking.value = false;
    }
    const pointer = (ev) => { touch = ev.pointerType !== "mouse"; };
    function rowClick(ev, r) {
      if (ev.shiftKey) pickRange(r.key);
      else if (ev.ctrlKey || ev.metaKey) toggle(r.key);
      else if (touch && r.dir) openDir(r.path);
      else pickOnly(r.key);
    }
    function openRow(r) {
      if (r.dir) return openDir(r.path);
      const f = r.item;
      if (videos.value) play(f);
      else if (folder.value === "logs") openLog(f);
      else if (viewable(f)) openView(f, "druck3d");
      else if (folder.value === "gcodes") download(f);
      else window.open(fileUrl(pathOf(f)), "_blank", "noopener");
    }
    function gridKey(ev) {
      const field = ev.target !== grid.value;   // a box or button in a row does its own Enter and Space
      if (ev.target.tagName === "INPUT" && ev.target.type !== "checkbox") return;
      const keys = rows.value.map((r) => r.key);
      const i = keys.indexOf(cursor.value);
      const to = { ArrowDown: i + 1, ArrowUp: i < 0 ? keys.length - 1 : i - 1, Home: 0, End: keys.length - 1,
                   PageDown: i + PAGE_ROWS, PageUp: i - PAGE_ROWS }[ev.key];
      if (to != null && keys.length && !ev.altKey) {
        ev.preventDefault();
        const key = keys[Math.max(0, Math.min(keys.length - 1, to))];
        if (ev.shiftKey) pickRange(key);
        else if (ev.ctrlKey || ev.metaKey) cursor.value = key;   // on without picking, Space picks
        else pickOnly(key);
        return reveal(key);
      }
      const r = rows.value[i];
      if (ev.key === "Enter" && r && !field) {
        ev.preventDefault();
        openRow(r);
      } else if (ev.key === " " && r && !field) {
        ev.preventDefault();
        toggle(r.key);
      } else if ((ev.key === "Backspace" || (ev.key === "ArrowUp" && ev.altKey)) && path.value) {
        ev.preventDefault();
        openDir(parentOf(path.value));
      } else if (ev.key === "Delete" && picked.size && pickable.value && !deleting.value) {
        ev.preventDefault();
        if (pickedLocked.value) flash(D.inUseWhy);
        else asking.value = true;
      } else if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "a") {
        ev.preventDefault();
        pickAll(true);
      } else if (ev.key === "Escape" && picked.size && !menu.value && !moveOpen.value) {
        pickAll(false);
      }
    }

    // ---- what goes for the rows picked: the context menu lists it, the info pane shows it as icons
    const actions = computed(() => {
      const list = pickedRows.value, out = [];
      if (!list.length) return out;
      const r = list.length === 1 ? list[0] : null, f = r?.item;
      const why = pickedLocked.value ? D.inUseWhy : "";
      if (r?.dir) out.push({ id: "open", icon: "folderOpen", label: D.openDir, run: () => openDir(r.path) });
      if (r && !r.dir) {
        if (folder.value === "gcodes" && f.printable) {
          out.push({ id: "print", icon: "play", label: D.print, main: true, off: busy.value || !printReady.value,
                     why: busy.value ? D.busy(job.value.state) : "", run: () => openPrint(f) });
        }
        if (viewable(f)) {
          // While the printer prints another file, its file stays the one of 2D and 3D (app.js fileLocked).
          const held = ui.fileLocked && ui.printFile?.path !== pathOf(f) ? T.fileMenu.locked : "";
          out.push({ id: "3d", icon: "cube", label: D.view3d, off: !!held, why: held, run: () => openView(f, "druck3d") },
                   { id: "2d", icon: "toolpath", label: D.view2d, off: !!held, why: held, run: () => openView(f, "druck2d") });
          if (!isSet(f)) out.push({ id: "set", icon: "checkCircle", label: D.setFile, off: !!held, why: held, run: () => setFile(f) });
        }
        if (videos.value) out.push({ id: "play", icon: "play", label: D.play, main: true, run: () => play(f) });
        else if (folder.value === "logs") out.push({ id: "log", icon: "log", label: D.openLog, run: () => openLog(f) });
        else if (folder.value !== "gcodes") out.push({ id: "tab", icon: "window", label: D.openTab, run: () => window.open(fileUrl(pathOf(f)), "_blank", "noopener") });
        out.push({ id: "download", icon: "download", label: D.download, run: () => download(f) });
      }
      if (writable.value) out.push({ id: "move", icon: "folderMove", label: D.moveTo, off: !!why, why, run: openMove });
      if (pickable.value) out.push({ id: "delete", icon: "trash", label: D.delete, danger: true, off: !!why || deleting.value, why, run: () => { asking.value = true; } });
      if (!infoShown.value) out.push({ id: "info", icon: "info", label: D.showInfo, run: toggleInfo });
      return out;
    });
    // A right click beside the rows: what goes for the folder shown.
    const folderActions = computed(() => [
      ...(writable.value ? [{ id: "new", icon: "folderPlus", label: D.newDirIn(here.value), run: () => { newDir.value = ""; } },
                            { id: "upload", icon: "export", label: D.uploadTo(here.value), run: () => fileInput.value?.click() }] : []),
      ...(rows.value.length ? [{ id: "all", icon: "check", label: D.pickAll, run: () => pickAll(true) }] : []),
      { id: "reload", icon: "refresh", label: D.reload, run: readFolder },
    ]);
    function openMenu(ev) {
      if (ev.target.matches?.("input:not([type=checkbox])")) return;   // the browser's own, to paste a name
      const row = ev.target.closest?.("[data-key]");
      const r = row ? rows.value[rowIndex(row.dataset.key)] : null;
      const keyboard = ev.target === grid.value;   // the menu key or Shift+F10
      if (r && !picked.has(r.key)) pickOnly(r.key);
      const own = r || (keyboard && picked.size) ? actions.value : [];
      const items = own.length ? own : folderActions.value;
      ev.preventDefault();
      let x = ev.clientX, y = ev.clientY;
      if (keyboard) {
        const box = (document.getElementById(cursorId.value) || grid.value).getBoundingClientRect();
        x = box.left + 48;
        y = Math.min(box.bottom, innerHeight - 8);
      }
      moveOpen.value = false;
      menu.value = { x, y, items };
      // Inside the window, above the pointer when there is no room below it.
      nextTick(() => {
        const box = menuBox.value;
        if (!box || !menu.value) return;
        const size = box.getBoundingClientRect();
        menu.value.x = Math.max(8, Math.min(x, innerWidth - size.width - 8));
        menu.value.y = Math.max(8, y + size.height > innerHeight - 8 ? y - size.height : y);
        box.querySelector("button:not(:disabled)")?.focus();
      });
    }
    function closeMenu(focus = true) {
      menu.value = null;
      if (focus) grid.value?.focus();
    }
    function runMenu(a) {
      closeMenu();
      a.run();
    }
    function menuKey(ev) {
      const items = [...menuBox.value.querySelectorAll("button:not(:disabled)")];
      const i = items.indexOf(document.activeElement);
      const to = { ArrowDown: i + 1, ArrowUp: i - 1 + items.length, Home: 0, End: items.length - 1 }[ev.key];
      if (to != null) {
        ev.preventDefault();
        items[to % items.length]?.focus();
      } else if (ev.key === "Tab") {
        closeMenu(false);
      }
    }
    // The info pane, the side panel as "Drucken" has it; the choice kept on a large screen, on a small one
    // the panel lies over the table. Asked for while the print panel is open, it takes its place.
    function toggleInfo() {
      if (printing.value) {
        printing.value = null;
        if (infoOpen.value) return;
      }
      infoOpen.value = !infoOpen.value;
      if (NARROW.matches) return;
      SETTINGS.files_info = infoOpen.value;
      api.setFilesInfo(infoOpen.value).catch(() => {});
    }
    const infoRows = computed(() => {
      const r = one.value;
      if (!r) return [];
      const f = r.item;
      const mm = (v) => (v != null ? `${Number(v).toLocaleString(LOCALE, { maximumFractionDigits: 2 })} mm` : null);
      const when = (s) => (s ? whenText(new Date(s * 1000)) : null);
      if (r.dir) return [[D.detail.path, r.path], [D.detail.modified, when(f.modified)]].filter(([, v]) => v);
      return [
        [D.detail.path, pathOf(f)],
        [D.detail.size, f.size != null ? fmtSize(f.size) : null],
        [D.detail.modified, when(f.modified)],
        [D.detail.printed, when(f.printed)],
        [D.detail.time, f.time ? duration(f.time) : null],
        [D.detail.duration, f.duration || null],
        [D.detail.layers, f.layers || null],
        [D.detail.layerHeight, mm(f.layer_height)],
        [D.detail.firstLayer, mm(f.first_layer_height)],
        [D.detail.height, mm(f.height)],
        [D.detail.nozzle, mm(f.nozzle)],
        [D.detail.filament, [f.filament_g ? D.grams(f.filament_g) : null, f.filament_mm ? D.meters(f.filament_mm / 1000) : null].filter(Boolean).join(" · ") || null],
        [D.detail.filamentName, f.filament_name || null],
        [D.detail.slicer, [f.slicer, f.slicer_version].filter(Boolean).join(" ") || null],
      ].filter(([, v]) => v != null && v !== "");
    });

    // ---- reading a folder
    // "logs" and "config" come as one flat list with paths: the folder shown taken out of it.
    function fromFlat(list) {
      const prefix = path.value ? path.value + "/" : "";
      const inHere = list.filter((f) => f.path.startsWith(prefix));
      const names = new Set(inHere.map((f) => f.path.slice(prefix.length).split("/")).filter((r) => r.length > 1 && !r[0].startsWith(".")).map((r) => r[0]));
      return {
        files: inHere.filter((f) => !f.path.slice(prefix.length).includes("/")).map((f) => ({ ...f, name: f.path.slice(prefix.length) })),
        dirs: [...names].map((name) => ({ name, path: prefix + name, modified: null })),
      };
    }
    async function readFolder() {
      const mine = ++reading;
      listError.value = "";
      try {
        const flat = folder.value === "logs" || folder.value === "config";
        const data = await api.printerFiles(model.value, folder.value, folder.value === "gcodes" ? path.value : "");
        if (mine !== reading) return;
        folders.value = data.folders;
        const got = flat ? fromFlat(data.files) : { files: data.files, dirs: data.dirs || [] };
        files.value = got.files;
        dirs.value = got.dirs;
        if (data.disk) disk.value = data.disk;
        // Whatever is gone meanwhile leaves the choice.
        const keys = new Set([...got.files.map(keyOf), ...got.dirs.map(dirKey)]);
        for (const k of [...picked]) if (!keys.has(k)) picked.delete(k);
        if (!keys.has(cursor.value)) cursor.value = null;
        // A folder of logs or config that is gone: its parent.
        if (flat && path.value && !got.files.length && !got.dirs.length && !data.files.some((f) => f.path.startsWith(path.value + "/"))) {
          show(folder.value, parentOf(path.value));
        }
      } catch (err) {
        if (mine !== reading) return;
        // Deleted meanwhile (on the display, in Mainsail): the folder above, with the reason.
        if (err.code === "folder_missing" && path.value) {
          flash(errorText(err));
          return show(folder.value, parentOf(path.value));
        }
        files.value = [];
        dirs.value = [];
        listError.value = errorText(err);
      }
    }
    // Remembered per printer while OrcaOne is open (ui.filesAt), for the next visit of the page. The
    // keys stay in the table, and going up the folder come from is picked, as a file manager does.
    function show(name, at = "", from = null) {
      const focused = !!grid.value?.contains(document.activeElement);
      folder.value = name;
      path.value = at;
      ui.filesAt[model.value] = { folder: name, path: at };
      files.value = null;
      dirs.value = [];
      picked.clear();
      cursor.value = anchor = null;
      asking.value = false;
      newDir.value = null;
      moveOpen.value = false;
      menu.value = null;
      readFolder().then(() => nextTick(() => {
        if (from && folder.value === name && path.value === at && rowIndex(from) >= 0) {
          pickOnly(from);
          reveal(from);
        }
        if (focused) grid.value?.focus();
      }));
    }
    const openDir = (p) => show(folder.value, p, path.value && p === parentOf(path.value) ? "dir:" + path.value : null);
    // Arrows, Home and End move between the shares, as a tab list does.
    function rootKey(ev) {
      const list = folders.value, i = list.findIndex((f) => f.name === folder.value);
      const at = { ArrowRight: i + 1, ArrowLeft: i - 1 + list.length, Home: 0, End: list.length - 1 }[ev.key];
      if (at == null || ev.altKey || ev.ctrlKey || ev.metaKey) return;
      ev.preventDefault();
      show(list[at % list.length].name);
      nextTick(() => document.getElementById(`files-root-${folder.value}`)?.focus());
    }
    // A click beside an open menu closes it.
    function outside(ev) {
      if (menu.value && !menuBox.value?.contains(ev.target)) menu.value = null;
      if (moveOpen.value && !moveBox.value?.contains(ev.target)) moveOpen.value = false;
    }
    const onKey = (ev) => {
      if (ev.key !== "Escape") return;
      if (watching.value) stopWatching();
      else if (menu.value) closeMenu();
      else moveOpen.value = false;
    };
    const onResize = () => { menu.value = null; };
    onMounted(() => {
      document.addEventListener("keydown", onKey);
      document.addEventListener("pointerdown", outside);
      addEventListener("resize", onResize);
    });
    onUnmounted(() => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", outside);
      removeEventListener("resize", onResize);
    });

    // ---- deleting, a new folder, moving
    const askText = computed(() => {
      const list = pickedRows.value, nDirs = list.filter((r) => r.dir).length;
      if (list.length === 1) return nDirs ? D.askDir(list[0].name) : D.askOne(list[0].name);
      const text = countText(list.length - nDirs, nDirs);
      return allPicked.value ? D.askAll(text) : D.askPicked(text);
    });
    // One by one on the printer, so one that fails (the file being printed) leaves the rest done.
    async function remove() {
      const list = pickedRows.value.filter((r) => !locked(r.path));
      asking.value = false;
      deleting.value = true;
      try {
        const { deleted, failed } = await api.deletePrinterFiles(model.value, folder.value, list.filter((r) => !r.dir).map((r) => r.key),
                                                                 list.filter((r) => r.dir).map((r) => r.path));
        flash([deleted.length && D.deleted(doneText(deleted.length)),
               failed.length && D.notDeleted(doneText(failed.length), detailText(failed[0].detail))].filter(Boolean).join(" "));
        picked.clear();
      } catch (err) {
        flash(errorText(err));
      } finally {
        deleting.value = false;
        readFolder();
      }
    }
    async function makeDir() {
      const name = (newDir.value || "").trim();
      if (!name) return;
      try {
        await api.makePrinterFolder(model.value, path.value, name);
        newDir.value = null;
        flash(D.made(name));
        readFolder();
      } catch (err) {
        flash(errorText(err));
      }
    }
    async function move(paths, target) {
      paths = paths.filter((p) => p !== target && parentOf(p) !== target);
      moveOpen.value = false;
      moveTarget.value = null;
      if (!paths.length) return;
      try {
        const { moved, failed } = await api.movePrinterFiles(model.value, paths, target);
        // The print file moved along, itself or in its folder: the top bar, 2D and 3D follow it (review 27.09.2026).
        const chosen = ui.printFile?.model === ui.printer ? ui.printFile.path : null;
        const from = chosen && moved.find((p) => chosen === p || chosen.startsWith(p + "/"));
        if (from) ui.printFile = { model: ui.printer, path: (target ? target + "/" : "") + from.split("/").pop() + chosen.slice(from.length) };
        const where = target ? target.split("/").pop() : D.folders.gcodes;
        flash([moved.length && D.moved(D.entries(moved.length), where),
               failed.length && D.notMoved(D.entries(failed.length), detailText(failed[0].detail))].filter(Boolean).join(" "));
        picked.clear();
      } catch (err) {
        flash(errorText(err));
      } finally {
        readFolder();
      }
    }
    const pickedPaths = () => pickedRows.value.filter((r) => !locked(r.path)).map((r) => r.path);
    // "Verschieben nach …": the tree of "Druckdateien" chooses, the button moves (review 27.09.2026).
    function openMove() {
      moveOpen.value = true;
      moveTarget.value = null;
      menu.value = null;
    }
    const toggleMove = () => (moveOpen.value ? (moveOpen.value = false) : openMove());
    const moveName = computed(() => (moveTarget.value === null ? "" : moveTarget.value ? moveTarget.value.split("/").pop() : D.folders.gcodes));

    // ---- uploads: one after the other, each with its progress; a file of the same name only after asking
    let nextId = 0;
    function addUploads(list, target) {
      for (const file of list) uploads.value.push({ id: ++nextId, model: model.value, file, target, sent: 0, state: "wait", error: "", replace: false });
      runUploads();
    }
    async function runUploads() {
      if (uploading) return;
      uploading = true;
      let item;
      while (!leaving.signal.aborted && (item = uploads.value.find((u) => u.state === "wait"))) {
        item.state = "run";
        try {
          await api.uploadPrinterFile(item.model, item.target, item.file, item.replace, (sent) => { item.sent = sent; }, leaving.signal);
          item.state = "done";
          item.sent = item.file.size;
        } catch (err) {
          item.state = err.code === "name_taken" && !item.replace ? "ask" : "fail";
          item.error = errorText(err);
        }
        if (!leaving.signal.aborted && folder.value === "gcodes" && item.target === path.value) readFolder();
      }
      uploading = false;
      if (!leaving.signal.aborted) readFolder();
    }
    function answer(item, replace) {
      if (replace) Object.assign(item, { state: "wait", replace: true, error: "", sent: 0 });
      else item.state = "skip";
      runUploads();
    }
    const clearUploads = () => { uploads.value = uploads.value.filter((u) => ["wait", "run", "ask"].includes(u.state)); };
    const percent = (u) => (u.file.size ? Math.round((100 * u.sent) / u.file.size) : 100);
    function chosenFiles(ev) {
      addUploads([...ev.target.files], path.value);
      ev.target.value = "";
    }

    // ---- drag and drop: files from the computer anywhere onto the list or a folder, rows onto a folder
    const fromComputer = (ev) => [...(ev.dataTransfer?.types || [])].includes("Files");
    function dragStart(ev, r) {
      if (!writable.value || inUse(r.path)) return ev.preventDefault();
      hoverEnd();
      menu.value = null;
      dragging = picked.has(r.key) ? pickedPaths() : [r.path];
      ev.dataTransfer.setData(DRAG_TYPE, JSON.stringify(dragging));
      ev.dataTransfer.effectAllowed = "move";
    }
    function dragEnd() {
      dragging = null;
      dropOn.value = null;
    }
    // target: the folder's path, "" for the top, null for the folder shown (only files from the computer).
    function dragOver(ev, target) {
      if (!writable.value) return;
      const outside = fromComputer(ev);
      if (!outside && (target === null || target === path.value || !dragging
                       || dragging.some((p) => p === target || (target || "").startsWith(p + "/")))) return;
      ev.preventDefault();
      ev.stopPropagation();
      ev.dataTransfer.dropEffect = outside ? "copy" : "move";
      dropOn.value = target === null ? HERE : target;
    }
    // Files from the computer dropped anywhere else on the page: not opened by the browser, which
    // would leave OrcaOne and break off the uploads.
    function dropNowhere(ev) {
      if (!fromComputer(ev)) return;
      ev.preventDefault();
      if (ev.type === "dragover") ev.dataTransfer.dropEffect = "none";
    }
    function dragLeave(ev) {
      if (!ev.currentTarget.contains(ev.relatedTarget)) dropOn.value = null;
    }
    function drop(ev, target) {
      if (!writable.value) return;
      ev.preventDefault();
      ev.stopPropagation();
      dropOn.value = null;
      const into = target === null ? path.value : target;
      if (fromComputer(ev)) {
        // Folders from the computer come as items without a file; only files go up.
        const entries = [...(ev.dataTransfer.items || [])].filter((i) => i.kind === "file").map((i) => i.webkitGetAsEntry?.());
        const list = [...ev.dataTransfer.files].filter((f, i) => !entries[i]?.isDirectory);
        if (list.length < ev.dataTransfer.files.length) flash(D.noFolders);
        if (list.length) addUploads(list, into);
      } else if (dragging && target !== null) {
        move(dragging, into);
      }
      dragging = null;
    }

    // ---- printing (print-panel.js) and the picture large after resting on the small one (the user's
    // wish of 26.09.2026: to see more of it), gone when the pointer leaves it
    const openPrint = (f) => { printing.value = f; };
    const closePrint = () => { printing.value = null; };
    const zoomed = ref(null);
    let zoomTimer = 0;
    function hoverStart(f) {
      clearTimeout(zoomTimer);
      zoomTimer = setTimeout(() => { zoomed.value = f; }, ZOOM_DELAY);
    }
    function hoverEnd() {
      clearTimeout(zoomTimer);
      zoomed.value = null;
    }
    // On the U1 a print goes with the options of its display, so only once its camera id is known.
    const printReady = computed(() => !u1.value || !!cameraId.value);
    const printWhy = computed(() => (busy.value ? D.busy(job.value?.state) : !printOne.value ? D.printPick : ""));

    // First the folder shown last for this printer, else the one of the print file of the top bar, else the top.
    onMounted(async () => {
      if (!model.value) return;
      const f = ui.printFile?.model === model.value && !ui.printFile.local ? ui.printFile.path : "";
      const start = ui.filesAt[model.value] || { folder: "gcodes", path: parentOf(f || "") };
      show(start.folder, start.path);
      if (u1.value) {
        try {
          cameraId.value = (await api.cameras()).cameras.find((c) => c.printer === ui.printer)?.id || null;
        } catch {
          cameraId.value = null;
        }
      }
    });
    // Another printer or another page: uploads not started yet are dropped, the running one stops.
    onUnmounted(() => {
      leaving.abort();
      clearTimeout(zoomTimer);
    });

    return {
      T, D, ICON, HERE, model, cameraId, folder, path, folders, files, dirs, disk, diskShare, diskFull, listError, picked, cursor, cursorId, asking,
      deleting, printing, newDir, moveOpen, moveTarget, moveName, menu, infoShown, printOne, printWhy, printReady, openPrint, sort, sortKey, uploads, dropOn, printingPath,
      locked, printTag, current, writable, pickable, videos, here, crumbs, hereFull, known, isSet, fileUrl, download, columns, cols,
      timeCol, rows, timeText, sizeText, shortWhen, whenText, factsOf, pickedRows, one, oneFile, pickedLocked, pickedSize, filesSize,
      allPicked, countText, fmtSize, sortBy, toggle, pickAll, pointer, rowClick, openRow, gridKey, actions, openMenu,
      runMenu, menuKey, toggleInfo, infoRows, readFolder, show, openDir, rootKey, askText, remove, makeDir, move, pickedPaths,
      toggleMove, answer, clearUploads, percent, chosenFiles, dragStart, dragEnd, dragOver, dropNowhere, dragLeave, drop, closePrint,
      zoomed, hoverStart, hoverEnd, watching, player, stopWatching, parentOf, grid, moveBox, menuBox, fileInput, go, hashOf, ui,
    };
  },

  template: `
    <div :class="['page-host', 'files-host', { 'with-panel': printing || (model && infoShown) }]" @dragover="dropNowhere" @drop="dropNowhere">
      <div class="page fill-page files-page">
        <h1 id="page-title" class="files-title" tabindex="-1">{{ D.title }}</h1>

        <p v-if="!model" class="empty">{{ D.none }}
          <a class="link" :href="hashOf('drucker', instId)" @click="go($event, hashOf('drucker', instId))">{{ D.toPrinters }}</a></p>
        <section v-else :class="['box', 'files-box', { 'is-drop': dropOn === HERE }]" :aria-label="D.title"
                 @dragover="dragOver($event, null)" @dragleave="dragLeave" @drop="drop($event, null)">
          <!-- The shares as tabs -->
          <div class="files-roots">
            <div class="files-root-tabs" role="tablist" :aria-label="D.shares" @keydown="rootKey">
              <button v-for="f in folders" :id="'files-root-' + f.name" :key="f.name" :class="['mon-tab', 'files-root', { 'is-current': folder === f.name }]"
                      type="button" role="tab" :aria-selected="folder === f.name ? 'true' : 'false'" aria-controls="files-panel"
                      :tabindex="folder === f.name ? 0 : -1" :title="f.delete ? null : D.readOnlyNote" @click="show(f.name)">
                <ui-icon :name="ICON[f.name]" :size="16"/><span class="files-root-name">{{ D.folders[f.name] }}</span>
                <ui-icon v-if="!f.delete" name="lock" :size="12" class="files-root-lock"/>
                <span v-if="f.name === 'gcodes' && printingPath" class="files-tag is-printing">{{ printTag }}</span>
              </button>
            </div>
          </div>

          <div id="files-panel" class="files-panel" role="tabpanel" :aria-labelledby="'files-root-' + folder">
            <!-- Where, and what goes: icons, each explained by its tooltip -->
            <div class="files-bar">
              <button :class="['icon-btn', { 'is-drop': path && dropOn === parentOf(path) }]" type="button" :disabled="!path" :title="D.up" :aria-label="D.up"
                      @click="openDir(parentOf(path))" @dragover="path && dragOver($event, parentOf(path))" @dragleave="dragLeave"
                      @drop="drop($event, parentOf(path))"><ui-icon name="levelUp"/></button>
              <nav class="files-crumbs" :aria-label="D.where">
                <template v-for="(c, i) in crumbs" :key="c.path">
                  <span v-if="i" class="files-crumb-sep" aria-hidden="true">›</span>
                  <button :class="['files-crumb', { 'is-drop': dropOn === c.path }]" type="button" :aria-current="i === crumbs.length - 1 ? 'location' : null"
                          @click="openDir(c.path)" @dragover="dragOver($event, c.path)" @dragleave="dragLeave" @drop="drop($event, c.path)">{{ c.name }}</button>
                </template>
              </nav>
              <span class="files-bar-tools">
                <template v-if="folder === 'gcodes'">
                  <button class="icon-btn is-main" type="button" :disabled="!printOne || !!printWhy || !printReady" :title="printWhy || D.print"
                          :aria-label="D.print" @click="openPrint(printOne)"><ui-icon name="play"/></button>
                  <span class="files-bar-sep" aria-hidden="true"></span>
                </template>
                <template v-if="writable">
                  <button class="icon-btn" type="button" :title="D.newDirIn(here)" :aria-label="D.newDirIn(here)" @click="newDir = ''"><ui-icon name="folderPlus"/></button>
                  <button class="icon-btn" type="button" :title="D.uploadTo(here)" :aria-label="D.uploadTo(here)" @click="fileInput.click()"><ui-icon name="export"/></button>
                  <input ref="fileInput" type="file" multiple hidden @change="chosenFiles">
                  <span class="files-bar-sep" aria-hidden="true"></span>
                </template>
                <button class="icon-btn" type="button" :disabled="!oneFile" :title="D.download" :aria-label="D.download" @click="download(oneFile.item)">
                  <ui-icon name="download"/></button>
                <div v-if="writable" ref="moveBox" class="files-move-pick">
                  <button class="icon-btn" type="button" :disabled="!picked.size || pickedLocked" :title="pickedLocked ? D.inUseWhy : D.moveTo" :aria-label="D.moveTo"
                          aria-haspopup="tree" :aria-expanded="moveOpen ? 'true' : 'false'" @click="toggleMove"><ui-icon name="folderMove"/></button>
                  <div v-if="moveOpen" class="files-tree-panel is-move" @keydown.esc.stop="moveOpen = false">
                    <folder-tree :model="model" :here="path" :chosen="moveTarget" :blocked="pickedRows.filter((r) => r.dir).map((r) => r.path)"
                                 :printing="printingPath" :print-tag="printTag" :known="known" @choose="(p) => { moveTarget = p; }"/>
                    <div class="files-move-go">
                      <button class="btn btn-primary" type="button" :disabled="moveTarget === null" @click="move(pickedPaths(), moveTarget)">
                        {{ moveTarget === null ? D.moveChoose : D.moveHere(moveName) }}</button>
                    </div>
                  </div>
                </div>
                <button v-if="pickable" class="icon-btn is-danger" type="button" :disabled="!picked.size || pickedLocked || deleting"
                        :title="pickedLocked ? D.inUseWhy : D.delete" :aria-label="D.delete" @click="asking = true"><ui-icon name="trash"/></button>
                <span class="files-bar-sep" aria-hidden="true"></span>
                <button class="icon-btn" type="button" :title="D.reload" :aria-label="D.reload" @click="readFolder"><ui-icon name="refresh"/></button>
                <button class="icon-btn" type="button" :aria-pressed="infoShown ? 'true' : 'false'" aria-controls="files-info" :title="D.infoToggle"
                        :aria-label="D.infoToggle" @click="toggleInfo"><ui-icon name="panelRight"/></button>
              </span>
            </div>

            <div v-if="asking" class="files-askbar" role="alert">
              <strong class="files-ask">{{ askText }}</strong>
              <button class="btn btn-danger-solid" type="button" :disabled="deleting || !picked.size" @click="remove"><ui-icon name="trash"/>{{ D.delete }}</button>
              <button class="btn" type="button" @click="asking = false">{{ T.cancel }}</button>
            </div>

            <!-- The uploads, each with its progress -->
            <div v-if="uploads.length" class="files-uploads" aria-live="polite">
              <div v-for="u in uploads" :key="u.id" :class="['files-upload', 'is-' + u.state]">
                <ui-icon :name="u.state === 'done' ? 'checkCircle' : u.state === 'fail' || u.state === 'ask' ? 'warn' : 'export'" :size="16"/>
                <span class="files-upload-name" :title="u.file.name">{{ u.file.name }}<span v-if="u.target" class="files-upload-to"> → {{ u.target }}</span></span>
                <template v-if="u.state === 'ask'">
                  <span class="files-upload-ask">{{ D.exists }}</span>
                  <button class="btn" type="button" @click="answer(u, true)">{{ D.replace }}</button>
                  <button class="btn" type="button" @click="answer(u, false)">{{ D.skip }}</button>
                </template>
                <span v-else-if="u.state === 'fail'" class="files-upload-error">{{ u.error }}</span>
                <span v-else class="files-upload-state">{{ D.uploadState[u.state] }}<template v-if="u.state === 'run'"> · {{ percent(u) }} %</template></span>
                <progress v-if="u.state === 'run' || u.state === 'wait'" class="files-progress" max="100" :value="percent(u)"></progress>
              </div>
              <button v-if="uploads.every((u) => !['wait', 'run', 'ask'].includes(u.state))" class="link files-uploads-clear" type="button" @click="clearUploads">{{ D.clearUploads }}</button>
            </div>
            <p v-if="dropOn === HERE" class="files-drop-hint"><ui-icon name="export" :size="20"/>{{ D.dropHere(here) }}</p>

            <!-- The table: a click picks, Ctrl and Shift more, a double click opens, a right click shows the rest -->
            <div class="files-scroll" @scroll="menu = null" @contextmenu="openMenu" @pointerdown="pointer">
              <p v-if="listError" class="alert" role="alert">{{ listError }}</p>
              <p v-else-if="files === null" class="note">{{ T.loading }}</p>
              <template v-else>
                <div ref="grid" class="files-grid" role="grid" aria-multiselectable="true" :aria-label="hereFull" tabindex="0"
                     :aria-activedescendant="cursorId" :style="{ '--cols': cols, '--cols-phone': pickable ? '28px minmax(0, 1fr)' : 'minmax(0, 1fr)' }"
                     @keydown="gridKey">
                  <div class="files-row files-head" role="row">
                    <span v-if="pickable" class="files-c-pick" role="columnheader">
                      <input type="checkbox" tabindex="-1" :checked="allPicked" :indeterminate.prop="picked.size > 0 && !allPicked" :disabled="!rows.length"
                             :title="D.pickAll" :aria-label="D.pickAll" @change="pickAll($event.target.checked)"></span>
                    <span v-for="c in columns" :key="c" :class="'files-c-' + c" role="columnheader"
                          :aria-sort="sortKey === c ? (sort.desc ? 'descending' : 'ascending') : null">
                      <button v-if="c !== 'length'" class="files-sort" type="button" :title="sortKey === c ? (sort.desc ? D.sortDesc : D.sortAsc) : D.sortBy(D.cols[c])"
                              @click="sortBy(c)">{{ D.cols[c] }}<ui-icon v-if="sortKey === c" name="chevronDown" :size="14" :class="['files-sort-dir', { 'is-asc': !sort.desc }]"/></button>
                      <span v-else>{{ D.cols[c] }}</span>
                    </span>
                  </div>
                  <!-- A new folder: its name typed in its own row -->
                  <div v-if="newDir !== null" class="files-row files-newdir-row" role="row">
                    <span class="files-c-new" role="gridcell">
                      <ui-icon name="folder" :size="20" class="files-dir-icon"/>
                      <form class="files-newdir" @submit.prevent="makeDir">
                        <input v-model="newDir" class="input" type="text" :placeholder="D.newDirName" :aria-label="D.newDirName" maxlength="200"
                               @keydown.esc.stop="newDir = null" @vue:mounted="({ el }) => el.focus()">
                        <button class="btn btn-primary" type="submit" :disabled="!newDir.trim()">{{ D.make }}</button>
                        <button class="icon-btn" type="button" :title="T.cancel" :aria-label="T.cancel" @click="newDir = null"><ui-icon name="close"/></button>
                      </form>
                    </span>
                  </div>
                  <div v-for="(r, i) in rows" :id="'files-r' + i" :key="r.key" :data-key="r.key" role="row" :aria-selected="picked.has(r.key) ? 'true' : 'false'"
                       :class="['files-row', { 'is-picked': picked.has(r.key), 'is-cursor': cursor === r.key, 'is-set': !r.dir && isSet(r.item), 'is-drop': r.dir && dropOn === r.path }]"
                       :draggable="writable && !locked(r.path) ? 'true' : 'false'" @click="rowClick($event, r)" @dblclick="openRow(r)"
                       @dragstart="dragStart($event, r)" @dragend="dragEnd" @dragover="r.dir && dragOver($event, r.path)" @dragleave="dragLeave"
                       @drop="r.dir && drop($event, r.path)">
                    <span v-if="pickable" class="files-c-pick" role="gridcell">
                      <input type="checkbox" tabindex="-1" :checked="picked.has(r.key)" :aria-label="D.pick(r.name)" @click.stop @dblclick.stop @change="toggle(r.key)"></span>
                    <span class="files-c-name" role="gridcell">
                      <ui-icon v-if="r.dir" name="folder" :size="20" class="files-dir-icon"/>
                      <img v-else-if="r.item.thumb" class="files-thumb" :src="fileUrl(r.item.thumb)" alt="" loading="lazy" draggable="false"
                           @mouseenter="hoverStart(r.item)" @mouseleave="hoverEnd">
                      <ui-icon v-else :name="ICON[folder]" :size="20" class="files-file-icon"/>
                      <span class="files-name" :title="r.name">{{ r.name }}</span>
                      <span v-if="locked(r.path)" class="files-tag is-printing">{{ printTag }}</span>
                      <span v-if="!r.dir && isSet(r.item)" class="files-tag is-set" :title="D.setFileNote"><ui-icon name="checkCircle" :size="13"/>{{ D.isSet }}</span>
                      <span v-if="!r.dir && r.item.tools?.length" class="files-heads">
                        <span v-for="t in r.item.tools" :key="t.tool" class="files-dot" :style="{ background: t.colour || 'transparent' }"
                              :title="T.u1.head(t.tool + 1) + ': ' + t.type"></span></span>
                    </span>
                    <span v-if="timeCol" class="files-c-time" role="gridcell">{{ timeText(r) }}</span>
                    <span class="files-c-size" role="gridcell">{{ sizeText(r) }}</span>
                    <span class="files-c-modified" role="gridcell" :title="r.item.modified ? whenText(new Date(r.item.modified * 1000)) : null">{{ shortWhen(r.item.modified) }}</span>
                    <span class="files-c-facts">{{ factsOf(r) }}</span>
                  </div>
                  <div v-if="!rows.length && newDir === null" class="files-row files-empty" role="row">
                    <span role="gridcell">{{ videos ? D.emptyVideos : writable ? D.emptyDrop : D.empty }}</span></div>
                </div>
                <div class="files-rest" @click="pickAll(false)"></div>
              </template>
            </div>

            <div class="files-status">
              <span>{{ files ? countText(files.length, dirs.length) : '' }}<template v-if="filesSize"> · {{ fmtSize(filesSize) }}</template></span>
              <span v-if="picked.size" class="files-status-picked">{{ D.picked(picked.size) }}<template v-if="pickedSize"> · {{ fmtSize(pickedSize) }}</template></span>
              <span class="files-status-hint">{{ writable ? D.hintDrop : D.hint }}</span>
            </div>
          </div>
        </section>
      </div>

      <!-- What is picked, or the folder shown when nothing is: the side panel as "Drucken" has it -->
      <aside v-if="model && infoShown" id="files-info" class="panel files-info" aria-labelledby="files-info-title">
        <div class="panel-head">
          <h2 id="files-info-title">{{ D.info }}</h2>
          <button class="icon-btn" type="button" :title="D.infoToggle" :aria-label="D.infoToggle" @click="toggleInfo"><ui-icon name="close"/></button>
        </div>
        <div class="panel-body files-info-body">
          <template v-if="oneFile">
            <img v-if="oneFile.item.picture || oneFile.item.thumb" class="files-info-picture" :src="fileUrl(oneFile.item.picture || oneFile.item.thumb)" alt="">
            <span v-else class="files-info-icon"><ui-icon :name="ICON[folder]" :size="40"/></span>
            <strong class="files-info-name">{{ oneFile.name }}</strong>
            <span v-if="locked(oneFile.path)" class="files-tag is-printing">{{ printTag }}</span>
            <span v-if="isSet(oneFile.item)" class="files-tag is-set" :title="D.setFileNote"><ui-icon name="checkCircle" :size="13"/>{{ D.isSet }}</span>
          </template>
          <template v-else-if="one">
            <span class="files-info-icon"><ui-icon name="folder" :size="40"/></span>
            <strong class="files-info-name">{{ one.name }}</strong>
            <span v-if="locked(one.path)" class="files-tag is-printing">{{ D.holdsPrint }}</span>
          </template>
          <template v-else-if="pickedRows.length">
            <span class="files-info-icon"><ui-icon name="check" :size="40"/></span>
            <strong class="files-info-name">{{ D.picked(pickedRows.length) }}</strong>
            <span class="files-info-sub">{{ countText(pickedRows.filter((r) => !r.dir).length, pickedRows.filter((r) => r.dir).length) }}
              <template v-if="pickedSize"> · {{ fmtSize(pickedSize) }}</template></span>
          </template>
          <template v-else>
            <span class="files-info-icon"><ui-icon :name="path ? 'folderOpen' : ICON[folder]" :size="40"/></span>
            <strong class="files-info-name">{{ here }}</strong>
            <span v-if="files" class="files-info-sub">{{ countText(files.length, dirs.length) }}<template v-if="filesSize"> · {{ fmtSize(filesSize) }}</template></span>
            <div v-if="disk?.total" :class="['files-info-disk', { 'is-full': diskFull }]">
              <span>{{ D.disk(fmtSize(disk.used), fmtSize(disk.total)) }}<template v-if="diskFull"> · {{ D.diskFull }}</template></span>
              <span class="files-info-disk-bar"><span :style="{ width: diskShare * 100 + '%' }"></span></span>
            </div>
            <p v-if="current && !current.delete" class="files-info-note"><ui-icon name="lock" :size="14"/>{{ D.readOnlyNote }}</p>
            <p class="files-info-note">{{ D.infoNone }}</p>
          </template>
          <div v-if="actions.length" class="files-info-actions">
            <button v-for="a in actions" :key="a.id" :class="['icon-btn', { 'is-main': a.main, 'is-danger': a.danger }]" type="button" :disabled="a.off"
                    :title="a.why || a.label" :aria-label="a.label" @click="a.run()"><ui-icon :name="a.icon"/></button>
          </div>
          <dl v-if="infoRows.length" class="kv files-info-kv">
            <template v-for="[label, value] in infoRows" :key="label"><dt>{{ label }}</dt><dd>{{ value }}</dd></template>
          </dl>
          <template v-if="oneFile?.item.tools?.length">
            <h3>{{ D.detail.heads }}</h3>
            <div v-for="t in oneFile.item.tools" :key="t.tool" class="files-info-tool">
              <span class="files-dot" :style="{ background: t.colour || 'transparent' }"></span>
              {{ T.u1.head(t.tool + 1) }}: {{ t.type }}<template v-if="t.grams"> · {{ D.grams(t.grams) }}</template></div>
          </template>
        </div>
      </aside>

      <print-panel v-if="printing" :camera="cameraId" :model="ui.printer" :file="printing"
                   :picture="printing.picture ? fileUrl(printing.picture) : ''" @close="closePrint"/>

      <!-- The context menu, where the pointer was -->
      <div v-if="menu" ref="menuBox" class="inst-menu files-menu" role="menu" :style="{ left: menu.x + 'px', top: menu.y + 'px' }" @keydown="menuKey">
        <button v-for="a in menu.items" :key="a.id" :class="['inst-item', { 'is-danger': a.danger }]" type="button" role="menuitem" :disabled="a.off"
                :title="a.why || null" @click="runMenu(a)"><ui-icon :name="a.icon" :size="16"/><span>{{ a.label }}</span></button>
      </div>

      <!-- The preview large while the pointer rests on the small one -->
      <div v-if="zoomed" class="files-zoom" aria-hidden="true">
        <img :src="fileUrl(zoomed.picture || zoomed.thumb)" alt="">
        <span class="files-zoom-name">{{ zoomed.name }}</span>
      </div>

      <div v-if="watching" class="cam-overlay" role="dialog" :aria-label="watching.name">
        <video ref="player" :src="fileUrl(watching.path || watching.name)" controls autoplay></video>
        <div class="cam-overlay-bar">
          <strong>{{ watching.name }}</strong>
          <small class="cam-overlay-hint">{{ T.camera.back }}</small>
          <button class="cam-overlay-btn" type="button" :title="T.camera.views.normal" :aria-label="T.camera.views.normal"
                  @click="stopWatching"><ui-icon name="close"/></button>
        </div>
      </div>
    </div>
  `,
};
