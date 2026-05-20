/**
 * SebasPresent — World Snapshot client (Sesión 27, Bloque 1 PVP)
 *
 * Polea GET /api/world/snapshot?x=&z= cada 250ms (4 ticks/sec) y mantiene
 * el último snapshot en memoria. Otros módulos consultan vía getters.
 *
 * Bloque 1: este módulo vive en paralelo con multiplayer.js y npc_renderer.js.
 * NO sustituye sus pollings. Sirve para validar que el endpoint server
 * responde correctamente con timestamp + players + NPCs.
 *
 * Bloque 2 (futuro): multiplayer.js y npc_renderer.js leerán de aquí
 * en vez de hacer sus propios fetches. Pollings antiguos mueren entonces.
 *
 * Sesión 28:
 *   - FIX: `me` (last_attacker, party_id, duel, duel_invites_in,
 *     duel_invite_out) ahora SÍ se persiste en lastSnapshot. En S27 el
 *     campo se leía pero nunca se asignaba — auto-retaliate quedaba
 *     silenciosamente devolviendo {}.
 *   - HOOK: tras cada snapshot fresco, llamamos duel.onSnapshotMe(me)
 *     para que el módulo duel.js actualice HUD/invites sin polling
 *     separado.
 *
 * Uso desde world.js:
 *
 *   import * as worldSnapshot from './world_snapshot.js';
 *
 *   worldSnapshot.start({
 *     getPlayer:   () => player,
 *     getAuthToken: () => authToken,
 *     apiBase:     API_BASE,
 *   });
 *
 *   // En animate():
 *   worldSnapshot.update(dt);
 *
 *   // Al salir del mundo:
 *   worldSnapshot.stop();
 *
 * Debug en consola (Eruda):
 *   window.__snapshotDebug()         → último snapshot completo
 *   window.__snapshotDebug.peers()   → solo players cercanos
 *   window.__snapshotDebug.npcs()    → solo NPCs cercanos
 *   window.__snapshotDebug.me()      → solo bloque me (Sesión 28)
 *   window.__snapshotDebug.lag()     → ms entre server.now y client.recv
 */

import * as duel from './duel.js';   // Sesión 28 — hook onSnapshotMe

const SNAPSHOT_POLL_INTERVAL_MS = 250;   // 4 ticks/sec, según plan Bloque 1
const SNAPSHOT_STALE_AFTER_MS   = 5_000; // tras esto consideramos stale

// ============================================================
// Estado del módulo (privado)
// ============================================================
let getPlayer = null;
let getAuthToken = null;
let apiBase = null;

let pollTimer = 0;
let inFlight = false;
let started = false;

// Último snapshot recibido. Estructura:
// { now, players: [...], npcs: [...], me: {...}, _receivedAt, _serverLagMs }
let lastSnapshot = null;
let lastError = null;

// Sesión 32 — tracking del último hit recibido procesado. Usado por
// handleIncomingHit() para no spawnear el mismo splat 2 veces. Se resetea
// al start/stop del polling.
let _lastProcessedHitAt = 0;

// ============================================================
// API pública
// ============================================================

export function start(opts) {
  if (started) {
    console.warn('[world_snapshot] start() llamado dos veces sin stop()');
    stop();
  }
  getPlayer     = opts.getPlayer;
  getAuthToken  = opts.getAuthToken;
  apiBase       = opts.apiBase;
  pollTimer     = 0;
  inFlight      = false;
  lastSnapshot  = null;
  lastError     = null;
  started       = true;
  _lastProcessedHitAt = 0;  // Sesión 32 — reset al arrancar el mundo

  // Hooks de debug en window (Eruda)
  if (typeof window !== 'undefined') {
    const dbg = () => lastSnapshot;
    dbg.peers     = () => lastSnapshot?.players || [];
    dbg.npcs      = () => lastSnapshot?.npcs    || [];
    dbg.me        = () => lastSnapshot?.me      || {};   // Sesión 28
    dbg.lag       = () => lastSnapshot?._serverLagMs ?? null;
    dbg.lastError = () => lastError;
    window.__snapshotDebug = dbg;
  }

  console.log('[world_snapshot] started, polling each', SNAPSHOT_POLL_INTERVAL_MS, 'ms');
}

