/**
 * SebasPresent — Armaduras procedurales (Sesión 50)
 *
 * Las piezas forjadas (yelmo, pechera, grebas, botas, guanteletes) de los 7 materiales
 * no tienen GLB en R2. En vez de esperar a tener modelos, se generan aquí con
 * geometría low-poly metálica, del color del material, y se anclan a los
 * huesos del personaje (Mixamo).
 *
 * Cómo se colocan sin calibrar a mano:
 *   - El tamaño sale de la longitud del hueso (Head→HeadTop_End, UpLeg→Leg...),
 *     así que da igual la escala del FBX.
 *   - "Delante" y "arriba" se sacan de la pose de reposo (skeleton.boneInverses):
 *     en el espacio del modelo Mixamo, +Z es delante y +Y arriba.
 *
 * API:
 *   isProceduralArmor(itemId)                → true si este item se genera aquí
 *   buildProceduralArmor(itemId, slot, root) → [{ bone, mesh }] o null
 *
 * Ajuste fino in-game: window.__procArmorTune = { helm: { y: 0, z: 0, s: 1 } }
 * y volver a equipar. (Multiplica/desplaza en unidades de "longitud del hueso".)
 */

import * as THREE from 'three';
import { buildDragonArmor } from './armor_dragon.js';   // Sesión 51 — set de dragón propio
import { LEGEND_IDS, buildLegendWeapon } from './weapons_legend.js';   // Sesión 51 — armas legendarias
import { CAPE_IDS, buildCape } from './capes.js';                       // Sesión 51 — capas animadas

export const ARMOR_COLORS = {
  bronze:    { base: 0xb87333, trim: 0xe6a064, gem: null,     metal: 0.75, rough: 0.38 },
  hierro:    { base: 0x7c7f84, trim: 0xb9bdc3, gem: null,     metal: 0.8,  rough: 0.42 },
  acero:     { base: 0xaab4bd, trim: 0xe8f0f6, gem: null,     metal: 0.85, rough: 0.28 },
  oro:       { base: 0xd4af37, trim: 0xfff0a0, gem: null,     metal: 0.9,  rough: 0.25 },
  obsidiana: { base: 0x2a2433, trim: 0x6c5a8a, gem: 0xa36bff, metal: 0.5,  rough: 0.2 },
  basaltita: { base: 0x3a3f45, trim: 0x6c737b, gem: 0xff6a2a, metal: 0.55, rough: 0.5 },
  teiderio:  { base: 0x2f9e8f, trim: 0x7fe8d8, gem: 0x5fffe0, metal: 0.7,  rough: 0.25 },
  // Sesión 50 — armadura de cuero (Artesanía)
  cuero:     { base: 0x7a4a26, trim: 0x3e2412, gem: null,     metal: 0.0,  rough: 0.9 },
  // Sesión 50 — equipo de dragón (lo sueltan los jefes)
  dragon:    { base: 0xa3161a, trim: 0x2a1412, gem: 0xffa030, metal: 0.55, rough: 0.32 },
  // Sesión 52 — cuero de arquero por animal
  lobo:      { base: 0x6e6a66, trim: 0x3a3632, gem: null,     metal: 0.0,  rough: 0.95 },
  escorpion: { base: 0x6a4416, trim: 0xd09a38, gem: null,     metal: 0.15, rough: 0.45 },
  yeti:      { base: 0xe6edf2, trim: 0x8aa2b4, gem: null,     metal: 0.0,  rough: 0.95 },
  escama:    { base: 0x5c1212, trim: 0x1c0a08, gem: 0xffa030, metal: 0.25, rough: 0.42 },
  // Sesión 52 — túnicas de mago (forma propia: sombrero, túnica y falda)
  algodon:   { base: 0xe8dcc0, trim: 0x8a7650, gem: null,     metal: 0.0,  rough: 0.95 },
  lino:      { base: 0x7f9cc2, trim: 0xece2c6, gem: null,     metal: 0.0,  rough: 0.9 },
  seda:      { base: 0x5a2a8a, trim: 0xd8b040, gem: null,     metal: 0.05, rough: 0.55 },
  cabildo:   { base: 0x7a1420, trim: 0x1a1414, gem: 0xff4030, metal: 0.05, rough: 0.6 },
  magister:  { base: 0x1a2a6a, trim: 0xf0d060, gem: 0x60c0ff, metal: 0.1,  rough: 0.5 },
};
const TIER = { cuero: 0, bronze: 0, hierro: 1, acero: 2, oro: 3, obsidiana: 4, basaltita: 5, teiderio: 6, dragon: 7,
  lobo: 0, escorpion: 1, yeti: 1, escama: 2,                                  // Sesión 52
  algodon: 0, lino: 0, seda: 0, cabildo: 0, magister: 0 };
const ROBE_MATS = new Set(['algodon', 'lino', 'seda', 'cabildo', 'magister']);   // Sesión 52
const ARCHER_MATS = new Set(['cuero', 'lobo', 'escorpion', 'yeti', 'escama']);   // 19 oct — ropa de arquero
const PROC_SLOTS = new Set(['helm', 'body', 'legs', 'boots', 'gloves', 'shield']);

export function materialOf(itemId) {
  const m = String(itemId || '').replace(/_2h$/, '').split('_').pop();
  return ARMOR_COLORS[m] ? m : null;
}

export function isProceduralArmor(itemId, slot) {
  if (slot === 'cape' && (PROC_CAPES[itemId] || CAPE_IDS.has(itemId))) return true;   // Sesión 50/51 — capas procedurales
  if (slot === 'quiver' && String(itemId || '').startsWith('quiver')) return true;   // 19 oct — carcaj a la cadera
  return PROC_SLOTS.has(slot) && !!materialOf(itemId);
}
const PROC_CAPES = { cape_fuego: true };

// ------------------------------------------------------------
// Materiales (cacheados por material)
// ------------------------------------------------------------
const _mats = new Map();
function mats(matId) {
  if (_mats.has(matId)) return _mats.get(matId);
  const C = ARMOR_COLORS[matId];
  const mk = (color, extra = {}) => new THREE.MeshStandardMaterial({
    color, metalness: C.metal, roughness: C.rough, flatShading: true, ...extra,
  });
  const out = {
    base: mk(C.base),
    baseDS: mk(C.base, { side: THREE.DoubleSide }),
    trim: mk(C.trim),
    dark: mk(new THREE.Color(C.base).multiplyScalar(0.55).getHex()),
    gem: C.gem ? new THREE.MeshStandardMaterial({ color: C.gem, emissive: C.gem, emissiveIntensity: 1.3, roughness: 0.2 }) : null,
  };
  _mats.set(matId, out);
  return out;
}

// ------------------------------------------------------------
// Huesos
// ------------------------------------------------------------
const bare = (n) => String(n || '').replace(/^mixamorig\d*:?/, '');

function findBone(root, name) {
  let found = null;
  root.traverse(o => { if (!found && bare(o.name) === name) found = o; });
  return found;
}
function childNamed(bone, name) {
  return bone?.children?.find(c => bare(c.name) === name) || null;
}

/**
 * Base local del hueso: { fwd, up } en su espacio local.
 * "Delante" se deduce de la anatomía en pose de reposo (no del eje del
 * modelo, que cambia entre FBX y GLB): izquierda = LeftUpLeg − RightUpLeg,
 * arriba = Head − Hips, delante = izquierda × arriba.
 */
function bindInfo(root, bone) {
  let res = null;
  root.traverse(o => {
    if (res || !o.isSkinnedMesh || !o.skeleton) return;
    const sk = o.skeleton;
    const i = sk.bones.indexOf(bone);
    if (i < 0) return;
    const posOf = (name) => {
      const b = sk.bones.find(x => bare(x.name) === name);
      if (!b) return null;
      const m = sk.boneInverses[sk.bones.indexOf(b)].clone().invert();
      return new THREE.Vector3().setFromMatrixPosition(m);
    };
    const pL = posOf('LeftUpLeg'), pR = posOf('RightUpLeg'), pH = posOf('Head'), pHip = posOf('Hips');
    if (!pL || !pR || !pH || !pHip) return;
    const left = pL.sub(pR).normalize();
    const up = pH.sub(pHip).normalize();
    const fwd = new THREE.Vector3().crossVectors(left, up).normalize();
    const upO = new THREE.Vector3().crossVectors(fwd, left).normalize();
    const rot = new THREE.Quaternion();
    sk.boneInverses[i].decompose(new THREE.Vector3(), rot, new THREE.Vector3());
    res = { fwd: fwd.applyQuaternion(rot).normalize(), up: upO.applyQuaternion(rot).normalize() };
  });
  return res;
}

function boneBasis(root, bone) {
  const b = bindInfo(root, bone);
  if (b) return b;
  root.updateMatrixWorld(true);
  const qb = new THREE.Quaternion(); bone.getWorldQuaternion(qb);
  const qr = new THREE.Quaternion(); root.getWorldQuaternion(qr);
  const q = qb.invert().multiply(qr);
  return {
    fwd: new THREE.Vector3(0, 0, 1).applyQuaternion(q).normalize(),
    up: new THREE.Vector3(0, 1, 0).applyQuaternion(q).normalize(),
  };
}

/** Matriz de orientación: eje Y de la pieza = `axis`, eje Z ≈ `fwd`. */
function orient(axis, fwd) {
  const y = axis.clone().normalize();
  const z = fwd.clone().sub(y.clone().multiplyScalar(fwd.dot(y)));
  if (z.lengthSq() < 1e-6) z.set(0, 0, 1);
  z.normalize();
  const x = new THREE.Vector3().crossVectors(y, z).normalize();
  return new THREE.Matrix4().makeBasis(x, y, z);
}

function tune(slot) {
  const t = (typeof window !== 'undefined' && window.__procArmorTune?.[slot]) || {};
  return { y: t.y || 0, z: t.z || 0, x: t.x || 0, s: t.s || 1 };
}

// Longitud de respaldo (m del mundo → unidades locales del hueso)
function fallbackLen(bone, meters) {
  const s = new THREE.Vector3(); bone.getWorldScale(s);
  return meters / (s.y || 0.01);
}

// ------------------------------------------------------------
// Piezas — se AJUSTAN a la malla del personaje: se buscan los vértices que
// mueve cada hueso (pose de reposo) y se mide su caja. Así el yelmo tiene el
// tamaño de la cabeza, las grebas el de la pierna, etc., sea cual sea el FBX.
// ------------------------------------------------------------
const _vertCache = new Map();

/** Vértices pesados (>50 %) por `weightBones`, en el espacio local de `frameBone`. */
function boneVerts(root, weightBones, frameBone) {
  const key = root.uuid + '|' + weightBones.map(b => b.uuid).join(',') + '|' + frameBone.uuid;
  if (_vertCache.has(key)) return _vertCache.get(key);
  const out = [];
  root.traverse(o => {
    if (!o.isSkinnedMesh || !o.skeleton || !o.geometry?.attributes?.skinIndex) return;
    const sk = o.skeleton;
    const idx = new Set(weightBones.map(b => sk.bones.indexOf(b)).filter(i => i >= 0));
    const fi = sk.bones.indexOf(frameBone);
    if (!idx.size || fi < 0) return;
    const M = new THREE.Matrix4().multiplyMatrices(sk.boneInverses[fi], o.bindMatrix);
    const pos = o.geometry.attributes.position;
    const si = o.geometry.attributes.skinIndex, sw = o.geometry.attributes.skinWeight;
    const step = Math.max(1, Math.floor(pos.count / 40000));
    for (let i = 0; i < pos.count; i += step) {
      let w = 0;
      for (let k = 0; k < 4; k++) if (idx.has(si.getComponent(i, k))) w += sw.getComponent(i, k);
      if (w > 0.5) out.push(new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(M));
    }
  });
  _vertCache.set(key, out);
  return out;
}

/** Caja de los vértices vista desde la base `basis` (x lado, y eje, z delante). */
function fitBox(verts, basis) {
  if (!verts || verts.length < 12) return null;
  const inv = basis.clone().transpose();   // ortonormal
  const box = new THREE.Box3();
  const v = new THREE.Vector3();
  for (const p of verts) box.expandByPoint(v.copy(p).applyMatrix4(inv));
  return box;
}

/** Grupo exterior orientado con `basis` (en el espacio del hueso). */
function framed(basis) {
  const g = new THREE.Group();
  g.applyMatrix4(basis);
  return g;
}

