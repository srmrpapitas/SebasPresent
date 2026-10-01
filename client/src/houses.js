/**
 * SebasPresent — Casas de jugador y urbanizaciones (Sesión 50)
 *
 * FUERA: en 8 pueblos hay una "urbanización": casitas canarias blancas con
 * tejado de teja, puertas y ventanas verdes y balcón de madera. La del
 * cartel 🏠 es la puerta a TU casa: la tocas y entras.
 *
 * DENTRO: tu casa vive en HOUSE_CENTER (lejos del mapa) y se monta según el
 * nivel que compraste a Nauzet (cueva / terrera / casona). Muebles útiles:
 *   🛏 cama  → vida al máximo (cada 5 min)
 *   📦 cofre → tu banco
 *   ✦ altar  → recarga la plegaria
 * Se usa la sala de interiors.js (enterRoom): mismo botón "Salir" y al salir
 * vuelves a la puerta por la que entraste.
 */
import * as THREE from 'three';
import * as api from './api.js';
import * as interiors from './interiors.js';
import { hangingLine } from './item_tex.js';   // tendedero del porche
import { CASONAS, CASONA_W, CASONA_D } from './shared/casonas.js';   // casonas del banco
import { puebloHouses } from './shared/pueblo_blanco.js';          // Arico, el pueblo blanco
import {
  HOUSE_PORTALS, HOUSE_TIERS, HOUSE_CENTER, HOUSE_PORTAL_USE_M,
} from './shared/houses.js';

let scene = null, camera = null, canvas = null;
let getPlayer = () => null;
let setPlayerTarget = () => {};
let feedLog = () => {};
let onOpenBank = () => {};
let started = false;

let exterior = null;           // grupo con todas las urbanizaciones
const colliders = [];          // OBB {x,z,c,s,hx,hz}
const portalHits = [];         // meshes tocables (puerta a tu casa)
let pendingPortal = null;

let myTier = null;             // nivel de mi casa (o null)
let tierLoaded = false;

// Interior actual
let inside = null;             // { group, floor, tier, items:[{kind,x,z,r,mesh}], colliders:[] }
let pendingUse = null;
let fireLight = null, t = 0;

// ============================================================
// Materiales (compartidos)
// ============================================================
const M = {};
function mats() {
  if (M.wall) return M;
  const L = (c, o = {}) => new THREE.MeshLambertMaterial({ color: c, flatShading: true, ...o });
  M.wall = L(0xf2eee4); M.wallShade = L(0xd8d2c4); M.stone = L(0x6e675c); M.stoneD = L(0x514a42);
  M.teja = L(0xb4502e); M.tejaD = L(0x8e3c22); M.green = L(0x2f6a3a); M.greenD = L(0x224e2a);
  M.wood = L(0x6a4526); M.woodL = L(0x9a6a3a); M.woodD = L(0x3e2814); M.glass = L(0x2a3a44);
  M.floorWood = L(0x8a5e34); M.floorDirt = L(0x7a6448); M.rock = L(0x7c6a56); M.rockD = L(0x5e4e3e);
  M.cloth = L(0xb8342e); M.clothB = L(0x2e4e8a); M.white = L(0xf4f0e6); M.straw = L(0xc8a860);
  M.gold = new THREE.MeshStandardMaterial({ color: 0xe0b040, metalness: 0.8, roughness: 0.35, flatShading: true });
  M.iron = L(0x33353a); M.leaf = L(0x3f7a2e); M.pot = L(0xa4552e); M.fire = new THREE.MeshBasicMaterial({ color: 0xffa030 });
  M.blue = L(0x2a5a9a); M.blueD = L(0x1c3e6a); M.lava = L(0x2a2624); M.cactus = L(0x4a7a3a); M.palm = L(0x7a5a36);
  M.glow = new THREE.MeshBasicMaterial({ color: 0x9fe8ff, transparent: true, opacity: 0.7 });
  M.hit = new THREE.MeshBasicMaterial({ visible: false });
  return M;
}
const box = (w, h, d, m, x = 0, y = 0, z = 0) => { const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); b.position.set(x, y, z); return b; };

function signTexture(text, sub) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#f4ecd4'; g.fillRect(0, 0, 256, 128);
  g.strokeStyle = '#2f6a3a'; g.lineWidth = 10; g.strokeRect(5, 5, 246, 118);
  g.fillStyle = '#2f3a2a'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = 'bold 44px sans-serif'; g.fillText(text, 128, 52);
  g.font = 'bold 20px sans-serif'; g.fillText(sub, 128, 98);
  const tex = new THREE.CanvasTexture(c); tex.anisotropy = 2;
  return tex;
}

