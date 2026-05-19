/**
 * SebasPresent — Duel handlers (Sesión 28)
 *
 * Sistema de duelos PVP fuera del wilderness.
 *
 * Endpoints:
 *   GET    /api/duel/state                    → tu duelo activo + invites
 *   POST   /api/duel/challenge  { target_user_id }
 *   POST   /api/duel/accept     { from_user_id }
 *   POST   /api/duel/decline    { from_user_id }
 *   POST   /api/duel/cancel                   → cancela tu request outgoing
 *   POST   /api/duel/leave                    → inicia cast 5s para salir
 *
 * Reglas:
 *   - Un user en máximo 1 duelo activo (índices UNIQUE parciales WHERE ended_at IS NULL).
 *   - Invite TTL = 60s.
 *   - No puedes retarte a ti mismo.
 *   - No puedes retar a alguien de tu party (los party members son aliados siempre).
 *   - No puedes retar a alguien que ya tiene un duelo activo.
 *   - Restricción ±10 niveles de combate. Si tu combat_lvl es 25, puedes
 *     retar a alguien entre 15 y 35 inclusive.
 *   - Wilderness no tiene esta restricción → allá el PVP es libre y multi
 *     (gestionado en combat_engine.attackPlayer, no aquí).
 *   - Cast de salir = 5s. Una vez iniciado NO se cancela. Si mueres durante
 *     el cast, drop normal PVP. Si terminas vivo, el duelo se cierra (cleanup
 *     lazy en snapshot.js cuando now >= leave_cast_ends_at).
 *   - Si alguno entra en wilderness durante el duelo → duelo se cancela
 *     (gestionado en combat_engine.attackPlayer al recibir un attack en wilderness
 *     mientras tienes duelo activo, o en snapshot.js lazy).
 *
 * Si tablas no existen (migración no corrida): devolver 'duel_disabled'.
 */
import { json, readJson, makeDbAdapter } from '../lib/db.js';
import { requireSession } from '../lib/auth.js';

const INVITE_TTL_MS = 60_000;
const LEAVE_CAST_MS = 5_000;
const LEVEL_GAP_MAX = 10;   // ±10 niveles de combate

// XP_TABLE replicada de combat_engine para no importar circular.
// (Solo necesitamos levelFromXp aquí para calcular combat_lvl.)
const XP_TABLE = [
  0,         83,        174,       276,       388,       512,       650,       801,       969,       1154,
  1358,      1584,      1833,      2107,      2411,      2746,      3115,      3523,      3973,      4470,
  5018,      5624,      6291,      7028,      7842,      8740,      9730,      10824,     12031,     13363,
  14833,     16456,     18247,     20224,     22406,     24815,     27473,     30408,     33648,     37224,
  41171,     45529,     50339,     55649,     61512,     67983,     75127,     83014,     91721,     101333,
  111945,    123660,    136594,    150872,    166636,    184040,    203254,    224466,    247886,    273742,
  302288,    333804,    368599,    407015,    449428,    496254,    547953,    605032,    668051,    737627,
  814445,    899257,    992895,    1096278,   1210421,   1336443,   1475581,   1629200,   1798808,   1986068,
  2192818,   2421087,   2673114,   2951373,   3258594,   3597792,   3972294,   4385776,   4842295,   5346332,
  5902831,   6517253,   7195629,   7944614,   8771558,   9684577,   10692629,  11805606,  13034431
];

function levelFromXp(xp) {
  if (xp == null || xp < 0) return 1;
  for (let lvl = 99; lvl >= 1; lvl--) {
    if (xp >= XP_TABLE[lvl - 1]) return lvl;
  }
  return 1;
}

// Combat level OSRS (sin ranged/magic/prayer, igual que snapshot.js):
//   base  = (def + hp) / 4
//   melee = (att + str) * 13 / 40
//   cb    = floor(base + melee)
function calcCombatLvl(stats) {
  const att = levelFromXp(stats.attack_xp);
  const str = levelFromXp(stats.strength_xp);
  const def = levelFromXp(stats.defence_xp);
  const hp  = levelFromXp(stats.hp_xp);
  const base  = (def + hp) / 4;
  const melee = (att + str) * 13 / 40;
  return Math.floor(base + melee);
}