// ---------------- Yelmo ----------------
function buildHelm(root, matId) {
  const head = findBone(root, 'Head');
  if (!head) return null;
  const top = childNamed(head, 'HeadTop_End');
  const { fwd, up } = boneBasis(root, head);
  const upDir = top ? top.position.clone().normalize() : up;
  const basis = orient(upDir, fwd);
  const M = mats(matId), T = TIER[matId], tn = tune('helm');

  let box = fitBox(boneVerts(root, [head, ...(top ? [top] : [])], head), basis);
  if (!box) {
    const L = top ? top.position.length() : fallbackLen(head, 0.2);
    box = new THREE.Box3(new THREE.Vector3(-0.45 * L, -0.1 * L, -0.5 * L), new THREE.Vector3(0.45 * L, 1.05 * L, 0.55 * L));
  }
  const h = box.max.y - box.min.y;
  const brimY = box.min.y + h * (0.55 + tn.y);
  const cx = (box.min.x + box.max.x) / 2, cz = (box.min.z + box.max.z) / 2 + h * tn.z;
  const rx = (box.max.x - box.min.x) / 2 * 1.13 * tn.s;
  const rz = (box.max.z - box.min.z) / 2 * 1.13 * tn.s;
  const ry = (box.max.y - brimY) * 1.12 * tn.s;

  // Casco en unidades: borde en y=0, cúpula hasta y=1, radio 1.
  const u = new THREE.Group();
  u.add(new THREE.Mesh(new THREE.SphereGeometry(1, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.5), M.base));
  // Nuca y laterales (abierto por delante)
  const skirt = new THREE.Mesh(new THREE.CylinderGeometry(1, 1.04, 0.7, 14, 1, true, Math.PI * 0.3, Math.PI * 1.4), M.baseDS);
  skirt.position.y = -0.35;
  u.add(skirt);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(1.02, 0.06, 5, 20), M.trim);
  rim.rotation.x = Math.PI / 2;
  u.add(rim);
  const nose = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.48, 0.1), M.trim);
  nose.position.set(0, -0.2, 1.0);
  u.add(nose);
  // Cresta: arco de delante a atrás siguiendo la cúpula (más gruesa en tiers altos)
  const crest = new THREE.Mesh(new THREE.TorusGeometry(1.0, 0.05 + T * 0.012, 4, 18, Math.PI), M.trim);
  crest.rotation.y = Math.PI / 2;
  crest.scale.set(1, 1.02, 1);
  u.add(crest);
  if (T >= 2) {   // acero+: carrilleras
    for (const sx of [-1, 1]) {
      const ch = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.62, 0.5), M.base);
      ch.position.set(sx * 0.97, -0.4, 0.5);
      ch.rotation.y = sx * 0.4;
      u.add(ch);
    }
  }
  if (T >= 4) {   // obsidiana+: cuernos
    for (const sx of [-1, 1]) {
      const horn = new THREE.Mesh(new THREE.ConeGeometry(0.15, 0.8 + (T - 4) * 0.25, 6), M.dark);
      horn.position.set(sx * 0.95, 0.6, 0);
      horn.rotation.z = -sx * 0.85;
      u.add(horn);
    }
  }
  if (M.gem) {
    const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.13, 0), M.gem);
    gem.position.set(0, 0.3, 0.98);
    u.add(gem);
  }
  u.scale.set(rx, ry, rz);
  u.position.set(cx, brimY, cz);
  const g = framed(basis);
  g.add(u);
  return [{ bone: head, mesh: g }];
}

/** Placa tubular elíptica ajustada a una caja (y0..y1 a lo largo del eje). */
function tubeFromBox(box, y0, y1, mat, grow = 1.12, taper = 0.88) {
  const rx = (box.max.x - box.min.x) / 2 * grow, rz = (box.max.z - box.min.z) / 2 * grow;
  const m = new THREE.Mesh(new THREE.CylinderGeometry(taper, 1, 1, 12), mat);
  m.scale.set(rx, y1 - y0, rz);
  m.position.set((box.min.x + box.max.x) / 2, (y0 + y1) / 2, (box.min.z + box.max.z) / 2);
  return m;
}

// ---------------- Grebas ----------------
function buildLegs(root, matId) {
  const M = mats(matId), T = TIER[matId], tn = tune('legs');
  const out = [];
  for (const side of ['Left', 'Right']) {
    const up = findBone(root, side + 'UpLeg');
    const leg = findBone(root, side + 'Leg');
    if (!up || !leg) continue;
    const foot = childNamed(leg, side + 'Foot') || findBone(root, side + 'Foot');

    // Muslo
    const dirT = (childNamed(up, side + 'Leg') || leg).position.clone().normalize();
    const bT = orient(dirT, boneBasis(root, up).fwd);
    const boxT = fitBox(boneVerts(root, [up], up), bT);
    const LT = leg.position.length();
    const gT = framed(bT);
    if (boxT) {
      const h = boxT.max.y - boxT.min.y;
      gT.add(tubeFromBox(boxT, boxT.min.y + h * 0.18, boxT.max.y - h * 0.04, M.base, 1.12 * tn.s, 0.86));
      if (T >= 2) gT.add(tubeFromBox(boxT, boxT.min.y + h * 0.5, boxT.min.y + h * 0.58, M.trim, 1.18 * tn.s, 0.98));
    } else {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(0.16 * LT, 0.2 * LT, 0.8 * LT, 10), M.base);
      m.position.y = 0.5 * LT; gT.add(m);
    }
    out.push({ bone: up, mesh: gT });

    // Espinillera + rodillera
    const dirS = foot ? foot.position.clone().normalize() : new THREE.Vector3(0, 1, 0);
    const fwdS = boneBasis(root, leg).fwd;
    const bS = orient(dirS, fwdS);
    const boxS = fitBox(boneVerts(root, [leg], leg), bS);
    const LS = foot ? foot.position.length() : LT;
    const gS = framed(bS);
    if (boxS) {
      const h = boxS.max.y - boxS.min.y;
      gS.add(tubeFromBox(boxS, boxS.min.y + h * 0.06, boxS.max.y - h * 0.1, M.base, 1.14 * tn.s, 0.8));
      const rz = (boxS.max.z - boxS.min.z) / 2;
      const knee = new THREE.Mesh(new THREE.SphereGeometry(1, 9, 6), M.trim);
      knee.scale.set(rz * 0.7, rz * 0.8, rz * 0.45);
      knee.position.set((boxS.min.x + boxS.max.x) / 2, boxS.min.y + h * 0.1, boxS.max.z * 1.08);
      gS.add(knee);
      if (M.gem) {
        const gem = new THREE.Mesh(new THREE.OctahedronGeometry(rz * 0.25, 0), M.gem);
        gem.position.set(knee.position.x, knee.position.y, boxS.max.z * 1.08 + rz * 0.45);
        gS.add(gem);
      }
    } else {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(0.1 * LS, 0.14 * LS, 0.8 * LS, 10), M.base);
      m.position.y = 0.45 * LS; gS.add(m);
    }
    out.push({ bone: leg, mesh: gS });
  }
  return out.length ? out : null;
}

// ---------------- Botas ----------------
function buildBoots(root, matId) {
  const M = mats(matId), T = TIER[matId], tn = tune('boots');
  const out = [];
  for (const side of ['Left', 'Right']) {
    const foot = findBone(root, side + 'Foot');
    if (!foot) continue;
    const toe = childNamed(foot, side + 'ToeBase');
    const toeEnd = toe ? childNamed(toe, side + 'Toe_End') : null;
    const dir = toe ? toe.position.clone().normalize() : new THREE.Vector3(0, 0, 1);
    const { up } = boneBasis(root, foot);
    // Base de la bota: Y = arriba, Z = hacia la punta
    const z = dir.clone().sub(up.clone().multiplyScalar(dir.dot(up))).normalize();
    const y = up.clone().normalize();
    const x = new THREE.Vector3().crossVectors(y, z).normalize();
    const basis = new THREE.Matrix4().makeBasis(x, y, z);
    const box = fitBox(boneVerts(root, [foot, ...(toe ? [toe] : []), ...(toeEnd ? [toeEnd] : [])], foot), basis);
    const g = framed(basis);
    const s = tn.s;
    if (box) {
      const w = (box.max.x - box.min.x) * 1.14 * s;
      const len = (box.max.z - box.min.z) * 1.08;
      const hgt = box.max.y - box.min.y;
      const cx = (box.min.x + box.max.x) / 2;
      // Pie
      const sole = new THREE.Mesh(new THREE.BoxGeometry(w, hgt * 1.08, len), M.base);
      sole.position.set(cx, box.min.y + hgt * 0.5, (box.min.z + box.max.z) / 2);
      g.add(sole);
      const tip = new THREE.Mesh(new THREE.BoxGeometry(w * 1.04, hgt * 0.7, len * 0.2), M.trim);
      tip.position.set(cx, box.min.y + hgt * 0.36, box.max.z - len * 0.06);
      g.add(tip);
      // Caña (tobillo)
      const cuffH = hgt * (0.9 + T * 0.06);
      const cuff = new THREE.Mesh(new THREE.CylinderGeometry(w * 0.52, w * 0.56, cuffH, 10), M.base);
      cuff.scale.z = 1.1;
      cuff.position.set(cx, box.min.y + hgt * 0.45 + cuffH / 2, box.min.z + len * 0.22);
      g.add(cuff);
      const band = new THREE.Mesh(new THREE.TorusGeometry(w * 0.55, w * 0.06, 4, 12), M.trim);
      band.rotation.x = Math.PI / 2;
      band.scale.y = 1.1;
      band.position.set(cx, box.min.y + hgt * 0.45 + cuffH, box.min.z + len * 0.22);
      g.add(band);
      if (M.gem) {
        const gem = new THREE.Mesh(new THREE.OctahedronGeometry(w * 0.12, 0), M.gem);
        gem.position.set(cx, box.min.y + hgt * 0.55, box.min.z + len * 0.55);
        g.add(gem);
      }
    } else {
      const L = toe ? toe.position.length() : fallbackLen(foot, 0.14);
      const b = new THREE.Mesh(new THREE.BoxGeometry(L * 0.6, L * 0.5, L * 1.4), M.base);
      b.position.set(0, -L * 0.3, L * 0.4); g.add(b);
    }
    out.push({ bone: foot, mesh: g });
  }
  return out.length ? out : null;
}

// ---------------- Guanteletes ----------------
function buildGloves(root, matId) {
  const M = mats(matId), T = TIER[matId], tn = tune('gloves');
  const out = [];
  for (const side of ['Left', 'Right']) {
    const hand = findBone(root, side + 'Hand');
    if (!hand) continue;
    const mid = childNamed(hand, side + 'HandMiddle1');
    const dir = mid ? mid.position.clone().normalize() : new THREE.Vector3(0, 1, 0);
    const basis = orient(dir, boneBasis(root, hand).fwd);
    const box = fitBox(boneVerts(root, [hand], hand), basis);
    const g = framed(basis);
    const s = tn.s;
    if (box) {
      const cx = (box.min.x + box.max.x) / 2, cz = (box.min.z + box.max.z) / 2;
      const w = (box.max.x - box.min.x) * 1.12 * s, d = (box.max.z - box.min.z) * 1.18 * s;
      const L = box.max.y - Math.max(box.min.y, 0);
      // Mano (palma + dorso)
      const back = new THREE.Mesh(new THREE.BoxGeometry(w, L * 0.95, d), M.base);
      back.position.set(cx, L * 0.47, cz);
      g.add(back);
      const kn = new THREE.Mesh(new THREE.BoxGeometry(w * 1.04, L * 0.18, d * 1.08), M.trim);
      kn.position.set(cx, L * 0.9, cz);
      g.add(kn);
      // Puño hacia el antebrazo
      const cuffH = L * (1.0 + T * 0.06);
      const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.62, 1, 10), M.base);
      cuff.scale.set(w * 1.0, cuffH, d * 1.05);
      cuff.position.set(cx, -cuffH / 2 + L * 0.08, cz);
      g.add(cuff);
      const rim = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.08, 4, 12), M.trim);
      rim.rotation.x = Math.PI / 2;
      rim.scale.set(w, d * 1.05, 1);
      rim.position.set(cx, -cuffH + L * 0.08, cz);
      g.add(rim);
      if (M.gem) {
        const gem = new THREE.Mesh(new THREE.OctahedronGeometry(Math.min(w, d) * 0.22, 0), M.gem);
        gem.position.set(cx, -cuffH * 0.45, cz + d * 0.62);
        g.add(gem);
      }
    } else {
      const L = mid ? mid.position.length() : fallbackLen(hand, 0.09);
      const b = new THREE.Mesh(new THREE.BoxGeometry(L, L, L * 0.45), M.base);
      b.position.y = L * 0.4; g.add(b);
    }
    out.push({ bone: hand, mesh: g });
  }
  return out.length ? out : null;
}

