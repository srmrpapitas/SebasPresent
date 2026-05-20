/**
 * SebasPresent — Firemaking client module (Sesión 30)
 *
 * Maneja:
 *   - Encender fuego: invocado desde el context menu del inventory cuando
 *     el item es un log y el player tiene tinderbox.
 *   - Sync visual de fuegos: cada 400ms compara snapshot.fires con los
 *     sprites locales. Agrega los nuevos, quita los expirados.
 *   - Cada fuego se renderiza como un sprite + canvas texture animada
 *     (flicker scale + opacity) + base de carbón.
 *   - Anim "Kneel" en el char cuando enciende.
 *
 * Uso desde world.js:
 *
 *   import * as firemaking from './firemaking.js';
 *
 *   firemaking.start({
 *     scene,
 *     getPlayer:      () => player,
 *     getCharacter:   () => character,
 *     getSnapshot:    () => worldSnapshot.getSnapshot(),
 *     feedLog:        (type, msg) => combat.feedLog?.(type, msg),
 *   });
 *
 *   // En animate():
 *   firemaking.update(dt);
 *
 *   // Al salir del mundo:
 *   firemaking.stop();
 *
 *   // Desde inventory.js cuando se selecciona "Encender fuego":
 *   await firemaking.lightFireFromSlot(slotIdx);
 *
 * Debug en consola (Eruda):
 *   window.__fmDebug()              → estado actual
 *   window.__fmDebug.light(slot)    → encender desde slot
 *   window.__fmDebug.fires()        → array de fires renderizados
 */

import * as api from '../api.js';
import * as skills from '../skills.js';
import * as THREE from 'three';

// ============================================================
// Constantes
// ============================================================
const KNEEL_DURATION_MS = 1800;        // duración visual de la anim al encender
const FIRE_SYNC_INTERVAL_S = 0.4;      // chequear snapshot.fires cada 400ms

// Logs encendibles (debe matchear server/handlers/firemaking.js LOG_DEFS)
const LOG_DEFS = {
  logs:          { fmLevel: 1,  displayName: 'Tronco' },
  oak_logs:      { fmLevel: 15, displayName: 'Troncos roble' },
  willow_logs:   { fmLevel: 30, displayName: 'Troncos sauce' },
  palm_logs:     { fmLevel: 20, displayName: 'Troncos palmera' },
  pine_logs:     { fmLevel: 25, displayName: 'Troncos pino' },
  teak_logs:     { fmLevel: 35, displayName: 'Troncos teca' },
  maple_logs:    { fmLevel: 45, displayName: 'Troncos arce' },
  mahogany_logs: { fmLevel: 50, displayName: 'Troncos caoba' },
  yew_logs:      { fmLevel: 60, displayName: 'Troncos tejo' },
  magic_logs:    { fmLevel: 75, displayName: 'Troncos mágicos' },
  dead_logs:     { fmLevel: 1,  displayName: 'Troncos muertos' },
  bush_leaves:   { fmLevel: 1,  displayName: 'Ramillas' },
};

// ============================================================
// Estado del módulo
// ============================================================
let scene = null;
let getPlayer = null;
let getCharacter = null;
let getSnapshot = null;
let feedLog = null;
let started = false;

// Map id → { id, x, z, log_type, expires_at, group, sprite, base, _phase }
let firesMap = new Map();

// Texture compartida del flame (canvas → texture). Se crea una vez.
let flameTexture = null;

let syncTimer = 0;

// ============================================================
// API pública
// ============================================================
export function start(opts) {
  if (started) {
    console.warn('[firemaking] start() llamado dos veces sin stop()');
    stop();
  }
  scene         = opts.scene;
  getPlayer     = opts.getPlayer;
  getCharacter  = opts.getCharacter;
  getSnapshot   = opts.getSnapshot || (() => null);
  feedLog       = opts.feedLog || (() => {});

  firesMap = new Map();
  syncTimer = 0;
  flameTexture = createFlameTexture();
  started = true;

  // Debug hook
  if (typeof window !== 'undefined') {
    const dbg = () => ({
      firesCount: firesMap.size,
      fires: Array.from(firesMap.values()).map(f => ({
        id: f.id, x: f.x, z: f.z, log_type: f.log_type, expires_at: f.expires_at,
      })),
    });
    dbg.light = (slot) => lightFireFromSlot(slot);
    dbg.fires = () => Array.from(firesMap.values());
    window.__fmDebug = dbg;
  }

  // También exponemos lightFireFromSlot para que inventory.js lo invoque
  // sin import circular.
  if (typeof window !== 'undefined') {
    window.__firemaking = {
      lightFireFromSlot,
      isLogItem,
      getLogDisplayName,
    };
  }

  console.log('[firemaking] started.');
}

