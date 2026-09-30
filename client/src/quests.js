/**
 * SebasPresent — Misiones (cliente) · Sesión 50
 *
 *   - Rastreador arriba a la izquierda: paso actual + progreso (toca para ver el consejo).
 *   - Haz de luz dorado en el mundo + marca en el minimapa donde tienes que ir.
 *   - Pestaña "Misiones" del sidebar: lista de pasos (✓ / ► / ○), recompensas
 *     y botón para saltar el tutorial.
 *   - Detecta los avances en snapshot.me.quests (el server es quien avanza)
 *     y lo celebra con aviso + sonido.
 *
 * Uso: quests.start({ scene, getSnapshot, getPlayer, feedLog }); quests.update(dt); quests.stop();
 *      quests.getHintPos() → {x,z}|null (minimapa)
 */

import * as THREE from 'three';
import * as api from './api.js';
import * as audio from './audio.js';
import { QUESTS, QUEST_ORDER } from './shared/quests.js';
import { nearestBankChest } from './shared/banks.js';   // Sesión 50
import { TOWN_NPCS_BY_ID } from './shared/town_npcs.js';  // Sesión 50

let scene = null, getSnapshot = () => null, getPlayer = () => null, feedLog = () => {};
let started = false;
let state = {};            // quest_id → { step, progress, status }
let trackerEl = null;
let expanded = false;
let beam = null;
let hintPos = null;
let syncTimer = 0;
let timeAcc = 0;

function esc(s) { return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

// ------------------------------------------------------------
// API
// ------------------------------------------------------------
export async function start(opts) {
  if (started) stop();
  scene = opts.scene;
  getSnapshot = opts.getSnapshot || (() => null);
  getPlayer = opts.getPlayer || (() => null);
  feedLog = opts.feedLog || (() => {});
  started = true;
  ensureCss();
  buildBeam();
  try {
    const r = await api.questsGet();
    applyRows(r?.quests || [], false);
  } catch (e) {
    console.warn('[quests] GET falló:', e?.message);
  }
  render();
  if (typeof window !== 'undefined') window.__questsDebug = () => ({ state, hintPos });
}

export function stop() {
  if (!started) return;
  trackerEl?.remove(); trackerEl = null;
  if (beam) { scene?.remove(beam.group); beam = null; }
  started = false;
}

export function getHintPos() { return hintPos; }

// ------------------------------------------------------------
// Estado
// ------------------------------------------------------------
// Sesión 50 — con varias misiones a la vez, el rastreador enseña la que
// hayas fijado en la pestaña (toque en la tarjeta) o la última que avanzó.
let trackedId = null;
function activeQuest() {
  if (trackedId && state[trackedId]?.status === 0) return { q: QUESTS[trackedId], s: state[trackedId] };
  let best = null;
  for (const id of QUEST_ORDER) {
    const s = state[id];
    if (!s || s.status !== 0) continue;
    if (!best || (s.updatedAt || 0) > (best.s.updatedAt || 0)) best = { q: QUESTS[id], s };
  }
  return best;
}

/** Sesión 50 — estado de una misión: null (sin empezar) | { step, progress, status } */
export function getQuestState(id) { return state[id] || null; }
/** Sesión 50 — aplicar filas que devuelve el server tras hablar/aceptar/entregar. */
export function applyServerRows(rows) { applyRows(rows || [], true); }
/** Sesión 50 — fijar misión en el rastreador. */
export function track(id) { trackedId = id; render(); }

function applyRows(rows, announce) {
  for (const r of rows) {
    const q = QUESTS[r.quest_id];
    if (!q) continue;
    const prev = state[r.quest_id];
    state[r.quest_id] = { step: r.step, progress: r.progress, status: r.status, updatedAt: r.updated_at || Date.now() };
    if (!announce || !prev) continue;
    if (r.status === 1 && prev.status === 0) {
      const last = q.steps[prev.step];
      if (last) feedLog('info', `✅ ${last.text}`);
      feedLog('info', `🏆 ¡Misión completada: ${q.name}! Recompensa: ${q.reward?.text || ''}`);
      audio.synth?.('mine_ore', { volume: 0.8 });
      setTimeout(() => audio.synth?.('craft_done', { volume: 0.8 }), 250);
      celebrate(`¡${q.name} completada!`);
    } else if (r.step > prev.step) {
      const done = q.steps[prev.step];
      const next = q.steps[r.step];
      if (done) feedLog('info', `✅ ${done.text}${done.reward?.coins ? ` (+${done.reward.coins} monedas)` : ''}`);
      if (next) feedLog('info', `📜 Siguiente: ${next.text}`);
      audio.synth?.('craft_done', { volume: 0.7 });
      celebrate('Paso completado');
      expanded = true;
    } else if (r.progress !== prev.progress) {
      pulse();
    }
  }
  render();
}

// ------------------------------------------------------------
// UI: rastreador + pestaña
// ------------------------------------------------------------
function render() {
  renderTracker();
  renderTab();
}

function renderTracker() {
  const a = activeQuest();
  if (!a) { trackerEl?.remove(); trackerEl = null; return; }
  const step = a.q.steps[a.s.step];
  if (!step) return;
  if (!trackerEl) {
    trackerEl = document.createElement('div');
    trackerEl.className = 'quest-tracker';
    trackerEl.addEventListener('pointerup', (ev) => {
      ev.preventDefault(); ev.stopPropagation();
      expanded = !expanded; renderTracker();
    });
    trackerEl.addEventListener('pointerdown', ev => ev.stopPropagation());
    document.body.appendChild(trackerEl);
  }
  const prog = step.count > 1 ? ` <span class="qt-prog">${a.s.progress}/${step.count}</span>` : '';
  trackerEl.innerHTML = `
    <div class="qt-title">📜 ${esc(a.q.name)} <span class="qt-step">${a.s.step + 1}/${a.q.steps.length}</span></div>
    <div class="qt-text">${esc(step.text)}${prog}</div>
    ${expanded && step.tip ? `<div class="qt-tip">💡 ${esc(step.tip)}</div>` : ''}`;
}

function pulse() {
  if (!trackerEl) return;
  trackerEl.classList.remove('qt-pulse');
  void trackerEl.offsetWidth;
  trackerEl.classList.add('qt-pulse');
}

function celebrate(text) {
  const el = document.createElement('div');
  el.className = 'quest-celebrate';
  el.textContent = text;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2600);
  pulse();
}

