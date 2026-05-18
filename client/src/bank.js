/**
 * SebasPresent — Bank module (Slice 4b + Sesión 26 SVG)
 *
 * Sesión 26 — Iconos renderizados como SVG custom cuando existe en
 * item_icons.js, fallback al emoji del server si no.
 *
 * Responsabilidades:
 * - Renderizar el banco DENTRO del pane data-tab="bank" del sidebar.
 * - El pane del banco contiene DOS grids visuales:
 *     - Arriba: el banco (slots dinamicos, scroll vertical, crece segun
 *       items que tengas)
 *     - Abajo: una replica del inventario (28 slots, mismo layout que
 *       el inventory tab, pero aqui es una vista paralela)
 * - Drag & drop entre los dos grids + dentro del banco (reordenar).
 * - Tap simple = depositar/retirar segun de donde venga (con la cantidad
 *   que indique el modo).
 * - Selector de cantidad: 1 / 5 / 10 / X / Todo (estilo OSRS).
 *
 * Interaccion con inventory.js:
 *   - Cuando el banco hace una operacion, llama a inventory.refresh()
 *     para mantener el otro tab actualizado.
 *   - Y refresca su propio mirror del inventario internamente.
 *
 * Patron de pointer events identico a inventory.js (validado en iOS).
 */

import * as api from './api.js';
import * as inventory from './inventory.js';
import { renderItemIcon } from './item_icons.js';

const INV_SLOTS = 28;
const DRAG_THRESHOLD_PX = 6;

let bankSlots = [];       // array dinamico de {slot, item_id, quantity, name, icon, stackable} | null
let invSlots = new Array(INV_SLOTS).fill(null); // mirror del inv para drag/drop

let bankGridEl = null;
let invMirrorEl = null;
let qtyButtonsEl = null;

let quantityMode = 1;     // 1, 5, 10, 'x', 'all'
let customQty = null;     // valor numerico cuando modo es 'x'

let dragState = null;     // { pointerId, source: 'bank'|'inv', slot, startX, startY, moved, ghostEl, hover }

let isInitialized = false;
let isOpen = false;       // si el tab del banco esta visible (lo controla ui.js)

/**
 * Inicializa el banco. Llamar despues del login (igual que inventory.init).
 */
export async function init() {
  if (isInitialized) return;

  const pane = document.querySelector('.osrs-tab-pane[data-tab="bank"]');
  if (!pane) {
    console.warn('[bank] Bank tab pane not found in DOM');
    return;
  }

  pane.innerHTML = `
    <div class="bank-root">
      <div class="bank-header">
        <span class="bank-title">Banco</span>
        <span class="bank-count" id="bankCount">0</span>
      </div>

      <div class="bank-qty-bar" id="bankQtyBar">
        <button class="bank-qty-btn active" data-qty="1">1</button>
        <button class="bank-qty-btn" data-qty="5">5</button>
        <button class="bank-qty-btn" data-qty="10">10</button>
        <button class="bank-qty-btn" data-qty="x">X</button>
        <button class="bank-qty-btn" data-qty="all">Todo</button>
      </div>

      <div class="bank-section-label">Banco</div>
      <div class="bank-grid" id="bankGrid"></div>

      <div class="bank-section-label">Mochila</div>
      <div class="bank-inv-grid" id="bankInvGrid"></div>

      <div class="bank-error" id="bankError"></div>
    </div>
  `;

  bankGridEl = document.getElementById('bankGrid');
  invMirrorEl = document.getElementById('bankInvGrid');
  qtyButtonsEl = document.getElementById('bankQtyBar');

  // Pre-crear los 28 slots del inv mirror (estaticos)
  for (let i = 0; i < INV_SLOTS; i++) {
    const slotEl = document.createElement('div');
    slotEl.className = 'bank-slot bank-slot-inv';
    slotEl.dataset.source = 'inv';
    slotEl.dataset.slot = String(i);
    slotEl.addEventListener('pointerdown', onSlotPointerDown);
    invMirrorEl.appendChild(slotEl);
  }

  // Listeners del selector de cantidad
  qtyButtonsEl.querySelectorAll('.bank-qty-btn').forEach(btn => {
    btn.addEventListener('pointerup', (ev) => {
      if (ev.button !== undefined && ev.button !== 0) return;
      ev.preventDefault();
      const val = btn.dataset.qty;
      if (val === 'x') {
        const input = prompt('Cantidad personalizada:', customQty || 100);
        if (input === null) return;
        const n = parseInt(input, 10);
        if (!Number.isFinite(n) || n <= 0) {
          showError('Cantidad inválida.');
          return;
        }
        customQty = n;
        quantityMode = 'x';
      } else if (val === 'all') {
        quantityMode = 'all';
      } else {
        quantityMode = parseInt(val, 10);
      }
      updateQtyButtons();
    });
  });

  await refresh();
  isInitialized = true;
}

