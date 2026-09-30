/**
 * SebasPresent — Caminos de la isla (Sesión 50)
 *
 * Red de caminos de tierra que une todas las ciudades y pueblos. Cada tramo
 * es una curva suave (Bézier con un desvío fijo) que esquiva lagos,
 * castillos, urbanizaciones, guaridas de jefes y la Fosa.
 *
 * Lo usan: terrain.js (no plantar árboles encima), roads_render.js (la cinta
 * del camino + postes indicadores) y map_render.js (minimapa y mapa).
 */
import { PONDS } from './fishing.js';
import { CASTLES } from './castles.js';
import { HOUSE_PORTALS } from './houses.js';
import { BOSSES } from './bosses.js';
import { FOSA } from './fosa.js';

export const ROAD_HALF_W = 2.6;          // medio ancho (m)

export const ROAD_NODES = {
  laguna:     { name: 'La Laguna',          x: 0,     z: 0 },
  orotava:    { name: 'La Orotava',         x: -300,  z: -700 },
  canadas:    { name: 'Las Cañadas',        x: 200,   z: -1700 },
  guimar:     { name: 'Güímar',             x: 1500,  z: 100 },
  adeje:      { name: 'Adeje',              x: 1000,  z: 1200 },
  cristianos: { name: 'Los Cristianos',     x: -300,  z: 1700 },
  santacruz:  { name: 'Santa Cruz',         x: 1700,  z: -800 },
  santiago:   { name: 'Santiago del Teide', x: -1100, z: 0 },
  vilaflor:   { name: 'Vilaflor',           x: -400,  z: 400 },
  icod:       { name: 'Icod de los Vinos',  x: -700,  z: -200 },
  esperanza:  { name: 'La Esperanza',       x: 700,   z: -1100 },
  arico:      { name: 'Arico',              x: 1100,  z: 600 },
  chayofa:    { name: 'Chayofa',            x: 700,   z: 1450 },
  faro:       { name: 'Faro de Punta Rasca', x: -800, z: 1400 },
  izana:      { name: 'Observatorio de Izaña', x: 400, z: -900 },
  guajara:    { name: 'Mina de Guajara',    x: 1200,  z: -1500 },
  candelaria: { name: 'Basílica de Candelaria', x: 0, z: -1200 },
  chinamada:  { name: 'Poblado de Chinamada', x: -620, z: 140 },
};

// [desde, hasta, curvatura (fracción del largo, con signo)]
export const ROAD_EDGES = [
  ['laguna', 'orotava', 0.08], ['laguna', 'guimar', -0.06], ['laguna', 'vilaflor', 0.1], ['laguna', 'izana', -0.08],
  ['izana', 'esperanza', 0.1], ['esperanza', 'santacruz', -0.08], ['esperanza', 'guajara', 0.08], ['guajara', 'canadas', -0.07],
  ['orotava', 'candelaria', 0.1], ['candelaria', 'canadas', -0.08], ['orotava', 'icod', -0.1], ['icod', 'santiago', 0.08],
  ['icod', 'chinamada', 0.12], ['chinamada', 'vilaflor', -0.1], ['vilaflor', 'cristianos', 0.07], ['cristianos', 'faro', -0.1],
  ['cristianos', 'chayofa', 0.06], ['chayofa', 'adeje', -0.12], ['adeje', 'arico', 0.1], ['arico', 'guimar', -0.08],
  ['guimar', 'santacruz', 0.08],
];

// Lo que el camino rodea (x, z, radio libre)
function obstacles() {
  const o = [];
  for (const p of PONDS) o.push([p.x, p.z, p.r + 7]);
  for (const c of CASTLES) o.push([c.x, c.z, 30]);
  for (const h of HOUSE_PORTALS) o.push([h.x, h.z, 30]);
  for (const b of Object.values(BOSSES)) o.push([b.x, b.z, (b.lairR || 12) + 4]);
  o.push([FOSA.x, FOSA.z, FOSA.r + 8]);
  for (const [x, z] of [[30, 0], [-260, -660], [1460, 60]]) o.push([x, z, 14]);   // edificios del banco
  return o;
}

const SAMPLE_M = 6;
let _roads = null;     // [{ a, b, pts: [[x,z],...] }]
let _grid = null;      // Map "cx,cz" → [[x0,z0,x1,z1], ...]
const CELL = 64;

