/**
 * SebasPresent — API client
 *
 * One place that knows how to call the backend. All fetches go through here
 * so we can switch URLs, add headers, or log errors in a single spot.
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

export async function swapInventorySlots(from, to) {
  return apiFetch('/api/inventory/swap', {
    method: 'POST',
    auth: true,
    body: { from, to },
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

export async function attackNpc(npcId) {
  return apiFetch('/api/combat/attack', {
    method: 'POST',
    auth: true,
    body: { npc_id: npcId },
  });
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
