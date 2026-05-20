/**
 * SebasPresent — Woodcutting handler (Sesión 30 + S31 rebalance)
 *
 * Endpoint:
 *   POST /api/woodcutting/chop { tree_type, x, z }
 *
 * ─────────────────────────────────────────────────────────────────────────
 * Mecánica nueva (S31, estilo OSRS):
 *
 * Cada llamada hace DOS rolls separados:
 *
 *   1) ROLL DE ÉXITO (chop_success)
 *      Probabilidad de "cortar" en este intento. Si falla → no log, no XP,
 *      el cliente sigue talando el mismo árbol. Si tiene éxito → +1 log + XP.
 *      Probabilidad scaling lineal: baseSuccess (lvl req) → maxSuccess (lvl 99).
 *
 *   2) ROLL DE "ÁRBOL CAE" (tree_falls)
 *      Solo si el roll 1 fue éxito. Probabilidad de que el árbol se caiga
 *      tras este log. Si cae → árbol depleted (respawn variable según
 *      especie) + cliente para el loop. Si no cae → árbol sigue, podés
 *      seguir talándolo.
 *
 * Resultado: un árbol da 1-N logs antes de caerse, similar a OSRS. Hay
 * varianza, no es siempre "1 chop = 1 log + cae".
 *
 * ─────────────────────────────────────────────────────────────────────────
 * Respuesta:
 *
 *   Cuando log_gained = true:
 *     { ok: true, log_gained: true, tree_falls: bool, log_item, xp_gained,
 *       skill_id, new_xp, new_level, level_up, levels_gained, prev_level,
 *       depleted_until: number | null }
 *
 *   Cuando log_gained = false (chop falló):
 *     { ok: true, log_gained: false, tree_falls: false, message: 'no_log' }
 *
 *   Errores (igual que antes):
 *     { error: 'tree_depleted' | 'no_axe' | 'level_too_low' | ... }
 *
 * ─────────────────────────────────────────────────────────────────────────
 * Backwards compat:
 *   Si un cliente VIEJO (que no sabe de log_gained) recibe log_gained=false
 *   con log_item=null, simplemente no podrá agregar el log al inventario
 *   (porque log_item es null) — no rompe, solo no muestra mensaje.
 *
 * Anti-cheat:
 *   - Server controla XP/log values/rolls via TREE_DEFS y Math.random server-side.
 *   - Cliente NO ve los % de éxito ni puede manipularlos.
 */

import { json, readJson } from '../lib/db.js';
import { requireSession } from '../lib/auth.js';
import { applyXpGrant, xpToLevel, startingXpFor } from '../lib/skills_engine.js';

// ─────────────────────────────────────────────────────────────────────────
// Catálogo de árboles — INVARIANTE: tiene que coincidir con TREE_TYPES en
// client/src/terrain.js líneas ~95-108. Si tocás uno, tocá el otro.
//
// Campos:
//   chopLevel:     nivel de woodcutting requerido
//   xpReward:      XP por log conseguido (no por intento)
//   logItem:       item_id del log que produce
//   baseSuccess:   chop_success% al nivel mínimo (0-1)
//   maxSuccess:    chop_success% al nivel 99 (0-1, scaling lineal)
//   treeFalls:     prob de caer tras cada log conseguido (0-1)
//   respawnMs:     tiempo de respawn (ms) — solo se aplica si tree_falls
// ─────────────────────────────────────────────────────────────────────────
const TREE_DEFS = {
  normal:    { name: 'Árbol',        chopLevel: 1,  xpReward: 25,  logItem: 'logs',
               baseSuccess: 0.75, maxSuccess: 0.95, treeFalls: 0.40, respawnMs:    30_000 },
  oak:       { name: 'Roble',        chopLevel: 15, xpReward: 37,  logItem: 'oak_logs',
               baseSuccess: 0.40, maxSuccess: 0.85, treeFalls: 0.12, respawnMs:    60_000 },
  palm:      { name: 'Palmera',      chopLevel: 20, xpReward: 35,  logItem: 'palm_logs',
               baseSuccess: 0.40, maxSuccess: 0.80, treeFalls: 0.15, respawnMs:   120_000 },
  pine:      { name: 'Pino',         chopLevel: 30, xpReward: 65,  logItem: 'pine_logs',
               baseSuccess: 0.35, maxSuccess: 0.80, treeFalls: 0.10, respawnMs:   120_000 },
  willow:    { name: 'Sauce',        chopLevel: 30, xpReward: 67,  logItem: 'willow_logs',
               baseSuccess: 0.35, maxSuccess: 0.80, treeFalls: 0.08, respawnMs:   180_000 },
  teak:      { name: 'Teca',         chopLevel: 35, xpReward: 85,  logItem: 'teak_logs',
               baseSuccess: 0.30, maxSuccess: 0.75, treeFalls: 0.08, respawnMs:   240_000 },
  maple:     { name: 'Arce',         chopLevel: 45, xpReward: 100, logItem: 'maple_logs',
               baseSuccess: 0.25, maxSuccess: 0.70, treeFalls: 0.06, respawnMs:   360_000 },
  mahogany:  { name: 'Caoba',        chopLevel: 50, xpReward: 125, logItem: 'mahogany_logs',
               baseSuccess: 0.22, maxSuccess: 0.65, treeFalls: 0.05, respawnMs:   480_000 },
  yew:       { name: 'Tejo',         chopLevel: 60, xpReward: 175, logItem: 'yew_logs',
               baseSuccess: 0.18, maxSuccess: 0.55, treeFalls: 0.03, respawnMs:   900_000 },
  magic:     { name: 'Árbol Mágico', chopLevel: 75, xpReward: 250, logItem: 'magic_logs',
               baseSuccess: 0.12, maxSuccess: 0.40, treeFalls: 0.01, respawnMs: 1_800_000 },
  dead:      { name: 'Árbol Muerto', chopLevel: 1,  xpReward: 12,  logItem: 'dead_logs',
               baseSuccess: 0.80, maxSuccess: 0.95, treeFalls: 0.50, respawnMs:    30_000 },
  bush:      { name: 'Arbusto',      chopLevel: 1,  xpReward: 8,   logItem: 'bush_leaves',
               baseSuccess: 0.80, maxSuccess: 0.95, treeFalls: 0.50, respawnMs:    30_000 },
  bush_small:{ name: 'Matorral',     chopLevel: 1,  xpReward: 5,   logItem: 'bush_leaves',
               baseSuccess: 0.80, maxSuccess: 0.95, treeFalls: 0.50, respawnMs:    30_000 },
};

