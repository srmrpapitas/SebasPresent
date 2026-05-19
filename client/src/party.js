/**
 * SebasPresent — Party module (cliente)
 *
 * Sesión 27 Bloque 3 — Sistema de equipo (party).
 *
 * Responsabilidades:
 *   - Polling cada 4s a /api/party/state para detectar invites nuevos
 *     y cambios en la party (miembros joinean/salen).
 *   - Mostrar toast con botones Aceptar/Rechazar al recibir invite.
 *   - Modal "Grupo" accesible desde HUD: lista miembros, kick (si leader),
 *     leave.
 *   - Expone helpers:
 *       party.getMyPartyId()     → id de mi party o null
 *       party.getMyMemberIds()   → Set<user_id> de mi party (sin yo)
 *       party.isInMyParty(userId)→ boolean
 *       party.inviteUser(userId) → llama API, muestra feedback
 *   - Lo usa multiplayer.js (colorear nameplates + minimap) y world.js
 *     (acción "Invitar a grupo" en long-press).
 */

import * as api from './api.js';

let started = false;
let myUserId = null;
let pollTimer = null;
let lastState = { party: null, invites_in: [], invites_out: [] };
let _feedLogFn = null;
let cssInjected = false;
let toastEl = null;
let modalEl = null;
let shownInviteIds = new Set();   // IDs de invite ya mostrados (evita repintar)

const POLL_INTERVAL_MS = 4000;
const INVITE_TOAST_DURATION_MS = 60_000;  // mismo TTL que server

// ============================================================
// API pública
// ============================================================
export async function start({ userId, feedLog } = {}) {
  if (started) return;
  _feedLogFn = typeof feedLog === 'function' ? feedLog : (() => {});
  ensureCss();

  // Si no nos dan userId, lo obtenemos via api.me()
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

  startPolling();
  refreshState().catch(() => {});  // primera lectura inmediata
  started = true;
}

export function stop() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  closeToast();
  closeModal();
  started = false;
  myUserId = null;
  lastState = { party: null, invites_in: [], invites_out: [] };
  shownInviteIds.clear();
}

export function getMyPartyId() {
  return lastState.party?.id || null;
}

export function getMyMemberIds() {
  const out = new Set();
  if (!lastState.party) return out;
  for (const m of lastState.party.members || []) {
    if (m.user_id !== myUserId) out.add(m.user_id);
  }
  return out;
}

export function isInMyParty(userId) {
  if (!lastState.party) return false;
  for (const m of lastState.party.members || []) {
    if (m.user_id === userId) return true;
  }
  return false;
}

export function isLeader() {
  return lastState.party?.leader_user_id === myUserId;
}

export function getState() {
  return lastState;
}

/**
 * Acción exterior: invitar a un user (lo llama world.js desde long-press).
 */
export async function inviteUser(targetUserId, targetUsername) {
  try {
    const r = await api.partyInvite(targetUserId);
    if (r.error) {
      const msg = mapInviteError(r.error, targetUsername);
      _feedLogFn?.('warning', msg);
      return false;
    }
    _feedLogFn?.('info', `Invitación enviada a ${targetUsername || 'jugador'}.`);
    refreshState().catch(() => {});
    return true;
  } catch (err) {
    _feedLogFn?.('warning', 'No se pudo enviar la invitación.');
    return false;
  }
}

/**
 * Abrir modal "Grupo" desde HUD.
 */
export function openModal() {
  closeModal();
  ensureCss();
  refreshState().catch(() => {});
  renderModal();
}

// ============================================================
// Internals
// ============================================================

function startPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(() => refreshState().catch(() => {}), POLL_INTERVAL_MS);
}

async function refreshState() {
  try {
    const r = await api.partyState();
    if (r.error || r.party_disabled) {
      // Servidor sin tabla — modo gracefully disabled
      lastState = { party: null, invites_in: [], invites_out: [], disabled: true };
      return;
    }
    lastState = r;
    handleNewInvites();
    if (modalEl) renderModal();   // re-render modal si está abierto
  } catch (err) {
    // silencio: 401 (logged out), 500, etc
  }
}

function handleNewInvites() {
  const invites = lastState.invites_in || [];
  if (!invites.length) {
    // Si ya no hay invites, cerrar toast si estaba abierto
    if (toastEl && !toastEl.dataset.pinned) closeToast();
    return;
  }
  // Mostrar el primer invite no visto
  for (const inv of invites) {
    if (!shownInviteIds.has(inv.id)) {
      shownInviteIds.add(inv.id);
      showInviteToast(inv);
      return;
    }
  }
}

