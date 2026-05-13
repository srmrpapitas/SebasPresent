/**
 * SebasPresent — Grand Exchange (cliente, Slice 4c v2)
 *
 * Modelo: OVERLAY FULLSCREEN (no es un tab del sidebar).
 *
 * Hoy: el boton 🏛️ del sidebar dispara openOverlay() via ui.js.
 * Slice 6: el NPC del edificio fisico del GE en el hub dispara
 *          el mismo openOverlay() — el modulo no cambia.
 *
 * Patron: modulo plano, mismo estilo que bank.js / inventory.js.
 * Sin framework, sin localStorage. Estado en memoria del modulo.
 *
 * MODELO (v2, collection box estilo OSRS):
 *   - Vender desde la mochila, no del banco.
 *   - Los resultados de un match aparecen en pending_* de la orden,
 *     no se ingresan automaticamente.
 *   - Dos flechas globales reclaman TODO el pending:
 *     "→ 🎒 Mochila" / "→ 🏦 Banco".
 *   - Feed tipo chatbox de OSRS: entradas verde (success), amarillo
 *     (warning), rojo (error). Solo en memoria, max 30 entradas.
 *
 * VISTAS (state machine sobre el mismo overlay):
 *   - 'slots': pantalla principal con feed + grid 4x2 + dos flechas
 *   - 'search': lista de items para crear orden
 *   - 'place': formulario para colocar orden de un item
 *   - 'detail': info de una orden propia con cancel inline (2 taps)
 *
 * POLLING:
 *   - Solo mientras el overlay esta visible Y en vista 'slots'.
 *   - Cada 15s. Cron del matcher corre cada 1min, no compensa pollear
 *     mas rapido.
 *   - Detecta deltas en qty_filled / status / pending para generar
 *     entradas al feed.
 */

import * as api from './api.js';
import * as inventory from './inventory.js';
import * as bank from './bank.js';

// ============================================================
// CONFIG
// ============================================================

const POLL_INTERVAL_MS = 15_000;
const FEED_MAX_ENTRIES = 30;
const CANCEL_CONFIRM_TIMEOUT_MS = 3_000;
const ERROR_AUTO_HIDE_MS = 2_500;
const MAX_SLOTS = 8;

const FEED_SUCCESS = 'success';
const FEED_WARNING = 'warning';
const FEED_ERROR = 'error';

// ============================================================
// ESTADO MODULO
// ============================================================

let overlayEl = null;          // <div class="ge-overlay">
let frameEl = null;            // <div class="ge-overlay-frame">
let isInitialized = false;
let isOpen = false;

let view = 'slots';            // 'slots' | 'search' | 'place' | 'detail'
let viewState = {};

let lastSnapshot = null;
let feedEntries = [];
let feedIdCounter = 1;

let pollTimer = null;
let errorTimer = null;
let cancelConfirmOrderId = null;
let cancelConfirmTimer = null;

// ============================================================
// LIFECYCLE
// ============================================================

export function init() {
  if (isInitialized) return;
  overlayEl = document.getElementById('geOverlay');
  if (!overlayEl) {
    console.warn('[ge] #geOverlay no encontrado en DOM');
    return;
  }
  frameEl = overlayEl.querySelector('.ge-overlay-frame');
  if (!frameEl) {
    console.warn('[ge] .ge-overlay-frame no encontrado dentro de #geOverlay');
    return;
  }
  isInitialized = true;

  // Click en el backdrop cierra. Click dentro del frame, no.
  overlayEl.addEventListener('pointerup', (ev) => {
    if (ev.target === overlayEl) closeOverlay();
  });
}

export async function openOverlay() {
  if (!isInitialized) init();
  if (!overlayEl) return;

  isOpen = true;
  view = 'slots';
  viewState = {};
  cancelConfirmOrderId = null;

  overlayEl.classList.add('visible');
  render();
  await doRefresh({ silent: true });
  if (view === 'slots') render();
  startPolling();
}

export function closeOverlay() {
  isOpen = false;
  stopPolling();
  clearCancelConfirm();
  hideError();
  if (overlayEl) overlayEl.classList.remove('visible');
}

// Compatibilidad: por si algo externo llama refresh()
export function refresh() {
  return doRefresh();
}

// ============================================================
// POLLING
// ============================================================

