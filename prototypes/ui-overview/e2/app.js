// Draft E2: app frame with the main menu on the left (ionpy device window) and one page per hash route.
import {
  INSTANCES, route, ui, go, hashOf, syncRoute, flash, statusText, generatedText, registerCommon,
} from "./common.js";
import { T } from "../../../orfix/static/texts.js";
import FilamentePage, { changes } from "./pages/filamente.js";
import DruckerPage from "./pages/drucker.js";
import SicherungenPage, { backupsOf } from "./pages/sicherungen.js";
import SlicerPage from "./pages/slicer.js";

const { createApp, ref, computed, watch, nextTick } = Vue;

// Order = reading order. "Slicer" sits under its own heading, so it reads as the technical extra.
const PAGES = [
  { id: "filamente", label: "Filamente", icon: "spool", component: FilamentePage },
  { id: "drucker", label: "Drucker", icon: "printer", component: DruckerPage },
  { id: "sicherungen", label: "Sicherungen", icon: "backup", component: SicherungenPage },
  { id: "slicer", label: "Slicer", icon: "folder", group: "Technik", component: SlicerPage },
];

const app = createApp({
  setup() {
    const inst = computed(() => INSTANCES.find((i) => i.id === ui.instId) || null);
    const page = computed(() => PAGES.find((p) => p.id === route.value.page));
    // A new key per route mounts the page fresh, so a printer view never patches over the last one.
    const pageKey = computed(() => [route.value.page, ui.instId, route.value.modelIdx].join("|"));
    const pageProps = computed(() => route.value.page === "filamente"
      ? { instId: ui.instId, modelIdx: route.value.modelIdx }
      : { instId: ui.instId });

    // What the menu shows on the right: pending filament changes (all installations, as the
    // change bar counts them) and the backups of the chosen installation.
    const badges = computed(() => ({
      filamente: changes.value.length ? { n: changes.value.length, text: "offene Änderungen", changed: true } : null,
      sicherungen: ui.instId ? { n: backupsOf(ui.instId).length, text: "Sicherungen", changed: false } : null,
    }));

    const instOpen = ref(false);
    const instBtn = ref(null);
    const instMenu = ref(null);

    window.addEventListener("hashchange", () => syncRoute());
    // The address carries the installation; one without it gets the chosen one added.
    watch(route, (r) => {
      if (r.instId) ui.instId = r.instId;
      else if (ui.instId) history.replaceState(null, "", hashOf(r.page, ui.instId));
    }, { immediate: true });
    // After a page switch the focus moves to the page title, as in draft E.
    watch(route, () => {
      instOpen.value = false;
      window.scrollTo(0, 0);
      nextTick(() => document.getElementById("page-title")?.focus());
    });

    // ------------------------------------------------------------ installation picker
    function toggleInst() {
      instOpen.value = !instOpen.value;
      if (instOpen.value) nextTick(() => instMenu.value?.querySelector('[aria-checked="true"]')?.focus());
    }
    function closeInst() {
      instOpen.value = false;
      instBtn.value?.focus();
    }
    function pickInst(i) {
      closeInst();
      if (i.id === ui.instId) return;
      const r = route.value;
      const current = r.page === "filamente" && r.modelIdx !== null ? INSTANCES.find((x) => x.id === ui.instId).models[r.modelIdx] : null;
      if (!current) return go(null, hashOf(r.page, i.id));
      // Stay with the same printer model if the other installation has it, else show its printers.
      const idx = i.models.findIndex((m) => m.model === current.model);
      go(null, hashOf("filamente", i.id, idx >= 0 ? idx : null));
    }
    function instKey(ev) {
      if (!instOpen.value) return;
      if (ev.key === "Escape") {
        ev.stopPropagation();  // the page's own Escape (side panel) stays untouched
        closeInst();
      } else if (ev.key === "Tab") {
        ev.preventDefault();  // back to the button, as with Escape; the removed item cannot keep the focus
        closeInst();
      } else if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
        ev.preventDefault();
        const items = [...instMenu.value.querySelectorAll(".inst-item")];
        const n = items.indexOf(document.activeElement), down = ev.key === "ArrowDown";
        const next = n < 0 ? (down ? 0 : items.length - 1) : (n + (down ? 1 : items.length - 1)) % items.length;
        items[next].focus();
      }
    }
    document.addEventListener("pointerdown", (ev) => {
      if (instOpen.value && !(ev.target instanceof Element && ev.target.closest(".inst"))) instOpen.value = false;
    });

    // The real app scans again and checks whether the slicer runs; the draft only has data.js.
    const reread = () => flash(`Neu eingelesen – im Entwurf bleibt es beim Stand von ${generatedText} Uhr.`);
    const addDir = () => flash("Im Entwurf nicht möglich.");

    return {
      INSTANCES, PAGES, T, route, ui, inst, page, pageKey, pageProps, badges, go, hashOf, statusText, generatedText,
      instOpen, instBtn, instMenu, toggleInst, pickInst, instKey, reread, addDir,
    };
  },

  template: `
    <header class="topbar">
      <a class="brand" :href="hashOf('filamente', ui.instId)" @click="go($event, hashOf('filamente', ui.instId))"><spool-icon colour="#009688" :size="26"/><span class="brand-name">Orfix</span></a>
      <div class="draft">
        <span class="draft-text"><span class="draft-long">Entwurf – es wird nichts gespeichert</span><span class="draft-short">Entwurf</span></span>
        <button class="draft-toggle" type="button" role="switch" :aria-checked="ui.examples ? 'true' : 'false'"
                title="Beispielprofile zeigen, die es im Slicer nicht gibt" @click="ui.examples = !ui.examples">
          <span class="mini-switch" aria-hidden="true"></span>Beispiele
        </button>
      </div>
      <div v-if="INSTANCES.length > 1" class="inst" @keydown="instKey">
        <button ref="instBtn" class="inst-btn" type="button" aria-haspopup="menu" :aria-expanded="instOpen ? 'true' : 'false'"
                :title="inst.slicer + ' ' + inst.version + ' · ' + statusText(inst)" @click="toggleInst">
          <span class="inst-name">{{ inst.slicer }}</span>
          <run-status :inst="inst"/>
          <ui-icon name="chevronDown"/>
        </button>
        <div v-if="instOpen" ref="instMenu" class="inst-menu" role="menu" aria-label="Installation">
          <div class="inst-menu-label" aria-hidden="true">Installation</div>
          <button v-for="i in INSTANCES" :key="i.id" class="inst-item" type="button" role="menuitemradio"
                  :aria-checked="i.id === inst.id ? 'true' : 'false'" @click="pickInst(i)">
            <ui-icon name="check" class="check"/>
            <span class="inst-item-text">
              <span>{{ i.slicer }} <span class="version">{{ i.version }}</span></span>
              <run-status :inst="i"/>
            </span>
          </button>
        </div>
      </div>
      <span v-else-if="inst" class="inst-single">{{ inst.slicer }}</span>
      <button class="bar-btn" type="button" :aria-label="T.reload" :title="'Stand der Daten: ' + generatedText + ' Uhr'" @click="reread">
        <ui-icon name="refresh"/><span class="bar-btn-label">{{ T.reload }}</span>
      </button>
    </header>

    <div class="shell">
      <nav class="nav" aria-label="Hauptmenü">
        <template v-for="p in PAGES" :key="p.id">
          <div v-if="p.group" class="nav-label">{{ p.group }}</div>
          <a class="nav-item" :href="hashOf(p.id, ui.instId)" :aria-current="route.page === p.id ? 'page' : null" @click="go($event, hashOf(p.id, ui.instId))">
            <ui-icon :name="p.icon"/><span class="nav-text">{{ p.label }}</span>
            <span v-if="badges[p.id]" :class="['nav-count', { 'is-changed': badges[p.id].changed }]"
                  :title="badges[p.id].n + ' ' + badges[p.id].text">{{ badges[p.id].n }}<span class="sr-only"> {{ badges[p.id].text }}</span></span>
          </a>
        </template>
      </nav>
      <main class="main">
        <component v-if="inst" :is="page.component" :key="pageKey" v-bind="pageProps"/>
        <div v-else class="page">
          <section class="soon">
            <span class="soon-icon"><ui-icon name="folder" :size="44"/></span>
            <h1 id="page-title" tabindex="-1" class="soon-title">{{ T.empty.title }}</h1>
            <p class="soon-text">{{ T.empty.text }}</p>
            <form class="add-form" @submit.prevent="addDir">
              <input class="input" type="text" autocomplete="off" :placeholder="T.add.placeholder" :aria-label="T.add.title">
              <button class="btn btn-primary" type="submit">{{ T.add.button }}</button>
            </form>
          </section>
        </div>
      </main>
    </div>

    <div :class="['toast', { show: ui.toast }]" role="status" aria-live="polite">{{ ui.toast }}</div>
  `,
});

registerCommon(app);
app.mount("#app");
