/**
 * SebasPresent — Combat Styles (Sesión 33, Bloque 1 día 1)
 *
 * Interfaz unificada para los 3 estilos de combate del juego:
 *   - melee   (espadas 1H/2H, hachas, picos, puños)
 *   - ranged  (arcos)
 *   - magic   (staffs)
 *
 * ============================================================
 * PROPÓSITO
 * ============================================================
 *
 * Hoy (S33) la lógica que diverge por weapon_type está dispersa en
 * 3 archivos con if/else:
 *
 *   - core/combat_hooks.js: __playerEnterCombat / __playerExitCombat
 *   - character.js: playAttack switch por weaponType
 *   - combat.js: WEAPON_STANCES, detectEquippedWeapon, doAttackTick
 *
 * Cuando se agregue arquero (Bloque 2 días 4-7) y mago (días 8-11),
 * cada uno necesita comportamiento distinto en cada uno de esos lugares
 * (anim de tiro, proyectiles, ammo, runas, range distinto). Sin un punto
 * único de abstracción, las 3 ramas if/else se duplicarían x3.
 *
 * Este módulo define UN SOLO punto donde cada style declara cómo se
 * comporta. combat.js, character.js y combat_hooks.js consumen
 * `getActiveStyle()` en lugar de hacer su propio if por weapon_type.
 *
 * ============================================================
 * ESTADO ACTUAL (S33 día 1)
 * ============================================================
 *
 * Este archivo está CREADO pero NO SE USA todavía. combat.js, character.js
 * y combat_hooks.js siguen con su lógica original (que funciona). La
 * migración a este módulo es trabajo de S33 día 2 (mañana).
 *
 * MeleeStyle    → IMPLEMENTADO (delega a las funciones existentes)
 * RangedStyle   → STUB (TODOs marcados, implementación real en Bloque 2)
 * MagicStyle    → STUB (TODOs marcados, implementación real en Bloque 2)
 *
 * Importarlo HOY no rompe nada porque ningún consumer lo llama. El
 * archivo es preparación.
 *
 * ============================================================
 * INTERFAZ — qué implementa cada style
 * ============================================================
 *
 * Cada style es un objeto plain con las siguientes propiedades:
 *
 *   id: string
 *     'melee' | 'ranged' | 'magic'. Para logging/debug.
 *
 *   matchesWeaponType(weaponType: string) → boolean
 *     ¿Este style maneja este weapon_type? El selector lo usa para
 *     decidir cuál devolver. Debe ser EXCLUSIVO: cada weapon_type debe
 *     matchear exactamente UN style.
 *
 *   getRange() → number
 *     Range máximo en metros. Para validación de cliente (mostrar
 *     "fuera de rango" antes de mandar el request al server). Hoy el
 *     server hardcodea melee=2m. Cuando se implemente ranged real, el
 *     server tendrá que distinguir también.
 *
 *   onEnterCombat(character) → void
 *     Llamado por combat_hooks.__playerEnterCombat. Reproduce la anim
 *     de "entrar en combate" (draw espada / preparar arco / abrir libro
 *     de hechizos). Para tools/unarmed/ranged/magic: setCombatStance(true).
 *
 *   onExitCombat(character) → void
 *     Llamado por combat_hooks.__playerExitCombat. Reproduce la anim
 *     de "salir de combate" (sheath / guardar arco / cerrar libro).
 *     SIEMPRE debe garantizar combatStance=false al final (ver B-002).
 *
 *   playAttackAnim(character, stance, cooldownMs) → void
 *     Reproduce la anim de attack. Para melee delega a character.playAttack.
 *     Para ranged/magic eventualmente disparará proyectiles también.
 *
 *   canAttack() → { ok: true } | { ok: false, message: string }
 *     Validación de cliente antes de mandar el request. Para melee: siempre
 *     ok. Para ranged: chequea arrows en inventario. Para magic: chequea
 *     runas. Si devuelve {ok:false}, combat.js debe mostrar message al
 *     usuario y NO mandar el request.
 *
 * ============================================================
 * Ejemplo de uso (mañana, día 2)
 * ============================================================
 *
 *   // combat_hooks.js (después del refactor):
 *   import { getActiveStyle } from '../combat_styles.js';
 *
 *   window.__playerEnterCombat = (npcId) => {
 *     _combatTargetNpcId = npcId;
 *     const ch = _getCharacter();
 *     const style = getActiveStyle();
 *     style.onEnterCombat(ch);
 *   };
 *
 *   // combat.js (en doAttackTick):
 *   const style = getActiveStyle();
 *   const check = style.canAttack();
 *   if (!check.ok) {
 *     feedLog('warning', check.message);
 *     return;
 *   }
 *   const result = await api.attackNpc(npcId, pos);
 *   ...
 */

