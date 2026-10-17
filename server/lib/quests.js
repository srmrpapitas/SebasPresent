/**
 * SebasPresent — Motor de misiones (Sesión 50)
 *
 * Tabla user_quests (migrations/002_user_quests.sql):
 *   user_id, quest_id, step, progress, status (0 activa, 1 completada),
 *   started_at, updated_at — PK (user_id, quest_id)
 *
 * questEvent(env, userId, event, match) lo llaman los handlers cuando pasa
 * algo real (se taló un tronco, se forjó una pieza...). Nunca lanza: si
 * falla, la acción principal no se ve afectada.
 */

import { guardConds, slotCond, atomicBatch } from './atomic.js';   // Sesión 51
import { QUESTS, QUEST_ORDER, QUEST_REQS, checkReqs } from '../../client/src/shared/quests.js';
import { combatLevelFrom } from '../../client/src/shared/mounts.js';   // Sesión 52 — requisitos al encadenar capítulos
import { xpToLevel, MAX_XP } from './skills_engine.js';
import { ensureDailies, dailyRowEvent } from './dailies.js';   // Sesión 53 — tareas diarias
import { isDailyId, dayNumber } from '../../client/src/shared/dailies.js';

const INVENTORY_SLOTS = 20;

async function tableReady(env) {
  try { await env.DB.prepare('SELECT 1 FROM user_quests LIMIT 1').all(); return true; } catch { return false; }
}

/** Da un item: a la mochila si cabe, si no al banco.
 *  Sesión 51 — robusto ante cambios simultáneos: se suma a la pila POR
 *  item_id (no por número de slot) y cada inserción en un hueco libre se
 *  reintenta en el siguiente si otro proceso lo ocupó a la vez. */
export async function grantItem(env, userId, itemId, qty = 1) {
  if (!qty || qty <= 0) return;
  const now = Date.now();
  const meta = await env.DB.prepare('SELECT stackable FROM items WHERE id = ?').bind(itemId).first();
  if (!meta) return;
  const freeSlots = async () => {
    const inv = await env.DB.prepare('SELECT slot_index FROM user_inventory WHERE user_id = ?').bind(userId).all();
    const used = new Set((inv.results || []).map(r => r.slot_index));
    const free = [];
    for (let i = 0; i < INVENTORY_SLOTS; i++) if (!used.has(i)) free.push(i);
    return free;
  };
  const tryInsert = async (slot, q) => {
    try {
      await env.DB.prepare('INSERT INTO user_inventory (user_id, slot_index, item_id, quantity, updated_at) VALUES (?, ?, ?, ?, ?)')
        .bind(userId, slot, itemId, q, now).run();
      return true;
    } catch { return false; }   // hueco ocupado entre medias
  };

  if (meta.stackable === 1) {
    const up = await env.DB.prepare(
      `UPDATE user_inventory SET quantity = quantity + ?, updated_at = ?
        WHERE user_id = ? AND item_id = ?
          AND slot_index = (SELECT slot_index FROM user_inventory WHERE user_id = ? AND item_id = ? LIMIT 1)`
    ).bind(qty, now, userId, itemId, userId, itemId).run();
    if (up?.meta?.changes) return;
    for (const slot of await freeSlots()) if (await tryInsert(slot, qty)) return;
  } else {
    let left = qty;
    for (const slot of await freeSlots()) {
      if (left <= 0) break;
      if (await tryInsert(slot, 1)) left--;
    }
    qty = left;
    if (qty <= 0) return;
  }
  // Al banco
  const max = await env.DB.prepare('SELECT COALESCE(MAX(slot_index), -1) AS m FROM user_bank WHERE user_id = ?').bind(userId).first();
  await env.DB.prepare(
    `INSERT INTO user_bank (user_id, slot_index, item_id, quantity, updated_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(user_id, item_id) DO UPDATE SET quantity = user_bank.quantity + excluded.quantity, updated_at = excluded.updated_at`
  ).bind(userId, (max?.m ?? -1) + 1, itemId, qty, now).run();
}

