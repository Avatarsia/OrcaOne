// Reads a print file for the pages "3D Ansicht" and "2D Ansicht" (pages/print-view.js) in a worker,
// so the page stays smooth even with 100 MB: a file of the printer through OrcaOne or one from this
// computer, read byte by byte while it arrives. It hands back every move that extrudes as a
// segment, in typed arrays the graphics card takes as they are. Per segment: start x, y, z and end
// x, y in 1/50 mm (Int16, up to ±655 mm), width and height in 1/100 mm (Uint8), the tool (T0 …),
// the line type (;TYPE:), the byte where its line starts and the line's number; Klipper says how
// far it read in the file (virtual_sdcard.file_position), so the page knows what is printed. For
// "2D Ansicht" also the speed (mm/min), acceleration, part fan and nozzle temperature at that
// moment, the travels and retractions in between, and all "; key = value" settings of the file.
// Arcs (G2/G3) become short straight pieces, as Klipper prints them. Layers come from
// ;LAYER_CHANGE and ;Z: as OrcaSlicer and Snapmaker Orca write them, else from the height of the
// moves; per layer also the minutes left by the slicer (M73 R) and the filament it extrudes.
// Checked with files of the U1 on 24.09.2026 (FINDINGS).

const UNIT = 50;            // steps per mm for the positions
const WIDTH = 0.45;         // mm, a line without ;WIDTH:
const HEIGHT = 0.2;         // mm, a layer without ;HEIGHT:
const PROGRESS_EVERY = 1 << 21;  // bytes between two progress messages
const ARC_TOLERANCE = 0.02;      // mm a piece of an arc may stray from it
const MAX_SETTING = 4000;        // characters kept of one setting's value (start G-code is long)

// ------------------------------------------------------------ growing typed arrays
// A store holds arrays of the same length in records, `per` values each: { n, cap, <name>: array }.
function store(spec) {
  return { n: 0, cap: 0, spec };
}
function room(s, need) {
  if (need <= s.cap) return;
  const next = Math.max(need, Math.ceil(s.cap * 1.5), 65536);
  for (const [name, [Type, per]] of Object.entries(s.spec)) {
    const a = new Type(next * per);
    if (s[name]) a.set(s[name].subarray(0, s.n * per));
    s[name] = a;
  }
  s.cap = next;
}
function filled(s) {
  const out = {};
  for (const [name, [Type, per]] of Object.entries(s.spec)) out[name] = s[name] ? s[name].slice(0, s.n * per) : new Type(0);
  return out;
}
const seg = store({
  pos: [Int16Array, 5], wh: [Uint8Array, 2], tool: [Uint8Array, 1], kind: [Uint8Array, 1], offset: [Uint32Array, 1],
  line: [Uint32Array, 1], speed: [Uint16Array, 1], accel: [Uint16Array, 1], fan: [Uint8Array, 1], temp: [Uint16Array, 1],
});
// Travels (x0, y0, x1, y1) and retractions (x, y; 1 retract, 2 prime), each with the number of
// segments before it, so the page puts them between the right lines.
const trv = store({ travel: [Int16Array, 4], travelAt: [Uint32Array, 1] });
const ret = store({ retract: [Int16Array, 2], retractAt: [Uint32Array, 1], retractKind: [Uint8Array, 1] });

// ------------------------------------------------------------ what the file says so far
let x = 0, y = 0, z = 0, e = 0, f = 0;   // position, extruder, feed rate (mm/min)
let absXYZ = true, absE = true;          // G90/G91, M82/M83
let t = 0, type = 0, width = WIDTH, height = HEIGHT;
let acceleration = 0, fanSpeed = 0, bed = 0, left = NaN;
const targets = new Array(64).fill(0);   // nozzle temperature by tool (M104/M109)
const types = ["Other"];                 // ;TYPE: names in the order they come, index = kind
const typeIndex = new Map([["Other", 0]]);
let marked = false, pendingLayer = false, pendingZ = null, carryE = 0;
const layerStart = [], layerZ = [], layerLeft = [], layerE = [];  // first segment, height, minutes left, filament
const settings = {};
let generator = "", generated = "", lineNo = 0;
let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = 0;

