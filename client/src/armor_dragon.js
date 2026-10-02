/**
 * SebasPresent — Armadura de dragón (Sesión 51)
 *
 * Set propio (no reutiliza las piezas genéricas de armor_procedural): miles de
 * polígonos pequeños para que de cerca tenga forma. Inspirado en el set de
 * dragón de OSRS: rojo lacado, filos de oro viejo, escamas solapadas, aletas
 * de dragón en el yelmo y en las hombreras, garras negras en los guanteletes
 * y escudo cometa con emblema de dragón.
 *
 * Rendimiento: las escamas van en InstancedMesh (1 draw call por zona) y el
 * resto de piezas de cada hueso se FUSIONAN por material (mergeGeometries),
 * así una pieza cuesta ~3-5 draw calls aunque tenga miles de triángulos.
 *
 * API: buildDragonArmor(slot, root, H) → [{ bone, mesh }] | null
 *   H = helpers de armor_procedural (findBone, childNamed, boneBasis, orient,
 *       boneVerts, fitBox, framed, tune, spineFrame).
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// ------------------------------------------------------------
// Materiales
// ------------------------------------------------------------
let _M = null;
function M() {
  if (_M) return _M;
  const S = (o) => new THREE.MeshStandardMaterial(o);
  _M = {
    red:   S({ color: 0x9e1212, metalness: 0.6, roughness: 0.3 }),
    deep:  S({ color: 0x4c0808, metalness: 0.55, roughness: 0.42, side: THREE.DoubleSide }),
    scale: S({ color: 0xffffff, metalness: 0.62, roughness: 0.27 }),         // color por instancia
    gold:  S({ color: 0xd2a03c, metalness: 1.0, roughness: 0.24 }),
    dark:  S({ color: 0x1c0d0b, metalness: 0.65, roughness: 0.38 }),
    void:  new THREE.MeshBasicMaterial({ color: 0x060203, side: THREE.DoubleSide }),
    claw:  S({ color: 0x15100f, metalness: 0.45, roughness: 0.22 }),
    gem:   S({ color: 0xffa030, emissive: 0xff5a10, emissiveIntensity: 1.6, roughness: 0.12 }),
  };
  _M.red.side = THREE.DoubleSide;
  return _M;
}

// ------------------------------------------------------------
// Acumulador: geometrías por material → se fusionan al final
// ------------------------------------------------------------
class Kit {
  constructor() { this.byMat = new Map(); this.inst = []; }
  add(geo, matKey, matrix) {
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    if (matrix) g.applyMatrix4(matrix);
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal'].includes(k)) g.deleteAttribute(k);
    if (!g.attributes.normal) g.computeVertexNormals();
    if (!this.byMat.has(matKey)) this.byMat.set(matKey, []);
    this.byMat.get(matKey).push(g);
    return this;
  }
  /** Añade una malla ya posicionada (usa su matrix local). */
  mesh(geo, matKey, pos, rot, scl) {
    const o = new THREE.Object3D();
    if (pos) o.position.copy(pos);
    if (rot) o.rotation.copy(rot);
    if (scl) o.scale.copy(scl);
    o.updateMatrix();
    return this.add(geo, matKey, o.matrix);
  }
  scales(list) { if (list.length) this.inst.push(list); return this; }
  build() {
    const g = new THREE.Group();
    const mats = M();
    for (const [k, arr] of this.byMat) {
      const merged = mergeGeometries(arr, false);
      if (!merged) continue;
      const m = new THREE.Mesh(merged, mats[k]);
      m.frustumCulled = false; m.castShadow = true;
      g.add(m);
    }
    for (const list of this.inst) g.add(instScales(list));
    return g;
  }
}

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const E = (x = 0, y = 0, z = 0) => new THREE.Euler(x, y, z);

// ------------------------------------------------------------
// Escama: lágrima abombada (redonda arriba, en punta abajo), cara a +Z
// ------------------------------------------------------------
let _scaleGeo = null;
function scaleGeo() {
  if (_scaleGeo) return _scaleGeo;
  const g = new THREE.CircleGeometry(1, 18, Math.PI / 2);   // vértice 1 arriba
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i), y = p.getY(i);
    const r = Math.min(1, Math.hypot(x, y));
    if (y < 0) { const t = -y; y = -t * 1.6; x *= 1 - t * 0.62; }
    p.setXYZ(i, x, y + 0.3, 0.36 * (1 - r * r));
  }
  g.computeVertexNormals();
  _scaleGeo = g;
  return g;
}

function hash(i) { const s = Math.sin(i * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); }
const _cA = new THREE.Color(0x5e0909), _cB = new THREE.Color(0xc21d17), _cG = new THREE.Color(0xc8902c);

/** list: [{ p, n (fuera), up, w, h, tilt, gold? }] */
function instScales(list) {
  const im = new THREE.InstancedMesh(scaleGeo(), M().scale, list.length);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), tq = new THREE.Quaternion(), s = new THREE.Vector3(), c = new THREE.Color();
  const X = V(1, 0, 0);
  list.forEach((e, i) => {
    const z = e.n.clone().normalize();
    const x = new THREE.Vector3().crossVectors(e.up, z);
    if (x.lengthSq() < 1e-8) x.set(1, 0, 0);
    x.normalize();
    const y = new THREE.Vector3().crossVectors(z, x).normalize();
    q.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
    q.multiply(tq.setFromAxisAngle(X, -(e.tilt ?? 0.28)));
    m.compose(e.p, q, s.set(e.w, e.h, Math.min(e.w, e.h) * 0.9));
    im.setMatrixAt(i, m);
    if (e.gold) c.copy(_cG).multiplyScalar(0.85 + hash(i) * 0.3);
    else c.copy(_cA).lerp(_cB, 0.25 + hash(i) * 0.75);
    im.setColorAt(i, c);
  });
  im.frustumCulled = false; im.castShadow = true;
  return im;
}

/**
 * Escamas en una banda de cilindro elíptico (eje Y), filas desde arriba.
 * a0..a1 en radianes (0 = delante +Z, crece hacia +X). taperTop = radio arriba / radio abajo.
 */
function bandScales({ cx = 0, cz = 0, rx, rz, y0, y1, rows, cols, a0 = -Math.PI, a1 = Math.PI, taperTop = 1, lift = 1.03, tilt = 0.28, size = 1, goldRow = -1 }) {
  const out = [];
  const full = Math.abs(a1 - a0 - Math.PI * 2) < 1e-3;
  const step = (a1 - a0) / cols;
  const dy = (y1 - y0) / rows;
  for (let r = 0; r < rows; r++) {
    const y = y1 - (r + 0.5) * dy;
    const t = (y - y0) / (y1 - y0);
    const k = (1 + (taperTop - 1) * t) * lift * (1 + (rows - r) * 0.006);
    const off = (r % 2) * 0.5;
    for (let c = 0; c <= cols; c++) {
      if (full && c === cols) continue;
      const a = a0 + (c + off) * step;
      if (!full && a > a1 + 1e-6) continue;
      const sx = Math.sin(a), cs = Math.cos(a);
      const ex = rx * k, ez = rz * k;
      const p = V(cx + ex * sx, y, cz + ez * cs);
      const n = V(sx / ex, 0, cs / ez).normalize();
      const arc = Math.abs(step) * Math.hypot(ex * cs, ez * sx);
      out.push({ p, n, up: V(0, 1, 0), w: arc * 0.62 * size, h: dy * 0.62 * size, tilt, gold: r === goldRow });
    }
  }
  return out;
}

/** Escamas sobre un elipsoide (radios rx, ry, rz) entre latitudes lat0..lat1 (0 = ecuador). */
function domeScales({ rx, ry, rz, lat0, lat1, rows, a0 = -Math.PI, a1 = Math.PI, skipFront = 0, lift = 1.02, size = 1 }) {
  const out = [];
  const dl = (lat1 - lat0) / rows;
  for (let r = 0; r < rows; r++) {
    const lat = lat1 - (r + 0.5) * dl;
    const ring = Math.cos(lat);
    const cols = Math.max(5, Math.round(26 * ring));
    const step = (a1 - a0) / cols;
    const off = (r % 2) * 0.5;
    for (let c = 0; c < cols; c++) {
      const a = a0 + (c + off) * step;
      let aa = ((a + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
      if (Math.abs(aa) < skipFront) continue;
      const k = lift * (1 + (rows - r) * 0.005);
      const p = V(rx * k * ring * Math.sin(a), ry * k * Math.sin(lat), rz * k * ring * Math.cos(a));
      const n = V(p.x / (rx * rx), p.y / (ry * ry), p.z / (rz * rz)).normalize();
      const up = V(0, 1, 0).sub(n.clone().multiplyScalar(n.y)).normalize();
      const arc = step * Math.hypot(rx * ring, rz * ring) / Math.SQRT2;
      out.push({ p, n, up, w: arc * 0.62 * size, h: dl * Math.hypot(rx, ry) / Math.SQRT2 * 0.66 * size, tilt: 0.3 });
    }
  }
  return out;
}

// ------------------------------------------------------------
// Geometrías auxiliares
// ------------------------------------------------------------
/** Tubo que adelgaza (cuernos, púas, garras, nervios). */
function taper(curve, r0, r1 = 0, segs = 12, radial = 8) {
  const geo = new THREE.TubeGeometry(curve, segs, 1, radial, false);
  const p = geo.attributes.position;
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const r = r0 + (r1 - r0) * Math.pow(t, 0.9);
    const c = curve.getPointAt(t);
    for (let j = 0; j <= radial; j++) {
      const idx = i * (radial + 1) + j;
      const v = V().fromBufferAttribute(p, idx).sub(c).multiplyScalar(r).add(c);
      p.setXYZ(idx, v.x, v.y, v.z);
    }
  }
  geo.computeVertexNormals();
  return geo;
}
const Q = (a, b, c) => new THREE.QuadraticBezierCurve3(a, b, c);
const CR = (pts) => new THREE.CatmullRomCurve3(pts);

/** Filete de oro siguiendo un arco del cilindro elíptico a altura y. */
function arcTube(rx, rz, y, a0, a1, thick, cx = 0, cz = 0, segs = 48) {
  const pts = [];
  for (let i = 0; i <= segs; i++) {
    const a = a0 + (a1 - a0) * i / segs;
    pts.push(V(cx + rx * Math.sin(a), y, cz + rz * Math.cos(a)));
  }
  const closed = Math.abs(a1 - a0 - Math.PI * 2) < 1e-3;
  if (closed) pts.pop();
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, closed), segs, thick, 6, closed);
}

