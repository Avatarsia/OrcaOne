// Page "Übersicht", the start page (the user's wish of 24.09.2026): what OrcaOne works with at a
// glance, as pictures rather than lists (the user: "nicht nur eine Auflistung von Werten"). The
// printer of the top bar on a stage, read live every few seconds while the page is visible if it
// has an address (camera.status, as on "Kamera"): its heads with spool, filament and temperature,
// the bed below. Tiles lead on: filaments and processes of the chosen nozzle, backups, what
// changed since last time; "3MF bereinigen" takes a file right here. Reads only.
import {
  INSTANCES, BACKUPS, NEWS, U1_MODELS, ui, go, hashOf, printerModels, modelName, nozzleLabel, chosenNozzle, nozzleKey, whenText,
} from "../common.js";
import { T, plainName } from "../texts.js";
import { api } from "../api.js";
import { PrintStatus } from "./kamera.js";
import { CleanDrop } from "./bereinigen.js";

const { ref, computed, onMounted, onUnmounted } = Vue;
const O = T.home;
const P = T.printers;
const STATE_EVERY = 5000;  // ms, as on "Kamera"
const SPOOLS = 10;         // own filaments shown as spools, the rest as a number
const NO_COLOUR = "#D9D9D9";  // a spool without a colour

export default {
  name: "UebersichtPage",
  components: { PrintStatus, CleanDrop },
  props: { instId: { type: String, required: true } },

  setup(props) {
    const inst = computed(() => INSTANCES.find((i) => i.id === props.instId));
    const model = computed(() => printerModels(inst.value).find((m) => m.model === ui.printer) || null);
    const modelIdx = computed(() => (model.value ? inst.value.models.indexOf(model.value) : null));
    const isU1 = computed(() => U1_MODELS.includes(ui.printer));
    // The nozzle as on "Filamente" and "Prozesse": the one chosen there, else the slicer's.
    const nozzle = computed(() => {
      const m = model.value;
      if (!m) return null;
      const chosen = chosenNozzle[nozzleKey(inst.value, m)];
      return m.printers.find((p) => p.name === chosen) || m.printers.find((p) => p.selected) || m.printers[0];
    });
    const nozzleText = computed(() => (nozzle.value ? nozzleLabel(nozzle.value.variant) : ""));
    const own = computed(() => inst.value.filaments.filter((f) => f.origin_kind === "user"));

    // ------------------------------------------------------------ the printer itself
    const host = ref(null);          // null while OrcaOne looks it up, "" without an address
    const state = ref(null);         // camera.status: job, progress, heads, bed
    const unreachable = ref(false);
    let timer = 0;
    async function readState() {
      if (document.hidden || !host.value) return;
      try {
        state.value = await api.printerState(ui.printer);
        unreachable.value = false;
      } catch {
        unreachable.value = true;
      }
    }
    onMounted(async () => {
      try {
        host.value = (await api.printers()).printers[ui.printer]?.host || "";
      } catch {
        host.value = "";
      }
      readState();
      timer = setInterval(readState, STATE_EVERY);
    });
    // Back in view: at once, not only with the next tick.
    document.addEventListener("visibilitychange", readState);
    onUnmounted(() => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", readState);
    });

    // ------------------------------------------------------------ the tiles
    const backups = computed(() => BACKUPS[inst.value.id]?.backups || []);
    const newestBackup = computed(() => backups.value.reduce((a, b) => (!a || b.created > a.created ? b : a), null));
    const news = computed(() => NEWS[inst.value.id] || 0);

    const to = (page, idx = null) => hashOf(page, inst.value.id, idx);
    return {
      T, O, P, INSTANCES, inst, model, modelIdx, isU1, nozzle, nozzleText, own, host, state, unreachable,
      backups, newestBackup, news, SPOOLS, NO_COLOUR, to, go, modelName, plainName, whenText,
    };
  },

  template: `
    <div class="page home-page">
      <div class="page-head head-row">
        <div class="grow">
          <h1 id="page-title" tabindex="-1">{{ O.title }}</h1>
          <p>{{ inst.slicer }} {{ inst.version }}</p>
        </div>
        <run-status :inst="inst"/>
      </div>

      <!-- The printer of the top bar on its stage, live if it has an address -->
      <section class="box home-printer" :aria-label="O.printer">
        <template v-if="model">
          <div class="home-printer-main">
            <div class="home-printer-top">
              <a class="home-printer-img" :href="to('drucker')" :title="T.nav.pages.drucker" @click="go($event, to('drucker'))">
                <img :src="model.cover" alt="" width="140" height="140"></a>
              <div class="home-printer-body">
                <h2 class="home-name">{{ modelName(model) }}</h2>
                <p v-if="host" class="card-host"><ui-icon name="network" :size="16"/><span class="card-host-value">{{ host }}</span></p>
                <p v-else-if="host === ''" class="card-host is-missing"><ui-icon name="network" :size="16"/>{{ O.noHost }}</p>
                <p v-if="unreachable" class="cam-status is-err home-state"><span class="cam-dot"></span>{{ P.live.unreachable }}</p>
                <print-status v-else-if="state" :p="state"/>
                <p v-else-if="host" class="cam-status is-wait home-state"><span class="cam-dot"></span>{{ P.live.asking }}</p>
              </div>
            </div>
            <printer-stage v-if="state && !unreachable && state.heads.length" :p="state" :u1="isU1"/>
          </div>
          <div class="home-actions">
            <template v-if="host">
              <a class="btn btn-primary" :href="to('status')" @click="go($event, to('status'))"><ui-icon name="pulse"/>{{ T.nav.pages.status }}</a>
              <a v-if="isU1" class="btn" :href="to('kamera')" @click="go($event, to('kamera'))"><ui-icon name="camera"/>{{ T.nav.pages.kamera }}</a>
              <a v-if="isU1" class="btn" :href="to('dateien')" @click="go($event, to('dateien'))"><ui-icon name="folderOpen"/>{{ T.nav.pages.dateien }}</a>
              <a class="btn" :href="to('konsole')" @click="go($event, to('konsole'))"><ui-icon name="code"/>{{ T.nav.pages.konsole }}</a>
              <a class="btn" :href="to('ssh')" @click="go($event, to('ssh'))"><ui-icon name="terminal"/>{{ T.nav.pages.ssh }}</a>
              <a class="btn" :href="'http://' + host + '/'" target="_blank" rel="noopener"><ui-icon name="window"/>{{ P.live.web }}</a>
            </template>
            <a v-else-if="host === ''" class="btn btn-primary" :href="to('drucker')" @click="go($event, to('drucker'))"><ui-icon name="network"/>{{ O.addHost }}</a>
          </div>
        </template>
        <p v-else class="empty">{{ O.noPrinter }}
          <a class="link" :href="to('drucker')" @click="go($event, to('drucker'))">{{ T.nav.pages.drucker }}</a></p>
      </section>

      <!-- Tiles: the whole tile leads to its page, the small links below it further on -->
      <div class="home-tiles">
        <section class="tile" aria-labelledby="tile-filaments">
          <h2 id="tile-filaments" class="tile-title"><a class="tile-link" :href="to('filamente', modelIdx)" @click="go($event, to('filamente', modelIdx))"><ui-icon name="spool"/>{{ T.nav.pages.filamente }}</a></h2>
          <p class="tile-num">{{ nozzle?.counts?.visible ?? 0 }}</p>
          <p class="tile-sub">{{ nozzle ? O.visibleAt(nozzleText) : '' }}</p>
          <div class="tile-spools">
            <span v-for="f in own.slice(0, SPOOLS)" :key="f.name" :title="plainName(f.name)"><spool-icon :colour="f.colour || NO_COLOUR" :size="26"/></span>
            <small>{{ O.own(own.length) }}{{ own.length > SPOOLS ? ' · ' + O.more(own.length - SPOOLS) : '' }}</small>
          </div>
          <p class="tile-more">
            <a :href="to('import')" @click="go($event, to('import'))">{{ T.nav.pages.import }}</a>
            <a v-if="isU1" :href="to('kalibrieren')" @click="go($event, to('kalibrieren'))">{{ T.nav.pages.kalibrieren }}</a>
            <a v-if="INSTANCES.length > 1" :href="to('transfer')" @click="go($event, to('transfer'))">{{ T.nav.pages.transfer }}</a>
          </p>
        </section>
        <section class="tile" aria-labelledby="tile-processes">
          <h2 id="tile-processes" class="tile-title"><a class="tile-link" :href="to('prozesse', modelIdx)" @click="go($event, to('prozesse', modelIdx))"><ui-icon name="layers"/>{{ T.nav.pages.prozesse }}</a></h2>
          <p class="tile-num">{{ nozzle?.process_count ?? 0 }}</p>
          <p class="tile-sub">{{ nozzle ? O.atNozzle(nozzleText) : '' }}</p>
        </section>
        <section class="tile" aria-labelledby="tile-backups">
          <h2 id="tile-backups" class="tile-title"><a class="tile-link" :href="to('sicherungen')" @click="go($event, to('sicherungen'))"><ui-icon name="backup"/>{{ T.nav.pages.sicherungen }}</a></h2>
          <p class="tile-num">{{ backups.length }}</p>
          <p class="tile-sub">{{ newestBackup ? O.lastBackup(whenText(new Date(newestBackup.created))) : O.noBackup }}</p>
        </section>
        <section :class="['tile', { 'is-news': news }]" aria-labelledby="tile-news">
          <h2 id="tile-news" class="tile-title"><a class="tile-link" :href="to('aenderungen')" @click="go($event, to('aenderungen'))"><ui-icon name="diff"/>{{ T.nav.pages.aenderungen }}</a></h2>
          <p class="tile-num">{{ news }}</p>
          <p class="tile-sub">{{ O.sinceLast }}</p>
        </section>
      </div>

      <section class="box home-clean" aria-labelledby="home-clean">
        <h2 id="home-clean" class="home-clean-title">{{ T.nav.pages.bereinigen }}<small>{{ O.cleanLead }}</small></h2>
        <clean-drop/>
      </section>

      <!-- The installations, as in the top bar, with the pages about them -->
      <p class="home-foot">
        <span v-for="i in INSTANCES" :key="i.id" :class="{ 'is-current': i.id === inst.id }">{{ i.slicer }} <span class="version">{{ i.version }}</span> <run-status :inst="i"/></span>
        <span class="home-foot-links">
          <a :href="to('slicer')" @click="go($event, to('slicer'))">{{ T.nav.pages.slicer }}</a>
          <a :href="to('logs')" @click="go($event, to('logs'))">{{ T.nav.pages.logs }}</a>
        </span>
      </p>
    </div>
  `,
};