// ============================================================
// TOAST de invite
// ============================================================
function showInviteToast(invite) {
  closeToast();
  const el = document.createElement('div');
  el.className = 'party-invite-toast';
  el.dataset.pinned = '1';
  el.innerHTML = `
    <div class="party-toast-title">
      <span class="party-toast-emoji">👥</span>
      Invitación de grupo
    </div>
    <div class="party-toast-body">
      <strong>${escapeHtml(invite.from_username || 'Jugador')}</strong> te invita a su grupo.
    </div>
    <div class="party-toast-actions">
      <button class="party-btn accept" data-act="accept">Aceptar</button>
      <button class="party-btn decline" data-act="decline">Rechazar</button>
    </div>
  `;
  document.body.appendChild(el);
  toastEl = el;

  el.querySelector('[data-act="accept"]').addEventListener('click', async () => {
    try {
      const r = await api.partyAccept(invite.from_user_id);
      if (r.error) {
        _feedLogFn?.('warning', mapAcceptError(r.error));
      } else {
        _feedLogFn?.('info', `Te has unido al grupo de ${invite.from_username}.`);
      }
    } catch {
      _feedLogFn?.('warning', 'No se pudo aceptar la invitación.');
    } finally {
      closeToast();
      refreshState();
    }
  });
  el.querySelector('[data-act="decline"]').addEventListener('click', async () => {
    try { await api.partyDecline(invite.from_user_id); } catch {}
    closeToast();
    refreshState();
  });

  // Auto-cerrar a los 60s
  setTimeout(() => { if (toastEl === el) closeToast(); }, INVITE_TOAST_DURATION_MS);
}

function closeToast() {
  if (toastEl) { toastEl.remove(); toastEl = null; }
}

// ============================================================
// MODAL "Grupo"
// ============================================================
function renderModal() {
  if (modalEl) { modalEl.remove(); modalEl = null; }
  const el = document.createElement('div');
  el.className = 'party-modal-backdrop';
  el.innerHTML = renderModalInner();
  document.body.appendChild(el);
  modalEl = el;
  wireModalActions(el);
}

function renderModalInner() {
  const p = lastState.party;
  if (!p) {
    return `
      <div class="party-modal">
        <div class="party-modal-header">
          <h3>Sin grupo</h3>
          <button class="party-modal-close" data-act="close">✕</button>
        </div>
        <div class="party-modal-body">
          <p>No estás en ningún grupo todavía.</p>
          <p class="party-modal-hint">Mantén pulsado a otro jugador y selecciona <em>Invitar a grupo</em>.</p>
        </div>
      </div>
    `;
  }
  const meIsLeader = p.leader_user_id === myUserId;
  const memberRows = (p.members || []).map(m => {
    const isLeader = m.user_id === p.leader_user_id;
    const isMe = m.user_id === myUserId;
    return `
      <div class="party-member">
        <span class="party-member-name">
          ${isLeader ? '👑 ' : ''}${escapeHtml(m.username)}
          ${isMe ? ' <span class="party-member-you">(tú)</span>' : ''}
        </span>
        ${meIsLeader && !isMe ? `<button class="party-btn small kick" data-act="kick" data-uid="${m.user_id}">Echar</button>` : ''}
      </div>
    `;
  }).join('');
  return `
    <div class="party-modal">
      <div class="party-modal-header">
        <h3>Grupo (${p.members?.length || 0}/${p.max_size})</h3>
        <button class="party-modal-close" data-act="close">✕</button>
      </div>
      <div class="party-modal-body">
        <div class="party-members">${memberRows}</div>
        <button class="party-btn leave full" data-act="leave">Salir del grupo</button>
      </div>
    </div>
  `;
}

function wireModalActions(el) {
  el.addEventListener('click', async (ev) => {
    const target = ev.target;
    if (target === el) { closeModal(); return; }  // click en backdrop
    const act = target.dataset?.act;
    if (!act) return;
    if (act === 'close') { closeModal(); return; }
    if (act === 'leave') {
      if (!confirm('¿Salir del grupo?')) return;
      try {
        const r = await api.partyLeave();
        if (r.error) _feedLogFn?.('warning', 'No se pudo salir.');
        else _feedLogFn?.('info', 'Has salido del grupo.');
      } catch {}
      closeModal();
      refreshState();
      return;
    }
    if (act === 'kick') {
      const uid = parseInt(target.dataset.uid, 10);
      if (!confirm('¿Echar a este miembro?')) return;
      try {
        const r = await api.partyKick(uid);
        if (r.error) _feedLogFn?.('warning', 'No se pudo echar.');
      } catch {}
      refreshState();
      return;
    }
  });
}

function closeModal() {
  if (modalEl) { modalEl.remove(); modalEl = null; }
}

// ============================================================
// Helpers
// ============================================================
function mapInviteError(code, target) {
  switch (code) {
    case 'target_in_party':   return `${target || 'Ese jugador'} ya está en un grupo.`;
    case 'party_full':        return 'Tu grupo está lleno.';
    case 'cannot_invite_self':return 'No puedes invitarte a ti mismo.';
    case 'target_not_found':  return 'Ese jugador ya no está aquí.';
    case 'party_disabled':    return 'Sistema de grupos no disponible.';
    default:                  return 'No se pudo enviar la invitación.';
  }
}

