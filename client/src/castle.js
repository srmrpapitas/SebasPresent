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
 * Patrón estándar del proyecto: start({...}) / stop(). applyCollision() se
 * encadena desde world.js igual que buildings.applyCollision.
 *
 * NO toca CSS ni móvil. Lógica de escena + un menú DOM mínimo (reusa estilos).
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import * as terrain from './terrain.js';   // Sesión 40 — keep-out de árboles

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

let castleGroup = null;     // mesh del castillo (escalado, posicionado)
let mountainGroup = null;   // montaña procedural detrás del castillo
let skirtGroup = null;      // faldón de roca que tapa el hueco bajo el castillo
let doorGroup = null;       // puerta de madera en el hueco de entrada
let bankerGroup = null;     // banquero (grupo simple)
let doorOpen = false;
let aabbLocal = null;       // { minX,maxX,minZ,maxZ } del castillo en local (sin rotación)
let cfg = { ...DEFAULTS };
let wallsOn = true;
let menuEl = null;

// ============================================================
// Carga + merge por material (mismo enfoque que buildings.js)
// ============================================================
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
  cfg = { ...DEFAULTS, ...(opts.config || {}) };
  if (!scene) { console.warn('[castle] start() sin scene'); return; }

  raycaster = new THREE.Raycaster();

  castleGroup = await loadAndMergeCastle(CASTLE_URL, cfg.targetHeight);
  if (!castleGroup) { console.warn('[castle] start() inerte (no cargó GLB)'); started = false; return; }

  // AABB local (tras escalar, sin rotación) para colisión.
  const b = new THREE.Box3().setFromObject(castleGroup);
  aabbLocal = { minX: b.min.x, maxX: b.max.x, minZ: b.min.z, maxZ: b.max.z };

  // Banquero: un grupo simple (cilindro + cabeza). Reemplazable luego por GLB.
  bankerGroup = makeBanker();

  // Sesión 40 — montaña procedural detrás (tapa la parte de atrás, lo asienta).
  if (cfg.mountain) mountainGroup = makeMountain();
  // Sesión 40 — zócalo de roca envolvente (tapa el hueco bajo el castillo).
  if (cfg.skirt) skirtGroup = makeSkirt();
  // Sesión 40 — puerta de madera en el hueco de entrada.
  if (cfg.door) doorGroup = makeDoor();

  scene.add(castleGroup);
  if (skirtGroup) scene.add(skirtGroup);       // el faldón va ANTES (debajo)
  if (mountainGroup) scene.add(mountainGroup);
  if (doorGroup) scene.add(doorGroup);
  scene.add(bankerGroup);
  applyTransforms();

  // Sesión 40 — que NO crezcan árboles dentro del castillo, y limpiar los ya
  // plantados en el footprint (se ensartaban).
  try {
    terrain.addKeepout?.(cfg.x, cfg.z, cfg.treeKeepoutR);
    terrain.clearTreesNear?.(cfg.x, cfg.z, cfg.treeKeepoutR);
  } catch (e) { console.warn('[castle] keepout:', e); }

  started = true;
  exposeDebug();
  console.log(`[castle] listo en (${cfg.x},${cfg.z}) alto=${cfg.targetHeight}m y=${cfg.y}. Ajustá con window.__castle()`);
}

export function stop() {
  try { if (castleGroup) scene?.remove(castleGroup); } catch {}
  try { if (mountainGroup) scene?.remove(mountainGroup); } catch {}
  try { if (skirtGroup) scene?.remove(skirtGroup); } catch {}
  try { if (doorGroup) scene?.remove(doorGroup); } catch {}
  try { if (bankerGroup) scene?.remove(bankerGroup); } catch {}
  try { if (menuEl) { menuEl.remove(); menuEl = null; } } catch {}
  castleGroup = null; mountainGroup = null; skirtGroup = null; doorGroup = null; bankerGroup = null; aabbLocal = null; started = false;
}

