/**
 * SebasPresent — Chat module (cliente)
 *
 * Sesión 29 — Chat global estilo OSRS:
 *   - Chatbox arriba-izquierda, minimizable. Estilo similar al combat-feed
 *     (fondo translúcido, fuente IM Fell English, borde dorado).
 *   - Overhead text 7s sobre la cabeza del jugador (mismo patrón visual que
 *     OSRS clásico: amarillo, sombra negra, fade-out en últimos 600ms).
 *     El más reciente reemplaza al anterior del mismo user.
 *
 * Diseño:
 *   - Polling cada 2.5s a /api/chat/recent. Usa `since` (server_now devuelto)
 *     para traer solo mensajes nuevos en cada poll.
 *   - Al enviar, hacemos POST y pintamos local INMEDIATAMENTE (UX) sin esperar
 *     al siguiente poll. Si el poll devuelve el mismo id, seenIds evita
 *     duplicado.
 *   - Overhead text: cada mensaje nuevo crea/reemplaza un DOM "chat-bubble"
 *     anclado al user. updateBubblePositions() corre desde animate() (60fps)
 *     para que la posición siga al peer mientras se mueve.
 *   - Antiacopling: usa multiplayer.getPeerById(userId) para obtener el grupo
 *     THREE del peer, y getPlayer / getCamera / getCanvas (pasados en start)
 *     para proyectar pos 3D → 2D screen.
 *
 * Sanitización: textContent en overhead (anti-XSS); escapeHtml en chatbox.
 *
 * Si server devuelve chat_disabled (tabla no existe), esconde la UI
 * silenciosamente. Mismo patrón que duel_disabled / party_disabled.
 *
 * Hooks debug (Eruda):
 *   window.__chatDebug()           → estado completo
 *   window.__chatDebug.send(msg)   → envía directo
 *   window.__chatDebug.bubble(uid, 'hola') → overhead manual
 */

import * as THREE from 'three';
import * as api from './api.js';
import * as multiplayer from './multiplayer.js';

// ============================================================
// Constantes
// ============================================================
const POLL_INTERVAL_MS         = 2_500;
const OVERHEAD_DURATION_MS     = 7_000;     // OSRS-like
const OVERHEAD_FADE_MS         = 600;       // últimos N ms de fade-out
const MAX_MESSAGES_IN_VIEW     = 30;
const MAX_MESSAGE_LENGTH       = 200;
// Altura del overhead sobre la base del personaje (metros).
// El nameplate del peer está a 2.0m + barra HP. El overhead va por encima
// del conjunto entero para no tapar la HP bar.
const OVERHEAD_HEIGHT_PEER     = 3.5;
const OVERHEAD_HEIGHT_LOCAL    = 3.3;

// ============================================================
// Estado del módulo
// ============================================================
let started        = false;
let myUserId       = null;
let myUsername     = null;
let _feedLogFn     = null;
let _getPlayer     = null;
let _getCamera     = null;
let _getCanvas     = null;
let pollTimer      = null;
let sendInFlight   = false;
let lastServerNow  = 0;
let cssInjected    = false;
let chatDisabled   = false;

// UI elements (creados en renderRoot)
let rootEl         = null;
let panelEl        = null;
let toggleEl       = null;
let messagesEl     = null;
let inputEl        = null;
let unreadEl       = null;
let minimized      = true;
let unreadCount    = 0;

// Mensajes ya recibidos (evita duplicados al pintar local + poll después)
const seenIds      = new Set();
let messages       = [];   // [{id, user_id, username, message, sent_at}]

// Overhead bubbles activos: userId → { div, expiresAt, message }
const bubbles      = new Map();

// Reutilizable para evitar GC
const _tmpV        = new THREE.Vector3();

// ============================================================
// API pública
// ============================================================

/**
 * Arranca el módulo. No bloqueante (api.me() en background si no se pasa userId).
 * Si la tabla server no existe, el primer poll detecta chat_disabled y
 * la UI se esconde.
 */
