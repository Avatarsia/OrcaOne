// Page "Übersicht", the first page of the slicer part (the user's wishes of 24.09.2026: what
// OrcaOne works with at a glance, as pictures rather than lists; of 25.09.2026: the slicers'
// profiles and the printers themselves apart). The printer of the top bar with its nozzle; with a
// network address a way to it in the printer part, whose first page "Drucker" shows it live. Tiles
// lead on: filaments and processes of the chosen nozzle, backups, what changed since last time;
// "3MF bereinigen" takes a file right here. Reads only.
import {
  INSTANCES, BACKUPS, NEWS, U1_MODELS, ui, go, hashOf, printerModels, modelName, nozzleLabel, chosenNozzle, nozzleKey, whenText, hosts, loadHosts,
} from "../common.js";
import { T, plainName } from "../texts.js";
import { CleanDrop } from "./bereinigen.js";

const { computed, onMounted } = Vue;
const O = T.home;
const SPOOLS = 10;         // own filaments shown as spools, the rest as a number
const NO_COLOUR = "#D9D9D9";  // a spool without a colour

export default {
  name: "UebersichtPage",
  components: { CleanDrop },
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

    // Its address, as the printer part keeps it: then the way over there.
    const host = computed(() => hosts.value?.[ui.printer]?.host || "");
    onMounted(() => { if (!hosts.value) loadHosts(); });

    // ------------------------------------------------------------ the tiles
    const backups = computed(() => BACKUPS[inst.value.id]?.backups || []);
    const newestBackup = computed(() => backups.value.reduce((a, b) => (!a || b.created > a.created ? b : a), null));
    const news = computed(() => NEWS[inst.value.id] || 0);

    const to = (page, idx = null) => hashOf(page, inst.value.id, idx);
    return {
      T, O, INSTANCES, inst, model, modelIdx, isU1, nozzle, nozzleText, own, host,
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

      <!-- The printer of the top bar; live it is in the printer part -->
      <section class="box home-printer" :aria-label="O.printer">
        <template v-if="model">
          <div class="home-printer-main">
            <div class="home-printer-top">
              <a class="home-printer-img" :href="to('druckerprofile')" :title="T.nav.pages.druckerprofile" @click="go($event, to('druckerprofile'))">
                <img :src="model.cover" alt="" width="140" height="140"></a>
              <div class="home-printer-body">
                <h2 class="home-name">{{ modelName(model) }}</h2>
                <p v-if="nozzle" class="home-nozzle"><nozzle-icon :sizes="nozzle.variant.split('+').map(Number)" :height="22"/>{{ O.nozzle(nozzleText) }}</p>
                <p v-if="host" class="card-host"><ui-icon name="network" :size="16"/><span class="card-host-value">{{ host }}</span></p>
              </div>
            </div>
          </div>
          <div class="home-actions">
            <a v-if="host" class="btn btn-primary" :href="to('drucker')" @click="go($event, to('drucker'))"><ui-icon name="printer"/>{{ O.toMachine }}</a>
            <a class="btn" :href="to('druckerprofile')" @click="go($event, to('druckerprofile'))"><ui-icon name="printer"/>{{ T.nav.pages.druckerprofile }}</a>
          </div>
        </template>
        <p v-else class="empty">{{ O.noPrinter }}
          <a class="link" :href="to('druckerprofile')" @click="go($event, to('druckerprofile'))">{{ T.nav.pages.druckerprofile }}</a></p>
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
