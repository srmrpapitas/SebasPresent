/**
 * SebasPresent — API client
 *
 * One place that knows how to call the backend. All fetches go through here
 * so we can switch URLs, add headers, or log errors in a single spot.
 *
 * Sesión 27 — attackNpc(npcId, pos?) ahora acepta una posición opcional
 * {x, z} que se incluye en el body. Server-side, combat_engine la usa para
 * validar rango y elimina el bug "fuera de alcance".
 *
 * Sesión 28 — añadidas funciones duel*: state, challenge, accept, decline,
 * cancel, leave. Sistema de duelos PVP fuera del wilderness.
 *
 * Sesión 29 — añadidas funciones chatSend, chatRecent. Sistema de chat global
 * con polling 2.5s + overhead text 7s sobre la cabeza del jugador.
 *
 * Sesión 30 — añadidas wcChop, fmLight. Tala + Encender fuego.
 */
// In dev (running `wrangler dev`), the Worker listens on http://localhost:8787.
// In production, replace with your deployed Worker URL.
const API_URL = (() => {
  const host = window.location.hostname;
  if (host === 'localhost' || host === '127.0.0.1') {
    return 'http://localhost:8787';
  }
  return 'https://sebaspresent.srmrpapitas.workers.dev';
})();
const TOKEN_KEY = 'sebaspresent.token';
// ---------- Token storage (localStorage) ----------
export function getToken() {
  try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
}
export function setToken(token) {
  try { localStorage.setItem(TOKEN_KEY, token); } catch {}
}
export function clearToken() {
  try { localStorage.removeItem(TOKEN_KEY); } catch {}
}
// ---------- Fetch wrapper ----------
async function apiFetch(path, { method = 'GET', body, auth = false } = {}) {
  const headers = { 'Accept': 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (auth) {
    const token = getToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;
  }
  let response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    const wrapped = new Error('Sin conexión con el servidor.');
    wrapped.code = 'network_error';
    wrapped.cause = err;
    throw wrapped;
  }
  let data = null;
  try { data = await response.json(); } catch { /* might be empty */ }
  if (!response.ok) {
    const err = new Error(
      (data && data.message) || `Error ${response.status}`
    );
    err.code = (data && data.error) || `http_${response.status}`;
    err.status = response.status;
    if (data && data.band) err.band = data.band;
    throw err;
  }
  return data;
}
// ---------- Auth endpoints ----------
export async function register(username, password) {
  const data = await apiFetch('/api/register', {
    method: 'POST',
    body: { username, password },
  });
  if (data.token) setToken(data.token);
  return data;
}
export async function login(username, password) {
  const data = await apiFetch('/api/login', {
    method: 'POST',
    body: { username, password },
  });
  if (data.token) setToken(data.token);
  return data;
}
export async function me() {
  return apiFetch('/api/me', { auth: true });
}
export async function logout() {
  try {
    await apiFetch('/api/logout', { method: 'POST', auth: true });
  } catch {}
  clearToken();
}

// ---------- Inventory endpoints (Slice 4a) ----------

export async function getInventory() {
  return apiFetch('/api/inventory', { auth: true });
}

// Sesión 39 — soltar (drop) un ítem del inventario al suelo. userPos opcional
// (anti-desfase, igual que pickup): mandamos la pos actual del jugador.
export async function dropItem(slot, userPos = null) {
  return apiFetch('/api/ground_items/drop', {
    method: 'POST',
    auth: true,
    body: { slot, userPos },
  });
}

export async function swapInventorySlots(from, to) {
  return apiFetch('/api/inventory/swap', {
    method: 'POST',
    auth: true,
    body: { from, to },
  });
}

// ============================================================
// Sesion 45 — Quiver (carcaj). El server ya tenia los endpoints desde S34;
// recien ahora el cliente los usa. GET devuelve el contenido; deposit mete
// flechas de un slot del inv (qty null = todo el stack); withdraw saca
// (qty null = todo).
// ============================================================
export async function getQuiver() {
  return apiFetch('/api/quiver', { auth: true });
}

export async function depositToQuiver(slotIndex, quantity = null) {
  const body = {};
  if (Number.isInteger(slotIndex)) body.slot_index = slotIndex;
  if (Number.isInteger(quantity) && quantity > 0) body.quantity = quantity;
  return apiFetch('/api/quiver/deposit', {
    method: 'POST',
    auth: true,
    body,
  });
}

export async function withdrawFromQuiver(quantity = null) {
  const body = {};
  if (Number.isInteger(quantity) && quantity > 0) body.quantity = quantity;
  return apiFetch('/api/quiver/withdraw', {
    method: 'POST',
    auth: true,
    body,
  });
}

