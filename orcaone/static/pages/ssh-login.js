// How a printer's SSH logs in (orcaone/ssh.py, login_of), on the pages "SSH" and "Netzwerk": one
// choice (the user's wish of 26.09.2026: a password field with a key list beside it was fiddly),
// the password first, as most use it, then the keys of the computer OrcaOne runs on, automatic or
// one from ~/.ssh, which a click brings onto the printer. Kept per printer (ssh.save_setting); from
// another device in the LAN only the password (app.is_remote). A discreet button folds out what it
// all means, for someone who never met an SSH key.
//
// On "SSH" it sits in the bar and holds the password (v-model:password); the root then vanishes
// (display: contents), and the rows below the bar go last (CSS order). On "Netzwerk" only the keys
// (keysOnly; the user: a password or "automatic" brings nothing there): that page takes no typed
// password, without a key it logs in with the one as shipped.
import { hosts, flash, U1_MODELS } from "../common.js";
import { T } from "../texts.js";
import { api } from "../api.js";

const { ref, computed, onMounted } = Vue;
const S = T.ssh;
const K = S.keys;
const H = T.network.help;   // copy and its answers, as on "Netzwerk"
let count = 0;   // ids for label and help box, one set per instance

// The key the help makes has a name of its own (the user's wish of 26.09.2026: easier to tell
// apart than id_ed25519), so "automatic" does not find it: it is chosen in the list. ssh-keygen
// makes no folder for a named key (checked 26.09.2026 with OpenSSH 9.7 and Windows' own
// ssh-keygen), so .ssh comes first; Windows PowerShell hands ~ to a program as it is, hence $HOME.
export const KEY_FILE = "orcaone";
export const keyPath = (system) => (system === "windows" ? `$HOME\\.ssh\\${KEY_FILE}` : `~/.ssh/${KEY_FILE}`);
export const keygen = (system) => (system === "windows" ? `mkdir -Force $HOME\\.ssh > $null; ` : "mkdir -p ~/.ssh && ")
  + `ssh-keygen -t ed25519 -f ${keyPath(system)} -C ${KEY_FILE}`;
// Keys only work at the computer OrcaOne runs on, so this browser's system is that computer's.
const MY_SYSTEM = /Win/.test(navigator.userAgent) ? "windows" : "unix";

