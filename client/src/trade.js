/**
 * SebasPresent — Comercio entre jugadores, estilo OSRS (Sesión 50)
 * Servidor: server/handlers/trade.js. Aquí solo la ventana y los avisos.
 *
 *   · Otro jugador → "🤝 Comerciar" → al otro le sale un aviso Aceptar/Rechazar
 *     (si los dos se lo piden, se abre directamente).
 *   · Ventana: tu oferta | su oferta, tu mochila abajo (toca para ofrecer:
 *     1 / 5 / 10 / Todo). Tocar algo de tu oferta lo quita.
 *   · Aceptar → pantalla de confirmación con el resumen → Confirmar.
 *     Si alguien cambia algo, se vuelve a la primera pantalla y avisa.
 * Funciona montado (no te baja de la montura).
 */
import * as api from './api.js';
import { onMessage } from './realtime.js';
import { getItemIconHtml } from './item_icons.js';

let myId = null;
let feedLog = () => {};
let onInventoryChanged = () => {};
let el = null, toastEl = null, qtyEl = null;
let state = null;            // último GET /api/trade
let inv = [];
let pollTimer = null;
let lastVersion = null, warned = false;
let offRt = null;

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmt = (n) => n >= 10_000_000 ? `${Math.floor(n / 1_000_000)}M` : n >= 100_000 ? `${Math.floor(n / 1000)}K` : String(n);

const tapi = (path, body) => api.tradeCall(path, body);

// ============================================================
// Pedir / responder
// ============================================================
export async function requestTrade(userId, name) {
  try {
    const r = await tapi('/api/trade/request', { target_user_id: userId });
    if (r.opened) { await refresh(true); }
    else feedLog('info', `🤝 Le has pedido comerciar a ${name || 'ese jugador'}. Esperando respuesta…`);
  } catch (e) { feedLog('warning', `🤝 ${e.message}`); }
}

function showToast(req) {
  hideToast();
  ensureCss();
  toastEl = document.createElement('div');
  toastEl.className = 'trade-toast';
  toastEl.innerHTML = `<div>🤝 <b>${esc(req.name)}</b> quiere comerciar contigo</div>
    <div class="trade-toast-btns"><button data-a="1">Aceptar</button><button data-a="0">Rechazar</button></div>`;
  toastEl.addEventListener('pointerup', async (ev) => {
    const b = ev.target.closest('[data-a]'); if (!b) return;
    ev.preventDefault(); ev.stopPropagation();
    const accept = b.dataset.a === '1';
    hideToast();
    try { const r = await tapi('/api/trade/respond', { trade_id: req.id, accept }); if (r.opened) await refresh(true); }
    catch (e) { feedLog('warning', `🤝 ${e.message}`); }
  });
  document.body.appendChild(toastEl);
  const me = toastEl; setTimeout(() => { if (toastEl === me) hideToast(); }, 45_000);
}
function hideToast() { if (toastEl) { toastEl.remove(); toastEl = null; } }

// ============================================================
// Estado + ventana
// ============================================================
export async function refresh(open = false) {
  try {
    state = await tapi('/api/trade');
    if (state.trade) {
      if (lastVersion != null && state.trade.version !== lastVersion && state.trade.status === 'open' && !warned) warned = true;
      lastVersion = state.trade.version;
      try { inv = (await api.getInventory()).slots || []; } catch {}
      render();
      startPoll();
    } else {
      closeWindow();
    }
    if (open && !state.trade) feedLog('info', '🤝 El comercio ya no está abierto.');
  } catch (e) { console.warn('[trade]', e); }
}

function startPoll() { if (!pollTimer) pollTimer = setInterval(() => refresh(), 2500); }
function stopPoll() { if (pollTimer) { clearInterval(pollTimer); pollTimer = null; } }

function closeWindow() {
  stopPoll(); closeQty();
  if (el) { el.remove(); el = null; }
  lastVersion = null; warned = false;
}

function grid(items, clickable, kind) {
  const cells = items.map((it, i) => `<div class="trade-cell${clickable ? ' click' : ''}" data-k="${kind}" data-i="${i}" title="${esc(it.name)}">
      <div class="trade-ic">${getItemIconHtml(it.item_id, it.icon)}</div>${it.qty > 1 ? `<span class="trade-q">${fmt(it.qty)}</span>` : ''}</div>`);
  return cells.join('') || '<div class="trade-empty">—</div>';
}

