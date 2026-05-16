/**
 * SebasPresent — Combat handlers (Slice 5a + 5b)
 * Endpoints: /api/combat/state, /attack, /respawn, /style
 *
 * La lógica vive en combat_engine.js. Handlers solo orquestan.
 */

import { json, makeDbAdapter } from '../lib/db.js';
import { requireSession } from '../lib/auth.js';
import {
  getCombatState, attackNpc, respawnUser,
  VALID_STYLES,
} from '../combat_engine.js';

export async function handleCombatState(request, env) {
  const session = await requireSession(request, env);
  if (!session) return json({ error: 'unauthorized' }, 401);
  const db = makeDbAdapter(env);
  try {
    const state = await getCombatState(db, session.user_id, {});
    return json(state);
  } catch (err) {
    console.error('[combat/state]', err);
    return json({ error: 'internal_error', message: err.message }, 500);
  }
}

export async function handleCombatAttack(request, env) {
  const session = await requireSession(request, env);
  if (!session) return json({ error: 'unauthorized' }, 401);

  let body;
  try { body = await request.json(); } catch { return json({ error: 'invalid_body' }, 400); }
  const npcId = parseInt(body.npc_id, 10);
  if (!Number.isFinite(npcId) || npcId <= 0) {
    return json({ error: 'invalid_npc_id' }, 400);
  }

  const db = makeDbAdapter(env);
  try {
    const result = await attackNpc(db, session.user_id, npcId, {});
    if (result.error) {
      const knownClient = new Set([
        'npc_not_found', 'npc_dead', 'on_cooldown',
        'out_of_range', 'user_no_position', 'user_dead',
      ]);
      if (knownClient.has(result.error)) return json(result, 400);
    }
    return json(result);
  } catch (err) {
    console.error('[combat/attack]', err);
    return json({ error: 'internal_error', message: err.message }, 500);
  }
}

export async function handleCombatRespawn(request, env) {
  const session = await requireSession(request, env);
  if (!session) return json({ error: 'unauthorized' }, 401);
  const db = makeDbAdapter(env);
  try {
    const result = await respawnUser(db, session.user_id, {});
    if (!result.ok) return json(result, 400);
    return json(result);
  } catch (err) {
    console.error('[combat/respawn]', err);
    return json({ error: 'internal_error', message: err.message }, 500);
  }
}

/**
 * Slice 5b — POST /api/combat/style { style }
 * Cambia el combat style del user. Valida contra VALID_STYLES del engine.
 * Persiste en users.combat_style.
 */
export async function handleCombatStyle(request, env) {
  const session = await requireSession(request, env);
  if (!session) return json({ error: 'unauthorized' }, 401);

  let body;
  try { body = await request.json(); } catch { return json({ error: 'invalid_body' }, 400); }
  const style = body && typeof body.style === 'string' ? body.style : null;
  if (!style || !VALID_STYLES.includes(style)) {
    return json({
      error: 'invalid_style',
      message: 'style debe ser uno de: ' + VALID_STYLES.join(', '),
    }, 400);
  }

  try {
    await env.DB.prepare('UPDATE users SET combat_style = ? WHERE id = ?')
      .bind(style, session.user_id).run();
    return json({ ok: true, combat_style: style });
  } catch (err) {
    console.error('[combat/style]', err);
    return json({ error: 'internal_error', message: err.message }, 500);
  }
}