// ---------------- Pechera (torso + hombreras + cinturón) ----------------
function spineFrame(root, bone, childName) {
  const child = childNamed(bone, childName);
  const dir = child ? child.position.clone().normalize() : boneBasis(root, bone).up;
  return orient(dir, boneBasis(root, bone).fwd);
}

function buildBody(root, matId) {
  const M = mats(matId), T = TIER[matId], tn = tune('body');
  const hips = findBone(root, 'Hips');
  const sp = findBone(root, 'Spine');
  const sp1 = findBone(root, 'Spine1');
  const sp2 = findBone(root, 'Spine2');
  if (!sp || !sp2) return null;
  const out = [];
  const s = tn.s;

  // --- Peto (pecho): Spine2 ---
  {
    const basis = spineFrame(root, sp2, 'Neck');
    const box = fitBox(boneVerts(root, [sp2], sp2), basis);
    if (box) {
      const g = framed(basis);
      const h = box.max.y - box.min.y;
      const rx = (box.max.x - box.min.x) / 2 * 1.26 * s, rz = (box.max.z - box.min.z) / 2 * 1.32 * s;
      const cx = (box.min.x + box.max.x) / 2, cz = (box.min.z + box.max.z) / 2;
      const y0 = box.min.y - h * 0.12, y1 = box.max.y - h * 0.02;
      const shell = new THREE.Mesh(new THREE.CylinderGeometry(1, 0.92, 1, 14, 1, true), M.baseDS);
      shell.scale.set(rx, y1 - y0, rz);
      shell.position.set(cx, (y0 + y1) / 2, cz);
      g.add(shell);
      // Hombros del peto (tapa superior con cuello abierto)
      const yoke = new THREE.Mesh(new THREE.RingGeometry(0.42, 1, 14, 1), M.baseDS);
      yoke.rotation.x = -Math.PI / 2;
      yoke.scale.set(rx, rz, 1);
      yoke.position.set(cx, y1, cz);
      g.add(yoke);
      const collar = new THREE.Mesh(new THREE.TorusGeometry(0.44, 0.07, 5, 14), M.trim);
      collar.rotation.x = Math.PI / 2;
      collar.scale.set(rx, rz, rx);
      collar.position.set(cx, y1 + h * 0.02, cz);
      g.add(collar);
      // Quilla central delante
      const ridge = new THREE.Mesh(new THREE.BoxGeometry(rx * 0.12, (y1 - y0) * 0.85, rz * 0.12), M.trim);
      ridge.position.set(cx, (y0 + y1) / 2, cz + rz * 0.98);
      g.add(ridge);
      if (T >= 3) {   // oro+: bandas horizontales
        const band = new THREE.Mesh(new THREE.TorusGeometry(1.0, 0.035, 4, 16), M.trim);
        band.rotation.x = Math.PI / 2;
        band.scale.set(rx * 1.0, rz * 1.0, 1);
        band.position.set(cx, y0 + (y1 - y0) * 0.45, cz);
        g.add(band);
      }
      if (M.gem) {
        const gem = new THREE.Mesh(new THREE.OctahedronGeometry(rx * 0.14, 0), M.gem);
        gem.position.set(cx, y0 + (y1 - y0) * 0.62, cz + rz * 1.05);
        g.add(gem);
      }
      out.push({ bone: sp2, mesh: g });
    }
  }

  // --- Faja abdominal: Spine + Spine1 (en el marco de Spine1 si existe) ---
  {
    const fb = sp1 || sp;
    const basis = spineFrame(root, fb, sp1 ? 'Spine2' : 'Spine1');
    const box = fitBox(boneVerts(root, [sp, ...(sp1 ? [sp1] : [])], fb), basis);
    if (box) {
      const g = framed(basis);
      const h = box.max.y - box.min.y;
      const rx = (box.max.x - box.min.x) / 2 * 1.26 * s, rz = (box.max.z - box.min.z) / 2 * 1.3 * s;
      const cx = (box.min.x + box.max.x) / 2, cz = (box.min.z + box.max.z) / 2;
      // Láminas superpuestas (3)
      for (let i = 0; i < 3; i++) {
        const a = box.min.y + h * (0.02 + i * 0.36), b = a + h * 0.42;
        const lam = new THREE.Mesh(new THREE.CylinderGeometry(1 - i * 0.0, 0.97, 1, 14, 1, true), i === 1 ? M.dark : M.baseDS);
        const k = 1.0 + (2 - i) * 0.02;
        lam.scale.set(rx * k, b - a, rz * k);
        lam.position.set(cx, (a + b) / 2, cz);
        g.add(lam);
      }
      out.push({ bone: fb, mesh: g });
    }
  }

  // --- Cinturón + faldones (tassets): Hips ---
  if (hips) {
    const basis = spineFrame(root, hips, 'Spine');
    const box = fitBox(boneVerts(root, [hips], hips), basis);
    if (box) {
      const g = framed(basis);
      const h = box.max.y - box.min.y;
      const rx = (box.max.x - box.min.x) / 2 * 1.2 * s, rz = (box.max.z - box.min.z) / 2 * 1.26 * s;
      const cx = (box.min.x + box.max.x) / 2, cz = (box.min.z + box.max.z) / 2;
      const beltY = box.max.y - h * 0.18;
      const belt = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 14, 1, true), M.baseDS);
      belt.scale.set(rx, h * 0.2, rz);
      belt.position.set(cx, beltY, cz);
      g.add(belt);
      const buckle = new THREE.Mesh(new THREE.BoxGeometry(rx * 0.3, h * 0.2, rz * 0.12), M.trim);
      buckle.position.set(cx, beltY, cz + rz * 1.0);
      g.add(buckle);
      // Faldones delante y a los lados
      for (const [ang, w] of [[0, 0.62], [-0.9, 0.5], [0.9, 0.5]]) {
        const tas = new THREE.Mesh(new THREE.BoxGeometry(rx * w, h * (0.45 + T * 0.02), rz * 0.08), M.base);
        const px = cx + Math.sin(ang) * rx * 1.02, pz = cz + Math.cos(ang) * rz * 1.02;
        tas.position.set(px, beltY - h * 0.3, pz);
        tas.rotation.y = ang;
        tas.rotation.x = 0.12;
        g.add(tas);
      }
      out.push({ bone: hips, mesh: g });
    }
  }

  // --- Hombreras: en el brazo (LeftArm / RightArm) ---
  for (const side of ['Left', 'Right']) {
    const arm = findBone(root, side + 'Arm');
    if (!arm) continue;
    const fore = childNamed(arm, side + 'ForeArm');
    const dir = fore ? fore.position.clone().normalize() : new THREE.Vector3(0, 1, 0);
    const basis = orient(dir, boneBasis(root, arm).fwd);
    const box = fitBox(boneVerts(root, [arm], arm), basis);
    if (!box) continue;
    const g = framed(basis);
    const L = box.max.y - Math.max(0, box.min.y);
    const rx = (box.max.x - box.min.x) / 2, rz = (box.max.z - box.min.z) / 2;
    const r = Math.max(rx, rz) * (1.45 + T * 0.04) * s;
    // En el marco del brazo: y = a lo largo del brazo.
    const cx = (box.min.x + box.max.x) / 2, cz = (box.min.z + box.max.z) / 2;
    // ¿"Arriba" es +x o −x en este marco? (cambia entre brazo izq. y der.)
    const upF = boneBasis(root, arm).up.clone().applyMatrix4(basis.clone().transpose());
    const sgn = upF.x >= 0 ? 1 : -1;
    const pad = new THREE.Group();
    pad.position.set(cx + sgn * r * 0.12, L * 0.1, cz);
    pad.rotation.z = -sgn * Math.PI / 2;   // polo +Y → hacia arriba
    const cap = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 7, 0, Math.PI * 2, 0, Math.PI * 0.5), M.baseDS);
    cap.scale.set(r * 0.95, r * 0.8, r);
    pad.add(cap);
    const lip = new THREE.Mesh(new THREE.TorusGeometry(1, 0.06, 4, 16), M.trim);
    lip.rotation.x = Math.PI / 2;
    lip.scale.set(r * 0.95, r, 1);
    pad.add(lip);
    g.add(pad);
    if (T >= 4) {   // pinchos
      for (let i = -1; i <= 1; i++) {
        const sp = new THREE.Mesh(new THREE.ConeGeometry(r * 0.14, r * (0.55 + (T - 4) * 0.12), 5), M.dark);
        sp.position.set(i * r * 0.35, r * 0.8, 0);
        pad.add(sp);
      }
    } else if (M.gem) {
      const gem = new THREE.Mesh(new THREE.OctahedronGeometry(r * 0.16, 0), M.gem);
      gem.position.set(0, r * 0.82, 0);
      pad.add(gem);
    }
    out.push({ bone: arm, mesh: g });
  }
  return out.length ? out : null;
}

// ---------------- Escudo (antebrazo izquierdo) ----------------
function buildShield(root, matId) {
  const M = mats(matId), T = TIER[matId], tn = tune('shield');
  const fore = findBone(root, 'LeftForeArm');
  if (!fore) return null;
  const hand = childNamed(fore, 'LeftHand') || findBone(root, 'LeftHand');
  const len = hand ? hand.position.length() : fallbackLen(fore, 0.26);
  const axis = hand ? hand.position.clone().normalize() : new THREE.Vector3(0, 1, 0);
  // Cara del escudo = dorso del antebrazo (arriba en pose T)
  let n = boneBasis(root, fore).up.clone();
  n.sub(axis.clone().multiplyScalar(n.dot(axis))).normalize();
  const basis = orient(n, axis);        // y = normal del escudo, z = a lo largo del antebrazo
  const box = fitBox(boneVerts(root, [fore], fore), orient(axis, n));
  const armR = box ? Math.max(box.max.x - box.min.x, box.max.z - box.min.z) / 2 : len * 0.2;

  const R = len * 1.05 * tn.s;
  const th = R * 0.07;
  const g = framed(basis);
  const u = new THREE.Group();
  u.position.set(0, armR * 1.15 + th / 2 + len * tn.y, len * (0.52 + tn.z));
  g.add(u);
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(R, R, th, 22), M.base);
  u.add(disc);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(R, th * 0.75, 5, 26), M.trim);
  rim.rotation.x = Math.PI / 2;
  u.add(rim);
  const boss = new THREE.Mesh(new THREE.SphereGeometry(R * 0.24, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), M.trim);
  boss.position.y = th / 2;
  u.add(boss);
  if (T >= 1) {   // hierro+: anillo interior
    const ring = new THREE.Mesh(new THREE.TorusGeometry(R * 0.62, th * 0.35, 4, 22), M.dark);
    ring.rotation.x = Math.PI / 2; ring.position.y = th / 2;
    u.add(ring);
  }
  if (T >= 2) {   // acero+: cruz de refuerzo
    for (const rot of [0, Math.PI / 2]) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(R * 1.9, th * 0.5, R * 0.14), M.trim);
      bar.rotation.y = rot; bar.position.y = th / 2 + th * 0.2;
      u.add(bar);
    }
  }
  if (T >= 3) {   // oro+: remaches en el borde
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      const rv = new THREE.Mesh(new THREE.SphereGeometry(R * 0.05, 5, 4), M.trim);
      rv.position.set(Math.cos(a) * R * 0.84, th / 2, Math.sin(a) * R * 0.84);
      u.add(rv);
    }
  }
  if (T >= 4) {   // obsidiana+: pincho central
    const spike = new THREE.Mesh(new THREE.ConeGeometry(R * 0.1, R * (0.4 + (T - 4) * 0.1), 6), M.dark);
    spike.position.y = th / 2 + R * 0.24 + R * 0.18;
    u.add(spike);
  }
  if (M.gem) {
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      const gem = new THREE.Mesh(new THREE.OctahedronGeometry(R * 0.07, 0), M.gem);
      gem.position.set(Math.cos(a) * R * 0.45, th / 2 + R * 0.03, Math.sin(a) * R * 0.45);
      u.add(gem);
    }
  }
  return [{ bone: fore, mesh: g }];
}

