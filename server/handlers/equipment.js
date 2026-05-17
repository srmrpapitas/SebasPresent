/**
 * SebasPresent — Equipment handlers (Sesión 22)
 *
 * Endpoints:
 *   GET  /api/equipment
 *     Devuelve { slots: { weapon: {...}, shield: {...}, ... } } con los items
 *     equipados por slot. Si un slot está vacío, NO aparece.
 *
 *   POST /api/equipment/equip { slot_index }
 *     Coge el item del slot_index del inventario y lo equipa en el slot
 *     correspondiente a item.equip_slot. Si ese slot ya tenía algo, lo
 *     deja en el slot del inventario donde estaba el item nuevo (swap).
 *     Si el slot del item no permite equipar (equip_slot = NULL), error.
 *
 *   POST /api/equipment/unequip { slot_id }
 *     Devuelve el item al primer slot libre del inventario. Si no hay
 *     slots libres, error.
 *
 * Tablas usadas:
 *   user_equipment (user_id, slot_id, item_id, equipped_at)
 *   items (id, name, icon, equip_slot, weapon_type, attack_bonus, defence_bonus, ...)
 *   user_inventory (user_id, slot_index, item_id, quantity, updated_at)
 *
 * Slots válidos (mismos que OSRS):
 *   weapon, shield, helm, body, legs, boots, cape, amulet, ring
 *
 * Single-item por slot (no stackable en equipment).
 */

import { json, readJson } from '../lib/db.js';
import { requireSession } from '../lib/auth.js';

const INVENTORY_SLOTS = 28;
const VALID_EQUIP_SLOTS = ['weapon', 'shield', 'helm', 'body', 'legs', 'boots', 'cape', 'amulet', 'ring'];

// ============================================================
// GET /api/equipment
// ============================================================
export async function handleGetEquipment(request, env) {
  const session = await requireSession(request, env);
  if (!session) return json({ error: 'unauthorized' }, 401);

  const result = await env.DB.prepare(
    `SELECT eq.slot_id, eq.item_id, eq.equipped_at,
            i.name, i.icon, i.equip_slot, i.weapon_type,
            i.attack_bonus, i.defence_bonus, i.description
     FROM user_equipment eq
     JOIN items i ON i.id = eq.item_id
     WHERE eq.user_id = ?`
  ).bind(session.user_id).all();

  const slots = {};
  for (const r of (result.results || [])) {
    slots[r.slot_id] = {
      item_id: r.item_id,
      name: r.name,
      icon: r.icon,
      equip_slot: r.equip_slot,
      weapon_type: r.weapon_type,
      attack_bonus: r.attack_bonus | 0,
      defence_bonus: r.defence_bonus | 0,
      description: r.description,
      equipped_at: r.equipped_at,
    };
  }
  return json({ slots });
}

