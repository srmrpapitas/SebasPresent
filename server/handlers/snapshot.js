/**
 * SebasPresent — World Snapshot handler (Sesión 27, Bloques 1 + 2 PVP)
 * Endpoint: GET /api/world/snapshot?x=&z=
 *
 * Bloque 1: endpoint server-authoritative que devuelve players+NPCs+timestamp.
 * Bloque 2: ampliado para ser drop-in replacement de /api/combat/state respecto
 *           a NPCs. npc_renderer.js cliente ahora lee de aquí (250ms) en
 *           lugar de polear combat/state (5s).
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
    // Sesión 27 Bloque 3 — añadidos campos para PVP:
    //   - attack_xp / strength_xp / defence_xp → niveles para mostrar y
    //     calcular combat_lvl client-side.
    //   - combat_lvl pre-calculado server-side (más eficiente).
    const playerRows = await env.DB.prepare(
      `SELECT o.user_id, o.username, o.x, o.z, o.yaw, o.state, o.last_seen,
              c.hp_current, c.hp_xp, c.attack_xp, c.strength_xp, c.defence_xp,
              c.last_attack_at
       FROM online_users o
       LEFT JOIN combat_stats c ON c.user_id = o.user_id
       WHERE o.last_seen > ?
         AND o.user_id != ?
         AND o.x BETWEEN ? AND ?
         AND o.z BETWEEN ? AND ?`
    ).bind(
      peerCutoff, session.user_id,
      centerX - margin, centerX + margin,
      centerZ - margin, centerZ + margin,
    ).all();

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
          last_seen:  r.last_seen,
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
    let me = { last_attacker: null };
    try {
      const lastAtk = await env.DB.prepare(
        `SELECT attacker_type, attacker_id, ts
         FROM combat_log
         WHERE target_type = 0 AND target_id = ? AND ts > ?
         ORDER BY ts DESC LIMIT 1`
      ).bind(session.user_id, retaliateCutoff).first();
      if (lastAtk) {
        me.last_attacker = {
          type: lastAtk.attacker_type,   // 0=player, 1=npc
          id:   lastAtk.attacker_id,
          at:   lastAtk.ts,
        };
      }
    } catch (err) {
      // Si la query falla (índice ausente, tabla vacía, etc), no es crítico
      // — solo significa que el auto-retaliate de este snapshot no
      // disparará. Próximo snapshot intentamos de nuevo.
      console.warn('[snapshot] last_attacker query failed:', err.message);
    }

    return json({ now, players, npcs, me });
  } catch (err) {
    console.error('[world/snapshot]', err);
    return json({ error: 'internal_error', message: err.message }, 500);
  }
}
