/**
 * SebasPresent — Robo (pickpocket) · Sesión 50
 *   POST /api/thieving/npc    { npc_id }          → robar a un habitante
 *   POST /api/thieving/player { target_user_id }  → robar a un jugador (Robo 50+)
 *
 * Reglas en client/src/shared/thieving.js. Si te pillan, aparecen guardias
 * que te atacan solo a ti (npc_instances con owner_user_id = tú y
 * expires_at): te persiguen hasta que huyes lejos y desaparecen al minuto.
 * Robo a jugadores: un objeto de su MOCHILA (nunca lo equipado), quitado con
 * guarda y dado en el mismo batch → no se duplica nada.
 */
import { json, readJson } from '../lib/db.js';
import { requireSession } from '../lib/auth.js';
import { pushRealtime } from '../lib/realtime.js';
import { placeStmts } from '../lib/give.js';
import { grantXp } from '../lib/quests.js';
import { levelFromXp } from '../combat_engine.js';
import { TOWN_NPCS_BY_ID, npcDist } from '../../client/src/shared/town_npcs.js';
import {
  THIEF_SKILL, PLAYER_STEAL_LEVEL, STEAL_DIST_SERVER_M, STEAL_COOLDOWN_MS, CAUGHT_LOCK_MS,
  profileOf, catchChance, playerCatchChance, rollLoot, PLAYER_STEAL_XP,
} from '../../client/src/shared/thieving.js';

const GUARD_DEF = 'guardia_ciudad';
const GUARD_TTL_MS = 60_000;
const ONLINE_MS = 30_000;

async function thiefLevel(env, uid) {
  const r = await env.DB.prepare('SELECT xp FROM user_skills WHERE user_id = ? AND skill_id = ?').bind(uid, THIEF_SKILL).first();
  return levelFromXp(r?.xp || 0);
}

/** Cooldown/bloqueo con guarda: devuelve null si puede, o el error. */
async function takeTurn(env, uid, now) {
  await env.DB.prepare('INSERT OR IGNORE INTO user_thieving (user_id, last_at, locked_until) VALUES (?, 0, 0)').bind(uid).run();
  const r = await env.DB.prepare('UPDATE user_thieving SET last_at = ? WHERE user_id = ? AND last_at <= ? AND locked_until <= ?')
    .bind(now, uid, now - STEAL_COOLDOWN_MS, now).run();
  if (r?.meta?.changes) return null;
  const row = await env.DB.prepare('SELECT locked_until FROM user_thieving WHERE user_id = ?').bind(uid).first();
  if (row && row.locked_until > now) return json({ error: 'locked', message: '¡Te acaban de pillar! Espera a que se calmen las cosas.', until: row.locked_until }, 400);
  return json({ error: 'too_fast', message: 'Despacio, que te van a ver.' }, 429);
}

async function caught(env, uid, x, z, now) {
  await env.DB.prepare('UPDATE user_thieving SET locked_until = ? WHERE user_id = ?').bind(now + CAUGHT_LOCK_MS, uid).run();
  // Dos guardias junto a la víctima, ya persiguiéndote
  const def = await env.DB.prepare('SELECT max_hp FROM npc_defs WHERE id = ?').bind(GUARD_DEF).first();
  if (!def) return 0;
  // no amontonar guardias: como mucho 4 a la vez por ladrón
  const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM npc_instances WHERE owner_user_id = ? AND def_id = ? AND status = 0').bind(uid, GUARD_DEF).first();
  const spawnN = Math.max(0, Math.min(2, 4 - (n?.n || 0)));
  for (let i = 0; i < spawnN; i++) {
    const a = Math.random() * Math.PI * 2, gx = x + Math.cos(a) * 4, gz = z + Math.sin(a) * 4;
    await env.DB.prepare(
      `INSERT INTO npc_instances (def_id, hp_current, x, z, status, spawn_x, spawn_z, owner_user_id, in_combat_with, expires_at)
       VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?, ?)`
    ).bind(GUARD_DEF, def.max_hp, gx, gz, gx, gz, uid, uid, now + GUARD_TTL_MS).run();
  }
  return spawnN;
}

export async function handleStealNpc(request, env) {
  const session = await requireSession(request, env);
  if (!session) return json({ error: 'unauthorized' }, 401);
  const uid = session.user_id, now = Date.now();
  const body = await readJson(request);
  const npc = TOWN_NPCS_BY_ID[body?.npc_id];
  if (!npc) return json({ error: 'invalid_npc' }, 400);
  const P = profileOf(npc.id);
  const lvl = await thiefLevel(env, uid);
  if (lvl < P.level) return json({ error: 'low_level', message: `Necesitas nivel ${P.level} de Robo para robar a ${npc.name}.`, need: P.level }, 400);

  const pos = await env.DB.prepare('SELECT x, z FROM online_users WHERE user_id = ?').bind(uid).first();
  if (!pos || npcDist(npc, pos.x, pos.z) > STEAL_DIST_SERVER_M) return json({ error: 'too_far', message: 'Acércate más.' }, 400);
  const st = await env.DB.prepare('SELECT hp_current FROM combat_stats WHERE user_id = ?').bind(uid).first();
  if (!st || st.hp_current <= 0) return json({ error: 'dead' }, 400);
  const turn = await takeTurn(env, uid, now); if (turn) return turn;

  const chance = catchChance(lvl, P.level);
  if (Math.random() < chance) {
    const guards = await caught(env, uid, pos.x, pos.z, now);
    return json({ ok: true, caught: true, guards, chance, message: `¡${npc.name} te ha pillado! ${guards ? '¡Los guardias vienen a por ti, huye!' : ''}` });
  }
  const [item, qty] = rollLoot(P);
  const { stmts, fits } = await placeStmts(env, uid, [{ item_id: item, qty }], now);
  if (!fits) return json({ error: 'inventory_full', message: 'No te cabe nada más en la mochila.' }, 400);
  await env.DB.batch(stmts);
  await grantXp(env, uid, THIEF_SKILL, P.xp);
  const meta = await env.DB.prepare('SELECT name, icon FROM items WHERE id = ?').bind(item).first();
  return json({ ok: true, caught: false, item, qty, name: meta?.name || item, icon: meta?.icon, xp: P.xp, chance });
}

