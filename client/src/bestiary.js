/**
 * SebasPresent — Libro de bestias (Sesión 51)
 *
 * Todas las criaturas de la isla: nivel, vida, golpe máximo, si atacan solas,
 * DÓNDE viven (zona de caza + cómo llegar + "Ver en el mapa") y qué sueltan.
 *
 * Se abre desde la pestaña de Misiones (botón "📖 Bestiario").
 * Los datos de fichas y botín vienen de GET /api/bestiary una vez por sesión;
 * las zonas, de shared/hunting_zones.js.
 *
 * Debug: window.__bestiary.open('wolf')
 */
import * as api from './api.js';
import { getItemIconHtml } from './item_icons.js';
import {
  HUNTING_ZONES, BEAST_GROUPS, BEAST_EXTRA_PLACES, BEAST_CAVES, zonesOf, npcCombatLevel,
} from './shared/hunting_zones.js';
import { BOSSES } from './shared/bosses.js';
import { CAVES } from './shared/caves.js';
import { FOSA } from './shared/fosa.js';

// Sitios fijos (jefes, poblado, guarida, cuevas) para el botón "Ver en el mapa"
const CHINAMADA = [-620, 140, 'Poblado de Chinamada'];
const MERCEDES = [-40, -600, 'Monte de Las Mercedes'];
function fixedSpot(id) {
  if (BOSSES[id]) return [BOSSES[id].x, BOSSES[id].z, BOSSES[id].name];
  if (/^guanche_|^cabra$/.test(id)) return CHINAMADA;
  if (id === 'acolito_cabildo') return MERCEDES;
  if (id === 'bruto_echeyde') return [CAVES.echeyde.mouth.x, CAVES.echeyde.mouth.z, CAVES.echeyde.name];
  if (id === 'fosa_ignaroth') return [FOSA.x, FOSA.z, 'Fosa de Guayota'];
  return null;
}
const CAVE_OF = { spider: 'viento', zombi: 'viento', yeti: 'hielo', zombi_igneo: 'echeyde' };
const mapBtn = (x, z, name) => `<button type="button" class="bst-map" data-mapx="${x}" data-mapz="${z}" data-mapn="${esc(name)}">🗺 Ver en el mapa</button>`;

const ICON = {
  chicken: '🐔', cow: '🐄', cabra: '🐐', rat: '🐀', rat_jefe: '🐀', boar: '🐗', boar_jefe: '🐗',
  wolf: '🐺', wolf_jefe: '🐺', spider: '🕷️', spider_jefe: '🕷️', scorpion: '🦂', scorpion_jefe: '🦂',
  goblin: '👺', goblin_jefe: '👺', golem: '🗿', golem_jefe: '🗿', yeti: '🦍', yeti_jefe: '🦍',
  ogro_anaga: '👹', ogro_anaga_jefe: '👹', skeleton: '💀', skeleton_jefe: '💀', zombi: '🧟', zombi_jefe: '🧟',
  zombi_igneo: '🔥', zombi_igneo_jefe: '🔥', bruto_echeyde: '🌋', bandido: '🗡️', bandido_jefe: '🗡️',
  guanche_guerrero: '🛡️', guanche_hondero: '🪨', guanche_faycan: '🪶', guanche_mencey: '👑', acolito_cabildo: '🧙',
  magister_cabildo: '🧙', bruja_pantano: '🧙‍♀️', coloso_obsidiana: '🗿', reina_escorpion: '🦂', rey_yeti: '❄️',
  rey_esqueleto: '☠️', leviatan: '🐙', dragon_rojo: '🐉', dragon_negro: '🐲', fosa_ignaroth: '🔥',
};
const STYLE = { melee: 'Cuerpo a cuerpo', ranged: 'A distancia', magic: 'Magia' };

let data = null;         // { defs: Map, loot: {} }
let loading = null;
let root = null;
let tab = 'animales';
let openId = null;
let query = '';

function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

