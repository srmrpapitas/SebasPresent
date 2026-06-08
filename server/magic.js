/**
 * SebasPresent — Magic system (Sesión 41, Bloque 2 día 8)
 *
 * Funciones PURAS para el sistema de mago. Se mantienen acá (separadas de
 * combat_engine.js) para poder simularlas en Node sin levantar el Worker, y
 * para que la inyección en el motor de combate sea mínima.
 *
 * DISEÑO (decidido con Nico):
 *  - Maná: pool = magic_level × 2 + bonus_ítems (fórmula A, estilo WoW).
 *  - Regen: lenta de base; los ítems de mago la aceleran. Sin set, aunque
 *    seas 99 con pozo grande, regenerás lento.
 *  - Solo es mago quien tiene un STAFF equipado (gating en combat_engine).
 *  - Daño escala con nivel de Magia + bonus de ítems + base del hechizo.
 *  - Triángulo de combate: Magia > Melee > Distancia > Magia.
 *    Matchup FAVORABLE = +20% daño. El resto NEUTRAL (sin penalizar al
 *    débil — sino los magos one-shotean a los melee).
 *
 * Los bonus de ítems hoy son 0 (los sets de mago llegan con smithing/crafting),
 * pero las fórmulas ya tienen el término `itemBonus` listo para cuando existan.
 */

// ============================================================
// Hechizos (spellbook). base_max_hit = techo de daño del hechizo a nivel bajo;
// sube con el nivel de Magia y el bonus de ítems. mana_cost se descuenta del
// pool. magic_level_req = nivel mínimo de Magia para lanzarlo.
// ============================================================
const SPELLS = {
  fire_strike: {
    id: 'fire_strike',
    name: 'Rayo de fuego',
    magic_level_req: 1,
    mana_cost: 5,
    base_max_hit: 4,
    color: 0xff6622,   // naranja (para el proyectil del cliente)
  },
  ice_spear: {
    id: 'ice_spear',
    name: 'Lanza de hielo',
    magic_level_req: 20,
    mana_cost: 9,
    base_max_hit: 8,
    color: 0x55bbff,   // celeste
  },
  thunderbolt: {
    id: 'thunderbolt',
    name: 'Rayo',
    magic_level_req: 40,
    mana_cost: 14,
    base_max_hit: 13,
    color: 0xffe23a,   // amarillo
  },
  // Sesión 41 — Entangle: ENRAÍZA al objetivo (no se puede mover) 10s, daño
  // bajo. NO es un stun total: el objetivo puede SEGUIR atacando si tiene
  // alcance. Mecánica emergente:
  //   - root a un melee → no te persigue → lo kiteás con hechizos/flechas.
  //   - root a un arquero/mago → te sigue pegando a distancia.
  // El "puede atacar si es ranged pero no melee" sale solo del root + el
  // chequeo de rango existente; no hay lógica extra.
  entangle: {
    id: 'entangle',
    name: 'Enredar',
    magic_level_req: 35,
    mana_cost: 12,
    base_max_hit: 2,        // daño bajo (como OSRS)
    root_ms: 10000,         // 10s sin poder moverse
    color: 0x44cc55,        // verde (enredaderas)
  },
};

function getSpell(spellId) {
  return SPELLS[spellId] || null;
}

// ============================================================
// Triángulo de combate
// ============================================================
// Estilo de un combatiente según su weapon_type (jugador) o su columna
// `style` (NPC). 'staff'→magic, 'bow'→ranged, el resto→melee.
function styleOf(weaponTypeOrStyle) {
  if (weaponTypeOrStyle === 'magic' || weaponTypeOrStyle === 'staff') return 'magic';
  if (weaponTypeOrStyle === 'ranged' || weaponTypeOrStyle === 'bow') return 'ranged';
  return 'melee';
}

const TRIANGLE_FAVORABLE_MULT = 1.20;   // +20% en el matchup favorable

