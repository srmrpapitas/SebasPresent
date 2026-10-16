/**
 * SebasPresent — Cerebro de los JEFES (Sesión 50)
 *
 * Igual que la IA de los monstruos agresivos, corre "al leer": cada snapshot
 * de un jugador cerca de una guarida llama a tickBossesNear(). Un gate
 * atómico en boss_state.last_tick hace que solo UNA petición procese cada
 * jefe cada BOSS_TICK_MS (no importa cuántos jugadores haya mirando).
 *
 * Por tick:
 *   1. Jugadores vivos dentro de la guarida → objetivo (el que ya tenía o el
 *      más cercano). Sin nadie un rato → vuelve al centro y se cura.
 *   2. Movimiento hacia el objetivo si no llega; las ROCAS lo bloquean
 *      (así se le puede "trabar" = safespot).
 *   3. Ataque normal según distancia (melé / proyectiles / magia). Las
 *      protecciones de plegaria anulan el golpe del estilo correspondiente.
 *   4. Especiales por turnos: peligros en el suelo con aviso (el cliente los
 *      dibuja), teletransporte, drenar plegaria, cambio de estilo.
 *   5. Los peligros que "caen" dañan a quien esté dentro.
 *
 * El estado vive en boss_state (migración 006). La respuesta del snapshot
 * incluye `bosses: [...]` con lo necesario para dibujar avisos y ataques.
 */
import {
  BOSSES, BOSS_TICK_MS, BOSS_MOVE_SPEED, BOSS_EMPTY_RESET_MS, hitsRock,
} from '../client/src/shared/bosses.js';
import { playerDefProfile, monsterRoll, damagePlayerFromMonster, levelFromXp } from './combat_engine.js';
import { currentPrayerState } from '../client/src/shared/prayer.js';   // Sesión 51

const VIEW_R = 140;   // el snapshot incluye jefes a esta distancia

function dist(ax, az, bx, bz) { return Math.hypot(ax - bx, az - bz); }
function parse(s, d) { try { return s ? JSON.parse(s) : d; } catch { return d; } }

// ------------------------------------------------------------
// Sesión 52 — FASES (Guayota). B.phases = [{ below: 0.66, name, specials,
// specialEvery, attackMult, summon: { def, count } }, …] ordenadas de mayor
// a menor `below`. La fase actual se guarda en boss_state.phase (mig. 023).
// ------------------------------------------------------------
function phaseIndexFor(B, hp, maxHp) {
  if (!B.phases?.length || !maxHp) return 0;
  const f = hp / maxHp;
  let idx = 0;
  B.phases.forEach((ph, i) => { if (f <= ph.below) idx = i + 1; });
  return idx;
}
function phaseDef(B, idx) { return idx > 0 ? B.phases[idx - 1] : null; }

/** Despierta `count` esbirros dormidos (status = 1, sin reaparición) junto al jefe. */
async function wakeMinions(env, defId, count, bx, bz, targetId, rng) {
  const rows = (await env.DB.prepare('SELECT id FROM npc_instances WHERE def_id = ? AND status = 1 LIMIT ?').bind(defId, count).all()).results || [];
  for (const r of rows) {
    const a = rng() * Math.PI * 2, d = 4 + rng() * 4;
    const x = +(bx + Math.cos(a) * d).toFixed(2), z = +(bz + Math.sin(a) * d).toFixed(2);
    await env.DB.prepare(
      `UPDATE npc_instances SET status = 0, hp_current = (SELECT max_hp FROM npc_defs WHERE id = npc_instances.def_id),
              x = ?, z = ?, spawn_x = ?, spawn_z = ?, died_at = NULL, in_combat_with = ?, last_attack_at = NULL
        WHERE id = ? AND status = 1`
    ).bind(x, z, x, z, targetId || null, r.id).run();
  }
  return rows.length;
}
/** Vuelve a dormir a los esbirros (al morir o reiniciarse el jefe). */
async function sleepMinions(env, B, now) {
  for (const ph of B.phases || []) {
    if (!ph.summon) continue;
    await env.DB.prepare('UPDATE npc_instances SET status = 1, died_at = ?, in_combat_with = NULL WHERE def_id = ? AND status = 0')
      .bind(now, ph.summon.def).run();
  }
}

/** Jefes cuya guarida está cerca de (x,z). */
function bossesNear(x, z, r) {
  const out = [];
  for (const [id, b] of Object.entries(BOSSES)) if (dist(x, z, b.x, b.z) <= r) out.push(id);
  return out;
}