export async function start({
  userId, username, feedLog, getPlayer, getCamera, getCanvas,
} = {}) {
  if (started) return;
  ensureCss();
  _feedLogFn = typeof feedLog === 'function' ? feedLog : (() => {});
  _getPlayer = typeof getPlayer === 'function' ? getPlayer : (() => null);
  _getCamera = typeof getCamera === 'function' ? getCamera : (() => null);
  _getCanvas = typeof getCanvas === 'function' ? getCanvas : (() => null);

  if (userId != null) {
    myUserId   = userId;
    myUsername = username || null;
  } else {
    try {
      const m = await api.me();
      myUserId   = m?.user?.id || null;
      myUsername = m?.user?.username || null;
    } catch {
      myUserId = null;
    }
  }

  renderRoot();
  exposeDebug();

  // Fetch inicial (sin since → últimos 30, sin overhead).
  fetchInitial();

  // Polling cada 2.5s.
  pollTimer = setInterval(() => { poll(); }, POLL_INTERVAL_MS);

  started = true;
}

export function stop() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  if (rootEl)    { rootEl.remove(); rootEl = null; }
  for (const [, b] of bubbles) {
    try { b.div?.remove(); } catch {}
  }
  bubbles.clear();
  panelEl = messagesEl = inputEl = toggleEl = unreadEl = null;
  seenIds.clear();
  messages = [];
  unreadCount = 0;
  minimized = true;
  lastServerNow = 0;
  myUserId = null;
  myUsername = null;
  chatDisabled = false;
  sendInFlight = false;
  if (typeof window !== 'undefined' && window.__chatDebug) {
    delete window.__chatDebug;
  }
  started = false;
}

/**
 * Llamado desde animate() de world.js (cada frame). Refresca la posición
 * de los overhead bubbles para que sigan al peer en pantalla.
 */
export function update(dt) {
  if (!started) return;
  if (bubbles.size === 0) return;
  updateBubblePositions();
  expireOldBubbles();
}

// ============================================================
// Polling
// ============================================================
async function fetchInitial() {
  try {
    const r = await api.chatRecent();
    if (r?.chat_disabled) {
      hideUiDisabled();
      return;
    }
    lastServerNow = r?.server_now || Date.now();
    const list = Array.isArray(r?.messages) ? r.messages : [];
    for (const msg of list) {
      seenIds.add(msg.id);
      messages.push(msg);
    }
    trimMessages();
    renderMessages();
    // NO overhead para mensajes históricos. NO incrementamos unread.
  } catch (err) {
    console.warn('[chat] fetchInitial error:', err?.message);
  }
}

async function poll() {
  if (!started || chatDisabled) return;
  try {
    const r = await api.chatRecent(lastServerNow);
    if (r?.chat_disabled) {
      hideUiDisabled();
      return;
    }
    lastServerNow = r?.server_now || lastServerNow || Date.now();
    const list = Array.isArray(r?.messages) ? r.messages : [];
    let newAny = false;
    for (const msg of list) {
      if (seenIds.has(msg.id)) continue;
      seenIds.add(msg.id);
      messages.push(msg);
      newAny = true;
      // Overhead para todos los mensajes nuevos del poll.
      // Si es mío, normalmente ya lo pinté al hacer POST (showOverhead idempotente
      // por reemplazo, así que igualmente está bien si llega también via poll).
      showOverhead(msg.user_id, msg.message);
      // Unread badge: solo si está minimizado y el mensaje no es mío.
      if (minimized && msg.user_id !== myUserId) {
        unreadCount++;
      }
    }
    if (newAny) {
      trimMessages();
      renderMessages();
      renderUnreadBadge();
    }
  } catch (err) {
    console.warn('[chat] poll error:', err?.message);
  }
}

function trimMessages() {
  if (messages.length > MAX_MESSAGES_IN_VIEW) {
    messages = messages.slice(-MAX_MESSAGES_IN_VIEW);
  }
  // seenIds NO se purga aquí: si lo hiciera, un mensaje ya scrolled-out
  // podría volver a aparecer si lo trae un poll posterior. Tamaño máximo
  // del set sigue al cap del server: ~30 últimos + 50 por poll = del orden
  // de cientos por hora, despreciable en memoria.
}

