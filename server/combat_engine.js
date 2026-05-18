/**
 * SebasPresent — Combat Engine (Slice 5a + Sesión 16 unification)
 *
 * SESIÓN 16: tras cada attackNpc/respawnUser, los 4 XPs (attack, strength,
 * defence, hp) se replican a la tabla user_skills (skill_id ∈
 * {attack, strength, defence, hitpoints}). Esto permite que el tab Stats
 * y cualquier futuro consumer lean SIEMPRE de user_skills como single
 * source of truth para los 13 skills, sin tocar el resto del engine.
 *
 * Patron consistente con ge_engine.js:
 *   - Habla con un objeto `db` con la interfaz
 *     {first(sql, params), all(sql, params), run(sql, params)}.
 *   - RNG y reloj inyectables para tests deterministicos.
 *
 * FUNCIONES PUBLICAS:
 *   - getCombatState(db, userId, opts)
 *   - attackNpc(db, userId, npcInstanceId, opts)
 *   - respawnUser(db, userId, opts)
 *   - reviveExpiredNpcs(db, opts)
 *
 * INVARIANTES:
 *   - I1: hp_current <= levelFromXp(hp_xp)
 *   - I2: combat_stats.last_attack_at solo aumenta
 *   - I3: si NPC muere por el hit del user, NPC no contraataca
 *   - I4: XP solo si user damage > 0
 *   - I5 (sesión 16): user_skills.xp >= combat_stats.<skill>_xp para los
 *        4 skills de combat tras cada update. La condición es ≥ (no =)
 *        porque user_skills puede haber recibido XP extra vía /api/skills/grant.
 */

const XP_TABLE = [
  0,         83,        174,       276,       388,       512,       650,       801,       969,       1154,
  1358,      1584,      1833,      2107,      2411,      2746,      3115,      3523,      3973,      4470,
  5018,      5624,      6291,      7028,      7842,      8740,      9730,      10824,     12031,     13363,
  14833,     16456,     18247,     20224,     22406,     24815,     27473,     30408,     33648,     37224,
  41171,     45529,     50339,     55649,     61512,     67983,     75127,     83014,     91721,     101333,
  111945,    123660,    136594,    150872,    166636,    184040,    203254,    224466,    247886,    273742,
  302288,    333804,    368599,    407015,    449428,    496254,    547953,    605032,    668051,    737627,
  814445,    899257,    992895,    1096278,   1210421,   1336443,   1475581,   1629200,   1798808,   1986068,
  2192818,   2421087,   2673114,   2951373,   3258594,   3597792,   3972294,   4385776,   4842295,   5346332,
  5902831,   6517253,   7195629,   7944614,   8771558,   9684577,   10692629,  11805606,  13034431
];

// Sesión 25 — TICK_MS legacy (fallback). El cooldown REAL ahora depende
// del arma equipada (ATTACK_SPEEDS_BY_WEAPON_TYPE) y el stance
// (STANCE_MODIFIERS). TICK_MS se usa como fallback si falta info.
const TICK_MS = 900;
const RANGE_TOLERANCE = 0.8;
// Sesión 26 — 3.0 funciona estilo OSRS: el cliente reduce el patrol
// visual a 0.8 unidades, así la posición visible del NPC nunca está más
// de 0.8 del center. Margen 3.0 = orbit (0.8) + tolerance (0.8) + buffer
// para el player walking (1.4). Si alguna vez vuelve a salir
// "fuera de alcance" en condiciones normales, subir esto antes que el
// orbit del cliente.
const MELEE_MAX_RANGE = 3.0;
const MAX_LEVEL = 99;
const XP_PER_DMG_PER_SKILL = 4 / 3;

// ============================================================
// Sesión 26 — Velocidades y daño por arma + modificadores por stance
// ============================================================

/**
 * Cooldown BASE entre ataques, en milisegundos, por weapon_type.
 * Sobre esto se aplica el speed_mult del stance.
 */
const ATTACK_SPEEDS_BY_WEAPON_TYPE = {
  '1h_sword': 1250,
  '2h_sword': 2500,
  'staff':    2500,
  'bow':      1150,
  'unarmed':  1250,
};

/**
 * Multiplicadores BASE de damage del arma sobre el roll del player.
 * 2H pega 1.5× más fuerte que 1H.
 */
const WEAPON_DAMAGE_MULT = {
  '1h_sword': 1.0,
  '2h_sword': 1.5,
  'staff':    1.0,
  'bow':      1.0,
  'unarmed':  1.0,
};

/**
 * Probabilidad (0-1) de que un golpe sea CRIT automático.
 * Solo el 2H tiene crit auto (25%). El staff explícitamente NO crit.
 * Crit multiplica el damage final por CRIT_DAMAGE_MULT.
 */
const WEAPON_CRIT_CHANCE = {
  '1h_sword': 0.0,
  '2h_sword': 0.25,
  'staff':    0.0,
  'bow':      0.0,
  'unarmed':  0.0,
};
const CRIT_DAMAGE_MULT = 1.5;

/**
 * Modificadores por stance del player.
 *   speed_mult: multiplica el cooldown (>1 = más lento, <1 = más rápido)
 *   damage_mult: multiplica el damage final
 *   defense_bonus: porcentaje extra de defensa (0.05 = +5%)
 *   crit_taken_mult: cuánto crit recibe el player si el atacante crittea
 *
 * Estos modificadores SE SUMAN MULTIPLICATIVAMENTE con los del arma
 * (e.g. 2H smash damage = 1.5 × 1.05 = 1.575×).
 *
 * Mapping a server styles:
 *   chop → accurate, slash → aggressive, smash → controlled, block → defensive
 */
const STANCE_MODIFIERS = {
  chop:  { speed_mult: 1.00, damage_mult: 1.00, defense_bonus: 0.00, crit_taken_mult: 1.0 },
  slash: { speed_mult: 0.90, damage_mult: 0.95, defense_bonus: 0.00, crit_taken_mult: 1.0 },
  smash: { speed_mult: 1.05, damage_mult: 1.05, defense_bonus: 0.00, crit_taken_mult: 1.0 },
  block: { speed_mult: 1.05, damage_mult: 1.00, defense_bonus: 0.05, crit_taken_mult: 0.5 },
};

// Mapeo style del server → stance del cliente (para aplicar modifiers)
const STYLE_TO_STANCE = {
  accurate:   'chop',
  aggressive: 'slash',
  controlled: 'smash',
  defensive:  'block',
};

const VALID_STYLES = ['accurate', 'aggressive', 'defensive', 'controlled'];
const DEFAULT_STYLE = 'controlled';