// ============================================================
// Helper: verifica si las tablas de duel existen.
// ============================================================
async function duelTablesExist(db) {
  try {
    await db.all(`SELECT 1 FROM duels LIMIT 1`);
    await db.all(`SELECT 1 FROM duel_requests LIMIT 1`);
    return true;
  } catch {
    return false;
  }
}

// ============================================================
// Helper: duelo activo del user actual (o null).
// Usado por combat_engine.attackPlayer también — exportado.
// ============================================================
export async function getActiveDuelForUser(db, userId) {
  const row = await db.first(
    `SELECT id, user_a_id, user_b_id, started_at,
            leaving_a_at, leaving_b_at, leave_cast_ends_at, ended_at
     FROM duels
     WHERE ended_at IS NULL AND (user_a_id = ? OR user_b_id = ?)
     LIMIT 1`,
    [userId, userId]
  );
  return row || null;
}

// ============================================================
// Helper: duelo activo entre dos users específicos (o null).
// Usado por combat_engine.attackPlayer para validar PVP no-wilderness.
// ============================================================
export async function getActiveDuelBetween(db, userIdA, userIdB) {
  const [a, b] = userIdA < userIdB ? [userIdA, userIdB] : [userIdB, userIdA];
  const row = await db.first(
    `SELECT id, user_a_id, user_b_id, started_at,
            leaving_a_at, leaving_b_at, leave_cast_ends_at, ended_at
     FROM duels
     WHERE ended_at IS NULL AND user_a_id = ? AND user_b_id = ?
     LIMIT 1`,
    [a, b]
  );
  return row || null;
}

// ============================================================
// Helper: cierra duelo (soft delete con ended_at).
// Usado por combat_engine.attackPlayer al entrar wilderness o morir.
// ============================================================
export async function closeDuel(db, duelId, now) {
  await db.run(
    `UPDATE duels SET ended_at = ? WHERE id = ? AND ended_at IS NULL`,
    [now, duelId]
  );
}

// ============================================================
// Helper: cleanup lazy de invites expiradas y duelos cuyo leave terminó.
// Llamado al inicio de cada endpoint que toca el sistema.
// ============================================================
async function cleanupExpired(db, now) {
  await db.run(`DELETE FROM duel_requests WHERE expires_at < ?`, [now]);
  // Duelos con leave_cast_ends_at en el pasado → cerrar.
  await db.run(
    `UPDATE duels SET ended_at = ?
     WHERE ended_at IS NULL
       AND leave_cast_ends_at IS NOT NULL
       AND leave_cast_ends_at <= ?`,
    [now, now]
  );
}

// ============================================================
// Helper: party_id del user (defensivo, si tabla no existe → null).
// ============================================================
async function getUserPartyId(db, userId) {
  try {
    const r = await db.first(
      `SELECT party_id FROM party_members WHERE user_id = ?`, [userId]
    );
    return r?.party_id ?? null;
  } catch {
    return null;
  }
}

// ============================================================
// Helper: stats del user para calcular combat_lvl.
// ============================================================
async function getUserCombatLvl(db, userId) {
  const row = await db.first(
    `SELECT attack_xp, strength_xp, defence_xp, hp_xp
     FROM combat_stats WHERE user_id = ?`,
    [userId]
  );
  if (!row) return 3;   // sin stats todavía → lvl base 3 (OSRS noob)
  return calcCombatLvl(row);
}

