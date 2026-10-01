/**
 * SebasPresent — Spellbook (Sesión 41, Bloque 2 — mago)
 *
 * Inyecta los hechizos de COMBATE en #magicSpellGrid (tab Magia), al lado del
 * "Home" de home_teleport.js. Estilo OSRS:
 *   - Íconos SVG por hechizo (no emojis).
 *   - Click izquierdo = seleccionar (contorno blanco alrededor, como OSRS).
 *   - Long press (móvil) / click derecho (PC) = menú: Cast / Autocast / Next cast.
 *
 * El AUTOCAST se controla y se ve en la pestaña de COMBATE (no acá): combat.js
 * lee getAutocastSpellMeta()/isAutocastOn() y dibuja el slot de autocast con el
 * SVG del hechizo + toggle on/off (la pestaña de combate se adapta a mago).
 *
 * combat.js, al atacar, pide getSelectedSpellId():
 *   - autocast ON  → devuelve el hechizo de autocast (se repite).
 *   - autocast OFF → devuelve null (el staff pega melee, golpe con el palo).
 *
 * "Next cast" guarda nextCastSpellId; la COLA real (lanzar al terminar el cast
 * actual sin interrumpir) es la pieza 3. Por ahora el botón existe y registra
 * el hechizo encolado, que combat.js mostrará en la pestaña de combate.
 *
 * Mantener SPELLBOOK en sync con server/magic.js. El server tiene la autoridad
 * (rechaza spell inválido / nivel insuficiente / sin maná).
 */

import * as api from './api.js';   // Sesión 50 — hechizos sobre ti

// ============================================================
// Íconos SVG (mismo estilo dibujado a mano que los del HUD)
// ============================================================
// Sesión 50 — iconos nuevos: más detalle, degradados y brillo (estilo OSRS).
const SVG = {
  fire_strike:
    '<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg"><defs>' +
    '<radialGradient id="sbFg" cx="50%" cy="70%" r="60%"><stop offset="0" stop-color="#fff3b0"/><stop offset=".45" stop-color="#ffb030"/><stop offset="1" stop-color="#e03a00"/></radialGradient>' +
    '<radialGradient id="sbFh" cx="50%" cy="60%" r="50%"><stop offset="0" stop-color="#ff9a30" stop-opacity=".8"/><stop offset="1" stop-color="#ff5000" stop-opacity="0"/></radialGradient></defs>' +
    '<circle cx="16" cy="18" r="14" fill="url(#sbFh)"/>' +
    '<path d="M16 2 C18 8 24 10 24 18 a8 8 0 0 1 -16 0 c0-4 2-6 3-8 c0 3 1 4 2 4 c0-5 1-9 3-12Z" fill="url(#sbFg)" stroke="#5a1400" stroke-width="1.1" stroke-linejoin="round"/>' +
    '<path d="M16 13 c3 3 4 5 4 7.5 a4 4 0 0 1 -8 0 c0-2 1-3 2-4 c0 1.5 .6 2 1 2 c0-2 .3-4 1-5.5Z" fill="#fff6c8"/>' +
    '<circle cx="23" cy="7" r="1" fill="#ffd060"/><circle cx="9" cy="9" r=".8" fill="#ffb040"/></svg>',
  ice_spear:
    '<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg"><defs>' +
    '<linearGradient id="sbIg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset=".5" stop-color="#8fdcff"/><stop offset="1" stop-color="#2a7ac8"/></linearGradient>' +
    '<radialGradient id="sbIh" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#9fe3ff" stop-opacity=".7"/><stop offset="1" stop-color="#9fe3ff" stop-opacity="0"/></radialGradient></defs>' +
    '<circle cx="16" cy="16" r="15" fill="url(#sbIh)"/>' +
    '<polygon points="27,5 18,22 15,19" fill="url(#sbIg)" stroke="#0a3a6a" stroke-width="1" stroke-linejoin="round"/>' +
    '<polygon points="27,5 15,19 12,16" fill="#cff4ff" stroke="#0a3a6a" stroke-width="1" stroke-linejoin="round"/>' +
    '<line x1="14" y1="18" x2="5" y2="27" stroke="#6a4a2a" stroke-width="2.4" stroke-linecap="round"/>' +
    '<line x1="14" y1="18" x2="5" y2="27" stroke="#c8e8ff" stroke-width=".8" stroke-linecap="round"/>' +
    '<path d="M8 8 l1 2 l2 1 l-2 1 l-1 2 l-1-2 l-2-1 l2-1Z" fill="#fff"/><path d="M24 22 l.7 1.4 l1.4 .7 l-1.4 .7 l-.7 1.4 l-.7-1.4 l-1.4-.7 l1.4-.7Z" fill="#e8fbff"/></svg>',
  thunderbolt:
    '<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg"><defs>' +
    '<linearGradient id="sbTg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fffbe0"/><stop offset="1" stop-color="#ffc800"/></linearGradient>' +
    '<radialGradient id="sbTh" cx="50%" cy="55%" r="50%"><stop offset="0" stop-color="#fff27a" stop-opacity=".8"/><stop offset="1" stop-color="#fff27a" stop-opacity="0"/></radialGradient></defs>' +
    '<circle cx="16" cy="17" r="15" fill="url(#sbTh)"/>' +
    '<path d="M6 9 a5 4 0 0 1 8-3 a5 4 0 0 1 9 1 a4 3.5 0 0 1 1 7 h-17 a3.5 3.5 0 0 1 -1-5Z" fill="#5a6078" stroke="#1a1c28" stroke-width="1"/>' +
    '<polygon points="17,12 10,21 15,21 12,30 23,17 17.5,17 20,12" fill="url(#sbTg)" stroke="#5a3a00" stroke-width="1" stroke-linejoin="round"/></svg>',
  entangle:
    '<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg"><defs>' +
    '<radialGradient id="sbEh" cx="50%" cy="60%" r="50%"><stop offset="0" stop-color="#7aff6a" stop-opacity=".6"/><stop offset="1" stop-color="#7aff6a" stop-opacity="0"/></radialGradient></defs>' +
    '<circle cx="16" cy="18" r="14" fill="url(#sbEh)"/>' +
    '<path d="M9 29 C5 22 14 20 10 13 C8 9 12 6 14 4" fill="none" stroke="#1f5a18" stroke-width="3" stroke-linecap="round"/>' +
    '<path d="M9 29 C5 22 14 20 10 13 C8 9 12 6 14 4" fill="none" stroke="#5ccf4a" stroke-width="1.4" stroke-linecap="round"/>' +
    '<path d="M22 29 C27 22 17 20 21 13 C23 9 20 7 18 5" fill="none" stroke="#1f5a18" stroke-width="3" stroke-linecap="round"/>' +
    '<path d="M22 29 C27 22 17 20 21 13 C23 9 20 7 18 5" fill="none" stroke="#7ae05a" stroke-width="1.4" stroke-linecap="round"/>' +
    '<path d="M12 14 c-4-1-5 1-5 3 c3 0 4-1 5-3Z M20 12 c4-2 5 0 6 2 c-3 1-5 0-6-2Z M11 23 c-3 0-4 2-4 3 c2 0 3-1 4-3Z" fill="#6ae04a" stroke="#1f5a18" stroke-width=".7"/></svg>',
};


