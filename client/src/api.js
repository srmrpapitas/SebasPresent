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
    // Network error — Worker down, no internet, CORS misconfig, etc.
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
  } catch {
    // Even if the server call fails, clear the local token.
  }
  clearToken();
}

// ---------- Inventory endpoints (Slice 4a) ----------

/**
 * GET the current user's inventory.
 * Returns: { slots: [{slot, item_id, quantity, name, icon, stackable}, ...] }
 * Empty slots are NOT included in the response.
 */
export async function getInventory() {
  return apiFetch('/api/inventory', { auth: true });
}

/**
 * Swap or move items between two slots (0-27).
 * Server handles 4 cases atomically:
 *   - from empty: no-op
 *   - to empty: move
 *   - both occupied, same stackable: merge
 *   - both occupied, different: swap
 *
 * Returns: { ok: true }
 */
export async function swapInventorySlots(from, to) {
  return apiFetch('/api/inventory/swap', {
    method: 'POST',
    auth: true,
    body: { from, to },
  });
}
