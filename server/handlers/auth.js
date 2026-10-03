/**
 * SebasPresent — Auth handlers
 * Endpoints: /api/register, /api/login, /api/me, /api/logout
 */

import { json, readJson } from '../lib/db.js';
import {
  createSession, requireSession, bearerToken,
  hashPassword, verifyPassword,
} from '../lib/auth.js';
import { initSkillsForNewUser } from './skills.js';
import { clientIp, hit, peek, clear, over } from '../lib/ratelimit.js';

const USERNAME_REGEX = /^[a-zA-Z0-9_]{3,16}$/;
const PASSWORD_MIN_LENGTH = 6;
const PASSWORD_MAX_LENGTH = 128;   // Sesión 50 — evita hashes gigantes (DoS)
const limited = () => json({ error: 'rate_limited', message: 'Demasiados intentos. Espera unos minutos y vuelve a probar.' }, 429);

export async function handleRegister(request, env) {
  const body = await readJson(request);
  if (!body) return json({ error: 'bad_request' }, 400);

  const username = String(body.username ?? '').trim();
  const password = typeof body.password === 'string' ? body.password : '';

  if (!USERNAME_REGEX.test(username)) {
    return json({
      error: 'invalid_username',
      message: 'El nombre debe tener 3-16 caracteres alfanuméricos o guión bajo.',
    }, 400);
  }
  if (password.length < PASSWORD_MIN_LENGTH || password.length > PASSWORD_MAX_LENGTH) {
    return json({
      error: 'invalid_password',
      message: `La contraseña debe tener entre ${PASSWORD_MIN_LENGTH} y ${PASSWORD_MAX_LENGTH} caracteres.`,
    }, 400);
  }
  // Sesión 50 — límite de cuentas nuevas por IP
  const ip = clientIp(request);
  if (over('reg_ip', await peek(env, 'reg_ip', ip) + 1)) return limited();

  // Sesión 50 — sin distinguir mayúsculas: "Nico" y "nico" son el mismo nombre
  const existing = await env.DB.prepare('SELECT id FROM users WHERE username = ? COLLATE NOCASE')
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
  try { await hit(env, 'reg_ip', ip); } catch {}

  // Starter pack: hacha de bronce + yesquero + 25 monedas + pico de bronce (S50).
  // Sesión 32 — migrado de 'axe' a 'axe_bronze' (unificación de tiers).
  try {
    await env.DB.batch([
      env.DB.prepare(
        'INSERT INTO user_inventory (user_id, slot_index, item_id, quantity, updated_at) VALUES (?, 0, ?, 1, ?)'
      ).bind(userId, 'axe_bronze', now),
      env.DB.prepare(
        'INSERT INTO user_inventory (user_id, slot_index, item_id, quantity, updated_at) VALUES (?, 1, ?, 1, ?)'
      ).bind(userId, 'tinderbox', now),
      env.DB.prepare(
        'INSERT INTO user_inventory (user_id, slot_index, item_id, quantity, updated_at) VALUES (?, 2, ?, 25, ?)'
      ).bind(userId, 'coins', now),
      // Sesión 50 — pico de bronce para la minería (antes había que comprarlo
      // a 50gp teniendo solo 25).
      env.DB.prepare(
        'INSERT INTO user_inventory (user_id, slot_index, item_id, quantity, updated_at) VALUES (?, 3, ?, 1, ?)'
      ).bind(userId, 'pickaxe_bronze', now),
      // Sesión 50 — red pequeña para la pesca
      env.DB.prepare(
        'INSERT INTO user_inventory (user_id, slot_index, item_id, quantity, updated_at) VALUES (?, 4, ?, 1, ?)'
      ).bind(userId, 'small_net', now),
    ]);
  } catch (err) {
    console.error('Starter pack failed for user', userId, err);
  }

  // Sesión 14 — Inicializar los 13 skills del player nuevo.
  // hitpoints arranca en nivel 10 (1154 xp), resto en nivel 1 (0 xp).
  try {
    await initSkillsForNewUser(env, userId);
  } catch (err) {
    console.error('Skills init failed for user', userId, err);
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

  const username = String(body.username ?? '').trim();
  const password = typeof body.password === 'string' ? body.password : '';

  if (!username || !password || password.length > PASSWORD_MAX_LENGTH) {
    return json({ error: 'missing_credentials' }, 400);
  }
  // Sesión 50 — fuerza bruta: límite por IP y por cuenta
  // Sesión 51 — el contador de fallos va por cuenta + IP: antes 10 intentos
  // de cualquiera (desde cualquier sitio) te dejaban sin poder entrar 15 min.
  const ip = clientIp(request), uname = username.toLowerCase() + '|' + ip;
  if (over('login_ip', await hit(env, 'login_ip', ip))) return limited();
  if (over('login_fail', await peek(env, 'login_fail', uname) + 1)) return limited();
  const fail = async () => {
    try { await hit(env, 'login_fail', uname); } catch {}
    return json({ error: 'invalid_credentials', message: 'Usuario o contraseña incorrectos.' }, 401);
  };

  // Sesión 51 — sin distinguir mayúsculas (el móvil pone "Sebas6" en vez de
  // "sebas6"); primero el nombre exacto por si hubiera dos cuentas antiguas.
  const user = (await env.DB.prepare(
    'SELECT id, username, password_hash, created_at FROM users WHERE username = ?'
  ).bind(username).first()) || (await env.DB.prepare(
    'SELECT id, username, password_hash, created_at FROM users WHERE username = ? COLLATE NOCASE ORDER BY id LIMIT 1'
  ).bind(username).first());

  if (!user) return fail();

  const valid = await verifyPassword(password, user.password_hash);
  if (!valid) return fail();
  try { await clear(env, 'login_fail', uname); } catch {}

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
