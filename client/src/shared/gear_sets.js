/**
 * SebasPresent — Armaduras de arquero por animal y túnicas de mago (Sesión 52)
 *
 * MÓDULO COMPARTIDO cliente + servidor. ÚNICA fuente de los números:
 *   - equip_reqs.js  → nivel para equipar, defensa mágica y poder mágico
 *   - crafting.js    → recetas de Artesanía
 *   - server/seeds/023_gear_s52.sql se genera con scripts/gen_gear_s52.mjs
 *
 * Los ids siguen el patrón <hueco>_<material> (helm_lobo, body_seda…): el
 * material es el último trozo del id y de ahí salen iconos, color 3D y
 * requisitos.
 */

export const GEAR_SLOTS = ['helm', 'body', 'legs', 'gloves', 'boots'];

// ---------------------------------------------------------------
// ARQUERO — cuero por animal. Bonus de distancia (cuenta al disparar),
// defensa y defensa mágica (el cuero frena la magia).
// ---------------------------------------------------------------
export const ARCHER_SETS = {
  lobo: {
    label: 'de lobo', level: 20, mdefFactor: 1.4, colorHex: 0x6e6a66,
    raw: 'piel_lobo', mat: 'cuero_lobo', tanXp: 8, price: 90,
    ranged:  { helm: 3,  body: 6,  legs: 5,  gloves: 2, boots: 2 },
    defence: { helm: 4,  body: 9,  legs: 6,  gloves: 2, boots: 2 },
  },
  escorpion: {
    label: 'de escorpión', level: 35, mdefFactor: 1.1, colorHex: 0x5a3a14,
    raw: 'caparazon_escorpion', mat: 'placa_escorpion', tanXp: 14, price: 240,
    ranged:  { helm: 4,  body: 9,  legs: 7,  gloves: 3, boots: 3 },
    defence: { helm: 6,  body: 14, legs: 9,  gloves: 3, boots: 3 },
  },
  yeti: {
    label: 'de yeti', level: 50, mdefFactor: 1.0, colorHex: 0xe8eef2,
    raw: 'piel_yeti', mat: 'cuero_yeti', tanXp: 22, price: 650,
    ranged:  { helm: 6,  body: 12, legs: 9,  gloves: 4, boots: 3 },
    defence: { helm: 8,  body: 18, legs: 12, gloves: 4, boots: 4 },
  },
  escama: {
    label: 'de escamas de dragón', level: 70, mdefFactor: 0.85, colorHex: 0x5a1010,
    raw: null, mat: 'escama_dragon', tanXp: 0, price: 6000,   // las escamas no se curten
    ranged:  { helm: 7,  body: 16, legs: 12, gloves: 5, boots: 4 },
    defence: { helm: 10, body: 24, legs: 16, gloves: 5, boots: 5 },
  },
};

// ---------------------------------------------------------------
// MAGO — túnicas. Poca defensa contra armas, mucha defensa mágica y
// PODER MÁGICO: cada pieza suma golpe máximo a los hechizos y maná
// (décimas: el total del juego se redondea hacia abajo).
// ---------------------------------------------------------------
export const MAGE_SETS = {
  algodon:  { label: 'de algodón', level: 1,  mdefFactor: 5,   cloth: 'tela_algodon', craft: true,  price: 40,
              hitPerPiece: 0.2, manaPerPiece: 2,  defence: { helm: 1, body: 2, legs: 1, gloves: 0, boots: 1 } },
  lino:     { label: 'de lino', level: 25,    mdefFactor: 4.1, cloth: 'tela_lino',    craft: true,  price: 160,
              hitPerPiece: 0.4, manaPerPiece: 4,  defence: { helm: 1, body: 3, legs: 2, gloves: 1, boots: 1 } },
  seda:     { label: 'de seda', level: 45,    mdefFactor: 3.7, cloth: 'tela_seda',    craft: true,  price: 520,
              hitPerPiece: 0.8, manaPerPiece: 6,  defence: { helm: 2, body: 4, legs: 3, gloves: 1, boots: 1 } },
  cabildo:  { label: 'del Cabildo', level: 60, mdefFactor: 3.2, cloth: null,          craft: false, price: 9000,
              hitPerPiece: 1.2, manaPerPiece: 9,  defence: { helm: 2, body: 5, legs: 4, gloves: 2, boots: 2 } },
  magister: { label: 'del Magister', level: 70, mdefFactor: 2.85, cloth: null,        craft: false, price: 60000,
              hitPerPiece: 1.6, manaPerPiece: 12, defence: { helm: 3, body: 7, legs: 5, gloves: 2, boots: 2 } },
};

// Nombres por hueco (arquero / mago)
export const ARCHER_PIECE_NAMES = { helm: 'Capucha', body: 'Chaqueta', legs: 'Pantalones', gloves: 'Guantes', boots: 'Botas' };
export const MAGE_PIECE_NAMES = { helm: 'Sombrero', body: 'Túnica', legs: 'Falda', gloves: 'Guantes', boots: 'Botas' };

// Cuánto material lleva cada pieza y nivel de Artesanía relativo al del juego
export const PIECE_COST = { gloves: 1, boots: 1, helm: 1, legs: 2, body: 3 };
export const MAGE_PIECE_COST = { gloves: 1, boots: 1, helm: 2, legs: 3, body: 4 };
export const PIECE_LEVEL_OFFSET = { gloves: 0, boots: 2, helm: 4, legs: 6, body: 8 };

const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

/** Material (último trozo del id) si es de uno de estos juegos. */
export function gearMaterial(itemId) {
  const m = String(itemId || '').split('_').pop();
  return (own(ARCHER_SETS, m) || own(MAGE_SETS, m)) ? m : null;
}

/** Requisito para equipar una pieza de estos juegos (o null). */
export function gearRequirement(itemId, equipSlot) {
  const m = gearMaterial(itemId);
  if (!m || (equipSlot && !GEAR_SLOTS.includes(equipSlot))) return null;
  if (own(ARCHER_SETS, m)) return { skill: 'ranged', level: ARCHER_SETS[m].level };
  const lvl = MAGE_SETS[m].level;
  return lvl > 1 ? { skill: 'magic', level: lvl } : null;
}

/** Factor de defensa mágica por material (para MAGIC_DEF_BY_MATERIAL). */
export const GEAR_MDEF_FACTORS = Object.fromEntries([
  ...Object.entries(ARCHER_SETS).map(([m, s]) => [m, s.mdefFactor]),
  ...Object.entries(MAGE_SETS).map(([m, s]) => [m, s.mdefFactor]),
]);

/**
 * Poder mágico de las túnicas puestas.
 * @param {string[]} itemIds  ids equipados (cualquier hueco)
 * @returns {{ hit: number, mana: number }}
 */
export function robeMagicBonus(itemIds) {
  let hit = 0, mana = 0;
  for (const id of itemIds || []) {
    const slot = String(id || '').split('_')[0];
    const m = gearMaterial(id);
    if (!m || !own(MAGE_SETS, m) || !GEAR_SLOTS.includes(slot)) continue;
    hit += MAGE_SETS[m].hitPerPiece;
    mana += MAGE_SETS[m].manaPerPiece;
  }
  // redondeo con margen (0,2 × 5 = 0,99999…)
  return { hit: Math.floor(hit + 1e-6), mana: Math.floor(mana + 1e-6) };
}