// ============================================================
// GET /api/duel/state
// Devuelve:
//   - duel:        objeto duelo activo o null
//   - duel_other:  username + combat_lvl del oponente (si duel)
//   - invites_in:  requests recibidos pendientes
//   - invite_out:  tu request enviado pendiente (o null)
// ============================================================
export async function handleDuelState(request, env) {
  const session = await requireSession(request, env);
  if (!session) return json({ error: 'unauthorized' }, 401);

  const db = makeDbAdapter(env);
  if (!(await duelTablesExist(db))) {
    return json({ duel: null, duel_other: null, invites_in: [], invite_out: null });
  }

  const now = Date.now();
  await cleanupExpired(db, now);

  const userId = session.user_id;

  // ----- Duelo activo -----
  const duel = await getActiveDuelForUser(db, userId);
  let duelOther = null;
  if (duel) {
    const otherId = duel.user_a_id === userId ? duel.user_b_id : duel.user_a_id;
    const otherRow = await db.first(
      `SELECT u.id, u.username, cs.attack_xp, cs.strength_xp, cs.defence_xp, cs.hp_xp
       FROM users u
       LEFT JOIN combat_stats cs ON cs.user_id = u.id
       WHERE u.id = ?`,
      [otherId]
    );
    if (otherRow) {
      duelOther = {
        user_id: otherRow.id,
        username: otherRow.username,
        combat_lvl: calcCombatLvl(otherRow),
      };
    }
  }

  // ----- Invites recibidos -----
  const invitesIn = await db.all(
    `SELECT r.id, r.from_user_id, r.created_at, r.expires_at,
            u.username AS from_username,
            cs.attack_xp, cs.strength_xp, cs.defence_xp, cs.hp_xp
     FROM duel_requests r
     JOIN users u ON u.id = r.from_user_id
     LEFT JOIN combat_stats cs ON cs.user_id = r.from_user_id
     WHERE r.to_user_id = ? AND r.expires_at >= ?
     ORDER BY r.created_at ASC`,
    [userId, now]
  );

  const invitesInClean = invitesIn.map(r => ({
    from_user_id: r.from_user_id,
    from_username: r.from_username,
    from_combat_lvl: calcCombatLvl(r),
    expires_at: r.expires_at,
  }));

  // ----- Invite outgoing -----
  const inviteOutRow = await db.first(
    `SELECT r.to_user_id, r.created_at, r.expires_at, u.username AS to_username
     FROM duel_requests r
     JOIN users u ON u.id = r.to_user_id
     WHERE r.from_user_id = ? AND r.expires_at >= ?
     LIMIT 1`,
    [userId, now]
  );

  const inviteOut = inviteOutRow ? {
    to_user_id: inviteOutRow.to_user_id,
    to_username: inviteOutRow.to_username,
    expires_at: inviteOutRow.expires_at,
  } : null;

  return json({
    duel: duel ? {
      id: duel.id,
      user_a_id: duel.user_a_id,
      user_b_id: duel.user_b_id,
      started_at: duel.started_at,
      leaving_a_at: duel.leaving_a_at,
      leaving_b_at: duel.leaving_b_at,
      leave_cast_ends_at: duel.leave_cast_ends_at,
    } : null,
    duel_other: duelOther,
    invites_in: invitesInClean,
    invite_out: inviteOut,
  });
}

