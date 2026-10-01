/**
 * SebasPresent — Cuevas (Sesión 50)
 *   POST /api/cave/enter { cave }  → junto a la boca: te mete en la cueva (serverWarp)
 *   POST /api/cave/leave           → desde la salida de dentro: vuelves delante de la boca
 * Las cuevas viven fuera del mapa (client/src/shared/caves.js). Todo salto lo
 * decide el server, así que el Realm lo acepta como teletransporte legítimo.
 */
import { json, readJson } from '../lib/db.js';
import { requireSession } from '../lib/auth.js';
import { serverWarp } from '../lib/warp.js';
import { CAVES, CAVE_ENTER_DIST_M, caveAt, caveSpawn, caveExitMarker, mouthOutside } from '../../client/src/shared/caves.js';

async function livePos(env, uid) {
  return await env.DB.prepare('SELECT x, z, last_seen FROM online_users WHERE user_id = ?').bind(uid).first();
}
async function alive(env, uid) {
  const st = await env.DB.prepare('SELECT hp_current FROM combat_stats WHERE user_id = ?').bind(uid).first();
  return !st || st.hp_current > 0;
}

export async function handleCaveEnter(request, env) {
  const session = await requireSession(request, env);
  if (!session) return json({ error: 'unauthorized' }, 401);
  const uid = session.user_id;
  const body = await readJson(request);
  const c = CAVES[body?.cave];
  if (!c) return json({ error: 'invalid_cave' }, 400);
  const pos = await livePos(env, uid);
  if (!pos || Math.hypot(pos.x - c.mouth.x, pos.z - c.mouth.z) > CAVE_ENTER_DIST_M) return json({ error: 'too_far', message: 'Acércate a la entrada de la cueva.' }, 400);
  if (!(await alive(env, uid))) return json({ error: 'dead' }, 400);
  const s = caveSpawn(c);
  await serverWarp(env, uid, s.x, s.z);
  return json({ ok: true, cave: c.id, x: s.x, z: s.z });
}

export async function handleCaveLeave(request, env) {
  const session = await requireSession(request, env);
  if (!session) return json({ error: 'unauthorized' }, 401);
  const uid = session.user_id;
  const pos = await livePos(env, uid);
  const c = pos && caveAt(pos.x, pos.z);
  if (!c) return json({ error: 'not_in_cave' }, 400);
  const ex = caveExitMarker(c);
  if (Math.hypot(pos.x - ex.x, pos.z - ex.z) > CAVE_ENTER_DIST_M) return json({ error: 'too_far', message: 'Vuelve a la salida de la cueva.' }, 400);
  const o = mouthOutside(c);
  await serverWarp(env, uid, o.x, o.z);
  return json({ ok: true, x: o.x, z: o.z });
}
