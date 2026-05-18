/**
 * SebasPresent — World Snapshot handler (Sesión 27, Bloque 1 PVP)
 * Endpoint: GET /api/world/snapshot?x=&z=
 *
 * Objetivo del Bloque 1: tener UN único endpoint server-authoritative que
 * devuelva en una sola response la "verdad" del mundo en este tick:
 *   - players cercanos con pos + hp + combat status
 *   - NPCs cercanos con pos + hp + combat status
 *   - timestamp server (para lag compensation futura)
 *
 * NO sustituye a /api/world/peers ni a /api/combat/state. Vive en paralelo
 * durante Bloque 1. En Bloque 2 los clientes migran a este endpoint y los
 * pollings antiguos mueren.
 *
 * Diseño:
 *   - Radio único de 200m (suficiente para minimap y peers).
 *   - Players: join online_users (pos/yaw/state fresca, heartbeat 500ms)
 *     con combat_stats (hp_current, hp_max derivado de hp_xp, last_attack_at).
 *   - NPCs: directamente de npc_instances + npc_defs (status=0=vivos).
 *   - in_combat se computa como now - last_attack_at < IN_COMBAT_WINDOW_MS.
 *
 * Cuesta poco al worker:
 *   - 2 queries D1 (1 players + 1 npcs) con bounding-box prefilter.
 *   - Polling 250ms desde N clientes = N*4 queries/sec/cliente. Sostenible.
 */

import { json } from '../lib/db.js';
import { requireSession } from '../lib/auth.js';

// Radio de visibilidad. 100m es suficiente para peers, pero el cliente
// dibuja NPCs en el minimap con radio mayor. Usamos 200m como compromiso.
const SNAPSHOT_RADIUS_M       = 200;
// Timeout para considerar a un player "online" según online_users.last_seen.
const SNAPSHOT_PEER_TIMEOUT_MS = 10_000;
// Si last_attack_at fue hace menos de esto, el actor está in_combat.
// Coincide con HP_REGEN_COMBAT_LOCKOUT_MS del combat_engine (8s).
const IN_COMBAT_WINDOW_MS     = 8_000;

// XP → level table (replica de skills_engine para no importar circular)
// Solo necesitamos hp_xp → hp_max. Función chiquita inline.
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
    // online_users tiene pos/yaw/state fresca. combat_stats tiene hp.
    // LEFT JOIN porque puede que un user esté online pero todavía no tenga
    // fila en combat_stats (cuenta recién creada antes del primer combate).
    // Excluimos al propio user (el cliente ya se conoce a sí mismo).
    const playerRows = await env.DB.prepare(
      `SELECT o.user_id, o.username, o.x, o.z, o.yaw, o.state, o.last_seen,
              c.hp_current, c.hp_xp, c.last_attack_at
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
        const hpMax = r.hp_xp != null ? levelFromXp(r.hp_xp) : 10;
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
          in_combat:  inCombat,
          last_seen:  r.last_seen,
        };
      });

    // -------------------- NPCs --------------------
    // Solo vivos (status=0). Devolvemos hp_current + max_hp del def.
    // in_combat_with es directamente el user_id o NULL.
    const npcRows = await env.DB.prepare(
      `SELECT i.id, i.def_id, i.x, i.z, i.hp_current, i.status,
              i.in_combat_with, i.last_attack_at,
              d.max_hp, d.name
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
        hp_max:         r.max_hp,
        status:         r.status,
        in_combat_with: r.in_combat_with,
        in_combat: r.last_attack_at != null &&
          (now - r.last_attack_at) < IN_COMBAT_WINDOW_MS,
      }));

    return json({ now, players, npcs });
  } catch (err) {
    console.error('[world/snapshot]', err);
    return json({ error: 'internal_error', message: err.message }, 500);
  }
}
