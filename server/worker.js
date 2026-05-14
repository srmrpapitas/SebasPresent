/**
 * SebasPresent — Auth + Position + Inventory + Bank + GE + Combat Worker
 *
 * Slice 4c v2 (Grand Exchange collection box) + Slice 5a (combat melee)
 * + Slice 5b (combat styles + xp routing OSRS-exact).
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
 *   POST /api/ge/place   { item_id, side, price, qty } → { orderId, escrowMoved }
 *   POST /api/ge/cancel  { order_id } → { ok: true }
 *   POST /api/ge/claim_all { target: "inventory" | "bank" } → { claimed, remaining }
 *   GET  /api/ge/item/:id            → info de mercado del item
 *   GET  /api/ge/item/:id/history?days=7 → puntos para grafico
 *   GET  /api/ge/search?q=X          → busqueda de items
 *
 *   Combat (Slice 5a + 5b):
 *   GET  /api/combat/state           → stats + npcs + position + combat_style
 *   POST /api/combat/attack          → ataque (cooldown 600ms, XP por style)
 *   POST /api/combat/respawn         → revive al player muerto
 *   POST /api/combat/style { style } → SLICE 5B — set combat style
 *
 *   Scheduled handler (cron, definido en wrangler.toml):
 *     Cada 1 min: matcher + reseed fantasmas + revive NPCs.
 *
 *   GET  /api/health → { ok: true, ts }
 */

// ---------- Configuration ----------

const PBKDF2_ITERATIONS = 100_000;
const SESSION_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;
const USERNAME_REGEX = /^[a-zA-Z0-9_]{3,16}$/;
const PASSWORD_MIN_LENGTH = 6;

const WORLD_HALF = 2048;
const INVENTORY_SLOTS = 28;

// Banco: en OSRS son 800+ slots. Ponemos un techo razonable para alpha.
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
const GE_PRICE_BAND_FLOOR_ABS = 5;
const GE_BPS_DIVISOR = 10_000;
const GE_GHOST_TIMESTAMP_FAR_FUTURE = 9_999_999_999_999;

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
      } else if (url.pathname === '/api/combat/state' && request.method === 'GET') {
        response = await handleCombatState(request, env);
      } else if (url.pathname === '/api/combat/attack' && request.method === 'POST') {
        response = await handleCombatAttack(request, env);
      } else if (url.pathname === '/api/combat/respawn' && request.method === 'POST') {
        response = await handleCombatRespawn(request, env);
      } else if (url.pathname === '/api/combat/style' && request.method === 'POST') {
        // Slice 5b
        response = await handleCombatStyle(request, env);
      } else if (url.pathname === '/api/world/heartbeat' && request.method === 'POST') {
        // Slice 5c.5 — multiplayer
        response = await handleWorldHeartbeat(request, env);
      } else if (url.pathname === '/api/world/peers' && request.method === 'GET') {
        // Slice 5c.5 — multiplayer
        response = await handleWorldPeers(request, env);
      } else if (url.pathname === '/api/magic/home_teleport' && request.method === 'POST') {
        // Home Teleport: comienza el cast (10s)
        response = await handleHomeTeleportStart(request, env);
      } else if (url.pathname === '/api/magic/home_teleport/cancel' && request.method === 'POST') {
        // Home Teleport: cancel (movimiento o daño)
        response = await handleHomeTeleportCancel(request, env);
      } else if (url.pathname === '/api/magic/home_teleport/finish' && request.method === 'POST') {
        // Home Teleport: confirma teleport tras 10s sin cancelación
        response = await handleHomeTeleportFinish(request, env);
      } else if (url.pathname === '/api/ground_items' && request.method === 'GET') {
        // Slice 5c — drops: listar items en el suelo cerca del player
        response = await handleGroundItemsList(request, env);
      } else if (url.pathname === '/api/ground_items/pickup' && request.method === 'POST') {
        // Slice 5c — drops: recoger uno o varios items del suelo
        response = await handleGroundItemsPickup(request, env);
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

  async scheduled(event, env, ctx) {
    const db = makeDbAdapter(env);
    try {
      const matched = await geRunMatcher(db);
      const reseed = await geReseedGhostOrders(db);
      console.log(`[ge-cron] matches=${matched.matches} items=${matched.items.join(',')} reseed=${reseed.inserted}`);
    } catch (err) {
      console.error('[ge-cron] error:', err);
    }
    try {
      const revived = await combatReviveExpiredNpcs(db, {});
      if (revived.revived > 0) {
        console.log(`[combat-cron] revived=${revived.revived}`);
      }
    } catch (err) {
      console.error('[combat-cron] error:', err);
    }
    // Slice 5c — limpia items en el suelo cuyo despawn_at venció.
    try {
      const cleaned = await env.DB.prepare(
        'DELETE FROM ground_items WHERE despawn_at <= ?'
      ).bind(Date.now()).run();
      const changes = cleaned?.meta?.changes || 0;
      if (changes > 0) {
        console.log(`[ground-items-cron] cleaned=${changes}`);
      }
    } catch (err) {
      console.error('[ground-items-cron] error:', err);
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

  const available = invRow.quantity;
  if (qty === -1) qty = available;
  if (qty > available) qty = available;
  if (invRow.stackable !== 1 && qty > 1) qty = 1;

  const itemId = invRow.item_id;
  const now = Date.now();

  const bankRow = await env.DB.prepare(
    'SELECT slot_index, quantity FROM user_bank WHERE user_id = ? AND item_id = ?'
  ).bind(session.user_id, itemId).first();

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
    ).bind(session.user_id, nextSlot, itemId, qty, now));
  }

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
  return json({ ok: true });
}

