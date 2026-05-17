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

// ============================================================
// Constantes
// ============================================================
const R2_BASE = 'https://pub-bb63b96c76c745f59a39649cde6678c0.r2.dev';
const INTERIOR_URL = `${R2_BASE}/interiors/medieval_room.glb`;
const NPC_URL = `${R2_BASE}/npcs/the_boss.fbx`;

// Sesión 11c-2: ampliado x4 — 4m → 16m de alto. La cámara orbital está
// a ~7m sobre el player; con sala de 4m perforaba el techo. Con 16m la
// cámara queda dentro y se ve correctamente.
const INTERIOR_HEIGHT = 16.0;

// Altura del NPC tras escalar el FBX (humano ~1.8m).
const NPC_HEIGHT = 1.8;

// Offset del NPC respecto al centro del interior: 5m al norte (asumimos
// mostrador en el centro-norte tras escalado). Si queda atravesando un
// mueble, ajustar.
const NPC_OFFSET = { x: 0, z: 5 };

// Coords absolutas donde se coloca el interior en el mundo.
// Lejos de WORLD_HALF (2048) para no chocar con el sistema de chunks
// de terrain. Si el player teleporta accidentalmente fuera del interior
// pero cerca de estas coords, terrain.chunkInsideWorld() devolverá false
// y no generará chunks (zonas "vacías").
const INTERIOR_CENTER = { x: 10000, z: 10000 };

// Spawn del player dentro: 20m al sur del centro (sala ahora es ~60m de
// profundidad tras x4 escalado), mirando al norte hacia el mostrador y NPC.
const PLAYER_SPAWN_OFFSET = { x: 0, z: -20 };

// Visual del interior — cielo oscuro + fog amplio para sala grande.
const INTERIOR_BG = 0x1a1410;
const INTERIOR_FOG_NEAR = 20;
const INTERIOR_FOG_FAR = 100;

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

let interiorRoot = null;   // Group con el modelo cargado (posicionado en INTERIOR_CENTER)
let interiorFloor = null;  // Plano invisible para tap-to-walk dentro
let interiorBox = null;    // { minX, maxX, minZ, maxZ } en coords locales (centradas en 0)
let interiorLight = null;  // Luz ambiental extra (la del exterior puede no llegar bien)
let npcModel = null;       // Sesión 11c-2 — FBX cargado, posicionado en NPC_OFFSET
let npcMixer = null;       // AnimationMixer del NPC (idle loop)
let npcMenuEl = null;      // Overlay HTML con opciones Banco/GE
let raycaster = null;      // Reusable para tryHandleNpcTap

