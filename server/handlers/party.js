/**
 * SebasPresent — Party handlers (Sesión 27 Bloque 3)
 *
 * Endpoints:
 *   POST   /api/party/invite   { target_user_id }
 *   POST   /api/party/accept   { from_user_id }
 *   POST   /api/party/decline  { from_user_id }
 *   POST   /api/party/leave
 *   POST   /api/party/kick     { target_user_id }   (solo leader)
 *   GET    /api/party/state                          → tu party + invites
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
 *
 * Bloqueo PVP entre miembros: NO se gestiona aquí. Se hace en
 * combat_engine.attackPlayer leyendo party_members ANTES de aplicar daño.
 */
import { json, makeDbAdapter } from '../lib/db.js';
import { requireSession } from '../lib/auth.js';

const INVITE_TTL_MS = 60_000;
const DEFAULT_MAX_PARTY = 4;

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
// Helper: lista de miembros de una party con sus usernames.
// ============================================================
async function getPartyMembers(db, partyId) {
  return await db.all(
    `SELECT pm.user_id, pm.joined_at, u.username
     FROM party_members pm
     JOIN users u ON u.id = pm.user_id
     WHERE pm.party_id = ?
     ORDER BY pm.joined_at ASC`,
    [partyId]
  );
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
    // Invites entrantes (gente que te invitó, no expiradas)
    const invitesIn = await db.all(
      `SELECT i.id, i.from_user_id, u.username AS from_username, i.party_id, i.sent_at, i.expires_at
       FROM party_invites i
       JOIN users u ON u.id = i.from_user_id
       WHERE i.to_user_id = ? AND i.expires_at > ?
       ORDER BY i.sent_at DESC`,
      [session.user_id, now]
    );
    // Invites salientes (tuyas, pendientes)
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

    // ¿Existe el target?
    const targetUser = await db.first(`SELECT id, username FROM users WHERE id = ?`, [targetId]);
    if (!targetUser) return json({ error: 'target_not_found' }, 404);

    // ¿El target ya está en una party?
    const targetParty = await db.first(
      `SELECT party_id FROM party_members WHERE user_id = ?`, [targetId]
    );
    if (targetParty) return json({ error: 'target_in_party' }, 400);

    // ¿Yo tengo party? Si sí, ¿hay espacio?
    const myParty = await getUserParty(db, session.user_id);
    if (myParty) {
      const memberCount = await db.first(
        `SELECT COUNT(*) AS c FROM party_members WHERE party_id = ?`, [myParty.id]
      );
      if (memberCount.c >= myParty.max_size) return json({ error: 'party_full' }, 400);
    }

    // Insertar/replace invite (UNIQUE from-to, así que si re-invitas refresca TTL)
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
    // Buscar el invite vivo
    const invite = await db.first(
      `SELECT id, party_id FROM party_invites
       WHERE from_user_id = ? AND to_user_id = ? AND expires_at > ?`,
      [fromId, session.user_id, now]
    );
    if (!invite) return json({ error: 'invite_not_found_or_expired' }, 404);

    // ¿Ya estoy en una party? Si sí, no puedo aceptar
    const myParty = await getUserParty(db, session.user_id);
    if (myParty) return json({ error: 'already_in_party' }, 400);

    let partyId = invite.party_id;
    let createdNewParty = false;

    if (!partyId) {
      // El inviter no tenía party — la creamos y añadimos al inviter como leader.
      // Pero primero verificar: ¿el inviter ya está en otra? (race condition)
      const inviterParty = await getUserParty(db, fromId);
      if (inviterParty) {
        partyId = inviterParty.id;
      } else {
        // Crear party con inviter como leader
        const created = await db.run(
          `INSERT INTO parties (leader_user_id, created_at, max_size) VALUES (?, ?, ?)`,
          [fromId, now, DEFAULT_MAX_PARTY]
        );
        partyId = created.lastInsertRowid ?? created.lastID ?? created.meta?.last_row_id;
        if (!partyId) {
          // Fallback: query
          const p = await db.first(`SELECT id FROM parties WHERE leader_user_id = ? ORDER BY id DESC LIMIT 1`, [fromId]);
          partyId = p?.id;
        }
        if (!partyId) return json({ error: 'party_create_failed' }, 500);
        // Añadir al inviter como miembro
        await db.run(
          `INSERT INTO party_members (party_id, user_id, joined_at) VALUES (?, ?, ?)`,
          [partyId, fromId, now]
        );
        createdNewParty = true;
      }
    } else {
      // Verificar que la party aún existe y tiene sitio
      const p = await db.first(`SELECT id, max_size FROM parties WHERE id = ?`, [partyId]);
      if (!p) return json({ error: 'party_no_longer_exists' }, 410);
      const c = await db.first(`SELECT COUNT(*) AS c FROM party_members WHERE party_id = ?`, [partyId]);
      if (c.c >= p.max_size) return json({ error: 'party_full' }, 400);
    }

    // Añadirme a la party
    await db.run(
      `INSERT INTO party_members (party_id, user_id, joined_at) VALUES (?, ?, ?)`,
      [partyId, session.user_id, now]
    );

    // Limpiar este invite (y cualquier otro pendiente míos)
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

    // Quitarme
    await db.run(`DELETE FROM party_members WHERE user_id = ?`, [session.user_id]);

    // Si era el leader, promover al siguiente más antiguo
    if (party.leader_user_id === session.user_id) {
      const next = await db.first(
        `SELECT user_id FROM party_members WHERE party_id = ? ORDER BY joined_at ASC LIMIT 1`,
        [party.id]
      );
      if (next) {
        await db.run(`UPDATE parties SET leader_user_id = ? WHERE id = ?`, [next.user_id, party.id]);
      } else {
        // Party vacía → borrar
        await db.run(`DELETE FROM parties WHERE id = ?`, [party.id]);
      }
    } else {
      // ¿Quedó solo 1 miembro? Si sí, no la borramos (1 puede invitar a más).
      // Pero si quedó 0 (no debería pasar pero por si acaso):
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

    // ¿Target está en mi party?
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
// Helper exportado: getPartyIdOfUser (lo usa combat_engine para
// bloquear PVP entre miembros).
// ============================================================
export async function getPartyIdOfUser(db, userId) {
  try {
    const r = await db.first(
      `SELECT party_id FROM party_members WHERE user_id = ?`, [userId]
    );
    return r?.party_id || null;
  } catch {
    // Si tabla no existe, sin party.
    return null;
  }
}
