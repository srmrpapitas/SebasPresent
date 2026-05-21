/**
 * SebasPresent — Buildings module (Sesión 11a)
 *
 * Carga el GLB del edificio (low_poly_building.glb) y coloca instancias
 * decorativas en el mundo. NO tiene interacción todavía — esta sesión
 * solo verifica que el modelo se ve, escala bien y rinde en móvil.
 *
 * Sesión 11b añadirá el trigger de "entrar". 11c el interior. 11d el
 * NPC + menú Banco/GE. 11e retirará los tabs 🏦/🏛️ del sidebar y
 * añadirá ubicaciones extra.
 *
 * Patrón estándar del proyecto: start({ deps }) / stop().
 * Sin update() — los edificios son estáticos.
 *
 * Optimización clave: el GLB original tiene 297 meshes anidados (es un
 * modelo de Sketchfab con jerarquía Maya redundante). Cargarlo tal cual
 * daría 297 draw calls × 3 edificios = catastrófico en móvil. Aquí
 * hacemos merge por material: agrupamos todos los meshes que comparten
 * material y los fundimos en una sola geometría. Pasa de 297 → ~10-14
 * draw calls por edificio.
 *
 * Cómo se usa desde world.js:
 *
 *   import * as buildings from './buildings.js';
 *
 *   await terrain.start({ scene });        // primero terrain
 *   await buildings.start({ scene });      // luego buildings
 *
 *   // En logout / cleanup:
 *   buildings.stop();
 *
 * El módulo no necesita update() ni hooks en el render loop.
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// ============================================================
// Constantes
// ============================================================
const R2_BASE = 'https://pub-bb63b96c76c745f59a39649cde6678c0.r2.dev';
const BUILDING_URL = `${R2_BASE}/buildings/low_poly_building.glb`;

// Altura objetivo del edificio en metros (escala player ~1.7m).
// 16m = edificio grande, ~3-4 plantas + tejado. Como el escalado es
// uniforme, ancho y profundidad escalan en la misma proporción.
const TARGET_HEIGHT = 16.0;

/**
 * Ubicaciones de los 3 edificios. Cambia coords aquí si las quieres mover.
 *
 *   x, z: posición en el mundo (mismo sistema que terrain).
 *   rotY: rotación en radianes alrededor del eje Y. La puerta del modelo
 *         apunta en una dirección concreta (a confirmar visualmente
 *         tras el primer load). Si la puerta no mira donde quieres,
 *         ajusta rotY en pasos de Math.PI/2.
 *   id:   identificador interno. En 11b/c/d lo usaremos para distinguir
 *         qué edificio se está entrando.
 *
 * Reglas usadas para elegir estas coords:
 *   - 'plaza': 12m al este del spawn (0,0). El spawn ya tiene el PLACE
 *     'Concejo Central' que ocupa ~3.5m de radio + columna de 10m de alto;
 *     12m lo deja claramente fuera de esa estructura.
 *   - 'forest': 50m al noreste de Robledal (-300, -700), sigue dentro del
 *     radio "named region" (130m city) → entrarás en el edificio estando
 *     en zona Robledal.
 *   - 'desert': 60m al noroeste de Solquemado (1500, 100), idem.
 */
const BUILDING_PLACEMENTS = [
  { id: 'plaza',  x:   30, z:    0, rotY: -Math.PI / 2 },
  { id: 'forest', x: -260, z: -660, rotY: 0 },
  { id: 'desert', x: 1460, z:   60, rotY: Math.PI },
];

// ============================================================
// Estado del módulo (privado)
// ============================================================
let scene = null;
let camera = null;
let canvas = null;
let feedLog = () => {};
let onTapBuilding = null;  // callback opcional: (buildingId) => void
let instances = [];   // Group instances colocados en el world
let templateGroup = null; // Group mergeado, se clona para cada instance
let templateBox = null;   // { minX, maxX, minZ, maxZ } en coords locales tras escalado
let raycaster = null;
let started = false;

// ============================================================
// API pública
// ============================================================
export async function start(opts) {
  if (started) {
    console.warn('[buildings] start() llamado dos veces sin stop()');
    stop();
  }
  scene = opts.scene;
  camera = opts.camera || null;
  canvas = opts.canvas || null;
  feedLog = opts.feedLog || (() => {});
  onTapBuilding = opts.onTapBuilding || null;
  if (!scene) {
    console.warn('[buildings] start() sin scene en opts');
    return;
  }
  raycaster = new THREE.Raycaster();

  templateGroup = await loadAndMergeBuilding(BUILDING_URL, TARGET_HEIGHT);
  if (!templateGroup) {
    console.warn('[buildings] No se pudo cargar el edificio. start() inerte.');
    started = false;
    return;
  }

  // Calcular AABB en coords locales del template (sin rotación de instance
  // aplicada). Lo usamos en applyCollision para test punto-vs-OBB.
  const tBox = new THREE.Box3().setFromObject(templateGroup);
  templateBox = {
    minX: tBox.min.x, maxX: tBox.max.x,
    minZ: tBox.min.z, maxZ: tBox.max.z,
  };

  for (const p of BUILDING_PLACEMENTS) {
    const inst = templateGroup.clone(true);
    inst.position.set(p.x, 0, p.z);
    inst.rotation.y = p.rotY || 0;
    inst.userData = { kind: 'building', buildingId: p.id };
    scene.add(inst);
    instances.push(inst);
  }
  started = true;
}