// Pares favorables: atacante PEGA MÁS al defensor.
//   magic  > melee
//   melee  > ranged
//   ranged > magic
function isFavorable(attackerStyle, defenderStyle) {
  return (
    (attackerStyle === 'magic'  && defenderStyle === 'melee')  ||
    (attackerStyle === 'melee'  && defenderStyle === 'ranged') ||
    (attackerStyle === 'ranged' && defenderStyle === 'magic')
  );
}

// Multiplicador de daño del triángulo. Favorable = +20%, resto = neutral (1.0).
function triangleMult(attackerStyle, defenderStyle) {
  return isFavorable(styleOf(attackerStyle), styleOf(defenderStyle))
    ? TRIANGLE_FAVORABLE_MULT
    : 1.0;
}

// ============================================================
// Maná
// ============================================================
// Pool máximo. Fórmula A + COLCHÓN BASE: sin él, nivel 1 = 2 maná y no
// alcanzaba ni para el hechizo más barato (5). Con base 20: nivel 1 = 22
// (casteable), nivel 50 = 120, nivel 99 = 218. itemManaBonus = ítems de mago.
const MANA_BASE = 20;
function computeMaxMana(magicLevel, itemManaBonus = 0) {
  const lvl = Math.max(1, magicLevel | 0);
  return MANA_BASE + lvl * 2 + (itemManaBonus | 0);
}

// Regen LENTA de base; los ítems de mago la suben. Devuelve maná por segundo.
//   base = 0.4/s (sin set: lento aunque tengas pozo grande)
//   +itemRegenBonus (cada pieza de mago suma; hoy 0)
//   tener staff equipado da un pequeño boost (sos "mago activo")
const MANA_REGEN_BASE_PER_SEC = 0.4;
const MANA_REGEN_STAFF_BONUS  = 0.6;   // staff equipado
function manaRegenPerSec(hasStaff, itemRegenBonus = 0) {
  return MANA_REGEN_BASE_PER_SEC + (hasStaff ? MANA_REGEN_STAFF_BONUS : 0) + (itemRegenBonus || 0);
}

// Regen perezosa (lazy), mismo patrón que la HP: se calcula al leer, según el
// tiempo transcurrido desde mana_updated_at. Devuelve el nuevo maná (capeado).
// No persiste — el caller decide cuándo guardar.
function regenMana(manaCurrent, manaMax, lastUpdatedAt, now, perSec) {
  if (!(now > lastUpdatedAt)) return Math.min(manaCurrent, manaMax);
  const elapsedSec = (now - lastUpdatedAt) / 1000;
  const regened = manaCurrent + elapsedSec * perSec;
  return Math.min(manaMax, Math.max(0, Math.floor(regened)));
}

// ============================================================
// Daño mágico
// ============================================================
// Max hit de un hechizo: base del hechizo + escala por nivel de Magia + bonus
// de ítems. Tuneable. A nivel 1 = base; sube ~1 cada 10 niveles de Magia.
function calcMaxHitMagic(magicLevel, spellBaseMaxHit, itemMagicBonus = 0) {
  const lvl = Math.max(1, magicLevel | 0);
  return spellBaseMaxHit + Math.floor(lvl / 10) + (itemMagicBonus | 0);
}

// Roll de hit mágico. Mismo espíritu que rollHitRanged: chance de acertar por
// nivel de Magia vs defensa del objetivo; si acierta, daño 0..maxHit.
// rng() ∈ [0,1). Devuelve { hit, damage }.
function rollHitMagic(rng, magicLevel, defenderDefLvl, maxHit) {
  const atk = Math.max(1, magicLevel | 0);
  const def = Math.max(1, defenderDefLvl | 0);
  // chance de acierto: igual forma que melee/ranged (atk vs def).
  const hitChance = (atk + 8) / (atk + def + 16);
  if (rng() > hitChance) return { hit: false, damage: 0 };
  const r2 = rng();
  const damage = Math.floor(r2 * (maxHit + 1));
  return { hit: true, damage };
}

export {
  SPELLS,
  getSpell,
  styleOf,
  triangleMult,
  isFavorable,
  TRIANGLE_FAVORABLE_MULT,
  computeMaxMana,
  manaRegenPerSec,
  regenMana,
  calcMaxHitMagic,
  rollHitMagic,
};
