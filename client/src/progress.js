/**
 * SebasPresent — Logros, registro de colección y contador de jefes (Sesión 53)
 *
 *   openAchievements()  → libro de logros (resumen + una página por categoría)
 *   openCollection()    → libro de colección (jefes con su contador, la Fosa y rarezas)
 *   poke(reason)        → algo pasó (nivel, misión, jefe, Fosa…): mira si hay logros nuevos
 *   init({ feedLog })   → avisos en el registro
 *
 * Nada de sondeos: GET /api/progress solo al abrir los libros y tras un
 * suceso, con 20 s como mínimo entre peticiones automáticas.
 */
import * as api from './api.js';
import * as audio from './audio.js';
import { openBookModal } from './ui/book_modal.js';
import { getItemIconHtml } from './item_icons.js';
import { ACHIEVEMENTS, ACH_CATS, TIERS, MAX_POINTS, achProgress } from './shared/achievements.js';
import { BOSSES } from './shared/bosses.js';
import { loadData as loadBestiary } from './bestiary.js';

let feedLog = () => {};
let last = null;            // última respuesta de /api/progress
let lastAt = 0;
let pending = null;
let pokeTimer = null;
let killsLocal = 0;         // muertes desde la última respuesta (para saber cuándo mirar)
const POKE_MIN_MS = 20_000;
const KILL_MARKS = [1, 100, 1000, 5000];

function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
const fmt = (n) => Number(n || 0).toLocaleString('es-ES');

export function init(opts = {}) {
  feedLog = opts.feedLog || feedLog;
  if (typeof window !== 'undefined') {
    window.__progressPoke = poke;
    window.__progress = { get: () => last, openAchievements, openCollection, fetchNow: () => fetchProgress(true) };
  }
  // Primera mirada al entrar (logros que ya cumplías antes de que existieran)
  setTimeout(() => poke('login'), 9000);
}
export function getLast() { return last; }

async function fetchProgress(force = false) {
  if (pending) return pending;
  if (!force && last && Date.now() - lastAt < 3000) return last;
  pending = api.progressGet().then(r => {
    if (r && !r.error) {
      last = r; lastAt = Date.now(); killsLocal = 0;
      if (Array.isArray(r.new) && r.new.length) announce(r.new);
    }
    return last;
  }).catch(err => { console.warn('[progress]', err?.message); return last; })
    .finally(() => { pending = null; });
  return pending;
}

/** Algo ha pasado: comprobar logros (agrupando los avisos seguidos). */
export function poke(reason = '', defId = null) {
  if (reason === 'kill') {
    const isBoss = !!BOSSES[defId] || defId === 'fosa_ignaroth';
    killsLocal++;
    const before = (last?.kills || 0) + killsLocal - 1;
    const crosses = KILL_MARKS.some(m => before < m && before + 1 >= m);
    if (!isBoss && !crosses) return;
  }
  if (pokeTimer) return;
  const wait = Math.max(1500, POKE_MIN_MS - (Date.now() - lastAt));
  pokeTimer = setTimeout(() => { pokeTimer = null; fetchProgress(true); }, wait);
}

function announce(ids) {
  let coins = 0;
  const list = ids.map(id => ACHIEVEMENTS.find(x => x.id === id)).filter(Boolean);
  for (const a of list) {
    const t = TIERS[a.tier];
    coins += t.coins;
    feedLog('info', `🏅 ¡Logro conseguido! ${a.name} (${t.name}) · +${fmt(t.coins)} monedas`);
  }
  // Muchos a la vez (p. ej. la primera vez que entras): un solo aviso que abre el libro.
  if (list.length > 2) {
    toast({ icon: '🏅', name: `¡${list.length} logros conseguidos!`, desc: 'Toca para verlos', tier: Math.max(...list.map(a => a.tier)), cat: null }, coins);
  } else {
    list.forEach((a, i) => setTimeout(() => toast(a), i * 2200));
  }
  if (coins) { try { window.inventory?.refresh?.(); } catch {} }
}

function toast(a, coinsOverride = null) {
  ensureCss();
  const t = TIERS[a.tier];
  const el = document.createElement('div');
  el.className = 'ach-toast';
  el.style.setProperty('--tc', t.color);
  el.innerHTML = `<div class="ach-toast-i">${a.icon}</div><div><div class="ach-toast-h">🏅 Logro conseguido</div><div class="ach-toast-n">${esc(a.name)}</div><div class="ach-toast-d">${esc(a.desc)} · <b>+${fmt(coinsOverride ?? t.coins)}</b> 🪙</div></div>`;
  el.addEventListener('pointerup', () => { el.remove(); openAchievements(a.cat); });
  document.body.appendChild(el);
  try { audio.synth?.('level_up', { volume: 0.7 }); } catch {}
  setTimeout(() => el.classList.add('out'), 4200);
  setTimeout(() => el.remove(), 4800);
}

