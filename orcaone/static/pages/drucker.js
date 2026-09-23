// Page "Drucker": one card per printer model of a manufacturer and per own printer. Here the
// user picks the printer the slicer starts with and removes printers, together with the own
// filaments and processes that belong to that printer only. Each action opens the side panel
// with the plan first (hard rule 5); its button puts the plan into the change list (app.js).
// Data: instances[].printers_page of GET /api/data; the changeable state is `live` in common.js,
// so what goes here shows up on "Filamente", too. ops.js turns it into printer_model_off,
// printer_delete, filament_delete, default_printer and cleanup_presets.
// Removing the last model of a vendor can make the slicer delete the whole vendor package at its
// next start (FINDINGS 4.2); the plan says so and names the own printers that go with it.
import {
  INSTANCES, live, flash, go, hashOf, plural, nozzleLabel, printerShortName, printerText, profileSub, KIND_ICON,
} from "../common.js";
import { T, plainName } from "../texts.js";

const { ref, reactive, computed, watch, nextTick, onMounted, onUnmounted } = Vue;

const P = T.printers;

export default {
  name: "DruckerPage",
  props: { instId: { type: String, required: true } },

  setup(props) {
    const inst = computed(() => INSTANCES.find((i) => i.id === props.instId));
    const state = computed(() => live[props.instId]);
    const readOnly = computed(() => !!inst.value.running);

    // ------------------------------------------------------------ cards
    const cards = computed(() => {
      const i = inst.value, s = state.value, pp = i.printers_page;
      const mine = (list) => list.filter((x) => s.own.has(x.name));
      const out = [];
      for (const m of pp.system) {
        if (!s.models.has(m.model)) continue;
        const name = printerShortName(m.printers[0]?.name || m.model);
        out.push({
          id: "model:" + m.model, system: true, model: m.model, name, label: name, sub: name === m.model ? "" : m.model,
          cover: m.cover, printers: m.printers, tag: P.tags.vendor, tagIcon: "factory",
          visible: true, problem: null, package: m.origin, dropsPackage: m.drops_package,
          isDefault: m.printers.some((p) => p.name === s.defaultPrinter),
          // Own processes go only together with an own printer (printer_delete in ops.js), so a
          // model of a manufacturer offers the own filaments alone.
          onlyHere: mine(m.only_here).filter((x) => x.kind === "filament"), keepsOwn: m.own_printers.filter((n) => s.own.has(n)),
        });
      }
      for (const p of pp.own) {
        if (!s.own.has(p.name)) continue;
        const project = p.origin === "project", bundle = p.origin === "bundle";
        // Its template sits in a vendor package the slicer deletes at its next start.
        const packageGone = !!p.package && !s.packages.has(p.package);
        const visible = p.visible && !packageGone;
        const problem = T.profileProblems[p.problem];
        out.push({
          id: "own:" + p.name, system: false, model: p.model, name: p.name, label: plainName(p.name), bundle,
          sub: p.based_on ? T.filaments.template(p.based_on_found ? printerText(i, p.based_on) : p.based_on) : "",
          cover: p.cover, printers: visible ? [{ name: p.name, variant: p.variant }] : [],
          tag: bundle ? p.bundle : project ? T.printerOrigins.project : P.tags.own,
          tagIcon: bundle ? "package" : project ? "file" : "user",
          visible, package: p.package, unresolved: p.status === "unresolved",
          problem: packageGone ? P.packageGone(p.package) : problem ? problem(p) : null,
          isDefault: p.name === s.defaultPrinter, onlyHere: mine(p.only_here), keepsOwn: [],
        });
      }
      return out;
    });
    const nozzlesOf = (c) => c.printers.filter((p) => p.variant);
    const nozzleList = (c) => nozzlesOf(c).map((p) => nozzleLabel(p.variant)).join(" · ");

    // Removing the last model of a vendor: SnOrca and Orca up to 2.4.2 delete its package at the
    // next start, own printers on top of it become invisible (FINDINGS 4.2).
    function dropsPackage(c) {
      if (!c.system || !c.dropsPackage) return false;
      const s = state.value;
      return !inst.value.printers_page.system.some((m) => m.model !== c.model && m.origin === c.package && s.models.has(m.model));
    }
    const lostOwn = (c) => dropsPackage(c) ? cards.value.filter((x) => !x.system && x.visible && x.package === c.package) : [];
    // What stays visible without c; at least one printer stays.
    const restOf = (c) => {
      const lost = new Set(lostOwn(c).map((x) => x.id));
      return cards.value.filter((x) => x.id !== c.id && x.visible && !lost.has(x.id));
    };
    const locked = (c) => c.visible && restOf(c).length < 1;

    const defaultCard = computed(() => cards.value.find((c) => c.isDefault) || null);
    const defaultText = computed(() => state.value.defaultPrinter ? printerText(inst.value, state.value.defaultPrinter) : P.noDefault);

    // When the default printer goes, the slicer starts with another one; OrcaOne names it in the plan.
    function nextDefault(card) {
      const rest = restOf(card).filter((c) => c.printers.length);
      if (!rest.length) return null;
      const c = rest[0];
      return (c.printers.find((p) => p.variant === "0.4") || c.printers[0]).name;
    }

    // ------------------------------------------------------------ clean up
    // "orca_presets" keeps the last choice per printer and is never cleaned up (FINDINGS 4.3, 4.9).
    const dead = computed(() => inst.value.printers_page.dead_entries.filter((d) => state.value.dead.includes(d.machine)));
    const remembered = computed(() => {
      const pp = inst.value.printers_page;
      return pp.remembered - (pp.dead_entries.length - dead.value.length);
    });
    function clean() {
      if (readOnly.value || !dead.value.length) return;
      state.value.dead = [];
      flash(P.queued.clean);
    }

    // ------------------------------------------------------------ panel
    const panel = ref(null);  // { type: "default" | "remove", id }
    const choice = ref("");
    const along = reactive(new Set());
    let lastFocus = null;
    const pcard = computed(() => panel.value && cards.value.find((c) => c.id === panel.value.id) || null);

    function openPanel(p) {
      if (!panel.value) lastFocus = document.activeElement;
      panel.value = p;
      nextTick(() => document.getElementById("panel-title")?.focus());
    }
    function closePanel() {
      panel.value = null;
      // The card may be gone after removing it; then the page title takes the focus.
      const target = lastFocus && document.contains(lastFocus) ? lastFocus : document.getElementById("page-title");
      target?.focus();
      lastFocus = null;
    }
    watch(() => props.instId, () => { panel.value = null; lastFocus = null; });

    function openDefault(c) {
      if (readOnly.value || !c.printers.length) return;
      const s = state.value;
      choice.value = (c.printers.find((p) => p.name === s.defaultPrinter)
        || c.printers.find((p) => p.variant === "0.4") || c.printers[0]).name;
      openPanel({ type: "default", id: c.id });
    }
    function setDefault() {
      const s = state.value;
      if (readOnly.value || !choice.value || choice.value === s.defaultPrinter) return;
      s.defaultPrinter = choice.value;
      closePanel();
      flash(P.queued.default(printerText(inst.value, choice.value)));
    }

    // Own profiles that belong to this printer only are ticked, unless an own printer built on it
    // stays: it may still use them (FINDINGS 4.6, compatibility over the direct parent).
    function openRemove(c) {
      if (readOnly.value || locked(c) || c.bundle) return;
      along.clear();
      if (!c.keepsOwn.length) c.onlyHere.forEach((x) => along.add(x.name));
      openPanel({ type: "remove", id: c.id });
    }
    const toggleAlong = (name) => along.has(name) ? along.delete(name) : along.add(name);
    const plan = computed(() => {
      const c = pcard.value;
      if (!c || !panel.value || panel.value.type !== "remove") return [];
      const out = [];
      const drops = dropsPackage(c);
      if (c.system) {
        // SnOrca switches all nozzles of a model back on at start, so only whole models go (FINDINGS 12).
        out.push({ icon: "minus", cls: "ch-off", name: c.name, verb: P.plan.switchedOff, sub: P.plan.allNozzles(nozzleList(c), drops) });
      } else {
        out.push({ icon: "trash", cls: "ch-delete", name: c.name, verb: P.plan.deleted, sub: P.plan.fileGoes });
      }
      if (drops) {
        out.push({ icon: "factory", cls: "ch-delete", name: P.plan.packageName(c.package), verb: P.plan.packageDeleted, sub: P.plan.packageWhy });
      }
      if (c.isDefault) {
        const next = nextDefault(c);
        if (next) out.push({ icon: "star", cls: "ch-on", name: printerText(inst.value, next), verb: P.plan.becomesDefault, sub: P.plan.startsWith });
      }
      if (drops) {
        for (const x of lostOwn(c)) out.push({ icon: "user", cls: "ch-delete", name: x.name, verb: P.plan.invisible, sub: P.plan.invisibleWhy });
      } else {
        // Own printers built on a model stay visible without it (Preset::set_visible_from_appconfig
        // leaves profiles without vendor alone). The ticked profiles below are part of the plan, too.
        for (const n of c.keepsOwn) out.push({ icon: "user", cls: "ch-on", name: n, verb: P.plan.stays, sub: P.plan.staysWhy });
      }
      return out;
    });
    function remove() {
      const c = pcard.value, s = state.value;
      if (!c || readOnly.value || locked(c)) return;
      const next = c.isDefault ? nextDefault(c) : null, drops = dropsPackage(c);
      if (c.system) s.models.delete(c.model);
      else s.own.delete(c.name);
      if (drops) s.packages.delete(c.package);
      for (const n of along) s.own.delete(n);
      if (next) s.defaultPrinter = next;
      const name = c.name, system = c.system;
      closePanel();
      flash(system ? P.queued.remove(name) : P.queued.delete(name));
    }

    const panelTitle = computed(() => {
      if (!panel.value) return "";
      if (panel.value.type === "default") return P.setDefault;
      return pcard.value && !pcard.value.system ? P.deleteTitle : P.removeTitle;
    });

    const onKey = (ev) => { if (ev.key === "Escape" && panel.value) closePanel(); };
    onMounted(() => window.addEventListener("keydown", onKey));
    onUnmounted(() => window.removeEventListener("keydown", onKey));

    return {
      T, P, KIND_ICON, inst, state, readOnly, cards, locked, nozzlesOf, defaultCard, defaultText,
      dead, remembered, clean, panel, choice, along, pcard, plan, panelTitle,
      openDefault, setDefault, openRemove, toggleAlong, remove, closePanel,
      go, hashOf, plural, nozzleLabel, printerText, profileSub,
    };
  },

  template: `
    <div :class="['page-host', { 'with-panel': panel }]">
      <div class="page">
        <div class="page-head head-row">
          <div class="grow">
            <h1 id="page-title" tabindex="-1">{{ P.title }}</h1>
            <p>{{ inst.slicer }} {{ inst.version }}</p>
          </div>
          <run-status :inst="inst"/>
        </div>
        <p v-if="readOnly" class="banner">{{ T.busy(inst) }} {{ T.closeToChange }}</p>

        <section class="box start-box" aria-labelledby="start-h">
          <img class="bar-img" :src="defaultCard ? defaultCard.cover : 'assets/printer-placeholder.png'" alt="" width="48" height="48">
          <div>
            <h2 id="start-h" class="start-label">{{ P.atStart }}</h2>
            <p class="start-name"><ui-icon name="star" class="star"/>{{ defaultText }}</p>
            <p v-if="state.defaultPrinter && !defaultCard" class="row-hint bad">{{ P.defaultGone }}</p>
          </div>
        </section>

        <div class="section-head">
          <h2>{{ P.yours }}</h2>
          <span class="sub">{{ P.inSlicer(cards.filter((c) => c.visible).length) }}</span>
        </div>
        <div class="cards pcards">
          <article v-for="c in cards" :key="c.id" :class="['pcard', { 'is-default': c.isDefault }]" :aria-label="c.label">
            <span class="card-img"><img :src="c.cover" alt="" width="170" height="170" :class="{ dim: !c.visible }"></span>
            <div class="pcard-body">
              <h3 class="card-name">{{ c.label }}</h3>
              <span v-if="c.sub" class="card-sub">{{ c.sub }}</span>
              <p class="tags">
                <span v-if="c.isDefault" class="tag tag-default"><ui-icon name="star" :size="14"/>{{ P.tags.default }}</span>
                <span class="tag"><ui-icon :name="c.tagIcon" :size="14"/>{{ c.tag }}</span>
              </p>
              <p v-if="nozzlesOf(c).length" class="card-meta">
                <nozzle-icon :sizes="[0.4]" :height="20"/><span class="sr-only">{{ P.nozzlesLabel }}</span>
                <span class="nz-chips">
                  <span v-for="p in nozzlesOf(c)" :key="p.name" :class="['nz-chip', { 'is-default': p.name === state.defaultPrinter }]"
                        :title="p.name === state.defaultPrinter ? P.tags.default : null">{{ nozzleLabel(p.variant) }}</span>
                </span>
                mm
              </p>
              <p v-if="!c.visible" class="card-problem" :title="c.problem"><ui-icon name="info" :size="16"/>{{ c.unresolved ? P.unresolved : P.notVisible }}</p>
            </div>
            <div class="card-actions">
              <button v-if="c.printers.length && !(c.isDefault && c.printers.length < 2)" class="btn" type="button"
                      :disabled="readOnly" @click="openDefault(c)">
                <ui-icon name="star"/>{{ c.isDefault ? P.otherNozzle : P.asDefault }}
              </button>
              <button class="btn btn-danger" type="button" :disabled="readOnly || locked(c) || c.bundle"
                      :title="c.bundle ? P.bundleLocked : locked(c) ? P.lastOne : null" @click="openRemove(c)">
                <ui-icon :name="locked(c) || c.bundle ? 'lock' : 'trash'"/>{{ c.system ? P.remove : P.delete }}
              </button>
            </div>
          </article>
        </div>
        <p v-if="!cards.length" class="empty">{{ T.filaments.noPrinter }}</p>

        <section class="box clean-box" aria-labelledby="clean-h">
          <div class="box-head">
            <h2 id="clean-h">{{ P.clean.title }}</h2>
            <span class="sub">{{ P.clean.remembered(remembered) }}</span>
          </div>
          <template v-if="dead.length">
            <p class="note">{{ P.clean.intro }}</p>
            <ul class="plain-list">
              <li v-for="d in dead" :key="d.machine">
                <span class="ch-off"><ui-icon name="printer"/></span>
                <span class="grow"><strong>{{ d.machine }}</strong><small>{{ T.deadEntries[d.reason] }}</small></span>
              </li>
            </ul>
            <div class="actions">
              <span class="safe-note inline"><ui-icon name="backup"/>{{ P.safe }}</span>
              <button class="btn btn-primary right" type="button" :disabled="readOnly" @click="clean"><ui-icon name="broom"/>{{ P.clean.button }}</button>
            </div>
          </template>
          <p v-else class="all-clean"><ui-icon name="check"/>{{ P.clean.nothing }}</p>
        </section>

        <p class="credits">{{ P.credits }}</p>
      </div>
    </div>

    <aside v-if="panel" class="panel" aria-labelledby="panel-title">
      <div class="panel-head">
        <h2 id="panel-title" tabindex="-1">{{ panelTitle }}</h2>
        <button class="icon-btn" type="button" :aria-label="T.close" @click="closePanel"><ui-icon name="close"/></button>
      </div>
      <div class="panel-body">
        <p v-if="!pcard" class="note">{{ P.gone }}</p>
        <template v-else>
          <div class="hero">
            <img class="hero-img" :src="pcard.cover" alt="" width="96" height="96" :class="{ dim: !pcard.visible }">
            <div class="hero-text">
              <p class="hero-name">{{ pcard.label }}</p>
              <p v-if="pcard.sub" class="hero-sub">{{ pcard.sub }}</p>
              <p class="tags hero-tags">
                <span v-if="pcard.isDefault" class="tag tag-default"><ui-icon name="star" :size="14"/>{{ P.tags.default }}</span>
                <span class="tag"><ui-icon :name="pcard.tagIcon" :size="14"/>{{ pcard.tag }}</span>
              </p>
            </div>
          </div>

          <template v-if="panel.type === 'default'">
            <template v-if="pcard.printers.length > 1">
              <h3>{{ P.whichNozzle }}</h3>
              <div class="nozzle-row">
                <button v-for="p in pcard.printers" :key="p.name" type="button" class="nozzle-tile"
                        :aria-pressed="choice === p.name" @click="choice = p.name">
                  <nozzle-icon :sizes="p.variant.split('+').map(Number)"/>{{ nozzleLabel(p.variant) }} mm
                </button>
              </div>
            </template>
            <p class="plan-line"><ui-icon name="star" class="star"/><span>{{ P.startsThen(inst.slicer) }} <strong>{{ printerText(inst, choice) }}</strong>.</span></p>
            <p v-if="choice === state.defaultPrinter" class="note">{{ P.alreadyDefault }}</p>
            <p class="safe-note"><ui-icon name="backup"/><span>{{ P.safe }}</span></p>
            <div class="actions">
              <button class="btn" type="button" @click="closePanel">{{ T.cancel }}</button>
              <button class="btn btn-primary right" type="button" :disabled="readOnly || choice === state.defaultPrinter" @click="setDefault">{{ P.asDefault }}</button>
            </div>
          </template>

          <template v-else>
            <p v-if="pcard.problem" class="alert">{{ pcard.problem }}</p>
            <h3>{{ P.plan.title }}</h3>
            <ul class="plain-list">
              <li v-for="(it, n) in plan" :key="n">
                <span :class="it.cls"><ui-icon :name="it.icon"/></span>
                <span class="grow"><strong>{{ it.name }}</strong> {{ it.verb }}<small>{{ it.sub }}</small></span>
              </li>
            </ul>

            <template v-if="pcard.onlyHere.length">
              <h3>{{ P.along.title }}</h3>
              <p class="note">{{ P.along.intro }}</p>
              <ul class="plain-list">
                <li v-for="x in pcard.onlyHere" :key="x.name">
                  <label class="along">
                    <input type="checkbox" :checked="along.has(x.name)" @change="toggleAlong(x.name)">
                    <ui-icon :name="KIND_ICON[x.kind]"/>
                    <span class="grow"><strong>{{ x.name }}</strong><small>{{ profileSub(x) }}</small></span>
                  </label>
                </li>
              </ul>
              <p v-if="pcard.keepsOwn.length" class="note">{{ P.along.notTicked(pcard.keepsOwn) }}</p>
            </template>

            <p class="safe-note"><ui-icon name="backup"/><span>{{ P.safeRestore.before }}<a :href="hashOf('sicherungen', inst.id)" @click="go($event, hashOf('sicherungen', inst.id))">{{ T.nav.pages.sicherungen }}</a>{{ P.safeRestore.after }}</span></p>
            <div class="actions">
              <button class="btn" type="button" @click="closePanel">{{ T.cancel }}</button>
              <button class="btn btn-danger-solid right" type="button" :disabled="readOnly || locked(pcard)" @click="remove">
                <ui-icon name="trash"/>{{ pcard.system ? P.remove : P.delete }}
              </button>
            </div>
          </template>
        </template>
      </div>
    </aside>
  `,
};
