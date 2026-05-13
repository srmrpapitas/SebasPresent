/**
 * SebasPresent — Auth + Position + Inventory + Bank + GE Worker (Slice 4c v2)
 *
 * Endpoints:
 *   POST /api/register   { username, password }       → { token, user }
 *   POST /api/login      { username, password }       → { token, user }
 *   GET  /api/me         Authorization: Bearer <tok>  → { user }
 *   POST /api/logout     Authorization: Bearer <tok>  → { ok: true }
 *
 *   GET  /api/position   → { x, z }
 *   POST /api/position   { x, z } → { ok: true }
 *
 *   GET  /api/inventory  → { slots: [...] }
 *   POST /api/inventory/swap  { from, to } → { ok: true }
 *
 *   GET  /api/bank       → { slots: [...] }
 *   POST /api/bank/deposit   { inv_slot, quantity } → { ok: true }
 *   POST /api/bank/withdraw  { bank_slot, quantity, target_inv_slot? } → { ok: true }
 *   POST /api/bank/swap   { from, to } → { ok: true }
 *
 *   Grand Exchange (Slice 4c v2 — collection box model):
 *   GET  /api/ge/orders              → { open, collection, recent, totals, maxSlots }
 *      open: las 8 ordenes abiertas (con qty_filled, pending_*).
 *      collection: ordenes ya completadas/canceladas con pending > 0
 *                  esperando reclamarse.
 *      recent: ordenes ya reclamadas (claimed_at) en ultimas 24h.
 *      totals: { pending_coins, pending_items_by_id: {...} } para los
 *              botones de claim ("→ Mochila: 5,000gp + 50 logs").
 *   POST /api/ge/place   { item_id, side, price, qty } → { orderId, escrowMoved }
 *      Coins/items salen del INVENTARIO (no del banco).
 *      Valida banda de precio (+/-5%) y slots disponibles (max 8).
 *   POST /api/ge/cancel  { order_id } → { ok: true }
 *      Cancela orden propia. Escrow restante a pending_* (no al banco).
 *   POST /api/ge/claim_all { target: "inventory" | "bank" }
 *      → { claimed: [...], remaining: [...] }
 *      Reclama todo lo pendiente al destino. Si target=inventory y no
 *      caben todas las ordenes, las que no caben quedan en remaining
 *      con reason='inventory_full'. Las demas se procesan.
 *   GET  /api/ge/item/:id            → info de mercado del item
 *   GET  /api/ge/item/:id/history?days=7 → puntos para grafico
 *   GET  /api/ge/search?q=X          → busqueda de items
 *
 *   Scheduled handler (cron, definido en wrangler.toml):
 *     Cada 1 min: corre matcher + repone fantasmas si hay deficit.
 *
 *   GET  /api/health → { ok: true, ts }
 *
 * Password hashing: PBKDF2-SHA256, 100.000 iterations.
 * Sessions: opaque 256-bit random tokens, 30-day expiry.
 * Inventory: 28 slots, grid 4×7. Bank: slots posicionales sin limite.
 * GE: 8 slots de orden por usuario, igual que OSRS.
 *
 * NOTA: el engine del GE (matching, escrow, validacion, claim) esta
 * inline al final de este archivo en la seccion "GE ENGINE v2". Esta
 * tambien disponible como modulo aparte en server/ge_engine.js para
 * tests y como referencia, pero esta version inline es la canonical
 * para deploy en Cloudflare Workers sin bundler.
 */

// ---------- Configuration ----------

const PBKDF2_ITERATIONS = 100_000;
const SESSION_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;
const USERNAME_REGEX = /^[a-zA-Z0-9_]{3,16}$/;
const PASSWORD_MIN_LENGTH = 6;

const WORLD_HALF = 2048;
const INVENTORY_SLOTS = 28;

// Banco: en OSRS son 800+ slots. Ponemos un techo razonable para alpha.
// Si llegamos aqui es porque alguien tiene 500 items distintos, escenario
// imposible con los 10 items actuales. Es defensa en profundidad.
const BANK_MAX_SLOTS = 500;

// Grand Exchange (Slice 4c v2)
const GE_SYSTEM_USER_ID = 0;
const GE_SIDE_BUY = 0;
const GE_SIDE_SELL = 1;
const GE_STATUS_OPEN = 0;
const GE_STATUS_COMPLETED = 1;
const GE_STATUS_CANCELLED = 2;
const GE_COIN_ITEM_ID = 'coins';
const GE_MAX_ORDER_SLOTS_PER_USER = 8;
const GE_INVENTORY_SLOT_COUNT = 28;
const GE_CLAIM_TARGET_INVENTORY = 'inventory';
const GE_CLAIM_TARGET_BANK = 'bank';
const GE_PRICE_BAND_BPS = 500;          // ±5%
const GE_PRICE_BAND_FLOOR_ABS = 5;      // mínimo 5gp absolutos
const GE_BPS_DIVISOR = 10_000;
const GE_GHOST_TIMESTAMP_FAR_FUTURE = 9_999_999_999_999; // año 2286

// ---------- Entry point ----------

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return corsResponse(request, env);
    }

    try {
      let response;
      if (url.pathname === '/api/register' && request.method === 'POST') {
        response = await handleRegister(request, env);
      } else if (url.pathname === '/api/login' && request.method === 'POST') {
        response = await handleLogin(request, env);
      } else if (url.pathname === '/api/me' && request.method === 'GET') {
        response = await handleMe(request, env);
      } else if (url.pathname === '/api/logout' && request.method === 'POST') {
        response = await handleLogout(request, env);
      } else if (url.pathname === '/api/position' && request.method === 'GET') {
        response = await handleGetPosition(request, env);
      } else if (url.pathname === '/api/position' && request.method === 'POST') {
        response = await handleSavePosition(request, env);
      } else if (url.pathname === '/api/inventory' && request.method === 'GET') {
        response = await handleGetInventory(request, env);
      } else if (url.pathname === '/api/inventory/swap' && request.method === 'POST') {
        response = await handleSwapInventory(request, env);
      } else if (url.pathname === '/api/bank' && request.method === 'GET') {
        response = await handleGetBank(request, env);
      } else if (url.pathname === '/api/bank/deposit' && request.method === 'POST') {
        response = await handleBankDeposit(request, env);
      } else if (url.pathname === '/api/bank/withdraw' && request.method === 'POST') {
        response = await handleBankWithdraw(request, env);
      } else if (url.pathname === '/api/bank/swap' && request.method === 'POST') {
        response = await handleBankSwap(request, env);
      } else if (url.pathname === '/api/ge/orders' && request.method === 'GET') {
        response = await handleGeGetOrders(request, env);
      } else if (url.pathname === '/api/ge/place' && request.method === 'POST') {
        response = await handleGePlace(request, env);
      } else if (url.pathname === '/api/ge/cancel' && request.method === 'POST') {
        response = await handleGeCancel(request, env);
      } else if (url.pathname === '/api/ge/claim_all' && request.method === 'POST') {
        response = await handleGeClaimAll(request, env);
      } else if (url.pathname === '/api/ge/search' && request.method === 'GET') {
        response = await handleGeSearch(request, env);
      } else if (url.pathname.startsWith('/api/ge/item/') && url.pathname.endsWith('/history') && request.method === 'GET') {
        const itemId = url.pathname.split('/')[4];
        response = await handleGeItemHistory(request, env, itemId);
      } else if (url.pathname.startsWith('/api/ge/item/') && request.method === 'GET') {
        const itemId = url.pathname.split('/')[4];
        response = await handleGeItemInfo(request, env, itemId);
      } else if (url.pathname === '/api/health') {
        response = json({ ok: true, ts: Date.now() });
      } else {
        response = json({ error: 'not_found' }, 404);
      }
      return withCors(response, request, env);
    } catch (err) {
      console.error('Worker error:', err);
      return withCors(json({ error: 'internal_error', message: err.message }, 500), request, env);
    }
  },

  /**
   * Cron handler. Configurado via wrangler.toml:
   *   [triggers]
   *   crons = ["* * * * *"]   # cada minuto
   *
   * Cada tick:
   *   1. Corre matcher sobre todos los items con actividad.
   *   2. Repone fantasmas si su qty abierta esta por debajo del target.
   *
   * Si el cron falla en un tick, el siguiente lo recoge. No es critico.
   */
  async scheduled(event, env, ctx) {
    const db = makeDbAdapter(env);
    try {
      const matched = await geRunMatcher(db);
      const reseed = await geReseedGhostOrders(db);
      console.log(`[ge-cron] matches=${matched.matches} items=${matched.items.join(',')} reseed=${reseed.inserted}`);
    } catch (err) {
      console.error('[ge-cron] error:', err);
    }
  },
};