export async function handleStealPlayer(request, env) {
  const session = await requireSession(request, env);
  if (!session) return json({ error: 'unauthorized' }, 401);
  const uid = session.user_id, now = Date.now();
  const body = await readJson(request);
  const target = Number(body?.target_user_id);
  if (!Number.isInteger(target) || target === uid) return json({ error: 'bad_target' }, 400);
  const lvl = await thiefLevel(env, uid);
  if (lvl < PLAYER_STEAL_LEVEL) return json({ error: 'low_level', message: `Para robar a jugadores necesitas nivel ${PLAYER_STEAL_LEVEL} de Robo.`, need: PLAYER_STEAL_LEVEL }, 400);

  const rows = (await env.DB.prepare('SELECT user_id, username, x, z, last_seen FROM online_users WHERE user_id IN (?, ?)').bind(uid, target).all()).results || [];
  const P = Object.fromEntries(rows.map(r => [r.user_id, r]));
  if (!P[target] || now - P[target].last_seen > ONLINE_MS) return json({ error: 'offline', message: 'No está conectado.' }, 400);
  if (!P[uid] || Math.hypot(P[uid].x - P[target].x, P[uid].z - P[target].z) > STEAL_DIST_SERVER_M) return json({ error: 'too_far', message: 'Acércate más.' }, 400);
  const st = await env.DB.prepare('SELECT hp_current FROM combat_stats WHERE user_id = ?').bind(uid).first();
  if (!st || st.hp_current <= 0) return json({ error: 'dead' }, 400);
  const turn = await takeTurn(env, uid, now); if (turn) return turn;
  const myName = P[uid].username, theirName = P[target].username;

  const chance = playerCatchChance(lvl);
  if (Math.random() < chance) {
    const guards = await caught(env, uid, P[target].x, P[target].z, now);
    try { await pushRealtime(env, { t: 'theft', to: target, from: uid, name: myName, caught: 1 }); } catch {}
    return json({ ok: true, caught: true, guards, chance, message: `¡${theirName} te ha pillado con la mano en su mochila! ${guards ? '¡Huye de los guardias!' : ''}` });
  }

  // Un objeto al azar de SU mochila (lo equipado no está en user_inventory)
  const inv = (await env.DB.prepare(
    `SELECT inv.slot_index, inv.item_id, inv.quantity, i.stackable, i.name FROM user_inventory inv JOIN items i ON i.id = inv.item_id WHERE inv.user_id = ?`
  ).bind(target).all()).results || [];
  if (!inv.length) {
    await grantXp(env, uid, THIEF_SKILL, Math.floor(PLAYER_STEAL_XP / 4));
    return json({ ok: true, caught: false, empty: true, message: `La mochila de ${theirName} está vacía.` });
  }
  const s = inv[Math.floor(Math.random() * inv.length)];
  let qty = 1;
  if (s.stackable === 1) qty = s.item_id === 'coins' ? Math.max(1, Math.floor(s.quantity * (0.01 + Math.random() * 0.04))) : 1;
  qty = Math.min(qty, s.quantity);
  const give = await placeStmts(env, uid, [{ item_id: s.item_id, qty }], now);
  if (!give.fits) return json({ error: 'inventory_full', message: 'No te cabe en la mochila.' }, 400);
  const take = qty >= s.quantity
    ? env.DB.prepare('DELETE FROM user_inventory WHERE user_id = ? AND slot_index = ? AND item_id = ? AND quantity = ?').bind(target, s.slot_index, s.item_id, s.quantity)
    : env.DB.prepare('UPDATE user_inventory SET quantity = quantity - ?, updated_at = ? WHERE user_id = ? AND slot_index = ? AND item_id = ? AND quantity > ?').bind(qty, now, target, s.slot_index, s.item_id, qty);
  const r = await take.run();
  if (!r?.meta?.changes) return json({ error: 'try_again', message: 'Se ha movido. Prueba otra vez.' }, 409);
  try { await env.DB.batch(give.stmts); }
  catch {
    // devolvérselo a la víctima si no se pudo dar
    const back = await placeStmts(env, target, [{ item_id: s.item_id, qty }], now, { bankFallback: true });
    await env.DB.batch(back.stmts);
    return json({ error: 'try_again' }, 409);
  }
  await grantXp(env, uid, THIEF_SKILL, PLAYER_STEAL_XP);
  try { await pushRealtime(env, { t: 'theft', to: target, from: uid, inv: 1 }); } catch {}   // su mochila cambió (sin decirle quién)
  return json({ ok: true, caught: false, item: s.item_id, qty, name: s.name, xp: PLAYER_STEAL_XP, chance, victim: theirName });
}
