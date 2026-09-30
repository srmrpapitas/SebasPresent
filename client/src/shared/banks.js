/**
 * SebasPresent — Cofres de banco por el mapa (Sesión 50)
 *
 * Como los bancos de OSRS: en cada ciudad, pueblo, mina y lago hay un cofre
 * donde abrir TU banco (es el mismo en todos). En la wilderness no hay.
 * MÓDULO COMPARTIDO (cliente dibuja; el server podrá validar distancias).
 */
import { CASTLES, CASTLE_BANK_R } from './castles.js';   // Sesión 50
import { TOWN_NPCS } from './town_npcs.js';

export const BANK_USE_DIST_M = 3.2;

export const BANK_CHESTS = [
  // Zona de inicio
  { id: 'bank_concejo',   name: 'Cofre de La Laguna',         x:  -22, z:    10 },
  { id: 'bank_cantera',   name: 'Cofre de la Cantera',        x:   90, z:   -66 },
  { id: 'bank_estanque',  name: 'Cofre del Estanque',         x:  -54, z:  -150 },
  // Ciudades
  { id: 'bank_robledal',  name: 'Banco de La Orotava',          x: -278, z:  -694 },
  { id: 'bank_picoblanco',name: 'Banco de Las Cañadas',        x:  222, z: -1694 },
  { id: 'bank_solquemado',name: 'Banco de Güímar',        x: 1522, z:   106 },
  { id: 'bank_verdis',    name: 'Banco de Adeje',            x: 1022, z:  1206 },
  { id: 'bank_sirena',    name: 'Banco de Los Cristianos',     x: -278, z:  1706 },
  { id: 'bank_marpiedra', name: 'Banco de Santa Cruz',         x: 1722, z:  -794 },
  // Pueblos
  { id: 'bank_cruce',     name: 'Cofre de Vilaflor',   x: -384, z:   405 },
  { id: 'bank_cazador',   name: 'Cofre de Icod',         x: -684, z:  -195 },
  { id: 'bank_vientos',   name: 'Cofre de La Esperanza', x: 716, z: -1095 },
  { id: 'bank_oasis',     name: 'Cofre del Oasis',            x: 1116, z:   605 },
  { id: 'bank_hondonada', name: 'Cofre de Chayofa',   x:  716, z:  1455 },
  { id: 'bank_faro',      name: 'Cofre del Faro',             x: -784, z:  1405 },
  // Lugares de trabajo
  { id: 'bank_mina',      name: 'Cofre de la Mina de Guajara',   x: 1186, z: -1462 },
  { id: 'bank_torre',     name: 'Cofre del Observatorio de Izaña', x:  416, z:  -896 },
  { id: 'bank_templo',    name: 'Cofre de Candelaria',           x:   18, z: -1204 },
  { id: 'bank_pantano',   name: 'Cofre de la Laguna',         x: -478, z:   600 },
  { id: 'bank_lago',      name: 'Cofre del Lago de Adeje',   x:  842, z:   880 },
  { id: 'bank_helado',    name: 'Cofre del Lago Helado',      x:  522, z: -1500 },
  { id: 'bank_fosa',      name: 'Cofre de la Fosa de Guayota',  x: 1852, z:  -304 },   // Sesión 50
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

// ------------------------------------------------------------
// Sesión 50 — Seguridad: el server solo deja meter/sacar cosas del banco si
// estás junto a un cofre, un banquero (Gerardo, el del castillo) o dentro de
// la sala del banco. Tolerancia amplia porque la posición que guarda el
// server llega con ~1 s de retraso mientras caminas.
// ------------------------------------------------------------
export const BANK_USE_DIST_SERVER_M = 10;
const EXTRA_BANK_POINTS = [
  { x: 10000, z: 10000, r: 30 },        // sala del banco (interiors.js)
  // Edificios del banco (buildings.js). Dentro de la sala el cliente NO manda
  // su posición (10000,10000 está fuera del mapa y el Realm la descarta), así
  // que el server te ve en la puerta: se entra a ≤10 m del edificio.
  { x: 30, z: 0, r: 18 },               // plaza de La Laguna
  { x: -260, z: -660, r: 18 },          // La Orotava
  { x: 1460, z: 60, r: 18 },            // Güímar
];

export function isNearAnyBank(x, z) {
  // (castillos: shared/castles.js)
  if (!Number.isFinite(x) || !Number.isFinite(z)) return false;
  const R = BANK_USE_DIST_SERVER_M;
  for (const b of BANK_CHESTS) if (Math.hypot(b.x - x, b.z - z) <= R) return true;
  for (const n of TOWN_NPCS) {
    if (n.actions?.includes('bank') && Math.hypot(n.x - x, n.z - z) <= R) return true;
  }
  for (const p of EXTRA_BANK_POINTS) if (Math.hypot(p.x - x, p.z - z) <= p.r) return true;
  for (const c of CASTLES) if (Math.hypot(c.x - x, c.z - z) <= CASTLE_BANK_R) return true;
  return false;
}
