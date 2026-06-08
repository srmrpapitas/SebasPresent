/**
 * SebasPresent — Spellbook (Sesión 41, Bloque 2 — mago)
 *
 * Inyecta los hechizos de COMBATE en #magicSpellGrid (tab Magia), al lado del
 * "Home" de home_teleport.js. Estilo OSRS:
 *   - Íconos SVG por hechizo (no emojis).
 *   - Click izquierdo = seleccionar (contorno blanco alrededor, como OSRS).
 *   - Long press (móvil) / click derecho (PC) = menú: Cast / Autocast / Next cast.
 *
 * El AUTOCAST se controla y se ve en la pestaña de COMBATE (no acá): combat.js
 * lee getAutocastSpellMeta()/isAutocastOn() y dibuja el slot de autocast con el
 * SVG del hechizo + toggle on/off (la pestaña de combate se adapta a mago).
 *
 * combat.js, al atacar, pide getSelectedSpellId():
 *   - autocast ON  → devuelve el hechizo de autocast (se repite).
 *   - autocast OFF → devuelve null (el staff pega melee, golpe con el palo).
 *
 * "Next cast" guarda nextCastSpellId; la COLA real (lanzar al terminar el cast
 * actual sin interrumpir) es la pieza 3. Por ahora el botón existe y registra
 * el hechizo encolado, que combat.js mostrará en la pestaña de combate.
 *
 * Mantener SPELLBOOK en sync con server/magic.js. El server tiene la autoridad
 * (rechaza spell inválido / nivel insuficiente / sin maná).
 */

// ============================================================
// Íconos SVG (mismo estilo dibujado a mano que los del HUD)
// ============================================================
const SVG = {
  fire_strike:
    '<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">' +
    '<path d="M16 3 C12 10 9 12 9 18 a7 7 0 0 0 14 0 c0-3-2-6-4-9 c-1 3-2 4-3 4 c0-5 0-9 1-10Z" fill="#ff6622" stroke="#000" stroke-width="1.1"/>' +
    '<path d="M16 15 c-2 2-3 4-3 6 a3 3 0 0 0 6 0 c0-2-1-3-3-6Z" fill="#ffd040"/></svg>',
  ice_spear:
    '<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">' +
    '<polygon points="16,3 22,12 16,29 10,12" fill="#55bbff" stroke="#000" stroke-width="1.1"/>' +
    '<polygon points="16,3 22,12 16,12" fill="#aee0ff"/>' +
    '<line x1="16" y1="6" x2="16" y2="26" stroke="#eaf6ff" stroke-width="1"/></svg>',
  thunderbolt:
    '<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">' +
    '<polygon points="18,3 8,17 15,17 13,29 24,13 17,13" fill="#ffe23a" stroke="#000" stroke-width="1.1"/></svg>',
  entangle:
    '<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">' +
    '<path d="M16 28 C10 22 8 16 12 10 C14 14 18 14 20 10 C24 16 22 22 16 28Z" fill="#44cc55" stroke="#000" stroke-width="1.1"/>' +
    '<path d="M16 26 C14 20 16 14 16 12" fill="none" stroke="#2a8a3a" stroke-width="1.3"/></svg>',
};

// Espejo de SPELLS de server/magic.js (lo que la UI necesita).
const SPELLBOOK = [
  { id: 'fire_strike', name: 'Rayo de fuego',  level: 1,  mana: 5  },
  { id: 'ice_spear',   name: 'Lanza de hielo', level: 20, mana: 9  },
  { id: 'thunderbolt', name: 'Rayo',           level: 40, mana: 14 },
  { id: 'entangle',    name: 'Enredar',        level: 35, mana: 12 },
];

function spellMeta(id) { return SPELLBOOK.find(s => s.id === id) || null; }

// ============================================================
// Estado
// ============================================================
let started = false;
let getMagicLevel = () => 1;
let getMana = () => ({ current: 0, max: 0 });
let feedLog = () => {};
let onAutocastChange = () => {};   // avisa a combat.js para re-render del tab

let selectedSpellId = null;        // contorno blanco (selección activa)
let autocastSpellId = 'fire_strike'; // hechizo de autocast (se ve en Combate)
let autocastOn = false;            // toggle autocast (se controla en Combate)
let nextCastSpellId = null;        // encolado (pieza 3: cola real)

let injectedButtons = [];
let intervalHandle = null;
let menuEl = null;

// ============================================================
// API pública
// ============================================================
export function start(opts = {}) {
  if (started) stop();
  getMagicLevel    = opts.getMagicLevel    || (() => 1);
  getMana          = opts.getMana          || (() => ({ current: 0, max: 0 }));
  feedLog          = opts.feedLog          || (() => {});
  onAutocastChange = opts.onAutocastChange || (() => {});

  ensureCss();
  if (!injectSpells()) { started = false; return; }
  started = true;
  refreshVisuals();
  intervalHandle = setInterval(refreshVisuals, 500);

  if (typeof window !== 'undefined') {
    window.__spellbook = () => ({ selectedSpellId, autocastSpellId, autocastOn, nextCastSpellId, mana: getMana(), magicLevel: getMagicLevel() });
  }
}

