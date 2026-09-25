// The cube at the bottom right of "3D-Ansicht" that shows the view and turns it, after FreeCAD's
// NaviCube (the user's wish of 24.09.2026): a click on a face looks straight at it, on an edge
// (the upright ones too) from halfway between its two faces, on a corner from its three. It has its
// own small canvas and scene and turns with the camera of the page. The axes as in OrcaSlicer's
// 3D view: X red, Y green, Z blue.

export const AXES = [["X", [1, 0, 0], "#E53935"], ["Y", [0, 1, 0], "#43A047"], ["Z", [0, 0, 1], "#1E88E5"]];

// The letter of an axis in its colour, facing the camera, never hidden: on the cube and at the bed.
export function axisLetter(THREE, letter, hex) {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d");
  g.fillStyle = hex;
  g.font = "700 96px Inter, system-ui, sans-serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(letter, 64, 70);
  const map = new THREE.CanvasTexture(c);
  map.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map, depthTest: false }));
  sprite.renderOrder = 10;
  return sprite;
}
const BEVEL = 0.28;   // edges and corners take this much of every side (of 1)
const SIZE = 120;     // CSS pixels
const TURN_MS = 400;
// Outward normal, where the text on it points up, and its name in the texts.
const FACES = [
  { n: [0, -1, 0], up: [0, 0, 1], name: "front" },
  { n: [0, 1, 0], up: [0, 0, 1], name: "back" },
  { n: [-1, 0, 0], up: [0, 0, 1], name: "left" },
  { n: [1, 0, 0], up: [0, 0, 1], name: "right" },
  { n: [0, 0, 1], up: [0, 1, 0], name: "top" },
  { n: [0, 0, -1], up: [0, -1, 0], name: "bottom" },
];

