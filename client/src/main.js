/**
 * SebasPresent — Entry point (Slice 2)
 */

import * as ui from './ui.js';
import * as auth from './auth.js';

async function boot() {
  wireEvents();
  const resumed = await auth.tryResumeSession();
  if (!resumed) {
    ui.showScreen('splash');
  }
}

function wireEvents() {
  if (ui.els.enterBtn) {
    ui.els.enterBtn.addEventListener('click', () => {
      ui.tryPlayLoginMusic();
      ui.showScreen('loginScreen');
    });
  }

  if (ui.els.loginForm) {
    ui.els.loginForm.addEventListener('submit', auth.handleLogin);
  }

  if (ui.els.registerForm) {
    ui.els.registerForm.addEventListener('submit', auth.handleRegister);
  }

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

  // World logout button (Slice 2)
  if (ui.els.worldLogoutBtn) {
    ui.els.worldLogoutBtn.addEventListener('click', auth.handleLogout);
  }
}

boot().catch(err => {
  console.error('Boot failure:', err);
  ui.showScreen('splash');
});
