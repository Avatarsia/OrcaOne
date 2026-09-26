// Page "Drucker", the first page of the printer part (the user's wish of 25.09.2026: the slicers'
// profiles and the printers themselves apart). One card per printer with a network address, with
// what it says of itself, read only over Moonraker, for any Klipper printer: its state and job,
// firmware, storage, prints in total; a U1 also its name and the nozzle and spool of every head.
// From the card on to its web interface, status, files, views, camera, console, SSH and network. The address
// is OrcaOne's own setting per printer (camera.py), saved at once; without one OrcaOne takes the
// slicer's (print_host of an own printer, or the printer Snapmaker Orca is connected to). A printer
// goes by its model, a second one of the same model by a name of its own (the user's wish of
// 25.09.2026: two printers of one model). Printers of the slicer without an address are listed
// below to give them one; a U1 can also be looked for in the LAN, as Snapmaker Orca does (mDNS,
// only in the same LAN, not over a VPN).
import {
  INSTANCES, LOCALE, flash, fmtSize, go, hashOf, nozzleLabel, printerModels, modelName, U1_MODELS, ui, hosts, loadHosts, machines, slicersOf,
  addressKey,
} from "../common.js";
import { T } from "../texts.js";
import { api } from "../api.js";
import { PrintStatus } from "./kamera.js";
import { watchPrinters, live as printerLive } from "../live.js";

const { ref, reactive, computed, nextTick, onMounted } = Vue;
const P = T.printers, M = T.machines;

