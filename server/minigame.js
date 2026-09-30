/**
 * SebasPresent — La Fosa de Fuego (servidor) · Sesión 50
 *
 * Minijuego de oleadas por jugador. Las criaturas son filas de npc_instances
 * con owner_user_id = jugador (solo las ve y ataca él). Su IA corre aquí, "al
 * leer" desde el snapshot del propio jugador (gate atómico en user_fosa).
 *
 * Endpoints (handlers/minigame.js): start (junto a Kargath) y leave.
 * Morir dentro NO hace perder objetos: vida llena y fuera de la Fosa.
 */
import { FOSA, FOSA_MOBS, FOSA_WAVES, FOSA_WAVE_DELAY_MS, FOSA_REWARDS, insideFosa } from '../client/src/shared/fosa.js';
import { playerDefProfile, monsterRoll, levelFromXp } from './combat_engine.js';

const TICK_MS = 350;
const INV_SLOTS = 28;

function dist(ax, az, bx, bz) { return Math.hypot(ax - bx, az - bz); }
function parse(s, d) { try { return s ? JSON.parse(s) : d; } catch { return d; } }

export async function getFosaRow(env, uid) {
  await env.DB.prepare('INSERT OR IGNORE INTO user_fosa (user_id) VALUES (?)').bind(uid).run();
  return env.DB.prepare('SELECT * FROM user_fosa WHERE user_id = ?').bind(uid).first();
}

export async function clearMobs(env, uid) {
  await env.DB.prepare('DELETE FROM npc_instances WHERE owner_user_id = ?').bind(uid).run();
}

/** Mueve al jugador (server) a (x,z). El cliente lo aplica al recibir la respuesta/snapshot. */
export async function setPlayerPos(env, uid, x, z, now) {
  await env.DB.prepare('UPDATE online_users SET x = ?, z = ?, last_seen = ? WHERE user_id = ?').bind(x, z, now, uid).run();
  try { await env.DB.prepare('UPDATE users SET last_x = ?, last_z = ? WHERE id = ?').bind(x, z, uid).run(); } catch {}
}

async function giveItem(env, uid, itemId, qty, now) {
  const stackable = itemId === 'coins';
  if (stackable) {
    const up = await env.DB.prepare(
      `UPDATE user_inventory SET quantity = quantity + ?, updated_at = ?
        WHERE user_id = ? AND item_id = ? AND slot_index = (SELECT slot_index FROM user_inventory WHERE user_id = ? AND item_id = ? LIMIT 1)`
    ).bind(qty, now, uid, itemId, uid, itemId).run();
    if (up?.meta?.changes) return 'inv';
  }
  const occ = await env.DB.prepare('SELECT slot_index FROM user_inventory WHERE user_id = ?').bind(uid).all();
  const taken = new Set((occ.results || []).map(r => r.slot_index));
  for (let i = 0; i < INV_SLOTS; i++) {
    if (taken.has(i)) continue;
    try {
      await env.DB.prepare('INSERT INTO user_inventory (user_id, slot_index, item_id, quantity, updated_at) VALUES (?, ?, ?, ?, ?)')
        .bind(uid, i, itemId, qty, now).run();
      return 'inv';
    } catch {}
  }
  // Mochila llena → al banco
  const bank = await env.DB.prepare('UPDATE user_bank SET quantity = quantity + ?, updated_at = ? WHERE user_id = ? AND item_id = ?')
    .bind(qty, now, uid, itemId).run();
  if (!bank?.meta?.changes) {
    await env.DB.prepare(
      `INSERT INTO user_bank (user_id, slot_index, item_id, quantity, updated_at)
       SELECT ?, COALESCE(MAX(slot_index), -1) + 1, ?, ?, ? FROM user_bank WHERE user_id = ?`
    ).bind(uid, itemId, qty, now, uid).run();
  }
  return 'bank';
}

async function spawnWave(env, uid, wave, now) {
  const list = FOSA_WAVES[wave - 1] || [];
  const n = list.length;
  for (let k = 0; k < n; k++) {
    const def = FOSA_MOBS[list[k]];
    const a = (k / n) * Math.PI * 2 + wave * 0.7;
    const r = list[k] === 'fosa_ignaroth' ? FOSA.r * 0.55 : FOSA.r * 0.8;
    const x = FOSA.x + Math.cos(a) * r, z = FOSA.z + Math.sin(a) * r;
    await env.DB.prepare(
      `INSERT INTO npc_instances (def_id, hp_current, x, z, status, spawn_x, spawn_z, owner_user_id, last_attack_at)
       VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?)`
    ).bind(list[k], def.hp, x, z, x, z, uid, now).run();
  }
}