/**
 * Tick + estado para el snapshot. Devuelve [{ id, npc_id, style, hz, atk, spec }]
 * para los jefes cerca del jugador.
 */
export async function tickBossesNear(env, viewer, now, rng = Math.random) {
  if (!viewer || !Number.isFinite(viewer.x)) return [];
  const ids = bossesNear(viewer.x, viewer.z, VIEW_R);
  if (!ids.length) return [];
  const out = [];
  for (const id of ids) {
    try {
      const st = await tickBoss(env, id, now, rng);
      if (st) out.push(st);
    } catch (err) {
      console.warn('[boss]', id, err?.message);
    }
  }
  return out;
}

async function tickBoss(env, bossId, now, rng) {
  const B = BOSSES[bossId];
  await env.DB.prepare('INSERT OR IGNORE INTO boss_state (boss_id, last_tick, hazards) VALUES (?, 0, \'[]\')').bind(bossId).run();
  // Gate: solo una petición procesa el jefe por tick
  const gate = await env.DB.prepare(
    'UPDATE boss_state SET last_tick = ? WHERE boss_id = ? AND last_tick <= ?'
  ).bind(now, bossId, now - BOSS_TICK_MS).run();
  const state = await env.DB.prepare('SELECT * FROM boss_state WHERE boss_id = ?').bind(bossId).first();
  const npc = await env.DB.prepare(
    `SELECT i.id, i.x, i.z, i.hp_current, i.status, i.in_combat_with, i.last_attack_at, i.spawn_x, i.spawn_z,
            d.max_hp
       FROM npc_instances i JOIN npc_defs d ON d.id = i.def_id
      WHERE i.def_id = ? ORDER BY i.status ASC, i.id ASC LIMIT 1`
  ).bind(bossId).first();
  if (!npc) return null;
  const view = () => ({
    id: bossId, npc_id: npc.id, alive: npc.status === 0,
    style: state?.style || null,
    phase: state?.phase || 0,   // Sesión 52
    hz: parse(state?.hazards, []).filter(h => (h.until || h.at) > now - 600),
    atk: parse(state?.last_attack, null),
    spec: state?.last_special ? parse(state.last_special, null) : null,
  });
  if (!gate?.meta?.changes || !state) return view();

  const lastTick = state.prev_tick || (now - BOSS_TICK_MS);
  const dt = Math.min(0.6, Math.max(0, (now - lastTick) / 1000));
  let hazards = parse(state.hazards, []);
  let style = state.style || (B.styleSwitch ? 'ranged' : null);
  let nextAttack = state.next_attack_at || 0;
  let nextSpecial = state.next_special_at || (now + B.specialEvery);
  let specialIdx = state.special_idx || 0;
  let emptySince = state.empty_since || 0;
  let lastAttack = parse(state.last_attack, null);
  let lastSpecial = parse(state.last_special, null);

  // Muerto → limpiar peligros
  if (npc.status !== 0) {
    await env.DB.prepare(
      "UPDATE boss_state SET prev_tick = ?, hazards = '[]', next_special_at = 0, empty_since = 0, phase = 0 WHERE boss_id = ?"
    ).bind(now, bossId).run();
    if (B.phases && state.phase) { try { await sleepMinions(env, B, now); } catch {} }   // Sesión 52
    state.hazards = '[]'; state.phase = 0;
    return view();
  }

  // 1) Jugadores en la guarida (vivos y conectados)
  const res = await env.DB.prepare(
    `SELECT o.user_id, o.x, o.z FROM online_users o JOIN combat_stats c ON c.user_id = o.user_id
      WHERE o.last_seen > ? AND c.hp_current > 0
        AND o.x BETWEEN ? AND ? AND o.z BETWEEN ? AND ?`
  ).bind(now - 12000, B.x - B.lairR, B.x + B.lairR, B.z - B.lairR, B.z + B.lairR).all();
  const players = (res.results || []).filter(p => dist(p.x, p.z, B.x, B.z) <= B.lairR);

  let bx = npc.x, bz = npc.z;
  let target = players.find(p => p.user_id === npc.in_combat_with) || null;
  if (!target && players.length) {
    target = players.reduce((a, p) => (dist(p.x, p.z, bx, bz) < dist(a.x, a.z, bx, bz) ? p : a), players[0]);
  }

  let hp = npc.hp_current;
  if (!target) {
    // Nadie: vuelve al centro y, pasado un rato, se cura del todo
    if (!emptySince) emptySince = now;
    const dh = dist(bx, bz, B.x, B.z);
    if (dh > 0.5) {
      const step = Math.min(dh, BOSS_MOVE_SPEED * dt);
      bx += (B.x - bx) / dh * step; bz += (B.z - bz) / dh * step;
    }
    if (now - emptySince > BOSS_EMPTY_RESET_MS && hp < npc.max_hp) hp = npc.max_hp;
    // Sesión 52 — jefe con fases: al curarse vuelve a la fase 1 y sus esbirros se duermen
    if (B.phases && state.phase && hp >= npc.max_hp) {
      try { await sleepMinions(env, B, now); } catch {}
      await env.DB.prepare('UPDATE boss_state SET phase = 0 WHERE boss_id = ?').bind(bossId).run();
      state.phase = 0;
    }
    hazards = hazards.filter(h => (h.until || h.at) > now);
    await env.DB.prepare('UPDATE npc_instances SET x = ?, z = ?, hp_current = ?, in_combat_with = NULL, last_moved_at = ? WHERE id = ? AND status = 0')
      .bind(bx, bz, hp, now, npc.id).run();
    await env.DB.prepare(
      'UPDATE boss_state SET prev_tick = ?, hazards = ?, empty_since = ?, next_special_at = ?, style = ? WHERE boss_id = ?'
    ).bind(now, JSON.stringify(hazards), emptySince, now + B.specialEvery, style, bossId).run();
    npc.x = bx; npc.z = bz;
    state.hazards = JSON.stringify(hazards);
    return view();
  }
  emptySince = 0;

  // Sesión 52 — cambio de fase según la vida
  let phase = state.phase || 0;
  const wantPhase = phaseIndexFor(B, hp, npc.max_hp);
  if (wantPhase > phase) {
    phase = wantPhase;
    const P = phaseDef(B, phase);
    lastSpecial = { k: 'phase', n: P.name, at: now, ph: phase };
    nextSpecial = now + 2500;          // un respiro para leer el aviso
    if (P.summon) { try { await wakeMinions(env, P.summon.def, P.summon.count, bx, bz, target.user_id, rng); } catch (e) { console.warn('[boss] summon', e?.message); } }
  }
  const PH = phaseDef(B, phase);
  const atkMult = PH?.attackMult || 1;
  const specials = PH?.specials || B.specials;
  const specialEvery = PH?.specialEvery || B.specialEvery;

  // 2) Movimiento (bloqueado por rocas)
  const dT = dist(bx, bz, target.x, target.z);
  const melee = B.attacks.find(a => a.style === 'melee');
  const wantRange = melee ? melee.range * 0.85 : Math.min(...B.attacks.map(a => a.range)) * 0.8;
  if (!B.stationary && dT > wantRange) {
    const step = Math.min(dT - wantRange, BOSS_MOVE_SPEED * dt);
    const nx = bx + (target.x - bx) / dT * step, nz = bz + (target.z - bz) / dT * step;
    const inLair = dist(nx, nz, B.x, B.z) <= B.lairR - 1;
    if (inLair && !hitsRock(B, nx, nz, B.bodyR)) { bx = nx; bz = nz; }
    else {
      // Intento de rodear un poco (solo 30°): si tampoco puede, se queda TRABADO
      for (const ang of [0.5, -0.5]) {
        const ux = (target.x - bx) / dT, uz = (target.z - bz) / dT;
        const rx = ux * Math.cos(ang) - uz * Math.sin(ang), rz = ux * Math.sin(ang) + uz * Math.cos(ang);
        const tx = bx + rx * step, tz = bz + rz * step;
        if (dist(tx, tz, B.x, B.z) <= B.lairR - 1 && !hitsRock(B, tx, tz, B.bodyR)) { bx = tx; bz = tz; break; }
      }
    }
  }
  const dNow = dist(bx, bz, target.x, target.z);

  // 3) Ataque normal
  const stuckLine = (a) => a.style === 'melee' && dNow > a.range;
  if (now >= nextAttack) {
    // Elegir: melé si llega; si no, el primer ataque a distancia que alcance.
    let atk = null;
    if (melee && dNow <= melee.range) atk = melee;
    else {
      const ranged = B.attacks.filter(a => a.style !== 'melee' && dNow <= a.range);
      if (B.styleSwitch) atk = ranged.find(a => a.style === style) || null;
      else if (ranged.length) atk = ranged[Math.floor(rng() * ranged.length)];
    }
    if (atk && !stuckLine(atk)) {
      const prof = await playerDefProfile(env, target.user_id, now);
      if (prof && prof.stats.hp_current > 0) {
        const blocked = (atk.style === 'melee' && prof.fx.protectMelee)
          || (atk.style === 'ranged' && prof.fx.protectRanged)
          || (atk.style === 'magic' && prof.fx.protectMagic);
        const roll = monsterRoll(rng, B.stats.att, prof.defLvl, atk.max, prof.defMult);
        const dmg = blocked ? 0 : roll.damage;
        const hit = await damagePlayerFromMonster(env, target.user_id, dmg, now + (atk.style === 'melee' ? 0 : 450), npc.id, target, rng);
        lastAttack = { s: atk.style, b: !!atk.breath, t: target.user_id, at: now, d: hit.dmg ?? dmg, blk: blocked ? 1 : 0, c: style };
      }
      nextAttack = now + Math.round(atk.every * atkMult);
    }
  }

  // 4) Especiales por turnos
  if (now >= nextSpecial && specials?.length) {
    const sp = specials[specialIdx % specials.length];
    specialIdx++;
    nextSpecial = now + specialEvery;
    lastSpecial = { k: sp.kind, n: sp.name, at: now };
    if (sp.kind === 'aoe_target' || sp.kind === 'pool') {
      const tgts = players.length ? players : [target];
      for (const p of tgts) {
        for (let k = 0; k < (sp.count || 1); k++) {
          const off = k === 0 ? 0 : sp.spread || 0;
          const a = rng() * Math.PI * 2;
          hazards.push({
            k: sp.kind === 'pool' ? 'pool' : 'aoe',
            x: +(p.x + Math.cos(a) * off * (0.5 + rng() * 0.5)).toFixed(2),
            z: +(p.z + Math.sin(a) * off * (0.5 + rng() * 0.5)).toFixed(2),
            r: sp.r, t0: now, at: now + sp.delay, dmg: sp.dmg,
            until: sp.kind === 'pool' ? now + sp.delay + sp.duration : 0,
          });
        }
      }
    } else if (sp.kind === 'aoe_self') {
      hazards.push({ k: 'ring', x: +bx.toFixed(2), z: +bz.toFixed(2), r: sp.r, t0: now, at: now + sp.delay, dmg: sp.dmg, until: 0 });
    } else if (sp.kind === 'teleport') {
      for (let tries = 0; tries < 8; tries++) {
        const a = rng() * Math.PI * 2, rr = (0.3 + rng() * 0.55) * B.lairR;
        const tx = B.x + Math.cos(a) * rr, tz = B.z + Math.sin(a) * rr;
        if (!hitsRock(B, tx, tz, B.bodyR)) { bx = tx; bz = tz; break; }
      }
    } else if (sp.kind === 'drain') {
      // Sesión 51 — mitad de los puntos ACTUALES (con el gasto aplicado y
      // reiniciando el reloj). Antes partía los guardados sin descontar el
      // gasto y NULL (nunca usada = llena) se quedaba en 0.
      for (const p of players) {
        try {
          const row = await env.DB.prepare(
            `SELECT c.prayer_points, c.prayer_updated_at, c.active_prayers,
                    (SELECT xp FROM user_skills WHERE user_id = c.user_id AND skill_id = 'prayer') AS pxp
               FROM combat_stats c WHERE c.user_id = ?`
          ).bind(p.user_id).first();
          if (!row) continue;
          const lvl = levelFromXp(row.pxp || 0);
          const base = row.prayer_points == null ? lvl : Math.min(lvl, row.prayer_points);
          const cur = currentPrayerState(base, row.prayer_updated_at, row.active_prayers, now);
          const half = cur.points * 0.5;
          await env.DB.prepare('UPDATE combat_stats SET prayer_points = ?, prayer_updated_at = ?, active_prayers = ? WHERE user_id = ?')
            .bind(half, now, half > 0 ? cur.active.join(',') : '', p.user_id).run();
        } catch (err) { console.warn('[boss] drain:', err?.message); }
      }
    } else if (sp.kind === 'eclipse') {
      // Sesión 52 — ECLIPSE: se apaga el sol y solo quedan unos círculos de luz
      // de Magec. Al caer, quien NO esté dentro de uno recibe el golpe.
      const g = now;
      for (let k = 0; k < (sp.count || 2); k++) {
        for (let tries = 0; tries < 10; tries++) {
          const a = rng() * Math.PI * 2, rr = (0.25 + rng() * 0.55) * B.lairR;
          const tx = B.x + Math.cos(a) * rr, tz = B.z + Math.sin(a) * rr;
          if (hitsRock(B, tx, tz, sp.r)) continue;
          hazards.push({ k: 'safe', g, x: +tx.toFixed(2), z: +tz.toFixed(2), r: sp.r, t0: now, at: now + sp.delay, dmg: sp.dmg, until: 0 });
          break;
        }
      }
    } else if (sp.kind === 'switch') {
      style = style === 'magic' ? 'ranged' : 'magic';
      lastSpecial.c = style;
    }
  }

  // 5) Peligros que caen / charcos activos
  // Sesión 52 — eclipse: por grupo, daña a quien no esté en ningún círculo de luz
  const safeGroups = new Map();
  for (const h of hazards) if (h.k === 'safe' && !h.done && h.at <= now) {
    if (!safeGroups.has(h.g)) safeGroups.set(h.g, []);
    safeGroups.get(h.g).push(h);
  }
  for (const [, circles] of safeGroups) {
    for (const p of players) {
      const safe = circles.some(c => dist(p.x, p.z, c.x, c.z) <= c.r);
      if (!safe) {
        const dmg = Math.max(1, Math.round(circles[0].dmg * (0.85 + rng() * 0.3)));
        await damagePlayerFromMonster(env, p.user_id, dmg, now, npc.id, p, rng);
      }
    }
    for (const c of circles) c.done = 1;
  }
  const keep = [];
  for (const h of hazards) {
    if (h.k === 'safe') { if (!h.done || h.at > now - 800) keep.push(h); continue; }
    if (h.until && h.until < now) continue;               // charco terminado
    if (!h.until && h.done) { if (h.at > now - 800) keep.push(h); continue; }
    if (h.at <= now) {
      if (h.k === 'pool') {
        // Daño cada segundo a quien esté dentro
        h.last = h.last || {};
        for (const p of players) {
          if (dist(p.x, p.z, h.x, h.z) <= h.r && (!h.last[p.user_id] || now - h.last[p.user_id] >= 1000)) {
            h.last[p.user_id] = now;
            await damagePlayerFromMonster(env, p.user_id, h.dmg, now, npc.id, p, rng);
          }
        }
      } else {
        const cx = h.k === 'ring' ? bx : h.x, cz = h.k === 'ring' ? bz : h.z;
        for (const p of players) {
          if (dist(p.x, p.z, cx, cz) <= h.r) {
            const dmg = Math.max(1, Math.round(h.dmg * (0.75 + rng() * 0.5)));
            await damagePlayerFromMonster(env, p.user_id, dmg, now, npc.id, p, rng);
          }
        }
        h.done = 1;
      }
    }
    keep.push(h);
  }
  hazards = keep.slice(-24);

  await env.DB.prepare(
    `UPDATE npc_instances SET x = ?, z = ?, in_combat_with = ?, last_moved_at = ?,
            last_attack_at = COALESCE(?, last_attack_at)
      WHERE id = ? AND status = 0`
  ).bind(bx, bz, target.user_id, now, lastAttack?.at === now ? now : null, npc.id).run();
  await env.DB.prepare(
    `UPDATE boss_state SET prev_tick = ?, hazards = ?, style = ?, next_attack_at = ?, next_special_at = ?,
            special_idx = ?, empty_since = 0, last_attack = ?, last_special = ?${B.phases ? ', phase = ?' : ''}
      WHERE boss_id = ?`
  ).bind(now, JSON.stringify(hazards), style, nextAttack, nextSpecial, specialIdx,
    lastAttack ? JSON.stringify(lastAttack) : null, lastSpecial ? JSON.stringify(lastSpecial) : null,
    ...(B.phases ? [phase] : []), bossId).run();
  if (B.phases) state.phase = phase;

  npc.x = bx; npc.z = bz;
  Object.assign(state, {
    hazards: JSON.stringify(hazards), style,
    last_attack: lastAttack ? JSON.stringify(lastAttack) : null,
    last_special: lastSpecial ? JSON.stringify(lastSpecial) : null,
  });
  return view();
}
