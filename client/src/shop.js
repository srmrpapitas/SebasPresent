/**
 * SebasPresent — Shop module (Sesión 23)
 *
 * Overlay de tienda estilo OSRS general store.
 *
 * Layout (móvil-first):
 *   - Cabecera: nombre tienda + coins del player + botón cerrar
 *   - Panel izquierdo: stock del NPC (lista vertical)
 *     Tap → comprar 1, mantener pulsado → comprar 5
 *   - Panel derecho: mi inventario filtrado a items vendibles
 *     Tap → vender 1, mantener pulsado → vender 5
 *
 * API pública:
 *   init(opts)
 *   open(shopId)
 *   close()
 *   isOpen()
 */

let apiBase = null;
let getToken = null;
let onInventoryChange = () => {};
let onCloseCallback = () => {};

let overlay = null;
let currentShopId = null;
let shopData = null;
let playerInv = null;

const INVENTORY_SLOTS = 28;

// ============================================================
// API pública
// ============================================================

export function init(opts) {
  apiBase = opts.apiBase;
  getToken = opts.getToken || (() => null);
  onInventoryChange = opts.onInventoryChange || (() => {});
  onCloseCallback = opts.onClose || (() => {});
  injectStyles();
}

export async function open(shopId = 'general_store') {
  currentShopId = shopId;
  if (!overlay) buildOverlay();
  overlay.style.display = 'flex';
  await refresh();
}

export function close() {
  if (!overlay) return;
  overlay.style.display = 'none';
  try { onCloseCallback(); } catch {}
}

export function isOpen() {
  return overlay && overlay.style.display !== 'none';
}

// ============================================================
// Fetch
// ============================================================

