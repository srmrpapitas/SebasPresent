/**
 * SebasPresent — Misiones (Sesión 50)
 *   GET  /api/quests              → crea las que falten (tutorial) y devuelve el estado
 *   POST /api/quests/skip { quest_id } → marca una misión como terminada (sin recompensa final)
 */
import { json, readJson } from '../lib/db.js';
import { requireSession } from '../lib/auth.js';
import { ensureQuests, getUserQuests } from '../lib/quests.js';
import { QUESTS } from '../../client/src/shared/quests.js';

export async function handleQuestsGet(request, env) {
  const session = await requireSession(request, env);
  if (!session) return json({ error: 'unauthorized' }, 401);
  const ok = await ensureQuests(env, session.user_id);
  if (!ok) return json({ quests: [], disabled: true });
  return json({ quests: await getUserQuests(env, session.user_id) });
}

export async function handleQuestsSkip(request, env) {
  const session = await requireSession(request, env);
  if (!session) return json({ error: 'unauthorized' }, 401);
  const body = await readJson(request);
  const q = QUESTS[body?.quest_id];
  if (!q) return json({ error: 'invalid_quest' }, 400);
  await env.DB.prepare(
    `UPDATE user_quests SET status = 1, step = ?, progress = 0, updated_at = ? WHERE user_id = ? AND quest_id = ? AND status = 0`
  ).bind(q.steps.length - 1, Date.now(), session.user_id, q.id).run();
  return json({ ok: true, quests: await getUserQuests(env, session.user_id) });
}
