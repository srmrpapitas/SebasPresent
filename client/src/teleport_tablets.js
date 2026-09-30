/**
 * SebasPresent — Romper tabletas de teletransporte (cliente) · Sesión 50
 *
 * breakTablet(slot): pide al server gastar la tableta (él decide el destino),
 * hace el efecto (runas violetas que suben + destello) y te mueve.
 * Se usa desde la mochila: tocar la tableta o menú → "💥 Romper".
 */
import * as THREE from 'three';
import * as api from './api.js';
import * as audio from './audio.js';
import { TABLETS, TABLET_CAST_MS } from './shared/teleports.js';

let scene = null, getPlayer = () => null, feedLog = () => {}, onBeforeTeleport = () => {}, onTeleported = () => {};
let busy = false;
const effects = [];

export function start(opts) {
  scene = opts.scene;
  getPlayer = opts.getPlayer || (() => null);
  feedLog = opts.feedLog || (() => {});
  onBeforeTeleport = opts.onBeforeTeleport || (() => {});
  onTeleported = opts.onTeleported || (() => {});
  if (typeof window !== 'undefined') window.__tablets = { breakTablet };
}

export function isBusy() { return busy; }

function spawnEffect(x, z, color) {
  if (!scene) return;
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  const c = new THREE.Color(color);
  const ringMat = new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending });
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.6, 0.85, 32), ringMat);
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.05;
  g.add(ring);
  const colMat = new THREE.MeshBasicMaterial({ color: 0xb080ff, transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
  const col = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.9, 3.2, 20, 1, true), colMat);
  col.position.y = 1.6;
  g.add(col);
  const sparks = [];
  const sparkGeo = new THREE.OctahedronGeometry(0.07, 0);
  for (let i = 0; i < 24; i++) {
    const m = new THREE.Mesh(sparkGeo, new THREE.MeshBasicMaterial({ color: i % 2 ? 0xd8b0ff : c, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    m.userData = { a: Math.random() * Math.PI * 2, r: 0.4 + Math.random() * 0.5, v: 1.2 + Math.random() * 1.6, y: Math.random() * 0.4 };
    g.add(m); sparks.push(m);
  }
  scene.add(g);
  effects.push({ g, ring, col, sparks, t: 0, life: 1.6 });
}

function flashScreen() {
  const d = document.createElement('div');
  d.style.cssText = 'position:fixed;inset:0;background:radial-gradient(circle,rgba(200,150,255,0.55),rgba(80,20,140,0.35));z-index:180;pointer-events:none;opacity:0;transition:opacity .25s';
  document.body.appendChild(d);
  requestAnimationFrame(() => { d.style.opacity = '1'; });
  setTimeout(() => { d.style.opacity = '0'; }, 380);
  setTimeout(() => d.remove(), 800);
}

export async function breakTablet(slot, itemId) {
  if (busy) return;
  const player = getPlayer?.();
  if (!player) return;
  busy = true;
  try {
    const res = await api.tabletBreak(slot);
    if (!res?.ok) { busy = false; return; }
    const tab = TABLETS[res.tablet] || { color: '#b080ff' };
    try { onBeforeTeleport(); } catch {}
    feedLog('info', `💥 Rompes la tableta… ¡${res.name}!`);
    try { audio.synth?.('pray_on', { volume: 0.8, pitch: 0.8 }); } catch {}
    spawnEffect(player.position.x, player.position.z, tab.color);
    try { window.__playerGather?.('kneel', 900); } catch {}
    try { await window.inventory?.refresh?.(); } catch {}
    setTimeout(() => {
      flashScreen();
      const p = getPlayer?.();
      if (p) { p.position.x = res.x; p.position.z = res.z; }
      try { onTeleported(res); } catch (e) { console.warn('[tablets] onTeleported:', e); }
      spawnEffect(res.x, res.z, tab.color);
      try { audio.synth?.('altar', { volume: 0.7 }); } catch {}
      busy = false;
    }, TABLET_CAST_MS);
  } catch (err) {
    busy = false;
    feedLog('error', err?.message || 'No se pudo usar la tableta.');
  }
}

export function update(dt) {
  for (let i = effects.length - 1; i >= 0; i--) {
    const e = effects[i];
    e.t += dt;
    const k = e.t / e.life;
    e.ring.scale.setScalar(1 + k * 1.5);
    e.ring.material.opacity = 0.9 * (1 - k);
    e.col.material.opacity = 0.35 * Math.sin(Math.min(1, k) * Math.PI);
    e.col.rotation.y += dt * 2;
    for (const s of e.sparks) {
      const u = s.userData;
      u.a += dt * 3;
      u.y += dt * u.v;
      s.position.set(Math.cos(u.a) * u.r, u.y, Math.sin(u.a) * u.r);
      s.material.opacity = Math.max(0, 1 - k);
    }
    if (e.t >= e.life) { scene?.remove(e.g); effects.splice(i, 1); }
  }
}
