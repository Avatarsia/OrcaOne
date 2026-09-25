// Page "Lizenz": who made OrcaOne and under which terms, reached with "by Dr. Klipper" at the bottom
// of the menu, not in the menu itself (the user's wish of 24.09.2026). The licence is part of the
// texts, formatted and folded by section: in English the binding original, in German the
// translation with the original to fold open below. LICENSE.md holds the same (tests/test_license.py).
import { T } from "../texts.js";
import EN from "../texts/en.js";

const { ref } = Vue;
const L = T.license;
const CONTACT = "dominik@drklipper.de";
const POLYFORM = "https://polyformproject.org/licenses/noncommercial/1.0.0";
// What orcaone/static/vendor holds (vendor/README.md), without versions so this list stays true.
const THIRD = [
  { name: "Vue", use: "vue", license: "MIT" },
  { name: "three.js", use: "three", license: "MIT" },
  { name: "xterm.js", use: "xterm", license: "MIT" },
  { name: "Inter", use: "inter", license: "SIL Open Font License 1.1" },
  { name: "JetBrains Mono", use: "mono", license: "SIL Open Font License 1.1" },
];

// "**bold**" and "`code`" of the licence texts as parts, so no HTML comes from a text.
const parts = (text) => text.split(/(\*\*[^*]+\*\*|`[^`]+`)/).filter(Boolean).map((p) =>
  p.startsWith("**") ? { bold: true, text: p.slice(2, -2) } : p.startsWith("`") ? { code: true, text: p.slice(1, -1) } : { text: p });

// The sections of one licence text, each to fold open; open: all of them at once.
const LicenseTerms = {
  name: "LicenseTerms",
  props: { terms: { type: Array, required: true }, open: { type: Boolean, default: false } },
  setup: () => ({ parts }),
  template: `
    <div class="license-terms">
      <details v-for="s in terms" :key="s.title" class="license-section" :open="open">
        <summary>{{ s.title }}</summary>
        <p v-for="(para, k) in s.text" :key="k"><template v-for="(p, j) in parts(para)" :key="j"><strong v-if="p.bold">{{ p.text }}</strong><code v-else-if="p.code">{{ p.text }}</code><template v-else>{{ p.text }}</template></template></p>
      </details>
    </div>
  `,
};

export default {
  name: "LizenzPage",
  components: { LicenseTerms },
  props: { instId: { type: String, default: null } },  // the page does not depend on an installation

  setup() {
    const allOpen = ref(false);
    // In another language than English the binding original comes along, to fold open.
    const original = T.lang === "en" ? null : EN.license.terms;
    return { T, L, CONTACT, POLYFORM, THIRD, allOpen, original };
  },

  template: `
    <div class="page license-page">
      <div class="license-head">
        <img class="license-logo" src="assets/app-icon.svg" alt="" width="64" height="64">
        <div>
          <p class="license-name">{{ T.appName }}</p>
          <p class="license-by">{{ T.by }}</p>
        </div>
      </div>
      <h1 id="page-title" tabindex="-1">{{ L.title }}</h1>
      <p class="note">PolyForm Noncommercial License 1.0.0</p>

      <section class="box">
        <p>{{ L.intro }}</p>
        <ul class="license-points">
          <li v-for="p in L.points" :key="p">{{ p }}</li>
        </ul>
        <p>{{ L.contact }} <a :href="'mailto:' + CONTACT">{{ CONTACT }}</a></p>
      </section>

      <section class="box">
        <div class="box-head"><h2>{{ L.thirdTitle }}</h2></div>
        <p class="note">{{ L.thirdLead }}</p>
        <table class="license-third">
          <tbody>
            <tr v-for="t in THIRD" :key="t.name"><th scope="row">{{ t.name }}</th><td>{{ L.uses[t.use] }}</td><td>{{ t.license }}</td></tr>
          </tbody>
        </table>
      </section>

      <section class="box">
        <div class="box-head">
          <h2>{{ L.termsTitle }}</h2>
          <button class="btn right" type="button" :aria-expanded="allOpen ? 'true' : 'false'" @click="allOpen = !allOpen">{{ allOpen ? L.collapseAll : L.expandAll }}</button>
        </div>
        <p class="note">{{ L.termsLead }} <a :href="POLYFORM" target="_blank" rel="noopener">{{ POLYFORM }}</a></p>
        <license-terms :terms="L.terms" :open="allOpen"/>
        <details v-if="original" class="license-original" lang="en" :open="allOpen">
          <summary>{{ L.originalTitle }}</summary>
          <license-terms :terms="original" :open="allOpen"/>
        </details>
      </section>
    </div>
  `,
};
