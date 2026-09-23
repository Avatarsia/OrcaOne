// One filament of an installation, picked from a list with search: a combobox for the pages
// "Details" and "Vergleichen". Headings as in the tree on "Filamente" (originGroup); own ones say
// what they derive from, the others their material. Typed words filter, in any order.
import { originGroup } from "../common.js";
import { T, plainName } from "../texts.js";

const { ref, computed, watch, nextTick } = Vue;
const D = T.details;

const shownName = (f) => f ? plainName(f.name) : "";

export default {
  name: "FilamentPicker",
  props: {
    inst: { type: Object, required: true },
    chosen: { type: Object, default: null },  // the record of GET /api/data
    id: { type: String, required: true },     // of the field; list and entries take it as prefix
    label: { type: String, required: true },
  },
  emits: ["pick"],  // with the filament's name

  setup(props, { emit }) {
    const query = ref(shownName(props.chosen));  // the chosen name, or what is typed
    const open = ref(false);
    const active = ref(0);                        // the entry the arrow keys are on
    watch(() => props.chosen, (f) => { query.value = shownName(f); });

    const subOf = (f) => f.origin_kind === "user" || f.origin_kind === "bundle"
      ? f.chain[0] ? D.derivedFrom(plainName(f.chain[0])) : D.root
      : f.material || "";
    // The chosen name standing in the field shows the whole list.
    const words = computed(() => query.value === shownName(props.chosen) ? [] : query.value.toLowerCase().split(/\s+/).filter(Boolean));
    const groups = computed(() => {
      const map = new Map();
      for (const f of props.inst.filaments) {
        const hay = `${f.name} ${f.vendor || ""} ${f.material || ""}`.toLowerCase();
        if (!words.value.every((w) => hay.includes(w))) continue;
        const g = originGroup(f);
        if (!map.has(g.key)) map.set(g.key, { ...g, items: [] });
        map.get(g.key).items.push({ f, name: plainName(f.name), sub: subOf(f) });
      }
      const list = [...map.values()].sort((a, b) => a.key.localeCompare(b.key, "de"));
      let idx = 0;
      for (const g of list) {
        g.items.sort((a, b) => a.name.localeCompare(b.name, "de"));
        for (const it of g.items) it.idx = idx++;
      }
      return list;
    });
    const flat = computed(() => groups.value.flatMap((g) => g.items));
    const optId = (idx) => `${props.id}-opt-${idx}`;

    function openList() {
      if (!open.value) active.value = Math.max(0, flat.value.findIndex((it) => it.f === props.chosen));
      open.value = true;
      nextTick(scrollToActive);
    }
    // A click or Tab into the field marks its text, so typing replaces it right away. The click
    // that brought the focus would put the caret in and undo that, so it marks again.
    let focusedAt = 0;
    function onFocus(ev) {
      focusedAt = Date.now();
      openList();
      ev.target.select();
    }
    function onClick(ev) {
      if (!open.value || Date.now() - focusedAt < 400) ev.target.select();
      openList();
    }
    function closeList() {
      open.value = false;
      query.value = shownName(props.chosen);
    }
    function pick(it) {
      open.value = false;
      emit("pick", it.f.name);
      // The field keeps the focus; its text marked, the next typing starts a new search.
      nextTick(() => document.getElementById(props.id)?.select());
    }
    function scrollToActive() {
      document.getElementById(optId(active.value))?.scrollIntoView({ block: "nearest" });
    }
    function onKey(ev) {
      if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
        ev.preventDefault();
        if (!open.value) return openList();
        const n = flat.value.length;
        if (n) active.value = (active.value + (ev.key === "ArrowDown" ? 1 : n - 1)) % n;
        nextTick(scrollToActive);
      } else if (ev.key === "Enter" && open.value && flat.value[active.value]) {
        ev.preventDefault();
        pick(flat.value[active.value]);
      } else if (ev.key === "Escape" && open.value) {
        ev.stopPropagation();
        closeList();
      }
    }
    function onInput() {
      open.value = true;
      active.value = 0;
    }

    return { D, query, open, active, groups, flat, optId, onFocus, onClick, closeList, pick, onKey, onInput };
  },

  template: `
    <div class="combo">
      <label class="combo-label" :for="id">{{ label }}</label>
      <span class="search">
        <ui-icon name="search"/>
        <input :id="id" v-model="query" class="input" type="text" role="combobox" autocomplete="off"
               aria-autocomplete="list" :aria-controls="id + '-list'" :aria-expanded="open ? 'true' : 'false'"
               :aria-activedescendant="open && flat[active] ? optId(active) : null" :placeholder="D.pickHint"
               @focus="onFocus" @click="onClick" @input="onInput" @keydown="onKey" @blur="closeList">
        <ui-icon name="chevronDown" class="combo-chev"/>
      </span>
      <div v-if="open" :id="id + '-list'" class="combo-list" role="listbox" :aria-label="label">
        <template v-for="g in groups" :key="g.key">
          <div class="combo-head" role="presentation">{{ g.label }}</div>
          <div v-for="it in g.items" :key="it.f.name" :id="optId(it.idx)" role="option"
               :aria-selected="chosen && chosen.name === it.f.name ? 'true' : 'false'"
               :class="['combo-opt', { 'is-active': it.idx === active }]" @mousedown.prevent="pick(it)" @mousemove="active = it.idx">
            <span class="combo-name">{{ it.name }}</span><small>{{ it.sub }}</small>
          </div>
        </template>
        <p v-if="!flat.length" class="combo-none">{{ D.noMatch }}</p>
      </div>
    </div>
  `,
};
