/**
 * SebasPresent — Sesiones + password hashing (PBKDF2)
 *
 * Token = 32 bytes random hex. Vive en tabla `sessions`.
 * Password = pbkdf2$iterations$saltHex$hashHex.
 */

export const SESSION_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;   // 30 días
export const PBKDF2_ITERATIONS = 100_000;

export async function createSession(env, userId) {
  const tokenBytes = crypto.getRandomValues(new Uint8Array(32));
  const token = bytesToHex(tokenBytes);
  const now = Date.now();
  const expiresAt = now + SESSION_LIFETIME_MS;
  await env.DB.prepare(
    'INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)'
  ).bind(token, userId, now, expiresAt).run();
  return token;
}

/**
 * Verifica el token Bearer y devuelve la sesión, o `null` si:
 *  - no hay token
 *  - el token no existe
 *  - el token está expirado (en cuyo caso también lo borra de DB)
 */
export async function requireSession(request, env) {
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

export function bearerToken(request) {
  const auth = request.headers.get('Authorization') || '';
  const match = auth.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

// ============================================================
// Password hashing — PBKDF2 + timing-safe compare
// ============================================================
export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(password, salt, PBKDF2_ITERATIONS);
  return `pbkdf2$${PBKDF2_ITERATIONS}$${bytesToHex(salt)}$${bytesToHex(hash)}`;
}

export async function verifyPassword(password, stored) {
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

// ============================================================
// Hex helpers
// ============================================================
export function bytesToHex(bytes) {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

export function hexToBytes(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}
