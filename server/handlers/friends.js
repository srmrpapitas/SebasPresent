/**
 * SebasPresent — Lista de amigos (Sesión 50)
 *   GET  /api/friends                 → [{ id, name, online, x, z }]
 *   POST /api/friends/add    { name }
 *   POST /api/friends/remove { id }
 */
import { json, readJson } from '../lib/db.js';
import { requireSession } from '../lib/auth.js';

const ONLINE_MS = 30_000;
const MAX_FRIENDS = 100;

export async function handleFriendsGet(request, env) {
  const session = await requireSession(request, env);
  if (!session) return json({ error: 'unauthorized' }, 401);
  const now = Date.now();
  const rows = (await env.DB.prepare(
    `SELECT f.friend_id AS id, u.username AS name, o.x, o.z, o.last_seen,
            EXISTS (SELECT 1 FROM user_friends f2 WHERE f2.user_id = f.friend_id AND f2.friend_id = f.user_id) AS mutual
       FROM user_friends f JOIN users u ON u.id = f.friend_id
       LEFT JOIN online_users o ON o.user_id = f.friend_id
      WHERE f.user_id = ? ORDER BY u.username COLLATE NOCASE`
  ).bind(session.user_id).all()).results || [];
  // Sesión 51 — la zona donde está solo se ve si os tenéis añadidos LOS DOS
  // (antes cualquiera podía añadirte y seguir tu posición exacta en directo),
  // y redondeada a 50 m (basta para saber la zona).
  const r50 = (v) => Math.round(v / 50) * 50;
  return json({ friends: rows.map(r => {
    const online = r.last_seen != null && now - r.last_seen < ONLINE_MS;
    const show = online && r.mutual && Number.isFinite(r.x);
    return { id: r.id, name: r.name, online, mutual: !!r.mutual, x: show ? r50(r.x) : null, z: show ? r50(r.z) : null };
  }) });
}

export async function handleFriendsAdd(request, env) {
  const session = await requireSession(request, env);
  if (!session) return json({ error: 'unauthorized' }, 401);
  const body = await readJson(request);
  const name = String(body?.name || '').trim();
  if (!name || name.length > 32) return json({ error: 'bad_name' }, 400);
  const u = await env.DB.prepare('SELECT id, username FROM users WHERE username = ? COLLATE NOCASE').bind(name).first();
  if (!u) return json({ error: 'not_found', message: 'No existe ningún jugador con ese nombre.' }, 404);
  if (u.id === session.user_id) return json({ error: 'self', message: 'No puedes añadirte a ti mismo.' }, 400);
  const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM user_friends WHERE user_id = ?').bind(session.user_id).first();
  if ((n?.n || 0) >= MAX_FRIENDS) return json({ error: 'full', message: 'Tu lista de amigos está llena.' }, 400);
  await env.DB.prepare('INSERT OR IGNORE INTO user_friends (user_id, friend_id, created_at) VALUES (?, ?, ?)').bind(session.user_id, u.id, Date.now()).run();
  return json({ ok: true, id: u.id, name: u.username });
}

export async function handleFriendsRemove(request, env) {
  const session = await requireSession(request, env);
  if (!session) return json({ error: 'unauthorized' }, 401);
  const body = await readJson(request);
  await env.DB.prepare('DELETE FROM user_friends WHERE user_id = ? AND friend_id = ?').bind(session.user_id, Number(body?.id)).run();
  return json({ ok: true });
}