/** Lámina de cilindro abierta (theta 0 = +Z). */
function shell(rTop, rBot, h, a0 = 0, len = Math.PI * 2, rad = 48, hs = 2) {
  return new THREE.CylinderGeometry(rTop, rBot, h, rad, hs, true, a0, len);
}

/** Polígono 2D (u,v) → aleta extruida en el plano ZY (u → +Z). */
function finGeo(shapeFn, depth, bevel = 0.025) {
  const s = new THREE.Shape();
  shapeFn(s);
  const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 10 });
  g.translate(0, 0, -depth / 2);
  g.rotateY(-Math.PI / 2);            // x(shape) → +Z
  return g;
}
const polar = (r, aDeg) => [r * Math.cos(aDeg * Math.PI / 180), r * Math.sin(aDeg * Math.PI / 180)];

// ------------------------------------------------------------
// Ajuste del torso: el ancho sale de TODO el torso (incl. clavículas), no
// solo de los vértices de cada hueso (que en el pecho dan una caja estrecha).
// ------------------------------------------------------------
function pctBox(pts, lo = 0.03, hi = 0.97) {
  if (!pts.length) return null;
  const q = (arr, t) => { const a = arr.slice().sort((x, y) => x - y); return a[Math.min(a.length - 1, Math.max(0, Math.floor(t * (a.length - 1))))]; };
  const xs = pts.map(p => p.x), ys = pts.map(p => p.y), zs = pts.map(p => p.z);
  return new THREE.Box3(V(q(xs, lo), q(ys, 0), q(zs, lo)), V(q(xs, hi), q(ys, 1), q(zs, hi)));
}
function torsoFit(root, H, bone, basis, pad0 = 0, pad1 = 0, ownBones = null) {
  const inv = basis.clone().transpose();
  const own = H.boneVerts(root, ownBones || [bone], bone).map(p => p.clone().applyMatrix4(inv));
  const ob = pctBox(own, 0, 1);
  if (!ob) return null;
  const set = ['Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'LeftShoulder', 'RightShoulder'].map(n => H.findBone(root, n)).filter(Boolean);
  const all = H.boneVerts(root, set, bone).map(p => p.clone().applyMatrix4(inv));
  const h = ob.max.y - ob.min.y;
  const y0 = ob.min.y - h * pad0, y1 = ob.max.y + h * pad1;
  const sel = all.filter(p => p.y >= y0 && p.y <= y1);
  const wb = sel.length > 12 ? pctBox(sel) : ob;
  return new THREE.Box3(V(wb.min.x, y0, wb.min.z), V(wb.max.x, y1, wb.max.z));
}

/** Empuja hacia fuera la parte delantera (proa / hocico) de una geometría cilíndrica. */
function prow(geo, amount, width = 0.6, yFn = () => 1) {
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const a = Math.atan2(x, z);
    if (Math.abs(a) >= width) continue;
    const k = Math.pow(1 - Math.abs(a) / width, 2) * amount * yFn(y);
    const r = Math.hypot(x, z) || 1;
    p.setXYZ(i, x + x / r * k, y, z + z / r * k);
  }
  geo.computeVertexNormals();
  return geo;
}
/** Baja el borde (y < yCut) en el centro delantero → forma de V. */
function vDip(geo, dip, width, yCut, below = true) {
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    if (below ? y > yCut : y < yCut) continue;
    const a = Math.abs(Math.atan2(x, z));
    if (a >= width) continue;
    p.setY(i, y - dip * (1 - a / width));
  }
  geo.computeVertexNormals();
  return geo;
}

// ------------------------------------------------------------
// YELMO — cúpula lacada, visera en hocico con ojos en V, cresta y alas
// ------------------------------------------------------------
function buildHelm(root, H) {
  const head = H.findBone(root, 'Head');
  if (!head) return null;
  const top = H.childNamed(head, 'HeadTop_End');
  const { fwd, up } = H.boneBasis(root, head);
  const basis = H.orient(top ? top.position.clone().normalize() : up, fwd);
  let box = H.fitBox(H.boneVerts(root, [head, ...(top ? [top] : [])], head), basis);
  if (!box) {
    const L = top ? top.position.length() : 10;
    box = new THREE.Box3(V(-0.45 * L, -0.1 * L, -0.5 * L), V(0.45 * L, 1.05 * L, 0.55 * L));
  }
  const tn = H.tune('helm');
  const h = box.max.y - box.min.y;
  const brimY = box.min.y + h * (0.55 + tn.y);
  const cx = (box.min.x + box.max.x) / 2, cz = (box.min.z + box.max.z) / 2 + h * tn.z;
  const rx = (box.max.x - box.min.x) / 2 * 1.15 * tn.s;
  const rz = (box.max.z - box.min.z) / 2 * 1.15 * tn.s;
  const ry = (box.max.y - brimY) * 1.13 * tn.s;

  const K = new Kit();
  const PI = Math.PI;
  const FW = PI * 0.4;                         // ancho de la visera
  // Cúpula con ligera proa delante (frente de dragón)
  K.add(prow(new THREE.SphereGeometry(1, 56, 28, 0, PI * 2, 0, PI / 2), 0.08, 0.7, (y) => 1 - y), 'red');
  // Nuca y laterales, acampanado, con el borde de abajo en picos
  {
    const g = shell(1.0, 1.12, 1.12, PI * 0.33, PI * 1.34, 64, 4);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      if (p.getY(i) > -0.5) continue;
      const a = Math.atan2(p.getX(i), p.getZ(i));
      p.setY(i, p.getY(i) - 0.12 * Math.abs(Math.sin(a * 5)));   // festón
    }
    g.computeVertexNormals();
    K.mesh(g, 'red', V(0, -0.56, 0));
  }
  // Ceja: banda con V hacia abajo (mirada "enfadada")
  {
    const g = vDip(shell(1.03, 1.04, 0.16, -FW, FW * 2, 40, 2), 0.13, FW, -0.07);
    K.mesh(g, 'red', V(0, -0.06, 0));
    const pts = [];
    for (let i = 0; i <= 30; i++) { const a = -FW + (2 * FW) * i / 30; const y = -0.14 - 0.13 * (1 - Math.abs(a) / FW); pts.push(V(Math.sin(a) * 1.05, y, Math.cos(a) * 1.05)); }
    K.add(new THREE.TubeGeometry(CR(pts), 48, 0.035, 6, false), 'gold');
  }
  // Visera / mandíbula: proa marcada, borde superior en V (rendija de ojos), mentón en punta
  {
    const g = shell(1.04, 1.02, 0.95, -FW, FW * 2, 48, 6);
    vDip(g, 0.13, FW, 0.4, false);                       // borde de arriba en V (sigue a la ceja)
    vDip(g, 0.22, FW, -0.4, true);                       // mentón en punta
    prow(g, 0.34, 0.85, (y) => 0.55 + (0.475 - y) * 0.5);
    K.mesh(g, 'red', V(0, -0.72, 0));
    // filete del borde de la visera
    const pts = [];
    for (let i = 0; i <= 30; i++) { const a = -FW + (2 * FW) * i / 30; const t = 1 - Math.abs(a) / FW; const y = -0.27 - 0.13 * t; const k = 1.04 + 0.34 * Math.pow(Math.max(0, 1 - Math.abs(a) / (0.85)), 2) * (0.55 + 0.47 * 0.5); pts.push(V(Math.sin(a) * k, y, Math.cos(a) * k)); }
    K.add(new THREE.TubeGeometry(CR(pts), 48, 0.03, 6, false), 'gold');
  }
  // Interior negro (ojos): sigue la proa de la visera para tapar la cara
  K.mesh(prow(shell(0.97, 0.97, 0.62, -PI * 0.45, PI * 0.9, 32, 6), 0.3, 0.85, (y) => Math.min(1, Math.max(0, (0.12 - y) / 0.35))), 'void', V(0, -0.3, 0));
  // Colmillos dorados bajando de la ceja a los lados de la visera
  for (const sx of [-1, 1]) {
    const a = sx * FW * 0.95;
    const b = V(Math.sin(a) * 1.08, -0.2, Math.cos(a) * 1.08);
    K.add(taper(Q(b, b.clone().add(V(sx * 0.06, -0.25, 0.04)), b.clone().add(V(sx * 0.02, -0.55, 0.1))), 0.05, 0.006, 10, 6), 'gold');
  }
  // Respiraderos en el hocico (3 por lado)
  for (const sx of [-1, 1]) for (let i = 0; i < 3; i++) {
    const a = sx * (0.1 + i * 0.065) * PI;
    const y = -0.72 - i * 0.07;
    const k = 1.06 + 0.3 * Math.pow(Math.max(0, 1 - Math.abs(a) / 0.85), 2) * 0.8;
    K.add(new THREE.BoxGeometry(0.03, 0.17, 0.08), 'void',
      new THREE.Matrix4().compose(V(Math.sin(a) * k, y, Math.cos(a) * k), new THREE.Quaternion().setFromEuler(E(0, a, sx * 0.35)), V(1, 1, 1)));
  }
  // Filetes: borde inferior de la nuca y nervio central dorado
  K.add(arcTube(1.12, 1.12, -1.12, PI * 0.33, PI * 1.67, 0.035), 'gold');
  {
    const pts = [];
    for (let i = 0; i <= 18; i++) { const a = (i / 18) * PI * 0.94; pts.push(V(0, Math.sin(a) * 1.035 + 0.02, Math.cos(a) * 1.035 + (i < 4 ? 0.08 * (1 - i / 4) : 0))); }
    K.add(new THREE.TubeGeometry(CR(pts), 48, 0.04, 6, false), 'gold');
  }
  // Cejas doradas que barren hacia las alas
  for (const sx of [-1, 1]) {
    const pts = [];
    for (let i = 0; i <= 12; i++) { const t = i / 12; const a = sx * (0.12 + 0.5 * t) * PI; const y = 0.12 + 0.18 * t; const r = Math.sqrt(Math.max(0, 1 - y * y)) * 1.02; pts.push(V(Math.sin(a) * r, y, Math.cos(a) * r)); }
    K.add(taper(CR(pts), 0.045, 0.012, 24, 6), 'gold');
  }
  // Cresta: aleta grande de delante a atrás (base gruesa)
  const crestSpikes = [[150, 1.66, 138, 1.2], [124, 1.98, 110, 1.28], [96, 2.04, 82, 1.28], [68, 1.76, 56, 1.2], [44, 1.44, 32, 1.1]];
  const crest = finGeo((sh) => {
    sh.moveTo(...polar(0.97, 22));
    for (let a = 22; a <= 168; a += 6) sh.lineTo(...polar(0.97, a));
    sh.lineTo(...polar(1.16, 168));
    for (const [ta, tr, va, vr] of crestSpikes) {
      sh.quadraticCurveTo(...polar(tr * 0.86, ta + 9), ...polar(tr, ta));
      sh.quadraticCurveTo(...polar(vr * 1.05, ta - 6), ...polar(vr, va));
    }
    sh.lineTo(...polar(0.98, 22));
  }, 0.1, 0.035);
  K.add(crest, 'red');
  for (const [ta, tr] of crestSpikes) {
    const [bu, bv] = polar(0.98, ta - 14), [tu, tv] = polar(tr * 0.97, ta);
    const [mu, mv] = polar((0.98 + tr) / 2 * 1.02, ta - 4);
    for (const sx of [-1, 1]) K.add(taper(Q(V(sx * 0.06, bv, bu), V(sx * 0.065, mv, mu), V(sx * 0.03, tv, tu)), 0.045, 0.006, 10, 6), 'gold');
  }
  // Alas laterales grandes, abiertas hacia fuera y atrás
  for (const sx of [-1, 1]) {
    const wing = finGeo((sh) => {
      sh.moveTo(0.3, 0.05);
      sh.quadraticCurveTo(-0.2, 0.7, -1.05, 1.3);
      sh.quadraticCurveTo(-0.78, 0.86, -0.66, 0.66);
      sh.quadraticCurveTo(-1.02, 0.86, -1.42, 0.86);
      sh.quadraticCurveTo(-1.02, 0.52, -0.86, 0.34);
      sh.quadraticCurveTo(-1.18, 0.38, -1.5, 0.24);
      sh.quadraticCurveTo(-1.0, -0.04, -0.45, -0.1);
      sh.lineTo(0.3, 0.05);
    }, 0.07, 0.03);
    const rot = new THREE.Quaternion().setFromEuler(E(0.08, sx * -0.55, sx * -0.12));
    const at = V(sx * 0.98, 0.12, -0.08);
    K.add(wing, 'red', new THREE.Matrix4().compose(at, rot, V(1, 1, 1)));
    for (const [tu, tv] of [[-1.05, 1.3], [-1.42, 0.86], [-1.5, 0.24]]) {
      for (const ox of [-1, 1]) {
        const c = taper(Q(V(ox * 0.045, 0.02, 0.15), V(ox * 0.045, tv * 0.45 + 0.05, tu * 0.45), V(ox * 0.02, tv * 0.96, tu * 0.96)), 0.04, 0.006, 10, 6);
        K.add(c, 'gold', new THREE.Matrix4().compose(at, rot, V(1, 1, 1)));
      }
    }
  }
  // Gema en la frente con engaste
  K.mesh(new THREE.TorusGeometry(0.1, 0.03, 8, 24), 'gold', V(0, 0.2, 1.06), E(-0.3, 0, 0));
  K.mesh(new THREE.IcosahedronGeometry(0.085, 1), 'gem', V(0, 0.2, 1.09), null, V(1, 1.25, 0.7));
  // Escamas solo en la nuca
  K.scales(bandScales({ rx: 1.03, rz: 1.03, y0: -1.0, y1: -0.05, rows: 4, cols: 18, a0: PI * 0.42, a1: PI * 1.58, taperTop: 0.93, lift: 1.05 }));

  const u = K.build();
  u.scale.set(rx, ry, rz);
  u.position.set(cx, brimY, cz);
  const g = H.framed(basis);
  g.add(u);
  return [{ bone: head, mesh: g }];
}

