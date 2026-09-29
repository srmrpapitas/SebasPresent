/**
 * SebasPresent — Vetas de mineral (Sesión 50)
 *
 * MÓDULO COMPARTIDO cliente + servidor. Puro: sin three.js, sin DOM, sin D1.
 *   - Cliente: client/src/skills/mining.js lo usa para DIBUJAR las vetas.
 *   - Server:  server/handlers/skills/mining.js lo usa para VALIDAR que la
 *              veta existe, dónde está y de qué mineral es.
 *
 * Como ambos generan exactamente las mismas vetas a partir de la misma semilla,
 * el cliente solo manda el `vein_id` y el server sabe todo lo demás. No se
 * puede inventar una veta de teiderio al lado del spawn (la trampa que sí
 * existe hoy en la tala, donde el cliente manda tree_type + x,z).
 *
 * ⚠️ Si cambiás CUALQUIER número de la generación, TODAS las vetas se mueven
 *    (y las depletadas en rock_state quedan apuntando a ids viejos, que se
 *    limpian solas por el cron). No pasa nada grave, pero hacelo a propósito.
 *
 * vein_id:
 *   - Procedural: "c{cx}_{cz}_{i}"  (chunk + índice dentro del chunk)
 *   - Fija:       "s{i}"            (cantera de iniciación y minas a mano)
 */

// ------------------------------------------------------------
// Constantes del mundo (espejo de terrain.js — mantener en sync)
// ------------------------------------------------------------
export const WORLD_HALF = 2048;
export const WILDERNESS_X = -1024;
export const CHUNK_SIZE = 64;

// ------------------------------------------------------------
// Definición de los 7 tiers (items ore_* ya existen en la D1)
// ------------------------------------------------------------
// level:         nivel de Minería requerido
// xp:            XP por mineral obtenido
// baseSuccess:   prob. de sacar mineral por golpe al nivel requerido
// maxSuccess:    prob. a nivel 99 (escala lineal)
// depleteChance: prob. de que la veta se agote tras dar un mineral
// respawnMs:     tiempo hasta que la veta vuelve a tener mineral
// color/glow:    aspecto visual (roca + cristales emisivos)
export const ORE_TIERS = {
  bronze:    { id: 'bronze',    tier: 1, name: 'Veta de bronce',    oreItem: 'ore_bronze',    level: 1,  xp: 18,  baseSuccess: 0.60, maxSuccess: 0.95, depleteChance: 0.30, respawnMs:  20_000, color: '#b87333', glow: '#ff9a4d', glowIntensity: 0.35 },
  hierro:    { id: 'hierro',    tier: 2, name: 'Veta de hierro',    oreItem: 'ore_hierro',    level: 10, xp: 35,  baseSuccess: 0.50, maxSuccess: 0.90, depleteChance: 0.25, respawnMs:  40_000, color: '#9a5a40', glow: '#e89a70', glowIntensity: 0.25 },
  acero:     { id: 'acero',     tier: 3, name: 'Veta de acero',     oreItem: 'ore_acero',     level: 20, xp: 50,  baseSuccess: 0.42, maxSuccess: 0.85, depleteChance: 0.22, respawnMs:  60_000, color: '#aab4bd', glow: '#dff0ff', glowIntensity: 0.45 },
  oro:       { id: 'oro',       tier: 4, name: 'Veta de oro',       oreItem: 'ore_oro',       level: 30, xp: 65,  baseSuccess: 0.35, maxSuccess: 0.80, depleteChance: 0.20, respawnMs: 120_000, color: '#d4af37', glow: '#ffe066', glowIntensity: 0.65 },
  obsidiana: { id: 'obsidiana', tier: 5, name: 'Veta de obsidiana', oreItem: 'ore_obsidiana', level: 40, xp: 80,  baseSuccess: 0.28, maxSuccess: 0.72, depleteChance: 0.18, respawnMs: 180_000, color: '#1c1a24', glow: '#a36bff', glowIntensity: 0.75 },
  basaltita: { id: 'basaltita', tier: 6, name: 'Veta de basaltita', oreItem: 'ore_basaltita', level: 55, xp: 100, baseSuccess: 0.22, maxSuccess: 0.65, depleteChance: 0.15, respawnMs: 300_000, color: '#3a3f45', glow: '#ff5a1f', glowIntensity: 0.85 },
  teiderio:  { id: 'teiderio',  tier: 7, name: 'Veta de teiderio',  oreItem: 'ore_teiderio',  level: 70, xp: 125, baseSuccess: 0.15, maxSuccess: 0.55, depleteChance: 0.12, respawnMs: 600_000, color: '#2f9e8f', glow: '#4dffe0', glowIntensity: 1.00 },
};

