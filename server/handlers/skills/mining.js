/**
 * SebasPresent — Minería (Sesión 50)
 *
 * Endpoint:
 *   POST /api/mining/mine { vein_id }
 *
 * Diferencia clave con la tala: el cliente SOLO manda el id de la veta.
 * Posición y mineral los saca el server del generador compartido
 * (client/src/shared/ore_veins.js), así que no se pueden inventar vetas.
 *
 * Anti-trampas:
 *   - La veta tiene que existir (getVeinById) y estar a ≤ MAX_MINE_DIST_M del
 *     jugador (posición del heartbeat).
 *   - Ritmo: como mucho 1 golpe cada MIN_MINE_TICK_MS. Se hace con un UPDATE
 *     condicional sobre user_skills.updated_at: si llegan 10 peticiones a la
 *     vez, solo UNA pasa el filtro (las demás ven changes = 0 → too_fast).
 *   - XP e inventario se suman con `x = x + ?` (nunca valores absolutos), así
 *     dos peticiones no se pisan.
 *
 * Tabla nueva: rock_state (vein_id TEXT PK, depleted_until INTEGER)
 *   → server/migrations/001_rock_state.sql
 */

import { json, readJson } from '../../lib/db.js';
import { requireSession } from '../../lib/auth.js';
import { xpToLevel, MAX_XP } from '../../lib/skills_engine.js';
import {
  tableExists, findInventorySpotForItem, getPlayerPosition, isWithinDistance,
} from './_shared.js';
import { getVeinById, ORE_TIERS, miningSuccessRate } from '../../../client/src/shared/ore_veins.js';
import { questEvent } from '../../lib/quests.js';

const SKILL_ID = 'mining';
const MAX_MINE_DIST_M = 3.8;     // cliente usa 3.0 (más estricto)
const MIN_MINE_TICK_MS = 1500;   // cliente pica cada ~1800ms

async function hasPickaxe(env, userId) {
  const row = await env.DB.prepare(
    `SELECT 1 FROM user_inventory inv JOIN items i ON i.id = inv.item_id
      WHERE inv.user_id = ? AND i.weapon_type = 'pickaxe'
     UNION ALL
     SELECT 1 FROM user_equipment eq JOIN items i ON i.id = eq.item_id
      WHERE eq.user_id = ? AND eq.slot_id = 'weapon' AND i.weapon_type = 'pickaxe'
     LIMIT 1`
  ).bind(userId, userId).first();
  return !!row;
}

