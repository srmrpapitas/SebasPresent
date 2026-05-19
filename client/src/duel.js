/**
 * SebasPresent — Duel module (cliente)
 *
 * Sesión 28 — Sistema de duelos PVP fuera del wilderness.
 *
 * Diseño:
 *   - NO hace polling propio. Se alimenta de world_snapshot.getMe() que
 *     ya trae me.duel, me.duel_invites_in, me.duel_invite_out (snapshot
 *     refresca cada 250ms server-side, suficiente para todos los HUDs).
 *   - Se suscribe al snapshot vía world_snapshot.subscribe() — patrón
 *     similar a party.js pero sin pollTimer propio.
 *
 * Responsabilidades:
 *   - Toast de invitación recibida con Aceptar / Rechazar / Ignorar.
 *   - HUD "🛡 Salir de combate" top-center cuando hay duelo activo.
 *     Click → POST /api/duel/leave → cast 5s con barra de progreso.
 *     No cancelable, sigue corriendo aunque te peguen.
 *   - Helpers para multiplayer.js / combat.js / world.js:
 *       duel.getActiveDuel()       → objeto duel o null
 *       duel.getOpponentId()       → user_id del oponente o null
 *       duel.isInDuelWith(userId)  → boolean
 *       duel.canAttack(userId)     → boolean (true si es oponente del duelo)
 *       duel.challengeUser(userId, username) → llama API + feedback
 */

import * as api from './api.js';

let started = false;
let myUserId = null;
let _feedLogFn = null;
let cssInjected = false;
let toastEl = null;
let hudEl = null;
let hudBarEl = null;
let hudLabelEl = null;
let hudInterval = null;
let lastDuel = null;
let lastInvitesIn = [];
let lastInviteOut = null;
let shownInviteIds = new Set();   // "from_user_id:expires_at" para no repetir toast
let leaveInFlight = false;

// ============================================================
// API pública
// ============================================================
export async function start({ userId, feedLog } = {}) {
  if (started) return;
  _feedLogFn = typeof feedLog === 'function' ? feedLog : (() => {});
  ensureCss();

  if (userId != null) {
    myUserId = userId;
  } else {
    try {
      const m = await api.me();
      myUserId = m?.user?.id || null;
    } catch {
      myUserId = null;
    }
  }
  started = true;
}

export function stop() {
  closeToast();
  removeHud();
  if (hudInterval) { clearInterval(hudInterval); hudInterval = null; }
  started = false;
  myUserId = null;
  lastDuel = null;
  lastInvitesIn = [];
  lastInviteOut = null;
  shownInviteIds.clear();
}

/**
 * Llamado por world_snapshot cada vez que llega un snapshot fresco.
 * Recibe me = { duel, duel_invites_in, duel_invite_out, ... }.
 */
export function onSnapshotMe(me) {
  if (!started || !me) return;

  // ----- Duelo activo -----
  const prev = lastDuel;
  lastDuel = me.duel || null;

  // Eventos de transición.
  if (!prev && lastDuel) {
    // Duelo empezó.
    _feedLogFn?.('info', `Duelo iniciado contra ${lastDuel.opponent_username} (lvl ${lastDuel.opponent_combat_lvl}).`);
    showHud();
  } else if (prev && !lastDuel) {
    // Duelo terminó.
    _feedLogFn?.('info', 'Duelo finalizado.');
    removeHud();
  }
  if (lastDuel) updateHud();

  // ----- Invites recibidas -----
  lastInvitesIn = Array.isArray(me.duel_invites_in) ? me.duel_invites_in : [];
  for (const inv of lastInvitesIn) {
    const key = `${inv.from_user_id}:${inv.expires_at}`;
    if (!shownInviteIds.has(key)) {
      shownInviteIds.add(key);
      showInviteToast(inv);
    }
  }
  // Limpiar IDs de invites que ya no aparecen.
  const liveKeys = new Set(lastInvitesIn.map(i => `${i.from_user_id}:${i.expires_at}`));
  for (const k of [...shownInviteIds]) {
    if (!liveKeys.has(k)) shownInviteIds.delete(k);
  }

  // ----- Invite outgoing (info, no UI directa por ahora) -----
  lastInviteOut = me.duel_invite_out || null;
}

