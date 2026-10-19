/**
 * SebasPresent — Edificios de los pueblos en los que se entra (19 oct)
 *
 * FUERA: casas canarias (buildCasa) con cartel: la Taberna La Vieja Aguere en
 * La Laguna, la Herrería del Muelle en Santa Cruz, la Casa de los Balcones en
 * La Orotava, la Bodega El Drago en Icod… (datos en
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
  M.leaves = L(0x3f7a2e); M.leavesD = L(0x2a5a22); M.grapes = L(0x4a1a4a); M.tea = L(0x7a3a1e); M.linen = L(0xf4f0e4);
  M.flowers = [0xd0304a, 0xe8a030, 0xd060a0].map(c => L(c));
  M.cellar = L(0xb8a888); M.fort = L(0xb4a68a); M.skin = L(0x8a6a48);
  M.boatB = L(0x2a5a9a); M.boatW = L(0xf0efe8); M.boatR = L(0xb03a2a); M.cork = L(0xe0782a); M.fish = L(0xb8c4cc); M.pinocha = L(0xa0682a); M.net = L(0x8a7a5a);
  M.water = new THREE.MeshLambertMaterial({ color: 0x3a7a9a, transparent: true, opacity: 0.85 });
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
    const k = buildCasa({ w: b.w, d: b.d, color: b.color, twoFloors: !!b.twoFloors, balcony: !!b.twoFloors && b.roof !== 'flat', sign: b.sign,
      roof: b.roof || 'teja', trim: b.trim || 'green', base: b.base || 'stone', chimney: !!b.chimney });
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
    } else if (b.kind === 'casa') {
      // macetas con geranios a los lados de la puerta y una placa de piedra
      for (const sx of [-1.6, 1.6, -3.6, 3.6]) {
        g.add(cyl(0.3, 0.22, 0.45, M.pot, sx, 0.23, b.d / 2 + 0.55, 10));
        const fl = new THREE.Mesh(new THREE.SphereGeometry(0.34, 8, 6), M.flowers[Math.abs(sx * 10) % 3]); fl.position.set(sx, 0.62, b.d / 2 + 0.55); fl.scale.y = 0.7; g.add(fl);
      }
      g.add(box(1.0, 0.6, 0.06, M.stone, 2.3, 2.1, b.d / 2 + 0.06));
    } else if (b.kind === 'bodega') {
      // parra sobre la puerta (postes + emparrado verde) y barricas fuera
      for (const sx of [-2.4, 2.4]) g.add(box(0.14, 2.6, 0.14, M.woodD, sx, 1.3, b.d / 2 + 2.0));
      g.add(box(5.2, 0.1, 0.12, M.woodD, 0, 2.6, b.d / 2 + 2.0), box(5.2, 0.1, 0.12, M.woodD, 0, 2.6, b.d / 2 + 0.2));
      const vine = box(5.4, 0.22, 2.2, M.leaves, 0, 2.75, b.d / 2 + 1.1); g.add(vine);
      for (let k = 0; k < 6; k++) { const gr = new THREE.Mesh(new THREE.SphereGeometry(0.13, 6, 5), M.grapes); gr.position.set(-2 + k * 0.8, 2.5, b.d / 2 + 0.6 + (k % 2) * 0.9); gr.scale.y = 1.5; g.add(gr); }
      for (const [sx, sz] of [[3.4, 0.7], [3.4, 1.6]]) { const br = cyl(0.42, 0.42, 0.95, M.wood, sx, 0.43, b.d / 2 + sz, 12); br.rotation.x = Math.PI / 2; g.add(br); }
    } else if (b.kind === 'molino') {
      // muela vieja apoyada en la fachada, sacos de millo y un molinillo de aspas en la azotea
      const mu = cyl(0.85, 0.85, 0.28, M.stone, -2.9, 0.86, b.d / 2 + 0.35, 16); mu.rotation.x = Math.PI / 2 - 0.12; g.add(mu);
      g.add(cyl(0.16, 0.16, 0.3, M.stoneD, -2.9, 0.86, b.d / 2 + 0.5, 8).rotateX(Math.PI / 2));
      for (const [sx, sz, y] of [[2.6, 0.7, 0], [3.3, 0.8, 0], [2.95, 0.75, 0.5]]) g.add(box(0.62, 0.55, 0.45, M.straw, sx, 0.28 + y, b.d / 2 + sz));
      const tw = new THREE.Group(); tw.position.set(b.w / 2 - 1.6, 3.4, -b.d / 2 + 1.6);
      tw.add(cyl(0.45, 0.6, 2.0, M.wall, 0, 1.0, 0, 10), new THREE.Mesh(new THREE.ConeGeometry(0.62, 0.7, 10), M.woodD).translateY(2.35));
      const hub = new THREE.Group(); hub.position.set(0, 1.7, 0.62); tw.add(hub);
      for (let k = 0; k < 4; k++) { const a = box(0.18, 1.6, 0.04, M.linen, 0, 0.8, 0); const arm = new THREE.Group(); arm.rotation.z = k * Math.PI / 2 + 0.3; arm.add(a); hub.add(arm); }
      g.add(tw);
    } else if (b.kind === 'casafuerte') {
      // almenas en la azotea, garita en la esquina y un cañón junto a la puerta
      const H = 3.4 * 1.8;
      for (let x = -b.w / 2 + 0.4; x <= b.w / 2 - 0.3; x += 1.1) for (const z of [b.d / 2, -b.d / 2]) g.add(box(0.55, 0.6, 0.35, M.stone, x, H + 0.82, z));
      for (let z = -b.d / 2 + 1.2; z <= b.d / 2 - 1.0; z += 1.1) for (const x of [b.w / 2, -b.w / 2]) g.add(box(0.35, 0.6, 0.55, M.stone, x, H + 0.82, z));
      const ga = new THREE.Group(); ga.position.set(b.w / 2 - 0.2, H - 0.6, b.d / 2 - 0.2);
      ga.add(cyl(0.6, 0.35, 1.8, M.stone, 0, 0.9, 0, 10), cyl(0.75, 0.75, 0.25, M.stoneD, 0, 1.9, 0, 10));
      g.add(ga);
      const cn = new THREE.Group(); cn.position.set(3.2, 0, b.d / 2 + 1.5); cn.rotation.y = 0.4;
      cn.add(box(0.8, 0.3, 1.5, M.wood, 0, 0.42, 0));
      for (const sx of [-0.5, 0.5]) { const w = cyl(0.3, 0.3, 0.1, M.woodD, sx, 0.3, 0.4, 12); w.rotation.z = Math.PI / 2; cn.add(w); }
      const bar = cyl(0.14, 0.22, 1.8, M.iron, 0, 0.75, 0.3, 10); bar.rotation.x = Math.PI / 2 - 0.15; cn.add(bar);
      g.add(cn);
      for (let k = 0; k < 5; k++) { const ball = new THREE.Mesh(new THREE.SphereGeometry(0.12, 6, 5), M.iron); ball.position.set(2.4 + (k % 3) * 0.24, 0.12 + (k > 2 ? 0.2 : 0), b.d / 2 + 1.0 + (k > 2 ? 0.1 : 0)); g.add(ball); }    } else if (b.kind === 'cofradia') {
      // barquita varada delante, nasas y un ancla apoyada en la pared
      const bt = boat(); bt.position.set(-2.8, 0, b.d / 2 + 2.2); bt.rotation.y = 0.3; g.add(bt);
      for (const [sx, sz] of [[2.7, 0.8], [3.4, 1.4]]) { const n = cyl(0.35, 0.45, 0.6, M.straw, sx, 0.3, b.d / 2 + sz, 10); g.add(n); }
      const an = new THREE.Group(); an.position.set(1.6, 0, b.d / 2 + 0.3);
      an.add(box(0.12, 1.5, 0.12, M.iron, 0, 0.9, 0), box(0.6, 0.1, 0.1, M.iron, 0, 1.45, 0));
      const hk = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.06, 6, 12, Math.PI), M.iron); hk.rotation.z = Math.PI; hk.position.y = 0.55; an.add(hk);
      an.rotation.x = -0.15; g.add(an);
    } else if (b.kind === 'pinero') {
      // leña apilada, una rodaja de pino y un montón de pinocha
      for (let r = 0; r < 3; r++) for (let k = 0; k < 5 - r; k++) { const l = cyl(0.17, 0.17, 1.6, M.wood, 2.2 + k * 0.36 + r * 0.18, 0.17 + r * 0.31, b.d / 2 + 0.7, 8); l.rotation.z = Math.PI / 2; l.rotation.y = Math.PI / 2; g.add(l); }
      const pc = new THREE.Mesh(new THREE.ConeGeometry(1.0, 0.8, 9), M.pinocha); pc.position.set(-3.0, 0.4, b.d / 2 + 1.4); g.add(pc);
      const ro = cyl(0.38, 0.38, 0.12, M.woodL, -1.3, 1.45, b.d / 2 + 0.1, 16); ro.rotation.x = Math.PI / 2; g.add(ro, cyl(0.14, 0.14, 0.13, M.tea, -1.3, 1.45, b.d / 2 + 0.11, 12).rotateX(Math.PI / 2));
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

function helecho(g, x, z, s = 1) {   // maceta con helecho (patio canario)
  const h = new THREE.Group(); h.position.set(x, 0, z);
  h.add(cyl(0.32 * s, 0.24 * s, 0.5 * s, M.pot, 0, 0.25 * s, 0, 10));
  for (let k = 0; k < 7; k++) {
    const f = new THREE.Mesh(new THREE.ConeGeometry(0.12 * s, 0.9 * s, 4), k % 2 ? M.leaves : M.leavesD);
    const a = k / 7 * Math.PI * 2;
    f.position.set(Math.cos(a) * 0.22 * s, 0.75 * s, Math.sin(a) * 0.22 * s);
    f.rotation.set(Math.sin(a) * 0.7, 0, -Math.cos(a) * 0.7);
    h.add(f);
  }
  g.add(h);
  return h;
}

function buildCasaBalcones(b, ctx) {
  const { g, cols, items, W, D } = ctx;
  const exit = shell(g, W, D, M.floorWood, M.wall);
  items.push({ kind: 'salida', x: 0, z: -D / 2 + 0.3, r: 1.8, mesh: exit });
  // Patio canario en el centro: losas, fuente de piedra y helechos
  const px = 0.5, pz = 0.6;
  g.add(box(4.2, 0.04, 3.4, M.stone, px, 0.02, pz), box(3.9, 0.045, 3.1, M.floorStone, px, 0.022, pz));
  const fu = new THREE.Group(); fu.position.set(px, 0, pz);
  fu.add(cyl(0.95, 1.05, 0.55, M.stone, 0, 0.28, 0, 14), cyl(0.85, 0.85, 0.05, M.water, 0, 0.52, 0, 14));
  fu.add(cyl(0.12, 0.16, 0.9, M.stone, 0, 0.9, 0, 8), cyl(0.38, 0.2, 0.16, M.stone, 0, 1.38, 0, 10));
  const jet = cyl(0.03, 0.05, 0.35, M.water, 0, 1.6, 0, 6); fu.add(jet);
  g.add(fu); cols.push({ x: px, z: pz, hx: 1.05, hz: 1.05 });
  ctx.flames.push(jet);
  items.push({ kind: 'examinar', x: px, z: pz, r: 2.8, mesh: fu,
    text: '⛲ La fuente del patio. El agua baja del monte por una acequia que tiene más años que la casa.' });
  for (const [x, z] of [[px - 1.8, pz - 1.4], [px + 1.8, pz - 1.4], [px - 1.8, pz + 1.4], [px + 1.8, pz + 1.4]]) helecho(g, x, z);
  // Galería de tea (pared norte): pies derechos, viga y barandilla de balaustres
  const gz = D / 2 - 1.5;
  for (let x = -W / 2 + 1; x <= W / 2 - 1; x += 2.2) { g.add(box(0.2, 2.6, 0.2, M.tea, x, 1.3, gz)); cols.push({ x, z: gz, hx: 0.12, hz: 0.12 }); }
  g.add(box(W - 0.8, 0.22, 0.26, M.tea, 0, 2.5, gz));
  g.add(box(W - 0.8, 0.08, 0.14, M.tea, 0, 2.05, gz));
  for (let x = -W / 2 + 0.7; x < W / 2 - 0.5; x += 0.32) g.add(box(0.06, 0.4, 0.06, M.tea, x, 2.27, gz));
  // Bastidor de calados de Doña Mencía (a su derecha) con el lino tensado
  const bx = -4.6, bz = 1.0;
  const bs = new THREE.Group(); bs.position.set(bx, 0, bz); bs.rotation.y = 0.35;
  for (const sx of [-0.6, 0.6]) bs.add(box(0.07, 0.95, 0.07, M.woodD, sx, 0.47, 0));
  const lin = box(1.3, 0.03, 0.9, M.linen, 0, 0.95, 0); lin.rotation.x = -0.35; bs.add(lin);
  for (let k = 0; k < 5; k++) { const h = box(0.9 - k * 0.12, 0.035, 0.03, M.cloth, 0, 0.97 + k * 0.03, -0.25 + k * 0.12); h.rotation.x = -0.35; bs.add(h); }
  g.add(bs); cols.push({ x: bx, z: bz, hx: 0.65, hz: 0.5 });
  items.push({ kind: 'examinar', x: bx, z: bz, r: 3.0, mesh: bs,
    text: '🧵 Un calado a medio hacer: Doña Mencía saca hilos del lino uno a uno y borda flores con los que quedan. Lleva así desde el verano.' });
  // Mesa con el dibujo de la alfombra del Corpus
  const tx = -3.6, tz = -2.4;
  const tbl = new THREE.Group(); tbl.position.set(tx, 0, tz);
  tbl.add(box(1.8, 0.08, 1.0, M.tea, 0, 0.8, 0));
  for (const [a, c] of [[-0.8, -0.4], [0.8, -0.4], [-0.8, 0.4], [0.8, 0.4]]) tbl.add(box(0.08, 0.8, 0.08, M.woodD, a, 0.4, c));
  const plan = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.75).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: boardTexture(['CORPUS', '✿ ❀ ✿ ❀ ✿', 'tierras del Teide'], '#efe4c8', '#6a2a1a') }));
  plan.position.y = 0.85; plan.rotation.y = Math.PI; tbl.add(plan);
  g.add(tbl); cols.push({ x: tx, z: tz, hx: 0.95, hz: 0.55 });
  items.push({ kind: 'examinar', x: tx, z: tz, r: 3.0, mesh: tbl,
    text: '🌸 El dibujo de la alfombra de este año: flores rojas de los geranios, pétalos amarillos y tierras del Teide de siete colores. Cada cuadrito lleva un nombre de quién lo rellena.' });
  // Alfombra de flores a medio hacer (junto a la entrada, este)
  const af = new THREE.Group(); af.position.set(3.4, 0, -2.7);
  const AC = [M.flowers[0], M.flowers[1], M.flowers[2], M.straw, M.leaves, M.tea];
  for (let i = 0; i < 7; i++) for (let j = 0; j < 4; j++) {
    if (i > 4 && j > 1) continue;   // sin terminar
    af.add(box(0.36, 0.03, 0.36, AC[(i * 3 + j * 2 + (i * j) % 3) % AC.length], -1.1 + i * 0.37, 0.016, -0.55 + j * 0.37));
  }
  af.add(box(0.5, 0.25, 0.4, M.straw, 1.5, 0.12, 0.5));   // cesta de pétalos
  g.add(af);
  const afHit = box(2.8, 0.3, 1.6, M.hit, 3.4, 0.15, -2.7); g.add(afHit);
  items.push({ kind: 'examinar', x: 3.4, z: -2.7, r: 2.6, mesh: afHit,
    text: '🌺 Una alfombra de flores sin terminar. Bentor ensaya aquí para el Corpus. Se rellena a mano, pétalo a pétalo, y la primera procesión la deshace.' });
  // Arcón de tea (pared este) y retrato (pared oeste)
  const ar = box(1.5, 0.75, 0.7, M.tea, W / 2 - 0.55, 0.38, -0.2); ar.rotation.y = Math.PI / 2; g.add(ar);
  g.add(box(1.55, 0.06, 0.75, M.woodD, W / 2 - 0.55, 0.77, -0.2).rotateY(Math.PI / 2));
  cols.push({ x: W / 2 - 0.55, z: -0.2, hx: 0.4, hz: 0.8 });
  items.push({ kind: 'examinar', x: W / 2 - 0.55, z: -0.2, r: 2.6, mesh: ar,
    text: '🗝️ Un arcón de tea con cerradura de hierro. Dentro hay manteles bordados, cartas viejas y olor a membrillo.' });
  const rt = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 1.25), new THREE.MeshBasicMaterial({ map: boardTexture(['🎩', 'Don Lope', '1802'], '#3a2a1a', '#e8d8b0') }));
  rt.position.set(-W / 2 + 0.22, 1.7, -0.9); rt.rotation.y = Math.PI / 2; g.add(rt);
  items.push({ kind: 'examinar', x: -W / 2 + 0.9, z: -0.9, r: 3.0, mesh: rt,
    text: '🖼️ Retrato de Don Lope, el primer dueño. Doña Mencía dice que miraba igual de serio a las visitas que a las cuentas.' });
  // Luz de día del patio y una lámpara junto a la puerta (sin parpadeo)
  ctx.flicker = false;
  ctx.lights.push([poolLight(0xfff2d8, 1.1, 13, 1.4), px, 2.7, pz]);
  ctx.lights.push([poolLight(0xffd8a0, 0.6, 11, 1.5), -3.0, 2.4, -2.0]);
}

function buildBodega(b, ctx) {
  const { g, cols, items, W, D } = ctx;
  const exit = shell(g, W, D, M.floorStone, M.cellar);
  items.push({ kind: 'salida', x: 0, z: -D / 2 + 0.3, r: 1.8, mesh: exit });
  // Mostrador (Goyo detrás, en z ≈ 2.9) con vasos y la botella de sangre de drago
  const bz = 1.95;
  g.add(box(5.4, 1.1, 0.7, M.wood, 0, 0.55, bz), box(5.6, 0.1, 0.85, M.woodL, 0, 1.13, bz));
  for (let i = 0; i < 4; i++) g.add(cyl(0.05, 0.06, 0.16, M.glass[1], -1.8 + i * 0.6, 1.26, bz, 6));
  cols.push({ x: 0, z: bz, hx: 2.8, hz: 0.45 });
  const dj = new THREE.Group(); dj.position.set(2.2, 1.18, bz);
  dj.add(cyl(0.11, 0.14, 0.32, new THREE.MeshLambertMaterial({ color: 0x8a0a0a, transparent: true, opacity: 0.9 }), 0, 0.16, 0, 8), cyl(0.04, 0.05, 0.12, M.woodD, 0, 0.38, 0, 6));
  g.add(dj);
  const djHit = box(0.5, 0.6, 0.5, M.hit, 2.2, 1.4, bz); g.add(djHit);
  items.push({ kind: 'examinar', x: 2.2, z: bz - 0.8, r: 2.6, mesh: djHit,
    text: '🩸 Un frasco de savia de drago, roja como la sangre. Goyo la usa para sellar las barricas buenas. «Ni se te ocurra bebértela».' });
  // Estantería de botellas detrás del mostrador
  const sz = D / 2 - 0.45;
  g.add(box(5.0, 2.2, 0.4, M.woodD, 0, 1.1, sz));
  for (let r = 0; r < 3; r++) {
    g.add(box(4.8, 0.06, 0.42, M.woodL, 0, 0.55 + r * 0.6, sz - 0.02));
    for (let k = 0; k < 9; k++) g.add(cyl(0.06, 0.07, 0.3, M.glass[k % 3 === 0 ? 0 : 1], -2.2 + k * 0.55, 0.74 + r * 0.6, sz - 0.05, 6));
  }
  cols.push({ x: 0, z: sz, hx: 2.6, hz: 0.3 });
  // Barricas tumbadas en dos alturas (pared oeste)
  const wx = -W / 2 + 0.7;
  for (let z = -3.2; z <= 3.3; z += 0.95) { barrel(g, wx, z, true, 0); if (z > -2.5) barrel(g, wx, z + 0.47, true, 0.82); }
  g.add(box(0.12, 0.1, 6.9, M.woodD, wx + 0.35, 0.05, 0.05), box(0.12, 0.1, 6.9, M.woodD, wx - 0.35, 0.05, 0.05));
  cols.push({ x: wx, z: 0.05, hx: 0.55, hz: 3.5 });
  const brHit = box(1.0, 1.8, 7, M.hit, wx, 0.9, 0.05); g.add(brHit);
  items.push({ kind: 'examinar', x: wx + 0.6, z: 0, r: 2.6, mesh: brHit,
    text: '🍷 Barricas de malvasía. Cada una lleva escrito con tiza el año y la viña. Una pone «NO TOCAR — Goyo» tres veces.' });
  // Lagar de viga (este): tina de madera con mosto, viga larga y piedra de peso
  const lx = W / 2 - 1.9, lz = 1.4;
  const lg = new THREE.Group(); lg.position.set(lx, 0, lz);
  lg.add(box(2.4, 0.7, 1.8, M.wood, 0, 0.35, 0), box(2.1, 0.04, 1.5, M.grapes, 0, 0.68, 0));
  for (const sx of [-1.1, 1.1]) lg.add(box(0.25, 2.5, 0.25, M.woodD, sx, 1.25, -0.95));
  const viga = box(4.2, 0.32, 0.32, M.woodD, -0.4, 2.2, 0); viga.rotation.z = -0.08; lg.add(viga);
  lg.add(cyl(0.35, 0.35, 0.5, M.stone, -2.2, 0.25, 0, 10), box(0.08, 1.8, 0.08, M.iron, -2.2, 1.3, 0));
  g.add(lg); cols.push({ x: lx, z: lz, hx: 1.3, hz: 1.0 }, { x: lx - 2.2, z: lz, hx: 0.4, hz: 0.4 });
  items.push({ kind: 'examinar', x: lx, z: lz - 1.2, r: 3.0, mesh: lg,
    text: '🍇 El lagar de viga. Se pisa la uva en la tina y luego la viga, con la piedra colgando, exprime lo que queda. Huele a mosto dulce.' });
  // Cestas de uva junto a Nieves
  for (const [x, z] of [[4.9, -2.6], [5.6, -1.9]]) {
    g.add(cyl(0.38, 0.3, 0.45, M.straw, x, 0.23, z, 10));
    for (let k = 0; k < 5; k++) { const gr = new THREE.Mesh(new THREE.SphereGeometry(0.12, 6, 5), M.grapes); gr.position.set(x - 0.15 + (k % 3) * 0.15, 0.5, z - 0.1 + (k > 2 ? 0.18 : 0)); g.add(gr); }
    cols.push({ x, z, hx: 0.4, hz: 0.4 });
  }
  // Mesa con vino y queso
  table(g, cols, -2.4, -2.2);
  // Un hijo del drago en una maceta (junto a la puerta, oeste)
  const dr = new THREE.Group(); dr.position.set(-3.7, 0, -3.6);
  dr.add(cyl(0.45, 0.35, 0.6, M.pot, 0, 0.3, 0, 10), cyl(0.12, 0.16, 1.2, M.stoneD, 0, 1.2, 0, 8));
  for (let k = 0; k < 4; k++) {
    const a = k / 4 * Math.PI * 2 + 0.4;
    const br = cyl(0.06, 0.09, 0.7, M.stoneD, Math.cos(a) * 0.22, 1.95, Math.sin(a) * 0.22, 6); br.rotation.set(Math.sin(a) * 0.6, 0, -Math.cos(a) * 0.6); dr.add(br);
    const tuft = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.45, 7), M.leaves); tuft.position.set(Math.cos(a) * 0.48, 2.35, Math.sin(a) * 0.48); tuft.rotation.x = Math.PI; dr.add(tuft);
  }
  g.add(dr); cols.push({ x: -3.7, z: -3.6, hx: 0.45, hz: 0.45 });
  items.push({ kind: 'examinar', x: -3.7, z: -3.6, r: 2.6, mesh: dr,
    text: '🌴 Un dragillo en una maceta, nacido de una semilla del drago de la plaza. Goyo dice que cuando tenga flores se jubila. Le quedan unos veinte años.' });
  // Velas (luz cálida que parpadea un poco)
  ctx.lights.push([poolLight(0xffc070, 1.2, 11, 1.4), 0, 2.4, 0.6]);
  ctx.lights.push([poolLight(0xffd8a0, 0.6, 12, 1.5), -3.0, 2.4, -2.0]);
  for (const [x, z] of [[-0.9, bz], [0.9, bz]]) { const c = cyl(0.05, 0.05, 0.2, M.candle, x, 1.28, z, 6); g.add(c); ctx.flames.push(c); }
}

function buildMolino(b, ctx) {
  const { g, cols, items, W, D } = ctx;
  const exit = shell(g, W, D, M.floorStone, M.wall);
  items.push({ kind: 'salida', x: 0, z: -D / 2 + 0.3, r: 1.8, mesh: exit });
  // El molino: dos muelas de piedra sobre una plataforma, la tolva de madera encima y el cajón de la harina
  const mx = 1.2, mz = D / 2 - 1.7;
  const ml = new THREE.Group(); ml.position.set(mx, 0, mz);
  ml.add(box(2.6, 0.6, 2.2, M.stone, 0, 0.3, 0));
  ml.add(cyl(0.85, 0.85, 0.24, M.stoneD, 0, 0.72, 0, 16), cyl(0.85, 0.85, 0.24, M.stone, 0, 0.97, 0, 16));
  for (const [a, c] of [[-0.7, -0.6], [0.7, -0.6], [-0.7, 0.6], [0.7, 0.6]]) ml.add(box(0.1, 1.4, 0.1, M.woodD, a, 1.6, c));
  const tolva = new THREE.Mesh(new THREE.ConeGeometry(0.75, 0.9, 4), M.wood); tolva.rotation.set(Math.PI, Math.PI / 4, 0); tolva.position.y = 2.1; ml.add(tolva);
  ml.add(box(0.12, 0.45, 0.12, M.woodL, 0, 1.45, 0));
  ml.add(box(0.9, 0.5, 0.6, M.woodL, 0, 0.25, -1.45), box(0.8, 0.05, 0.5, M.linen, 0, 0.51, -1.45));
  const palo = box(0.1, 0.1, 1.4, M.woodD, 0.55, 1.15, 0.2); palo.rotation.x = 0.25; ml.add(palo);   // la manivela
  g.add(ml); cols.push({ x: mx, z: mz, hx: 1.35, hz: 1.15 }, { x: mx, z: mz - 1.45, hx: 0.5, hz: 0.35 });
  items.push({ kind: 'examinar', x: mx, z: mz - 1.0, r: 3.0, mesh: ml,
    text: '🌾 El molino de La Majada. El millo tostado cae de la tolva entre las dos muelas y sale gofio, fino como el polvo. Las muelas son de piedra del malpaís: no se gastan nunca.' });
  // Tostador: hogar de piedra con fuego y la tostadora de barro (pared oeste)
  const tx = -W / 2 + 0.8, tz = -0.4;
  const hg = new THREE.Group(); hg.position.set(tx, 0, tz);
  hg.add(box(1.0, 0.75, 1.6, M.stone, 0, 0.38, 0), box(0.6, 0.35, 1.1, M.coal, 0.25, 0.25, 0));
  const fl = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.45, 6), M.fire); fl.position.set(0.3, 0.42, 0); hg.add(fl);
  hg.add(cyl(0.55, 0.45, 0.12, M.pot, 0.1, 0.82, 0, 14));
  for (let k = 0; k < 7; k++) hg.add(box(0.07, 0.05, 0.07, M.straw, -0.2 + (k % 4) * 0.13, 0.9, -0.2 + Math.floor(k / 4) * 0.25));
  hg.add(box(0.7, 1.6, 0.9, M.stone, -0.15, 1.8, 0));
  g.add(hg); cols.push({ x: tx, z: tz, hx: 0.6, hz: 0.85 });
  ctx.flames.push(fl);
  items.push({ kind: 'examinar', x: tx + 0.9, z: tz, r: 2.8, mesh: hg,
    text: '🔥 La tostadora de barro. Aquí se tuesta el millo hasta que cruje; si se quema, el gofio sale amargo y Tía Benita te lo hace comer igual.' });
  ctx.lights.push([poolLight(0xffa050, 1.2, 10, 1.4), tx + 1.0, 1.2, tz]);
  // Sacos de millo y de gofio (pared este)
  const sx0 = W / 2 - 0.75, sz0 = 1.9;
  const sk = new THREE.Group(); sk.position.set(sx0, 0, sz0);
  for (const [x, z, y] of [[0, -0.6, 0], [0, 0.1, 0], [0, 0.8, 0], [-0.05, -0.25, 0.52], [-0.05, 0.45, 0.52]]) sk.add(box(0.7, 0.55, 0.62, M.straw, x, 0.28 + y, z));
  for (const z of [-0.6, 0.1, 0.8]) sk.add(box(0.72, 0.08, 0.64, M.woodD, 0, 0.55, z));
  g.add(sk); cols.push({ x: sx0, z: sz0, hx: 0.45, hz: 1.15 });
  items.push({ kind: 'examinar', x: sx0 - 0.8, z: sz0, r: 2.6, mesh: sk,
    text: '🌽 Sacos de millo de las medianías y de trigo de Arico. En cada saco hay escrito con carbón de quién es: el molino muele para todo el pueblo.' });
  // Mesa con el zurrón de piel de cabra
  const mt = table(g, cols, -2.4, -2.6, false);
  const zu = new THREE.Mesh(new THREE.SphereGeometry(0.26, 10, 8), M.skin); zu.scale.set(1, 0.75, 1.3); zu.position.set(0.3, 1.02, 0); mt.add(zu);
  mt.add(cyl(0.05, 0.07, 0.14, M.skin, 0.3, 1.2, -0.3, 6));
  items.push({ kind: 'examinar', x: -2.4, z: -2.6, r: 2.8, mesh: mt,
    text: '🐐 Un zurrón de piel de cabra. Se echa gofio, agua y una pizca de sal, se amasa apretando el zurrón… y ya tienes comida para todo el día en el monte.' });
  // Dibujo de las pirámides colgado en la pared este
  const pir = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 1.0), new THREE.MeshBasicMaterial({ map: boardTexture(['PIRÁMIDES', '▲  ▲  ▲', 'de Güímar'], '#e8dcc0', '#5a3a1a') }));
  pir.position.set(W / 2 - 0.22, 1.75, -1.6); pir.rotation.y = -Math.PI / 2; g.add(pir);
  items.push({ kind: 'examinar', x: W / 2 - 0.9, z: -1.6, r: 3.0, mesh: pir,
    text: '🔺 Un dibujo de las pirámides de Güímar: escalones de piedra negra sin argamasa. Mauro ha escrito debajo: «¿Quién las hizo?». Y alguien ha contestado: «Yo no».' });
  // Cayado y cencerros de Mauro junto a la entrada
  const cy = box(0.07, 1.7, 0.07, M.woodD, 4.6, 0.85, -3.9); cy.rotation.z = 0.15; g.add(cy);
  for (let k = 0; k < 3; k++) g.add(cyl(0.08, 0.1, 0.14, M.bronze, W / 2 - 0.3, 1.5, -3.6 + k * 0.25, 6));
  // Luz de día que entra por la puerta
  ctx.lights.push([poolLight(0xfff2d8, 0.8, 12, 1.5), 0.5, 2.5, -1.0]);
}

function buildCasaFuerte(b, ctx) {
  const { g, cols, items, W, D } = ctx;
  const exit = shell(g, W, D, M.floorStone, M.fort);
  items.push({ kind: 'salida', x: 0, z: -D / 2 + 0.3, r: 1.8, mesh: exit });
  // Aspilleras en la pared norte (ranuras de luz)
  for (const x of [-4, 0, 4]) { g.add(box(0.22, 1.0, 0.1, M.candle, x, 1.7, D / 2 - 0.19)); g.add(box(0.5, 1.2, 0.06, M.stoneD, x, 1.7, D / 2 - 0.17)); }
  // Cañón mirando a la aspillera central
  const cx = 0.3, cz = D / 2 - 1.7;
  const cn = new THREE.Group(); cn.position.set(cx, 0, cz);
  cn.add(box(1.0, 0.35, 2.0, M.wood, 0, 0.5, 0));
  for (const sx of [-0.62, 0.62]) for (const sz of [-0.65, 0.65]) { const w = cyl(0.36, 0.36, 0.12, M.woodD, sx, 0.36, sz, 12); w.rotation.z = Math.PI / 2; cn.add(w); }
  const br = cyl(0.18, 0.28, 2.2, M.iron, 0, 0.95, 0.35, 12); br.rotation.x = Math.PI / 2 - 0.1; cn.add(br);
  g.add(cn); cols.push({ x: cx, z: cz, hx: 0.75, hz: 1.2 });
  items.push({ kind: 'examinar', x: cx, z: cz - 1.4, r: 3.0, mesh: cn,
    text: '💣 Un cañón de hierro apuntando al mar. Desde aquí se veían llegar los barcos piratas por la costa de Adeje. Don Tomé lo limpia cada lunes aunque no se dispara desde hace siglos.' });
  const pb = barrel(g, cx - 1.4, cz + 0.4); cols.push({ x: cx - 1.4, z: cz + 0.4, hx: 0.45, hz: 0.45 });
  for (let k = 0; k < 6; k++) { const ball = new THREE.Mesh(new THREE.SphereGeometry(0.13, 6, 5), M.iron); ball.position.set(cx + 1.2 + (k % 3) * 0.27, 0.13 + (k > 2 ? 0.22 : 0), cz + 0.5 + (k > 2 ? 0.12 : 0)); g.add(ball); }
  items.push({ kind: 'examinar', x: cx - 1.4, z: cz - 0.6, r: 2.4, mesh: pb, text: '🛢️ Un barril con letras rojas: «PÓLVORA». Está vacío. Don Tomé dice que mejor así.' });
  // Mesa de mapas (Iraya detrás)
  const mx = 3.6, mz = 0.0;
  const mt = new THREE.Group(); mt.position.set(mx, 0, mz);
  mt.add(box(1.9, 0.08, 1.1, M.woodL, 0, 0.82, 0));
  for (const [a, c] of [[-0.85, -0.45], [0.85, -0.45], [-0.85, 0.45], [0.85, 0.45]]) mt.add(box(0.08, 0.82, 0.08, M.woodD, a, 0.41, c));
  const map = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.9).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: boardTexture(['COSTA SUR', '⚓  ☠  ⚓', 'Adeje · La Caleta'], '#e8d8b0', '#3a2a14') }));
  map.position.y = 0.87; map.rotation.y = Math.PI; mt.add(map);
  mt.add(cyl(0.04, 0.04, 0.5, M.bronze, 0.7, 0.9, 0.3, 6).rotateZ(Math.PI / 2));   // catalejo
  g.add(mt); cols.push({ x: mx, z: mz, hx: 1.0, hz: 0.6 });
  items.push({ kind: 'examinar', x: mx, z: mz - 1.0, r: 3.0, mesh: mt,
    text: '🗺️ Un mapa de la costa sur, de Los Cristianos a La Caleta. Las calaveras marcan dónde desembarcaban los piratas. Iraya está añadiendo los senderos del Barranco del Infierno.' });
  // Armero con arcabuces y picas (pared oeste)
  const rk = new THREE.Group(); rk.position.set(-W / 2 + 0.45, 0, -0.4);
  rk.add(box(0.3, 1.9, 2.8, M.woodD, 0, 0.95, 0));
  for (let k = 0; k < 5; k++) { rk.add(box(0.05, 1.5, 0.07, M.wood, -0.2, 1.0, -1.1 + k * 0.55), box(0.06, 0.4, 0.05, M.iron, -0.2, 1.6, -1.1 + k * 0.55)); }
  rk.add(box(0.04, 2.3, 0.04, M.woodL, -0.22, 1.15, 1.25), new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.3, 4), M.ironL).translateX(-0.22).translateY(2.4).translateZ(1.25));
  g.add(rk); cols.push({ x: -W / 2 + 0.45, z: -0.4, hx: 0.3, hz: 1.45 });
  items.push({ kind: 'examinar', x: -W / 2 + 1.1, z: -0.4, r: 3.0, mesh: rk,
    text: '🔫 Arcabuces viejos y una pica. Con esto se defendía la casa cuando sonaba la campana de aviso. Ninguno dispara ya; uno tiene un nido de pájaro dentro.' });
  // Cofre del azúcar (pared este, junto a la puerta)
  const ch = new THREE.Group(); ch.position.set(W / 2 - 0.65, 0, -2.6);
  ch.add(box(0.8, 0.6, 1.3, M.wood, 0, 0.3, 0), box(0.84, 0.12, 1.34, M.woodD, 0, 0.66, 0), box(0.1, 0.18, 0.18, M.iron, -0.41, 0.52, 0));
  g.add(ch); cols.push({ x: W / 2 - 0.65, z: -2.6, hx: 0.45, hz: 0.7 });
  items.push({ kind: 'examinar', x: W / 2 - 1.3, z: -2.6, r: 2.6, mesh: ch,
    text: '🍬 Un cofre con cerradura de hierro. Dentro guardaban los panes de azúcar del ingenio antes de mandarlos al barco. Ahora guarda las llaves de todo y un bocadillo de Don Tomé.' });
  // Estandarte de la casa (pared este)
  const st = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 1.4), new THREE.MeshBasicMaterial({ map: boardTexture(['ADEJE', '⚜', 'Casa Fuerte'], '#6a1a1a', '#e8c560') }));
  st.position.set(W / 2 - 0.22, 1.9, 1.8); st.rotation.y = -Math.PI / 2; g.add(st);
  // Escalera de piedra a las almenas (esquina SO)
  const es = new THREE.Group(); es.position.set(-W / 2 + 1.3, 0, -D / 2 + 1.6);
  for (let k = 0; k < 6; k++) es.add(box(1.2, 0.3 * (k + 1), 0.4, M.stone, 0, 0.15 * (k + 1), 1.2 - k * 0.4));
  g.add(es); cols.push({ x: -W / 2 + 1.3, z: -D / 2 + 1.6, hx: 0.65, hz: 1.25 });
  items.push({ kind: 'examinar', x: -W / 2 + 1.3, z: -D / 2 + 3.2, r: 2.6, mesh: es,
    text: '🪜 La escalera sube a las almenas. Hay una cuerda cruzada y un cartel: «CERRADO POR VIENTO». Lleva ahí desde hace años, haga el viento que haga.' });
  // Luz: antorchas en la pared y la de las aspilleras
  ctx.lights.push([poolLight(0xffb060, 1.1, 11, 1.4), -3.0, 2.3, 2.6]);
  ctx.lights.push([poolLight(0xfff0d0, 0.7, 12, 1.5), 2.0, 2.5, -1.0]);
  for (const [x, z] of [[-2.0, D / 2 - 0.3], [2.0, D / 2 - 0.3]]) { g.add(box(0.08, 0.4, 0.08, M.woodD, x, 2.0, z)); const f = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.25, 6), M.fire); f.position.set(x, 2.32, z); g.add(f); ctx.flames.push(f); }
}

function boat() {   // barquita de pesca (casco blanco, borda azul)
  const g = new THREE.Group();
  g.add(box(1.2, 0.5, 3.4, M.boatW, 0, 0.45, 0), box(1.3, 0.14, 3.5, M.boatB, 0, 0.74, 0), box(1.0, 0.12, 3.0, M.wood, 0, 0.62, 0));
  const pr = new THREE.Mesh(new THREE.ConeGeometry(0.65, 1.0, 4), M.boatW); pr.rotation.set(Math.PI / 2, Math.PI / 4, 0); pr.scale.set(1, 1, 0.75); pr.position.set(0, 0.5, 2.15); g.add(pr);
  g.add(box(0.1, 0.12, 1.2, M.boatR, 0.61, 0.5, 0), box(0.1, 0.12, 1.2, M.boatR, -0.61, 0.5, 0));
  for (const z of [-1.2, 0.2]) g.add(box(1.05, 0.06, 0.3, M.woodL, 0, 0.7, z));
  for (const z of [-1.3, 1.1]) g.add(box(1.5, 0.22, 0.2, M.woodD, 0, 0.11, z));   // varaderas
  return g;
}

function buildCofradia(b, ctx) {
  const { g, cols, items, W, D } = ctx;
  const exit = shell(g, W, D, M.floorStone, M.wall);
  items.push({ kind: 'salida', x: 0, z: -D / 2 + 0.3, r: 1.8, mesh: exit });
  // Redes colgadas en la pared oeste, con corchos
  const rx = -W / 2 + 0.25;
  const nt = new THREE.Group(); nt.position.set(rx, 0, 0.6);
  for (let k = 0; k <= 10; k++) nt.add(box(0.03, 1.9, 0.03, M.net, 0, 1.25, -2.0 + k * 0.4));
  for (let k = 0; k <= 6; k++) nt.add(box(0.03, 0.03, 4.0, M.net, 0, 0.35 + k * 0.3, 0));
  for (let k = 0; k < 9; k++) { const c = new THREE.Mesh(new THREE.SphereGeometry(0.09, 6, 5), M.cork); c.position.set(0.06, 2.2, -1.9 + k * 0.48); nt.add(c); }
  g.add(nt);
  const ntHit = box(0.5, 2.2, 4.2, M.hit, rx + 0.2, 1.2, 0.6); g.add(ntHit);
  items.push({ kind: 'examinar', x: rx + 0.9, z: 0.6, r: 2.8, mesh: ntHit,
    text: '🕸️ Redes de trasmallo puestas a secar, con sus corchos naranjas. Huelen a mar aunque lleven una semana aquí colgadas.' });
  // La barca en sus caballetes (centro-este)
  const bx = 2.6, bz = 0.8;
  const bt = boat(); bt.position.set(bx, 0.35, bz); bt.rotation.y = 0.15; g.add(bt);
  for (const z of [-1.0, 1.0]) g.add(box(1.4, 0.35, 0.25, M.woodD, bx + Math.sin(0.15) * z, 0.18, bz + z));
  const nm = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.32), new THREE.MeshBasicMaterial({ map: boardTexture(['LA CARMENCITA'], '#f0efe8', '#2a5a9a') }));
  nm.position.set(0.66, 0.9, 0.9); nm.rotation.y = Math.PI / 2; bt.add(nm);
  cols.push({ x: bx, z: bz, hx: 0.85, hz: 2.2 });
  items.push({ kind: 'examinar', x: bx - 1.3, z: bz, r: 3.0, mesh: bt,
    text: '⛵ «La Carmencita», la barca del Patrón Isidro, recién pintada. Tiene más años que él y, según él, más paciencia.' });
  // Mesa de remendar (Rosario al lado) con red amontonada y la aguja
  const mt = table(g, cols, 3.4, -2.6, false);
  const pile = new THREE.Mesh(new THREE.SphereGeometry(0.5, 8, 6), M.net); pile.scale.set(1.3, 0.35, 0.8); pile.position.set(-0.1, 0.95, 0); mt.add(pile);
  mt.add(box(0.03, 0.02, 0.3, M.woodL, 0.55, 0.86, 0.2));
  items.push({ kind: 'examinar', x: 3.4, z: -2.6, r: 2.8, mesh: mt,
    text: '🪡 Una red con un agujero del tamaño de un perro. La aguja de remendar es de madera y Rosario la maneja más rápido que tú un tenedor.' });
  // Cajas de pescado y barriles de salazón (esquina NE)
  for (const [x, z] of [[W / 2 - 0.7, D / 2 - 0.7], [W / 2 - 1.6, D / 2 - 0.7]]) {
    g.add(box(0.8, 0.3, 0.55, M.woodL, x, 0.15, z));
    for (let k = 0; k < 4; k++) { const f = new THREE.Mesh(new THREE.SphereGeometry(0.08, 6, 4), M.fish); f.scale.set(1, 0.5, 3); f.position.set(x - 0.27 + k * 0.18, 0.33, z); g.add(f); }
  }
  cols.push({ x: W / 2 - 1.15, z: D / 2 - 0.7, hx: 0.9, hz: 0.35 });
  const sl = barrel(g, W / 2 - 0.6, D / 2 - 1.7); barrel(g, W / 2 - 0.6, D / 2 - 2.6);
  cols.push({ x: W / 2 - 0.6, z: D / 2 - 2.15, hx: 0.45, hz: 0.9 });
  items.push({ kind: 'examinar', x: W / 2 - 1.3, z: D / 2 - 2.0, r: 2.6, mesh: sl,
    text: '🧂 Barriles de pescado salado. Así se guardaba el pescado antes de que hubiera neveras: sal gorda de las salinas y mucha paciencia.' });
  // Pizarra de mareas y estandarte del Carmen (pared norte)
  const mr = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.0), new THREE.MeshBasicMaterial({ map: boardTexture(['MAREAS', 'pleamar 07:12', 'bajamar 13:30']) }));
  mr.position.set(-0.6, 1.75, D / 2 - 0.21); mr.rotation.y = Math.PI; g.add(mr);
  items.push({ kind: 'examinar', x: -0.6, z: D / 2 - 0.9, r: 3.2, mesh: mr,
    text: '🌊 La pizarra de las mareas. Debajo alguien ha escrito: «Si sale el Patrón, NO hay mala mar».' });
  const es = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 1.3), new THREE.MeshBasicMaterial({ map: boardTexture(['CARMEN', '⚓', '16 de julio'], '#2a4a7a', '#f0e0a0') }));
  es.position.set(2.4, 1.85, D / 2 - 0.21); es.rotation.y = Math.PI; g.add(es);
  items.push({ kind: 'examinar', x: 2.4, z: D / 2 - 0.9, r: 3.0, mesh: es,
    text: '🎏 El estandarte de la fiesta del Carmen. En julio sacan a la Virgen en barca por la bahía y todo el pueblo sale detrás, en barcas, en flotadores o nadando.' });
  // Luces: farol de barco y la luz del mar que entra por la puerta
  ctx.flicker = false;
  ctx.lights.push([poolLight(0xfff0d8, 1.1, 12, 1.4), 0.5, 2.6, 0.5]);
  ctx.lights.push([poolLight(0xd8e8ff, 0.6, 11, 1.5), -2.5, 2.4, -2.5]);
  const fa = cyl(0.12, 0.12, 0.3, M.candle, 0.5, 2.3, 0.5, 8); g.add(fa, box(0.03, 0.4, 0.03, M.iron, 0.5, 2.6, 0.5));
}

function buildPinero(b, ctx) {
  const { g, cols, items, W, D } = ctx;
  const exit = shell(g, W, D, M.floorWood, M.wall);
  items.push({ kind: 'salida', x: 0, z: -D / 2 + 0.3, r: 1.8, mesh: exit });
  // Cocina de leña en la esquina NO (hace frío en Vilaflor)
  const fx = -W / 2 + 1.1, fz = D / 2 - 1.0;
  const fg = new THREE.Group(); fg.position.set(fx, 0, fz);
  fg.add(box(1.6, 0.9, 1.2, M.stone, 0, 0.45, 0), box(0.8, 0.45, 0.2, M.coal, 0, 0.42, -0.55), box(1.7, 0.1, 1.3, M.iron, 0, 0.95, 0));
  const fl = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.4, 6), M.fire); fl.position.set(0, 0.4, -0.55); fg.add(fl);
  fg.add(cyl(0.22, 0.2, 0.3, M.iron, 0.35, 1.15, 0, 10), box(0.4, 2.2, 0.4, M.stone, -0.4, 2.0, 0.3));
  g.add(fg); cols.push({ x: fx, z: fz, hx: 0.85, hz: 0.65 });
  ctx.flames.push(fl);
  ctx.lights.push([poolLight(0xffa050, 1.3, 10, 1.4), fx + 0.4, 1.1, fz - 1.2]);
  items.push({ kind: 'examinar', x: fx + 0.5, z: fz - 1.3, r: 2.8, mesh: fg,
    text: '🔥 La cocina de leña, encendida hasta en agosto. En la olla hay potaje de berros. Don Eusebio dice que en Vilaflor el frío se quita por dentro.' });
  // Rodaja de pino canario colgada (pared norte)
  const ro = new THREE.Group(); ro.position.set(1.2, 1.8, D / 2 - 0.3);
  const disc = cyl(0.8, 0.8, 0.14, M.woodL, 0, 0, 0, 20); disc.rotation.x = Math.PI / 2; ro.add(disc);
  for (const [r, m] of [[0.6, M.wood], [0.4, M.woodL], [0.25, M.tea]]) { const c = cyl(r, r, 0.15, m, 0, 0, -0.005, 18); c.rotation.x = Math.PI / 2; ro.add(c); }
  g.add(ro);
  items.push({ kind: 'examinar', x: 1.2, z: D / 2 - 1.0, r: 3.0, mesh: ro,
    text: '🌲 Una rodaja de pino canario con el corazón rojo de tea. Tiene más de trescientos anillos. El pino canario aguanta el fuego: se quema por fuera y al año siguiente vuelve a echar hojas.' });
  // Montón de pinocha y rastrillo (pared este)
  const px = W / 2 - 1.1, pz = 1.6;
  const pc = new THREE.Mesh(new THREE.ConeGeometry(1.0, 0.9, 10), M.pinocha); pc.position.set(px, 0.45, pz); pc.scale.set(1, 1, 1.3); g.add(pc);
  const rs = box(0.06, 1.8, 0.06, M.woodD, px + 0.6, 0.9, pz - 1.4); rs.rotation.z = -0.2; g.add(rs, box(0.6, 0.06, 0.06, M.iron, px + 0.42, 0.06, pz - 1.4));
  cols.push({ x: px, z: pz, hx: 0.95, hz: 1.2 });
  items.push({ kind: 'examinar', x: px - 1.2, z: pz, r: 2.8, mesh: pc,
    text: '🍂 Pinocha: las agujas secas del pino. Se recoge en el monte para cama de las cabras y para empaquetar los plátanos. Pincha, pero huele de maravilla.' });
  // Mesa con piñas, el botijo de agua y el mapa del pinar
  const mt = table(g, cols, -2.2, -1.8, false);
  for (let k = 0; k < 3; k++) { const pn = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.24, 7), M.wood); pn.position.set(-0.5 + k * 0.2, 0.97, 0.15); mt.add(pn); }
  const bo = new THREE.Group(); bo.position.set(0.45, 0.85, -0.1);
  bo.add(new THREE.Mesh(new THREE.SphereGeometry(0.17, 10, 8), M.pot).translateY(0.17), cyl(0.03, 0.04, 0.16, M.pot, 0.09, 0.36, 0, 6));
  mt.add(bo);
  items.push({ kind: 'examinar', x: -2.2, z: -1.8, r: 2.8, mesh: mt,
    text: '💧 Un botijo con agua de los manantiales de Vilaflor, fresquita aunque fuera haga sol. Dicen que es la mejor agua de la isla; aquí nadie lo discute.' });
  // Herramientas en la pared oeste: hacha, sierra y la azada
  const tr = new THREE.Group(); tr.position.set(-W / 2 + 0.25, 0, -1.2);
  tr.add(box(0.06, 0.08, 2.4, M.woodD, 0, 2.1, 0));
  tr.add(box(0.05, 1.0, 0.07, M.woodL, 0.05, 1.5, -0.8), box(0.05, 0.25, 0.35, M.ironL, 0.05, 1.95, -0.75));
  tr.add(box(0.03, 0.25, 1.0, M.ironL, 0.05, 1.7, 0.25), box(0.05, 0.3, 0.1, M.woodD, 0.05, 1.7, 0.8));
  g.add(tr);
  items.push({ kind: 'examinar', x: -W / 2 + 0.9, z: -1.2, r: 2.8, mesh: tr,
    text: '🪓 El hacha del pinero, más vieja que el propio Don Eusebio. Solo se usa con los pinos caídos: los vivos no se tocan.' });
  // Sacos de papas junto a la puerta
  for (const [x, z] of [[-4.6, -3.7], [-3.9, -3.9]]) g.add(box(0.6, 0.55, 0.5, M.straw, x, 0.28, z));
  cols.push({ x: -4.25, z: -3.8, hx: 0.65, hz: 0.35 });
  ctx.lights.push([poolLight(0xffd8a0, 0.7, 12, 1.5), 1.5, 2.6, -0.5]);
}

function buildInterior(b) {
  mats();
  const R = b.room, W = R.W, D = R.D;
  const g = new THREE.Group(); g.position.set(R.x, 0, R.z);
  const ctx = { g, cols: [], items: [], flames: [], lights: [], W, D };
  const BUILD = { taberna: buildTaberna, herreria: buildHerreria, casa: buildCasaBalcones, bodega: buildBodega, molino: buildMolino, casafuerte: buildCasaFuerte,
    cofradia: buildCofradia, pinero: buildPinero };
  (BUILD[b.kind] || buildHerreria)(b, ctx);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(W + 6, D + 6).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }));
  floor.position.set(R.x, 0.02, R.z); floor.userData = { kind: 'town-building-floor' };
  const lights = ctx.lights.map(([l, x, y, z]) => { l.position.set(R.x + x, y, R.z + z); return l; });
  return { b, group: g, floor, items: ctx.items, cols: ctx.cols, flames: ctx.flames, lights, W, D, t: 0,
    flicker: ctx.flicker !== false, base: lights[0]?.intensity || 1 };
}

// ============================================================
// Entrar / salir
// ============================================================
const ENTER_MSG = {
  taberna: (b) => `🍷 Entras en la ${b.name}. Huele a leña, a vino y a gofio.`,
  herreria: (b) => `⚒ Entras en la ${b.name}. El martillo suena como una campana.`,
  casa: (b) => `🏛 Entras en la ${b.name}. Un patio con helechos, una fuente y un balcón de madera roja.`,
  bodega: (b) => `🍇 Entras en la ${b.name}. Fresquito, oscuro y con olor a mosto.`,
  molino: (b) => `🌾 Entras en el ${b.name}. Huele a millo tostado y todo tiene una capa de polvo blanco.`,
  casafuerte: (b) => `🏰 Entras en la ${b.name}. Muros de un metro, aspilleras y olor a pólvora vieja.`,
  cofradia: (b) => `⚓ Entras en la ${b.name}. Redes colgadas, olor a salitre y una radio que habla del tiempo.`,
  pinero: (b) => `🌲 Entras en la ${b.name}. Huele a resina y a leña. Fuera hace frío: estás en el pueblo más alto de la isla.`,
};
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
  feedLog('info', ENTER_MSG[b.kind]?.(b) || `Entras en ${b.name}.`);
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
  if (inside.flicker && inside.lights[0]) inside.lights[0].intensity = inside.base + Math.sin(t * 13) * 0.12 + Math.sin(t * 7.3) * 0.1;
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
    const r = b.clear || Math.max(b.w, b.d) / 2 + 5;
    try { terrain.addKeepout?.(b.x, b.z, r); terrain.clearTreesNear?.(b.x, b.z, r); } catch {}
  }
}

export function getMapIcons() {
  const ICON = { taberna: 'tavern', bodega: 'tavern', herreria: 'anvil', casa: 'history', molino: 'history', casafuerte: 'history', cofradia: 'history', pinero: 'history' };
  return TOWN_BUILDINGS.map(b => ({ x: b.x, z: b.z, kind: ICON[b.kind] || 'quest', name: b.name }));
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
