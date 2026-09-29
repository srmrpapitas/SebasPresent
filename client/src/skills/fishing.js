/**
 * SebasPresent — Pesca (cliente) · Sesión 50
 *
 * - Dibuja los estanques/lagos (shared/fishing.js PONDS): agua con brillo
 *   animado, orilla de barro/arena, juncos y nenúfares (o hielo con grietas
 *   en el Lago Helado).
 * - Dibuja los bancos de peces ACTIVOS: ondas, burbujas y algún pez que salta.
 *   Los bancos cambian de sitio cada 5 min (mismo cálculo que el server).
 * - Tap en un banco → camina a la orilla y pesca en bucle.
 *   Pulsación larga → "Pescar / Examinar".
 * - Caña: se ve la caña, el sedal y el flotador.
 * - No puedes andar sobre el agua de los estanques (te empuja a la orilla).
 *
 * Debug: window.__fishingDebug()
 */

import * as THREE from 'three';
import * as api from '../api.js';
import * as skills from '../skills.js';
import * as inventory from '../inventory.js';
import * as audio from '../audio.js';
import {
  PONDS, SPOTS, SPOT_TYPES, TOOLS, FISH, isSpotActive, spotMinLevel,
} from '../shared/fishing.js';

// ============================================================
// Constantes
// ============================================================
const FISH_TICK_MS     = 2400;    // server acepta cada 1500
const USE_DIST_M       = 4.6;     // server: 5.5
const SPOT_VIEW_DIST   = 140;
const STOP_AFTER_FAILS = 3;

// ============================================================
// Estado
// ============================================================
let scene = null;
let getPlayer = null, getCharacter = null, setPlayerTargetCb = null;
let feedLog = () => {};
let started = false;
let timeAcc = 0;

const pondObjs = [];              // { pond, group, waterMat, tex }
const spotObjs = new Map();       // spot_id → { spot, group, hit, ripples[], bubbles[], jump }
const pickMeshes = [];
let activeSyncTimer = 0;

let active = null;                // { id, lastAt, waiting, started, fails, gen }
let fishGen = 0;
let rodRig = null;                // caña + sedal + flotador

let RES = null;

