/**
 * SebasPresent — Comercio entre jugadores, estilo OSRS (Sesión 50)
 *
 *   GET  /api/trade                         → tu comercio + peticiones que te llegan
 *   POST /api/trade/request { target_user_id }
 *   POST /api/trade/respond { trade_id, accept }
 *   POST /api/trade/offer   { item_id, qty }   → de tu mochila a tu oferta
 *   POST /api/trade/remove  { item_id, qty }   → de tu oferta a tu mochila
 *   POST /api/trade/accept  { version }        → 1ª pantalla y luego confirmación
 *   POST /api/trade/cancel
 *
 * Seguridad (sin duplicados):
 *   · Lo que ofreces SALE de tu mochila y queda retenido (trade_items). Si se
 *     cancela, vuelve a su dueño; si se completa, pasa al otro.
 *   · Cualquier cambio en las ofertas sube `version` y quita los "aceptar":
 *     aceptas SIEMPRE la versión que estás viendo (anti-estafa).
 *   · Dos pantallas: aceptar → confirmar. Al confirmar los dos, el cambio de
 *     estado confirm→done se hace con guarda y la entrega va en un batch.
 *   · Si a alguien no le cabe lo que recibe, no se completa.
 */
import { json, readJson } from '../lib/db.js';
import { requireSession } from '../lib/auth.js';
import { pushRealtime } from '../lib/realtime.js';
import { stackableMap, placeStmts } from '../lib/give.js';

const INVENTORY_SLOTS = 20;
const PENDING_TTL_MS = 60_000;
const IDLE_TTL_MS = 10 * 60_000;
const ONLINE_MS = 30_000;
const TRADE_DIST_M = 15;
const ACTIVE = "('pending','open','confirm')";

async function myActive(env, uid) {
  return await env.DB.prepare(
    `SELECT * FROM trades WHERE (a_id = ? OR b_id = ?) AND status IN ('open','confirm') ORDER BY id DESC LIMIT 1`
  ).bind(uid, uid).first();
}

async function names(env, ids) {
  const out = {};
  for (const id of ids) {
    const r = await env.DB.prepare('SELECT username FROM users WHERE id = ?').bind(id).first();
    out[id] = r?.username || `user${id}`;
  }
  return out;
}

// ------------------------------------------------------------
// Poner objetos en una mochila (y si no caben, en el banco)
// ------------------------------------------------------------
/** Devuelve lo retenido a sus dueños (mochila o, si no cabe, banco). */
async function returnEscrow(env, tradeId, now) {
  const rows = (await env.DB.prepare('SELECT id, owner_id, item_id, qty FROM trade_items WHERE trade_id = ?').bind(tradeId).all()).results || [];
  const byOwner = {};
  for (const r of rows) (byOwner[r.owner_id] ||= []).push({ item_id: r.item_id, qty: r.qty });
  for (const [uid, items] of Object.entries(byOwner)) {
    const { stmts } = await placeStmts(env, Number(uid), items, now, { bankFallback: true });
    stmts.push(env.DB.prepare('DELETE FROM trade_items WHERE trade_id = ? AND owner_id = ?').bind(tradeId, Number(uid)));
    await env.DB.batch(stmts);
  }
}

async function bump(env, id, now) {
  await env.DB.prepare(`UPDATE trades SET a_ok = 0, b_ok = 0, status = 'open', version = version + 1, updated_at = ? WHERE id = ? AND status IN ('open','confirm')`)
    .bind(now, id).run();
}
async function notify(env, t, extra = {}) {
  try { await pushRealtime(env, { t: 'tr', id: t.id, u: [t.a_id, t.b_id], ...extra }); } catch {}
}

