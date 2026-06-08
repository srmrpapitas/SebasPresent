/**
 * SebasPresent — Spellbook (Sesión 41, Bloque 2 — mago, pieza 2B-1)
 *
 * Inyecta los hechizos de COMBATE en la grilla #magicSpellGrid (tab Magia del
 * sidebar), al lado del "Home" que pone home_teleport.js. Sigue el mismo patrón.
 *
 * PIEZA 1 (esta): selección por click izquierdo = hechizo "activo" (autocast).
 *   - Click en un hechizo → queda seleccionado (resaltado). Es el que se lanza
 *     al atacar (combat.js pide getSelectedSpellId() y lo manda como spell_id).
 *   - Toggle Autocast on/off: si está ON, atacar usa el hechizo seleccionado.
 *     Si está OFF, el staff pega melee (golpe con el palo, sin hechizo).
 *   - Barra de maná en el header del spellbook.
 *
 * PIEZAS FUTURAS (no acá): menú click-derecho (Select/Autocast/Next cast),
 * cast times por hechizo, curva de precisión, next-cast queue, proyectil+anim.
 *
 * Gating de UI: cada hechizo muestra su requisito de nivel de Magia y su costo
 * de maná. Si no llegás al nivel, el botón se ve deshabilitado (pero la
 * autoridad real la tiene el server, que rechaza con magic_level_too_low).
 *
 * El catálogo de hechizos refleja server/magic.js (mantener en sync). Si
 * divergen, el server manda (rechaza spell inválido / nivel insuficiente).
 */

// Espejo del SPELLS de server/magic.js (solo lo que la UI necesita mostrar).
const SPELLBOOK = [
  { id: 'fire_strike', name: 'Rayo de fuego', icon: '🔥', level: 1,  mana: 5,  color: '#ff6622' },
  { id: 'ice_spear',   name: 'Lanza de hielo', icon: '❄️', level: 20, mana: 9,  color: '#55bbff' },
  { id: 'thunderbolt', name: 'Rayo',          icon: '⚡', level: 40, mana: 14, color: '#ffe23a' },
  { id: 'entangle',    name: 'Enredar',       icon: '🌿', level: 35, mana: 12, color: '#44cc55' },
];

// ============================================================
// Estado del módulo
// ============================================================
let started = false;
let getMagicLevel = () => 1;     // nivel de Magia actual (para gating visual)
let getMana = () => ({ current: 0, max: 0 });  // maná actual (para la barra)
let feedLog = () => {};

let selectedSpellId = 'fire_strike';   // hechizo activo (default)
let autocastOn = false;                // si OFF → staff pega melee
let injectedButtons = [];              // refs a los botones inyectados
let manaBarEl = null, manaTextEl = null;
let intervalHandle = null;

// ============================================================
// API pública
// ============================================================
export function start(opts = {}) {
  if (started) stop();
  getMagicLevel = opts.getMagicLevel || (() => 1);
  getMana       = opts.getMana       || (() => ({ current: 0, max: 0 }));
  feedLog       = opts.feedLog       || (() => {});

  ensureCss();
  if (!injectSpells()) { started = false; return; }
  injectManaBar();
  started = true;
  refreshVisuals();
  intervalHandle = setInterval(refreshVisuals, 500);

  if (typeof window !== 'undefined') {
    window.__spellbook = () => ({ selectedSpellId, autocastOn, mana: getMana(), magicLevel: getMagicLevel() });
  }
}

export function stop() {
  if (intervalHandle) { clearInterval(intervalHandle); intervalHandle = null; }
  for (const b of injectedButtons) { try { b.remove(); } catch {} }
  injectedButtons = [];
  try { if (manaBarEl) manaBarEl.closest('.magic-mana-wrap')?.remove(); } catch {}
  manaBarEl = null; manaTextEl = null;
  started = false;
}

// Lo que consume combat.js: el hechizo a lanzar, o null si autocast OFF
// (entonces el staff pega melee y NO se manda spell_id).
export function getSelectedSpellId() {
  return autocastOn ? selectedSpellId : null;
}
export function isAutocastOn() { return autocastOn; }
export function getSelectedSpellMeta() {
  return SPELLBOOK.find(s => s.id === selectedSpellId) || null;
}
export function setAutocast(on) { autocastOn = !!on; refreshVisuals(); }

