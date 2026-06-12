/**
 * SebasPresent — Cooking + Food handler (Sesión 48)
 *
 * Endpoints:
 *   POST /api/food/eat     { slot }   → come el item del slot, cura HP.
 *   POST /api/cooking/cook { slot }   → cocina el item crudo del slot en un
 *                                       fuego cercano (tabla fires, <2.5m).
 *
 * Reglas (spec Nico S48):
 *   - Pollo crudo cura 1 · cocinado cura 3. Nivel 1 de cocina.
 *   - Ternera cruda cura 2 · cocinada cura 5. Nivel 5 de cocina.
 *   - Quemar: 50% en el nivel requerido, baja 2.5%/nivel → 0% a req+20.
 *   - Quemado no da XP y el resultado (burnt_*) no es comestible.
 *   - Cocinar exige un fuego ENCENDIDO (fires.expires_at > now) a <2.5m.
 *
 * Mismo patrón defensivo que firemaking.js: posición desde online_users,
 * XP vía skills_engine, validación server-authoritative siempre.
 */

import { json, readJson } from '../../lib/db.js';
import { requireSession } from '../../lib/auth.js';
import { applyXpGrant, xpToLevel, startingXpFor } from '../../lib/skills_engine.js';
import { tableExists } from './_shared.js';

const SKILL_ID = 'cooking';
const FIRE_COOK_RADIUS_M = 2.5;   // distancia máxima al fuego para cocinar
const MAX_INV_SLOTS = 20;
// Sesión 49 — cooldown de comida estilo OSRS: 1 pieza cada 2 ticks (1.8s).
const EAT_COOLDOWN_MS = 1800;

// Comestibles: heal = HP que cura al comer. (burnt_* NO están → no comestibles)
const EDIBLE_DEFS = {
  raw_chicken:    { name: 'Pollo crudo',       heal: 1 },
  cooked_chicken: { name: 'Pollo cocinado',    heal: 3 },
  raw_beef:       { name: 'Ternera cruda',     heal: 2 },
  cooked_beef:    { name: 'Ternera cocinada',  heal: 5 },
};

// Cocinables: crudo → cocinado/quemado. cookLevel = nivel de Cocina requerido.
// burnStop = nivel al que ya NUNCA se quema (req + 20 → 50% baja 2.5%/nivel).
const COOKABLE_DEFS = {
  raw_chicken: {
    cooked: 'cooked_chicken', burnt: 'burnt_chicken',
    cookLevel: 1,  xp: 30,
  },
  raw_beef: {
    cooked: 'cooked_beef',    burnt: 'burnt_beef',
    cookLevel: 5,  xp: 40,
  },
};

const BURN_BASE = 0.50;          // 50% en el nivel requerido
const BURN_DROP_PER_LEVEL = 0.025; // -2.5% por nivel por encima del requerido

function burnChance(cookingLevel, reqLevel) {
  return Math.max(0, BURN_BASE - BURN_DROP_PER_LEVEL * (cookingLevel - reqLevel));
}