export function getActiveDuel() {
  return lastDuel;
}

export function getOpponentId() {
  return lastDuel?.opponent_user_id ?? null;
}

export function isInDuelWith(userId) {
  return lastDuel != null && lastDuel.opponent_user_id === userId;
}

export function inAnyDuel() {
  return lastDuel != null;
}

/**
 * ¿Puedo atacar a este user fuera del wilderness?
 * Solo si tengo duelo activo con él.
 */
export function canAttack(userId) {
  return isInDuelWith(userId);
}

/**
 * Reta a un user a duelo. Modal de confirmación + llamada API + feedback.
 * Llamado desde multiplayer.js action menu ("Retar a duelo").
 */
export async function challengeUser(targetUserId, targetUsername) {
  if (!started) return;
  if (lastDuel) {
    _feedLogFn?.('warning', 'Ya estás en un duelo.');
    return;
  }
  if (lastInviteOut) {
    _feedLogFn?.('warning', `Ya tienes un reto pendiente a ${lastInviteOut.to_username}.`);
    return;
  }
  try {
    const r = await api.duelChallenge(targetUserId);
    if (r?.ok) {
      _feedLogFn?.('info', `Reto enviado a ${targetUsername || 'jugador'}. Tiene 60s para aceptar.`);
    } else {
      _feedLogFn?.('warning', mapChallengeError(r?.error));
    }
  } catch (err) {
    _feedLogFn?.('warning', mapChallengeError(err?.code));
  }
}

function mapChallengeError(code) {
  switch (code) {
    case 'same_party':         return 'No puedes retar a un miembro de tu equipo.';
    case 'already_in_duel':    return 'Ya estás en un duelo.';
    case 'target_in_duel':     return 'Ese jugador ya está en otro duelo.';
    case 'level_gap_too_big':  return 'Diferencia de nivel demasiado grande (máx ±10).';
    case 'cannot_challenge_self': return 'No puedes retarte a ti mismo.';
    case 'target_not_found':   return 'Jugador no encontrado.';
    case 'duel_disabled':      return 'Sistema de duelos no disponible.';
    default:                   return 'No se pudo enviar el reto.';
  }
}

function mapAcceptError(code) {
  switch (code) {
    case 'invite_not_found':     return 'La invitación ya expiró.';
    case 'already_in_duel':      return 'Ya estás en un duelo.';
    case 'challenger_in_duel':   return 'El retador ya está en otro duelo.';
    case 'level_gap_too_big':    return 'Diferencia de nivel demasiado grande.';
    case 'same_party':           return 'Sois del mismo equipo.';
    case 'race_condition':       return 'Conflicto. Intenta de nuevo.';
    default:                     return 'No se pudo aceptar el reto.';
  }
}

