// Page "Dateien": the files on every Snapmaker U1 whose address is set on the page "Drucker"
// (orcaone/printer_files.py, the user's wish of 24.09.2026). The four folders Moonraker shares; the
// two the U1 only shows say so. Print files and time-lapse videos can be deleted, one, several or
// all, and a print file printed with the options of the printer's display. Pictures, videos and
// files come through OrcaOne: the browser never talks to the printer itself.
import { flash, go, hashOf, fmtSize, ui, isU1Printer } from "../common.js";
import { T } from "../texts.js";
import { api } from "../api.js";
import PrintPanel, { BUSY, fileFacts } from "./print-panel.js";

const { ref, reactive, computed, onMounted } = Vue;
const D = T.files;
const ICON = { gcodes: "file", camera: "camera", logs: "log", config: "gear" };

export default {
  name: "DateienPage",
  components: { PrintPanel },
  props: { instId: { type: String, default: null } },  // the page does not depend on an installation

  setup(props) {
    const printers = ref(null);   // the U1 of the top bar if it has an address (api.cameras), null while loading
    const loadError = ref("");
    const chosen = ref("");       // camera id of the U1 shown
    const folder = ref("gcodes");
    const folders = ref([]);
    const files = ref(null);      // null while loading
    const disk = ref(null);
    const listError = ref("");
    const picked = reactive(new Set());
    const asking = ref(null);     // "picked" or "all" while the question shows
    const deleting = ref(false);
    const setup = ref(null);      // the state before a print (printer_files.print_setup): busy or not
    const printing = ref(null);   // the file in the print panel (print-panel.js)

    const errorText = (err) => D.errors[err.code] || T.errors[err.code] || T.errors.unknown;
    const current = computed(() => folders.value.find((f) => f.name === folder.value) || null);
    const videos = computed(() => folder.value === "camera");
    const keyOf = (f) => (videos.value ? f.id : f.name);
    const pathOf = (f) => f.path || f.name;
    // A print file becomes the one "2D Ansicht" and "3D Ansicht" show, the one in the top bar (the
    // user's wish of 24.09.2026): a click on its name, or on "3D" and "2D", which also go there.
    const viewable = (f) => folder.value === "gcodes" && /\.gcode$/i.test(pathOf(f));
    const setFile = (f) => { ui.printFile = { model: ui.printer, path: pathOf(f) }; };
    const isSet = (f) => viewable(f) && ui.printFile?.model === ui.printer && ui.printFile.path === pathOf(f);
    function openView(f, page) {
      setFile(f);
      go(null, hashOf(page, props.instId));
    }
    const fileUrl = (path, download = false) => api.printerFileUrl(chosen.value, folder.value, path, download);
    const busy = computed(() => BUSY.includes(setup.value?.state));
    const allPicked = computed(() => !!files.value?.length && picked.size === files.value.length);

    const facts = fileFacts;

    async function readFolder() {
      listError.value = "";
      try {
        const data = await api.printerFiles(chosen.value, folder.value);
        folders.value = data.folders;
        files.value = data.files;
        if (data.disk) disk.value = data.disk;
        // Whatever is gone meanwhile leaves the selection.
        const keys = new Set(data.files.map(keyOf));
        for (const k of [...picked]) if (!keys.has(k)) picked.delete(k);
      } catch (err) {
        files.value = [];
        listError.value = errorText(err);
      }
    }
    async function readSetup() {
      try {
        setup.value = await api.printSetup(chosen.value);
      } catch {
        setup.value = null;
      }
    }
    function openFolder(name) {
      if (name === folder.value && files.value) return;
      folder.value = name;
      files.value = null;
      picked.clear();
      asking.value = null;
      readFolder();
    }
    function choose(id) {
      chosen.value = id;
      folders.value = [];
      disk.value = null;
      files.value = null;
      picked.clear();
      asking.value = null;
      printing.value = null;
      readFolder();
      readSetup();
    }

    function toggle(f) {
      const k = keyOf(f);
      if (picked.has(k)) picked.delete(k);
      else picked.add(k);
      asking.value = null;
    }
    function pickAll(on) {
      picked.clear();
      if (on) for (const f of files.value || []) picked.add(keyOf(f));
      asking.value = null;
    }
    // One by one on the printer, so one that fails (the file being printed) leaves the rest done.
    async function remove() {
      const names = asking.value === "all" ? files.value.map(keyOf) : [...picked];
      asking.value = null;
      deleting.value = true;
      try {
        const { deleted, failed } = await api.deletePrinterFiles(chosen.value, folder.value, names);
        flash([deleted.length && D.deleted(D.things(deleted.length, videos.value)),
               failed.length && D.notDeleted(D.things(failed.length, videos.value), failed[0].detail)].filter(Boolean).join(" "));
        picked.clear();
      } catch (err) {
        flash(errorText(err));
      } finally {
        deleting.value = false;
        readFolder();
      }
    }

    // The print panel (print-panel.js): options and heads of the display; afterwards the printer is busy.
    const openPrint = (f) => { printing.value = f; };
    const closePrint = () => { printing.value = null; };

    onMounted(async () => {
      try {
        // The printer chosen in the top bar (app.js); every U1 with an address has its files here.
        printers.value = (await api.cameras()).cameras.filter((c) => c.printer === ui.printer);
        if (printers.value.length) choose(printers.value[0].id);
      } catch (err) {
        printers.value = [];
        loadError.value = errorText(err);
      }
    });

    return {
      T, D, ICON, printers, loadError, chosen, folder, folders, files, disk, listError, picked, asking, deleting, setup,
      printing, current, videos, keyOf, pathOf, fileUrl, busy, allPicked, facts, openFolder, choose, readSetup,
      toggle, pickAll, remove, openPrint, closePrint, openView, fmtSize, go, hashOf, ui, isU1Printer,
      viewable, setFile, isSet,
    };
  },

  template: `
    <div :class="['page-host', { 'with-panel': printing }]">
      <div class="page files-page">
        <h1 id="page-title" tabindex="-1">{{ D.title }}</h1>
        <p class="note">{{ D.lead }}</p>

        <p v-if="loadError" class="alert" role="alert">{{ loadError }}</p>
        <p v-else-if="printers === null" class="note">{{ T.loading }}</p>
        <p v-else-if="!isU1Printer(ui.printer)" class="empty">{{ D.notU1 }}</p>
        <p v-else-if="!printers.length" class="empty">{{ D.none }}
          <a class="link" :href="hashOf('drucker', instId)" @click="go($event, hashOf('drucker', instId))">{{ D.toPrinters }}</a></p>
        <template v-else>
          <div class="files-head">
            <div class="chips" role="group" :aria-label="D.title">
              <button v-for="f in folders" :key="f.name" class="chip" type="button" :aria-pressed="f.name === folder ? 'true' : 'false'"
                      @click="openFolder(f.name)">
                <ui-icon :name="ICON[f.name]" :size="16"/>{{ D.folders[f.name] }}<span v-if="!f.delete" class="files-ro-tag">{{ D.readOnly }}</span>
              </button>
            </div>
            <span v-if="disk" class="files-disk">{{ D.disk(fmtSize(disk.used), fmtSize(disk.total)) }}</span>
          </div>
          <p v-if="busy && folder === 'gcodes'" class="files-busy"><span class="cam-dot"></span>{{ D.busy(setup.state) }}</p>

          <section class="box files-box" :aria-label="D.folders[folder]">
            <p v-if="current && !current.delete" class="files-ro"><ui-icon name="info" :size="16"/>{{ D.readOnlyNote }}</p>
            <div v-else-if="files && files.length" class="files-bar">
              <label class="files-all"><input type="checkbox" :checked="allPicked" :indeterminate.prop="picked.size > 0 && !allPicked"
                     @change="pickAll($event.target.checked)">{{ D.pickAll }}</label>
              <span class="files-count">{{ picked.size ? D.picked(picked.size) : D.things(files.length, videos) }}</span>
              <template v-if="asking">
                <strong class="files-ask" role="alert">{{ asking === 'all' ? D.askAll(D.things(files.length, videos)) : D.askPicked(D.things(picked.size, videos)) }}</strong>
                <button class="btn btn-danger-solid" type="button" @click="remove"><ui-icon name="trash"/>{{ D.delete }}</button>
                <button class="btn" type="button" @click="asking = null">{{ T.cancel }}</button>
              </template>
              <template v-else>
                <button class="btn" type="button" :disabled="!picked.size || deleting" @click="asking = 'picked'">
                  <ui-icon name="trash"/>{{ deleting ? D.deleting : D.deletePicked }}</button>
                <button class="btn btn-danger" type="button" :disabled="deleting" @click="asking = 'all'">{{ D.deleteAll }}</button>
              </template>
            </div>
            <p v-if="listError" class="alert" role="alert">{{ listError }}</p>
            <p v-else-if="files === null" class="note">{{ T.loading }}</p>
            <p v-else-if="!files.length" class="empty">{{ D.empty }}</p>
            <ul v-else class="files-list">
              <li v-for="f in files" :key="keyOf(f)" :class="['files-row', { 'is-picked': picked.has(keyOf(f)), 'is-set': isSet(f) }]">
                <input v-if="current?.delete" type="checkbox" class="files-pick" :checked="picked.has(keyOf(f))" :aria-label="D.pick(f.name)"
                       @change="toggle(f)">
                <img v-if="f.thumb" class="files-thumb" :src="fileUrl(f.thumb)" alt="" loading="lazy">
                <span v-else class="files-thumb is-empty"><ui-icon :name="ICON[folder]" :size="20"/></span>
                <span class="files-main">
                  <button v-if="viewable(f)" class="files-name files-set" type="button" :title="D.setFile" @click="setFile(f)">{{ f.name }}</button>
                  <span v-else class="files-name" :title="f.name">{{ f.name }}</span>
                  <span v-if="isSet(f)" class="files-set-badge"><ui-icon name="check" :size="14"/>{{ D.isSet }}</span>
                  <span class="files-meta">{{ facts(f) }}</span>
                  <span v-if="f.tools?.length" class="files-tools">
                    <span v-for="t in f.tools" :key="t.tool" class="files-tool" :title="T.u1.head(t.tool + 1) + ': ' + t.type + (t.grams ? ' · ' + D.grams(t.grams) : '')">
                      <span class="files-dot" :style="{ background: t.colour || 'transparent' }"></span>{{ t.type }}</span>
                  </span>
                </span>
                <span class="files-actions">
                  <button v-if="folder === 'gcodes' && f.printable" class="btn" type="button" :disabled="busy" :title="busy ? D.busy(setup.state) : null"
                          @click="openPrint(f)"><ui-icon name="play"/>{{ D.print }}</button>
                  <template v-if="folder === 'gcodes' && /\.gcode$/i.test(pathOf(f))">
                    <a class="btn" :href="hashOf('druck3d', instId)" :title="D.view3d" @click.prevent="openView(f, 'druck3d')"><ui-icon name="cube"/>3D</a>
                    <a class="btn" :href="hashOf('druck2d', instId)" :title="D.view2d" @click.prevent="openView(f, 'druck2d')"><ui-icon name="toolpath"/>2D</a>
                  </template>
                  <a v-if="folder !== 'gcodes'" class="btn" :href="fileUrl(pathOf(f))" target="_blank" rel="noopener">{{ videos ? D.play : D.open }}</a>
                  <a class="btn btn-icon" :href="fileUrl(pathOf(f), true)" :title="D.download" :aria-label="D.download"><ui-icon name="download"/></a>
                </span>
              </li>
            </ul>
          </section>
        </template>
      </div>

      <print-panel v-if="printing" :camera="chosen" :model="ui.printer" :file="printing"
                   :picture="printing.picture ? fileUrl(printing.picture) : ''" @close="closePrint" @started="readSetup"/>
    </div>
  `,
};
