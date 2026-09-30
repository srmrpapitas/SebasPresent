/**
 * SebasPresent — Calavera PvP (Sesión 50)
 *
 * Muestra la calavera estilo OSRS sobre la cabeza:
 *   - Tuya: si snapshot.me.skulled_until > ahora (el server la pone al atacar
 *     a otro jugador en la wilderness sin que él te atacara antes).
 *   - De otros jugadores: multiplayer.js pone la clase .skulled en su nameplate.
 * Avisa por el chat al recibirla y cuando se te quita.
 */

import * as THREE from 'three';
import { overheadHtml, ensureOverheadCss } from './overhead.js';   // Sesión 50 — plegaria + calavera

export const SKULL_SVG = `<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg"><path d="M16 2C9 2 4 7 4 14c0 4 2 7 5 8.5V27c0 1.5 1 3 2.5 3h9c1.5 0 2.5-1.5 2.5-3v-4.5c3-1.5 5-4.5 5-8.5C28 7 23 2 16 2z" fill="#f4f0e6" stroke="#000" stroke-width="1.6"/><ellipse cx="11" cy="14.5" rx="3.2" ry="3.6" fill="#111"/><ellipse cx="21" cy="14.5" rx="3.2" ry="3.6" fill="#111"/><path d="M16 18.5l-2 3.5h4z" fill="#111"/><path d="M12 26v3M16 26v3M20 26v3" stroke="#111" stroke-width="1.5"/></svg>`;

let getSnapshot = () => null, getPlayer = () => null, getCamera = () => null, feedLog = () => {};
let getOverheadPrayer = () => null;
let lastKey = '';
let el = null;
let wasSkulled = false;
let started = false;
const v = new THREE.Vector3();

export function start(opts) {
  getSnapshot = opts.getSnapshot || (() => null);
  getPlayer = opts.getPlayer || (() => null);
  getCamera = opts.getCamera || (() => null);
  feedLog = opts.feedLog || (() => {});
  getOverheadPrayer = opts.getOverheadPrayer || (() => null);
  ensureCss();
  ensureOverheadCss();
  el = document.createElement('div');
  el.className = 'player-skull ovh-stack';
  lastKey = '';
  el.style.display = 'none';
  document.body.appendChild(el);
  wasSkulled = false;
  started = true;
}

export function stop() {
  el?.remove(); el = null;
  started = false;
}

export function update() {
  if (!started || !el) return;
  const until = getSnapshot?.()?.me?.skulled_until || 0;
  const skulled = until > Date.now();
  if (skulled !== wasSkulled) {
    if (skulled) {
      const mins = Math.ceil((until - Date.now()) / 60000);
      feedLog('warning', `☠ ¡Tienes calavera! Si mueres en los próximos ${mins} min pierdes TODOS tus objetos.`);
    } else if (wasSkulled) {
      feedLog('info', '☠ Tu calavera ha desaparecido.');
    }
    wasSkulled = skulled;
  }
  // Sesión 50 — pila sobre la cabeza: calavera arriba, plegaria debajo
  let pr = null;
  try { pr = getOverheadPrayer?.() || null; } catch {}
  const key = `${skulled ? 1 : 0}|${pr || ''}`;
  if (key !== lastKey) { lastKey = key; el.innerHTML = overheadHtml(skulled, pr); }
  const p = getPlayer?.(), cam = getCamera?.();
  if ((!skulled && !pr) || !p || !cam) { el.style.display = 'none'; return; }
  v.set(p.position.x, p.position.y + 2.55, p.position.z).project(cam);
  if (v.z > 1 || v.z < -1) { el.style.display = 'none'; return; }
  el.style.display = 'block';
  el.style.left = ((v.x * 0.5 + 0.5) * window.innerWidth) + 'px';
  el.style.top = ((-v.y * 0.5 + 0.5) * window.innerHeight) + 'px';
}

function ensureCss() {
  if (document.getElementById('skull-css')) return;
  const s = document.createElement('style');
  s.id = 'skull-css';
  const uri = 'data:image/svg+xml;utf8,' + encodeURIComponent(SKULL_SVG);
  s.textContent = `
    .player-skull { position: fixed; transform: translate(-50%, -100%); pointer-events: none; z-index: 30; }
  `;
  document.head.appendChild(s);
}
