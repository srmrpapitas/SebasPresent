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

// Sesión 27 Bloque 3 — Death drop PVP (más duro que PVE):
//   - Conserva las TOP_N "unidades" más valiosas por unit_value (no slots).
//   - Stacks se descomponen: 3000 coins = 3000 unidades de valor 1 c/u.
//     Si conservas top-3, te quedas con 3 coins; las 2997 restantes
//     caen al suelo.
//   - Equipment SÍ se cuenta (puedes perder tu espada si llevas algo
//     más valioso encima). En OSRS clásico también es así (skull).
// Valor: 3 unidades. PVE usa "slots" (DEATH_KEEP_TOP_N_SLOTS); aquí
// usamos "unidades virtuales".
const PVP_DEATH_KEEP_TOP_N = 3;

// Sesión 27 Bloque 3 — PVP solo permitido en la zona wilderness, igual
// que en OSRS clásico. La zona wilderness es todo lo que está a la
// izquierda de la frontera X (espejo del WILDERNESS_X del cliente).
// Si AMBOS players están en x < WILDERNESS_X_BORDER, el attack se
// permite. Si alguno está fuera, error 'not_in_wilderness'.
//
// Sesión 28 — Fuera de wilderness se permite PVP SOLO si los dos están
// en un duelo activo (consensual). El check se hace contra la tabla
// `duels` con helper getActiveDuelBetween (lectura defensiva: si la
// tabla no existe, fallback al comportamiento S27 = bloqueo total).
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
//
// Sesión 34 — Bloque 2: agregado ranged_xp. Las columnas magic_xp y
// prayer_xp ya existen en combat_stats (migración S34) pero NO están
// mapeadas todavía porque ningún path en combat_engine.js genera XP
// para ellas. Se agregan acá cuando hagamos los días 8-11 (mago) y
// día 12 (prayer).
const COMBAT_SKILL_MAP = {
  attack_xp:   'attack',
  strength_xp: 'strength',
  defence_xp:  'defence',
  hp_xp:       'hitpoints',
  ranged_xp:   'ranged',
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

// ============================================================
// FORMULAS RANGED (Sesión 34 — Bloque 2)
// ============================================================
//
// Análogas a las de melee pero usan ranged_level + ranged_bonus en lugar
// de attack/strength. Simplificación vs OSRS: en OSRS la fórmula divide
// los bonuses entre "ranged attack" (hit chance) y "ranged strength" (max
// hit). Acá usamos UN solo `ranged_bonus` que contribuye a ambos, decidido
// con Nico en S34 — menos columnas, suficiente para tech demo.
//
// `rangedBonus` = bow.ranged_bonus + arrow.ranged_bonus (sumados por el
// caller en attackNpc).

function calcMaxHitRanged(rangedLvl, rangedBonus) {
  const eff = effectiveLevel(rangedLvl);
  return Math.floor((eff + rangedBonus + 5) / 10);
}

function calcHitChanceRanged(rangedLvl, defenderDefLvl, rangedBonus) {
  const attackRoll  = effectiveLevel(rangedLvl) * 64 + rangedBonus * 4;
  const defenceRoll = effectiveLevel(defenderDefLvl) * 64;
  if (attackRoll > defenceRoll) {
    return 1 - (defenceRoll + 2) / (2 * (attackRoll + 1));
  }
  return attackRoll / (2 * (defenceRoll + 1));
}

function rollHitRanged(rng, rangedLvl, defenderDefLvl, rangedBonus, maxHit) {
  const chance = calcHitChanceRanged(rangedLvl, defenderDefLvl, rangedBonus);
  const r1 = rng();
  if (r1 >= chance) return { hit: false, damage: 0 };
  const r2 = rng();
  const damage = Math.floor(r2 * (maxHit + 1));
  return { hit: true, damage };
}

// ============================================================
// (rollHit melee continúa)
// ============================================================

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
 * Distribuye XP tras un ataque exitoso.
 *
 * Sesión 34 — Acepta `weaponType` opcional. Si es 'bow', la XP va a Ranged
 * en vez de Attack/Strength. Mapping de styles ranged:
 *   - accurate (accurate_bow): 4×dmg a ranged
 *   - aggressive (rapid):      4×dmg a ranged
 *   - defensive (longrange):   shared entre ranged y defence (4/3 cada uno)
 * HP XP sigue siendo 4/3 del damage en todos los casos (melee y ranged).
 *
 * Magic/prayer no están acá todavía — se agregan en días 8-12 del Bloque 2.
 */
function awardXp(stats, damage, style, weaponType = null) {
  if (damage <= 0) return { attack: 0, strength: 0, defence: 0, hp: 0, ranged: 0 };
  const shared  = Math.floor(damage * 4 / 3);
  const focused = damage * 4;
  let aXp = 0, sXp = 0, dXp = 0, rXp = 0;
  const hXp = shared;

  const isRanged = (weaponType === 'bow');

  if (isRanged) {
    switch (style) {
      case 'accurate':   // accurate_bow
      case 'aggressive': // rapid (más velocidad, misma XP)
        rXp = focused;
        break;
      case 'defensive':  // longrange
        rXp = shared;
        dXp = shared;
        break;
      default:
        rXp = focused;
        break;
    }
  } else {
    // Melee — comportamiento original (intacto).
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
  }

  stats.attack_xp   += aXp;
  stats.strength_xp += sXp;
  stats.defence_xp  += dXp;
  stats.hp_xp       += hXp;
  // S34 — backward-compat: si la fila no tiene ranged_xp todavía (pre-migración),
  // arrancamos desde 0.
  stats.ranged_xp = (stats.ranged_xp || 0) + rXp;

  return { attack: aXp, strength: sXp, defence: dXp, hp: hXp, ranged: rXp };
}

function levelsOf(stats) {
  return {
    attack:   levelFromXp(stats.attack_xp),
    strength: levelFromXp(stats.strength_xp),
    defence:  levelFromXp(stats.defence_xp),
    hp:       levelFromXp(stats.hp_xp),
    // S34 — backward-compat: si la cuenta tiene combat_stats anterior a
    // la migración de Bloque 2, ranged_xp puede ser undefined. Default 0.
    ranged:   levelFromXp(stats.ranged_xp || 0),
  };
}

function detectLevelUps(before, after) {
  const ups = [];
  if (after.attack   > before.attack)   ups.push('attack');
  if (after.strength > before.strength) ups.push('strength');
  if (after.defence  > before.defence)  ups.push('defence');
  if (after.hp       > before.hp)       ups.push('hp');
  if (after.ranged   > before.ranged)   ups.push('ranged');
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

/**
 * Sesión 34 — Lee el ranged_bonus del arco equipado.
 * Si no hay arma (o no es bow), devuelve 0.
 * El bonus total al disparar = este valor + ranged_bonus de la flecha consumida.
 */
async function getUserBowRangedBonus(db, userId) {
  try {
    const row = await db.first(
      `SELECT i.ranged_bonus
       FROM user_equipment ue
       JOIN items i ON i.id = ue.item_id
       WHERE ue.user_id = ? AND ue.slot_id = 'weapon' AND i.weapon_type = 'bow'`,
      [userId]
    );
    return row?.ranged_bonus || 0;
  } catch (err) {
    console.warn('[combat] getUserBowRangedBonus fallback 0:', err.message);
    return 0;
  }
}

/**
 * Sesión 34 — Consume 1 flecha del jugador al disparar con arco.
 *
 * Orden de búsqueda:
 *   1. Quiver equipado (slot 'quiver' en user_equipment) — si tiene
 *      arrow_quantity > 0 en user_quiver, consume de ahí.
 *   2. Inventory normal — primer stack de `arrow_*` (slot_index asc) que
 *      tenga quantity >= 1.
 *
 * Retorna:
 *   { ok: true, arrow_item_id: 'arrow_bronze', source: 'quiver'|'inventory' }
 *   { ok: false, error: 'no_ammo' } si no hay flechas en ningún lado.
 *
 * Side-effects: decrement de quiver o inv. Si el stack llega a 0 en inv,
 * borra la row (mantiene la convención de inv-no-empties). Si llega a 0
 * en quiver, deja el slot con item_id=NULL y qty=0 (el quiver sigue
 * equipado pero vacío).
 */
async function consumeArrow(db, userId, now) {
  const ts = now || Date.now();

  // 1) Quiver equipado
  try {
    const quiverEquipped = await db.first(
      `SELECT 1 FROM user_equipment WHERE user_id = ? AND slot_id = 'quiver'`,
      [userId]
    );
    if (quiverEquipped) {
      const q = await db.first(
        `SELECT arrow_item_id, arrow_quantity FROM user_quiver WHERE user_id = ?`,
        [userId]
      );
      if (q && q.arrow_item_id && q.arrow_quantity > 0) {
        const newQty = q.arrow_quantity - 1;
        if (newQty === 0) {
          await db.run(
            `UPDATE user_quiver
               SET arrow_item_id = NULL, arrow_quantity = 0, updated_at = ?
             WHERE user_id = ?`,
            [ts, userId]
          );
        } else {
          await db.run(
            `UPDATE user_quiver
               SET arrow_quantity = ?, updated_at = ?
             WHERE user_id = ?`,
            [newQty, ts, userId]
          );
        }
        return { ok: true, arrow_item_id: q.arrow_item_id, source: 'quiver' };
      }
    }
  } catch (err) {
    console.warn('[combat] consumeArrow quiver branch failed, falling back to inv:', err.message);
  }

  // 2) Inventory normal — primer stack arrow_*
  const invRow = await db.first(
    `SELECT slot_index, item_id, quantity
       FROM user_inventory
      WHERE user_id = ? AND item_id LIKE 'arrow_%' AND quantity > 0
      ORDER BY slot_index ASC
      LIMIT 1`,
    [userId]
  );
  if (!invRow) return { ok: false, error: 'no_ammo' };

  const newQty = invRow.quantity - 1;
  if (newQty === 0) {
    await db.run(
      `DELETE FROM user_inventory WHERE user_id = ? AND slot_index = ?`,
      [userId, invRow.slot_index]
    );
  } else {
    await db.run(
      `UPDATE user_inventory SET quantity = ? WHERE user_id = ? AND slot_index = ?`,
      [newQty, userId, invRow.slot_index]
    );
  }
  return { ok: true, arrow_item_id: invRow.item_id, source: 'inventory' };
}

/**
 * Sesión 34 — Lee el ranged_bonus de una flecha específica.
 * Usado por attackNpc tras consumeArrow para sumar al bonus del arco.
 */
async function getArrowRangedBonus(db, arrowItemId) {
  try {
    const row = await db.first(
      `SELECT ranged_bonus FROM items WHERE id = ?`,
      [arrowItemId]
    );
    return row?.ranged_bonus || 0;
  } catch (err) {
    console.warn('[combat] getArrowRangedBonus fallback 0:', err.message);
    return 0;
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
         last_moved_at = NULL,
         x = COALESCE(npc_instances.spawn_x,
                      (SELECT spawn_x FROM npc_defs WHERE id = npc_instances.def_id))
             + (((ABS(RANDOM()) % 2000) - 1000) / 200.0),
         z = COALESCE(npc_instances.spawn_z,
                      (SELECT spawn_z FROM npc_defs WHERE id = npc_instances.def_id))
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

  // Sesión 34 — Si el ataque es ranged, consumir 1 flecha ANTES del roll.
  // OSRS-faithful: la flecha se gasta incluso si fallás el roll (el shot
  // ya salió). Si no hay flechas en quiver ni inv, retorna error 'no_ammo'
  // sin consumir cooldown (el ataque ni siquiera arranca).
  //
  // El ranged_bonus total = bow.ranged_bonus + arrow.ranged_bonus, usado
  // por la fórmula de damage abajo.
  let totalRangedBonus = 0;
  let arrowConsumed = null;
  if (isRanged) {
    const bowBonus = await getUserBowRangedBonus(db, userId);
    arrowConsumed = await consumeArrow(db, userId, now);
    if (!arrowConsumed.ok) {
      return {
        error: 'no_ammo',
        weapon_type: weaponType,
      };
    }
    const arrowBonus = await getArrowRangedBonus(db, arrowConsumed.arrow_item_id);
    totalRangedBonus = bowBonus + arrowBonus;
  }

  // ---- User hit ----
  const userLvls = levelsOf(stats);
  // Sesión 34 — Bifurcación ranged vs melee.
  //   Ranged: usa userLvls.ranged + totalRangedBonus (arco + flecha).
  //   Melee:  usa userLvls.attack para hit chance, userLvls.strength para max hit (original).
  const userHit = isRanged
    ? rollHitRanged(
        rng,
        userLvls.ranged,
        npc.defence_lvl,
        totalRangedBonus,
        calcMaxHitRanged(userLvls.ranged, totalRangedBonus)
      )
    : rollHit(rng, userLvls.attack, npc.defence_lvl, calcMaxHit(userLvls.strength));

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
  // Sesión 34 — Pasar weaponType para que awardXp distinga entre melee
  // y ranged. Para bow, la XP va a Ranged (no Attack/Strength).
  const xpGained = awardXp(stats, dmgToNpc, style, weaponType);
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
    // Sesión 39 fix — El NPC SOLO contraataca si VOS estás dentro de SU rango
    // de melé. Antes contraatacaba siempre que su cooldown estuviera listo, sin
    // mirar distancia: por eso al pegarle con FLECHA desde lejos te devolvía el
    // golpe al instante (imposible en OSRS). Si lo atacás a distancia, el goblin
    // no te pega de vuelta acá — en su lugar te hace agro y te PERSIGUE (eso lo
    // maneja tickNpcAggro), y recién te pega cuando te alcanza a melé.
    const npcMeleeRange = Math.min(npc.attack_range + RANGE_TOLERANCE, MELEE_MAX_RANGE);
    const userInNpcRange = d <= npcMeleeRange;
    if (npcReady && userInNpcRange) {
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
  // Sesión 34 — Agregado ranged_xp. Usar (stats.ranged_xp || 0) defensivamente
  // por si la cuenta es pre-migración y el SELECT no devolvió la columna.
  await db.run(
    `UPDATE combat_stats
     SET attack_xp = ?, strength_xp = ?, defence_xp = ?, hp_xp = ?,
         ranged_xp = ?,
         hp_current = ?, last_attack_at = ?, last_died_at = ?
     WHERE user_id = ?`,
    [
      stats.attack_xp, stats.strength_xp, stats.defence_xp, stats.hp_xp,
      stats.ranged_xp || 0,
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
    // Sesión 34 — info del proyectil ranged (null si no fue bow).
    // El cliente lo usa para animar la flecha del color correcto.
    arrow_consumed: arrowConsumed
      ? { item_id: arrowConsumed.arrow_item_id, source: arrowConsumed.source }
      : null,
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

  // Sesión 27 Bloque 3 — Bloqueo PVP entre miembros de la misma party.
  // Lectura defensiva: si party_members no existe (migración no corrida),
  // la query falla silenciosamente y se permite el attack (comportamiento
  // pre-Party).
  try {
    const attackerParty = await db.first(
      `SELECT party_id FROM party_members WHERE user_id = ?`, [attackerId]
    );
    if (attackerParty?.party_id != null) {
      const targetParty = await db.first(
        `SELECT party_id FROM party_members WHERE user_id = ?`, [targetId]
      );
      if (targetParty?.party_id === attackerParty.party_id) {
        return { error: 'same_party' };
      }
    }
  } catch {
    // tabla no existe → ignorar, PVP libre
  }

  // -------- Posiciones --------
  // Atacante: usar pos del cliente (fresca). Fallback a persistida.
  const attackerPos = (opts.userPos && Number.isFinite(opts.userPos.x) && Number.isFinite(opts.userPos.z))
    ? { x: opts.userPos.x, z: opts.userPos.z }
    : await dbGetUserPosition(db, attackerId);

  // Target: pos PERSISTIDA en el server (la "verdad").
  const targetPosServer = await dbGetUserPosition(db, targetId);

  if (!attackerPos)      return { error: 'user_no_position' };
  if (!targetPosServer)  return { error: 'target_no_position' };

  // Sesión 27 Bloque 3 fix — Mismo problema que con NPCs antes del
  // refactor: el target puede haberse movido entre heartbeats. El
  // cliente lo ve VISUALMENTE al lado, pero la pos del server tiene
  // hasta 500ms de retraso (≈5m a velocidad de run).
  //
  // El attacker manda en el body opts.targetPos = {x, z} con la pos
  // que VE en pantalla (la del lerp visual del peer en multiplayer.js).
  // Server acepta esa pos si y solo si la discrepancia respecto a la
  // persistida es FÍSICAMENTE PLAUSIBLE en el último intervalo de
  // heartbeat. Esto previene cheating (no puedes decir "el target
  // está al lado" si en el server cree que está a 50m).
  //
  // Tolerancia: 6m = 12m/s × 0.5s (run boost máximo × heartbeat
  // interval). Si la diff es mayor, ignoramos lo que dice el cliente.
  const TARGET_POS_PLAUSIBILITY_M = 6.0;
  let targetPos = targetPosServer;
  if (opts.targetPos && Number.isFinite(opts.targetPos.x) && Number.isFinite(opts.targetPos.z)) {
    const diff = dist(opts.targetPos.x, opts.targetPos.z, targetPosServer.x, targetPosServer.z);
    if (diff <= TARGET_POS_PLAUSIBILITY_M) {
      // Confiamos en lo que ve el cliente.
      targetPos = { x: opts.targetPos.x, z: opts.targetPos.z };
    }
    // Si excede plausibilidad → mantener pos server (no rechazamos el
    // attack, solo ignoramos la pos sospechosa).
  }

  // -------- Zona PVP (wilderness o duelo consensual) -------- Sesión 28
  // Reglas:
  //   1) Si AMBOS están en wilderness → PVP libre (multi). Si attacker
  //      tiene un duelo activo y entra al wild, el duelo se cancela
  //      automáticamente (entrar wild rompe la "burbuja" del duelo).
  //   2) Si alguno está FUERA wilderness → solo permitido si los dos
  //      tienen un duelo activo entre ellos. Si no, error.
  const attackerInWild = attackerPos.x < WILDERNESS_X_BORDER;
  const targetInWild   = targetPosServer.x < WILDERNESS_X_BORDER;

  if (attackerInWild && targetInWild) {
    // ambos en wild → libre. Si attacker tenía duelo activo (con
    // cualquiera, no solo target), cancelar.
    const myDuel = await getActiveDuelForUser(db, attackerId);
    if (myDuel) {
      await closeDuelById(db, myDuel.id, now);
    }
  } else {
    // alguno fuera wild → exigir duelo activo entre los dos.
    const duel = await getActiveDuelBetween(db, attackerId, targetId);
    if (!duel) {
      // Si attacker está fuera wild → error attacker
      // Si target está fuera wild → error target
      if (!attackerInWild) {
        return { error: 'not_in_wilderness_no_duel', reason: 'attacker' };
      }
      return { error: 'not_in_wilderness_no_duel', reason: 'target' };
    }
    // Hay duelo → permitir attack. (No cancelar el duelo aquí — solo
    // se cancela al morir alguno o al entrar wild ambos.)
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
  // Sesión 27 Bloque 3 fix — Rango PVP MÁS GENEROSO que el de NPC.
  //
  // Razón: en PVP dos personajes 3D tienen ~0.5-0.7m de ancho cada uno,
  // así que cuando se ven "pegados" en pantalla los CENTROS están a
  // 1.5-2m de distancia. Con la fórmula vieja (1.0 + 0.8 = 1.8m max
  // melee) caías "fuera de rango" al moverte aunque visualmente
  // estuvierais al lado.
  //
  // Ahora:
  //   - PVP_PLAYER_BASE_RANGE = 2.5m (compensa el ancho del personaje)
  //   - PVP_MELEE_MAX_RANGE   = 4.0m (cap más amplio que NPC)
  // Resultado: melee PVP llega hasta min(2.5+0.8, 4.0) = 3.3m. Suficiente
  // para que estar visualmente al lado siempre cuente como "en rango",
  // sin permitir golpes desde lejos.
  const PVP_PLAYER_BASE_RANGE = 2.5;
  const PVP_MELEE_MAX_RANGE   = 4.0;
  const maxRange = isRanged
    ? Math.max(PVP_PLAYER_BASE_RANGE + 8.0, 10.0)
    : Math.min(PVP_PLAYER_BASE_RANGE + RANGE_TOLERANCE, PVP_MELEE_MAX_RANGE);
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

  // -------- Sesión 32 — Guardar el hit recibido en target stats --------
  // El target lo lee del snapshot.me y muestra hitsplat + anim de reacción.
  // Sin esto, el target ve el HP bajar pero NO ve feedback visual cuando un
  // peer le pega SIN que él mismo esté atacando.
  if (userHit.hit && dmgToTarget > 0) {
    targetStats.last_hit_from_user_id = attackerId;
    targetStats.last_hit_damage = dmgToTarget;
    targetStats.last_hit_at = now;
    targetStats.last_hit_is_crit = isCrit ? 1 : 0;
  }

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
          // Sesión 27 Bloque 3 — usar PVP drop (descompone stacks por
          // unidades, incluye equipment, conserva top-N más valiosos).
          await dropAllExceptTopUnitsOnDeathPVP(
            db, attackerId, attackerPos.x, attackerPos.z, now,
            PVP_DEATH_KEEP_TOP_N, rng
          );
        } catch (err) {
          console.error('[combat/pvp/attacker-death-drop]', err);
        }
        // Sesión 28 — Si había duelo, cerrarlo.
        try {
          const duel = await getActiveDuelBetween(db, attackerId, targetId);
          if (duel) await closeDuelById(db, duel.id, now);
        } catch {}
      } else {
        attackerStats.hp_current = attackerHpAfter;
      }
      // Target gana XP de defensa por el contraataque (usa su style si lo tiene)
      const targetStyle = await dbGetUserCombatStyle(db, targetId);
      awardXp(targetStats, dmgToAttacker, targetStyle);
      targetStats.last_attack_at = now;

      // Sesión 32 — Guardar el counter hit en attacker stats. Si el target
      // contraataca exitosamente, el attacker lo verá en su snapshot.me.
      if (targetCounterHit && targetCounterHit.hit && dmgToAttacker > 0) {
        attackerStats.last_hit_from_user_id = targetId;
        attackerStats.last_hit_damage = dmgToAttacker;
        attackerStats.last_hit_at = now;
        attackerStats.last_hit_is_crit = 0;
      }
    }
  } else {
    // Target murió por el golpe → drop sus items en la pos PERSISTIDA
    // del server. Sesión 27 Bloque 3 — usar PVP drop (descompone stacks,
    // incluye equipment, conserva top-N más valiosos por valor unitario).
    try {
      await dropAllExceptTopUnitsOnDeathPVP(
        db, targetId, targetPosServer.x, targetPosServer.z, now,
        PVP_DEATH_KEEP_TOP_N, rng
      );
    } catch (err) {
      console.error('[combat/pvp/target-death-drop]', err);
    }
    // Sesión 28 — Si había duelo activo entre los dos, cerrarlo.
    try {
      const duel = await getActiveDuelBetween(db, attackerId, targetId);
      if (duel) await closeDuelById(db, duel.id, now);
    } catch {}
  }

  attackerStats.last_attack_at = now;

  // -------- Persist attacker --------
  // Sesión 32 — incluir last_hit_*. Si las columnas no existen (migración
  // pendiente), el UPDATE falla con "no such column" y caemos al UPDATE
  // legacy sin los campos nuevos.
  try {
    await db.run(
      `UPDATE combat_stats
       SET attack_xp = ?, strength_xp = ?, defence_xp = ?, hp_xp = ?,
           hp_current = ?, last_attack_at = ?, last_died_at = ?,
           last_hit_from_user_id = ?, last_hit_damage = ?,
           last_hit_at = ?, last_hit_is_crit = ?
       WHERE user_id = ?`,
      [
        attackerStats.attack_xp, attackerStats.strength_xp,
        attackerStats.defence_xp, attackerStats.hp_xp,
        attackerStats.hp_current, attackerStats.last_attack_at,
        attackerStats.last_died_at,
        attackerStats.last_hit_from_user_id ?? null,
        attackerStats.last_hit_damage ?? null,
        attackerStats.last_hit_at ?? null,
        attackerStats.last_hit_is_crit ?? null,
        attackerId,
      ]
    );
  } catch (err) {
    if (String(err?.message || '').includes('no such column')) {
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
    } else {
      throw err;
    }
  }

  // -------- Persist target --------
  // Sesión 32 — incluir last_hit_* (mismo fallback).
  try {
    await db.run(
      `UPDATE combat_stats
       SET attack_xp = ?, strength_xp = ?, defence_xp = ?, hp_xp = ?,
           hp_current = ?, last_attack_at = ?, last_died_at = ?,
           last_hit_from_user_id = ?, last_hit_damage = ?,
           last_hit_at = ?, last_hit_is_crit = ?
       WHERE user_id = ?`,
      [
        targetStats.attack_xp, targetStats.strength_xp,
        targetStats.defence_xp, targetStats.hp_xp,
        targetStats.hp_current, targetStats.last_attack_at,
        targetStats.last_died_at,
        targetStats.last_hit_from_user_id ?? null,
        targetStats.last_hit_damage ?? null,
        targetStats.last_hit_at ?? null,
        targetStats.last_hit_is_crit ?? null,
        targetId,
      ]
    );
  } catch (err) {
    if (String(err?.message || '').includes('no such column')) {
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
    } else {
      throw err;
    }
  }

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

// ============================================================
// Sesión 27 Bloque 3 — DEATH DROP PVP (más duro que PVE)
// ============================================================
//
// A diferencia de dropExcessInventoryOnDeath (PVE):
//
//   1. Descompone los stacks en UNIDADES virtuales. Un slot de 3000
//      coins = 3000 unidades de valor 1 cada una. Un slot de 100 plumas
//      = 100 unidades de valor X. Una espada = 1 unidad de valor Y.
//
//   2. Ordena TODAS las unidades por unit_value DESC y conserva las
//      keepTopN más valiosas. El resto cae al suelo.
//
//   3. Incluye EQUIPMENT. Las piezas equipadas son qty=1 cada una y
//      cuentan en el ranking. Si tu yelmo vale 80 pero llevas un anillo
//      de 200, el yelmo se va al suelo y conservas el anillo.
//
//   4. Reconstruye inventario + equipment con lo conservado:
//      - Items equipados conservados → vuelven a equipment.
//      - Items conservados de mochila → vuelven a mochila.
//      - Stacks parciales (ej: conservas 3 plumas de 100) → 1 slot qty=3.
//
//   5. Agrupa el drop por item_id en el suelo (no crea 100 piles para
//      100 plumas, crea 1 pile con qty=100).
//
async function dropAllExceptTopUnitsOnDeathPVP(db, userId, deathX, deathZ, now, keepTopN, rng) {
  rng = rng || Math.random;

  // ---- 1) Inventario actual del muerto
  const invRows = await db.all(
    `SELECT ui.slot_index, ui.item_id, ui.quantity,
            (CASE WHEN ui.item_id = 'coins' THEN 1
                  ELSE COALESCE(s.sell_price, 0) END) AS unit_value
     FROM user_inventory ui
     LEFT JOIN shop_stock s
       ON s.item_id = ui.item_id AND s.shop_id = 'general_store'
     WHERE ui.user_id = ?`,
    [userId]
  );

  // ---- 2) Equipment actual del muerto
  let eqRows = [];
  try {
    eqRows = await db.all(
      `SELECT eq.slot_id, eq.item_id,
              COALESCE(s.sell_price, 0) AS unit_value
       FROM user_equipment eq
       LEFT JOIN shop_stock s
         ON s.item_id = eq.item_id AND s.shop_id = 'general_store'
       WHERE eq.user_id = ?`,
      [userId]
    );
  } catch (err) {
    console.warn('[combat/pvp-death] equipment read failed:', err.message);
    eqRows = [];
  }

  if ((!invRows || invRows.length === 0) && (!eqRows || eqRows.length === 0)) {
    console.log(`[combat/pvp-death] user ${userId}: nada que dropear`);
    return;
  }

  // ---- 3) Entradas planas (no descomponer stacks aquí — sería ineficiente)
  const entries = [];
  for (const r of invRows || []) {
    entries.push({
      item_id:    r.item_id,
      unit_value: r.unit_value || 0,
      qty:        r.quantity,
      source: { kind: 'inv', slot_index: r.slot_index },
    });
  }
  for (const r of eqRows || []) {
    entries.push({
      item_id:    r.item_id,
      unit_value: r.unit_value || 0,
      qty:        1,
      source: { kind: 'eq', slot_id: r.slot_id },
    });
  }

  // ---- 4) Ordenar por unit_value DESC. Tie-break: equipment > inventory
  entries.sort((a, b) => {
    if (b.unit_value !== a.unit_value) return b.unit_value - a.unit_value;
    if (a.source.kind !== b.source.kind) return a.source.kind === 'eq' ? -1 : 1;
    return 0;
  });

  // ---- 5) Reparto top N unidades vs drop
  let remaining = keepTopN;
  const kept = [];
  const drop = [];

  for (const e of entries) {
    if (remaining <= 0) {
      drop.push({ ...e });
      continue;
    }
    const keepQty = Math.min(remaining, e.qty);
    remaining -= keepQty;
    if (keepQty > 0) {
      kept.push({ ...e, kept_qty: keepQty });
    }
    if (keepQty < e.qty) {
      drop.push({ ...e, drop_qty: e.qty - keepQty });
    }
  }

  // ---- 6) Borrar inv + equipment del muerto, reconstruir con `kept`
  await db.run(`DELETE FROM user_inventory WHERE user_id = ?`, [userId]);
  try {
    await db.run(`DELETE FROM user_equipment WHERE user_id = ?`, [userId]);
  } catch (err) {
    console.warn('[combat/pvp-death] equipment delete failed:', err.message);
  }

  for (const e of kept) {
    if (e.source.kind === 'eq') {
      try {
        await db.run(
          `INSERT INTO user_equipment (user_id, slot_id, item_id, equipped_at)
           VALUES (?, ?, ?, ?)`,
          [userId, e.source.slot_id, e.item_id, now]
        );
      } catch (err) {
        console.warn('[combat/pvp-death] re-equip failed, sending to inv:', err.message);
        await safeInsertInvSlot(db, userId, e.item_id, e.kept_qty);
      }
    } else {
      await safeInsertInvSlot(db, userId, e.item_id, e.kept_qty, e.source.slot_index);
    }
  }

  // ---- 7) Dropear todo lo demás, agrupado por item_id
  if (drop.length === 0) return;

  const dropAgg = {};
  for (const d of drop) {
    const q = d.drop_qty != null ? d.drop_qty : d.qty;
    dropAgg[d.item_id] = (dropAgg[d.item_id] || 0) + q;
  }

  const despawnAt = now + DEATH_LOOT_LIFETIME_MS;
  for (const item_id of Object.keys(dropAgg)) {
    const qty = dropAgg[item_id];
    if (qty <= 0) continue;
    const ox = (rng() - 0.5) * 2 * LOOT_OFFSET_RANGE_M;
    const oz = (rng() - 0.5) * 2 * LOOT_OFFSET_RANGE_M;
    await db.run(
      `INSERT INTO ground_items (item_id, qty, x, z, dropped_at, dropped_by_user, despawn_at)
       VALUES (?, ?, ?, ?, ?, NULL, ?)`,
      [item_id, qty, deathX + ox, deathZ + oz, now, despawnAt]
    );
  }

  console.log(
    `[combat/pvp-death] user ${userId}: kept=${kept.length} entries, dropped=${Object.keys(dropAgg).length} types`
  );
}

// ============================================================
// Sesión 28 — Helpers de duelo (lectura defensiva si tabla no existe)
// ============================================================
// Estos helpers replican los de handlers/duel.js. Los inline aquí
// para evitar import circular (handlers → engine). Si la tabla
// `duels` no existe (migración no corrida), los helpers devuelven
// null y attackPlayer cae al comportamiento S27 (PVP solo wild).

async function getActiveDuelBetween(db, userIdA, userIdB) {
  const [a, b] = userIdA < userIdB ? [userIdA, userIdB] : [userIdB, userIdA];
  try {
    const row = await db.first(
      `SELECT id, user_a_id, user_b_id, leave_cast_ends_at, ended_at
       FROM duels
       WHERE ended_at IS NULL AND user_a_id = ? AND user_b_id = ?
       LIMIT 1`,
      [a, b]
    );
    return row || null;
  } catch {
    return null;
  }
}

async function getActiveDuelForUser(db, userId) {
  try {
    const row = await db.first(
      `SELECT id, user_a_id, user_b_id, leave_cast_ends_at, ended_at
       FROM duels
       WHERE ended_at IS NULL AND (user_a_id = ? OR user_b_id = ?)
       LIMIT 1`,
      [userId, userId]
    );
    return row || null;
  } catch {
    return null;
  }
}

async function closeDuelById(db, duelId, now) {
  try {
    await db.run(
      `UPDATE duels SET ended_at = ? WHERE id = ? AND ended_at IS NULL`,
      [now, duelId]
    );
  } catch {}
}

// Helper PVP: inserta en el primer slot libre o preferido del inventario.
async function safeInsertInvSlot(db, userId, itemId, qty, preferredSlot) {
  const MAX_SLOTS = 20;
  const used = await db.all(
    `SELECT slot_index FROM user_inventory WHERE user_id = ?`,
    [userId]
  );
  const occupied = new Set((used || []).map(r => r.slot_index));

  let slot = -1;
  if (preferredSlot != null && !occupied.has(preferredSlot) && preferredSlot >= 0 && preferredSlot < MAX_SLOTS) {
    slot = preferredSlot;
  } else {
    for (let i = 0; i < MAX_SLOTS; i++) {
      if (!occupied.has(i)) { slot = i; break; }
    }
  }
  if (slot === -1) {
    console.warn('[combat/pvp-death] inventory full, item lost:', itemId);
    return;
  }
  await db.run(
    `INSERT INTO user_inventory (user_id, slot_index, item_id, quantity) VALUES (?, ?, ?, ?)`,
    [userId, slot, itemId, qty]
  );
}
// ============================================================
// Sesión 39 — TICK DE IA DE NPC (agro + persecución + contraataque)
// ============================================================
//
// Diseño "on-read": no hay loop de servidor (Workers son stateless). En su
// lugar, el snapshot handler llama a tickNpcAggro() cada vez que un cliente
// pollea (~250ms). Para cada NPC AGRESIVO cercano:
//   1. AGRO: si hay un jugador dentro de aggro_radius y el NPC no tiene target
//      (o el suyo se fue), lo marca (in_combat_with).
//   2. PERSECUCIÓN: si tiene target fuera de attack_range pero dentro del
//      leash, da un paso hacia él (velocidad * dt). Escribe x,z → el cliente
//      lo interpola suave. Server-authoritative: cero desync.
//   3. CONTRAATAQUE: si el target está en attack_range y el cooldown del NPC
//      está listo, rollea daño (misma matemática que el contraataque normal)
//      y se lo aplica al jugador + last_hit_* (la Pieza 1 hace que TODOS lo
//      vean vía el hitsplat de peer).
//   4. DE-AGGRO: si el target murió, se desconectó, o se alejó más del leash
//      desde el spawn del NPC → suelta el target y (futuro) vuelve a casa.
//
// Determinismo / concurrencia: dos polls casi simultáneos podrían tickear el
// mismo NPC. El movimiento usa last_attack_at/last_moved como gate temporal y
// el paso es idempotente-ish (mover hacia el target converge). El daño está
// gateado por last_attack_at del NPC (no puede pegar más rápido que su
// cooldown aunque lleguen 10 polls). Esto también CIERRA el exploit de
// multi-click server-side: el cooldown del NPC es autoritativo.
//
// Tuneable: NPC_MOVE_SPEED_MPS, NPC_LEASH_M.

const NPC_MOVE_SPEED_MPS = 2.55;  // m/s de persecución (Nico pidió subirlo un pelín)
const NPC_LEASH_M = 12.0;         // si el target se aleja > esto del SPAWN, de-aggro
const NPC_AI_MAX_STEP_MS = 400;   // cap del dt por tick (evita saltos si un poll tardó)

/**
 * Avanza la IA de los NPCs agresivos cercanos al centro del snapshot.
 * Devuelve un Map npcId -> {x, z, in_combat_with} con los cambios aplicados,
 * para que el snapshot handler refleje las posiciones nuevas sin re-query.
 *
 * @param db          adapter D1 (makeDbAdapter)
 * @param env         para env.DB.prepare (queries directas)
 * @param viewer      { user_id, x, z } del jugador que pollea
 * @param now         Date.now()
 * @param opts        { rng } opcional para tests
 */
export async function tickNpcAggro(env, viewer, now, opts = {}) {
  const rng = opts.rng || Math.random;
  const changes = new Map();
  if (!viewer || !Number.isFinite(viewer.x) || !Number.isFinite(viewer.z)) return changes;

  // 1) NPCs agresivos vivos cerca del viewer (bounding box ~aggro+leash).
  const R = 60; // margen generoso de búsqueda
  let npcs;
  try {
    npcs = await env.DB.prepare(
      `SELECT i.id, i.def_id, i.x, i.z, i.hp_current, i.status,
              i.in_combat_with, i.last_attack_at, i.last_moved_at, i.spawn_x, i.spawn_z,
              d.behavior, d.aggro_radius, d.attack_range, d.attack_speed_ticks,
              d.attack_lvl, d.strength_lvl, d.max_hit
       FROM npc_instances i
       JOIN npc_defs d ON d.id = i.def_id
       WHERE i.status = 0
         AND d.behavior = 'aggressive'
         AND i.x BETWEEN ? AND ? AND i.z BETWEEN ? AND ?`
    ).bind(viewer.x - R, viewer.x + R, viewer.z - R, viewer.z + R).all();
  } catch (err) {
    // Si la migración no corrió (no existe columna behavior), no-op silencioso.
    return changes;
  }

  const rows = (npcs && npcs.results) || [];
  if (rows.length === 0) return changes;

  // Stats del viewer (HP + defensa) para el contraataque.
  let viewerStats;
  try {
    viewerStats = await env.DB.prepare(
      `SELECT hp_current, defence_xp FROM combat_stats WHERE user_id = ?`
    ).bind(viewer.user_id).first();
  } catch { viewerStats = null; }
  if (!viewerStats || viewerStats.hp_current <= 0) return changes; // muerto: no agro

  const viewerDefLvl = viewerStats.defence_xp != null ? levelFromXp(viewerStats.defence_xp) : 1;
  let viewerHp = viewerStats.hp_current;

  for (const npc of rows) {
    const dToViewer = dist(viewer.x, viewer.z, npc.x, npc.z);

    // ---- DE-AGGRO por leash: si está lejísimos de su spawn, soltar y parar.
    const homeX = npc.spawn_x != null ? npc.spawn_x : npc.x;
    const homeZ = npc.spawn_z != null ? npc.spawn_z : npc.z;
    const dFromHome = dist(homeX, homeZ, npc.x, npc.z);

    // ---- AGRO: adquirir target si estoy en su radio y no tiene (o es el viewer).
    let target = npc.in_combat_with;
    // Sesión 39 fix — Si el target guardado NO es el viewer pero el viewer SÍ
    // está dentro del radio de agro, re-adquirimos al viewer. Esto evita que un
    // "in_combat_with" viejo/fantasma (un jugador que se fue, o un lock que
    // quedó de una sesión anterior) bloquee el agro para siempre. El NPC
    // siempre puede re-enganchar a alguien que tiene al lado.
    if (dToViewer <= npc.aggro_radius && target !== viewer.user_id) {
      target = viewer.user_id;
    } else if (!target && dToViewer <= npc.aggro_radius) {
      target = viewer.user_id;
    }
    // Si su target es el viewer pero el viewer se fue del leash desde el spawn,
    // de-aggro (volver a casa lo hace el paso de movimiento de abajo).
    if (target === viewer.user_id && dFromHome > NPC_LEASH_M) {
      target = null;
    }

    let newX = npc.x, newZ = npc.z;
    let attacked = false;
    let dmg = 0;

    if (target === viewer.user_id) {
      const attackRange = Math.min(npc.attack_range + RANGE_TOLERANCE, MELEE_MAX_RANGE);

      // ---- PERSECUCIÓN: si fuera de rango, paso hacia el viewer.
      if (dToViewer > attackRange) {
        // dt real desde el último movimiento (gate de concurrencia: si dos
        // polls llegan juntos, el segundo ve last_moved_at recién y mueve ~0).
        const lastMoved = npc.last_moved_at || (now - 250);
        const dtMs = Math.min(Math.max(0, now - lastMoved), NPC_AI_MAX_STEP_MS);
        const step = NPC_MOVE_SPEED_MPS * (dtMs / 1000);
        const ux = (viewer.x - npc.x) / (dToViewer || 1);
        const uz = (viewer.z - npc.z) / (dToViewer || 1);
        // No pasarse: como mucho, hasta dejar attackRange*0.9 de separación.
        const move = Math.min(step, Math.max(0, dToViewer - attackRange * 0.9));
        newX = npc.x + ux * move;
        newZ = npc.z + uz * move;
      } else {
        // ---- CONTRAATAQUE: en rango y cooldown listo.
        const cooldownMs = (npc.attack_speed_ticks || 4) * TICK_MS;
        const ready = !npc.last_attack_at || (now - npc.last_attack_at) >= cooldownMs;
        if (ready && viewerHp > 0) {
          const roll = rollHit(rng, npc.attack_lvl, viewerDefLvl, npc.max_hit);
          dmg = Math.min(roll.damage, viewerHp);
          attacked = true;
        }
      }
    }

    // ---- Aplicar cambios a la DB ----
    const moved = (newX !== npc.x || newZ !== npc.z);
    const targetChanged = (target || null) !== (npc.in_combat_with || null);

    if (attacked) {
      viewerHp = Math.max(0, viewerHp - dmg);
      // Daño al jugador + last_hit_* (la Pieza 1 lo muestra a todos).
      try {
        await env.DB.prepare(
          `UPDATE combat_stats
             SET hp_current = ?, last_hit_from_user_id = NULL,
                 last_hit_damage = ?, last_hit_at = ?, last_hit_is_crit = 0
           WHERE user_id = ?`
        ).bind(viewerHp, dmg, now, viewer.user_id).run();
      } catch {}
      // combat_log: attacker_type=1 (npc), target_type=0 (player)
      try {
        await env.DB.prepare(
          `INSERT INTO combat_log (ts, attacker_type, attacker_id, target_type, target_id, damage, hit, killed)
           VALUES (?, 1, ?, 0, ?, ?, ?, ?)`
        ).bind(now, npc.id, viewer.user_id, dmg, dmg > 0 ? 1 : 0, viewerHp <= 0 ? 1 : 0).run();
      } catch {}
      if (viewerHp <= 0) {
        try {
          await env.DB.prepare(
            `UPDATE combat_stats SET last_died_at = ? WHERE user_id = ?`
          ).bind(now, viewer.user_id).run();
        } catch {}
      }
    }

    if (moved || targetChanged || attacked) {
      try {
        await env.DB.prepare(
          `UPDATE npc_instances
             SET x = ?, z = ?, in_combat_with = ?, last_attack_at = ?, last_moved_at = ?
           WHERE id = ?`
        ).bind(
          newX, newZ,
          target || null,
          attacked ? now : npc.last_attack_at,
          moved ? now : (npc.last_moved_at || null),
          npc.id
        ).run();
      } catch {}
      changes.set(npc.id, { x: newX, z: newZ, in_combat_with: target || null });
    }
  }

  return changes;
}