const LOOT_OFFSET_RANGE_M    = 0.4;
const LOOT_TOTAL_LIFETIME_MS = 120_000;

// Sesión 25 — Death drop config (OSRS Wilderness PVE)
const DEATH_KEEP_TOP_N_SLOTS = 3;        // conserva los 3 slots más valiosos
const DEATH_LOOT_LIFETIME_MS = 120_000;  // 2 minutos visible en el suelo
const SPAWN_X = 0;                        // respawn point
const SPAWN_Z = 0;

// Sesión 27 Bloque 3 — PVP solo permitido en la zona wilderness, igual
// que en OSRS clásico. La zona wilderness es todo lo que está a la
// izquierda de la frontera X (espejo del WILDERNESS_X del cliente).
// Si AMBOS players están en x < WILDERNESS_X_BORDER, el attack se
// permite. Si alguno está fuera, error 'not_in_wilderness'.
const WILDERNESS_X_BORDER = -1024;

// Sesión 26 — HP regen pasiva
//   - HP_REGEN_INTERVAL_MS: cada cuánto se gana 1 HP cuando está fuera de combate
//   - HP_REGEN_COMBAT_LOCKOUT_MS: tras un ataque, el contador NO empieza
//     hasta pasado este tiempo (evita "regen instantáneo" mientras lucha).
// El regen se calcula LAZY en getCombatState (cada vez que el cliente
// pide estado). No hay timer servidor — se computa por delta de tiempo.
const HP_REGEN_INTERVAL_MS = 20_000;
const HP_REGEN_COMBAT_LOCKOUT_MS = 8_000;

// Sesión 16 — Mapping de skills internos (combat_engine) → skill_ids en
// la tabla user_skills (catálogo de 13 skills).
const COMBAT_SKILL_MAP = {
  attack_xp:   'attack',
  strength_xp: 'strength',
  defence_xp:  'defence',
  hp_xp:       'hitpoints',
};

export {
  getCombatState,
  attackNpc,
  attackPlayer,                // Sesión 27 Bloque 3 — PVP
  respawnUser,
  reviveExpiredNpcs,
  rollAndDropLoot,
  levelFromXp,
  xpForLevel,
  calcMaxHit,
  calcHitChance,
  awardXp,
  VALID_STYLES,
  DEFAULT_STYLE,
  TICK_MS,
};

// ============================================================
// LEVEL / XP
// ============================================================

function levelFromXp(xp) {
  if (xp < 0) return 1;
  for (let lvl = MAX_LEVEL; lvl >= 1; lvl--) {
    if (xp >= XP_TABLE[lvl - 1]) return lvl;
  }
  return 1;
}

function xpForLevel(level) {
  if (level < 1) return 0;
  if (level > MAX_LEVEL) return XP_TABLE[MAX_LEVEL - 1];
  return XP_TABLE[level - 1];
}

// ============================================================
// FORMULAS OSRS
// ============================================================

function effectiveLevel(level) {
  return level + 8;
}

function calcHitChance(attackerAtkLvl, defenderDefLvl) {
  const attackRoll = effectiveLevel(attackerAtkLvl) * 64;
  const defenceRoll = effectiveLevel(defenderDefLvl) * 64;
  if (attackRoll > defenceRoll) {
    return 1 - (defenceRoll + 2) / (2 * (attackRoll + 1));
  }
  return attackRoll / (2 * (defenceRoll + 1));
}

function calcMaxHit(strengthLvl) {
  return Math.floor((effectiveLevel(strengthLvl) + 5) / 10);
}

function rollHit(rng, attackerAtkLvl, defenderDefLvl, maxHit) {
  const chance = calcHitChance(attackerAtkLvl, defenderDefLvl);
  const r1 = rng();
  if (r1 >= chance) return { hit: false, damage: 0 };
  const r2 = rng();
  const damage = Math.floor(r2 * (maxHit + 1));
  return { hit: true, damage };
}

// ============================================================
// XP
// ============================================================

function awardXp(stats, damage, style) {
  if (damage <= 0) return { attack: 0, strength: 0, defence: 0, hp: 0 };
  const shared  = Math.floor(damage * 4 / 3);
  const focused = damage * 4;
  let aXp = 0, sXp = 0, dXp = 0;
  const hXp = shared;
  switch (style) {
    case 'accurate':
      aXp = focused;
      break;
    case 'aggressive':
      sXp = focused;
      break;
    case 'defensive':
      dXp = focused;
      break;
    case 'controlled':
    default:
      aXp = shared;
      sXp = shared;
      dXp = shared;
      break;
  }
  stats.attack_xp   += aXp;
  stats.strength_xp += sXp;
  stats.defence_xp  += dXp;
  stats.hp_xp       += hXp;
  return { attack: aXp, strength: sXp, defence: dXp, hp: hXp };
}

function levelsOf(stats) {
  return {
    attack: levelFromXp(stats.attack_xp),
    strength: levelFromXp(stats.strength_xp),
    defence: levelFromXp(stats.defence_xp),
    hp: levelFromXp(stats.hp_xp),
  };
}

function detectLevelUps(before, after) {
  const ups = [];
  if (after.attack > before.attack) ups.push('attack');
  if (after.strength > before.strength) ups.push('strength');
  if (after.defence > before.defence) ups.push('defence');
  if (after.hp > before.hp) ups.push('hp');
  return ups;
}

function dist(ax, az, bx, bz) {
  const dx = ax - bx, dz = az - bz;
  return Math.sqrt(dx * dx + dz * dz);
}

// ============================================================
// DB
// ============================================================

async function dbGetUserStats(db, userId) {
  let row = await db.first('SELECT * FROM combat_stats WHERE user_id = ?', [userId]);
  if (!row) {
    await db.run(
      `INSERT INTO combat_stats (user_id, attack_xp, strength_xp, defence_xp, hp_xp, hp_current, last_attack_at, last_died_at)
       VALUES (?, 0, 0, 0, 1154, 10, NULL, NULL)`,
      [userId]
    );
    row = await db.first('SELECT * FROM combat_stats WHERE user_id = ?', [userId]);
  }
  return row;
}

