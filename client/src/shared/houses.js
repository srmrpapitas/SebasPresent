/**
 * SebasPresent — Casas de jugador (Sesión 50)
 *
 * Cada jugador puede comprar SU casa a Nauzet, el agente inmobiliario de La
 * Laguna. Se entra por cualquier "urbanización" de la isla (casitas canarias
 * blancas con la puerta verde) y se sale por el mismo sitio.
 *
 * Por dentro la casa vive lejos del mapa (HOUSE_CENTER). El cliente NO manda
 * su posición mientras está dentro, así que el server te ve en la puerta de
 * la urbanización: por eso cama/cofre/altar se validan "junto a una
 * urbanización + tu casa tiene ese mueble".
 */
export const HOUSE_TIERS = {
  cueva:   { id: 'cueva',   rank: 1, name: 'Casa cueva',     price: 5000,   w: 10, d: 9,  features: ['cama'],
             blurb: 'Excavada en la roca, como las de Chinamada. Fresquita en verano. Tiene cama.' },
  terrera: { id: 'terrera', rank: 2, name: 'Casa terrera',   price: 30000,  w: 14, d: 11, features: ['cama', 'cofre'],
             blurb: 'Casa baja de piedra con patio. Cama y cofre del banco.' },
  casona:  { id: 'casona',  rank: 3, name: 'Casona canaria', price: 120000, w: 18, d: 14, features: ['cama', 'cofre', 'altar'],
             blurb: 'Con balcón de tea y patio. Cama, cofre del banco y altar de Chaxiraxi.' },
};
export const HOUSE_TIER_LIST = ['cueva', 'terrera', 'casona'];

export function houseHas(tierId, feature) {
  return !!HOUSE_TIERS[tierId]?.features.includes(feature);
}
/** Lo que cuesta pasar de `from` (o nada) a `to`. */
export function upgradeCost(from, to) {
  const T = HOUSE_TIERS[to];
  if (!T) return null;
  const F = from ? HOUSE_TIERS[from] : null;
  if (F && F.rank >= T.rank) return null;
  return T.price - (F ? F.price : 0);
}

// Urbanizaciones: la casita con el cartel es la puerta a tu casa (portal).
// dir: hacia dónde mira la fachada (radianes, 0 = +Z).
export const HOUSE_PORTALS = [
  { id: 'urb_laguna',     name: 'Urbanización de La Laguna',      x:   60, z:   60, dir: Math.PI },
  { id: 'urb_orotava',    name: 'Urbanización de La Orotava',     x: -340, z: -620, dir: 0 },
  { id: 'urb_guimar',     name: 'Urbanización de Güímar',         x: 1540, z:  160, dir: Math.PI },
  { id: 'urb_adeje',      name: 'Urbanización de Adeje',          x:  920, z: 1270, dir: 0 },
  { id: 'urb_cristianos', name: 'Urbanización de Los Cristianos', x: -360, z: 1620, dir: 0 },
  { id: 'urb_santacruz',  name: 'Urbanización de Santa Cruz',     x: 1760, z: -720, dir: Math.PI },
  { id: 'urb_vilaflor',   name: 'Urbanización de Vilaflor',       x: -360, z:  440, dir: Math.PI },
  { id: 'urb_icod',       name: 'Urbanización de Icod',           x: -650, z: -240, dir: 0 },
];
export const HOUSE_PORTAL_USE_M = 5;          // cliente: distancia a la puerta
export const HOUSE_PORTAL_SERVER_M = 18;      // server (posición con retraso)
export const HOUSE_AGENT = 'nauzet_inmobiliaria';
export const HOUSE_REST_COOLDOWN_MS = 5 * 60 * 1000;

export function nearHousePortal(x, z, r = HOUSE_PORTAL_SERVER_M) {
  if (!Number.isFinite(x) || !Number.isFinite(z)) return null;
  for (const p of HOUSE_PORTALS) if (Math.hypot(p.x - x, p.z - z) <= r) return p;
  return null;
}

// Interior (solo cliente): lejos del mapa y de la sala del banco (10000,10000)
export const HOUSE_CENTER = { x: 12000, z: 12000 };
