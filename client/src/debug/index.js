/**
 * SebasPresent — Debug system (Sesión 31, FASE 2)
 *
 * Punto único de entrada al sistema de debug. Llamar `initDebugSystem()`
 * desde main.js lo antes posible (al inicio del boot). Es idempotente.
 *
 * Qué activa:
 *   1. Captura de errores globales → buffer de 50 últimos.
 *   2. window.__diag.*       → herramientas de introspección runtime.
 *   3. window.__sebasHealth  → health check completo.
 *   4. Badge persistente arriba-izq + panel toggleable.
 *
 * Después de init, en consola de Eruda:
 *   __sebasHealth()                       — chequeo completo
 *   __diag.dumpCharacterState()           — estado del char
 *   __diag.printTracks('Idle')            — tracks de un clip
 *   __diag.forceCallApi('/api/me')        — llamada API directa
 *   __diag.forceChop('oak', 100, 50)      — forzar tala (si en mundo)
 *
 * O simplemente tap en el badge "bNN.M · NN fps" arriba-izquierda
 * para abrir el panel visual.
 *
 * Diseño: el debug system es 100% OBSERVER. No hay callbacks de world.js
 * pasados acá. Lee de:
 *   - window.character     (expuesto por world.js)
 *   - window.equipment     (expuesto por world.js)
 *   - window.skills        (expuesto por world.js)
 *   - window.__snapshotDebug (expuesto por world_snapshot.js)
 *   - window.__wcDebug     (expuesto por woodcutting.js)
 *   - window.__fmDebug     (expuesto por firemaking.js — si existe)
 *
 * Si algún hook no está, el panel muestra "no expuesto" y sigue funcionando.
 * Esto significa: el debug se puede importar ANTES que world.js termine
 * de cargar, y no rompe nada.
 */

import { installErrorHandlers } from './error_capture.js';
import { installDiag }           from './diag.js';
import { installHealthCheck }    from './health_check.js';
import { installOverlay }        from './dev_overlay.js';
import { installWeaponDebugBridge } from './weapon_debug.js';
import { installInspector }      from './inspector.js';
import { BUILD }                 from '../build.js';

let initialized = false;

export function initDebugSystem() {
  if (initialized) return;
  initialized = true;

  // Orden importa:
  //   1. error capture PRIMERO (para atrapar errores de los siguientes pasos)
  //   2. diag y health check (puro código, sin DOM)
  //   3. overlay (toca DOM, espera DOMContentLoaded si hace falta)
  //   4. bridges/placeholders al final
  installErrorHandlers();
  installDiag();
  installHealthCheck();
  installOverlay();
  installWeaponDebugBridge();
  installInspector();

  console.log('%c[debug] SebasPresent debug system ready · build ' + BUILD,
    'background:#1a1410;color:#e8c560;padding:2px 6px;border-radius:3px;font-weight:bold');
  console.log('[debug] tip: corré __sebasHealth() en consola, o tap el badge arriba-izquierda');
}

// Re-exports útiles
export { BUILD } from '../build.js';
export { runHealthCheck } from './health_check.js';
export { getRecentErrors, getErrorCount, clearErrors, pushError } from './error_capture.js';