const decoder = new TextDecoder();

// A number at buf[i]: [value, index after it] or null.
function number(buf, i, end) {
  let sign = 1, value = 0, seen = false;
  if (buf[i] === 45) { sign = -1; i++; } else if (buf[i] === 43) i++;
  while (i < end && buf[i] >= 48 && buf[i] <= 57) { value = value * 10 + buf[i] - 48; i++; seen = true; }
  if (buf[i] === 46) {
    i++;
    let scale = 0.1;
    while (i < end && buf[i] >= 48 && buf[i] <= 57) { value += (buf[i] - 48) * scale; scale *= 0.1; i++; seen = true; }
  }
  return seen ? [sign * value, i] : null;
}
// The value of a parameter like S in "M104 T0 S215", or null.
function param(buf, i, end, letter) {
  for (; i < end && buf[i] !== 59; i++) {
    if ((buf[i] | 32) === letter && (buf[i - 1] === 32 || buf[i - 1] === 9)) {
      const n = number(buf, i + 1, end);
      if (n) return n[0];
    }
  }
  return null;
}

function newLayer(atZ) {
  layerStart.push(seg.n);
  layerZ.push(atZ);
  layerLeft.push(left);
  layerE.push(carryE);
  carryE = 0;
}

function comment(buf, i, end) {
  // Only the comments the pages need: decode just those.
  while (i < end && buf[i] === 32) i++;
  const c = buf[i];
  if (c === 76 /* L */ && end - i >= 12 && decoder.decode(buf.subarray(i, i + 12)) === "LAYER_CHANGE") {
    // The first marker: what came before (the purge line of the start G-code) belongs to layer 1,
    // not to a layer of its own.
    if (!marked) {
      carryE = layerE.reduce((a, b) => a + b, carryE);
      for (const list of [layerStart, layerZ, layerLeft, layerE]) list.length = 0;
    }
    marked = true;
    pendingLayer = true;
    return;
  }
  if (c === 90 /* Z */ && buf[i + 1] === 58) {
    const n = number(buf, i + 2, end);
    if (n) pendingZ = n[0];
    return;
  }
  if (c === 84 /* T */ && buf[i + 1] === 89 && end - i > 5 && decoder.decode(buf.subarray(i, i + 5)) === "TYPE:") {
    const name = decoder.decode(buf.subarray(i + 5, end)).trim();
    if (!typeIndex.has(name) && types.length < 255) {
      typeIndex.set(name, types.length);
      types.push(name);
    }
    type = typeIndex.get(name) ?? 0;
    return;
  }
  if (c === 87 /* W */ && end - i > 6 && decoder.decode(buf.subarray(i, i + 6)) === "WIDTH:") {
    const n = number(buf, i + 6, end);
    if (n && n[0] > 0) width = n[0];
    return;
  }
  if (c === 72 /* H */ && end - i > 7 && decoder.decode(buf.subarray(i, i + 7)) === "HEIGHT:") {
    const n = number(buf, i + 7, end);
    if (n && n[0] > 0) height = n[0];
    return;
  }
  // Settings, most at the end of the file: "; layer_height = 0.24", in the head "; max_z_height: 4.52";
  // and who wrote the file: "; generated by Snapmaker Orca 2.3.6 on 2026-09-22 at 15:36:35".
  if (c >= 97 && c <= 122) {
    const text = decoder.decode(buf.subarray(i, end)).trimEnd();
    const m = /^([a-z0-9_][\w [\]().%/-]*?)(?: = |: )(.*)$/.exec(text);
    if (m && m[1].length < 80 && !/^generated by /.test(text)) settings[m[1].trim()] = m[2].slice(0, MAX_SETTING);
    const g = /^generated by (.+?) on (\d{4}-\d\d-\d\d) at ([\d:]+)/.exec(text);
    if (g) [generator, generated] = [g[1], `${g[2]} ${g[3]}`];
  }
}