// ============================================================
// CSS
// ============================================================
function ensureCss() {
  if (cssInjected) return;
  cssInjected = true;
  const style = document.createElement('style');
  style.textContent = `
    .duel-toast {
      position: fixed;
      top: calc(env(safe-area-inset-top, 0px) + 96px);
      left: 50%;
      transform: translateX(-50%);
      z-index: 70;
      background: rgba(20, 14, 8, 0.95);
      border: 2px solid #c8a043;
      border-radius: 8px;
      padding: 12px 16px;
      min-width: 260px;
      max-width: 90vw;
      box-shadow: 0 6px 18px rgba(0,0,0,0.55);
      font-family: 'Cinzel', serif;
      color: #f0d68a;
      text-align: center;
      animation: duel-toast-in 0.25s ease-out;
    }
    @keyframes duel-toast-in {
      from { opacity: 0; transform: translate(-50%, -8px); }
      to   { opacity: 1; transform: translate(-50%, 0); }
    }
    .duel-toast .title {
      font-size: 13px; font-weight: 700; letter-spacing: 0.06em;
      color: #ff5e5e; margin-bottom: 4px; text-transform: uppercase;
    }
    .duel-toast .msg {
      font-size: 14px; font-weight: 600; margin-bottom: 10px;
      color: #f0d68a;
    }
    .duel-toast .sub {
      font-size: 11px; color: #b9a26a; margin-top: -4px; margin-bottom: 10px;
    }
    .duel-toast .actions {
      display: flex; gap: 8px; justify-content: center;
    }
    .duel-toast button {
      flex: 1; padding: 8px 10px; border-radius: 4px;
      font-family: 'Cinzel', serif; font-size: 12px; font-weight: 700;
      cursor: pointer; -webkit-tap-highlight-color: transparent;
      border: 2px solid; letter-spacing: 0.04em;
    }
    .duel-toast .btn-accept {
      background: #2a5a2a; border-color: #5db35d; color: #d8ffd8;
    }
    .duel-toast .btn-decline {
      background: #5a2a2a; border-color: #b35d5d; color: #ffd8d8;
    }
    .duel-toast .btn-ignore {
      background: #2a2a2a; border-color: #6a6a6a; color: #cccccc;
    }
    /* HUD Salir de combate — mismo estilo que interiorExitBtn */
    .duel-hud {
      position: fixed;
      top: calc(env(safe-area-inset-top, 0px) + 12px);
      left: 50%;
      transform: translateX(-50%);
      z-index: 60;
      background: rgba(20, 14, 8, 0.92);
      border: 2px solid #c8a043;
      color: #e8c560;
      font-family: 'Cinzel', serif;
      font-size: 13px;
      font-weight: 700;
      padding: 8px 14px;
      border-radius: 4px;
      text-shadow: 0 1px 2px rgba(0,0,0,0.9);
      box-shadow: 0 4px 12px rgba(0,0,0,0.5);
      cursor: pointer;
      letter-spacing: 0.04em;
      white-space: nowrap;
      -webkit-tap-highlight-color: transparent;
      user-select: none;
      pointer-events: auto;
      margin: 0;
      display: flex; flex-direction: column; align-items: center; gap: 4px;
      min-width: 160px;
    }
    .duel-hud.casting {
      cursor: default;
      border-color: #d44;
      color: #ffcccc;
    }
    .duel-hud .label { display: block; }
    .duel-hud .bar {
      width: 100%; height: 4px; background: #2a1a08;
      border-radius: 2px; overflow: hidden; display: none;
    }
    .duel-hud.casting .bar { display: block; }
    .duel-hud .bar-fill {
      height: 100%; background: #ff5e5e; width: 0%;
      transition: width 0.1s linear;
    }
  `;
  document.head.appendChild(style);
}

// ============================================================
// Toast invitación
// ============================================================
function showInviteToast(invite) {
  closeToast();
  ensureCss();

  toastEl = document.createElement('div');
  toastEl.className = 'duel-toast';
  toastEl.innerHTML = `
    <div class="title">⚔ Reto de duelo</div>
    <div class="msg">${escapeHtml(invite.from_username)}</div>
    <div class="sub">Combat lvl ${invite.from_combat_lvl} · expira en 60s</div>
    <div class="actions">
      <button class="btn-accept" type="button">Aceptar</button>
      <button class="btn-decline" type="button">Rechazar</button>
    </div>
  `;
  document.body.appendChild(toastEl);

  const acceptBtn = toastEl.querySelector('.btn-accept');
  const declineBtn = toastEl.querySelector('.btn-decline');

  acceptBtn.addEventListener('pointerup', async (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    closeToast();
    try {
      const r = await api.duelAccept(invite.from_user_id);
      if (r?.ok) {
        _feedLogFn?.('info', `Duelo aceptado contra ${invite.from_username}.`);
      } else {
        _feedLogFn?.('warning', mapAcceptError(r?.error));
      }
    } catch (err) {
      _feedLogFn?.('warning', mapAcceptError(err?.code));
    }
  });

  declineBtn.addEventListener('pointerup', async (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    closeToast();
    try {
      await api.duelDecline(invite.from_user_id);
      _feedLogFn?.('info', `Has rechazado el reto de ${invite.from_username}.`);
    } catch {
      // silencioso, ya cerramos toast
    }
  });

  // Auto-cierre cuando expire la invitación.
  const ttl = Math.max(0, invite.expires_at - Date.now());
  setTimeout(() => {
    if (toastEl) closeToast();
  }, ttl);
}

