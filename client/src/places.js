/**
 * SebasPresent — Lugares de verdad (Sesión 53)
 *
 * Los sitios del mapa eran una columna con un cono (terrain.js). Aquí se
 * construyen como lugares de verdad, con piezas low-poly:
 *   - todas las piezas estáticas se FUNDEN por material (pocas llamadas de dibujo
 *     aunque haya cientos de piezas: va bien en el móvil);
 *   - lo que se mueve (cúpulas que giran, luces que parpadean) va aparte;
 *   - farolas y ventanas brillan de noche (material emissive, sin luces nuevas);
 *   - colisiones (círculos y cajas giradas) para no atravesar nada;
 *   - solo se construyen cerca del jugador (≤ 420 m).
 *
 * Uso: places.start({ scene, getPlayer, isNight, terrain }); places.update(dt); places.stop();
 *      places.applyCollision(x0, z0, x1, z1)
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const BUILD_DIST = 420, DROP_DIST = 520;

let scene = null, getPlayer = () => null, isNight = () => false;
let started = false, t = 0, syncT = 99;
const built = new Map();   // id → { group, update, night: [mats] }

// ------------------------------------------------------------
// Materiales compartidos
// ------------------------------------------------------------
let M = null;
function mats() {
  if (M) return M;
  const L = (color, extra = {}) => new THREE.MeshLambertMaterial({ color, flatShading: true, ...extra });
  M = {
    white: L(0xf2f0ea), whiteD: L(0xd8d4ca), grey: L(0x8a8a88), greyD: L(0x5a5a58), dark: L(0x2a2a2e),
    stone: L(0x7d776c), stoneD: L(0x5e584f), lava: L(0x3a3430), gravel: L(0xb9ad98), path: L(0xa89a80),
    wood: L(0x7a5230), woodD: L(0x4e331c), woodL: L(0xa07448), metal: L(0x9aa2aa, { }), brass: L(0xc89a3a),
    glass: L(0x7fb4d8), red: L(0xb0302a), green: L(0x3f6a3a), blue: L(0x2f4f8a), canvas: L(0xe8dcc0),
    leaf: L(0x4f7a3a), leafD: L(0x3a5a2c), pot: L(0x9a5a3a), straw: L(0xc8b070),
    // de noche brillan (ver update)
    lamp: new THREE.MeshLambertMaterial({ color: 0xfff2c0, emissive: 0xffc860, emissiveIntensity: 0.15, flatShading: true }),
    window: new THREE.MeshLambertMaterial({ color: 0x7fb4d8, emissive: 0xffd890, emissiveIntensity: 0.0, flatShading: true }),
    slit: new THREE.MeshLambertMaterial({ color: 0x14141a, emissive: 0x6a8cff, emissiveIntensity: 0.0, flatShading: true }),
    beacon: new THREE.MeshBasicMaterial({ color: 0xff2a1a }),
    fire: new THREE.MeshBasicMaterial({ color: 0xffa040, transparent: true, opacity: 0.9 }),
  };
  return M;
}

// ------------------------------------------------------------
// Kit: piezas que se funden por material
// ------------------------------------------------------------
class Kit {
  constructor() { this.parts = new Map(); this.tmp = new THREE.Object3D(); }
  _push(geom, mat, x, y, z, ry = 0, rx = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
    const o = this.tmp;
    o.position.set(x, y, z); o.rotation.set(rx, ry, rz); o.scale.set(sx, sy, sz); o.updateMatrix();
    const g = geom.index ? geom.toNonIndexed() : geom.clone();
    g.applyMatrix4(o.matrix);
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
    if (!this.parts.has(mat)) this.parts.set(mat, []);
    this.parts.get(mat).push(g);
    return this;
  }
  box(w, h, d, mat, x, y, z, ry = 0) { return this._push(new THREE.BoxGeometry(w, h, d), mat, x, y, z, ry); }
  cyl(rt, rb, h, mat, x, y, z, seg = 12, ry = 0) { return this._push(new THREE.CylinderGeometry(rt, rb, h, seg), mat, x, y, z, ry); }
  dome(r, mat, x, y, z, seg = 16) { return this._push(new THREE.SphereGeometry(r, seg, Math.max(6, seg >> 1), 0, Math.PI * 2, 0, Math.PI / 2), mat, x, y, z); }
  ico(r, mat, x, y, z, detail = 0) { return this._push(new THREE.IcosahedronGeometry(r, detail), mat, x, y, z); }
  cone(r, h, mat, x, y, z, seg = 8, ry = 0) { return this._push(new THREE.ConeGeometry(r, h, seg), mat, x, y, z, ry); }
  disc(r, mat, x, y, z, seg = 32) { return this._push(new THREE.CircleGeometry(r, seg), mat, x, y, z, 0, -Math.PI / 2); }
  plane(w, d, mat, x, y, z, ry = 0) { return this._push(new THREE.PlaneGeometry(w, d), mat, x, y, z, ry, -Math.PI / 2); }
  raw(geom, mat, x, y, z, ry = 0, rx = 0, rz = 0) { return this._push(geom, mat, x, y, z, ry, rx, rz); }
  /** Funde todo y devuelve un grupo con una malla por material. */
  build() {
    const g = new THREE.Group();
    for (const [mat, list] of this.parts) {
      const merged = mergeGeometries(list, false);
      for (const l of list) l.dispose();
      if (!merged) continue;
      merged.computeBoundingSphere();
      const mesh = new THREE.Mesh(merged, mat);
      mesh.matrixAutoUpdate = false;
      g.add(mesh);
    }
    return g;
  }
}