// ============================================================
// Recursos
// ============================================================
function makeWaterTexture(frozen) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = frozen ? '#dff2fb' : '#3a86b8';
  g.fillRect(0, 0, 128, 128);
  // manchas de profundidad
  for (let i = 0; i < 18; i++) {
    g.fillStyle = frozen ? 'rgba(160,200,225,0.35)' : 'rgba(20,70,110,0.35)';
    g.beginPath();
    g.ellipse(Math.random() * 128, Math.random() * 128, 8 + Math.random() * 18, 4 + Math.random() * 10, Math.random() * 3, 0, Math.PI * 2);
    g.fill();
  }
  // reflejos / grietas
  g.lineCap = 'round';
  for (let i = 0; i < 26; i++) {
    const x = Math.random() * 128, y = Math.random() * 128, l = 6 + Math.random() * 14;
    if (frozen) {
      g.strokeStyle = 'rgba(255,255,255,0.7)'; g.lineWidth = 0.8;
      g.beginPath(); g.moveTo(x, y);
      g.lineTo(x + (Math.random() - 0.5) * l * 2, y + (Math.random() - 0.5) * l * 2);
      g.lineTo(x + (Math.random() - 0.5) * l * 3, y + (Math.random() - 0.5) * l * 3);
      g.stroke();
    } else {
      g.strokeStyle = 'rgba(190,230,255,0.55)'; g.lineWidth = 1.4;
      g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + l / 2, y - 2, x + l, y); g.stroke();
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function initResources() {
  if (RES) return;
  RES = {
    ring: new THREE.RingGeometry(0.5, 0.74, 28),
    foam: new THREE.CircleGeometry(1.0, 20),
    foamMat: new THREE.MeshBasicMaterial({ color: 0xe8f6ff, transparent: true, opacity: 0.22, depthWrite: false }),
    ringMats: [],
    bubble: new THREE.SphereGeometry(0.07, 6, 5),
    bubbleMat: new THREE.MeshBasicMaterial({ color: 0xe8f8ff, transparent: true, opacity: 0.85, depthWrite: false }),
    fish: (() => {
      const g = new THREE.ConeGeometry(0.11, 0.5, 6);
      g.rotateZ(Math.PI / 2);
      return g;
    })(),
    fishMat: new THREE.MeshStandardMaterial({ color: 0xb8c8d0, metalness: 0.6, roughness: 0.3, flatShading: true }),
    hitGeo: new THREE.CylinderGeometry(1.5, 1.5, 1.4, 10),
    hitMat: new THREE.MeshBasicMaterial({ visible: false }),
    hole: new THREE.CircleGeometry(0.95, 18),
    holeMat: new THREE.MeshStandardMaterial({ color: 0x13384f, roughness: 0.2 }),
    reed: new THREE.ConeGeometry(0.05, 1.3, 4),
    reedMat: new THREE.MeshStandardMaterial({ color: 0x5d7a2e, flatShading: true }),
    pad: new THREE.CircleGeometry(0.42, 9, 0.3, Math.PI * 2 - 0.6),
    padMat: new THREE.MeshStandardMaterial({ color: 0x5fb04a, emissive: 0x16300f, flatShading: true, side: THREE.DoubleSide }),
    flowerMat: new THREE.MeshStandardMaterial({ color: 0xffc8e8, emissive: 0x552244, emissiveIntensity: 0.3 }),
    rock: new THREE.DodecahedronGeometry(0.45, 0),
    rockMat: new THREE.MeshStandardMaterial({ color: 0x8a8378, flatShading: true }),
  };
  for (const t of Object.keys(SPOT_TYPES)) {
    RES.ringMats[t] = new THREE.MeshBasicMaterial({
      color: new THREE.Color(SPOT_TYPES[t].color), transparent: true, opacity: 0.8,
      depthWrite: false, side: THREE.DoubleSide,
    });
  }
}

function rng(seed) {
  let s = (seed * 9301 + 49297) % 233280;
  return () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
}

// ============================================================
// Estanques
// ============================================================
function buildPond(pond) {
  const group = new THREE.Group();
  group.position.set(pond.x, 0, pond.z);
  const r = pond.r;
  const R = rng(Math.abs(pond.x * 7 + pond.z * 13) + 11);

  // Orilla (barro / nieve)
  const shore = new THREE.Mesh(
    new THREE.RingGeometry(r - 0.2, r + 1.8, 48),
    new THREE.MeshStandardMaterial({ color: pond.frozen ? 0xe6eef4 : 0x7a6346, roughness: 1, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }),
  );
  shore.rotation.x = -Math.PI / 2;
  shore.position.y = 0.025;
  group.add(shore);

  // Agua
  const tex = makeWaterTexture(pond.frozen);
  tex.repeat.set(r / 4, r / 4);
  const waterMat = new THREE.MeshStandardMaterial({
    map: tex, roughness: pond.frozen ? 0.15 : 0.1, metalness: pond.frozen ? 0.1 : 0.25,
    transparent: !pond.frozen, opacity: pond.frozen ? 1 : 0.92,
    emissive: pond.frozen ? 0x5a7a90 : 0x0a3a5a, emissiveIntensity: 0.4,
  });
  const water = new THREE.Mesh(new THREE.CircleGeometry(r, 48), waterMat);
  water.rotation.x = -Math.PI / 2;
  water.position.y = 0.05;
  water.renderOrder = 1;
  group.add(water);

  // Decoración: piedras, juncos, nenúfares
  const nRocks = Math.round(r * 0.8);
  for (let i = 0; i < nRocks; i++) {
    const a = R() * Math.PI * 2, d = r + 0.6 + R() * 1.0;
    const m = new THREE.Mesh(RES.rock, RES.rockMat);
    m.position.set(Math.cos(a) * d, 0.1, Math.sin(a) * d);
    m.scale.setScalar(0.5 + R() * 0.9);
    m.rotation.set(R() * 3, R() * 3, R() * 3);
    group.add(m);
  }
  if (!pond.frozen) {
    const nReeds = Math.round(r * 3);
    for (let i = 0; i < nReeds; i++) {
      const a = R() * Math.PI * 2, d = r - 0.3 + R() * 0.9;
      const m = new THREE.Mesh(RES.reed, RES.reedMat);
      m.position.set(Math.cos(a) * d, 0.6, Math.sin(a) * d);
      m.scale.y = 0.6 + R() * 0.8;
      m.rotation.z = (R() - 0.5) * 0.3;
      group.add(m);
    }
    const nPads = Math.round(r * 1.1);
    for (let i = 0; i < nPads; i++) {
      const a = R() * Math.PI * 2, d = R() * (r - 2.5);
      const m = new THREE.Mesh(RES.pad, RES.padMat);
      m.rotation.x = -Math.PI / 2;
      m.rotation.z = R() * 6;
      m.renderOrder = 2;
      m.position.set(Math.cos(a) * d, 0.075, Math.sin(a) * d);
      m.scale.setScalar(0.7 + R() * 0.6);
      group.add(m);
      if (R() < 0.3) {
        const f = new THREE.Mesh(new THREE.SphereGeometry(0.1, 6, 4), RES.flowerMat);
        f.position.set(m.position.x, 0.13, m.position.z);
        group.add(f);
      }
    }
  }
  scene.add(group);
  pondObjs.push({ pond, group, waterMat, tex });
}

// ============================================================
// Bancos de peces
// ============================================================
function spotY(spot) { return spot.pond ? 0.09 : -0.36; }

function buildSpot(spot) {
  const group = new THREE.Group();
  const y = spotY(spot);
  group.position.set(spot.x, y, spot.z);
  const pond = spot.pond ? PONDS.find(p => p.id === spot.pond) : null;

  if (pond?.frozen) {
    const hole = new THREE.Mesh(RES.hole, RES.holeMat);
    hole.rotation.x = -Math.PI / 2;
    hole.position.y = 0.005;
    group.add(hole);
  }
  if (!pond?.frozen) {
    const foam = new THREE.Mesh(RES.foam, RES.foamMat);
    foam.rotation.x = -Math.PI / 2;
    foam.position.y = 0.004;
    group.add(foam);
  }
  const ripples = [];
  for (let i = 0; i < 3; i++) {
    const m = new THREE.Mesh(RES.ring, RES.ringMats[spot.type].clone());
    m.rotation.x = -Math.PI / 2;
    m.position.y = 0.01;
    m.userData.t = i / 3;
    group.add(m);
    ripples.push(m);
  }
  const bubbles = [];
  for (let i = 0; i < 6; i++) {
    const b = new THREE.Mesh(RES.bubble, RES.bubbleMat);
    b.userData = { t: Math.random(), ox: (Math.random() - 0.5) * 1.1, oz: (Math.random() - 0.5) * 1.1 };
    group.add(b);
    bubbles.push(b);
  }
  const jump = new THREE.Mesh(RES.fish, RES.fishMat);
  jump.visible = false;
  group.add(jump);

  const hit = new THREE.Mesh(RES.hitGeo, RES.hitMat);
  hit.position.y = 0.5;
  hit.userData.spotId = spot.id;
  group.add(hit);
  pickMeshes.push(hit);

  group.traverse(o => { o.renderOrder = 3; });   // encima del agua (transparente)
  scene.add(group);
  const obj = { spot, group, hit, ripples, bubbles, jump, jumpT: -1, nextJump: 1 + Math.random() * 5 };
  spotObjs.set(spot.id, obj);
  return obj;
}

function disposeSpot(obj) {
  scene?.remove(obj.group);
  const i = pickMeshes.indexOf(obj.hit);
  if (i >= 0) pickMeshes.splice(i, 1);
  for (const r of obj.ripples) r.material.dispose();
  spotObjs.delete(obj.spot.id);
}

function syncSpots() {
  const player = getPlayer?.();
  if (!player) return;
  const now = Date.now();
  const px = player.position.x, pz = player.position.z;
  for (const spot of SPOTS) {
    const near = Math.hypot(spot.x - px, spot.z - pz) < SPOT_VIEW_DIST;
    const want = near && isSpotActive(spot, now);
    const obj = spotObjs.get(spot.id);
    if (want && !obj) buildSpot(spot);
    else if (!want && obj) {
      if (active?.id === spot.id) {
        feedLog('info', '🐟 El banco de peces se ha movido.');
        stopFishing('spot_moved');
      }
      disposeSpot(obj);
    }
  }
}

function animateSpots(dt) {
  for (const obj of spotObjs.values()) {
    for (const r of obj.ripples) {
      r.userData.t = (r.userData.t + dt * 0.45) % 1;
      const t = r.userData.t;
      r.scale.setScalar(0.4 + t * 1.9);
      r.material.opacity = 0.95 * (1 - t);
    }
    for (const b of obj.bubbles) {
      const u = b.userData;
      u.t += dt * (0.7 + Math.random() * 0.2);
      if (u.t >= 1) { u.t = 0; u.ox = (Math.random() - 0.5) * 1.1; u.oz = (Math.random() - 0.5) * 1.1; }
      b.position.set(u.ox, 0.02 + u.t * 0.18, u.oz);
      b.scale.setScalar(u.t < 0.85 ? 0.5 + u.t : 2.2 * (1 - u.t) / 0.15 * 0.6);
    }
    // Pez que salta de vez en cuando
    if (obj.jumpT < 0) {
      obj.nextJump -= dt;
      if (obj.nextJump <= 0) {
        obj.jumpT = 0;
        obj.jumpDir = Math.random() * Math.PI * 2;
        obj.jump.visible = true;
        obj.jump.rotation.y = -obj.jumpDir;
      }
    } else {
      obj.jumpT += dt / 0.8;
      const t = obj.jumpT;
      if (t >= 1) {
        obj.jumpT = -1; obj.jump.visible = false; obj.nextJump = 3 + Math.random() * 7;
      } else {
        const d = (t - 0.5) * 1.2;
        obj.jump.position.set(Math.cos(obj.jumpDir) * d, Math.sin(t * Math.PI) * 0.9, Math.sin(obj.jumpDir) * d);
        obj.jump.rotation.z = (0.5 - t) * 2.2;
      }
    }
  }
}

// ============================================================
// Caña + sedal + flotador (solo con caña)
// ============================================================
function buildRodRig() {
  const g = new THREE.Group();
  const rod = new THREE.Mesh(
    new THREE.CylinderGeometry(0.012, 0.03, 1.9, 5),
    new THREE.MeshStandardMaterial({ color: 0x6b4423, roughness: 0.8 }),
  );
  rod.geometry.translate(0, 0.95, 0);
  g.add(rod);
  const lineGeo = new THREE.BufferGeometry();
  lineGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(3 * 12), 3));
  const line = new THREE.Line(lineGeo, new THREE.LineBasicMaterial({ color: 0xf0f0f0, transparent: true, opacity: 0.8 }));
  line.frustumCulled = false;
  const bob = new THREE.Group();
  const top = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xe53a2a, emissive: 0x441010 }));
  const bot = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 6, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xffffff }));
  bob.add(top, bot);
  scene.add(g, line, bob);
  return { g, rod, line, bob, bite: 0 };
}

