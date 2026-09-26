// Live values of the printers the pages watch (orcaone/live.py, the user's wish of 25.09.2026: asking
// every few seconds was slow, above all for "3D Ansicht" and "2D Ansicht"). One WebSocket to OrcaOne
// per tab, open while the tab shows; OrcaOne holds Moonraker's and pushes what Klipper reports, at most
// four times a second, shaped as the REST answers: data.monitor as monitor.read, data.control as
// control.state. The browser never talks to a printer itself.
const { reactive, computed, watch, onUnmounted } = Vue;

// Printer name: { data: { monitor, control } or null before the first values, error: code or "",
// gcode: counts Klipper's answers to G-code, for "Konsole" }.
export const live = reactive({});
const watched = new Map();   // printer name: how many pages watch it
let socket = null, failures = 0, retry = 0;

const entry = (name) => live[name] || (live[name] = { data: null, error: "", gcode: 0 });
function send() {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ watch: [...watched.keys()] }));
}
function connect() {
  clearTimeout(retry);
  if (socket || document.hidden || !watched.size) return;
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
    else if (m.error) e.error = m.error;
    else {
      e.data = m.data;
      e.error = "";
    }
  };
  // OrcaOne gone (restarted) or the tab hidden: again later, a little later after every failure.
  socket.onclose = () => {
    socket = null;
    if (!document.hidden && watched.size) retry = setTimeout(connect, Math.min(10000, 500 * 2 ** failures++));
  };
}
// A hidden tab needs no values: closed, and opened again when it shows.
document.addEventListener("visibilitychange", () => {
  if (document.hidden) socket?.close();
  else connect();
});
function add(name) {
  watched.set(name, (watched.get(name) || 0) + 1);
  entry(name);
  if (socket) send();
  else connect();
}
function remove(name) {
  const n = (watched.get(name) || 0) - 1;
  if (n > 0) watched.set(name, n);
  else watched.delete(name);
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
    now.forEach(remove);
    now = [];
  });
}
// One printer, usually the one of the top bar: its entry in live, following name() when it changes.
export function useLive(name) {
  watchPrinters(() => [name()]);
  return computed(() => live[name()] || null);
}
