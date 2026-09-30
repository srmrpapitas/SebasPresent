/**
 * SebasPresent — Romper tabletas de teletransporte (Sesión 50)
 *   POST /api/magic/tablet { slot } → gasta 1 tableta y te mueve a su destino.
 * El destino lo decide el server (shared/teleports.js). La posición nueva se
 * guarda en online_users y users (igual que el teleport a casa).
 */
import { json, readJson } from '../lib/db.js';
import { requireSession } from '../lib/auth.js';
import { getPlayerPosition } from './skills/_shared.js';
import { TABLETS, TELEPORT_WILD_LIMIT_X } from '../../client/src/shared/teleports.js';
import { questEvent } from '../lib/quests.js';

export async function handleTabletBreak(request, env) {
  const session = await requireSession(request, env);
  if (!session) return json({ error: 'unauthorized' }, 401);
  const userId = session.user_id;
  const body = await readJson(request);
  const slot = Number(body?.slot);
  if (!Number.isInteger(slot) || slot < 0 || slot > 27) return json({ error: 'invalid_slot' }, 400);

  const row = await env.DB.prepare(
    'SELECT item_id, quantity FROM user_inventory WHERE user_id = ? AND slot_index = ?'
  ).bind(userId, slot).first();
  const tab = row && TABLETS[row.item_id];
  if (!tab) return json({ error: 'not_a_tablet', message: 'Eso no es una tableta.' }, 400);

  // Muerto → no
  const st = await env.DB.prepare('SELECT hp_current FROM combat_stats WHERE user_id = ?').bind(userId).first();
  if (st && st.hp_current <= 0) return json({ error: 'user_dead', message: 'Estás muerto.' }, 400);

  // Demasiado profundo en la wilderness
  const pos = await getPlayerPosition(env, userId);
  if (pos && pos.x < TELEPORT_WILD_LIMIT_X) {
    return json({ error: 'too_deep', message: 'La magia no funciona tan dentro del Malpaís. Sal un poco al este.' }, 400);
  }

  // Gastar 1 (condicionado a que siga ahí)
  const now = Date.now();
  const use = row.quantity > 1
    ? await env.DB.prepare(
        'UPDATE user_inventory SET quantity = quantity - 1, updated_at = ? WHERE user_id = ? AND slot_index = ? AND item_id = ? AND quantity > 1'
      ).bind(now, userId, slot, row.item_id).run()
    : await env.DB.prepare(
        'DELETE FROM user_inventory WHERE user_id = ? AND slot_index = ? AND item_id = ? AND quantity = 1'
      ).bind(userId, slot, row.item_id).run();
  if (!use?.meta?.changes) return json({ error: 'conflict', message: 'Inténtalo otra vez.' }, 409);

  // Mover (un pequeño desvío para que no caigan todos en el mismo punto)
  const x = tab.x + (Math.random() - 0.5) * 3, z = tab.z + (Math.random() - 0.5) * 3;
  await env.DB.batch([
    env.DB.prepare('UPDATE online_users SET x = ?, z = ?, last_seen = ? WHERE user_id = ?').bind(x, z, now, userId),
    env.DB.prepare('UPDATE users SET last_x = ?, last_z = ? WHERE id = ?').bind(x, z, userId),
  ]);
  await questEvent(env, userId, 'teleport', row.item_id);
  return json({ ok: true, tablet: row.item_id, name: tab.name, x, z });
}
