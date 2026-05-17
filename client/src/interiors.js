/**
 * SebasPresent — Interiors module (Sesión 11c-1 + Sesión 23 shop)
 *
 * Sesión 23: el menú del banker ahora tiene 3 botones:
 *   - 🏦 Banco
 *   - 🏛️ Grand Exchange
 *   - 🛒 Tienda  (nuevo)
 * Futuro (cuando haya quests): se añadirá 4º botón Misiones.
 *
 * Gestiona el switch entre el mundo exterior y el interior de los edificios.
 *
 * Concepto:
 *   - El interior se carga UNA VEZ al inicio y se coloca en coords absolutas
 *     (10000, 10000) — lejos del mundo real (WORLD_HALF=2048).
 *   - Mientras el player está fuera, el interiorRoot tiene visible=false.
 *   - Cuando tappeas un edificio: enter() teleporta al player a las coords
 *     del interior, hace visible el interiorRoot, oculta el botón salir,
 *     cambia bg/fog a tonos oscuros.
 *   - Cuando tappeas el botón "↩ Salir": leave() revierte todo y devuelve
 *     al player a la posición exterior donde estaba.
 *
 * Los meshes del exterior (terrain, NPCs, multiplayer peers) NO se ocultan:
 * están en sus coords originales (cerca de 0,0). El player está ahora en
 * (10000, 10000), muy lejos del frustum de la cámara. El frustum culling
 * de three.js se encarga de no renderizarlos.
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// ============================================================
// Constantes
// ============================================================
const R2_BASE = 'https://pub-bb63b96c76c745f59a39649cde6678c0.r2.dev';
const INTERIOR_URL = `${R2_BASE}/interiors/medieval_room.glb`;
const NPC_URL = `${R2_BASE}/npcs/the_boss.fbx`;

// Sesión 11c-2 → 11c-3: bajado de 16 → 8m de alto (planta ~30×33m, más manejable).
const INTERIOR_HEIGHT = 8.0;

// Altura del NPC tras escalar el FBX (humano ~1.8m).
const NPC_HEIGHT = 1.8;

// Offset del NPC respecto al centro del interior: 3m al norte del centro
// (sala más pequeña ahora). Si queda atravesando un mueble, ajustar.
const NPC_OFFSET = { x: 0, z: 3 };

// Coords absolutas donde se coloca el interior en el mundo.
const INTERIOR_CENTER = { x: 10000, z: 10000 };

// Spawn del player dentro: 10m al sur del centro (sala ahora ~33m profundidad),
// mirando al norte hacia el mostrador y NPC.
const PLAYER_SPAWN_OFFSET = { x: 0, z: -10 };

// Visual del interior — cielo oscuro + fog para sala mediana.
const INTERIOR_BG = 0x1a1410;
const INTERIOR_FOG_NEAR = 12;
const INTERIOR_FOG_FAR = 60;

// Margen entre el bbox del interior y la zona donde puede moverse el
// player. Evita que se pegue a las paredes.
const COLLISION_MARGIN = 1.0;

// ============================================================
// Estado del módulo (privado)
// ============================================================
let scene = null;
let getPlayer = () => null;
let onEnterCallback = () => {};
let onLeaveCallback = () => {};
let onOpenBank = () => { console.warn('[interiors] onOpenBank no asignado'); };
let onOpenGE   = () => { console.warn('[interiors] onOpenGE no asignado'); };
let onOpenShop = () => { console.warn('[interiors] onOpenShop no asignado'); };  // sesión 23

let interiorRoot = null;
let interiorFloor = null;
let interiorBox = null;
let interiorLight = null;
let npcModel = null;
let npcMixer = null;
let npcMenuEl = null;
let raycaster = null;

let savedBg = 0;
let savedFogColor = null;
let savedFogNear = 0;
let savedFogFar = 0;
let lastExteriorPos = null;
let lastExteriorRotY = 0;
let exitButtonEl = null;
let active = false;
let started = false;
let camera = null;
let canvas = null;

// ============================================================
// API pública
// ============================================================

export async function start(opts) {
  if (started) {
    console.warn('[interiors] start() llamado dos veces sin stop()');
    stop();
  }
  scene = opts.scene;
  camera = opts.camera || null;
  canvas = opts.canvas || null;
  getPlayer = opts.getPlayer || (() => null);
  onEnterCallback = opts.onEnter || (() => {});
  onLeaveCallback = opts.onLeave || (() => {});
  onOpenBank = opts.onOpenBank || (() => { console.warn('[interiors] onOpenBank no asignado'); });
  onOpenGE   = opts.onOpenGE   || (() => { console.warn('[interiors] onOpenGE no asignado'); });
  onOpenShop = opts.onOpenShop || (() => { console.warn('[interiors] onOpenShop no asignado'); });  // sesión 23
  if (!scene) {
    console.warn('[interiors] start() sin scene en opts');
    return;
  }
  raycaster = new THREE.Raycaster();

  interiorRoot = await loadInterior(INTERIOR_URL, INTERIOR_HEIGHT);
  if (!interiorRoot) {
    console.warn('[interiors] No se pudo cargar el GLB del interior. enter() será inerte.');
    started = false;
    return;
  }

  const centerX = INTERIOR_CENTER.x;
  const centerZ = INTERIOR_CENTER.z;
  interiorRoot.position.set(centerX, 0, centerZ);
  interiorRoot.updateMatrixWorld(true);
  scene.add(interiorRoot);

  const worldBox = new THREE.Box3().setFromObject(interiorRoot);
  console.log(`[interiors] BBox world: X[${worldBox.min.x.toFixed(2)},${worldBox.max.x.toFixed(2)}] Y[${worldBox.min.y.toFixed(2)},${worldBox.max.y.toFixed(2)}] Z[${worldBox.min.z.toFixed(2)},${worldBox.max.z.toFixed(2)}]`);

  if (!Number.isFinite(worldBox.min.x) || !Number.isFinite(worldBox.max.x)) {
    console.warn('[interiors] BBox infinito/inválido. La colisión y el floor mesh quedarán desactivados.');
    interiorBox = null;
  } else {
    interiorBox = {
      minX: worldBox.min.x - centerX + COLLISION_MARGIN,
      maxX: worldBox.max.x - centerX - COLLISION_MARGIN,
      minZ: worldBox.min.z - centerZ + COLLISION_MARGIN,
      maxZ: worldBox.max.z - centerZ - COLLISION_MARGIN,
    };
    if (interiorBox.maxX <= interiorBox.minX || interiorBox.maxZ <= interiorBox.minZ) {
      console.warn('[interiors] bbox demasiado pequeño para margen; usando margen 0');
      interiorBox = {
        minX: worldBox.min.x - centerX,
        maxX: worldBox.max.x - centerX,
        minZ: worldBox.min.z - centerZ,
        maxZ: worldBox.max.z - centerZ,
      };
    }
  }

  interiorRoot.visible = true;

  const sizeX = Number.isFinite(worldBox.max.x - worldBox.min.x) ? (worldBox.max.x - worldBox.min.x) : 20;
  const sizeZ = Number.isFinite(worldBox.max.z - worldBox.min.z) ? (worldBox.max.z - worldBox.min.z) : 20;
  const floorGeom = new THREE.PlaneGeometry(sizeX, sizeZ);
  floorGeom.rotateX(-Math.PI / 2);
  const floorMat = new THREE.MeshBasicMaterial({
    transparent: true, opacity: 0,
    side: THREE.DoubleSide, depthWrite: false,
  });
  interiorFloor = new THREE.Mesh(floorGeom, floorMat);
  interiorFloor.position.set(centerX, 0.02, centerZ);
  interiorFloor.userData = { kind: 'interior-floor' };
  interiorFloor.visible = true;
  scene.add(interiorFloor);

  interiorLight = new THREE.AmbientLight(0xffffff, 0.5);
  interiorLight.visible = true;
  scene.add(interiorLight);

  try {
    const npcPack = await loadNpc(NPC_URL, NPC_HEIGHT);
    if (npcPack) {
      npcModel = npcPack.model;
      npcMixer = npcPack.mixer;
      npcModel.position.set(centerX + NPC_OFFSET.x, 0, centerZ + NPC_OFFSET.z);
      npcModel.rotation.y = Math.PI;
      npcModel.userData = { kind: 'npc-interior', name: 'Banquero' };
      scene.add(npcModel);
      console.log(`[interiors] NPC cargado y posicionado en (${npcModel.position.x.toFixed(1)}, ${npcModel.position.z.toFixed(1)}).`);
    } else {
      console.warn('[interiors] NPC no cargó. El menú no estará disponible.');
    }
  } catch (err) {
    console.warn('[interiors] Error cargando NPC:', err);
  }

  started = true;
  console.log(`[interiors] Setup completo. Children del root: ${interiorRoot.children.length}. Interior en (${centerX},${centerZ}).`);
}

export function stop() {
  if (!started) return;
  if (active) forceLeave();
  if (interiorRoot && scene) {
    scene.remove(interiorRoot);
    disposeGroup(interiorRoot);
  }
  if (interiorFloor && scene) {
    scene.remove(interiorFloor);
    interiorFloor.geometry?.dispose();
    interiorFloor.material?.dispose();
  }
  if (interiorLight && scene) scene.remove(interiorLight);
  if (npcModel && scene) {
    scene.remove(npcModel);
    disposeGroup(npcModel);
  }
  if (npcMixer) {
    try { npcMixer.stopAllAction(); npcMixer.uncacheRoot(npcModel); } catch {}
  }
  closeNpcMenu();
  removeExitButton();
  interiorRoot = null;
  interiorFloor = null;
  interiorLight = null;
  interiorBox = null;
  npcModel = null;
  npcMixer = null;
  raycaster = null;
  scene = null;
  camera = null;
  canvas = null;
  getPlayer = () => null;
  onEnterCallback = () => {};
  onLeaveCallback = () => {};
  onOpenBank = () => {};
  onOpenGE = () => {};
  onOpenShop = () => {};
  active = false;
  started = false;
}

export function enter(fromBuildingId) {
  if (!started || active || !interiorRoot) {
    console.warn(`[interiors] enter() ignorado: started=${started} active=${active} hasRoot=${!!interiorRoot}`);
    return;
  }
  const player = getPlayer();
  if (!player) {
    console.warn('[interiors] enter(): no player');
    return;
  }

  lastExteriorPos = { x: player.position.x, z: player.position.z };
  lastExteriorRotY = player.rotation.y;

  player.position.x = INTERIOR_CENTER.x + PLAYER_SPAWN_OFFSET.x;
  player.position.z = INTERIOR_CENTER.z + PLAYER_SPAWN_OFFSET.z;
  player.rotation.y = 0;

  if (scene) {
    savedBg = (scene.background && scene.background.getHex) ? scene.background.getHex() : 0x9ec0d6;
    if (scene.fog) {
      savedFogColor = scene.fog.color.getHex();
      savedFogNear = scene.fog.near;
      savedFogFar = scene.fog.far;
    }
    scene.background = new THREE.Color(INTERIOR_BG);
    if (scene.fog) {
      scene.fog.color = new THREE.Color(INTERIOR_BG);
      scene.fog.near = INTERIOR_FOG_NEAR;
      scene.fog.far = INTERIOR_FOG_FAR;
    }
  }

  showExitButton();
  active = true;
  onEnterCallback(fromBuildingId);
}

export function leave() {
  if (!active) return;
  const player = getPlayer();
  if (player && lastExteriorPos) {
    player.position.x = lastExteriorPos.x;
    player.position.z = lastExteriorPos.z;
    player.rotation.y = lastExteriorRotY;
  }
  finishLeave();
  onLeaveCallback();
}

export function forceLeave() {
  if (!active) return;
  finishLeave();
}

function finishLeave() {
  if (scene) {
    scene.background = new THREE.Color(savedBg);
    if (scene.fog && savedFogColor !== null) {
      scene.fog.color = new THREE.Color(savedFogColor);
      scene.fog.near = savedFogNear;
      scene.fog.far = savedFogFar;
    }
  }
  removeExitButton();
  closeNpcMenu();
  lastExteriorPos = null;
  active = false;
}

export function isActive() {
  return active;
}

export function getFloorMesh() {
  return interiorFloor;
}

export function applyCollision(x0, z0, x1, z1) {
  if (!active || !interiorBox) return { x: x1, z: z1 };
  const localX1 = x1 - INTERIOR_CENTER.x;
  const localZ1 = z1 - INTERIOR_CENTER.z;
  const clampedX = Math.max(interiorBox.minX, Math.min(interiorBox.maxX, localX1));
  const clampedZ = Math.max(interiorBox.minZ, Math.min(interiorBox.maxZ, localZ1));
  return {
    x: clampedX + INTERIOR_CENTER.x,
    z: clampedZ + INTERIOR_CENTER.z,
  };
}

// ============================================================
// Botón "Salir del edificio"
// ============================================================

function showExitButton() {
  if (exitButtonEl) return;
  exitButtonEl = document.createElement('button');
  exitButtonEl.id = 'interiorExitBtn';
  exitButtonEl.textContent = '↩ Salir';
  exitButtonEl.style.cssText = `
    position: fixed;
    top: calc(env(safe-area-inset-top, 0px) + 12px);
    left: 12px;
    z-index: 60;
    background: rgba(20, 14, 8, 0.92);
    border: 2px solid #c8a043;
    color: #e8c560;
    font-family: 'Cinzel', serif;
    font-size: 13px;
    font-weight: 700;
    padding: 8px 14px;
    border-radius: 4px;
    text-shadow: 0 1px 2px rgba(0,0,0,0.9);
    box-shadow: 0 4px 12px rgba(0,0,0,0.5);
    cursor: pointer;
    letter-spacing: 0.04em;
    white-space: nowrap;
    -webkit-tap-highlight-color: transparent;
    user-select: none;
    pointer-events: auto;
    margin: 0;
  `;
  exitButtonEl.addEventListener('pointerup', (ev) => {
    if (ev.button !== undefined && ev.button !== 0) return;
    ev.preventDefault();
    ev.stopPropagation();
    leave();
  });
  document.body.appendChild(exitButtonEl);
}

function removeExitButton() {
  if (!exitButtonEl) return;
  exitButtonEl.remove();
  exitButtonEl = null;
}

// ============================================================
// Carga del GLB del interior
// ============================================================

async function loadInterior(url, targetHeight) {
  const loader = new GLTFLoader();
  let gltf;
  try {
    gltf = await loader.loadAsync(url);
  } catch (err) {
    console.warn(`[interiors] No se pudo cargar GLB '${url}':`, err.message);
    return null;
  }
  const root = gltf.scene;
  root.updateMatrixWorld(true);

  const bbox = new THREE.Box3().setFromObject(root);
  const sizeY = bbox.max.y - bbox.min.y;
  if (sizeY < 0.001) {
    console.warn('[interiors] BBox degenerado del modelo:', bbox);
    return null;
  }
  const scaleFactor = targetHeight / sizeY;

  let meshCount = 0;
  root.traverse(o => {
    if (!o.isMesh) return;
    o.visible = true;
    meshCount++;
    if (o.material) {
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        m.side = THREE.DoubleSide;
        if (m.transparent || m.alphaTest > 0 || m.alphaMap) {
          m.alphaTest = 0.4;
          m.transparent = false;
        }
      }
    }
  });

  const wrapper = new THREE.Group();
  wrapper.userData = { kind: 'interior-root' };
  wrapper.add(root);
  wrapper.scale.set(scaleFactor, scaleFactor, scaleFactor);
  wrapper.position.y = -bbox.min.y * scaleFactor;

  return wrapper;
}

// ============================================================
// NPC del mostrador (FBX + idle anim + tap → menú)
// ============================================================

async function loadNpc(url, targetHeight) {
  let FBXLoader;
  try {
    const mod = await import('three/addons/loaders/FBXLoader.js');
    FBXLoader = mod.FBXLoader;
  } catch (err) {
    console.warn('[interiors] No se pudo importar FBXLoader:', err.message);
    return null;
  }
  const loader = new FBXLoader();

  let fbx;
  try {
    fbx = await loader.loadAsync(url);
  } catch (err) {
    console.warn(`[interiors] No se pudo cargar FBX del NPC '${url}':`, err.message);
    return null;
  }

  fbx.updateMatrixWorld(true);
  const bbox = new THREE.Box3().setFromObject(fbx);
  const sizeY = bbox.max.y - bbox.min.y;
  if (sizeY < 0.001) {
    console.warn('[interiors] NPC BBox degenerado.');
    return null;
  }
  const scaleFactor = targetHeight / sizeY;
  fbx.scale.set(scaleFactor, scaleFactor, scaleFactor);
  fbx.position.y = -bbox.min.y * scaleFactor;

  fbx.traverse(o => {
    if (o.isMesh) {
      o.frustumCulled = false;
      if (o.material) {
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) m.side = THREE.DoubleSide;
      }
    }
  });

  const clips = fbx.animations || [];

  let bestClip = null;
  for (const c of clips) {
    if (c.duration < 0.1) continue;
    if (!c.tracks || c.tracks.length === 0) continue;
    const nameLower = (c.name || '').toLowerCase();
    if (nameLower.includes('idle') || nameLower.includes('stand')) { bestClip = c; break; }
    if (!bestClip) bestClip = c;
  }

  let mixer = null;
  if (bestClip) {
    mixer = new THREE.AnimationMixer(fbx);
    const action = mixer.clipAction(bestClip);
    action.play();
    return { model: fbx, mixer };
  }

  const idleCandidates = [
    `${R2_BASE}/animations/Idle.fbx`,
    `${R2_BASE}/animations/idle.fbx`,
    `${R2_BASE}/animations/standing_idle.fbx`,
    `${R2_BASE}/Idle.fbx`,
    `${R2_BASE}/idle.fbx`,
  ];
  for (const idleUrl of idleCandidates) {
    try {
      const idleFbx = await loader.loadAsync(idleUrl);
      const idleClips = idleFbx.animations || [];
      if (idleClips.length === 0) continue;
      const clip = idleClips[0];
      mixer = new THREE.AnimationMixer(fbx);
      const action = mixer.clipAction(clip);
      action.play();
      return { model: fbx, mixer };
    } catch (err) {
      // sigo
    }
  }
  return { model: fbx, mixer: null };
}

export function update(dt) {
  if (npcMixer) {
    try { npcMixer.update(dt); } catch {}
  }
}

export function tryHandleNpcTap(clientX, clientY) {
  if (!active || !npcModel || !raycaster || !camera || !canvas) return false;
  const rect = canvas.getBoundingClientRect();
  const nx = ((clientX - rect.left) / rect.width) * 2 - 1;
  const ny = -((clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera({ x: nx, y: ny }, camera);
  const hits = raycaster.intersectObject(npcModel, true);
  if (hits.length === 0) {
    const center = new THREE.Vector3();
    new THREE.Box3().setFromObject(npcModel).getCenter(center);
    center.project(camera);
    const sx = (center.x * 0.5 + 0.5) * rect.width;
    const sy = (-center.y * 0.5 + 0.5) * rect.height;
    const dx = (clientX - rect.left) - sx;
    const dy = (clientY - rect.top) - sy;
    if (dx * dx + dy * dy > 60 * 60) return false;
  }
  showNpcMenu();
  return true;
}

/**
 * Overlay HTML con botones: Banco / Grand Exchange / Tienda / Cancelar.
 * Sesión 23: añadido botón Tienda.
 */