// ============================================================
// Casa canaria (fachada al +Z local)
// ============================================================
export function buildCasa({ w = 8, d = 7, h = 3.4, balcony = false, twoFloors = false, color = null, sign = null,
  roof = 'teja', trim = 'green', base = 'stone', chimney = false } = {}) {
  mats();
  const g = new THREE.Group();
  const H = twoFloors ? h * 1.8 : h;
  const wallM = color ? new THREE.MeshLambertMaterial({ color, flatShading: true }) : M.wall;
  const TR = trim === 'blue' ? [M.blue, M.blueD] : [M.green, M.greenD];
  const baseM = base === 'lava' ? M.lava : M.stone;
  const body = box(w, H, d, wallM, 0, H / 2, 0); g.add(body);
  g.add(box(w + 0.2, base === 'lava' ? 0.6 : 0.35, d + 0.2, baseM, 0, base === 'lava' ? 0.3 : 0.17, 0));   // zócalo
  if (base !== 'lava') for (const sx of [-1, 1]) g.add(box(0.5, H, 0.5, M.stone, sx * (w / 2 - 0.1), H / 2, d / 2 - 0.1));   // esquinas de cantería
  if (roof === 'flat') {
    // Azotea con pretil y chimenea redonda (estilo Lanzarote)
    g.add(box(w + 0.1, 0.12, d + 0.1, wallM, 0, H + 0.06, 0));
    for (const [pw, pd, px, pz] of [[w + 0.1, 0.25, 0, d / 2], [w + 0.1, 0.25, 0, -d / 2], [0.25, d + 0.1, w / 2, 0], [0.25, d + 0.1, -w / 2, 0]])
      g.add(box(pw, 0.45, pd, wallM, px, H + 0.3, pz));
    if (chimney) {
      const ch = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.4, 1.2, 10), wallM); ch.position.set(w / 2 - 1.1, H + 0.7, -d / 2 + 1.1); g.add(ch);
      const cap = new THREE.Mesh(new THREE.SphereGeometry(0.36, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), wallM); cap.position.set(w / 2 - 1.1, H + 1.3, -d / 2 + 1.1); g.add(cap);
    }
  } else {
    // Tejado a cuatro aguas de teja
    const roofM = new THREE.Mesh(new THREE.ConeGeometry(Math.hypot(w, d) / 2 + 0.5, 1.9, 4), M.teja);
    roofM.rotation.y = Math.PI / 4; roofM.scale.set(w / Math.hypot(w, d) * 1.45, 1, d / Math.hypot(w, d) * 1.45);
    roofM.position.y = H + 0.95; g.add(roofM);
    g.add(box(w + 0.5, 0.18, d + 0.5, M.tejaD, 0, H + 0.05, 0));
  }
  // Puerta verde
  const doorW = 1.3, doorH = 2.3;
  g.add(box(doorW + 0.3, doorH + 0.25, 0.14, M.stone, 0, doorH / 2 + 0.1, d / 2 + 0.03));
  const door = box(doorW, doorH, 0.12, TR[0], 0, doorH / 2 + 0.05, d / 2 + 0.09); g.add(door);
  for (const yy of [0.6, 1.5]) g.add(box(doorW * 0.8, 0.07, 0.03, TR[1], 0, yy, d / 2 + 0.16));
  g.add(box(0.08, 0.08, 0.08, M.gold, 0.45, 1.15, d / 2 + 0.17));
  // Ventanas con contraventanas
  const win = (x, y) => {
    g.add(box(1.0, 1.2, 0.1, M.glass, x, y, d / 2 + 0.04));
    g.add(box(0.5, 1.2, 0.08, TR[0], x - 0.78, y, d / 2 + 0.06));
    g.add(box(0.5, 1.2, 0.08, TR[0], x + 0.78, y, d / 2 + 0.06));
    g.add(box(1.3, 0.12, 0.25, M.stone, x, y - 0.66, d / 2 + 0.12));
  };
  win(-w / 4 - 0.3, 1.8); win(w / 4 + 0.3, 1.8);
  if (twoFloors) { win(-w / 4 - 0.3, h + 1.6); win(w / 4 + 0.3, h + 1.6); }
  // Balcón canario de madera
  if (balcony && twoFloors) {   // balcón solo en casas de dos plantas
    const by = twoFloors ? h + 0.55 : 2.9;
    g.add(box(w * 0.7, 0.14, 1.0, M.wood, 0, by, d / 2 + 0.5));
    g.add(box(w * 0.7, 0.1, 0.08, M.woodD, 0, by + 1.0, d / 2 + 0.98));
    for (let i = 0; i <= 10; i++) g.add(box(0.07, 1.0, 0.07, M.woodL, -w * 0.35 + i * (w * 0.7 / 10), by + 0.5, d / 2 + 0.98));
    g.add(box(w * 0.74, 0.12, 1.15, M.woodD, 0, by + 2.0, d / 2 + 0.5));
    for (const sx of [-1, 1]) g.add(box(0.12, 2.0, 0.12, M.woodD, sx * w * 0.35, by + 1.0, d / 2 + 0.98));
  }
  // Cartel de la urbanización
  if (sign) {
    // Poste con cartel delante de la puerta (se ve desde la calle)
    const tex = signTexture(sign[0], sign[1]);
    const px = -(doorW / 2 + 1.9), pz = d / 2 + 1.6;
    g.add(box(0.16, 3.0, 0.16, M.woodD, px, 1.5, pz));
    g.add(box(2.5, 1.3, 0.1, M.woodD, px, 2.55, pz));
    for (const side of [1, -1]) {
      const plank = new THREE.Mesh(new THREE.PlaneGeometry(2.3, 1.15), new THREE.MeshBasicMaterial({ map: tex }));
      plank.position.set(px, 2.55, pz + side * 0.06); if (side < 0) plank.rotation.y = Math.PI; g.add(plank);
    }
    // Macetas junto a la puerta
    for (const sx of [-1, 1]) {
      const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.2, 0.45, 8), M.pot); pot.position.set(sx * 1.2, 0.22, d / 2 + 0.6); g.add(pot);
      const pl = new THREE.Mesh(new THREE.IcosahedronGeometry(0.38, 0), M.leaf); pl.position.set(sx * 1.2, 0.72, d / 2 + 0.6); g.add(pl);
    }
  }
  return { group: g, w, d, doorZ: d / 2 };
}

