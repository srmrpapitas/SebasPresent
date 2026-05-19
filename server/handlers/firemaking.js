/**
 * SebasPresent — Firemaking handler (Sesión 30)
 *
 * Endpoint:
 *   POST /api/firemaking/light { slot }
 *
 * Flujo:
 *   1) Valida sesión + slot (0..27).
 *   2) Valida que el item del slot es un log (whitelist LOG_DEFS).
 *   3) Valida tinderbox en inventario.
 *   4) Valida nivel firemaking >= fmLevel del log.
 *   5) Consume 1 log + crea fila en `fires` + grant XP firemaking.
 *
 * Defensive: si tabla `fires` no existe → 503 'fm_disabled'.
 *
 * Respuesta:
 *   { ok, fire: {id, x, z, log_type, lit_at, expires_at},
 *     consumed_item, xp_gained, skill_id, new_xp, new_level,
 *     level_up, levels_gained, prev_level }
 */

import { json, readJson } from '../lib/db.js';
import { requireSession } from '../lib/auth.js';
import { applyXpGrant, xpToLevel, startingXpFor } from '../lib/skills_engine.js';

// Logs encendibles. fmLevel = nivel firemaking requerido. xp = ganancia.
const LOG_DEFS = {
  logs:          { name: 'Tronco',             fmLevel: 1,  xp: 40 },
  oak_logs:      { name: 'Tronco de roble',    fmLevel: 15, xp: 60 },
  willow_logs:   { name: 'Tronco de sauce',    fmLevel: 30, xp: 90 },
  palm_logs:     { name: 'Tronco de palmera',  fmLevel: 20, xp: 70 },
  pine_logs:     { name: 'Tronco de pino',     fmLevel: 25, xp: 75 },
  teak_logs:     { name: 'Tronco de teca',     fmLevel: 35, xp: 105 },
  maple_logs:    { name: 'Tronco de arce',     fmLevel: 45, xp: 135 },
  mahogany_logs: { name: 'Tronco de caoba',    fmLevel: 50, xp: 158 },
  yew_logs:      { name: 'Tronco de tejo',     fmLevel: 60, xp: 203 },
  magic_logs:    { name: 'Tronco mágico',      fmLevel: 75, xp: 304 },
  dead_logs:     { name: 'Tronco muerto',      fmLevel: 1,  xp: 25 },
  bush_leaves:   { name: 'Ramillas',           fmLevel: 1,  xp: 5  },
};

const FIRE_DURATION_MS = 5 * 60 * 1000;   // 5 min
const SKILL_ID = 'firemaking';

async function fmTablesExist(env) {
  try {
    await env.DB.prepare('SELECT 1 FROM fires LIMIT 1').all();
    return true;
  } catch {
    return false;
  }
}

export async function handleFiremakingLight(request, env) {
  const session = await requireSession(request, env);
  if (!session) return json({ error: 'unauthorized' }, 401);

  if (!(await fmTablesExist(env))) {
    return json({ error: 'fm_disabled', message: 'Tabla fires no existe.' }, 503);
  }

  const body = await readJson(request);
  if (!body) return json({ error: 'bad_request' }, 400);

  const slot = Number(body.slot);
  if (!Number.isInteger(slot) || slot < 0 || slot > 27) {
    return json({ error: 'invalid_slot' }, 400);
  }

  const userId = session.user_id;
  const now = Date.now();

  // 1) Pos del player
  const meRow = await env.DB.prepare(
    'SELECT x, z FROM online_users WHERE user_id = ?'
  ).bind(userId).first();
  if (!meRow) return json({ error: 'no_position' }, 400);

  // 2) Item en slot
  const invRow = await env.DB.prepare(
    'SELECT item_id, quantity FROM user_inventory WHERE user_id = ? AND slot_index = ?'
  ).bind(userId, slot).first();
  if (!invRow) return json({ error: 'empty_slot' }, 400);

  const logDef = LOG_DEFS[invRow.item_id];
  if (!logDef) return json({ error: 'not_a_log' }, 400);

  // 3) Tinderbox
  const tbRow = await env.DB.prepare(
    "SELECT slot_index FROM user_inventory WHERE user_id = ? AND item_id = 'tinderbox' LIMIT 1"
  ).bind(userId).first();
  if (!tbRow) return json({ error: 'no_tinderbox', message: 'Necesitas un yesquero.' }, 400);

  // 4) Level check
  const skillRow = await env.DB.prepare(
    'SELECT xp FROM user_skills WHERE user_id = ? AND skill_id = ?'
  ).bind(userId, SKILL_ID).first();
  const currentXp = skillRow ? skillRow.xp : startingXpFor(SKILL_ID);
  const currentLevel = xpToLevel(currentXp);
  if (currentLevel < logDef.fmLevel) {
    return json({
      error: 'level_too_low',
      message: `Necesitas nivel ${logDef.fmLevel} de Fuego.`,
      required_level: logDef.fmLevel,
      current_level: currentLevel,
    }, 400);
  }

  // 5) Aplicar todo
  const xpResult = applyXpGrant(currentXp, logDef.xp);
  const prevLevel = currentLevel;
  const expiresAt = now + FIRE_DURATION_MS;

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
  if (invRow.quantity <= 1) {
    stmts.push(env.DB.prepare(
      'DELETE FROM user_inventory WHERE user_id = ? AND slot_index = ?'
    ).bind(userId, slot));
  } else {
    stmts.push(env.DB.prepare(
      'UPDATE user_inventory SET quantity = quantity - 1, updated_at = ? WHERE user_id = ? AND slot_index = ?'
    ).bind(now, userId, slot));
  }
  await env.DB.batch(stmts);

  // Fire insert separado para obtener last_row_id.
  const fireResult = await env.DB.prepare(
    'INSERT INTO fires (x, z, log_type, user_id, lit_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(meRow.x, meRow.z, invRow.item_id, userId, now, expiresAt).run();

  const fireId = fireResult?.meta?.last_row_id ?? null;

  return json({
    ok: true,
    fire: {
      id: fireId,
      x: meRow.x,
      z: meRow.z,
      log_type: invRow.item_id,
      lit_at: now,
      expires_at: expiresAt,
    },
    consumed_item: invRow.item_id,
    xp_gained: logDef.xp,
    skill_id: SKILL_ID,
    new_xp: xpResult.newXp,
    new_level: xpResult.newLevel,
    level_up: xpResult.levelUp,
    levels_gained: xpResult.levelsGained,
    prev_level: prevLevel,
  });
}
