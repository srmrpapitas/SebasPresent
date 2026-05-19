/**
 * SebasPresent — Woodcutting client module (Sesión 30)
 *
 * Maneja:
 *   - Loop de tala: cuando el player tapea un árbol, camina hacia él, y al
 *     llegar a rango (MAX_CHOP_DIST_M) arranca el chop loop.
 *   - Cada CHOP_TICK_S segundos manda POST /api/woodcutting/chop con el
 *     tree_type + pos del árbol. Si el server responde ok, suma log al
 *     inventory y XP.
 *   - Anim "woodcut" en el char durante el chop (dispara cada CHOP_TICK_S).
 *   - Depleted trees: oculta visualmente los árboles del snapshot que
 *     tienen depleted_until > now. Restaura cuando respawnean.
 *
 * Uso desde world.js:
 *
 *   import * as woodcutting from './woodcutting.js';
 *
 *   woodcutting.start({
 *     getPlayer:      () => player,
 *     getAuthToken:   () => authToken,
 *     getCharacter:   () => character,
 *     getTerrain:     () => terrain,
 *     setPlayerTarget:(x, z) => setPlayerTarget(x, z),
 *     feedLog:        (type, msg) => combat.feedLog?.(type, msg),
 *     getSnapshot:    () => worldSnapshot.getSnapshot(),
 *   });
 *
 *   // En animate():
 *   woodcutting.update(dt);
 *
 *   // Tap en árbol (desde doCanvasTap):
 *   woodcutting.startChopAt(treeType, tx, tz);
 *
 *   // Al salir del mundo:
 *   woodcutting.stop();
 *
 * Debug en consola (Eruda):
 *   window.__wcDebug()                          → estado actual
 *   window.__wcDebug.forceChop('oak', 100, 50)  → forzar chop ad-hoc
 *   window.__wcDebug.stop()                     → cancelar loop
 */

import * as api from './api.js';
import * as skills from './skills.js';
import * as THREE from 'three';

// ============================================================
// Constantes (deben matchear server/handlers/woodcutting.js)
// ============================================================
const CHOP_TICK_S = 2.5;              // segundos entre intentos de chop
const MAX_CHOP_DIST_M = 3.0;          // cliente más estricto que server (3.5)
const APPROACH_DIST_M = 2.5;          // distancia objetivo cuando caminamos hacia el árbol
const STOP_LOOP_AFTER_FAILS = 3;      // si falla N veces seguidas, paramos

// ============================================================
// Estado del módulo
// ============================================================
let getPlayer = null;
let getAuthToken = null;
let getCharacter = null;
let getTerrain = null;
let setPlayerTargetCb = null;
let feedLog = null;
let getSnapshot = null;

let started = false;

// Estado del loop activo (null si no estamos talando):
//   { tree_type, tx, tz, lastChopAt, fails, waitingResponse, started }
let activeChop = null;

// Map de depletedKey → { restore() } para los árboles ocultados.
// key = `${tree_type}|${xRound}|${zRound}` para identificar idéntico al server.
const depletedHidden = new Map();
let depletedSyncTimer = 0;
const DEPLETED_SYNC_INTERVAL_S = 0.5;  // chequear snapshot.depleted_trees cada 500ms

// ============================================================
// API pública
// ============================================================
export function start(opts) {
  if (started) {
    console.warn('[woodcutting] start() llamado dos veces sin stop()');
    stop();
  }
  getPlayer        = opts.getPlayer;
  getAuthToken     = opts.getAuthToken;
  getCharacter     = opts.getCharacter;
  getTerrain       = opts.getTerrain;
  setPlayerTargetCb = opts.setPlayerTarget || (() => {});
  feedLog          = opts.feedLog || (() => {});
  getSnapshot      = opts.getSnapshot || (() => null);

  activeChop = null;
  depletedHidden.clear();
  started = true;

  // Debug hook
  if (typeof window !== 'undefined') {
    const dbg = () => ({
      activeChop,
      depletedCount: depletedHidden.size,
      lastSnapshotDepleted: getSnapshot?.()?.depleted_trees || null,
    });
    dbg.forceChop = (treeType, tx, tz) => attemptChop(treeType, tx, tz);
    dbg.stop = () => stopChop('debug');
    window.__wcDebug = dbg;
  }

  console.log('[woodcutting] started.');
}

export function stop() {
  if (!started) return;
  stopChop('module_stop');
  // Restaurar todos los árboles ocultos (volver a su pos original).
  for (const [, entry] of depletedHidden) {
    try { entry.restore?.(); } catch {}
  }
  depletedHidden.clear();
  started = false;
  if (typeof window !== 'undefined' && window.__wcDebug) {
    delete window.__wcDebug;
  }
  console.log('[woodcutting] stopped.');
}

/**
 * Llamado desde world.js doCanvasTap cuando el player tapea un árbol.
 * Si está lejos, camina hacia él y al llegar arranca chop.
 * Si está cerca, arranca chop directo.
 */
