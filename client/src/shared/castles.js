/**
 * SebasPresent — Castillos de la isla (Sesión 50)
 * Copias del castillo de La Laguna (castle.js, mismo GLB). Cada uno tiene un
 * banquero dentro con Banco / Mercado (GE) / Tienda. Se entra andando por la
 * puerta: no hay teletransporte, así que la posición del server es real.
 *
 * rotDeg: la puerta está en el muro -Z local. 0 → la puerta mira al norte
 * (-Z del mundo), 180 → al sur (+Z). Solo usamos 0/180.
 */
export const CASTLES = [
  { id: 'castillo_laguna',   name: 'Castillo de La Laguna',        x:  -80, z:  -80, rotDeg: 0,   banker: 'Gerardo' },
  { id: 'castillo_sancris',  name: 'Castillo de San Cristóbal',    x: 1620, z: -720, rotDeg: 0,   banker: 'Dácil' },
  { id: 'casa_fuerte_adeje', name: 'Casa Fuerte de Adeje',         x: 1080, z: 1130, rotDeg: 180, banker: 'Acaymo' },
  { id: 'fortaleza_cristianos', name: 'Fortaleza de Los Cristianos', x: -220, z: 1640, rotDeg: 180, banker: 'Cathaysa' },
];
export const CASTLE_BANK_R = 16;   // server: estás dentro del castillo
