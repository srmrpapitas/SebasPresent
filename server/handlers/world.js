/**
 * SebasPresent — World handlers (Slice 5c.5 — multiplayer)
 * Endpoints: POST /api/world/heartbeat, GET /api/world/peers
 *
 * Estrategia: cada cliente hace heartbeat cada ~500ms con su posición,
 * yaw y estado de movimiento. El server upserta a online_users con
 * last_seen=now. El endpoint peers devuelve users con last_seen reciente
 * (<10s) dentro de un radio de 100m del que pregunta.
 */

import { json } from '../lib/db.js';
import { requireSession } from '../lib/auth.js';

const MP_PEER_TIMEOUT_MS = 10_000;
const MP_PEER_RADIUS_M   = 100;
const MP_VALID_STATES    = ['idle', 'run', 'attack'];

export async function handleWorldHeartbeat(request, env) {
  const session = await requireSession(request, env);
  if (!session) return json({ error: 'unauthorized' }, 401);

  let body;
  try { body = await request.json(); } catch { return json({ error: 'invalid_body' }, 400); }
  const x   = Number(body?.x);
  const z   = Number(body?.z);
  const yaw = Number(body?.yaw ?? 0);
  let state = typeof body?.state === 'string' ? body.state : 'idle';
  if (!MP_VALID_STATES.includes(state)) state = 'idle';

  if (!Number.isFinite(x) || !Number.isFinite(z)) {
    return json({ error: 'invalid_position' }, 400);
  }

  const now = Date.now();
  try {
    // requireSession no incluye username — lo buscamos manualmente
    const userRow = await env.DB.prepare(
      'SELECT username FROM users WHERE id = ?'
    ).bind(session.user_id).first();
    const username = userRow?.username || `user${session.user_id}`;

    // Upsert: si ya existe, actualiza; si no, inserta.
    await env.DB.prepare(
      `INSERT INTO online_users (user_id, username, x, z, yaw, state, last_seen)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         x = excluded.x,
         z = excluded.z,
         yaw = excluded.yaw,
         state = excluded.state,
         last_seen = excluded.last_seen`
    ).bind(session.user_id, username, x, z, yaw, state, now).run();
    return json({ ok: true, ts: now });
  } catch (err) {
    console.error('[world/heartbeat]', err);
    return json({ error: 'internal_error', message: err.message }, 500);
  }
}

export async function handleWorldPeers(request, env) {
  const session = await requireSession(request, env);
  if (!session) return json({ error: 'unauthorized' }, 401);

  const url = new URL(request.url);
  // Permitir pasar x,z en query para que el cliente diga "estoy aquí"
  // sin esperar a su próximo heartbeat. Si no se pasan, usamos el último
  // heartbeat conocido del propio user.
  const qx = Number(url.searchParams.get('x'));
  const qz = Number(url.searchParams.get('z'));
  const hasPos = Number.isFinite(qx) && Number.isFinite(qz);

  const cutoff = Date.now() - MP_PEER_TIMEOUT_MS;
  try {
    let centerX, centerZ;
    if (hasPos) {
      centerX = qx; centerZ = qz;
    } else {
      const me = await env.DB.prepare(
        'SELECT x, z FROM online_users WHERE user_id = ?'
      ).bind(session.user_id).first();
      if (!me) {
        return json({ peers: [] });   // no hemos hecho heartbeat aún
      }
      centerX = me.x; centerZ = me.z;
    }

    // Filtramos en SQL por bounding box rápido, después por distancia exacta
    const margin = MP_PEER_RADIUS_M;
    const rows = await env.DB.prepare(
      `SELECT user_id, username, x, z, yaw, state, last_seen
       FROM online_users
       WHERE last_seen > ?
         AND user_id != ?
         AND x BETWEEN ? AND ?
         AND z BETWEEN ? AND ?`
    ).bind(
      cutoff, session.user_id,
      centerX - margin, centerX + margin,
      centerZ - margin, centerZ + margin,
    ).all();

    const peers = (rows.results || [])
      .filter(r => {
        const dx = r.x - centerX, dz = r.z - centerZ;
        return (dx * dx + dz * dz) <= margin * margin;
      })
      .map(r => ({
        user_id: r.user_id,
        username: r.username,
        x: r.x,
        z: r.z,
        yaw: r.yaw,
        state: r.state,
        last_seen: r.last_seen,
      }));

    return json({ peers });
  } catch (err) {
    console.error('[world/peers]', err);
    return json({ error: 'internal_error', message: err.message }, 500);
  }
}
