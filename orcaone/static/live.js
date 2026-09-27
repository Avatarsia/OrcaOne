// Live values of the printers the pages watch (orcaone/live.py, the user's wish of 25.09.2026: asking
// every few seconds was slow, above all for "3D Ansicht" and "2D Ansicht"). One WebSocket to OrcaOne
// per tab, open while the tab shows; OrcaOne holds Moonraker's and pushes what Klipper reports, at most
// four times a second, shaped as the REST answers: data.monitor as monitor.read, data.control as
// control.state. The browser never talks to a printer itself.
const { reactive, computed, watch, onUnmounted } = Vue;

// Printer name: { data: { monitor, control } or null before the first values, error: code or "",
// gcode: counts Klipper's answers to G-code, for "Konsole"; sample: the newest row of the recording
// (orcaone/history.py), for "Diagramme"; glance: only the state, for the printer tabs, { state, klipper,
// percent } or { error } }.
export const live = reactive({});
const watched = new Map();   // printer name: how many pages watch it
const glanced = new Map();   // printer name: how many want only its glance
let socket = null, failures = 0, retry = 0;

const entry = (name) => live[name] || (live[name] = { data: null, error: "", gcode: 0, sample: null, glance: null });
function send() {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ watch: [...watched.keys()], glance: [...glanced.keys()] }));
}
function connect() {
  clearTimeout(retry);
  if (socket || document.hidden || !(watched.size || glanced.size)) return;
  socket = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/live`);
  socket.onopen = () => {
    failures = 0;
    send();
  };
  socket.onmessage = (ev) => {
    let m;
    try {
      m = JSON.parse(ev.data);
    } catch {
      return;
    }
    const e = entry(m.printer);
    if (m.gcode) e.gcode++;
    else if (m.sample) e.sample = m.sample;
    else if (m.glance) e.glance = m.glance;
    else if (m.error) e.error = m.error;
    else {
      e.data = m.data;
      e.error = "";
    }
  };
  // OrcaOne gone (restarted) or the tab hidden: again later, a little later after every failure.
  socket.onclose = () => {
    socket = null;
    if (!document.hidden && (watched.size || glanced.size)) retry = setTimeout(connect, Math.min(10000, 500 * 2 ** failures++));
  };
}
// A hidden tab needs no values: closed, and opened again when it shows.
document.addEventListener("visibilitychange", () => {
  if (document.hidden) socket?.close();
  else connect();
});
function add(name, map = watched) {
  map.set(name, (map.get(name) || 0) + 1);
  entry(name);
  if (socket) send();
  else connect();
}
function remove(name, map = watched) {
  const n = (map.get(name) || 0) - 1;
  if (n > 0) map.set(name, n);
  else map.delete(name);
  send();
}

// The printers names() gives, watched while the page is mounted; the values in live[name].
export function watchPrinters(names) {
  let now = [];
  const stop = watch(names, (list) => {
    const next = [...new Set((list || []).filter(Boolean))];
    for (const n of now) if (!next.includes(n)) remove(n);
    for (const n of next) if (!now.includes(n)) add(n);
    now = next;
  }, { immediate: true });
  onUnmounted(() => {
    stop();
    now.forEach((n) => remove(n));   // not remove itself: forEach would pass the index as its map
    now = [];
  });
}
// Only the glance of the printers names() gives (the printer tabs): their state, not all their values.
export function glancePrinters(names) {
  let now = [];
  const stop = watch(names, (list) => {
    const next = [...new Set((list || []).filter(Boolean))];
    for (const n of now) if (!next.includes(n)) remove(n, glanced);
    for (const n of next) if (!now.includes(n)) add(n, glanced);
    now = next;
  }, { immediate: true });
  onUnmounted(() => {
    stop();
    now.forEach((n) => remove(n, glanced));
    now = [];
  });
}
// One printer, usually the one of the top bar: its entry in live, following name() when it changes.
export function useLive(name) {
  watchPrinters(() => [name()]);
  return computed(() => live[name()] || null);
}
