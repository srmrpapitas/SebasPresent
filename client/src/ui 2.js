/**
 * SebasPresent — UI module (Slice 4a)
 *
 * Centralized DOM access + screen management.
 */
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
  // World screen (Slice 2)
  worldScreen:    $('worldScreen'),
  worldCanvas:    $('worldCanvas'),
  worldLogoutBtn: $('worldLogoutBtn'),
  playerNameTag:  $('playerNameTag'),
  loadingOverlay: $('loadingOverlay'),
  // OSRS sidebar (Slice 4a — chrome only)
  osrsSidebar:        $('osrsSidebar'),
  osrsSidebarPanel:   $('osrsSidebarPanel'),
  sidebarToggleBtn:   $('sidebarToggleBtn'),
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
  el.offsetHeight; // force reflow
  el.style.animation = '';
}
export function formatDate(unixMs) {
  if (!unixMs) return '—';
  try {
    const d = new Date(unixMs);
    return d.toLocaleDateString('es-ES', {
      year: 'numeric', month: 'long', day: 'numeric',
    });
  } catch {
    return '—';
  }
}
// ---------- Login music control ----------
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
// OSRS Sidebar (Slice 4a — chrome only, no inventory logic yet)
// ============================================================

/**
 * Wire up sidebar tab switching and mobile toggle.
 * Call once after DOM is ready (from main.js).
 *
 * Tab buttons query the live DOM (not cached in `els`) because they're
 * a NodeList that depends on what's in index.html at boot time.
 */
export function initSidebar({ onLogout } = {}) {
  const sidebar = els.osrsSidebar;
  const toggleBtn = els.sidebarToggleBtn;
  if (!sidebar) return;

  // Tab switching
  const tabBtns = sidebar.querySelectorAll('[data-tab-btn]');
  const panes   = sidebar.querySelectorAll('[data-tab]');
  tabBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      const target = btn.getAttribute('data-tab-btn');
      tabBtns.forEach(b => b.classList.toggle('active', b === btn));
      panes.forEach(p => p.classList.toggle('active', p.getAttribute('data-tab') === target));
    });
  });

  // Mobile toggle
  if (toggleBtn) {
    toggleBtn.addEventListener('click', () => {
      sidebar.classList.toggle('open');
      document.body.classList.toggle('sidebar-open', sidebar.classList.contains('open'));
    });
  }

  // Logout from inside the sidebar's logout tab
  if (els.sidebarLogoutBtn && typeof onLogout === 'function') {
    els.sidebarLogoutBtn.addEventListener('click', onLogout);
  }
}

/** Open the sidebar drawer (mobile). No-op on PC where it's always visible. */
export function openSidebar() {
  if (els.osrsSidebar) {
    els.osrsSidebar.classList.add('open');
    document.body.classList.add('sidebar-open');
  }
}

/** Close the sidebar drawer (mobile). No-op on PC. */
export function closeSidebar() {
  if (els.osrsSidebar) {
    els.osrsSidebar.classList.remove('open');
    document.body.classList.remove('sidebar-open');
  }
}
