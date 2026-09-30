/**
 * SebasPresent — Plegaria (cliente) · Sesión 50
 *
 *   - Pestaña "Plegarias": rejilla de plegarias (bloqueadas / disponibles /
 *     activas), barra de puntos y consejo de cómo subir la skill.
 *   - HUD: el orbe de plegaria muestra los puntos reales (con el gasto en vivo).
 *   - Altares en el mundo: tocar → caminar → recargar puntos.
 *   - Aura dorada a los pies del personaje mientras rezas.
 *   - buryFromSlot(slot): enterrar huesos (lo usa el inventario).
 *
 * Estado: snapshot.me.{prayer_points, prayer_updated_at, active_prayers}
 * (el server es la verdad) + respuesta inmediata de /toggle para no esperar.
 */

import { PROTECT_SVG } from './overhead.js';   // Sesión 50
import * as THREE from 'three';
import * as api from './api.js';
import * as skills from './skills.js';
import * as audio from './audio.js';
import {
  PRAYERS, PRAYERS_BY_ID, ALTARS, currentPrayerState, parseActive, drainPerMin, overheadPrayer,
} from './shared/prayer.js';

const USE_DIST_M = 3.2;
const APPROACH_DIST_M = 2.4;

let scene = null, getPlayer = () => null, getCharacter = () => null, getSnapshot = () => null;
let setPlayerTargetCb = () => {}, feedLog = () => {};
let started = false;
let st = { points: null, updatedAt: 0, active: '', localUntil: 0 };
let syncTimer = 0, timeAcc = 0;
let pendingAltar = null;
const altarObjs = [];
const pickMeshes = [];
let aura = null;
let lastRenderKey = '';
let busyToggle = false;

// ------------------------------------------------------------
// Estado
// ------------------------------------------------------------
function level() { return skills.getLevel?.('prayer') ?? 1; }

function live() {
  const lvl = level();
  const pts = st.points == null ? lvl : Math.min(lvl, st.points);
  return currentPrayerState(pts, st.updatedAt, st.active, Date.now());
}

/** Sesión 50 — plegaria que se ve sobre tu cabeza. */
export function getOverheadPrayer() {
  try { return overheadPrayer(live().active); } catch { return null; }
}

function applyServer(obj) {
  st.points = obj.prayer_points;
  st.updatedAt = obj.updated_at ?? obj.prayer_updated_at ?? Date.now();
  st.active = Array.isArray(obj.active_prayers) ? obj.active_prayers.join(',') : (obj.active_prayers || '');
}

// ------------------------------------------------------------
// API pública
// ------------------------------------------------------------
export function start(opts) {
  if (started) stop();
  scene = opts.scene;
  getPlayer = opts.getPlayer || (() => null);
  getCharacter = opts.getCharacter || (() => null);
  getSnapshot = opts.getSnapshot || (() => null);
  setPlayerTargetCb = opts.setPlayerTarget || (() => {});
  feedLog = opts.feedLog || (() => {});
  ensureCss();
  buildAltars();
  buildAura();
  started = true;
  render(true);
  if (typeof window !== 'undefined') {
    window.__prayer = { buryFromSlot, applyServer, state: () => ({ ...st, live: live() }) };
  }
}

export function stop() {
  if (!started) return;
  for (const o of altarObjs) scene?.remove(o.group);
  altarObjs.length = 0; pickMeshes.length = 0;
  if (aura) { scene?.remove(aura.group); aura = null; }
  started = false;
}

export function registerKeepouts(terrain) {
  for (const a of ALTARS) { try { terrain.addKeepout?.(a.x, a.z, 4); terrain.clearTreesNear?.(a.x, a.z, 4); } catch {} }
}

export function getAltarsForMinimap() { return ALTARS.map(a => ({ x: a.x, z: a.z, color: '#9fe8ff' })); }

