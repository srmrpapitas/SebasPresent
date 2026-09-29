/**
 * SebasPresent — Pesca (Sesión 50)
 *
 * Endpoint:
 *   POST /api/fishing/fish { spot_id }
 *
 * Mismo patrón que minería: el cliente solo manda el id del banco de peces.
 * Posición, tipo y si está activo ahora lo calcula el server con
 * client/src/shared/fishing.js (determinista por turnos de 5 min).
 *
 * Anti-trampas:
 *   - El spot existe, está ACTIVO en este turno y el jugador está a
 *     ≤ SPOT_USE_DIST_M (posición del heartbeat).
 *   - Herramienta en inventario (o equipada en weapon). Caña → gasta 1 pluma
 *     por pez (UPDATE condicional quantity >= 1).
 *   - Ritmo: cerrojo atómico sobre user_skills.updated_at.
 */

import { json, readJson } from '../../lib/db.js';
import { requireSession } from '../../lib/auth.js';
import { xpToLevel, MAX_XP } from '../../lib/skills_engine.js';
import {
  findInventorySpotForItem, getPlayerPosition, isWithinDistance,
} from './_shared.js';
import {
  SPOTS_BY_ID, SPOT_TYPES, TOOLS, FISH, SPOT_USE_DIST_M,
  isSpotActive, catchRate, spotMinLevel,
} from '../../../client/src/shared/fishing.js';
import { questEvent } from '../../lib/quests.js';

const SKILL_ID = 'fishing';
const MIN_FISH_TICK_MS = 1500;   // cliente lanza cada ~2400ms

async function hasTool(env, userId, itemId) {
  const row = await env.DB.prepare(
    `SELECT 1 FROM user_inventory WHERE user_id = ? AND item_id = ?
     UNION ALL
     SELECT 1 FROM user_equipment WHERE user_id = ? AND slot_id = 'weapon' AND item_id = ?
     LIMIT 1`
  ).bind(userId, itemId, userId, itemId).first();
  return !!row;
}