// Coloca/orienta el castillo + montaña + banquero según cfg (tras cada tuner).
function applyTransforms() {
  const a = cfg.rotDeg * Math.PI / 180;
  if (castleGroup) {
    castleGroup.position.set(cfg.x, cfg.y, cfg.z);   // y = grounding (no flota)
    castleGroup.rotation.y = a;
  }
  if (mountainGroup) {
    // detrás del castillo en su eje local +Z, rotado al mundo.
    const oz = cfg.mountainOffZ;
    const wx = cfg.x + (-Math.sin(a) * oz);
    const wz = cfg.z + ( Math.cos(a) * oz);
    mountainGroup.position.set(wx, cfg.y - 0.5, wz);  // un pelín hundida para fundirse
    mountainGroup.rotation.y = a;
  }
  if (skirtGroup) {
    // mismo centro y rotación que el castillo; su geometría ya sube/baja sola.
    skirtGroup.position.set(cfg.x, cfg.y, cfg.z);
    skirtGroup.rotation.y = a;
  }
  if (doorGroup) {
    // la puerta vive en el hueco: centro local del gate rotado al mundo.
    const gc = gateLocalCenter();
    const wx = cfg.x + (gc.x * Math.cos(a) - gc.z * Math.sin(a));
    const wz = cfg.z + (gc.x * Math.sin(a) + gc.z * Math.cos(a));
    doorGroup.position.set(wx, cfg.y, wz);
    // orientar el marco según el muro (gate en eje Z mira ±Z; en eje X, ±X)
    doorGroup.rotation.y = (gc.axis === 'z') ? a : a + Math.PI / 2;
  }
  if (bankerGroup) {
    const ox = cfg.bankerOffX, oz = cfg.bankerOffZ;
    const wx = cfg.x + (ox * Math.cos(a) - oz * Math.sin(a));
    const wz = cfg.z + (ox * Math.sin(a) + oz * Math.cos(a));
    bankerGroup.position.set(wx, cfg.y, wz);
  }
}

// Sesión 40 — Montaña procedural: cono irregular de roca con ruido, para
// "pegar" el castillo y tapar la parte de atrás. Sin assets: geometría pura.
function makeMountain() {
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
function makeSkirt() {
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

function makeBanker() {
  const g = new THREE.Group();
  g.userData = { kind: 'castle-banker' };
  const bodyMat = new THREE.MeshLambertMaterial({ color: 0x5b4636 });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.4, 1.4, 10), bodyMat);
  body.position.y = 0.7; g.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.26, 12, 10), new THREE.MeshLambertMaterial({ color: 0xe0b48c }));
  head.position.y = 1.6; g.add(head);
  // cartel flotante simple no — mantenemos minimal; el nombre va en feedLog al acercarse.
  return g;
}

// Sesión 40 — Puerta de madera de doble hoja en el hueco. Las hojas pivotan
// sobre los goznes (extremos del hueco) y se abren hacia adentro. El grupo se
// orienta al muro desde applyTransforms; acá construimos en local: ancho a lo
// largo de X, apertura hacia -Z (adentro).
let _doorLeftPivot = null, _doorRightPivot = null;
function makeDoor() {
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
  _doorLeftPivot = leaf(-1);
  _doorRightPivot = leaf(+1);
  g.add(_doorLeftPivot);
  g.add(_doorRightPivot);
  return g;
}

// Llamar cada frame desde world.js (castle.update(dt)). Abre/cierra la puerta
// según distancia del player, animando el giro de las hojas.
let _doorAngle = 0;
export function update(dt = 0.016) {
  if (!started || !doorGroup) return;
  const player = getPlayer();
  if (cfg.doorAutoOpen && player) {
    const d = Math.hypot(player.position.x - doorGroup.position.x, player.position.z - doorGroup.position.z);
    doorOpen = d < cfg.gateWidth * 1.6;   // se abre al acercarte al hueco
  }
  const targetA = doorOpen ? (Math.PI * 0.62) : 0;   // ~110° abierto
  _doorAngle += (targetA - _doorAngle) * Math.min(1, dt * 6);
  if (_doorLeftPivot)  _doorLeftPivot.rotation.y  = -_doorAngle;  // abre hacia adentro
  if (_doorRightPivot) _doorRightPivot.rotation.y = +_doorAngle;
}

// ============================================================
// Colisión perimetral con hueco de puerta
// ============================================================
// Igual patrón que buildings: se llama desde world.js tras terrain+buildings.
export function applyCollision(x0, z0, x1, z1) {
  if (!started || !aabbLocal || !wallsOn) return { x: x1, z: z1 };
  const tryX = solidAt(x1, z0);
  const tryZ = solidAt(x0, z1);
  const fx = tryX ? x0 : x1;
  const fz = tryZ ? z0 : z1;
  if (solidAt(fx, fz)) return { x: x0, z: z0 };
  return { x: fx, z: fz };
}

