/**
 * SebasPresent — Shop handlers (Sesión 23)
 *
 * Tienda general manejada por el banker. Stock fijo de items básicos que
 * se restocka cada 30 min vía cron. Precios fijos (no GE).
 *
 * Endpoints:
 *   GET  /api/shop?shop_id=general_store
 *     → { shop_id, stock: [...], player_coins, accept_buy_pct }
 *
 *   POST /api/shop/buy { shop_id, item_id, qty }
 *     → Player compra del NPC. Cobra coins, da items.
 *
 *   POST /api/shop/sell { shop_id, slot_index, qty }
 *     → Player vende al NPC. Quita items, da coins.
 *     El NPC paga 50% del base_price del item, con clamp 1-20 gp.
 *
 * Schema:
 *   shop_stock (shop_id, item_id, current_qty, max_qty, buy_price, sell_price, last_restock_at)
 *
 * Notas:
 *   - buy_price  = lo que paga el NPC al player (cuando él vende)
 *   - sell_price = lo que cobra el NPC al player (cuando él compra)
 *   - Items que el NPC NO vende en stock pero el player puede vender:
 *     se aceptan todos, con price = clamp(item.base_price / 2, 1, 20).
 */

import { json, readJson } from '../lib/db.js';
import { requireSession } from '../lib/auth.js';

const INVENTORY_SLOTS = 28;
const COINS_ITEM_ID = 'coins';

// Precio que el NPC paga por items genéricos (no en su lista) cuando el
// player los vende. Clamp para evitar abuse.
const GENERIC_BUY_MIN = 1;
const GENERIC_BUY_MAX = 20;

// ============================================================
// GET /api/shop
// ============================================================
export async function handleGetShop(request, env) {
  const session = await requireSession(request, env);
  if (!session) return json({ error: 'unauthorized' }, 401);

  const url = new URL(request.url);
  const shopId = url.searchParams.get('shop_id') || 'general_store';

  // Stock del NPC con datos del item
  const stockResult = await env.DB.prepare(
    `SELECT s.item_id, s.current_qty, s.max_qty, s.buy_price, s.sell_price,
            i.name, i.icon, i.stackable, i.description
     FROM shop_stock s
     JOIN items i ON i.id = s.item_id
     WHERE s.shop_id = ?
     ORDER BY s.sell_price ASC, s.item_id ASC`
  ).bind(shopId).all();

  const stock = (stockResult.results || []).map(r => ({
    item_id: r.item_id,
    name: r.name,
    icon: r.icon,
    description: r.description,
    stackable: r.stackable === 1,
    current_qty: r.current_qty,
    max_qty: r.max_qty,
    buy_price: r.buy_price,
    sell_price: r.sell_price,
  }));

  // Coins del player
  const coinsRow = await env.DB.prepare(
    `SELECT SUM(quantity) AS total FROM user_inventory WHERE user_id = ? AND item_id = ?`
  ).bind(session.user_id, COINS_ITEM_ID).first();
  const playerCoins = (coinsRow?.total) || 0;

  return json({
    shop_id: shopId,
    stock,
    player_coins: playerCoins,
    generic_buy_min: GENERIC_BUY_MIN,
    generic_buy_max: GENERIC_BUY_MAX,
  });
}

