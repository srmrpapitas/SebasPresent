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
    .inv-context-menu-icon,
    .skill-slot-icon, .skill-tooltip-title-icon,
    .bank-icon, .bank-ghost {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      line-height: 1;
    }
    .inv-icon svg, .inv-ghost svg, .shop-cell-icon svg,
    .equip-slot-icon-wrap svg, .equip-tooltip-icon svg,
    .inv-context-menu-icon svg,
    .skill-slot-icon svg, .skill-tooltip-title-icon svg {
      width: 100%;
      height: 100%;
      display: block;
      max-width: 100%;
      max-height: 100%;
    }
    /* Banco — el SVG escala con el font-size del slot (mantiene la
       proporción que tenía el emoji original sin estirarse al 100%). */
    .bank-icon svg, .bank-ghost svg {
      width: 1em;
      height: 1em;
      display: block;
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

  // ============= Sesión 26 — Set bronce extendido =============

  // Espadón 2H — boca abajo, estilo medieval con fuller, cross-guard
  // curvado y pommel decorado con cruz. Filo apunta hacia abajo.
  sword_bronze_2h: `<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" shape-rendering="crispEdges">
    <polygon points="14,2 18,2 18,4 14,4" fill="#8a6230" stroke="#000" stroke-width="0.5"/>
    <circle cx="16" cy="5" r="2.5" fill="#c98a3d" stroke="#000" stroke-width="1"/>
    <circle cx="15.4" cy="4.5" r="0.6" fill="#e3b676"/>
    <rect x="14.5" y="7" width="3" height="5" fill="#5a3a1d" stroke="#000" stroke-width="1"/>
    <line x1="14.5" y1="8.5" x2="17.5" y2="8.5" stroke="#3a2510" stroke-width="0.4"/>
    <line x1="14.5" y1="10" x2="17.5" y2="10" stroke="#3a2510" stroke-width="0.4"/>
    <line x1="14.5" y1="11.5" x2="17.5" y2="11.5" stroke="#3a2510" stroke-width="0.4"/>
    <rect x="4" y="12" width="24" height="2.5" fill="#8a6230" stroke="#000" stroke-width="1"/>
    <path d="M 4 12 Q 2 13 2 14.5 Q 3 14.8 4 14.5 Z" fill="#8a6230" stroke="#000" stroke-width="1"/>
    <path d="M 28 12 Q 30 13 30 14.5 Q 29 14.8 28 14.5 Z" fill="#8a6230" stroke="#000" stroke-width="1"/>
    <circle cx="16" cy="13.2" r="0.8" fill="#d4af37" stroke="#6e4a1f" stroke-width="0.4"/>
    <polygon points="16,15 19,16 19,28 16,30 13,28 13,16" fill="#c98a3d" stroke="#000" stroke-width="1"/>
    <rect x="15.5" y="16" width="1" height="12" fill="#6e4a1f"/>
    <line x1="14" y1="16" x2="14" y2="27" stroke="#e3b676" stroke-width="0.6"/>
    <line x1="18" y1="16" x2="18" y2="27" stroke="#6e4a1f" stroke-width="0.5"/>
  </svg>`,

  // Pechera bronce — coraza medieval con hombreras, cuello en V,
  // chevrón de costillas, cinturón con hebilla dorada y rivets.
  chest_bronze: `<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" shape-rendering="crispEdges">
    <path d="M 5 9 Q 6 7 8 7 L 10 6 Q 13 5 16 5 Q 19 5 22 6 L 24 7 Q 26 7 27 9 L 27 11 Q 25 12 23 11 L 23 13 L 24 22 Q 24 26 22 27 L 18 28 L 14 28 L 10 27 Q 8 26 8 22 L 9 13 L 9 11 Q 7 12 5 11 Z"
      fill="#c98a3d" stroke="#000" stroke-width="1"/>
    <path d="M 11 7 Q 12 6 16 6 Q 20 6 21 7 L 19 11 L 16 12 L 13 11 Z" fill="#3a2510"/>
    <path d="M 13 11 L 16 12 L 19 11" fill="none" stroke="#6e4a1f" stroke-width="0.5"/>
    <path d="M 9 13 L 13 16 L 11 18 L 9 16 Z" fill="#a86a30" stroke="#6e4a1f" stroke-width="0.4"/>
    <path d="M 23 13 L 19 16 L 21 18 L 23 16 Z" fill="#a86a30" stroke="#6e4a1f" stroke-width="0.4"/>
    <path d="M 11 18 L 16 16 L 21 18 L 16 19 Z" fill="#a86a30" stroke="#6e4a1f" stroke-width="0.4"/>
    <path d="M 11 21 L 16 19 L 21 21 L 16 22 Z" fill="#a86a30" stroke="#6e4a1f" stroke-width="0.4"/>
    <rect x="9" y="22" width="14" height="2.5" fill="#5a3a1d" stroke="#000" stroke-width="0.6"/>
    <rect x="14" y="22.3" width="4" height="2" fill="#d4af37" stroke="#6e4a1f" stroke-width="0.4"/>
    <rect x="15" y="22.8" width="2" height="1" fill="#6e4a1f"/>
    <circle cx="6" cy="9" r="0.5" fill="#6e4a1f"/>
    <circle cx="26" cy="9" r="0.5" fill="#6e4a1f"/>
    <circle cx="10" cy="26" r="0.5" fill="#6e4a1f"/>
    <circle cx="22" cy="26" r="0.5" fill="#6e4a1f"/>
  </svg>`,

  // Escudo bronce — redondo estilo viking con boss central
  shield_bronze: `<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" shape-rendering="crispEdges">
    <circle cx="16" cy="16" r="13" fill="#5a3a1d" stroke="#000" stroke-width="1"/>
    <circle cx="16" cy="16" r="13" fill="none" stroke="#c98a3d" stroke-width="2"/>
    <circle cx="16" cy="16" r="11" fill="#7a5430" stroke="#3a2510" stroke-width="0.5"/>
    <path d="M 16 5 L 16 27 M 5 16 L 27 16 M 8.5 8.5 L 23.5 23.5 M 23.5 8.5 L 8.5 23.5"
      stroke="#5a3a1d" stroke-width="0.6"/>
    <circle cx="16" cy="16" r="4" fill="#c98a3d" stroke="#000" stroke-width="1"/>
    <circle cx="16" cy="16" r="2" fill="#e3b676" stroke="#6e4a1f" stroke-width="0.5"/>
    <circle cx="15.5" cy="15.5" r="0.6" fill="#fff" opacity="0.8"/>
    <circle cx="16" cy="6.5" r="0.7" fill="#c98a3d" stroke="#000" stroke-width="0.3"/>
    <circle cx="16" cy="25.5" r="0.7" fill="#c98a3d" stroke="#000" stroke-width="0.3"/>
    <circle cx="6.5" cy="16" r="0.7" fill="#c98a3d" stroke="#000" stroke-width="0.3"/>
    <circle cx="25.5" cy="16" r="0.7" fill="#c98a3d" stroke="#000" stroke-width="0.3"/>
  </svg>`,
};

