/**
 * SebasPresent — Grand Exchange Engine v2 (Slice 4c)
 *
 * Modulo PURO. No depende de Cloudflare ni de D1 directamente.
 * Recibe un `db` con interfaz minima:
 *
 *   db.first(sql, params)  -> Promise<row | null>
 *   db.all(sql, params)    -> Promise<row[]>
 *   db.run(sql, params)    -> Promise<{ changes, lastInsertRowId? }>
 *   db.batch(statements)   -> Promise<results[]>
 *     statements = [{ sql, params }, ...]
 *     Debe ejecutarse atomicamente (BEGIN/COMMIT).
 *
 * CAMBIO DE MODELO RESPECTO A v1
 * ===============================
 *
 * v1 (cerrado el 12 mayo):
 *   - place sell -> retira items de user_bank
 *   - place buy  -> retira coins de user_bank
 *   - match      -> deposita resultado en user_bank
 *   - cancel     -> devuelve escrow a user_bank
 *
 * v2 (este archivo):
 *   - place sell -> retira items de user_inventory (mochila)
 *   - place buy  -> retira coins de user_inventory (mochila)
 *   - match      -> acumula resultado en pending_coins / pending_items
 *                   de la propia orden (NO toca bank ni inv)
 *   - cancel     -> mueve escrow restante a pending_*
 *   - claim_all  -> el user reclama todo lo pendiente a mochila o banco
 *
 * Esto matchea como funciona OSRS: vendes desde la mochila, los
 * resultados aparecen en una "collection box" del GE, y los recoges
 * con dos flechas (-> mochila, -> banco).
 *
 * NOTA ARQUITECTONICA: HUB Y NPCs (slice 6)
 * =========================================
 * El GE en el juego sera una ESTRUCTURA FISICA en el hub con NPC.
 * Hablar con el NPC abrira un menu "Banco" o "Grand Exchange". Hoy
 * ambos modulos se acceden via tabs del sidebar. En slice 6 ambos
 * se moveran a overlays disparados por el NPC. La logica de este
 * engine NO cambia.
 *
 * INVARIANTES
 * ===========
 *
 * I1. Coin escrow (buys):
 *     Para toda orden buy abierta: coin_escrow == (qty_total - qty_filled) * price
 *     Al matchear, escrow baja en buyerReserved (= buy.price * qty_matched).
 *     La diferencia entre buyerReserved y buyerSpend (= matchPrice * qty_matched)
 *     es el rebate, que se acumula en pending_coins.
 *
 * I2. Item escrow (sells):
 *     Para toda orden sell abierta: item_escrow == (qty_total - qty_filled)
 *
 * I3. Maker-takes-price:
 *     El precio de un match es el de la orden mas antigua (created_at ASC).
 *
 * I4. No self-trade:
 *     buy.user_id != sell.user_id.
 *
 * I5. Fairness:
 *     A precios iguales gana created_at ASC. Las fantasmas tienen
 *     created_at futuro lejano -> siempre pierden tiebreak contra reales.
 *
 * I6. Atomicidad:
 *     Cada match / place / cancel / claim por orden se ejecuta en un
 *     solo db.batch. No hay estado inconsistente intermedio.
 *
 * I7. Conservacion de valor (real users):
 *     Para usuarios reales, la suma de:
 *       inventory_coins + bank_coins + sum(coin_escrow open) + sum(pending_coins)
 *     es CONSTANTE a lo largo del ciclo de vida de una orden buy.
 *     Equivalente para items (con su item_id).
 *
 * I8. SYSTEM (fantasmas) no tiene pending:
 *     userId === SYSTEM_USER_ID no escribe pending_coins ni pending_items.
 *     Sus contrapartes virtualmente "evaporan". Esto rompe I7 a proposito
 *     para el sistema (es liquidez generada).
 */

export const SYSTEM_USER_ID = 0;
export const SIDE_BUY = 0;
export const SIDE_SELL = 1;
export const STATUS_OPEN = 0;
export const STATUS_COMPLETED = 1;
export const STATUS_CANCELLED = 2;
export const COIN_ITEM_ID = 'coins';
export const MAX_ORDER_SLOTS_PER_USER = 8;
export const INVENTORY_SLOT_COUNT = 20;