export function startChopAt(treeType, tx, tz) {
  if (!started) return;
  const player = getPlayer?.();
  if (!player) return;

  // Validación local de nivel para mensaje inmediato (server revalida)
  const levelClient = skills.getLevel?.('woodcutting') ?? 1;
  const TREE_LEVELS = {
    normal: 1, dead: 1, bush: 1, bush_small: 1,
    oak: 15, palm: 20, pine: 30, willow: 30, teak: 35,
    maple: 45, mahogany: 50, yew: 60, magic: 75,
  };
  const reqLvl = TREE_LEVELS[treeType] || 1;
  if (levelClient < reqLvl) {
    feedLog('error', `Necesitas nivel ${reqLvl} de Tala.`);
    return;
  }

  // Caminar hacia el árbol (a APPROACH_DIST_M del centro).
  const dx = player.position.x - tx;
  const dz = player.position.z - tz;
  const dist = Math.hypot(dx, dz);
  if (dist > APPROACH_DIST_M) {
    // Vector unitario desde árbol hacia player; ponemos el target en
    // (tx + ux*APPROACH, tz + uz*APPROACH) — sea cual sea el lado.
    const ux = dist > 0 ? dx / dist : 1;
    const uz = dist > 0 ? dz / dist : 0;
    const goX = tx + ux * APPROACH_DIST_M;
    const goZ = tz + uz * APPROACH_DIST_M;
    setPlayerTargetCb(goX, goZ);
  }

  // Activar estado pendiente — el update() arrancará el chop loop cuando
  // estemos en rango.
  activeChop = {
    tree_type: treeType,
    tx, tz,
    lastChopAt: 0,
    fails: 0,
    waitingResponse: false,
    started: false,
  };
}

/** Para el loop actual. */
export function stopChop(reason = 'user') {
  if (!activeChop) return;
  if (reason !== 'user' && reason !== 'depleted' && reason !== 'tap_ground') {
    console.log('[woodcutting] stopChop:', reason);
  }
  activeChop = null;
}

/**
 * Llamar desde animate(). Procesa loop chop activo + sync depletadas.
 */
export function update(dt) {
  if (!started) return;

  // ----- Sync depletadas con snapshot -----
  depletedSyncTimer += dt;
  if (depletedSyncTimer >= DEPLETED_SYNC_INTERVAL_S) {
    depletedSyncTimer = 0;
    syncDepletedFromSnapshot();
  }

  // ----- Loop chop activo -----
  if (!activeChop) return;
  const player = getPlayer?.();
  if (!player) return;

  const dx = player.position.x - activeChop.tx;
  const dz = player.position.z - activeChop.tz;
  const distSq = dx * dx + dz * dz;
  const maxSq = MAX_CHOP_DIST_M * MAX_CHOP_DIST_M;

  if (distSq > maxSq) {
    // Aún caminando hacia el árbol. No chopeamos todavía.
    return;
  }

  // En rango. Si todavía no marcamos started, lo hacemos ahora.
  if (!activeChop.started) {
    activeChop.started = true;
    feedLog('info', `Comienzas a talar...`);
    // Disparamos primer chop inmediato (lastChopAt = now - CHOP_TICK_S
    // para que el siguiente tick lo dispare ya).
    activeChop.lastChopAt = performance.now() - CHOP_TICK_S * 1000;
  }

  const now = performance.now();
  const sinceLast = (now - activeChop.lastChopAt) / 1000;
  if (sinceLast >= CHOP_TICK_S && !activeChop.waitingResponse) {
    activeChop.lastChopAt = now;
    activeChop.waitingResponse = true;
    // Animar el char (anim "woodcut" — escala a CHOP_TICK_S segundos)
    const character = getCharacter?.();
    if (character && character.playGather) {
      character.playGather('woodcut', CHOP_TICK_S * 1000);
    }
    attemptChop(activeChop.tree_type, activeChop.tx, activeChop.tz)
      .catch(err => console.warn('[woodcutting] chop err:', err?.message));
  }
}

// ============================================================
// Internals
// ============================================================
async function attemptChop(treeType, tx, tz) {
  try {
    const res = await api.wcChop(treeType, tx, tz);
    if (activeChop) activeChop.waitingResponse = false;
    if (res?.ok) {
      // Refrescar skills cache (server es source of truth)
      try { await skills.reload(); } catch {}
      // Refrescar inventory para mostrar el nuevo log
      try { await window.inventory?.refresh?.(); } catch {}
      // Feed log
      const got = LOG_DISPLAY_NAMES[res.log_item] || res.log_item;
      feedLog('xp', `+${res.xp_gained} XP Tala (${got})`);
      if (res.level_up) {
        feedLog('info', `¡Subes a nivel ${res.new_level} de Tala!`);
        try { window.__spawnLevelUpBanner?.('woodcutting', res.new_level); } catch {}
      }
      if (activeChop) activeChop.fails = 0;
    }
  } catch (err) {
    if (activeChop) activeChop.waitingResponse = false;
    const code = err?.code;
    if (code === 'tree_depleted') {
      feedLog('info', 'El árbol se cayó.');
      stopChop('depleted');
    } else if (code === 'inventory_full') {
      feedLog('error', 'Mochila llena.');
      stopChop('inventory_full');
    } else if (code === 'level_too_low') {
      feedLog('error', err.message || 'Nivel insuficiente.');
      stopChop('level');
    } else if (code === 'no_axe') {
      feedLog('error', 'Necesitas un hacha.');
      stopChop('no_axe');
    } else if (code === 'out_of_range') {
      // Caminó alejándose; reseteamos para esperar volver a rango.
      if (activeChop) activeChop.fails++;
      if (activeChop && activeChop.fails >= STOP_LOOP_AFTER_FAILS) {
        stopChop('out_of_range');
      }
    } else if (code === 'wc_disabled') {
      feedLog('error', 'Tala no disponible (migración SQL pendiente).');
      stopChop('disabled');
    } else {
      if (activeChop) activeChop.fails++;
      if (activeChop && activeChop.fails >= STOP_LOOP_AFTER_FAILS) {
        stopChop('errors');
      }
    }
  }
}