// Sesión 50 — iconos de los hechizos del pack de magia
function sbIcon(id, c1, c2, c3, body) {
  return '<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg"><defs>' +
    '<radialGradient id="sb' + id + 'h" cx="50%" cy="55%" r="50%"><stop offset="0" stop-color="' + c1 + '" stop-opacity=".75"/><stop offset="1" stop-color="' + c1 + '" stop-opacity="0"/></radialGradient>' +
    '<linearGradient id="sb' + id + 'g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="' + c2 + '"/><stop offset="1" stop-color="' + c3 + '"/></linearGradient></defs>' +
    '<circle cx="16" cy="16" r="15" fill="url(#sb' + id + 'h)"/>' + body.replace(/FILL/g, 'url(#sb' + id + 'g)') + '</svg>';
}
Object.assign(SVG, {
  chorro_mar: sbIcon('Ch', '#6ab8ff', '#e0f4ff', '#1a5ab8',
    '<path d="M3 20 C7 14 11 14 14 18 C17 22 21 22 24 17 C26 14 28 13 30 14 L30 24 C26 27 20 27 16 24 C12 21 8 22 3 26Z" fill="FILL" stroke="#0a2a5a" stroke-width="1"/>' +
    '<path d="M6 12 c2-3 5-3 7 0 M17 9 c2-3 5-3 7 0" fill="none" stroke="#e0f4ff" stroke-width="1.6" stroke-linecap="round"/>'),
  sanacion: sbIcon('Sa', '#8affb0', '#ffffff', '#3ac870',
    '<path d="M16 27 C6 20 4 14 7 10 a5 5 0 0 1 9 1 a5 5 0 0 1 9 -1 C28 14 26 20 16 27Z" fill="FILL" stroke="#145a2a" stroke-width="1.1"/>' +
    '<rect x="14.5" y="11" width="3" height="10" rx="1" fill="#fff"/><rect x="11" y="14.5" width="10" height="3" rx="1" fill="#fff"/>'),
  escudo_lava: sbIcon('Es', '#ff9a40', '#ffe060', '#c83a08',
    '<path d="M16 3 L27 7 C27 17 23 24 16 29 C9 24 5 17 5 7Z" fill="FILL" stroke="#5a1400" stroke-width="1.2" stroke-linejoin="round"/>' +
    '<path d="M16 8 C18 11 21 12 20 16 a4 4 0 0 1 -8 0 c0-2 1-3 2-4 c0 1.5 1 2 1.5 2 c0-2 0-4 .5-6Z" fill="#fff4c0"/>'),
  aliento_guayota: sbIcon('Al', '#ff4040', '#ff9090', '#6a0808',
    '<path d="M9 8 a7 7 0 0 1 14 0 v5 a7 7 0 0 1 -3 6 v4 h-8 v-4 a7 7 0 0 1 -3 -6Z" fill="FILL" stroke="#2a0404" stroke-width="1.1"/>' +
    '<circle cx="13" cy="11" r="2" fill="#2a0404"/><circle cx="19" cy="11" r="2" fill="#2a0404"/>' +
    '<path d="M16 23 c-2 3 -1 5 0 7 c1-2 2-4 0-7Z" fill="#ff3030"/>'),
  erupcion: sbIcon('Er', '#ff6a10', '#ffe060', '#5a1a08',
    '<path d="M3 28 L12 13 L14 15 L18 15 L20 13 L29 28Z" fill="#4a2a1a" stroke="#1a0a04" stroke-width="1"/>' +
    '<path d="M13 15 C12 9 14 6 16 3 C18 6 20 9 19 15Z" fill="FILL"/>' +
    '<circle cx="9" cy="7" r="1.6" fill="#ff8a20"/><circle cx="24" cy="6" r="1.3" fill="#ffd040"/><circle cx="21" cy="3" r="1" fill="#ff6a10"/>'),
  lanza_obsidiana: sbIcon('Lo', '#9a6aff', '#e8d8ff', '#2a1a48',
    '<polygon points="27,4 17,20 13,17" fill="FILL" stroke="#120a20" stroke-width="1" stroke-linejoin="round"/>' +
    '<line x1="14" y1="18" x2="5" y2="27" stroke="#3a2a1a" stroke-width="2.6" stroke-linecap="round"/>' +
    '<path d="M8 9 l1 2 l2 1 l-2 1 l-1 2 l-1-2 l-2-1 l2-1Z" fill="#d8c8ff"/>'),
  furia_magec: sbIcon('Fm', '#ffd040', '#ffffff', '#ffa020',
    '<circle cx="16" cy="16" r="6.5" fill="FILL" stroke="#8a4a00" stroke-width="1"/>' +
    '<g stroke="#ffc020" stroke-width="2" stroke-linecap="round"><line x1="16" y1="2" x2="16" y2="6.5"/><line x1="16" y1="25.5" x2="16" y2="30"/><line x1="2" y1="16" x2="6.5" y2="16"/><line x1="25.5" y1="16" x2="30" y2="16"/>' +
    '<line x1="6" y1="6" x2="9.2" y2="9.2"/><line x1="22.8" y1="22.8" x2="26" y2="26"/><line x1="26" y1="6" x2="22.8" y2="9.2"/><line x1="9.2" y1="22.8" x2="6" y2="26"/></g>'),
  tormenta_echeyde: sbIcon('Te', '#ff2a00', '#ffd060', '#5a0a04',
    '<path d="M16 4 C25 4 28 11 23 15 C19 18 13 15 15 12 C17 9 21 12 19 14" fill="none" stroke="FILL" stroke-width="3" stroke-linecap="round"/>' +
    '<path d="M16 28 C7 28 4 21 9 17 C13 14 19 17 17 20 C15 23 11 20 13 18" fill="none" stroke="FILL" stroke-width="3" stroke-linecap="round"/>' +
    '<circle cx="16" cy="16" r="2.4" fill="#fff0a0"/>'),
  juicio_teide: sbIcon('Ju', '#5fffe0', '#ffffff', '#1a8a7a',
    '<path d="M2 28 L13 10 L16 13 L19 10 L30 28Z" fill="#4a5a6a" stroke="#0a1a2a" stroke-width="1"/><path d="M11 13 L13 10 L16 13 L19 10 L21 13 L18 14 L16 12.5 L14 14Z" fill="#f4f8ff"/>' +
    '<rect x="14" y="0" width="4" height="14" fill="FILL" opacity=".85"/><circle cx="16" cy="13" r="3" fill="#ffffff"/>'),
});