// ============================================================
// POST /api/duel/challenge   { target_user_id }
// ============================================================
export async function handleDuelChallenge(request, env) {
  const session = await requireSession(request, env);
  if (!session) return json({ error: 'unauthorized' }, 401);

  const body = await readJson(request);
  if (!body || !Number.isInteger(body.target_user_id)) {
    return json({ error: 'bad_request' }, 400);
  }

  const db = makeDbAdapter(env);
  if (!(await duelTablesExist(db))) return json({ error: 'duel_disabled' }, 503);

  const now = Date.now();
  await cleanupExpired(db, now);

  const fromId = session.user_id;
  const toId   = body.target_user_id;

  if (fromId === toId) return json({ error: 'cannot_challenge_self' }, 400);

  // Target existe?
  const targetUser = await db.first(`SELECT id, username FROM users WHERE id = ?`, [toId]);
  if (!targetUser) return json({ error: 'target_not_found' }, 404);

  // Misma party?
  const fromParty = await getUserPartyId(db, fromId);
  const toParty   = await getUserPartyId(db, toId);
  if (fromParty != null && toParty === fromParty) {
    return json({ error: 'same_party' }, 400);
  }

  // Alguno en duelo activo?
  const fromDuel = await getActiveDuelForUser(db, fromId);
  if (fromDuel) return json({ error: 'already_in_duel' }, 400);
  const toDuel = await getActiveDuelForUser(db, toId);
  if (toDuel) return json({ error: 'target_in_duel' }, 400);

  // Restricción ±10 niveles de combate.
  const fromLvl = await getUserCombatLvl(db, fromId);
  const toLvl   = await getUserCombatLvl(db, toId);
  if (Math.abs(fromLvl - toLvl) > LEVEL_GAP_MAX) {
    return json({
      error: 'level_gap_too_big',
      from_lvl: fromLvl,
      to_lvl: toLvl,
      max_gap: LEVEL_GAP_MAX,
    }, 400);
  }

  // Crear/sobreescribir request.
  // UNIQUE(from_user_id, to_user_id) ya garantiza no duplicar A→B.
  // Si ya hay una de fromId → otro target, la borramos (1 outgoing a la vez).
  await db.run(`DELETE FROM duel_requests WHERE from_user_id = ?`, [fromId]);
  // También borramos cualquier request inversa (B→A) por si el target
  // ya te había retado y aceptas implícitamente al re-retar.
  await db.run(
    `DELETE FROM duel_requests WHERE from_user_id = ? AND to_user_id = ?`,
    [toId, fromId]
  );

  await db.run(
    `INSERT INTO duel_requests (from_user_id, to_user_id, created_at, expires_at, status)
     VALUES (?, ?, ?, ?, 'pending')`,
    [fromId, toId, now, now + INVITE_TTL_MS]
  );

  return json({
    ok: true,
    target_user_id: toId,
    target_username: targetUser.username,
    expires_at: now + INVITE_TTL_MS,
  });
}

// ============================================================
// POST /api/duel/accept   { from_user_id }
// ============================================================
export async function handleDuelAccept(request, env) {
  const session = await requireSession(request, env);
  if (!session) return json({ error: 'unauthorized' }, 401);

  const body = await readJson(request);
  if (!body || !Number.isInteger(body.from_user_id)) {
    return json({ error: 'bad_request' }, 400);
  }

  const db = makeDbAdapter(env);
  if (!(await duelTablesExist(db))) return json({ error: 'duel_disabled' }, 503);

  const now = Date.now();
  await cleanupExpired(db, now);

  const meId   = session.user_id;
  const fromId = body.from_user_id;

  if (meId === fromId) return json({ error: 'bad_request' }, 400);

  // Buscar request activa.
  const req = await db.first(
    `SELECT id FROM duel_requests
     WHERE from_user_id = ? AND to_user_id = ? AND expires_at >= ?
     LIMIT 1`,
    [fromId, meId, now]
  );
  if (!req) return json({ error: 'invite_not_found' }, 404);

  // Verificar que ninguno está ya en duelo (race condition).
  const meDuel = await getActiveDuelForUser(db, meId);
  if (meDuel) {
    await db.run(`DELETE FROM duel_requests WHERE id = ?`, [req.id]);
    return json({ error: 'already_in_duel' }, 400);
  }
  const fromDuel = await getActiveDuelForUser(db, fromId);
  if (fromDuel) {
    await db.run(`DELETE FROM duel_requests WHERE id = ?`, [req.id]);
    return json({ error: 'challenger_in_duel' }, 400);
  }

  // Re-check niveles (pudieron cambiar entre challenge y accept).
  const meLvl   = await getUserCombatLvl(db, meId);
  const fromLvl = await getUserCombatLvl(db, fromId);
  if (Math.abs(meLvl - fromLvl) > LEVEL_GAP_MAX) {
    await db.run(`DELETE FROM duel_requests WHERE id = ?`, [req.id]);
    return json({ error: 'level_gap_too_big', max_gap: LEVEL_GAP_MAX }, 400);
  }

  // Re-check misma party.
  const meParty   = await getUserPartyId(db, meId);
  const fromParty = await getUserPartyId(db, fromId);
  if (meParty != null && fromParty === meParty) {
    await db.run(`DELETE FROM duel_requests WHERE id = ?`, [req.id]);
    return json({ error: 'same_party' }, 400);
  }

  // Insertar duelo (a < b para que los índices únicos parciales no
  // permitan duplicados con order invertido).
  const [a, b] = meId < fromId ? [meId, fromId] : [fromId, meId];
  try {
    await db.run(
      `INSERT INTO duels (user_a_id, user_b_id, started_at, ended_at)
       VALUES (?, ?, ?, NULL)`,
      [a, b, now]
    );
  } catch (err) {
    // Si UNIQUE WHERE ended_at IS NULL salta, alguno entró en otro
    // duelo entre nuestros checks.
    console.warn('[duel/accept] insert race:', err?.message);
    return json({ error: 'race_condition' }, 409);
  }

  // Limpiar TODAS las requests pendientes de ambos (ya no aplican).
  await db.run(
    `DELETE FROM duel_requests
     WHERE from_user_id IN (?, ?) OR to_user_id IN (?, ?)`,
    [meId, fromId, meId, fromId]
  );

  return json({ ok: true, opponent_user_id: fromId, started_at: now });
}

