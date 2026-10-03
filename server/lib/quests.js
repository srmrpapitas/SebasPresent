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
import { QUESTS, QUEST_ORDER } from '../../client/src/shared/quests.js';
import { xpToLevel, MAX_XP } from './skills_engine.js';

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

/** Avanza (o termina) el paso `row.step` si nadie lo ha hecho ya. */
async function advanceStep(env, userId, row, q, step, now) {
  const isLast = row.step + 1 >= q.steps.length;
  const adv = await env.DB.prepare(
    `UPDATE user_quests SET step = ?, progress = 0, status = ?, updated_at = ?
      WHERE user_id = ? AND quest_id = ? AND step = ? AND status = 0 AND progress >= ?`
  ).bind(isLast ? row.step : row.step + 1, isLast ? 1 : 0, now, userId, row.quest_id, row.step, step.count || 1).run();
  if (!adv?.meta?.changes) return null;
  await giveReward(env, userId, step.reward);
  if (isLast) {
    await giveReward(env, userId, q.reward);
    return { quest_id: row.quest_id, step_done: step.id, quest_done: true };
  }
  await giveStepTools(env, userId, q.steps[row.step + 1]);
  return { quest_id: row.quest_id, step_done: step.id };
}

/** Sesión 50 — empezar una misión que ofrece un NPC. */
export async function startQuest(env, userId, questId) {
  const q = QUESTS[questId];
  if (!q || !(await tableReady(env))) return false;
  const now = Date.now();
  const r = await env.DB.prepare(
    `INSERT OR IGNORE INTO user_quests (user_id, quest_id, step, progress, status, started_at, updated_at)
     VALUES (?, ?, 0, 0, 0, ?, ?)`
  ).bind(userId, questId, now, now).run();
  if (r?.meta?.changes) await giveStepTools(env, userId, q.steps[0]);
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
    const rows = await env.DB.prepare(
      'SELECT quest_id, step, progress FROM user_quests WHERE user_id = ? AND status = 0'
    ).bind(userId).all();
    for (const row of rows.results || []) {
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
