/**
 * SebasPresent — Party module (cliente)
 *
 * Sesión 27 Bloque 3 — Sistema de equipo (party).
 * Sesión 28 — Group frame WoW-style: dropdown compacto anclado al botón
 *   "Grupo" (top-right) en lugar del modal fullscreen anterior. Por
 *   miembro: icono de clase (melee/ranged/mage), nombre + nivel, barra HP.
 *
 * Responsabilidades:
 *   - Polling cada 4s a /api/party/state para detectar invites + cambios.
 *   - Toast invite con botones Aceptar/Rechazar.
 *   - Dropdown "Grupo" accesible desde HUD: lista miembros con HP, kick (si leader), leave.
 *   - Expone helpers:
 *       party.getMyPartyId()     → id de mi party o null
 *       party.getMyMemberIds()   → Set<user_id> de mi party (sin yo)
 *       party.isInMyParty(userId)→ boolean
 *       party.inviteUser(userId) → llama API, muestra feedback
 *       party.openModal()        → toggle del dropdown (mantengo nombre por compat)
 *
 *   - Lo usa multiplayer.js (colorear nameplates + minimap) y world.js
 *     (acción "Invitar a grupo" en long-press + botón HUD).
 */

import * as api from './api.js';

let started = false;
let myUserId = null;
let pollTimer = null;
let lastState = { party: null, invites_in: [], invites_out: [] };
let _feedLogFn = null;
let cssInjected = false;
let toastEl = null;
let dropdownEl = null;           // Sesión 28: ahora dropdown, no modal
let shownInviteIds = new Set();

const POLL_INTERVAL_MS = 4000;
const INVITE_TOAST_DURATION_MS = 60_000;

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

  startPolling();
  refreshState().catch(() => {});
  started = true;
}

export function stop() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  closeToast();
  closeDropdown();
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
 * Invitar a un user (lo llama world.js / multiplayer.js desde long-press).
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
 * Toggle del dropdown desde el botón HUD "Grupo".
 * Mantengo el nombre openModal por compatibilidad con world.js (que llama
 * party.openModal?.()). Internamente ahora es un dropdown anclado, no
 * un modal fullscreen.
 */
export function openModal() {
  if (dropdownEl) { closeDropdown(); return; }
  ensureCss();
  refreshState().catch(() => {});
  renderDropdown();
}

// Alias explícito por si en el futuro alguien quiere llamarlo por su nombre real.
export function toggleDropdown() { openModal(); }

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
      lastState = { party: null, invites_in: [], invites_out: [], disabled: true };
      return;
    }
    lastState = r;
    handleNewInvites();
    if (dropdownEl) renderDropdown();   // re-render si está abierto
  } catch (err) { /* silencio */ }
}

function handleNewInvites() {
  const invites = lastState.invites_in || [];
  if (!invites.length) {
    if (toastEl && !toastEl.dataset.pinned) closeToast();
    return;
  }
  for (const inv of invites) {
    if (!shownInviteIds.has(inv.id)) {
      shownInviteIds.add(inv.id);
      showInviteToast(inv);
      return;
    }
  }
}

// ============================================================
// TOAST de invite (sin cambios)
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
      if (r.error) _feedLogFn?.('warning', mapAcceptError(r.error));
      else _feedLogFn?.('info', `Te has unido al grupo de ${invite.from_username}.`);
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

  setTimeout(() => { if (toastEl === el) closeToast(); }, INVITE_TOAST_DURATION_MS);
}

function closeToast() {
  if (toastEl) { toastEl.remove(); toastEl = null; }
}

// ============================================================
// DROPDOWN "Grupo" — Sesión 28 (estilo WoW)
// ============================================================
function renderDropdown() {
  if (dropdownEl) { dropdownEl.remove(); dropdownEl = null; }
  const el = document.createElement('div');
  el.className = 'party-dropdown';
  el.innerHTML = renderDropdownInner();
  document.body.appendChild(el);
  dropdownEl = el;
  wireDropdownActions(el);

  // Cerrar al tap fuera (handler en window con captura, removido al cerrar)
  setTimeout(() => {
    document.addEventListener('pointerdown', onOutsideTap, true);
  }, 0);
}

function onOutsideTap(ev) {
  if (!dropdownEl) {
    document.removeEventListener('pointerdown', onOutsideTap, true);
    return;
  }
  if (dropdownEl.contains(ev.target)) return;
  // No cerrar si tap es en el botón "Grupo" (lo gestiona él toggle).
  const btn = document.getElementById('partyHudBtn');
  if (btn && btn.contains(ev.target)) return;
  closeDropdown();
}

