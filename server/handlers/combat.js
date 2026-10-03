/**
 * SebasPresent — Combat handlers (Slice 5a + 5b)
 * Endpoints: /api/combat/state, /attack, /attack_player, /respawn, /style
 *
 * La lógica vive en combat_engine.js. Handlers solo orquestan.
 *
 * Sesión 27 — handleCombatAttack acepta { x, z } en el body. Si vienen,
 * los pasa a attackNpc como opts.userPos para que el server valide rango
 * contra la pos actual del cliente (no la persistida). Elimina el bug
 * "fuera de alcance" cuando el player llega visualmente al NPC pero el
 * server todavía cree que está lejos.
 *
 * Sesión 27 Bloque 3 — handleCombatAttackPlayer: PVP. Mismo patrón,
 * target = otro player. Solo permitido en wilderness.
 */
import { json, makeDbAdapter } from '../lib/db.js';
import { requireSession } from '../lib/auth.js';
import {
  getCombatState, attackNpc, attackPlayer, respawnUser,
  VALID_STYLES,
} from '../combat_engine.js';
import { questEvent } from '../lib/quests.js';   // Sesión 50
import { pushRealtime } from '../lib/realtime.js';   // Sesión 50
import { BOSSES } from '../../client/src/shared/bosses.js';   // Sesión 50 — anuncios
export async function handleCombatState(request, env) {
  const session = await requireSession(request, env);
  if (!session) return json({ error: 'unauthorized' }, 401);
  const db = makeDbAdapter(env);
  try {
    const state = await getCombatState(db, session.user_id, {});
    return json(state);
  } catch (err) {
    console.error('[combat/state]', err);
    return json({ error: 'internal_error', message: err.message }, 500);
  }
}
export async function handleCombatAttack(request, env) {
  const session = await requireSession(request, env);
  if (!session) return json({ error: 'unauthorized' }, 401);
  let body;
  try { body = await request.json(); } catch { return json({ error: 'invalid_body' }, 400); }
  if (!body || typeof body !== 'object') return json({ error: 'invalid_body' }, 400);   // S51: 'null' daba 500
  const npcId = parseInt(body.npc_id, 10);
  if (!Number.isFinite(npcId) || npcId <= 0) {
    return json({ error: 'invalid_npc_id' }, 400);
  }

  // Sesión 27 — Posición del cliente en el momento del attack.
  // Si viene válida en el body, la pasamos al engine. Si no, el engine
  // hace fallback a online_users / users.last_x.
  const opts = {};
  const cx = Number(body.x);
  const cz = Number(body.z);
  if (Number.isFinite(cx) && Number.isFinite(cz)) {
    opts.userPos = { x: cx, z: cz };
  }
  // Sesión 41 — magia: si viene spell_id, el engine lo trata como casteo.
  if (body.spell_id && typeof body.spell_id === 'string') {
    opts.spellId = body.spell_id;
  }
  // Sesion 44 — special attack: el cliente manda use_special=true cuando la
  // barra esta "armada". El engine valida energia/arma (server-authoritative).
  if (body.use_special === true) {
    opts.useSpecial = true;
  }

  const db = makeDbAdapter(env);
  try {
    const result = await attackNpc(db, session.user_id, npcId, opts);
    // Sesión 50 — los demás ven tu golpe al NPC al instante
    if (!result?.error) {
      await pushRealtime(env, {
        t: 'npc', at: Date.now(), a: session.user_id, n: npcId, dmg: result.your_damage ?? result.damage ?? 0,
        hp: result.npc_hp, killed: !!result.npc_killed, wt: result.weapon_type || null,
        // Sesión 50 — para que los demás vean el proyectil
        fx: result.special?.dragon ? 'dragon' : (result.spell_cast ? result.spell_cast.spell_id : (result.arrow_consumed ? 'arrow' : null)),
        fxc: result.spell_cast?.color ?? null,
        frz: result.npc_frozen_ms || 0,                 // Sesión 51 — congelado
        sp: result.special ? result.special.fx : null,  // Sesión 51 — tipo de especial
      });
    }
    if (result?.npc_killed) await questEvent(env, session.user_id, 'kill', result.npc_def_id);   // Sesión 50
    // Sesión 50 — ¡pieza de dragón! Se anuncia a toda la isla.
    if (result?.npc_killed && BOSSES[result.npc_def_id]) {
      try {
        const drop = await env.DB.prepare(
          `SELECT g.item_id, i.name FROM ground_items g JOIN items i ON i.id = g.item_id
            WHERE g.dropped_by_user = ? AND g.dropped_at >= ? AND i.material = 'dragon' LIMIT 1`
        ).bind(session.user_id, Date.now() - 5000).first();
        const who = await env.DB.prepare('SELECT username FROM users WHERE id = ?').bind(session.user_id).first();
        await pushRealtime(env, { t: 'ann', k: drop ? 'drop' : 'boss', u: who?.username || '?', item: drop?.name || null, boss: BOSSES[result.npc_def_id].name });
      } catch {}
    }
    if (result.error) {
      const knownClient = new Set([
        'npc_not_found', 'npc_dead', 'on_cooldown',
        'out_of_range', 'user_no_position', 'user_dead',
        'no_spec_energy',
      ]);
      if (knownClient.has(result.error)) return json(result, 400);
    }
    return json(result);
  } catch (err) {
    console.error('[combat/attack]', err);
    return json({ error: 'internal_error', message: err.message }, 500);
  }
}