// ============================================================
// Send
// ============================================================
async function trySend() {
  if (sendInFlight) return;
  if (!inputEl) return;
  const raw = inputEl.value || '';
  const text = raw.trim();
  if (text.length === 0) return;
  if (text.length > MAX_MESSAGE_LENGTH) {
    _feedLogFn('warning', `Mensaje demasiado largo (máx ${MAX_MESSAGE_LENGTH}).`);
    return;
  }
  sendInFlight = true;
  if (inputEl) inputEl.disabled = true;
  try {
    const r = await api.chatSend(text);
    if (r?.ok) {
      if (inputEl) inputEl.value = '';
      // Pintar local inmediato (UX). Si el poll lo trae luego, seenIds evita dup.
      const localMsg = {
        id:       r.id,
        user_id:  myUserId,
        username: r.username || myUsername || 'tú',
        message:  r.message  || text,
        sent_at:  r.sent_at  || Date.now(),
      };
      if (localMsg.id != null && !seenIds.has(localMsg.id)) {
        seenIds.add(localMsg.id);
        messages.push(localMsg);
        trimMessages();
        renderMessages();
      }
      // Overhead sobre mi cabeza.
      showOverhead(myUserId, localMsg.message);
      // Avanzar cursor para que el siguiente poll no me devuelva mi propio msg.
      if (localMsg.sent_at > lastServerNow) lastServerNow = localMsg.sent_at;
    } else {
      _feedLogFn('warning', mapSendError(r?.error));
    }
  } catch (err) {
    _feedLogFn('warning', mapSendError(err?.code));
  } finally {
    sendInFlight = false;
    if (inputEl) {
      inputEl.disabled = false;
      // No re-foco automático para no abrir teclado virtual en iOS si el
      // usuario quiere volver a jugar tras un mensaje.
    }
  }
}

function mapSendError(code) {
  switch (code) {
    case 'rate_limited':       return 'Vas muy rápido (máx 5 mensajes en 10s).';
    case 'message_too_long':   return `Mensaje demasiado largo (máx ${MAX_MESSAGE_LENGTH}).`;
    case 'empty_message':      return 'Mensaje vacío.';
    case 'invalid_message':    return 'Mensaje inválido.';
    case 'invalid_channel':    return 'Canal inválido.';
    case 'chat_disabled':      return 'Chat no disponible.';
    case 'unauthorized':       return 'Sesión expirada. Vuelve a entrar.';
    case 'network_error':      return 'Sin conexión con el servidor.';
    default:                   return 'No se pudo enviar el mensaje.';
  }
}

// ============================================================
// UI principal — chatbox arriba-izquierda
// ============================================================
function renderRoot() {
  if (rootEl) rootEl.remove();
  rootEl = document.createElement('div');
  rootEl.id = 'chatRoot';
  rootEl.className = 'chat-root chat-min';
  rootEl.innerHTML = `
    <button class="chat-tab-toggle" type="button" aria-label="Abrir chat">
      <span class="chat-tab-icon">💬</span>
      <span class="chat-tab-label">Chat</span>
      <span class="chat-unread" aria-hidden="true" style="display:none;">0</span>
    </button>
    <div class="chat-panel">
      <div class="chat-header">
        <span class="chat-title">Chat global</span>
        <button class="chat-close" type="button" aria-label="Minimizar">−</button>
      </div>
      <div class="chat-messages" id="chatMessages"></div>
      <div class="chat-input-row">
        <input type="text" class="chat-input"
               maxlength="${MAX_MESSAGE_LENGTH}"
               placeholder="Escribe…"
               autocomplete="off" autocapitalize="off"
               autocorrect="off" spellcheck="false" />
        <button class="chat-send" type="button" aria-label="Enviar">✓</button>
      </div>
    </div>
  `;
  document.body.appendChild(rootEl);

  panelEl    = rootEl.querySelector('.chat-panel');
  toggleEl   = rootEl.querySelector('.chat-tab-toggle');
  messagesEl = rootEl.querySelector('.chat-messages');
  inputEl    = rootEl.querySelector('.chat-input');
  unreadEl   = rootEl.querySelector('.chat-unread');
  const closeBtn = rootEl.querySelector('.chat-close');
  const sendBtn  = rootEl.querySelector('.chat-send');

  toggleEl.addEventListener('pointerup', (ev) => {
    if (ev.button !== undefined && ev.button !== 0) return;
    ev.preventDefault();
    ev.stopPropagation();
    expand();
  });
  closeBtn.addEventListener('pointerup', (ev) => {
    if (ev.button !== undefined && ev.button !== 0) return;
    ev.preventDefault();
    ev.stopPropagation();
    minimize();
  });
  sendBtn.addEventListener('pointerup', (ev) => {
    if (ev.button !== undefined && ev.button !== 0) return;
    ev.preventDefault();
    ev.stopPropagation();
    trySend();
  });
  inputEl.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') {
      ev.preventDefault();
      trySend();
    }
  });

  // El input necesita aceptar touch (la regla global del juego es
  // touch-action: none / user-select: none). Aquí re-permitimos lo
  // necesario para que el teclado virtual se abra y el usuario pueda
  // pegar texto en iOS.
  inputEl.addEventListener('pointerdown', (ev) => ev.stopPropagation());
  inputEl.addEventListener('touchstart',  (ev) => ev.stopPropagation(), { passive: true });
  inputEl.addEventListener('touchmove',   (ev) => ev.stopPropagation(), { passive: true });

  // El panel entero no debe propagar pointer al world (para que tap dentro
  // del panel no haga walk-to en el suelo del mundo).
  panelEl.addEventListener('pointerdown', (ev) => ev.stopPropagation());
}

