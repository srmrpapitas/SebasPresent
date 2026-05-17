/**
 * SebasPresent — Inventory module (Slice 4a + Sesión 22 equipping)
 *
 * Sesión 22: long-press en un slot con item devuelve un menú contextual
 * con la opción "Equipar" SI el item es equipable (item.equip_slot !=
 * null). Al equipar, el item desaparece del inventario y va a
 * user_equipment vía /api/equipment/equip.
 *
 * Responsibilities:
 * - Fetch inventory from server on init
 * - Render a 4×7 grid (28 slots) inside the OSRS sidebar's Inventory tab
 * - Two interaction modes (both supported, OSRS Mobile style):
 *     1. DRAG & DROP using pointer events (works on iPhone/touch)
 *     2. TAP-TO-TAP: tap source slot (selects it), tap destination (swaps)
 * - Optimistic update: UI moves immediately, server call in background.
 *   If server fails, revert to previous state and show a small error.
 * - Stacking: stackable items show quantity number in OSRS yellow text
 *
 * Public API:
 *   init()         — fetch + render. Call once after entering the world.
 *   refresh()      — re-fetch from server (e.g. after looting)
 *   getState()     — read-only snapshot of current slots
 */

import * as api from './api.js';
import * as equipment from './equipment.js';

// ---------- Constants ----------
const SLOTS = 28; // 4 columns × 7 rows, OSRS-style
const LONG_PRESS_MS = 450;

// ---------- State ----------
/**
 * `slots` is a sparse array of length 28.
 * Each entry is either null (empty) or { item_id, quantity, name, icon, stackable, equip_slot }.
 */
let slots = new Array(SLOTS).fill(null);
let gridEl = null;
let selectedSlot = null; // tap-to-tap source, or null
let dragState = null;    // active drag, or null
let isInitialized = false;
let longPressTimer = null;

// ---------- Public API ----------

export async function init() {
  if (isInitialized) return;

  // Find the Inventory tab pane inside the sidebar
  const pane = document.querySelector('.osrs-tab-pane[data-tab="inventory"]');
  if (!pane) {
    console.warn('[inventory] Inventory tab pane not found in DOM');
    return;
  }

  // Replace placeholder content with the grid skeleton
  pane.innerHTML = `
    <div class="inv-header">
      <span class="inv-title">Mochila</span>
      <span class="inv-count" id="invCount">0/28</span>
    </div>
    <div class="inv-grid" id="invGrid"></div>
    <div class="inv-error" id="invError"></div>
  `;
  gridEl = document.getElementById('invGrid');

  // Build 28 empty slot elements (we'll fill them once data arrives)
  for (let i = 0; i < SLOTS; i++) {
    const slotEl = document.createElement('div');
    slotEl.className = 'inv-slot';
    slotEl.dataset.slot = String(i);
    slotEl.addEventListener('pointerdown', onSlotPointerDown);
    gridEl.appendChild(slotEl);
  }

  await refresh();
  isInitialized = true;
}

export async function refresh() {
  try {
    const data = await api.getInventory();
    applyServerSlots(data.slots || []);
    renderAll();
    clearError();
  } catch (err) {
    console.error('[inventory] refresh failed:', err);
    showError('No se pudo cargar la mochila.');
  }
}

export function getState() {
  return slots.slice();
}

// ---------- Internal: state mutation ----------

function applyServerSlots(serverSlots) {
  slots = new Array(SLOTS).fill(null);
  for (const s of serverSlots) {
    if (s.slot < 0 || s.slot >= SLOTS) continue;
    slots[s.slot] = {
      item_id:   s.item_id,
      quantity:  s.quantity,
      name:      s.name,
      icon:      s.icon,
      stackable: !!s.stackable,
      equip_slot: s.equip_slot || null,   // sesión 22
    };
  }
}

// ---------- Rendering ----------

function renderAll() {
  if (!gridEl) return;
  for (let i = 0; i < SLOTS; i++) renderSlot(i);
  const count = slots.filter(s => s !== null).length;
  const countEl = document.getElementById('invCount');
  if (countEl) countEl.textContent = `${count}/${SLOTS}`;
}

