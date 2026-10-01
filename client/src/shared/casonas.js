/**
 * SebasPresent — Casonas del banco (Sesión 50)
 *
Casonas canarias procedurales (mismo estilo que las urbanizaciones de Nauzet, houses.js) con un
 * banquero en la puerta: Banco, Mercado (GE) y Tienda. Los banqueros son
 * habitantes normales (shared/town_npcs.js, acciones bank/ge/shop).
 *
 * dir: hacia dónde mira la fachada (radianes, 0 = +Z, PI = −Z).
 */
export const CASONAS = [
  { id: 'casona_sancris',  name: 'Casona del banco de Santa Cruz',     x: 1620, z: -720, dir: Math.PI, banker: 'banquera_dacil' },
  { id: 'casona_adeje',    name: 'Casona del banco de Adeje',          x: 1080, z: 1130, dir: 0,       banker: 'banquero_acaymo' },
  { id: 'casona_cristianos', name: 'Casona del banco de Los Cristianos', x: -220, z: 1640, dir: 0,     banker: 'banquera_cathaysa' },
];
export const CASONA_BANK_R = 16;
export const CASONA_W = 12, CASONA_D = 9;
/** Dónde se pone el banquero: delante de la puerta. */
export function bankerSpot(c) {
  const k = CASONA_D / 2 + 1.0;   // detrás del mostrador
  return { x: c.x + Math.sin(c.dir) * k, z: c.z + Math.cos(c.dir) * k, rotY: c.dir };
}
