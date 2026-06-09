/**
 * SebasPresent — Highscores / ranking (Sesión 42)
 *
 * Overlay fullscreen con el ranking global de jugadores, ordenado por nivel
 * total (tiebreak XP total). Se abre desde el botón "Ver ranking" de la tab
 * Habilidades (📊) — ui.js lo cablea.
 *
 * Sigue el patrón de ge.js:
 *   - init() agarra #hsOverlay + .hs-overlay-frame, cablea cierre (✕ y click
 *     en el backdrop).
 *   - openOverlay() muestra el overlay (.visible), fetchea y renderiza.
 *   - closeOverlay() lo oculta.
 *
 * El server (handlers/skills.js → handleHighscores) reutiliza user_skills,
 * no toca el schema. Cada fila resalta al jugador actual vía is_you.
 */

import { getHighscores } from './api.js';

let overlayEl = null;
let frameEl = null;
let inited = false;

export function init() {
  if (inited) return;
  overlayEl = document.getElementById('hsOverlay');
  if (!overlayEl) {
    console.warn('[highscores] #hsOverlay no encontrado en DOM');
    return;
  }
  frameEl = overlayEl.querySelector('.hs-overlay-frame');
  if (!frameEl) {
    console.warn('[highscores] .hs-overlay-frame no encontrado dentro de #hsOverlay');
    return;
  }

  // Click en el backdrop (fuera del frame) → cerrar.
  overlayEl.addEventListener('pointerup', (ev) => {
    if (ev.target === overlayEl) closeOverlay();
  });

  // Delegación de clicks dentro del frame (botón cerrar + reload).
  frameEl.addEventListener('click', (ev) => {
    const target = ev.target.closest('[data-hs-action]');
    if (!target) return;
    const action = target.getAttribute('data-hs-action');
    if (action === 'close') closeOverlay();
    else if (action === 'reload') load();
  });

  inited = true;
}

export async function openOverlay() {
  if (!inited) init();
  if (!overlayEl) return;
  overlayEl.classList.add('visible');
  await load();
}

export function closeOverlay() {
  if (overlayEl) overlayEl.classList.remove('visible');
}

function fmtXp(n) {
  if (typeof n !== 'number' || !isFinite(n)) return '0';
  return Math.floor(n).toLocaleString('es-AR');
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function shell(inner) {
  return (
    '<div class="hs-header">' +
      '<div class="hs-title">🏆 Ranking</div>' +
      '<button class="hs-close-btn" data-hs-action="close" aria-label="Cerrar">✕</button>' +
    '</div>' +
    '<div class="hs-body">' + inner + '</div>'
  );
}

function renderRows(ranking) {
  if (!ranking || ranking.length === 0) {
    return shell('<div class="hs-empty">Todavía no hay jugadores en el ranking.</div>');
  }
  let rows = '';
  for (const r of ranking) {
    const youCls = r.is_you ? ' hs-row-you' : '';
    rows +=
      '<div class="hs-row' + youCls + '">' +
        '<div class="hs-col-rank">' + r.rank + '</div>' +
        '<div class="hs-col-name">' + esc(r.username) +
          (r.is_you ? ' <span class="hs-you-tag">(vos)</span>' : '') +
        '</div>' +
        '<div class="hs-col-lvl">' + r.total_level + '</div>' +
        '<div class="hs-col-cmb">' + r.combat_level + '</div>' +
        '<div class="hs-col-xp">' + fmtXp(r.total_xp) + '</div>' +
      '</div>';
  }
  const head =
    '<div class="hs-row hs-row-head">' +
      '<div class="hs-col-rank">#</div>' +
      '<div class="hs-col-name">Jugador</div>' +
      '<div class="hs-col-lvl">Nivel</div>' +
      '<div class="hs-col-cmb">Combate</div>' +
      '<div class="hs-col-xp">XP total</div>' +
    '</div>';
  return shell('<div class="hs-table">' + head + rows + '</div>');
}

async function load() {
  if (!frameEl) return;
  frameEl.innerHTML = shell('<div class="hs-loading">Cargando ranking…</div>');
  try {
    const res = await getHighscores();
    frameEl.innerHTML = renderRows(res && res.ranking ? res.ranking : []);
  } catch (e) {
    console.warn('[highscores] load error:', e);
    frameEl.innerHTML = shell(
      '<div class="hs-error">No se pudo cargar el ranking.' +
        '<button class="osrs-btn osrs-btn-ghost hs-retry" data-hs-action="reload">Reintentar</button>' +
      '</div>'
    );
  }
}
