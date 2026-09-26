// Page "Netzwerk" (the user's wish of 25.09.2026, grown out of the page "WLAN": sending from
// Snapmaker Orca crawled now and then, only switching the U1 off and on helped): how the printer of
// the top bar is in the network and where it gets stuck (orcaone/network.py). On top the way from
// this computer over the printer and its router to the internet as a picture, each hop coloured by
// its state, and a tile per part with its main number, as on "Übersicht"; below the parts as tabs,
// one at a time (the user: the page was too long): the assessment; the WLAN with its signal, its
// curves and connecting or starting anew; the interfaces with their traffic; the checks; the WLANs
// around as a channel picture; SSH with a key. What Moonraker tells shows for any Klipper printer,
// the rest needs SSH on the U1.
import { go, hashOf, ui, activeName, hosts, loadHosts, machines, LOCALE, flash, fmtSize } from "../common.js";
import { T } from "../texts.js";
import { useLive } from "../live.js";
import { SshLogin, keygen, keyPath } from "./ssh-login.js";

const { ref, reactive, computed, watch, onMounted, onUnmounted } = Vue;
const N = T.network;
const SPAN = 300;             // s the curves show
const CHART = { w: 600, signal: 130, rate: 80, traffic: 80, low: -95, high: -35 };
const CHECKS = ["printer", "clock", "router", "internet", "dns"];
// Signal in dBm, as the usual rule of thumb has it (MetaGeek, "Understanding RSSI"): from -67 good
// enough for anything, down to -75 it works but slows at every disturbance, below that it breaks off.
const quality = (dbm) => (dbm == null ? "" : dbm >= -67 ? "good" : dbm >= -75 ? "fair" : "weak");
const bars = (dbm) => (dbm == null ? 0 : dbm >= -55 ? 4 : dbm >= -67 ? 3 : dbm >= -75 ? 2 : 1);
const QUALITY_CLASS = { good: "ok", fair: "warn", weak: "err" };
const WORST = ["err", "warn", "ok"];
const worst = (...states) => WORST.find((s) => states.includes(s)) || "";
// The four arcs of the WLAN sign around (32, 46), each a quarter circle facing up.
const ARCS = [1, 2, 3, 4].map((i) => {
  const r = i * 9, d = r * Math.SQRT1_2;
  return `M${32 - d} ${46 - d}A${r} ${r} 0 0 1 ${32 + d} ${46 - d}`;
});
// The systems of the help box: the one this browser runs on first.
const SYSTEMS = ["windows", "mac", "linux"];
const mySystem = /Win/.test(navigator.userAgent) ? "windows" : /Mac/.test(navigator.userAgent) ? "mac" : "linux";
const isWlan = (name) => /^wl/.test(name);
// The tab shown last, again when the page comes back (while OrcaOne is open); first the WLAN (the user's wish).
let lastTab = "wifi";

