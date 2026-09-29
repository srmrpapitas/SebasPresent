/**
 * SebasPresent — Fundición y Herrería (Sesión 50)
 *
 * MÓDULO COMPARTIDO cliente + servidor (puro, sin three.js ni D1).
 *   - Dónde están los hornos y yunques (el server valida la distancia).
 *   - Reglas de fundir (mineral → lingote) y XP.
 * Las recetas de herrería (qué pieza, cuántos lingotes, qué nivel) viven en
 * la D1: items.smith_level / bars_required / material / tier. Aquí solo la XP.
 */

// Materiales en orden de tier (ids de la D1: ore_<m>, bar_<m>, helm_<m>...)
export const MATERIALS = ['bronze', 'hierro', 'acero', 'oro', 'obsidiana', 'basaltita', 'teiderio'];

export const MATERIAL_NAMES = {
  bronze: 'Bronce', hierro: 'Hierro', acero: 'Acero', oro: 'Oro',
  obsidiana: 'Obsidiana', basaltita: 'Basaltita', teiderio: 'Teiderio',
};

// Fundir: nivel de Herrería requerido y XP por lingote.
export const SMELT = {
  bronze:    { level: 1,  xp: 6  },
  hierro:    { level: 5,  xp: 13 },
  acero:     { level: 15, xp: 18 },
  oro:       { level: 25, xp: 23 },
  obsidiana: { level: 35, xp: 30 },
  basaltita: { level: 50, xp: 38 },
  teiderio:  { level: 65, xp: 50 },
};

// Forjar: XP por lingote gastado (se multiplica por bars_required).
export const SMITH_XP_PER_BAR = {
  bronze: 13, hierro: 25, acero: 38, oro: 50, obsidiana: 63, basaltita: 75, teiderio: 90,
};

// Estaciones del mundo. id estable (lo manda el cliente; el server comprueba
// que existe y que estás cerca).
export const STATIONS = [
  { id: 'furnace_concejo', type: 'furnace', name: 'Horno del Concejo',   x: 102, z: -74, rotY: -0.6 },
  { id: 'anvil_concejo',   type: 'anvil',   name: 'Yunque del Concejo',  x:  96, z: -80, rotY: 0.9 },
  { id: 'furnace_mina',    type: 'furnace', name: 'Horno de la Mina',    x: 1196, z: -1466, rotY: 3.1 },
  { id: 'anvil_mina',      type: 'anvil',   name: 'Yunque de la Mina',   x: 1204, z: -1470, rotY: 2.4 },
];

export const STATION_USE_DIST_M = 4.0;   // server (cliente usa 3.0)

export function getStation(id) {
  return STATIONS.find(s => s.id === id) || null;
}