export async function handleFishingFish(request, env) {
  const session = await requireSession(request, env);
  if (!session) return json({ error: 'unauthorized' }, 401);

  const body = await readJson(request);
  const spot = SPOTS_BY_ID[body?.spot_id];
  if (!spot) return json({ error: 'invalid_spot', message: 'Ahí no hay peces.' }, 400);
  const type = SPOT_TYPES[spot.type];
  const tool = TOOLS[type.tool];

  const userId = session.user_id;
  const now = Date.now();

  // 1) ¿Sigue el banco de peces aquí?
  if (!isSpotActive(spot, now)) {
    return json({ error: 'spot_moved', message: 'El banco de peces se ha movido.' }, 400);
  }

  // 2) Distancia
  const pos = await getPlayerPosition(env, userId);
  if (!pos) return json({ error: 'no_position', message: 'Sin posición reciente.' }, 400);
  const dist = isWithinDistance(pos, spot.x, spot.z, SPOT_USE_DIST_M);
  if (!dist.ok) {
    return json({ error: 'out_of_range', message: 'Demasiado lejos del agua.', distance: +dist.distance.toFixed(2) }, 400);
  }

  // 3) Herramienta (+ cebo)
  if (!(await hasTool(env, userId, tool.item))) {
    return json({ error: 'no_tool', message: `Necesitas: ${tool.name}.`, tool: tool.item }, 400);
  }
  let baitSlot = null;
  if (tool.bait) {
    const b = await env.DB.prepare(
      'SELECT slot_index FROM user_inventory WHERE user_id = ? AND item_id = ? AND quantity >= 1 ORDER BY slot_index LIMIT 1'
    ).bind(userId, tool.bait).first();
    if (!b) return json({ error: 'no_bait', message: `No te quedan ${tool.baitName}.`, bait: tool.bait }, 400);
    baitSlot = b.slot_index;
  }

  // 4) Nivel
  await env.DB.prepare(
    `INSERT OR IGNORE INTO user_skills (user_id, skill_id, xp, updated_at) VALUES (?, ?, 0, 0)`
  ).bind(userId, SKILL_ID).run();
  const skillRow = await env.DB.prepare(
    'SELECT xp FROM user_skills WHERE user_id = ? AND skill_id = ?'
  ).bind(userId, SKILL_ID).first();
  const currentXp = skillRow?.xp || 0;
  const currentLevel = xpToLevel(currentXp);
  const minLevel = spotMinLevel(spot.type);
  if (currentLevel < minLevel) {
    return json({
      error: 'level_too_low', message: `Necesitas nivel ${minLevel} de Pesca.`,
      required_level: minLevel, current_level: currentLevel,
    }, 400);
  }

  // 5) Ritmo
  const gate = await env.DB.prepare(
    `UPDATE user_skills SET updated_at = ?
      WHERE user_id = ? AND skill_id = ? AND updated_at <= ?`
  ).bind(now, userId, SKILL_ID, now - MIN_FISH_TICK_MS).run();
  if (!gate?.meta?.changes) return json({ error: 'too_fast', message: 'Espera un momento.' }, 429);

  // 6) Tirada: del mejor pez al peor que puedas pescar
  let caught = null;
  for (const fishId of type.fish) {
    if (Math.random() < catchRate(fishId, currentLevel)) { caught = fishId; break; }
  }
  if (!caught) return json({ ok: true, caught: false, spot_id: spot.id });

  const fish = FISH[caught];
  const inv = await findInventorySpotForItem(env, userId, caught);
  if (inv.kind === 'full') return json({ error: 'inventory_full', message: 'Mochila llena.' }, 400);

  const stmts = [];
  if (baitSlot !== null) {
    stmts.push(env.DB.prepare(
      `UPDATE user_inventory SET quantity = quantity - 1, updated_at = ?
        WHERE user_id = ? AND slot_index = ? AND item_id = ? AND quantity >= 1`
    ).bind(now, userId, baitSlot, tool.bait));
    stmts.push(env.DB.prepare(
      'DELETE FROM user_inventory WHERE user_id = ? AND slot_index = ? AND item_id = ? AND quantity <= 0'
    ).bind(userId, baitSlot, tool.bait));
  }
  stmts.push(env.DB.prepare(
    'UPDATE user_skills SET xp = MIN(xp + ?, ?) WHERE user_id = ? AND skill_id = ?'
  ).bind(fish.xp, MAX_XP, userId, SKILL_ID));
  // Si el cebo se acaba justo en el slot libre elegido no pasa nada: el pez
  // va a otro slot porque findInventorySpotForItem ya lo miró antes.
  stmts.push(inv.kind === 'stack'
    ? env.DB.prepare('UPDATE user_inventory SET quantity = quantity + 1, updated_at = ? WHERE user_id = ? AND slot_index = ?')
        .bind(now, userId, inv.slot)
    : env.DB.prepare('INSERT INTO user_inventory (user_id, slot_index, item_id, quantity, updated_at) VALUES (?, ?, ?, 1, ?)')
        .bind(userId, inv.slot, caught, now));
  const res = await env.DB.batch(stmts);
  if (baitSlot !== null && !res?.[0]?.meta?.changes) {
    // Carrera: otra petición gastó la última pluma. Deshacer el pez y la XP.
    await env.DB.batch([
      env.DB.prepare('UPDATE user_skills SET xp = MAX(0, xp - ?) WHERE user_id = ? AND skill_id = ?').bind(fish.xp, userId, SKILL_ID),
      inv.kind === 'stack'
        ? env.DB.prepare('UPDATE user_inventory SET quantity = quantity - 1 WHERE user_id = ? AND slot_index = ?').bind(userId, inv.slot)
        : env.DB.prepare('DELETE FROM user_inventory WHERE user_id = ? AND slot_index = ? AND item_id = ?').bind(userId, inv.slot, caught),
    ]);
    return json({ error: 'no_bait', message: `No te quedan ${tool.baitName}.` }, 400);
  }
  await questEvent(env, userId, 'fish', caught);

  const after = await env.DB.prepare(
    'SELECT xp FROM user_skills WHERE user_id = ? AND skill_id = ?'
  ).bind(userId, SKILL_ID).first();
  const newXp = after?.xp ?? currentXp + fish.xp;
  const newLevel = xpToLevel(newXp);
  return json({
    ok: true, caught: true, fish_item: caught, fish_name: fish.name, spot_id: spot.id,
    xp_gained: fish.xp, skill_id: SKILL_ID, new_xp: newXp, new_level: newLevel,
    prev_level: currentLevel, level_up: newLevel > currentLevel,
    bait_used: baitSlot !== null,
  });
}