/** Enterrar el hueso del slot (menú del inventario o toque simple). */
export async function buryFromSlot(slot) {
  try {
    try { window.__playerGather?.('kneel', 900); } catch {}
    const res = await api.prayerBury(slot);
    if (!res?.ok) return false;
    audio.synth?.('bury');
    feedLog('xp', `+${res.xp_gained} XP Plegaria (entierras los huesos)`);
    try { window.__spawnXpDrops?.({ prayer: res.xp_gained }); } catch {}
    if (res.level_up) {
      feedLog('info', `¡Subes a nivel ${res.new_level} de Plegaria!`);
      try { window.__spawnLevelUpBanner?.('prayer', res.new_level); } catch {}
    }
    try { await skills.reload(); } catch {}
    try { await window.inventory?.refresh?.(); } catch {}
    render(true);
    return true;
  } catch (err) {
    if (err?.code === 'too_fast') return false;
    feedLog('error', err?.message || 'No se pudo enterrar.');
    return false;
  }
}

async function toggle(id) {
  if (busyToggle) return;
  const p = PRAYERS_BY_ID[id];
  if (!p) return;
  if (level() < p.level) { feedLog('error', `Necesitas nivel ${p.level} de Plegaria.`); return; }
  busyToggle = true;
  try {
    const res = await api.prayerToggle(id);
    if (res?.ok) {
      applyServer(res);
      st.localUntil = Date.now() + 1500;   // no pisar con un snapshot más viejo
      const on = res.active_prayers.includes(id);
      audio.synth?.(on ? 'pray_on' : 'pray_off');
      render(true);
    }
  } catch (err) {
    feedLog('error', err?.message || 'No se pudo activar.');
  } finally {
    busyToggle = false;
  }
}

// ------------------------------------------------------------
// Pestaña + HUD
// ------------------------------------------------------------
function render(force = false) {
  const lv = live();
  const lvl = level();
  const key = `${lvl}|${lv.active.join(',')}|${Math.ceil(lv.points)}`;
  const hud = document.getElementById('hudPrayerValue');
  if (hud) hud.textContent = String(Math.ceil(lv.points));
  if (!force && key === lastRenderKey) return;
  lastRenderKey = key;

  const pane = document.querySelector('.osrs-tab-pane[data-tab="prayer"]');
  if (!pane) return;
  const drain = drainPerMin(lv.active);
  const mins = drain > 0 ? lv.points / drain : null;
  let html = `<div class="pr-root">
    <div class="pr-head"><span>✦ Plegarias</span><small>Nivel ${lvl}</small></div>
    <div class="pr-bar"><i style="width:${Math.max(0, Math.min(100, lv.points / Math.max(1, lvl) * 100))}%"></i>
      <span>${Math.ceil(lv.points)} / ${lvl}${mins != null ? ` · ~${mins < 1 ? '<1' : Math.floor(mins)} min` : ''}</span></div>
    <div class="pr-grid">`;
  for (const p of PRAYERS) {
    const locked = lvl < p.level;
    const on = lv.active.includes(p.id);
    html += `<button class="pr-cell${locked ? ' locked' : ''}${on ? ' on' : ''}" data-pr="${p.id}" title="${p.name}">
      <span class="pr-ico">${PROTECT_SVG[p.id] ? `<span class="pr-svg">${PROTECT_SVG[p.id]}</span>` : p.icon}</span><span class="pr-lvl">${locked ? '🔒' : ''}${p.level}</span></button>`;
  }
  html += `</div><div class="pr-info" id="prInfo">Toca una plegaria para activarla. Entierra huesos para subir de nivel y recarga puntos en un altar.</div></div>`;
  pane.innerHTML = html;
  pane.querySelectorAll('[data-pr]').forEach(b => {
    b.addEventListener('pointerup', ev => {
      ev.preventDefault(); ev.stopPropagation();
      const p = PRAYERS_BY_ID[b.dataset.pr];
      const info = pane.querySelector('#prInfo');
      if (info && p) info.innerHTML = `<b>${p.name}</b> · nivel ${p.level}<br>${p.desc} · gasta ${p.drain} puntos/min`;
      toggle(b.dataset.pr);
    });
  });
}