export async function handleMiningMine(request, env) {
  const session = await requireSession(request, env);
  if (!session) return json({ error: 'unauthorized' }, 401);

  if (!(await tableExists(env, 'rock_state'))) {
    return json({ error: 'mining_disabled', message: 'Minería no disponible todavía.' }, 503);
  }

  const body = await readJson(request);
  const vein = getVeinById(body?.vein_id);
  if (!vein) return json({ error: 'invalid_vein', message: 'Esa veta no existe.' }, 400);
  const def = ORE_TIERS[vein.tier];

  const userId = session.user_id;
  const now = Date.now();

  // 1) Distancia (posición del heartbeat, no la que diga el body)
  const pos = await getPlayerPosition(env, userId);
  if (!pos) return json({ error: 'no_position', message: 'Sin posición reciente.' }, 400);
  const dist = isWithinDistance(pos, vein.x, vein.z, MAX_MINE_DIST_M);
  if (!dist.ok) {
    return json({ error: 'out_of_range', message: 'Demasiado lejos de la veta.', distance: +dist.distance.toFixed(2) }, 400);
  }

  // 2) Pico
  if (!(await hasPickaxe(env, userId))) {
    return json({ error: 'no_pickaxe', message: 'Necesitas un pico.' }, 400);
  }

  // 3) Nivel
  await env.DB.prepare(
    `INSERT OR IGNORE INTO user_skills (user_id, skill_id, xp, updated_at) VALUES (?, ?, 0, 0)`
  ).bind(userId, SKILL_ID).run();
  const skillRow = await env.DB.prepare(
    'SELECT xp FROM user_skills WHERE user_id = ? AND skill_id = ?'
  ).bind(userId, SKILL_ID).first();
  const currentXp = skillRow?.xp || 0;
  const currentLevel = xpToLevel(currentXp);
  if (currentLevel < def.level) {
    return json({
      error: 'level_too_low',
      message: `Necesitas nivel ${def.level} de Minería.`,
      required_level: def.level, current_level: currentLevel,
    }, 400);
  }

  // 4) Veta agotada
  const dep = await env.DB.prepare(
    'SELECT depleted_until FROM rock_state WHERE vein_id = ? AND depleted_until > ?'
  ).bind(vein.id, now).first();
  if (dep) {
    return json({ error: 'vein_depleted', message: 'La veta está agotada.', depleted_until: dep.depleted_until }, 400);
  }

  // 5) Ritmo — cerrojo atómico (ver cabecera)
  const gate = await env.DB.prepare(
    `UPDATE user_skills SET updated_at = ?
      WHERE user_id = ? AND skill_id = ? AND updated_at <= ?`
  ).bind(now, userId, SKILL_ID, now - MIN_MINE_TICK_MS).run();
  if (!gate?.meta?.changes) {
    return json({ error: 'too_fast', message: 'Espera un momento.' }, 429);
  }

  // 6) Tirada de éxito
  const rate = miningSuccessRate(def, currentLevel);
  if (Math.random() >= rate) {
    return json({ ok: true, ore_gained: false, depleted: false, vein_id: vein.id, success_rate: +rate.toFixed(3) });
  }

  const spot = await findInventorySpotForItem(env, userId, def.oreItem);
  if (spot.kind === 'full') {
    return json({ error: 'inventory_full', message: 'Mochila llena.' }, 400);
  }

  const depleted = Math.random() < def.depleteChance;
  const depletedUntil = depleted ? now + def.respawnMs : null;

  const stmts = [
    env.DB.prepare(
      `UPDATE user_skills SET xp = MIN(xp + ?, ?) WHERE user_id = ? AND skill_id = ?`
    ).bind(def.xp, MAX_XP, userId, SKILL_ID),
    spot.kind === 'stack'
      ? env.DB.prepare(
          'UPDATE user_inventory SET quantity = quantity + 1, updated_at = ? WHERE user_id = ? AND slot_index = ?'
        ).bind(now, userId, spot.slot)
      : env.DB.prepare(
          'INSERT INTO user_inventory (user_id, slot_index, item_id, quantity, updated_at) VALUES (?, ?, ?, 1, ?)'
        ).bind(userId, spot.slot, def.oreItem, now),
  ];
  if (depleted) {
    stmts.push(env.DB.prepare(
      'INSERT OR REPLACE INTO rock_state (vein_id, depleted_until) VALUES (?, ?)'
    ).bind(vein.id, depletedUntil));
  }
  await env.DB.batch(stmts);
  await questEvent(env, userId, 'mine', vein.tier);   // misiones

  const after = await env.DB.prepare(
    'SELECT xp FROM user_skills WHERE user_id = ? AND skill_id = ?'
  ).bind(userId, SKILL_ID).first();
  const newXp = after?.xp ?? currentXp + def.xp;
  const newLevel = xpToLevel(newXp);

  return json({
    ok: true,
    ore_gained: true,
    ore_item: def.oreItem,
    vein_id: vein.id,
    tier: vein.tier,
    xp_gained: def.xp,
    skill_id: SKILL_ID,
    new_xp: newXp,
    new_level: newLevel,
    prev_level: currentLevel,
    level_up: newLevel > currentLevel,
    depleted,
    depleted_until: depletedUntil,
    success_rate: +rate.toFixed(3),
  });
}
