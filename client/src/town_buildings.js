/**
 * SebasPresent — Edificios de los pueblos en los que se entra (19 oct)
 *
 * FUERA: casas canarias (buildCasa) con cartel: la Taberna La Vieja Aguere en
 * La Laguna, la Herrería del Muelle en Santa Cruz… (datos en
 * shared/town_buildings.js). Tocas la puerta, vas andando y entras.
 *
 * DENTRO: la sala se monta por código lejos del mapa (b.room) con la sala de
 * interiors.js (enterRoom): botón Salir, volver a la puerta, cielo/niebla.
 * Los vecinos de dentro son habitantes normales (town_npcs.js): se ven, se les
 * habla, dan misiones y venden igual que fuera. Algunos muebles se pueden
 * examinar (El Tigre, la pizarra de la taberna…).
 *
 * Luces: SOLO del pool (poolLight/releaseLight), nunca PointLight nuevas.
 */
import * as THREE from 'three';
import * as interiors from './interiors.js';
import * as townNpcs from './town_npcs.js';
import { buildCasa } from './houses.js';
import { poolLight, releaseLight } from './spec_fx.js';
import { TOWN_BUILDINGS, doorOf, BUILDING_ENTER_M } from './shared/town_buildings.js';

let scene = null, camera = null, canvas = null;
let getPlayer = () => null;
let setPlayerTarget = () => {};
let feedLog = () => {};
let started = false;

let exterior = null;
const colliders = [];      // OBB {x,z,c,s,hx,hz}
const doorHits = [];
let pending = null;        // edificio al que vas andando

let inside = null;         // { b, group, floor, items, cols, lights, flames, t }
let pendingUse = null;

// ============================================================
// Materiales (compartidos, se crean una vez)
// ============================================================
const M = {};
function mats() {
  if (M.wall) return M;
  const L = (c, o = {}) => new THREE.MeshLambertMaterial({ color: c, flatShading: true, ...o });
  M.wall = L(0xf0e6d0); M.stone = L(0x6e675c); M.stoneD = L(0x4e4840); M.floorWood = L(0x7a5230); M.floorStone = L(0x5a554e);
  M.wood = L(0x6a4526); M.woodL = L(0x9a6a3a); M.woodD = L(0x3e2814); M.iron = L(0x3a3c42); M.ironL = L(0x6a6e78);
  M.green = L(0x2f6a3a); M.cloth = L(0x8a2a24); M.straw = L(0xc8a860); M.coal = L(0x1c1a18); M.pot = L(0xa4552e);
  M.bronze = new THREE.MeshStandardMaterial({ color: 0x8a6a2a, metalness: 0.7, roughness: 0.45, flatShading: true });
  M.glass = [0x3a6a2a, 0x6a1a2a, 0x2a4a6a, 0xa08a2a].map(c => new THREE.MeshLambertMaterial({ color: c, transparent: true, opacity: 0.85 }));
  M.fire = new THREE.MeshBasicMaterial({ color: 0xffa030 });
  M.ember = new THREE.MeshBasicMaterial({ color: 0xff5a1a });
  M.candle = new THREE.MeshBasicMaterial({ color: 0xffe0a0 });
  M.hit = new THREE.MeshBasicMaterial({ visible: false });
  return M;
}
const box = (w, h, d, m, x = 0, y = 0, z = 0) => { const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); b.position.set(x, y, z); return b; };
const cyl = (rt, rb, h, m, x = 0, y = 0, z = 0, seg = 10) => { const c = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), m); c.position.set(x, y, z); return c; };

function boardTexture(lines, bg = '#2a2a22', fg = '#f0ead8') {
  const c = document.createElement('canvas'); c.width = 256; c.height = 160;
  const g = c.getContext('2d');
  g.fillStyle = bg; g.fillRect(0, 0, 256, 160);
  g.strokeStyle = '#8a6a3a'; g.lineWidth = 12; g.strokeRect(6, 6, 244, 148);
  g.fillStyle = fg; g.textAlign = 'center'; g.textBaseline = 'middle';
  lines.forEach((l, i) => { g.font = i === 0 ? 'bold 30px sans-serif' : '22px sans-serif'; g.fillText(l, 128, 40 + i * 36); });
  const tex = new THREE.CanvasTexture(c); tex.anisotropy = 2;
  return tex;
}

