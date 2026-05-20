/**
 * SebasPresent — Entry point (Slice 4a)
 *
 * Sesión 27 fix:
 *   - Botón "↩ Salir" arriba-izquierda ya NO hace logout nunca. Su única
 *     función es salir del edificio actual cuando estás dentro de uno.
 *     Fuera de un edificio, queda oculto (lo gestiona ui.js).
 *   - El logout "oficial" vive solo en el sidebar abajo-derecha
 *     (tab "↩ Salir" → #sidebarLogoutBtn).
 */
import * as ui from './ui.js';
import * as auth from './auth.js';
import * as interiors from './interiors.js';
// Sesión 31 — Debug system (badge + panel + __sebasHealth + __diag.*)
// Idempotente, 100% observer, no toca world.js. Se inicia ANTES que cualquier
// otra cosa para que atrape errores tempranos de boot.
import { initDebugSystem } from './debug/index.js';

async function boot() {
  // Sesión 31 — primero el debug system para captura de errores temprana.
  initDebugSystem();
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
  // Sesión 27 fix — Botón ↩ Salir arriba-izquierda solo sale de edificios.
  // El logout vive en el sidebar abajo-derecha. Si por alguna razón el
  // botón se pulsa fuera de un edificio (no debería: ui.js lo oculta),
  // ignoramos el click — NUNCA cierra sesión.
  if (ui.els.worldLogoutBtn) {
    ui.els.worldLogoutBtn.addEventListener('click', (ev) => {
      ev.preventDefault?.();
      let inInterior = false;
      try { inInterior = !!interiors.isActive?.(); } catch {}
      if (inInterior) {
        try { interiors.leave?.(); } catch (e) { console.warn('[main] interiors.leave:', e); }
      }
      // Fuera de un edificio: no hacer nada (el botón debería estar oculto).
    });
  }
}
boot().catch(err => {
  console.error('Boot failure:', err);
  ui.showScreen('splash');
});
