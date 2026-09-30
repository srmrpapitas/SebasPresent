/**
 * SebasPresent — Castle module (Sesión 40)
 *
 * OBJETIVO (pedido de Nico): una estructura GRANDE que se pueda ENTRAR
 * caminando, en el MISMO mundo, SIN teletransporte a "otro mundo".
 *
 * Cómo lo logra, y por qué NO hay teleport:
 *   - El banco/GE/tienda son SOLO overlays de UI (openBankOverlay, ge.openOverlay,
 *     shop.open). NO necesitan el truco del interior en (10000,10000). El sistema
 *     viejo te teletransportaba solo para MOSTRAR la sala. Acá no hace falta:
 *   - Colocamos el castillo como landmark en el mundo real.
 *   - Dentro, en coords del MUNDO REAL, ponemos un BANQUERO (un grupo simple +
 *     nombre). Caminás hasta él y al tappear se abre el banco. Cero teleport,
 *     mismo cielo, mismo mundo.
 *   - Colisión perimetral: las paredes del castillo bloquean, pero dejamos un
 *     HUECO de puerta (gate) por donde entrás. Configurable.
 *
 * VERIFICACIÓN VISUAL: Claude no tiene GPU para ver el resultado. Por eso TODO
 * es ajustable EN VIVO desde el móvil (Eruda) con window.__castle*. Colocás y
 * afinás vos en el juego:
 *   window.__castle()                 → estado actual (pos, escala, rot, gate)
 *   window.__castlePos(x, z)          → mover el castillo
 *   window.__castleScale(metros)      → alto objetivo en metros (def 12)
 *   window.__castleRot(grados)        → rotar (para alinear la puerta)
 *   window.__castleGate(width, depth) → tamaño del hueco de puerta (colisión)
 *   window.__castleWalls(on)          → activar/desactivar colisión de muros
 *   window.__bankerPos(x, z)          → mover al banquero dentro del castillo
 *   window.__castleBox()              → ver el AABB de colisión calculado
 *
 * Sesión 50 — VARIOS CASTILLOS: el GLB se carga una vez y se clona en cada
 * sitio de shared/castles.js. Cada uno con su banquero. Los tuners
 * window.__castle* actúan sobre el castillo elegido con window.__castleSel(i)
 * (por defecto el 0, La Laguna).
 *
 * Patrón estándar del proyecto: start({...}) / stop(). applyCollision() se
 * encadena desde world.js igual que buildings.applyCollision.
 *
 * NO toca CSS ni móvil. Lógica de escena + un menú DOM mínimo (reusa estilos).
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import * as terrain from './terrain.js';   // Sesión 40 — keep-out de árboles
import { CASTLES } from './shared/castles.js';   // Sesión 50 — varios castillos

const R2_BASE = 'https://pub-bb63b96c76c745f59a39649cde6678c0.r2.dev';
const CASTLE_URL = `${R2_BASE}/buildings/castle.glb`;

// ---- Config por defecto (todo ajustable en vivo, ver window.__castle*) ----
const DEFAULTS = {
  x: -80, z: -80,          // dónde se coloca (lejos del spawn para no pisar el concejo)
  y: -1.0,                 // Sesión 40 — altura: el suelo visible está ~1m bajo y=0
                           //   (el player se asienta en y≈-1.03). Bajamos el
                           //   castillo para que no flote. Ajustable: __castleY()
  targetHeight: 12.0,      // alto en metros
  rotDeg: 0,               // rotación Y en grados
  gateWidth: 7.0,          // ancho del hueco de puerta (m)
  gateDepth: 5.0,          // profundidad del hueco hacia adentro (m)
  gateSide: 'front',       // muro donde está la entrada: front/back/left/right
                           //   front=-Z back=+Z left=-X right=+X (local).
                           //   Alinealo al arco REAL con __castleGateSide().
  gateOffset: 0,           // corrimiento del hueco a lo largo de ese muro (m)
  door: true,              // dibujar una puerta de madera en el hueco
  doorAutoOpen: true,      // se abre sola al acercarte
  bankerOffX: 0,           // banquero respecto al centro del castillo (m)
  bankerOffZ: 0,
  bankerReach: 4.0,        // a qué distancia podés tappear al banquero
  // Montaña detrás del castillo (tapa la parte de atrás y lo "asienta").
  mountain: true,
  mountainOffZ: 18,        // cuánto detrás del centro del castillo (eje local +Z)
  mountainRadius: 34,      // radio de la base de la montaña (m)
  mountainHeight: 22,      // alto de la montaña (m) — más alta que el castillo
  treeKeepoutR: 44,        // radio donde NO se plantan árboles (footprint+algo)
  // Sesión 40 — ZÓCALO de roca: faldón que envuelve TODO el perímetro y sube
  // para tapar el hueco "se ve por debajo" en los 4 lados. Es la técnica real:
  // no peleamos para que el castillo apoye parejo, le construimos el suelo.
  skirt: true,
  skirtRise: 5.0,          // cuánto SUBE el faldón sobre el suelo (m) — tapa el hueco
  skirtOut: 8.0,           // cuánto SOBRESALE hacia afuera del footprint (m)
  skirtDrop: 6.0,          // cuánto BAJA por debajo (para fundir con terreno)
};

// ============================================================
// Estado
// ============================================================
let scene = null, camera = null, canvas = null;
let getPlayer = () => null;
let onOpenBank = () => {};
let onOpenGE = () => {};
let onOpenShop = () => {};
let feedLog = () => {};
let raycaster = null;
let started = false;

let template = null;        // GLB mergeado (se clona por castillo)
let aabbLocal = null;       // { minX,maxX,minZ,maxZ } del castillo en local (sin rotación)
let wallsOn = true;
let menuEl = null;
const castles = [];         // instancias
let sel = 0;                // castillo que tocan los tuners __castle*

// Una instancia: su cfg + sus grupos.
function makeInstance(def) {
  const inst = {
    def,
    cfg: { ...DEFAULTS, x: def.x, z: def.z, rotDeg: def.rotDeg || 0 },
    castleGroup: null, mountainGroup: null, skirtGroup: null, doorGroup: null, bankerGroup: null,
    doorL: null, doorR: null, doorAngle: 0, doorOpen: false,
  };
  inst.castleGroup = template.clone();
  inst.bankerGroup = makeBanker(def.banker);
  if (inst.cfg.mountain) inst.mountainGroup = makeMountain(inst);
  if (inst.cfg.skirt) inst.skirtGroup = makeSkirt(inst);
  if (inst.cfg.door) inst.doorGroup = makeDoor(inst);
  for (const k of ['skirtGroup', 'castleGroup', 'mountainGroup', 'doorGroup', 'bankerGroup']) if (inst[k]) scene.add(inst[k]);
  applyTransforms(inst);
  try {
    terrain.addKeepout?.(inst.cfg.x, inst.cfg.z, inst.cfg.treeKeepoutR);
    terrain.clearTreesNear?.(inst.cfg.x, inst.cfg.z, inst.cfg.treeKeepoutR);
  } catch (e) { console.warn('[castle] keepout:', e); }
  return inst;
}

async function loadAndMergeCastle(url, targetHeight) {
  const loader = new GLTFLoader();
  let gltf;
  try { gltf = await loader.loadAsync(url); }
  catch (err) { console.warn(`[castle] no se pudo cargar '${url}':`, err.message); return null; }

  const root = gltf.scene;
  root.updateMatrixWorld(true);
  const bbox = new THREE.Box3().setFromObject(root);
  const sizeY = bbox.max.y - bbox.min.y;
  if (!(sizeY > 0.001)) { console.warn('[castle] bbox degenerado'); return null; }
  const scaleFactor = targetHeight / sizeY;
  const yOffset = -bbox.min.y * scaleFactor;

  // Agrupar geometrías por material → un mesh por material (pocos draw calls).
  const groups = new Map();
  root.traverse(obj => {
    if (!obj.isMesh || !obj.geometry) return;
    let mat = obj.material;
    if (Array.isArray(mat)) mat = mat[0];
    if (!mat) return;
    const key = mat.name || mat.uuid;
    const geom = obj.geometry.clone();
    geom.applyMatrix4(obj.matrixWorld);
    geom.applyMatrix4(new THREE.Matrix4().makeScale(scaleFactor, scaleFactor, scaleFactor));
    geom.applyMatrix4(new THREE.Matrix4().makeTranslation(0, yOffset, 0));
    // normalizar atributos para poder mergear (solo position/normal/uv)
    const clean = new THREE.BufferGeometry();
    if (geom.attributes.position) clean.setAttribute('position', geom.attributes.position);
    if (geom.attributes.normal)   clean.setAttribute('normal', geom.attributes.normal);
    if (geom.attributes.uv)       clean.setAttribute('uv', geom.attributes.uv);
    if (geom.index)               clean.setIndex(geom.index);
    if (!groups.has(key)) groups.set(key, { material: mat, geoms: [] });
    groups.get(key).geoms.push(clean);
  });
  if (groups.size === 0) { console.warn('[castle] sin meshes'); return null; }

  const g = new THREE.Group();
  g.userData.kind = 'castle';
  for (const [, entry] of groups) {
    let merged;
    try { merged = mergeGeometries(entry.geoms, false); }
    catch { merged = null; }
    if (merged) {
      const m = new THREE.Mesh(merged, entry.material);
      m.userData = { kind: 'castle-part', shared: true };
      g.add(m);
    } else {
      // fallback: añadir cada geom por separado
      for (const geo of entry.geoms) g.add(new THREE.Mesh(geo, entry.material));
    }
  }
  return g;
}

// ============================================================
// API pública
// ============================================================
export async function start(opts = {}) {
  if (started) { stop(); }
  scene = opts.scene;
  camera = opts.camera || null;
  canvas = opts.canvas || null;
  getPlayer = opts.getPlayer || (() => null);
  onOpenBank = opts.onOpenBank || (() => {});
  onOpenGE = opts.onOpenGE || (() => {});
  onOpenShop = opts.onOpenShop || (() => {});
  feedLog = opts.feedLog || (() => {});
  if (!scene) { console.warn('[castle] start() sin scene'); return; }

  raycaster = new THREE.Raycaster();
  template = await loadAndMergeCastle(CASTLE_URL, DEFAULTS.targetHeight);
  if (!template) { console.warn('[castle] start() inerte (no cargó GLB)'); started = false; return; }
  const b = new THREE.Box3().setFromObject(template);
  aabbLocal = { minX: b.min.x, maxX: b.max.x, minZ: b.min.z, maxZ: b.max.z };

  for (const def of CASTLES) {
    try { castles.push(makeInstance(def)); } catch (e) { console.warn('[castle]', def.id, e); }
  }
  started = true;
  exposeDebug();
  console.log(`[castle] ${castles.length} castillos listos. Ajustá con window.__castleSel(i) + window.__castle*()`);
}

/** Sesión 50 — keep-outs de árboles ANTES de que el terreno plante (el GLB tarda). */
export function registerKeepouts(t) {
  for (const def of CASTLES) { try { t.addKeepout?.(def.x, def.z, DEFAULTS.treeKeepoutR); t.clearTreesNear?.(def.x, def.z, DEFAULTS.treeKeepoutR); } catch {} }
}