export default {
  name: "DruckerPage",
  components: { PrintStatus },
  props: { instId: { type: String, default: null } },  // the page does not depend on an installation

  setup() {
    const isU1 = (model) => U1_MODELS.includes(model);
    // The printer OrcaOne works with, chosen in the top bar (app.js): a click on a card chooses it,
    // the links to its pages choose it first.
    const isActive = (key) => key === ui.printer;
    const choose = (key) => { ui.printer = key; };
    function openFor(key, page) {
      choose(key);
      go(null, hashOf(page, ui.instId));
    }
    // The slicers' printers without an address yet, of every installation (this part depends on
    // none), one per model as the addresses go.
    const others = computed(() => {
      const known = new Set(machines.value.map((m) => m.model));
      return INSTANCES.flatMap((i) => printerModels(i)).filter((m) => !known.has(addressKey(m)) && known.add(addressKey(m)))
        .map((m) => ({ model: addressKey(m), name: modelName(m), cover: m.cover }));
    });

    // ------------------------------------------------------------ the address
    // By the printer's name (machines, key); a model's name for one of the slicer's without one.
    const editing = ref(null);
    const draft = ref("");
    const addressError = ref("");
    const errorText = (err) => P.address.errors[err.code] || T.errors[err.code] || T.errors.unknown;
    const hostFrom = (key) => (hosts.value?.[key]?.from === "slicer" ? hosts.value[key].slicer : "");
    function edit(key) {
      editing.value = key;
      draft.value = hosts.value?.[key]?.host || "";
      addressError.value = "";
      nextTick(() => document.getElementById("host-" + key)?.focus());
    }
    async function save(key) {
      try {
        hosts.value = (await api.setPrinterHost(key, draft.value)).printers;
        delete machine[key];
        if (hosts.value[key]) readMachine(key);
        editing.value = null;
        flash(draft.value.trim() ? P.address.saved : P.address.removed);
      } catch (err) {
        addressError.value = errorText(err);
      }
    }
    // Another printer of a model that has one: a name of its own and its address.
    const models = computed(() => [...new Set(machines.value.map((m) => m.model))]);
    const adding = reactive({ open: false, model: "", name: "", host: "", error: "" });
    function startAdd() {
      Object.assign(adding, { open: true, model: models.value[0] || "", name: "", host: "", error: "" });
      nextTick(() => document.getElementById("add-name")?.focus());
    }
    async function add() {
      try {
        hosts.value = (await api.addPrinter(adding.model, adding.name, adding.host)).printers;
        const key = adding.name.trim();
        adding.open = false;
        readMachine(key);
        flash(P.address.added);
      } catch (err) {
        adding.error = errorText(err);
      }
    }
    const modelLabel = (model) => machines.value.find((m) => m.key === model)?.name || model;
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
    // The firmware and the like once (camera.info); state, job and heads live over Moonraker's
    // WebSocket (live.js), as camera.status gives them: the monitor's job with the heads.
    const machine = reactive({});  // printer's name -> { info, error, asking }
    watchPrinters(() => machines.value.map((m) => m.key));
    function stateOf(key) {
      const m = printerLive[key]?.data?.monitor;
      return m ? { ...m.job, heads: m.heads } : null;
    }
    async function readMachine(model) {
      machine[model] = { ...machine[model], asking: true };
      try {
        machine[model] = { ...machine[model], info: await api.printerInfo(model), error: "", asking: false };
      } catch (err) {
        machine[model] = { ...machine[model], info: null, error: err.code || "unknown", asking: false };
      }
    }
    onMounted(async () => {
      await loadHosts();
      for (const m of machines.value) readMachine(m.key);
      // From "Übersicht" ("Mit dem Drucker verbinden"): the form for that printer at once.
      const asked = ui.addressFor;
      ui.addressFor = null;
      if (others.value.some((o) => o.model === asked)) edit(asked);
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
      const m = machine[model] || { asking: true }, now = printerLive[model];
      if (m.error || now?.error === "camera_unreachable") return { cls: "is-err", text: P.live.unreachable };
      if (m.asking && !m.info) return { cls: "is-wait", text: P.live.asking };
      // Klipper's state live, else as the info found it.
      const klipper = now?.data?.monitor.klipper.state || m.info?.state;
      if (klipper && klipper !== "ready") return { cls: "is-err", text: P.live.klipper(klipper) };
      return stateOf(model) ? null : { cls: "is-wait", text: P.live.asking };
    }
    // The heads with nozzle and spool: only where the printer knows its spools (the U1).
    function headsOf(model) {
      const m = machine[model], heads = stateOf(model)?.heads || [];
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
    // Per printer: the rows the card shows of the printer itself, null without an answer.
    const rowsOf = computed(() => Object.fromEntries(machines.value.map(({ key }) => {
      const info = machine[key]?.info;
      return [key, info ? { firmware: firmwareOf(info), heads: headsOf(key), storage: storageOf(info), jobs: jobsOf(info) } : null];
    })));
    const networkOf = (model) => {
      const net = machine[model]?.info?.network;
      return !net ? "" : /^wl/.test(net) ? P.live.wlan : /^(eth|en)/.test(net) ? P.live.lan : net;
    };

    return {
      T, P, M, hosts, machines, others, machine, isU1, isActive, choose, openFor, editing, draft, addressError, hostFrom, edit, save, slicersOf,
      models, adding, startAdd, add, modelLabel,
      searching, found, search, take, problemOf, rowsOf, headTitle, networkOf, nozzleText: (d) => nozzleLabel(String(d)), hashOf,
      stateOf,
    };
  },

  template: `
    <div class="page">
      <div class="page-head">
        <h1 id="page-title" tabindex="-1">{{ M.title }}</h1>
        <p>{{ M.lead }}</p>
      </div>

      <div v-if="machines.length" class="cards pcards">
        <article v-for="m in machines" :key="m.key" :class="['pcard', { 'is-active': isActive(m.key) }]" :aria-label="m.name">
          <div class="pcard-top">
            <span class="card-img" :title="P.makeActive" @click="choose(m.key)"><img :src="m.cover" alt="" width="104" height="104"></span>
            <div class="pcard-body">
              <h3 class="card-name"><button class="card-pick" type="button" :aria-pressed="isActive(m.key) ? 'true' : 'false'" :title="P.makeActive"
                                            @click="choose(m.key)">{{ m.name }}</button></h3>
              <span v-if="m.key !== m.model" class="card-device">{{ m.model }}</span>
              <span v-if="machine[m.key]?.info?.name" class="card-device">{{ machine[m.key].info.name }}</span>
              <!-- In which slicer it is set up (the user's wish), the star where the slicer starts with it -->
              <p class="tags">
                <span v-if="isActive(m.key)" class="tag tag-active"><ui-icon name="check" :size="14"/>{{ P.tags.active }}</span>
                <span v-for="s in slicersOf(m.model)" :key="s.id" class="tag" :title="M.inSlicer(s.slicer, s.nozzles, s.isDefault)">
                  <ui-icon :name="s.isDefault ? 'star' : 'folder'" :size="14"/>{{ s.slicer }}</span>
                <span v-if="!slicersOf(m.model).length" class="tag">{{ M.noSlicer }}</span>
              </p>
              <p v-if="problemOf(m.key)" :class="['cam-status', 'card-state', problemOf(m.key).cls]"><span class="cam-dot"></span>{{ problemOf(m.key).text }}</p>
              <print-status v-else :p="stateOf(m.key)"/>
              <form v-if="editing === m.key" class="card-host is-editing" @submit.prevent="save(m.key)">
                <label class="sr-only" :for="'host-' + m.key">{{ P.address.label }}</label>
                <input :id="'host-' + m.key" v-model="draft" class="input" type="text" autocomplete="off" :placeholder="P.address.hint"
                       @keydown.esc="editing = null">
                <button class="btn btn-primary" type="submit">{{ P.address.save }}</button>
                <button class="btn" type="button" @click="editing = null">{{ T.cancel }}</button>
                <p v-if="addressError" class="field-error" role="alert">{{ addressError }}</p>
              </form>
              <p v-else class="card-host" :title="P.address.why">
                <ui-icon name="network" :size="16"/>
                <span class="card-host-value">{{ m.host }}</span>
                <small v-if="networkOf(m.key)" class="card-host-from">{{ networkOf(m.key) }}</small>
                <small v-if="hostFrom(m.key)" class="card-host-from">{{ P.address.fromSlicer(hostFrom(m.key)) }}</small>
                <button class="link" type="button" @click="edit(m.key)">{{ P.address.change }}</button>
              </p>
            </div>
          </div>
          <dl v-if="rowsOf[m.key]" class="pcard-live">
            <div :title="rowsOf[m.key].firmware.title"><dt>{{ P.live.firmware }}</dt><dd>{{ rowsOf[m.key].firmware.text }}</dd></div>
            <div v-if="rowsOf[m.key].heads.length"><dt>{{ P.live.heads }}</dt>
              <dd class="live-heads">
                <span v-for="(h, i) in rowsOf[m.key].heads" :key="i" class="live-head" :title="T.u1.head(i + 1) + ': ' + headTitle(h)">
                  <spool-icon :colour="h.spool?.colour || '#D9D9D9'" :size="22"/>
                  <span><strong>{{ h.spool?.type || P.live.empty }}</strong><small>{{ h.nozzle ? nozzleText(h.nozzle) + ' mm' : T.u1.head(i + 1) }}</small></span>
                </span>
              </dd></div>
            <div v-if="rowsOf[m.key].storage" :title="rowsOf[m.key].storage.title"><dt>{{ P.live.storage }}</dt>
              <dd><span class="live-bar"><span :style="{ width: rowsOf[m.key].storage.pct + '%' }"></span></span>{{ rowsOf[m.key].storage.text }}</dd></div>
            <div v-if="rowsOf[m.key].jobs" :title="rowsOf[m.key].jobs.title"><dt>{{ P.live.jobs }}</dt><dd>{{ rowsOf[m.key].jobs.text }}</dd></div>
          </dl>
          <p class="live-links">
            <a class="link" :href="'http://' + m.host + '/'" target="_blank" rel="noopener">{{ P.live.web }}</a>
            <a class="link" :href="hashOf('status', null)" @click.prevent="openFor(m.key, 'status')">{{ T.nav.pages.status }}</a>
            <a v-if="isU1(m.model)" class="link" :href="hashOf('dateien', null)" @click.prevent="openFor(m.key, 'dateien')">{{ T.nav.pages.dateien }}</a>
            <a class="link" :href="hashOf('druck3d', null)" @click.prevent="openFor(m.key, 'druck3d')">{{ T.nav.pages.druck3d }}</a>
            <a class="link" :href="hashOf('druck2d', null)" @click.prevent="openFor(m.key, 'druck2d')">{{ T.nav.pages.druck2d }}</a>
            <a v-if="isU1(m.model)" class="link" :href="hashOf('kamera', null)" @click.prevent="openFor(m.key, 'kamera')">{{ T.nav.pages.kamera }}</a>
            <a class="link" :href="hashOf('konsole', null)" @click.prevent="openFor(m.key, 'konsole')">{{ T.nav.pages.konsole }}</a>
            <a class="link" :href="hashOf('ssh', null)" @click.prevent="openFor(m.key, 'ssh')">{{ T.nav.pages.ssh }}</a>
            <a class="link" :href="hashOf('netzwerk', null)" @click.prevent="openFor(m.key, 'netzwerk')">{{ T.nav.pages.netzwerk }}</a>
          </p>
        </article>
      </div>
      <p v-else-if="hosts" class="empty">{{ M.none }}</p>
      <!-- A second printer of a model that has one already -->
      <p v-if="machines.length && !adding.open" class="machine-add"><button class="link" type="button" @click="startAdd">
        <ui-icon name="plus" :size="16"/>{{ P.address.another }}</button></p>
      <form v-if="adding.open" class="box machine-add-form" @submit.prevent="add">
        <h2>{{ P.address.another }}</h2>
        <div class="machine-add-fields">
          <label>{{ P.address.model }}
            <select v-model="adding.model" class="input">
              <option v-for="mo in models" :key="mo" :value="mo">{{ modelLabel(mo) }}</option>
            </select></label>
          <label>{{ P.address.name }}
            <input id="add-name" v-model="adding.name" class="input" type="text" autocomplete="off" :placeholder="P.address.nameHint"></label>
          <label>{{ P.address.label }}
            <input v-model="adding.host" class="input" type="text" autocomplete="off" :placeholder="P.address.hint"></label>
        </div>
        <p v-if="adding.error" class="field-error" role="alert">{{ adding.error }}</p>
        <div class="actions">
          <button class="btn" type="button" @click="adding.open = false">{{ T.cancel }}</button>
          <button class="btn btn-primary right" type="submit" :disabled="!adding.name.trim() || !adding.host.trim()">{{ P.address.addPrinter }}</button>
        </div>
      </form>

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
