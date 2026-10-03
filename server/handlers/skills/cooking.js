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
import { questEvent } from '../../lib/quests.js';   // Sesión 50
import { EDIBLE, COOKABLE } from '../../../client/src/shared/food.js';
import { pushRealtime } from '../../lib/realtime.js';   // Sesión 50
import { guardSlot, atomicBatch, changed } from '../../lib/atomic.js';   // Sesión 51

const SKILL_ID = 'cooking';
const FIRE_COOK_RADIUS_M = 5.0;   // Sesión 49 — subido de 2.5 (ver fix abajo)
const MAX_INV_SLOTS = 20;
// Sesión 49 — cooldown de comida estilo OSRS: 1 pieza cada 2 ticks (1.8s).
const EAT_COOLDOWN_MS = 1800;

// Sesión 50 — tablas movidas a client/src/shared/food.js (compartidas con el
// cliente e incluyen los peces). burnt_* NO son comestibles.
const EDIBLE_DEFS = EDIBLE;
const COOKABLE_DEFS = COOKABLE;

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

  // Consumir 1 del slot — Sesión 51: SOLO si sigue ahí la misma comida
  // (antes, comer + mover a la vez curaba sin gastar la comida).
  const consumed = invRow.quantity > 1
    ? await env.DB.prepare(
        'UPDATE user_inventory SET quantity = quantity - 1 WHERE user_id = ? AND slot_index = ? AND item_id = ? AND quantity > 1'
      ).bind(userId, slot, invRow.item_id).run()
    : await env.DB.prepare(
        'DELETE FROM user_inventory WHERE user_id = ? AND slot_index = ? AND item_id = ? AND quantity = 1'
      ).bind(userId, slot, invRow.item_id).run();
  if (!consumed?.meta?.changes) return changed();

  // Curar (+ sellar last_eat_at si la columna existe)
  // Sesión 51 — curación RELATIVA (dos comidas a la vez curan las dos) y
  // nunca por encima del máximo ni resucitando a un muerto.
  if (hasEatCol) {
    try {
      await env.DB.prepare(
        'UPDATE combat_stats SET hp_current = MIN(hp_current + ?, ?), last_eat_at = ? WHERE user_id = ? AND hp_current > 0'
      ).bind(healed, hpMax, now, userId).run();
    } catch {
      await env.DB.prepare(
        'UPDATE combat_stats SET hp_current = MIN(hp_current + ?, ?) WHERE user_id = ? AND hp_current > 0'
      ).bind(healed, hpMax, userId).run();
    }
  } else {
    await env.DB.prepare(
      'UPDATE combat_stats SET hp_current = MIN(hp_current + ?, ?) WHERE user_id = ? AND hp_current > 0'
    ).bind(healed, hpMax, userId).run();
  }

  // Sesión 50 — los demás ven la cura al instante (y su barra de vida)
  await pushRealtime(env, { t: 'hp', id: userId, hp: hpAfter, hpMax, eat: invRow.item_id });

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

  // 3) Fuego encendido cercano. Sesión 49 fix — radio 5m (antes 2.5m era
  //    demasiado justo: el fuego se coloca 1.2m delante al encenderlo y la
  //    pos del server (online_users, heartbeat) va con algo de lag → "estás
  //    al lado" pero salía no_fire). Buscamos el MÁS CERCANO sin bbox y
  //    medimos distancia exacta; si está fuera, el error la incluye para
  //    diagnóstico.
  const now = Date.now();
  if (meRow.x == null || meRow.z == null) {
    return json({ error: 'no_position', message: 'Posición no disponible.' }, 400);
  }
  const fires = await env.DB.prepare(
    'SELECT id, x, z FROM fires WHERE expires_at > ?'
  ).bind(now).all();
  const fireRows = fires?.results || [];

  let nearest = null;
  let nearestDist = Infinity;
  for (const f of fireRows) {
    const dx = f.x - meRow.x;
    const dz = f.z - meRow.z;
    const d = Math.sqrt(dx * dx + dz * dz);
    if (d < nearestDist) { nearestDist = d; nearest = f; }
  }

  if (!nearest || nearestDist > FIRE_COOK_RADIUS_M) {
    return json({
      error: 'no_fire',
      message: fireRows.length === 0
        ? 'No hay ningún fuego encendido. Enciende uno con un log + yesquero.'
        : `Acércate más al fuego (estás a ${nearestDist === Infinity ? '∞' : nearestDist.toFixed(1)}m, necesitas ${FIRE_COOK_RADIUS_M}m).`,
      nearest_fire_dist_m: nearestDist === Infinity ? null : Number(nearestDist.toFixed(2)),
      fires_lit: fireRows.length,
    }, 400);
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
    // Sesión 51 — atómico: guarda (el crudo sigue igual) + restar + poner el resultado
    const ok = await atomicBatch(env, [
      guardSlot(env, userId, slot, invRow.item_id, invRow.quantity),
      env.DB.prepare(
        'UPDATE user_inventory SET quantity = quantity - 1 WHERE user_id = ? AND slot_index = ? AND item_id = ?'
      ).bind(userId, slot, invRow.item_id),
      env.DB.prepare(
        'INSERT INTO user_inventory (user_id, slot_index, item_id, quantity) VALUES (?, ?, ?, 1)'
      ).bind(userId, free, resultItemId),
    ]);
    if (!ok) return changed();
  } else {
    // Sesión 51 — SOLO si en el slot sigue el mismo crudo (antes, cocinar +
    // mover a la vez convertía lo que hubiera en el slot: 1M monedas → 1M pollos)
    const r = await env.DB.prepare(
      'UPDATE user_inventory SET item_id = ? WHERE user_id = ? AND slot_index = ? AND item_id = ? AND quantity = 1'
    ).bind(resultItemId, userId, slot, invRow.item_id).run();
    if (!r?.meta?.changes) return changed();
  }

  // 7) XP solo si NO se quemó (OSRS-style)
  let xpGained = 0;
  let newLevel = currentLevel;
  let levelUp = false;
  if (!burnt) await questEvent(env, userId, 'cook', resultItemId);   // Sesión 50 — misiones
  if (!burnt) {
    const xpResult = applyXpGrant(currentXp, def.xp);
    xpGained = def.xp;
    newLevel = xpResult.newLevel;
    levelUp = xpResult.levelUp;
    if (skillRow) {
      // Sesión 51 — relativa: dos cocinados a la vez suman los dos
      await env.DB.prepare(
        'UPDATE user_skills SET xp = MIN(xp + ?, 200000000), updated_at = ? WHERE user_id = ? AND skill_id = ?'
      ).bind(def.xp, now, userId, SKILL_ID).run();
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