export function getMapIcons() {
  return CASTLES.map(c => ({ x: c.x, z: c.z, kind: 'castle', name: c.name }));
}

export function stop() {
  for (const inst of castles) {
    for (const k of ['castleGroup', 'mountainGroup', 'skirtGroup', 'doorGroup', 'bankerGroup']) {
      try { if (inst[k]) scene?.remove(inst[k]); } catch {}
    }
  }
  castles.length = 0;
  try { if (menuEl) { menuEl.remove(); menuEl = null; } } catch {}
  template = null; aabbLocal = null; started = false;
}

// Coloca/orienta castillo + montaña + banquero según su cfg.
// Convención (la de siempre en este módulo, colisión incluida): local→mundo
//   wx = x + lx·cos a − lz·sin a ;  wz = z + lx·sin a + lz·cos a
// En three eso es rotation.y = −a (Sesión 50: antes se ponía +a y solo
// cuadraba con 0°/180°).
function applyTransforms(inst) {
  const cfg = inst.cfg;
  const a = cfg.rotDeg * Math.PI / 180;
  const toW = (lx, lz) => [cfg.x + (lx * Math.cos(a) - lz * Math.sin(a)), cfg.z + (lx * Math.sin(a) + lz * Math.cos(a))];
  if (inst.castleGroup) { inst.castleGroup.position.set(cfg.x, cfg.y, cfg.z); inst.castleGroup.rotation.y = -a; }
  if (inst.mountainGroup) {
    const [wx, wz] = toW(0, cfg.mountainOffZ);
    inst.mountainGroup.position.set(wx, cfg.y - 0.5, wz);
    inst.mountainGroup.rotation.y = -a;
  }
  if (inst.skirtGroup) { inst.skirtGroup.position.set(cfg.x, cfg.y, cfg.z); inst.skirtGroup.rotation.y = -a; }
  if (inst.doorGroup) {
    const gc = gateLocalCenter(cfg);
    const [wx, wz] = toW(gc.x, gc.z);
    inst.doorGroup.position.set(wx, cfg.y, wz);
    inst.doorGroup.rotation.y = (gc.axis === 'z') ? -a : -a + Math.PI / 2;
  }
  if (inst.bankerGroup) {
    const [wx, wz] = toW(cfg.bankerOffX, cfg.bankerOffZ);
    inst.bankerGroup.position.set(wx, cfg.y, wz);
    // el banquero mira a la puerta
    inst.bankerGroup.rotation.y = -a + Math.PI;
  }
}

