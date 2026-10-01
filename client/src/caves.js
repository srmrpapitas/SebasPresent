/**
 * SebasPresent — Montañas con cueva (Sesión 50), como en OSRS
 *
 * FUERA: cada cueva tiene su montaña con una boca oscura. Tocas la boca → vas
 *        andando → el server te mete dentro (POST /api/cave/enter).
 * DENTRO: la cueva es otra zona del mundo (x > 2300, fuera de la isla, ver
 *        shared/caves.js). Salas y túneles de roca, luz según el tipo (lava,
 *        hielo, fuego), vetas de mineral y enemigos de verdad (los pone el
 *        server). La salida brilla junto a donde apareces.
 *
 * El modo cueva se activa solo según dónde estés (sirve igual al entrar, al
 * conectarte dentro o al morir/teletransportarte fuera).
 */
import * as THREE from 'three';
import * as api from './api.js';
import { CAVE_LIST, caveAt, caveClearance, caveSpawn, caveExitMarker, mouthOutside, inCaveZone } from './shared/caves.js';

const MOUNTAIN_R = 20;          // radio de la base de la montaña (colisión)
const MOUTH_BACK = 15;          // la montaña está 15 m detrás de la boca
const MOUTH_Z = MOUTH_BACK - 2.2;
const LIGHT_I0 = 40, LIGHT_I = 60;   // luces de las salas (sala de entrada más blanca) // la boca, en local (la cara frontal acaba en ~12.6)

let scene = null, getPlayer = () => null, setPlayerTarget = () => {}, feedLog = () => {}, warp = null, onMode = () => {};
let started = false;
let outside = null;             // Group con las montañas
const mouthHits = [];
let active = null;              // { cave, group, saved }
let pending = null;             // { kind: 'enter'|'leave', cave, x, z }
let busy = false;
let t = 0;

const THEME = {
  lava_tube: { rock: 0x6a5446, floor: 0x4a3a30, accent: 0xff7a30, crystal: 0xff9a40, fog: 0x140c08 },
  ice:       { rock: 0x9ab6cc, floor: 0x6a8296, accent: 0x7fd4ff, crystal: 0xbfefff, fog: 0x0e1824 },
  fire:      { rock: 0x4a2a20, floor: 0x3a2018, accent: 0xff4a10, crystal: 0xff6a20, fog: 0x1a0805 },
};

// ------------------------------------------------------------
// Utilidades
// ------------------------------------------------------------
function rnd(seed) { let s = seed >>> 0 || 1; return () => { s = (s * 16807) % 2147483647; return s / 2147483647; }; }
function fwd(rot) { return { x: Math.sin(rot), z: Math.cos(rot) }; }

function signTexture(text, sub) {
  const c = document.createElement('canvas'); c.width = 512; c.height = 160;
  const g = c.getContext('2d');
  g.fillStyle = '#3a2614'; g.fillRect(0, 0, 512, 160);
  g.strokeStyle = '#c8a043'; g.lineWidth = 8; g.strokeRect(6, 6, 500, 148);
  g.fillStyle = '#f2d78a'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = 'bold 50px serif'; g.fillText(text, 256, sub ? 62 : 80);
  if (sub) { g.font = 'italic 30px serif'; g.fillStyle = '#e8c890'; g.fillText(sub, 256, 118); }
  const tx = new THREE.CanvasTexture(c); tx.colorSpace = THREE.SRGBColorSpace;
  return tx;
}
function signpost(text, sub) {
  const g = new THREE.Group();
  const wood = new THREE.MeshLambertMaterial({ color: 0x5a3a1a });
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 2.4, 6), wood); post.position.y = 1.2; g.add(post);
  const board = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.7, 0.08), wood); board.position.y = 2.1; g.add(board);
  const face = new THREE.Mesh(new THREE.PlaneGeometry(2.1, 0.66), new THREE.MeshBasicMaterial({ map: signTexture(text, sub) }));
  face.position.set(0, 2.1, 0.05); g.add(face);
  const back = face.clone(); back.rotation.y = Math.PI; back.position.z = -0.05; g.add(back);
  return g;
}