function startPolling() {
  stopPolling();
  pollTimer = setInterval(() => {
    if (view === 'slots' && isOpen) {
      doRefresh({ silent: true }).catch(err => console.warn('[ge] poll err', err));
    }
  }, POLL_INTERVAL_MS);
}

function stopPolling() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
}

// ============================================================
// DATA
// ============================================================

async function doRefresh({ silent = false } = {}) {
  try {
    const data = await api.getGeOrders();
    detectDeltas(lastSnapshot, data);
    lastSnapshot = data;
    if (view === 'slots') render();
  } catch (err) {
    if (!silent) showError(err && err.message ? err.message : 'Error al cargar');
  }
}

async function refreshAndKeepFeed() {
  try {
    const data = await api.getGeOrders();
    lastSnapshot = data;
    if (view === 'slots') render();
  } catch (err) {
    showError(err && err.message ? err.message : 'Error');
  }
}

function detectDeltas(prev, curr) {
  if (!prev || !curr) return;
  const prevAll = collectAllOrders(prev);
  const currAll = collectAllOrders(curr);
  const prevById = new Map();
  prevAll.forEach(o => prevById.set(o.id, o));

  for (const c of currAll) {
    const p = prevById.get(c.id);
    if (!p) continue;
    const newFill = c.qty_filled - p.qty_filled;
    if (newFill > 0) {
      const sideTxt = c.side === 0 ? 'Comprado' : 'Vendido';
      const price = newFill > 0
        ? Math.round((c.avg_fill_price * c.qty_filled - p.avg_fill_price * p.qty_filled) / newFill)
        : c.price;
      pushFeed(FEED_SUCCESS,
        `${sideTxt} ${formatNum(newFill)} × ${c.name || c.item_id} a ${formatNum(price)}gp` +
        (c.qty_filled === c.qty_total ? ' · orden completa' : ''));
    } else if (p.status === 0 && c.status === 2) {
      pushFeed(FEED_WARNING, `Orden cancelada: ${describeOrderShort(c)}`);
    }
  }
}

function collectAllOrders(snap) {
  const arr = [];
  if (Array.isArray(snap.open)) arr.push(...snap.open);
  if (Array.isArray(snap.collection)) arr.push(...snap.collection);
  return arr;
}

function describeOrderShort(o) {
  const side = o.side === 0 ? 'Compra' : 'Venta';
  return `${side} ${formatNum(o.qty_total)} × ${o.name || o.item_id} @ ${formatNum(o.price)}gp`;
}

// ============================================================
// FEED
// ============================================================

function pushFeed(type, text) {
  feedEntries.push({ id: feedIdCounter++, type, text, ts: Date.now() });
  if (feedEntries.length > FEED_MAX_ENTRIES) {
    feedEntries.splice(0, feedEntries.length - FEED_MAX_ENTRIES);
  }
  if (view === 'slots' && frameEl) {
    renderFeedOnly();
    scrollFeedToBottom();
  }
}

function renderFeedOnly() {
  const feed = frameEl.querySelector('.ge-feed');
  if (!feed) return;
  feed.innerHTML = feedEntries.map(e => `
    <div class="ge-feed-entry ${e.type}">${escapeHtml(e.text)}</div>
  `).join('');
}

function scrollFeedToBottom() {
  const feed = frameEl.querySelector('.ge-feed');
  if (feed) feed.scrollTop = feed.scrollHeight;
}

// ============================================================
// RENDER ROOT
// ============================================================

function render() {
  if (!frameEl) return;
  frameEl.innerHTML = `
    <div class="ge-header">
      ${renderHeaderLeft()}
      <h2 class="ge-title">${renderTitle()}</h2>
      <button class="ge-close-btn" data-action="close" aria-label="Cerrar">✕</button>
    </div>
    <div class="ge-error" style="display:none"></div>
    <div class="ge-body">
      ${renderBody()}
    </div>
  `;
  attachHandlers();
  if (view === 'slots') scrollFeedToBottom();
}

function renderHeaderLeft() {
  if (view === 'slots') {
    const open = lastSnapshot ? (lastSnapshot.open || []).length : 0;
    return `<span class="ge-slot-count">${open}/${MAX_SLOTS}</span>`;
  }
  return `<button class="ge-back-btn" data-action="back" aria-label="Atrás">‹</button>`;
}

