/**
 * SebasPresent — Book Modal (Sesión 33, Bloque 1 día 3)
 *
 * Sistema de modal reusable estilo "libro abierto" para mostrar contenido
 * extenso en una UI bonita. Esta es la INFRAESTRUCTURA — no contiene
 * libros específicos. Cada feature (skills, crafting, prayer, magic)
 * importa este módulo y le pasa su propio contenido.
 *
 * ============================================================
 * API
 * ============================================================
 *
 *   openBookModal({ title, pages, onClose })
 *     - title: string — header del libro (ej. "Woodcutting")
 *     - pages: Array<{ content: string }> — HTML por página
 *     - onClose: () => void — callback opcional al cerrar
 *     Devuelve un id de instancia (string).
 *
 *   closeBookModal()
 *     Cierra el modal abierto. No-op si no hay ninguno.
 *
 *   isBookOpen() → boolean
 *
 * ============================================================
 * Ejemplo (mañana / Bloque 5)
 * ============================================================
 *
 *   import { openBookModal } from './ui/book_modal.js';
 *
 *   // Al click en la skill "Woodcutting" del stats panel:
 *   openBookModal({
 *     title: 'Woodcutting',
 *     pages: [
 *       { content: `<h2>Bienvenido a la tala</h2><p>...</p>` },
 *       { content: `<h2>Tipos de árboles</h2><ul>...</ul>` },
 *       { content: `<h2>Hachas disponibles</h2>...` },
 *     ],
 *   });
 *
 * ============================================================
 * SFX
 * ============================================================
 *   - book_open  al abrir
 *   - book_flip  al cambiar de página (next/prev)
 *   - book_close al cerrar
 *
 * Todos ya cargados en audio.js (Sesión 32). Si audio falla, el modal
 * funciona igual — los sfx son try/catch silencioso.
 *
 * ============================================================
 * Debug
 * ============================================================
 *
 *   window.__demoBook()  → abre un libro de muestra para verificar visual.
 *   window.__closeBook() → cierra el modal abierto.
 */

import * as audio from '../audio.js';

const OVERLAY_ID = 'book-modal-overlay';
const STYLES_ID  = 'book-modal-styles';

let _currentInstance = null;   // { id, pages, currentPage, onClose, els }
let _instanceCounter = 0;

// ============================================================
// CSS — se inyecta una sola vez. Estilo OSRS-like (borders dorados,
// Cinzel, fondo madera) coherente con bank-overlay / ge-overlay.
// ============================================================