// Targets validos para claimAll
export const CLAIM_TARGET_INVENTORY = 'inventory';
export const CLAIM_TARGET_BANK = 'bank';

// Banda de precio por defecto: +/-5% sobre precio guia (igual que OSRS).
// Floor minimo: 5gp absolutos para items baratos.
export const PRICE_BAND_BPS = 500;
export const PRICE_BAND_FLOOR_ABS = 5;
export const BPS_DIVISOR = 10_000;

// ============================================================
// PRECIO GUIA Y BANDAS (sin cambios desde v1)
// ============================================================

export async function getGuidePrice(db, itemId) {
  const item = await db.first('SELECT base_price FROM items WHERE id = ?', [itemId]);
  if (!item) throw makeErr('unknown_item');

  const since = Date.now() - 24 * 60 * 60 * 1000;
  const recent = await db.first(
    `SELECT SUM(matched_price * qty) AS num, SUM(qty) AS den
     FROM ge_history WHERE item_id = ? AND matched_at >= ?`,
    [itemId, since]
  );
  if (recent && recent.den) return Math.round(recent.num / recent.den);
  return item.base_price;
}

export async function getSuggestedPrice(db, itemId) {
  const bestBuy = await db.first(
    `SELECT price FROM ge_orders
     WHERE item_id = ? AND side = ? AND status = ?
     ORDER BY price DESC, created_at ASC LIMIT 1`,
    [itemId, SIDE_BUY, STATUS_OPEN]
  );
  const bestSell = await db.first(
    `SELECT price FROM ge_orders
     WHERE item_id = ? AND side = ? AND status = ?
     ORDER BY price ASC, created_at ASC LIMIT 1`,
    [itemId, SIDE_SELL, STATUS_OPEN]
  );
  if (bestBuy && bestSell) return Math.round((bestBuy.price + bestSell.price) / 2);
  if (bestBuy) return bestBuy.price;
  if (bestSell) return bestSell.price;
  return await getGuidePrice(db, itemId);
}

export async function getPriceBand(db, itemId, bps = PRICE_BAND_BPS) {
  const guide = await getGuidePrice(db, itemId);
  const pctDelta = Math.round((guide * bps) / BPS_DIVISOR);
  const delta = Math.max(PRICE_BAND_FLOOR_ABS, pctDelta);
  return { guide, min: Math.max(1, guide - delta), max: guide + delta };
}

// ============================================================
// VALIDACION DE ORDEN
// ============================================================

export async function validateOrderShape(db, { itemId, side, price, qty }) {
  if (itemId === COIN_ITEM_ID) throw makeErr('cannot_trade_coins');
  const item = await db.first('SELECT id, stackable FROM items WHERE id = ?', [itemId]);
  if (!item) throw makeErr('invalid_item');
  if (side !== SIDE_BUY && side !== SIDE_SELL) throw makeErr('invalid_side');
  if (!Number.isInteger(qty) || qty <= 0) throw makeErr('invalid_qty');
  if (!Number.isInteger(price) || price <= 0) throw makeErr('invalid_price');

  const band = await getPriceBand(db, itemId);
  if (price < band.min || price > band.max) {
    const e = makeErr('price_out_of_band');
    e.band = band;
    throw e;
  }
  return { item, band };
}

// ============================================================
// PLACE ORDER (v2: retira de inventory, no de bank)
// ============================================================

/**
 * Coloca una orden real. v2: mueve coins (buys) o items (sells)
 * desde user_inventory (mochila) al escrow de la orden. NO toca
 * user_bank.
 *
 * Si las coins / items estan distribuidas en varios slots de inv,
 * agrega tomando de los slots con mas qty primero (deja menos slots
 * "huerfanos" con cantidades minusculas).
 *
 * Devuelve { orderId, escrowMoved }.
 *
 * Lanza:
 *   'slots_full'           si ya tiene 8 ordenes abiertas
 *   'insufficient_coins'   si no hay suficientes coins en mochila
 *   'insufficient_items'   si no hay suficientes items en mochila
 *   <los de validateOrderShape>
 */