// Sesión 50 — iconos de teletransporte (portal del color de la ciudad) y alquimia
function teleIcon(id, color, glyph) {
  return '<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg"><defs>' +
    '<radialGradient id="sbT' + id + '" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#ffffff"/><stop offset=".45" stop-color="' + color + '"/><stop offset="1" stop-color="#2a1a48"/></radialGradient></defs>' +
    '<circle cx="16" cy="16" r="13" fill="url(#sbT' + id + ')" stroke="#120a20" stroke-width="1.2"/>' +
    '<path d="M16 5 a11 11 0 0 1 11 11" fill="none" stroke="#e8d8ff" stroke-width="1.4" stroke-linecap="round" opacity=".8"/>' +
    '<path d="M16 27 a11 11 0 0 1 -11 -11" fill="none" stroke="#e8d8ff" stroke-width="1.4" stroke-linecap="round" opacity=".8"/>' +
    '<text x="16" y="20.5" text-anchor="middle" font-family="serif" font-weight="bold" font-size="12" fill="#1a0a2a">' + glyph + '</text></svg>';
}
const TELE_ICONS = {
  tele_orotava: ['#4a8a30', 'O'], tele_icod: ['#6a4828', 'I'], tele_vilaflor: ['#c8a043', 'V'], tele_cristianos: ['#6090c0', 'C'],
  tele_guimar: ['#e8a448', 'G'], tele_santacruz: ['#a08070', 'S'], tele_adeje: ['#5aaa3a', 'A'], tele_esperanza: ['#c0d0e0', 'E'],
  tele_izana: ['#7090d0', '★'], tele_canadas: ['#c8d8e8', '▲'], tele_guajara: ['#8a8a8a', '⛏'], tele_faro: ['#c0d8e8', 'F'], tele_teno: ['#8a2a2a', '☠'],
};
for (const [k, [c, g]] of Object.entries(TELE_ICONS)) SVG[k] = teleIcon(k, c, g);
function alchIcon(id, flame) {
  return '<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg"><defs>' +
    '<radialGradient id="sbA' + id + '" cx="40%" cy="35%" r="65%"><stop offset="0" stop-color="#fff6b0"/><stop offset=".6" stop-color="#e8b830"/><stop offset="1" stop-color="#8a5a00"/></radialGradient></defs>' +
    '<path d="M16 3 C19 8 24 10 23 17 a7 7 0 0 1 -14 0 C8 11 13 9 16 3Z" fill="' + flame + '" opacity=".85"/>' +
    '<circle cx="16" cy="21" r="8" fill="url(#sbA' + id + ')" stroke="#5a3a00" stroke-width="1.1"/>' +
    '<text x="16" y="25" text-anchor="middle" font-family="serif" font-weight="bold" font-size="10" fill="#6a4000">$</text></svg>';
}
SVG.alquimia_baja = alchIcon('b', '#4ad04a');
SVG.alquimia_alta = alchIcon('a', '#ff7a20');