function extend(nx, ny) {
  if (nx < minX) minX = nx; if (nx > maxX) maxX = nx;
  if (ny < minY) minY = ny; if (ny > maxY) maxY = ny;
}

// One straight move from (x, y, z) to (nx, ny, nz) with de of filament.
function step(nx, ny, nz, de, at) {
  const moved = nx !== x || ny !== y;
  if (de > 0 && moved) {
    // A layer starts with its first extrusion: after ;LAYER_CHANGE, or higher than the last.
    if (marked ? pendingLayer : (!layerZ.length || nz > layerZ[layerZ.length - 1] + 0.01)) {
      newLayer(marked && pendingZ !== null ? pendingZ : nz);
      pendingLayer = false;
    }
    if (seg.n >= seg.cap) room(seg, seg.n + 1);
    const k = seg.n, p = k * 5;
    seg.pos[p] = Math.round(x * UNIT); seg.pos[p + 1] = Math.round(y * UNIT); seg.pos[p + 2] = Math.round(nz * UNIT);
    seg.pos[p + 3] = Math.round(nx * UNIT); seg.pos[p + 4] = Math.round(ny * UNIT);
    seg.wh[k * 2] = Math.min(255, Math.round(width * 100));
    seg.wh[k * 2 + 1] = Math.min(255, Math.round(height * 100));
    seg.tool[k] = t;
    seg.kind[k] = type;
    seg.offset[k] = at;
    seg.line[k] = lineNo;
    seg.speed[k] = Math.min(65535, Math.round(f));
    seg.accel[k] = Math.min(65535, Math.round(acceleration));
    seg.fan[k] = fanSpeed;
    seg.temp[k] = Math.min(65535, Math.round(targets[t]));
    seg.n++;
    layerE[layerE.length - 1] += de;
    extend(x, y);
    extend(nx, ny);
    if (nz > maxZ) maxZ = nz;
  } else if (moved) {
    // A travel, or a wipe that retracts while it moves.
    if (trv.n >= trv.cap) room(trv, trv.n + 1);
    const p = trv.n * 4;
    trv.travel[p] = Math.round(x * UNIT); trv.travel[p + 1] = Math.round(y * UNIT);
    trv.travel[p + 2] = Math.round(nx * UNIT); trv.travel[p + 3] = Math.round(ny * UNIT);
    trv.travelAt[trv.n++] = seg.n;
  }
  if (de < 0 || (de > 0 && !moved)) {
    // A retraction, or the prime after it. A wipe and the rest of its retraction count once.
    const kindOf = de < 0 ? 1 : 2;
    if (!(ret.n && ret.retractKind[ret.n - 1] === kindOf && ret.retractAt[ret.n - 1] === seg.n)) {
      if (ret.n >= ret.cap) room(ret, ret.n + 1);
      ret.retract[ret.n * 2] = Math.round(x * UNIT);
      ret.retract[ret.n * 2 + 1] = Math.round(y * UNIT);
      ret.retractAt[ret.n] = seg.n;
      ret.retractKind[ret.n++] = kindOf;
    }
  }
  x = nx; y = ny; z = nz;
}