function removeRodRig() {
  if (!rodRig) return;
  scene.remove(rodRig.g, rodRig.line, rodRig.bob);
  rodRig.line.geometry.dispose();
  rodRig = null;
}

const _hand = new THREE.Vector3();
const _tip = new THREE.Vector3();
function updateRodRig(obj) {
  const player = getPlayer?.();
  if (!rodRig || !player || !obj) return;
  const ch = getCharacter?.();
  if (ch?._rightHandBone) ch._rightHandBone.getWorldPosition(_hand);
  else _hand.set(player.position.x, player.position.y + 1.1, player.position.z);
  const tx = obj.spot.x, tz = obj.spot.z;
  const dx = tx - _hand.x, dz = tz - _hand.z;
  const yaw = Math.atan2(dx, dz);
  rodRig.g.position.copy(_hand);
  rodRig.g.rotation.set(0, 0, 0);
  rodRig.g.rotation.y = yaw;
  rodRig.g.rotateX(0.95);               // inclinada hacia el agua
  rodRig.rod.updateMatrixWorld(true);
  rodRig.g.updateMatrixWorld(true);
  _tip.set(0, 1.9, 0).applyMatrix4(rodRig.g.matrixWorld);

  // Flotador: se mece; al picar, se hunde
  rodRig.bite = Math.max(0, rodRig.bite - 0.016 * 2);
  const by = spotY(obj.spot) + 0.03 + Math.sin(timeAcc * 3) * 0.02 - rodRig.bite * 0.12;
  rodRig.bob.position.set(tx - Math.sin(yaw) * 0.6, by, tz - Math.cos(yaw) * 0.6);

  // Sedal: curva caída entre punta y flotador
  const pos = rodRig.line.geometry.attributes.position;
  const n = pos.count;
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const x = _tip.x + (rodRig.bob.position.x - _tip.x) * t;
    const z = _tip.z + (rodRig.bob.position.z - _tip.z) * t;
    const y = _tip.y + (rodRig.bob.position.y + 0.08 - _tip.y) * t - Math.sin(t * Math.PI) * 0.35;
    pos.setXYZ(i, x, y, z);
  }
  pos.needsUpdate = true;
}

