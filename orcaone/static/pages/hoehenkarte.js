// Page "Höhenkarte" (the user's wish of 25.09.2026): the bed mesh Klipper uses, for any Klipper
// printer with an address, read only (orcaone/monitor.py, mesh). On top the numbers that tell whether
// the bed is even: the range from the lowest to the highest point, and where these are. Below them
// side by side, on a phone one under the other (the user's wish): the mesh in 3D as Fluidd and
// Mainsail draw it (three.js, the height raised so it shows, turned with the mouse) and the same
// from above as fields with their height. Both show the probed points or the smoothed mesh, one
// switch for both (the user). Blue lower, red higher than zero; the front at the bottom of the
// fields and towards the viewer in 3D, as on "Status" and "Druck steuern". The mouse over a field
// marks the point in 3D and the other way round (the user's wish). From the probed points more than
// the range (the user: "da geht noch mehr"): a plane fitted through them tells the tilt of the bed
// and where it rises; what is left without it is its waviness.
import { go, hashOf, ui, activeName, LOCALE, darkQuery } from "../common.js";
import { T } from "../texts.js";
import { api } from "../api.js";

const { ref, computed, watch, nextTick, onMounted, onUnmounted } = Vue;
const H = T.mesh;

export default {
  name: "HoehenkartePage",
  props: { instId: { type: String, default: null } },  // the page does not depend on an installation

  setup() {
    const host = ref(null);   // null while OrcaOne looks it up, "" without an address
    const data = ref(null);   // monitor.mesh
    const failed = ref("");
    const reading = ref(false);
    const view = ref("probed");  // "probed" or "smooth", for 3D and the fields
    const errorText = (err) => T.monitor.errors[err.code] || T.errors[err.code] || T.errors.unknown;
    async function read() {
      if (!host.value || reading.value) return;
      reading.value = true;
      try {
        data.value = await api.printerMesh(ui.printer);
        failed.value = "";
      } catch (err) {
        failed.value = errorText(err);
      } finally {
        reading.value = false;
      }
    }
    // Once: the mesh changes only when the printer probes; "Neu lesen" asks again.
    let gone = false;
    onMounted(async () => {
      try {
        host.value = (await api.printers()).printers[ui.printer]?.host || "";
      } catch (err) {
        host.value = null;
        failed.value = errorText(err);
        return;
      }
      if (!gone) read();
    });

    const num = (v, digits = 3) => (v == null ? "–" : v.toLocaleString(LOCALE, { minimumFractionDigits: digits, maximumFractionDigits: digits }));
    const signed = (v) => (v > 0 ? "+" : "") + num(v);
    // The range, the lowest and the highest point with where they are on the bed.
    const facts = computed(() => {
      const d = data.value, m = d?.probed;
      if (!m || !d.min || !d.max) return null;
      const ny = m.length, nx = m[0].length, [x0, y0] = d.min, [x1, y1] = d.max;
      const at = (i, j) => [x0 + (nx > 1 ? (j * (x1 - x0)) / (nx - 1) : 0), y0 + (ny > 1 ? (i * (y1 - y0)) / (ny - 1) : 0)];
      let lo = { v: Infinity }, hi = { v: -Infinity };
      m.forEach((row, i) => row.forEach((v, j) => {
        if (v < lo.v) lo = { v, at: at(i, j) };
        if (v > hi.v) hi = { v, at: at(i, j) };
      }));
      // The plane through the points by least squares; on a full grid around its middle the slopes
      // come apart: a = Σx·z / Σx², b = Σy·z / Σy², the height in the middle the mean.
      const pts = m.flatMap((row, i) => row.map((v, j) => ({ x: at(i, j)[0], y: at(i, j)[1], v })));
      const n = pts.length, mx = (x0 + x1) / 2, my = (y0 + y1) / 2, mean = pts.reduce((s, p) => s + p.v, 0) / n;
      const sum = (fn) => pts.reduce((s, p) => s + fn(p), 0);
      const sxx = sum((p) => (p.x - mx) ** 2), syy = sum((p) => (p.y - my) ** 2);
      const a = sxx ? sum((p) => (p.x - mx) * p.v) / sxx : 0, b = syy ? sum((p) => (p.y - my) * p.v) / syy : 0;
      const rest = pts.map((p) => p.v - (mean + a * (p.x - mx) + b * (p.y - my)));
      const riseX = Math.abs(a) * (x1 - x0), riseY = Math.abs(b) * (y1 - y0);
      // Where it rises: both sides only when both matter, else the one that does.
      const toward = [riseY >= riseX / 4 ? (b > 0 ? "back" : "front") : "", riseX >= riseY / 4 ? (a > 0 ? "right" : "left") : ""].filter(Boolean);
      return {
        nx, ny, lo, hi, range: hi.v - lo.v, reach: Math.max(Math.abs(lo.v), Math.abs(hi.v)) || 0.1,
        mean, spread: Math.sqrt(sum((p) => (p.v - mean) ** 2) / n), tilt: riseX + riseY, toward,
        wave: Math.max(...rest) - Math.min(...rest),
      };
    });

    // ------------------------------------------------------------ the fields from above
    // The front row at the bottom, each field as wide as its share of the bed; the colour goes as far
    // as the biggest deviation from zero, the same in all views.
    const fillOf = (share) => `color-mix(in srgb, var(${share < 0 ? "--mesh-low" : "--mesh-high"}) ${Math.round(Math.abs(share) * 100)}%, var(--mesh-zero))`;
    const map = computed(() => {
      const d = data.value, f = facts.value, m = view.value === "smooth" ? d?.smooth : d?.probed;
      if (!m || !f) return null;
      const ny = m.length, nx = m[0].length, w = d.max[0] - d.min[0], h = d.max[1] - d.min[1];
      const cw = w / nx, ch = h / ny, cells = [];
      m.forEach((row, i) => row.forEach((v, j) => {
        cells.push({ key: i * nx + j, i, j, x: j * cw, y: (ny - 1 - i) * ch, v, fill: fillOf(Math.max(-1, Math.min(1, v / f.reach))) });
      }));
      return { w, h, cw, ch, cells, text: view.value === "probed", font: Math.min(cw, ch) * 0.27 };
    });

    // The point under the mouse, in the fields or on the surface: { i, j } of the view shown.
    const hover = ref(null);
    const grid = computed(() => {
      const d = data.value;
      return d && (view.value === "smooth" && d.smooth ? d.smooth : d.probed);
    });
    const hoverText = computed(() => {
      const h = hover.value, m = grid.value, d = data.value;
      if (!h || !m?.[h.i]) return "";
      const ny = m.length, nx = m[0].length;
      const x = d.min[0] + (h.j * (d.max[0] - d.min[0])) / (nx - 1), y = d.min[1] + (h.i * (d.max[1] - d.min[1])) / (ny - 1);
      return `${H.at(num(x, 0), num(y, 0))}: ${signed(m[h.i][h.j])} mm`;
    });
    watch(view, () => { hover.value = null; });

    // ------------------------------------------------------------ 3D, as Fluidd and Mainsail draw it
    // The mesh as a surface with lines along its rows and columns, the probed points on it, the zero
    // level as a frame; the height raised by a round factor so the bed's shape shows. Built anew with
    // new data, the other view, and when light or dark changes (its colours are the page's).
    const box3d = ref(null);
    const no3d = ref(false);
    const raised = ref(0);
    let THREE = null, renderer = null, scene = null, camera = null, controls = null, surface = null, observer = null, themeWatch = null;
    let shape = null, marker = null, scale = 1, pending = 0;  // the surface itself for the mouse, the marker on it
    function cssColour(name) {
      const probe = document.body.appendChild(document.createElement("span"));
      probe.style.color = `var(${name})`;
      const c = getComputedStyle(probe).color;
      probe.remove();
      return new THREE.Color(c);
    }
    const round = (s) => { const p = 10 ** Math.floor(Math.log10(s)); return Math.max(1, Math.round((s / p) * 2) / 2 * p); };
    async function start3d() {
      if (renderer || no3d.value || !box3d.value) return;
      const [three, orbit] = await Promise.all([import("../vendor/three/three.module.js"), import("../vendor/three/OrbitControls.js")]);
      if (gone || renderer) return;
      THREE = three;
      try {
        renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      } catch {
        // No WebGL in this browser: the fields alone then.
        no3d.value = true;
        return;
      }
      renderer.setPixelRatio(window.devicePixelRatio || 1);
      box3d.value.appendChild(renderer.domElement);
      scene = new THREE.Scene();
      scene.add(new THREE.HemisphereLight(0xffffff, 0x888888, 1.0));
      camera = new THREE.PerspectiveCamera(35, 1, 1, 20000);
      camera.up.set(0, 0, 1);
      const lamp = new THREE.DirectionalLight(0xffffff, 0.8);
      lamp.position.set(0.3, -0.4, 1);
      camera.add(lamp);
      scene.add(camera);
      controls = new orbit.OrbitControls(camera, renderer.domElement);
      controls.addEventListener("change", render);
      // The mouse on the surface marks its point in the fields too.
      const ray = new THREE.Raycaster(), spot = new THREE.Vector2();
      renderer.domElement.addEventListener("pointermove", (ev) => {
        cancelAnimationFrame(pending);
        pending = requestAnimationFrame(() => {
          if (!shape) return;
          const r = renderer.domElement.getBoundingClientRect();
          spot.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
          ray.setFromCamera(spot, camera);
          const hit = ray.intersectObject(shape)[0], m = grid.value, d = data.value;
          if (!hit || !m) { hover.value = null; return; }
          const ny = m.length, nx = m[0].length;
          hover.value = { i: Math.round(((hit.point.y - d.min[1]) / (d.max[1] - d.min[1])) * (ny - 1)),
                          j: Math.round(((hit.point.x - d.min[0]) / (d.max[0] - d.min[0])) * (nx - 1)) };
        });
      });
      renderer.domElement.addEventListener("pointerleave", () => { cancelAnimationFrame(pending); hover.value = null; });
      observer = new ResizeObserver(resize);
      observer.observe(box3d.value);
      themeWatch = new MutationObserver(() => build());
      themeWatch.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
      darkQuery.addEventListener("change", rebuild);
      build(true);
    }
    const rebuild = () => build();
    function build(first = false) {
      const d = data.value, f = facts.value;
      if (!renderer || !f) return;
      drop();
      const m = view.value === "smooth" && d.smooth ? d.smooth : d.probed, ny = m.length, nx = m[0].length, [x0, y0] = d.min, [x1, y1] = d.max;
      const w = x1 - x0, h = y1 - y0;
      scale = round((0.12 * Math.max(w, h)) / f.reach);
      raised.value = scale;
      const low = cssColour("--mesh-low"), high = cssColour("--mesh-high"), zero = cssColour("--mesh-zero");
      const pos = [], col = [], idx = [];
      m.forEach((row, i) => row.forEach((v, j) => {
        pos.push(x0 + (j * w) / (nx - 1), y0 + (i * h) / (ny - 1), v * scale);
        const c = zero.clone().lerp(v < 0 ? low : high, Math.min(1, Math.abs(v) / f.reach));
        col.push(c.r, c.g, c.b);
      }));
      for (let i = 0; i < ny - 1; i++) {
        for (let j = 0; j < nx - 1; j++) {
          const a = i * nx + j;
          idx.push(a, a + 1, a + nx, a + 1, a + nx + 1, a + nx);
        }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
      geo.setIndex(idx);
      geo.computeVertexNormals();
      surface = new THREE.Group();
      shape = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }));
      surface.add(shape);
      const lines = [], at = (i, j) => pos.slice(3 * (i * nx + j), 3 * (i * nx + j) + 3);
      for (let i = 0; i < ny; i++) {
        for (let j = 0; j < nx; j++) {
          if (j < nx - 1) lines.push(...at(i, j), ...at(i, j + 1));
          if (i < ny - 1) lines.push(...at(i, j), ...at(i + 1, j));
        }
      }
      const lineGeo = new THREE.BufferGeometry();
      lineGeo.setAttribute("position", new THREE.Float32BufferAttribute(lines, 3));
      surface.add(new THREE.LineSegments(lineGeo, new THREE.LineBasicMaterial({ color: cssColour("--line-box"), transparent: true, opacity: 0.5 })));
      const pny = d.probed.length, pnx = d.probed[0].length, points = [];
      d.probed.forEach((row, i) => row.forEach((v, j) => points.push(x0 + (j * w) / (pnx - 1), y0 + (i * h) / (pny - 1), v * scale)));
      const dots = new THREE.BufferGeometry();
      dots.setAttribute("position", new THREE.Float32BufferAttribute(points, 3));
      surface.add(new THREE.Points(dots, new THREE.PointsMaterial({ color: cssColour("--text"), size: 5, sizeAttenuation: false })));
      const frame = new THREE.BufferGeometry().setFromPoints([[x0, y0], [x1, y0], [x1, y1], [x0, y1]].map(([x, y]) => new THREE.Vector3(x, y, 0)));
      surface.add(new THREE.LineLoop(frame, new THREE.LineBasicMaterial({ color: cssColour("--muted") })));
      // The marker: a ball on the point and a line down to the zero level.
      marker = new THREE.Group();
      marker.add(new THREE.Mesh(new THREE.SphereGeometry(Math.max(w, h) * 0.014, 16, 12), new THREE.MeshBasicMaterial({ color: cssColour("--accent") })));
      marker.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
        new THREE.LineBasicMaterial({ color: cssColour("--accent") })));
      surface.add(marker);
      scene.add(surface);
      mark();
      resize();
      if (first) fit();
    }
    // The marker at the point under the mouse, hidden without one.
    function mark() {
      if (!marker) return;
      const h = hover.value, m = grid.value, d = data.value;
      marker.visible = !!(h && m?.[h.i]?.[h.j] != null);
      if (marker.visible) {
        const ny = m.length, nx = m[0].length;
        const x = d.min[0] + (h.j * (d.max[0] - d.min[0])) / (nx - 1), y = d.min[1] + (h.i * (d.max[1] - d.min[1])) / (ny - 1), z = m[h.i][h.j] * scale;
        marker.children[0].position.set(x, y, z);
        marker.children[1].geometry.setFromPoints([new THREE.Vector3(x, y, 0), new THREE.Vector3(x, y, z)]);
      }
      render();
    }
    watch(hover, mark);
    // From the front left above, as close as the bed fits into the box, whatever its shape.
    function fit() {
      const [x0, y0] = data.value.min, [x1, y1] = data.value.max, cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
      const vfov = THREE.MathUtils.degToRad(camera.fov), hfov = 2 * Math.atan(Math.tan(vfov / 2) * camera.aspect);
      const dist = (0.45 * Math.hypot(x1 - x0, y1 - y0)) / Math.sin(Math.min(vfov, hfov) / 2);
      const dir = new THREE.Vector3(-0.45, -0.95, 0.65).normalize().multiplyScalar(dist);
      controls.target.set(cx, cy, 0);
      camera.position.set(cx + dir.x, cy + dir.y, dir.z);
      controls.update();
      render();
    }
    function drop() {
      if (!surface) return;
      scene.remove(surface);
      surface.traverse((o) => { o.geometry?.dispose(); o.material?.dispose(); });
      surface = shape = marker = null;
    }
    function resize() {
      if (!renderer || !box3d.value) return;
      const { clientWidth: w, clientHeight: h } = box3d.value;
      if (!w || !h) return;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      render();
    }
    const render = () => renderer && renderer.render(scene, camera);
    // Started once the mesh and its box are there, built anew with every new mesh and view.
    watch([facts, box3d, view], () => {
      if (!facts.value) return;
      if (renderer) build();
      else nextTick(start3d);
    });
    onUnmounted(() => {
      gone = true;
      observer?.disconnect();
      themeWatch?.disconnect();
      darkQuery.removeEventListener("change", rebuild);
      drop();
      controls?.dispose();
      renderer?.dispose();
    });

    return { T, H, host, data, failed, reading, view, read, facts, map, num, signed, box3d, no3d, raised, hover, hoverText, activeName, go, hashOf };
  },

  template: `
    <div class="page">
      <h1 id="page-title" tabindex="-1">{{ H.title }}</h1>
      <p class="note">{{ H.lead }}</p>

      <p v-if="host === ''" class="empty">{{ T.monitor.noHost(activeName()) }}
        <a class="link" :href="hashOf('drucker', instId)" @click="go($event, hashOf('drucker', instId))">{{ T.monitor.toPrinters }}</a></p>
      <p v-else-if="!data && !failed" class="note">{{ T.printers.live.asking }}</p>
      <template v-else>
        <p v-if="failed" class="alert" role="alert">{{ failed }}</p>
        <template v-if="data">
          <section class="box" aria-labelledby="mesh-h">
            <div class="box-head mesh-head">
              <h2 id="mesh-h">{{ activeName() }} · {{ host }}</h2>
              <button class="btn" type="button" :disabled="reading" @click="read"><ui-icon name="refresh"/>{{ H.reload }}</button>
            </div>
            <p v-if="!data.known" class="note">{{ H.missing }}</p>
            <p v-else-if="!facts" class="note">{{ H.none }}</p>
            <template v-else>
              <!-- The numbers that tell whether the bed is even -->
              <div class="sys-tiles mesh-facts">
                <div class="sys-tile"><small>{{ H.range }}</small><strong>{{ num(facts.range) }} mm</strong>
                  <small>{{ H.meanSpread(signed(facts.mean), num(facts.spread)) }}</small></div>
                <div class="sys-tile"><small>{{ H.lowest }}</small><strong class="mesh-low">{{ signed(facts.lo.v) }} mm</strong>
                  <small>{{ H.at(num(facts.lo.at[0], 0), num(facts.lo.at[1], 0)) }}</small></div>
                <div class="sys-tile"><small>{{ H.highest }}</small><strong class="mesh-high">{{ signed(facts.hi.v) }} mm</strong>
                  <small>{{ H.at(num(facts.hi.at[0], 0), num(facts.hi.at[1], 0)) }}</small></div>
                <div class="sys-tile" :title="H.tiltWhy"><small>{{ H.tilt }}</small><strong>{{ num(facts.tilt) }} mm</strong>
                  <small v-if="facts.toward.length">{{ H.rises(facts.toward.map((t) => H.sides[t]).join(' ')) }}</small></div>
                <div class="sys-tile" :title="H.waveWhy"><small>{{ H.wave }}</small><strong>{{ num(facts.wave) }} mm</strong>
                  <small>{{ H.waveSub }}</small></div>
                <div class="sys-tile"><small>{{ H.points }}</small><strong>{{ facts.nx }} × {{ facts.ny }}</strong>
                  <small v-if="data.profile">{{ H.profile(data.profile) }}</small></div>
              </div>
              <!-- One switch for both views (the user) -->
              <div class="mesh-views" role="group" :aria-label="H.view">
                <button v-for="t in ['probed', 'smooth']" :key="t" type="button" class="chip" :aria-pressed="view === t ? 'true' : 'false'"
                        :disabled="t === 'smooth' && !data.smooth" @click="view = t">{{ H.views[t] }}</button>
              </div>
              <!-- 3D and the fields side by side, on a phone one under the other -->
              <div :class="['mesh-both', { 'no-3d': no3d }]">
                <figure v-if="!no3d" class="mesh-3d">
                  <div ref="box3d" class="mesh-3d-box" role="img" :aria-label="H.alt(num(facts.range))"></div>
                  <figcaption v-if="raised" class="mesh-side">{{ H.raised(raised) }}</figcaption>
                </figure>
                <div class="mesh-2d">
                  <p v-if="no3d" class="note">{{ H.noWebgl }}</p>
                  <!-- From above, the front at the bottom -->
                  <figure v-if="map" class="mesh-map">
                    <span class="mesh-side">{{ H.back }}</span>
                    <svg :viewBox="'0 0 ' + map.w + ' ' + map.h" role="img" :aria-label="H.alt(num(facts.range))" @mouseleave="hover = null">
                      <g v-for="c in map.cells" :key="c.key" @mouseenter="hover = { i: c.i, j: c.j }">
                        <rect :x="c.x" :y="c.y" :width="map.cw" :height="map.ch" :style="{ fill: c.fill }"
                              :class="['mesh-cell', { 'is-hover': hover && hover.i === c.i && hover.j === c.j }]"><title>{{ signed(c.v) }} mm</title></rect>
                        <text v-if="map.text" :x="c.x + map.cw / 2" :y="c.y + map.ch / 2" :font-size="map.font" text-anchor="middle" dominant-baseline="central">{{ num(c.v, 2) }}</text>
                      </g>
                    </svg>
                    <span class="mesh-side">{{ H.front }}</span>
                  </figure>
                </div>
              </div>
              <p class="mesh-point" aria-live="polite">{{ hoverText || H.pointHint }}</p>
              <p class="mesh-legend">
                <span>{{ signed(-facts.reach) }}</span>
                <span class="mesh-scale"></span>
                <span>{{ signed(facts.reach) }} mm</span>
              </p>
            </template>
          </section>
        </template>
      </template>
    </div>
  `,
};
