// Page "Drucker": one card per printer model of a manufacturer and per own printer. Here the
// user picks the printer the slicer starts with and removes printers, together with the own
// filaments and processes that belong to that printer only. Each action opens the side panel
// with the plan first (hard rule 5); its button puts the plan into the change list (app.js).
// Data: instances[].printers_page of GET /api/data; the changeable state is `live` in common.js,
// so what goes here shows up on "Filamente", too. ops.js turns it into printer_model_off,
// printer_delete, filament_delete, default_printer and cleanup_presets.
// Removing the last model of a vendor can make the slicer delete the whole vendor package at its
// next start (FINDINGS 4.2); the plan says so and names the own printers that go with it.
// Each card also shows the printer's network address: the one typed in here (OrcaOne's own
// setting by model, saved at once), else the one of the slicer's dialog "Physical Printer"
// (print_host of an own printer). A U1 with one gets its camera and live values on the pages
// "Kamera" and "Kalibrieren" (orcaone/camera.py). With an address the card also shows what the
// printer says of itself, read only: any Klipper printer its state, versions, storage, prints in
// total and system; a U1 also its name, firmware and the nozzle and spool of every head.
import {
  INSTANCES, LOCALE, live, flash, fmtSize, go, hashOf, plural, nozzleLabel, printerShortName, printerText, profileSub, KIND_ICON, U1_MODELS, ui,
} from "../common.js";
import { T, plainName } from "../texts.js";
import { api } from "../api.js";

const { ref, reactive, computed, watch, nextTick, onMounted, onUnmounted } = Vue;

const P = T.printers;

