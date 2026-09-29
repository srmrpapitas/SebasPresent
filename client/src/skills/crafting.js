/**
 * SebasPresent — Flechería y Artesanía (cliente) · Sesión 50
 *
 * Se abre desde la mochila (menú del objeto → "🏹 Flechería" / "🧵 Artesanía")
 * con las recetas donde interviene ese objeto. Bucle 1 / 5 / Todo como en
 * el yunque; cada vuelta es un POST /api/crafting/make.
 */

import * as api from '../api.js';
import * as skills from '../skills.js';
import * as inventory from '../inventory.js';
import * as audio from '../audio.js';
import { getItemIconHtml } from '../item_icons.js';
import { ensureCss } from './smithing.js';
import { RECIPES, RECIPES_BY_ID, SKILL_LABEL, TOOL_NAMES, recipesUsing, CRAFT_TICK_MS } from '../shared/crafting.js';

let feedLog = () => {};
let getCharacter = () => null;
let panelEl = null;
let work = null;
let workGen = 0;
let names = {};   // item_id → nombre (de la mochila; si no, el id)

export function start(opts = {}) {
  feedLog = opts.feedLog || (() => {});
  getCharacter = opts.getCharacter || (() => null);
  ensureCss();
  if (typeof window !== 'undefined') {
    window.__crafting = { open: openFor, debug: () => ({ work }) };
  }
}
export function stop() { stopWork('module_stop'); closePanel(); }
export function cancel(reason = 'external') { stopWork(reason); }
export function isBusy() { return !!work; }

function countItem(id) {
  let n = 0;
  for (const s of inventory.getState?.() || []) if (s && s.item_id === id) n += s.quantity || 1;
  return n;
}
function refreshNames() {
  for (const s of inventory.getState?.() || []) if (s?.item_id && s.name) names[s.item_id] = s.name;
}
const NICE = {
  logs: 'troncos', oak_logs: 'troncos de roble', willow_logs: 'troncos de sauce', maple_logs: 'troncos de arce',
  yew_logs: 'troncos de tejo', magic_logs: 'troncos mágicos', arrow_shaft: 'astiles', feather: 'plumas',
  headless_arrow: 'flechas sin punta', bowstring: 'cuerda', leather: 'cuero', cowhide: 'piel de vaca', thread: 'hilo',
};
const nameOf = (id) => NICE[id] || names[id] || id.replace(/_/g, ' ');

/** Etiqueta para el menú de la mochila, o null si el objeto no se usa en nada. */
export function menuLabelFor(itemId) {
  const rs = recipesUsing(itemId);
  if (!rs.length) return null;
  return rs[0].skill === 'fletching' ? '🏹 Flechería' : '🧵 Artesanía';
}

function closePanel() { if (panelEl) { panelEl.remove(); panelEl = null; } }

function maxTimes(rec) {
  let n = Infinity;
  for (const [id, q] of rec.in) n = Math.min(n, Math.floor(countItem(id) / q));
  return n;
}