// Sesión 40 — Montaña procedural: cono irregular de roca con ruido, para
// "pegar" el castillo y tapar la parte de atrás. Sin assets: geometría pura.
function makeMountain(inst) {
  const cfg = inst.cfg;
  const g = new THREE.Group();
  g.userData = { kind: 'castle-mountain' };
  const R = cfg.mountainRadius, H = cfg.mountainHeight;
  // cono de base ancha con segmentos; desplazamos vértices con pseudo-ruido
  // para que no sea un cono perfecto (se vea rocoso/natural).
  const geom = new THREE.ConeGeometry(R, H, 14, 6, false);
  geom.translate(0, H / 2, 0);   // base en y=0
  const pos = geom.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    // ruido determinista por ángulo/altura
    const ang = Math.atan2(v.z, v.x);
    const n = Math.sin(ang * 3.0) * 0.12 + Math.sin(ang * 7.0 + v.y) * 0.08 + Math.cos(v.y * 0.5) * 0.06;
    const radial = Math.hypot(v.x, v.z);
    if (radial > 0.01) {
      const f = 1 + n;
      v.x *= f; v.z *= f;
    }
    v.y += Math.sin(ang * 5.0) * 0.6;  // crestas
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  geom.computeVertexNormals();
  const mat = new THREE.MeshLambertMaterial({ color: 0x6b6256, flatShading: true });
  const cone = new THREE.Mesh(geom, mat);
  cone.userData = { kind: 'castle-mountain-mesh', shared: true };
  g.add(cone);
  return g;
}

