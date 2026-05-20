/**
 * SebasPresent — Weapon debug (Sesión 31, FASE 2 — placeholder)
 *
 * El panel real `window.__weaponDebug()` todavía vive en character.js
 * (líneas ~1210-1480). En una sesión futura se va a mover acá tal cual,
 * sin cambios de comportamiento — solo split del archivo.
 *
 * Por ahora este módulo NO instala nada propio. Si querés el panel de
 * calibrar arma:
 *
 *   window.__weaponDebug()
 *
 * Esa función la registra character.js al cargar el módulo, no este archivo.
 *
 * Razón de no moverlo todavía: character.js es delicado (56k) y mover el
 * weapon debug ahora corre riesgo de romper el atach/detach de armas.
 * Lo movemos cuando hagamos el refactor de character.js (S32+).
 */

export function installWeaponDebugBridge() {
  // No-op por ahora. Solo verificamos que el hook de character.js exista
  // para avisar al dev si no se cargó (raro pero por las dudas).
  if (typeof window === 'undefined') return;
  setTimeout(() => {
    if (typeof window.__weaponDebug !== 'function') {
      console.warn('[debug/weapon_debug] window.__weaponDebug no existe todavía. ' +
        'Si te quedaste sin él, probá recargar — character.js lo registra al importar.');
    }
  }, 3000);
}
