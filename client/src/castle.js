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

const R2_BASE = 'https://pub-bb63b96c76c745f59a39649cde6678c0.r2.dev';
const CASTLE_URL = `${R2_BASE}/buildings/castle.glb`;

// ---- Config por defecto (todo ajustable en vivo, ver window.__castle*) ----
const DEFAULTS = {
  x: -80, z: -80,          // dónde se coloca (lejos del spawn para no pisar el concejo)
  targetHeight: 12.0,      // alto en metros
  rotDeg: 0,               // rotación Y en grados
  gateWidth: 6.0,          // ancho del hueco de puerta (m) en el muro frontal
  gateDepth: 4.0,          // profundidad del hueco hacia adentro (m)
  bankerOffX: 0,           // banquero respecto al centro del castillo (m)
  bankerOffZ: 0,
  bankerReach: 4.0,        // a qué distancia podés tappear al banquero
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
let bankerGroup = null;     // banquero (grupo simple)
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

  scene.add(castleGroup);
  scene.add(bankerGroup);
  applyTransforms();

  started = true;
  exposeDebug();
  console.log(`[castle] listo en (${cfg.x},${cfg.z}) alto=${cfg.targetHeight}m. Ajustá con window.__castle()`);
}

export function stop() {
  try { if (castleGroup) scene?.remove(castleGroup); } catch {}
  try { if (bankerGroup) scene?.remove(bankerGroup); } catch {}
  try { if (menuEl) { menuEl.remove(); menuEl = null; } } catch {}
  castleGroup = null; bankerGroup = null; aabbLocal = null; started = false;
}

// Coloca/orienta el castillo + banquero según cfg (llamado tras cada tuner).
function applyTransforms() {
  if (castleGroup) {
    castleGroup.position.set(cfg.x, 0, cfg.z);
    castleGroup.rotation.y = cfg.rotDeg * Math.PI / 180;
  }
  if (bankerGroup) {
    // banquero en coords mundo: centro del castillo + offset rotado
    const a = cfg.rotDeg * Math.PI / 180;
    const ox = cfg.bankerOffX, oz = cfg.bankerOffZ;
    const wx = cfg.x + (ox * Math.cos(a) - oz * Math.sin(a));
    const wz = cfg.z + (ox * Math.sin(a) + oz * Math.cos(a));
    bankerGroup.position.set(wx, 0, wz);
  }
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
function solidAt(worldX, worldZ) {
  const a = cfg.rotDeg * Math.PI / 180;
  const dx = worldX - cfg.x, dz = worldZ - cfg.z;
  const c = Math.cos(-a), s = Math.sin(-a);
  const lx = dx * c - dz * s;
  const lz = dx * s + dz * c;
  // fuera del AABB → libre
  if (lx < aabbLocal.minX || lx > aabbLocal.maxX || lz < aabbLocal.minZ || lz > aabbLocal.maxZ) return false;
  // dentro del AABB: ¿está en el corredor de la puerta? (centrado en X, en el
  // borde frontal -Z, con ancho gateWidth y profundidad gateDepth). Si sí, libre.
  const inGateX = Math.abs(lx) <= cfg.gateWidth / 2;
  const nearFront = lz <= (aabbLocal.minZ + cfg.gateDepth);
  if (inGateX && nearFront) return false;   // hueco de puerta → podés pasar
  // CENTRO hueco: una vez DENTRO (pasada la profundidad de puerta), el interior
  // es transitable (no bloqueamos el centro; solo los muros del perímetro).
  const margin = 1.2; // grosor de muro
  const onPerimeter =
    lx <= aabbLocal.minX + margin || lx >= aabbLocal.maxX - margin ||
    lz <= aabbLocal.minZ + margin || lz >= aabbLocal.maxZ - margin;
  return onPerimeter;   // solo el borde bloquea; el interior queda libre
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
  window.__castlePos = (x, z) => { if (Number.isFinite(x)) cfg.x = x; if (Number.isFinite(z)) cfg.z = z; applyTransforms(); return [cfg.x, cfg.z]; };
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
  window.__castleGate = (w, d) => { if (Number.isFinite(w)) cfg.gateWidth = w; if (Number.isFinite(d)) cfg.gateDepth = d; return [cfg.gateWidth, cfg.gateDepth]; };
  window.__castleWalls = (on) => { if (typeof on === 'boolean') wallsOn = on; return wallsOn; };
  window.__bankerPos = (x, z) => { if (Number.isFinite(x)) cfg.bankerOffX = x; if (Number.isFinite(z)) cfg.bankerOffZ = z; applyTransforms(); return [cfg.bankerOffX, cfg.bankerOffZ]; };
  window.__castleBox = () => aabbLocal;
}