// Sesión 40 — ZÓCALO/FALDÓN de roca. Envuelve el footprint del castillo
// (aabbLocal) con un talud rocoso que SUBE hasta `skirtRise` pegado a los muros
// y baja/sobresale hacia afuera, tapando el hueco "se ve por debajo" en los 4
// lados. Es un anillo de roca generado del contorno real del castillo.
//
// Construcción: dos "anillos" de vértices alrededor del rectángulo del footprint
//   - interior: pegado al muro, a altura skirtRise (tapa el hueco)
//   - exterior: skirtOut metros afuera, cayendo a -skirtDrop (se mete en el piso)
// Triangulamos entre ambos anillos. Ruido para que se vea roca, no rampa lisa.
function makeSkirt(inst) {
  const cfg = inst.cfg;
  if (!aabbLocal) return null;
  const g = new THREE.Group();
  g.userData = { kind: 'castle-skirt' };

  const minX = aabbLocal.minX, maxX = aabbLocal.maxX;
  const minZ = aabbLocal.minZ, maxZ = aabbLocal.maxZ;
  const rise = cfg.skirtRise, out = cfg.skirtOut, drop = cfg.skirtDrop;

  // Muestrear el contorno del rectángulo en N puntos (perímetro).
  const perimeter = [];
  const STEPS_PER_SIDE = 10;
  const corners = [
    [minX, minZ], [maxX, minZ], [maxX, maxZ], [minX, maxZ],
  ];
  for (let c = 0; c < 4; c++) {
    const [x0, z0] = corners[c];
    const [x1, z1] = corners[(c + 1) % 4];
    for (let s = 0; s < STEPS_PER_SIDE; s++) {
      const t = s / STEPS_PER_SIDE;
      perimeter.push([x0 + (x1 - x0) * t, z0 + (z1 - z0) * t]);
    }
  }
  const N = perimeter.length;
  const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;

  const positions = [];
  const pushV = (x, y, z) => positions.push(x, y, z);
  // anillo interior (pegado al muro, arriba) y exterior (afuera, abajo).
  const inner = [], outer = [];
  for (let i = 0; i < N; i++) {
    const [px, pz] = perimeter[i];
    // dirección hacia afuera = del centro al punto
    let dx = px - cx, dz = pz - cz;
    const len = Math.hypot(dx, dz) || 1;
    dx /= len; dz /= len;
    // ruido por posición para que no sea liso
    const noise = Math.sin(i * 0.9) * 0.5 + Math.sin(i * 2.3) * 0.3;
    const innerY = rise + noise;                 // tapa el hueco
    const outX = px + dx * (out + noise * 1.5);
    const outZ = pz + dz * (out + noise * 1.5);
    const outerY = -drop + noise * 0.5;          // cae al piso/abajo
    inner.push([px, innerY, pz]);
    outer.push([outX, outerY, outZ]);
  }
  // triangular entre anillos (quad por segmento → 2 triángulos)
  for (let i = 0; i < N; i++) {
    const j = (i + 1) % N;
    const i0 = inner[i], i1 = inner[j], o0 = outer[i], o1 = outer[j];
    // tri 1: i0, o0, o1
    pushV(...i0); pushV(...o0); pushV(...o1);
    // tri 2: i0, o1, i1
    pushV(...i0); pushV(...o1); pushV(...i1);
  }
  // tapa superior interior (del anillo interior hacia el muro) — un borde extra
  // hacia adentro para que no se vea el filo al ras del muro.
  const innerIn = [];
  for (let i = 0; i < N; i++) {
    const [px, , pz] = inner[i];
    let dx = px - cx, dz = pz - cz; const len = Math.hypot(dx, dz) || 1; dx /= len; dz /= len;
    innerIn.push([px - dx * 1.5, inner[i][1] + 0.3, pz - dz * 1.5]);
  }
  for (let i = 0; i < N; i++) {
    const j = (i + 1) % N;
    const a0 = innerIn[i], a1 = innerIn[j], b0 = inner[i], b1 = inner[j];
    pushV(...a0); pushV(...b0); pushV(...b1);
    pushV(...a0); pushV(...b1); pushV(...a1);
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geom.computeVertexNormals();
  const mat = new THREE.MeshLambertMaterial({ color: 0x5e5648, flatShading: true, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(geom, mat);
  mesh.userData = { kind: 'castle-skirt-mesh', shared: true };
  g.add(mesh);
  return g;
}

function makeBanker(name = 'Banquero') {
  const g = new THREE.Group();
  g.userData = { kind: 'castle-banker', name };
  const bodyMat = new THREE.MeshLambertMaterial({ color: 0x5b4636 });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.4, 1.4, 10), bodyMat);
  body.position.y = 0.7; g.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.26, 12, 10), new THREE.MeshLambertMaterial({ color: 0xe0b48c }));
  head.position.y = 1.6; g.add(head);
  // Sesión 50 — cartel con su nombre y un $ para que se sepa qué es
  const c = document.createElement('canvas'); c.width = 256; c.height = 64;
  const x = c.getContext('2d');
  x.fillStyle = 'rgba(20,14,8,0.85)'; x.fillRect(0, 0, 256, 64);
  x.fillStyle = '#f2c230'; x.font = 'bold 30px sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText(`🏦 ${name}`, 128, 33);
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false }));
  spr.scale.set(2.4, 0.6, 1); spr.position.y = 2.4; spr.renderOrder = 5; g.add(spr);
  // hitbox generoso para tocarlo fácil
  const hit = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.8, 2.4, 8), new THREE.MeshBasicMaterial({ visible: false }));
  hit.position.y = 1.2; g.add(hit);
  return g;
}

