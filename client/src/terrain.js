/**
 * SebasPresent — Terrain module (Sesión 5 refactor)
 *
 * Sesión 12 — TEXTURIZADO DEL TERRENO:
 *   - Carga 6 texturas diff_1k.jpg desde R2 (una por bioma): forest, wilderness,
 *     swamp, plaza, snow, desert. Los biomas plains/jungle/beach NO tienen
 *     textura todavía → caen al vertex color como fallback (queda OK porque
 *     ya usaban paletas verdes/arena similares).
 *   - Cada chunk se pinta con la textura del bioma de SU CENTRO (1 textura
 *     por chunk, NO per-vertex blending). Trade-off: transiciones entre
 *     chunks de biomas distintos se ven "cortadas" en lugar de degradado
 *     suave, pero el ruido de biomeAt() las hace orgánicas, no rectas.
 *   - El vertex color se MULTIPLICA encima de la textura para preservar la
 *     variación interna (zonas claras/oscuras dentro del mismo bioma).
 *   - Tiling: cada chunk de 64m tiene la textura repetida 4 veces → cada
 *     tile mide 16m. Si quedara muy obvio el patrón, subir/bajar TILE_REPEAT.
 *
 * Todo lo demás (chunks, places, árboles, decoración, colisión) idéntico
 * a antes.
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// ============================================================
// Constantes públicas
// ============================================================
export const WORLD_HALF = 2048;
export const WILDERNESS_X = -1024;
export const CHUNK_SIZE = 64;
const CHUNK_SEGS = 32;
const RENDER_RADIUS = 3;
export const FOG_NEAR = CHUNK_SIZE * 2;
export const FOG_FAR  = CHUNK_SIZE * (RENDER_RADIUS + 0.5);

const TREE_SCALE_MIN = 1.5;
const TREE_SCALE_MAX = 3.0;
const TREE_COLLISION_RADIUS = 0.6;

const R2_BASE = 'https://pub-bb63b96c76c745f59a39649cde6678c0.r2.dev';

// ============================================================
// Sesión 12 — Texturas de biomas
// ============================================================
// Cada chunk se renderiza con la textura del bioma de su centro repetida
// TILE_REPEAT veces en X y Z. CHUNK_SIZE=64m, TILE_REPEAT=4 → cada tile
// son 16m, escala razonable para mirar desde la cámara (~5-10m de altura).
const TILE_REPEAT = 4;

// Paths esperados en R2. Biomas SIN textura (plains, jungle, beach) usan
// el vertex color (paleta clásica) como fallback automático.
const BIOME_TEXTURE_URLS = {
  forest:     `${R2_BASE}/terrain/textures/forest_diff_1k.jpg`,
  wilderness: `${R2_BASE}/terrain/textures/wilderness_diff_1k.jpg`,
  swamp:      `${R2_BASE}/terrain/textures/swamp_diff_1k.jpg`,
  plaza:      `${R2_BASE}/terrain/textures/plaza_diff_1k.jpg`,
  snow:       `${R2_BASE}/terrain/textures/snow_diff_1k.jpg`,
  desert:     `${R2_BASE}/terrain/textures/desert_diff_1k.jpg`,
  beach:      `${R2_BASE}/terrain/textures/beach_diff_1k.jpg`,
  // Sesión 12 — plains usa el archivo beach_diff_1k.jpg que ya está en R2
  // (es la textura de musgo verde + rocas que el user quiere para la pradera).
  // No hay archivo plains_diff_1k.jpg en R2 — apuntamos al mismo asset.
  plains:     `${R2_BASE}/terrain/textures/beach_diff_1k.jpg`,
  // jungle → sin textura, vertex color fallback (verde oscuro de selva)
};

// Cache de THREE.Texture cargadas. Vacío hasta que loadBiomeTextures() termine.
// Si un bioma no está aquí, el chunk usa vertex color en MeshLambertMaterial
// con vertexColors:true (comportamiento previo a sesión 12).
const BIOME_TEXTURES = {};

export const PALETTE = {
  sky: 0x9ec0d6, fog: 0xa8c4d8, skyWild: 0x6a4040, fogWild: 0x6a3838,
  ocean: 0x4a7896, player: 0xc04a3a, marker: 0xfff04a,
};

export const BIOMES = {
  plaza:      { id: 'plaza',      base: 0xc8b896, light: 0xe0d4b0, dark: 0x9a8a68 },
  plains:     { id: 'plains',     base: 0x6b9e3a, light: 0x88b850, dark: 0x4e7626 },
  forest:     { id: 'forest',     base: 0x4a6d2a, light: 0x6a8e44, dark: 0x2e451a },
  desert:     { id: 'desert',     base: 0xd9be7e, light: 0xebd498, dark: 0xb8965a },
  snow:       { id: 'snow',       base: 0xe4eaf0, light: 0xf4f8fc, dark: 0xa8b8c4 },
  jungle:     { id: 'jungle',     base: 0x3d6a25, light: 0x5c8c38, dark: 0x254018 },
  beach:      { id: 'beach',      base: 0xe6d3a3, light: 0xf0e0bc, dark: 0xc4ad7e },
  swamp:      { id: 'swamp',      base: 0x5a6a3a, light: 0x788858, dark: 0x3a4828 },
  wilderness: { id: 'wilderness', base: 0x6a4030, light: 0x8a5a3a, dark: 0x4a2818 },
};

const TREE_TYPE_DEFS = {
  normal:    { name: 'Árbol',        chopLevel: 1,  xpReward: 25,  logItem: 'logs',          trunkColor: 0x6b4423, canopyColor: 0x4a7a2a, trunkScale: 1.0, height: 2.5, canopyShape: 'sphere',  canopyRadius: 1.4 },
  oak:       { name: 'Roble',        chopLevel: 15, xpReward: 37,  logItem: 'oak_logs',      trunkColor: 0x5a3618, canopyColor: 0x3d6420, trunkScale: 1.3, height: 3.4, canopyShape: 'sphere',  canopyRadius: 2.0 },
  palm:      { name: 'Palmera',      chopLevel: 20, xpReward: 35,  logItem: 'palm_logs',     trunkColor: 0x8b6c3c, canopyColor: 0x88a838, trunkScale: 0.7, height: 4.5, canopyShape: 'flat',    canopyRadius: 2.2 },
  pine:      { name: 'Pino',         chopLevel: 30, xpReward: 65,  logItem: 'pine_logs',     trunkColor: 0x4a2a14, canopyColor: 0x2a5028, trunkScale: 0.85,height: 4.2, canopyShape: 'cone',    canopyRadius: 1.4 },
  maple:     { name: 'Arce',         chopLevel: 45, xpReward: 100, logItem: 'maple_logs',    trunkColor: 0x6a4528, canopyColor: 0xb04826, trunkScale: 1.1, height: 3.6, canopyShape: 'sphere',  canopyRadius: 1.9 },
  mahogany:  { name: 'Caoba',        chopLevel: 50, xpReward: 125, logItem: 'mahogany_logs', trunkColor: 0x5a2818, canopyColor: 0x2a5a1c, trunkScale: 1.4, height: 4.0, canopyShape: 'sphere',  canopyRadius: 2.2 },
  yew:       { name: 'Tejo',         chopLevel: 60, xpReward: 175, logItem: 'yew_logs',      trunkColor: 0x2a1a10, canopyColor: 0x1a4438, trunkScale: 1.6, height: 4.2, canopyShape: 'sphere',  canopyRadius: 2.3 },
  magic:     { name: 'Árbol Mágico', chopLevel: 75, xpReward: 250, logItem: 'magic_logs',    trunkColor: 0xa8b8d0, canopyColor: 0x88ddff, trunkScale: 1.2, height: 4.5, canopyShape: 'crystal', canopyRadius: 2.0, emissive: 0x4488ff, emissiveIntensity: 0.45 },
  dead:      { name: 'Árbol Muerto', chopLevel: 1,  xpReward: 12,  logItem: 'dead_logs',     trunkColor: 0x3a2818, canopyColor: 0x4a3828, trunkScale: 0.9, height: 3.2, canopyShape: 'crystal', canopyRadius: 1.0 },
  willow:    { name: 'Sauce',        chopLevel: 30, xpReward: 67,  logItem: 'willow_logs',   trunkColor: 0x6a5028, canopyColor: 0x8aa848, trunkScale: 1.2, height: 3.8, canopyShape: 'sphere',  canopyRadius: 2.2 },
  teak:      { name: 'Teca',         chopLevel: 35, xpReward: 85,  logItem: 'teak_logs',     trunkColor: 0x6a4218, canopyColor: 0x4a7028, trunkScale: 1.1, height: 3.8, canopyShape: 'sphere',  canopyRadius: 2.0 },
  bush:      { name: 'Arbusto',      chopLevel: 1,  xpReward: 8,   logItem: 'bush_leaves',   trunkColor: 0x5a4028, canopyColor: 0x4a7a30, trunkScale: 0.5, height: 0.6, canopyShape: 'sphere',  canopyRadius: 0.9 },
  bush_small:{ name: 'Matorral',     chopLevel: 1,  xpReward: 5,   logItem: 'bush_leaves',   trunkColor: 0x5a4028, canopyColor: 0x6a8a40, trunkScale: 0.4, height: 0.4, canopyShape: 'sphere',  canopyRadius: 0.6 },
};

const BIOME_TREES = {
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

const TREE_GLB_URLS = {
  oak:        `${R2_BASE}/trees/oak.glb`,
  mahogany:   `${R2_BASE}/trees/mahogany.glb`,
  maple:      `${R2_BASE}/trees/maple.glb`,
  willow:     `${R2_BASE}/trees/willow.glb`,
  teak:       `${R2_BASE}/trees/teak.glb`,
  magic:      `${R2_BASE}/trees/magic_v2.glb`,
  bush:       `${R2_BASE}/trees/bush.glb`,
  bush_small: `${R2_BASE}/trees/bush_small.glb`,
};

const DECORATION_GLB_URLS = {
  stones:     `${R2_BASE}/decoration/stones.glb`,
  rocks:      `${R2_BASE}/decoration/rocks.glb`,   // Sesión 12: reemplaza cave_rocks (que tenía floor/ceiling/pilars de cueva volando)
  grass:      `${R2_BASE}/decoration/grass.glb`,
};

// Sesión 12 — Landmark único usando los cliffs gigantes del rocks.glb.
// Cada landmark usa UN mesh específico del GLB (filtrado por nombre).
// Tamaño "targetHeight" final visible en m: el GLB original tiene cliffs
// de 1300-2100m que escalamos a estos valores.
const LANDMARK_GLB_URL = `${R2_BASE}/decoration/rocks.glb`;
const LANDMARK_DEFS = [
  // name → mesh hijo en rocks.glb que se usa como geometry.
  { name: 'Black Rock',                 meshName: 'cliff1_cliffs_0', height: 80,  color: 0x2a2018 },
  { name: "Zuckerberg's Dungeon",       meshName: 'cliff2_cliffs_0', height: 60,  color: 0x3a2828 },
  { name: 'Mbappé Dictator Mountain',   meshName: 'cliff3_cliffs_0', height: 120, color: 0xc8d8e8 },
];

const BIOME_DECORATION = {
  plaza:      { density: 0,  pool: [] },
  plains:     { density: 4,  pool: [['stones', 2], ['grass', 5]] },
  forest:     { density: 6,  pool: [['stones', 2], ['grass', 4]] },
  beach:      { density: 3,  pool: [['stones', 3], ['rocks', 1]] },
  desert:     { density: 3,  pool: [['stones', 4], ['rocks', 1]] },
  snow:       { density: 4,  pool: [['stones', 3], ['rocks', 2]] },
  jungle:     { density: 5,  pool: [['stones', 1], ['grass', 4]] },
  swamp:      { density: 5,  pool: [['stones', 1], ['grass', 6]] },
  wilderness: { density: 5,  pool: [['stones', 2], ['rocks', 4]] },
};

const DECORATION_CONFIG = {
  stones: { scaleMin: 0.8, scaleMax: 1.6 },
  rocks:  { scaleMin: 0.4, scaleMax: 0.9 },  // las rocks del GLB son grandes (50-350m bbox), reducir mucho
  grass:  { scaleMin: 1.0, scaleMax: 2.0 },
};

export const PLACES = [
  { name: 'Concejo Central',     type: 'city',    x:     0, z:     0, color: 0xe8c560, biome: 'plaza' },
  { name: 'Robledal',            type: 'city',    x:  -300, z:  -700, color: 0x4a8a30, biome: 'forest' },
  { name: 'Picoblanco',          type: 'city',    x:   200, z: -1700, color: 0xc8d8e8, biome: 'snow' },
  { name: 'Solquemado',          type: 'city',    x:  1500, z:   100, color: 0xe8a448, biome: 'desert' },
  { name: 'Verdis',              type: 'city',    x:  1000, z:  1200, color: 0x5aaa3a, biome: 'jungle' },
  { name: 'Puerto Sirena',       type: 'city',    x:  -300, z:  1700, color: 0x6090c0, biome: 'beach' },
  { name: 'Marpiedra',           type: 'city',    x:  1700, z:  -800, color: 0xa08070, biome: 'desert' },
  { name: 'Avanzada del Olvido', type: 'city',    x: -1100, z:     0, color: 0x8a4040, biome: 'wilderness' },
  { name: 'Aldea del Cruce',         type: 'village', x:  -400, z:   400, color: 0xc8a043, biome: 'plains' },
  { name: 'Cabaña del Cazador',      type: 'village', x:  -700, z:  -200, color: 0x6a4828, biome: 'forest' },
  { name: 'Pueblo de los Vientos',   type: 'village', x:   700, z: -1100, color: 0xc0d0e0, biome: 'snow' },
  { name: 'Oasis del Halcón',        type: 'village', x:  1100, z:   600, color: 0xd8b860, biome: 'desert' },
  { name: 'Hondonada Verde',         type: 'village', x:   700, z:  1450, color: 0x5a8a3a, biome: 'jungle' },
  { name: 'Faro del Sur',            type: 'village', x:  -800, z:  1400, color: 0xc0d8e8, biome: 'beach' },
  { name: 'Torre del Mago',  type: 'tower',  x:   400, z:  -900, color: 0x7090d0, biome: 'forest' },
  { name: 'Mina Antigua',    type: 'mine',   x:  1200, z: -1500, color: 0x505050, biome: 'snow' },
  { name: 'Templo de la Luz', type: 'temple', x:    0, z: -1200, color: 0xfff4d0, biome: 'plains' },
  { name: 'Ruinas de Antaño', type: 'ruins', x: -1500, z:  -500, color: 0x6a4030, biome: 'wilderness' },
  { name: 'Altar del Vacío',  type: 'altar', x: -1700, z:   500, color: 0x4a1a3a, biome: 'wilderness' },
  { name: 'Corazón Roto',     type: 'boss',  x: -1850, z:     0, color: 0x8a1a1a, biome: 'wilderness' },

  // Sesión 12 — Landmarks únicos (cliffs del rocks.glb). type='landmark' los
  // diferencia de places normales: se renderizan con un mesh GLB específico
  // en lugar de geometría procedural. La propiedad 'modelMesh' indica qué
  // mesh hijo del GLB usar.
  { name: 'Black Rock',                 type: 'landmark', x: -1700, z: -1700, color: 0x2a2018, biome: 'wilderness', modelMesh: 'cliff1_cliffs_0', height: 80  },
  { name: "Zuckerberg's Dungeon",       type: 'landmark', x: -1800, z:  1500, color: 0x3a2828, biome: 'wilderness', modelMesh: 'cliff2_cliffs_0', height: 60  },
  { name: 'Mbappé Dictator Mountain',   type: 'landmark', x:   800, z: -1850, color: 0xc8d8e8, biome: 'snow',       modelMesh: 'cliff3_cliffs_0', height: 120 },
];

const PLACES_BY_CHUNK = new Map();
for (const p of PLACES) {
  const cx = Math.floor((p.x + CHUNK_SIZE / 2) / CHUNK_SIZE);
  const cz = Math.floor((p.z + CHUNK_SIZE / 2) / CHUNK_SIZE);
  const key = `${cx},${cz}`;
  if (!PLACES_BY_CHUNK.has(key)) PLACES_BY_CHUNK.set(key, []);
  PLACES_BY_CHUNK.get(key).push(p);
}

// ============================================================
// Estado del módulo (privado)
// ============================================================
let scene = null;
const chunks = new Map();
const chunkBuildQueue = [];
const terrainMeshes = [];
const interactableMeshes = [];
const chunkColliders = new Map();

let TREE_GEOMS = null;
let DECORATION_GEOMS = null;

const cTmp   = new THREE.Color();
const cBase  = new THREE.Color();
const cLight = new THREE.Color();
const cDark  = new THREE.Color();

let started = false;

// ============================================================
// API pública: lifecycle
// ============================================================
export async function start(opts) {
  if (started) {
    console.warn('[terrain] start() llamado dos veces sin stop()');
    stop();
  }
  scene = opts.scene;
  initTreeGeometries();
  await loadBiomeTextures();           // Sesión 12 — texturas de suelo
  await loadGLBTrees();
  await loadGLBDecorations();
  started = true;
}

export function stop() {
  if (!started) return;
  for (const key of Array.from(chunks.keys())) unloadChunk(key);
  chunkBuildQueue.length = 0;
  terrainMeshes.length = 0;
  interactableMeshes.length = 0;
  chunkColliders.clear();

  if (TREE_GEOMS) {
    for (const t of Object.values(TREE_GEOMS)) {
      t.trunkGeom?.dispose(); t.trunkMat?.dispose();
      t.canopyGeom?.dispose(); t.canopyMat?.dispose();
      if (t.glbParts) for (const p of t.glbParts) { p.geometry?.dispose(); p.material?.dispose(); }
    }
    TREE_GEOMS = null;
  }
  if (DECORATION_GEOMS) {
    for (const d of Object.values(DECORATION_GEOMS)) {
      if (d.glbParts) for (const p of d.glbParts) { p.geometry?.dispose(); p.material?.dispose(); }
    }
    DECORATION_GEOMS = null;
  }
  // Sesión 12 — landmark meshes
  if (LANDMARK_GEOMS) {
    for (const parts of Object.values(LANDMARK_GEOMS)) {
      for (const p of parts) { p.geometry?.dispose(); p.material?.dispose(); }
    }
    LANDMARK_GEOMS = null;
  }
  // Sesión 12 — limpiar texturas
  for (const tex of Object.values(BIOME_TEXTURES)) tex?.dispose?.();
  for (const k of Object.keys(BIOME_TEXTURES)) delete BIOME_TEXTURES[k];

  scene = null;
  started = false;
}

/**
 * Carga sincrona de chunks alrededor de (x, z). Usar al inicio del world
 * o tras un teleport para que no se vean huecos durante un frame.
 */
