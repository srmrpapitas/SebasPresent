/**
 * SebasPresent — Tabletas de teletransporte (Sesión 50)
 *
 * Como las tablets de OSRS: se compran en la tienda de magia (Morgana, en el
 * La Laguna, o Eldric en el Observatorio de Izaña), y al ROMPERLAS te llevan al lugar.
 * No piden nivel. No funcionan en lo profundo de la wilderness.
 * MÓDULO COMPARTIDO (el server decide el destino, el cliente solo lo pide).
 */
export const WILDERNESS_X = -1024;
export const TELEPORT_WILD_LIMIT_X = -1229;   // más al oeste de esto, no se puede (≈ nivel 20 de wilderness)
export const TABLET_CAST_MS = 1400;

export const TABLETS = {
  tele_concejo:    { name: 'La Laguna',     x:    4, z:   -4, color: '#e8c560', quest: null },
  tele_robledal:   { name: 'La Orotava',            x: -280, z: -682, color: '#4a8a30', quest: 'aranas_robledal' },
  tele_cazador:    { name: 'Icod de los Vinos',  x: -686, z: -184, color: '#6a4828', quest: 'aullidos' },
  tele_cruce:      { name: 'Vilaflor',     x: -390, z:  396, color: '#c8a043', quest: 'guiso_abuela' },
  tele_faro:       { name: 'Faro de Punta Rasca',        x: -786, z: 1396, color: '#c0d8e8', quest: 'faro_apagado' },
  tele_sirena:     { name: 'Los Cristianos',       x: -286, z: 1694, color: '#6090c0', quest: null },
  tele_torre:      { name: 'Observatorio de Izaña',      x:  404, z: -884, color: '#7090d0', quest: 'mago_huesos' },
  tele_picoblanco: { name: 'Las Cañadas',          x:  210, z: -1676, color: '#c8d8e8', quest: 'encargo_herrera' },
  tele_vientos:    { name: 'La Esperanza', x: 712, z: -1078, color: '#c0d0e0', quest: 'bestia_blanca' },
  tele_mina:       { name: 'Mina de Guajara',        x: 1184, z: -1448, color: '#8a8a8a', quest: 'golems_mina' },
  tele_solquemado: { name: 'Güímar',          x: 1504, z:   92, color: '#e8a448', quest: 'escorpiones' },
  tele_verdis:     { name: 'Adeje',              x: 1012, z: 1196, color: '#5aaa3a', quest: null },
  tele_marpiedra:  { name: 'Santa Cruz',           x: 1712, z: -788, color: '#a08070', quest: null },
  // Wilderness (peligroso, como en OSRS)
  tele_ruinas:     { name: 'Ruinas de Teno ☠',  x: -1490, z: -492, color: '#8a2a2a', quest: null, wild: true },
};

export const isTablet = (id) => Object.prototype.hasOwnProperty.call(TABLETS, id);