// ------------------------------------------------------------
// Libro de logros
// ------------------------------------------------------------
function ctxFromLast(p) {
  const c = p?.ctx || {};
  return {
    lv: c.lv || {}, total: c.total || 0, combat: c.combat || 3, done: new Set(c.done || []),
    kc: p?.kc || {}, kills: p?.kills || 0, bossKills: c.bossKills || 0, bossesKilled: c.bossesKilled || 0,
    fosaBest: p?.fosa_best || 0, col: Object.keys(p?.collection || {}).length, streak: p?.streak || 0, flags: c.flags || {},
  };
}

function achRow(a, ctx, have) {
  const t = TIERS[a.tier];
  const got = !!have[a.id];
  const p = achProgress(a, ctx);
  const pct = got ? 100 : Math.round(100 * Math.min(p.have, p.need) / Math.max(1, p.need));
  const when = got ? new Date(have[a.id]).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' }) : '';
  return `<div class="ach-row${got ? ' got' : ''}">
    <div class="ach-ic">${got ? a.icon : '🔒'}</div>
    <div class="ach-main">
      <div class="ach-n">${esc(a.name)} <span class="ach-t" style="color:${t.color}">${t.name}</span></div>
      <div class="ach-d">${esc(a.desc)}</div>
      ${got ? `<div class="ach-ok">✔ Conseguido el ${when} · +${fmt(t.coins)} monedas</div>`
            : `<div class="ach-bar"><i style="width:${pct}%"></i></div><div class="ach-p">${fmt(p.have)} / ${fmt(p.need)} · premio ${fmt(t.coins)} 🪙</div>`}
    </div></div>`;
}

export async function openAchievements(startCat = null) {
  ensureCss();
  const p = await fetchProgress(true);
  if (!p) { feedLog('error', 'No se pudieron cargar los logros. Prueba en un momento.'); return; }
  const ctx = ctxFromLast(p);
  const have = p.have || {};
  const nGot = Object.keys(have).filter(id => ACHIEVEMENTS.some(a => a.id === id)).length;
  let summary = `<div class="ach-sum"><div class="ach-big">🏅 ${p.points || 0} <span>/ ${MAX_POINTS} puntos</span></div>
    <div class="ach-sub">${nGot} de ${ACHIEVEMENTS.length} logros conseguidos</div>
    <div class="ach-bar big"><i style="width:${Math.round(100 * nGot / ACHIEVEMENTS.length)}%"></i></div></div>
    <div class="ach-cats">`;
  for (const c of ACH_CATS) {
    const list = ACHIEVEMENTS.filter(a => a.cat === c.id);
    const g = list.filter(a => have[a.id]).length;
    summary += `<div class="ach-cat"><span>${c.icon} ${esc(c.name)}</span><b>${g}/${list.length}</b></div>`;
  }
  summary += `</div><div class="ach-tip">Cada logro da monedas una vez: Fácil ${fmt(TIERS[1].coins)} · Media ${fmt(TIERS[2].coins)} · Difícil ${fmt(TIERS[3].coins)} · Élite ${fmt(TIERS[4].coins)}.<br>Pasa las páginas para ver cada categoría.</div>`;
  const pages = [{ content: `<h2 class="ach-h">Tus logros</h2>${summary}` }];
  for (const c of ACH_CATS) {
    const list = ACHIEVEMENTS.filter(a => a.cat === c.id)
      .sort((a, b) => (!!have[b.id] - !!have[a.id]) || (a.tier - b.tier));
    pages.push({ content: `<h2 class="ach-h">${c.icon} ${esc(c.name)}</h2><div class="ach-list">${list.map(a => achRow(a, ctx, have)).join('')}</div>` });
  }
  openBookModal({ title: 'Logros', pages, startPage: startCat ? 1 + ACH_CATS.findIndex(c => c.id === startCat) : 0 });
}

// ------------------------------------------------------------
// Registro de colección
// ------------------------------------------------------------
const RARE = 0.05;
const BOSS_ORDER = Object.keys(BOSSES);

function itemCell(it, got) {
  return `<div class="col-it${got ? ' got' : ''}" title="${esc(it.name)}">
    <div class="col-ic">${getItemIconHtml(it.id, it.icon || '📦')}</div>
    <div class="col-n">${esc(it.name)}</div>
    <div class="col-q">${got ? `×${fmt(got)}` : '—'}</div></div>`;
}