function renderDropdownInner() {
  const p = lastState.party;
  const invitesIn = lastState.invites_in || [];

  // ---- Caso "sin grupo" ----
  if (!p) {
    const invitesHtml = invitesIn.length ? `
      <div class="pd-section-title">Invitaciones</div>
      <div class="pd-invite-list">
        ${invitesIn.map(inv => `
          <div class="pd-invite-row">
            <div class="pd-invite-name">${escapeHtml(inv.from_username)}</div>
            <div class="pd-invite-actions">
              <button class="pd-btn-accept" data-act="accept-inv" data-uid="${inv.from_user_id}">Aceptar</button>
              <button class="pd-btn-decline" data-act="decline-inv" data-uid="${inv.from_user_id}">✕</button>
            </div>
          </div>
        `).join('')}
      </div>
    ` : '';
    return `
      <div class="pd-header">
        <span class="pd-title">Grupo</span>
        <button class="pd-close" data-act="close">✕</button>
      </div>
      <div class="pd-empty">
        <div class="pd-empty-text">No estás en ningún grupo.</div>
        <div class="pd-empty-hint">Mantén pulsado a otro jugador → <em>Invitar a grupo</em>.</div>
      </div>
      ${invitesHtml}
    `;
  }

  // ---- Caso "en grupo" ----
  const meIsLeader = p.leader_user_id === myUserId;
  const members = p.members || [];
  // Ordenar: yo primero, luego leader, luego resto por joined_at.
  const sortedMembers = [...members].sort((a, b) => {
    if (a.user_id === myUserId) return -1;
    if (b.user_id === myUserId) return 1;
    if (a.user_id === p.leader_user_id) return -1;
    if (b.user_id === p.leader_user_id) return 1;
    return (a.joined_at || 0) - (b.joined_at || 0);
  });

  const memberCards = sortedMembers.map(m => renderMemberCard(m, p.leader_user_id, meIsLeader)).join('');

  return `
    <div class="pd-header">
      <span class="pd-title">Grupo <span class="pd-count">${members.length}/${p.max_size}</span></span>
      <button class="pd-close" data-act="close">✕</button>
    </div>
    <div class="pd-members">${memberCards}</div>
    <button class="pd-btn-leave" data-act="leave">↩ Salir del grupo</button>
  `;
}

function renderMemberCard(m, leaderUserId, meIsLeader) {
  const isLeader = m.user_id === leaderUserId;
  const isMe = m.user_id === myUserId;
  const cls = classFromWeapon(m.weapon_type);
  const hpPct = m.hp_max > 0 ? Math.max(0, Math.min(100, (m.hp_current / m.hp_max) * 100)) : 0;
  const hpColor = hpPct > 50 ? '#4abc4a' : '#c84040';   // verde / rojo (sin amarillo)
  const combatColor = m.in_combat ? '#ff6060' : '#c8a043';
  const showKick = meIsLeader && !isMe;

  return `
    <div class="pd-member ${isMe ? 'is-me' : ''} ${m.in_combat ? 'in-combat' : ''}"
         style="--combat-color:${combatColor}">
      <div class="pd-avatar" style="background:${cls.bg};border-color:${cls.border}">
        <span class="pd-avatar-icon" title="${cls.label}">${cls.icon}</span>
      </div>
      <div class="pd-info">
        <div class="pd-name-row">
          <span class="pd-name">
            ${isLeader ? '<span class="pd-crown">👑</span>' : ''}${escapeHtml(m.username)}${isMe ? '<span class="pd-you"> (tú)</span>' : ''}
          </span>
          <span class="pd-lvl">lvl ${m.combat_lvl}</span>
        </div>
        <div class="pd-hp-bar">
          <div class="pd-hp-fill" style="width:${hpPct.toFixed(1)}%;background:${hpColor}"></div>
          <span class="pd-hp-text">${m.hp_current}/${m.hp_max}</span>
        </div>
      </div>
      ${showKick ? `<button class="pd-kick-btn" data-act="kick" data-uid="${m.user_id}" title="Echar del grupo">✕</button>` : ''}
    </div>
  `;
}

function classFromWeapon(weaponType) {
  switch (weaponType) {
    case 'bow':
      return { icon: '🏹', label: 'Arquero', bg: 'linear-gradient(135deg,#1a3a1a,#0d1f0d)', border: '#5db35d' };
    case 'staff':
      return { icon: '🔮', label: 'Mago',    bg: 'linear-gradient(135deg,#1a2a3a,#0d141f)', border: '#5d8db3' };
    case '2h_sword':
    case '1h_sword':
    case 'unarmed':
    default:
      return { icon: '⚔', label: 'Melee',   bg: 'linear-gradient(135deg,#3a2a14,#1f140a)', border: '#c8a043' };
  }
}

