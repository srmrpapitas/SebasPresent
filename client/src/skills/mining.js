/**
 * SebasPresent — Minería (cliente) · Sesión 50
 *
 * Hace tres cosas:
 *   1. DIBUJA las vetas de mineral alrededor del jugador (roca low-poly +
 *      cristales emisivos del color del mineral + brillo + chispitas).
 *      Las posiciones salen de shared/ore_veins.js (el mismo generador que
 *      usa el server), así que cliente y server siempre coinciden.
 *   2. Tap en una veta → camina hasta ella → loop de picar (anim + pico en
 *      mano + SFX + fragmentos que saltan) → POST /api/mining/mine.
 *   3. Vetas agotadas (snapshot.depleted_veins): se apagan los cristales y
 *      la roca queda gris hasta que reaparece.
 *
 * Uso desde world.js:
 *   mining.registerKeepouts(terrain);          // tras terrain.start (sin árboles encima)
 *   mining.start({ scene, getPlayer, getCharacter, setPlayerTarget, feedLog, getSnapshot });
 *   mining.update(dt);                         // cada frame
 *   mining.tryHandleTap(raycaster)             // en doCanvasTap, antes que árboles
 *   mining.stop();
 *
 * Debug (Eruda): window.__miningDebug()
 */

import * as THREE from 'three';
import * as api from '../api.js';
import * as skills from '../skills.js';
import * as equipment from '../equipment.js';
import * as inventory from '../inventory.js';
import * as audio from '../audio.js';
import {
  ORE_TIERS, veinsNear, chunkKeyAt, allVeinClusterCenters,
} from '../shared/ore_veins.js';

// ============================================================
// Constantes
// ============================================================
const VIEW_RADIUS_CHUNKS = 3;         // igual que el terreno
const MIN_MINE_TICK_MS   = 1800;      // server acepta cada 1500ms
const MAX_MINE_DIST_M    = 3.0;       // server: 3.8
const APPROACH_DIST_M    = 2.2;
const STOP_AFTER_FAILS   = 3;
const ROCK_COLOR         = 0x8c857c;
const ROCK_COLOR_WILD    = 0x6a5850;
const DEPLETED_COLOR     = 0x5e5a56;

// ============================================================
// Estado
// ============================================================
let scene = null;
let getPlayer = null, getCharacter = null, setPlayerTargetCb = null;
let feedLog = () => {}, getSnapshot = () => null;
let started = false;

const veinObjs = new Map();       // vein_id → { vein, group, rock, crystals, glow, sparkles }
const pickMeshes = [];            // rocas (para raycast)
let lastChunkKey = null;
let chunkTimer = 0;
let depletedSyncTimer = 0;
let depletedIds = new Set();
let timeAcc = 0;

let active = null;                // loop de picado activo
let mineGen = 0;
const bursts = [];                // partículas de fragmentos en vuelo

// Recursos compartidos (se crean una vez)
let RES = null;

// ============================================================
// Recursos visuales
// ============================================================
function makeRockGeometry(seed) {
  const g = new THREE.IcosahedronGeometry(1, 1);
  const pos = g.attributes.position;
  // Deformación determinista para que cada variante sea distinta y "rocosa".
  const vmap = new Map();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const k = `${x.toFixed(3)},${y.toFixed(3)},${z.toFixed(3)}`;
    let f = vmap.get(k);
    if (f === undefined) {
      const h = Math.sin((x * 12.9898 + y * 78.233 + z * 37.719 + seed * 13.1) * 43758.5453);
      f = 0.78 + (h - Math.floor(h)) * 0.42;
      vmap.set(k, f);
    }
    // Aplanar la base y achatar un poco en Y.
    const yy = y < -0.35 ? -0.35 : y;
    pos.setXYZ(i, x * f, yy * f * 0.78, z * f);
  }
  g.computeVertexNormals();
  return g;
}

function makeGlowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  const grd = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.35, 'rgba(255,255,255,0.45)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.needsUpdate = true;
  return t;
}

