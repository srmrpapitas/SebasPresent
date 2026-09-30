/**
 * SebasPresent — Monturas (Sesión 50)
 *   GET  /api/mounts              → { owned: [...], combat_level }
 *   POST /api/mounts/buy { mount } → comprar a Tanausú (nivel + monedas)
 * Alta primero (INSERT OR IGNORE) y cobro después; si no llega, se deshace.
 */
import { json, readJson } from '../lib/db.js';
import { requireSession } from '../lib/auth.js';
import { getPlayerPosition } from './skills/_shared.js';
import { debitCoins } from './shop.js';
import { levelFromXp } from '../combat_engine.js';
import { TOWN_NPCS_BY_ID, TALK_DIST_SERVER_M } from '../../client/src/shared/town_npcs.js';
import { MOUNTS, STABLE_NPC, combatLevelFrom } from '../../client/src/shared/mounts.js';

async function combatLevel(env, uid) {
  const s = await env.DB.prepare('SELECT attack_xp, strength_xp, defence_xp, hp_xp FROM combat_stats WHERE user_id = ?').bind(uid).first();
  if (!s) return 3;
  return combatLevelFrom(levelFromXp(s.attack_xp || 0), levelFromXp(s.strength_xp || 0), levelFromXp(s.defence_xp || 0), levelFromXp(s.hp_xp || 1154));
}

export async function handleMountsGet(request, env) {
  const session = await requireSession(request, env);
  if (!session) return json({ error: 'unauthorized' }, 401);
  const rows = await env.DB.prepare('SELECT mount_id FROM user_mounts WHERE user_id = ?').bind(session.user_id).all();
  return json({ owned: (rows.results || []).map(r => r.mount_id), combat_level: await combatLevel(env, session.user_id) });
}

export async function handleMountsBuy(request, env) {
  const session = await requireSession(request, env);
  if (!session) return json({ error: 'unauthorized' }, 401);
  const uid = session.user_id;
  const body = await readJson(request);
  const M = MOUNTS[body?.mount];
  if (!M) return json({ error: 'invalid_mount' }, 400);

  const npc = TOWN_NPCS_BY_ID[STABLE_NPC];
  const pos = await getPlayerPosition(env, uid);
  if (!pos || !npc || Math.hypot(pos.x - npc.x, pos.z - npc.z) > TALK_DIST_SERVER_M) return json({ error: 'too_far' }, 400);

  const lvl = await combatLevel(env, uid);
  if (lvl < M.level) return json({ error: 'low_level', message: `Necesitas nivel de combate ${M.level}.`, need: M.level, have: lvl }, 400);

  const now = Date.now();
  const ins = await env.DB.prepare('INSERT OR IGNORE INTO user_mounts (user_id, mount_id, bought_at) VALUES (?, ?, ?)').bind(uid, M.id, now).run();
  if (!ins?.meta?.changes) return json({ error: 'already_owned', message: 'Ya lo tienes.' }, 400);
  if (!(await debitCoins(env, uid, M.price, now))) {
    await env.DB.prepare('DELETE FROM user_mounts WHERE user_id = ? AND mount_id = ? AND bought_at = ?').bind(uid, M.id, now).run();
    return json({ error: 'not_enough_coins', message: `Cuesta ${M.price} monedas.` }, 400);
  }
  return json({ ok: true, mount: M.id, paid: M.price });
}
