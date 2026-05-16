/**
 * SebasPresent — Interiors module (Sesión 11c-1)
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
 *
 * En 11c-2 cargaremos el NPC del mostrador dentro del interior y un menú
 * Banco/GE al tappearlo.
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// ============================================================
// Constantes
// ============================================================
const R2_BASE = 'https://pub-bb63b96c76c745f59a39649cde6678c0.r2.dev';
const INTERIOR_URL = `${R2_BASE}/interiors/medieval_room.glb`;

// Altura objetivo del interior tras escalado (en metros).
// El modelo viene en Z-up (Blender). Tras rotación Z-up→Y-up, la altura
// post-rotación se mide del eje Y del modelo (que era Z en Blender).
// Modelo Z original ~120 unidades → con 4m target, scale ≈ 0.033.
const INTERIOR_HEIGHT = 4.0;

// Coords absolutas donde se coloca el interior en el mundo.
// Lejos de WORLD_HALF (2048) para no chocar con el sistema de chunks
// de terrain. Si el player teleporta accidentalmente fuera del interior
// pero cerca de estas coords, terrain.chunkInsideWorld() devolverá false
// y no generará chunks (zonas "vacías").
const INTERIOR_CENTER = { x: 10000, z: 10000 };

// Spawn del player dentro: 5m al sur del centro (Z menor), mirando al
// norte (rotY=0). Si en 11c-2 el NPC está al norte del centro, el player
// aparece mirando al NPC.
const PLAYER_SPAWN_OFFSET = { x: 0, z: -5 };

// Visual del interior — cielo oscuro + fog corto. Da sensación de
// estar dentro de un edificio cerrado.
const INTERIOR_BG = 0x1a1410;
const INTERIOR_FOG_NEAR = 8;
const INTERIOR_FOG_FAR = 30;

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

let interiorRoot = null;   // Group con el modelo cargado (posicionado en INTERIOR_CENTER)
let interiorFloor = null;  // Plano invisible para tap-to-walk dentro
let interiorBox = null;    // { minX, maxX, minZ, maxZ } en coords locales (centradas en 0)

let savedBg = 0;
let savedFogColor = null;
let savedFogNear = 0;
let savedFogFar = 0;
let lastExteriorPos = null;   // { x, z } posición exterior antes de entrar
let lastExteriorRotY = 0;
let exitButtonEl = null;
let active = false;
let started = false;

// ============================================================
// API pública
// ============================================================

export async function start(opts) {
  if (started) {
    console.warn('[interiors] start() llamado dos veces sin stop()');
    stop();
  }
  scene = opts.scene;
  getPlayer = opts.getPlayer || (() => null);
  onEnterCallback = opts.onEnter || (() => {});
  onLeaveCallback = opts.onLeave || (() => {});
  if (!scene) {
    console.warn('[interiors] start() sin scene en opts');
    return;
  }

  interiorRoot = await loadAndMergeInterior(INTERIOR_URL, INTERIOR_HEIGHT);
  if (!interiorRoot) {
    console.warn('[interiors] No se pudo cargar el GLB del interior. enter() será inerte.');
    started = false;
    return;
  }

  // Colocar el interior en sus coords absolutas. Empezamos oculto.
  interiorRoot.position.set(INTERIOR_CENTER.x, 0, INTERIOR_CENTER.z);
  interiorRoot.visible = false;
  scene.add(interiorRoot);

  // Calcular bbox local del template (sin posición absoluta aplicada).
  // Hacemos un Box3 sobre el template antes de moverlo: ya guardamos
  // ese bbox en el loader; recalculamos aquí desde el world bbox + offset.
  const worldBox = new THREE.Box3().setFromObject(interiorRoot);
  interiorBox = {
    minX: worldBox.min.x - INTERIOR_CENTER.x + COLLISION_MARGIN,
    maxX: worldBox.max.x - INTERIOR_CENTER.x - COLLISION_MARGIN,
    minZ: worldBox.min.z - INTERIOR_CENTER.z + COLLISION_MARGIN,
    maxZ: worldBox.max.z - INTERIOR_CENTER.z - COLLISION_MARGIN,
  };
  // Guard: si margen excede el tamaño, fallback a margen 0 (sala muy pequeña)
  if (interiorBox.maxX <= interiorBox.minX || interiorBox.maxZ <= interiorBox.minZ) {
    console.warn('[interiors] bbox demasiado pequeño para margen; usando margen 0');
    interiorBox = {
      minX: worldBox.min.x - INTERIOR_CENTER.x,
      maxX: worldBox.max.x - INTERIOR_CENTER.x,
      minZ: worldBox.min.z - INTERIOR_CENTER.z,
      maxZ: worldBox.max.z - INTERIOR_CENTER.z,
    };
  }

  // Plano floor invisible — el raycaster lo intersecta para tap-to-walk
  // pero opacity:0 lo hace invisible visualmente. depthWrite:false evita
  // que tape los meshes del suelo del modelo en el render.
  const sizeX = worldBox.max.x - worldBox.min.x;
  const sizeZ = worldBox.max.z - worldBox.min.z;
  const floorGeom = new THREE.PlaneGeometry(sizeX, sizeZ);
  floorGeom.rotateX(-Math.PI / 2);
  const floorMat = new THREE.MeshBasicMaterial({
    transparent: true, opacity: 0,
    side: THREE.DoubleSide, depthWrite: false,
  });
  interiorFloor = new THREE.Mesh(floorGeom, floorMat);
  interiorFloor.position.set(INTERIOR_CENTER.x, 0.02, INTERIOR_CENTER.z);
  interiorFloor.userData = { kind: 'interior-floor' };
  interiorFloor.visible = false;
  scene.add(interiorFloor);

  started = true;
  console.log(`[interiors] Cargado. BBox local: X[${interiorBox.minX.toFixed(2)},${interiorBox.maxX.toFixed(2)}] Z[${interiorBox.minZ.toFixed(2)},${interiorBox.maxZ.toFixed(2)}]`);
}

export function stop() {
  if (!started) return;
  if (active) forceLeave();  // limpieza UI sin teleport
  if (interiorRoot && scene) {
    scene.remove(interiorRoot);
    disposeGroup(interiorRoot);
  }
  if (interiorFloor && scene) {
    scene.remove(interiorFloor);
    interiorFloor.geometry?.dispose();
    interiorFloor.material?.dispose();
  }
  removeExitButton();
  interiorRoot = null;
  interiorFloor = null;
  interiorBox = null;
  scene = null;
  getPlayer = () => null;
  onEnterCallback = () => {};
  onLeaveCallback = () => {};
  active = false;
  started = false;
}

/**
 * Entra al interior. fromBuildingId es informativo (en 11c-2 lo usaremos
 * para distinguir qué NPC mostrar si varían por edificio).
 */
