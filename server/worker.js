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

// ============================================================
// Sesión 7 refactor — engines deduplicados
// ============================================================
// combat_engine.js y ge_engine.js viven en /server/. Worker.js solo orquesta
// (handlers HTTP). Importamos con alias para no cambiar las llamadas en los
// handlers existentes (siguen usando combatGetState, geMakeErr, etc.).

import {
  getCombatState as combatGetState,
  attackNpc as combatAttackNpc,
  respawnUser as combatRespawnUser,
  reviveExpiredNpcs as combatReviveExpiredNpcs,
  rollAndDropLoot as combatRollAndDropLoot,
  levelFromXp as combatLevelFromXp,
  xpForLevel as combatXpForLevel,
  calcMaxHit as combatCalcMaxHit,
  calcHitChance as combatCalcHitChance,
  awardXp as combatAwardXp,
  VALID_STYLES as COMBAT_VALID_STYLES,
  DEFAULT_STYLE as COMBAT_DEFAULT_STYLE,
  TICK_MS as COMBAT_TICK_MS,
} from './combat_engine.js';

import {
  // Pure / public engine API
  getGuidePrice as geGetGuidePrice,
  getSuggestedPrice as geGetSuggestedPrice,
  getPriceBand as geGetPriceBand,
  validateOrderShape as geValidateOrderShape,
  placeOrder as gePlaceOrder,
  cancelOrder as geCancelOrder,
  runMatcher as geRunMatcher,
  matchItem as geMatchItem,
  applyMatch as geApplyMatch,
  claimAll as geClaimAll,
  reseedGhostOrders as geReseedGhostOrders,
  countOpenSlots as geCountOpenSlots,
  // Internal helpers used by worker handlers
  loadInventoryState as geLoadInventoryState,
  snapshotInventoryState as geSnapshotInventoryState,
  restoreInventoryState as geRestoreInventoryState,
  sumInventory as geSumInventory,
  removeFromInventory as geRemoveFromInventory,
  tryDepositToInventory as geTryDepositToInventory,
  loadBankState as geLoadBankState,
  addBankDeposit as geAddBankDeposit,
  weightedAvg as geWeightedAvg,
  makeErr as geMakeErr,
  // Constants
  SYSTEM_USER_ID as GE_SYSTEM_USER_ID,
  SIDE_BUY as GE_SIDE_BUY,
  SIDE_SELL as GE_SIDE_SELL,
  STATUS_OPEN as GE_STATUS_OPEN,
  STATUS_COMPLETED as GE_STATUS_COMPLETED,
  STATUS_CANCELLED as GE_STATUS_CANCELLED,
  COIN_ITEM_ID as GE_COIN_ITEM_ID,
  MAX_ORDER_SLOTS_PER_USER as GE_MAX_ORDER_SLOTS_PER_USER,
  INVENTORY_SLOT_COUNT as GE_INVENTORY_SLOT_COUNT,
  CLAIM_TARGET_INVENTORY as GE_CLAIM_TARGET_INVENTORY,
  CLAIM_TARGET_BANK as GE_CLAIM_TARGET_BANK,
  PRICE_BAND_BPS as GE_PRICE_BAND_BPS,
  PRICE_BAND_FLOOR_ABS as GE_PRICE_BAND_FLOOR_ABS,
  BPS_DIVISOR as GE_BPS_DIVISOR,
} from './ge_engine.js';

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

const LOOT_PRIVATE_MS           = 60_000;
const LOOT_LIST_RADIUS_M        = 30;
const LOOT_PICKUP_RADIUS_M      = 5;     // antes 3. Subido para compensar el


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