// ============================================================
// POST /api/food/eat { slot }
// ============================================================
export async function handleFoodEat(request, env) {
  const session = await requireSession(request, env);
  if (!session) return json({ error: 'unauthorized' }, 401);
  const userId = session.user_id;

  const body = await readJson(request);
  if (!body) return json({ error: 'bad_request' }, 400);
  const slot = Number(body.slot);
  if (!Number.isInteger(slot) || slot < 0 || slot > 27) {
    return json({ error: 'invalid_slot' }, 400);
  }

  // Item del slot
  const invRow = await env.DB.prepare(
    'SELECT item_id, quantity FROM user_inventory WHERE user_id = ? AND slot_index = ?'
  ).bind(userId, slot).first();
  if (!invRow) return json({ error: 'empty_slot' }, 400);

  const food = EDIBLE_DEFS[invRow.item_id];
  if (!food) {
    return json({ error: 'not_edible', message: 'Eso no se puede comer.' }, 400);
  }

  // HP actual y máximo. Sesión 49 — last_eat_at para el cooldown OSRS
  // (1 comida / 1.8s). Lectura defensiva: si la columna no existe aún
  // (migración pendiente), caemos al SELECT base y no se aplica el
  // cooldown server-side (el cliente lo aplica igual).
  const now = Date.now();
  let stats = null;
  let hasEatCol = true;
  try {
    stats = await env.DB.prepare(
      'SELECT hp_current, hp_xp, last_eat_at FROM combat_stats WHERE user_id = ?'
    ).bind(userId).first();
  } catch {
    hasEatCol = false;
    stats = await env.DB.prepare(
      'SELECT hp_current, hp_xp FROM combat_stats WHERE user_id = ?'
    ).bind(userId).first();
  }
  if (!stats) return json({ error: 'no_stats' }, 400);
  if (stats.hp_current <= 0) {
    return json({ error: 'user_dead', message: 'Estás muerto. Respawnea primero.' }, 400);
  }
  if (hasEatCol && stats.last_eat_at && (now - stats.last_eat_at) < EAT_COOLDOWN_MS) {
    return json({
      error: 'eat_cooldown',
      remaining_ms: EAT_COOLDOWN_MS - (now - stats.last_eat_at),
    }, 400);
  }
  const hpMax = xpToLevel(stats.hp_xp);
  if (stats.hp_current >= hpMax) {
    return json({ error: 'hp_full', message: 'Ya tienes la vida llena.' }, 400);
  }

  const healed = Math.min(food.heal, hpMax - stats.hp_current);
  const hpAfter = stats.hp_current + healed;

  // Consumir 1 del slot
  if (invRow.quantity > 1) {
    await env.DB.prepare(
      'UPDATE user_inventory SET quantity = quantity - 1 WHERE user_id = ? AND slot_index = ?'
    ).bind(userId, slot).run();
  } else {
    await env.DB.prepare(
      'DELETE FROM user_inventory WHERE user_id = ? AND slot_index = ?'
    ).bind(userId, slot).run();
  }

  // Curar (+ sellar last_eat_at si la columna existe)
  if (hasEatCol) {
    try {
      await env.DB.prepare(
        'UPDATE combat_stats SET hp_current = ?, last_eat_at = ? WHERE user_id = ?'
      ).bind(hpAfter, now, userId).run();
    } catch {
      await env.DB.prepare(
        'UPDATE combat_stats SET hp_current = ? WHERE user_id = ?'
      ).bind(hpAfter, userId).run();
    }
  } else {
    await env.DB.prepare(
      'UPDATE combat_stats SET hp_current = ? WHERE user_id = ?'
    ).bind(hpAfter, userId).run();
  }

  return json({
    ok: true,
    item_id: invRow.item_id,
    healed,
    hp_current: hpAfter,
    hp_max: hpMax,
  });
}

