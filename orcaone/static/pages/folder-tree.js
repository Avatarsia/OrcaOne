// The folder tree of the page "Dateien" (the user's wish of 27.09.2026: one tree to choose from instead
// of four chips, a path bar and folder rows, "verwirrend und angeklatscht"): Moonraker's roots, the
// folders of "gcodes" read when a folder is opened, those of "logs" and "config" from their flat list.
// The same tree chooses the folder shown and, on "Verschieben nach …", where to move to.
import { T } from "../texts.js";
import { api } from "../api.js";

const { reactive, computed, watch } = Vue;
const D = T.files;
export const ICON = { gcodes: "file", camera: "camera", logs: "log", config: "gear" };
const keyOf = (folder, path) => `${folder}:${path}`;
const inside = (path, folder) => path === folder || path.startsWith(folder + "/");

export default {
  name: "FolderTree",
  props: {
    model: { type: String, required: true },
    roots: { type: Array, required: true },        // [{ name, delete }] as the page read them
    shown: { type: Object, default: null },        // { folder, path }: marked, the way to it open
    chosen: { type: Object, default: null },       // { folder, path }: the target chosen to move to
    printing: { type: String, default: null },     // the path in "gcodes" of the file printing
    printTag: { type: String, default: "" },       // its word: druckt or pausiert
    here: { type: String, default: null },         // the folder moved from: marked, not a target
    blocked: { type: Array, default: () => [] },   // folders being moved: neither they nor what is in them
    known: { type: Object, default: null },        // { folder, path, dirs }: the page's list, not asked again
  },
  emits: ["choose"],

  setup(props, { emit }) {
    // Per folder its subfolders: undefined not read yet, null while reading, else [{ name, path }].
    const kids = reactive({});
    const flat = reactive({});    // logs and config: all paths of the root's flat list
    const open = reactive({});

    function childrenOf(folder, path) {
      if (folder === "camera") return [];
      if (folder === "gcodes") return kids[keyOf(folder, path)];
      if (flat[folder] === undefined || flat[folder] === null) return flat[folder];
      // The folders one level below path, from the paths of the files; hidden ones (.name) left out.
      const prefix = path ? path + "/" : "";
      const names = new Set();
      for (const p of flat[folder]) {
        if (!p.startsWith(prefix)) continue;
        const rest = p.slice(prefix.length).split("/");
        if (rest.length > 1 && !rest[0].startsWith(".")) names.add(rest[0]);
      }
      return [...names].sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }))
        .map((name) => ({ name, path: prefix + name }));
    }
    async function load(folder, path) {
      if (childrenOf(folder, path) !== undefined) return;
      if (folder === "gcodes") {
        kids[keyOf(folder, path)] = null;
        try {
          kids[keyOf(folder, path)] = ((await api.printerFiles(props.model, folder, path)).dirs || []).map((d) => ({ name: d.name, path: d.path }));
        } catch {
          kids[keyOf(folder, path)] = [];
        }
      } else {
        flat[folder] = null;
        try {
          flat[folder] = ((await api.printerFiles(props.model, folder)).files || []).map((f) => f.path || f.name);
        } catch {
          flat[folder] = [];
        }
      }
    }
    function toggle(row) {
      open[row.key] = !row.open;
      if (!row.open) load(row.folder, row.path);
    }
    // The way to the folder shown (or chosen) open, its parts read.
    function openTo(where) {
      if (!where) return;
      const parts = where.path ? where.path.split("/") : [];
      for (let i = 0; i <= parts.length - (parts.length ? 1 : 0); i++) {
        const path = parts.slice(0, i).join("/");
        open[keyOf(where.folder, path)] = true;
        load(where.folder, path);
      }
    }
    watch(() => props.known, (k) => {
      if (k?.folder === "gcodes") kids[keyOf("gcodes", k.path)] = k.dirs.map((d) => ({ name: d.name, path: d.path }));
    }, { immediate: true });
    openTo(props.shown || { folder: "gcodes", path: "" });

    const rows = computed(() => {
      const out = [];
      const row = (folder, path, name, depth, root) => {
        const key = keyOf(folder, path), list = childrenOf(folder, path);
        const off = folder === "gcodes" && (props.here === path || props.blocked.some((b) => inside(path, b)));
        out.push({
          key, folder, path, name, depth, open: !!open[key], loading: list === null && !!open[key],
          expandable: folder !== "camera" && (list === undefined || list === null || list.length > 0),
          readOnly: !!root && !root.delete, off, here: folder === "gcodes" && props.here === path,
          printing: folder === "gcodes" && !!props.printing && (!path || props.printing.startsWith(path + "/")),
          shown: props.shown?.folder === folder && props.shown.path === path,
          chosen: props.chosen?.folder === folder && props.chosen.path === path,
        });
        if (open[key] && Array.isArray(list)) for (const c of list) row(folder, c.path, c.name, depth + 1, null);
      };
      for (const r of props.roots) row(r.name, "", D.folders[r.name] || r.name, 0, r);
      return out;
    });
    const choose = (r) => { if (!r.off) emit("choose", { folder: r.folder, path: r.path }); };

    return { T, D, ICON, rows, toggle, choose };
  },

  template: `
    <ul class="files-tree" role="tree" :aria-label="D.treeLabel">
      <li v-for="r in rows" :key="r.key" role="treeitem" :aria-level="r.depth + 1" :aria-expanded="r.expandable ? String(r.open) : null"
          :aria-selected="r.shown || r.chosen ? 'true' : 'false'"
          :class="['files-tree-row', { 'is-shown': r.shown, 'is-chosen': r.chosen, 'is-off': r.off }]" :style="{ '--depth': r.depth }">
        <button v-if="r.expandable" class="files-tree-toggle" type="button" :aria-label="(r.open ? D.treeClose : D.treeOpen)(r.name)"
                @click="toggle(r)"><ui-icon name="chevron" :size="14" :class="{ 'is-open': r.open }"/></button>
        <span v-else class="files-tree-toggle"></span>
        <button class="files-tree-name" type="button" :disabled="r.off" @click="choose(r)">
          <ui-icon :name="r.depth ? 'folder' : ICON[r.folder]" :size="16"/><span>{{ r.name }}</span></button>
        <span v-if="r.loading" class="files-tree-note">{{ T.loading }}</span>
        <span v-if="r.here" class="files-tree-note">{{ D.here }}</span>
        <span v-if="r.printing" class="files-tree-tag is-printing">{{ printTag }}</span>
        <span v-if="r.readOnly" class="files-tree-tag" :title="D.readOnlyNote"><ui-icon name="lock" :size="12"/>{{ D.readOnly }}</span>
      </li>
    </ul>
  `,
};