function render() {
  const t = state?.trade;
  if (!t) return closeWindow();
  ensureCss();
  if (!el) {
    el = document.createElement('div');
    el.className = 'trade-win';
    el.addEventListener('pointerdown', ev => ev.stopPropagation());
    el.addEventListener('pointerup', onClick);
    (document.getElementById('worldScreen') || document.body).appendChild(el);
  }
  const confirm = t.status === 'confirm';
  const status = t.my_ok && t.their_ok ? 'Completando…'
    : t.my_ok ? `Esperando a ${esc(t.other.name)}…`
    : t.their_ok ? `<b>${esc(t.other.name)} ha aceptado.</b>`
    : warned ? '<span class="trade-warn">⚠ ¡La oferta ha cambiado! Revísala bien.</span>' : '';
  if (!confirm) {
    // mochila agrupada por objeto (como la verías para ofrecer)
    const invItems = inv.map(s => ({ item_id: s.item_id, qty: s.quantity, name: s.name, icon: s.icon, slot: s.slot }));
    el.innerHTML = `
      <div class="trade-head">🤝 Comerciando con <b>${esc(t.other.name)}</b><button class="trade-x" data-act="cancel">✕</button></div>
      <div class="trade-cols">
        <div class="trade-col"><div class="trade-lbl">Tu oferta <small>(toca para quitar)</small></div><div class="trade-grid">${grid(t.my_items, true, 'mine')}</div></div>
        <div class="trade-col"><div class="trade-lbl">Oferta de ${esc(t.other.name)}</div><div class="trade-grid">${grid(t.their_items, false, 'theirs')}</div></div>
      </div>
      <div class="trade-status">${status}</div>
      <div class="trade-lbl">Tu mochila <small>(toca para ofrecer)</small></div>
      <div class="trade-grid inv">${grid(invItems, true, 'inv')}</div>
      <div class="trade-btns"><button class="ok" data-act="accept" ${t.my_ok ? 'disabled' : ''}>Aceptar</button><button class="no" data-act="cancel">Cancelar</button></div>`;
  } else {
    const list = (arr) => arr.length ? arr.map(i => `<div>• ${esc(i.name)}${i.qty > 1 ? ` × ${i.qty.toLocaleString('es-ES')}` : ''}</div>`).join('') : '<div>Nada</div>';
    el.innerHTML = `
      <div class="trade-head">🤝 ¿Seguro? Comercio con <b>${esc(t.other.name)}</b><button class="trade-x" data-act="cancel">✕</button></div>
      <div class="trade-cols confirm">
        <div class="trade-col"><div class="trade-lbl">Vas a dar</div>${list(t.my_items)}</div>
        <div class="trade-col"><div class="trade-lbl">Vas a recibir</div>${list(t.their_items)}</div>
      </div>
      <div class="trade-status">${t.my_ok ? `Esperando a ${esc(t.other.name)}…` : t.their_ok ? `<b>${esc(t.other.name)} ha confirmado.</b>` : 'Revisa bien antes de confirmar.'}</div>
      <div class="trade-btns"><button class="ok" data-act="accept" ${t.my_ok ? 'disabled' : ''}>Confirmar</button><button class="no" data-act="cancel">Cancelar</button></div>`;
  }
}

async function onClick(ev) {
  ev.stopPropagation();
  const t = state?.trade; if (!t) return;
  const act = ev.target.closest('[data-act]')?.dataset.act;
  if (act === 'cancel') {
    try { await tapi('/api/trade/cancel', {}); } catch {}
    feedLog('info', '🤝 Has cancelado el comercio.');
    closeWindow(); onInventoryChanged();
    return;
  }
  if (act === 'accept') {
    try {
      const r = await tapi('/api/trade/accept', { version: t.version });
      warned = false;
      if (r.stage === 'done') doneTrade();
      else await refresh();
    } catch (e) { feedLog('warning', `🤝 ${e.message}`); warned = true; await refresh(); }
    return;
  }
  const cell = ev.target.closest('.trade-cell.click');
  if (!cell) return;
  const i = Number(cell.dataset.i);
  if (cell.dataset.k === 'inv') {
    const s = inv[i]; if (!s) return;
    const total = inv.filter(x => x.item_id === s.item_id).reduce((a, x) => a + x.quantity, 0);
    if (total <= 1) return offer(s.item_id, 1);
    openQty(cell, total, (q) => offer(s.item_id, q), 'Ofrecer');
  } else if (cell.dataset.k === 'mine') {
    const it = t.my_items[i]; if (!it) return;
    if (it.qty <= 1) return remove(it.item_id, 1);
    openQty(cell, it.qty, (q) => remove(it.item_id, q), 'Quitar');
  }
}