async function dbGetUserPosition(db, userId) {
  // Sesión 27 — Fix "fuera de alcance":
  // Preferimos online_users.x/z (heartbeat cada 500ms desde multiplayer.js)
  // sobre users.last_x/last_z (save explícito, hasta 10s de delay fuera de
  // combate). online_users es la fuente más fresca y elimina el desfase
  // entre "el cliente llega visualmente al NPC" y "el server cree que aún
  // estoy lejos".
  //
  // Fallback a users.last_x/last_z para casos donde no haya heartbeat:
  //   - Primer segundo post-login (antes del primer heartbeat).
  //   - Player con sesión sin multiplayer activo.
  //   - Heartbeat caducado (>10s sin actividad).
  const ONLINE_FRESH_MS = 10_000;
  const cutoff = Date.now() - ONLINE_FRESH_MS;
  const online = await db.first(
    'SELECT x, z FROM online_users WHERE user_id = ? AND last_seen > ?',
    [userId, cutoff]
  );
  if (online) {
    return { x: online.x, z: online.z };
  }
  const row = await db.first('SELECT last_x, last_z FROM users WHERE id = ?', [userId]);
  if (!row) return null;
  return {
    x: row.last_x !== null && row.last_x !== undefined ? row.last_x : 0,
    z: row.last_z !== null && row.last_z !== undefined ? row.last_z : 0,
  };
}

async function dbGetUserCombatStyle(db, userId) {
  const row = await db.first('SELECT combat_style FROM users WHERE id = ?', [userId]);
  const style = row?.combat_style;
  return VALID_STYLES.includes(style) ? style : DEFAULT_STYLE;
}

/**
 * Sesión 26 — Lee el weapon_type del item equipado en el slot 'weapon'.
 * Hace JOIN user_equipment → items para sacar la columna weapon_type.
 *
 * Si no hay arma equipada → 'unarmed'.
 * Si la query falla (tabla no existe / columna no existe) → 'unarmed'
 * defensivamente, para no romper el ataque.
 *
 * Valores esperados: 'unarmed' | '1h_sword' | '2h_sword' | 'bow' | 'staff'
 */
async function getUserWeaponType(db, userId) {
  try {
    const row = await db.first(
      `SELECT i.weapon_type
       FROM user_equipment ue
       JOIN items i ON i.id = ue.item_id
       WHERE ue.user_id = ? AND ue.slot_id = 'weapon'`,
      [userId]
    );
    const wt = row?.weapon_type;
    if (wt && ATTACK_SPEEDS_BY_WEAPON_TYPE[wt] !== undefined) return wt;
    return 'unarmed';
  } catch (err) {
    console.warn('[combat] getUserWeaponType fallback unarmed:', err.message);
    return 'unarmed';
  }
}

async function dbGetNpcInstance(db, npcInstanceId) {
  const row = await db.first(
    `SELECT i.*, d.name, d.max_hp, d.attack_lvl, d.strength_lvl, d.defence_lvl,
            d.attack_speed_ticks, d.max_hit, d.xp_per_kill, d.respawn_ms,
            d.spawn_x, d.spawn_z, d.attack_range, d.model
     FROM npc_instances i JOIN npc_defs d ON d.id = i.def_id
     WHERE i.id = ?`,
    [npcInstanceId]
  );
  return row || null;
}

// ============================================================
// Sesión 16 — Mirror combat XPs → user_skills
// ============================================================
/**
 * Replica los 4 XPs de combat (attack, strength, defence, hp) a la tabla
 * user_skills. Para cada skill, hace UPSERT con MAX(existing, combat_xp)
 * para no PERDER XP que el sistema viejo (user_skills) tuviera por encima.
 *
 * Llamado tras cualquier escritura a combat_stats. Idempotente.
 *
 * Nota: usamos `INSERT ... ON CONFLICT(...) DO UPDATE` (sintaxis SQLite
 * estándar, soportada por D1) en lugar de transacciones manuales.
 */
async function mirrorCombatXpToUserSkills(db, userId, stats, now) {
  for (const [combatCol, skillId] of Object.entries(COMBAT_SKILL_MAP)) {
    const xp = stats[combatCol];
    if (typeof xp !== 'number' || xp < 0) continue;
    // Si user_skills ya tiene XP >= xp, no hacemos nada (preserva XP de
    // otros sources como /api/skills/grant). Si tiene menos, lo subimos
    // a este valor.
    await db.run(
      `INSERT INTO user_skills (user_id, skill_id, xp, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(user_id, skill_id) DO UPDATE SET
         xp = MAX(user_skills.xp, excluded.xp),
         updated_at = excluded.updated_at`,
      [userId, skillId, xp, now]
    );
  }
}

// ============================================================
// PUBLIC: reviveExpiredNpcs
// ============================================================

async function reviveExpiredNpcs(db, opts = {}) {
  const now = opts.now || Date.now();
  // Sesión 26 — Spawn jitter: al respawnear, los NPCs aparecen en un
  // punto aleatorio dentro de un radio del spawn point del def en lugar
  // de exactamente sobre él. Antes todos los pollos/NPCs del mismo def
  // aparecían en el mismo (x,z) → quedaban orbitando juntos.
  //   RANDOM() en SQLite devuelve un INTEGER grande con signo. Lo
  //   normalizamos a [-1, 1] con:
  //     ((RANDOM() % 2000) / 1000.0) → rango aproximado [-2, 2]
  //     dividido entre 2 → ~[-1, 1]
  //   Luego multiplicamos por SPAWN_JITTER_RADIUS (5 unidades).
  const result = await db.run(
    `UPDATE npc_instances
     SET status = 0,
         hp_current = (SELECT max_hp FROM npc_defs WHERE id = npc_instances.def_id),
         died_at = NULL,
         in_combat_with = NULL,
         last_attack_at = NULL,
         x = (SELECT spawn_x FROM npc_defs WHERE id = npc_instances.def_id)
             + (((ABS(RANDOM()) % 2000) - 1000) / 200.0),
         z = (SELECT spawn_z FROM npc_defs WHERE id = npc_instances.def_id)
             + (((ABS(RANDOM()) % 2000) - 1000) / 200.0)
     WHERE status = 1
       AND died_at IS NOT NULL
       AND (died_at + (SELECT respawn_ms FROM npc_defs WHERE id = npc_instances.def_id)) <= ?`,
    [now]
  );
  const meta = result && result.meta;
  return { revived: (meta && meta.changes) || 0 };
}

// ============================================================
// Sesión 26 — HP regen pasivo
// ============================================================
/**
 * Calcula cuántos puntos de HP debería regenerar el user desde el último
 * ataque y los aplica directamente a `stats` + persiste en DB.
 *
 * Reglas:
 *   - Sin regen si hp_current = 0 (muerto, necesita /respawn explícito).
 *   - Sin regen si hp_current >= hp_max (ya al máximo).
 *   - Lockout: durante los primeros HP_REGEN_COMBAT_LOCKOUT_MS tras un
 *     ataque, no cuenta tiempo (estás "en combate").
 *   - Cada HP_REGEN_INTERVAL_MS adicionales = +1 HP, hasta el cap.
 *
 * Implementación: avanzamos virtualmente `last_attack_at` por
 * (LOCKOUT + ticks × INTERVAL). Esto permite que la próxima llamada
 * a getCombatState empiece el cómputo desde un timestamp posterior y
 * no doble-aplique ticks ya consumidos. No interfiere con el cooldown
 * de ataques (porque last_attack_at avanzado sigue estando en el pasado,
 * solo que más cercano al ahora).
 *
 * Si last_attack_at es NULL (nunca atacó), tratamos el lockout como ya
 * pasado y permitimos regenerar desde el momento en que entró el user
 * por primera vez (asume created_at o si no, fija ya last_attack_at a
 * un valor antiguo para que la siguiente call no cuente el mismo delta).
 */