const STYLES = `
.book-modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.72);
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
  z-index: 60;
  display: none;
  align-items: center;
  justify-content: center;
  padding: env(safe-area-inset-top, 0px) 16px env(safe-area-inset-bottom, 0px) 16px;
  opacity: 0;
  transition: opacity 180ms ease-out;
}
.book-modal-overlay.visible {
  display: flex;
  opacity: 1;
}

.book-modal-frame {
  position: relative;
  width: 100%;
  max-width: 560px;
  max-height: calc(100vh - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px) - 32px);
  background:
    radial-gradient(ellipse at top, rgba(80, 50, 25, 0.4), transparent 60%),
    linear-gradient(160deg, rgba(50, 30, 16, 0.98), rgba(28, 16, 8, 0.98));
  border: 3px solid #c8a043;
  border-radius: 6px;
  box-shadow:
    0 0 60px rgba(200, 160, 67, 0.35),
    0 12px 40px rgba(0, 0, 0, 0.85),
    inset 0 0 30px rgba(0, 0, 0, 0.4);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  /* Anim de open: scale + fade */
  transform: scale(0.92);
  opacity: 0;
  transition: transform 220ms cubic-bezier(0.2, 0.9, 0.3, 1.1), opacity 180ms ease-out;
}
.book-modal-overlay.visible .book-modal-frame {
  transform: scale(1);
  opacity: 1;
}

.book-modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 2px solid rgba(200, 160, 67, 0.25);
  background: rgba(40, 25, 15, 0.5);
  flex: 0 0 auto;
}
.book-modal-title {
  font-family: 'Cinzel', serif;
  font-weight: 900;
  font-size: 20px;
  color: #e8c560;
  letter-spacing: 0.06em;
  text-shadow: 0 2px 4px rgba(0, 0, 0, 0.9);
  margin: 0;
}
.book-modal-close {
  width: 36px;
  height: 36px;
  background: rgba(60, 30, 20, 0.95);
  border: 2px solid #c8a043;
  color: #e8c560;
  font-size: 18px;
  font-weight: bold;
  border-radius: 4px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  -webkit-tap-highlight-color: transparent;
  transition: transform 80ms ease-out, background 120ms ease-out;
}
.book-modal-close:active {
  transform: scale(0.9);
  background: rgba(120, 60, 40, 0.95);
}

.book-modal-body {
  flex: 1 1 auto;
  overflow-y: auto;
  padding: 20px 24px;
  color: #e0d4b5;
  font-family: 'Cinzel', serif;
  font-size: 15px;
  line-height: 1.6;
  /* Textura de papel viejo sutil */
  background:
    repeating-linear-gradient(
      0deg,
      rgba(200, 160, 67, 0.02) 0px,
      rgba(200, 160, 67, 0.02) 1px,
      transparent 1px,
      transparent 3px
    );
}
.book-modal-body h1, .book-modal-body h2, .book-modal-body h3 {
  color: #e8c560;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.6);
  margin: 0 0 12px 0;
}
.book-modal-body h2 { font-size: 18px; }
.book-modal-body h3 { font-size: 16px; }
.book-modal-body p { margin: 0 0 10px 0; }
.book-modal-body ul, .book-modal-body ol {
  margin: 8px 0 12px 0;
  padding-left: 20px;
}
.book-modal-body li { margin-bottom: 4px; }
.book-modal-body strong { color: #f0d878; }
.book-modal-body em { color: #b8a880; font-style: italic; }

.book-modal-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 16px;
  border-top: 2px solid rgba(200, 160, 67, 0.25);
  background: rgba(40, 25, 15, 0.5);
  flex: 0 0 auto;
}
.book-modal-page-btn {
  min-width: 44px;
  height: 36px;
  padding: 0 12px;
  background: rgba(60, 30, 20, 0.95);
  border: 2px solid #c8a043;
  color: #e8c560;
  font-family: 'Cinzel', serif;
  font-size: 16px;
  font-weight: bold;
  border-radius: 4px;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  transition: transform 80ms ease-out, background 120ms ease-out;
}
.book-modal-page-btn:active {
  transform: scale(0.92);
  background: rgba(120, 60, 40, 0.95);
}
.book-modal-page-btn[disabled] {
  opacity: 0.35;
  cursor: default;
}
.book-modal-page-btn[disabled]:active {
  transform: none;
  background: rgba(60, 30, 20, 0.95);
}
.book-modal-page-indicator {
  font-family: 'Cinzel', serif;
  color: #c0a060;
  font-size: 14px;
  letter-spacing: 0.08em;
}

/* Anim de flip — sutil flash de luz en el body */
.book-modal-body.flipping {
  animation: book-flip-flash 220ms ease-out;
}
@keyframes book-flip-flash {
  0%   { opacity: 1; }
  40%  { opacity: 0.3; transform: translateX(8px); }
  100% { opacity: 1; transform: translateX(0); }
}
`;

function injectStyles() {
  if (document.getElementById(STYLES_ID)) return;
  const style = document.createElement('style');
  style.id = STYLES_ID;
  style.textContent = STYLES;
  document.head.appendChild(style);
}

// ============================================================
// DOM
// ============================================================