// ============================================================
// Urbanizaciones (exterior)
// ============================================================
function addOBB(x, z, rot, hx, hz) { colliders.push({ x, z, c: Math.cos(rot), s: Math.sin(rot), hx, hz }); }
function place(g, p, lx, lz, rotExtra = 0) {
  const c = Math.cos(p.dir), s = Math.sin(p.dir);
  // rotación de three: local (x,z) → mundo (x c + z s, -x s + z c)
  const wx = p.x + lx * c + lz * s, wz = p.z - lx * s + lz * c;
  g.position.set(wx, 0, wz); g.rotation.y = p.dir + rotExtra;
  return { wx, wz, rot: p.dir + rotExtra };
}

function buildExterior() {
  exterior = new THREE.Group();
  exterior.userData.kind = 'urbanizaciones';
  const palette = [null, 0xf0e0b0, 0xe8c8a8, 0xf4f0e6, 0xd8e4ea];
  HOUSE_PORTALS.forEach((p, i) => {
    // La casa-puerta (con cartel)
    const main = buildCasa({ w: 8, d: 7, sign: ['🏠 Tu casa', p.name.replace('Urbanización de ', '')] });
    const m = place(main.group, p, 0, 0);
    exterior.add(main.group);
    addOBB(m.wx, m.wz, m.rot, main.w / 2 + 0.3, main.d / 2 + 0.3);
    const hit = box(main.w + 1, 4, main.d + 1.5, M.hit, 0, 2, 0.4);
    hit.userData = { kind: 'house-portal', portal: p, door: { x: m.wx + Math.sin(m.rot) * (main.d / 2 + 1.7), z: m.wz + Math.cos(m.rot) * (main.d / 2 + 1.7) } };
    main.group.add(hit); portalHits.push(hit);
    // Vecinos (decorativos)
    const nb = [
      { lx: -11.5, lz: 0.5, o: { w: 7, d: 7, color: palette[(i + 1) % 5] } },
      { lx: 11.5, lz: 0.5, o: { w: 7.5, d: 7, twoFloors: true, balcony: true, color: palette[(i + 2) % 5] } },
      { lx: -5, lz: 17, o: { w: 8, d: 7, color: palette[(i + 3) % 5] }, back: true },
      { lx: 7, lz: 17, o: { w: 7, d: 6.5, balcony: true, twoFloors: true, color: palette[(i + 4) % 5] }, back: true },
    ];
    for (const n of nb) {
      const c = buildCasa(n.o);
      const q = place(c.group, p, n.lx, n.lz, n.back ? Math.PI : 0);
      exterior.add(c.group);
      addOBB(q.wx, q.wz, q.rot, c.w / 2 + 0.3, c.d / 2 + 0.3);
      // Sesión 50 — TODAS las casas de la urbanización llevan a tu casa
      // (antes solo la del cartel y la gente intentaba entrar en las demás)
      const nh = box(c.w + 1, 4, c.d + 1.5, M.hit, 0, 2, 0.4);
      nh.userData = { kind: 'house-portal', portal: p, door: { x: q.wx + Math.sin(q.rot) * (c.d / 2 + 1.7), z: q.wz + Math.cos(q.rot) * (c.d / 2 + 1.7) } };
      c.group.add(nh); portalHits.push(nh);
    }
    // Calle empedrada delante
    const street = box(34, 0.04, 6, M.stoneD, 0, 0.02, 8.5);
    place(street, p, 0, 8.5); street.position.y = 0.02; exterior.add(street);
  });
  // Casonas del banco
  for (const c of CASONAS) {
    const k = buildCasa({ w: CASONA_W, d: CASONA_D, twoFloors: true, balcony: true, sign: ['🏦 Banco', c.name.replace('Casona del banco de ', '')] });
    k.group.position.set(c.x, 0, c.z); k.group.rotation.y = c.dir;
    exterior.add(k.group);
    addOBB(c.x, c.z, c.dir, CASONA_W / 2 + 0.3, CASONA_D / 2 + 0.3);
    // porche con toldo delante de la puerta (donde está el banquero)
    const aw = new THREE.Group(); aw.position.set(c.x, 0, c.z); aw.rotation.y = c.dir; exterior.add(aw);
    aw.add(box(3.6, 0.12, 2.6, M.cloth, 0, 3.0, CASONA_D / 2 + 1.3));
    for (const sx of [-1.7, 1.7]) aw.add(box(0.14, 3.0, 0.14, M.woodD, sx, 1.5, CASONA_D / 2 + 2.5));
    aw.add(box(2.8, 1.0, 0.5, M.wood, 0, 0.5, CASONA_D / 2 + 1.9));   // mostrador (el banquero, detrás)
    // tendedero con lo que vende la tienda general
    const line = hangingLine([['sword_bronze', '🗡️'], ['axe_bronze', '🪓'], ['pickaxe_bronze', '⛏️'], ['fishing_rod', '🎣'], ['bow_normal', '🏹'], ['shield_bronze', '🛡️'], ['tinderbox', '🔥']], 3.3, 2.75);
    line.position.z = CASONA_D / 2 + 2.45;
    aw.add(line);
  }
  // Arico, el pueblo blanco
  for (const h of puebloHouses()) {
    const k = buildCasa({ w: h.w, d: h.d, twoFloors: h.twoFloors, roof: 'flat', trim: h.trim, base: 'lava', chimney: true, color: 0xfbfaf6 });
    k.group.position.set(h.x, 0, h.z); k.group.rotation.y = h.dir;
    exterior.add(k.group);
    addOBB(h.x, h.z, h.dir, h.w / 2 + 0.3, h.d / 2 + 0.3);
    // jardín: muro bajo de piedra negra, cactus o palmera
    const gd = new THREE.Group(); gd.position.set(h.x, 0, h.z); gd.rotation.y = h.dir; exterior.add(gd);
    const gx = h.w / 2 + 1.4;
    gd.add(box(0.35, 0.6, h.d * 0.7, M.lava, gx + 0.9, 0.3, 0));
    if ((Math.round(h.x) + Math.round(h.z)) % 2) {
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.2, 4.2, 6), M.palm); trunk.position.set(gx, 2.1, 0); gd.add(trunk);
      for (let i = 0; i < 7; i++) {
        const fr = box(0.35, 0.05, 1.9, M.leaf, gx, 4.2, 0); fr.rotation.set(0.5, i / 7 * Math.PI * 2, 0); fr.translateZ(0.8); gd.add(fr);
      }
    } else {
      for (let i = 0; i < 3; i++) {
        const c1 = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.24, 1.2 + i * 0.3, 7), M.cactus); c1.position.set(gx + (i - 1) * 0.5, 0.6 + i * 0.15, (i - 1) * 0.6); gd.add(c1);
      }
    }
  }
  scene.add(exterior);
}

