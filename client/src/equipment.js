/**
 * SebasPresent — Equipment module (Sesión 22)
 *
 * Gestiona los 9 slots de equipamiento del player.
 *
 * Slots (mismos que OSRS):
 *   weapon, shield, helm, body, legs, boots, cape, amulet, ring
 *
 * API pública:
 *   init({ apiBase, getToken })  — fetch inicial + render del tab
 *   refresh()                     — re-fetch del server
 *   getEquipped(slotId)           — { item_id, name, icon, weapon_type, ... } | null
 *   getWeaponType()               — 'unarmed' | '1h_sword' | '2h_sword' | 'bow' | 'staff'
 *   equipFromInventory(slotIndex) — mueve item del inv slot a su equipment slot
 *   unequip(slotId)               — devuelve item al inventario
 *   onChange(cb)                  — suscribirse a cambios
 */

import { getItemIconHtml, getEquipSlotIconHtml } from './item_icons.js';

let apiBase = null;
let getToken = null;
let initialized = false;

let equipped = {};
const listeners = [];

// Catálogo de slots con metadata visual.
// `icon` se mantiene como emoji para fallback / título; el render usa
// SVGs custom desde item_icons.js cuando están disponibles.
export const EQUIP_SLOTS = [
  { id: 'helm',   label: 'Casco',    icon: '⛑',  row: 0, col: 1 },
  { id: 'cape',   label: 'Capa',     icon: '🧣',  row: 1, col: 0 },
  { id: 'amulet', label: 'Amuleto',  icon: '📿',  row: 1, col: 1 },
  { id: 'weapon', label: 'Arma',     icon: '⚔️',  row: 2, col: 0 },
  { id: 'body',   label: 'Pecho',    icon: '🛡',  row: 2, col: 1 },
  { id: 'shield', label: 'Escudo',   icon: '🛡',  row: 2, col: 2 },
  { id: 'legs',   label: 'Piernas',  icon: '👖',  row: 3, col: 1 },
  { id: 'ring',   label: 'Anillo',   icon: '💍',  row: 4, col: 0 },
  { id: 'boots',  label: 'Botas',    icon: '🥾',  row: 4, col: 2 },
];

const WEAPON_TYPE_TO_COMBAT = {
  '1h_sword': '1h_sword',
  '2h_sword': '2h_sword',
  'bow':      'bow',
  'staff':    'staff',
  'dagger':   '1h_sword',
};

// ============================================================
// API pública
// ============================================================

/**
 * Inicializa el módulo de equipment. Idempotente.
 *
 * Side effects:
 *   - Inyecta CSS del panel en `<head>`
 *   - Inyecta el DOM del panel
 *   - Fetcha el estado actual del server vía `refresh()`
 *
 * @param {object} opts
 * @param {string} opts.apiBase   Base URL del worker (ej 'https://x.workers.dev').
 * @param {() => string|null} opts.getToken  Getter del JWT actual del player.
 * @returns {Promise<void>}
 *
 * @example
 *   await equipment.init({
 *     apiBase: 'https://sebaspresent.srmrpapitas.workers.dev',
 *     getToken: () => localStorage.getItem('token'),
 *   });
 */
export async function init(opts) {
  if (initialized) return;
  apiBase = opts.apiBase;
  getToken = opts.getToken || (() => null);

  injectStyles();
  injectPanel();

  await refresh();
  initialized = true;
}

/**
 * Re-fetcha el estado de equipamiento desde el server y actualiza el panel.
 * Llamado automáticamente después de equipar/desequipar.
 *
 * Side effects:
 *   - Actualiza `equipped` (mapa interno slot → item).
 *   - Re-renderiza el panel.
 *   - Notifica a los listeners de `onChange`.
 *
 * No-op si no hay token (player no logueado).
 *
 * @returns {Promise<void>}
 */
