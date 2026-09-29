/**
 * SebasPresent — Armaduras procedurales (Sesión 50)
 *
 * Las piezas forjadas (yelmo, grebas, botas, guanteletes) de los 7 materiales
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

export const ARMOR_COLORS = {
  bronze:    { base: 0xb87333, trim: 0xe6a064, gem: null,     metal: 0.75, rough: 0.38 },
  hierro:    { base: 0x7c7f84, trim: 0xb9bdc3, gem: null,     metal: 0.8,  rough: 0.42 },
  acero:     { base: 0xaab4bd, trim: 0xe8f0f6, gem: null,     metal: 0.85, rough: 0.28 },
  oro:       { base: 0xd4af37, trim: 0xfff0a0, gem: null,     metal: 0.9,  rough: 0.25 },
  obsidiana: { base: 0x2a2433, trim: 0x6c5a8a, gem: 0xa36bff, metal: 0.5,  rough: 0.2 },
  basaltita: { base: 0x3a3f45, trim: 0x6c737b, gem: 0xff6a2a, metal: 0.55, rough: 0.5 },
  teiderio:  { base: 0x2f9e8f, trim: 0x7fe8d8, gem: 0x5fffe0, metal: 0.7,  rough: 0.25 },
};
const TIER = { bronze: 0, hierro: 1, acero: 2, oro: 3, obsidiana: 4, basaltita: 5, teiderio: 6 };
const PROC_SLOTS = new Set(['helm', 'legs', 'boots', 'gloves']);

export function materialOf(itemId) {
  const m = String(itemId || '').split('_').pop();
  return ARMOR_COLORS[m] ? m : null;
}

export function isProceduralArmor(itemId, slot) {
  return PROC_SLOTS.has(slot) && !!materialOf(itemId);
}

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

/**
 * Construye la pieza y devuelve [{ bone, mesh }] (sin añadir aún a los huesos).
 * `root` = el FBX del personaje (character.mesh).
 */
export function buildProceduralArmor(itemId, slot, root) {
  const matId = materialOf(itemId);
  if (!matId || !root) return null;
  let parts = null;
  if (slot === 'helm') parts = buildHelm(root, matId);
  else if (slot === 'legs') parts = buildLegs(root, matId);
  else if (slot === 'boots') parts = buildBoots(root, matId);
  else if (slot === 'gloves') parts = buildGloves(root, matId);
  if (!parts) return null;
  for (const p of parts) p.mesh.traverse(o => { if (o.isMesh) { o.frustumCulled = false; o.castShadow = true; } });
  return parts;
}

/** Pinta una copia del GLB de la pechera de bronce con el color de otro material. */
export function tintArmorMesh(mesh, matId) {
  const C = ARMOR_COLORS[matId];
  if (!C) return mesh;
  mesh.traverse(o => {
    if (!o.isMesh || !o.material) return;
    const list = Array.isArray(o.material) ? o.material : [o.material];
    const tinted = list.map(m => {
      const c = m.clone();
      if (c.color) c.color.setHex(C.base);
      if ('metalness' in c) { c.metalness = C.metal; c.roughness = C.rough; }
      if (C.gem && c.emissive) { c.emissive.setHex(C.gem); c.emissiveIntensity = 0.12; }
      return c;
    });
    o.material = Array.isArray(o.material) ? tinted : tinted[0];
  });
  return mesh;
}
