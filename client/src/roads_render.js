/**
 * SebasPresent — Caminos: la cinta de tierra y los postes indicadores (Sesión 50)
 * Datos en shared/roads.js. Estático: se construye una vez.
 *   · Cinta con borde más oscuro y centro pisado, tintada según el bioma.
 *   · En cada pueblo un poste con una flecha por camino ("Güímar · 1,5 km").
 *   · A mitad de cada tramo, un poste con las dos direcciones.
 */
import * as THREE from 'three';
import { getRoads, roadsFrom, ROAD_NODES, ROAD_HALF_W } from './shared/roads.js';

let scene = null;
let group = null;

const TINT = {
  snow: [0.80, 0.80, 0.78], desert: [0.78, 0.66, 0.47], beach: [0.84, 0.77, 0.58],
  wilderness: [0.40, 0.34, 0.30], swamp: [0.45, 0.40, 0.30], jungle: [0.55, 0.43, 0.30],
};
const DIRT = [0.62, 0.49, 0.33];

function ribbon(pts, half, y, colorFn, edgeDark) {
  const pos = [], col = [], idx = [];
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    let tx = b[0] - a[0], tz = b[1] - a[1]; const L = Math.hypot(tx, tz) || 1; tx /= L; tz /= L;
    const nx = -tz, nz = tx;
    const c = colorFn(p[0], p[1]);
    const n = ((Math.sin(i * 12.9898) * 43758.5453) % 1 + 1) % 1 * 0.06 - 0.03;
    // 3 columnas: borde, centro, borde
    for (const [off, k] of [[-half, edgeDark], [0, 1.06], [half, edgeDark]]) {
      pos.push(p[0] + nx * off, y, p[1] + nz * off);
      col.push(Math.min(1, c[0] * k + n), Math.min(1, c[1] * k + n), Math.min(1, c[2] * k + n));
    }
    if (i > 0) {
      const s = (i - 1) * 3, t = i * 3;
      idx.push(s, s + 1, t, t, s + 1, t + 1, s + 1, s + 2, t + 1, t + 1, s + 2, t + 2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function boardTexture(text, sub) {
  const c = document.createElement('canvas'); c.width = 512; c.height = 128;
  const x = c.getContext('2d');
  x.fillStyle = '#e8d7ae'; x.fillRect(0, 0, 512, 128);
  x.strokeStyle = '#5a3a1c'; x.lineWidth = 8; x.strokeRect(4, 4, 504, 120);
  x.fillStyle = '#2a1a0a'; x.textAlign = 'center'; x.textBaseline = 'middle';
  let fs = 52; x.font = `bold ${fs}px sans-serif`;
  while (x.measureText(text).width > 470 && fs > 26) { fs -= 2; x.font = `bold ${fs}px sans-serif`; }
  x.fillText(text, 256, sub ? 50 : 64);
  if (sub) { x.font = 'bold 30px sans-serif'; x.fillStyle = '#5a3a1c'; x.fillText(sub, 256, 100); }
  const t = new THREE.CanvasTexture(c); t.anisotropy = 2;
  return t;
}
const km = (m) => m >= 1000 ? `${(m / 1000).toFixed(1).replace('.', ',')} km` : `${Math.round(m / 10) * 10} m`;

const woodM = new THREE.MeshLambertMaterial({ color: 0x5a3a1c, flatShading: true });
const stoneM = new THREE.MeshLambertMaterial({ color: 0x6e675c, flatShading: true });

/** Poste con flechas. arms: [{ name, sub, dir:[dx,dz] }] */
function signpost(x, z, arms) {
  const g = new THREE.Group(); g.position.set(x, 0, z);
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.6, 0.4, 7), stoneM); base.position.y = 0.2; g.add(base);
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 3.6 + arms.length * 0.15, 6), woodM);
  post.position.y = (3.6 + arms.length * 0.15) / 2; g.add(post);
  arms.forEach((a, i) => {
    const arm = new THREE.Group();
    arm.position.y = 3.3 - i * 0.62 + arms.length * 0.15;
    // la flecha apunta a +X local → girar hacia la dirección del camino
    arm.rotation.y = Math.atan2(-a.dir[1], a.dir[0]);
    const W = 2.3, H = 0.5;
    const plank = new THREE.Mesh(new THREE.BoxGeometry(W, H, 0.07), woodM); plank.position.x = W / 2 + 0.1; arm.add(plank);
    const tip = new THREE.Mesh(new THREE.CylinderGeometry(0.001, H * 0.62, 0.07, 3), woodM);
    tip.rotation.set(Math.PI / 2, 0, -Math.PI / 2); tip.position.x = W + 0.1 + 0.18; arm.add(tip);
    const tex = boardTexture(a.name, a.sub);
    const mat = new THREE.MeshBasicMaterial({ map: tex });
    const front = new THREE.Mesh(new THREE.PlaneGeometry(W - 0.1, H - 0.06), mat); front.position.set(W / 2 + 0.1, 0, 0.04); arm.add(front);
    const back = new THREE.Mesh(new THREE.PlaneGeometry(W - 0.1, H - 0.06), mat); back.position.set(W / 2 + 0.1, 0, -0.04); back.rotation.y = Math.PI; arm.add(back);
    g.add(arm);
  });
  return g;
}