/** Daño de la Fosa: si fuera mortal, sales con la vida llena y sin perder nada. */
async function fosaDamage(env, uid, dmg, now) {
  const st = await env.DB.prepare('SELECT hp_current, hp_xp FROM combat_stats WHERE user_id = ?').bind(uid).first();
  if (!st) return { died: false };
  if (st.hp_current - dmg > 0) {
    await env.DB.prepare(
      `UPDATE combat_stats SET hp_current = hp_current - ?, last_hit_from_user_id = NULL,
              last_hit_damage = ?, last_hit_at = ?, last_hit_is_crit = 0 WHERE user_id = ?`
    ).bind(dmg, dmg, now, uid).run();
    return { died: false };
  }
  const maxHp = levelFromXp(st.hp_xp || 0) || 10;
  await env.DB.prepare(
    `UPDATE combat_stats SET hp_current = ?, last_hit_damage = ?, last_hit_at = ? WHERE user_id = ?`
  ).bind(maxHp, dmg, now, uid).run();
  return { died: true };
}

/** Estado para el cliente (me.fosa). */
function view(row, now) {
  return {
    active: !!row.active, wave: row.wave || 0, waves: FOSA_WAVES.length,
    next_wave_at: row.next_wave_at || 0, best: row.best_wave || 0,
    tele: parse(row.tele, null), atk: parse(row.last_attacks, []),
    result: parse(row.result, null), now,
  };
}

/**
 * Tick de la Fosa para el jugador (desde el snapshot). Devuelve el estado o null
 * si nunca ha jugado.
 */