function renderTab() {
  const pane = document.querySelector('.osrs-tab-pane[data-tab="quest"]');
  if (!pane) return;
  let html = '<div class="quest-tab">';
  const act = activeQuest();
  // Orden: en curso → sin empezar → terminadas
  const rank = (id) => (state[id]?.status === 0 ? 0 : !state[id] ? 1 : 2);
  const ids = QUEST_ORDER.slice().sort((a, b) => rank(a) - rank(b));
  const nDone = QUEST_ORDER.filter(id => state[id]?.status === 1).length;
  html += `<div class="qtab-count">Misiones completadas: <b>${nDone}/${QUEST_ORDER.length}</b></div>`;
  for (const id of ids) {
    const q = QUESTS[id];
    const s = state[id];
    const done = s?.status === 1;
    if (!s) {
      // Sin empezar (Sesión 50): dónde conseguirla
      const giver = TOWN_NPCS_BY_ID[q.giver];
      html += `<div class="qtab-card qtab-new"><div class="qtab-name">❗ ${esc(q.name)}</div>
        <div class="qtab-sum">${esc(q.summary)}</div>
        <div class="qtab-giver">Habla con <b>${esc(giver?.name || '?')}</b>${giver?.title ? ` (${esc(giver.title)})` : ''} para empezarla.</div></div>`;
      continue;
    }
    const isTracked = act && act.q.id === id;
    html += `<div class="qtab-card${done ? ' qtab-done' : ''}${isTracked ? ' qtab-tracked' : ''}" data-track="${done ? '' : id}"><div class="qtab-name">${done ? '✅' : isTracked ? '📍' : '📜'} ${esc(q.name)}</div>
      <div class="qtab-sum">${esc(q.summary)}</div><ol class="qtab-steps">`;
    q.steps.forEach((st, i) => {
      const cls = done || (s && i < s.step) ? 'done' : (s && i === s.step ? 'cur' : '');
      const mark = cls === 'done' ? '✓' : cls === 'cur' ? '►' : '○';
      const prog = cls === 'cur' && st.count > 1 ? ` (${s.progress}/${st.count})` : '';
      html += `<li class="${cls}"><span>${mark}</span> ${esc(st.text)}${prog}</li>`;
    });
    html += `</ol><div class="qtab-rew">🎁 ${esc(q.reward?.text || '')}</div>`;
    if (s && !done && id === 'tutorial') html += `<button class="qtab-skip" data-skip="${id}">Saltar tutorial</button>`;
    html += '</div>';
  }
  html += '</div>';
  pane.innerHTML = html;
  pane.querySelectorAll('[data-track]').forEach(card => {
    if (!card.dataset.track) return;
    card.addEventListener('pointerup', (ev) => {
      if (ev.target.closest('[data-skip]')) return;
      track(card.dataset.track);
    });
  });
  const btn = pane.querySelector('[data-skip]');
  btn?.addEventListener('pointerup', async (ev) => {
    ev.preventDefault(); ev.stopPropagation();
    if (!confirm('¿Saltar el tutorial? No recibirás la recompensa final.')) return;
    try { const r = await api.questsSkip(btn.dataset.skip); applyRows(r?.quests || [], false); } catch {}
  });
}

