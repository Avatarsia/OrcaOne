// Page "Konsole": G-code straight to Klipper, through Moonraker, for any printer with Klipper and an
// address (orcaone/console.py, the user's wish of 24.09.2026); unlike "SSH" it needs no SSH and no
// Root Access. Moonraker keeps the last commands and answers; the page looks at them every second
// while it is visible, so own commands come back through them and need no echo. Before every
// command sent from here the view empties, so only its answer shows (the user's wish).
import { go, hashOf, ui, U1_MODELS, LOCALE } from "../common.js";
import { T } from "../texts.js";
import { api } from "../api.js";

const { ref, computed, watch, nextTick, onMounted, onUnmounted } = Vue;
const C = T.console;
// The first group asks Klipper and goes out at once; the second does something, so it only lands in
// the input line. On the U1 all of them exist (/printer/gcode/help and Klipper's own M-codes,
// checked 24.09.2026); its light as a bonus.
const GCODES = {
  look: [
    ["status", "STATUS"], ["firmware", "M115"], ["temperatures", "M105"], ["position", "GET_POSITION"],
    ["endstops", "QUERY_ENDSTOPS"], ["probe", "QUERY_PROBE"], ["mesh", "BED_MESH_OUTPUT"], ["help", "HELP"],
  ],
  act: [
    ["home", "G28"], ["motorsOff", "M84"], ["heatersOff", "TURN_OFF_HEATERS"], ["restart", "RESTART"],
    ["firmwareRestart", "FIRMWARE_RESTART"],
  ],
};
const U1_LIGHT = [["lightOn", "SET_LED LED=cavity_led WHITE=1"], ["lightOff", "SET_LED LED=cavity_led WHITE=0"]];
const POLL = 1000;  // ms between two looks at Moonraker's store

