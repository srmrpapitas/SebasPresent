/**
 * SebasPresent — Poder mágico de las túnicas puestas (Sesión 52).
 * Para los handlers con env.DB (el motor de combate tiene su propia versión).
 */
import { robeMagicBonus } from '../../client/src/shared/equip_reqs.js';

export async function robeBonusOf(env, userId) {
  try {
    const r = await env.DB.prepare('SELECT item_id FROM user_equipment WHERE user_id = ?').bind(userId).all();
    return robeMagicBonus((r?.results || []).map(x => x.item_id));
  } catch { return { hit: 0, mana: 0 }; }
}
