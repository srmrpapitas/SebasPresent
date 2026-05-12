/**
 * SebasPresent — World module (Slice 3 — Remy + minimap + better joystick + GLB trees + scaled)
 *
 * Same 4096×4096m bounded continent as Slice 2.8 (biomes, 20 named
 * places, Wilderness). New in Slice 3:
 *   - Mixamo character replaces the red capsule, with idle/walk/run state
 *     machine driven by movement.
 *   - Camera-relative joystick: pushing forward moves in the direction
 *     the camera is facing (not world +z).
 *   - Minimap in top-left corner: shows player, nearby places, and a
 *     red shaded area for the Wilderness.
 *   - Some tree types (oak, mahogany) now load from R2 as GLB models;
 *     others remain procedural geometry. Failed GLB loads fall back to
 *     procedural geometry automatically.
 *   - Trees scaled 1.5x to 3x per instance for varied, larger forests.
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Character } from './character.js';

// Same R2 base that character.js uses. Trees live under /trees/<id>.glb
const R2_BASE = 'https://pub-bb63b96c76c745f59a39649cde6678c0.r2.dev';

// Which tree type IDs have a GLB on R2 right now. Edit this list as
// you upload more models. Missing entries keep their procedural look.
const TREE_GLB_URLS = {
  oak:        `${R2_BASE}/trees/oak.glb`,
  mahogany:   `${R2_BASE}/trees/mahogany.glb`,
  maple:      `${R2_BASE}/trees/maple.glb`,
  willow:     `${R2_BASE}/trees/willow.glb`,
  teak:       `${R2_BASE}/trees/teak.glb`,
  magic:      `${R2_BASE}/trees/magic.glb`,
  bush:       `${R2_BASE}/trees/bush.glb`,
  bush_small: `${R2_BASE}/trees/bush_small.glb`,
};

// Rocks and grass — decoration objects (not choppable, no XP)
const DECORATION_GLB_URLS = {
  stones:     `${R2_BASE}/decoration/stones.glb`,
  cave_rocks: `${R2_BASE}/decoration/cave_rocks.glb`,
  grass:      `${R2_BASE}/decoration/grass.glb`,
};

// ============================================================
//                       World layout
// ============================================================

const WORLD_HALF     = 2048;
const WILDERNESS_X   = -1024;

const CHUNK_SIZE     = 64;
const CHUNK_SEGS     = 32;
const RENDER_RADIUS  = 3;
const PLAYER_RUN     = 7.0;
const PLAYER_WALK    = 3.5;
const FOG_NEAR       = CHUNK_SIZE * 2;
const FOG_FAR        = CHUNK_SIZE * (RENDER_RADIUS + 0.5);

// Tree instance scale range. Each tree gets a random scale within this
// range, creating varied forests with a mix of medium and very tall
// trees. Applied to BOTH procedural and GLB trees.
const TREE_SCALE_MIN = 1.5;
const TREE_SCALE_MAX = 3.0;

const PALETTE = {
  sky:     0x9ec0d6,
  fog:     0xa8c4d8,
  skyWild: 0x6a4040,
  fogWild: 0x6a3838,
  ocean:   0x4a7896,
  player:  0xc04a3a,
  marker:  0xfff04a,
};

const BIOMES = {
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
  normal:   { name: 'Árbol',         chopLevel: 1,  xpReward: 25,  logItem: 'logs',
              trunkColor: 0x6b4423, canopyColor: 0x4a7a2a, trunkScale: 1.0, height: 2.5, canopyShape: 'sphere', canopyRadius: 1.4 },
  oak:      { name: 'Roble',         chopLevel: 15, xpReward: 37,  logItem: 'oak_logs',
              trunkColor: 0x5a3618, canopyColor: 0x3d6420, trunkScale: 1.3, height: 3.4, canopyShape: 'sphere', canopyRadius: 2.0 },
  palm:     { name: 'Palmera',       chopLevel: 20, xpReward: 35,  logItem: 'palm_logs',
              trunkColor: 0x8b6c3c, canopyColor: 0x88a838, trunkScale: 0.7, height: 4.5, canopyShape: 'flat', canopyRadius: 2.2 },
  pine:     { name: 'Pino',          chopLevel: 30, xpReward: 65,  logItem: 'pine_logs',
              trunkColor: 0x4a2a14, canopyColor: 0x2a5028, trunkScale: 0.85, height: 4.2, canopyShape: 'cone', canopyRadius: 1.4 },
  maple:    { name: 'Arce',          chopLevel: 45, xpReward: 100, logItem: 'maple_logs',
              trunkColor: 0x6a4528, canopyColor: 0xb04826, trunkScale: 1.1, height: 3.6, canopyShape: 'sphere', canopyRadius: 1.9 },
  mahogany: { name: 'Caoba',         chopLevel: 50, xpReward: 125, logItem: 'mahogany_logs',
              trunkColor: 0x5a2818, canopyColor: 0x2a5a1c, trunkScale: 1.4, height: 4.0, canopyShape: 'sphere', canopyRadius: 2.2 },
  yew:      { name: 'Tejo',          chopLevel: 60, xpReward: 175, logItem: 'yew_logs',
              trunkColor: 0x2a1a10, canopyColor: 0x1a4438, trunkScale: 1.6, height: 4.2, canopyShape: 'sphere', canopyRadius: 2.3 },
  magic:    { name: 'Árbol Mágico',  chopLevel: 75, xpReward: 250, logItem: 'magic_logs',
              trunkColor: 0xa8b8d0, canopyColor: 0x88ddff, trunkScale: 1.2, height: 4.5, canopyShape: 'crystal', canopyRadius: 2.0,
              emissive: 0x4488ff, emissiveIntensity: 0.45 },
  dead:     { name: 'Árbol Muerto',  chopLevel: 1,  xpReward: 12,  logItem: 'dead_logs',
              trunkColor: 0x3a2818, canopyColor: 0x4a3828, trunkScale: 0.9, height: 3.2, canopyShape: 'crystal', canopyRadius: 1.0 },
  willow:   { name: 'Sauce',         chopLevel: 30, xpReward: 67,  logItem: 'willow_logs',
              trunkColor: 0x6a5028, canopyColor: 0x8aa848, trunkScale: 1.2, height: 3.8, canopyShape: 'sphere', canopyRadius: 2.2 },
  teak:     { name: 'Teca',          chopLevel: 35, xpReward: 85,  logItem: 'teak_logs',
              trunkColor: 0x6a4218, canopyColor: 0x4a7028, trunkScale: 1.1, height: 3.8, canopyShape: 'sphere', canopyRadius: 2.0 },
  bush:     { name: 'Arbusto',       chopLevel: 1,  xpReward: 8,   logItem: 'bush_leaves',
              trunkColor: 0x5a4028, canopyColor: 0x4a7a30, trunkScale: 0.5, height: 0.6, canopyShape: 'sphere', canopyRadius: 0.9 },
  bush_small: { name: 'Matorral',    chopLevel: 1,  xpReward: 5,   logItem: 'bush_leaves',
              trunkColor: 0x5a4028, canopyColor: 0x6a8a40, trunkScale: 0.4, height: 0.4, canopyShape: 'sphere', canopyRadius: 0.6 },
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

const PLACES = [
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
//                       Module state
// ============================================================

let scene, camera, renderer, clock, raycaster, ocean;
let player, marker;
let character = null;
let characterFallback = false;
let user = null;
let running = false;
let canvas = null;

let cameraDist = 9;
let cameraYaw = Math.PI * 0.25;
let cameraPitch = Math.PI * 0.22;

let playerTarget = null;
let joyState = { active: false, x: 0, y: 0 };

const chunks = new Map();
const chunkBuildQueue = [];
const terrainMeshes = [];
const interactableMeshes = [];

let listeners = [];
let resizeRaf = null;

const cTmp   = new THREE.Color();
const cBase  = new THREE.Color();
const cLight = new THREE.Color();
const cDark  = new THREE.Color();

let TREE_GEOMS = null;

let lastRegionName = '';
let lastRegionWasWild = false;

// Minimap state
let minimapCanvas = null;
let minimapCtx = null;

// ============================================================
//                       Public API
// ============================================================

export async function startWorld(loggedInUser) {
  if (running) return;
  user = loggedInUser;

  showWorldLoading('Cargando el reino…');

  try {
    initTreeGeometries();
    setupScene();
    setupOcean();
    showWorldLoading('Cargando árboles…');
    await loadGLBTrees();
    showWorldLoading('Cargando decoración…');
    await loadGLBDecorations();
    await setupPlayer();
    setupMarker();
    setupInput();
    setupMinimap();

    clock = new THREE.Clock();
    running = true;

    primeInitialChunks();

    hideWorldLoading();
    animate();
  } catch (err) {
    console.error('World init failed:', err);
    showWorldLoading('Error cargando el mundo: ' + (err.message || 'desconocido'));
  }
}

export function stopWorld() {
  running = false;

  for (const { target, type, fn, opts } of listeners) {
    try { target.removeEventListener(type, fn, opts); } catch {}
  }
  listeners = [];

  for (const key of Array.from(chunks.keys())) unloadChunk(key);
  chunkBuildQueue.length = 0;
  terrainMeshes.length = 0;
  interactableMeshes.length = 0;

  if (TREE_GEOMS) {
    for (const t of Object.values(TREE_GEOMS)) {
      t.trunkGeom?.dispose();
      t.trunkMat?.dispose();
      t.canopyGeom?.dispose();
      t.canopyMat?.dispose();
      if (t.glbParts) {
        for (const part of t.glbParts) {
          part.geometry?.dispose();
          part.material?.dispose();
        }
      }
    }
    TREE_GEOMS = null;
  }

  if (DECORATION_GEOMS) {
    for (const d of Object.values(DECORATION_GEOMS)) {
      if (d.glbParts) {
        for (const part of d.glbParts) {
          part.geometry?.dispose();
          part.material?.dispose();
        }
      }
    }
    DECORATION_GEOMS = null;
  }

  if (character) {
    character.dispose();
    character = null;
  }
  characterFallback = false;

  if (renderer) {
    renderer.dispose();
    renderer = null;
  }
  if (scene) {
    scene.traverse(obj => {
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) {
        if (Array.isArray(obj.material)) obj.material.forEach(m => m.dispose());
        else obj.material.dispose();
      }
    });
    scene = null;
  }

  ['worldTooltip', 'worldRegion', 'worldBanner', 'worldMinimap'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.remove();
  });
  minimapCanvas = null;
  minimapCtx = null;

  player = marker = camera = clock = ocean = null;
  user = null;
  playerTarget = null;
  lastRegionName = '';
  lastRegionWasWild = false;

  const nameTag = document.getElementById('playerNameTag');
  if (nameTag) {
    nameTag.classList.add('hidden');
    nameTag.style.display = 'none';
  }
}

// ============================================================
//                  Noise + biome regions
// ============================================================

function hash2(x, y) {
  let h = (x | 0) * 374761393 + (y | 0) * 668265263;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function noise2d(x, y) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const v00 = hash2(x0,     y0);
  const v10 = hash2(x0 + 1, y0);
  const v01 = hash2(x0,     y0 + 1);
  const v11 = hash2(x0 + 1, y0 + 1);
  const top = v00 * (1 - sx) + v10 * sx;
  const bot = v01 * (1 - sx) + v11 * sx;
  return top * (1 - sy) + bot * sy;
}

function biomeAt(x, z) {
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
  // Swamp lives in the wet transition zone between forest and jungle:
  // moderately south, west side, lower elevations.
  if (ex < -200 && ez > 200 && ez < 900) return BIOMES.swamp;
  if (ez < -400) return BIOMES.forest;
  return BIOMES.plains;
}

function getRegionInfo(x, z) {
  for (const p of PLACES) {
    const r = p.type === 'city' ? 130 : p.type === 'village' ? 80 : 60;
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
    plaza:  'Plaza Central',
    plains: 'Llanuras Verdes',
    forest: 'Bosques del Norte',
    snow:   'Tundra de Picoblanco',
    desert: 'Desierto de Sol',
    jungle: 'Selva de Verdis',
    beach:  'Costa del Sur',
    swamp:  'Pantano del Sauce',
  };
  return { name: REGION_NAMES[biome.id] || 'Tierras Salvajes', type: 'biome' };
}

// ============================================================
//                       Scene setup
// ============================================================

function setupScene() {
  canvas = document.getElementById('worldCanvas');
  if (!canvas) throw new Error('No #worldCanvas element in DOM');

  scene = new THREE.Scene();
  scene.background = new THREE.Color(PALETTE.sky);
  scene.fog = new THREE.Fog(PALETTE.fog, FOG_NEAR, FOG_FAR);

  camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, FOG_FAR + 50);
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight, false);

  raycaster = new THREE.Raycaster();

  const sun = new THREE.DirectionalLight(0xffeecc, 1.0);
  sun.position.set(-30, 50, 20);
  scene.add(sun);

  const ambient = new THREE.AmbientLight(0x6088a0, 0.55);
  scene.add(ambient);
}

function setupOcean() {
  const oceanGeom = new THREE.PlaneGeometry(WORLD_HALF * 6, WORLD_HALF * 6);
  oceanGeom.rotateX(-Math.PI / 2);
  const oceanMat = new THREE.MeshLambertMaterial({ color: PALETTE.ocean, flatShading: true });
  ocean = new THREE.Mesh(oceanGeom, oceanMat);
  ocean.position.y = -0.4;
  scene.add(ocean);
}

function initTreeGeometries() {
  TREE_GEOMS = {};
  for (const [id, def] of Object.entries(TREE_TYPE_DEFS)) {
    const trunkRadius = 0.22 * def.trunkScale;
    const trunkGeom = new THREE.CylinderGeometry(trunkRadius * 0.8, trunkRadius * 1.1, def.height, 6);
    trunkGeom.translate(0, def.height / 2, 0);
    const trunkMat = new THREE.MeshLambertMaterial({ color: def.trunkColor, flatShading: true });

    let canopyGeom;
    if (def.canopyShape === 'sphere')   canopyGeom = new THREE.IcosahedronGeometry(def.canopyRadius, 0);
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

// Loads GLB models listed in TREE_GLB_URLS and replaces the procedural
// geometry for those tree types. Called once during startWorld. If any
// model fails, that tree type keeps its procedural fallback silently.
async function loadGLBTrees() {
  const entries = Object.entries(TREE_GLB_URLS);
  if (entries.length === 0) return;

  const loader = new GLTFLoader();

  await Promise.all(entries.map(async ([typeId, url]) => {
    if (!TREE_GEOMS[typeId]) return; // unknown tree type, skip
    try {
      const gltf = await loader.loadAsync(url);
      const root = gltf.scene;

      // Compute the bounding box of the whole imported tree to figure
      // out a reasonable scale. We want trees to be roughly 4-6m tall
      // in our world units, matching the procedural ones.
      const bbox = new THREE.Box3().setFromObject(root);
      const sizeY = bbox.max.y - bbox.min.y;
      const targetHeight = TREE_TYPE_DEFS[typeId].height * 1.4; // a bit taller than procedural
      const scaleFactor = sizeY > 0.001 ? targetHeight / sizeY : 1.0;

      // Walk every mesh inside the GLB, collect geometries + materials.
      // For InstancedMesh we need a single shared geometry+material; if
      // the GLB has multiple meshes we merge them into one group by
      // baking transforms into the geometries.
      const meshes = [];
      root.updateMatrixWorld(true);
      root.traverse(obj => {
        if (obj.isMesh && obj.geometry) {
          meshes.push(obj);
        }
      });

      if (meshes.length === 0) {
        console.warn(`Tree GLB '${typeId}' has no meshes, keeping procedural`);
        return;
      }

      // For each mesh, clone its geometry with the world transform baked
      // in plus the global scale we computed. We then store an array of
      // (geometry, material) pairs that buildTreesForChunk will instance.
      const parts = meshes.map(m => {
        const geom = m.geometry.clone();
        const mat = m.matrixWorld.clone();
        const scaleMat = new THREE.Matrix4().makeScale(scaleFactor, scaleFactor, scaleFactor);
        // Also translate so the bottom of the tree sits at y=0
        const offsetY = -bbox.min.y * scaleFactor;
        const offsetMat = new THREE.Matrix4().makeTranslation(0, offsetY, 0);
        geom.applyMatrix4(mat);
        geom.applyMatrix4(scaleMat);
        geom.applyMatrix4(offsetMat);

        // Convert PBR material to Lambert so it lights correctly with
        // our simple Directional+Ambient setup (no environment map).
        let srcMat = m.material;
        if (Array.isArray(srcMat)) srcMat = srcMat[0];

        const lambertOpts = { flatShading: false };
        // Preserve base color
        if (srcMat?.color) lambertOpts.color = srcMat.color.clone();
        else lambertOpts.color = new THREE.Color(0x8a6a4a); // fallback brown
        // Preserve base texture (corteza or hojas)
        if (srcMat?.map) lambertOpts.map = srcMat.map;
        // Preserve alpha map for leaves
        if (srcMat?.alphaMap) lambertOpts.alphaMap = srcMat.alphaMap;
        // If the original was transparent or had alpha cutout, keep it
        if (srcMat?.transparent || srcMat?.alphaTest > 0 || srcMat?.alphaMap) {
          lambertOpts.alphaTest = 0.5;
          lambertOpts.transparent = false;
        }
        // Vertex colors if any
        if (srcMat?.vertexColors) lambertOpts.vertexColors = true;

        const material = new THREE.MeshLambertMaterial(lambertOpts);
        material.side = THREE.DoubleSide;

        return { geometry: geom, material };
      });

      TREE_GEOMS[typeId].isGLB = true;
      TREE_GEOMS[typeId].glbParts = parts;
      console.log(`Loaded GLB tree '${typeId}' (${parts.length} parts, scale ${scaleFactor.toFixed(3)})`);
    } catch (err) {
      console.warn(`Tree GLB '${typeId}' failed to load, keeping procedural:`, err.message);
    }
  }));
}

// ============================================================
//                  Decoration system (rocks, grass)
// ============================================================
//
// Decoration objects spawn in chunks like trees but are NOT interactable
// (no tooltip, no XP, no chopping). They use the same instanced mesh
// pattern as trees for performance. Each chunk gets a deterministic mix
// based on its biome.

let DECORATION_GEOMS = null;

// How decorations are distributed across biomes. Each entry is:
//   { density: <max per chunk>, pool: [[name, weight], ...] }
// 'name' is a key into DECORATION_GEOMS.
const BIOME_DECORATION = {
  plaza:      { density: 0,  pool: [] },
  plains:     { density: 4,  pool: [['stones', 2], ['grass', 5]] },
  forest:     { density: 6,  pool: [['stones', 2], ['grass', 4]] },
  beach:      { density: 3,  pool: [['stones', 3]] },
  desert:     { density: 3,  pool: [['stones', 4], ['cave_rocks', 1]] },
  snow:       { density: 4,  pool: [['stones', 3], ['cave_rocks', 2]] },
  jungle:     { density: 5,  pool: [['stones', 1], ['grass', 4]] },
  swamp:      { density: 5,  pool: [['stones', 1], ['grass', 6]] },
  wilderness: { density: 5,  pool: [['stones', 2], ['cave_rocks', 4]] },
};

// Per-decoration scale config (min-max range applied randomly per instance)
const DECORATION_CONFIG = {
  stones:     { scaleMin: 0.8, scaleMax: 1.6, kind: 'rock' },
  cave_rocks: { scaleMin: 0.6, scaleMax: 1.2, kind: 'rock' },
  grass:      { scaleMin: 1.0, scaleMax: 2.0, kind: 'grass' },
};

async function loadGLBDecorations() {
  const entries = Object.entries(DECORATION_GLB_URLS);
  if (entries.length === 0) return;

  DECORATION_GEOMS = {};
  const loader = new GLTFLoader();

  await Promise.all(entries.map(async ([typeId, url]) => {
    try {
      const gltf = await loader.loadAsync(url);
      const root = gltf.scene;

      // Compute bounding box for scale normalization. Grass and rocks
      // have very different "natural" sizes from the GLB authors, so we
      // normalize them all to a target world-units size.
      const bbox = new THREE.Box3().setFromObject(root);
      const sizeY = bbox.max.y - bbox.min.y;
      const targetHeight = typeId === 'grass' ? 0.4 : 1.0; // grass shorter, rocks taller
      const scaleFactor = sizeY > 0.001 ? targetHeight / sizeY : 1.0;

      const meshes = [];
      root.updateMatrixWorld(true);
      root.traverse(obj => {
        if (obj.isMesh && obj.geometry) meshes.push(obj);
      });

      if (meshes.length === 0) {
        console.warn(`Decoration GLB '${typeId}' has no meshes`);
        return;
      }

      // Same pattern as trees: bake transforms into geometry, convert
      // materials to Lambert.
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

        const lambertOpts = { flatShading: typeId !== 'grass' };
        if (srcMat?.color) lambertOpts.color = srcMat.color.clone();
        else lambertOpts.color = new THREE.Color(typeId === 'grass' ? 0x6a9a3a : 0x808078);
        if (srcMat?.map) lambertOpts.map = srcMat.map;
        if (srcMat?.alphaMap) lambertOpts.alphaMap = srcMat.alphaMap;
        if (srcMat?.transparent || srcMat?.alphaTest > 0 || srcMat?.alphaMap) {
          lambertOpts.alphaTest = 0.4;
          lambertOpts.transparent = false;
        }

        const material = new THREE.MeshLambertMaterial(lambertOpts);
        material.side = THREE.DoubleSide;
        return { geometry: geom, material };
      });

      DECORATION_GEOMS[typeId] = { id: typeId, glbParts: parts };
      console.log(`Loaded decoration '${typeId}' (${parts.length} parts, scale ${scaleFactor.toFixed(3)})`);
    } catch (err) {
      console.warn(`Decoration GLB '${typeId}' failed to load:`, err.message);
    }
  }));
}

// Build decoration instances for a chunk (rocks, grass). Returns an
// array of InstancedMesh objects that get added to the scene but NOT
// to interactableMeshes (you can't tap on a rock).
function buildDecorationForChunk(cx, cz) {
  if (!DECORATION_GEOMS) return [];

  const origin = chunkOrigin(cx, cz);
  const centerX = origin.x + CHUNK_SIZE / 2;
  const centerZ = origin.z + CHUNK_SIZE / 2;
  const chunkBiome = biomeAt(centerX, centerZ);
  const config = BIOME_DECORATION[chunkBiome.id] || BIOME_DECORATION.plains;
  if (config.density === 0 || config.pool.length === 0) return [];

  // Don't decorate right under place structures
  const placesHere = PLACES_BY_CHUNK.get(`${cx},${cz}`) || [];
  const placeRadius = placesHere.length > 0
    ? Math.max(...placesHere.map(p => p.type === 'city' ? 18 : 12))
    : 0;
  const placeX = placesHere[0]?.x;
  const placeZ = placesHere[0]?.z;

  const items = [];
  const N_CANDIDATES = Math.max(6, config.density * 2);

  for (let i = 0; i < N_CANDIDATES; i++) {
    // Offset by 9000 in hash to avoid overlap with tree positions
    const offX = hash2(cx * 67 + i + 9100, cz * 71 + i * 3 + 9200) * (CHUNK_SIZE - 4) + 2;
    const offZ = hash2(cx * 73 + i * 7 + 9300, cz * 79 + i + 9400) * (CHUNK_SIZE - 4) + 2;
    const wx = origin.x + offX;
    const wz = origin.z + offZ;

    if (placeRadius > 0 && Math.hypot(wx - placeX, wz - placeZ) < placeRadius) continue;

    // Weighted pick
    const rollPick = hash2(cx * 83 + i * 17 + 9500, cz * 89 + i * 19 + 9600);
    const totalW = config.pool.reduce((s, p) => s + p[1], 0);
    let acc = 0;
    let chosenId = null;
    const target = rollPick * totalW;
    for (const [id, w] of config.pool) {
      acc += w;
      if (acc >= target) { chosenId = id; break; }
    }
    if (!chosenId || !DECORATION_GEOMS[chosenId]) continue;

    items.push({ x: wx, z: wz, typeId: chosenId });
    if (items.length >= config.density) break;
  }

  // Group by type for instancing
  const byType = new Map();
  for (const it of items) {
    if (!byType.has(it.typeId)) byType.set(it.typeId, []);
    byType.get(it.typeId).push(it);
  }

  const outMeshes = [];
  const mat4 = new THREE.Matrix4();

  for (const [typeId, list] of byType) {
    const dg = DECORATION_GEOMS[typeId];
    const cfg = DECORATION_CONFIG[typeId];
    if (!dg || !cfg) continue;

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
//                  Player setup (FBX character)
// ============================================================

async function setupPlayer() {
  character = new Character();

  try {
    const characterGroup = await character.load((progress, message) => {
      showWorldLoading(message || 'Cargando…');
    });
    characterGroup.position.set(0, 0, 0);
    scene.add(characterGroup);
    player = characterGroup;
    characterFallback = false;
  } catch (err) {
    console.error('Character load failed, falling back to capsule:', err);
    character = null;
    characterFallback = true;
    const geom = new THREE.CapsuleGeometry(0.4, 0.9, 4, 12);
    const mat = new THREE.MeshLambertMaterial({ color: PALETTE.player, flatShading: true });
    player = new THREE.Mesh(geom, mat);
    player.position.set(0, 0.85, 0);
    scene.add(player);
  }

  const nameTag = document.getElementById('playerNameTag');
  if (nameTag && user) {
    nameTag.textContent = user.username;
    nameTag.classList.remove('hidden');
  }
}

function setupMarker() {
  const geom = new THREE.RingGeometry(0.35, 0.55, 24);
  geom.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshBasicMaterial({ color: PALETTE.marker, transparent: true, opacity: 0.9, side: THREE.DoubleSide });
  marker = new THREE.Mesh(geom, mat);
  marker.visible = false;
  scene.add(marker);
}

// ============================================================
//                       Chunk system
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

function primeInitialChunks() {
  const { cx, cz } = chunkKeyAt(player.position.x, player.position.z);
  for (let dz = -RENDER_RADIUS; dz <= RENDER_RADIUS; dz++) {
    for (let dx = -RENDER_RADIUS; dx <= RENDER_RADIUS; dx++) {
      if (chunkInsideWorld(cx + dx, cz + dz)) loadChunk(cx + dx, cz + dz);
    }
  }
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
      if (!chunks.has(key)) {
        wants.push({ key, cx: ncx, cz: ncz, d: dx * dx + dz * dz });
      }
    }
  }
  wants.sort((a, b) => a.d - b.d);
  for (const w of wants) {
    if (!chunkBuildQueue.find(c => c.key === w.key)) chunkBuildQueue.push(w);
  }

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

  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
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
  for (const m of treeMeshes) {
    scene.add(m);
    interactableMeshes.push(m);
  }

  // Decorations (rocks, grass) — purely visual, NOT in interactableMeshes
  // so they don't trigger tooltips or interfere with terrain clicks.
  const decorMeshes = buildDecorationForChunk(cx, cz);
  for (const m of decorMeshes) {
    scene.add(m);
  }

  chunks.set(key, { mesh, placeStructures, treeMeshes, decorMeshes });
}

function unloadChunk(key) {
  const chunk = chunks.get(key);
  if (!chunk) return;

  if (chunk.mesh) {
    scene.remove(chunk.mesh);
    chunk.mesh.geometry.dispose();
    chunk.mesh.material.dispose();
    const idx = terrainMeshes.indexOf(chunk.mesh);
    if (idx >= 0) terrainMeshes.splice(idx, 1);
  }
  for (const lm of chunk.placeStructures || []) {
    scene.remove(lm);
    lm.traverse(o => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        if (Array.isArray(o.material)) o.material.forEach(m => m.dispose());
        else o.material.dispose();
      }
    });
  }
  for (const m of chunk.treeMeshes || []) {
    scene.remove(m);
    const idx = interactableMeshes.indexOf(m);
    if (idx >= 0) interactableMeshes.splice(idx, 1);
    m.dispose?.();
  }
  for (const m of chunk.decorMeshes || []) {
    scene.remove(m);
    m.dispose?.();
  }
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
    if (v > 0) cTmp.lerp(cLight, v * 0.85);
    else       cTmp.lerp(cDark,  -v * 0.85);

    colors[i * 3]     = cTmp.r;
    colors[i * 3 + 1] = cTmp.g;
    colors[i * 3 + 2] = cTmp.b;
  }
  geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
}

// ============================================================
//                       Place structures
// ============================================================

function buildPlaceStructure(place) {
  const group = new THREE.Group();
  group.position.set(place.x, 0, place.z);

  const stoneMat  = new THREE.MeshLambertMaterial({ color: 0x666666, flatShading: true });
  const accentMat = new THREE.MeshLambertMaterial({ color: place.color, flatShading: true });

  switch (place.type) {
    case 'city': {
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
    }
    case 'village': {
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
    }
    case 'tower': {
      group.add(makeBase(2.0, 0.5, stoneMat));
      group.add(makeColumn(15, 0.55, accentMat, 0.6));
      const roof = new THREE.Mesh(new THREE.ConeGeometry(1.2, 2.5, 8), accentMat);
      roof.position.y = 0.6 + 15 + 1.25;
      group.add(roof);
      group.add(makeIcoTop(0.35, accentMat, 0.6 + 15 + 2.6, true));
      break;
    }
    case 'mine': {
      const base = new THREE.Mesh(new THREE.BoxGeometry(4, 1.5, 4), stoneMat);
      base.position.y = 0.75;
      group.add(base);
      const entry = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.6, 0.4),
        new THREE.MeshLambertMaterial({ color: 0x101010 }));
      entry.position.set(0, 0.85, 2.0);
      group.add(entry);
      const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.6, 0), accentMat);
      crystal.position.y = 2.0;
      crystal.userData.spin = true;
      group.add(crystal);
      break;
    }
    case 'temple': {
      const base = new THREE.Mesh(new THREE.CylinderGeometry(3, 3.3, 0.6, 12),
        new THREE.MeshLambertMaterial({ color: 0xc8c0b0, flatShading: true }));
      base.position.y = 0.3;
      group.add(base);
      group.add(makeColumn(8, 0.6,
        new THREE.MeshLambertMaterial({ color: 0xe8e0cc, flatShading: true }), 0.6));
      const top = new THREE.Mesh(new THREE.IcosahedronGeometry(0.9, 0),
        new THREE.MeshLambertMaterial({
          color: 0xfff4d0, emissive: 0xc8a040,
          emissiveIntensity: 0.5, flatShading: true,
        }));
      top.position.y = 0.6 + 8 + 0.5;
      top.userData.spin = true;
      group.add(top);
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
      slab.position.y = 0.3;
      group.add(slab);
      const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(1.0, 0),
        new THREE.MeshLambertMaterial({
          color: place.color, emissive: 0x4a1030,
          emissiveIntensity: 0.6, flatShading: true,
        }));
      crystal.position.y = 1.6;
      crystal.userData.spin = true;
      group.add(crystal);
      break;
    }
    case 'boss': {
      group.add(makeBase(3.5, 0.6, stoneMat));
      const bossMat = new THREE.MeshLambertMaterial({
        color: place.color, emissive: 0x4a0000,
        emissiveIntensity: 0.35, flatShading: true,
      });
      group.add(makeColumn(12, 0.9, bossMat, 0.7));
      const skull = new THREE.Mesh(new THREE.IcosahedronGeometry(1.2, 0), bossMat);
      skull.position.y = 0.7 + 12 + 0.6;
      skull.userData.spin = true;
      group.add(skull);
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
//                       Trees
// ============================================================

function buildTreesForChunk(cx, cz) {
  const origin = chunkOrigin(cx, cz);
  const centerX = origin.x + CHUNK_SIZE / 2;
  const centerZ = origin.z + CHUNK_SIZE / 2;
  const chunkBiome = biomeAt(centerX, centerZ);
  const config = BIOME_TREES[chunkBiome.id] || BIOME_TREES.plains;
  if (config.density === 0 || config.pool.length === 0) return [];

  const placesHere = PLACES_BY_CHUNK.get(`${cx},${cz}`) || [];
  const placeRadius = placesHere.length > 0
    ? Math.max(...placesHere.map(p => p.type === 'city' ? 18 : 12))
    : 0;
  const placeX = placesHere[0]?.x;
  const placeZ = placesHere[0]?.z;

  const trees = [];
  // Larger spacing now that trees are 1.5x-3x bigger, so they don't
  // overlap each other awkwardly.
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
    let acc = 0;
    let chosenId = null;
    const target = rollPick * totalW;
    for (const [id, w] of localConfig.pool) {
      acc += w;
      if (acc >= target) { chosenId = id; break; }
    }
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

    // Pick geometry parts: GLB parts if loaded, else the procedural
    // trunk + canopy pair.
    const parts = tg.isGLB && tg.glbParts
      ? tg.glbParts.map((p, idx) => ({
          geometry: p.geometry,
          material: p.material,
          kind: idx === 0 ? 'tree-trunk' : 'tree-canopy',
        }))
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
        // Bushes are not trees — they should stay small. Trees use the
        // 1.5x-3x range; bushes use 0.7x-1.3x so they sit at ground level
        // as ground cover instead of looking like giant green monsters.
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
//                       Minimap
// ============================================================

function setupMinimap() {
  let el = document.getElementById('worldMinimap');
  if (!el) {
    el = document.createElement('canvas');
    el.id = 'worldMinimap';
    el.width = 144;
    el.height = 144;
    el.style.cssText = `
      position: absolute;
      top: calc(env(safe-area-inset-top, 0px) + 14px);
      left: 14px;
      z-index: 14;
      pointer-events: none;
      border: 2px solid #c8a043;
      border-radius: 50%;
      background: rgba(20, 14, 8, 0.85);
      box-shadow: 0 4px 14px rgba(0,0,0,0.6);
    `;
    (document.getElementById('worldScreen') || document.body).appendChild(el);
  }
  minimapCanvas = el;
  minimapCtx = el.getContext('2d');
}

function drawMinimap() {
  if (!minimapCtx || !player) return;
  const ctx = minimapCtx;
  const W = minimapCanvas.width;
  const H = minimapCanvas.height;

  // Range shown on the minimap, in world meters
  const RANGE = 500;
  const cx = W / 2, cy = H / 2;
  const scale = (W / 2) / RANGE;
  const px = player.position.x;
  const pz = player.position.z;

  // Clear with biome-tinted background
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, W / 2 - 2, 0, Math.PI * 2);
  ctx.clip();

  // Background — biome of player position
  const pb = biomeAt(px, pz);
  ctx.fillStyle = '#' + pb.base.toString(16).padStart(6, '0');
  ctx.fillRect(0, 0, W, H);

  // Wilderness shading (red overlay for x < WILDERNESS_X)
  const wildScreenX = cx + (WILDERNESS_X - px) * scale;
  if (wildScreenX > 0) {
    ctx.fillStyle = 'rgba(180, 30, 30, 0.35)';
    ctx.fillRect(0, 0, Math.min(W, wildScreenX), H);
  }

  // Ocean past world bounds
  ctx.fillStyle = 'rgba(40, 80, 120, 0.65)';
  const leftEdgeX = cx + (-WORLD_HALF - px) * scale;
  if (leftEdgeX > 0) ctx.fillRect(0, 0, leftEdgeX, H);
  const rightEdgeX = cx + (WORLD_HALF - px) * scale;
  if (rightEdgeX < W) ctx.fillRect(rightEdgeX, 0, W - rightEdgeX, H);
  const topEdgeY = cy + (-WORLD_HALF - pz) * scale;
  if (topEdgeY > 0) ctx.fillRect(0, 0, W, topEdgeY);
  const bottomEdgeY = cy + (WORLD_HALF - pz) * scale;
  if (bottomEdgeY < H) ctx.fillRect(0, bottomEdgeY, W, H - bottomEdgeY);

  // ── Trees layer ──
  // Iterate over loaded chunks and draw each tree as a small green dot.
  // Trees are stored as instances in InstancedMesh userData.trees, which
  // holds {x, z, typeId} for each instance.
  const RANGE_SQ = RANGE * RANGE;
  ctx.fillStyle = '#3a7a2a';
  for (const m of interactableMeshes) {
    const list = m.userData?.trees;
    if (!list || m.userData?.kind !== 'tree-trunk') continue; // draw once per tree, not per part
    for (const t of list) {
      const dx = t.x - px;
      const dz = t.z - pz;
      if (dx * dx + dz * dz > RANGE_SQ) continue;
      const sx = cx + dx * scale;
      const sy = cy + dz * scale;
      // 1-2px green dot is enough for a tree at this zoom
      ctx.fillRect(sx - 1, sy - 1, 2, 2);
    }
  }

  // ── Places layer ──
  // Drawn after trees so they sit on top. Each place shows an icon for
  // its type and (when close enough) a short label underneath.
  for (const p of PLACES) {
    const sx = cx + (p.x - px) * scale;
    const sy = cy + (p.z - pz) * scale;
    if (sx < -10 || sx > W + 10 || sy < -10 || sy > H + 10) continue;

    let r, fillC, strokeC, icon;
    if (p.type === 'city') { r = 6; fillC = '#ffd060'; strokeC = '#000'; icon = '🏰'; }
    else if (p.type === 'village') { r = 4.5; fillC = '#c8a043'; strokeC = '#000'; icon = '🏘'; }
    else if (p.type === 'boss') { r = 5.5; fillC = '#ff3030'; strokeC = '#000'; icon = '💀'; }
    else if (p.type === 'tower') { r = 4.5; fillC = '#7090d0'; strokeC = '#000'; icon = '🗼'; }
    else if (p.type === 'mine') { r = 4.5; fillC = '#808080'; strokeC = '#000'; icon = '⛏'; }
    else if (p.type === 'temple') { r = 4.5; fillC = '#fff4d0'; strokeC = '#000'; icon = '⛩'; }
    else if (p.type === 'altar') { r = 4.5; fillC = '#a040c0'; strokeC = '#000'; icon = '🔮'; }
    else if (p.type === 'ruins') { r = 4; fillC = '#9090c0'; strokeC = '#000'; icon = '🏛'; }
    else { r = 4; fillC = '#9090c0'; strokeC = '#000'; icon = '•'; }

    // Glowing halo so the icon stands out against the busy background
    ctx.beginPath();
    ctx.arc(sx, sy, r + 2, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fill();

    ctx.beginPath();
    ctx.arc(sx, sy, r, 0, Math.PI * 2);
    ctx.fillStyle = fillC;
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = strokeC;
    ctx.stroke();

    // Label below the icon if place is within ~350m (close enough that the
    // player likely wants to know the name)
    const distSq = (p.x - px) ** 2 + (p.z - pz) ** 2;
    if (distSq < 350 * 350) {
      const label = p.name;
      ctx.font = 'bold 9px serif';
      ctx.textAlign = 'center';
      // Drop shadow for readability
      ctx.fillStyle = 'rgba(0,0,0,0.85)';
      ctx.fillText(label, sx + 1, sy + r + 9);
      ctx.fillStyle = '#fff8d0';
      ctx.fillText(label, sx, sy + r + 8);
    }
  }

  // ── Other players layer ──
  // window.__otherPlayers should be an array of {x, z, name} populated by
  // the multiplayer code when it lands. While empty, draws nothing.
  const others = (typeof window !== 'undefined' && Array.isArray(window.__otherPlayers))
    ? window.__otherPlayers : [];
  for (const op of others) {
    if (typeof op?.x !== 'number' || typeof op?.z !== 'number') continue;
    const dx = op.x - px;
    const dz = op.z - pz;
    if (dx * dx + dz * dz > RANGE_SQ) continue;
    const sx = cx + dx * scale;
    const sy = cy + dz * scale;
    // White dot with black outline for contrast
    ctx.beginPath();
    ctx.arc(sx, sy, 3.5, 0, Math.PI * 2);
    ctx.fillStyle = '#fff';
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = '#000';
    ctx.stroke();
  }

  ctx.restore();

  // ── Player dot — always centered ──
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(cx, cy, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = '#000';
  ctx.stroke();

  // Player facing direction (arrow)
  const ang = player.rotation.y;
  const arrowLen = 9;
  const ax = cx + Math.sin(ang) * arrowLen;
  const ay = cy + Math.cos(ang) * arrowLen;
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(ax, ay);
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 2;
  ctx.stroke();

  // Compass N
  ctx.fillStyle = '#e8c560';
  ctx.font = 'bold 12px serif';
  ctx.textAlign = 'center';
  ctx.fillText('N', cx, 14);
}

// ============================================================
//                       HUD tooltips, banners
// ============================================================

function ensureTooltipEl() {
  let el = document.getElementById('worldTooltip');
  if (el) return el;
  el = document.createElement('div');
  el.id = 'worldTooltip';
  el.style.cssText = `
    position: absolute; z-index: 30; pointer-events: none;
    background: rgba(20, 14, 8, 0.92);
    border: 1.5px solid #c8a043; color: #e8c560;
    font-family: 'IM Fell English', serif; font-size: 14px;
    padding: 10px 14px; border-radius: 4px;
    text-shadow: 0 1px 2px rgba(0,0,0,0.9);
    transition: opacity 0.22s; opacity: 0;
    max-width: 240px; line-height: 1.45;
    box-shadow: 0 4px 14px rgba(0,0,0,0.55);
    backdrop-filter: blur(4px); -webkit-backdrop-filter: blur(4px);
  `;
  (document.getElementById('worldScreen') || document.body).appendChild(el);
  return el;
}

function showTreeTooltip(treeType, clientX, clientY) {
  const el = ensureTooltipEl();
  el.innerHTML = `
    <div style="font-weight: bold; font-size: 15px; color: #fff8d0;">${treeType.name}</div>
    <div style="font-size: 13px; opacity: 0.95; margin-top: 4px;">
      Requiere <b style="color: #fff;">nivel ${treeType.chopLevel}</b> Tala
    </div>
    <div style="font-size: 12px; opacity: 0.65; margin-top: 3px;">
      ${treeType.xpReward} XP por árbol
    </div>
  `;
  const maxX = window.innerWidth - 260;
  const maxY = window.innerHeight - 90;
  el.style.left = Math.min(clientX + 14, maxX) + 'px';
  el.style.top  = Math.min(Math.max(clientY - 30, 60), maxY) + 'px';
  el.style.opacity = '1';
  clearTimeout(el._hideTimer);
  el._hideTimer = setTimeout(() => { el.style.opacity = '0'; }, 3500);
}

function ensureRegionEl() {
  let el = document.getElementById('worldRegion');
  if (el) return el;
  el = document.createElement('div');
  el.id = 'worldRegion';
  el.style.cssText = `
    position: absolute;
    top: calc(env(safe-area-inset-top, 0px) + 60px);
    left: 50%; transform: translateX(-50%);
    z-index: 12; pointer-events: none;
    background: rgba(20, 14, 8, 0.78);
    border: 1px solid rgba(200, 170, 120, 0.4);
    color: rgba(232, 197, 96, 0.95);
    font-family: 'IM Fell English SC', serif;
    font-size: 13px; padding: 5px 14px;
    border-radius: 999px;
    backdrop-filter: blur(4px); -webkit-backdrop-filter: blur(4px);
    text-shadow: 0 1px 2px rgba(0,0,0,0.9);
    letter-spacing: 0.05em;
    transition: opacity 0.3s, color 0.3s, border-color 0.3s;
  `;
  (document.getElementById('worldScreen') || document.body).appendChild(el);
  return el;
}

function updateRegionDisplay(region) {
  const el = ensureRegionEl();
  el.textContent = region.name;
  if (region.isWild) {
    el.style.color = '#ff8866';
    el.style.borderColor = 'rgba(220, 100, 80, 0.5)';
  } else {
    el.style.color = 'rgba(232, 197, 96, 0.95)';
    el.style.borderColor = 'rgba(200, 170, 120, 0.4)';
  }
}

function ensureBannerEl() {
  let el = document.getElementById('worldBanner');
  if (el) return el;
  el = document.createElement('div');
  el.id = 'worldBanner';
  el.style.cssText = `
    position: absolute; top: 30%; left: 50%;
    transform: translate(-50%, -45%);
    z-index: 25; pointer-events: none;
    background: rgba(20, 14, 8, 0.88);
    border: 2px solid #c8a043;
    color: #fff8d0;
    font-family: 'Cinzel', serif; font-weight: 700;
    font-size: 22px; padding: 14px 30px;
    border-radius: 4px;
    text-shadow: 0 2px 6px rgba(0,0,0,0.9);
    transition: opacity 0.5s, transform 0.5s;
    letter-spacing: 0.08em; text-align: center;
    box-shadow: 0 8px 24px rgba(0,0,0,0.6);
    opacity: 0; white-space: nowrap;
    max-width: 90vw;
  `;
  (document.getElementById('worldScreen') || document.body).appendChild(el);
  return el;
}

function showWelcomeBanner(region) {
  const el = ensureBannerEl();
  if (region.isWild && region.type === 'wilderness') {
    el.style.color = '#ff7050';
    el.style.borderColor = '#ff5040';
    el.innerHTML = `⚠️ ${region.name} ⚠️`;
  } else if (region.type === 'city') {
    el.style.color = '#fff8d0';
    el.style.borderColor = '#c8a043';
    el.innerHTML = `Has llegado a<br><span style="font-size: 28px; color: #e8c560;">${region.name}</span>`;
  } else if (region.type === 'village') {
    el.style.color = '#e8d8a8';
    el.style.borderColor = '#a88040';
    el.innerHTML = region.name;
  } else if (region.isPlace) {
    el.style.color = '#c8d8e8';
    el.style.borderColor = '#7090b0';
    el.innerHTML = region.name;
  } else {
    el.style.color = '#fff8d0';
    el.style.borderColor = '#c8a043';
    el.innerHTML = region.name;
  }
  el.style.opacity = '1';
  el.style.transform = 'translate(-50%, -50%)';
  clearTimeout(el._hideTimer);
  el._hideTimer = setTimeout(() => {
    el.style.opacity = '0';
    el.style.transform = 'translate(-50%, -40%)';
  }, 2400);
}

function applyWildernessVisuals(isWild) {
  if (!scene) return;
  scene.background.setHex(isWild ? PALETTE.skyWild : PALETTE.sky);
  scene.fog.color.setHex(isWild ? PALETTE.fogWild : PALETTE.fog);
}

// ============================================================
//                       Input handling
// ============================================================

function addL(target, type, fn, opts) {
  target.addEventListener(type, fn, opts);
  listeners.push({ target, type, fn, opts });
}

function setupInput() {
  addL(canvas, 'pointerdown', onCanvasPointerDown);
  addL(canvas, 'contextmenu', e => e.preventDefault());
  addL(window, 'keydown', onKeyDown);
  setupJoystick();
  setupTouchCamera();
  addL(window, 'resize', onResize);
}

function onCanvasPointerDown(e) {
  if (e.button !== undefined && e.button !== 0) return;
  if (e.target !== canvas) return;

  const rect = canvas.getBoundingClientRect();
  const nx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  const ny = -((e.clientY - rect.top) / rect.height) * 2 + 1;

  raycaster.setFromCamera({ x: nx, y: ny }, camera);

  const treeHits = raycaster.intersectObjects(interactableMeshes, false);
  if (treeHits.length > 0) {
    const hit = treeHits[0];
    const treeType = hit.object.userData.treeType;
    if (treeType) {
      showTreeTooltip(treeType, e.clientX, e.clientY);
      return;
    }
  }

  const hits = raycaster.intersectObjects(terrainMeshes);
  if (hits.length > 0) {
    const p = hits[0].point;
    setPlayerTarget(p.x, p.z);
  }
}

function setPlayerTarget(x, z) {
  x = Math.max(-WORLD_HALF + 2, Math.min(WORLD_HALF - 2, x));
  z = Math.max(-WORLD_HALF + 2, Math.min(WORLD_HALF - 2, z));
  playerTarget = { x, z };
  marker.position.set(x, 0.05, z);
  marker.scale.set(1, 1, 1);
  marker.material.opacity = 0.9;
  marker.visible = true;
  marker.userData.spawnTime = clock.getElapsedTime();
}

function onKeyDown(e) {
  if (e.key === 'q' || e.key === 'Q') cameraYaw += 0.15;
  if (e.key === 'e' || e.key === 'E') cameraYaw -= 0.15;
}

function setupJoystick() {
  const joyEl   = document.getElementById('joystick');
  const joyKnob = document.getElementById('joystickKnob');
  if (!joyEl || !joyKnob) return;

  let centerX = 0, centerY = 0;
  const MAX_R = 42;

  function setKnob(dx, dy) {
    joyKnob.style.transform = `translate(${dx}px, ${dy}px)`;
  }

  function onStart(ev) {
    ev.preventDefault();
    const t = ev.touches ? ev.touches[0] : ev;
    const rect = joyEl.getBoundingClientRect();
    centerX = rect.left + rect.width / 2;
    centerY = rect.top + rect.height / 2;
    joyState.active = true;
    update(t.clientX, t.clientY);
  }

  function update(cx, cy) {
    let dx = cx - centerX;
    let dy = cy - centerY;
    const len = Math.hypot(dx, dy);
    if (len > MAX_R) { dx = dx / len * MAX_R; dy = dy / len * MAX_R; }
    setKnob(dx, dy);
    joyState.x = dx / MAX_R;
    joyState.y = dy / MAX_R;
  }

  function onMove(ev) {
    if (!joyState.active) return;
    ev.preventDefault();
    const t = ev.touches ? ev.touches[0] : ev;
    update(t.clientX, t.clientY);
  }

  function onEnd() {
    joyState.active = false;
    joyState.x = 0; joyState.y = 0;
    setKnob(0, 0);
  }

  addL(joyEl,  'touchstart', onStart, { passive: false });
  addL(joyEl,  'touchmove',  onMove,  { passive: false });
  addL(joyEl,  'touchend',   onEnd);
  addL(joyEl,  'touchcancel', onEnd);
  addL(joyEl,  'mousedown',  onStart);
  addL(window, 'mousemove',  onMove);
  addL(window, 'mouseup',    onEnd);
}

function setupTouchCamera() {
  let active = false;
  let lastMidX = 0, lastMidY = 0;

  addL(canvas, 'touchstart', e => {
    if (e.touches.length === 2) {
      active = true;
      lastMidX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
      lastMidY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
    }
  });

  addL(canvas, 'touchmove', e => {
    if (active && e.touches.length === 2) {
      e.preventDefault();
      const mx = (e.touches[0].clientX + e.touches[1].clientX) / 2;
      const my = (e.touches[0].clientY + e.touches[1].clientY) / 2;
      cameraYaw   += (mx - lastMidX) * 0.005;
      cameraPitch -= (my - lastMidY) * 0.005;
      cameraPitch = Math.max(0.1, Math.min(1.3, cameraPitch));
      lastMidX = mx; lastMidY = my;
    }
  }, { passive: false });

  addL(canvas, 'touchend', e => {
    if (e.touches.length < 2) active = false;
  });
}

// ============================================================
//                       Animation loop
// ============================================================

function animate() {
  if (!running) return;
  requestAnimationFrame(animate);

  const dt = Math.min(clock.getDelta(), 0.1);

  updatePlayer(dt);
  updateChunkLoading(player.position.x, player.position.z);
  processChunkQueue();
  updateCamera();
  updateMarker();
  updateSpinners(dt);
  if (character) character.update(dt);
  updateNameTag();
  updateRegionTracking();
  drawMinimap();

  renderer.render(scene, camera);
}

function updatePlayer(dt) {
  let isMoving = false;
  let moveSpeed = 0; // 0..1, used for animation choice

  // Joystick has priority. Camera-relative: forward on stick = forward
  // in the direction the camera faces.
  if (joyState.active && (Math.abs(joyState.x) > 0.15 || Math.abs(joyState.y) > 0.15)) {
    const len = Math.hypot(joyState.x, joyState.y);
    const speedScale = Math.min(1, len);

    // Project joystick into world space using camera yaw.
    // Stick up (negative y in screen coords → joyState.y < 0) = forward,
    // which is camera's forward direction projected on XZ plane.
    const camForwardX = -Math.sin(cameraYaw);
    const camForwardZ = -Math.cos(cameraYaw);
    const camRightX   =  Math.cos(cameraYaw);
    const camRightZ   = -Math.sin(cameraYaw);

    // joyState.y is positive when stick is pulled down → backward
    // joyState.x is positive when stick goes right
    const wx = camRightX * joyState.x + camForwardX * (-joyState.y);
    const wz = camRightZ * joyState.x + camForwardZ * (-joyState.y);

    const speed = PLAYER_RUN * speedScale;
    player.position.x += wx * speed * dt;
    player.position.z += wz * speed * dt;

    if (wx !== 0 || wz !== 0) {
      // FBX Mixamo character faces +Z by default
      player.rotation.y = Math.atan2(wx, wz);
    }

    playerTarget = null;
    marker.visible = false;
    isMoving = true;
    moveSpeed = speedScale;
  } else if (playerTarget) {
    const dx = playerTarget.x - player.position.x;
    const dz = playerTarget.z - player.position.z;
    const dist = Math.hypot(dx, dz);

    if (dist < 0.1) {
      playerTarget = null;
      marker.visible = false;
    } else {
      const step = PLAYER_RUN * dt;
      if (step >= dist) {
        player.position.x = playerTarget.x;
        player.position.z = playerTarget.z;
        playerTarget = null;
        marker.visible = false;
      } else {
        const nx = dx / dist;
        const nz = dz / dist;
        player.position.x += nx * step;
        player.position.z += nz * step;
        player.rotation.y = Math.atan2(dx, dz);
        isMoving = true;
        moveSpeed = 1.0;
      }
    }
  }

  player.position.x = Math.max(-WORLD_HALF + 1, Math.min(WORLD_HALF - 1, player.position.x));
  player.position.z = Math.max(-WORLD_HALF + 1, Math.min(WORLD_HALF - 1, player.position.z));

  if (character && character.loaded) {
    if (!isMoving)          character.play('idle');
    else if (moveSpeed > 0.7) character.play('run');
    else                    character.play('walk');
  }
}

function updateCamera() {
  const r = cameraDist;
  const desiredX = player.position.x + Math.sin(cameraYaw) * Math.cos(cameraPitch) * r;
  const desiredY = player.position.y + Math.sin(cameraPitch) * r;
  const desiredZ = player.position.z + Math.cos(cameraYaw) * Math.cos(cameraPitch) * r;

  camera.position.set(desiredX, desiredY, desiredZ);
  const lookHeight = characterFallback ? 0.5 : 1.0;
  camera.lookAt(player.position.x, player.position.y + lookHeight, player.position.z);
}

function updateMarker() {
  if (!marker.visible) return;
  const t = clock.getElapsedTime() - marker.userData.spawnTime;
  const pulse = 1 + Math.sin(t * 7) * 0.18;
  marker.scale.set(pulse, 1, pulse);
  if (t > 2.0) {
    marker.material.opacity = Math.max(0, 0.9 - (t - 2.0) * 1.8);
    if (marker.material.opacity <= 0) marker.visible = false;
  }
}

function updateSpinners(dt) {
  for (const { placeStructures } of chunks.values()) {
    for (const ps of placeStructures || []) {
      ps.traverse(o => { if (o.userData.spin) o.rotation.y += dt * 0.5; });
    }
  }
}

function updateNameTag() {
  const tag = document.getElementById('playerNameTag');
  if (!tag || tag.classList.contains('hidden')) return;

  const tagY = characterFallback ? 1.5 : 1.95;
  const v = new THREE.Vector3(player.position.x, player.position.y + tagY, player.position.z);
  v.project(camera);

  if (v.z > 1 || v.z < -1) { tag.style.display = 'none'; return; }

  const sx = (v.x * 0.5 + 0.5) * window.innerWidth;
  const sy = (-v.y * 0.5 + 0.5) * window.innerHeight;

  tag.style.display = 'block';
  tag.style.left = sx + 'px';
  tag.style.top  = sy + 'px';
}

function updateRegionTracking() {
  const region = getRegionInfo(player.position.x, player.position.z);
  updateRegionDisplay(region);
  applyWildernessVisuals(region.isWild);

  if (region.name !== lastRegionName) {
    if (region.isPlace || (region.isWild && !lastRegionWasWild) || (!region.isWild && lastRegionWasWild)) {
      showWelcomeBanner(region);
    }
    lastRegionName = region.name;
    lastRegionWasWild = region.isWild;
  }
}

function onResize() {
  if (resizeRaf) return;
  resizeRaf = requestAnimationFrame(() => {
    resizeRaf = null;
    if (!camera || !renderer) return;
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight, false);
  });
}

// ============================================================
//                       Loading UI helpers
// ============================================================

function showWorldLoading(text) {
  const el = document.getElementById('worldLoading');
  if (!el) return;
  const t = el.querySelector('.loading-text');
  if (t) t.textContent = text;
  el.classList.remove('hidden');
}

function hideWorldLoading() {
  const el = document.getElementById('worldLoading');
  if (el) el.classList.add('hidden');
}
