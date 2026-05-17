/**
 * SebasPresent — Skills Engine (Sesión 14)
 *
 * Engine puro: cálculos de nivel/XP sin side effects. Importable desde
 * cualquier handler. Sin dependencias.
 *
 * Curva OSRS clásica: nivel L requiere SUMA de floor(L + 300 * 2^(L/7))/4
 * desde 1 hasta L-1. Empieza en 0 XP (nivel 1), 83 XP (nivel 2),
 * 174 XP (nivel 3), ..., 13_034_431 XP (nivel 99).
 *
 * Nivel máximo: 99. XP máximo: 200,000,000 (cap).
 */

export const MAX_LEVEL = 99;
export const MAX_XP = 200000000;

// Tabla precomputada: XP_TABLE[N] = XP total necesario para alcanzar nivel N.
// Índice 0 no usado; índice 1 = nivel 1 = 0 XP; índice 99 = nivel 99.
const XP_TABLE = (() => {
  const table = new Array(MAX_LEVEL + 1);
  table[0] = 0;
  table[1] = 0;
  let points = 0;
  for (let lvl = 1; lvl < MAX_LEVEL; lvl++) {
    points += Math.floor(lvl + 300 * Math.pow(2, lvl / 7));
    table[lvl + 1] = Math.floor(points / 4);
  }
  return table;
})();

/** Devuelve el nivel correspondiente a un XP total. */
export function xpToLevel(xp) {
  if (xp <= 0) return 1;
  if (xp >= XP_TABLE[MAX_LEVEL]) return MAX_LEVEL;
  // Linear scan (99 niveles, despreciable)
  for (let lvl = MAX_LEVEL; lvl >= 1; lvl--) {
    if (xp >= XP_TABLE[lvl]) return lvl;
  }
  return 1;
}

/** Devuelve el XP necesario para alcanzar el nivel L. */
export function levelToXp(level) {
  if (level <= 1) return 0;
  if (level >= MAX_LEVEL) return XP_TABLE[MAX_LEVEL];
  return XP_TABLE[level];
}

/**
 * Catálogo de los 13 skills iniciales. id = clave en DB, name = display ES.
 * combat: si cuenta para combat level (futuro). gathering: si gana XP de
 * recursos. Las dos flags son informativas para clientes/UI, NO usadas en
 * cálculos.
 */
export const SKILLS = [
  // Combat (7)
  { id: 'attack',      name: 'Ataque',      icon: '⚔️', combat: true,  startLvl: 1  },
  { id: 'strength',    name: 'Fuerza',      icon: '💪', combat: true,  startLvl: 1  },
  { id: 'defence',     name: 'Defensa',     icon: '🛡️', combat: true,  startLvl: 1  },
  { id: 'hitpoints',   name: 'Vitalidad',   icon: '❤️', combat: true,  startLvl: 10 },
  { id: 'ranged',      name: 'Distancia',   icon: '🏹', combat: true,  startLvl: 1  },
  { id: 'magic',       name: 'Magia',       icon: '✨', combat: true,  startLvl: 1  },
  { id: 'prayer',      name: 'Plegaria',    icon: '🙏', combat: true,  startLvl: 1  },
  // Gathering / Craft (6)
  { id: 'woodcutting', name: 'Tala',        icon: '🪓', gathering: true, startLvl: 1 },
  { id: 'fishing',     name: 'Pesca',       icon: '🎣', gathering: true, startLvl: 1 },
  { id: 'mining',      name: 'Minería',     icon: '⛏️', gathering: true, startLvl: 1 },
  { id: 'cooking',     name: 'Cocina',      icon: '🍳', gathering: true, startLvl: 1 },
  { id: 'firemaking',  name: 'Fuego',       icon: '🔥', gathering: true, startLvl: 1 },
  { id: 'smithing',    name: 'Herrería',    icon: '🔨', gathering: true, startLvl: 1 },
];

/** Mapa id → def para lookup rápido. */
export const SKILLS_BY_ID = Object.fromEntries(SKILLS.map(s => [s.id, s]));

/** XP inicial de un skill recién creado (basado en startLvl). */
export function startingXpFor(skillId) {
  const def = SKILLS_BY_ID[skillId];
  if (!def) return 0;
  return levelToXp(def.startLvl || 1);
}

/**
 * Calcula resultado de grant XP: nuevo XP, nuevo nivel, si hubo level up.
 * Pure function — no toca DB.
 */
export function applyXpGrant(currentXp, deltaXp) {
  const beforeLevel = xpToLevel(currentXp);
  let newXp = currentXp + deltaXp;
  if (newXp < 0) newXp = 0;
  if (newXp > MAX_XP) newXp = MAX_XP;
  const afterLevel = xpToLevel(newXp);
  return {
    newXp,
    newLevel: afterLevel,
    levelUp: afterLevel > beforeLevel,
    levelsGained: Math.max(0, afterLevel - beforeLevel),
  };
}

/**
 * Combat level OSRS-style. Fórmula clásica:
 *   base = (defence + hitpoints + floor(prayer/2)) / 4
 *   melee = (attack + strength) * 13/40
 *   ranged_lvl = ranged * 13/40 (con floor(ranged*3/2) factor)
 *   magic_lvl = magic * 13/40
 *   combat = base + max(melee, ranged_lvl, magic_lvl)
 */
export function combatLevel(skills) {
  const att = skills.attack || 1;
  const str = skills.strength || 1;
  const def = skills.defence || 1;
  const hp  = skills.hitpoints || 10;
  const pra = skills.prayer || 1;
  const rng = skills.ranged || 1;
  const mag = skills.magic || 1;

  const base = (def + hp + Math.floor(pra / 2)) / 4;
  const melee  = (att + str) * 13 / 40;
  const ranged = Math.floor(rng * 3 / 2) * 13 / 40;
  const magic  = Math.floor(mag * 3 / 2) * 13 / 40;
  return Math.floor(base + Math.max(melee, ranged, magic));
}

/** Total level = suma de todos los niveles. */
export function totalLevel(skills) {
  let sum = 0;
  for (const def of SKILLS) {
    sum += xpToLevel(skills[def.id] || 0);
  }
  return sum;
}