async function hasItemAnywhere(env, userId, itemId) {
  const r = await env.DB.prepare(
    `SELECT 1 FROM user_inventory WHERE user_id = ? AND item_id = ?
     UNION ALL SELECT 1 FROM user_equipment WHERE user_id = ? AND item_id = ?
     UNION ALL SELECT 1 FROM user_bank WHERE user_id = ? AND item_id = ?
     LIMIT 1`
  ).bind(userId, itemId, userId, itemId, userId, itemId).first();
  return !!r;
}

async function giveStepTools(env, userId, step) {
  for (const id of step?.give || []) {
    try { if (!(await hasItemAnywhere(env, userId, id))) await grantItem(env, userId, id, 1); } catch {}
  }
}

// Sesión 50 — XP de recompensa. Las skills de combate viven en combat_stats
// (y se reflejan en user_skills); el resto solo en user_skills.
const COMBAT_XP_COL = {
  attack: 'attack_xp', strength: 'strength_xp', defence: 'defence_xp', hitpoints: 'hp_xp',
  ranged: 'ranged_xp', magic: 'magic_xp', prayer: 'prayer_xp',
};   // (herblore y demás oficios van solo a user_skills)
export async function grantXp(env, userId, skill, amount) {
  if (!amount || amount <= 0) return;
  const now = Date.now();
  const col = COMBAT_XP_COL[skill];
  if (col) {
    try {
      await env.DB.prepare(`UPDATE combat_stats SET ${col} = MIN(${col} + ?, ?) WHERE user_id = ?`).bind(amount, MAX_XP, userId).run();
    } catch (err) { console.warn('[quests] xp combate:', err?.message); }
  }
  await env.DB.prepare(
    `INSERT INTO user_skills (user_id, skill_id, xp, updated_at) VALUES (?, ?, ?, 0)
     ON CONFLICT(user_id, skill_id) DO UPDATE SET xp = MIN(xp + excluded.xp, ?)`
  ).bind(userId, skill, amount, MAX_XP).run().catch(async () => {
    // Sin UNIQUE(user_id, skill_id) → hacerlo a mano
    const r = await env.DB.prepare('UPDATE user_skills SET xp = MIN(xp + ?, ?) WHERE user_id = ? AND skill_id = ?').bind(amount, MAX_XP, userId, skill).run();
    if (!r?.meta?.changes) await env.DB.prepare('INSERT INTO user_skills (user_id, skill_id, xp, updated_at) VALUES (?, ?, ?, 0)').bind(userId, skill, amount).run();
  });
}

async function giveReward(env, userId, reward) {
  if (!reward) return;
  if (reward.coins) await grantItem(env, userId, 'coins', reward.coins);
  for (const [id, q] of reward.items || []) await grantItem(env, userId, id, q);
  for (const [skill, amount] of Object.entries(reward.xp || {})) {
    try { await grantXp(env, userId, skill, amount); } catch (err) { console.warn('[quests] xp:', err?.message); }
  }
}

// ============================================================
// Sesión 52 — Decisiones del jugador (user_quest_flags, migración 023)
// Un paso puede llevar `if: { flag: valor | [valores] }`: solo se hace si
// el jugador eligió eso antes. Así una misión tiene caminos distintos.
// ============================================================
export async function getFlags(env, userId) {
  try {
    const r = await env.DB.prepare('SELECT flag, value FROM user_quest_flags WHERE user_id = ?').bind(userId).all();
    const out = {};
    for (const f of r.results || []) out[f.flag] = f.value;
    return out;
  } catch { return {}; }
}
export function stepApplies(step, flags) {
  if (!step?.if) return true;
  for (const [k, v] of Object.entries(step.if)) {
    const ok = Array.isArray(v) ? v.includes(flags[k]) : flags[k] === v;
    if (!ok) return false;
  }
  return true;
}
function branching(q) { return q.steps.some(s => s.if); }
/** Primer paso desde `from` que le toca hacer al jugador (-1 = no queda ninguno). */
export function nextStepIndex(q, from, flags) {
  for (let i = from; i < q.steps.length; i++) if (stepApplies(q.steps[i], flags)) return i;
  return -1;
}

