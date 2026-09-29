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

import { QUESTS, QUEST_ORDER } from '../../client/src/shared/quests.js';

const INVENTORY_SLOTS = 20;

async function tableReady(env) {
  try { await env.DB.prepare('SELECT 1 FROM user_quests LIMIT 1').all(); return true; } catch { return false; }
}

/** Da un item: a la mochila si cabe, si no al banco. */
export async function grantItem(env, userId, itemId, qty = 1) {
  if (!qty || qty <= 0) return;
  const now = Date.now();
  const meta = await env.DB.prepare('SELECT stackable FROM items WHERE id = ?').bind(itemId).first();
  if (!meta) return;
  const inv = await env.DB.prepare('SELECT slot_index, item_id FROM user_inventory WHERE user_id = ?').bind(userId).all();
  const rows = inv.results || [];
  const used = new Set(rows.map(r => r.slot_index));
  const free = [];
  for (let i = 0; i < INVENTORY_SLOTS; i++) if (!used.has(i)) free.push(i);

  if (meta.stackable === 1) {
    const st = rows.find(r => r.item_id === itemId);
    if (st) {
      await env.DB.prepare('UPDATE user_inventory SET quantity = quantity + ?, updated_at = ? WHERE user_id = ? AND slot_index = ?')
        .bind(qty, now, userId, st.slot_index).run();
      return;
    }
    if (free.length) {
      await env.DB.prepare('INSERT INTO user_inventory (user_id, slot_index, item_id, quantity, updated_at) VALUES (?, ?, ?, ?, ?)')
        .bind(userId, free[0], itemId, qty, now).run();
      return;
    }
  } else {
    let left = qty;
    const stmts = [];
    for (const slot of free) {
      if (left <= 0) break;
      stmts.push(env.DB.prepare('INSERT INTO user_inventory (user_id, slot_index, item_id, quantity, updated_at) VALUES (?, ?, ?, 1, ?)')
        .bind(userId, slot, itemId, now));
      left--;
    }
    if (stmts.length) await env.DB.batch(stmts);
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

async function giveReward(env, userId, reward) {
  if (!reward) return;
  if (reward.coins) await grantItem(env, userId, 'coins', reward.coins);
  for (const [id, q] of reward.items || []) await grantItem(env, userId, id, q);
}

/** Crea las misiones que falten (tutorial) y entrega herramientas del paso actual. */
export async function ensureQuests(env, userId) {
  if (!(await tableReady(env))) return false;
  const now = Date.now();
  for (const qid of QUEST_ORDER) {
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

      const isLast = row.step + 1 >= q.steps.length;
      // Solo UNA petición consigue avanzar el paso (condición step + progress).
      const adv = await env.DB.prepare(
        `UPDATE user_quests SET step = ?, progress = 0, status = ?, updated_at = ?
          WHERE user_id = ? AND quest_id = ? AND step = ? AND status = 0 AND progress >= ?`
      ).bind(isLast ? row.step : row.step + 1, isLast ? 1 : 0, now, userId, row.quest_id, row.step, step.count).run();
      if (!adv?.meta?.changes) continue;
      await giveReward(env, userId, step.reward);
      if (isLast) {
        await giveReward(env, userId, q.reward);
        out.push({ quest_id: row.quest_id, step_done: step.id, quest_done: true });
      } else {
        await giveStepTools(env, userId, q.steps[row.step + 1]);
        out.push({ quest_id: row.quest_id, step_done: step.id });
      }
    }
  } catch (err) {
    console.warn('[quests] event failed (no fatal):', err?.message);
  }
  return out;
}