export async function refresh() {
  const token = getToken?.();
  if (!token) return;
  try {
    const res = await fetch(`${apiBase}/api/equipment`, {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    if (!res.ok) {
      console.warn('[equipment] refresh failed:', res.status);
      return;
    }
    const data = await res.json();
    equipped = data.slots || {};
    renderPanel();
    notifyChange();
  } catch (err) {
    console.error('[equipment] refresh err:', err);
  }
}

/**
 * Devuelve el item equipado en un slot, o `null` si el slot está vacío.
 *
 * @param {'helm'|'cape'|'amulet'|'weapon'|'body'|'shield'|'legs'|'ring'|'boots'} slotId
 * @returns {EquippedItem|null}
 *
 * @typedef {object} EquippedItem
 * @property {string} item_id        Ej 'axe', 'iron_sword', 'leather_helm'.
 * @property {string} name           Nombre display (ej 'Hacha de bronce').
 * @property {string} [icon]         Path al icono SVG (o emoji fallback).
 * @property {string} [weapon_type]  Solo en slot weapon: 'axe'|'1h_sword'|...
 * @property {number} [attack_bonus]
 * @property {number} [defense_bonus]
 */
export function getEquipped(slotId) {
  return equipped[slotId] || null;
}

/**
 * Devuelve una copia del mapa entero de slots equipados.
 * Útil para el debug panel y health check.
 *
 * @returns {Record<string, EquippedItem>}
 */
export function getAll() {
  return { ...equipped };
}

/**
 * Devuelve el weapon_type efectivo para combate, mapeado al de las anims.
 *
 * Mapping:
 *   - Sin arma equipada o slot vacío → 'unarmed'
 *   - axe / pickaxe → 'axe' / 'pickaxe' (herramientas, anim de attack = punching)
 *   - dagger → mapeado a '1h_sword' (usan mismas anims)
 *   - 1h_sword, 2h_sword, bow, staff → tal cual
 *
 * Combat.js usa este valor para decidir qué animación de attack reproducir.
 *
 * @returns {'unarmed'|'1h_sword'|'2h_sword'|'bow'|'staff'|'axe'|'pickaxe'}
 *
 * @example
 *   const wt = equipment.getWeaponType();
 *   if (wt === '1h_sword' || wt === '2h_sword') character.playDraw();
 *   else if (wt === 'axe' || wt === 'pickaxe') character.setCombatStance(true);
 */
export function getWeaponType() {
  const w = equipped.weapon;
  if (!w || !w.weapon_type) return 'unarmed';
  return WEAPON_TYPE_TO_COMBAT[w.weapon_type] || 'unarmed';
}

/**
 * Devuelve `{ item_id, weapon_type }` del arma equipada, o `null`.
 * weapon_type ya viene mapeado para combat (ver `getWeaponType()`).
 *
 * @returns {{ item_id: string, weapon_type: string }|null}
 */
export function getEquippedWeaponItem() {
  const w = equipped.weapon;
  if (!w) return null;
  return {
    item_id: w.item_id,
    weapon_type: WEAPON_TYPE_TO_COMBAT[w.weapon_type] || 'default',
  };
}

// ============================================================
// Sesión 33 (B-001) — Selección de tool disponible para gathering
// ============================================================

// Ranking de tools por tipo. Mayor índice = mejor.
// HOY (S33) solo existe axe_bronze. Cuando agreguemos axe_iron / axe_steel /
// axe_mithril / etc., añadirlos acá EN ORDEN ASCENDENTE de calidad.
// Mantener en sync con D1 `items` y con `WEAPON_TRANSFORMS` en character.js.
const TOOL_RANKINGS = {
  axe:     ['axe_bronze' /* , 'axe_iron', 'axe_steel', 'axe_mithril', ... */],
  pickaxe: ['pickaxe_bronze' /* , 'pickaxe_iron', ... */],
};

/**
 * Busca en `inventorySlots` (típicamente `inventory.getState()`) la MEJOR
 * tool del weaponType pedido (axe/pickaxe), o detecta si ya está equipada.
 *
 * Orden de preferencia:
 *   1. Si la weapon equipada ES del tipo pedido → la devuelve (no hace falta swap).
 *   2. Si NO, busca en inventario la de mayor ranking → la devuelve.
 *   3. Si no hay ninguna → null.
 *
 * @param {string} toolWeaponType  'axe' | 'pickaxe'
 * @param {Array<{item_id, weapon_type}|null>} inventorySlots  Estado del inv.
 * @returns {{ item_id: string, weapon_type: string, alreadyEquipped: boolean }|null}
 */
export function findBestToolInInventory(toolWeaponType, inventorySlots) {
  const ranking = TOOL_RANKINGS[toolWeaponType];
  if (!ranking || ranking.length === 0) return null;

  // 1) ¿Ya está equipada una tool del tipo pedido?
  const w = equipped.weapon;
  if (w && w.weapon_type === toolWeaponType && ranking.includes(w.item_id)) {
    return { item_id: w.item_id, weapon_type: toolWeaponType, alreadyEquipped: true };
  }

  // 2) Buscar en inventario la de MAYOR ranking presente.
  if (!Array.isArray(inventorySlots)) return null;
  let bestIdx = -1;
  let bestItemId = null;
  for (const slot of inventorySlots) {
    if (!slot) continue;
    if (slot.weapon_type !== toolWeaponType) continue;
    const idx = ranking.indexOf(slot.item_id);
    if (idx > bestIdx) {
      bestIdx = idx;
      bestItemId = slot.item_id;
    }
  }
  if (bestItemId) {
    return { item_id: bestItemId, weapon_type: toolWeaponType, alreadyEquipped: false };
  }

  return null;
}

/**
 * Atajo para el caso más común: el mejor hacha disponible para tala.
 * Equivale a `findBestToolInInventory('axe', inventorySlots)`.
 *
 * @param {Array} inventorySlots  Estado del inv (inventory.getState()).
 * @returns {{ item_id: string, weapon_type: 'axe', alreadyEquipped: boolean }|null}
 */
export function getBestAxeAvailable(inventorySlots) {
  return findBestToolInInventory('axe', inventorySlots);
}

/**
 * Subscribe a cambios en el equipment. El callback se llama cada vez
 * que se equipa/desequipa algo (después de `refresh()`).
 *
 * @param {(slots: Record<string, EquippedItem>) => void} cb
 * @returns {() => void}  Función para desuscribirse.
 *
 * @example
 *   const unsub = equipment.onChange((slots) => {
 *     console.log('Nueva weapon:', slots.weapon?.item_id);
 *   });
 *   // más tarde:
 *   unsub();
 */
export function onChange(cb) {
  listeners.push(cb);
  return () => {
    const idx = listeners.indexOf(cb);
    if (idx >= 0) listeners.splice(idx, 1);
  };
}

/**
 * Equipa el item que está en el slot del inventario indicado.
 * El server determina automáticamente el slot de equipo correcto según
 * `items.equip_slot` del catálogo. Si el slot estaba ocupado, el viejo
 * vuelve al inv.
 *
 * @param {number} slotIndex   Slot del inventario (0-27).
 * @returns {Promise<{ok?: boolean, error?: string, message?: string}>}
 *
 * @example
 *   const res = await equipment.equipFromInventory(3);
 *   if (res.error === 'level_too_low') alert(res.message);
 */
export async function equipFromInventory(slotIndex) {
  const token = getToken?.();
  if (!token) return { error: 'no_token' };
  try {
    const res = await fetch(`${apiBase}/api/equipment/equip`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ slot_index: slotIndex }),
    });
    const data = await res.json();
    if (!res.ok) return data;
    await refresh();
    // Sesión 32 — SFX al equipar (post-refresh para que ya esté en su slot
    // visualmente). Misma lógica para weapon/armor/cualquier item.
    try {
      if (typeof window.__playSfx === 'function') {
        window.__playSfx('equip_weapon');
      }
    } catch {}
    return data;
  } catch (err) {
    console.error('[equipment] equip err:', err);
    return { error: 'network' };
  }
}

