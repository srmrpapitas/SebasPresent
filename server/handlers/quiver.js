/**
 * SebasPresent — Quiver handlers (Sesión 34, Bloque 2)
 *
 * El quiver es un slot de equipment especial. Mientras está equipado,
 * almacena flechas dentro (state en `user_quiver`) en vez de ocupar slot
 * del inventario.
 *
 * ============================================================
 * Endpoints
 * ============================================================
 *
 *   GET  /api/quiver
 *     Retorna { equipped: bool, arrow_item_id: string|null, arrow_quantity: int }.
 *     Si el quiver NO está equipado, equipped=false y los otros campos null/0.
 *
 *   POST /api/quiver/deposit { slot_index?, quantity? }
 *     Mueve flechas del inventory al quiver equipado.
 *     - slot_index: índice del stack de flechas en inv. Opcional; si se
 *       omite, agarra el PRIMER stack de `arrow_*` (orden slot_index asc).
 *     - quantity: cuántas mover. Opcional; si se omite o es <= 0, mueve
 *       el stack ENTERO.
 *     Errores: 'no_quiver_equipped', 'no_arrow_at_slot', 'arrow_type_mismatch'
 *       (si el quiver tiene otro tipo de flecha ya).
 *
 *   POST /api/quiver/withdraw { quantity? }
 *     Mueve flechas del quiver al inventory.
 *     - quantity: cuántas retirar. Opcional; si se omite o es <= 0, retira todo.
 *     Si ya hay un stack del mismo tipo en inv, se suma ahí (no usa slot
 *     nuevo). Si no, ocupa el primer slot libre.
 *     Errores: 'no_quiver_equipped', 'quiver_empty', 'inventory_full'
 *       (no hay stack existente y no hay slot libre).
 *
 * ============================================================
 * Tablas
 * ============================================================
 *
 *   user_quiver (user_id PK, arrow_item_id TEXT, arrow_quantity INTEGER, updated_at)
 *   user_equipment, user_inventory, items
 *
 * El record en user_quiver se crea on-demand (deposit primero, equip-quiver
 * no lo crea). El INSERT usa OR REPLACE para tolerar primera vez.
 */

import { json, readJson } from '../lib/db.js';
import { requireSession } from '../lib/auth.js';

const INVENTORY_SLOTS = 20;

// ============================================================
// GET /api/quiver
// ============================================================
export async function handleGetQuiver(request, env) {
  const session = await requireSession(request, env);
  if (!session) return json({ error: 'unauthorized' }, 401);

  const equipped = await env.DB.prepare(
    `SELECT item_id FROM user_equipment WHERE user_id = ? AND slot_id = 'quiver'`
  ).bind(session.user_id).first();

  const state = await env.DB.prepare(
    `SELECT arrow_item_id, arrow_quantity FROM user_quiver WHERE user_id = ?`
  ).bind(session.user_id).first();

  return json({
    equipped: !!equipped,
    quiver_item_id: equipped ? equipped.item_id : null,
    arrow_item_id: state?.arrow_item_id || null,
    arrow_quantity: state?.arrow_quantity || 0,
  });
}

// ============================================================
// POST /api/quiver/deposit { slot_index?, quantity? }
// ============================================================
export async function handleDepositToQuiver(request, env) {
  const session = await requireSession(request, env);
  if (!session) return json({ error: 'unauthorized' }, 401);

  // 1) Validar que tiene quiver equipado
  const equipped = await env.DB.prepare(
    `SELECT item_id FROM user_equipment WHERE user_id = ? AND slot_id = 'quiver'`
  ).bind(session.user_id).first();
  if (!equipped) return json({ error: 'no_quiver_equipped' }, 400);

  const body = (await readJson(request)) || {};
  let requestedSlot = Number.isInteger(body.slot_index) ? body.slot_index : null;
  let qtyRequest = Number.isInteger(body.quantity) && body.quantity > 0 ? body.quantity : null;
  // null/undefined/0 → mover todo el stack

  // 2) Buscar el stack de flechas en el inv
  let invRow;
  if (requestedSlot !== null) {
    invRow = await env.DB.prepare(
      `SELECT slot_index, item_id, quantity
         FROM user_inventory
        WHERE user_id = ? AND slot_index = ?`
    ).bind(session.user_id, requestedSlot).first();
    if (!invRow || !invRow.item_id || !invRow.item_id.startsWith('arrow_')) {
      return json({ error: 'no_arrow_at_slot' }, 400);
    }
  } else {
    invRow = await env.DB.prepare(
      `SELECT slot_index, item_id, quantity
         FROM user_inventory
        WHERE user_id = ? AND item_id LIKE 'arrow_%' AND quantity > 0
        ORDER BY slot_index ASC LIMIT 1`
    ).bind(session.user_id).first();
    if (!invRow) return json({ error: 'no_arrow_at_slot', message: 'No hay flechas en inv' }, 400);
  }

  // 3) Si el quiver ya tiene flechas, deben ser del MISMO tipo
  const quiverState = await env.DB.prepare(
    `SELECT arrow_item_id, arrow_quantity FROM user_quiver WHERE user_id = ?`
  ).bind(session.user_id).first();

  if (quiverState && quiverState.arrow_item_id && quiverState.arrow_item_id !== invRow.item_id) {
    return json({
      error: 'arrow_type_mismatch',
      message: `El carcaj ya tiene ${quiverState.arrow_item_id}; sacá esas primero.`,
    }, 400);
  }

  // 4) Calcular qty a mover
  const moveQty = (qtyRequest === null || qtyRequest > invRow.quantity)
    ? invRow.quantity
    : qtyRequest;

  const newInvQty = invRow.quantity - moveQty;
  const newQuiverQty = (quiverState?.arrow_quantity || 0) + moveQty;
  const now = Date.now();

  // 5) Batch atómico
  const stmts = [];

  if (newInvQty === 0) {
    stmts.push(env.DB.prepare(
      `DELETE FROM user_inventory WHERE user_id = ? AND slot_index = ?`
    ).bind(session.user_id, invRow.slot_index));
  } else {
    stmts.push(env.DB.prepare(
      `UPDATE user_inventory SET quantity = ?, updated_at = ?
       WHERE user_id = ? AND slot_index = ?`
    ).bind(newInvQty, now, session.user_id, invRow.slot_index));
  }

  // INSERT OR REPLACE para tolerar tanto el caso "primera vez (no hay row)"
  // como el "ya hay row (deposit incremental)"
  stmts.push(env.DB.prepare(
    `INSERT INTO user_quiver (user_id, arrow_item_id, arrow_quantity, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       arrow_item_id = excluded.arrow_item_id,
       arrow_quantity = excluded.arrow_quantity,
       updated_at = excluded.updated_at`
  ).bind(session.user_id, invRow.item_id, newQuiverQty, now));

  await env.DB.batch(stmts);

  return json({
    ok: true,
    moved: moveQty,
    arrow_item_id: invRow.item_id,
    inv_remaining: newInvQty,
    quiver_total: newQuiverQty,
  });
}

