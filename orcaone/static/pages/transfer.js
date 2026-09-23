// Page "Übertragen": two installations side by side, profiles picked on one side and pushed to
// the other with the arrows, several at once. OrcaOne creates them there as own profiles with all
// their values (orcaone/transfer.py); what cannot go along, the plan names before anything is
// written. Filaments and processes; printers need more checks and come later.
// Queued copies go into the common change list like every other change (ops.js, profile_copy).
import { INSTANCES, ui, flash, onReset, originGroup, writeBlock, DECIMAL } from "../common.js";
import { T, plainName } from "../texts.js";
import { materialSpool } from "./filamente.js";

const { ref, reactive, computed, watch } = Vue;
const X = T.transfer;

// Copies waiting for "Übernehmen": { from, to, kind, name }, name as in the source. Empty after
// every load and after "Verwerfen", like the switches of the page "Filamente".
export const queued = reactive([]);
onReset(() => queued.splice(0));
export const transferChanges = computed(() => queued.map((q) => {
  const to = INSTANCES.find((i) => i.id === q.to), from = INSTANCES.find((i) => i.id === q.from);
  return to && from ? { inst: to, page: "transfer", type: "copy", name: plainName(q.name), where: X.fromSlicer(from.slicer) } : null;
}).filter(Boolean));

// The same profile on the other side, whatever its suffix: "Elegoo PLA @System", "Elegoo PLA
// (Orca)" and "Elegoo PLA (Orca) (2)" are one.
const matchKey = (name) => plainName(name).replace(/\s+@.*$/, "").replace(/(\s+\((?:Orca|SnOrca|\d+)\))+$/, "").trim().toLowerCase();
const fmt = (v) => isNaN(Number(v)) ? String(v) : Number(v).toFixed(2).replace(".", DECIMAL);
// "@System" says nothing in the list, the heading tells where a profile comes from.
const shownName = (name) => plainName(name).replace(/ @(System|base)$/, "");
const GROUP_ICON = { user: "user", bundle: "package", vendor: "factory", library: "books" };
// The name a copy gets in the target, as orcaone/transfer.py gives it: an own profile keeps its
// name, a system profile gets its source in brackets. Only for the list; a clash with a name the
// target has already ends in "(2)", which the plan shows.
const SHORT = { Snapmaker_Orca: "SnOrca", OrcaSlicer: "Orca" };
const copyName = (p, from) => p.origin_kind === "user" ? p.name
  : `${p.name.replace(/ @(System|base)$/, "")} (${SHORT[from.app_key] || from.slicer})`;