export function primeChunks(x, z) {
  const { cx, cz } = chunkKeyAt(x, z);
  for (let dz = -RENDER_RADIUS; dz <= RENDER_RADIUS; dz++) {
    for (let dx = -RENDER_RADIUS; dx <= RENDER_RADIUS; dx++) {
      if (chunkInsideWorld(cx + dx, cz + dz)) loadChunk(cx + dx, cz + dz);
    }
  }
}

/**
 * Tick por frame: queueing de nuevos chunks por proximidad + procesado
 * incremental de la cola + animación de spinners en places.
 */
export function update(dt, playerX, playerZ) {
  if (!started) return;
  updateChunkLoading(playerX, playerZ);
  processChunkQueue();
  updateSpinners(dt);
}

// ============================================================
// API pública: queries para raycast / drawing
// ============================================================
export function getTerrainMeshes() { return terrainMeshes; }
export function getInteractableMeshes() { return interactableMeshes; }

// ============================================================
// API pública: queries puras
// ============================================================
export function biomeAt(x, z) {
  if (x < WILDERNESS_X) return BIOMES.wilderness;
  if (Math.hypot(x, z) < 80) return BIOMES.plaza;
  const nx = (noise2d(x * 0.008, z * 0.008) - 0.5) * 90;
  const nz = (noise2d(x * 0.009 + 50, z * 0.009 + 50) - 0.5) * 90;
  const ex = x + nx;
  const ez = z + nz;
  if (ez < -1300) return BIOMES.snow;
  if (ez > 1450) return BIOMES.beach;
  if (ex > 900 && ez > -700 && ez < 700) return BIOMES.desert;
  if (ez > 700 && ex > 200) return BIOMES.jungle;
  if (ex < -200 && ez > 200 && ez < 900) return BIOMES.swamp;
  if (ez < -400) return BIOMES.forest;
  return BIOMES.plains;
}

