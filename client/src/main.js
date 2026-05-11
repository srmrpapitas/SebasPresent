/**
 * SebasPresent — Entry point
 *
 * Wires UI events to auth handlers and decides the initial screen
 * based on whether the user has a stored session token.
 */

import * as ui from './ui.js';
import * as auth from './auth.js';

// ---------- Boot ----------

async function boot() {
  wireEvents();

  // If we have a token, try to resume the session silently first.
  // If it works → welcome screen. If not → splash.
  const resumed = await auth.tryResumeSession();
  if (!resumed) {
    ui.showScreen('splash');
  }
}

// ---------- Event wiring ----------

function wireEvents() {
  // Splash → login (also unlocks audio)
  if (ui.els.enterBtn) {
    ui.els.enterBtn.addEventListener('click', () => {
      ui.tryPlayLoginMusic();
      ui.showScreen('loginScreen');
    });
  }

  // Login form
  if (ui.els.loginForm) {
    ui.els.loginForm.addEventListener('submit', auth.handleLogin);
  }

  // Register form
  if (ui.els.registerForm) {
    ui.els.registerForm.addEventListener('submit', auth.handleRegister);
  }

  // Screen switchers
  if (ui.els.showRegisterBtn) {
    ui.els.showRegisterBtn.addEventListener('click', () => {
      ui.showScreen('registerScreen');
    });
  }
  if (ui.els.showLoginBtn) {
    ui.els.showLoginBtn.addEventListener('click', () => {
      ui.showScreen('loginScreen');
    });
  }

  // Logout
  if (ui.els.logoutBtn) {
    ui.els.logoutBtn.addEventListener('click', auth.handleLogout);
  }
}

// ---------- Go ----------

boot().catch(err => {
  console.error('Boot failure:', err);
  ui.showScreen('splash');
});