export default {
  name: "TransferPage",
  props: { instId: { type: String, required: true } },

  setup(props) {
    // Left the installation chosen in the top bar, right another one, of the other slicer if there is.
    const other = (id) => (INSTANCES.find((i) => i.id !== id && i.slicer !== INSTANCES.find((x) => x.id === id)?.slicer)
      || INSTANCES.find((i) => i.id !== id))?.id || null;
    const leftId = ref(props.instId);
    const rightId = ref(other(props.instId));
    watch(leftId, (id) => { if (id === rightId.value) rightId.value = other(id); });
    watch(rightId, (id) => { if (id === leftId.value) leftId.value = other(id); });
    const left = computed(() => INSTANCES.find((i) => i.id === leftId.value));
    const right = computed(() => INSTANCES.find((i) => i.id === rightId.value));
    function swap() {
      [leftId.value, rightId.value] = [rightId.value, leftId.value];
    }

    const kind = ref("filament");
    const query = ref("");
    const onlyMissing = ref(true);
    const chosen = reactive({ left: new Set(), right: new Set() });
    // Groups open per side: at first only the own profiles ("0", originGroup). While searching,
    // every group with hits is open unless closed by hand, as in the tree on "Filamente".
    const OWN = "0";
    const expanded = reactive({ left: new Set([OWN]), right: new Set([OWN]) });
    const collapsed = reactive({ left: new Set(), right: new Set() });
    watch([kind, leftId, rightId], () => {
      for (const k of ["left", "right"]) {
        chosen[k].clear();
        expanded[k] = new Set([OWN]);
        collapsed[k].clear();
      }
    });
    const searching = computed(() => query.value.trim() !== "");
    watch(query, () => { collapsed.left.clear(); collapsed.right.clear(); });
    const isOpen = (key, g) => searching.value ? !collapsed[key].has(g.key) : expanded[key].has(g.key);
    function toggleOpen(key, g) {
      const set = searching.value ? collapsed[key] : expanded[key];
      set.has(g.key) ? set.delete(g.key) : set.add(g.key);
    }
    const chosenIn = (key, g) => g.rows.filter((r) => chosen[key].has(r.p.name)).length;

    // What each side offers: filaments and processes the slicer loads, no way-B helper.
    const profilesOf = (inst) => !inst ? [] : kind.value === "filament"
      ? inst.filaments.filter((f) => !f.status && !f.helper)
      : inst.processes;
    // The profile of the other side each match key stands for, named in the tooltip.
    const namesOf = (inst) => {
      const map = new Map();
      for (const p of profilesOf(inst)) if (!map.has(matchKey(p.name))) map.set(matchKey(p.name), shownName(p.name));
      return map;
    };
    function side(inst, otherInst, key) {
      const there = namesOf(otherInst);
      const words = query.value.toLowerCase().split(/\s+/).filter(Boolean);
      const map = new Map();
      const matches = (p, name) => words.every((w) => `${name} ${p.vendor || ""} ${p.material || ""}`.toLowerCase().includes(w));
      // Copies queued for this side show where they will land: among the own profiles, first,
      // whatever the filter "Nur was drüben fehlt" says.
      let incoming = 0;
      for (const q of queued) {
        if (q.to !== inst.id || q.kind !== kind.value) continue;
        const from = INSTANCES.find((i) => i.id === q.from);
        const p = from && profilesOf(from).find((x) => x.name === q.name);
        if (!p) continue;
        incoming++;
        const name = copyName(p, from);
        if (!matches(p, name)) continue;
        if (!map.has("0")) map.set("0", { key: "0", label: T.filaments.kinds.user, icon: "user", rows: [] });
        map.get("0").rows.push({
          p, name: plainName(name), pending: from, fresh: q.fresh,
          colour: kind.value === "filament" ? materialSpool(p.material) : null,
          layer: kind.value === "filament" ? "" : fmt(p.layer_height), sub: X.comesFrom(from.slicer),
        });
      }
      for (const p of profilesOf(inst)) {
        const exists = there.has(matchKey(p.name));
        if (onlyMissing.value && exists) continue;
        if (!matches(p, p.name)) continue;
        const g = originGroup(p);
        if (!map.has(g.key)) map.set(g.key, { ...g, icon: GROUP_ICON[p.origin_kind], rows: [] });
        const q = queued.find((x) => x.from === inst.id && x.kind === kind.value && x.name === p.name);
        const filament = kind.value === "filament";
        map.get(g.key).rows.push({
          p, name: shownName(p.name), twin: exists ? there.get(matchKey(p.name)) : "",
          queued: q ? INSTANCES.find((i) => i.id === q.to) : null,
          colour: filament ? materialSpool(p.material) : null, layer: filament ? "" : fmt(p.layer_height),
          sub: filament ? [p.vendor, p.material].filter(Boolean).join(" · ") : "",
        });
      }
      const groups = [...map.values()].sort((a, b) => a.key.localeCompare(b.key, "de"));
      for (const g of groups) g.rows.sort((a, b) => !!b.pending - !!a.pending || a.name.localeCompare(b.name, "de"));
      const count = groups.reduce((n, g) => n + g.rows.filter((r) => !r.pending).length, 0);
      return { key, inst, groups, count, incoming, empty: !groups.length };
    }
    const sides = computed(() => [side(left.value, right.value, "left"), side(right.value, left.value, "right")]);

    function toggle(key, name) {
      const set = chosen[key];
      set.has(name) ? set.delete(name) : set.add(name);
    }
    // What a click can pick: neither queued already nor a copy on its way in.
    const pickable = (g) => g.rows.filter((r) => !r.queued && !r.pending).map((r) => r.p.name);
    function toggleGroup(key, g) {
      const names = pickable(g);
      const all = names.every((n) => chosen[key].has(n));
      for (const n of names) all ? chosen[key].delete(n) : chosen[key].add(n);
    }
    const groupState = (key, g) => {
      const names = pickable(g);
      const on = names.filter((n) => chosen[key].has(n)).length;
      return on === 0 ? "false" : on === names.length ? "true" : "mixed";
    };

    // Pushing needs a target OrcaOne may write to; the plan checks again.
    const blockOf = (inst) => inst ? writeBlock(inst) : "same_installation";
    const blockText = (inst) => {
      const text = T.blocked[blockOf(inst)];
      return text ? text(inst, {}) : "";
    };
    function push(from, to, key) {
      const names = [...chosen[key]];
      // fresh: the copy lights up once in the other list.
      for (const q of queued) delete q.fresh;
      for (const name of names) {
        if (!queued.some((q) => q.from === from.id && q.to === to.id && q.kind === kind.value && q.name === name)) {
          queued.push({ from: from.id, to: to.id, kind: kind.value, name, fresh: true });
        }
      }
      chosen[key].clear();
      // The copies land among the own profiles over there: that group opens.
      const there = key === "left" ? "right" : "left";
      expanded[there].add(OWN);
      collapsed[there].delete(OWN);
      flash(X.queuedFlash(names.length, to.slicer));
    }
    function unqueue(from, name) {
      const idx = queued.findIndex((q) => q.from === from.id && q.kind === kind.value && q.name === name);
      if (idx >= 0) queued.splice(idx, 1);
    }

    return {
      T, X, INSTANCES, ui, leftId, rightId, left, right, swap, kind, query, onlyMissing, chosen, sides,
      toggle, toggleGroup, groupState, pickable, isOpen, toggleOpen, chosenIn, blockOf, blockText, push, unqueue,
    };
  },

  template: `
    <div class="page transfer-page">
      <h1 id="page-title" tabindex="-1">{{ X.title }}</h1>
      <p class="note">{{ X.lead }}</p>

      <p v-if="INSTANCES.length < 2" class="empty">{{ X.needTwo }}</p>
      <template v-else>
        <section class="box xfer-pick">
          <label class="xfer-inst">
            <span class="combo-label">{{ X.from }}</span>
            <select v-model="leftId" class="input">
              <option v-for="i in INSTANCES" :key="i.id" :value="i.id">{{ i.slicer }} {{ i.version }} · {{ i.path }}</option>
            </select>
          </label>
          <button class="xfer-swap" type="button" :title="X.swap" :aria-label="X.swap" @click="swap"><ui-icon name="transfer" :size="22"/></button>
          <label class="xfer-inst">
            <span class="combo-label">{{ X.to }}</span>
            <select v-model="rightId" class="input">
              <option v-for="i in INSTANCES" :key="i.id" :value="i.id">{{ i.slicer }} {{ i.version }} · {{ i.path }}</option>
            </select>
          </label>
        </section>

        <div class="toolbar xfer-tools">
          <div class="chips" role="group" :aria-label="X.kindLabel">
            <button v-for="k in ['filament', 'process']" :key="k" type="button" class="chip" :aria-pressed="kind === k" @click="kind = k">
              <ui-icon :name="k === 'filament' ? 'spool' : 'layers'" :size="16"/>{{ X.kinds[k] }}
            </button>
          </div>
          <label class="search">
            <ui-icon name="search"/>
            <input v-model="query" class="input" type="search" autocomplete="off" :placeholder="X.search" :aria-label="X.search">
          </label>
          <button type="button" class="xfer-toggle" role="switch" :aria-checked="onlyMissing ? 'true' : 'false'" @click="onlyMissing = !onlyMissing">
            <span class="switch" aria-hidden="true"></span>{{ X.onlyMissing }}
          </button>
        </div>

        <div class="xfer-cols">
          <template v-for="(s, n) in sides" :key="s.key">
            <section class="xfer-side" :aria-label="s.inst.slicer">
              <div class="xfer-side-head">
                <div class="xfer-side-title"><strong>{{ s.inst.slicer }}</strong><span class="version">{{ s.inst.version }}</span></div>
                <run-status :inst="s.inst"/>
              </div>
              <p class="xfer-side-sub">{{ onlyMissing ? X.missingThere(s.count) : X.shown(s.count) }}<span v-if="s.incoming" class="xfer-incoming"> · {{ X.incoming(s.incoming) }}</span></p>
              <div class="xfer-list">
                <template v-for="g in s.groups" :key="g.key">
                  <div class="xfer-group">
                    <input type="checkbox" :checked="groupState(s.key, g) === 'true'" :indeterminate="groupState(s.key, g) === 'mixed'"
                           :disabled="!pickable(g).length" :aria-label="X.allOf(g.label)" :title="X.allOf(g.label)" @change="toggleGroup(s.key, g)">
                    <button class="xfer-group-head" type="button" :aria-expanded="isOpen(s.key, g) ? 'true' : 'false'" @click="toggleOpen(s.key, g)">
                      <ui-icon name="chevron" class="chev"/>
                      <span class="xfer-group-icon"><ui-icon :name="g.icon" :size="16"/></span>
                      <span class="xfer-group-label">{{ g.label }}</span>
                      <span v-if="chosenIn(s.key, g)" class="xfer-group-chosen">{{ X.chosenIn(chosenIn(s.key, g)) }}</span>
                      <span class="xfer-group-count">{{ g.rows.length }}</span>
                    </button>
                  </div>
                  <template v-for="r in (isOpen(s.key, g) ? g.rows : [])" :key="(r.pending ? 'in:' : '') + r.p.name">
                  <div v-if="r.pending" :class="['xfer-row', 'is-pending', { 'is-fresh': r.fresh }]">
                    <span class="xfer-in"><ui-icon :name="s.key === 'right' ? 'arrowRight' : 'arrowLeft'" :size="14"/></span>
                    <spool-icon v-if="r.colour" :colour="r.colour" :size="26"/>
                    <span v-else class="xfer-layer">{{ r.layer }}<small>mm</small></span>
                    <span class="xfer-text">
                      <span class="xfer-name" :title="r.name">{{ r.name }}</span>
                      <span class="xfer-sub">{{ r.sub }}</span>
                    </span>
                    <span class="xfer-badges">
                      <span class="xfer-new">{{ X.newHere }}</span>
                      <button class="icon-btn xfer-cancel" type="button" :title="X.cancelCopy" :aria-label="X.cancelCopy" @click="unqueue(r.pending, r.p.name)"><ui-icon name="close" :size="16"/></button>
                    </span>
                  </div>
                  <label v-else :class="['xfer-row', { 'is-chosen': chosen[s.key].has(r.p.name), 'is-queued': r.queued }]">
                    <input type="checkbox" :checked="chosen[s.key].has(r.p.name)" :disabled="!!r.queued" @change="toggle(s.key, r.p.name)">
                    <spool-icon v-if="r.colour" :colour="r.colour" :size="26"/>
                    <span v-else class="xfer-layer">{{ r.layer }}<small>mm</small></span>
                    <span class="xfer-text">
                      <span class="xfer-name" :title="r.p.name">{{ r.name }}</span>
                      <span v-if="r.sub" class="xfer-sub">{{ r.sub }}</span>
                    </span>
                    <span class="xfer-badges">
                      <span v-if="r.p.high_flow" class="xfer-hf" :title="X.highFlow"><ui-icon name="bolt" :size="13"/>HF</span>
                      <span v-if="r.twin" class="xfer-there" :title="X.thereAs(r.twin)"><ui-icon name="checkCircle" :size="18"/></span>
                      <button v-if="r.queued" class="xfer-queued" type="button" :title="X.queuedFor(r.queued.slicer)" @click.prevent="unqueue(s.inst, r.p.name)">
                        <ui-icon :name="s.key === 'left' ? 'arrowRight' : 'arrowLeft'" :size="14"/>{{ X.queued }}
                      </button>
                    </span>
                  </label>
                  </template>
                </template>
                <div v-if="s.empty" class="xfer-empty">
                  <ui-icon :name="onlyMissing ? 'checkCircle' : 'search'" :size="30"/>
                  <p>{{ onlyMissing ? X.nothingMissing : X.none }}</p>
                </div>
              </div>
            </section>
            <div v-if="n === 0" class="xfer-mid">
              <button class="xfer-arrow" type="button" :disabled="!chosen.left.size || !!blockOf(right)"
                      :title="blockText(right) || X.pushTo(right.slicer)" :aria-label="X.pushTo(right.slicer)" @click="push(left, right, 'left')">
                <ui-icon name="arrowRight" :size="26"/>
                <span v-if="chosen.left.size" class="xfer-count">{{ chosen.left.size }}</span>
              </button>
              <span class="xfer-arrow-label">{{ X.toSlicer(right.slicer) }}</span>
              <button class="xfer-arrow" type="button" :disabled="!chosen.right.size || !!blockOf(left)"
                      :title="blockText(left) || X.pushTo(left.slicer)" :aria-label="X.pushTo(left.slicer)" @click="push(right, left, 'right')">
                <ui-icon name="arrowLeft" :size="26"/>
                <span v-if="chosen.right.size" class="xfer-count">{{ chosen.right.size }}</span>
              </button>
              <span class="xfer-arrow-label">{{ X.toSlicer(left.slicer) }}</span>
            </div>
          </template>
        </div>

        <div class="xfer-legend">
          <span><ui-icon name="checkCircle" :size="16" class="xfer-there"/>{{ X.legendThere }}</span>
          <span><span class="xfer-hf"><ui-icon name="bolt" :size="13"/>HF</span>{{ X.legendHf }}</span>
          <span><ui-icon name="info" :size="16"/>{{ X.note }}</span>
        </div>
      </template>
    </div>
  `,
};