function initResources() {
  if (RES) return;
  const glowTex = makeGlowTexture();
  RES = {
    rockGeoms: [0.13, 0.57, 0.91].map(makeRockGeometry),
    crystalGeom: (() => {
      const g = new THREE.OctahedronGeometry(0.22, 0);
      g.scale(1, 2.4, 1);
      g.translate(0, 0.53, 0);       // la punta inferior justo en el origen
      return g;
    })(),
    rockMat: new THREE.MeshLambertMaterial({ color: ROCK_COLOR, flatShading: true }),
    rockMatWild: new THREE.MeshLambertMaterial({ color: ROCK_COLOR_WILD, flatShading: true }),
    rockMatDepleted: new THREE.MeshLambertMaterial({ color: DEPLETED_COLOR, flatShading: true }),
    glowTex,
    tiers: {},
    fragGeom: new THREE.TetrahedronGeometry(0.09, 0),
    hitGeom: new THREE.CylinderGeometry(1.5, 1.5, 2.2, 8),
    hitMat: new THREE.MeshBasicMaterial({ visible: false }),
  };
  for (const def of Object.values(ORE_TIERS)) {
    const glow = new THREE.Color(def.glow);
    RES.tiers[def.id] = {
      crystalMat: new THREE.MeshLambertMaterial({
        color: new THREE.Color(def.color),
        emissive: glow,
        emissiveIntensity: def.glowIntensity,
        flatShading: true,
      }),
      glowMat: new THREE.SpriteMaterial({
        map: glowTex, color: glow, transparent: true,
        opacity: 0.22 + def.glowIntensity * 0.35,
        depthWrite: false, blending: THREE.AdditiveBlending,
      }),
      sparkMat: new THREE.PointsMaterial({
        color: glow, map: glowTex, size: 0.22 + def.tier * 0.02, transparent: true, alphaTest: 0.01,
        opacity: 0.8, depthWrite: false, blending: THREE.AdditiveBlending,
      }),
      fragMat: new THREE.MeshLambertMaterial({
        color: new THREE.Color(def.color), emissive: glow, emissiveIntensity: 0.4,
      }),
      base: def.glowIntensity,
    };
  }
}

