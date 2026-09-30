/**
 * SebasPresent — Árboles del mundo (compartido cliente + server) · Sesión 50
 *
 * Qué árboles salen en cada bioma y dónde. terrain.js los dibuja con esto, y
 * el server lo usa para comprobar que el árbol que dices talar EXISTE en esas
 * coordenadas y es de ese tipo (antes el cliente podía inventarse un árbol
 * mágico en cualquier sitio).
 */
import { biomeIdAt, chunkKeyAt } from './ore_veins.js';

export const TREE_CHUNK_SIZE = 64;

export const BIOME_TREES = {
  plaza:      { density: 2,  pool: [['bush', 1]] },
  plains:     { density: 8,  pool: [['normal', 4], ['oak', 1], ['bush', 2], ['bush_small', 1]] },
  forest:     { density: 22, pool: [['normal', 2], ['oak', 4], ['maple', 1.5], ['yew', 0.3], ['bush', 2]] },
  beach:      { density: 4,  pool: [['palm', 6], ['normal', 1], ['bush_small', 1]] },
  desert:     { density: 1,  pool: [['dead', 1]] },
  snow:       { density: 12, pool: [['pine', 6], ['maple', 1], ['yew', 0.5], ['bush_small', 0.5]] },
  jungle:     { density: 28, pool: [['mahogany', 4], ['palm', 1], ['teak', 2], ['magic', 0.2], ['bush', 3]] },
  swamp:      { density: 18, pool: [['willow', 5], ['dead', 1], ['bush', 2], ['magic', 0.1]] },
  wilderness: { density: 6,  pool: [['dead', 4], ['yew', 1], ['magic', 0.1]] },
};

function hash2(x, y) {
  let h = (x | 0) * 374761393 + (y | 0) * 668265263;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/**
 * Todos los árboles POSIBLES de un chunk (mismo algoritmo que terrain.js,
 * sin aplicar separación mínima, zonas libres ni densidad — el cliente
 * dibuja un subconjunto de estos).
 */
export function treeCandidatesForChunk(cx, cz) {
  const S = TREE_CHUNK_SIZE;
  const ox = cx * S - S / 2, oz = cz * S - S / 2;
  const chunkBiome = biomeIdAt(ox + S / 2, oz + S / 2);
  const config = BIOME_TREES[chunkBiome] || BIOME_TREES.plains;
  if (config.density === 0 || config.pool.length === 0) return [];
  const out = [];
  const N = Math.max(8, config.density * 2);
  for (let i = 0; i < N; i++) {
    const wx = ox + hash2(cx * 31 + i + 100, cz * 37 + i * 3 + 50) * (S - 4) + 2;
    const wz = oz + hash2(cx * 41 + i * 7 + 200, cz * 43 + i + 300) * (S - 4) + 2;
    const local = BIOME_TREES[biomeIdAt(wx, wz)];
    if (!local || !local.pool.length) continue;
    const roll = hash2(cx * 53 + i * 11 + 700, cz * 59 + i * 13 + 800);
    const total = local.pool.reduce((s, p) => s + p[1], 0);
    let acc = 0, chosen = null;
    for (const [id, w] of local.pool) { acc += w; if (acc >= roll * total) { chosen = id; break; } }
    if (chosen) out.push({ x: wx, z: wz, typeId: chosen });
  }
  return out;
}

/** ¿Hay un árbol de ese tipo en (x, z)? (tolerancia en metros) */
export function isTreeAt(typeId, x, z, tol = 0.3) {
  const { cx, cz } = chunkKeyAt(x, z);
  for (const t of treeCandidatesForChunk(cx, cz)) {
    if (t.typeId === typeId && Math.abs(t.x - x) <= tol && Math.abs(t.z - z) <= tol) return true;
  }
  return false;
}
