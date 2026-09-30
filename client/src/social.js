/**
 * SebasPresent — Pestaña 👥 (Sesión 50): dos subpestañas
 *   👥 Amigos   — tu lista (conectados/desconectados, dónde están) y los
 *                 jugadores cerca de ti. Botones: 👣 Seguir · 🤝 Comerciar.
 *   🐎 Monturas — tu colección, como en WoW: tocas una y la llamas; tocas
 *                 la que llevas y te bajas.
 */
import * as api from './api.js';
import * as mounts from './mounts.js';
import { MOUNTS, MOUNT_LIST } from './shared/mounts.js';
import { getRegionInfo } from './terrain.js';

let pane = null, getPlayer = () => null, getPeers = () => [], feedLog = () => {};
let onFollow = () => {}, onTrade = () => {};
let sub = 'friends';
let friends = [];
let timer = null;

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
try { sub = localStorage.getItem('sp.socialTab') || 'friends'; } catch {}

async function loadFriends() {
  try { friends = (await api.tradeCall('/api/friends')).friends || []; } catch {}
}

function visible() { return pane && pane.offsetParent !== null; }

function render() {
  if (!pane) return;
  const p = getPlayer();
  const peers = getPeers();
  const near = p ? peers.filter(q => Math.hypot(q.x - p.position.x, q.z - p.position.z) < 60) : [];
  const peerIds = new Set(peers.map(q => q.user_id));
  let body = '';
  if (sub === 'friends') {
    const row = (id, name, online, where, isFriend, canAct) => `
      <div class="soc-row">
        <span class="soc-dot ${online ? 'on' : ''}"></span>
        <div class="soc-name">${esc(name)}<small>${esc(where)}</small></div>
        ${canAct ? `<button data-follow="${id}" data-n="${esc(name)}" title="Seguir">👣</button><button data-trade="${id}" data-n="${esc(name)}" title="Comerciar">🤝</button>` : ''}
        ${isFriend ? `<button class="soc-del" data-del="${id}" title="Quitar">✕</button>` : `<button data-add="${esc(name)}" title="Añadir a amigos">＋</button>`}
      </div>`;
    const fl = friends.map(f => {
      const where = f.online ? (Number.isFinite(f.x) ? (getRegionInfo(f.x, f.z)?.name || 'En la isla') : 'Conectado') : 'Desconectado';
      return row(f.id, f.name, f.online, where, true, f.online && peerIds.has(f.id));
    }).join('') || '<div class="soc-empty">Aún no tienes amigos. Añade uno por su nombre.</div>';
    const friendIds = new Set(friends.map(f => f.id));
    const nl = near.filter(q => !friendIds.has(q.user_id)).map(q => row(q.user_id, q.username || 'Jugador', true, `a ${Math.round(Math.hypot(q.x - p.position.x, q.z - p.position.z))} m`, false, true)).join('')
      || '<div class="soc-empty">No hay nadie cerca.</div>';
    body = `
      <form class="soc-add"><input name="n" placeholder="Nombre del jugador" maxlength="32" autocomplete="off"><button>Añadir</button></form>
      <div class="soc-h">Amigos (${friends.filter(f => f.online).length}/${friends.length} conectados)</div>${fl}
      <div class="soc-h">Cerca de ti</div>${nl}`;
  } else {
    const cur = mounts.id();
    const owned = mounts.getOwned();
    body = MOUNT_LIST.map(id => {
      const M = MOUNTS[id], has = owned.includes(id), on = cur === id;
      const flyTxt = M.fly ? (mounts.canFly() ? 'Vuela ✔' : `Vuela con nivel ${M.flyLevel}`) : 'Por tierra';
      return `<div class="soc-mount ${has ? 'has' : ''} ${on ? 'on' : ''}" data-mount="${has ? id : ''}">
        <div class="soc-mi">${M.icon}</div>
        <div class="soc-mt"><b>${esc(M.name)}</b><small>${has ? (on ? 'Montado · toca para bajar' : 'Toca para montar') : `Tanausú (La Laguna) · ${M.price.toLocaleString('es-ES')} monedas · nivel ${M.level}`}</small>
        <small>Velocidad ×${(M.fly && mounts.canFly() ? M.flySpeed : M.speed).toFixed(1)} · ${flyTxt}</small></div>
      </div>`;
    }).join('') + '<div class="soc-empty">Si te atacan no puedes montar en 10 s, y si te golpean te caes.</div>';
  }
  pane.innerHTML = `
    <div class="soc-tabs"><button data-sub="friends" class="${sub === 'friends' ? 'act' : ''}">👥 Amigos</button><button data-sub="mounts" class="${sub === 'mounts' ? 'act' : ''}">🐎 Monturas</button></div>
    <div class="soc-body">${body}</div>`;
}

