/**
 * SebasPresent — Dev overlay (Sesión 31, FASE 2)
 *
 * Sistema de overlay persistente que vive arriba de TODO el juego. Está
 * siempre montado, no rompe si el juego aún no arrancó, y nunca depende
 * de world.js para funcionar (lee de los hooks globales ya existentes:
 * window.character, window.equipment, window.__snapshotDebug, etc).
 *
 * ──────────────────────────────────────────────────────────────────────────
 * UX:
 *   - Badge fijo arriba-izquierda con el build number + FPS + dot de estado.
 *   - Tap en el badge → toggle del panel.
 *   - Panel auto-refresca cada 500ms.
 *   - Panel tiene botones de acción rápida.
 *
 * El badge sirve doble propósito:
 *   1. Siempre se ve qué build está corriendo (resuelve "asumí cache nueva").
 *   2. Es el botón para abrir el panel (no requiere combo de tecla mobile).
 *
 * ──────────────────────────────────────────────────────────────────────────
 * Regla del proyecto: NO backticks anidados dentro de strings CSS.
 * Solución: usamos arrays de declaraciones + join, y setAttribute('style', ...)
 * en lugar de cssText con template literals.
 */

import { BUILD } from '../build.js';
import { getRecentErrors, getErrorCount } from './error_capture.js';
import { runHealthCheck } from './health_check.js';

const BADGE_ID = 'sebasDevBadge';
const PANEL_ID = 'sebasDevPanel';

// ============================================================
// Estado del módulo
// ============================================================

let badgeEl = null;
let panelEl = null;
let refreshTimer = null;

// FPS measurement — independiente del game loop. Vive en su propio rAF.
let fpsFrames = 0;
let fpsLastSec = performance.now();
let fpsValue = 0;
let fpsRunning = false;

// ============================================================
// Helpers de styling (sin backticks en CSS, según regla del proyecto)
// ============================================================

/**
 * Aplica un objeto {prop: value} como inline styles. Más limpio que cssText
 * cuando son muchas propiedades, y evita los backticks que dan problemas.
 */
function applyStyles(el, styles) {
  for (const k in styles) {
    el.style.setProperty(k, styles[k]);
  }
}

// Paleta del overlay — tono "dev panel" oscuro con acento dorado del OSRS HUD.
const COLOR = {
  bg:      'rgba(15, 10, 5, 0.92)',
  border:  '#c8a043',
  text:    '#f0e0b0',
  accent:  '#e8c560',
  okGreen: '#7fc24a',
  warnY:   '#e8c560',
  errRed:  '#e85a4a',
  muted:   '#a08868',
};

// ============================================================
// FPS loop
// ============================================================

function fpsTick() {
  if (!fpsRunning) return;
  fpsFrames++;
  const now = performance.now();
  if (now - fpsLastSec >= 1000) {
    fpsValue = fpsFrames;
    fpsFrames = 0;
    fpsLastSec = now;
  }
  requestAnimationFrame(fpsTick);
}

function startFpsLoop() {
  if (fpsRunning) return;
  fpsRunning = true;
  fpsLastSec = performance.now();
  fpsFrames = 0;
  requestAnimationFrame(fpsTick);
}

// ============================================================
// Badge — siempre visible
// ============================================================

function createBadge() {
  if (document.getElementById(BADGE_ID)) return document.getElementById(BADGE_ID);

  const el = document.createElement('div');
  el.id = BADGE_ID;
  applyStyles(el, {
    'position':       'fixed',
    'top':            'calc(env(safe-area-inset-top, 0px) + 4px)',
    'left':           'calc(env(safe-area-inset-left, 0px) + 4px)',
    'z-index':        '99999',
    'background':     COLOR.bg,
    'border':         '1px solid ' + COLOR.border,
    'border-radius':  '3px',
    'padding':        '3px 6px',
    'font-family':    'monospace',
    'font-size':      '10px',
    'color':          COLOR.text,
    'cursor':         'pointer',
    'user-select':    'none',
    '-webkit-user-select': 'none',
    '-webkit-tap-highlight-color': 'transparent',
    'pointer-events': 'auto',
    'line-height':    '1.2',
    'box-shadow':     '0 1px 3px rgba(0,0,0,0.5)',
    'display':        'flex',
    'align-items':    'center',
    'gap':            '4px',
  });

  // Dot de estado: verde ok / amarillo warn / rojo fail. Default gris.
  const dot = document.createElement('span');
  dot.className = 'dot';
  applyStyles(dot, {
    'display':       'inline-block',
    'width':         '6px',
    'height':        '6px',
    'border-radius': '50%',
    'background':    COLOR.muted,
  });
  el.appendChild(dot);

  const text = document.createElement('span');
  text.className = 'txt';
  text.textContent = 'b' + BUILD + ' · -- fps';
  el.appendChild(text);

  el.addEventListener('click', togglePanel);
  document.body.appendChild(el);
  return el;
}

