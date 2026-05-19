/**
 * SebasPresent — Party handlers (Sesión 27 Bloque 3 + Sesión 28 group frame)
 *
 * Endpoints:
 *   POST   /api/party/invite   { target_user_id }
 *   POST   /api/party/accept   { from_user_id }
 *   POST   /api/party/decline  { from_user_id }
 *   POST   /api/party/leave
 *   POST   /api/party/kick     { target_user_id }   (solo leader)
 *   GET    /api/party/state                          → tu party + invites
 *
 * Sesión 28 — getPartyMembers ahora devuelve también:
 *   - hp_current, hp_max  (para barra HP estilo WoW)
 *   - combat_lvl          (junto al nombre)
 *   - weapon_type         (para icono de clase: melee / ranged / mage)
 *   - in_combat           (highlight rojo cuando está peleando)
 * Esto permite al cliente pintar un group frame compacto sin polling extra.
 *
 * Reglas:
 *   - Un user en máximo 1 party (UNIQUE en party_members.user_id).
 *   - max_size = 4 por party.
 *   - Invite TTL = 60s.
 *   - No puedes invitarte a ti mismo.
 *   - No puedes invitar a alguien que ya está en otra party.
 *   - Si el leader sale, el siguiente miembro (por joined_at) se vuelve leader.
 *   - Si solo queda 1, la party se borra.
 *   - Si la tabla parties no existe (migración no corrida), devolver
 *     'party_disabled' en vez de petar.
 */
import { json, makeDbAdapter } from '../lib/db.js';
import { requireSession } from '../lib/auth.js';

const INVITE_TTL_MS = 60_000;
const DEFAULT_MAX_PARTY = 4;
const IN_COMBAT_WINDOW_MS = 8_000;

// XP → level table (replica para no importar circular).
function levelFromXp(xp) {
  if (xp == null || xp <= 0) return 1;
  let points = 0;
  for (let lvl = 1; lvl < 99; lvl++) {
    points += Math.floor(lvl + 300 * Math.pow(2, lvl / 7));
    const required = Math.floor(points / 4);
    if (xp < required) return lvl;
  }
  return 99;
}

// Combat lvl OSRS reducido (sin ranged/magic/prayer todavía).
function calcCombatLvl(attXp, strXp, defXp, hpXp) {
  const att = levelFromXp(attXp);
  const str = levelFromXp(strXp);
  const def = levelFromXp(defXp);
  const hp  = levelFromXp(hpXp);
  const base  = (def + hp) / 4;
  const melee = (att + str) * 13 / 40;
  return Math.floor(base + melee);
}

// ============================================================
// Helper: verifica si las tablas de party existen.
// ============================================================
async function partyTablesExist(db) {
  try {
    await db.all(`SELECT 1 FROM parties LIMIT 1`);
    return true;
  } catch {
    return false;
  }
}

// ============================================================
// Helper: party del user actual (o null).
// ============================================================
async function getUserParty(db, userId) {
  const row = await db.first(
    `SELECT p.id, p.leader_user_id, p.created_at, p.max_size,
            pm.joined_at AS my_joined_at
     FROM party_members pm
     JOIN parties p ON p.id = pm.party_id
     WHERE pm.user_id = ?`,
    [userId]
  );
  return row || null;
}

