// Page "SSH": a command line on a printer over SSH (orcaone/ssh.py, the user's wish of
// 24.09.2026). xterm.js draws it (vendor/xterm, loaded only once this page connects); OrcaOne
// speaks SSH and passes the bytes on over a WebSocket, only to printers with an address from the
// page "Drucker". The login as chosen per printer (pages/ssh-login.js): a password, which only
// passes through, or the keys in ~/.ssh; if nothing fits, the page asks for the password.
import { go, hashOf, ui, isU1Printer, activeName, darkQuery, isDark, hosts } from "../common.js";
import { T } from "../texts.js";
import { api } from "../api.js";
import { SshLogin } from "./ssh-login.js";

const { ref, computed, watch, nextTick, onMounted, onUnmounted } = Vue;
const S = T.ssh;
const STATUS = { idle: "wait", connecting: "wait", password: "warn", open: "ok", closed: "wait" };
// Commands for the list above the terminal (the user's wish of 24.09.2026): chosen, they are typed
// into the shell, so the terminal shows the call and its result. All but the last group only look
// and run at once; the last group does something, so it is only typed and Enter is the user's.
// The U1 keeps its files in /userdata and its calibration in config/snapmaker/*.json, and starts its
// services with init scripts (/etc/init.d/S60klipper, S61moonraker); every command of its list ran
// on the user's U1 on 24.09.2026. Other Klipper printers use ~/printer_data and systemd, as
// MainsailOS and KIAUH set them up, with bed mesh and input shaper in printer.cfg (not checked,
// there is none here).
const GROUPS = ["files", "printer", "system", "network", "act"];
const U1_CONFIG = "/oem/printer_data/config/snapmaker";
const KLIPPY_ERRORS = '"^!! |Traceback|Internal error|shutdown state|MCU error"';
const COMMANDS = {
  u1: {
    files: [
      ["printFiles", "(cd /userdata/gcodes && ls -lht *.gcode)"],
      ["largestFiles", "du -h /userdata/gcodes/*.gcode | sort -h | tail -n 10"],
      ["countFiles", "ls /userdata/gcodes/*.gcode | wc -l; du -sh /userdata/gcodes"],
      ["videos", "(cd /oem/printer_data/camera && ls -lhtL *.mp4)"],
      ["videoSpace", "du -sh /userdata/.tmp_timelapse"],
      ["space", "du -sh /userdata/* /userdata/.tmp_timelapse 2>/dev/null | sort -h"],
      ["config", `ls -lh /oem/printer_data/config ${U1_CONFIG}`],
    ],
    printer: [
      ["bedMesh", `python3 -c "import json;p=json.load(open('${U1_CONFIG}/bed_mesh_default.json'))['profile']['points'];[print(' '.join('%+.3f' % v for v in r)) for r in p];v=sum(p,[]);print('min %+.3f  max %+.3f  range %.3f mm' % (min(v), max(v), max(v) - min(v)))"`],
      ["inputShaper", `cat ${U1_CONFIG}/input_shaper.json`],
      ["pressureAdvance", `python3 -m json.tool ${U1_CONFIG}/flow_calibrator.json`],
      ["printerCfg", "head -n 60 /oem/printer_data/config/printer.cfg"],
      ["klippyErrors", `grep -E ${KLIPPY_ERRORS} /userdata/logs/klippy.log | tail -n 20`],
      ["klippyLog", "tail -n 50 /userdata/logs/klippy.log"],
      ["klippyLive", "tail -f /userdata/logs/klippy.log"],
      ["moonrakerLog", "tail -n 50 /userdata/logs/moonraker.log"],
      ["screenLog", "tail -n 50 /userdata/logs/gui.log"],
    ],
    system: [
      ["disk", "df -h /userdata /oem"],
      ["memory", "free -h"],
      ["uptime", "uptime"],
      ["cpuTemp", 'for z in /sys/class/thermal/thermal_zone*; do echo "$(cat $z/type): $(( $(cat $z/temp) / 1000 )) °C"; done'],
      ["processes", "top -b -n 1 | head -20"],
      ["htop", "htop"],
      ["os", 'grep -E "^(NAME|VERSION)=" /etc/os-release; uname -r'],
      ["time", "date"],
      ["kernel", "dmesg | tail -n 30"],
    ],
    network: [
      ["ip", "ip -brief -4 addr"],
      ["wifi", "iwconfig wlan0"],
      ["route", "ip route"],
      ["dns", "cat /etc/resolv.conf"],
      ["internet", "ping -c 3 1.1.1.1"],
      ["names", "ping -c 1 github.com"],
      ["ports", "ss -tlnp"],
      ["connections", "ss -tnp"],
    ],
    act: [
      ["restartKlipper", "/etc/init.d/S60klipper restart"],
      ["restartMoonraker", "/etc/init.d/S61moonraker restart"],
      ["reboot", "reboot"],
    ],
  },
  klipper: {
    files: [
      ["printFiles", "(cd ~/printer_data/gcodes && ls -lht)"],
      ["largestFiles", "du -ah ~/printer_data/gcodes | sort -h | tail -n 10"],
      ["countFiles", 'find ~/printer_data/gcodes -name "*.gcode" | wc -l; du -sh ~/printer_data/gcodes'],
      ["videos", "(cd ~/printer_data/timelapse && ls -lht *.mp4)"],
      ["space", "du -sh ~/printer_data/* 2>/dev/null | sort -h"],
      ["config", "ls -lh ~/printer_data/config"],
    ],
    printer: [
      ["bedMesh", 'grep -A 16 "bed_mesh default" ~/printer_data/config/printer.cfg'],
      ["inputShaper", 'grep -A 4 "input_shaper" ~/printer_data/config/printer.cfg'],
      ["versions", "git -C ~/klipper describe --tags --always; git -C ~/moonraker describe --tags --always"],
      ["services", 'systemctl --no-pager status klipper moonraker | grep -E "●|Active"'],
      ["printerCfg", "head -n 60 ~/printer_data/config/printer.cfg"],
      ["klippyErrors", `grep -E ${KLIPPY_ERRORS} ~/printer_data/logs/klippy.log | tail -n 20`],
      ["klippyLog", "tail -n 50 ~/printer_data/logs/klippy.log"],
      ["klippyLive", "tail -f ~/printer_data/logs/klippy.log"],
      ["moonrakerLog", "tail -n 50 ~/printer_data/logs/moonraker.log"],
    ],
    system: [
      ["disk", "df -h /"],
      ["memory", "free -h"],
      ["uptime", "uptime"],
      ["cpuTemp", 'for z in /sys/class/thermal/thermal_zone*; do echo "$(cat $z/type): $(( $(cat $z/temp) / 1000 )) °C"; done'],
      ["processes", "top -b -n 1 | head -20"],
      ["htop", "htop"],
      ["os", 'grep PRETTY_NAME /etc/os-release; uname -r'],
      ["time", "date"],
      ["kernel", "sudo dmesg | tail -n 30"],
    ],
    network: [
      ["ip", "ip -brief -4 addr"],
      ["wifi", "iwconfig wlan0 2>/dev/null || iw dev wlan0 link"],
      ["route", "ip route"],
      ["dns", "cat /etc/resolv.conf"],
      ["internet", "ping -c 3 1.1.1.1"],
      ["names", "ping -c 1 github.com"],
      ["ports", "ss -tln"],
      ["connections", "ss -tn"],
    ],
    act: [
      ["restartKlipper", "sudo systemctl restart klipper"],
      ["restartMoonraker", "sudo systemctl restart moonraker"],
      ["reboot", "sudo reboot"],
    ],
  },
};
// Colours of the page instead of black and white (the user's wish): background, text, cursor and
// selection from its CSS variables, the 16 terminal colours readable on it. After GitHub's light
// and dark terminal themes, cyan as Orca's teal.
const LIGHT = {
  black: "#24292F", red: "#CF222E", green: "#116329", yellow: "#4D2D00", blue: "#0969DA", magenta: "#8250DF", cyan: "#00796B", white: "#6E7781",
  brightBlack: "#57606A", brightRed: "#A40E26", brightGreen: "#1A7F37", brightYellow: "#633C01", brightBlue: "#218BFF",
  brightMagenta: "#A475F9", brightCyan: "#009688", brightWhite: "#8C959F",
};
const DARK = {
  black: "#484F58", red: "#FF7B72", green: "#3FB950", yellow: "#D29922", blue: "#58A6FF", magenta: "#BC8CFF", cyan: "#4DB6AC", white: "#B1BAC4",
  brightBlack: "#6E7681", brightRed: "#FFA198", brightGreen: "#56D364", brightYellow: "#E3B341", brightBlue: "#79C0FF",
  brightMagenta: "#D2A8FF", brightCyan: "#80CBC4", brightWhite: "#F0F6FC",
};
// The colours of the page for xterm, in the design in use (common.js, isDark). A variable holds
// light-dark(…), so each colour comes resolved from an element that uses it.
function theme() {
  const probe = document.body.appendChild(document.createElement("span"));
  const v = (name) => {
    probe.style.color = `var(${name})`;
    return getComputedStyle(probe).color;
  };
  const colours = { background: v("--surface"), foreground: v("--text"), cursor: v("--accent-line"), cursorAccent: v("--surface"),
                    selectionBackground: v("--selected") };
  probe.remove();
  return { ...colours, ...(isDark() ? DARK : LIGHT) };
}