export async function placeOrder(db, userId, { itemId, side, price, qty }) {
  if (userId === SYSTEM_USER_ID) throw makeErr('use_seed_system_order');

  await validateOrderShape(db, { itemId, side, price, qty });

  const openCount = await countOpenSlots(db, userId);
  if (openCount >= MAX_ORDER_SLOTS_PER_USER) throw makeErr('slots_full');

  const now = Date.now();
  const stmts = [];

  // Qué retirar de la mochila:
  //   - Buy: 'coins' por valor price*qty
  //   - Sell: itemId por qty
  const withdrawItemId = side === SIDE_BUY ? COIN_ITEM_ID : itemId;
  const withdrawQty = side === SIDE_BUY ? price * qty : qty;

  const inv = await loadInventoryState(db, userId);
  const availableInInv = sumInventory(inv, withdrawItemId);
  if (availableInInv < withdrawQty) {
    throw makeErr(side === SIDE_BUY ? 'insufficient_coins' : 'insufficient_items');
  }
  removeFromInventory(stmts, inv, userId, withdrawItemId, withdrawQty, now);

  const coinEscrow = side === SIDE_BUY ? price * qty : 0;
  const itemEscrow = side === SIDE_SELL ? qty : 0;

  stmts.push({
    sql: `INSERT INTO ge_orders
            (user_id, item_id, side, price, qty_total, qty_filled, status,
             coin_escrow, item_escrow, avg_fill_price, coins_recovered,
             pending_coins, pending_items, created_at)
          VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, 0, 0, 0, 0, ?)`,
    params: [userId, itemId, side, price, qty, STATUS_OPEN, coinEscrow, itemEscrow, now],
  });

  await db.batch(stmts);

  const row = await db.first(
    `SELECT id FROM ge_orders
     WHERE user_id = ? AND created_at = ? AND item_id = ? AND side = ?
     ORDER BY id DESC LIMIT 1`,
    [userId, now, itemId, side]
  );

  // Sesión 35 — Match attempt INMEDIATO tras crear la orden. Sin esto, las
  // órdenes quedaban OPEN hasta el siguiente cron tick (hasta 60s después),
  // generando la sensación de "el GE está roto, puse sell y no se ejecuta
  // nada aunque haya buy compatible". El cron sigue corriendo como safety
  // net por si algún edge case dejara orders sin matchear.
  // Race-condition: dos placeOrder concurrentes del mismo item podrían
  // intentar matchear el mismo par. En tráfico actual (tech demo, pocas
  // cuentas) es improbable; si en el futuro vemos doble-fill en logs, mover
  // el matchItem a una queue serializada por item_id.
  try {
    await matchItem(db, itemId);
  } catch (err) {
    console.error('[ge] matchItem after placeOrder failed:', err);
    // No re-throw: la orden ya quedó creada bien, el cron la levantará.
  }

  return { orderId: row.id, escrowMoved: side === SIDE_BUY ? coinEscrow : itemEscrow };
}

// ============================================================
// CANCEL ORDER (v2: escrow restante a pending_*, NO al banco)
// ============================================================

/**
 * Cancela una orden ABIERTA. El escrow remanente se mueve a
 * pending_coins (si era buy) o pending_items (si era sell).
 * El user lo reclamara con claimAll despues.
 *
 * La parte ya matcheada no se devuelve (eso ya esta liquidado;
 * vive en pending_* de esta misma orden, intacto).
 *
 * Para SYSTEM_USER_ID: el escrow simplemente desaparece (no hay
 * pending). Esto es necesario para el reseed: si el cron mata una
 * fantasma obsoleta, el escrow virtual no debe convertirse en deuda.
 *
 * Lanza: 'not_found' | 'not_owned' | 'not_open'
 */