// ============================================================
// API pública
// ============================================================
export function registerKeepouts(terrain) {
  try {
    for (const p of PONDS) {
      terrain.addKeepout?.(p.x, p.z, p.r + 2.5);
      terrain.clearTreesNear?.(p.x, p.z, p.r + 2.5);
    }
  } catch (err) {
    console.warn('[fishing] registerKeepouts:', err?.message);
  }
}

export function start(opts) {
  if (started) stop();
  scene = opts.scene;
  getPlayer = opts.getPlayer;
  getCharacter = opts.getCharacter || (() => null);
  setPlayerTargetCb = opts.setPlayerTarget || (() => {});
  feedLog = opts.feedLog || (() => {});
  initResources();
  for (const p of PONDS) buildPond(p);
  started = true;
  activeSyncTimer = 99;
  if (typeof window !== 'undefined') {
    window.__fishingDebug = () => ({
      active, spots: [...spotObjs.keys()],
      near: SPOTS.filter(s => { const pl = getPlayer?.(); return pl && Math.hypot(s.x - pl.position.x, s.z - pl.position.z) < 60; })
        .map(s => ({ id: s.id, type: s.type, x: s.x, z: s.z, active: isSpotActive(s, Date.now()) })),
    });
  }
  console.log('[fishing] started.');
}