/**
 * Llamado desde fuera cuando el tab del banco se hace visible.
 * Refresca para tener datos al dia (puede haber pasado tiempo o haberse
 * cambiado el inv en otro tab).
 */
export async function onOpen() {
  isOpen = true;
  await refresh();
}

export function onClose() {
  isOpen = false;
  // Limpia estado de drag por si quedo a medias
  if (dragState) {
    destroyGhost();
    dragState = null;
  }
}

/**
 * Refresca banco + mirror del inv desde el server.
 */
export async function refresh() {
  try {
    const [bankData, invData] = await Promise.all([
      api.getBank(),
      api.getInventory(),
    ]);
    applyBankSlots(bankData.slots || []);
    applyInvSlots(invData.slots || []);
    renderAll();
    clearError();
  } catch (err) {
    console.error('[bank] refresh failed:', err);
    showError('No se pudo cargar el banco.');
  }
}

function applyBankSlots(serverSlots) {
  // Densificamos: el server guarda slots posicionales (puede haber huecos),
  // pero visualmente queremos un grid compacto. Sin embargo, conservamos
  // el slot_index real del server para los swaps de reordenacion.
  bankSlots = serverSlots.map(s => ({
    slot: s.slot,
    item_id: s.item_id,
    quantity: s.quantity,
    name: s.name,
    icon: s.icon,
    stackable: !!s.stackable,
  }));
}

function applyInvSlots(serverSlots) {
  invSlots = new Array(INV_SLOTS).fill(null);
  for (const s of serverSlots) {
    if (s.slot < 0 || s.slot >= INV_SLOTS) continue;
    invSlots[s.slot] = {
      item_id: s.item_id,
      quantity: s.quantity,
      name: s.name,
      icon: s.icon,
      stackable: !!s.stackable,
    };
  }
}

function renderAll() {
  renderBank();
  renderInvMirror();
  const countEl = document.getElementById('bankCount');
  if (countEl) countEl.textContent = String(bankSlots.length);
}

function renderBank() {
  if (!bankGridEl) return;

  // Limpia y recrea (el banco es dinamico)
  bankGridEl.innerHTML = '';

  // Slots ocupados
  bankSlots.forEach((data, visualIdx) => {
    const slotEl = document.createElement('div');
    slotEl.className = 'bank-slot bank-slot-bank occupied';
    slotEl.dataset.source = 'bank';
    slotEl.dataset.slot = String(data.slot);     // slot real del server
    slotEl.dataset.visualIdx = String(visualIdx); // posicion visual
    slotEl.addEventListener('pointerdown', onSlotPointerDown);

    const iconEl = document.createElement('span');
    iconEl.className = 'bank-icon';
    // Sesión 26 — SVG custom si lo hay, fallback emoji del server
    renderItemIcon(iconEl, data.item_id, data.icon);
    slotEl.appendChild(iconEl);

    if (data.quantity > 1) {
      const qtyEl = document.createElement('span');
      qtyEl.className = 'bank-qty';
      qtyEl.textContent = formatQty(data.quantity);
      slotEl.appendChild(qtyEl);
    }

    bankGridEl.appendChild(slotEl);
  });

  // Algunos slots vacios visuales al final (para drag-to-empty al reordenar)
  // Renderiza siempre minimo 8 slots o multiplo de 4 superior al numero
  // ocupado, para tener huecos donde soltar.
  const minVisualSlots = Math.max(8, Math.ceil((bankSlots.length + 4) / 4) * 4);
  const emptyToAdd = Math.max(0, minVisualSlots - bankSlots.length);
  for (let i = 0; i < emptyToAdd; i++) {
    const slotEl = document.createElement('div');
    slotEl.className = 'bank-slot bank-slot-bank';
    slotEl.dataset.source = 'bank';
    // Slot logico: el siguiente despues del max actual + i
    const maxSlot = bankSlots.length > 0 ? Math.max(...bankSlots.map(s => s.slot)) : -1;
    slotEl.dataset.slot = String(maxSlot + 1 + i);
    slotEl.dataset.visualIdx = String(bankSlots.length + i);
    bankGridEl.appendChild(slotEl);
  }
}

