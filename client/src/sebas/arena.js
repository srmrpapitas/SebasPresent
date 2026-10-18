/**
 * SEBAS PRESENT — escenarios del modo historia (piezas low-poly fundidas por material).
 * buildArena(theme) → { group, boxes: [{x,z,hx,hz}], circles: [{x,z,r}], hw, hd, sky, fog, spawns }
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const HW = 22, HD = 15;   // medio ancho / medio fondo de la zona jugable

class Kit {
  constructor() { this.parts = new Map(); this.o = new THREE.Object3D(); this.extra = []; }
  push(geom, mat, x, y, z, ry = 0, rx = 0, rz = 0) {
    const o = this.o; o.position.set(x, y, z); o.rotation.set(rx, ry, rz); o.scale.set(1, 1, 1); o.updateMatrix();
    const g = geom.index ? geom.toNonIndexed() : geom.clone(); g.applyMatrix4(o.matrix);
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
    if (!this.parts.has(mat)) this.parts.set(mat, []); this.parts.get(mat).push(g); return this;
  }
  box(w, h, d, m, x, y, z, ry = 0) { return this.push(new THREE.BoxGeometry(w, h, d), m, x, y, z, ry); }
  cyl(rt, rb, h, m, x, y, z, seg = 10) { return this.push(new THREE.CylinderGeometry(rt, rb, h, seg), m, x, y, z); }
  ico(r, m, x, y, z) { return this.push(new THREE.IcosahedronGeometry(r, 0), m, x, y, z); }
  cone(r, h, m, x, y, z, seg = 8, rz = 0) { return this.push(new THREE.ConeGeometry(r, h, seg), m, x, y, z, 0, 0, rz); }
  build() {
    const g = new THREE.Group();
    for (const [m, l] of this.parts) { const mg = mergeGeometries(l, false); l.forEach(x => x.dispose()); if (mg) { const me = new THREE.Mesh(mg, m); me.matrixAutoUpdate = false; me.receiveShadow = true; g.add(me); } }
    for (const e of this.extra) g.add(e);
    return g;
  }
}
const L = (c, e = {}) => new THREE.MeshLambertMaterial({ color: c, flatShading: true, ...e });
const GLOW = (c, i = 1) => new THREE.MeshLambertMaterial({ color: c, emissive: c, emissiveIntensity: i, flatShading: true });

function textPlane(text, w, h, bg, fg, font = 'bold 64px sans-serif') {
  const c = document.createElement('canvas'); c.width = 512; c.height = Math.round(512 * h / w);
  const g = c.getContext('2d'); g.fillStyle = bg; g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = fg; g.font = font; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, c.width / 2, c.height / 2);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: t }));
}
function palm(k, x, z, h, M) {
  for (let i = 0; i < 6; i++) k.cyl(0.2, 0.24, h / 6 + 0.05, M.trunk, x + i * 0.05, h * i / 6 + h / 12, z);
  for (let i = 0; i < 7; i++) { const a = i / 7 * Math.PI * 2; k.push(new THREE.ConeGeometry(0.4, 3, 4), M.leaf, x + Math.cos(a) * 1.3, h, z + Math.sin(a) * 1.3, -a + Math.PI / 2, 0, -1.25); }
}

export function buildArena(theme) {
  const k = new Kit(), boxes = [], circles = [];
  const solid = (w, d, m, x, z, h = 1.2, y = null) => { k.box(w, h, d, m, x, y ?? h / 2, z); boxes.push({ x, z, hx: w / 2, hz: d / 2 }); };
  const round = (r, m, x, z, h = 1.2) => { k.cyl(r, r, h, m, x, h / 2, z, 12); circles.push({ x, z, r }); };
  const M = { trunk: L(0x6a4a2a), leaf: L(0x3f7a34) };
  let sky = 0x87b8d8, fog = [30, 90], floorC = 0x9a9a9a;
  const W = HW * 2 + 8, D = HD * 2 + 8;
  const edge = (m, h = 1.0) => {   // bordillo/borde del escenario
    k.box(W, h, 0.6, m, 0, h / 2, -HD - 0.6); k.box(W, h, 0.6, m, 0, h / 2, HD + 0.6);
    k.box(0.6, h, D, m, -HW - 0.6, h / 2, 0); k.box(0.6, h, D, m, HW + 0.6, h / 2, 0);
  };

  if (theme === 'airport') {
    sky = 0xbfd8ea; floorC = 0xd8d4cc;
    const tile = L(0xc8c2b6), tile2 = L(0xe6e2da), glass = L(0x9cc8e0, { transparent: true, opacity: 0.55 }), steel = L(0x8a9098), blue = L(0x2f5aa0), red = L(0xb83a2a);
    for (let x = -HW; x < HW; x += 4) for (let z = -HD; z < HD; z += 4) k.box(3.96, 0.05, 3.96, ((x + z) / 4) % 2 ? tile : tile2, x + 2, 0.02, z + 2);
    k.box(W, 7, 0.4, glass, 0, 3.5, -HD - 1); k.box(W, 0.4, 0.6, steel, 0, 7, -HD - 1);
    for (let x = -HW; x <= HW; x += 6) k.box(0.3, 7, 0.5, steel, x, 3.5, -HD - 1);
    for (const x of [-12, 0, 12]) { round(0.7, steel, x, -4, 6); }
    for (const x of [-15, -5, 5, 15]) { solid(4, 1.2, blue, x, 9, 1.1); k.box(4, 0.08, 1.2, steel, x, 1.14, 9); }   // mostradores de facturación
    const sign = textPlane('LLEGADAS · ARRIVALS', 10, 1.4, '#2f5aa0', '#ffffff', 'bold 52px sans-serif'); sign.position.set(0, 5.5, -HD - 0.7); k.extra.push(sign);
    const tf = textPlane('TENERIFE SUR · REINA SOFÍA', 12, 1.3, '#f2c230', '#1a1a1a', 'bold 44px sans-serif'); tf.position.set(0, 5.5, HD + 0.9); tf.rotation.y = Math.PI; k.extra.push(tf);
    for (const [x, z] of [[-8, 2], [9, -9], [16, 3]]) { solid(1.0, 2.2, steel, x, z, 0.8); k.box(0.7, 0.7, 1, red, x, 1.15, z - 0.4); k.box(0.6, 0.5, 0.9, blue, x, 1.1, z + 0.6); }   // carros de maletas
    for (const [x, z] of [[-HW + 2, -HD + 2], [HW - 2, -HD + 2], [-HW + 2, HD - 2], [HW - 2, HD - 2]]) { k.cyl(0.6, 0.5, 0.9, red, x, 0.45, z); palm(k, x, z, 3.2, M); circles.push({ x, z, r: 0.7 }); }
    edge(steel, 0.3);
  } else if (theme === 'neon') {
    sky = 0x0e0a1e; fog = [18, 60]; floorC = 0x2a2830;
    const asph = L(0x26242c), side = L(0x4a4650), wall = L(0x3a3040), pink = GLOW(0xff3fa8, 1.2), cyan = GLOW(0x30e0ff, 1.2), yellow = GLOW(0xffd030, 1.1), wood = L(0x5a3a22);
    k.box(W, 0.05, D, asph, 0, 0.01, 0);
    for (let x = -HW; x < HW; x += 3) k.box(1.4, 0.06, 0.2, yellow, x, 0.04, 0);
    // fachadas de bares
    const BARS = [['MOJITO BAR', pink], ['DISCO 2000', cyan], ['COCKTAILS', yellow], ['KARAOKE', pink]];
    BARS.forEach(([n, mat], i) => {
      const x = -HW + 5 + i * 11;
      k.box(10, 6, 2, wall, x, 3, -HD - 1.6); k.box(2, 3, 0.2, L(0x120a14), x, 1.5, -HD - 0.55);
      k.box(9, 0.25, 0.3, mat, x, 4.4, -HD - 0.5);
      const t = textPlane(n, 7, 1.2, '#140a18', mat === pink ? '#ff60c0' : mat === cyan ? '#60f0ff' : '#ffe060', 'bold 70px sans-serif'); t.position.set(x, 5.2, -HD - 0.48); k.extra.push(t);
    });
    for (const [x, z] of [[-14, -6], [-6, -8], [6, -7], [15, -5]]) { round(0.6, wood, x, z, 0.75); k.cyl(0.9, 0.9, 0.06, wood, x, 0.78, z); }   // mesas
    for (let x = -HW + 2; x < HW; x += 8) { k.cyl(0.08, 0.08, 4.5, side, x, 2.25, HD - 1); k.box(0.4, 0.4, 0.4, cyan, x, 4.6, HD - 1); circles.push({ x, z: HD - 1, r: 0.2 }); }
    edge(side, 0.25);
  } else if (theme === 'paseo') {
    sky = 0xf0b88a; fog = [30, 90]; floorC = 0xd6c29a;
    const tile = L(0xc9b48c), tile2 = L(0xd9c6a0), sand = L(0xe2cd94), rail = L(0xf0f0f0), awning = L(0xd84a3a), awning2 = L(0x3a8ad8), wood = L(0x8a5a32), sea = L(0x2a6aa8);
    for (let x = -HW; x < HW; x += 2) k.box(1.98, 0.05, D, (x / 2) % 2 ? tile : tile2, x + 1, 0.02, 0);
    k.box(W + 40, 0.04, 30, sand, 0, -0.02, HD + 16); k.box(W + 80, 0.02, 60, sea, 0, -0.06, HD + 40);
    for (let x = -HW; x <= HW; x += 2) k.box(0.1, 1.0, 0.1, rail, x, 0.5, HD + 0.3); k.box(W, 0.1, 0.12, rail, 0, 1.0, HD + 0.3);
    [-15, -5, 5, 15].forEach((x, i) => { solid(4, 2, wood, x, -9, 1.0); for (let j = 0; j < 4; j++) k.box(1.05, 0.12, 2.6, j % 2 ? awning : (i % 2 ? awning2 : rail), x - 1.5 + j, 2.6, -9); for (const s of [-1.9, 1.9]) k.box(0.12, 2.6, 0.12, wood, x + s, 1.3, -10); });
    for (const x of [-HW + 3, -8, 8, HW - 3]) { palm(k, x, 4, 6, M); circles.push({ x, z: 4, r: 0.35 }); }
    const t = textPlane('CHOCOLATE · 100 PTS', 6, 1, '#6a3a1a', '#ffe0a0', 'bold 56px sans-serif'); t.position.set(-5, 3.4, -7.9); k.extra.push(t);
    edge(rail, 0.2);
  } else if (theme === 'docks') {
    sky = 0x9ac8e8; fog = [30, 100]; floorC = 0x8a6a48;
    const plank = L(0x8a6a48), plank2 = L(0x7a5a3a), sea = L(0x2a5a8a), white = L(0xf2f2f2), navy = L(0x1a2a4a), metal = L(0x6a6a70), crateM = L(0xa07a48), red = L(0xb0302a);
    for (let x = -HW; x < HW; x += 1.2) k.box(1.15, 0.2, D, (Math.round(x / 1.2)) % 2 ? plank : plank2, x + 0.6, 0.0, 0);
    k.box(W + 120, 0.02, D + 120, sea, 0, -0.5, 0);
    for (let x = -HW; x <= HW; x += 6) for (const z of [-HD - 0.5, HD + 0.5]) { k.cyl(0.35, 0.35, 0.8, metal, x, 0.5, z); }
    // yates
    for (const [x, z, s] of [[-12, -HD - 7, 1], [10, -HD - 8, 1.3], [-4, HD + 8, 1.1]]) {
      k.box(5 * s, 1.6 * s, 14 * s, white, x, 0.3, z); k.cone(2.5 * s, 4 * s, white, x, 0.3, z + 8.6 * s, 4, Math.PI / 2);
      k.box(4 * s, 1.6 * s, 6 * s, white, x, 1.9 * s, z - 1); k.box(3.8 * s, 0.5 * s, 5.6 * s, navy, x, 2.2 * s, z - 1); k.cyl(0.06, 0.06, 7 * s, metal, x, 4, z - 2);
    }
    for (const [x, z, sz] of [[-14, -3, 1.6], [-12.5, -3.4, 1.2], [6, 5, 1.6], [7.6, 4.6, 1.2], [14, -6, 2], [-3, 8, 1.4]]) solid(sz, sz, crateM, x, z, sz);
    for (const [x, z] of [[-6, -6], [12, 7]]) { round(0.5, red, x, z, 1.1); }
    edge(plank2, 0.3);
  } else if (theme === 'carnaval') {
    sky = 0x5a3a8a; fog = [25, 80]; floorC = 0x8a7a6a;
    const cobble = L(0x8a7a6a), cobble2 = L(0x9a8a78), house = [L(0xe8c040), L(0x40b0e0), L(0xe06080), L(0x60c060), L(0xf08a30)], flag = [GLOW(0xff4060, 0.5), GLOW(0x40ff80, 0.5), GLOW(0x40a0ff, 0.5), GLOW(0xffe040, 0.5)], white = L(0xf2f2f2);
    for (let x = -HW; x < HW; x += 2) for (let z = -HD; z < HD; z += 2) k.box(1.9, 0.06, 1.9, ((x + z) / 2) % 2 ? cobble : cobble2, x + 1, 0.02, z + 1);
    for (let i = 0; i < 8; i++) { k.box(5.4, 7 + (i % 3), 4, house[i % 5], -HW + 2.8 + i * 5.6, 3.6, -HD - 2.4); k.box(1.2, 2, 0.1, L(0x3a2a1a), -HW + 2.8 + i * 5.6, 1, -HD - 0.38); }
    for (let i = 0; i < 8; i++) k.box(5.4, 6 + ((i + 1) % 3), 4, house[(i + 2) % 5], -HW + 2.8 + i * 5.6, 3.2, HD + 2.4);
    for (let x = -HW; x < HW; x += 1.1) for (const z of [-6, 0, 6]) k.cone(0.3, 0.6, flag[Math.abs(Math.round(x + z)) % 4], x, 6.2 - Math.abs(Math.sin(x / 3)) * 0.6, z, 3, Math.PI);
    // carroza
    solid(6, 3, house[2], 8, 6, 1.6); k.cyl(1.4, 1.4, 2.2, house[0], 8, 2.7, 6); k.ico(1.2, flag[1], 8, 4.2, 6);
    solid(3, 3, white, -10, -5, 1.0);
    edge(cobble, 0.2);
  } else if (theme === 'sanisidro') {
    sky = 0xd8c8a0; fog = [30, 90]; floorC = 0xb8a888;
    const ground = L(0xb8a888), conc = L(0x9a9590), cont = [L(0xb03a2a), L(0x2a6ab0), L(0x3a8a3a), L(0xd8a030)], pallet = L(0xa0784a), white = L(0xf0ece2), green = L(0x2f6a3a);
    k.box(W, 0.05, D, ground, 0, 0.01, 0);
    for (const [x, z, r, c] of [[-14, -8, 0, 0], [-14, -5.4, 0, 1], [13, 8, 0, 2], [15, -7, 1, 3], [0, -HD + 2, 0, 1]]) {
      const w = r ? 2.5 : 6, d = r ? 6 : 2.5; solid(w, d, cont[c], x, z, 2.6);
    }
    for (const [x, z] of [[-4, 4], [-3, 5.3], [6, -4], [3, 9]]) solid(1.2, 1.2, pallet, x, z, 0.3);
    // casitas blancas al fondo (San Isidro)
    for (let i = 0; i < 6; i++) { k.box(6, 4, 5, white, -HW + 4 + i * 7.5, 2, -HD - 4.5); k.box(1.2, 2, 0.1, green, -HW + 4 + i * 7.5, 1, -HD - 1.95); k.box(1.2, 1, 0.1, L(0x7fb4d8), -HW + 5.8 + i * 7.5, 2.5, -HD - 1.95); }
    const t = textPlane('SAN ISIDRO', 6, 1.2, '#f0ece2', '#2f6a3a', 'bold 80px sans-serif'); t.position.set(0, 2.2, -HD + 0.9); k.extra.push(t);
    for (const x of [-HW + 2, HW - 2]) { palm(k, x, HD - 2, 5.5, M); circles.push({ x, z: HD - 2, r: 0.35 }); }
    edge(conc, 0.3);
  } else if (theme === 'plato') {
    sky = 0x08060c; fog = [22, 70]; floorC = 0x1a1820;
    const fl = L(0x22202a), fl2 = L(0x2c2834), stage = L(0x5a1a3a), gold = GLOW(0xffc040, 0.6), red = L(0x8a1a1a), metal = L(0x4a4a52), cam = L(0x2a2a2a), spot = GLOW(0xfff0c0, 1.4);
    for (let x = -HW; x < HW; x += 2) for (let z = -HD; z < HD; z += 2) k.box(1.96, 0.04, 1.96, ((x + z) / 2) % 2 ? fl : fl2, x + 1, 0.02, z + 1);
    k.box(18, 0.6, 6, stage, 0, 0.3, -HD + 2); k.box(18.4, 0.1, 6.4, gold, 0, 0.62, -HD + 2); boxes.push({ x: 0, z: -HD + 2, hx: 9, hz: 3 });
    const t = textPlane('¡EL SHOW DEL MEDIODÍA!', 14, 2, '#3a0a24', '#ffd060', 'bold 60px serif'); t.position.set(0, 5, -HD - 0.6); k.extra.push(t);
    for (let i = 0; i < 7; i++) k.box(1.6, 3.2, 0.2, red, -HW + 3 + i * 7, 1.6, -HD - 0.8);   // telón
    for (let r = 0; r < 3; r++) for (let i = 0; i < 12; i++) k.box(1.2, 0.5 + r * 0.4, 1.2, red, -HW + 3 + i * 3.6, 0.25 + r * 0.2, HD - 1 - r * 0.2 + r * 1.4);
    for (const [x, z] of [[-12, 2], [12, 2], [7, 9]]) { round(0.4, metal, x, z, 1.4); k.box(1.2, 0.8, 1.6, cam, x, 1.8, z); k.cyl(0.25, 0.3, 0.6, cam, x, 1.8, z - 1.1); }
    for (let x = -HW; x <= HW; x += 7) { k.box(0.5, 0.5, 0.5, spot, x, 9, -4); k.box(0.2, 0.2, 30, metal, x, 9.4, 0); }
    edge(metal, 0.2);
  }

  const floor = new THREE.Mesh(new THREE.PlaneGeometry(W + 60, D + 60), L(floorC));
  floor.rotation.x = -Math.PI / 2; floor.position.y = -0.03;
  const group = k.build(); group.add(floor);
  const spawns = [];
  for (let i = 0; i < 10; i++) { const x = -HW + 2 + (i % 5) * (HW * 2 - 4) / 4; spawns.push({ x, z: i < 5 ? -HD + 1 : HD - 1 }); }
  spawns.push({ x: -HW + 1, z: 0 }, { x: HW - 1, z: 0 });
  return { group, boxes, circles, hw: HW, hd: HD, sky, fog, spawns };
}
