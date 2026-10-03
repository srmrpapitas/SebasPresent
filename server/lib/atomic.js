/**
 * SebasPresent — Operaciones atómicas contra "carreras" (Sesión 51)
 *
 * Problema: muchas acciones leían una fila (p. ej. el slot 3 de la mochila),
 * hacían más consultas y después escribían "en el slot 3" sin comprobar que
 * seguía allí lo mismo. Dos peticiones a la vez (cocinar + mover, equipar +
 * desequipar…) podían así duplicar objetos o convertir monedas en tiburones.
 *
 * Solución: D1 ejecuta cada lote (env.DB.batch) como UNA transacción y en
 * serie con el resto de consultas. Si el primer statement del lote es una
 * GUARDA que falla, json('guard') lanza error y D1 deshace TODO el lote.
 * Es un compare-and-swap:
 *
 *   const ok = await atomicBatch(env, [
 *     guardSlot(env, uid, slot, 'raw_chicken', 1),     // ¿sigue igual?
 *     env.DB.prepare('UPDATE … ').bind(…),             // entonces cambia
 *   ]);
 *   if (!ok) return changed();                         // 409: otra vez
 *
 * Para el adaptador de los engines ({ sql, params }) están las variantes
 * guardSql / slotCondSql.
 */

import { json } from './db.js';

/** Statement que aborta el lote si `condSql` (expresión SQL booleana) no es cierta. */
export function guard(env, condSql, params = []) {
  return env.DB.prepare(`SELECT json(CASE WHEN (${condSql}) THEN '1' ELSE 'guard' END) AS g`).bind(...params);
}
/** Lo mismo para el adaptador { sql, params } de combat_engine / ge_engine. */
export function guardSql(condSql, params = []) {
  return { sql: `SELECT json(CASE WHEN (${condSql}) THEN '1' ELSE 'guard' END) AS g`, params };
}

/** Condición: el slot de la mochila tiene exactamente ese objeto (y esa cantidad, si se da). */
export function slotCond(userId, slot, itemId, qty = null) {
  return qty == null
    ? { sql: '(SELECT item_id = ? FROM user_inventory WHERE user_id = ? AND slot_index = ?)', params: [itemId, userId, slot] }
    : { sql: '(SELECT item_id = ? AND quantity = ? FROM user_inventory WHERE user_id = ? AND slot_index = ?)', params: [itemId, qty, userId, slot] };
}
/** Condición: el slot de la mochila está vacío. */
export function slotEmptyCond(userId, slot) {
  return { sql: 'NOT EXISTS (SELECT 1 FROM user_inventory WHERE user_id = ? AND slot_index = ?)', params: [userId, slot] };
}
/** Une varias condiciones con AND. */
export function allConds(conds) {
  const list = conds.filter(Boolean);
  if (!list.length) return { sql: '1', params: [] };
  return { sql: list.map(c => `(${c.sql})`).join(' AND '), params: list.flatMap(c => c.params) };
}

export function guardSlot(env, userId, slot, itemId, qty = null) {
  const c = slotCond(userId, slot, itemId, qty);
  return guard(env, c.sql, c.params);
}
export function guardConds(env, conds) {
  const c = allConds(conds);
  return guard(env, c.sql, c.params);
}

/** ¿El error es "la guarda falló" o "alguien ocupó ese hueco a la vez"? */
export function isRaceError(e) {
  const m = String(e?.message || e || '');
  return /malformed JSON|UNIQUE constraint|PRIMARY KEY|constraint failed/i.test(m);
}

/** Ejecuta el lote. true = hecho; false = algo cambió a la vez (no se hizo nada). */
export async function atomicBatch(env, stmts) {
  try {
    await env.DB.batch(stmts);
    return true;
  } catch (e) {
    if (isRaceError(e)) return false;
    throw e;
  }
}
/** Variante para el adaptador { sql, params }. */
export async function atomicBatchDb(db, stmts) {
  try {
    await db.batch(stmts);
    return true;
  } catch (e) {
    if (isRaceError(e)) return false;
    throw e;
  }
}

/** Respuesta estándar cuando otra acción simultánea cambió la mochila. */
export function changed(message = 'Tu mochila cambió mientras tanto. Inténtalo otra vez.') {
  return json({ error: 'changed', message }, 409);
}

/** Lookup seguro en objetos-tabla (evita '__proto__', 'constructor'…). */
export function own(obj, key) {
  return (obj && typeof key === 'string' && Object.prototype.hasOwnProperty.call(obj, key)) ? obj[key] : undefined;
}
