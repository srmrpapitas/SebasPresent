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
 * - Render a 4×5 grid (20 slots) inside the OSRS sidebar's Inventory tab
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
import { renderItemIcon, getItemIconHtml } from './item_icons.js';

// ---------- Constants ----------
// Sesión 33 — Reducido de 28 → 20 (4×5) para que entre sin scroll en mobile.
// Items que existían en slots ≥20 fueron borrados por migración SQL (no se
// consolidaron — decisión de Nico, ver INVARIANTS sección 15).
const SLOTS = 20; // 4 columns × 5 rows
const LONG_PRESS_MS = 450;

// ---------- State ----------
/**
 * `slots` is a sparse array of length 20.
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
      <span class="inv-count" id="invCount">0/20</span>
    </div>
    <div class="inv-grid" id="invGrid"></div>
    <div class="inv-error" id="invError"></div>
  `;
  gridEl = document.getElementById('invGrid');

  // Build 20 empty slot elements (we'll fill them once data arrives)
  for (let i = 0; i < SLOTS; i++) {
    const slotEl = document.createElement('div');
    slotEl.className = 'inv-slot';
    slotEl.dataset.slot = String(i);
    slotEl.addEventListener('pointerdown', onSlotPointerDown);
    gridEl.appendChild(slotEl);
  }

  // Sesión 38 — Desktop: suprimir el menú contextual nativo del navegador
  // dentro de la mochila. El click derecho lo gestiona onSlotPointerDown
  // (abre nuestro menú Equipar/Examinar/Cancelar).
  gridEl.addEventListener('contextmenu', (e) => e.preventDefault());

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

/**
 * Sesión 35 — Decrementa la cantidad de un item_id del inv local.
 * Usado por combat.js cuando el server consume una flecha (source='inventory'):
 * el server es source-of-truth en DB, pero el cliente necesita reflejar el
 * cambio en la UI sin hacer un refresh() completo (que sería 1 fetch por
 * cada ataque ranged — caro y lento).
 *
 * Estrategia: encuentra el primer slot (slot_index ASC) con ese item_id y
 * quantity>0, mismo orden que el server usa para consumir, así inv local y
 * server quedan en sync. Si quantity llega a 0, vacía el slot.
 *
 * @param {string} itemId - ej. 'arrow_bronze'
 * @param {number} qty    - default 1
 * @returns {boolean} true si se decrementó algo, false si no había stock
 */
export function decrementItem(itemId, qty = 1) {
  if (!itemId || qty <= 0) return false;
  for (let i = 0; i < SLOTS; i++) {
    const s = slots[i];
    if (s && s.item_id === itemId && s.quantity > 0) {
      const newQty = s.quantity - qty;
      if (newQty <= 0) {
        slots[i] = null;
      } else {
        slots[i] = { ...s, quantity: newQty };
      }
      renderAll();
      return true;
    }
  }
  return false;
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
      weapon_type: s.weapon_type || null, // S33 — failsafe para "Equipar"
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

  // Icon: SVG custom si lo hay, emoji del server si no
  const iconEl = document.createElement('span');
  iconEl.className = 'inv-icon';
  renderItemIcon(iconEl, data.item_id, data.icon);
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
  const isMouse = ev.pointerType === 'mouse';
  const isRight = isMouse && ev.button === 2;

  const slotEl = ev.currentTarget;
  const slotIdx = parseInt(slotEl.dataset.slot, 10);
  const data = slots[slotIdx];

  // Sesión 38 — Desktop: CLICK DERECHO = equivalente al long-press de móvil.
  // Abre el mismo menú contextual (Equipar / Examinar / Cancelar). El menú
  // nativo del navegador se suprime con el listener 'contextmenu' (ver init()).
  if (isRight) {
    ev.preventDefault();
    if (data) showItemContextMenu(slotIdx, ev.clientX, ev.clientY);
    return;
  }

  // Ignore non-primary buttons (botón central, etc.)
  if (ev.button !== undefined && ev.button !== 0) return;

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
    isMouse,
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

  const { fromSlot, moved, hoverSlot, longPressed, isMouse } = dragState;
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
    // Sesión 38 — Desktop: un CLICK NORMAL (botón izq del ratón) sobre un item
    // EQUIPABLE lo equipa directo (estilo OSRS-PC). En móvil (touch) y para
    // items NO equipables se mantiene el tap-to-tap para mover/intercambiar.
    const data = slots[fromSlot];
    if (isMouse && isEquipableItem(data)) {
      selectedSlot = null;
      doEquip(fromSlot);
    } else if (selectedSlot === null) {
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
      .inv-context-menu-icon {
        display: inline-flex;
        width: 22px; height: 22px;
        align-items: center; justify-content: center;
      }
      .inv-context-menu-icon svg { width: 100%; height: 100%; }
      .inv-icon svg { width: 100%; height: 100%; display: block; }
      .inv-ghost svg { width: 100%; height: 100%; }
    `;
    document.head.appendChild(style);
  }

  const menu = document.createElement('div');
  menu.id = 'invContextMenu';
  menu.className = 'inv-context-menu';

  let html = `<div class="inv-context-menu-header"><span class="inv-context-menu-icon">${getItemIconHtml(item.item_id, item.icon)}</span> ${escapeHtml(item.name)}</div>`;
  // S33 — Triple failsafe para mostrar "Equipar" (ver isEquipableItem()).
  // El server valida el equip de todas formas; si el item NO es equipable
  // por más que el menú lo muestre, el server rechaza y el cliente avisa.
  const isEquipable = isEquipableItem(item);
  if (isEquipable) {
    html += `<div class="inv-context-row" data-act="equip">⚔ Equipar</div>`;
  }
  // Sesión 30 — Encender fuego: aparece solo si el item es un log
  // y el player tiene un yesquero en inv.
  const fm = (typeof window !== 'undefined') ? window.__firemaking : null;
  if (fm && fm.isLogItem && fm.isLogItem(item.item_id) && hasTinderboxInInventory()) {
    html += `<div class="inv-context-row" data-act="light_fire">🔥 Encender fuego</div>`;
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
      } else if (act === 'light_fire') {
        // Sesión 30 — Encender fuego desde un log
        try {
          await window.__firemaking?.lightFireFromSlot?.(slotIdx);
        } catch (err) {
          console.warn('[inventory] light_fire err:', err);
        }
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

// ============================================================
// Sesión 38 — ¿el item es equipable? Triple failsafe compartido por el
// menú contextual (Equipar) y el click-izq-equipa de desktop.
//   1) equip_slot poblado (lógica vieja)
//   2) weapon_type poblado (failsafe nivel 2)
//   3) item_id matchea pattern de weapon conocida (failsafe nivel 3)
// ============================================================
function isEquipableItem(item) {
  if (!item) return false;
  const isWeaponByName = /^(axe|pickaxe|sword|bow|staff|dagger|hammer|spear|shield)(_|$)/i.test(item.item_id || '');
  return !!(item.equip_slot || item.weapon_type || isWeaponByName);
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
  renderItemIcon(ghost, data.item_id, data.icon);
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

// ============================================================
// Sesión 30 — Helper para detectar tinderbox en cualquier slot.
// Usado por el context menu para decidir si mostrar "Encender fuego".
// ============================================================
function hasTinderboxInInventory() {
  for (let i = 0; i < SLOTS; i++) {
    const s = slots[i];
    if (s && s.item_id === 'tinderbox') return true;
  }
  return false;
}