// ============================================================
// Fuera
// ============================================================
function addOBB(x, z, rot, hx, hz) { colliders.push({ x, z, c: Math.cos(rot), s: Math.sin(rot), hx, hz }); }

function buildExterior() {
  mats();
  exterior = new THREE.Group();
  exterior.userData.kind = 'town-buildings';
  for (const b of TOWN_BUILDINGS) {
    const k = buildCasa({ w: b.w, d: b.d, color: b.color, twoFloors: !!b.twoFloors, balcony: !!b.twoFloors, sign: b.sign });
    const g = k.group;
    g.position.set(b.x, 0, b.z); g.rotation.y = b.dir;
    // Detalles de la fachada según lo que hay dentro
    if (b.kind === 'taberna') {
      for (const [sx, sz] of [[2.6, 0.9], [3.3, 1.5], [2.9, 2.1]]) {
        const br = cyl(0.42, 0.42, 0.95, M.wood, sx, 0.48, b.d / 2 + sz, 12); g.add(br);
        g.add(cyl(0.44, 0.44, 0.06, M.iron, sx, 0.2, b.d / 2 + sz, 12), cyl(0.44, 0.44, 0.06, M.iron, sx, 0.76, b.d / 2 + sz, 12));
      }
      // farol junto a la puerta
      g.add(box(0.08, 0.6, 0.08, M.iron, 1.0, 2.6, b.d / 2 + 0.35));
      g.add(box(0.26, 0.34, 0.26, M.candle, 1.0, 2.2, b.d / 2 + 0.35));
    } else if (b.kind === 'herreria') {
      // yunque y barril de agua en la puerta, herradura en la fachada
      g.add(box(0.7, 0.55, 0.5, M.woodD, 2.8, 0.28, b.d / 2 + 1.4), box(0.95, 0.25, 0.38, M.iron, 2.8, 0.68, b.d / 2 + 1.4));
      g.add(cyl(0.4, 0.4, 0.8, M.wood, -2.8, 0.4, b.d / 2 + 1.1, 12));
      const shoe = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.09, 6, 14, Math.PI * 1.3), M.ironL);
      shoe.position.set(0, 2.95, b.d / 2 + 0.12); shoe.rotation.z = -Math.PI * 0.15 - Math.PI / 2; g.add(shoe);
      // chimenea de la forja
      g.add(box(1.1, 2.2, 1.1, M.stone, -b.w / 2 + 1.2, b.twoFloors ? 6.8 : 4.4, -b.d / 2 + 1.2));
    }
    exterior.add(g);
    addOBB(b.x, b.z, b.dir, b.w / 2 + 0.3, b.d / 2 + 0.3);
    const hit = box(b.w + 1, 4.5, b.d + 1.5, M.hit, 0, 2.2, 0.4);
    hit.userData = { kind: 'town-building', b, door: doorOf(b) };
    g.add(hit); doorHits.push(hit);
  }
  scene.add(exterior);
}

