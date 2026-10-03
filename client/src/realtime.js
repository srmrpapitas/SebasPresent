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

// Sesión 51 — pausa por inactividad (core/afk.js): cerrar el socket y no
// reconectar hasta reanudar. Así el Realm no guarda posiciones de nadie dormido.
let suspended = false;
export function suspend() {
  suspended = true;
  clearTimeout(retryTimer);
  try { ws?.close(1000, 'afk'); } catch {}
  ws = null;
  connected = false;
}
export function resume() {
  if (!suspended) return;
  suspended = false;
  retryMs = RECONNECT_MIN_MS;
  if (started && (!ws || ws.readyState > 1)) connect();
}

// Sesión 51 — efecto de ataque especial (lo ven los demás). Cosmético.
let lastFxAt = 0;
export function sendFx(fx) {
  if (!connected || !ws || ws.readyState !== 1 || !fx) return;
  const now = performance.now();
  if (now - lastFxAt < 700) return;
  lastFxAt = now;
  const num = (v) => (Number.isFinite(v) ? +(+v).toFixed(2) : null);
  try { ws.send(JSON.stringify({ t: 'fx', k: String(fx.k || '').slice(0, 12), c: String(fx.c || '').slice(0, 32), tx: num(fx.tx), tz: num(fx.tz) })); stats.sent++; } catch {}
}
export function getMyId() { return myId; }
export function onMessage(fn) { handlers.add(fn); return () => handlers.delete(fn); }

function onVisibility() {
  // Volver a la app en el móvil: si el socket murió, reconectar ya
  if (document.visibilityState === 'visible' && started && !suspended && (!ws || ws.readyState > 1)) {
    clearTimeout(retryTimer);
    retryMs = RECONNECT_MIN_MS;
    connect();
  }
}

function connect() {
  if (!started || suspended) return;
  const token = getToken?.();
  if (!token || !apiBase) { schedule(); return; }
  const url = apiBase.replace(/^http/, 'ws') + '/api/rt?token=' + encodeURIComponent(token);
  // Sesión 51 — cerrar el socket anterior SIN que su cierre programe otra
  // reconexión (antes, volver a la app con el viejo aún cerrándose dejaba dos
  // sockets y cada golpe/efecto se procesaba dos veces).
  if (ws) {
    const old = ws;
    old.onclose = old.onmessage = old.onerror = null;
    try { old.close(1000, 'replaced'); } catch {}
    ws = null;
  }
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
  sock.onclose = (e) => {
    if (ws !== sock) return;   // un socket viejo: no tocar nada
    ws = null; connected = false;
    // Sesión 51 — 4000 = el servidor lo cerró porque abriste el juego en otro
    // sitio (otra pestaña/móvil). No reconectar: si no, las dos pestañas se
    // echaban la una a la otra cada 2 s para siempre.
    if (e && e.code === 4000) {
      stats.kicked = (stats.kicked || 0) + 1;
      try { window.dispatchEvent(new CustomEvent('sebas-rt-kicked')); } catch {}
      return;
    }
    schedule();
  };
  sock.onerror = () => { try { sock.close(); } catch {} };
}

let lastMount = '';

function schedule() {
  if (!started || suspended) return;
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
