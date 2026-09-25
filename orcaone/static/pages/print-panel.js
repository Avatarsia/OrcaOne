// The side panel that starts a print, from "Dateien" and from the button next to the print file in
// the top bar (app.js, the user's wish of 24.09.2026). On the U1 with the options of its display and
// which head prints which filament (printer_files.start_print); on any other Klipper printer plainly
// (printer_files.start_plain). The printer itself says no while it prints.
import { flash, fmtSize, whenText } from "../common.js";
import { T } from "../texts.js";
import { api } from "../api.js";

const { ref, reactive, computed, onMounted, nextTick } = Vue;
const D = T.files;
export const OPTIONS = ["bed_level", "flow_calibrate", "shaper_calibrate", "time_lapse_camera"];
export const BUSY = ["printing", "paused"];

function duration(seconds) {
  const minutes = Math.max(1, Math.round(seconds / 60));
  return T.camera.print.duration(Math.floor(minutes / 60), minutes % 60);
}
// What the line of a file says: when, how big, how long it prints or plays, how many layers.
export function fileFacts(f) {
  return [
    f.modified && whenText(new Date(f.modified * 1000)),
    f.size != null && fmtSize(f.size),
    f.time && duration(f.time),
    f.layers && D.layers(f.layers),
    f.duration && D.length(f.duration),
  ].filter(Boolean).join(" · ");
}
// The select is narrow: material and kind, the maker would only repeat itself.
const spoolText = (h) => (h.loaded ? [h.type, h.sub_type].filter(Boolean).join(" ") : "");

export default {
  name: "PrintPanel",
  // camera: the U1's camera id (api.cameras), null for another Klipper printer; model: the printer
  // of the top bar; file: the print file as the lists give it (printer_files.listing); picture: its URL.
  props: {
    camera: { type: String, default: null }, model: { type: String, required: true },
    file: { type: Object, required: true }, picture: { type: String, default: "" },
  },
  emits: ["close", "started"],

  setup(props, { emit }) {
    const setup = ref(null);             // the U1's state, heads and options before a print (print_setup)
    const ready = ref(!props.camera);    // the U1's setup read
    const choice = reactive({ options: {}, map: {} });
    const starting = ref(false);
    const error = ref("");
    const busy = computed(() => BUSY.includes(setup.value?.state));
    const tools = computed(() => props.file.tools || []);
    const errorText = (err) => D.errors[err.code] || T.errors[err.code] || T.errors.unknown;

    // The options as set for the last print, and each filament of the file on the head the slicer
    // gave it (T0 on head 1, …), as the display offers them.
    onMounted(async () => {
      nextTick(() => document.getElementById("print-title")?.focus());
      if (!props.camera) return;
      try {
        setup.value = await api.printSetup(props.camera);
      } catch {
        setup.value = null;
      }
      const s = setup.value;
      for (const o of OPTIONS) choice.options[o] = !!s?.options?.[o];
      for (const t of tools.value) choice.map[t.tool] = t.tool < (s?.heads.length || 4) ? t.tool : 0;
      ready.value = true;
    });
    const headOf = (t) => setup.value?.heads[choice.map[t.tool]];
    const otherType = (t) => {
      const h = headOf(t);
      return h && h.loaded && h.type && t.type && h.type !== t.type ? h.type : "";
    };
    async function start() {
      const path = props.file.path || props.file.name;
      starting.value = true;
      error.value = "";
      try {
        if (props.camera) await api.startPrint(props.camera, path, { ...choice.options }, tools.value.map((t) => [t.tool, choice.map[t.tool]]));
        else await api.printPlain(props.model, path);
        flash(D.started(props.file.name));
        emit("started");
        emit("close");
      } catch (err) {
        error.value = [errorText(err), err.data?.detail].filter(Boolean).join(" ");
      } finally {
        starting.value = false;
      }
    }
    return { T, D, OPTIONS, setup, ready, choice, starting, error, busy, tools, headOf, otherType, start, spoolText, fileFacts };
  },

  template: `
    <aside class="panel print-panel" aria-labelledby="print-title" @keydown.esc="$emit('close')">
      <div class="panel-head">
        <h2 id="print-title" tabindex="-1">{{ D.printTitle }}</h2>
        <button class="icon-btn" type="button" :aria-label="T.close" @click="$emit('close')"><ui-icon name="close"/></button>
      </div>
      <div class="panel-body">
        <div class="print-file">
          <img v-if="picture" :src="picture" alt="">
          <div class="print-file-text">
            <strong class="print-name">{{ file.name }}</strong>
            <span class="files-meta">{{ fileFacts(file) }}</span>
          </div>
        </div>
        <p v-if="busy" class="alert" role="alert">{{ D.busy(setup.state) }}</p>
        <p v-if="!ready" class="note">{{ T.loading }}</p>
        <template v-else>
          <template v-if="setup">
            <h3>{{ D.optionsTitle }}</h3>
            <label v-for="o in OPTIONS" :key="o" class="print-option" :title="D.optionHints[o]">
              <input v-model="choice.options[o]" type="checkbox"><span>{{ D.options[o] }}</span></label>
            <p class="print-note">{{ D.lastUsed }}</p>
            <template v-if="tools.length">
              <h3>{{ D.mapTitle }}</h3>
              <div v-for="t in tools" :key="t.tool" class="print-map">
                <span class="files-tool print-map-from"><span class="files-dot" :style="{ background: t.colour || 'transparent' }"></span>{{ t.type }}</span>
                <ui-icon name="arrowRight" :size="16"/>
                <span class="files-dot" :style="{ background: headOf(t)?.colour || 'transparent' }"></span>
                <select v-model.number="choice.map[t.tool]" class="input" :aria-label="D.mapTitle + ': ' + t.type">
                  <option v-for="(h, i) in setup.heads" :key="i" :value="i">{{ D.headText(i + 1, spoolText(h)) }}</option>
                </select>
                <span v-if="otherType(t)" class="print-warn">{{ D.otherType(otherType(t)) }}</span>
              </div>
              <p class="print-note">{{ D.mapNote }}</p>
            </template>
          </template>
          <p class="print-check"><ui-icon name="warn" :size="16"/>{{ D.bedClear }}</p>
          <p v-if="error" class="alert" role="alert">{{ error }}</p>
          <div class="print-actions">
            <button class="btn btn-primary" type="button" :disabled="starting || busy" @click="start">
              <ui-icon name="play"/>{{ starting ? D.starting : D.start }}</button>
            <button class="btn" type="button" @click="$emit('close')">{{ T.cancel }}</button>
          </div>
        </template>
      </div>
    </aside>
  `,
};