// ---------- Handlers: Auth ----------

async function handleRegister(request, env) {
  const body = await readJson(request);
  if (!body) return json({ error: 'bad_request' }, 400);

  const username = (body.username || '').trim();
  const password = body.password || '';

  if (!USERNAME_REGEX.test(username)) {
    return json({
      error: 'invalid_username',
      message: 'El nombre debe tener 3-16 caracteres alfanuméricos o guión bajo.',
    }, 400);
  }
  if (password.length < PASSWORD_MIN_LENGTH) {
    return json({
      error: 'invalid_password',
      message: `La contraseña debe tener al menos ${PASSWORD_MIN_LENGTH} caracteres.`,
    }, 400);
  }

  const existing = await env.DB.prepare('SELECT id FROM users WHERE username = ?')
    .bind(username).first();
  if (existing) {
    return json({ error: 'username_taken', message: 'Ese nombre ya está en uso.' }, 409);
  }

  const passwordHash = await hashPassword(password);
  const now = Date.now();

  const result = await env.DB.prepare(
    'INSERT INTO users (username, password_hash, created_at, last_login) VALUES (?, ?, ?, ?)'
  ).bind(username, passwordHash, now, now).run();

  const userId = result.meta.last_row_id;

  try {
    await env.DB.batch([
      env.DB.prepare(
        'INSERT INTO user_inventory (user_id, slot_index, item_id, quantity, updated_at) VALUES (?, 0, ?, 1, ?)'
      ).bind(userId, 'axe', now),
      env.DB.prepare(
        'INSERT INTO user_inventory (user_id, slot_index, item_id, quantity, updated_at) VALUES (?, 1, ?, 1, ?)'
      ).bind(userId, 'tinderbox', now),
      env.DB.prepare(
        'INSERT INTO user_inventory (user_id, slot_index, item_id, quantity, updated_at) VALUES (?, 2, ?, 25, ?)'
      ).bind(userId, 'coins', now),
    ]);
  } catch (err) {
    console.error('Starter pack failed for user', userId, err);
  }

  const token = await createSession(env, userId);

  return json({
    token,
    user: { id: userId, username, created_at: now },
  });
}

async function handleLogin(request, env) {
  const body = await readJson(request);
  if (!body) return json({ error: 'bad_request' }, 400);

  const username = (body.username || '').trim();
  const password = body.password || '';

  if (!username || !password) {
    return json({ error: 'missing_credentials' }, 400);
  }

  const user = await env.DB.prepare(
    'SELECT id, username, password_hash, created_at FROM users WHERE username = ?'
  ).bind(username).first();

  if (!user) {
    return json({ error: 'invalid_credentials', message: 'Usuario o contraseña incorrectos.' }, 401);
  }

  const valid = await verifyPassword(password, user.password_hash);
  if (!valid) {
    return json({ error: 'invalid_credentials', message: 'Usuario o contraseña incorrectos.' }, 401);
  }

  const now = Date.now();
  await env.DB.prepare('UPDATE users SET last_login = ? WHERE id = ?')
    .bind(now, user.id).run();

  const token = await createSession(env, user.id);

  return json({
    token,
    user: { id: user.id, username: user.username, created_at: user.created_at },
  });
}

async function handleMe(request, env) {
  const session = await requireSession(request, env);
  if (!session) return json({ error: 'unauthorized' }, 401);

  const user = await env.DB.prepare(
    'SELECT id, username, created_at, last_login FROM users WHERE id = ?'
  ).bind(session.user_id).first();

  if (!user) return json({ error: 'user_not_found' }, 404);

  return json({ user });
}

async function handleLogout(request, env) {
  const token = bearerToken(request);
  if (token) {
    await env.DB.prepare('DELETE FROM sessions WHERE token = ?').bind(token).run();
  }
  return json({ ok: true });
}

// ---------- Handlers: Position ----------

async function handleGetPosition(request, env) {
  const session = await requireSession(request, env);
  if (!session) return json({ error: 'unauthorized' }, 401);

  const row = await env.DB.prepare(
    'SELECT last_x, last_z FROM users WHERE id = ?'
  ).bind(session.user_id).first();

  if (!row) return json({ error: 'user_not_found' }, 404);

  const x = row.last_x !== null && row.last_x !== undefined ? row.last_x : 0;
  const z = row.last_z !== null && row.last_z !== undefined ? row.last_z : 0;

  return json({ x, z });
}

async function handleSavePosition(request, env) {
  const session = await requireSession(request, env);
  if (!session) return json({ error: 'unauthorized' }, 401);

  const body = await readJson(request);
  if (!body) return json({ error: 'bad_request' }, 400);

  const rawX = body.x;
  const rawZ = body.z;
  if (typeof rawX !== 'number' || typeof rawZ !== 'number' ||
      !isFinite(rawX) || !isFinite(rawZ)) {
    return json({ error: 'invalid_position', message: 'x e z deben ser números finitos.' }, 400);
  }

  const x = Math.max(-WORLD_HALF, Math.min(WORLD_HALF, rawX));
  const z = Math.max(-WORLD_HALF, Math.min(WORLD_HALF, rawZ));

  await env.DB.prepare(
    'UPDATE users SET last_x = ?, last_z = ? WHERE id = ?'
  ).bind(x, z, session.user_id).run();

  return json({ ok: true });
}

// ---------- Handlers: Inventory (Slice 4a) ----------

/**
 * GET /api/inventory
 * Returns the user's inventory with item metadata joined.
 * Empty slots are omitted from the response (client renders them as empty).
 */
