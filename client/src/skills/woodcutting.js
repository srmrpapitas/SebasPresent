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

import * as api from '../api.js';
import * as skills from '../skills.js';
import * as THREE from 'three';

// ============================================================
// Constantes (deben matchear server/handlers/woodcutting.js)
// ============================================================
// Tick mínimo entre intentos de chop (en ms). Si la anim Woodcut dura
// más que esto, usamos su duración real (más natural). Si dura menos,
// igualmente esperamos este mínimo para no spammear el server.
const MIN_CHOP_TICK_MS = 1800;
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
    // Disparamos primer chop inmediato (lastChopAt = 0 fuerza tick now).
    activeChop.lastChopAt = 0;
    activeChop.tickMs = MIN_CHOP_TICK_MS;  // empezar con tick mínimo
  }

  const now = performance.now();
  const sinceLast = now - activeChop.lastChopAt;
  if (sinceLast >= activeChop.tickMs && !activeChop.waitingResponse) {
    activeChop.lastChopAt = now;
    activeChop.waitingResponse = true;
    // Sesión 30 — Usamos 'punching' en lugar de 'woodcut' porque el FBX
    // de Woodcut.fbx no tiene tracks compatibles con el rig del char y
    // queda en T-pose mezclada. Punching es un puñetazo lateral que se
    // ve bien como hachazo cuando tenés el axe en la mano.
    const character = getCharacter?.();
    if (character && character.playGather) {
      const dur = character.playGather('punching', 0);  // 0 = usar natural
      if (dur > 0) {
        activeChop.tickMs = Math.max(MIN_CHOP_TICK_MS, dur);
      }
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
    if (!res?.ok) return;

    // Sesión 31 — Nueva mecánica OSRS-style. El server ahora hace 2 rolls:
    //   log_gained: false       → falló el chop, no log, no XP, seguimos talando
    //   log_gained: true + tree_falls: false → +1 log + XP, árbol sigue vivo
    //   log_gained: true + tree_falls: true  → +1 log + XP, árbol cae, paramos
    //
    // Backwards compat: si el server VIEJO responde sin log_gained, asumimos
    // que sí lo dio (comportamiento pre-S31).
    const logGained = res.log_gained !== false;  // default true para server viejo
    const treeFalls = res.tree_falls !== false;  // default true para server viejo

    if (!logGained) {
      // Roll de chop falló. Reset fail counter (no es un error real) y seguir.
      if (activeChop) activeChop.fails = 0;
      return;
    }

    // Llegamos acá → +1 log + XP
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

    // Si el árbol cayó → mensaje + parar loop. Si no, seguimos talando.
    if (treeFalls) {
      const treeName = res.tree_type || treeType;
      feedLog('info', `El árbol cae.`);
      stopChop('depleted');
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
  if (!snap) return;

  // Debug: si el snapshot NO tiene 'depleted_trees', el server no se actualizó
  if (!('depleted_trees' in snap)) {
    if (!_warnedNoDepleted) {
      console.warn('[woodcutting] El snapshot NO incluye `depleted_trees`. ¿Subiste server/handlers/snapshot.js actualizado?');
      _warnedNoDepleted = true;
    }
    return;
  }

  if (!Array.isArray(snap.depleted_trees)) return;
  const terrainMod = getTerrain?.();
  if (!terrainMod || !terrainMod.getInteractableMeshes) return;

  const meshes = terrainMod.getInteractableMeshes();
  if (!meshes || meshes.length === 0) return;

  // Log cuando llega un cambio en cantidad de árboles depletados
  if (snap.depleted_trees.length !== _lastDepletedCount) {
    console.log(`[woodcutting] snapshot.depleted_trees =`, snap.depleted_trees.length, 'meshes interactables:', meshes.length);
    _lastDepletedCount = snap.depleted_trees.length;
  }

  // Build set de keys "depletadas en este snapshot"
  const currentKeys = new Set();
  for (const d of snap.depleted_trees) {
    const k = depletedKey(d.tree_type, d.x, d.z);
    currentKeys.add(k);
    if (!depletedHidden.has(k)) {
      // Sesión 30 — SIEMPRE crear tocón visible en la pos del server.
      // Si además podemos ocultar el árbol del InstancedMesh, mejor.
      // Pero la prioridad es que el player VEA feedback visual.
      const hideEntry = hideTreeAt(meshes, d.tree_type, d.x, d.z);
      const stumpEntry = createStumpAtScene(d.x, d.z, meshes);

      // Combinar las dos entradas
      const combined = {
        hiddenCount: hideEntry?.hiddenCount || 0,
        restore: () => {
          try { hideEntry?.restore?.(); } catch {}
          try { stumpEntry?.restore?.(); } catch {}
        },
      };
      depletedHidden.set(k, combined);

      if (hideEntry) {
        console.log(`[woodcutting] ✅ tree depleted+hidden: type=${d.tree_type} pos=(${d.x.toFixed(2)}, ${d.z.toFixed(2)})`);
      } else {
        console.warn(`[woodcutting] ⚠ tree depleted but NOT hidden (stump created anyway): type=${d.tree_type} pos=(${d.x.toFixed(2)}, ${d.z.toFixed(2)})`);
      }
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

let _warnedNoDepleted = false;
let _lastDepletedCount = -1;

function depletedKey(treeType, x, z) {
  // Redondeo a 0.01m, igual que el server.
  const xR = Math.round(x * 100) / 100;
  const zR = Math.round(z * 100) / 100;
  return `${treeType}|${xR}|${zR}`;
}

/**
 * Oculta la(s) instance(s) del árbol en la posición dada Y spawnea un
 * "tocón" visible (cilindro chato marrón en y=0, estilo OSRS).
 *
 * Un árbol puede tener MÚLTIPLES InstancedMesh (trunk + canopy). Recorremos
 * todos los meshes y para cada uno buscamos en `userData.trees` el árbol
 * con tx, tz. Devuelve {restore, hiddenCount} para volver al estado original.
 */
function hideTreeAt(meshes, treeType, tx, tz) {
  // Sesión 30 — Tolerancia 3m: los árboles tienen MIN_SPACING en terrain.js
  // pero el matching exacto puede fallar por scale random/rotación.
  const tol = 3.0;
  const tolSq = tol * tol;

  // Buscar la instancia MÁS CERCANA (no todas las dentro del radio).
  // Un árbol "Tree" puede tener 2 InstancedMesh (trunk + canopy) en el mismo
  // chunk, así que para el typeId dado capturamos TODAS las instancias del
  // mismo índice i en cualquier mesh con userData.trees[i] cercano.
  let bestIdx = -1;
  let bestDist = Infinity;
  let bestTree = null;
  let candidateMeshes = [];

  for (const mesh of meshes) {
    if (!mesh?.userData) continue;
    if (mesh.userData.typeId !== treeType) continue;
    const list = mesh.userData.trees;
    if (!Array.isArray(list)) continue;
    // Recordar este mesh para luego ocultar la instancia
    candidateMeshes.push({ mesh, list });
    for (let i = 0; i < list.length; i++) {
      const t = list[i];
      const dx = t.x - tx, dz = t.z - tz;
      const d2 = dx * dx + dz * dz;
      if (d2 <= tolSq && d2 < bestDist) {
        bestDist = d2;
        bestIdx = i;
        bestTree = t;
      }
    }
  }

  if (bestIdx < 0 || !bestTree) return null;

  // Ahora ocultar bestIdx en TODOS los candidateMeshes que tengan ese
  // mismo árbol en su lista (típicamente trunk + canopy del mismo cluster).
  const restores = [];
  for (const { mesh, list } of candidateMeshes) {
    if (bestIdx >= list.length) continue;
    const t = list[bestIdx];
    // Verificar que el árbol en este mesh sea EL MISMO (mismas coords).
    if (t.x !== bestTree.x || t.z !== bestTree.z) continue;
    const orig = new THREE.Matrix4();
    mesh.getMatrixAt(bestIdx, orig);
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    mesh.setMatrixAt(bestIdx, zero);
    mesh.instanceMatrix.needsUpdate = true;
    restores.push({ mesh, i: bestIdx, orig });
  }

  if (restores.length === 0) return null;
  return {
    hiddenCount: restores.length,
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

/**
 * Crea un tocón visible en (tx, tz) y lo agrega a la escena.
 * INDEPENDIENTE de si el árbol fue ocultado o no — siempre se intenta crear.
 * Lo agrega al parent del primer mesh disponible (o a la escena raíz si
 * no hay meshes).
 */
function createStumpAtScene(tx, tz, meshes) {
  const stumpGroup = createStump(tx, tz);
  if (!stumpGroup) return null;

  // Buscar un parent al que añadir. Cualquier mesh sirve (todos están en
  // la escena). Si no hay meshes, intentamos getScene del world.
  let parent = null;
  if (meshes && meshes.length > 0) {
    for (const m of meshes) {
      if (m?.parent) { parent = m.parent; break; }
    }
  }
  // Fallback: navegar arriba desde character.group
  if (!parent) {
    const ch = getCharacter?.();
    if (ch?.group?.parent) parent = ch.group.parent;
  }
  if (!parent) {
    console.warn('[woodcutting] createStumpAtScene: no parent found, stump not added');
    return null;
  }

  parent.add(stumpGroup);
  console.log(`[woodcutting] 🪵 stump added at (${tx.toFixed(2)}, ${tz.toFixed(2)}) parent="${parent.name || parent.type}"`);

  return {
    restore: () => {
      if (stumpGroup && stumpGroup.parent) {
        try {
          stumpGroup.parent.remove(stumpGroup);
          stumpGroup.traverse(o => {
            if (o.geometry) o.geometry.dispose?.();
            if (o.material) {
              const mats = Array.isArray(o.material) ? o.material : [o.material];
              for (const m of mats) m.dispose?.();
            }
          });
        } catch {}
      }
    },
  };
}

/**
 * Crea un tocón visible en (tx, tz) — cilindro chato marrón estilo OSRS.
 * Sesión 30: más grande y visible (60cm radio, 50cm alto) para feedback claro.
 */
function createStump(tx, tz) {
  const group = new THREE.Group();
  group.position.set(tx, 0, tz);
  group.name = 'wc_stump';

  // Cilindro del tocón (60cm radio, 50cm alto)
  const trunkGeom = new THREE.CylinderGeometry(0.55, 0.65, 0.5, 12);
  const trunkMat = new THREE.MeshLambertMaterial({ color: 0x5a3a1d, flatShading: true });
  const trunk = new THREE.Mesh(trunkGeom, trunkMat);
  trunk.position.y = 0.25;
  group.add(trunk);

  // Disco superior (corte) más claro - bien visible
  const topGeom = new THREE.CylinderGeometry(0.55, 0.55, 0.05, 12);
  const topMat = new THREE.MeshLambertMaterial({ color: 0xd4a868, flatShading: true });
  const top = new THREE.Mesh(topGeom, topMat);
  top.position.y = 0.52;
  group.add(top);

  return group;
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