// ============================================================
// POST /api/duel/decline   { from_user_id }
// ============================================================
export async function handleDuelDecline(request, env) {
  const session = await requireSession(request, env);
  if (!session) return json({ error: 'unauthorized' }, 401);

  const body = await readJson(request);
  if (!body || !Number.isInteger(body.from_user_id)) {
    return json({ error: 'bad_request' }, 400);
  }

  const db = makeDbAdapter(env);
  if (!(await duelTablesExist(db))) return json({ error: 'duel_disabled' }, 503);

  const meId   = session.user_id;
  const fromId = body.from_user_id;

  await db.run(
    `DELETE FROM duel_requests WHERE from_user_id = ? AND to_user_id = ?`,
    [fromId, meId]
  );

  return json({ ok: true });
}

// ============================================================
// POST /api/duel/cancel
// Cancela TU request outgoing (si lo tienes).
// ============================================================
export async function handleDuelCancel(request, env) {
  const session = await requireSession(request, env);
  if (!session) return json({ error: 'unauthorized' }, 401);

  const db = makeDbAdapter(env);
  if (!(await duelTablesExist(db))) return json({ error: 'duel_disabled' }, 503);

  await db.run(
    `DELETE FROM duel_requests WHERE from_user_id = ?`,
    [session.user_id]
  );

  return json({ ok: true });
}

// ============================================================
// POST /api/duel/leave
// Inicia el cast de 5s para salir de combate.
// Una vez iniciado:
//   - NO se cancela.
//   - Sigue corriendo aunque te peguen.
//   - Al cumplirse leave_cast_ends_at, el duelo se cierra (cleanup lazy).
//   - Si mueres antes → muerte normal PVP con drop (gestionado en combat_engine).
// ============================================================
export async function handleDuelLeave(request, env) {
  const session = await requireSession(request, env);
  if (!session) return json({ error: 'unauthorized' }, 401);

  const db = makeDbAdapter(env);
  if (!(await duelTablesExist(db))) return json({ error: 'duel_disabled' }, 503);

  const now = Date.now();
  await cleanupExpired(db, now);

  const meId = session.user_id;
  const duel = await getActiveDuelForUser(db, meId);
  if (!duel) return json({ error: 'not_in_duel' }, 400);

  // Ya está casteando?
  const isA = duel.user_a_id === meId;
  const myLeavingAt = isA ? duel.leaving_a_at : duel.leaving_b_at;
  if (myLeavingAt != null) {
    // Ya cast en progreso → devolver estado, no reiniciar.
    return json({
      ok: true,
      already_casting: true,
      leave_cast_ends_at: duel.leave_cast_ends_at,
    });
  }

  const endsAt = now + LEAVE_CAST_MS;
  if (isA) {
    await db.run(
      `UPDATE duels SET leaving_a_at = ?, leave_cast_ends_at = ? WHERE id = ?`,
      [now, endsAt, duel.id]
    );
  } else {
    await db.run(
      `UPDATE duels SET leaving_b_at = ?, leave_cast_ends_at = ? WHERE id = ?`,
      [now, endsAt, duel.id]
    );
  }

  return json({
    ok: true,
    leave_cast_ends_at: endsAt,
    cast_duration_ms: LEAVE_CAST_MS,
  });
}
