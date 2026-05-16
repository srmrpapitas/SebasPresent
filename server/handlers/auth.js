/**
 * SebasPresent — Auth handlers
 * Endpoints: /api/register, /api/login, /api/me, /api/logout
 */

import { json, readJson } from '../lib/db.js';
import {
  createSession, requireSession, bearerToken,
  hashPassword, verifyPassword,
} from '../lib/auth.js';

const USERNAME_REGEX = /^[a-zA-Z0-9_]{3,16}$/;
const PASSWORD_MIN_LENGTH = 6;

export async function handleRegister(request, env) {
  const body = await readJson(request);
  if (!body) return json({ error: 'bad_request' }, 400);

  const username = (body.username || '').trim();
  const password = body.password || '';

  if (!USERNAME_REGEX.test(username)) {
    return json({
      error: 'invalid_username',
      message: 'El nombre debe tener 3-16 caracteres alfanuméricos o guión bajo.',
    }, 400);
  }
  if (password.length < PASSWORD_MIN_LENGTH) {
    return json({
      error: 'invalid_password',
      message: `La contraseña debe tener al menos ${PASSWORD_MIN_LENGTH} caracteres.`,
    }, 400);
  }

  const existing = await env.DB.prepare('SELECT id FROM users WHERE username = ?')
    .bind(username).first();
  if (existing) {
    return json({ error: 'username_taken', message: 'Ese nombre ya está en uso.' }, 409);
  }

  const passwordHash = await hashPassword(password);
  const now = Date.now();

  const result = await env.DB.prepare(
    'INSERT INTO users (username, password_hash, created_at, last_login) VALUES (?, ?, ?, ?)'
  ).bind(username, passwordHash, now, now).run();

  const userId = result.meta.last_row_id;

  // Starter pack: hacha + yesquero + 25 monedas.
  try {
    await env.DB.batch([
      env.DB.prepare(
        'INSERT INTO user_inventory (user_id, slot_index, item_id, quantity, updated_at) VALUES (?, 0, ?, 1, ?)'
      ).bind(userId, 'axe', now),
      env.DB.prepare(
        'INSERT INTO user_inventory (user_id, slot_index, item_id, quantity, updated_at) VALUES (?, 1, ?, 1, ?)'
      ).bind(userId, 'tinderbox', now),
      env.DB.prepare(
        'INSERT INTO user_inventory (user_id, slot_index, item_id, quantity, updated_at) VALUES (?, 2, ?, 25, ?)'
      ).bind(userId, 'coins', now),
    ]);
  } catch (err) {
    console.error('Starter pack failed for user', userId, err);
  }

  const token = await createSession(env, userId);

  return json({
    token,
    user: { id: userId, username, created_at: now },
  });
}

export async function handleLogin(request, env) {
  const body = await readJson(request);
  if (!body) return json({ error: 'bad_request' }, 400);

  const username = (body.username || '').trim();
  const password = body.password || '';

  if (!username || !password) {
    return json({ error: 'missing_credentials' }, 400);
  }

  const user = await env.DB.prepare(
    'SELECT id, username, password_hash, created_at FROM users WHERE username = ?'
  ).bind(username).first();

  if (!user) {
    return json({ error: 'invalid_credentials', message: 'Usuario o contraseña incorrectos.' }, 401);
  }

  const valid = await verifyPassword(password, user.password_hash);
  if (!valid) {
    return json({ error: 'invalid_credentials', message: 'Usuario o contraseña incorrectos.' }, 401);
  }

  const now = Date.now();
  await env.DB.prepare('UPDATE users SET last_login = ? WHERE id = ?')
    .bind(now, user.id).run();

  const token = await createSession(env, user.id);

  return json({
    token,
    user: { id: user.id, username: user.username, created_at: user.created_at },
  });
}

export async function handleMe(request, env) {
  const session = await requireSession(request, env);
  if (!session) return json({ error: 'unauthorized' }, 401);

  const user = await env.DB.prepare(
    'SELECT id, username, created_at, last_login FROM users WHERE id = ?'
  ).bind(session.user_id).first();

  if (!user) return json({ error: 'user_not_found' }, 404);

  return json({ user });
}

export async function handleLogout(request, env) {
  const token = bearerToken(request);
  if (token) {
    await env.DB.prepare('DELETE FROM sessions WHERE token = ?').bind(token).run();
  }
  return json({ ok: true });
}