/** Caducar peticiones viejas y comercios abandonados. */
async function expire(env, uid, now) {
  await env.DB.prepare(`UPDATE trades SET status = 'cancelled', updated_at = ? WHERE status = 'pending' AND created_at < ? AND (a_id = ? OR b_id = ?)`)
    .bind(now, now - PENDING_TTL_MS, uid, uid).run();
  const stale = (await env.DB.prepare(`SELECT id FROM trades WHERE status IN ('open','confirm') AND updated_at < ? AND (a_id = ? OR b_id = ?)`)
    .bind(now - IDLE_TTL_MS, uid, uid).all()).results || [];
  for (const s of stale) {
    const c = await env.DB.prepare(`UPDATE trades SET status = 'cancelled', updated_at = ? WHERE id = ? AND status IN ('open','confirm')`).bind(now, s.id).run();
    if (c?.meta?.changes) await returnEscrow(env, s.id, now);
  }
}

async function tradeView(env, t, uid) {
  if (!t) return null;
  const me = t.a_id === uid ? 'a' : 'b';
  const otherId = me === 'a' ? t.b_id : t.a_id;
  const items = (await env.DB.prepare(
    `SELECT ti.owner_id, ti.item_id, ti.qty, i.name, i.icon FROM trade_items ti JOIN items i ON i.id = ti.item_id WHERE ti.trade_id = ? ORDER BY ti.id`
  ).bind(t.id).all()).results || [];
  const nm = await names(env, [otherId]);
  const map = (r) => ({ item_id: r.item_id, qty: r.qty, name: r.name, icon: r.icon });
  return {
    id: t.id, status: t.status, version: t.version,
    other: { id: otherId, name: nm[otherId] },
    my_items: items.filter(r => r.owner_id === uid).map(map),
    their_items: items.filter(r => r.owner_id === otherId).map(map),
    my_ok: me === 'a' ? !!t.a_ok : !!t.b_ok,
    their_ok: me === 'a' ? !!t.b_ok : !!t.a_ok,
  };
}

// ============================================================
export async function handleTradeGet(request, env) {
  const session = await requireSession(request, env);
  if (!session) return json({ error: 'unauthorized' }, 401);
  const uid = session.user_id, now = Date.now();
  await expire(env, uid, now);
  const t = await myActive(env, uid);
  const inc = (await env.DB.prepare(`SELECT id, a_id FROM trades WHERE b_id = ? AND status = 'pending' ORDER BY id DESC LIMIT 5`).bind(uid).all()).results || [];
  const nm = await names(env, inc.map(r => r.a_id));
  return json({ trade: await tradeView(env, t, uid), incoming: inc.map(r => ({ id: r.id, from: r.a_id, name: nm[r.a_id] })) });
}

export async function handleTradeRequest(request, env) {
  const session = await requireSession(request, env);
  if (!session) return json({ error: 'unauthorized' }, 401);
  const uid = session.user_id, now = Date.now();
  const body = await readJson(request);
  const target = Number(body?.target_user_id);
  if (!Number.isInteger(target) || target === uid) return json({ error: 'bad_target' }, 400);
  await expire(env, uid, now);
  await expire(env, target, now);

  const pos = (await env.DB.prepare(`SELECT user_id, x, z, last_seen FROM online_users WHERE user_id IN (?, ?)`).bind(uid, target).all()).results || [];
  const P = Object.fromEntries(pos.map(r => [r.user_id, r]));
  if (!P[target] || now - P[target].last_seen > ONLINE_MS) return json({ error: 'offline', message: 'Ese jugador no está conectado.' }, 400);
  if (!P[uid] || Math.hypot(P[uid].x - P[target].x, P[uid].z - P[target].z) > TRADE_DIST_M) return json({ error: 'too_far', message: 'Acércate más para comerciar.' }, 400);
  if (await myActive(env, uid)) return json({ error: 'busy_self', message: 'Ya estás comerciando.' }, 400);
  if (await myActive(env, target)) return json({ error: 'busy', message: 'Ese jugador está comerciando con otro.' }, 400);

  // ¿Él ya me lo había pedido? → se abre directamente (como en OSRS)
  const theirs = await env.DB.prepare(`SELECT * FROM trades WHERE a_id = ? AND b_id = ? AND status = 'pending' ORDER BY id DESC LIMIT 1`).bind(target, uid).first();
  if (theirs) {
    const o = await env.DB.prepare(`UPDATE trades SET status = 'open', updated_at = ? WHERE id = ? AND status = 'pending'`).bind(now, theirs.id).run();
    if (o?.meta?.changes) { await notify(env, theirs, { open: 1 }); return json({ ok: true, opened: true, trade_id: theirs.id }); }
  }
  // Una sola petición mía a la vez
  await env.DB.prepare(`UPDATE trades SET status = 'cancelled', updated_at = ? WHERE a_id = ? AND status = 'pending'`).bind(now, uid).run();
  const ins = await env.DB.prepare(`INSERT INTO trades (a_id, b_id, status, created_at, updated_at) VALUES (?, ?, 'pending', ?, ?)`).bind(uid, target, now, now).run();
  const id = ins?.meta?.last_row_id;
  const nm = await names(env, [uid]);
  try { await pushRealtime(env, { t: 'trq', id, to: target, from: uid, name: nm[uid] }); } catch {}
  return json({ ok: true, requested: true, trade_id: id });
}

