// Page "Drucker": one card per printer model of a manufacturer and per own printer. Here the
// user picks the printer the slicer starts with and removes printers, together with the own
// filaments and processes that belong to that printer only. Each action opens the side panel
// with the plan first (hard rule 5) and makes a backup (common.js). Memory only.
// Data: ORFIX_DATA.instances[].printers_page; the changeable state is `live` in common.js, so a
// restore on the page "Sicherungen" shows up here.
import {
  INSTANCES, live, backupNow, flash, go, asset, plural, nozzleLabel, printerShortName, printerText,
  profileSub, KIND_ICON,
} from "../common.js";

const { ref, reactive, computed, watch, nextTick, onMounted, onUnmounted } = Vue;

const LAST_ONE = "Mindestens ein Drucker bleibt.";
const PROJECT = "Aus einem Projekt übernommen";  // origin set by make_data.py (FINDINGS 4.9)
const DONE = " – im Entwurf wird nichts gespeichert.";

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
          id: "model:" + m.model, system: true, model: m.model, name, sub: name === m.model ? "" : m.model,
          cover: m.cover, printers: m.printers, tag: "Vom Hersteller", tagIcon: "factory",
          visible: true, example: false, problem: null,
          isDefault: m.printers.some((p) => p.name === s.defaultPrinter),
          onlyHere: mine(m.only_here), keepsOwn: m.own_printers.filter((n) => s.own.has(n)),
        });
      }
      for (const p of pp.own) {
        if (!s.own.has(p.name)) continue;
        const project = p.origin === PROJECT;
        out.push({
          id: "own:" + p.name, system: false, model: p.model, name: p.name,
          sub: p.based_on ? "Vorlage: " + (p.based_on_found ? printerText(i, p.based_on) : p.based_on) : "",
          cover: p.cover, printers: p.visible ? [{ name: p.name, variant: p.variant }] : [],
          tag: project ? PROJECT : "Eigener", tagIcon: project ? "file" : "user",
          visible: p.visible, example: !!p.example, problem: p.problem || null,
          isDefault: p.name === s.defaultPrinter, onlyHere: mine(p.only_here), keepsOwn: [],
        });
      }
      return out;
    });
    const visibleCount = computed(() => cards.value.filter((c) => c.visible).length);
    const locked = (c) => c.visible && visibleCount.value <= 1;
    const nozzlesOf = (c) => c.printers.filter((p) => p.variant);
    const nozzleList = (c) => nozzlesOf(c).map((p) => nozzleLabel(p.variant)).join(" · ");

    const defaultCard = computed(() => cards.value.find((c) => c.isDefault) || null);
    const defaultText = computed(() => printerText(inst.value, state.value.defaultPrinter));

    // When the default printer goes, the slicer starts with another one; Orfix names it in the plan.
    function nextDefault(card) {
      const rest = cards.value.filter((c) => c.id !== card.id && c.printers.length);
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
      backupNow(inst.value, { kind: "change", reason: "vor „Aufgeräumt“", detail: plural(dead.value.length, "Eintrag", "Einträge") });
      state.value.dead = [];
      flash("Aufgeräumt" + DONE);
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
      const i = inst.value, s = state.value;
      if (readOnly.value || !choice.value || choice.value === s.defaultPrinter) return;
      const text = printerText(i, choice.value);
      backupNow(i, { kind: "change", reason: "vor „Standard geändert“", detail: text });
      s.defaultPrinter = choice.value;
      closePanel();
      flash(`„${text}“ ist jetzt Standard` + DONE);
    }

    // Own profiles that belong to this printer only are ticked, unless an own printer built on it
    // stays: it may still use them (FINDINGS 4.6, compatibility over the direct parent).
    function openRemove(c) {
      if (readOnly.value || locked(c)) return;
      along.clear();
      if (!c.keepsOwn.length) c.onlyHere.forEach((x) => along.add(x.name));
      openPanel({ type: "remove", id: c.id });
    }
    const toggleAlong = (name) => along.has(name) ? along.delete(name) : along.add(name);
    const plan = computed(() => {
      const c = pcard.value;
      if (!c || !panel.value || panel.value.type !== "remove") return [];
      const out = [];
      if (c.system) {
        // SnOrca switches all nozzles of a model back on at start, so only whole models go (FINDINGS 12).
        out.push({ icon: "minus", cls: "ch-off", name: c.name, verb: "wird im Slicer abgeschaltet",
                   sub: "Alle Düsen: " + nozzleList(c) + " mm. Die Profile vom Hersteller bleiben auf dem Rechner." });
      } else {
        out.push({ icon: "trash", cls: "ch-delete", name: c.name, verb: "wird gelöscht", sub: "Seine Datei kommt weg." });
      }
      if (c.isDefault) {
        const next = nextDefault(c);
        if (next) out.push({ icon: "star", cls: "ch-on", name: printerText(inst.value, next), verb: "wird Standard", sub: "Mit ihm startet der Slicer dann." });
      }
      // Own printers built on a model stay visible without it (Preset::set_visible_from_appconfig
      // leaves profiles without vendor alone). The ticked profiles below are part of the plan, too.
      for (const n of c.keepsOwn) {
        out.push({ icon: "user", cls: "ch-on", name: n, verb: "bleibt", sub: "Baut auf diesem Drucker auf und funktioniert weiter." });
      }
      return out;
    });
    function remove() {
      const c = pcard.value, s = state.value;
      if (!c || readOnly.value || locked(c)) return;
      const next = c.isDefault ? nextDefault(c) : null;
      backupNow(inst.value, { kind: "change", reason: c.system ? "vor „Drucker entfernt“" : "vor „Drucker gelöscht“", detail: c.name });
      if (c.system) s.models.delete(c.model);
      else s.own.delete(c.name);
      for (const n of along) s.own.delete(n);
      if (next) s.defaultPrinter = next;
      const name = c.name, verb = c.system ? "entfernt" : "gelöscht";
      closePanel();
      flash(`„${name}“ ${verb}` + DONE);
    }

    const panelTitle = computed(() => {
      if (!panel.value) return "";
      if (panel.value.type === "default") return "Standard festlegen";
      return pcard.value && !pcard.value.system ? "Drucker löschen" : "Drucker entfernen";
    });

    const onKey = (ev) => { if (ev.key === "Escape" && panel.value) closePanel(); };
    onMounted(() => window.addEventListener("keydown", onKey));
    onUnmounted(() => window.removeEventListener("keydown", onKey));

    return {
      LAST_ONE, KIND_ICON, inst, state, readOnly, cards, locked, nozzlesOf, defaultCard, defaultText,
      dead, remembered, clean, panel, choice, along, pcard, plan, panelTitle,
      openDefault, setDefault, openRemove, toggleAlong, remove, closePanel,
      go, asset, plural, nozzleLabel, printerText, profileSub,
    };
  },

  template: `
    <div :class="['page-host', { 'with-panel': panel }]">
      <div class="page">
        <div class="page-head head-row">
          <div class="grow">
            <h1 id="page-title" tabindex="-1">Drucker</h1>
            <p>{{ inst.slicer }} {{ inst.version }}</p>
          </div>
          <span :class="['status', { 'status--busy': inst.running }]">{{ inst.running ? 'Läuft – nur ansehen' : 'Geschlossen' }}</span>
        </div>
        <p v-if="readOnly" class="banner">{{ inst.slicer }} ist offen. Zum Ändern bitte den Slicer schließen.</p>

        <section class="box start-box" aria-labelledby="start-h">
          <img class="bar-img" :src="asset(defaultCard ? defaultCard.cover : 'assets/printer-placeholder.png')" alt="" width="48" height="48">
          <div>
            <h2 id="start-h" class="start-label">Beim Start gewählt</h2>
            <p class="start-name"><ui-icon name="star" class="star"/>{{ defaultText }}</p>
            <p v-if="!defaultCard" class="row-hint bad">Diesen Drucker gibt es hier nicht mehr. Der Slicer nimmt beim Start einen anderen.</p>
          </div>
        </section>

        <div class="section-head">
          <h2>Deine Drucker</h2>
          <span class="sub">{{ plural(cards.filter((c) => c.visible).length, 'Drucker', 'Drucker') }} im Slicer</span>
        </div>
        <div class="cards pcards">
          <article v-for="c in cards" :key="c.id" :class="['pcard', { 'is-default': c.isDefault }]" :aria-label="c.name">
            <span class="card-img"><img :src="asset(c.cover)" alt="" width="170" height="170" :class="{ dim: !c.visible }"></span>
            <div class="pcard-body">
              <h3 class="card-name">{{ c.name }}</h3>
              <span v-if="c.sub" class="card-sub">{{ c.sub }}</span>
              <p class="tags">
                <span v-if="c.isDefault" class="tag tag-default"><ui-icon name="star" :size="14"/>Standard</span>
                <span class="tag"><ui-icon :name="c.tagIcon" :size="14"/>{{ c.tag }}</span>
                <span v-if="c.example" class="tag-example" title="Nur im Entwurf, im Slicer gibt es diesen Drucker nicht">Beispiel</span>
              </p>
              <p v-if="nozzlesOf(c).length" class="card-meta">
                <nozzle-icon :sizes="[0.4]" :height="20"/><span class="sr-only">Düsen:</span>
                <span class="nz-chips">
                  <span v-for="p in nozzlesOf(c)" :key="p.name" :class="['nz-chip', { 'is-default': p.name === state.defaultPrinter }]"
                        :title="p.name === state.defaultPrinter ? 'Standard' : null">{{ nozzleLabel(p.variant) }}</span>
                </span>
                mm
              </p>
              <p v-if="!c.visible" class="card-problem" :title="c.problem"><ui-icon name="info" :size="16"/>Im Slicer nicht sichtbar</p>
            </div>
            <div class="card-actions">
              <button v-if="c.printers.length && !(c.isDefault && c.printers.length < 2)" class="btn" type="button"
                      :disabled="readOnly" @click="openDefault(c)">
                <ui-icon name="star"/>{{ c.isDefault ? 'Andere Düse' : 'Als Standard' }}
              </button>
              <button class="btn btn-danger" type="button" :disabled="readOnly || locked(c)" :title="locked(c) ? LAST_ONE : null" @click="openRemove(c)">
                <ui-icon :name="locked(c) ? 'lock' : 'trash'"/>{{ c.system ? 'Entfernen' : 'Löschen' }}
              </button>
            </div>
          </article>
        </div>

        <section class="box clean-box" aria-labelledby="clean-h">
          <div class="box-head">
            <h2 id="clean-h">Aufräumen</h2>
            <span class="sub">Gemerkte Auswahl für {{ plural(remembered, 'Drucker', 'Drucker') }}</span>
          </div>
          <template v-if="dead.length">
            <p class="note">Der Slicer merkt sich für jeden Drucker, was du zuletzt gewählt hast, und räumt nie auf. Diese Einträge gehören zu keinem Drucker mehr:</p>
            <ul class="plain-list">
              <li v-for="d in dead" :key="d.machine">
                <span class="ch-off"><ui-icon name="printer"/></span>
                <span class="grow"><strong>{{ d.machine }}</strong><small>{{ d.text }}</small></span>
              </li>
            </ul>
            <div class="actions">
              <span class="safe-note inline"><ui-icon name="backup"/>Vorher legt Orfix eine Sicherung an.</span>
              <button class="btn btn-primary right" type="button" :disabled="readOnly" @click="clean"><ui-icon name="broom"/>Aufräumen</button>
            </div>
          </template>
          <p v-else class="all-clean"><ui-icon name="check"/>Nichts aufzuräumen.</p>
        </section>

        <p class="credits">Druckerbilder aus OrcaSlicer</p>
      </div>
    </div>

    <aside v-if="panel" class="panel" aria-labelledby="panel-title">
      <div class="panel-head">
        <h2 id="panel-title" tabindex="-1">{{ panelTitle }}</h2>
        <button class="icon-btn" type="button" aria-label="Schließen" @click="closePanel"><ui-icon name="close"/></button>
      </div>
      <div class="panel-body">
        <p v-if="!pcard" class="note">Diesen Drucker gibt es nicht mehr.</p>
        <template v-else>
          <div class="hero">
            <img class="hero-img" :src="asset(pcard.cover)" alt="" width="96" height="96" :class="{ dim: !pcard.visible }">
            <div class="hero-text">
              <p class="hero-name">{{ pcard.name }}</p>
              <p v-if="pcard.sub" class="hero-sub">{{ pcard.sub }}</p>
              <p class="tags hero-tags">
                <span v-if="pcard.isDefault" class="tag tag-default"><ui-icon name="star" :size="14"/>Standard</span>
                <span class="tag"><ui-icon :name="pcard.tagIcon" :size="14"/>{{ pcard.tag }}</span>
                <span v-if="pcard.example" class="tag-example">Beispiel</span>
              </p>
            </div>
          </div>

          <template v-if="panel.type === 'default'">
            <template v-if="pcard.printers.length > 1">
              <h3>Welche Düse?</h3>
              <div class="nozzle-row">
                <button v-for="p in pcard.printers" :key="p.name" type="button" class="nozzle-tile"
                        :aria-pressed="choice === p.name" @click="choice = p.name">
                  <nozzle-icon :sizes="p.variant.split('+').map(Number)"/>{{ nozzleLabel(p.variant) }} mm
                </button>
              </div>
            </template>
            <p class="plan-line"><ui-icon name="star" class="star"/><span>Beim Start wählt {{ inst.slicer }} dann <strong>{{ printerText(inst, choice) }}</strong>.</span></p>
            <p v-if="choice === state.defaultPrinter" class="note">Das ist schon der Standard.</p>
            <p class="safe-note"><ui-icon name="backup"/><span>Vorher legt Orfix eine Sicherung an.</span></p>
            <div class="actions">
              <button class="btn" type="button" @click="closePanel">Abbrechen</button>
              <button class="btn btn-primary right" type="button" :disabled="readOnly || choice === state.defaultPrinter" @click="setDefault">Als Standard</button>
            </div>
          </template>

          <template v-else>
            <p v-if="pcard.problem" class="alert">{{ pcard.problem }}</p>
            <h3>Was passiert</h3>
            <ul class="plain-list">
              <li v-for="(it, n) in plan" :key="n">
                <span :class="it.cls"><ui-icon :name="it.icon"/></span>
                <span class="grow"><strong>{{ it.name }}</strong> {{ it.verb }}<small>{{ it.sub }}</small></span>
              </li>
            </ul>

            <template v-if="pcard.onlyHere.length">
              <h3>Mitlöschen?</h3>
              <p class="note">Das gehört nur zu diesem Drucker.</p>
              <ul class="plain-list">
                <li v-for="x in pcard.onlyHere" :key="x.name">
                  <label class="along">
                    <input type="checkbox" :checked="along.has(x.name)" @change="toggleAlong(x.name)">
                    <ui-icon :name="KIND_ICON[x.kind]"/>
                    <span class="grow"><strong>{{ x.name }}</strong><small>{{ profileSub(x) }}</small></span>
                    <span v-if="x.example" class="tag-example">Beispiel</span>
                  </label>
                </li>
              </ul>
              <p v-if="pcard.keepsOwn.length" class="note">Nicht angehakt, weil {{ pcard.keepsOwn.map((n) => '„' + n + '“').join(', ') }} sie vielleicht noch braucht.</p>
            </template>

            <p class="safe-note"><ui-icon name="backup"/><span>Vorher legt Orfix eine Sicherung an. Unter <a href="#/sicherungen" @click="go($event, '#/sicherungen')">Sicherungen</a> holst du alles zurück.</span></p>
            <div class="actions">
              <button class="btn" type="button" @click="closePanel">Abbrechen</button>
              <button class="btn btn-danger-solid right" type="button" :disabled="readOnly || locked(pcard)" @click="remove">
                <ui-icon name="trash"/>{{ pcard.system ? 'Entfernen' : 'Löschen' }}
              </button>
            </div>
          </template>
        </template>
      </div>
    </aside>
  `,
};
