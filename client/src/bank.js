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
 *     - Abajo: una replica del inventario (20 slots desde S33, mismo layout que
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

// Sesión 26 — CSS inyectado para layout compacto del banco (6 columnas
// estilo OSRS). Se inyecta una sola vez al cargar el módulo. Usamos
// !important porque sobreescribe estilos definidos en otro lado del
// proyecto que no podemos editar desde aquí.
(function injectBankLayoutStyles() {
  if (typeof document === 'undefined') return;
  if (document.getElementById('bank-layout-compact-styles')) return;
  const style = document.createElement('style');
  style.id = 'bank-layout-compact-styles';
  style.textContent = `
    /* Sesión 52 — banco estilo OSRS: banco con scroll + mochila siempre visible,
       controles pequeños en una esquina inferior, nombres bajo cada icono. */
    .bank-root {
      display: flex !important; flex-direction: column; gap: 4px;
      flex: 1 1 auto; min-height: 0; width: 100%; height: 100%; box-sizing: border-box;
    }
    .bank-top { display: flex; align-items: center; gap: 6px; flex: 0 0 auto; }
    .bank-search {
      flex: 1 1 auto; min-width: 0; height: 28px; box-sizing: border-box; padding: 0 8px;
      font: 13px 'IM Fell English', serif; color: #f0e0b0;
      background: rgba(10,6,3,0.75); border: 1px solid #5a4020; border-radius: 4px; outline: none;
    }
    .bank-search:focus { border-color: #c8a043; }
    .bank-search::placeholder { color: rgba(200,170,120,0.5); }
    .bank-count { font: 11px 'IM Fell English', serif; color: rgba(200,170,120,0.8); white-space: nowrap; }
    .bank-main { display: flex; flex-direction: column; gap: 6px; flex: 1 1 auto; min-height: 0; }
    .bank-area {
      position: relative; flex: 1 1 auto; min-height: 90px; display: flex; flex-direction: column;
      border: 1px solid #3a2a1a; border-radius: 4px; background: rgba(0,0,0,0.25); overflow: hidden;
    }
    .bank-scroll {
      flex: 1 1 auto; min-height: 0; overflow-y: auto; overscroll-behavior: contain;
      -webkit-overflow-scrolling: touch; padding-bottom: 34px; /* hueco para los controles */
    }
    .bank-grid {
      display: grid !important;
      grid-template-columns: repeat(auto-fill, minmax(56px, 1fr)) !important;
      gap: 3px !important;
      padding: 4px !important;
    }
    .bank-slot-bank {
      width: 100% !important; min-width: 0 !important; max-width: none !important;
      aspect-ratio: auto !important; height: 62px !important; min-height: 0 !important; max-height: none !important;
      font-size: 24px !important; padding: 2px 1px 0 !important;
      position: relative !important; box-sizing: border-box !important;
      display: flex !important; flex-direction: column !important; align-items: center !important; justify-content: flex-start !important;
    }
    .bank-slot-bank .bank-icon {
      font-size: inherit !important; flex: 0 0 auto; height: 34px; width: 34px;
      display: flex; align-items: center; justify-content: center; margin-top: 2px;
    }
    .bank-slot-bank .bank-icon svg { width: 100%; height: 100%; }
    .bank-slot-bank .bank-qty { font-size: 10px !important; }
    .bank-slot.bank-slot-bank { touch-action: pan-y !important; -webkit-user-select: none; user-select: none; -webkit-touch-callout: none; }
    .bank-name {
      display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
      width: 100%; margin-top: 1px; padding: 0 1px; box-sizing: border-box;
      font: 8.5px/1.1 'IM Fell English', Georgia, serif; color: #e6d3a3; text-align: center;
      text-shadow: 0 1px 1px #000; word-break: break-word; pointer-events: none;
    }
    .bank-empty-msg { padding: 14px; text-align: center; font: 12px 'IM Fell English', serif; color: rgba(200,170,120,0.6); }

    /* Controles pequeños en la esquina inferior derecha del banco */
    .bank-controls {
      position: absolute; right: 4px; bottom: 4px; z-index: 2;
      display: flex; gap: 2px; padding: 2px; border-radius: 4px;
      background: rgba(20,12,6,0.92); border: 1px solid #5a4020; box-shadow: 0 2px 6px rgba(0,0,0,0.6);
    }
    .bank-controls .bank-qty-bar { display: flex !important; gap: 2px !important; margin: 0 !important; padding: 0 !important; }
    .bank-controls .bank-qty-btn, .bank-controls .bank-note-btn {
      width: auto !important; min-width: 26px; height: 24px; margin: 0 !important; padding: 0 5px !important;
      font: bold 11px 'IM Fell English', serif !important; flex: 0 0 auto !important;
      display: flex; align-items: center; justify-content: center;
      color: #d8c89a; background: rgba(60,45,30,0.85); border: 1px solid #3a2a1a; border-radius: 3px;
      cursor: pointer; -webkit-tap-highlight-color: transparent; touch-action: manipulation;
    }
    .bank-controls .bank-qty-btn.active { background: rgba(140,100,40,0.95) !important; border-color: #e8c560 !important; color: #fff3c0 !important; }
    .bank-controls .bank-note-btn.on { background: rgba(140,100,40,0.95) !important; border-color: #e8c560 !important; color: #fff3c0 !important; }

    /* Mochila siempre visible */
    .bank-inv-panel {
      flex: 0 0 auto; display: flex; flex-direction: column; gap: 2px;
      border: 1px solid #3a2a1a; border-radius: 4px; background: rgba(0,0,0,0.25); padding: 3px;
    }
    .bank-inv-panel .bank-section-label { margin: 0 0 1px 2px !important; font-size: 11px; }
    .bank-inv-panel .bank-inv-grid {
      display: grid !important; grid-template-columns: repeat(10, 1fr) !important; gap: 2px !important; padding: 0 !important;
    }
    .bank-inv-panel .bank-slot-inv {
      width: 100% !important; min-width: 0 !important; height: auto !important; aspect-ratio: 1 / 1 !important;
      font-size: 18px !important; padding: 0 !important; position: relative !important; box-sizing: border-box !important;
    }
    .bank-inv-panel .bank-slot-inv { display: flex !important; align-items: center !important; justify-content: center !important; overflow: hidden !important; }
    .bank-inv-panel .bank-slot-inv .bank-icon {
      width: 78%; height: 78%; max-width: 40px; max-height: 40px;
      display: flex; align-items: center; justify-content: center; font-size: inherit !important;
    }
    .bank-inv-panel .bank-slot-inv .bank-icon svg, .bank-inv-panel .bank-slot-inv .bank-icon img { width: 100% !important; height: 100% !important; }
    .bank-inv-panel .bank-slot-inv .bank-qty { font-size: 9px !important; }
    @media (orientation: portrait) and (max-width: 420px) {
      .bank-inv-panel .bank-inv-grid { grid-template-columns: repeat(5, 1fr) !important; }
      .bank-inv-panel .bank-slot-inv { aspect-ratio: auto !important; height: 38px !important; }
    }
    /* Pantallas anchas / móvil en horizontal: mochila a la derecha como OSRS */
    @media (min-width: 700px), (orientation: landscape) and (min-width: 560px) {
      .bank-main { flex-direction: row; }
      .bank-inv-panel { width: 200px; align-self: stretch; overflow-y: auto; }
      .bank-inv-panel .bank-inv-grid { grid-template-columns: repeat(4, 1fr) !important; }
    }
    @media (orientation: landscape) and (max-height: 480px) {
      .bank-inv-panel { width: 168px; }
      .bank-inv-panel .bank-slot-inv { aspect-ratio: auto !important; height: calc((100dvh - 120px) / 5) !important; max-height: 44px; }
    }
    .bank-error { flex: 0 0 auto; }

    /* Cuadro para la cantidad X (sustituye a prompt()) */
    .bank-xbox {
      position: absolute; right: 4px; bottom: 34px; z-index: 3; display: none; gap: 4px; align-items: center;
      padding: 5px; border-radius: 4px; background: rgba(20,12,6,0.97); border: 1px solid #c8a043;
    }
    .bank-xbox.visible { display: flex; }
    .bank-xbox input {
      width: 84px; height: 26px; box-sizing: border-box; padding: 0 6px; font: 14px 'IM Fell English', serif;
      color: #f0e0b0; background: rgba(10,6,3,0.85); border: 1px solid #5a4020; border-radius: 3px; outline: none;
    }
    .bank-xbox button {
      height: 26px; padding: 0 8px; font: bold 12px 'IM Fell English', serif; color: #fff3c0;
      background: rgba(140,100,40,0.95); border: 1px solid #e8c560; border-radius: 3px; cursor: pointer;
    }
  `;
  document.head.appendChild(style);
})();

// Sesión 33 — Reducido de 28 → 20 para matchear el inventory principal.
// El mirror del inv DENTRO del banco también es 4×5 ahora.
const INV_SLOTS = 20;
const DRAG_THRESHOLD_PX = 6;

let bankSlots = [];       // array dinamico de {slot, item_id, quantity, name, icon, stackable} | null
let invSlots = new Array(INV_SLOTS).fill(null); // mirror del inv para drag/drop

let bankGridEl = null;
let invMirrorEl = null;
let qtyButtonsEl = null;

let quantityMode = 1;     // 1, 5, 10, 'x', 'all'
let searchText = '';      // filtro por nombre (solo visual)
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
      <div class="bank-top">
        <input class="bank-search" id="bankSearch" type="search" placeholder="Buscar en el banco…" autocomplete="off" autocorrect="off" spellcheck="false" enterkeyhint="search">
        <span class="bank-count" id="bankCount">0</span>
      </div>

      <div class="bank-main">
        <div class="bank-area">
          <div class="bank-scroll" id="bankScroll">
            <div class="bank-grid" id="bankGrid"></div>
          </div>
          <div class="bank-xbox" id="bankXBox">
            <input type="number" inputmode="numeric" min="1" id="bankXInput" placeholder="Cantidad">
            <button id="bankXOk">OK</button>
          </div>
          <div class="bank-controls">
            <button class="bank-note-btn" id="bankNoteBtn" title="Sacar como nota: los objetos que no se apilan salen en un solo hueco">📜</button>
            <div class="bank-qty-bar" id="bankQtyBar">
              <button class="bank-qty-btn active" data-qty="1">1</button>
              <button class="bank-qty-btn" data-qty="5">5</button>
              <button class="bank-qty-btn" data-qty="10">10</button>
              <button class="bank-qty-btn" data-qty="x">X</button>
              <button class="bank-qty-btn" data-qty="all">Todo</button>
            </div>
          </div>
        </div>

        <div class="bank-inv-panel">
          <div class="bank-section-label">Mochila</div>
          <div class="bank-inv-grid" id="bankInvGrid"></div>
        </div>
      </div>

      <div class="bank-error" id="bankError"></div>
    </div>
  `;

  bankGridEl = document.getElementById('bankGrid');
  // Mientras se arrastra un objeto del banco, que la lista no haga scroll
  document.getElementById('bankScroll')?.addEventListener('touchmove', (e) => {
    if (dragState && dragState.armed) e.preventDefault();
  }, { passive: false });
  invMirrorEl = document.getElementById('bankInvGrid');
  qtyButtonsEl = document.getElementById('bankQtyBar');

  // Pre-crear los 20 slots del inv mirror (estaticos)
  for (let i = 0; i < INV_SLOTS; i++) {
    const slotEl = document.createElement('div');
    slotEl.className = 'bank-slot bank-slot-inv';
    slotEl.dataset.source = 'inv';
    slotEl.dataset.slot = String(i);
    slotEl.addEventListener('pointerdown', onSlotPointerDown);
    invMirrorEl.appendChild(slotEl);
  }

  // Sesión 50 — interruptor de notas de banco
  const noteBtn = document.getElementById('bankNoteBtn');
  noteBtn?.addEventListener('pointerup', (ev) => {
    ev.preventDefault();
    withdrawAsNote = !withdrawAsNote;
    noteBtn.classList.toggle('on', withdrawAsNote);
    noteBtn.title = withdrawAsNote ? 'Sacando como nota (toca para quitar)' : 'Sacar como nota';
    showError(withdrawAsNote ? 'Sacar como nota: SÍ' : 'Sacar como nota: NO', true);
  });
  ensureNoteCss();

  // Buscador por nombre
  const searchEl = document.getElementById('bankSearch');
  searchEl?.addEventListener('input', () => {
    searchText = (searchEl.value || '').trim().toLowerCase();
    renderBank();
  });

  // Cuadro de cantidad X
  const xBox = document.getElementById('bankXBox');
  const xInput = document.getElementById('bankXInput');
  const confirmX = () => {
    const n = parseInt(xInput.value, 10);
    if (!Number.isFinite(n) || n <= 0) { showError('Cantidad inválida.'); return; }
    customQty = Math.min(n, 2_000_000_000);
    quantityMode = 'x';
    xBox.classList.remove('visible');
    xInput.blur();
    updateQtyButtons();
  };
  document.getElementById('bankXOk')?.addEventListener('pointerup', (ev) => { ev.preventDefault(); confirmX(); });
  xInput?.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') { ev.preventDefault(); confirmX(); }
    else if (ev.key === 'Escape') { xBox.classList.remove('visible'); }
  });

  // Listeners del selector de cantidad
  qtyButtonsEl.querySelectorAll('.bank-qty-btn').forEach(btn => {
    btn.addEventListener('pointerup', (ev) => {
      if (ev.button !== undefined && ev.button !== 0) return;
      ev.preventDefault();
      const val = btn.dataset.qty;
      if (val === 'x') {
        const xBox = document.getElementById('bankXBox');
        const xInput = document.getElementById('bankXInput');
        const show = !xBox.classList.contains('visible');
        xBox.classList.toggle('visible', show);
        if (show) { xInput.value = customQty || ''; setTimeout(() => xInput.focus(), 30); }
        return;
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

  const filtering = searchText.length > 0;
  const shown = filtering
    ? bankSlots.filter(d => String(d.name || d.item_id || '').toLowerCase().includes(searchText)
                        || String(d.item_id || '').toLowerCase().replace(/_/g, ' ').includes(searchText))
    : bankSlots;

  shown.forEach((data, visualIdx) => {
    const slotEl = document.createElement('div');
    slotEl.className = 'bank-slot bank-slot-bank occupied';
    slotEl.dataset.source = 'bank';
    slotEl.dataset.slot = String(data.slot);     // slot real del server
    slotEl.dataset.visualIdx = String(visualIdx); // posicion visual
    slotEl.title = data.name || '';
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

    // Sesión 52 — nombre pequeño bajo el icono (solo en el banco)
    const nameEl = document.createElement('span');
    nameEl.className = 'bank-name';
    nameEl.textContent = data.name || String(data.item_id || '').replace(/_/g, ' ');
    slotEl.appendChild(nameEl);

    bankGridEl.appendChild(slotEl);
  });

  if (filtering) {
    if (!shown.length) {
      const msg = document.createElement('div');
      msg.className = 'bank-empty-msg';
      msg.style.gridColumn = '1 / -1';
      msg.textContent = 'No hay nada con ese nombre.';
      bankGridEl.appendChild(msg);
    }
    return; // sin huecos vacios mientras se busca
  }

  // Algunos slots vacios al final (para soltar al reordenar)
  const minVisualSlots = Math.max(8, Math.ceil((bankSlots.length + 4) / 4) * 4);
  const emptyToAdd = Math.max(0, minVisualSlots - bankSlots.length);
  const maxSlot = bankSlots.length > 0 ? Math.max(...bankSlots.map(s => s.slot)) : -1;
  for (let i = 0; i < emptyToAdd; i++) {
    const slotEl = document.createElement('div');
    slotEl.className = 'bank-slot bank-slot-bank';
    slotEl.dataset.source = 'bank';
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

let errTimer = null;
function showError(msg, info = false) {
  const el = document.getElementById('bankError');
  if (!el) return;
  el.textContent = msg;
  el.classList.toggle('info', !!info);
  el.classList.add('visible');
  clearTimeout(errTimer);
  errTimer = setTimeout(() => el.classList.remove('visible'), 2500);
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
  if (dragState) return; // ya hay otro dedo arrastrando

  // Sesión 52 — en el banco con el dedo: deslizar = scroll; mantener ~0,2 s = arrastrar.
  const holdToDrag = source === 'bank' && ev.pointerType !== 'mouse';
  if (!holdToDrag) {
    ev.preventDefault();
    slotEl.setPointerCapture?.(ev.pointerId);
  }

  dragState = {
    armed: !holdToDrag,
    holdTimer: holdToDrag ? setTimeout(() => {
      if (!dragState || dragState.moved) return;
      dragState.armed = true;
      try { slotEl.setPointerCapture?.(ev.pointerId); } catch {}
      slotEl.classList.add('dragging');
      try { navigator.vibrate?.(15); } catch {}
    }, 220) : null,
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
  document.addEventListener('pointerup', onPointerUp);
  document.addEventListener('pointercancel', onPointerCancel);
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
    if (!dragState.armed) {
      // Se movió antes de mantener: es scroll, no arrastre
      clearTimeout(dragState.holdTimer);
      detachDocListeners();
      dragState = null;
      return;
    }
    dragState.moved = true;
    createGhost(ev.clientX, ev.clientY);
  }

  if (dragState.moved) {
    positionGhost(ev.clientX, ev.clientY);
    updateHover(ev.clientX, ev.clientY);
  }
}

function detachDocListeners() {
  document.removeEventListener('pointermove', onPointerMove);
  document.removeEventListener('pointerup', onPointerUp);
  document.removeEventListener('pointercancel', onPointerCancel);
}

function onPointerUp(ev) {
  if (dragState && ev.pointerId !== dragState.pointerId) return; // otro dedo: ignorar
  detachDocListeners();
  if (!dragState) return;

  clearTimeout(dragState.holdTimer);
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

function onPointerCancel(ev) {
  if (dragState && ev && ev.pointerId !== dragState.pointerId) return;
  detachDocListeners();
  if (dragState) clearTimeout(dragState.holdTimer);
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

let busyOp = false;
async function handleTap(source, slot) {
  if (busyOp) return; // evita dobles toques mientras el server responde
  busyOp = true;
  try { await handleTapInner(source, slot); } finally { busyOp = false; }
}
async function handleTapInner(source, slot) {
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
    if (err?.code === 'busy') { try { await refresh(); await inventory.refresh(); } catch {} return; }
    showError(err.message || 'No se pudo depositar.');
  }
}

// Sesión 50 — notas de banco
let withdrawAsNote = false;
function ensureNoteCss() {
  if (document.getElementById('bank-note-css')) return;
  const st = document.createElement('style');
  st.id = 'bank-note-css';
  st.textContent = `
    .bank-note-btn { display: block; width: 100%; margin: 2px 0 4px; padding: 5px 6px; font-family: 'IM Fell English', serif;
      font-size: 11px; color: rgba(200,170,120,0.85); background: rgba(60,45,30,0.55); border: 1px solid #3a2a1a;
      border-radius: 3px; cursor: pointer; -webkit-tap-highlight-color: transparent; touch-action: manipulation; }
    .bank-note-btn b { color: #d8c89a; }
    .bank-note-btn.on { background: rgba(120,90,50,0.85); border-color: #c8a043; color: #f0e0b0; }
    .bank-note-btn.on b { color: #ffe27a; }
  `;
  document.head.appendChild(st);
}

async function doWithdraw(bankSlot, qty, targetInvSlot) {
  const data = bankSlots.find(s => s.slot === bankSlot);
  if (!data) return;

  try {
    await api.withdrawFromBank(bankSlot, qty, targetInvSlot, withdrawAsNote);
    await refresh();
    await inventory.refresh();
  } catch (err) {
    console.error('[bank] withdraw failed:', err);
    if (err?.code === 'busy') { try { await refresh(); await inventory.refresh(); } catch {} return; }
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
