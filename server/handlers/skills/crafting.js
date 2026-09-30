/**
 * SebasPresent — Flechería y Artesanía (Sesión 50)
 *
 * Endpoint:
 *   POST /api/crafting/make { recipe_id }  → hace UNA vez la receta.
 *
 * Recetas en client/src/shared/crafting.js (el cliente solo manda el id).
 * Validación: nivel, herramienta en la mochila, materiales suficientes,
 * cerrojo atómico por skill (updated_at) y hueco para el resultado.
 * Todo (quitar materiales + dar producto + XP) va en un único batch.
 */

import { json, readJson } from '../../lib/db.js';
import { requireSession } from '../../lib/auth.js';
import { xpToLevel, MAX_XP } from '../../lib/skills_engine.js';
import { RECIPES_BY_ID, TOOL_NAMES, SKILL_LABEL, CRAFT_MIN_TICK_MS } from '../../../client/src/shared/crafting.js';
import { questEvent } from '../../lib/quests.js';

const INVENTORY_SLOTS = 20;

export async function handleCraftingMake(request, env) {
  const session = await requireSession(request, env);
  if (!session) return json({ error: 'unauthorized' }, 401);
  const userId = session.user_id;

  const body = await readJson(request);
  const rec = RECIPES_BY_ID[body?.recipe_id];
  if (!rec) return json({ error: 'invalid_recipe', message: 'Esa receta no existe.' }, 400);
  const now = Date.now();

  // 1) Nivel
  await env.DB.prepare(
    'INSERT OR IGNORE INTO user_skills (user_id, skill_id, xp, updated_at) VALUES (?, ?, 0, 0)'
  ).bind(userId, rec.skill).run();
  const sk = await env.DB.prepare(
    'SELECT xp FROM user_skills WHERE user_id = ? AND skill_id = ?'
  ).bind(userId, rec.skill).first();
  const prevXp = sk?.xp || 0;
  const level = xpToLevel(prevXp);
  if (level < rec.level) {
    return json({
      error: 'level_too_low', message: `Necesitas nivel ${rec.level} de ${SKILL_LABEL[rec.skill]}.`,
      required_level: rec.level, current_level: level,
    }, 400);
  }

  // 2) Mochila: herramienta + materiales
  const inv = await env.DB.prepare(
    `SELECT inv.slot_index, inv.item_id, inv.quantity, i.stackable
       FROM user_inventory inv LEFT JOIN items i ON i.id = inv.item_id
      WHERE inv.user_id = ? ORDER BY inv.slot_index`
  ).bind(userId).all();
  const rows = inv.results || [];
  if (rec.tool && !rows.some(r => r.item_id === rec.tool)) {
    return json({ error: 'no_tool', message: `Necesitas ${TOOL_NAMES[rec.tool] || rec.tool}.`, tool: rec.tool }, 400);
  }

  const stmts = [];
  const freed = [];
  for (const [itemId, qty] of rec.in) {
    const have = rows.filter(r => r.item_id === itemId);
    const total = have.reduce((t, r) => t + r.quantity, 0);
    if (total < qty) {
      return json({ error: 'missing_materials', message: 'Te faltan materiales.', item: itemId, need: qty, have: total }, 400);
    }
    let left = qty;
    for (const r of have) {
      if (left <= 0) break;
      const take = Math.min(left, r.quantity);
      if (take >= r.quantity) {
        stmts.push(env.DB.prepare(
          'DELETE FROM user_inventory WHERE user_id = ? AND slot_index = ? AND item_id = ?'
        ).bind(userId, r.slot_index, itemId));
        freed.push(r.slot_index);
      } else {
        stmts.push(env.DB.prepare(
          'UPDATE user_inventory SET quantity = quantity - ?, updated_at = ? WHERE user_id = ? AND slot_index = ? AND item_id = ? AND quantity >= ?'
        ).bind(take, now, userId, r.slot_index, itemId, take));
      }
      left -= take;
    }
  }

  // 3) Hueco para el producto
  const [outId, outQty] = rec.out;
  const meta = await env.DB.prepare('SELECT stackable FROM items WHERE id = ?').bind(outId).first();
  if (!meta) return json({ error: 'unknown_item', message: 'Objeto desconocido.' }, 500);
  const stack = meta.stackable === 1 ? rows.find(r => r.item_id === outId && !freed.includes(r.slot_index)) : null;
  if (stack) {
    stmts.push(env.DB.prepare(
      'UPDATE user_inventory SET quantity = quantity + ?, updated_at = ? WHERE user_id = ? AND slot_index = ?'
    ).bind(outQty, now, userId, stack.slot_index));
  } else {
    const nSlots = meta.stackable === 1 ? 1 : outQty;
    const used = new Set(rows.map(r => r.slot_index));
    for (const f of freed) used.delete(f);
    const free = [...freed];
    for (let i = 0; i < INVENTORY_SLOTS; i++) if (!used.has(i) && !free.includes(i)) free.push(i);
    if (free.length < nSlots) return json({ error: 'inventory_full', message: 'Mochila llena.' }, 400);
    for (let k = 0; k < nSlots; k++) {
      stmts.push(env.DB.prepare(
        'INSERT INTO user_inventory (user_id, slot_index, item_id, quantity, updated_at) VALUES (?, ?, ?, ?, ?)'
      ).bind(userId, free[k], outId, meta.stackable === 1 ? outQty : 1, now));
    }
  }

  // 4) Cerrojo de ritmo (una acción cada CRAFT_MIN_TICK_MS por skill)
  const gate = await env.DB.prepare(
    'UPDATE user_skills SET updated_at = ? WHERE user_id = ? AND skill_id = ? AND updated_at <= ?'
  ).bind(now, userId, rec.skill, now - CRAFT_MIN_TICK_MS).run();
  if (!gate?.meta?.changes) return json({ error: 'too_fast', message: 'Espera un momento.' }, 429);

  stmts.push(env.DB.prepare(
    'UPDATE user_skills SET xp = MIN(xp + ?, ?) WHERE user_id = ? AND skill_id = ?'
  ).bind(rec.xp, MAX_XP, userId, rec.skill));
  try {
    await env.DB.batch(stmts);
  } catch (err) {
    // p. ej. el hueco se ocupó entre medias (PK) → no se hizo nada
    return json({ error: 'conflict', message: 'Inténtalo otra vez.' }, 409);
  }
  await questEvent(env, userId, rec.skill === 'fletching' ? 'fletch' : rec.skill === 'herblore' ? 'herb' : 'craft', outId);

  const after = await env.DB.prepare(
    'SELECT xp FROM user_skills WHERE user_id = ? AND skill_id = ?'
  ).bind(userId, rec.skill).first();
  const newXp = after?.xp ?? prevXp + rec.xp;
  const newLevel = xpToLevel(newXp);
  return json({
    ok: true, recipe_id: rec.id, item_id: outId, quantity: outQty,
    skill_id: rec.skill, xp_gained: rec.xp, new_xp: newXp,
    new_level: newLevel, prev_level: level, level_up: newLevel > level,
  });
}