function renderTitle() {
  if (view === 'slots')  return 'Grand Exchange';
  if (view === 'search') return 'Buscar item';
  if (view === 'place') {
    return viewState.item ? escapeHtml(viewState.item.name) : 'Nueva orden';
  }
  if (view === 'detail') {
    return viewState.order ? escapeHtml(viewState.order.name || viewState.order.item_id) : 'Orden';
  }
  return 'Grand Exchange';
}

function renderBody() {
  if (view === 'slots')  return renderSlotsView();
  if (view === 'search') return renderSearchView();
  if (view === 'place')  return renderPlaceView();
  if (view === 'detail') return renderDetailView();
  return '';
}

// ============================================================
// VIEW: slots
// ============================================================

function renderSlotsView() {
  if (!lastSnapshot) return `<div class="ge-loading">Cargando…</div>`;
  const open = lastSnapshot.open || [];
  const totals = lastSnapshot.totals || { pending_coins: 0, pending_items_by_id: {} };

  const slots = [];
  for (let i = 0; i < MAX_SLOTS; i++) slots.push(open[i] || null);

  return `
    <div class="ge-feed" aria-label="Feed">
      ${feedEntries.map(e => `
        <div class="ge-feed-entry ${e.type}">${escapeHtml(e.text)}</div>
      `).join('')}
      ${feedEntries.length === 0 ? '<div class="ge-feed-empty">Sin actividad reciente.</div>' : ''}
    </div>

    <div class="ge-slots-grid">
      ${slots.map((o, idx) => renderSlot(o, idx)).join('')}
    </div>

    <div class="ge-claim-bar">
      ${renderClaimButtons(totals)}
    </div>
  `;
}

function renderSlot(order, idx) {
  if (!order) {
    return `
      <button class="ge-slot empty" data-action="open-search" data-slot="${idx}">
        <span class="ge-slot-empty-icon">+</span>
      </button>
    `;
  }
  const side = order.side === 0 ? 'buy' : 'sell';
  const sideLabel = order.side === 0 ? 'Compra' : 'Venta';
  const progress = order.qty_total > 0 ? Math.round((order.qty_filled / order.qty_total) * 100) : 0;
  return `
    <button class="ge-slot ${side}" data-action="open-detail" data-order-id="${order.id}">
      <div class="ge-slot-top">
        <span class="ge-slot-side">${sideLabel}</span>
        <span class="ge-slot-icon">${escapeHtml(order.icon || '')}</span>
      </div>
      <div class="ge-slot-name">${escapeHtml(order.name || order.item_id)}</div>
      <div class="ge-slot-progress-bar">
        <div class="ge-slot-progress-fill" style="width:${progress}%"></div>
      </div>
      <div class="ge-slot-progress-text">${formatNum(order.qty_filled)} / ${formatNum(order.qty_total)}</div>
    </button>
  `;
}

function renderClaimButtons(totals) {
  const coins = totals.pending_coins || 0;
  const itemsBy = totals.pending_items_by_id || {};
  const itemEntries = Object.entries(itemsBy);
  const hasPending = coins > 0 || itemEntries.length > 0;

  const summary = !hasPending ? 'Nada que reclamar' : (() => {
    const parts = [];
    if (coins > 0) parts.push(`${formatNum(coins)}gp`);
    const totalItems = itemEntries.reduce((a, [_, q]) => a + q, 0);
    if (totalItems > 0) {
      const kinds = itemEntries.length === 1 ? itemNameById(itemEntries[0][0]) : `${itemEntries.length} items`;
      parts.push(`${formatNum(totalItems)} ${kinds}`);
    }
    return parts.join(' · ');
  })();

  const disabled = hasPending ? '' : 'disabled';
  return `
    <button class="ge-claim-btn to-inv" data-action="claim-inv" ${disabled}>
      <div class="ge-claim-target">→ 🎒 Mochila</div>
      <div class="ge-claim-summary">${escapeHtml(summary)}</div>
    </button>
    <button class="ge-claim-btn to-bank" data-action="claim-bank" ${disabled}>
      <div class="ge-claim-target">→ 🏦 Banco</div>
      <div class="ge-claim-summary">${escapeHtml(summary)}</div>
    </button>
  `;
}

function itemNameById(itemId) {
  if (!lastSnapshot) return itemId;
  for (const o of collectAllOrders(lastSnapshot)) {
    if (o.item_id === itemId && o.name) return o.name;
  }
  return itemId;
}