export default {
  name: "DruckerPage",
  props: { instId: { type: String, required: true } },

  setup(props) {
    const inst = computed(() => INSTANCES.find((i) => i.id === props.instId));
    const state = computed(() => live[props.instId]);
    const readOnly = computed(() => !!inst.value.running);

    // ------------------------------------------------------------ network address per model
    const hosts = ref({});
    const addressKey = (c) => c.model || c.name;
    const hostOf = (c) => hosts.value[addressKey(c)]?.host || "";
    const hostFrom = (c) => hosts.value[addressKey(c)]?.from === "slicer" ? hosts.value[addressKey(c)].slicer : "";
    const editing = ref(null);  // card id
    const hostDraft = ref("");
    const hostError = ref("");
    function editHost(c) {
      editing.value = c.id;
      hostDraft.value = hostOf(c);
      hostError.value = "";
      nextTick(() => document.getElementById("host-" + c.id)?.focus());
    }
    async function saveHost(c) {
      try {
        hosts.value = (await api.setPrinterHost(addressKey(c), hostDraft.value)).printers;
        delete machine[addressKey(c)];
        if (hostOf(c)) readMachine(addressKey(c));
        editing.value = null;
        flash(hostDraft.value.trim() ? P.address.saved : P.address.removed);
      } catch (err) {
        hostError.value = P.address.errors[err.code] || T.errors[err.code] || T.errors.unknown;
      }
    }
    // A U1 card can look for Snapmaker printers in the LAN, as Snapmaker Orca does (mDNS, only in
    // the same LAN, not over a VPN); a hit goes in with one click.
    const isU1 = (c) => U1_MODELS.includes(c.model);
    // Any printer with Klipper and an address has a G-code console and maybe SSH; those pages open
    // with it chosen.
    function openFor(c, page) {
      ui.printerFor = addressKey(c);
      go(null, hashOf(page, inst.value.id));
    }
    const searching = ref(null);  // card id
    const found = ref({});        // card id -> printers found
    async function search(c) {
      searching.value = c.id;
      try {
        found.value = { ...found.value, [c.id]: (await api.searchPrinters()).found };
      } catch (err) {
        flash(P.address.errors[err.code] || T.errors[err.code] || T.errors.unknown);
      } finally {
        searching.value = null;
      }
    }
    async function take(c, host) {
      hostDraft.value = host;
      await saveHost(c);
      if (!hostError.value) found.value = { ...found.value, [c.id]: undefined };
    }
    onMounted(async () => {
      try {
        hosts.value = (await api.printers()).printers;
      } catch {
        hosts.value = {};
      }
      for (const model of withHost()) readMachine(model);
      timer = setInterval(() => {
        if (document.visibilityState === "visible") for (const model of withHost()) readState(model);
      }, 10000);
    });

    // ------------------------------------------------------------ the printer itself (camera.info, status)
    // By model, like the address. The state again every 10 s while the page is visible.
    const machine = reactive({});  // model -> { info, state, error }
    let timer = 0;
    onUnmounted(() => clearInterval(timer));
    const withHost = () => [...new Set(cards.value.map(addressKey))].filter((m) => hosts.value[m]?.host);
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
    const machineOf = (c) => (hostOf(c) ? machine[addressKey(c)] || { asking: true } : null);
    const number = (v, digits = 0) => v.toLocaleString(LOCALE, { maximumFractionDigits: digits });
    function duration(seconds) {
      const minutes = Math.round(seconds / 60);
      if (minutes < 60) return P.live.minutes(minutes);
      if (minutes < 48 * 60) return P.live.hours(Math.floor(minutes / 60), minutes % 60);
      return P.live.days(Math.floor(minutes / 1440));
    }
    // State as text plus colour, as on "Kamera": what Klipper and the job say.
    function stateOf(c) {
      const m = machineOf(c);
      if (!m) return null;
      if (m.error) return { cls: "is-err", text: P.live.unreachable };
      if (m.asking && !m.info) return { cls: "is-wait", text: P.live.asking };
      if (m.info?.state && m.info.state !== "ready") return { cls: "is-err", text: P.live.klipper(m.info.state) };
      const s = m.state || {};
      const job = s.state || "standby";
      const parts = [T.u1.states[job] || job];
      if ((job === "printing" || job === "paused") && s.progress != null) parts.push(`${Math.round(s.progress * 100)} %`);
      return { cls: { printing: "is-ok", complete: "is-ok", standby: "is-ok", paused: "is-warn", cancelled: "is-warn", error: "is-err" }[job] || "is-wait",
               text: parts.join(" · ") };
    }
    // The heads with nozzle and spool: only where the printer knows its spools (the U1).
    function headsOf(c) {
      const m = machineOf(c), heads = m?.state?.heads || [];
      if (!heads.some((h) => h.spool)) return [];
      return heads.map((h, i) => ({ ...h, nozzle: m.info?.nozzles?.[i] }));
    }
    const headTitle = (h) => (h.spool ? [h.spool.vendor, h.spool.type, h.spool.subtype, h.spool.rfid ? P.live.rfid : null].filter(Boolean).join(" · ") : P.live.empty);
    // Four rows on the card, the details in their tooltips: not too much at first glance.
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
    // Per card id: the rows it shows of the printer itself, null without an answer.
    const rowsOf = computed(() => Object.fromEntries(cards.value.map((c) => {
      const info = machineOf(c)?.info;
      return [c.id, info ? { firmware: firmwareOf(info), heads: headsOf(c), storage: storageOf(info), jobs: jobsOf(info) } : null];
    })));
    const networkOf = (info) => (!info?.network ? "" : /^wl/.test(info.network) ? P.live.wlan : /^(eth|en)/.test(info.network) ? P.live.lan : info.network);

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
      hostOf, hostFrom, editing, hostDraft, hostError, editHost, saveHost, isU1, openFor, searching, found, search, take,
      machineOf, stateOf, rowsOf, headTitle, networkOf, nozzleText: (d) => nozzleLabel(String(d)),
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
            <div class="pcard-top">
            <span class="card-img"><img :src="c.cover" alt="" width="104" height="104" :class="{ dim: !c.visible }"></span>
            <div class="pcard-body">
              <h3 class="card-name">{{ c.label }}</h3>
              <span v-if="machineOf(c)?.info?.name" class="card-device">{{ machineOf(c).info.name }}</span>
              <span v-if="c.sub" class="card-sub">{{ c.sub }}</span>
              <p class="tags">
                <span v-if="c.isDefault" class="tag tag-default"><ui-icon name="star" :size="14"/>{{ P.tags.default }}</span>
                <span class="tag"><ui-icon :name="c.tagIcon" :size="14"/>{{ c.tag }}</span>
              </p>
              <p v-if="stateOf(c)" :class="['cam-status', 'card-state', stateOf(c).cls]"><span class="cam-dot"></span>{{ stateOf(c).text }}</p>
              <p v-if="nozzlesOf(c).length" class="card-meta">
                <nozzle-icon :sizes="[0.4]" :height="20"/><span class="sr-only">{{ P.nozzlesLabel }}</span>
                <span class="nz-chips">
                  <span v-for="p in nozzlesOf(c)" :key="p.name" :class="['nz-chip', { 'is-default': p.name === state.defaultPrinter }]"
                        :title="p.name === state.defaultPrinter ? P.tags.default : null">{{ nozzleLabel(p.variant) }}</span>
                </span>
                mm
              </p>
              <p v-if="!c.visible" class="card-problem" :title="c.problem"><ui-icon name="info" :size="16"/>{{ c.unresolved ? P.unresolved : P.notVisible }}</p>
              <form v-if="editing === c.id" class="card-host is-editing" @submit.prevent="saveHost(c)">
                <label class="sr-only" :for="'host-' + c.id">{{ P.address.label }}</label>
                <input :id="'host-' + c.id" v-model="hostDraft" class="input" type="text" autocomplete="off" :placeholder="P.address.hint"
                       @keydown.esc="editing = null">
                <button class="btn btn-primary" type="submit">{{ P.address.save }}</button>
                <button class="btn" type="button" @click="editing = null">{{ T.cancel }}</button>
                <p v-if="hostError" class="field-error" role="alert">{{ hostError }}</p>
              </form>
              <p v-else :class="['card-host', { 'is-missing': !hostOf(c) }]" :title="P.address.why">
                <ui-icon name="network" :size="16"/>
                <template v-if="hostOf(c)">
                  <span class="card-host-value">{{ hostOf(c) }}</span>
                  <small v-if="networkOf(machineOf(c)?.info)" class="card-host-from">{{ networkOf(machineOf(c).info) }}</small>
                  <small v-if="hostFrom(c)" class="card-host-from">{{ P.address.fromSlicer(hostFrom(c)) }}</small>
                </template>
                <span v-else>{{ P.address.none }}</span>
                <button class="link" type="button" @click="editHost(c)">{{ hostOf(c) ? P.address.change : P.address.add }}</button>
                <button v-if="isU1(c)" class="link" type="button" :disabled="searching === c.id" @click="search(c)">
                  {{ searching === c.id ? P.address.searching : P.address.search }}</button>
              </p>
              <ul v-if="found[c.id]" class="card-found">
                <li v-for="f in found[c.id]" :key="f.host">
                  <span class="grow"><strong>{{ f.name }}</strong> <span class="card-host-value">{{ f.host }}</span>
                    <small v-if="f.machine_type">{{ f.machine_type }}</small></span>
                  <button class="btn" type="button" @click="take(c, f.host)">{{ P.address.take }}</button>
                </li>
                <li v-if="!found[c.id].length" class="card-found-none">{{ P.address.foundNone }}</li>
              </ul>
            </div>
            </div>
            <dl v-if="rowsOf[c.id]" class="pcard-live">
              <div :title="rowsOf[c.id].firmware.title"><dt>{{ P.live.firmware }}</dt><dd>{{ rowsOf[c.id].firmware.text }}</dd></div>
              <div v-if="rowsOf[c.id].heads.length"><dt>{{ P.live.heads }}</dt>
                <dd class="live-heads">
                  <span v-for="(h, i) in rowsOf[c.id].heads" :key="i" class="live-head" :title="T.u1.head(i + 1) + ': ' + headTitle(h)">
                    <spool-icon :colour="h.spool?.colour || '#D9D9D9'" :size="22"/>
                    <span><strong>{{ h.spool?.type || P.live.empty }}</strong><small>{{ h.nozzle ? nozzleText(h.nozzle) + ' mm' : T.u1.head(i + 1) }}</small></span>
                  </span>
                </dd></div>
              <div v-if="rowsOf[c.id].storage" :title="rowsOf[c.id].storage.title"><dt>{{ P.live.storage }}</dt>
                <dd><span class="live-bar"><span :style="{ width: rowsOf[c.id].storage.pct + '%' }"></span></span>{{ rowsOf[c.id].storage.text }}</dd></div>
              <div v-if="rowsOf[c.id].jobs" :title="rowsOf[c.id].jobs.title"><dt>{{ P.live.jobs }}</dt><dd>{{ rowsOf[c.id].jobs.text }}</dd></div>
            </dl>
            <p v-if="hostOf(c)" class="live-links">
              <a class="link" :href="'http://' + hostOf(c) + '/'" target="_blank" rel="noopener">{{ P.live.web }}</a>
              <a v-if="isU1(c)" class="link" :href="hashOf('dateien', inst.id)">{{ P.live.files }}</a>
              <a v-if="isU1(c)" class="link" :href="hashOf('kamera', inst.id)">{{ P.live.camera }}</a>
              <a class="link" :href="hashOf('konsole', inst.id)" @click.prevent="openFor(c, 'konsole')">{{ P.live.console }}</a>
              <a class="link" :href="hashOf('ssh', inst.id)" @click.prevent="openFor(c, 'ssh')">{{ P.live.ssh }}</a>
            </p>
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