async function handleGetInventory(request, env) {
  const session = await requireSession(request, env);
  if (!session) return json({ error: 'unauthorized' }, 401);

  const result = await env.DB.prepare(
    `SELECT inv.slot_index AS slot, inv.item_id, inv.quantity,
            i.name, i.icon, i.stackable
     FROM user_inventory inv
     JOIN items i ON i.id = inv.item_id
     WHERE inv.user_id = ?
     ORDER BY inv.slot_index ASC`
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

async function handleSwapInventory(request, env) {
  const session = await requireSession(request, env);
  if (!session) return json({ error: 'unauthorized' }, 401);

  const body = await readJson(request);
  if (!body) return json({ error: 'bad_request' }, 400);

  const from = body.from;
  const to = body.to;

  if (!Number.isInteger(from) || !Number.isInteger(to)) {
    return json({ error: 'invalid_slots', message: 'from y to deben ser enteros.' }, 400);
  }
  if (from < 0 || from >= INVENTORY_SLOTS || to < 0 || to >= INVENTORY_SLOTS) {
    return json({ error: 'invalid_slots', message: `Slots fuera de rango (0-${INVENTORY_SLOTS - 1}).` }, 400);
  }
  if (from === to) return json({ ok: true });

  const slotA = await env.DB.prepare(
    `SELECT inv.item_id, inv.quantity, i.stackable
     FROM user_inventory inv
     JOIN items i ON i.id = inv.item_id
     WHERE inv.user_id = ? AND inv.slot_index = ?`
  ).bind(session.user_id, from).first();

  if (!slotA) return json({ ok: true });

  const slotB = await env.DB.prepare(
    `SELECT item_id, quantity FROM user_inventory
     WHERE user_id = ? AND slot_index = ?`
  ).bind(session.user_id, to).first();

  const now = Date.now();

  if (!slotB) {
    await env.DB.batch([
      env.DB.prepare(
        'INSERT INTO user_inventory (user_id, slot_index, item_id, quantity, updated_at) VALUES (?, ?, ?, ?, ?)'
      ).bind(session.user_id, to, slotA.item_id, slotA.quantity, now),
      env.DB.prepare(
        'DELETE FROM user_inventory WHERE user_id = ? AND slot_index = ?'
      ).bind(session.user_id, from),
    ]);
    return json({ ok: true });
  }

  if (slotA.item_id === slotB.item_id && slotA.stackable === 1) {
    const merged = slotA.quantity + slotB.quantity;
    await env.DB.batch([
      env.DB.prepare(
        'UPDATE user_inventory SET quantity = ?, updated_at = ? WHERE user_id = ? AND slot_index = ?'
      ).bind(merged, now, session.user_id, to),
      env.DB.prepare(
        'DELETE FROM user_inventory WHERE user_id = ? AND slot_index = ?'
      ).bind(session.user_id, from),
    ]);
    return json({ ok: true });
  }

  await env.DB.batch([
    env.DB.prepare(
      'DELETE FROM user_inventory WHERE user_id = ? AND slot_index IN (?, ?)'
    ).bind(session.user_id, from, to),
    env.DB.prepare(
      'INSERT INTO user_inventory (user_id, slot_index, item_id, quantity, updated_at) VALUES (?, ?, ?, ?, ?)'
    ).bind(session.user_id, to, slotA.item_id, slotA.quantity, now),
    env.DB.prepare(
      'INSERT INTO user_inventory (user_id, slot_index, item_id, quantity, updated_at) VALUES (?, ?, ?, ?, ?)'
    ).bind(session.user_id, from, slotB.item_id, slotB.quantity, now),
  ]);

  return json({ ok: true });
}

// ---------- Handlers: Bank (Slice 4b) ----------

/**
 * GET /api/bank
 * Lista los items del banco del usuario, con metadata del item joineada.
 * Ordenado por slot_index ASC (asi el client renderiza en el orden visual
 * en que el usuario los dejo).
 */
async function handleGetBank(request, env) {
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

/**
 * POST /api/bank/deposit
 * Body: { inv_slot: int, quantity: int }
 *   quantity === -1 significa "todo lo que haya en ese slot del inv".
 *
 * Reglas:
 *   - Si el item ya existe en el banco -> suma al stack existente.
 *   - Si no existe -> crea nuevo slot al final del banco.
 *   - Para no-stackable: cada slot del inventario tiene quantity=1, asi que
 *     un deposito mueve 1 unidad. quantity=-1 tambien mueve 1.
 *     (Si tenia varios slots del axe, el cliente llamara al endpoint
 *     varias veces — uno por cada slot.)
 */
async function handleBankDeposit(request, env) {
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

  // No-stackable: solo se puede depositar 1 unidad por llamada (el inv solo
  // tiene 1 por slot). Stackable: hasta la cantidad disponible.
  const available = invRow.quantity;
  if (qty === -1) qty = available;
  if (qty > available) qty = available;
  if (invRow.stackable !== 1 && qty > 1) qty = 1;

  const itemId = invRow.item_id;
  const now = Date.now();

  // Mira si ya hay un stack de este item en el banco.
  const bankRow = await env.DB.prepare(
    'SELECT slot_index, quantity FROM user_bank WHERE user_id = ? AND item_id = ?'
  ).bind(session.user_id, itemId).first();

  const stmts = [];

  if (bankRow) {
    // Suma al stack existente
    stmts.push(env.DB.prepare(
      'UPDATE user_bank SET quantity = quantity + ?, updated_at = ? WHERE user_id = ? AND slot_index = ?'
    ).bind(qty, now, session.user_id, bankRow.slot_index));
  } else {
    // Crea slot nuevo al final
    const maxRow = await env.DB.prepare(
      'SELECT COALESCE(MAX(slot_index), -1) AS max_slot FROM user_bank WHERE user_id = ?'
    ).bind(session.user_id).first();
    const nextSlot = (maxRow?.max_slot ?? -1) + 1;
    if (nextSlot >= BANK_MAX_SLOTS) {
      return json({ error: 'bank_full', message: 'El banco está lleno.' }, 400);
    }
    stmts.push(env.DB.prepare(
      'INSERT INTO user_bank (user_id, slot_index, item_id, quantity, updated_at) VALUES (?, ?, ?, ?, ?)'
    ).bind(session.user_id, nextSlot, itemId, qty, now));
  }

  // Resta del inventario (o borra el slot si se va todo)
  if (qty >= available) {
    stmts.push(env.DB.prepare(
      'DELETE FROM user_inventory WHERE user_id = ? AND slot_index = ?'
    ).bind(session.user_id, invSlot));
  } else {
    stmts.push(env.DB.prepare(
      'UPDATE user_inventory SET quantity = quantity - ?, updated_at = ? WHERE user_id = ? AND slot_index = ?'
    ).bind(qty, now, session.user_id, invSlot));
  }

  await env.DB.batch(stmts);
  return json({ ok: true });
}

/**
 * POST /api/bank/withdraw
 * Body: { bank_slot: int, quantity: int, target_inv_slot?: int }
 *   quantity === -1 significa "todo el stack del banco".
 *   target_inv_slot es opcional: si esta libre y es valido se intenta usar.
 *     Si no, se usa el primer hueco disponible del inv.
 *
 * Reglas:
 *   - Stackable: si ya hay stack del mismo item en inv, suma. Si no, crea
 *     un slot nuevo (target_inv_slot si libre, si no el primer hueco).
 *   - No-stackable: cada unidad ocupa un slot del inv. La cantidad pedida
 *     no puede exceder el numero de huecos libres en el inventario.
 */
async function handleBankWithdraw(request, env) {
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

  const itemId = bankRow.item_id;
  const isStackable = bankRow.stackable === 1;
  const now = Date.now();

  // Carga inventario completo para encontrar huecos / stacks existentes.
  const invRes = await env.DB.prepare(
    'SELECT slot_index, item_id, quantity FROM user_inventory WHERE user_id = ?'
  ).bind(session.user_id).all();
  const invMap = new Map(); // slot_index -> {item_id, quantity}
  for (const r of (invRes.results || [])) {
    invMap.set(r.slot_index, { item_id: r.item_id, quantity: r.quantity });
  }

  const stmts = [];

  if (isStackable) {
    // Busca stack existente
    let existingSlot = null;
    for (const [slot, data] of invMap) {
      if (data.item_id === itemId) { existingSlot = slot; break; }
    }

    if (existingSlot !== null) {
      // Suma al stack existente
      stmts.push(env.DB.prepare(
        'UPDATE user_inventory SET quantity = quantity + ?, updated_at = ? WHERE user_id = ? AND slot_index = ?'
      ).bind(qty, now, session.user_id, existingSlot));
    } else {
      // Crea slot nuevo
      const slot = pickInvSlot(invMap, targetInvSlot);
      if (slot === null) {
        return json({ error: 'inv_full', message: 'No hay espacio en la mochila.' }, 400);
      }
      stmts.push(env.DB.prepare(
        'INSERT INTO user_inventory (user_id, slot_index, item_id, quantity, updated_at) VALUES (?, ?, ?, ?, ?)'
      ).bind(session.user_id, slot, itemId, qty, now));
    }
  } else {
    // No-stackable: necesita `qty` huecos libres
    const freeSlots = [];
    // Empieza por target_inv_slot si esta libre
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

  // Resta del banco (o borra slot si se va todo)
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
  return json({ ok: true });
}

/**
 * Devuelve el slot del inv a usar:
 *   - Si target esta dado y libre, lo usa.
 *   - Si no, el primer hueco libre.
 *   - null si no hay huecos.
 */
function pickInvSlot(invMap, target) {
  if (target !== undefined && target !== null && !invMap.has(target)) {
    return target;
  }
  for (let i = 0; i < INVENTORY_SLOTS; i++) {
    if (!invMap.has(i)) return i;
  }
  return null;
}

/**
 * POST /api/bank/swap
 * Body: { from: int, to: int }
 *
 * Reordena dentro del banco. Casos:
 *   1. from vacio  -> no-op
 *   2. to vacio    -> mueve from a to
 *   3. ambos ocupados -> swap (NO hay merge porque UNIQUE(user_id, item_id))
 *
 * El truco del swap: tenemos UNIQUE(user_id, item_id) ademas de la PK
 * (user_id, slot_index). Si hacemos un UPDATE directo, en medio del batch
 * SQLite puede ver dos filas con el mismo item_id (la antigua + la nueva
 * con slot intermedio) y violar el UNIQUE. Solucion: borrar ambos y
 * re-insertar (mismo patron que swap inv slot4).
 */
async function handleBankSwap(request, env) {
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
    // No usamos UPDATE slot_index porque puede haber otros indices/restricciones.
    // Borrar+insertar es mas seguro y consistente con el patron del inv.
    await env.DB.batch([
      env.DB.prepare('DELETE FROM user_bank WHERE user_id = ? AND slot_index = ?').bind(session.user_id, from),
      env.DB.prepare(
        'INSERT INTO user_bank (user_id, slot_index, item_id, quantity, updated_at) VALUES (?, ?, ?, ?, ?)'
      ).bind(session.user_id, to, slotA.item_id, slotA.quantity, now),
    ]);
    return json({ ok: true });
  }

  // Ambos ocupados: swap. Borra ambos primero (evita violar UNIQUE durante el batch).
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

// ============================================================
// GRAND EXCHANGE — HANDLERS (Slice 4c)
// ============================================================
// Los handlers son thin wrappers sobre el engine (definido mas
// abajo en "GE ENGINE"). Cada handler:
//   1. Auth via requireSession
//   2. Parsea/valida input HTTP
//   3. Llama al engine con el db adapter
//   4. Mapea errores del engine a HTTP 4xx
//
// El engine NO sabe de HTTP. El adapter (makeDbAdapter) traduce
// env.DB (D1) a la interfaz {first, all, run, batch} que el
// engine espera. Esto permite testear el engine sobre SQLite
// local sin Cloudflare (ver tests/test_ge_engine.py).

/**
 * Crea un adapter D1 -> interfaz `db` del engine.
 * El engine no conoce env.DB; solo este adapter.
 */
function makeDbAdapter(env) {
  return {
    first: (sql, params = []) => env.DB.prepare(sql).bind(...params).first(),
    all: async (sql, params = []) => {
      const res = await env.DB.prepare(sql).bind(...params).all();
      return res.results || [];
    },
    run: (sql, params = []) => env.DB.prepare(sql).bind(...params).run(),
    batch: (stmts) => env.DB.batch(stmts.map(s => env.DB.prepare(s.sql).bind(...s.params))),
  };
}

/**
 * Mapea errores del engine a respuestas HTTP estandar.
 * El engine lanza Error con .code; los codigos conocidos van a 400.
 */
function geErrorResponse(err) {
  const known = new Set([
    'cannot_trade_coins', 'invalid_item', 'invalid_side', 'invalid_qty',
    'invalid_price', 'price_out_of_band', 'slots_full', 'insufficient_coins',
    'insufficient_items', 'not_found', 'not_owned', 'not_open',
    'use_seed_system_order', 'unknown_item',
    'cannot_claim_for_system', 'invalid_claim_target',
  ]);
  if (err && err.code && known.has(err.code)) {
    const body = { error: err.code, message: err.message };
    if (err.band) body.band = err.band;
    return json(body, 400);
  }
  console.error('[ge] unexpected:', err);
  return json({ error: 'internal_error', message: err?.message || 'unknown' }, 500);
}

/**
 * GET /api/ge/orders
 *
 * Devuelve:
 *   open: ordenes abiertas (max 8).
 *   collection: ordenes ya cerradas (completed o cancelled) con
 *               pending_coins>0 o pending_items>0. El user las
 *               reclamara con /api/ge/claim_all.
 *   recent: ordenes ya reclamadas (claimed_at != null) en ultimas 24h.
 *           Solo para histórico/feed.
 *   totals: agregados de pending para mostrar en los botones
 *           "→ Mochila" / "→ Banco".
 *
 * Nota: las open tambien pueden tener pending > 0 (fills parciales).
 * El cliente puede reclamar ese pending tambien con claim_all sin
 * cerrar la orden.
 */
async function handleGeGetOrders(request, env) {
  const session = await requireSession(request, env);
  if (!session) return json({ error: 'unauthorized' }, 401);

  const db = makeDbAdapter(env);
  const userId = session.user_id;

  // Abiertas (los 8 slots). Incluye pending_*.
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
    [userId, GE_STATUS_OPEN]
  );

  // Collection: cerradas con pending > 0 (NO reclamadas todavia)
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
    [userId, GE_STATUS_COMPLETED, GE_STATUS_CANCELLED]
  );

  // Recent: cerradas SIN pending (ya reclamadas) en ultimas 24h.
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
    [userId, GE_STATUS_COMPLETED, GE_STATUS_CANCELLED, since]
  );

  // Totales para botones de claim. Aggregamos coins + items por item_id
  // sumando tanto open con pending parcial como collection.
  // Open con pending y collection son disjuntos en estado, asi que
  // los sumamos juntos.
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
  const itemsBy = {}; // { item_id: qty }
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
    maxSlots: GE_MAX_ORDER_SLOTS_PER_USER,
  });
}

