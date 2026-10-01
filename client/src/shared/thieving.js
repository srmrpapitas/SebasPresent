/**
 * SebasPresent — Robo (pickpocket), estilo OSRS (Sesión 50)
 *
 * MÓDULO COMPARTIDO cliente + servidor. Habilidad: 'thieving' (Robo).
 *
 * Probabilidad de que te pillen (regla de Nico):
 *   · Necesitas al menos el nivel del objetivo.
 *   · A su mismo nivel te pillan el 50 % de las veces.
 *   · Baja hasta 0 % cuando le sacas (4 + nivel/2) niveles.
 *     Ej.: robar a un vecino (nivel 1): nivel 1 → 50 %, nivel 5 → 0 %.
 *   · A JUGADORES: desde nivel 50 de Robo. 50 % a nivel 50 → 0 % a nivel 99.
 * Si te pillan: los guardias de la zona te atacan (te persiguen hasta que
 * huyes lejos) y no puedes volver a robar en unos segundos.
 * Siempre se roba de la MOCHILA, nunca de lo equipado.
 */

export const THIEF_SKILL = 'thieving';
export const PLAYER_STEAL_LEVEL = 50;
export const STEAL_DIST_M = 3.0;            // cliente
export const STEAL_DIST_SERVER_M = 6.0;      // server (posición con retraso)
export const STEAL_COOLDOWN_MS = 1500;
export const CAUGHT_LOCK_MS = 6000;           // tras pillarte, sin robar

// Perfiles: nivel, XP y botín [item, min, max, peso]
export const PROFILES = {
  vecino:     { name: 'vecino',      level: 1,  xp: 8,   loot: [['coins', 3, 15, 6], ['pan', 1, 1, 4]] },
  pastor:     { name: 'pastor',      level: 5,  xp: 15,  loot: [['coins', 5, 20, 4], ['pan', 1, 2, 3], ['gofio', 1, 1, 3], ['cooked_chicken', 1, 1, 2]] },
  artesano:   { name: 'artesano',    level: 15, xp: 30,  loot: [['coins', 15, 50, 5], ['knife', 1, 1, 1], ['leather', 1, 3, 2], ['cooked_beef', 1, 1, 2]] },
  herbolaria: { name: 'herbolaria',  level: 25, xp: 45,  loot: [['hierba_tabaiba', 1, 2, 4], ['hierba_retama', 1, 1, 2], ['vial_agua', 1, 3, 3], ['pocion_ataque_3', 1, 1, 1], ['coins', 20, 60, 3]] },
  guardia:    { name: 'guardia',     level: 35, xp: 60,  loot: [['coins', 30, 90, 5], ['sword_bronze', 1, 1, 1], ['cooked_beef', 1, 2, 3], ['pocion_fuerza_3', 1, 1, 1]] },
  mago:       { name: 'mago',        level: 45, xp: 80,  loot: [['tele_concejo', 1, 1, 4], ['tele_faro', 1, 1, 2], ['tele_mina', 1, 1, 1], ['coins', 40, 120, 3], ['pocion_plegaria_3', 1, 1, 1]] },
  mercader:   { name: 'mercader',    level: 55, xp: 100, loot: [['coins', 80, 250, 6], ['shark', 1, 1, 2], ['pocion_defensa_3', 1, 1, 1]] },
  banquero:   { name: 'banquero',    level: 70, xp: 150, loot: [['coins', 200, 600, 8], ['super_ataque_3', 1, 1, 1], ['super_fuerza_3', 1, 1, 1]] },
};

// Qué perfil tiene cada habitante (los que no salen aquí: vecino)
export const NPC_PROFILE = {
  rosa_granjera: 'pastor', petra_abuela: 'vecino', yeray_pastor: 'pastor', abuelo_guayre: 'pastor', tomas_pescador: 'pastor',
  joaquin_lenador: 'pastor', bruno_cazador: 'pastor', abuela_lola: 'vecino', explorador_herido: 'vecino',
  lia_artesana: 'artesano', brom_herrero: 'artesano', gus_minero: 'artesano', nuria_herrera: 'artesano', ramiro_capataz: 'artesano',
  irene_farera: 'artesano', pregonero: 'artesano', cronista_elena: 'artesano', maestro_rafael: 'artesano', dona_carmen: 'artesano',
  carmita_aso: 'herbolaria', alma_sacerdotisa: 'herbolaria', ermitano_candelaria: 'herbolaria',
  guardia_concejo: 'guardia', sven_guardia: 'guardia', kargath: 'guardia', airam_forzudo: 'guardia',
  morgana_maga: 'mago', eldric_mago: 'mago',
  samir_mercader: 'mercader', tanausu_cuadra: 'mercader', nauzet_inmobiliaria: 'mercader', alcalde_faustino: 'mercader', guia_aldric: 'mercader',
  yaiza_comidas: 'artesano', gara_pieles: 'artesano', bentejui_ferretero: 'artesano', fayna_pescadera: 'artesano',
  echedey_armero: 'mercader', guacimara_flechas: 'mercader',
  banquero_gerardo: 'banquero', banquera_dacil: 'banquero', banquero_acaymo: 'banquero', banquera_cathaysa: 'banquero',
};

export function profileOf(npcId) { return PROFILES[NPC_PROFILE[npcId] || 'vecino']; }

/** Probabilidad (0..0.5) de que te pillen, o null si no tienes nivel. */
export function catchChance(myLevel, targetLevel) {
  if (myLevel < targetLevel) return null;
  const span = 4 + Math.floor(targetLevel / 2);
  return Math.max(0, 0.5 * (1 - (myLevel - targetLevel) / span));
}
export function playerCatchChance(myLevel) {
  if (myLevel < PLAYER_STEAL_LEVEL) return null;
  return Math.max(0, 0.5 * (1 - (myLevel - PLAYER_STEAL_LEVEL) / (99 - PLAYER_STEAL_LEVEL)));
}
export const PLAYER_STEAL_XP = 120;

/** Elige botín con pesos → [item, qty] */
export function rollLoot(profile, rng = Math.random) {
  const tot = profile.loot.reduce((a, l) => a + l[3], 0);
  let r = rng() * tot;
  for (const [id, mn, mx, w] of profile.loot) {
    if ((r -= w) <= 0) return [id, mn + Math.floor(rng() * (mx - mn + 1))];
  }
  const l = profile.loot[0]; return [l[0], l[1]];
}
