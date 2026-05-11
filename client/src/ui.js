/**
 * SebasPresent — UI module
 *
 * Centralizes DOM access. Other modules call into here instead of querying
 * the DOM directly, so if the markup changes there's exactly one place to fix.
 */

// ---------- Element lookups (cached on load) ----------

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

  welcomeScreen:  $('welcomeScreen'),
  welcomeUsername: $('welcomeUsername'),
  welcomeJoined:  $('welcomeJoined'),
  logoutBtn:      $('logoutBtn'),

  loadingOverlay: $('loadingOverlay'),
};

export { els };

// ---------- Screen management ----------

const SCREENS = ['splash', 'loginScreen', 'registerScreen', 'welcomeScreen'];

export function showScreen(name) {
  for (const s of SCREENS) {
    const el = els[s];
    if (!el) continue;
    if (s === name) el.classList.remove('hidden');
    else el.classList.add('hidden');
  }
  // Clear error fields when changing screens
  if (els.loginError) els.loginError.textContent = '';
  if (els.registerError) els.registerError.textContent = '';
}

// ---------- Loading overlay ----------

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

// ---------- Error display ----------

export function showError(target, message) {
  const el = target === 'login' ? els.loginError : els.registerError;
  if (!el) return;
  el.textContent = message;
  // Force a quick re-trigger so animation could re-play if we add one later.
  el.style.animation = 'none';
  // eslint-disable-next-line no-unused-expressions
  el.offsetHeight;
  el.style.animation = '';
}

// ---------- Date formatting ----------

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
  // Browsers block autoplay until user gesture. This is called from a click
  // handler so it should succeed; catch failures silently anyway.
  audio.play().catch(() => {
    // User can manually trigger via a future settings toggle.
  });
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
