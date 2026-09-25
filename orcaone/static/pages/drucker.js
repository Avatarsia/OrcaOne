// Page "Drucker", the first page of the printer part (the user's wish of 25.09.2026: the slicers'
// profiles and the printers themselves apart). One card per printer with a network address, with
// what it says of itself, read only over Moonraker, for any Klipper printer: its state and job,
// firmware, storage, prints in total; a U1 also its name and the nozzle and spool of every head.
// From the card on to its web interface, status, files, views, camera, console and SSH. The address
// is OrcaOne's own setting by model (camera.py), saved at once; without one OrcaOne takes the
// slicer's (print_host of an own printer, or the printer Snapmaker Orca is connected to). Printers
// of the slicer without an address are listed below to give them one; a U1 can also be looked for
// in the LAN, as Snapmaker Orca does (mDNS, only in the same LAN, not over a VPN).
import {
  INSTANCES, LOCALE, flash, fmtSize, go, hashOf, nozzleLabel, printerModels, modelName, U1_MODELS, ui, hosts, loadHosts, machines, slicersOf,
} from "../common.js";
import { T } from "../texts.js";
import { api } from "../api.js";
import { PrintStatus } from "./kamera.js";

const { ref, reactive, computed, nextTick, onMounted, onUnmounted } = Vue;
const P = T.printers, M = T.machines;
const EVERY = 10000;  // ms between two looks at the printers while the page is visible