const MAX_CHOP_DIST_M = 3.5;
const TREE_POS_TOLERANCE_M = 0.05;
const SKILL_ID = 'woodcutting';
const INVENTORY_SLOTS = 28;
const MAX_LEVEL_FOR_SCALING = 99;

async function wcTablesExist(env) {
  try {
    await env.DB.prepare('SELECT 1 FROM tree_state LIMIT 1').all();
    return true;
  } catch {
    return false;
  }
}

async function hasAxeAvailable(env, userId) {
  const invRow = await env.DB.prepare(
    "SELECT 1 FROM user_inventory WHERE user_id = ? AND item_id = 'axe' LIMIT 1"
  ).bind(userId).first();
  if (invRow) return true;

  try {
    const eqRow = await env.DB.prepare(
      "SELECT 1 FROM user_equipment WHERE user_id = ? AND slot_id = 'weapon' AND item_id = 'axe' LIMIT 1"
    ).bind(userId).first();
    if (eqRow) return true;
  } catch {
    // user_equipment puede no existir en algunos despliegues — silencio.
  }
  return false;
}

async function findInventorySpotForItem(env, userId, itemId) {
  const stackRow = await env.DB.prepare(
    'SELECT slot_index, quantity FROM user_inventory WHERE user_id = ? AND item_id = ? LIMIT 1'
  ).bind(userId, itemId).first();
  if (stackRow) return { kind: 'stack', slot: stackRow.slot_index };
  const usedRows = await env.DB.prepare(
    'SELECT slot_index FROM user_inventory WHERE user_id = ?'
  ).bind(userId).all();
  const used = new Set((usedRows.results || []).map(r => r.slot_index));
  for (let i = 0; i < INVENTORY_SLOTS; i++) {
    if (!used.has(i)) return { kind: 'empty', slot: i };
  }
  return { kind: 'full' };
}

/**
 * Calcula la probabilidad de éxito del chop según nivel del player.
 * Scaling lineal entre baseSuccess (en chopLevel) y maxSuccess (en 99).
 */
function computeChopSuccessRate(def, playerLevel) {
  if (playerLevel <= def.chopLevel) return def.baseSuccess;
  if (playerLevel >= MAX_LEVEL_FOR_SCALING) return def.maxSuccess;
  const range = MAX_LEVEL_FOR_SCALING - def.chopLevel;
  const progress = (playerLevel - def.chopLevel) / range;
  return def.baseSuccess + (def.maxSuccess - def.baseSuccess) * progress;
}