// ============================================================
// VIEW: search
// ============================================================

function renderSearchView() {
  const q = viewState.q || '';
  const results = viewState.results || [];
  const loading = !!viewState.loading;
  return `
    <div class="ge-search-bar">
      <input type="text" class="ge-search-input"
             placeholder="Buscar item..." value="${escapeHtml(q)}"
             autocapitalize="off" autocorrect="off" autocomplete="off" />
    </div>
    <div class="ge-search-results">
      ${loading ? '<div class="ge-loading">Buscando…</div>' :
        results.length === 0 ? '<div class="ge-search-empty">Sin resultados</div>' :
        results.map(it => `
          <button class="ge-search-result" data-action="pick-item" data-item-id="${escapeHtml(it.id)}">
            <span class="ge-search-icon">${escapeHtml(it.icon || '')}</span>
            <span class="ge-search-name">${escapeHtml(it.name)}</span>
            <span class="ge-search-price">≈ ${formatNum(it.suggested_price)}gp</span>
          </button>
        `).join('')}
    </div>
  `;
}

// ============================================================
// VIEW: place
// ============================================================

function renderPlaceView() {
  const item = viewState.item;
  const info = viewState.info;
  if (!item || !info) return `<div class="ge-loading">Cargando item…</div>`;

  const side = viewState.side || 0;
  const price = viewState.price ?? info.suggested_price;
  const qty = viewState.qty ?? 1;
  const total = price * qty;
  const sideTxt = side === 0 ? 'Compra' : 'Venta';

  return `
    <div class="ge-place-header">
      <span class="ge-place-icon">${escapeHtml(item.icon || '')}</span>
      <span class="ge-place-name">${escapeHtml(item.name)}</span>
    </div>

    <div class="ge-place-market">
      <div class="ge-market-row"><span>Precio guía</span><span>${formatNum(info.guide_price)}gp</span></div>
      <div class="ge-market-row"><span>Mejor compra</span><span>${info.best_buy ? formatNum(info.best_buy) + 'gp' : '—'}</span></div>
      <div class="ge-market-row"><span>Mejor venta</span><span>${info.best_sell ? formatNum(info.best_sell) + 'gp' : '—'}</span></div>
      <div class="ge-market-row band"><span>Banda</span><span>${formatNum(info.band.min)} – ${formatNum(info.band.max)}gp</span></div>
    </div>

    <div class="ge-side-toggle">
      <button class="ge-side-btn ${side === 0 ? 'active' : ''}" data-action="set-side" data-side="0">Compra</button>
      <button class="ge-side-btn ${side === 1 ? 'active' : ''}" data-action="set-side" data-side="1">Venta</button>
    </div>

    <div class="ge-place-field">
      <label>Cantidad</label>
      <div class="ge-stepper">
        <button data-action="qty-delta" data-delta="-100">-100</button>
        <button data-action="qty-delta" data-delta="-10">-10</button>
        <button data-action="qty-delta" data-delta="-1">-1</button>
        <input type="number" min="1" class="ge-stepper-input" data-field="qty" value="${qty}" inputmode="numeric" pattern="[0-9]*" />
        <button data-action="qty-delta" data-delta="1">+1</button>
        <button data-action="qty-delta" data-delta="10">+10</button>
        <button data-action="qty-delta" data-delta="100">+100</button>
      </div>
    </div>

    <div class="ge-place-field">
      <label>Precio por unidad</label>
      <div class="ge-stepper">
        <button data-action="price-delta" data-delta="-1000">-1k</button>
        <button data-action="price-delta" data-delta="-100">-100</button>
        <button data-action="price-delta" data-delta="-1">-1</button>
        <input type="number" min="1" class="ge-stepper-input" data-field="price" value="${price}" inputmode="numeric" pattern="[0-9]*" />
        <button data-action="price-delta" data-delta="1">+1</button>
        <button data-action="price-delta" data-delta="100">+100</button>
        <button data-action="price-delta" data-delta="1000">+1k</button>
      </div>
      <div class="ge-price-shortcuts">
        <button data-action="price-set" data-value="${info.guide_price}">Guía</button>
        ${side === 0 && info.best_sell ?
          `<button data-action="price-set" data-value="${info.best_sell}">Cruce instantáneo</button>` :
          (side === 1 && info.best_buy ?
            `<button data-action="price-set" data-value="${info.best_buy}">Cruce instantáneo</button>` :
            '')}
      </div>
    </div>

    <div class="ge-place-total">
      Total: <strong>${formatNum(total)}gp</strong>
    </div>

    <button class="ge-place-submit" data-action="submit-place">${sideTxt} ${formatNum(qty)} × ${escapeHtml(item.name)}</button>
  `;
}

