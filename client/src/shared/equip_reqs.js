/**
 * SebasPresent — Requisitos para equipar (Sesión 50)
 *
 * MÓDULO COMPARTIDO cliente + servidor. Estilo OSRS:
 *   - Espadas / espadones → nivel de ATAQUE según el material.
 *   - Armaduras y escudos  → nivel de DEFENSA según el material.
 *   - Algunos items sueltos (arcos buenos) → tabla BY_ITEM.
 * El server lo comprueba en /api/equipment/equip; el cliente lo enseña al
 * examinar y en el libro de skills.
 */

export const EQUIP_LEVEL = {
  bronze: 1, hierro: 5, acero: 10, oro: 20, obsidiana: 30, basaltita: 40, teiderio: 60,
};

export const SKILL_NAMES = { attack: 'Ataque', defence: 'Defensa', ranged: 'Distancia', magic: 'Magia' };

const ARMOR_SLOTS = new Set(['helm', 'body', 'legs', 'boots', 'gloves', 'shield']);
const MELEE_TYPES = new Set(['1h_sword', '2h_sword']);

// Items concretos sin material (o con requisito propio)
const BY_ITEM = {
  bow_oak:    { skill: 'ranged', level: 10 },
  bow_willow: { skill: 'ranged', level: 20 },   // Sesión 50 — arcos de Flechería
  bow_maple:  { skill: 'ranged', level: 30 },
  bow_yew:    { skill: 'ranged', level: 40 },
  bow_magic:  { skill: 'ranged', level: 50 },
};

export function materialFromId(itemId) {
  const m = String(itemId || '').replace(/_2h$/, '').split('_').pop();
  return Object.prototype.hasOwnProperty.call(EQUIP_LEVEL, m) ? m : null;
}

/**
 * @param {{ id?: string, item_id?: string, equip_slot?: string, weapon_type?: string, material?: string }} item
 * @returns {{ skill: string, level: number } | null}  null = sin requisito
 */
export function equipRequirement(item) {
  if (!item) return null;
  const id = item.id || item.item_id;
  if (BY_ITEM[id]) return BY_ITEM[id];
  const mat = (item.material && EQUIP_LEVEL[item.material] != null) ? item.material : materialFromId(id);
  if (!mat) return null;
  const level = EQUIP_LEVEL[mat];
  if (level <= 1) return null;
  const melee = MELEE_TYPES.has(item.weapon_type) || (!item.weapon_type && /^sword_/.test(id || ''));
  if (item.equip_slot === 'weapon' && melee) return { skill: 'attack', level };
  if (ARMOR_SLOTS.has(item.equip_slot)) return { skill: 'defence', level };
  return null;
}

export function requirementText(req) {
  return req ? `nivel ${req.level} de ${SKILL_NAMES[req.skill] || req.skill}` : '';
}
