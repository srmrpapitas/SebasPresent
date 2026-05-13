/**
 * SebasPresent — UI module (Slice 4c)
 *
 * Centralized DOM access + screen management + OSRS sidebar.
 *
 * Slice 4c: el boton del sidebar "ge" (🏛️) NO cambia de tab.
 * En su lugar abre el overlay fullscreen del Grand Exchange.
 * En slice 6, este trigger temporal se reemplazara por la
 * interaccion con el NPC del edificio fisico del GE.
 */
import * as bank from './bank.js';
import * as ge from './ge.js';

const $ = (id) => {
  const el = document.getElementById(id);
  if (!el) console.warn(`[ui] Element not found: #${id}`);
  return el;
};
const els = {
  splash:        $('splash'),
  enterBtn:      $('enterBtn'),
  loginMusic:    $('loginMusic'),
  loginScreen:   $('loginScreen'),
  loginForm:     $('loginForm'),
  loginUsername: $('loginUsername'),
  loginPassword: $('loginPassword'),
  loginError:    $('loginError'),
  showRegisterBtn: $('showRegisterBtn'),
  registerScreen: $('registerScreen'),
  registerForm:   $('registerForm'),
  regUsername:    $('regUsername'),
  regPassword:    $('regPassword'),
  regPasswordConfirm: $('regPasswordConfirm'),
  registerError:  $('registerError'),
  showLoginBtn:   $('showLoginBtn'),
  worldScreen:    $('worldScreen'),
  worldCanvas:    $('worldCanvas'),
  worldLogoutBtn: $('worldLogoutBtn'),
  playerNameTag:  $('playerNameTag'),
  loadingOverlay: $('loadingOverlay'),
  // OSRS sidebar (Slice 4a — always visible)
  osrsSidebar:        $('osrsSidebar'),
  osrsSidebarPanel:   $('osrsSidebarPanel'),
  sidebarMinBtn:      $('sidebarMinBtn'),
  sidebarLogoutBtn:   $('sidebarLogoutBtn'),
};
export { els };
const SCREENS = ['splash', 'loginScreen', 'registerScreen', 'worldScreen'];
export function showScreen(name) {
  for (const s of SCREENS) {
    const el = els[s];
    if (!el) continue;
    if (s === name) el.classList.remove('hidden');
    else el.classList.add('hidden');
  }
  if (els.loginError) els.loginError.textContent = '';
  if (els.registerError) els.registerError.textContent = '';
}
let loadingDepth = 0;
export function setLoading(on, text = 'Conectando…') {
  loadingDepth = Math.max(0, loadingDepth + (on ? 1 : -1));
  if (!els.loadingOverlay) return;
  const visible = loadingDepth > 0;
  if (visible) {
    const textEl = els.loadingOverlay.querySelector('.loading-text');
    if (textEl) textEl.textContent = text;
    els.loadingOverlay.classList.remove('hidden');
  } else {
    els.loadingOverlay.classList.add('hidden');
  }
}
export function showError(target, message) {
  const el = target === 'login' ? els.loginError : els.registerError;
  if (!el) return;
  el.textContent = message;
  el.style.animation = 'none';
  el.offsetHeight;
  el.style.animation = '';
}
export function formatDate(unixMs) {
  if (!unixMs) return '—';
  try {
    const d = new Date(unixMs);
    return d.toLocaleDateString('es-ES', {
      year: 'numeric', month: 'long', day: 'numeric',
    });
  } catch { return '—'; }
}
export function tryPlayLoginMusic() {
  const audio = els.loginMusic;
  if (!audio) return;
  audio.volume = 0.35;
  audio.play().catch(() => {});
}
export function fadeOutLoginMusic(durationMs = 800) {
  const audio = els.loginMusic;
  if (!audio || audio.paused) return;
  const startVol = audio.volume;
  const startTime = performance.now();
  function step(now) {
    const t = Math.min(1, (now - startTime) / durationMs);
    audio.volume = startVol * (1 - t);
    if (t < 1) {
      requestAnimationFrame(step);
    } else {
      audio.pause();
      audio.currentTime = 0;
      audio.volume = startVol;
    }
  }
  requestAnimationFrame(step);
}