// ------------------------------------------------------------
// PECHERA — peto con pectorales, vientre de escamas transversales (como un
// dragón), espalda de escamas, hombreras con púas, brazales y faldones en punta
// ------------------------------------------------------------
function buildBody(root, H) {
  const tn = H.tune('body');
  const s = tn.s;
  const PI = Math.PI;
  const hips = H.findBone(root, 'Hips');
  const sp = H.findBone(root, 'Spine');
  const sp1 = H.findBone(root, 'Spine1');
  const sp2 = H.findBone(root, 'Spine2');
  if (!sp || !sp2) return null;
  const out = [];

  // --- Peto: Spine2 ---
  {
    const basis = H.spineFrame(root, sp2, 'Neck');
    const box = torsoFit(root, H, sp2, basis, 0.25, 0);
    if (box) {
      const h = box.max.y - box.min.y;
      const rx = (box.max.x - box.min.x) / 2 * 1.16 * s, rz = (box.max.z - box.min.z) / 2 * 1.26 * s;
      const cx = (box.min.x + box.max.x) / 2, cz = (box.min.z + box.max.z) / 2;
      const y0 = box.min.y, y1 = box.max.y - h * 0.04, H2 = y1 - y0;
      const K = new Kit();
      const R = (t) => 0.9 + 0.1 * t;   // radio relativo según altura (0 abajo → 1 arriba)
      K.add(shell(1, 0.9, 1, 0, PI * 2, 56, 3), 'deep', new THREE.Matrix4().compose(V(cx, (y0 + y1) / 2, cz), new THREE.Quaternion(), V(rx, H2, rz)));
      // Tapa de hombros + gorguera
      K.add(new THREE.RingGeometry(0.42, 1, 56, 2).rotateX(-PI / 2), 'red', new THREE.Matrix4().compose(V(cx, y1, cz), new THREE.Quaternion(), V(rx, 1, rz)));
      K.add(shell(0.45, 0.5, 1, 0, PI * 2, 40, 1), 'red', new THREE.Matrix4().compose(V(cx, y1 + H2 * 0.07, cz), new THREE.Quaternion(), V(rx, H2 * 0.16, rz)));
      K.add(arcTube(rx * 0.46, rz * 0.46, y1 + H2 * 0.15, 0, PI * 2, H2 * 0.02, cx, cz), 'gold');
      // Peto lacado delante
      const pa = PI * 0.48;
      K.add(shell(1.06, 0.97, 1, -pa, pa * 2, 48, 4), 'red', new THREE.Matrix4().compose(V(cx, (y0 + y1) / 2, cz), new THREE.Quaternion(), V(rx, H2, rz)));
      // Pectorales abombados
      for (const sx of [-1, 1]) {
        const a = sx * 0.2 * PI, t = 0.66, k = R(t) * 1.04;
        const m = new THREE.Matrix4().compose(V(cx + rx * k * Math.sin(a) * 0.92, y0 + H2 * t, cz + rz * k * Math.cos(a) * 0.86),
          new THREE.Quaternion().setFromEuler(E(PI / 2 - 0.15, 0, -a * 0.9)), V(rx * 0.44, rz * 0.32, H2 * 0.27));
        K.add(new THREE.SphereGeometry(1, 36, 14, 0, PI * 2, 0, PI * 0.5), 'red', m);
        K.add(new THREE.TorusGeometry(1, 0.035, 8, 48).rotateX(PI / 2), 'gold', m);
      }
      // Quilla del esternón
      {
        const pts = [];
        for (let i = 0; i <= 10; i++) { const t = i / 10; pts.push(V(cx, y0 + H2 * (0.06 + 0.9 * t), cz + rz * (1.0 + 0.06 * t) + H2 * 0.012)); }
        K.add(new THREE.TubeGeometry(CR(pts), 24, H2 * 0.02, 6, false), 'gold');
      }
      // Alas doradas bajo los pectorales (2 por lado) que barren hacia los costados
      for (let j = 0; j < 2; j++) for (const sx of [-1, 1]) {
        const pts = [];
        for (let i = 0; i <= 14; i++) {
          const t = i / 14;
          const a = sx * (0.04 + 0.4 * t) * PI;
          const y = y0 + H2 * (0.38 - j * 0.12 + 0.2 * t * t);
          const k = R((y - y0) / H2) * 1.065;
          pts.push(V(cx + rx * k * Math.sin(a), y, cz + rz * k * Math.cos(a)));
        }
        K.add(taper(CR(pts), H2 * (0.022 - j * 0.004), H2 * 0.006, 28, 6), 'gold');
      }
      // Borde lateral del peto con remaches
      for (const sx of [-1, 1]) {
        const pts = [];
        for (let i = 0; i <= 10; i++) { const t = i / 10; const y = y0 + H2 * t; const k = R(t) * 1.07; pts.push(V(cx + rx * k * Math.sin(sx * pa), y, cz + rz * k * Math.cos(sx * pa))); }
        K.add(new THREE.TubeGeometry(CR(pts), 20, H2 * 0.018, 6, false), 'gold');
      }
      // Emblema: gema con garras en el esternón
      const gy = y0 + H2 * 0.3, gz = cz + rz * 1.03 + H2 * 0.02;
      K.mesh(new THREE.TorusGeometry(rx * 0.1, rx * 0.022, 8, 28), 'gold', V(cx, gy, gz));
      K.mesh(new THREE.IcosahedronGeometry(rx * 0.085, 1), 'gem', V(cx, gy, gz + rx * 0.02), null, V(1, 1.3, 0.6));
      // alitas doradas a los lados de la gema
      for (const sx of [-1, 1]) {
        const k = rx * 0.32, ox = cx + sx * rx * 0.1;
        const P2 = (x, y) => [ox + sx * x * k, gy + y * k];
        const w = new THREE.Shape();
        w.moveTo(...P2(0, 0.05)); w.quadraticCurveTo(...P2(0.4, 0.45), ...P2(1.0, 0.5));
        w.quadraticCurveTo(...P2(0.8, 0.3), ...P2(0.9, 0.18)); w.quadraticCurveTo(...P2(0.6, 0.12), ...P2(0.7, -0.05));
        w.quadraticCurveTo(...P2(0.35, 0.0), ...P2(0, -0.08)); w.lineTo(...P2(0, 0.05));
        const wg = new THREE.ExtrudeGeometry(w, { depth: rx * 0.02, bevelEnabled: true, bevelThickness: rx * 0.008, bevelSize: rx * 0.008, bevelSegments: 1, curveSegments: 8 });
        // pegar a la curva del peto
        const pp = wg.attributes.position;
        for (let i = 0; i < pp.count; i++) { const x = pp.getX(i) - cx; pp.setZ(i, pp.getZ(i) + gz - rz * (1 - Math.sqrt(Math.max(0, 1 - (x / (rx * 1.06)) ** 2))) * 1.06); }
        wg.computeVertexNormals();
        K.add(wg, 'gold');
      }
      // Escamas: espalda y costados
      K.scales(bandScales({ cx, cz, rx: rx * 0.9, rz: rz * 0.9, y0: y0 + H2 * 0.02, y1: y1 - H2 * 0.01, rows: 8, cols: 20, a0: pa * 0.95, a1: PI * 2 - pa * 0.95, taperTop: 1 / 0.9, lift: 1.02, goldRow: 0 }));
      const g = H.framed(basis);
      g.add(K.build());
      out.push({ bone: sp2, mesh: g });
    }
  }

  // --- Vientre: escamas + columna estrecha de escudos ventrales (Spine) ---
  {
    const fb = sp;
    const basis = H.spineFrame(root, sp, 'Spine1');
    const box = torsoFit(root, H, sp, basis, 0.12, 0.3, [sp, ...(sp1 ? [sp1] : [])]);
    if (box) {
      const h = box.max.y - box.min.y;
      const rx = (box.max.x - box.min.x) / 2 * 1.16 * s, rz = (box.max.z - box.min.z) / 2 * 1.26 * s;
      const cx = (box.min.x + box.max.x) / 2, cz = (box.min.z + box.max.z) / 2;
      const K = new Kit();
      K.add(shell(1, 1, 1, 0, PI * 2, 56, 2), 'deep', new THREE.Matrix4().compose(V(cx, (box.min.y + box.max.y) / 2, cz), new THREE.Quaternion(), V(rx * 0.98, h, rz * 0.98)));
      const ca = PI * 0.15;
      K.scales(bandScales({ cx, cz, rx, rz, y0: box.min.y, y1: box.max.y, rows: 7, cols: 22, a0: ca * 0.85, a1: PI * 2 - ca * 0.85, lift: 0.99, tilt: 0.18, size: 0.95 }));
      // Escudos ventrales: muchos y estrechos, abombados, cada vez más pequeños hacia abajo
      const N = 7;
      for (let i = 0; i < N; i++) {
        const t = i / N;
        const top = box.max.y - h * t + h * 0.02, hh = h / N * 1.35;
        const w = ca * (1 - t * 0.25);
        const g = shell(0.99, 1.03, 1, -w, w * 2, 18, 6);
        vDip(g, 0.55, w * 1.001, 0.3, true);     // escudo ventral en V (chevron)
        prow(g, 0.2, w * 1.2);
        K.add(g, i % 2 ? 'deep' : 'red', new THREE.Matrix4().compose(V(cx, top - hh / 2, cz), new THREE.Quaternion(), V(rx * (1.05 + i * 0.004), hh, rz * (1.07 + i * 0.004))));
      }
      // Nervio central
      const pts = [];
      for (let i = 0; i <= 10; i++) { const t = i / 10; pts.push(V(cx, box.max.y - h * t, cz + rz * 1.2 + h * 0.01)); }
      K.add(new THREE.TubeGeometry(CR(pts), 20, h * 0.012, 6, false), 'gold');
      const g = H.framed(basis);
      g.add(K.build());
      out.push({ bone: fb, mesh: g });
    }
  }

  // --- Cintura y faldones en punta (Hips) ---
  if (hips) {
    const basis = H.spineFrame(root, hips, 'Spine');
    const box = torsoFit(root, H, hips, basis, 0, 0);
    if (box) {
      const h = box.max.y - box.min.y;
      const rx = (box.max.x - box.min.x) / 2 * 1.14 * s, rz = (box.max.z - box.min.z) / 2 * 1.22 * s;
      const cx = (box.min.x + box.max.x) / 2, cz = (box.min.z + box.max.z) / 2;
      const beltY = box.max.y - h * 0.14;
      const K = new Kit();
      K.add(shell(1, 1, 1, 0, PI * 2, 56, 1), 'dark', new THREE.Matrix4().compose(V(cx, beltY, cz), new THREE.Quaternion(), V(rx * 1.02, h * 0.2, rz * 1.02)));
      K.add(arcTube(rx * 1.03, rz * 1.03, beltY + h * 0.1, 0, PI * 2, h * 0.016, cx, cz), 'gold');
      K.add(arcTube(rx * 1.03, rz * 1.03, beltY - h * 0.1, 0, PI * 2, h * 0.016, cx, cz), 'gold');
      for (let i = 0; i < 20; i++) { const a = (i / 20) * PI * 2; K.mesh(new THREE.SphereGeometry(h * 0.026, 8, 6), 'gold', V(cx + rx * 1.04 * Math.sin(a), beltY, cz + rz * 1.04 * Math.cos(a))); }
      K.mesh(new THREE.CylinderGeometry(rx * 0.15, rx * 0.15, rz * 0.06, 32), 'gold', V(cx, beltY, cz + rz * 1.06), E(PI / 2, 0, 0));
      K.mesh(new THREE.IcosahedronGeometry(rx * 0.07, 1), 'gem', V(cx, beltY, cz + rz * 1.1), null, V(1, 1, 0.6));
      // Falda de escamas
      K.scales(bandScales({ cx, cz, rx: rx * 1.05, rz: rz * 1.05, y0: beltY - h * 1.0, y1: beltY - h * 0.08, rows: 5, cols: 24, taperTop: 0.95, lift: 1.0, tilt: 0.36 }).map(e => { e.h *= 1.5; return e; }));
      // Faldones en punta (delante y detrás): forma de escudo, lacados con filo de oro
      for (const back of [0, 1]) {
        const Wd = rx * 0.4, Hd = h * 1.9;
        const path = (sh, k) => { sh.moveTo(-Wd * k, 0); sh.lineTo(Wd * k, 0); sh.quadraticCurveTo(Wd * k * 0.95, -Hd * 0.55 * k, 0, -Hd * k); sh.quadraticCurveTo(-Wd * k * 0.95, -Hd * 0.55 * k, -Wd * k, 0); };
        const s1 = new THREE.Shape(); path(s1, 1);
        const gT = bendZ(new THREE.ExtrudeGeometry(s1, { depth: h * 0.03, bevelEnabled: true, bevelThickness: h * 0.015, bevelSize: h * 0.02, bevelSegments: 2, curveSegments: 16 }), Wd, rz * 0.25);
        const s2 = new THREE.Shape(); path(s2, 1); const hole = new THREE.Path(); path(hole, 0.82); hole.currentPoint; s2.holes.push(hole);
        const gB = bendZ(new THREE.ExtrudeGeometry(s2, { depth: h * 0.05, bevelEnabled: false, curveSegments: 16 }), Wd, rz * 0.25);
        const q = new THREE.Quaternion().setFromEuler(E(-0.12, back ? PI : 0, 0));
        const at = V(cx, beltY - h * 0.06, cz + (back ? -1 : 1) * rz * 1.07);
        K.add(gT, 'red', new THREE.Matrix4().compose(at, q, V(1, 1, 1)));
        K.add(gB, 'gold', new THREE.Matrix4().compose(at.clone().add(V(0, 0, (back ? -1 : 1) * h * 0.012)), q, V(1, 1, 1)));
        // escamas grabadas
        const list = [];
        for (let r = 0; r < 4; r++) for (let c = -1; c <= 1; c++) {
          const x = (c + (r % 2) * 0.5) * Wd * 0.5, y = -Hd * (0.16 + r * 0.17);
          if (Math.abs(x) > Wd * 0.8 * (1 - (r * 0.17 + 0.16) * 0.9)) continue;
          const p = V(x, y, h * 0.05 - rz * 0.25 * (x / Wd) ** 2).applyQuaternion(q).add(at);
          list.push({ p, n: V(0, 0, 1).applyQuaternion(q), up: V(0, 1, 0), w: Wd * 0.3, h: Hd * 0.12, tilt: 0.2 });
        }
        K.scales(list);
      }
      // Escamas grandes en los costados (3 por lado)
      const side = [];
      for (const sx of [-1, 1]) for (let i = 0; i < 3; i++) {
        const a = sx * (0.5 + i * 0.07) * PI, y = beltY - h * (0.25 + i * 0.08);
        side.push({ p: V(cx + rx * 1.12 * Math.sin(a), y, cz + rz * 1.12 * Math.cos(a)), n: V(Math.sin(a) / rx, 0, Math.cos(a) / rz).normalize(), up: V(0, 1, 0), w: rx * 0.22, h: h * 0.28, tilt: 0.3, gold: i === 0 });
      }
      K.scales(side);
      const g = H.framed(basis);
      g.add(K.build());
      out.push({ bone: hips, mesh: g });
    }
  }

  // --- Hombreras de 3 capas con púas + brazales ---
  for (const side of ['Left', 'Right']) {
    const arm = H.findBone(root, side + 'Arm');
    if (!arm) continue;
    const fore = H.childNamed(arm, side + 'ForeArm');
    const dir = fore ? fore.position.clone().normalize() : V(0, 1, 0);
    const basis = H.orient(dir, H.boneBasis(root, arm).fwd);
    const box = H.fitBox(H.boneVerts(root, [arm], arm), basis);
    if (!box) continue;
    const L = box.max.y - Math.max(0, box.min.y);
    const rxA = (box.max.x - box.min.x) / 2, rzA = (box.max.z - box.min.z) / 2;
    const r = Math.max(rxA, rzA) * 1.85 * s;
    const cx = (box.min.x + box.max.x) / 2, cz = (box.min.z + box.max.z) / 2;
    const upF = H.boneBasis(root, arm).up.clone().applyMatrix4(basis.clone().transpose());
    const sgn = upF.x >= 0 ? 1 : -1;
    const K = new Kit();
    const pad = new THREE.Object3D();
    pad.position.set(cx + sgn * r * 0.08, L * 0.06, cz);
    pad.rotation.z = -sgn * PI / 2;
    pad.updateMatrix();
    const P = pad.matrix;
    const along = -sgn;
    for (let k = 0; k < 3; k++) {
      const sc = 1 - k * 0.13;
      const m = new THREE.Matrix4().compose(V(along * k * r * 0.32, -k * r * 0.13, 0), new THREE.Quaternion().setFromEuler(E(0, 0, along * k * 0.22)), V(r * sc, r * 0.8 * sc, r * 1.04 * sc));
      const cap = new THREE.SphereGeometry(1, 44, 14, 0, PI * 2, 0, PI * 0.5);
      // borde festoneado
      const pp = cap.attributes.position;
      for (let i = 0; i < pp.count; i++) { const y = pp.getY(i); if (y < 0.25) { const a = Math.atan2(pp.getX(i), pp.getZ(i)); pp.setY(i, y - 0.12 * Math.abs(Math.sin(a * 4)) * (0.25 - y) * 4); } }
      cap.computeVertexNormals();
      K.add(cap, 'red', m.clone().premultiply(P));
      K.add(new THREE.TorusGeometry(1, 0.04, 8, 56).rotateX(PI / 2), 'gold', m.clone().premultiply(P));
    }
    {
      const list = domeScales({ rx: r, ry: r * 0.8, rz: r * 1.04, lat0: 0.2, lat1: 1.15, rows: 3, size: 0.95, lift: 1.03 });
      for (const e of list) { e.p.applyMatrix4(P); e.n.transformDirection(P); e.up.transformDirection(P); }
      K.scales(list);
    }
    for (let i = -2; i <= 2; i++) {
      const bx = i * r * 0.2 + along * r * 0.06;
      const len = 1 - Math.abs(i) * 0.16;
      const base = V(bx, r * 0.7, 0), mid = V(bx * 1.12, r * 1.3, -r * 0.08), tip = V(bx * 1.3, r * 1.7, -r * 0.62);
      K.add(taper(Q(base, mid.clone().lerp(base, 1 - len), tip.clone().lerp(base, 1 - len)), r * 0.11, r * 0.008, 14, 8), 'dark', P);
      K.add(new THREE.TorusGeometry(r * 0.11, r * 0.03, 6, 20).rotateX(PI / 2), 'gold', new THREE.Matrix4().makeTranslation(base.x, base.y, base.z).premultiply(P));
    }
    {
      const y0 = L * 0.26, y1 = L * 0.98;
      const ex = rxA * 1.2 * s, ez = rzA * 1.2 * s;
      K.add(shell(1, 0.95, 1, 0, PI * 2, 40, 1), 'deep', new THREE.Matrix4().compose(V(cx, (y0 + y1) / 2, cz), new THREE.Quaternion(), V(ex, y1 - y0, ez)));
      K.scales(bandScales({ cx, cz, rx: ex, rz: ez, y0, y1, rows: 5, cols: 13, taperTop: 0.95, lift: 1.03 }).map(e => { e.up = V(0, -1, 0); return e; }));
      K.add(arcTube(ex * 1.04, ez * 1.04, y1, 0, PI * 2, L * 0.018, cx, cz), 'gold');
    }
    const g = H.framed(basis);
    g.add(K.build());
    out.push({ bone: arm, mesh: g });

    if (fore) {
      const hand = H.childNamed(fore, side + 'Hand');
      const dirF = hand ? hand.position.clone().normalize() : V(0, 1, 0);
      const bF = H.orient(dirF, H.boneBasis(root, fore).fwd);
      const boxF = H.fitBox(H.boneVerts(root, [fore], fore), bF);
      if (boxF) {
        const LF = boxF.max.y - Math.max(0, boxF.min.y);
        const ex = (boxF.max.x - boxF.min.x) / 2 * 1.2 * s, ez = (boxF.max.z - boxF.min.z) / 2 * 1.2 * s;
        const fx = (boxF.min.x + boxF.max.x) / 2, fz = (boxF.min.z + boxF.max.z) / 2;
        const KF = new Kit();
        const y0 = LF * 0.06, y1 = LF * 0.62;
        KF.add(shell(0.94, 1.05, 1, 0, PI * 2, 40, 2), 'red', new THREE.Matrix4().compose(V(fx, (y0 + y1) / 2, fz), new THREE.Quaternion(), V(ex, y1 - y0, ez)));
        KF.add(arcTube(ex * 1.06, ez * 1.06, y0, 0, PI * 2, LF * 0.016, fx, fz), 'gold');
        KF.add(arcTube(ex * 0.98, ez * 0.98, y1, 0, PI * 2, LF * 0.014, fx, fz), 'gold');
        const upFF = H.boneBasis(root, fore).up.clone().applyMatrix4(bF.clone().transpose());
        const ox = upFF.x >= 0 ? 1 : -1;
        // Aleta del codo hacia atrás
        const fin = finGeo((sh) => {
          sh.moveTo(0, 0); sh.quadraticCurveTo(-0.1, 0.3, -0.2, 0.75); sh.quadraticCurveTo(0.05, 0.5, 0.2, 0.5);
          sh.quadraticCurveTo(0.15, 0.3, 0.45, 0.25); sh.quadraticCurveTo(0.3, 0.1, 0.55, 0.0); sh.lineTo(0, 0);
        }, 0.05);
        // plano del aleta: perpendicular a "delante"; sobresale hacia fuera (ox) y hacia el hombro (−y)
        KF.add(fin, 'red', new THREE.Matrix4().compose(V(fx + ox * ex * 0.95, y0 + (y1 - y0) * 0.15, fz), new THREE.Quaternion().setFromEuler(E(0, PI / 2, 0)), V(LF * 0.5, -LF * 0.5, LF * 0.5 * ox)));
        const gF = H.framed(bF);
        gF.add(KF.build());
        out.push({ bone: fore, mesh: gF });
      }
    }
  }
  return out.length ? out : null;
}