// Espejo de SPELLS de server/magic.js (lo que la UI necesita).
// Sesión 50 — ordenado por nivel. self:true = se lanza sobre ti al tocarlo (no autocast).
const SPELLBOOK = [
  { id: 'fire_strike',      name: 'Rayo de fuego',         level: 1,  mana: 10, desc: 'Bola de fuego básica.' },
  { id: 'chorro_mar',       name: 'Chorro del Atlántico',  level: 8,  mana: 8,  desc: 'Agua a presión. Barato y rápido.' },
  { id: 'sanacion',         name: 'Sanación de Chaxiraxi', level: 15, mana: 18, self: true, desc: 'Te curas 8 + nivel/4 de vida. Recarga 25 s.' },
  { id: 'ice_spear',        name: 'Lanza de hielo',        level: 20, mana: 9,  desc: 'Lanza de hielo certera.' },
  { id: 'escudo_lava',      name: 'Escudo de lava',        level: 25, mana: 20, self: true, desc: '-40 % de daño recibido durante 12 s. Recarga 40 s.' },
  { id: 'entangle',         name: 'Enredar',               level: 35, mana: 12, desc: 'Raíces que atan al enemigo 10 s.' },
  { id: 'thunderbolt',      name: 'Rayo',                  level: 40, mana: 14, desc: 'Descarga eléctrica.' },
  { id: 'aliento_guayota',  name: 'Aliento de Guayota',    level: 45, mana: 16, desc: 'Te curas la mitad del daño que haces.' },
  { id: 'erupcion',         name: 'Erupción del Teide',    level: 50, mana: 22, desc: 'Salpica a 3 enemigos cercanos (60 %).' },
  { id: 'lanza_obsidiana',  name: 'Lanza de obsidiana',    level: 55, mana: 18, desc: 'Gran daño a un objetivo.' },
  { id: 'furia_magec',      name: 'Furia de Magec',        level: 70, mana: 26, desc: 'El sol de los guanches cae sobre tu enemigo.' },
  { id: 'tormenta_echeyde', name: 'Tormenta de Echeyde',   level: 80, mana: 34, desc: 'Arrasa a 5 enemigos cercanos (75 %).' },
  { id: 'juicio_teide',     name: 'Juicio del Teide',      level: 90, mana: 32, desc: 'El hechizo más poderoso de la isla.' },
  // Utilidad (como OSRS): teletransportes y alquimia. No necesitan bastón.
  { id: 'tele_orotava',    name: 'Teletransporte a La Orotava',   level: 6,  mana: 8,  tele: true, desc: 'Te lleva a La Orotava.' },
  { id: 'tele_icod',       name: 'Teletransporte a Icod',         level: 12, mana: 9,  tele: true, desc: 'Te lleva a Icod de los Vinos.' },
  { id: 'tele_vilaflor',   name: 'Teletransporte a Vilaflor',     level: 18, mana: 10, tele: true, desc: 'Te lleva a Vilaflor.' },
  { id: 'alquimia_baja',   name: 'Alquimia menor',                level: 21, mana: 10, alch: true, desc: 'Convierte un objeto en monedas (40 % de su valor).' },
  { id: 'tele_cristianos', name: 'Teletransporte a Los Cristianos', level: 27, mana: 11, tele: true, desc: 'Te lleva a Los Cristianos.' },
  { id: 'tele_guimar',     name: 'Teletransporte a Güímar',       level: 33, mana: 12, tele: true, desc: 'Te lleva a Güímar.' },
  { id: 'tele_santacruz',  name: 'Teletransporte a Santa Cruz',   level: 39, mana: 13, tele: true, desc: 'Te lleva a Santa Cruz.' },
  { id: 'tele_adeje',      name: 'Teletransporte a Adeje',        level: 44, mana: 14, tele: true, desc: 'Te lleva a Adeje.' },
  { id: 'tele_esperanza',  name: 'Teletransporte a La Esperanza', level: 51, mana: 15, tele: true, desc: 'Te lleva a La Esperanza.' },
  { id: 'alquimia_alta',   name: 'Alquimia mayor',                level: 55, mana: 15, alch: true, desc: 'Convierte un objeto en monedas (60 % de su valor).' },
  { id: 'tele_izana',      name: 'Teletransporte al Observatorio', level: 58, mana: 16, tele: true, desc: 'Te lleva al Observatorio de Izaña.' },
  { id: 'tele_canadas',    name: 'Teletransporte a Las Cañadas',  level: 64, mana: 17, tele: true, desc: 'Te lleva a Las Cañadas.' },
  { id: 'tele_guajara',    name: 'Teletransporte a la Mina de Guajara', level: 68, mana: 18, tele: true, desc: 'Te lleva a la Mina de Guajara.' },
  { id: 'tele_faro',       name: 'Teletransporte al Faro',        level: 75, mana: 19, tele: true, desc: 'Te lleva al Faro de Punta Rasca.' },
  { id: 'tele_teno',       name: 'Teletransporte a Teno ☠',       level: 85, mana: 20, tele: true, desc: 'Te lleva a las Ruinas de Teno, en pleno Malpaís. ¡Peligro!' },
].sort((a, b) => a.level - b.level);