import * as equipment from './equipment.js';

// ============================================================
// MeleeStyle — IMPLEMENTADO
// ============================================================
//
// Cubre todas las armas cuerpo a cuerpo (incluyendo herramientas y puños).
// Delega a las funciones existentes en character.js (playDraw/playSheath/
// setCombatStance/playAttack) — esto NO es código nuevo de combate, es
// una capa de fachada sobre lo que ya funciona.

const MELEE_WEAPON_TYPES = new Set([
  '1h_sword', '2h_sword',   // espadas (tienen anim de draw/sheath)
  'axe', 'pickaxe',          // herramientas (combatStance directo, sin draw)
  'unarmed',                 // puños (combatStance directo, sin draw)
]);

// Range melee — el server hoy hardcodea ~2m. Si cambia, actualizar acá.
const MELEE_RANGE_M = 2.0;

export const MeleeStyle = {
  id: 'melee',

  matchesWeaponType(weaponType) {
    return MELEE_WEAPON_TYPES.has(weaponType);
  },

  getRange() {
    return MELEE_RANGE_M;
  },

  onEnterCombat(character) {
    if (!character) return;
    let weaponType = 'unarmed';
    try { weaponType = equipment.getWeaponType?.() || 'unarmed'; } catch {}
    // Comportamiento idéntico al viejo combat_hooks.js (pre-migración día 2):
    //   - Espadas (1h/2h): playDraw — anim de desenvainar.
    //   - Herramientas (axe/pickaxe): setCombatStance(true) directo.
    //   - Unarmed: NO se setea stance — preservado del viejo. Si llegamos a
    //     darnos cuenta que unarmed debería setear stance al entrar combate,
    //     es un fix de B-002 followup separado, NO cambiarlo en migración.
    if (weaponType === '1h_sword' || weaponType === '2h_sword') {
      try { character.playDraw?.(); }
      catch (e) { console.warn('[combat_styles] MeleeStyle.onEnterCombat playDraw:', e); }
    } else if (weaponType === 'axe' || weaponType === 'pickaxe') {
      try { character.setCombatStance?.(true); } catch {}
    }
    // unarmed: no-op (igual que antes)
  },

  onExitCombat(character) {
    if (!character) return;
    let weaponType = 'unarmed';
    try { weaponType = equipment.getWeaponType?.() || 'unarmed'; } catch {}
    // Las espadas usan playSheath (anim de envainar). El resto cambia
    // el stance directo y resetea el mixer (estilo B-002 fix).
    if (weaponType === '1h_sword' || weaponType === '2h_sword') {
      try { character.playSheath?.(); }
      catch (e) { console.warn('[combat_styles] MeleeStyle.onExitCombat playSheath:', e); }
    } else {
      try { character.setCombatStance?.(false); } catch {}
      // Mismo cleanup que combat_hooks.js hace hoy (sin esto: pose residual).
      if (character) character.isInTransition = false;
      try { character._forceIdleReset?.(); } catch {}
    }
  },

  playAttackAnim(character, stance, cooldownMs) {
    if (!character) return;
    // character.playAttack hace el switch interno por weaponType (1h/2h/tool/
    // unarmed). Lo aprovechamos sin replicarlo.
    let weaponType = 'unarmed';
    try { weaponType = equipment.getWeaponType?.() || 'unarmed'; } catch {}
    try { character.playAttack?.(stance, weaponType, cooldownMs); }
    catch (e) { console.warn('[combat_styles] MeleeStyle.playAttackAnim:', e); }
  },

  canAttack() {
    // Melee no requiere recursos consumibles. Siempre listo.
    return { ok: true };
  },
};