export function stop() {
  if (!started) return;
  for (const inst of instances) {
    if (scene) scene.remove(inst);
    disposeGroup(inst);
  }
  instances = [];
  if (templateGroup) {
    disposeGroup(templateGroup);
    templateGroup = null;
  }
  templateBox = null;
  raycaster = null;
  scene = null;
  camera = null;
  canvas = null;
  feedLog = () => {};
  onTapBuilding = null;
  started = false;
}

/**
 * Devuelve la lista de Groups (uno por edificio colocado). En 11b la
 * usaremos para detectar proximidad a la puerta de cada edificio.
 */
export function getInstances() {
  return instances;
}

// ============================================================
// API pública: colisión (slide style — igual patrón que terrain)
// ============================================================

/**
 * Test punto vs OBB de cada edificio. Devuelve { x, z } ajustado para
 * que el player no atraviese paredes. Patrón slide: si chocas en X
 * pero no en Z, te dejamos resbalar pegado a la pared.
 *
 * Se llama desde world.js DESPUÉS de terrain.applyCollision, así
 * encadenan: árboles primero, edificios después.
 */
export function applyCollision(x0, z0, x1, z1) {
  if (!started || instances.length === 0 || !templateBox) return { x: x1, z: z1 };
  const tryX = collidesAt(x1, z0);
  const tryZ = collidesAt(x0, z1);
  const finalX = tryX ? x0 : x1;
  const finalZ = tryZ ? z0 : z1;
  if (collidesAt(finalX, finalZ)) return { x: x0, z: z0 };
  return { x: finalX, z: finalZ };
}

/**
 * Punto (worldX, worldZ) ¿está dentro del OBB de algún edificio?
 * Cada edificio tiene rotación rotY en Y. Llevamos el punto al
 * espacio local del edificio (inversa de la rotación + translación)
 * y comprobamos AABB sencillo contra templateBox.
 */
function collidesAt(worldX, worldZ) {
  for (const p of BUILDING_PLACEMENTS) {
    const dx = worldX - p.x;
    const dz = worldZ - p.z;
    // Inversa de la rotación rotY: rotar el punto -rotY
    const c = Math.cos(-p.rotY);
    const s = Math.sin(-p.rotY);
    const lx = dx * c - dz * s;
    const lz = dx * s + dz * c;
    if (lx >= templateBox.minX && lx <= templateBox.maxX &&
        lz >= templateBox.minZ && lz <= templateBox.maxZ) {
      return true;
    }
  }
  return false;
}

// ============================================================
// API pública: tap (placeholder — sesión 11b/c hará el "entrar")
// ============================================================

/**
 * Si el tap impacta un edificio, hace feedLog y devuelve true (capturado).
 * Si no, devuelve false (world.js sigue al siguiente check del raycast).
 *
 * Por ahora es solo placeholder: confirma al user que el tap se detecta.
 * Cuando llegue 11c, este handler disparará el cambio de escena al interior.
 */
