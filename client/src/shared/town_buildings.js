/**
 * SebasPresent — Edificios de los pueblos en los que se entra (19 oct)
 *
 * Por fuera son casas canarias (buildCasa de houses.js) con su cartel; al
 * tocar la puerta entras en una sala montada por código lejos del mapa
 * (room.x, room.z), igual que tu casa. Los vecinos de dentro son habitantes
 * normales (shared/town_npcs.js) colocados en la sala con `inRoom()`: el
 * cliente los ve y les habla como a cualquier otro, y el server, que dentro
 * solo conoce la posición de la puerta (interiors.js la fija al entrar),
 * mide la distancia a la puerta (`door`, ver npcDist).
 *
 * MÓDULO COMPARTIDO cliente + servidor: aquí solo datos y cuentas.
 * dir: hacia dónde mira la fachada (0 = +Z, PI/2 = +X, -PI/2 = −X, PI = −Z).
 */

export const BUILDING_ENTER_M = 5;     // cliente: distancia a la puerta para entrar
export const DOOR_SERVER_SLACK_M = 6;  // server: la posición guardada es la del exterior, cerca de la puerta

export const TOWN_BUILDINGS = [
  {
    id: 'taberna_laguna', kind: 'taberna', town: 'La Laguna',
    name: 'Taberna La Vieja Aguere', sign: ['🍷 TABERNA', 'La Vieja Aguere'],
    x: -82, z: -8, dir: Math.PI / 2, w: 11, d: 8, color: 0xf0e0b0, twoFloors: true,
    room: { x: 14000, z: 14000, W: 14, D: 10 },
  },
  {
    id: 'herreria_santacruz', kind: 'herreria', town: 'Santa Cruz',
    name: 'Herrería del Muelle', sign: ['⚒ HERRERÍA', 'del Muelle'],
    x: 1655, z: -760, dir: Math.PI / 2, w: 10, d: 8, color: 0xe8c8a8,
    room: { x: 14100, z: 14000, W: 12, D: 10 },
  },
  {
    id: 'casa_balcones_orotava', kind: 'casa', town: 'La Orotava',
    name: 'Casa de los Balcones', sign: ['🏛 CASA', 'de los Balcones'],
    x: -314, z: -698, dir: Math.PI / 2, w: 11, d: 8, color: 0xf2ead8, twoFloors: true,
    room: { x: 14200, z: 14000, W: 13, D: 10 },
  },
  {
    id: 'bodega_icod', kind: 'bodega', town: 'Icod de los Vinos',
    name: 'Bodega El Drago', sign: ['🍇 BODEGA', 'El Drago'],
    x: -698, z: -222, dir: 0, w: 10, d: 8, color: 0xe6d2a8,
    room: { x: 14300, z: 14000, W: 13, D: 10 },
  },
];

export const TOWN_BUILDINGS_BY_ID = Object.fromEntries(TOWN_BUILDINGS.map(b => [b.id, b]));

/** Punto delante de la puerta (fuera), en coordenadas del mundo. */
export function doorOf(b, out = 1.7) {
  const k = b.d / 2 + out;
  return { x: b.x + Math.sin(b.dir) * k, z: b.z + Math.cos(b.dir) * k };
}

/** Coordenadas del mundo de un punto de la sala (lx, lz relativos al centro; la puerta de salida está en −Z). */
export function inRoom(id, lx, lz) {
  const b = TOWN_BUILDINGS_BY_ID[id];
  return { x: b.room.x + lx, z: b.room.z + lz, inside: id, door: doorOf(b) };
}

/** ¿En qué sala está este punto? (o null) */
export function buildingAtRoom(x, z) {
  for (const b of TOWN_BUILDINGS) {
    if (Math.abs(x - b.room.x) <= b.room.W / 2 + 3 && Math.abs(z - b.room.z) <= b.room.D / 2 + 3) return b;
  }
  return null;
}