// ============================================================
// POST /api/quiver/withdraw { quantity? }
// ============================================================
export async function handleWithdrawFromQuiver(request, env) {
  const session = await requireSession(request, env);
  if (!session) return json({ error: 'unauthorized' }, 401);

  // 1) Validar quiver equipado
  const equipped = await env.DB.prepare(
    `SELECT item_id FROM user_equipment WHERE user_id = ? AND slot_id = 'quiver'`
  ).bind(session.user_id).first();
  if (!equipped) return json({ error: 'no_quiver_equipped' }, 400);

  // 2) Validar quiver no vacío
  const q = await env.DB.prepare(
    `SELECT arrow_item_id, arrow_quantity FROM user_quiver WHERE user_id = ?`
  ).bind(session.user_id).first();
  if (!q || !q.arrow_item_id || q.arrow_quantity <= 0) {
    return json({ error: 'quiver_empty' }, 400);
  }

  const body = (await readJson(request)) || {};
  const qtyRequest = Number.isInteger(body.quantity) && body.quantity > 0 ? body.quantity : null;
  const moveQty = (qtyRequest === null || qtyRequest > q.arrow_quantity)
    ? q.arrow_quantity
    : qtyRequest;

  // 3) ¿Hay stack del mismo tipo en inv? Si sí, sumar; si no, primer slot libre
  const invRows = await env.DB.prepare(
    `SELECT slot_index, item_id, quantity FROM user_inventory WHERE user_id = ?`
  ).bind(session.user_id).all();
  const occupied = invRows.results || [];
  const existingStack = occupied.find(r => r.item_id === q.arrow_item_id);

  const now = Date.now();
  const stmts = [];

  if (existingStack) {
    stmts.push(env.DB.prepare(
      `UPDATE user_inventory SET quantity = quantity + ?, updated_at = ?
       WHERE user_id = ? AND slot_index = ?`
    ).bind(moveQty, now, session.user_id, existingStack.slot_index));
  } else {
    // Primer slot libre
    const taken = new Set(occupied.map(r => r.slot_index));
    let freeSlot = null;
    for (let i = 0; i < INVENTORY_SLOTS; i++) {
      if (!taken.has(i)) { freeSlot = i; break; }
    }
    if (freeSlot === null) {
      return json({ error: 'inventory_full', message: 'Mochila llena' }, 400);
    }
    stmts.push(env.DB.prepare(
      `INSERT INTO user_inventory (user_id, slot_index, item_id, quantity, updated_at)
       VALUES (?, ?, ?, ?, ?)`
    ).bind(session.user_id, freeSlot, q.arrow_item_id, moveQty, now));
  }

  const newQuiverQty = q.arrow_quantity - moveQty;
  if (newQuiverQty === 0) {
    stmts.push(env.DB.prepare(
      `UPDATE user_quiver SET arrow_item_id = NULL, arrow_quantity = 0, updated_at = ?
       WHERE user_id = ?`
    ).bind(now, session.user_id));
  } else {
    stmts.push(env.DB.prepare(
      `UPDATE user_quiver SET arrow_quantity = ?, updated_at = ?
       WHERE user_id = ?`
    ).bind(newQuiverQty, now, session.user_id));
  }

  await env.DB.batch(stmts);

  return json({
    ok: true,
    moved: moveQty,
    arrow_item_id: q.arrow_item_id,
    quiver_remaining: newQuiverQty,
  });
}
