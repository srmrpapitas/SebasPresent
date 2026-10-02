/**
 * SebasPresent — Lecturas baratas de monstruos (Sesión 51)
 *
 *  - getNpcDefs(): las fichas de los monstruos (npc_defs) casi nunca cambian.
 *    Se guardan en memoria del worker 10 min en vez de leerlas (JOIN) en cada
 *    petición: cada JOIN contaba una lectura D1 por monstruo.
 *  - readNpcsNear(): monstruos vivos alrededor de un punto usando la columna
 *    `cell` + índice (status, cell). Si la migración 019 aún no está, cae a la
 *    búsqueda por caja de siempre (y lo vuelve a intentar cada 5 min).
 */
import { cellsAround, qMarks } from '../../client/src/shared/grid.js';

const DEFS_TTL_MS = 10 * 60_000;
let _defs = null;
let _defsAt = 0;

export async function getNpcDefs(env) {
  const now = Date.now();
  if (_defs && now - _defsAt < DEFS_TTL_MS) return _defs;
  const rows = (await env.DB.prepare('SELECT * FROM npc_defs').all()).results || [];
  _defs = new Map(rows.map(r => [r.id, r]));
  _defsAt = now;
  return _defs;
}

/** Para tests / tras cambiar npc_defs en caliente. */
export function _resetNpcDefsCache() { _defs = null; _defsAt = 0; }

const NPC_COLS = `id, def_id, x, z, hp_current, status, in_combat_with, last_attack_at, last_moved_at,
  spawn_x, spawn_z, frozen_until, def_drain, def_drain_until, owner_user_id`;

let _cellOk = true;
let _cellRetryAt = 0;

/**
 * Monstruos vivos (status 0) en el cuadrado de lado 2r alrededor de (x,z),
 * visibles para `userId` (los de nadie + los suyos). Sin JOIN: las columnas de
 * la ficha se ponen desde la caché (campo `def`).
 */
export async function readNpcsNear(env, userId, x, z, r) {
  const now = Date.now();
  let rows = null;
  if (_cellOk || now >= _cellRetryAt) {
    const cells = cellsAround(x, z, r);
    try {
      rows = (await env.DB.prepare(
        `SELECT ${NPC_COLS} FROM npc_instances
          WHERE status = 0 AND cell IN (${qMarks(cells.length)})
            AND (owner_user_id IS NULL OR owner_user_id = ?)`
      ).bind(...cells, userId).all()).results || [];
      _cellOk = true;
    } catch (err) {
      // Columna `cell` aún no creada → caja de siempre
      if (!/no such column|cell/i.test(err?.message || '')) throw err;
      _cellOk = false;
      _cellRetryAt = now + 5 * 60_000;
    }
  }
  if (!rows) {
    rows = (await env.DB.prepare(
      `SELECT ${NPC_COLS} FROM npc_instances
        WHERE status = 0 AND (owner_user_id IS NULL OR owner_user_id = ?)
          AND x BETWEEN ? AND ? AND z BETWEEN ? AND ?`
    ).bind(userId, x - r, x + r, z - r, z + r).all()).results || [];
  }
  const defs = await getNpcDefs(env);
  const out = [];
  for (const row of rows) {
    if (Math.abs(row.x - x) > r || Math.abs(row.z - z) > r) continue;
    const d = defs.get(row.def_id);
    if (!d) continue;
    row.def = d;
    out.push(row);
  }
  return out;
}