async function applyPassiveHpRegen(db, userId, stats, now) {
  const hpMax = levelFromXp(stats.hp_xp);
  if (stats.hp_current <= 0) return;            // muerto: respawn requerido
  if (stats.hp_current >= hpMax) return;        // ya al máximo

  const baseTs = stats.last_attack_at || 0;
  const elapsed = now - baseTs;
  if (elapsed < HP_REGEN_COMBAT_LOCKOUT_MS) return; // aún en combate

  const usableElapsed = elapsed - HP_REGEN_COMBAT_LOCKOUT_MS;
  const ticksAvailable = Math.floor(usableElapsed / HP_REGEN_INTERVAL_MS);
  if (ticksAvailable <= 0) return;

  const missing = hpMax - stats.hp_current;
  const ticksToApply = Math.min(ticksAvailable, missing);
  if (ticksToApply <= 0) return;

  stats.hp_current += ticksToApply;
  // Avanzar last_attack_at virtualmente para que la próxima llamada
  // continúe el conteo desde aquí (evita doble-aplicación).
  const newLastAttackAt = baseTs + HP_REGEN_COMBAT_LOCKOUT_MS + ticksToApply * HP_REGEN_INTERVAL_MS;
  stats.last_attack_at = newLastAttackAt;

  await db.run(
    'UPDATE combat_stats SET hp_current = ?, last_attack_at = ? WHERE user_id = ?',
    [stats.hp_current, newLastAttackAt, userId]
  );
}

// ============================================================
// PUBLIC: getCombatState
// ============================================================

async function getCombatState(db, userId, opts = {}) {
  await reviveExpiredNpcs(db, opts);
  const stats = await dbGetUserStats(db, userId);
  const pos = await dbGetUserPosition(db, userId);
  const combatStyle = await dbGetUserCombatStyle(db, userId);
  const now = opts.now || Date.now();

  // Sesión 26 — HP regen pasivo: +1 HP cada HP_REGEN_INTERVAL_MS si el
  // user no está en combate (no ha atacado en HP_REGEN_COMBAT_LOCKOUT_MS).
  // Se calcula lazy aquí; el delta se persiste en hp_current y se
  // "avanza" last_attack_at para que las próximas llamadas no doble-cuenten.
  // Sin regen si HP=0 (necesita respawn explícito) o ya está al máximo.
  try {
    await applyPassiveHpRegen(db, userId, stats, now);
  } catch (err) {
    console.error('[combat/state] hp-regen failed:', err);
  }

  // Sesión 16 — Asegurar que user_skills está al día tras un getCombatState.
  // Esto cubre el caso de cuentas viejas que tenían XP en combat_stats
  // antes de que user_skills existiera: al primer getCombatState tras el
  // deploy, se hace backfill automático.
  try {
    await mirrorCombatXpToUserSkills(db, userId, stats, now);
  } catch (err) {
    console.error('[combat/state] mirror failed:', err);
  }

  const npcs = await db.all(
    `SELECT i.id, i.def_id, i.hp_current, i.x, i.z, i.status,
            d.name, d.max_hp, d.attack_lvl, d.strength_lvl, d.defence_lvl,
            d.attack_speed_ticks, d.max_hit, d.attack_range, d.model
     FROM npc_instances i JOIN npc_defs d ON d.id = i.def_id
     WHERE i.status = 0`,
    []
  );
  const lvls = levelsOf(stats);
  return {
    stats: {
      attack:   { level: lvls.attack,   xp: stats.attack_xp,   xp_next: xpForLevel(lvls.attack + 1) },
      strength: { level: lvls.strength, xp: stats.strength_xp, xp_next: xpForLevel(lvls.strength + 1) },
      defence:  { level: lvls.defence,  xp: stats.defence_xp,  xp_next: xpForLevel(lvls.defence + 1) },
      hp:       { level: lvls.hp,       xp: stats.hp_xp,       xp_next: xpForLevel(lvls.hp + 1) },
      hp_current: stats.hp_current,
      hp_max: lvls.hp,
      last_attack_at: stats.last_attack_at,
      last_died_at: stats.last_died_at,
    },
    combat_style: combatStyle,
    position: pos,
    npcs: npcs.map(r => ({
      id: r.id, def_id: r.def_id, name: r.name,
      hp_current: r.hp_current, max_hp: r.max_hp,
      x: r.x, z: r.z,
      attack_lvl: r.attack_lvl, strength_lvl: r.strength_lvl, defence_lvl: r.defence_lvl,
      max_hit: r.max_hit, attack_range: r.attack_range, model: r.model,
    })),
  };
}

// ============================================================
// PUBLIC: attackNpc
// ============================================================

