// A cheat sheet for regular expressions in logs (the user's wish of 26.09.2026), on the pages
// "Logs" of the printer part and of the slicers: a quiet button folds it out, the most used signs on
// the left, examples for these logs on the right; a click on one puts it into the search.
import { T } from "../texts.js";

const { ref } = Vue;
const R = T.regexHelp;
let count = 0;

export const RegexHelp = {
  name: "RegexHelp",
  props: { examples: { type: String, required: true } },   // "printer" or "slicer"
  emits: ["use"],

  setup() {
    const open = ref(false);
    const id = `regex-help-${++count}`;
    return { R, open, id };
  },

  template: `
    <button class="link regex-help-btn" type="button" :aria-expanded="open ? 'true' : 'false'" :aria-controls="id" @click="open = !open">
      <ui-icon name="info" :size="14"/>{{ R.toggle }}</button>
    <div v-if="open" :id="id" class="regex-help">
      <p class="regex-help-lead">{{ R.lead }}</p>
      <div class="regex-help-cols">
        <dl class="regex-help-signs">
          <template v-for="s in R.signs" :key="s[0]"><dt><code>{{ s[0] }}</code></dt><dd>{{ s[1] }}</dd></template>
        </dl>
        <ul class="regex-help-examples">
          <li v-for="e in R.examples[examples]" :key="e[0]">
            <button class="link" type="button" :title="R.use" @click="open = false; $emit('use', e[0])"><code>{{ e[0] }}</code></button>
            <span>{{ e[1] }}</span></li>
        </ul>
      </div>
    </div>`,
};
