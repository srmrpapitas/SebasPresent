/**
 * SebasPresent — Grand Exchange Engine (Slice 4c)
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
 * En el worker, un adapter envuelve env.DB y traduce a esta
 * interfaz. En tests, otro adapter envuelve sqlite3 nativo de
 * Python via child_process o un binding directo en JS (Node).
 *
 * En este proyecto los tests viven en Python (igual que slice 4b
 * con sus 34 asserts) y replican esta logica de forma paralela.
 * Por eso este archivo esta cuidadosamente comentado: la version
 * Python lee la logica de aqui y la reproduce.
 *
 * NOTA ARQUITECTONICA SOBRE EL HUB Y LOS NPCs (slice 6):
 * ======================================================
 * El GE en el juego sera una ESTRUCTURA FISICA en el hub,
 * accesible interactuando con su NPC (al estilo OSRS). Hoy
 * exponemos la UI mediante un tab temporal del sidebar; en
 * slice 6 el mismo modulo `ge.js` se abrira desde el handler
 * de "interactuar con NPC del GE". La logica de este engine
 * no cambia un bit por venir de un sitio u otro.
 *
 * Igual que el GE en OSRS tiene acceso directo al banco
 * integrado en su panel (no hace falta correr al banquero),
 * en slice C disenamos la UI del GE con una pestana/columna
 * de banco lateral.
 *
 * INVARIANTES
 * ===========
 *
 * I1. Coin escrow (buys):
 *     Para toda orden buy abierta:
 *       coin_escrow == (qty_total - qty_filled) * price
 *
 * I2. Item escrow (sells):
 *     Para toda orden sell abierta:
 *       item_escrow == (qty_total - qty_filled)
 *
 * I3. Maker-takes-price:
 *     Cuando una orden nueva (taker) cruza una existente (maker),
 *     el precio del match es el del maker. Si llega una sell a 90
 *     contra una buy preexistente a 100, match a 100. El buyer
 *     pago 100 al escrow y se le devuelven 0 (el seller cobra 100).
 *     Si fuera al reves (buy nueva a 100 contra sell preexistente
 *     a 90), match a 90: el buyer recupera 10 por unidad al banco.
 *
 * I4. No self-trade:
 *     buy.user_id != sell.user_id. Si solo quedan candidatos del
 *     mismo user (incluyendo system contra system), salta esa
 *     pareja y busca la siguiente.
 *
 * I5. Fairness:
 *     A precios iguales gana created_at ASC. Las ordenes fantasma
 *     se siembran con created_at retrasado para que cualquier
 *     orden real las venza siempre.
 *
 * I6. Atomicidad:
 *     Cada match (que toca dos ordenes, dos balances de bank y
 *     una fila de historia) se ejecuta en un solo db.batch.
 *     No hay estado inconsistente intermedio.
 */

export const SYSTEM_USER_ID = 0;
export const SIDE_BUY = 0;
export const SIDE_SELL = 1;
export const STATUS_OPEN = 0;
export const STATUS_COMPLETED = 1;
export const STATUS_CANCELLED = 2;
export const COIN_ITEM_ID = 'coins';
export const MAX_ORDER_SLOTS_PER_USER = 8;

// Banda de precio por defecto: +/-5% sobre precio guia (igual que OSRS).
// Floor minimo: 5gp absolutos para que items baratos no queden con bandas
// microscopicas (ej: 50gp +- 5% = 47..53 si no, queda 48..52 y un sell
// "razonable" a 53 ya no pasa). OSRS hace algo parecido con items low-cost.
export const PRICE_BAND_BPS = 500;
export const PRICE_BAND_FLOOR_ABS = 5;
const BPS_DIVISOR = 10_000;

// ============================================================
// PRECIO GUIA Y BANDAS
// ============================================================