// ------------------------------------------------------------
// GREBAS + TASSETS LARGOS (estilo tassets de Bandos fusionados con la falda de
// dragón): placas colgantes cubiertas de "plumas" rojas, ancladas a cada muslo
// para que sigan a la pierna al andar. Llegan casi a las botas.
// ------------------------------------------------------------
/** Posición de reposo (mundo del modelo) de un hueso, desde boneInverses. */
function restPos(root, name) {
  let out = null;
  root.traverse(o => {
    if (out || !o.isSkinnedMesh || !o.skeleton) return;
    const sk = o.skeleton;
    const b = sk.bones.find(x => String(x.name).replace(/^mixamorig\d*:?/, '') === name);
    if (!b) return;
    out = V().setFromMatrixPosition(sk.boneInverses[sk.bones.indexOf(b)].clone().invert());
  });
  return out;
}
function restRot(root, bone) {
  let q = null;
  root.traverse(o => {
    if (q || !o.isSkinnedMesh || !o.skeleton) return;
    const i = o.skeleton.bones.indexOf(bone);
    if (i < 0) return;
    q = new THREE.Quaternion();
    o.skeleton.boneInverses[i].decompose(V(), q, V());
  });
  return q;
}

/** Placa curva paramétrica alrededor del eje Y: ángulo ac±aw, de y0 a y0+len (hacia +Y), punta abajo. */
function tassetPlate(ac, aw, y0, len, r0, r1, point = 0.18, wSeg = 10, hSeg = 18) {
  const g = new THREE.PlaneGeometry(1, 1, wSeg, hSeg);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const u = p.getX(i) * 2, v = 0.5 - p.getY(i);
    const yy = y0 + v * len * (1 + point * (1 - Math.abs(u)) * v);
    const a = ac + u * aw;
    const r = r0 + (r1 - r0) * v + 0.04 * r0 * (1 - u * u);   // ligeramente abombada
    p.setXYZ(i, Math.sin(a) * r, yy, Math.cos(a) * r);
  }
  g.computeVertexNormals();
  return g;
}
function plateAt(ac, aw, y0, len, r0, r1, point, u, v, lift = 1) {
  const yy = y0 + v * len * (1 + point * (1 - Math.abs(u)) * v);
  const a = ac + u * aw;
  const r = (r0 + (r1 - r0) * v + 0.04 * r0 * (1 - u * u)) * lift;
  return { p: V(Math.sin(a) * r, yy, Math.cos(a) * r), n: V(Math.sin(a), -(r1 - r0) / len, Math.cos(a)).normalize() };
}