// ============================================================
// Inyección de UI
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
    btn.innerHTML = `
      <div class="magic-spell-icon" style="filter:drop-shadow(0 0 3px ${sp.color})">${sp.icon}</div>
      <div class="magic-spell-name">${sp.name}</div>
      <div class="spellbook-meta">Niv ${sp.level} · ${sp.mana}💧</div>
    `;
    btn.addEventListener('click', (e) => { e.preventDefault(); onSelectSpell(sp.id); });
    grid.appendChild(btn);
    injectedButtons.push(btn);
  }
  return true;
}

function injectManaBar() {
  const header = document.querySelector('.magic-header');
  if (!header) return;
  const wrap = document.createElement('div');
  wrap.className = 'magic-mana-wrap';
  wrap.innerHTML = `
    <div class="magic-mana-bar"><div class="magic-mana-fill"></div></div>
    <div class="magic-mana-text">0 / 0</div>
    <button class="magic-autocast-toggle" data-on="false">Autocast: OFF</button>
  `;
  header.appendChild(wrap);
  manaBarEl  = wrap.querySelector('.magic-mana-fill');
  manaTextEl = wrap.querySelector('.magic-mana-text');
  const toggle = wrap.querySelector('.magic-autocast-toggle');
  toggle.addEventListener('click', (e) => {
    e.preventDefault();
    autocastOn = !autocastOn;
    refreshVisuals();
  });
}

function onSelectSpell(spellId) {
  const sp = SPELLBOOK.find(s => s.id === spellId);
  if (!sp) return;
  const lvl = getMagicLevel();
  if (lvl < sp.level) {
    feedLog('warning', `Necesitas nivel ${sp.level} de Magia para ${sp.name}.`);
    return;
  }
  selectedSpellId = spellId;
  // seleccionar un hechizo enciende autocast (querés lanzarlo)
  autocastOn = true;
  refreshVisuals();
  feedLog('info', `Hechizo seleccionado: ${sp.name}.`);
}

// ============================================================
// Visuals
// ============================================================
function refreshVisuals() {
  const lvl = getMagicLevel();
  for (const btn of injectedButtons) {
    const sp = SPELLBOOK.find(s => s.id === btn.dataset.spellId);
    if (!sp) continue;
    const locked = lvl < sp.level;
    btn.classList.toggle('locked', locked);
    btn.classList.toggle('selected', autocastOn && sp.id === selectedSpellId);
  }
  // barra de maná
  const mana = getMana();
  if (manaBarEl && mana && mana.max > 0) {
    const pct = Math.max(0, Math.min(100, (mana.current / mana.max) * 100));
    manaBarEl.style.width = `${pct}%`;
    if (manaTextEl) manaTextEl.textContent = `${mana.current} / ${mana.max}`;
  } else if (manaTextEl) {
    manaTextEl.textContent = `${mana?.current ?? 0} / ${mana?.max ?? 0}`;
    if (manaBarEl) manaBarEl.style.width = mana?.max ? `${(mana.current / mana.max) * 100}%` : '0%';
  }
  const toggle = document.querySelector('.magic-autocast-toggle');
  if (toggle) {
    toggle.textContent = `Autocast: ${autocastOn ? 'ON' : 'OFF'}`;
    toggle.dataset.on = autocastOn ? 'true' : 'false';
  }
}

// ============================================================
// CSS (inyectado una vez). Sin tocar style.css (regla del proyecto).
// ============================================================
function ensureCss() {
  if (document.getElementById('spellbook-css')) return;
  const css = document.createElement('style');
  css.id = 'spellbook-css';
  css.textContent = [
    '.spellbook-cell{position:relative;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;padding:6px 4px;cursor:pointer}',
    '.spellbook-cell .spellbook-meta{font-size:10px;opacity:0.75}',
    '.spellbook-cell.selected{outline:2px solid #ffcc44;border-radius:8px;background:rgba(255,204,68,0.12)}',
    '.spellbook-cell.locked{opacity:0.4;filter:grayscale(0.7)}',
    '.magic-mana-wrap{display:flex;flex-direction:column;gap:4px;margin-top:6px;width:100%}',
    '.magic-mana-bar{height:10px;border-radius:5px;background:#10131c;border:1px solid #2a3550;overflow:hidden}',
    '.magic-mana-fill{height:100%;width:0;background:linear-gradient(90deg,#2d6cff,#5aa8ff);transition:width 0.25s}',
    '.magic-mana-text{font-size:11px;opacity:0.8;text-align:center}',
    '.magic-autocast-toggle{padding:6px;border:none;border-radius:8px;background:#3a2f1c;color:#f0e6d2;font-size:13px;cursor:pointer}',
    '.magic-autocast-toggle[data-on="true"]{background:#2d6cff;color:#fff}',
  ].join('\n');
  document.head.appendChild(css);
}
