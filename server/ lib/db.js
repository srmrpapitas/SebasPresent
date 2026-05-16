/**
 * SebasPresent — DB adapter + JSON/CORS helpers
 *
 * Reutilizado por todos los handlers HTTP.
 */

/**
 * Adaptador del binding D1 a la interfaz pure que esperan los engines
 * (combat_engine.js, ge_engine.js):
 *   first(sql, params) → row | null
 *   all(sql, params)   → row[]
 *   run(sql, params)   → meta
 *   batch(stmts)       → results[]
 */
export function makeDbAdapter(env) {
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
 * Convierte errores de ge_engine (con .code conocido) en una Response 400
 * descriptiva. Los errores no reconocidos se loguean y devuelven 500.
 */
export function geErrorResponse(err) {
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
 * Parser de JSON request body que no lanza. Devuelve `null` si el body
 * no es JSON válido. Los handlers comprueban el resultado y devuelven
 * 400 si necesario.
 */
export async function readJson(request) {
  try { return await request.json(); } catch { return null; }
}

/**
 * Construye una Response JSON. `status` default 200.
 */
export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// ============================================================
// CORS
// ============================================================
export function originAllowed(origin, env) {
  if (!origin) return false;
  const allowed = (env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim());
  return allowed.includes(origin) || allowed.includes('*');
}

/**
 * Para preflight requests (OPTIONS).
 */
export function corsResponse(request, env) {
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

/**
 * Wrappea una Response existente con headers CORS apropiados.
 */
export function withCors(response, request, env) {
  const origin = request.headers.get('Origin') || '';
  if (originAllowed(origin, env)) {
    const headers = new Headers(response.headers);
    headers.set('Access-Control-Allow-Origin', origin);
    headers.set('Vary', 'Origin');
    return new Response(response.body, { status: response.status, headers });
  }
  return response;
}