/**
 * Precio guia "estable" para CALCULAR LA BANDA. NO usa los
 * best_bid/best_ask del libro abierto (esos son manipulables
 * trivialmente: el propio actor podria mover la banda contra si
 * mismo metiendo una orden extrema).
 *
 * Cascada:
 *  1. Media ponderada por qty de matches en las ultimas 24h.
 *  2. Si no hay matches, base_price del catalogo.
 *
 * Esto es lo que define "que precios estan permitidos" para
 * nuevas ordenes. Los precios reales de mercado los reflejan
 * los best_bid/ask en el endpoint /api/ge/item/:id, pero esos
 * no controlan la banda.
 */
export async function getGuidePrice(db, itemId) {
  const item = await db.first(
    'SELECT base_price FROM items WHERE id = ?',
    [itemId]
  );
  if (!item) throw makeErr('unknown_item');

  const since = Date.now() - 24 * 60 * 60 * 1000;
  const recent = await db.first(
    `SELECT SUM(matched_price * qty) AS num, SUM(qty) AS den
     FROM ge_history
     WHERE item_id = ? AND matched_at >= ?`,
    [itemId, since]
  );
  if (recent && recent.den) {
    return Math.round(recent.num / recent.den);
  }
  return item.base_price;
}

/**
 * Precio SUGERIDO al usuario en la UI cuando va a colocar una
 * orden. Refleja el mercado actual: mid-price de mejor bid/ask
 * si hay; si no, fallback al guide_price.
 *
 * Esto NO se usa para validar bandas, solo para mostrar.
 */
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

/** Devuelve { guide, min, max } inclusive sobre el precio guia. */
export async function getPriceBand(db, itemId, bps = PRICE_BAND_BPS) {
  const guide = await getGuidePrice(db, itemId);
  const pctDelta = Math.round((guide * bps) / BPS_DIVISOR);
  const delta = Math.max(PRICE_BAND_FLOOR_ABS, pctDelta);
  return {
    guide,
    min: Math.max(1, guide - delta),
    max: guide + delta,
  };
}

// ============================================================
// VALIDACION DE ORDEN
// ============================================================

/**
 * Valida campos basicos y banda de precio. NO toca escrow ni inserta.
 * Lanza con .code: 'invalid_item' | 'invalid_side' | 'invalid_qty' |
 *   'invalid_price' | 'price_out_of_band' | 'cannot_trade_coins'
 */
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
// PLACE ORDER
// ============================================================

/**
 * Coloca una orden real para un user humano. Mueve coins (buys)
 * o items (sells) desde user_bank al escrow de la orden.
 *
 * Devuelve { orderId, escrowMoved }.
 *
 * Lanza:
 *   'slots_full'           si ya tiene 8 ordenes abiertas
 *   'insufficient_coins'   si no hay suficiente en user_bank coins
 *   'insufficient_items'   si no hay suficiente en user_bank del item
 *   <los de validateOrderShape>
 *
 * NO hace matching aqui. El matcher corre como cron aparte.
 */