// ---------- Bank endpoints (Slice 4b) ----------

export async function getBank() {
  return apiFetch('/api/bank', { auth: true });
}

export async function depositToBank(invSlot, quantity) {
  return apiFetch('/api/bank/deposit', {
    method: 'POST',
    auth: true,
    body: { inv_slot: invSlot, quantity },
  });
}

export async function withdrawFromBank(bankSlot, quantity, targetInvSlot) {
  const body = { bank_slot: bankSlot, quantity };
  if (targetInvSlot !== undefined && targetInvSlot !== null) {
    body.target_inv_slot = targetInvSlot;
  }
  return apiFetch('/api/bank/withdraw', {
    method: 'POST',
    auth: true,
    body,
  });
}

export async function swapBankSlots(from, to) {
  return apiFetch('/api/bank/swap', {
    method: 'POST',
    auth: true,
    body: { from, to },
  });
}

// ---------- Grand Exchange endpoints (Slice 4c v2) ----------

export async function getGeOrders() {
  return apiFetch('/api/ge/orders', { auth: true });
}

export async function placeGeOrder({ item_id, side, price, qty }) {
  return apiFetch('/api/ge/place', {
    method: 'POST',
    auth: true,
    body: { item_id, side, price, qty },
  });
}

export async function cancelGeOrder(orderId) {
  return apiFetch('/api/ge/cancel', {
    method: 'POST',
    auth: true,
    body: { order_id: orderId },
  });
}

export async function claimAll(target) {
  return apiFetch('/api/ge/claim_all', {
    method: 'POST',
    auth: true,
    body: { target },
  });
}

export async function getGeItemInfo(itemId) {
  return apiFetch(`/api/ge/item/${encodeURIComponent(itemId)}`, { auth: true });
}

export async function getGeItemHistory(itemId, days = 7) {
  return apiFetch(`/api/ge/item/${encodeURIComponent(itemId)}/history?days=${days}`, { auth: true });
}

export async function searchGeItems(query = '') {
  const qs = query ? `?q=${encodeURIComponent(query)}` : '';
  return apiFetch(`/api/ge/search${qs}`, { auth: true });
}

// ---------- Combat endpoints (Slice 5a / 5b) ----------

export async function getCombatState() {
  return apiFetch('/api/combat/state', { auth: true });
}

/**
 * Sesión 27 — attackNpc(npcId, pos?)
 *
 * Acepta una posición opcional { x, z } del player en el momento del
 * attack. Si viene, el server la usa para validar rango (evita el
 * "fuera de alcance" causado por desfase entre heartbeat y posición real).
 * Si no viene, el server hace fallback a online_users / users.last_x.
 */
export async function attackNpc(npcId, pos, spellId, useSpecial) {
  const body = { npc_id: npcId };
  if (pos && Number.isFinite(pos.x) && Number.isFinite(pos.z)) {
    body.x = pos.x;
    body.z = pos.z;
  }
  // Sesión 41 — si el cliente manda spell_id, el server lo trata como magia.
  if (spellId) body.spell_id = spellId;
  // Sesion 44 — special attack armado: el server valida energia y arma.
  if (useSpecial) body.use_special = true;
  return apiFetch('/api/combat/attack', {
    method: 'POST',
    auth: true,
    body,
  });
}

/**
 * Sesión 27 Bloque 3 — attackPlayer(targetUserId, pos?, targetPos?)
 *
 * PVP. Mismo patrón que attackNpc:
 *   - targetUserId: id del player objetivo (del snapshot players[].user_id).
 *   - pos: {x, z} del attacker AHORA (para validación de rango sin desfase).
 *   - targetPos: {x, z} del target tal como lo VE el attacker en pantalla.
 *     Server compara con la pos persistida y si la diff es plausible (<6m)
 *     confía en ella. Esto evita "fuera de rango" cuando el target se
 *     mueve entre heartbeats.
 *
 * Server valida que ambos estén en wilderness O que tengan duelo activo
 * entre ellos (Sesión 28). Errores comunes a manejar en UI:
 *   'not_in_wilderness_no_duel', 'out_of_range', 'on_cooldown',
 *   'target_dead', 'same_party'.
 */
