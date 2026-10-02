/**
 * SebasPresent — Armas legendarias en 3D (Sesión 51)
 *
 * Espadones de los dioses (Achamán, Tibicena, Magec, Guayota), espada larga de
 * Tindaya, garras y daga de dragón. Diseños propios. Muchos polígonos pequeños
 * pero fusionados por material → pocas llamadas de dibujo por arma.
 *
 * Marco local (como las espadas de armor_procedural): +Y = hacia la punta,
 * caras de la hoja = ±Z, filos = ±X. La mano agarra en y≈0.
 *
 * API: LEGEND_IDS, buildLegendWeapon(itemId, gf)  (gf = gripFrame de armor_procedural)
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const LEGEND_IDS = new Set(['gs_achaman', 'gs_tibicena', 'gs_magec', 'gs_guayota', 'sword_tindaya', 'claws_dragon', 'dagger_dragon']);

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const PI = Math.PI;

// ------------------------------------------------------------
// Materiales (cacheados)
// ------------------------------------------------------------
const _mats = new Map();
function mat(key) {
  if (_mats.has(key)) return _mats.get(key);
  const S = (o) => new THREE.MeshStandardMaterial(o);
  const defs = {
    gold:      () => S({ color: 0xe0b040, metalness: 0.6, roughness: 0.3 }),
    goldDark:  () => S({ color: 0x9a7028, metalness: 0.6, roughness: 0.38 }),
    sky:       () => S({ color: 0xeaf6ff, metalness: 0.45, roughness: 0.18, emissive: 0x4a8ad0, emissiveIntensity: 0.25 }),
    skyCore:   () => S({ color: 0x8ad0ff, emissive: 0x3a9aff, emissiveIntensity: 1.2, roughness: 0.2 }),
    star:      () => S({ color: 0xffffff, emissive: 0xc0e8ff, emissiveIntensity: 1.8, roughness: 0.1 }),
    gemBlue:   () => S({ color: 0x5ab0ff, emissive: 0x2a7aff, emissiveIntensity: 1.4, roughness: 0.1 }),
    whiteWrap: () => S({ color: 0xe8f0ff, roughness: 0.7 }),
    iron:      () => S({ color: 0x55504a, metalness: 0.55, roughness: 0.4 }),
    bone:      () => S({ color: 0xe8dcc0, roughness: 0.55 }),
    eyeRed:    () => S({ color: 0xff3020, emissive: 0xff1000, emissiveIntensity: 2.2 }),
    leather:   () => S({ color: 0x5a3a20, roughness: 0.9 }),
    sunBlade:  () => S({ color: 0xfff0b8, metalness: 0.7, roughness: 0.18, emissive: 0xffa030, emissiveIntensity: 0.45 }),
    sunCore:   () => S({ color: 0xffb020, emissive: 0xff7a00, emissiveIntensity: 1.6, roughness: 0.2 }),
    redWrap:   () => S({ color: 0x8a1810, roughness: 0.8 }),
    obsidian:  () => S({ color: 0x120c16, metalness: 0.4, roughness: 0.08 }),
    lava:      () => S({ color: 0xff6a1a, emissive: 0xff4000, emissiveIntensity: 2.4, roughness: 0.3 }),
    horn:      () => S({ color: 0x5a0a08, metalness: 0.3, roughness: 0.35 }),
    patina:    () => S({ color: 0x9ab080, metalness: 0.45, roughness: 0.5 }),
    stone:     () => S({ color: 0x8a8476, roughness: 0.85 }),
    glyph:     () => S({ color: 0x2e4a3a, roughness: 0.8 }),
    gemGreen:  () => S({ color: 0x80e0a0, emissive: 0x30c060, emissiveIntensity: 1.2, roughness: 0.15 }),
    dragonRed: () => S({ color: 0xc01a14, metalness: 0.5, roughness: 0.26 }),
    darkSteel: () => S({ color: 0x3a2a24, metalness: 0.5, roughness: 0.4 }),
    gemFire:   () => S({ color: 0xffa030, emissive: 0xff5a10, emissiveIntensity: 1.6, roughness: 0.12 }),
  };
  const m = defs[key]();
  m.side = THREE.DoubleSide;
  _mats.set(key, m);
  return m;
}

class Kit {
  constructor() { this.by = new Map(); }
  add(geo, key, m4) {
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    if (m4) g.applyMatrix4(m4);
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
    if (!g.attributes.normal) g.computeVertexNormals();
    if (!this.by.has(key)) this.by.set(key, []);
    this.by.get(key).push(g);
    return this;
  }
  at(geo, key, pos, rotEuler, scl) {
    const o = new THREE.Object3D();
    if (pos) o.position.copy(pos);
    if (rotEuler) o.rotation.copy(rotEuler);
    if (scl) o.scale.copy(scl);
    o.updateMatrix();
    return this.add(geo, key, o.matrix);
  }
  build() {
    const g = new THREE.Group();
    for (const [k, arr] of this.by) {
      const merged = mergeGeometries(arr, false);
      if (!merged) continue;
      const m = new THREE.Mesh(merged, mat(k));
      m.castShadow = true; m.frustumCulled = false;
      g.add(m);
    }
    return g;
  }
}
const E = (x = 0, y = 0, z = 0) => new THREE.Euler(x, y, z);

/** Hoja extruida desde un perfil derecho [[x,y]...] (base→punta); simétrica salvo `left`. */
function bladeGeo(right, thick, bevel, left = null) {
  const s = new THREE.Shape();
  const L = left || right.map(([x, y]) => [-x, y]);
  s.moveTo(L[0][0], L[0][1]);
  for (let i = 1; i < L.length; i++) s.lineTo(L[i][0], L[i][1]);
  for (let i = right.length - 1; i >= 0; i--) s.lineTo(right[i][0], right[i][1]);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: thick, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel * 1.4, bevelSegments: 2, curveSegments: 6 });
  g.translate(0, 0, -thick / 2);
  return g;
}
function taper(curve, r0, r1 = 0, segs = 12, radial = 8, flat = 1) {
  const geo = new THREE.TubeGeometry(curve, segs, 1, radial, false);
  const p = geo.attributes.position;
  for (let i = 0; i <= segs; i++) {
    const t = i / segs, r = r0 + (r1 - r0) * Math.pow(t, 0.9), c = curve.getPointAt(t);
    for (let j = 0; j <= radial; j++) {
      const idx = i * (radial + 1) + j;
      const v = V().fromBufferAttribute(p, idx).sub(c);
      v.multiplyScalar(r); v.z *= flat;
      v.add(c);
      p.setXYZ(idx, v.x, v.y, v.z);
    }
  }
  geo.computeVertexNormals();
  return geo;
}
const Q = (a, b, c) => new THREE.QuadraticBezierCurve3(a, b, c);
const grip = (K, L, y0, y1, r, wrapKey, ringKey) => {
  K.at(new THREE.CylinderGeometry(r, r * 1.05, y1 - y0, 12, 1), wrapKey, V(0, (y0 + y1) / 2, 0));
  for (let y = y0 + (y1 - y0) * 0.15; y < y1; y += (y1 - y0) / 5) K.at(new THREE.TorusGeometry(r * 1.06, r * 0.18, 6, 16), ringKey, V(0, y, 0), E(PI / 2, 0, 0));
};

