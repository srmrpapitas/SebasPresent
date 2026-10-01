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

import { maxSpeed, SPEED_TOLERANCE, BURST_MAX_M, WARP_WINDOW_MS, WARP_NEAR_M, LOGIN_NEAR_M } from '../client/src/shared/movement.js';
import { combatLevelFrom } from '../client/src/shared/mounts.js';

const WORLD_HALF = 2048;
const FIX_MIN_MS = 400;          // no mandar correcciones más a menudo que esto
const LEVEL_RECHECK_MS = 20_000;
// Tabla de XP de OSRS (nivel a partir de la experiencia)
function xpToLevel(xp) {
  let pts = 0;
  for (let lvl = 1; lvl < 99; lvl++) {
    pts += Math.floor(lvl + 300 * Math.pow(2, lvl / 7));
    if (Math.floor(pts / 4) > xp) return lvl;
  }
  return 99;
}
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
    // Sesión 50 — anti speed hack: punto de partida fiable y monturas que tiene
    const anchor = await this.loadAnchor(uid);
    const mnt = await this.loadMounts(uid);
    server.serializeAttachment({ uid, name, x: null, z: null, y: 0, s: 'idle', w: 0, ws: '',
      vx: null, vz: null, vt: 0, ax: anchor.x, az: anchor.z, bud: BURST_MAX_M, own: mnt.own, fly: mnt.fly, lvlAt: Date.now(), fixAt: 0, viol: 0 });

    // Estado actual de los demás, para pintarlos al momento
    const peers = [];
    for (const w of this.ctx.getWebSockets()) {
      if (w === server) continue;
      const a = w.deserializeAttachment();
      if (a && a.x != null) peers.push({ id: a.uid, x: a.x, z: a.z, y: a.y, s: a.s, m: a.m || '' });
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
      const mt = (m.m === 'caballo' || m.m === 'pardela') ? m.m : '';   // Sesión 50 — montura
      // Sesión 50 — ¿movimiento posible? Si no, no se acepta y se le corrige.
      const nowV = Date.now();
      if (!(await this.validMove(ws, a, x, z, mt, nowV))) return;
      const prevS = a.s;
      a.x = Math.round(x * 100) / 100;
      a.z = Math.round(z * 100) / 100;
      a.y = Math.round(y * 1000) / 1000;
      a.s = s;
      a.m = mt;
      this.broadcast(JSON.stringify({ t: 'p', id: a.uid, x: a.x, z: a.z, y: a.y, s, m: mt }), ws);

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

  // ------------------------------------------------------------
  // Sesión 50 — Validación de movimiento (anti speed hack / teleport hack)
  // ------------------------------------------------------------
  async loadAnchor(uid) {
    try {
      const now = Date.now();
      const o = await this.env.DB.prepare('SELECT x, z, last_seen FROM online_users WHERE user_id = ?').bind(uid).first();
      if (o && now - o.last_seen < 60_000) return { x: o.x, z: o.z };
      const u = await this.env.DB.prepare('SELECT last_x, last_z FROM users WHERE id = ?').bind(uid).first();
      return { x: u?.last_x ?? 0, z: u?.last_z ?? 0 };
    } catch { return { x: null, z: null }; }
  }

  async loadMounts(uid) {
    try {
      const rows = (await this.env.DB.prepare('SELECT mount_id FROM user_mounts WHERE user_id = ?').bind(uid).all()).results || [];
      const sk = (await this.env.DB.prepare(`SELECT skill_id, xp FROM user_skills WHERE user_id = ? AND skill_id IN ('attack','strength','defence','hitpoints')`).bind(uid).all()).results || [];
      const lv = {}; for (const r of sk) lv[r.skill_id] = xpToLevel(r.xp || 0);
      const cb = combatLevelFrom(lv.attack || 1, lv.strength || 1, lv.defence || 1, lv.hitpoints || 10);
      return { own: rows.map(r => r.mount_id), fly: cb >= 25 };
    } catch { return { own: [], fly: false }; }
  }

  /** Salto autorizado reciente por el servidor (teletransporte, respawn, Fosa…) */
  async nearWarp(uid, x, z, now) {
    try {
      const w = await this.env.DB.prepare('SELECT warp_x, warp_z, warp_at FROM users WHERE id = ?').bind(uid).first();
      return !!(w && w.warp_at && now - w.warp_at < WARP_WINDOW_MS && Math.hypot(x - w.warp_x, z - w.warp_z) <= WARP_NEAR_M);
    } catch { return false; }
  }

  async validMove(ws, a, x, z, mt, now) {
    // Primera posición de la conexión: tiene que estar donde le dejamos
    if (a.vx == null) {
      const ok = a.ax == null || Math.hypot(x - a.ax, z - a.az) <= LOGIN_NEAR_M || await this.nearWarp(a.uid, x, z, now);
      if (ok) { a.vx = x; a.vz = z; a.vt = now; return true; }
      return this.reject(ws, a, now, a.ax, a.az);
    }
    // Cubo de fichas: el permiso de distancia se acumula a la velocidad máxima
    // (con margen) hasta BURST_MAX_M. La media nunca pasa de vmax·TOL y los
    // tirones de red (mensajes juntos y luego un hueco) no penalizan.
    const dt = Math.min(10, Math.max(0, (now - a.vt) / 1000));
    const dist = Math.hypot(x - a.vx, z - a.vz);
    const owns = mt && a.own?.includes(mt);
    let vmax = maxSpeed(owns ? mt : null, a.fly);
    // ¿Subió de nivel y ya vuela? (se vuelve a mirar como mucho cada 20 s)
    if (owns && mt === 'pardela' && !a.fly && dist > (a.bud ?? 0) + vmax * SPEED_TOLERANCE * dt && now - (a.lvlAt || 0) > LEVEL_RECHECK_MS) {
      a.lvlAt = now;
      const mnt = await this.loadMounts(a.uid);
      a.own = mnt.own; a.fly = mnt.fly;
      vmax = maxSpeed(mt, a.fly);
    }
    const bucket = Math.min(BURST_MAX_M, (a.bud ?? BURST_MAX_M) + vmax * SPEED_TOLERANCE * dt);
    a.vt = now;
    if (dist <= bucket) {
      a.bud = bucket - dist;
      a.vx = x; a.vz = z;
      return true;
    }
    a.bud = bucket;
    if (await this.nearWarp(a.uid, x, z, now)) {
      a.vx = x; a.vz = z; a.bud = BURST_MAX_M;
      return true;
    }
    return this.reject(ws, a, now, a.vx, a.vz);
  }

  reject(ws, a, now, fx, fz) {
    a.viol = (a.viol || 0) + 1;
    if (fx != null && now - (a.fixAt || 0) >= FIX_MIN_MS) {
      a.fixAt = now;
      try { ws.send(JSON.stringify({ t: 'fix', x: fx, z: fz })); } catch {}
    }
    if (a.viol % 50 === 1) console.warn(`[realm] movimiento rechazado uid=${a.uid} (${a.viol})`);
    ws.serializeAttachment(a);
    return false;
  }

  broadcast(str, except) {
    for (const w of this.ctx.getWebSockets()) {
      if (w === except) continue;
      try { w.send(str); } catch {}
    }
  }
}