function renderSlot(index) {
  const slotEl = gridEl.children[index];
  if (!slotEl) return;
  const data = slots[index];

  // Clear previous content
  slotEl.innerHTML = '';
  slotEl.classList.toggle('selected', selectedSlot === index);
  slotEl.classList.toggle('occupied', data !== null);
  slotEl.classList.toggle('equipable', !!data?.equip_slot);

  if (!data) return;

  // Icon (emoji from server)
  const iconEl = document.createElement('span');
  iconEl.className = 'inv-icon';
  iconEl.textContent = data.icon || '?';
  slotEl.appendChild(iconEl);

  // Quantity (only if stackable AND > 1)
  if (data.stackable && data.quantity > 1) {
    const qtyEl = document.createElement('span');
    qtyEl.className = 'inv-qty';
    qtyEl.textContent = formatQty(data.quantity);
    slotEl.appendChild(qtyEl);
  }
}

/** OSRS-style quantity formatting: 12345 → "12K", 999999 → "999K", 1234567 → "1M". */
function formatQty(n) {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return Math.floor(n / 1000) + 'K';
  return Math.floor(n / 1_000_000) + 'M';
}

// ---------- Error UI ----------

function showError(msg) {
  const el = document.getElementById('invError');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('visible');
  setTimeout(() => el.classList.remove('visible'), 2200);
}
function clearError() {
  const el = document.getElementById('invError');
  if (el) el.classList.remove('visible');
}

// ============================================================
// INTERACTION: drag & drop + tap-to-tap + long-press
// ============================================================

const DRAG_THRESHOLD_PX = 6; // movement below this = treat as tap

function onSlotPointerDown(ev) {
  // Ignore non-primary buttons (right-click etc.)
  if (ev.button !== undefined && ev.button !== 0) return;

  const slotEl = ev.currentTarget;
  const slotIdx = parseInt(slotEl.dataset.slot, 10);
  const data = slots[slotIdx];

  // Tapping an empty slot:
  //  - if we have a selectedSlot, that's a tap-to-tap destination → swap
  //  - otherwise it's a no-op
  if (!data) {
    if (selectedSlot !== null && selectedSlot !== slotIdx) {
      commitMove(selectedSlot, slotIdx);
    }
    selectedSlot = null;
    renderAll();
    return;
  }

  // Tapping an occupied slot: start drag tracking + long-press timer.
  // - If pointer moves > threshold before release → drag mode
  // - If pointer releases before LONG_PRESS_MS    → tap mode
  // - If pointer held > LONG_PRESS_MS sin moverse → long-press: menú
  ev.preventDefault();
  slotEl.setPointerCapture?.(ev.pointerId);

  dragState = {
    pointerId: ev.pointerId,
    fromSlot: slotIdx,
    startX: ev.clientX,
    startY: ev.clientY,
    moved: false,
    ghostEl: null,
    hoverSlot: null,
    longPressed: false,
  };

  // Long-press: tras LONG_PRESS_MS sin moverse, abrir menú contextual
  if (longPressTimer) clearTimeout(longPressTimer);
  longPressTimer = setTimeout(() => {
    if (dragState && !dragState.moved && !dragState.longPressed) {
      dragState.longPressed = true;
      showItemContextMenu(slotIdx, dragState.startX, dragState.startY);
    }
  }, LONG_PRESS_MS);

  // Listen on document so we keep tracking even outside the slot
  document.addEventListener('pointermove', onPointerMove);
  document.addEventListener('pointerup', onPointerUp, { once: true });
  document.addEventListener('pointercancel', onPointerCancel, { once: true });
}

function onPointerMove(ev) {
  if (!dragState || ev.pointerId !== dragState.pointerId) return;

  const dx = ev.clientX - dragState.startX;
  const dy = ev.clientY - dragState.startY;

  // Promote to drag once threshold passed
  if (!dragState.moved && (Math.abs(dx) > DRAG_THRESHOLD_PX || Math.abs(dy) > DRAG_THRESHOLD_PX)) {
    dragState.moved = true;
    // Cancela long-press si se mueve
    if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
    // Si ya estaba el menú abierto, no abrir drag
    if (!dragState.longPressed) {
      createGhost(ev.clientX, ev.clientY);
    }
  }

  if (dragState.moved && !dragState.longPressed) {
    positionGhost(ev.clientX, ev.clientY);
    updateHoverSlot(ev.clientX, ev.clientY);
  }
}

