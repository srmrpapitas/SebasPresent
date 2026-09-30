/**
 * SebasPresent — Plegaria (Sesión 50)
 *
 *   POST /api/prayer/bury     { slot }       → entierra 1 hueso del slot (XP Plegaria)
 *   POST /api/prayer/toggle   { prayer_id }  → activa/desactiva una plegaria
 *   POST /api/prayer/recharge { altar_id }   → recarga puntos en un altar cercano
 *
 * Estado en combat_stats: prayer_points (REAL), prayer_updated_at, active_prayers
 * ("id1,id2"). El gasto se calcula al vuelo (shared/prayer.js → currentPrayerState).
 * Migración: server/migrations/003_prayer.sql
 */

import { json, readJson } from '../lib/db.js';
import { requireSession } from '../lib/auth.js';
import { xpToLevel, MAX_XP } from '../lib/skills_engine.js';
import { getPlayerPosition, isWithinDistance } from './skills/_shared.js';
import { questEvent } from '../lib/quests.js';
import { pushRealtime } from '../lib/realtime.js';   // Sesión 50 — plegaria sobre la cabeza en directo
import {
  overheadPrayer,
  BONES, PRAYERS_BY_ID, ALTARS, ALTAR_USE_DIST_M, currentPrayerState,
} from '../../client/src/shared/prayer.js';

const SKILL_ID = 'prayer';
const BURY_TICK_MS = 1000;

async function prayerLevel(env, userId) {
  await env.DB.prepare(
    'INSERT OR IGNORE INTO user_skills (user_id, skill_id, xp, updated_at) VALUES (?, ?, 0, 0)'
  ).bind(userId, SKILL_ID).run();
  const r = await env.DB.prepare('SELECT xp FROM user_skills WHERE user_id = ? AND skill_id = ?').bind(userId, SKILL_ID).first();
  return { xp: r?.xp || 0, level: xpToLevel(r?.xp || 0) };
}

async function loadState(env, userId, level, now) {
  const row = await env.DB.prepare(
    'SELECT prayer_points, prayer_updated_at, active_prayers FROM combat_stats WHERE user_id = ?'
  ).bind(userId).first();
  if (!row) return { points: level, active: [] };
  const pts = row.prayer_points == null ? level : Math.min(level, row.prayer_points);
  return currentPrayerState(pts, row.prayer_updated_at, row.active_prayers, now);
}

async function saveState(env, userId, points, active, now) {
  await env.DB.prepare(
    `INSERT INTO combat_stats (user_id, hp_xp, hp_current) VALUES (?, 1154, 10) ON CONFLICT(user_id) DO NOTHING`
  ).bind(userId).run();
  await env.DB.prepare(
    'UPDATE combat_stats SET prayer_points = ?, prayer_updated_at = ?, active_prayers = ? WHERE user_id = ?'
  ).bind(points, now, active.join(','), userId).run();
}

function stateJson(level, points, active, now) {
  return { prayer_level: level, prayer_points: +points.toFixed(3), prayer_max: level, active_prayers: active, updated_at: now };
}

export async function handlePrayerBury(request, env) {
  const session = await requireSession(request, env);
  if (!session) return json({ error: 'unauthorized' }, 401);
  const body = await readJson(request);
  const slot = Number(body?.slot);
  if (!Number.isInteger(slot) || slot < 0 || slot >= 20) return json({ error: 'invalid_slot' }, 400);
  const userId = session.user_id;
  const inv = await env.DB.prepare(
    'SELECT item_id, quantity FROM user_inventory WHERE user_id = ? AND slot_index = ?'
  ).bind(userId, slot).first();
  const bone = inv && BONES[inv.item_id];
  if (!bone) return json({ error: 'not_bones', message: 'Eso no se puede enterrar.' }, 400);

  const { xp: prevXp } = await prayerLevel(env, userId);
  const now = Date.now();
  const gate = await env.DB.prepare(
    'UPDATE user_skills SET updated_at = ? WHERE user_id = ? AND skill_id = ? AND updated_at <= ?'
  ).bind(now, userId, SKILL_ID, now - BURY_TICK_MS).run();
  if (!gate?.meta?.changes) return json({ error: 'too_fast' }, 429);

  await env.DB.batch([
    inv.quantity > 1
      ? env.DB.prepare('UPDATE user_inventory SET quantity = quantity - 1, updated_at = ? WHERE user_id = ? AND slot_index = ? AND item_id = ?')
          .bind(now, userId, slot, inv.item_id)
      : env.DB.prepare('DELETE FROM user_inventory WHERE user_id = ? AND slot_index = ? AND item_id = ?')
          .bind(userId, slot, inv.item_id),
    env.DB.prepare('UPDATE user_skills SET xp = MIN(xp + ?, ?) WHERE user_id = ? AND skill_id = ?')
      .bind(bone.xp, MAX_XP, userId, SKILL_ID),
  ]);
  await questEvent(env, userId, 'bury', inv.item_id);
  const newXp = prevXp + bone.xp;
  const prevLevel = xpToLevel(prevXp), newLevel = xpToLevel(newXp);
  return json({ ok: true, item_id: inv.item_id, xp_gained: bone.xp, skill_id: SKILL_ID, new_xp: newXp, new_level: newLevel, prev_level: prevLevel, level_up: newLevel > prevLevel });
}

export async function handlePrayerToggle(request, env) {
  const session = await requireSession(request, env);
  if (!session) return json({ error: 'unauthorized' }, 401);
  const body = await readJson(request);
  const p = PRAYERS_BY_ID[body?.prayer_id];
  if (!p) return json({ error: 'invalid_prayer' }, 400);
  const userId = session.user_id;
  const now = Date.now();
  const { level } = await prayerLevel(env, userId);
  const st = await loadState(env, userId, level, now);
  let active = st.active.slice();
  if (active.includes(p.id)) {
    active = active.filter(id => id !== p.id);
  } else {
    if (level < p.level) return json({ error: 'level_too_low', message: `Necesitas nivel ${p.level} de Plegaria.` }, 400);
    if (st.points <= 0) return json({ error: 'no_prayer_points', message: 'No te quedan puntos de plegaria. Recárgalos en un altar.' }, 400);
    active = active.filter(id => PRAYERS_BY_ID[id]?.group !== p.group);
    active.push(p.id);
  }
  await saveState(env, userId, st.points, active, now);
  try { await pushRealtime(env, { t: 'pr', id: userId, o: overheadPrayer(active) }); } catch {}
  return json({ ok: true, ...stateJson(level, st.points, active, now) });
}

export async function handlePrayerRecharge(request, env) {
  const session = await requireSession(request, env);
  if (!session) return json({ error: 'unauthorized' }, 401);
  const body = await readJson(request);
  const altar = ALTARS.find(a => a.id === body?.altar_id);
  if (!altar) return json({ error: 'invalid_altar' }, 400);
  const userId = session.user_id;
  const pos = await getPlayerPosition(env, userId);
  if (!pos) return json({ error: 'no_position' }, 400);
  if (!isWithinDistance(pos, altar.x, altar.z, ALTAR_USE_DIST_M).ok) {
    return json({ error: 'out_of_range', message: 'Acércate al altar.' }, 400);
  }
  const now = Date.now();
  const { level } = await prayerLevel(env, userId);
  const st = await loadState(env, userId, level, now);
  await saveState(env, userId, level, st.active, now);
  await questEvent(env, userId, 'altar', altar.id);
  return json({ ok: true, ...stateJson(level, level, st.active, now) });
}