// ============================================================
// Dentro: sala común (suelo, paredes cortadas a media altura, puerta al sur)
// ============================================================
function shell(g, W, D, floorM, wallM) {
  g.add(box(W, 0.1, D, floorM, 0, -0.05, 0));
  if (floorM === M.floorWood) for (let i = -W / 2 + 0.6; i < W / 2; i += 1.2) g.add(box(0.03, 0.005, D, M.woodD, i, 0.003, 0));
  const WH = 2.6, doorW = 1.6;
  const seg = (x, z, w, d, h = WH) => { g.add(box(w, h, d, wallM, x, h / 2, z)); g.add(box(w + 0.02, 0.4, d + 0.02, M.stone, x, 0.2, z)); };
  seg(0, D / 2, W + 0.4, 0.4); seg(-W / 2, 0, 0.4, D); seg(W / 2, 0, 0.4, D);
  // la pared de la puerta (sur) queda baja: la cámara mira desde ahí y no tapa la sala
  const sideW = (W - doorW) / 2;
  seg(-W / 2 + sideW / 2, -D / 2, sideW + 0.4, 0.4, 1.0); seg(W / 2 - sideW / 2, -D / 2, sideW + 0.4, 0.4, 1.0);
  // vigas
  for (let x = -W / 2 + 2; x < W / 2 - 1; x += 3) g.add(box(0.25, 0.25, D + 0.4, M.woodD, x, WH + 0.05, 0));
  const exitDoor = box(doorW - 0.2, 1.6, 0.15, M.green, 0, 0.8, -D / 2);
  g.add(exitDoor);
  return exitDoor;
}

function table(g, cols, x, z, round = true) {
  const t = new THREE.Group(); t.position.set(x, 0, z);
  if (round) { t.add(cyl(0.75, 0.75, 0.08, M.woodL, 0, 0.8, 0, 14)); t.add(cyl(0.1, 0.16, 0.8, M.woodD, 0, 0.4, 0, 8)); }
  else { t.add(box(1.6, 0.08, 0.9, M.woodL, 0, 0.8, 0)); for (const [a, c] of [[-0.7, -0.35], [0.7, -0.35], [-0.7, 0.35], [0.7, 0.35]]) t.add(box(0.08, 0.8, 0.08, M.woodD, a, 0.4, c)); }
  for (const a of [0.4, 2.3, 4.2]) { const s = cyl(0.22, 0.22, 0.45, M.wood, Math.cos(a) * 1.05, 0.23, Math.sin(a) * 1.05, 8); t.add(s); }
  // vela y jarra
  t.add(cyl(0.05, 0.05, 0.18, M.candle, 0.2, 0.93, 0.1, 6));
  t.add(cyl(0.09, 0.08, 0.2, M.pot, -0.25, 0.94, -0.1, 8));
  g.add(t); cols.push({ x, z, hx: 0.8, hz: 0.8 });
  return t;
}

function barrel(g, x, z, lying = false, y = 0) {
  const b = new THREE.Group(); b.position.set(x, y, z);
  b.add(cyl(0.42, 0.42, 0.95, M.wood, 0, 0, 0, 12), cyl(0.44, 0.44, 0.06, M.iron, 0, -0.28, 0, 12), cyl(0.44, 0.44, 0.06, M.iron, 0, 0.28, 0, 12));
  if (lying) { b.rotation.z = Math.PI / 2; b.position.y = y + 0.43; } else b.position.y = y + 0.48;
  g.add(b);
  return b;
}