export async function handleTradeRespond(request, env) {
  const session = await requireSession(request, env);
  if (!session) return json({ error: 'unauthorized' }, 401);
  const uid = session.user_id, now = Date.now();
  const body = await readJson(request);
  const id = Number(body?.trade_id);
  await expire(env, uid, now);
  const t = await env.DB.prepare(`SELECT * FROM trades WHERE id = ? AND b_id = ? AND status = 'pending'`).bind(id, uid).first();
  if (!t) return json({ error: 'expired', message: 'La petición ya no está.' }, 400);
  if (!body?.accept) {
    await env.DB.prepare(`UPDATE trades SET status = 'cancelled', updated_at = ? WHERE id = ? AND status = 'pending'`).bind(now, id).run();
    await notify(env, t, { declined: 1 });
    return json({ ok: true, declined: true });
  }
  if (await myActive(env, uid) || await myActive(env, t.a_id)) return json({ error: 'busy', message: 'Alguno ya está comerciando.' }, 400);
  const pos = (await env.DB.prepare(`SELECT user_id, x, z FROM online_users WHERE user_id IN (?, ?)`).bind(uid, t.a_id).all()).results || [];
  const P = Object.fromEntries(pos.map(r => [r.user_id, r]));
  if (!P[uid] || !P[t.a_id] || Math.hypot(P[uid].x - P[t.a_id].x, P[uid].z - P[t.a_id].z) > TRADE_DIST_M) return json({ error: 'too_far', message: 'Acércate más para comerciar.' }, 400);
  const o = await env.DB.prepare(`UPDATE trades SET status = 'open', updated_at = ? WHERE id = ? AND status = 'pending'`).bind(now, id).run();
  if (!o?.meta?.changes) return json({ error: 'expired' }, 400);
  await notify(env, t, { open: 1 });
  return json({ ok: true, opened: true, trade_id: id });
}

