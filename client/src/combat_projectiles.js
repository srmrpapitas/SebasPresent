/**
 * SebasPresent — Combat Projectiles (Sesión 34 stub → Sesión 35 real)
 *
 * Sistema de proyectiles visuales para combate ranged (bow) y magic (cast).
 *
 * S34: STUB — dibujaba una línea verde del shooter al target con fade.
 * S35: REAL — carga arrow.glb una vez al start (cache), spawnea clones
 *      con recolor por arrow_item_id, lerp from→to con arc parabólico
 *      sutil, rotación apuntando en dirección de vuelo, fade-out al final.
 *
 * Mantiene exactamente la misma API pública que el stub (start/stop/
 * fireProjectile/update), así combat.js NO se modifica.
 *
 * ============================================================
 * INTERFAZ (sin cambios respecto a S34)
 * ============================================================
 *
 *   start({ scene })
 *     Inicializa el sistema y dispara la carga ASYNC de arrow.glb.
 *     Si fireProjectile se llama antes de que termine la carga, usa
 *     una línea verde como fallback temporal (gracefully degrades).
 *
 *   fireProjectile(fromVec3, toVec3, opts?)
 *     Dispara un proyectil visual de `fromVec3` al `toVec3` (mundo).
 *     opts:
 *       type:         'arrow' | 'spell' (default 'arrow'). 'spell' aún
 *                     no implementado — se reserva para Bloque 2 días 8-11.
 *       arrowItemId:  para color del mesh (default 'arrow_bronze').
 *       durationMs:   tiempo de vuelo (default 350ms).
 *
 *   stop()
 *     Limpia proyectiles vivos y libera cache. Llamado en cleanup de world.
 *
 *   update()
 *     Llamado cada frame por el render loop de world.js. Actualiza la
 *     posición/rotación de cada proyectil vivo y limpia los expirados.
 *
 * ============================================================
 * NOTAS PARA SESIONES FUTURAS
 * ============================================================
 *
 *  - Recolor: clonamos material por shot (no se reusa). Si esto se vuelve
 *    bottleneck con muchos arqueros simultáneos (PvP masivo), pool de
 *    materials por color sería el optimizer.
 *
 *  - Trayectoria: arc parabólico sutil (ARROW_ARC_HEIGHT). Se siente
 *    "balístico" sin exagerar. Para magic (Bloque 2 d.8-11) probablemente
 *    queremos trayectoria recta o más alta — agregar opts.arcHeight cuando
 *    haga falta.
 *
 *  - SFX: por ahora silencioso al disparar/impactar. Cuando lleguen
 *    'bow_release' y 'arrow_impact' a R2 (B-009 backlog), agregarlos en
 *    fireProjectile() y en el cleanup del update() respectivamente.
 *
 *  - Anims de bow (S36): cuando metamos Bow_Overdraw + Bow_Recoil, vamos
 *    a querer delay el spawn del proyectil ~200ms para que coincida con
 *    el frame de release de la anim. Plan: agregar opts.windupMs que mete
 *    un setTimeout antes del spawn. Hoy lo dejamos sin eso (el call site
 *    en combat.js dispara instantáneo).
 *
 *  - Calibración: si la flecha vuela "de costado" o muy chica/grande,
 *    ajustar ARROW_BASE_SCALE y/o ARROW_YAW_OFFSET abajo. Si el GLB
 *    cambia, esto cambia también.
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// ============================================================
// Config
// ============================================================
const CDN_BASE = 'https://pub-bb63b96c76c745f59a39649cde6678c0.r2.dev';
const WEAPONS_BASE = `${CDN_BASE}/weapons`;

// Map de color por arrow_item_id (decisión S34, mantenida en S35).
const ARROW_COLORS = {
  arrow_bronze:  0xb06a3a,
  arrow_iron:    0x7a7a7a,
  arrow_steel:   0xc0c0c0,
  arrow_mithril: 0x6b96d6,
  arrow_adamant: 0x5fae67,
  arrow_rune:    0x4ecdc4,
  arrow_dragon:  0xc0392b,
};
const DEFAULT_ARROW_COLOR = ARROW_COLORS.arrow_bronze;

// Tunables de visual. Si la flecha se ve muy chica/grande/torcida, tocar acá.
//
//   ARROW_BASE_SCALE: scale uniforme del clone. Si el GLB exporta en metros
//     razonables, 1.0 está bien.
//
//   ARROW_ROT_OFFSET_{X,Y,Z}: corrección post-lookAt. Necesaria porque
//     lookAt() asume que -Z local apunta al target, y casi ningún GLB
//     respeta esa convención. arrow.glb fue exportado con la flecha
//     apuntando hacia +Y (típico de Blender), por eso por default
//     aplicamos rotX = -PI/2 (tumba 90° hacia adelante).
//
//     Si tu flecha sigue mal después de subir, prueba:
//        - flecha vuela vertical / "parada"   → rotX = -PI/2 (default actual)
//        - flecha vuela "al revés"            → rotX = +PI/2 ó rotZ = PI
//        - flecha vuela "de costado"          → rotY = PI/2 ó -PI/2
//        - punta hacia el shooter, no target  → rotZ = PI
//
//   ARROW_ARC_HEIGHT: altura del arc parabólico en metros. 0 = vuelo recto.
const ARROW_BASE_SCALE     = 1.0;
const ARROW_ROT_OFFSET_X   = -Math.PI / 2;
const ARROW_ROT_OFFSET_Y   = 0;
const ARROW_ROT_OFFSET_Z   = 0;
const ARROW_ARC_HEIGHT     = 0.6;

// Offset vertical desde el suelo del shooter y del target. Mantiene el
// "salir del pecho, llegar a la cabeza" del stub original — aproximación
// razonable hasta que tengamos la mano del char como origen (S36 con anims).
const SHOOTER_Y_OFFSET = 1.2;
const TARGET_Y_OFFSET  = 1.0;

// ============================================================
// Estado
// ============================================================
let scene = null;
let started = false;
let arrowBaseMesh = null;     // gltf.scene cacheado, base para todos los clones
let arrowLoadPromise = null;  // promise del load inicial (para esperar/race)

const _gltfLoader = new GLTFLoader();

// Cada proyectil vivo: { obj, spawnedAt, durationMs, from, to, isLine? }
const liveProjectiles = [];

// ============================================================
// API pública
// ============================================================

export function start(opts = {}) {
  if (started) return;
  scene = opts.scene;
  if (!scene) {
    console.warn('[combat_projectiles] start() sin scene — fireProjectile va a no-op');
    return;
  }
  started = true;

  // Carga del arrow.glb en background. No bloqueamos start() esperándolo
  // — si fireProjectile se llama antes de que termine, usa la línea verde
  // como fallback temporal (ver spawnFallbackLine abajo).
  arrowLoadPromise = _gltfLoader.loadAsync(`${WEAPONS_BASE}/arrow.glb`)
    .then(gltf => {
      arrowBaseMesh = gltf.scene;
      // Sanitización del base: side=FrontSide (idéntico a character._loadWeaponMesh).
      // El material original se mantiene; cada shot clona sus materials para recolor
      // sin afectar el base (otros shots usan el mismo base).
      arrowBaseMesh.traverse(o => {
        if (o.isMesh) {
          o.frustumCulled = false;
          if (o.material) {
            const mats = Array.isArray(o.material) ? o.material : [o.material];
            for (const m of mats) {
              if (m.side !== undefined) m.side = THREE.FrontSide;
            }
          }
        }
      });
      console.log('[combat_projectiles] arrow.glb loaded');
    })
    .catch(err => {
      console.warn('[combat_projectiles] arrow.glb load failed:', err.message);
      arrowBaseMesh = null;
    });
}

export function stop() {
  if (!started) return;
  for (const p of liveProjectiles) cleanupProjectile(p);
  liveProjectiles.length = 0;
  scene = null;
  started = false;
  arrowBaseMesh = null;
  arrowLoadPromise = null;
}

export function fireProjectile(fromVec3, toVec3, opts = {}) {
  if (!started || !scene) return;
  if (!fromVec3 || !toVec3) return;

  const durationMs  = opts.durationMs || 350;
  const arrowItemId = opts.arrowItemId || 'arrow_bronze';

  // Aproximación de altura: salir del pecho del shooter, llegar a altura del
  // target. Cuando integremos anims de bow (S36), el "from" debería venir
  // de la mano del char en vez de pos+offset.
  const fromAdj = new THREE.Vector3(fromVec3.x, (fromVec3.y || 0) + SHOOTER_Y_OFFSET, fromVec3.z);
  const toAdj   = new THREE.Vector3(toVec3.x,   (toVec3.y   || 0) + TARGET_Y_OFFSET,  toVec3.z);

  // Si el mesh aún no cargó, fallback temporal (línea verde como el stub).
  if (!arrowBaseMesh) {
    spawnFallbackLine(fromAdj, toAdj, durationMs);
    return;
  }

  // Clone profundo del base. clone(true) clona la jerarquía pero las
  // geometries y materials quedan compartidos con el base por default.
  // Para no contaminar el base con nuestro recolor, applyArrowColor clona
  // explícitamente los materials del clone — quedan independientes.
  const mesh = arrowBaseMesh.clone(true);
  const color = ARROW_COLORS[arrowItemId] ?? DEFAULT_ARROW_COLOR;
  applyArrowColor(mesh, color);
  mesh.scale.setScalar(ARROW_BASE_SCALE);
  mesh.position.copy(fromAdj);
  scene.add(mesh);

  liveProjectiles.push({
    obj: mesh,
    spawnedAt: performance.now(),
    durationMs,
    from: fromAdj.clone(),
    to:   toAdj.clone(),
    isLine: false,
  });
}

export function update() {
  if (!started || liveProjectiles.length === 0) return;
  const now = performance.now();
  for (let i = liveProjectiles.length - 1; i >= 0; i--) {
    const p = liveProjectiles[i];
    const t = (now - p.spawnedAt) / p.durationMs;

    if (t >= 1) {
      cleanupProjectile(p);
      liveProjectiles.splice(i, 1);
      continue;
    }

    if (p.isLine) {
      // Fallback line: solo fade lineal.
      if (p.fallbackMaterial) p.fallbackMaterial.opacity = 0.9 * (1 - t);
      continue;
    }

    // Posición: lerp lineal en XZ + arc parabólico sutil en Y.
    // sin(t*PI) va de 0 → 1 → 0 a lo largo de t∈[0,1].
    const x = p.from.x + (p.to.x - p.from.x) * t;
    const z = p.from.z + (p.to.z - p.from.z) * t;
    const yLinear = p.from.y + (p.to.y - p.from.y) * t;
    const arc = ARROW_ARC_HEIGHT * Math.sin(t * Math.PI);
    p.obj.position.set(x, yLinear + arc, z);

    // Rotación: la flecha apunta "hacia donde va a estar 0.01 de t más
    // adelante". Esto sigue el arco naturalmente (sube cuando sube, baja
    // cuando baja), sin necesidad de calcular derivadas a mano.
    // lookAt() orienta -Z local hacia el target. Los ARROW_ROT_OFFSET_*
    // corrigen la orientación local del GLB después (ver arriba).
    const tNext = Math.min(1, t + 0.01);
    const nx = p.from.x + (p.to.x - p.from.x) * tNext;
    const nz = p.from.z + (p.to.z - p.from.z) * tNext;
    const nyLin = p.from.y + (p.to.y - p.from.y) * tNext;
    const nyArc = ARROW_ARC_HEIGHT * Math.sin(tNext * Math.PI);
    p.obj.lookAt(nx, nyLin + nyArc, nz);
    if (ARROW_ROT_OFFSET_X !== 0) p.obj.rotateX(ARROW_ROT_OFFSET_X);
    if (ARROW_ROT_OFFSET_Y !== 0) p.obj.rotateY(ARROW_ROT_OFFSET_Y);
    if (ARROW_ROT_OFFSET_Z !== 0) p.obj.rotateZ(ARROW_ROT_OFFSET_Z);
  }
}

// ============================================================
// Helpers
// ============================================================

function spawnFallbackLine(from, to, durationMs) {
  // Stub original mantenido como fallback mientras arrow.glb se carga
  // (típicamente los primeros ~500ms post-login si disparás de una).
  const geometry = new THREE.BufferGeometry().setFromPoints([from, to]);
  const material = new THREE.LineBasicMaterial({
    color: 0x55ff66,
    transparent: true,
    opacity: 0.9,
  });
  const line = new THREE.Line(geometry, material);
  scene.add(line);
  liveProjectiles.push({
    obj: line,
    spawnedAt: performance.now(),
    durationMs,
    isLine: true,
    fallbackMaterial: material,
    fallbackGeometry: geometry,
  });
}

function applyArrowColor(mesh, hexColor) {
  // Clona materials del clone (no del base) y settea el color. Así cada
  // proyectil tiene su material propio que puede ser disposed sin afectar
  // al base ni a otros proyectiles.
  mesh.traverse(o => {
    if (!o.isMesh || !o.material) return;
    const wasArray = Array.isArray(o.material);
    const mats = wasArray ? o.material : [o.material];
    const cloned = mats.map(m => {
      const c = m.clone();
      if (c.color) c.color.setHex(hexColor);
      return c;
    });
    o.material = wasArray ? cloned : cloned[0];
  });
}

function cleanupProjectile(p) {
  if (!p) return;
  if (p.obj && scene) scene.remove(p.obj);
  if (p.isLine) {
    // Fallback line: dispose explícito de su geometry+material (no compartidos).
    p.fallbackMaterial?.dispose?.();
    p.fallbackGeometry?.dispose?.();
    return;
  }
  // Mesh GLB clone: dispose SOLO los materials (clonados en applyArrowColor).
  // Las geometries quedan compartidas con arrowBaseMesh, NO dispose'arlas
  // o reventamos el cache.
  if (p.obj) {
    p.obj.traverse(o => {
      if (!o.isMesh || !o.material) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) m.dispose?.();
    });
  }
}