function buildTaberna(b, ctx) {
  const { g, cols, items, W, D } = ctx;
  const exit = shell(g, W, D, M.floorWood, M.wall);
  items.push({ kind: 'salida', x: 0, z: -D / 2 + 0.3, r: 1.8, mesh: exit });
  // Barra (Fefo detrás, en z ≈ 2.9)
  const bz = 1.95;
  g.add(box(7.2, 1.1, 0.7, M.wood, 0, 0.55, bz), box(7.4, 0.1, 0.85, M.woodL, 0, 1.13, bz));
  for (let i = 0; i < 6; i++) g.add(cyl(0.05, 0.06, 0.16, M.glass[i % 4], -2.5 + i, 1.26, bz, 6));
  cols.push({ x: 0, z: bz, hx: 3.7, hz: 0.45 });
  // Estantería con botellas y la pizarra
  const sz = D / 2 - 0.45;
  g.add(box(6.4, 2.2, 0.4, M.woodD, 0, 1.1, sz));
  for (let r = 0; r < 3; r++) {
    g.add(box(6.2, 0.06, 0.42, M.woodL, 0, 0.55 + r * 0.6, sz - 0.02));
    for (let k = 0; k < 11; k++) g.add(cyl(0.06, 0.07, 0.3, M.glass[(r + k) % 4], -2.8 + k * 0.56, 0.74 + r * 0.6, sz - 0.05, 6));
  }
  cols.push({ x: 0, z: sz, hx: 3.3, hz: 0.3 });
  const board = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 1.05), new THREE.MeshBasicMaterial({ map: boardTexture(['HOY NO SE FÍA', 'mañana sí', '— Fefo —']) }));
  board.position.set(-4.6, 1.75, D / 2 - 0.21); board.rotation.y = Math.PI; g.add(board);
  items.push({ kind: 'examinar', x: -4.6, z: D / 2 - 0.9, r: 3.5, mesh: board,
    text: '🪧 La pizarra dice: «HOY NO SE FÍA, MAÑANA SÍ». Debajo, con letra de Adonay: «mañana vengo».' });
  // Barriles de vino tumbados en la esquina NE (y uno en pie)
  for (const [x, z, y] of [[5.6, 3.7, 0], [5.6, 2.8, 0], [5.6, 3.25, 0.82]]) barrel(g, x, z, true, y);
  cols.push({ x: 5.6, z: 3.25, hx: 0.7, hz: 0.95 });
  const tap = barrel(g, 4.6, 3.9);
  items.push({ kind: 'examinar', x: 4.6, z: 3.9, r: 3.0, mesh: tap, text: '🍷 Barricas de vino de Tacoronte. Bueno, la que queda.' });
  cols.push({ x: 4.6, z: 3.9, hx: 0.45, hz: 0.45 });
  // Chimenea (pared oeste)
  const fx = -W / 2 + 0.75, fz = 2.0;
  const hog = new THREE.Group(); hog.position.set(fx, 0, fz);
  hog.add(box(0.9, 1.6, 2.2, M.stone, 0, 0.8, 0), box(0.5, 0.75, 1.2, M.coal, 0.25, 0.45, 0), box(1.1, 0.16, 2.4, M.woodD, 0.1, 1.65, 0));
  hog.add(box(0.7, 1.4, 1.4, M.stone, -0.05, 2.35, 0));
  const fl = new THREE.Mesh(new THREE.ConeGeometry(0.26, 0.6, 6), M.fire); fl.position.set(0.35, 0.4, 0); hog.add(fl);
  g.add(hog); cols.push({ x: fx, z: fz, hx: 0.6, hz: 1.15 });
  ctx.flames.push(fl);
  ctx.lights.push([poolLight(0xffa050, 1.3, 10, 1.4), fx + 0.9, 1.2, fz]);
  ctx.lights.push([poolLight(0xffd8a0, 0.7, 12, 1.5), 1.5, 2.6, -1.0]);
  // Mesas (Don Pancho junto a la del oeste, Chago junto a la del este)
  table(g, cols, -4.2, -2.4);
  table(g, cols, 4.2, -2.7);
  table(g, cols, -1.5, -0.5, false);
  // Timple apoyado en la mesa de Chago
  const tim = new THREE.Group(); tim.position.set(4.0, 0.9, -2.5); tim.rotation.set(-Math.PI / 2, 0, 0.6);
  tim.add(new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8).scale(1, 0.4, 1.3), M.woodL), box(0.06, 0.03, 0.45, M.woodD, 0, 0, 0.38));
  g.add(tim);
  // Alfombra y aparador con queso y gofio junto a la puerta
  g.add(box(3.2, 0.02, 2.2, M.cloth, 0, 0.012, -2.9), box(2.8, 0.021, 1.8, M.straw, 0, 0.013, -2.9));
  const sideB = box(0.6, 0.9, 1.6, M.woodD, -W / 2 + 0.55, 0.45, -2.6); g.add(sideB);
  g.add(cyl(0.28, 0.28, 0.16, M.straw, -W / 2 + 0.55, 0.98, -2.9, 12));
  cols.push({ x: -W / 2 + 0.55, z: -2.6, hx: 0.35, hz: 0.85 });
}

