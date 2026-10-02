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
  dragon: 60,   // Sesión 50 — no se fabrica: la sueltan los jefes (1/20)
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
  bow_dragon: { skill: 'ranged', level: 60 },        // Sesión 50 — arco de garras de dragón
  staff_dragomante: { skill: 'magic', level: 60 },  // Sesión 50 — bastón de Dragomante
  // Sesión 51 — armas legendarias
  gs_achaman:    { skill: 'attack', level: 75 },
  gs_tibicena:   { skill: 'attack', level: 75 },
  gs_magec:      { skill: 'attack', level: 75 },
  gs_guayota:    { skill: 'attack', level: 75 },
  sword_tindaya: { skill: 'attack', level: 78 },
  claws_dragon:  { skill: 'attack', level: 60 },
  dagger_dragon: { skill: 'attack', level: 60 },
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

// ------------------------------------------------------------
// Sesión 51 — Ataques especiales estilo OSRS, uno por arma (de oro para
// arriba + arcos/bastones buenos). Campos:
//   cost     energía (barra 100, +10 cada 30 s)
//   hits     nº de golpes (rolls independientes)      dmg   multiplicador de daño
//   acc      precisión (divide la defensa del rival)  heal  % del daño que te curas
//   minHit   daño mínimo por golpe (garantizado)      minFrac  mínimo = % del golpe máx.
//   claws    cascada de 4 zarpazos (X, X/2, X/4, X/4+1)
//   magic    se aplica al próximo hechizo (bastones)  fx  estilo visual del cliente
// ------------------------------------------------------------
export const WEAPON_SPECS = {
  sword_oro:          { name: 'Puñalada doble',   osrs: 'Daga de dragón',      cost: 25, hits: 2, dmg: 1.15, acc: 1.25, fx: 'double',
                        desc: 'Dos golpes seguidos con +15 % de daño y +25 % de precisión.' },
  sword_obsidiana:    { name: 'Tajo de obsidiana', osrs: 'Espada larga de dragón', cost: 25, hits: 1, dmg: 1.25, acc: 1, fx: 'cleave',
                        desc: 'Un tajo con +25 % de daño.' },
  sword_basaltita:    { name: 'Garras de magma',  osrs: 'Garras de dragón',     cost: 50, claws: true, acc: 1.25, fx: 'magmaclaws', burn: 0.2,
                        desc: 'Cuatro zarpazos de magma en cascada y el enemigo ARDE: quemadura extra del 20 % del daño hecho.' },
  sword_teiderio:     { name: 'Finta de Echeyde', osrs: 'Espada larga de Vesta', cost: 25, hits: 1, dmg: 1.2, acc: 1.5, minFrac: 0.2, fx: 'feint',
                        desc: '+20 % de daño, +50 % de precisión y nunca pega menos del 20 % del golpe máximo.' },
  sword_oro_2h:       { name: 'Golpe aplastante', osrs: 'Martillo de dragón',   cost: 50, hits: 1, dmg: 1.5, acc: 1, fx: 'smash',
                        desc: 'Un golpe con +50 % de daño.' },
  sword_obsidiana_2h: { name: 'Hoja de Guayota',  osrs: 'Espadón de Bandos',    cost: 50, hits: 1, dmg: 1.21, acc: 2, fx: 'gs',
                        desc: '+21 % de daño y precisión doble.' },
  sword_basaltita_2h: { name: 'Magma vital',      osrs: 'Espadón de Saradomin', cost: 50, hits: 1, dmg: 1.1, acc: 2, heal: 0.5, fx: 'heal',
                        desc: '+10 % de daño, precisión doble y te curas la mitad del daño hecho.' },
  sword_teiderio_2h:  { name: 'Juicio del Teide', osrs: 'Espadón de Armadyl',   cost: 50, hits: 1, dmg: 1.375, acc: 2, fx: 'gs',
                        desc: '+37,5 % de daño y precisión doble.' },
  bow_magic:          { name: 'Disparo rápido',   osrs: 'Arco corto mágico',    cost: 55, hits: 2, dmg: 1, acc: 1, fx: 'snapshot',
                        desc: 'Dos flechas casi a la vez.' },
  bow_dragon:         { name: 'Aliento del dragón', osrs: 'Arco oscuro',        cost: 55, hits: 2, dmg: 1.5, minHit: 4, acc: 1, fx: 'dragon',
                        desc: 'Dos cabezas de dragón en llamas, cada una ×1,5 y mínimo 4 de daño.' },
  staff_normal:       { name: 'Descarga arcana',  osrs: 'Bastón volátil',       cost: 50, hits: 1, dmg: 1.25, acc: 1.25, magic: true, fx: 'arcane',
                        desc: 'El próximo hechizo pega +25 % y acierta +25 %.' },
  staff_dragomante:   { name: 'Cubo de sangre',   osrs: 'Barrera de sangre + hielo', cost: 55, hits: 1, dmg: 1.3, acc: 1.5, magic: true, heal: 1.0, freezeMs: 8000, fx: 'bloodcube',
                        desc: 'El próximo hechizo encierra al enemigo en un cubo de hielo de sangre: lo congela 8 s y te cura todo el daño que hace.' },
  // Sesión 51 — armas legendarias (mitología guanche)
  gs_achaman:         { name: 'Juicio de Achamán', cost: 50, hits: 1, dmg: 1.2, acc: 1.55, crit: 0.75, fx: 'gs',
                        desc: '+55 % de precisión, +20 % de daño y 75 % de golpe CRÍTICO (×1,5): los golpes más grandes del juego, según tu Fuerza y el equipo de fuerza.' },
  gs_tibicena:        { name: 'Mordisco de Tibicena', cost: 50, hits: 1, dmg: 1.1, acc: 1.5, defDrain: true, fx: 'gs',
                        desc: '+50 % de precisión y +10 % de daño. Le baja al enemigo tanta Defensa como daño le hagas (1 min).' },
  gs_magec:           { name: 'Luz de Magec', cost: 50, hits: 1, dmg: 1.1, acc: 2, heal: 1.0, fx: 'heal',
                        desc: '+10 % de daño, precisión doble y te curas TODO el daño que haces.' },
  gs_guayota:         { name: 'Prisión de Guayota', cost: 50, hits: 1, dmg: 1.1, acc: 2, freezeMs: 10000, fx: 'gs',
                        desc: '+10 % de daño, precisión doble y congela al enemigo 10 s en un bloque de obsidiana.' },
  sword_tindaya:      { name: 'Rayo de Tindaya', cost: 25, hits: 1, dmg: 1.2, acc: 1.5, minFrac: 0.2, fx: 'feint', magicDmg: true,
                        desc: 'Un rayo: acierta con tu ataque cuerpo a cuerpo (+50 % de precisión) pero el daño es MÁGICO (+20 %, mínimo el 20 % del golpe máximo): pega más fuerte contra armaduras de metal y menos contra cuero y capas de mago.' },
  claws_dragon:       { name: 'Tajo de cuatro garras', cost: 50, claws: true, acc: 1.25, fx: 'claws',
                        desc: 'Cuatro zarpazos en cascada: el golpe, la mitad, un cuarto y un cuarto +1.' },
  dagger_dragon:      { name: 'Puñalada doble', cost: 25, hits: 2, dmg: 1.15, acc: 1.25, fx: 'double',
                        desc: 'Dos puñaladas seguidas con +15 % de daño y +25 % de precisión.' },
};
// Compat (Sesión 50)
export const DRAGON_SPEC_MULT = 1.5;
export const DRAGON_SPEC_MIN_HIT = 4;
export const DRAGON_SPEC_COST = 55;