// ------------------------------------------------------------
// Altares
// ------------------------------------------------------------
function buildAltars() {
  if (!scene) return;
  const stone = new THREE.MeshLambertMaterial({ color: 0xcfc6b8, flatShading: true });
  const dark = new THREE.MeshLambertMaterial({ color: 0x8a8174, flatShading: true });
  const cloth = new THREE.MeshLambertMaterial({ color: 0x3a4f9a, flatShading: true });
  const glowMat = new THREE.MeshBasicMaterial({ color: 0x9fe8ff, transparent: true, opacity: 0.85 });
  const hitMat = new THREE.MeshBasicMaterial({ visible: false });
  for (const a of ALTARS) {
    const g = new THREE.Group();
    g.position.set(a.x, 0, a.z);
    const step = new THREE.Mesh(new THREE.BoxGeometry(3.0, 0.25, 2.2), dark); step.position.y = 0.125; g.add(step);
    const base = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.9, 1.3), stone); base.position.y = 0.7; g.add(base);
    const top = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.15, 1.5), stone); top.position.y = 1.22; g.add(top);
    const runner = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.02, 1.52), cloth); runner.position.y = 1.31; g.add(runner);
    const drape = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.6, 0.02), cloth); drape.position.set(0, 1.0, 0.76); g.add(drape);
    for (const sx of [-1, 1]) {
      const c = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.35, 8), new THREE.MeshLambertMaterial({ color: 0xf2ead8 }));
      c.position.set(sx * 0.9, 1.47, 0); g.add(c);
      const f = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.14, 6), new THREE.MeshBasicMaterial({ color: 0xffc860 }));
      f.position.set(sx * 0.9, 1.72, 0); g.add(f);
    }
    // Símbolo que flota y gira
    const sym = new THREE.Mesh(new THREE.OctahedronGeometry(0.28, 0), glowMat);
    sym.position.y = 2.1; g.add(sym);
    const light = new THREE.PointLight(0x9fe8ff, 0.8, 7, 1.8); light.position.y = 2.1; g.add(light);
    const hit = new THREE.Mesh(new THREE.CylinderGeometry(1.8, 1.8, 2.6, 8), hitMat);
    hit.position.y = 1.3; hit.userData = { kind: 'altar', altarId: a.id }; g.add(hit);
    scene.add(g);
    pickMeshes.push(hit);
    altarObjs.push({ a, group: g, sym, light });
  }
}

function altarUnderRay(raycaster) {
  if (!started) return null;
  const hits = raycaster.intersectObjects(pickMeshes, false);
  if (!hits.length) return null;
  return ALTARS.find(a => a.id === hits[0].object.userData?.altarId) || null;
}

function goAltar(a) {
  const p = getPlayer?.();
  if (!p) return;
  const dx = p.position.x - a.x, dz = p.position.z - a.z;
  const d = Math.hypot(dx, dz);
  if (d > USE_DIST_M) {
    setPlayerTargetCb(a.x + (dx / (d || 1)) * APPROACH_DIST_M, a.z + (dz / (d || 1)) * APPROACH_DIST_M);
    pendingAltar = a;
  } else {
    recharge(a);
  }
}

async function recharge(a) {
  try {
    try { window.__playerGather?.('kneel', 1200); } catch {}
    const res = await api.prayerRecharge(a.id);
    if (res?.ok) {
      applyServer(res);
      st.localUntil = Date.now() + 1500;
      audio.synth?.('altar');
      feedLog('info', `✦ Rezas en el altar. Puntos de plegaria: ${res.prayer_max}.`);
      render(true);
    }
  } catch (err) {
    feedLog('error', err?.message || 'No se pudo rezar.');
  }
}

export function tryHandleTap(raycaster) {
  const a = altarUnderRay(raycaster);
  if (!a) return false;
  goAltar(a);
  return true;
}

export function openActionMenuAt(raycaster, cx, cy, openMenu) {
  const a = altarUnderRay(raycaster);
  if (!a) return false;
  openMenu(a.name, [
    { label: '✦ Rezar', onPick: () => goAltar(a) },
    { label: '🔍 Examinar', onPick: () => feedLog('info', `${a.name}: recarga tus puntos de plegaria.`) },
  ], cx, cy);
  return true;
}

export function cancel() { pendingAltar = null; }