export function stop() {
  if (!started) return;
  stopFishing('module_stop');
  for (const o of Array.from(spotObjs.values())) disposeSpot(o);
  for (const p of pondObjs) { scene?.remove(p.group); p.tex.dispose(); }
  pondObjs.length = 0;
  started = false;
  if (typeof window !== 'undefined') delete window.__fishingDebug;
}

/** Para el minimapa: lagos (círculos) y bancos activos (puntos). */
export function getPondsForMinimap() { return PONDS.map(p => ({ x: p.x, z: p.z, r: p.r, frozen: p.frozen })); }
export function getSpotsForMinimap() {
  const out = [];
  for (const o of spotObjs.values()) out.push({ x: o.spot.x, z: o.spot.z });
  return out;
}

function spotUnderRay(raycaster) {
  if (!started || pickMeshes.length === 0) return null;
  const hits = raycaster.intersectObjects(pickMeshes, false);
  if (!hits.length) return null;
  return spotObjs.get(hits[0].object.userData?.spotId) || null;
}

function toolFor(spot) { return TOOLS[SPOT_TYPES[spot.type].tool]; }

function examine(obj) {
  const T = SPOT_TYPES[obj.spot.type];
  const tool = toolFor(obj.spot);
  const lvl = skills.getLevel?.('fishing') ?? 1;
  const fish = T.fish.map(f => `${FISH[f].name} (${FISH[f].level})`).join(', ');
  const bait = tool.bait ? ` + ${tool.baitName}` : '';
  feedLog('info', `${T.name}: ${fish} · Necesitas ${tool.name.toLowerCase()}${bait} · Tu nivel: ${lvl}.`);
}

export function tryHandleTap(raycaster, examineOnly = false) {
  const obj = spotUnderRay(raycaster);
  if (!obj) return false;
  if (examineOnly) { examine(obj); return true; }
  startFishingAt(obj);
  return true;
}