// Halo de las farolas (sprite aditivo; solo se ve de noche)
let _halo = null;
function haloMat() {
  if (_halo) return _halo;
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,220,140,0.95)'); grd.addColorStop(0.35, 'rgba(255,190,90,0.45)'); grd.addColorStop(1, 'rgba(255,170,60,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
  _halo = new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 });
  return _halo;
}

// Cartel de madera con texto
function signTex(title, sub = '') {
  const c = document.createElement('canvas'); c.width = 512; c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#6a4424'; g.fillRect(0, 0, 512, 256);
  g.fillStyle = '#7e5430'; for (let y = 0; y < 256; y += 32) g.fillRect(0, y, 512, 14);
  g.strokeStyle = '#3a2210'; g.lineWidth = 10; g.strokeRect(5, 5, 502, 246);
  g.fillStyle = '#ffe8b0'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = 'bold 50px Georgia, serif'; g.fillText(title, 256, sub ? 100 : 128);
  if (sub) { g.font = 'italic 32px Georgia, serif'; g.fillStyle = '#f0d898'; g.fillText(sub, 256, 175); }
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
function addSign(group, title, sub, x, z, ry = 0) {
  const s = new THREE.Group();
  s.position.set(x, 0, z); s.rotation.y = ry;
  const post = new THREE.Mesh(new THREE.BoxGeometry(0.18, 2.6, 0.18), mats().woodD);
  post.position.set(-1.25, 1.3, 0); s.add(post);
  const post2 = post.clone(); post2.position.x = 1.25; s.add(post2);
  const tex = signTex(title, sub);
  for (const side of [1, -1]) {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 1.3), new THREE.MeshBasicMaterial({ map: tex }));
    p.position.set(0, 2.05, side * 0.06); if (side < 0) p.rotation.y = Math.PI; s.add(p);
  }
  group.add(s);
}

// ------------------------------------------------------------
// Colisiones
// ------------------------------------------------------------
const circles = [];   // { x, z, r, id }
const boxes = [];     // { x, z, c, s, hx, hz, id }
function colCircle(id, x, z, r) { circles.push({ id, x, z, r }); }
function colBox(id, x, z, hx, hz, rot = 0) { boxes.push({ id, x, z, c: Math.cos(rot), s: Math.sin(rot), hx, hz }); }
function dropCols(id) {
  for (let i = circles.length - 1; i >= 0; i--) if (circles[i].id === id) circles.splice(i, 1);
  for (let i = boxes.length - 1; i >= 0; i--) if (boxes[i].id === id) boxes.splice(i, 1);
}