function showNpcMenu() {
  if (npcMenuEl) return;
  npcMenuEl = document.createElement('div');
  npcMenuEl.id = 'interiorNpcMenu';
  npcMenuEl.style.cssText = `
    position: absolute;
    top: 50%; left: 50%;
    transform: translate(-50%, -50%);
    z-index: 30;
    background: rgba(20, 14, 8, 0.95);
    border: 2px solid #c8a043;
    border-radius: 6px;
    padding: 18px 22px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.7);
    min-width: 260px;
    display: flex; flex-direction: column; gap: 10px;
    font-family: 'Cinzel', serif;
  `;
  const title = document.createElement('div');
  title.textContent = '¿En qué puedo ayudarte?';
  title.style.cssText = `
    color: #e8c560;
    font-size: 15px;
    text-align: center;
    margin-bottom: 6px;
    letter-spacing: 0.05em;
    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.9);
  `;
  npcMenuEl.appendChild(title);

  const btnStyle = `
    background: rgba(40, 28, 16, 0.92);
    border: 1.5px solid #a88040;
    color: #fff8d0;
    font-family: 'Cinzel', serif;
    font-size: 14px;
    font-weight: 700;
    padding: 11px 16px;
    border-radius: 4px;
    text-align: left;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.85);
  `;

  const btnBank = document.createElement('button');
  btnBank.innerHTML = '🏦 &nbsp; Abrir banco';
  btnBank.style.cssText = btnStyle;
  btnBank.addEventListener('pointerup', (ev) => {
    if (ev.button !== undefined && ev.button !== 0) return;
    ev.preventDefault(); ev.stopPropagation();
    closeNpcMenu();
    try { onOpenBank(); } catch (e) { console.warn('[interiors] onOpenBank:', e); }
  });

  const btnGE = document.createElement('button');
  btnGE.innerHTML = '🏛️ &nbsp; Grand Exchange';
  btnGE.style.cssText = btnStyle;
  btnGE.addEventListener('pointerup', (ev) => {
    if (ev.button !== undefined && ev.button !== 0) return;
    ev.preventDefault(); ev.stopPropagation();
    closeNpcMenu();
    try { onOpenGE(); } catch (e) { console.warn('[interiors] onOpenGE:', e); }
  });

  // Sesión 23 — Botón Tienda
  const btnShop = document.createElement('button');
  btnShop.innerHTML = '🛒 &nbsp; Tienda';
  btnShop.style.cssText = btnStyle;
  btnShop.addEventListener('pointerup', (ev) => {
    if (ev.button !== undefined && ev.button !== 0) return;
    ev.preventDefault(); ev.stopPropagation();
    closeNpcMenu();
    try { onOpenShop(); } catch (e) { console.warn('[interiors] onOpenShop:', e); }
  });

  const btnCancel = document.createElement('button');
  btnCancel.textContent = '✖ Cancelar';
  btnCancel.style.cssText = btnStyle + 'color: #c8a89a; border-color: #6a4a30; margin-top: 4px; text-align: center;';
  btnCancel.addEventListener('pointerup', (ev) => {
    if (ev.button !== undefined && ev.button !== 0) return;
    ev.preventDefault(); ev.stopPropagation();
    closeNpcMenu();
  });

  npcMenuEl.appendChild(btnBank);
  npcMenuEl.appendChild(btnGE);
  npcMenuEl.appendChild(btnShop);   // sesión 23
  npcMenuEl.appendChild(btnCancel);
  (document.getElementById('worldScreen') || document.body).appendChild(npcMenuEl);
}

function closeNpcMenu() {
  if (!npcMenuEl) return;
  npcMenuEl.remove();
  npcMenuEl = null;
}

function disposeGroup(group) {
  group.traverse(o => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) {
      if (Array.isArray(o.material)) o.material.forEach(m => m.dispose());
      else o.material.dispose();
    }
  });
}