// ============================================================
// RangedStyle — STUB (implementar en Bloque 2 días 4-7)
// ============================================================
//
// Maneja arcos. Para implementar:
//   1. R2: subir mesh GLB del arco (bow_shortbow.glb) + flecha (arrow.glb).
//   2. character.js: WEAPON_TRANSFORMS para 'bow' (escala + posición en mano
//      izquierda? — los arcos en OSRS se llevan en la mano "off-hand").
//   3. server/handlers/combat.js: distinguir ranged en attackNpc (consumir
//      1 arrow del inventario por hit, range >2m, damage usa Ranged stat).
//   4. server: agregar columna stats.ranged_xp + ranged_level (mirror).
//   5. Cliente: anim de tiro (Bow_Attack.fbx en R2) + proyectil 3D que
//      vuela desde player hacia target con arc parabólico.

const RANGED_RANGE_M = 8.0;  // estimado OSRS: ~7-8 squares

// Items que cuentan como ammo para arquero. Se chequea inventory.getState()
// y se busca cualquiera de estos item_ids con quantity > 0.
const RANGED_AMMO_ITEMS = [
  'arrow_bronze',   // futuro
  // 'arrow_iron', 'arrow_steel', ...
];

export const RangedStyle = {
  id: 'ranged',

  matchesWeaponType(weaponType) {
    return weaponType === 'bow';
  },

  getRange() {
    return RANGED_RANGE_M;
  },

  // TODO Bloque 2 día 5: cuando exista anim 'bow_draw' en character.js,
  // reemplazar por character.playBowDraw() o similar. Por ahora el stance
  // directo evita que el char quede con anim equivocada.
  onEnterCombat(character) {
    if (!character) return;
    try { character.setCombatStance?.(true); } catch {}
  },

  onExitCombat(character) {
    if (!character) return;
    try { character.setCombatStance?.(false); } catch {}
    if (character) character.isInTransition = false;
    try { character._forceIdleReset?.(); } catch {}
  },

  // TODO Bloque 2 día 6: implementar disparo real:
  //   1. character.playBowShoot(stance, cooldownMs) — anim de tirar.
  //   2. spawnProjectile({ from: playerPos, to: targetPos, type: 'arrow' })
  //      en world.js o un módulo nuevo `client/src/projectiles.js`.
  //   3. El proyectil debe volar ~0.3-0.5s con arc parabólico, y hacer
  //      "hit" visual cuando llega (spark/damage_splat — reusar el sistema
  //      de hitsplats).
  playAttackAnim(character, stance, cooldownMs) {
    if (!character) return;
    // Fallback HOY: usa la anim de attack genérica (punching/sword) para que
    // al menos algo se vea si alguien testea con un bow falso. Cuando
    // implementemos arquero real, esto reemplaza a la anim de tiro.
    try { character.playAttack?.(stance, 'bow', cooldownMs); }
    catch (e) { console.warn('[combat_styles] RangedStyle.playAttackAnim:', e); }
  },

  // TODO Bloque 2 día 4: cuando exista inventory con arrows reales, leer
  // inventory.getState() y chequear que haya al menos 1 de los items en
  // RANGED_AMMO_ITEMS. Por ahora siempre OK (no se va a llamar hasta que
  // el style se active con un bow equipado, lo cual no pasa hoy).
  canAttack() {
    return { ok: true };
    // Pseudocódigo de mañana:
    //
    //   const slots = inventory.getState();
    //   const hasAmmo = slots.some(s => s && RANGED_AMMO_ITEMS.includes(s.item_id) && s.quantity > 0);
    //   if (!hasAmmo) return { ok: false, message: 'Necesitas flechas para disparar.' };
    //   return { ok: true };
  },
};

// ============================================================
// MagicStyle — STUB (implementar en Bloque 2 días 8-11)
// ============================================================
//
// Maneja staffs y spells. Para implementar:
//   1. R2: mesh GLB del staff + meshes de runas (UI inv) + meshes de
//      hechizos visuales (fireball, etc.) o partículas.
//   2. Sistema de spellbook UI: panel con grid de hechizos, cada uno con
//      sus requisitos de runas + nivel de magic.
//   3. server/handlers/combat.js: distinguir magic en attackNpc (consumir
//      las runas correspondientes al spell elegido, damage usa Magic stat).
//   4. server: agregar stats.magic_xp + magic_level.
//   5. Cliente: anim de cast (Cast.fbx en R2) + proyectil de hechizo
//      (probablemente shader/partícula, no mesh GLB).
//   6. Modern spellbook OSRS-style: lista de hechizos seleccionables que
//      reemplazan al stance (Wind Strike, Fire Strike, etc).