export function applyCollision(x0, z0, x1, z1) {
  if (!started) return { x: x1, z: z1 };
  let x = x1, z = z1;
  const R = 0.35;
  for (const c of circles) {
    const dx = x - c.x, dz = z - c.z;
    if (Math.abs(dx) > c.r + 2 || Math.abs(dz) > c.r + 2) continue;
    const d = Math.hypot(dx, dz), min = c.r + R;
    if (d < min) { const k = (min - d) / (d || 1); x += dx * k; z += dz * k; }
  }
  for (const b of boxes) {
    const dx = x - b.x, dz = z - b.z;
    if (Math.abs(dx) > 20 || Math.abs(dz) > 20) continue;
    let lx = dx * b.c - dz * b.s, lz = dx * b.s + dz * b.c;
    const px = b.hx + R - Math.abs(lx), pz = b.hz + R - Math.abs(lz);
    if (px > 0 && pz > 0) {
      if (px < pz) lx += Math.sign(lx || 1) * px; else lz += Math.sign(lz || 1) * pz;
      x = b.x + lx * b.c + lz * b.s; z = b.z - lx * b.s + lz * b.c;
    }
  }
  return { x, z };
}

// ------------------------------------------------------------
// OBSERVATORIO DE IZAÑA — cúpulas blancas, torre solar, radiotelescopio,
// laboratorio, telescopio de latón, farolas y una baliza roja en la torre.
// ------------------------------------------------------------
export const IZANA = { id: 'izana', x: 390, z: -912, r: 34 };