export async function openCollection() {
  ensureCss();
  const [p, b] = await Promise.all([fetchProgress(true), loadBestiary().catch(() => null)]);
  if (!p || !b) { feedLog('error', 'No se pudo abrir el registro. Prueba en un momento.'); return; }
  const col = p.collection || {};
  const kc = p.kc || {};
  const bossItems = (id) => (b.loot[id] || []).filter(r => !r.always && r.id !== 'coins');
  // Rarezas de monstruos normales (las que entran en el registro)
  const rareBy = [];
  for (const [id, rows] of Object.entries(b.loot)) {
    const d = b.defs.get(id);
    if (!d || BOSSES[id] || d.behavior === 'boss' || d.behavior === 'minigame') continue;
    const items = rows.filter(r => !r.always && r.id !== 'coins' && r.chance > 0 && r.chance <= RARE);
    if (items.length) rareBy.push({ id, name: d.name, items });
  }
  rareBy.sort((x, y) => x.name.localeCompare(y.name, 'es'));
  // Totales (objetos distintos posibles)
  const allIds = new Set();
  BOSS_ORDER.forEach(id => bossItems(id).forEach(r => allIds.add(r.id)));
  rareBy.forEach(m => m.items.forEach(r => allIds.add(r.id)));
  allIds.add('cape_fuego');
  const gotN = [...allIds].filter(id => col[id] || (id === 'cape_fuego' && (p.fosa_best || 0) >= 12)).length;

  let sum = `<div class="ach-sum"><div class="ach-big">📒 ${gotN} <span>/ ${allIds.size} objetos</span></div>
    <div class="ach-sub">Lo que sueltan los jefes y lo más raro de cada monstruo.</div>
    <div class="ach-bar big"><i style="width:${Math.round(100 * gotN / Math.max(1, allIds.size))}%"></i></div></div>
    <div class="col-kc"><div class="col-kch">👑 Jefes derrotados</div>`;
  for (const id of BOSS_ORDER) {
    const items = bossItems(id);
    const g = items.filter(r => col[r.id]).length;
    sum += `<div class="ach-cat"><span>${esc(BOSSES[id].name)}</span><b>${fmt(kc[id] || 0)} <small>· ${g}/${items.length}</small></b></div>`;
  }
  sum += `<div class="ach-cat"><span>Fosa de Fuego (mejor oleada)</span><b>${p.fosa_best || 0}/12</b></div>`;
  sum += `<div class="ach-cat"><span>Monstruos derrotados en total</span><b>${fmt(p.kills || 0)}</b></div></div>`;
  const pages = [{ content: `<h2 class="ach-h">Registro de colección</h2>${sum}` }];
  for (const id of BOSS_ORDER) {
    const B = BOSSES[id];
    const items = bossItems(id);
    pages.push({ content: `<h2 class="ach-h">👑 ${esc(B.name)}</h2>
      <div class="col-meta">${esc(B.title || '')} · Derrotado <b>${fmt(kc[id] || 0)}</b> ${kc[id] === 1 ? 'vez' : 'veces'}</div>
      <div class="col-grid">${items.map(r => itemCell(r, col[r.id])).join('') || '<i>Sin botín especial.</i>'}</div>` });
  }
  const capeGot = (p.fosa_best || 0) >= 12 ? 1 : 0;
  pages.push({ content: `<h2 class="ach-h">🔥 La Fosa de Fuego</h2>
    <div class="col-meta">Mejor oleada: <b>${p.fosa_best || 0}</b> de 12 · Guayota (eco de la Fosa) derrotado <b>${fmt(kc.fosa_ignaroth || 0)}</b></div>
    <div class="col-grid">${itemCell({ id: 'cape_fuego', name: 'Capa de fuego', icon: '🔥' }, capeGot)}</div>` });
  if (rareBy.length) {
    pages.push({ content: `<h2 class="ach-h">✨ Rarezas</h2><div class="col-meta">Lo que sueltan los monstruos 1 de cada 20 veces o menos.</div>` +
      rareBy.map(m => `<div class="col-mon">${esc(m.name)} <small>· ${fmt(kc[m.id] || 0)} derrotados</small></div><div class="col-grid">${m.items.map(r => itemCell(r, col[r.id])).join('')}</div>`).join('') });
  }
  openBookModal({ title: 'Colección', pages });
}