// ¿El punto del mundo es muro sólido del castillo? Dentro del AABB SALVO el
// hueco de la puerta (gate) en el muro frontal (-Z local). Esto deja entrar.
// Centro local del hueco de puerta según gateSide + gateOffset. Lo usan la
// colisión y la puerta visual, así SIEMPRE coinciden.
function gateLocalCenter() {
  const A = aabbLocal;
  switch (cfg.gateSide) {
    case 'back':  return { x: cfg.gateOffset, z: A.maxZ, axis: 'z', sign: +1 };
    case 'left':  return { x: A.minX, z: cfg.gateOffset, axis: 'x', sign: -1 };
    case 'right': return { x: A.maxX, z: cfg.gateOffset, axis: 'x', sign: +1 };
    case 'front':
    default:      return { x: cfg.gateOffset, z: A.minZ, axis: 'z', sign: -1 };
  }
}

// ¿El punto del mundo es muro sólido del castillo? Dentro del AABB SALVO el
// hueco de la puerta (gate), que puede estar en cualquier muro (gateSide).
function solidAt(worldX, worldZ) {
  const a = cfg.rotDeg * Math.PI / 180;
  const dx = worldX - cfg.x, dz = worldZ - cfg.z;
  const c = Math.cos(-a), s = Math.sin(-a);
  const lx = dx * c - dz * s;
  const lz = dx * s + dz * c;
  const A = aabbLocal;
  // fuera del AABB → libre
  if (lx < A.minX || lx > A.maxX || lz < A.minZ || lz > A.maxZ) return false;
  // ¿en el corredor de la puerta? (según el muro elegido)
  const gc = gateLocalCenter();
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
  if (inGate) return false;   // hueco de puerta → podés pasar
  // solo el borde (muros) bloquea; el interior queda libre para caminar.
  const margin = 1.2;
  const onPerimeter =
    lx <= A.minX + margin || lx >= A.maxX - margin ||
    lz <= A.minZ + margin || lz >= A.maxZ - margin;
  return onPerimeter;
}

// ============================================================
// Tap: ¿tappeó al banquero? → abre el banco (sin teleport)
// ============================================================
export function handleTap(ndcX, ndcY) {
  if (!started || !bankerGroup || !camera) return false;
  const player = getPlayer();
  raycaster.setFromCamera({ x: ndcX, y: ndcY }, camera);
  const hits = raycaster.intersectObject(bankerGroup, true);
  if (hits.length === 0) return false;
  // chequear distancia del player al banquero
  if (player) {
    const d = Math.hypot(player.position.x - bankerGroup.position.x, player.position.z - bankerGroup.position.z);
    if (d > cfg.bankerReach) {
      feedLog('info', 'Acercate al banquero para usar el banco.');
      return true;
    }
  }
  openBankerMenu();
  return true;
}