export function getRegionInfo(x, z) {
  for (const p of PLACES) {
    // Sesión 12 — landmarks tienen radio proporcional a su altura
    const r = p.type === 'city' ? 130
            : p.type === 'village' ? 80
            : p.type === 'landmark' ? Math.max(150, (p.height || 60) * 1.5)
            : 60;
    if (Math.hypot(p.x - x, p.z - z) < r) {
      return { name: p.name, type: p.type, isWild: p.biome === 'wilderness', isPlace: true };
    }
  }
  if (x < WILDERNESS_X) {
    const depth = (WILDERNESS_X - x) / (WORLD_HALF + WILDERNESS_X);
    let level = 1;
    if (depth > 0.75) level = 50;
    else if (depth > 0.45) level = 30;
    else if (depth > 0.2) level = 10;
    return { name: `Tierras Rotas · Nv. ${level}`, type: 'wilderness', isWild: true };
  }
  const biome = biomeAt(x, z);
  const REGION_NAMES = {
    plaza: 'Plaza Central', plains: 'Llanuras Verdes', forest: 'Bosques del Norte',
    snow: 'Tundra de Picoblanco', desert: 'Desierto de Sol', jungle: 'Selva de Verdis',
    beach: 'Costa del Sur', swamp: 'Pantano del Sauce',
  };
  return { name: REGION_NAMES[biome.id] || 'Tierras Salvajes', type: 'biome' };
}

// ============================================================
// API pública: colisión con troncos
// ============================================================
export function applyCollision(x0, z0, x1, z1) {
  const { cx, cz } = chunkKeyAt(x0, z0);
  const r2 = TREE_COLLISION_RADIUS * TREE_COLLISION_RADIUS;
  const tryX = collidesWithTree(x1, z0, cx, cz, r2);
  const tryZ = collidesWithTree(x0, z1, cx, cz, r2);
  const finalX = tryX ? x0 : x1;
  const finalZ = tryZ ? z0 : z1;
  if (collidesWithTree(finalX, finalZ, cx, cz, r2)) return { x: x0, z: z0 };
  return { x: finalX, z: finalZ };
}

function collidesWithTree(x, z, cx, cz, r2) {
  for (let dz = -1; dz <= 1; dz++) {
    for (let dx = -1; dx <= 1; dx++) {
      const key = `${cx + dx},${cz + dz}`;
      const list = chunkColliders.get(key);
      if (!list) continue;
      for (const c of list) {
        const ddx = c.x - x;
        const ddz = c.z - z;
        if (ddx * ddx + ddz * ddz < r2) return true;
      }
    }
  }
  return false;
}