// ---------------- Espadas (mano derecha) ----------------
function swordMats(matId) {
  const key = 'sw_' + matId;
  if (_mats.has(key)) return _mats.get(key);
  const C = ARMOR_COLORS[matId];
  const blade = new THREE.MeshStandardMaterial({
    color: new THREE.Color(C.base).lerp(new THREE.Color(0xffffff), 0.18), metalness: Math.min(1, C.metal + 0.1),
    roughness: Math.max(0.12, C.rough - 0.12), flatShading: true,
    emissive: C.gem || 0x000000, emissiveIntensity: C.gem ? 0.18 : 0,
  });
  const grip = new THREE.MeshStandardMaterial({ color: 0x4a2e1a, roughness: 0.9, flatShading: true });
  const out = { blade, grip };
  _mats.set(key, out);
  return out;
}

/** Marco de agarre de la mano: { bone, basis (x filo, y hoja, z palma), center, L }. */
function gripFrame(root, side, handBone) {
  const hand = handBone || findBone(root, side + 'Hand');
  if (!hand) return null;
  const mid = childNamed(hand, side + 'HandMiddle1');
  const idx = childNamed(hand, side + 'HandIndex1');
  const pk = childNamed(hand, side + 'HandPinky1') || childNamed(hand, side + 'HandRing1');
  const L = mid ? mid.position.length() : fallbackLen(hand, 0.09);
  const fdir = mid ? mid.position.clone().normalize() : new THREE.Vector3(0, 1, 0);
  let across = (idx && pk) ? idx.position.clone().sub(pk.position) : boneBasis(root, hand).fwd.clone();
  across.sub(fdir.clone().multiplyScalar(across.dot(fdir))).normalize();
  // Palma: en pose T mira hacia abajo
  const down = boneBasis(root, hand).up.clone().negate();
  let palm = new THREE.Vector3().crossVectors(fdir, across).normalize();
  if (palm.dot(down) < 0) palm.negate();
  const y = across, z = palm;
  const x = new THREE.Vector3().crossVectors(y, z).normalize();
  const basis = new THREE.Matrix4().makeBasis(x, y, z);
  const base = (idx && pk) ? idx.position.clone().add(pk.position).multiplyScalar(0.5) : fdir.clone().multiplyScalar(L);
  const center = base.multiplyScalar(0.8).add(fdir.clone().multiplyScalar(L * 0.12)).add(palm.clone().multiplyScalar(L * 0.32));
  return { bone: hand, basis, center, L, fdir };
}

function buildSword(root, matId, twoHanded, handBone) {
  const gf = gripFrame(root, 'Right', handBone);
  if (!gf) return null;
  const M = mats(matId), SM = swordMats(matId), T = TIER[matId], tn = tune(twoHanded ? 'sword2h' : 'sword');
  const L = gf.L * tn.s;
  const u = new THREE.Group();
  const gripLen = twoHanded ? 2.3 * L : 1.2 * L;
  const bladeLen = (twoHanded ? 10.5 : 7.0) * L;
  const w = (twoHanded ? 0.42 : 0.3) * L;
  const thick = 0.09 * L;

  // Empuñadura (la mano derecha va arriba, junto a la guarda)
  const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.15 * L, 0.17 * L, gripLen, 7), SM.grip);
  grip.position.y = 0.55 * L - gripLen / 2;
  u.add(grip);
  const pommel = new THREE.Mesh(new THREE.SphereGeometry(0.24 * L, 8, 6), M.trim);
  pommel.position.y = 0.55 * L - gripLen - 0.15 * L;
  u.add(pommel);
  // Guarda
  const guardW = (twoHanded ? 3.0 : 2.1) * L;
  const guard = new THREE.Mesh(new THREE.BoxGeometry(guardW, 0.2 * L, 0.3 * L), M.trim);
  guard.position.y = 0.65 * L;
  u.add(guard);
  if (T >= 3) {   // oro+: puntas de la guarda hacia la hoja
    for (const sx of [-1, 1]) {
      const tip = new THREE.Mesh(new THREE.ConeGeometry(0.11 * L, 0.45 * L, 5), M.trim);
      tip.position.set(sx * guardW / 2, 0.82 * L, 0);
      tip.rotation.z = -sx * 0.5;
      u.add(tip);
    }
  }
  // Hoja (perfil extruido con punta)
  const tipLen = w * 2.4;
  const sh = new THREE.Shape();
  sh.moveTo(-w, 0);
  sh.lineTo(w, 0);
  sh.lineTo(w * 0.86, bladeLen - tipLen);
  sh.lineTo(0, bladeLen);
  sh.lineTo(-w * 0.86, bladeLen - tipLen);
  sh.closePath();
  const bladeGeo = new THREE.ExtrudeGeometry(sh, { depth: thick, bevelEnabled: true, bevelThickness: thick * 0.4, bevelSize: w * 0.12, bevelSegments: 1 });
  bladeGeo.translate(0, 0, -thick / 2);
  const blade = new THREE.Mesh(bladeGeo, SM.blade);
  blade.position.y = 0.72 * L;
  u.add(blade);
  // Acanaladura (línea oscura) en las dos caras
  for (const sz of [-1, 1]) {
    const f = new THREE.Mesh(new THREE.BoxGeometry(w * 0.22, bladeLen * 0.62, thick * 0.3), M.dark);
    f.position.set(0, 0.72 * L + bladeLen * 0.36, sz * (thick * 0.55 + thick * 0.4));
    u.add(f);
  }
  if (M.gem) {
    for (const sz of [-1, 1]) {
      const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.16 * L, 0), M.gem);
      gem.position.set(0, 0.65 * L, sz * 0.17 * L);
      u.add(gem);
    }
  }
  u.position.set(tn.x * L, tn.y * L, tn.z * L);
  const g = framed(gf.basis);
  g.position.copy(gf.center);
  g.add(u);
  return { bone: gf.bone, mesh: g };
}

const PROC_WEAPON_TYPES = new Set(['1h_sword', '2h_sword']);
// Sesión 50 — armas de dragón con modelo propio (no hay GLB)
const PROC_WEAPON_IDS = new Set(['bow_dragon', 'staff_dragomante']);

export function isProceduralWeapon(itemId, weaponType) {
  if (PROC_WEAPON_IDS.has(itemId) || LEGEND_IDS.has(itemId)) return true;
  return PROC_WEAPON_TYPES.has(weaponType) && !!materialOf(itemId);
}

// ---------------- Materiales de dragón ----------------
let _dragonM = null;
function dragonMats() {
  if (_dragonM) return _dragonM;
  const std = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.45, metalness: 0.2, flatShading: true, ...o });
  _dragonM = {
    scale: std(0x8a1214, { metalness: 0.35, roughness: 0.35 }),
    dark: std(0x2a0c0a, { roughness: 0.6 }),
    claw: std(0xe8dcc0, { roughness: 0.35 }),
    clawTip: std(0x1a1010, { roughness: 0.3, metalness: 0.4 }),
    leather: std(0x4a1a10, { roughness: 0.9, metalness: 0 }),
    gold: std(0xd8a030, { metalness: 0.85, roughness: 0.25 }),
    fire: new THREE.MeshStandardMaterial({ color: 0xffa030, emissive: 0xff5a10, emissiveIntensity: 1.6, roughness: 0.3 }),
    orb: new THREE.MeshStandardMaterial({ color: 0xff7a20, emissive: 0xff3a00, emissiveIntensity: 2.2, roughness: 0.1, transparent: true, opacity: 0.92 }),
    eye: new THREE.MeshStandardMaterial({ color: 0xffe040, emissive: 0xffc000, emissiveIntensity: 2 }),
  };
  return _dragonM;
}

/** Arco de garras de dragón (mano izquierda): palas hechas de garras encadenadas. */
function buildDragonBow(root, handBone) {
  const side = /Right/.test(handBone?.name || '') ? 'Right' : 'Left';
  const gf = gripFrame(root, side, handBone);
  if (!gf) return null;
  const D = dragonMats(), tn = tune('bow');
  const L = gf.L * tn.s;
  const u = new THREE.Group();
  const H = 7.2 * L, bulge = 3.2 * L;
  // Empuñadura de cuero con anillos dorados
  const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.3 * L, 0.3 * L, 1.8 * L, 8), D.leather);
  u.add(grip);
  for (const sy of [-1, 1]) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.33 * L, 0.07 * L, 4, 10), D.gold);
    ring.rotation.x = Math.PI / 2; ring.position.y = sy * 0.95 * L;
    u.add(ring);
  }
  // Curva de cada pala (en el plano XY; +x = hacia delante)
  const limbPts = [];
  for (const sy of [1, -1]) {
    const curve = new THREE.QuadraticBezierCurve3(
      new THREE.Vector3(0, sy * 0.9 * L, 0),
      new THREE.Vector3(bulge * 1.1, sy * H * 0.55, 0),
      new THREE.Vector3(bulge * 0.2, sy * H, 0));
    // Garras encadenadas a lo largo de la curva (más finas hacia la punta)
    const N = 7;
    for (let k = 0; k < N; k++) {
      const t0 = k / N, t1 = (k + 1) / N;
      const a = curve.getPoint(t0), b = curve.getPoint(t1);
      const len = a.distanceTo(b);
      const r = (0.34 - 0.2 * t0) * L;
      const seg = new THREE.Mesh(new THREE.ConeGeometry(r, len * 1.25, 6), k % 2 ? D.scale : D.dark);
      seg.position.copy(a).lerp(b, 0.5);
      seg.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
      u.add(seg);
      // púa de garra hacia fuera (lado de delante)
      if (k % 2 === 0) {
        const sp = new THREE.Mesh(new THREE.ConeGeometry(r * 0.45, r * 2.6, 5), D.claw);
        const dir = b.clone().sub(a).normalize();
        const out = new THREE.Vector3(dir.y * sy, -dir.x * sy, 0).normalize();   // normal hacia fuera
        if (out.x < 0) out.negate();
        sp.position.copy(a).addScaledVector(out, r * 1.1);
        sp.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), out.clone().multiplyScalar(0.8).addScaledVector(dir, 0.6).normalize());
        u.add(sp);
      }
    }
    // Garra grande en la punta (curva hacia atrás)
    const tip = curve.getPoint(1);
    const claw = new THREE.Mesh(new THREE.ConeGeometry(0.2 * L, 1.5 * L, 6), D.claw);
    claw.position.copy(tip).add(new THREE.Vector3(-0.35 * L, sy * 0.5 * L, 0));
    claw.rotation.z = sy > 0 ? 0.9 : Math.PI - 0.9;
    u.add(claw);
    const cTip = new THREE.Mesh(new THREE.ConeGeometry(0.1 * L, 0.5 * L, 5), D.clawTip);
    cTip.position.copy(claw.position).add(new THREE.Vector3(-0.55 * L, sy * 0.38 * L, 0));
    cTip.rotation.z = claw.rotation.z;
    u.add(cTip);
    limbPts.push(tip);
  }
  // Cuerda de fuego (línea brillante entre las puntas, por detrás)
  const a = limbPts[0], b = limbPts[1];
  const str = new THREE.Mesh(new THREE.CylinderGeometry(0.05 * L, 0.05 * L, a.distanceTo(b), 4), D.fire);
  str.position.copy(a).lerp(b, 0.5).add(new THREE.Vector3(-0.15 * L, 0, 0));
  u.add(str);
  // Ojo de dragón en el centro
  const eye = new THREE.Mesh(new THREE.OctahedronGeometry(0.28 * L, 0), D.eye);
  eye.position.set(0.35 * L, 0, 0);
  u.add(eye);
  u.rotation.set(tn.x || 0, 0, 0);
  const g = framed(gf.basis);
  g.position.copy(gf.center);
  g.add(u);
  return { bone: gf.bone, mesh: g };
}