// ============================================================
// Interior según el nivel
// ============================================================
function buildInterior(tierId) {
  mats();
  const T = HOUSE_TIERS[tierId];
  const W = T.w, D = T.d, WH = 2.6;
  const C = HOUSE_CENTER;
  const g = new THREE.Group(); g.position.set(C.x, 0, C.z);
  const items = []; const cols = [];
  const isCave = tierId === 'cueva';

  // Suelo
  const floorMat = isCave ? M.floorDirt : M.floorWood;
  g.add(box(W, 0.1, D, floorMat, 0, -0.05, 0));
  if (!isCave) for (let i = -W / 2 + 0.6; i < W / 2; i += 1.2) g.add(box(0.03, 0.005, D, M.woodD, i, 0.003, 0));
  // Paredes (cortadas a media altura, estilo OSRS) con hueco de puerta al sur
  const wallM = isCave ? M.rock : M.wall;
  const doorW = 1.6;
  if (isCave) {
    const rng = (k) => (Math.sin(k * 12.9898) * 43758.5453) % 1;
    const per = 2 * (W + D);
    for (let k = 0; k < per / 0.9; k++) {
      let s = k * 0.9, x, z;
      if (s < W) { x = -W / 2 + s; z = D / 2; } else if (s < W + D) { x = W / 2; z = D / 2 - (s - W); }
      else if (s < 2 * W + D) { x = W / 2 - (s - W - D); z = -D / 2; } else { x = -W / 2; z = -D / 2 + (s - 2 * W - D); }
      if (Math.abs(z + D / 2) < 0.01 && Math.abs(x) < doorW / 2 + 0.2) continue;
      for (let row = 0; row < 3; row++) {
        const r = new THREE.Mesh(new THREE.DodecahedronGeometry(0.65 - row * 0.1, 0), row % 2 ? M.rockD : M.rock);
        r.position.set(x, 0.4 + row * 0.8, z); r.rotation.set(k, row + k, 0); g.add(r);
      }
    }
  } else {
    const seg = (x, z, w, d) => { g.add(box(w, WH, d, wallM, x, WH / 2, z)); g.add(box(w + 0.02, 0.4, d + 0.02, M.stone, x, 0.2, z)); };
    seg(0, D / 2, W + 0.4, 0.4); seg(-W / 2, 0, 0.4, D); seg(W / 2, 0, 0.4, D);
    const sideW = (W - doorW) / 2;
    seg(-W / 2 + sideW / 2, -D / 2, sideW + 0.4, 0.4); seg(W / 2 - sideW / 2, -D / 2, sideW + 0.4, 0.4);
    // Ventanas pintadas en la pared norte
    for (const x of [-W / 4, W / 4]) {
      g.add(box(1.1, 1.0, 0.05, M.glass, x, 1.6, D / 2 - 0.23));
      g.add(box(0.5, 1.0, 0.05, M.green, x - 0.8, 1.6, D / 2 - 0.23)); g.add(box(0.5, 1.0, 0.05, M.green, x + 0.8, 1.6, D / 2 - 0.23));
    }
  }
  // Puerta de salida (sur)
  const exitDoor = box(doorW - 0.2, 2.2, 0.15, M.green, 0, 1.1, -D / 2); g.add(exitDoor);
  items.push({ kind: 'salida', x: 0, z: -D / 2 + 0.3, r: 1.8, mesh: exitDoor });

  // Alfombra
  const rug = box(W * 0.35, 0.02, D * 0.3, M.cloth, -W * 0.12, 0.012, -D * 0.05); g.add(rug);
  g.add(box(W * 0.3, 0.021, D * 0.24, M.straw, -W * 0.12, 0.013, -D * 0.05));

  // 🛏 Cama (esquina NE)
  if (T.features.includes('cama')) {
    const bx = W / 2 - 1.3, bz = D / 2 - 1.6;
    const bed = new THREE.Group(); bed.position.set(bx, 0, bz);
    if (isCave) {
      bed.add(box(1.5, 0.35, 2.3, M.straw, 0, 0.18, 0));
      bed.add(box(1.4, 0.1, 1.5, M.clothB, 0, 0.4, -0.3));
    } else {
      bed.add(box(1.6, 0.4, 2.4, M.wood, 0, 0.3, 0));
      bed.add(box(1.5, 0.2, 2.3, M.white, 0, 0.6, 0));
      bed.add(box(1.52, 0.12, 1.5, M.clothB, 0, 0.72, -0.35));
      bed.add(box(0.9, 0.18, 0.45, M.white, 0, 0.8, 0.8));
      bed.add(box(1.7, 1.2, 0.12, M.woodD, 0, 0.8, 1.2));
    }
    g.add(bed);
    items.push({ kind: 'cama', x: bx, z: bz, r: 2.2, mesh: bed });
    cols.push({ x: bx, z: bz, hx: 0.85, hz: 1.25 });
  }
  // 📦 Cofre (esquina NO)
  if (T.features.includes('cofre')) {
    const cx = -W / 2 + 1.1, cz = D / 2 - 1.0;
    const ch = new THREE.Group(); ch.position.set(cx, 0, cz);
    ch.add(box(1.2, 0.7, 0.8, M.wood, 0, 0.35, 0));
    ch.add(box(1.24, 0.25, 0.84, M.woodD, 0, 0.8, 0));
    for (const sx of [-0.4, 0.4]) ch.add(box(0.08, 1.0, 0.86, M.iron, sx, 0.5, 0));
    ch.add(box(0.2, 0.2, 0.05, M.gold, 0, 0.6, -0.43));
    ch.rotation.y = Math.PI;
    g.add(ch);
    items.push({ kind: 'cofre', x: cx, z: cz, r: 2.0, mesh: ch });
    cols.push({ x: cx, z: cz, hx: 0.65, hz: 0.45 });
  }
  // ✦ Altar de Chaxiraxi (norte, centro)
  if (T.features.includes('altar')) {
    const ax = 0, az = D / 2 - 1.1;
    const al = new THREE.Group(); al.position.set(ax, 0, az);
    al.add(box(1.8, 0.2, 1.0, M.stone, 0, 0.1, 0));
    al.add(box(1.4, 0.8, 0.7, M.white, 0, 0.6, 0));
    al.add(box(1.5, 0.1, 0.8, M.gold, 0, 1.03, 0));
    const orb = new THREE.Mesh(new THREE.IcosahedronGeometry(0.22, 0), M.glow); orb.position.y = 1.4; al.add(orb);
    al.userData.orb = orb;
    for (const sx of [-0.6, 0.6]) {
      const cnd = box(0.1, 0.35, 0.1, M.white, sx, 1.25, 0.1); al.add(cnd);
      const fl = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.14, 5), M.fire); fl.position.set(sx, 1.5, 0.1); al.add(fl);
    }
    g.add(al);
    items.push({ kind: 'altar', x: ax, z: az, r: 2.0, mesh: al });
    cols.push({ x: ax, z: az, hx: 0.95, hz: 0.55 });
  }
  // Hogar / fuego (pared oeste)
  {
    const fx = -W / 2 + 0.8, fz = isCave ? -D / 4 : 0;
    const hog = new THREE.Group(); hog.position.set(fx, 0, fz);
    if (isCave) {
      for (let k = 0; k < 7; k++) { const s = new THREE.Mesh(new THREE.DodecahedronGeometry(0.2, 0), M.stoneD); const a = k / 7 * Math.PI * 2; s.position.set(Math.cos(a) * 0.45 + 0.5, 0.1, Math.sin(a) * 0.45); hog.add(s); }
      const fl = new THREE.Mesh(new THREE.ConeGeometry(0.25, 0.6, 6), M.fire); fl.position.set(0.5, 0.3, 0); hog.add(fl); hog.userData.flame = fl;
      cols.push({ x: fx + 0.5, z: fz, hx: 0.55, hz: 0.55 });
    } else {
      hog.add(box(0.8, 1.6, 2.0, M.stone, 0, 0.8, 0));
      hog.add(box(0.5, 0.8, 1.1, M.iron, 0.2, 0.5, 0));
      hog.add(box(1.0, 0.14, 2.2, M.woodD, 0.1, 1.65, 0));
      const fl = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.5, 6), M.fire); fl.position.set(0.3, 0.35, 0); hog.add(fl); hog.userData.flame = fl;
      cols.push({ x: fx, z: fz, hx: 0.55, hz: 1.05 });
    }
    g.add(hog);
    items.push({ kind: 'fuego', x: fx + 0.5, z: fz, r: 2.0, mesh: hog, deco: true });
    fireLight = new THREE.PointLight(0xffa050, 1.2, 9, 1.5);
    fireLight.position.set(C.x + fx + 0.6, 1.2, C.z + fz); inside_lights.push(fireLight);
  }
  // Mesa con sillas y un escaldón de gofio
  if (!isCave) {
    const tx = -W * 0.12, tz = -D * 0.05;
    const tb = new THREE.Group(); tb.position.set(tx, 0, tz);
    tb.add(box(1.8, 0.1, 1.0, M.woodL, 0, 0.8, 0));
    for (const [sx, sz] of [[-0.8, -0.4], [0.8, -0.4], [-0.8, 0.4], [0.8, 0.4]]) tb.add(box(0.08, 0.8, 0.08, M.woodD, sx, 0.4, sz));
    const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.14, 0.14, 10), M.pot); bowl.position.set(0.3, 0.92, 0); tb.add(bowl);
    const jar = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 0.3, 8), M.glass); jar.position.set(-0.4, 1.0, 0.1); tb.add(jar);
    for (const sz of [-0.85, 0.85]) {
      tb.add(box(0.5, 0.06, 0.5, M.wood, 0, 0.48, sz));
      tb.add(box(0.5, 0.6, 0.06, M.wood, 0, 0.78, sz + Math.sign(sz) * 0.22));
    }
    g.add(tb); cols.push({ x: tx, z: tz, hx: 1.0, hz: 1.2 });
  } else {
    // Cueva: tronco de asiento, cántaro y candil
    const lg = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.38, 0.5, 8), M.wood); lg.position.set(-W * 0.1, 0.25, 0); g.add(lg);
    const jar = new THREE.Mesh(new THREE.SphereGeometry(0.35, 8, 6), M.pot); jar.position.set(W / 2 - 1.0, 0.35, -D / 2 + 1.2); g.add(jar);
    cols.push({ x: -W * 0.1, z: 0, hx: 0.4, hz: 0.4 });
  }
  // Casona: drago en maceta y estantería
  if (tierId === 'casona') {
    const dx = W / 2 - 1.2, dz = -D / 2 + 1.4;
    const dr = new THREE.Group(); dr.position.set(dx, 0, dz);
    { const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.4, 0.6, 10), M.pot); pot.position.y = 0.3; dr.add(pot); }
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.18, 1.3, 7), M.woodL); trunk.position.y = 1.2; dr.add(trunk);
    for (let k = 0; k < 5; k++) {
      const a = k / 5 * Math.PI * 2;
      const br = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.08, 0.7, 5), M.woodL);
      br.position.set(Math.cos(a) * 0.25, 2.0, Math.sin(a) * 0.25); br.rotation.set(Math.sin(a) * 0.7, 0, -Math.cos(a) * 0.7); dr.add(br);
      const tuft = new THREE.Mesh(new THREE.ConeGeometry(0.35, 0.45, 7), M.leaf); tuft.position.set(Math.cos(a) * 0.5, 2.45, Math.sin(a) * 0.5); dr.add(tuft);
    }
    g.add(dr); cols.push({ x: dx, z: dz, hx: 0.55, hz: 0.55 });
    const sh = new THREE.Group(); sh.position.set(W / 2 - 0.45, 0, 0);
    sh.add(box(0.5, 2.0, 2.2, M.wood, 0, 1.0, 0));
    const bookC = [0xa03030, 0x305090, 0x3a7a3a, 0xc8a040];
    for (let r = 0; r < 3; r++) for (let k = 0; k < 7; k++) sh.add(box(0.3, 0.4, 0.22, new THREE.MeshLambertMaterial({ color: bookC[(r + k) % 4] }), -0.1, 0.45 + r * 0.6, -0.9 + k * 0.28));
    g.add(sh); cols.push({ x: W / 2 - 0.45, z: 0, hx: 0.3, hz: 1.15 });
  }

  // Suelo invisible para el tap-para-andar
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(W + 6, D + 6).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }));
  floor.position.set(C.x, 0.02, C.z); floor.userData = { kind: 'house-floor' };

  return { group: g, floor, tier: tierId, W, D, items, cols };
}
const inside_lights = [];

