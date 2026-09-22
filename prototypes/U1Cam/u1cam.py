#!/usr/bin/env python3
"""
u1cam.py - Kamerabild des Snapmaker U1 (Stock-Firmware) im Browser.

Start:   python u1cam.py 10.30.40.174
         python u1cam.py 10.30.40.174 --host 0.0.0.0     (auch vom Handy/Tablet erreichbar)
Dann:    http://localhost:8000  (öffnet sich automatisch)

Das Skript weckt die Kamera alle paar Sekunden per WebSocket (camera.start_monitor)
und liefert das aktuelle monitor.jpg an den Browser aus. Der Browser braucht dadurch
keinen eigenen Zugriff auf den Drucker. Nur Python-Standardbibliothek, kein pip nötig.
"""
import argparse, base64, json, os, socket, struct, sys, threading, time, webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.request import urlopen

PRINTER_IP = ""      # hier eintragen, dann reicht ein Doppelklick: PRINTER_IP = "10.30.40.174"
WAKE_EVERY = 10      # Sekunden zwischen zwei Wake-Signalen

state = {"printer": "", "wake_ok": False, "wake_msg": "noch kein Wake gesendet", "wake_at": 0.0}


# ---------- minimaler WebSocket-Client (nur Standardbibliothek) ----------
def ws_call(host, port, method, params, timeout=5):
    """Öffnet einen WebSocket zum Drucker, sendet einen JSON-RPC-Aufruf, liefert die Antwort."""
    key = base64.b64encode(os.urandom(16)).decode()
    handshake = (
        f"GET /websocket HTTP/1.1\r\nHost: {host}:{port}\r\n"
        "Upgrade: websocket\r\nConnection: Upgrade\r\n"
        f"Sec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n"
        f"Origin: http://{host}\r\n\r\n"
    )
    req_id = int(time.time() * 1000) % 1_000_000
    params = dict(params, req_id=req_id)
    payload = json.dumps({"jsonrpc": "2.0", "id": req_id, "method": method, "params": params}).encode()

    with socket.create_connection((host, port), timeout=timeout) as s:
        s.sendall(handshake.encode())
        buf = b""
        while b"\r\n\r\n" not in buf:
            chunk = s.recv(4096)
            if not chunk:
                raise ConnectionError("Drucker hat die Verbindung geschlossen")
            buf += chunk
        head, buf = buf.split(b"\r\n\r\n", 1)
        status = head.split(b"\r\n")[0].decode(errors="replace")
        if " 101 " not in status:
            raise ConnectionError(f"WebSocket abgelehnt: {status}")

        # Textframe, maskiert (Pflicht für Clients)
        mask = os.urandom(4)
        n = len(payload)
        if n < 126:
            hdr = bytes([0x81, 0x80 | n])
        elif n < 65536:
            hdr = bytes([0x81, 0x80 | 126]) + struct.pack(">H", n)
        else:
            hdr = bytes([0x81, 0x80 | 127]) + struct.pack(">Q", n)
        s.sendall(hdr + mask + bytes(b ^ mask[i % 4] for i, b in enumerate(payload)))

        def readn(k):
            nonlocal buf
            while len(buf) < k:
                chunk = s.recv(4096)
                if not chunk:
                    raise ConnectionError("Drucker hat die Verbindung geschlossen")
                buf += chunk
            out, buf = buf[:k], buf[k:]
            return out

        # Antwort lesen; Moonraker schickt zwischendurch auch Notifications, die überspringen wir
        deadline = time.time() + timeout
        while time.time() < deadline:
            b1, b2 = readn(2)
            ln = b2 & 0x7F
            if ln == 126:
                ln = struct.unpack(">H", readn(2))[0]
            elif ln == 127:
                ln = struct.unpack(">Q", readn(8))[0]
            if b2 & 0x80:
                readn(4)
            frame = readn(ln)
            op = b1 & 0x0F
            if op == 8:
                raise ConnectionError("Drucker hat den WebSocket geschlossen")
            if op != 1:
                continue
            try:
                msg = json.loads(frame)
            except ValueError:
                continue
            if msg.get("id") == req_id:
                s.sendall(bytes([0x88, 0x80]) + os.urandom(4))   # Close-Frame
                return msg
        raise TimeoutError("keine Antwort vom Drucker")


def wake_loop(host, port, every):
    while True:
        try:
            resp = ws_call(host, port, "camera.start_monitor", {"domain": "lan", "interval": 0})
            if "error" in resp:
                err = resp["error"]
                state.update(wake_ok=False, wake_msg=f"Drucker meldet: {err.get('message', err)}")
            else:
                state.update(wake_ok=True, wake_msg=f"OK {json.dumps(resp.get('result', {}), ensure_ascii=False)[:80]}")
        except Exception as e:
            state.update(wake_ok=False, wake_msg=f"{type(e).__name__}: {e}")
        state["wake_at"] = time.time()
        print(time.strftime("%H:%M:%S"), "Wake:", state["wake_msg"], flush=True)
        time.sleep(every)


