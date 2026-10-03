/**
 * SebasPresent — Rejilla de celdas para buscar monstruos cerca (Sesión 51)
 *
 * Cada monstruo tiene una columna calculada `cell` (migración 019) con la
 * celda de 32×32 m en la que está. Con el índice (status, cell), "dame los
 * monstruos a 40 m" lee SOLO los monstruos de esas celdas, en vez de toda una
 * franja del mapa de punta a punta (lo que gastaba miles de lecturas D1).
 *
 * La fórmula tiene que ser IDÉNTICA a la de la columna en SQL:
 *   CAST(x / 32.0 + 1024 AS INTEGER) * 4096 + CAST(z / 32.0 + 1024 AS INTEGER)
 * (CAST trunca; con el +1024 siempre es positivo, así que trunca = floor.)
 */

export const NPC_CELL_M = 32;
const OFF = 1024;
const MUL = 4096;

export const NPC_CELL_SQL = `CAST(x / ${NPC_CELL_M}.0 + ${OFF} AS INTEGER) * ${MUL} + CAST(z / ${NPC_CELL_M}.0 + ${OFF} AS INTEGER)`;

function axis(v) { return Math.trunc(v / NPC_CELL_M + OFF); }

/** Celda de un punto. */
export function npcCellOf(x, z) { return axis(x) * MUL + axis(z); }

/** Todas las celdas que tocan el cuadrado de lado 2r centrado en (x,z). */
export function cellsAround(x, z, r) {
  // Sesión 51 — con números absurdos (x = 1e18) el bucle no terminaba nunca y
  // tumbaba el servidor. Coordenadas fuera de ±200 km o radios enormes → nada.
  if (!Number.isFinite(x) || !Number.isFinite(z) || !Number.isFinite(r) || Math.abs(x) > 2e5 || Math.abs(z) > 2e5 || r < 0 || r > 1000) return [];
  const x0 = axis(x - r), x1 = axis(x + r), z0 = axis(z - r), z1 = axis(z + r);
  const out = [];
  for (let cx = x0; cx <= x1; cx++) for (let cz = z0; cz <= z1; cz++) out.push(cx * MUL + cz);
  return out;
}

/** "?,?,?" para un IN (...) de n elementos. */
export function qMarks(n) { return new Array(n).fill('?').join(','); }