/** Avanza (o termina) el paso `row.step` si nadie lo ha hecho ya. */
async function advanceStep(env, userId, row, q, step, now) {
  const next = branching(q) ? nextStepIndex(q, row.step + 1, await getFlags(env, userId))
    : (row.step + 1 < q.steps.length ? row.step + 1 : -1);
  const isLast = next < 0;
  const adv = await env.DB.prepare(
    `UPDATE user_quests SET step = ?, progress = 0, status = ?, updated_at = ?
      WHERE user_id = ? AND quest_id = ? AND step = ? AND status = 0 AND progress >= ?`
  ).bind(isLast ? row.step : next, isLast ? 1 : 0, now, userId, row.quest_id, row.step, step.count || 1).run();
  if (!adv?.meta?.changes) return null;
  await giveReward(env, userId, step.reward);
  if (isLast) {
    await giveReward(env, userId, q.reward);
    // Sesión 52 — historia: el siguiente capítulo empieza solo si ya cumples sus requisitos
    let next_quest = null;
    if (q.next && QUESTS[q.next]) {
      try { if (await canStart(env, userId, q.next)) { if (await startQuest(env, userId, q.next)) next_quest = q.next; } } catch {}
    }
    return { quest_id: row.quest_id, step_done: step.id, quest_done: true, next_quest };
  }
  await giveStepTools(env, userId, q.steps[next]);
  return { quest_id: row.quest_id, step_done: step.id };
}

/** Sesión 52 — ¿cumple los requisitos de una misión? (niveles y misiones previas) */
export async function canStart(env, userId, questId) {
  if (!QUEST_REQS[questId]) return true;
  const rows = (await env.DB.prepare('SELECT skill_id, xp FROM user_skills WHERE user_id = ?').bind(userId).all()).results || [];
  const lv = {};
  for (const r of rows) lv[r.skill_id] = xpToLevel(r.xp || 0);
  lv.combat = combatLevelFrom(lv.attack || 1, lv.strength || 1, lv.defence || 1, lv.hitpoints || 10);
  const done = new Set(((await env.DB.prepare('SELECT quest_id FROM user_quests WHERE user_id = ? AND status = 1').bind(userId).all()).results || []).map(r => r.quest_id));
  return checkReqs(questId, lv, done).every(r => r.ok);
}

/** Paso activo de una misión (o null). */
async function activeRow(env, userId, questId) {
  return env.DB.prepare('SELECT quest_id, step, progress FROM user_quests WHERE user_id = ? AND quest_id = ? AND status = 0')
    .bind(userId, questId).first();
}
/** Marca el paso como hecho (solo una petición lo consigue) y avanza. */
async function completeSingleStep(env, userId, row, q, step) {
  const now = Date.now();
  const mark = await env.DB.prepare(
    'UPDATE user_quests SET progress = 1, updated_at = ? WHERE user_id = ? AND quest_id = ? AND step = ? AND status = 0 AND progress = 0'
  ).bind(now, userId, row.quest_id, row.step).run();
  if (!mark?.meta?.changes) return null;
  return { now };
}

/** Sesión 52 — paso "ve a tal sitio" (el handler ya comprobó posición/noche). */
export async function visitStep(env, userId, questId) {
  const q = QUESTS[questId];
  const row = q ? await activeRow(env, userId, questId) : null;
  const step = row ? q.steps[row.step] : null;
  if (!step || step.event !== 'visit') return { error: 'not_now' };
  const m = await completeSingleStep(env, userId, row, q, step);
  if (!m) return { error: 'not_now' };
  const res = await advanceStep(env, userId, { ...row, progress: 1 }, q, step, m.now);
  return { ok: true, results: res ? [res] : [] };
}