export async function attackPlayer(targetUserId, pos, targetPos) {
  const body = { target_user_id: targetUserId };
  if (pos && Number.isFinite(pos.x) && Number.isFinite(pos.z)) {
    body.x = pos.x;
    body.z = pos.z;
  }
  if (targetPos && Number.isFinite(targetPos.x) && Number.isFinite(targetPos.z)) {
    body.target_x = targetPos.x;
    body.target_z = targetPos.z;
  }
  return apiFetch('/api/combat/attack_player', {
    method: 'POST',
    auth: true,
    body,
  });
}

// ============================================================
// Sesión 27 Bloque 3 — Party / Equipo
// ============================================================
export async function partyState() {
  return apiFetch('/api/party/state', { auth: true });
}

export async function partyInvite(targetUserId) {
  return apiFetch('/api/party/invite', {
    method: 'POST', auth: true,
    body: { target_user_id: targetUserId },
  });
}

export async function partyAccept(fromUserId) {
  return apiFetch('/api/party/accept', {
    method: 'POST', auth: true,
    body: { from_user_id: fromUserId },
  });
}

export async function partyDecline(fromUserId) {
  return apiFetch('/api/party/decline', {
    method: 'POST', auth: true,
    body: { from_user_id: fromUserId },
  });
}

export async function partyLeave() {
  return apiFetch('/api/party/leave', { method: 'POST', auth: true });
}

export async function partyKick(targetUserId) {
  return apiFetch('/api/party/kick', {
    method: 'POST', auth: true,
    body: { target_user_id: targetUserId },
  });
}

// ============================================================
// Sesión 28 — Duelos PVP fuera del wilderness
// ============================================================

/**
 * GET /api/duel/state
 * Devuelve { duel, duel_other, invites_in, invite_out }.
 * Sin embargo, snapshot ya trae estos campos en me.duel / me.duel_invites_in /
 * me.duel_invite_out — usa esos para minimizar requests. Esta función se
 * usa solo si necesitas un fetch sin esperar al snapshot (e.g. justo
 * después de aceptar una invitación).
 */
export async function duelState() {
  return apiFetch('/api/duel/state', { auth: true });
}

/**
 * POST /api/duel/challenge { target_user_id }
 * Reta a otro player a duelo. El target tiene 60s para aceptar.
 * Errores comunes:
 *   - cannot_challenge_self
 *   - target_not_found
 *   - same_party
 *   - already_in_duel       (tú ya tienes duelo activo)
 *   - target_in_duel        (el target ya está en otro duelo)
 *   - level_gap_too_big     (diferencia > 10 niveles de combate)
 */
export async function duelChallenge(targetUserId) {
  return apiFetch('/api/duel/challenge', {
    method: 'POST', auth: true,
    body: { target_user_id: targetUserId },
  });
}

/**
 * POST /api/duel/accept { from_user_id }
 * Acepta el reto de from_user_id. Inicia el duelo.
 */
export async function duelAccept(fromUserId) {
  return apiFetch('/api/duel/accept', {
    method: 'POST', auth: true,
    body: { from_user_id: fromUserId },
  });
}

/**
 * POST /api/duel/decline { from_user_id }
 * Rechaza el reto.
 */
export async function duelDecline(fromUserId) {
  return apiFetch('/api/duel/decline', {
    method: 'POST', auth: true,
    body: { from_user_id: fromUserId },
  });
}

/**
 * POST /api/duel/cancel
 * Cancela tu request outgoing (si lo tienes).
 */
export async function duelCancel() {
  return apiFetch('/api/duel/cancel', { method: 'POST', auth: true });
}

/**
 * POST /api/duel/leave
 * Inicia el cast de 5s para salir del duelo. Una vez iniciado NO se
 * cancela y SIGUE corriendo aunque te peguen. Si mueres durante el
 * cast → muerte normal PVP con drop completo.
 *
 * Respuesta: { ok: true, leave_cast_ends_at, cast_duration_ms }
 */
export async function duelLeave() {
  return apiFetch('/api/duel/leave', { method: 'POST', auth: true });
}

export async function respawnUser() {
  return apiFetch('/api/combat/respawn', {
    method: 'POST',
    auth: true,
  });
}

/**
 * POST /api/combat/style  { style }
 * Slice 5b. Cambia el estilo de combate persistente del user.
 * style: 'accurate' | 'aggressive' | 'defensive' | 'controlled'
 *
 * - accurate    → +4 XP/dmg Ataque    + 1.33 XP/dmg HP
 * - aggressive  → +4 XP/dmg Fuerza    + 1.33 XP/dmg HP
 * - defensive   → +4 XP/dmg Defensa   + 1.33 XP/dmg HP
 * - controlled  → 1.33 XP/dmg a Atk/Str/Def + 1.33 a HP (default OSRS)
 */