/** Montaña low-poly con la cara de la boca abierta. Coordenadas locales: la boca mira a +Z. */
function buildMountain(cave) {
  const T = THEME[cave.theme];
  const R = rnd(cave.id.length * 7919 + cave.mouth.x * 13);
  const geo = new THREE.IcosahedronGeometry(1, 4);
  const pos = geo.attributes.position, cols = [];
  const base = new THREE.Color(T.rock), snow = new THREE.Color(cave.theme === 'ice' ? 0xf4f8ff : cave.theme === 'fire' ? 0x3a1a10 : 0x6a5a48);
  const v = new THREE.Vector3();
  const H = cave.theme === 'ice' ? 34 : 28;
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const n = Math.sin(v.x * 5.1 + 1.3) * Math.cos(v.z * 4.7) * 0.12 + Math.sin(v.y * 7 + v.x * 3) * 0.06 + Math.sin(v.x * 17.3 + v.z * 11.1 + v.y * 13.7) * 0.03;
    let y = Math.max(0, v.y);
    const r = 1 + n;
    v.set(v.x * r * MOUNTAIN_R, y * H * (0.85 + n), v.z * r * MOUNTAIN_R);
    // la cara delantera (+Z) se recorta: pared casi vertical donde va la boca
    if (v.z > MOUTH_BACK - 3) v.z = MOUTH_BACK - 3 + (v.z - (MOUTH_BACK - 3)) * 0.08;
    pos.setXYZ(i, v.x, v.y, v.z);
    const k = Math.min(1, Math.max(0, (v.y / H - 0.55) * 2.5));
    const c = base.clone().lerp(snow, k).multiplyScalar(0.85 + R() * 0.3);
    cols.push(c.r, c.g, c.b);
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
  m.castShadow = true; m.receiveShadow = true;
  const g = new THREE.Group();
  g.add(m);
  // Boca: arco de roca + hueco negro
  const mouthZ = MOUTH_Z;
  const hole = new THREE.Mesh(new THREE.CircleGeometry(3.2, 20, 0, Math.PI), new THREE.MeshBasicMaterial({ color: 0x050403 }));
  hole.position.set(0, 0.02, mouthZ); g.add(hole);
  const holeLow = new THREE.Mesh(new THREE.PlaneGeometry(6.4, 0.4), new THREE.MeshBasicMaterial({ color: 0x050403 }));
  holeLow.position.set(0, 0.2, mouthZ); g.add(holeLow);
  const archMat = new THREE.MeshLambertMaterial({ color: new THREE.Color(T.rock).multiplyScalar(0.7), flatShading: true });
  const arch = new THREE.Mesh(new THREE.TorusGeometry(3.6, 0.75, 6, 14, Math.PI), archMat);
  arch.position.set(0, 0, mouthZ + 0.2); g.add(arch);
  // brillo que sale de dentro
  const glow = new THREE.Mesh(new THREE.CircleGeometry(2.4, 16, 0, Math.PI), new THREE.MeshBasicMaterial({ color: T.accent, transparent: true, opacity: 0.18, depthWrite: false }));
  glow.position.set(0, 0.03, mouthZ - 0.05); g.add(glow);
  // rocas sueltas
  for (let i = 0; i < 7; i++) {
    const rk = new THREE.Mesh(new THREE.DodecahedronGeometry(0.6 + R() * 1.1, 0), archMat);
    const side = i % 2 ? 1 : -1;
    rk.position.set(side * (4 + R() * 4), 0.3, mouthZ + 1 + R() * 3);
    rk.rotation.set(R() * 3, R() * 3, R() * 3); g.add(rk);
  }
  const sp = signpost(cave.name, cave.wild ? '☠ Wilderness' : null);
  sp.position.set(5.2, 0, mouthZ + 3.4); sp.rotation.y = -0.35; g.add(sp);
  // zona de toque (la boca)
  const hit = new THREE.Mesh(new THREE.BoxGeometry(7, 5, 3), new THREE.MeshBasicMaterial({ visible: false }));
  hit.position.set(0, 2.2, mouthZ + 0.8);
  hit.userData.cave = cave;
  g.add(hit); mouthHits.push(hit);
  // colocar: la boca en cave.mouth mirando a rot
  const f = fwd(cave.mouth.rot);
  g.position.set(cave.mouth.x - f.x * mouthZ, 0, cave.mouth.z - f.z * mouthZ);
  g.rotation.y = cave.mouth.rot;
  return g;
}

function mountainCenter(cave) {
  const f = fwd(cave.mouth.rot);
  const mz = MOUTH_Z;
  return { x: cave.mouth.x - f.x * mz, z: cave.mouth.z - f.z * mz };
}