async function offer(itemId, qty) {
  try { await tapi('/api/trade/offer', { item_id: itemId, qty }); } catch (e) { feedLog('warning', `🤝 ${e.message}`); }
  warned = false; await refresh(); onInventoryChanged();
}
async function remove(itemId, qty) {
  try { await tapi('/api/trade/remove', { item_id: itemId, qty }); } catch (e) { feedLog('warning', `🤝 ${e.message}`); }
  warned = false; await refresh(); onInventoryChanged();
}

function openQty(cell, max, fn, verb) {
  closeQty();
  qtyEl = document.createElement('div');
  qtyEl.className = 'trade-qty';
  const opts = [1, 5, 10].filter(n => n < max).concat([max]);
  qtyEl.innerHTML = opts.map(n => `<button data-q="${n}">${verb} ${n === max ? `todo (${fmt(max)})` : n}</button>`).join('')
    + `<button data-q="x">${verb} X…</button>`;
  const r = cell.getBoundingClientRect();
  qtyEl.style.left = `${Math.min(window.innerWidth - 170, r.left)}px`;
  qtyEl.style.top = `${Math.min(window.innerHeight - 190, r.bottom + 4)}px`;
  qtyEl.addEventListener('pointerdown', e => e.stopPropagation());
  qtyEl.addEventListener('pointerup', (e) => {
    e.stopPropagation();
    const b = e.target.closest('[data-q]'); if (!b) return;
    let q = b.dataset.q === 'x' ? Math.floor(Number(prompt(`¿Cuántos? (máx. ${max})`, String(max)))) : Number(b.dataset.q);
    closeQty();
    if (q > 0) fn(Math.min(q, max));
  });
  document.body.appendChild(qtyEl);
}
function closeQty() { if (qtyEl) { qtyEl.remove(); qtyEl = null; } }

function doneTrade() {
  const t = state?.trade;
  feedLog('levelup', `🤝 ¡Comercio completado${t ? ` con ${t.other.name}` : ''}!`);
  try { window.__playSfx?.('coins'); } catch {}
  closeWindow();
  onInventoryChanged();
}

// ============================================================
// Tiempo real
// ============================================================
function onRt(m) {
  if (m.t === 'trq' && m.to === myId) {
    showToast({ id: m.id, name: m.name });
    feedLog('info', `🤝 ${m.name} quiere comerciar contigo.`);
    try { window.__playSfx?.('book_open'); } catch {}
  } else if (m.t === 'tr' && Array.isArray(m.u) && m.u.includes(myId)) {
    if (m.done) { doneTrade(); return; }
    if (m.cancelled) {
      if (m.by !== myId && el) feedLog('warning', '🤝 El otro jugador ha cancelado el comercio.');
      closeWindow(); onInventoryChanged(); return;
    }
    if (m.declined) { feedLog('info', '🤝 Han rechazado tu petición de comercio.'); return; }
    if (m.err) feedLog('warning', `🤝 ${m.err}`);
    const prevVer = state?.trade?.version;
    refresh(!!m.open).then(() => {
      const t = state?.trade;
      if (t && prevVer != null && t.version !== prevVer) warned = true, render();
    });
  }
}

