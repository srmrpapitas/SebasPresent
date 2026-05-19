/**
 * SebasPresent — Chat handlers (Sesión 29)
 *
 * Sistema de chat global con polling cliente cada ~2.5s.
 *
 * Endpoints:
 *   POST /api/chat/send    { message, channel? = 'global' }
 *   GET  /api/chat/recent?since=<ts>&channel=global
 *
 * Reglas:
 *   - Rate limit: 5 mensajes / 10s por user. Si excede → 429 rate_limited.
 *   - Longitud máxima: 200 chars (después de trim). Vacío → 400 empty_message.
 *   - Channel solo 'global' por ahora (whitelist). Futuro: 'party', 'whisper'.
 *   - Username denormalizado en la fila (snapshot del nombre en el momento
 *     del envío). No hace JOIN al servir, más barato.
 *   - Sanitización: server NO hace HTML escape. El cliente DEBE usar
 *     textContent al renderizar (no innerHTML), o escaparlo manualmente.
 *   - Si la tabla no existe → 'chat_disabled' (compat con reset D1 al estilo
 *     party_disabled / duel_disabled). El cliente esconde el HUD.
 *
 * Schema D1 (creado manualmente en consola, Sesión 29):
 *   chat_messages (id, user_id, username, channel, message, sent_at)
 *   + idx_chat_messages_channel_sent (channel, sent_at DESC)
 *   + idx_chat_messages_user_sent (user_id, sent_at)
 *
 * Cleanup: cron borra mensajes > 24h cada minuto (handlers/cron.js).
 */
import { json, readJson, makeDbAdapter } from '../lib/db.js';
import { requireSession } from '../lib/auth.js';

const MAX_MESSAGE_LENGTH    = 200;
const RATE_LIMIT_WINDOW_MS  = 10_000;
const RATE_LIMIT_MAX        = 5;
const ALLOWED_CHANNELS      = new Set(['global']);
const RECENT_DEFAULT_LIMIT  = 30;   // sin ?since → últimos N
const RECENT_SINCE_LIMIT    = 50;   // con ?since → tope por request

// ============================================================
// Helper: ¿existe la tabla chat_messages?
// ============================================================
async function chatTablesExist(db) {
  try {
    await db.all(`SELECT 1 FROM chat_messages LIMIT 1`);
    return true;
  } catch {
    return false;
  }
}

// ============================================================
// POST /api/chat/send  { message, channel? }
// ============================================================
export async function handleChatSend(request, env) {
  const session = await requireSession(request, env);
  if (!session) return json({ error: 'unauthorized' }, 401);

  const db = makeDbAdapter(env);
  if (!(await chatTablesExist(db))) {
    return json({ error: 'chat_disabled' }, 503);
  }

  const body = await readJson(request);
  if (!body) return json({ error: 'invalid_body' }, 400);

  let message = body.message;
  let channel = body.channel;

  // ----- Validación message -----
  if (typeof message !== 'string') {
    return json({ error: 'invalid_message' }, 400);
  }
  message = message.trim();
  if (message.length === 0) {
    return json({ error: 'empty_message' }, 400);
  }
  if (message.length > MAX_MESSAGE_LENGTH) {
    return json({ error: 'message_too_long', max: MAX_MESSAGE_LENGTH }, 400);
  }

  // ----- Validación channel -----
  channel = (typeof channel === 'string' && channel.length > 0) ? channel : 'global';
  if (!ALLOWED_CHANNELS.has(channel)) {
    return json({ error: 'invalid_channel' }, 400);
  }

  const now = Date.now();

  // ----- Rate limit (5 msg / 10s por user) -----
  const rateCutoff = now - RATE_LIMIT_WINDOW_MS;
  const rateRow = await db.first(
    `SELECT COUNT(*) AS cnt FROM chat_messages
     WHERE user_id = ? AND sent_at > ?`,
    [session.user_id, rateCutoff]
  );
  if (rateRow && rateRow.cnt >= RATE_LIMIT_MAX) {
    return json({
      error: 'rate_limited',
      retry_after_ms: RATE_LIMIT_WINDOW_MS,
      max: RATE_LIMIT_MAX,
    }, 429);
  }

  // ----- Username (snapshot en el momento del envío) -----
  const userRow = await db.first(
    `SELECT username FROM users WHERE id = ?`,
    [session.user_id]
  );
  if (!userRow) return json({ error: 'user_not_found' }, 404);

  // ----- Insert -----
  const result = await db.run(
    `INSERT INTO chat_messages (user_id, username, channel, message, sent_at)
     VALUES (?, ?, ?, ?, ?)`,
    [session.user_id, userRow.username, channel, message, now]
  );

  return json({
    ok: true,
    id: result?.meta?.last_row_id ?? null,
    username: userRow.username,
    channel,
    message,
    sent_at: now,
  });
}

// ============================================================
// GET /api/chat/recent?since=<ts>&channel=global
//
// Devuelve mensajes en orden cronológico ASC para que el cliente los
// pueda hacer .append directo. server_now permite al cliente actualizar
// su cursor `since` sin depender de su reloj local.
// ============================================================
export async function handleChatRecent(request, env) {
  const session = await requireSession(request, env);
  if (!session) return json({ error: 'unauthorized' }, 401);

  const db = makeDbAdapter(env);
  const now = Date.now();
  if (!(await chatTablesExist(db))) {
    return json({ messages: [], server_now: now, chat_disabled: true });
  }

  const url = new URL(request.url);
  let channel = url.searchParams.get('channel') || 'global';
  if (!ALLOWED_CHANNELS.has(channel)) {
    return json({ error: 'invalid_channel' }, 400);
  }
  const sinceParam = url.searchParams.get('since');
  const since = sinceParam != null ? Number(sinceParam) : NaN;

  let rows;
  if (Number.isFinite(since) && since > 0) {
    // Solo mensajes nuevos desde el cursor del cliente. ASC para append.
    rows = await db.all(
      `SELECT id, user_id, username, message, sent_at
       FROM chat_messages
       WHERE channel = ? AND sent_at > ?
       ORDER BY sent_at ASC
       LIMIT ?`,
      [channel, since, RECENT_SINCE_LIMIT]
    );
  } else {
    // Sin cursor: últimos N en orden cronológico ASC.
    // Hacemos DESC LIMIT N (usa el índice) y luego reverse() en memoria.
    const desc = await db.all(
      `SELECT id, user_id, username, message, sent_at
       FROM chat_messages
       WHERE channel = ?
       ORDER BY sent_at DESC
       LIMIT ?`,
      [channel, RECENT_DEFAULT_LIMIT]
    );
    rows = desc.reverse();
  }

  return json({
    messages: rows.map(r => ({
      id:       r.id,
      user_id:  r.user_id,
      username: r.username,
      message:  r.message,
      sent_at:  r.sent_at,
    })),
    server_now: now,
  });
}