function mapAcceptError(code) {
  switch (code) {
    case 'invite_not_found_or_expired': return 'La invitación expiró.';
    case 'already_in_party':            return 'Ya estás en un grupo.';
    case 'party_full':                  return 'Ese grupo está lleno.';
    case 'party_no_longer_exists':      return 'Ese grupo ya no existe.';
    default:                            return 'No se pudo aceptar la invitación.';
  }
}

function escapeHtml(s) {
  if (s == null) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ============================================================
// CSS
// ============================================================
function ensureCss() {
  if (cssInjected) return;
  cssInjected = true;
  const style = document.createElement('style');
  style.id = 'party-css';
  style.textContent = `
    /* Toast invite */
    .party-invite-toast {
      position: fixed;
      bottom: calc(env(safe-area-inset-bottom, 0px) + 90px);
      left: 50%;
      transform: translateX(-50%);
      z-index: 250;
      min-width: 280px;
      max-width: 90vw;
      background: rgba(20, 14, 8, 0.97);
      border: 2px solid #c8a043;
      border-radius: 6px;
      padding: 12px 16px;
      box-shadow: 0 6px 24px rgba(0,0,0,0.8), 0 0 16px rgba(200,160,67,0.3);
      animation: partyToastIn 0.25s ease-out;
      font-family: 'IM Fell English', serif;
      color: #f0e0b0;
    }
    @keyframes partyToastIn {
      from { opacity: 0; transform: translate(-50%, 10px); }
      to   { opacity: 1; transform: translate(-50%, 0); }
    }
    .party-toast-title {
      font-family: 'Cinzel', serif;
      font-weight: 700;
      font-size: 14px;
      color: #ffd680;
      margin-bottom: 6px;
      text-shadow: 1px 1px 0 #000;
    }
    .party-toast-emoji { margin-right: 4px; }
    .party-toast-body {
      font-size: 13px;
      margin-bottom: 12px;
      text-shadow: 1px 1px 0 #000;
    }
    .party-toast-body strong { color: #ffe080; }
    .party-toast-actions {
      display: flex;
      gap: 8px;
      justify-content: flex-end;
    }
    .party-btn {
      padding: 7px 14px;
      border-radius: 3px;
      border: 1.5px solid #c8a043;
      background: rgba(40, 30, 20, 0.95);
      color: #f0e0b0;
      font-family: 'IM Fell English', serif;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      text-shadow: 1px 1px 0 #000;
    }
    .party-btn:active { background: rgba(200,160,67,0.3); }
    .party-btn.accept { border-color: #4abc4a; color: #b0f0b0; }
    .party-btn.accept:active { background: rgba(74,188,74,0.35); }
    .party-btn.decline { border-color: #c84040; color: #ffb0b0; }
    .party-btn.decline:active { background: rgba(200,64,64,0.35); }
    .party-btn.small { padding: 4px 9px; font-size: 11px; }
    .party-btn.full { width: 100%; margin-top: 12px; }
    .party-btn.leave { border-color: #c84040; color: #ffb0b0; }
    .party-btn.kick { border-color: #c87040; color: #ffd0b0; }

    /* Modal */
    .party-modal-backdrop {
      position: fixed;
      inset: 0;
      z-index: 240;
      background: rgba(0,0,0,0.6);
      display: flex;
      align-items: center;
      justify-content: center;
      animation: partyToastIn 0.18s ease-out;
    }
    .party-modal {
      background: rgba(20, 14, 8, 0.98);
      border: 2px solid #c8a043;
      border-radius: 8px;
      padding: 16px;
      width: 320px;
      max-width: 92vw;
      max-height: 80vh;
      overflow-y: auto;
      color: #f0e0b0;
      font-family: 'IM Fell English', serif;
      box-shadow: 0 10px 40px rgba(0,0,0,0.85), 0 0 24px rgba(200,160,67,0.3);
    }
    .party-modal-header {
      display: flex; justify-content: space-between; align-items: center;
      border-bottom: 1px solid rgba(200,160,67,0.4);
      padding-bottom: 8px; margin-bottom: 12px;
    }
    .party-modal-header h3 {
      margin: 0;
      font-family: 'Cinzel', serif;
      font-size: 16px;
      color: #ffd680;
      text-shadow: 1px 1px 0 #000;
    }
    .party-modal-close {
      background: none;
      border: none;
      color: #c8a043;
      font-size: 18px;
      cursor: pointer;
      padding: 0 4px;
    }
    .party-modal-body p { margin: 8px 0; font-size: 13px; }
    .party-modal-hint { color: rgba(232,197,96,0.7); font-style: italic; font-size: 12px; }
    .party-members { display: flex; flex-direction: column; gap: 6px; }
    .party-member {
      display: flex; justify-content: space-between; align-items: center;
      padding: 8px 10px;
      background: rgba(40, 30, 20, 0.5);
      border: 1px solid rgba(200,160,67,0.25);
      border-radius: 4px;
    }
    .party-member-name { font-size: 14px; color: #ffe080; text-shadow: 1px 1px 0 #000; }
    .party-member-you { color: rgba(232,197,96,0.6); font-size: 11px; font-style: italic; }
  `;
  document.head.appendChild(style);
}
