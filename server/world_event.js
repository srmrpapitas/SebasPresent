/**
 * SebasPresent — Evento de la isla «¡El Teide ruge!» (Sesión 53)
 * Horario y datos en client/src/shared/world_events.js.
 *
 *   tickWorldEvent(env, now)   → lo llama el cron cada minuto: aviso 5 min antes,
 *                                despertar al empezar, dormir si nadie la vence.
 *   recordEventHit(env, uid)   → al pegarle (1 escritura por jugador y evento).
 *   rewardEvent(env, killer)   → al morir: premio para TODOS los que le pegaron.
 *
 * Todo condicionado (status / INSERT OR IGNORE): solo una petición despierta,
 * duerme o reparte.
 */
import { WORLD_EVENT, EVENT_REWARD, eventWindow } from '../client/src/shared/world_events.js';
import { pushRealtime } from './lib/realtime.js';
import { grantItem } from './lib/quests.js';

const B = WORLD_EVENT.boss;

export async function tickWorldEvent(env, now = Date.now()) {
  const w = eventWindow(now);
  if (w.active) {
    // Despertar (una vez por evento: si ya murió en ESTE evento, no vuelve)
    const r = await env.DB.prepare(
      `UPDATE npc_instances SET status = 0, hp_current = (SELECT max_hp FROM npc_defs WHERE id = npc_instances.def_id),
              x = spawn_x, z = spawn_z, died_at = NULL, in_combat_with = NULL, last_attack_at = NULL
        WHERE def_id = ? AND status = 1 AND (died_at IS NULL OR died_at < ?)`
    ).bind(B, w.start).run();
    if (r?.meta?.changes) {
      try { await env.DB.prepare('DELETE FROM event_hits WHERE event_start < ?').bind(w.start).run(); } catch {}
      try { await env.DB.prepare("UPDATE boss_state SET hazards = '[]', phase = 0, empty_since = 0 WHERE boss_id = ?").bind(B).run(); } catch {}
      await pushRealtime(env, { t: 'ann', k: 'ev_start', end: w.end });
      return 'start';
    }
    return null;
  }
  // Fuera del evento: si sigue viva, se va (nadie la venció a tiempo)
  const r = await env.DB.prepare(
    'UPDATE npc_instances SET status = 1, died_at = ?, in_combat_with = NULL WHERE def_id = ? AND status = 0'
  ).bind(now, B).run();
  if (r?.meta?.changes) {
    await pushRealtime(env, { t: 'ann', k: 'ev_gone' });
    return 'gone';
  }
  // Aviso: en el minuto en que faltan 5 (el cron va cada minuto)
  const toNext = w.next - now;
  if (toNext <= 5 * 60_000 && toNext > 4 * 60_000) {
    await pushRealtime(env, { t: 'ann', k: 'ev_warn', at: w.next });
    return 'warn';
  }
  return null;
}

export async function recordEventHit(env, uid, now = Date.now()) {
  const w = eventWindow(now);
  if (!w.active) return;
  try {
    await env.DB.prepare('INSERT OR IGNORE INTO event_hits (event_start, user_id, at) VALUES (?, ?, ?)').bind(w.start, uid, now).run();
  } catch (err) { console.warn('[evento] hit:', err?.message); }
}

function roll(rows, rng) {
  const random = rows.filter(r => !r.is_always && r.item_id !== 'coins');
  const total = random.reduce((s, r) => s + (r.weight | 0), 0);
  let pick = rng() * total;
  for (const r of random) {
    pick -= r.weight;
    if (pick <= 0) return { item_id: r.item_id, name: r.name || r.item_id, qty: r.qty_min + Math.floor(rng() * (r.qty_max - r.qty_min + 1)) };
  }
  return null;
}

/** La Tibicena Mayor ha muerto (solo una petición llega aquí: la que reclamó la muerte). */
export async function rewardEvent(env, killerUid, now = Date.now(), rng = Math.random) {
  const w = eventWindow(now);
  await recordEventHit(env, killerUid, now);
  const rows = (await env.DB.prepare('SELECT user_id FROM event_hits WHERE event_start = ?').bind(w.start).all()).results || [];
  const loot = (await env.DB.prepare(
    `SELECT l.item_id, l.qty_min, l.qty_max, l.weight, l.is_always, i.name FROM npc_loot_table l
       LEFT JOIN items i ON i.id = l.item_id WHERE l.npc_def_id = ?`).bind(B).all()).results || [];
  const names = (await env.DB.prepare(
    `SELECT id, username FROM users WHERE id IN (SELECT user_id FROM event_hits WHERE event_start = ?)`
  ).bind(w.start).all()).results || [];
  const nameOf = Object.fromEntries(names.map(r => [r.id, r.username]));
  const rewards = {};
  for (const { user_id: uid } of rows) {
    const coins = EVENT_REWARD.coinsMin + Math.floor(rng() * (EVENT_REWARD.coinsMax - EVENT_REWARD.coinsMin + 1));
    const it = roll(loot, rng);
    try {
      await grantItem(env, uid, 'coins', coins);
      if (it) await grantItem(env, uid, it.item_id, it.qty);
      // Registro de colección y contador (el que la mata ya lo cuenta el combate)
      if (it) await env.DB.prepare(
        `INSERT INTO user_collection (user_id, item_id, qty, first_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(user_id, item_id) DO UPDATE SET qty = qty + excluded.qty`).bind(uid, it.item_id, it.qty, now).run();
      if (uid !== killerUid) await env.DB.prepare(
        `INSERT INTO user_kc (user_id, npc_def_id, kills, first_at) VALUES (?, ?, 1, ?)
         ON CONFLICT(user_id, npc_def_id) DO UPDATE SET kills = kills + 1`).bind(uid, B, now).run();
    } catch (err) { console.warn('[evento] premio', uid, err?.message); }
    rewards[uid] = { c: coins, i: it?.name || null, q: it?.qty || 0 };
  }
  await pushRealtime(env, { t: 'ann', k: 'ev_won', u: nameOf[killerUid] || '?', n: rows.length, rw: rewards });
  return { participants: rows.length, rewards };
}