function buildIzana() {
  const m = mats();
  const C = IZANA, k = new Kit(), id = C.id;
  const W = (lx, lz) => [C.x + lx, C.z + lz];   // local → mundo (sin giro)
  const group = new THREE.Group();
  const anim = [];

  // Suelo: explanada de picón y caminos
  k.disc(30, m.gravel, C.x, 0.03, C.z, 40);
  k.plane(4, 26, m.path, C.x + 10, 0.05, C.z + 22, 0.55);   // camino hacia Eldric y la carretera
  k.plane(3.2, 18, m.path, C.x - 6, 0.05, C.z - 2, 1.2);

  // Muro bajo de piedra en arco (con entradas)
  for (let i = 0; i < 40; i++) {
    const a = (i / 40) * Math.PI * 2;
    if ((a > 0.55 && a < 1.15) || (a > 3.3 && a < 3.7)) continue;   // entradas (sureste y oeste)
    const [x, z] = W(Math.cos(a) * 30.5, Math.sin(a) * 30.5);
    k.box(4.9, 0.9, 0.7, (i % 3) ? m.stone : m.stoneD, x, 0.45, z, -a + Math.PI / 2);
  }

  // Cúpulas de telescopio (blancas, con rendija y puerta)
  const DOMES = [[-15, -8, 3.4, 4.2], [-3, -19, 2.8, 3.6], [10, -16, 2.6, 3.4], [-18, 9, 4.4, 5.2]];
  for (const [lx, lz, r, h] of DOMES) {
    const [x, z] = W(lx, lz);
    k.cyl(r + 0.25, r + 0.4, 0.5, m.greyD, x, 0.25, z, 20);
    k.cyl(r, r, h, m.white, x, 0.5 + h / 2, z, 20);
    k.cyl(r + 0.08, r + 0.08, 0.18, m.whiteD, x, 0.5 + h, z, 20);
    // la cúpula gira (aparte, no se funde)
    const domeG = new THREE.Group(); domeG.position.set(x, 0.5 + h + 0.09, z);
    const dm = new THREE.Mesh(new THREE.SphereGeometry(r, 18, 9, 0, Math.PI * 2, 0, Math.PI / 2), m.white); domeG.add(dm);
    const slit = new THREE.Mesh(new THREE.BoxGeometry(r * 0.42, r * 0.95, r * 0.9), m.slit);
    slit.position.set(0, r * 0.5, r * 0.55); slit.rotation.x = -0.55; domeG.add(slit);
    domeG.rotation.y = (lx * 13 + lz * 7) % 6;
    group.add(domeG);
    anim.push((dt) => { if (isNight()) domeG.rotation.y += dt * 0.04; });
    // puerta y escalón (mirando al centro)
    const ang = Math.atan2(-lx, -lz);
    const dx = Math.sin(ang), dz = Math.cos(ang);
    k.box(1.2, 2.2, 0.15, m.blue, x + dx * (r + 0.02), 1.6, z + dz * (r + 0.02), ang);
    k.box(1.8, 0.25, 1.0, m.greyD, x + dx * (r + 0.5), 0.12, z + dz * (r + 0.5), ang);
    colCircle(id, x, z, r + 0.3);
  }

  // Torre solar (alta, con cúpula y baliza roja)
  {
    const [x, z] = W(13, 3);
    k.box(4.2, 0.6, 4.2, m.greyD, x, 0.3, z);
    k.box(3.4, 15, 3.4, m.white, x, 7.8, z);
    for (let y = 3; y < 15; y += 3) k.box(3.5, 0.15, 3.5, m.whiteD, x, y, z);
    for (let y = 2.2; y < 14; y += 3) for (const [wx, wz] of [[0, 1.72], [0, -1.72]]) k.box(0.9, 1.1, 0.06, m.window, x + wx, y, z + wz);
    k.box(4.2, 0.35, 4.2, m.whiteD, x, 15.4, z);
    k.dome(1.9, m.white, x, 15.55, z, 16);
    k.cyl(0.08, 0.08, 2.2, m.metal, x + 1.4, 16.6, z + 1.4, 6);
    const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 6), m.beacon);
    beacon.position.set(x + 1.4, 17.8, z + 1.4); group.add(beacon);
    anim.push(() => { beacon.visible = (t % 2) < 1.1; });
    k.box(1.3, 2.3, 0.1, m.blue, x, 1.75, z + 1.75);
    colBox(id, x, z, 2.1, 2.1);
  }

  // Radiotelescopio (plato grande sobre pedestal)
  {
    const [x, z] = W(21, -12);
    k.cyl(1.0, 1.4, 1.2, m.greyD, x, 0.6, z, 10);
    k.cyl(0.45, 0.6, 4.2, m.grey, x, 3.3, z, 10);
    const dish = new THREE.Group(); dish.position.set(x, 5.6, z);
    const plate = new THREE.Mesh(new THREE.SphereGeometry(4.2, 20, 8, 0, Math.PI * 2, 0, Math.PI / 5), m.whiteD);
    plate.material.side = THREE.DoubleSide;
    plate.rotation.x = Math.PI; plate.position.y = 4.2; dish.add(plate);
    const feedArm = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 3.6, 6), m.metal); feedArm.position.y = 1.4; dish.add(feedArm);
    const feed = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.35, 0.6, 8), m.grey); feed.position.y = 3.1; dish.add(feed);
    dish.rotation.z = 0.55;
    group.add(dish);
    anim.push((dt) => { dish.rotation.y += dt * 0.05; });
    colCircle(id, x, z, 1.6);
  }

  // Laboratorio (edificio blanco y bajo con ventanas, antenas y placas solares)
  {
    const [x, z] = W(2, 14);
    k.box(12.5, 0.4, 7.5, m.greyD, x, 0.2, z);
    k.box(12, 3.4, 7, m.white, x, 2.1, z);
    k.box(12.4, 0.3, 7.4, m.whiteD, x, 3.95, z);
    for (const wx of [-4.2, -1.5, 3.2, 5.0]) k.box(1.4, 1.2, 0.08, m.window, x + wx, 2.2, z + 3.52);
    for (const wx of [-4, 0, 4]) k.box(1.4, 1.2, 0.08, m.window, x + wx, 2.2, z - 3.52);
    k.box(1.4, 2.4, 0.12, m.blue, x + 1.0, 1.6, z + 3.55);
    k.box(2.6, 0.15, 1.4, m.whiteD, x + 1.0, 3.0, z + 4.1);   // tejadillo
    for (const [px, pz] of [[-3.5, -1.5], [-1, -1.5], [1.5, -1.5]]) k.box(2.2, 0.08, 1.4, m.blue, x + px, 4.5, z + pz, 0);
    for (const [px, pz] of [[-3.5, -1.5], [-1, -1.5], [1.5, -1.5]]) k.box(0.1, 0.5, 0.1, m.metal, x + px, 4.25, z + pz);
    k.cyl(0.05, 0.05, 3, m.metal, x + 5, 5.5, z - 2, 6); k.cyl(0.04, 0.04, 2, m.metal, x + 4.4, 5.0, z - 2.6, 6);
    k.box(1.2, 0.06, 0.06, m.metal, x + 5, 6.4, z - 2); k.box(0.8, 0.06, 0.06, m.metal, x + 5, 6.0, z - 2);
    colBox(id, x, z, 6.1, 3.6);
    // cajas y barriles junto al laboratorio
    for (const [bx, bz, s] of [[7.6, 2.4, 1.0], [8.5, 1.2, 0.8], [7.5, 0.6, 0.7]]) k.box(s, s, s, m.woodL, x + bx, s / 2, z + bz, bx);
    for (const [bx, bz] of [[-7.4, 2.8], [-7.6, 1.6]]) { k.cyl(0.42, 0.42, 1.0, m.wood, x + bx, 0.5, z + bz, 10); k.cyl(0.44, 0.44, 0.08, m.dark, x + bx, 0.75, z + bz, 10); }
    colCircle(id, x + 8, z + 1.5, 1.2);
  }

  // Telescopio de latón en trípode, banco y mapa de estrellas
  {
    const [x, z] = W(1, 1);
    for (let i = 0; i < 3; i++) { const a = i / 3 * Math.PI * 2; k.raw(new THREE.CylinderGeometry(0.05, 0.05, 1.7, 6), m.woodD, x + Math.cos(a) * 0.35, 0.8, z + Math.sin(a) * 0.35, 0, Math.cos(a) * 0.25, -Math.sin(a) * 0.25); }
    k.raw(new THREE.CylinderGeometry(0.13, 0.2, 1.9, 10), m.brass, x, 1.95, z + 0.2, 0.3, 0.9, 0);
    k.raw(new THREE.CylinderGeometry(0.22, 0.22, 0.12, 10), m.dark, x + 0.2, 2.5, z + 0.95, 0.3, 0.9, 0);
    colCircle(id, x, z, 0.6);
    for (const [bx, bz, r] of [[-3, 4, 0.2], [5, -5, 1.3]]) {
      k.box(2.2, 0.12, 0.6, m.woodL, x + bx, 0.55, z + bz, r);
      for (const s of [-0.9, 0.9]) k.box(0.12, 0.5, 0.5, m.woodD, x + bx + Math.cos(r) * s, 0.25, z + bz - Math.sin(r) * s, r);
    }
  }
  addSign(group, 'Observatorio', 'de Izaña', C.x + 24, C.z + 18, -0.9);
  addSign(group, 'Mapa del cielo', 'Constelaciones de Achinech', C.x - 4, C.z + 3.5, 0.3);

  // Farolas alrededor de la explanada (brillan de noche, con halo)
  const halo = haloMat();
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + 0.2;
    const [x, z] = W(Math.cos(a) * 25, Math.sin(a) * 25);
    k.cyl(0.08, 0.11, 3.4, m.dark, x, 1.7, z, 6);
    k.box(0.35, 0.1, 0.35, m.dark, x, 3.45, z);
    k.box(0.28, 0.42, 0.28, m.lamp, x, 3.75, z);
    const h = new THREE.Sprite(halo); h.position.set(x, 3.75, z); h.scale.set(2.4, 2.4, 1); group.add(h);
    k.cone(0.3, 0.25, m.dark, x, 4.08, z, 4, Math.PI / 4);
    colCircle(id, x, z, 0.2);
  }
  // Retamas del Teide alrededor (blancas y verdes)
  for (let i = 0; i < 26; i++) {
    const a = i * 2.39996, d = 33 + (i % 5) * 2.2;
    const [x, z] = W(Math.cos(a) * d, Math.sin(a) * d);
    k.ico(0.7 + (i % 3) * 0.25, (i % 2) ? m.leaf : m.leafD, x, 0.5, z);
  }

  group.add(k.build());
  return {
    group,
    keepout: { x: C.x, z: C.z, r: 36 },
    update: (dt) => { for (const f of anim) f(dt); },
  };
}