// ============================================================
function ensureCss() {
  if (document.getElementById('tradeCss')) return;
  const s = document.createElement('style'); s.id = 'tradeCss';
  s.textContent = `
    .trade-win { position: fixed; left: 50%; top: 50%; transform: translate(-50%, -50%); z-index: 240; width: min(94vw, 420px);
      max-height: 92vh; overflow: auto; background: linear-gradient(#3a2e1c, #251c10); border: 3px solid #c8a043; border-radius: 8px;
      padding: 10px; color: #f0e0b0; font: 13px sans-serif; box-shadow: 0 10px 30px rgba(0,0,0,0.7); }
    .trade-head { font: bold 15px sans-serif; color: #ffd35a; margin-bottom: 8px; padding-right: 30px; position: relative; }
    .trade-x { position: absolute; right: -2px; top: -4px; width: 28px; height: 28px; border-radius: 50%; border: 2px solid #c8a043; background: #5a2020; color: #fff; font-weight: bold; }
    .trade-cols { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    .trade-cols.confirm .trade-col { background: rgba(0,0,0,0.25); padding: 8px; border-radius: 6px; line-height: 1.6; }
    .trade-lbl { font-weight: bold; color: #e8c560; margin: 6px 0 4px; } .trade-lbl small { color: #b8a070; font-weight: normal; }
    .trade-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 4px; min-height: 48px; background: rgba(0,0,0,0.3); border: 1px solid #6a5028; border-radius: 5px; padding: 4px; }
    .trade-grid.inv { grid-template-columns: repeat(5, 1fr); }
    .trade-cell { position: relative; aspect-ratio: 1; background: rgba(90,70,40,0.35); border: 1px solid #5a4020; border-radius: 4px; display: flex; align-items: center; justify-content: center; }
    .trade-cell.click { cursor: pointer; } .trade-cell.click:active { background: rgba(200,160,67,0.4); }
    .trade-ic { width: 80%; height: 80%; display: flex; align-items: center; justify-content: center; font-size: 22px; }
    .trade-ic svg, .trade-ic img { width: 100%; height: 100%; }
    .trade-q { position: absolute; left: 2px; top: 0; font: bold 11px sans-serif; color: #ffff60; text-shadow: 1px 1px 0 #000; }
    .trade-empty { grid-column: 1 / -1; text-align: center; color: #8a7050; padding: 10px; }
    .trade-status { min-height: 18px; margin: 8px 0 2px; text-align: center; } .trade-warn { color: #ff7060; font-weight: bold; }
    .trade-btns { display: flex; gap: 8px; margin-top: 10px; } .trade-btns button { flex: 1; padding: 11px; border-radius: 6px; font: bold 15px sans-serif; border: 2px solid #c8a043; }
    .trade-btns .ok { background: #2f6a3a; color: #fff; } .trade-btns .ok:disabled { opacity: 0.5; } .trade-btns .no { background: #5a2020; color: #fff; }
    .trade-qty { position: fixed; z-index: 250; background: #251c10; border: 2px solid #c8a043; border-radius: 6px; padding: 4px; display: flex; flex-direction: column; gap: 3px; min-width: 150px; }
    .trade-qty button { background: #3a2f1c; color: #f0e6d2; border: 1px solid #6a5028; border-radius: 4px; padding: 7px; text-align: left; font: 13px sans-serif; }
    .trade-toast { position: fixed; left: 50%; top: calc(env(safe-area-inset-top, 0px) + 60px); transform: translateX(-50%); z-index: 245; background: rgba(30,22,12,0.97);
      border: 2px solid #c8a043; border-radius: 8px; padding: 10px 14px; color: #f0e0b0; font: 14px sans-serif; box-shadow: 0 6px 20px rgba(0,0,0,0.6); }
    .trade-toast-btns { display: flex; gap: 8px; margin-top: 8px; } .trade-toast-btns button { flex: 1; padding: 8px 12px; border-radius: 5px; border: 1px solid #c8a043; font-weight: bold; }
    .trade-toast-btns [data-a="1"] { background: #2f6a3a; color: #fff; } .trade-toast-btns [data-a="0"] { background: #5a2020; color: #fff; }
  `;
  document.head.appendChild(s);
}

export function start(opts) {
  myId = opts.userId;
  feedLog = opts.feedLog || (() => {});
  onInventoryChanged = opts.onInventoryChanged || (() => {});
  if (offRt) offRt();
  offRt = onMessage(onRt);
  // ¿quedó algo abierto o alguna petición pendiente?
  tapi('/api/trade').then(s => {
    if (s.trade) refresh(true);
    else if (s.incoming?.length) showToast(s.incoming[0]);
  }).catch(() => {});
  if (typeof window !== 'undefined') window.__trade = { request: requestTrade, refresh };
}

export function stop() {
  closeWindow(); hideToast();
  if (offRt) { offRt(); offRt = null; }
}
