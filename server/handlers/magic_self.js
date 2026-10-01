/**
 * SebasPresent — Hechizos sobre uno mismo (Sesión 50)
 *   POST /api/magic/self { spell_id }  → Sanación de Chaxiraxi / Escudo de lava
 * Requisitos: bastón equipado, nivel de Magia, maná y que no esté en cooldown.
 * El escudo se guarda en combat_stats.boosts.escudo = { v, until } y el motor
 * de combate lo resta de todo el daño que recibes (monstruos, jefes y PvP).
 */
import { json, readJson } from '../lib/db.js';
import { requireSession } from '../lib/auth.js';
import * as magic from '../magic.js';
import { levelFromXp } from '../combat_engine.js';
import { STAFF_MANA_EXTRA } from '../../client/src/shared/equip_reqs.js';

const STAFF_MANA_BONUS = 100;   // igual que en combat_engine.js

export async function handleMagicSelf(request, env) {
  const session = await requireSession(request, env);
  if (!session) return json({ error: 'unauthorized' }, 401);
  const uid = session.user_id, now = Date.now();
  const body = await readJson(request);
  const spell = magic.getSpell(body?.spell_id);
  if (!spell || spell.kind !== 'self') return json({ error: 'invalid_spell' }, 400);

  const w = await env.DB.prepare(
    `SELECT ue.item_id, i.weapon_type FROM user_equipment ue JOIN items i ON i.id = ue.item_id WHERE ue.user_id = ? AND ue.slot_id = 'weapon'`
  ).bind(uid).first();
  if (w?.weapon_type !== 'staff') return json({ error: 'no_staff', message: 'Necesitas un bastón equipado para lanzar hechizos.' }, 400);

  const st = await env.DB.prepare('SELECT hp_current, hp_xp, magic_xp, mana_current, mana_updated_at, boosts FROM combat_stats WHERE user_id = ?').bind(uid).first();
  if (!st || st.hp_current <= 0) return json({ error: 'dead' }, 400);
  const lvl = levelFromXp(st.magic_xp || 0);
  if (lvl < spell.magic_level_req) return json({ error: 'magic_level_too_low', required: spell.magic_level_req, message: `Necesitas nivel ${spell.magic_level_req} de Magia.` }, 400);

  let boosts = {};
  try { boosts = st.boosts ? JSON.parse(st.boosts) : {}; } catch {}
  const cdKey = 'cd_' + spell.id;
  if (boosts[cdKey]?.until > now) return json({ error: 'cooldown', until: boosts[cdKey].until, message: `${spell.name} aún se está recargando.` }, 400);

  const maxMana = magic.computeMaxMana(lvl, STAFF_MANA_BONUS + (STAFF_MANA_EXTRA[w.item_id] || 0));
  const mana = magic.regenMana(st.mana_current || 0, maxMana, st.mana_updated_at || 0, now, magic.manaRegenPerSec(true, 0));
  if (mana < spell.mana_cost) return json({ error: 'no_mana', mana_current: mana, mana_max: maxMana, message: 'No tienes maná suficiente.' }, 400);

  const maxHp = levelFromXp(st.hp_xp || 0);
  let hp = st.hp_current, healed = 0;
  if (spell.heal_base) {
    hp = Math.min(maxHp, hp + spell.heal_base + Math.floor(lvl * (spell.heal_per_lvl || 0)));
    healed = hp - st.hp_current;
  }
  if (spell.shield) boosts.escudo = { v: spell.shield, until: now + spell.shield_ms };
  boosts[cdKey] = { v: 1, until: now + (spell.cooldown_ms || 0) };
  // limpiar entradas caducadas para que el JSON no crezca
  for (const k of Object.keys(boosts)) if (boosts[k]?.until && boosts[k].until < now - 60_000) delete boosts[k];
  const xp = spell.mana_cost * 2;

  const r = await env.DB.prepare(
    `UPDATE combat_stats SET hp_current = ?, mana_current = ?, mana_updated_at = ?, boosts = ?, magic_xp = magic_xp + ?
      WHERE user_id = ? AND hp_current > 0`
  ).bind(hp, mana - spell.mana_cost, now, JSON.stringify(boosts), xp, uid).run();
  if (!r?.meta?.changes) return json({ error: 'try_again' }, 409);
  try { await env.DB.prepare('UPDATE user_skills SET xp = xp + ? WHERE user_id = ? AND skill_id = ?').bind(xp, uid, 'magic').run(); } catch {}

  return json({
    ok: true, spell_id: spell.id, name: spell.name, hp, hp_max: maxHp, healed,
    mana: mana - spell.mana_cost, mana_max: maxMana,
    shield_until: spell.shield ? boosts.escudo.until : 0, cooldown_until: boosts[cdKey].until, xp,
  });
}
