/**
 * SebasPresent — Hechizos de utilidad (Sesión 50)
 *   POST /api/magic/utility { spell_id, slot? }
 *     teleport → te mueve al destino (serverWarp, el Realm lo acepta)
 *     alch     → el objeto del slot desaparece y recibes monedas (pct del precio base)
 * Requisitos: nivel de Magia y maná. No hace falta bastón.
 */
import { json, readJson } from '../lib/db.js';
import { requireSession } from '../lib/auth.js';
import { serverWarp } from '../lib/warp.js';
import { placeStmts, giveRobust } from '../lib/give.js';
import * as magic from '../magic.js';
import { levelFromXp } from '../combat_engine.js';
import { STAFF_MANA_EXTRA } from '../../client/src/shared/equip_reqs.js';
import { TABLETS, TELEPORT_WILD_LIMIT_X } from '../../client/src/shared/teleports.js';
import { inCaveZone } from '../../client/src/shared/caves.js';

const STAFF_MANA_BONUS = 100;

export async function handleMagicUtility(request, env) {
  const session = await requireSession(request, env);
  if (!session) return json({ error: 'unauthorized' }, 401);
  const uid = session.user_id, now = Date.now();
  const body = await readJson(request);
  const spell = magic.getSpell(body?.spell_id);
  if (!spell || (spell.kind !== 'teleport' && spell.kind !== 'alch')) return json({ error: 'invalid_spell' }, 400);

  const st = await env.DB.prepare('SELECT hp_current, magic_xp, mana_current, mana_updated_at, last_attack_at FROM combat_stats WHERE user_id = ?').bind(uid).first();
  if (!st || st.hp_current <= 0) return json({ error: 'dead', message: 'Estás muerto.' }, 400);
  const lvl = levelFromXp(st.magic_xp || 0);
  if (lvl < spell.magic_level_req) return json({ error: 'magic_level_too_low', message: `Necesitas nivel ${spell.magic_level_req} de Magia.` }, 400);

  const w = await env.DB.prepare(
    `SELECT ue.item_id, i.weapon_type FROM user_equipment ue JOIN items i ON i.id = ue.item_id WHERE ue.user_id = ? AND ue.slot_id = 'weapon'`
  ).bind(uid).first();
  const hasStaff = w?.weapon_type === 'staff';
  const maxMana = magic.computeMaxMana(lvl, hasStaff ? STAFF_MANA_BONUS + (STAFF_MANA_EXTRA[w.item_id] || 0) : 0);
  const mana = magic.regenMana(st.mana_current || 0, maxMana, st.mana_updated_at || 0, now, magic.manaRegenPerSec(hasStaff, 0));
  if (mana < spell.mana_cost) return json({ error: 'no_mana', message: 'No tienes maná suficiente.' }, 400);

  let extra = {};
  if (spell.kind === 'teleport') {
    const pos = await env.DB.prepare('SELECT x, z FROM online_users WHERE user_id = ?').bind(uid).first();
    if (pos && pos.x < TELEPORT_WILD_LIMIT_X) return json({ error: 'too_deep', message: 'La magia no funciona tan dentro del Malpaís. Sal un poco al este.' }, 400);
    if (pos && inCaveZone(pos.x, pos.z)) return json({ error: 'in_cave', message: 'Dentro de la cueva la magia no te saca. Sal por la entrada.' }, 400);
    if (st.last_attack_at && now - st.last_attack_at < 8000) return json({ error: 'in_combat', message: 'No puedes teletransportarte en pleno combate.' }, 400);
    const T = TABLETS[spell.dest];
    const x = T.x + (Math.random() - 0.5) * 3, z = T.z + (Math.random() - 0.5) * 3;
    await serverWarp(env, uid, x, z, now);
    extra = { x, z, dest: spell.dest, name: T.name };
  } else {
    const slot = Number(body?.slot);
    if (!Number.isInteger(slot) || slot < 0 || slot > 27) return json({ error: 'invalid_slot' }, 400);
    const row = await env.DB.prepare(
      `SELECT inv.item_id, inv.quantity, i.name, i.base_price, i.stackable FROM user_inventory inv JOIN items i ON i.id = inv.item_id WHERE inv.user_id = ? AND inv.slot_index = ?`
    ).bind(uid, slot).first();
    if (!row) return json({ error: 'empty_slot', message: 'Ahí no hay nada.' }, 400);
    if (row.item_id === 'coins') return json({ error: 'coins', message: 'No puedes convertir monedas en monedas.' }, 400);
    const coins = Math.floor((row.base_price || 0) * spell.pct);
    if (coins <= 0) return json({ error: 'worthless', message: `${row.name} no vale nada para la alquimia.` }, 400);
    const take = row.quantity > 1
      ? env.DB.prepare('UPDATE user_inventory SET quantity = quantity - 1, updated_at = ? WHERE user_id = ? AND slot_index = ? AND item_id = ? AND quantity > 1').bind(now, uid, slot, row.item_id)
      : env.DB.prepare('DELETE FROM user_inventory WHERE user_id = ? AND slot_index = ? AND item_id = ? AND quantity = 1').bind(uid, slot, row.item_id);
    const r = await take.run();
    if (!r?.meta?.changes) return json({ error: 'try_again' }, 409);
    await giveRobust(env, uid, [{ item_id: 'coins', qty: coins }], now);   // Sesión 51 — nunca se pierde
    extra = { item: row.item_id, item_name: row.name, coins };
  }

  await env.DB.prepare('UPDATE combat_stats SET mana_current = ?, mana_updated_at = ?, magic_xp = magic_xp + ? WHERE user_id = ?')
    .bind(mana - spell.mana_cost, now, spell.xp, uid).run();
  try { await env.DB.prepare('UPDATE user_skills SET xp = xp + ? WHERE user_id = ? AND skill_id = ?').bind(spell.xp, uid, 'magic').run(); } catch {}
  return json({ ok: true, spell_id: spell.id, kind: spell.kind, name: spell.name, mana: mana - spell.mana_cost, mana_max: maxMana, xp: spell.xp, ...extra });
}