async function load() {
  if (data) return data;
  if (!loading) {
    loading = api.bestiary().then(r => {
      data = { defs: new Map((r?.defs || []).map(d => [d.id, d])), loot: r?.loot || {} };
      return data;
    }).catch(err => { loading = null; throw err; });
  }
  return loading;
}

function fmtChance(c, always) {
  if (always) return 'Siempre';
  if (!(c > 0)) return '—';
  if (c >= 0.995) return 'Siempre';
  const inv = Math.round(1 / c);
  const label = c >= 0.25 ? 'Común' : c >= 0.08 ? 'A veces' : c >= 0.03 ? 'Poco común' : 'Raro';
  return `${label} · 1/${inv}`;
}

function whereHtml(id) {
  let h = '';
  const zs = zonesOf(id);
  for (const z of zs) {
    h += `<div class="bst-zone">
      <div class="bst-zone-name">⚔ ${esc(z.name)}${z.wild ? ' <span class="bst-wild">Malpaís</span>' : ''}</div>
      <div class="bst-zone-how">${esc(z.how)}</div>
      <button type="button" class="bst-map" data-map="${z.id}">🗺 Ver en el mapa</button>
    </div>`;
  }
  const extra = BEAST_EXTRA_PLACES[id];
  const spot = fixedSpot(id);
  if (extra) h += `<div class="bst-zone"><div class="bst-zone-how">📍 ${esc(extra)}</div>${spot ? mapBtn(spot[0], spot[1], spot[2]) : ''}</div>`;
  const cave = BEAST_CAVES[id];
  const cv = CAVES[CAVE_OF[id]];
  if (cave) h += `<div class="bst-zone"><div class="bst-zone-how">🕳 También en la ${esc(cave)}</div>${cv ? mapBtn(cv.mouth.x, cv.mouth.z, cv.name) : ''}</div>`;
  return h || '<div class="bst-zone-how">Nadie sabe dónde se esconde.</div>';
}

function lootHtml(id) {
  const rows = data?.loot?.[id] || [];
  if (!rows.length) return '<div class="bst-zone-how">No suelta nada.</div>';
  return '<div class="bst-loot">' + rows.map(r => {
    const qty = r.min === r.max ? (r.min > 1 ? ` ×${r.min}` : '') : ` ×${r.min}–${r.max}`;
    return `<div class="bst-li"><span class="bst-li-ic">${getItemIconHtml(r.id, r.icon || '📦')}</span>
      <span class="bst-li-n">${esc(r.name)}${qty}</span><span class="bst-li-c ${r.always ? 'al' : r.chance < 0.03 ? 'ra' : ''}">${fmtChance(r.chance, r.always)}</span></div>`;
  }).join('') + '</div>';
}

function rowHtml(id) {
  const d = data.defs.get(id);
  if (!d) return '';
  const lvl = npcCombatLevel(d);
  const isBoss = d.behavior === 'boss' || d.behavior === 'minigame';
  const aggro = d.behavior === 'aggressive' || isBoss;
  const zs = zonesOf(id);
  const sub = zs.length ? zs.map(z => z.name).join(' · ') : (BEAST_EXTRA_PLACES[id] || '').replace(/\.$/, '');
  const open = openId === id;
  let h = `<div class="bst-row${open ? ' open' : ''}">
    <div class="bst-head" data-open="${id}">
      <span class="bst-ic">${ICON[id] || '❔'}</span>
      <span class="bst-main"><span class="bst-name">${esc(d.name)}${/_jefe$/.test(id) ? ' <span class="bst-tag">jefe de zona</span>' : ''}</span>
        <span class="bst-sub">${esc(sub)}</span></span>
      <span class="bst-lvl">Nv. ${lvl}</span>
      <span class="bst-ag ${isBoss ? 'boss' : aggro ? 'ag' : 'pa'}" title="${aggro ? 'Te ataca si te acercas' : 'No ataca si no le pegas'}">${isBoss ? 'Jefe' : aggro ? 'Agresivo' : 'Pacífico'}</span>
    </div>`;
  if (open) {
    const respawn = d.respawn_ms && d.respawn_ms < 1e9 ? `${Math.round(d.respawn_ms / 1000)} s` : '—';
    h += `<div class="bst-body">
      <div class="bst-stats">
        <div><b>${lvl}</b><span>Nivel</span></div>
        <div><b>${d.max_hp}</b><span>Vida</span></div>
        <div><b>${d.max_hit}</b><span>Golpe máx.</span></div>
        <div><b>${d.attack_lvl}</b><span>Ataque</span></div>
        <div><b>${d.defence_lvl}</b><span>Defensa</span></div>
        <div><b>${esc(STYLE[d.style] || 'Cuerpo a cuerpo')}</b><span>Estilo</span></div>
        <div><b>${respawn}</b><span>Reaparece</span></div>
        <div><b>${aggro ? (d.aggro_radius ? `${Math.round(d.aggro_radius)} m` : 'Sí') : 'No'}</b><span>Te ve a</span></div>
      </div>
      <div class="bst-k">Dónde encontrarlo</div>${whereHtml(id)}
      <div class="bst-k">Botín</div>${lootHtml(id)}
    </div>`;
  }
  return h + '</div>';
}

