/**
 * SebasPresent — Position handlers
 * Endpoints: GET/POST /api/position
 *
 * El cliente guarda la posición cada 10s mientras se mueve (beacon en
 * logout). Al hacer login se restaura.
 */

import { json, readJson } from '../lib/db.js';
import { requireSession } from '../lib/auth.js';

const WORLD_HALF = 2048;

export async function handleGetPosition(request, env) {
  const session = await requireSession(request, env);
  if (!session) return json({ error: 'unauthorized' }, 401);

  const row = await env.DB.prepare(
    'SELECT last_x, last_z FROM users WHERE id = ?'
  ).bind(session.user_id).first();

  if (!row) return json({ error: 'user_not_found' }, 404);

  const x = row.last_x !== null && row.last_x !== undefined ? row.last_x : 0;
  const z = row.last_z !== null && row.last_z !== undefined ? row.last_z : 0;

  return json({ x, z });
}

export async function handleSavePosition(request, env) {
  const session = await requireSession(request, env);
  if (!session) return json({ error: 'unauthorized' }, 401);

  const body = await readJson(request);
  if (!body) return json({ error: 'bad_request' }, 400);

  const rawX = body.x;
  const rawZ = body.z;
  if (typeof rawX !== 'number' || typeof rawZ !== 'number' ||
      !isFinite(rawX) || !isFinite(rawZ)) {
    return json({ error: 'invalid_position', message: 'x e z deben ser números finitos.' }, 400);
  }

  const x = Math.max(-WORLD_HALF, Math.min(WORLD_HALF, rawX));
  const z = Math.max(-WORLD_HALF, Math.min(WORLD_HALF, rawZ));

  await env.DB.prepare(
    'UPDATE users SET last_x = ?, last_z = ? WHERE id = ?'
  ).bind(x, z, session.user_id).run();

  return json({ ok: true });
}
