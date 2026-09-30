/**
 * SebasPresent — La Fosa de Guayota (minijuego de oleadas, estilo Fight Caves) · Sesión 50
 *
 * MÓDULO COMPARTIDO cliente + servidor.
 *
 * Hablas con Kargath (el Guardián) a la entrada y bajas a la Fosa. Llegan
 * oleadas de criaturas de lava; cada una tiene su estilo:
 *   Diablillo (cuerpo a cuerpo) · Escupefuego (proyectiles) · Espíritu ígneo
 *   (magia) · Bruto de magma (cuerpo a cuerpo fuerte).
 * Usa la protección correcta contra cada una. En la última ronda aparece
 * GUAYOTA: antes de cada ataque BRILLA en VERDE (proyectiles) o AZUL (magia)
 * — cambia tu protección a tiempo.
 *
 * Si mueres dentro NO pierdes objetos: te sacan fuera con la vida llena.
 * Premios: monedas cada 3 rondas superadas y, al vencer a Guayota, la
 * CAPA DE FUEGO.
 */

export const FOSA = {
  x: 1860, z: -340, r: 19,                  // arena
  entrance: { x: 1860, z: -309 },           // donde te deja al salir
  guard: { id: 'kargath', x: 1864, z: -306 },
  bank: { x: 1852, z: -304 },
};
export const FOSA_TALK_DIST_M = 9;          // server (posición con algo de retraso)

export const FOSA_MOBS = {
  fosa_diablillo: { name: 'Diablillo de lava',  hp: 22, att: 40, def: 25, style: 'melee',  range: 2.4, max: 7,  every: 2400, speed: 3.0, h: 1.2 },
  fosa_escupefuego: { name: 'Escupefuego',      hp: 30, att: 48, def: 30, style: 'ranged', range: 11,  max: 10, every: 3000, speed: 2.4, h: 1.4 },
  fosa_espiritu:  { name: 'Espíritu ígneo',     hp: 34, att: 52, def: 34, style: 'magic',  range: 11,  max: 12, every: 3000, speed: 2.4, h: 1.8 },
  fosa_bruto:     { name: 'Bruto de magma',     hp: 60, att: 55, def: 45, style: 'melee',  range: 2.8, max: 15, every: 3000, speed: 2.2, h: 2.6 },
  fosa_ignaroth:  { name: 'Guayota',           hp: 250, att: 70, def: 60, style: 'jad',   range: 13,  max: 40, every: 4200, speed: 1.6, h: 5.2, telegraphMs: 1700 },
};

// Rondas (12). Cada entrada = lista de tipos.
export const FOSA_WAVES = [
  ['fosa_diablillo', 'fosa_diablillo'],
  ['fosa_diablillo', 'fosa_diablillo', 'fosa_diablillo'],
  ['fosa_escupefuego', 'fosa_diablillo', 'fosa_diablillo'],
  ['fosa_escupefuego', 'fosa_escupefuego'],
  ['fosa_espiritu', 'fosa_diablillo', 'fosa_diablillo'],
  ['fosa_espiritu', 'fosa_escupefuego', 'fosa_diablillo'],
  ['fosa_bruto', 'fosa_diablillo', 'fosa_diablillo'],
  ['fosa_espiritu', 'fosa_espiritu', 'fosa_escupefuego'],
  ['fosa_bruto', 'fosa_espiritu', 'fosa_escupefuego'],
  ['fosa_bruto', 'fosa_bruto', 'fosa_espiritu'],
  ['fosa_espiritu', 'fosa_espiritu', 'fosa_escupefuego', 'fosa_escupefuego'],
  ['fosa_ignaroth'],
];
export const FOSA_WAVE_DELAY_MS = 4000;     // pausa entre rondas

// Premios al superar la ronda N (se entregan al momento, a la mochila o al suelo)
export const FOSA_REWARDS = {
  3: { coins: 1500 },
  6: { coins: 4000 },
  9: { coins: 8000 },
  12: { coins: 20000, item: 'cape_fuego' },
};

export function insideFosa(x, z, pad = 0) {
  return Math.hypot(x - FOSA.x, z - FOSA.z) <= FOSA.r + pad;
}