export function stop() {
  if (intervalHandle) { clearInterval(intervalHandle); intervalHandle = null; }
  for (const b of injectedButtons) { try { b.remove(); } catch {} }
  injectedButtons = [];
  closeMenu();
  started = false;
}

// Lo que consume combat.js al atacar.
export function getSelectedSpellId() {
  return autocastOn ? autocastSpellId : null;
}
export function isAutocastOn() { return autocastOn; }
export function getAutocastSpellId() { return autocastSpellId; }
export function getNextCastSpellId() { return nextCastSpellId; }

// SVG + meta del hechizo de autocast (para que el tab de Combate lo dibuje).
export function getAutocastSpellMeta() {
  const m = spellMeta(autocastSpellId);
  if (!m) return null;
  return { ...m, svg: SVG[m.id] || '' };
}
export function getNextCastSpellMeta() {
  const m = nextCastSpellId ? spellMeta(nextCastSpellId) : null;
  return m ? { ...m, svg: SVG[m.id] || '' } : null;
}

// Toggle desde el tab de Combate.
export function toggleAutocast() { setAutocast(!autocastOn); }
export function setAutocast(on) {
  autocastOn = !!on;
  refreshVisuals();
  try { onAutocastChange(); } catch {}
}

// ============================================================
// Inyección
// ============================================================
function injectSpells() {
  const grid = document.getElementById('magicSpellGrid');
  if (!grid) {
    console.warn('[spellbook] #magicSpellGrid no existe — spellbook inerte');
    return false;
  }
  for (const sp of SPELLBOOK) {
    const btn = document.createElement('button');
    btn.className = 'magic-spell-cell spellbook-cell';
    btn.dataset.spellId = sp.id;
    btn.innerHTML =
      '<div class="spellbook-svg">' + (SVG[sp.id] || '') + '</div>' +
      '<div class="spellbook-meta">Niv ' + sp.level + ' · ' + sp.mana + '💧</div>';
    // Click izquierdo = seleccionar
    btn.addEventListener('click', (e) => { e.preventDefault(); onSelectSpell(sp.id); });
    // Click derecho (PC) = menú
    btn.addEventListener('contextmenu', (e) => { e.preventDefault(); openMenu(sp.id, e.clientX, e.clientY); });
    // Long press (móvil) = menú
    attachLongPress(btn, sp.id);
    grid.appendChild(btn);
    injectedButtons.push(btn);
  }
  return true;
}

function attachLongPress(btn, spellId) {
  let timer = null;
  let startXY = null;
  const LONG_MS = 450;
  const onDown = (e) => {
    const t = e.touches ? e.touches[0] : e;
    startXY = { x: t.clientX, y: t.clientY };
    timer = setTimeout(() => {
      timer = null;
      openMenu(spellId, startXY.x, startXY.y);
    }, LONG_MS);
  };
  const cancel = () => { if (timer) { clearTimeout(timer); timer = null; } };
  btn.addEventListener('touchstart', onDown, { passive: true });
  btn.addEventListener('touchend', cancel);
  btn.addEventListener('touchmove', cancel);
  btn.addEventListener('touchcancel', cancel);
}

function onSelectSpell(spellId) {
  const sp = spellMeta(spellId);
  if (!sp) return;
  if (getMagicLevel() < sp.level) {
    feedLog('warning', 'Necesitas nivel ' + sp.level + ' de Magia para ' + sp.name + '.');
    return;
  }
  // Seleccionar = contorno blanco + lo fija como autocast activo (práctico para
  // un juego con auto-ataque: atacar lo repite). El detalle Cast-una-vez vs
  // autocast se afina con la cola (pieza 3) desde el menú.
  selectedSpellId = spellId;
  autocastSpellId = spellId;
  autocastOn = true;
  refreshVisuals();
  try { onAutocastChange(); } catch {}
  feedLog('info', 'Hechizo seleccionado: ' + sp.name + '.');
}

