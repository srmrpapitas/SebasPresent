/**
 * SebasPresent — Fundición + Herrería (Sesión 50)
 *
 * Endpoints:
 *   GET  /api/smithing/recipes                       → recetas (desde la D1)
 *   POST /api/smithing/smelt { station_id, material } → 1 mineral → 1 lingote (horno)
 *   POST /api/smithing/smith { station_id, item_id }  → N lingotes → 1 pieza (yunque)
 *
 * Una acción por petición; el cliente encadena "Fundir 5 / Todo" con su propio
 * ritmo (como "Cocinar todo"). Anti-trampas:
 *   - La estación existe (shared/smithing.js) y estás a ≤ STATION_USE_DIST_M
 *     según tu posición del heartbeat.
 *   - Ritmo: UPDATE condicional sobre user_skills.updated_at de 'smithing'
 *     (1 acción cada MIN_TICK_MS aunque lleguen muchas en paralelo).
 *   - Receta de herrería leída de items (smith_level, bars_required, material).
 */

import { json, readJson } from '../../lib/db.js';
import { requireSession } from '../../lib/auth.js';
import { xpToLevel, MAX_XP } from '../../lib/skills_engine.js';
import { getPlayerPosition, isWithinDistance } from './_shared.js';
import {
  MATERIALS, MATERIAL_NAMES, SMELT, SMITH_XP_PER_BAR, getStation, STATION_USE_DIST_M,
} from '../../../client/src/shared/smithing.js';
import { questEvent } from '../../lib/quests.js';
import { guardConds, slotCond } from '../../lib/atomic.js';   // Sesión 51

const SKILL_ID = 'smithing';
const INVENTORY_SLOTS = 20;
const MIN_TICK_MS = 1200;

// ------------------------------------------------------------
// Recetas
// ------------------------------------------------------------
export async function handleSmithingRecipes(request, env) {
  const session = await requireSession(request, env);
  if (!session) return json({ error: 'unauthorized' }, 401);

  const rows = await env.DB.prepare(
    `SELECT id, name, icon, material, tier, smith_level, bars_required, equip_slot,
            attack_bonus, defence_bonus
       FROM items
      WHERE smith_level IS NOT NULL AND bars_required IS NOT NULL
      ORDER BY tier, smith_level, bars_required, id`
  ).all();

  const smelt = MATERIALS.map(m => ({
    material: m,
    name: MATERIAL_NAMES[m],
    ore: `ore_${m}`,
    bar: `bar_${m}`,
    level: SMELT[m].level,
    xp: SMELT[m].xp,
  }));
  const smith = (rows.results || [])
    .filter(r => MATERIALS.includes(r.material))
    .map(r => ({
      id: r.id, name: r.name, icon: r.icon, material: r.material, tier: r.tier,
      level: r.smith_level, bars: r.bars_required, slot: r.equip_slot,
      attack_bonus: r.attack_bonus | 0, defence_bonus: r.defence_bonus | 0,
      xp: r.bars_required * (SMITH_XP_PER_BAR[r.material] || 10),
    }));
  return json({ smelt, smith });
}

// ------------------------------------------------------------
// Comunes
// ------------------------------------------------------------
async function precheck(request, env, stationType) {
  const session = await requireSession(request, env);
  if (!session) return { res: json({ error: 'unauthorized' }, 401) };
  const body = await readJson(request);
  const station = getStation(body?.station_id);
  if (!station || station.type !== stationType) {
    return { res: json({ error: 'invalid_station', message: 'Ahí no hay ' + (stationType === 'furnace' ? 'un horno.' : 'un yunque.') }, 400) };
  }
  const userId = session.user_id;
  const pos = await getPlayerPosition(env, userId);
  if (!pos) return { res: json({ error: 'no_position' }, 400) };
  const d = isWithinDistance(pos, station.x, station.z, STATION_USE_DIST_M);
  if (!d.ok) return { res: json({ error: 'out_of_range', message: 'Acércate más.', distance: +d.distance.toFixed(2) }, 400) };

  await env.DB.prepare(
    `INSERT OR IGNORE INTO user_skills (user_id, skill_id, xp, updated_at) VALUES (?, ?, 0, 0)`
  ).bind(userId, SKILL_ID).run();
  const skill = await env.DB.prepare(
    'SELECT xp FROM user_skills WHERE user_id = ? AND skill_id = ?'
  ).bind(userId, SKILL_ID).first();
  return { body, userId, station, xp: skill?.xp || 0, level: xpToLevel(skill?.xp || 0) };
}