/**
 * Desequipa el item del slot indicado. Vuelve al inventario en un slot libre.
 * Si el inv está lleno, el server devuelve `{ error: 'inventory_full' }`.
 *
 * @param {'helm'|'cape'|'amulet'|'weapon'|'body'|'shield'|'legs'|'ring'|'boots'} slotId
 * @returns {Promise<{ok?: boolean, error?: string}>}
 */
export async function unequip(slotId) {
  const token = getToken?.();
  if (!token) return { error: 'no_token' };
  try {
    const res = await fetch(`${apiBase}/api/equipment/unequip`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ slot_id: slotId }),
    });
    const data = await res.json();
    if (!res.ok) return data;
    await refresh();
    return data;
  } catch (err) {
    console.error('[equipment] unequip err:', err);
    return { error: 'network' };
  }
}

function notifyChange() {
  for (const cb of listeners) {
    try { cb(equipped); } catch (e) { console.warn(e); }
  }
}

// ============================================================
// UI
// ============================================================

function injectStyles() {
  if (document.getElementById('equipment-styles')) return;
  const style = document.createElement('style');
  style.id = 'equipment-styles';
  style.textContent = `
    .equip-panel {
      padding: 12px 10px;
      color: #e8c560;
      font-family: 'Cinzel', serif;
      height: 100%;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .equip-panel-title {
      text-align: center;
      font-size: 14px;
      font-weight: 700;
      letter-spacing: 0.05em;
      color: #c8a043;
      text-shadow: 0 2px 4px rgba(0,0,0,0.9);
    }
    .equip-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      grid-template-rows: repeat(5, auto);
      gap: 6px;
      max-width: 280px;
      margin: 0 auto;
      width: 100%;
    }
    .equip-slot {
      background: linear-gradient(135deg, rgba(60, 45, 30, 0.95), rgba(30, 20, 12, 0.95));
      border: 2px solid #5a4a30;
      border-radius: 4px;
      aspect-ratio: 1;
      min-height: 48px;
      display: flex;
      align-items: center;
      justify-content: center;
      position: relative;
      cursor: pointer;
      -webkit-tap-highlight-color: transparent;
      transition: transform 0.08s, border-color 0.15s, box-shadow 0.15s;
    }
    .equip-slot:active { transform: scale(0.94); }
    .equip-slot.empty { opacity: 0.55; }
    .equip-slot.occupied {
      border-color: #c8a043;
      background: linear-gradient(135deg, rgba(80, 60, 30, 0.95), rgba(50, 35, 18, 0.95));
      box-shadow: 0 0 8px rgba(200, 160, 67, 0.25), inset 0 0 4px rgba(255, 208, 96, 0.15);
    }
    .equip-slot-icon {
      font-size: 24px;
      line-height: 1;
      filter: drop-shadow(0 2px 3px rgba(0,0,0,0.8));
    }
    .equip-slot.empty .equip-slot-icon {
      opacity: 0.45;
      filter: grayscale(0.6);
    }
    .equip-slot-icon-wrap {
      display: inline-flex;
      width: 32px; height: 32px;
      align-items: center; justify-content: center;
      filter: drop-shadow(0 2px 3px rgba(0,0,0,0.8));
    }
    .equip-slot-icon-wrap svg { width: 100%; height: 100%; }
    .equip-slot-empty-svg {
      display: inline-flex;
      width: 28px; height: 28px;
      align-items: center; justify-content: center;
      opacity: 0.55;
      filter: drop-shadow(0 1px 2px rgba(0,0,0,0.6));
    }
    .equip-slot-empty-svg svg { width: 100%; height: 100%; }
    .equip-tooltip-icon {
      display: inline-flex;
      width: 22px; height: 22px;
      vertical-align: middle;
      align-items: center; justify-content: center;
    }
    .equip-tooltip-icon svg { width: 100%; height: 100%; }
    .equip-slot-label {
      position: absolute;
      bottom: -14px;
      left: 50%;
      transform: translateX(-50%);
      font-size: 8px;
      color: rgba(200, 160, 67, 0.65);
      letter-spacing: 0.04em;
      white-space: nowrap;
      text-shadow: 0 1px 1px rgba(0,0,0,0.9);
      pointer-events: none;
    }
    .equip-footer {
      margin-top: 16px;
      padding-top: 10px;
      border-top: 1px solid rgba(200, 160, 67, 0.25);
      text-align: center;
      font-family: 'IM Fell English', serif;
      font-size: 11px;
      color: #d4b850;
    }
    .equip-footer-row {
      display: flex;
      justify-content: space-between;
      padding: 2px 8px;
      gap: 8px;
    }
    .equip-footer-row b { color: #ffd060; }

    .equip-tooltip {
      position: fixed;
      z-index: 200;
      background: rgba(20, 14, 8, 0.97);
      border: 2px solid #c8a043;
      border-radius: 6px;
      padding: 10px 14px;
      min-width: 200px;
      max-width: 260px;
      color: #e8c560;
      font-family: 'IM Fell English', serif;
      font-size: 13px;
      box-shadow: 0 8px 24px rgba(0,0,0,0.7);
    }
    .equip-tooltip-title {
      font-family: 'Cinzel', serif;
      font-weight: 700;
      font-size: 14px;
      color: #fff8d0;
      margin-bottom: 6px;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .equip-tooltip-desc {
      font-size: 11px;
      color: #d4b850;
      margin: 4px 0;
      line-height: 1.4;
    }
    .equip-tooltip-stat {
      display: flex;
      justify-content: space-between;
      font-size: 12px;
      margin: 2px 0;
    }
    .equip-tooltip-stat b { color: #fff8d0; }
    .equip-tooltip-actions {
      margin-top: 8px;
      display: flex;
      gap: 6px;
    }
    .equip-tooltip-btn {
      flex: 1;
      padding: 6px 8px;
      border-radius: 3px;
      border: 1.5px solid #c8a043;
      background: rgba(120, 30, 20, 0.85);
      color: #fff8d0;
      font-family: 'Cinzel', serif;
      font-size: 11px;
      font-weight: 700;
      cursor: pointer;
      -webkit-tap-highlight-color: transparent;
    }
    .equip-tooltip-btn.secondary {
      background: rgba(40, 25, 15, 0.85);
      color: #c8a043;
    }
    .equip-tooltip-btn:active { transform: scale(0.95); }

    /* Sesión 38 (fix v3) — Sin overrides desktop por elemento: el escalado en
       PC se hace con zoom uniforme del sidebar (world.js / style.css), que
       mantiene la proporción de mobile. */
  `;
  document.head.appendChild(style);
}