function render() {
  if (!root) return;
  const list = root.querySelector('.bst-list');
  const tabs = root.querySelector('.bst-tabs');
  tabs.innerHTML = BEAST_GROUPS.map(g => `<button type="button" class="bst-tab${g.id === tab && !query ? ' on' : ''}" data-tab="${g.id}">${esc(g.name)}</button>`).join('');
  if (!data) { list.innerHTML = '<div class="bst-msg">Abriendo el libro…</div>'; return; }
  let ids;
  if (query) {
    const q = query.toLowerCase();
    ids = [...data.defs.values()].filter(d => (d.name || '').toLowerCase().includes(q)
      || zonesOf(d.id).some(z => z.name.toLowerCase().includes(q))).map(d => d.id);
  } else {
    ids = (BEAST_GROUPS.find(g => g.id === tab)?.ids || []).filter(id => data.defs.has(id));
  }
  ids.sort((a, b) => npcCombatLevel(data.defs.get(a)) - npcCombatLevel(data.defs.get(b)));
  list.innerHTML = ids.length ? ids.map(rowHtml).join('') : '<div class="bst-msg">Ninguna criatura con ese nombre.</div>';
}

function ensureDom() {
  if (root) return;
  root = document.createElement('div');
  root.id = 'bestiaryOverlay';
  root.innerHTML = `
    <div class="bst-book" role="dialog" aria-label="Bestiario">
      <div class="bst-top">
        <div class="bst-title">📖 Bestiario de la isla</div>
        <button type="button" class="bst-x" aria-label="Cerrar">✕</button>
      </div>
      <input class="bst-q" type="search" placeholder="Buscar criatura o zona…" autocomplete="off">
      <div class="bst-tabs"></div>
      <div class="bst-list"></div>
    </div>`;
  const css = document.createElement('style');
  css.textContent = `
    #bestiaryOverlay { position: fixed; inset: 0; z-index: 9000; display: none; align-items: center; justify-content: center;
      background: rgba(0,0,0,0.55); }
    #bestiaryOverlay.visible { display: flex; }
    #bestiaryOverlay .bst-book { width: min(560px, calc(100vw - 16px)); height: min(720px, calc(100vh - 24px)); display: flex; flex-direction: column;
      background: linear-gradient(#4a3f30, #3a3124); border: 3px solid #c8a043; border-radius: 10px; color: #f3e6c4;
      box-shadow: 0 10px 40px rgba(0,0,0,0.7), inset 0 0 0 2px #2a2318; overflow: hidden; }
    #bestiaryOverlay .bst-top { display: flex; align-items: center; padding: 10px 12px 6px; }
    #bestiaryOverlay .bst-title { flex: 1; font-size: 19px; font-weight: 800; color: #ffd76a; text-shadow: 0 2px 0 #000; }
    #bestiaryOverlay .bst-x { font: inherit; font-size: 18px; width: 36px; height: 36px; border-radius: 8px; border: 2px solid #8a6a2a;
      background: #5a3e1a; color: #fff3cf; cursor: pointer; }
    #bestiaryOverlay .bst-q { margin: 0 12px 8px; padding: 8px 10px; font: inherit; font-size: 15px; border-radius: 8px;
      border: 2px solid #6a5530; background: #2a2318; color: #f3e6c4; outline: none; }
    #bestiaryOverlay .bst-q:focus { border-color: #c8a043; }
    #bestiaryOverlay .bst-tabs { display: flex; gap: 6px; padding: 0 12px 8px; overflow-x: auto; scrollbar-width: none; flex: 0 0 auto; }
    #bestiaryOverlay .bst-tab { font: inherit; font-size: 14px; font-weight: 700; padding: 6px 11px; border-radius: 16px; white-space: nowrap;
      border: 2px solid #6a5530; background: #2e271c; color: #d8c8a0; cursor: pointer; }
    #bestiaryOverlay .bst-tab.on { background: #c8a043; color: #2a1a00; border-color: #ffd76a; }
    #bestiaryOverlay .bst-list { flex: 1; overflow-y: auto; padding: 0 10px 12px; -webkit-overflow-scrolling: touch; }
    #bestiaryOverlay .bst-msg { padding: 24px; text-align: center; color: #cdbb90; }
    #bestiaryOverlay .bst-row { background: #2e271c; border: 1px solid #5a4a2a; border-radius: 8px; margin-bottom: 6px; }
    #bestiaryOverlay .bst-row.open { border-color: #c8a043; }
    #bestiaryOverlay .bst-head { display: flex; align-items: center; gap: 8px; padding: 8px 10px; cursor: pointer; }
    #bestiaryOverlay .bst-ic { font-size: 24px; width: 32px; text-align: center; flex: 0 0 auto; }
    #bestiaryOverlay .bst-main { flex: 1; min-width: 0; display: flex; flex-direction: column; }
    #bestiaryOverlay .bst-name { font-weight: 800; font-size: 15px; color: #fff3cf; }
    #bestiaryOverlay .bst-tag { font-size: 11px; font-weight: 700; color: #ffb060; }
    #bestiaryOverlay .bst-sub { font-size: 12px; color: #bfae86; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    #bestiaryOverlay .bst-lvl { font-weight: 800; color: #ffd76a; font-size: 14px; flex: 0 0 auto; }
    #bestiaryOverlay .bst-ag { font-size: 11px; font-weight: 800; padding: 3px 7px; border-radius: 10px; flex: 0 0 auto; }
    #bestiaryOverlay .bst-ag.ag { background: #7a1e14; color: #ffd0c0; }
    #bestiaryOverlay .bst-ag.pa { background: #2e5a24; color: #d8ffcc; }
    #bestiaryOverlay .bst-ag.boss { background: #5a1a6a; color: #f0d0ff; }
    #bestiaryOverlay .bst-body { padding: 4px 10px 10px; border-top: 1px dashed #5a4a2a; }
    #bestiaryOverlay .bst-stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; margin: 8px 0; }
    #bestiaryOverlay .bst-stats div { background: #241e15; border-radius: 6px; padding: 5px 4px; text-align: center; display: flex; flex-direction: column; }
    #bestiaryOverlay .bst-stats b { font-size: 14px; color: #fff3cf; }
    #bestiaryOverlay .bst-stats span { font-size: 11px; color: #bfae86; }
    #bestiaryOverlay .bst-k { margin: 10px 0 4px; font-weight: 800; color: #ffd76a; font-size: 13px; text-transform: uppercase; letter-spacing: .04em; }
    #bestiaryOverlay .bst-zone { margin-bottom: 6px; }
    #bestiaryOverlay .bst-zone-name { font-weight: 800; color: #fff3cf; }
    #bestiaryOverlay .bst-wild { font-size: 11px; background: #7a1e14; color: #ffd0c0; border-radius: 8px; padding: 1px 6px; margin-left: 4px; }
    #bestiaryOverlay .bst-zone-how { font-size: 13px; line-height: 1.35; color: #e8dbb8; }
    #bestiaryOverlay .bst-map { font: inherit; font-size: 13px; font-weight: 700; margin-top: 5px; padding: 5px 10px; border-radius: 7px;
      border: 2px solid #c8a043; background: #5a3e1a; color: #fff3cf; cursor: pointer; }
    #bestiaryOverlay .bst-loot { display: flex; flex-direction: column; gap: 3px; }
    #bestiaryOverlay .bst-li { display: flex; align-items: center; gap: 8px; font-size: 13px; }
    #bestiaryOverlay .bst-li-ic { width: 26px; height: 26px; display: inline-flex; align-items: center; justify-content: center; flex: 0 0 auto; }
    #bestiaryOverlay .bst-li-ic img, #bestiaryOverlay .bst-li-ic svg { width: 26px; height: 26px; }
    #bestiaryOverlay .bst-li-n { flex: 1; min-width: 0; }
    #bestiaryOverlay .bst-li-c { font-size: 12px; color: #cdbb90; white-space: nowrap; }
    #bestiaryOverlay .bst-li-c.al { color: #9fe08a; }
    #bestiaryOverlay .bst-li-c.ra { color: #ff9a6a; font-weight: 700; }
    @media (max-width: 420px) { #bestiaryOverlay .bst-stats { grid-template-columns: repeat(2, 1fr); } }`;
  root.appendChild(css);
  document.body.appendChild(root);

  root.addEventListener('pointerdown', (e) => { if (e.target === root) close(); });
  root.querySelector('.bst-x').addEventListener('click', close);
  root.querySelector('.bst-q').addEventListener('input', (e) => { query = e.target.value.trim(); openId = null; render(); });
  root.addEventListener('click', (e) => {
    const t = e.target.closest('[data-tab]');
    if (t) { tab = t.dataset.tab; query = ''; root.querySelector('.bst-q').value = ''; openId = null; render(); root.querySelector('.bst-list').scrollTop = 0; return; }
    const mx = e.target.closest('[data-mapx]');
    if (mx) { close(); window.__openMapAt?.(+mx.dataset.mapx, +mx.dataset.mapz, mx.dataset.mapn, 26); return; }
    const m = e.target.closest('[data-map]');
    if (m) {
      const z = HUNTING_ZONES.find(zz => zz.id === m.dataset.map);
      if (z) { close(); window.__openMapAt?.(z.x, z.z, z.name, z.r); }
      return;
    }
    const o = e.target.closest('[data-open]');
    if (o) {
      openId = openId === o.dataset.open ? null : o.dataset.open;
      render();
      if (openId) root.querySelector('.bst-row.open')?.scrollIntoView({ block: 'nearest' });
    }
  });
  // Que las teclas no muevan al personaje mientras escribes / lees
  root.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Escape') close(); });
}

/** Abrir el libro (opcional: directamente en una criatura). */
export async function open(defId = null) {
  ensureDom();
  root.classList.add('visible');
  if (defId) {
    openId = defId;
    const g = BEAST_GROUPS.find(gg => gg.ids.includes(defId));
    if (g) tab = g.id;
  }
  render();
  try {
    await load();
    render();
    if (openId) root.querySelector('.bst-row.open')?.scrollIntoView({ block: 'center' });
  } catch (err) {
    const list = root.querySelector('.bst-list');
    if (list) list.innerHTML = `<div class="bst-msg">No se pudo abrir el bestiario (${esc(err?.message || 'sin conexión')}).</div>`;
  }
}

export function close() { if (root) root.classList.remove('visible'); }
export function isOpen() { return !!root?.classList.contains('visible'); }

if (typeof window !== 'undefined') window.__bestiary = { open, close };