export async function tickFosa(env, uid, pos, now, rng = Math.random) {
  let row = await env.DB.prepare('SELECT * FROM user_fosa WHERE user_id = ?').bind(uid).first();
  if (!row) return null;
  if (!row.active) return view(row, now);
  const gate = await env.DB.prepare('UPDATE user_fosa SET last_tick = ? WHERE user_id = ? AND last_tick <= ?')
    .bind(now, uid, now - TICK_MS).run();
  if (!gate?.meta?.changes) return view(row, now);

  const dt = Math.min(0.6, Math.max(0, (now - (row.prev_tick || now - TICK_MS)) / 1000));
  let wave = row.wave || 0, nextWaveAt = row.next_wave_at || 0, rewarded = row.rewarded || 0, best = row.best_wave || 0;
  let tele = parse(row.tele, null);
  let atks = parse(row.last_attacks, []).filter(a => now - a.at < 4000);
  let result = null, active = 1;

  const end = async (k, extra = {}) => {
    active = 0;
    await clearMobs(env, uid);
    result = { k, wave, at: now, ...extra };
  };

  // Salirse de la arena = rendirse
  if (!pos || !insideFosa(pos.x, pos.z, 4)) {
    await end('left');
  } else {
    // Limpiar muertos y leer vivos
    await env.DB.prepare('DELETE FROM npc_instances WHERE owner_user_id = ? AND status = 1').bind(uid).run();
    const mobsRes = await env.DB.prepare(
      'SELECT id, def_id, x, z, hp_current, last_attack_at FROM npc_instances WHERE owner_user_id = ? AND status = 0'
    ).bind(uid).all();
    const mobs = mobsRes.results || [];

    if (!mobs.length) {
      if (!nextWaveAt) {
        // Ronda superada
        if (wave > 0) {
          best = Math.max(best, wave);
          const rw = FOSA_REWARDS[wave];
          if (rw && rewarded < wave) {
            rewarded = wave;
            if (rw.coins) await giveItem(env, uid, 'coins', rw.coins, now);
            if (rw.item) await giveItem(env, uid, rw.item, 1, now);
            result = { k: 'reward', wave, at: now, coins: rw.coins || 0, item: rw.item || null };
          }
        }
        if (wave >= FOSA_WAVES.length) {
          await end('won', { coins: FOSA_REWARDS[wave]?.coins || 0, item: FOSA_REWARDS[wave]?.item || null });
        } else {
          nextWaveAt = now + (wave === 0 ? 2500 : FOSA_WAVE_DELAY_MS);
        }
      } else if (now >= nextWaveAt) {
        wave++;
        nextWaveAt = 0;
        tele = null;
        await spawnWave(env, uid, wave, now);
      }
    } else {
      // IA de cada criatura
      const prof = await playerDefProfile(env, uid, now);
      for (const m of mobs) {
        const D = FOSA_MOBS[m.def_id];
        if (!D) continue;
        let x = m.x, z = m.z;
        const d = dist(x, z, pos.x, pos.z);
        const want = D.range * 0.85;
        if (d > want) {
          const step = Math.min(d - want, D.speed * dt);
          x += (pos.x - x) / d * step; z += (pos.z - z) / d * step;
        }
        const dNow = dist(x, z, pos.x, pos.z);
        let attackedAt = null;
        if (D.style === 'jad') {
          // Ignaroth: aviso (brillo verde/azul) y luego el golpe
          if (tele && tele.n === m.id && now >= tele.at) {
            const blocked = (tele.s === 'ranged' && prof?.fx.protectRanged) || (tele.s === 'magic' && prof?.fx.protectMagic);
            const roll = monsterRoll(rng, D.att, prof?.defLvl || 1, D.max, prof?.defMult || 1);
            const dmg = blocked ? 0 : Math.max(8, roll.damage);
            atks.push({ n: m.id, s: tele.s, at: now, d: dmg, blk: blocked ? 1 : 0 });
            const r = await fosaDamage(env, uid, dmg, now);
            tele = null;
            attackedAt = now;
            if (r.died) { await end('lost'); break; }
          } else if (!tele && (!m.last_attack_at || now - m.last_attack_at >= D.every) && dNow <= D.range) {
            tele = { n: m.id, s: rng() < 0.5 ? 'ranged' : 'magic', at: now + D.telegraphMs, t0: now };
          }
        } else if (dNow <= D.range && (!m.last_attack_at || now - m.last_attack_at >= D.every)) {
          const blocked = (D.style === 'melee' && prof?.fx.protectMelee)
            || (D.style === 'ranged' && prof?.fx.protectRanged)
            || (D.style === 'magic' && prof?.fx.protectMagic);
          const roll = monsterRoll(rng, D.att, prof?.defLvl || 1, D.max, prof?.defMult || 1);
          const dmg = blocked ? 0 : roll.damage;
          atks.push({ n: m.id, s: D.style, at: now, d: dmg, blk: blocked ? 1 : 0 });
          attackedAt = now;
          const r = await fosaDamage(env, uid, dmg, now);
          if (r.died) { await end('lost'); break; }
        }
        await env.DB.prepare(
          `UPDATE npc_instances SET x = ?, z = ?, in_combat_with = ?, last_moved_at = ?,
                  last_attack_at = COALESCE(?, last_attack_at) WHERE id = ? AND status = 0`
        ).bind(x, z, uid, now, attackedAt, m.id).run();
      }
    }
  }

  if (!active) {
    // Si has caído: fuera de la Fosa con la vida llena (sin perder nada)
    if (result.k === 'lost') {
      await setPlayerPos(env, uid, FOSA.entrance.x, FOSA.entrance.z, now);
      result.x = FOSA.entrance.x; result.z = FOSA.entrance.z;
    }
    best = Math.max(best, result.k === 'won' ? wave : wave - 1);
  }
  atks = atks.slice(-8);
  await env.DB.prepare(
    `UPDATE user_fosa SET active = ?, wave = ?, next_wave_at = ?, rewarded = ?, best_wave = ?, prev_tick = ?,
            tele = ?, last_attacks = ?, result = COALESCE(?, result)
      WHERE user_id = ?`
  ).bind(active, wave, nextWaveAt, rewarded, best, now,
    tele ? JSON.stringify(tele) : null, JSON.stringify(atks), result ? JSON.stringify(result) : null, uid).run();
  row = { ...row, active, wave, next_wave_at: nextWaveAt, best_wave: best, tele: tele ? JSON.stringify(tele) : null,
    last_attacks: JSON.stringify(atks), result: result ? JSON.stringify(result) : row.result };
  return view(row, now);
}