// ============================================================
// VIEW: detail
// ============================================================

function renderDetailView() {
  const o = viewState.order;
  if (!o) return `<div class="ge-loading">Cargando orden…</div>`;
  const sideTxt = o.side === 0 ? 'Compra' : 'Venta';
  const progress = o.qty_total > 0 ? Math.round((o.qty_filled / o.qty_total) * 100) : 0;
  const isOpenStatus = o.status === 0;
  const confirming = cancelConfirmOrderId === o.id;

  return `
    <div class="ge-detail-card">
      <div class="ge-detail-top">
        <span class="ge-detail-icon">${escapeHtml(o.icon || '')}</span>
        <span class="ge-detail-name">${escapeHtml(o.name || o.item_id)}</span>
      </div>
      <div class="ge-detail-side ${o.side === 0 ? 'buy' : 'sell'}">${sideTxt}</div>

      <div class="ge-detail-progress-bar">
        <div class="ge-detail-progress-fill" style="width:${progress}%"></div>
      </div>
      <div class="ge-detail-progress-text">${formatNum(o.qty_filled)} / ${formatNum(o.qty_total)} (${progress}%)</div>

      <div class="ge-detail-row"><span>Precio límite</span><span>${formatNum(o.price)}gp</span></div>
      ${o.qty_filled > 0 ?
        `<div class="ge-detail-row"><span>Precio medio fill</span><span>${formatNum(Math.round(o.avg_fill_price))}gp</span></div>` : ''}
      ${o.pending_coins > 0 ?
        `<div class="ge-detail-row"><span>Pendiente</span><span>${formatNum(o.pending_coins)}gp</span></div>` : ''}
      ${o.pending_items > 0 ?
        `<div class="ge-detail-row"><span>Pendiente</span><span>${formatNum(o.pending_items)} ${escapeHtml(o.name || o.item_id)}</span></div>` : ''}
      ${o.side === 0 && isOpenStatus ?
        `<div class="ge-detail-row"><span>Escrow</span><span>${formatNum(o.coin_escrow)}gp</span></div>` :
        (o.side === 1 && isOpenStatus ?
          `<div class="ge-detail-row"><span>Escrow</span><span>${formatNum(o.item_escrow)} ud</span></div>` : '')}

      ${isOpenStatus ?
        `<button class="ge-cancel-btn ${confirming ? 'confirming' : ''}" data-action="cancel">
           ${confirming ? '¿Seguro? Cancelar' : 'Cancelar orden'}
         </button>` : ''}
    </div>
  `;
}

// ============================================================
// HANDLERS
// ============================================================

function attachHandlers() {
  if (!frameEl) return;
  frameEl.addEventListener('click', onClick);
  frameEl.addEventListener('input', onInput);
  frameEl.addEventListener('keydown', onKeydown);
}

function onClick(e) {
  const target = e.target.closest('[data-action]');
  if (!target) return;
  const action = target.dataset.action;

  switch (action) {
    case 'close': closeOverlay(); break;
    case 'back': back(); break;
    case 'open-search': openSearch(); break;
    case 'pick-item': openPlaceForItem(target.dataset.itemId); break;
    case 'open-detail': openDetail(parseInt(target.dataset.orderId, 10)); break;
    case 'set-side': setSide(parseInt(target.dataset.side, 10)); break;
    case 'qty-delta': adjustQty(parseInt(target.dataset.delta, 10)); break;
    case 'price-delta': adjustPrice(parseInt(target.dataset.delta, 10)); break;
    case 'price-set': setPrice(parseInt(target.dataset.value, 10)); break;
    case 'submit-place': submitPlace(); break;
    case 'cancel': clickCancel(); break;
    case 'claim-inv': claim('inventory'); break;
    case 'claim-bank': claim('bank'); break;
  }
}

function onInput(e) {
  const target = e.target;
  if (!target.dataset.field) return;
  const field = target.dataset.field;
  const val = parseInt(target.value, 10);
  if (!Number.isFinite(val)) return;
  if (field === 'qty') viewState.qty = Math.max(1, val);
  if (field === 'price') viewState.price = Math.max(1, val);
  updatePlaceTotal();
}