function buildHerreria(b, ctx) {
  const { g, cols, items, W, D } = ctx;
  const exit = shell(g, W, D, M.floorStone, M.wall);
  items.push({ kind: 'salida', x: 0, z: -D / 2 + 0.3, r: 1.8, mesh: exit });
  // Forja (esquina NO): fogón de piedra con brasas y campana
  const fx = -3.4, fz = D / 2 - 1.1;
  const fg = new THREE.Group(); fg.position.set(fx, 0, fz);
  fg.add(box(2.4, 0.95, 1.5, M.stone, 0, 0.48, 0));
  const coals = box(1.8, 0.08, 1.0, M.ember, 0, 0.99, 0); fg.add(coals);
  for (let k = 0; k < 9; k++) fg.add(box(0.22, 0.12, 0.2, M.coal, -0.7 + (k % 3) * 0.7 + (k * 0.13) % 0.2, 1.04, -0.3 + Math.floor(k / 3) * 0.3));
  fg.add(box(2.6, 0.2, 1.7, M.stoneD, 0, 2.5, 0), box(1.0, 1.4, 0.9, M.stoneD, 0, 3.2, 0.2));
  for (const sx of [-1.1, 1.1]) fg.add(box(0.2, 1.6, 0.2, M.stoneD, sx, 1.75, -0.6));
  // fuelle
  const bel = box(0.5, 0.25, 0.9, M.cloth, 1.55, 0.7, 0.1); bel.rotation.z = 0.3; fg.add(bel);
  g.add(fg); cols.push({ x: fx, z: fz, hx: 1.35, hz: 0.85 });
  ctx.flames.push(coals);
  ctx.lights.push([poolLight(0xff7a2a, 1.6, 11, 1.4), fx, 1.5, fz - 0.6]);
  ctx.lights.push([poolLight(0xffd8a0, 0.6, 12, 1.5), 1.5, 2.6, -1.0]);
  items.push({ kind: 'examinar', x: fx, z: fz - 1.0, r: 3.0, mesh: fg, text: '🔥 La forja del muelle. Las brasas no se apagan nunca: Iballa duerme al lado para vigilarlas.' });
  // Yunque (Chano detrás) y pila de agua
  const ax = 1.6, az = 1.5;
  const an = new THREE.Group(); an.position.set(ax, 0, az);
  an.add(box(0.6, 0.6, 0.6, M.woodD, 0, 0.3, 0), box(1.0, 0.28, 0.42, M.iron, 0, 0.74, 0));
  const horn = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.45, 8), M.iron); horn.rotation.z = Math.PI / 2; horn.position.set(-0.7, 0.78, 0); an.add(horn);
  an.add(box(0.5, 0.06, 0.08, M.woodL, 0.1, 0.92, 0.05), box(0.14, 0.12, 0.14, M.ironL, 0.32, 0.95, 0.05));   // martillo
  g.add(an); cols.push({ x: ax, z: az, hx: 0.6, hz: 0.4 });
  g.add(box(1.3, 0.6, 0.7, M.woodD, 3.3, 0.3, 1.6), box(1.15, 0.05, 0.55, new THREE.MeshLambertMaterial({ color: 0x2a4a5a }), 3.3, 0.58, 1.6));
  cols.push({ x: 3.3, z: 1.6, hx: 0.7, hz: 0.4 });
  // Banco de trabajo con herramientas (pared norte, centro)
  g.add(box(2.4, 0.9, 0.8, M.wood, 1.4, 0.45, D / 2 - 0.6));
  for (let k = 0; k < 5; k++) g.add(box(0.08, 0.5, 0.04, M.iron, 0.5 + k * 0.45, 1.6, D / 2 - 0.22), box(0.22, 0.12, 0.05, M.ironL, 0.5 + k * 0.45, 1.88, D / 2 - 0.22));
  cols.push({ x: 1.4, z: D / 2 - 0.6, hx: 1.25, hz: 0.45 });
  // Armero (pared este) con espadas y escudos
  const rk = new THREE.Group(); rk.position.set(W / 2 - 0.45, 0, 1.2);
  rk.add(box(0.3, 1.8, 2.6, M.woodD, 0, 0.9, 0));
  for (let k = 0; k < 4; k++) { const s = box(0.05, 1.2, 0.1, M.ironL, -0.2, 1.05, -0.9 + k * 0.6); rk.add(s, box(0.05, 0.06, 0.32, M.bronze, -0.2, 0.52, -0.9 + k * 0.6)); }
  g.add(rk); cols.push({ x: W / 2 - 0.45, z: 1.2, hx: 0.3, hz: 1.3 });
  items.push({ kind: 'examinar', x: W / 2 - 0.9, z: 1.2, r: 3.0, mesh: rk, text: '⚔️ Espadas a medio afilar para los caballeros de Anaga. Una lleva una etiqueta: «Sir Beneharo — SIN PRISA».' });
  // Carbón y hierro en bruto
  for (let k = 0; k < 14; k++) { const r = new THREE.Mesh(new THREE.DodecahedronGeometry(0.18 + (k % 3) * 0.05, 0), M.coal); r.position.set(-W / 2 + 0.8 + (k % 4) * 0.28, 0.12 + Math.floor(k / 8) * 0.18, -1.2 + (k % 5) * 0.25); g.add(r); }
  cols.push({ x: -W / 2 + 1.2, z: -0.7, hx: 0.7, hz: 0.7 });
  // El Tigre: cañón de bronce en su cureña (esquina SE)
  const tg = new THREE.Group(); tg.position.set(3.3, 0, -2.6); tg.rotation.y = -0.5;
  tg.add(box(1.0, 0.35, 2.0, M.wood, 0, 0.5, 0));
  for (const sx of [-0.62, 0.62]) for (const sz of [-0.65, 0.65]) { const w = cyl(0.36, 0.36, 0.12, M.woodD, sx, 0.36, sz, 12); w.rotation.z = Math.PI / 2; tg.add(w); }
  const barrelC = cyl(0.2, 0.3, 2.4, M.bronze, 0, 0.95, 0.25, 12); barrelC.rotation.x = Math.PI / 2 - 0.12; tg.add(barrelC);
  for (const z of [-0.5, 0.3, 1.0]) { const ring = new THREE.Mesh(new THREE.TorusGeometry(0.27, 0.04, 6, 14), M.iron); ring.position.set(0, 0.95 + z * 0.12, 0.25 + z); tg.add(ring); }
  const pl = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.5), new THREE.MeshBasicMaterial({ map: boardTexture(['EL TIGRE', 'Paso Alto, 1797'], '#3a2a14', '#e8c560') }));
  pl.position.set(0, 0.5, -1.02); pl.rotation.y = Math.PI; tg.add(pl);
  g.add(tg); cols.push({ x: 3.3, z: -2.6, hx: 1.0, hz: 1.2 });
  items.push({ kind: 'examinar', x: 3.3, z: -2.6, r: 3.2, mesh: tg,
    text: '💥 El Tigre: cañón de bronce del castillo de Paso Alto. Defendió el puerto en el verano de 1797. Huele a pólvora vieja.' });
}