// ============================================================
// POST /api/shop/buy
// ============================================================
export async function handleShopBuy(request, env) {
  const session = await requireSession(request, env);
  if (!session) return json({ error: 'unauthorized' }, 401);

  const body = await readJson(request);
  if (!body) return json({ error: 'bad_request' }, 400);
  const shopId = body.shop_id || 'general_store';
  const itemId = body.item_id;
  const qty = body.qty | 0;

  if (!itemId || qty < 1) {
    return json({ error: 'bad_request', message: 'item_id y qty (>=1) requeridos' }, 400);
  }

  // 1. Verificar stock en el NPC + precio
  const stockRow = await env.DB.prepare(
    `SELECT s.current_qty, s.sell_price, i.stackable
     FROM shop_stock s
     JOIN items i ON i.id = s.item_id
     WHERE s.shop_id = ? AND s.item_id = ?`
  ).bind(shopId, itemId).first();

  if (!stockRow) return json({ error: 'item_not_in_shop' }, 404);
  if (stockRow.current_qty < qty) {
    return json({ error: 'insufficient_stock', message: `Solo quedan ${stockRow.current_qty} unidades` }, 400);
  }

  const totalCost = stockRow.sell_price * qty;
  const stackable = stockRow.stackable === 1;

  // 2. Verificar coins del player
  const coinsRow = await env.DB.prepare(
    `SELECT slot_index, quantity FROM user_inventory
     WHERE user_id = ? AND item_id = ?`
  ).bind(session.user_id, COINS_ITEM_ID).first();
  const playerCoins = coinsRow?.quantity || 0;
  if (playerCoins < totalCost) {
    return json({ error: 'insufficient_coins', message: `Necesitas ${totalCost}gp, tienes ${playerCoins}gp` }, 400);
  }

  // 3. Verificar slot disponible para el item comprado
  // - Si stackable: buscar si ya tiene ese item en algún slot (merge),
  //   o si no, usar primer slot libre
  // - Si NO stackable: necesita qty slots libres
  const invResult = await env.DB.prepare(
    `SELECT slot_index, item_id, quantity FROM user_inventory WHERE user_id = ?`
  ).bind(session.user_id).all();
  const inv = invResult.results || [];
  const occupied = new Set(inv.map(r => r.slot_index));

  const now = Date.now();
  const ops = [];

  if (stackable) {
    // Intentar merge en slot existente
    const existingSlot = inv.find(r => r.item_id === itemId);
    if (existingSlot) {
      // Merge en slot existente
      ops.push(env.DB.prepare(
        `UPDATE user_inventory SET quantity = quantity + ?, updated_at = ?
         WHERE user_id = ? AND slot_index = ?`
      ).bind(qty, now, session.user_id, existingSlot.slot_index));
    } else {
      // Slot nuevo
      let freeSlot = null;
      for (let i = 0; i < INVENTORY_SLOTS; i++) {
        if (!occupied.has(i)) { freeSlot = i; break; }
      }
      if (freeSlot === null) {
        return json({ error: 'inventory_full' }, 400);
      }
      ops.push(env.DB.prepare(
        `INSERT INTO user_inventory (user_id, slot_index, item_id, quantity, updated_at)
         VALUES (?, ?, ?, ?, ?)`
      ).bind(session.user_id, freeSlot, itemId, qty, now));
    }
  } else {
    // No stackable: necesita qty slots libres
    const freeSlots = [];
    for (let i = 0; i < INVENTORY_SLOTS; i++) {
      if (!occupied.has(i)) freeSlots.push(i);
      if (freeSlots.length >= qty) break;
    }
    if (freeSlots.length < qty) {
      return json({ error: 'inventory_full', message: `Necesitas ${qty} slots libres` }, 400);
    }
    for (let i = 0; i < qty; i++) {
      ops.push(env.DB.prepare(
        `INSERT INTO user_inventory (user_id, slot_index, item_id, quantity, updated_at)
         VALUES (?, ?, ?, 1, ?)`
      ).bind(session.user_id, freeSlots[i], itemId, now));
    }
  }

  // 4. Cobrar coins
  const newCoins = playerCoins - totalCost;
  if (newCoins === 0) {
    ops.push(env.DB.prepare(
      `DELETE FROM user_inventory WHERE user_id = ? AND slot_index = ?`
    ).bind(session.user_id, coinsRow.slot_index));
  } else {
    ops.push(env.DB.prepare(
      `UPDATE user_inventory SET quantity = ?, updated_at = ?
       WHERE user_id = ? AND slot_index = ?`
    ).bind(newCoins, now, session.user_id, coinsRow.slot_index));
  }

  // 5. Bajar stock del NPC
  ops.push(env.DB.prepare(
    `UPDATE shop_stock SET current_qty = current_qty - ?
     WHERE shop_id = ? AND item_id = ?`
  ).bind(qty, shopId, itemId));

  await env.DB.batch(ops);

  return json({
    ok: true,
    bought: { item_id: itemId, qty, total_cost: totalCost },
    new_coins: newCoins,
  });
}