// ============================================================
// POST /api/equipment/equip { slot_index }
// ============================================================
export async function handleEquip(request, env) {
  const session = await requireSession(request, env);
  if (!session) return json({ error: 'unauthorized' }, 401);

  const body = await readJson(request);
  if (!body || !Number.isInteger(body.slot_index)) {
    return json({ error: 'bad_request', message: 'slot_index requerido' }, 400);
  }
  const slotIndex = body.slot_index;
  if (slotIndex < 0 || slotIndex >= INVENTORY_SLOTS) {
    return json({ error: 'invalid_slot' }, 400);
  }

  // 1. Leer item del inventario en ese slot
  const invItem = await env.DB.prepare(
    `SELECT inv.item_id, inv.quantity, i.equip_slot, i.name
     FROM user_inventory inv
     JOIN items i ON i.id = inv.item_id
     WHERE inv.user_id = ? AND inv.slot_index = ?`
  ).bind(session.user_id, slotIndex).first();

  if (!invItem) return json({ error: 'slot_empty' }, 400);
  if (!invItem.equip_slot) {
    return json({ error: 'not_equipable', message: 'Este item no se puede equipar' }, 400);
  }
  if (!VALID_EQUIP_SLOTS.includes(invItem.equip_slot)) {
    return json({ error: 'invalid_equip_slot' }, 500);
  }

  const targetSlot = invItem.equip_slot;
  const now = Date.now();

  // 2. ¿Hay algo equipado en el target slot? Si sí, lo desequipamos al inventario.
  const equippedItem = await env.DB.prepare(
    `SELECT item_id FROM user_equipment WHERE user_id = ? AND slot_id = ?`
  ).bind(session.user_id, targetSlot).first();

  // 3. Operaciones atómicas (batch)
  const ops = [];

  // Quitar item del inventario en slotIndex
  ops.push(env.DB.prepare(
    `DELETE FROM user_inventory WHERE user_id = ? AND slot_index = ?`
  ).bind(session.user_id, slotIndex));

  // Si había algo equipado, ponerlo en el slot del inventario que acabamos de vaciar
  if (equippedItem) {
    ops.push(env.DB.prepare(
      `INSERT INTO user_inventory (user_id, slot_index, item_id, quantity, updated_at)
       VALUES (?, ?, ?, 1, ?)`
    ).bind(session.user_id, slotIndex, equippedItem.item_id, now));
  }

  // Upsert el item nuevo en user_equipment
  ops.push(env.DB.prepare(
    `INSERT INTO user_equipment (user_id, slot_id, item_id, equipped_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id, slot_id) DO UPDATE SET
       item_id = excluded.item_id,
       equipped_at = excluded.equipped_at`
  ).bind(session.user_id, targetSlot, invItem.item_id, now));

  await env.DB.batch(ops);

  return json({
    ok: true,
    equipped: { slot_id: targetSlot, item_id: invItem.item_id },
    swapped_back: equippedItem ? { slot_index: slotIndex, item_id: equippedItem.item_id } : null,
  });
}

// ============================================================
// POST /api/equipment/unequip { slot_id }
// ============================================================
export async function handleUnequip(request, env) {
  const session = await requireSession(request, env);
  if (!session) return json({ error: 'unauthorized' }, 401);

  const body = await readJson(request);
  if (!body || typeof body.slot_id !== 'string') {
    return json({ error: 'bad_request', message: 'slot_id requerido' }, 400);
  }
  const slotId = body.slot_id;
  if (!VALID_EQUIP_SLOTS.includes(slotId)) {
    return json({ error: 'invalid_slot_id' }, 400);
  }

  // 1. ¿Tiene algo equipado en ese slot?
  const equipped = await env.DB.prepare(
    `SELECT item_id FROM user_equipment WHERE user_id = ? AND slot_id = ?`
  ).bind(session.user_id, slotId).first();
  if (!equipped) return json({ error: 'slot_empty' }, 400);

  // 2. Buscar primer slot libre del inventario
  const occupied = await env.DB.prepare(
    `SELECT slot_index FROM user_inventory WHERE user_id = ?`
  ).bind(session.user_id).all();
  const taken = new Set((occupied.results || []).map(r => r.slot_index));

  let freeSlot = null;
  for (let i = 0; i < INVENTORY_SLOTS; i++) {
    if (!taken.has(i)) { freeSlot = i; break; }
  }
  if (freeSlot === null) {
    return json({ error: 'inventory_full', message: 'Mochila llena' }, 400);
  }

  const now = Date.now();

  // 3. Batch: borrar del equipment, insertar al inventario
  await env.DB.batch([
    env.DB.prepare(
      `DELETE FROM user_equipment WHERE user_id = ? AND slot_id = ?`
    ).bind(session.user_id, slotId),
    env.DB.prepare(
      `INSERT INTO user_inventory (user_id, slot_index, item_id, quantity, updated_at)
       VALUES (?, ?, ?, 1, ?)`
    ).bind(session.user_id, freeSlot, equipped.item_id, now),
  ]);

  return json({
    ok: true,
    unequipped: { slot_id: slotId, item_id: equipped.item_id, to_inventory_slot: freeSlot },
  });
}