// ------------------------------------------------------------
// Aura
// ------------------------------------------------------------
function buildAura() {
  if (!scene) return;
  const g = new THREE.Group();
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.55, 0.75, 32),
    new THREE.MeshBasicMaterial({ color: 0xffe07a, transparent: true, opacity: 0.5, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }));
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.05;
  g.add(ring);
  g.visible = false;
  scene.add(g);
  aura = { group: g, ring };
}

// ------------------------------------------------------------
// Tick
// ------------------------------------------------------------
export function update(dt) {
  if (!started) return;
  timeAcc += dt;
  syncTimer += dt;
  if (syncTimer >= 0.5) {
    syncTimer = 0;
    const me = getSnapshot?.()?.me;
    if (me && 'prayer_points' in me && Date.now() > st.localUntil) {
      st.points = me.prayer_points;
      st.updatedAt = me.prayer_updated_at || 0;
      st.active = me.active_prayers || '';
    }
    const before = parseActive(st.active).length;
    render(false);
    // Aviso cuando se acaban los puntos
    if (before > 0 && live().active.length === 0 && !st._warned) {
      st._warned = true;
      feedLog('warning', '✦ Te has quedado sin puntos de plegaria. Recarga en un altar.');
      audio.synth?.('pray_off');
    }
    if (live().active.length > 0) st._warned = false;
  }
  for (const o of altarObjs) {
    o.sym.rotation.y = timeAcc * 1.2;
    o.sym.position.y = 2.1 + Math.sin(timeAcc * 1.6) * 0.08;
    o.light.intensity = 0.7 + Math.sin(timeAcc * 2.1) * 0.15;
  }
  const p = getPlayer?.();
  if (aura && p) {
    const on = live().active.length > 0;
    aura.group.visible = on;
    if (on) {
      aura.group.position.set(p.position.x, 0, p.position.z);
      aura.ring.material.opacity = 0.35 + 0.2 * Math.sin(timeAcc * 3);
      aura.ring.rotation.z = timeAcc * 0.8;
    }
  }
  if (pendingAltar && p && Math.hypot(p.position.x - pendingAltar.x, p.position.z - pendingAltar.z) <= USE_DIST_M) {
    const a = pendingAltar; pendingAltar = null; recharge(a);
  }
}

// ------------------------------------------------------------
// CSS
// ------------------------------------------------------------
function ensureCss() {
  if (document.getElementById('prayer-css')) return;
  const s = document.createElement('style');
  s.id = 'prayer-css';
  s.textContent = `
    .pr-root { padding: 6px; color: #f0e0b0; font-family: 'IM Fell English', serif; }
    .pr-head { display: flex; justify-content: space-between; align-items: baseline; font-family: 'Cinzel', serif; font-weight: 700; color: #e8c560; }
    .pr-head small { font-family: inherit; font-weight: 400; color: #bba878; font-size: 11px; }
    .pr-bar { position: relative; height: 16px; margin: 6px 0; background: rgba(0,0,0,0.45); border: 1px solid #7a6030; border-radius: 4px; overflow: hidden; }
    .pr-bar i { display: block; height: 100%; background: linear-gradient(90deg, #3aa0c8, #9fe8ff); }
    .pr-bar span { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; font-size: 11px; color: #fff; text-shadow: 1px 1px 0 #000; }
    .pr-grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 4px; }
    .pr-cell { position: relative; aspect-ratio: 1; background: rgba(0,0,0,0.3); border: 1px solid #5a4520; border-radius: 5px; color: inherit; padding: 0; }
    .pr-cell .pr-ico { font-size: 20px; }
    .pr-cell .pr-svg { display: inline-block; width: 24px; height: 24px; vertical-align: middle; }
    .pr-cell .pr-svg svg { width: 100%; height: 100%; }
    .pr-cell .pr-lvl { position: absolute; right: 2px; bottom: 1px; font-size: 9px; color: #d8c89a; }
    .pr-cell.locked { opacity: 0.35; filter: grayscale(1); }
    .pr-cell.on { background: radial-gradient(circle, rgba(255,224,122,0.55), rgba(120,90,20,0.4)); border-color: #ffe07a; box-shadow: 0 0 8px rgba(255,224,122,0.8); }
    .pr-info { margin-top: 6px; font-size: 11.5px; color: #d8c89a; min-height: 30px; }
  `;
  document.head.appendChild(s);
}
