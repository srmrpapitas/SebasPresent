/**
 * SebasPresent — Realm: canal en tiempo real (Durable Object + WebSocket)
 * Sesión 50
 *
 * Por qué: con polling HTTP cada cliente hacía ~7 peticiones/segundo
 * (heartbeat 2/s, snapshot 2-4/s, suelo, chat...) y el plan gratuito de
 * Cloudflare se acababa jugando dos personas. Por WebSocket:
 *   - Los mensajes que MANDA el cliente cuentan 1/20 de petición.
 *   - Los que envía el servidor NO cuentan.
 *   - Con la API de hibernación el objeto no gasta mientras nadie habla.
 *
 * Qué pasa por aquí:
 *   Cliente → Realm:  {t:'p', x, z, y, s, c}   posición (y = yaw, s = estado, c = en combate)
 *   Realm → otros:    {t:'p', id, x, z, y, s}  al instante
 *   Worker → Realm:   POST /event {msg}        eventos del servidor (golpes PvP,
 *                                              curas al comer, cambios de equipo...)
 *   Realm → todos:    ese msg
 *
 * La posición se sigue guardando en D1 (online_users) porque los handlers
 * (combate, minería, pesca...) validan distancias con ella. Se escribe con
 * límite: cada 1.5 s si te mueves, cada 0.5 s en combate, cada 5 s quieto.
 */

const WORLD_HALF = 2048;
const WRITE_MOVING_MS = 1500;
const WRITE_COMBAT_MS = 500;
const WRITE_IDLE_MS = 5000;

export class Realm {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
  }

  async fetch(request) {
    const url = new URL(request.url);

    // Evento interno desde el Worker → reenviar a todos los conectados
    if (url.pathname === '/event' && request.method === 'POST') {
      let body = null;
      try { body = await request.json(); } catch {}
      if (body?.msg) this.broadcast(JSON.stringify(body.msg), null);
      return new Response('ok');
    }

    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('expected websocket', { status: 426 });
    }
    const uid = Number(request.headers.get('x-uid'));
    const name = request.headers.get('x-name') || '';
    if (!uid) return new Response('no uid', { status: 400 });

    // Un solo socket por jugador (si recarga la página, se cierra el viejo)
    for (const old of this.ctx.getWebSockets(String(uid))) {
      try { old.close(4000, 'replaced'); } catch {}
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server, [String(uid)]);
    server.serializeAttachment({ uid, name, x: null, z: null, y: 0, s: 'idle', w: 0, ws: '' });

    // Estado actual de los demás, para pintarlos al momento
    const peers = [];
    for (const w of this.ctx.getWebSockets()) {
      if (w === server) continue;
      const a = w.deserializeAttachment();
      if (a && a.x != null) peers.push({ id: a.uid, x: a.x, z: a.z, y: a.y, s: a.s });
    }
    server.send(JSON.stringify({ t: 'hello', you: uid, peers }));
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws, raw) {
    if (typeof raw !== 'string' || raw.length > 512) return;
    let m;
    try { m = JSON.parse(raw); } catch { return; }
    const a = ws.deserializeAttachment();
    if (!a) return;

    if (m.t === 'p') {
      const x = Number(m.x), z = Number(m.z), y = Number(m.y) || 0;
      if (!Number.isFinite(x) || !Number.isFinite(z)) return;
      if (Math.abs(x) > WORLD_HALF + 5 || Math.abs(z) > WORLD_HALF + 5) return;
      const s = m.s === 'run' ? 'run' : 'idle';
      const prevS = a.s;
      a.x = Math.round(x * 100) / 100;
      a.z = Math.round(z * 100) / 100;
      a.y = Math.round(y * 1000) / 1000;
      a.s = s;
      this.broadcast(JSON.stringify({ t: 'p', id: a.uid, x: a.x, z: a.z, y: a.y, s }), ws);

      // Guardar en D1 con límite de frecuencia
      const now = Date.now();
      const since = now - (a.w || 0);
      const limit = m.c ? WRITE_COMBAT_MS : (s === 'run' ? WRITE_MOVING_MS : WRITE_IDLE_MS);
      if (since >= limit || s !== prevS) {
        a.w = now;
        ws.serializeAttachment(a);
        try {
          await this.env.DB.prepare(
            `INSERT INTO online_users (user_id, username, x, z, yaw, state, last_seen)
             VALUES (?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(user_id) DO UPDATE SET
               x = excluded.x, z = excluded.z, yaw = excluded.yaw,
               state = excluded.state, last_seen = excluded.last_seen`
          ).bind(a.uid, a.name || `user${a.uid}`, a.x, a.z, a.y, s, now).run();
        } catch (err) {
          console.error('[realm] online_users write:', err?.message);
        }
      } else {
        ws.serializeAttachment(a);
      }
    } else if (m.t === 'ping') {
      try { ws.send('{"t":"pong"}'); } catch {}
    }
  }

  async webSocketClose(ws) { this.left(ws); }
  async webSocketError(ws) { this.left(ws); }

  left(ws) {
    const a = ws.deserializeAttachment();
    // Si el mismo jugador ya tiene otro socket (recargó la página), no avisar
    const still = a ? this.ctx.getWebSockets(String(a.uid)).some(w => w !== ws) : false;
    if (a && !still) this.broadcast(JSON.stringify({ t: 'bye', id: a.uid }), ws);
    try { ws.close(1000, 'bye'); } catch {}
  }

  broadcast(str, except) {
    for (const w of this.ctx.getWebSockets()) {
      if (w === except) continue;
      try { w.send(str); } catch {}
    }
  }
}