// ============================================================
// OSRS Sidebar (Slice 4a — always visible, OSRS-style)
// pointerup instead of click → works on iOS multi-touch with joystick
// Slice 4b: notifica al banco cuando se abre/cierra su tab.
// Slice 4c: el boton "ge" abre un overlay fullscreen en vez de
//           cambiar de tab. Cuando llegue slice 6 (NPCs en edificios
//           del hub), se quita el boton del sidebar y el handler
//           del NPC llama directamente a ge.openOverlay().
// ============================================================

let currentTab = 'inventory'; // tab activo al arrancar (data-tab-pane "active")

export function initSidebar({ onLogout } = {}) {
  const sidebar = els.osrsSidebar;
  if (!sidebar) return;

  // Inicializar el modulo del GE (crea el overlay si no existe)
  try { ge.init(); } catch (e) { console.warn('[ui] ge.init error:', e); }

  const tabBtns = sidebar.querySelectorAll('[data-tab-btn]');
  const panes   = sidebar.querySelectorAll('[data-tab]');

  const handleTabActivate = (btn) => {
    const target = btn.getAttribute('data-tab-btn');
    if (sidebar.classList.contains('minimized')) {
      sidebar.classList.remove('minimized');
    }

    // GE: caso especial — no es tab, dispara overlay y no cambia nada.
    if (target === 'ge') {
      try { ge.openOverlay().catch(e => console.warn('[ui] ge.openOverlay error:', e)); }
      catch (e) { console.warn('[ui] ge.openOverlay error:', e); }
      return;
    }

    // Notificar al modulo del tab que se cierra
    if (currentTab === 'bank' && target !== 'bank') {
      try { bank.onClose(); } catch (e) { console.warn('[ui] bank.onClose error:', e); }
    }

    tabBtns.forEach(b => b.classList.toggle('active', b === btn));
    panes.forEach(p => p.classList.toggle('active', p.getAttribute('data-tab') === target));

    // Notificar al modulo del tab que se abre
    if (target === 'bank' && currentTab !== 'bank') {
      try { bank.onOpen().catch(e => console.warn('[ui] bank.onOpen error:', e)); }
      catch (e) { console.warn('[ui] bank.onOpen error:', e); }
    }

    currentTab = target;
  };

  tabBtns.forEach((btn) => {
    btn.addEventListener('pointerup', (ev) => {
      if (ev.button !== undefined && ev.button !== 0) return;
      ev.preventDefault();
      handleTabActivate(btn);
    });
  });

  if (els.sidebarMinBtn) {
    els.sidebarMinBtn.addEventListener('pointerup', (ev) => {
      if (ev.button !== undefined && ev.button !== 0) return;
      ev.preventDefault();
      sidebar.classList.toggle('minimized');
    });
  }

  if (els.sidebarLogoutBtn && typeof onLogout === 'function') {
    els.sidebarLogoutBtn.addEventListener('pointerup', (ev) => {
      if (ev.button !== undefined && ev.button !== 0) return;
      ev.preventDefault();
      onLogout();
    });
  }
}

export function setSidebarTab(name) {
  const sidebar = els.osrsSidebar;
  if (!sidebar) return;
  const btn = sidebar.querySelector(`[data-tab-btn="${name}"]`);
  if (!btn) return;
  const ev = new PointerEvent('pointerup', { button: 0, bubbles: true });
  btn.dispatchEvent(ev);
}

export function expandSidebar() {
  if (els.osrsSidebar) els.osrsSidebar.classList.remove('minimized');
}

export function minimizeSidebar() {
  if (els.osrsSidebar) els.osrsSidebar.classList.add('minimized');
}