const SETS = [{ id: IZANA.id, x: IZANA.x, z: IZANA.z, build: buildIzana }];

// ------------------------------------------------------------
// API
// ------------------------------------------------------------
export function registerKeepouts(terrain) {
  for (const s of SETS) {
    try { terrain.addKeepout?.(s.x, s.z, 37); terrain.clearTreesNear?.(s.x, s.z, 37); } catch {}
  }
}

export function start(opts) {
  scene = opts.scene;
  getPlayer = opts.getPlayer || getPlayer;
  isNight = opts.isNight || isNight;
  started = true;
  syncT = 99;
  if (typeof window !== 'undefined') window.__places = { built: () => [...built.keys()], night: () => ({ nightNow, isN: isNight(), lamp: M?.lamp.emissiveIntensity, halo: _halo?.opacity }), meshes: () => { const out = []; for (const b of built.values()) b.group.traverse(o => { if (o.isMesh || o.isSprite) out.push([o.type, o.material?.emissiveIntensity ?? o.material?.opacity, o.visible, o.parent?.visible, !!o.geometry?.attributes?.position?.count]); }); return out.filter(x => x[1] > 0.5).slice(0, 12); } };
}

export function stop() {
  for (const [id, b] of built) { scene?.remove(b.group); disposeGroup(b.group); dropCols(id); }
  built.clear();
  started = false;
}