// ------------------------------------------------------------
// Interior
// ------------------------------------------------------------
function buildInterior(cave) {
  const T = THEME[cave.theme];
  const R = rnd(cave.base.x * 31 + 7);
  const g = new THREE.Group(); g.userData.kind = 'cave';
  const B = cave.base;
  const floorMat = new THREE.MeshLambertMaterial({ color: T.floor });
  // Suelo: salas + túneles (algo más anchos que lo andable, para que la pared quede encima)
  for (const [x, z, r] of cave.rooms) {
    const f = new THREE.Mesh(new THREE.CircleGeometry(r + 2.5, 28), floorMat);
    f.rotation.x = -Math.PI / 2; f.position.set(B.x + x, 0.01, B.z + z); f.receiveShadow = true; g.add(f);
  }
  for (const [x1, z1, x2, z2, w] of cave.tunnels) {
    const L = Math.hypot(x2 - x1, z2 - z1);
    const f = new THREE.Mesh(new THREE.PlaneGeometry((w + 2.5) * 2, L), floorMat);
    f.rotation.x = -Math.PI / 2; f.rotation.z = -Math.atan2(x2 - x1, z2 - z1) + Math.PI;
    f.position.set(B.x + (x1 + x2) / 2, 0.012, B.z + (z1 + z2) / 2); f.receiveShadow = true; g.add(f);
  }
  // Paredes: rocas en el borde de lo andable (instanciadas)
  const pts = [];
  const tryPt = (wx, wz) => {
    const cl = caveClearance(cave, wx, wz);
    if (cl < -0.6 && cl > -3.2) pts.push([wx, wz]);
  };
  for (const [x, z, r] of cave.rooms) {
    const n = Math.ceil((2 * Math.PI * (r + 1.6)) / 1.7);
    for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; tryPt(B.x + x + Math.cos(a) * (r + 1.6), B.z + z + Math.sin(a) * (r + 1.6)); }
  }
  for (const [x1, z1, x2, z2, w] of cave.tunnels) {
    const L = Math.hypot(x2 - x1, z2 - z1), dx = (x2 - x1) / L, dz = (z2 - z1) / L;
    for (let s = 0; s <= L; s += 1.6) for (const side of [1, -1]) {
      tryPt(B.x + x1 + dx * s - dz * side * (w + 1.6), B.z + z1 + dz * s + dx * side * (w + 1.6));
    }
  }
  const rockGeo = new THREE.DodecahedronGeometry(1, 0);
  const rockMat = new THREE.MeshLambertMaterial({ color: T.rock, flatShading: true });
  const inst = new THREE.InstancedMesh(rockGeo, rockMat, pts.length * 2);
  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), S = new THREE.Vector3(), P = new THREE.Vector3(), E = new THREE.Euler();
  let k = 0;
  for (const [x, z] of pts) {
    for (let j = 0; j < 2; j++) {
      const h = j ? 2.5 + R() * 4 : 1.4 + R() * 1.6;
      S.set(1.5 + R() * 1.2, h, 1.5 + R() * 1.2);
      P.set(x + (R() - 0.5) * 0.8, j ? h * 0.75 : h * 0.4, z + (R() - 0.5) * 0.8);
      Q.setFromEuler(E.set(R() * 0.5, R() * 6, R() * 0.5));
      inst.setMatrixAt(k++, M.compose(P, Q, S));
    }
  }
  inst.count = k; inst.castShadow = true; g.add(inst);
  // Estalagmitas y cristales (en los bordes de las salas)
  const stal = new THREE.ConeGeometry(0.35, 1.8, 6);
  const crystalMat = new THREE.MeshStandardMaterial({ color: T.crystal, emissive: T.crystal, emissiveIntensity: 0.9, roughness: 0.25 });
  const stalMat = new THREE.MeshLambertMaterial({ color: new THREE.Color(T.rock).multiplyScalar(1.15), flatShading: true });
  for (const [x, z, r] of cave.rooms) {
    const n = Math.round(r / 2.2);
    for (let i = 0; i < n; i++) {
      const a = R() * Math.PI * 2, d = r - 1 - R() * 1.5;
      const isCrystal = R() < 0.45;
      const m = new THREE.Mesh(stal, isCrystal ? crystalMat : stalMat);
      const s = 0.6 + R() * 1.1;
      m.scale.set(s, s * (isCrystal ? 0.8 : 1.3), s);
      m.position.set(B.x + x + Math.cos(a) * d, 0.8 * s, B.z + z + Math.sin(a) * d);
      m.rotation.set((R() - 0.5) * 0.4, R() * 3, (R() - 0.5) * 0.4);
      g.add(m);
    }
  }
  // Charcos de lava / hielo brillante (decoración, no se pisan: van pegados a la pared)
  if (cave.theme !== 'ice') {
    const lavaMat = new THREE.MeshBasicMaterial({ color: T.accent });
    for (const [x, z, r] of cave.rooms.slice(1)) {
      const a = R() * Math.PI * 2;
      const pool = new THREE.Mesh(new THREE.CircleGeometry(1.3 + R(), 12), lavaMat);
      pool.rotation.x = -Math.PI / 2;
      pool.position.set(B.x + x + Math.cos(a) * (r - 1.2), 0.03, B.z + z + Math.sin(a) * (r - 1.2));
      g.add(pool); g.userData.pools = (g.userData.pools || []).concat(pool);
    }
  }
  // Luces: una por sala (con parpadeo suave)
  const lights = [];
  cave.rooms.forEach(([x, z, r], i) => {
    const L = new THREE.PointLight(i === 0 ? 0xffe0b0 : cave.light, i === 0 ? LIGHT_I0 : LIGHT_I, r * 4.5, 1);
    L.position.set(B.x + x, 7, B.z + z); g.add(L); lights.push(L);
  });
  g.userData.lights = lights;
  // Salida: luz de día que entra + cartel
  const ex = caveExitMarker(cave);
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.8, 9, 14, 1, true), new THREE.MeshBasicMaterial({ color: 0xfff2c8, transparent: true, opacity: 0.1, side: THREE.DoubleSide, depthWrite: false }));
  shaft.position.set(ex.x, 4.5, ex.z); g.add(shaft);
  const spot = new THREE.Mesh(new THREE.CircleGeometry(2, 18), new THREE.MeshBasicMaterial({ color: 0xfff2c8, transparent: true, opacity: 0.35, depthWrite: false }));
  spot.rotation.x = -Math.PI / 2; spot.position.set(ex.x, 0.03, ex.z); g.add(spot);
  const sp = signpost('Salida', cave.name); sp.position.set(ex.x + 2.6, 0, ex.z + 0.6); sp.rotation.y = Math.PI; g.add(sp);
  const exitHit = new THREE.Mesh(new THREE.CylinderGeometry(2, 2, 6, 10), new THREE.MeshBasicMaterial({ visible: false }));
  exitHit.position.set(ex.x, 3, ex.z); exitHit.userData.exit = cave; g.add(exitHit);
  g.userData.exitHit = exitHit;
  return g;
}