// ============================================================
// Helper: lista de miembros con info extendida para group frame.
// Sesión 28 — añade hp, combat_lvl, weapon_type, in_combat.
//
// LEFT JOIN defensivo con combat_stats (puede no tener fila para
// users nuevos) y user_equipment/items (puede no tener weapon equipada).
// Si una tabla falta, fallback a query mínima.
// ============================================================
async function getPartyMembers(db, partyId) {
  const now = Date.now();
  try {
    const rows = await db.all(
      `SELECT pm.user_id, pm.joined_at, u.username,
              cs.hp_current, cs.hp_xp,
              cs.attack_xp, cs.strength_xp, cs.defence_xp,
              cs.last_attack_at,
              i.weapon_type
       FROM party_members pm
       JOIN users u            ON u.id = pm.user_id
       LEFT JOIN combat_stats cs ON cs.user_id = pm.user_id
       LEFT JOIN user_equipment eq ON eq.user_id = pm.user_id AND eq.slot_id = 'weapon'
       LEFT JOIN items i         ON i.id = eq.item_id
       WHERE pm.party_id = ?
       ORDER BY pm.joined_at ASC`,
      [partyId]
    );
    return (rows || []).map(r => {
      const hpMax = r.hp_xp != null ? levelFromXp(r.hp_xp) : 10;
      const hpCur = typeof r.hp_current === 'number' ? r.hp_current : hpMax;
      const combatLvl = calcCombatLvl(r.attack_xp, r.strength_xp, r.defence_xp, r.hp_xp);
      const inCombat = r.last_attack_at != null &&
        (now - r.last_attack_at) < IN_COMBAT_WINDOW_MS;
      return {
        user_id:    r.user_id,
        username:   r.username,
        joined_at:  r.joined_at,
        hp_current: hpCur,
        hp_max:     hpMax,
        combat_lvl: combatLvl,
        weapon_type: r.weapon_type || 'unarmed',
        in_combat:  inCombat,
      };
    });
  } catch (err) {
    console.warn('[party/getMembers] fallback to minimal query:', err?.message);
    // Fallback: query mínima sin JOINs (compatibilidad pre-Sesión 28).
    const rows = await db.all(
      `SELECT pm.user_id, pm.joined_at, u.username
       FROM party_members pm
       JOIN users u ON u.id = pm.user_id
       WHERE pm.party_id = ?
       ORDER BY pm.joined_at ASC`,
      [partyId]
    );
    return (rows || []).map(r => ({
      user_id: r.user_id,
      username: r.username,
      joined_at: r.joined_at,
      hp_current: 10, hp_max: 10,
      combat_lvl: 3,
      weapon_type: 'unarmed',
      in_combat: false,
    }));
  }
}

// ============================================================
// GET /api/party/state
// Devuelve la party del user actual + invites pendientes.
// ============================================================
export async function handlePartyState(request, env) {
  const session = await requireSession(request, env);
  if (!session) return json({ error: 'unauthorized' }, 401);

  const db = makeDbAdapter(env);
  if (!(await partyTablesExist(db))) {
    return json({ party: null, invites_in: [], invites_out: [], party_disabled: true });
  }

  try {
    const now = Date.now();
    const party = await getUserParty(db, session.user_id);
    let members = [];
    if (party) {
      members = await getPartyMembers(db, party.id);
    }
    // Invites entrantes
    const invitesIn = await db.all(
      `SELECT i.id, i.from_user_id, u.username AS from_username, i.party_id, i.sent_at, i.expires_at
       FROM party_invites i
       JOIN users u ON u.id = i.from_user_id
       WHERE i.to_user_id = ? AND i.expires_at > ?
       ORDER BY i.sent_at DESC`,
      [session.user_id, now]
    );
    // Invites salientes
    const invitesOut = await db.all(
      `SELECT i.id, i.to_user_id, u.username AS to_username, i.party_id, i.sent_at, i.expires_at
       FROM party_invites i
       JOIN users u ON u.id = i.to_user_id
       WHERE i.from_user_id = ? AND i.expires_at > ?
       ORDER BY i.sent_at DESC`,
      [session.user_id, now]
    );

    return json({
      party: party ? {
        id:           party.id,
        leader_user_id: party.leader_user_id,
        max_size:     party.max_size,
        members,
      } : null,
      invites_in:  invitesIn  || [],
      invites_out: invitesOut || [],
    });
  } catch (err) {
    console.error('[party/state]', err);
    return json({ error: 'internal_error', message: err.message }, 500);
  }
}