// ------------------------------------------------------------
// Espadones de los dioses
// ------------------------------------------------------------
function godsword(kind, L) {
  const K = new Kit();
  const bl = 11.2 * L, w = 0.56 * L, th = 0.13 * L, y0 = 0.95 * L;
  const gy = 0.62 * L;                 // altura de la guarda
  const gripTop = 0.45 * L, gripBot = -2.4 * L;
  if (kind === 'achaman') {
    const prof = [[w, 0], [w * 0.98, bl * 0.82], [w * 0.55, bl * 0.93], [0, bl]];
    K.at(bladeGeo(prof, th, th * 0.45), 'sky', V(0, y0, 0));
    for (const sz of [-1, 1]) {
      K.at(new THREE.BoxGeometry(w * 0.22, bl * 0.8, th * 0.3), 'skyCore', V(0, y0 + bl * 0.42, sz * th * 0.62));
      for (const [ty, s] of [[0.2, 1.1], [0.45, 0.9], [0.68, 0.75]]) K.at(new THREE.OctahedronGeometry(w * 0.32 * s, 0), 'star', V(0, y0 + bl * ty, sz * th * 0.75), null, V(1, 1.5, 0.4));
    }
    // Corona de rayos detrás de la guarda
    for (let i = -3; i <= 3; i++) {
      const a = i * 0.36, len = (3.1 - Math.abs(i) * 0.25) * L;
      const c = taper(Q(V(0, gy, -th), V(Math.sin(a) * len * 0.5, gy + Math.cos(a) * len * 0.5, -th * 1.2), V(Math.sin(a) * len, gy + Math.cos(a) * len * 0.92, -th * 1.4)), 0.22 * L, 0.015 * L, 8, 6, 0.55);
      K.add(c, 'gold');
    }
    K.at(new THREE.TorusGeometry(1.2 * L, 0.16 * L, 8, 40, PI), 'gold', V(0, gy - 0.9 * L, 0), E(0, 0, 0), V(1, 0.6, 1.2));
    K.at(new THREE.BoxGeometry(2.6 * L, 0.32 * L, 0.42 * L, 6, 1, 1), 'gold', V(0, gy, 0));
    K.at(new THREE.IcosahedronGeometry(0.34 * L, 1), 'gemBlue', V(0, gy, 0.24 * L), null, V(1, 1, 0.6));
    K.at(new THREE.IcosahedronGeometry(0.34 * L, 1), 'gemBlue', V(0, gy, -0.24 * L), null, V(1, 1, 0.6));
    grip(K, L, gripBot, gripTop, 0.17 * L, 'whiteWrap', 'gold');
    K.at(new THREE.OctahedronGeometry(0.42 * L, 0), 'gold', V(0, gripBot - 0.35 * L, 0), null, V(1, 1.3, 1));
  } else if (kind === 'tibicena') {
    const prof = [[w, 0], [w, bl * 0.86], [0, bl]];
    K.at(bladeGeo(prof, th * 1.1, th * 0.4), 'iron', V(0, y0, 0));
    // dientes en el filo derecho
    for (let i = 0; i < 9; i++) {
      const y = y0 + bl * (0.08 + i * 0.09);
      K.at(new THREE.ConeGeometry(0.16 * L, 0.55 * L, 6), 'bone', V(w + 0.18 * L, y, 0), E(0, 0, -PI / 2 - 0.35), V(1, 1, 0.5));
    }
    for (const sz of [-1, 1]) K.at(new THREE.BoxGeometry(w * 0.12, bl * 0.75, th * 0.25), 'goldDark', V(-w * 0.4, y0 + bl * 0.42, sz * th * 0.62));
    // Cráneo de perro como guarda
    K.at(new THREE.SphereGeometry(1, 20, 14), 'bone', V(0, gy - 0.05 * L, 0), null, V(1.15 * L, 0.75 * L, 0.7 * L));
    K.at(new THREE.BoxGeometry(0.9 * L, 0.6 * L, 0.55 * L, 3, 2, 2), 'bone', V(0, gy - 0.75 * L, 0.05 * L));
    for (const sx of [-1, 1]) {
      K.at(new THREE.ConeGeometry(0.22 * L, 0.9 * L, 6), 'bone', V(sx * 0.8 * L, gy + 0.55 * L, 0), E(0, 0, -sx * 0.5));
      K.at(new THREE.SphereGeometry(0.15 * L, 10, 8), 'eyeRed', V(sx * 0.42 * L, gy + 0.05 * L, 0.6 * L));
      K.at(new THREE.SphereGeometry(0.15 * L, 10, 8), 'eyeRed', V(sx * 0.42 * L, gy + 0.05 * L, -0.6 * L));
      for (let k = 0; k < 3; k++) K.at(new THREE.ConeGeometry(0.07 * L, 0.3 * L, 5), 'bone', V(sx * (0.12 + k * 0.12) * L, gy - 1.05 * L, 0.28 * L), E(PI, 0, 0));
    }
    grip(K, L, gripBot, gripTop - 0.6 * L, 0.18 * L, 'leather', 'goldDark');
    K.at(new THREE.ConeGeometry(0.22 * L, 0.8 * L, 6), 'bone', V(0, gripBot - 0.4 * L, 0), E(PI, 0, 0));
  } else if (kind === 'magec') {
    const prof = [];
    const N = 28;
    for (let i = 0; i <= N; i++) { const t = i / N; prof.push([w * (1 - t * 0.25) + Math.sin(t * PI * 7) * w * 0.32 * (1 - t * 0.7), bl * 0.86 * t]); }
    prof.push([0, bl]);
    K.at(bladeGeo(prof, th, th * 0.4), 'sunBlade', V(0, y0, 0));
    for (const sz of [-1, 1]) K.at(new THREE.BoxGeometry(w * 0.16, bl * 0.8, th * 0.25), 'sunCore', V(0, y0 + bl * 0.42, sz * th * 0.62));
    // Disco solar
    K.at(new THREE.CylinderGeometry(1.0 * L, 1.0 * L, 0.3 * L, 36), 'gold', V(0, gy, 0), E(PI / 2, 0, 0));
    K.at(new THREE.CylinderGeometry(0.6 * L, 0.6 * L, 0.42 * L, 28), 'sunCore', V(0, gy, 0), E(PI / 2, 0, 0));
    for (let i = 0; i < 16; i++) {
      const a = i / 16 * PI * 2, len = (i % 2 ? 0.55 : 0.95) * L;
      K.at(new THREE.ConeGeometry(0.12 * L, len, 5), 'gold', V(Math.cos(a) * (1.0 * L + len / 2), gy + Math.sin(a) * (1.0 * L + len / 2), 0), E(0, 0, a - PI / 2), V(1, 1, 0.5));
    }
    grip(K, L, gripBot, gripTop - 0.6 * L, 0.17 * L, 'redWrap', 'gold');
    K.at(new THREE.CylinderGeometry(0.45 * L, 0.45 * L, 0.2 * L, 20), 'sunCore', V(0, gripBot - 0.35 * L, 0), E(PI / 2, 0, 0));
  } else { // guayota
    const right = [[w * 0.95, 0], [w * 1.05, bl * 0.2], [w * 0.8, bl * 0.35], [w * 1.1, bl * 0.55], [w * 0.85, bl * 0.72], [w * 0.95, bl * 0.84], [0, bl]];
    const left = [[-w * 1.0, 0], [-w * 0.85, bl * 0.15], [-w * 1.1, bl * 0.4], [-w * 0.8, bl * 0.6], [-w * 1.05, bl * 0.78], [-w * 0.5, bl * 0.93], [0, bl]];
    K.at(bladeGeo(right, th * 1.15, th * 0.35, left), 'obsidian', V(0, y0, 0));
    // Núcleo de lava en zigzag (dos caras)
    for (const sz of [-1, 1]) {
      const pts = [];
      for (let i = 0; i <= 12; i++) { const t = i / 12; pts.push(V(Math.sin(t * PI * 5) * w * 0.28, y0 + bl * (0.04 + t * 0.84), sz * th * 0.7)); }
      K.add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 48, 0.07 * L, 5, false), 'lava');
    }
    // Cuernos de demonio
    for (const sx of [-1, 1]) {
      K.add(taper(Q(V(sx * 0.5 * L, gy, 0), V(sx * 2.0 * L, gy + 0.2 * L, 0), V(sx * 2.4 * L, gy + 1.6 * L, 0)), 0.3 * L, 0.02 * L, 14, 8), 'horn');
    }
    K.at(new THREE.BoxGeometry(1.4 * L, 0.55 * L, 0.5 * L, 3, 2, 2), 'darkSteel', V(0, gy, 0));
    K.at(new THREE.IcosahedronGeometry(0.32 * L, 1), 'lava', V(0, gy, 0.28 * L), null, V(1, 1, 0.6));
    K.at(new THREE.IcosahedronGeometry(0.32 * L, 1), 'lava', V(0, gy, -0.28 * L), null, V(1, 1, 0.6));
    grip(K, L, gripBot, gripTop - 0.3 * L, 0.17 * L, 'darkSteel', 'horn');
    K.at(new THREE.ConeGeometry(0.25 * L, 0.9 * L, 6), 'horn', V(0, gripBot - 0.45 * L, 0), E(PI, 0, 0));
  }
  return K.build();
}