export function specialOf(itemId) {
  return (itemId && WEAPON_SPECS[itemId]) || null;
}
export function hasSpecialAttack(itemId) {
  return !!specialOf(itemId);
}

/**
 * Resuelve un especial. roll(acc) → {hit, damage} (ya con la precisión
 * aplicada); mult(hitRes) → {dmg, crit} (multiplicadores normales del arma).
 * baseMax = golpe máximo normal (para minFrac). Devuelve {hits:[...], crit}.
 */
export function resolveSpecial(spec, roll, mult, baseMax = 0) {
  const acc = spec.acc || 1;
  let crit = false;
  const one = () => {
    const h = roll(acc);
    const m = mult(h, spec.crit);   // Sesión 51 — spec.crit: probabilidad de crítico propia
    crit = crit || !!m.crit;
    let d = h.hit ? Math.floor(m.dmg * (spec.dmg || 1)) : 0;
    if (spec.minHit) d = Math.max(spec.minHit, d);
    if (spec.minFrac && h.hit) d = Math.max(d, Math.floor(baseMax * spec.minFrac));
    return d;
  };
  if (spec.claws) {
    // OSRS: si el 1º falla prueba el 2º; si los dos fallan → 0,0,1,1
    let first = one();
    if (!first) first = one();
    if (!first) return { hits: [0, 0, 1, 1], crit };
    const q = Math.floor(first / 4);
    return { hits: [first, Math.floor(first / 2), q, q + 1], crit };
  }
  const hits = [];
  for (let i = 0; i < (spec.hits || 1); i++) hits.push(one());
  return { hits, crit };
}

/** Recorta los golpes en orden para que no sumen más que `total`. */
export function clipSpecHits(hits, total) {
  let left = total;
  return hits.map(h => { const v = Math.max(0, Math.min(h, left)); left -= v; return v; });
}

// Sesión 51 — DEFENSA MÁGICA de cada pieza. No hay columna en items: sale
// del material × su defensa. El metal conduce la magia (resta), el cuero de
// arquero y las capas de mago la frenan (suman).
const MAGIC_DEF_BY_MATERIAL = {
  cuero: 2.4, mago: 6,
  cotton: 1, cotton_linen: 1, linen: 1, linen_silk: 1.2, silk: 1.4, polyester: 1, polyester_cotton: 1,
  earth: 1, ice: 1.2, lava: 1, fire: 0.6, magma: 0.7,
  bronze: -0.3, hierro: -0.3, acero: -0.3, oro: -0.25, obsidiana: -0.25, basaltita: -0.25, teiderio: -0.25, dragon: -0.15,
};
export function magicDefOf(material, defenceBonus) {
  const f = MAGIC_DEF_BY_MATERIAL[material];
  return f == null ? 0 : Math.round((defenceBonus || 0) * f);
}
/** Multiplicador del daño MÁGICO según la defensa mágica total del objetivo (0,55–1,4). */
export function magicDamageMult(magicDef) {
  return Math.max(0.55, Math.min(1.4, 1 - (magicDef || 0) / 120));
}

// Sesión 51 — capas de mago: +golpe máximo de los hechizos
export const CAPE_MAGIC_BONUS = { cape_achaman: 2, cape_magec: 2, cape_chaxiraxi: 2 };

// Bonus de magia de bastones (se suma al golpe máximo del hechizo y al maná).
export const STAFF_MAGIC_BONUS = { staff_dragomante: 5 };
export const STAFF_MANA_EXTRA = { staff_dragomante: 60 };

// Equipo de dragón (lo sueltan los jefes, 1/20 cada uno su pieza)
export const DRAGON_ITEMS = ['helm_dragon', 'body_dragon', 'legs_dragon', 'boots_dragon', 'gloves_dragon', 'shield_dragon', 'staff_dragomante', 'bow_dragon'];