export async function cancelOrder(db, userId, orderId) {
  const order = await db.first('SELECT * FROM ge_orders WHERE id = ?', [orderId]);
  if (!order) throw makeErr('not_found');
  if (order.user_id !== userId) throw makeErr('not_owned');
  if (order.status !== STATUS_OPEN) throw makeErr('not_open');

  const now = Date.now();
  const stmts = [];

  if (userId === SYSTEM_USER_ID) {
    stmts.push({
      sql: `UPDATE ge_orders
              SET status = ?, coin_escrow = 0, item_escrow = 0, completed_at = ?
            WHERE id = ?`,
      params: [STATUS_CANCELLED, now, orderId],
    });
    await db.batch(stmts);
    return { ok: true };
  }

  const deltaPendingCoins = order.side === SIDE_BUY ? order.coin_escrow : 0;
  const deltaPendingItems = order.side === SIDE_SELL ? order.item_escrow : 0;

  stmts.push({
    sql: `UPDATE ge_orders
            SET status = ?, coin_escrow = 0, item_escrow = 0, completed_at = ?,
                pending_coins = pending_coins + ?, pending_items = pending_items + ?
          WHERE id = ?`,
    params: [STATUS_CANCELLED, now, deltaPendingCoins, deltaPendingItems, orderId],
  });

  await db.batch(stmts);
  return { ok: true };
}

// ============================================================
// MATCHING ENGINE
// ============================================================

export async function runMatcher(db) {
  const items = await db.all(
    `SELECT DISTINCT item_id FROM ge_orders WHERE status = ?`,
    [STATUS_OPEN]
  );
  let total = 0;
  const touched = [];
  for (const { item_id } of items) {
    const n = await matchItem(db, item_id);
    if (n > 0) {
      total += n;
      touched.push(item_id);
    }
  }
  return { matches: total, items: touched };
}

export async function matchItem(db, itemId) {
  let matches = 0;

  const buys = await db.all(
    `SELECT * FROM ge_orders
     WHERE item_id = ? AND side = ? AND status = ?
     ORDER BY price DESC, created_at ASC, id ASC`,
    [itemId, SIDE_BUY, STATUS_OPEN]
  );
  const sells = await db.all(
    `SELECT * FROM ge_orders
     WHERE item_id = ? AND side = ? AND status = ?
     ORDER BY price ASC, created_at ASC, id ASC`,
    [itemId, SIDE_SELL, STATUS_OPEN]
  );

  if (buys.length === 0 || sells.length === 0) return 0;

  let bi = 0, si = 0;

  while (bi < buys.length && si < sells.length) {
    const buy = buys[bi];
    const sell = sells[si];

    if (buy.price < sell.price) break;

    if (buy.user_id === sell.user_id) {
      // Self-trade: avanzar sells (consistente con v1).
      si++;
      continue;
    }

    const remainingBuy = buy.qty_total - buy.qty_filled;
    const remainingSell = sell.qty_total - sell.qty_filled;
    const qty = Math.min(remainingBuy, remainingSell);

    const buyOlder = buy.created_at < sell.created_at
      || (buy.created_at === sell.created_at && buy.id < sell.id);
    const matchPrice = buyOlder ? buy.price : sell.price;

    await applyMatch(db, buy, sell, qty, matchPrice);
    matches++;

    // Actualiza snapshot in-memory.
    const buyerReserved = buy.price * qty;
    const buyerSpend = matchPrice * qty;
    const refund = buyerReserved - buyerSpend;
    buy.avg_fill_price = weightedAvg(buy.avg_fill_price, buy.qty_filled, matchPrice, qty);
    buy.qty_filled += qty;
    buy.coin_escrow -= buyerReserved;
    buy.coins_recovered += refund;
    if (buy.user_id !== SYSTEM_USER_ID) {
      buy.pending_items = (buy.pending_items || 0) + qty;
      buy.pending_coins = (buy.pending_coins || 0) + refund;
    }
    sell.avg_fill_price = weightedAvg(sell.avg_fill_price, sell.qty_filled, matchPrice, qty);
    sell.qty_filled += qty;
    sell.item_escrow -= qty;
    if (sell.user_id !== SYSTEM_USER_ID) {
      sell.pending_coins = (sell.pending_coins || 0) + buyerSpend;
    }
    if (buy.qty_filled === buy.qty_total) bi++;
    if (sell.qty_filled === sell.qty_total) si++;
  }

  return matches;
}