function renderInvMirror() {
  if (!invMirrorEl) return;
  for (let i = 0; i < INV_SLOTS; i++) {
    const slotEl = invMirrorEl.children[i];
    if (!slotEl) continue;
    const data = invSlots[i];
    slotEl.innerHTML = '';
    slotEl.classList.toggle('occupied', data !== null);

    if (!data) continue;

    const iconEl = document.createElement('span');
    iconEl.className = 'bank-icon';
    // Sesión 26 — SVG custom si lo hay, fallback emoji del server
    renderItemIcon(iconEl, data.item_id, data.icon);
    slotEl.appendChild(iconEl);

    if (data.stackable && data.quantity > 1) {
      const qtyEl = document.createElement('span');
      qtyEl.className = 'bank-qty';
      qtyEl.textContent = formatQty(data.quantity);
      slotEl.appendChild(qtyEl);
    }
  }
}

function updateQtyButtons() {
  qtyButtonsEl.querySelectorAll('.bank-qty-btn').forEach(btn => {
    const val = btn.dataset.qty;
    let active = false;
    if (val === 'x' && quantityMode === 'x') {
      active = true;
      btn.textContent = `X (${customQty})`;
    } else if (val === 'x') {
      btn.textContent = 'X';
    } else if (val === 'all' && quantityMode === 'all') {
      active = true;
    } else if (typeof quantityMode === 'number' && parseInt(val, 10) === quantityMode) {
      active = true;
    }
    btn.classList.toggle('active', active);
  });
}

function getEffectiveQuantity() {
  if (quantityMode === 'all') return -1;
  if (quantityMode === 'x') return customQty || 1;
  return quantityMode;
}

function formatQty(n) {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return Math.floor(n / 1000) + 'K';
  return Math.floor(n / 1_000_000) + 'M';
}

function showError(msg) {
  const el = document.getElementById('bankError');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('visible');
  setTimeout(() => el.classList.remove('visible'), 2500);
}
function clearError() {
  const el = document.getElementById('bankError');
  if (el) el.classList.remove('visible');
}

// ============================================================
// DRAG & DROP
// ============================================================

function onSlotPointerDown(ev) {
  if (ev.button !== undefined && ev.button !== 0) return;

  const slotEl = ev.currentTarget;
  const source = slotEl.dataset.source; // 'bank' | 'inv'
  const slot = parseInt(slotEl.dataset.slot, 10);

  // Si esta vacio, no hay nada que arrastrar. Tap-to-tap no aplica aqui
  // porque la interaccion natural es origen->destino con cantidad fija,
  // no la seleccion de OSRS Mobile del inv.
  const data = getSlotData(source, slot);
  if (!data) return;

  ev.preventDefault();
  slotEl.setPointerCapture?.(ev.pointerId);

  dragState = {
    pointerId: ev.pointerId,
    source,
    slot,
    sourceEl: slotEl,
    startX: ev.clientX,
    startY: ev.clientY,
    moved: false,
    ghostEl: null,
    hover: null, // { source, slot, el }
  };

  document.addEventListener('pointermove', onPointerMove);
  document.addEventListener('pointerup', onPointerUp, { once: true });
  document.addEventListener('pointercancel', onPointerCancel, { once: true });
}

function getSlotData(source, slot) {
  if (source === 'bank') {
    return bankSlots.find(s => s.slot === slot) || null;
  }
  if (source === 'inv') {
    return invSlots[slot] || null;
  }
  return null;
}

function onPointerMove(ev) {
  if (!dragState || ev.pointerId !== dragState.pointerId) return;

  const dx = ev.clientX - dragState.startX;
  const dy = ev.clientY - dragState.startY;

  if (!dragState.moved && (Math.abs(dx) > DRAG_THRESHOLD_PX || Math.abs(dy) > DRAG_THRESHOLD_PX)) {
    dragState.moved = true;
    createGhost(ev.clientX, ev.clientY);
  }

  if (dragState.moved) {
    positionGhost(ev.clientX, ev.clientY);
    updateHover(ev.clientX, ev.clientY);
  }
}

function onPointerUp(ev) {
  document.removeEventListener('pointermove', onPointerMove);

  if (!dragState || ev.pointerId !== dragState.pointerId) {
    dragState = null;
    return;
  }

  const { source, slot, moved, hover } = dragState;
  destroyGhost();

  if (!moved) {
    // TAP: equivale a "mover al otro lado" con la cantidad seleccionada
    handleTap(source, slot);
  } else if (hover) {
    handleDrop(source, slot, hover.source, hover.slot);
  }

  dragState = null;
}

