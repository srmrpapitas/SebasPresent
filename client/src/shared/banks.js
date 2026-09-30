/**
 * SebasPresent — Cofres de banco por el mapa (Sesión 50)
 *
 * Como los bancos de OSRS: en cada ciudad, pueblo, mina y lago hay un cofre
 * donde abrir TU banco (es el mismo en todos). En la wilderness no hay.
 * MÓDULO COMPARTIDO (cliente dibuja; el server podrá validar distancias).
 */
export const BANK_USE_DIST_M = 3.2;

export const BANK_CHESTS = [
  // Zona de inicio
  { id: 'bank_concejo',   name: 'Cofre del Concejo',         x:  -22, z:    10 },
  { id: 'bank_cantera',   name: 'Cofre de la Cantera',        x:   90, z:   -66 },
  { id: 'bank_estanque',  name: 'Cofre del Estanque',         x:  -54, z:  -150 },
  // Ciudades
  { id: 'bank_robledal',  name: 'Banco de Robledal',          x: -278, z:  -694 },
  { id: 'bank_picoblanco',name: 'Banco de Picoblanco',        x:  222, z: -1694 },
  { id: 'bank_solquemado',name: 'Banco de Solquemado',        x: 1522, z:   106 },
  { id: 'bank_verdis',    name: 'Banco de Verdis',            x: 1022, z:  1206 },
  { id: 'bank_sirena',    name: 'Banco de Puerto Sirena',     x: -278, z:  1706 },
  { id: 'bank_marpiedra', name: 'Banco de Marpiedra',         x: 1722, z:  -794 },
  // Pueblos
  { id: 'bank_cruce',     name: 'Cofre de Aldea del Cruce',   x: -384, z:   405 },
  { id: 'bank_cazador',   name: 'Cofre de la Cabaña',         x: -684, z:  -195 },
  { id: 'bank_vientos',   name: 'Cofre del Pueblo de los Vientos', x: 716, z: -1095 },
  { id: 'bank_oasis',     name: 'Cofre del Oasis',            x: 1116, z:   605 },
  { id: 'bank_hondonada', name: 'Cofre de Hondonada Verde',   x:  716, z:  1455 },
  { id: 'bank_faro',      name: 'Cofre del Faro',             x: -784, z:  1405 },
  // Lugares de trabajo
  { id: 'bank_mina',      name: 'Cofre de la Mina Antigua',   x: 1186, z: -1462 },
  { id: 'bank_torre',     name: 'Cofre de la Torre del Mago', x:  416, z:  -896 },
  { id: 'bank_templo',    name: 'Cofre del Templo',           x:   18, z: -1204 },
  { id: 'bank_pantano',   name: 'Cofre de la Laguna',         x: -478, z:   600 },
  { id: 'bank_lago',      name: 'Cofre del Lago de Verdis',   x:  842, z:   880 },
  { id: 'bank_helado',    name: 'Cofre del Lago Helado',      x:  522, z: -1500 },
];

export const BANK_CHESTS_BY_ID = Object.fromEntries(BANK_CHESTS.map(b => [b.id, b]));

export function nearestBankChest(x, z) {
  let best = null, bd = Infinity;
  for (const b of BANK_CHESTS) {
    const d = Math.hypot(b.x - x, b.z - z);
    if (d < bd) { bd = d; best = b; }
  }
  return best ? { ...best, dist: bd } : null;
}