function buildInterior(b) {
  mats();
  const R = b.room, W = R.W, D = R.D;
  const g = new THREE.Group(); g.position.set(R.x, 0, R.z);
  const ctx = { g, cols: [], items: [], flames: [], lights: [], W, D };
  if (b.kind === 'taberna') buildTaberna(b, ctx);
  else buildHerreria(b, ctx);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(W + 6, D + 6).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }));
  floor.position.set(R.x, 0.02, R.z); floor.userData = { kind: 'town-building-floor' };
  const lights = ctx.lights.map(([l, x, y, z]) => { l.position.set(R.x + x, y, R.z + z); return l; });
  return { b, group: g, floor, items: ctx.items, cols: ctx.cols, flames: ctx.flames, lights, W, D, t: 0 };
}

// ============================================================
// Entrar / salir
// ============================================================
function enterBuilding(b) {
  if (interiors.isActive() || inside) return;
  const h = buildInterior(b);
  scene.add(h.group); scene.add(h.floor);
  inside = h;
  const R = b.room;
  const ok = interiors.enterRoom({
    id: b.id,
    center: { x: R.x, z: R.z },
    spawn: { x: R.x, z: R.z - R.D / 2 + 2.0 },
    floor: h.floor,
    bg: 0x16110c, fogNear: 18, fogFar: 70,
    applyCollision: roomCollision,
    onTap: roomTap,
    update: roomUpdate,
    onLeave: () => cleanupInside(),
  }, b.id);
  if (!ok) { cleanupInside(); return; }
  try { townNpcs.resync?.(); } catch {}
  feedLog('info', b.kind === 'taberna' ? `🍷 Entras en la ${b.name}. Huele a leña, a vino y a gofio.` : `⚒ Entras en la ${b.name}. El martillo suena como una campana.`);
}