async function attackNpc(db, userId, npcInstanceId, opts = {}) {
  const rng = opts.rng || Math.random;
  const now = opts.now || Date.now();

  const stats = await dbGetUserStats(db, userId);
  const npc = await dbGetNpcInstance(db, npcInstanceId);
  // Sesión 27 — Si el cliente envía su posición actual en el request
  // (opts.userPos), la usamos directamente. Esto elimina el bug "fuera
  // de alcance" causado por el desfase entre heartbeat (500ms) y el
  // movimiento real del player (hasta 5.6m en ese intervalo a velocidad
  // de run boost). Fallback a la pos persistida si el cliente no la
  // manda (compatibilidad con clientes antiguos).
  const userPos = (opts.userPos && Number.isFinite(opts.userPos.x) && Number.isFinite(opts.userPos.z))
    ? { x: opts.userPos.x, z: opts.userPos.z }
    : await dbGetUserPosition(db, userId);
  const style = await dbGetUserCombatStyle(db, userId);

  if (!npc) return { error: 'npc_not_found' };
  if (npc.status !== 0) return { error: 'npc_dead' };

  // Sesión 26 — Cooldown DEPENDE del arma equipada + stance:
  //   cooldownMs = ATTACK_SPEEDS[weapon] × STANCE_MODIFIERS[stance].speed_mult
  // El staff y 2H son lentos; bow y 1H son rápidos. Smash es +5% lento,
  // slash es -10% rápido. Estos compounean multiplicativamente.
  const weaponType = await getUserWeaponType(db, userId);
  const stanceKey = STYLE_TO_STANCE[style] || 'smash';
  const stanceMods = STANCE_MODIFIERS[stanceKey] || STANCE_MODIFIERS.smash;
  const baseSpeed = ATTACK_SPEEDS_BY_WEAPON_TYPE[weaponType] || TICK_MS;
  const cooldownMs = Math.round(baseSpeed * stanceMods.speed_mult);

  if (stats.last_attack_at && (now - stats.last_attack_at) < cooldownMs) {
    return {
      error: 'on_cooldown',
      cooldown_remaining_ms: cooldownMs - (now - stats.last_attack_at),
      cooldown_ms: cooldownMs,
      weapon_type: weaponType,
    };
  }

  if (!userPos) return { error: 'user_no_position' };
  const d = dist(userPos.x, userPos.z, npc.x, npc.z);
  // Sesión 26 — Para bow el rango es mayor. Para melee se mantiene el cap.
  const isRanged = (weaponType === 'bow');
  const maxRange = isRanged
    ? Math.max(npc.attack_range + 8.0, 10.0)   // ranged: hasta 10m
    : Math.min(npc.attack_range + RANGE_TOLERANCE, MELEE_MAX_RANGE);
  if (d > maxRange) {
    return {
      error: 'out_of_range',
      distance: d,
      max_range: maxRange,
    };
  }

  if (stats.hp_current <= 0) return { error: 'user_dead' };

  // ---- User hit ----
  const userLvls = levelsOf(stats);
  const userHit = rollHit(rng, userLvls.attack, npc.defence_lvl, calcMaxHit(userLvls.strength));

  // Sesión 26 — Aplicar damage multipliers:
  //   1. Weapon base mult (1.5× para 2H)
  //   2. Stance mult (slash 0.95, smash 1.05)
  //   3. Crit roll (solo si el arma tiene crit_chance > 0)
  let dmgRaw = userHit.damage;
  let isCrit = false;
  if (userHit.hit && dmgRaw > 0) {
    const weaponMult = WEAPON_DAMAGE_MULT[weaponType] || 1.0;
    dmgRaw = dmgRaw * weaponMult * stanceMods.damage_mult;
    // Roll crit automático (solo 2H tiene >0% chance)
    const critChance = WEAPON_CRIT_CHANCE[weaponType] || 0;
    if (critChance > 0 && rng() < critChance) {
      isCrit = true;
      dmgRaw = dmgRaw * CRIT_DAMAGE_MULT;
      // Nota: NPCs actuales no tienen stance, así que el crit_taken_mult
      // no se aplica aquí. Si en futuro PVP el target está en block,
      // se aplicaría dmgRaw *= targetStance.crit_taken_mult.
    }
    dmgRaw = Math.max(1, Math.floor(dmgRaw)); // mínimo 1 si hit
  }
  const dmgToNpc = Math.min(dmgRaw, npc.hp_current);
  userHit.damage = dmgToNpc;
  const npcHpAfter = npc.hp_current - dmgToNpc;
  const npcKilled = npcHpAfter <= 0;

  // ---- XP ----
  const xpBefore = levelsOf(stats);
  const xpGained = awardXp(stats, dmgToNpc, style);
  const xpAfter = levelsOf(stats);
  const levelUps = detectLevelUps(xpBefore, xpAfter);

  // ---- Persist NPC damage / death ----
  await db.run(
    `UPDATE npc_instances
     SET hp_current = ?, status = ?, died_at = ?, in_combat_with = ?
     WHERE id = ?`,
    [
      npcKilled ? 0 : npcHpAfter,
      npcKilled ? 1 : 0,
      npcKilled ? now : null,
      npcKilled ? null : userId,
      npc.id,
    ]
  );

  if (npcKilled) {
    try {
      await rollAndDropLoot(db, npc.def_id, npc.x, npc.z, userId, now, rng);
    } catch (err) {
      console.error('[combat/loot]', npc.def_id, err);
    }
  }

  stats.last_attack_at = now;

  // ---- NPC counter-attack ----
  let npcCounterHit = null;
  let dmgToUser = 0;
  let userKilled = false;
  let respawned = false;

  if (!npcKilled) {
    const npcCooldownMs = npc.attack_speed_ticks * TICK_MS;
    const npcReady = !npc.last_attack_at || (now - npc.last_attack_at) >= npcCooldownMs;
    if (npcReady) {
      npcCounterHit = rollHit(rng, npc.attack_lvl, userLvls.defence, npc.max_hit);
      dmgToUser = Math.min(npcCounterHit.damage, stats.hp_current);
      const userHpAfter = stats.hp_current - dmgToUser;
      if (userHpAfter <= 0) {
        userKilled = true;
        // Sesión 25 — NO auto-respawnear. HP queda en 0 hasta que el user
        // llame /api/combat/respawn explícitamente. Antes restaurábamos HP
        // al máximo aquí, lo que dejaba al user "vivo" inmediatamente.
        stats.hp_current = 0;
        stats.last_died_at = now;
        respawned = false;
        // Dropear inventario excedente (conserva top 3 slots). Donde
        // murió, no donde el NPC. El user X/Z lo tenemos en userPos.
        try {
          await dropExcessInventoryOnDeath(
            db, userId, userPos.x, userPos.z, now,
            DEATH_KEEP_TOP_N_SLOTS, rng
          );
        } catch (err) {
          console.error('[combat/death-drop]', err);
        }
      } else {
        stats.hp_current = userHpAfter;
      }
      await db.run(
        'UPDATE npc_instances SET last_attack_at = ? WHERE id = ?',
        [now, npc.id]
      );
    }
  }

  // ---- Persist user ----
  await db.run(
    `UPDATE combat_stats
     SET attack_xp = ?, strength_xp = ?, defence_xp = ?, hp_xp = ?,
         hp_current = ?, last_attack_at = ?, last_died_at = ?
     WHERE user_id = ?`,
    [
      stats.attack_xp, stats.strength_xp, stats.defence_xp, stats.hp_xp,
      stats.hp_current, stats.last_attack_at, stats.last_died_at,
      userId,
    ]
  );

  // Sesión 16 — Mirror al user_skills tras cada attackNpc. Si hubo XP,
  // se replica; si no hubo (miss total), igual mirroreamos por seguridad
  // (es idempotente y barato).
  try {
    await mirrorCombatXpToUserSkills(db, userId, stats, now);
  } catch (err) {
    console.error('[combat/attack] mirror failed:', err);
  }

  // ---- Log ----
  await db.run(
    `INSERT INTO combat_log (ts, attacker_type, attacker_id, target_type, target_id, damage, hit, killed)
     VALUES (?, 0, ?, 1, ?, ?, ?, ?)`,
    [now, userId, npc.id, dmgToNpc, userHit.hit ? 1 : 0, npcKilled ? 1 : 0]
  );
  if (npcCounterHit) {
    await db.run(
      `INSERT INTO combat_log (ts, attacker_type, attacker_id, target_type, target_id, damage, hit, killed)
       VALUES (?, 1, ?, 0, ?, ?, ?, ?)`,
      [now, npc.id, userId, dmgToUser, npcCounterHit.hit ? 1 : 0, userKilled ? 1 : 0]
    );
  }

  return {
    your_hit: userHit.hit,
    your_damage: dmgToNpc,
    is_crit: isCrit,                  // Sesión 26 — true si fue crítico (2H)
    cooldown_ms: cooldownMs,          // Sesión 26 — cuánto esperar al siguiente ataque
    weapon_type: weaponType,          // Sesión 26 — para que el cliente sepa qué anim usar
    stance: stanceKey,                // Sesión 26 — chop|slash|smash|block
    npc_killed: npcKilled,
    npc_hp: npcKilled ? 0 : npcHpAfter,
    npc_max_hp: npc.max_hp,
    xp_gained: xpGained,
    level_ups: levelUps,
    style,
    npc_hit: npcCounterHit ? npcCounterHit.hit : null,
    npc_damage: dmgToUser,
    you_died: userKilled,
    respawned,
    your_hp: stats.hp_current,
    your_hp_max: xpAfter.hp,
    your_levels: xpAfter,
  };
}

