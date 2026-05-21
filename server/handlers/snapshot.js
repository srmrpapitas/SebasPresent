/**
 * SebasPresent — World Snapshot handler (Sesión 27, Bloques 1 + 2 PVP + Sesión 28 duelos)
 * Endpoint: GET /api/world/snapshot?x=&z=
 *
 * Bloque 1: endpoint server-authoritative que devuelve players+NPCs+timestamp.
 * Bloque 2: ampliado para ser drop-in replacement de /api/combat/state respecto
 *           a NPCs. npc_renderer.js cliente ahora lee de aquí (250ms) en
 *           lugar de polear combat/state (5s).
 * Sesión 28: añadido me.duel, me.duel_invites_in, me.duel_invite_out para que
 *           el cliente sepa estado del duelo activo y notifications sin un
 *           polling extra. Cleanup lazy de duelos cuyo leave_cast_ends_at
 *           ya expiró (cierra el duelo).
 *
 * Diseño:
 *   - Radio 500m (necesario para el minimap del cliente, que dibuja NPCs
 *     hasta 500m). El cliente filtra a 100m para crear meshes, pero recibe
 *     hasta 500m para pintar en el minimap.
 *   - Players: join online_users (pos/yaw/state, heartbeat 500ms) con
 *     combat_stats (hp_current, hp_max derivado de hp_xp, last_attack_at).
 *   - NPCs: formato idéntico al de combat_engine.getCombatState — incluye
 *     name, max_hp, attack_lvl, strength_lvl, defence_lvl, max_hit,
 *     attack_range, model. Así npc_renderer y combat.js son intercambiables
 *     sobre la fuente de datos.
 *   - in_combat (player y npc) se computa como
 *     now - last_attack_at < IN_COMBAT_WINDOW_MS.
 *
 * Cuesta poco al worker:
 *   - 2 queries D1 (1 players + 1 npcs) con bounding-box prefilter.
 *   - + 3 queries pequeñas para me (last_attacker, party_id, duel).
 *   - Polling 250ms desde N clientes = N*4 queries/sec/cliente. Sostenible.
 */

import { json } from '../lib/db.js';
import { requireSession } from '../lib/auth.js';

// Radio de visibilidad. 500m cubre el NPC_MINIMAP_RADIUS del cliente.
// Para 90 NPCs en un mundo de 4096m, 500m típicamente devuelve 30-50 NPCs.
const SNAPSHOT_RADIUS_M       = 500;
// Timeout para considerar a un player "online" según online_users.last_seen.
const SNAPSHOT_PEER_TIMEOUT_MS = 10_000;
// Si last_attack_at fue hace menos de esto, el actor está in_combat.
// Coincide con HP_REGEN_COMBAT_LOCKOUT_MS del combat_engine (8s).
const IN_COMBAT_WINDOW_MS     = 8_000;

// XP → level table (replica de skills_engine para no importar circular)
// Solo necesitamos hp_xp → hp_max para players. Función chiquita inline.
function levelFromXp(xp) {
  if (xp <= 0) return 1;
  let points = 0;
  for (let lvl = 1; lvl < 99; lvl++) {
    points += Math.floor(lvl + 300 * Math.pow(2, lvl / 7));
    const required = Math.floor(points / 4);
    if (xp < required) return lvl;
  }
  return 99;
}

