/**
 * SebasPresent — Error capture (Sesión 31, FASE 2)
 *
 * Buffer circular con los últimos 50 errores que llegaron a window.
 * El dev_overlay muestra los 5 más recientes en su panel.
 *
 * Captura:
 *   - window.onerror (syntax errors, throws no atrapados)
 *   - window.unhandledrejection (promises sin .catch)
 *   - console.error explícitos (opt-in via hook)
 *
 * NO captura console.warn por diseño — solo cosas que rompieron de verdad.
 *
 * Uso desde fuera:
 *   import { getRecentErrors, clearErrors, pushError } from './error_capture.js';
 *   const errs = getRecentErrors();  // array de { ts, type, message, stack, source }
 *
 * Para forzar un error de prueba desde la consola:
 *   __diag.testError()
 */

const MAX_ERRORS = 50;
const errors = [];   // newest first

let installed = false;

/**
 * Empuja un error al buffer. Llamado por handlers globales y por código
 * que quiera registrar errores propios (ej. catch en try/catch).
 */
export function pushError(entry) {
  if (!entry || typeof entry !== 'object') return;
  errors.unshift({
    ts: Date.now(),
    type: entry.type || 'unknown',
    message: String(entry.message || entry.error?.message || 'unknown error'),
    stack: entry.stack || entry.error?.stack || null,
    source: entry.source || null,
  });
  if (errors.length > MAX_ERRORS) errors.length = MAX_ERRORS;
}

/** Devuelve hasta `n` errores más recientes (default 5). */
export function getRecentErrors(n = 5) {
  return errors.slice(0, n);
}

/** Total de errores en el buffer. */
export function getErrorCount() {
  return errors.length;
}

/** Limpia el buffer. */
export function clearErrors() {
  errors.length = 0;
}

/**
 * Instala los handlers globales. Idempotente: llamar dos veces no rompe.
 * Llamado desde debug/index.js → initDebugSystem().
 */
export function installErrorHandlers() {
  if (installed) return;
  installed = true;

  // Errores síncronos no atrapados.
  window.addEventListener('error', (ev) => {
    pushError({
      type: 'error',
      message: ev.message,
      stack: ev.error?.stack,
      source: ev.filename + ':' + ev.lineno + ':' + ev.colno,
    });
  });

  // Promesas rechazadas sin .catch().
  window.addEventListener('unhandledrejection', (ev) => {
    const reason = ev.reason;
    pushError({
      type: 'unhandled_rejection',
      message: reason?.message || String(reason),
      stack: reason?.stack,
      source: null,
    });
  });

  console.log('[debug/error_capture] installed');
}
