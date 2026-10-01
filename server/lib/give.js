/**
 * SebasPresent — Dar objetos a un jugador con sentencias preparadas (Sesión 50)
 * placeStmts() calcula dónde va cada objeto (montón existente o hueco libre;
 * si no cabe y bankFallback, al banco) y devuelve las sentencias para
 * ejecutarlas en un batch junto con lo que quita al otro lado (comercio, robo).
 */
const INVENTORY_SLOTS = 20;

export async function stackableMap(env, itemIds) {
  const m = {};
  for (const id of [...new Set(itemIds)]) {
    const r = await env.DB.prepare('SELECT stackable FROM items WHERE id = ?').bind(id).first();
    m[id] = r?.stackable === 1;
  }
  return m;
}

/**
 * Sentencias para dar `items` [{item_id, qty}] a `uid`. Devuelve
 * { stmts, fits } — si !fits y no hay bankFallback, no se debe ejecutar.
 */
export async function placeStmts(env, uid, items, now, { bankFallback = false } = {}) {
  const st = await stackableMap(env, items.map(i => i.item_id));
  const inv = (await env.DB.prepare('SELECT slot_index, item_id FROM user_inventory WHERE user_id = ?').bind(uid).all()).results || [];
  const taken = new Set(inv.map(r => r.slot_index));
  const stackSlot = {};
  for (const r of inv) if (st[r.item_id] && stackSlot[r.item_id] == null) stackSlot[r.item_id] = r.slot_index;
  const free = []; for (let i = 0; i < INVENTORY_SLOTS; i++) if (!taken.has(i)) free.push(i);
  const stmts = []; const toBank = [];
  for (const it of items) {
    if (!(it.qty > 0)) continue;
    if (st[it.item_id]) {
      if (stackSlot[it.item_id] != null) {
        stmts.push(env.DB.prepare('UPDATE user_inventory SET quantity = quantity + ?, updated_at = ? WHERE user_id = ? AND slot_index = ? AND item_id = ?')
          .bind(it.qty, now, uid, stackSlot[it.item_id], it.item_id));
      } else if (free.length) {
        const s = free.shift(); stackSlot[it.item_id] = s;
        stmts.push(env.DB.prepare('INSERT INTO user_inventory (user_id, slot_index, item_id, quantity, updated_at) VALUES (?, ?, ?, ?, ?)')
          .bind(uid, s, it.item_id, it.qty, now));
      } else toBank.push(it);
    } else {
      let left = it.qty;
      while (left > 0 && free.length) {
        stmts.push(env.DB.prepare('INSERT INTO user_inventory (user_id, slot_index, item_id, quantity, updated_at) VALUES (?, ?, ?, 1, ?)')
          .bind(uid, free.shift(), it.item_id, now));
        left--;
      }
      if (left > 0) toBank.push({ item_id: it.item_id, qty: left });
    }
  }
  if (toBank.length && bankFallback) {
    const maxRow = await env.DB.prepare('SELECT COALESCE(MAX(slot_index), -1) AS m FROM user_bank WHERE user_id = ?').bind(uid).first();
    let next = (maxRow?.m ?? -1) + 1;
    for (const it of toBank) {
      const ex = await env.DB.prepare('SELECT slot_index FROM user_bank WHERE user_id = ? AND item_id = ?').bind(uid, it.item_id).first();
      if (ex) stmts.push(env.DB.prepare('UPDATE user_bank SET quantity = quantity + ?, updated_at = ? WHERE user_id = ? AND slot_index = ?').bind(it.qty, now, uid, ex.slot_index));
      else stmts.push(env.DB.prepare('INSERT INTO user_bank (user_id, slot_index, item_id, quantity, updated_at) VALUES (?, ?, ?, ?, ?)').bind(uid, next++, it.item_id, it.qty, now));
    }
  }
  return { stmts, fits: toBank.length === 0, toBank };
}