// ============================================================
// Sesión 12 — Carga de texturas de biomas
// ============================================================
async function loadBiomeTextures() {
  const loader = new THREE.TextureLoader();
  // Carga paralela; fallos individuales no rompen el resto.
  const entries = Object.entries(BIOME_TEXTURE_URLS);
  await Promise.all(entries.map(async ([biomeId, url]) => {
    try {
      const tex = await new Promise((resolve, reject) => {
        loader.load(url, resolve, undefined, reject);
      });
      tex.wrapS = THREE.RepeatWrapping;
      tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set(TILE_REPEAT, TILE_REPEAT);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 4;  // mejora calidad a la distancia
      tex.needsUpdate = true;
      BIOME_TEXTURES[biomeId] = tex;
      console.log(`[terrain] Textura cargada: '${biomeId}' de ${url.split('/').pop()}`);
    } catch (err) {
      console.warn(`[terrain] Textura '${biomeId}' falló (${url}):`, err.message || err);
      // Sin textura → ese bioma usa vertex color como antes.
    }
  }));
}

// ============================================================
// Helpers GLB (compartidos con NPCs en world.js — exportados para sesión 6)
// ============================================================
/**
 * Detecta Z-up (Blender default): si dim Z >> dim Y, asume Z-up.
 */
export function detectsZUp(root) {
  const bbox = new THREE.Box3().setFromObject(root);
  const sizeY = bbox.max.y - bbox.min.y;
  const sizeZ = bbox.max.z - bbox.min.z;
  return sizeZ > sizeY * 1.5;
}

/**
 * Mide la bbox Y de un modelo recorriendo cada mesh y aplicando su
 * matrixWorld a su geometry.boundingBox. Funciona en SkinnedMesh donde
 * setFromObject puede devolver un bbox erróneo si el esqueleto no está
 * bind-poseado en el render loop todavía.
 */
export function measureSkinnedBbox(root) {
  let minY = Infinity, maxY = -Infinity;
  let found = false;
  root.traverse(obj => {
    if (!obj.isMesh || !obj.geometry) return;
    if (!obj.geometry.boundingBox) obj.geometry.computeBoundingBox();
    const bb = obj.geometry.boundingBox;
    if (!bb) return;
    const corners = [
      new THREE.Vector3(bb.min.x, bb.min.y, bb.min.z),
      new THREE.Vector3(bb.min.x, bb.min.y, bb.max.z),
      new THREE.Vector3(bb.min.x, bb.max.y, bb.min.z),
      new THREE.Vector3(bb.min.x, bb.max.y, bb.max.z),
      new THREE.Vector3(bb.max.x, bb.min.y, bb.min.z),
      new THREE.Vector3(bb.max.x, bb.min.y, bb.max.z),
      new THREE.Vector3(bb.max.x, bb.max.y, bb.min.z),
      new THREE.Vector3(bb.max.x, bb.max.y, bb.max.z),
    ];
    for (const c of corners) {
      c.applyMatrix4(obj.matrixWorld);
      if (c.y < minY) minY = c.y;
      if (c.y > maxY) maxY = c.y;
    }
    found = true;
  });
  if (!found) return null;
  return { minY, maxY, sizeY: maxY - minY };
}

/**
 * Rota Z-up→Y-up si necesario, baquea transforms, escala al target height,
 * preserva materiales originales del GLB.
 */
export function bakeGlbModel(root, targetHeight, fallbackColor, forceZUp, forceZUpInvert, forceNoZUp) {
  if (!forceNoZUp && (forceZUp || detectsZUp(root))) {
    root.rotation.x = forceZUpInvert ? (Math.PI / 2) : (-Math.PI / 2);
    root.updateMatrixWorld(true);
  }

  root.traverse(obj => {
    if (obj.isSkinnedMesh && obj.skeleton) {
      obj.skeleton.update();
      if (obj.geometry && !obj.geometry.boundingBox) obj.geometry.computeBoundingBox();
    }
    obj.updateMatrix();
  });
  root.updateMatrixWorld(true);

  const bbox = new THREE.Box3().setFromObject(root);
  let sizeY = bbox.max.y - bbox.min.y;
  let scaleFactor = sizeY > 0.001 ? targetHeight / sizeY : 1.0;

  if (scaleFactor > 50 || scaleFactor < 0.0001) {
    const measured = measureSkinnedBbox(root);
    if (measured && measured.sizeY > 0.001) {
      sizeY = measured.sizeY;
      scaleFactor = targetHeight / sizeY;
      bbox.min.y = measured.minY;
      bbox.max.y = measured.maxY;
      console.warn(`bbox fallback applied: sizeY=${sizeY.toFixed(3)} new scale=${scaleFactor.toFixed(4)}`);
    } else {
      scaleFactor = Math.max(0.001, Math.min(10, scaleFactor));
    }
  }

  const meshes = [];
  root.updateMatrixWorld(true);
  root.traverse(obj => { if (obj.isMesh && obj.geometry) meshes.push(obj); });
  if (meshes.length === 0) return null;

  const parts = meshes.map(m => {
    const geom = m.geometry.clone();
    const mat = m.matrixWorld.clone();
    const scaleMat = new THREE.Matrix4().makeScale(scaleFactor, scaleFactor, scaleFactor);
    const offsetY = -bbox.min.y * scaleFactor;
    const offsetMat = new THREE.Matrix4().makeTranslation(0, offsetY, 0);
    geom.applyMatrix4(mat);
    geom.applyMatrix4(scaleMat);
    geom.applyMatrix4(offsetMat);

    let srcMat = m.material;
    if (Array.isArray(srcMat)) srcMat = srcMat[0];
    let material;
    if (srcMat && (srcMat.isMeshStandardMaterial || srcMat.isMeshLambertMaterial || srcMat.isMeshBasicMaterial)) {
      material = srcMat.clone();
      if (!material.emissive) {
        const fb = new THREE.MeshLambertMaterial({
          color: srcMat.color ? srcMat.color.clone() : new THREE.Color(fallbackColor || 0xffffff),
          map: srcMat.map || null,
        });
        material = fb;
      }
      material.side = THREE.DoubleSide;
      if (srcMat.transparent || srcMat.alphaTest > 0 || srcMat.alphaMap) {
        material.alphaTest = 0.4;
        material.transparent = false;
      }
    } else {
      material = new THREE.MeshLambertMaterial({ color: fallbackColor || 0x808080, side: THREE.DoubleSide });
    }
    return { geometry: geom, material };
  });
  return { parts, scaleFactor };
}

// ============================================================
// Ruido procedural (pure functions)
// ============================================================
function hash2(x, y) {
  let h = (x | 0) * 374761393 + (y | 0) * 668265263;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function noise2d(x, y) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0, fy = y - y0;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const v00 = hash2(x0, y0);
  const v10 = hash2(x0 + 1, y0);
  const v01 = hash2(x0, y0 + 1);
  const v11 = hash2(x0 + 1, y0 + 1);
  const top = v00 * (1 - sx) + v10 * sx;
  const bot = v01 * (1 - sx) + v11 * sx;
  return top * (1 - sy) + bot * sy;
}

// ============================================================
// Tree GLBs (carga + geometrías procedurales fallback)
// ============================================================
function initTreeGeometries() {
  TREE_GEOMS = {};
  for (const [id, def] of Object.entries(TREE_TYPE_DEFS)) {
    const trunkRadius = 0.22 * def.trunkScale;
    const trunkGeom = new THREE.CylinderGeometry(trunkRadius * 0.8, trunkRadius * 1.1, def.height, 6);
    trunkGeom.translate(0, def.height / 2, 0);
    const trunkMat = new THREE.MeshLambertMaterial({ color: def.trunkColor, flatShading: true });
    let canopyGeom;
    if (def.canopyShape === 'sphere') canopyGeom = new THREE.IcosahedronGeometry(def.canopyRadius, 0);
    else if (def.canopyShape === 'cone') canopyGeom = new THREE.ConeGeometry(def.canopyRadius, def.canopyRadius * 2.4, 7);
    else if (def.canopyShape === 'flat') { canopyGeom = new THREE.IcosahedronGeometry(def.canopyRadius, 0); canopyGeom.scale(1, 0.35, 1); }
    else if (def.canopyShape === 'crystal') canopyGeom = new THREE.OctahedronGeometry(def.canopyRadius, 0);
    else canopyGeom = new THREE.IcosahedronGeometry(def.canopyRadius, 0);
    canopyGeom.translate(0, def.height + def.canopyRadius * 0.4, 0);
    const canopyMatOpts = { color: def.canopyColor, flatShading: true };
    if (def.emissive !== undefined) {
      canopyMatOpts.emissive = def.emissive;
      canopyMatOpts.emissiveIntensity = def.emissiveIntensity || 0.3;
    }
    const canopyMat = new THREE.MeshLambertMaterial(canopyMatOpts);
    TREE_GEOMS[id] = { def, id, trunkGeom, trunkMat, canopyGeom, canopyMat, isGLB: false };
  }
}