// ------------------------------------------------------------
// Haz de luz del objetivo
// ------------------------------------------------------------
function buildBeam() {
  if (!scene) return;
  const group = new THREE.Group();
  const beamMat = new THREE.MeshBasicMaterial({ color: 0xffd35a, transparent: true, opacity: 0.28, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
  const col = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.9, 26, 16, 1, true), beamMat);
  col.position.y = 13;
  group.add(col);
  const ringMat = new THREE.MeshBasicMaterial({ color: 0xffe07a, transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide });
  const ring = new THREE.Mesh(new THREE.RingGeometry(1.1, 1.35, 32), ringMat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.06;
  group.add(ring);
  const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.45, 0.9, 4), new THREE.MeshBasicMaterial({ color: 0xffd35a }));
  arrow.rotation.x = Math.PI;
  group.add(arrow);
  group.visible = false;
  scene.add(group);
  beam = { group, ring, arrow, col };
}

function computeHint() {
  const a = activeQuest();
  const step = a?.q.steps[a.s.step];
  const h = step?.hint;
  if (!h) return null;
  if (Number.isFinite(h.x)) return { x: h.x, z: h.z };
  if (h.npc) {
    const snap = getSnapshot?.();
    const p = getPlayer?.();
    let best = null, bd = Infinity;
    for (const n of snap?.npcs || []) {
      if (n.def_id !== h.npc) continue;
      const d = p ? Math.hypot(n.x - p.position.x, n.z - p.position.z) : 0;
      if (d < bd) { bd = d; best = n; }
    }
    return best ? { x: best.x, z: best.z } : null;
  }
  if (h.talk) {   // Sesión 50 — el NPC con el que hay que hablar
    const n = TOWN_NPCS_BY_ID[h.talk];
    return n ? { x: n.x, z: n.z } : null;
  }
  if (h.bank) {   // Sesión 50 — el cofre de banco más cercano
    const p = getPlayer?.();
    const b = p ? nearestBankChest(p.position.x, p.position.z) : null;
    return b ? { x: b.x, z: b.z } : null;
  }
  return null;
}

export function update(dt) {
  if (!started) return;
  timeAcc += dt;
  syncTimer += dt;
  if (syncTimer >= 0.5) {
    syncTimer = 0;
    const rows = getSnapshot?.()?.me?.quests;
    if (Array.isArray(rows) && rows.length) {
      const changed = rows.some(r => {
        const s = state[r.quest_id];
        return !s || s.step !== r.step || s.progress !== r.progress || s.status !== r.status;
      });
      if (changed) applyRows(rows, true);
    }
    hintPos = computeHint();
  }
  if (beam) {
    const p = getPlayer?.();
    const near = hintPos && p && Math.hypot(hintPos.x - p.position.x, hintPos.z - p.position.z) < 4;
    beam.group.visible = !!hintPos && !near;
    if (hintPos) {
      beam.group.position.set(hintPos.x, 0, hintPos.z);
      beam.ring.scale.setScalar(1 + 0.25 * Math.sin(timeAcc * 3));
      beam.arrow.position.y = 3.2 + Math.sin(timeAcc * 2.5) * 0.35;
      beam.arrow.rotation.y = timeAcc * 1.5;
      beam.col.material.opacity = 0.2 + 0.08 * Math.sin(timeAcc * 2);
    }
  }
}

