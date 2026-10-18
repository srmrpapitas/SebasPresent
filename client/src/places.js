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
import { buildCasa } from './houses.js';   // casas canarias (se funden en el kit)

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
  /** Funde un grupo ya hecho (p. ej. una casa de houses.js) en (x, z) con giro ry. */
  group(g, x, z, ry = 0) {
    const root = new THREE.Group(); root.position.set(x, 0, z); root.rotation.y = ry; root.add(g);
    root.updateMatrixWorld(true);
    g.traverse(o => {
      if (!o.isMesh || Array.isArray(o.material)) return;
      if (o.material.map) { this.loose = this.loose || []; const c = o.clone(); c.matrix.copy(o.matrixWorld); c.matrixAutoUpdate = false; this.loose.push(c); return; }
      const geo = (o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone());
      geo.applyMatrix4(o.matrixWorld);
      for (const kk of Object.keys(geo.attributes)) if (kk !== 'position' && kk !== 'normal') geo.deleteAttribute(kk);
      if (!this.parts.has(o.material)) this.parts.set(o.material, []);
      this.parts.get(o.material).push(geo);
    });
    return this;
  }
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
    for (const c of this.loose || []) g.add(c);   // piezas con textura (carteles): sin fundir
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


// ------------------------------------------------------------
// Piezas comunes
// ------------------------------------------------------------
function lampPost(k, group, x, z, h = 3.4) {
  const m = mats();
  k.cyl(0.08, 0.11, h, m.dark, x, h / 2, z, 6);
  k.box(0.35, 0.1, 0.35, m.dark, x, h + 0.05, z);
  k.box(0.28, 0.42, 0.28, m.lamp, x, h + 0.35, z);
  k.cone(0.3, 0.25, m.dark, x, h + 0.68, z, 4, Math.PI / 4);
  const s = new THREE.Sprite(haloMat()); s.position.set(x, h + 0.35, z); s.scale.set(2.4, 2.4, 1); group.add(s);
}
function palm(k, x, z, h = 7, lean = 0.15, rot = 0) {
  const m = mats();
  for (let i = 0; i < 6; i++) {
    const f = i / 6, y = h * f + h / 12;
    k.cyl(0.22 - f * 0.06, 0.26 - f * 0.06, h / 6 + 0.05, m.woodD, x + Math.sin(rot) * lean * y, y, z + Math.cos(rot) * lean * y, 7);
  }
  const tx = x + Math.sin(rot) * lean * h, tz = z + Math.cos(rot) * lean * h;
  for (let i = 0; i < 8; i++) {
    const a = i / 8 * Math.PI * 2;
    k.raw(new THREE.ConeGeometry(0.45, 3.4, 4), i % 2 ? m.leaf : m.leafD, tx + Math.cos(a) * 1.4, h + 0.1, tz + Math.sin(a) * 1.4, -a + Math.PI / 2, 0, -1.25);
  }
  k.ico(0.35, m.woodD, tx, h, tz);
}
function barrel(k, x, z) { const m = mats(); k.cyl(0.42, 0.42, 1.0, m.wood, x, 0.5, z, 10); k.cyl(0.44, 0.44, 0.08, m.dark, x, 0.75, z, 10); k.cyl(0.44, 0.44, 0.08, m.dark, x, 0.25, z, 10); }
function crate(k, x, z, s = 0.9, r = 0) { const m = mats(); k.box(s, s, s, m.woodL, x, s / 2, z, r); k.box(s + 0.02, 0.1, s + 0.02, m.woodD, x, s * 0.8, z, r); }
function fence(k, x0, z0, x1, z1) {
  const m = mats(); const L = Math.hypot(x1 - x0, z1 - z0), n = Math.max(1, Math.round(L / 2.2)), ang = Math.atan2(x1 - x0, z1 - z0);
  for (let i = 0; i <= n; i++) { const f = i / n; k.box(0.14, 1.1, 0.14, m.woodD, x0 + (x1 - x0) * f, 0.55, z0 + (z1 - z0) * f); }
  for (const y of [0.45, 0.9]) k.box(0.07, 0.09, L, m.wood, (x0 + x1) / 2, y, (z0 + z1) / 2, ang);
}
function boat(k, x, z, r, color) {
  const m = mats(); const hull = new THREE.MeshLambertMaterial({ color, flatShading: true });
  const g = new THREE.Group();
  const b = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.6, 4.2), hull); b.position.y = 0.45; g.add(b);
  const bow = new THREE.Mesh(new THREE.ConeGeometry(0.85, 1.4, 4), hull); bow.rotation.set(Math.PI / 2, Math.PI / 4, 0); bow.scale.set(1, 1, 0.55); bow.position.set(0, 0.45, 2.75); g.add(bow);
  const rim = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.1, 4.3), m.woodL); rim.position.y = 0.78; g.add(rim);
  for (const zz of [-0.8, 0.6]) { const sb = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.08, 0.35), m.wood); sb.position.set(0, 0.62, zz); g.add(sb); }
  const oar = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.06, 3.2), m.woodL); oar.position.set(0.3, 0.85, 0); oar.rotation.y = 0.2; g.add(oar);
  g.rotation.z = 0.12;
  k.group(g, x, z, r);
}