// PRNG local por veta (mulberry32)
function rngFrom(seed) {
  let a = Math.floor(seed * 4294967296) >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function buildVein(vein) {
  const def = ORE_TIERS[vein.tier];
  const T = RES.tiers[vein.tier];
  const rnd = rngFrom(vein.seed);
  const group = new THREE.Group();
  group.position.set(vein.x, 0, vein.z);
  group.rotation.y = rnd() * Math.PI * 2;

  // Roca
  const sx = 1.05 + rnd() * 0.45, sy = 0.8 + rnd() * 0.35, sz = 0.95 + rnd() * 0.4;
  const rock = new THREE.Mesh(
    RES.rockGeoms[Math.floor(rnd() * RES.rockGeoms.length)],
    vein.x < -1024 ? RES.rockMatWild : RES.rockMat,
  );
  rock.scale.set(sx, sy, sz);
  rock.position.y = 0.28 * sy;
  rock.userData = { kind: 'ore-vein', veinId: vein.id };
  group.add(rock);

  // Hitbox invisible y generosa (dedos en móvil). Es lo único que se raycastea.
  const hit = new THREE.Mesh(RES.hitGeom, RES.hitMat);
  hit.position.y = 0.9;
  hit.userData = { kind: 'ore-vein', veinId: vein.id };
  group.add(hit);

  // Cristales (más y más grandes cuanto mayor el tier)
  const crystals = new THREE.Group();
  const nCrystals = 3 + Math.min(4, def.tier) + Math.floor(rnd() * 2);
  for (let i = 0; i < nCrystals; i++) {
    const c = new THREE.Mesh(RES.crystalGeom, T.crystalMat);
    const ang = rnd() * Math.PI * 2;
    const r = 0.15 + rnd() * 0.45;
    const h = 0.35 + rnd() * 0.35;
    c.position.set(Math.cos(ang) * r * sx, h * sy + 0.1, Math.sin(ang) * r * sz);
    // Inclinados hacia fuera
    c.rotation.set((rnd() - 0.5) * 0.9, rnd() * Math.PI, (rnd() - 0.5) * 0.9);
    c.lookAt(c.position.x * 3, c.position.y + 2.2, c.position.z * 3);
    c.rotateX(Math.PI / 2);
    const s = 0.7 + rnd() * 0.5 + def.tier * 0.05;
    c.scale.setScalar(s);
    crystals.add(c);
  }
  group.add(crystals);

  // Halo de brillo
  const glow = new THREE.Sprite(T.glowMat);
  const gs = 1.3 + def.glowIntensity * 1.5;
  glow.scale.set(gs, gs, 1);
  glow.position.y = 1.05 + def.glowIntensity * 0.2;
  group.add(glow);

  // Chispitas
  const nSp = 5 + def.tier * 2;
  const pts = new Float32Array(nSp * 3);
  for (let i = 0; i < nSp; i++) {
    const a = rnd() * Math.PI * 2, r = 0.3 + rnd() * 0.9;
    pts[i * 3] = Math.cos(a) * r;
    pts[i * 3 + 1] = 0.4 + rnd() * 1.2;
    pts[i * 3 + 2] = Math.sin(a) * r;
  }
  const spGeo = new THREE.BufferGeometry();
  spGeo.setAttribute('position', new THREE.BufferAttribute(pts, 3));
  const sparkles = new THREE.Points(spGeo, T.sparkMat);
  group.add(sparkles);

  scene.add(group);
  pickMeshes.push(hit);
  const obj = { vein, def, group, rock, hit, crystals, glow, sparkles, depleted: false, phase: rnd() * 6.28 };
  veinObjs.set(vein.id, obj);
  if (depletedIds.has(vein.id)) setDepleted(obj, true);
  return obj;
}

function disposeVein(obj) {
  scene?.remove(obj.group);
  obj.sparkles.geometry.dispose();
  const i = pickMeshes.indexOf(obj.hit);
  if (i >= 0) pickMeshes.splice(i, 1);
  veinObjs.delete(obj.vein.id);
}

function setDepleted(obj, dep) {
  if (obj.depleted === dep) return;
  obj.depleted = dep;
  obj.crystals.visible = !dep;
  obj.glow.visible = !dep;
  obj.sparkles.visible = !dep;
  obj.rock.material = dep
    ? RES.rockMatDepleted
    : (obj.vein.x < -1024 ? RES.rockMatWild : RES.rockMat);
}

// ============================================================
// Fragmentos que saltan al picar
// ============================================================
function spawnBurst(obj, count, strong) {
  if (!scene) return;
  const T = RES.tiers[obj.vein.tier];
  for (let i = 0; i < count; i++) {
    const m = new THREE.Mesh(RES.fragGeom, strong ? T.fragMat : RES.rockMat);
    m.position.set(obj.vein.x + (Math.random() - 0.5) * 0.6, 0.7, obj.vein.z + (Math.random() - 0.5) * 0.6);
    const a = Math.random() * Math.PI * 2;
    const sp = 1.2 + Math.random() * 2.2;
    bursts.push({
      m, life: 0.7 + Math.random() * 0.3,
      vx: Math.cos(a) * sp, vy: 2.5 + Math.random() * 2.5, vz: Math.sin(a) * sp,
      rx: Math.random() * 10, rz: Math.random() * 10,
    });
    scene.add(m);
  }
}

function updateBursts(dt) {
  for (let i = bursts.length - 1; i >= 0; i--) {
    const b = bursts[i];
    b.life -= dt;
    b.vy -= 12 * dt;
    b.m.position.x += b.vx * dt;
    b.m.position.y = Math.max(0.03, b.m.position.y + b.vy * dt);
    b.m.position.z += b.vz * dt;
    b.m.rotation.x += b.rx * dt;
    b.m.rotation.z += b.rz * dt;
    if (b.life <= 0) {
      scene?.remove(b.m);
      bursts.splice(i, 1);
    }
  }
}

// ============================================================
// API pública
// ============================================================

/** Registra zonas sin árboles alrededor de cada veta. Llamar tras terrain.start. */
export function registerKeepouts(terrain) {
  try {
    for (const c of allVeinClusterCenters()) terrain.addKeepout?.(c.x, c.z, 2.6);
  } catch (err) {
    console.warn('[mining] registerKeepouts:', err?.message);
  }
}

export function start(opts) {
  if (started) stop();
  scene = opts.scene;
  getPlayer = opts.getPlayer;
  getCharacter = opts.getCharacter || (() => null);
  setPlayerTargetCb = opts.setPlayerTarget || (() => {});
  feedLog = opts.feedLog || (() => {});
  getSnapshot = opts.getSnapshot || (() => null);
  initResources();
  lastChunkKey = null;
  depletedIds = new Set();
  started = true;
  if (typeof window !== 'undefined') {
    const dbg = () => ({ active, loaded: veinObjs.size, depleted: [...depletedIds] });
    dbg.near = () => { const p = getPlayer?.(); return p ? veinsNear(p.position.x, p.position.z, 1) : []; };
    dbg.stop = () => stopMining('debug');
    window.__miningDebug = dbg;
  }
  console.log('[mining] started.');
}

export function stop() {
  if (!started) return;
  stopMining('module_stop');
  for (const obj of Array.from(veinObjs.values())) disposeVein(obj);
  for (const b of bursts) scene?.remove(b.m);
  bursts.length = 0;
  started = false;
  if (typeof window !== 'undefined') delete window.__miningDebug;
}

/** Vetas cargadas (para el minimapa). */
export function getLoadedVeins() {
  const out = [];
  for (const o of veinObjs.values()) out.push({ x: o.vein.x, z: o.vein.z, color: o.def.glow, depleted: o.depleted });
  return out;
}

function veinUnderRay(raycaster) {
  if (!started || pickMeshes.length === 0) return null;
  const hits = raycaster.intersectObjects(pickMeshes, false);
  if (!hits.length) return null;
  const id = hits[0].object.userData?.veinId;
  return (id && veinObjs.get(id)) || null;
}

function examine(obj) {
  const lvl = skills.getLevel?.('mining') ?? 1;
  const req = lvl >= obj.def.level ? '' : ` (tienes ${lvl})`;
  feedLog('info', `${obj.def.name}: requiere nivel ${obj.def.level} de Minería${req} · ${obj.def.xp} XP por mineral${obj.depleted ? ' · agotada' : ''}.`);
}

/**
 * Tap: si el rayo toca una veta, camina hasta ella y la pica.
 * Devuelve true si la consumió. `examineOnly` = solo info.
 */
export function tryHandleTap(raycaster, examineOnly = false) {
  const obj = veinUnderRay(raycaster);
  if (!obj) return false;
  if (examineOnly) { examine(obj); return true; }
  startMineAt(obj, skills.getLevel?.('mining') ?? 1);
  return true;
}

/**
 * Pulsación larga: menú "Minar / Examinar". `openMenu(title, rows, cx, cy)`
 * es npcRenderer.openGenericActionMenu. Devuelve true si había veta.
 */
export function openActionMenuAt(raycaster, cx, cy, openMenu) {
  const obj = veinUnderRay(raycaster);
  if (!obj) return false;
  openMenu(obj.def.name, [
    { label: '⛏ Minar', onPick: () => startMineAt(obj, skills.getLevel?.('mining') ?? 1) },
    { label: '🔍 Examinar', onPick: () => examine(obj) },
  ], cx, cy);
  return true;
}

/** true si ya está picando (en rango, dando golpes). */
export function isBusy() { return !!(active && active.started); }
/** true si hay minado pendiente (caminando hacia la veta o picando). */
export function isEngaged() { return !!active; }

function walkToVein(obj) {
  const player = getPlayer?.();
  if (!player) return;
  const dx = player.position.x - obj.vein.x;
  const dz = player.position.z - obj.vein.z;
  const d = Math.hypot(dx, dz);
  if (d > APPROACH_DIST_M) {
    const ux = d > 0 ? dx / d : 1, uz = d > 0 ? dz / d : 0;
    setPlayerTargetCb(obj.vein.x + ux * APPROACH_DIST_M, obj.vein.z + uz * APPROACH_DIST_M);
  }
}

function startMineAt(obj, lvl) {
  const player = getPlayer?.();
  if (!player) return;
  // El personaje SIEMPRE camina hacia la veta; si no puede picarla, avisa.
  walkToVein(obj);
  if (lvl < obj.def.level) {
    feedLog('error', `Necesitas nivel ${obj.def.level} de Minería para la ${obj.def.name.toLowerCase()}.`);
    return;
  }
  if (obj.depleted) {
    feedLog('info', 'Esta veta está agotada. Vuelve en un rato.');
    return;
  }
  const tool = equipment.findBestToolInInventory?.('pickaxe', inventory.getState?.() || []);
  if (!tool) {
    feedLog('error', 'Necesitas un pico. Lo venden en la tienda general.');
    return;
  }
  if (!tool.alreadyEquipped) {
    try { getCharacter?.()?.attachToolForGather?.(tool.item_id, tool.weapon_type); } catch {}
  }
  mineGen++;
  active = { id: obj.vein.id, lastAt: 0, fails: 0, waiting: false, started: false, tickMs: MIN_MINE_TICK_MS, gen: mineGen };
}

export function stopMining(reason = 'user') {
  if (!active) return;
  mineGen++;
  active = null;
  try { getCharacter?.()?.restoreWeapon?.(); } catch {}
  if (reason !== 'user' && reason !== 'tap_ground') console.log('[mining] stop:', reason);
}

/** Usado por skills/index.cancelAll (combate, muerte). */
export function cancel(reason = 'external') { stopMining(reason); }

export function update(dt) {
  if (!started) return;
  timeAcc += dt;
  const player = getPlayer?.();

  // ----- Cargar / descargar vetas por chunk -----
  chunkTimer += dt;
  if (player && chunkTimer >= 0.4) {
    chunkTimer = 0;
    const k = chunkKeyAt(player.position.x, player.position.z);
    const key = k.cx + ',' + k.cz;
    if (key !== lastChunkKey) {
      lastChunkKey = key;
      const want = new Set();
      for (const v of veinsNear(player.position.x, player.position.z, VIEW_RADIUS_CHUNKS)) {
        want.add(v.id);
        if (!veinObjs.has(v.id)) buildVein(v);
      }
      for (const obj of Array.from(veinObjs.values())) {
        if (!want.has(obj.vein.id) && obj.vein.id !== active?.id) disposeVein(obj);
      }
    }
  }

  // ----- Vetas agotadas (snapshot) -----
  depletedSyncTimer += dt;
  if (depletedSyncTimer >= 0.5) {
    depletedSyncTimer = 0;
    const snap = getSnapshot?.();
    if (snap && Array.isArray(snap.depleted_veins)) {
      const now = Date.now();
      const next = new Set();
      for (const d of snap.depleted_veins) if (!d.until || d.until > now - 2000) next.add(d.id);
      depletedIds = next;
      for (const obj of veinObjs.values()) setDepleted(obj, next.has(obj.vein.id));
    }
  }

  // ----- Animación: pulso de brillo + chispas -----
  for (const [tierId, T] of Object.entries(RES.tiers)) {
    const pulse = 0.75 + 0.25 * Math.sin(timeAcc * (1.6 + ORE_TIERS[tierId].tier * 0.15));
    T.crystalMat.emissiveIntensity = T.base * (0.7 + 0.5 * pulse);
    T.sparkMat.opacity = 0.35 + 0.55 * Math.abs(Math.sin(timeAcc * 2.3 + ORE_TIERS[tierId].tier));
  }
  for (const obj of veinObjs.values()) {
    if (!obj.depleted) {
      obj.sparkles.rotation.y = timeAcc * 0.35 + obj.phase;
      obj.sparkles.position.y = Math.sin(timeAcc * 1.2 + obj.phase) * 0.12;
    }
  }
  updateBursts(dt);

  // ----- Loop de picado -----
  if (!active || !player) return;
  const obj = veinObjs.get(active.id);
  if (!obj) { stopMining('vein_unloaded'); return; }
  const dx = player.position.x - obj.vein.x;
  const dz = player.position.z - obj.vein.z;
  const d2 = dx * dx + dz * dz;
  if (active.started && d2 > 12 * 12) { stopMining('walked_away'); return; }
  if (d2 > MAX_MINE_DIST_M * MAX_MINE_DIST_M) return;   // aún caminando

  if (!active.started) {
    active.started = true;
    feedLog('info', 'Empiezas a picar la veta...');
    try { getCharacter?.()?.faceTowards?.(obj.vein.x, obj.vein.z); } catch {}
  }
  const now = performance.now();
  if (active.waiting || now - active.lastAt < active.tickMs) return;
  active.lastAt = now;
  active.waiting = true;
  const ch = getCharacter?.();
  if (ch?.playGather) {
    const dur = ch.playGather('punching', 0);
    if (dur > 0) active.tickMs = Math.max(MIN_MINE_TICK_MS, dur);
  }
  // El golpe "suena" a mitad del swing.
  setTimeout(() => {
    if (!active || active.id !== obj.vein.id) return;
    audio.synth('mine_hit', { pitch: 0.92 + Math.random() * 0.16, volume: 0.8 });
    spawnBurst(obj, 4, false);
  }, 280);
  attemptMine(obj, active.gen).catch(err => console.warn('[mining] err:', err?.message));
}

async function attemptMine(obj, gen) {
  try {
    const res = await api.miningMine(obj.vein.id);
    if (gen !== mineGen) return;
    if (active) active.waiting = false;
    if (!res?.ok) return;
    if (active) active.fails = 0;
    if (!res.ore_gained) return;

    audio.synth('mine_ore', { volume: 0.7 });
    spawnBurst(obj, 7, true);
    try { await skills.reload(); } catch {}
    try { await window.inventory?.refresh?.(); } catch {}
    const oreName = ORE_TIERS[res.tier]?.name?.replace('Veta', 'Mineral') || res.ore_item;
    feedLog('xp', `+${res.xp_gained} XP Minería (${oreName})`);
    if (res.level_up) {
      feedLog('info', `¡Subes a nivel ${res.new_level} de Minería!`);
      try { window.__spawnLevelUpBanner?.('mining', res.new_level); } catch {}
    }
    if (res.depleted) {
      depletedIds.add(obj.vein.id);
      setDepleted(obj, true);
      audio.synth('vein_deplete', { volume: 0.6 });
      spawnBurst(obj, 10, false);
      feedLog('info', 'La veta se ha agotado.');
      stopMining('depleted');
    }
  } catch (err) {
    if (gen !== mineGen) return;
    if (active) active.waiting = false;
    const code = err?.code;
    if (code === 'vein_depleted') {
      depletedIds.add(obj.vein.id); setDepleted(obj, true);
      feedLog('info', 'La veta está agotada.'); stopMining('depleted');
    } else if (code === 'inventory_full') {
      feedLog('error', 'Mochila llena.'); stopMining('inventory_full');
    } else if (code === 'level_too_low' || code === 'no_pickaxe' || code === 'invalid_vein') {
      feedLog('error', err.message || 'No puedes picar aquí.'); stopMining(code);
    } else if (code === 'mining_disabled') {
      feedLog('error', 'Minería no disponible todavía.'); stopMining(code);
    } else if (code === 'too_fast') {
      // El server va un pelín más lento que la anim: reintenta al siguiente tick.
    } else {
      if (active) active.fails++;
      if (active && active.fails >= STOP_AFTER_FAILS) stopMining(code || 'errors');
    }
  }
}
