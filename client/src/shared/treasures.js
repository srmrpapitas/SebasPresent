/**
 * SebasPresent — Tesoros escondidos (Sesión 53). Compartido cliente + servidor.
 *
 * 16 cofres por los rincones de la isla. Cada uno se puede abrir UNA VEZ AL
 * DÍA (día de Canarias, como las diarias). No salen en el mapa: los
 * borrachos de los pueblos cuentan rumores sobre dónde están.
 *   Nivel 1: rincones tranquilos · Nivel 2: dentro de zonas peligrosas o el
 *   Malpaís poco profundo · Nivel 3: lo más hondo del Malpaís.
 */
export const TREASURE_USE_DIST_M = 3.2;
export const TREASURE_VIEW_DIST_M = 90;   // solo se ven de cerca (hay que buscarlos)

export const TREASURES = [
  // ---- Nivel 1 ----
  { id: 'badajoz', name: 'Cofre del Barranco de Badajoz', x: 1280, z: -800, tier: 1,
    rumor: 'En el Barranco de Badajoz, entre Güímar y Santa Cruz, pasan cosas raras… y dicen que alguien escondió allí un cofre.' },
  { id: 'cala_faro', name: 'Cofre de la cala del Faro', x: -760, z: 1820, tier: 1,
    rumor: 'El farero jura que, en la cala que hay al sur del Faro de Punta Rasca, unos piratas enterraron un cofre.' },
  { id: 'punta_anaga', name: 'Cofre de la Punta de Anaga', x: 1930, z: -1000, tier: 1,
    rumor: 'Donde se acaba la isla, al noreste de Santa Cruz, hay un cofre mirando al mar. Lo vio mi primo. Creo.' },
  { id: 'chipeque', name: 'Cofre del Mirador de Chipeque', x: 300, z: -1280, tier: 1,
    rumor: 'Entre la Basílica de Candelaria y Las Cañadas hay un mirador… y algo brillando entre las piedras.' },
  { id: 'garachico', name: 'Cofre del Roque de Garachico', x: -950, z: -1400, tier: 1,
    rumor: 'Al noroeste, justo antes de entrar al Malpaís, hay un roque. Al pie del roque, un cofre. ¡Hic!' },
  { id: 'galletas', name: 'Cofre de la playa de Las Galletas', x: 900, z: 1900, tier: 1,
    rumor: 'En la playa, al sur de Adeje, la marea dejó un cofre. Nadie lo ha abierto porque nadie madruga.' },
  // ---- Nivel 2 ----
  { id: 'fasnia', name: 'Botín de los bandidos de Fasnia', x: 802, z: 284, tier: 2,
    rumor: 'Los bandidos de las Cuevas de Fasnia guardan su botín en el fondo de la cueva. Ve armado.' },
  { id: 'panteon', name: 'Cofre del panteón de Arico', x: 1772, z: 716, tier: 2,
    rumor: 'En el Cementerio viejo de Arico hay un panteón con un cofre. Los muertos no lo vigilan… o sí.' },
  { id: 'barranco', name: 'Cofre del Barranco del Infierno', x: 744, z: 718, tier: 2,
    rumor: 'Al fondo del Barranco del Infierno, entre los esqueletos, hay un cofre que nadie se atreve a abrir.' },
  { id: 'cumbre_anaga', name: 'Cofre de la cumbre de Anaga', x: 1792, z: -1812, tier: 2,
    rumor: 'En los Altos nevados de Anaga, donde viven los yetis, hay un cofre helado. Lleva comida.' },
  { id: 'cantera', name: 'Cofre de la Cantera helada', x: -748, z: -1812, tier: 2,
    rumor: 'Los gólems de la Cantera helada no dejan que nadie se lleve su cofre. Bueno, son lentos.' },
  { id: 'atalaya_teno', name: 'Cofre de la Atalaya de Teno', x: -1300, z: -1300, tier: 2,
    rumor: 'En el Malpaís, al norte de las Ruinas de Teno, hay una atalaya vieja con un cofre. Ojo con otros jugadores.' },
  { id: 'masca', name: 'Cofre del Barranco de Masca', x: -1350, z: 1300, tier: 2,
    rumor: 'Bajando por el Malpaís hacia Masca, al oeste del Faro, hay un cofre entre los riscos.' },
  // ---- Nivel 3 ----
  { id: 'roque_negro', name: 'Cofre del Roque Negro', x: -1800, z: -1300, tier: 3,
    rumor: 'Cerca del Roque Negro, donde anida el dragón, hay un cofre lleno de escamas. Nadie ha vuelto para contarlo.' },
  { id: 'chinyero', name: 'Cofre de la boca vieja del Chinyero', x: -1850, z: -300, tier: 3,
    rumor: 'Al norte del Volcán Chinyero hay una boca vieja apagada. Dentro, dicen, un cofre de teiderio.' },
  { id: 'guios', name: 'Cofre de la playa de Los Guíos', x: -1850, z: 1850, tier: 3,
    rumor: 'En la punta suroeste del Malpaís, bajo los acantilados de Los Gigantes, hay una playa con un cofre.' },
];
export const TREASURES_BY_ID = Object.fromEntries(TREASURES.map(t => [t.id, t]));

// Premios: monedas + UNA cosa de la lista del nivel (peso, cantidad mín–máx)
export const TREASURE_LOOT = {
  1: { coins: [300, 900], items: [
    ['tele_faro', 6, 2, 3], ['tele_sirena', 6, 2, 3], ['tele_torre', 6, 2, 3], ['tele_cruce', 6, 2, 3],
    ['swordfish', 10, 2, 3], ['pocion_ataque_2', 8, 1, 1], ['hierba_retama', 10, 3, 6], ['bar_hierro', 8, 2, 3],
    ['cowhide', 6, 2, 3], ['big_bones', 6, 2, 4] ] },
  2: { coins: [1200, 3000], items: [
    ['shark', 14, 2, 4], ['pocion_plegaria_3', 12, 1, 2], ['super_ataque_2', 8, 1, 1], ['super_fuerza_2', 8, 1, 1],
    ['bar_oro', 8, 2, 3], ['ore_oro', 8, 3, 5], ['maple_logs', 8, 2, 3], ['tela_seda', 8, 3, 6], ['big_bones', 10, 4, 8] ] },
  3: { coins: [4000, 9000], items: [
    ['escama_dragon', 14, 2, 3], ['bar_teiderio', 12, 1, 2], ['super_defensa_3', 10, 1, 1], ['super_fuerza_3', 10, 1, 1],
    ['magic_logs', 10, 2, 4], ['ore_teiderio', 10, 1, 2], ['pocion_magia_3', 10, 1, 1], ['super_bones', 2, 1, 1] ] },
};
