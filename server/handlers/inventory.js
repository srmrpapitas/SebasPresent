/**
 * SebasPresent — Inventory handlers (Slice 4a + Sesión 22)
 * Endpoints: GET /api/inventory, POST /api/inventory/swap
 *
 * Sesión 22: el GET ahora también devuelve `equip_slot` de cada item para
 * que el cliente sepa qué items son equipables.
 */

import { json, readJson } from '../lib/db.js';
import { requireSession } from '../lib/auth.js';
import { guardConds, slotCond, atomicBatch, changed } from '../lib/atomic.js';   // Sesión 51

export const INVENTORY_SLOTS = 20;

export async function handleGetInventory(request, env) {
  const session = await requireSession(request, env);
  if (!session) return json({ error: 'unauthorized' }, 401);

  const result = await env.DB.prepare(
    `SELECT inv.slot_index AS slot, inv.item_id, inv.quantity,
            i.name, i.icon, i.stackable, i.equip_slot, i.weapon_type
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
    weapon_type: r.weapon_type || null, // S33 — failsafe para "Equipar" en cliente
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
  const uid = session.user_id;
  // Sesión 50 — seguridad: los movimientos se hacen con UPDATE de slot
  // (nunca borrar + volver a crear con valores leídos antes). Así dos
  // peticiones a la vez no pueden duplicar nada: como mucho una no hace nada.
  try {
    if (!slotB) {
      await env.DB.prepare(
        `UPDATE user_inventory SET slot_index = ?, updated_at = ?
          WHERE user_id = ? AND slot_index = ? AND item_id = ?`
      ).bind(to, now, uid, from, slotA.item_id).run();
      return json({ ok: true });
    }

    if (slotA.item_id === slotB.item_id && slotA.stackable === 1) {
      // Sesión 51 — guarda: si el destino cambió a la vez, antes se borraba
      // el origen igualmente y se perdía la pila.
      const ok = await atomicBatch(env, [
        guardConds(env, [slotCond(uid, from, slotA.item_id), slotCond(uid, to, slotA.item_id)]),
        env.DB.prepare(
          `UPDATE user_inventory
              SET quantity = quantity + COALESCE((SELECT quantity FROM user_inventory
                                                   WHERE user_id = ? AND slot_index = ? AND item_id = ?), 0),
                  updated_at = ?
            WHERE user_id = ? AND slot_index = ? AND item_id = ?`
        ).bind(uid, from, slotA.item_id, now, uid, to, slotA.item_id),
        env.DB.prepare(
          'DELETE FROM user_inventory WHERE user_id = ? AND slot_index = ? AND item_id = ?'
        ).bind(uid, from, slotA.item_id),
      ]);
      return ok ? json({ ok: true }) : changed();
    }

    const tmp = -1 - from;
    await env.DB.batch([
      env.DB.prepare('UPDATE user_inventory SET slot_index = ? WHERE user_id = ? AND slot_index = ?').bind(tmp, uid, from),
      env.DB.prepare('UPDATE user_inventory SET slot_index = ?, updated_at = ? WHERE user_id = ? AND slot_index = ?').bind(from, now, uid, to),
      env.DB.prepare('UPDATE user_inventory SET slot_index = ?, updated_at = ? WHERE user_id = ? AND slot_index = ?').bind(to, now, uid, tmp),
    ]);
  } catch (e) {
    // Conflicto por otra petición simultánea: no se ha cambiado nada.
    return json({ error: 'busy', message: 'Inténtalo otra vez.' }, 409);
  }
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
