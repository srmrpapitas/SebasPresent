/**
 * SebasPresent — Inventory module (Slice 4a)
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

// ---------- Constants ----------
const SLOTS = 28; // 4 columns × 7 rows, OSRS-style

// ---------- State ----------
/**
 * `slots` is a sparse array of length 28.
 * Each entry is either null (empty) or { item_id, quantity, name, icon, stackable }.
 */
let slots = new Array(SLOTS).fill(null);
let gridEl = null;
let selectedSlot = null; // tap-to-tap source, or null
let dragState = null;    // active drag, or null
let isInitialized = false;

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
// INTERACTION: drag & drop + tap-to-tap (unified pointer events)
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

  // Tapping an occupied slot: start drag tracking.
  // If pointer moves > threshold before release → drag mode
  // If pointer releases before threshold      → tap mode
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
  };

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
    createGhost(ev.clientX, ev.clientY);
  }

  if (dragState.moved) {
    positionGhost(ev.clientX, ev.clientY);
    updateHoverSlot(ev.clientX, ev.clientY);
  }
}

function onPointerUp(ev) {
  document.removeEventListener('pointermove', onPointerMove);

  if (!dragState || ev.pointerId !== dragState.pointerId) {
    dragState = null;
    return;
  }

  const { fromSlot, moved, hoverSlot } = dragState;
  destroyGhost();

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
  destroyGhost();
  dragState = null;
  renderAll();
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