export async function handleTradeOffer(request, env) {
  const session = await requireSession(request, env);
  if (!session) return json({ error: 'unauthorized' }, 401);
  const uid = session.user_id, now = Date.now();
  const body = await readJson(request);
  const itemId = String(body?.item_id || '');
  let qty = Math.floor(Number(body?.qty));
  if (!itemId || !(qty > 0)) return json({ error: 'bad_request' }, 400);
  const t = await myActive(env, uid);
  if (!t) return json({ error: 'no_trade' }, 400);

  // 1) Sacar de la mochila (con guarda)
  const st = (await stackableMap(env, [itemId]))[itemId];
  let took = 0;
  if (st) {
    const row = await env.DB.prepare('SELECT slot_index, quantity FROM user_inventory WHERE user_id = ? AND item_id = ? LIMIT 1').bind(uid, itemId).first();
    if (!row) return json({ error: 'not_in_inventory' }, 400);
    qty = Math.min(qty, row.quantity);
    const r = qty >= row.quantity
      ? await env.DB.prepare('DELETE FROM user_inventory WHERE user_id = ? AND slot_index = ? AND item_id = ? AND quantity = ?').bind(uid, row.slot_index, itemId, row.quantity).run()
      : await env.DB.prepare('UPDATE user_inventory SET quantity = quantity - ?, updated_at = ? WHERE user_id = ? AND slot_index = ? AND item_id = ? AND quantity > ?').bind(qty, now, uid, row.slot_index, itemId, qty).run();
    if (r?.meta?.changes) took = qty;
  } else {
    const rows = (await env.DB.prepare('SELECT slot_index FROM user_inventory WHERE user_id = ? AND item_id = ? ORDER BY slot_index DESC LIMIT ?').bind(uid, itemId, qty).all()).results || [];
    for (const r of rows) {
      const d = await env.DB.prepare('DELETE FROM user_inventory WHERE user_id = ? AND slot_index = ? AND item_id = ?').bind(uid, r.slot_index, itemId).run();
      if (d?.meta?.changes) took++;
    }
  }
  if (!took) return json({ error: 'not_in_inventory', message: 'Ya no lo tienes.' }, 400);

  // 2) A la oferta, solo si el comercio sigue abierto; si no, se devuelve
  const ex = await env.DB.prepare('SELECT id FROM trade_items WHERE trade_id = ? AND owner_id = ? AND item_id = ?').bind(t.id, uid, itemId).first();
  const put = ex
    ? await env.DB.prepare(`UPDATE trade_items SET qty = qty + ? WHERE id = ? AND EXISTS (SELECT 1 FROM trades WHERE id = ? AND status IN ('open','confirm'))`).bind(took, ex.id, t.id).run()
    : await env.DB.prepare(`INSERT INTO trade_items (trade_id, owner_id, item_id, qty) SELECT ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM trades WHERE id = ? AND status IN ('open','confirm'))`).bind(t.id, uid, itemId, took, t.id).run();
  if (!put?.meta?.changes) {
    const { stmts } = await placeStmts(env, uid, [{ item_id: itemId, qty: took }], now, { bankFallback: true });
    await env.DB.batch(stmts);
    return json({ error: 'no_trade', message: 'El comercio se ha cerrado.' }, 400);
  }
  await bump(env, t.id, now);
  await notify(env, t);
  return json({ ok: true, offered: took });
}

export async function handleTradeRemove(request, env) {
  const session = await requireSession(request, env);
  if (!session) return json({ error: 'unauthorized' }, 401);
  const uid = session.user_id, now = Date.now();
  const body = await readJson(request);
  const itemId = String(body?.item_id || '');
  const want = Math.floor(Number(body?.qty));
  if (!itemId || !(want > 0)) return json({ error: 'bad_request' }, 400);
  const t = await myActive(env, uid);
  if (!t) return json({ error: 'no_trade' }, 400);
  const row = await env.DB.prepare('SELECT id, qty FROM trade_items WHERE trade_id = ? AND owner_id = ? AND item_id = ?').bind(t.id, uid, itemId).first();
  if (!row) return json({ error: 'not_offered' }, 400);
  const q = Math.min(want, row.qty);
  const { stmts, fits } = await placeStmts(env, uid, [{ item_id: itemId, qty: q }], now);
  if (!fits) return json({ error: 'inventory_full', message: 'No te cabe en la mochila.' }, 400);
  // quitar de la oferta (con guarda) + devolver, todo junto
  const guard = q >= row.qty
    ? env.DB.prepare(`DELETE FROM trade_items WHERE id = ? AND qty = ? AND EXISTS (SELECT 1 FROM trades WHERE id = ? AND status IN ('open','confirm'))`).bind(row.id, row.qty, t.id)
    : env.DB.prepare(`UPDATE trade_items SET qty = qty - ? WHERE id = ? AND qty > ? AND EXISTS (SELECT 1 FROM trades WHERE id = ? AND status IN ('open','confirm'))`).bind(q, row.id, q, t.id);
  const r = await guard.run();
  if (!r?.meta?.changes) return json({ error: 'try_again' }, 409);
  try { await env.DB.batch(stmts); }
  catch {
    // no se pudo devolver (mochila cambió): vuelve a la oferta
    await env.DB.prepare('INSERT INTO trade_items (trade_id, owner_id, item_id, qty) VALUES (?, ?, ?, ?)').bind(t.id, uid, itemId, q).run();
    return json({ error: 'try_again' }, 409);
  }
  await bump(env, t.id, now);
  await notify(env, t);
  return json({ ok: true, removed: q });
}