// ============================================================
// Menú contextual (Cast / Autocast / Next cast)
// ============================================================
function openMenu(spellId, x, y) {
  closeMenu();
  const sp = spellMeta(spellId);
  if (!sp) return;
  const locked = getMagicLevel() < sp.level;
  menuEl = document.createElement('div');
  menuEl.className = 'spellbook-menu';
  menuEl.innerHTML =
    '<div class="spellbook-menu-title">' + sp.name + (locked ? ' (Niv ' + sp.level + ')' : '') + '</div>' +
    '<button data-act="cast">Cast</button>' +
    '<button data-act="autocast">Autocast</button>' +
    '<button data-act="nextcast">Next cast</button>';
  document.body.appendChild(menuEl);
  // posición (clamp a la pantalla)
  const r = menuEl.getBoundingClientRect();
  const px = Math.min(x, window.innerWidth - r.width - 8);
  const py = Math.min(y, window.innerHeight - r.height - 8);
  menuEl.style.left = Math.max(8, px) + 'px';
  menuEl.style.top  = Math.max(8, py) + 'px';

  menuEl.querySelectorAll('button').forEach(b => {
    b.addEventListener('click', (e) => {
      e.preventDefault();
      const act = b.dataset.act;
      if (locked) { feedLog('warning', 'Necesitas nivel ' + sp.level + ' de Magia.'); closeMenu(); return; }
      if (act === 'cast') {
        // Cast (una vez): por ahora = seleccionar + autocast on. La semántica
        // "una sola vez y para" llega con la cola (pieza 3).
        selectedSpellId = spellId; autocastSpellId = spellId; autocastOn = true;
        feedLog('info', 'Lanzar: ' + sp.name + '.');
      } else if (act === 'autocast') {
        selectedSpellId = spellId; autocastSpellId = spellId; autocastOn = true;
        feedLog('info', 'Autocast: ' + sp.name + '.');
      } else if (act === 'nextcast') {
        nextCastSpellId = spellId;
        feedLog('info', 'Next cast encolado: ' + sp.name + '.');
      }
      refreshVisuals();
      try { onAutocastChange(); } catch {}
      closeMenu();
    });
  });

  // cerrar al tocar afuera
  setTimeout(() => {
    document.addEventListener('click', closeMenuOnOutside, { once: true });
    document.addEventListener('touchstart', closeMenuOnOutside, { once: true });
  }, 0);
}
function closeMenuOnOutside(e) {
  if (menuEl && !menuEl.contains(e.target)) closeMenu();
}
function closeMenu() {
  if (menuEl) { try { menuEl.remove(); } catch {} menuEl = null; }
}

// ============================================================
// Visuals
// ============================================================
function refreshVisuals() {
  const lvl = getMagicLevel();
  for (const btn of injectedButtons) {
    const sp = spellMeta(btn.dataset.spellId);
    if (!sp) continue;
    const locked = lvl < sp.level;
    btn.classList.toggle('locked', locked);
    // contorno blanco = el hechizo seleccionado
    btn.classList.toggle('selected', sp.id === selectedSpellId);
    // marca tenue para el next cast encolado
    btn.classList.toggle('queued', sp.id === nextCastSpellId);
  }
  // HUD: maná actual debajo de la bota
  try {
    const mana = getMana();
    const hud = document.getElementById('hudManaValue');
    if (hud) hud.textContent = String(mana?.current ?? 0);
  } catch {}
}

// ============================================================
// CSS (sin tocar style.css)
// ============================================================
function ensureCss() {
  if (document.getElementById('spellbook-css')) return;
  const css = document.createElement('style');
  css.id = 'spellbook-css';
  css.textContent = [
    '.spellbook-cell{position:relative;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;padding:6px 4px;cursor:pointer;background:transparent;border:none;border-radius:8px}',
    '.spellbook-cell .spellbook-svg{width:30px;height:30px}',
    '.spellbook-cell .spellbook-svg svg{width:100%;height:100%;display:block}',
    '.spellbook-cell .spellbook-meta{font-size:10px;opacity:0.78}',
    /* contorno blanco estilo OSRS */
    '.spellbook-cell.selected{outline:2px solid #ffffff;box-shadow:0 0 0 1px #000,0 0 6px rgba(255,255,255,0.5) inset;background:rgba(255,255,255,0.08)}',
    '.spellbook-cell.queued{outline:1px dashed rgba(255,255,255,0.55)}',
    '.spellbook-cell.locked{opacity:0.4;filter:grayscale(0.7)}',
    /* menú contextual */
    '.spellbook-menu{position:fixed;z-index:9999;background:#1a1f2e;border:1px solid #3a4a6a;border-radius:8px;padding:4px;min-width:128px;box-shadow:0 6px 20px rgba(0,0,0,0.5)}',
    '.spellbook-menu-title{font-size:12px;font-weight:700;padding:4px 8px;opacity:0.85;border-bottom:1px solid #2a3550;margin-bottom:4px}',
    '.spellbook-menu button{display:block;width:100%;text-align:left;padding:8px 10px;background:transparent;border:none;color:#f0e6d2;font-size:13px;cursor:pointer;border-radius:6px}',
    '.spellbook-menu button:hover,.spellbook-menu button:active{background:#2d6cff}',
  ].join('\n');
  document.head.appendChild(css);
}