export default {
  name: "KonsolePage",
  props: { instId: { type: String, default: null } },  // the page does not depend on an installation

  setup() {
    const printers = ref(null);   // [{model, host}] with an address, null while loading
    const loadError = ref("");
    const model = ref("");
    const lines = ref([]);
    const failed = ref("");
    const line = ref("");
    const out = ref(null);
    const isU1 = computed(() => U1_MODELS.includes(model.value));
    const gcodes = computed(() => ({ look: GCODES.look, act: isU1.value ? [...GCODES.act, ...U1_LIGHT] : GCODES.act }));
    const errorText = (err) => C.errors[err.code] || T.errors[err.code] || T.errors.unknown;
    let since = 0, poller = null;
    const sent = [];
    let back = -1;  // where the arrow keys are in sent, -1: the new line

    const atBottom = () => !out.value || out.value.scrollTop + out.value.clientHeight >= out.value.scrollHeight - 24;
    const scrollDown = () => out.value && (out.value.scrollTop = out.value.scrollHeight);
    async function read() {
      if (document.hidden || !model.value) return;
      try {
        const fresh = (await api.gcodeHistory(model.value, since)).lines;
        failed.value = "";
        // Two looks may overlap (the one right after sending and the regular one): only what is
        // newer than the last line shown, else a line would show twice.
        const newer = fresh.filter((l) => l.time > since);
        if (!newer.length) return;
        const stick = atBottom();
        lines.value = [...lines.value, ...newer].slice(-1000);
        since = newer[newer.length - 1].time;
        if (stick) nextTick(scrollDown);
      } catch (err) {
        failed.value = errorText(err);
      }
    }
    function stop() {
      clearInterval(poller);
      poller = null;
    }
    watch(model, () => {
      stop();
      lines.value = [];
      since = 0;
      read();
      poller = setInterval(read, POLL);
      nextTick(() => document.getElementById("gcode-line")?.focus());
    });
    // Only this view forgets: what came before stays in Moonraker's store.
    function clearLines() {
      lines.value = [];
    }
    async function send(script = line.value) {
      const text = script.trim();
      if (!text) return;
      clearLines();
      try {
        await api.gcodeSend(model.value, text);
        if (sent[sent.length - 1] !== text) sent.push(text);
        back = -1;
        if (script === line.value) line.value = "";
        setTimeout(read, 300);
      } catch (err) {
        failed.value = errorText(err);
      }
    }
    // Arrow up and down go through the commands sent here, as in a shell.
    function historyKey(ev) {
      if (!sent.length || (ev.key !== "ArrowUp" && ev.key !== "ArrowDown")) return;
      ev.preventDefault();
      if (ev.key === "ArrowUp") back = back < 0 ? sent.length - 1 : Math.max(0, back - 1);
      else if (back >= 0) back = back + 1 >= sent.length ? -1 : back + 1;
      line.value = back < 0 ? "" : sent[back];
    }
    function runCommand(ev) {
      const [kind, i] = ev.target.value.split(":");
      ev.target.value = "";
      const entry = gcodes.value[kind]?.[Number(i)];
      if (!entry) return;
      if (kind === "look") return send(entry[1]);
      line.value = entry[1];
      nextTick(() => document.getElementById("gcode-line")?.focus());
    }
    const lineClass = (l) => (l.type === "command" ? "is-command" : l.message.startsWith("!!") ? "is-error" : "");
    const clock = (t) => new Date(t * 1000).toLocaleTimeString(LOCALE, { hour: "2-digit", minute: "2-digit", second: "2-digit" });

    onMounted(async () => {
      try {
        const found = Object.entries((await api.printers()).printers).map(([m, p]) => ({ model: m, host: p.host }));
        printers.value = found;
        // From a printer card (page "Drucker"), else the first U1.
        const wanted = found.find((p) => p.model === ui.printerFor) || found.find((p) => U1_MODELS.includes(p.model)) || found[0];
        ui.printerFor = null;
        model.value = wanted?.model || "";  // the watcher starts reading
      } catch (err) {
        printers.value = [];
        loadError.value = errorText(err);
      }
    });
    onUnmounted(stop);

    return {
      T, C, printers, loadError, model, lines, failed, line, out, gcodes, send, clearLines, historyKey, runCommand,
      lineClass, clock, go, hashOf,
    };
  },

  template: `
    <div class="page fill-page">
      <h1 id="page-title" tabindex="-1">{{ C.title }}</h1>
      <p class="note">{{ C.lead }}</p>

      <p v-if="loadError" class="alert" role="alert">{{ loadError }}</p>
      <p v-else-if="printers === null" class="note">{{ T.loading }}</p>
      <p v-else-if="!printers.length" class="empty">{{ C.none }}
        <a class="link" :href="hashOf('drucker', instId)" @click="go($event, hashOf('drucker', instId))">{{ C.toPrinters }}</a></p>
      <template v-else>
        <div class="ssh-bar">
          <label class="ssh-field">{{ C.printer }}
            <select v-model="model" class="input">
              <option v-for="p in printers" :key="p.model" :value="p.model">{{ p.model }} · {{ p.host }}</option>
            </select>
          </label>
          <label class="ssh-field" :title="C.commandsHint">{{ C.commandsLabel }}
            <select class="input console-commands" @change="runCommand">
              <option value="">{{ C.commandsPick }}</option>
              <optgroup v-for="g in ['look', 'act']" :key="g" :label="C.groups[g]">
                <option v-for="(c, i) in gcodes[g]" :key="c[0]" :value="g + ':' + i">{{ C.commands[c[0]] }}</option>
              </optgroup>
            </select>
          </label>
          <button class="btn" type="button" :title="C.clearHint" :disabled="!lines.length" @click="clearLines">{{ C.clear }}</button>
          <span v-if="failed" class="gcode-error" role="alert">{{ failed }}</span>
        </div>
        <div ref="out" class="gcode-out">
          <p v-if="!lines.length" class="note">{{ C.empty }}</p>
          <div v-for="(l, i) in lines" :key="i" :class="['gcode-line', lineClass(l)]">
            <span class="gcode-time">{{ clock(l.time) }}</span><span class="gcode-text">{{ l.type === 'command' ? '> ' + l.message : l.message }}</span>
          </div>
        </div>
        <form class="gcode-input" @submit.prevent="send()">
          <input id="gcode-line" v-model="line" class="input" type="text" autocomplete="off" spellcheck="false"
                 :placeholder="C.placeholder" :title="C.historyHint" :aria-label="C.placeholder" @keydown="historyKey">
          <button class="btn btn-primary" type="submit" :disabled="!line.trim()">{{ C.send }}</button>
        </form>
      </template>
    </div>
  `,
};