/** Bastón de Dragomante: vara oscura con espiral roja y un cráneo de dragón con orbe de fuego. */
function buildDragomanteStaff(root, handBone) {
  const side = /Right/.test(handBone?.name || '') ? 'Right' : 'Left';
  const gf = gripFrame(root, side, handBone);
  if (!gf) return null;
  const D = dragonMats(), tn = tune('staff');
  const L = gf.L * tn.s;
  const u = new THREE.Group();
  const top = 9.5 * L, bottom = -6.5 * L;
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.2 * L, 0.26 * L, top - bottom, 8), D.dark);
  shaft.position.y = (top + bottom) / 2;
  u.add(shaft);
  // Espiral de escamas rojas
  for (let k = 0; k < 16; k++) {
    const y = bottom + 1 * L + k * ((top - bottom - 2.5 * L) / 16);
    const a = k * 0.9;
    const sc = new THREE.Mesh(new THREE.BoxGeometry(0.2 * L, 0.45 * L, 0.12 * L), D.scale);
    sc.position.set(Math.cos(a) * 0.24 * L, y, Math.sin(a) * 0.24 * L);
    sc.rotation.y = -a;
    u.add(sc);
  }
  // Contera de garra abajo
  const foot = new THREE.Mesh(new THREE.ConeGeometry(0.28 * L, 1.1 * L, 6), D.claw);
  foot.position.y = bottom - 0.4 * L; foot.rotation.x = Math.PI;
  u.add(foot);
  // Collar dorado
  const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.42 * L, 0.3 * L, 0.5 * L, 8), D.gold);
  collar.position.y = top - 0.2 * L;
  u.add(collar);
  // Cráneo de dragón mirando hacia delante (+x), con la boca abierta sujetando el orbe
  const head = new THREE.Group();
  head.position.y = top + 0.6 * L;
  const skull = new THREE.Mesh(new THREE.BoxGeometry(1.1 * L, 0.9 * L, 1.0 * L), D.scale);
  head.add(skull);
  const snout = new THREE.Mesh(new THREE.BoxGeometry(1.0 * L, 0.5 * L, 0.75 * L), D.scale);
  snout.position.set(0.95 * L, 0.1 * L, 0);
  head.add(snout);
  const jaw = new THREE.Mesh(new THREE.BoxGeometry(0.95 * L, 0.2 * L, 0.65 * L), D.dark);
  jaw.position.set(0.85 * L, -0.45 * L, 0); jaw.rotation.z = -0.35;
  head.add(jaw);
  for (const sz of [-1, 1]) {
    const horn = new THREE.Mesh(new THREE.ConeGeometry(0.16 * L, 1.4 * L, 5), D.claw);
    horn.position.set(-0.55 * L, 0.65 * L, sz * 0.35 * L);
    horn.rotation.set(sz * 0.3, 0, 0.9);
    head.add(horn);
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.11 * L, 6, 5), D.eye);
    eye.position.set(0.35 * L, 0.2 * L, sz * 0.5 * L);
    head.add(eye);
    for (let k = 0; k < 2; k++) {
      const tooth = new THREE.Mesh(new THREE.ConeGeometry(0.06 * L, 0.25 * L, 4), D.claw);
      tooth.position.set((1.1 + k * 0.25) * L, -0.2 * L, sz * 0.22 * L);
      tooth.rotation.x = Math.PI;
      head.add(tooth);
    }
  }
  const orb = new THREE.Mesh(new THREE.IcosahedronGeometry(0.42 * L, 1), D.orb);
  orb.position.set(1.05 * L, -0.15 * L, 0);
  head.add(orb);
  u.add(head);
  const g = framed(gf.basis);
  g.position.copy(gf.center);
  g.add(u);
  return { bone: gf.bone, mesh: g };
}

/** Raíz del personaje (el objeto que contiene la malla con esqueleto) a partir de un hueso. */
function skinRootOf(bone) {
  let p = bone;
  while (p.parent) {
    p = p.parent;
    let ok = false;
    p.traverse(o => { if (!ok && o.isSkinnedMesh && o.skeleton?.bones?.includes(bone)) ok = true; });
    if (ok) return p;
  }
  return null;
}

/**
 * Espada procedural. `root` = FBX del personaje; si no se tiene, pasar
 * `handBone` (se busca la raíz subiendo por los padres — sirve para peers).
 * Devuelve { bone, mesh } o null.
 */
export function buildProceduralWeapon(itemId, weaponType, root, handBone = null) {
  const r = root || (handBone && skinRootOf(handBone));
  if (!r) return null;
  let out = null;
  if (itemId === 'bow_dragon' || itemId === 'staff_dragomante') {
    const hb = handBone || findBone(r, 'LeftHand');
    out = itemId === 'bow_dragon' ? buildDragonBow(r, hb) : buildDragomanteStaff(r, hb);
    if (out) out.mesh.traverse(o => { if (o.isMesh) { o.frustumCulled = false; o.castShadow = true; } });
    return out;
  }
  // Sesión 51 — armas legendarias (antes del material: claws_dragon/dagger_dragon acaban en "dragon")
  if (LEGEND_IDS.has(itemId)) {
    const tn = tune(itemId);
    out = buildLegendWeapon(itemId, gripFrame(r, 'Right', handBone || findBone(r, 'RightHand')), tn);
    if (out) out.mesh.traverse(o => { if (o.isMesh) { o.frustumCulled = false; o.castShadow = true; } });
    // Sesión 51 — garras: una en CADA mano. La izquierda se pone/quita sola
    // cuando la derecha se añade/quita de su hueso (no hay que tocar a quien equipa).
    if (out && itemId === 'claws_dragon') {
      const lb = findBone(r, 'LeftHand');
      const left = lb ? buildLegendWeapon(itemId, gripFrame(r, 'Left', lb), tn) : null;
      if (left) {
        left.mesh.traverse(o => { if (o.isMesh) { o.frustumCulled = false; o.castShadow = true; } });
        out.mesh.addEventListener('added', () => { if (left.mesh.parent !== lb) lb.add(left.mesh); });
        out.mesh.addEventListener('removed', () => { left.mesh.parent?.remove(left.mesh); });
        out.mesh.userData.offHand = left.mesh;
      }
    }
    return out;
  }
  const matId = materialOf(itemId);
  if (!matId) return null;
  out = buildSword(r, matId, weaponType === '2h_sword', handBone);
  if (out) out.mesh.traverse(o => { if (o.isMesh) { o.frustumCulled = false; o.castShadow = true; } });
  return out;
}

/**
 * Construye la pieza y devuelve [{ bone, mesh }] (sin añadir aún a los huesos).
 * `root` = el FBX del personaje (character.mesh).
 */
export function buildProceduralArmor(itemId, slot, root) {
  // Sesión 51 — cada pieza lleva su hueco (la capa mide la armadura para colgar por fuera)
  const parts = _buildProceduralArmor(itemId, slot, root);
  if (parts) for (const p of parts) if (p?.mesh) p.mesh.userData.armorSlot = slot;
  return parts;
}

function _buildProceduralArmor(itemId, slot, root) {
  if (slot === 'quiver' && root) {   // 19 oct
    const parts = buildQuiver(root, itemId);
    if (parts) for (const p of parts) p.mesh.traverse(o => { if (o.isMesh) { o.frustumCulled = false; o.castShadow = true; } });
    return parts;
  }
  if (slot === 'cape' && CAPE_IDS.has(itemId) && root) {
    const parts = buildCape(itemId, DRAGON_HELPERS, root);
    if (parts) for (const p of parts) p.mesh.traverse(o => { if (o.isMesh) { o.frustumCulled = false; o.castShadow = true; } });
    return parts;
  }
  const matId = materialOf(itemId);
  if (!matId || !root) return null;
  let parts = null;
  if (matId === 'dragon') {
    try { parts = buildDragonArmor(slot, root, DRAGON_HELPERS); }
    catch (e) { console.warn('[armor] dragón falló, uso el genérico:', e?.message); parts = null; }
    if (parts) return parts;
  }
  if (ARCHER_MATS.has(matId)) {   // 19 oct — ropa de arquero (capucha, chaqueta, pantalón, brazales, botas)
    try {
      parts = slot === 'helm' ? buildHood(root, matId) : slot === 'body' ? buildJerkin(root, matId)
        : slot === 'legs' ? buildTrousers(root, matId) : slot === 'gloves' ? buildBracers(root, matId)
        : slot === 'boots' ? buildSoftBoots(root, matId) : null;
    } catch (e) { console.warn('[armor] arquero falló, uso el genérico:', e?.message); parts = null; }
    if (parts) { for (const p of parts) p.mesh.traverse(o => { if (o.isMesh) { o.frustumCulled = false; o.castShadow = true; } }); return parts; }
  }
  if (ROBE_MATS.has(matId) && (slot === 'helm' || slot === 'body' || slot === 'legs')) {   // Sesión 52 — ropa de mago
    try { parts = slot === 'helm' ? buildMageHat(root, matId) : slot === 'body' ? buildRobeBody(root, matId) : buildRobeSkirt(root, matId); }
    catch (e) { console.warn('[armor] túnica falló:', e?.message); parts = null; }
  }
  else if (slot === 'helm') parts = buildHelm(root, matId);
  else if (slot === 'body') parts = buildBody(root, matId);
  else if (slot === 'shield') parts = buildShield(root, matId);
  else if (slot === 'legs') parts = buildLegs(root, matId);
  else if (slot === 'boots') parts = buildBoots(root, matId);
  else if (slot === 'gloves') parts = buildGloves(root, matId);
  if (!parts) return null;
  for (const p of parts) p.mesh.traverse(o => { if (o.isMesh) { o.frustumCulled = false; o.castShadow = true; } });
  return parts;
}

// ------------------------------------------------------------
// Sesión 52 — Ropa de mago: sombrero de pico, túnica con mangas de campana
// y falda larga. Tela (sin placas ni remaches) con ribete del color "trim".
// ------------------------------------------------------------
/** Posición de reposo del hueso `name` en el espacio local de `frame` (o null). */
function restIn(root, frame, name) {
  let out = null;
  root.traverse(o => {
    if (out || !o.isSkinnedMesh || !o.skeleton) return;
    const sk = o.skeleton;
    const fi = sk.bones.indexOf(frame);
    const b = sk.bones.find(x => bare(x.name) === name);
    if (fi < 0 || !b) return;
    const world = new THREE.Vector3().setFromMatrixPosition(sk.boneInverses[sk.bones.indexOf(b)].clone().invert());
    out = world.applyMatrix4(sk.boneInverses[fi]);
  });
  return out;
}

function buildMageHat(root, matId) {
  const head = findBone(root, 'Head');
  if (!head) return null;
  const top = childNamed(head, 'HeadTop_End');
  const { fwd, up } = boneBasis(root, head);
  const basis = orient(top ? top.position.clone().normalize() : up, fwd);
  const M = mats(matId), tn = tune('helm');
  let box = fitBox(boneVerts(root, [head, ...(top ? [top] : [])], head), basis);
  if (!box) {
    const L = top ? top.position.length() : fallbackLen(head, 0.2);
    box = new THREE.Box3(new THREE.Vector3(-0.45 * L, -0.1 * L, -0.5 * L), new THREE.Vector3(0.45 * L, 1.05 * L, 0.55 * L));
  }
  const h = box.max.y - box.min.y;
  const baseY = box.min.y + h * (0.62 + tn.y);
  const cx = (box.min.x + box.max.x) / 2, cz = (box.min.z + box.max.z) / 2 + h * tn.z;
  const r = Math.max(box.max.x - box.min.x, box.max.z - box.min.z) / 2 * 1.08 * tn.s;
  const u = new THREE.Group();
  // Ala ancha
  const brim = new THREE.Mesh(new THREE.CylinderGeometry(1.75, 1.8, 0.07, 20), M.base);
  u.add(brim);
  // Copa: cono en dos tramos, la punta se dobla hacia atrás
  const c1 = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 1.0, 1.15, 16), M.base);
  c1.position.y = 0.6; u.add(c1);
  const tip = new THREE.Group(); tip.position.set(0, 1.15, 0); tip.rotation.x = -0.45; u.add(tip);
  const c2 = new THREE.Mesh(new THREE.ConeGeometry(0.62, 1.25, 16), M.base);
  c2.position.y = 0.6; tip.add(c2);
  // Cinta
  const band = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.02, 0.24, 18, 1, true), M.trim);
  band.position.y = 0.16; u.add(band);
  if (M.gem) {
    const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.17, 0), M.gem);
    gem.position.set(0, 0.17, 1.03); u.add(gem);
  } else {
    const buckle = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.26, 0.06), M.trim);
    buckle.position.set(0, 0.16, 1.02); u.add(buckle);
  }
  u.scale.set(r, r * 1.05, r);
  u.position.set(cx, baseY, cz);
  const g = framed(basis);
  g.add(u);
  return [{ bone: head, mesh: g }];
}

