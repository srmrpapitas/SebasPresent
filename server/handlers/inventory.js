/**
 * SebasPresent — Inventory handlers (Slice 4a + Sesión 22)
 * Endpoints: GET /api/inventory, POST /api/inventory/swap
 *
 * Sesión 22: el GET ahora también devuelve `equip_slot` de cada item para
 * que el cliente sepa qué items son equipables.
 */

import { json, readJson } from '../lib/db.js';
import { requireSession } from '../lib/auth.js';

export const INVENTORY_SLOTS = 28;

export async function handleGetInventory(request, env) {
  const session = await requireSession(request, env);
  if (!session) return json({ error: 'unauthorized' }, 401);

  const result = await env.DB.prepare(
    `SELECT inv.slot_index AS slot, inv.item_id, inv.quantity,
            i.name, i.icon, i.stackable, i.equip_slot
     FROM user_inventory inv
     JOIN items i ON i.id = inv.item_id
     WHERE inv.user_id = ?
     ORDER BY inv.slot_index ASC`
  ).bind(session.user_id).all();

  const rows = (result.results || []).map(r => ({
    slot: r.slot,
    item_id: r.item_id,
    quantity: r.quantity,
    name: r.name,
    icon: r.icon,
    stackable: r.stackable === 1,
    equip_slot: r.equip_slot || null,   // sesión 22: null si no es equipable
  }));

  return json({ slots: rows });
}

export async function handleSwapInventory(request, env) {
  const session = await requireSession(request, env);
  if (!session) return json({ error: 'unauthorized' }, 401);

  const body = await readJson(request);
  if (!body) return json({ error: 'bad_request' }, 400);

  const from = body.from;
  const to = body.to;

  if (!Number.isInteger(from) || !Number.isInteger(to)) {
    return json({ error: 'invalid_slots', message: 'from y to deben ser enteros.' }, 400);
  }
  if (from < 0 || from >= INVENTORY_SLOTS || to < 0 || to >= INVENTORY_SLOTS) {
    return json({ error: 'invalid_slots', message: `Slots fuera de rango (0-${INVENTORY_SLOTS - 1}).` }, 400);
  }
  if (from === to) return json({ ok: true });

  const slotA = await env.DB.prepare(
    `SELECT inv.item_id, inv.quantity, i.stackable
     FROM user_inventory inv
     JOIN items i ON i.id = inv.item_id
     WHERE inv.user_id = ? AND inv.slot_index = ?`
  ).bind(session.user_id, from).first();

  if (!slotA) return json({ ok: true });

  const slotB = await env.DB.prepare(
    `SELECT item_id, quantity FROM user_inventory
     WHERE user_id = ? AND slot_index = ?`
  ).bind(session.user_id, to).first();

  const now = Date.now();

  if (!slotB) {
    await env.DB.batch([
      env.DB.prepare(
        'INSERT INTO user_inventory (user_id, slot_index, item_id, quantity, updated_at) VALUES (?, ?, ?, ?, ?)'
      ).bind(session.user_id, to, slotA.item_id, slotA.quantity, now),
      env.DB.prepare(
        'DELETE FROM user_inventory WHERE user_id = ? AND slot_index = ?'
      ).bind(session.user_id, from),
    ]);
    return json({ ok: true });
  }

  if (slotA.item_id === slotB.item_id && slotA.stackable === 1) {
    const merged = slotA.quantity + slotB.quantity;
    await env.DB.batch([
      env.DB.prepare(
        'UPDATE user_inventory SET quantity = ?, updated_at = ? WHERE user_id = ? AND slot_index = ?'
      ).bind(merged, now, session.user_id, to),
      env.DB.prepare(
        'DELETE FROM user_inventory WHERE user_id = ? AND slot_index = ?'
      ).bind(session.user_id, from),
    ]);
    return json({ ok: true });
  }

  await env.DB.batch([
    env.DB.prepare(
      'DELETE FROM user_inventory WHERE user_id = ? AND slot_index IN (?, ?)'
    ).bind(session.user_id, from, to),
    env.DB.prepare(
      'INSERT INTO user_inventory (user_id, slot_index, item_id, quantity, updated_at) VALUES (?, ?, ?, ?, ?)'
    ).bind(session.user_id, to, slotA.item_id, slotA.quantity, now),
    env.DB.prepare(
      'INSERT INTO user_inventory (user_id, slot_index, item_id, quantity, updated_at) VALUES (?, ?, ?, ?, ?)'
    ).bind(session.user_id, from, slotB.item_id, slotB.quantity, now),
  ]);

  return json({ ok: true });
}

/**
 * Helper compartido (lo usa bank.js para encontrar slot vacío al
 * retirar). Si `target` está disponible, lo devuelve. Si no, el primer
 * slot libre. `null` si no quedan slots.
 */
export function pickInvSlot(invMap, target) {
  if (target !== undefined && target !== null && !invMap.has(target)) {
    return target;
  }
  for (let i = 0; i < INVENTORY_SLOTS; i++) {
    if (!invMap.has(i)) return i;
  }
  return null;
}