// ============================================================
// Entrar / salir
// ============================================================
async function ensureTier() {
  if (tierLoaded) return myTier;
  try { const r = await api.houseGet(); myTier = r?.tier || null; tierLoaded = true; } catch {}
  return myTier;
}

async function enterHouse(portal) {
  const tier = await ensureTier();
  if (!tier) {
    feedLog('info', '🏠 No tienes casa todavía. Habla con Nauzet, el agente inmobiliario de La Laguna (junto a la urbanización).');
    return;
  }
  if (interiors.isActive()) return;
  inside_lights.length = 0;
  const h = buildInterior(tier);
  scene.add(h.group); scene.add(h.floor);
  for (const l of inside_lights) scene.add(l);
  inside = h;
  const C = HOUSE_CENTER;
  const ok = interiors.enterRoom({
    id: 'house',
    center: C,
    spawn: { x: C.x, z: C.z - h.D / 2 + 1.4 },
    floor: h.floor,
    bg: 0x14100c, fogNear: 18, fogFar: 70,
    applyCollision: roomCollision,
    onTap: roomTap,
    update: roomUpdate,
    onLeave: () => cleanupInside(),
  }, 'house');
  if (!ok) { cleanupInside(); return; }
  feedLog('info', `🏠 Bienvenido a tu ${HOUSE_TIERS[tier].name}. ${featuresText(tier)}`);
}

