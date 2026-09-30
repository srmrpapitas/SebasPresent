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
    `SELECT f.friend_id AS id, u.username AS name, o.x, o.z, o.last_seen
       FROM user_friends f JOIN users u ON u.id = f.friend_id
       LEFT JOIN online_users o ON o.user_id = f.friend_id
      WHERE f.user_id = ? ORDER BY u.username COLLATE NOCASE`
  ).bind(session.user_id).all()).results || [];
  return json({ friends: rows.map(r => {
    const online = r.last_seen != null && now - r.last_seen < ONLINE_MS;
    return { id: r.id, name: r.name, online, x: online ? r.x : null, z: online ? r.z : null };
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