// Sesión 40 — Puerta de madera de doble hoja en el hueco. Las hojas pivotan
// sobre los goznes (extremos del hueco) y se abren hacia adentro. El grupo se
// orienta al muro desde applyTransforms; acá construimos en local: ancho a lo
// largo de X, apertura hacia -Z (adentro).
function makeDoor(inst) {
  const cfg = inst.cfg;
  const g = new THREE.Group();
  g.userData = { kind: 'castle-door' };
  const w = cfg.gateWidth;
  const half = w / 2;
  const h = Math.min(cfg.targetHeight * 0.55, 6.5);
  const thick = 0.35;
  const woodMat = new THREE.MeshLambertMaterial({ color: 0x5a3a1c, flatShading: true });
  const ironMat = new THREE.MeshLambertMaterial({ color: 0x2a2a2e, flatShading: true });

  function leaf(sign) {
    const pivot = new THREE.Group();
    pivot.position.set(sign * half, 0, 0);    // gozne en el extremo del hueco
    const panel = new THREE.Mesh(new THREE.BoxGeometry(half, h, thick), woodMat);
    panel.position.set(-sign * half / 2, h / 2, 0);  // borde de la hoja en el gozne
    pivot.add(panel);
    for (const yy of [h * 0.25, h * 0.72]) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(half * 0.95, 0.18, thick + 0.06), ironMat);
      bar.position.set(-sign * half / 2, yy, 0);
      pivot.add(bar);
    }
    return pivot;
  }
  inst.doorL = leaf(-1);
  inst.doorR = leaf(+1);
  g.add(inst.doorL);
  g.add(inst.doorR);
  return g;
}

