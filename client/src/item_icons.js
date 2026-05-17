/**
 * SebasPresent — Item icons (custom SVG)
 *
 * Mapa item_id → SVG inline string. Estilo old-school MMO con paleta limitada,
 * silueta marcada y outline negro. 32×32 viewBox.
 *
 * API pública:
 *   hasCustomIcon(itemId)             → bool
 *   renderItemIcon(el, itemId, fallbackEmoji)
 *     Pinta el icono dentro del elemento HTML. Si hay SVG custom, usa innerHTML
 *     con el SVG. Si no, usa textContent con el emoji fallback del server.
 *     Siempre limpia el contenido previo del elemento.
 *
 *   getItemIconHtml(itemId, fallbackEmoji)
 *     Devuelve el HTML string (SVG o emoji escapado) para concatenar en
 *     contextos donde no tenemos un elemento DOM (template literals).
 *
 * Cómo añadir nuevos iconos: añade entrada al mapa ICONS con el item_id como
 * clave y un SVG completo (`<svg ...>...</svg>`) como valor. Tamaño 32×32,
 * paleta consistente (bronce #c98a3d, madera #5a3a1d, etc.). Cualquier item
 * sin entry usa el emoji del server como fallback.
 */

// Paleta del juego — referencias para que los nuevos iconos sean consistentes:
//   bronze:     #c98a3d / sombra #6e4a1f / brillo #e3b676
//   iron:       #b0b0b0 / sombra #5a5a5a / brillo #d8d8d8
//   wood:       #5a3a1d / claro  #7a5430 / brillo #a06b2a
//   gold:       #d4af37 / claro  #f0d055 / sombra #7a5e1e
//   leather:    #8a4a1f / claro  #a86a3f
//   stone/coal: #2a2a2a / claro  #5a5a5a
//   mage blue:  #4a90e2 / claro  #7bb3ee

// Inyectar estilos globales al cargar el módulo. Garantiza que CUALQUIER
// SVG render desde este módulo esté visible inmediatamente, sin necesidad
// de que el contenedor lo configure.
(function injectGlobalStyles() {
  if (typeof document === 'undefined') return;
  if (document.getElementById('item-icons-global-styles')) return;
  const style = document.createElement('style');
  style.id = 'item-icons-global-styles';
  style.textContent = `
    /* Container clases conocidas que renderizan iconos: forzar el SVG
       a llenar el contenedor sin importar el font-size original. */
    .inv-icon, .inv-ghost, .shop-cell-icon,
    .equip-slot-icon-wrap, .equip-tooltip-icon,
    .inv-context-menu-icon {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      line-height: 1;
    }
    .inv-icon svg, .inv-ghost svg, .shop-cell-icon svg,
    .equip-slot-icon-wrap svg, .equip-tooltip-icon svg,
    .inv-context-menu-icon svg {
      width: 100%;
      height: 100%;
      display: block;
      max-width: 100%;
      max-height: 100%;
    }
    /* Fallback: si el icono es emoji (.emoji-icon), mantener el font-size
       del contenedor original (el CSS del juego decide cuánto). */
    .emoji-icon {
      display: inline-block;
    }
  `;
  document.head.appendChild(style);
})();

