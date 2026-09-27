// Page "Dateien": the files on the Klipper printer of the top bar (orcaone/printer_files.py, the
// user's wish of 24.09.2026; since 26.09.2026 on every Klipper printer with an address, as a file
// explorer). Where it is shows one button at the top: it opens the folder tree (folder-tree.js) of
// all Moonraker shares, beside it what goes for this folder, new folder, delete it, upload (the user's
// wish of 27.09.2026: four chips, a path bar and folder rows were "verwirrend und angeklatscht").
// In "Druckdateien" files dropped from the computer are uploaded, files and folders dragged onto a
// folder or onto "Eine Ebene höher" are moved. Sorted by name, size, date or print time, the choice
// kept in data/settings.json. Print files and the U1's time-lapse videos can be deleted, one, several
// or all, a print file printed (on the U1 with the options of its display), and each shows its
// details in the side panel. Logs open on the page "Logs". Pictures, videos and files come through
// OrcaOne: the browser never talks to the printer itself.
import { flash, go, hashOf, fmtSize, whenText, ui, isU1Printer, LOCALE } from "../common.js";
import { T, SETTINGS } from "../texts.js";
import { api } from "../api.js";
import { useLive } from "../live.js";
import PrintPanel, { BUSY, fileFacts } from "./print-panel.js";
import FolderTree, { ICON } from "./folder-tree.js";

const { ref, reactive, computed, onMounted, onUnmounted, nextTick } = Vue;
const D = T.files;
const SORT_KEYS = ["name", "size", "modified", "time"];
const DRAG_TYPE = "application/x-orcaone-paths";
const ZOOM_DELAY = 1000;  // ms resting on a preview until it shows large
const HERE = "\0here";   // dropOn for the list itself: no path can be it
const DISK_FULL = 0.9;   // share of the disk used from which "fast voll" shows
const parentOf = (p) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");