function buildLegs(root, H) {
  const tn = H.tune('legs');
  const PI = Math.PI;
  const out = [];
  for (const side of ['Left', 'Right']) {
    const upL = H.findBone(root, side + 'UpLeg');
    const leg = H.findBone(root, side + 'Leg');
    if (!upL || !leg) continue;
    const foot = H.childNamed(leg, side + 'Foot') || H.findBone(root, side + 'Foot');
    const other = side === 'Left' ? 'Right' : 'Left';

    // ---- Muslo + tassets ----
    const dirT = (H.childNamed(upL, side + 'Leg') || leg).position.clone().normalize();
    const bT = H.orient(dirT, H.boneBasis(root, upL).fwd);
    const boxT = H.fitBox(H.boneVerts(root, [upL], upL), bT);
    if (boxT) {
      const h = boxT.max.y - boxT.min.y;
      const rx = (boxT.max.x - boxT.min.x) / 2 * 1.14 * tn.s, rz = (boxT.max.z - boxT.min.z) / 2 * 1.14 * tn.s;
      const cx = (boxT.min.x + boxT.max.x) / 2, cz = (boxT.min.z + boxT.max.z) / 2;
      const LT = leg.position.length();
      const LS = foot ? foot.position.length() : LT;
      const y0 = Math.min(boxT.min.y + h * 0.04, LT * 0.05), y1 = LT * 1.02;
      const K = new Kit();
      // Muslo entero en escamas (sin huecos hasta la rodilla)
      K.add(shell(0.84, 1, 1, 0, PI * 2, 48, 2), 'deep', new THREE.Matrix4().compose(V(cx, (y0 + y1) / 2, cz), new THREE.Quaternion(), V(rx, y1 - y0, rz)));
      K.scales(bandScales({ cx, cz, rx, rz, y0, y1, rows: 8, cols: 15, taperTop: 0.84, lift: 1.03 }).map(e => { e.up = V(0, -1, 0); return e; }));
      // Dirección "hacia la otra pierna" en este marco → ahí no van placas
      let innerA = PI / 2;
      {
        const pa = restPos(root, side + 'UpLeg'), pb = restPos(root, other + 'UpLeg'), q = restRot(root, upL);
        if (pa && pb && q) {
          const d = pb.sub(pa).applyQuaternion(q).applyMatrix4(bT.clone().transpose());
          innerA = Math.atan2(d.x, d.z);
        }
      }
      const outerA = innerA + PI;
      // Tassets: delante, fuera y detrás (la de detrás más corta para no chocar con la pantorrilla)
      const R0 = Math.max(rx, rz) * 1.18, Rb = Math.max(rx, rz) * 1.55;
      const plates = [
        { ac: outerA - PI * 0.5 * Math.sign(Math.sin(outerA - innerA) || 1) * 0 + (innerA > 0 ? -1 : 1) * 0, aw: 0.36, len: LT + LS * 0.78 },
      ];
      plates.length = 0;
      // Ángulos relativos al lado de fuera: delante (+Z) / fuera / detrás (−Z)
      const front = 0, back = PI;
      const pick = (a) => Math.atan2(Math.sin(a), Math.cos(a));
      plates.push({ ac: pick(front + (pick(outerA - front) > 0 ? 0.22 : -0.22)), aw: 0.62, len: LT + LS * 0.82, point: 0.2 });
      plates.push({ ac: pick(outerA), aw: 0.55, len: LT + LS * 0.74, point: 0.16 });
      plates.push({ ac: pick(back + (pick(outerA - back) > 0 ? 0.25 : -0.25)), aw: 0.6, len: LT * 1.05, point: 0.18 });
      const ty0 = y0 - h * 0.02;
      plates.forEach((pl, idx) => {
        const r0 = R0 * (1 + idx * 0.02), r1 = Rb * (1 + idx * 0.02);
        const geo = tassetPlate(pl.ac, pl.aw, 0, pl.len, r0, r1, pl.point, 12, 22);
        const M4 = new THREE.Matrix4().makeTranslation(cx, ty0, cz);
        K.add(geo, 'deep', M4);
        // Plumas: filas de escamas alargadas, de arriba abajo
        const list = [];
        const rows = 11, cols = 5;
        for (let r = 0; r < rows; r++) {
          const v = (r + 0.6) / rows;
          for (let c = 0; c <= cols; c++) {
            const u = -1 + (c + (r % 2) * 0.5) * (2 / cols);
            if (u > 1.0001) continue;
            const uu = u * 0.94;
            const at = plateAt(pl.ac, pl.aw, 0, pl.len, r0, r1, pl.point, uu, v, 1.02 + (rows - r) * 0.004);
            at.p.add(V(cx, ty0, cz));
            const wArc = (2 * pl.aw / cols) * (r0 + (r1 - r0) * v);
            list.push({ p: at.p, n: at.n, up: V(0, -1, 0), w: wArc * 0.62, h: pl.len / rows * 0.95, tilt: 0.22, gold: r === rows - 1 && c % 2 === 0 });
          }
        }
        K.scales(list);
        // Filos de oro: bordes laterales y punta
        for (const ue of [-1, 1]) {
          const pts = [];
          for (let k = 0; k <= 16; k++) { const v = k / 16; pts.push(plateAt(pl.ac, pl.aw, 0, pl.len, r0, r1, pl.point, ue, v, 1.015).p.add(V(cx, ty0, cz))); }
          K.add(new THREE.TubeGeometry(CR(pts), 32, h * 0.018, 6, false), 'gold');
        }
        {
          const pts = [];
          for (let k = 0; k <= 20; k++) { const u = -1 + 2 * k / 20; pts.push(plateAt(pl.ac, pl.aw, 0, pl.len, r0, r1, pl.point, u, 1, 1.015).p.add(V(cx, ty0, cz))); }
          K.add(new THREE.TubeGeometry(CR(pts), 32, h * 0.02, 6, false), 'gold');
        }
        // Placa de arriba (lama de Bandos) con gema
        {
          const top = tassetPlate(pl.ac, pl.aw * 1.02, -h * 0.04, h * 0.2, r0 * 1.05, r0 * 1.08, 0, 10, 2);
          K.add(top, 'red', M4);
          const pts = [];
          for (let k = 0; k <= 16; k++) { const u = -1 + 2 * k / 16; pts.push(plateAt(pl.ac, pl.aw * 1.02, -h * 0.04, h * 0.2, r0 * 1.05, r0 * 1.08, 0, u, 1, 1.02).p.add(V(cx, ty0, cz))); }
          K.add(new THREE.TubeGeometry(CR(pts), 24, h * 0.016, 6, false), 'gold');
          const gp = plateAt(pl.ac, 0, -h * 0.04, h * 0.2, r0 * 1.05, r0 * 1.08, 0, 0, 0.5, 1.06);
          K.mesh(new THREE.IcosahedronGeometry(h * 0.035, 1), 'gem', gp.p.add(V(cx, ty0, cz)), null, V(1, 1.2, 1));
        }
      });
      const g = H.framed(bT);
      g.add(K.build());
      out.push({ bone: upL, mesh: g });
    }

    // ---- Espinillera + rodillera ----
    const dirS = foot ? foot.position.clone().normalize() : V(0, 1, 0);
    const bS = H.orient(dirS, H.boneBasis(root, leg).fwd);
    const boxS = H.fitBox(H.boneVerts(root, [leg], leg), bS);
    if (boxS) {
      const h = boxS.max.y - boxS.min.y;
      const rx = (boxS.max.x - boxS.min.x) / 2 * 1.15 * tn.s, rz = (boxS.max.z - boxS.min.z) / 2 * 1.15 * tn.s;
      const cx = (boxS.min.x + boxS.max.x) / 2, cz = (boxS.min.z + boxS.max.z) / 2;
      const y0 = boxS.min.y - h * 0.08, y1 = boxS.max.y - h * 0.06;
      const K = new Kit();
      K.add(shell(0.78, 1.02, 1, 0, PI * 2, 48, 3), 'red', new THREE.Matrix4().compose(V(cx, (y0 + y1) / 2, cz), new THREE.Quaternion(), V(rx, y1 - y0, rz)));
      K.add(arcTube(rx * 1.02, rz * 1.02, y0, 0, PI * 2, h * 0.016, cx, cz), 'gold');
      K.add(arcTube(rx * 0.8, rz * 0.8, y1, 0, PI * 2, h * 0.014, cx, cz), 'gold');
      K.scales(bandScales({ cx, cz, rx: rx * 1.02, rz: rz * 1.02, y0: y0 + h * 0.08, y1: y1 - h * 0.04, rows: 7, cols: 10, a0: PI * 0.45, a1: PI * 1.55, taperTop: 0.78, lift: 1.03 }).map(e => { e.up = V(0, -1, 0); return e; }));
      // Placa frontal en punta (hacia el pie) con nervio dorado
      {
        const geo = tassetPlate(0, 0.5, y0 + h * 0.18, (y1 - y0) * 0.78, rz * 1.06, rz * 0.86, 0.2, 10, 12);
        K.add(geo, 'red', new THREE.Matrix4().makeTranslation(cx, 0, cz));
        const pts = [];
        for (let k = 0; k <= 12; k++) { const v = k / 12; pts.push(plateAt(0, 0.5, y0 + h * 0.18, (y1 - y0) * 0.78, rz * 1.06, rz * 0.86, 0.2, 0, v, 1.03).p.add(V(cx, 0, cz))); }
        K.add(new THREE.TubeGeometry(CR(pts), 24, h * 0.02, 6, false), 'gold');
        for (const ue of [-1, 1]) {
          const pe = [];
          for (let k = 0; k <= 12; k++) { const v = k / 12; pe.push(plateAt(0, 0.5, y0 + h * 0.18, (y1 - y0) * 0.78, rz * 1.06, rz * 0.86, 0.2, ue, v, 1.02).p.add(V(cx, 0, cz))); }
          K.add(new THREE.TubeGeometry(CR(pe), 24, h * 0.012, 6, false), 'gold');
        }
      }
      // Rodillera: 2 capas + gema + aletas
      const ky = y0 + h * 0.06, kz = cz + rz * 0.92;
      for (let j = 0; j < 2; j++) {
        const m = new THREE.Matrix4().compose(V(cx, ky + j * h * 0.1, kz - j * rz * 0.06), new THREE.Quaternion().setFromEuler(E(PI / 2 - j * 0.25, 0, 0)), V(rz * (0.78 - j * 0.12), rz * (0.5 - j * 0.08), rz * (0.86 - j * 0.12)));
        const cap = new THREE.SphereGeometry(1, 32, 12, 0, PI * 2, 0, PI * 0.5);
        K.add(cap, 'red', m);
        K.add(new THREE.TorusGeometry(1, 0.05, 8, 40).rotateX(PI / 2), 'gold', m);
      }
      K.mesh(new THREE.TorusGeometry(rz * 0.13, rz * 0.03, 8, 24), 'gold', V(cx, ky, kz + rz * 0.49));
      K.mesh(new THREE.IcosahedronGeometry(rz * 0.11, 1), 'gem', V(cx, ky, kz + rz * 0.52), null, V(1, 1.2, 0.6));
      for (const sx of [-1, 1]) {
        const wing = finGeo((sh) => {
          sh.moveTo(0, 0);
          sh.quadraticCurveTo(-0.2, 0.25, -0.65, 0.5);
          sh.quadraticCurveTo(-0.45, 0.2, -0.75, 0.15);
          sh.quadraticCurveTo(-0.4, 0.0, -0.6, -0.2);
          sh.quadraticCurveTo(-0.2, -0.12, 0, -0.1);
          sh.lineTo(0, 0);
        }, 0.05);
        const sc = rz * 0.85;
        K.add(wing, 'red', new THREE.Matrix4().compose(V(cx + sx * rx * 0.9, ky + h * 0.03, cz + rz * 0.35), new THREE.Quaternion().setFromEuler(E(0, sx * -0.4, 0)), V(sc, -sc, sc)));
      }
      const g = H.framed(bS);
      g.add(K.build());
      out.push({ bone: leg, mesh: g });
    }
  }
  return out.length ? out : null;
}