/**
 * POST /api/ge/place  { item_id, side: "buy"|"sell", price, qty }
 */
async function handleGePlace(request, env) {
  const session = await requireSession(request, env);
  if (!session) return json({ error: 'unauthorized' }, 401);

  const body = await readJson(request);
  if (!body) return json({ error: 'bad_request' }, 400);

  // Normalizar side ("buy"/"sell" o 0/1)
  let side;
  if (body.side === 'buy' || body.side === 0)  side = GE_SIDE_BUY;
  else if (body.side === 'sell' || body.side === 1) side = GE_SIDE_SELL;
  else return json({ error: 'invalid_side', message: 'side debe ser "buy" o "sell".' }, 400);

  const db = makeDbAdapter(env);
  try {
    const result = await gePlaceOrder(db, session.user_id, {
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

/**
 * POST /api/ge/cancel  { order_id }
 */
async function handleGeCancel(request, env) {
  const session = await requireSession(request, env);
  if (!session) return json({ error: 'unauthorized' }, 401);

  const body = await readJson(request);
  if (!body || !Number.isInteger(body.order_id)) return json({ error: 'bad_request' }, 400);

  const db = makeDbAdapter(env);
  try {
    await geCancelOrder(db, session.user_id, body.order_id);
    return json({ ok: true });
  } catch (err) {
    return geErrorResponse(err);
  }
}

/**
 * POST /api/ge/claim_all  { target: "inventory" | "bank" }
 *
 * Reclama todo el pending del user a target.
 * - bank: siempre completo.
 * - inventory: por orden. Si no cabe, queda en remaining.
 *
 * Devuelve { claimed: [...], remaining: [...] }.
 */
async function handleGeClaimAll(request, env) {
  const session = await requireSession(request, env);
  if (!session) return json({ error: 'unauthorized' }, 401);

  const body = await readJson(request);
  if (!body || typeof body.target !== 'string') return json({ error: 'bad_request' }, 400);

  const db = makeDbAdapter(env);
  try {
    const result = await geClaimAll(db, session.user_id, body.target);
    return json(result);
  } catch (err) {
    return geErrorResponse(err);
  }
}

/**
 * GET /api/ge/item/:id
 * Info de mercado para mostrar en la pantalla "place order".
 */
async function handleGeItemInfo(request, env, itemId) {
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

    const guide = await geGetGuidePrice(db, itemId);
    const suggested = await geGetSuggestedPrice(db, itemId);
    const band = await geGetPriceBand(db, itemId);
    const bestBuy = await db.first(
      `SELECT price FROM ge_orders WHERE item_id = ? AND side = ? AND status = ?
       ORDER BY price DESC, created_at ASC LIMIT 1`,
      [itemId, GE_SIDE_BUY, GE_STATUS_OPEN]
    );
    const bestSell = await db.first(
      `SELECT price FROM ge_orders WHERE item_id = ? AND side = ? AND status = ?
       ORDER BY price ASC, created_at ASC LIMIT 1`,
      [itemId, GE_SIDE_SELL, GE_STATUS_OPEN]
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

/**
 * GET /api/ge/item/:id/history?days=7
 */
async function handleGeItemHistory(request, env, itemId) {
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

/**
 * GET /api/ge/search?q=X
 * Busqueda case-insensitive en nombre o id. Excluye coins.
 */
async function handleGeSearch(request, env) {
  const session = await requireSession(request, env);
  if (!session) return json({ error: 'unauthorized' }, 401);

  const url = new URL(request.url);
  const q = (url.searchParams.get('q') || '').trim().toLowerCase();
  const db = makeDbAdapter(env);

  let rows;
  if (q.length === 0) {
    // Sin query: top 20 items por base_price descendente (mas "valiosos" primero)
    rows = await db.all(
      `SELECT id, name, icon, stackable, base_price FROM items
       WHERE id != ?
       ORDER BY base_price DESC
       LIMIT 20`,
      [GE_COIN_ITEM_ID]
    );
  } else {
    const like = `%${q}%`;
    rows = await db.all(
      `SELECT id, name, icon, stackable, base_price FROM items
       WHERE id != ? AND (LOWER(id) LIKE ? OR LOWER(name) LIKE ?)
       ORDER BY base_price DESC
       LIMIT 20`,
      [GE_COIN_ITEM_ID, like, like]
    );
  }

  // Anadir suggested_price a cada uno (mid o guide). Util para UI.
  const items = [];
  for (const r of rows) {
    const sp = await geGetSuggestedPrice(db, r.id);
    items.push({ ...r, suggested_price: sp });
  }
  return json({ items });
}

// ============================================================
// GE ENGINE v2 (inline en worker.js para deploy sin bundler)
// ============================================================
// CANONICAL: este bloque DEBE coincidir 1:1 con server/ge_engine.js
// del repo. Si tocas uno, toca el otro. Los tests viven en
// tests/test_ge_engine_v2.py (72 asserts).
//
// CAMBIO RESPECTO A v1 (Slice 4c original):
//   - place sell -> retira items de user_inventory (no de user_bank)
//   - place buy  -> retira coins de user_inventory (no de user_bank)
//   - match      -> acumula resultado en pending_coins / pending_items
//                   de la propia orden (NO toca bank ni inv)
//   - cancel     -> mueve escrow restante a pending_*
//   - claim_all  -> el user reclama todo a target (inventory|bank)
//
// INVARIANTES:
//  I1. coin_escrow == (qty_total - qty_filled) * price para buys abiertas
//  I2. item_escrow == (qty_total - qty_filled) para sells abiertas
//  I3. Maker-takes-price: precio del match = precio de la orden mas antigua
//  I4. Sin self-trade (buy.user_id != sell.user_id)
//  I5. Fantasmas con created_at GE_GHOST_TIMESTAMP_FAR_FUTURE -> pierden tiebreak
//  I6. Atomicidad: cada place/cancel/match/claim por orden es un solo batch
//  I7. Conservacion de valor: inv + bank + escrow + pending = constante
//      (solo para reales; SYSTEM rompe I7 a proposito - I8)
//  I8. SYSTEM (user_id=0) no acumula pending (liquidez generada/destruida).

async function geGetGuidePrice(db, itemId) {
  const item = await db.first('SELECT base_price FROM items WHERE id = ?', [itemId]);
  if (!item) throw geMakeErr('unknown_item');
  const since = Date.now() - 24 * 60 * 60 * 1000;
  const recent = await db.first(
    `SELECT SUM(matched_price * qty) AS num, SUM(qty) AS den
     FROM ge_history WHERE item_id = ? AND matched_at >= ?`,
    [itemId, since]
  );
  if (recent && recent.den) return Math.round(recent.num / recent.den);
  return item.base_price;
}

async function geGetSuggestedPrice(db, itemId) {
  const bestBuy = await db.first(
    `SELECT price FROM ge_orders
     WHERE item_id = ? AND side = ? AND status = ?
     ORDER BY price DESC, created_at ASC LIMIT 1`,
    [itemId, GE_SIDE_BUY, GE_STATUS_OPEN]
  );
  const bestSell = await db.first(
    `SELECT price FROM ge_orders
     WHERE item_id = ? AND side = ? AND status = ?
     ORDER BY price ASC, created_at ASC LIMIT 1`,
    [itemId, GE_SIDE_SELL, GE_STATUS_OPEN]
  );
  if (bestBuy && bestSell) return Math.round((bestBuy.price + bestSell.price) / 2);
  if (bestBuy) return bestBuy.price;
  if (bestSell) return bestSell.price;
  return await geGetGuidePrice(db, itemId);
}

async function geGetPriceBand(db, itemId, bps = GE_PRICE_BAND_BPS) {
  const guide = await geGetGuidePrice(db, itemId);
  const pctDelta = Math.round((guide * bps) / GE_BPS_DIVISOR);
  const delta = Math.max(GE_PRICE_BAND_FLOOR_ABS, pctDelta);
  return { guide, min: Math.max(1, guide - delta), max: guide + delta };
}

async function geValidateOrderShape(db, { itemId, side, price, qty }) {
  if (itemId === GE_COIN_ITEM_ID) throw geMakeErr('cannot_trade_coins');
  const item = await db.first('SELECT id, stackable FROM items WHERE id = ?', [itemId]);
  if (!item) throw geMakeErr('invalid_item');
  if (side !== GE_SIDE_BUY && side !== GE_SIDE_SELL) throw geMakeErr('invalid_side');
  if (!Number.isInteger(qty) || qty <= 0) throw geMakeErr('invalid_qty');
  if (!Number.isInteger(price) || price <= 0) throw geMakeErr('invalid_price');
  const band = await geGetPriceBand(db, itemId);
  if (price < band.min || price > band.max) {
    const e = geMakeErr('price_out_of_band');
    e.band = band;
    throw e;
  }
  return { item, band };
}

async function geCountOpenSlots(db, userId) {
  const row = await db.first(
    'SELECT COUNT(*) AS n FROM ge_orders WHERE user_id = ? AND status = ?',
    [userId, GE_STATUS_OPEN]
  );
  return row?.n ?? 0;
}

// ---- PLACE ORDER v2: retira de user_inventory ----
async function gePlaceOrder(db, userId, { itemId, side, price, qty }) {
  if (userId === GE_SYSTEM_USER_ID) throw geMakeErr('use_seed_system_order');
  await geValidateOrderShape(db, { itemId, side, price, qty });
  const openCount = await geCountOpenSlots(db, userId);
  if (openCount >= GE_MAX_ORDER_SLOTS_PER_USER) throw geMakeErr('slots_full');

  const now = Date.now();
  const stmts = [];

  const withdrawItemId = side === GE_SIDE_BUY ? GE_COIN_ITEM_ID : itemId;
  const withdrawQty = side === GE_SIDE_BUY ? price * qty : qty;

  const inv = await geLoadInventoryState(db, userId);
  const have = geSumInventory(inv, withdrawItemId);
  if (have < withdrawQty) {
    throw geMakeErr(side === GE_SIDE_BUY ? 'insufficient_coins' : 'insufficient_items');
  }
  geRemoveFromInventory(stmts, inv, userId, withdrawItemId, withdrawQty, now);

  const coinEscrow = side === GE_SIDE_BUY ? price * qty : 0;
  const itemEscrow = side === GE_SIDE_SELL ? qty : 0;

  stmts.push({
    sql: `INSERT INTO ge_orders
            (user_id, item_id, side, price, qty_total, qty_filled, status,
             coin_escrow, item_escrow, avg_fill_price, coins_recovered,
             pending_coins, pending_items, created_at)
          VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, 0, 0, 0, 0, ?)`,
    params: [userId, itemId, side, price, qty, GE_STATUS_OPEN, coinEscrow, itemEscrow, now],
  });

  await db.batch(stmts);
  const row = await db.first(
    `SELECT id FROM ge_orders
     WHERE user_id = ? AND created_at = ? AND item_id = ? AND side = ?
     ORDER BY id DESC LIMIT 1`,
    [userId, now, itemId, side]
  );
  return { orderId: row.id, escrowMoved: side === GE_SIDE_BUY ? coinEscrow : itemEscrow };
}

// ---- CANCEL v2: escrow restante a pending_* ----
async function geCancelOrder(db, userId, orderId) {
  const order = await db.first('SELECT * FROM ge_orders WHERE id = ?', [orderId]);
  if (!order) throw geMakeErr('not_found');
  if (order.user_id !== userId) throw geMakeErr('not_owned');
  if (order.status !== GE_STATUS_OPEN) throw geMakeErr('not_open');

  const now = Date.now();
  const stmts = [];

  if (userId === GE_SYSTEM_USER_ID) {
    stmts.push({
      sql: `UPDATE ge_orders SET status = ?, coin_escrow = 0, item_escrow = 0, completed_at = ?
            WHERE id = ?`,
      params: [GE_STATUS_CANCELLED, now, orderId],
    });
    await db.batch(stmts);
    return { ok: true };
  }

  const dPC = order.side === GE_SIDE_BUY ? order.coin_escrow : 0;
  const dPI = order.side === GE_SIDE_SELL ? order.item_escrow : 0;

  stmts.push({
    sql: `UPDATE ge_orders
            SET status = ?, coin_escrow = 0, item_escrow = 0, completed_at = ?,
                pending_coins = pending_coins + ?, pending_items = pending_items + ?
          WHERE id = ?`,
    params: [GE_STATUS_CANCELLED, now, dPC, dPI, orderId],
  });

  await db.batch(stmts);
  return { ok: true };
}

// ---- MATCHER ----
async function geRunMatcher(db) {
  const items = await db.all(`SELECT DISTINCT item_id FROM ge_orders WHERE status = ?`, [GE_STATUS_OPEN]);
  let total = 0;
  const touched = [];
  for (const { item_id } of items) {
    const n = await geMatchItem(db, item_id);
    if (n > 0) { total += n; touched.push(item_id); }
  }
  return { matches: total, items: touched };
}

async function geMatchItem(db, itemId) {
  let matches = 0;
  const buys = await db.all(
    `SELECT * FROM ge_orders WHERE item_id = ? AND side = ? AND status = ?
     ORDER BY price DESC, created_at ASC, id ASC`,
    [itemId, GE_SIDE_BUY, GE_STATUS_OPEN]
  );
  const sells = await db.all(
    `SELECT * FROM ge_orders WHERE item_id = ? AND side = ? AND status = ?
     ORDER BY price ASC, created_at ASC, id ASC`,
    [itemId, GE_SIDE_SELL, GE_STATUS_OPEN]
  );
  if (buys.length === 0 || sells.length === 0) return 0;

  let bi = 0, si = 0;
  while (bi < buys.length && si < sells.length) {
    const buy = buys[bi];
    const sell = sells[si];
    if (buy.price < sell.price) break;
    if (buy.user_id === sell.user_id) { si++; continue; }

    const remBuy = buy.qty_total - buy.qty_filled;
    const remSell = sell.qty_total - sell.qty_filled;
    const qty = Math.min(remBuy, remSell);
    const buyOlder = buy.created_at < sell.created_at
      || (buy.created_at === sell.created_at && buy.id < sell.id);
    const matchPrice = buyOlder ? buy.price : sell.price;

    await geApplyMatch(db, buy, sell, qty, matchPrice);
    matches++;

    const buyerReserved = buy.price * qty;
    const buyerSpend = matchPrice * qty;
    const refund = buyerReserved - buyerSpend;
    buy.avg_fill_price = geWeightedAvg(buy.avg_fill_price, buy.qty_filled, matchPrice, qty);
    buy.qty_filled += qty;
    buy.coin_escrow -= buyerReserved;
    buy.coins_recovered += refund;
    if (buy.user_id !== GE_SYSTEM_USER_ID) {
      buy.pending_items = (buy.pending_items || 0) + qty;
      buy.pending_coins = (buy.pending_coins || 0) + refund;
    }
    sell.avg_fill_price = geWeightedAvg(sell.avg_fill_price, sell.qty_filled, matchPrice, qty);
    sell.qty_filled += qty;
    sell.item_escrow -= qty;
    if (sell.user_id !== GE_SYSTEM_USER_ID) {
      sell.pending_coins = (sell.pending_coins || 0) + buyerSpend;
    }
    if (buy.qty_filled === buy.qty_total) bi++;
    if (sell.qty_filled === sell.qty_total) si++;
  }
  return matches;
}

async function geApplyMatch(db, buy, sell, qty, matchPrice) {
  const now = Date.now();
  const stmts = [];
  const buyerSpend = matchPrice * qty;
  const buyerReserved = buy.price * qty;
  const refund = buyerReserved - buyerSpend;

  const newBuyFilled = buy.qty_filled + qty;
  const newBuyEscrow = buy.coin_escrow - buyerReserved;
  const newBuyStatus = newBuyFilled === buy.qty_total ? GE_STATUS_COMPLETED : GE_STATUS_OPEN;
  const newBuyCompletedAt = newBuyStatus === GE_STATUS_COMPLETED ? now : null;
  const newBuyAvg = geWeightedAvg(buy.avg_fill_price, buy.qty_filled, matchPrice, qty);
  const newBuyRecovered = buy.coins_recovered + refund;
  const buyPI = buy.user_id === GE_SYSTEM_USER_ID ? 0 : qty;
  const buyPC = buy.user_id === GE_SYSTEM_USER_ID ? 0 : refund;

  stmts.push({
    sql: `UPDATE ge_orders
            SET qty_filled = ?, coin_escrow = ?, status = ?, completed_at = ?,
                avg_fill_price = ?, coins_recovered = ?,
                pending_items = pending_items + ?, pending_coins = pending_coins + ?
          WHERE id = ?`,
    params: [newBuyFilled, newBuyEscrow, newBuyStatus, newBuyCompletedAt,
             newBuyAvg, newBuyRecovered, buyPI, buyPC, buy.id],
  });

  const newSellFilled = sell.qty_filled + qty;
  const newSellItemEscrow = sell.item_escrow - qty;
  const newSellStatus = newSellFilled === sell.qty_total ? GE_STATUS_COMPLETED : GE_STATUS_OPEN;
  const newSellCompletedAt = newSellStatus === GE_STATUS_COMPLETED ? now : null;
  const newSellAvg = geWeightedAvg(sell.avg_fill_price, sell.qty_filled, matchPrice, qty);
  const sellPC = sell.user_id === GE_SYSTEM_USER_ID ? 0 : buyerSpend;

  stmts.push({
    sql: `UPDATE ge_orders
            SET qty_filled = ?, item_escrow = ?, status = ?, completed_at = ?,
                avg_fill_price = ?, pending_coins = pending_coins + ?
          WHERE id = ?`,
    params: [newSellFilled, newSellItemEscrow, newSellStatus, newSellCompletedAt,
             newSellAvg, sellPC, sell.id],
  });

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

// ---- CLAIM ALL (v2) ----
async function geClaimAll(db, userId, target) {
  if (userId === GE_SYSTEM_USER_ID) throw geMakeErr('cannot_claim_for_system');
  if (target !== GE_CLAIM_TARGET_INVENTORY && target !== GE_CLAIM_TARGET_BANK) {
    throw geMakeErr('invalid_claim_target');
  }

  const pending = await db.all(
    `SELECT * FROM ge_orders
     WHERE user_id = ? AND (pending_coins > 0 OR pending_items > 0)
     ORDER BY id ASC`,
    [userId]
  );

  const claimed = [];
  const remaining = [];
  if (pending.length === 0) return { claimed, remaining };

  let invState = null, bankState = null;
  if (target === GE_CLAIM_TARGET_INVENTORY) invState = await geLoadInventoryState(db, userId);
  else bankState = await geLoadBankState(db, userId);

  for (const o of pending) {
    const pC = o.pending_coins;
    const pI = o.pending_items;
    const deposits = [];
    if (pC > 0) deposits.push({ itemId: GE_COIN_ITEM_ID, qty: pC, stackable: true });
    if (pI > 0) {
      const meta = await db.first('SELECT stackable FROM items WHERE id = ?', [o.item_id]);
      deposits.push({ itemId: o.item_id, qty: pI, stackable: !!(meta && meta.stackable) });
    }

    if (target === GE_CLAIM_TARGET_INVENTORY) {
      const snap = geSnapshotInventoryState(invState);
      const tentative = [];
      let fitAll = true;
      for (const d of deposits) {
        if (!geTryDepositToInventory(tentative, invState, userId, d.itemId, d.qty, d.stackable, Date.now())) {
          fitAll = false; break;
        }
      }
      if (!fitAll) {
        geRestoreInventoryState(invState, snap);
        remaining.push({ orderId: o.id, coins: pC, items: pI, item_id: o.item_id, reason: 'inventory_full' });
        continue;
      }
      const now = Date.now();
      const shouldClaim = o.status !== GE_STATUS_OPEN;
      tentative.push({
        sql: shouldClaim
          ? `UPDATE ge_orders SET pending_coins = 0, pending_items = 0, claimed_at = ? WHERE id = ?`
          : `UPDATE ge_orders SET pending_coins = 0, pending_items = 0 WHERE id = ?`,
        params: shouldClaim ? [now, o.id] : [o.id],
      });
      await db.batch(tentative);
      claimed.push({ orderId: o.id, coins: pC, items: pI, item_id: o.item_id });
    } else {
      const stmts = [];
      const now = Date.now();
      for (const d of deposits) geAddBankDeposit(stmts, bankState, userId, d.itemId, d.qty, now);
      const shouldClaim = o.status !== GE_STATUS_OPEN;
      stmts.push({
        sql: shouldClaim
          ? `UPDATE ge_orders SET pending_coins = 0, pending_items = 0, claimed_at = ? WHERE id = ?`
          : `UPDATE ge_orders SET pending_coins = 0, pending_items = 0 WHERE id = ?`,
        params: shouldClaim ? [now, o.id] : [o.id],
      });
      await db.batch(stmts);
      claimed.push({ orderId: o.id, coins: pC, items: pI, item_id: o.item_id });
    }
  }

  return { claimed, remaining };
}

// ---- RESEED ----
async function geReseedGhostOrders(db) {
  const configs = await db.all('SELECT * FROM ge_seed_config');
  let inserted = 0;
  for (const c of configs) {
    const guideRow = await db.first('SELECT base_price FROM items WHERE id = ?', [c.item_id]);
    if (!guideRow) continue;
    const guide = guideRow.base_price;
    const offset = Math.round((guide * c.price_offset_bps) / GE_BPS_DIVISOR);
    const price = Math.max(1, guide + offset);

    const sumRow = await db.first(
      `SELECT COALESCE(SUM(qty_total - qty_filled), 0) AS open_qty
       FROM ge_orders WHERE user_id = ? AND item_id = ? AND side = ? AND status = ?`,
      [GE_SYSTEM_USER_ID, c.item_id, c.side, GE_STATUS_OPEN]
    );
    const openQty = sumRow.open_qty;
    const deficit = c.target_volume - openQty;
    if (deficit <= 0) continue;

    const coinEscrow = c.side === GE_SIDE_BUY  ? price * deficit : 0;
    const itemEscrow = c.side === GE_SIDE_SELL ? deficit         : 0;

    await db.run(
      `INSERT INTO ge_orders
         (user_id, item_id, side, price, qty_total, qty_filled, status,
          coin_escrow, item_escrow, avg_fill_price, coins_recovered,
          pending_coins, pending_items, created_at)
       VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, 0, 0, 0, 0, ?)`,
      [GE_SYSTEM_USER_ID, c.item_id, c.side, price, deficit, GE_STATUS_OPEN,
       coinEscrow, itemEscrow, GE_GHOST_TIMESTAMP_FAR_FUTURE]
    );
    inserted++;
  }
  return { inserted };
}

// ---- HELPERS: INVENTORY ----

async function geLoadInventoryState(db, userId) {
  const rows = await db.all(
    `SELECT inv.slot_index, inv.item_id, inv.quantity, i.stackable
     FROM user_inventory inv LEFT JOIN items i ON i.id = inv.item_id
     WHERE inv.user_id = ?`,
    [userId]
  );
  const slots = new Array(GE_INVENTORY_SLOT_COUNT).fill(null);
  for (const r of rows) {
    if (r.slot_index < 0 || r.slot_index >= GE_INVENTORY_SLOT_COUNT) continue;
    slots[r.slot_index] = { item_id: r.item_id, quantity: r.quantity, stackable: !!r.stackable };
  }
  return { slots };
}

function geSnapshotInventoryState(state) {
  return { slots: state.slots.map(s => s ? { ...s } : null) };
}

function geRestoreInventoryState(state, snapshot) {
  for (let i = 0; i < GE_INVENTORY_SLOT_COUNT; i++) {
    state.slots[i] = snapshot.slots[i] ? { ...snapshot.slots[i] } : null;
  }
}

function geSumInventory(state, itemId) {
  let total = 0;
  for (const s of state.slots) {
    if (s && s.item_id === itemId) total += s.quantity;
  }
  return total;
}

function geRemoveFromInventory(stmts, state, userId, itemId, qty, now) {
  const candidates = [];
  for (let i = 0; i < GE_INVENTORY_SLOT_COUNT; i++) {
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
  if (toRemove > 0) throw geMakeErr('insufficient_inventory_consistency');
}

function geTryDepositToInventory(stmts, state, userId, itemId, qty, stackable, now) {
  if (stackable) {
    for (let i = 0; i < GE_INVENTORY_SLOT_COUNT; i++) {
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
    for (let i = 0; i < GE_INVENTORY_SLOT_COUNT; i++) {
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
  const freeSlots = [];
  for (let i = 0; i < GE_INVENTORY_SLOT_COUNT; i++) {
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

// ---- HELPERS: BANK ----

async function geLoadBankState(db, userId) {
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

function geAddBankDeposit(stmts, state, userId, itemId, qty, now) {
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

// ---- OTROS ----

function geWeightedAvg(prevAvg, prevQty, newPrice, newQty) {
  if (prevQty === 0) return newPrice;
  return ((prevAvg * prevQty) + (newPrice * newQty)) / (prevQty + newQty);
}

function geMakeErr(code) {
  const e = new Error(code);
  e.code = code;
  return e;
}

// ---------- Session helpers ----------

async function createSession(env, userId) {
  const tokenBytes = crypto.getRandomValues(new Uint8Array(32));
  const token = bytesToHex(tokenBytes);
  const now = Date.now();
  const expiresAt = now + SESSION_LIFETIME_MS;
  await env.DB.prepare(
    'INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)'
  ).bind(token, userId, now, expiresAt).run();
  return token;
}

async function requireSession(request, env) {
  const token = bearerToken(request);
  if (!token) return null;
  const session = await env.DB.prepare(
    'SELECT token, user_id, expires_at FROM sessions WHERE token = ?'
  ).bind(token).first();
  if (!session) return null;
  if (session.expires_at < Date.now()) {
    await env.DB.prepare('DELETE FROM sessions WHERE token = ?').bind(token).run();
    return null;
  }
  return session;
}

function bearerToken(request) {
  const auth = request.headers.get('Authorization') || '';
  const match = auth.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

// ---------- Password hashing ----------

async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(password, salt, PBKDF2_ITERATIONS);
  return `pbkdf2$${PBKDF2_ITERATIONS}$${bytesToHex(salt)}$${bytesToHex(hash)}`;
}

async function verifyPassword(password, stored) {
  const parts = stored.split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false;
  const iterations = parseInt(parts[1], 10);
  const salt = hexToBytes(parts[2]);
  const expected = hexToBytes(parts[3]);
  const actual = await pbkdf2(password, salt, iterations);
  return timingSafeEqual(expected, actual);
}

async function pbkdf2(password, salt, iterations) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    key, 256
  );
  return new Uint8Array(bits);
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

// ---------- Utilities ----------

function bytesToHex(bytes) {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

function hexToBytes(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}

async function readJson(request) {
  try { return await request.json(); } catch { return null; }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// ---------- CORS ----------

function originAllowed(origin, env) {
  if (!origin) return false;
  const allowed = (env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim());
  return allowed.includes(origin) || allowed.includes('*');
}

function corsResponse(request, env) {
  const origin = request.headers.get('Origin') || '';
  const headers = {
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
  };
  if (originAllowed(origin, env)) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Vary'] = 'Origin';
  }
  return new Response(null, { status: 204, headers });
}

function withCors(response, request, env) {
  const origin = request.headers.get('Origin') || '';
  if (originAllowed(origin, env)) {
    const headers = new Headers(response.headers);
    headers.set('Access-Control-Allow-Origin', origin);
    headers.set('Vary', 'Origin');
    return new Response(response.body, { status: response.status, headers });
  }
  return response;
}