function wireDropdownActions(el) {
  el.addEventListener('click', async (ev) => {
    const target = ev.target.closest('[data-act]');
    if (!target) return;
    const act = target.dataset.act;
    ev.preventDefault();
    ev.stopPropagation();

    if (act === 'close') { closeDropdown(); return; }

    if (act === 'leave') {
      if (!confirm('¿Salir del grupo?')) return;
      try {
        const r = await api.partyLeave();
        if (r.error) _feedLogFn?.('warning', 'No se pudo salir.');
        else _feedLogFn?.('info', 'Has salido del grupo.');
      } catch {}
      closeDropdown();
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

    if (act === 'accept-inv') {
      const uid = parseInt(target.dataset.uid, 10);
      try {
        const r = await api.partyAccept(uid);
        if (r.error) _feedLogFn?.('warning', mapAcceptError(r.error));
        else _feedLogFn?.('info', 'Te has unido al grupo.');
      } catch {
        _feedLogFn?.('warning', 'No se pudo aceptar.');
      }
      refreshState();
      return;
    }

    if (act === 'decline-inv') {
      const uid = parseInt(target.dataset.uid, 10);
      try { await api.partyDecline(uid); } catch {}
      refreshState();
      return;
    }
  });
}

function closeDropdown() {
  if (dropdownEl) { dropdownEl.remove(); dropdownEl = null; }
  document.removeEventListener('pointerdown', onOutsideTap, true);
}

// Compatibilidad con el nombre viejo (algún módulo puede llamarlo).
export function closeModal() { closeDropdown(); }

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
    /* ===== Toast invite (sin cambios) ===== */
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
      display: flex; gap: 8px; justify-content: flex-end;
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

    /* ===== Dropdown WoW-style (Sesión 28) ===== */
    .party-dropdown {
      position: fixed;
      top: calc(env(safe-area-inset-top, 0px) + 200px);
      right: 8px;
      z-index: 240;
      width: 248px;
      max-width: calc(100vw - 16px);
      background: linear-gradient(180deg, rgba(28,20,10,0.97), rgba(16,11,5,0.97));
      border: 2px solid #c8a043;
      border-radius: 6px;
      padding: 8px;
      box-shadow:
        0 6px 18px rgba(0,0,0,0.75),
        0 0 12px rgba(200,160,67,0.25),
        inset 0 1px 0 rgba(255,220,140,0.15);
      color: #f0e0b0;
      font-family: 'IM Fell English', serif;
      animation: pdSlide 0.18s ease-out;
    }
    @keyframes pdSlide {
      from { opacity: 0; transform: translateY(-6px); }
      to   { opacity: 1; transform: translateY(0); }
    }
    .pd-header {
      display: flex; justify-content: space-between; align-items: center;
      padding: 2px 4px 6px 4px;
      border-bottom: 1px solid rgba(200,160,67,0.35);
      margin-bottom: 8px;
    }
    .pd-title {
      font-family: 'Cinzel', serif;
      font-weight: 700; font-size: 13px;
      color: #ffd680; letter-spacing: 0.04em;
      text-shadow: 1px 1px 0 #000;
    }
    .pd-count {
      font-weight: 400;
      color: rgba(232,197,96,0.7);
      margin-left: 4px;
      font-size: 11px;
    }
    .pd-close {
      background: none; border: none;
      color: #c8a043; font-size: 16px;
      cursor: pointer; padding: 0 2px;
      -webkit-tap-highlight-color: transparent;
    }
    .pd-empty { padding: 8px 4px 4px; }
    .pd-empty-text { color: #ffe080; font-size: 13px; margin-bottom: 4px; }
    .pd-empty-hint {
      color: rgba(232,197,96,0.65); font-style: italic; font-size: 11px;
    }
    .pd-members {
      display: flex; flex-direction: column; gap: 4px;
      margin-bottom: 8px;
    }
    .pd-member {
      display: flex; align-items: center; gap: 8px;
      padding: 6px 6px 6px 4px;
      background: rgba(36, 26, 14, 0.55);
      border: 1px solid rgba(200,160,67,0.22);
      border-radius: 4px;
      position: relative;
      transition: border-color 0.15s;
    }
    .pd-member.is-me {
      background: rgba(50, 36, 18, 0.7);
      border-color: rgba(200,160,67,0.45);
    }
    .pd-member.in-combat {
      border-color: var(--combat-color);
      box-shadow: 0 0 6px rgba(255,96,96,0.35);
    }
    .pd-avatar {
      width: 36px; height: 36px;
      border-radius: 50%;
      border: 2px solid;
      display: flex; align-items: center; justify-content: center;
      flex-shrink: 0;
      box-shadow: inset 0 1px 0 rgba(255,255,255,0.1), 0 1px 2px rgba(0,0,0,0.5);
    }
    .pd-avatar-icon {
      font-size: 18px;
      filter: drop-shadow(1px 1px 0 #000);
    }
    .pd-info {
      flex: 1; min-width: 0;
      display: flex; flex-direction: column; gap: 3px;
    }
    .pd-name-row {
      display: flex; justify-content: space-between; align-items: baseline; gap: 4px;
    }
    .pd-name {
      font-size: 12.5px;
      color: #ffe080;
      text-shadow: 1px 1px 0 #000;
      font-weight: 600;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      max-width: 130px;
    }
    .pd-crown { margin-right: 2px; font-size: 11px; }
    .pd-you { color: rgba(232,197,96,0.55); font-size: 10px; font-style: italic; font-weight: 400; }
    .pd-lvl {
      color: #c8a043;
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.04em;
      text-shadow: 1px 1px 0 #000;
      flex-shrink: 0;
    }
    .pd-hp-bar {
      position: relative;
      height: 8px;
      background: rgba(0,0,0,0.7);
      border: 1px solid rgba(0,0,0,0.9);
      border-radius: 2px;
      overflow: hidden;
      box-shadow: inset 0 1px 1px rgba(0,0,0,0.6);
    }
    .pd-hp-fill {
      height: 100%;
      transition: width 0.3s ease-out;
      box-shadow: inset 0 1px 0 rgba(255,255,255,0.2);
    }
    .pd-hp-text {
      position: absolute;
      inset: 0;
      display: flex; align-items: center; justify-content: center;
      font-family: 'Cinzel', serif;
      font-size: 8.5px;
      font-weight: 700;
      color: #fff;
      text-shadow: 1px 1px 0 #000, -1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000;
      letter-spacing: 0.04em;
      pointer-events: none;
    }
    .pd-kick-btn {
      background: rgba(120,32,32,0.85);
      border: 1px solid #c84040;
      color: #ffd0d0;
      width: 20px; height: 20px;
      border-radius: 50%;
      font-size: 11px;
      line-height: 1;
      cursor: pointer;
      padding: 0;
      flex-shrink: 0;
      -webkit-tap-highlight-color: transparent;
    }
    .pd-kick-btn:active { background: rgba(200,64,64,0.95); }
    .pd-btn-leave {
      width: 100%;
      padding: 7px 0;
      background: rgba(50, 16, 16, 0.7);
      border: 1.5px solid #c84040;
      border-radius: 4px;
      color: #ffb0b0;
      font-family: 'IM Fell English', serif;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      text-shadow: 1px 1px 0 #000;
      letter-spacing: 0.04em;
      -webkit-tap-highlight-color: transparent;
    }
    .pd-btn-leave:active { background: rgba(200,64,64,0.4); }

    /* Sección invites cuando no estás en grupo */
    .pd-section-title {
      font-family: 'Cinzel', serif;
      font-size: 11px;
      color: #ffd680;
      margin: 10px 2px 4px;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      border-top: 1px solid rgba(200,160,67,0.25);
      padding-top: 6px;
    }
    .pd-invite-list { display: flex; flex-direction: column; gap: 4px; }
    .pd-invite-row {
      display: flex; align-items: center; justify-content: space-between;
      padding: 5px 6px;
      background: rgba(36, 26, 14, 0.55);
      border: 1px solid rgba(200,160,67,0.22);
      border-radius: 4px;
    }
    .pd-invite-name {
      font-size: 12px; color: #ffe080;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      max-width: 130px;
      text-shadow: 1px 1px 0 #000;
    }
    .pd-invite-actions { display: flex; gap: 4px; flex-shrink: 0; }
    .pd-btn-accept {
      background: rgba(36,80,36,0.85);
      border: 1px solid #5db35d;
      color: #d0ffd0;
      padding: 3px 10px;
      border-radius: 3px;
      font-family: 'IM Fell English', serif;
      font-size: 11px;
      font-weight: 600;
      cursor: pointer;
      -webkit-tap-highlight-color: transparent;
    }
    .pd-btn-accept:active { background: rgba(74,188,74,0.5); }
    .pd-btn-decline {
      background: rgba(80,28,28,0.85);
      border: 1px solid #c84040;
      color: #ffd0d0;
      width: 22px; height: 22px;
      border-radius: 50%;
      font-size: 11px;
      line-height: 1;
      cursor: pointer;
      padding: 0;
      -webkit-tap-highlight-color: transparent;
    }
    .pd-btn-decline:active { background: rgba(200,64,64,0.95); }
  `;
  document.head.appendChild(style);
}