// G2 (clockwise) and G3 around the centre at I, J from the start, as Klipper does it
// (klippy/extras/gcode_arcs.py): the end on the start is a full circle; P turns more; Z rises
// along it. In pieces at most ARC_TOLERANCE off the arc, the filament shared by length.
function arc(nx, ny, nz, de, ci, cj, clockwise, turns, at) {
  const cx = x + ci, cy = y + cj, r = Math.hypot(ci, cj);
  if (r < 1e-6) return step(nx, ny, nz, de, at);
  const rx = -ci, ry = -cj, ex = nx - cx, ey = ny - cy;
  let sweep = Math.atan2(rx * ey - ry * ex, rx * ex + ry * ey);
  if (sweep < 0) sweep += 2 * Math.PI;
  if (clockwise) sweep -= 2 * Math.PI;
  if (sweep === 0 && nx === x && ny === y) sweep = 2 * Math.PI;
  if (turns > 1) sweep += (clockwise ? -1 : 1) * 2 * Math.PI * (turns - 1);
  const most = r > ARC_TOLERANCE ? 2 * Math.acos(1 - ARC_TOLERANCE / r) : Math.PI / 2;
  const pieces = Math.min(2000, Math.max(1, Math.ceil(Math.abs(sweep) / most)));
  const a0 = Math.atan2(ry, rx), z0 = z;
  for (let k = 1; k <= pieces; k++) {
    const last = k === pieces, a = a0 + (sweep * k) / pieces;
    step(last ? nx : cx + r * Math.cos(a), last ? ny : cy + r * Math.sin(a), z0 + ((nz - z0) * k) / pieces, de / pieces, at);
  }
}

// G0 to G3: X Y Z E F, for arcs also I J and P.
function move(buf, i, end, at, g) {
  let nx = x, ny = y, nz = z, ne = null, ci = 0, cj = 0, turns = 1;
  while (i < end) {
    if (buf[i] === 59) break;  // ; comment
    const c = buf[i] | 32;     // lower case
    if (c === 120 || c === 121 || c === 122 || c === 101 || c === 102 || c === 105 || c === 106 || c === 112) {
      const n = number(buf, i + 1, end);
      if (n) {
        const v = n[0];
        if (c === 120) nx = absXYZ ? v : x + v;
        else if (c === 121) ny = absXYZ ? v : y + v;
        else if (c === 122) nz = absXYZ ? v : z + v;
        else if (c === 101) ne = v;
        else if (c === 102) f = v;
        else if (c === 105) ci = v;
        else if (c === 106) cj = v;
        else turns = Math.max(1, Math.round(v));
        i = n[1];
        continue;
      }
    }
    i++;
  }
  let de = 0;
  if (ne !== null) {
    de = absE ? ne - e : ne;
    e = absE ? ne : e + ne;
  }
  if (g >= 2) arc(nx, ny, nz, de, ci, cj, g === 2, turns, at);
  else step(nx, ny, nz, de, at);
}

