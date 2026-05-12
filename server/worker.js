/**
 * SebasPresent — Auth + Position + Inventory + Bank Worker (Slice 4b)
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
 *   GET  /api/inventory  → { slots: [{slot, item_id, quantity, name, icon, stackable}, ...] }
 *   POST /api/inventory/swap  { from, to } → { ok: true }
 *
 *   NEW in Slice 4b:
 *   GET  /api/bank       → { slots: [{slot, item_id, quantity, name, icon, stackable}, ...] }
 *   POST /api/bank/deposit   { inv_slot, quantity } → { ok: true }
 *      Mueve `quantity` (o todo si quantity === -1) del slot del inventario al banco.
 *      Si el item ya existe en banco, suma. Si no, crea slot nuevo al final.
 *   POST /api/bank/withdraw  { bank_slot, quantity, target_inv_slot? } → { ok: true }
 *      Mueve `quantity` (o todo si quantity === -1) del slot del banco al inventario.
 *      Para items stackable: si ya hay un stack en inv, suma; si no, crea en target_inv_slot o primer hueco.
 *      Para no-stackable: crea N slots nuevos (uno por unidad), uno por cada unidad pedida,
 *      empezando por target_inv_slot si esta libre.
 *   POST /api/bank/swap   { from, to } → { ok: true }
 *      Reordena DENTRO del banco (mueve un slot a otra posicion vacia, o swap si ocupada).
 *      No merge (porque la UNIQUE(user_id, item_id) impide tener el mismo item en dos slots).
 *
 *   GET  /api/health → { ok: true, ts }
 *
 * Password hashing: PBKDF2-SHA256, 100.000 iterations.
 * Sessions: opaque 256-bit random tokens, 30-day expiry.
 * Inventory: 28 slots, grid 4×7. Bank: slots posicionales sin limite.
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