// ============================================================
// POST /api/party/invite  { target_user_id }
// ============================================================
export async function handlePartyInvite(request, env) {
  const session = await requireSession(request, env);
  if (!session) return json({ error: 'unauthorized' }, 401);
  let body;
  try { body = await request.json(); } catch { return json({ error: 'invalid_body' }, 400); }
  const targetId = parseInt(body.target_user_id, 10);
  if (!Number.isFinite(targetId) || targetId <= 0) {
    return json({ error: 'invalid_target' }, 400);
  }
  if (targetId === session.user_id) return json({ error: 'cannot_invite_self' }, 400);

  const db = makeDbAdapter(env);
  if (!(await partyTablesExist(db))) return json({ error: 'party_disabled' }, 503);

  try {
    const now = Date.now();
    const expiresAt = now + INVITE_TTL_MS;

    const targetUser = await db.first(`SELECT id, username FROM users WHERE id = ?`, [targetId]);
    if (!targetUser) return json({ error: 'target_not_found' }, 404);

    const targetParty = await db.first(
      `SELECT party_id FROM party_members WHERE user_id = ?`, [targetId]
    );
    if (targetParty) return json({ error: 'target_in_party' }, 400);

    const myParty = await getUserParty(db, session.user_id);
    if (myParty) {
      const memberCount = await db.first(
        `SELECT COUNT(*) AS c FROM party_members WHERE party_id = ?`, [myParty.id]
      );
      if (memberCount.c >= myParty.max_size) return json({ error: 'party_full' }, 400);
    }

    await db.run(`DELETE FROM party_invites WHERE from_user_id = ? AND to_user_id = ?`,
      [session.user_id, targetId]);
    await db.run(
      `INSERT INTO party_invites (from_user_id, to_user_id, party_id, sent_at, expires_at)
       VALUES (?, ?, ?, ?, ?)`,
      [session.user_id, targetId, myParty?.id || null, now, expiresAt]
    );

    return json({ ok: true, target_user_id: targetId, target_username: targetUser.username, expires_at: expiresAt });
  } catch (err) {
    console.error('[party/invite]', err);
    return json({ error: 'internal_error', message: err.message }, 500);
  }
}

// ============================================================
// POST /api/party/accept  { from_user_id }
// ============================================================
export async function handlePartyAccept(request, env) {
  const session = await requireSession(request, env);
  if (!session) return json({ error: 'unauthorized' }, 401);
  let body;
  try { body = await request.json(); } catch { return json({ error: 'invalid_body' }, 400); }
  const fromId = parseInt(body.from_user_id, 10);
  if (!Number.isFinite(fromId) || fromId <= 0) return json({ error: 'invalid_from' }, 400);

  const db = makeDbAdapter(env);
  if (!(await partyTablesExist(db))) return json({ error: 'party_disabled' }, 503);

  try {
    const now = Date.now();
    const invite = await db.first(
      `SELECT id, party_id FROM party_invites
       WHERE from_user_id = ? AND to_user_id = ? AND expires_at > ?`,
      [fromId, session.user_id, now]
    );
    if (!invite) return json({ error: 'invite_not_found_or_expired' }, 404);

    const myParty = await getUserParty(db, session.user_id);
    if (myParty) return json({ error: 'already_in_party' }, 400);

    let partyId = invite.party_id;
    let createdNewParty = false;

    if (!partyId) {
      const inviterParty = await getUserParty(db, fromId);
      if (inviterParty) {
        partyId = inviterParty.id;
      } else {
        const created = await db.run(
          `INSERT INTO parties (leader_user_id, created_at, max_size) VALUES (?, ?, ?)`,
          [fromId, now, DEFAULT_MAX_PARTY]
        );
        partyId = created.lastInsertRowid ?? created.lastID ?? created.meta?.last_row_id;
        if (!partyId) {
          const p = await db.first(`SELECT id FROM parties WHERE leader_user_id = ? ORDER BY id DESC LIMIT 1`, [fromId]);
          partyId = p?.id;
        }
        if (!partyId) return json({ error: 'party_create_failed' }, 500);
        await db.run(
          `INSERT INTO party_members (party_id, user_id, joined_at) VALUES (?, ?, ?)`,
          [partyId, fromId, now]
        );
        createdNewParty = true;
      }
    } else {
      const p = await db.first(`SELECT id, max_size FROM parties WHERE id = ?`, [partyId]);
      if (!p) return json({ error: 'party_no_longer_exists' }, 410);
      const c = await db.first(`SELECT COUNT(*) AS c FROM party_members WHERE party_id = ?`, [partyId]);
      if (c.c >= p.max_size) return json({ error: 'party_full' }, 400);
    }

    await db.run(
      `INSERT INTO party_members (party_id, user_id, joined_at) VALUES (?, ?, ?)`,
      [partyId, session.user_id, now]
    );

    await db.run(`DELETE FROM party_invites WHERE to_user_id = ?`, [session.user_id]);

    return json({ ok: true, party_id: partyId, created_new_party: createdNewParty });
  } catch (err) {
    console.error('[party/accept]', err);
    return json({ error: 'internal_error', message: err.message }, 500);
  }
}