// names: the six faces and hint (texts view3d.cube); colour: a page colour as THREE.Color.
export function makeViewCube(THREE, host, { camera, controls, render, names, colour }) {
  const k = 1 - BEVEL;
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(window.devicePixelRatio || 1);
  renderer.setSize(SIZE, SIZE);
  const canvas = renderer.domElement;
  canvas.title = names.hint;
  host.appendChild(canvas);
  const scene = new THREE.Scene();
  const view = new THREE.OrthographicCamera(-2, 2, 2, -2, 0.1, 20);
  const pieces = [];
  const edges = [];      // outlines of all pieces, as pairs of points
  let hovered = null, turning = 0;

  // Its name, e.g. "Vorne rechts oben": front or back, left or right, top or bottom.
  function title(d) {
    const words = [d.y < -0.5 ? "front" : d.y > 0.5 ? "back" : "", d.x < -0.5 ? "left" : d.x > 0.5 ? "right" : "",
      d.z > 0.5 ? "top" : d.z < -0.5 ? "bottom" : ""].filter(Boolean);
    return words.map((w, i) => (i ? names[w].toLowerCase() : names[w])).join(" ");
  }
  function outline(points) {
    points.forEach((p, i) => edges.push(p, points[(i + 1) % points.length]));
  }
  function add(mesh, dir, face = null) {
    mesh.userData = { dir: dir.clone().normalize(), title: title(dir.clone().normalize()), face };
    pieces.push(mesh);
    scene.add(mesh);
  }

  // The six faces, each with its name; the text reads upright from outside.
  for (const f of FACES) {
    const n = V(...f.n), up = V(...f.up), right = up.clone().cross(n);
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2 * k, 2 * k), new THREE.MeshBasicMaterial());
    mesh.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, up, n));
    mesh.position.copy(n);
    add(mesh, n, f.name);
    outline([[1, 1], [-1, 1], [-1, -1], [1, -1]].map(([a, b]) =>
      n.clone().addScaledVector(right, a * k).addScaledVector(up, b * k)));
  }
  // The twelve edges between two faces, bevelled at 45°.
  const unit = [V(1, 0, 0), V(0, 1, 0), V(0, 0, 1)];
  for (const [i, j, along] of [[0, 1, 2], [0, 2, 1], [1, 2, 0]]) {
    for (const si of [-1, 1]) {
      for (const sj of [-1, 1]) {
        const a = unit[i].clone().multiplyScalar(si), b = unit[j].clone().multiplyScalar(sj), e = unit[along];
        const points = [
          a.clone().addScaledVector(b, k).addScaledVector(e, -k), a.clone().addScaledVector(b, k).addScaledVector(e, k),
          a.clone().multiplyScalar(k).add(b).addScaledVector(e, k), a.clone().multiplyScalar(k).add(b).addScaledVector(e, -k),
        ];
        const g = new THREE.BufferGeometry().setFromPoints(points);
        g.setIndex([0, 1, 2, 0, 2, 3]);
        add(new THREE.Mesh(g, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })), a.clone().add(b));
        outline(points);
      }
    }
  }
  // The eight corners.
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const points = [V(sx, sy * k, sz * k), V(sx * k, sy, sz * k), V(sx * k, sy * k, sz)];
        const g = new THREE.BufferGeometry().setFromPoints(points);
        g.setIndex([0, 1, 2]);
        add(new THREE.Mesh(g, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })), V(sx, sy, sz));
        outline(points);
      }
    }
  }
  const lines = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(edges), new THREE.LineBasicMaterial());
  scene.add(lines);

  // The axes along three edges from the front left bottom corner, as in OrcaSlicer, with a letter each.
  const origin = V(-1.12, -1.12, -1.12);
  for (const [letter, dir, hex] of AXES) {
    const d = V(...dir);
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 2.35, 8).translate(0, 1.175, 0),
      new THREE.MeshBasicMaterial({ color: hex }));
    rod.quaternion.setFromUnitVectors(V(0, 1, 0), d);
    rod.position.copy(origin);
    const sprite = axisLetter(THREE, letter, hex);
    sprite.position.copy(origin).addScaledVector(d, 2.6);
    sprite.scale.setScalar(0.5);
    scene.add(rod, sprite);
  }

  function texture(draw) {
    const c = document.createElement("canvas");
    c.width = c.height = 256;
    draw(c.getContext("2d"));
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = renderer.capabilities.getMaxAnisotropy();
    return t;
  }
  function faceTexture(text, bg, fg) {
    return texture((g) => {
      g.fillStyle = bg;
      g.fillRect(0, 0, 256, 256);
      g.fillStyle = fg;
      g.font = "700 64px Inter, system-ui, sans-serif";
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillText(text, 128, 134, 236);
    });
  }

  // The page's colours: faces like cards, edges and corners like buttons, the one under the mouse in teal.
  let colours = null;
  function recolour() {
    const face = colour("--surface"), bevel = colour("--btn"), accent = colour("--accent");
    colours = { bevel, accent };
    for (const p of pieces) {
      const m = p.material;
      if (p.userData.face) {
        m.userData.plain?.dispose();
        m.userData.hover?.dispose();
        m.userData.plain = faceTexture(names[p.userData.face], face.getStyle(), colour("--label").getStyle());
        m.userData.hover = faceTexture(names[p.userData.face], accent.getStyle(), "#FFFFFF");
        m.map = p === hovered ? m.userData.hover : m.userData.plain;
        m.needsUpdate = true;
      } else {
        m.color.copy(p === hovered ? accent : bevel);
      }
    }
    lines.material.color.copy(colour("--line-box"));
    draw();
  }
  function paint(p, on) {
    if (p.userData.face) {
      p.material.map = on ? p.material.userData.hover : p.material.userData.plain;
      p.material.needsUpdate = true;
    } else {
      p.material.color.copy(on ? colours.accent : colours.bevel);
    }
  }

  // Looks at the cube from where the page's camera looks at the model.
  function draw() {
    view.position.copy(camera.position).sub(controls.target).normalize().multiplyScalar(6);
    view.up.copy(camera.up);
    view.lookAt(0, 0, 0);
    renderer.render(scene, view);
  }

  const ray = new THREE.Raycaster();
  function pieceAt(ev) {
    const r = canvas.getBoundingClientRect();
    const at = new THREE.Vector2(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(at, view);
    return ray.intersectObjects(pieces, false)[0]?.object || null;
  }
  function hover(p) {
    if (p === hovered) return;
    if (hovered) paint(hovered, false);
    hovered = p;
    if (p) paint(p, true);
    canvas.title = p ? p.userData.title : names.hint;
    canvas.style.cursor = p ? "pointer" : "";
    draw();
  }

  // Moves the camera around the point it looks at, the same distance away; at(t) is the direction
  // it looks from at t (0 … 1).
  function animate(at) {
    cancelAnimationFrame(turning);
    const target = controls.target.clone();
    const dist = camera.position.distanceTo(target);
    const start = performance.now();
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const step = (now) => {
      const t = still ? 1 : Math.min(1, (now - start) / TURN_MS);
      camera.position.copy(target).addScaledVector(at(t < 0.5 ? 2 * t * t : 1 - (2 - 2 * t) ** 2 / 2), dist);
      camera.lookAt(target);
      controls.update();
      render();
      turning = t < 1 ? requestAnimationFrame(step) : 0;
    };
    turning = requestAnimationFrame(step);
  }
  const looking = () => camera.position.clone().sub(controls.target).normalize();
  // Until it looks from dir, the shortest way.
  function turnTo(dir) {
    const from = looking();
    // Straight from above or below, the camera's up (Z) would leave it free to spin: a hair to the front.
    const to = Math.hypot(dir.x, dir.y) < 1e-6 ? V(0, -0.002, Math.sign(dir.z)).normalize() : dir.clone().normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(from, to);
    animate((t) => from.clone().applyQuaternion(new THREE.Quaternion().slerp(q, t)));
  }
  // Around the upright axis by angle (radians); also turns the view from above.
  function spin(angle) {
    const from = looking(), z = V(0, 0, 1);
    animate((t) => from.clone().applyAxisAngle(z, angle * t));
  }

  const onMove = (ev) => hover(pieceAt(ev));
  const onLeave = () => hover(null);
  const onClick = (ev) => {
    const p = pieceAt(ev);
    if (p) turnTo(p.userData.dir);
  };
  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerleave", onLeave);
  canvas.addEventListener("click", onClick);
  recolour();

  function dispose() {
    cancelAnimationFrame(turning);
    canvas.removeEventListener("pointermove", onMove);
    canvas.removeEventListener("pointerleave", onLeave);
    canvas.removeEventListener("click", onClick);
    scene.traverse((o) => {
      o.geometry?.dispose();
      if (!o.material) return;
      for (const t of [o.material.map, o.material.userData.plain, o.material.userData.hover]) t?.dispose();
      o.material.dispose();
    });
    renderer.dispose();
    canvas.remove();
  }
  return { draw, recolour, dispose, spin };
}