// ------------------------------------------------------------
// BOTAS (escarpes articulados)
// ------------------------------------------------------------
function buildBoots(root, H) {
  const tn = H.tune('boots');
  const PI = Math.PI;
  const out = [];
  for (const side of ['Left', 'Right']) {
    const foot = H.findBone(root, side + 'Foot');
    if (!foot) continue;
    const toe = H.childNamed(foot, side + 'ToeBase');
    const toeEnd = toe ? H.childNamed(toe, side + 'Toe_End') : null;
    const dir = toe ? toe.position.clone().normalize() : V(0, 0, 1);
    const { up } = H.boneBasis(root, foot);
    const z = dir.clone().sub(up.clone().multiplyScalar(dir.dot(up))).normalize();
    const y = up.clone().normalize();
    const x = new THREE.Vector3().crossVectors(y, z).normalize();
    const basis = new THREE.Matrix4().makeBasis(x, y, z);
    const box = H.fitBox(H.boneVerts(root, [foot, ...(toe ? [toe] : []), ...(toeEnd ? [toeEnd] : [])], foot), basis);
    if (!box) continue;
    const w = (box.max.x - box.min.x) * 1.16 * tn.s;
    const len = (box.max.z - box.min.z) * 1.08;
    const hgt = box.max.y - box.min.y;
    const cx = (box.min.x + box.max.x) / 2;
    const zb = box.min.z - len * 0.02, zt = box.max.z + len * 0.06;
    const K = new Kit();
    // Suela
    K.mesh(new THREE.BoxGeometry(w * 1.02, hgt * 0.14, len * 1.04, 2, 1, 4), 'dark', V(cx, box.min.y + hgt * 0.07, (zb + zt) / 2));
    // Talón
    K.mesh(new THREE.SphereGeometry(1, 24, 12, 0, PI * 2, 0, PI / 2), 'red', V(cx, box.min.y + hgt * 0.12, zb + len * 0.18), E(-PI / 2, 0, 0), V(w * 0.52, len * 0.22, hgt * 0.7));
    // Lamas sobre el empeine (de tobillo a punta)
    const N = 6;
    for (let i = 0; i < N; i++) {
      const t = i / (N - 1);
      const zc = zb + len * (0.3 + t * 0.52);
      const hh = hgt * (0.88 - t * 0.45);
      const ww = w * (0.54 - t * 0.12);
      const m = new THREE.Matrix4().compose(V(cx, box.min.y + hgt * 0.12, zc), new THREE.Quaternion().setFromEuler(E(PI / 2, 0, 0)), V(ww, len * 0.16, hh));
      K.add(shell(1, 1, 1, PI / 2, PI, 28, 1), 'red', m);
      // borde dorado (arco en la cara trasera de cada lama)
      const arc = [];
      for (let k = 0; k <= 16; k++) { const a = PI / 2 + PI * k / 16; arc.push(V(cx + ww * Math.sin(a), box.min.y + hgt * 0.12 - hh * Math.cos(a), zc - len * 0.08)); }
      K.add(new THREE.TubeGeometry(CR(arc), 24, hgt * 0.022, 5, false), 'gold');
    }
    // Puntera afilada
    K.mesh(new THREE.ConeGeometry(1, 1, 24, 2), 'red', V(cx, box.min.y + hgt * 0.2, zt - len * 0.02), E(PI / 2, 0, 0), V(w * 0.4, len * 0.26, hgt * 0.32));
    K.mesh(new THREE.ConeGeometry(1, 1, 12), 'gold', V(cx, box.min.y + hgt * 0.22, zt + len * 0.1), E(PI / 2, 0, 0), V(w * 0.1, len * 0.1, hgt * 0.08));
    // Caña (tobillo) con escamas, filete y espolón
    const cuffH = hgt * 1.35;
    const cy = box.min.y + hgt * 0.5 + cuffH / 2;
    const czc = zb + len * 0.24;
    K.add(shell(0.5, 0.56, 1, 0, PI * 2, 36, 1), 'deep', new THREE.Matrix4().compose(V(cx, cy, czc), new THREE.Quaternion(), V(w, cuffH, w * 1.12)));
    K.scales(bandScales({ cx, cz: czc, rx: w * 0.5, rz: w * 0.56, y0: cy - cuffH / 2, y1: cy + cuffH / 2, rows: 4, cols: 11, taperTop: 0.9, lift: 1.06 }));
    K.add(arcTube(w * 0.55, w * 0.62, cy + cuffH / 2, 0, PI * 2, hgt * 0.04, cx, czc), 'gold');
    K.add(arcTube(w * 0.6, w * 0.66, cy - cuffH / 2, 0, PI * 2, hgt * 0.035, cx, czc), 'gold');
    K.add(taper(Q(V(cx, box.min.y + hgt * 0.45, zb + len * 0.05), V(cx, box.min.y + hgt * 0.3, zb - len * 0.12), V(cx, box.min.y + hgt * 0.05, zb - len * 0.26)), w * 0.12, w * 0.01, 10, 8), 'dark');
    // Aletas en el tobillo
    for (const sx of [-1, 1]) {
      const fin = finGeo((sh) => {
        sh.moveTo(0.1, 0); sh.quadraticCurveTo(-0.3, 0.3, -0.9, 0.55); sh.quadraticCurveTo(-0.55, 0.2, -0.85, 0.1);
        sh.quadraticCurveTo(-0.45, -0.05, -0.2, -0.15); sh.lineTo(0.1, 0);
      }, 0.05);
      const sc = w * 0.55;
      K.add(fin, 'red', new THREE.Matrix4().compose(V(cx + sx * w * 0.55, cy + cuffH * 0.1, czc), new THREE.Quaternion().setFromEuler(E(0, sx * -0.3, 0)), V(sc, sc, sc)));
    }
    const g = H.framed(basis);
    g.add(K.build());
    out.push({ bone: foot, mesh: g });
  }
  return out.length ? out : null;
}

