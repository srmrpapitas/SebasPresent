/**
 * SebasPresent — Plegaria (Sesión 50)
 *
 * MÓDULO COMPARTIDO cliente + servidor (puro).
 *
 *   - Enterrar huesos → XP de Plegaria.
 *   - Puntos de plegaria: máximo = nivel de Plegaria. Se recargan en un altar.
 *   - Plegarias activas gastan puntos con el tiempo (drain por minuto).
 *     El gasto se calcula "perezoso": puntos_ahora = puntos - drain × tiempo.
 *   - Solo una plegaria activa por grupo (group) — como en OSRS no puedes
 *     tener dos de defensa a la vez.
 *
 * Efectos (los aplica combat_engine):
 *   def/str/atk/rng/mag: % extra al nivel efectivo de esa stat.
 *   protectMelee: los NPCs no te hacen daño cuerpo a cuerpo; en PvP −40 %.
 *   rapidHeal: la regeneración pasiva de vida va el doble de rápido.
 */

export const BONES = {
  bones: { xp: 5, name: 'Huesos' },
};

export const PRAYERS = [
  { id: 'thick_skin',     name: 'Piel gruesa',          level: 1,  drain: 5,  group: 'def', def: 0.05, icon: '🛡', desc: '+5 % Defensa' },
  { id: 'burst_strength', name: 'Arrebato de fuerza',   level: 4,  drain: 5,  group: 'str', str: 0.05, icon: '💪', desc: '+5 % Fuerza' },
  { id: 'clarity',        name: 'Claridad mental',      level: 7,  drain: 5,  group: 'atk', atk: 0.05, icon: '🎯', desc: '+5 % Ataque' },
  { id: 'sharp_eye',      name: 'Ojo agudo',            level: 8,  drain: 5,  group: 'rng', rng: 0.05, icon: '🏹', desc: '+5 % Distancia' },
  { id: 'mystic_will',    name: 'Voluntad mística',     level: 9,  drain: 5,  group: 'mag', mag: 0.05, icon: '✨', desc: '+5 % Magia' },
  { id: 'rock_skin',      name: 'Piel de roca',         level: 10, drain: 10, group: 'def', def: 0.10, icon: '🪨', desc: '+10 % Defensa' },
  { id: 'superhuman',     name: 'Fuerza sobrehumana',   level: 13, drain: 10, group: 'str', str: 0.10, icon: '🦾', desc: '+10 % Fuerza' },
  { id: 'reflexes',       name: 'Reflejos mejorados',   level: 16, drain: 10, group: 'atk', atk: 0.10, icon: '⚡', desc: '+10 % Ataque' },
  { id: 'rapid_heal',     name: 'Curación rápida',      level: 22, drain: 3,  group: 'heal', rapidHeal: true, icon: '💚', desc: 'Regeneras vida el doble de rápido' },
  { id: 'hawk_eye',       name: 'Ojo de halcón',        level: 26, drain: 10, group: 'rng', rng: 0.10, icon: '🦅', desc: '+10 % Distancia' },
  { id: 'mystic_lore',    name: 'Saber místico',        level: 27, drain: 10, group: 'mag', mag: 0.10, icon: '🔮', desc: '+10 % Magia' },
  { id: 'steel_skin',     name: 'Piel de acero',        level: 28, drain: 20, group: 'def', def: 0.15, icon: '⚙', desc: '+15 % Defensa' },
  { id: 'ultimate_str',   name: 'Fuerza suprema',       level: 31, drain: 20, group: 'str', str: 0.15, icon: '🔥', desc: '+15 % Fuerza' },
  { id: 'incredible_ref', name: 'Reflejos increíbles',  level: 34, drain: 20, group: 'atk', atk: 0.15, icon: '🌟', desc: '+15 % Ataque' },
  { id: 'protect_melee',  name: 'Protección cuerpo a cuerpo', level: 43, drain: 20, group: 'protect', protectMelee: true, icon: '⚔', desc: 'Los monstruos no te dañan cuerpo a cuerpo (PvP: −40 %)' },
];

export const PRAYERS_BY_ID = Object.fromEntries(PRAYERS.map(p => [p.id, p]));

// Altares (recargan los puntos). El server valida la distancia.
export const ALTARS = [
  { id: 'altar_concejo', name: 'Altar del Concejo', x: -38, z: -92 },
  { id: 'altar_templo',  name: 'Altar del Templo de la Luz', x: 0, z: -1182 },
];
export const ALTAR_USE_DIST_M = 4.0;

/** Lista de ids activos a partir del texto guardado ("a,b,c"). */
export function parseActive(str) {
  return String(str || '').split(',').filter(id => PRAYERS_BY_ID[id]);
}

/** Drain total (puntos por minuto) de un conjunto de plegarias. */
export function drainPerMin(activeIds) {
  return activeIds.reduce((t, id) => t + (PRAYERS_BY_ID[id]?.drain || 0), 0);
}

/**
 * Estado actual: puntos que quedan tras el gasto desde updatedAt.
 * Si llegan a 0, todas las plegarias se apagan.
 */
export function currentPrayerState(points, updatedAt, activeStr, now) {
  const active = parseActive(activeStr);
  const drain = drainPerMin(active);
  let pts = Number.isFinite(points) ? points : 0;
  if (drain > 0 && updatedAt) {
    pts = pts - drain * Math.max(0, now - updatedAt) / 60000;
  }
  if (pts <= 0) return { points: 0, active: [] };
  return { points: pts, active };
}

/** Efectos combinados de las plegarias activas. */
export function prayerEffects(activeIds) {
  const e = { atk: 0, str: 0, def: 0, rng: 0, mag: 0, protectMelee: false, rapidHeal: false };
  for (const id of activeIds) {
    const p = PRAYERS_BY_ID[id];
    if (!p) continue;
    for (const k of ['atk', 'str', 'def', 'rng', 'mag']) if (p[k]) e[k] += p[k];
    if (p.protectMelee) e.protectMelee = true;
    if (p.rapidHeal) e.rapidHeal = true;
  }
  return e;
}
