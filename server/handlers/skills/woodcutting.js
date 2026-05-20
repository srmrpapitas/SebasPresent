/**
 * SebasPresent — Woodcutting handler (Sesión 30 + S31 rebalance + S32 reorg)
 *
 * Endpoint:
 *   POST /api/woodcutting/chop { tree_type, x, z }
 *
 * Movido a server/handlers/skills/ en S32 para simetría con client/src/skills/.
 *
 * Mecánica (S31, estilo OSRS):
 *   Cada llamada hace DOS rolls separados:
 *     1) chop_success — prob de cortar (scaling lineal por nivel)
 *     2) tree_falls — prob de que el árbol caiga tras el log
 *   Resultado: 1-N logs por árbol antes de que caiga.
 */

import { json, readJson } from '../../lib/db.js';
import { requireSession } from '../../lib/auth.js';
import { applyXpGrant, xpToLevel, startingXpFor } from '../../lib/skills_engine.js';
import {
  tableExists,
  hasItemAvailable,
  findInventorySpotForItem,
  getPlayerPosition,
  isWithinDistance,
} from './_shared.js';

// Catálogo de árboles — INVARIANTE: tiene que coincidir con TREE_TYPES en
// client/src/terrain.js. Si tocás uno, tocá el otro.
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
const MAX_LEVEL_FOR_SCALING = 99;

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

  if (!(await tableExists(env, 'tree_state'))) {
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
  const playerPos = await getPlayerPosition(env, userId);
  if (!playerPos) return json({ error: 'no_position', message: 'Sin heartbeat reciente.' }, 400);
  const dist = isWithinDistance(playerPos, x, z, MAX_CHOP_DIST_M);
  if (!dist.ok) {
    return json({
      error: 'out_of_range',
      message: 'Demasiado lejos del árbol.',
      distance: dist.distance.toFixed(2),
    }, 400);
  }

  // 2) Axe (en inv o equipado)
  if (!(await hasItemAvailable(env, userId, 'axe'))) {
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
  const chopSuccess = Math.random() < chopSuccessRate;

  if (!chopSuccess) {
    return json({
      ok: true,
      log_gained: false,
      tree_falls: false,
      message: 'no_log',
      chop_success_rate: +chopSuccessRate.toFixed(3),
    });
  }

  // 6) Espacio inv?
  const spot = await findInventorySpotForItem(env, userId, def.logItem);
  if (spot.kind === 'full') {
    return json({ error: 'inventory_full', message: 'Mochila llena.' }, 400);
  }

  // 7) ROLL 2 — el árbol cae?
  const treeFalls = Math.random() < def.treeFalls;
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
