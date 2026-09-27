// The folder tree of "Verschieben nach …" on the page "Dateien": the folders of "Druckdateien", each
// read when it is opened, to choose where to move to (the page itself shows its folders as tabs and a
// table since 27.09.2026).
import { T } from "../texts.js";
import { api } from "../api.js";

const { reactive, computed, watch } = Vue;
const D = T.files;
const inside = (path, folder) => path === folder || path.startsWith(folder + "/");

export default {
  name: "FolderTree",
  props: {
    model: { type: String, required: true },
    here: { type: String, default: "" },           // the folder moved from: open, marked, not a target
    chosen: { type: String, default: null },       // the target chosen, "" for the top
    printing: { type: String, default: null },     // the path of the file printing
    printTag: { type: String, default: "" },       // its word: druckt or pausiert
    blocked: { type: Array, default: () => [] },   // folders being moved: neither they nor what is in them
    known: { type: Object, default: null },        // { path, dirs }: the page's list, not asked again
  },
  emits: ["choose"],

  setup(props, { emit }) {
    // Per folder its subfolders: undefined not read yet, null while reading, else [{ name, path }].
    const kids = reactive({});
    const open = reactive({});

    async function load(path) {
      if (kids[path] !== undefined) return;
      kids[path] = null;
      try {
        kids[path] = ((await api.printerFiles(props.model, "gcodes", path)).dirs || []).map((d) => ({ name: d.name, path: d.path }));
      } catch {
        kids[path] = [];
      }
    }
    function toggle(row) {
      open[row.path] = !row.open;
      if (!row.open) load(row.path);
    }
    watch(() => props.known, (k) => {
      if (k) kids[k.path] = k.dirs.map((d) => ({ name: d.name, path: d.path }));
    }, { immediate: true });
    // The way to the folder moved from open, its parts read.
    const parts = props.here ? props.here.split("/") : [];
    for (let i = 0; i <= parts.length - (parts.length ? 1 : 0); i++) {
      const path = parts.slice(0, i).join("/");
      open[path] = true;
      load(path);
    }

    const rows = computed(() => {
      const out = [];
      const row = (path, name, depth) => {
        const list = kids[path];
        out.push({
          path, name, depth, open: !!open[path], loading: list === null && !!open[path],
          expandable: list === undefined || list === null || list.length > 0,
          here: props.here === path, off: props.here === path || props.blocked.some((b) => inside(path, b)),
          printing: !!props.printing && (!path || props.printing.startsWith(path + "/")), chosen: props.chosen === path,
        });
        if (open[path] && Array.isArray(list)) for (const c of list) row(c.path, c.name, depth + 1);
      };
      row("", D.folders.gcodes, 0);
      return out;
    });
    const choose = (r) => { if (!r.off) emit("choose", r.path); };

    return { T, D, rows, toggle, choose };
  },

  template: `
    <ul class="files-tree" role="tree" :aria-label="D.moveChoose">
      <li v-for="r in rows" :key="r.path" role="treeitem" :aria-level="r.depth + 1" :aria-expanded="r.expandable ? String(r.open) : null"
          :aria-selected="r.chosen ? 'true' : 'false'"
          :class="['files-tree-row', { 'is-shown': r.here, 'is-chosen': r.chosen, 'is-off': r.off }]" :style="{ '--depth': r.depth }">
        <button v-if="r.expandable" class="files-tree-toggle" type="button" :aria-label="(r.open ? D.treeClose : D.treeOpen)(r.name)"
                @click="toggle(r)"><ui-icon name="chevron" :size="14" :class="{ 'is-open': r.open }"/></button>
        <span v-else class="files-tree-toggle"></span>
        <button class="files-tree-name" type="button" :disabled="r.off" @click="choose(r)">
          <ui-icon :name="r.depth ? 'folder' : 'file'" :size="16"/><span>{{ r.name }}</span></button>
        <span v-if="r.loading" class="files-tree-note">{{ T.loading }}</span>
        <span v-if="r.here" class="files-tree-note">{{ D.here }}</span>
        <span v-if="r.printing" class="files-tree-tag">{{ printTag }}</span>
      </li>
    </ul>
  `,
};