export async function handleTradeAccept(request, env) {
  const session = await requireSession(request, env);
  if (!session) return json({ error: 'unauthorized' }, 401);
  const uid = session.user_id, now = Date.now();
  const body = await readJson(request);
  const version = Number(body?.version);
  const t = await myActive(env, uid);
  if (!t) return json({ error: 'no_trade' }, 400);
  if (t.version !== version) return json({ error: 'changed', message: '¡La oferta ha cambiado! Revísala.' }, 409);
  const col = t.a_id === uid ? 'a_ok' : 'b_ok';
  const set = await env.DB.prepare(`UPDATE trades SET ${col} = 1, updated_at = ? WHERE id = ? AND version = ? AND status = ?`).bind(now, t.id, version, t.status).run();
  if (!set?.meta?.changes) return json({ error: 'changed', message: '¡La oferta ha cambiado! Revísala.' }, 409);

  if (t.status === 'open') {
    // los dos aceptaron → pantalla de confirmación
    const c = await env.DB.prepare(`UPDATE trades SET status = 'confirm', a_ok = 0, b_ok = 0, updated_at = ? WHERE id = ? AND status = 'open' AND a_ok = 1 AND b_ok = 1 AND version = ?`)
      .bind(now, t.id, version).run();
    await notify(env, t);
    return json({ ok: true, stage: c?.meta?.changes ? 'confirm' : 'waiting' });
  }
  // status confirm: ¿los dos confirmaron? → completar
  const claim = await env.DB.prepare(`UPDATE trades SET status = 'done', updated_at = ? WHERE id = ? AND status = 'confirm' AND a_ok = 1 AND b_ok = 1 AND version = ?`)
    .bind(now, t.id, version).run();
  if (!claim?.meta?.changes) { await notify(env, t); return json({ ok: true, stage: 'waiting' }); }

  const items = (await env.DB.prepare('SELECT owner_id, item_id, qty FROM trade_items WHERE trade_id = ?').bind(t.id).all()).results || [];
  const toA = items.filter(i => i.owner_id === t.b_id), toB = items.filter(i => i.owner_id === t.a_id);
  const pa = await placeStmts(env, t.a_id, toA, now);
  const pb = await placeStmts(env, t.b_id, toB, now);
  const fail = async (msg) => {
    await env.DB.prepare(`UPDATE trades SET status = 'confirm', a_ok = 0, b_ok = 0, updated_at = ? WHERE id = ? AND status = 'done'`).bind(now, t.id).run();
    await notify(env, t, { err: msg });
    return json({ error: 'no_space', message: msg }, 400);
  };
  if (!pa.fits || !pb.fits) {
    const nm = await names(env, [t.a_id, t.b_id]);
    return fail(`A ${!pa.fits ? nm[t.a_id] : nm[t.b_id]} no le cabe todo en la mochila.`);
  }
  try {
    await env.DB.batch([...pa.stmts, ...pb.stmts, env.DB.prepare('DELETE FROM trade_items WHERE trade_id = ?').bind(t.id)]);
  } catch {
    return fail('Algo cambió en una mochila. Volved a confirmar.');
  }
  await notify(env, t, { done: 1 });
  return json({ ok: true, stage: 'done' });
}

export async function handleTradeCancel(request, env) {
  const session = await requireSession(request, env);
  if (!session) return json({ error: 'unauthorized' }, 401);
  const uid = session.user_id, now = Date.now();
  const t = await env.DB.prepare(`SELECT * FROM trades WHERE (a_id = ? OR b_id = ?) AND status IN ${ACTIVE} ORDER BY id DESC LIMIT 1`).bind(uid, uid).first();
  if (!t) return json({ ok: true });
  const c = await env.DB.prepare(`UPDATE trades SET status = 'cancelled', updated_at = ? WHERE id = ? AND status IN ${ACTIVE}`).bind(now, t.id).run();
  if (c?.meta?.changes) {
    await returnEscrow(env, t.id, now);
    await notify(env, t, { cancelled: 1, by: uid });
  }
  return json({ ok: true, cancelled: true });
}