function buildRobeBody(root, matId) {
  const M = mats(matId), tn = tune('body');
  const sp = findBone(root, 'Spine'), sp1 = findBone(root, 'Spine1'), sp2 = findBone(root, 'Spine2');
  const hips = findBone(root, 'Hips');
  if (!sp || !sp2) return null;
  const out = [];
  const s = tn.s;
  // Pecho (Spine2): tela holgada con cuello y tira central del ribete
  {
    const basis = spineFrame(root, sp2, 'Neck');
    const box = fitBox(boneVerts(root, [sp2], sp2), basis);
    if (box) {
      const g = framed(basis);
      const h = box.max.y - box.min.y;
      const rx = (box.max.x - box.min.x) / 2 * 1.2 * s, rz = (box.max.z - box.min.z) / 2 * 1.26 * s;
      const cx = (box.min.x + box.max.x) / 2, cz = (box.min.z + box.max.z) / 2;
      const y0 = box.min.y - h * 0.14, y1 = box.max.y - h * 0.02;
      const shell = new THREE.Mesh(new THREE.CylinderGeometry(0.96, 1, 1, 16, 1, true), M.baseDS);
      shell.scale.set(rx, y1 - y0, rz); shell.position.set(cx, (y0 + y1) / 2, cz); g.add(shell);
      const yoke = new THREE.Mesh(new THREE.RingGeometry(0.4, 0.98, 16, 1), M.baseDS);
      yoke.rotation.x = -Math.PI / 2; yoke.scale.set(rx, rz, 1); yoke.position.set(cx, y1, cz); g.add(yoke);
      const collar = new THREE.Mesh(new THREE.TorusGeometry(0.44, 0.09, 6, 16), M.trim);
      collar.rotation.x = Math.PI / 2; collar.scale.set(rx, rz, rx); collar.position.set(cx, y1 + h * 0.02, cz); g.add(collar);
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(rx * 0.22, (y1 - y0) * 1.02, rz * 0.06), M.trim);
      stripe.position.set(cx, (y0 + y1) / 2, cz + rz * 1.0); g.add(stripe);
      if (M.gem) {
        const gem = new THREE.Mesh(new THREE.OctahedronGeometry(rx * 0.13, 0), M.gem);
        gem.position.set(cx, y0 + (y1 - y0) * 0.7, cz + rz * 1.06); g.add(gem);
      }
      out.push({ bone: sp2, mesh: g });
    }
  }
  // Vientre (Spine + Spine1)
  {
    const fb = sp1 || sp;
    const basis = spineFrame(root, fb, sp1 ? 'Spine2' : 'Spine1');
    const box = fitBox(boneVerts(root, [sp, ...(sp1 ? [sp1] : [])], fb), basis);
    if (box) {
      const g = framed(basis);
      const rx = (box.max.x - box.min.x) / 2 * 1.22 * s, rz = (box.max.z - box.min.z) / 2 * 1.26 * s;
      const cx = (box.min.x + box.max.x) / 2, cz = (box.min.z + box.max.z) / 2;
      const m = new THREE.Mesh(new THREE.CylinderGeometry(1, 1.02, 1, 16, 1, true), M.baseDS);
      m.scale.set(rx, box.max.y - box.min.y, rz); m.position.set(cx, (box.min.y + box.max.y) / 2, cz); g.add(m);
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(rx * 0.22, box.max.y - box.min.y, rz * 0.06), M.trim);
      stripe.position.set(cx, (box.min.y + box.max.y) / 2, cz + rz * 1.02); g.add(stripe);
      out.push({ bone: fb, mesh: g });
    }
  }
  // Fajín en la cintura (Hips)
  if (hips) {
    const basis = spineFrame(root, hips, 'Spine');
    const box = fitBox(boneVerts(root, [hips], hips), basis);
    if (box) {
      const g = framed(basis);
      const h = box.max.y - box.min.y;
      const rx = (box.max.x - box.min.x) / 2 * 1.24 * s, rz = (box.max.z - box.min.z) / 2 * 1.3 * s;
      const cx = (box.min.x + box.max.x) / 2, cz = (box.min.z + box.max.z) / 2;
      const sash = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 16, 1, true), M.trim);
      sash.scale.set(rx, h * 0.22, rz); sash.position.set(cx, box.max.y - h * 0.16, cz); g.add(sash);
      const knot = new THREE.Mesh(new THREE.BoxGeometry(rx * 0.22, h * 0.55, rz * 0.08), M.trim);
      knot.position.set(cx + rx * 0.45, box.max.y - h * 0.42, cz + rz * 0.92); knot.rotation.z = 0.12; g.add(knot);
      out.push({ bone: hips, mesh: g });
    }
  }
  // Mangas: tela sobre el brazo y campana en el antebrazo
  for (const side of ['Left', 'Right']) {
    const arm = findBone(root, side + 'Arm');
    const fore = arm ? childNamed(arm, side + 'ForeArm') : null;
    if (!arm || !fore) continue;
    {
      const dir = fore.position.clone().normalize();
      const basis = orient(dir, boneBasis(root, arm).fwd);
      const box = fitBox(boneVerts(root, [arm], arm), basis);
      if (box) {
        const g = framed(basis);
        const h = box.max.y - Math.max(0, box.min.y);
        g.add(tubeFromBox(box, Math.max(0, box.min.y), box.min.y + h * 1.0, M.baseDS, 1.28 * s, 0.95));
        out.push({ bone: arm, mesh: g });
      }
    }
    {
      const hand = childNamed(fore, side + 'Hand');
      const dir = hand ? hand.position.clone().normalize() : new THREE.Vector3(0, 1, 0);
      const basis = orient(dir, boneBasis(root, fore).fwd);
      const box = fitBox(boneVerts(root, [fore], fore), basis);
      if (box) {
        const g = framed(basis);
        const L = hand ? hand.position.length() : (box.max.y - box.min.y);
        const r = Math.max(box.max.x - box.min.x, box.max.z - box.min.z) / 2;
        const cx = (box.min.x + box.max.x) / 2, cz = (box.min.z + box.max.z) / 2;
        const bell = new THREE.Mesh(new THREE.CylinderGeometry(r * 2.1, r * 1.2, L * 0.82, 14, 1, true), M.baseDS);
        bell.position.set(cx, L * 0.45, cz); g.add(bell);
        const cuff = new THREE.Mesh(new THREE.TorusGeometry(r * 2.1, r * 0.16, 5, 16), M.trim);
        cuff.rotation.x = Math.PI / 2; cuff.position.set(cx, L * 0.86, cz); g.add(cuff);
        out.push({ bone: fore, mesh: g });
      }
    }
  }
  return out.length ? out : null;
}

function buildRobeSkirt(root, matId) {
  const M = mats(matId), tn = tune('legs');
  const hips = findBone(root, 'Hips');
  if (!hips) return null;
  const out = [];
  const basis = spineFrame(root, hips, 'Spine');
  const box = fitBox(boneVerts(root, [hips], hips), basis);
  const inv = basis.clone().transpose();
  const knee = restIn(root, hips, 'LeftLeg'), foot = restIn(root, hips, 'LeftFoot');
  if (box && knee && foot) {
    const g = framed(basis);
    const kneeY = knee.clone().applyMatrix4(inv).y, footY = foot.clone().applyMatrix4(inv).y;
    const h = box.max.y - box.min.y;
    const rx = (box.max.x - box.min.x) / 2 * 1.2 * tn.s, rz = (box.max.z - box.min.z) / 2 * 1.26 * tn.s;
    const cx = (box.min.x + box.max.x) / 2, cz = (box.min.z + box.max.z) / 2;
    const yTop = box.max.y - h * 0.1;
    const yBot = kneeY + (footY - kneeY) * 0.62;          // por debajo de la rodilla, sin tapar las botas
    const len = yTop - yBot;
    const skirt = new THREE.Mesh(new THREE.CylinderGeometry(1, 1.7, 1, 18, 1, true), M.baseDS);
    skirt.scale.set(rx, len, rz); skirt.position.set(cx, (yTop + yBot) / 2, cz); g.add(skirt);
    const hem = new THREE.Mesh(new THREE.TorusGeometry(1.7, 0.05, 5, 22), M.trim);
    hem.rotation.x = Math.PI / 2; hem.scale.set(rx, rz, rx); hem.position.set(cx, yBot, cz); g.add(hem);
    // Paño delantero del color del ribete
    const panel = new THREE.Mesh(new THREE.BoxGeometry(rx * 0.5, len * 0.98, rz * 0.05), M.trim);
    panel.position.set(cx, (yTop + yBot) / 2, cz + rz * 1.36); panel.rotation.x = -0.32; g.add(panel);
    out.push({ bone: hips, mesh: g });
  }
  // Pantalón holgado debajo (para que al andar no se vea la pierna desnuda)
  for (const side of ['Left', 'Right']) {
    const up = findBone(root, side + 'UpLeg');
    const leg = findBone(root, side + 'Leg');
    if (!up || !leg) continue;
    const foot2 = childNamed(leg, side + 'Foot') || findBone(root, side + 'Foot');
    const dirS = foot2 ? foot2.position.clone().normalize() : new THREE.Vector3(0, 1, 0);
    const bS = orient(dirS, boneBasis(root, leg).fwd);
    const boxS = fitBox(boneVerts(root, [leg], leg), bS);
    if (boxS) {
      const gS = framed(bS);
      const hS = boxS.max.y - boxS.min.y;
      gS.add(tubeFromBox(boxS, boxS.min.y + hS * 0.05, boxS.max.y - hS * 0.08, M.dark, 1.2 * tn.s, 0.9));
      out.push({ bone: leg, mesh: gS });
    }
    const dirT = leg.position.clone().normalize();
    const bT = orient(dirT, boneBasis(root, up).fwd);
    const boxT = fitBox(boneVerts(root, [up], up), bT);
    if (boxT) {
      const gT = framed(bT);
      const hT = boxT.max.y - boxT.min.y;
      gT.add(tubeFromBox(boxT, boxT.min.y + hT * 0.15, boxT.max.y, M.dark, 1.14 * tn.s, 0.86));
      out.push({ bone: up, mesh: gT });
    }
  }
  return out.length ? out : null;
}

export const DRAGON_HELPERS = { findBone, childNamed, boneBasis, orient, boneVerts, fitBox, framed, tune, spineFrame };