// Llamar cada frame desde world.js (castle.update(dt)). Abre/cierra las
// puertas según la distancia del player.
export function update(dt = 0.016) {
  if (!started) return;
  const player = getPlayer();
  for (const inst of castles) {
    if (!inst.doorGroup) continue;
    const cfg = inst.cfg;
    if (cfg.doorAutoOpen && player) {
      const d = Math.hypot(player.position.x - inst.doorGroup.position.x, player.position.z - inst.doorGroup.position.z);
      inst.doorOpen = d < cfg.gateWidth * 1.6;
    }
    const targetA = inst.doorOpen ? (Math.PI * 0.62) : 0;
    inst.doorAngle += (targetA - inst.doorAngle) * Math.min(1, dt * 6);
    if (inst.doorL) inst.doorL.rotation.y = -inst.doorAngle;
    if (inst.doorR) inst.doorR.rotation.y = +inst.doorAngle;
  }
}

// ============================================================
// Colisión perimetral con hueco de puerta
// ============================================================
export function applyCollision(x0, z0, x1, z1) {
  if (!started || !aabbLocal || !wallsOn) return { x: x1, z: z1 };
  const tryX = solidAt(x1, z0);
  const tryZ = solidAt(x0, z1);
  const fx = tryX ? x0 : x1;
  const fz = tryZ ? z0 : z1;
  if (solidAt(fx, fz)) return { x: x0, z: z0 };
  return { x: fx, z: fz };
}

// Centro local del hueco de puerta según gateSide + gateOffset.
function gateLocalCenter(cfg) {
  const A = aabbLocal;
  switch (cfg.gateSide) {
    case 'back':  return { x: cfg.gateOffset, z: A.maxZ, axis: 'z', sign: +1 };
    case 'left':  return { x: A.minX, z: cfg.gateOffset, axis: 'x', sign: -1 };
    case 'right': return { x: A.maxX, z: cfg.gateOffset, axis: 'x', sign: +1 };
    case 'front':
    default:      return { x: cfg.gateOffset, z: A.minZ, axis: 'z', sign: -1 };
  }
}

function solidAt(worldX, worldZ) {
  for (const inst of castles) if (solidAtInst(inst, worldX, worldZ)) return true;
  return false;
}
// ¿El punto es muro sólido de este castillo? Dentro del AABB SALVO el hueco.
function solidAtInst(inst, worldX, worldZ) {
  const cfg = inst.cfg;
  const dx = worldX - cfg.x, dz = worldZ - cfg.z;
  if (Math.abs(dx) > 60 || Math.abs(dz) > 60) return false;
  const a = cfg.rotDeg * Math.PI / 180;
  const c = Math.cos(-a), s = Math.sin(-a);
  const lx = dx * c - dz * s;
  const lz = dx * s + dz * c;
  const A = aabbLocal;
  if (lx < A.minX || lx > A.maxX || lz < A.minZ || lz > A.maxZ) return false;
  const gc = gateLocalCenter(cfg);
  let inGate = false;
  if (gc.axis === 'z') {
    const inWidth = Math.abs(lx - cfg.gateOffset) <= cfg.gateWidth / 2;
    const nearEdge = gc.sign < 0 ? (lz <= A.minZ + cfg.gateDepth) : (lz >= A.maxZ - cfg.gateDepth);
    inGate = inWidth && nearEdge;
  } else {
    const inWidth = Math.abs(lz - cfg.gateOffset) <= cfg.gateWidth / 2;
    const nearEdge = gc.sign < 0 ? (lx <= A.minX + cfg.gateDepth) : (lx >= A.maxX - cfg.gateDepth);
    inGate = inWidth && nearEdge;
  }
  if (inGate) return false;
  const margin = 1.2;
  return lx <= A.minX + margin || lx >= A.maxX - margin || lz <= A.minZ + margin || lz >= A.maxZ - margin;
}