async function gate(env, userId, now) {
  const r = await env.DB.prepare(
    `UPDATE user_skills SET updated_at = ? WHERE user_id = ? AND skill_id = ? AND updated_at <= ?`
  ).bind(now, userId, SKILL_ID, now - MIN_TICK_MS).run();
  return !!r?.meta?.changes;
}

/**
 * Prepara las sentencias para quitar `qty` unidades de `itemId` y meter
 * 1 unidad de `productId`. Devuelve { stmts } o { error }.
 * El producto va al primer slot liberado (si no se apila), así el lingote
 * aparece donde estaba el mineral.
 */
async function buildTransform(env, userId, itemId, qty, productId, now) {
  const inv = await env.DB.prepare(
    `SELECT inv.slot_index, inv.item_id, inv.quantity, i.stackable
       FROM user_inventory inv LEFT JOIN items i ON i.id = inv.item_id
      WHERE inv.user_id = ? ORDER BY inv.slot_index`
  ).bind(userId).all();
  const rows = inv.results || [];
  const have = rows.filter(r => r.item_id === itemId);
  const total = have.reduce((t, r) => t + r.quantity, 0);
  if (total < qty) return { error: 'missing_materials', have: total };

  const stmts = [null];   // [0] = guarda (Sesión 51)
  const conds = [];
  const freed = [];
  let left = qty;
  for (const r of have) {
    if (left <= 0) break;
    const take = Math.min(left, r.quantity);
    conds.push(slotCond(userId, r.slot_index, itemId, r.quantity));   // Sesión 51 — sigue igual
    if (take >= r.quantity) {
      stmts.push(env.DB.prepare(
        'DELETE FROM user_inventory WHERE user_id = ? AND slot_index = ? AND item_id = ?'
      ).bind(userId, r.slot_index, itemId));
      freed.push(r.slot_index);
    } else {
      stmts.push(env.DB.prepare(
        'UPDATE user_inventory SET quantity = quantity - ?, updated_at = ? WHERE user_id = ? AND slot_index = ? AND item_id = ?'
      ).bind(take, now, userId, r.slot_index, itemId));
    }
    left -= take;
  }

  const meta = await env.DB.prepare('SELECT stackable FROM items WHERE id = ?').bind(productId).first();
  if (!meta) return { error: 'unknown_item' };
  const stack = meta.stackable === 1 ? rows.find(r => r.item_id === productId) : null;
  if (stack) {
    conds.push(slotCond(userId, stack.slot_index, productId));
    stmts.push(env.DB.prepare(
      'UPDATE user_inventory SET quantity = quantity + 1, updated_at = ? WHERE user_id = ? AND slot_index = ? AND item_id = ?'
    ).bind(now, userId, stack.slot_index, productId));
  } else {
    let slot = freed.length ? freed[0] : null;
    if (slot === null) {
      const used = new Set(rows.map(r => r.slot_index));
      for (let i = 0; i < INVENTORY_SLOTS; i++) if (!used.has(i)) { slot = i; break; }
    }
    if (slot === null) return { error: 'inventory_full' };
    stmts.push(env.DB.prepare(
      'INSERT INTO user_inventory (user_id, slot_index, item_id, quantity, updated_at) VALUES (?, ?, ?, 1, ?)'
    ).bind(userId, slot, productId, now));
  }
  // Sesión 51 — GUARDA: el mineral/lingotes siguen ahí (antes, fundir y tirar
  // el mineral a la vez daba el lingote y el mineral en el suelo).
  stmts[0] = guardConds(env, conds);
  return { stmts };
}

