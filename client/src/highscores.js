/**
 * SebasPresent — Highscores / ranking (Sesión 42 → 42b libro)
 *
 * Ranking global de jugadores mostrado dentro del LIBRO reusable
 * (ui/book_modal.js). Se abre desde el slot "Ranking 🏆" del panel de
 * Habilidades (lo cablea world.js → renderSkillsPanel).
 *
 * Estructura del libro:
 *   - Página 1: "General" — ranking por nivel total (+ combat + XP total).
 *   - Páginas 2..N: una por cada skill (SKILL_DEFS), ranking por nivel de
 *     esa skill (desempate por XP), con nombre + nivel + XP de cada jugador.
 *
 * El server (handlers/skills.js → handleHighscores) manda el XP crudo por
 * skill de cada jugador; acá calculamos nivel con la misma xpToLevel del
 * cliente y ordenamos por página.
 *
 * Usa el libro porque inyecta su propio CSS por JS (no depende de style.css,
 * que se cachea 24h por _headers) y ya maneja el pasaje de páginas + sfx.
 */

import { getHighscores } from './api.js';
import { xpToLevel, SKILL_DEFS } from './skills.js';
import { openBookModal } from './ui/book_modal.js';

// init() existe para compatibilidad con llamadas previas; el libro no necesita
// montaje previo. No-op seguro.
export function init() { /* no-op: el libro se monta solo al abrir */ }

function fmtXp(n) {
  const v = (typeof n === 'number' && isFinite(n)) ? Math.floor(n) : 0;
  return v.toLocaleString('es-AR');
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Estilos inline (cache-proof). Devuelve una tabla HTML lista para el libro.
const TH = 'style="text-align:left;padding:4px 6px;border-bottom:1px solid rgba(200,160,67,0.35);color:#c8a043;font-size:12px;text-transform:uppercase;letter-spacing:.04em;"';
const TD = 'style="padding:4px 6px;border-bottom:1px solid rgba(200,160,67,0.12);"';
const TDR = 'style="padding:4px 6px;border-bottom:1px solid rgba(200,160,67,0.12);text-align:right;font-variant-numeric:tabular-nums;"';
const TDC = 'style="padding:4px 6px;border-bottom:1px solid rgba(200,160,67,0.12);text-align:center;color:#e8c560;font-weight:700;"';

function rowStyle(isYou) {
  return isYou ? ' style="background:rgba(200,160,67,0.20);outline:1px solid #c8a043;"' : '';
}

function youTag(isYou) {
  return isYou ? ' <span style="color:#e8c560;font-size:12px;">(vos)</span>' : '';
}

function generalPage(players) {
  // players ya viene ordenado por nivel total desde el server.
  let rows = '';
  players.forEach((p, i) => {
    rows +=
      `<tr${rowStyle(p.is_you)}>` +
        `<td ${TDC}>${i + 1}</td>` +
        `<td ${TD}>${esc(p.username)}${youTag(p.is_you)}</td>` +
        `<td ${TDR}>${p.total_level}</td>` +
        `<td ${TDR}>${p.combat_level}</td>` +
        `<td ${TDR}>${fmtXp(p.total_xp)}</td>` +
      `</tr>`;
  });
  if (!rows) rows = `<tr><td ${TD} colspan="5"><em>Sin jugadores todavía.</em></td></tr>`;
  return (
    `<h2>🏆 General</h2>` +
    `<table style="width:100%;border-collapse:collapse;font-size:14px;">` +
      `<thead><tr>` +
        `<th ${TH} style="text-align:center;">#</th>` +
        `<th ${TH}>Jugador</th>` +
        `<th ${TH} style="text-align:right;">Nivel</th>` +
        `<th ${TH} style="text-align:right;">Combate</th>` +
        `<th ${TH} style="text-align:right;">XP total</th>` +
      `</tr></thead>` +
      `<tbody>${rows}</tbody>` +
    `</table>`
  );
}

function skillPage(def, players) {
  // Ranking por esta skill: nivel desc, desempate XP desc.
  const ranked = players
    .map(p => {
      const xp = (p.skills && p.skills[def.id]) || 0;
      return { username: p.username, is_you: p.is_you, xp, level: xpToLevel(xp) };
    })
    .sort((a, b) => (b.level - a.level) || (b.xp - a.xp) || a.username.localeCompare(b.username));

  let rows = '';
  ranked.forEach((p, i) => {
    rows +=
      `<tr${rowStyle(p.is_you)}>` +
        `<td ${TDC}>${i + 1}</td>` +
        `<td ${TD}>${esc(p.username)}${youTag(p.is_you)}</td>` +
        `<td ${TDR}>${p.level}</td>` +
        `<td ${TDR}>${fmtXp(p.xp)}</td>` +
      `</tr>`;
  });
  if (!rows) rows = `<tr><td ${TD} colspan="4"><em>Sin jugadores todavía.</em></td></tr>`;
  return (
    `<h2>${def.icon || ''} ${esc(def.name)}</h2>` +
    `<table style="width:100%;border-collapse:collapse;font-size:14px;">` +
      `<thead><tr>` +
        `<th ${TH} style="text-align:center;">#</th>` +
        `<th ${TH}>Jugador</th>` +
        `<th ${TH} style="text-align:right;">Nivel</th>` +
        `<th ${TH} style="text-align:right;">XP</th>` +
      `</tr></thead>` +
      `<tbody>${rows}</tbody>` +
    `</table>`
  );
}

function buildPages(players) {
  const pages = [{ content: generalPage(players) }];
  for (const def of SKILL_DEFS) {
    pages.push({ content: skillPage(def, players) });
  }
  return pages;
}

// Abre el libro de highscores. Llamado por world.js (slot Ranking).
export async function open() {
  let players = [];
  try {
    const res = await getHighscores();
    players = (res && Array.isArray(res.players)) ? res.players : [];
  } catch (e) {
    console.warn('[highscores] fetch error:', e);
    openBookModal({
      title: 'Highscores',
      pages: [{ content: '<h2>🏆 Highscores</h2><p><em>No se pudo cargar el ranking. Probá de nuevo en un momento.</em></p>' }],
    });
    return;
  }
  openBookModal({ title: 'Highscores', pages: buildPages(players) });
}

// Alias por compatibilidad con cableado previo.
export const openOverlay = open;