export async function placeOrder(db, userId, { itemId, side, price, qty }) {
  if (userId === SYSTEM_USER_ID) {
    // Para ordenes del sistema usar seedSystemOrder.
    throw makeErr('use_seed_system_order');
  }

  await validateOrderShape(db, { itemId, side, price, qty });

  const openCount = await countOpenSlots(db, userId);
  if (openCount >= MAX_ORDER_SLOTS_PER_USER) throw makeErr('slots_full');

  const now = Date.now();
  const stmts = [];

  if (side === SIDE_BUY) {
    const cost = price * qty;
    const coinsRow = await db.first(
      'SELECT slot_index, quantity FROM user_bank WHERE user_id = ? AND item_id = ?',
      [userId, COIN_ITEM_ID]
    );
    if (!coinsRow || coinsRow.quantity < cost) throw makeErr('insufficient_coins');

    if (coinsRow.quantity === cost) {
      stmts.push({
        sql: 'DELETE FROM user_bank WHERE user_id = ? AND item_id = ?',
        params: [userId, COIN_ITEM_ID],
      });
    } else {
      stmts.push({
        sql: 'UPDATE user_bank SET quantity = quantity - ?, updated_at = ? WHERE user_id = ? AND item_id = ?',
        params: [cost, now, userId, COIN_ITEM_ID],
      });
    }

    stmts.push({
      sql: `INSERT INTO ge_orders
              (user_id, item_id, side, price, qty_total, qty_filled, status,
               coin_escrow, item_escrow, avg_fill_price, coins_recovered, created_at)
            VALUES (?, ?, ?, ?, ?, 0, ?, ?, 0, 0, 0, ?)`,
      params: [userId, itemId, SIDE_BUY, price, qty, STATUS_OPEN, cost, now],
    });

    await db.batch(stmts);
    const row = await db.first(
      `SELECT id FROM ge_orders WHERE user_id = ? AND created_at = ? AND item_id = ? AND side = ?
       ORDER BY id DESC LIMIT 1`,
      [userId, now, itemId, SIDE_BUY]
    );
    return { orderId: row.id, escrowMoved: cost };
  }

  // SIDE_SELL
  const itemRow = await db.first(
    'SELECT slot_index, quantity FROM user_bank WHERE user_id = ? AND item_id = ?',
    [userId, itemId]
  );
  if (!itemRow || itemRow.quantity < qty) throw makeErr('insufficient_items');

  if (itemRow.quantity === qty) {
    stmts.push({
      sql: 'DELETE FROM user_bank WHERE user_id = ? AND item_id = ?',
      params: [userId, itemId],
    });
  } else {
    stmts.push({
      sql: 'UPDATE user_bank SET quantity = quantity - ?, updated_at = ? WHERE user_id = ? AND item_id = ?',
      params: [qty, now, userId, itemId],
    });
  }

  stmts.push({
    sql: `INSERT INTO ge_orders
            (user_id, item_id, side, price, qty_total, qty_filled, status,
             coin_escrow, item_escrow, avg_fill_price, coins_recovered, created_at)
          VALUES (?, ?, ?, ?, ?, 0, ?, 0, ?, 0, 0, ?)`,
    params: [userId, itemId, SIDE_SELL, price, qty, STATUS_OPEN, qty, now],
  });

  await db.batch(stmts);
  const row = await db.first(
    `SELECT id FROM ge_orders WHERE user_id = ? AND created_at = ? AND item_id = ? AND side = ?
     ORDER BY id DESC LIMIT 1`,
    [userId, now, itemId, SIDE_SELL]
  );
  return { orderId: row.id, escrowMoved: qty };
}

// ============================================================
// CANCEL ORDER
// ============================================================

/**
 * Cancela una orden ABIERTA del usuario. Devuelve coins/items
 * remanentes al user_bank. La parte ya matcheada NO se devuelve
 * (eso ya esta liquidado).
 *
 * Lanza: 'not_found' | 'not_owned' | 'not_open'
 */
export async function cancelOrder(db, userId, orderId) {
  const order = await db.first(
    'SELECT * FROM ge_orders WHERE id = ?',
    [orderId]
  );
  if (!order) throw makeErr('not_found');
  if (order.user_id !== userId) throw makeErr('not_owned');
  if (order.status !== STATUS_OPEN) throw makeErr('not_open');

  const now = Date.now();
  const stmts = [];

  if (order.side === SIDE_BUY && order.coin_escrow > 0) {
    addToBank(stmts, userId, COIN_ITEM_ID, order.coin_escrow, now);
  } else if (order.side === SIDE_SELL && order.item_escrow > 0) {
    addToBank(stmts, userId, order.item_id, order.item_escrow, now);
  }

  stmts.push({
    sql: `UPDATE ge_orders
            SET status = ?, coin_escrow = 0, item_escrow = 0, completed_at = ?
          WHERE id = ?`,
    params: [STATUS_CANCELLED, now, orderId],
  });

  await db.batch(stmts);
  return { ok: true };
}

// ============================================================
// MATCHING ENGINE
// ============================================================