function activate(cave) {
  if (active?.cave === cave) return;
  if (active) deactivate();
  const group = buildInterior(cave);
  scene.add(group);
  const T = THEME[cave.theme];
  const saved = { bg: scene.background?.clone?.(), fogColor: scene.fog?.color?.clone?.(), near: scene.fog?.near, far: scene.fog?.far };
  if (scene.background?.setHex) scene.background.setHex(T.fog);
  if (scene.fog) { scene.fog.color.setHex(T.fog); scene.fog.near = 30; scene.fog.far = 120; }
  active = { cave, group, saved };
  try { onMode(true); } catch {}
  feedLog('info', `🕳️ ${cave.name}. ${cave.blurb}`);
}
function deactivate() {
  if (!active) return;
  try { scene.remove(active.group); } catch {}
  active.group.traverse(o => { if (o.geometry) o.geometry.dispose?.(); });
  const s = active.saved;
  if (s.bg && scene.background?.copy) scene.background.copy(s.bg);
  if (scene.fog && s.fogColor) { scene.fog.color.copy(s.fogColor); scene.fog.near = s.near; scene.fog.far = s.far; }
  active = null;
  try { onMode(false); } catch {}
}

// ------------------------------------------------------------
// Entrar / salir
// ------------------------------------------------------------
async function doEnter(cave) {
  if (busy) return; busy = true;
  try {
    const r = await api.tradeCall('/api/cave/enter', { cave: cave.id });
    warp?.(r.x, r.z);
    activate(cave);
  } catch (e) { feedLog('warning', `🕳️ ${e.message || 'No puedes entrar ahora.'}`); }
  finally { busy = false; }
}
async function doLeave(cave) {
  if (busy) return; busy = true;
  try {
    const r = await api.tradeCall('/api/cave/leave', {});
    deactivate();
    warp?.(r.x, r.z);
    feedLog('info', `☀️ Sales de la ${cave.name}.`);
  } catch (e) { feedLog('warning', `🕳️ ${e.message || 'No puedes salir ahora.'}`); }
  finally { busy = false; }
}

// ------------------------------------------------------------
// API pública
// ------------------------------------------------------------
export function isActive() { return !!active; }
export function current() { return active?.cave || null; }