export default {
  name: "DruckerPage",
  components: { PrintStatus },
  props: { instId: { type: String, default: null } },  // the page does not depend on an installation

  setup() {
    const isU1 = (model) => U1_MODELS.includes(model);
    // The printer OrcaOne works with, chosen in the top bar (app.js): a click on a card chooses it,
    // the links to its pages choose it first.
    const isActive = (model) => model === ui.printer;
    const choose = (model) => { ui.printer = model; };
    function openFor(model, page) {
      choose(model);
      go(null, hashOf(page, ui.instId));
    }
    // The slicers' printers without an address yet, of every installation (this part depends on
    // none), one per model as the addresses go.
    const others = computed(() => {
      const known = new Set(machines.value.map((m) => m.model));
      return INSTANCES.flatMap((i) => printerModels(i)).filter((m) => !known.has(m.model) && known.add(m.model))
        .map((m) => ({ model: m.model, name: modelName(m), cover: m.cover }));
    });

    // ------------------------------------------------------------ the address
    const editing = ref(null);  // model
    const draft = ref("");
    const addressError = ref("");
    const hostFrom = (model) => (hosts.value?.[model]?.from === "slicer" ? hosts.value[model].slicer : "");
    function edit(model) {
      editing.value = model;
      draft.value = hosts.value?.[model]?.host || "";
      addressError.value = "";
      nextTick(() => document.getElementById("host-" + model)?.focus());
    }
    async function save(model) {
      try {
        hosts.value = (await api.setPrinterHost(model, draft.value)).printers;
        delete machine[model];
        if (hosts.value[model]) readMachine(model);
        editing.value = null;
        flash(draft.value.trim() ? P.address.saved : P.address.removed);
      } catch (err) {
        addressError.value = P.address.errors[err.code] || T.errors[err.code] || T.errors.unknown;
      }
    }
    const searching = ref(null);  // model
    const found = ref({});        // model -> printers found in the LAN
    async function search(model) {
      searching.value = model;
      try {
        found.value = { ...found.value, [model]: (await api.searchPrinters()).found };
      } catch (err) {
        flash(P.address.errors[err.code] || T.errors[err.code] || T.errors.unknown);
      } finally {
        searching.value = null;
      }
    }
    async function take(model, host) {
      draft.value = host;
      await save(model);
      if (!addressError.value) found.value = { ...found.value, [model]: undefined };
    }

    // ------------------------------------------------------------ what the printer says (camera.info, status)
    const machine = reactive({});  // model -> { info, state, error, asking }
    let timer = 0;
    async function readState(model) {
      try {
        machine[model] = { ...machine[model], state: await api.printerState(model) };
      } catch { /* the info says whether it answers */ }
    }
    async function readMachine(model) {
      machine[model] = { ...machine[model], asking: true };
      try {
        machine[model] = { ...machine[model], info: await api.printerInfo(model), error: "", asking: false };
      } catch (err) {
        machine[model] = { ...machine[model], info: null, error: err.code || "unknown", asking: false };
      }
      readState(model);
    }
    const look = () => {
      if (document.visibilityState === "visible") for (const m of machines.value) readState(m.model);
    };
    onMounted(async () => {
      await loadHosts();
      for (const m of machines.value) readMachine(m.model);
      timer = setInterval(look, EVERY);
      // From "Druckerprofile" ("Mit dem Drucker verbinden"): the form for that printer at once.
      const asked = ui.addressFor;
      ui.addressFor = null;
      if (others.value.some((o) => o.model === asked)) edit(asked);
    });
    document.addEventListener("visibilitychange", look);
    onUnmounted(() => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", look);
    });

    const number = (v, digits = 0) => v.toLocaleString(LOCALE, { maximumFractionDigits: digits });
    function duration(seconds) {
      const minutes = Math.round(seconds / 60);
      if (minutes < 60) return P.live.minutes(minutes);
      if (minutes < 48 * 60) return P.live.hours(Math.floor(minutes / 60), minutes % 60);
      return P.live.days(Math.floor(minutes / 1440));
    }
    // Before the job: whether it answers at all and Klipper is ready.
    function problemOf(model) {
      const m = machine[model] || { asking: true };
      if (m.error) return { cls: "is-err", text: P.live.unreachable };
      if (m.asking && !m.info) return { cls: "is-wait", text: P.live.asking };
      if (m.info?.state && m.info.state !== "ready") return { cls: "is-err", text: P.live.klipper(m.info.state) };
      return m.state ? null : { cls: "is-wait", text: P.live.asking };
    }
    // The heads with nozzle and spool: only where the printer knows its spools (the U1).
    function headsOf(model) {
      const m = machine[model], heads = m?.state?.heads || [];
      if (!heads.some((h) => h.spool)) return [];
      return heads.map((h, i) => ({ ...h, nozzle: m.info?.nozzles?.[i] }));
    }
    const headTitle = (h) => (h.spool ? [h.spool.vendor, h.spool.type, h.spool.subtype, h.spool.rfid ? P.live.rfid : null].filter(Boolean).join(" · ") : P.live.empty);
    // A few rows on the card, the details in their tooltips: not too much at first glance.
    const klipperOf = (info) => (info.klipper ? String(info.klipper).replace(/_\d+$/, "") : "");
    function firmwareOf(info) {
      const s = info.system || {};
      const memory = s.memory?.total ? Math.round(s.memory.used / s.memory.total * 100) : null;
      return {
        text: info.firmware || klipperOf(info),
        title: [klipperOf(info) && P.live.klipperVersion(klipperOf(info)), info.moonraker && P.live.moonraker(info.moonraker), info.os,
                s.uptime != null && P.live.uptime(duration(s.uptime)), s.cpu_temp != null && P.live.cpu(Math.round(s.cpu_temp)),
                memory != null && P.live.memory(memory)].filter(Boolean).join("\n"),
      };
    }
    function storageOf(info) {
      const d = info.disk;
      if (!d || !d.total) return null;
      const f = info.folders || {};
      const parts = [["gcodes", f.gcodes], ["camera", f.camera], ["logs", f.logs]].filter(([, size]) => size)
        .map(([root, size]) => root === "camera" && info.videos ? P.live.videos(fmtSize(size), info.videos) : `${P.live.folders[root]}: ${fmtSize(size)}`);
      return { pct: Math.min(100, Math.round(d.used / d.total * 100)), text: P.live.used(fmtSize(d.used), fmtSize(d.total)),
               title: [P.live.free(fmtSize(d.free)), ...parts].join("\n") };
    }
    function jobsOf(info) {
      const j = info.jobs;
      if (!j || !j.total_jobs) return null;
      return { text: [P.live.prints(j.total_jobs), j.total_print_time && P.live.printed(number(j.total_print_time / 3600))].filter(Boolean).join(" · "),
               title: [j.total_filament_used && P.live.filament(number(j.total_filament_used / 1000)),
                       j.longest_print && P.live.longest(duration(j.longest_print))].filter(Boolean).join("\n") };
    }
    // Per model: the rows the card shows of the printer itself, null without an answer.
    const rowsOf = computed(() => Object.fromEntries(machines.value.map(({ model }) => {
      const info = machine[model]?.info;
      return [model, info ? { firmware: firmwareOf(info), heads: headsOf(model), storage: storageOf(info), jobs: jobsOf(info) } : null];
    })));
    const networkOf = (model) => {
      const net = machine[model]?.info?.network;
      return !net ? "" : /^wl/.test(net) ? P.live.wlan : /^(eth|en)/.test(net) ? P.live.lan : net;
    };

    return {
      T, P, M, hosts, machines, others, machine, isU1, isActive, choose, openFor, editing, draft, addressError, hostFrom, edit, save, slicersOf,
      searching, found, search, take, problemOf, rowsOf, headTitle, networkOf, nozzleText: (d) => nozzleLabel(String(d)), hashOf,
    };
  },

  template: `
    <div class="page">
      <div class="page-head">
        <h1 id="page-title" tabindex="-1">{{ M.title }}</h1>
        <p>{{ M.lead }}</p>
      </div>

      <div v-if="machines.length" class="cards pcards">
        <article v-for="m in machines" :key="m.model" :class="['pcard', { 'is-active': isActive(m.model) }]" :aria-label="m.name">
          <div class="pcard-top">
            <span class="card-img" :title="P.makeActive" @click="choose(m.model)"><img :src="m.cover" alt="" width="104" height="104"></span>
            <div class="pcard-body">
              <h3 class="card-name"><button class="card-pick" type="button" :aria-pressed="isActive(m.model) ? 'true' : 'false'" :title="P.makeActive"
                                            @click="choose(m.model)">{{ m.name }}</button></h3>
              <span v-if="machine[m.model]?.info?.name" class="card-device">{{ machine[m.model].info.name }}</span>
              <!-- In which slicer it is set up (the user's wish), the star where the slicer starts with it -->
              <p class="tags">
                <span v-if="isActive(m.model)" class="tag tag-active"><ui-icon name="check" :size="14"/>{{ P.tags.active }}</span>
                <span v-for="s in slicersOf(m.model)" :key="s.id" class="tag" :title="M.inSlicer(s.slicer, s.nozzles, s.isDefault)">
                  <ui-icon :name="s.isDefault ? 'star' : 'folder'" :size="14"/>{{ s.slicer }}</span>
                <span v-if="!slicersOf(m.model).length" class="tag">{{ M.noSlicer }}</span>
              </p>
              <p v-if="problemOf(m.model)" :class="['cam-status', 'card-state', problemOf(m.model).cls]"><span class="cam-dot"></span>{{ problemOf(m.model).text }}</p>
              <print-status v-else :p="machine[m.model].state"/>
              <form v-if="editing === m.model" class="card-host is-editing" @submit.prevent="save(m.model)">
                <label class="sr-only" :for="'host-' + m.model">{{ P.address.label }}</label>
                <input :id="'host-' + m.model" v-model="draft" class="input" type="text" autocomplete="off" :placeholder="P.address.hint"
                       @keydown.esc="editing = null">
                <button class="btn btn-primary" type="submit">{{ P.address.save }}</button>
                <button class="btn" type="button" @click="editing = null">{{ T.cancel }}</button>
                <p v-if="addressError" class="field-error" role="alert">{{ addressError }}</p>
              </form>
              <p v-else class="card-host" :title="P.address.why">
                <ui-icon name="network" :size="16"/>
                <span class="card-host-value">{{ m.host }}</span>
                <small v-if="networkOf(m.model)" class="card-host-from">{{ networkOf(m.model) }}</small>
                <small v-if="hostFrom(m.model)" class="card-host-from">{{ P.address.fromSlicer(hostFrom(m.model)) }}</small>
                <button class="link" type="button" @click="edit(m.model)">{{ P.address.change }}</button>
              </p>
            </div>
          </div>
          <dl v-if="rowsOf[m.model]" class="pcard-live">
            <div :title="rowsOf[m.model].firmware.title"><dt>{{ P.live.firmware }}</dt><dd>{{ rowsOf[m.model].firmware.text }}</dd></div>
            <div v-if="rowsOf[m.model].heads.length"><dt>{{ P.live.heads }}</dt>
              <dd class="live-heads">
                <span v-for="(h, i) in rowsOf[m.model].heads" :key="i" class="live-head" :title="T.u1.head(i + 1) + ': ' + headTitle(h)">
                  <spool-icon :colour="h.spool?.colour || '#D9D9D9'" :size="22"/>
                  <span><strong>{{ h.spool?.type || P.live.empty }}</strong><small>{{ h.nozzle ? nozzleText(h.nozzle) + ' mm' : T.u1.head(i + 1) }}</small></span>
                </span>
              </dd></div>
            <div v-if="rowsOf[m.model].storage" :title="rowsOf[m.model].storage.title"><dt>{{ P.live.storage }}</dt>
              <dd><span class="live-bar"><span :style="{ width: rowsOf[m.model].storage.pct + '%' }"></span></span>{{ rowsOf[m.model].storage.text }}</dd></div>
            <div v-if="rowsOf[m.model].jobs" :title="rowsOf[m.model].jobs.title"><dt>{{ P.live.jobs }}</dt><dd>{{ rowsOf[m.model].jobs.text }}</dd></div>
          </dl>
          <p class="live-links">
            <a class="link" :href="'http://' + m.host + '/'" target="_blank" rel="noopener">{{ P.live.web }}</a>
            <a class="link" :href="hashOf('status', null)" @click.prevent="openFor(m.model, 'status')">{{ T.nav.pages.status }}</a>
            <a v-if="isU1(m.model)" class="link" :href="hashOf('dateien', null)" @click.prevent="openFor(m.model, 'dateien')">{{ T.nav.pages.dateien }}</a>
            <a class="link" :href="hashOf('druck3d', null)" @click.prevent="openFor(m.model, 'druck3d')">{{ T.nav.pages.druck3d }}</a>
            <a class="link" :href="hashOf('druck2d', null)" @click.prevent="openFor(m.model, 'druck2d')">{{ T.nav.pages.druck2d }}</a>
            <a v-if="isU1(m.model)" class="link" :href="hashOf('kamera', null)" @click.prevent="openFor(m.model, 'kamera')">{{ T.nav.pages.kamera }}</a>
            <a class="link" :href="hashOf('konsole', null)" @click.prevent="openFor(m.model, 'konsole')">{{ T.nav.pages.konsole }}</a>
            <a class="link" :href="hashOf('ssh', null)" @click.prevent="openFor(m.model, 'ssh')">{{ T.nav.pages.ssh }}</a>
          </p>
        </article>
      </div>
      <p v-else-if="hosts" class="empty">{{ M.none }}</p>

      <!-- The slicer's printers without an address: give them one -->
      <section v-if="others.length" class="box machine-others" aria-labelledby="others-h">
        <h2 id="others-h">{{ M.others }}</h2>
        <p class="note">{{ M.othersLead }}</p>
        <ul class="plain-list">
          <li v-for="o in others" :key="o.model" class="machine-other">
            <img :src="o.cover" alt="" width="40" height="40">
            <div class="grow">
              <strong>{{ o.name }}</strong>
              <p class="tags">
                <span v-for="s in slicersOf(o.model)" :key="s.id" class="tag" :title="M.inSlicer(s.slicer, s.nozzles, s.isDefault)">
                  <ui-icon :name="s.isDefault ? 'star' : 'folder'" :size="14"/>{{ s.slicer }}</span>
              </p>
              <form v-if="editing === o.model" class="card-host is-editing" @submit.prevent="save(o.model)">
                <label class="sr-only" :for="'host-' + o.model">{{ P.address.label }}</label>
                <input :id="'host-' + o.model" v-model="draft" class="input" type="text" autocomplete="off" :placeholder="P.address.hint"
                       @keydown.esc="editing = null">
                <button class="btn btn-primary" type="submit">{{ P.address.save }}</button>
                <button class="btn" type="button" @click="editing = null">{{ T.cancel }}</button>
                <p v-if="addressError" class="field-error" role="alert">{{ addressError }}</p>
              </form>
              <ul v-if="found[o.model]" class="card-found">
                <li v-for="f in found[o.model]" :key="f.host">
                  <span class="grow"><strong>{{ f.name }}</strong> <span class="card-host-value">{{ f.host }}</span>
                    <small v-if="f.machine_type">{{ f.machine_type }}</small></span>
                  <button class="btn" type="button" @click="take(o.model, f.host)">{{ P.address.take }}</button>
                </li>
                <li v-if="!found[o.model].length" class="card-found-none">{{ P.address.foundNone }}</li>
              </ul>
            </div>
            <template v-if="editing !== o.model">
              <button class="btn" type="button" @click="edit(o.model)"><ui-icon name="network"/>{{ M.addAddress }}</button>
              <button v-if="isU1(o.model)" class="btn" type="button" :disabled="searching === o.model" @click="search(o.model)">
                {{ searching === o.model ? P.address.searching : P.address.search }}</button>
            </template>
          </li>
        </ul>
      </section>

      <p class="credits">{{ P.credits }}</p>
    </div>
  `,
};