async function refresh() {
  const token = getToken?.();
  if (!token) return;
  try {
    const res = await fetch(`${apiBase}/api/shop?shop_id=${encodeURIComponent(currentShopId)}`, {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    if (!res.ok) {
      console.warn('[shop] refresh failed:', res.status);
      return;
    }
    shopData = await res.json();

    const invRes = await fetch(`${apiBase}/api/inventory`, {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    if (invRes.ok) {
      const invData = await invRes.json();
      playerInv = new Array(INVENTORY_SLOTS).fill(null);
      for (const s of (invData.slots || [])) {
        if (s.slot >= 0 && s.slot < INVENTORY_SLOTS) {
          playerInv[s.slot] = s;
        }
      }
    }
    render();
  } catch (err) {
    console.error('[shop] refresh err:', err);
  }
}

// ============================================================
// Render
// ============================================================

function buildOverlay() {
  overlay = document.createElement('div');
  overlay.id = 'shopOverlay';
  overlay.className = 'shop-overlay';
  overlay.innerHTML = `
    <div class="shop-frame">
      <div class="shop-header">
        <div class="shop-title">🛒 Tienda</div>
        <div class="shop-coins">
          <span id="shopCoinsValue">0</span>
          <span class="shop-coins-icon">🪙</span>
        </div>
        <button class="shop-close" id="shopCloseBtn">✕</button>
      </div>
      <div class="shop-body">
        <div class="shop-side shop-side-npc">
          <div class="shop-side-title">⚔ Comprar</div>
          <div class="shop-grid" id="shopGridNpc"></div>
        </div>
        <div class="shop-side shop-side-player">
          <div class="shop-side-title">💰 Vender</div>
          <div class="shop-grid" id="shopGridPlayer"></div>
        </div>
      </div>
      <div class="shop-footer">
        <div class="shop-hint">Toca para 1 · Mantén para 5</div>
        <div class="shop-error" id="shopError"></div>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  overlay.querySelector('#shopCloseBtn').addEventListener('pointerup', (ev) => {
    if (ev.button !== undefined && ev.button !== 0) return;
    ev.preventDefault();
    ev.stopPropagation();
    close();
  });

  // Tap fuera del frame → cerrar
  overlay.addEventListener('pointerdown', (ev) => {
    if (ev.target === overlay) {
      ev.preventDefault();
      close();
    }
  });
}

function render() {
  if (!shopData) return;

  const coinsEl = document.getElementById('shopCoinsValue');
  if (coinsEl) coinsEl.textContent = formatQty(shopData.player_coins || 0);

  // Stock NPC (comprar)
  const gridNpc = document.getElementById('shopGridNpc');
  if (gridNpc) {
    gridNpc.innerHTML = '';
    for (const item of (shopData.stock || [])) {
      const cell = document.createElement('div');
      cell.className = 'shop-cell shop-cell-npc';
      if (item.current_qty === 0) cell.classList.add('out-of-stock');
      cell.innerHTML = `
        <div class="shop-cell-icon">${item.icon || '?'}</div>
        <div class="shop-cell-info">
          <div class="shop-cell-name">${escapeHtml(item.name)}</div>
          <div class="shop-cell-stats">
            <span class="shop-cell-qty">×${item.current_qty}</span>
            <span class="shop-cell-price">${item.sell_price}gp</span>
          </div>
        </div>
      `;
      attachBuyHandlers(cell, item);
      gridNpc.appendChild(cell);
    }
  }

  // Inventario player (vender)
  const gridPlayer = document.getElementById('shopGridPlayer');
  if (gridPlayer) {
    gridPlayer.innerHTML = '';
    if (!playerInv) return;
    let countShown = 0;
    for (let i = 0; i < INVENTORY_SLOTS; i++) {
      const slot = playerInv[i];
      if (!slot || slot.item_id === 'coins') continue;

      const pricePerUnit = computeBuyPrice(slot);

      const cell = document.createElement('div');
      cell.className = 'shop-cell shop-cell-player';
      cell.innerHTML = `
        <div class="shop-cell-icon">${slot.icon || '?'}</div>
        <div class="shop-cell-info">
          <div class="shop-cell-name">${escapeHtml(slot.name)}</div>
          <div class="shop-cell-stats">
            ${slot.stackable && slot.quantity > 1 ? `<span class="shop-cell-qty">×${formatQty(slot.quantity)}</span>` : '<span></span>'}
            <span class="shop-cell-price">${pricePerUnit}gp</span>
          </div>
        </div>
      `;
      attachSellHandlers(cell, slot);
      gridPlayer.appendChild(cell);
      countShown++;
    }
    if (countShown === 0) {
      gridPlayer.innerHTML = '<div class="shop-empty">Nada que vender.</div>';
    }
  }
}

function computeBuyPrice(slot) {
  if (shopData?.stock) {
    const inCatalog = shopData.stock.find(s => s.item_id === slot.item_id);
    if (inCatalog) return inCatalog.buy_price;
  }
  // El server clampará entre 1-20 según base_price del item
  return 1;
}

// ============================================================
// Handlers compra/venta
// ============================================================

function attachBuyHandlers(cell, item) {
  let lpTimer = null;
  let didLongPress = false;

  cell.addEventListener('pointerdown', (ev) => {
    if (ev.button !== undefined && ev.button !== 0) return;
    didLongPress = false;
    if (lpTimer) clearTimeout(lpTimer);
    lpTimer = setTimeout(() => {
      didLongPress = true;
      lpTimer = null;
      buyItem(item, 5);
    }, 500);
  });

  cell.addEventListener('pointerup', (ev) => {
    if (lpTimer) { clearTimeout(lpTimer); lpTimer = null; }
    if (didLongPress) { didLongPress = false; return; }
    if (ev.button !== undefined && ev.button !== 0) return;
    ev.preventDefault();
    ev.stopPropagation();
    buyItem(item, 1);
  });

  cell.addEventListener('pointercancel', () => {
    if (lpTimer) { clearTimeout(lpTimer); lpTimer = null; }
  });
  cell.addEventListener('pointerleave', () => {
    if (lpTimer) { clearTimeout(lpTimer); lpTimer = null; }
  });
}

function attachSellHandlers(cell, slot) {
  let lpTimer = null;
  let didLongPress = false;

  cell.addEventListener('pointerdown', (ev) => {
    if (ev.button !== undefined && ev.button !== 0) return;
    didLongPress = false;
    if (lpTimer) clearTimeout(lpTimer);
    lpTimer = setTimeout(() => {
      didLongPress = true;
      lpTimer = null;
      const qty = Math.min(5, slot.quantity);
      sellItem(slot.slot, qty);
    }, 500);
  });

  cell.addEventListener('pointerup', (ev) => {
    if (lpTimer) { clearTimeout(lpTimer); lpTimer = null; }
    if (didLongPress) { didLongPress = false; return; }
    if (ev.button !== undefined && ev.button !== 0) return;
    ev.preventDefault();
    ev.stopPropagation();
    sellItem(slot.slot, 1);
  });

  cell.addEventListener('pointercancel', () => {
    if (lpTimer) { clearTimeout(lpTimer); lpTimer = null; }
  });
  cell.addEventListener('pointerleave', () => {
    if (lpTimer) { clearTimeout(lpTimer); lpTimer = null; }
  });
}

async function buyItem(item, qty) {
  const token = getToken?.();
  if (!token) return;

  if (item.current_qty < qty) qty = Math.max(1, item.current_qty);
  if (qty < 1) {
    showError('Sin stock.');
    return;
  }
  const totalCost = item.sell_price * qty;
  if ((shopData.player_coins || 0) < totalCost) {
    showError('No tienes monedas suficientes.');
    return;
  }

  try {
    const res = await fetch(`${apiBase}/api/shop/buy`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ shop_id: currentShopId, item_id: item.item_id, qty }),
    });
    const data = await res.json();
    if (!res.ok) {
      showError(translateError(data.error, data.message));
      return;
    }
    await refresh();
    try { onInventoryChange(); } catch {}
  } catch (err) {
    console.error('[shop] buy err:', err);
    showError('Error de red.');
  }
}

async function sellItem(slotIndex, qty) {
  const token = getToken?.();
  if (!token) return;
  try {
    const res = await fetch(`${apiBase}/api/shop/sell`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ shop_id: currentShopId, slot_index: slotIndex, qty }),
    });
    const data = await res.json();
    if (!res.ok) {
      showError(translateError(data.error, data.message));
      return;
    }
    await refresh();
    try { onInventoryChange(); } catch {}
  } catch (err) {
    console.error('[shop] sell err:', err);
    showError('Error de red.');
  }
}

function translateError(code, msg) {
  if (msg) return msg;
  switch (code) {
    case 'insufficient_stock': return 'Sin stock suficiente.';
    case 'insufficient_coins': return 'No tienes monedas suficientes.';
    case 'inventory_full':     return 'Mochila llena.';
    case 'slot_empty':         return 'El slot está vacío.';
    case 'cannot_sell_coins':  return 'No puedes vender monedas.';
    case 'item_not_in_shop':   return 'Este item no está en venta.';
    default:                   return 'Error: ' + code;
  }
}

function showError(msg) {
  const el = document.getElementById('shopError');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('visible');
  setTimeout(() => el.classList.remove('visible'), 2500);
}

// ============================================================
// Utils
// ============================================================

function formatQty(n) {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return Math.floor(n / 1000) + 'K';
  return Math.floor(n / 1_000_000) + 'M';
}

function escapeHtml(s) {
  if (s == null) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ============================================================
// Styles
// ============================================================

function injectStyles() {
  if (document.getElementById('shop-styles')) return;
  const style = document.createElement('style');
  style.id = 'shop-styles';
  style.textContent = `
    .shop-overlay {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.78);
      backdrop-filter: blur(4px);
      -webkit-backdrop-filter: blur(4px);
      z-index: 100;
      display: none;
      align-items: center;
      justify-content: center;
      padding: 12px;
      font-family: 'IM Fell English', serif;
    }
    .shop-frame {
      background: rgba(20, 14, 8, 0.97);
      border: 3px solid #c8a043;
      border-radius: 6px;
      box-shadow: 0 0 60px rgba(200, 160, 67, 0.4), 0 12px 40px rgba(0, 0, 0, 0.8);
      width: 100%;
      max-width: 560px;
      max-height: 90vh;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    .shop-header {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 14px;
      border-bottom: 2px solid rgba(200, 160, 67, 0.4);
      background: linear-gradient(180deg, rgba(60, 40, 20, 0.5), transparent);
    }
    .shop-title {
      font-family: 'Cinzel', serif;
      font-weight: 900;
      font-size: 16px;
      color: #e8c560;
      letter-spacing: 0.05em;
      text-shadow: 0 2px 4px rgba(0, 0, 0, 0.9);
      flex: 1;
    }
    .shop-coins {
      background: rgba(40, 28, 16, 0.95);
      border: 1.5px solid #c8a043;
      border-radius: 4px;
      padding: 4px 10px;
      color: #ffd060;
      font-family: 'Cinzel', serif;
      font-weight: 700;
      font-size: 13px;
      text-shadow: 0 1px 2px rgba(0,0,0,0.9);
      display: flex;
      align-items: center;
      gap: 4px;
    }
    .shop-close {
      width: 30px; height: 30px;
      background: rgba(60, 30, 20, 0.95);
      border: 2px solid #c8a043;
      color: #e8c560;
      font-size: 14px;
      font-weight: bold;
      border-radius: 4px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      -webkit-tap-highlight-color: transparent;
    }
    .shop-close:active {
      transform: scale(0.9);
      background: rgba(120, 60, 40, 0.95);
    }
    .shop-body {
      display: flex;
      gap: 8px;
      padding: 10px;
      overflow: hidden;
      flex: 1;
      min-height: 0;
    }
    .shop-side {
      flex: 1;
      display: flex;
      flex-direction: column;
      background: rgba(30, 20, 12, 0.7);
      border: 1.5px solid rgba(200, 160, 67, 0.3);
      border-radius: 4px;
      padding: 8px;
      min-width: 0;
      overflow: hidden;
    }
    .shop-side-title {
      font-family: 'Cinzel', serif;
      font-weight: 700;
      font-size: 12px;
      color: #c8a043;
      letter-spacing: 0.05em;
      text-align: center;
      margin-bottom: 8px;
      padding-bottom: 6px;
      border-bottom: 1px solid rgba(200, 160, 67, 0.25);
      text-shadow: 0 1px 1px rgba(0,0,0,0.9);
    }
    .shop-grid {
      flex: 1;
      overflow-y: auto;
      overflow-x: hidden;
      -webkit-overflow-scrolling: touch;
      display: flex;
      flex-direction: column;
      gap: 4px;
      padding-right: 2px;
    }
    .shop-cell {
      display: flex;
      align-items: center;
      gap: 8px;
      background: linear-gradient(135deg, rgba(60, 45, 30, 0.95), rgba(30, 20, 12, 0.95));
      border: 1.5px solid #5a4a30;
      border-radius: 4px;
      padding: 6px 8px;
      cursor: pointer;
      -webkit-tap-highlight-color: transparent;
      transition: transform 0.08s, border-color 0.15s, box-shadow 0.15s;
      min-height: 44px;
    }
    .shop-cell:active {
      transform: scale(0.97);
      border-color: #c8a043;
      box-shadow: 0 0 8px rgba(200, 160, 67, 0.4);
    }
    .shop-cell.out-of-stock {
      opacity: 0.45;
      cursor: not-allowed;
    }
    .shop-cell.out-of-stock:active {
      transform: none;
      border-color: #5a4a30;
      box-shadow: none;
    }
    .shop-cell-icon {
      font-size: 22px;
      width: 32px;
      height: 32px;
      display: flex;
      align-items: center;
      justify-content: center;
      filter: drop-shadow(0 2px 3px rgba(0,0,0,0.8));
      flex-shrink: 0;
    }
    .shop-cell-info {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .shop-cell-name {
      font-family: 'Cinzel', serif;
      font-size: 11px;
      font-weight: 700;
      color: #fff8d0;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      text-shadow: 0 1px 1px rgba(0,0,0,0.9);
    }
    .shop-cell-stats {
      display: flex;
      justify-content: space-between;
      gap: 6px;
      font-size: 10px;
    }
    .shop-cell-qty {
      color: #ffff00;
      font-family: 'IM Fell English', serif;
      font-weight: bold;
      text-shadow: 1px 1px 0 #000;
    }
    .shop-cell-price {
      color: #ffd060;
      font-family: 'IM Fell English', serif;
      font-weight: bold;
      text-shadow: 1px 1px 0 #000;
    }
    .shop-empty {
      text-align: center;
      color: rgba(200, 160, 67, 0.5);
      font-size: 11px;
      padding: 20px 8px;
      font-style: italic;
    }
    .shop-footer {
      padding: 8px 14px;
      border-top: 1px solid rgba(200, 160, 67, 0.3);
      display: flex;
      flex-direction: column;
      gap: 4px;
      align-items: center;
    }
    .shop-hint {
      color: rgba(200, 160, 67, 0.7);
      font-size: 10px;
      letter-spacing: 0.04em;
    }
    .shop-error {
      color: #ff8060;
      font-size: 11px;
      font-weight: bold;
      opacity: 0;
      transition: opacity 0.18s;
      text-shadow: 0 1px 1px rgba(0,0,0,0.9);
      min-height: 14px;
    }
    .shop-error.visible { opacity: 1; }
  `;
  document.head.appendChild(style);
}
