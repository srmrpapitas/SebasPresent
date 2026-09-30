/**
 * SebasPresent — La Fosa de Fuego: entrar / rendirse (Sesión 50)
 *   POST /api/fosa/start  → junto a Kargath; te mete en la arena (ronda 1 en 2.5 s)
 *   POST /api/fosa/leave  → te rindes: fuera, sin premio de las rondas que faltan
 */
import { json } from '../lib/db.js';
import { requireSession } from '../lib/auth.js';
import { FOSA, FOSA_TALK_DIST_M } from '../../client/src/shared/fosa.js';
import { getFosaRow, clearMobs, setPlayerPos } from '../minigame.js';
import { questEvent } from '../lib/quests.js';

export async function handleFosaStart(request, env) {
  const session = await requireSession(request, env);
  if (!session) return json({ error: 'unauthorized' }, 401);
  const uid = session.user_id;
  const now = Date.now();
  const pos = await env.DB.prepare('SELECT x, z FROM online_users WHERE user_id = ?').bind(uid).first();
  if (!pos || Math.hypot(pos.x - FOSA.guard.x, pos.z - FOSA.guard.z) > FOSA_TALK_DIST_M) {
    return json({ error: 'too_far', message: 'Habla con Kargath a la entrada de la Fosa.' }, 400);
  }
  const st = await env.DB.prepare('SELECT hp_current FROM combat_stats WHERE user_id = ?').bind(uid).first();
  if (!st || st.hp_current <= 0) return json({ error: 'dead', message: 'Estás muerto.' }, 400);
  const row = await getFosaRow(env, uid);
  if (row.active) return json({ error: 'already', message: 'Ya estás en la Fosa.' }, 400);
  await clearMobs(env, uid);
  const r = await env.DB.prepare(
    `UPDATE user_fosa SET active = 1, wave = 0, next_wave_at = ?, rewarded = 0, tele = NULL, last_attacks = '[]',
            result = NULL, started_at = ?, last_tick = 0, prev_tick = ? WHERE user_id = ? AND active = 0`
  ).bind(now + 2500, now, now, uid).run();
  if (!r?.meta?.changes) return json({ error: 'already' }, 400);
  const x = FOSA.x, z = FOSA.z + FOSA.r * 0.55;
  await setPlayerPos(env, uid, x, z, now);
  try { await questEvent(env, uid, 'fosa_start', null); } catch {}
  return json({ ok: true, x, z });
}

export async function handleFosaLeave(request, env) {
  const session = await requireSession(request, env);
  if (!session) return json({ error: 'unauthorized' }, 401);
  const uid = session.user_id;
  const now = Date.now();
  const row = await getFosaRow(env, uid);
  if (!row.active) return json({ ok: true });
  await clearMobs(env, uid);
  await env.DB.prepare(
    `UPDATE user_fosa SET active = 0, tele = NULL, result = ? WHERE user_id = ?`
  ).bind(JSON.stringify({ k: 'left', wave: row.wave, at: now, x: FOSA.entrance.x, z: FOSA.entrance.z }), uid).run();
  await setPlayerPos(env, uid, FOSA.entrance.x, FOSA.entrance.z, now);
  return json({ ok: true, x: FOSA.entrance.x, z: FOSA.entrance.z });
}