// ============================================================
// Sesión 26 — Iconos de skills (13)
// ============================================================
// Mismo viewBox 32×32, paleta consistente con items. Cada skill tiene
// un color dominante distinto para que el grid del tab Stats se vea
// variado de un vistazo.
const SKILL_ICONS = {
  // Ataque — dos espadas cruzadas en X (bronce + plata)
  attack: `<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" shape-rendering="crispEdges">
    <g transform="rotate(45 16 16)">
      <polygon points="15,3 17,3 17,20 15,20" fill="#c98a3d" stroke="#000" stroke-width="0.6"/>
      <rect x="12" y="20" width="8" height="1.5" fill="#8a6230" stroke="#000" stroke-width="0.5"/>
      <rect x="15" y="21.5" width="2" height="6" fill="#5a3a1d" stroke="#000" stroke-width="0.5"/>
    </g>
    <g transform="rotate(-45 16 16)">
      <polygon points="15,3 17,3 17,20 15,20" fill="#b0b0b0" stroke="#000" stroke-width="0.6"/>
      <rect x="12" y="20" width="8" height="1.5" fill="#5a5a5a" stroke="#000" stroke-width="0.5"/>
      <rect x="15" y="21.5" width="2" height="6" fill="#3a2510" stroke="#000" stroke-width="0.5"/>
    </g>
  </svg>`,

  // Fuerza — puño cerrado frontal estilo emoji
  strength: `<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" shape-rendering="crispEdges">
    <path d="M 8 8 L 7 12 Q 7 13 8 13 L 10 13 L 10 8 Z" fill="#e8b890" stroke="#000" stroke-width="0.7"/>
    <path d="M 10 7 L 10 13 L 13 13 L 13 7 Z" fill="#e8b890" stroke="#000" stroke-width="0.7"/>
    <path d="M 13 7 L 13 13 L 16 13 L 16 7 Z" fill="#e8b890" stroke="#000" stroke-width="0.7"/>
    <path d="M 16 8 L 16 13 L 19 13 L 19 8 Z" fill="#e8b890" stroke="#000" stroke-width="0.7"/>
    <path d="M 7 13 L 7 21 Q 7 24 10 25 L 19 25 Q 22 25 23 22 L 22 13 Z" fill="#e8b890" stroke="#000" stroke-width="1"/>
    <path d="M 19 9 Q 23 11 23 16 Q 23 18 22 18 L 19 18 Z" fill="#e8b890" stroke="#000" stroke-width="0.8"/>
    <path d="M 22 13 L 19 13 L 19 18 L 22 18 Z" fill="#d8a070" opacity="0.6"/>
    <path d="M 7 12 Q 9 11 11 12 M 10 11 Q 12 10 14 11 M 13 11 Q 15 10 17 11 M 16 12 Q 18 11 20 12"
      stroke="#8a5030" stroke-width="0.4" fill="none"/>
    <path d="M 7 19 Q 11 18.5 15 19 Q 19 18.5 22 19" stroke="#8a5030" stroke-width="0.5" fill="none"/>
    <path d="M 7 22 Q 11 21.5 15 22 Q 19 21.5 22 22" stroke="#8a5030" stroke-width="0.4" fill="none"/>
    <ellipse cx="9" cy="14.5" rx="0.6" ry="0.7" fill="#d8a070"/>
    <ellipse cx="13" cy="14.5" rx="0.6" ry="0.7" fill="#d8a070"/>
    <ellipse cx="17" cy="14.5" rx="0.6" ry="0.7" fill="#d8a070"/>
    <path d="M 8 25 L 8 28 L 22 28 L 22 25" fill="#5a3a1d" stroke="#000" stroke-width="0.8"/>
    <line x1="8" y1="26.5" x2="22" y2="26.5" stroke="#3a2510" stroke-width="0.4"/>
  </svg>`,

  // Defensa — escudo plateado con boss azul
  defence: `<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" shape-rendering="crispEdges">
    <path d="M 16 4 L 26 8 L 26 17 Q 26 24 16 29 Q 6 24 6 17 L 6 8 Z" fill="#b0b0b0" stroke="#000" stroke-width="1"/>
    <path d="M 16 4 L 16 29" stroke="#5a5a5a" stroke-width="0.6"/>
    <path d="M 6 14 L 26 14" stroke="#5a5a5a" stroke-width="0.6"/>
    <path d="M 16 4 L 26 8 L 16 14 Z" fill="#d8d8d8"/>
    <path d="M 16 14 L 26 14 L 26 17 Q 26 22 16 26 Z" fill="#a0a0a0"/>
    <circle cx="16" cy="14" r="2" fill="#4a90e2" stroke="#000" stroke-width="0.6"/>
    <circle cx="15.5" cy="13.5" r="0.6" fill="#fff" opacity="0.8"/>
  </svg>`,

  // Vitalidad — corazón rojo con brillo
  hitpoints: `<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" shape-rendering="crispEdges">
    <path d="M 16 27 L 5 17 Q 2 13 5 9 Q 9 5 13 8 L 16 11 L 19 8 Q 23 5 27 9 Q 30 13 27 17 Z"
      fill="#c83030" stroke="#000" stroke-width="1"/>
    <path d="M 9 10 Q 7 13 9 16 L 14 20" fill="none" stroke="#ff6060" stroke-width="1"/>
    <ellipse cx="11" cy="11" rx="1.5" ry="1" fill="#ff8080" opacity="0.7"/>
  </svg>`,

  // Distancia (ranged) — arco verde con flecha cargada y dos flechas en
  // aljaba detrás. Cuerda blanca tensada.
  // Distancia — arco con flecha + plumas rojas
  ranged: `<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" shape-rendering="crispEdges">
    <path d="M 9 3 Q 8 5 9 6 Q 23 16 9 26 Q 8 27 9 29" fill="none" stroke="#5a3a1d" stroke-width="2.4" stroke-linecap="round"/>
    <path d="M 9 4 Q 22 16 9 28" fill="none" stroke="#a86a30" stroke-width="0.7"/>
    <path d="M 8 3 L 10 3 L 10 4 L 8 4 Z M 8 28 L 10 28 L 10 29 L 8 29 Z" fill="#3a2510" stroke="#000" stroke-width="0.3"/>
    <line x1="9" y1="4" x2="9" y2="28" stroke="#e8d5a8" stroke-width="0.7"/>
    <line x1="9" y1="16" x2="28" y2="16" stroke="#7a5430" stroke-width="1.2"/>
    <polygon points="28,16 24,13 25,16 24,19" fill="#a0a0a0" stroke="#000" stroke-width="0.5"/>
    <polygon points="28,16 25,15.3 25,16.7" fill="#d8d8d8"/>
    <path d="M 12 13 L 9 16 L 12 16 Z M 12 19 L 9 16 L 12 16 Z" fill="#c83030" stroke="#000" stroke-width="0.4"/>
    <path d="M 14 14 L 11 16 L 14 16 Z M 14 18 L 11 16 L 14 16 Z" fill="#8a2020" opacity="0.7"/>
  </svg>`,

  // Magia — gorro de mago cónico con estrellas + banda dorada
  magic: `<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" shape-rendering="crispEdges">
    <path d="M 16 2 Q 14 6 12 10 Q 10 16 8 22 L 24 22 Q 22 16 20 10 Q 18 6 16 2 Z" fill="#3a3a8a" stroke="#000" stroke-width="1"/>
    <path d="M 16 2 Q 18 6 19 10 Q 20 14 21 18 L 24 22 Q 22 16 20 10 Q 18 6 16 2 Z" fill="#5050a0" opacity="0.5"/>
    <path d="M 14 8 L 18 8 L 19 11 L 13 11 Z" fill="#5050a0"/>
    <circle cx="17" cy="6" r="0.8" fill="#d4af37" stroke="#000" stroke-width="0.3"/>
    <circle cx="14" cy="11" r="0.6" fill="#ffffff"/>
    <circle cx="19" cy="14" r="0.5" fill="#ffffff"/>
    <circle cx="11" cy="18" r="0.5" fill="#ffffff"/>
    <circle cx="21" cy="18" r="0.5" fill="#ffffff"/>
    <polygon points="13,5 13.5,6 14.5,6 13.7,6.7 14,7.5 13,7 12,7.5 12.3,6.7 11.5,6 12.5,6" fill="#d4af37"/>
    <rect x="6" y="22" width="20" height="4" fill="#2a2a6a" stroke="#000" stroke-width="0.8"/>
    <rect x="6" y="22" width="20" height="1.2" fill="#d4af37"/>
    <rect x="6" y="24.8" width="20" height="1.2" fill="#d4af37"/>
    <rect x="14" y="22" width="4" height="4" fill="#d4af37" stroke="#6e4a1f" stroke-width="0.5"/>
    <circle cx="16" cy="24" r="1" fill="#7050d0" stroke="#000" stroke-width="0.4"/>
    <circle cx="15.5" cy="23.5" r="0.3" fill="#ffffff" opacity="0.8"/>
  </svg>`,

  // Plegaria — cruz dorada con halo
  prayer: `<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" shape-rendering="crispEdges">
    <circle cx="16" cy="16" r="12" fill="none" stroke="#d4af37" stroke-width="0.8" opacity="0.6"/>
    <circle cx="16" cy="16" r="9" fill="none" stroke="#d4af37" stroke-width="0.5" opacity="0.4"/>
    <rect x="14" y="5" width="4" height="22" fill="#d4af37" stroke="#000" stroke-width="0.8"/>
    <rect x="8" y="11" width="16" height="4" fill="#d4af37" stroke="#000" stroke-width="0.8"/>
    <rect x="14.5" y="6" width="1" height="20" fill="#f0d055"/>
    <rect x="9" y="11.5" width="14" height="1" fill="#f0d055"/>
    <circle cx="16" cy="13" r="1.5" fill="#fff" opacity="0.6"/>
  </svg>`,

  // Tala — hacha clavada en tronco partido por la mitad + tronco al lado
  woodcutting: `<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" shape-rendering="crispEdges">
    <ellipse cx="6" cy="27" rx="5" ry="1.5" fill="#3a2510" stroke="#000" stroke-width="0.5"/>
    <rect x="2" y="22" width="8" height="5" fill="#7a5430" stroke="#000" stroke-width="0.7"/>
    <ellipse cx="6" cy="22" rx="4" ry="1.2" fill="#a06b2a" stroke="#000" stroke-width="0.5"/>
    <circle cx="6" cy="22" r="0.5" fill="#5a3a1d"/>
    <ellipse cx="20" cy="28" rx="9" ry="2" fill="#3a2510" stroke="#000" stroke-width="0.6"/>
    <path d="M 12 16 L 17 14 L 17 26 L 12 27 Z" fill="#7a5430" stroke="#000" stroke-width="0.8"/>
    <path d="M 17 13 L 28 13 L 28 25 L 17 26 Z" fill="#7a5430" stroke="#000" stroke-width="0.8"/>
    <ellipse cx="14.5" cy="16" rx="2.5" ry="0.9" fill="#a06b2a" stroke="#000" stroke-width="0.5"/>
    <ellipse cx="22.5" cy="14" rx="5.5" ry="1.3" fill="#a06b2a" stroke="#000" stroke-width="0.5"/>
    <circle cx="14.5" cy="16" r="0.5" fill="#5a3a1d"/>
    <ellipse cx="22.5" cy="14" rx="3.5" ry="0.7" fill="none" stroke="#5a3a1d" stroke-width="0.3"/>
    <ellipse cx="22.5" cy="14" rx="2" ry="0.4" fill="none" stroke="#5a3a1d" stroke-width="0.3"/>
    <circle cx="22.5" cy="14" r="0.5" fill="#5a3a1d"/>
    <path d="M 14 18 Q 16 17.5 17.5 18 M 14 22 Q 16 21.5 17.5 22" stroke="#5a3a1d" stroke-width="0.3" fill="none"/>
    <path d="M 19 17 Q 23 16.5 27 17 M 18 21 Q 23 20.5 27 21 M 19 24 Q 23 23.5 27 24" stroke="#5a3a1d" stroke-width="0.3" fill="none"/>
    <path d="M 14 16 L 18 18 L 22 14" fill="#3a2510" stroke="#1a0a00" stroke-width="0.5"/>
    <g transform="rotate(-35 18 8)">
      <rect x="17" y="2" width="2.5" height="12" fill="#c83030" stroke="#000" stroke-width="0.6"/>
      <rect x="17" y="2" width="2.5" height="12" fill="#ff6060" opacity="0.3"/>
      <line x1="16.5" y1="5" x2="18" y2="5" stroke="#700000" stroke-width="0.4"/>
      <line x1="17" y1="9" x2="18.5" y2="9" stroke="#700000" stroke-width="0.4"/>
      <rect x="17" y="1" width="2.5" height="1.5" fill="#700000" stroke="#000" stroke-width="0.3"/>
      <path d="M 16 12 L 26 10 L 28 13 L 23 18 L 16 16 Z" fill="#c0c0c0" stroke="#000" stroke-width="0.8"/>
      <path d="M 16 12 L 26 10 L 23 18 Z" fill="#e8e8e8" opacity="0.5"/>
      <line x1="20" y1="11" x2="24" y2="14" stroke="#7a7a7a" stroke-width="0.4"/>
    </g>
    <path d="M 13 15 L 11 14 M 14 13 L 12 11 M 16 12 L 15 9" stroke="#a06b2a" stroke-width="0.5" stroke-linecap="round" opacity="0.8"/>
    <polygon points="11,14 12,13 12.5,14.5" fill="#a06b2a" opacity="0.7"/>
    <polygon points="12,11 13,10 13,12" fill="#a06b2a" opacity="0.7"/>
  </svg>`,

  // Pesca — caña con pez azul
  fishing: `<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" shape-rendering="crispEdges">
    <line x1="6" y1="6" x2="22" y2="22" stroke="#7a5430" stroke-width="1.5"/>
    <line x1="6" y1="6" x2="22" y2="22" stroke="#a06b2a" stroke-width="0.6"/>
    <line x1="22" y1="22" x2="20" y2="28" stroke="#aaa" stroke-width="0.5" stroke-dasharray="1,1"/>
    <path d="M 16 24 Q 12 22 8 24 Q 6 26 8 28 Q 12 30 16 28 L 18 26 Z"
      fill="#4a90e2" stroke="#000" stroke-width="0.8"/>
    <polygon points="18,26 22,24 22,28" fill="#4a90e2" stroke="#000" stroke-width="0.8"/>
    <circle cx="10" cy="26" r="0.6" fill="#000"/>
    <circle cx="10" cy="26" r="0.3" fill="#fff"/>
    <line x1="13" y1="26" x2="15" y2="26" stroke="#3060a0" stroke-width="0.5"/>
  </svg>`,

  // Minería — pico de minero con mango atravesando la cabeza (solo asoma
  // la punta por arriba). Roca con vetas doradas debajo.
  mining: `<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" shape-rendering="crispEdges">
    <ellipse cx="20" cy="27" rx="9" ry="3" fill="#3a3a3a" stroke="#000" stroke-width="0.8"/>
    <path d="M 11 26 Q 11 23 14 22 L 20 21 Q 26 21 28 23 L 29 27 Z" fill="#7a7a7a" stroke="#3a3a3a" stroke-width="0.5"/>
    <path d="M 13 23 Q 18 22 24 23" fill="none" stroke="#d4af37" stroke-width="0.7"/>
    <path d="M 16 25 Q 20 24 22 25" fill="none" stroke="#d4af37" stroke-width="0.5"/>
    <circle cx="22" cy="23.5" r="0.4" fill="#f0d055"/>
    <circle cx="17" cy="25.5" r="0.4" fill="#f0d055"/>
    <g transform="rotate(-20 14 13)">
      <rect x="13" y="11" width="2.5" height="11" fill="#5a3a1d" stroke="#000" stroke-width="0.5"/>
      <line x1="13" y1="14" x2="15.5" y2="14" stroke="#3a2510" stroke-width="0.3"/>
      <line x1="13" y1="18" x2="15.5" y2="18" stroke="#3a2510" stroke-width="0.3"/>
      <rect x="13" y="8" width="2.5" height="3" fill="#7a5430" stroke="#000" stroke-width="0.4"/>
      <path d="M 4 11 Q 14 9 24 11 L 20 16 Q 14 14 8 16 Z" fill="#5a5a5a" stroke="#000" stroke-width="0.8"/>
      <path d="M 4 11 L 8 16 L 5 17 Z" fill="#7a7a7a"/>
      <path d="M 24 11 L 20 16 L 23 17 Z" fill="#3a3a3a"/>
      <polygon points="2,11 5,11 5,12 2,12" fill="#7a7a7a" stroke="#000" stroke-width="0.3"/>
      <polygon points="24,11 27,11 27,12 24,12" fill="#7a7a7a" stroke="#000" stroke-width="0.3"/>
    </g>
  </svg>`,

  // Cocina — sartén con llama
  cooking: `<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" shape-rendering="crispEdges">
    <ellipse cx="14" cy="18" rx="9" ry="3" fill="#3a3a3a" stroke="#000" stroke-width="1"/>
    <ellipse cx="14" cy="17" rx="9" ry="3" fill="#5a5a5a" stroke="#000" stroke-width="1"/>
    <ellipse cx="14" cy="16.5" rx="7" ry="2" fill="#2a2a2a"/>
    <rect x="22" y="16" width="9" height="2" fill="#7a5430" stroke="#000" stroke-width="0.6"/>
    <path d="M 10 14 Q 11 9 14 12 Q 17 7 17 13 Q 19 10 18 14 Z" fill="#ff8030" stroke="#c84a10" stroke-width="0.6"/>
    <path d="M 12 13 Q 14 11 14 13 Q 16 10 16 13" fill="#ffd060" stroke="#ff8030" stroke-width="0.4"/>
  </svg>`,

  // Fuego — llama
  firemaking: `<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" shape-rendering="crispEdges">
    <path d="M 16 4 Q 12 11 14 16 Q 8 14 8 22 Q 8 28 16 29 Q 24 28 24 22 Q 24 14 18 16 Q 20 11 16 4 Z"
      fill="#ff6020" stroke="#000" stroke-width="1"/>
    <path d="M 16 8 Q 13 14 15 18 Q 11 17 11 22 Q 11 26 16 27 Q 21 26 21 22 Q 21 17 17 18 Q 19 14 16 8 Z"
      fill="#ffa040"/>
    <path d="M 16 14 Q 14 18 16 22 Q 14 22 14 24 Q 14 26 16 26 Q 18 26 18 24 Q 18 22 16 22 Q 18 18 16 14 Z"
      fill="#ffd060"/>
    <ellipse cx="16" cy="24" rx="2" ry="2" fill="#fff" opacity="0.5"/>
  </svg>`,

  // Herrería — yunque grande con martillo de herrero. Mango envuelto en
  // vendas de cuero (herramienta artesana, no arma). Chispas naranjas.
  smithing: `<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" shape-rendering="crispEdges">
    <rect x="6" y="22" width="20" height="6" fill="#3a3a3a" stroke="#000" stroke-width="0.8"/>
    <rect x="6" y="22" width="20" height="1.5" fill="#5a5a5a"/>
    <path d="M 8 22 L 4 17 L 28 17 L 24 22 Z" fill="#5a5a5a" stroke="#000" stroke-width="0.8"/>
    <path d="M 4 17 L 8 13 L 12 17 Z" fill="#5a5a5a" stroke="#000" stroke-width="0.8"/>
    <path d="M 8 13 L 9 14 L 11 14 L 12 17 L 8 17" fill="#7a7a7a"/>
    <g transform="rotate(25 16 8)">
      <rect x="14" y="6" width="2" height="9" fill="#5a3a1d" stroke="#000" stroke-width="0.5"/>
      <rect x="13.5" y="9" width="3" height="3" fill="#e8c5a0" stroke="#3a2510" stroke-width="0.4"/>
      <line x1="13.5" y1="9.5" x2="16.5" y2="9.5" stroke="#7a5430" stroke-width="0.4"/>
      <line x1="13.5" y1="10.5" x2="16.5" y2="10.5" stroke="#7a5430" stroke-width="0.4"/>
      <line x1="13.5" y1="11.5" x2="16.5" y2="11.5" stroke="#7a5430" stroke-width="0.4"/>
      <rect x="6" y="2" width="14" height="5" fill="#7a7a7a" stroke="#000" stroke-width="0.8"/>
      <rect x="6" y="2" width="14" height="1.5" fill="#a8a8a8"/>
      <rect x="6" y="5.5" width="14" height="0.6" fill="#3a3a3a"/>
      <circle cx="13" cy="4.5" r="0.6" fill="#3a3a3a"/>
    </g>
    <circle cx="20" cy="18" r="0.8" fill="#ff8030" opacity="0.7"/>
    <circle cx="22" cy="16" r="0.5" fill="#ffd040"/>
    <circle cx="10" cy="19" r="0.4" fill="#ff8030" opacity="0.6"/>
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

// ============================================================
// Sesión 26 — Helpers de skills
// ============================================================

/** Devuelve true si tenemos un SVG custom para este skill. */
export function hasCustomSkillIcon(skillId) {
  return Object.prototype.hasOwnProperty.call(SKILL_ICONS, skillId);
}

/**
 * Pinta el icono de un skill dentro del elemento DOM dado.
 * Fallback al emoji si no hay SVG custom.
 */
export function renderSkillIcon(el, skillId, fallbackEmoji) {
  if (!el) return;
  el.innerHTML = '';
  if (hasCustomSkillIcon(skillId)) {
    el.innerHTML = SKILL_ICONS[skillId];
  } else {
    el.textContent = fallbackEmoji || '?';
  }
}

/**
 * Devuelve el HTML del icono del skill para concatenar en template literals.
 */
export function getSkillIconHtml(skillId, fallbackEmoji) {
  if (hasCustomSkillIcon(skillId)) {
    return SKILL_ICONS[skillId];
  }
  const safe = String(fallbackEmoji || '?')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return `<span class="emoji-icon">${safe}</span>`;
}
