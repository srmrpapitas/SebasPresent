/**
 * SebasPresent — Combat hooks (Sesión 31, FASE 4c)
 *
 * Extraídos de world.js. Estos son los hooks que combat.js dispara via
 * window.__player* para mover el char del jugador (attack/draw/sheath/death/
 * revive). Antes vivían inline en world.js mezclados con todo lo demás.
 *
 * Estado interno: combatTargetNpcId — id del NPC con el que estamos
 * en combate. world.js lo lee via getCombatTargetNpcId() para hacer
 * el facing-lock del player en updatePlayer().
 *
 * Uso desde world.js:
 *
 *   import * as combatHooks from './core/combat_hooks.js';
 *
 *   // 1. después de equipment.init():
 *   combatHooks.register({
 *     getCharacter:  () => character,
 *     getWeaponType: () => equipment.getWeaponType?.(),
 *     onRespawn: () => {
 *       if (player) {
 *         player.position.x = 0;
 *         player.position.z = 0;
 *         playerTarget = null;
 *         if (marker) marker.visible = false;
 *         terrain.primeChunks(0, 0);
 *       }
 *     },
 *   });
 *
 *   // 2. donde antes leías combatTargetNpcId:
 *   const target = combatHooks.getCombatTargetNpcId();
 *
 * Side effect: registra los window.__player* hooks. Idempotente.
 */

// Sesión 33 (B-001) — Necesitamos cancelar cualquier skill activa (tala,
// firemaking) al entrar combate o morir. Sin esto, el loop de chop seguiría
// corriendo mientras el char hace draw/death anims, y el restoreWeapon
// nunca se dispararía → el char queda con el hacha en mano durante combat
// o muerte.
import * as skills from '../skills/index.js';

// ============================================================
// Estado interno
// ============================================================

let _combatTargetNpcId = null;

// Refs externas inyectadas por register()
let _getCharacter = () => null;
let _getWeaponType = () => 'unarmed';
let _onRespawn = () => {};

let _registered = false;

// ============================================================
// API pública
// ============================================================

/**
 * Registra los handlers window.__player* y guarda los getters/callbacks.
 * Idempotente: llamar dos veces no rompe; pisa los getters con los nuevos.
 *
 * @param {object} opts
 * @param {() => any}    opts.getCharacter   getter del Character instance
 * @param {() => string} opts.getWeaponType  getter del weapon_type actual ('axe', '1h_sword', etc)
 * @param {() => void}   opts.onRespawn      callback que teleporta al hub (0,0), clear target, prime chunks
 */