export function stop() {
  if (!started) return;
  for (const id of Array.from(firesMap.keys())) {
    removeFire(id);
  }
  firesMap.clear();
  if (flameTexture) {
    try { flameTexture.dispose(); } catch {}
    flameTexture = null;
  }
  scene = null;
  started = false;
  if (typeof window !== 'undefined') {
    if (window.__fmDebug) delete window.__fmDebug;
    if (window.__firemaking) delete window.__firemaking;
  }
  console.log('[firemaking] stopped.');
}

/** Llamado desde animate(). */
export function update(dt) {
  if (!started) return;

  // Sync con snapshot
  syncTimer += dt;
  if (syncTimer >= FIRE_SYNC_INTERVAL_S) {
    syncTimer = 0;
    syncFromSnapshot();
  }

  // Animar sprites (flicker scale + opacity)
  const now = performance.now();
  for (const fire of firesMap.values()) {
    if (!fire.sprite) continue;
    // Flicker: combinación de 2 senos de frecuencias distintas
    const t = now * 0.001;
    const flickerScale = 1 + Math.sin(t * 9 + fire._phase) * 0.10
                          + Math.sin(t * 13.7 + fire._phase) * 0.05;
    const flickerOpacity = 0.85 + Math.sin(t * 11 + fire._phase) * 0.15;
    fire.sprite.scale.set(1.2 * flickerScale, 1.6 * flickerScale, 1);
    fire.sprite.material.opacity = Math.max(0.5, Math.min(1, flickerOpacity));
  }
}

/** ¿Es este item_id un log encendible? Llamado desde inventory.js. */
export function isLogItem(itemId) {
  return !!LOG_DEFS[itemId];
}

/** Display name del log (para context menu). */
export function getLogDisplayName(itemId) {
  return LOG_DEFS[itemId]?.displayName || itemId;
}

/**
 * Encender fuego desde un slot del inventario. Llamado desde el context
 * menu "Encender fuego". Valida cliente-side (nivel) para feedback rápido;
 * el server revalida.
 */
export async function lightFireFromSlot(slotIdx) {
  if (!started) return;

  // Validación pre-flight: necesitamos el item del slot.
  // inventory.getState() devuelve array indexado por slot (slots[5] = item del slot 5).
  let item = null;
  try {
    const slots = window.inventory?.getState?.() || [];
    item = slots[slotIdx];
  } catch {}
  if (!item) {
    feedLog('error', 'Slot vacío.');
    return;
  }

  const logDef = LOG_DEFS[item.item_id];
  if (!logDef) {
    feedLog('error', 'Eso no es un log.');
    return;
  }

  const lvl = skills.getLevel?.('firemaking') ?? 1;
  if (lvl < logDef.fmLevel) {
    feedLog('error', `Necesitas nivel ${logDef.fmLevel} de Fuego.`);
    return;
  }

  // Anim "Kneel" — Sesión 31 fix: usar KNEEL_DURATION_MS (1800ms) en vez
  // de 0 (natural). El clip natural de Kneel.fbx es demasiado largo, deja
  // al char arrodillado más tiempo del que dura el feedback visual. Con
  // 1800ms acompaña mejor el flujo de "tap → fuego aparece".
  // Si la anim queda muy rápida o muy lenta al ojo, ajustar KNEEL_DURATION_MS arriba.
  const character = getCharacter?.();
  if (character && character.playGather) {
    character.playGather('kneel', KNEEL_DURATION_MS);
  }

  feedLog('info', `Enciendes ${logDef.displayName}...`);

  try {
    const res = await api.fmLight(slotIdx);
    console.log('[firemaking] /api/firemaking/light response:', res);
    if (res?.ok) {
      try { await skills.reload(); } catch {}
      try { await window.inventory?.refresh?.(); } catch {}
      feedLog('xp', `+${res.xp_gained} XP Fuego`);
      if (res.level_up) {
        feedLog('info', `¡Subes a nivel ${res.new_level} de Fuego!`);
        try { window.__spawnLevelUpBanner?.('firemaking', res.new_level); } catch {}
      }
      // Sesión 30 — Renderizar el fire LOCAL inmediato sin esperar snapshot.
      // El server lo devuelve directamente en res.fire. Si por algún motivo
      // el snapshot tarda o no incluye `fires`, igual lo vemos aparecer ya.
      if (res.fire && res.fire.id != null) {
        if (!firesMap.has(res.fire.id)) {
          console.log('[firemaking] adding fire from light response:', res.fire);
          addFire(res.fire);
        }
      }
      // Forzar sync inmediato para que el fire aparezca rápido
      syncTimer = FIRE_SYNC_INTERVAL_S;
    }
  } catch (err) {
    console.warn('[firemaking] light error:', err?.code, err?.message);
    const code = err?.code;
    if (code === 'no_tinderbox') feedLog('error', 'Necesitas un yesquero.');
    else if (code === 'not_a_log') feedLog('error', 'Eso no es un log.');
    else if (code === 'level_too_low') feedLog('error', err.message || 'Nivel insuficiente.');
    else if (code === 'empty_slot') feedLog('error', 'Slot vacío.');
    else if (code === 'fm_disabled') feedLog('error', 'Fuego no disponible (migración SQL pendiente).');
    else feedLog('error', err?.message || 'No se pudo encender el fuego.');
  }
}