function featuresText(tier) {
  const f = HOUSE_TIERS[tier].features;
  const out = [];
  if (f.includes('cama')) out.push('🛏 cama: recupera la vida');
  if (f.includes('cofre')) out.push('📦 cofre: tu banco');
  if (f.includes('altar')) out.push('✦ altar: recarga la plegaria');
  return out.join(' · ');
}

function cleanupInside() {
  if (!inside) return;
  try { scene.remove(inside.group); scene.remove(inside.floor); } catch {}
  for (const l of inside_lights) try { scene.remove(l); } catch {}
  inside.group.traverse(o => { if (o.geometry) o.geometry.dispose(); });
  inside.floor.geometry.dispose();
  inside = null; pendingUse = null; fireLight = null;
}

// ============================================================
// Dentro: colisión, taps, usar muebles
// ============================================================
function roomCollision(x0, z0, x1, z1) {
  if (!inside) return { x: x1, z: z1 };
  const C = HOUSE_CENTER, m = 0.55;
  let lx = x1 - C.x, lz = z1 - C.z;
  lx = Math.max(-inside.W / 2 + m, Math.min(inside.W / 2 - m, lx));
  lz = Math.max(-inside.D / 2 + m, Math.min(inside.D / 2 - m, lz));
  const R = 0.35;
  for (const c of inside.cols) {
    const dx = lx - c.x, dz = lz - c.z;
    const px = c.hx + R - Math.abs(dx), pz = c.hz + R - Math.abs(dz);
    if (px > 0 && pz > 0) { if (px < pz) lx += Math.sign(dx || 1) * px; else lz += Math.sign(dz || 1) * pz; }
  }
  return { x: lx + C.x, z: lz + C.z };
}

