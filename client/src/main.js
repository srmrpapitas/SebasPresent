/**
 * SebasPresent — Entry point (Slice 4a)
 *
 * Sesión 27 fix — Botón "↩ Salir" arriba-izquierda:
 *   - Si estás dentro de un edificio (interiors.isActive()) → sale del
 *     edificio con interiors.leave(), NO cierra sesión.
 *   - Si estás fuera → comportamiento original (logout).
 *
 * El botón de logout "oficial" sigue siendo el del sidebar abajo-derecha
 * (tab "logout" → #sidebarLogoutBtn), gestionado por ui.js.
 */
import * as ui from './ui.js';
import * as auth from './auth.js';
import * as interiors from './interiors.js';

async function boot() {
  wireEvents();
  ui.initSidebar({ onLogout: auth.handleLogout });
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
  // Sesión 27 fix — Botón ↩ Salir arriba-izquierda:
  //   - Si estás en un edificio → sales del edificio (NO logout).
  //   - Si estás fuera → logout normal.
  // El logout "oficial" vive en el sidebar abajo-derecha (tab logout).
  if (ui.els.worldLogoutBtn) {
    ui.els.worldLogoutBtn.addEventListener('click', (ev) => {
      let inInterior = false;
      try { inInterior = !!interiors.isActive?.(); } catch {}
      if (inInterior) {
        ev.preventDefault?.();
        try { interiors.leave?.(); } catch (e) { console.warn('[main] interiors.leave:', e); }
        return;
      }
      auth.handleLogout(ev);
    });
  }
}
boot().catch(err => {
  console.error('Boot failure:', err);
  ui.showScreen('splash');
});