// ------------------------------------------------------------
// GUANTELETES con garras (las garras van en los huesos de los dedos)
// ------------------------------------------------------------
function buildGloves(root, H) {
  const tn = H.tune('gloves');
  const PI = Math.PI;
  const out = [];
  for (const side of ['Left', 'Right']) {
    const hand = H.findBone(root, side + 'Hand');
    if (!hand) continue;
    const mid = H.childNamed(hand, side + 'HandMiddle1');
    const dir = mid ? mid.position.clone().normalize() : V(0, 1, 0);
    const basis = H.orient(dir, H.boneBasis(root, hand).fwd);
    const box = H.fitBox(H.boneVerts(root, [hand], hand), basis);
    if (!box) continue;
    const cx = (box.min.x + box.max.x) / 2, cz = (box.min.z + box.max.z) / 2;
    const w = (box.max.x - box.min.x) * 1.12 * tn.s, d = (box.max.z - box.min.z) * 1.2 * tn.s;
    const L = box.max.y - Math.max(box.min.y, 0);
    const K = new Kit();
    // Mano: bloque redondeado
    K.mesh(new THREE.CylinderGeometry(0.5, 0.52, 1, 28, 2), 'red', V(cx, L * 0.45, cz), null, V(w, L * 0.9, d));
    // Láminas de nudillos
    for (let i = 0; i < 3; i++) {
      K.mesh(new THREE.CylinderGeometry(0.53, 0.53, 1, 28, 1, true), 'gold', V(cx, L * (0.62 + i * 0.13), cz), null, V(w * (1.02 - i * 0.02), L * 0.035, d * (1.04 - i * 0.03)));
    }
    // Puño acampanado hacia el antebrazo
    const cuffH = L * 1.45;
    K.add(shell(0.52, 0.76, 1, 0, PI * 2, 40, 2), 'red', new THREE.Matrix4().compose(V(cx, -cuffH / 2 + L * 0.06, cz), new THREE.Quaternion(), V(w, cuffH, d)));
    K.scales(bandScales({ cx, cz, rx: w * 0.74, rz: d * 0.74, y0: -cuffH + L * 0.15, y1: L * 0.0, rows: 4, cols: 12, taperTop: 0.7, lift: 1.05 }).map(e => { e.up = V(0, -1, 0); return e; }));
    K.add(arcTube(w * 0.77, d * 0.77, -cuffH + L * 0.06, 0, PI * 2, L * 0.05, cx, cz), 'gold');
    K.add(arcTube(w * 0.53, d * 0.53, L * 0.04, 0, PI * 2, L * 0.035, cx, cz), 'gold');
    K.mesh(new THREE.IcosahedronGeometry(Math.min(w, d) * 0.18, 1), 'gem', V(cx, -cuffH * 0.42, cz + d * 0.66), null, V(1, 1.2, 0.6));
    const g = H.framed(basis);
    g.add(K.build());
    out.push({ bone: hand, mesh: g });

    // Dedos: placas en falanges 1-2 y garra en la 3ª (siguen la animación)
    for (const f of ['Index', 'Middle', 'Ring', 'Pinky', 'Thumb']) {
      for (let k = 1; k <= 3; k++) {
        const b = H.findBone(root, `${side}Hand${f}${k}`);
        if (!b) continue;
        const nx = H.findBone(root, `${side}Hand${f}${k + 1}`);
        const seg = nx ? nx.position.clone() : null;
        if (!seg || seg.lengthSq() < 1e-10) continue;
        const sl = seg.length();
        const dirB = seg.clone().normalize();
        const q = new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), dirB);
        const KF = new Kit();
        if (k < 3) {
          KF.add(new THREE.CylinderGeometry(sl * 0.36, sl * 0.4, sl * 0.9, 12, 1), 'red', new THREE.Matrix4().compose(dirB.clone().multiplyScalar(sl * 0.48), q, V(1, 1, 1)));
          KF.add(new THREE.TorusGeometry(sl * 0.4, sl * 0.06, 6, 16).rotateX(PI / 2), 'gold', new THREE.Matrix4().compose(dirB.clone().multiplyScalar(sl * 0.05), q, V(1, 1, 1)));
        } else {
          // Garra negra curva, sale más allá de la yema
          const c = taper(Q(V(0, 0, 0), V(0, sl * 1.0, sl * 0.04), V(0, sl * 1.7, -sl * 0.14)), sl * 0.34, sl * 0.02, 12, 8);
          KF.add(c, 'claw', new THREE.Matrix4().compose(V(), q, V(1, 1, 1)));
        }
        out.push({ bone: b, mesh: KF.build() });
      }
    }
  }
  return out.length ? out : null;
}

