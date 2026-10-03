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

import { serverWarp } from '../lib/warp.js';
import { TELEPORT_WILD_LIMIT_X } from '../../client/src/shared/teleports.js';   // Sesión 51
import { inCaveZone } from '../../client/src/shared/caves.js';
import { json } from '../lib/db.js';
import { requireSession } from '../lib/auth.js';

const HOME_TELE_COOLDOWN_MS = 15 * 60 * 1000;
const HOME_TELE_CAST_MS = 10_000;
const HOME_TELE_SPAWN = { x: 0, z: 0 };
const IN_COMBAT_MS = 8000;

// Sesión 51 — mismas reglas que las tabletas y los hechizos de teletransporte:
// vivo, fuera de combate, no muy dentro del Malpaís ni en una cueva.
async function blockedReason(env, uid, now) {
  const st = await env.DB.prepare('SELECT hp_current, last_attack_at, last_hit_at FROM combat_stats WHERE user_id = ?').bind(uid).first();
  if (st && st.hp_current <= 0) return { error: 'dead', message: 'Estás muerto.' };
  if (st && ((st.last_attack_at && now - st.last_attack_at < IN_COMBAT_MS) || (st.last_hit_at && now - st.last_hit_at < IN_COMBAT_MS))) {
    return { error: 'in_combat', message: 'No puedes teletransportarte en pleno combate.' };
  }
  const pos = await env.DB.prepare('SELECT x, z FROM online_users WHERE user_id = ?').bind(uid).first();
  if (pos && pos.x < TELEPORT_WILD_LIMIT_X) return { error: 'too_deep', message: 'La magia no funciona tan dentro del Malpaís. Sal un poco al este.' };
  if (pos && inCaveZone(pos.x, pos.z)) return { error: 'in_cave', message: 'Dentro de la cueva la magia no te saca. Sal por la entrada.' };
  return null;
}

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
    const why = await blockedReason(env, session.user_id, now);
    if (why) return json(why, 400);
    // Sesión 51 — el servidor apunta cuándo empezó (para exigir los 10 s)
    await env.DB.prepare('UPDATE users SET home_tele_started_at = ? WHERE id = ?').bind(now, session.user_id).run();
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
  // Sesión 51 — se borra el inicio: un /finish después ya no vale
  try { await env.DB.prepare('UPDATE users SET home_tele_started_at = 0 WHERE id = ?').bind(session.user_id).run(); } catch {}
  return json({ ok: true, cancelled: true });
}

export async function handleHomeTeleportFinish(request, env) {
  const session = await requireSession(request, env);
  if (!session) return json({ error: 'unauthorized' }, 401);
  try {
    // Doble verificación de cooldown: si el cliente trampea, el segundo
    // intento falla.
    const row = await env.DB.prepare(
      'SELECT home_tele_cooldown_until, home_tele_started_at FROM users WHERE id = ?'
    ).bind(session.user_id).first();
    const cooldownUntil = row?.home_tele_cooldown_until || 0;
    const now = Date.now();
    if (cooldownUntil > now) {
      return json({
        error: 'on_cooldown',
        cooldown_remaining_ms: cooldownUntil - now,
      }, 429);
    }
    // Sesión 51 — hay que haber empezado el lanzamiento hace ≥ 10 s (y no
    // hace siglos), y seguir cumpliendo las reglas al terminar.
    const started = row?.home_tele_started_at || 0;
    if (!started || now - started < HOME_TELE_CAST_MS - 600 || now - started > HOME_TELE_CAST_MS + 60_000) {
      return json({ error: 'not_casting', message: 'Empieza el teletransporte otra vez.' }, 400);
    }
    const why = await blockedReason(env, session.user_id, now);
    if (why) return json(why, 400);
    const newCooldownUntil = now + HOME_TELE_COOLDOWN_MS;
    // una sola petición lo consigue (dos "finish" a la vez = un solo salto)
    const claim = await env.DB.prepare(
      'UPDATE users SET home_tele_cooldown_until = ?, home_tele_started_at = 0 WHERE id = ? AND home_tele_started_at = ?'
    ).bind(newCooldownUntil, session.user_id, started).run();
    if (!claim?.meta?.changes) return json({ error: 'not_casting' }, 400);
    await serverWarp(env, session.user_id, HOME_TELE_SPAWN.x, HOME_TELE_SPAWN.z, now);   // Sesión 50
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