/**
 * Sesión 27 Bloque 3 — POST /api/combat/attack_player
 *
 * Body: { target_user_id, x, z }
 *   - target_user_id: id del player a atacar.
 *   - x, z: posición ACTUAL del attacker (mismo patrón anti-desfase que
 *     /attack para NPCs).
 *
 * Validaciones server-side (en attackPlayer):
 *   - Ambos en wilderness.
 *   - Rango melee (con tolerance + cap).
 *   - Cooldown attacker.
 *   - Target online y con HP > 0.
 *
 * El target auto-retaliata si tiene cooldown listo.
 */
export async function handleCombatAttackPlayer(request, env) {
  const session = await requireSession(request, env);
  if (!session) return json({ error: 'unauthorized' }, 401);
  let body;
  try { body = await request.json(); } catch { return json({ error: 'invalid_body' }, 400); }
  if (!body || typeof body !== 'object') return json({ error: 'invalid_body' }, 400);   // S51: 'null' daba 500
  const targetUserId = parseInt(body.target_user_id, 10);
  if (!Number.isFinite(targetUserId) || targetUserId <= 0) {
    return json({ error: 'invalid_target_user_id' }, 400);
  }
  if (targetUserId === session.user_id) {
    return json({ error: 'cannot_attack_self' }, 400);
  }

  const opts = {};
  const cx = Number(body.x);
  const cz = Number(body.z);
  if (Number.isFinite(cx) && Number.isFinite(cz)) {
    opts.userPos = { x: cx, z: cz };
  }
  // Sesión 27 Bloque 3 fix — Pos visual del TARGET (lo que el atacante
  // ve en pantalla). Server compara con la pos persistida y si la
  // discrepancia es plausible (<6m), confía en ella. Esto elimina el
  // "fuera de rango" cuando el target se mueve entre heartbeats.
  const tx = Number(body.target_x);
  const tz = Number(body.target_z);
  if (Number.isFinite(tx) && Number.isFinite(tz)) {
    opts.targetPos = { x: tx, z: tz };
  }
  // Sesión 47 — magia/especial PvP: el cliente ya mandaba spell_id y
  // use_special, pero este handler los ignoraba (solo el de NPC los parseaba).
  // attackPlayer SÍ los consume (isMagicPvp / useSpecial), así que sin esto la
  // magia PvP se trataba como melee y el especial PvP nunca se armaba.
  if (body.spell_id && typeof body.spell_id === 'string') {
    opts.spellId = body.spell_id;
  }
  if (body.use_special === true) {
    opts.useSpecial = true;
  }

  const db = makeDbAdapter(env);
  try {
    const result = await attackPlayer(db, session.user_id, targetUserId, opts);
    // Sesión 50 — el golpe llega al instante a todos (el objetivo ve daño,
    // reacción y su vida real sin esperar al siguiente snapshot).
    if (!result.error) {
      await pushRealtime(env, {
        t: 'hit', at: result.at, a: session.user_id, d: targetUserId,
        dmg: result.your_damage || 0, hit: !!result.your_hit, crit: !!result.is_crit,
        hp: result.target_hp, hpMax: result.target_hp_max, killed: !!result.target_killed,
        cd: result.target_damage || 0, chit: !!result.target_hit,
        ahp: result.your_hp, ahpMax: result.your_hp_max, adied: !!result.you_died,
        wt: result.weapon_type || null,
        spell: result.spell_cast ? { id: result.spell_cast.spell_id, color: result.spell_cast.color } : null,
        spec: result.special ? result.special.hits : null,
        dragon: !!result.special?.dragon,
        arrow: !!result.arrow_consumed,
        skulled: !!result.skulled,
        // Sesión 51 — congelación (especial o Enredadera) y curación del especial
        frz: result.special?.frz || ((result.spell_cast?.root_ms && result.your_hit) ? result.spell_cast.root_ms : 0),
        sp: result.special ? result.special.fx : null,
      });
    }
    if (result.error) {
      const knownClient = new Set([
        'cannot_attack_self', 'attacker_not_found', 'target_not_found',
        'target_dead', 'on_cooldown', 'out_of_range',
        'user_no_position', 'target_no_position', 'user_dead',
        'not_in_wilderness', 'not_in_wilderness_no_duel',
        'same_party',                              // Sesión 27 Bloque 3
        'unknown_spell', 'no_mana', 'magic_level_too_low', // Sesión 47 — magia PvP
      ]);
      if (knownClient.has(result.error)) return json(result, 400);
    }
    return json(result);
  } catch (err) {
    console.error('[combat/attack_player]', err);
    return json({ error: 'internal_error', message: err.message }, 500);
  }
}