export function tryHandleTap(clientX, clientY) {
  if (!started || !raycaster || !camera || !canvas || instances.length === 0) return false;
  const rect = canvas.getBoundingClientRect();
  const nx = ((clientX - rect.left) / rect.width) * 2 - 1;
  const ny = -((clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera({ x: nx, y: ny }, camera);
  // intersectObjects con recursive=true porque cada instance es un Group
  // con N meshes (uno por material) dentro.
  const hits = raycaster.intersectObjects(instances, true);
  if (hits.length === 0) return false;
  // Subir por la jerarquía hasta encontrar el Group del edificio (kind='building')
  let node = hits[0].object;
  while (node && node.userData?.kind !== 'building') node = node.parent;
  const buildingId = node?.userData?.buildingId || '?';
  // Si hay callback de entrar, llamarlo. Si no, mostrar placeholder feedLog.
  if (typeof onTapBuilding === 'function') {
    try {
      // Sesión 36 — pasamos la posición world del edificio para que el caller
      // (world.js) pueda gatear la entrada por distancia. Antes, este callback
      // recibía solo el id → world.js no tenía forma de validar proximidad
      // → tap desde cualquier punto del mapa entraba al interior (bug UX).
      const buildingWorldPos = new THREE.Vector3();
      node.getWorldPosition(buildingWorldPos);
      onTapBuilding(buildingId, buildingWorldPos);
    }
    catch (e) { console.warn('[buildings] onTapBuilding error:', e); }
  } else {
    feedLog('info', `Edificio (${buildingId}). Próximamente podrás entrar.`);
  }
  return true;
}

// ============================================================
// Carga + merge
// ============================================================

/**
 * Descarga el GLB, baquea transforms, agrupa por material y fusiona
 * geometrías. Devuelve un Group con N meshes (uno por material único)
 * en lugar de los 297 originales del modelo.
 *
 * Fallback: si mergeGeometries falla para algún material (atributos
 * inconsistentes entre meshes), ese grupo se queda como meshes
 * individuales — pintará bien pero con más draw calls.
 */
async function loadAndMergeBuilding(url, targetHeight) {
  const loader = new GLTFLoader();
  let gltf;
  try {
    gltf = await loader.loadAsync(url);
  } catch (err) {
    console.warn(`[buildings] No se pudo cargar GLB '${url}':`, err.message);
    return null;
  }
  const root = gltf.scene;
  root.updateMatrixWorld(true);

  // BBox del modelo entero para calcular escala + offset al suelo
  const bbox = new THREE.Box3().setFromObject(root);
  const sizeY = bbox.max.y - bbox.min.y;
  if (sizeY < 0.001) {
    console.warn('[buildings] BBox degenerado (sizeY ~0). Modelo inválido.');
    return null;
  }
  const scaleFactor = targetHeight / sizeY;
  const yOffset = -bbox.min.y * scaleFactor;

  // Agrupar meshes por material (key: name o uuid)
  const groups = new Map();
  root.traverse(obj => {
    if (!obj.isMesh || !obj.geometry) return;
    let mat = obj.material;
    if (Array.isArray(mat)) mat = mat[0];
    if (!mat) return;
    const matKey = mat.name || mat.uuid;

    // Clone geom y baquear: matrixWorld + scale + offset Y
    const geom = obj.geometry.clone();
    geom.applyMatrix4(obj.matrixWorld);
    const scaleMat = new THREE.Matrix4().makeScale(scaleFactor, scaleFactor, scaleFactor);
    geom.applyMatrix4(scaleMat);
    const offsetMat = new THREE.Matrix4().makeTranslation(0, yOffset, 0);
    geom.applyMatrix4(offsetMat);

    if (!groups.has(matKey)) {
      groups.set(matKey, { material: mat, geoms: [] });
    }
    groups.get(matKey).geoms.push(geom);
  });

  if (groups.size === 0) {
    console.warn('[buildings] El GLB no tiene meshes.');
    return null;
  }

  // Crear template Group con un mesh fusionado por material
  const result = new THREE.Group();
  result.userData.kind = 'building-template';

  let mergedMaterialGroups = 0;
  let fallbackMeshes = 0;
  let totalSourceMeshes = 0;

  for (const [matKey, entry] of groups) {
    const { material, geoms } = entry;
    totalSourceMeshes += geoms.length;

    // Material final: clonar el original si es shadable, si no fallback Lambert
    const finalMat = cloneOrFallbackMaterial(material);

    // Intentar merge
    let mergedGeom = null;
    try {
      mergedGeom = mergeGeometries(geoms, false);
    } catch (err) {
      console.warn(`[buildings] mergeGeometries falló para '${matKey}':`, err.message);
    }

    if (mergedGeom) {
      const mesh = new THREE.Mesh(mergedGeom, finalMat);
      mesh.userData = { kind: 'building-part', materialName: matKey };
      result.add(mesh);
      mergedMaterialGroups++;
      // Liberar geoms originales (ya están copiados en mergedGeom)
      for (const g of geoms) g.dispose?.();
    } else {
      // Fallback: cada geom como mesh independiente
      for (const g of geoms) {
        const mesh = new THREE.Mesh(g, finalMat.clone());
        mesh.userData = { kind: 'building-part', materialName: matKey };
        result.add(mesh);
        fallbackMeshes++;
      }
    }
  }

  console.log(
    `[buildings] GLB cargado: ${totalSourceMeshes} meshes originales → ` +
    `${mergedMaterialGroups} materiales fusionados + ${fallbackMeshes} meshes sin merge ` +
    `(total ${result.children.length} draw calls por instancia).`
  );
  return result;
}

/**
 * Clona el material original si es de un tipo conocido, si no devuelve
 * un MeshLambertMaterial con el color base. Forzamos DoubleSide para
 * que las paredes no desaparezcan vistas desde el otro lado (relevante
 * cuando en 11b/c el player entre cerca y "asome" desde adentro).
 */
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
  // Si el material original tenía transparency / alphaMap raros, normalizar
  if (srcMat && (srcMat.transparent || srcMat.alphaTest > 0 || srcMat.alphaMap)) {
    mat.alphaTest = 0.4;
    mat.transparent = false;
  }
  return mat;
}

/**
 * Libera geometrías y materiales de un Group completo. Usado en stop()
 * para no dejar buffers GPU sueltos cuando el módulo se descarga.
 */
function disposeGroup(group) {
  group.traverse(o => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) {
      if (Array.isArray(o.material)) o.material.forEach(m => m.dispose());
      else o.material.dispose();
    }
  });
}