async function onClick(ev) {
  const t = ev.target;
  const s = t.closest('[data-sub]');
  if (s) { sub = s.dataset.sub; try { localStorage.setItem('sp.socialTab', sub); } catch {} if (sub === 'mounts') mounts.refresh().then(render); render(); return; }
  const m = t.closest('[data-mount]');
  if (m) {
    const id = m.dataset.mount;
    if (!id) { feedLog('info', '🐎 Esa montura te la vende Tanausú, el cuadrero de La Laguna.'); return; }
    if (mounts.id() === id) mounts.dismount(); else { if (mounts.id()) mounts.dismount(); mounts.mount(id); }
    render(); return;
  }
  const f = t.closest('[data-follow]'); if (f) { onFollow(Number(f.dataset.follow), f.dataset.n); return; }
  const tr = t.closest('[data-trade]'); if (tr) { onTrade(Number(tr.dataset.trade), tr.dataset.n); return; }
  const d = t.closest('[data-del]');
  if (d) { try { await api.tradeCall('/api/friends/remove', { id: Number(d.dataset.del) }); } catch {} await loadFriends(); render(); return; }
  const a = t.closest('[data-add]'); if (a) { await addFriend(a.dataset.add); return; }
}

async function addFriend(name) {
  if (!name) return;
  try { const r = await api.tradeCall('/api/friends/add', { name }); feedLog('info', `👥 ${r.name} añadido a tus amigos.`); }
  catch (e) { feedLog('warning', `👥 ${e.message}`); }
  await loadFriends(); render();
}

function ensureCss() {
  if (document.getElementById('socialCss')) return;
  const s = document.createElement('style'); s.id = 'socialCss';
  s.textContent = `
    .soc-tabs { display: flex; gap: 4px; margin-bottom: 6px; }
    .soc-tabs button { flex: 1; padding: 7px 4px; background: #3a2f1c; color: #d8c8a0; border: 1px solid #6a5028; border-radius: 4px; font: bold 12px sans-serif; }
    .soc-tabs button.act { background: #6a4a20; color: #ffe8a0; border-color: #c8a043; }
    .soc-body { font: 12px sans-serif; color: #f0e0b0; }
    .soc-h { color: #e8c560; font-weight: bold; margin: 8px 0 3px; }
    .soc-row { display: flex; align-items: center; gap: 5px; padding: 4px 2px; border-bottom: 1px solid rgba(106,80,40,0.4); }
    .soc-row button { background: #3a2f1c; border: 1px solid #6a5028; color: #f0e0b0; border-radius: 4px; padding: 3px 6px; font-size: 13px; }
    .soc-row .soc-del { color: #e08080; }
    .soc-dot { width: 8px; height: 8px; border-radius: 50%; background: #555; flex: none; } .soc-dot.on { background: #4ad04a; box-shadow: 0 0 4px #4ad04a; }
    .soc-name { flex: 1; min-width: 0; overflow: hidden; } .soc-name small { display: block; color: #a89070; font-size: 10px; }
    .soc-empty { color: #9a8060; font-size: 11px; padding: 6px 2px; }
    .soc-add { display: flex; gap: 4px; } .soc-add input { flex: 1; min-width: 0; padding: 6px; background: #1a140c; color: #f0e0b0; border: 1px solid #6a5028; border-radius: 4px; }
    .soc-add button { background: #2f6a3a; color: #fff; border: 1px solid #c8a043; border-radius: 4px; padding: 6px 8px; font-weight: bold; }
    .soc-mount { display: flex; gap: 8px; align-items: center; padding: 8px; margin-bottom: 6px; border: 1px solid #6a5028; border-radius: 6px; background: rgba(0,0,0,0.25); opacity: 0.6; }
    .soc-mount.has { opacity: 1; cursor: pointer; } .soc-mount.on { border-color: #ffd35a; box-shadow: 0 0 8px rgba(255,211,90,0.5); background: rgba(106,74,32,0.45); }
    .soc-mi { font-size: 30px; width: 40px; text-align: center; } .soc-mt small { display: block; color: #b8a070; font-size: 10px; margin-top: 2px; }
  `;
  document.head.appendChild(s);
}

export function start(opts) {
  pane = document.querySelector('.osrs-tab-pane[data-tab="friends"]');
  if (!pane) return;
  getPlayer = opts.getPlayer; getPeers = opts.getPeers; feedLog = opts.feedLog || (() => {});
  onFollow = opts.onFollow || (() => {}); onTrade = opts.onTrade || (() => {});
  ensureCss();
  pane.addEventListener('pointerup', onClick);
  pane.addEventListener('submit', (e) => { e.preventDefault(); const n = e.target.querySelector('input')?.value?.trim(); if (n) addFriend(n); });
  loadFriends().then(render);
  render();
  timer = setInterval(async () => {
    if (!visible()) return;
    if (document.activeElement?.closest?.('.soc-add')) return;   // no romper lo que escribes
    if (sub === 'friends') await loadFriends();
    render();
  }, 4000);
}

export function stop() { if (timer) clearInterval(timer); timer = null; }
