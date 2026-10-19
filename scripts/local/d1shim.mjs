// Pruebas locales — D1 simulada con node:sqlite (Node 22+).
// Imita lo que usa el servidor: prepare().bind().first/all/run/raw, batch, exec.
import { DatabaseSync } from 'node:sqlite';

function norm(v) {
  if (v === undefined) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  return v;
}

class Stmt {
  constructor(db, sql, params = []) { this.db = db; this.sql = sql; this.params = params; }
  bind(...p) { return new Stmt(this.db, this.sql, p.map(norm)); }
  _prep() { return this.db.prepare(this.sql); }
  _run() {
    const st = this._prep();
    if (st.columns && st.columns().length === 0) {
      const r = st.run(...this.params);
      return { results: [], meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } };
    }
    const rows = st.all(...this.params);
    return { results: rows.map(r => ({ ...r })), meta: { changes: 0 } };
  }
  async first(col) {
    const { results } = this._run();
    const r = results[0] ?? null;
    if (r && col) return r[col] ?? null;
    return r;
  }
  async all() { const r = this._run(); return { results: r.results, success: true, meta: r.meta }; }
  async run() { const r = this._run(); return { success: true, results: r.results, meta: r.meta }; }
  async raw() { const { results } = this._run(); return results.map(r => Object.values(r)); }
}

export function makeD1(file = ':memory:') {
  const db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys = OFF;');
  return {
    _db: db,
    prepare(sql) { return new Stmt(db, sql); },
    async batch(stmts) {
      db.exec('BEGIN');
      try {
        const out = stmts.map(s => { const r = s._run(); return { success: true, results: r.results, meta: r.meta }; });
        db.exec('COMMIT');
        return out;
      } catch (e) { db.exec('ROLLBACK'); throw e; }
    },
    async exec(sql) { db.exec(sql); return { count: 1 }; },
  };
}

// Ejecuta un .sql sentencia a sentencia, sin parar en los errores (las
// migraciones viejas a veces repiten columnas que ya están en schema.sql).
export function applySqlLoose(d1, sql, label = '') {
  let ok = 0, bad = 0;
  const parts = splitSql(sql);
  for (const p of parts) {
    try { d1._db.exec(p); ok++; } catch (e) { bad++; if (process.env.SQL_VERBOSE) console.warn(label, e.message, p.slice(0, 80)); }
  }
  return { ok, bad };
}

function splitSql(sql) {
  const out = []; let cur = ''; let inS = false; let depthTrig = 0;
  const lines = sql.split('\n');
  for (let line of lines) {
    if (!inS && /^\s*--/.test(line)) continue;
    cur += line + '\n';
    // contar comillas para no cortar dentro de un texto
    for (const ch of line) if (ch === "'") inS = !inS;
    if (!inS && /\bBEGIN\b/i.test(line) && /CREATE\s+TRIGGER/i.test(cur)) depthTrig = 1;
    if (!inS && depthTrig && /^\s*END\s*;\s*$/i.test(line)) { depthTrig = 0; out.push(cur); cur = ''; continue; }
    if (!inS && !depthTrig && /;\s*$/.test(line)) { out.push(cur); cur = ''; }
  }
  if (cur.trim()) out.push(cur);
  return out.filter(s => s.trim());
}