function cleanupInside() {
  if (!inside) return;
  try { scene.remove(inside.group); scene.remove(inside.floor); } catch {}
  for (const l of inside.lights) releaseLight(l);
  inside.group.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material?.map) { o.material.map.dispose(); o.material.dispose(); } });
  inside.floor.geometry.dispose();
  inside = null; pendingUse = null;
}

function roomCollision(x0, z0, x1, z1) {
  if (!inside) return { x: x1, z: z1 };
  const R = inside.b.room, m = 0.55;
  let lx = x1 - R.x, lz = z1 - R.z;
  lx = Math.max(-inside.W / 2 + m, Math.min(inside.W / 2 - m, lx));
  lz = Math.max(-inside.D / 2 + m, Math.min(inside.D / 2 - m, lz));
  const r = 0.35;
  for (const c of inside.cols) {
    const dx = lx - c.x, dz = lz - c.z;
    const px = c.hx + r - Math.abs(dx), pz = c.hz + r - Math.abs(dz);
    if (px > 0 && pz > 0) { if (px < pz) lx += Math.sign(dx || 1) * px; else lz += Math.sign(dz || 1) * pz; }
  }
  return { x: lx + R.x, z: lz + R.z };
}

const _ray = new THREE.Raycaster();
function roomTap(clientX, clientY) {
  if (!inside || !camera || !canvas) return false;
  const rect = canvas.getBoundingClientRect();
  _ray.setFromCamera({ x: ((clientX - rect.left) / rect.width) * 2 - 1, y: -((clientY - rect.top) / rect.height) * 2 + 1 }, camera);
  // 1) los vecinos de dentro (hablar)
  try { if (townNpcs.tryHandleTap(_ray)) { pendingUse = null; return true; } } catch (e) { console.warn('[town_buildings] npc tap', e); }
  // 2) muebles: salir / examinar
  const hits = _ray.intersectObjects(inside.items.map(i => i.mesh), true);
  if (!hits.length) { pendingUse = null; try { townNpcs.cancel?.(); } catch {} return false; }
  let o = hits[0].object, item = null;
  while (o && !item) { item = inside.items.find(i => i.mesh === o) || null; o = o.parent; }
  if (!item) return false;
  try { townNpcs.cancel?.(); } catch {}
  const p = getPlayer();
  const R = inside.b.room;
  const d = p ? Math.hypot(p.position.x - (R.x + item.x), p.position.z - (R.z + item.z)) : 0;
  if (d <= item.r) { useItem(item); return true; }
  pendingUse = item;
  setPlayerTarget(R.x + item.x, R.z + item.z + (item.z > 0 ? -1.2 : 1.2));
  return true;
}