/**
 * Liquida un match. v2: NO toca user_bank ni user_inventory. El
 * resultado del match se acumula en pending_coins / pending_items
 * de la propia orden (collection box). El claim lo mueve a un
 * destino elegido por el user despues.
 *
 * Detalle:
 *   buyer  (real): coin_escrow -= buyerReserved
 *                  pending_items += qty
 *                  pending_coins += refund (si matchPrice < buy.price)
 *                  coins_recovered += refund (auditoria historica)
 *   seller (real): item_escrow -= qty
 *                  pending_coins += buyerSpend
 *   buyer  (SYSTEM): solo coin_escrow -= buyerReserved (los items
 *                    virtuales se evaporan)
 *   seller (SYSTEM): solo item_escrow -= qty (los coins virtuales se
 *                    evaporan)
 */
export async function applyMatch(db, buy, sell, qty, matchPrice) {
  const now = Date.now();
  const stmts = [];

  const buyerSpend = matchPrice * qty;
  const buyerReserved = buy.price * qty;
  const refund = buyerReserved - buyerSpend; // >= 0

  // ---- buyer order UPDATE ----
  const newBuyFilled = buy.qty_filled + qty;
  const newBuyEscrow = buy.coin_escrow - buyerReserved;
  const newBuyStatus = newBuyFilled === buy.qty_total ? STATUS_COMPLETED : STATUS_OPEN;
  const newBuyCompletedAt = newBuyStatus === STATUS_COMPLETED ? now : null;
  const newBuyAvg = weightedAvg(buy.avg_fill_price, buy.qty_filled, matchPrice, qty);
  const newBuyRecovered = buy.coins_recovered + refund;

  const buyPendingItemsDelta = buy.user_id === SYSTEM_USER_ID ? 0 : qty;
  const buyPendingCoinsDelta = buy.user_id === SYSTEM_USER_ID ? 0 : refund;

  stmts.push({
    sql: `UPDATE ge_orders
            SET qty_filled = ?, coin_escrow = ?, status = ?, completed_at = ?,
                avg_fill_price = ?, coins_recovered = ?,
                pending_items = pending_items + ?, pending_coins = pending_coins + ?
          WHERE id = ?`,
    params: [newBuyFilled, newBuyEscrow, newBuyStatus, newBuyCompletedAt,
             newBuyAvg, newBuyRecovered,
             buyPendingItemsDelta, buyPendingCoinsDelta, buy.id],
  });

  // ---- seller order UPDATE ----
  const newSellFilled = sell.qty_filled + qty;
  const newSellItemEscrow = sell.item_escrow - qty;
  const newSellStatus = newSellFilled === sell.qty_total ? STATUS_COMPLETED : STATUS_OPEN;
  const newSellCompletedAt = newSellStatus === STATUS_COMPLETED ? now : null;
  const newSellAvg = weightedAvg(sell.avg_fill_price, sell.qty_filled, matchPrice, qty);

  const sellPendingCoinsDelta = sell.user_id === SYSTEM_USER_ID ? 0 : buyerSpend;

  stmts.push({
    sql: `UPDATE ge_orders
            SET qty_filled = ?, item_escrow = ?, status = ?, completed_at = ?,
                avg_fill_price = ?,
                pending_coins = pending_coins + ?
          WHERE id = ?`,
    params: [newSellFilled, newSellItemEscrow, newSellStatus, newSellCompletedAt,
             newSellAvg, sellPendingCoinsDelta, sell.id],
  });

  // ---- historico ----
  stmts.push({
    sql: `INSERT INTO ge_history
            (item_id, buy_order_id, sell_order_id, buyer_id, seller_id,
             matched_price, qty, matched_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    params: [buy.item_id, buy.id, sell.id, buy.user_id, sell.user_id,
             matchPrice, qty, now],
  });

  await db.batch(stmts);
}

// ============================================================
// CLAIM ALL (nuevo en v2)
// ============================================================

/**
 * Reclama TODAS las ordenes del user con pending > 0, llevando el
 * contenido al target indicado ('inventory' | 'bank').
 *
 * - bank: siempre completo.
 * - inventory: por orden, intenta acomodar pending_items + pending_coins
 *   en los slots disponibles. Si no caben, esa orden queda sin reclamar.
 *   Las demas SI se procesan. Atomico por orden.
 *
 * Cuando reclama, mueve a 0 el pending. Si la orden ademas tiene
 * status != OPEN y queda con ambos pending a 0, se le pone claimed_at.
 *
 * Devuelve:
 *   {
 *     claimed: [{ orderId, coins, items, item_id }],
 *     remaining: [{ orderId, coins, items, item_id, reason }],
 *   }
 *
 * reason posible para remaining: 'inventory_full'
 */
export async function claimAll(db, userId, target) {
  if (userId === SYSTEM_USER_ID) throw makeErr('cannot_claim_for_system');
  if (target !== CLAIM_TARGET_INVENTORY && target !== CLAIM_TARGET_BANK) {
    throw makeErr('invalid_claim_target');
  }

  const pendingOrders = await db.all(
    `SELECT * FROM ge_orders
     WHERE user_id = ?
       AND (pending_coins > 0 OR pending_items > 0)
     ORDER BY id ASC`,
    [userId]
  );

  const claimed = [];
  const remaining = [];

  if (pendingOrders.length === 0) return { claimed, remaining };

  // Snapshot del destino mutable a lo largo del bucle.
  let invState = null;
  let bankState = null;
  if (target === CLAIM_TARGET_INVENTORY) invState = await loadInventoryState(db, userId);
  else bankState = await loadBankState(db, userId);

  for (const order of pendingOrders) {
    const pCoins = order.pending_coins;
    const pItems = order.pending_items;

    const deposits = [];
    if (pCoins > 0) deposits.push({ itemId: COIN_ITEM_ID, qty: pCoins, stackable: true });
    if (pItems > 0) {
      const itemMeta = await db.first('SELECT stackable FROM items WHERE id = ?', [order.item_id]);
      deposits.push({
        itemId: order.item_id,
        qty: pItems,
        stackable: !!(itemMeta && itemMeta.stackable),
      });
    }

    if (target === CLAIM_TARGET_INVENTORY) {
      const snapshot = snapshotInventoryState(invState);
      const tentative = [];
      let allFit = true;
      for (const d of deposits) {
        const fit = tryDepositToInventory(tentative, invState, userId, d.itemId, d.qty, d.stackable, Date.now());
        if (!fit) { allFit = false; break; }
      }
      if (!allFit) {
        restoreInventoryState(invState, snapshot);
        remaining.push({
          orderId: order.id,
          coins: pCoins,
          items: pItems,
          item_id: order.item_id,
          reason: 'inventory_full',
        });
        continue;
      }

      const now = Date.now();
      const shouldClaim = order.status !== STATUS_OPEN;
      tentative.push({
        sql: shouldClaim
          ? `UPDATE ge_orders SET pending_coins = 0, pending_items = 0, claimed_at = ? WHERE id = ?`
          : `UPDATE ge_orders SET pending_coins = 0, pending_items = 0 WHERE id = ?`,
        params: shouldClaim ? [now, order.id] : [order.id],
      });

      await db.batch(tentative);
      claimed.push({ orderId: order.id, coins: pCoins, items: pItems, item_id: order.item_id });
    } else {
      // BANK: siempre cabe.
      const stmts = [];
      const now = Date.now();
      for (const d of deposits) {
        addBankDeposit(stmts, bankState, userId, d.itemId, d.qty, now);
      }
      const shouldClaim = order.status !== STATUS_OPEN;
      stmts.push({
        sql: shouldClaim
          ? `UPDATE ge_orders SET pending_coins = 0, pending_items = 0, claimed_at = ? WHERE id = ?`
          : `UPDATE ge_orders SET pending_coins = 0, pending_items = 0 WHERE id = ?`,
        params: shouldClaim ? [now, order.id] : [order.id],
      });
      await db.batch(stmts);
      claimed.push({ orderId: order.id, coins: pCoins, items: pItems, item_id: order.item_id });
    }
  }

  return { claimed, remaining };
}

// ============================================================
// SEED DE LIQUIDEZ FANTASMA
// ============================================================

export async function reseedGhostOrders(db) {
  const configs = await db.all('SELECT * FROM ge_seed_config');
  let inserted = 0;
  const GHOST_TIMESTAMP_FAR_FUTURE = 9_999_999_999_999;

  for (const c of configs) {
    const guideRow = await db.first('SELECT base_price FROM items WHERE id = ?', [c.item_id]);
    if (!guideRow) continue;
    const guide = guideRow.base_price;
    const offset = Math.round((guide * c.price_offset_bps) / BPS_DIVISOR);
    const price = Math.max(1, guide + offset);

    const sumRow = await db.first(
      `SELECT COALESCE(SUM(qty_total - qty_filled), 0) AS open_qty
       FROM ge_orders
       WHERE user_id = ? AND item_id = ? AND side = ? AND status = ?`,
      [SYSTEM_USER_ID, c.item_id, c.side, STATUS_OPEN]
    );
    const openQty = sumRow.open_qty;
    const deficit = c.target_volume - openQty;
    if (deficit <= 0) continue;

    const coinEscrow = c.side === SIDE_BUY  ? price * deficit : 0;
    const itemEscrow = c.side === SIDE_SELL ? deficit         : 0;

    await db.run(
      `INSERT INTO ge_orders
         (user_id, item_id, side, price, qty_total, qty_filled, status,
          coin_escrow, item_escrow, avg_fill_price, coins_recovered,
          pending_coins, pending_items, created_at)
       VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, 0, 0, 0, 0, ?)`,
      [SYSTEM_USER_ID, c.item_id, c.side, price, deficit, STATUS_OPEN,
       coinEscrow, itemEscrow, GHOST_TIMESTAMP_FAR_FUTURE]
    );
    inserted++;
  }
  return { inserted };
}

// ============================================================
// HELPERS DE USO INTERNO
// ============================================================

export async function countOpenSlots(db, userId) {
  const row = await db.first(
    'SELECT COUNT(*) AS n FROM ge_orders WHERE user_id = ? AND status = ?',
    [userId, STATUS_OPEN]
  );
  return row?.n ?? 0;
}

// ----- INVENTORY HELPERS -----

export async function loadInventoryState(db, userId) {
  const rows = await db.all(
    `SELECT inv.slot_index, inv.item_id, inv.quantity, i.stackable
     FROM user_inventory inv
     LEFT JOIN items i ON i.id = inv.item_id
     WHERE inv.user_id = ?`,
    [userId]
  );
  const slots = new Array(INVENTORY_SLOT_COUNT).fill(null);
  for (const r of rows) {
    if (r.slot_index < 0 || r.slot_index >= INVENTORY_SLOT_COUNT) continue;
    slots[r.slot_index] = {
      item_id: r.item_id,
      quantity: r.quantity,
      stackable: !!r.stackable,
    };
  }
  return { slots };
}

export function snapshotInventoryState(state) {
  return { slots: state.slots.map(s => s ? { ...s } : null) };
}

export function restoreInventoryState(state, snapshot) {
  for (let i = 0; i < INVENTORY_SLOT_COUNT; i++) {
    state.slots[i] = snapshot.slots[i] ? { ...snapshot.slots[i] } : null;
  }
}

export function sumInventory(state, itemId) {
  let total = 0;
  for (const s of state.slots) {
    if (s && s.item_id === itemId) total += s.quantity;
  }
  return total;
}

/**
 * Retira qty unidades de itemId del inventario. Toma de los slots
 * con MAYOR qty primero. Asume que sumInventory >= qty (validar antes).
 */
export function removeFromInventory(stmts, state, userId, itemId, qty, now) {
  const candidates = [];
  for (let i = 0; i < INVENTORY_SLOT_COUNT; i++) {
    const s = state.slots[i];
    if (s && s.item_id === itemId) candidates.push(i);
  }
  candidates.sort((a, b) => state.slots[b].quantity - state.slots[a].quantity);

  let toRemove = qty;
  for (const idx of candidates) {
    if (toRemove <= 0) break;
    const s = state.slots[idx];
    const take = Math.min(toRemove, s.quantity);
    if (take === s.quantity) {
      stmts.push({
        sql: 'DELETE FROM user_inventory WHERE user_id = ? AND slot_index = ?',
        params: [userId, idx],
      });
      state.slots[idx] = null;
    } else {
      stmts.push({
        sql: 'UPDATE user_inventory SET quantity = quantity - ?, updated_at = ? WHERE user_id = ? AND slot_index = ?',
        params: [take, now, userId, idx],
      });
      s.quantity -= take;
    }
    toRemove -= take;
  }
  if (toRemove > 0) {
    throw makeErr('insufficient_inventory_consistency');
  }
}

/**
 * Intenta depositar qty unidades de itemId en el inventario.
 * - Stackable: apila en el primer slot existente con ese item; si no
 *   existe, crea uno nuevo en el primer slot libre.
 * - No stackable: necesita `qty` slots libres y crea uno por unidad.
 *
 * Devuelve true si encaja entero, false si no.
 */
export function tryDepositToInventory(stmts, state, userId, itemId, qty, stackable, now) {
  if (stackable) {
    for (let i = 0; i < INVENTORY_SLOT_COUNT; i++) {
      const s = state.slots[i];
      if (s && s.item_id === itemId) {
        stmts.push({
          sql: 'UPDATE user_inventory SET quantity = quantity + ?, updated_at = ? WHERE user_id = ? AND slot_index = ?',
          params: [qty, now, userId, i],
        });
        s.quantity += qty;
        return true;
      }
    }
    for (let i = 0; i < INVENTORY_SLOT_COUNT; i++) {
      if (state.slots[i] === null) {
        stmts.push({
          sql: 'INSERT INTO user_inventory (user_id, slot_index, item_id, quantity, updated_at) VALUES (?, ?, ?, ?, ?)',
          params: [userId, i, itemId, qty, now],
        });
        state.slots[i] = { item_id: itemId, quantity: qty, stackable: true };
        return true;
      }
    }
    return false;
  }

  // No stackable: necesita qty slots libres (no contiguos).
  const freeSlots = [];
  for (let i = 0; i < INVENTORY_SLOT_COUNT; i++) {
    if (state.slots[i] === null) freeSlots.push(i);
    if (freeSlots.length >= qty) break;
  }
  if (freeSlots.length < qty) return false;

  for (let k = 0; k < qty; k++) {
    const idx = freeSlots[k];
    stmts.push({
      sql: 'INSERT INTO user_inventory (user_id, slot_index, item_id, quantity, updated_at) VALUES (?, ?, ?, ?, ?)',
      params: [userId, idx, itemId, 1, now],
    });
    state.slots[idx] = { item_id: itemId, quantity: 1, stackable: false };
  }
  return true;
}

// ----- BANK HELPERS -----

export async function loadBankState(db, userId) {
  const rows = await db.all(
    'SELECT slot_index, item_id, quantity FROM user_bank WHERE user_id = ?',
    [userId]
  );
  const byItemId = new Map();
  let maxSlot = -1;
  for (const r of rows) {
    byItemId.set(r.item_id, { slot_index: r.slot_index, quantity: r.quantity });
    if (r.slot_index > maxSlot) maxSlot = r.slot_index;
  }
  return { byItemId, nextSlot: maxSlot + 1 };
}

export function addBankDeposit(stmts, state, userId, itemId, qty, now) {
  const existing = state.byItemId.get(itemId);
  if (existing) {
    stmts.push({
      sql: 'UPDATE user_bank SET quantity = quantity + ?, updated_at = ? WHERE user_id = ? AND item_id = ?',
      params: [qty, now, userId, itemId],
    });
    existing.quantity += qty;
  } else {
    const slot = state.nextSlot;
    stmts.push({
      sql: 'INSERT INTO user_bank (user_id, slot_index, item_id, quantity, updated_at) VALUES (?, ?, ?, ?, ?)',
      params: [userId, slot, itemId, qty, now],
    });
    state.byItemId.set(itemId, { slot_index: slot, quantity: qty });
    state.nextSlot = slot + 1;
  }
}

// ----- OTROS -----

export function weightedAvg(prevAvg, prevQty, newPrice, newQty) {
  if (prevQty === 0) return newPrice;
  return ((prevAvg * prevQty) + (newPrice * newQty)) / (prevQty + newQty);
}

export function makeErr(code) {
  const e = new Error(code);
  e.code = code;
  return e;
}
