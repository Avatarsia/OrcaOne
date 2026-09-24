// Page "3D-Ansicht" (the user's wish of 24.09.2026: "die Superlative von Mainsail 3D View"): a print
// file in 3D, one of the printer of the top bar (the one it prints, or any other in "gcodes") or one
// from this computer, the same as on "2D-Ansicht" (pages/print-view.js reads it). three.js
// (vendor/three, loaded only on this page) draws every extruding move as a lit strand of its real
// width and height, coloured by filament or by line type, all in one draw call. While the printer
// prints the file shown, the page follows it: what is printed stands solid, the rest as a
// see-through skin, and the nozzle where it is (Klipper says how far it read,
// virtual_sdcard.file_position). A slider shows the layers up to one.
import { go, hashOf, ui, LOCALE, activeName, fmtSize } from "../common.js";
import { T } from "../texts.js";
import { usePrintFile, bedArea, FILE_PICKER, STAGE_STATE, typeColour, toolColour } from "./print-view.js";

const { ref, computed, watch, nextTick, onUnmounted } = Vue;
const V = T.view3d;
const MAX_COLOURS = 64;     // tools and line types the shader knows

// The strand of one segment, before the vertex shader stretches it: x along it (0 … 1), y across
// (-0.5 … 0.5), z down from the top of the layer (0 … -1). Top and both sides, each with its normal.
function strandGeometry(THREE) {
  const p = [], n = [], index = [];
  const face = (corners, normal) => {
    const base = p.length / 3;
    for (const c of corners) { p.push(...c); n.push(...normal); }
    index.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };
  face([[0, -0.5, 0], [1, -0.5, 0], [1, 0.5, 0], [0, 0.5, 0]], [0, 0, 1]);      // top
  face([[0, 0.5, 0], [1, 0.5, 0], [1, 0.5, -1], [0, 0.5, -1]], [0, 1, 0]);     // one side
  face([[0, -0.5, 0], [0, -0.5, -1], [1, -0.5, -1], [1, -0.5, 0]], [0, -1, 0]); // the other side
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(p, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(n, 3));
  g.setIndex(index);
  return g;
}

const VERTEX = `
  attribute vec3 a;     // start x, y, z in 1/50 mm
  attribute vec2 b;     // end x, y
  attribute vec2 wh;    // width and height in 1/100 mm
  attribute float tool;
  attribute float kind;
  uniform float unit;
  uniform vec3 colours[${MAX_COLOURS}];
  uniform float byKind;
  uniform float printed;   // the segments before this one are printed
  uniform float split;     // 1 while following a print: printed ones solid, the rest see-through
  uniform float ghost;     // 1 for the pass that draws the rest
  varying vec3 vColour;
  varying vec3 vNormal;
  void main() {
    bool done = split < 0.5 || float(gl_InstanceID) < printed;
    if (done == (ghost > 0.5)) {  // not this pass: out of sight
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      return;
    }
    vec3 A = a / unit;
    vec2 d = b / unit - A.xy;
    float len = length(d);
    vec2 dir = len > 0.0001 ? d / len : vec2(1.0, 0.0);
    vec2 side = vec2(-dir.y, dir.x);
    float w = wh.x / 100.0, h = wh.y / 100.0;
    // Half a width longer at both ends, so corners close.
    float along = mix(-0.5 * w, len + 0.5 * w, position.x);
    vec3 p = vec3(A.xy + dir * along + side * (position.y * w), A.z + position.z * h);
    vNormal = normalize(normalMatrix * vec3(dir * normal.x + side * normal.y, normal.z));
    vColour = colours[int(byKind > 0.5 ? kind : tool)];
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }`;
const FRAGMENT = `
  uniform float ghost;
  uniform float opacity;
  varying vec3 vColour;
  varying vec3 vNormal;
  void main() {
    // Light from the upper right in front, as seen by the camera; a little everywhere.
    float light = 0.38 + 0.62 * max(dot(normalize(vNormal), normalize(vec3(0.35, 0.6, 0.7))), 0.0);
    // A little grey in every colour: else black filament is a flat black patch without shape.
    vec3 c = (vColour * 0.9 + 0.1) * light;
    gl_FragColor = ghost > 0.5 ? vec4(mix(c, vec3(1.0), 0.25), opacity) : vec4(c, 1.0);
    // three.js holds colours linear; the screen wants sRGB, as its own materials do it.
    #include <colorspace_fragment>
  }`;

