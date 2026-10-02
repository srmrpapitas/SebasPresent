/**
 * SebasPresent — Zonas de caza y Bestiario (Sesión 51)
 *
 * Los monstruos ya no están esparcidos por todo el mapa: viven agrupados en
 * zonas con nombre. Cada zona dice qué criaturas hay, cuántas, y cómo llegar.
 * Lo usan:
 *   - el servidor / la semilla (dónde se crean los monstruos),
 *   - el Bestiario (libro con todas las criaturas y dónde encontrarlas),
 *   - el mapa (icono de espadas cruzadas en cada zona),
 *   - las misiones (pista hacia la zona si no hay ninguno cerca).
 *
 * Las criaturas de cuevas, jefes, el poblado guanche y la Fosa no están aquí:
 * siguen en sus sitios de siempre (ver BEAST_EXTRA_PLACES y BEAST_CAVES).
 * Los monstruos de cada zona los crea server/seeds/021_hunting_zones_s51.sql
 * (generado a partir de esta lista: si cambias una zona, regenera la semilla).
 */

export const HUNTING_ZONES = [
  // ---------------- Isla (fuera del Malpaís) ----------------
  { id: 'granja_aguere', name: 'Granja de Aguere', x: -60, z: 225, r: 34,
    mobs: [['chicken', 12], ['cow', 10]],
    how: 'Unos 220 m al sur de la plaza de La Laguna, saliendo por el camino de Vilaflor.' },
  { id: 'campos_ratas', name: 'Campos de las ratas', x: 215, z: -120, r: 32,
    mobs: [['rat', 16], ['rat_jefe', 1]],
    how: 'Justo al este de La Laguna, en los sembrados. La Rata colosal ronda por el centro.' },
  { id: 'huertas_vilaflor', name: 'Huertas de Vilaflor', x: -560, z: 525, r: 30,
    mobs: [['chicken', 8], ['cow', 6]],
    how: 'Al suroeste de Vilaflor, bajando hacia las Charcas de Erjos.' },
  { id: 'pinar_aranas', name: 'Pinar de las arañas', x: -300, z: -480, r: 34,
    mobs: [['spider', 18], ['spider_jefe', 1]],
    how: 'Al sur de La Orotava, entre los pinos. La Araña reina teje en el centro del pinar.' },
  { id: 'guarida_lobos', name: 'Guarida de los lobos', x: -650, z: -1050, r: 36,
    mobs: [['wolf', 16], ['wolf_jefe', 1]],
    how: 'En el bosque del norte: sal de La Orotava hacia el noroeste. El Lobo alfa no caza solo.' },
  { id: 'cerro_jabalies', name: 'Cerro de los jabalíes', x: 450, z: 820, r: 36,
    mobs: [['boar', 16], ['boar_jefe', 1]],
    how: 'En las lomas del Barranco del Infierno, entre Vilaflor y Adeje.' },
  { id: 'dunas_escorpion', name: 'Dunas de los escorpiones', x: 1250, z: -250, r: 38,
    mobs: [['scorpion', 18], ['scorpion_jefe', 1]],
    how: 'En el Malpaís de Güímar (el desierto), al noroeste del pueblo. Cuidado con el Escorpión carmesí.' },
  { id: 'cantera_golem', name: 'Cantera de los gólems', x: 1080, z: -1390, r: 32,
    mobs: [['golem', 12], ['golem_jefe', 1]],
    how: 'Junto a la Mina de Guajara, al oeste de la entrada. El Coloso de Obsidiana duerme al otro lado de la mina.' },
  { id: 'cumbres_yeti', name: 'Cumbres de los yetis', x: -250, z: -1650, r: 36,
    mobs: [['yeti', 16], ['yeti_jefe', 1]],
    how: 'En la nieve del norte, unos 450 m al oeste de Las Cañadas. Lleva comida.' },
  { id: 'bosque_ogros', name: 'Bosque de los ogros', x: 1500, z: -1160, r: 34,
    mobs: [['ogro_anaga', 10], ['ogro_anaga_jefe', 1]],
    how: 'En el monte de Anaga, unos 400 m al norte de Santa Cruz.' },

  // ---------------- El Malpaís (zona salvaje: otros jugadores pueden atacarte) ----------------
  { id: 'campamento_goblin', name: 'Campamento goblin', x: -1110, z: -760, r: 36, wild: 1,
    mobs: [['goblin', 20], ['goblin_jefe', 1]],
    how: 'Malpaís nivel 1. Desde Icod de los Vinos, hacia el noroeste, nada más cruzar al Malpaís.' },
  { id: 'barranco_goblin', name: 'Barranco de los goblins', x: -1130, z: 760, r: 36, wild: 1,
    mobs: [['goblin', 18], ['goblin_jefe', 1]],
    how: 'Malpaís nivel 1, unos 750 m al sur de Santiago del Teide.' },
  { id: 'escondite_bandidos', name: 'Escondite de los bandidos', x: -1360, z: 560, r: 38, wild: 10,
    mobs: [['bandido', 20], ['bandido_jefe', 1]],
    how: 'Malpaís nivel 10. Al oeste del Barranco de los goblins, antes de llegar al Altar de Guayota.' },
  { id: 'ruinas_teno', name: 'Ruinas de Teno', x: -1440, z: -640, r: 38, wild: 10,
    mobs: [['skeleton', 22], ['skeleton_jefe', 1]],
    how: 'Malpaís nivel 10, junto a las Ruinas de Teno (al oeste de Santiago del Teide). Varkhul, el rey esqueleto, vive en las ruinas.' },
  { id: 'cementerio_teno', name: 'Cementerio de Teno', x: -1590, z: -960, r: 38, wild: 30,
    mobs: [['zombi', 22], ['zombi_jefe', 1]],
    how: 'Malpaís nivel 30, al norte de las Ruinas de Teno, camino del Roque Negro. La boca de la Cueva de Echeyde queda al lado.' },
  { id: 'coladas_chinyero', name: 'Coladas del Chinyero', x: -1880, z: 880, r: 38, wild: 50,
    mobs: [['zombi_igneo', 22], ['zombi_igneo_jefe', 1]],
    how: 'Malpaís nivel 50, al sur del Volcán Chinyero, camino de Los Gigantes. Solo para expertos.' },
  { id: 'llanos_ardientes', name: 'Llanos ardientes', x: -1900, z: -800, r: 36, wild: 50,
    mobs: [['zombi_igneo', 18], ['zombi_igneo_jefe', 1]],
    how: 'Malpaís nivel 50, al norte del Volcán Chinyero.' },
];