let modules = null;
async function loadXterm() {
  if (!modules) {
    const link = Object.assign(document.createElement("link"), { rel: "stylesheet", href: "vendor/xterm/xterm.css" });
    document.head.append(link);
    const [{ Terminal }, { FitAddon }] = await Promise.all([import("../vendor/xterm/xterm.mjs"), import("../vendor/xterm/addon-fit.mjs")]);
    modules = { Terminal, FitAddon };
  }
  return modules;
}

export default {
  name: "SshPage",
  components: { SshLogin },
  props: { instId: { type: String, default: null } },  // the page does not depend on an installation

  setup() {
    const printers = ref(null);   // the addresses per model (api.printers), null while loading
    const loadError = ref("");
    const model = ref("");        // the printer of the top bar (app.js), once it has an address
    const host = computed(() => printers.value?.[ui.printer]?.host || "");
    const user = ref("root");     // the U1 knows root (and lava), other Klipper printers mostly pi
    const typed = ref("");        // a password from the bar, with "Passwort" chosen; empty: the U1's default (ssh.py)
    const state = ref("idle");    // idle, connecting, password, open, closed
    const opened = ref(null);     // {host, user, fingerprint} once logged in
    const error = ref("");
    const errorDetail = ref("");
    const password = ref("");
    const again = ref(false);
    const box = ref(null);
    let term = null, fit = null, ws = null, observer = null;

    const active = computed(() => ["connecting", "password", "open"].includes(state.value));
    const isU1 = computed(() => isU1Printer(model.value));
    const commands = computed(() => COMMANDS[isU1.value ? "u1" : "klipper"]);
    // The user kept for the printer (ssh.save_setting), else root on a U1, pi on others.
    watch(model, () => { user.value = printers.value?.[model.value]?.ssh?.user || (isU1.value ? "root" : "pi"); });
    // The chosen key was tried, but the login went by the password as shipped: the U1 forgot it at its
    // last start. Not for a key chosen after the login, nor once it was brought onto the printer again.
    const brought = ref(false);
    const keyForgotten = computed(() => opened.value?.via === "default" && !!opened.value?.key
      && opened.value.key === hosts.value?.[model.value]?.ssh?.key && !brought.value);
    function runCommand(ev) {
      const [kind, i] = ev.target.value.split(":");
      ev.target.value = "";
      const entry = commands.value[kind]?.[Number(i)];
      if (!entry) return;
      // An empty screen first (the user's wish): the prompt becomes the first line, then the call
      // and its result follow. Only on this side; the shell on the printer notices nothing.
      term?.clear();
      send({ type: "data", data: entry[1] + (kind === "act" ? "" : "\r") });
      term?.focus();
    }
    function clearScreen() {
      term?.clear();
      term?.focus();
    }
    const statusText = computed(() => (state.value === "open" ? S.status.open(`${opened.value.user}@${opened.value.host}`) : S.status[state.value]));
    const send = (message) => ws?.readyState === WebSocket.OPEN && ws.send(JSON.stringify(message));

    function drop() {
      if (ws) {
        ws.onclose = null;
        ws.close();
        ws = null;
      }
      observer?.disconnect();
      observer = null;
      term?.dispose();
      term = fit = null;
    }
    async function connect() {
      drop();
      error.value = "";
      errorDetail.value = "";
      opened.value = null;
      again.value = false;
      brought.value = false;
      state.value = "connecting";
      const { Terminal, FitAddon } = await loadXterm();
      await nextTick();
      term = new Terminal({ cursorBlink: true, fontSize: 13, scrollback: 5000, theme: theme(),
                            fontFamily: getComputedStyle(document.documentElement).getPropertyValue("--mono").trim() || "monospace" });
      fit = new FitAddon();
      term.loadAddon(fit);
      term.open(box.value);
      fit.fit();
      term.onData((data) => send({ type: "data", data }));
      term.onResize(({ cols, rows }) => send({ type: "resize", cols, rows }));
      observer = new ResizeObserver(() => fit?.fit());
      observer.observe(box.value);

      ws = new WebSocket(`ws://${location.host}/api/ssh?model=${encodeURIComponent(model.value)}`);
      ws.binaryType = "arraybuffer";
      ws.onopen = () => send({ type: "start", user: user.value.trim(), password: typed.value, cols: term.cols, rows: term.rows });
      ws.onmessage = (ev) => {
        if (ev.data instanceof ArrayBuffer) {
          term?.write(new Uint8Array(ev.data));
          return;
        }
        const m = JSON.parse(ev.data);
        if (m.type === "password") {
          state.value = "password";
          again.value = m.again;
          nextTick(() => document.getElementById("ssh-password")?.focus());
        } else if (m.type === "open") {
          state.value = "open";
          opened.value = m;
          term?.focus();
          // The user it logged in as, kept for the printer: "Auf den Drucker bringen" goes by it. Only
          // at the computer itself (from the LAN: local_only, nothing kept).
          const kept = hosts.value?.[model.value]?.ssh;
          if (m.user !== (kept?.user || (isU1.value ? "root" : "pi"))) {
            api.setSsh(model.value, m.user, kept?.key || null, kept?.login || null).then((r) => { hosts.value = r.printers; }).catch(() => {});
          }
        } else if (m.type === "error") {
          error.value = S.errors[m.code] || T.errors[m.code] || T.errors.unknown;
          errorDetail.value = m.detail || "";
        }
      };
      ws.onclose = () => {
        ws = null;
        state.value = opened.value || error.value ? "closed" : "idle";
      };
    }
    function login() {
      send({ type: "password", password: password.value });
      password.value = "";
      state.value = "connecting";
    }
    // Ends the session; what the terminal shows stays until the next connection.
    function disconnect() {
      ws?.close();
    }

    onMounted(async () => {
      try {
        printers.value = (await api.printers()).printers;
        model.value = host.value ? ui.printer : "";  // the watcher sets the user to match
      } catch (err) {
        printers.value = {};
        loadError.value = T.errors[err.code] || T.errors.unknown;
      }
    });
    // Along with the system, and with the switch at the bottom of the menu (data-theme on <html>).
    const recolour = () => term && (term.options.theme = theme());
    darkQuery.addEventListener("change", recolour);
    const themeWatch = new MutationObserver(recolour);
    themeWatch.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    onUnmounted(() => {
      darkQuery.removeEventListener("change", recolour);
      themeWatch.disconnect();
      drop();
    });

    return {
      T, S, STATUS, GROUPS, printers, loadError, model, user, typed, state, isU1, commands, runCommand, opened, error, errorDetail, password, again, box, active, host, activeName,
      statusText, connect, login, disconnect, go, hashOf, clearScreen, keyForgotten, brought,
    };
  },

  template: `
    <div class="page fill-page">
      <h1 id="page-title" tabindex="-1">{{ S.title }}</h1>
      <p class="note">{{ S.lead }}</p>

      <p v-if="loadError" class="alert" role="alert">{{ loadError }}</p>
      <p v-else-if="printers === null" class="note">{{ T.loading }}</p>
      <p v-else-if="!model" class="empty">{{ S.noHost(activeName()) }}
        <a class="link" :href="hashOf('drucker', instId)" @click="go($event, hashOf('drucker', instId))">{{ S.toPrinters }}</a></p>
      <template v-else>
        <form class="ssh-bar" @submit.prevent="connect">
          <div class="ssh-field">{{ S.printer }}<span class="ssh-static">{{ activeName() }} <small>{{ host }}</small></span></div>
          <label class="ssh-field">{{ S.user }}
            <input v-model="user" class="input ssh-user" type="text" autocomplete="off" spellcheck="false" :disabled="active">
          </label>
          <ssh-login :printer="model" v-model:password="typed" :disabled="active" @brought="brought = true"/>
          <button v-if="!active" class="btn btn-primary" type="submit" :disabled="!model || !user.trim()"><ui-icon name="terminal"/>{{ S.connect }}</button>
          <button v-else class="btn" type="button" @click="disconnect">{{ S.disconnect }}</button>
          <!-- The printer's host key only in the tooltip (the user: "Was bringt mir die Info?"; the U1 makes a new one at every start) -->
          <span :class="['cam-status', 'is-' + STATUS[state]]" :title="opened ? S.key(opened.fingerprint) + '\\n' + S.keyWhy : null">
            <span class="cam-dot"></span>{{ statusText }}</span>
        </form>
        <form v-if="state === 'password'" class="ssh-password" @submit.prevent="login">
          <label for="ssh-password">{{ again ? S.passwordAgain : S.passwordAsk(user.trim() + '@' + host) }}</label>
          <input id="ssh-password" v-model="password" class="input" type="password" autocomplete="off">
          <button class="btn btn-primary" type="submit" :disabled="!password">{{ S.login }}</button>
        </form>
        <p v-if="keyForgotten" class="note is-warn">{{ S.keys.refused }}</p>
        <p v-if="error" class="alert" role="alert">{{ error }}<small v-if="errorDetail" class="ssh-detail">{{ errorDetail }}</small></p>
        <div v-if="opened" class="ssh-tools">
          <label v-if="state === 'open'" class="ssh-commands" :title="S.commandsHint">{{ S.commandsLabel }}
            <select class="input" @change="runCommand">
              <option value="">{{ S.commandsPick }}</option>
              <optgroup v-for="g in GROUPS" :key="g" :label="S.groups[g]">
                <option v-for="(c, i) in commands[g]" :key="c[0]" :value="g + ':' + i">{{ S.commands[c[0]] }}</option>
              </optgroup>
            </select>
          </label>
          <button v-if="state === 'open'" class="btn" type="button" :title="S.clearHint" @click="clearScreen">{{ S.clear }}</button>
        </div>
        <div v-show="state !== 'idle'" class="ssh-screen"><div ref="box" class="ssh-term"></div></div>
        <p v-if="state === 'idle' && !error" class="note">{{ S.hint }}</p>
      </template>
    </div>
  `,
};
