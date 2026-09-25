// Page "3D Ansicht" (the user's wish of 24.09.2026: "die Superlative von Mainsail 3D View"): a print
// file in 3D, one of the printer of the top bar (the one it prints, or any other in "gcodes") or one
// from this computer, the same as on "2D Ansicht" (pages/print-view.js reads it). three.js
// (vendor/three, loaded only on this page) draws every extruding move as a lit strand of its real
// width and height, coloured by filament or by line type, all in one draw call. While the printer
// prints the file shown, the page follows it: what is printed stands solid, the rest as a
// see-through skin, and the nozzle where it is (Klipper says how far it read,
// virtual_sdcard.file_position). A slider shows the layers up to one. As in OrcaSlicer, the axes
// stand at the origin of the bed, and a cube at the bottom right turns the view (view-cube.js).
import { go, hashOf, ui, LOCALE, activeName, fmtSize, saveBlob } from "../common.js";
import { T } from "../texts.js";
import { usePrintFile, bedArea, STAGE_STATE, typeColour, toolColour, activeHead, isLight } from "./print-view.js";
import { makeViewCube, AXES, axisLetter } from "./view-cube.js";

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
    const cubeBox = ref(null);      // the one of the cube
    const stage = ref(null);        // all of it, for full screen
    const full = ref(false);
    const file = usePrintFile(show);
    const { job, error, data, layers, printing, printedCount, follow } = file;

    // ------------------------------------------------------------ the drawing (three.js)
    let THREE = null, renderer = null, scene = null, camera = null, controls = null, observer = null, themeWatch = null;
    let solid = null, shell = null, see = null, nozzle = null, bed = null, axes = null, cube = null, frame = 0;
    const render = () => {
      if (frame || !renderer) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        // The nozzle keeps its size on the screen: from afar a bigger one, close up its own.
        if (nozzle?.visible) nozzle.scale.setScalar(Math.max(1, camera.position.distanceTo(nozzle.position) / 250));
        // The axes stay two pixels wide and their letters 16 pixels high at any distance, as in
        // OrcaSlicer (the user: thicker was clumsy).
        if (axes) {
          const pixel = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.position.distanceTo(axes.position)
            / Math.max(1, renderer.domElement.clientHeight);
          const { rods, letters, length } = axes.userData;
          for (const rod of rods) rod.scale.set(pixel, 1, pixel);
          // Letters a little past the end, X and Y a little above the bed: right at it they looked stuck on (the user).
          for (const letter of letters) {
            letter.scale.setScalar(pixel * 16);
            letter.position.copy(letter.userData.dir).multiplyScalar(length + pixel * 18);
            if (!letter.userData.dir.z) letter.position.z = pixel * 7;
          }
          axes.position.z = pixel;  // on the bed, not in it
        }
        renderer.render(scene, camera);
        cube?.draw();
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
      scene.add(new THREE.HemisphereLight(0xffffff, 0x777777, 1.1));  // for the nozzle, the strands light themselves
      camera = new THREE.PerspectiveCamera(40, 1, 1, 5000);
      camera.up.set(0, 0, 1);
      // A light that goes with the camera, from the upper right as the strands have theirs: shine and
      // shade on the nozzle (the user: not one flat colour).
      const lamp = new THREE.DirectionalLight(0xffffff, 2.6);
      lamp.position.set(0.35, 0.6, 0.7);
      camera.add(lamp, lamp.target);
      scene.add(camera);
      controls = new orbit.OrbitControls(camera, renderer.domElement);
      controls.zoomToCursor = true;
      controls.addEventListener("change", render);
      cube = makeViewCube(THREE, cubeBox.value, { camera, controls, render, names: V.cube, colour: cssColour });
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
      cube?.recolour();
      render();
    }
    // The bed (bedArea), a line every 10 mm, a stronger one every 50 mm.
    function makeBed() {
      if (bed) {
        scene.remove(bed);
        bed.traverse((o) => { o.geometry?.dispose(); o.material?.map?.dispose(); o.material?.dispose(); });
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
      axes = makeAxes(Math.min(x1 - x0, y1 - y0));
      bed.add(axes);
      scene.add(bed);
    }
    // The axes at the machine's origin, as in OrcaSlicer: X red, Y green, Z blue, a tenth of the bed
    // long, each with its letter as on the cube. Thickness and letter size come with every picture (render).
    function makeAxes(size) {
      const group = new THREE.Group();
      const length = Math.max(15, size / 10);
      group.userData = { rods: [], letters: [], length };
      for (const [letter, dir, hex] of AXES) {
        const d = new THREE.Vector3(...dir);
        const rod = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, length, 8).translate(0, length / 2, 0),
          new THREE.MeshBasicMaterial({ color: hex }));
        rod.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d);
        const label = axisLetter(THREE, letter, hex);
        label.userData.dir = d;
        group.add(rod, label);
        group.userData.rods.push(rod);
        group.userData.letters.push(label);
      }
      return group;
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
        setHead(activeHead(job.value, d));
        nozzle.visible = true;
      } else if (nozzle) nozzle.visible = false;
      render();
    }
    // The nozzle with its tip at the origin, a little like the real one (the user: plastic, not one
    // flat colour): tip and hexagon of brass, the heater block in a sock of the head's filament
    // colour, the heat break above; over it the head's number when the printer has several.
    function makeNozzle() {
      const brass = new THREE.MeshPhongMaterial({ color: "#C9A04E", specular: "#FFF0C0", shininess: 90 });
      const facets = new THREE.MeshPhongMaterial({ color: "#B88F3E", specular: "#FFF0C0", shininess: 90, flatShading: true });
      const steel = new THREE.MeshPhongMaterial({ color: "#A7ADB4", specular: "#FFFFFF", shininess: 70 });
      const sock = new THREE.MeshPhongMaterial({ color: "#009688", specular: "#555555", shininess: 25 });
      const upright = (g, z) => g.rotateX(Math.PI / 2).translate(0, 0, z);
      // The sock with rounded edges, so light and shade run over it (a box looked flat).
      const w = 6, h = 4, r = 2, outline = new THREE.Shape();
      outline.moveTo(-w + r, -h);
      outline.lineTo(w - r, -h);
      outline.quadraticCurveTo(w, -h, w, -h + r);
      outline.lineTo(w, h - r);
      outline.quadraticCurveTo(w, h, w - r, h);
      outline.lineTo(-w + r, h);
      outline.quadraticCurveTo(-w, h, -w, h - r);
      outline.lineTo(-w, -h + r);
      outline.quadraticCurveTo(-w, -h, -w + r, -h);
      const block = new THREE.ExtrudeGeometry(outline, { depth: 5, bevelEnabled: true, bevelThickness: 1, bevelSize: 1, bevelSegments: 4, curveSegments: 8 });
      nozzle = new THREE.Group();
      nozzle.add(
        new THREE.Mesh(upright(new THREE.CylinderGeometry(1.5, 0.35, 3, 32), 1.5), brass),
        new THREE.Mesh(upright(new THREE.CylinderGeometry(3.2, 3.2, 3, 6), 4.5), facets),
        new THREE.Mesh(block.translate(2, 0, 7.5), sock),
        new THREE.Mesh(upright(new THREE.CylinderGeometry(1.4, 1.4, 6, 20), 16.5), steel),
      );
      nozzle.userData = { sock, badge: null, head: "" };
      scene.add(nozzle);
    }
    // The head printing (activeHead): the sock in its colour, its number above.
    function setHead({ index, colour, many }) {
      const u = nozzle.userData, key = `${index}|${colour}|${many}`;
      if (u.head === key) return;
      u.head = key;
      u.sock.color.set(colour);
      if (u.badge) {
        nozzle.remove(u.badge);
        u.badge.material.map.dispose();
        u.badge.material.dispose();
        u.badge = null;
      }
      if (!many) return;
      const c = document.createElement("canvas");
      c.width = c.height = 128;
      const g = c.getContext("2d");
      g.fillStyle = colour;
      g.beginPath();
      g.arc(64, 64, 56, 0, 2 * Math.PI);
      g.fill();
      g.lineWidth = 8;
      g.strokeStyle = "#FFFFFF";
      g.stroke();
      g.fillStyle = isLight(colour) ? "#1A1A1A" : "#FFFFFF";
      g.font = "700 72px Inter, system-ui, sans-serif";
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillText(String(index + 1), 64, 70);
      const map = new THREE.CanvasTexture(c);
      map.colorSpace = THREE.SRGBColorSpace;
      u.badge = new THREE.Sprite(new THREE.SpriteMaterial({ map, depthTest: false }));
      u.badge.renderOrder = 11;
      u.badge.position.set(0, 0, 28);
      u.badge.scale.setScalar(9);
      nozzle.add(u.badge);
    }
    watch([layer, follow, printedCount, printing], update);
    watch(layer, (L) => { if (data.value) ui.viewLayer = L; });
    watch(byKind, () => {
      if (!solid) return;
      for (const mesh of [solid, shell, see]) mesh.material.uniforms.colours.value = colourList();
      update();
    });
    // Looks at the model: straight from the front, tilted down, not turned (the user: the home view is
    // only tilted); or from above.
    function view(from = "oblique") {
      const b = data.value?.bounds;
      if (!b || !camera) return;
      const c = new THREE.Vector3((b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2, b.maxZ / 2);
      const size = Math.max(b.maxX - b.minX, b.maxY - b.minY, b.maxZ, 20);
      const at = from === "top" ? new THREE.Vector3(0, -0.01, 1.9) : new THREE.Vector3(0, -1.45, 1.05);
      camera.position.copy(c).addScaledVector(at, size * 1.25);
      camera.near = size / 100;
      camera.far = size * 40;
      camera.updateProjectionMatrix();
      controls.target.copy(c);
      controls.update();
      render();
    }
    // The whole model in the picture, looking from where the camera looks now.
    function fit() {
      const b = data.value?.bounds;
      if (!b || !camera) return;
      const c = new THREE.Vector3((b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2, b.maxZ / 2);
      const radius = Math.max(10, Math.hypot(b.maxX - b.minX, b.maxY - b.minY, b.maxZ) / 2);
      const half = THREE.MathUtils.degToRad(camera.fov / 2);
      const dir = camera.position.clone().sub(controls.target).normalize();
      camera.position.copy(c).addScaledVector(dir, radius / Math.sin(Math.min(half, Math.atan(Math.tan(half) * camera.aspect))));
      controls.target.copy(c);
      controls.update();
      render();
    }
    // Turns the model by 90° around the upright axis: left means counterclockwise seen from above.
    const spin = (degrees) => cube?.spin((degrees * Math.PI) / 180);
    // The picture as it is now, as a PNG named after the file.
    function saveImage() {
      if (!renderer) return;
      renderer.render(scene, camera);  // the drawing buffer is only sure right after drawing
      const name = (file.fileName.value || "OrcaOne").replace(/\.(gcode|gco|g|bgcode)$/i, "") + ".png";
      renderer.domElement.toBlob((blob) => blob && saveBlob(blob, name), "image/png");
    }
    // The stage fills the screen; Esc or the button again ends it.
    function toggleFullscreen() {
      if (document.fullscreenElement) document.exitFullscreen();
      else stage.value?.requestFullscreen?.();
    }
    const onFullscreen = () => { full.value = !!stage.value && document.fullscreenElement === stage.value; };
    document.addEventListener("fullscreenchange", onFullscreen);

    // ------------------------------------------------------------ a file read
    async function show(d) {
      // The layer both views stand at, else all.
      layer.value = ui.viewLayer >= 1 && ui.viewLayer <= d.layerStart.length ? ui.viewLayer : d.layerStart.length;
      ui.viewLayer = layer.value;
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
    // The printer's bed mesh comes with its first answer: then the real bed, drawn at once. A file from
    // the cache shows before that answer, and nothing else draws while the printer stands still: the
    // picture kept the bed guessed from the file until the next turn (the user).
    watch(() => job.value?.motion.mesh, (mesh, before) => {
      if (!mesh || before || !solid) return;
      makeBed();
      render();
    });
    // To "2D Ansicht", which shows the same file and layer (ui.viewLayer).
    const to2d = (ev) => go(ev, hashOf("druck2d", props.instId));
    onUnmounted(() => {
      document.removeEventListener("fullscreenchange", onFullscreen);
      observer?.disconnect();
      themeWatch?.disconnect();
      controls?.dispose();
      cube?.dispose();
      if (renderer) {
        scene.traverse((o) => { o.geometry?.dispose(); o.material?.map?.dispose(); o.material?.dispose(); });
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

    return {
      ...file, T, V, V3: V, byKind, layer, box, cubeBox, stage, full, legend, num, fmtSize, activeName, view, fit, spin, saveImage,
      toggleFullscreen, to2d, hashOf,
    };
  },

  template: `
    <div class="page fill-page view3d-page">
      <div class="v3d-head">
        <h1 id="page-title" tabindex="-1">{{ V.title }}</h1>
        <span class="spacer"></span>
        <div v-if="data" class="chips" role="group" :aria-label="V.colourBy">
          <button class="chip" type="button" :aria-pressed="!byKind ? 'true' : 'false'" @click="byKind = false">{{ V.byFilament }}</button>
          <button class="chip" type="button" :aria-pressed="byKind ? 'true' : 'false'" @click="byKind = true">{{ V.byType }}</button>
        </div>
        <label v-if="printing" class="v3d-follow"><input v-model="follow" type="checkbox">{{ V.follow }}</label>
        <a class="btn" :href="hashOf('druck2d', instId)" @click="to2d"><ui-icon name="toolpath"/>{{ V.to2d }}</a>
      </div>
      <p v-if="host === ''" class="note">{{ V.noHost(activeName()) }}</p>

      <div ref="stage" :class="['v3d-stage', { 'is-over': dragging }]" @dragover.prevent="dragging = true" @dragleave="dragging = false" @drop.prevent="onDrop">
        <div ref="box" class="v3d-canvas"></div>
        <!-- The cube stays in the page, so its canvas lives as long as the drawing -->
        <div ref="cubeBox" v-show="data && !loading && !error" class="v3d-cube"></div>

${STAGE_STATE}

        <template v-if="data && !loading && !error">
          <div class="v3d-info">
            <strong :title="fileName">{{ fileName }}</strong>
            <span>{{ V.segments(num(data.count)) }} · {{ V.layersN(layers) }}</span>
            <span v-if="printing">{{ V.printedAt(printedLayer, layers) }}</span>
          </div>
          <div v-if="layers > 1" class="v3d-layers">
            <span class="v3d-layer-text">{{ layer }}<small>/ {{ layers }}</small></span>
            <input v-model.number="layer" class="v3d-slider" type="range" min="1" :max="layers" step="1" :aria-label="V.layer">
            <span class="v3d-layer-z">{{ num(zOf(layer), 2) }} mm</span>
          </div>
          <!-- Legend on the left; the buttons for the view next to the cube (the user's wish) -->
          <div class="v3d-bottom">
            <ul class="v3d-legend">
              <li v-for="l in legend" :key="l.key">
                <spool-icon v-if="l.spool" :colour="l.colour" :size="18"/><span v-else class="v3d-swatch" :style="{ background: l.colour }"></span>{{ l.text }}</li>
            </ul>
            <div class="v3d-views" role="toolbar" :aria-label="V.viewTools">
              <button class="icon-btn" type="button" :title="V.viewOblique" :aria-label="V.viewOblique" @click="view('oblique')"><ui-icon name="home"/></button>
              <button class="icon-btn" type="button" :title="V.viewTop" :aria-label="V.viewTop" @click="view('top')"><ui-icon name="box"/></button>
              <button class="icon-btn" type="button" :title="V.viewFit" :aria-label="V.viewFit" @click="fit"><ui-icon name="fit"/></button>
              <button class="icon-btn" type="button" :title="V.turnLeft" :aria-label="V.turnLeft" @click="spin(-90)"><ui-icon name="rotateLeft"/></button>
              <button class="icon-btn" type="button" :title="V.turnRight" :aria-label="V.turnRight" @click="spin(90)"><ui-icon name="rotateRight"/></button>
              <button class="icon-btn" type="button" :title="V.saveImage" :aria-label="V.saveImage" @click="saveImage"><ui-icon name="download"/></button>
              <button class="icon-btn" type="button" :title="full ? V.fullscreenOff : V.fullscreen" :aria-label="full ? V.fullscreenOff : V.fullscreen"
                      @click="toggleFullscreen"><ui-icon :name="full ? 'shrink' : 'fullscreen'"/></button>
            </div>
          </div>
        </template>
      </div>
    </div>
  `,
};