function spellMeta(id) { return SPELLBOOK.find(s => s.id === id) || null; }

// ============================================================
// Estado
// ============================================================
let started = false;
let onSelfCast = () => {};
let selfBusy = false;
let getMagicLevel = () => 1;
let getMana = () => ({ current: 0, max: 0 });
let feedLog = () => {};
let onAutocastChange = () => {};   // avisa a combat.js para re-render del tab

let selectedSpellId = null;        // contorno blanco (selección activa)
let autocastSpellId = 'fire_strike'; // hechizo de autocast (se ve en Combate)
let autocastOn = false;            // toggle autocast (se controla en Combate)
let nextCastSpellId = null;        // encolado (pieza 3: cola real)

let injectedButtons = [];
let intervalHandle = null;
let menuEl = null;

// ============================================================
// API pública
// ============================================================
export function start(opts = {}) {
  if (started) stop();
  getMagicLevel    = opts.getMagicLevel    || (() => 1);
  getMana          = opts.getMana          || (() => ({ current: 0, max: 0 }));
  feedLog          = opts.feedLog          || (() => {});
  onAutocastChange = opts.onAutocastChange || (() => {});
  onSelfCast       = opts.onSelfCast       || (() => {});
  onTeleportCast   = opts.onTeleportCast   || (() => {});

  ensureCss();
  if (!injectSpells()) { started = false; return; }
  started = true;
  refreshVisuals();
  intervalHandle = setInterval(refreshVisuals, 500);

  if (typeof window !== 'undefined') {
    window.__spellbook = () => ({ selectedSpellId, autocastSpellId, autocastOn, nextCastSpellId, mana: getMana(), magicLevel: getMagicLevel() });
  }
}

