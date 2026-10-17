/**
 * SebasPresent — Progreso: logros, contador de muertes, colección y récords (Sesión 53)
 *
 *   GET /api/progress          → tus logros (y paga los nuevos), contador, colección, Fosa, racha
 *   GET /api/progress/records  → récords de la isla: Fosa (top 10) y jefes (top 5 por jefe)
 *
 * No se llama en bucle: el cliente lo pide al abrir los libros y tras algo
 * que pueda dar un logro (subir de nivel, misión/diaria hecha, jefe, Fosa),
 * con un mínimo de 20 s entre peticiones. Aquí además se guarda 8 s por jugador.
 */
import { json } from '../lib/db.js';
import { requireSession } from '../lib/auth.js';
import { levelFromXp } from '../combat_engine.js';
import { combatLevelFrom } from '../../client/src/shared/mounts.js';
import { BOSSES } from '../../client/src/shared/bosses.js';
import { ACHIEVEMENTS, TIERS, achMet, ALL_SKILLS } from '../../client/src/shared/achievements.js';
import { DAILY_STREAK_ID, dayNumber } from '../../client/src/shared/dailies.js';
import { grantItem } from '../lib/quests.js';

const ME_CACHE_MS = 8_000;
const _me = new Map();   // uid → { at, body }

async function all(env, sql, ...b) {
  try { return (await env.DB.prepare(sql).bind(...b).all()).results || []; } catch { return []; }
}

export async function buildContext(env, uid, now = Date.now()) {
  const [skills, quests, kcRows, colRows, fosa, flagRows, achRows, trRows] = await Promise.all([
    all(env, 'SELECT skill_id, xp FROM user_skills WHERE user_id = ?', uid),
    all(env, 'SELECT quest_id, step, progress, status FROM user_quests WHERE user_id = ?', uid),
    all(env, 'SELECT npc_def_id, kills FROM user_kc WHERE user_id = ?', uid),
    all(env, 'SELECT item_id, qty FROM user_collection WHERE user_id = ?', uid),
    all(env, 'SELECT best_wave FROM user_fosa WHERE user_id = ?', uid),
    all(env, 'SELECT flag, value FROM user_quest_flags WHERE user_id = ?', uid),
    all(env, 'SELECT ach_id, at FROM user_achievements WHERE user_id = ?', uid),
    all(env, 'SELECT treasure_id, last_day FROM user_treasures WHERE user_id = ?', uid),   // Sesión 53 — tesoros
  ]);
  const lv = {};
  for (const r of skills) lv[r.skill_id] = levelFromXp(r.xp || 0);
  for (const s of ALL_SKILLS) if (!lv[s]) lv[s] = s === 'hitpoints' ? 10 : 1;
  const total = ALL_SKILLS.reduce((a, s) => a + lv[s], 0);
  const combat = combatLevelFrom(lv.attack, lv.strength, lv.defence, lv.hitpoints);
  const done = new Set(quests.filter(r => r.status === 1 && !r.quest_id.startsWith('daily_')).map(r => r.quest_id));
  const kc = {};
  let kills = 0, bossKills = 0, bossesKilled = 0;
  for (const r of kcRows) {
    kc[r.npc_def_id] = r.kills;
    kills += r.kills;
    if (BOSSES[r.npc_def_id]) { bossKills += r.kills; if (r.kills > 0) bossesKilled++; }
  }
  const collection = {};
  for (const r of colRows) collection[r.item_id] = r.qty;
  const sr = quests.find(r => r.quest_id === DAILY_STREAK_ID);
  const today = dayNumber(now);
  const streak = sr && (sr.step === today || sr.step === today - 1) ? sr.progress : 0;
  const flags = {};
  for (const f of flagRows) flags[f.flag] = f.value;
  const have = {};
  for (const r of achRows) have[r.ach_id] = r.at;
  const treasures = {};
  for (const r of trRows) treasures[r.treasure_id] = r.last_day;
  return {
    ctx: { lv, total, combat, done, kc, kills, bossKills, bossesKilled, fosaBest: fosa[0]?.best_wave || 0, col: colRows.length, streak, flags, treasures: trRows.length },
    collection, have, treasures,
  };
}

export async function handleProgress(request, env) {
  const session = await requireSession(request, env);
  if (!session) return json({ error: 'unauthorized' }, 401);
  const uid = session.user_id, now = Date.now();
  const cached = _me.get(uid);
  if (cached && now - cached.at < ME_CACHE_MS) return json({ ...cached.body, new: [] });

  const { ctx, collection, have, treasures } = await buildContext(env, uid, now);
  // Logros nuevos: se guardan y se pagan una sola vez (INSERT OR IGNORE decide quién paga).
  const fresh = ACHIEVEMENTS.filter(a => !have[a.id] && achMet(a, ctx));
  const won = [];
  if (fresh.length) {
    try {
      const res = await env.DB.batch(fresh.map(a =>
        env.DB.prepare('INSERT OR IGNORE INTO user_achievements (user_id, ach_id, at) VALUES (?, ?, ?)').bind(uid, a.id, now)));
      fresh.forEach((a, i) => { if (res?.[i]?.meta?.changes) { won.push(a.id); have[a.id] = now; } });
      const coins = won.reduce((s, id) => s + TIERS[ACHIEVEMENTS.find(a => a.id === id).tier].coins, 0);
      if (coins > 0) await grantItem(env, uid, 'coins', coins);
    } catch (err) { console.warn('[progress] logros:', err?.message); }
  }
  const points = Object.keys(have).reduce((s, id) => {
    const a = ACHIEVEMENTS.find(x => x.id === id);
    return s + (a ? TIERS[a.tier].pts : 0);
  }, 0);
  const body = {
    have, points, kc: ctx.kc, kills: ctx.kills, collection, fosa_best: ctx.fosaBest, streak: ctx.streak, treasures,
    ctx: { total: ctx.total, combat: ctx.combat, lv: ctx.lv, done: [...ctx.done], bossKills: ctx.bossKills, bossesKilled: ctx.bossesKilled, flags: ctx.flags },
  };
  _me.set(uid, { at: now, body });
  if (_me.size > 500) _me.clear();
  return json({ ...body, new: won });
}

// ------------------------------------------------------------
// Récords de la isla (60 s por isolate)
// ------------------------------------------------------------
const REC_CACHE_MS = 60_000;
let _rec = null, _recAt = 0;

export async function handleRecords(request, env) {
  const session = await requireSession(request, env);
  if (!session) return json({ error: 'unauthorized' }, 401);
  const now = Date.now();
  if (!_rec || now - _recAt > REC_CACHE_MS) {
    const fosa = await all(env,
      `SELECT u.username AS name, f.best_wave AS best FROM user_fosa f JOIN users u ON u.id = f.user_id
        WHERE f.best_wave > 0 ORDER BY f.best_wave DESC, f.user_id ASC LIMIT 10`);
    const ids = Object.keys(BOSSES);
    const kcRows = await all(env,
      `SELECT k.npc_def_id AS boss, u.username AS name, k.kills AS kills FROM user_kc k JOIN users u ON u.id = k.user_id
        WHERE k.npc_def_id IN (${ids.map(() => '?').join(',')}) AND k.kills > 0
        ORDER BY k.kills DESC`, ...ids);
    const bosses = {};
    for (const r of kcRows) { const l = (bosses[r.boss] ||= []); if (l.length < 5) l.push({ name: r.name, kills: r.kills }); }
    _rec = { fosa, bosses };
    _recAt = now;
  }
  return json(_rec);
}
