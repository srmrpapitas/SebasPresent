/**
 * SebasPresent — Skills client module (Sesión 14)
 *
 * Cache local de los skills del player, sincronizado con el server.
 * Sesión 14 implementa la base; UI visual (tab Stats) llegará en sesión 15.
 *
 * Uso desde otros módulos:
 *   import * as skills from './skills.js';
 *   await skills.start({ apiBase, token });
 *   skills.getLevel('attack')           // → 1
 *   skills.getXp('attack')              // → 0
 *   skills.getTotalLevel()              // → 22
 *   skills.getCombatLevel()             // → 3
 *   await skills.grantXp('attack', 25)  // → { ok, level, level_up, ... }
 *
 * El cliente cachea los XPs y los actualiza tras cada grantXp. Si el
 * server devuelve un valor distinto, gana el server (single source of truth).
 *
 * Listeners de cambios:
 *   skills.onChange(callback) — se invoca tras cada update con el state nuevo.
 *   skills.onLevelUp(callback) — solo cuando hay level up (para jingle, splat).
 */

// ============================================================
// Constantes / estado
// ============================================================

// Catálogo local — debe coincidir con SKILLS del server/lib/skills_engine.js.
// Se duplica aquí para que la UI pueda renderizar incluso si el server
// no ha respondido todavía.
export const SKILL_DEFS = [
  { id: 'attack',      name: 'Ataque',    icon: '⚔️', combat: true,    startLvl: 1  },
  { id: 'strength',    name: 'Fuerza',    icon: '💪', combat: true,    startLvl: 1  },
  { id: 'defence',     name: 'Defensa',   icon: '🛡️', combat: true,    startLvl: 1  },
  { id: 'hitpoints',   name: 'Vitalidad', icon: '❤️', combat: true,    startLvl: 10 },
  { id: 'ranged',      name: 'Distancia', icon: '🏹', combat: true,    startLvl: 1  },
  { id: 'magic',       name: 'Magia',     icon: '✨', combat: true,    startLvl: 1  },
  { id: 'prayer',      name: 'Plegaria',  icon: '🙏', combat: true,    startLvl: 1  },
  { id: 'woodcutting', name: 'Tala',      icon: '🪓', gathering: true, startLvl: 1  },
  { id: 'fishing',     name: 'Pesca',     icon: '🎣', gathering: true, startLvl: 1  },
  { id: 'mining',      name: 'Minería',   icon: '⛏️', gathering: true, startLvl: 1  },
  { id: 'cooking',     name: 'Cocina',    icon: '🍳', gathering: true, startLvl: 1  },
  { id: 'firemaking',  name: 'Fuego',     icon: '🔥', gathering: true, startLvl: 1  },
  { id: 'smithing',    name: 'Herrería',  icon: '🔨', gathering: true, startLvl: 1  },
];

export const SKILL_DEFS_BY_ID = Object.fromEntries(SKILL_DEFS.map(s => [s.id, s]));

// Tabla XP→nivel OSRS (calculada igual que el server).
const MAX_LEVEL = 99;
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

export function xpToLevel(xp) {
  if (xp <= 0) return 1;
  if (xp >= XP_TABLE[MAX_LEVEL]) return MAX_LEVEL;
  for (let lvl = MAX_LEVEL; lvl >= 1; lvl--) {
    if (xp >= XP_TABLE[lvl]) return lvl;
  }
  return 1;
}

export function levelToXp(level) {
  if (level <= 1) return 0;
  if (level >= MAX_LEVEL) return XP_TABLE[MAX_LEVEL];
  return XP_TABLE[level];
}

// ============================================================
// Estado del módulo
// ============================================================
let apiBase = '';
let getToken = () => null;
let xpById = {};            // skill_id → xp
let totalLevelCached = 0;
let combatLevelCached = 0;
let started = false;

const changeListeners = [];
const levelUpListeners = [];

// ============================================================
// API pública
// ============================================================

/**
 * Arranca el módulo: carga skills del server y sincroniza estado local.
 * Opts: { apiBase, getToken } — getToken es función para evitar capturar
 * un valor stale (si el user re-loguea).
 */
export async function start(opts) {
  apiBase = opts.apiBase || '';
  getToken = opts.getToken || (() => null);
  await reload();
  started = true;
  console.log('[skills] start OK, total_level=', totalLevelCached, 'combat=', combatLevelCached);
}

/** Re-fetch desde server. Usar tras login o si sospechamos desync. */
export async function reload() {
  const res = await apiCall('GET', '/api/skills');
  if (!res.ok) {
    console.warn('[skills] reload failed:', res.error);
    return;
  }
  xpById = {};
  for (const s of (res.skills || [])) {
    xpById[s.id] = s.xp;
  }
  totalLevelCached = res.total_level || 0;
  combatLevelCached = res.combat_level || 3;
  notifyChange();
}

export function getXp(skillId) {
  return xpById[skillId] || 0;
}

export function getLevel(skillId) {
  return xpToLevel(getXp(skillId));
}

export function getAllLevels() {
  const out = {};
  for (const def of SKILL_DEFS) out[def.id] = getLevel(def.id);
  return out;
}

export function getTotalLevel() {
  return totalLevelCached;
}

export function getCombatLevel() {
  return combatLevelCached;
}

/**
 * Solicita al server que sume delta XP al skill. El server valida + devuelve
 * el nuevo estado. Si hubo level up, se notifica a listeners.
 */
export async function grantXp(skillId, delta) {
  const res = await apiCall('POST', '/api/skills/grant', { skill_id: skillId, xp: delta });
  if (!res.ok) {
    console.warn(`[skills] grantXp(${skillId}, ${delta}) failed:`, res.error);
    return res;
  }
  const prevLevel = res.prev_level || 1;
  xpById[skillId] = res.xp;
  // Recalcular total (level can affect total)
  totalLevelCached = 0;
  for (const def of SKILL_DEFS) totalLevelCached += getLevel(def.id);
  notifyChange();
  if (res.level_up) {
    for (const cb of levelUpListeners) {
      try { cb({ skillId, prevLevel, newLevel: res.level, levelsGained: res.levels_gained }); }
      catch (err) { console.warn('[skills] levelUp listener err:', err); }
    }
  }
  return res;
}

/** Listener de cambios cualquier (XP gain incluso sin level up). */
export function onChange(cb) {
  changeListeners.push(cb);
  return () => {
    const i = changeListeners.indexOf(cb);
    if (i >= 0) changeListeners.splice(i, 1);
  };
}

/** Listener específico de level ups (para jingle, FX visual). */
export function onLevelUp(cb) {
  levelUpListeners.push(cb);
  return () => {
    const i = levelUpListeners.indexOf(cb);
    if (i >= 0) levelUpListeners.splice(i, 1);
  };
}

export function isStarted() {
  return started;
}

// ============================================================
// Internals
// ============================================================
function notifyChange() {
  for (const cb of changeListeners) {
    try { cb(); } catch (err) { console.warn('[skills] change listener err:', err); }
  }
}

async function apiCall(method, path, body) {
  const token = getToken();
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  try {
    const res = await fetch(`${apiBase}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { ok: false, error: data.error || `HTTP ${res.status}` };
    }
    return { ok: true, ...data };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}