// ------------------------------------------------------------
// FARO DE PUNTA RASCA — faro con haz que gira de noche, casa del farero,
// barcas varadas, secadero de pescado, redes, nasas y una pasarela.
// ------------------------------------------------------------
export const FARO = { id: 'faro', x: -800, z: 1400 };
function buildFaro() {
  const m = mats(), k = new Kit(), id = FARO.id, group = new THREE.Group(), anim = [];
  const LX = -824, LZ = 1452;
  // Faro
  k.cyl(3.4, 3.6, 1.0, m.stoneD, LX, 0.5, LZ, 8);
  k.cyl(1.55, 2.3, 16, m.white, LX, 9, LZ, 16);
  for (const y of [4.5, 9.5, 14.0]) k.cyl(1.55 + (16 - y) / 16 * 0.75 + 0.03, 1.55 + (16 - y + 1.6) / 16 * 0.75 + 0.03, 1.6, m.red, LX, y, LZ, 16);
  k.cyl(2.4, 2.4, 0.28, m.dark, LX, 17.1, LZ, 16);
  for (let i = 0; i < 16; i++) { const a = i / 16 * Math.PI * 2; k.box(0.07, 0.8, 0.07, m.dark, LX + Math.cos(a) * 2.3, 17.6, LZ + Math.sin(a) * 2.3); }
  k.cyl(2.35, 2.35, 0.07, m.dark, LX, 18.0, LZ, 16);
  k.cyl(1.25, 1.25, 1.9, m.lamp, LX, 18.2, LZ, 12);
  k.cone(1.6, 1.4, m.red, LX, 19.85, LZ, 12);
  k.ico(0.25, m.brass, LX, 20.7, LZ);
  for (let i = 0; i < 4; i++) { const a = i / 4 * Math.PI * 2 + 0.4; k.box(0.5, 0.9, 0.06, m.window, LX + Math.cos(a) * (1.9 - i * 0.05), 5 + i * 3.2, LZ + Math.sin(a) * (1.9 - i * 0.05), -a + Math.PI / 2); }
  k.box(1.1, 2.2, 0.2, m.blue, LX, 2.0, LZ - 2.1);
  colCircle(id, LX, LZ, 3.5);
  // Haz de luz que gira (de noche)
  const beamG = new THREE.Group(); beamG.position.set(LX, 18.2, LZ);
  const beamM = new THREE.MeshBasicMaterial({ color: 0xfff2b0, transparent: true, opacity: 0.0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
  for (const dir of [1, -1]) {
    const b = new THREE.Mesh(new THREE.ConeGeometry(3.2, 46, 16, 1, true), beamM);
    b.rotation.z = dir * Math.PI / 2; b.position.x = dir * 23.5; beamG.add(b);
  }
  group.add(beamG);
  anim.push((dt) => { beamG.rotation.y += dt * 0.6; beamM.opacity = isNight() ? 0.16 : 0; beamG.visible = isNight(); });
  // Casa del farero
  const casa = buildCasa({ w: 8, d: 6, h: 3.2, trim: 'blue', roof: 'flat', chimney: true });
  k.group(casa.group, -806, 1468, Math.PI);
  colBox(id, -806, 1468, 4.2, 3.2);
  // Pasarela de madera desde la plaza hasta el faro
  for (let i = 0; i < 16; i++) k.box(2.2, 0.12, 0.5, i % 2 ? m.woodL : m.wood, -806 - i * 0.9, 0.08, 1420 + i * 1.7, 0.5);
  // Barcas varadas
  boat(k, -770, 1452, 0.4, 0x2f6aa8); colBox(id, -770, 1452, 0.9, 2.6, 0.4);
  boat(k, -762, 1440, -0.2, 0xc04030); colBox(id, -762, 1440, 0.9, 2.6, -0.2);
  boat(k, -778, 1470, 1.2, 0x3a8a4a); colBox(id, -778, 1470, 0.9, 2.6, 1.2);
  // Secadero de pescado
  for (const sx of [-1.6, 1.6]) k.box(0.15, 2.2, 0.15, m.woodD, -786 + sx, 1.1, 1430);
  k.box(3.6, 0.1, 0.1, m.woodD, -786, 2.15, 1430);
  for (let i = 0; i < 7; i++) k.box(0.12, 0.55, 0.05, m.metal, -787.5 + i * 0.5, 1.8, 1430);
  colBox(id, -786, 1430, 1.8, 0.3);
  // Redes (montones) y nasas
  for (const [nx, nz] of [[-774, 1426], [-768, 1430]]) { k.ico(0.9, m.green, nx, 0.3, nz); k.ico(0.6, m.leafD, nx + 0.6, 0.25, nz + 0.4); }
  for (const [nx, nz] of [[-781, 1418], [-782.2, 1419], [-780.6, 1420.2]]) { k.cyl(0.4, 0.5, 0.7, m.straw, nx, 0.35, nz, 8); }
  barrel(k, -792, 1424); barrel(k, -793, 1425.2); crate(k, -790.6, 1425.6, 0.8, 0.3);
  // Palmeras y farolas
  palm(k, -760, 1410, 7.5, 0.18, 0.6); palm(k, -836, 1430, 6.5, 0.12, 2.5); palm(k, -818, 1395, 7, 0.2, 4);
  colCircle(id, -760, 1410, 0.4); colCircle(id, -836, 1430, 0.4); colCircle(id, -818, 1395, 0.4);
  for (const [lx, lz] of [[-796, 1428], [-812, 1440], [-774, 1408]]) { lampPost(k, group, lx, lz); colCircle(id, lx, lz, 0.2); }
  addSign(group, 'Faro de', 'Punta Rasca', -812, 1426, 0.7);
  group.add(k.build());
  return { group, update: (dt) => { for (const f of anim) f(dt); } };
}

// ------------------------------------------------------------
// LAS CAÑADAS — Parador de montaña, refugio, Roques de García (con el Roque
// Cinchado), poste de caminos, leña, trineo, muñeco de nieve y humo.
// ------------------------------------------------------------
export const CANADAS = { id: 'canadas', x: 200, z: -1700 };
function buildCanadas() {
  const m = mats(), k = new Kit(), id = CANADAS.id, group = new THREE.Group(), anim = [];
  // Parador (piedra, dos plantas, balcón)
  const par = buildCasa({ w: 16, d: 9, h: 3.6, twoFloors: true, balcony: true, color: 0x8c8274, trim: 'green', chimney: false });
  k.group(par.group, 176, -1730, 0.35);
  colBox(id, 176, -1730, 8.3, 4.8, 0.35);
  // chimeneas con humo
  const smoke = [];
  const smM = new THREE.MeshBasicMaterial({ color: 0xe8e8e8, transparent: true, opacity: 0.4, depthWrite: false });
  for (const [cx, cz] of [[171, -1733], [183, -1730]]) {
    k.box(0.9, 2.2, 0.9, m.stoneD, cx, 9.2, cz);
    for (let i = 0; i < 5; i++) { const sm = new THREE.Mesh(new THREE.SphereGeometry(0.5, 7, 5), smM.clone()); group.add(sm); smoke.push({ sm, cx, cz, ph: i / 5 }); }
  }
  anim.push(() => { for (const p of smoke) { const f = (t * 0.18 + p.ph) % 1; p.sm.position.set(p.cx + Math.sin(f * 4 + p.ph * 7) * 0.6, 10.4 + f * 6, p.cz + f * 1.5); p.sm.scale.setScalar(0.7 + f * 2.4); p.sm.material.opacity = 0.42 * (1 - f); } });
  addSign(group, 'Parador', 'de Las Cañadas', 188, -1716, 0.35);
  // Refugio pequeño
  const ref = buildCasa({ w: 6, d: 5, h: 3, color: 0x6e5a44, roof: 'teja' });
  k.group(ref.group, 232, -1726, -0.4);
  colBox(id, 232, -1726, 3.2, 2.8, -0.4);
  // Roques de García (piedra volcánica), con el Roque Cinchado
  const ROQ = [[142, -1668, 2.6, 9], [134, -1684, 2.0, 12], [150, -1692, 1.7, 7], [126, -1664, 1.5, 6]];
  for (const [rx, rz, r, h] of ROQ) {
    for (let i = 0; i < 4; i++) k.ico(r * (1 - i * 0.12), i % 2 ? m.stoneD : m.lava, rx + (i % 2) * 0.3, r * 0.6 + i * h / 4, rz - (i % 3) * 0.2, 0);
    colCircle(id, rx, rz, r + 0.2);
  }
  // Roque Cinchado: estrecho abajo, ancho arriba
  k.cyl(0.9, 1.4, 4, m.lava, 160, 2, -1660, 7);
  k.cyl(2.6, 1.0, 5, m.stoneD, 160, 6.5, -1660, 7);
  k.ico(2.4, m.stoneD, 160, 9.6, -1660);
  colCircle(id, 160, -1660, 1.5);
  // Poste de caminos
  {
    const px = 206, pz = -1712;
    k.box(0.2, 3.4, 0.2, m.woodD, px, 1.7, pz);
    const arrows = [['El Teide ⟶', 0.5], ['⟵ La Orotava', 2.4], ['Grieta ⟶', 1.4]];
    arrows.forEach(([txt, ang], i) => {
      const tex = signTex(txt); const pl = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.5), new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide }));
      pl.position.set(px + Math.cos(ang) * 0.75, 2.9 - i * 0.55, pz + Math.sin(ang) * 0.75); pl.rotation.y = -ang; group.add(pl);
    });
    colCircle(id, px, pz, 0.25);
  }
  // Leña, trineo, muñeco de nieve
  for (let i = 0; i < 9; i++) k.raw(new THREE.CylinderGeometry(0.16, 0.16, 1.6, 7), m.wood, 190 + (i % 3) * 0.34, 0.2 + Math.floor(i / 3) * 0.3, -1722.5, 0.35, 0, Math.PI / 2);
  colBox(id, 190.3, -1722.5, 0.9, 0.5, 0.35);
  k.box(0.9, 0.12, 2.0, m.woodL, 214, 0.35, -1714, 0.8); for (const sx of [-0.4, 0.4]) k.box(0.08, 0.25, 2.2, m.dark, 214 + sx * Math.cos(0.8), 0.15, -1714 - sx * Math.sin(0.8), 0.8);
  k.ico(0.9, m.white, 196, 0.85, -1706, 1); k.ico(0.65, m.white, 196, 2.2, -1706, 1); k.ico(0.45, m.white, 196, 3.2, -1706, 1);
  k.cone(0.09, 0.45, m.red, 196, 3.25, -1705.5, 6); k.box(0.7, 0.12, 0.12, m.red, 196, 2.75, -1706);
  colCircle(id, 196, -1706, 0.9);
  fence(k, 160, -1745, 200, -1752); fence(k, 200, -1752, 226, -1742);
  for (const [lx, lz] of [[194, -1716], [218, -1704], [168, -1712]]) { lampPost(k, group, lx, lz); colCircle(id, lx, lz, 0.2); }
  group.add(k.build());
  return { group, update: (dt) => { for (const f of anim) f(dt); } };
}