function buildModalDOM() {
  const overlay = document.createElement('div');
  overlay.className = 'book-modal-overlay';
  overlay.id = OVERLAY_ID;

  const frame = document.createElement('div');
  frame.className = 'book-modal-frame';

  const header = document.createElement('div');
  header.className = 'book-modal-header';

  const title = document.createElement('h2');
  title.className = 'book-modal-title';

  const closeBtn = document.createElement('button');
  closeBtn.className = 'book-modal-close';
  closeBtn.type = 'button';
  closeBtn.setAttribute('aria-label', 'Cerrar');
  closeBtn.textContent = '✕';

  header.appendChild(title);
  header.appendChild(closeBtn);

  const body = document.createElement('div');
  body.className = 'book-modal-body';

  const footer = document.createElement('div');
  footer.className = 'book-modal-footer';

  const prevBtn = document.createElement('button');
  prevBtn.className = 'book-modal-page-btn';
  prevBtn.type = 'button';
  prevBtn.setAttribute('aria-label', 'Página anterior');
  prevBtn.textContent = '◀';

  const indicator = document.createElement('span');
  indicator.className = 'book-modal-page-indicator';

  const nextBtn = document.createElement('button');
  nextBtn.className = 'book-modal-page-btn';
  nextBtn.type = 'button';
  nextBtn.setAttribute('aria-label', 'Página siguiente');
  nextBtn.textContent = '▶';

  footer.appendChild(prevBtn);
  footer.appendChild(indicator);
  footer.appendChild(nextBtn);

  frame.appendChild(header);
  frame.appendChild(body);
  frame.appendChild(footer);
  overlay.appendChild(frame);

  return { overlay, frame, title, closeBtn, body, prevBtn, nextBtn, indicator };
}

// ============================================================
// Rendering
// ============================================================

function renderCurrentPage(instance, { withFlipAnim = false } = {}) {
  const { pages, currentPage, els } = instance;
  const total = pages.length;
  const page = pages[currentPage];

  // Contenido
  if (withFlipAnim) {
    els.body.classList.remove('flipping');
    // force reflow para que la anim re-arranque
    void els.body.offsetWidth;
    els.body.classList.add('flipping');
  }
  els.body.innerHTML = page?.content || '<p><em>Página vacía</em></p>';
  els.body.scrollTop = 0;

  // Indicador
  els.indicator.textContent = `${currentPage + 1} / ${total}`;

  // Botones disabled en bordes
  els.prevBtn.disabled = (currentPage <= 0);
  els.nextBtn.disabled = (currentPage >= total - 1);

  // Si hay una sola página, ocultar el footer (no tiene sentido la paginación)
  if (total <= 1) {
    els.prevBtn.style.visibility = 'hidden';
    els.nextBtn.style.visibility = 'hidden';
    els.indicator.style.visibility = 'hidden';
  } else {
    els.prevBtn.style.visibility = '';
    els.nextBtn.style.visibility = '';
    els.indicator.style.visibility = '';
  }
}

function flipPage(delta) {
  if (!_currentInstance) return;
  const inst = _currentInstance;
  const next = inst.currentPage + delta;
  if (next < 0 || next >= inst.pages.length) return;
  inst.currentPage = next;
  try { audio.sfx?.('book_flip'); } catch {}
  renderCurrentPage(inst, { withFlipAnim: true });
}

// ============================================================
// ESC handler (desktop)
// ============================================================

function onKeyDown(e) {
  if (e.key === 'Escape' && _currentInstance) {
    closeBookModal();
  }
}

// ============================================================
// API pública
// ============================================================

/**
 * Abre un modal estilo libro con el contenido pasado. Si ya había uno
 * abierto, lo reemplaza (cierra el anterior sin animación + abre el nuevo).
 *
 * @param {object} opts
 * @param {string} opts.title    Header del libro.
 * @param {Array<{content:string}>} opts.pages  Páginas. Mínimo 1.
 * @param {() => void} [opts.onClose]  Callback al cerrar.
 * @returns {string} id de la instancia (para debugging).
 */
export function openBookModal(opts = {}) {
  const { title = '', pages = [], onClose } = opts;
  if (!Array.isArray(pages) || pages.length === 0) {
    console.warn('[book_modal] openBookModal sin páginas — ignorando');
    return null;
  }

  // Si ya hay uno abierto, cerrarlo sin animación.
  if (_currentInstance) {
    _disposeCurrent({ silent: true });
  }

  injectStyles();

  const els = buildModalDOM();
  els.title.textContent = title;

  const id = `book-${++_instanceCounter}`;
  const instance = {
    id,
    pages,
    currentPage: 0,
    onClose: typeof onClose === 'function' ? onClose : null,
    els,
  };
  _currentInstance = instance;

  // Wire up
  els.closeBtn.addEventListener('click', () => closeBookModal());
  els.prevBtn.addEventListener('click', () => flipPage(-1));
  els.nextBtn.addEventListener('click', () => flipPage(+1));
  // Click fuera del frame → cerrar
  els.overlay.addEventListener('click', (e) => {
    if (e.target === els.overlay) closeBookModal();
  });

  document.addEventListener('keydown', onKeyDown);

  document.body.appendChild(els.overlay);
  // Trigger animación: agregar .visible en el próximo frame para que el
  // transition lo agarre.
  requestAnimationFrame(() => {
    els.overlay.classList.add('visible');
  });

  renderCurrentPage(instance);

  try { audio.sfx?.('book_open'); } catch {}

  return id;
}

