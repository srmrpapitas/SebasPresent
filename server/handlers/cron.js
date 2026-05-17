/**
 * SebasPresent — Scheduled (cron) handler
 * Trigger: cada 1 min (definido en wrangler.toml).
 *
 * Tareas:
 *   1) GE matcher: empareja órdenes buy/sell compatibles.
 *   2) GE reseed: re-genera órdenes ghost del sistema (price discovery).
 *   3) Combat: revive NPCs que llevan tiempo muertos.
 *   4) Ground items: limpia items expirados.
 *   5) Shop restock: cada 30 min, sube stock +5 sin pasar max (Sesión 23).
 */
import { makeDbAdapter } from '../lib/db.js';
import { runMatcher, reseedGhostOrders } from '../ge_engine.js';
import { reviveExpiredNpcs } from '../combat_engine.js';
import { restockShops } from './shop.js';

// Estado en memoria del worker — se resetea si el worker se reinicia, lo
// cual es OK porque el restock simplemente se ejecuta antes una vez. Si
// quieres exactitud absoluta de "30min", usa shop_stock.last_restock_at
// como guardia (ya está). Aquí solo evitamos llamar 30 veces seguidas.
let lastShopRestockMs = 0;
const SHOP_RESTOCK_INTERVAL_MS = 30 * 60 * 1000;

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

  // 4) Shop restock cada 30 min (Sesión 23)
  try {
    const now = Date.now();
    if (now - lastShopRestockMs >= SHOP_RESTOCK_INTERVAL_MS) {
      await restockShops(env);
      lastShopRestockMs = now;
      console.log('[shop-cron] restocked');
    }
  } catch (err) {
    console.error('[shop-cron] error:', err);
  }
}
