/**
 * SebasPresent — Límite de intentos (Sesión 50). Ventana fija por clave,
 * contador atómico en D1 (un solo UPSERT … RETURNING).
 */
export const LIMITS = {
  login_ip:   { max: 40, windowMs: 15 * 60_000 },   // intentos de login desde una IP
  login_fail: { max: 10, windowMs: 15 * 60_000 },   // fallos seguidos contra una cuenta
  reg_ip:     { max: 5,  windowMs: 60 * 60_000 },   // cuentas nuevas por IP y hora
};

export function clientIp(request) {
  return request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() || 'local';
}

/** Suma 1 y devuelve el total de la ventana actual. */
export async function hit(env, kind, id, now = Date.now()) {
  const L = LIMITS[kind], k = `${kind}:${id}`, cut = now - L.windowMs;
  const r = await env.DB.prepare(
    `INSERT INTO auth_limits (k, win, n) VALUES (?, ?, 1)
     ON CONFLICT(k) DO UPDATE SET
       n   = CASE WHEN auth_limits.win < ? THEN 1 ELSE auth_limits.n + 1 END,
       win = CASE WHEN auth_limits.win < ? THEN ? ELSE auth_limits.win END
     RETURNING n`
  ).bind(k, now, cut, cut, now).first();
  return r?.n ?? 1;
}

/** Total actual sin sumar. */
export async function peek(env, kind, id, now = Date.now()) {
  const L = LIMITS[kind];
  const r = await env.DB.prepare('SELECT win, n FROM auth_limits WHERE k = ?').bind(`${kind}:${id}`).first();
  if (!r || r.win < now - L.windowMs) return 0;
  return r.n;
}

export async function clear(env, kind, id) {
  await env.DB.prepare('DELETE FROM auth_limits WHERE k = ?').bind(`${kind}:${id}`).run();
}

export function over(kind, n) { return n > LIMITS[kind].max; }
