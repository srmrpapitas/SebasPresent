/**
 * SebasPresent — Tesoros escondidos (Sesión 53). Ver client/src/shared/treasures.js.
 *   POST /api/treasure/open { id } → hay que estar al lado; una vez al día por cofre.
 * La guarda es el propio UPSERT (solo cambia si last_day < hoy): dos peticiones
 * a la vez no cobran dos veces.
 */
import { json, readJson } from '../lib/db.js';
import { requireSession } from '../lib/auth.js';
import { own } from '../lib/atomic.js';
import { getPlayerPosition } from './skills/_shared.js';
import { grantItem } from '../lib/quests.js';
import { TREASURES_BY_ID, TREASURE_USE_DIST_M, TREASURE_LOOT } from '../../client/src/shared/treasures.js';
import { dayNumber, msToNextDay } from '../../client/src/shared/dailies.js';

const SLACK_M = 6;   // la posición guardada va algo por detrás

function roll(tier, rng = Math.random) {
  const L = TREASURE_LOOT[tier];
  const coins = L.coins[0] + Math.floor(rng() * (L.coins[1] - L.coins[0] + 1));
  const total = L.items.reduce((s, it) => s + it[1], 0);
  let pick = rng() * total, it = L.items[0];
  for (const x of L.items) { pick -= x[1]; if (pick <= 0) { it = x; break; } }
  const qty = it[2] + Math.floor(rng() * (it[3] - it[2] + 1));
  return { coins, item: it[0], qty };
}

export async function handleTreasureOpen(request, env) {
  const session = await requireSession(request, env);
  if (!session) return json({ error: 'unauthorized' }, 401);
  const body = await readJson(request);
  const T = own(TREASURES_BY_ID, body?.id);
  if (!T) return json({ error: 'invalid_treasure' }, 400);
  const uid = session.user_id, now = Date.now();
  const pos = await getPlayerPosition(env, uid);
  if (!pos) return json({ error: 'no_position' }, 400);
  const d = Math.hypot(pos.x - T.x, pos.z - T.z);
  if (!(d <= TREASURE_USE_DIST_M + SLACK_M)) return json({ error: 'too_far', distance: Math.round(d) }, 400);
  const day = dayNumber(now);
  const row = await env.DB.prepare(
    `INSERT INTO user_treasures (user_id, treasure_id, first_at, last_day, opens) VALUES (?, ?, ?, ?, 1)
     ON CONFLICT(user_id, treasure_id) DO UPDATE SET last_day = excluded.last_day, opens = user_treasures.opens + 1
       WHERE user_treasures.last_day < excluded.last_day
     RETURNING opens`
  ).bind(uid, T.id, now, day).first();
  if (!row) {
    const m = Math.ceil(msToNextDay(now) / 60_000);
    return json({ error: 'already', message: `Está vacío. Se vuelve a llenar en ${m >= 60 ? Math.floor(m / 60) + ' h ' + (m % 60) + ' min' : m + ' min'}.`, ms: msToNextDay(now) }, 400);
  }
  const r = roll(T.tier);
  await grantItem(env, uid, 'coins', r.coins);
  await grantItem(env, uid, r.item, r.qty);
  const meta = await env.DB.prepare('SELECT name, icon FROM items WHERE id = ?').bind(r.item).first();
  const found = await env.DB.prepare('SELECT COUNT(*) AS n FROM user_treasures WHERE user_id = ?').bind(uid).first();
  return json({ ok: true, id: T.id, first: row.opens === 1, coins: r.coins, item: { id: r.item, name: meta?.name || r.item, icon: meta?.icon || null, qty: r.qty }, found: found?.n || 0, day });
}