async function loadGLBTrees() {
  const entries = Object.entries(TREE_GLB_URLS);
  if (entries.length === 0) return;
  const loader = new GLTFLoader();
  await Promise.all(entries.map(async ([typeId, url]) => {
    if (!TREE_GEOMS[typeId]) return;
    try {
      const gltf = await loader.loadAsync(url);
      const baked = bakeGlbModel(gltf.scene, TREE_TYPE_DEFS[typeId].height * 1.4, 0x8a6a4a);
      if (!baked) return;
      TREE_GEOMS[typeId].isGLB = true;
      TREE_GEOMS[typeId].glbParts = baked.parts;
      console.log(`Loaded tree '${typeId}'`);
    } catch (err) {
      console.warn(`Tree '${typeId}' load failed:`, err.message);
    }
  }));
}

// ============================================================
// Decoration GLBs
// ============================================================
// Sesión 12 — Cache de geometrías de mesh individuales del rocks.glb
// indexadas por nombre. Usado para landmarks únicos (cada uno usa UN mesh
// específico del GLB).
let LANDMARK_GEOMS = null;

async function loadGLBDecorations() {
  const entries = Object.entries(DECORATION_GLB_URLS);
  if (entries.length === 0) return;
  DECORATION_GEOMS = {};
  LANDMARK_GEOMS = {};
  const loader = new GLTFLoader();
  await Promise.all(entries.map(async ([typeId, url]) => {
    try {
      const gltf = await loader.loadAsync(url);

      if (typeId === 'rocks') {
        // Sesión 12 — rocks.glb tiene 9 meshes: 6 smallrocks + 1 cluster + 3 cliffs.
        // Para DECORACIÓN solo usamos smallrocks + cluster (cliffs son demasiado
        // grandes incluso escalados). Los cliffs se cachean en LANDMARK_GEOMS
        // para usarse en buildPlaceStructure(type='landmark').
        const smallMeshes = [];
        gltf.scene.traverse(obj => {
          if (!obj.isMesh) return;
          const n = obj.name || '';
          if (n.startsWith('smallrock') || n.startsWith('cluster')) {
            smallMeshes.push(obj);
          } else if (n.startsWith('cliff')) {
            // Cliff individual → cache en LANDMARK_GEOMS por su nombre
            cacheLandmarkMesh(obj, n);
          }
          // floor/ceiling/pilars ya están filtrados en el GLB limpio,
          // pero por si acaso, los ignoramos.
        });

        if (smallMeshes.length === 0) {
          console.warn(`[terrain] rocks.glb cargado pero no se encontraron meshes 'smallrock*' útiles`);
        } else {
          // Bakear cada smallrock como su propia "parte" del DECORATION_GEOMS.
          // Cada part es una rock distinta — el placer instancied elige una al azar.
          const parts = [];
          for (const m of smallMeshes) {
            const wrapper = new THREE.Group();
            wrapper.add(m.clone());
            const baked = bakeGlbModel(wrapper, 1.2, 0x808078);
            if (baked) parts.push(...baked.parts);
          }
          DECORATION_GEOMS[typeId] = { id: typeId, glbParts: parts };
          console.log(`[terrain] Loaded decoration 'rocks': ${smallMeshes.length} variants, ${parts.length} parts`);
        }
      } else if (typeId === 'stones') {
        // Sesión 12 — stones.glb es un PACK MULTI-MESH (12 piedras distintas:
        // Stone_01_Material #2_0 ... Stone_12_Material #2_0). Bug previo:
        // se bakeaba todo junto → las 12 piedras se renderizaban APILADAS en
        // cada punto del chunk. Fix: extraer cada Stone_NN como part separado,
        // y dejar que buildDecorationForChunk con isMultiVariant elija una al
        // azar por instancia (igual que ya hace para rocks).
        const stoneMeshes = [];
        gltf.scene.traverse(obj => {
          if (!obj.isMesh) return;
          const n = obj.name || '';
          if (n.startsWith('Stone_')) stoneMeshes.push(obj);
        });

        if (stoneMeshes.length === 0) {
          console.warn(`[terrain] stones.glb cargado pero no se encontraron meshes 'Stone_NN'`);
        } else {
          const parts = [];
          for (const m of stoneMeshes) {
            const wrapper = new THREE.Group();
            wrapper.add(m.clone());
            // Stones del GLB tienen bbox ~0.2m → bakeamos a 0.4m altura objetivo.
            const baked = bakeGlbModel(wrapper, 0.4, 0x808078);
            if (baked) parts.push(...baked.parts);
          }
          DECORATION_GEOMS[typeId] = { id: typeId, glbParts: parts };
          console.log(`[terrain] Loaded decoration 'stones': ${stoneMeshes.length} variants, ${parts.length} parts`);
        }
      } else {
        // grass, etc — comportamiento original (bakear todo el GLB junto)
        const baked = bakeGlbModel(gltf.scene, typeId === 'grass' ? 0.4 : 1.0,
          typeId === 'grass' ? 0x6a9a3a : 0x808078);
        if (!baked) return;
        DECORATION_GEOMS[typeId] = { id: typeId, glbParts: baked.parts };
        console.log(`Loaded decoration '${typeId}'`);
      }
    } catch (err) {
      console.warn(`Decoration '${typeId}' load failed:`, err.message);
    }
  }));

  // Diagnóstico
  if (LANDMARK_GEOMS && Object.keys(LANDMARK_GEOMS).length > 0) {
    console.log(`[terrain] Landmark meshes en cache:`, Object.keys(LANDMARK_GEOMS).join(', '));
  }
}

/**
 * Sesión 12 — Cachea un mesh individual del rocks.glb por nombre, normalizando
 * escala y posición para que pueda usarse como landmark en buildPlaceStructure.
 * El mesh original es enorme (1000m+ bbox), se bakea con altura objetivo de 1m
 * y luego buildLandmarkStructure lo re-escala al height específico del landmark.
 */
function cacheLandmarkMesh(meshObj, meshName) {
  // Bakear este mesh aislado con altura objetivo 1m → escala unitaria.
  // Luego al construir el landmark, se escala por place.height en metros.
  const wrapper = new THREE.Group();
  wrapper.add(meshObj.clone());
  const baked = bakeGlbModel(wrapper, 1.0, 0x606060);
  if (!baked || baked.parts.length === 0) {
    console.warn(`[terrain] No se pudo bakear landmark mesh '${meshName}'`);
    return;
  }
  LANDMARK_GEOMS[meshName] = baked.parts;
}