export function stop() {
  if (intervalHandle) { clearInterval(intervalHandle); intervalHandle = null; }
  for (const b of injectedButtons) { try { b.remove(); } catch {} }
  injectedButtons = [];
  closeMenu();
  started = false;
}

// Lo que consume combat.js al atacar.
export function getSelectedSpellId() {
  return autocastOn ? autocastSpellId : null;
}
export function isAutocastOn() { return autocastOn; }
export function getAutocastSpellId() { return autocastSpellId; }
export function getNextCastSpellId() { return nextCastSpellId; }

// SVG + meta del hechizo de autocast (para que el tab de Combate lo dibuje).
export function getAutocastSpellMeta() {
  const m = spellMeta(autocastSpellId);
  if (!m) return null;
  return { ...m, svg: SVG[m.id] || '' };
}
export function getNextCastSpellMeta() {
  const m = nextCastSpellId ? spellMeta(nextCastSpellId) : null;
  return m ? { ...m, svg: SVG[m.id] || '' } : null;
}

// Toggle desde el tab de Combate.
export function toggleAutocast() { setAutocast(!autocastOn); }
export function setAutocast(on) {
  autocastOn = !!on;
  refreshVisuals();
  try { onAutocastChange(); } catch {}
}

// ============================================================
// Inyección
// ============================================================
function injectSpells() {
  const grid = document.getElementById('magicSpellGrid');
  if (!grid) {
    console.warn('[spellbook] #magicSpellGrid no existe — spellbook inerte');
    return false;
  }
  for (const sp of SPELLBOOK) {
    const btn = document.createElement('button');
    btn.className = 'magic-spell-cell spellbook-cell';
    btn.dataset.spellId = sp.id;
    btn.innerHTML =
      '<div class="spellbook-svg">' + (SVG[sp.id] || '') + '</div>';
    btn.title = sp.name + ' — ' + (sp.desc || '');
    // Click izquierdo = seleccionar
    btn.addEventListener('click', (e) => { e.preventDefault(); onSelectSpell(sp.id); });
    // Click derecho (PC) = menú
    btn.addEventListener('contextmenu', (e) => { e.preventDefault(); openMenu(sp.id, e.clientX, e.clientY); });
    // Long press (móvil) = menú
    attachLongPress(btn, sp.id);
    grid.appendChild(btn);
    injectedButtons.push(btn);
  }
  return true;
}

function attachLongPress(btn, spellId) {
  let timer = null;
  let startXY = null;
  const LONG_MS = 450;
  const onDown = (e) => {
    const t = e.touches ? e.touches[0] : e;
    startXY = { x: t.clientX, y: t.clientY };
    timer = setTimeout(() => {
      timer = null;
      openMenu(spellId, startXY.x, startXY.y);
    }, LONG_MS);
  };
  const cancel = () => { if (timer) { clearTimeout(timer); timer = null; } };
  btn.addEventListener('touchstart', onDown, { passive: true });
  btn.addEventListener('touchend', cancel);
  btn.addEventListener('touchmove', cancel);
  btn.addEventListener('touchcancel', cancel);
}

// Sesión 50 — hechizos sobre ti (Sanación, Escudo de lava)
async function castSelf(sp) {
  if (selfBusy) return;
  selfBusy = true;
  try {
    const r = await api.tradeCall('/api/magic/self', { spell_id: sp.id });
    try { window.__playerPlayAttack?.('accurate', 'staff', 1200, sp.id); } catch {}
    if (r.healed > 0) feedLog('info', '💚 ' + sp.name + ': recuperas ' + r.healed + ' de vida.');
    else if (r.shield_until) feedLog('info', '🛡️ ' + sp.name + ': recibes un 40 % menos de daño durante 12 s.');
    else feedLog('info', '✨ ' + sp.name + '.');
    try { onSelfCast(r); } catch {}
  } catch (e) {
    feedLog('warning', e?.message || 'No puedes lanzar ' + sp.name + ' ahora.');
  } finally { selfBusy = false; }
}