function build() {
  const obs = obstacles();
  _roads = [];
  for (const [a, b, k] of ROAD_EDGES) {
    const A = ROAD_NODES[a], B = ROAD_NODES[b];
    const dx = B.x - A.x, dz = B.z - A.z, L = Math.hypot(dx, dz);
    // punto de control: el medio desplazado en perpendicular
    const cx = (A.x + B.x) / 2 - dz / L * L * k, cz = (A.z + B.z) / 2 + dx / L * L * k;
    const n = Math.max(2, Math.ceil(L / SAMPLE_M));
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n, u = 1 - t;
      const x = u * u * A.x + 2 * u * t * cx + t * t * B.x;
      const z = u * u * A.z + 2 * u * t * cz + t * t * B.z;
      pts.push([x, z]);
    }
    const push = () => {
      for (const P of pts) {
        // no en los extremos: ahí está el pueblo
        if (Math.hypot(P[0] - A.x, P[1] - A.z) < 20 || Math.hypot(P[0] - B.x, P[1] - B.z) < 20) continue;
        for (let it = 0; it < 2; it++) for (const [ox, oz, r] of obs) {
          const ddx = P[0] - ox, ddz = P[1] - oz, d = Math.hypot(ddx, ddz);
          if (d < r) {
            const f = d > 0.01 ? r / d : 1;
            P[0] = ox + (d > 0.01 ? ddx : 1) * f; P[1] = oz + (d > 0.01 ? ddz : 0) * f;
          }
        }
      }
    };
    // empujar y suavizar varias veces: desvíos redondos, sin esquinas
    const smooth = (passes) => {
      for (let pass = 0; pass < passes; pass++) {
        for (let k = 1; k < pts.length - 1; k++) {
          pts[k] = [(pts[k - 1][0] + pts[k][0] * 2 + pts[k + 1][0]) / 4, (pts[k - 1][1] + pts[k][1] * 2 + pts[k + 1][1]) / 4];
        }
      }
    };
    for (let round = 0; round < 6; round++) { push(); smooth(4); }
    _roads.push({ a, b, pts });
  }
  _grid = new Map();
  const R = ROAD_HALF_W + 4;
  for (const r of _roads) {
    for (let i = 0; i < r.pts.length - 1; i++) {
      const [x0, z0] = r.pts[i], [x1, z1] = r.pts[i + 1];
      const minCx = Math.floor((Math.min(x0, x1) - R) / CELL), maxCx = Math.floor((Math.max(x0, x1) + R) / CELL);
      const minCz = Math.floor((Math.min(z0, z1) - R) / CELL), maxCz = Math.floor((Math.max(z0, z1) + R) / CELL);
      for (let cx = minCx; cx <= maxCx; cx++) for (let cz = minCz; cz <= maxCz; cz++) {
        const key = cx + ',' + cz;
        if (!_grid.has(key)) _grid.set(key, []);
        _grid.get(key).push([x0, z0, x1, z1]);
      }
    }
  }
}

export function getRoads() { if (!_roads) build(); return _roads; }

/** Distancia (m) al camino más cercano; Infinity si no hay ninguno cerca. */
export function roadDist(x, z) {
  if (!_grid) build();
  const segs = _grid.get(Math.floor(x / CELL) + ',' + Math.floor(z / CELL));
  if (!segs) return Infinity;
  let best = Infinity;
  for (const [x0, z0, x1, z1] of segs) {
    const dx = x1 - x0, dz = z1 - z0, L2 = dx * dx + dz * dz;
    let t = L2 > 0 ? ((x - x0) * dx + (z - z0) * dz) / L2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const ex = x0 + dx * t - x, ez = z0 + dz * t - z;
    const d = ex * ex + ez * ez;
    if (d < best) best = d;
  }
  return Math.sqrt(best);
}

/** Tramos que salen de un nodo: [{ to, name, dir:[dx,dz] (unitario), len }] */
export function roadsFrom(nodeId) {
  const out = [];
  for (const r of getRoads()) {
    let pts, to;
    if (r.a === nodeId) { pts = r.pts; to = r.b; } else if (r.b === nodeId) { pts = [...r.pts].reverse(); to = r.a; } else continue;
    // dirección a ~30 m del pueblo
    let k = 1, acc = 0;
    while (k < pts.length - 1 && acc < 30) { acc += Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]); k++; }
    const dx = pts[k][0] - pts[0][0], dz = pts[k][1] - pts[0][1], d = Math.hypot(dx, dz) || 1;
    let len = 0; for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    out.push({ to, name: ROAD_NODES[to].name, dir: [dx / d, dz / d], len, pts });
  }
  return out;
}