// ============================================================
// PUBLIC: attackPlayer (Sesión 27 Bloque 3 — PVP)
// ============================================================
//
// Mismo patrón que attackNpc pero target = otro player en lugar de NPC.
//
// Reglas:
//   - Ambos players deben estar en wilderness (x < WILDERNESS_X_BORDER).
//   - No puedes atacarte a ti mismo.
//   - Validación de rango usa userPos del cliente (mismo patrón anti-desfase
//     que attackNpc): el atacante manda su pos actual, el server lee la del
//     target de online_users (heartbeat cada 500ms).
//   - Cooldown propio del atacante (basado en arma + stance).
//   - Hit/damage con las mismas fórmulas (rollHit, max_hit por strength).
//   - Si el target tiene cooldown listo, contraataca automáticamente
//     (auto-retaliate OSRS-style). Esto requiere que el target esté online
//     y con HP > 0.
//   - Al morir el target: HP a 0, last_died_at = now, drop top-3 inventory.
//   - XP igual que NPC: ambos players ganan XP por golpes dados/recibidos
//     según su style (attacker activo, target en defensive por su counter).
//
async function attackPlayer(db, attackerId, targetId, opts = {}) {
  const rng = opts.rng || Math.random;
  const now = opts.now || Date.now();

  // -------- Sanity checks --------
  if (attackerId === targetId) return { error: 'cannot_attack_self' };

  const attackerStats = await dbGetUserStats(db, attackerId);
  const targetStats   = await dbGetUserStats(db, targetId);
  if (!attackerStats) return { error: 'attacker_not_found' };
  if (!targetStats)   return { error: 'target_not_found' };

  if (attackerStats.hp_current <= 0) return { error: 'user_dead' };
  if (targetStats.hp_current <= 0)   return { error: 'target_dead' };

  // -------- Posiciones --------
  // Atacante: usar pos del cliente (fresca). Fallback a persistida.
  const attackerPos = (opts.userPos && Number.isFinite(opts.userPos.x) && Number.isFinite(opts.userPos.z))
    ? { x: opts.userPos.x, z: opts.userPos.z }
    : await dbGetUserPosition(db, attackerId);

  // Target: posición del server (online_users / users.last_x). El cliente
  // NO puede mentir sobre la pos del target.
  const targetPos = await dbGetUserPosition(db, targetId);

  if (!attackerPos) return { error: 'user_no_position' };
  if (!targetPos)   return { error: 'target_no_position' };

  // -------- Zona PVP (solo wilderness) --------
  if (attackerPos.x >= WILDERNESS_X_BORDER) {
    return { error: 'not_in_wilderness', reason: 'attacker' };
  }
  if (targetPos.x >= WILDERNESS_X_BORDER) {
    return { error: 'not_in_wilderness', reason: 'target' };
  }

  // -------- Cooldown attacker --------
  const weaponType = await getUserWeaponType(db, attackerId);
  const attackerStyle = await dbGetUserCombatStyle(db, attackerId);
  const stanceKey = STYLE_TO_STANCE[attackerStyle] || 'smash';
  const stanceMods = STANCE_MODIFIERS[stanceKey] || STANCE_MODIFIERS.smash;
  const baseSpeed = ATTACK_SPEEDS_BY_WEAPON_TYPE[weaponType] || TICK_MS;
  const cooldownMs = Math.round(baseSpeed * stanceMods.speed_mult);

  if (attackerStats.last_attack_at && (now - attackerStats.last_attack_at) < cooldownMs) {
    return {
      error: 'on_cooldown',
      cooldown_remaining_ms: cooldownMs - (now - attackerStats.last_attack_at),
      cooldown_ms: cooldownMs,
      weapon_type: weaponType,
    };
  }

  // -------- Range --------
  const d = dist(attackerPos.x, attackerPos.z, targetPos.x, targetPos.z);
  const isRanged = (weaponType === 'bow');
  // Para PVP, el "attack_range" base de un player es 1m (melee típico).
  const PLAYER_BASE_ATTACK_RANGE = 1.0;
  const maxRange = isRanged
    ? Math.max(PLAYER_BASE_ATTACK_RANGE + 8.0, 10.0)
    : Math.min(PLAYER_BASE_ATTACK_RANGE + RANGE_TOLERANCE, MELEE_MAX_RANGE);
  if (d > maxRange) {
    return {
      error: 'out_of_range',
      distance: d,
      max_range: maxRange,
    };
  }

  // -------- User hit --------
  const attackerLvls = levelsOf(attackerStats);
  const targetLvls   = levelsOf(targetStats);
  const userHit = rollHit(rng, attackerLvls.attack, targetLvls.defence, calcMaxHit(attackerLvls.strength));

  let dmgRaw = userHit.damage;
  let isCrit = false;
  if (userHit.hit && dmgRaw > 0) {
    const weaponMult = WEAPON_DAMAGE_MULT[weaponType] || 1.0;
    dmgRaw = dmgRaw * weaponMult * stanceMods.damage_mult;
    const critChance = WEAPON_CRIT_CHANCE[weaponType] || 0;
    if (critChance > 0 && rng() < critChance) {
      isCrit = true;
      dmgRaw = dmgRaw * CRIT_DAMAGE_MULT;
    }
    dmgRaw = Math.max(1, Math.floor(dmgRaw));
  }
  const dmgToTarget = Math.min(dmgRaw, targetStats.hp_current);
  userHit.damage = dmgToTarget;
  const targetHpAfter = targetStats.hp_current - dmgToTarget;
  const targetKilled = targetHpAfter <= 0;

  // -------- XP attacker --------
  const xpBefore = levelsOf(attackerStats);
  const xpGained = awardXp(attackerStats, dmgToTarget, attackerStyle);
  const xpAfter = levelsOf(attackerStats);
  const levelUps = detectLevelUps(xpBefore, xpAfter);

  // -------- Persist target damage --------
  targetStats.hp_current = targetKilled ? 0 : targetHpAfter;
  if (targetKilled) targetStats.last_died_at = now;

  // -------- Target counter-attack (auto-retaliate) --------
  // El target devuelve el golpe si:
  //   - Sigue vivo después del golpe
  //   - Su cooldown propio está listo (usamos el cooldown del attacker
  //     como aproximación; sin acceso al arma del target sería ideal,
  //     pero por ahora simplificamos).
  let targetCounterHit = null;
  let dmgToAttacker = 0;
  let attackerKilled = false;

  if (!targetKilled) {
    const targetCooldownMs = cooldownMs; // simplificación: usa el del attacker
    const targetReady = !targetStats.last_attack_at ||
                        (now - targetStats.last_attack_at) >= targetCooldownMs;
    if (targetReady) {
      // El target da un golpe defensivo (style: defensive simulado).
      // Usamos su strength real pero stance "neutra".
      const targetMaxHit = calcMaxHit(targetLvls.strength);
      targetCounterHit = rollHit(rng, targetLvls.attack, attackerLvls.defence, targetMaxHit);
      dmgToAttacker = Math.min(targetCounterHit.damage, attackerStats.hp_current);
      const attackerHpAfter = attackerStats.hp_current - dmgToAttacker;
      if (attackerHpAfter <= 0) {
        attackerKilled = true;
        attackerStats.hp_current = 0;
        attackerStats.last_died_at = now;
        try {
          await dropExcessInventoryOnDeath(
            db, attackerId, attackerPos.x, attackerPos.z, now,
            DEATH_KEEP_TOP_N_SLOTS, rng
          );
        } catch (err) {
          console.error('[combat/pvp/attacker-death-drop]', err);
        }
      } else {
        attackerStats.hp_current = attackerHpAfter;
      }
      // Target gana XP de defensa por el contraataque (usa su style si lo tiene)
      const targetStyle = await dbGetUserCombatStyle(db, targetId);
      awardXp(targetStats, dmgToAttacker, targetStyle);
      targetStats.last_attack_at = now;
    }
  } else {
    // Target murió por el golpe → drop su inventario excedente
    try {
      await dropExcessInventoryOnDeath(
        db, targetId, targetPos.x, targetPos.z, now,
        DEATH_KEEP_TOP_N_SLOTS, rng
      );
    } catch (err) {
      console.error('[combat/pvp/target-death-drop]', err);
    }
  }

  attackerStats.last_attack_at = now;

  // -------- Persist attacker --------
  await db.run(
    `UPDATE combat_stats
     SET attack_xp = ?, strength_xp = ?, defence_xp = ?, hp_xp = ?,
         hp_current = ?, last_attack_at = ?, last_died_at = ?
     WHERE user_id = ?`,
    [
      attackerStats.attack_xp, attackerStats.strength_xp,
      attackerStats.defence_xp, attackerStats.hp_xp,
      attackerStats.hp_current, attackerStats.last_attack_at,
      attackerStats.last_died_at,
      attackerId,
    ]
  );

  // -------- Persist target --------
  await db.run(
    `UPDATE combat_stats
     SET attack_xp = ?, strength_xp = ?, defence_xp = ?, hp_xp = ?,
         hp_current = ?, last_attack_at = ?, last_died_at = ?
     WHERE user_id = ?`,
    [
      targetStats.attack_xp, targetStats.strength_xp,
      targetStats.defence_xp, targetStats.hp_xp,
      targetStats.hp_current, targetStats.last_attack_at,
      targetStats.last_died_at,
      targetId,
    ]
  );

  // Mirror XP a user_skills (para que stats tab muestre niveles actualizados)
  try {
    await mirrorCombatXpToUserSkills(db, attackerId, attackerStats, now);
    await mirrorCombatXpToUserSkills(db, targetId, targetStats, now);
  } catch (err) {
    console.error('[combat/pvp] mirror failed:', err);
  }

  // -------- Combat log --------
  // attacker_type = 0 (player), target_type = 0 (player)
  await db.run(
    `INSERT INTO combat_log (ts, attacker_type, attacker_id, target_type, target_id, damage, hit, killed)
     VALUES (?, 0, ?, 0, ?, ?, ?, ?)`,
    [now, attackerId, targetId, dmgToTarget, userHit.hit ? 1 : 0, targetKilled ? 1 : 0]
  );
  if (targetCounterHit) {
    await db.run(
      `INSERT INTO combat_log (ts, attacker_type, attacker_id, target_type, target_id, damage, hit, killed)
       VALUES (?, 0, ?, 0, ?, ?, ?, ?)`,
      [now, targetId, attackerId, dmgToAttacker, targetCounterHit.hit ? 1 : 0, attackerKilled ? 1 : 0]
    );
  }

  return {
    your_hit:      userHit.hit,
    your_damage:   dmgToTarget,
    is_crit:       isCrit,
    cooldown_ms:   cooldownMs,
    weapon_type:   weaponType,
    stance:        stanceKey,
    target_killed: targetKilled,
    target_hp:     targetStats.hp_current,
    target_hp_max: levelFromXp(targetStats.hp_xp),
    target_user_id: targetId,
    xp_gained:     xpGained,
    level_ups:     levelUps,
    style:         attackerStyle,
    target_hit:    targetCounterHit ? targetCounterHit.hit : null,
    target_damage: dmgToAttacker,
    you_died:      attackerKilled,
    your_hp:       attackerStats.hp_current,
    your_hp_max:   xpAfter.hp,
    your_levels:   xpAfter,
  };
}