function openBankerMenu() {
  if (menuEl) return;
  menuEl = document.createElement('div');
  menuEl.id = 'castleBankerMenu';
  menuEl.style.cssText = [
    'position:fixed','left:50%','bottom:18%','transform:translateX(-50%)',
    'z-index:60','background:rgba(20,16,10,0.96)','border:2px solid #6b5a3a',
    'border-radius:12px','padding:10px','display:flex','flex-direction:column',
    'gap:8px','min-width:180px','box-shadow:0 6px 24px rgba(0,0,0,0.5)',
  ].join(';');
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

// Reconstruye la puerta tras cambiar ancho/lado (las hojas dependen del ancho).
function rebuildDoor() {
  if (!cfg.door) return;
  if (doorGroup) { scene.remove(doorGroup); doorGroup = null; }
  doorGroup = makeDoor();
  scene.add(doorGroup);
  applyTransforms();
}

// ============================================================
// Debug / tuning en vivo (Eruda en el móvil)
// ============================================================
function exposeDebug() {
  if (typeof window === 'undefined') return;
  window.__castle = () => {
    const st = { ...cfg, wallsOn, aabbLocal };
    console.log('[castle]', JSON.stringify(st, null, 2));
    return st;
  };
  window.__castlePos = (x, z) => { if (Number.isFinite(x)) cfg.x = x; if (Number.isFinite(z)) cfg.z = z; applyTransforms(); try { terrain.clearKeepouts?.(); terrain.addKeepout?.(cfg.x, cfg.z, cfg.treeKeepoutR); terrain.clearTreesNear?.(cfg.x, cfg.z, cfg.treeKeepoutR); } catch {} return [cfg.x, cfg.z]; };
  window.__castleY = (y) => { if (Number.isFinite(y)) cfg.y = y; applyTransforms(); return cfg.y; };
  window.__castleMountain = (on) => {
    if (typeof on === 'boolean') {
      cfg.mountain = on;
      if (on && !mountainGroup) { mountainGroup = makeMountain(); scene.add(mountainGroup); applyTransforms(); }
      else if (!on && mountainGroup) { scene.remove(mountainGroup); mountainGroup = null; }
    }
    return cfg.mountain;
  };
  window.__castleMountainSize = (radius, height, offZ) => {
    if (Number.isFinite(radius)) cfg.mountainRadius = radius;
    if (Number.isFinite(height)) cfg.mountainHeight = height;
    if (Number.isFinite(offZ)) cfg.mountainOffZ = offZ;
    if (mountainGroup) { scene.remove(mountainGroup); mountainGroup = makeMountain(); scene.add(mountainGroup); applyTransforms(); }
    return [cfg.mountainRadius, cfg.mountainHeight, cfg.mountainOffZ];
  };
  window.__castleSkirt = (on) => {
    if (typeof on === 'boolean') {
      cfg.skirt = on;
      if (on && !skirtGroup) { skirtGroup = makeSkirt(); if (skirtGroup) { scene.add(skirtGroup); applyTransforms(); } }
      else if (!on && skirtGroup) { scene.remove(skirtGroup); skirtGroup = null; }
    }
    return cfg.skirt;
  };
  // rise=cuánto sube y tapa el hueco · out=cuánto sobresale · drop=cuánto baja
  window.__castleSkirtSize = (rise, out, drop) => {
    if (Number.isFinite(rise)) cfg.skirtRise = rise;
    if (Number.isFinite(out)) cfg.skirtOut = out;
    if (Number.isFinite(drop)) cfg.skirtDrop = drop;
    if (skirtGroup) { scene.remove(skirtGroup); skirtGroup = makeSkirt(); if (skirtGroup) scene.add(skirtGroup); applyTransforms(); }
    return [cfg.skirtRise, cfg.skirtOut, cfg.skirtDrop];
  };
  window.__castleScale = async (m) => {
    if (Number.isFinite(m) && m > 0) {
      cfg.targetHeight = m;
      // re-cargar el merge a nueva escala
      if (castleGroup) scene.remove(castleGroup);
      castleGroup = await loadAndMergeCastle(CASTLE_URL, cfg.targetHeight);
      if (castleGroup) { scene.add(castleGroup); const b = new THREE.Box3().setFromObject(castleGroup); aabbLocal = { minX: b.min.x, maxX: b.max.x, minZ: b.min.z, maxZ: b.max.z }; applyTransforms(); }
    }
    return cfg.targetHeight;
  };
  window.__castleRot = (deg) => { if (Number.isFinite(deg)) cfg.rotDeg = deg; applyTransforms(); return cfg.rotDeg; };
  window.__castleGate = (w, d) => { if (Number.isFinite(w)) cfg.gateWidth = w; if (Number.isFinite(d)) cfg.gateDepth = d; rebuildDoor(); return [cfg.gateWidth, cfg.gateDepth]; };
  // alinear el hueco al ARCO REAL del castillo: probá front/back/left/right
  window.__castleGateSide = (side) => { if (['front','back','left','right'].includes(side)) cfg.gateSide = side; rebuildDoor(); applyTransforms(); return cfg.gateSide; };
  window.__castleGatePos = (off) => { if (Number.isFinite(off)) cfg.gateOffset = off; applyTransforms(); return cfg.gateOffset; };
  window.__castleDoor = (on) => {
    if (typeof on === 'boolean') {
      cfg.door = on;
      if (on && !doorGroup) { doorGroup = makeDoor(); scene.add(doorGroup); applyTransforms(); }
      else if (!on && doorGroup) { scene.remove(doorGroup); doorGroup = null; }
    }
    return cfg.door;
  };
  window.__castleWalls = (on) => { if (typeof on === 'boolean') wallsOn = on; return wallsOn; };
  window.__bankerPos = (x, z) => { if (Number.isFinite(x)) cfg.bankerOffX = x; if (Number.isFinite(z)) cfg.bankerOffZ = z; applyTransforms(); return [cfg.bankerOffX, cfg.bankerOffZ]; };
  window.__castleBox = () => aabbLocal;
}