function roomUpdate(dt) {
  if (!inside) return;
  inside.t += dt;
  const t = inside.t;
  for (const f of inside.flames) { f.scale.set(1, 1 + Math.sin(t * 10 + f.id) * 0.18, 1); }
  inside.lights.forEach((l, i) => { if (i === 0) l.intensity = (inside.b.kind === 'herreria' ? 1.6 : 1.3) + Math.sin(t * 13) * 0.12 + Math.sin(t * 7.3) * 0.1; });
  if (pendingUse) {
    const p = getPlayer(), R = inside.b.room;
    if (p && Math.hypot(p.position.x - (R.x + pendingUse.x), p.position.z - (R.z + pendingUse.z)) <= pendingUse.r) {
      const it = pendingUse; pendingUse = null; useItem(it);
    }
  }
}

function useItem(item) {
  if (item.kind === 'salida') { interiors.leave(); return; }
  if (item.kind === 'examinar') feedLog('info', item.text);
}

// ============================================================
// Fuera: tocar la puerta, colisión, mapa
// ============================================================
export function tryHandleTap(raycaster) {
  if (!started || interiors.isActive() || !doorHits.length) return false;
  const hits = raycaster.intersectObjects(doorHits, false);
  if (!hits.length) return false;
  const { b, door } = hits[0].object.userData;
  const pl = getPlayer(); if (!pl) return true;
  if (Math.hypot(pl.position.x - door.x, pl.position.z - door.z) <= BUILDING_ENTER_M) { pending = null; enterBuilding(b); return true; }
  pending = { b, door };
  setPlayerTarget(door.x, door.z);
  return true;
}
export function cancel() { pending = null; }

export function update(dt) {
  if (!started || !pending || interiors.isActive()) return;
  const pl = getPlayer(); if (!pl) return;
  if (Math.hypot(pl.position.x - pending.door.x, pl.position.z - pending.door.z) <= BUILDING_ENTER_M) {
    const b = pending.b; pending = null; enterBuilding(b);
  }
}

export function applyCollision(x0, z0, x1, z1) {
  if (!started || interiors.isActive()) return { x: x1, z: z1 };
  let x = x1, z = z1;
  const R = 0.35;
  for (const c of colliders) {
    const dx = x - c.x, dz = z - c.z;
    if (Math.abs(dx) > 14 || Math.abs(dz) > 14) continue;
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
  for (const b of TOWN_BUILDINGS) {
    const r = Math.max(b.w, b.d) / 2 + 5;
    try { terrain.addKeepout?.(b.x, b.z, r); terrain.clearTreesNear?.(b.x, b.z, r); } catch {}
  }
}

export function getMapIcons() {
  return TOWN_BUILDINGS.map(b => ({ x: b.x, z: b.z, kind: b.kind === 'taberna' ? 'tavern' : 'anvil', name: b.name }));
}

export function start(opts) {
  if (started) stop();
  scene = opts.scene; camera = opts.camera; canvas = opts.canvas;
  getPlayer = opts.getPlayer || (() => null);
  setPlayerTarget = opts.setPlayerTarget || (() => {});
  feedLog = opts.feedLog || (() => {});
  colliders.length = 0; doorHits.length = 0;
  buildExterior();
  started = true;
  if (typeof window !== 'undefined' && location.hostname === 'localhost') {
    window.__townBuildings = { enter: (id) => enterBuilding(TOWN_BUILDINGS.find(b => b.id === id) || TOWN_BUILDINGS[0]), inside: () => inside?.b.id || null };
  }
}

export function stop() {
  try { if (inside && interiors.isActive()) interiors.forceLeave(); } catch {}
  cleanupInside();
  if (exterior) { try { scene?.remove(exterior); } catch {} exterior.traverse(o => { if (o.geometry) o.geometry.dispose(); }); }
  exterior = null; colliders.length = 0; doorHits.length = 0; pending = null;
  started = false;
}
