// The key a printer's SSH logs in with (orcaone/ssh.py; the user's wish of 25.09.2026: a key named
// other than id_* was never tried): chosen from the private keys in ~/.ssh of the computer OrcaOne
// runs on, and on a click brought onto the printer. On the pages "SSH" and "Netzwerk"; from another
// device in the LAN neither works (app.is_remote), the box says so.
import { hosts, flash } from "../common.js";
import { T } from "../texts.js";
import { api } from "../api.js";

const { ref, computed, onMounted } = Vue;
const K = T.ssh.keys;

export const SshKey = {
  name: "SshKey",
  props: { printer: { type: String, required: true } },

  setup(props) {
    const keys = ref(null);      // [{ name, type, fingerprint, passphrase }], null while loading
    const localOnly = ref(false);
    const busy = ref(false);
    const result = ref(null);    // { cls, text } after bringing
    const asking = ref(false);   // neither key nor default password fit: the page asks for one
    const password = ref("");
    const chosen = computed(() => hosts.value?.[props.printer]?.ssh?.key || "");
    const errorText = (err) => K.errors[err.code] || T.errors[err.code] || T.errors.unknown;

    onMounted(async () => {
      try {
        keys.value = (await api.sshKeys()).keys;
      } catch (err) {
        keys.value = [];
        localOnly.value = err.code === "local_only";
      }
    });
    async function choose(ev) {
      try {
        const user = hosts.value?.[props.printer]?.ssh?.user || null;
        hosts.value = (await api.setSsh(props.printer, user, ev.target.value || null)).printers;
        result.value = null;
      } catch (err) {
        flash(errorText(err));
      }
    }
    async function bring() {
      busy.value = true;
      result.value = null;
      try {
        const r = await api.bringKey(props.printer, asking.value ? password.value : undefined);
        asking.value = false;
        result.value = { cls: r.verified ? "ok" : "warn",
                         text: [r.verified ? K[r.result] : K.notVerified, r.forgets ? K.forgets : ""].filter(Boolean).join(" ") };
      } catch (err) {
        if (err.code === "ssh_login") {
          if (asking.value) result.value = { cls: "err", text: K.wrongPassword };   // the typed one did not fit either
          asking.value = true;
        } else {
          result.value = { cls: "err", text: errorText(err) };
        }
      } finally {
        password.value = "";
        busy.value = false;
      }
    }
    return { K, keys, localOnly, busy, result, asking, password, chosen, choose, bring };
  },

  template: `
    <div class="ssh-keypick">
      <p v-if="localOnly" class="note">{{ K.localOnly }}</p>
      <template v-else-if="keys">
        <div class="ssh-keypick-row">
          <label class="ssh-field">{{ K.label }}
            <select class="input" :value="chosen" @change="choose">
              <option value="">{{ K.auto }}</option>
              <option v-for="k in keys" :key="k.name" :value="k.name" :title="k.fingerprint">{{ k.name }} · {{ k.type }}{{ k.passphrase ? ' · ' + K.passphrase : '' }}</option>
            </select>
          </label>
          <button class="btn" type="button" :disabled="!chosen || busy" :title="K.bringHint" @click="bring">{{ busy ? K.bringing : K.bring }}</button>
          <span v-if="!keys.length" class="note">{{ K.none }}</span>
        </div>
        <form v-if="asking" class="ssh-keypick-row" @submit.prevent="bring">
          <label class="ssh-field ssh-keypick-ask">{{ K.passwordAsk }}
            <input v-model="password" class="input" type="password" autocomplete="off"></label>
          <button class="btn btn-primary" type="submit" :disabled="!password || busy">{{ K.bring }}</button>
        </form>
        <p v-if="result" :class="['ssh-keypick-result', 'is-' + result.cls]" role="status">{{ result.text }}</p>
      </template>
    </div>`,
};