function onKeydown(e) {
  if (view !== 'search') return;
  if (e.target.classList && e.target.classList.contains('ge-search-input')) {
    clearTimeout(viewState._searchDebounce);
    const q = e.target.value;
    viewState._searchDebounce = setTimeout(() => doSearch(q), 200);
  }
}

// ============================================================
// NAVEGACION
// ============================================================

function back() {
  if (view === 'place') {
    view = 'search';
    viewState = { q: viewState._lastQ || '', results: viewState._lastResults || [] };
  } else {
    view = 'slots';
    viewState = {};
  }
  cancelConfirmOrderId = null;
  render();
}

async function openSearch() {
  view = 'search';
  viewState = { q: '', results: [], loading: true };
  render();
  doSearch('');
}

async function doSearch(q) {
  viewState.q = q;
  viewState.loading = true;
  // re-render solo la zona de resultados para no perder foco del input
  const resultsEl = frameEl.querySelector('.ge-search-results');
  if (resultsEl) resultsEl.innerHTML = '<div class="ge-loading">Buscando…</div>';
  try {
    const data = await api.searchGeItems(q);
    viewState.loading = false;
    viewState.results = data.items || [];
    viewState._lastQ = q;
    viewState._lastResults = viewState.results;
    if (view !== 'search') return;
    render();
    const input = frameEl.querySelector('.ge-search-input');
    if (input) { input.focus(); input.value = q; input.setSelectionRange(q.length, q.length); }
  } catch (err) {
    viewState.loading = false;
    showError(err.message || 'Error en búsqueda');
    if (view === 'search') render();
  }
}

async function openPlaceForItem(itemId) {
  view = 'place';
  viewState = { itemId, loading: true };
  render();
  try {
    const info = await api.getGeItemInfo(itemId);
    viewState.info = info;
    viewState.item = info.item;
    viewState.side = 0;
    viewState.price = info.suggested_price;
    viewState.qty = 1;
    render();
  } catch (err) {
    showError(err.message || 'Error');
    back();
  }
}

async function openDetail(orderId) {
  if (!lastSnapshot) await doRefresh({ silent: true });
  const all = collectAllOrders(lastSnapshot || { open: [], collection: [] });
  const o = all.find(x => x.id === orderId);
  if (!o) { showError('Orden no encontrada'); return; }
  view = 'detail';
  viewState = { order: o };
  cancelConfirmOrderId = null;
  render();
}

// ============================================================
// ACCIONES DE PLACE
// ============================================================

function setSide(s) { viewState.side = s; render(); }
function adjustQty(delta) { viewState.qty = Math.max(1, (viewState.qty || 1) + delta); render(); }
function adjustPrice(delta) { viewState.price = Math.max(1, (viewState.price || 1) + delta); render(); }
function setPrice(value) { viewState.price = Math.max(1, value); render(); }

function updatePlaceTotal() {
  const totalEl = frameEl && frameEl.querySelector('.ge-place-total strong');
  if (totalEl) totalEl.textContent = formatNum((viewState.price || 0) * (viewState.qty || 0)) + 'gp';
}

async function submitPlace() {
  const itemId = viewState.itemId;
  const side = viewState.side === 0 ? 'buy' : 'sell';
  const price = viewState.price;
  const qty = viewState.qty;
  try {
    await api.placeGeOrder({ item_id: itemId, side, price, qty });
    const sideTxt = side === 'buy' ? 'Compra' : 'Venta';
    pushFeed(FEED_SUCCESS, `${sideTxt} colocada: ${formatNum(qty)} × ${viewState.item.name} @ ${formatNum(price)}gp`);
    try { inventory.refresh?.(); } catch {}
    view = 'slots';
    viewState = {};
    await refreshAndKeepFeed();
  } catch (err) {
    const msg = mapPlaceError(err);
    pushFeed(FEED_ERROR, msg);
    showError(msg);
  }
}