export async function handleWoodcuttingChop(request, env) {
  const session = await requireSession(request, env);
  if (!session) return json({ error: 'unauthorized' }, 401);

  if (!(await wcTablesExist(env))) {
    return json({ error: 'wc_disabled', message: 'Tabla tree_state no existe.' }, 503);
  }

  const body = await readJson(request);
  if (!body) return json({ error: 'bad_request' }, 400);

  const treeType = String(body.tree_type || '');
  const x = Number(body.x);
  const z = Number(body.z);

  if (!TREE_DEFS[treeType]) {
    return json({ error: 'invalid_tree_type', message: `tree_type desconocido: ${treeType}` }, 400);
  }
  if (!Number.isFinite(x) || !Number.isFinite(z)) {
    return json({ error: 'invalid_pos' }, 400);
  }

  const def = TREE_DEFS[treeType];
  const userId = session.user_id;
  const now = Date.now();

  // 1) Proximidad
  const meRow = await env.DB.prepare(
    'SELECT x, z FROM online_users WHERE user_id = ?'
  ).bind(userId).first();
  if (!meRow) return json({ error: 'no_position', message: 'Sin heartbeat reciente.' }, 400);
  const dx = meRow.x - x, dz = meRow.z - z;
  const distSq = dx * dx + dz * dz;
  if (distSq > MAX_CHOP_DIST_M * MAX_CHOP_DIST_M) {
    return json({
      error: 'out_of_range',
      message: 'Demasiado lejos del árbol.',
      distance: Math.sqrt(distSq).toFixed(2),
    }, 400);
  }

  // 2) Axe
  const hasAxe = await hasAxeAvailable(env, userId);
  if (!hasAxe) {
    return json({ error: 'no_axe', message: 'Necesitas un hacha.' }, 400);
  }

  // 3) Level check
  const skillRow = await env.DB.prepare(
    'SELECT xp FROM user_skills WHERE user_id = ? AND skill_id = ?'
  ).bind(userId, SKILL_ID).first();
  const currentXp = skillRow ? skillRow.xp : startingXpFor(SKILL_ID);
  const currentLevel = xpToLevel(currentXp);
  if (currentLevel < def.chopLevel) {
    return json({
      error: 'level_too_low',
      message: `Necesitas nivel ${def.chopLevel} de Tala.`,
      required_level: def.chopLevel,
      current_level: currentLevel,
    }, 400);
  }

  // 4) Depleted?
  const tol = TREE_POS_TOLERANCE_M;
  const depRow = await env.DB.prepare(
    `SELECT depleted_until FROM tree_state
     WHERE x BETWEEN ? AND ? AND z BETWEEN ? AND ? AND depleted_until > ?
     LIMIT 1`
  ).bind(x - tol, x + tol, z - tol, z + tol, now).first();
  if (depRow) {
    return json({
      error: 'tree_depleted',
      message: 'Árbol agotado, espera el respawn.',
      depleted_until: depRow.depleted_until,
    }, 400);
  }

  // 5) ROLL 1 — éxito del chop
  const chopSuccessRate = computeChopSuccessRate(def, currentLevel);
  const chopRoll = Math.random();
  const chopSuccess = chopRoll < chopSuccessRate;

  if (!chopSuccess) {
    return json({
      ok: true,
      log_gained: false,
      tree_falls: false,
      message: 'no_log',
      chop_success_rate: +chopSuccessRate.toFixed(3),
    });
  }

  // 6) Espacio inv? (solo chequea si efectivamente vamos a dar log)
  const spot = await findInventorySpotForItem(env, userId, def.logItem);
  if (spot.kind === 'full') {
    return json({ error: 'inventory_full', message: 'Mochila llena.' }, 400);
  }

  // 7) ROLL 2 — el árbol cae?
  const fallsRoll = Math.random();
  const treeFalls = fallsRoll < def.treeFalls;
  const depletedUntil = treeFalls ? now + def.respawnMs : null;

  // 8) Aplicar todo en batch
  const xpResult = applyXpGrant(currentXp, def.xpReward);
  const prevLevel = currentLevel;
  const xKey = Math.round(x * 100) / 100;
  const zKey = Math.round(z * 100) / 100;

  const stmts = [];
  if (skillRow) {
    stmts.push(env.DB.prepare(
      'UPDATE user_skills SET xp = ?, updated_at = ? WHERE user_id = ? AND skill_id = ?'
    ).bind(xpResult.newXp, now, userId, SKILL_ID));
  } else {
    stmts.push(env.DB.prepare(
      'INSERT INTO user_skills (user_id, skill_id, xp, updated_at) VALUES (?, ?, ?, ?)'
    ).bind(userId, SKILL_ID, xpResult.newXp, now));
  }
  if (spot.kind === 'stack') {
    stmts.push(env.DB.prepare(
      'UPDATE user_inventory SET quantity = quantity + 1, updated_at = ? WHERE user_id = ? AND slot_index = ?'
    ).bind(now, userId, spot.slot));
  } else {
    stmts.push(env.DB.prepare(
      'INSERT INTO user_inventory (user_id, slot_index, item_id, quantity, updated_at) VALUES (?, ?, ?, 1, ?)'
    ).bind(userId, spot.slot, def.logItem, now));
  }
  if (treeFalls) {
    stmts.push(env.DB.prepare(
      'INSERT OR REPLACE INTO tree_state (x, z, tree_type, depleted_until) VALUES (?, ?, ?, ?)'
    ).bind(xKey, zKey, treeType, depletedUntil));
  }

  await env.DB.batch(stmts);

  return json({
    ok: true,
    log_gained: true,
    tree_falls: treeFalls,
    log_item: def.logItem,
    xp_gained: def.xpReward,
    skill_id: SKILL_ID,
    new_xp: xpResult.newXp,
    new_level: xpResult.newLevel,
    level_up: xpResult.levelUp,
    levels_gained: xpResult.levelsGained,
    prev_level: prevLevel,
    depleted_until: depletedUntil,
    chop_success_rate: +chopSuccessRate.toFixed(3),
  });
}
