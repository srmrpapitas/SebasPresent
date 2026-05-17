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

const TICK_MS = 600;
// Sesión 20 — Antes RANGE_TOLERANCE=3.5 permitía pegar desde 3.5m extra
// sobre attack_range del NPC. Combinado con la posición del user que se
// guarda cada 10s, esto provocaba "pegar desde lejos". Bajado a 0.8m y
// añadido cap melee 2.5m sobre attack_range bruto del NPC.
const RANGE_TOLERANCE = 0.8;
const MELEE_MAX_RANGE = 2.5;
const MAX_LEVEL = 99;
const XP_PER_DMG_PER_SKILL = 4 / 3;

const VALID_STYLES = ['accurate', 'aggressive', 'defensive', 'controlled'];
const DEFAULT_STYLE = 'controlled';

const LOOT_OFFSET_RANGE_M    = 0.4;
const LOOT_TOTAL_LIFETIME_MS = 120_000;

// Sesión 25 — Death drop config (OSRS Wilderness PVE)
const DEATH_KEEP_TOP_N_SLOTS = 3;        // conserva los 3 slots más valiosos
const DEATH_LOOT_LIFETIME_MS = 120_000;  // 2 minutos visible en el suelo
const SPAWN_X = 0;                        // respawn point
const SPAWN_Z = 0;

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
  const combatStyle = await dbGetUserCombatStyle(db, userId);

  // Sesión 16 — Asegurar que user_skills está al día tras un getCombatState.
  // Esto cubre el caso de cuentas viejas que tenían XP en combat_stats
  // antes de que user_skills existiera: al primer getCombatState tras el
  // deploy, se hace backfill automático.
  try {
    await mirrorCombatXpToUserSkills(db, userId, stats, opts.now || Date.now());
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
  const userPos = await dbGetUserPosition(db, userId);
  const style = await dbGetUserCombatStyle(db, userId);

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
  // Sesión 20 — el max range efectivo es min(attack_range + tolerance, MELEE_MAX_RANGE)
  // para evitar que NPCs con attack_range alto (configurados o por bug)
  // permitan pegar desde lejos. Para ranged/magic futuro se quitará este cap
  // según tipo del NPC.
  const maxRange = Math.min(npc.attack_range + RANGE_TOLERANCE, MELEE_MAX_RANGE);
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
  const dmgToNpc = Math.min(userHit.damage, npc.hp_current);
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
  const rows = await db.all(
    `SELECT ui.slot, ui.item_id, ui.quantity,
            (CASE WHEN ui.item_id = 'coins' THEN 1
                  ELSE COALESCE(s.sell_price, 0) END) AS unit_value
     FROM user_inventory ui
     LEFT JOIN shop_stock s
       ON s.item_id = ui.item_id AND s.shop_id = 'general_store'
     WHERE ui.user_id = ?
     ORDER BY (ui.quantity * (CASE WHEN ui.item_id = 'coins' THEN 1
                                   ELSE COALESCE(s.sell_price, 0) END)) DESC,
              ui.slot ASC`,
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
      `DELETE FROM user_inventory WHERE user_id = ? AND slot = ?`,
      [userId, r.slot]
    );
  }
}
