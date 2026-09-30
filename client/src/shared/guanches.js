/**
 * SebasPresent — Los guanches (Sesión 50)
 *
 * MÓDULO COMPARTIDO cliente + servidor.
 * Los hijos de Achamán: el pueblo antiguo de Achinech. Viven como sus
 * antepasados en el poblado de Chinamada: casas de piedra seca, cabras,
 * tamarcos de piel y lanzas de madera endurecida al fuego (banot).
 * Desconfían de los forasteros y odian al Cabildo; defienden su tierra:
 *   Guerrero guanche (banot, cuerpo a cuerpo) · Hondero (lanza piedras,
 *   proyectiles) · Faycán (sacerdote, invoca a Magec: magia) · Mencey
 *   (el jefe del poblado, cuerpo a cuerpo fuerte).
 */

export const POBLADO = { name: 'Poblado de Chinamada', x: -620, z: 140, r: 34 };

// Casas de piedra seca [x, z, radio] (el jugador no las atraviesa)
export const HUTS = [
  [-632, 124, 3.2], [-604, 128, 3.0], [-640, 154, 3.4], [-600, 158, 2.8], [-618, 172, 3.0], [-648, 136, 2.6],
];
// Tagoror: círculo de piedras donde se reúne el consejo
export const TAGOROR = { x: -619, z: 144, r: 5.5 };
// Corral de cabras
export const CORRAL = { x: -590, z: 110, r: 7 };

export const GUANCHE_MOBS = {
  guanche_guerrero: { name: 'Guerrero guanche', hp: 32, att: 30, str: 28, def: 22, max: 5, speed: 4, range: 1.6, style: 'melee', aggro: 6, respawn: 40000, n: 7 },
  guanche_hondero:  { name: 'Hondero guanche',  hp: 24, att: 30, str: 20, def: 16, max: 4, speed: 4, range: 9,   style: 'ranged', aggro: 8, respawn: 40000, n: 4 },
  guanche_faycan:   { name: 'Faycán',           hp: 28, att: 34, str: 20, def: 18, max: 5, speed: 5, range: 8,   style: 'magic',  aggro: 7, respawn: 50000, n: 2 },
  guanche_mencey:   { name: 'Mencey de Chinamada', hp: 80, att: 42, str: 40, def: 34, max: 9, speed: 5, range: 1.8, style: 'melee', aggro: 5, respawn: 120000, n: 1 },
  cabra:            { name: 'Cabra',            hp: 6,  att: 1,  str: 1,  def: 1,  max: 1, speed: 4, range: 1.2, style: 'melee', aggro: 0, respawn: 20000, n: 7, passive: true },
};

export function hitsHut(x, z, pad = 0) {
  for (const [hx, hz, r] of HUTS) if (Math.hypot(x - hx, z - hz) < r + pad) return true;
  return false;
}