const _ray = new THREE.Raycaster();
function roomTap(clientX, clientY) {
  if (!inside || !camera || !canvas) return false;
  const rect = canvas.getBoundingClientRect();
  _ray.setFromCamera({ x: ((clientX - rect.left) / rect.width) * 2 - 1, y: -((clientY - rect.top) / rect.height) * 2 + 1 }, camera);
  const targets = inside.items.filter(i => !i.deco).map(i => i.mesh);
  const hits = _ray.intersectObjects(targets, true);
  if (!hits.length) { pendingUse = null; return false; }
  let o = hits[0].object, item = null;
  while (o && !item) { item = inside.items.find(i => i.mesh === o) || null; o = o.parent; }
  if (!item) return false;
  const p = getPlayer();
  const C = HOUSE_CENTER;
  const d = p ? Math.hypot(p.position.x - (C.x + item.x), p.position.z - (C.z + item.z)) : 0;
  if (d <= item.r) { useItem(item); return true; }
  pendingUse = item;
  // andar hasta el mueble (la colisión te deja justo al lado)
  setPlayerTarget(C.x + item.x, C.z + item.z + (item.z > 0 ? -1.2 : 1.2));
  return true;
}

function roomUpdate(dt) {
  t += dt;
  if (!inside) return;
  for (const it of inside.items) {
    if (it.mesh.userData.flame) { const f = it.mesh.userData.flame; f.scale.set(1, 1 + Math.sin(t * 10) * 0.18, 1); f.rotation.y += dt * 3; }
    if (it.mesh.userData.orb) { it.mesh.userData.orb.position.y = 1.4 + Math.sin(t * 2) * 0.08; it.mesh.userData.orb.rotation.y += dt; }
  }
  if (fireLight) fireLight.intensity = 1.1 + Math.sin(t * 13) * 0.12 + Math.sin(t * 7.3) * 0.1;
  if (pendingUse) {
    const p = getPlayer();
    const C = HOUSE_CENTER;
    if (p && Math.hypot(p.position.x - (C.x + pendingUse.x), p.position.z - (C.z + pendingUse.z)) <= pendingUse.r) {
      const it = pendingUse; pendingUse = null; useItem(it);
    }
  }
}