// ============================================================
// Sync visual de árboles depleted
// ============================================================
//
// El snapshot del server nos manda `depleted_trees` cada 250ms (radio ~100m).
// Por cada árbol depletado, ocultamos su instance en el InstancedMesh
// haciéndole `setMatrixAt(idx, scaleZero)`. Cuando ya no aparece más,
// restauramos la matriz original.
//
// Esto es BARATO porque InstancedMesh permite re-escalar instancias
// individuales sin recrear el mesh.

function syncDepletedFromSnapshot() {
  const snap = getSnapshot?.();
  if (!snap || !Array.isArray(snap.depleted_trees)) return;
  const terrain = getTerrain?.();
  if (!terrain || !terrain.getInteractableMeshes) return;

  const meshes = terrain.getInteractableMeshes();
  if (!meshes || meshes.length === 0) return;

  // Build set de keys "depletadas en este snapshot"
  const currentKeys = new Set();
  for (const d of snap.depleted_trees) {
    const k = depletedKey(d.tree_type, d.x, d.z);
    currentKeys.add(k);
    if (!depletedHidden.has(k)) {
      // Nuevo árbol depletado → ocultar
      const entry = hideTreeAt(meshes, d.tree_type, d.x, d.z);
      if (entry) depletedHidden.set(k, entry);
    }
  }
  // Restaurar los que ya no están depletados en el snapshot.
  for (const [k, entry] of Array.from(depletedHidden.entries())) {
    if (!currentKeys.has(k)) {
      try { entry.restore?.(); } catch {}
      depletedHidden.delete(k);
    }
  }
}

function depletedKey(treeType, x, z) {
  // Redondeo a 0.01m, igual que el server.
  const xR = Math.round(x * 100) / 100;
  const zR = Math.round(z * 100) / 100;
  return `${treeType}|${xR}|${zR}`;
}

/**
 * Oculta la(s) instance(s) del árbol en la posición dada. Un árbol puede
 * tener MÚLTIPLES InstancedMesh (trunk + canopy). Recorremos todos los
 * meshes y para cada uno buscamos en `userData.trees` el árbol con tx, tz.
 * Devuelve {restore} para volver al estado original.
 */
function hideTreeAt(meshes, treeType, tx, tz) {
  const tol = 0.5;          // tolerancia generosa (árboles están espaciados >1m)
  const tolSq = tol * tol;
  const restores = [];

  for (const mesh of meshes) {
    if (!mesh?.userData) continue;
    if (mesh.userData.typeId !== treeType) continue;
    const list = mesh.userData.trees;
    if (!Array.isArray(list)) continue;
    for (let i = 0; i < list.length; i++) {
      const t = list[i];
      const dx = t.x - tx, dz = t.z - tz;
      if (dx * dx + dz * dz <= tolSq) {
        // Guardar matriz original.
        const orig = new THREE.Matrix4();
        mesh.getMatrixAt(i, orig);
        // Sustituir por matriz de scale 0 (invisible).
        const zero = new THREE.Matrix4().makeScale(0, 0, 0);
        mesh.setMatrixAt(i, zero);
        mesh.instanceMatrix.needsUpdate = true;
        restores.push({ mesh, i, orig });
      }
    }
  }

  if (restores.length === 0) return null;
  return {
    restore: () => {
      for (const r of restores) {
        try {
          r.mesh.setMatrixAt(r.i, r.orig);
          r.mesh.instanceMatrix.needsUpdate = true;
        } catch {}
      }
    },
  };
}

// ============================================================
// Display names locales (solo UI / feed log)
// ============================================================
const LOG_DISPLAY_NAMES = {
  logs:          'Troncos',
  oak_logs:      'Troncos roble',
  willow_logs:   'Troncos sauce',
  palm_logs:     'Troncos palmera',
  pine_logs:     'Troncos pino',
  teak_logs:     'Troncos teca',
  maple_logs:    'Troncos arce',
  mahogany_logs: 'Troncos caoba',
  yew_logs:      'Troncos tejo',
  magic_logs:    'Troncos mágicos',
  dead_logs:     'Troncos muertos',
  bush_leaves:   'Ramillas',
};
