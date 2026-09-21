import { T } from "./texts.js";
import { api, ApiError } from "./api.js";

const { createApp, ref, computed, onMounted } = Vue;

// The chosen instance is only a per-browser convenience; storage may be blocked.
const STORAGE_KEY = "orfix.instance";
function remembered() {
  try { return localStorage.getItem(STORAGE_KEY); } catch { return null; }
}
function remember(id) {
  try { localStorage.setItem(STORAGE_KEY, id); } catch { /* ignore */ }
}

createApp({
  setup() {
    const instances = ref([]);
    const selectedId = ref(null);
    const loading = ref(true);
    const error = ref(null);
    const newPath = ref("");
    const notice = ref(null);
    const busy = ref(false);

    const selected = computed(() => instances.value.find((i) => i.id === selectedId.value) || null);

    const slicerName = (i) => T.slicerNames[i.slicer] || i.slicer;
    const statusText = (i) => {
      if (!i.run_state.running) return T.status.closed;
      return i.run_state.reason === "process_unmapped" ? T.status.maybeRunning : T.status.running;
    };
    const statusClass = (i) => (i.run_state.running ? "status--warn" : "status--ok");
    const runDetail = (i) => T.runDetail(i.run_state, slicerName(i));
    const userFolders = (i) => {
      const names = new Set([...i.user_folders, i.active_user_folder]);
      return [...names].map((n) => (n === i.active_user_folder ? `${n} (${T.facts.userFolderActive})` : n)).join(", ");
    };
    const systemFormats = (i) =>
      i.system_formats.length ? i.system_formats.map((f) => T.facts.formats[f]).join(", ") : T.facts.noSystem;
    const confFormat = (i) => {
      if (i.conf_indent === null) return "–";
      const indent = i.conf_indent === "\t" ? T.facts.indentTab : T.facts.indentSpaces;
      return i.conf_checksum ? `${indent}, ${T.facts.checksum}` : indent;
    };
    const message = (err) => T.errors[err instanceof ApiError ? err.code : "unknown"] || T.errors.unknown;

    function select(id) {
      selectedId.value = id;
      remember(id);
    }

    async function load() {
      loading.value = true;
      error.value = null;
      try {
        const data = await api.instances();
        instances.value = data.instances;
        const ids = data.instances.map((i) => i.id);
        if (!ids.includes(selectedId.value)) {
          selectedId.value = ids.includes(remembered()) ? remembered() : ids[0] || null;
        }
      } catch (err) {
        error.value = message(err);
      } finally {
        loading.value = false;
      }
    }

    async function add() {
      busy.value = true;
      notice.value = null;
      try {
        const result = await api.addManual(newPath.value);
        newPath.value = "";
        notice.value = { kind: "ok", text: T.add.added };
        await load();
        select(result.instance.id);
      } catch (err) {
        notice.value = { kind: "error", text: message(err) };
      } finally {
        busy.value = false;
      }
    }

    async function remove(instance) {
      busy.value = true;
      notice.value = null;
      try {
        await api.removeManual(instance.data_dir);
        notice.value = { kind: "ok", text: T.list.removed };
        await load();
      } catch (err) {
        notice.value = { kind: "error", text: message(err) };
      } finally {
        busy.value = false;
      }
    }

    onMounted(load);

    return {
      T, instances, selectedId, selected, loading, error, newPath, notice, busy,
      slicerName, statusText, statusClass, runDetail, userFolders, systemFormats, confFormat,
      select, load, add, remove,
    };
  },

  template: `
    <header class="app-header">
      <span class="brand">{{ T.appName }}</span>
      <label v-if="instances.length" class="picker">
        <span class="muted">{{ T.instanceLabel }}</span>
        <select class="input" :value="selectedId" @change="select($event.target.value)">
          <option v-for="i in instances" :key="i.id" :value="i.id">
            {{ slicerName(i) }} {{ i.version || "" }} · {{ i.data_dir }}
          </option>
        </select>
      </label>
      <span v-if="selected" class="status" :class="statusClass(selected)" :title="runDetail(selected)">
        {{ statusText(selected) }}
      </span>
      <span class="spacer"></span>
      <button class="btn" type="button" :disabled="loading" @click="load">{{ T.reload }}</button>
    </header>

    <nav class="tabs" role="tablist">
      <button class="tab" role="tab" type="button" aria-selected="true">{{ T.tabs.overview }}</button>
      <button class="tab" role="tab" type="button" aria-selected="false" disabled>
        {{ T.tabs.manage }} <span class="muted">· {{ T.tabs.manageLater }}</span>
      </button>
    </nav>

    <main class="content">
      <p v-if="error" class="notice notice--error" role="alert">{{ error }}</p>
      <p v-if="loading && !instances.length" class="muted">{{ T.loading }}</p>

      <template v-else>
        <section v-if="!instances.length && !error" class="panel empty-state">
          <h2>{{ T.empty.title }}</h2>
          <p>{{ T.empty.text }}</p>
        </section>

        <template v-if="selected">
          <p v-if="selected.run_state.running" class="notice notice--warn">{{ runDetail(selected) }}</p>

          <section class="panel">
            <h2>{{ T.facts.title }}</h2>
            <table class="facts">
              <tbody>
                <tr><th scope="row">{{ T.facts.slicer }}</th><td>{{ slicerName(selected) }}</td></tr>
                <tr><th scope="row">{{ T.facts.version }}</th><td>{{ selected.version || T.facts.versionUnknown }}</td></tr>
                <tr><th scope="row">{{ T.facts.path }}</th><td class="mono">{{ selected.data_dir }}</td></tr>
                <tr><th scope="row">{{ T.facts.source }}</th><td>{{ T.sources[selected.source] }}</td></tr>
                <tr><th scope="row">{{ T.facts.userFolder }}</th><td class="mono">{{ userFolders(selected) }}</td></tr>
                <tr><th scope="row">{{ T.facts.account }}</th><td>{{ selected.logged_in ? T.facts.loggedIn : T.facts.notLoggedIn }}</td></tr>
                <tr><th scope="row">{{ T.facts.systemFormat }}</th><td>{{ systemFormats(selected) }}</td></tr>
                <tr><th scope="row">{{ T.facts.confFormat }}</th><td>{{ confFormat(selected) }}</td></tr>
                <tr v-if="selected.problems.length">
                  <th scope="row">{{ T.facts.problems }}</th>
                  <td><p v-for="p in selected.problems" :key="p" class="status status--error">{{ T.problems[p] || p }}</p></td>
                </tr>
              </tbody>
            </table>
          </section>

          <section class="panel empty-state">
            <h2>{{ T.profilesPending.title }}</h2>
            <p class="muted">{{ T.profilesPending.text }}</p>
          </section>
        </template>

        <section v-if="instances.length" class="panel">
          <h2>{{ T.list.title }}</h2>
          <table class="data-table">
            <thead>
              <tr>
                <th scope="col">{{ T.list.slicer }}</th>
                <th scope="col">{{ T.list.version }}</th>
                <th scope="col">{{ T.list.path }}</th>
                <th scope="col">{{ T.list.source }}</th>
                <th scope="col">{{ T.list.status }}</th>
                <th scope="col"><span class="visually-hidden">{{ T.list.remove }}</span></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="i in instances" :key="i.id" :class="{ 'is-selected': i.id === selectedId }">
                <td>{{ slicerName(i) }}</td>
                <td>{{ i.version || "–" }}</td>
                <td class="mono">{{ i.data_dir }}</td>
                <td>{{ T.sources[i.source] }}</td>
                <td><span class="status" :class="statusClass(i)">{{ statusText(i) }}</span></td>
                <td>
                  <button v-if="i.manual" class="btn" type="button" :disabled="busy" @click="remove(i)">{{ T.list.remove }}</button>
                </td>
              </tr>
            </tbody>
          </table>
        </section>

        <section class="panel">
          <h2>{{ T.add.title }}</h2>
          <p class="muted">{{ T.add.hint }}</p>
          <form class="add-form" @submit.prevent="add">
            <input class="input mono" v-model="newPath" :placeholder="T.add.placeholder" :aria-label="T.add.title">
            <button class="btn btn--primary" type="submit" :disabled="busy || !newPath.trim()">{{ T.add.button }}</button>
          </form>
          <p v-if="notice" class="notice" :class="'notice--' + notice.kind" role="status">{{ notice.text }}</p>
        </section>
      </template>
    </main>
  `,
}).mount("#app");