// ---------------- Ropa de arquero (19 oct) ----------------
// Antes el cuero usaba las piezas de la armadura de metal (yelmo, peto con
// hombreras, grebas): parecía un caballero gris. Ahora: capucha con esclavina,
// chaqueta de cuero ceñida con bandolera y faldón, pantalón con rodilleras
// cosidas, brazales de arquero en el antebrazo y botas altas de caña blanda.
// Los tiers cambian color y detalles (pelo en el lobo/yeti, placas en el
// escorpión, escamas en el dragón).
function archerExtras(matId) {
  return { fur: matId === 'lobo' || matId === 'yeti', plates: matId === 'escorpion', scales: matId === 'escama' };
}
function buildHood(root, matId) {
  const head = findBone(root, 'Head');
  if (!head) return null;
  const top = childNamed(head, 'HeadTop_End');
  const { fwd, up } = boneBasis(root, head);
  const basis = orient(top ? top.position.clone().normalize() : up, fwd);
  const M = mats(matId), tn = tune('helm'), X = archerExtras(matId);
  let box = fitBox(boneVerts(root, [head, ...(top ? [top] : [])], head), basis);
  if (!box) {
    const L = top ? top.position.length() : fallbackLen(head, 0.2);
    box = new THREE.Box3(new THREE.Vector3(-0.45 * L, -0.1 * L, -0.5 * L), new THREE.Vector3(0.45 * L, 1.05 * L, 0.55 * L));
  }
  const h = box.max.y - box.min.y;
  const cx = (box.min.x + box.max.x) / 2, cz = (box.min.z + box.max.z) / 2 + h * tn.z;
  const rx = (box.max.x - box.min.x) / 2 * 1.2 * tn.s, rz = (box.max.z - box.min.z) / 2 * 1.2 * tn.s;
  const cy = box.min.y + h * (0.55 + tn.y);
  const g = framed(basis);
  // Cogulla: esfera abierta por delante (la cara se ve)
  const cowl = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 10, Math.PI * 0.72, Math.PI * 1.56, 0, Math.PI * 0.78), M.baseDS);
  // (el hueco de phi 0,28π–0,72π queda mirando a +z = delante)
  cowl.scale.set(rx, (box.max.y - cy) * 1.15, rz * 1.02);
  cowl.position.set(cx, cy, cz - rz * 0.04);
  g.add(cowl);
  // Pico de la capucha hacia atrás
  const tip = new THREE.Mesh(new THREE.ConeGeometry(rx * 0.35, h * 0.55, 6), M.base);
  tip.position.set(cx, cy + (box.max.y - cy) * 0.55, cz - rz * 1.05);
  tip.rotation.x = -2.0;
  g.add(tip);
  // Ribete de la cara
  const rim = new THREE.Mesh(new THREE.TorusGeometry(1, 0.035, 4, 16, Math.PI * 1.2), M.trim);
  rim.rotation.z = -Math.PI * 0.1;
  rim.scale.set(rx * 0.9, h * 0.55, rx * 0.3);
  rim.position.set(cx, cy - h * 0.08, cz + rz * 0.82);
  g.add(rim);
  // Esclavina sobre los hombros
  // Cuello de la capucha (cae sobre la nuca y el cuello)
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(rx * 0.8, rx * 1.15, h * 0.32, 14, 1, true), M.baseDS);
  neck.position.set(cx, box.min.y - h * 0.04, cz - rz * 0.12);
  g.add(neck);
  if (X.fur) {   // pelo en el borde del cuello
    const fur = new THREE.Mesh(new THREE.CylinderGeometry(rx * 1.16, rx * 1.22, h * 0.08, 14, 1, true), M.trim);
    fur.material = M.trim;
    fur.position.set(cx, box.min.y - h * 0.18, cz - rz * 0.12);
    g.add(fur);
  }
  return [{ bone: head, mesh: g }];
}
function buildJerkin(root, matId) {
  const M = mats(matId), tn = tune('body'), X = archerExtras(matId), s = tn.s;
  const hips = findBone(root, 'Hips'), sp = findBone(root, 'Spine'), sp1 = findBone(root, 'Spine1'), sp2 = findBone(root, 'Spine2');
  if (!sp || !sp2) return null;
  const out = [];
  // Pecho (Spine2): chaqueta ceñida + cuello alto + bandolera + cordones
  {
    const basis = spineFrame(root, sp2, 'Neck');
    const box = fitBox(boneVerts(root, [sp2], sp2), basis);
    if (box) {
      const g = framed(basis);
      const h = box.max.y - box.min.y;
      const rx = (box.max.x - box.min.x) / 2 * 1.13 * s, rz = (box.max.z - box.min.z) / 2 * 1.18 * s;
      const cx = (box.min.x + box.max.x) / 2, cz = (box.min.z + box.max.z) / 2;
      const y0 = box.min.y - h * 0.15, y1 = box.max.y - h * 0.04;
      const shell = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 0.94, 1, 14, 1, true), M.baseDS);
      shell.scale.set(rx, y1 - y0, rz); shell.position.set(cx, (y0 + y1) / 2, cz);
      g.add(shell);
      const yoke = new THREE.Mesh(new THREE.RingGeometry(0.5, 1, 14, 1), M.baseDS);
      yoke.rotation.x = -Math.PI / 2; yoke.scale.set(rx, rz, 1); yoke.position.set(cx, y1, cz);
      g.add(yoke);
      const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.55, 1, 12, 1, true), M.baseDS);
      collar.scale.set(rx, h * 0.18, rz); collar.position.set(cx, y1 + h * 0.08, cz);
      g.add(collar);
      // Cordones del pecho
      for (let i = 0; i < 4; i++) {
        const lace = new THREE.Mesh(new THREE.BoxGeometry(rx * 0.32, h * 0.025, rz * 0.04), M.trim);
        lace.position.set(cx, y1 - h * (0.12 + i * 0.13), cz + rz * 0.99);
        lace.rotation.z = (i % 2 ? 0.35 : -0.35);
        g.add(lace);
      }
      // Bandolera del hombro derecho a la cadera izquierda (delante y detrás)
      for (const zs of [1, -1]) {
        const strap = new THREE.Mesh(new THREE.BoxGeometry(rx * 0.22, (y1 - y0) * 1.25, rz * 0.06), M.trim);
        strap.position.set(cx, (y0 + y1) / 2, cz + zs * rz * 1.01);
        strap.rotation.z = zs * 0.62;
        g.add(strap);
      }
      if (X.plates || X.scales) {   // placas de escorpión / escamas en el pecho
        const n = X.scales ? 6 : 3;
        for (let i = 0; i < n; i++) {
          const pl = new THREE.Mesh(X.scales ? new THREE.OctahedronGeometry(1, 0) : new THREE.BoxGeometry(1, 1, 1), M.trim);
          const col = i % 2, row = Math.floor(i / 2);
          pl.scale.set(rx * (X.scales ? 0.16 : 0.5), h * (X.scales ? 0.1 : 0.14), rz * 0.08);
          pl.position.set(X.scales ? cx + (col ? 0.3 : -0.3) * rx : cx - rx * 0.35, y1 - h * (0.25 + row * 0.22), cz + rz * 0.97);
          g.add(pl);
        }
      }
      if (X.fur) {
        const fur = new THREE.Mesh(new THREE.TorusGeometry(1, 0.12, 5, 14), M.trim);
        fur.rotation.x = Math.PI / 2; fur.scale.set(rx * 0.62, rz * 0.62, 1); fur.position.set(cx, y1 + h * 0.16, cz);
        g.add(fur);
      }
      out.push({ bone: sp2, mesh: g });
    }
  }
  // Vientre (Spine/Spine1)
  {
    const fb = sp1 || sp;
    const basis = spineFrame(root, fb, sp1 ? 'Spine2' : 'Spine1');
    const box = fitBox(boneVerts(root, [sp, ...(sp1 ? [sp1] : [])], fb), basis);
    if (box) {
      const g = framed(basis);
      const h = box.max.y - box.min.y;
      const rx = (box.max.x - box.min.x) / 2 * 1.14 * s, rz = (box.max.z - box.min.z) / 2 * 1.18 * s;
      const tube = new THREE.Mesh(new THREE.CylinderGeometry(1, 0.98, 1, 14, 1, true), M.baseDS);
      tube.scale.set(rx, h * 1.05, rz); tube.position.set((box.min.x + box.max.x) / 2, (box.min.y + box.max.y) / 2, (box.min.z + box.max.z) / 2);
      g.add(tube);
      out.push({ bone: fb, mesh: g });
    }
  }
  // Cinturón + faldón partido (Hips)
  if (hips) {
    const basis = spineFrame(root, hips, 'Spine');
    const box = fitBox(boneVerts(root, [hips], hips), basis);
    if (box) {
      const g = framed(basis);
      const h = box.max.y - box.min.y;
      const rx = (box.max.x - box.min.x) / 2 * 1.16 * s, rz = (box.max.z - box.min.z) / 2 * 1.22 * s;
      const cx = (box.min.x + box.max.x) / 2, cz = (box.min.z + box.max.z) / 2;
      const beltY = box.max.y - h * 0.15;
      const belt = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 14, 1, true), M.trim);
      belt.scale.set(rx * 1.02, h * 0.14, rz * 1.02); belt.position.set(cx, beltY, cz);
      g.add(belt);
      const buckle = new THREE.Mesh(new THREE.TorusGeometry(rx * 0.1, rx * 0.025, 4, 8), M.dark);
      buckle.position.set(cx, beltY, cz + rz * 1.03);
      g.add(buckle);
      // Faldón: cuatro paños (delante, detrás y lados), más largos atrás
      for (const [ang, w, len] of [[0, 0.8, 0.75], [Math.PI, 0.9, 0.95], [-1.4, 0.55, 0.7], [1.4, 0.55, 0.7]]) {
        const panel = new THREE.Mesh(new THREE.BoxGeometry(rx * w, h * len, rz * 0.06), M.base);
        panel.position.set(cx + Math.sin(ang) * rx * 1.04, beltY - h * (0.07 + len / 2), cz + Math.cos(ang) * rz * 1.04);
        panel.rotation.y = ang; panel.rotation.x = 0.1;
        g.add(panel);
      }
      out.push({ bone: hips, mesh: g });
    }
  }
  // Mangas al brazo (sin hombreras)
  for (const side of ['Left', 'Right']) {
    const arm = findBone(root, side + 'Arm');
    if (!arm) continue;
    const fore = childNamed(arm, side + 'ForeArm');
    const dir = fore ? fore.position.clone().normalize() : new THREE.Vector3(0, 1, 0);
    const basis = orient(dir, boneBasis(root, arm).fwd);
    const box = fitBox(boneVerts(root, [arm], arm), basis);
    if (!box) continue;
    const g = framed(basis);
    const L = box.max.y - Math.max(0, box.min.y);
    g.add(tubeFromBox(box, Math.max(0, box.min.y), Math.max(0, box.min.y) + L * 0.85, M.base, 1.12 * s, 0.9));
    out.push({ bone: arm, mesh: g });
  }
  return out.length ? out : null;
}
function buildTrousers(root, matId) {
  const M = mats(matId), tn = tune('legs'), X = archerExtras(matId);
  const out = [];
  for (const side of ['Left', 'Right']) {
    const up = findBone(root, side + 'UpLeg'), leg = findBone(root, side + 'Leg');
    if (!up || !leg) continue;
    const foot = childNamed(leg, side + 'Foot') || findBone(root, side + 'Foot');
    const bT = orient((childNamed(up, side + 'Leg') || leg).position.clone().normalize(), boneBasis(root, up).fwd);
    const boxT = fitBox(boneVerts(root, [up], up), bT);
    if (boxT) {
      const gT = framed(bT);
      const h = boxT.max.y - boxT.min.y;
      gT.add(tubeFromBox(boxT, boxT.min.y + h * 0.02, boxT.max.y, M.base, 1.08 * tn.s, 0.9));
      // Correa del muslo
      gT.add(tubeFromBox(boxT, boxT.min.y + h * 0.42, boxT.min.y + h * 0.48, M.trim, 1.12 * tn.s, 1));
      out.push({ bone: up, mesh: gT });
    }
    const bS = orient(foot ? foot.position.clone().normalize() : new THREE.Vector3(0, 1, 0), boneBasis(root, leg).fwd);
    const boxS = fitBox(boneVerts(root, [leg], leg), bS);
    if (boxS) {
      const gS = framed(bS);
      const h = boxS.max.y - boxS.min.y;
      gS.add(tubeFromBox(boxS, boxS.min.y, boxS.max.y - h * 0.3, M.base, 1.08 * tn.s, 0.85));
      // Rodillera cosida (parche, no metal)
      const rz = (boxS.max.z - boxS.min.z) / 2;
      const patch = new THREE.Mesh(new THREE.BoxGeometry(rz * 1.1, h * 0.16, rz * 0.12), X.plates || X.scales ? M.trim : M.dark);
      patch.position.set((boxS.min.x + boxS.max.x) / 2, boxS.min.y + h * 0.08, boxS.max.z * 1.07);
      gS.add(patch);
      out.push({ bone: leg, mesh: gS });
    }
  }
  return out.length ? out : null;
}
function buildBracers(root, matId) {
  const M = mats(matId), tn = tune('gloves'), X = archerExtras(matId);
  const out = [];
  for (const side of ['Left', 'Right']) {
    const fore = findBone(root, side + 'ForeArm'), hand = findBone(root, side + 'Hand');
    if (fore) {
      const hb = childNamed(fore, side + 'Hand') || hand;
      const basis = orient(hb ? hb.position.clone().normalize() : new THREE.Vector3(0, 1, 0), boneBasis(root, fore).fwd);
      const box = fitBox(boneVerts(root, [fore], fore), basis);
      if (box) {
        const g = framed(basis);
        const h = box.max.y - Math.max(0, box.min.y), y0 = Math.max(0, box.min.y);
        g.add(tubeFromBox(box, y0 + h * 0.35, y0 + h * 0.98, M.base, 1.22 * tn.s, 0.86));
        // Correas del brazal
        for (const f of [0.5, 0.7, 0.88]) g.add(tubeFromBox(box, y0 + h * f, y0 + h * (f + 0.04), M.trim, 1.27 * tn.s, 1));
        if (X.plates || X.scales || X.fur) {
          const ridge = new THREE.Mesh(new THREE.BoxGeometry((box.max.x - box.min.x) * 0.25, h * 0.5, (box.max.z - box.min.z) * 0.2), M.trim);
          ridge.position.set((box.min.x + box.max.x) / 2, y0 + h * 0.68, box.max.z * 1.1);
          g.add(ridge);
        }
        out.push({ bone: fore, mesh: g });
      }
    }
    if (hand) {   // guante sin dedos
      const mid = childNamed(hand, side + 'HandMiddle1');
      const basis = orient(mid ? mid.position.clone().normalize() : new THREE.Vector3(0, 1, 0), boneBasis(root, hand).fwd);
      const box = fitBox(boneVerts(root, [hand], hand), basis);
      if (box) {
        const g = framed(basis);
        const L = box.max.y - Math.max(box.min.y, 0);
        const w = (box.max.x - box.min.x) * 1.08 * tn.s, d = (box.max.z - box.min.z) * 1.12 * tn.s;
        const glove = new THREE.Mesh(new THREE.BoxGeometry(w, L * 0.6, d), M.dark);
        glove.position.set((box.min.x + box.max.x) / 2, L * 0.3, (box.min.z + box.max.z) / 2);
        g.add(glove);
        out.push({ bone: hand, mesh: g });
      }
    }
  }
  return out.length ? out : null;
}
function buildSoftBoots(root, matId) {
  const M = mats(matId), tn = tune('boots'), X = archerExtras(matId);
  const out = [];
  for (const side of ['Left', 'Right']) {
    const foot = findBone(root, side + 'Foot');
    if (!foot) continue;
    const toe = childNamed(foot, side + 'ToeBase');
    const toeEnd = toe ? childNamed(toe, side + 'Toe_End') : null;
    const dir = toe ? toe.position.clone().normalize() : new THREE.Vector3(0, 0, 1);
    const { up } = boneBasis(root, foot);
    const z = dir.clone().sub(up.clone().multiplyScalar(dir.dot(up))).normalize();
    const y = up.clone().normalize();
    const basis = new THREE.Matrix4().makeBasis(new THREE.Vector3().crossVectors(y, z).normalize(), y, z);
    const box = fitBox(boneVerts(root, [foot, ...(toe ? [toe] : []), ...(toeEnd ? [toeEnd] : [])], foot), basis);
    if (!box) continue;
    const g = framed(basis);
    const w = (box.max.x - box.min.x) * 1.1 * tn.s, len = (box.max.z - box.min.z) * 1.06, hgt = box.max.y - box.min.y;
    const cx = (box.min.x + box.max.x) / 2;
    // Pie redondeado
    const shoe = new THREE.Mesh(new THREE.CapsuleGeometry(0.5, 1, 3, 8), M.base);
    shoe.rotation.x = Math.PI / 2;
    shoe.scale.set(w, len * 0.5, hgt * 1.05);
    shoe.position.set(cx, box.min.y + hgt * 0.5, (box.min.z + box.max.z) / 2);
    g.add(shoe);
    // Caña alta hasta media espinilla, con vuelta
    const shaftH = hgt * 3.0;
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(w * 0.6, w * 0.55, shaftH, 10, 1, true), M.baseDS);
    shaft.position.set(cx, box.min.y + hgt * 0.6 + shaftH / 2, box.min.z + len * 0.25);
    g.add(shaft);
    const fold = new THREE.Mesh(new THREE.CylinderGeometry(w * 0.7, w * 0.62, hgt * 0.6, 10, 1, true), X.fur ? M.trim : M.dark);
    fold.material = fold.material.side === THREE.DoubleSide ? fold.material : fold.material;
    fold.position.set(cx, box.min.y + hgt * 0.6 + shaftH - hgt * 0.25, box.min.z + len * 0.25);
    g.add(fold);
    out.push({ bone: foot, mesh: g });
  }
  return out.length ? out : null;
}

