/**
 * SebasPresent — Scheduled (cron) handler
 * Trigger: cada 1 min (definido en wrangler.toml).
 *
 * Tareas:
 *   1) GE matcher: empareja órdenes buy/sell compatibles.
 *   2) GE reseed: re-genera órdenes ghost del sistema (price discovery).
 *   3) Combat: revive NPCs que llevan tiempo muertos.
 *   4) Ground items: limpia items expirados.
 */

import { makeDbAdapter } from '../lib/db.js';
import { runMatcher, reseedGhostOrders } from '../ge_engine.js';
import { reviveExpiredNpcs } from '../combat_engine.js';

export async function scheduledHandler(event, env, ctx) {
  const db = makeDbAdapter(env);

  // 1) GE: matcher + ghost reseed
  try {
    const matched = await runMatcher(db);
    const reseed = await reseedGhostOrders(db);
    console.log(`[ge-cron] matches=${matched.matches} items=${matched.items.join(',')} reseed=${reseed.inserted}`);
  } catch (err) {
    console.error('[ge-cron] error:', err);
  }

  // 2) Combat: revive NPCs muertos cuyo respawn time pasó
  try {
    const revived = await reviveExpiredNpcs(db, {});
    if (revived.revived > 0) {
      console.log(`[combat-cron] revived=${revived.revived}`);
    }
  } catch (err) {
    console.error('[combat-cron] error:', err);
  }

  // 3) Ground items: cleanup de despawn_at vencidos
  try {
    const cleaned = await env.DB.prepare(
      'DELETE FROM ground_items WHERE despawn_at <= ?'
    ).bind(Date.now()).run();
    const changes = cleaned?.meta?.changes || 0;
    if (changes > 0) {
      console.log(`[ground-items-cron] cleaned=${changes}`);
    }
  } catch (err) {
    console.error('[ground-items-cron] error:', err);
  }
}
