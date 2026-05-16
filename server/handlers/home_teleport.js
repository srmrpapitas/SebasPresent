/**
 * SebasPresent — Home Teleport handlers (Slice 5c)
 * Endpoints: POST /api/magic/home_teleport, /cancel, /finish
 *
 * Flujo:
 *   1) Cliente envía POST .../home_teleport → server verifica que no
 *      hay cooldown, devuelve { ok: true, cast_ms: 10000 }, arranca
 *      timer client-side.
 *   2) Si el cliente se mueve o recibe daño: POST .../cancel
 *      → no pasa nada server-side, el cliente simplemente no envía finish.
 *   3) Si el cast llega a 10s: POST .../finish → server pone
 *      cooldown_until = now+15min y devuelve { spawn: {x,z} }.
 *
 * El cooldown se valida server-side al hacer start. No confiamos en el
 * cliente: si intenta hacer finish dos veces, el segundo falla porque
 * el cooldown ya está activo.
 */

import { json } from '../lib/db.js';
import { requireSession } from '../lib/auth.js';

const HOME_TELE_COOLDOWN_MS = 15 * 60 * 1000;
const HOME_TELE_CAST_MS = 10_000;
const HOME_TELE_SPAWN = { x: 0, z: 0 };

export async function handleHomeTeleportStart(request, env) {
  const session = await requireSession(request, env);
  if (!session) return json({ error: 'unauthorized' }, 401);
  try {
    const row = await env.DB.prepare(
      'SELECT home_tele_cooldown_until FROM users WHERE id = ?'
    ).bind(session.user_id).first();
    const cooldownUntil = row?.home_tele_cooldown_until || 0;
    const now = Date.now();
    if (cooldownUntil > now) {
      const remainingMs = cooldownUntil - now;
      return json({
        error: 'on_cooldown',
        cooldown_remaining_ms: remainingMs,
        message: `Disponible en ${Math.ceil(remainingMs / 1000)}s`,
      }, 429);
    }
    return json({
      ok: true,
      cast_ms: HOME_TELE_CAST_MS,
      message: 'Cast iniciado. No te muevas ni recibas daño durante 10s.',
    });
  } catch (err) {
    console.error('[home_tele/start]', err);
    return json({ error: 'internal_error', message: err.message }, 500);
  }
}

export async function handleHomeTeleportCancel(request, env) {
  const session = await requireSession(request, env);
  if (!session) return json({ error: 'unauthorized' }, 401);
  // Server-side no hay nada que hacer — el cast no es stateful en server,
  // el cliente solo deja de enviar finish. Devolvemos ok para confirmar
  // que el server "vio" el cancel.
  return json({ ok: true, cancelled: true });
}

export async function handleHomeTeleportFinish(request, env) {
  const session = await requireSession(request, env);
  if (!session) return json({ error: 'unauthorized' }, 401);
  try {
    // Doble verificación de cooldown: si el cliente trampea, el segundo
    // intento falla.
    const row = await env.DB.prepare(
      'SELECT home_tele_cooldown_until FROM users WHERE id = ?'
    ).bind(session.user_id).first();
    const cooldownUntil = row?.home_tele_cooldown_until || 0;
    const now = Date.now();
    if (cooldownUntil > now) {
      return json({
        error: 'on_cooldown',
        cooldown_remaining_ms: cooldownUntil - now,
      }, 429);
    }
    const newCooldownUntil = now + HOME_TELE_COOLDOWN_MS;
    await env.DB.prepare(
      'UPDATE users SET home_tele_cooldown_until = ?, last_x = ?, last_z = ? WHERE id = ?'
    ).bind(newCooldownUntil, HOME_TELE_SPAWN.x, HOME_TELE_SPAWN.z, session.user_id).run();
    return json({
      ok: true,
      teleported: true,
      spawn: HOME_TELE_SPAWN,
      cooldown_until: newCooldownUntil,
    });
  } catch (err) {
    console.error('[home_tele/finish]', err);
    return json({ error: 'internal_error', message: err.message }, 500);
  }
}
