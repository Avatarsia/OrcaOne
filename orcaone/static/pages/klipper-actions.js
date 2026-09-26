// Klipper, its firmware or the whole printer anew, each button with a line on what it does (the
// user's wish of 26.09.2026: after the emergency stop there was no restart, and after one the U1's
// display kept its error, so the whole printer too). In the strip above the pages of the printer
// part while Klipper is down (app.js) and on "Druck steuern". Only on a click; during a print the
// restarts after a question, the printer not at all (the server says no too, network.reboot); the
// printer after a question always, as it takes a minute.
import { flash } from "../common.js";
import { T } from "../texts.js";
import { api } from "../api.js";

const { ref } = Vue;
const K = T.klipperBar;
const ACTIONS = ["firmware", "restart", "reboot"];

export const KlipperActions = {
  name: "KlipperActions",
  props: {
    printer: { type: String, required: true },
    running: { type: Boolean, default: false },   // a print runs or is paused
  },

  setup(props) {
    const busy = ref(false);
    const asking = ref(null);   // the action waiting for its yes
    const errorText = (err) => [K.refusals[err.code] || T.network.errors[err.code] || T.files.errors[err.code] || T.errors[err.code]
      || T.errors.unknown, err.data?.detail].filter(Boolean).join(" ");
    async function run(what, sure = false) {
      if (!sure && (what === "reboot" || props.running)) {
        asking.value = what;
        return;
      }
      asking.value = null;
      busy.value = true;
      try {
        await (what === "reboot" ? api.rebootPrinter(props.printer) : api.restartKlipper(props.printer, what === "firmware"));
        flash(K.actions[what].sent);
      } catch (err) {
        flash(errorText(err));
      } finally {
        busy.value = false;
      }
    }
    return { K, ACTIONS, busy, asking, run };
  },

  template: `
    <ul class="klipper-actions">
      <li v-for="(a, i) in ACTIONS" :key="a">
        <button :class="['btn', { 'btn-primary': i === 0 }]" type="button" :disabled="busy || (a === 'reboot' && running)"
                :title="a === 'reboot' && running ? K.rebootPrinting : null" @click="run(a)">{{ K.actions[a].label }}</button>
        <span class="klipper-action-what">{{ K.actions[a].what }}</span>
        <span v-if="asking === a" class="ctl-ask" role="alertdialog" :aria-label="K.actions[a].label">
          <span>{{ a === 'reboot' ? K.rebootAsk : K.printingAsk }}</span>
          <button class="btn btn-danger-solid" type="button" @click="run(a, true)">{{ K.yes }}</button>
          <button class="btn" type="button" @click="asking = null">{{ K.no }}</button>
        </span>
      </li>
    </ul>`,
};
