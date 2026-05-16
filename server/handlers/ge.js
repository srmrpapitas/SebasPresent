/**
 * SebasPresent — Grand Exchange handlers (Slice 4c v2)
 * Endpoints: /api/ge/*
 *
 * Toda la lógica (matcher, price band, escrow) vive en ge_engine.js.
 * Estos handlers solo orquestan: auth, parse body, llamar al engine,
 * formatear respuesta.
 */

import { json, readJson, makeDbAdapter, geErrorResponse } from '../lib/db.js';
import { requireSession } from '../lib/auth.js';
import {
  placeOrder, cancelOrder, claimAll,
  getGuidePrice, getSuggestedPrice, getPriceBand,
  SIDE_BUY, SIDE_SELL,
  STATUS_OPEN, STATUS_COMPLETED, STATUS_CANCELLED,
  COIN_ITEM_ID, MAX_ORDER_SLOTS_PER_USER,
} from '../ge_engine.js';

export async function handleGeGetOrders(request, env) {
  const session = await requireSession(request, env);
  if (!session) return json({ error: 'unauthorized' }, 401);

  const db = makeDbAdapter(env);
  const userId = session.user_id;

  const open = await db.all(
    `SELECT o.id, o.item_id, o.side, o.price, o.qty_total, o.qty_filled,
            o.status, o.coin_escrow, o.item_escrow, o.avg_fill_price,
            o.coins_recovered, o.pending_coins, o.pending_items,
            o.created_at, o.completed_at, o.claimed_at,
            i.name, i.icon, i.stackable
     FROM ge_orders o
     JOIN items i ON i.id = o.item_id
     WHERE o.user_id = ? AND o.status = ?
     ORDER BY o.created_at ASC`,
    [userId, STATUS_OPEN]
  );

  const collection = await db.all(
    `SELECT o.id, o.item_id, o.side, o.price, o.qty_total, o.qty_filled,
            o.status, o.avg_fill_price, o.coins_recovered,
            o.pending_coins, o.pending_items,
            o.created_at, o.completed_at, o.claimed_at,
            i.name, i.icon, i.stackable
     FROM ge_orders o
     JOIN items i ON i.id = o.item_id
     WHERE o.user_id = ? AND o.status IN (?, ?)
       AND (o.pending_coins > 0 OR o.pending_items > 0)
     ORDER BY o.completed_at DESC`,
    [userId, STATUS_COMPLETED, STATUS_CANCELLED]
  );

  const since = Date.now() - 24 * 60 * 60 * 1000;
  const recent = await db.all(
    `SELECT o.id, o.item_id, o.side, o.price, o.qty_total, o.qty_filled,
            o.status, o.avg_fill_price, o.coins_recovered,
            o.created_at, o.completed_at, o.claimed_at,
            i.name, i.icon, i.stackable
     FROM ge_orders o
     JOIN items i ON i.id = o.item_id
     WHERE o.user_id = ? AND o.status IN (?, ?)
       AND o.pending_coins = 0 AND o.pending_items = 0
       AND o.claimed_at >= ?
     ORDER BY o.claimed_at DESC
     LIMIT 20`,
    [userId, STATUS_COMPLETED, STATUS_CANCELLED, since]
  );

  const totalsRows = await db.all(
    `SELECT o.item_id,
            SUM(o.pending_coins) AS pc,
            SUM(o.pending_items) AS pi
     FROM ge_orders o
     WHERE o.user_id = ? AND (o.pending_coins > 0 OR o.pending_items > 0)
     GROUP BY o.item_id`,
    [userId]
  );
  let totalCoins = 0;
  const itemsBy = {};
  for (const r of totalsRows) {
    totalCoins += r.pc || 0;
    if (r.pi > 0) itemsBy[r.item_id] = (itemsBy[r.item_id] || 0) + r.pi;
  }

  return json({
    open,
    collection,
    recent,
    totals: {
      pending_coins: totalCoins,
      pending_items_by_id: itemsBy,
    },
    maxSlots: MAX_ORDER_SLOTS_PER_USER,
  });
}

export async function handleGePlace(request, env) {
  const session = await requireSession(request, env);
  if (!session) return json({ error: 'unauthorized' }, 401);

  const body = await readJson(request);
  if (!body) return json({ error: 'bad_request' }, 400);

  let side;
  if (body.side === 'buy' || body.side === 0) side = SIDE_BUY;
  else if (body.side === 'sell' || body.side === 1) side = SIDE_SELL;
  else return json({ error: 'invalid_side', message: 'side debe ser "buy" o "sell".' }, 400);

  const db = makeDbAdapter(env);
  try {
    const result = await placeOrder(db, session.user_id, {
      itemId: body.item_id,
      side,
      price: body.price,
      qty: body.qty,
    });
    return json({ orderId: result.orderId, escrowMoved: result.escrowMoved });
  } catch (err) {
    return geErrorResponse(err);
  }
}

