/**
 * SebasPresent — Equipment handlers (Sesión 22 + Sesión 26 auto-desequip)
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
 *
 *     SESIÓN 26 — Auto-desequip 2H ↔ Shield:
 *       - Equipar 2H (weapon_type='2h_sword') con escudo equipado →
 *         el escudo se va al inventario automáticamente.
 *       - Equipar escudo con 2H equipada → la 2H se va al inventario.
 *       - Si la mochila no tiene slot libre para el item desplazado →
 *         error 'bag_full', el equip se cancela y NO se cambia nada.
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

const INVENTORY_SLOTS = 20;
// Sesión 34 — Agregado slot 'quiver' (Bloque 2). Container especial para
// flechas: las flechas se almacenan dentro del quiver mientras está
// equipado (user_quiver table), en lugar de ocupar slot del inv.
const VALID_EQUIP_SLOTS = ['weapon', 'shield', 'helm', 'body', 'legs', 'boots', 'gloves', 'cape', 'amulet', 'ring', 'quiver'];

// Sesión 35 — Tipos de arma que ocupan ambas manos. Equipar cualquiera de
// estos cuando hay escudo equipado fuerza al escudo al inv (y viceversa).
// Antes solo se chequeaba '2h_sword' literal, lo cual dejaba al `bow`
// fuera del conflict check: te dejaba equipar escudo encima del arco
// (bug visto en S35 smoke test del path ranged).
// Cuando agreguemos 'staff' (Bloque 2 días 8-11), va acá también.
const TWO_HANDED_WEAPON_TYPES = new Set(['2h_sword', 'bow']);

// ============================================================
// GET /api/equipment
// ============================================================
export async function handleGetEquipment(request, env) {
  const session = await requireSession(request, env);
  if (!session) return json({ error: 'unauthorized' }, 401);

  const result = await env.DB.prepare(
    `SELECT eq.slot_id, eq.item_id, eq.equipped_at,
            i.name, i.icon, i.equip_slot, i.weapon_type,
            i.attack_bonus, i.defence_bonus, i.ranged_bonus, i.description
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
      ranged_bonus: r.ranged_bonus | 0,
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

  // 1. Leer item del inventario en ese slot (incluyendo weapon_type para la lógica 2H)
  const invItem = await env.DB.prepare(
    `SELECT inv.item_id, inv.quantity, i.equip_slot, i.weapon_type, i.name
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

  // ============================================================
  // SESIÓN 26 — Detectar conflicto 2H ↔ Shield
  // ============================================================
  // Si lo que estoy equipando es una 2H, y tengo escudo equipado →
  //   conflictItem = el escudo, va al inventario.
  // Si lo que estoy equipando es un escudo, y tengo 2H equipada →
  //   conflictItem = el arma 2H, va al inventario.
  // Sesión 35 — Set TWO_HANDED_WEAPON_TYPES en vez de igualdad a '2h_sword'
  // para que `bow` (y futuros tipos) entren en el chequeo.
  const isEquipping2H = (targetSlot === 'weapon' && TWO_HANDED_WEAPON_TYPES.has(invItem.weapon_type));
  const isEquippingShield = (targetSlot === 'shield');

  let conflictItem = null;   // { slot_id, item_id } del item a desequipar por conflicto
  if (isEquipping2H) {
    const sh = await env.DB.prepare(
      `SELECT item_id FROM user_equipment WHERE user_id = ? AND slot_id = 'shield'`
    ).bind(session.user_id).first();
    if (sh) conflictItem = { slot_id: 'shield', item_id: sh.item_id };
  } else if (isEquippingShield) {
    // Sesión 35 — Antes filtraba por `i.weapon_type = '2h_sword'`. Ahora
    // usa IN (...) construido desde TWO_HANDED_WEAPON_TYPES para detectar
    // también `bow` (y cualquier 2H futuro registrado en el set).
    const twoHandedList = Array.from(TWO_HANDED_WEAPON_TYPES);
    const placeholders = twoHandedList.map(() => '?').join(',');
    const w = await env.DB.prepare(
      `SELECT eq.item_id
       FROM user_equipment eq
       JOIN items i ON i.id = eq.item_id
       WHERE eq.user_id = ? AND eq.slot_id = 'weapon' AND i.weapon_type IN (${placeholders})`
    ).bind(session.user_id, ...twoHandedList).first();
    if (w) conflictItem = { slot_id: 'weapon', item_id: w.item_id };
  }

  // ============================================================
  // SESIÓN 26 — Si hay conflicto, asegurar que cabe en mochila
  // ============================================================
  // Cálculo de slots ocupados después del swap normal:
  //   - slotIndex se vacía (el item nuevo se va a equipment).
  //   - Si había equippedItem en targetSlot, se vuelve a llenar con ese
  //     (swap back). Si no, slotIndex queda libre.
  // Para el item de conflicto necesito UN slot libre extra.
  let conflictDestSlot = null;
  if (conflictItem) {
    const occRes = await env.DB.prepare(
      `SELECT slot_index FROM user_inventory WHERE user_id = ?`
    ).bind(session.user_id).all();
    const taken = new Set((occRes.results || []).map(r => r.slot_index));

    // Modelamos el estado post-swap:
    taken.delete(slotIndex);                // se va el item original
    if (equippedItem) taken.add(slotIndex); // swap back ocupa el slot

    for (let i = 0; i < INVENTORY_SLOTS; i++) {
      if (!taken.has(i)) { conflictDestSlot = i; break; }
    }
    if (conflictDestSlot === null) {
      return json({
        error: 'bag_full',
        message: 'Mochila llena. Vacía un slot para equipar.',
      }, 400);
    }
  }

  // ============================================================
  // 3. Operaciones atómicas (batch)
  // ============================================================
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

  // SESIÓN 26 — Si hay conflict (2H↔shield), desequipar al inventario.
  if (conflictItem && conflictDestSlot !== null) {
    ops.push(env.DB.prepare(
      `DELETE FROM user_equipment WHERE user_id = ? AND slot_id = ?`
    ).bind(session.user_id, conflictItem.slot_id));
    ops.push(env.DB.prepare(
      `INSERT INTO user_inventory (user_id, slot_index, item_id, quantity, updated_at)
       VALUES (?, ?, ?, 1, ?)`
    ).bind(session.user_id, conflictDestSlot, conflictItem.item_id, now));
  }

  await env.DB.batch(ops);

  return json({
    ok: true,
    equipped: { slot_id: targetSlot, item_id: invItem.item_id },
    swapped_back: equippedItem ? { slot_index: slotIndex, item_id: equippedItem.item_id } : null,
    auto_unequipped: conflictItem ? {
      slot_id: conflictItem.slot_id,
      item_id: conflictItem.item_id,
      to_inventory_slot: conflictDestSlot,
    } : null,
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

  // 2. Inventario actual para calcular espacio disponible
  const invRows = await env.DB.prepare(
    `SELECT slot_index, item_id, quantity FROM user_inventory WHERE user_id = ?`
  ).bind(session.user_id).all();
  const occupied = invRows.results || [];
  const taken = new Set(occupied.map(r => r.slot_index));

  function firstFreeSlot(excluding = new Set()) {
    for (let i = 0; i < INVENTORY_SLOTS; i++) {
      if (!taken.has(i) && !excluding.has(i)) return i;
    }
    return null;
  }

  // ============================================================
  // Sesión 34 — Caso especial: desequipar quiver con flechas adentro.
  // ============================================================
  // El quiver, al estar equipado, almacena flechas en user_quiver.
  // Al desequiparse, ese contenido vuelve al inventario:
  //   - Si ya hay un stack del mismo arrow_item_id → suma quantity ahí (no
  //     ocupa slot nuevo).
  //   - Si no → necesita un slot libre extra (además del que ocupa el quiver).
  // Si la mochila no tiene espacio para ambos → error 'inventory_full'
  // y NO se modifica nada (atómico).
  if (slotId === 'quiver') {
    const q = await env.DB.prepare(
      `SELECT arrow_item_id, arrow_quantity FROM user_quiver WHERE user_id = ?`
    ).bind(session.user_id).first();

    const hasArrows = q && q.arrow_item_id && q.arrow_quantity > 0;

    // Slot para el quiver mismo
    const quiverDestSlot = firstFreeSlot();
    if (quiverDestSlot === null) {
      return json({ error: 'inventory_full', message: 'Mochila llena' }, 400);
    }

    const now = Date.now();
    const stmts = [
      env.DB.prepare(
        `DELETE FROM user_equipment WHERE user_id = ? AND slot_id = 'quiver'`
      ).bind(session.user_id),
      env.DB.prepare(
        `INSERT INTO user_inventory (user_id, slot_index, item_id, quantity, updated_at)
         VALUES (?, ?, ?, 1, ?)`
      ).bind(session.user_id, quiverDestSlot, equipped.item_id, now),
    ];

    if (hasArrows) {
      // ¿Ya hay stack del mismo tipo de flecha en inv?
      const existingArrowStack = occupied.find(r => r.item_id === q.arrow_item_id);
      if (existingArrowStack) {
        stmts.push(env.DB.prepare(
          `UPDATE user_inventory SET quantity = quantity + ?, updated_at = ?
           WHERE user_id = ? AND slot_index = ?`
        ).bind(q.arrow_quantity, now, session.user_id, existingArrowStack.slot_index));
      } else {
        // Slot extra para las flechas (no puede ser el mismo que usamos para el quiver)
        const arrowDestSlot = firstFreeSlot(new Set([quiverDestSlot]));
        if (arrowDestSlot === null) {
          return json({ error: 'inventory_full', message: 'Mochila llena (flechas del carcaj no caben)' }, 400);
        }
        stmts.push(env.DB.prepare(
          `INSERT INTO user_inventory (user_id, slot_index, item_id, quantity, updated_at)
           VALUES (?, ?, ?, ?, ?)`
        ).bind(session.user_id, arrowDestSlot, q.arrow_item_id, q.arrow_quantity, now));
      }
      // Vaciar el quiver storage
      stmts.push(env.DB.prepare(
        `UPDATE user_quiver SET arrow_item_id = NULL, arrow_quantity = 0, updated_at = ?
         WHERE user_id = ?`
      ).bind(now, session.user_id));
    }

    await env.DB.batch(stmts);
    return json({
      ok: true,
      unequipped: { slot_id: slotId, item_id: equipped.item_id, to_inventory_slot: quiverDestSlot },
      arrows_returned: hasArrows ? { item_id: q.arrow_item_id, quantity: q.arrow_quantity } : null,
    });
  }

  // ============================================================
  // Caso normal (todos los demás slots): mover 1 item al primer slot libre
  // ============================================================
  const freeSlot = firstFreeSlot();
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