// ============================================================
// Tap: ¿tocó a un banquero? → menú (sin teleport)
// ============================================================
export function handleTap(ndcX, ndcY) {
  if (!started || !camera) return false;
  raycaster.setFromCamera({ x: ndcX, y: ndcY }, camera);
  return tryHandleTapRay(raycaster);
}
let pendingBanker = null;
let setPlayerTarget = null;
export function setWalker(fn) { setPlayerTarget = fn; }
export function tryHandleTapRay(ray) {
  if (!started || !castles.length) return false;
  const player = getPlayer();
  for (const inst of castles) {
    if (!inst.bankerGroup) continue;
    if (player && Math.hypot(player.position.x - inst.cfg.x, player.position.z - inst.cfg.z) > 80) continue;
    const hits = ray.intersectObject(inst.bankerGroup, true);
    if (!hits.length) continue;
    const bp = inst.bankerGroup.position;
    const d = player ? Math.hypot(player.position.x - bp.x, player.position.z - bp.z) : 0;
    if (d > inst.cfg.bankerReach) {
      if (setPlayerTarget && player) {
        const k = (inst.cfg.bankerReach - 1) / (d || 1);
        setPlayerTarget(bp.x + (player.position.x - bp.x) * k, bp.z + (player.position.z - bp.z) * k);
        pendingBanker = inst;
      } else feedLog('info', 'Acércate al banquero.');
      return true;
    }
    openBankerMenu(inst);
    return true;
  }
  return false;
}
export function cancel() { pendingBanker = null; }
export function updatePending() {
  if (!pendingBanker) return;
  const p = getPlayer(); if (!p) return;
  const bp = pendingBanker.bankerGroup.position;
  if (Math.hypot(p.position.x - bp.x, p.position.z - bp.z) <= pendingBanker.cfg.bankerReach) {
    const inst = pendingBanker; pendingBanker = null; openBankerMenu(inst);
  }
}

function openBankerMenu(inst) {
  if (menuEl) return;
  menuEl = document.createElement('div');
  menuEl.id = 'castleBankerMenu';
  menuEl.style.cssText = [
    'position:fixed','left:50%','bottom:18%','transform:translateX(-50%)',
    'z-index:60','background:rgba(20,16,10,0.96)','border:2px solid #6b5a3a',
    'border-radius:12px','padding:10px','display:flex','flex-direction:column',
    'gap:8px','min-width:200px','box-shadow:0 6px 24px rgba(0,0,0,0.5)',
  ].join(';');
  const title = document.createElement('div');
  title.textContent = `${inst?.def?.banker || 'Banquero'} · ${inst?.def?.name || 'Castillo'}`;
  title.style.cssText = 'color:#e8c560;font:bold 14px sans-serif;text-align:center;padding:2px 4px 4px';
  menuEl.appendChild(title);
  const mk = (label, fn) => {
    const b = document.createElement('button');
    b.textContent = label;
    b.style.cssText = 'padding:12px;border:none;border-radius:8px;background:#3a2f1c;color:#f0e6d2;font-size:15px';
    b.onclick = (e) => { e.stopPropagation(); closeBankerMenu(); try { fn(); } catch (err) { console.warn('[castle] menu:', err); } };
    return b;
  };
  menuEl.appendChild(mk('🏦 Banco', () => onOpenBank()));
  menuEl.appendChild(mk('🏛️ Mercado (GE)', () => onOpenGE()));
  menuEl.appendChild(mk('🛒 Tienda', () => onOpenShop()));
  const close = mk('✕ Cerrar', () => {});
  close.style.background = '#5a2020';
  menuEl.appendChild(close);
  document.body.appendChild(menuEl);
}
function closeBankerMenu() { if (menuEl) { menuEl.remove(); menuEl = null; } }