/** Criaturas que no están en zonas (jefes, cuevas, poblado…): dónde buscarlas. */
export const BEAST_EXTRA_PLACES = {
  guanche_guerrero: 'Poblado de Chinamada, entre Vilaflor e Icod de los Vinos.',
  guanche_hondero: 'Poblado de Chinamada, entre Vilaflor e Icod de los Vinos.',
  guanche_faycan: 'Poblado de Chinamada, entre Vilaflor e Icod de los Vinos.',
  guanche_mencey: 'Poblado de Chinamada: el Mencey preside la plaza.',
  cabra: 'Corrales del Poblado de Chinamada.',
  acolito_cabildo: 'Monte de Las Mercedes, en la guarida del Cabildo (al norte de La Laguna).',
  magister_cabildo: 'Monte de Las Mercedes, al fondo de la guarida del Cabildo.',
  bruja_pantano: 'Charcas de Erjos, al sur del Poblado de Chinamada, en lo más hondo del páramo.',
  coloso_obsidiana: 'Mina de Guajara, al este de la entrada.',
  dragon_negro: 'Malpaís nivel 50, al pie del Roque Negro.',
  dragon_rojo: 'Volcán Chinyero (Malpaís nivel 50).',
  leviatan: 'Costa sur, en el mar frente a Los Cristianos.',
  reina_escorpion: 'Malpaís de Güímar, al sur del pueblo.',
  rey_esqueleto: 'Ruinas de Teno (Malpaís nivel 10).',
  rey_yeti: 'Cumbres de Las Cañadas, entre Las Cañadas y El Teide.',
  bruto_echeyde: 'Al fondo de la Cueva de Echeyde (boca en el Malpaís, junto al Cementerio de Teno).',
  fosa_ignaroth: 'La última oleada de la Fosa de Guayota.',
};

/** Cuevas: además de su zona, estas criaturas viven aquí. */
export const BEAST_CAVES = {
  spider: 'Cueva del Viento (boca junto a Icod de los Vinos).',
  zombi: 'Cueva del Viento (boca junto a Icod de los Vinos).',
  yeti: 'Cueva del Hielo (boca en Las Cañadas).',
  zombi_igneo: 'Cueva de Echeyde (boca en el Malpaís, junto al Cementerio de Teno).',
};

/** Categorías del Bestiario (orden de las pestañas). */
export const BEAST_GROUPS = [
  { id: 'animales', name: 'Animales', ids: ['chicken', 'cow', 'cabra', 'rat', 'rat_jefe', 'boar', 'boar_jefe', 'wolf', 'wolf_jefe', 'spider', 'spider_jefe', 'scorpion', 'scorpion_jefe'] },
  { id: 'criaturas', name: 'Criaturas', ids: ['goblin', 'goblin_jefe', 'golem', 'golem_jefe', 'yeti', 'yeti_jefe', 'ogro_anaga', 'ogro_anaga_jefe'] },
  { id: 'malditos', name: 'No-muertos', ids: ['skeleton', 'skeleton_jefe', 'zombi', 'zombi_jefe', 'zombi_igneo', 'zombi_igneo_jefe', 'bruto_echeyde'] },
  { id: 'gente', name: 'Gente', ids: ['bandido', 'bandido_jefe', 'guanche_guerrero', 'guanche_hondero', 'guanche_faycan', 'guanche_mencey', 'acolito_cabildo'] },
  { id: 'jefes', name: 'Jefes', ids: ['magister_cabildo', 'bruja_pantano', 'coloso_obsidiana', 'reina_escorpion', 'rey_yeti', 'rey_esqueleto', 'leviatan', 'dragon_rojo', 'dragon_negro', 'fosa_ignaroth'] },
];

/** Nivel de combate de un monstruo (misma fórmula que el de los jugadores). */
export function npcCombatLevel(d) {
  if (!d) return 1;
  const hp = d.max_hp || 10, att = d.attack_lvl || 1, str = d.strength_lvl || 1, def = d.defence_lvl || 1;
  return Math.max(1, Math.floor((def + hp) / 4 + (att + str) * 13 / 40));
}

/** Zonas donde vive una criatura. */
export function zonesOf(defId) {
  return HUNTING_ZONES.filter(z => z.mobs.some(([d]) => d === defId));
}

/** Zona más cercana a (x,z) donde vive `defId` (para pistas de misiones). */
export function nearestZoneOf(defId, x = 0, z = 0) {
  let best = null, bd = Infinity;
  for (const zn of zonesOf(defId)) {
    const d = Math.hypot(zn.x - x, zn.z - z);
    if (d < bd) { bd = d; best = zn; }
  }
  return best;
}

/** ¿En qué zona de caza está el punto? */
export function zoneAt(x, z) {
  for (const zn of HUNTING_ZONES) if (Math.hypot(zn.x - x, zn.z - z) <= zn.r + 15) return zn;
  return null;
}