let savedBg = 0;
let savedFogColor = null;
let savedFogNear = 0;
let savedFogFar = 0;
let lastExteriorPos = null;   // { x, z } posición exterior antes de entrar
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

  // Colocar el interior. IMPORTANTE: el bbox se calcula ANTES de poner
  // visible=false, porque Box3.setFromObject ignora objetos invisibles
  // (devolvería bbox vacío ±Infinity y rompería la colisión y el floor mesh).
  // Colocar el interior en sus coords absolutas. Lo dejamos SIEMPRE visible
  // (a 10000m del player exterior, queda fuera del frustum y no se ve).
  // En enter() solo cambiamos bg/fog/teleport. No alternamos visibility
  // porque eso resultó frágil en testing previo.
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
    console.log(`[interiors] BBox local (con margen ${COLLISION_MARGIN}m): X[${interiorBox.minX.toFixed(2)},${interiorBox.maxX.toFixed(2)}] Z[${interiorBox.minZ.toFixed(2)},${interiorBox.maxZ.toFixed(2)}]`);
  }

  // SIEMPRE visible. A 10000m del exterior está fuera del frustum (far=274).
  interiorRoot.visible = true;

  // Plano floor invisible — el raycaster lo intersecta para tap-to-walk
  // pero opacity:0 lo hace invisible visualmente. depthWrite:false evita
  // que tape los meshes del suelo del modelo en el render.
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
  interiorFloor.visible = true;  // opacity:0 lo hace invisible visualmente
  scene.add(interiorFloor);

  // Luz ambiental SIEMPRE encendida. AmbientLight afecta a toda la scene
  // pero los meshes del exterior están todavía iluminados por la sun+ambient
  // global; este extra solo añade brillo al interior. Si interfiere, se baja.
  interiorLight = new THREE.AmbientLight(0xffffff, 0.5);
  interiorLight.visible = true;
  scene.add(interiorLight);

  // Sesión 11c-2: cargar NPC FBX (the_boss) y posicionarlo tras el mostrador.
  // Lo cargamos en paralelo conceptualmente — si falla, el interior funciona
  // igual pero sin NPC interactuable.
  try {
    const npcPack = await loadNpc(NPC_URL, NPC_HEIGHT);
    if (npcPack) {
      npcModel = npcPack.model;
      npcMixer = npcPack.mixer;
      npcModel.position.set(centerX + NPC_OFFSET.x, 0, centerZ + NPC_OFFSET.z);
      npcModel.rotation.y = Math.PI;  // mirando hacia el sur (al player que entra)
      npcModel.userData = { kind: 'npc-interior', name: 'Banquero' };
      scene.add(npcModel);
      console.log(`[interiors] NPC cargado y posicionado en (${npcModel.position.x.toFixed(1)}, ${npcModel.position.z.toFixed(1)}).`);
    } else {
      console.warn('[interiors] NPC no cargó. El menú banco/GE no estará disponible.');
    }
  } catch (err) {
    console.warn('[interiors] Error cargando NPC:', err);
  }

  started = true;
  console.log(`[interiors] Setup completo. Children del root: ${interiorRoot.children.length}. Floor mesh size: ${sizeX.toFixed(2)} x ${sizeZ.toFixed(2)}. Interior en (${centerX},${centerZ}).`);
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
  active = false;
  started = false;
}

/**
 * Entra al interior. fromBuildingId es informativo (en 11c-2 lo usaremos
 * para distinguir qué NPC mostrar si varían por edificio).
 */
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

  // Guardar posición exterior para volver al salir
  lastExteriorPos = { x: player.position.x, z: player.position.z };
  lastExteriorRotY = player.rotation.y;

  // Teleportar al interior
  player.position.x = INTERIOR_CENTER.x + PLAYER_SPAWN_OFFSET.x;
  player.position.z = INTERIOR_CENTER.z + PLAYER_SPAWN_OFFSET.z;
  player.rotation.y = 0;  // mirando al norte (+Z), hacia el mostrador (NPC en 11c-2)

  // El modelo está siempre visible (a 10000m del exterior, fuera del frustum).
  // Aquí solo cambiamos bg/fog y teleportamos. Eso basta para "entrar".
  console.log(`[interiors] enter() player teleportado a (${player.position.x.toFixed(1)}, ${player.position.y.toFixed(1)}, ${player.position.z.toFixed(1)})`);
  console.log(`[interiors] enter('${fromBuildingId}'). Player en (${player.position.x.toFixed(1)}, ${player.position.z.toFixed(1)}). InteriorRoot children=${interiorRoot.children.length} visible=${interiorRoot.visible}`);

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
  // El modelo permanece siempre visible en (10000, 10000); al salir, el
  // player vuelve al exterior y queda fuera del frustum (10000m de distancia).
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
// Botón "Salir del edificio"
// ============================================================
// Texto distintivo para no confundirlo con el "Salir" del HUD permanente
// (logout). Posicionado centrado horizontalmente en la zona alta para
// quedar bien visible y aislado del resto de botones.