// Sesión 50 — teletransportes y alquimia
let onTeleportCast = () => {};
async function castUtility(sp, slot) {
  if (selfBusy) return;
  selfBusy = true;
  try {
    const r = await api.tradeCall('/api/magic/utility', slot == null ? { spell_id: sp.id } : { spell_id: sp.id, slot });
    try { window.__playerPlayAttack?.('accurate', 'staff', 1300, sp.id); } catch {}
    if (r.kind === 'teleport') { try { onTeleportCast(r); } catch {} }
    else {
      feedLog('info', '💰 ' + sp.name + ': ' + r.item_name + ' → ' + r.coins + ' monedas.');
      try { await window.inventory?.refresh?.(); } catch {}
    }
  } catch (e) {
    feedLog('warning', e?.message || 'No puedes lanzar ' + sp.name + ' ahora.');
  } finally { selfBusy = false; }
}
// Alquimia: elegir qué objeto de la mochila convertir
async function pickItemForAlch(sp) {
  let inv = [];
  try { inv = (await api.tradeCall('/api/inventory'))?.slots || []; } catch {}
  const items = inv.filter(x => x && x.item_id && x.item_id !== 'coins');
  if (!items.length) { feedLog('info', 'No tienes nada que convertir.'); return; }
  closeMenu();
  menuEl = document.createElement('div');
  menuEl.className = 'spellbook-menu spellbook-alch';
  menuEl.innerHTML = '<div class="spellbook-menu-title">' + sp.name + ' — ¿qué conviertes?</div>' +
    items.map(x => '<button data-slot="' + x.slot + '">' + (x.icon || '📦') + ' ' + (x.name || x.item_id) + (x.quantity > 1 ? ' ×' + x.quantity : '') + '</button>').join('');
  document.body.appendChild(menuEl);
  menuEl.style.left = Math.max(8, (window.innerWidth - menuEl.offsetWidth) / 2) + 'px';
  menuEl.style.top = Math.max(8, (window.innerHeight - menuEl.offsetHeight) / 2) + 'px';
  menuEl.querySelectorAll('button[data-slot]').forEach(b => b.addEventListener('click', (e) => {
    e.preventDefault(); const slot = Number(b.dataset.slot); closeMenu(); castUtility(sp, slot);
  }));
  setTimeout(() => { document.addEventListener('click', closeMenuOnOutside, { once: true }); }, 0);
}

function onSelectSpell(spellId) {
  const sp = spellMeta(spellId);
  if (!sp) return;
  if (getMagicLevel() < sp.level) {
    feedLog('warning', 'Necesitas nivel ' + sp.level + ' de Magia para ' + sp.name + '.');
    return;
  }
  if (sp.self) { castSelf(sp); return; }
  if (sp.tele) { castUtility(sp); return; }
  if (sp.alch) { pickItemForAlch(sp); return; }
  // Seleccionar = contorno blanco + lo fija como autocast activo (práctico para
  // un juego con auto-ataque: atacar lo repite). El detalle Cast-una-vez vs
  // autocast se afina con la cola (pieza 3) desde el menú.
  selectedSpellId = spellId;
  autocastSpellId = spellId;
  autocastOn = true;
  refreshVisuals();
  try { onAutocastChange(); } catch {}
  feedLog('info', 'Hechizo seleccionado: ' + sp.name + '.');
}

// ============================================================
// Menú contextual (Cast / Autocast / Next cast)
// ============================================================
function openMenu(spellId, x, y) {
  closeMenu();
  const sp = spellMeta(spellId);
  if (!sp) return;
  const locked = getMagicLevel() < sp.level;
  menuEl = document.createElement('div');
  menuEl.className = 'spellbook-menu';
  menuEl.innerHTML =
    '<div class="spellbook-menu-title">' + sp.name + (locked ? ' (Niv ' + sp.level + ')' : '') + '</div>' +
    '<div class="spellbook-menu-desc">' + (sp.desc || '') + '</div>' +
    '<button data-act="cast">Cast</button>' +
    '<div class="spellbook-menu-desc">Nivel ' + sp.level + ' · ' + sp.mana + ' de maná</div>' +
    ((sp.self || sp.tele || sp.alch) ? '' : '<button data-act="autocast">Autocast</button><button data-act="nextcast">Next cast</button>');
  document.body.appendChild(menuEl);
  // posición (clamp a la pantalla)
  const r = menuEl.getBoundingClientRect();
  const px = Math.min(x, window.innerWidth - r.width - 8);
  const py = Math.min(y, window.innerHeight - r.height - 8);
  menuEl.style.left = Math.max(8, px) + 'px';
  menuEl.style.top  = Math.max(8, py) + 'px';

  menuEl.querySelectorAll('button').forEach(b => {
    b.addEventListener('click', (e) => {
      e.preventDefault();
      const act = b.dataset.act;
      if (locked) { feedLog('warning', 'Necesitas nivel ' + sp.level + ' de Magia.'); closeMenu(); return; }
      if (act === 'cast' && sp.self) { castSelf(sp); closeMenu(); return; }
      if (act === 'cast' && sp.tele) { closeMenu(); castUtility(sp); return; }
      if (act === 'cast' && sp.alch) { closeMenu(); pickItemForAlch(sp); return; }
      if (act === 'cast') {
        // Cast (una vez): por ahora = seleccionar + autocast on. La semántica
        // "una sola vez y para" llega con la cola (pieza 3).
        selectedSpellId = spellId; autocastSpellId = spellId; autocastOn = true;
        feedLog('info', 'Lanzar: ' + sp.name + '.');
      } else if (act === 'autocast') {
        selectedSpellId = spellId; autocastSpellId = spellId; autocastOn = true;
        feedLog('info', 'Autocast: ' + sp.name + '.');
      } else if (act === 'nextcast') {
        nextCastSpellId = spellId;
        feedLog('info', 'Next cast encolado: ' + sp.name + '.');
      }
      refreshVisuals();
      try { onAutocastChange(); } catch {}
      closeMenu();
    });
  });

  // cerrar al tocar afuera
  setTimeout(() => {
    document.addEventListener('click', closeMenuOnOutside, { once: true });
    document.addEventListener('touchstart', closeMenuOnOutside, { once: true });
  }, 0);
}
function closeMenuOnOutside(e) {
  if (menuEl && !menuEl.contains(e.target)) closeMenu();
}
function closeMenu() {
  if (menuEl) { try { menuEl.remove(); } catch {} menuEl = null; }
}