export default {
  name: "Druck3dPage",
  props: { instId: { type: String, default: null } },  // the page does not depend on an installation

  setup(props) {
    const byKind = ref(false);      // colours by line type instead of filament
    const layer = ref(0);           // layers shown: 1 … layers
    const box = ref(null);          // the element the canvas sits in
    const file = usePrintFile(show);
    const { job, error, data, layers, printing, printedCount, follow } = file;

    // ------------------------------------------------------------ the drawing (three.js)
    let THREE = null, renderer = null, scene = null, camera = null, controls = null, observer = null, themeWatch = null;
    let solid = null, shell = null, see = null, nozzle = null, bed = null, frame = 0;
    const render = () => {
      if (frame || !renderer) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        // The nozzle keeps its size on the screen: from afar a bigger one, close up its own.
        if (nozzle?.visible) nozzle.scale.setScalar(Math.max(1, camera.position.distanceTo(nozzle.position) / 250));
        renderer.render(scene, camera);
      });
    };
    // The page's colours, resolved (the variables hold light-dark(…)).
    function cssColour(name) {
      const probe = document.body.appendChild(document.createElement("span"));
      probe.style.color = `var(${name})`;
      const c = getComputedStyle(probe).color;
      probe.remove();
      return new THREE.Color(c);
    }
    async function start() {
      if (renderer) return;
      const [three, orbit] = await Promise.all([import("../vendor/three/three.module.js"), import("../vendor/three/OrbitControls.js")]);
      THREE = three;
      try {
        renderer = new THREE.WebGLRenderer({ antialias: true, stencil: true });
      } catch {
        // No WebGL in this browser (switched off, or no graphics driver for it).
        renderer = null;
        throw new Error("no_webgl");
      }
      // A shader the graphics card does not take: said on the page, not only in the console.
      renderer.debug.onShaderError = (gl, program, vs, fs) => {
        console.error(gl.getProgramInfoLog(program), gl.getShaderInfoLog(vs), gl.getShaderInfoLog(fs));
        error.value = V.errors.shader;
      };
      renderer.setPixelRatio(window.devicePixelRatio || 1);
      box.value.appendChild(renderer.domElement);
      scene = new THREE.Scene();
      scene.add(new THREE.HemisphereLight(0xffffff, 0x777777, 2.5));  // for the nozzle, the strands light themselves
      camera = new THREE.PerspectiveCamera(40, 1, 1, 5000);
      camera.up.set(0, 0, 1);
      controls = new orbit.OrbitControls(camera, renderer.domElement);
      controls.zoomToCursor = true;
      controls.addEventListener("change", render);
      observer = new ResizeObserver(resize);
      observer.observe(box.value);
      themeWatch = new MutationObserver(recolour);
      themeWatch.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
      window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", recolour);
      resize();
      recolour();
    }
    function resize() {
      if (!renderer || !box.value) return;
      const { clientWidth: w, clientHeight: h } = box.value;
      if (!w || !h) return;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      render();
    }
    function recolour() {
      if (!renderer) return;
      scene.background = cssColour("--surface-2");
      if (bed) makeBed();
      render();
    }
    // The bed (bedArea), a line every 10 mm, a stronger one every 50 mm.
    function makeBed() {
      if (bed) {
        scene.remove(bed);
        bed.traverse((o) => { o.geometry?.dispose(); o.material?.dispose(); });
      }
      const area = bedArea(data.value, job.value?.motion);
      if (!area) return;
      const [x0, y0, x1, y1] = area;
      bed = new THREE.Group();
      const plate = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, y1 - y0),
        new THREE.MeshBasicMaterial({ color: cssColour("--surface"), side: THREE.DoubleSide }));
      plate.position.set((x0 + x1) / 2, (y0 + y1) / 2, -0.02);
      bed.add(plate);
      const fine = [], strong = [];
      for (let x = Math.ceil(x0 / 10) * 10; x <= x1; x += 10) (x % 50 ? fine : strong).push(x, y0, 0, x, y1, 0);
      for (let y = Math.ceil(y0 / 10) * 10; y <= y1; y += 10) (y % 50 ? fine : strong).push(x0, y, 0, x1, y, 0);
      for (const [list, name] of [[fine, "--divider"], [strong, "--line-box"]]) {
        const g = new THREE.BufferGeometry();
        g.setAttribute("position", new THREE.Float32BufferAttribute(list, 3));
        bed.add(new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: cssColour(name) })));
      }
      scene.add(bed);
    }
    function colourList() {
      const list = new Array(MAX_COLOURS).fill(0).map(() => new THREE.Color(typeColour("Other")));
      const d = data.value;
      if (byKind.value) d.types.forEach((name, i) => i < MAX_COLOURS && list[i].set(typeColour(name)));
      else for (let i = 0; i < MAX_COLOURS; i++) list[i].set(toolColour(d, i));
      return list;
    }
    function makeModel() {
      for (const mesh of [solid, shell, see]) if (mesh) { scene.remove(mesh); mesh.material.dispose(); }
      if (solid) solid.geometry.dispose();
      const d = data.value;
      const g = new THREE.InstancedBufferGeometry();
      const strand = strandGeometry(THREE);
      g.setIndex(strand.index);
      g.setAttribute("position", strand.getAttribute("position"));
      g.setAttribute("normal", strand.getAttribute("normal"));
      const pos = d.pos;
      // a: x0, y0, z from every fifth; b: x1, y1. Two views on the same numbers, no copy.
      const inter = new THREE.InstancedInterleavedBuffer(pos, 5, 1);
      g.setAttribute("a", new THREE.InterleavedBufferAttribute(inter, 3, 0, false));
      g.setAttribute("b", new THREE.InterleavedBufferAttribute(inter, 2, 3, false));
      g.setAttribute("wh", new THREE.InstancedBufferAttribute(d.wh, 2, false));
      g.setAttribute("tool", new THREE.InstancedBufferAttribute(d.tool, 1, false));
      g.setAttribute("kind", new THREE.InstancedBufferAttribute(d.kind, 1, false));
      g.instanceCount = d.count;
      g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);  // never culled as a whole
      const uniforms = () => ({
        unit: { value: d.unit }, colours: { value: colourList() }, byKind: { value: byKind.value ? 1 : 0 },
        printed: { value: d.count }, split: { value: 0 }, ghost: { value: 0 }, opacity: { value: 0.3 },
      });
      const material = (more) => new THREE.ShaderMaterial({ vertexShader: VERTEX, fragmentShader: FRAGMENT, uniforms: uniforms(), ...more });
      solid = new THREE.Mesh(g, material({}));
      // What is not printed yet: one see-through skin over the printed part. Drawn plainly, the
      // strands behind each other add up to a wall. So the first pass only finds the nearest
      // surface (depth), the second colours it there, once per pixel (stencil).
      shell = new THREE.Mesh(g, material({ colorWrite: false }));
      see = new THREE.Mesh(g, material({
        transparent: true, depthWrite: false,
        stencilWrite: true, stencilRef: 0, stencilFunc: THREE.EqualStencilFunc, stencilZPass: THREE.IncrementStencilOp,
      }));
      shell.material.uniforms.ghost.value = see.material.uniforms.ghost.value = 1;
      solid.frustumCulled = shell.frustumCulled = see.frustumCulled = false;
      shell.renderOrder = 1;
      see.renderOrder = 2;
      scene.add(solid, shell, see);
      makeBed();
      update();
    }
    // Which layers, which colours, how far printed: uniforms only, the numbers stay on the card.
    function update() {
      if (!solid || !data.value) return;  // a new file on its way
      const d = data.value;
      const shown = layer.value >= layers.value ? d.count : d.layerStart[layer.value];
      solid.geometry.instanceCount = shown;
      const split = follow.value && printing.value;
      for (const mesh of [solid, shell, see]) {
        mesh.material.uniforms.printed.value = split ? printedCount.value : d.count;
        mesh.material.uniforms.split.value = split ? 1 : 0;
        mesh.material.uniforms.byKind.value = byKind.value ? 1 : 0;
      }
      shell.visible = see.visible = split;
      const p = job.value?.motion.position;
      if (split && p && job.value.job.state !== "complete") {
        if (!nozzle) makeNozzle();
        nozzle.position.set(p[0], p[1], p[2]);
        nozzle.visible = true;
      } else if (nozzle) nozzle.visible = false;
      render();
    }
    // A nozzle with its tip at the origin: cone, hexagon above it.
    function makeNozzle() {
      const material = new THREE.MeshLambertMaterial({ color: cssColour("--accent") });
      const tip = new THREE.ConeGeometry(1.6, 3, 24).rotateX(-Math.PI / 2).translate(0, 0, 1.5);
      const hex = new THREE.CylinderGeometry(3, 3, 3.5, 6).rotateX(Math.PI / 2).translate(0, 0, 3 + 1.75);
      nozzle = new THREE.Group();
      nozzle.add(new THREE.Mesh(tip, material), new THREE.Mesh(hex, material));
      scene.add(nozzle);
    }
    watch([layer, follow, printedCount, printing], update);
    watch(byKind, () => {
      if (!solid) return;
      for (const mesh of [solid, shell, see]) mesh.material.uniforms.colours.value = colourList();
      update();
    });
    // Looks at the model: from the front, a little from the left and from above; or from above.
    function view(from = "oblique") {
      const b = data.value?.bounds;
      if (!b || !camera) return;
      const c = new THREE.Vector3((b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2, b.maxZ / 2);
      const size = Math.max(b.maxX - b.minX, b.maxY - b.minY, b.maxZ, 20);
      const at = from === "top" ? new THREE.Vector3(0, -0.01, 1.9) : new THREE.Vector3(-0.55, -1.35, 1.0);
      camera.position.copy(c).addScaledVector(at, size * 1.25);
      camera.near = size / 100;
      camera.far = size * 40;
      camera.updateProjectionMatrix();
      controls.target.copy(c);
      controls.update();
      render();
    }

    // ------------------------------------------------------------ a file read
    async function show(d) {
      // The layer "2D-Ansicht" showed, else all.
      layer.value = ui.viewLayer >= 1 && ui.viewLayer <= d.layerStart.length ? ui.viewLayer : d.layerStart.length;
      ui.viewLayer = null;
      await nextTick();
      try {
        await start();
      } catch (err) {
        error.value = err.message === "no_webgl" ? V.errors.no_webgl : file.errorText("unknown");
        return;
      }
      makeModel();
      view();
    }
    // The printer's bed mesh comes with its first answer: then the real bed.
    watch(() => job.value?.motion.mesh, (mesh, before) => { if (mesh && !before && solid) makeBed(); });
    // To "2D-Ansicht" with the same file and layer.
    function to2d(ev) {
      ui.viewLayer = layer.value;
      go(ev, hashOf("druck2d", props.instId));
    }
    onUnmounted(() => {
      observer?.disconnect();
      themeWatch?.disconnect();
      controls?.dispose();
      if (renderer) {
        scene.traverse((o) => { o.geometry?.dispose(); o.material?.dispose(); });
        renderer.dispose();
        renderer.domElement.remove();
      }
    });

    // ------------------------------------------------------------ what the page shows about it
    const num = (v, digits = 0) => v.toLocaleString(LOCALE, { minimumFractionDigits: digits, maximumFractionDigits: digits });
    // The legend: filaments the file uses with their colour and material, or the line types.
    const legend = computed(() => {
      const d = data.value;
      if (!d) return [];
      if (byKind.value) {
        const used = new Set(d.kind);
        return d.types.map((name, i) => ({ key: name, colour: typeColour(name), text: V.types[name] || name }))
          .filter((x, i) => used.has(i));
      }
      const used = [...new Set(d.tool)].sort((a, b) => a - b);
      return used.map((i) => ({ key: i, colour: toolColour(d, i), text: [`T${i}`, d.materials[i]].filter(Boolean).join(" · "), spool: true }));
    });

    return { ...file, T, V, V3: V, byKind, layer, box, legend, num, fmtSize, activeName, view, to2d, hashOf };
  },

  template: `
    <div class="page fill-page view3d-page">
      <div class="v3d-head">
        <h1 id="page-title" tabindex="-1">{{ V.title }}</h1>
${FILE_PICKER}
        <span class="spacer"></span>
        <div v-if="data" class="chips" role="group" :aria-label="V.colourBy">
          <button class="chip" type="button" :aria-pressed="!byKind ? 'true' : 'false'" @click="byKind = false">{{ V.byFilament }}</button>
          <button class="chip" type="button" :aria-pressed="byKind ? 'true' : 'false'" @click="byKind = true">{{ V.byType }}</button>
        </div>
        <label v-if="printing" class="v3d-follow"><input v-model="follow" type="checkbox">{{ V.follow }}</label>
        <a class="btn" :href="hashOf('druck2d', instId)" @click="to2d"><ui-icon name="toolpath"/>{{ V.to2d }}</a>
      </div>
      <p v-if="host === ''" class="note">{{ V.noHost(activeName()) }}</p>

      <div :class="['v3d-stage', { 'is-over': dragging }]" @dragover.prevent="dragging = true" @dragleave="dragging = false" @drop.prevent="onDrop">
        <div ref="box" class="v3d-canvas"></div>

${STAGE_STATE}

        <template v-if="data && !loading && !error">
          <div class="v3d-info">
            <strong :title="fileName">{{ fileName }}</strong>
            <span>{{ V.segments(num(data.count)) }} · {{ V.layersN(layers) }}</span>
            <span v-if="printing">{{ V.printedAt(printedLayer, layers) }}</span>
          </div>
          <div class="v3d-views">
            <button class="icon-btn" type="button" :title="V.viewOblique" :aria-label="V.viewOblique" @click="view('oblique')"><ui-icon name="refresh"/></button>
            <button class="icon-btn" type="button" :title="V.viewTop" :aria-label="V.viewTop" @click="view('top')"><ui-icon name="box"/></button>
          </div>
          <div v-if="layers > 1" class="v3d-layers">
            <span class="v3d-layer-text">{{ layer }}<small>/ {{ layers }}</small></span>
            <input v-model.number="layer" class="v3d-slider" type="range" min="1" :max="layers" step="1" :aria-label="V.layer">
            <span class="v3d-layer-z">{{ num(zOf(layer), 2) }} mm</span>
          </div>
          <ul class="v3d-legend">
            <li v-for="l in legend" :key="l.key">
              <spool-icon v-if="l.spool" :colour="l.colour" :size="18"/><span v-else class="v3d-swatch" :style="{ background: l.colour }"></span>{{ l.text }}</li>
          </ul>
        </template>
      </div>
    </div>
  `,
};
