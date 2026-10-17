/**
 * SebasPresent — Evento de la isla «¡El Teide ruge!» (cliente) · Sesión 53
 *
 *   - Aviso arriba: "¡La Tibicena Mayor anda suelta! a 640 m al noreste · quedan 12 min"
 *     (y cuenta atrás los 5 minutos antes).
 *   - Marca en el minimapa mientras está viva.
 *   - Anuncios por el canal en tiempo real (empieza / la vencen / se va) y TU premio.
 * El horario sale del reloj del servidor (shared/world_events.js): sin peticiones.
 */
import * as audio from './audio.js';
import { WORLD_EVENT, eventWindow, directionTo } from './shared/world_events.js';

let getPlayer = () => null, getSnapshot = () => null, getServerNow = () => null, feedLog = () => {}, getMyId = () => null;
let el = null, acc = 0, started = false;
let wonAt = 0;          // la vencieron en este evento
let goneAt = 0;
let lastStartSeen = 0;

const now = () => (globalThis.__wevShift || 0) + (getServerNow?.() || Date.now());   // __wevShift: solo pruebas
function fmtMin(ms) { const m = Math.max(0, Math.ceil(ms / 60_000)); return m <= 1 ? 'menos de 1 min' : `${m} min`; }

export function start(opts) {
  getPlayer = opts.getPlayer || getPlayer;
  getSnapshot = opts.getSnapshot || getSnapshot;
  getServerNow = opts.getServerNow || getServerNow;
  feedLog = opts.feedLog || feedLog;
  getMyId = opts.getMyId || getMyId;
  started = true;
  ensureDom();
  if (typeof window !== 'undefined') window.__worldEvent = { state: () => ({ w: eventWindow(now()), wonAt, alive: isAlive() }), onAnn };
}
export function stop() { started = false; el?.remove(); el = null; }

/** ¿Está viva ahora? (snapshot completo durante el evento; si no, lo que digan los anuncios) */
function isAlive() {
  const w = eventWindow(now());
  if (!w.active) return false;
  if (wonAt >= w.start || goneAt >= w.start) return false;
  const wev = getSnapshot?.()?.me?.wev;
  if (wev && wev.alive === false) return false;
  return true;
}
export function markerPos() { return isAlive() ? { x: WORLD_EVENT.x, z: WORLD_EVENT.z } : null; }

/** Anuncios del servidor (multiplayer.js → t:'ann', k:'ev_*'). */
export function onAnn(m) {
  const t = now();
  if (m.k === 'ev_warn') {
    feedLog('warning', `🌋 ¡El Teide ruge! En 5 minutos despierta ${WORLD_EVENT.name} en ${WORLD_EVENT.place}. Todos los que le peguen se llevan premio (recomendado combate 30+; si eres de nivel bajo, pégale una vez desde lejos y sal de su guarida).`);
    try { audio.synth?.('pray_on', { volume: 0.7, pitch: 0.5 }); } catch {}
  } else if (m.k === 'ev_start') {
    lastStartSeen = t;
    feedLog('warning', `🌋 ¡${cap(WORLD_EVENT.name)} anda suelta en ${WORLD_EVENT.place}! Tenéis 15 minutos. ${dirText()}`);
    bigTitle('🌋 ¡EL TEIDE RUGE!', `${cap(WORLD_EVENT.name)} ha despertado`);
    try { audio.synth?.('level_up', { volume: 0.9, pitch: 0.6 }); } catch {}
  } else if (m.k === 'ev_gone') {
    goneAt = t;
    feedLog('info', `🌋 ${cap(WORLD_EVENT.name)} vuelve a las entrañas del Teide. Nadie pudo con ella esta vez.`);
  } else if (m.k === 'ev_won') {
    wonAt = t;
    feedLog('levelup', `🏆 ¡${m.u} ha dado el golpe final a ${WORLD_EVENT.name}! ${m.n} ${m.n === 1 ? 'valiente se lleva' : 'valientes se llevan'} premio.`);
    const mine = m.rw?.[getMyId?.()];
    if (mine) {
      feedLog('levelup', `🎁 Tu parte: ${Number(mine.c).toLocaleString('es-ES')} monedas${mine.i ? ` y ${mine.q > 1 ? mine.q + ' × ' : ''}${mine.i}` : ''}.`);
      try { audio.synth?.('level_up', { volume: 1 }); } catch {}
      try { window.inventory?.refresh?.(); } catch {}
      try { window.__progressPoke?.('kill', WORLD_EVENT.boss); } catch {}
    }
  }
  render(true);
}

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
function dirText() {
  const p = getPlayer?.();
  return p ? `Está ${directionTo(p.position.x, p.position.z)}.` : '';
}