function closeToast() {
  if (toastEl) {
    toastEl.remove();
    toastEl = null;
  }
}

// ============================================================
// HUD Salir de combate
// ============================================================
function showHud() {
  if (hudEl) return;
  ensureCss();
  hudEl = document.createElement('div');
  hudEl.className = 'duel-hud';
  hudEl.innerHTML = `
    <span class="label">🛡 Salir de combate</span>
    <div class="bar"><div class="bar-fill"></div></div>
  `;
  hudLabelEl = hudEl.querySelector('.label');
  hudBarEl   = hudEl.querySelector('.bar-fill');
  hudEl.addEventListener('pointerup', onHudClick);
  document.body.appendChild(hudEl);

  // Tick para refrescar barra de cast.
  if (hudInterval) clearInterval(hudInterval);
  hudInterval = setInterval(updateHud, 100);
}

function updateHud() {
  if (!hudEl || !lastDuel) return;
  const myCast = lastDuel.my_leaving_at;
  const endsAt = lastDuel.leave_cast_ends_at;
  const now = Date.now();
  if (myCast != null && endsAt != null && now < endsAt) {
    hudEl.classList.add('casting');
    const total = endsAt - myCast;
    const elapsed = now - myCast;
    const pct = Math.min(100, Math.max(0, (elapsed / total) * 100));
    if (hudBarEl) hudBarEl.style.width = pct + '%';
    if (hudLabelEl) {
      const sec = Math.max(0, Math.ceil((endsAt - now) / 1000));
      hudLabelEl.textContent = `Saliendo… ${sec}s`;
    }
  } else if (lastDuel.opponent_leaving_at != null && endsAt != null && now < endsAt) {
    // El oponente está casteando salir. Mostramos info pero NO somos
    // nosotros los que casteamos.
    hudEl.classList.remove('casting');
    if (hudLabelEl) {
      const sec = Math.max(0, Math.ceil((endsAt - now) / 1000));
      hudLabelEl.textContent = `Oponente saliendo… ${sec}s`;
    }
    if (hudBarEl) hudBarEl.style.width = '0%';
  } else {
    hudEl.classList.remove('casting');
    if (hudLabelEl) hudLabelEl.textContent = '🛡 Salir de combate';
    if (hudBarEl) hudBarEl.style.width = '0%';
  }
}

async function onHudClick(ev) {
  ev.preventDefault();
  ev.stopPropagation();
  if (!lastDuel) return;
  // Si ya estoy casteando, ignorar.
  if (lastDuel.my_leaving_at != null) return;
  if (leaveInFlight) return;
  leaveInFlight = true;
  try {
    const r = await api.duelLeave();
    if (r?.ok) {
      _feedLogFn?.('info', `Cast iniciado: 5s para salir del duelo.`);
      // No actualizamos lastDuel localmente — el siguiente snapshot
      // traerá my_leaving_at + leave_cast_ends_at frescos.
    } else {
      _feedLogFn?.('warning', 'No se pudo iniciar la salida.');
    }
  } catch {
    _feedLogFn?.('warning', 'Error al intentar salir del duelo.');
  } finally {
    leaveInFlight = false;
  }
}

function removeHud() {
  if (hudInterval) { clearInterval(hudInterval); hudInterval = null; }
  if (hudEl) { hudEl.remove(); hudEl = null; }
  hudBarEl = null;
  hudLabelEl = null;
}

// ============================================================
// Utils
// ============================================================
function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
