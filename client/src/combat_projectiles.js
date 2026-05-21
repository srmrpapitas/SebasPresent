/**
 * SebasPresent — Combat Projectiles (Sesión 34, Bloque 2 día 4)
 *
 * Sistema de proyectiles visuales para combate ranged (bow) y magic
 * (cast). HOY (S34) es un STUB: dibuja una línea verde del shooter al
 * target con fade de 300ms. Esto deja claro VISUALMENTE qué está pasando
 * (vos viste tu char "tirar" algo a un NPC) sin necesidad de tener el
 * arrow.glb integrado y animado.
 *
 * ============================================================
 * PRÓXIMA SESIÓN — IMPLEMENTACIÓN REAL
 * ============================================================
 *
 * 1. Cargar arrow.glb (ya en R2/weapons/arrow.glb) una sola vez al start().
 * 2. Reemplazar la línea verde por un mesh de flecha que vuela:
 *    - Posición lerp(from, to) en ~0.3-0.5s
 *    - Rotación que apunte en la dirección del vuelo
 *    - Opcional: trayectoria parabólica (sutil arc up-then-down)
 * 3. Recolor del shaft según arrow_item_id (decisión S34: cambio de color
 *    completo, no solo punta). Map item_id → color hex:
 *      arrow_bronze → #b06a3a (cobre)
 *      arrow_iron   → #7a7a7a
 *      arrow_steel  → #c0c0c0
 *      arrow_mithril→ #6b96d6
 *      arrow_adamant→ #5fae67
 *      arrow_rune   → #4ecdc4
 *      arrow_dragon → #c0392b
 * 4. Hit detection visual: al llegar al target, spawn de spark/spark
 *    particle o aprovechar damage_splat (que ya existe).
 * 5. SFX: 'bow_release' al firing + 'arrow_impact' al hit.
 *
 * Para magic (Bloque 2 días 8-11) se va a duplicar esta misma estructura
 * pero con mesh distinto (fireball, etc).
 *
 * ============================================================
 * INTERFAZ
 * ============================================================
 *
 *   start({ scene })
 *     Inicializa el sistema con la scene de Three.js. Se llama una vez
 *     desde world.js al inicializar el world.
 *
 *   fireProjectile(fromVec3, toVec3, opts?)
 *     Dispara un proyectil visual de `fromVec3` (mundo) a `toVec3` (mundo).
 *     opts:
 *       type:         'arrow' | 'spell' (default 'arrow')
 *       arrowItemId:  para color shaft (default 'arrow_bronze')
 *       durationMs:   tiempo de vuelo (default 350ms)
 *
 *   stop()
 *     Limpia todos los proyectiles vivos. Llamado desde world.js cleanup.
 */

import * as THREE from 'three';

// ============================================================
// Estado
// ============================================================
let scene = null;
let started = false;

// Proyectiles vivos. Cada uno es { obj, expiresAt, fadeStartAt }. El loop
// en update() los va removiendo a medida que expiran.
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
}

export function stop() {
  if (!started) return;
  for (const p of liveProjectiles) {
    if (p.obj && scene) scene.remove(p.obj);
    if (p.obj?.geometry) p.obj.geometry.dispose();
    if (p.obj?.material) p.obj.material.dispose();
  }
  liveProjectiles.length = 0;
  scene = null;
  started = false;
}

/**
 * STUB visual: dibuja una línea verde del from al to con fade-out.
 * Cuando integremos arrow.glb (próxima sesión), esta función se reescribe
 * para spawn de mesh + lerp animation. Mantenemos la firma para que el
 * caller (combat.js / RangedStyle) no cambie.
 */
export function fireProjectile(fromVec3, toVec3, opts = {}) {
  if (!started || !scene) return;
  if (!fromVec3 || !toVec3) return;

  const durationMs = opts.durationMs || 350;
  // Color: stub usa verde (placeholder). Próxima sesión: color por arrow type.
  const color = 0x55ff66;

  // Línea simple entre from y to. Y+1.2 para que arranque desde el pecho del
  // shooter (no del suelo) — aproximación hasta tener anim de tiro real.
  const fromAdj = new THREE.Vector3(fromVec3.x, (fromVec3.y || 0) + 1.2, fromVec3.z);
  const toAdj   = new THREE.Vector3(toVec3.x,   (toVec3.y   || 0) + 1.0, toVec3.z);

  const geometry = new THREE.BufferGeometry().setFromPoints([fromAdj, toAdj]);
  const material = new THREE.LineBasicMaterial({
    color,
    transparent: true,
    opacity: 0.9,
    linewidth: 2,  // nota: linewidth >1 no funciona en WebGL en muchos browsers
  });
  const line = new THREE.Line(geometry, material);
  scene.add(line);

  const now = performance.now();
  liveProjectiles.push({
    obj: line,
    expiresAt: now + durationMs,
    spawnedAt: now,
    durationMs,
    material,
  });
}

/**
 * Llamado por el render loop de world.js cada frame. Actualiza fades y
 * remueve proyectiles expirados. Si no hay nada vivo, no-op (O(1)).
 */
export function update() {
  if (!started || liveProjectiles.length === 0) return;
  const now = performance.now();
  for (let i = liveProjectiles.length - 1; i >= 0; i--) {
    const p = liveProjectiles[i];
    if (now >= p.expiresAt) {
      // Cleanup
      if (p.obj && scene) scene.remove(p.obj);
      if (p.obj?.geometry) p.obj.geometry.dispose();
      if (p.material) p.material.dispose();
      liveProjectiles.splice(i, 1);
      continue;
    }
    // Fade lineal: opacity de 0.9 → 0 a lo largo de durationMs
    const t = (now - p.spawnedAt) / p.durationMs;
    if (p.material) p.material.opacity = 0.9 * (1 - t);
  }
}