/** Sesión 52 — paso de decisión: guarda la elección y avanza. */
export async function chooseStep(env, userId, questId, optionId) {
  const q = QUESTS[questId];
  const row = q ? await activeRow(env, userId, questId) : null;
  const step = row ? q.steps[row.step] : null;
  if (!step || step.event !== 'choice') return { error: 'not_now' };
  const opt = (step.options || []).find(o => o.id === optionId);
  if (!opt) return { error: 'invalid_option' };
  const m = await completeSingleStep(env, userId, row, q, step);
  if (!m) return { error: 'not_now' };
  await env.DB.prepare(
    `INSERT INTO user_quest_flags (user_id, flag, value, set_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id, flag) DO UPDATE SET value = excluded.value, set_at = excluded.set_at`
  ).bind(userId, step.flag, opt.id, m.now).run();
  await giveReward(env, userId, opt.reward);
  const res = await advanceStep(env, userId, { ...row, progress: 1 }, q, step, m.now);
  return { ok: true, results: res ? [res] : [] };
}

/** Sesión 50 — empezar una misión que ofrece un NPC. */
export async function startQuest(env, userId, questId) {
  const q = QUESTS[questId];
  if (!q || !(await tableReady(env))) return false;
  const now = Date.now();
  // Sesión 52 — el primer paso puede depender de una decisión anterior
  const first = branching(q) ? Math.max(0, nextStepIndex(q, 0, await getFlags(env, userId))) : 0;
  const r = await env.DB.prepare(
    `INSERT OR IGNORE INTO user_quests (user_id, quest_id, step, progress, status, started_at, updated_at)
     VALUES (?, ?, ?, 0, 0, ?, ?)`
  ).bind(userId, questId, first, now, now).run();
  if (r?.meta?.changes) await giveStepTools(env, userId, q.steps[first]);
  return !!r?.meta?.changes;
}

/**
 * Sesión 50 — entregar objetos a un NPC (paso 'deliver'). Solo objetos
 * reales de la mochila (las notas no valen, como en OSRS).
 * Devuelve { ok, results } o { error, missing }.
 */
export async function deliverToNpc(env, userId, npcId) {
  const rows = await env.DB.prepare(
    'SELECT quest_id, step, progress FROM user_quests WHERE user_id = ? AND status = 0'
  ).bind(userId).all();
  const inv = await env.DB.prepare(
    'SELECT slot_index, item_id, quantity FROM user_inventory WHERE user_id = ? ORDER BY slot_index'
  ).bind(userId).all();
  const invRows = inv.results || [];
  const results = [];
  let lastMissing = null;
  for (const row of rows.results || []) {
    const q = QUESTS[row.quest_id];
    const step = q?.steps?.[row.step];
    if (!step || step.event !== 'deliver' || step.npc !== npcId) continue;
    const missing = [];
    for (const [id, n] of step.items) {
      const have = invRows.filter(r => r.item_id === id).reduce((t, r) => t + r.quantity, 0);
      if (have < n) missing.push([id, n - have]);
    }
    if (missing.length) { lastMissing = missing; continue; }
    const now = Date.now();
    // Marcar el progreso ANTES de quitar (solo una petición pasa)
    const mark = await env.DB.prepare(
      `UPDATE user_quests SET progress = 1, updated_at = ? WHERE user_id = ? AND quest_id = ? AND step = ? AND status = 0 AND progress = 0`
    ).bind(now, userId, row.quest_id, row.step).run();
    if (!mark?.meta?.changes) continue;
    const stmts = [null];   // [0] = guarda (Sesión 51)
    const conds = [];
    for (const [id, n] of step.items) {
      let left = n;
      for (const r of invRows) {
        if (left <= 0) break;
        if (r.item_id !== id || r.quantity <= 0) continue;
        const take = Math.min(left, r.quantity);
        conds.push(slotCond(userId, r.slot_index, id, r.quantity));
        stmts.push(take >= r.quantity
          ? env.DB.prepare('DELETE FROM user_inventory WHERE user_id = ? AND slot_index = ? AND item_id = ?').bind(userId, r.slot_index, id)
          : env.DB.prepare('UPDATE user_inventory SET quantity = quantity - ? WHERE user_id = ? AND slot_index = ? AND item_id = ?').bind(take, userId, r.slot_index, id));
        r.quantity -= take;
        left -= take;
      }
    }
    // Sesión 51 — GUARDA: los objetos siguen ahí. Antes, entregar mientras
    // movías la mochila completaba la misión sin quitarte nada.
    stmts[0] = guardConds(env, conds);
    if (!(await atomicBatch(env, stmts))) {
      await env.DB.prepare('UPDATE user_quests SET progress = 0 WHERE user_id = ? AND quest_id = ? AND step = ? AND status = 0 AND progress = 1')
        .bind(userId, row.quest_id, row.step).run();
      return { error: 'changed', message: 'Tu mochila cambió mientras tanto. Inténtalo otra vez.' };
    }
    const res = await advanceStep(env, userId, row, q, step, now);
    if (res) results.push(res);
  }
  if (!results.length && lastMissing) return { error: 'missing_items', missing: lastMissing };
  return { ok: true, results };
}