function updateBadge() {
  if (!badgeEl) return;
  const txt = badgeEl.querySelector('.txt');
  const dot = badgeEl.querySelector('.dot');
  if (txt) {
    const errs = getErrorCount();
    let line = 'b' + BUILD + ' · ' + fpsValue + 'fps';
    if (errs > 0) line += ' · ' + errs + '❗';
    txt.textContent = line;
  }
  if (dot) {
    const errs = getErrorCount();
    const ch = window.character;
    let color = COLOR.okGreen;
    if (errs > 0) color = COLOR.errRed;
    else if (!ch || !ch.loaded) color = COLOR.muted;
    dot.style.setProperty('background', color);
  }
}

// ============================================================
// Panel — toggleable, auto-refresh cada 500ms
// ============================================================

function createPanel() {
  if (document.getElementById(PANEL_ID)) return document.getElementById(PANEL_ID);

  const el = document.createElement('div');
  el.id = PANEL_ID;
  applyStyles(el, {
    'position':       'fixed',
    'top':            'calc(env(safe-area-inset-top, 0px) + 30px)',
    'left':           'calc(env(safe-area-inset-left, 0px) + 4px)',
    'right':          'calc(env(safe-area-inset-right, 0px) + 4px)',
    'max-height':     '70vh',
    'overflow-y':     'auto',
    'z-index':        '99998',
    'background':     COLOR.bg,
    'border':         '1px solid ' + COLOR.border,
    'border-radius':  '5px',
    'padding':        '8px 10px',
    'font-family':    'monospace',
    'font-size':      '11px',
    'color':          COLOR.text,
    'box-shadow':     '0 4px 14px rgba(0,0,0,0.7)',
    'backdrop-filter': 'blur(2px)',
    '-webkit-backdrop-filter': 'blur(2px)',
    'display':        'none',
    'line-height':    '1.4',
  });

  el.innerHTML = '<div class="hdr"></div>' +
                 '<div class="body"></div>' +
                 '<div class="btns"></div>' +
                 '<div class="errs"></div>';

  // Header
  const hdr = el.querySelector('.hdr');
  applyStyles(hdr, {
    'font-weight':   'bold',
    'color':         COLOR.accent,
    'margin-bottom': '6px',
    'display':       'flex',
    'justify-content': 'space-between',
    'align-items':   'center',
  });
  hdr.innerHTML = '<span>🛠 Dev Overlay · b' + BUILD + '</span>' +
                  '<button class="close" style="background:transparent;border:1px solid ' +
                  COLOR.border + ';color:' + COLOR.text +
                  ';padding:1px 8px;cursor:pointer;border-radius:3px;font-size:11px">×</button>';
  hdr.querySelector('.close').addEventListener('click', hidePanel);

  // Body — se rellena en update()
  const body = el.querySelector('.body');

  // Botones
  const btns = el.querySelector('.btns');
  applyStyles(btns, {
    'display':         'flex',
    'flex-wrap':       'wrap',
    'gap':             '4px',
    'margin-top':      '8px',
    'padding-top':     '8px',
    'border-top':      '1px solid ' + COLOR.border,
  });

  function btn(label, onClick) {
    const b = document.createElement('button');
    b.textContent = label;
    applyStyles(b, {
      'background':     'transparent',
      'border':         '1px solid ' + COLOR.border,
      'color':          COLOR.text,
      'padding':        '4px 8px',
      'cursor':         'pointer',
      'border-radius':  '3px',
      'font-size':      '10px',
      'font-family':    'monospace',
      'flex':           '1 1 auto',
      'min-width':      '70px',
    });
    b.addEventListener('click', onClick);
    btns.appendChild(b);
    return b;
  }

  btn('Health',          () => runHealthCheck());
  btn('Char dump',       () => window.__diag?.dumpCharacterState());
  btn('Equip dump',      () => window.__diag?.printEquipment());
  btn('Bones',           () => window.__diag?.printBones());
  btn('Snapshot',        () => window.__diag?.printSnapshot());
  btn('Weapon panel',    () => window.__weaponDebug?.());
  btn('Clear cache',     clearCacheAndReload);
  btn('Reload',          () => window.location.reload());

  // Errors area
  const errs = el.querySelector('.errs');
  applyStyles(errs, {
    'margin-top':   '8px',
    'padding-top':  '8px',
    'border-top':   '1px solid ' + COLOR.border,
    'font-size':    '10px',
    'color':        COLOR.muted,
  });

  document.body.appendChild(el);
  return el;
}