// ------------------------------------------------------------
// MINA DE GUAJARA — montaña con bocamina apuntalada, raíles y vagonetas,
// montones de mineral, caseta, torno y faroles.
// ------------------------------------------------------------
export const MINA = { id: 'mina', x: 1200, z: -1500 };
function buildMina() {
  const m = mats(), k = new Kit(), id = MINA.id, group = new THREE.Group();
  const MX = 1208, MZ = -1530;
  // Montaña de roca
  const ROCKS = [[0, 0, 11, 0], [-9, 2, 7, 1], [9, 1, 8, 1], [-4, -7, 8, 0], [6, -6, 7, 1], [0, -2, 6, 1]];
  for (const [rx, rz, r, alt] of ROCKS) k.ico(r, alt ? m.stoneD : m.stone, MX + rx, r * 0.55, MZ + rz, 1);
  colCircle(id, MX, MZ - 1, 13);
  // Bocamina apuntalada (mirando al sur, hacia el pueblo)
  const PX = 1206, PZ = -1516.5;
  k.box(4.4, 4.6, 1.2, m.dark, PX, 2.3, PZ - 0.4);
  for (const sx of [-2.1, 2.1]) k.box(0.45, 4.6, 0.45, m.woodD, PX + sx, 2.3, PZ + 0.3);
  k.box(5.2, 0.5, 0.6, m.woodD, PX, 4.75, PZ + 0.3);
  k.box(3.6, 0.3, 0.4, m.wood, PX, 3.9, PZ + 0.25);
  const tex = signTex('Mina de Guajara', '¡Cuidado con la cabeza!');
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 1.0), new THREE.MeshBasicMaterial({ map: tex }));
  sign.position.set(PX, 5.6, PZ + 0.65); group.add(sign);
  // Raíles y traviesas
  for (let i = 0; i < 34; i++) k.box(1.8, 0.1, 0.35, m.woodD, PX, 0.06, PZ + 1 + i);
  for (const sx of [-0.55, 0.55]) k.box(0.1, 0.12, 34, m.metal, PX + sx, 0.16, PZ + 18);
  // Vagonetas (una llena de mineral)
  const cart = (cz, full) => {
    k.box(1.4, 0.9, 1.9, m.greyD, PX, 0.85, cz); k.box(1.5, 0.12, 2.0, m.dark, PX, 1.3, cz);
    for (const sx of [-0.6, 0.6]) for (const sz of [-0.6, 0.6]) k.raw(new THREE.CylinderGeometry(0.28, 0.28, 0.14, 10), m.dark, PX + sx, 0.32, cz + sz, 0, 0, Math.PI / 2);
    if (full) { k.ico(0.55, m.brass, PX - 0.2, 1.45, cz); k.ico(0.5, m.stoneD, PX + 0.3, 1.4, cz + 0.4); k.ico(0.45, m.red, PX, 1.45, cz - 0.5); }
    colBox(id, PX, cz, 0.8, 1.1);
  };
  cart(-1503, true); cart(-1488, false);
  // Montones de mineral
  for (const [ox, oz, mat] of [[1216, -1500, m.brass], [1218.5, -1497, m.red], [1196, -1498, m.stoneD], [1194, -1502, m.greyD]]) {
    k.ico(1.2, mat, ox, 0.5, oz); k.ico(0.8, mat, ox + 0.9, 0.4, oz + 0.6); colCircle(id, ox, oz, 1.4);
  }
  // Caseta de madera
  k.box(5, 3, 4, m.wood, 1226, 1.5, -1484); k.box(5.6, 0.25, 4.6, m.woodD, 1226, 3.1, -1484);
  k.box(1.1, 2.1, 0.1, m.woodD, 1226, 1.05, -1481.95); k.box(0.9, 0.8, 0.08, m.window, 1224.2, 1.8, -1481.97);
  colBox(id, 1226, -1484, 2.6, 2.1);
  // Torno de madera (pozo de extracción)
  for (const [ax, az] of [[-1.2, 0], [1.2, 0]]) k.raw(new THREE.BoxGeometry(0.25, 5.2, 0.25), m.woodD, 1186 + ax, 2.4, -1510 + az, 0, 0, ax > 0 ? -0.18 : 0.18);
  k.raw(new THREE.CylinderGeometry(0.3, 0.3, 2.4, 10), m.wood, 1186, 4.7, -1510, 0, 0, Math.PI / 2);
  k.cyl(0.03, 0.03, 4.2, m.dark, 1186, 2.6, -1510, 4); k.box(0.6, 0.5, 0.6, m.greyD, 1186, 0.6, -1510);
  k.box(2.6, 0.2, 2.6, m.dark, 1186, 0.05, -1510);
  colCircle(id, 1186, -1510, 1.6);
  barrel(k, 1213, -1508); barrel(k, 1214, -1509.3); crate(k, 1198, -1490, 1.0, 0.3); crate(k, 1199, -1491.2, 0.7, 0.8);
  for (const [lx, lz] of [[1202.4, -1514.5], [1209.6, -1514.5], [1212, -1488]]) { lampPost(k, group, lx, lz, 2.8); colCircle(id, lx, lz, 0.2); }
  group.add(k.build());
  return { group };
}