export function openFor(itemId, onlySkill = null) {
  closePanel();
  refreshNames();
  let list = itemId ? recipesUsing(itemId) : RECIPES;
  if (onlySkill) list = list.filter(r => r.skill === onlySkill);
  if (!list.length) return;
  const skill = list[0].skill;
  const lvl = skills.getLevel?.(skill) ?? 1;
  let body = '';
  let group = null;
  for (const r of list) {
    const myLvl = skills.getLevel?.(r.skill) ?? 1;
    const locked = myLvl < r.level;
    const times = maxTimes(r);
    const noTool = r.tool && countItem(r.tool) < 1;
    const can = !locked && !noTool && times > 0;
    if (r.group !== group) { group = r.group; body += `<div class="craft-group">${group}</div>`; }
    const needs = r.in.map(([id, q]) => `${q} ${nameOf(id)} (${countItem(id)})`).join(' + ');
    body += `<div class="smith-row${locked ? ' locked' : ''}${can ? '' : ' empty'}">
      <span class="smith-icon">${getItemIconHtml(r.out[0], '🛠')}</span>
      <span class="smith-info"><b>${r.name}</b>
        <small>${locked ? '🔒 ' : ''}Nv ${r.level} · ${r.xp} XP · ${needs}${noTool ? ` · falta ${TOOL_NAMES[r.tool]}` : ''}</small></span>
      <span class="smith-btns">${can ?
        `<button data-k="${r.id}" data-n="1">1</button>
         ${times > 1 ? `<button data-k="${r.id}" data-n="5">5</button><button data-k="${r.id}" data-n="all">Todo</button>` : ''}` : ''}</span>
    </div>`;
  }
  const el = document.createElement('div');
  el.className = 'smith-panel';
  el.innerHTML = `<div class="smith-head"><span>${skill === 'fletching' ? '🏹' : '🧵'} ${SKILL_LABEL[skill]}</span>
      <small>Nivel ${lvl}</small><button class="smith-x" data-close="1">✕</button></div>
    <div class="smith-body">${body}</div>`;
  if (!document.getElementById('craft-css')) {
    const st = document.createElement('style');
    st.id = 'craft-css';
    st.textContent = `.craft-group { font-family: 'Cinzel', serif; font-size: 12px; color: #e8c560; margin: 8px 4px 2px; border-bottom: 1px solid rgba(200,160,67,0.3); }`;
    document.head.appendChild(st);
  }
  document.body.appendChild(el);
  panelEl = el;
  el.addEventListener('pointerdown', ev => ev.stopPropagation());
  el.addEventListener('pointerup', ev => {
    ev.stopPropagation();
    const t = ev.target.closest('[data-k],[data-close]');
    if (!t) return;
    closePanel();
    if (t.dataset.close) return;
    const n = t.dataset.n === 'all' ? 999 : Number(t.dataset.n);
    startWork(t.dataset.k, n);
  });
}

function startWork(recipeId, n) {
  const rec = RECIPES_BY_ID[recipeId];
  if (!rec) return;
  workGen++;
  work = { rec, remaining: n, lastAt: 0, waiting: false, gen: workGen, done: 0 };
  feedLog('info', rec.skill === 'fletching' ? 'Empiezas a trabajar la madera...' : 'Empiezas a coser...');
}

export function stopWork(reason = 'user') {
  if (!work) return;
  workGen++;
  work = null;
  if (reason !== 'user' && reason !== 'tap_ground') console.log('[crafting] stop:', reason);
}

function finish(msg) {
  if (msg) feedLog('info', msg);
  else if (work?.done) feedLog('info', 'Terminas el trabajo.');
  workGen++;
  work = null;
}

export function update() {
  if (!work) return;
  const now = performance.now();
  if (work.waiting || now - work.lastAt < CRAFT_TICK_MS) return;
  const rec = work.rec;
  if (maxTimes(rec) < 1) { finish(work.done ? 'Te has quedado sin materiales.' : 'Te faltan materiales.'); return; }
  work.lastAt = now;
  work.waiting = true;
  const gen = work.gen;
  audio.synth(rec.skill === 'fletching' ? 'wood_chop' : 'bury', { volume: 0.35, pitch: rec.skill === 'fletching' ? 1.8 : 1.4 });
  api.craftingMake(rec.id).then(async res => {
    if (!work || work.gen !== gen) return;
    work.waiting = false;
    if (!res?.ok) return;
    work.done++;
    work.remaining--;
    audio.synth('craft_done', { volume: 0.4 });
    try { await window.inventory?.refresh?.(); } catch {}
    try { await skills.reload(); } catch {}
    try { window.__spawnXpDrops?.({ [rec.skill]: res.xp_gained }); } catch {}
    feedLog('xp', `+${res.xp_gained} XP ${SKILL_LABEL[rec.skill]} (${rec.name})`);
    if (res.level_up) {
      feedLog('info', `¡Subes a nivel ${res.new_level} de ${SKILL_LABEL[rec.skill]}!`);
      try { window.__spawnLevelUpBanner?.(rec.skill, res.new_level); } catch {}
    }
    if (work && work.remaining <= 0) finish(null);
  }).catch(err => {
    if (!work || work.gen !== gen) return;
    work.waiting = false;
    if (err?.code === 'too_fast') return;
    finish(err?.message || 'No se pudo completar.');
  });
}