export default {
  name: "DateienPage",
  components: { PrintPanel, FolderTree },
  props: { instId: { type: String, default: null } },  // the page does not depend on an installation

  setup(props) {
    const model = computed(() => ui.printer || "");
    const u1 = computed(() => isU1Printer(ui.printer));
    const cameraId = ref(null);   // the U1's camera id for the print panel with the display's options
    const folder = ref("gcodes");
    const path = ref("");         // the folder shown in the root, "" for its top
    const folders = ref([]);      // the roots: [{ name, delete }]
    const files = ref(null);      // null while loading
    const dirs = ref([]);
    const disk = ref(null);
    const listError = ref("");
    const picked = reactive(new Set());
    const asking = ref(null);     // "picked" or "all" while the question to delete shows
    const askingDir = ref(false); // the question to delete the folder shown
    const deleting = ref(false);
    const printing = ref(null);   // the file in the print panel (print-panel.js)
    const details = ref(null);    // the file in the details panel
    const askingOne = ref(false); // the question to delete the file of the details panel
    const newDir = ref(null);     // the name typed for a new folder, null while its row is closed
    const treeOpen = ref(false);  // the folder tree under the button at the top
    const moveOpen = ref(false);  // the tree to choose where the picked go
    const moveTarget = ref(null); // the folder chosen there, moved only on the button's click
    const sortOpen = ref(false);
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
    const whereBox = ref(null), moveBox = ref(null), sortBox = ref(null), whereBtn = ref(null);

    const live = useLive(() => ui.printer);
    const job = computed(() => live.value?.data?.monitor?.job || null);
    const busy = computed(() => BUSY.includes(job.value?.state));
    // The file Klipper prints or holds paused: it and the folders around it stay where they are.
    const printingPath = computed(() => (busy.value && job.value?.file) || null);
    const inUse = (p) => !!printingPath.value && (printingPath.value === p || printingPath.value.startsWith(p + "/"));
    const printTag = computed(() => D.treePrints(job.value?.state));

    const errorText = (err) => [D.errors[err.code] || T.errors[err.code] || T.errors.unknown, err.data?.detail].filter(Boolean).join(" ");
    const detailText = (detail) => D.errors[detail] || detail;
    const current = computed(() => folders.value.find((f) => f.name === folder.value) || null);
    const writable = computed(() => folder.value === "gcodes" && !!current.value?.delete);
    const pickable = computed(() => !!current.value?.delete);
    const videos = computed(() => folder.value === "camera");
    const keyOf = (f) => (videos.value ? f.id : f.path || f.name);
    const dirKey = (d) => "dir:" + d.path;
    const pathOf = (f) => f.path || f.name;
    // The button at the top: the root and the way in it, shortened past two folders (all of it in the tooltip).
    const parts = computed(() => (path.value ? path.value.split("/") : []));
    const here = computed(() => (parts.value.length ? parts.value[parts.value.length - 1] : D.folders[folder.value]));
    const whereLong = computed(() => [D.folders[folder.value], ...(parts.value.length > 2 ? ["…", here.value] : parts.value)]);
    const whereFull = computed(() => [D.folders[folder.value], ...parts.value].join(" › "));
    const known = computed(() => (folder.value === "gcodes" && files.value ? { folder: "gcodes", path: path.value, dirs: dirs.value } : null));
    const diskFull = computed(() => !!disk.value?.total && disk.value.used / disk.value.total >= DISK_FULL);
    // A print file becomes the one "2D Ansicht" and "3D Ansicht" show, the one in the top bar (the
    // user's wish of 24.09.2026): a click on its name, or on "3D" and "2D", which also go there.
    const viewable = (f) => folder.value === "gcodes" && /\.gcode$/i.test(pathOf(f));
    // Not while the printer prints another one (app.js fileLocked): its file stays.
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
    function play(f, ev) {
      opener = ev.currentTarget;
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

    // Folders first, by name; then the files as chosen, those without the value at the end.
    const byName = (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
    const sortedDirs = computed(() => [...dirs.value].sort((a, b) => {
      if (sort.key === "modified") return ((a.modified || 0) - (b.modified || 0)) * (sort.desc ? -1 : 1) || byName(a, b);
      return byName(a, b) * (sort.key === "name" && sort.desc ? -1 : 1);
    }));
    const sortedFiles = computed(() => {
      const key = sort.key === "time" && folder.value !== "gcodes" ? "modified" : sort.key;
      return [...(files.value || [])].sort((a, b) => {
        if (key === "name") return byName(a, b) * (sort.desc ? -1 : 1);
        const x = a[key], y = b[key];
        if (x == null || y == null) return x == null ? (y == null ? byName(a, b) : 1) : -1;
        return (x - y) * (sort.desc ? -1 : 1) || byName(a, b);
      });
    });
    const sortKeys = computed(() => SORT_KEYS.filter((k) => k !== "time" || folder.value === "gcodes"));
    function sortBy(key) {
      if (sort.key === key) sort.desc = !sort.desc;
      else Object.assign(sort, { key, desc: key !== "name" });
      SETTINGS.files_sort = { ...sort };
      api.setFilesSort({ ...sort }).catch(() => {});
      sortOpen.value = false;
    }

    // Without what is being printed: its box stays empty.
    const locked = (p) => folder.value === "gcodes" && inUse(p);
    const allKeys = computed(() => [...(writable.value ? sortedDirs.value.filter((d) => !locked(d.path)).map(dirKey) : []),
                                    ...sortedFiles.value.filter((f) => !locked(pathOf(f))).map(keyOf)]);
    const allPicked = computed(() => !!allKeys.value.length && picked.size === allKeys.value.length);
    const pickedDirs = () => dirs.value.filter((d) => picked.has(dirKey(d))).map((d) => d.path);
    const pickedFiles = () => (files.value || []).filter((f) => picked.has(keyOf(f))).map(keyOf);
    const countText = (nFiles, nDirs) => D.items(nFiles, nDirs, videos.value);
    const doneText = (k) => (videos.value ? D.things(k, true) : D.entries(k));

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
        // Whatever is gone meanwhile leaves the selection and the panel.
        const keys = new Set([...got.files.map(keyOf), ...got.dirs.map(dirKey)]);
        for (const k of [...picked]) if (!keys.has(k)) picked.delete(k);
        if (details.value) details.value = got.files.find((f) => keyOf(f) === keyOf(details.value)) || null;
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
    // Remembered per printer while OrcaOne is open (ui.filesAt), for the next visit of the page.
    function show(name, at = "") {
      folder.value = name;
      path.value = at;
      ui.filesAt[model.value] = { folder: name, path: at };
      files.value = null;
      dirs.value = [];
      picked.clear();
      asking.value = null;
      askingDir.value = false;
      newDir.value = null;
      details.value = null;
      moveOpen.value = false;
      readFolder();
    }
    const openDir = (p) => show(folder.value, p);
    function chooseFolder(where) {
      treeOpen.value = false;
      whereBtn.value?.focus();
      if (where.folder === folder.value && where.path === path.value) readFolder();
      else show(where.folder, where.path);
    }
    function toggleTree() {
      treeOpen.value = !treeOpen.value;
      sortOpen.value = moveOpen.value = false;
    }
    function closeTree() {
      treeOpen.value = false;
      whereBtn.value?.focus();
    }
    // A click beside an open tree or menu closes it.
    function outside(ev) {
      if (treeOpen.value && !whereBox.value?.contains(ev.target)) treeOpen.value = false;
      if (moveOpen.value && !moveBox.value?.contains(ev.target)) moveOpen.value = false;
      if (sortOpen.value && !sortBox.value?.contains(ev.target)) sortOpen.value = false;
    }
    const onKey = (ev) => {
      if (ev.key !== "Escape") return;
      if (watching.value) stopWatching();
      else if (treeOpen.value) closeTree();
      else moveOpen.value = sortOpen.value = false;
    };
    onMounted(() => {
      document.addEventListener("keydown", onKey);
      document.addEventListener("pointerdown", outside);
    });
    onUnmounted(() => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", outside);
    });

    function toggle(key) {
      if (picked.has(key)) picked.delete(key);
      else picked.add(key);
      asking.value = null;
    }
    function pickAll(on) {
      picked.clear();
      if (on) for (const k of allKeys.value) picked.add(k);
      asking.value = null;
      moveOpen.value = false;
    }
    // One by one on the printer, so one that fails (the file being printed) leaves the rest done.
    async function remove(names, dirPaths) {
      asking.value = null;
      askingOne.value = false;
      deleting.value = true;
      try {
        const { deleted, failed } = await api.deletePrinterFiles(model.value, folder.value, names, dirPaths);
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
    const removeAsked = () => remove(pickedFiles(), writable.value ? pickedDirs() : []);
    // The folder shown with all in it, after the question at the top; then the folder above.
    async function removeDir() {
      const gone = path.value, name = here.value;
      askingDir.value = false;
      deleting.value = true;
      try {
        const { deleted, failed } = await api.deletePrinterFiles(model.value, "gcodes", [], [gone]);
        if (deleted.includes(gone)) {
          flash(D.dirDeleted(name));
          show("gcodes", parentOf(gone));
        } else {
          flash(D.notDeleted(D.entries(1), detailText(failed[0]?.detail)));
        }
      } catch (err) {
        flash(errorText(err));
      } finally {
        deleting.value = false;
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
    const pickedPaths = () => [...pickedFiles(), ...pickedDirs()];
    // "Verschieben nach …": the tree of "Druckdateien" chooses, the button moves (review 27.09.2026).
    function toggleMove() {
      moveOpen.value = !moveOpen.value;
      moveTarget.value = null;
      treeOpen.value = sortOpen.value = false;
    }
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
    const uploadsOpen = computed(() => uploads.value.length > 0);
    const percent = (u) => (u.file.size ? Math.round((100 * u.sent) / u.file.size) : 100);
    const fileInput = ref(null);
    function chosenFiles(ev) {
      addUploads([...ev.target.files], path.value);
      ev.target.value = "";
    }

    // ---- drag and drop: files from the computer anywhere onto the list or a folder, rows onto a folder
    const fromComputer = (ev) => [...(ev.dataTransfer?.types || [])].includes("Files");
    function dragStart(ev, key, p) {
      if (!writable.value || inUse(p)) return ev.preventDefault();
      hoverEnd();
      dragging = picked.has(key) ? pickedPaths() : [p];
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

    // ---- the side panels: printing (print-panel.js) and the details of a file
    const openPrint = (f) => {
      details.value = null;
      printing.value = f;
    };
    const closePrint = () => { printing.value = null; };
    const openDetails = (f) => {
      printing.value = null;
      askingOne.value = false;
      details.value = f;
      nextTick(() => document.getElementById("details-title")?.focus());
    };
    // The picture large in the middle of the screen after resting on the small one (the user's wish
    // of 26.09.2026: to see more of it), gone when the pointer leaves it.
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
    const facts = fileFacts;
    const detailRows = computed(() => {
      const f = details.value;
      if (!f) return [];
      const mm = (v) => (v != null ? `${Number(v).toLocaleString(LOCALE, { maximumFractionDigits: 2 })} mm` : null);
      return [
        [D.detail.path, f.path || f.name],
        [D.detail.size, f.size != null ? fmtSize(f.size) : null],
        [D.detail.modified, f.modified ? whenText(new Date(f.modified * 1000)) : null],
        [D.detail.printed, f.printed ? whenText(new Date(f.printed * 1000)) : null],
        [D.detail.time, f.time ? T.camera.print.duration(Math.floor(Math.round(f.time / 60) / 60), Math.round(f.time / 60) % 60) : null],
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

    // On the U1 a print goes with the options of its display, so only once its camera id is known.
    const printReady = computed(() => !u1.value || !!cameraId.value);

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
      T, D, ICON, model, u1, cameraId, folder, path, folders, files, dirs, disk, diskFull, listError, picked, asking, askingDir, deleting,
      printing, details, askingOne, newDir, sort, sortOpen, uploads, dropOn, busy, job, printingPath, inUse, printTag, current, writable,
      pickable, videos, keyOf, dirKey, pathOf, here, whereLong, whereFull, known, viewable, setFile, isSet, openView, fileUrl, sortedDirs,
      sortedFiles, sortKeys, sortBy, allKeys, allPicked, countText, pickedFiles, pickedDirs, openDir, chooseFolder, toggleTree, closeTree, treeOpen,
      toggle, pickAll, remove, removeAsked, removeDir, makeDir, move, moveOpen, moveTarget, moveName, toggleMove, pickedPaths, answer,
      clearUploads, uploadsOpen, percent, fileInput, chosenFiles, dragStart, dragEnd, dragOver, dragLeave, drop, dropNowhere, HERE,
      printReady, zoomed, hoverStart, hoverEnd, openPrint, closePrint, openDetails, facts, detailRows, fmtSize, whenText, go, hashOf, ui,
      watching, player, play, stopWatching, openLog, parentOf, whereBox, moveBox, sortBox, whereBtn,
    };
  },

  template: `
    <div :class="['page-host', { 'with-panel': printing || details }]" @dragover="dropNowhere" @drop="dropNowhere">
      <div class="page files-page">
        <h1 id="page-title" tabindex="-1">{{ D.title }}</h1>
        <p class="note">{{ D.lead }}</p>

        <p v-if="!model" class="empty">{{ D.none }}
          <a class="link" :href="hashOf('drucker', instId)" @click="go($event, hashOf('drucker', instId))">{{ D.toPrinters }}</a></p>
        <template v-else>
          <!-- Where: one button with the folder tree, beside it what goes for this folder -->
          <div class="files-where">
            <div ref="whereBox" class="files-where-pick">
              <button ref="whereBtn" class="inst-btn files-where-btn" type="button" aria-haspopup="tree" :aria-expanded="treeOpen ? 'true' : 'false'"
                      :title="whereFull + ' · ' + D.chooseFolder" :aria-label="whereFull + ', ' + D.chooseFolder" @click="toggleTree">
                <ui-icon :name="ICON[folder]" :size="18"/>
                <span class="files-where-long">
                  <template v-for="(p, i) in whereLong" :key="i"><span v-if="i" class="files-where-sep">›</span>{{ p }}</template></span>
                <span class="files-where-short">{{ here }}</span>
                <ui-icon name="chevronDown" :size="16"/>
              </button>
              <div v-if="treeOpen" class="files-tree-panel" @keydown.esc.stop="closeTree">
                <folder-tree :model="model" :roots="folders" :shown="{ folder, path }" :printing="printingPath" :print-tag="printTag"
                             :known="known" @choose="chooseFolder"/>
              </div>
            </div>
            <template v-if="askingDir">
              <strong class="files-ask" role="alert">{{ D.askDir(here) }}</strong>
              <button class="btn btn-danger-solid" type="button" @click="removeDir"><ui-icon name="trash"/>{{ D.delete }}</button>
              <button class="btn" type="button" @click="askingDir = false">{{ T.cancel }}</button>
            </template>
            <span v-else-if="writable" class="files-where-tools">
              <button class="btn btn-icon" type="button" :title="D.newDirIn(here)" :aria-label="D.newDirIn(here)" @click="newDir = ''">
                <ui-icon name="folderPlus"/></button>
              <button v-if="path" class="btn btn-icon" type="button" :disabled="inUse(path) || deleting"
                      :title="inUse(path) ? D.inUseWhy : D.deleteDir(here)" :aria-label="D.deleteDir(here)" @click="askingDir = true">
                <ui-icon name="trash"/></button>
              <span class="files-where-sepline" aria-hidden="true"></span>
              <button class="btn btn-icon" type="button" :title="D.uploadTo(here)" :aria-label="D.uploadTo(here)" @click="fileInput.click()">
                <ui-icon name="import"/></button>
              <input ref="fileInput" type="file" multiple hidden @change="chosenFiles">
            </span>
            <span v-if="disk && folder === 'gcodes'" :class="['files-disk', { 'is-full': diskFull }]">
              {{ D.disk(fmtSize(disk.used), fmtSize(disk.total)) }}<template v-if="diskFull"> · {{ D.diskFull }}</template></span>
          </div>

          <section :class="['box', 'files-box', { 'is-drop': dropOn === HERE }]" :aria-label="whereFull"
                   @dragover="dragOver($event, null)" @dragleave="dragLeave" @drop="drop($event, null)">
            <!-- The head of the list: how many, and with a choice what goes for it; sorting on the right -->
            <div class="files-listhead">
              <input v-if="pickable && allKeys.length" type="checkbox" class="files-pick" :checked="allPicked" :indeterminate.prop="picked.size > 0 && !allPicked"
                     :aria-label="D.pickAll" :title="D.pickAll" @change="pickAll($event.target.checked)">
              <template v-if="asking">
                <strong class="files-ask" role="alert">{{ allPicked ? D.askAll(countText(pickedFiles().length, pickedDirs().length)) : D.askPicked(countText(pickedFiles().length, pickedDirs().length)) }}</strong>
                <button class="btn btn-danger-solid" type="button" @click="removeAsked"><ui-icon name="trash"/>{{ D.delete }}</button>
                <button class="btn" type="button" @click="asking = null">{{ T.cancel }}</button>
              </template>
              <template v-else-if="picked.size">
                <span class="files-count">{{ D.picked(picked.size) }}</span>
                <div v-if="writable" ref="moveBox" class="files-move-pick">
                  <button class="btn" type="button" aria-haspopup="tree" :aria-expanded="moveOpen ? 'true' : 'false'" @click="toggleMove">
                    <ui-icon name="folderMove"/><span class="files-hide-phone">{{ D.moveTo }}</span></button>
                  <div v-if="moveOpen" class="files-tree-panel is-move" @keydown.esc.stop="moveOpen = false">
                    <folder-tree :model="model" :roots="folders.filter((f) => f.name === 'gcodes')" :shown="{ folder: 'gcodes', path }"
                                 :chosen="moveTarget === null ? null : { folder: 'gcodes', path: moveTarget }" :here="path" :blocked="pickedDirs()"
                                 :printing="printingPath" :print-tag="printTag" :known="known" @choose="(w) => { moveTarget = w.path; }"/>
                    <div class="files-move-go">
                      <button class="btn btn-primary" type="button" :disabled="moveTarget === null" @click="move(pickedPaths(), moveTarget)">
                        {{ moveTarget === null ? D.moveChoose : D.moveHere(moveName) }}</button>
                    </div>
                  </div>
                </div>
                <button class="btn" type="button" :disabled="deleting" :title="D.delete" @click="asking = allPicked ? 'all' : 'picked'">
                  <ui-icon name="trash"/><span class="files-hide-phone">{{ deleting ? D.deleting : D.delete }}</span></button>
                <button class="icon-btn" type="button" :title="D.unpick" :aria-label="D.unpick" @click="pickAll(false)"><ui-icon name="close"/></button>
              </template>
              <span v-else-if="files" class="files-count">{{ countText(files.length, dirs.length) }}</span>
              <div ref="sortBox" class="files-sort-pick">
                <button class="btn" type="button" aria-haspopup="menu" :aria-expanded="sortOpen ? 'true' : 'false'"
                        :title="D.sortBy + ': ' + (sort.desc ? D.sortDesc : D.sortAsc)" @click="sortOpen = !sortOpen; treeOpen = moveOpen = false">
                  {{ D.sort[sortKeys.includes(sort.key) ? sort.key : 'modified'] }}
                  <ui-icon name="chevronDown" :size="14" :class="['files-sort-dir', { 'is-asc': !sort.desc }]"/></button>
                <div v-if="sortOpen" class="inst-menu files-sort-menu" role="menu">
                  <button v-for="k in sortKeys" :key="k" class="inst-item" type="button" role="menuitemradio" :aria-checked="sort.key === k ? 'true' : 'false'"
                          @click="sortBy(k)">
                    <span>{{ D.sort[k] }}</span>
                    <ui-icon v-if="sort.key === k" name="chevronDown" :size="14" :class="['files-sort-dir', { 'is-asc': !sort.desc }]"/></button>
                </div>
              </div>
            </div>

            <!-- The uploads, each with its progress -->
            <div v-if="uploadsOpen" class="files-uploads" aria-live="polite">
              <div v-for="u in uploads" :key="u.id" :class="['files-upload', 'is-' + u.state]">
                <ui-icon :name="u.state === 'done' ? 'checkCircle' : u.state === 'fail' || u.state === 'ask' ? 'warn' : 'import'" :size="16"/>
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

            <p v-if="dropOn === HERE" class="files-drop-hint"><ui-icon name="import" :size="20"/>{{ D.dropHere(here) }}</p>
            <p v-if="listError" class="alert" role="alert">{{ listError }}</p>
            <p v-else-if="files === null" class="note">{{ T.loading }}</p>
            <ul v-else class="files-list">
              <!-- One level up: a click goes there, files dragged onto it move there -->
              <li v-if="path" :class="['files-row', 'files-up', { 'is-drop': dropOn === parentOf(path) }]"
                  @dragover="dragOver($event, parentOf(path))" @dragleave="dragLeave" @drop="drop($event, parentOf(path))">
                <button class="files-up-btn" type="button" @click="openDir(parentOf(path))">
                  <ui-icon name="levelUp" :size="18"/><span class="files-name">{{ parentOf(path) ? parentOf(path).split('/').pop() : D.folders[folder] }}</span></button>
                <span class="files-meta">{{ D.up }}</span>
              </li>
              <!-- A new folder: its name typed in its own row -->
              <li v-if="newDir !== null" class="files-row files-dir files-newdir-row">
                <ui-icon name="folder" :size="20" class="files-dir-icon"/>
                <form class="files-newdir" @submit.prevent="makeDir">
                  <input v-model="newDir" class="input" type="text" :placeholder="D.newDirName" :aria-label="D.newDirName" maxlength="200"
                         @keydown.esc.stop="newDir = null" @vue:mounted="({ el }) => el.focus()">
                  <button class="btn btn-primary" type="submit" :disabled="!newDir.trim()">{{ D.make }}</button>
                  <button class="icon-btn" type="button" :title="T.cancel" :aria-label="T.cancel" @click="newDir = null"><ui-icon name="close"/></button>
                </form>
              </li>
              <li v-for="d in sortedDirs" :key="dirKey(d)" :class="['files-row', 'files-dir', { 'is-picked': picked.has(dirKey(d)), 'is-drop': dropOn === d.path }]"
                  :draggable="writable && !inUse(d.path) ? 'true' : 'false'" @dragstart="dragStart($event, dirKey(d), d.path)" @dragend="dragEnd"
                  @dragover="dragOver($event, d.path)" @dragleave="dragLeave" @drop="drop($event, d.path)">
                <input v-if="writable" type="checkbox" class="files-pick" :checked="picked.has(dirKey(d))" :disabled="inUse(d.path)" :aria-label="D.pick(d.name)"
                       @change="toggle(dirKey(d))">
                <ui-icon name="folder" :size="20" class="files-dir-icon"/>
                <button class="files-name files-set" type="button" :title="D.openDir" @click="openDir(d.path)">{{ d.name }}</button>
                <span v-if="folder === 'gcodes' && inUse(d.path)" class="files-set-badge is-printing"><span class="cam-dot"></span>{{ D.holdsPrint }}</span>
                <span class="files-meta files-dir-meta">{{ [D.folder, d.modified && whenText(new Date(d.modified * 1000))].filter(Boolean).join(' · ') }}</span>
              </li>
              <li v-for="f in sortedFiles" :key="keyOf(f)" :class="['files-row', { 'is-picked': picked.has(keyOf(f)), 'is-set': isSet(f), 'is-shown': details && keyOf(details) === keyOf(f) }]"
                  :draggable="writable && !inUse(pathOf(f)) ? 'true' : 'false'" @dragstart="dragStart($event, keyOf(f), pathOf(f))" @dragend="dragEnd">
                <input v-if="pickable" type="checkbox" class="files-pick" :checked="picked.has(keyOf(f))"
                       :disabled="folder === 'gcodes' && inUse(pathOf(f))" :aria-label="D.pick(f.name)" @change="toggle(keyOf(f))">
                <img v-if="f.thumb" class="files-thumb" :src="fileUrl(f.thumb)" alt="" loading="lazy" draggable="false"
                     @mouseenter="hoverStart(f)" @mouseleave="hoverEnd">
                <span v-else class="files-thumb is-empty"><ui-icon :name="ICON[folder]" :size="20"/></span>
                <span class="files-main">
                  <button v-if="viewable(f)" class="files-name files-set" type="button" :title="D.setFile" @click="setFile(f)">{{ f.name }}</button>
                  <span v-else class="files-name" :title="f.name">{{ f.name }}</span>
                  <span v-if="isSet(f)" class="files-set-badge"><ui-icon name="check" :size="14"/>{{ D.isSet }}</span>
                  <span v-if="folder === 'gcodes' && inUse(pathOf(f))" class="files-set-badge is-printing"><span class="cam-dot"></span>{{ D.printingNow(job.state) }}</span>
                  <span class="files-meta">{{ facts(f) }}</span>
                  <span v-if="f.tools?.length" class="files-tools">
                    <span v-for="t in f.tools" :key="t.tool" class="files-tool" :title="T.u1.head(t.tool + 1) + ': ' + t.type + (t.grams ? ' · ' + D.grams(t.grams) : '')">
                      <span class="files-dot" :style="{ background: t.colour || 'transparent' }"></span>{{ t.type }}</span>
                  </span>
                </span>
                <span class="files-actions">
                  <button v-if="folder === 'gcodes' && f.printable" class="btn" type="button" :disabled="busy || !printReady" :title="busy ? D.busy(job.state) : null"
                          @click="openPrint(f)"><ui-icon name="play"/>{{ D.print }}</button>
                  <template v-if="viewable(f)">
                    <a class="btn" :href="hashOf('druck3d', instId)" :title="D.view3d" @click.prevent="openView(f, 'druck3d')"><ui-icon name="cube"/>3D</a>
                    <a class="btn" :href="hashOf('druck2d', instId)" :title="D.view2d" @click.prevent="openView(f, 'druck2d')"><ui-icon name="toolpath"/>2D</a>
                  </template>
                  <button v-if="videos" class="btn" type="button" @click="play(f, $event)">{{ D.play }}</button>
                  <button v-else-if="folder === 'logs'" class="btn" type="button" :title="D.openLog" @click="openLog(f)">{{ D.open }}</button>
                  <a v-else-if="folder !== 'gcodes'" class="btn" :href="fileUrl(pathOf(f))" target="_blank" rel="noopener">{{ D.open }}</a>
                  <button class="btn btn-icon" type="button" :title="D.showDetails" :aria-label="D.showDetails" @click="openDetails(f)"><ui-icon name="info"/></button>
                  <a class="btn btn-icon" :href="fileUrl(pathOf(f), true)" :title="D.download" :aria-label="D.download"><ui-icon name="download"/></a>
                </span>
              </li>
              <li v-if="!sortedDirs.length && !sortedFiles.length && newDir === null" class="files-row files-empty">
                {{ videos ? D.emptyVideos : writable ? D.emptyDrop : D.empty }}</li>
            </ul>
          </section>
        </template>
      </div>

      <print-panel v-if="printing" :camera="cameraId" :model="ui.printer" :file="printing"
                   :picture="printing.picture ? fileUrl(printing.picture) : ''" @close="closePrint"/>

      <!-- The preview large while the pointer rests on the small one -->
      <div v-if="zoomed" class="files-zoom" aria-hidden="true">
        <img :src="fileUrl(zoomed.picture || zoomed.thumb)" alt="">
        <span class="files-zoom-name">{{ zoomed.name }}</span>
      </div>

      <!-- The details of a file -->
      <aside v-if="details" class="panel files-details" aria-labelledby="details-title" @keydown.esc="details = null">
        <div class="panel-head">
          <h2 id="details-title" tabindex="-1">{{ D.detailsTitle }}</h2>
          <button class="icon-btn" type="button" :aria-label="T.close" @click="details = null"><ui-icon name="close"/></button>
        </div>
        <div class="panel-body">
          <img v-if="details.picture || details.thumb" class="files-details-picture" :src="fileUrl(details.picture || details.thumb)" alt="">
          <strong class="print-name">{{ details.name }}</strong>
          <p v-if="folder === 'gcodes' && inUse(pathOf(details))" class="files-busy"><span class="cam-dot"></span>{{ D.printingNow(job.state) }}</p>
          <dl class="kv files-details-kv">
            <template v-for="[label, value] in detailRows" :key="label"><dt>{{ label }}</dt><dd>{{ value }}</dd></template>
          </dl>
          <template v-if="details.tools?.length">
            <h3>{{ D.detail.heads }}</h3>
            <div v-for="t in details.tools" :key="t.tool" class="files-tool files-details-tool">
              <span class="files-dot" :style="{ background: t.colour || 'transparent' }"></span>
              {{ T.u1.head(t.tool + 1) }}: {{ t.type }}<template v-if="t.grams"> · {{ D.grams(t.grams) }}</template></div>
          </template>
          <div class="print-actions files-details-actions">
            <button v-if="folder === 'gcodes' && details.printable" class="btn btn-primary" type="button" :disabled="busy || !printReady" @click="openPrint(details)">
              <ui-icon name="play"/>{{ D.print }}</button>
            <template v-if="viewable(details)">
              <a class="btn" :href="hashOf('druck3d', instId)" @click.prevent="openView(details, 'druck3d')"><ui-icon name="cube"/>3D</a>
              <a class="btn" :href="hashOf('druck2d', instId)" @click.prevent="openView(details, 'druck2d')"><ui-icon name="toolpath"/>2D</a>
            </template>
            <a class="btn" :href="fileUrl(pathOf(details), true)"><ui-icon name="download"/>{{ D.download }}</a>
          </div>
          <div v-if="current?.delete" class="files-details-delete">
            <template v-if="askingOne">
              <strong class="files-ask" role="alert">{{ D.askPicked(details.name) }}</strong>
              <button class="btn btn-danger-solid" type="button" @click="remove([keyOf(details)], [])"><ui-icon name="trash"/>{{ D.delete }}</button>
              <button class="btn" type="button" @click="askingOne = false">{{ T.cancel }}</button>
            </template>
            <button v-else class="btn btn-danger" type="button" :disabled="deleting || (folder === 'gcodes' && inUse(pathOf(details)))" @click="askingOne = true">
              <ui-icon name="trash"/>{{ D.delete }}</button>
          </div>
        </div>
      </aside>

      <div v-if="watching" class="cam-overlay" role="dialog" :aria-label="watching.name">
        <video ref="player" :src="fileUrl(pathOf(watching))" controls autoplay></video>
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