function showExitButton() {
  if (exitButtonEl) return;
  exitButtonEl = document.createElement('button');
  exitButtonEl.id = 'interiorExitBtn';
  exitButtonEl.textContent = '↩ Salir del edificio';
  exitButtonEl.style.cssText = `
    position: absolute;
    bottom: calc(env(safe-area-inset-bottom, 0px) + 24px);
    left: 50%;
    transform: translateX(-50%);
    z-index: 25;
    background: rgba(20, 14, 8, 0.92);
    border: 2px solid #c8a043;
    color: #e8c560;
    font-family: 'Cinzel', serif;
    font-size: 14px;
    font-weight: 700;
    padding: 12px 22px;
    border-radius: 4px;
    text-shadow: 0 1px 2px rgba(0,0,0,0.9);
    box-shadow: 0 4px 12px rgba(0,0,0,0.5);
    cursor: pointer;
    letter-spacing: 0.05em;
    white-space: nowrap;
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
// Carga del GLB del interior
// ============================================================
//
// IMPORTANTE: el root del GLB (Sketchfab_model) viene con una matrix
// fija que YA aplica Z-up→Y-up + escala 0.023. GLTFLoader marca este
// nodo con matrixAutoUpdate=false, así que tocar root.rotation NO
// surte efecto. Tampoco podemos baquear las matrices a las geoms con
// applyMatrix4(matrixWorld) directamente porque something en ese flujo
// rompía silenciosamente el render (probablemente combinación de
// matrices no-uniformes con merge).
//
// Approach robusto: dejar el árbol del GLB tal cual y wrappearlo en un
// Group nuestro que aplica escala adicional + offset Y para apoyar la
// base en Y=0. Three.js maneja toda la jerarquía de matrices.
//
// Coste: perdemos el merge por material (29 meshes = 29 draw calls).
// Como solo hay UNA instancia visible del interior a la vez, asumible.
// Optimizable después si performance lo pide.

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

  // BBox en world coords (incluye la matrix del root con Z-up→Y-up + scale 0.023)
  const bbox = new THREE.Box3().setFromObject(root);
  const sizeY = bbox.max.y - bbox.min.y;
  if (sizeY < 0.001) {
    console.warn('[interiors] BBox degenerado del modelo:', bbox);
    return null;
  }
  const scaleFactor = targetHeight / sizeY;
  console.log(
    `[interiors] BBox post-GLB: X[${bbox.min.x.toFixed(2)},${bbox.max.x.toFixed(2)}] ` +
    `Y[${bbox.min.y.toFixed(2)},${bbox.max.y.toFixed(2)}] ` +
    `Z[${bbox.min.z.toFixed(2)},${bbox.max.z.toFixed(2)}] sizeY=${sizeY.toFixed(2)} → scale=${scaleFactor.toFixed(3)}`
  );

  // Forzar visibility + DoubleSide para no perder caras vistas desde dentro
  let meshCount = 0;
  root.traverse(o => {
    if (!o.isMesh) return;
    o.visible = true;
    meshCount++;
    if (o.material) {
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        m.side = THREE.DoubleSide;
        // Normalizar transparency rara que pueda venir del GLB
        if (m.transparent || m.alphaTest > 0 || m.alphaMap) {
          m.alphaTest = 0.4;
          m.transparent = false;
        }
      }
    }
  });

  // Wrapper Group: aplica escala uniforme + offset Y para base en Y=0
  const wrapper = new THREE.Group();
  wrapper.userData = { kind: 'interior-root' };
  wrapper.add(root);
  wrapper.scale.set(scaleFactor, scaleFactor, scaleFactor);
  wrapper.position.y = -bbox.min.y * scaleFactor;

  console.log(`[interiors] ${meshCount} meshes cargados (sin merge — wrapper group).`);
  return wrapper;
}

// ============================================================
// Sesión 11c-2 — NPC del mostrador (FBX + idle anim + tap → menú)
// ============================================================

/**
 * Carga el FBX, lo escala a NPC_HEIGHT y arranca el primer AnimationClip
 * embebido (idle). FBX de Mixamo suele venir en ~100x escala.
 * Devuelve { model, mixer } o null si falla.
 */
async function loadNpc(url, targetHeight) {
  // Import dinámico del FBXLoader: si el bundler/importmap no lo tiene
  // resuelto, no rompemos startWorld. El interior funciona sin NPC.
  let FBXLoader;
  try {
    const mod = await import('three/addons/loaders/FBXLoader.js');
    FBXLoader = mod.FBXLoader;
  } catch (err) {
    console.warn('[interiors] No se pudo importar FBXLoader:', err.message,
      '— el NPC no se cargará. Posible causa: importmap sin entrada para FBXLoader.');
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

  // BBox pre-escala para calcular factor
  fbx.updateMatrixWorld(true);
  const bbox = new THREE.Box3().setFromObject(fbx);
  const sizeY = bbox.max.y - bbox.min.y;
  if (sizeY < 0.001) {
    console.warn('[interiors] NPC BBox degenerado.');
    return null;
  }
  const scaleFactor = targetHeight / sizeY;
  fbx.scale.set(scaleFactor, scaleFactor, scaleFactor);
  fbx.position.y = -bbox.min.y * scaleFactor;  // apoyar pies en Y=0

  // Asegurar DoubleSide en todos los materiales y mantener visibilidad
  fbx.traverse(o => {
    if (o.isMesh) {
      o.frustumCulled = false;  // skinned a veces falla frustum culling con bbox raros
      if (o.material) {
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) {
          m.side = THREE.DoubleSide;
        }
      }
    }
  });

  // Animation: arrancar el primer clip (típicamente idle)
  let mixer = null;
  if (fbx.animations && fbx.animations.length > 0) {
    mixer = new THREE.AnimationMixer(fbx);
    const clip = fbx.animations[0];
    const action = mixer.clipAction(clip);
    action.play();
    console.log(`[interiors] NPC clip activado: '${clip.name}' (${fbx.animations.length} clips disponibles).`);
  } else {
    console.log('[interiors] NPC sin animaciones embebidas — quedará estático en T-pose.');
  }

  return { model: fbx, mixer };
}

/**
 * Tick por frame del mixer del NPC. world.js lo invoca desde el animate
 * loop. dt en segundos.
 */
export function update(dt) {
  if (npcMixer) {
    try { npcMixer.update(dt); } catch {}
  }
}

/**
 * Tap detection sobre el NPC. Si el rayo impacta el modelo, abre el menú
 * Banco/GE y devuelve true (tap capturado). world.js debe llamar a este
 * tryHandleNpcTap antes que al floor en doCanvasTap, cuando el interior
 * está activo.
 */
export function tryHandleNpcTap(clientX, clientY) {
  if (!active || !npcModel || !raycaster || !camera || !canvas) return false;
  const rect = canvas.getBoundingClientRect();
  const nx = ((clientX - rect.left) / rect.width) * 2 - 1;
  const ny = -((clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera({ x: nx, y: ny }, camera);
  const hits = raycaster.intersectObject(npcModel, true);
  if (hits.length === 0) {
    // Fallback: proximidad screen-space al centro del NPC. En móvil con
    // figuras finas es difícil acertar exacto; pickeamos si el tap está
    // a < 60px del centro proyectado del NPC.
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
 * Overlay HTML con dos botones: Banco / Grand Exchange. Centrado en pantalla.
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
    display: flex; flex-direction: column; gap: 12px;
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
    font-size: 15px;
    font-weight: 700;
    padding: 12px 16px;
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
  btnGE.innerHTML = '🏛️ &nbsp; Abrir Grand Exchange';
  btnGE.style.cssText = btnStyle;
  btnGE.addEventListener('pointerup', (ev) => {
    if (ev.button !== undefined && ev.button !== 0) return;
    ev.preventDefault(); ev.stopPropagation();
    closeNpcMenu();
    try { onOpenGE(); } catch (e) { console.warn('[interiors] onOpenGE:', e); }
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
