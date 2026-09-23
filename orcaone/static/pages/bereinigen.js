// Page "3MF bereinigen", a quick tool: a 3MF goes in, the same file comes back as a download
// without the printer, process, filaments and G-code of its project (importer.clean_3mf). The
// slicer then opens it with the printer chosen there instead of setting up a foreign one and
// remembering it (FINDINGS 4.8). Needs no slicer data and writes nothing but the download.
import { saveBlob } from "../common.js";
import { T } from "../texts.js";
import { api } from "../api.js";

const { ref } = Vue;
const C = T.clean3mf;

export default {
  name: "BereinigenPage",

  setup() {
    const busy = ref(false);
    const dragging = ref(false);
    const saved = ref("");   // name of the file saved last
    const error = ref("");

    async function clean(file) {
      if (!file || busy.value) return;
      busy.value = true;
      saved.value = error.value = "";
      try {
        const name = C.fileName(file.name.replace(/\.3mf$/i, ""));
        saveBlob(await api.clean3mf(file), name);
        saved.value = name;
      } catch (err) {
        error.value = C.errors[err.code] || T.errors[err.code] || T.errors.unknown;
      } finally {
        busy.value = false;
      }
    }
    const onPick = (ev) => { clean(ev.target.files[0]); ev.target.value = ""; };
    const onDrop = (ev) => { dragging.value = false; clean(ev.dataTransfer.files[0]); };

    return { C, busy, dragging, saved, error, onPick, onDrop };
  },

  template: `
    <div class="page">
      <h1 id="page-title" tabindex="-1">{{ C.title }}</h1>
      <p class="note">{{ C.lead }}</p>
      <section class="box">
        <label :class="['imp-drop', { 'is-over': dragging }]" @dragover.prevent="dragging = true" @dragleave="dragging = false" @drop.prevent="onDrop">
          <ui-icon name="broom" :size="28"/>
          <span><strong>{{ C.pick }}</strong> {{ C.drop }}</span>
          <input type="file" accept=".3mf" @change="onPick">
        </label>
        <p v-if="busy" class="note">{{ C.busy }}</p>
        <p v-else-if="error" class="alert" role="alert">{{ error }}</p>
        <p v-else-if="saved" class="clean-done st-on" role="status"><ui-icon name="check"/>{{ C.done(saved) }}</p>
        <p class="note">{{ C.leftover }}</p>
      </section>
    </div>
  `,
};
