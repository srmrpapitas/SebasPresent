/**
 * SebasPresent — Bank handlers (Slice 4b)
 * Endpoints: GET /api/bank, POST /api/bank/deposit, /withdraw, /swap
 *
 * Sesión 11c-2: capacidad subida de 500 → 1200 slots. El banco ya
 * stackea todos los items por item_id en deposit (regardless del flag
 * stackable del item), por lo que TODOS los items que tengas del mismo
 * tipo ocupan un solo slot en el banco — comportamiento OSRS estándar.
 */

import { json, readJson } from '../lib/db.js';
import { requireSession } from '../lib/auth.js';
import { INVENTORY_SLOTS, pickInvSlot } from './inventory.js';
import { isNote, baseOfNote, noteOf } from '../../client/src/shared/notes.js';   // Sesión 50
import { questEvent } from '../lib/quests.js';                                    // Sesión 50

/** Sesión 50 — crea la fila de la nota del item si todavía no existe. */
async function ensureNoteItem(env, baseId) {
  await env.DB.prepare(
    `INSERT OR IGNORE INTO items (id, name, icon, stackable, description, created_at, base_price)
     SELECT id || '_note', name || ' (nota)', icon, 1,
            'Nota de banco. En cualquier banco se cambia por el objeto.', ?, base_price
       FROM items WHERE id = ? AND stackable = 0`
  ).bind(Date.now(), baseId).run();
}

export const BANK_MAX_SLOTS = 1200;

export async function handleGetBank(request, env) {
  const session = await requireSession(request, env);
  if (!session) return json({ error: 'unauthorized' }, 401);

  const result = await env.DB.prepare(
    `SELECT b.slot_index AS slot, b.item_id, b.quantity,
            i.name, i.icon, i.stackable
     FROM user_bank b
     JOIN items i ON i.id = b.item_id
     WHERE b.user_id = ?
     ORDER BY b.slot_index ASC`
  ).bind(session.user_id).all();

  const rows = (result.results || []).map(r => ({
    slot: r.slot,
    item_id: r.item_id,
    quantity: r.quantity,
    name: r.name,
    icon: r.icon,
    stackable: r.stackable === 1,
  }));

  return json({ slots: rows });
}

export async function handleBankDeposit(request, env) {
  const session = await requireSession(request, env);
  if (!session) return json({ error: 'unauthorized' }, 401);

  const body = await readJson(request);
  if (!body) return json({ error: 'bad_request' }, 400);

  const invSlot = body.inv_slot;
  let qty = body.quantity;

  if (!Number.isInteger(invSlot) || invSlot < 0 || invSlot >= INVENTORY_SLOTS) {
    return json({ error: 'invalid_slot', message: 'inv_slot fuera de rango.' }, 400);
  }
  if (!Number.isInteger(qty) || (qty <= 0 && qty !== -1)) {
    return json({ error: 'invalid_quantity', message: 'quantity debe ser positivo o -1 (todo).' }, 400);
  }

  const invRow = await env.DB.prepare(
    `SELECT inv.item_id, inv.quantity, i.stackable
     FROM user_inventory inv
     JOIN items i ON i.id = inv.item_id
     WHERE inv.user_id = ? AND inv.slot_index = ?`
  ).bind(session.user_id, invSlot).first();

  if (!invRow) {
    return json({ error: 'empty_slot', message: 'No hay nada en ese slot del inventario.' }, 400);
  }

  const itemId = invRow.item_id;
  const now = Date.now();

  // Sesión 50 — Items NO apilables (minerales, lingotes, troncos...) ocupan un
  // slot por unidad. "Depositar X / Todo" recoge unidades de TODOS los slots
  // con ese item (empezando por el tocado), como en OSRS.
  let unitSlots = null;   // [{ slot, quantity }] a borrar/restar
  let available = invRow.quantity;
  if (invRow.stackable !== 1) {
    const same = await env.DB.prepare(
      'SELECT slot_index, quantity FROM user_inventory WHERE user_id = ? AND item_id = ? ORDER BY slot_index'
    ).bind(session.user_id, itemId).all();
    const rows = (same.results || []).sort((a, b) =>
      (a.slot_index === invSlot ? -1 : b.slot_index === invSlot ? 1 : a.slot_index - b.slot_index));
    available = rows.reduce((t, r) => t + r.quantity, 0);
    if (qty === -1 || qty > available) qty = available;
    unitSlots = [];
    let left = qty;
    for (const r of rows) {
      if (left <= 0) break;
      const take = Math.min(left, r.quantity);
      unitSlots.push({ slot: r.slot_index, quantity: r.quantity, take });
      left -= take;
    }
  } else {
    if (qty === -1) qty = available;
    if (qty > available) qty = available;
  }

  // Sesión 50 — una nota se guarda en el banco como el objeto real.
  const bankItemId = isNote(itemId) ? baseOfNote(itemId) : itemId;
  const bankRow = await env.DB.prepare(
    'SELECT slot_index, quantity FROM user_bank WHERE user_id = ? AND item_id = ?'
  ).bind(session.user_id, bankItemId).first();

  const stmts = [];

  if (bankRow) {
    stmts.push(env.DB.prepare(
      'UPDATE user_bank SET quantity = quantity + ?, updated_at = ? WHERE user_id = ? AND slot_index = ?'
    ).bind(qty, now, session.user_id, bankRow.slot_index));
  } else {
    const maxRow = await env.DB.prepare(
      'SELECT COALESCE(MAX(slot_index), -1) AS max_slot FROM user_bank WHERE user_id = ?'
    ).bind(session.user_id).first();
    const nextSlot = (maxRow?.max_slot ?? -1) + 1;
    if (nextSlot >= BANK_MAX_SLOTS) {
      return json({ error: 'bank_full', message: 'El banco está lleno.' }, 400);
    }
    stmts.push(env.DB.prepare(
      'INSERT INTO user_bank (user_id, slot_index, item_id, quantity, updated_at) VALUES (?, ?, ?, ?, ?)'
    ).bind(session.user_id, nextSlot, bankItemId, qty, now));
  }

  if (unitSlots) {
    for (const u of unitSlots) {
      stmts.push(u.take >= u.quantity
        ? env.DB.prepare('DELETE FROM user_inventory WHERE user_id = ? AND slot_index = ?')
            .bind(session.user_id, u.slot)
        : env.DB.prepare('UPDATE user_inventory SET quantity = quantity - ?, updated_at = ? WHERE user_id = ? AND slot_index = ?')
            .bind(u.take, now, session.user_id, u.slot));
    }
  } else if (qty >= available) {
    stmts.push(env.DB.prepare(
      'DELETE FROM user_inventory WHERE user_id = ? AND slot_index = ?'
    ).bind(session.user_id, invSlot));
  } else {
    stmts.push(env.DB.prepare(
      'UPDATE user_inventory SET quantity = quantity - ?, updated_at = ? WHERE user_id = ? AND slot_index = ?'
    ).bind(qty, now, session.user_id, invSlot));
  }

  await env.DB.batch(stmts);
  await questEvent(env, session.user_id, 'bank', bankItemId);   // Sesión 50
  return json({ ok: true, deposited: qty, unnoted: bankItemId !== itemId });
}