# ---------- Webseite ----------
PAGE = """<!doctype html>
<html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>U1 Kamera</title>
<style>
  :root{--bg:#1c1f24;--panel:#262a31;--line:#3a3f48;--text:#e6e3dc;--muted:#9a9890;--ok:#7fb37a;--warn:#d9a441;--err:#d4655a}
  *{box-sizing:border-box}html,body{margin:0;height:100%;background:var(--bg);color:var(--text);font:15px/1.45 "Segoe UI",system-ui,sans-serif}
  body{display:flex;flex-direction:column;min-height:100vh}
  header{display:flex;flex-wrap:wrap;gap:10px 16px;align-items:end;padding:12px 16px;background:var(--panel);border-bottom:1px solid var(--line)}
  h1{font-size:17px;font-weight:600;margin:0 8px 6px 0}
  label{display:flex;flex-direction:column;gap:3px;font-size:12px;color:var(--muted)}
  input{background:var(--bg);color:var(--text);border:1px solid var(--line);border-radius:4px;padding:6px 8px;font:inherit;width:72px}
  input:focus{outline:2px solid var(--warn);outline-offset:1px}
  #state{display:flex;align-items:center;gap:8px;margin-left:auto;font-size:13px;color:var(--muted)}
  #dot{width:10px;height:10px;border-radius:50%;background:var(--line)}#dot.ok{background:var(--ok)}#dot.warn{background:var(--warn)}#dot.err{background:var(--err)}
  main{flex:1;display:flex;align-items:center;justify-content:center;padding:16px}
  #img{max-width:100%;max-height:calc(100vh - 150px);border-radius:6px;cursor:zoom-in;background:var(--panel);min-width:320px;min-height:180px;object-fit:contain}
  #img:fullscreen{cursor:default;border-radius:0;max-height:none}
  footer{padding:8px 16px 12px;border-top:1px solid var(--line);font-size:12px;color:var(--muted);font-family:ui-monospace,Consolas,monospace;white-space:pre-wrap}
</style></head><body>
<header>
  <h1>U1 Kamera</h1><span style="color:var(--muted);font-size:13px;margin-bottom:8px">__PRINTER__</span>
  <label>Bild alle (s) <input id="poll" type="number" min="1" max="60" value="3"></label>
  <div id="state"><span id="dot"></span><span id="txt">Warte auf erstes Bild …</span></div>
</header>
<main><img id="img" alt="Kamerabild Snapmaker U1"></main>
<footer id="log">Wake: noch keine Info</footer>
<script>
(()=>{
  const img=document.getElementById('img'),dot=document.getElementById('dot'),txt=document.getElementById('txt'),
        logEl=document.getElementById('log'),pollEl=document.getElementById('poll');
  let last=0,timer=null;
  function fetchImage(){
    const url='/cam.jpg?t='+Date.now(),pre=new Image();
    pre.onload=()=>{img.src=url;last=Date.now()};
    pre.onerror=()=>{dot.className='err';txt.textContent='Bild nicht ladbar, siehe Konsole des Skripts'};
    pre.src=url;
  }
  function schedule(){clearInterval(timer);fetchImage();timer=setInterval(fetchImage,Math.max(1,Number(pollEl.value))*1000)}
  pollEl.addEventListener('change',schedule);
  setInterval(()=>{
    if(last){const age=Math.round((Date.now()-last)/1000);dot.className=age>Number(pollEl.value)*3?'warn':'ok';txt.textContent='Letztes Bild vor '+age+' s'}
    fetch('/status').then(r=>r.json()).then(s=>{
      const t=s.wake_at?new Date(s.wake_at*1000).toLocaleTimeString('de-DE'):'–';
      logEl.textContent=(s.wake_ok?'Wake OK':'Wake FEHLER')+' ('+t+'): '+s.wake_msg;
    }).catch(()=>{});
  },1000);
  img.addEventListener('click',()=>document.fullscreenElement?document.exitFullscreen():img.requestFullscreen?.());
  schedule();
})();
</script></body></html>
"""


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a):   # kein Request-Spam in der Konsole
        pass

    def _send(self, code, ctype, body):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        path = self.path.split("?", 1)[0]
        if path == "/":
            self._send(200, "text/html; charset=utf-8", PAGE.replace("__PRINTER__", state["printer"]).encode())
        elif path == "/cam.jpg":
            try:
                with urlopen(f"http://{state['printer']}/server/files/camera/monitor.jpg?t={time.time()}", timeout=5) as r:
                    self._send(200, "image/jpeg", r.read())
            except Exception as e:
                print(time.strftime("%H:%M:%S"), "Bild:", e, flush=True)
                self._send(502, "text/plain; charset=utf-8", str(e).encode())
        elif path == "/status":
            self._send(200, "application/json", json.dumps(state).encode())
        else:
            self._send(404, "text/plain", b"not found")


def main():
    ap = argparse.ArgumentParser(description="Snapmaker U1 Kamerabild im Browser (Stock-Firmware)")
    ap.add_argument("printer", nargs="?", default=PRINTER_IP, help="IP des Druckers, z. B. 10.30.40.174")
    ap.add_argument("--port", type=int, default=8000, help="Port der lokalen Webseite (Standard 8000)")
    ap.add_argument("--host", default="127.0.0.1", help="0.0.0.0 = auch von anderen Geräten im LAN erreichbar")
    ap.add_argument("--wake", type=int, default=WAKE_EVERY, help="Sekunden zwischen Wake-Signalen")
    ap.add_argument("--no-browser", action="store_true")
    args = ap.parse_args()

    printer = args.printer.strip() or input("IP des Druckers: ").strip()
    printer = printer.replace("http://", "").strip("/")
    host, _, port = printer.partition(":")
    state["printer"] = printer

    threading.Thread(target=wake_loop, args=(host, int(port or 80), args.wake), daemon=True).start()
    srv = ThreadingHTTPServer((args.host, args.port), Handler)
    url = f"http://{'localhost' if args.host == '127.0.0.1' else args.host}:{args.port}/"
    print(f"Drucker: {printer}   Seite: {url}   (Beenden mit Strg+C)", flush=True)
    if not args.no_browser:
        webbrowser.open(url)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(f"Fehler: {e}")
        input("Enter zum Beenden …")