function onPointerUp(ev) {
  document.removeEventListener('pointermove', onPointerMove);
  if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }

  if (!dragState || ev.pointerId !== dragState.pointerId) {
    dragState = null;
    return;
  }

  const { fromSlot, moved, hoverSlot, longPressed } = dragState;
  destroyGhost();

  if (longPressed) {
    // El menú está abierto; no hacer nada más con tap
    dragState = null;
    return;
  }

  if (moved) {
    // Drag: drop on the hovered slot (if any and different)
    if (hoverSlot !== null && hoverSlot !== fromSlot) {
      commitMove(fromSlot, hoverSlot);
    }
    selectedSlot = null;
  } else {
    // Tap: toggle selection (tap-to-tap mode)
    if (selectedSlot === null) {
      // First tap — select this slot
      selectedSlot = fromSlot;
    } else if (selectedSlot === fromSlot) {
      // Second tap on same slot — deselect
      selectedSlot = null;
    } else {
      // Second tap on a different slot — swap
      commitMove(selectedSlot, fromSlot);
      selectedSlot = null;
    }
  }

  dragState = null;
  renderAll();
}

function onPointerCancel() {
  document.removeEventListener('pointermove', onPointerMove);
  if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
  destroyGhost();
  dragState = null;
  renderAll();
}

// ============================================================
// Sesión 22 — Long-press context menu (Equipar / Cancelar)
// ============================================================

function showItemContextMenu(slotIdx, clientX, clientY) {
  const item = slots[slotIdx];
  if (!item) return;

  // Cerrar menú existente si lo hay
  const old = document.getElementById('invContextMenu');
  if (old) old.remove();

  // Asegurar estilos
  if (!document.getElementById('inv-context-menu-styles')) {
    const style = document.createElement('style');
    style.id = 'inv-context-menu-styles';
    style.textContent = `
      .inv-context-menu {
        position: fixed;
        z-index: 250;
        min-width: 150px;
        background: rgba(20, 14, 8, 0.97);
        border: 2px solid #c8a043;
        border-radius: 4px;
        box-shadow: 0 6px 20px rgba(0,0,0,0.75);
        padding: 4px;
        font-family: 'IM Fell English', serif;
        animation: invMenuFade 0.12s ease-out;
      }
      @keyframes invMenuFade {
        from { opacity: 0; transform: translateY(-4px); }
        to   { opacity: 1; transform: translateY(0); }
      }
      .inv-context-menu-header {
        padding: 4px 10px 6px;
        font-family: 'Cinzel', serif;
        font-weight: 700;
        font-size: 12px;
        color: #e8c560;
        text-shadow: 1px 1px 0 #000;
        border-bottom: 1px solid rgba(200,160,67,0.3);
        margin-bottom: 4px;
        display: flex;
        align-items: center;
        gap: 6px;
      }
      .inv-context-row {
        padding: 8px 12px;
        font-size: 13px;
        color: #f0e0b0;
        cursor: pointer;
        border-radius: 3px;
        display: flex;
        align-items: center;
        gap: 8px;
        text-shadow: 1px 1px 0 #000;
        -webkit-tap-highlight-color: transparent;
      }
      .inv-context-row:active {
        background: rgba(200, 160, 67, 0.25);
        color: #fff8d0;
      }
      .inv-context-row.danger { color: #ff9090; }
    `;
    document.head.appendChild(style);
  }

  const menu = document.createElement('div');
  menu.id = 'invContextMenu';
  menu.className = 'inv-context-menu';

  let html = `<div class="inv-context-menu-header">${item.icon || '?'} ${escapeHtml(item.name)}</div>`;
  if (item.equip_slot) {
    html += `<div class="inv-context-row" data-act="equip">⚔ Equipar</div>`;
  }
  html += `<div class="inv-context-row" data-act="examine">🔍 Examinar</div>`;
  html += `<div class="inv-context-row danger" data-act="cancel">✕ Cancelar</div>`;
  menu.innerHTML = html;

  document.body.appendChild(menu);

  // Posicionar evitando bordes
  const mw = menu.offsetWidth;
  const mh = menu.offsetHeight;
  let left = clientX + 8;
  let top = clientY + 8;
  if (left + mw > window.innerWidth - 4) left = window.innerWidth - mw - 4;
  if (top + mh > window.innerHeight - 4) top = clientY - mh - 8;
  if (top < 4) top = 4;
  menu.style.left = left + 'px';
  menu.style.top = top + 'px';

  menu.querySelectorAll('[data-act]').forEach(row => {
    row.addEventListener('pointerup', async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      const act = row.dataset.act;
      menu.remove();
      if (act === 'equip') {
        await doEquip(slotIdx);
      } else if (act === 'examine') {
        showError(item.name + (item.equip_slot ? ` · ${item.equip_slot}` : '') + (item.stackable ? ` · stackable (x${item.quantity})` : ''));
      }
      // 'cancel' o cualquier otra: nada
    });
  });

  // Cerrar al tap fuera
  const outsideClose = (e) => {
    if (!menu.contains(e.target)) {
      menu.remove();
      document.removeEventListener('pointerdown', outsideClose, true);
    }
  };
  setTimeout(() => document.addEventListener('pointerdown', outsideClose, true), 100);
}