/**
 * Corre una pasada del matcher sobre TODOS los items con
 * actividad. Llamable desde cron (cada 30s) o tests.
 *
 * Devuelve { matches: number, items: string[] } para logging.
 */
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

/**
 * Corre el matcher para UN item. Cruza pares hasta que ya no se
 * pueda. Devuelve el numero de matches insertados en ge_history.
 *
 * Algoritmo (libro de ordenes single-item):
 *   1. Carga mejor buy abierta (mayor precio, tiebreak created_at ASC).
 *   2. Carga mejor sell abierta (menor precio, tiebreak created_at ASC).
 *   3. Si buy.price >= sell.price y user_id distintos: hay match.
 *      - qty = min(qty_remaining buy, qty_remaining sell)
 *      - precio = el de la orden MAS ANTIGUA (maker).
 *      - Aplica el match (escrow, balances, history, refund si procede).
 *   4. Si user_id iguales o no hay cruce: saltar uno y reintentar
 *      con el siguiente candidato (deeper book).
 *   5. Termina cuando no hay mas pares cruzables.
 *
 * Implementacion: cargamos ambos libros en memoria al principio y
 * trabajamos sobre el. Para un solo item, en alpha el libro va a
 * ser pequen~o (<100 ordenes). Si crece, se paginariia.
 */
export async function matchItem(db, itemId) {
  let matches = 0;

  // Cargamos snapshot del libro abierto.
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

  // Indices en memoria. Mutamos qty_filled en estos objetos a
  // medida que matcheamos, pero los UPDATEs reales van por DB
  // dentro de cada match (en su batch atomico). Si en un futuro
  // queremos optimizar haremos un solo batch al final.
  let bi = 0, si = 0;

  while (bi < buys.length && si < sells.length) {
    const buy = buys[bi];
    const sell = sells[si];

    // Sin cruce posible: el spread ya no esta cruzado.
    if (buy.price < sell.price) break;

    // Self-trade: avanzar el mas reciente (con createdAt mayor)
    // porque es el que probablemente quiera "matar" su propia
    // pasiva. Estrategia simple: avanzar SELLS (arbitrario pero
    // consistente). Igualmente, en este caso especifico no
    // matcheamos NADA y avanzamos uno: si avanzamos sells y
    // dentro de un rato vuelve a chocar, ya pasara.
    if (buy.user_id === sell.user_id) {
      // Avanzamos el del lado menos critico: si el buyer es
      // "ofensivo" (price alta) probablemente tiene mas opciones
      // de cruzarse con otras sells. Avanzamos sells para no
      // bloquear al buyer.
      si++;
      continue;
    }

    const remainingBuy = buy.qty_total - buy.qty_filled;
    const remainingSell = sell.qty_total - sell.qty_filled;
    const qty = Math.min(remainingBuy, remainingSell);

    // Precio: el del maker (created_at ASC, el mas antiguo).
    // Si el buy es mas viejo, precio = buy.price. Si el sell es
    // mas viejo, precio = sell.price. Empates resueltos por id
    // (created_at en milisegundos puede colisionar).
    const buyOlder = buy.created_at < sell.created_at
      || (buy.created_at === sell.created_at && buy.id < sell.id);
    const matchPrice = buyOlder ? buy.price : sell.price;

    await applyMatch(db, buy, sell, qty, matchPrice);
    matches++;

    // Actualiza snapshot in-memory para que el siguiente applyMatch lea
    // los valores actualizados (no solo qty_filled). Esto refleja en
    // memoria lo que ya esta persistido en DB tras applyMatch.
    const buyerReserved = buy.price * qty;
    const buyerSpend = matchPrice * qty;
    const refund = buyerReserved - buyerSpend;
    buy.avg_fill_price = weightedAvg(buy.avg_fill_price, buy.qty_filled, matchPrice, qty);
    buy.qty_filled += qty;
    buy.coin_escrow -= buyerReserved;
    buy.coins_recovered += refund;
    sell.avg_fill_price = weightedAvg(sell.avg_fill_price, sell.qty_filled, matchPrice, qty);
    sell.qty_filled += qty;
    sell.item_escrow -= qty;
    if (buy.qty_filled === buy.qty_total) bi++;
    if (sell.qty_filled === sell.qty_total) si++;
  }

  return matches;
}