export async function handleGeCancel(request, env) {
  const session = await requireSession(request, env);
  if (!session) return json({ error: 'unauthorized' }, 401);

  const body = await readJson(request);
  if (!body || !Number.isInteger(body.order_id)) return json({ error: 'bad_request' }, 400);

  const db = makeDbAdapter(env);
  try {
    await cancelOrder(db, session.user_id, body.order_id);
    return json({ ok: true });
  } catch (err) {
    return geErrorResponse(err);
  }
}

export async function handleGeClaimAll(request, env) {
  const session = await requireSession(request, env);
  if (!session) return json({ error: 'unauthorized' }, 401);

  const body = await readJson(request);
  if (!body || typeof body.target !== 'string') return json({ error: 'bad_request' }, 400);

  const db = makeDbAdapter(env);
  try {
    const result = await claimAll(db, session.user_id, body.target);
    return json(result);
  } catch (err) {
    return geErrorResponse(err);
  }
}

export async function handleGeItemInfo(request, env, itemId) {
  const session = await requireSession(request, env);
  if (!session) return json({ error: 'unauthorized' }, 401);
  if (!itemId) return json({ error: 'bad_request' }, 400);

  const db = makeDbAdapter(env);
  try {
    const item = await db.first(
      'SELECT id, name, icon, stackable, base_price FROM items WHERE id = ?',
      [itemId]
    );
    if (!item) return json({ error: 'unknown_item' }, 404);

    const guide = await getGuidePrice(db, itemId);
    const suggested = await getSuggestedPrice(db, itemId);
    const band = await getPriceBand(db, itemId);
    const bestBuy = await db.first(
      `SELECT price FROM ge_orders WHERE item_id = ? AND side = ? AND status = ?
       ORDER BY price DESC, created_at ASC LIMIT 1`,
      [itemId, SIDE_BUY, STATUS_OPEN]
    );
    const bestSell = await db.first(
      `SELECT price FROM ge_orders WHERE item_id = ? AND side = ? AND status = ?
       ORDER BY price ASC, created_at ASC LIMIT 1`,
      [itemId, SIDE_SELL, STATUS_OPEN]
    );

    return json({
      item,
      guide_price: guide,
      suggested_price: suggested,
      best_buy: bestBuy ? bestBuy.price : null,
      best_sell: bestSell ? bestSell.price : null,
      band: { min: band.min, max: band.max },
    });
  } catch (err) {
    return geErrorResponse(err);
  }
}

export async function handleGeItemHistory(request, env, itemId) {
  const session = await requireSession(request, env);
  if (!session) return json({ error: 'unauthorized' }, 401);
  if (!itemId) return json({ error: 'bad_request' }, 400);

  const url = new URL(request.url);
  let days = parseInt(url.searchParams.get('days') || '7', 10);
  if (!Number.isFinite(days) || days <= 0) days = 7;
  if (days > 30) days = 30;

  const db = makeDbAdapter(env);
  const since = Date.now() - days * 24 * 60 * 60 * 1000;
  const points = await db.all(
    `SELECT matched_price, qty, matched_at
     FROM ge_history
     WHERE item_id = ? AND matched_at >= ?
     ORDER BY matched_at ASC`,
    [itemId, since]
  );
  return json({ points, days });
}

export async function handleGeSearch(request, env) {
  const session = await requireSession(request, env);
  if (!session) return json({ error: 'unauthorized' }, 401);

  const url = new URL(request.url);
  const q = (url.searchParams.get('q') || '').trim().toLowerCase();
  const db = makeDbAdapter(env);

  let rows;
  if (q.length === 0) {
    rows = await db.all(
      `SELECT id, name, icon, stackable, base_price FROM items
       WHERE id != ?
       ORDER BY base_price DESC
       LIMIT 20`,
      [COIN_ITEM_ID]
    );
  } else {
    const like = `%${q}%`;
    rows = await db.all(
      `SELECT id, name, icon, stackable, base_price FROM items
       WHERE id != ? AND (LOWER(id) LIKE ? OR LOWER(name) LIKE ?)
       ORDER BY base_price DESC
       LIMIT 20`,
      [COIN_ITEM_ID, like, like]
    );
  }

  const items = [];
  for (const r of rows) {
    const sp = await getSuggestedPrice(db, r.id);
    items.push({ ...r, suggested_price: sp });
  }
  return json({ items });
}
