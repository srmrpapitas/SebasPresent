/**
 * SebasPresent — Ground Items handlers (Slice 5c)
 * Endpoints: GET /api/ground_items, POST /api/ground_items/pickup
 *
 * El drop de loot al matar NPC lo hace combat_engine.rollAndDropLoot().
 * Estos handlers solo gestionan la lista y el pickup.
 *
 * Modelo:
 *   - Items con privacidad 60s (solo el killer los ve y recoge).
 *   - Después se vuelven públicos otros 60s. Total 120s antes de despawn.
 *   - El cron cada 1 min limpia los expirados.
 */

import { json, makeDbAdapter } from '../lib/db.js';
import { requireSession } from '../lib/auth.js';
import {
  loadInventoryState, tryDepositToInventory,
} from '../ge_engine.js';

const LOOT_PRIVATE_MS      = 60_000;
const LOOT_LIST_RADIUS_M   = 30;
const LOOT_PICKUP_RADIUS_M = 5;

export async function handleGroundItemsList(request, env) {
  const session = await requireSession(request, env);
  if (!session) return json({ error: 'unauthorized' }, 401);
  const userId = session.user_id;

  const url = new URL(request.url);
  const x = parseFloat(url.searchParams.get('x'));
  const z = parseFloat(url.searchParams.get('z'));
  if (!Number.isFinite(x) || !Number.isFinite(z)) {
    return json({ error: 'invalid_position' }, 400);
  }

  const now = Date.now();
  const R = LOOT_LIST_RADIUS_M;
  const xMin = x - R, xMax = x + R, zMin = z - R, zMax = z + R;
  const privacyCutoff = now - LOOT_PRIVATE_MS;

  try {
    // bbox prefilter + privacidad: o ya pasó el periodo privado, o soy
    // el killer. Filtramos por distancia exacta después en JS.
    const res = await env.DB.prepare(
      `SELECT g.id, g.item_id, g.qty, g.x, g.z, g.dropped_at, g.dropped_by_user, g.despawn_at,
              i.name, i.icon, i.stackable, i.base_price
       FROM ground_items g
       LEFT JOIN items i ON i.id = g.item_id
       WHERE g.despawn_at > ?
         AND g.x BETWEEN ? AND ?
         AND g.z BETWEEN ? AND ?
         AND (g.dropped_at <= ? OR g.dropped_by_user = ?)
       ORDER BY g.dropped_at DESC`
    ).bind(now, xMin, xMax, zMin, zMax, privacyCutoff, userId).all();

    const rows = res?.results || [];
    const r2 = R * R;
    const items = [];
    for (const row of rows) {
      const dx = row.x - x;
      const dz = row.z - z;
      if (dx * dx + dz * dz > r2) continue;
      const isPrivate = (row.dropped_at + LOOT_PRIVATE_MS) > now;
      items.push({
        id: row.id,
        item_id: row.item_id,
        name: row.name,
        icon: row.icon,
        stackable: row.stackable === 1 ? 1 : 0,
        base_price: row.base_price | 0,
        qty: row.qty,
        x: row.x,
        z: row.z,
        dropped_at: row.dropped_at,
        despawn_at: row.despawn_at,
        is_private: isPrivate ? 1 : 0,
        mine: row.dropped_by_user === userId ? 1 : 0,
      });
    }
    return json({ items, now });
  } catch (err) {
    console.error('[ground_items/list]', err);
    return json({ error: 'internal_error', message: err.message }, 500);
  }
}

export async function handleGroundItemsPickup(request, env) {
  const session = await requireSession(request, env);
  if (!session) return json({ error: 'unauthorized' }, 401);
  const userId = session.user_id;

  let body;
  try { body = await request.json(); } catch { return json({ error: 'invalid_body' }, 400); }

  const rawIds = Array.isArray(body?.ids) ? body.ids : [];
  const ids = [];
  const seen = new Set();
  for (const v of rawIds) {
    const n = parseInt(v, 10);
    if (Number.isFinite(n) && n > 0 && !seen.has(n)) {
      seen.add(n);
      ids.push(n);
    }
  }
  if (ids.length === 0) return json({ error: 'no_ids' }, 400);
  // Tope defensivo: pickup masivo no debería pasar de un pile entero (~10 items)
  if (ids.length > 64) return json({ error: 'too_many_ids' }, 400);

  const now = Date.now();
  const db = makeDbAdapter(env);

  try {
    // Posición del player
    const userRow = await db.first(
      'SELECT last_x, last_z FROM users WHERE id = ?',
      [userId]
    );
    if (!userRow) return json({ error: 'user_not_found' }, 404);
    const userX = userRow.last_x ?? 0;
    const userZ = userRow.last_z ?? 0;

    // Cargar las filas pedidas
    const ph = ids.map(() => '?').join(',');
    const groundRows = await db.all(
      `SELECT g.id, g.item_id, g.qty, g.x, g.z, g.dropped_at, g.dropped_by_user, g.despawn_at,
              i.stackable
       FROM ground_items g LEFT JOIN items i ON i.id = g.item_id
       WHERE g.id IN (${ph})`,
      ids
    );

    // Cargar inventario una vez. Mutamos en memoria, persistimos
    // los stmts al final con batch.
    const invState = await loadInventoryState(db, userId);
    const stmts = [];

    const pickedUp = [];
    const skipped = [];

    for (const g of groundRows) {
      if (!g) continue;

      if (g.despawn_at <= now) {
        skipped.push({ id: g.id, reason: 'expired' });
        continue;
      }
      const isPrivate = (g.dropped_at + LOOT_PRIVATE_MS) > now;
      if (isPrivate && g.dropped_by_user !== userId) {
        skipped.push({ id: g.id, reason: 'private' });
        continue;
      }
      const dx = g.x - userX, dz = g.z - userZ;
      if (dx * dx + dz * dz > LOOT_PICKUP_RADIUS_M * LOOT_PICKUP_RADIUS_M) {
        skipped.push({ id: g.id, reason: 'too_far' });
        continue;
      }

      const stackable = g.stackable === 1;
      const ok = tryDepositToInventory(stmts, invState, userId, g.item_id, g.qty, stackable, now);
      if (!ok) {
        skipped.push({ id: g.id, reason: 'inventory_full' });
        continue;
      }
      stmts.push({
        sql: 'DELETE FROM ground_items WHERE id = ?',
        params: [g.id],
      });
      pickedUp.push({ id: g.id, item_id: g.item_id, qty: g.qty });
    }

    if (stmts.length > 0) {
      await db.batch(stmts);
    }

    return json({
      picked_up: pickedUp,
      skipped,
      picked_count: pickedUp.length,
    });
  } catch (err) {
    console.error('[ground_items/pickup]', err);
    return json({ error: 'internal_error', message: err.message }, 500);
  }
}