function buildDecorationForChunk(cx, cz) {
  if (!DECORATION_GEOMS) return [];
  const origin = chunkOrigin(cx, cz);
  const centerX = origin.x + CHUNK_SIZE / 2;
  const centerZ = origin.z + CHUNK_SIZE / 2;
  const chunkBiome = biomeAt(centerX, centerZ);
  const config = BIOME_DECORATION[chunkBiome.id] || BIOME_DECORATION.plains;
  if (config.density === 0 || config.pool.length === 0) return [];

  const placesHere = PLACES_BY_CHUNK.get(`${cx},${cz}`) || [];
  const placeRadius = placesHere.length > 0 ? Math.max(...placesHere.map(p => p.type === 'city' ? 18 : 12)) : 0;
  const placeX = placesHere[0]?.x;
  const placeZ = placesHere[0]?.z;

  const items = [];
  const N_CANDIDATES = Math.max(6, config.density * 2);
  for (let i = 0; i < N_CANDIDATES; i++) {
    const offX = hash2(cx * 67 + i + 9100, cz * 71 + i * 3 + 9200) * (CHUNK_SIZE - 4) + 2;
    const offZ = hash2(cx * 73 + i * 7 + 9300, cz * 79 + i + 9400) * (CHUNK_SIZE - 4) + 2;
    const wx = origin.x + offX;
    const wz = origin.z + offZ;
    if (placeRadius > 0 && Math.hypot(wx - placeX, wz - placeZ) < placeRadius) continue;
    const rollPick = hash2(cx * 83 + i * 17 + 9500, cz * 89 + i * 19 + 9600);
    const totalW = config.pool.reduce((s, p) => s + p[1], 0);
    let acc = 0, chosenId = null;
    const target = rollPick * totalW;
    for (const [id, w] of config.pool) { acc += w; if (acc >= target) { chosenId = id; break; } }
    if (!chosenId || !DECORATION_GEOMS[chosenId]) continue;
    items.push({ x: wx, z: wz, typeId: chosenId });
    if (items.length >= config.density) break;
  }

  const byType = new Map();
  for (const it of items) {
    if (!byType.has(it.typeId)) byType.set(it.typeId, []);
    byType.get(it.typeId).push(it);
  }

  const outMeshes = [];
  const mat4 = new THREE.Matrix4();
  const ZERO_MAT = new THREE.Matrix4().makeScale(0, 0, 0);  // matriz "vacía" para hide
  for (const [typeId, list] of byType) {
    const dg = DECORATION_GEOMS[typeId];
    const cfg = DECORATION_CONFIG[typeId];
    if (!dg || !cfg) continue;

    // Sesión 12 — Para GLBs multi-mesh (rocks, stones), cada instancia elige
    // UN solo mesh-variant al azar de los parts disponibles. El resto de la
    // lista queda hide (matriz cero) en ese InstancedMesh, garantizando que
    // solo un modelo se renderiza por posición. Sin esto, los packs como
    // stones.glb (12 Stone_NN) renderizan las 12 piedras APILADAS en cada
    // punto, generando el bug visual de "rocas volando una sobre otra".
    const isMultiVariant = (typeId === 'rocks' || typeId === 'stones') && dg.glbParts.length > 1;

    if (isMultiVariant) {
      // Pre-asignar variant aleatoria por item
      const variantByItem = list.map((it, idx) => {
        const r = hash2((it.x * 37) | 0, (it.z * 41) | 0);
        return Math.floor(r * dg.glbParts.length);
      });

      for (let pIdx = 0; pIdx < dg.glbParts.length; pIdx++) {
        const part = dg.glbParts[pIdx];
        const inst = new THREE.InstancedMesh(part.geometry, part.material, list.length);
        inst.userData = { kind: 'decoration', decorationType: typeId };
        for (let i = 0; i < list.length; i++) {
          if (variantByItem[i] !== pIdx) {
            // No es esta variant: hide
            inst.setMatrixAt(i, ZERO_MAT);
            continue;
          }
          const it = list[i];
          const rng1 = hash2((it.x * 19) | 0, (it.z * 23) | 0);
          const rng2 = hash2((it.x * 29) | 0, (it.z * 31) | 0);
          const rotY = rng1 * Math.PI * 2;
          const scl = cfg.scaleMin + rng2 * (cfg.scaleMax - cfg.scaleMin);
          mat4.makeRotationY(rotY);
          mat4.scale(new THREE.Vector3(scl, scl, scl));
          mat4.setPosition(it.x, 0, it.z);
          inst.setMatrixAt(i, mat4);
        }
        inst.instanceMatrix.needsUpdate = true;
        outMeshes.push(inst);
      }
      continue;  // saltarse el path original
    }

    // Path original (stones, grass, single-part): cada part en cada posición
    for (const part of dg.glbParts) {
      const inst = new THREE.InstancedMesh(part.geometry, part.material, list.length);
      inst.userData = { kind: 'decoration', decorationType: typeId };
      for (let i = 0; i < list.length; i++) {
        const it = list[i];
        const rng1 = hash2((it.x * 19) | 0, (it.z * 23) | 0);
        const rng2 = hash2((it.x * 29) | 0, (it.z * 31) | 0);
        const rotY = rng1 * Math.PI * 2;
        const scl = cfg.scaleMin + rng2 * (cfg.scaleMax - cfg.scaleMin);
        mat4.makeRotationY(rotY);
        mat4.scale(new THREE.Vector3(scl, scl, scl));
        mat4.setPosition(it.x, 0, it.z);
        inst.setMatrixAt(i, mat4);
      }
      inst.instanceMatrix.needsUpdate = true;
      outMeshes.push(inst);
    }
  }
  return outMeshes;
}

// ============================================================
// Chunks
// ============================================================
function chunkKeyAt(x, z) {
  const cx = Math.floor((x + CHUNK_SIZE / 2) / CHUNK_SIZE);
  const cz = Math.floor((z + CHUNK_SIZE / 2) / CHUNK_SIZE);
  return { cx, cz, key: `${cx},${cz}` };
}

function chunkOrigin(cx, cz) {
  return { x: cx * CHUNK_SIZE - CHUNK_SIZE / 2, z: cz * CHUNK_SIZE - CHUNK_SIZE / 2 };
}

function chunkInsideWorld(cx, cz) {
  const origin = chunkOrigin(cx, cz);
  const maxX = origin.x + CHUNK_SIZE;
  const maxZ = origin.z + CHUNK_SIZE;
  if (maxX < -WORLD_HALF) return false;
  if (origin.x > WORLD_HALF) return false;
  if (maxZ < -WORLD_HALF) return false;
  if (origin.z > WORLD_HALF) return false;
  return true;
}

function updateChunkLoading(playerX, playerZ) {
  const { cx, cz } = chunkKeyAt(playerX, playerZ);
  const wants = [];
  for (let dz = -RENDER_RADIUS; dz <= RENDER_RADIUS; dz++) {
    for (let dx = -RENDER_RADIUS; dx <= RENDER_RADIUS; dx++) {
      const ncx = cx + dx;
      const ncz = cz + dz;
      if (!chunkInsideWorld(ncx, ncz)) continue;
      const key = `${ncx},${ncz}`;
      if (!chunks.has(key)) wants.push({ key, cx: ncx, cz: ncz, d: dx * dx + dz * dz });
    }
  }
  wants.sort((a, b) => a.d - b.d);
  for (const w of wants) if (!chunkBuildQueue.find(c => c.key === w.key)) chunkBuildQueue.push(w);
  const limit = RENDER_RADIUS + 1;
  for (const key of Array.from(chunks.keys())) {
    const [kx, kz] = key.split(',').map(Number);
    if (Math.abs(kx - cx) > limit || Math.abs(kz - cz) > limit) unloadChunk(key);
  }
}

function processChunkQueue() {
  if (chunkBuildQueue.length === 0) return;
  const next = chunkBuildQueue.shift();
  if (chunks.has(next.key)) return;
  if (!chunkInsideWorld(next.cx, next.cz)) return;
  loadChunk(next.cx, next.cz);
}