function mapPlaceError(err) {
  const code = err && (err.code || err.error);
  const band = err && err.band;
  switch (code) {
    case 'insufficient_coins': return 'Sin coins suficientes en la mochila';
    case 'insufficient_items': return 'Sin items suficientes en la mochila';
    case 'price_out_of_band':  return band
      ? `Precio fuera de banda (${formatNum(band.min)} – ${formatNum(band.max)}gp)`
      : 'Precio fuera de banda';
    case 'slots_full':         return 'Ya tienes 8 órdenes abiertas';
    case 'cannot_trade_coins': return 'No se pueden tradear coins';
    default: return err && err.message ? err.message : 'Error al colocar orden';
  }
}

// ============================================================
// CANCEL
// ============================================================

function clickCancel() {
  const o = viewState.order;
  if (!o) return;
  if (cancelConfirmOrderId === o.id) {
    confirmCancel(o.id);
  } else {
    cancelConfirmOrderId = o.id;
    clearTimeout(cancelConfirmTimer);
    cancelConfirmTimer = setTimeout(() => {
      cancelConfirmOrderId = null;
      if (view === 'detail') render();
    }, CANCEL_CONFIRM_TIMEOUT_MS);
    render();
  }
}

async function confirmCancel(orderId) {
  clearCancelConfirm();
  try {
    await api.cancelGeOrder(orderId);
    pushFeed(FEED_WARNING, `Orden cancelada: ${describeOrderShort(viewState.order)}`);
    view = 'slots';
    viewState = {};
    await refreshAndKeepFeed();
  } catch (err) {
    showError(err.message || 'Error al cancelar');
  }
}

function clearCancelConfirm() {
  cancelConfirmOrderId = null;
  if (cancelConfirmTimer) { clearTimeout(cancelConfirmTimer); cancelConfirmTimer = null; }
}

// ============================================================
// CLAIM
// ============================================================

async function claim(target) {
  if (!lastSnapshot || !lastSnapshot.totals) return;
  const t = lastSnapshot.totals;
  if (!t.pending_coins && Object.keys(t.pending_items_by_id || {}).length === 0) return;
  try {
    const res = await api.claimAll(target);
    const claimedCount = (res.claimed || []).length;
    const remainingCount = (res.remaining || []).length;
    const totalCoins = (res.claimed || []).reduce((a, c) => a + (c.coins || 0), 0);
    const totalItems = (res.claimed || []).reduce((a, c) => a + (c.items || 0), 0);
    const targetTxt = target === 'inventory' ? '🎒 Mochila' : '🏦 Banco';

    if (claimedCount === 0 && remainingCount > 0) {
      pushFeed(FEED_ERROR, `Sin sitio en ${targetTxt} para ninguna orden`);
    } else if (remainingCount > 0) {
      const parts = [];
      if (totalCoins > 0) parts.push(`${formatNum(totalCoins)}gp`);
      if (totalItems > 0) parts.push(`${formatNum(totalItems)} items`);
      pushFeed(FEED_WARNING,
        `${parts.join(' + ')} → ${targetTxt} · ${remainingCount} orden${remainingCount === 1 ? '' : 'es'} sin sitio en mochila`);
    } else {
      const parts = [];
      if (totalCoins > 0) parts.push(`${formatNum(totalCoins)}gp`);
      if (totalItems > 0) parts.push(`${formatNum(totalItems)} items`);
      pushFeed(FEED_SUCCESS, `${parts.join(' + ')} → ${targetTxt}`);
    }

    if (target === 'inventory') {
      try { inventory.refresh?.(); } catch {}
    }
    if (target === 'bank') {
      try { bank.refresh?.(); } catch {}
    }
    await refreshAndKeepFeed();
  } catch (err) {
    showError(err.message || 'Error al reclamar');
  }
}

// ============================================================
// ERRORES (panel temporal)
// ============================================================

function showError(msg) {
  const el = frameEl && frameEl.querySelector('.ge-error');
  if (!el) return;
  el.textContent = msg;
  el.style.display = 'block';
  if (errorTimer) clearTimeout(errorTimer);
  errorTimer = setTimeout(() => hideError(), ERROR_AUTO_HIDE_MS);
}

function hideError() {
  const el = frameEl && frameEl.querySelector('.ge-error');
  if (!el) return;
  el.style.display = 'none';
  el.textContent = '';
  if (errorTimer) { clearTimeout(errorTimer); errorTimer = null; }
}

// ============================================================
// UTILS
// ============================================================

function formatNum(n) {
  if (n === null || n === undefined) return '0';
  return Number(n).toLocaleString('es-ES');
}

function escapeHtml(s) {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