// ------------------------------------------------------------
// Espada larga de Tindaya
// ------------------------------------------------------------
function tindaya(L) {
  const K = new Kit();
  const bl = 8.6 * L, w = 0.3 * L, th = 0.1 * L, y0 = 0.8 * L, gy = 0.62 * L;
  K.at(bladeGeo([[w, 0], [w * 0.92, bl * 0.9], [0, bl]], th, th * 0.4), 'patina', V(0, y0, 0));
  // Petroglifos (pies) grabados en las dos caras
  for (const sz of [-1, 1]) for (const [t, sx] of [[0.2, -1], [0.38, 1], [0.56, -1], [0.74, 1]]) {
    const s = new THREE.Shape();
    s.absellipse(0, 0, w * 0.32, w * 0.62, 0, PI * 2);
    const g = new THREE.ShapeGeometry(s, 10);
    K.at(g, 'glyph', V(sx * w * 0.25, y0 + bl * t, sz * (th * 0.72)), E(0, sz < 0 ? PI : 0, 0));
    for (let k = 0; k < 4; k++) K.at(new THREE.CircleGeometry(w * 0.09, 6), 'glyph', V(sx * w * 0.25 + (k - 1.5) * w * 0.18, y0 + bl * t + w * 0.75, sz * (th * 0.73)), E(0, sz < 0 ? PI : 0, 0));
  }
  // Disco de piedra con espiral
  K.at(new THREE.CylinderGeometry(0.75 * L, 0.75 * L, 0.2 * L, 28), 'stone', V(0, gy, 0));
  K.at(new THREE.TorusGeometry(0.5 * L, 0.05 * L, 6, 30, PI * 1.6), 'glyph', V(0, gy + 0.11 * L, 0), E(PI / 2, 0, 0));
  K.at(new THREE.TorusGeometry(0.3 * L, 0.05 * L, 6, 24, PI * 1.6), 'glyph', V(0, gy + 0.11 * L, 0), E(PI / 2, 0, 1));
  grip(K, L, -1.25 * L, 0.5 * L, 0.15 * L, 'leather', 'goldDark');
  K.at(new THREE.SphereGeometry(0.38 * L, 16, 10), 'stone', V(0, -1.5 * L, 0), null, V(1, 0.7, 1));
  K.at(new THREE.IcosahedronGeometry(0.14 * L, 1), 'gemGreen', V(0, -1.5 * L, 0.3 * L));
  return K.build();
}