function loadChunk(cx, cz) {
  const key = `${cx},${cz}`;
  if (chunks.has(key)) return;
  const origin = chunkOrigin(cx, cz);
  const geom = new THREE.PlaneGeometry(CHUNK_SIZE, CHUNK_SIZE, CHUNK_SEGS, CHUNK_SEGS);
  geom.rotateX(-Math.PI / 2);
  geom.translate(origin.x + CHUNK_SIZE / 2, 0, origin.z + CHUNK_SIZE / 2);
  paintChunkVertices(geom);
  geom.computeVertexNormals();

  // Sesión 12 — Material por chunk:
  //   - Si hay textura para el bioma del centro del chunk: MeshLambertMaterial
  //     con map + vertexColors (la textura modula con el color del vertex,
  //     que ya lleva la variación clara/oscura del paintChunkVertices).
  //   - Si no hay textura: comportamiento previo (solo vertex colors).
  const centerX = origin.x + CHUNK_SIZE / 2;
  const centerZ = origin.z + CHUNK_SIZE / 2;
  const chunkBiome = biomeAt(centerX, centerZ);
  const tex = BIOME_TEXTURES[chunkBiome.id] || null;

  const matOpts = { vertexColors: true };
  if (tex) {
    matOpts.map = tex;
    // Cuando hay textura, los vertex colors deben ser cercanos a blanco
    // para no oscurecer la textura. Como paintChunkVertices genera colores
    // del bioma (no neutros), el efecto multiplicativo da un resultado
    // sutilmente tintado del color del bioma. Es lo que queremos: textura
    // base + leve tinte de iluminación local.
  }
  const mat = new THREE.MeshLambertMaterial(matOpts);
  const mesh = new THREE.Mesh(geom, mat);
  mesh.userData.kind = 'terrain';
  scene.add(mesh);
  terrainMeshes.push(mesh);

  const placeStructures = [];
  const placesHere = PLACES_BY_CHUNK.get(key) || [];
  for (const p of placesHere) {
    const group = buildPlaceStructure(p);
    scene.add(group);
    placeStructures.push(group);
  }
  const treeMeshes = buildTreesForChunk(cx, cz);
  for (const m of treeMeshes) { scene.add(m); interactableMeshes.push(m); }

  const colliders = [];
  for (const m of treeMeshes) {
    if (m.userData?.kind !== 'tree-trunk') continue;
    const list = m.userData.trees;
    if (!list) continue;
    for (const t of list) {
      if (t.typeId === 'bush_small') continue;
      colliders.push({ x: t.x, z: t.z });
    }
  }
  chunkColliders.set(key, colliders);

  const decorMeshes = buildDecorationForChunk(cx, cz);
  for (const m of decorMeshes) scene.add(m);
  chunks.set(key, { mesh, placeStructures, treeMeshes, decorMeshes });
}

function unloadChunk(key) {
  const chunk = chunks.get(key);
  if (!chunk) return;
  if (chunk.mesh) {
    if (scene) scene.remove(chunk.mesh);
    chunk.mesh.geometry.dispose();
    chunk.mesh.material.dispose();
    const idx = terrainMeshes.indexOf(chunk.mesh);
    if (idx >= 0) terrainMeshes.splice(idx, 1);
  }
  for (const lm of chunk.placeStructures || []) {
    if (scene) scene.remove(lm);
    lm.traverse(o => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        if (Array.isArray(o.material)) o.material.forEach(m => m.dispose());
        else o.material.dispose();
      }
    });
  }
  for (const m of chunk.treeMeshes || []) {
    if (scene) scene.remove(m);
    const idx = interactableMeshes.indexOf(m);
    if (idx >= 0) interactableMeshes.splice(idx, 1);
    m.dispose?.();
  }
  for (const m of chunk.decorMeshes || []) { if (scene) scene.remove(m); m.dispose?.(); }
  chunkColliders.delete(key);
  chunks.delete(key);
}

function paintChunkVertices(geom) {
  const vc = geom.attributes.position.count;
  const colors = new Float32Array(vc * 3);
  for (let i = 0; i < vc; i++) {
    const wx = geom.attributes.position.getX(i);
    const wz = geom.attributes.position.getZ(i);
    const biome = biomeAt(wx, wz);
    cBase.setHex(biome.base);
    cLight.setHex(biome.light);
    cDark.setHex(biome.dark);
    const rng = hash2((wx * 100) | 0, (wz * 100) | 0);
    const v = rng - 0.5;
    cTmp.copy(cBase);
    if (v > 0) cTmp.lerp(cLight, v * 0.85); else cTmp.lerp(cDark, -v * 0.85);
    // Sesión 12 — Cuando el chunk lleva textura, este color se multiplica
    // contra la textura. Lo dejamos tal cual: cBase ya está cercano al tono
    // promedio de la textura del bioma, así que multiplicar produce el color
    // textura ligeramente tintado de iluminación local. Si quedara
    // demasiado oscuro, podríamos clampear hacia arriba (lerp a blanco
    // 0.5), pero antes prueba real.
    colors[i * 3] = cTmp.r;
    colors[i * 3 + 1] = cTmp.g;
    colors[i * 3 + 2] = cTmp.b;
  }
  geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
}

// ============================================================
// Places (ciudades, pueblos, ruinas...)
// ============================================================
function buildPlaceStructure(place) {
  const group = new THREE.Group();
  group.position.set(place.x, 0, place.z);
  const stoneMat  = new THREE.MeshLambertMaterial({ color: 0x666666, flatShading: true });
  const accentMat = new THREE.MeshLambertMaterial({ color: place.color, flatShading: true });
  switch (place.type) {
    case 'city':
      group.add(makeBase(3.5, 0.5, stoneMat));
      group.add(makeBase(2.8, 0.4, stoneMat, 0.5));
      group.add(makeColumn(10, 0.8, accentMat, 0.9));
      group.add(makeIcoTop(1.0, accentMat, 0.9 + 10 + 0.5, true));
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
        const sat = new THREE.Group();
        sat.position.set(Math.cos(a) * 5, 0, Math.sin(a) * 5);
        sat.add(makeBase(1.4, 0.3, stoneMat));
        sat.add(makeColumn(6, 0.45, accentMat, 0.4));
        sat.add(makeIcoTop(0.5, accentMat, 6.7));
        group.add(sat);
      }
      break;
    case 'village':
      group.add(makeBase(2.2, 0.4, stoneMat));
      group.add(makeColumn(6, 0.5, accentMat, 0.5));
      group.add(makeIcoTop(0.6, accentMat, 6.8, true));
      for (let i = 0; i < 2; i++) {
        const a = (i / 2) * Math.PI + Math.PI / 4;
        const sat = new THREE.Group();
        sat.position.set(Math.cos(a) * 2.8, 0, Math.sin(a) * 2.8);
        sat.add(makeBase(1.0, 0.25, stoneMat));
        sat.add(makeColumn(3.5, 0.35, accentMat, 0.3));
        group.add(sat);
      }
      break;
    case 'tower':
      group.add(makeBase(2.0, 0.5, stoneMat));
      group.add(makeColumn(15, 0.55, accentMat, 0.6));
      {
        const roof = new THREE.Mesh(new THREE.ConeGeometry(1.2, 2.5, 8), accentMat);
        roof.position.y = 0.6 + 15 + 1.25;
        group.add(roof);
      }
      group.add(makeIcoTop(0.35, accentMat, 0.6 + 15 + 2.6, true));
      break;
    case 'mine': {
      const base = new THREE.Mesh(new THREE.BoxGeometry(4, 1.5, 4), stoneMat);
      base.position.y = 0.75; group.add(base);
      const entry = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.6, 0.4), new THREE.MeshLambertMaterial({ color: 0x101010 }));
      entry.position.set(0, 0.85, 2.0); group.add(entry);
      const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.6, 0), accentMat);
      crystal.position.y = 2.0; crystal.userData.spin = true; group.add(crystal);
      break;
    }
    case 'temple': {
      const base = new THREE.Mesh(new THREE.CylinderGeometry(3, 3.3, 0.6, 12), new THREE.MeshLambertMaterial({ color: 0xc8c0b0, flatShading: true }));
      base.position.y = 0.3; group.add(base);
      group.add(makeColumn(8, 0.6, new THREE.MeshLambertMaterial({ color: 0xe8e0cc, flatShading: true }), 0.6));
      const top = new THREE.Mesh(new THREE.IcosahedronGeometry(0.9, 0), new THREE.MeshLambertMaterial({ color: 0xfff4d0, emissive: 0xc8a040, emissiveIntensity: 0.5, flatShading: true }));
      top.position.y = 0.6 + 8 + 0.5; top.userData.spin = true; group.add(top);
      break;
    }
    case 'ruins': {
      const positions = [[-1.5, 0, 0], [1.0, 0, -1.2], [0.5, 0, 1.5]];
      const heights = [2.5, 1.8, 3.0];
      for (let i = 0; i < 3; i++) {
        const sub = new THREE.Group();
        sub.position.set(positions[i][0], 0, positions[i][2]);
        sub.add(makeColumn(heights[i], 0.4, stoneMat, 0));
        sub.rotation.z = (Math.random() - 0.5) * 0.15;
        group.add(sub);
      }
      break;
    }
    case 'altar': {
      const slab = new THREE.Mesh(new THREE.BoxGeometry(3.5, 0.6, 2.5), stoneMat);
      slab.position.y = 0.3; group.add(slab);
      const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(1.0, 0), new THREE.MeshLambertMaterial({ color: place.color, emissive: 0x4a1030, emissiveIntensity: 0.6, flatShading: true }));
      crystal.position.y = 1.6; crystal.userData.spin = true; group.add(crystal);
      break;
    }
    case 'boss': {
      group.add(makeBase(3.5, 0.6, stoneMat));
      const bossMat = new THREE.MeshLambertMaterial({ color: place.color, emissive: 0x4a0000, emissiveIntensity: 0.35, flatShading: true });
      group.add(makeColumn(12, 0.9, bossMat, 0.7));
      const skull = new THREE.Mesh(new THREE.IcosahedronGeometry(1.2, 0), bossMat);
      skull.position.y = 0.7 + 12 + 0.6; skull.userData.spin = true; group.add(skull);
      break;
    }
    case 'landmark': {
      // Sesión 12 — Landmark único: mesh GLB específico del rocks.glb
      // cacheado en LANDMARK_GEOMS. Si no se cargó (404 de R2 o nombre
      // mal), fallback a placeholder visible para que sepamos algo falló.
      const meshName = place.modelMesh;
      const heightM = place.height || 60;
      const parts = LANDMARK_GEOMS?.[meshName];
      if (parts && parts.length > 0) {
        for (const part of parts) {
          const m = new THREE.Mesh(part.geometry, part.material);
          // bakeGlbModel ya bakó al height 1m, así que escala = heightM da
          // el tamaño final deseado en world space.
          m.scale.set(heightM, heightM, heightM);
          group.add(m);
        }
      } else {
        // Fallback: cono naranja grande para detectar que el landmark no se cargó
        console.warn(`[terrain] Landmark '${place.name}' sin mesh '${meshName}' en LANDMARK_GEOMS — usando fallback`);
        const fallback = new THREE.Mesh(
          new THREE.ConeGeometry(heightM * 0.4, heightM, 8),
          new THREE.MeshLambertMaterial({ color: 0xff8800, flatShading: true })
        );
        fallback.position.y = heightM / 2;
        group.add(fallback);
      }
      break;
    }
  }
  group.userData.place = place;
  return group;
}