// ============================================================
// Sync con snapshot
// ============================================================
function syncFromSnapshot() {
  const snap = getSnapshot?.();
  if (!snap) return;

  // Sesión 30 debug: si el snapshot NO tiene la propiedad 'fires',
  // significa que el server no fue actualizado (snapshot.js viejo).
  // Loguear una vez como warning.
  if (!('fires' in snap)) {
    if (!_warnedNoFires) {
      console.warn('[firemaking] El snapshot del server NO incluye `fires`. ¿Subiste server/handlers/snapshot.js actualizado?');
      _warnedNoFires = true;
    }
    return;
  }

  if (!Array.isArray(snap.fires)) return;
  const now = Date.now();

  // Log cuando llegan fires nuevos (sólo cambio para no spammear).
  if (snap.fires.length !== _lastFiresCount) {
    console.log(`[firemaking] snapshot.fires =`, snap.fires.length, 'fires');
    _lastFiresCount = snap.fires.length;
  }

  const seenIds = new Set();
  for (const f of snap.fires) {
    seenIds.add(f.id);
    if (f.expires_at <= now) continue;
    if (!firesMap.has(f.id)) {
      console.log(`[firemaking] addFire id=${f.id} pos=(${f.x.toFixed(2)}, ${f.z.toFixed(2)}) expires_at=${f.expires_at}`);
      addFire(f);
    }
  }
  // Quitar los que ya no aparecen (server los borró) o expiraron.
  for (const [id, fire] of Array.from(firesMap.entries())) {
    if (!seenIds.has(id) || fire.expires_at <= now) {
      removeFire(id);
    }
  }
}

let _warnedNoFires = false;
let _lastFiresCount = -1;

function addFire(f) {
  if (!scene) return;

  const group = new THREE.Group();
  group.position.set(f.x, 0, f.z);

  // Base de carbón (círculo gris oscuro en el suelo)
  const baseGeom = new THREE.CircleGeometry(0.5, 16);
  const baseMat = new THREE.MeshBasicMaterial({
    color: 0x2a1a10,
    transparent: true,
    opacity: 0.85,
  });
  const base = new THREE.Mesh(baseGeom, baseMat);
  base.rotation.x = -Math.PI / 2;
  base.position.y = 0.02;
  group.add(base);

  // Sprite de la llama
  const spriteMat = new THREE.SpriteMaterial({
    map: flameTexture,
    transparent: true,
    opacity: 1,
    depthWrite: false,
    // Sesión 30 — NormalBlending en vez de Additive para asegurar
    // que se ve en todos los navegadores móviles (algunos sprites con
    // Additive se ven negros en iOS Safari según versión).
  });
  const sprite = new THREE.Sprite(spriteMat);
  // Tamaño más grande para que se note bien.
  sprite.scale.set(1.2, 1.6, 1);
  sprite.position.y = 0.8;
  group.add(sprite);

  scene.add(group);

  firesMap.set(f.id, {
    id: f.id,
    x: f.x,
    z: f.z,
    log_type: f.log_type,
    expires_at: f.expires_at,
    group, sprite, base,
    _phase: Math.random() * Math.PI * 2,
  });
}

function removeFire(id) {
  const fire = firesMap.get(id);
  if (!fire) return;
  if (fire.group && scene) {
    scene.remove(fire.group);
    if (fire.sprite?.material) {
      try { fire.sprite.material.dispose(); } catch {}
    }
    if (fire.base?.geometry) {
      try { fire.base.geometry.dispose(); } catch {}
    }
    if (fire.base?.material) {
      try { fire.base.material.dispose(); } catch {}
    }
  }
  firesMap.delete(id);
}

// ============================================================
// Texture de la llama (canvas → THREE.CanvasTexture)
// ============================================================
function createFlameTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');

  // Radial gradient: centro blanco-amarillo → naranja → rojo → transparente.
  const g = ctx.createRadialGradient(64, 64, 4, 64, 64, 60);
  g.addColorStop(0.00, 'rgba(255, 255, 220, 1.0)');
  g.addColorStop(0.20, 'rgba(255, 220, 120, 0.95)');
  g.addColorStop(0.45, 'rgba(255, 150, 40, 0.85)');
  g.addColorStop(0.75, 'rgba(220, 60, 10, 0.5)');
  g.addColorStop(1.00, 'rgba(120, 20, 0, 0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);

  const tex = new THREE.CanvasTexture(canvas);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}
