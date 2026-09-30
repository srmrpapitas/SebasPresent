/**
 * SebasPresent — Beber pociones + barra de subidas (Sesión 50)
 *   drink(slot): bebe una dosis (server), actualiza la mochila y la barra.
 *   Barra de subidas: iconos pequeños bajo el minimapa con el nivel extra y
 *   el tiempo que queda (ATQ +8 · 4:32).
 */
import * as api from './api.js';
import * as audio from './audio.js';
import { activeBoosts } from './shared/herblore.js';

const SK = { attack: ['⚔', 'Ataque', '#e05a3a'], strength: ['💪', 'Fuerza', '#d0a030'], defence: ['🛡', 'Defensa', '#4a8ad0'], ranged: ['🏹', 'Distancia', '#3aa04a'], magic: ['🔮', 'Magia', '#8a5ad0'] };
let boosts = {};          // skill → { v, until }
let bar = null, busy = false, getSnapshot = () => null, feedLog = () => {};
let lastSnapBoosts = null;

export function start(opts) {
  getSnapshot = opts.getSnapshot || (() => null);
  feedLog = opts.feedLog || (() => {});
  ensureBar();
  if (typeof window !== 'undefined') window.__potions = { drink, boosts: () => boosts };
}

function ensureBar() {
  if (bar) return;
  if (!document.getElementById('buff-css')) {
    const s = document.createElement('style');
    s.id = 'buff-css';
    s.textContent = `
      .buff-bar { position: fixed; top: calc(env(safe-area-inset-top, 0px) + 172px); right: 8px; z-index: 14; display: flex; flex-direction: column; gap: 3px; pointer-events: none; }
      .buff { display: flex; align-items: center; gap: 4px; padding: 2px 6px; border-radius: 10px; background: rgba(20,14,8,0.82);
        border: 1px solid var(--c); color: #f4e8c8; font: 600 11px sans-serif; box-shadow: 0 0 6px color-mix(in srgb, var(--c) 50%, transparent); }
      .buff b { color: var(--c); }
    `;
    document.head.appendChild(s);
  }
  bar = document.createElement('div');
  bar.className = 'buff-bar';
  document.body.appendChild(bar);
}

export async function drink(slot) {
  if (busy) return;
  busy = true;
  try {
    const r = await api.potionDrink(slot);
    if (r?.ok) {
      try { audio.synth?.('bury', { volume: 0.5, pitch: 1.9 }); } catch {}
      if (r.skill) {
        boosts[r.skill] = { v: r.boost, until: r.until };
        feedLog('info', `🧪 Bebes ${r.name}: ${SK[r.skill][1]} ${r.base} → ${r.base + r.boost} durante 5 min.${r.doses_left ? ` Quedan ${r.doses_left} dosis.` : ' El vial se ha vaciado.'}`);
      } else if (r.prayer) {
        feedLog('info', `🧪 Bebes ${r.name}: +${r.restored} de plegaria.${r.doses_left ? ` Quedan ${r.doses_left} dosis.` : ''}`);
        try { window.__prayer?.applyServer?.(r.prayer); } catch {}
      }
      try { await window.inventory?.refresh?.(); } catch {}
      render();
    }
  } catch (err) {
    feedLog('error', err?.message || 'No puedes beber eso ahora.');
  } finally { busy = false; }
}

function render() {
  if (!bar) return;
  const now = Date.now();
  let html = '';
  for (const [k, b] of Object.entries(boosts)) {
    if (!b || b.until <= now || !SK[k]) continue;
    const s = Math.ceil((b.until - now) / 1000);
    html += `<div class="buff" style="--c:${SK[k][2]}">${SK[k][0]} <b>+${b.v}</b> ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}</div>`;
  }
  if (bar.innerHTML !== html) bar.innerHTML = html;
}

let acc = 0;
export function update(dt) {
  acc += dt;
  if (acc < 0.5) return;
  acc = 0;
  // Subidas guardadas en el server (al recargar la página)
  const sb = getSnapshot?.()?.me?.boosts;
  if (sb && sb !== lastSnapBoosts) {
    lastSnapBoosts = sb;
    try { const o = JSON.parse(sb); for (const k of Object.keys(o)) if (!boosts[k] || boosts[k].until < o[k].until) boosts[k] = o[k]; } catch {}
  }
  render();
}

export { activeBoosts };