/**
 * Cierra el modal abierto. No-op si no hay ninguno.
 */
export function closeBookModal() {
  if (!_currentInstance) return;
  const inst = _currentInstance;
  try { audio.sfx?.('book_close'); } catch {}

  // Animación de salida: quitar .visible, esperar la transición, remover del DOM.
  inst.els.overlay.classList.remove('visible');
  const cb = inst.onClose;

  // Cleanup inmediato del listener global (no esperar a la anim — sino si abrís otro
  // antes de los 220ms el ESC actúa raro).
  document.removeEventListener('keydown', onKeyDown);
  _currentInstance = null;

  setTimeout(() => {
    if (inst.els.overlay.parentNode) {
      inst.els.overlay.parentNode.removeChild(inst.els.overlay);
    }
    if (cb) {
      try { cb(); } catch (e) { console.warn('[book_modal] onClose threw:', e); }
    }
  }, 220);
}

/** True si hay un modal abierto. */
export function isBookOpen() {
  return _currentInstance !== null;
}

/** Cleanup inmediato (sin animación). Usado internamente al reemplazar. */
function _disposeCurrent({ silent = false } = {}) {
  if (!_currentInstance) return;
  const inst = _currentInstance;
  if (inst.els.overlay.parentNode) {
    inst.els.overlay.parentNode.removeChild(inst.els.overlay);
  }
  document.removeEventListener('keydown', onKeyDown);
  _currentInstance = null;
  if (!silent && inst.onClose) {
    try { inst.onClose(); } catch (e) { console.warn('[book_modal] onClose threw:', e); }
  }
}

// ============================================================
// Debug
// ============================================================

if (typeof window !== 'undefined') {
  window.__demoBook = () => {
    openBookModal({
      title: 'Demostración',
      pages: [
        {
          content: `
            <h2>Bienvenido al sistema de libros</h2>
            <p>Esta es la <strong>página 1</strong> de un libro de muestra. Sirve para verificar que la UI funciona bien antes de meter contenido real.</p>
            <p>Probá lo siguiente:</p>
            <ul>
              <li>Tap en la flecha derecha <strong>▶</strong> para pasar de página.</li>
              <li>Escuchá el sonido <em>book_flip</em>.</li>
              <li>Tap en la <strong>✕</strong> arriba a la derecha para cerrar (o click fuera del libro).</li>
            </ul>
          `,
        },
        {
          content: `
            <h2>Página 2 — Formato</h2>
            <p>El cuerpo del libro acepta <strong>HTML</strong> arbitrario. Algunos elementos ya tienen estilos por defecto:</p>
            <ul>
              <li><strong>Negritas</strong> en dorado claro.</li>
              <li><em>Cursivas</em> en color papel envejecido.</li>
              <li>Headings <strong>h2</strong> y <strong>h3</strong> en dorado.</li>
            </ul>
            <h3>Sub-sección</h3>
            <p>Las listas, párrafos y headings ya están estilizados. Lo único que tiene que hacer cada feature es escribir su contenido.</p>
          `,
        },
        {
          content: `
            <h2>Página 3 — Última</h2>
            <p>Esta es la última página. La flecha derecha debería estar deshabilitada (gris).</p>
            <p>Cuando se implementen los libros reales (Bloque 5), cada skill, cada hechizo y cada receta tendrá su propio libro siguiendo este formato.</p>
            <p><em>Cerrá tapeando ✕, click fuera, o tecla ESC.</em></p>
          `,
        },
      ],
      onClose: () => console.log('[demo] libro cerrado'),
    });
  };
  window.__closeBook = () => closeBookModal();
}