function isPanelVisible() {
  return panelEl && panelEl.style.display !== 'none';
}

function togglePanel() {
  if (isPanelVisible()) hidePanel();
  else showPanel();
}

function showPanel() {
  if (!panelEl) panelEl = createPanel();
  panelEl.style.setProperty('display', 'block');
  updatePanel();    // primer render inmediato
}

function hidePanel() {
  if (panelEl) panelEl.style.setProperty('display', 'none');
}

// ============================================================
// Update — corre cada 500ms (solo cuando el panel está visible)
// ============================================================

function lineRow(label, value, valueColor) {
  // Devuelve HTML para una fila key: value. No usamos backticks aquí
  // por consistencia con la regla del proyecto.
  return '<div style="display:flex;justify-content:space-between;gap:8px">' +
         '<span style="color:' + COLOR.muted + '">' + label + '</span>' +
         '<span style="color:' + (valueColor || COLOR.text) +
         ';text-align:right;font-variant-numeric:tabular-nums">' + value + '</span>' +
         '</div>';
}

function sectionTitle(label) {
  return '<div style="color:' + COLOR.accent +
         ';font-size:9px;letter-spacing:0.5px;margin:6px 0 2px;opacity:0.9">─ ' +
         label.toUpperCase() + '</div>';
}

function fmtPos(p) {
  if (!p) return '—';
  return p.x.toFixed(1) + ' / ' + p.y.toFixed(1) + ' / ' + p.z.toFixed(1);
}