export function update(dt) {
  if (!started) return;
  acc += dt;
  if (acc < 1) return;
  acc = 0;
  render(false);
}

function render() {
  if (!el) return;
  const t = now();
  const w = eventWindow(t);
  const p = getPlayer?.();
  let html = '';
  if (w.active && isAlive()) {
    const wev = getSnapshot?.()?.me?.wev;
    const hp = wev?.hp != null ? ` · ❤ ${wev.hp}` : '';
    html = `🌋 <b>¡El Teide ruge!</b> ${cap(WORLD_EVENT.name)} anda suelta${p ? ` ${directionTo(p.position.x, p.position.z)}` : ''} · quedan ${fmtMin(w.end - t)}${hp}`;
  } else if (w.warning) {
    html = `🌋 El Teide retumba… ${cap(WORLD_EVENT.name)} despierta en <b>${fmtMin(w.msToNext)}</b> en ${WORLD_EVENT.place}`;
  }
  if (html) {
    if (el.dataset.h !== html) { el.innerHTML = html; el.dataset.h = html; }
    el.style.display = '';
  } else el.style.display = 'none';
}

function bigTitle(title, sub) {
  ensureDom();
  const t = document.createElement('div');
  t.className = 'wev-title';
  t.innerHTML = `<div class="a">${title}</div><div class="b">${sub}</div>`;
  document.body.appendChild(t);
  setTimeout(() => t.classList.add('out'), 3200);
  setTimeout(() => t.remove(), 4000);
}

function ensureDom() {
  if (el) return;
  if (!document.getElementById('wev-css')) {
    const st = document.createElement('style');
    st.id = 'wev-css';
    st.textContent = `
      .wev-banner { position: fixed; left: 50%; transform: translateX(-50%); bottom: calc(env(safe-area-inset-bottom, 0px) + 8px);
        z-index: 24; max-width: min(92vw, 520px); padding: 6px 12px; border-radius: 8px; font-size: 12.5px; line-height: 1.3;
        color: #ffe9c0; text-align: center; pointer-events: none;
        background: linear-gradient(180deg, rgba(110,28,6,.92), rgba(60,14,4,.92)); border: 1px solid #ff8a40;
        box-shadow: 0 0 18px rgba(255,90,20,.45); animation: wevPulse 2.4s ease-in-out infinite; }
      .wev-banner b { color: #fff3c0; }
      .wev-title { position: fixed; left: 50%; top: 44%; transform: translate(-50%, -50%); z-index: 65; text-align: center; pointer-events: none;
        animation: wevIn .5s cubic-bezier(.2,.9,.3,1.3); transition: opacity .8s; }
      .wev-title.out { opacity: 0; }
      .wev-title .a { font-family: 'Cinzel', serif; font-weight: 900; font-size: clamp(26px, 7vw, 46px); color: #ffdd88;
        text-shadow: 0 0 18px #ff4a10, 0 0 36px #ff2a00, 0 3px 4px #000; letter-spacing: .04em; white-space: nowrap; }
      .wev-title .b { font-size: clamp(13px, 3.4vw, 18px); color: #ffe9c0; text-shadow: 0 2px 3px #000; margin-top: 4px; }
      @keyframes wevIn { from { opacity: 0; transform: translate(-50%, -50%) scale(1.4); } to { opacity: 1; transform: translate(-50%, -50%) scale(1); } }
      @keyframes wevPulse { 0%,100% { box-shadow: 0 0 12px rgba(255,90,20,.35); } 50% { box-shadow: 0 0 24px rgba(255,120,30,.7); } }
      @media (max-width: 700px) { .wev-banner { bottom: auto; top: calc(env(safe-area-inset-top, 0px) + 230px); font-size: 11.5px; } }
    `;
    document.head.appendChild(st);
  }
  el = document.createElement('div');
  el.className = 'wev-banner';
  el.style.display = 'none';
  document.body.appendChild(el);
}