export function register(opts) {
  if (typeof opts?.getCharacter === 'function')  _getCharacter  = opts.getCharacter;
  if (typeof opts?.getWeaponType === 'function') _getWeaponType = opts.getWeaponType;
  if (typeof opts?.onRespawn === 'function')     _onRespawn     = opts.onRespawn;

  if (_registered || typeof window === 'undefined') return;
  _registered = true;

  // Sesión 26 — combat.js pasa stance + weaponType + cooldownMs. El
  // character usa weaponType para decidir qué FBX usar (1H=Punching,
  // 2H=Sword_Attack_X según stance) y escala la anim a cooldownMs.
  window.__playerPlayAttack = (stanceKey, weaponType, cooldownMs) => {
    const ch = _getCharacter();
    try { ch?.playAttack?.(stanceKey, weaponType, cooldownMs); }
    catch (e) { console.warn('[combat_hooks] playAttack:', e); }
  };

  // Slice 5d: animaciones de combate (engage/disengage = draw/sheath espada;
  // death/revive cuando mueres/respawneas).
  //
  // Sesión 25: con equipment integrado, reactivamos playDraw/playSheath SOLO
  // si el arma equipada es melee (1h_sword/2h_sword). Para bow/staff/unarmed
  // no tiene sentido el sword_draw.
  //
  // Sesión 30 — axe/pickaxe son herramientas: melee pero sin draw.
  //
  // Sesión 33 (B-001) — Si el jugador estaba talando con tool override,
  // primero cancelamos para restaurar el arma original. Sino el draw de
  // la espada se haría sobre el hacha y queda inconsistente.
  window.__playerEnterCombat = (npcId) => {
    // Cancel cualquier gather activo + restore weapon ANTES del draw.
    // Idempotente: si no había gather activo, es noop.
    try { skills.cancelAll('combat'); } catch (e) { console.warn('[combat_hooks] cancelAll:', e); }

    const wasEngaged = _combatTargetNpcId !== null;
    _combatTargetNpcId = npcId;
    if (wasEngaged) return;

    const ch = _getCharacter();
    let weaponType = 'unarmed';
    try { weaponType = _getWeaponType() || 'unarmed'; } catch {}
    const isMelee     = weaponType === '1h_sword' || weaponType === '2h_sword';
    const isToolMelee = weaponType === 'axe' || weaponType === 'pickaxe';
    if (isMelee) {
      try { ch?.playDraw?.(); }
      catch (e) { console.warn('[combat_hooks] playDraw:', e); }
    } else if (isToolMelee) {
      // Herramientas: combatStance pero sin draw. Anim de attack = punching.
      try { ch?.setCombatStance?.(true); } catch {}
    } else if (weaponType !== 'unarmed') {
      // Bow/staff: activar combatStance manualmente (sin draw anim) para que
      // las anims de attack_1..4 se usen en lugar de punch.
      try { ch?.setCombatStance?.(true); } catch {}
    }
  };

  window.__playerExitCombat = () => {
    _combatTargetNpcId = null;
    const ch = _getCharacter();
    let weaponType = 'unarmed';
    try { weaponType = _getWeaponType() || 'unarmed'; } catch {}
    const isMelee     = weaponType === '1h_sword' || weaponType === '2h_sword';
    const isToolMelee = weaponType === 'axe' || weaponType === 'pickaxe';
    if (isMelee) {
      try { ch?.playSheath?.(); }
      catch (e) { console.warn('[combat_hooks] playSheath:', e); }
    } else if (isToolMelee || weaponType !== 'unarmed') {
      try { ch?.setCombatStance?.(false); } catch {}
    }
  };

  window.__playerDeath = () => {
    // Sesión 33 (B-001) — Cancel skills + restore weapon antes del death anim.
    // Sin esto: si moriste talando, el char hace anim de muerte con el hacha
    // en mano (raro). Idempotente: noop si no había gather.
    try { skills.cancelAll('death'); } catch (e) { console.warn('[combat_hooks] cancelAll:', e); }

    _combatTargetNpcId = null;
    const ch = _getCharacter();
    try { ch?.playDeath?.(); }
    catch (e) { console.warn('[combat_hooks] playDeath:', e); }
  };

  window.__playerRevive = () => {
    _combatTargetNpcId = null;
    // Slice 5c mini-fix: hook revive robusto.
    // - Si character tiene revive(), lo usa (Character clase real).
    // - Si character es fallback (cápsula sin métodos), no rompe.
    // - Si revive() falla por lo que sea, forzamos arranque de idle directo
    //   en el mixer para que el modelo no se quede en pose de muerte.
    const ch = _getCharacter();
    try {
      if (ch?.revive) {
        ch.revive();
      } else if (ch?.mixer && ch?.actions?.idle) {
        // Plan B: no hay método revive() pero sí mixer + idle clip.
        ch.isDead = false;
        ch.isAttacking = false;
        ch.isInTransition = false;
        ch.mixer.stopAllAction();
        ch.mixer.setTime(0);
        ch.actions.idle.reset();
        ch.actions.idle.setEffectiveWeight(1);
        ch.actions.idle.enabled = true;
        ch.actions.idle.play();
        ch.current = ch.actions.idle;
      }
    } catch (e) { console.warn('[combat_hooks] revive failed:', e); }

    // Teleport al hub (0,0) + refresh chunks. El server (combatRespawnUser)
    // solo restaura HP, no toca posición.
    try { _onRespawn(); }
    catch (e) { console.warn('[combat_hooks] onRespawn:', e); }
  };

  console.log('[combat_hooks] registrados window.__player*');
}

/** Devuelve el id del NPC con el que estamos en combate (null si no). */
export function getCombatTargetNpcId() {
  return _combatTargetNpcId;
}

/** Setter directo. Solo usar para casos especiales (ej. cancel auto-engage). */
export function setCombatTargetNpcId(id) {
  _combatTargetNpcId = id;
}

/** Para cleanup al salir del mundo. NO desregistra los hooks (otros sistemas
 *  pueden seguir disparándolos). Solo limpia el target. */
export function reset() {
  _combatTargetNpcId = null;
}
