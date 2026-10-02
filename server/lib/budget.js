/**
 * SebasPresent — Tope diario de la base de datos (Sesión 51)
 *
 * El juego se "corta" solo antes de pasar de los límites gratis de D1, pase
 * lo que pase (plan gratis o de pago): así nunca se cobra de más.
 *
 *   - Cada consulta devuelve cuántas filas leyó/escribió (meta.rows_read /
 *     rows_written). withBudget(env) envuelve env.DB y las suma en memoria.
 *   - Cada ~20 s (o al acumular mucho) se suman a la tabla usage_daily
 *     (1 escritura) → total del día entre todos los workers.
 *   - Cada 60 s se mira el total del día (1 lectura). Si pasa del tope, el
 *     worker contesta 503 "daily_cap" a todo hasta las 00:00 UTC (02:00 en
 *     Bruselas en verano) y el cliente enseña "El servidor descansa".
 *
 * Topes: un poco por debajo del gratis (5M lecturas, 100k escrituras), para
 * que siempre quede margen. Se pueden cambiar con las variables de entorno
 * CAP_READS / CAP_WRITES del worker.
 */

const DEF_CAP_READS = 4_500_000;
const DEF_CAP_WRITES = 90_000;
const FLUSH_MS = 20_000;
const CHECK_MS = 60_000;

let pendR = 0, pendW = 0, lastFlush = Date.now();
let lastCheck = 0, tripped = false, trippedDay = '', today = { reads: 0, writes: 0 };

function utcDay(t = Date.now()) { return new Date(t).toISOString().slice(0, 10); }

function addMeta(meta) {
  if (!meta) return;
  pendR += meta.rows_read || 0;
  pendW += meta.rows_written || 0;
}

function wrapStmt(stmt) {
  const w = {
    _inner: stmt,
    bind(...a) { return wrapStmt(stmt.bind(...a)); },
    async first(col) {
      // first() no devuelve meta: se usa all() (mismas filas leídas)
      const r = await stmt.all();
      addMeta(r?.meta);
      const row = r?.results?.[0] ?? null;
      return col ? (row ? row[col] : null) : row;
    },
    async all() { const r = await stmt.all(); addMeta(r?.meta); return r; },
    async run() { const r = await stmt.run(); addMeta(r?.meta); return r; },
    async raw(o) { return stmt.raw(o); },
  };
  return w;
}

function wrapDb(db) {
  if (!db || db.__budget) return db;
  return {
    __budget: true,
    prepare: (sql) => wrapStmt(db.prepare(sql)),
    async batch(stmts) {
      const res = await db.batch(stmts.map(s => s?._inner || s));
      for (const r of res || []) addMeta(r?.meta);
      return res;
    },
    exec: (sql) => db.exec(sql),
    dump: () => db.dump?.(),
    withSession: db.withSession ? (...a) => db.withSession(...a) : undefined,
  };
}

let _schemaOk = false;
async function ensureTable(rawDb) {
  if (_schemaOk) return;
  await rawDb.prepare('CREATE TABLE IF NOT EXISTS usage_daily (day TEXT PRIMARY KEY, reads INTEGER NOT NULL DEFAULT 0, writes INTEGER NOT NULL DEFAULT 0)').run();
  _schemaOk = true;
}

async function flush(rawDb, force = false) {
  const now = Date.now();
  if (!force && now - lastFlush < FLUSH_MS && pendR < 50_000 && pendW < 2_000) return;
  if (!pendR && !pendW) { lastFlush = now; return; }
  const r = pendR, w = pendW + 2;   // +2: esta misma escritura (fila + clave)
  pendR = 0; pendW = 0; lastFlush = now;
  try {
    await ensureTable(rawDb);
    await rawDb.prepare(
      `INSERT INTO usage_daily (day, reads, writes) VALUES (?, ?, ?)
       ON CONFLICT(day) DO UPDATE SET reads = reads + excluded.reads, writes = writes + excluded.writes`
    ).bind(utcDay(now), r, w).run();
  } catch (err) {
    pendR += r; pendW += w - 2;   // se reintenta en el siguiente
    console.warn('[budget] flush:', err?.message);
  }
}

async function check(rawDb, env) {
  const now = Date.now();
  const day = utcDay(now);
  if (tripped && trippedDay !== day) tripped = false;   // nuevo día
  if (now - lastCheck < CHECK_MS) return;
  lastCheck = now;
  try {
    await ensureTable(rawDb);
    const row = await rawDb.prepare('SELECT reads, writes FROM usage_daily WHERE day = ?').bind(day).first();
    today = { reads: row?.reads || 0, writes: row?.writes || 0 };
    const capR = Number(env.CAP_READS) || DEF_CAP_READS;
    const capW = Number(env.CAP_WRITES) || DEF_CAP_WRITES;
    if (today.reads >= capR || today.writes >= capW) { tripped = true; trippedDay = day; }
  } catch (err) {
    // Si D1 ya está cortado por Cloudflare, también paramos
    if (/daily row (read|write) limit/i.test(err?.message || '')) { tripped = true; trippedDay = day; }
  }
}

/**
 * Envuelve env para contar el gasto. Devuelve { env, done } — llamar a
 * done(ctx) al terminar (sube el contador sin hacer esperar al jugador).
 */
export function withBudget(env) {
  const rawDb = env.DB;
  const db = wrapDb(rawDb);
  const wrapped = new Proxy(env, { get: (t, k) => (k === 'DB' ? db : t[k]) });
  return {
    env: wrapped,
    async gate() { await check(rawDb, env); return !tripped; },
    done(ctx) {
      const p = flush(rawDb);
      if (ctx?.waitUntil) ctx.waitUntil(p); else return p;
    },
  };
}

/** Estado para /api/health y depuración. */
export function budgetStatus(env) {
  return {
    day: utcDay(), tripped, today,
    cap: { reads: Number(env.CAP_READS) || DEF_CAP_READS, writes: Number(env.CAP_WRITES) || DEF_CAP_WRITES },
    pending: { reads: pendR, writes: pendW },
  };
}

/** Segundos hasta las 00:00 UTC (reinicio). */
export function secondsToReset() {
  const now = new Date();
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  return Math.max(0, Math.round((next - now.getTime()) / 1000));
}
