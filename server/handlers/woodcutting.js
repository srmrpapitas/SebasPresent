/**
 * SebasPresent — Woodcutting handler (Sesión 30)
 *
 * Endpoint:
 *   POST /api/woodcutting/chop { tree_type, x, z }
 *
 * Flujo:
 *   1) Valida sesión + tree_type contra TREE_DEFS.
 *   2) Valida proximidad: pos del player desde online_users debe estar
 *      a <= MAX_CHOP_DIST_M del (x, z) del árbol.
 *   3) Valida axe en inventario.
 *   4) Valida nivel de woodcutting >= chopLevel del árbol.
 *   5) Valida que la pos (x, z) NO esté ya depleted en tree_state.
 *   6) Verifica espacio en inventario (slot libre O stack existente).
 *   7) Aplica grant XP + inserta/incrementa log + marca tree_state.depleted_until.
 *
 * Defensive: si tabla `tree_state` no existe → 503 'wc_disabled'.
 *
 * Anti-cheat:
 *   - Server controla XP/log values via TREE_DEFS (cliente NO los manda).
 *   - Server valida proximidad usando online_users (heartbeat ~500ms).
 *
 * Respuesta:
 *   { ok, log_item, xp_gained, skill_id, new_xp, new_level, level_up,
 *     levels_gained, prev_level, depleted_until }
 */

import { json, readJson } from '../lib/db.js';
import { requireSession } from '../lib/auth.js';
import { applyXpGrant, xpToLevel, startingXpFor } from '../lib/skills_engine.js';

// Catálogo de árboles. DEBE coincidir con TREE_TYPES en client/src/terrain.js
// líneas ~95-108. Si tocás uno, tocá el otro.
const TREE_DEFS = {
  normal:    { name: 'Árbol',        chopLevel: 1,  xpReward: 25,  logItem: 'logs' },
  oak:       { name: 'Roble',        chopLevel: 15, xpReward: 37,  logItem: 'oak_logs' },
  palm:      { name: 'Palmera',      chopLevel: 20, xpReward: 35,  logItem: 'palm_logs' },
  pine:      { name: 'Pino',         chopLevel: 30, xpReward: 65,  logItem: 'pine_logs' },
  willow:    { name: 'Sauce',        chopLevel: 30, xpReward: 67,  logItem: 'willow_logs' },
  teak:      { name: 'Teca',         chopLevel: 35, xpReward: 85,  logItem: 'teak_logs' },
  maple:     { name: 'Arce',         chopLevel: 45, xpReward: 100, logItem: 'maple_logs' },
  mahogany:  { name: 'Caoba',        chopLevel: 50, xpReward: 125, logItem: 'mahogany_logs' },
  yew:       { name: 'Tejo',         chopLevel: 60, xpReward: 175, logItem: 'yew_logs' },
  magic:     { name: 'Árbol Mágico', chopLevel: 75, xpReward: 250, logItem: 'magic_logs' },
  dead:      { name: 'Árbol Muerto', chopLevel: 1,  xpReward: 12,  logItem: 'dead_logs' },
  bush:      { name: 'Arbusto',      chopLevel: 1,  xpReward: 8,   logItem: 'bush_leaves' },
  bush_small:{ name: 'Matorral',     chopLevel: 1,  xpReward: 5,   logItem: 'bush_leaves' },
};

const MAX_CHOP_DIST_M = 3.5;
const TREE_POS_TOLERANCE_M = 0.05;
const TREE_RESPAWN_MS = 30_000;
const SKILL_ID = 'woodcutting';
const INVENTORY_SLOTS = 28;

async function wcTablesExist(env) {
  try {
    await env.DB.prepare('SELECT 1 FROM tree_state LIMIT 1').all();
    return true;
  } catch {
    return false;
  }
}

async function findAxeSlot(env, userId) {
  const row = await env.DB.prepare(
    "SELECT slot_index FROM user_inventory WHERE user_id = ? AND item_id = 'axe' LIMIT 1"
  ).bind(userId).first();
  return row ? row.slot_index : null;
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
  const axeSlot = await findAxeSlot(env, userId);
  if (axeSlot == null) {
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

  // 5) Espacio inv?
  const spot = await findInventorySpotForItem(env, userId, def.logItem);
  if (spot.kind === 'full') {
    return json({ error: 'inventory_full', message: 'Mochila llena.' }, 400);
  }

  // 6) Aplicar todo en batch
  const xpResult = applyXpGrant(currentXp, def.xpReward);
  const prevLevel = currentLevel;
  const depletedUntil = now + TREE_RESPAWN_MS;
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
  stmts.push(env.DB.prepare(
    'INSERT OR REPLACE INTO tree_state (x, z, tree_type, depleted_until) VALUES (?, ?, ?, ?)'
  ).bind(xKey, zKey, treeType, depletedUntil));

  await env.DB.batch(stmts);

  return json({
    ok: true,
    log_item: def.logItem,
    xp_gained: def.xpReward,
    skill_id: SKILL_ID,
    new_xp: xpResult.newXp,
    new_level: xpResult.newLevel,
    level_up: xpResult.levelUp,
    levels_gained: xpResult.levelsGained,
    prev_level: prevLevel,
    depleted_until: depletedUntil,
  });
}