function updatePanel() {
  if (!panelEl || !isPanelVisible()) return;

  const body = panelEl.querySelector('.body');
  const errsEl = panelEl.querySelector('.errs');

  const ch = window.character;
  const eq = window.equipment;
  const snapDbg = window.__snapshotDebug;
  const snap = snapDbg ? snapDbg() : null;

  // ---- Character / player block ----
  const lines = [];
  lines.push(sectionTitle('runtime'));
  lines.push(lineRow('fps', fpsValue, fpsValue >= 30 ? COLOR.okGreen :
                                       fpsValue >= 15 ? COLOR.warnY : COLOR.errRed));
  lines.push(lineRow('chars total', document.querySelectorAll('canvas').length + ' canvas'));

  // Char
  lines.push(sectionTitle('character'));
  if (!ch) {
    lines.push(lineRow('state', 'no en mundo', COLOR.muted));
  } else if (!ch.loaded) {
    lines.push(lineRow('state', 'cargando…', COLOR.warnY));
  } else {
    const pos = ch.group?.position;
    const clip = ch.current?.getClip?.();
    lines.push(lineRow('pos', fmtPos(pos)));
    lines.push(lineRow('anim', clip?.name || 'idle', clip ? COLOR.text : COLOR.muted));
    lines.push(lineRow('gather', ch._gatheringActive ? 'yes (' + (ch._gatherAnimName || '?') + ')' : 'no',
      ch._gatheringActive ? COLOR.accent : COLOR.muted));
    lines.push(lineRow('combat', ch.combatStance ? 'stance ON' : 'off',
      ch.combatStance ? COLOR.warnY : COLOR.muted));
    lines.push(lineRow('dead', ch.isDead ? 'YES' : 'no',
      ch.isDead ? COLOR.errRed : COLOR.muted));
    lines.push(lineRow('weapon',
      (ch._equippedWeaponId || '—') + (ch._equippedWeaponHand ? ' (' + ch._equippedWeaponHand + ')' : ''),
      ch._equippedWeaponId ? COLOR.text : COLOR.muted));
  }

  // Snapshot / network
  lines.push(sectionTitle('network'));
  if (!snap) {
    lines.push(lineRow('snapshot', 'no recibido', COLOR.muted));
  } else {
    const ageMs = Date.now() - (snap._receivedAt || 0);
    const lag = snap._serverLagMs ?? 0;
    lines.push(lineRow('snapshot age', ageMs + 'ms',
      ageMs < 1000 ? COLOR.okGreen : ageMs < 3000 ? COLOR.warnY : COLOR.errRed));
    lines.push(lineRow('server lag', lag + 'ms',
      lag < 500 ? COLOR.okGreen : lag < 1500 ? COLOR.warnY : COLOR.errRed));
    lines.push(lineRow('players', String(snap.players?.length ?? 0)));
    lines.push(lineRow('npcs', String(snap.npcs?.length ?? 0)));
    if (snap.fires !== undefined) lines.push(lineRow('fires', String(snap.fires?.length ?? 0)));
    if (snap.depleted_trees !== undefined) lines.push(lineRow('depleted trees', String(snap.depleted_trees?.length ?? 0)));
  }

  // Equipment
  lines.push(sectionTitle('equipment'));
  if (!eq) {
    lines.push(lineRow('module', 'no expuesto', COLOR.muted));
  } else {
    const slots = (typeof eq.getSlots === 'function') ? eq.getSlots() :
                  (typeof eq.getEquipped === 'function') ? eq.getEquipped() : null;
    if (!slots) {
      lines.push(lineRow('slots', 'sin getSlots/getEquipped', COLOR.warnY));
    } else {
      let any = false;
      for (const slot of ['weapon', 'shield', 'helm', 'body', 'legs', 'feet', 'cape', 'ring', 'amulet']) {
        const item = slots[slot];
        if (item && (item.item_id || item.name)) {
          any = true;
          lines.push(lineRow(slot, item.item_id || item.name));
        }
      }
      if (!any) lines.push(lineRow('—', 'todo vacío', COLOR.muted));
    }
  }

  // Active skill (woodcutting / firemaking)
  lines.push(sectionTitle('skills active'));
  const wc = window.__wcDebug ? window.__wcDebug() : null;
  if (wc?.activeChop) {
    lines.push(lineRow('woodcut',
      wc.activeChop.tree_type + ' @ ' + wc.activeChop.tx?.toFixed(1) + ',' + wc.activeChop.tz?.toFixed(1),
      COLOR.accent));
  } else {
    lines.push(lineRow('woodcut', 'idle', COLOR.muted));
  }
  const fm = window.__fmDebug ? (typeof window.__fmDebug === 'function' ? window.__fmDebug() : window.__fmDebug) : null;
  if (fm && (fm.activeLight || fm.active)) {
    lines.push(lineRow('firemaking', 'lighting', COLOR.accent));
  } else {
    lines.push(lineRow('firemaking', 'idle', COLOR.muted));
  }

  body.innerHTML = lines.join('');

  // ---- Errors block ----
  const recent = getRecentErrors(5);
  if (recent.length === 0) {
    errsEl.innerHTML = sectionTitle('errors') +
      '<div style="color:' + COLOR.okGreen + '">✓ sin errores</div>';
  } else {
    const errLines = recent.map(e => {
      const ago = Math.round((Date.now() - e.ts) / 1000);
      return '<div style="color:' + COLOR.errRed + ';padding:2px 0;border-bottom:1px solid ' +
             COLOR.border + ';opacity:0.85">' +
             '<span style="color:' + COLOR.muted + '">[' + ago + 's ago] </span>' +
             '<span>' + escapeHtml(e.message.slice(0, 120)) + '</span>' +
             (e.source ? '<div style="color:' + COLOR.muted + ';font-size:9px">' +
               escapeHtml(e.source) + '</div>' : '') +
             '</div>';
    }).join('');
    errsEl.innerHTML = sectionTitle('errors (' + getErrorCount() + ' total)') + errLines;
  }
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// ============================================================
// Acciones de botones
// ============================================================

async function clearCacheAndReload() {
  console.log('[debug/overlay] clearing caches…');
  try {
    if ('caches' in window) {
      const names = await caches.keys();
      await Promise.all(names.map(n => caches.delete(n)));
      console.log('[debug/overlay] cleared', names.length, 'caches');
    }
  } catch (err) {
    console.warn('[debug/overlay] caches.clear failed:', err);
  }
  // Cache-bust reload: añade timestamp al URL.
  const url = new URL(window.location.href);
  url.searchParams.set('_cb', String(Date.now()));
  window.location.href = url.toString();
}

// ============================================================
// API pública (llamada desde debug/index.js)
// ============================================================

let installed = false;

export function installOverlay() {
  if (installed) return;
  installed = true;

  // Si el DOM aún no está listo, esperar.
  const start = () => {
    badgeEl = createBadge();
    startFpsLoop();
    // Auto-refresh del panel cuando esté visible. Lo dejamos corriendo
    // siempre para no perder updates si abren/cierran rápido.
    refreshTimer = setInterval(() => {
      updateBadge();
      if (isPanelVisible()) updatePanel();
    }, 500);
    console.log('[debug/overlay] installed — tap el badge de arriba a la izquierda');
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
}

/** Para tests / cleanup. No usado en runtime normal. */
export function uninstallOverlay() {
  if (refreshTimer) { clearInterval(refreshTimer); refreshTimer = null; }
  fpsRunning = false;
  if (badgeEl) { badgeEl.remove(); badgeEl = null; }
  if (panelEl) { panelEl.remove(); panelEl = null; }
  installed = false;
}