let busy = false;
async function useItem(item) {
  if (busy) return;
  if (item.kind === 'salida') { interiors.leave(); return; }
  busy = true;
  try {
    if (item.kind === 'cama') {
      try { window.__playerGather?.('kneel', 1500); } catch {}
      const r = await api.houseRest();
      try { window.__setHpInstant?.(r.hp, r.hp_max); } catch {}
      feedLog('info', `💤 Echas una siestita… Vida al máximo (${r.hp}).`);
    } else if (item.kind === 'cofre') {
      onOpenBank();
    } else if (item.kind === 'altar') {
      try { window.__playerGather?.('kneel', 1200); } catch {}
      const r = await api.prayerRecharge('altar_casa');
      try { window.__prayer?.applyServer?.(r); } catch {}
      feedLog('info', `✦ Rezas a Chaxiraxi en tu altar. Plegaria: ${r.prayer_max ?? 'llena'}.`);
    }
  } catch (err) {
    if (err?.code === 'rested') feedLog('info', '💤 Todavía no tienes sueño. Vuelve a dormir dentro de un rato (cada 5 min).');
    else feedLog('error', err?.message || 'No se pudo.');
  } finally { busy = false; }
}

// ============================================================
// Fuera: tap a la puerta, colisión, mapa
// ============================================================
export function tryHandleTap(raycaster) {
  if (!started || interiors.isActive() || !portalHits.length) return false;
  const hits = raycaster.intersectObjects(portalHits, false);
  if (!hits.length) return false;
  const ud = hits[0].object.userData;
  goPortal(ud.portal, ud.door);
  return true;
}
let pendingDoor = null;
function goPortal(p, door) {
  const pl = getPlayer();
  if (!pl) return;
  const d = Math.hypot(pl.position.x - door.x, pl.position.z - door.z);
  if (d <= HOUSE_PORTAL_USE_M) { pendingPortal = null; enterHouse(p); return; }
  pendingPortal = p; pendingDoor = door;
  setPlayerTarget(door.x, door.z);
}
export function cancel() { pendingPortal = null; }

export function update(dt) {
  if (!started || !pendingPortal || interiors.isActive()) return;
  const pl = getPlayer(); if (!pl) return;
  const door = pendingDoor;
  if (!door) { pendingPortal = null; return; }
  if (Math.hypot(pl.position.x - door.x, pl.position.z - door.z) <= HOUSE_PORTAL_USE_M) {
    const p = pendingPortal; pendingPortal = null; enterHouse(p);
  }
}

export function applyCollision(x0, z0, x1, z1) {
  if (!started || interiors.isActive()) return { x: x1, z: z1 };
  let x = x1, z = z1;
  const R = 0.35;
  for (const c of colliders) {
    const dx = x - c.x, dz = z - c.z;
    if (Math.abs(dx) > 14 || Math.abs(dz) > 14) continue;
    // al espacio local de la casa (inversa de la rotación de three)
    let lx = dx * c.c - dz * c.s, lz = dx * c.s + dz * c.c;
    const px = c.hx + R - Math.abs(lx), pz = c.hz + R - Math.abs(lz);
    if (px > 0 && pz > 0) {
      if (px < pz) lx += Math.sign(lx || 1) * px; else lz += Math.sign(lz || 1) * pz;
      x = c.x + lx * c.c + lz * c.s; z = c.z - lx * c.s + lz * c.c;
    }
  }
  return { x, z };
}

export function registerKeepouts(terrain) {
  for (const p of HOUSE_PORTALS) {
    try { terrain.addKeepout?.(p.x, p.z, 26); terrain.clearTreesNear?.(p.x, p.z, 26); } catch {}
  }
  for (const c of CASONAS) { try { terrain.addKeepout?.(c.x, c.z, 14); terrain.clearTreesNear?.(c.x, c.z, 14); } catch {} }
  for (const h of puebloHouses()) { try { terrain.addKeepout?.(h.x, h.z, 8); terrain.clearTreesNear?.(h.x, h.z, 8); } catch {} }
}

export function getMapIcons() {
  return [
    ...HOUSE_PORTALS.map(p => ({ x: p.x, z: p.z, kind: 'house', name: p.name })),
    ...CASONAS.map(c => ({ x: c.x, z: c.z, kind: 'bank', name: c.name })),
  ];
}

export function start(opts) {
  if (started) stop();
  scene = opts.scene; camera = opts.camera; canvas = opts.canvas;
  getPlayer = opts.getPlayer || (() => null);
  setPlayerTarget = opts.setPlayerTarget || (() => {});
  feedLog = opts.feedLog || (() => {});
  onOpenBank = opts.onOpenBank || (() => {});
  mats();
  colliders.length = 0; portalHits.length = 0;
  buildExterior();
  started = true;
  ensureTier();
  if (typeof window !== 'undefined') {
    window.__houses = {
      refresh: () => { tierLoaded = false; return ensureTier(); },
      tier: () => myTier,
      enter: () => enterHouse(HOUSE_PORTALS[0]),   // debug
    };
  }
}

export function stop() {
  try { if (interiors.currentRoomId?.() === 'house') interiors.forceLeave(); } catch {}
  cleanupInside();
  if (exterior) { try { scene?.remove(exterior); } catch {} exterior.traverse(o => { if (o.geometry) o.geometry.dispose(); }); }
  exterior = null; colliders.length = 0; portalHits.length = 0; pendingPortal = null;
  started = false; tierLoaded = false; myTier = null;
}