export async function handleCombatRespawn(request, env) {
  const session = await requireSession(request, env);
  if (!session) return json({ error: 'unauthorized' }, 401);
  const db = makeDbAdapter(env);
  try {
    const result = await respawnUser(db, session.user_id, {});
    if (!result.ok) return json(result, 400);
    if (typeof result.hp_current === 'number') {
      await pushRealtime(env, { t: 'hp', id: session.user_id, hp: result.hp_current, hpMax: result.hp_max ?? result.hp_current });
    }
    return json(result);
  } catch (err) {
    console.error('[combat/respawn]', err);
    return json({ error: 'internal_error', message: err.message }, 500);
  }
}
/**
 * Slice 5b — POST /api/combat/style { style }
 * Cambia el combat style del user. Valida contra VALID_STYLES del engine.
 * Persiste en users.combat_style.
 */
export async function handleCombatStyle(request, env) {
  const session = await requireSession(request, env);
  if (!session) return json({ error: 'unauthorized' }, 401);
  let body;
  try { body = await request.json(); } catch { return json({ error: 'invalid_body' }, 400); }
  if (!body || typeof body !== 'object') return json({ error: 'invalid_body' }, 400);   // S51: 'null' daba 500
  const style = body && typeof body.style === 'string' ? body.style : null;
  if (!style || !VALID_STYLES.includes(style)) {
    return json({
      error: 'invalid_style',
      message: 'style debe ser uno de: ' + VALID_STYLES.join(', '),
    }, 400);
  }
  try {
    await env.DB.prepare('UPDATE users SET combat_style = ? WHERE id = ?')
      .bind(style, session.user_id).run();
    return json({ ok: true, combat_style: style });
  } catch (err) {
    console.error('[combat/style]', err);
    return json({ error: 'internal_error', message: err.message }, 500);
  }
}