function injectPanel() {
  let pane = document.querySelector('.osrs-tab-pane[data-tab="equipment"]')
          || document.querySelector('.osrs-tab-pane[data-tab="equip"]')
          || document.querySelector('.osrs-tab-pane[data-tab="worn"]');

  if (!pane) {
    console.warn('[equipment] No se encontró tab pane de equipment.');
    return;
  }
  pane.dataset.equipMounted = '1';
  renderPanel();
}

function renderPanel() {
  const pane = document.querySelector('.osrs-tab-pane[data-equip-mounted="1"]')
            || document.querySelector('.osrs-tab-pane[data-tab="equipment"]')
            || document.querySelector('.osrs-tab-pane[data-tab="equip"]')
            || document.querySelector('.osrs-tab-pane[data-tab="worn"]');
  if (!pane) return;

  let attackBonus = 0;
  let defenceBonus = 0;
  for (const slot of EQUIP_SLOTS) {
    const item = equipped[slot.id];
    if (item) {
      attackBonus += item.attack_bonus | 0;
      defenceBonus += item.defence_bonus | 0;
    }
  }

  let html = '<div class="equip-panel">';
  html += '<div class="equip-panel-title">⚔ Equipamiento</div>';
  html += '<div class="equip-grid">';
  for (const slot of EQUIP_SLOTS) {
    const item = equipped[slot.id];
    const filled = !!item;
    // Sesión 26 — Slots vacíos también usan SVG custom (silueta gris).
    const iconHtml = filled
      ? `<span class="equip-slot-icon-wrap">${getItemIconHtml(item.item_id, item.icon)}</span>`
      : `<span class="equip-slot-empty-svg">${getEquipSlotIconHtml(slot.id, slot.icon)}</span>`;
    html += `
      <div class="equip-slot ${filled ? 'occupied' : 'empty'}"
           data-slot-id="${slot.id}"
           style="grid-row: ${slot.row + 1}; grid-column: ${slot.col + 1};">
        ${iconHtml}
        <span class="equip-slot-label">${slot.label}</span>
      </div>
    `;
  }
  html += '</div>';

  html += `
    <div class="equip-footer">
      <div class="equip-footer-row"><span>Bonus Ataque:</span><b>+${attackBonus}</b></div>
      <div class="equip-footer-row"><span>Bonus Defensa:</span><b>+${defenceBonus}</b></div>
    </div>
  `;
  html += '</div>';
  pane.innerHTML = html;

  pane.querySelectorAll('.equip-slot').forEach(el => {
    el.addEventListener('pointerup', (ev) => {
      if (ev.button !== undefined && ev.button !== 0) return;
      ev.preventDefault();
      ev.stopPropagation();
      const slotId = el.dataset.slotId;
      showSlotTooltip(slotId, ev.clientX, ev.clientY);
    });
  });
}