// ============================================================
// PUBLIC: respawnUser
// ============================================================

async function respawnUser(db, userId, opts = {}) {
  const now = opts.now || Date.now();
  const stats = await dbGetUserStats(db, userId);
  const hpMax = levelFromXp(stats.hp_xp);
  if (stats.hp_current > 0) {
    return { ok: false, error: 'not_dead' };
  }
  // Restaurar HP al máximo
  await db.run(
    'UPDATE combat_stats SET hp_current = ?, last_died_at = ? WHERE user_id = ?',
    [hpMax, now, userId]
  );
  // Sesión 25 — Teleportar al spawn point. Antes solo el cliente movía
  // visualmente; ahora el server fuerza last_x/last_z al respawn para que
  // la posición sea consistente entre cliente y server.
  await db.run(
    'UPDATE users SET last_x = ?, last_z = ? WHERE id = ?',
    [SPAWN_X, SPAWN_Z, userId]
  );
  // Sesión 16 — respawn no cambia XP pero garantizamos consistencia.
  try {
    await mirrorCombatXpToUserSkills(db, userId, stats, now);
  } catch (err) {
    console.error('[combat/respawn] mirror failed:', err);
  }
  return { ok: true, hp_current: hpMax, spawn_x: SPAWN_X, spawn_z: SPAWN_Z };
}