export default {
  name: "NetzwerkPage",
  components: { SshLogin },
  props: { instId: { type: String, default: null } },  // the page does not depend on an installation

  setup() {
    const printer = computed(() => (hosts.value?.[ui.printer] ? ui.printer : ""));
    const host = computed(() => hosts.value?.[ui.printer]?.host || "");
    const address = computed(() => host.value.replace(/:\d+$/, ""));
    const cover = computed(() => machines.value.find((m) => m.key === ui.printer)?.cover || "");
    const job = useLive(() => ui.printer);
    const printing = computed(() => ["printing", "paused"].includes(job.value?.data?.monitor?.job?.state));

    // ------------------------------------------------------------ the connection to network.py
    const state = ref("idle");    // idle, connecting, open, error
    const error = ref("");        // why the page ended: a code
    const info = ref(null);       // { interfaces, usb, computer } from Moonraker
    const ssh = ref(null);        // { state: open | failed | none, code?, via? }
    const now = ref(null);        // what the chip said last, with the links
    const lost = ref("");         // while SSH does not answer: its code
    const route = ref(null);      // { gateway, device, dns }
    const checks = reactive({});  // item: { state, ms?, loss?, value?, code? }
    const networks = ref(null);   // the WLANs around, after a search
    const points = ref([]);       // { t, signal, tx, rx, ap, packets, retries, errors, lost }
    const traffic = ref([]);      // { t, down, up } of the interface OrcaOne speaks over, in KB/s
    const busy = ref("");         // the action running
    const seconds = ref(0);       // since its click, while it waits
    const outcome = ref(null);    // { action, ok, seconds | code }
    const speed = ref(null);      // { latency, down, bytes }
    const askReboot = ref(false);
    let socket = null;

    function reset() {
      info.value = ssh.value = now.value = route.value = networks.value = outcome.value = speed.value = null;
      points.value = [];
      traffic.value = [];
      lost.value = "";
      for (const c of CHECKS) delete checks[c];
    }
    function add(point) {
      points.value = [...points.value.filter((p) => p.t > point.t - SPAN), point];
    }
    function take(m) {
      if (m.type === "info") {
        state.value = "open";
        info.value = m;
      } else if (m.type === "ssh") {
        ssh.value = m;
        brought.value = false;
      } else if (m.type === "values") {
        lost.value = "";
        now.value = m;
        if (busy.value === "power_save_off") busy.value = "";
        const on = m.connected === true, used = m.links?.find((l) => l.name === usedName.value);
        add({ t: m.time, signal: on ? m.signal : null, tx: on ? m.tx_rate : null, rx: on ? m.rx_rate : null,
              ap: on ? m.access_point : "", packets: m.tx_packets, retries: m.tx_retries, errors: used ? used.errors + used.dropped : null });
      } else if (m.type === "lost") {
        lost.value = m.code;
        add({ t: Date.now() / 1000, signal: null, tx: null, rx: null, ap: "", lost: true });
      } else if (m.type === "route") {
        route.value = m;
      } else if (m.type === "check") {
        checks[m.item] = m;
        if (m.item === "dns" && m.state !== "running" && busy.value === "check") busy.value = "";
      } else if (m.type === "scan") {
        busy.value = "";
        networks.value = m.networks;
      } else if (m.type === "waiting") {
        busy.value = m.action;
        seconds.value = m.seconds;
      } else if (m.type === "back" || m.type === "failed") {
        busy.value = "";
        outcome.value = m.type === "back" ? { action: m.action, ok: true, seconds: m.seconds } : { action: m.action, ok: false, code: m.code };
      } else if (m.type === "speed") {
        busy.value = "";
        speed.value = m;
      } else if (m.type === "error") {
        state.value = "error";
        error.value = m.code;
      }
    }
    function open() {
      close();
      if (!printer.value || document.hidden) return;
      state.value = "connecting";
      error.value = "";
      const mine = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/network?model=${encodeURIComponent(printer.value)}`);
      socket = mine;
      mine.onmessage = (ev) => {
        if (socket !== mine) return;
        try {
          take(JSON.parse(ev.data));
        } catch {
          // not for this page
        }
      };
      mine.onclose = () => {
        if (socket !== mine) return;
        socket = null;
        busy.value = "";
        if (state.value !== "error") state.value = "idle";
      };
    }
    function close() {
      const s = socket;
      socket = null;
      busy.value = "";   // the page on the server ends with the socket, and with it what it waited for
      s?.close();
    }
    function run(action) {
      if (busy.value || socket?.readyState !== WebSocket.OPEN) return;
      askReboot.value = false;
      outcome.value = null;
      if (action === "speed") speed.value = null;
      busy.value = action;
      seconds.value = 0;
      socket.send(JSON.stringify({ do: action }));
    }
    watch(printer, () => {
      reset();
      open();
    });
    // A hidden tab needs none: closed, and opened again when it shows (the curves stay).
    const onVisible = () => (document.hidden ? close() : open());
    onMounted(async () => {
      if (!hosts.value) await loadHosts();
      document.addEventListener("visibilitychange", onVisible);
      open();
    });
    onUnmounted(() => {
      document.removeEventListener("visibilitychange", onVisible);
      close();
    });

    // ------------------------------------------------------------ traffic, from Moonraker live
    // Moonraker counts bytes per interface; the difference between two of its messages is the traffic.
    const usedName = computed(() => info.value?.interfaces?.find((i) => i.used)?.name || "");
    const rates = ref({});        // interface: { down, up } in bytes/s
    let last = {};
    watch(() => job.value?.data?.monitor?.system?.network, (list) => {
      const t = Date.now() / 1000, next = {};
      for (const n of list || []) {
        if (n.rx == null || n.tx == null) continue;
        const before = last[n.name];
        if (before && n.rx === before.rx && n.tx === before.tx && t - before.t < 1.5) {
          next[n.name] = before;   // the same counters again: Moonraker counts once a second, live.py pushes more often
          continue;
        }
        next[n.name] = { t, rx: n.rx, tx: n.tx };
        if (before && t - before.t >= 0.5 && n.rx >= before.rx && n.tx >= before.tx) {
          rates.value = { ...rates.value, [n.name]: { down: (n.rx - before.rx) / (t - before.t), up: (n.tx - before.tx) / (t - before.t) } };
          if (n.name === usedName.value) {
            const r = rates.value[n.name];
            traffic.value = [...traffic.value.filter((p) => p.t > t - SPAN), { t, down: r.down / 1024, up: r.up / 1024 }];
          }
        } else if (before && t - before.t < 0.5) {
          next[n.name] = before;   // too close to say a rate
        }
      }
      last = next;
    });
    const perSecond = (bytes) => `${fmtSize(Math.round(bytes))}/s`;

    // ------------------------------------------------------------ what it shows
    const num = (v, digits = 0) => (v == null ? "–" : v.toLocaleString(LOCALE, { maximumFractionDigits: digits }));
    const errorText = (code) => N.errors[code] || T.errors[code] || T.errors.unknown;
    const sshOpen = computed(() => ssh.value?.state === "open");
    const connected = computed(() => now.value?.connected === true);
    const level = computed(() => (connected.value ? quality(now.value.signal) : ""));
    // The chosen key was tried, but in with the password: the U1 forgot it. Not for a key chosen
    // after the login, nor once it was brought onto the printer again.
    const brought = ref(false);
    const keyForgotten = computed(() => ssh.value?.via === "default" && !!ssh.value?.key
      && ssh.value.key === hosts.value?.[printer.value]?.ssh?.key && !brought.value);
    const statusOf = computed(() => {
      if (state.value === "error") return { cls: "err", text: errorText(error.value) };
      if (state.value === "connecting" || (state.value === "open" && !ssh.value)) return { cls: "wait", text: N.status.connecting };
      if (lost.value) return { cls: "err", text: N.status.lost };
      if (sshOpen.value) return { cls: "ok", text: N.status.open(ssh.value.via) };
      if (state.value === "open") return { cls: ssh.value?.state === "failed" ? "warn" : "ok", text: N.status.moonraker };
      return { cls: "wait", text: N.status.idle };
    });
    function since(s) {
      const minutes = Math.round(s / 60);
      if (minutes < 60) return N.minutes(minutes);
      if (minutes < 48 * 60) return N.hours(Math.floor(minutes / 60), minutes % 60);
      return N.days(Math.floor(minutes / 1440));
    }

    // The way: this computer, the printer, its router, the internet; each hop with its state.
    const medium = computed(() => (!usedName.value ? "" : isWlan(usedName.value) ? N.path.wlan : N.path.lan));
    const hops = computed(() => {
      const c = checks, computer = info.value?.computer;
      const stateOf = (x) => (!x ? "" : x.state === "running" ? "wait" : ["ok", "warn", "err"].includes(x.state) ? x.state : "");
      const first = { state: worst(stateOf(c.printer), computer?.same_net === false ? "warn" : ""),
                      label: c.printer?.ms != null ? N.checks.ms(c.printer.ms) : c.printer?.state === "running" ? N.path.checking : "",
                      sub: [medium.value, computer?.same_net === false ? N.path.otherNet : ""].filter(Boolean).join(" · ") };
      if (!sshOpen.value) {
        const none = { state: "none", label: N.path.needsSsh, sub: "" };
        return [first, none, none];
      }
      const radio = isWlan(usedName.value) && connected.value ? QUALITY_CLASS[level.value] : "";
      const cable = now.value?.links?.find((l) => l.name === usedName.value);
      const second = { state: worst(stateOf(c.router), radio),
                       label: c.router?.ms != null ? N.checks.ms(c.router.ms) : stateOf(c.router) === "wait" ? N.path.checking : "",
                       sub: isWlan(usedName.value) ? (connected.value ? `${num(now.value.signal)} dBm` : N.notConnected)
                         : cable?.speed ? N.ifs.speed(cable.speed, cable.duplex === "half") : "" };
      const third = { state: worst(stateOf(c.internet), stateOf(c.dns)),
                      label: c.internet?.ms != null ? N.checks.ms(c.internet.ms) : stateOf(c.internet) === "wait" ? N.path.checking : "",
                      sub: c.dns && c.dns.state !== "running" ? `${N.path.dns} ${N.path.states[stateOf(c.dns) || "none"]}` : "" };
      return [first, second, third];
    });

    // The interfaces: what Moonraker lists (up, with an address), a cable SSH sees without one, and a
    // USB-LAN adapter the printer has no interface for.
    const cards = computed(() => {
      const listed = info.value?.interfaces || [], links = now.value?.links || [];
      const out = listed.map((i) => ({ ...i, link: links.find((l) => l.name === i.name) }));
      for (const l of links) {
        if (!isWlan(l.name) && !out.some((i) => i.name === l.name)) out.push({ name: l.name, mac: l.mac, ipv4: [], ipv6: [], used: false, link: l });
      }
      const cards = out.map((i) => {
        const wlan = isWlan(i.name), l = i.link;
        const stateKey = l && l.state !== "up" ? (wlan ? "down" : "noCable") : i.ipv4.length || i.ipv6.length ? "up" : "noAddress";
        return { ...i, wlan, title: `${wlan ? N.ifs.names.wlan : N.ifs.names.lan} (${i.name})`, stateKey,
                 cls: stateKey === "up" ? "ok" : i.used ? "err" : stateKey === "noAddress" ? "warn" : "none",
                 rate: rates.value[i.name], speed: l?.speed ? N.ifs.speed(l.speed, l.duplex === "half") : "",
                 errors: l && l.errors + l.dropped ? N.ifs.errors(l.errors + l.dropped) : "" };
      });
      const usbAlone = (info.value?.usb || []).filter(() => !out.some((i) => !isWlan(i.name)));
      for (const u of usbAlone) cards.push({ name: u.id, title: `${N.ifs.names.usb} (${u.name})`, stateKey: "noDriver", cls: "warn", ipv4: [], ipv6: [], usb: true });
      return cards;
    });
    const wifiRows = computed(() => {
      const n = now.value;
      if (!connected.value) return [];
      return [
        [N.network, n.ssid || "–"],
        [N.accessPoint, n.access_point, N.accessPointHint, true],
        [N.channel, n.channel ? N.channelText(n.channel) : n.frequency ? `${n.frequency} MHz` : "–"],
        [N.rates, N.ratesText(n.rx_rate != null ? num(n.rx_rate, 1) : "–", n.tx_rate != null ? num(n.tx_rate, 1) : "–"), N.ratesHint],
        n.connected_time != null ? [N.connectedFor, since(n.connected_time)] : null,
      ].filter(Boolean);
    });

    // What the page makes of it, the worst first; "fine" only when nothing stands out.
    const switches = computed(() => points.value.filter((p, i) => {
      const before = points.value.slice(0, i).findLast((q) => q.ap);
      return p.ap && before && before.ap !== p.ap;
    }));
    const hints = computed(() => {
      if (!info.value) return [];
      const out = [], c = checks, n = now.value, computer = info.value.computer;
      if (c.printer?.state === "err" && c.printer.ms == null) out.push({ cls: "err", text: N.hints.printerGone });
      else if (c.printer?.ms >= 300) out.push({ cls: "err", text: N.hints.printerSlow(c.printer.ms) });
      else if (c.printer?.ms >= 100) out.push({ cls: "warn", text: N.hints.printerSlow(c.printer.ms) });
      if (computer?.same_net === false) out.push({ cls: "warn", text: N.hints.otherNet(computer.address) });
      const cable = cards.value.find((i) => !i.wlan && !i.usb && i.stateKey === "up" && !i.used && i.ipv4.length);
      if (cable && isWlan(usedName.value)) out.push({ cls: "warn", text: N.hints.cableUnused(cable.ipv4[0]) });
      for (const u of cards.value.filter((i) => i.usb)) out.push({ cls: "warn", text: N.hints.usbNoDriver(u.title) });
      if (n?.connected === false && isWlan(usedName.value)) out.push({ cls: "err", text: N.hints.notConnected });
      if (connected.value) {
        const q = quality(n.signal);
        if (q === "weak") out.push({ cls: "err", text: N.hints.weak(num(n.signal)) });
        else if (q === "fair") out.push({ cls: "warn", text: N.hints.fair(num(n.signal)) });
        if (n.power_save) out.push({ cls: "warn", text: N.hints.powerSave });
        if (switches.value.length) out.push({ cls: "warn", text: N.hints.roaming(switches.value.length) });
        // Retries per packet sent, from the last start of the counters (a new connection starts them anew).
        const counted = points.value.filter((p) => p.packets != null && p.retries != null);
        const from = counted.findLastIndex((p, i) => i > 0 && p.packets < counted[i - 1].packets);
        const a = counted[Math.max(0, from)], b = counted.at(-1);
        if (a && b && b.packets - a.packets >= 200 && (b.retries - a.retries) / (b.packets - a.packets) > 0.2) {
          out.push({ cls: "warn", text: N.hints.retries(Math.round((b.retries - a.retries) / (b.packets - a.packets) * 100)) });
        }
        if (q === "good" && n.tx_rate != null && n.tx_rate < 20) out.push({ cls: "warn", text: N.hints.slowRate(num(n.tx_rate, 1), n.channel || "?") });
      }
      const drops = points.value.filter((p, i) => p.lost && !points.value[i - 1]?.lost).length;
      if (drops) out.push({ cls: "err", text: N.hints.drops(drops) });
      const counted = points.value.filter((p) => p.errors != null);
      if (counted.length > 1 && counted.at(-1).errors > counted[0].errors) {
        out.push({ cls: "warn", text: N.hints.errors(usedName.value, counted.at(-1).errors - counted[0].errors) });
      }
      if (c.router?.state === "err") out.push({ cls: "err", text: N.hints.routerGone });
      else if (c.internet?.state === "err") out.push({ cls: "err", text: N.hints.noInternet });
      else if (c.dns?.state === "err") out.push({ cls: "err", text: N.hints.noDns });
      if (c.clock?.state === "warn") out.push({ cls: "warn", text: N.hints.clockOff(Math.round(Math.abs(c.clock.value) / 60)) });
      out.sort((x, y) => WORST.indexOf(x.cls) - WORST.indexOf(y.cls));
      if (!out.length && CHECKS.every((k) => c[k] && c[k].state !== "running")) {
        out.push({ cls: "ok", text: sshOpen.value && isWlan(usedName.value) ? N.hints.fine : N.hints.fineShort });
      }
      return out;
    });

    // The checks, one row each.
    const checkRows = computed(() => CHECKS.map((item) => {
      const c = checks[item];
      const cls = !c ? "none" : c.state === "running" ? "wait" : c.state === "ssh" || c.state === "none" ? "none" : c.state;
      let value = "";
      if (!c) value = "";
      else if (c.state === "running") value = N.checks.running;
      else if (c.state === "ssh") value = N.checks.ssh;
      else if (c.code === "no_gateway") value = N.checks.noGateway;
      else if (c.code === "no_ping") value = N.checks.noPing;
      else if (item === "clock") value = c.value != null ? N.checks.clock(c.value) : N.checks.none;
      else if (item === "dns") value = c.state === "ok" ? N.checks.resolved(c.value) : N.checks.failed;
      else if (c.state === "err" && c.ms == null) value = c.code ? errorText(c.code) : N.checks.failed;
      else value = [c.ms != null ? N.checks.ms(c.ms) : "", c.loss ? N.checks.loss(num(c.loss)) : ""].filter(Boolean).join(" · ");
      return { item, cls, text: N.checks.items[item], value };
    }));

    // ------------------------------------------------------------ the curves
    const latest = computed(() => Math.max(Date.now() / 1000, points.value.at(-1)?.t || 0, traffic.value.at(-1)?.t || 0));
    const x = (t) => ((t - (latest.value - SPAN)) / SPAN) * CHART.w;
    const ySignal = (dbm) => ((CHART.high - Math.min(CHART.high, Math.max(CHART.low, dbm))) / (CHART.high - CHART.low)) * CHART.signal;
    const rateTop = computed(() => Math.max(80, ...points.value.flatMap((p) => [p.tx || 0, p.rx || 0])) * 1.1);
    const yRate = (v) => CHART.rate - (v / rateTop.value) * CHART.rate;
    const trafficTop = computed(() => Math.max(64, ...traffic.value.flatMap((p) => [p.down, p.up])) * 1.1);
    const yTraffic = (v) => CHART.traffic - (v / trafficTop.value) * CHART.traffic;
    // A line through the points that have the value, broken where one lacks it.
    function line(list, value, y) {
      let d = "", pen = false;
      for (const p of list) {
        const v = value(p);
        if (v == null) {
          pen = false;
          continue;
        }
        d += `${pen ? "L" : "M"}${x(p.t).toFixed(1)} ${y(v).toFixed(1)}`;
        pen = true;
      }
      return d;
    }
    const curves = computed(() => ({
      signal: line(points.value, (p) => p.signal, ySignal), tx: line(points.value, (p) => p.tx, yRate), rx: line(points.value, (p) => p.rx, yRate),
      down: line(traffic.value, (p) => p.down, yTraffic), up: line(traffic.value, (p) => p.up, yTraffic),
    }));
    const switchXs = computed(() => switches.value.map((p) => x(p.t)));
    const gaps = computed(() => points.value.filter((p) => p.lost).map((p) => x(p.t)));
    const BANDS = [["good", -35, -67], ["fair", -67, -75], ["weak", -75, -95]];
    const bands = BANDS.map(([cls, top, bottom]) => ({ cls, y: ySignal(top), h: ySignal(bottom) - ySignal(top) }));
    const signalTicks = [-40, -50, -60, -70, -80, -90].map((v) => ({ v, y: ySignal(v) }));
    const ticks = (top, y) => {
      const step = [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000].find((s) => top / s <= 4) || 20000;
      return Array.from({ length: Math.floor(top / step) }, (_, i) => (i + 1) * step).map((v) => ({ v, y: y(v) }));
    };
    const rateTicks = computed(() => ticks(rateTop.value, yRate));
    const trafficTicks = computed(() => ticks(trafficTop.value, yTraffic));

    // ------------------------------------------------------------ the WLANs around
    const CHAN = { w: 600, h: 140, from: -1, to: 15 };
    const cx = (c) => ((c - CHAN.from) / (CHAN.to - CHAN.from)) * CHAN.w;
    const hump = (dbm) => (Math.max(0, Math.min(60, (dbm ?? -95) + 95)) / 60) * (CHAN.h - 22);
    const around = computed(() => {
      const list = (networks.value || []).filter((n) => n.channel);
      const own = now.value?.ssid;
      const shown = list.map((n, i) => ({
        ...n, key: n.bssid, h: hump(n.signal), cls: n.associated ? "is-used" : own && n.ssid === own ? "is-own" : "",
        d: `M${cx(n.channel - 2).toFixed(1)} ${CHAN.h}Q${cx(n.channel).toFixed(1)} ${(CHAN.h - 2 * hump(n.signal)).toFixed(1)} ${cx(n.channel + 2).toFixed(1)} ${CHAN.h}`,
        label: i < 3 ? n.ssid || N.scan.hidden : "", x: cx(n.channel),
      }));
      const count = (c) => list.filter((n) => Math.abs(n.channel - c) <= 2).length;
      const busiest = [...Array(13).keys()].map((i) => i + 1).reduce((a, b) => (list.filter((n) => n.channel === b).length > list.filter((n) => n.channel === a).length ? b : a), 1);
      const quietest = [1, 6, 11].reduce((a, b) => (count(b) < count(a) ? b : a));
      const used = list.find((n) => n.associated);
      const stronger = used && own ? list.filter((n) => n.ssid === own && !n.associated && n.signal - used.signal >= 6).sort((a, b) => b.signal - a.signal)[0] : null;
      const sentences = [list.length ? N.scan.busiest(busiest, list.filter((n) => n.channel === busiest).length) : "",
                         list.length ? N.scan.quietest(quietest) : "", stronger ? N.scan.stronger(num(stronger.signal), num(used.signal)) : ""];
      return { shown, sentences: sentences.filter(Boolean), count: list.length };
    });
    const channelTicks = [1, 6, 11, 13].map((c) => ({ c, x: cx(c) }));

    // ------------------------------------------------------------ actions
    const waitingText = computed(() => (busy.value === "reconnect" || busy.value === "reboot" ? N.waiting[busy.value](seconds.value)
      : busy.value ? N.working[busy.value] : ""));
    const outcomeText = computed(() => {
      const o = outcome.value;
      if (!o) return "";
      return o.ok ? N.back[o.action](o.seconds) : errorText(o.code);
    });
    const speedOf = computed(() => {
      const s = speed.value;
      if (!s) return null;
      const cls = s.down >= 10 ? "ok" : s.down >= 3 ? "warn" : "err";
      return { cls, text: N.speedText(num(s.down, 1), num(s.latency), num(s.bytes / 1048576, 1)), verdict: N.speedVerdict[cls] };
    });

    // ------------------------------------------------------------ tabs and the tiles above them
    const tab = ref(lastTab);
    const tabBar = ref(null);
    const withSsh = computed(() => ssh.value?.state !== "none");   // the U1: the parts over SSH exist
    const tabList = computed(() => ["wifi", "hints", "ifs", "checks", "scan", "ssh"].filter((t) => withSsh.value || !["wifi", "scan", "ssh"].includes(t)));
    function show(t, scroll = false) {
      tab.value = lastTab = t;
      if (scroll) tabBar.value?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
    // No WLAN tab (a printer without SSH here): the first there is, the choice kept for the next U1.
    watch(tabList, (list) => { if (!list.includes(tab.value)) tab.value = list[0]; });
    // SSH did not work, or the U1 forgot the key: the tab that says what to do, unless one was chosen.
    watch(() => ssh.value?.state === "failed" || keyForgotten.value, (want) => { if (want && tab.value === "wifi") show("ssh"); });
    const tiles = computed(() => {
      const c = checks, n = now.value, out = [];
      if (withSsh.value) {
        out.push(!sshOpen.value ? { id: "wifi", icon: "network", cls: "", num: "–", sub: N.path.needsSsh }
          : connected.value ? { id: "wifi", icon: "network", cls: QUALITY_CLASS[level.value], num: `${num(n.signal)} dBm`,
                                sub: [N.levels[level.value], n.channel ? N.scan.channel(n.channel) : ""].filter(Boolean).join(" · ") }
          : { id: "wifi", icon: "network", cls: n && isWlan(usedName.value) ? "err" : "", num: "–",
              sub: !n ? N.checks.running : isWlan(usedName.value) ? N.notConnected : N.tiles.cable });
      }
      const serious = hints.value.filter((h) => h.cls !== "ok");
      out.push({ id: "hints", icon: "info", cls: worst(...serious.map((h) => h.cls)) || (hints.value.length ? "ok" : ""),
                 num: serious.length ? String(serious.length) : hints.value.length ? "✓" : "–",
                 sub: serious.length ? N.tiles.hints(serious.length) : hints.value.length ? N.tiles.fine : N.checks.running });
      const used = cards.value.find((i) => i.used);
      out.push({ id: "ifs", icon: "lan", cls: used ? used.cls : "", num: String(cards.value.length),
                 sub: used?.rate ? N.ifs.traffic(perSecond(used.rate.down), perSecond(used.rate.up)) : used ? used.title : N.ifs.none });
      const judged = CHECKS.map((k) => c[k]).filter((x) => x && ["ok", "warn", "err"].includes(x.state));
      const failing = CHECKS.find((k) => c[k] && ["err", "warn"].includes(c[k].state));
      out.push({ id: "checks", icon: "pulse", cls: worst(...judged.map((x) => x.state)),
                 num: judged.length ? `${judged.filter((x) => x.state === "ok").length}/${judged.length}` : "–",
                 sub: failing ? N.checks.items[failing] : CHECKS.some((k) => !c[k] || c[k].state === "running") ? N.checks.running : N.tiles.allReached });
      if (withSsh.value) {
        out.push({ id: "scan", icon: "search", cls: "", num: networks.value ? String(around.value.count) : "–",
                   sub: networks.value ? N.scan.count(around.value.count) : N.tiles.scanOnClick });
      }
      return out;
    });

    // ------------------------------------------------------------ SSH with a key
    const system = ref(mySystem);
    const steps = computed(() => {
      const at = `root@${address.value || "IP"}`;
      const key = keyPath(system.value);   // the key by its name (ssh-login.js)
      const copy = system.value === "linux" ? `ssh-copy-id -i ${key}.pub ${at}`
        : `cat ${key}.pub | ssh ${at} "mkdir -p ~/.ssh; tr -d '\\r' >> ~/.ssh/authorized_keys; chmod 700 ~/.ssh; chmod 600 ~/.ssh/authorized_keys"`;
      return [
        { text: N.help.rootAccess },
        { text: N.help.terminal[system.value] },
        { text: N.help.keygen, command: keygen(system.value) },
        { text: N.help.forget, command: `ssh-keygen -R ${address.value || "IP"}` },
        { text: N.help.send, command: copy },
        { text: N.help.test, command: `ssh -i ${key} ${at} "echo ok"` },
      ];
    });
    async function copyCommand(command) {
      try {
        await navigator.clipboard.writeText(command);
        flash(N.help.copied);
      } catch {
        flash(N.help.copyFailed);   // only over https or on this computer (a secure context)
      }
    }

    return {
      T, N, SYSTEMS, CHART, CHAN, ARCS, CHECKS, printer, address, cover, printing, state, info, ssh, sshOpen, now, busy, askReboot,
      run, open, statusOf, keyForgotten, brought, connected, level, bars, QUALITY_CLASS, hops, cards, wifiRows, hints, checkRows, perSecond, num,
      curves, switchXs, gaps, bands, signalTicks, rateTicks, trafficTicks, traffic, around, channelTicks, networks, waitingText,
      outcome, outcomeText, speedOf, system, steps, copyCommand, activeName, go, hashOf, points, route, tab, tabBar, tabList, show, tiles,
    };
  },

  template: `
    <div class="page net-page">
      <h1 id="page-title" tabindex="-1">{{ N.title }}</h1>
      <p class="note">{{ N.lead }}</p>

      <p v-if="!printer" class="empty">{{ N.noHost(activeName()) }}
        <a class="link" :href="hashOf('drucker', instId)" @click="go($event, hashOf('drucker', instId))">{{ N.toPrinters }}</a></p>
      <template v-else>
        <p class="wifi-status">
          <span :class="['cam-status', 'is-' + statusOf.cls]"><span class="cam-dot"></span>{{ statusOf.text }}</span>
          <button v-if="state === 'error' || state === 'idle'" class="link" type="button" @click="open">{{ N.again }}</button>
        </p>
        <p v-if="keyForgotten" class="note is-warn">{{ N.keyRefused }}</p>
        <p v-if="ssh && ssh.state === 'failed'" class="note">{{ N.errors[ssh.code] || T.errors.unknown }} {{ N.noSsh }}</p>
        <p v-else-if="ssh && ssh.state === 'none'" class="note">{{ N.notU1 }}</p>

        <template v-if="info">
          <!-- The overview: the way from this computer to the internet, and a tile per part -->
          <section class="box" aria-labelledby="net-path-h">
            <h2 id="net-path-h" class="sr-only">{{ N.path.title }}</h2>
            <ol class="net-path">
              <li class="net-node"><span class="net-icon"><ui-icon name="window" :size="28"/></span><strong>{{ N.path.computer }}</strong>
                <small>{{ info.computer?.address || '' }}</small></li>
              <li :class="['net-hop', 'is-' + (hops[0].state || 'none')]"><span class="net-label">{{ hops[0].label }}</span><span class="net-line"></span>
                <span class="net-sub">{{ hops[0].sub }}</span></li>
              <li class="net-node"><span class="net-icon"><img v-if="cover" :src="cover" alt="" width="40" height="40"></span><strong>{{ activeName() }}</strong>
                <small>{{ address }}</small></li>
              <li :class="['net-hop', 'is-' + (hops[1].state || 'none')]"><span class="net-label">{{ hops[1].label }}</span><span class="net-line"></span>
                <span class="net-sub">{{ hops[1].sub }}</span></li>
              <li class="net-node"><span class="net-icon"><ui-icon name="lan" :size="28"/></span><strong>{{ N.path.router }}</strong>
                <small>{{ route?.gateway || '' }}</small></li>
              <li :class="['net-hop', 'is-' + (hops[2].state || 'none')]"><span class="net-label">{{ hops[2].label }}</span><span class="net-line"></span>
                <span class="net-sub">{{ hops[2].sub }}</span></li>
              <li class="net-node"><span class="net-icon"><ui-icon name="globe" :size="28"/></span><strong>{{ N.path.internet }}</strong></li>
            </ol>
          </section>
          <div class="home-tiles net-tiles">
            <section v-for="t in tiles" :key="t.id" :class="['home-tile', 'net-tile', t.cls ? 'is-' + t.cls : '', { 'is-current': tab === t.id }]"
                     :aria-labelledby="'net-tile-' + t.id">
              <h2 :id="'net-tile-' + t.id" class="home-tile-title">
                <button class="home-tile-link net-tile-link" type="button" @click="show(t.id, true)"><ui-icon :name="t.icon"/>{{ N.tabs[t.id] }}</button></h2>
              <p class="home-tile-num">{{ t.num }}</p>
              <p class="home-tile-sub">{{ t.sub }}</p>
            </section>
          </div>

          <!-- The parts, one at a time -->
          <div ref="tabBar" class="net-tabs" role="tablist" :aria-label="N.tabs.label">
            <button v-for="t in tabList" :id="'net-tab-' + t" :key="t" :class="['net-tab', { 'is-current': tab === t }]" type="button" role="tab"
                    :aria-selected="tab === t ? 'true' : 'false'" :aria-controls="'net-panel-' + t" @click="show(t)">{{ N.tabs[t] }}</button>
          </div>
          <p v-if="busy && busy !== 'scan'" class="wifi-wait" role="status"><span class="wifi-spin" aria-hidden="true"></span>{{ waitingText }}</p>
          <p v-else-if="outcome" :class="['wifi-outcome', outcome.ok ? 'is-ok' : 'is-err']" role="status">{{ outcomeText }}</p>
          <div :id="'net-panel-' + tab" class="net-panel" role="tabpanel" :aria-labelledby="'net-tab-' + tab">

            <!-- The assessment -->
            <section v-if="tab === 'hints'" class="box">
              <ul v-if="hints.length" class="wifi-hints">
                <li v-for="(h, i) in hints" :key="i" :class="'is-' + h.cls"><span class="cam-dot"></span>{{ h.text }}</li>
              </ul>
              <p v-else class="note">{{ N.checks.running }}</p>
            </section>

            <!-- The WLAN: its signal and values, its curves, connect anew, start anew -->
            <template v-if="tab === 'wifi'">
              <p v-if="!sshOpen" class="empty">{{ N.noSsh }}</p>
              <template v-else>
                <section v-if="now" class="box wifi-now">
                  <div :class="['wifi-signal', connected ? 'is-' + QUALITY_CLASS[level] : 'is-off']">
                    <svg viewBox="0 0 64 52" width="80" height="65" aria-hidden="true">
                      <path v-for="(d, i) in ARCS" :key="i" :class="['wifi-arc', { 'is-on': i < bars(connected ? now.signal : null) }]" :d="d"/>
                      <circle cx="32" cy="46" r="3.2" class="wifi-arc-dot"/>
                    </svg>
                    <div>
                      <strong class="wifi-dbm">{{ connected && now.signal != null ? num(now.signal) + ' dBm' : N.noSignal }}</strong>
                      <span class="wifi-level">{{ connected ? N.levels[level] : now.connected === false ? N.notConnected : N.unknown }}</span>
                    </div>
                  </div>
                  <dl class="wifi-rows">
                    <div v-for="r in wifiRows" :key="r[0]" :title="r[2] || null"><dt>{{ r[0] }}</dt><dd :class="{ mono: r[3] }">{{ r[1] }}</dd></div>
                    <div v-if="now.power_save != null"><dt>{{ N.powerSave }}</dt>
                      <dd><span :class="['wifi-flag', now.power_save ? 'is-warn' : 'is-ok']">{{ now.power_save ? N.on : N.off }}</span>
                        <button v-if="now.power_save" class="link" type="button" :disabled="!!busy" @click="run('power_save_off')">{{ N.powerSaveOff }}</button></dd></div>
                  </dl>
                </section>
                <section v-if="points.length" class="box" aria-labelledby="net-curve-h">
                  <div class="box-head"><h2 id="net-curve-h">{{ N.curveTitle }}</h2><span class="sub">{{ N.curveSub }}</span></div>
                  <figure class="wifi-chart">
                    <figcaption>{{ N.signalAxis }}</figcaption>
                    <svg :viewBox="'0 0 ' + CHART.w + ' ' + CHART.signal" preserveAspectRatio="none" role="img" :aria-label="N.signalAxis">
                      <rect v-for="b in bands" :key="b.cls" :class="'wifi-band is-' + b.cls" x="0" :y="b.y" :width="CHART.w" :height="b.h"/>
                      <line v-for="t in signalTicks" :key="t.v" class="wifi-grid" x1="0" :x2="CHART.w" :y1="t.y" :y2="t.y"/>
                      <line v-for="(g, i) in gaps" :key="'g' + i" class="wifi-gap" :x1="g" :x2="g" y1="0" :y2="CHART.signal"/>
                      <line v-for="(s, i) in switchXs" :key="'s' + i" class="wifi-switch" :x1="s" :x2="s" y1="0" :y2="CHART.signal"/>
                      <path class="wifi-line" :d="curves.signal"/>
                    </svg>
                    <span v-for="t in signalTicks" :key="t.v" class="wifi-tick" :style="{ top: (t.y / CHART.signal * 100) + '%' }">{{ t.v }}</span>
                  </figure>
                  <figure class="wifi-chart is-small">
                    <figcaption>{{ N.rateAxis }} <span class="wifi-key">{{ N.sending }}</span> <span class="wifi-key is-rx">{{ N.receiving }}</span></figcaption>
                    <svg :viewBox="'0 0 ' + CHART.w + ' ' + CHART.rate" preserveAspectRatio="none" role="img" :aria-label="N.rateAxis">
                      <line v-for="t in rateTicks" :key="t.v" class="wifi-grid" x1="0" :x2="CHART.w" :y1="t.y" :y2="t.y"/>
                      <line v-for="(s, i) in switchXs" :key="'s' + i" class="wifi-switch" :x1="s" :x2="s" y1="0" :y2="CHART.rate"/>
                      <path class="wifi-line is-rx" :d="curves.rx"/>
                      <path class="wifi-line" :d="curves.tx"/>
                    </svg>
                    <span v-for="t in rateTicks" :key="t.v" class="wifi-tick" :style="{ top: (t.y / CHART.rate * 100) + '%' }">{{ t.v }}</span>
                  </figure>
                  <p class="wifi-axis"><span>{{ N.minutesAgo(5) }}</span><span>{{ N.now }}</span></p>
                  <p class="note">{{ N.curveNote }}</p>
                </section>
                <section class="box" aria-labelledby="net-act-h">
                  <div class="box-head"><h2 id="net-act-h">{{ N.actTitle }}</h2></div>
                  <div class="wifi-acts">
                    <div class="wifi-act">
                      <button class="btn btn-primary" type="button" :disabled="!!busy" @click="run('reconnect')"><ui-icon name="network"/>{{ N.reconnect }}</button>
                      <p class="note">{{ N.reconnectHint }}</p>
                    </div>
                    <div class="wifi-act">
                      <button class="btn" type="button" :disabled="!!busy || printing" :title="printing ? N.rebootPrinting : null"
                              @click="askReboot = !askReboot"><ui-icon name="rotateRight"/>{{ N.reboot }}</button>
                      <p class="note">{{ printing ? N.rebootPrinting : N.rebootHint }}</p>
                      <p v-if="askReboot" class="wifi-ask" role="alert">{{ N.rebootAsk }}
                        <button class="btn btn-primary" type="button" @click="run('reboot')">{{ N.rebootYes }}</button>
                        <button class="btn" type="button" @click="askReboot = false">{{ T.cancel }}</button></p>
                    </div>
                  </div>
                </section>
              </template>
            </template>

            <!-- The interfaces, and the traffic of the one OrcaOne speaks over -->
            <template v-if="tab === 'ifs'">
              <p v-if="!cards.length" class="empty">{{ N.ifs.none }}</p>
              <div class="net-ifs">
                <article v-for="c in cards" :key="c.name" :class="['net-if', { 'is-used': c.used }]" :title="[c.mac, ...c.ipv6].filter(Boolean).join('\\n')">
                  <div class="net-if-head">
                    <ui-icon :name="c.wlan ? 'network' : 'lan'" :size="20"/>
                    <strong>{{ c.title }}</strong>
                    <span :class="['cam-status', 'is-' + c.cls]"><span class="cam-dot"></span>{{ N.ifs.states[c.stateKey] }}</span>
                  </div>
                  <p v-if="c.ipv4.length" class="net-if-ip">{{ c.ipv4.join(', ') }}</p>
                  <p v-if="c.used" class="tag tag-active">{{ N.ifs.used }}</p>
                  <p class="net-if-facts">
                    <span v-if="c.rate" :title="N.ifs.trafficHint">{{ N.ifs.traffic(perSecond(c.rate.down), perSecond(c.rate.up)) }}</span>
                    <span v-if="c.wlan && connected">{{ num(now.signal) }} dBm</span>
                    <span v-if="c.speed">{{ c.speed }}</span>
                    <span v-if="c.errors" class="is-warn">{{ c.errors }}</span>
                  </p>
                </article>
              </div>
              <section v-if="traffic.length" class="box net-traffic" aria-labelledby="net-traffic-h">
                <div class="box-head"><h2 id="net-traffic-h">{{ N.trafficAxis }}</h2><span class="sub">{{ N.curveSub }}</span></div>
                <figure class="wifi-chart is-small">
                  <figcaption><span class="wifi-key">{{ N.down }}</span> <span class="wifi-key is-rx">{{ N.up }}</span></figcaption>
                  <svg :viewBox="'0 0 ' + CHART.w + ' ' + CHART.traffic" preserveAspectRatio="none" role="img" :aria-label="N.trafficAxis">
                    <line v-for="t in trafficTicks" :key="t.v" class="wifi-grid" x1="0" :x2="CHART.w" :y1="t.y" :y2="t.y"/>
                    <path class="wifi-line is-rx" :d="curves.up"/>
                    <path class="wifi-line" :d="curves.down"/>
                  </svg>
                  <span v-for="t in trafficTicks" :key="t.v" class="wifi-tick" :style="{ top: (t.y / CHART.traffic * 100) + '%' }">{{ t.v }}</span>
                </figure>
                <p class="wifi-axis"><span>{{ N.minutesAgo(5) }}</span><span>{{ N.now }}</span></p>
              </section>
            </template>

            <!-- The checks -->
            <section v-if="tab === 'checks'" class="box">
              <div class="box-head"><span class="sub">{{ N.checks.lead }}</span>
                <button class="btn right" type="button" :disabled="state !== 'open' || !!busy" @click="run('check')">{{ N.checks.again }}</button></div>
              <ul class="net-checks">
                <li v-for="r in checkRows" :key="r.item" :class="'is-' + r.cls"><span class="cam-dot"></span><span>{{ r.text }}</span><span class="net-check-value">{{ r.value }}</span></li>
              </ul>
              <div class="net-measure">
                <button class="btn" type="button" :disabled="state !== 'open' || !!busy" @click="run('speed')"><ui-icon name="download"/>{{ N.measure }}</button>
                <span class="note">{{ N.measureHint }}</span>
              </div>
              <p v-if="speedOf" :class="['wifi-outcome', 'is-' + speedOf.cls]" role="status">{{ speedOf.text }} {{ speedOf.verdict }}</p>
            </section>

            <!-- The WLANs around, as a picture of the channels -->
            <section v-if="tab === 'scan'" class="box">
              <p v-if="!sshOpen" class="note">{{ N.noSsh }}</p>
              <template v-else>
                <div class="box-head"><span class="sub">{{ networks ? N.scan.count(around.count) : N.scan.hint }}</span>
                  <button class="btn right" type="button" :disabled="!!busy" @click="run('scan')">{{ busy === 'scan' ? N.scan.busy : N.scan.button }}</button></div>
                <p v-if="networks && !around.count" class="note">{{ N.scan.none }}</p>
                <figure v-if="around.count" class="net-chan">
                  <svg :viewBox="'0 0 ' + CHAN.w + ' ' + CHAN.h" role="img" :aria-label="N.scan.title">
                    <line v-for="t in channelTicks" :key="t.c" class="wifi-grid" :x1="t.x" :x2="t.x" y1="0" :y2="CHAN.h"/>
                    <path v-for="n in around.shown" :key="n.key" :class="['net-hump', n.cls]" :d="n.d"><title>{{ (n.ssid || N.scan.hidden) + ' · ' + N.scan.channel(n.channel) + ' · ' + num(n.signal) + ' dBm' }}</title></path>
                    <text v-for="n in around.shown.filter((n) => n.label)" :key="'t' + n.key" class="net-hump-label" :x="n.x" :y="CHAN.h - n.h - 6" text-anchor="middle">{{ n.label }}</text>
                  </svg>
                  <p class="wifi-axis net-chan-axis"><span v-for="t in channelTicks" :key="t.c" :style="{ left: (t.x / CHAN.w * 100) + '%' }">{{ t.c }}</span></p>
                </figure>
                <p v-for="(s, i) in around.sentences" :key="i" class="note">{{ s }}</p>
              </template>
            </section>

            <!-- SSH with a key -->
            <section v-if="tab === 'ssh'" class="box wifi-help">
              <p class="note">{{ N.help.lead }}</p>
              <ssh-login :printer="printer" keys-only @brought="brought = true"/>
              <h3 class="net-help-h">{{ N.help.manual }}</h3>
              <div class="chips" role="group" :aria-label="N.help.system">
                <button v-for="s in SYSTEMS" :key="s" class="chip" type="button" :aria-pressed="system === s ? 'true' : 'false'" @click="system = s">{{ N.help.systems[s] }}</button>
              </div>
              <ol class="wifi-steps">
                <li v-for="(s, i) in steps" :key="i">
                  <p>{{ s.text }}</p>
                  <div v-if="s.command" class="wifi-cmd"><code>{{ s.command }}</code>
                    <button class="link" type="button" @click="copyCommand(s.command)">{{ N.help.copy }}</button></div>
                </li>
              </ol>
              <p class="note">{{ N.help.after }}</p>
            </section>
          </div>
        </template>
      </template>
    </div>
  `,
};