function onPointerCancel() {
  document.removeEventListener('pointermove', onPointerMove);
  destroyGhost();
  dragState = null;
}

function createGhost(x, y) {
  if (!dragState) return;
  const data = getSlotData(dragState.source, dragState.slot);
  if (!data) return;
  const ghost = document.createElement('div');
  ghost.className = 'bank-ghost';
  // Sesión 26 — SVG custom si lo hay, fallback emoji
  renderItemIcon(ghost, data.item_id, data.icon);
  document.body.appendChild(ghost);
  dragState.ghostEl = ghost;
  positionGhost(x, y);
  dragState.sourceEl?.classList.add('dragging');
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
  // Limpiar highlights
  document.querySelectorAll('.bank-slot.dragging, .bank-slot.hover-target')
    .forEach(el => el.classList.remove('dragging', 'hover-target'));
}

function updateHover(x, y) {
  if (!dragState) return;
  const el = document.elementFromPoint(x, y);
  const slotEl = el?.closest('.bank-slot');

  // Quita highlight anterior
  if (dragState.hover?.el) {
    dragState.hover.el.classList.remove('hover-target');
  }

  if (!slotEl) {
    dragState.hover = null;
    return;
  }

  const source = slotEl.dataset.source;
  const slot = parseInt(slotEl.dataset.slot, 10);

  // No marcar como target si es el mismo de origen
  if (source === dragState.source && slot === dragState.slot) {
    dragState.hover = null;
    return;
  }

  slotEl.classList.add('hover-target');
  dragState.hover = { source, slot, el: slotEl };
}

// ============================================================
// ACCIONES: tap y drop
// ============================================================

async function handleTap(source, slot) {
  // Tap en banco -> retirar al inv
  // Tap en inv -> depositar al banco
  const qty = getEffectiveQuantity();
  if (source === 'bank') {
    await doWithdraw(slot, qty, undefined);
  } else {
    await doDeposit(slot, qty);
  }
}

async function handleDrop(srcSource, srcSlot, dstSource, dstSlot) {
  const qty = getEffectiveQuantity();

  // Inv -> Banco: deposito (la cantidad sale del slot origen; dst es indicativo
  // pero el server siempre apila por item, asi que dstSlot del banco se ignora)
  if (srcSource === 'inv' && dstSource === 'bank') {
    await doDeposit(srcSlot, qty);
    return;
  }

  // Banco -> Inv: retirada. dstSlot del inv es el slot deseado.
  if (srcSource === 'bank' && dstSource === 'inv') {
    await doWithdraw(srcSlot, qty, dstSlot);
    return;
  }

  // Banco -> Banco: reordenar
  if (srcSource === 'bank' && dstSource === 'bank') {
    await doBankReorder(srcSlot, dstSlot);
    return;
  }

  // Inv -> Inv: dejamos que el modulo de inventario gestione esto.
  // El usuario probablemente queria reordenar la mochila — derivamos.
  if (srcSource === 'inv' && dstSource === 'inv') {
    if (srcSlot === dstSlot) return;
    try {
      await api.swapInventorySlots(srcSlot, dstSlot);
      await refresh();
      await inventory.refresh();
    } catch (err) {
      console.error('[bank] inv-inv swap failed:', err);
      showError('No se pudo mover.');
    }
  }
}

async function doDeposit(invSlot, qty) {
  const data = invSlots[invSlot];
  if (!data) return;

  try {
    await api.depositToBank(invSlot, qty);
    await refresh();
    await inventory.refresh();
  } catch (err) {
    console.error('[bank] deposit failed:', err);
    showError(err.message || 'No se pudo depositar.');
  }
}

async function doWithdraw(bankSlot, qty, targetInvSlot) {
  const data = bankSlots.find(s => s.slot === bankSlot);
  if (!data) return;

  try {
    await api.withdrawFromBank(bankSlot, qty, targetInvSlot);
    await refresh();
    await inventory.refresh();
  } catch (err) {
    console.error('[bank] withdraw failed:', err);
    showError(err.message || 'No se pudo retirar.');
  }
}

async function doBankReorder(fromSlot, toSlot) {
  if (fromSlot === toSlot) return;
  try {
    await api.swapBankSlots(fromSlot, toSlot);
    await refresh();
  } catch (err) {
    console.error('[bank] reorder failed:', err);
    showError('No se pudo reordenar.');
  }
}
