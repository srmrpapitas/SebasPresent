/**
 * SebasPresent — La ASO, club de socios (Sesión 50)
 *   GET  /api/aso            → { socio, fee, sponsor_near }
 *   POST /api/aso/join { via: 'socio' | 'pavos' }
 * Hay que estar junto a Carmita. 'socio' exige un socio conectado a tu lado;
 * 'pavos' cobra 5 pavos (500 monedas). Alta primero (INSERT OR IGNORE) y
 * cobro después: dos peticiones a la vez nunca cobran dos veces.
 */
import { json, readJson } from '../lib/db.js';
import { requireSession } from '../lib/auth.js';
import { getPlayerPosition } from './skills/_shared.js';
import { debitCoins } from './shop.js';
import { TOWN_NPCS_BY_ID, TALK_DIST_SERVER_M } from '../../client/src/shared/town_npcs.js';
import { ASO_NPC, ASO_FEE_COINS, ASO_SPONSOR_DIST_M, ASO_ONLINE_MS } from '../../client/src/shared/aso.js';

export async function isAsoMember(env, uid) {
  const r = await env.DB.prepare('SELECT 1 AS ok FROM aso_members WHERE user_id = ?').bind(uid).first();
  return !!r;
}

async function sponsorNear(env, uid, pos, now) {
  const r = await env.DB.prepare(
    `SELECT o.user_id FROM online_users o JOIN aso_members m ON m.user_id = o.user_id
      WHERE o.user_id != ? AND o.last_seen > ?
        AND (o.x - ?) * (o.x - ?) + (o.z - ?) * (o.z - ?) <= ?
      LIMIT 1`
  ).bind(uid, now - ASO_ONLINE_MS, pos.x, pos.x, pos.z, pos.z, ASO_SPONSOR_DIST_M * ASO_SPONSOR_DIST_M).first();
  return r?.user_id || null;
}

export async function handleAsoStatus(request, env) {
  const session = await requireSession(request, env);
  if (!session) return json({ error: 'unauthorized' }, 401);
  const uid = session.user_id;
  const socio = await isAsoMember(env, uid);
  const pos = await getPlayerPosition(env, uid);
  const near = !socio && pos ? !!(await sponsorNear(env, uid, pos, Date.now())) : false;
  return json({ socio, fee: ASO_FEE_COINS, sponsor_near: near });
}

export async function handleAsoJoin(request, env) {
  const session = await requireSession(request, env);
  if (!session) return json({ error: 'unauthorized' }, 401);
  const uid = session.user_id;
  const body = await readJson(request);
  const via = body?.via;
  if (via !== 'socio' && via !== 'pavos') return json({ error: 'bad_request' }, 400);
  const now = Date.now();

  const npc = TOWN_NPCS_BY_ID[ASO_NPC];
  const pos = await getPlayerPosition(env, uid);
  if (!pos || !npc || Math.hypot(pos.x - npc.x, pos.z - npc.z) > TALK_DIST_SERVER_M) return json({ error: 'too_far' }, 400);
  if (await isAsoMember(env, uid)) return json({ ok: true, socio: true, already: true });

  let sponsor = null;
  if (via === 'socio') {
    sponsor = await sponsorNear(env, uid, pos, now);
    if (!sponsor) return json({ error: 'no_sponsor', message: 'No hay ningún socio contigo.' }, 400);
  }
  const ins = await env.DB.prepare('INSERT OR IGNORE INTO aso_members (user_id, joined_at, via, sponsor_id) VALUES (?, ?, ?, ?)')
    .bind(uid, now, via, sponsor).run();
  if (!ins?.meta?.changes) return json({ ok: true, socio: true, already: true });
  if (via === 'pavos') {
    const paid = await debitCoins(env, uid, ASO_FEE_COINS, now);
    if (!paid) {
      await env.DB.prepare('DELETE FROM aso_members WHERE user_id = ? AND joined_at = ?').bind(uid, now).run();
      return json({ error: 'not_enough_coins', message: 'No tienes 5 pavos.' }, 400);
    }
  }
  return json({ ok: true, socio: true, via, paid: via === 'pavos' ? ASO_FEE_COINS : 0 });
}
