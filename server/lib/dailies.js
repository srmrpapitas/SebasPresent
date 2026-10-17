/**
 * SebasPresent — Tareas diarias (Sesión 53). Ver client/src/shared/dailies.js.
 *
 * Viven en user_quests ('daily_1..3' con step = día y 'daily_racha'), así que
 * questEvent ya las lee en la misma consulta que las misiones: no hay lecturas
 * extra en cada acción. Todas las escrituras van condicionadas (step/status/
 * progress) para que dos peticiones a la vez no cobren dos veces.
 */
import { DAILY_SLOTS, DAILY_STREAK_ID, dayNumber, dailyForSlot, dailyXp, dailyBonus } from '../../client/src/shared/dailies.js';
import { xpToLevel } from './skills_engine.js';

/** Crea las filas que falten y pone al día las de días anteriores. */
export async function ensureDailies(env, uid, now = Date.now()) {
  const day = dayNumber(now);
  try {
    await env.DB.batch([
      ...DAILY_SLOTS.map(slot => env.DB.prepare(
        `INSERT OR IGNORE INTO user_quests (user_id, quest_id, step, progress, status, started_at, updated_at)
         VALUES (?, ?, ?, 0, 0, ?, ?)`).bind(uid, slot, day, now, now)),
      env.DB.prepare(
        `UPDATE user_quests SET step = ?, progress = 0, status = 0, updated_at = ?
          WHERE user_id = ? AND quest_id IN ('daily_1','daily_2','daily_3') AND step < ?`).bind(day, now, uid, day),
      env.DB.prepare(
        `INSERT OR IGNORE INTO user_quests (user_id, quest_id, step, progress, status, started_at, updated_at)
         VALUES (?, ?, 0, 0, 2, ?, ?)`).bind(uid, DAILY_STREAK_ID, now, now),
    ]);
  } catch (err) { console.warn('[dailies] ensure:', err?.message); }
}

async function skillLevel(env, uid, skill) {
  const r = await env.DB.prepare('SELECT xp FROM user_skills WHERE user_id = ? AND skill_id = ?').bind(uid, skill).first();
  return xpToLevel(r?.xp || 0);
}

/**
 * Evento sobre una fila diaria (de la consulta de questEvent).
 * Devuelve null o { daily, progress, done, bonus? }.
 */
export async function dailyRowEvent(env, uid, row, event, match, now, { grantItem, grantXp }) {
  const day = dayNumber(now);
  const task = dailyForSlot(day, row.quest_id);
  if (!task) return null;
  // Fila de un día anterior: se pone a cero para hoy (solo una petición lo consigue).
  if (row.step !== day) {
    await env.DB.prepare(
      `UPDATE user_quests SET step = ?, progress = 0, status = 0, updated_at = ?
        WHERE user_id = ? AND quest_id = ? AND step = ?`).bind(day, now, uid, row.quest_id, row.step).run();
  } else if (row.status === 1) return null;
  if (task.event !== event) return null;
  if (task.match && task.match !== match) return null;
  const inc = await env.DB.prepare(
    `UPDATE user_quests SET progress = progress + 1, updated_at = ?
      WHERE user_id = ? AND quest_id = ? AND step = ? AND status = 0 AND progress < ?
      RETURNING progress`).bind(now, uid, row.quest_id, day, task.count).first();
  if (!inc) return null;
  if (inc.progress < task.count) return { daily: row.quest_id, progress: inc.progress };

  // Hecha: solo una petición la marca y cobra.
  const fin = await env.DB.prepare(
    `UPDATE user_quests SET status = 1, updated_at = ?
      WHERE user_id = ? AND quest_id = ? AND step = ? AND status = 0 AND progress >= ?`).bind(now, uid, row.quest_id, day, task.count).run();
  if (!fin?.meta?.changes) return null;
  const xp = dailyXp(await skillLevel(env, uid, task.skill));
  await grantItem(env, uid, 'coins', task.coins);
  await grantXp(env, uid, task.skill, xp);
  const out = { daily: row.quest_id, progress: task.count, done: true, coins: task.coins, xp, skill: task.skill };

  // ¿Las 3 hechas hoy? → premio y racha (una vez por día).
  const n = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM user_quests
      WHERE user_id = ? AND quest_id IN ('daily_1','daily_2','daily_3') AND step = ? AND status = 1`).bind(uid, day).first();
  if ((n?.n | 0) >= DAILY_SLOTS.length) {
    await env.DB.prepare(
      `INSERT OR IGNORE INTO user_quests (user_id, quest_id, step, progress, status, started_at, updated_at)
       VALUES (?, ?, 0, 0, 2, ?, ?)`).bind(uid, DAILY_STREAK_ID, now, now).run();
    const st = await env.DB.prepare(
      `UPDATE user_quests SET progress = CASE WHEN step = ? THEN progress + 1 ELSE 1 END, step = ?, updated_at = ?
        WHERE user_id = ? AND quest_id = ? AND step < ?
        RETURNING progress`).bind(day - 1, day, now, uid, DAILY_STREAK_ID, day).first();
    if (st) {
      const b = dailyBonus(st.progress);
      await grantItem(env, uid, 'coins', b.coins);
      for (const [id, q] of b.items) await grantItem(env, uid, id, q);
      out.bonus = { streak: st.progress, coins: b.coins, items: b.items };
    }
  }
  return out;
}