// ------------------------------------------------------------
// Garras de dragón: barra de nudillos + 4 cuchillas curvas hacia delante
// (fx = dirección de los dedos en el marco local, unitario en X)
// ------------------------------------------------------------
function claws(L, fx) {
  const K = new Kit();
  const s = fx >= 0 ? 1 : -1;
  // Empuñadura que se cierra en el puño (eje Y del marco = a lo ancho de la mano)
  K.at(new THREE.CylinderGeometry(0.2 * L, 0.2 * L, 1.7 * L, 12), 'darkSteel', V(0, 0, 0));
  // Barra de nudillos por delante de los dedos
  K.at(new THREE.BoxGeometry(0.4 * L, 2.0 * L, 0.55 * L, 2, 6, 2), 'dragonRed', V(s * 0.55 * L, 0, 0));
  for (let i = 0; i < 4; i++) {
    const y = (-0.75 + i * 0.5) * L;
    const base = V(s * 0.7 * L, y, 0);
    const c = taper(Q(base, V(s * 2.1 * L, y, -0.15 * L), V(s * 3.4 * L, y * 1.05, -0.95 * L)), 0.22 * L, 0.01 * L, 14, 6, 0.32);
    K.add(c, 'dragonRed');
    K.at(new THREE.SphereGeometry(0.12 * L, 8, 6), 'gold', V(s * 0.78 * L, y, 0.28 * L));
  }
  K.at(new THREE.IcosahedronGeometry(0.16 * L, 1), 'gemFire', V(s * 0.6 * L, 0, 0.32 * L));
  return K.build();
}