function expand() {
  if (!rootEl) return;
  rootEl.classList.remove('chat-min');
  rootEl.classList.add('chat-expanded');
  minimized = false;
  unreadCount = 0;
  renderUnreadBadge();
  if (messagesEl) messagesEl.scrollTop = messagesEl.scrollHeight;
}

function minimize() {
  if (!rootEl) return;
  rootEl.classList.remove('chat-expanded');
  rootEl.classList.add('chat-min');
  minimized = true;
  if (inputEl) inputEl.blur();   // cierra teclado virtual iOS
}

function renderMessages() {
  if (!messagesEl) return;
  const html = messages.map(m => {
    const ts     = formatTs(m.sent_at);
    const isSelf = m.user_id === myUserId;
    return `<div class="chat-line">` +
             `<span class="chat-ts">[${escapeHtml(ts)}]</span> ` +
             `<span class="chat-user ${isSelf ? 'self' : 'other'}">${escapeHtml(m.username)}:</span> ` +
             `<span class="chat-msg">${escapeHtml(m.message)}</span>` +
           `</div>`;
  }).join('');
  messagesEl.innerHTML = html;
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function renderUnreadBadge() {
  if (!unreadEl) return;
  if (unreadCount > 0 && minimized) {
    unreadEl.textContent = unreadCount > 99 ? '99+' : String(unreadCount);
    unreadEl.style.display = '';
  } else {
    unreadEl.style.display = 'none';
  }
}

function hideUiDisabled() {
  chatDisabled = true;
  if (rootEl) rootEl.style.display = 'none';
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
}

function formatTs(ms) {
  const d = new Date(ms);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

// ============================================================
// Overhead bubble (texto flotante OSRS-style)
// ============================================================
function showOverhead(userId, message) {
  if (userId == null || !message) return;
  // Reemplazo: si ya hay bubble de este user, eliminarla.
  const prev = bubbles.get(userId);
  if (prev) {
    try { prev.div?.remove(); } catch {}
    bubbles.delete(userId);
  }
  const div = document.createElement('div');
  div.className = 'chat-bubble';
  div.textContent = message;          // textContent → anti-XSS
  div.style.display = 'none';         // se posiciona en updateBubblePositions
  div.style.opacity = '1';
  document.body.appendChild(div);
  bubbles.set(userId, {
    div,
    message,
    expiresAt: Date.now() + OVERHEAD_DURATION_MS,
  });
}

function updateBubblePositions() {
  const camera = _getCamera();
  const canvas = _getCanvas();
  if (!camera || !canvas) return;
  const rect = canvas.getBoundingClientRect();
  const now = Date.now();

  for (const [userId, b] of bubbles) {
    let worldPos = null;
    let isLocal = false;
    if (userId === myUserId) {
      const p = _getPlayer();
      if (p?.position) {
        worldPos = { x: p.position.x, y: p.position.y, z: p.position.z };
        isLocal = true;
      }
    } else {
      const peer = multiplayer.getPeerById?.(userId);
      if (peer?.group) {
        worldPos = {
          x: peer.group.position.x,
          y: peer.group.position.y,
          z: peer.group.position.z,
        };
      }
    }
    if (!worldPos) {
      // Player / peer no encontrado (fuera de escena, no cargado).
      // No mostramos overhead pero seguimos contando el TTL.
      b.div.style.display = 'none';
      continue;
    }

    const heightOffset = isLocal ? OVERHEAD_HEIGHT_LOCAL : OVERHEAD_HEIGHT_PEER;
    _tmpV.set(worldPos.x, worldPos.y + heightOffset, worldPos.z);
    _tmpV.project(camera);

    // Detrás de la cámara → ocultar.
    if (_tmpV.z > 1 || _tmpV.z < -1) {
      b.div.style.display = 'none';
      continue;
    }
    const sx = (_tmpV.x * 0.5 + 0.5) * rect.width  + rect.left;
    const sy = (-_tmpV.y * 0.5 + 0.5) * rect.height + rect.top;

    b.div.style.left = sx + 'px';
    b.div.style.top  = sy + 'px';
    b.div.style.display = 'block';

    // Fade out últimos OVERHEAD_FADE_MS.
    const msLeft = b.expiresAt - now;
    if (msLeft < OVERHEAD_FADE_MS) {
      b.div.style.opacity = String(Math.max(0, msLeft / OVERHEAD_FADE_MS));
    } else {
      b.div.style.opacity = '1';
    }
  }
}

function expireOldBubbles() {
  const now = Date.now();
  for (const [userId, b] of bubbles) {
    if (b.expiresAt <= now) {
      try { b.div?.remove(); } catch {}
      bubbles.delete(userId);
    }
  }
}

// ============================================================
// Debug en window (Eruda)
// ============================================================
function exposeDebug() {
  if (typeof window === 'undefined') return;
  const dbg = () => ({
    started, minimized, unreadCount, chatDisabled,
    lastServerNow,
    seenIdsSize: seenIds.size,
    messagesCount: messages.length,
    bubblesCount: bubbles.size,
    myUserId, myUsername,
  });
  dbg.messages = () => messages.slice();
  dbg.bubbles  = () => Array.from(bubbles.entries()).map(([uid, b]) => ({
    user_id: uid, message: b.message,
    expires_in_ms: b.expiresAt - Date.now(),
  }));
  dbg.send = (txt) => {
    if (inputEl) inputEl.value = txt;
    return trySend();
  };
  dbg.bubble = (uid, txt) => showOverhead(uid, txt);
  dbg.expand   = () => expand();
  dbg.minimize = () => minimize();
  window.__chatDebug = dbg;
}

// ============================================================
// CSS
// ============================================================
function ensureCss() {
  if (cssInjected) return;
  cssInjected = true;
  const style = document.createElement('style');
  style.textContent = `
    /* === Chat global (Sesión 29) — estilo OSRS chatbox === */

    .chat-root {
      position: fixed;
      top: calc(env(safe-area-inset-top, 0px) + 56px);
      left: 8px;
      z-index: 19;
      font-family: 'IM Fell English', serif;
      color: #f0e0b0;
      pointer-events: auto;
    }
    .chat-root.chat-min .chat-panel { display: none; }
    .chat-root.chat-min .chat-tab-toggle { display: inline-flex; }
    .chat-root.chat-expanded .chat-tab-toggle { display: none; }
    .chat-root.chat-expanded .chat-panel { display: flex; }

    /* Botón minimizado */
    .chat-tab-toggle {
      align-items: center;
      gap: 3px;
      background: rgba(20, 14, 8, 0.85);
      border: 1.5px solid rgba(200, 160, 67, 0.5);
      border-radius: 4px;
      color: #f0e0b0;
      font-family: 'Cinzel', serif;
      font-size: 11px;
      font-weight: 700;
      padding: 6px 7px;
      cursor: pointer;
      text-shadow: 1px 1px 0 #000;
      box-shadow: 0 2px 4px rgba(0,0,0,0.6);
      -webkit-tap-highlight-color: transparent;
      user-select: none;
      -webkit-user-select: none;
      backdrop-filter: blur(4px);
      -webkit-backdrop-filter: blur(4px);
    }
    .chat-tab-toggle:active { background: rgba(35, 24, 14, 0.95); }
    .chat-tab-icon { font-size: 14px; }
    /* Label "Chat" oculta (Sesión 29 ajuste UI): el icono 💬 ya es claro
       y reducimos x2 el ancho del botón minimizado. Si quieres devolverlo,
       cambia 'display: none' a 'display: inline'. */
    .chat-tab-label { display: none; letter-spacing: 0.04em; }
    .chat-unread {
      background: #d04030;
      color: #ffffff;
      font-size: 10px;
      font-weight: 700;
      padding: 1px 5px;
      border-radius: 8px;
      margin-left: 2px;
      min-width: 16px;
      text-align: center;
      box-shadow: 0 0 6px rgba(255, 80, 80, 0.5);
    }

    /* Panel expandido */
    .chat-panel {
      flex-direction: column;
      width: 300px;
      height: 260px;
      background: rgba(20, 14, 8, 0.86);
      border: 1.5px solid rgba(200, 160, 67, 0.5);
      border-radius: 4px;
      box-shadow: 0 4px 14px rgba(0,0,0,0.6);
      backdrop-filter: blur(4px);
      -webkit-backdrop-filter: blur(4px);
      overflow: hidden;
    }
    .chat-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 4px 8px;
      border-bottom: 1px solid rgba(200, 160, 67, 0.3);
      background: rgba(40, 26, 12, 0.7);
      flex-shrink: 0;
    }
    .chat-title {
      font-family: 'Cinzel', serif;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.05em;
      color: #e8c560;
      text-shadow: 1px 1px 0 #000;
    }
    .chat-close {
      background: transparent;
      border: none;
      color: #c8a043;
      font-size: 18px;
      line-height: 1;
      cursor: pointer;
      padding: 0 6px;
      -webkit-tap-highlight-color: transparent;
    }
    .chat-close:active { color: #fff; }

    .chat-messages {
      flex: 1;
      overflow-y: auto;
      overflow-x: hidden;
      padding: 4px 8px;
      font-size: 11px;
      line-height: 1.4;
      scrollbar-width: thin;
      scrollbar-color: rgba(200, 160, 67, 0.3) transparent;
      user-select: text;
      -webkit-user-select: text;
    }
    .chat-messages::-webkit-scrollbar { width: 4px; }
    .chat-messages::-webkit-scrollbar-thumb {
      background: rgba(200, 160, 67, 0.3);
      border-radius: 2px;
    }
    .chat-line {
      margin: 1px 0;
      word-break: break-word;
      text-shadow: 0 1px 1px rgba(0,0,0,0.85);
    }
    .chat-ts {
      color: #8a7a55;
      font-size: 10px;
    }
    .chat-user {
      font-weight: 700;
      margin-right: 2px;
    }
    .chat-user.self  { color: #ffff00; }   /* OSRS classic: yo amarillo */
    .chat-user.other { color: #ffffff; }   /* otros blanco */
    .chat-msg {
      color: #f0e0b0;
    }

    .chat-input-row {
      display: flex;
      gap: 4px;
      padding: 5px 6px;
      border-top: 1px solid rgba(200, 160, 67, 0.3);
      background: rgba(15, 10, 5, 0.5);
      flex-shrink: 0;
    }
    .chat-input {
      flex: 1;
      min-width: 0;
      background: rgba(20, 14, 8, 0.7);
      border: 1px solid rgba(200, 160, 67, 0.4);
      border-radius: 3px;
      color: #f0e0b0;
      padding: 5px 6px;
      font-family: 'IM Fell English', serif;
      font-size: 12px;
      outline: none;
      touch-action: auto;
      pointer-events: auto;
      user-select: text;
      -webkit-user-select: text;
    }
    .chat-input::placeholder { color: rgba(200, 160, 67, 0.5); }
    .chat-input:focus { border-color: #c8a043; background: rgba(30, 22, 12, 0.85); }
    .chat-input:disabled { opacity: 0.5; }

    .chat-send {
      background: linear-gradient(180deg, #2a5a2a, #1f4019);
      border: 1.5px solid #5db35d;
      color: #d8ffd8;
      font-size: 14px;
      font-weight: 700;
      border-radius: 3px;
      padding: 0 12px;
      cursor: pointer;
      -webkit-tap-highlight-color: transparent;
      flex-shrink: 0;
    }
    .chat-send:active { background: linear-gradient(180deg, #1a4a1a, #133013); }

    /* === Overhead bubble (texto sobre la cabeza OSRS-style) === */
    .chat-bubble {
      position: fixed;
      z-index: 17;
      transform: translate(-50%, -100%);
      background: transparent;
      color: #ffff00;
      font-family: 'IM Fell English', serif;
      font-size: 13px;
      font-weight: 700;
      letter-spacing: 0.02em;
      text-shadow:
        -1px -1px 0 #000, 1px -1px 0 #000,
        -1px 1px 0 #000,  1px 1px 0 #000,
         0 0 4px rgba(0,0,0,0.95);
      white-space: nowrap;
      max-width: 280px;
      overflow: hidden;
      text-overflow: ellipsis;
      pointer-events: none;
      user-select: none;
      padding: 2px 6px;
      transition: opacity 0.15s linear;
    }

    /* Móvil pequeño: panel ocupa casi todo el ancho */
    @media (max-width: 380px) {
      .chat-panel {
        width: calc(100vw - 24px);
        height: 240px;
      }
      .chat-bubble {
        font-size: 12px;
        max-width: 220px;
      }
    }
  `;
  document.head.appendChild(style);
}

// ============================================================
// Utils
// ============================================================
function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