// Reconstruye piezas de la instancia seleccionada tras un tuner.
function rebuild(inst, key, maker) {
  if (inst[key]) { scene.remove(inst[key]); inst[key] = null; }
  if (maker) { inst[key] = maker(inst); if (inst[key]) scene.add(inst[key]); }
  applyTransforms(inst);
}

// ============================================================
// Debug / tuning en vivo (Eruda en el móvil)
// ============================================================
function exposeDebug() {
  if (typeof window === 'undefined') return;
  const I = () => castles[sel];
  const C = () => I().cfg;
  window.__castleSel = (i) => { if (Number.isInteger(i) && castles[i]) sel = i; return castles.map((c, k) => `${k === sel ? '▶' : ' '} ${k}: ${c.def.name} (${c.cfg.x},${c.cfg.z})`); };
  window.__castle = () => { const st = { ...C(), wallsOn, aabbLocal, id: I().def.id }; console.log('[castle]', JSON.stringify(st, null, 2)); return st; };
  window.__castlePos = (x, z) => { if (Number.isFinite(x)) C().x = x; if (Number.isFinite(z)) C().z = z; applyTransforms(I()); try { terrain.addKeepout?.(C().x, C().z, C().treeKeepoutR); terrain.clearTreesNear?.(C().x, C().z, C().treeKeepoutR); } catch {} return [C().x, C().z]; };
  window.__castleY = (y) => { if (Number.isFinite(y)) C().y = y; applyTransforms(I()); return C().y; };
  window.__castleMountain = (on) => { if (typeof on === 'boolean') { C().mountain = on; rebuild(I(), 'mountainGroup', on ? makeMountain : null); } return C().mountain; };
  window.__castleMountainSize = (radius, height, offZ) => {
    if (Number.isFinite(radius)) C().mountainRadius = radius;
    if (Number.isFinite(height)) C().mountainHeight = height;
    if (Number.isFinite(offZ)) C().mountainOffZ = offZ;
    if (I().mountainGroup) rebuild(I(), 'mountainGroup', makeMountain);
    return [C().mountainRadius, C().mountainHeight, C().mountainOffZ];
  };
  window.__castleSkirt = (on) => { if (typeof on === 'boolean') { C().skirt = on; rebuild(I(), 'skirtGroup', on ? makeSkirt : null); } return C().skirt; };
  window.__castleSkirtSize = (rise, out, drop) => {
    if (Number.isFinite(rise)) C().skirtRise = rise;
    if (Number.isFinite(out)) C().skirtOut = out;
    if (Number.isFinite(drop)) C().skirtDrop = drop;
    if (I().skirtGroup) rebuild(I(), 'skirtGroup', makeSkirt);
    return [C().skirtRise, C().skirtOut, C().skirtDrop];
  };
  window.__castleRot = (deg) => { if (Number.isFinite(deg)) C().rotDeg = deg; applyTransforms(I()); return C().rotDeg; };
  window.__castleGate = (w, d) => { if (Number.isFinite(w)) C().gateWidth = w; if (Number.isFinite(d)) C().gateDepth = d; if (C().door) rebuild(I(), 'doorGroup', makeDoor); return [C().gateWidth, C().gateDepth]; };
  window.__castleGateSide = (side) => { if (['front','back','left','right'].includes(side)) C().gateSide = side; if (C().door) rebuild(I(), 'doorGroup', makeDoor); applyTransforms(I()); return C().gateSide; };
  window.__castleGatePos = (off) => { if (Number.isFinite(off)) C().gateOffset = off; applyTransforms(I()); return C().gateOffset; };
  window.__castleDoor = (on) => { if (typeof on === 'boolean') { C().door = on; rebuild(I(), 'doorGroup', on ? makeDoor : null); } return C().door; };
  window.__castleWalls = (on) => { if (typeof on === 'boolean') wallsOn = on; return wallsOn; };
  window.__bankerPos = (x, z) => { if (Number.isFinite(x)) C().bankerOffX = x; if (Number.isFinite(z)) C().bankerOffZ = z; applyTransforms(I()); return [C().bankerOffX, C().bankerOffZ]; };
  window.__castleBox = () => aabbLocal;
}