function showSlotTooltip(slotId, clientX, clientY) {
  const old = document.getElementById('equipTooltip');
  if (old) old.remove();

  const slot = EQUIP_SLOTS.find(s => s.id === slotId);
  if (!slot) return;
  const item = equipped[slotId];

  const el = document.createElement('div');
  el.id = 'equipTooltip';
  el.className = 'equip-tooltip';

  if (item) {
    el.innerHTML = `
      <div class="equip-tooltip-title"><span class="equip-tooltip-icon">${getItemIconHtml(item.item_id, item.icon)}</span> ${item.name}</div>
      ${item.description ? `<div class="equip-tooltip-desc">${escapeHtml(item.description)}</div>` : ''}
      <div class="equip-tooltip-stat"><span>Ranura:</span><b>${slot.label}</b></div>
      <div class="equip-tooltip-stat"><span>Bonus Ataque:</span><b>+${item.attack_bonus | 0}</b></div>
      <div class="equip-tooltip-stat"><span>Bonus Defensa:</span><b>+${item.defence_bonus | 0}</b></div>
      <div class="equip-tooltip-actions">
        <button class="equip-tooltip-btn" data-action="unequip">Quitar</button>
        <button class="equip-tooltip-btn secondary" data-action="close">Cerrar</button>
      </div>
    `;
  } else {
    el.innerHTML = `
      <div class="equip-tooltip-title"><span class="equip-tooltip-icon">${getEquipSlotIconHtml(slot.id, slot.icon)}</span> ${slot.label}</div>
      <div class="equip-tooltip-desc">Ranura vacía. Equipa un objeto desde la mochila tocándolo.</div>
      <div class="equip-tooltip-actions">
        <button class="equip-tooltip-btn secondary" data-action="close">Cerrar</button>
      </div>
    `;
  }
  document.body.appendChild(el);

  const maxX = window.innerWidth - el.offsetWidth - 10;
  const maxY = window.innerHeight - el.offsetHeight - 10;
  el.style.left = Math.min(Math.max(10, clientX - el.offsetWidth / 2), maxX) + 'px';
  el.style.top  = Math.min(Math.max(10, clientY - el.offsetHeight - 10), maxY) + 'px';

  el.querySelectorAll('[data-action]').forEach(btn => {
    btn.addEventListener('pointerup', async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      const act = btn.dataset.action;
      if (act === 'unequip') {
        const result = await unequip(slotId);
        if (result.error) {
          alert(result.message || result.error);
        }
        el.remove();
      } else {
        el.remove();
      }
    });
  });

  const outsideClose = (e) => {
    if (!el.contains(e.target)) {
      el.remove();
      document.removeEventListener('pointerdown', outsideClose, true);
    }
  };
  setTimeout(() => document.addEventListener('pointerdown', outsideClose, true), 100);
}

function escapeHtml(s) {
  if (s == null) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