// ------------------------------------------------------------
// BASÍLICA DE CANDELARIA — la basílica blanca con su campanario, mirando a la
// plaza de los menceyes; escalinata, empedrado, palmeras y farolas.
// ------------------------------------------------------------
export const BASILICA = { id: 'basilica', x: 0, z: -1200 };
function buildBasilica() {
  const m = mats(), k = new Kit(), id = BASILICA.id, group = new THREE.Group();
  const BX = 36, BZ = -1200;           // centro de la nave; la fachada mira al oeste (a la plaza)
  const FX = BX - 14;                   // fachada
  k.disc(26, m.gravel, 4, 0.03, -1200, 40);   // plaza empedrada
  // Nave
  k.box(28.5, 0.6, 14.5, m.stoneD, BX, 0.3, BZ);
  k.box(28, 11, 14, m.white, BX, 6, BZ);
  for (const sx of [-14, 14]) for (const sz of [-7, 7]) k.box(0.9, 11.4, 0.9, m.stone, BX + sx, 5.9, BZ + sz);
  // tejado a dos aguas (prisma)
  const roof = new THREE.CylinderGeometry(8.4, 8.4, 29, 3, 1); 
  k.raw(roof, m.red, BX, 13.5, BZ, 0, 0, Math.PI / 2);
  // ventanales en arco a los lados
  for (let i = 0; i < 5; i++) for (const sz of [-7.05, 7.05]) { k.box(1.6, 3.2, 0.1, m.window, BX - 10 + i * 5, 6.5, BZ + sz); k.raw(new THREE.CircleGeometry(0.8, 10, 0, Math.PI), m.window, BX - 10 + i * 5, 8.1, BZ + sz * 1.001, sz > 0 ? 0 : Math.PI); }
  // Fachada: frontón, puerta en arco, rosetón
  k.box(1.0, 14, 15, m.white, FX, 7, BZ);
  k.box(1.1, 0.6, 15.4, m.stone, FX, 14.2, BZ);
  k.raw(new THREE.CylinderGeometry(3.2, 3.2, 1.0, 3, 1), m.white, FX, 15.6, BZ, Math.PI / 2, 0, 0);
  k.box(0.3, 5.2, 3.4, m.dark, FX - 0.5, 2.9, BZ);
  k.raw(new THREE.CylinderGeometry(1.7, 1.7, 0.3, 14, 1, false, 0, Math.PI), m.dark, FX - 0.5, 5.5, BZ, 0, 0, Math.PI / 2);
  k.box(0.4, 6.2, 4.2, m.stone, FX - 0.45, 3.1, BZ);
  k.raw(new THREE.CylinderGeometry(1.5, 1.5, 0.12, 16), m.window, FX - 0.56, 10.2, BZ, 0, 0, Math.PI / 2);
  k.raw(new THREE.TorusGeometry(1.55, 0.18, 6, 16), m.stone, FX - 0.58, 10.2, BZ, Math.PI / 2, 0, 0);
  // Escalinata
  for (let i = 0; i < 4; i++) k.box(2.2 - i * 0.2, 0.25, 9 - i * 0.6, m.stone, FX - 1.6 - (3 - i) * 0.55, 0.12 + i * 0.25, BZ);
  colBox(id, BX, BZ, 14.6, 7.4);
  // Campanario (a la izquierda de la fachada)
  const TX = FX + 2.4, TZ = BZ - 10.2;
  k.box(5, 0.6, 5, m.stoneD, TX, 0.3, TZ);
  k.box(4.4, 18, 4.4, m.white, TX, 9.3, TZ);
  for (const sx of [-2.2, 2.2]) for (const sz of [-2.2, 2.2]) k.box(0.55, 18.4, 0.55, m.stone, TX + sx, 9.2, TZ + sz);
  for (const y of [6, 12]) k.box(4.7, 0.35, 4.7, m.stone, TX, y, TZ);
  for (const [dx, dz, r] of [[0, 2.22, 0], [0, -2.22, 0], [2.22, 0, Math.PI / 2], [-2.22, 0, Math.PI / 2]]) k.box(1.6, 2.6, 0.12, m.dark, TX + dx, 15.2, TZ + dz, r);
  k.box(4.9, 0.5, 4.9, m.stone, TX, 18.5, TZ);
  k.cone(3.3, 4, m.red, TX, 20.8, TZ, 4, Math.PI / 4);
  k.box(0.18, 1.8, 0.18, m.brass, TX, 23.6, TZ); k.box(0.9, 0.18, 0.18, m.brass, TX, 23.9, TZ);
  colBox(id, TX, TZ, 2.6, 2.6);
  // Palmeras y farolas alrededor de la plaza
  for (const [px, pz, r] of [[18, -1222, 0.4], [18, -1178, 2.4], [-18, -1176, 4.0], [-22, -1214, 5.2], [30, -1236, 1.2]]) { palm(k, px, pz, 8, 0.16, r); colCircle(id, px, pz, 0.4); }
  for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2 + 0.5; const lx = 4 + Math.cos(a) * 24, lz = -1200 + Math.sin(a) * 24; if (lx > 18 && Math.abs(lz + 1200) < 9) continue; lampPost(k, group, lx, lz); colCircle(id, lx, lz, 0.2); }
  addSign(group, 'Basílica de', 'Nuestra Señora de Candelaria', 12, -1188, -1.2);
  group.add(k.build());
  return { group };
}

const SETS = [
  { id: IZANA.id, x: IZANA.x, z: IZANA.z, build: buildIzana },
  { id: FARO.id, x: FARO.x, z: FARO.z, build: buildFaro, keep: [[-810, 1440, 42]] },
  { id: CANADAS.id, x: CANADAS.x, z: CANADAS.z, build: buildCanadas, keep: [[185, -1712, 48], [145, -1675, 26]] },
  { id: MINA.id, x: MINA.x, z: MINA.z, build: buildMina, keep: [[1206, -1508, 32]] },
  { id: BASILICA.id, x: BASILICA.x, z: BASILICA.z, build: buildBasilica, keep: [[14, -1200, 40]] },
];

// ------------------------------------------------------------
// API
// ------------------------------------------------------------
export function registerKeepouts(terrain) {
  for (const s of SETS) {
    for (const [x, z, r] of s.keep || [[s.x, s.z, 37]]) {
      try { terrain.addKeepout?.(x, z, r); terrain.clearTreesNear?.(x, z, r); } catch {}
    }
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
