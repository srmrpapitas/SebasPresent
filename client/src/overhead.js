/**
 * SebasPresent — Iconos sobre la cabeza (Sesión 50)
 *
 * Como en OSRS: la plegaria activa aparece encima de la cabeza y, si tienes
 * calavera (wilderness), la calavera va ENCIMA de la plegaria.
 *   - Protecciones (cuerpo a cuerpo / proyectiles / magia): su símbolo grande.
 *   - Otras plegarias: una insignia con su icono.
 */
import { PRAYERS_BY_ID } from './shared/prayer.js';
import { SKULL_SVG } from './skull.js';

const glow = (inner, c1, c2) => `<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
  <defs><radialGradient id="ovg${c1.slice(1)}" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="${c1}" stop-opacity=".9"/><stop offset="1" stop-color="${c2}" stop-opacity="0"/></radialGradient></defs>
  <circle cx="16" cy="16" r="15.5" fill="url(#ovg${c1.slice(1)})"/>${inner}</svg>`;

export const PROTECT_SVG = {
  protect_melee: glow(`
    <path d="M16 4 L25 8 L24 18 Q22 25 16 28 Q10 25 8 18 L7 8 Z" fill="#dfe9f2" stroke="#1a2a3a" stroke-width="1.3" stroke-linejoin="round"/>
    <path d="M16 7 L22 10 L21.3 17.5 Q19.8 22.8 16 25 Z" fill="#9fb6c8"/>
    <path d="M11 22 L21 10 M19.5 9.5 L22 9 L21.5 11.5 M12.5 18.5 L14.5 20.5" stroke="#2a1a0a" stroke-width="1.8" stroke-linecap="round"/>`, '#bfe6ff', '#6ab8ff'),
  protect_ranged: glow(`
    <circle cx="16" cy="16" r="10" fill="none" stroke="#dfe9f2" stroke-width="2.2"/>
    <circle cx="16" cy="16" r="10" fill="none" stroke="#1a2a3a" stroke-width=".8"/>
    <path d="M6 26 L24 8" stroke="#6a4020" stroke-width="2" stroke-linecap="round"/>
    <path d="M24 8 L19 8.5 L23.5 13Z" fill="#dfe9f2" stroke="#1a2a3a" stroke-width=".8"/>
    <path d="M6 26 L6.5 22 M6 26 L10 25.5 M8 24 L8.3 21 M8 24 L11 23.7" stroke="#e8e0d0" stroke-width="1.2" stroke-linecap="round"/>`, '#bfe6ff', '#6ab8ff'),
  protect_magic: glow(`
    <path d="M16 3 L19 12 L28 13 L21 19 L23 28 L16 23 L9 28 L11 19 L4 13 L13 12 Z" fill="#dfe9f2" stroke="#1a2a3a" stroke-width="1.2" stroke-linejoin="round"/>
    <circle cx="16" cy="16" r="4" fill="#7aa8ff" stroke="#1a2a3a" stroke-width=".8"/>`, '#d0c0ff', '#8a6aff'),
};

/** HTML del icono de una plegaria (protección → símbolo; otras → insignia). */
export function prayerIconHtml(prayerId) {
  if (!prayerId) return '';
  if (PROTECT_SVG[prayerId]) return PROTECT_SVG[prayerId];
  const p = PRAYERS_BY_ID[prayerId];
  if (!p) return '';
  return `<div class="ovh-badge">${p.icon}</div>`;
}

/** Pila sobre la cabeza: calavera arriba, plegaria debajo. */
export function overheadHtml(skulled, prayerId) {
  let h = '';
  if (skulled) h += `<div class="ovh-skull">${SKULL_SVG}</div>`;
  if (prayerId) h += `<div class="ovh-prayer">${prayerIconHtml(prayerId)}</div>`;
  return h;
}

export function ensureOverheadCss() {
  if (document.getElementById('ovh-css')) return;
  const s = document.createElement('style');
  s.id = 'ovh-css';
  s.textContent = `
    .ovh-stack { display: flex; flex-direction: column; align-items: center; gap: 1px; pointer-events: none; }
    .ovh-skull { width: 20px; height: 20px; filter: drop-shadow(0 0 3px rgba(0,0,0,0.8)); }
    .ovh-prayer { width: 28px; height: 28px; filter: drop-shadow(0 0 2px rgba(0,0,0,0.9)); animation: ovhIn .25s ease-out; }
    .ovh-skull svg, .ovh-prayer svg { width: 100%; height: 100%; display: block; }
    .ovh-badge { width: 24px; height: 24px; margin: 2px auto; border-radius: 50%; display: flex; align-items: center; justify-content: center;
      font-size: 14px; background: radial-gradient(circle, rgba(200,230,255,0.85), rgba(80,140,220,0.35) 70%, transparent 72%);
      box-shadow: 0 0 6px rgba(140,200,255,0.8); }
    @keyframes ovhIn { from { transform: scale(0.3); opacity: 0; } to { transform: scale(1); opacity: 1; } }
  `;
  document.head.appendChild(s);
}
