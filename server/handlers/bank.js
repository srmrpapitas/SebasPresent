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
import { isNearAnyBank } from '../../client/src/shared/banks.js';                 // Sesión 50 — seguridad

/** Sesión 50 — ¿el jugador está junto a un banco? (null = sí; si no, la respuesta de error) */
async function bankProximityError(env, userId) {
  const row = await env.DB.prepare('SELECT x, z FROM online_users WHERE user_id = ?').bind(userId).first();
  if (row && isNearAnyBank(Number(row.x), Number(row.z))) return null;
  return json({ error: 'not_at_bank', message: 'Tienes que estar junto a un banco.' }, 400);
}

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
  { const e = await bankProximityError(env, session.user_id); if (e) return e; }

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

  // Sesión 50 — seguridad: TODO en una transacción y las cantidades se leen
  // DENTRO de ella (subconsultas). Dos depósitos a la vez ya no duplican:
  // al banco solo entra lo que de verdad sale de la mochila.
  const uid = session.user_id;
  const stmts = [];
  let bankSlot;
  if (bankRow) {
    bankSlot = bankRow.slot_index;
  } else {
    const maxRow = await env.DB.prepare(
      'SELECT COALESCE(MAX(slot_index), -1) AS max_slot FROM user_bank WHERE user_id = ?'
    ).bind(uid).first();
    bankSlot = (maxRow?.max_slot ?? -1) + 1;
    if (bankSlot >= BANK_MAX_SLOTS) {
      return json({ error: 'bank_full', message: 'El banco está lleno.' }, 400);
    }
    stmts.push(env.DB.prepare(
      'INSERT INTO user_bank (user_id, slot_index, item_id, quantity, updated_at) VALUES (?, ?, ?, 0, ?)'
    ).bind(uid, bankSlot, bankItemId, now));
  }
  const takes = unitSlots
    ? unitSlots.map(u => ({ slot: u.slot, take: u.take }))
    : [{ slot: invSlot, take: qty }];
  for (const t of takes) {
    stmts.push(env.DB.prepare(
      `UPDATE user_bank SET quantity = quantity + MIN(?, COALESCE((SELECT quantity FROM user_inventory
                 WHERE user_id = ? AND slot_index = ? AND item_id = ?), 0)), updated_at = ?
        WHERE user_id = ? AND slot_index = ? AND item_id = ?`
    ).bind(t.take, uid, t.slot, itemId, now, uid, bankSlot, bankItemId));
    stmts.push(env.DB.prepare(
      'DELETE FROM user_inventory WHERE user_id = ? AND slot_index = ? AND item_id = ? AND quantity <= ?'
    ).bind(uid, t.slot, itemId, t.take));
    stmts.push(env.DB.prepare(
      'UPDATE user_inventory SET quantity = quantity - ?, updated_at = ? WHERE user_id = ? AND slot_index = ? AND item_id = ? AND quantity > ?'
    ).bind(t.take, now, uid, t.slot, itemId, t.take));
  }
  stmts.push(env.DB.prepare(
    'DELETE FROM user_bank WHERE user_id = ? AND slot_index = ? AND quantity <= 0'
  ).bind(uid, bankSlot));

  try {
    await env.DB.batch(stmts);
  } catch (e) {
    return json({ error: 'busy', message: 'Inténtalo otra vez.' }, 409);
  }
  await questEvent(env, session.user_id, 'bank', bankItemId);   // Sesión 50
  return json({ ok: true, deposited: qty, unnoted: bankItemId !== itemId });
}

export async function handleBankWithdraw(request, env) {
  const session = await requireSession(request, env);
  if (!session) return json({ error: 'unauthorized' }, 401);
  { const e = await bankProximityError(env, session.user_id); if (e) return e; }

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

  // Sesión 50 — seguridad: igual que el depósito, las cantidades se leen
  // dentro de la transacción: a la mochila solo llega lo que sale del banco.
  const uid = session.user_id;
  const bankQ = `COALESCE((SELECT quantity FROM user_bank WHERE user_id = ? AND slot_index = ? AND item_id = ?), 0)`;
  const bq = [uid, bankSlot, bankRow.item_id];
  const stmts = [];

  if (isStackable) {
    let existingSlot = null;
    for (const [slot, data] of invMap) {
      if (data.item_id === itemId) { existingSlot = slot; break; }
    }

    if (existingSlot !== null) {
      stmts.push(env.DB.prepare(
        `UPDATE user_inventory SET quantity = quantity + MIN(?, ${bankQ}), updated_at = ?
          WHERE user_id = ? AND slot_index = ? AND item_id = ?`
      ).bind(qty, ...bq, now, uid, existingSlot, itemId));
    } else {
      const slot = pickInvSlot(invMap, targetInvSlot);
      if (slot === null) {
        return json({ error: 'inv_full', message: 'No hay espacio en la mochila.' }, 400);
      }
      stmts.push(env.DB.prepare(
        `INSERT INTO user_inventory (user_id, slot_index, item_id, quantity, updated_at)
         SELECT ?, ?, ?, MIN(?, ${bankQ}), ? WHERE ${bankQ} > 0`
      ).bind(uid, slot, itemId, qty, ...bq, now, ...bq));
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
      // la unidad nº i+1 solo se crea si el banco tiene al menos i+1
      stmts.push(env.DB.prepare(
        `INSERT INTO user_inventory (user_id, slot_index, item_id, quantity, updated_at)
         SELECT ?, ?, ?, 1, ? WHERE ${bankQ} >= ?`
      ).bind(uid, freeSlots[i], itemId, now, ...bq, i + 1));
    }
  }

  stmts.push(env.DB.prepare(
    'DELETE FROM user_bank WHERE user_id = ? AND slot_index = ? AND item_id = ? AND quantity <= ?'
  ).bind(uid, bankSlot, bankRow.item_id, qty));
  stmts.push(env.DB.prepare(
    'UPDATE user_bank SET quantity = quantity - ?, updated_at = ? WHERE user_id = ? AND slot_index = ? AND item_id = ? AND quantity > ?'
  ).bind(qty, now, uid, bankSlot, bankRow.item_id, qty));

  try {
    await env.DB.batch(stmts);
  } catch (e) {
    return json({ error: 'busy', message: 'Inténtalo otra vez.' }, 409);
  }
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
  const uid = session.user_id;
  // Sesión 50 — mover = cambiar el slot (nunca borrar y recrear): sin duplicados.
  try {
    if (!slotB) {
      await env.DB.prepare('UPDATE user_bank SET slot_index = ?, updated_at = ? WHERE user_id = ? AND slot_index = ?')
        .bind(to, now, uid, from).run();
    } else {
      const tmp = -1 - from;
      await env.DB.batch([
        env.DB.prepare('UPDATE user_bank SET slot_index = ? WHERE user_id = ? AND slot_index = ?').bind(tmp, uid, from),
        env.DB.prepare('UPDATE user_bank SET slot_index = ?, updated_at = ? WHERE user_id = ? AND slot_index = ?').bind(from, now, uid, to),
        env.DB.prepare('UPDATE user_bank SET slot_index = ?, updated_at = ? WHERE user_id = ? AND slot_index = ?').bind(to, now, uid, tmp),
      ]);
    }
  } catch (e) {
    return json({ error: 'busy', message: 'Inténtalo otra vez.' }, 409);
  }
  return json({ ok: true });
}