export async function handleBankWithdraw(request, env) {
  const session = await requireSession(request, env);
  if (!session) return json({ error: 'unauthorized' }, 401);

  const body = await readJson(request);
  if (!body) return json({ error: 'bad_request' }, 400);

  const bankSlot = body.bank_slot;
  let qty = body.quantity;
  const targetInvSlot = body.target_inv_slot;

  if (!Number.isInteger(bankSlot) || bankSlot < 0 || bankSlot >= BANK_MAX_SLOTS) {
    return json({ error: 'invalid_slot', message: 'bank_slot fuera de rango.' }, 400);
  }
  if (!Number.isInteger(qty) || (qty <= 0 && qty !== -1)) {
    return json({ error: 'invalid_quantity', message: 'quantity debe ser positivo o -1 (todo).' }, 400);
  }
  if (targetInvSlot !== undefined && targetInvSlot !== null) {
    if (!Number.isInteger(targetInvSlot) || targetInvSlot < 0 || targetInvSlot >= INVENTORY_SLOTS) {
      return json({ error: 'invalid_slot', message: 'target_inv_slot fuera de rango.' }, 400);
    }
  }

  const bankRow = await env.DB.prepare(
    `SELECT b.item_id, b.quantity, i.stackable
     FROM user_bank b
     JOIN items i ON i.id = b.item_id
     WHERE b.user_id = ? AND b.slot_index = ?`
  ).bind(session.user_id, bankSlot).first();

  if (!bankRow) {
    return json({ error: 'empty_slot', message: 'No hay nada en ese slot del banco.' }, 400);
  }

  const available = bankRow.quantity;
  if (qty === -1) qty = available;
  if (qty > available) qty = available;

  // Sesión 50 — sacar como NOTA (solo objetos que no se apilan)
  const asNote = body.as_note === true && bankRow.stackable !== 1 && !isNote(bankRow.item_id);
  if (asNote) await ensureNoteItem(env, bankRow.item_id);
  const itemId = asNote ? noteOf(bankRow.item_id) : bankRow.item_id;
  const isStackable = asNote || bankRow.stackable === 1;
  const now = Date.now();

  const invRes = await env.DB.prepare(
    'SELECT slot_index, item_id, quantity FROM user_inventory WHERE user_id = ?'
  ).bind(session.user_id).all();
  const invMap = new Map();
  for (const r of (invRes.results || [])) {
    invMap.set(r.slot_index, { item_id: r.item_id, quantity: r.quantity });
  }

  const stmts = [];

  if (isStackable) {
    let existingSlot = null;
    for (const [slot, data] of invMap) {
      if (data.item_id === itemId) { existingSlot = slot; break; }
    }

    if (existingSlot !== null) {
      stmts.push(env.DB.prepare(
        'UPDATE user_inventory SET quantity = quantity + ?, updated_at = ? WHERE user_id = ? AND slot_index = ?'
      ).bind(qty, now, session.user_id, existingSlot));
    } else {
      const slot = pickInvSlot(invMap, targetInvSlot);
      if (slot === null) {
        return json({ error: 'inv_full', message: 'No hay espacio en la mochila.' }, 400);
      }
      stmts.push(env.DB.prepare(
        'INSERT INTO user_inventory (user_id, slot_index, item_id, quantity, updated_at) VALUES (?, ?, ?, ?, ?)'
      ).bind(session.user_id, slot, itemId, qty, now));
    }
  } else {
    const freeSlots = [];
    if (targetInvSlot !== undefined && targetInvSlot !== null && !invMap.has(targetInvSlot)) {
      freeSlots.push(targetInvSlot);
    }
    for (let i = 0; i < INVENTORY_SLOTS; i++) {
      if (freeSlots.includes(i)) continue;
      if (!invMap.has(i)) freeSlots.push(i);
      if (freeSlots.length >= qty) break;
    }
    if (freeSlots.length < qty) {
      return json({ error: 'inv_full', message: 'No hay espacio suficiente en la mochila.' }, 400);
    }
    for (let i = 0; i < qty; i++) {
      stmts.push(env.DB.prepare(
        'INSERT INTO user_inventory (user_id, slot_index, item_id, quantity, updated_at) VALUES (?, ?, ?, 1, ?)'
      ).bind(session.user_id, freeSlots[i], itemId, now));
    }
  }

  if (qty >= available) {
    stmts.push(env.DB.prepare(
      'DELETE FROM user_bank WHERE user_id = ? AND slot_index = ?'
    ).bind(session.user_id, bankSlot));
  } else {
    stmts.push(env.DB.prepare(
      'UPDATE user_bank SET quantity = quantity - ?, updated_at = ? WHERE user_id = ? AND slot_index = ?'
    ).bind(qty, now, session.user_id, bankSlot));
  }

  await env.DB.batch(stmts);
  if (asNote) await questEvent(env, session.user_id, 'note', bankRow.item_id);   // Sesión 50
  return json({ ok: true, as_note: asNote, item_id: itemId, withdrawn: qty });
}