function line(buf, i, end, at) {
  while (i < end && (buf[i] === 32 || buf[i] === 9)) i++;
  if (i >= end) return;
  const c = buf[i];
  if (c === 59) return comment(buf, i + 1, end);
  if (c === 71 || c === 103) {  // G
    const n = number(buf, i + 1, end);
    if (!n) return;
    const g = n[0];
    if (g === 0 || g === 1 || g === 2 || g === 3) return move(buf, n[1], end, at, g);
    if (g === 90) absXYZ = true;
    else if (g === 91) absXYZ = false;
    else if (g === 92) {
      // G92 E0 and the like: sets the position without moving.
      for (let k = n[1]; k < end; k++) {
        const w = buf[k] | 32;
        if (w === 101 || w === 120 || w === 121 || w === 122) {
          const v = number(buf, k + 1, end);
          if (!v) continue;
          if (w === 101) e = v[0]; else if (w === 120) x = v[0]; else if (w === 121) y = v[0]; else z = v[0];
        } else if (buf[k] === 59) break;
      }
    }
    return;
  }
  if (c === 84) {  // T0 … a tool change
    const n = number(buf, i + 1, end);
    if (n && n[0] < 64) t = n[0];
    return;
  }
  if (c === 77) {  // M
    const n = number(buf, i + 1, end);
    if (!n) return;
    const m = n[0], from = n[1];
    if (m === 82) absE = true;
    else if (m === 83) absE = false;
    else if (m === 104 || m === 109) {  // nozzle temperature, of the tool T or the one in use
      const s = param(buf, from, end, 115), tt = param(buf, from, end, 116);
      if (s !== null) targets[tt !== null && tt < 64 ? tt : t] = s;
    } else if (m === 140 || m === 190) {  // bed: the first temperature set
      const s = param(buf, from, end, 115);
      if (s && !bed) bed = s;
    } else if (m === 106 || m === 107) {  // the part fan; P2 and P3 are other fans (OrcaSlicer)
      const p = param(buf, from, end, 112);
      if (!p) fanSpeed = m === 107 ? 0 : Math.max(0, Math.min(255, Math.round(param(buf, from, end, 115) ?? 255)));
    } else if (m === 204) {
      const s = param(buf, from, end, 115) ?? param(buf, from, end, 112);
      if (s !== null) acceleration = s;
    } else if (m === 73) {  // progress by the slicer: R minutes left
      const r = param(buf, from, end, 114);
      if (r !== null) left = r;
    }
    return;
  }
  if (c === 83 && end - i > 18 && decoder.decode(buf.subarray(i, i + 18)) === "SET_VELOCITY_LIMIT") {
    const m = /\bACCEL=([\d.]+)/i.exec(decoder.decode(buf.subarray(i + 18, end)));
    if (m) acceleration = Number(m[1]);
  }
}

// { url }: a file of the printer through OrcaOne; { file }: one from this computer (a File).
self.onmessage = async ({ data }) => {
  try {
    let reader, total;
    if (data.file) {
      reader = data.file.stream().getReader();
      total = data.file.size;
    } else {
      const res = await fetch(data.url);
      if (!res.ok) {
        let code = "unknown";
        try { code = (await res.json()).error || code; } catch { /* not JSON */ }
        self.postMessage({ type: "error", code });
        return;
      }
      total = Number(res.headers.get("Content-Length")) || 0;
      reader = res.body.getReader();
    }
    room(seg, Math.max(65536, Math.ceil(total / 30)));
    let carry = new Uint8Array(0), base = 0, loaded = 0, told = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      loaded += value.length;
      let buf = value;
      if (carry.length) {
        buf = new Uint8Array(carry.length + value.length);
        buf.set(carry);
        buf.set(value, carry.length);
      }
      let from = 0, nl;
      while ((nl = buf.indexOf(10, from)) !== -1) {
        lineNo++;
        line(buf, from, nl, base + from);
        from = nl + 1;
      }
      carry = buf.slice(from);
      base += from;
      if (loaded - told >= PROGRESS_EVERY) {
        told = loaded;
        self.postMessage({ type: "progress", loaded, total, count: seg.n });
      }
    }
    if (carry.length) {
      lineNo++;
      line(carry, 0, carry.length, base);
    }

    const list = (v) => (v ? v.split(";").map((s) => s.trim()) : []);
    const out = {
      type: "done", count: seg.n, travels: trv.n, retracts: ret.n, loaded, lines: lineNo, unit: UNIT, types,
      colours: list(settings.filament_colour || settings.extruder_colour), materials: list(settings.filament_type),
      settings, generator, generated, bed,
      layerStart: Uint32Array.from(layerStart), layerZ: Float32Array.from(layerZ), layerLeft: Float32Array.from(layerLeft),
      layerE: Float32Array.from(layerE),
      bounds: seg.n ? { minX, minY, maxX, maxY, maxZ } : null,
      ...filled(seg), ...filled(trv), ...filled(ret),
    };
    const buffers = Object.values(out).filter((v) => ArrayBuffer.isView(v)).map((v) => v.buffer);
    self.postMessage(out, buffers);
  } catch (err) {
    self.postMessage({ type: "error", code: "network", detail: String(err) });
  }
};