export async function setCombatStyle(style) {
  return apiFetch('/api/combat/style', {
    method: 'POST',
    auth: true,
    body: { style },
  });
}

// ============================================================
// Sesión 29 — Chat global con polling
// ============================================================

/**
 * POST /api/chat/send { message, channel? = 'global' }
 *
 * Devuelve { ok: true, id, username, channel, message, sent_at }.
 *
 * Errores comunes a manejar en UI (err.code):
 *   - rate_limited        (429) → "Demasiado rápido (5/10s)"
 *   - message_too_long    (400) → "Máx 200 chars"
 *   - empty_message       (400) → ignorar / mensaje vacío
 *   - invalid_message     (400) → tipo incorrecto
 *   - invalid_channel     (400) → channel desconocido
 *   - chat_disabled       (503) → tabla no existe, esconder UI
 */
export async function chatSend(message, channel = 'global') {
  return apiFetch('/api/chat/send', {
    method: 'POST',
    auth: true,
    body: { message, channel },
  });
}

/**
 * GET /api/chat/recent?since=<ts>&channel=global
 *
 * Sin `since` → últimos 30 mensajes (orden ASC, listos para append).
 * Con `since` → solo mensajes con sent_at > since (orden ASC, cap 50).
 *
 * Devuelve { messages: [{id, user_id, username, message, sent_at}], server_now }.
 * Si la tabla no existe en D1, devuelve { messages: [], server_now, chat_disabled: true }.
 */
export async function chatRecent(since, channel = 'global') {
  const params = new URLSearchParams();
  if (since != null && Number.isFinite(since) && since > 0) {
    params.set('since', String(since));
  }
  if (channel) params.set('channel', channel);
  const qs = params.toString();
  return apiFetch(`/api/chat/recent${qs ? '?' + qs : ''}`, { auth: true });
}

// ============================================================
// Sesión 30 — Woodcutting + Firemaking
// ============================================================

/**
 * POST /api/woodcutting/chop { tree_type, x, z }
 *
 * Intenta talar el árbol en (x, z). Server valida proximidad (online_users),
 * axe, nivel, no depleted, espacio en inventario. Si todo ok, suma 1 log
 * al inventory y XP al skill 'woodcutting'.
 *
 * Devuelve:
 *   { ok, log_item, xp_gained, skill_id, new_xp, new_level, level_up,
 *     levels_gained, prev_level, depleted_until }
 *
 * Errores comunes (err.code):
 *   - no_position        → sin heartbeat reciente
 *   - out_of_range       → demasiado lejos del árbol
 *   - no_axe             → no tenés hacha
 *   - level_too_low      → nivel insuficiente
 *   - tree_depleted      → árbol agotado, esperar respawn
 *   - inventory_full     → mochila llena
 *   - invalid_tree_type  → tree_type desconocido
 *   - wc_disabled        → tabla tree_state no migrada
 */
export async function wcChop(treeType, x, z) {
  return apiFetch('/api/woodcutting/chop', {
    method: 'POST',
    auth: true,
    body: { tree_type: treeType, x, z },
  });
}

/**
 * POST /api/firemaking/light { slot }
 *
 * Enciende un fuego en la pos del player consumiendo 1 log del `slot`
 * indicado del inventario. Requiere yesquero (tinderbox) en cualquier slot.
 *
 * Devuelve:
 *   { ok, fire: {id, x, z, log_type, lit_at, expires_at},
 *     consumed_item, xp_gained, skill_id, new_xp, new_level,
 *     level_up, levels_gained, prev_level }
 *
 * Errores comunes (err.code):
 *   - invalid_slot      → slot fuera de [0, 27]
 *   - empty_slot        → no hay item en ese slot
 *   - not_a_log         → ese item no es log
 *   - no_tinderbox      → no tenés yesquero
 *   - level_too_low     → nivel insuficiente
 *   - no_position       → sin heartbeat reciente
 *   - fm_disabled       → tabla fires no migrada
 */
export async function fmLight(slot) {
  return apiFetch('/api/firemaking/light', {
    method: 'POST',
    auth: true,
    body: { slot },
  });
}

// ---------- Highscores (Sesión 42) ----------
/**
 * Ranking global de jugadores, ordenado por nivel total (tiebreak XP total).
 * `auth: true` para que el server marque is_you en la fila propia.
 * Respuesta: { ranking: [{ rank, username, total_level, combat_level, total_xp, is_you }], count }
 */
export async function getHighscores() {
  return apiFetch('/api/skills/highscores', { auth: true });
}
