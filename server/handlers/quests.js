/**
 * SebasPresent — Misiones (Sesión 50)
 *   GET  /api/quests              → crea las que falten (tutorial) y devuelve el estado
 *   POST /api/quests/skip { quest_id } → marca una misión como terminada (sin recompensa final)
 */
import { QUEST_REQS, checkReqs } from '../../client/src/shared/quests.js';   // Sesión 50
import { combatLevelFrom } from '../../client/src/shared/mounts.js';
import { levelFromXp } from '../combat_engine.js';
import { json, readJson } from '../lib/db.js';
import { requireSession } from '../lib/auth.js';
import { ensureQuests, getUserQuests, startQuest, deliverToNpc, questEvent } from '../lib/quests.js';
import { TOWN_NPCS_BY_ID, TALK_DIST_SERVER_M, npcDist } from '../../client/src/shared/town_npcs.js';   // Sesión 50
import { getPlayerPosition } from './skills/_shared.js';
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


// ============================================================
// Sesión 50 — Hablar con NPCs / aceptar misiones / entregar objetos
// ============================================================
// Sesión 50 — niveles (user_skills es la fuente única, combate incluido) y misiones hechas
async function playerLevels(env, uid) {
  const rows = (await env.DB.prepare('SELECT skill_id, xp FROM user_skills WHERE user_id = ?').bind(uid).all()).results || [];
  const lv = {};
  for (const r of rows) lv[r.skill_id] = levelFromXp(r.xp || 0);
  lv.combat = combatLevelFrom(lv.attack || 1, lv.strength || 1, lv.defence || 1, lv.hitpoints || 10);
  return lv;
}
async function doneQuests(env, uid) {
  const rows = (await env.DB.prepare('SELECT quest_id FROM user_quests WHERE user_id = ? AND status = 1').bind(uid).all()).results || [];
  return new Set(rows.map(r => r.quest_id));
}

async function nearNpc(env, userId, npcId) {
  const npc = TOWN_NPCS_BY_ID[npcId];
  if (!npc) return { error: 'invalid_npc' };
  const pos = await getPlayerPosition(env, userId);
  if (!pos) return { error: 'no_position' };
  const d = npcDist(npc, pos.x, pos.z);
  if (d > TALK_DIST_SERVER_M) return { error: 'too_far', distance: d };
  return { npc };
}

/** POST /api/npc/talk { npc_id } → evento 'talk' (pasos "vuelve a hablar con…") */
export async function handleNpcTalk(request, env) {
  const session = await requireSession(request, env);
  if (!session) return json({ error: 'unauthorized' }, 401);
  const body = await readJson(request);
  const near = await nearNpc(env, session.user_id, body?.npc_id);
  if (near.error) return json(near, 400);
  const results = await questEvent(env, session.user_id, 'talk', body.npc_id);
  return json({ ok: true, results, quests: await getUserQuests(env, session.user_id) });
}

/** POST /api/quests/start { quest_id } → aceptar la misión de un NPC (hay que estar a su lado) */
export async function handleQuestStart(request, env) {
  const session = await requireSession(request, env);
  if (!session) return json({ error: 'unauthorized' }, 401);
  const body = await readJson(request);
  const q = QUESTS[body?.quest_id];
  if (!q || !q.giver) return json({ error: 'invalid_quest' }, 400);
  const near = await nearNpc(env, session.user_id, q.giver);
  if (near.error) return json(near, 400);
  // Sesión 50 — requisitos (niveles y misiones previas)
  if (QUEST_REQS[q.id]) {
    const miss = checkReqs(q.id, await playerLevels(env, session.user_id), await doneQuests(env, session.user_id)).filter(r => !r.ok);
    if (miss.length) return json({ error: 'reqs', message: `Te falta: ${miss.map(r => r.label).join(', ')}.`, missing: miss.map(r => r.label) }, 400);
  }
  const started = await startQuest(env, session.user_id, q.id);
  return json({ ok: true, started, quests: await getUserQuests(env, session.user_id) });
}

/** POST /api/npc/deliver { npc_id } → entregar los objetos que pide el paso actual */
export async function handleNpcDeliver(request, env) {
  const session = await requireSession(request, env);
  if (!session) return json({ error: 'unauthorized' }, 401);
  const body = await readJson(request);
  const near = await nearNpc(env, session.user_id, body?.npc_id);
  if (near.error) return json(near, 400);
  const r = await deliverToNpc(env, session.user_id, body.npc_id);
  if (r.error) return json(r, 400);
  return json({ ok: true, results: r.results, quests: await getUserQuests(env, session.user_id) });
}