// ============================================================
// POST /api/party/decline  { from_user_id }
// ============================================================
export async function handlePartyDecline(request, env) {
  const session = await requireSession(request, env);
  if (!session) return json({ error: 'unauthorized' }, 401);
  let body;
  try { body = await request.json(); } catch { return json({ error: 'invalid_body' }, 400); }
  const fromId = parseInt(body.from_user_id, 10);
  if (!Number.isFinite(fromId) || fromId <= 0) return json({ error: 'invalid_from' }, 400);

  const db = makeDbAdapter(env);
  if (!(await partyTablesExist(db))) return json({ error: 'party_disabled' }, 503);

  try {
    await db.run(
      `DELETE FROM party_invites WHERE from_user_id = ? AND to_user_id = ?`,
      [fromId, session.user_id]
    );
    return json({ ok: true });
  } catch (err) {
    console.error('[party/decline]', err);
    return json({ error: 'internal_error', message: err.message }, 500);
  }
}

// ============================================================
// POST /api/party/leave
// ============================================================
export async function handlePartyLeave(request, env) {
  const session = await requireSession(request, env);
  if (!session) return json({ error: 'unauthorized' }, 401);

  const db = makeDbAdapter(env);
  if (!(await partyTablesExist(db))) return json({ error: 'party_disabled' }, 503);

  try {
    const party = await getUserParty(db, session.user_id);
    if (!party) return json({ error: 'not_in_party' }, 400);

    await db.run(`DELETE FROM party_members WHERE user_id = ?`, [session.user_id]);

    if (party.leader_user_id === session.user_id) {
      const next = await db.first(
        `SELECT user_id FROM party_members WHERE party_id = ? ORDER BY joined_at ASC LIMIT 1`,
        [party.id]
      );
      if (next) {
        await db.run(`UPDATE parties SET leader_user_id = ? WHERE id = ?`, [next.user_id, party.id]);
      } else {
        await db.run(`DELETE FROM parties WHERE id = ?`, [party.id]);
      }
    } else {
      const remaining = await db.first(
        `SELECT COUNT(*) AS c FROM party_members WHERE party_id = ?`, [party.id]
      );
      if (remaining.c === 0) {
        await db.run(`DELETE FROM parties WHERE id = ?`, [party.id]);
      }
    }

    return json({ ok: true });
  } catch (err) {
    console.error('[party/leave]', err);
    return json({ error: 'internal_error', message: err.message }, 500);
  }
}

// ============================================================
// POST /api/party/kick  { target_user_id }
// ============================================================
export async function handlePartyKick(request, env) {
  const session = await requireSession(request, env);
  if (!session) return json({ error: 'unauthorized' }, 401);
  let body;
  try { body = await request.json(); } catch { return json({ error: 'invalid_body' }, 400); }
  const targetId = parseInt(body.target_user_id, 10);
  if (!Number.isFinite(targetId) || targetId <= 0) return json({ error: 'invalid_target' }, 400);
  if (targetId === session.user_id) return json({ error: 'cannot_kick_self' }, 400);

  const db = makeDbAdapter(env);
  if (!(await partyTablesExist(db))) return json({ error: 'party_disabled' }, 503);

  try {
    const myParty = await getUserParty(db, session.user_id);
    if (!myParty) return json({ error: 'not_in_party' }, 400);
    if (myParty.leader_user_id !== session.user_id) return json({ error: 'not_leader' }, 403);

    const targetMember = await db.first(
      `SELECT party_id FROM party_members WHERE user_id = ?`, [targetId]
    );
    if (!targetMember || targetMember.party_id !== myParty.id) {
      return json({ error: 'target_not_in_party' }, 400);
    }

    await db.run(`DELETE FROM party_members WHERE user_id = ?`, [targetId]);
    return json({ ok: true });
  } catch (err) {
    console.error('[party/kick]', err);
    return json({ error: 'internal_error', message: err.message }, 500);
  }
}

// ============================================================
// Helper exportado para combat_engine.
// ============================================================
export async function getPartyIdOfUser(db, userId) {
  try {
    const r = await db.first(
      `SELECT party_id FROM party_members WHERE user_id = ?`, [userId]
    );
    return r?.party_id || null;
  } catch {
    return null;
  }
}