export function openActionMenuAt(raycaster, cx, cy, openMenu) {
  const obj = spotUnderRay(raycaster);
  if (!obj) return false;
  const T = SPOT_TYPES[obj.spot.type];
  const verb = T.tool === 'net' ? '🥅 Pescar con red' : T.tool === 'rod' ? '🎣 Pescar con caña' : '🔱 Arponear';
  openMenu(T.name, [
    { label: verb, onPick: () => startFishingAt(obj) },
    { label: '🔍 Examinar', onPick: () => examine(obj) },
  ], cx, cy);
  return true;
}

export function isBusy() { return !!(active && active.started); }
export function isEngaged() { return !!active; }

/** Punto de la orilla más cercano al jugador para pescar ese banco. */
function shorePointFor(spot, player) {
  const pond = spot.pond ? PONDS.find(p => p.id === spot.pond) : null;
  if (pond) {
    let dx = spot.x - pond.x, dz = spot.z - pond.z;
    const d = Math.hypot(dx, dz) || 1;
    dx /= d; dz /= d;
    return { x: pond.x + dx * (pond.r + 0.9), z: pond.z + dz * (pond.r + 0.9) };
  }
  // Costa: el borde del mundo
  const EDGE = 2045.5;
  if (Math.abs(spot.z) > 2040) return { x: spot.x, z: Math.sign(spot.z) * EDGE };
  return { x: Math.sign(spot.x) * EDGE, z: spot.z };
}

function hasItem(itemId) {
  return (inventory.getState?.() || []).some(s => s && s.item_id === itemId);
}

function startFishingAt(obj) {
  const player = getPlayer?.();
  if (!player) return;
  const p = shorePointFor(obj.spot, player);
  if (Math.hypot(player.position.x - obj.spot.x, player.position.z - obj.spot.z) > USE_DIST_M - 0.3) {
    setPlayerTargetCb(p.x, p.z);
  }
  const lvl = skills.getLevel?.('fishing') ?? 1;
  const need = spotMinLevel(obj.spot.type);
  if (lvl < need) { feedLog('error', `Necesitas nivel ${need} de Pesca para pescar aquí.`); return; }
  const tool = toolFor(obj.spot);
  if (!hasItem(tool.item)) {
    feedLog('error', `Necesitas: ${tool.name}. La venden en la tienda general.`);
    return;
  }
  if (tool.bait && !hasItem(tool.bait)) {
    feedLog('error', `No tienes ${tool.baitName} para usar de cebo.`);
    return;
  }
  stopFishing('restart');
  fishGen++;
  active = { id: obj.spot.id, tool: SPOT_TYPES[obj.spot.type].tool, lastAt: 0, waiting: false, started: false, fails: 0, gen: fishGen };
}

export function stopFishing(reason = 'user') {
  if (!active) return;
  fishGen++;
  active = null;
  removeRodRig();
  if (reason !== 'user' && reason !== 'tap_ground' && reason !== 'restart') console.log('[fishing] stop:', reason);
}

export function cancel(reason = 'external') { stopFishing(reason); }