async function doEquip(slotIdx) {
  const result = await equipment.equipFromInventory(slotIdx);
  if (result.error) {
    const msg = result.message || result.error;
    showError('No se pudo equipar: ' + msg);
    return;
  }
  // Refrescar inventario (el item se movió)
  await refresh();
}

function escapeHtml(s) {
  if (s == null) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ---------- Drag ghost (visual indicator under finger) ----------

function createGhost(x, y) {
  if (!dragState) return;
  const data = slots[dragState.fromSlot];
  if (!data) return;
  const ghost = document.createElement('div');
  ghost.className = 'inv-ghost';
  ghost.textContent = data.icon || '?';
  document.body.appendChild(ghost);
  dragState.ghostEl = ghost;
  positionGhost(x, y);
  // Also dim the source slot
  const srcEl = gridEl.children[dragState.fromSlot];
  if (srcEl) srcEl.classList.add('dragging');
}

function positionGhost(x, y) {
  if (!dragState?.ghostEl) return;
  dragState.ghostEl.style.left = `${x}px`;
  dragState.ghostEl.style.top  = `${y}px`;
}

function destroyGhost() {
  if (dragState?.ghostEl) {
    dragState.ghostEl.remove();
    dragState.ghostEl = null;
  }
  if (gridEl) {
    for (const child of gridEl.children) child.classList.remove('dragging', 'hover-target');
  }
}

function updateHoverSlot(x, y) {
  if (!dragState) return;
  // Find which slot element is under the pointer
  const el = document.elementFromPoint(x, y);
  const slotEl = el?.closest('.inv-slot');
  const newHover = slotEl ? parseInt(slotEl.dataset.slot, 10) : null;

  if (newHover === dragState.hoverSlot) return;

  // Clear old hover styling
  if (dragState.hoverSlot !== null) {
    const oldEl = gridEl.children[dragState.hoverSlot];
    if (oldEl) oldEl.classList.remove('hover-target');
  }
  // Apply new hover styling (only if it's a different slot than the source)
  if (newHover !== null && newHover !== dragState.fromSlot) {
    const el2 = gridEl.children[newHover];
    if (el2) el2.classList.add('hover-target');
  }
  dragState.hoverSlot = newHover;
}

// ============================================================
// COMMIT: optimistic update + server call + revert on failure
// ============================================================

async function commitMove(from, to) {
  if (from === to) return;
  if (from < 0 || from >= SLOTS || to < 0 || to >= SLOTS) return;

  // Snapshot for revert
  const before = { from: slots[from], to: slots[to] };

  // Apply optimistic move client-side using the same 4 cases the server uses
  applyClientMove(from, to);
  renderAll();

  // Persist
  try {
    await api.swapInventorySlots(from, to);
  } catch (err) {
    console.error('[inventory] swap failed, reverting:', err);
    // Revert
    slots[from] = before.from;
    slots[to]   = before.to;
    renderAll();
    showError('No se pudo mover el objeto.');
  }
}

/**
 * Client-side mirror of the server's swap logic.
 * Must match worker_NEW_slice4a.js semantics exactly.
 */
function applyClientMove(from, to) {
  const a = slots[from];
  const b = slots[to];

  // Case 1: from empty → no-op
  if (!a) return;

  // Case 2: to empty → move
  if (!b) {
    slots[to] = a;
    slots[from] = null;
    return;
  }

  // Case 3: both occupied, same stackable item → merge into `to`
  if (a.item_id === b.item_id && a.stackable && b.stackable) {
    slots[to] = { ...b, quantity: b.quantity + a.quantity };
    slots[from] = null;
    return;
  }

  // Case 4: both occupied, different → swap
  slots[from] = b;
  slots[to]   = a;
}
