/**
 * SebasPresent — Cofres de banco en el mundo (Sesión 50)
 *
 * Dibuja los cofres de shared/banks.js (madera, bandas de hierro, cerradura
 * dorada y una moneda que flota y gira encima para verlos de lejos).
 *   - Tap → caminar hasta el cofre y abrir el banco (se abre la tapa).
 *   - Pulsación larga → "Abrir banco / Examinar".
 * Solo se construyen los cofres cercanos (≤ 260 m) para no cargar la escena.
 * Sin PointLights (cada luz encarece todos los shaders): brillo con emissive
 * y un sprite aditivo.
 */

import * as THREE from 'three';
import { BANK_CHESTS, BANK_USE_DIST_M } from './shared/banks.js';

const VIEW_DIST = 260;
const APPROACH_DIST = 1.9;

let scene = null, getPlayer = null, setPlayerTargetCb = null, feedLog = () => {}, onOpenBank = () => {};
let started = false;
let timeAcc = 0, syncTimer = 0;
const objs = new Map();     // id → { b, group, lid, coin, glow, hit, lidT, lidTarget }
const pickMeshes = [];
let pending = null;
let openChest = null;
let RES = null;

function initRes() {
  if (RES) return;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,220,120,0.9)');
  grd.addColorStop(1, 'rgba(255,200,80,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
  RES = {
    wood: new THREE.MeshStandardMaterial({ color: 0x7a4a24, roughness: 0.85, flatShading: true }),
    woodDark: new THREE.MeshStandardMaterial({ color: 0x5a3418, roughness: 0.9, flatShading: true }),
    iron: new THREE.MeshStandardMaterial({ color: 0x3c3f44, metalness: 0.7, roughness: 0.45, flatShading: true }),
    gold: new THREE.MeshStandardMaterial({ color: 0xe0b040, metalness: 0.9, roughness: 0.25, emissive: 0x5a3c00, emissiveIntensity: 0.6, flatShading: true }),
    inside: new THREE.MeshBasicMaterial({ color: 0x1a0f06 }),
    coins: new THREE.MeshStandardMaterial({ color: 0xffd24a, metalness: 0.9, roughness: 0.3, emissive: 0x7a5200, emissiveIntensity: 0.8 }),
    glowTex: new THREE.CanvasTexture(c),
    hit: new THREE.MeshBasicMaterial({ visible: false }),
  };
}

function hashAngle(id) {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return ((h >>> 0) % 628) / 100;
}

function buildChest(b) {
  const group = new THREE.Group();
  group.position.set(b.x, 0, b.z);
  group.rotation.y = hashAngle(b.id);
  const W = 1.4, D = 0.9, H = 0.7;

  // Base de madera + tablones
  const base = new THREE.Mesh(new THREE.BoxGeometry(W, H, D), RES.wood);
  base.position.y = H / 2 + 0.05;
  group.add(base);
  const plinth = new THREE.Mesh(new THREE.BoxGeometry(W + 0.12, 0.1, D + 0.12), RES.woodDark);
  plinth.position.y = 0.05;
  group.add(plinth);
  for (let i = -1; i <= 1; i += 2) {
    const plank = new THREE.Mesh(new THREE.BoxGeometry(W + 0.01, 0.03, D + 0.01), RES.woodDark);
    plank.position.y = 0.05 + H * (0.5 + i * 0.22);
    group.add(plank);
  }
  // Bandas de hierro
  for (const sx of [-0.45, 0.45]) {
    const band = new THREE.Mesh(new THREE.BoxGeometry(0.1, H + 0.02, D + 0.04), RES.iron);
    band.position.set(sx, H / 2 + 0.05, 0);
    group.add(band);
  }
  // Esquinas doradas
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const c = new THREE.Mesh(new THREE.BoxGeometry(0.1, H + 0.04, 0.1), RES.gold);
    c.position.set(sx * (W / 2), H / 2 + 0.05, sz * (D / 2));
    group.add(c);
  }
  // Interior (se ve al abrir)
  const inner = new THREE.Mesh(new THREE.BoxGeometry(W - 0.1, 0.02, D - 0.1), RES.inside);
  inner.position.y = H + 0.04;
  group.add(inner);
  const pile = new THREE.Mesh(new THREE.SphereGeometry(0.35, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), RES.coins);
  pile.scale.set(1.4, 0.35, 0.9);
  pile.position.y = H + 0.02;
  group.add(pile);

  // Tapa (gira sobre la bisagra de atrás)
  const lid = new THREE.Group();
  lid.position.set(0, H + 0.05, -D / 2);
  const lidMesh = new THREE.Mesh(new THREE.CylinderGeometry(D / 2, D / 2, W, 14, 1, false, 0, Math.PI), RES.wood);
  lidMesh.rotation.z = Math.PI / 2;
  lidMesh.position.set(0, 0, D / 2);
  lid.add(lidMesh);
  for (const sx of [-0.45, 0.45]) {
    const lb = new THREE.Mesh(new THREE.CylinderGeometry(D / 2 + 0.02, D / 2 + 0.02, 0.1, 14, 1, false, 0, Math.PI), RES.iron);
    lb.rotation.z = Math.PI / 2;
    lb.position.set(sx, 0, D / 2);
    lid.add(lb);
  }
  const lock = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.24, 0.06), RES.gold);
  lock.position.set(0, -0.06, D + 0.02);
  lid.add(lock);
  group.add(lid);

  // Moneda flotante + halo
  const coin = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.05, 20), RES.coins);
  coin.rotation.x = Math.PI / 2;
  coin.position.y = 2.0;
  group.add(coin);
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: RES.glowTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  glow.scale.set(1.15, 1.15, 1);
  glow.position.y = 2.0;
  group.add(glow);

  const hit = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.3, 2.4, 8), RES.hit);
  hit.position.y = 1.2;
  hit.userData = { kind: 'bank_chest', bankId: b.id };
  group.add(hit);
  pickMeshes.push(hit);

  scene.add(group);
  const o = { b, group, lid, coin, glow, hit, lidT: 0, lidTarget: 0 };
  objs.set(b.id, o);
  return o;
}