export function update(dt) {
  if (!started) return;
  timeAcc += dt;
  const player = getPlayer?.();

  // Agua animada
  for (const p of pondObjs) {
    if (!p.pond.frozen) {
      p.tex.offset.x = Math.sin(timeAcc * 0.07) * 0.3;
      p.tex.offset.y = timeAcc * 0.012;
      p.waterMat.emissiveIntensity = 0.35 + Math.sin(timeAcc * 0.8) * 0.08;
    }
  }

  // No se camina sobre los estanques
  if (player) {
    for (const p of PONDS) {
      const dx = player.position.x - p.x, dz = player.position.z - p.z;
      const d = Math.hypot(dx, dz), lim = p.r + 0.5;
      if (d < lim) {
        const ux = d > 0.01 ? dx / d : 1, uz = d > 0.01 ? dz / d : 0;
        player.position.x = p.x + ux * lim;
        player.position.z = p.z + uz * lim;
      }
    }
  }

  activeSyncTimer += dt;
  if (activeSyncTimer >= 1.0) { activeSyncTimer = 0; syncSpots(); }
  animateSpots(dt);

  if (!active || !player) return;
  const obj = spotObjs.get(active.id);
  if (!obj) { stopFishing('spot_gone'); return; }
  const dx = player.position.x - obj.spot.x, dz = player.position.z - obj.spot.z;
  const d = Math.hypot(dx, dz);
  if (active.started && d > 10) { stopFishing('walked_away'); return; }
  if (d > USE_DIST_M) {
    // Si ya llegó a su destino y aún está lejos (p. ej. esquina), acércalo a la orilla
    return;
  }

  if (!active.started) {
    active.started = true;
    try { getCharacter?.()?.faceTowards?.(obj.spot.x, obj.spot.z); } catch {}
    const msg = active.tool === 'net' ? 'Echas la red al agua...' : active.tool === 'rod' ? 'Lanzas el sedal...' : 'Preparas el arpón...';
    feedLog('info', msg);
    audio.synth('splash', { volume: 0.6 });
    if (active.tool === 'rod') rodRig = buildRodRig();
  }
  if (rodRig) updateRodRig(obj);

  const now = performance.now();
  if (active.waiting || now - active.lastAt < FISH_TICK_MS) return;
  active.lastAt = now;
  active.waiting = true;
  const ch = getCharacter?.();
  try { ch?.faceTowards?.(obj.spot.x, obj.spot.z); } catch {}
  if (active.tool === 'net') ch?.playGather?.('kneel', 1800);
  else if (active.tool === 'harpoon') ch?.playGather?.('punching', 0);
  if (active.tool !== 'rod') {
    setTimeout(() => { if (active?.id === obj.spot.id) audio.synth('splash', { volume: 0.45, pitch: 0.9 + Math.random() * 0.2 }); }, 450);
  }
  attemptFish(obj, active.gen).catch(err => console.warn('[fishing] err:', err?.message));
}

async function attemptFish(obj, gen) {
  try {
    const res = await api.fishingFish(obj.spot.id);
    if (gen !== fishGen) return;
    if (active) active.waiting = false;
    if (!res?.ok) return;
    if (active) active.fails = 0;
    if (!res.caught) return;

    if (rodRig) { rodRig.bite = 1; audio.synth('fish_bite', { volume: 0.6 }); }
    setTimeout(() => audio.synth('fish_catch', { volume: 0.7 }), rodRig ? 180 : 0);
    obj.jumpT = 0; obj.jumpDir = Math.random() * Math.PI * 2; obj.jump.visible = true;   // salta el pez
    try { await skills.reload(); } catch {}
    try { await window.inventory?.refresh?.(); } catch {}
    try { window.__spawnXpDrops?.({ fishing: res.xp_gained }); } catch {}
    feedLog('xp', `Pescas: ${res.fish_name}. +${res.xp_gained} XP Pesca`);
    if (res.level_up) {
      feedLog('info', `¡Subes a nivel ${res.new_level} de Pesca!`);
      try { window.__spawnLevelUpBanner?.('fishing', res.new_level); } catch {}
    }
  } catch (err) {
    if (gen !== fishGen) return;
    if (active) active.waiting = false;
    const code = err?.code;
    if (code === 'spot_moved') {
      feedLog('info', '🐟 El banco de peces se ha movido.');
      stopFishing(code);
      disposeSpot(obj);
    } else if (code === 'inventory_full') {
      feedLog('error', 'Mochila llena.'); stopFishing(code);
    } else if (['no_tool', 'no_bait', 'level_too_low', 'invalid_spot'].includes(code)) {
      feedLog('error', err.message || 'No puedes pescar aquí.'); stopFishing(code);
    } else if (code === 'out_of_range') {
      // El heartbeat del server va algo por detrás: reintenta
      if (active && ++active.fails >= STOP_AFTER_FAILS + 2) { feedLog('error', 'Acércate más a la orilla.'); stopFishing(code); }
    } else if (code === 'too_fast') {
      // reintenta
    } else {
      if (active && ++active.fails >= STOP_AFTER_FAILS) stopFishing(code || 'errors');
    }
  }
}