export function stop() {
  if (!started) return;
  started      = false;
  getPlayer    = null;
  getAuthToken = null;
  apiBase      = null;
  pollTimer    = 0;
  inFlight     = false;
  lastSnapshot = null;
  lastError    = null;
  _lastProcessedHitAt = 0;  // Sesión 32
  if (typeof window !== 'undefined' && window.__snapshotDebug) {
    delete window.__snapshotDebug;
  }
}

/**
 * Llamar desde el loop de animación. dt en segundos.
 */
export function update(dt) {
  if (!started) return;
  pollTimer += dt * 1000;
  if (pollTimer >= SNAPSHOT_POLL_INTERVAL_MS && !inFlight) {
    pollTimer = 0;
    fetchSnapshot();
  }
}

/**
 * Devuelve el último snapshot completo, o null si todavía no llegó ninguno
 * o si está stale (>5s sin actualizar).
 */
export function getSnapshot() {
  if (!lastSnapshot) return null;
  if (Date.now() - lastSnapshot._receivedAt > SNAPSHOT_STALE_AFTER_MS) return null;
  return lastSnapshot;
}

/**
 * Devuelve solo el array de players cercanos del último snapshot.
 * Devuelve [] si no hay snapshot fresco.
 */
export function getPlayers() {
  const s = getSnapshot();
  return s ? s.players : [];
}

/**
 * Devuelve solo el array de NPCs cercanos del último snapshot.
 * Devuelve [] si no hay snapshot fresco.
 */
export function getNpcs() {
  const s = getSnapshot();
  return s ? s.npcs : [];
}

/**
 * Sesión 27 Bloque 3 + Sesión 28 — Devuelve info del propio user que
 * viene en el snapshot.
 *
 * Estructura:
 *   {
 *     last_attacker: { type: 0|1, id, at } | null,
 *     party_id: number | null,
 *     duel: { id, opponent_user_id, opponent_username, opponent_combat_lvl,
 *             started_at, my_leaving_at, opponent_leaving_at,
 *             leave_cast_ends_at } | null,
 *     duel_invites_in: [{ from_user_id, from_username, from_combat_lvl, expires_at }],
 *     duel_invite_out: { to_user_id, to_username, expires_at } | null
 *   }
 *
 * Devuelve {} si no hay snapshot fresco (no null, para que el cliente
 * pueda leer .last_attacker?.type sin chequear).
 */
export function getMe() {
  const s = getSnapshot();
  return s?.me || {};
}

/**
 * Devuelve el timestamp del server del último snapshot (ms epoch),
 * o null si no hay snapshot fresco. Útil para lag compensation.
 */
export function getServerNow() {
  const s = getSnapshot();
  return s ? s.now : null;
}

/**
 * Lag estimado entre server.now y client.received (one-way, aprox).
 * Útil para debug. null si no hay snapshot.
 */
export function getLagMs() {
  return lastSnapshot?._serverLagMs ?? null;
}