async function finish(env, userId, stmts, xpGain, prevXp, now = 0) {
  stmts.push(env.DB.prepare(
    'UPDATE user_skills SET xp = MIN(xp + ?, ?) WHERE user_id = ? AND skill_id = ?'
  ).bind(xpGain, MAX_XP, userId, SKILL_ID));
  try {
    await env.DB.batch(stmts);
  } catch (e) {
    // Sesión 51 — algo cambió a la vez (guarda o hueco ocupado): no se hizo nada
    if (now) await env.DB.prepare('UPDATE user_skills SET updated_at = ? WHERE user_id = ? AND skill_id = ? AND updated_at = ?')
      .bind(now - MIN_TICK_MS, userId, SKILL_ID, now).run().catch(() => {});
    return null;
  }
  const after = await env.DB.prepare(
    'SELECT xp FROM user_skills WHERE user_id = ? AND skill_id = ?'
  ).bind(userId, SKILL_ID).first();
  const newXp = after?.xp ?? prevXp + xpGain;
  const prevLevel = xpToLevel(prevXp);
  const newLevel = xpToLevel(newXp);
  return { xp_gained: xpGain, new_xp: newXp, new_level: newLevel, prev_level: prevLevel, level_up: newLevel > prevLevel };
}

function errorResponse(r) {
  if (r.error === 'missing_materials') return json({ error: 'missing_materials', message: 'No tienes suficientes materiales.', have: r.have }, 400);
  if (r.error === 'inventory_full') return json({ error: 'inventory_full', message: 'Mochila llena.' }, 400);
  return json({ error: r.error || 'bad_request' }, 400);
}

// ------------------------------------------------------------
// Fundir
// ------------------------------------------------------------
export async function handleSmithingSmelt(request, env) {
  const c = await precheck(request, env, 'furnace');
  if (c.res) return c.res;
  const material = c.body?.material;
  const rule = SMELT[material];
  if (!rule) return json({ error: 'invalid_material' }, 400);
  if (c.level < rule.level) {
    return json({ error: 'level_too_low', message: `Necesitas nivel ${rule.level} de Herrería.`, required_level: rule.level }, 400);
  }
  const now = Date.now();
  const ore = `ore_${material}`, bar = `bar_${material}`;
  const t = await buildTransform(env, c.userId, ore, 1, bar, now);
  if (t.error) return errorResponse(t);
  if (!(await gate(env, c.userId, now))) return json({ error: 'too_fast' }, 429);
  const r = await finish(env, c.userId, t.stmts, rule.xp, c.xp, now);
  if (!r) return json({ error: 'conflict', message: 'Inténtalo otra vez.' }, 409);
  await questEvent(env, c.userId, 'smelt', material);
  return json({ ok: true, action: 'smelt', material, consumed: { item_id: ore, qty: 1 }, produced: bar, skill_id: SKILL_ID, ...r });
}

// ------------------------------------------------------------
// Forjar
// ------------------------------------------------------------
export async function handleSmithingSmith(request, env) {
  const c = await precheck(request, env, 'anvil');
  if (c.res) return c.res;
  const itemId = c.body?.item_id;
  if (typeof itemId !== 'string' || itemId.length > 64) return json({ error: 'invalid_item' }, 400);
  const recipe = await env.DB.prepare(
    'SELECT id, name, material, smith_level, bars_required FROM items WHERE id = ? AND smith_level IS NOT NULL AND bars_required IS NOT NULL'
  ).bind(itemId).first();
  if (!recipe || !MATERIALS.includes(recipe.material)) {
    return json({ error: 'invalid_item', message: 'Eso no se puede forjar.' }, 400);
  }
  if (c.level < recipe.smith_level) {
    return json({ error: 'level_too_low', message: `Necesitas nivel ${recipe.smith_level} de Herrería.`, required_level: recipe.smith_level }, 400);
  }
  const now = Date.now();
  const bar = `bar_${recipe.material}`;
  const t = await buildTransform(env, c.userId, bar, recipe.bars_required, recipe.id, now);
  if (t.error) return errorResponse(t);
  if (!(await gate(env, c.userId, now))) return json({ error: 'too_fast' }, 429);
  const xp = recipe.bars_required * (SMITH_XP_PER_BAR[recipe.material] || 10);
  const r = await finish(env, c.userId, t.stmts, xp, c.xp, now);
  if (!r) return json({ error: 'conflict', message: 'Inténtalo otra vez.' }, 409);
  await questEvent(env, c.userId, 'smith', recipe.id);
  return json({ ok: true, action: 'smith', consumed: { item_id: bar, qty: recipe.bars_required }, produced: recipe.id, produced_name: recipe.name, skill_id: SKILL_ID, ...r });
}
