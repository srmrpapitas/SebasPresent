/**
 * SebasPresent — Casas de jugador (Sesión 50)
 *   GET  /api/house              → { tier, tiers, rest_ready_at }
 *   POST /api/house/buy { tier } → comprar o mejorar (junto a Nauzet)
 *   POST /api/house/rest         → dormir en tu cama: vida al máximo
 *   GET  /api/house/friends      → casas que puedes visitar (de quien te tiene en su lista de amigos)
 *
 * Cambio de nivel con guarda (WHERE tier = el de antes) y cobro después; si el
 * cobro falla se deshace. Dos compras a la vez nunca cobran dos veces.
 */
import { json, readJson } from '../lib/db.js';
import { requireSession } from '../lib/auth.js';
import { getPlayerPosition } from './skills/_shared.js';
import { debitCoins } from './shop.js';
import { levelFromXp } from '../combat_engine.js';
import { TOWN_NPCS_BY_ID, TALK_DIST_SERVER_M } from '../../client/src/shared/town_npcs.js';
import {
  HOUSE_TIERS, HOUSE_AGENT, HOUSE_REST_COOLDOWN_MS, upgradeCost, houseHas, nearHousePortal,
} from '../../client/src/shared/houses.js';

export async function getHouse(env, uid) {
  return await env.DB.prepare('SELECT tier, last_rest FROM user_houses WHERE user_id = ?').bind(uid).first();
}

/** ¿Está en una urbanización y su casa tiene ese mueble? (cofre/altar/cama) */
export async function atHouseWith(env, uid, feature, pos = null) {
  const p = pos || await getPlayerPosition(env, uid);
  if (!p || !nearHousePortal(Number(p.x), Number(p.z))) return false;
  const h = await getHouse(env, uid);
  return !!h && houseHas(h.tier, feature);
}

export async function handleHouseGet(request, env) {
  const session = await requireSession(request, env);
  if (!session) return json({ error: 'unauthorized' }, 401);
  const h = await getHouse(env, session.user_id);
  return json({
    tier: h?.tier || null,
    rest_ready_at: h?.last_rest ? h.last_rest + HOUSE_REST_COOLDOWN_MS : 0,
    tiers: HOUSE_TIERS,
  });
}

export async function handleHouseBuy(request, env) {
  const session = await requireSession(request, env);
  if (!session) return json({ error: 'unauthorized' }, 401);
  const uid = session.user_id;
  const body = await readJson(request);
  const to = body?.tier;
  if (typeof to !== 'string' || !Object.prototype.hasOwnProperty.call(HOUSE_TIERS, to)) return json({ error: 'invalid_tier' }, 400);   // S51: sin '__proto__'

  const agent = TOWN_NPCS_BY_ID[HOUSE_AGENT];
  const pos = await getPlayerPosition(env, uid);
  if (!pos || !agent || Math.hypot(pos.x - agent.x, pos.z - agent.z) > TALK_DIST_SERVER_M) return json({ error: 'too_far' }, 400);

  const cur = await getHouse(env, uid);
  const from = cur?.tier || null;
  const cost = upgradeCost(from, to);
  if (cost == null) return json({ error: 'already_owned', message: 'Ya tienes una casa igual o mejor.' }, 400);
  const now = Date.now();

  // 1) Cambiar la casa (con guarda)
  const ch = from
    ? await env.DB.prepare('UPDATE user_houses SET tier = ? WHERE user_id = ? AND tier = ?').bind(to, uid, from).run()
    : await env.DB.prepare('INSERT OR IGNORE INTO user_houses (user_id, tier, bought_at) VALUES (?, ?, ?)').bind(uid, to, now).run();
  if (!ch?.meta?.changes) return json({ error: 'try_again' }, 409);

  // 2) Cobrar; si no llega, deshacer
  if (!(await debitCoins(env, uid, cost, now))) {
    if (from) await env.DB.prepare('UPDATE user_houses SET tier = ? WHERE user_id = ? AND tier = ?').bind(from, uid, to).run();
    else await env.DB.prepare('DELETE FROM user_houses WHERE user_id = ? AND tier = ? AND bought_at = ?').bind(uid, to, now).run();
    return json({ error: 'not_enough_coins', message: `Te faltan monedas: cuesta ${cost}.` }, 400);
  }
  return json({ ok: true, tier: to, from, paid: cost });
}

export async function handleHouseRest(request, env) {
  const session = await requireSession(request, env);
  if (!session) return json({ error: 'unauthorized' }, 401);
  const uid = session.user_id;
  const now = Date.now();
  if (!(await atHouseWith(env, uid, 'cama'))) return json({ error: 'not_home', message: 'Tienes que estar en tu casa.' }, 400);

  const stats = await env.DB.prepare('SELECT hp_current, hp_xp, last_attack_at FROM combat_stats WHERE user_id = ?').bind(uid).first();
  if (!stats) return json({ error: 'no_stats' }, 400);
  if (stats.hp_current <= 0) return json({ error: 'dead' }, 400);
  if (stats.last_attack_at && now - stats.last_attack_at < 10_000) return json({ error: 'in_combat', message: 'No puedes dormir en pleno combate.' }, 400);

  const took = await env.DB.prepare(
    'UPDATE user_houses SET last_rest = ? WHERE user_id = ? AND (last_rest IS NULL OR last_rest <= ?)'
  ).bind(now, uid, now - HOUSE_REST_COOLDOWN_MS).run();
  if (!took?.meta?.changes) {
    const h = await getHouse(env, uid);
    return json({ error: 'rested', message: 'Todavía no tienes sueño.', ready_at: (h?.last_rest || 0) + HOUSE_REST_COOLDOWN_MS }, 400);
  }
  const hpMax = levelFromXp(stats.hp_xp || 0);
  await env.DB.prepare('UPDATE combat_stats SET hp_current = ? WHERE user_id = ? AND hp_current > 0').bind(hpMax, uid).run();
  return json({ ok: true, hp: hpMax, hp_max: hpMax, ready_at: now + HOUSE_REST_COOLDOWN_MS });
}

/**
 * Sesión 50 — Visitas: puedes entrar a la casa de quien TE TIENE en su lista
 * de amigos (él decide a quién deja pasar). Solo es mirar: los muebles
 * (cama, cofre, altar) siguen siendo de su dueño y el server ya los valida
 * contra TU casa, así que una visita no da nada.
 */
export async function handleHouseFriends(request, env) {
  const session = await requireSession(request, env);
  if (!session) return json({ error: 'unauthorized' }, 401);
  const rows = (await env.DB.prepare(
    `SELECT u.id, u.username AS name, h.tier
       FROM user_friends f
       JOIN users u ON u.id = f.user_id
       JOIN user_houses h ON h.user_id = f.user_id
      WHERE f.friend_id = ?
      ORDER BY u.username COLLATE NOCASE LIMIT 50`
  ).bind(session.user_id).all()).results || [];
  return json({ houses: rows.filter(r => HOUSE_TIERS[r.tier]) });
}