const ICONS = {
  // ============= Armas =============
  sword_bronze: `<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" shape-rendering="crispEdges">
    <polygon points="16,3 19,6 19,20 16,23 13,20 13,6" fill="#c98a3d" stroke="#000" stroke-width="1"/>
    <line x1="16" y1="5" x2="16" y2="21" stroke="#6e4a1f" stroke-width="1"/>
    <line x1="14" y1="6" x2="14" y2="20" stroke="#e3b676" stroke-width="0.5"/>
    <rect x="9" y="21" width="14" height="2" fill="#8a6230" stroke="#000" stroke-width="1"/>
    <rect x="14.5" y="23" width="3" height="5" fill="#5a3a1d" stroke="#000" stroke-width="1"/>
    <circle cx="16" cy="29" r="1.6" fill="#c98a3d" stroke="#000" stroke-width="1"/>
  </svg>`,

  bow_normal: `<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" shape-rendering="crispEdges">
    <path d="M 11 4 Q 22 16 11 28" fill="none" stroke="#7a4a1f" stroke-width="2.5" stroke-linecap="round"/>
    <path d="M 11 4 Q 21 16 11 28" fill="none" stroke="#c4842f" stroke-width="1" stroke-linecap="round"/>
    <rect x="14" y="14" width="3" height="4" fill="#5a3a1d" stroke="#000" stroke-width="0.5"/>
    <line x1="11" y1="4" x2="11" y2="28" stroke="#e8d5a8" stroke-width="0.8"/>
    <line x1="11" y1="16" x2="25" y2="16" stroke="#5a3a1d" stroke-width="1"/>
    <polygon points="25,16 22,14 22,18" fill="#a0a0a0" stroke="#000" stroke-width="0.5"/>
    <polygon points="11,16 13,14 13,18" fill="#d4b884" stroke="#000" stroke-width="0.5"/>
  </svg>`,

  staff_normal: `<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" shape-rendering="crispEdges">
    <line x1="16" y1="9" x2="16" y2="29" stroke="#6e4a1f" stroke-width="2.5"/>
    <line x1="16" y1="9" x2="16" y2="29" stroke="#a06b2a" stroke-width="1"/>
    <polygon points="16,2 20,7 16,12 12,7" fill="#4a90e2" stroke="#000" stroke-width="1"/>
    <polygon points="16,2 20,7 16,7" fill="#7bb3ee"/>
    <circle cx="13" cy="9" r="1" fill="#d4af37" stroke="#000" stroke-width="0.5"/>
    <circle cx="19" cy="9" r="1" fill="#d4af37" stroke="#000" stroke-width="0.5"/>
    <circle cx="14.5" cy="5.5" r="1" fill="#fff" opacity="0.6"/>
  </svg>`,

  // ============= Herramientas =============
  hatchet_bronze: `<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" shape-rendering="crispEdges">
    <line x1="20" y1="3" x2="11" y2="29" stroke="#5a3a1d" stroke-width="2.5"/>
    <line x1="20" y1="3" x2="11" y2="29" stroke="#7a5430" stroke-width="1"/>
    <path d="M 15 4 L 26 6 L 24 14 L 14 12 Z" fill="#c98a3d" stroke="#000" stroke-width="1"/>
    <path d="M 15 4 L 26 6 L 22 5" fill="#e3b676"/>
    <polygon points="26,6 28,8 26,11 24,14" fill="#e8c887" stroke="#000" stroke-width="0.5"/>
    <rect x="14" y="6" width="3" height="6" fill="#3a2510" stroke="#000" stroke-width="0.5"/>
  </svg>`,

  // alias para items legacy
  axe: `<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" shape-rendering="crispEdges">
    <line x1="20" y1="3" x2="11" y2="29" stroke="#5a3a1d" stroke-width="2.5"/>
    <line x1="20" y1="3" x2="11" y2="29" stroke="#7a5430" stroke-width="1"/>
    <path d="M 15 4 L 26 6 L 24 14 L 14 12 Z" fill="#c98a3d" stroke="#000" stroke-width="1"/>
    <path d="M 15 4 L 26 6 L 22 5" fill="#e3b676"/>
    <polygon points="26,6 28,8 26,11 24,14" fill="#e8c887" stroke="#000" stroke-width="0.5"/>
    <rect x="14" y="6" width="3" height="6" fill="#3a2510" stroke="#000" stroke-width="0.5"/>
  </svg>`,

  pickaxe_bronze: `<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" shape-rendering="crispEdges">
    <line x1="16" y1="13" x2="16" y2="29" stroke="#5a3a1d" stroke-width="2.5"/>
    <line x1="16" y1="13" x2="16" y2="29" stroke="#7a5430" stroke-width="1"/>
    <path d="M 4 8 Q 16 4 28 8 L 28 12 Q 16 8 4 12 Z" fill="#c98a3d" stroke="#000" stroke-width="1"/>
    <polygon points="4,8 2,9 4,12" fill="#e8c887" stroke="#000" stroke-width="0.5"/>
    <polygon points="28,8 30,9 28,12" fill="#e8c887" stroke="#000" stroke-width="0.5"/>
    <line x1="10" y1="9" x2="22" y2="9" stroke="#6e4a1f" stroke-width="0.5"/>
  </svg>`,

  tinderbox: `<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" shape-rendering="crispEdges">
    <rect x="6" y="12" width="20" height="14" rx="1" fill="#7a4a1f" stroke="#000" stroke-width="1"/>
    <rect x="6" y="11" width="20" height="3" fill="#5a3a1d" stroke="#000" stroke-width="1"/>
    <rect x="14" y="9" width="4" height="3" fill="#3a2510" stroke="#000" stroke-width="0.8"/>
    <line x1="9" y1="16" x2="23" y2="16" stroke="#3a2510" stroke-width="0.5"/>
    <line x1="9" y1="20" x2="23" y2="20" stroke="#3a2510" stroke-width="0.5"/>
    <circle cx="11" cy="14" r="0.6" fill="#3a2510"/>
    <circle cx="21" cy="14" r="0.6" fill="#3a2510"/>
  </svg>`,

  // ============= Munición =============
  arrow_bronze: `<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" shape-rendering="crispEdges">
    <line x1="6" y1="26" x2="24" y2="8" stroke="#a06b2a" stroke-width="1.5"/>
    <line x1="6" y1="26" x2="24" y2="8" stroke="#d4a567" stroke-width="0.5"/>
    <polygon points="24,8 28,6 26,12 30,4 25,11" fill="#c98a3d" stroke="#000" stroke-width="0.8"/>
    <polygon points="6,26 3,28 5,23" fill="#d4a574" stroke="#000" stroke-width="0.6"/>
    <polygon points="6,26 9,29 4,28" fill="#a06b2a" stroke="#000" stroke-width="0.6"/>
  </svg>`,

  // ============= Monedas =============
  coins: `<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" shape-rendering="crispEdges">
    <circle cx="12" cy="22" r="6" fill="#d4af37" stroke="#000" stroke-width="1"/>
    <circle cx="12" cy="22" r="4" fill="none" stroke="#7a5e1e" stroke-width="0.5"/>
    <text x="12" y="24.5" text-anchor="middle" font-size="6" fill="#7a5e1e" font-family="Georgia,serif" font-weight="bold">G</text>
    <circle cx="20" cy="20" r="6" fill="#e8c247" stroke="#000" stroke-width="1"/>
    <circle cx="20" cy="20" r="4" fill="none" stroke="#7a5e1e" stroke-width="0.5"/>
    <text x="20" y="22.5" text-anchor="middle" font-size="6" fill="#7a5e1e" font-family="Georgia,serif" font-weight="bold">G</text>
    <circle cx="16" cy="14" r="6" fill="#f0d055" stroke="#000" stroke-width="1"/>
    <circle cx="16" cy="14" r="4" fill="none" stroke="#7a5e1e" stroke-width="0.5"/>
    <text x="16" y="16.5" text-anchor="middle" font-size="6" fill="#7a5e1e" font-family="Georgia,serif" font-weight="bold">G</text>
    <circle cx="14" cy="12" r="1" fill="#fff8d0"/>
  </svg>`,

  // ============= Madera =============
  log_normal: `<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" shape-rendering="crispEdges">
    <ellipse cx="16" cy="16" rx="11" ry="7" fill="#7a4a1f" stroke="#000" stroke-width="1"/>
    <ellipse cx="11" cy="16" rx="4" ry="5" fill="#a06b2a" stroke="#000" stroke-width="0.8"/>
    <ellipse cx="11" cy="16" rx="2.5" ry="3.5" fill="#7a4a1f"/>
    <ellipse cx="11" cy="16" rx="1.2" ry="2" fill="#d4a567"/>
    <line x1="16" y1="9" x2="22" y2="9" stroke="#3a1f08" stroke-width="0.8"/>
    <line x1="17" y1="12" x2="23" y2="12" stroke="#3a1f08" stroke-width="0.8"/>
    <line x1="16" y1="20" x2="22" y2="20" stroke="#3a1f08" stroke-width="0.8"/>
    <line x1="17" y1="23" x2="22" y2="23" stroke="#3a1f08" stroke-width="0.8"/>
  </svg>`,

  // ============= Materiales =============
  leather: `<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" shape-rendering="crispEdges">
    <path d="M 6 8 Q 8 5 14 6 L 22 5 Q 28 7 27 14 L 28 22 Q 26 27 20 26 L 12 27 Q 6 25 7 18 Z"
      fill="#8a4a1f" stroke="#000" stroke-width="1"/>
    <path d="M 8 9 Q 10 7 14 8 L 22 7" fill="none" stroke="#a86a3f" stroke-width="0.8"/>
    <path d="M 9 14 Q 14 12 22 13" fill="none" stroke="#a86a3f" stroke-width="0.5"/>
    <path d="M 9 19 Q 16 17 24 18" fill="none" stroke="#a86a3f" stroke-width="0.5"/>
    <circle cx="11" cy="11" r="0.6" fill="#5a2a0e"/>
    <circle cx="23" cy="20" r="0.6" fill="#5a2a0e"/>
    <circle cx="15" cy="22" r="0.6" fill="#5a2a0e"/>
  </svg>`,
};

/** Devuelve true si tenemos un SVG custom para este item_id. */
export function hasCustomIcon(itemId) {
  return Object.prototype.hasOwnProperty.call(ICONS, itemId);
}

/**
 * Pinta el icono dentro del elemento DOM dado.
 *  - Si hay SVG custom: lo inyecta como innerHTML (los SVGs son hardcoded,
 *    no contienen contenido del user, así que es seguro).
 *  - Si no: usa textContent con el emoji fallback que vino del server.
 *
 * Limpia el contenido previo del elemento antes de pintar.
 */
export function renderItemIcon(el, itemId, fallbackEmoji) {
  if (!el) return;
  el.innerHTML = '';
  if (hasCustomIcon(itemId)) {
    el.innerHTML = ICONS[itemId];
  } else {
    el.textContent = fallbackEmoji || '?';
  }
}

/**
 * Devuelve un string HTML listo para concatenar en template literals.
 * SVG si hay custom, span con emoji escapado si no.
 */
export function getItemIconHtml(itemId, fallbackEmoji) {
  if (hasCustomIcon(itemId)) {
    return ICONS[itemId];
  }
  const safe = String(fallbackEmoji || '?')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return `<span class="emoji-icon">${safe}</span>`;
}