export function registerKeepouts(terrain) {
  for (const c of CAVE_LIST) {
    const m = mountainCenter(c);
    try { terrain.addKeepout?.(m.x, m.z, MOUNTAIN_R + 8); terrain.clearTreesNear?.(m.x, m.z, MOUNTAIN_R + 8); } catch {}
  }
}

export function start(opts) {
  stop();
  scene = opts.scene; getPlayer = opts.getPlayer || (() => null);
  setPlayerTarget = opts.setPlayerTarget || (() => {});
  feedLog = opts.feedLog || (() => {}); warp = opts.warp || null; onMode = opts.onMode || (() => {});
  outside = new THREE.Group(); outside.userData.kind = 'mountains';
  for (const c of CAVE_LIST) outside.add(buildMountain(c));
  scene.add(outside);
  started = true;
}
export function stop() {
  deactivate();
  if (outside && scene) scene.remove(outside);
  outside = null; mouthHits.length = 0; pending = null; started = false;
}

export function tryHandleTap(raycaster) {
  if (!started) return false;
  const p = getPlayer(); if (!p) return false;
  if (active) {
    const h = raycaster.intersectObject(active.group.userData.exitHit, false);
    if (!h.length) return false;
    const ex = caveExitMarker(active.cave);
    pending = { kind: 'leave', cave: active.cave, x: ex.x, z: ex.z };
    setPlayerTarget(ex.x, ex.z + 1.2);
    return true;
  }
  const hits = raycaster.intersectObjects(mouthHits, false);
  if (!hits.length) return false;
  const cave = hits[0].object.userData.cave;
  const o = mouthOutside(cave);
  pending = { kind: 'enter', cave, x: cave.mouth.x, z: cave.mouth.z };
  setPlayerTarget(o.x, o.z);
  return true;
}
export function cancel() { pending = null; }

export function update(dt) {
  if (!started) return;
  t += dt;
  const p = getPlayer();
  if (!p) return;
  // modo cueva según dónde estés
  const c = caveAt(p.position.x, p.position.z);
  if (c && active?.cave !== c) activate(c);
  else if (!c && active && !busy) deactivate();
  if (active) {
    for (const [i, L] of (active.group.userData.lights || []).entries()) L.intensity = (i === 0 ? LIGHT_I0 : LIGHT_I) * (0.88 + Math.sin(t * 7 + i * 2) * 0.06 + Math.sin(t * 13 + i) * 0.04);
    for (const pool of active.group.userData.pools || []) pool.scale.setScalar(1 + Math.sin(t * 2 + pool.position.x) * 0.04);
  }
  if (pending && !busy) {
    const d = Math.hypot(p.position.x - pending.x, p.position.z - pending.z);
    if (d <= 7) { const q = pending; pending = null; if (q.kind === 'enter') doEnter(q.cave); else doLeave(q.cave); }
  }
}

/** Dentro: no se sale de lo andable. Fuera: no se atraviesa la montaña. */
export function applyCollision(x0, z0, x1, z1) {
  if (active) {
    const c = active.cave;
    if (caveClearance(c, x1, z1) >= 0.45) return { x: x1, z: z1 };
    if (caveClearance(c, x1, z0) >= 0.45) return { x: x1, z: z0 };
    if (caveClearance(c, x0, z1) >= 0.45) return { x: x0, z: z1 };
    return { x: x0, z: z0 };
  }
  if (inCaveZone(x1, z1)) return { x: x1, z: z1 };
  let x = x1, z = z1;
  for (const cv of CAVE_LIST) {
    const m = mountainCenter(cv);
    const dx = x - m.x, dz = z - m.z, d = Math.hypot(dx, dz);
    if (d >= MOUNTAIN_R || d < 1e-4) continue;
    // a local (la boca mira a +Z): la cara frontal es un plano en lz = FRONT
    const f = fwd(cv.mouth.rot), lz = dx * f.x + dz * f.z;
    const FRONT = MOUTH_Z - 0.6;
    if (lz >= FRONT) continue;                       // delante de la pared: libre
    const toCircle = MOUNTAIN_R - d, toFront = FRONT - lz;
    if (toFront < toCircle) { x += f.x * toFront; z += f.z * toFront; }
    else { x = m.x + dx / d * MOUNTAIN_R; z = m.z + dz / d * MOUNTAIN_R; }
  }
  return { x, z };
}

export function getMapIcons() {
  return CAVE_LIST.map(c => ({ x: c.mouth.x, z: c.mouth.z, kind: 'cave', name: c.name }));
}