// ------------------------------------------------------------
// CSS
// ------------------------------------------------------------
function ensureCss() {
  if (document.getElementById('quest-css')) return;
  const st = document.createElement('style');
  st.id = 'quest-css';
  st.textContent = `
    .quest-tracker { position: fixed; top: calc(env(safe-area-inset-top, 0px) + 58px); left: 10px; z-index: 40;
      max-width: min(62vw, 300px); background: rgba(20,14,8,0.82); border: 1px solid #c8a043; border-radius: 6px;
      padding: 6px 9px; color: #f0e0b0; font-family: 'IM Fell English', serif; box-shadow: 0 3px 10px rgba(0,0,0,0.5);
      user-select: none; -webkit-user-select: none; }
    .quest-tracker .qt-title { font-family: 'Cinzel', serif; font-size: 11px; font-weight: 700; color: #e8c560; text-shadow: 1px 1px 0 #000; }
    .quest-tracker .qt-step { color: #bba878; font-weight: 400; }
    .quest-tracker .qt-text { font-size: 13px; line-height: 1.25; margin-top: 2px; text-shadow: 1px 1px 0 #000; }
    .quest-tracker .qt-prog { color: #9fe07a; font-weight: 700; }
    .quest-tracker .qt-tip { font-size: 12px; color: #d8c89a; margin-top: 4px; border-top: 1px solid rgba(200,160,67,0.3); padding-top: 4px; }
    .quest-tracker.qt-pulse { animation: qtPulse .6s ease-out; }
    @keyframes qtPulse { 0% { box-shadow: 0 0 0 0 rgba(255,211,90,0.9); } 100% { box-shadow: 0 0 0 14px rgba(255,211,90,0); } }
    .quest-celebrate { position: fixed; left: 50%; top: 28%; transform: translateX(-50%); z-index: 220; pointer-events: none;
      font-family: 'Cinzel', serif; font-weight: 900; font-size: 22px; color: #ffe07a; text-shadow: 2px 2px 0 #000, 0 0 14px rgba(255,200,80,0.8);
      animation: qCel 2.6s ease-out forwards; white-space: nowrap; }
    @keyframes qCel { 0% { opacity: 0; transform: translate(-50%, 10px) scale(.8); } 15% { opacity: 1; transform: translate(-50%, 0) scale(1.05); }
      75% { opacity: 1; } 100% { opacity: 0; transform: translate(-50%, -20px); } }
    .quest-tab { padding: 6px; color: #f0e0b0; font-family: 'IM Fell English', serif; }
    .qtab-card { background: rgba(0,0,0,0.25); border: 1px solid rgba(200,160,67,0.4); border-radius: 5px; padding: 8px; }
    .qtab-card.qtab-tracked { border-color: #ffd35a; box-shadow: 0 0 8px rgba(255,211,90,0.35); }
    .qtab-card.qtab-done { opacity: 0.6; }
    .qtab-card.qtab-new { border-style: dashed; }
    .qtab-giver { font-size: 11px; color: #ffe27a; margin-top: 4px; }
    .qtab-count { font-size: 11px; color: #d8c89a; margin: 0 0 6px; text-align: center; }
    .qtab-name { font-family: 'Cinzel', serif; font-weight: 700; color: #e8c560; font-size: 14px; }
    .qtab-sum { font-size: 12px; color: #bba878; margin: 4px 0 6px; }
    .qtab-steps { list-style: none; padding: 0; margin: 0; font-size: 12.5px; }
    .qtab-steps li { padding: 3px 0; opacity: 0.6; display: flex; gap: 6px; }
    .qtab-steps li.done { opacity: 0.75; color: #9fe07a; text-decoration: line-through; }
    .qtab-steps li.cur { opacity: 1; color: #fff0c8; font-weight: 700; }
    .qtab-rew { font-size: 12px; margin-top: 6px; color: #e8c560; }
    .qtab-skip { margin-top: 8px; background: none; border: 1px solid #7a6030; color: #bba878; border-radius: 4px; padding: 4px 8px; font-size: 11px; }
  `;
  document.head.appendChild(st);
}