const MAGIC_RANGE_M = 6.0;  // estimado OSRS: ~6 squares

// Hechizos disponibles — cada uno con sus runas. Mock para el stub.
const MAGIC_SPELLS_STUB = {
  wind_strike: { name: 'Wind Strike', runes: { air: 1, mind: 1 } },
  // fire_strike, water_strike, etc.
};

export const MagicStyle = {
  id: 'magic',

  matchesWeaponType(weaponType) {
    return weaponType === 'staff';
  },

  getRange() {
    return MAGIC_RANGE_M;
  },

  // TODO Bloque 2 día 8: anim de "preparar magic" (alzar staff, brillo, etc).
  onEnterCombat(character) {
    if (!character) return;
    try { character.setCombatStance?.(true); } catch {}
  },

  onExitCombat(character) {
    if (!character) return;
    try { character.setCombatStance?.(false); } catch {}
    if (character) character.isInTransition = false;
    try { character._forceIdleReset?.(); } catch {}
  },

  // TODO Bloque 2 día 9: implementar cast real:
  //   1. character.playCast(spellId, cooldownMs) — anim de hechizo.
  //   2. spawnProjectile({ from, to, type: spellVisual }) con partícula.
  //   3. El damage type cambia según el spell (air vs fire vs water).
  playAttackAnim(character, stance, cooldownMs) {
    if (!character) return;
    try { character.playAttack?.(stance, 'staff', cooldownMs); }
    catch (e) { console.warn('[combat_styles] MagicStyle.playAttackAnim:', e); }
  },

  // TODO Bloque 2 día 10: chequear que hay runas en inventario para el
  // hechizo seleccionado. Mientras el spellbook UI no exista, asumimos
  // wind_strike por default.
  canAttack() {
    return { ok: true };
    // Pseudocódigo:
    //
    //   const spell = getSelectedSpell?.() || MAGIC_SPELLS_STUB.wind_strike;
    //   const slots = inventory.getState();
    //   for (const [runeType, count] of Object.entries(spell.runes)) {
    //     const have = slots.reduce((sum, s) => s?.item_id === `rune_${runeType}` ? sum + s.quantity : sum, 0);
    //     if (have < count) return { ok: false, message: `Necesitas ${count} ${runeType} runes.` };
    //   }
    //   return { ok: true };
  },
};

// ============================================================
// Selector
// ============================================================

// Orden de los styles para el selector. MeleeStyle es el FALLBACK — si
// nada matchea, melee se queda (cubre 'unarmed' explícitamente).
const STYLES = [RangedStyle, MagicStyle, MeleeStyle];

/**
 * Devuelve el CombatStyle activo según el weapon_type equipado.
 *
 * Si no hay arma equipada, devuelve MeleeStyle (que cubre 'unarmed').
 * Si equipment.getWeaponType falla, también cae a melee como safe default.
 *
 * @returns {object} uno de los exports MeleeStyle / RangedStyle / MagicStyle.
 */
export function getActiveStyle() {
  let weaponType = 'unarmed';
  try { weaponType = equipment.getWeaponType?.() || 'unarmed'; } catch {}
  for (const style of STYLES) {
    if (style.matchesWeaponType(weaponType)) return style;
  }
  // No debería pasar (MeleeStyle.matchesWeaponType incluye 'unarmed'), pero
  // por si llega un weapon_type desconocido (nuevo item sin clasificar):
  console.warn('[combat_styles] weapon_type desconocido:', weaponType, '— fallback a melee');
  return MeleeStyle;
}

/**
 * Atajo para obtener el style asociado a un weapon_type sin tener que pasar
 * por equipment. Útil para tests o lookup directo.
 *
 * @param {string} weaponType
 * @returns {object}
 */
export function styleForWeaponType(weaponType) {
  for (const style of STYLES) {
    if (style.matchesWeaponType(weaponType)) return style;
  }
  return MeleeStyle;
}

// ============================================================
// Debug
// ============================================================

if (typeof window !== 'undefined') {
  window.__combatStyles = {
    getActive: getActiveStyle,
    styleFor: styleForWeaponType,
    Melee: MeleeStyle,
    Ranged: RangedStyle,
    Magic: MagicStyle,
  };
}