function disposeChest(o) {
  scene?.remove(o.group);
  const i = pickMeshes.indexOf(o.hit);
  if (i >= 0) pickMeshes.splice(i, 1);
  objs.delete(o.b.id);
}

// ============================================================
// API
// ============================================================
export function registerKeepouts(terrain) {
  for (const b of BANK_CHESTS) {
    try { terrain.addKeepout?.(b.x, b.z, 3); terrain.clearTreesNear?.(b.x, b.z, 3); } catch {}
  }
}

export function start(opts) {
  if (started) stop();
  scene = opts.scene;
  getPlayer = opts.getPlayer;
  setPlayerTargetCb = opts.setPlayerTarget || (() => {});
  feedLog = opts.feedLog || (() => {});
  onOpenBank = opts.onOpenBank || (() => {});
  initRes();
  started = true;
  syncTimer = 99;
}

export function stop() {
  for (const o of Array.from(objs.values())) disposeChest(o);
  pending = null; openChest = null;
  started = false;
}

export function getBanksForMinimap() {
  return BANK_CHESTS.map(b => ({ x: b.x, z: b.z }));
}

function chestUnderRay(raycaster) {
  if (!started || !pickMeshes.length) return null;
  const hits = raycaster.intersectObjects(pickMeshes, false);
  if (!hits.length) return null;
  return objs.get(hits[0].object.userData?.bankId) || null;
}

function goChest(o) {
  const p = getPlayer?.();
  if (!p) return;
  const dx = p.position.x - o.b.x, dz = p.position.z - o.b.z;
  const d = Math.hypot(dx, dz);
  if (d > BANK_USE_DIST_M) {
    setPlayerTargetCb(o.b.x + (dx / (d || 1)) * APPROACH_DIST, o.b.z + (dz / (d || 1)) * APPROACH_DIST);
    pending = o;
  } else {
    open(o);
  }
}

function open(o) {
  openChest = o;
  o.lidTarget = 1;
  try { onOpenBank(o.b); } catch (e) { console.warn('[bank_chests] open:', e); }
}

export function tryHandleTap(raycaster) {
  const o = chestUnderRay(raycaster);
  if (!o) return false;
  goChest(o);
  return true;
}

export function openActionMenuAt(raycaster, cx, cy, openMenu) {
  const o = chestUnderRay(raycaster);
  if (!o) return false;
  openMenu(o.b.name, [
    { label: '🏦 Abrir banco', onPick: () => goChest(o) },
    { label: '🔍 Examinar', onPick: () => feedLog('info', `${o.b.name}: abre tu banco. Todos los cofres comparten el mismo banco.`) },
  ], cx, cy);
  return true;
}

export function cancel() { pending = null; }

export function update(dt) {
  if (!started) return;
  timeAcc += dt;
  const p = getPlayer?.();

  syncTimer += dt;
  if (p && syncTimer >= 1) {
    syncTimer = 0;
    for (const b of BANK_CHESTS) {
      const near = Math.hypot(b.x - p.position.x, b.z - p.position.z) < VIEW_DIST;
      const o = objs.get(b.id);
      if (near && !o) buildChest(b);
      else if (!near && o) disposeChest(o);
    }
  }

  for (const o of objs.values()) {
    o.coin.rotation.z = timeAcc * 2.2;
    o.coin.position.y = 2.0 + Math.sin(timeAcc * 2 + o.b.x) * 0.12;
    o.glow.position.y = o.coin.position.y;
    o.glow.material.opacity = 0.4 + 0.2 * Math.sin(timeAcc * 3 + o.b.z);
    o.lidT += (o.lidTarget - o.lidT) * Math.min(1, dt * 6);
    o.lid.rotation.x = -o.lidT * 1.9;
  }

  if (p && pending && Math.hypot(p.position.x - pending.b.x, p.position.z - pending.b.z) <= BANK_USE_DIST_M) {
    const o = pending; pending = null; open(o);
  }
  // Te alejas → se cierra la tapa
  if (p && openChest && Math.hypot(p.position.x - openChest.b.x, p.position.z - openChest.b.z) > BANK_USE_DIST_M + 3) {
    openChest.lidTarget = 0;
    openChest = null;
  }
}

/** Llamar al cerrar el banco. */
export function onBankClosed() {
  if (openChest) { openChest.lidTarget = 0; openChest = null; }
}