/**
 * Liquida un match concreto: actualiza ambas ordenes, mueve
 * coins/items, inserta ge_history. Todo en un solo batch.
 *
 * Detalle de saldos:
 *   buyer:  - gasta matchPrice*qty (del coin_escrow ya bloqueado)
 *           - si buy.price > matchPrice, recupera diff*qty al banco
 *           - recibe qty del item al banco
 *   seller: - entrega qty del item (del item_escrow ya bloqueado)
 *           - recibe matchPrice*qty coins al banco
 *
 * Para SYSTEM_USER_ID, NO se toca user_bank: las coins/items se
 * generan o destruyen virtualmente. El registro en ge_history sigue
 * existiendo para grafico de precio.
 *
 * IMPLEMENTACION:
 * Pre-leemos el banco de buyer y seller para calcular slot_index
 * concretos. Esto evita la trampa de tener dos INSERTs en el mismo
 * batch que compitan por el mismo MAX(slot_index)+1 (lo que pasaria
 * si el buyer recibe item + refund de coins y NINGUNO de los dos
 * existe ya en su banco).
 */
async function applyMatch(db, buy, sell, qty, matchPrice) {
  const now = Date.now();
  const stmts = [];

  const buyerSpend = matchPrice * qty;
  const buyerReserved = buy.price * qty;
  const refund = buyerReserved - buyerSpend; // siempre >= 0

  // ---- Pre-lectura de bancos (solo de users reales) ----
  let buyerBank = null;
  let sellerBank = null;
  if (buy.user_id !== SYSTEM_USER_ID) {
    buyerBank = await loadBankState(db, buy.user_id);
  }
  if (sell.user_id !== SYSTEM_USER_ID) {
    // Si buyer y seller son el MISMO user, lo cual no deberia pasar
    // (el matcher filtra self-trade) pero por defensividad reusamos.
    sellerBank = (sell.user_id === buy.user_id) ? buyerBank : await loadBankState(db, sell.user_id);
  }

  // ---- buyer order UPDATE ----
  const newBuyFilled = buy.qty_filled + qty;
  const newBuyEscrow = buy.coin_escrow - buyerReserved;
  const newBuyStatus = newBuyFilled === buy.qty_total ? STATUS_COMPLETED : STATUS_OPEN;
  const newBuyCompletedAt = newBuyStatus === STATUS_COMPLETED ? now : null;
  const newBuyAvg = weightedAvg(buy.avg_fill_price, buy.qty_filled, matchPrice, qty);
  const newBuyRecovered = buy.coins_recovered + refund;

  stmts.push({
    sql: `UPDATE ge_orders
            SET qty_filled = ?, coin_escrow = ?, status = ?, completed_at = ?,
                avg_fill_price = ?, coins_recovered = ?
          WHERE id = ?`,
    params: [newBuyFilled, newBuyEscrow, newBuyStatus, newBuyCompletedAt,
             newBuyAvg, newBuyRecovered, buy.id],
  });

  // ---- buyer bank deposits ----
  if (buyerBank) {
    addBankDeposit(stmts, buyerBank, buy.user_id, buy.item_id, qty, now);
    if (refund > 0) {
      addBankDeposit(stmts, buyerBank, buy.user_id, COIN_ITEM_ID, refund, now);
    }
  }

  // ---- seller order UPDATE ----
  const newSellFilled = sell.qty_filled + qty;
  const newSellItemEscrow = sell.item_escrow - qty;
  const newSellStatus = newSellFilled === sell.qty_total ? STATUS_COMPLETED : STATUS_OPEN;
  const newSellCompletedAt = newSellStatus === STATUS_COMPLETED ? now : null;
  const newSellAvg = weightedAvg(sell.avg_fill_price, sell.qty_filled, matchPrice, qty);

  stmts.push({
    sql: `UPDATE ge_orders
            SET qty_filled = ?, item_escrow = ?, status = ?, completed_at = ?,
                avg_fill_price = ?
          WHERE id = ?`,
    params: [newSellFilled, newSellItemEscrow, newSellStatus, newSellCompletedAt,
             newSellAvg, sell.id],
  });

  // ---- seller bank deposit (coins) ----
  if (sellerBank) {
    addBankDeposit(stmts, sellerBank, sell.user_id, COIN_ITEM_ID, buyerSpend, now);
  }

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
// SEED DE LIQUIDEZ FANTASMA
// ============================================================

/**
 * Repone ordenes fantasma del sistema para mantener un mercado
 * minimo. Para cada item con seed_config, cuenta cuanta qty
 * abierta hay con user_id=SYSTEM, y si esta por debajo del
 * target, anade una orden grande hasta llegar al target.
 *
 * Las fantasmas se siembran con created_at en el LEJANO FUTURO.
 * Por que: el matcher ordena por (price, created_at ASC), asi
 * que un created_at alto pone las fantasmas SIEMPRE al final del
 * libro. Cualquier orden real (con created_at <= Date.now()) las
 * vence en el tiebreak de precio igual. Esto cumple el objetivo
 * de que las fantasmas sean FALLBACK de liquidez: si hay un real
 * para cruzar, gana el real. Si no, sirve la fantasma.
 *
 * Llamado desde el mismo cron del matcher.
 */
export async function reseedGhostOrders(db) {
  const configs = await db.all('SELECT * FROM ge_seed_config');
  let inserted = 0;
  // Año ~2286 en milisegundos. Cualquier orden real (todas con
  // Date.now() de la ventana de explotacion del juego) tendra
  // created_at mucho menor y vencera en tiebreak.
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

    // Las fantasmas tienen escrow CONTABLE igual que las reales,
    // aunque no respalde nada real. Es para mantener I1/I2 sanas
    // y que el apply_match no necesite branch especial.
    const coinEscrow = c.side === SIDE_BUY  ? price * deficit : 0;
    const itemEscrow = c.side === SIDE_SELL ? deficit         : 0;

    await db.run(
      `INSERT INTO ge_orders
         (user_id, item_id, side, price, qty_total, qty_filled, status,
          coin_escrow, item_escrow, avg_fill_price, coins_recovered, created_at)
       VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, 0, 0, ?)`,
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

/**
 * Carga el estado actual del banco de un usuario como un mapa.
 *
 * Devuelve:
 *   {
 *     byItemId: Map<item_id, { slot_index, quantity }>,
 *     nextSlot: int  // siguiente slot_index libre (MAX+1 o 0 si vacio)
 *   }
 *
 * Se llama UNA VEZ al inicio de applyMatch/cancelOrder, y luego
 * `addBankDeposit` muta este objeto para reflejar los stmts que
 * estamos construyendo. Esto evita la trampa de tener dos INSERTs
 * en el mismo batch que compitan por el mismo MAX(slot_index)+1.
 */
async function loadBankState(db, userId) {
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

/**
 * Anade un deposito al banco. Si el item ya existe, UPDATE.
 * Si no, INSERT en `nextSlot` y avanza el contador del state.
 *
 * NO ejecuta: anade un stmt a `stmts` y muta `state` para que
 * llamadas subsiguientes vean el banco "como si" ya hubiera
 * pasado este stmt.
 */
function addBankDeposit(stmts, state, userId, itemId, qty, now) {
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

/** Media ponderada para avg_fill_price. */
function weightedAvg(prevAvg, prevQty, newPrice, newQty) {
  if (prevQty === 0) return newPrice;
  return ((prevAvg * prevQty) + (newPrice * newQty)) / (prevQty + newQty);
}

function makeErr(code) {
  const e = new Error(code);
  e.code = code;
  return e;
}