// ------------------------------------------------------------
// ESCUDO COMETA con emblema de dragón
// ------------------------------------------------------------
/** Sesión 51 — escudo de dragón CUADRADO y grande (rectángulo con esquinas
 *  redondeadas arriba y una punta corta abajo). Mantiene el nombre de la función. */
function kitePath(s, W, Hh, k = 1) {
  W *= k; Hh *= k;
  const r = W * 0.14;
  s.moveTo(-W + r, Hh);
  s.lineTo(W - r, Hh);
  s.quadraticCurveTo(W, Hh, W, Hh - r);
  s.lineTo(W, -Hh * 0.6);
  s.quadraticCurveTo(W * 0.98, -Hh * 0.84, W * 0.5, -Hh * 0.9);
  s.lineTo(0, -Hh);
  s.lineTo(-W * 0.5, -Hh * 0.9);
  s.quadraticCurveTo(-W * 0.98, -Hh * 0.84, -W, -Hh * 0.6);
  s.lineTo(-W, Hh - r);
  s.quadraticCurveTo(-W, Hh, -W + r, Hh);
}
function bendZ(geo, W, amount) {
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) { const x = p.getX(i) / W; p.setZ(i, p.getZ(i) - amount * x * x); }
  geo.computeVertexNormals();
  return geo;
}
function buildShield(root, H) {
  const tn = H.tune('shield');
  const PI = Math.PI;
  const fore = H.findBone(root, 'LeftForeArm');
  if (!fore) return null;
  const hand = H.childNamed(fore, 'LeftHand') || H.findBone(root, 'LeftHand');
  const len = hand ? hand.position.length() : 25;
  const axis = hand ? hand.position.clone().normalize() : V(0, 1, 0);
  let n = H.boneBasis(root, fore).up.clone();
  n.sub(axis.clone().multiplyScalar(n.dot(axis))).normalize();
  const basis = H.orient(n, axis);
  const box = H.fitBox(H.boneVerts(root, [fore], fore), H.orient(axis, n));
  const armR = box ? Math.max(box.max.x - box.min.x, box.max.z - box.min.z) / 2 : len * 0.2;
  const R = len * 1.15 * tn.s;
  const W = R * 0.86, Hh = R * 1.16, th = R * 0.06, bend = R * 0.12;
  const K = new Kit();
  // Cuerpo
  {
    const s = new THREE.Shape(); kitePath(s, W, Hh);
    const g = new THREE.ExtrudeGeometry(s, { depth: th, bevelEnabled: true, bevelThickness: th * 0.5, bevelSize: th * 0.6, bevelSegments: 3, curveSegments: 28 });
    K.add(bendZ(g, W, bend), 'red');
  }
  // Borde de oro (marco)
  {
    const s = new THREE.Shape(); kitePath(s, W, Hh, 1.0);
    const hole = new THREE.Path(); kitePath(hole, W, Hh, 0.88);
    s.holes.push(hole);
    const g = new THREE.ExtrudeGeometry(s, { depth: th * 1.5, bevelEnabled: true, bevelThickness: th * 0.3, bevelSize: th * 0.25, bevelSegments: 2, curveSegments: 28 });
    g.translate(0, 0, th * 0.1);
    K.add(bendZ(g, W, bend), 'gold');
  }
  // Escamas sobre la cara (dentro del marco)
  {
    const s = new THREE.Shape(); kitePath(s, W, Hh, 0.84);
    const poly = s.getSpacedPoints(80).map(p => [p.x, p.y]);
    const inside = (x, y) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, yi] = poly[i], [xj, yj] = poly[j]; if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) c = !c; } return c; };
    const list = [];
    const rows = 12, dy = (Hh * 1.7) / rows, cols = 9, dx = (W * 2) / cols;
    for (let r = 0; r < rows; r++) {
      const y = Hh * 0.7 - (r + 0.5) * dy;
      for (let c = 0; c <= cols; c++) {
        const x = -W + (c + (r % 2) * 0.5) * dx;
        if (!inside(x, y)) continue;
        const zf = th * 1.5 - bend * (x / W) ** 2 + (rows - r) * th * 0.02;
        const nrm = V(2 * bend * x / (W * W), 0, 1).normalize();
        list.push({ p: V(x, y, zf), n: nrm, up: V(0, 1, 0), w: dx * 0.62, h: dy * 0.66, tilt: 0.25 });
      }
    }
    K.scales(list);
  }
  // Emblema: medallón, gema, alas, cuernos y cola
  const ez = th * 2.2;
  K.mesh(new THREE.CylinderGeometry(R * 0.2, R * 0.22, th * 1.2, 40), 'gold', V(0, Hh * 0.08, ez), E(PI / 2, 0, 0));
  K.mesh(new THREE.TorusGeometry(R * 0.16, R * 0.022, 8, 36), 'dark', V(0, Hh * 0.08, ez + th * 0.65));
  K.mesh(new THREE.IcosahedronGeometry(R * 0.11, 2), 'gem', V(0, Hh * 0.08, ez + th * 0.9), null, V(1, 1.15, 0.6));
  for (const sx of [-1, 1]) {
    // Ala espejada en las coordenadas (ExtrudeGeometry corrige el sentido)
    const k = R * 0.55, ox = sx * R * 0.17, oy = Hh * 0.12;
    const P2 = (x, y) => [ox + sx * x * k, oy + y * k];
    const wing = new THREE.Shape();
    wing.moveTo(...P2(0, 0));
    wing.quadraticCurveTo(...P2(0.35, 0.55), ...P2(0.95, 0.9));
    wing.quadraticCurveTo(...P2(0.8, 0.55), ...P2(0.92, 0.42));
    wing.quadraticCurveTo(...P2(0.7, 0.32), ...P2(0.86, 0.12));
    wing.quadraticCurveTo(...P2(0.6, 0.06), ...P2(0.72, -0.16));
    wing.quadraticCurveTo(...P2(0.4, -0.08), ...P2(0.1, -0.12));
    wing.lineTo(...P2(0, 0));
    const g = new THREE.ExtrudeGeometry(wing, { depth: th * 0.5, bevelEnabled: true, bevelThickness: th * 0.2, bevelSize: th * 0.2, bevelSegments: 2, curveSegments: 12 });
    g.translate(0, 0, ez - th * 0.2);
    K.add(g, 'gold');
    // cuernos
    K.add(taper(Q(V(sx * R * 0.1, Hh * 0.08 + R * 0.18, ez), V(sx * R * 0.18, Hh * 0.08 + R * 0.42, ez + th), V(sx * R * 0.05, Hh * 0.08 + R * 0.6, ez + th * 1.2)), R * 0.045, R * 0.004, 12, 7), 'gold');
  }
  // Cola en espiral hacia la punta
  {
    const pts = [];
    for (let i = 0; i <= 24; i++) {
      const t = i / 24;
      const y = Hh * 0.08 - R * 0.2 - t * (Hh * 0.8);
      const x = Math.sin(t * PI * 2.2) * R * 0.14 * (1 - t * 0.6);
      pts.push(V(x, y, ez - bend * (x / W) ** 2));
    }
    K.add(taper(CR(pts), R * 0.05, R * 0.006, 48, 7), 'gold');
  }
  // Remaches del marco
  {
    const s = new THREE.Shape(); kitePath(s, W, Hh, 0.94);
    for (const p of s.getSpacedPoints(22).slice(0, 22)) K.mesh(new THREE.SphereGeometry(R * 0.025, 8, 6), 'dark', V(p.x, p.y, th * 1.9 - bend * (p.x / W) ** 2));
  }
  // Asa (detrás) — 2 correas oscuras
  K.mesh(new THREE.BoxGeometry(R * 0.5, R * 0.08, th * 2), 'dark', V(0, Hh * 0.05, -th * 1.4));
  K.mesh(new THREE.BoxGeometry(R * 0.5, R * 0.08, th * 2), 'dark', V(0, -Hh * 0.35, -th * 1.4));

  const u = K.build();
  // Forma en el plano XY (y = arriba del escudo) → y = normal del escudo, punta hacia la mano
  u.rotation.x = -PI / 2;
  const holder = new THREE.Group();
  holder.position.set(0, armR * 1.15 + th * 2 + len * tn.y, len * (0.5 + tn.z));
  holder.add(u);
  const g = H.framed(basis);
  g.add(holder);
  return [{ bone: fore, mesh: g }];
}

export function buildDragonArmor(slot, root, H) {
  if (slot === 'helm') return buildHelm(root, H);
  if (slot === 'body') return buildBody(root, H);
  if (slot === 'legs') return buildLegs(root, H);
  if (slot === 'boots') return buildBoots(root, H);
  if (slot === 'gloves') return buildGloves(root, H);
  if (slot === 'shield') return buildShield(root, H);
  return null;
}