// ------------------------------------------------------------
// CSS
// ------------------------------------------------------------
function ensureCss() {
  if (document.getElementById('progress-css')) return;
  const st = document.createElement('style');
  st.id = 'progress-css';
  st.textContent = `
    .ach-h { font-family: 'Cinzel', serif; color: #e8c560; font-size: 18px; margin: 0 0 8px; }
    .ach-sum { text-align: center; margin: 4px 0 10px; }
    .ach-big { font-size: 26px; font-weight: 900; color: #ffd77a; }
    .ach-big span { font-size: 14px; color: #bfae86; font-weight: 600; }
    .ach-sub { font-size: 12px; color: #d9c79a; margin: 2px 0 6px; }
    .ach-bar { height: 6px; border-radius: 3px; background: rgba(0,0,0,.45); overflow: hidden; margin-top: 4px; }
    .ach-bar.big { height: 9px; }
    .ach-bar i { display: block; height: 100%; background: linear-gradient(90deg, #c8a043, #ffd35a); }
    .ach-cats, .col-kc { display: flex; flex-direction: column; gap: 3px; }
    .col-kch { color: #e8c560; font-weight: 700; margin: 6px 0 2px; }
    .ach-cat { display: flex; justify-content: space-between; gap: 8px; padding: 5px 8px; background: rgba(0,0,0,.25); border-radius: 5px; font-size: 13px; color: #f3e6c4; }
    .ach-cat b { color: #ffd77a; font-variant-numeric: tabular-nums; white-space: nowrap; }
    .ach-cat small { color: #bfae86; font-weight: 400; }
    .ach-tip { font-size: 11.5px; color: #bfae86; margin-top: 10px; line-height: 1.4; }
    .ach-list { display: flex; flex-direction: column; gap: 6px; }
    .ach-row { display: flex; gap: 8px; padding: 7px 8px; border-radius: 6px; background: rgba(0,0,0,.28); border: 1px solid rgba(200,160,67,.15); }
    .ach-row.got { background: rgba(70,52,18,.55); border-color: rgba(232,197,96,.5); }
    .ach-ic { font-size: 22px; width: 30px; text-align: center; filter: grayscale(1) opacity(.6); }
    .ach-row.got .ach-ic { filter: none; }
    .ach-main { flex: 1; min-width: 0; }
    .ach-n { font-weight: 700; color: #f3e6c4; font-size: 13.5px; }
    .ach-t { font-size: 10.5px; font-weight: 700; margin-left: 4px; text-transform: uppercase; letter-spacing: .04em; }
    .ach-d { font-size: 12px; color: #d1c094; margin: 1px 0 3px; }
    .ach-p, .ach-ok { font-size: 11px; color: #bfae86; margin-top: 2px; }
    .ach-ok { color: #8fd88f; }
    .col-meta { font-size: 12.5px; color: #d9c79a; margin: -2px 0 8px; }
    .col-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(78px, 1fr)); gap: 6px; margin-bottom: 8px; }
    .col-it { background: rgba(0,0,0,.3); border: 1px solid rgba(200,160,67,.15); border-radius: 6px; padding: 5px 3px; text-align: center; }
    .col-it .col-ic { height: 34px; display: flex; align-items: center; justify-content: center; font-size: 24px; filter: grayscale(1) brightness(.45); }
    .col-it .col-ic img, .col-it .col-ic svg { max-width: 34px; max-height: 34px; }
    .col-it.got { border-color: rgba(232,197,96,.6); background: rgba(70,52,18,.5); }
    .col-it.got .col-ic { filter: none; }
    .col-n { font-size: 10.5px; color: #d9c79a; line-height: 1.15; margin-top: 2px; min-height: 24px; }
    .col-it:not(.got) .col-n { color: #8a7d5e; }
    .col-q { font-size: 11px; color: #ffd77a; font-weight: 700; }
    .col-mon { color: #e8c560; font-weight: 700; font-size: 13px; margin: 8px 0 4px; }
    .col-mon small { color: #bfae86; font-weight: 400; }
    .ach-toast { position: fixed; left: 50%; top: 18%; transform: translateX(-50%); z-index: 70; display: flex; gap: 10px; align-items: center;
      padding: 10px 14px; min-width: 240px; max-width: min(92vw, 420px); border-radius: 10px; border: 2px solid var(--tc, #e8c560);
      background: linear-gradient(180deg, rgba(58,40,14,.97), rgba(28,18,6,.97)); box-shadow: 0 0 26px rgba(232,197,96,.45);
      color: #f3e6c4; animation: achIn .35s cubic-bezier(.2,.9,.3,1.2); transition: opacity .5s, transform .5s; cursor: pointer; }
    .ach-toast.out { opacity: 0; transform: translate(-50%, -14px); }
    .ach-toast-i { font-size: 32px; }
    .ach-toast-h { font-size: 11px; color: var(--tc, #e8c560); text-transform: uppercase; letter-spacing: .08em; font-weight: 700; }
    .ach-toast-n { font-size: 16px; font-weight: 900; color: #ffe6a0; }
    .ach-toast-d { font-size: 12px; color: #d9c79a; }
    @keyframes achIn { from { opacity: 0; transform: translate(-50%, -20px) scale(.9); } to { opacity: 1; transform: translate(-50%, 0) scale(1); } }
  `;
  document.head.appendChild(st);
}