export async function handleWorldSnapshot(request, env) {
  const session = await requireSession(request, env);
  if (!session) return json({ error: 'unauthorized' }, 401);

  const url = new URL(request.url);
  const qx = Number(url.searchParams.get('x'));
  const qz = Number(url.searchParams.get('z'));
  const hasPos = Number.isFinite(qx) && Number.isFinite(qz);

  const now = Date.now();
  const peerCutoff = now - SNAPSHOT_PEER_TIMEOUT_MS;

  try {
    // Determinar centro del snapshot (donde está el que pregunta).
    // Si el cliente no pasa x,z, usamos su último heartbeat conocido.
    let centerX, centerZ;
    if (hasPos) {
      centerX = qx; centerZ = qz;
    } else {
      const me = await env.DB.prepare(
        'SELECT x, z FROM online_users WHERE user_id = ?'
      ).bind(session.user_id).first();
      if (!me) {
        // Aún no ha hecho heartbeat. Devolvemos snapshot vacío con timestamp.
        return json({ now, players: [], npcs: [] });
      }
      centerX = me.x; centerZ = me.z;
    }

    const margin = SNAPSHOT_RADIUS_M;
    const radiusSq = margin * margin;

    // -------------------- Players --------------------
    // online_users tiene pos/yaw/state fresca. combat_stats tiene hp + xp.
    // user_skills tiene los XPs de todos los skills (necesarios para
    // calcular combat_lvl). LEFT JOIN porque puede que un user esté online
    // pero todavía no tenga fila en combat_stats/user_skills (cuenta recién
    // creada antes del primer combate). Excluimos al propio user.
    //
    // Sesión 27 Bloque 3 — añadidos campos para PVP + Party:
    //   - attack_xp / strength_xp / defence_xp → niveles para mostrar y
    //     calcular combat_lvl client-side.
    //   - combat_lvl pre-calculado server-side (más eficiente).
    //   - party_id (LEFT JOIN party_members, NULL si no en party).
    //
    // Defensa: si party_members no existe (migración no corrida), la query
    // con JOIN falla. Probamos con JOIN primero; si falla, fallback sin.
    // Sesión 34 — B-001b: para que los peers se vean con el arma REAL
    // que cada uno tiene equipada (en lugar del SkeletonUtils.clone copiando
    // la del local player), traemos también weapon_item_id + weapon_type por
    // peer. El cliente attachea la mesh correcta al bone del peer.
    //
    // Nota: si el peer no tiene nada equipado, weapon_item_id viene NULL y
    // el cliente sabe que es unarmed.
    let playerRows;
    try {
      playerRows = await env.DB.prepare(
        `SELECT o.user_id, o.username, o.x, o.z, o.yaw, o.state, o.last_seen,
                c.hp_current, c.hp_xp, c.attack_xp, c.strength_xp, c.defence_xp,
                c.last_attack_at,
                c.last_hit_damage, c.last_hit_at, c.last_hit_is_crit,
                pm.party_id,
                ueq.item_id AS weapon_item_id,
                wi.weapon_type AS weapon_type
         FROM online_users o
         LEFT JOIN combat_stats c ON c.user_id = o.user_id
         LEFT JOIN party_members pm ON pm.user_id = o.user_id
         LEFT JOIN user_equipment ueq ON ueq.user_id = o.user_id AND ueq.slot_id = 'weapon'
         LEFT JOIN items wi ON wi.id = ueq.item_id
         WHERE o.last_seen > ?
           AND o.user_id != ?
           AND o.x BETWEEN ? AND ?
           AND o.z BETWEEN ? AND ?`
      ).bind(
        peerCutoff, session.user_id,
        centerX - margin, centerX + margin,
        centerZ - margin, centerZ + margin,
      ).all();
    } catch (err) {
      // party_members no existe → repetir sin JOIN
      playerRows = await env.DB.prepare(
        `SELECT o.user_id, o.username, o.x, o.z, o.yaw, o.state, o.last_seen,
                c.hp_current, c.hp_xp, c.attack_xp, c.strength_xp, c.defence_xp,
                c.last_attack_at,
                c.last_hit_damage, c.last_hit_at, c.last_hit_is_crit,
                ueq.item_id AS weapon_item_id,
                wi.weapon_type AS weapon_type
         FROM online_users o
         LEFT JOIN combat_stats c ON c.user_id = o.user_id
         LEFT JOIN user_equipment ueq ON ueq.user_id = o.user_id AND ueq.slot_id = 'weapon'
         LEFT JOIN items wi ON wi.id = ueq.item_id
         WHERE o.last_seen > ?
           AND o.user_id != ?
           AND o.x BETWEEN ? AND ?
           AND o.z BETWEEN ? AND ?`
      ).bind(
        peerCutoff, session.user_id,
        centerX - margin, centerX + margin,
        centerZ - margin, centerZ + margin,
      ).all();
    }

    const players = (playerRows.results || [])
      .filter(r => {
        const dx = r.x - centerX, dz = r.z - centerZ;
        return (dx * dx + dz * dz) <= radiusSq;
      })
      .map(r => {
        const hpMax  = r.hp_xp       != null ? levelFromXp(r.hp_xp)       : 10;
        const attLvl = r.attack_xp   != null ? levelFromXp(r.attack_xp)   : 1;
        const strLvl = r.strength_xp != null ? levelFromXp(r.strength_xp) : 1;
        const defLvl = r.defence_xp  != null ? levelFromXp(r.defence_xp)  : 1;
        // Combat level OSRS (sin ranged/magic/prayer todavía — los añadimos
        // cuando esos skills estén implementados). Fórmula reducida:
        //   base  = (def + hp) / 4
        //   melee = (att + str) * 13 / 40
        //   cb    = floor(base + melee)
        const base  = (defLvl + hpMax) / 4;
        const melee = (attLvl + strLvl) * 13 / 40;
        const combatLvl = Math.floor(base + melee);
        const hpCur = typeof r.hp_current === 'number' ? r.hp_current : hpMax;
        const inCombat = r.last_attack_at != null &&
          (now - r.last_attack_at) < IN_COMBAT_WINDOW_MS;
        return {
          user_id:    r.user_id,
          username:   r.username,
          x:          r.x,
          z:          r.z,
          yaw:        r.yaw,
          state:      r.state,
          hp_current: hpCur,
          hp_max:     hpMax,
          attack_lvl: attLvl,
          strength_lvl: strLvl,
          defence_lvl:  defLvl,
          combat_lvl:   combatLvl,
          in_combat:  inCombat,
          // Sesión 32 — exponer last_attack_at para que multiplayer.js
          // pueda detectar cuando este peer acaba de atacar y reproducir
          // la anim de attack sobre su mesh local.
          last_attack_at: r.last_attack_at,
          last_seen:  r.last_seen,
          party_id:   r.party_id != null ? r.party_id : null,   // Sesión 27 Bloque 3
          // Sesión 34 — B-001b: arma equipada por el peer (item_id real +
          // weapon_type). Cliente la usa para attachear el GLB correcto al
          // bone del peer en vez de clonar la del local player.
          // Si no tiene nada equipado, ambos NULL → cliente lo renderiza unarmed.
          weapon_item_id: r.weapon_item_id || null,
          weapon_type:    r.weapon_type    || null,
          // Sesión 34 — B-001b extra: cuando un peer recibe damage, el cliente
          // dispara un hitsplat numeric sobre su cabeza. Se detecta por cambio
          // en last_hit_at (igual patrón que last_attack_at de S32).
          last_hit_damage:  typeof r.last_hit_damage === 'number' ? r.last_hit_damage : null,
          last_hit_at:      typeof r.last_hit_at === 'number'     ? r.last_hit_at     : null,
          last_hit_is_crit: r.last_hit_is_crit === 1,
        };
      });

    // -------------------- NPCs --------------------
    // Bloque 2: formato idéntico al de combat_engine.getCombatState para que
    // npc_renderer.js sea drop-in replacement. Solo vivos (status=0).
    // in_combat_with es directamente el user_id o NULL.
    const npcRows = await env.DB.prepare(
      `SELECT i.id, i.def_id, i.x, i.z, i.hp_current, i.status,
              i.in_combat_with, i.last_attack_at,
              d.name, d.max_hp, d.attack_lvl, d.strength_lvl, d.defence_lvl,
              d.attack_speed_ticks, d.max_hit, d.attack_range, d.model
       FROM npc_instances i
       JOIN npc_defs d ON d.id = i.def_id
       WHERE i.status = 0
         AND i.x BETWEEN ? AND ?
         AND i.z BETWEEN ? AND ?`
    ).bind(
      centerX - margin, centerX + margin,
      centerZ - margin, centerZ + margin,
    ).all();

    const npcs = (npcRows.results || [])
      .filter(r => {
        const dx = r.x - centerX, dz = r.z - centerZ;
        return (dx * dx + dz * dz) <= radiusSq;
      })
      .map(r => ({
        id:             r.id,
        def_id:         r.def_id,
        name:           r.name,
        x:              r.x,
        z:              r.z,
        hp_current:     r.hp_current,
        max_hp:         r.max_hp,
        status:         r.status,
        attack_lvl:     r.attack_lvl,
        strength_lvl:   r.strength_lvl,
        defence_lvl:    r.defence_lvl,
        max_hit:        r.max_hit,
        attack_range:   r.attack_range,
        model:          r.model,
        in_combat_with: r.in_combat_with,
        in_combat: r.last_attack_at != null &&
          (now - r.last_attack_at) < IN_COMBAT_WINDOW_MS,
      }));

    // -------------------- Me (info del propio user) --------------------
    // Sesión 27 Bloque 3 — AUTO RETALIATE
    // Para que el cliente pueda hacer auto-retaliate sin endpoints extra,
    // incluimos en cada snapshot el "último ataque que recibí". Eso lo
    // sacamos de combat_log con una query simple (target_id = mi user,
    // target_type = 0 (player), últimos 8 segundos).
    //
    // El cliente, cuando autoRetaliate=ON y no tiene target, mira este
    // campo y engagea al atacante automáticamente (NPC o player según
    // attacker_type: 0=player, 1=npc).
    const RETALIATE_WINDOW_MS = 8_000;
    const retaliateCutoff = now - RETALIATE_WINDOW_MS;
    let me = {
      last_attacker: null,
      party_id: null,
      duel: null,           // Sesión 28
      duel_invites_in: [],  // Sesión 28
      duel_invite_out: null,// Sesión 28
      // Sesión 32 — último hit recibido (de quién, cuánto, cuándo).
      // El cliente usa esto para spawn hitsplats + anim de reacción cuando
      // un peer le pega SIN que el target haya iniciado el combate.
      last_hit_from_user_id: null,
      last_hit_damage: null,
      last_hit_at: null,
      last_hit_is_crit: null,
      // Sesión 37 — Death notify server-driven. Antes el cliente del muerto
      // solo se enteraba de su muerte si la muerte venía como respuesta a
      // SU propio /attack o /attack_player. Si te mataba un peer o NPC sin
      // que vos atacaras, server marcaba hp=0 pero nadie te avisaba → quedabas
      // en limbo (te movías, sin barra, sin Respawn).
      //
      // Fix: exponemos las dos cosas que ya están en combat_stats.
      //   - last_died_at: timestamp ms de la última muerte (server lo setea
      //     en cualquier path de muerte: PvE, PvP, duelo).
      //   - you_died_recently: true si last_died_at es reciente (< 30s) Y
      //     hp_current <= 0 (no respawneó todavía). El cliente lo lee en
      //     cada refresh (cada 3s sin combate, cada tick con combate) y
      //     dispara __playerDeath inmediatamente.
      //
      // Diseño: el flag combina las 2 condiciones server-side así el cliente
      // no tiene que pensar. Si last_died_at>0 pero hp_current>0, ya
      // respawneó → flag=false. Si hp_current<=0 pero last_died_at viejo (raro,
      // edge case), no disparamos (probable estado inconsistente, que sane
      // por el side path).
      last_died_at: null,
      you_died_recently: false,
    };
    // Sesión 32 — fetch last_hit_* del combat_stats. Defensivo: si las
    // columnas no existen, los campos quedan null (cliente maneja como
    // "no hit").
    try {
      const hitRow = await env.DB.prepare(
        `SELECT last_hit_from_user_id, last_hit_damage, last_hit_at, last_hit_is_crit
         FROM combat_stats WHERE user_id = ?`
      ).bind(session.user_id).first();
      if (hitRow) {
        me.last_hit_from_user_id = hitRow.last_hit_from_user_id;
        me.last_hit_damage = hitRow.last_hit_damage;
        me.last_hit_at = hitRow.last_hit_at;
        me.last_hit_is_crit = hitRow.last_hit_is_crit;
      }
    } catch {
      // columnas no existen → me.last_hit_* quedan null. OK.
    }
    // Sesión 37 — fetch last_died_at + hp_current para death notify.
    // Defensivo: si la columna no existe (combat_stats schema sin migrar),
    // el flag queda false y caemos al safety net del cliente (polling +
    // detección hp<=0 sin ack de server).
    try {
      const deathRow = await env.DB.prepare(
        `SELECT last_died_at, hp_current FROM combat_stats WHERE user_id = ?`
      ).bind(session.user_id).first();
      if (deathRow) {
        me.last_died_at = deathRow.last_died_at;
        const DEATH_NOTIFY_WINDOW_MS = 30_000;
        const recent = deathRow.last_died_at != null &&
                       (now - deathRow.last_died_at) < DEATH_NOTIFY_WINDOW_MS;
        const stillDead = typeof deathRow.hp_current === 'number' &&
                          deathRow.hp_current <= 0;
        me.you_died_recently = !!(recent && stillDead);
      }
    } catch {
      // columna no existe → me.last_died_at queda null, flag queda false.
    }
    try {
      const lastAtk = await env.DB.prepare(
        `SELECT attacker_type, attacker_id, ts
         FROM combat_log
         WHERE target_type = 0 AND target_id = ? AND ts > ?
         ORDER BY ts DESC LIMIT 1`
      ).bind(session.user_id, retaliateCutoff).first();
      if (lastAtk) {
        me.last_attacker = {
          type: lastAtk.attacker_type,
          id:   lastAtk.attacker_id,
          at:   lastAtk.ts,
        };
      }
    } catch (err) {
      console.warn('[snapshot] last_attacker query failed:', err.message);
    }
    // Sesión 27 Bloque 3 — mi party_id (defensivo: si tabla no existe, null)
    try {
      const myParty = await env.DB.prepare(
        `SELECT party_id FROM party_members WHERE user_id = ?`
      ).bind(session.user_id).first();
      if (myParty?.party_id != null) me.party_id = myParty.party_id;
    } catch {
      // tabla no existe → me.party_id queda null
    }

    // Sesión 28 — duelo activo + invites
    // Defensivo: si tabla `duels` no existe (migración no corrida), todo
    // queda en null/[] y el cliente no muestra HUD de duelo.
    try {
      // 1) Cleanup lazy: cerrar duelos cuyo cast de salida ya terminó.
      //    Esto es UN UPDATE como mucho. Lo hacemos aquí para que el HUD
      //    del cliente se actualice rápido (snapshot polling = 250ms).
      await env.DB.prepare(
        `UPDATE duels SET ended_at = ?
         WHERE ended_at IS NULL
           AND leave_cast_ends_at IS NOT NULL
           AND leave_cast_ends_at <= ?`
      ).bind(now, now).run();

      // 2) Duelo activo del user actual.
      const duelRow = await env.DB.prepare(
        `SELECT id, user_a_id, user_b_id, started_at,
                leaving_a_at, leaving_b_at, leave_cast_ends_at
         FROM duels
         WHERE ended_at IS NULL AND (user_a_id = ? OR user_b_id = ?)
         LIMIT 1`
      ).bind(session.user_id, session.user_id).first();

      if (duelRow) {
        // Determinar oponente y username + combat_lvl. El opponent puede
        // estar fuera del radio del snapshot (los duelistas se pueden
        // alejar). Por eso hacemos query separada.
        const otherId = duelRow.user_a_id === session.user_id
          ? duelRow.user_b_id
          : duelRow.user_a_id;
        const otherRow = await env.DB.prepare(
          `SELECT u.id, u.username, cs.attack_xp, cs.strength_xp,
                  cs.defence_xp, cs.hp_xp
           FROM users u
           LEFT JOIN combat_stats cs ON cs.user_id = u.id
           WHERE u.id = ?`
        ).bind(otherId).first();

        let otherCombatLvl = 3;
        let otherUsername = '?';
        if (otherRow) {
          otherUsername = otherRow.username;
          const att = otherRow.attack_xp   != null ? levelFromXp(otherRow.attack_xp)   : 1;
          const str = otherRow.strength_xp != null ? levelFromXp(otherRow.strength_xp) : 1;
          const def = otherRow.defence_xp  != null ? levelFromXp(otherRow.defence_xp)  : 1;
          const hp  = otherRow.hp_xp       != null ? levelFromXp(otherRow.hp_xp)       : 10;
          otherCombatLvl = Math.floor((def + hp) / 4 + (att + str) * 13 / 40);
        }

        // ¿Es mi cast el que está activo?
        const isA = duelRow.user_a_id === session.user_id;
        const myLeavingAt = isA ? duelRow.leaving_a_at : duelRow.leaving_b_at;

        me.duel = {
          id: duelRow.id,
          opponent_user_id: otherId,
          opponent_username: otherUsername,
          opponent_combat_lvl: otherCombatLvl,
          started_at: duelRow.started_at,
          // leaving_at = el momento en que YO inicié mi cast (o null).
          // El otro puede estar casteando también — leave_cast_ends_at
          // refleja el cast más reciente (el que terminará primero).
          my_leaving_at: myLeavingAt,
          opponent_leaving_at: isA ? duelRow.leaving_b_at : duelRow.leaving_a_at,
          leave_cast_ends_at: duelRow.leave_cast_ends_at,
        };
      }

      // 3) Invites recibidas (pendientes, no expiradas).
      const invitesIn = await env.DB.prepare(
        `SELECT r.from_user_id, r.expires_at, u.username AS from_username,
                cs.attack_xp, cs.strength_xp, cs.defence_xp, cs.hp_xp
         FROM duel_requests r
         JOIN users u ON u.id = r.from_user_id
         LEFT JOIN combat_stats cs ON cs.user_id = r.from_user_id
         WHERE r.to_user_id = ? AND r.expires_at >= ?
         ORDER BY r.expires_at ASC`
      ).bind(session.user_id, now).all();

      me.duel_invites_in = (invitesIn.results || []).map(r => {
        const att = r.attack_xp   != null ? levelFromXp(r.attack_xp)   : 1;
        const str = r.strength_xp != null ? levelFromXp(r.strength_xp) : 1;
        const def = r.defence_xp  != null ? levelFromXp(r.defence_xp)  : 1;
        const hp  = r.hp_xp       != null ? levelFromXp(r.hp_xp)       : 10;
        const cb  = Math.floor((def + hp) / 4 + (att + str) * 13 / 40);
        return {
          from_user_id: r.from_user_id,
          from_username: r.from_username,
          from_combat_lvl: cb,
          expires_at: r.expires_at,
        };
      });

      // 4) Invite outgoing (mi request pendiente).
      const inviteOut = await env.DB.prepare(
        `SELECT r.to_user_id, r.expires_at, u.username AS to_username
         FROM duel_requests r
         JOIN users u ON u.id = r.to_user_id
         WHERE r.from_user_id = ? AND r.expires_at >= ?
         LIMIT 1`
      ).bind(session.user_id, now).first();

      if (inviteOut) {
        me.duel_invite_out = {
          to_user_id: inviteOut.to_user_id,
          to_username: inviteOut.to_username,
          expires_at: inviteOut.expires_at,
        };
      }
    } catch (err) {
      // tabla duels no existe → me.duel sigue null y el cliente no muestra
      // HUD. Loggeamos solo si NO es "no such table" (que esperamos durante
      // migración).
      const msg = err?.message || '';
      if (!msg.includes('no such table')) {
        console.warn('[snapshot/duel]', msg);
      }
    }

    // -------------------- Fires + depleted_trees (Sesión 30) --------------------
    // Defensive: si tabla fires no existe (migración no corrida), array vacío.
    // Radio 100m (fuegos no se ven desde lejos visualmente).
    const FIRES_RADIUS_M = 100;
    let fires = [];
    try {
      const fireRows = await env.DB.prepare(
        `SELECT id, x, z, log_type, lit_at, expires_at, user_id
         FROM fires
         WHERE expires_at > ?
           AND x BETWEEN ? AND ?
           AND z BETWEEN ? AND ?`
      ).bind(
        now,
        centerX - FIRES_RADIUS_M, centerX + FIRES_RADIUS_M,
        centerZ - FIRES_RADIUS_M, centerZ + FIRES_RADIUS_M,
      ).all();
      // Filtrar a radio circular (no bbox)
      const radSq = FIRES_RADIUS_M * FIRES_RADIUS_M;
      fires = (fireRows.results || []).filter(r => {
        const dxF = r.x - centerX, dzF = r.z - centerZ;
        return (dxF * dxF + dzF * dzF) <= radSq;
      }).map(r => ({
        id:         r.id,
        x:          r.x,
        z:          r.z,
        log_type:   r.log_type,
        lit_at:     r.lit_at,
        expires_at: r.expires_at,
        user_id:    r.user_id,
      }));
    } catch (err) {
      const msg = err?.message || '';
      if (!msg.includes('no such table')) {
        console.warn('[snapshot/fires]', msg);
      }
    }

    // Depleted trees: árboles depletados en radio 100m (mismo que fires).
    let depleted_trees = [];
    try {
      const treeRows = await env.DB.prepare(
        `SELECT x, z, tree_type, depleted_until
         FROM tree_state
         WHERE depleted_until > ?
           AND x BETWEEN ? AND ?
           AND z BETWEEN ? AND ?`
      ).bind(
        now,
        centerX - FIRES_RADIUS_M, centerX + FIRES_RADIUS_M,
        centerZ - FIRES_RADIUS_M, centerZ + FIRES_RADIUS_M,
      ).all();
      const radSq = FIRES_RADIUS_M * FIRES_RADIUS_M;
      depleted_trees = (treeRows.results || []).filter(r => {
        const dxT = r.x - centerX, dzT = r.z - centerZ;
        return (dxT * dxT + dzT * dzT) <= radSq;
      }).map(r => ({
        x:               r.x,
        z:               r.z,
        tree_type:       r.tree_type,
        depleted_until:  r.depleted_until,
      }));
    } catch (err) {
      const msg = err?.message || '';
      if (!msg.includes('no such table')) {
        console.warn('[snapshot/tree_state]', msg);
      }
    }

    return json({ now, players, npcs, me, fires, depleted_trees });
  } catch (err) {
    console.error('[world/snapshot]', err);
    return json({ error: 'internal_error', message: err.message }, 500);
  }
}
