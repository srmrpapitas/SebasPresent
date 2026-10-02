/**
 * SebasPresent — Desconexión por inactividad (Sesión 51)
 *
 * Como en OSRS: si llevas 5 minutos sin tocar nada, el juego se "duerme" y
 * deja de hablar con el servidor hasta que pulses "Seguir jugando". Si la
 * pestaña está oculta (otra pestaña, móvil bloqueado…) se pausa sola a los
 * 15 s y se reanuda al volver.
 *
 * Por qué: una pestaña olvidada abierta toda la noche consultaba la base de
 * datos sin parar y agotó el límite diario gratuito de Cloudflare (5 millones
 * de lecturas) antes del desayuno. Pausado = 0 peticiones.
 *
 * Los módulos que consultan al servidor miran isPaused() antes de cada
 * petición. world.js cierra/reabre el WebSocket con onChange().
 *
 * Debug: window.__afk()  ·  window.__afk.sleep()  (forzar la pausa)
 */

const IDLE_MS = 5 * 60_000;          // sin tocar nada → dormido
const IDLE_COMBAT_MS = 10 * 60_000;  // en combate, algo más de margen
const HIDDEN_MS = 15_000;            // pestaña oculta → pausa

let lastInput = Date.now();
let hiddenSince = 0;
let paused = false;
let reason = '';
let started = false;
let checkTimer = null;
let overlay = null;
let isInCombat = () => false;
const subs = new Set();

export function isPaused() { return paused; }
export function pauseReason() { return reason; }
export function onChange(fn) { subs.add(fn); return () => subs.delete(fn); }
/** Marcar actividad desde código (p. ej. joystick virtual). */
export function poke() { lastInput = Date.now(); }

export function start(opts = {}) {
  if (started) return;
  started = true;
  isInCombat = opts.isInCombat || isInCombat;
  lastInput = Date.now();
  const onInput = () => { lastInput = Date.now(); };
  for (const ev of ['pointerdown', 'keydown', 'wheel', 'touchstart']) {
    window.addEventListener(ev, onInput, { capture: true, passive: true });
  }
  document.addEventListener('visibilitychange', onVisibility);
  checkTimer = setInterval(check, 2000);
  const dbg = () => ({ paused, reason, idleS: Math.round((Date.now() - lastInput) / 1000), hidden: document.hidden });
  dbg.sleep = () => pause('idle');
  dbg.wake = () => resume();
  window.__afk = dbg;
}

function onVisibility() {
  if (document.hidden) {
    hiddenSince = Date.now();
  } else {
    hiddenSince = 0;
    if (paused && reason === 'hidden') resume();
    else if (!paused) lastInput = Date.now();
  }
}

function check() {
  if (paused) return;
  const now = Date.now();
  if (document.hidden) {
    if (hiddenSince && now - hiddenSince >= HIDDEN_MS) pause('hidden');
    return;
  }
  let fighting = false;
  try { fighting = !!isInCombat(); } catch {}
  if (now - lastInput >= (fighting ? IDLE_COMBAT_MS : IDLE_MS)) pause('idle');
}

function notify() {
  for (const fn of subs) { try { fn(paused, reason); } catch (e) { console.warn('[afk]', e); } }
}

function pause(why) {
  if (paused) return;
  paused = true;
  reason = why;
  console.log('[afk] pausa:', why);
  if (why === 'idle') showOverlay();
  notify();
}

export function resume() {
  if (!paused) return;
  paused = false;
  reason = '';
  lastInput = Date.now();
  hideOverlay();
  console.log('[afk] reanudado');
  notify();
}

function showOverlay() {
  if (overlay) { overlay.style.display = 'flex'; return; }
  overlay = document.createElement('div');
  overlay.id = 'afkOverlay';
  overlay.innerHTML = `
    <div class="afk-card">
      <div class="afk-z">💤</div>
      <div class="afk-title">Te has quedado dormido</div>
      <div class="afk-text">Llevas un rato sin tocar nada, así que el juego se ha desconectado para no gastar servidor.</div>
      <button type="button" class="afk-btn">Seguir jugando</button>
    </div>`;
  const css = document.createElement('style');
  css.textContent = `
    #afkOverlay { position: fixed; inset: 0; z-index: 99999; display: flex; align-items: center; justify-content: center;
      background: rgba(8, 6, 4, 0.72); backdrop-filter: blur(2px); font-family: inherit; }
    #afkOverlay .afk-card { max-width: 320px; margin: 16px; padding: 22px 20px 18px; text-align: center;
      background: #3e3529; border: 2px solid #c8a043; border-radius: 10px; color: #f3e6c4;
      box-shadow: 0 8px 30px rgba(0,0,0,0.6); }
    #afkOverlay .afk-z { font-size: 42px; line-height: 1; margin-bottom: 8px; }
    #afkOverlay .afk-title { font-size: 19px; font-weight: 700; color: #ffd76a; margin-bottom: 8px; }
    #afkOverlay .afk-text { font-size: 14px; line-height: 1.4; margin-bottom: 16px; color: #e8dbb8; }
    #afkOverlay .afk-btn { font: inherit; font-size: 16px; font-weight: 700; padding: 10px 22px; border-radius: 8px;
      border: 2px solid #ffd76a; background: #6b4f1d; color: #fff3cf; cursor: pointer; }
    #afkOverlay .afk-btn:active { transform: translateY(1px); }`;
  overlay.appendChild(css);
  overlay.addEventListener('pointerdown', (e) => { e.stopPropagation(); }, true);
  overlay.querySelector('.afk-btn').addEventListener('click', (e) => { e.preventDefault(); resume(); });
  document.body.appendChild(overlay);
}

function hideOverlay() { if (overlay) overlay.style.display = 'none'; }