// ============================================================
// Polling interno
// ============================================================
async function fetchSnapshot() {
  if (!apiBase || !getAuthToken || !getPlayer) return;
  const token = getAuthToken();
  if (!token) return;
  const player = getPlayer();
  if (!player) return;

  inFlight = true;
  try {
    const x = player.position.x.toFixed(2);
    const z = player.position.z.toFixed(2);
    const sentAt = Date.now();
    const res = await fetch(
      `${apiBase}/api/world/snapshot?x=${x}&z=${z}`,
      {
        headers: { 'Authorization': 'Bearer ' + token },
        // Sesión 32 — bypass cache HTTP del navegador. Sin esto, algunos
        // browsers cachean respuestas del endpoint y el cliente ve un
        // snapshot stale aunque el server tenga datos frescos (typical bug
        // tras deploy del server: el cliente recibe la respuesta vieja).
        cache: 'no-store',
      }
    );
    const receivedAt = Date.now();
    if (!res.ok) {
      lastError = { status: res.status, ts: receivedAt };
      return;
    }
    const data = await res.json();
    if (!data || typeof data.now !== 'number') {
      lastError = { reason: 'malformed_response', ts: receivedAt };
      return;
    }
    // Lag aproximado: cuánto pasó entre server.now y nuestro recv. Esto
    // incluye latencia de red ida+vuelta + cualquier offset de reloj.
    const serverLagMs = receivedAt - data.now;
    lastSnapshot = {
      now: data.now,
      players: Array.isArray(data.players) ? data.players : [],
      npcs:    Array.isArray(data.npcs)    ? data.npcs    : [],
      me:      data.me || {},          // Sesión 28 FIX — antes se perdía
      // Sesión 32 FIX — antes el cliente descartaba estos campos aunque
      // el server los enviara, porque solo se copiaban explícitamente los
      // campos viejos. Por eso firemaking/woodcutting nunca veían los datos
      // server-side. Bug encontrado al debuggear el tocón que no aparecía.
      fires:           Array.isArray(data.fires)          ? data.fires          : [],
      depleted_trees:  Array.isArray(data.depleted_trees) ? data.depleted_trees : [],
      _sentAt: sentAt,
      _receivedAt: receivedAt,
      _serverLagMs: serverLagMs,
    };
    lastError = null;

    // Sesión 28 — Hook a duel.js para que actualice HUD + invites con
    // los datos frescos sin polling separado. Defensivo: si duel.start()
    // todavía no se llamó, onSnapshotMe simplemente no hace nada.
    try {
      duel.onSnapshotMe(lastSnapshot.me);
    } catch (err) {
      console.warn('[world_snapshot] duel.onSnapshotMe error:', err?.message);
    }

    // Sesión 32 — Detectar hits recibidos vía snapshot y disparar splat +
    // anim de reacción. Usado cuando un peer te ataca sin que vos hayas
    // iniciado el combate. Sin esto ves HP bajar pero no ves feedback.
    try {
      handleIncomingHit(lastSnapshot.me);
    } catch (err) {
      console.warn('[world_snapshot] handleIncomingHit error:', err?.message);
    }
  } catch (err) {
    lastError = { reason: 'fetch_failed', message: err?.message, ts: Date.now() };
  } finally {
    inFlight = false;
  }
}

// ============================================================
// Sesión 32 — Procesamiento de hits recibidos vía snapshot
// ============================================================
//
// last_hit_at funciona como ID único del hit. Si llega uno nuevo (timestamp
// distinto al que ya procesamos), spawn splat + anim de reacción. Si llega
// el mismo, ignora (snapshot polled de nuevo sin nuevo hit).
//
// Ignoramos hits con age > 3s para que un re-login no spawnee el splat de
// un hit viejo.
function handleIncomingHit(me) {
  if (!me) return;
  const hitAt = me.last_hit_at;
  if (!hitAt || typeof hitAt !== 'number') return;
  if (hitAt <= _lastProcessedHitAt) return;  // ya procesado

  const age = Date.now() - hitAt;
  if (age > 3000) {
    _lastProcessedHitAt = hitAt;  // marcar como procesado igual
    return;
  }

  _lastProcessedHitAt = hitAt;

  const damage = me.last_hit_damage || 0;

  // 1) Spawn del hitsplat sobre el player local
  try {
    if (typeof window.__spawnPlayerSplat === 'function') {
      window.__spawnPlayerSplat(damage, damage > 0);
    }
  } catch {}

  // 2) Anim de reacción (Reaction.fbx) — el char hace un flinch
  try {
    if (typeof window.__playerReact === 'function') {
      window.__playerReact();
    }
  } catch {}

  // 3) Feed log
  try {
    if (typeof window.__feedLog === 'function' && damage > 0) {
      const fromId = me.last_hit_from_user_id;
      const peer = lastSnapshot?.players?.find?.(p => p.user_id === fromId);
      const attackerName = peer?.username || 'Otro jugador';
      const isCrit = me.last_hit_is_crit === 1;
      const msg = isCrit
        ? `⚡ ¡${attackerName} te hace un CRÍTICO! ${damage} HP.`
        : `${attackerName} te pega ${damage} HP.`;
      window.__feedLog('player-hit', msg);
    }
  } catch {}
}