/** Crea las misiones que falten (tutorial) y entrega herramientas del paso actual. */
export async function ensureQuests(env, userId) {
  if (!(await tableReady(env))) return false;
  const now = Date.now();
  await ensureDailies(env, userId, now);   // Sesión 53
  for (const qid of QUEST_ORDER) {
    if (QUESTS[qid].giver) continue;   // Sesión 50 — esas se empiezan hablando con su NPC
    const r = await env.DB.prepare(
      `INSERT OR IGNORE INTO user_quests (user_id, quest_id, step, progress, status, started_at, updated_at)
       VALUES (?, ?, 0, 0, 0, ?, ?)`
    ).bind(userId, qid, now, now).run();
    if (r?.meta?.changes) await giveStepTools(env, userId, QUESTS[qid].steps[0]);
  }
  return true;
}

export async function getUserQuests(env, userId) {
  const rows = await env.DB.prepare(
    'SELECT quest_id, step, progress, status, updated_at FROM user_quests WHERE user_id = ?'
  ).bind(userId).all();
  return rows.results || [];
}

/**
 * Registra un evento. Avanza el paso activo de cada misión si coincide.
 * Devuelve [{ quest_id, step_done?, quest_done? }] (para logs / respuestas).
 */
export async function questEvent(env, userId, event, match = null) {
  const out = [];
  try {
    // Sesión 53 — también las diarias de días anteriores (aunque estén hechas) para ponerlas a cero.
    const rows = await env.DB.prepare(
      `SELECT quest_id, step, progress, status FROM user_quests
        WHERE user_id = ? AND (status = 0 OR (quest_id IN ('daily_1','daily_2','daily_3') AND step < ?))`
    ).bind(userId, dayNumber()).all();
    for (const row of rows.results || []) {
      if (isDailyId(row.quest_id)) {
        try {
          const d = await dailyRowEvent(env, userId, row, event, match, Date.now(), { grantItem, grantXp });
          if (d) out.push(d);
        } catch (err) { console.warn('[dailies] event:', err?.message); }
        continue;
      }
      const q = QUESTS[row.quest_id];
      const step = q?.steps?.[row.step];
      if (!step || step.event !== event) continue;
      if (step.match && step.match !== match) continue;
      const now = Date.now();
      // +1 progreso, condicionado a seguir en el mismo paso (evita dobles avances)
      const inc = await env.DB.prepare(
        `UPDATE user_quests SET progress = progress + 1, updated_at = ?
          WHERE user_id = ? AND quest_id = ? AND step = ? AND status = 0 AND progress < ?`
      ).bind(now, userId, row.quest_id, row.step, step.count).run();
      if (!inc?.meta?.changes) continue;
      const cur = await env.DB.prepare(
        'SELECT progress FROM user_quests WHERE user_id = ? AND quest_id = ? AND step = ? AND status = 0'
      ).bind(userId, row.quest_id, row.step).first();
      if (!cur || cur.progress < step.count) { out.push({ quest_id: row.quest_id }); continue; }

      // Solo UNA petición consigue avanzar el paso (condición step + progress).
      const res = await advanceStep(env, userId, row, q, step, now);
      if (res) out.push(res);
    }
  } catch (err) {
    console.warn('[quests] event failed (no fatal):', err?.message);
  }
  return out;
}
