/**
 * SebasPresent — Skills index (Sesión 31, FASE 5)
 *
 * Punto único para arrancar/parar/actualizar todas las skills del mundo.
 * En lugar de que `world.js` haga `woodcutting.start(); firemaking.start(); ...`,
 * llama acá una sola vez:
 *
 *   import * as skills from './skills/index.js';
 *
 *   skills.startAll({
 *     getPlayer, getCharacter, getAuthToken, getSnapshot,
 *     getTerrain, setPlayerTarget, feedLog, scene,
 *   });
 *
 *   // animate loop:
 *   skills.updateAll(dt);
 *
 *   // shutdown:
 *   skills.stopAll();
 *
 * Para agregar una skill nueva (ej. cooking):
 *   1. Crear `skills/cooking.js` con export start/stop/update.
 *   2. Importarla acá abajo y agregarla a SKILL_MODULES.
 *   3. Listo. startAll/stopAll/updateAll la llaman automáticamente.
 */

import * as woodcutting from './woodcutting.js';
import * as firemaking  from './firemaking.js';
// import * as cooking from './cooking.js';   // S32
// import * as mining  from './mining.js';    // S33

// Lista canónica de skills activas en este build.
// El orden importa para start() — algunas pueden depender de que otras
// estén ya inicializadas (ej. cooking podría usar firemaking).
const SKILL_MODULES = [
  { name: 'woodcutting', mod: woodcutting },
  { name: 'firemaking',  mod: firemaking  },
  // { name: 'cooking',   mod: cooking   },   // S32
  // { name: 'mining',    mod: mining    },   // S33
];

// Re-exports para que world.js pueda importar la skill puntual si necesita
// llamar funciones específicas (ej. woodcutting.startChopAt, firemaking.lightFireFromSlot).
export { woodcutting, firemaking };

/**
 * Inicia todas las skills. Pasa los mismos getters/callbacks a cada una.
 * Los módulos viejos ignoran los que no usan, así que es seguro pasar todos.
 */
export function startAll(opts) {
  for (const { name, mod } of SKILL_MODULES) {
    if (typeof mod.start !== 'function') {
      console.warn('[skills] módulo ' + name + ' sin start()');
      continue;
    }
    try {
      mod.start(opts);
    } catch (err) {
      console.error('[skills] falló start de ' + name + ':', err);
    }
  }
}

/** Llamado cada frame. Llama update(dt) de cada skill. */
export function updateAll(dt) {
  for (const { name, mod } of SKILL_MODULES) {
    if (typeof mod.update === 'function') {
      try { mod.update(dt); } catch (err) {
        console.warn('[skills] update de ' + name + ':', err);
      }
    }
  }
}

/** Para todas las skills (al salir del mundo). */
export function stopAll() {
  for (const { name, mod } of SKILL_MODULES) {
    if (typeof mod.stop === 'function') {
      try { mod.stop(); } catch (err) {
        console.warn('[skills] stop de ' + name + ':', err);
      }
    }
  }
}

/** Cancela acción activa de todas las skills (cuando el player se mueve). */
export function cancelAllOnMove() {
  for (const { name, mod } of SKILL_MODULES) {
    if (typeof mod.cancelOnMove === 'function') {
      try { mod.cancelOnMove(); } catch (err) {
        console.warn('[skills] cancelOnMove de ' + name + ':', err);
      }
    }
  }
}

/**
 * Sesión 33 (B-001) — Cancela cualquier actividad activa de todas las skills
 * por un evento externo. Lo usan los combat hooks cuando entrás en combate
 * o morís, para asegurar que el gather se corte y el arma se restaure.
 *
 * Por skill, busca primero `cancel(reason)`; si no existe, cae a
 * `cancelOnMove()` para retro-compat con skills viejas.
 *
 * @param {string} reason  Etiqueta para logging (ej. 'combat', 'death').
 */
export function cancelAll(reason = 'external') {
  for (const { name, mod } of SKILL_MODULES) {
    const fn = typeof mod.cancel === 'function' ? mod.cancel : mod.cancelOnMove;
    if (typeof fn === 'function') {
      try { fn(reason); } catch (err) {
        console.warn('[skills] cancel de ' + name + ':', err);
      }
    }
  }
}
