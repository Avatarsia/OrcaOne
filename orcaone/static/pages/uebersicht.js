// Page "Übersicht", the start page (the user's wish of 24.09.2026): what OrcaOne works with at a
// glance, each part with buttons to the pages that go on from there. The printer of the top bar,
// read live every few seconds while the page is visible if it has an address (camera.status, as on
// "Kamera"); its filaments and processes in the slicer; the installations with their newest
// backup and what changed since last time; and "3MF bereinigen" to drop a file on. Reads only.
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
const SPOOLS = 12;         // own filaments shown as spools, the rest as a number

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
    const own = computed(() => inst.value.filaments.filter((f) => f.origin_kind === "user"));

    // ------------------------------------------------------------ the printer itself
    const host = ref(null);          // null while OrcaOne looks it up, "" without an address
    const state = ref(null);         // camera.status: job, progress, heads
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
    onUnmounted(() => clearInterval(timer));
    // The heads with their spools, only where the printer knows its spools (the U1).
    const heads = computed(() => ((state.value?.heads || []).some((h) => h.spool) ? state.value.heads : []));
    const headTitle = (h, i) => [T.u1.head(i + 1), h.spool ? [h.spool.vendor, h.spool.type, h.spool.subtype].filter(Boolean).join(" ") : P.live.empty].join(": ");

    // ------------------------------------------------------------ the slicer
    const newestBackup = computed(() => (BACKUPS[inst.value.id]?.backups || []).reduce((a, b) => (!a || b.created > a.created ? b : a), null));
    const news = computed(() => NEWS[inst.value.id] || 0);

    const to = (page, idx = null) => hashOf(page, inst.value.id, idx);
    return {
      T, O, P, INSTANCES, inst, model, modelIdx, isU1, nozzle, own, host, state, unreachable, heads, headTitle, newestBackup, news,
      SPOOLS, to, go, modelName, nozzleLabel, plainName, whenText,
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

      <!-- The printer of the top bar, live if it has an address -->
      <section class="box home-printer" :aria-label="O.printer">
        <template v-if="model">
          <div class="home-printer-top">
            <img class="home-printer-img" :src="model.cover" alt="" width="120" height="120">
            <div class="home-printer-body">
              <h2 class="home-name">{{ modelName(model) }}</h2>
              <p v-if="host" class="card-host"><ui-icon name="network" :size="16"/><span class="card-host-value">{{ host }}</span></p>
              <p v-else-if="host === ''" class="card-host is-missing"><ui-icon name="network" :size="16"/>{{ O.noHost }}</p>
              <p v-if="unreachable" class="cam-status is-err home-state"><span class="cam-dot"></span>{{ P.live.unreachable }}</p>
              <print-status v-else-if="state" :p="state"/>
              <p v-else-if="host" class="cam-status is-wait home-state"><span class="cam-dot"></span>{{ P.live.asking }}</p>
              <div v-if="heads.length" class="live-heads">
                <span v-for="(h, i) in heads" :key="h.extruder" :class="['live-head', { 'is-active': state.active === h.extruder && state.state === 'printing' }]" :title="headTitle(h, i)">
                  <spool-icon :colour="h.spool?.colour || '#D9D9D9'" :size="22"/>
                  <span><strong>{{ h.spool?.type || P.live.empty }}</strong><small>{{ T.u1.head(i + 1) }}</small></span>
                </span>
              </div>
            </div>
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
            <a class="btn" :href="to('drucker')" @click="go($event, to('drucker'))"><ui-icon name="printer"/>{{ T.nav.pages.drucker }}</a>
          </div>
        </template>
        <p v-else class="empty">{{ O.noPrinter }}
          <a class="link" :href="to('drucker')" @click="go($event, to('drucker'))">{{ T.nav.pages.drucker }}</a></p>
      </section>

      <div class="home-grid">
        <section class="box home-card" aria-labelledby="home-profiles">
          <h2 id="home-profiles" class="home-card-title"><ui-icon name="spool"/>{{ O.profiles }}</h2>
          <p v-if="nozzle" class="home-fact">{{ O.atNozzle(nozzleLabel(nozzle.variant)) }}</p>
          <p v-if="nozzle" class="home-fact home-counts">
            <span><strong>{{ nozzle.counts?.visible ?? 0 }}</strong> {{ O.filaments(nozzle.counts?.visible ?? 0) }}</span>
            <span><strong>{{ nozzle.process_count ?? 0 }}</strong> {{ O.processes(nozzle.process_count ?? 0) }}</span>
          </p>
          <div class="home-own">
            <span v-for="f in own.slice(0, SPOOLS)" :key="f.name" :title="plainName(f.name)"><spool-icon :colour="f.colour || '#D9D9D9'" :size="24"/></span>
            <span class="home-fact">{{ O.own(own.length) }}{{ own.length > SPOOLS ? ' · ' + O.more(own.length - SPOOLS) : '' }}</span>
          </div>
          <div class="home-actions">
            <a class="btn" :href="to('filamente', modelIdx)" @click="go($event, to('filamente', modelIdx))"><ui-icon name="spool"/>{{ T.nav.pages.filamente }}</a>
            <a class="btn" :href="to('prozesse', modelIdx)" @click="go($event, to('prozesse', modelIdx))"><ui-icon name="layers"/>{{ T.nav.pages.prozesse }}</a>
            <a class="btn" :href="to('import')" @click="go($event, to('import'))"><ui-icon name="import"/>{{ T.nav.pages.import }}</a>
            <a v-if="isU1" class="btn" :href="to('kalibrieren')" @click="go($event, to('kalibrieren'))"><ui-icon name="calibrate"/>{{ T.nav.pages.kalibrieren }}</a>
            <a v-if="INSTANCES.length > 1" class="btn" :href="to('transfer')" @click="go($event, to('transfer'))"><ui-icon name="transfer"/>{{ T.nav.pages.transfer }}</a>
          </div>
        </section>

        <section class="box home-card" aria-labelledby="home-slicer">
          <h2 id="home-slicer" class="home-card-title"><ui-icon name="folder"/>{{ T.nav.pages.slicer }}</h2>
          <ul class="home-insts">
            <li v-for="i in INSTANCES" :key="i.id" :class="{ 'is-current': i.id === inst.id }">
              <span>{{ i.slicer }} <span class="version">{{ i.version }}</span></span><run-status :inst="i"/>
            </li>
          </ul>
          <p class="home-fact home-line"><ui-icon name="backup" :size="16"/><span>{{ newestBackup ? O.lastBackup(whenText(new Date(newestBackup.created))) : O.noBackup }}</span></p>
          <p :class="['home-fact', 'home-line', { 'is-news': news }]"><ui-icon name="diff" :size="16"/><span>{{ news ? O.news(news) : O.noNews }}</span></p>
          <div class="home-actions">
            <a class="btn" :href="to('sicherungen')" @click="go($event, to('sicherungen'))"><ui-icon name="backup"/>{{ T.nav.pages.sicherungen }}</a>
            <a class="btn" :href="to('aenderungen')" @click="go($event, to('aenderungen'))"><ui-icon name="diff"/>{{ T.nav.pages.aenderungen }}</a>
            <a class="btn" :href="to('logs')" @click="go($event, to('logs'))"><ui-icon name="log"/>{{ T.nav.pages.logs }}</a>
          </div>
        </section>

        <section class="box home-card" aria-labelledby="home-clean">
          <h2 id="home-clean" class="home-card-title"><ui-icon name="broom"/>{{ T.nav.pages.bereinigen }}</h2>
          <p class="home-fact">{{ O.cleanLead }}</p>
          <clean-drop/>
        </section>
      </div>
    </div>
  `,
};
