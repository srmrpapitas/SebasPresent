/**
 * SebasPresent — Herbología y pociones (Sesión 50)
 *
 * MÓDULO COMPARTIDO cliente + servidor.
 * Las hierbas son plantas canarias y se compran en LA ASO (La Laguna), la
 * herboristería de Carmita. Hierba + vial de agua (+ gofio para las súper)
 * = poción de 3 dosis. Cada dosis sube un nivel de combate durante un rato,
 * como en OSRS; la de plegaria recupera puntos.
 */

export const POTION_BOOST_MS = 5 * 60 * 1000;   // cada trago dura 5 minutos

// Hierbas: [id, nombre]
export const HERBS = [
  ['hierba_tabaiba', 'Tabaiba'],
  ['hierba_verode', 'Verode'],
  ['hierba_salvia', 'Salvia canaria'],
  ['hierba_oregano', 'Orégano de risco'],
  ['hierba_retama', 'Retama del Teide'],
  ['hierba_tajinaste', 'Tajinaste rojo'],
];

// Pociones: base (sin _3/_2/_1), nombre, hierba, gofio?, nivel, xp, efecto
//   boost: { skill, flat, pct }  → nivel + flat + pct·nivel
//   prayer: { flat, pct }        → recupera puntos de plegaria
export const POTIONS = [
  { id: 'pocion_ataque',    name: 'Poción de ataque',      herb: 'hierba_tabaiba',   gofio: false, level: 1,  xp: 25,  boost: { skill: 'attack', flat: 3, pct: 0.10 } },
  { id: 'pocion_fuerza',    name: 'Poción de fuerza',      herb: 'hierba_verode',    gofio: false, level: 8,  xp: 40,  boost: { skill: 'strength', flat: 3, pct: 0.10 } },
  { id: 'pocion_defensa',   name: 'Poción de defensa',     herb: 'hierba_salvia',    gofio: false, level: 18, xp: 55,  boost: { skill: 'defence', flat: 3, pct: 0.10 } },
  { id: 'pocion_distancia', name: 'Poción de distancia',   herb: 'hierba_oregano',   gofio: false, level: 28, xp: 70,  boost: { skill: 'ranged', flat: 4, pct: 0.10 } },
  { id: 'pocion_plegaria',  name: 'Poción de plegaria',    herb: 'hierba_retama',    gofio: false, level: 35, xp: 85,  prayer: { flat: 7, pct: 0.25 } },
  { id: 'pocion_magia',     name: 'Poción de magia',       herb: 'hierba_tajinaste', gofio: false, level: 42, xp: 100, boost: { skill: 'magic', flat: 4, pct: 0.10 } },
  { id: 'super_ataque',     name: 'Súper ataque',          herb: 'hierba_tabaiba',   gofio: true,  level: 50, xp: 125, boost: { skill: 'attack', flat: 5, pct: 0.15 } },
  { id: 'super_fuerza',     name: 'Súper fuerza',          herb: 'hierba_verode',    gofio: true,  level: 58, xp: 140, boost: { skill: 'strength', flat: 5, pct: 0.15 } },
  { id: 'super_defensa',    name: 'Súper defensa',         herb: 'hierba_salvia',    gofio: true,  level: 66, xp: 160, boost: { skill: 'defence', flat: 5, pct: 0.15 } },
];
export const POTIONS_BY_ID = Object.fromEntries(POTIONS.map(p => [p.id, p]));

/** Recetas para shared/crafting.js (skill 'herblore'). */
export const HERBLORE_RECIPES = POTIONS.map(p => ({
  id: `mix_${p.id}`, skill: 'herblore', group: p.gofio ? 'Súper pociones' : 'Pociones', name: `${p.name} (3)`,
  level: p.level, xp: p.xp, tool: null,
  in: [[p.herb, 1], ['vial_agua', 1], ...(p.gofio ? [['gofio', 1]] : [])],
  out: [`${p.id}_3`, 1],
}));

/** item_id de una dosis → { potion, doses } o null. */
export function parsePotion(itemId) {
  const m = /^(.+)_([123])$/.exec(String(itemId || ''));
  if (!m || !POTIONS_BY_ID[m[1]]) return null;
  return { potion: POTIONS_BY_ID[m[1]], doses: Number(m[2]) };
}

/** Subida de nivel de una poción para un nivel base. */
export function boostAmount(potion, baseLevel) {
  if (!potion.boost) return 0;
  return potion.boost.flat + Math.floor(baseLevel * potion.boost.pct);
}

/**
 * Subidas activas desde el texto guardado en combat_stats.boosts
 * ('{"attack":{"v":8,"until":123}}'). Devuelve { attack: n, ... }.
 */
export function activeBoosts(boostsStr, now) {
  const out = { attack: 0, strength: 0, defence: 0, ranged: 0, magic: 0 };
  if (!boostsStr) return out;
  let o;
  try { o = JSON.parse(boostsStr); } catch { return out; }
  for (const k of Object.keys(out)) {
    const b = o?.[k];
    if (b && b.until > now) out[k] = b.v | 0;
  }
  return out;
}