export const SshLogin = {
  name: "SshLogin",
  props: {
    printer: { type: String, required: true },
    password: { type: String, default: null },   // null: no password field
    disabled: { type: Boolean, default: false },  // while "SSH" is connected
    keysOnly: { type: Boolean, default: false },  // "Netzwerk": no key or one, no password, no "automatic"
  },
  emits: ["update:password", "brought"],   // brought: the key is on the printer and fits

  setup(props, { emit }) {
    const id = `ssh-login-${++count}`;
    const keys = ref(null);      // [{ name, type, fingerprint, passphrase }], null while loading
    const localOnly = ref(false);
    const helpOpen = ref(false);
    const busy = ref(false);
    const result = ref(null);    // { cls, text } after bringing
    const asking = ref(false);   // neither key nor default password fit: the page asks for one
    const askPassword = ref("");
    const kept = computed(() => hosts.value?.[props.printer]?.ssh || {});
    const isU1 = computed(() => U1_MODELS.includes(hosts.value?.[props.printer]?.model));
    // "password", "auto" or "key:<file name>"; a key's name starts with a letter or digit
    // (ssh.KEY_NAME), so it never clashes. From the LAN always the password, as the server does.
    const choice = computed(() => (localOnly.value ? "password" : kept.value.key ? `key:${kept.value.key}`
      : kept.value.login === "auto" ? "auto" : "password"));
    const chosenKey = computed(() => (choice.value.startsWith("key:") ? choice.value.slice(4) : null));
    // The kept key while the list loads, or when its file went away: shown, not lost.
    const missing = computed(() => chosenKey.value && !keys.value?.some((k) => k.name === chosenKey.value));
    const errorText = (err) => K.errors[err.code] || T.errors[err.code] || T.errors.unknown;
    const helpItems = computed(() => (props.keysOnly ? ["key", "bring"] : ["password", "key", "bring", "auto"]).map((k) => K.help.items[k]));
    const newKey = keygen(MY_SYSTEM);
    async function copy() {
      try {
        await navigator.clipboard.writeText(newKey);
        flash(H.copied);
      } catch {
        flash(H.copyFailed);   // only over https or on this computer (a secure context)
      }
    }

    onMounted(async () => {
      try {
        keys.value = (await api.sshKeys()).keys;
      } catch (err) {
        keys.value = [];
        localOnly.value = err.code === "local_only";
      }
    });
    async function choose(ev) {
      const value = ev.target.value;
      const key = value.startsWith("key:") ? value.slice(4) : null;
      try {
        hosts.value = (await api.setSsh(props.printer, kept.value.user || null, key, value === "auto" ? "auto" : null)).printers;
        result.value = null;
        asking.value = false;
        if (value !== "password") emit("update:password", "");   // a password typed before is not sent along
      } catch (err) {
        ev.target.value = choice.value;
        flash(errorText(err));
      }
    }
    async function bring() {
      busy.value = true;
      result.value = null;
      try {
        const r = await api.bringKey(props.printer, asking.value ? askPassword.value : undefined);
        asking.value = false;
        if (r.verified) emit("brought");
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
        askPassword.value = "";
        busy.value = false;
      }
    }
    return { S, K, H, id, keys, localOnly, helpOpen, busy, result, asking, askPassword, isU1, choice, chosenKey, missing, helpItems, newKey,
             choose, bring, copy, emit };
  },

  template: `
    <div class="ssh-login">
      <div class="ssh-field">
        <span class="ssh-login-head"><label :for="id">{{ keysOnly ? K.keyLabel : K.label }}</label>
          <button class="ssh-login-helpbtn" type="button" :aria-expanded="helpOpen ? 'true' : 'false'" :aria-controls="id + '-help'"
                  @click="helpOpen = !helpOpen"><ui-icon name="info" :size="14"/>{{ K.help.toggle }}</button></span>
        <select :id="id" class="input ssh-login-pick" :value="choice" :disabled="disabled" @change="choose">
          <!-- A flat list (the user: a group label indents its options oddly); each key says it is one. -->
          <option value="password">{{ keysOnly ? K.noKey : K.password }}</option>
          <option v-if="localOnly" disabled value="">{{ K.localOnlyShort }}</option>
          <template v-else>
            <!-- "automatic" chosen on "SSH" still shows on "Netzwerk", else it is not offered there -->
            <option v-if="!keysOnly || choice === 'auto'" value="auto" :title="K.autoHint">{{ K.auto }}</option>
            <option v-for="k in keys || []" :key="k.name" :value="'key:' + k.name" :title="k.fingerprint">
              {{ K.keyOption(k.name) }} · {{ k.type }}{{ k.passphrase ? ' · ' + K.passphrase : '' }}</option>
            <option v-if="missing" :value="'key:' + chosenKey">{{ K.keyOption(chosenKey) }}{{ keys ? ' · ' + K.missing : '' }}</option>
            <option v-if="keys && !keys.length" disabled value="">{{ K.none }}</option>
          </template>
        </select>
      </div>
      <label v-if="password !== null && choice === 'password'" class="ssh-field" :title="S.passwordHint">{{ S.password }}
        <input class="input ssh-pass" type="password" autocomplete="off" :value="password" :disabled="disabled"
               :placeholder="isU1 ? 'snapmaker' : S.optional" @input="emit('update:password', $event.target.value)">
      </label>
      <button v-if="chosenKey" class="btn" type="button" :disabled="busy || missing" :title="K.bringHint" @click="bring">
        {{ busy ? K.bringing : K.bring }}</button>

      <!-- No form of its own: on "SSH" this sits in the bar's form, so Enter brings the key here. -->
      <div v-if="asking" class="ssh-login-more ssh-login-ask">
        <label class="ssh-field">{{ K.passwordAsk }}
          <input v-model="askPassword" class="input" type="password" autocomplete="off" @keydown.enter.prevent="askPassword && !busy && bring()"></label>
        <button class="btn btn-primary" type="button" :disabled="!askPassword || busy" @click="bring">{{ K.bring }}</button>
      </div>
      <p v-if="result" :class="['ssh-login-more', 'ssh-login-result', 'is-' + result.cls]" role="status">{{ result.text }}</p>
      <div v-if="helpOpen" :id="id + '-help'" class="ssh-login-more ssh-login-help">
        <dl>
          <template v-for="item in helpItems" :key="item[0]"><dt>{{ item[0] }}</dt><dd>{{ item[1] }}</dd></template>
        </dl>
        <!-- From another device the command would fit that device, and a key there is of no use -->
        <template v-if="!localOnly">
          <p>{{ K.help.newKey }}</p>
          <div class="wifi-cmd"><code>{{ newKey }}</code><button class="link" type="button" @click="copy">{{ H.copy }}</button></div>
        </template>
        <p v-if="isU1">{{ K.help.u1 }}</p>
        <p v-if="localOnly">{{ K.localOnly }}</p>
      </div>
    </div>`,
};
