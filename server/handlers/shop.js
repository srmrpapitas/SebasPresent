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

import { isAsoMember } from './aso.js';   // Sesión 50
import { json, readJson } from '../lib/db.js';
import { requireSession } from '../lib/auth.js';

const INVENTORY_SLOTS = 20;
const COINS_ITEM_ID = 'coins';

// ============================================================
// Sesión 50 — seguridad: cobros/pagos atómicos (sin duplicar oro)
// ============================================================
/** Resta `amount` monedas. true si se pudo (una sola petición gana). */
export async function debitCoins(env, uid, amount, now) {
  if (amount <= 0) return true;
  const up = await env.DB.prepare(
    `UPDATE user_inventory SET quantity = quantity - ?, updated_at = ?
      WHERE user_id = ? AND item_id = 'coins' AND quantity > ?
        AND slot_index = (SELECT slot_index FROM user_inventory WHERE user_id = ? AND item_id = 'coins' AND quantity > ? LIMIT 1)`
  ).bind(amount, now, uid, amount, uid, amount).run();
  if (up?.meta?.changes) return true;
  const del = await env.DB.prepare(
    `DELETE FROM user_inventory WHERE user_id = ? AND item_id = 'coins' AND quantity = ?
        AND slot_index = (SELECT slot_index FROM user_inventory WHERE user_id = ? AND item_id = 'coins' AND quantity = ? LIMIT 1)`
  ).bind(uid, amount, uid, amount).run();
  return !!del?.meta?.changes;
}
/** Suma monedas (al montón existente o a un hueco libre). */
export async function creditCoins(env, uid, amount, now) {
  if (amount <= 0) return true;
  const up = await env.DB.prepare(
    `UPDATE user_inventory SET quantity = quantity + ?, updated_at = ?
      WHERE user_id = ? AND item_id = 'coins'
        AND slot_index = (SELECT slot_index FROM user_inventory WHERE user_id = ? AND item_id = 'coins' LIMIT 1)`
  ).bind(amount, now, uid, uid).run();
  if (up?.meta?.changes) return true;
  const occ = await env.DB.prepare('SELECT slot_index FROM user_inventory WHERE user_id = ?').bind(uid).all();
  const taken = new Set((occ.results || []).map(r => r.slot_index));
  for (let i = 0; i < INVENTORY_SLOTS; i++) {
    if (taken.has(i)) continue;
    try {
      await env.DB.prepare(
        `INSERT INTO user_inventory (user_id, slot_index, item_id, quantity, updated_at) VALUES (?, ?, 'coins', ?, ?)`
      ).bind(uid, i, amount, now).run();
      return true;
    } catch { /* hueco ocupado justo ahora → siguiente */ }
  }
  return false;
}


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

  // Sesión 50 — La ASO solo vende/compra a socios
  if (shopId === 'aso' && !(await isAsoMember(env, session.user_id))) {
    return json({ error: 'aso_no_socio', message: 'Pa\' comprar aquí tienes que ser socio de La ASO.' }, 403);
  }

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

  // Sesión 50 — La ASO solo vende/compra a socios
  if (shopId === 'aso' && !(await isAsoMember(env, session.user_id))) {
    return json({ error: 'aso_no_socio', message: 'Pa\' comprar aquí tienes que ser socio de La ASO.' }, 403);
  }
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

  // 4. Sesión 50 — cobrar PRIMERO (atómico) y reservar stock; luego entregar.
  const uid = session.user_id;
  if (!(await debitCoins(env, uid, totalCost, now))) {
    return json({ error: 'insufficient_coins', message: `Necesitas ${totalCost}gp` }, 400);
  }
  const st = await env.DB.prepare(
    `UPDATE shop_stock SET current_qty = current_qty - ?
     WHERE shop_id = ? AND item_id = ? AND current_qty >= ?`
  ).bind(qty, shopId, itemId, qty).run();
  if (!st?.meta?.changes) {
    await creditCoins(env, uid, totalCost, now);
    return json({ error: 'insufficient_stock', message: 'Se ha agotado.' }, 400);
  }
  try {
    await env.DB.batch(ops);
  } catch (e) {
    await creditCoins(env, uid, totalCost, now);
    await env.DB.prepare('UPDATE shop_stock SET current_qty = current_qty + ? WHERE shop_id = ? AND item_id = ?')
      .bind(qty, shopId, itemId).run();
    return json({ error: 'busy', message: 'Inténtalo otra vez.' }, 409);
  }
  const newCoins = playerCoins - totalCost;

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

  // Sesión 50 — La ASO solo vende/compra a socios
  if (shopId === 'aso' && !(await isAsoMember(env, session.user_id))) {
    return json({ error: 'aso_no_socio', message: 'Pa\' comprar aquí tienes que ser socio de La ASO.' }, 403);
  }
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
  const uid = session.user_id;
  // Sesión 50 — seguridad: primero QUITAR el objeto (solo una petición lo
  // consigue) y después pagar. Antes dos ventas a la vez pagaban dos veces.
  const took = invRow.quantity === qty
    ? await env.DB.prepare(
        'DELETE FROM user_inventory WHERE user_id = ? AND slot_index = ? AND item_id = ? AND quantity = ?'
      ).bind(uid, slotIndex, invRow.item_id, qty).run()
    : await env.DB.prepare(
        'UPDATE user_inventory SET quantity = quantity - ?, updated_at = ? WHERE user_id = ? AND slot_index = ? AND item_id = ? AND quantity > ?'
      ).bind(qty, now, uid, slotIndex, invRow.item_id, qty).run();
  if (!took?.meta?.changes) return json({ error: 'slot_empty' }, 400);

  if (!(await creditCoins(env, uid, totalCoins, now))) {
    // Sin hueco para las monedas → devolver el objeto
    const back = await env.DB.prepare(
      'UPDATE user_inventory SET quantity = quantity + ?, updated_at = ? WHERE user_id = ? AND slot_index = ? AND item_id = ?'
    ).bind(qty, now, uid, slotIndex, invRow.item_id).run();
    if (!back?.meta?.changes) {
      try {
        await env.DB.prepare('INSERT INTO user_inventory (user_id, slot_index, item_id, quantity, updated_at) VALUES (?, ?, ?, ?, ?)')
          .bind(uid, slotIndex, invRow.item_id, qty, now).run();
      } catch {}
    }
    return json({ error: 'inventory_full' }, 400);
  }

  // Subir stock del NPC si era un item del catálogo (sin pasar max_qty)
  if (shopItemRow) {
    await env.DB.prepare(
      `UPDATE shop_stock
       SET current_qty = MIN(current_qty + ?, max_qty)
       WHERE shop_id = ? AND item_id = ?`
    ).bind(qty, shopId, invRow.item_id).run();
  }

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