export async function handleBankSwap(request, env) {
  const session = await requireSession(request, env);
  if (!session) return json({ error: 'unauthorized' }, 401);

  const body = await readJson(request);
  if (!body) return json({ error: 'bad_request' }, 400);

  const from = body.from;
  const to = body.to;

  if (!Number.isInteger(from) || !Number.isInteger(to)) {
    return json({ error: 'invalid_slots', message: 'from y to deben ser enteros.' }, 400);
  }
  if (from < 0 || from >= BANK_MAX_SLOTS || to < 0 || to >= BANK_MAX_SLOTS) {
    return json({ error: 'invalid_slots', message: 'Slots fuera de rango.' }, 400);
  }
  if (from === to) return json({ ok: true });

  const slotA = await env.DB.prepare(
    'SELECT item_id, quantity FROM user_bank WHERE user_id = ? AND slot_index = ?'
  ).bind(session.user_id, from).first();

  if (!slotA) return json({ ok: true });

  const slotB = await env.DB.prepare(
    'SELECT item_id, quantity FROM user_bank WHERE user_id = ? AND slot_index = ?'
  ).bind(session.user_id, to).first();

  const now = Date.now();

  if (!slotB) {
    await env.DB.batch([
      env.DB.prepare('DELETE FROM user_bank WHERE user_id = ? AND slot_index = ?').bind(session.user_id, from),
      env.DB.prepare(
        'INSERT INTO user_bank (user_id, slot_index, item_id, quantity, updated_at) VALUES (?, ?, ?, ?, ?)'
      ).bind(session.user_id, to, slotA.item_id, slotA.quantity, now),
    ]);
    return json({ ok: true });
  }

  await env.DB.batch([
    env.DB.prepare(
      'DELETE FROM user_bank WHERE user_id = ? AND slot_index IN (?, ?)'
    ).bind(session.user_id, from, to),
    env.DB.prepare(
      'INSERT INTO user_bank (user_id, slot_index, item_id, quantity, updated_at) VALUES (?, ?, ?, ?, ?)'
    ).bind(session.user_id, to, slotA.item_id, slotA.quantity, now),
    env.DB.prepare(
      'INSERT INTO user_bank (user_id, slot_index, item_id, quantity, updated_at) VALUES (?, ?, ?, ?, ?)'
    ).bind(session.user_id, from, slotB.item_id, slotB.quantity, now),
  ]);

  return json({ ok: true });
}