function disposeGroup(g) {
  g.traverse(o => { o.geometry?.dispose?.(); if (o.material?.map) o.material.map.dispose(); });
}

let nightNow = null;
export function update(dt) {
  if (!started) return;
  t += dt;
  syncT += dt;
  if (syncT > 1.5) {
    syncT = 0;
    const p = getPlayer?.();
    if (p) for (const s of SETS) {
      const d = Math.hypot(p.position.x - s.x, p.position.z - s.z);
      if (d < BUILD_DIST && !built.has(s.id)) {
        try { const b = s.build(); scene.add(b.group); built.set(s.id, b); } catch (e) { console.warn('[places]', s.id, e); }
      } else if (d > DROP_DIST && built.has(s.id)) {
        const b = built.get(s.id); scene.remove(b.group); disposeGroup(b.group); dropCols(s.id); built.delete(s.id);
      }
    }
    // De noche se encienden farolas y ventanas
    const n = !!isNight();
    if (n !== nightNow && M) {
      nightNow = n;
      M.lamp.emissiveIntensity = n ? 1.6 : 0.15;
      M.window.emissiveIntensity = n ? 0.9 : 0.0;
      M.slit.emissiveIntensity = n ? 0.8 : 0.0;
      if (_halo) _halo.opacity = n ? 0.85 : 0;
    }
  }
  for (const b of built.values()) { try { b.update?.(dt); } catch {} }
}