// ============================================================
// POST /api/shop/sell
// ============================================================
export async function handleShopSell(request, env) {
  const session = await requireSession(request, env);
  if (!session) return json({ error: 'unauthorized' }, 401);

  const body = await readJson(request);
  if (!body) return json({ error: 'bad_request' }, 400);
  const shopId = body.shop_id || 'general_store';
  const slotIndex = body.slot_index;
  const qty = body.qty | 0;

  if (!Number.isInteger(slotIndex) || slotIndex < 0 || slotIndex >= INVENTORY_SLOTS) {
    return json({ error: 'invalid_slot' }, 400);
  }
  if (qty < 1) return json({ error: 'invalid_qty' }, 400);

  // 1. Leer item del player
  const invRow = await env.DB.prepare(
    `SELECT inv.item_id, inv.quantity, i.stackable, i.base_price, i.name
     FROM user_inventory inv
     JOIN items i ON i.id = inv.item_id
     WHERE inv.user_id = ? AND inv.slot_index = ?`
  ).bind(session.user_id, slotIndex).first();

  if (!invRow) return json({ error: 'slot_empty' }, 400);

  // No vender coins jamás
  if (invRow.item_id === COINS_ITEM_ID) {
    return json({ error: 'cannot_sell_coins' }, 400);
  }

  if (invRow.quantity < qty) {
    return json({ error: 'insufficient_qty', message: `Solo tienes ${invRow.quantity}` }, 400);
  }

  // 2. Calcular precio:
  //    - Si el item está en el stock del shop, usar buy_price
  //    - Si no, clamp del base_price/2 entre [GENERIC_BUY_MIN, GENERIC_BUY_MAX]
  const shopItemRow = await env.DB.prepare(
    `SELECT buy_price FROM shop_stock WHERE shop_id = ? AND item_id = ?`
  ).bind(shopId, invRow.item_id).first();

  let pricePerUnit;
  if (shopItemRow) {
    pricePerUnit = shopItemRow.buy_price;
  } else {
    const halfBase = Math.floor((invRow.base_price || 1) / 2);
    pricePerUnit = Math.max(GENERIC_BUY_MIN, Math.min(GENERIC_BUY_MAX, halfBase));
  }
  const totalCoins = pricePerUnit * qty;

  // 3. Operaciones:
  //   a) Quitar items del inventory
  //   b) Sumar coins (merge en slot existente o crear nuevo)
  //   c) Subir stock del NPC (si era un item de su catálogo, hasta max)
  const now = Date.now();
  const ops = [];

  if (invRow.quantity === qty) {
    ops.push(env.DB.prepare(
      `DELETE FROM user_inventory WHERE user_id = ? AND slot_index = ?`
    ).bind(session.user_id, slotIndex));
  } else {
    ops.push(env.DB.prepare(
      `UPDATE user_inventory SET quantity = quantity - ?, updated_at = ?
       WHERE user_id = ? AND slot_index = ?`
    ).bind(qty, now, session.user_id, slotIndex));
  }

  // Sumar coins
  const coinsRow = await env.DB.prepare(
    `SELECT slot_index, quantity FROM user_inventory
     WHERE user_id = ? AND item_id = ?`
  ).bind(session.user_id, COINS_ITEM_ID).first();

  if (coinsRow) {
    // Merge en slot existente. OJO: si el slot del coins COINCIDE con el
    // slot que estamos vaciando, no hay conflicto porque ese DELETE ya
    // estaría en ops; el UPDATE de coins no toca el mismo slot.
    ops.push(env.DB.prepare(
      `UPDATE user_inventory SET quantity = quantity + ?, updated_at = ?
       WHERE user_id = ? AND slot_index = ?`
    ).bind(totalCoins, now, session.user_id, coinsRow.slot_index));
  } else {
    // Necesitamos slot libre. Si el slot que acabamos de vaciar (porque
    // qty == quantity) está disponible, lo usamos. Si no, primer libre.
    const allOccupied = await env.DB.prepare(
      `SELECT slot_index FROM user_inventory WHERE user_id = ?`
    ).bind(session.user_id).all();
    const taken = new Set((allOccupied.results || []).map(r => r.slot_index));

    // El slot vaciado se considera libre si vendemos todo
    if (invRow.quantity === qty) taken.delete(slotIndex);

    let freeSlot = null;
    for (let i = 0; i < INVENTORY_SLOTS; i++) {
      if (!taken.has(i)) { freeSlot = i; break; }
    }
    if (freeSlot === null) {
      return json({ error: 'inventory_full' }, 400);
    }
    ops.push(env.DB.prepare(
      `INSERT INTO user_inventory (user_id, slot_index, item_id, quantity, updated_at)
       VALUES (?, ?, ?, ?, ?)`
    ).bind(session.user_id, freeSlot, COINS_ITEM_ID, totalCoins, now));
  }

  // Subir stock del NPC si era un item del catálogo (sin pasar max_qty)
  if (shopItemRow) {
    ops.push(env.DB.prepare(
      `UPDATE shop_stock
       SET current_qty = MIN(current_qty + ?, max_qty)
       WHERE shop_id = ? AND item_id = ?`
    ).bind(qty, shopId, invRow.item_id));
  }

  await env.DB.batch(ops);

  return json({
    ok: true,
    sold: { item_id: invRow.item_id, qty, total_coins: totalCoins, price_per_unit: pricePerUnit },
  });
}

// ============================================================
// Restock cron (llamado desde handlers/cron.js)
// ============================================================
/**
 * Restock cada 30 min: items con stock < max suben +5, sin pasar max.
 * Llamado desde scheduledHandler.
 */
export async function restockShops(env) {
  const now = Date.now();
  await env.DB.prepare(
    `UPDATE shop_stock
     SET current_qty = MIN(current_qty + 5, max_qty),
         last_restock_at = ?
     WHERE current_qty < max_qty`
  ).bind(now).run();
}