function makeBase(size, h, mat, yOffset = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(size, h, size), mat);
  m.position.y = h / 2 + yOffset;
  return m;
}
function makeColumn(height, radius, mat, yOffset) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.85, radius, height, 8), mat);
  m.position.y = yOffset + height / 2;
  return m;
}
function makeIcoTop(r, mat, yPos, spin = false) {
  const m = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 0), mat);
  m.position.y = yPos;
  if (spin) m.userData.spin = true;
  return m;
}

// ============================================================
// Tree placement por chunk (instanced mesh)
// ============================================================
function buildTreesForChunk(cx, cz) {
  const origin = chunkOrigin(cx, cz);
  const centerX = origin.x + CHUNK_SIZE / 2;
  const centerZ = origin.z + CHUNK_SIZE / 2;
  const chunkBiome = biomeAt(centerX, centerZ);
  const config = BIOME_TREES[chunkBiome.id] || BIOME_TREES.plains;
  if (config.density === 0 || config.pool.length === 0) return [];

  const placesHere = PLACES_BY_CHUNK.get(`${cx},${cz}`) || [];
  const placeRadius = placesHere.length > 0 ? Math.max(...placesHere.map(p => p.type === 'city' ? 18 : 12)) : 0;
  const placeX = placesHere[0]?.x;
  const placeZ = placesHere[0]?.z;

  const trees = [];
  const MIN_SPACING = 4.0;
  const N_CANDIDATES = Math.max(8, config.density * 2);
  for (let i = 0; i < N_CANDIDATES; i++) {
    const offX = hash2(cx * 31 + i + 100, cz * 37 + i * 3 + 50) * (CHUNK_SIZE - 4) + 2;
    const offZ = hash2(cx * 41 + i * 7 + 200, cz * 43 + i + 300) * (CHUNK_SIZE - 4) + 2;
    const wx = origin.x + offX;
    const wz = origin.z + offZ;
    if (placeRadius > 0 && Math.hypot(wx - placeX, wz - placeZ) < placeRadius) continue;
    const localBiome = biomeAt(wx, wz);
    const localConfig = BIOME_TREES[localBiome.id];
    if (!localConfig || localConfig.pool.length === 0) continue;
    const rollPick = hash2(cx * 53 + i * 11 + 700, cz * 59 + i * 13 + 800);
    const totalW = localConfig.pool.reduce((s, p) => s + p[1], 0);
    let acc = 0, chosenId = null;
    const target = rollPick * totalW;
    for (const [id, w] of localConfig.pool) { acc += w; if (acc >= target) { chosenId = id; break; } }
    if (!chosenId) continue;
    let tooClose = false;
    for (const t of trees) {
      const dx = t.x - wx, dz = t.z - wz;
      if (dx * dx + dz * dz < MIN_SPACING * MIN_SPACING) { tooClose = true; break; }
    }
    if (tooClose) continue;
    trees.push({ x: wx, z: wz, typeId: chosenId });
    if (trees.length >= config.density) break;
  }

  const byType = new Map();
  for (const t of trees) {
    if (!byType.has(t.typeId)) byType.set(t.typeId, []);
    byType.get(t.typeId).push(t);
  }

  const outMeshes = [];
  const mat4 = new THREE.Matrix4();
  for (const [typeId, list] of byType) {
    const tg = TREE_GEOMS[typeId];
    if (!tg) continue;
    const parts = tg.isGLB && tg.glbParts
      ? tg.glbParts.map((p, idx) => ({ geometry: p.geometry, material: p.material, kind: idx === 0 ? 'tree-trunk' : 'tree-canopy' }))
      : [
          { geometry: tg.trunkGeom, material: tg.trunkMat, kind: 'tree-trunk' },
          { geometry: tg.canopyGeom, material: tg.canopyMat, kind: 'tree-canopy' },
        ];
    for (const part of parts) {
      const inst = new THREE.InstancedMesh(part.geometry, part.material, list.length);
      inst.userData = { kind: part.kind, treeType: tg.def, typeId, trees: list };
      for (let i = 0; i < list.length; i++) {
        const t = list[i];
        const rng1 = hash2((t.x * 7) | 0, (t.z * 11) | 0);
        const rng2 = hash2((t.x * 13) | 0, (t.z * 17) | 0);
        const rotY = rng1 * Math.PI * 2;
        const isBush = typeId === 'bush';
        const sMin = isBush ? 0.7 : TREE_SCALE_MIN;
        const sMax = isBush ? 1.3 : TREE_SCALE_MAX;
        const scl = sMin + rng2 * (sMax - sMin);
        mat4.makeRotationY(rotY);
        mat4.scale(new THREE.Vector3(scl, scl, scl));
        mat4.setPosition(t.x, 0, t.z);
        inst.setMatrixAt(i, mat4);
      }
      inst.instanceMatrix.needsUpdate = true;
      outMeshes.push(inst);
    }
  }
  return outMeshes;
}

// ============================================================
// Spinners (cristales / iconos que rotan en places)
// ============================================================
function updateSpinners(dt) {
  for (const { placeStructures } of chunks.values()) {
    for (const ps of placeStructures || []) {
      ps.traverse(o => { if (o.userData.spin) o.rotation.y += dt * 0.5; });
    }
  }
}