// ---------------- Carcaj (19 oct) ----------------
// Antes era un GLB pegado a la espalda: con capa quedaba DENTRO de la tela (la
// capa cuelga por fuera de la armadura y se mueve) y parecía que solo se podía
// llevar una de las dos cosas; además los demás jugadores no lo veían (solo se
// copian las piezas procedurales). Ahora va colgado de la CADERA derecha, un
// poco hacia atrás, inclinado como en los arqueros clásicos: se ve con
// cualquier capa y también en los demás jugadores.
const QUIVER_LOOK = {
  quiver_bronze: { leather: 0x6b3f1f, trim: 0x2e1a0c, fletch: [0xf2f2f2, 0xc8302a] },
};
const _qMats = new Map();
function quiverMats(itemId) {
  const L = QUIVER_LOOK[itemId] || QUIVER_LOOK.quiver_bronze;
  const key = itemId in QUIVER_LOOK ? itemId : 'quiver_bronze';
  if (_qMats.has(key)) return _qMats.get(key);
  const m = {
    leather: new THREE.MeshStandardMaterial({ color: L.leather, roughness: 0.9, metalness: 0, flatShading: true }),
    trim: new THREE.MeshStandardMaterial({ color: L.trim, roughness: 0.85, metalness: 0.05, flatShading: true }),
    wood: new THREE.MeshStandardMaterial({ color: 0xc8a06a, roughness: 0.8, flatShading: true }),
    fletch: L.fletch.map(c => new THREE.MeshStandardMaterial({ color: c, roughness: 0.9, side: THREE.DoubleSide, flatShading: true })),
  };
  _qMats.set(key, m);
  return m;
}
function buildQuiver(root, itemId) {
  const hips = findBone(root, 'Hips');
  if (!hips) return null;
  const basis = spineFrame(root, hips, 'Spine');   // y = arriba, z = delante, +x = izquierda
  const upLegs = ['LeftUpLeg', 'RightUpLeg'].map(n => findBone(root, n)).filter(Boolean);
  const box = fitBox(boneVerts(root, [hips, ...upLegs], hips), basis) || fitBox(boneVerts(root, [hips], hips), basis);
  const tn = tune('quiver');
  let k, cx, cz, rx, rz, yTop;
  if (box) {
    rx = (box.max.x - box.min.x) / 2; rz = (box.max.z - box.min.z) / 2;
    cx = (box.min.x + box.max.x) / 2; cz = (box.min.z + box.max.z) / 2;
    k = (rx * 2) / 0.36;   // unidades del hueso por metro (cadera ≈ 36 cm de ancho)
    yTop = box.max.y;
  } else {
    k = fallbackLen(hips, 1); rx = 0.18 * k; rz = 0.12 * k; cx = 0; cz = 0; yTop = 0.1 * k;
  }
  k *= tn.s;
  const M = quiverMats(itemId);
  const g = framed(basis);
  const q = new THREE.Group();
  // Cuerpo de cuero (más ancho arriba), fondo y dos ribetes
  const len = 0.52 * k, rTop = 0.062 * k, rBot = 0.05 * k;
  const body = new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBot, len, 10, 1, true), M.leather);
  q.add(body);
  const bottom = new THREE.Mesh(new THREE.CircleGeometry(rBot, 10), M.trim);
  bottom.rotation.x = Math.PI / 2; bottom.position.y = -len / 2;
  q.add(bottom);
  for (const [y, r] of [[len / 2 - 0.012 * k, rTop], [-len / 2 + 0.03 * k, rBot]]) {
    const band = new THREE.Mesh(new THREE.TorusGeometry(r * 1.02, 0.008 * k, 4, 12), M.trim);
    band.rotation.x = Math.PI / 2; band.position.y = y;
    q.add(band);
  }
  // Flechas asomando (astil + plumas cruzadas)
  const shaftGeo = new THREE.CylinderGeometry(0.004 * k, 0.004 * k, 0.2 * k, 4);
  const fGeo = new THREE.PlaneGeometry(0.022 * k, 0.07 * k);
  const spots = [[0, 0], [0.55, 0.2], [-0.5, 0.25], [0.2, -0.55], [-0.3, -0.45]];
  spots.forEach(([ax, az], i) => {
    const a = new THREE.Group();
    const shaft = new THREE.Mesh(shaftGeo, M.wood);
    a.add(shaft);
    for (let j = 0; j < 2; j++) {
      const f = new THREE.Mesh(fGeo, M.fletch[(i + j) % M.fletch.length]);
      f.position.y = 0.06 * k; f.rotation.y = j * Math.PI / 2;
      a.add(f);
    }
    a.position.set(ax * rTop * 0.75, len / 2 + 0.07 * k + (i % 2) * 0.015 * k, az * rTop * 0.75);
    a.rotation.set(az * 0.12, 0, -ax * 0.12);
    q.add(a);
  });
  // Correa al cinturón
  const strap = new THREE.Mesh(new THREE.BoxGeometry(0.02 * k, 0.12 * k, 0.012 * k), M.trim);
  strap.position.set(-rTop * 0.2, len * 0.28, rTop * 0.95);
  q.add(strap);
  // Colocación: cadera DERECHA (−x), algo por detrás; boca arriba-atrás-fuera
  q.rotation.set(-0.42, 0, 0.26);
  q.position.set(cx - rx * 1.08 + tn.x * k, yTop - len * 0.28 + tn.y * k, cz - rz * 0.6 + tn.z * k);
  g.add(q);
  return [{ bone: hips, mesh: g }];
}

// ---------------- Capa de fuego (Sesión 50) ----------------
let _fireTex = null;
function fireCapeTexture() {
  if (_fireTex) return _fireTex;
  const c = document.createElement('canvas');
  c.width = 64; c.height = 256;
  const g = c.getContext('2d');
  const grd = g.createLinearGradient(0, 0, 0, 256);
  grd.addColorStop(0, '#3a0804'); grd.addColorStop(0.45, '#a0180a'); grd.addColorStop(0.75, '#ff5a10'); grd.addColorStop(1, '#ffd040');
  g.fillStyle = grd; g.fillRect(0, 0, 64, 256);
  // Lenguas de fuego
  for (let i = 0; i < 18; i++) {
    const x = Math.random() * 64, y = 120 + Math.random() * 136, h = 40 + Math.random() * 70;
    g.fillStyle = `rgba(255,${120 + Math.random() * 120 | 0},20,0.55)`;
    g.beginPath(); g.moveTo(x - 6, y); g.quadraticCurveTo(x + 4, y - h * 0.6, x, y - h); g.quadraticCurveTo(x + 2, y - h * 0.4, x + 6, y); g.fill();
  }
  _fireTex = new THREE.CanvasTexture(c);
  return _fireTex;
}
function buildFireCape(root) {
  const sp2 = findBone(root, 'Spine2');
  if (!sp2) return null;
  const basis = spineFrame(root, sp2, 'Neck');
  const box = fitBox(boneVerts(root, [sp2], sp2), basis);
  if (!box) return null;
  const tn = tune('cape');
  const h = box.max.y - box.min.y;
  const rx = (box.max.x - box.min.x) / 2 * 1.2 * tn.s, rz = (box.max.z - box.min.z) / 2;
  const cx = (box.min.x + box.max.x) / 2, cz = (box.min.z + box.max.z) / 2;
  const top = box.max.y + h * 0.05, len = h * 5.4 * tn.s;
  const tex = fireCapeTexture();
  const mat = new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: 0.55, side: THREE.DoubleSide, roughness: 0.8 });
  // Tela ligeramente curvada (trozo de cilindro abierto), por detrás del torso
  const geo = new THREE.CylinderGeometry(rx * 1.1, rx * 1.45, len, 12, 6, true, Math.PI * 0.62, Math.PI * 0.76);
  const cape = new THREE.Mesh(geo, mat);
  const g = framed(basis);
  cape.position.set(cx, top - len / 2, cz + rz * 0.15 + (tn.z || 0) * h);
  g.add(cape);
  // Broche de fuego en los hombros
  for (const sx of [-1, 1]) {
    const gem = new THREE.Mesh(new THREE.OctahedronGeometry(rx * 0.14, 0),
      new THREE.MeshStandardMaterial({ color: 0xffa030, emissive: 0xff5a10, emissiveIntensity: 1.6 }));
    gem.position.set(cx + sx * rx * 0.7, top, cz + rz * 0.6);
    g.add(gem);
  }
  return [{ bone: sp2, mesh: g }];
}
