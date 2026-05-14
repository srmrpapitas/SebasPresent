/**
 * SebasPresent — Combat Engine (Slice 5a)
 *
 * Patron consistente con ge_engine.js:
 *   - Habla con un objeto `db` con la interfaz
 *     {first(sql, params), all(sql, params), run(sql, params)}.
 *   - RNG y reloj inyectables para tests deterministicos.
 *   - Se incluye inline en worker.js. Este archivo es referencia.
 *
 * FUNCIONES PUBLICAS:
 *   - getCombatState(db, userId, opts)
 *     Stats del user + NPCs vivos en el mundo. Revive lazy.
 *   - attackNpc(db, userId, npcInstanceId, opts)
 *     User ataca NPC. Cooldown 600ms, hit/miss + dmg, XP,
 *     counter-attack, death/respawn del user si HP cae a 0.
 *   - respawnUser(db, userId, opts)
 *     Resucita manual si user muerto.
 *   - reviveExpiredNpcs(db, opts)
 *     Pasada del cron. Revive NPCs cuyo respawn vencio.
 *
 * INVARIANTES:
 *   - I1: hp_current <= levelFromXp(hp_xp)
 *   - I2: combat_stats.last_attack_at solo aumenta
 *   - I3: si NPC muere por el hit del user, NPC no contraataca
 *   - I4: XP solo si user damage > 0
 */

// ============================================================
// XP TABLE OSRS CLASSIC (1..99). Tabla canonica.
// ============================================================
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

const TICK_MS = 600;
const RANGE_TOLERANCE = 0.5;
const MAX_LEVEL = 99;
const XP_PER_DMG_PER_SKILL = 4 / 3;

// Slice 5b — Combat styles validos. Default = 'controlled' (OSRS).
const VALID_STYLES = ['accurate', 'aggressive', 'defensive', 'controlled'];
const DEFAULT_STYLE = 'controlled';

export {
  getCombatState,
  attackNpc,
  respawnUser,
  reviveExpiredNpcs,
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
// FORMULAS OSRS (sin equipment)
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

/**
 * Slice 5b — XP por estilo de combate (OSRS-exact).
 *
 *   accurate    → +4 Attack/dmg     + 1.33 HP/dmg
 *   aggressive  → +4 Strength/dmg   + 1.33 HP/dmg
 *   defensive   → +4 Defence/dmg    + 1.33 HP/dmg
 *   controlled  → +1.33 Atk +1.33 Str +1.33 Def + 1.33 HP por dmg
 *
 * Total XP por dmg = 5.33 (focused 4 + HP 1.33, o sea ~4/3 a las 4 skills
 * en controlled). Esto coincide 1:1 con OSRS Wiki.
 */
function awardXp(stats, damage, style) {
  if (damage <= 0) return { attack: 0, strength: 0, defence: 0, hp: 0 };
  const shared  = Math.floor(damage * 4 / 3);  // 1.33×
  const focused = damage * 4;                   // 4× (entero, sin floor)
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
  const row = await db.first('SELECT last_x, last_z FROM users WHERE id = ?', [userId]);
  if (!row) return null;
  return {
    x: row.last_x !== null && row.last_x !== undefined ? row.last_x : 0,
    z: row.last_z !== null && row.last_z !== undefined ? row.last_z : 0,
  };
}

// Slice 5b — combat_style vive en users (migration 009).
async function dbGetUserCombatStyle(db, userId) {
  const row = await db.first('SELECT combat_style FROM users WHERE id = ?', [userId]);
  const style = row?.combat_style;
  return VALID_STYLES.includes(style) ? style : DEFAULT_STYLE;
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
// PUBLIC: reviveExpiredNpcs
// ============================================================

async function reviveExpiredNpcs(db, opts = {}) {
  const now = opts.now || Date.now();
  const result = await db.run(
    `UPDATE npc_instances
     SET status = 0,
         hp_current = (SELECT max_hp FROM npc_defs WHERE id = npc_instances.def_id),
         died_at = NULL,
         in_combat_with = NULL,
         last_attack_at = NULL,
         x = (SELECT spawn_x FROM npc_defs WHERE id = npc_instances.def_id),
         z = (SELECT spawn_z FROM npc_defs WHERE id = npc_instances.def_id)
     WHERE status = 1
       AND died_at IS NOT NULL
       AND (died_at + (SELECT respawn_ms FROM npc_defs WHERE id = npc_instances.def_id)) <= ?`,
    [now]
  );
  const meta = result && result.meta;
  return { revived: (meta && meta.changes) || 0 };
}

// ============================================================
// PUBLIC: getCombatState
// ============================================================

async function getCombatState(db, userId, opts = {}) {
  await reviveExpiredNpcs(db, opts);
  const stats = await dbGetUserStats(db, userId);
  const pos = await dbGetUserPosition(db, userId);
  const combatStyle = await dbGetUserCombatStyle(db, userId);   // Slice 5b
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
    combat_style: combatStyle,   // Slice 5b
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
  const userPos = await dbGetUserPosition(db, userId);
  const style = await dbGetUserCombatStyle(db, userId);   // Slice 5b

  if (!npc) return { error: 'npc_not_found' };
  if (npc.status !== 0) return { error: 'npc_dead' };

  if (stats.last_attack_at && (now - stats.last_attack_at) < TICK_MS) {
    return {
      error: 'on_cooldown',
      cooldown_remaining_ms: TICK_MS - (now - stats.last_attack_at),
    };
  }

  if (!userPos) return { error: 'user_no_position' };
  const d = dist(userPos.x, userPos.z, npc.x, npc.z);
  if (d > npc.attack_range + RANGE_TOLERANCE) {
    return {
      error: 'out_of_range',
      distance: d,
      max_range: npc.attack_range + RANGE_TOLERANCE,
    };
  }

  if (stats.hp_current <= 0) return { error: 'user_dead' };

  // ---- User hit ----
  const userLvls = levelsOf(stats);
  const userHit = rollHit(rng, userLvls.attack, npc.defence_lvl, calcMaxHit(userLvls.strength));
  const dmgToNpc = Math.min(userHit.damage, npc.hp_current);
  const npcHpAfter = npc.hp_current - dmgToNpc;
  const npcKilled = npcHpAfter <= 0;

  // ---- XP (Slice 5b: enrutado por estilo) ----
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
        stats.hp_current = xpAfter.hp;
        stats.last_died_at = now;
        respawned = true;
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
    npc_killed: npcKilled,
    npc_hp: npcKilled ? 0 : npcHpAfter,
    npc_max_hp: npc.max_hp,
    xp_gained: xpGained,
    level_ups: levelUps,
    style,                           // Slice 5b — eco del estilo usado
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
// PUBLIC: respawnUser
// ============================================================

async function respawnUser(db, userId, opts = {}) {
  const now = opts.now || Date.now();
  const stats = await dbGetUserStats(db, userId);
  const hpMax = levelFromXp(stats.hp_xp);
  if (stats.hp_current > 0) {
    return { ok: false, error: 'not_dead' };
  }
  await db.run(
    'UPDATE combat_stats SET hp_current = ?, last_died_at = ? WHERE user_id = ?',
    [hpMax, now, userId]
  );
  return { ok: true, hp_current: hpMax };
}