export function enter(fromBuildingId) {
  if (!started || active || !interiorRoot) return;
  const player = getPlayer();
  if (!player) return;

  // Guardar posición exterior para volver al salir
  lastExteriorPos = { x: player.position.x, z: player.position.z };
  lastExteriorRotY = player.rotation.y;

  // Teleportar al interior
  player.position.x = INTERIOR_CENTER.x + PLAYER_SPAWN_OFFSET.x;
  player.position.z = INTERIOR_CENTER.z + PLAYER_SPAWN_OFFSET.z;
  player.rotation.y = 0;  // mirando al norte (+Z), hacia el mostrador (NPC en 11c-2)

  // Mostrar interior
  interiorRoot.visible = true;
  interiorFloor.visible = true;

  // Cambiar visual: cielo oscuro + fog corto
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

/**
 * Sale del interior. Teleporta al player a la posición exterior previa.
 */
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

/**
 * Limpia el estado UI sin teleportar al player. Útil cuando algo externo
 * ya teleportó al player (home_teleport, logout). El caller es responsable
 * de la posición del player.
 */
export function forceLeave() {
  if (!active) return;
  finishLeave();
}

function finishLeave() {
  if (interiorRoot) interiorRoot.visible = false;
  if (interiorFloor) interiorFloor.visible = false;
  if (scene) {
    scene.background = new THREE.Color(savedBg);
    if (scene.fog && savedFogColor !== null) {
      scene.fog.color = new THREE.Color(savedFogColor);
      scene.fog.near = savedFogNear;
      scene.fog.far = savedFogFar;
    }
  }
  removeExitButton();
  lastExteriorPos = null;
  active = false;
}

export function isActive() {
  return active;
}

/**
 * Devuelve el plano floor invisible. world.js lo usa en doCanvasTap para
 * hacer raycast cuando estamos en interior.
 */
export function getFloorMesh() {
  return interiorFloor;
}

/**
 * Colisión: clamp del player al bbox de la sala con margen. Solo activo
 * cuando estamos en interior. Fuera, devuelve el target sin cambios.
 */
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
// Botón "↩ Salir"
// ============================================================

function showExitButton() {
  if (exitButtonEl) return;
  exitButtonEl = document.createElement('button');
  exitButtonEl.id = 'interiorExitBtn';
  exitButtonEl.textContent = '↩ Salir';
  exitButtonEl.style.cssText = `
    position: absolute;
    top: calc(env(safe-area-inset-top, 0px) + 100px);
    left: 16px;
    z-index: 25;
    background: rgba(20, 14, 8, 0.92);
    border: 2px solid #c8a043;
    color: #e8c560;
    font-family: 'Cinzel', serif;
    font-size: 14px;
    font-weight: 700;
    padding: 10px 18px;
    border-radius: 4px;
    text-shadow: 0 1px 2px rgba(0,0,0,0.9);
    box-shadow: 0 4px 12px rgba(0,0,0,0.5);
    cursor: pointer;
    letter-spacing: 0.05em;
    -webkit-tap-highlight-color: transparent;
    user-select: none;
  `;
  exitButtonEl.addEventListener('pointerup', (ev) => {
    if (ev.button !== undefined && ev.button !== 0) return;
    ev.preventDefault();
    ev.stopPropagation();
    leave();
  });
  (document.getElementById('worldScreen') || document.body).appendChild(exitButtonEl);
}

function removeExitButton() {
  if (!exitButtonEl) return;
  exitButtonEl.remove();
  exitButtonEl = null;
}

// ============================================================
// Carga + merge del GLB del interior
// ============================================================
//
// El modelo viene en Z-up (Blender convention). Lo rotamos -π/2 en X
// para convertirlo a Y-up que three.js espera. La detectsZUp() de
// terrain.js no es fiable para habitaciones (más anchas que altas), así
// que aquí fuerzo la rotación.
//
// Después agrupamos por material y fusionamos geometrías (mismo patrón
// que buildings.js) para reducir draw calls. Modelo tiene 29 meshes y
// 20 materiales → resultado ~12-15 draw calls.

async function loadAndMergeInterior(url, targetHeight) {
  const loader = new GLTFLoader();
  let gltf;
  try {
    gltf = await loader.loadAsync(url);
  } catch (err) {
    console.warn(`[interiors] No se pudo cargar GLB '${url}':`, err.message);
    return null;
  }
  const root = gltf.scene;

  // Forzar Z-up → Y-up rotation
  root.rotation.x = -Math.PI / 2;
  root.updateMatrixWorld(true);

  // BBox tras la rotación para calcular escala + offset al suelo
  const bbox = new THREE.Box3().setFromObject(root);
  const sizeY = bbox.max.y - bbox.min.y;
  if (sizeY < 0.001) {
    console.warn('[interiors] BBox degenerado (sizeY ~0). Modelo inválido.');
    return null;
  }
  const scaleFactor = targetHeight / sizeY;
  const yOffset = -bbox.min.y * scaleFactor;

  // Agrupar meshes por material
  const groups = new Map();
  root.traverse(obj => {
    if (!obj.isMesh || !obj.geometry) return;
    let mat = obj.material;
    if (Array.isArray(mat)) mat = mat[0];
    if (!mat) return;
    const matKey = mat.name || mat.uuid;

    const geom = obj.geometry.clone();
    geom.applyMatrix4(obj.matrixWorld);
    const scaleMat = new THREE.Matrix4().makeScale(scaleFactor, scaleFactor, scaleFactor);
    geom.applyMatrix4(scaleMat);
    const offsetMat = new THREE.Matrix4().makeTranslation(0, yOffset, 0);
    geom.applyMatrix4(offsetMat);

    if (!groups.has(matKey)) groups.set(matKey, { material: mat, geoms: [] });
    groups.get(matKey).geoms.push(geom);
  });

  if (groups.size === 0) {
    console.warn('[interiors] El GLB no tiene meshes.');
    return null;
  }

  const result = new THREE.Group();
  result.userData = { kind: 'interior-root' };

  let mergedMaterialGroups = 0;
  let fallbackMeshes = 0;
  let totalSourceMeshes = 0;

  for (const [matKey, entry] of groups) {
    const { material, geoms } = entry;
    totalSourceMeshes += geoms.length;
    const finalMat = cloneOrFallbackMaterial(material);

    let mergedGeom = null;
    try {
      mergedGeom = mergeGeometries(geoms, false);
    } catch (err) {
      console.warn(`[interiors] mergeGeometries falló para '${matKey}':`, err.message);
    }

    if (mergedGeom) {
      const mesh = new THREE.Mesh(mergedGeom, finalMat);
      mesh.userData = { kind: 'interior-part', materialName: matKey };
      result.add(mesh);
      mergedMaterialGroups++;
      for (const g of geoms) g.dispose?.();
    } else {
      for (const g of geoms) {
        const mesh = new THREE.Mesh(g, finalMat.clone());
        mesh.userData = { kind: 'interior-part', materialName: matKey };
        result.add(mesh);
        fallbackMeshes++;
      }
    }
  }

  console.log(
    `[interiors] GLB cargado: ${totalSourceMeshes} meshes originales → ` +
    `${mergedMaterialGroups} materiales fusionados + ${fallbackMeshes} meshes sin merge ` +
    `(total ${result.children.length} draw calls).`
  );
  return result;
}

function cloneOrFallbackMaterial(srcMat) {
  let mat;
  if (srcMat && (srcMat.isMeshStandardMaterial || srcMat.isMeshLambertMaterial || srcMat.isMeshBasicMaterial)) {
    mat = srcMat.clone();
  } else {
    mat = new THREE.MeshLambertMaterial({
      color: srcMat?.color ? srcMat.color.clone() : new THREE.Color(0x808080),
      map: srcMat?.map || null,
    });
  }
  mat.side = THREE.DoubleSide;
  if (srcMat && (srcMat.transparent || srcMat.alphaTest > 0 || srcMat.alphaMap)) {
    mat.alphaTest = 0.4;
    mat.transparent = false;
  }
  return mat;
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
