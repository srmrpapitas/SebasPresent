/**
 * SebasPresent — Beber pociones (Sesión 50)
 *   POST /api/potion/drink { slot }
 * Gasta UNA dosis (con guarda: dos peticiones a la vez = una) y aplica el
 * efecto: subida de nivel temporal (combat_stats.boosts) o puntos de plegaria.
 */
import { json, readJson } from '../lib/db.js';
import { requireSession } from '../lib/auth.js';
import { parsePotion, boostAmount, POTION_BOOST_MS } from '../../client/src/shared/herblore.js';
import { levelFromXp } from '../combat_engine.js';
import { prayerLevel, loadState, saveState, stateJson } from './prayer.js';

const XP_COL = { attack: 'attack_xp', strength: 'strength_xp', defence: 'defence_xp', ranged: 'ranged_xp', magic: 'magic_xp' };

export async function handlePotionDrink(request, env) {
  const session = await requireSession(request, env);
  if (!session) return json({ error: 'unauthorized' }, 401);
  const body = await readJson(request);
  const slot = Number(body?.slot);
  if (!Number.isInteger(slot) || slot < 0 || slot >= 20) return json({ error: 'invalid_slot' }, 400);
  const uid = session.user_id;
  const now = Date.now();

  const inv = await env.DB.prepare('SELECT item_id FROM user_inventory WHERE user_id = ? AND slot_index = ?').bind(uid, slot).first();
  const pp = inv && parsePotion(inv.item_id);
  if (!pp) return json({ error: 'not_potion', message: 'Eso no se bebe.' }, 400);

  const stats = await env.DB.prepare('SELECT * FROM combat_stats WHERE user_id = ?').bind(uid).first();
  if (!stats || stats.hp_current <= 0) return json({ error: 'dead' }, 400);

  // 1) Gastar la dosis (con guarda)
  const took = pp.doses > 1
    ? await env.DB.prepare('UPDATE user_inventory SET item_id = ?, updated_at = ? WHERE user_id = ? AND slot_index = ? AND item_id = ?')
        .bind(`${pp.potion.id}_${pp.doses - 1}`, now, uid, slot, inv.item_id).run()
    : await env.DB.prepare('DELETE FROM user_inventory WHERE user_id = ? AND slot_index = ? AND item_id = ?')
        .bind(uid, slot, inv.item_id).run();
  if (!took?.meta?.changes) return json({ error: 'not_potion' }, 400);

  // 2) Efecto
  const P = pp.potion;
  if (P.boost) {
    const base = levelFromXp(stats[XP_COL[P.boost.skill]] || 0);
    const v = boostAmount(P, base);
    let boosts = {};
    try { boosts = stats.boosts ? JSON.parse(stats.boosts) : {}; } catch {}
    const cur = boosts[P.boost.skill];
    // Una poción más fuerte sustituye; una igual renueva el tiempo
    if (!cur || cur.until <= now || v >= (cur.v | 0)) boosts[P.boost.skill] = { v, until: now + POTION_BOOST_MS };
    await env.DB.prepare('UPDATE combat_stats SET boosts = ? WHERE user_id = ?').bind(JSON.stringify(boosts), uid).run();
    return json({ ok: true, potion: P.id, name: P.name, doses_left: pp.doses - 1, skill: P.boost.skill, boost: v, base, until: now + POTION_BOOST_MS });
  }
  if (P.prayer) {
    const { level } = await prayerLevel(env, uid);
    const st = await loadState(env, uid, level, now);
    const gain = P.prayer.flat + Math.floor(level * P.prayer.pct);
    const pts = Math.min(level, st.points + gain);
    await saveState(env, uid, pts, st.active, now);
    return json({ ok: true, potion: P.id, name: P.name, doses_left: pp.doses - 1, prayer: stateJson(level, pts, st.active, now), restored: +(pts - st.points).toFixed(1) });
  }
  return json({ ok: true, potion: P.id });
}
