/**
 * SebasPresent — Canal en tiempo real (WebSocket) · Sesión 50
 *
 * Conecta con el Durable Object "Realm" (server/realm.js):
 *   - Manda TU posición ~8 veces/seg mientras te mueves (cada 3 s si estás
 *     quieto) → los demás te ven moverte al instante.
 *   - Recibe posiciones de los demás y eventos del servidor: golpes PvP,
 *     curas al comer, respawn, cambios de equipo, golpes a NPCs.
 *
 * Mucho más barato que el polling HTTP: los mensajes del cliente cuentan
 * 1/20 de petición y los del servidor no cuentan. Si el WebSocket falla, el
 * juego sigue funcionando con el polling de siempre (heartbeat + snapshot).
 *
 * Debug: window.__rt()
 */

const SEND_MOVING_MS = 125;
const SEND_IDLE_MS = 3000;
const RECONNECT_MIN_MS = 2000;
const RECONNECT_MAX_MS = 30000;

let apiBase = null, getToken = () => null, getPlayer = () => null, isInCombat = () => false;
let ws = null;
let connected = false;
let myId = null;
let started = false;
let retryMs = RECONNECT_MIN_MS;
let retryTimer = null;
let lastSendAt = 0, lastX = null, lastZ = null, lastY = null, lastState = 'idle';
let speedX = null, speedZ = null, speedT = 0, curState = 'idle';
const handlers = new Set();
const stats = { sent: 0, recv: 0, connects: 0 };

export function start(opts) {
  apiBase = opts.apiBase;
  getToken = opts.getToken || (() => null);
  getPlayer = opts.getPlayer || (() => null);
  isInCombat = opts.isInCombat || (() => false);
  started = true;
  connect();
  if (typeof window !== 'undefined') {
    window.__rt = () => ({ connected, myId, ...stats, readyState: ws?.readyState });
    document.addEventListener('visibilitychange', onVisibility);
  }
}

export function stop() {
  started = false;
  clearTimeout(retryTimer);
  try { ws?.close(1000, 'stop'); } catch {}
  ws = null;
  connected = false;
  if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibility);
}

export function isConnected() { return connected; }
export function getMyId() { return myId; }
export function onMessage(fn) { handlers.add(fn); return () => handlers.delete(fn); }

function onVisibility() {
  // Volver a la app en el móvil: si el socket murió, reconectar ya
  if (document.visibilityState === 'visible' && started && (!ws || ws.readyState > 1)) {
    clearTimeout(retryTimer);
    retryMs = RECONNECT_MIN_MS;
    connect();
  }
}

function connect() {
  if (!started) return;
  const token = getToken?.();
  if (!token || !apiBase) { schedule(); return; }
  const url = apiBase.replace(/^http/, 'ws') + '/api/rt?token=' + encodeURIComponent(token);
  let sock;
  try { sock = new WebSocket(url); } catch { schedule(); return; }
  ws = sock;
  sock.onmessage = (ev) => {
    stats.recv++;
    let m;
    try { m = JSON.parse(ev.data); } catch { return; }
    if (m.t === 'hello') {
      myId = m.you;
      connected = true;
      retryMs = RECONNECT_MIN_MS;
      stats.connects++;
      lastSendAt = 0;   // manda posición ya
    }
    for (const h of handlers) { try { h(m, myId); } catch (e) { console.warn('[rt] handler:', e); } }
  };
  sock.onclose = () => {
    if (ws === sock) { ws = null; connected = false; }
    schedule();
  };
  sock.onerror = () => { try { sock.close(); } catch {} };
}

let lastMount = '';

function schedule() {
  if (!started) return;
  clearTimeout(retryTimer);
  retryTimer = setTimeout(connect, retryMs);
  retryMs = Math.min(RECONNECT_MAX_MS, retryMs * 2);
}

/** Llamar cada frame. */
export function update() {
  if (!connected || !ws || ws.readyState !== 1) return;
  const p = getPlayer?.();
  if (!p) return;
  const now = performance.now();

  // Estado (correr / quieto) por velocidad
  if (speedX === null) { speedX = p.position.x; speedZ = p.position.z; speedT = now; }
  if (now - speedT >= 150) {
    const d = Math.hypot(p.position.x - speedX, p.position.z - speedZ);
    curState = d / ((now - speedT) / 1000) > 0.1 ? 'run' : 'idle';
    speedX = p.position.x; speedZ = p.position.z; speedT = now;
  }

  const x = p.position.x, z = p.position.z, y = p.rotation.y;
  let mt = '';   // Sesión 50 — montura (los demás la ven)
  try { mt = window.__mounts?.id?.() || ''; } catch {}
  const moved = lastX === null || Math.abs(x - lastX) > 0.03 || Math.abs(z - lastZ) > 0.03 || Math.abs(y - lastY) > 0.05;
  const since = now - lastSendAt;
  const due = (moved && since >= SEND_MOVING_MS) || since >= SEND_IDLE_MS || curState !== lastState || mt !== lastMount;
  if (!due) return;
  lastSendAt = now; lastX = x; lastZ = z; lastY = y; lastState = curState; lastMount = mt;
  try {
    ws.send(JSON.stringify({
      t: 'p', x: +x.toFixed(2), z: +z.toFixed(2), y: +y.toFixed(3), s: curState,
      c: isInCombat?.() ? 1 : 0, m: mt,
    }));
    stats.sent++;
  } catch {}
}