// ============================================================
// Visuals
// ============================================================
function refreshVisuals() {
  const lvl = getMagicLevel();
  for (const btn of injectedButtons) {
    const sp = spellMeta(btn.dataset.spellId);
    if (!sp) continue;
    const locked = lvl < sp.level;
    btn.classList.toggle('locked', locked);
    // contorno blanco = el hechizo seleccionado
    btn.classList.toggle('selected', sp.id === selectedSpellId);
    // marca tenue para el next cast encolado
    btn.classList.toggle('queued', sp.id === nextCastSpellId);
  }
  // HUD: maná actual debajo de la bota
  try {
    const mana = getMana();
    const hud = document.getElementById('hudManaValue');
    if (hud) hud.textContent = String(mana?.current ?? 0);
  } catch {}
}

// ============================================================
// CSS (sin tocar style.css)
// ============================================================
function ensureCss() {
  if (document.getElementById('spellbook-css')) return;
  const css = document.createElement('style');
  css.id = 'spellbook-css';
  css.textContent = [
    /* Sesión 50 — libro estilo OSRS: rejilla densa de iconos, con scroll */
    '.osrs-tab-pane[data-tab="magic"]{overflow-y:auto!important;-webkit-overflow-scrolling:touch}',
    '#magicSpellGrid{grid-template-columns:repeat(5,1fr)!important;gap:2px!important}',
    '#magicSpellGrid > *{min-width:0}',
    '.spellbook-cell{position:relative;display:flex;align-items:center;justify-content:center;aspect-ratio:1/1;padding:2px;cursor:pointer;background:transparent;border:none;border-radius:6px}',
    '.spellbook-cell .spellbook-svg{width:88%;max-width:34px;aspect-ratio:1/1;filter:drop-shadow(0 1px 1px rgba(0,0,0,.8));transition:transform .12s}',
    '.spellbook-cell:active .spellbook-svg{transform:scale(1.15)}',
    '.spellbook-cell.selected .spellbook-svg{animation:sbPulse 1.4s ease-in-out infinite}',
    '@keyframes sbPulse{50%{filter:drop-shadow(0 0 6px rgba(255,240,180,.9))}}',
    '.spellbook-cell .spellbook-svg svg{width:100%;height:100%;display:block}',
    '.spellbook-cell .spellbook-meta{font-size:10px;opacity:0.78}',
    /* contorno blanco estilo OSRS */
    '.spellbook-cell.selected{outline:2px solid #ffffff;box-shadow:0 0 0 1px #000,0 0 6px rgba(255,255,255,0.5) inset;background:rgba(255,255,255,0.08)}',
    '.spellbook-cell.queued{outline:1px dashed rgba(255,255,255,0.55)}',
    '.spellbook-cell.locked{opacity:0.35;filter:grayscale(1) brightness(.7)}',
    '.spellbook-alch{max-height:70vh;overflow-y:auto}',
    /* menú contextual */
    '.spellbook-menu{position:fixed;z-index:9999;background:#1a1f2e;border:1px solid #3a4a6a;border-radius:8px;padding:4px;min-width:128px;box-shadow:0 6px 20px rgba(0,0,0,0.5)}',
    '.spellbook-menu-desc{font-size:11px;opacity:.75;padding:2px 8px 6px;max-width:200px}',
    '.spellbook-menu-title{font-size:12px;font-weight:700;padding:4px 8px;opacity:0.85;border-bottom:1px solid #2a3550;margin-bottom:4px}',
    '.spellbook-menu button{display:block;width:100%;text-align:left;padding:8px 10px;background:transparent;border:none;color:#f0e6d2;font-size:13px;cursor:pointer;border-radius:6px}',
    '.spellbook-menu button:hover,.spellbook-menu button:active{background:#2d6cff}',
  ].join('\n');
  document.head.appendChild(css);
}