// ============================================================
// POST /api/cooking/cook { slot }
// ============================================================
export async function handleCookingCook(request, env) {
  const session = await requireSession(request, env);
  if (!session) return json({ error: 'unauthorized' }, 401);
  const userId = session.user_id;

  if (!(await tableExists(env, 'fires'))) {
    return json({ error: 'cooking_disabled', message: 'Tabla fires no existe.' }, 503);
  }

  const body = await readJson(request);
  if (!body) return json({ error: 'bad_request' }, 400);
  const slot = Number(body.slot);
  if (!Number.isInteger(slot) || slot < 0 || slot > 27) {
    return json({ error: 'invalid_slot' }, 400);
  }

  // 1) Item del slot — debe ser crudo cocinable
  const invRow = await env.DB.prepare(
    'SELECT item_id, quantity FROM user_inventory WHERE user_id = ? AND slot_index = ?'
  ).bind(userId, slot).first();
  if (!invRow) return json({ error: 'empty_slot' }, 400);

  const def = COOKABLE_DEFS[invRow.item_id];
  if (!def) {
    return json({ error: 'not_cookable', message: 'Eso no se puede cocinar.' }, 400);
  }

  // 2) Posición del player (heartbeat, igual que firemaking)
  const meRow = await env.DB.prepare(
    'SELECT x, z FROM online_users WHERE user_id = ?'
  ).bind(userId).first();
  if (!meRow) return json({ error: 'no_position' }, 400);

  // 3) Fuego encendido a <2.5m (bbox + distancia exacta)
  const now = Date.now();
  const R = FIRE_COOK_RADIUS_M;
  const fireRow = await env.DB.prepare(
    `SELECT id, x, z FROM fires
     WHERE expires_at > ?
       AND x BETWEEN ? AND ? AND z BETWEEN ? AND ?`
  ).bind(now, meRow.x - R, meRow.x + R, meRow.z - R, meRow.z + R).first();

  let nearFire = false;
  if (fireRow) {
    const dx = fireRow.x - meRow.x;
    const dz = fireRow.z - meRow.z;
    nearFire = (dx * dx + dz * dz) <= R * R;
  }
  if (!nearFire) {
    return json({ error: 'no_fire', message: 'Necesitas estar junto a un fuego encendido.' }, 400);
  }

  // 4) Nivel de cocina
  const skillRow = await env.DB.prepare(
    'SELECT xp FROM user_skills WHERE user_id = ? AND skill_id = ?'
  ).bind(userId, SKILL_ID).first();
  const currentXp = skillRow ? skillRow.xp : startingXpFor(SKILL_ID);
  const currentLevel = xpToLevel(currentXp);
  if (currentLevel < def.cookLevel) {
    return json({
      error: 'cooking_level_too_low',
      required: def.cookLevel,
      message: `Necesitas nivel ${def.cookLevel} de Cocina.`,
    }, 400);
  }

  // 5) Roll de quemado
  const chance = burnChance(currentLevel, def.cookLevel);
  const burnt = Math.random() < chance;
  const resultItemId = burnt ? def.burnt : def.cooked;

  // 6) Consumir el crudo y entregar el resultado.
  //    qty=1 (no stackable): convertir el slot in-place — simple y atómico.
  //    qty>1 (defensivo): decrementar + insertar el resultado en slot libre.
  if (invRow.quantity > 1) {
    const used = await env.DB.prepare(
      'SELECT slot_index FROM user_inventory WHERE user_id = ?'
    ).bind(userId).all();
    const occupied = new Set((used?.results || []).map(r => r.slot_index));
    let free = -1;
    for (let i = 0; i < MAX_INV_SLOTS; i++) {
      if (!occupied.has(i)) { free = i; break; }
    }
    if (free === -1) {
      return json({ error: 'inventory_full', message: 'Inventario lleno.' }, 400);
    }
    await env.DB.prepare(
      'UPDATE user_inventory SET quantity = quantity - 1 WHERE user_id = ? AND slot_index = ?'
    ).bind(userId, slot).run();
    await env.DB.prepare(
      'INSERT INTO user_inventory (user_id, slot_index, item_id, quantity) VALUES (?, ?, ?, 1)'
    ).bind(userId, free, resultItemId).run();
  } else {
    await env.DB.prepare(
      'UPDATE user_inventory SET item_id = ? WHERE user_id = ? AND slot_index = ?'
    ).bind(resultItemId, userId, slot).run();
  }

  // 7) XP solo si NO se quemó (OSRS-style)
  let xpGained = 0;
  let newLevel = currentLevel;
  let levelUp = false;
  if (!burnt) {
    const xpResult = applyXpGrant(currentXp, def.xp);
    xpGained = def.xp;
    newLevel = xpResult.newLevel;
    levelUp = xpResult.levelUp;
    if (skillRow) {
      await env.DB.prepare(
        'UPDATE user_skills SET xp = ?, updated_at = ? WHERE user_id = ? AND skill_id = ?'
      ).bind(xpResult.newXp, now, userId, SKILL_ID).run();
    } else {
      await env.DB.prepare(
        'INSERT INTO user_skills (user_id, skill_id, xp, updated_at) VALUES (?, ?, ?, ?)'
      ).bind(userId, SKILL_ID, xpResult.newXp, now).run();
    }
  }

  return json({
    ok: true,
    result: burnt ? 'burnt' : 'cooked',
    item_id: resultItemId,
    raw_item_id: invRow.item_id,
    xp_gained: xpGained,
    level: newLevel,
    level_up: levelUp,
    burn_chance: Math.round(chance * 100),
  });
}