function pickInvSlot(invMap, target) {
  if (target !== undefined && target !== null && !invMap.has(target)) {
    return target;
  }
  for (let i = 0; i < INVENTORY_SLOTS; i++) {
    if (!invMap.has(i)) return i;
  }
  return null;
}

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

// ============================================================
// GRAND EXCHANGE — HANDLERS (Slice 4c)
// ============================================================

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

async function handleGeGetOrders(request, env) {
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
    [userId, GE_STATUS_OPEN]
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
    [userId, GE_STATUS_COMPLETED, GE_STATUS_CANCELLED]
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
    [userId, GE_STATUS_COMPLETED, GE_STATUS_CANCELLED, since]
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
    maxSlots: GE_MAX_ORDER_SLOTS_PER_USER,
  });
}

async function handleGePlace(request, env) {
  const session = await requireSession(request, env);
  if (!session) return json({ error: 'unauthorized' }, 401);

  const body = await readJson(request);
  if (!body) return json({ error: 'bad_request' }, 400);

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

async function handleGeSearch(request, env) {
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

// ============================================================
// COMBAT (Slice 5a + 5b) — handlers + engine inline
// ============================================================
// El engine es una copia inline del modulo standalone server/combat_engine.js
// con prefijo "combat" en los simbolos top-level. Slice 5b añade combat_style
// con routing OSRS-exact en combatAwardXp.
// ============================================================

const COMBAT_XP_TABLE = [
  0,         83,        174,       276,       388,       512,       650,       801,       969,       1154,
  1358,      1584,      1833,      2107,      2411,      2746,      3115,      3523,      3973,      4470,
  5018,      5624,      6291,      7028,      7842,      8740,      9730,      10824,     12031,     13363,
  14833,     16456,     18247,     20224,     22406,     24815,     27473,     30408,     33648,     37224,
  41171,     45529,     50339,     55649,     61512,     67983,     75127,     83014,     91721,     101333,
  111945,    123660,    136594,    150872,    166636,    184040,    203254,    224466,    247886,    273742,
  302288,    333804,    368599,    407015,    449428,    496254,    547953,    605032,    668051,    737627,
  814445,    899257,    992895,    1096278,   1210421,   1336443,   1475581,   1629200,   1798808,   1986068,
  2192818,   2421087,   2673114,   2951373,   3258594,   3597792,   3972294,   4385776,   4842295,   5346332,
  5902831,   6517253,   7195629,   7944614,   8771558,   9684577,   10692629,  11805606,  13034431
];

const COMBAT_TICK_MS = 600;
const COMBAT_RANGE_TOLERANCE = 0.5;
const COMBAT_MAX_LEVEL = 99;

// Slice 5b — combat styles validos. Default = 'controlled' (OSRS).
const COMBAT_VALID_STYLES = ['accurate', 'aggressive', 'defensive', 'controlled'];
const COMBAT_DEFAULT_STYLE = 'controlled';

function combatLevelFromXp(xp) {
  if (xp < 0) return 1;
  for (let lvl = COMBAT_MAX_LEVEL; lvl >= 1; lvl--) {
    if (xp >= COMBAT_XP_TABLE[lvl - 1]) return lvl;
  }
  return 1;
}

function combatXpForLevel(level) {
  if (level < 1) return 0;
  if (level > COMBAT_MAX_LEVEL) return COMBAT_XP_TABLE[COMBAT_MAX_LEVEL - 1];
  return COMBAT_XP_TABLE[level - 1];
}

function combatEffectiveLevel(level) { return level + 8; }

function combatCalcHitChance(attackerAtkLvl, defenderDefLvl) {
  const attackRoll = combatEffectiveLevel(attackerAtkLvl) * 64;
  const defenceRoll = combatEffectiveLevel(defenderDefLvl) * 64;
  if (attackRoll > defenceRoll) {
    return 1 - (defenceRoll + 2) / (2 * (attackRoll + 1));
  }
  return attackRoll / (2 * (defenceRoll + 1));
}

function combatCalcMaxHit(strengthLvl) {
  return Math.floor((combatEffectiveLevel(strengthLvl) + 5) / 10);
}

function combatRollHit(rng, attackerAtkLvl, defenderDefLvl, maxHit) {
  const chance = combatCalcHitChance(attackerAtkLvl, defenderDefLvl);
  const r1 = rng();
  if (r1 >= chance) return { hit: false, damage: 0 };
  const r2 = rng();
  return { hit: true, damage: Math.floor(r2 * (maxHit + 1)) };
}

/**
 * Slice 5b — XP por estilo de combate (OSRS-exact).
 *
 *   accurate    → +4 Attack/dmg     + 1.33 HP/dmg
 *   aggressive  → +4 Strength/dmg   + 1.33 HP/dmg
 *   defensive   → +4 Defence/dmg    + 1.33 HP/dmg
 *   controlled  → +1.33 Atk +1.33 Str +1.33 Def + 1.33 HP por dmg
 *
 * Total XP por dmg = 5.33 (focused 4 + HP 1.33, o sea ~4/3 a las 4 skills
 * en controlled). Esto coincide 1:1 con OSRS Wiki.
 */
function combatAwardXp(stats, damage, style) {
  if (damage <= 0) return { attack: 0, strength: 0, defence: 0, hp: 0 };
  const shared  = Math.floor(damage * 4 / 3);   // 1.33×
  const focused = damage * 4;                    // 4×
  let aXp = 0, sXp = 0, dXp = 0;
  const hXp = shared;
  switch (style) {
    case 'accurate':   aXp = focused; break;
    case 'aggressive': sXp = focused; break;
    case 'defensive':  dXp = focused; break;
    case 'controlled':
    default:           aXp = shared; sXp = shared; dXp = shared; break;
  }
  stats.attack_xp   += aXp;
  stats.strength_xp += sXp;
  stats.defence_xp  += dXp;
  stats.hp_xp       += hXp;
  return { attack: aXp, strength: sXp, defence: dXp, hp: hXp };
}

function combatLevelsOf(stats) {
  return {
    attack: combatLevelFromXp(stats.attack_xp),
    strength: combatLevelFromXp(stats.strength_xp),
    defence: combatLevelFromXp(stats.defence_xp),
    hp: combatLevelFromXp(stats.hp_xp),
  };
}

function combatDetectLevelUps(before, after) {
  const ups = [];
  if (after.attack > before.attack) ups.push('attack');
  if (after.strength > before.strength) ups.push('strength');
  if (after.defence > before.defence) ups.push('defence');
  if (after.hp > before.hp) ups.push('hp');
  return ups;
}

function combatDist(ax, az, bx, bz) {
  const dx = ax - bx, dz = az - bz;
  return Math.sqrt(dx * dx + dz * dz);
}

async function combatDbGetUserStats(db, userId) {
  let row = await db.first('SELECT * FROM combat_stats WHERE user_id = ?', [userId]);
  if (!row) {
    await db.run(
      `INSERT INTO combat_stats (user_id, attack_xp, strength_xp, defence_xp, hp_xp, hp_current, last_attack_at, last_died_at)
       VALUES (?, 0, 0, 0, 1154, 10, NULL, NULL)`,
      [userId]
    );
    row = await db.first('SELECT * FROM combat_stats WHERE user_id = ?', [userId]);
  }
  return row;
}

async function combatDbGetUserPosition(db, userId) {
  const row = await db.first('SELECT last_x, last_z FROM users WHERE id = ?', [userId]);
  if (!row) return null;
  return {
    x: row.last_x !== null && row.last_x !== undefined ? row.last_x : 0,
    z: row.last_z !== null && row.last_z !== undefined ? row.last_z : 0,
  };
}

// Slice 5b — combat_style vive en users (migration 009).
async function combatDbGetUserCombatStyle(db, userId) {
  const row = await db.first('SELECT combat_style FROM users WHERE id = ?', [userId]);
  const style = row?.combat_style;
  return COMBAT_VALID_STYLES.includes(style) ? style : COMBAT_DEFAULT_STYLE;
}

async function combatDbGetNpcInstance(db, npcInstanceId) {
  const row = await db.first(
    `SELECT i.*, d.name, d.max_hp, d.attack_lvl, d.strength_lvl, d.defence_lvl,
            d.attack_speed_ticks, d.max_hit, d.xp_per_kill, d.respawn_ms,
            d.spawn_x, d.spawn_z, d.attack_range, d.model
     FROM npc_instances i JOIN npc_defs d ON d.id = i.def_id
     WHERE i.id = ?`,
    [npcInstanceId]
  );
  return row || null;
}

async function combatReviveExpiredNpcs(db, opts) {
  opts = opts || {};
  const now = opts.now || Date.now();
  const result = await db.run(
    `UPDATE npc_instances
     SET status = 0,
         hp_current = (SELECT max_hp FROM npc_defs WHERE id = npc_instances.def_id),
         died_at = NULL,
         in_combat_with = NULL,
         last_attack_at = NULL,
         x = (SELECT spawn_x FROM npc_defs WHERE id = npc_instances.def_id),
         z = (SELECT spawn_z FROM npc_defs WHERE id = npc_instances.def_id)
     WHERE status = 1
       AND died_at IS NOT NULL
       AND (died_at + (SELECT respawn_ms FROM npc_defs WHERE id = npc_instances.def_id)) <= ?`,
    [now]
  );
  const meta = result && result.meta;
  return { revived: (meta && meta.changes) || 0 };
}

async function combatGetState(db, userId, opts) {
  opts = opts || {};
  await combatReviveExpiredNpcs(db, opts);
  const stats = await combatDbGetUserStats(db, userId);
  const pos = await combatDbGetUserPosition(db, userId);
  const combatStyle = await combatDbGetUserCombatStyle(db, userId);   // Slice 5b
  const npcs = await db.all(
    `SELECT i.id, i.def_id, i.hp_current, i.x, i.z, i.status,
            d.name, d.max_hp, d.attack_lvl, d.strength_lvl, d.defence_lvl,
            d.attack_speed_ticks, d.max_hit, d.attack_range, d.model
     FROM npc_instances i JOIN npc_defs d ON d.id = i.def_id
     WHERE i.status = 0`,
    []
  );
  const lvls = combatLevelsOf(stats);
  return {
    stats: {
      attack:   { level: lvls.attack,   xp: stats.attack_xp,   xp_next: combatXpForLevel(lvls.attack + 1) },
      strength: { level: lvls.strength, xp: stats.strength_xp, xp_next: combatXpForLevel(lvls.strength + 1) },
      defence:  { level: lvls.defence,  xp: stats.defence_xp,  xp_next: combatXpForLevel(lvls.defence + 1) },
      hp:       { level: lvls.hp,       xp: stats.hp_xp,       xp_next: combatXpForLevel(lvls.hp + 1) },
      hp_current: stats.hp_current,
      hp_max: lvls.hp,
      last_attack_at: stats.last_attack_at,
      last_died_at: stats.last_died_at,
    },
    combat_style: combatStyle,   // Slice 5b — el cliente lo lee para destacar el botón
    position: pos,
    npcs: npcs.map(r => ({
      id: r.id, def_id: r.def_id, name: r.name,
      hp_current: r.hp_current, max_hp: r.max_hp,
      x: r.x, z: r.z,
      attack_lvl: r.attack_lvl, strength_lvl: r.strength_lvl, defence_lvl: r.defence_lvl,
      max_hit: r.max_hit, attack_range: r.attack_range, model: r.model,
    })),
  };
}

async function combatAttackNpc(db, userId, npcInstanceId, opts) {
  opts = opts || {};
  const rng = opts.rng || Math.random;
  const now = opts.now || Date.now();

  const stats = await combatDbGetUserStats(db, userId);
  const npc = await combatDbGetNpcInstance(db, npcInstanceId);
  const userPos = await combatDbGetUserPosition(db, userId);
  const style = await combatDbGetUserCombatStyle(db, userId);   // Slice 5b

  if (!npc) return { error: 'npc_not_found' };
  if (npc.status !== 0) return { error: 'npc_dead' };

  if (stats.last_attack_at && (now - stats.last_attack_at) < COMBAT_TICK_MS) {
    return {
      error: 'on_cooldown',
      cooldown_remaining_ms: COMBAT_TICK_MS - (now - stats.last_attack_at),
    };
  }

  if (!userPos) return { error: 'user_no_position' };
  const d = combatDist(userPos.x, userPos.z, npc.x, npc.z);
  if (d > npc.attack_range + COMBAT_RANGE_TOLERANCE) {
    return { error: 'out_of_range', distance: d, max_range: npc.attack_range + COMBAT_RANGE_TOLERANCE };
  }
  if (stats.hp_current <= 0) return { error: 'user_dead' };

  const userLvls = combatLevelsOf(stats);
  const userHit = combatRollHit(rng, userLvls.attack, npc.defence_lvl, combatCalcMaxHit(userLvls.strength));
  const dmgToNpc = Math.min(userHit.damage, npc.hp_current);
  const npcHpAfter = npc.hp_current - dmgToNpc;
  const npcKilled = npcHpAfter <= 0;

  const xpBefore = combatLevelsOf(stats);
  const xpGained = combatAwardXp(stats, dmgToNpc, style);   // Slice 5b — pasa style
  const xpAfter = combatLevelsOf(stats);
  const levelUps = combatDetectLevelUps(xpBefore, xpAfter);

  await db.run(
    `UPDATE npc_instances SET hp_current = ?, status = ?, died_at = ?, in_combat_with = ? WHERE id = ?`,
    [
      npcKilled ? 0 : npcHpAfter,
      npcKilled ? 1 : 0,
      npcKilled ? now : null,
      npcKilled ? null : userId,
      npc.id,
    ]
  );

  // Slice 5c — Loot: cuando el NPC muere por el hit del user, rolamos su
  // loot table y soltamos items en el suelo. Privacidad 60s al killer.
  // [DEBUG] Logs temporales a tabla _debug_log para diagnosticar por qué no dropea.
  if (npcKilled) {
    try {
      await db.run('INSERT INTO _debug_log (t, msg) VALUES (?, ?)', [Date.now(), `[loot/start] def_id=${JSON.stringify(npc.def_id)} type=${typeof npc.def_id} userId=${userId} x=${npc.x} z=${npc.z}`]);
      const _testRows = await db.all('SELECT item_id, qty_min, qty_max, weight, is_always FROM npc_loot_table WHERE npc_def_id = ?', [npc.def_id]);
      await db.run('INSERT INTO _debug_log (t, msg) VALUES (?, ?)', [Date.now(), `[loot/rows] count=${_testRows.length} data=${JSON.stringify(_testRows)}`]);
      await combatRollAndDropLoot(db, npc.def_id, npc.x, npc.z, userId, now, rng);
      const _afterCount = await db.first('SELECT COUNT(*) AS c FROM ground_items WHERE dropped_by_user = ? AND dropped_at = ?', [userId, now]);
      await db.run('INSERT INTO _debug_log (t, msg) VALUES (?, ?)', [Date.now(), `[loot/done] inserted_rows=${_afterCount ? _afterCount.c : 'null'}`]);
    } catch (err) {
      try {
        await db.run('INSERT INTO _debug_log (t, msg) VALUES (?, ?)', [Date.now(), `[loot/ERROR] ${err && err.message} | stack=${((err && err.stack) || '').slice(0,500)}`]);
      } catch (_) { /* ignore */ }
      console.error('[combat/loot]', npc.def_id, err);
    }
  }

  stats.last_attack_at = now;

  let npcCounterHit = null;
  let dmgToUser = 0;
  let userKilled = false;
  let respawned = false;

  if (!npcKilled) {
    const npcCooldownMs = npc.attack_speed_ticks * COMBAT_TICK_MS;
    const npcReady = !npc.last_attack_at || (now - npc.last_attack_at) >= npcCooldownMs;
    if (npcReady) {
      npcCounterHit = combatRollHit(rng, npc.attack_lvl, userLvls.defence, npc.max_hit);
      dmgToUser = Math.min(npcCounterHit.damage, stats.hp_current);
      const userHpAfter = stats.hp_current - dmgToUser;
      if (userHpAfter <= 0) {
        userKilled = true;
        stats.hp_current = xpAfter.hp;
        stats.last_died_at = now;
        respawned = true;
      } else {
        stats.hp_current = userHpAfter;
      }
      await db.run(
        'UPDATE npc_instances SET last_attack_at = ? WHERE id = ?',
        [now, npc.id]
      );
    }
  }

  await db.run(
    `UPDATE combat_stats
     SET attack_xp = ?, strength_xp = ?, defence_xp = ?, hp_xp = ?,
         hp_current = ?, last_attack_at = ?, last_died_at = ?
     WHERE user_id = ?`,
    [
      stats.attack_xp, stats.strength_xp, stats.defence_xp, stats.hp_xp,
      stats.hp_current, stats.last_attack_at, stats.last_died_at,
      userId,
    ]
  );

  await db.run(
    `INSERT INTO combat_log (ts, attacker_type, attacker_id, target_type, target_id, damage, hit, killed)
     VALUES (?, 0, ?, 1, ?, ?, ?, ?)`,
    [now, userId, npc.id, dmgToNpc, userHit.hit ? 1 : 0, npcKilled ? 1 : 0]
  );
  if (npcCounterHit) {
    await db.run(
      `INSERT INTO combat_log (ts, attacker_type, attacker_id, target_type, target_id, damage, hit, killed)
       VALUES (?, 1, ?, 0, ?, ?, ?, ?)`,
      [now, npc.id, userId, dmgToUser, npcCounterHit.hit ? 1 : 0, userKilled ? 1 : 0]
    );
  }

  return {
    your_hit: userHit.hit,
    your_damage: dmgToNpc,
    npc_killed: npcKilled,
    npc_hp: npcKilled ? 0 : npcHpAfter,
    npc_max_hp: npc.max_hp,
    xp_gained: xpGained,
    level_ups: levelUps,
    npc_hit: npcCounterHit ? npcCounterHit.hit : null,
    npc_damage: dmgToUser,
    you_died: userKilled,
    respawned,
    your_hp: stats.hp_current,
    your_hp_max: xpAfter.hp,
    your_levels: xpAfter,
  };
}

async function combatRespawnUser(db, userId, opts) {
  opts = opts || {};
  const now = opts.now || Date.now();
  const stats = await combatDbGetUserStats(db, userId);
  const hpMax = combatLevelFromXp(stats.hp_xp);
  if (stats.hp_current > 0) return { ok: false, error: 'not_dead' };
  await db.run(
    'UPDATE combat_stats SET hp_current = ?, last_died_at = ? WHERE user_id = ?',
    [hpMax, now, userId]
  );
  return { ok: true, hp_current: hpMax };
}

// ---------- Combat HTTP handlers ----------

async function handleCombatState(request, env) {
  const session = await requireSession(request, env);
  if (!session) return json({ error: 'unauthorized' }, 401);
  const db = makeDbAdapter(env);
  try {
    const state = await combatGetState(db, session.user_id, {});
    return json(state);
  } catch (err) {
    console.error('[combat/state]', err);
    return json({ error: 'internal_error', message: err.message }, 500);
  }
}

async function handleCombatAttack(request, env) {
  const session = await requireSession(request, env);
  if (!session) return json({ error: 'unauthorized' }, 401);

  let body;
  try { body = await request.json(); } catch { return json({ error: 'invalid_body' }, 400); }
  const npcId = parseInt(body.npc_id, 10);
  if (!Number.isFinite(npcId) || npcId <= 0) {
    return json({ error: 'invalid_npc_id' }, 400);
  }

  const db = makeDbAdapter(env);
  try {
    const result = await combatAttackNpc(db, session.user_id, npcId, {});
    if (result.error) {
      const knownClient = new Set(['npc_not_found', 'npc_dead', 'on_cooldown', 'out_of_range', 'user_no_position', 'user_dead']);
      if (knownClient.has(result.error)) return json(result, 400);
    }
    return json(result);
  } catch (err) {
    console.error('[combat/attack]', err);
    return json({ error: 'internal_error', message: err.message }, 500);
  }
}

async function handleCombatRespawn(request, env) {
  const session = await requireSession(request, env);
  if (!session) return json({ error: 'unauthorized' }, 401);
  const db = makeDbAdapter(env);
  try {
    const result = await combatRespawnUser(db, session.user_id, {});
    if (!result.ok) return json(result, 400);
    return json(result);
  } catch (err) {
    console.error('[combat/respawn]', err);
    return json({ error: 'internal_error', message: err.message }, 500);
  }
}

/**
 * Slice 5b — POST /api/combat/style { style }
 * Cambia el combat style del user. Valida contra COMBAT_VALID_STYLES.
 * Persiste en users.combat_style (migration 009).
 */
async function handleCombatStyle(request, env) {
  const session = await requireSession(request, env);
  if (!session) return json({ error: 'unauthorized' }, 401);

  let body;
  try { body = await request.json(); } catch { return json({ error: 'invalid_body' }, 400); }
  const style = body && typeof body.style === 'string' ? body.style : null;
  if (!style || !COMBAT_VALID_STYLES.includes(style)) {
    return json({
      error: 'invalid_style',
      message: 'style debe ser uno de: ' + COMBAT_VALID_STYLES.join(', '),
    }, 400);
  }

  try {
    await env.DB.prepare('UPDATE users SET combat_style = ? WHERE id = ?')
      .bind(style, session.user_id).run();
    return json({ ok: true, combat_style: style });
  } catch (err) {
    console.error('[combat/style]', err);
    return json({ error: 'internal_error', message: err.message }, 500);
  }
}

// ============================================================
// Slice 5c.5 — Multiplayer básico (heartbeat + peers)
// ============================================================
// Estrategia: cada cliente hace heartbeat cada ~500ms con su posición,
// yaw y estado de movimiento. El server upserta a online_users con
// last_seen=now. El endpoint peers devuelve users con last_seen reciente
// (<10s) dentro de un radio de 100m del que pregunta.
//
// La tabla online_users se crea con migration 010.

const MP_PEER_TIMEOUT_MS = 10_000;    // 10s sin heartbeat → offline
const MP_PEER_RADIUS_M   = 100;        // 100m alrededor del player
const MP_VALID_STATES    = ['idle', 'run', 'attack'];

async function handleWorldHeartbeat(request, env) {
  const session = await requireSession(request, env);
  if (!session) return json({ error: 'unauthorized' }, 401);

  let body;
  try { body = await request.json(); } catch { return json({ error: 'invalid_body' }, 400); }
  const x   = Number(body?.x);
  const z   = Number(body?.z);
  const yaw = Number(body?.yaw ?? 0);
  let state = typeof body?.state === 'string' ? body.state : 'idle';
  if (!MP_VALID_STATES.includes(state)) state = 'idle';

  if (!Number.isFinite(x) || !Number.isFinite(z)) {
    return json({ error: 'invalid_position' }, 400);
  }

  const now = Date.now();
  try {
    // requireSession no incluye username — lo buscamos manualmente
    const userRow = await env.DB.prepare(
      'SELECT username FROM users WHERE id = ?'
    ).bind(session.user_id).first();
    const username = userRow?.username || `user${session.user_id}`;

    // Upsert: si ya existe, actualiza; si no, inserta.
    await env.DB.prepare(
      `INSERT INTO online_users (user_id, username, x, z, yaw, state, last_seen)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         x = excluded.x,
         z = excluded.z,
         yaw = excluded.yaw,
         state = excluded.state,
         last_seen = excluded.last_seen`
    ).bind(session.user_id, username, x, z, yaw, state, now).run();
    return json({ ok: true, ts: now });
  } catch (err) {
    console.error('[world/heartbeat]', err);
    return json({ error: 'internal_error', message: err.message }, 500);
  }
}

async function handleWorldPeers(request, env) {
  const session = await requireSession(request, env);
  if (!session) return json({ error: 'unauthorized' }, 401);

  const url = new URL(request.url);
  // Permitir pasar x,z en query para que el cliente diga "estoy aquí"
  // sin esperar a su próximo heartbeat. Si no se pasan, usamos el último
  // heartbeat conocido del propio user.
  const qx = Number(url.searchParams.get('x'));
  const qz = Number(url.searchParams.get('z'));
  const hasPos = Number.isFinite(qx) && Number.isFinite(qz);

  const cutoff = Date.now() - MP_PEER_TIMEOUT_MS;
  try {
    let centerX, centerZ;
    if (hasPos) {
      centerX = qx; centerZ = qz;
    } else {
      const me = await env.DB.prepare(
        'SELECT x, z FROM online_users WHERE user_id = ?'
      ).bind(session.user_id).first();
      if (!me) {
        return json({ peers: [] });   // no hemos hecho heartbeat aún
      }
      centerX = me.x; centerZ = me.z;
    }

    // Filtramos en SQL por bounding box rápido, después por distancia exacta
    const margin = MP_PEER_RADIUS_M;
    const rows = await env.DB.prepare(
      `SELECT user_id, username, x, z, yaw, state, last_seen
       FROM online_users
       WHERE last_seen > ?
         AND user_id != ?
         AND x BETWEEN ? AND ?
         AND z BETWEEN ? AND ?`
    ).bind(
      cutoff, session.user_id,
      centerX - margin, centerX + margin,
      centerZ - margin, centerZ + margin,
    ).all();

    const peers = (rows.results || [])
      .filter(r => {
        const dx = r.x - centerX, dz = r.z - centerZ;
        return (dx * dx + dz * dz) <= margin * margin;
      })
      .map(r => ({
        user_id: r.user_id,
        username: r.username,
        x: r.x,
        z: r.z,
        yaw: r.yaw,
        state: r.state,
        last_seen: r.last_seen,
      }));

    return json({ peers });
  } catch (err) {
    console.error('[world/peers]', err);
    return json({ error: 'internal_error', message: err.message }, 500);
  }
}

// ============================================================
// Home Teleport (Slice 5c) — TP a base con cast 10s, cooldown 15 min
// ============================================================
// Flujo:
//   1) Cliente envía POST /api/magic/home_teleport → server verifica que no
//      hay cooldown activo, devuelve { ok: true, cast_ms: 10000 } y arranca
//      timer client-side.
//   2) Si el cliente se mueve o recibe daño durante el cast: POST .../cancel
//      → no pasa nada server-side, el cliente simplemente no enviará finish.
//   3) Si el cast llega a 10s sin cancelación: POST .../finish → server pone
//      cooldown_until = now+15min y devuelve { ok: true, teleported: true,
//      spawn: { x, z } }. Cliente teleporta visualmente.
//
// El cooldown se valida server-side al hacer start. No confiamos en el
// cliente para nada — si intenta hacer finish dos veces, el segundo falla
// porque el cooldown ya está activo.

const HOME_TELE_COOLDOWN_MS = 15 * 60 * 1000;   // 15 minutos
const HOME_TELE_CAST_MS = 10_000;                // 10 segundos
const HOME_TELE_SPAWN = { x: 0, z: 0 };          // spawn point en Aldea del Cruce

async function handleHomeTeleportStart(request, env) {
  const session = await requireSession(request, env);
  if (!session) return json({ error: 'unauthorized' }, 401);
  try {
    const row = await env.DB.prepare(
      'SELECT home_tele_cooldown_until FROM users WHERE id = ?'
    ).bind(session.user_id).first();
    const cooldownUntil = row?.home_tele_cooldown_until || 0;
    const now = Date.now();
    if (cooldownUntil > now) {
      const remainingMs = cooldownUntil - now;
      return json({
        error: 'on_cooldown',
        cooldown_remaining_ms: remainingMs,
        message: `Disponible en ${Math.ceil(remainingMs / 1000)}s`,
      }, 429);
    }
    return json({
      ok: true,
      cast_ms: HOME_TELE_CAST_MS,
      message: 'Cast iniciado. No te muevas ni recibas daño durante 10s.',
    });
  } catch (err) {
    console.error('[home_tele/start]', err);
    return json({ error: 'internal_error', message: err.message }, 500);
  }
}

async function handleHomeTeleportCancel(request, env) {
  const session = await requireSession(request, env);
  if (!session) return json({ error: 'unauthorized' }, 401);
  // Server-side no hay que hacer nada — el cast no es server-stateful, el
  // cliente solo deja de enviar finish. Devolvemos ok para que el client
  // tenga confirmación de que el server "vio" el cancel.
  return json({ ok: true, cancelled: true });
}

async function handleHomeTeleportFinish(request, env) {
  const session = await requireSession(request, env);
  if (!session) return json({ error: 'unauthorized' }, 401);
  try {
    // Doble verificación de cooldown — si el cliente trampea e intenta
    // hacer finish dos veces, el segundo falla.
    const row = await env.DB.prepare(
      'SELECT home_tele_cooldown_until FROM users WHERE id = ?'
    ).bind(session.user_id).first();
    const cooldownUntil = row?.home_tele_cooldown_until || 0;
    const now = Date.now();
    if (cooldownUntil > now) {
      return json({
        error: 'on_cooldown',
        cooldown_remaining_ms: cooldownUntil - now,
      }, 429);
    }
    const newCooldownUntil = now + HOME_TELE_COOLDOWN_MS;
    await env.DB.prepare(
      'UPDATE users SET home_tele_cooldown_until = ?, last_x = ?, last_z = ? WHERE id = ?'
    ).bind(newCooldownUntil, HOME_TELE_SPAWN.x, HOME_TELE_SPAWN.z, session.user_id).run();
    return json({
      ok: true,
      teleported: true,
      spawn: HOME_TELE_SPAWN,
      cooldown_until: newCooldownUntil,
    });
  } catch (err) {
    console.error('[home_tele/finish]', err);
    return json({ error: 'internal_error', message: err.message }, 500);
  }
}

// ============================================================
// Slice 5c — Death drops + loot básico
// ============================================================
// Modelo:
//   - Cuando un NPC muere por el hit del player, rolamos su loot table
//     (npc_loot_table). Items con is_always=1 se sueltan siempre, todos
//     a la vez. Items con is_always=0 entran en una tirada ponderada
//     y SOLO UNO gana cada vez.
//   - Cada drop se inserta en ground_items con un pequeño offset random
//     en X/Z (±0.4m) para que no queden uno encima de otro.
//   - Privacidad: 60s desde dropped_at solo lo ve y recoge el killer.
//     Después se vuelve público otros 60s. despawn_at = dropped_at+120s.
//   - Cron cada 1 min limpia los expirados.
//
// Endpoints:
//   GET  /api/ground_items?x=&z=          → items en radio 30m
//   POST /api/ground_items/pickup { ids } → recoge esos ids, devuelve
//                                            picked_up / skipped con motivo.

const LOOT_OFFSET_RANGE_M       = 0.4;
const LOOT_PRIVATE_MS           = 60_000;
const LOOT_TOTAL_LIFETIME_MS    = 120_000;
const LOOT_LIST_RADIUS_M        = 30;
const LOOT_PICKUP_RADIUS_M      = 3;

async function combatRollAndDropLoot(db, npcDefId, npcX, npcZ, userId, now, rng) {
  const rows = await db.all(
    `SELECT item_id, qty_min, qty_max, weight, is_always
     FROM npc_loot_table
     WHERE npc_def_id = ?`,
    [npcDefId]
  );
  if (!rows || rows.length === 0) return;

  const drops = [];

  // 1) Drops garantizados (is_always = 1)
  for (const r of rows) {
    if (r.is_always === 1) {
      const qty = rollQty(rng, r.qty_min, r.qty_max);
      if (qty > 0) drops.push({ item_id: r.item_id, qty });
    }
  }

  // 2) Roll ponderado entre los aleatorios (uno gana)
  const random = rows.filter(r => r.is_always === 0);
  if (random.length > 0) {
    const totalWeight = random.reduce((s, r) => s + (r.weight | 0), 0);
    if (totalWeight > 0) {
      let pick = rng() * totalWeight;
      for (const r of random) {
        pick -= r.weight;
        if (pick <= 0) {
          const qty = rollQty(rng, r.qty_min, r.qty_max);
          if (qty > 0) drops.push({ item_id: r.item_id, qty });
          break;
        }
      }
    }
  }

  if (drops.length === 0) return;

  const despawnAt = now + LOOT_TOTAL_LIFETIME_MS;
  for (const d of drops) {
    const ox = (rng() - 0.5) * 2 * LOOT_OFFSET_RANGE_M;
    const oz = (rng() - 0.5) * 2 * LOOT_OFFSET_RANGE_M;
    await db.run(
      `INSERT INTO ground_items (item_id, qty, x, z, dropped_at, dropped_by_user, despawn_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [d.item_id, d.qty, npcX + ox, npcZ + oz, now, userId, despawnAt]
    );
  }
}

function rollQty(rng, qMin, qMax) {
  const mn = qMin | 0;
  const mx = qMax | 0;
  if (mx <= mn) return mn;
  return mn + Math.floor(rng() * (mx - mn + 1));
}

async function handleGroundItemsList(request, env) {
  const session = await requireSession(request, env);
  if (!session) return json({ error: 'unauthorized' }, 401);
  const userId = session.user_id;

  const url = new URL(request.url);
  const x = parseFloat(url.searchParams.get('x'));
  const z = parseFloat(url.searchParams.get('z'));
  if (!Number.isFinite(x) || !Number.isFinite(z)) {
    return json({ error: 'invalid_position' }, 400);
  }

  const now = Date.now();
  const R = LOOT_LIST_RADIUS_M;
  const xMin = x - R, xMax = x + R, zMin = z - R, zMax = z + R;
  const privacyCutoff = now - LOOT_PRIVATE_MS;

  try {
    // bbox prefilter + privacidad: o ya pasó el periodo privado, o soy
    // el killer. Filtramos por distancia exacta después en JS.
    const res = await env.DB.prepare(
      `SELECT g.id, g.item_id, g.qty, g.x, g.z, g.dropped_at, g.dropped_by_user, g.despawn_at,
              i.name, i.icon, i.stackable, i.base_price
       FROM ground_items g
       LEFT JOIN items i ON i.id = g.item_id
       WHERE g.despawn_at > ?
         AND g.x BETWEEN ? AND ?
         AND g.z BETWEEN ? AND ?
         AND (g.dropped_at <= ? OR g.dropped_by_user = ?)
       ORDER BY g.dropped_at DESC`
    ).bind(now, xMin, xMax, zMin, zMax, privacyCutoff, userId).all();

    const rows = res?.results || [];
    const r2 = R * R;
    const items = [];
    for (const row of rows) {
      const dx = row.x - x;
      const dz = row.z - z;
      if (dx * dx + dz * dz > r2) continue;
      const isPrivate = (row.dropped_at + LOOT_PRIVATE_MS) > now;
      items.push({
        id: row.id,
        item_id: row.item_id,
        name: row.name,
        icon: row.icon,
        stackable: row.stackable === 1 ? 1 : 0,
        base_price: row.base_price | 0,
        qty: row.qty,
        x: row.x,
        z: row.z,
        dropped_at: row.dropped_at,
        despawn_at: row.despawn_at,
        is_private: isPrivate ? 1 : 0,
        mine: row.dropped_by_user === userId ? 1 : 0,
      });
    }
    return json({ items, now });
  } catch (err) {
    console.error('[ground_items/list]', err);
    return json({ error: 'internal_error', message: err.message }, 500);
  }
}

async function handleGroundItemsPickup(request, env) {
  const session = await requireSession(request, env);
  if (!session) return json({ error: 'unauthorized' }, 401);
  const userId = session.user_id;

  let body;
  try { body = await request.json(); } catch { return json({ error: 'invalid_body' }, 400); }

  const rawIds = Array.isArray(body?.ids) ? body.ids : [];
  const ids = [];
  const seen = new Set();
  for (const v of rawIds) {
    const n = parseInt(v, 10);
    if (Number.isFinite(n) && n > 0 && !seen.has(n)) {
      seen.add(n);
      ids.push(n);
    }
  }
  if (ids.length === 0) return json({ error: 'no_ids' }, 400);
  // Tope defensivo: pickup masivo no debería pasar de un pile entero (~10 items)
  if (ids.length > 64) return json({ error: 'too_many_ids' }, 400);

  const now = Date.now();
  const db = makeDbAdapter(env);

  try {
    // Posición del player
    const userRow = await db.first(
      'SELECT last_x, last_z FROM users WHERE id = ?',
      [userId]
    );
    if (!userRow) return json({ error: 'user_not_found' }, 404);
    const userX = userRow.last_x ?? 0;
    const userZ = userRow.last_z ?? 0;

    // Cargar las filas pedidas
    const ph = ids.map(() => '?').join(',');
    const groundRows = await db.all(
      `SELECT g.id, g.item_id, g.qty, g.x, g.z, g.dropped_at, g.dropped_by_user, g.despawn_at,
              i.stackable
       FROM ground_items g LEFT JOIN items i ON i.id = g.item_id
       WHERE g.id IN (${ph})`,
      ids
    );

    // Cargar inventario una vez. Vamos a mutarlo en memoria y persistimos
    // los stmts al final con batch.
    const invState = await geLoadInventoryState(db, userId);
    const stmts = [];

    const pickedUp = [];
    const skipped = [];
    const pickedIds = [];

    for (const g of groundRows) {
      if (!g) continue;

      // Validar no expirado
      if (g.despawn_at <= now) {
        skipped.push({ id: g.id, reason: 'expired' });
        continue;
      }
      // Validar privacidad
      const isPrivate = (g.dropped_at + LOOT_PRIVATE_MS) > now;
      if (isPrivate && g.dropped_by_user !== userId) {
        skipped.push({ id: g.id, reason: 'private' });
        continue;
      }
      // Validar distancia (3m)
      const dx = g.x - userX, dz = g.z - userZ;
      if (dx * dx + dz * dz > LOOT_PICKUP_RADIUS_M * LOOT_PICKUP_RADIUS_M) {
        skipped.push({ id: g.id, reason: 'too_far' });
        continue;
      }

      const stackable = g.stackable === 1;
      const ok = geTryDepositToInventory(stmts, invState, userId, g.item_id, g.qty, stackable, now);
      if (!ok) {
        skipped.push({ id: g.id, reason: 'inventory_full' });
        continue;
      }
      stmts.push({
        sql: 'DELETE FROM ground_items WHERE id = ?',
        params: [g.id],
      });
      pickedUp.push({ id: g.id, item_id: g.item_id, qty: g.qty });
      pickedIds.push(g.id);
    }

    if (stmts.length > 0) {
      await db.batch(stmts);
    }

    return json({
      picked_up: pickedUp,
      skipped,
      picked_count: pickedUp.length,
    });
  } catch (err) {
    console.error('[ground_items/pickup]', err);
    return json({ error: 'internal_error', message: err.message }, 500);
  }
}