export function miningSuccessRate(def, level) {
  if (level <= def.level) return def.baseSuccess;
  if (level >= 99) return def.maxSuccess;
  const p = (level - def.level) / (99 - def.level);
  return def.baseSuccess + (def.maxSuccess - def.baseSuccess) * p;
}

// ------------------------------------------------------------
// Ruido (copia EXACTA de terrain.js para que biomeAt coincida)
// ------------------------------------------------------------
function hash2(x, y) {
  let h = (x | 0) * 374761393 + (y | 0) * 668265263;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function noise2d(x, y) {
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const fx = x - x0, fy = y - y0;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const v00 = hash2(x0, y0), v10 = hash2(x0 + 1, y0);
  const v01 = hash2(x0, y0 + 1), v11 = hash2(x0 + 1, y0 + 1);
  const top = v00 * (1 - sx) + v10 * sx;
  const bot = v01 * (1 - sx) + v11 * sx;
  return top * (1 - sy) + bot * sy;
}
/** Copia de terrain.biomeAt → devuelve solo el id del bioma. */
export function biomeIdAt(x, z) {
  if (x < WILDERNESS_X) return 'wilderness';
  if (Math.hypot(x, z) < 80) return 'plaza';
  const nx = (noise2d(x * 0.008, z * 0.008) - 0.5) * 90;
  const nz = (noise2d(x * 0.009 + 50, z * 0.009 + 50) - 0.5) * 90;
  const ex = x + nx, ez = z + nz;
  if (ez < -1300) return 'snow';
  if (ez > 1450) return 'beach';
  if (ex > 900 && ez > -700 && ez < 700) return 'desert';
  if (ez > 700 && ex > 200) return 'jungle';
  if (ex < -200 && ez > 200 && ez < 900) return 'swamp';
  if (ez < -400) return 'forest';
  return 'plains';
}

// ------------------------------------------------------------
// Qué minerales salen en cada zona
// ------------------------------------------------------------
// chance: prob. de que un chunk (64×64m) tenga un grupo de vetas.
// pool:   [tier, peso].
const BIOME_ORES = {
  plaza:  { chance: 0,    pool: [] },
  plains: { chance: 0.09, pool: [['bronze', 8], ['hierro', 2]] },
  forest: { chance: 0.12, pool: [['hierro', 6], ['bronze', 3], ['acero', 1]] },
  swamp:  { chance: 0.09, pool: [['hierro', 5], ['bronze', 3]] },
  beach:  { chance: 0.05, pool: [['bronze', 5], ['hierro', 3]] },
  jungle: { chance: 0.11, pool: [['hierro', 4], ['acero', 3], ['oro', 2]] },
  desert: { chance: 0.14, pool: [['oro', 5], ['acero', 4], ['hierro', 2]] },
  snow:   { chance: 0.14, pool: [['acero', 6], ['hierro', 3], ['oro', 2]] },
};
// Wilderness: por profundidad (misma fórmula que terrain.getRegionInfo).
function wildernessOres(x) {
  const depth = (WILDERNESS_X - x) / (WORLD_HALF + WILDERNESS_X);
  if (depth < 0.20) return { chance: 0.16, pool: [['obsidiana', 5], ['acero', 3]] };
  if (depth < 0.45) return { chance: 0.16, pool: [['obsidiana', 5], ['basaltita', 3]] };
  if (depth < 0.75) return { chance: 0.17, pool: [['basaltita', 5], ['obsidiana', 2], ['teiderio', 1]] };
  return { chance: 0.18, pool: [['teiderio', 4], ['basaltita', 3]] };
}

// Lugares del mapa donde NO debe haber vetas (espejo mínimo de terrain.PLACES).
const NO_VEIN_ZONES = [
  [0, 0, 140], [-300, -700, 90], [200, -1700, 90], [1500, 100, 90], [1000, 1200, 90],
  [-300, 1700, 90], [1700, -800, 90], [-1100, 0, 90],
  [-400, 400, 60], [-700, -200, 60], [700, -1100, 60], [1100, 600, 60], [700, 1450, 60], [-800, 1400, 60],
  [400, -900, 45], [0, -1200, 45], [1200, -1500, 30],
  [-1500, -500, 45], [-1700, 500, 45], [-1850, 0, 60],
  [-1700, -1700, 120], [-1800, 1500, 100], [800, -1850, 150],
];
function inNoVeinZone(x, z) {
  for (const [px, pz, r] of NO_VEIN_ZONES) if (Math.hypot(x - px, z - pz) < r) return true;
  return false;
}

// ------------------------------------------------------------
// Vetas fijas (a mano)
// ------------------------------------------------------------
// s0-s5: Cantera de iniciación, al noreste del Concejo Central (spawn).
//        La usará la misión tutorial de minería.
// s6-s13: Mina Antigua (1200, -1500) — acero y oro alrededor de la entrada.
const STATIC_VEINS = [
  ['bronze', 118, -96], ['bronze', 122.5, -92], ['bronze', 114, -90.5],
  ['bronze', 125, -99.5], ['hierro', 119.5, -103], ['hierro', 129, -94],
  ['acero', 1180, -1520], ['acero', 1186, -1526], ['acero', 1214, -1522],
  ['oro', 1222, -1514], ['oro', 1176, -1478], ['acero', 1222, -1484],
  ['oro', 1230, -1490], ['acero', 1170, -1486],
];
export const STARTER_QUARRY = { x: 121, z: -95, name: 'Cantera del Concejo' };

// ------------------------------------------------------------
// Generación
// ------------------------------------------------------------
function chunkOrigin(cx, cz) {
  return { x: cx * CHUNK_SIZE - CHUNK_SIZE / 2, z: cz * CHUNK_SIZE - CHUNK_SIZE / 2 };
}
export function chunkKeyAt(x, z) {
  return {
    cx: Math.floor((x + CHUNK_SIZE / 2) / CHUNK_SIZE),
    cz: Math.floor((z + CHUNK_SIZE / 2) / CHUNK_SIZE),
  };
}

function pickWeighted(pool, r) {
  const total = pool.reduce((s, p) => s + p[1], 0);
  let acc = 0;
  const target = r * total;
  for (const [id, w] of pool) { acc += w; if (acc >= target) return id; }
  return pool[pool.length - 1][0];
}

const _chunkCache = new Map();

/**
 * Vetas procedurales de un chunk. Array de { id, tier, x, z, seed }.
 * Determinista: mismo (cx, cz) → mismo resultado en cliente y server.
 */
export function veinsForChunk(cx, cz) {
  const key = cx + ',' + cz;
  const cached = _chunkCache.get(key);
  if (cached) return cached;

  const out = [];
  const o = chunkOrigin(cx, cz);
  const inside = o.x + CHUNK_SIZE > -WORLD_HALF && o.x < WORLD_HALF &&
                 o.z + CHUNK_SIZE > -WORLD_HALF && o.z < WORLD_HALF;
  if (inside) {
    // Centro del grupo (margen 10m para que el grupo no se salga del chunk).
    const gx = o.x + 10 + hash2(cx * 911 + 17, cz * 613 + 5) * (CHUNK_SIZE - 20);
    const gz = o.z + 10 + hash2(cx * 347 + 3, cz * 829 + 91) * (CHUNK_SIZE - 20);
    const cfg = gx < WILDERNESS_X ? wildernessOres(gx) : BIOME_ORES[biomeIdAt(gx, gz)];
    const roll = hash2(cx * 1301 + 7, cz * 1709 + 13);
    if (cfg && cfg.pool.length && roll < cfg.chance && !inNoVeinZone(gx, gz) &&
        Math.abs(gx) < WORLD_HALF - 8 && Math.abs(gz) < WORLD_HALF - 8) {
      const tier = pickWeighted(cfg.pool, hash2(cx * 199 + 29, cz * 431 + 61));
      // 2-4 vetas del mismo mineral en racimo (radio ~4m).
      const n = 2 + Math.floor(hash2(cx * 71 + 1, cz * 83 + 2) * 3);
      for (let i = 0; i < n; i++) {
        const a = hash2(cx * 37, cz * 53) * Math.PI * 2 + i * 2.39996 + hash2(cx * 37 + i * 101, cz * 53 + i * 211) * 0.6;
        const d = i === 0 ? 0 : 3.0 + hash2(cx * 59 + i * 7, cz * 61 + i * 3) * 1.8;
        out.push({
          id: `c${cx}_${cz}_${i}`,
          tier,
          x: Math.round((gx + Math.cos(a) * d) * 100) / 100,
          z: Math.round((gz + Math.sin(a) * d) * 100) / 100,
          seed: hash2(cx * 7 + i, cz * 11 + i * 5),
        });
      }
    }
  }
  // Vetas fijas que caen dentro de este chunk.
  for (let i = 0; i < STATIC_VEINS.length; i++) {
    const [tier, x, z] = STATIC_VEINS[i];
    const k = chunkKeyAt(x, z);
    if (k.cx === cx && k.cz === cz) {
      out.push({ id: `s${i}`, tier, x, z, seed: hash2(i * 97 + 3, i * 31 + 7) });
    }
  }
  _chunkCache.set(key, out);
  return out;
}

/** Busca una veta por id. null si no existe. */
export function getVeinById(id) {
  if (typeof id !== 'string' || id.length > 32) return null;
  let m = /^s(\d{1,3})$/.exec(id);
  if (m) {
    const i = Number(m[1]);
    const s = STATIC_VEINS[i];
    if (!s) return null;
    const k = chunkKeyAt(s[1], s[2]);
    return veinsForChunk(k.cx, k.cz).find(v => v.id === id) || null;
  }
  m = /^c(-?\d{1,3})_(-?\d{1,3})_(\d)$/.exec(id);
  if (!m) return null;
  return veinsForChunk(Number(m[1]), Number(m[2])).find(v => v.id === id) || null;
}

/** Todas las vetas dentro de un radio (para el cliente). */
export function veinsNear(x, z, radiusChunks = 3) {
  const { cx, cz } = chunkKeyAt(x, z);
  const out = [];
  for (let dz = -radiusChunks; dz <= radiusChunks; dz++) {
    for (let dx = -radiusChunks; dx <= radiusChunks; dx++) {
      for (const v of veinsForChunk(cx + dx, cz + dz)) out.push(v);
    }
  }
  return out;
}

/** Centros de todos los grupos del mundo (para que no crezcan árboles encima). */
export function allVeinClusterCenters() {
  const n = Math.ceil(WORLD_HALF / CHUNK_SIZE) + 1;
  const out = [];
  for (let cz = -n; cz <= n; cz++) {
    for (let cx = -n; cx <= n; cx++) {
      const vs = veinsForChunk(cx, cz);
      if (vs.length) {
        // agrupar por proximidad simple (procedural = 1 grupo; fijas = varias)
        for (const v of vs) out.push({ x: v.x, z: v.z });
      }
    }
  }
  return out;
}