// ============================================================
// LOOT DROPS
// ============================================================
async function rollAndDropLoot(db, npcDefId, npcX, npcZ, userId, now, rng) {
  const rows = await db.all(
    `SELECT item_id, qty_min, qty_max, weight, is_always
     FROM npc_loot_table
     WHERE npc_def_id = ?`,
    [npcDefId]
  );
  if (!rows || rows.length === 0) return;

  const drops = [];

  for (const r of rows) {
    if (r.is_always === 1) {
      const qty = rollQty(rng, r.qty_min, r.qty_max);
      if (qty > 0) drops.push({ item_id: r.item_id, qty });
    }
  }

  const random = rows.filter(r => r.is_always === 0);
  if (random.length > 0) {
    const totalWeight = random.reduce((s, r) => s + (r.weight | 0), 0);
    if (totalWeight > 0) {
      let pick = rng() * totalWeight;
      for (const r of random) {
        pick -= r.weight;
        if (pick <= 0) {
          const qty = rollQty(rng, r.qty_min, r.qty_max);
          if (qty > 0) drops.push({ item_id: r.item_id, qty });
          break;
        }
      }
    }
  }

  if (drops.length === 0) return;

  const despawnAt = now + LOOT_TOTAL_LIFETIME_MS;
  for (const d of drops) {
    const ox = (rng() - 0.5) * 2 * LOOT_OFFSET_RANGE_M;
    const oz = (rng() - 0.5) * 2 * LOOT_OFFSET_RANGE_M;
    await db.run(
      `INSERT INTO ground_items (item_id, qty, x, z, dropped_at, dropped_by_user, despawn_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [d.item_id, d.qty, npcX + ox, npcZ + oz, now, userId, despawnAt]
    );
  }
}

function rollQty(rng, qMin, qMax) {
  const mn = qMin | 0;
  const mx = qMax | 0;
  if (mx <= mn) return mn;
  return mn + Math.floor(rng() * (mx - mn + 1));
}

// ============================================================
// SESIÓN 25 — Death inventory drop
// ============================================================
/**
 * Cuando user muere (PVE): conserva los top N slots por valor, el resto
 * se dropea como ground_items.
 *
 * VALOR DEL SLOT (heurística simple, iterable):
 *   - Coins → 1 gp por unidad (valor del slot = quantity)
 *   - Resto → shop_stock.sell_price del shop 'general_store' × quantity
 *     - Si el item NO está en shop_stock, valor = 0 (cae primero)
 *
 * Strategy:
 *   1. SELECT slots con su valor calculado, ORDER BY valor DESC
 *   2. Los primeros `keepTopN` se quedan en user_inventory (intactos)
 *   3. Para cada slot restante: INSERT ground_item + DELETE de user_inventory
 *
 * Equipment slots no se tocan: el sistema de equipment usa otra tabla
 * (user_equipment), y los items equipados se conservan al morir en PVE.
 *
 * dropped_by_user se setea a NULL: cualquier jugador puede recoger el loot
 * (no es loot privado).
 */
async function dropExcessInventoryOnDeath(db, userId, deathX, deathZ, now, keepTopN, rng) {
  rng = rng || Math.random;

  // Cargar todos los slots ocupados con valor calculado vía LEFT JOIN.
  // CASE WHEN item_id = 'coins' THEN 1 ELSE COALESCE(s.sell_price, 0) END
  // Sesión 26 — Fix: la columna real se llama slot_index (no slot).
  const rows = await db.all(
    `SELECT ui.slot_index, ui.item_id, ui.quantity,
            (CASE WHEN ui.item_id = 'coins' THEN 1
                  ELSE COALESCE(s.sell_price, 0) END) AS unit_value
     FROM user_inventory ui
     LEFT JOIN shop_stock s
       ON s.item_id = ui.item_id AND s.shop_id = 'general_store'
     WHERE ui.user_id = ?
     ORDER BY (ui.quantity * (CASE WHEN ui.item_id = 'coins' THEN 1
                                   ELSE COALESCE(s.sell_price, 0) END)) DESC,
              ui.slot_index ASC`,
    [userId]
  );

  if (!rows || rows.length === 0) {
    console.log(`[combat/death-drop] user ${userId} muerto sin items en inventario`);
    return;
  }

  const totalSlots = rows.length;
  const dropRows = rows.slice(keepTopN); // los que se van al suelo
  const keptCount = Math.min(keepTopN, totalSlots);
  console.log(`[combat/death-drop] user ${userId}: ${keptCount}/${totalSlots} slots conservados, ${dropRows.length} dropeados`);

  if (dropRows.length === 0) return;

  const despawnAt = now + DEATH_LOOT_LIFETIME_MS;

  for (const r of dropRows) {
    // Pequeño jitter posicional para que los items no se apilen exactos
    const ox = (rng() - 0.5) * 2 * LOOT_OFFSET_RANGE_M;
    const oz = (rng() - 0.5) * 2 * LOOT_OFFSET_RANGE_M;

    // INSERT en ground_items (dropped_by_user = NULL para que cualquiera lo recoja)
    await db.run(
      `INSERT INTO ground_items (item_id, qty, x, z, dropped_at, dropped_by_user, despawn_at)
       VALUES (?, ?, ?, ?, ?, NULL, ?)`,
      [r.item_id, r.quantity, deathX + ox, deathZ + oz, now, despawnAt]
    );

    // DELETE del slot del user
    await db.run(
      `DELETE FROM user_inventory WHERE user_id = ? AND slot_index = ?`,
      [userId, r.slot_index]
    );
  }
}
