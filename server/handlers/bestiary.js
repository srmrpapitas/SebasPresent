/**
 * SebasPresent — Bestiario (Sesión 51)
 * GET /api/bestiary → fichas de todos los monstruos + su botín.
 *
 * Las fichas y el botín casi nunca cambian: se guardan en memoria del worker
 * 30 min (una lectura de ~300 filas como mucho cada media hora, en vez de en
 * cada apertura del libro). Dónde vive cada uno lo sabe el cliente
 * (shared/hunting_zones.js).
 */
import { json } from '../lib/db.js';
import { requireSession } from '../lib/auth.js';

const TTL_MS = 30 * 60_000;
let _cache = null;
let _cacheAt = 0;

async function build(env) {
  const defs = (await env.DB.prepare(
    `SELECT id, name, max_hp, attack_lvl, strength_lvl, defence_lvl, max_hit,
            attack_range, behavior, aggro_radius, style, respawn_ms, xp_per_kill
       FROM npc_defs`
  ).all()).results || [];
  const loot = (await env.DB.prepare(
    `SELECT l.npc_def_id, l.item_id, l.qty_min, l.qty_max, l.weight, l.is_always,
            i.name AS item_name, i.icon AS item_icon
       FROM npc_loot_table l LEFT JOIN items i ON i.id = l.item_id`
  ).all()).results || [];
  // Probabilidad de cada objeto aleatorio = su peso / suma de pesos de ese
  // monstruo (cae UNO de los aleatorios por muerte, más los "siempre").
  const byDef = {};
  for (const r of loot) (byDef[r.npc_def_id] ||= []).push(r);
  const lootOut = {};
  for (const [defId, rows] of Object.entries(byDef)) {
    const total = rows.filter(r => !r.is_always).reduce((a, r) => a + (r.weight | 0), 0);
    lootOut[defId] = rows.map(r => ({
      id: r.item_id, name: r.item_name || r.item_id, icon: r.item_icon || null,
      min: r.qty_min, max: r.qty_max,
      always: !!r.is_always,
      chance: r.is_always ? 1 : (total > 0 ? (r.weight | 0) / total : 0),
    })).sort((a, b) => (b.always - a.always) || (b.chance - a.chance));
  }
  return {
    defs: defs.filter(d => d.behavior !== 'minigame' || d.id === 'fosa_ignaroth'),
    loot: lootOut,
  };
}

export async function handleBestiary(request, env) {
  const session = await requireSession(request, env);
  if (!session) return json({ error: 'unauthorized' }, 401);
  const now = Date.now();
  try {
    if (!_cache || now - _cacheAt > TTL_MS) {
      _cache = await build(env);
      _cacheAt = now;
    }
    return json(_cache);
  } catch (err) {
    console.error('[bestiary]', err);
    return json({ error: 'internal_error', message: err.message }, 500);
  }
}