// ------------------------------------------------------------
// Daga de dragón
// ------------------------------------------------------------
function dagger(L) {
  const K = new Kit();
  const bl = 3.8 * L, w = 0.3 * L, th = 0.09 * L, y0 = 0.72 * L, gy = 0.6 * L;
  K.at(bladeGeo([[w, 0], [w * 0.95, bl * 0.65], [0, bl]], th, th * 0.4), 'dragonRed', V(0, y0, 0));
  for (const sz of [-1, 1]) K.at(new THREE.BoxGeometry(w * 0.16, bl * 0.75, th * 0.25), 'darkSteel', V(0, y0 + bl * 0.4, sz * th * 0.6));
  for (const sx of [-1, 1]) {
    K.add(taper(Q(V(0, gy, 0), V(sx * 0.9 * L, gy - 0.05 * L, 0), V(sx * 1.3 * L, gy + 0.45 * L, 0)), 0.14 * L, 0.02 * L, 10, 6, 0.6), 'gold');
  }
  K.at(new THREE.BoxGeometry(0.5 * L, 0.24 * L, 0.3 * L), 'gold', V(0, gy, 0));
  grip(K, L, -0.95 * L, 0.48 * L, 0.13 * L, 'redWrap', 'gold');
  K.at(new THREE.TorusGeometry(0.28 * L, 0.07 * L, 8, 20), 'gold', V(0, -1.3 * L, 0));
  return K.build();
}

/** gf = { bone, basis, center, L, fdir? } de gripFrame. Devuelve { bone, mesh }. */
export function buildLegendWeapon(itemId, gf, tune = { x: 0, y: 0, z: 0, s: 1 }) {
  if (!gf) return null;
  const L = gf.L * (tune.s || 1);
  let u = null;
  if (itemId.startsWith('gs_')) u = godsword(itemId.slice(3), L);
  else if (itemId === 'sword_tindaya') u = tindaya(L);
  else if (itemId === 'dagger_dragon') u = dagger(L);
  else if (itemId === 'claws_dragon') {
    let fx = 1;
    if (gf.fdir) fx = gf.fdir.clone().applyMatrix4(gf.basis.clone().transpose()).x;
    u = claws(L, fx);
  }
  if (!u) return null;
  u.position.set((tune.x || 0) * L, (tune.y || 0) * L, (tune.z || 0) * L);
  const g = new THREE.Group();
  g.applyMatrix4(gf.basis);
  g.position.copy(gf.center);
  g.add(u);
  return { bone: gf.bone, mesh: g };
}