export function start(opts) {
  stop();
  scene = opts.scene;
  const biomeAt = opts.biomeAt || (() => ({ id: 'plains' }));
  group = new THREE.Group(); group.userData.kind = 'roads';
  const colorAt = (x, z) => TINT[biomeAt(x, z)?.id] || DIRT;
  const matRoad = new THREE.MeshLambertMaterial({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const matEdge = new THREE.MeshLambertMaterial({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
  for (const r of getRoads()) {
    const edge = new THREE.Mesh(ribbon(r.pts, ROAD_HALF_W + 0.55, 0.03, colorAt, 0.62), matEdge);
    const road = new THREE.Mesh(ribbon(r.pts, ROAD_HALF_W, 0.045, colorAt, 0.9), matRoad);
    edge.renderOrder = 1; road.renderOrder = 2;
    group.add(edge, road);
  }
  // Postes en cada pueblo (fuera del camino, en el hueco más grande entre caminos)
  for (const [id, n] of Object.entries(ROAD_NODES)) {
    const out = roadsFrom(id);
    if (!out.length) continue;
    const angs = out.map(o => Math.atan2(o.dir[1], o.dir[0])).sort((a, b) => a - b);
    let bestGap = -1, bestAng = 0;
    for (let i = 0; i < angs.length; i++) {
      const a0 = angs[i], a1 = i + 1 < angs.length ? angs[i + 1] : angs[0] + Math.PI * 2;
      if (a1 - a0 > bestGap) { bestGap = a1 - a0; bestAng = (a0 + a1) / 2; }
    }
    const R = 13;
    const arms = out.map(o => ({ name: o.name, sub: km(o.len), dir: o.dir }));
    group.add(signpost(n.x + Math.cos(bestAng) * R, n.z + Math.sin(bestAng) * R, arms));
  }
  // Poste a mitad de cada tramo
  for (const r of getRoads()) {
    const m = Math.floor(r.pts.length / 2);
    const p = r.pts[m], q = r.pts[m + 1] || r.pts[m - 1];
    let tx = q[0] - p[0], tz = q[1] - p[1]; const L = Math.hypot(tx, tz) || 1; tx /= L; tz /= L;
    let lenA = 0, lenB = 0;
    for (let i = 1; i <= m; i++) lenA += Math.hypot(r.pts[i][0] - r.pts[i - 1][0], r.pts[i][1] - r.pts[i - 1][1]);
    for (let i = m + 1; i < r.pts.length; i++) lenB += Math.hypot(r.pts[i][0] - r.pts[i - 1][0], r.pts[i][1] - r.pts[i - 1][1]);
    const side = ROAD_HALF_W + 1.6;
    group.add(signpost(p[0] - tz * side, p[1] + tx * side, [
      { name: ROAD_NODES[r.b].name, sub: km(lenB), dir: [tx, tz] },
      { name: ROAD_NODES[r.a].name, sub: km(lenA), dir: [-tx, -tz] },
    ]));
  }
  scene.add(group);
}

export function stop() {
  if (group && scene) {
    scene.remove(group);
    group.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material?.map) o.material.map.dispose(); });
  }
  group = null;
}
