/**
 * SebasPresent — World module (Slice 5a v2)
 *
 * CAMBIOS:
 *   - Cámara OSRS: dist 14, pitch 0.55 (más alejado y elevado)
 *   - Doble joystick: izq=movimiento, der=cámara (yaw+pitch)
 *   - Click simple minimapa → goto. Botón 🗺 aparte abre mapa grande
 *   - HUD HP/Prayer/Bota reposicionado al lateral del minimapa
 *   - Fix árboles GLB tumbados (detección Z-up + rotación)
 *   - Fix personaje "vuela" (bbox normalize a y=0 tras cargar)
 *   - 90 NPCs sincronizados con /api/combat/state (pollos/vacas/goblins)
 *   - Tap NPC → engage combat. HP bar flotante sobre cada NPC
 *   - NPCs como puntos blancos en minimapa
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Character } from './character.js';
import * as combat from './combat.js';

const R2_BASE = 'https://pub-bb63b96c76c745f59a39649cde6678c0.r2.dev';

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
  cave_rocks: `${R2_BASE}/decoration/cave_rocks.glb`,
  grass:      `${R2_BASE}/decoration/grass.glb`,
};

// NPCs — sube los GLB a R2 bajo /npcs/<id>.glb. Si falta uno, placeholder.
const NPC_GLB_URLS = {
  chicken: `${R2_BASE}/npcs/chicken.glb`,
  cow:     `${R2_BASE}/npcs/cow.glb`,
  goblin:  `${R2_BASE}/npcs/goblin.glb`,
};

const NPC_FALLBACK_COLORS = {
  chicken: 0xffffff,
  cow:     0xeae0c8,
  goblin:  0x4a8030,
  wolf:    0x808080,
};

const NPC_TARGET_HEIGHTS = {
  chicken: 1.0,   // bumped 0.6 → 1.0 (era demasiado pequeño, no se veía)
  cow:     1.4,   // bumped 1.2 → 1.4 (vaca low-poly nueva, un poco más grande)
  goblin:  1.6,   // bumped 1.3 → 1.6 (humanoide, debería ser ~tamaño player)
  wolf:    1.0,
};

/**
 * Per-NPC config: cuándo forzar rotación Z-up. La heurística automática
 * de detectsZUp() falla con la nueva vaca low-poly (Y > Z porque el largo
 * está en Y), así que la marcamos a mano.
 */
const NPC_GLB_FORCE_ZUP = {
  cow: true,    // low_poly_cow.glb está orientado Z-up
};

/**
 * Patrol / wander parameters. Cada NPC vivo deambula en círculo lento
 * alrededor de su spawn point. Cuando el player lo está atacando, se
 * queda quieto (engaged = paused).
 */
const NPC_PATROL_RADIUS    = 3.0;    // metros del centro
const NPC_PATROL_SPEED_RPS = 0.18;   // radianes/seg (vuelta cada ~35s)
const NPC_PATROL_BOB_AMP   = 0.04;   // bob vertical sutil
const NPC_PATROL_BOB_HZ    = 1.8;    // ciclos/seg de bob

/**
 * Hit reaction params (empujón + flash rojo cuando reciben golpe).
 */
const NPC_REACT_DURATION_S = 0.18;   // 180ms
const NPC_REACT_KICK_DIST  = 0.35;   // metros que se desplaza al recibir hit

const WORLD_HALF = 2048;
const WILDERNESS_X = -1024;
const CHUNK_SIZE = 64;
const CHUNK_SEGS = 32;
const RENDER_RADIUS = 3;
const PLAYER_RUN = 7.0;
const PLAYER_RUN_BOOST = 1.6;
const FOG_NEAR = CHUNK_SIZE * 2;
const FOG_FAR = CHUNK_SIZE * (RENDER_RADIUS + 0.5);

const TREE_SCALE_MIN = 1.5;
const TREE_SCALE_MAX = 3.0;
const TREE_COLLISION_RADIUS = 0.6;

const POSITION_SAVE_INTERVAL = 10_000;
const POSITION_SAVE_MIN_DELTA = 5.0;

const API_BASE = 'https://sebaspresent.srmrpapitas.workers.dev';

const NPC_POLL_INTERVAL_MS = 5000;
const NPC_RENDER_RADIUS = 100;
const NPC_MINIMAP_RADIUS = 500;
const NPC_TAP_RANGE = 30;
const NPC_ENGAGE_RANGE = 1.4;  // distancia para auto-engage (server attack_range=1.5)

const CAMERA_DIST_MIN = 6;
const CAMERA_DIST_MAX = 30;

const PALETTE = {
  sky: 0x9ec0d6, fog: 0xa8c4d8, skyWild: 0x6a4040, fogWild: 0x6a3838,
  ocean: 0x4a7896, player: 0xc04a3a, marker: 0xfff04a,
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

// CAMARA OSRS: alejada y elevada
let cameraDist = 14;
let cameraYaw = Math.PI * 0.25;
let cameraPitch = 0.55;

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
let DECORATION_GEOMS = null;
let NPC_GEOMS = null;

let lastRegionName = '';
let lastRegionWasWild = false;

let minimapCanvas = null;
let minimapCtx = null;

let fullMapCanvas = null;
let fullMapCtx = null;
let fullMapOverlay = null;
let fullMapVisible = false;

let runMode = false;

let hudHpValue = null;
let hudPrayerValue = null;
let hudRunValue = null;
let hudStatRun = null;

let authToken = null;
let positionSaveTimer = 0;
let lastSavedX = 0;
let lastSavedZ = 0;

const chunkColliders = new Map();

// NPC runtime
const npcMeshes = new Map();
let npcDataList = [];
let npcPollTimer = 0;
let combatUnsubscribe = null;
let pendingEngageNpcId = null;  // NPC al que vamos a engage cuando lleguemos cerca
let lastPlayerYNormalize = 0;   // timestamp para normalize bbox del player
let regionFadeTimer = null;     // timer para fade-out del label de región

// Raycaster reutilizable para detectar altura del terreno bajo el player
const _playerDownRay = new THREE.Raycaster();
const _playerDownDir = new THREE.Vector3(0, -1, 0);
const _playerDownOrigin = new THREE.Vector3();

// DEBUG: hooks globales para tester en consola
if (typeof window !== 'undefined') {
  window.__sebasDebug = () => {
    if (!player) return { error: 'no player' };
    const pBox = new THREE.Box3().setFromObject(player);
    const info = {
      player: {
        pos: { x: +player.position.x.toFixed(3), y: +player.position.y.toFixed(3), z: +player.position.z.toFixed(3) },
        bboxMinY: +pBox.min.y.toFixed(3),
        bboxMaxY: +pBox.max.y.toFixed(3),
        height: +(pBox.max.y - pBox.min.y).toFixed(3),
      },
      bones: [],
      npcs: [],
    };
    // Buscar bones de los pies en el esqueleto
    const tmp = new THREE.Vector3();
    player.traverse(obj => {
      if (obj.isBone || obj.type === 'Bone') {
        obj.getWorldPosition(tmp);
        info.bones.push({ name: obj.name, y: +tmp.y.toFixed(3) });
      }
    });
    info.bones.sort((a, b) => a.y - b.y);
    info.lowestBones = info.bones.slice(0, 4);
    info.highestBones = info.bones.slice(-3);
    delete info.bones;
    for (const [id, group] of npcMeshes.entries()) {
      const b = new THREE.Box3().setFromObject(group);
      info.npcs.push({
        id, posY: +group.position.y.toFixed(3),
        bboxMinY: +b.min.y.toFixed(3), bboxMaxY: +b.max.y.toFixed(3),
        dist: +Math.hypot(group.position.x - player.position.x, group.position.z - player.position.z).toFixed(2),
      });
    }
    info.npcs.sort((a, b) => a.dist - b.dist);
    info.npcs = info.npcs.slice(0, 1);
    return info;
  };
}

// ============================================================
//                       Public API
// ============================================================

export async function startWorld(loggedInUser, token) {
  if (running) return;
  user = loggedInUser;
  authToken = token || null;

  showWorldLoading('Cargando el reino…');

  try {
    initTreeGeometries();
    setupScene();
    setupOcean();
    showWorldLoading('Cargando árboles…');
    await loadGLBTrees();
    showWorldLoading('Cargando decoración…');
    await loadGLBDecorations();
    showWorldLoading('Cargando criaturas…');
    await loadGLBNpcs();
    await setupPlayer();
    setupMarker();
    setupInput();
    setupMinimap();
    setupFullMap();
    setupHud();
    setupNpcs();

    if (authToken) {
      showWorldLoading('Restaurando tu posición…');
      try {
        const pos = await fetchPosition();
        if (pos && (pos.x !== 0 || pos.z !== 0)) {
          player.position.x = pos.x;
          player.position.z = pos.z;
          lastSavedX = pos.x;
          lastSavedZ = pos.z;
        }
      } catch (err) {
        console.warn('Could not restore position:', err);
      }
    }

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
  if (running && player && authToken) savePositionBeacon(player.position.x, player.position.z);
  running = false;

  if (combatUnsubscribe) { combatUnsubscribe(); combatUnsubscribe = null; }
  for (const m of npcMeshes.values()) { if (m.parent) m.parent.remove(m); }
  npcMeshes.clear();
  npcDataList = [];
  npcPollTimer = 0;
  pendingEngageNpcId = null;

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
  if (NPC_GEOMS) {
    for (const n of Object.values(NPC_GEOMS)) {
      if (n.glbParts) for (const p of n.glbParts) { p.geometry?.dispose(); p.material?.dispose(); }
    }
    NPC_GEOMS = null;
  }

  if (character) { character.dispose(); character = null; }
  characterFallback = false;
  if (renderer) { renderer.dispose(); renderer = null; }
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

  if (minimapCanvas) minimapCanvas.style.display = 'none';
  if (fullMapOverlay) fullMapOverlay.classList.remove('visible');
  ['worldTooltip', 'worldRegion', 'worldBanner'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.remove();
  });
  minimapCanvas = null;
  minimapCtx = null;
  fullMapCanvas = null;
  fullMapCtx = null;
  fullMapOverlay = null;
  fullMapVisible = false;
  hudHpValue = hudPrayerValue = hudRunValue = hudStatRun = null;
  authToken = null;
  positionSaveTimer = 0;
  runMode = false;
  chunkColliders.clear();

  player = marker = camera = clock = ocean = null;
  user = null;
  playerTarget = null;
  lastRegionName = '';
  lastRegionWasWild = false;

  const nameTag = document.getElementById('playerNameTag');
  if (nameTag) { nameTag.classList.add('hidden'); nameTag.style.display = 'none'; }
}

// ============================================================
//                  Noise + biomes
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
    plaza: 'Plaza Central', plains: 'Llanuras Verdes', forest: 'Bosques del Norte',
    snow: 'Tundra de Picoblanco', desert: 'Desierto de Sol', jungle: 'Selva de Verdis',
    beach: 'Costa del Sur', swamp: 'Pantano del Sauce',
  };
  return { name: REGION_NAMES[biome.id] || 'Tierras Salvajes', type: 'biome' };
}

// ============================================================
//                       Scene
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

/**
 * Detecta Z-up (Blender default): si dim Z >> dim Y, asume Z-up.
 */
function detectsZUp(root) {
  const bbox = new THREE.Box3().setFromObject(root);
  const sizeY = bbox.max.y - bbox.min.y;
  const sizeZ = bbox.max.z - bbox.min.z;
  return sizeZ > sizeY * 1.5;
}

/**
 * Helper unificado: rota Z-up→Y-up si necesario, baquea transforms,
 * escala al target height, convierte materiales a Lambert.
 *
 * forceZUp: si true, rota aunque detectsZUp() no lo detecte. Util para
 * GLBs cuyo bbox no cumple la heurística pero sabemos que vienen Z-up.
 */
function bakeGlbModel(root, targetHeight, fallbackColor, forceZUp) {
  if (forceZUp || detectsZUp(root)) {
    root.rotation.x = -Math.PI / 2;
    root.updateMatrixWorld(true);
  }
  const bbox = new THREE.Box3().setFromObject(root);
  const sizeY = bbox.max.y - bbox.min.y;
  const scaleFactor = sizeY > 0.001 ? targetHeight / sizeY : 1.0;

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
    const opts = { flatShading: false };
    if (srcMat?.color) opts.color = srcMat.color.clone();
    else opts.color = new THREE.Color(fallbackColor || 0x808080);
    if (srcMat?.map) opts.map = srcMat.map;
    if (srcMat?.alphaMap) opts.alphaMap = srcMat.alphaMap;
    if (srcMat?.transparent || srcMat?.alphaTest > 0 || srcMat?.alphaMap) {
      opts.alphaTest = 0.4;
      opts.transparent = false;
    }
    if (srcMat?.vertexColors) opts.vertexColors = true;
    const material = new THREE.MeshLambertMaterial(opts);
    material.side = THREE.DoubleSide;
    return { geometry: geom, material };
  });
  return { parts, scaleFactor };
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
//                       Decoration
// ============================================================

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

const DECORATION_CONFIG = {
  stones:     { scaleMin: 0.8, scaleMax: 1.6 },
  cave_rocks: { scaleMin: 0.6, scaleMax: 1.2 },
  grass:      { scaleMin: 1.0, scaleMax: 2.0 },
};

async function loadGLBDecorations() {
  const entries = Object.entries(DECORATION_GLB_URLS);
  if (entries.length === 0) return;
  DECORATION_GEOMS = {};
  const loader = new GLTFLoader();
  await Promise.all(entries.map(async ([typeId, url]) => {
    try {
      const gltf = await loader.loadAsync(url);
      const baked = bakeGlbModel(gltf.scene, typeId === 'grass' ? 0.4 : 1.0,
        typeId === 'grass' ? 0x6a9a3a : 0x808078);
      if (!baked) return;
      DECORATION_GEOMS[typeId] = { id: typeId, glbParts: baked.parts };
      console.log(`Loaded decoration '${typeId}'`);
    } catch (err) {
      console.warn(`Decoration '${typeId}' load failed:`, err.message);
    }
  }));
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
//                       NPCs (Slice 5a v2)
// ============================================================

async function loadGLBNpcs() {
  NPC_GEOMS = {};
  const entries = Object.entries(NPC_GLB_URLS);
  const loader = new GLTFLoader();
  await Promise.all(entries.map(async ([typeId, url]) => {
    try {
      const gltf = await loader.loadAsync(url);
      const baked = bakeGlbModel(
        gltf.scene,
        NPC_TARGET_HEIGHTS[typeId] || 1.0,
        NPC_FALLBACK_COLORS[typeId] || 0x808080,
        !!NPC_GLB_FORCE_ZUP[typeId],
      );
      if (!baked) return;
      NPC_GEOMS[typeId] = { id: typeId, glbParts: baked.parts };
      console.log(`Loaded NPC '${typeId}'`);
    } catch (err) {
      console.warn(`NPC '${typeId}' load failed, will use placeholder:`, err.message);
    }
  }));
}

function setupNpcs() {
  combatUnsubscribe = combat.onUpdate(({ npcs }) => {
    if (!Array.isArray(npcs)) return;
    npcDataList = npcs;
    syncNpcMeshes();
  });
  combat.refresh().catch(e => console.warn('[world] combat refresh:', e));
}

function syncNpcMeshes() {
  if (!scene || !player) return;
  const px = player.position.x;
  const pz = player.position.z;
  const aliveIds = new Set();

  for (const npc of npcDataList) {
    const dx = npc.x - px;
    const dz = npc.z - pz;
    if (dx * dx + dz * dz > NPC_RENDER_RADIUS * NPC_RENDER_RADIUS) continue;
    aliveIds.add(npc.id);

    let mesh = npcMeshes.get(npc.id);
    if (!mesh) {
      mesh = createNpcMesh(npc);
      if (!mesh) continue;
      scene.add(mesh);
      npcMeshes.set(npc.id, mesh);
    }
    // Server position = patrol CENTER (no posición visual). El movimiento
    // visual lo añade updateNpcPatrol() cada frame sobre este centro.
    // Solo re-anclamos si el server reportó un cambio grande (>2m), que
    // indica un respawn o un reposicionamiento real.
    const pp = mesh.userData.patrol;
    if (pp) {
      const ddx = npc.x - pp.centerX;
      const ddz = npc.z - pp.centerZ;
      if (ddx*ddx + ddz*ddz > 4.0) {
        pp.centerX = npc.x;
        pp.centerZ = npc.z;
      }
    }
    updateNpcHpBar(mesh, npc.hp_current, npc.max_hp);
    mesh.userData.npc = npc;
  }

  for (const [id, mesh] of npcMeshes.entries()) {
    if (!aliveIds.has(id)) {
      scene.remove(mesh);
      mesh.traverse?.(obj => {
        if (obj.geometry && !obj.userData?.shared) obj.geometry.dispose?.();
        if (obj.material && !obj.userData?.shared) {
          if (Array.isArray(obj.material)) obj.material.forEach(m => m.dispose());
          else obj.material.dispose();
        }
      });
      npcMeshes.delete(id);
    }
  }
}

function createNpcMesh(npc) {
  const typeId = npc.def_id;
  const group = new THREE.Group();
  group.position.set(npc.x, 0, npc.z);
  group.userData = {
    kind: 'npc',
    npc,
    // Patrol: cada NPC arranca con ángulo random para que no estén todos
    // sincronizados. Centro = posición inicial del server.
    patrol: {
      centerX: npc.x,
      centerZ: npc.z,
      angle:   Math.random() * Math.PI * 2,
      bobT:    Math.random() * Math.PI * 2,
    },
    // Reacción: cuando reciben hit, kick vector que decae a cero.
    reaction: { until: 0, kickX: 0, kickZ: 0 },
    // Material refs para flash rojo. Se rellena abajo.
    bodyMaterials: [],
  };

  const glb = NPC_GEOMS && NPC_GEOMS[typeId];
  if (glb && glb.glbParts) {
    for (const part of glb.glbParts) {
      // Cada NPC necesita SU PROPIO material (no shared) para poder
      // flashear independiente cuando recibe hit. Geometría sí compartida.
      const ownMat = part.material.clone();
      // Guardamos color base para restaurar tras el flash.
      ownMat.userData = { baseColor: ownMat.color.clone() };
      const mesh = new THREE.Mesh(part.geometry, ownMat);
      mesh.userData = { kind: 'npc-body', npcId: npc.id, shared: true };
      group.add(mesh);
      group.userData.bodyMaterials.push(ownMat);
    }
  } else {
    // Placeholder cubo coloreado
    const h = NPC_TARGET_HEIGHTS[typeId] || 1.0;
    const color = NPC_FALLBACK_COLORS[typeId] || 0x808080;
    const geom = new THREE.BoxGeometry(h * 0.7, h, h * 0.7);
    geom.translate(0, h / 2, 0);
    const mat = new THREE.MeshLambertMaterial({ color, flatShading: true });
    mat.userData = { baseColor: mat.color.clone() };
    const mesh = new THREE.Mesh(geom, mat);
    mesh.userData = { kind: 'npc-body', npcId: npc.id };
    group.add(mesh);
    group.userData.bodyMaterials.push(mat);
  }

  const hpBar = createHpBar(npc.hp_current, npc.max_hp, NPC_TARGET_HEIGHTS[typeId] || 1.0);
  group.add(hpBar);
  group.userData.hpBar = hpBar;
  return group;
}

function createHpBar(cur, max, npcHeight) {
  const W = 1.0;
  const H = 0.12;
  const group = new THREE.Group();
  group.position.y = (npcHeight || 1.0) + 0.4;
  const bgMat = new THREE.MeshBasicMaterial({ color: 0x202020, depthTest: false, transparent: true, opacity: 0.85 });
  const bg = new THREE.Mesh(new THREE.PlaneGeometry(W, H), bgMat);
  bg.renderOrder = 999;
  group.add(bg);
  const ratio = max > 0 ? Math.max(0, Math.min(1, cur / max)) : 0;
  const fillMat = new THREE.MeshBasicMaterial({ color: 0xc02020, depthTest: false });
  const fill = new THREE.Mesh(new THREE.PlaneGeometry(Math.max(0.001, W * ratio), H * 0.85), fillMat);
  fill.position.x = -W * (1 - ratio) / 2;
  fill.position.z = 0.001;
  fill.renderOrder = 1000;
  group.add(fill);
  group.userData.hpBar = { bg, fill, W, H, cur, max };
  return group;
}

// ============================================================
//             NPC patrol + hit reaction (Slice 5a v3)
// ============================================================
// Patrol: cada NPC vivo da vueltas lentas en círculo alrededor de su
// spawn point (NPC_PATROL_RADIUS, NPC_PATROL_SPEED_RPS). Cuando el
// player lo está atacando (combat.getStateSnapshot().currentTarget),
// se queda quieto. NPCs muertos tampoco se mueven (no llegan aquí
// porque syncNpcMeshes solo añade vivos al map).
//
// Reaction: cuando reciben hit, flashea el material a rojo y se
// empuja hacia atrás ~0.35m que decae a cero en 180ms. Funciona
// sobre cualquier GLB porque solo toca .position del Group y el
// .color del material (sin necesidad de huesos / animaciones).

function updateNpcPatrol(dt) {
  if (!scene) return;
  // ¿A quién está atacando el player? Si engaged, ese NPC se queda quieto.
  let engagedId = null;
  try {
    const snap = combat.getStateSnapshot?.();
    engagedId = snap ? snap.currentTarget : null;
  } catch {}

  const now = performance.now() / 1000;

  for (const [npcId, group] of npcMeshes) {
    const ud = group.userData;
    if (!ud) continue;

    // ---- Patrol loop ----
    const p = ud.patrol;
    if (p) {
      let baseX = p.centerX;
      let baseZ = p.centerZ;
      let baseY = 0;

      if (npcId !== engagedId) {
        // Avanza ángulo
        p.angle += NPC_PATROL_SPEED_RPS * dt;
        p.bobT  += NPC_PATROL_BOB_HZ * Math.PI * 2 * dt;
        const dx = Math.cos(p.angle) * NPC_PATROL_RADIUS;
        const dz = Math.sin(p.angle) * NPC_PATROL_RADIUS;
        baseX += dx;
        baseZ += dz;
        baseY  = Math.abs(Math.sin(p.bobT)) * NPC_PATROL_BOB_AMP;
        // Orienta el modelo hacia la dirección de marcha (tangente al círculo).
        const tx = -Math.sin(p.angle);
        const tz =  Math.cos(p.angle);
        group.rotation.y = Math.atan2(tx, tz);
      }

      // ---- Kick por reacción a hit (decae linealmente) ----
      const r = ud.reaction;
      let kickX = 0, kickZ = 0;
      if (r && r.until > now) {
        const remaining = (r.until - now) / NPC_REACT_DURATION_S; // 1 → 0
        kickX = r.kickX * remaining;
        kickZ = r.kickZ * remaining;
      }

      group.position.set(baseX + kickX, baseY, baseZ + kickZ);
    }

    // ---- Flash rojo del material (decae en paralelo al kick) ----
    if (ud.bodyMaterials && ud.bodyMaterials.length) {
      const r = ud.reaction;
      if (r && r.until > now) {
        const intensity = (r.until - now) / NPC_REACT_DURATION_S; // 1 → 0
        for (const m of ud.bodyMaterials) {
          const base = m.userData?.baseColor;
          if (!base) continue;
          // Lerp base → rojo según intensidad
          m.color.copy(base).lerp(_redColor, intensity);
        }
      } else if (ud.reaction && ud.reaction.wasFlashing) {
        // Restaurar color base una vez al final del flash (no cada frame)
        for (const m of ud.bodyMaterials) {
          const base = m.userData?.baseColor;
          if (base) m.color.copy(base);
        }
        ud.reaction.wasFlashing = false;
      }
    }
  }
}

const _redColor = new THREE.Color(0xff3030);

/**
 * Dispara el efecto "recibí un hit" en un NPC: empujón + flash rojo.
 * Lo llama combat.js (via window.__worldFlashNpcHit) cuando el server
 * confirma que el ataque del player conectó.
 */
function flashNpcHit(npcId) {
  const group = npcMeshes.get(npcId);
  if (!group || !group.userData) return;
  // Vector empujón: alejándose del player (dirección NPC ← player)
  const pp = group.userData.patrol;
  const cx = pp ? pp.centerX : group.position.x;
  const cz = pp ? pp.centerZ : group.position.z;
  let dx = cx - player.position.x;
  let dz = cz - player.position.z;
  const len = Math.hypot(dx, dz);
  if (len > 0.001) { dx /= len; dz /= len; }
  else { dx = 0; dz = 1; }
  const r = group.userData.reaction;
  r.until = (performance.now() / 1000) + NPC_REACT_DURATION_S;
  r.kickX = dx * NPC_REACT_KICK_DIST;
  r.kickZ = dz * NPC_REACT_KICK_DIST;
  r.wasFlashing = true;
}

// Hook global para que combat.js (u otros módulos) disparen el efecto
// sin tener que importar world.js (evita riesgo de circular import).
if (typeof window !== 'undefined') {
  window.__worldFlashNpcHit = flashNpcHit;
}

function updateNpcHpBar(npcMesh, cur, max) {
  const hpBarGroup = npcMesh.userData.hpBar;
  if (!hpBarGroup || !hpBarGroup.userData?.hpBar) return;
  const data = hpBarGroup.userData.hpBar;
  if (data.cur === cur && data.max === max) return;
  data.cur = cur;
  data.max = max;
  const ratio = max > 0 ? Math.max(0, Math.min(1, cur / max)) : 0;
  data.fill.geometry.dispose();
  data.fill.geometry = new THREE.PlaneGeometry(Math.max(0.001, data.W * ratio), data.H * 0.85);
  data.fill.position.x = -data.W * (1 - ratio) / 2;
}

function updateNpcHpBars() {
  if (!camera) return;
  for (const mesh of npcMeshes.values()) {
    const bar = mesh.userData.hpBar;
    if (!bar) continue;
    bar.quaternion.copy(camera.quaternion);
  }
}

function updateNpcPolling(dt) {
  npcPollTimer += dt * 1000;
  if (npcPollTimer < NPC_POLL_INTERVAL_MS) return;
  npcPollTimer = 0;
  combat.refresh().catch(() => {});
}

// ============================================================
//                       Player
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
  if (nameTag && user) { nameTag.textContent = user.username; nameTag.classList.remove('hidden'); }
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
//                       Chunks
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
  for (const m of chunk.decorMeshes || []) { scene.remove(m); m.dispose?.(); }
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
    colors[i * 3] = cTmp.r;
    colors[i * 3 + 1] = cTmp.g;
    colors[i * 3 + 2] = cTmp.b;
  }
  geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
}

// ============================================================
//                       Places + Trees building
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
//                       Minimap
// ============================================================

function setupMinimap() {
  const el = document.getElementById('worldMinimap');
  if (!el) { console.warn('Minimap canvas not found'); return; }
  el.style.display = 'block';
  el.style.borderRadius = '50%';
  el.style.border = '2px solid #5a4a30';
  el.style.background = 'rgba(20, 14, 8, 0.85)';
  el.style.boxShadow = '0 2px 6px rgba(0,0,0,0.5)';
  minimapCanvas = el;
  minimapCtx = el.getContext('2d');

  // CAMBIO: tap simple en minimapa → goto, no abre el mapa.
  addL(el, 'pointerup', (ev) => {
    if (ev.button !== undefined && ev.button !== 0) return;
    ev.preventDefault();
    const rect = el.getBoundingClientRect();
    const cx = ev.clientX - rect.left;
    const cy = ev.clientY - rect.top;
    const W = el.width;
    const H = el.height;
    const RANGE = 900;
    const scale = (W / 2) / RANGE;
    const dx = (cx - W / 2) / scale;
    const dz = (cy - H / 2) / scale;
    const tx = player.position.x + dx;
    const tz = player.position.z + dz;
    setPlayerTarget(tx, tz);
  });

  // Botón aparte abajo-derecha del minimapa para abrir el mapa grande
  const openMapBtn = document.getElementById('minimapOpenMap');
  if (openMapBtn) {
    addL(openMapBtn, 'pointerup', (ev) => {
      if (ev.button !== undefined && ev.button !== 0) return;
      ev.preventDefault();
      ev.stopPropagation();
      openFullMap();
    });
  }
}

function drawMinimap() {
  if (!minimapCtx || !player) return;
  const ctx = minimapCtx;
  const W = minimapCanvas.width;
  const H = minimapCanvas.height;
  const RANGE = 900;
  const cx = W / 2, cy = H / 2;
  const scale = (W / 2) / RANGE;
  const px = player.position.x;
  const pz = player.position.z;

  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, W / 2 - 2, 0, Math.PI * 2);
  ctx.clip();

  const pb = biomeAt(px, pz);
  ctx.fillStyle = '#' + pb.base.toString(16).padStart(6, '0');
  ctx.fillRect(0, 0, W, H);

  const wildScreenX = cx + (WILDERNESS_X - px) * scale;
  if (wildScreenX > 0) {
    ctx.fillStyle = 'rgba(180, 30, 30, 0.35)';
    ctx.fillRect(0, 0, Math.min(W, wildScreenX), H);
  }
  ctx.fillStyle = 'rgba(40, 80, 120, 0.65)';
  const leftEdgeX = cx + (-WORLD_HALF - px) * scale;
  if (leftEdgeX > 0) ctx.fillRect(0, 0, leftEdgeX, H);
  const rightEdgeX = cx + (WORLD_HALF - px) * scale;
  if (rightEdgeX < W) ctx.fillRect(rightEdgeX, 0, W - rightEdgeX, H);
  const topEdgeY = cy + (-WORLD_HALF - pz) * scale;
  if (topEdgeY > 0) ctx.fillRect(0, 0, W, topEdgeY);
  const bottomEdgeY = cy + (WORLD_HALF - pz) * scale;
  if (bottomEdgeY < H) ctx.fillRect(0, bottomEdgeY, W, H - bottomEdgeY);

  const RANGE_SQ = RANGE * RANGE;
  ctx.fillStyle = '#3a7a2a';
  for (const m of interactableMeshes) {
    const list = m.userData?.trees;
    if (!list || m.userData?.kind !== 'tree-trunk') continue;
    for (const t of list) {
      const dx = t.x - px, dz = t.z - pz;
      if (dx * dx + dz * dz > RANGE_SQ) continue;
      const sx = cx + dx * scale;
      const sy = cy + dz * scale;
      ctx.fillRect(sx - 1, sy - 1, 2, 2);
    }
  }

  // NUEVO: NPCs como puntos blancos
  const NPC_RAD_SQ = NPC_MINIMAP_RADIUS * NPC_MINIMAP_RADIUS;
  for (const npc of npcDataList) {
    const dx = npc.x - px, dz = npc.z - pz;
    if (dx * dx + dz * dz > NPC_RAD_SQ) continue;
    const sx = cx + dx * scale, sy = cy + dz * scale;
    ctx.beginPath();
    ctx.arc(sx, sy, 2, 0, Math.PI * 2);
    ctx.fillStyle = '#fff';
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.7)';
    ctx.lineWidth = 0.8;
    ctx.stroke();
  }

  for (const p of PLACES) {
    const sx = cx + (p.x - px) * scale, sy = cy + (p.z - pz) * scale;
    if (sx < -10 || sx > W + 10 || sy < -10 || sy > H + 10) continue;
    let r, fillC;
    if (p.type === 'city') { r = 6; fillC = '#ffd060'; }
    else if (p.type === 'village') { r = 4.5; fillC = '#c8a043'; }
    else if (p.type === 'boss') { r = 5.5; fillC = '#ff3030'; }
    else if (p.type === 'tower') { r = 4.5; fillC = '#7090d0'; }
    else if (p.type === 'mine') { r = 4.5; fillC = '#808080'; }
    else if (p.type === 'temple') { r = 4.5; fillC = '#fff4d0'; }
    else if (p.type === 'altar') { r = 4.5; fillC = '#a040c0'; }
    else if (p.type === 'ruins') { r = 4; fillC = '#9090c0'; }
    else { r = 4; fillC = '#9090c0'; }
    ctx.beginPath();
    ctx.arc(sx, sy, r + 2, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(sx, sy, r, 0, Math.PI * 2);
    ctx.fillStyle = fillC;
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = '#000';
    ctx.stroke();
    const distSq = (p.x - px) ** 2 + (p.z - pz) ** 2;
    if (distSq < 350 * 350) {
      ctx.font = 'bold 9px serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(0,0,0,0.85)';
      ctx.fillText(p.name, sx + 1, sy + r + 9);
      ctx.fillStyle = '#fff8d0';
      ctx.fillText(p.name, sx, sy + r + 8);
    }
  }

  const others = (typeof window !== 'undefined' && Array.isArray(window.__otherPlayers))
    ? window.__otherPlayers : [];
  for (const op of others) {
    if (typeof op?.x !== 'number' || typeof op?.z !== 'number') continue;
    const dx = op.x - px, dz = op.z - pz;
    if (dx * dx + dz * dz > RANGE_SQ) continue;
    const sx = cx + dx * scale, sy = cy + dz * scale;
    ctx.beginPath();
    ctx.arc(sx, sy, 3.5, 0, Math.PI * 2);
    ctx.fillStyle = '#fff';
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = '#000';
    ctx.stroke();
  }

  ctx.restore();

  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(cx, cy, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = '#000';
  ctx.stroke();
  const ang = player.rotation.y;
  const ax = cx + Math.sin(ang) * 9, ay = cy + Math.cos(ang) * 9;
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(ax, ay);
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = '#e8c560';
  ctx.font = 'bold 12px serif';
  ctx.textAlign = 'center';
  ctx.fillText('N', cx, 14);
}

// ============================================================
//                       Full-map modal
// ============================================================

function setupFullMap() {
  fullMapOverlay = document.getElementById('fullMapOverlay');
  fullMapCanvas = document.getElementById('worldFullMap');
  if (!fullMapOverlay || !fullMapCanvas) { console.warn('Full map elements not found'); return; }
  fullMapCtx = fullMapCanvas.getContext('2d');
  const closeBtn = document.getElementById('fullMapClose');
  if (closeBtn) {
    addL(closeBtn, 'pointerup', (ev) => {
      if (ev.button !== undefined && ev.button !== 0) return;
      ev.preventDefault();
      closeFullMap();
    });
  }
  addL(fullMapOverlay, 'click', (e) => { if (e.target === fullMapOverlay) closeFullMap(); });
}

function openFullMap() {
  if (!fullMapOverlay || !fullMapCanvas) return;
  fullMapOverlay.classList.add('visible');
  fullMapVisible = true;
  drawFullMap();
}

function closeFullMap() {
  if (!fullMapOverlay) return;
  fullMapOverlay.classList.remove('visible');
  fullMapVisible = false;
}

function drawFullMap() {
  if (!fullMapCtx || !player) return;
  const ctx = fullMapCtx;
  const W = fullMapCanvas.width;
  const H = fullMapCanvas.height;
  const worldToScreen = (wx, wz) => ({
    x: ((wx + WORLD_HALF) / (WORLD_HALF * 2)) * W,
    y: ((wz + WORLD_HALF) / (WORLD_HALF * 2)) * H,
  });
  ctx.fillStyle = '#4a7896'; ctx.fillRect(0, 0, W, H);
  const SAMPLES = 100;
  const cellW = W / SAMPLES, cellH = H / SAMPLES;
  for (let i = 0; i < SAMPLES; i++) {
    for (let j = 0; j < SAMPLES; j++) {
      const wx = -WORLD_HALF + ((i + 0.5) / SAMPLES) * (WORLD_HALF * 2);
      const wz = -WORLD_HALF + ((j + 0.5) / SAMPLES) * (WORLD_HALF * 2);
      const b = biomeAt(wx, wz);
      ctx.fillStyle = '#' + b.base.toString(16).padStart(6, '0');
      ctx.fillRect(i * cellW, j * cellH, cellW + 1, cellH + 1);
    }
  }
  const wildEdgeScreen = worldToScreen(WILDERNESS_X, 0).x;
  ctx.fillStyle = 'rgba(180, 30, 30, 0.28)';
  ctx.fillRect(0, 0, wildEdgeScreen, H);
  ctx.strokeStyle = 'rgba(220, 60, 60, 0.7)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(wildEdgeScreen, 0);
  ctx.lineTo(wildEdgeScreen, H);
  ctx.stroke();
  ctx.fillStyle = 'rgba(255, 100, 80, 0.9)';
  ctx.font = 'bold 14px "Cinzel", serif';
  ctx.textAlign = 'center';
  ctx.fillText('TIERRAS ROTAS', wildEdgeScreen / 2, 28);

  for (const p of PLACES) {
    const s = worldToScreen(p.x, p.z);
    let r, fillC;
    if (p.type === 'city') { r = 7; fillC = '#ffd060'; }
    else if (p.type === 'village') { r = 5; fillC = '#c8a043'; }
    else if (p.type === 'boss') { r = 6; fillC = '#ff3030'; }
    else if (p.type === 'tower') { r = 5; fillC = '#7090d0'; }
    else if (p.type === 'mine') { r = 5; fillC = '#808080'; }
    else if (p.type === 'temple') { r = 5; fillC = '#fff4d0'; }
    else if (p.type === 'altar') { r = 5; fillC = '#a040c0'; }
    else if (p.type === 'ruins') { r = 4.5; fillC = '#9090c0'; }
    else { r = 4; fillC = '#9090c0'; }
    ctx.beginPath();
    ctx.arc(s.x, s.y, r + 2, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,0,0,0.65)';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
    ctx.fillStyle = fillC;
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = '#000';
    ctx.stroke();
    ctx.font = (p.type === 'city' ? 'bold 11px' : '10px') + ' "IM Fell English", serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(0,0,0,0.85)';
    ctx.fillText(p.name, s.x + 1, s.y + r + 11);
    ctx.fillStyle = p.type === 'city' ? '#fff8d0' : '#e8d8a8';
    ctx.fillText(p.name, s.x, s.y + r + 10);
  }
  const ps = worldToScreen(player.position.x, player.position.z);
  const grad = ctx.createRadialGradient(ps.x, ps.y, 0, ps.x, ps.y, 14);
  grad.addColorStop(0, 'rgba(255, 255, 255, 0.9)');
  grad.addColorStop(1, 'rgba(255, 255, 255, 0)');
  ctx.fillStyle = grad;
  ctx.beginPath(); ctx.arc(ps.x, ps.y, 14, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(ps.x, ps.y, 5, 0, Math.PI * 2);
  ctx.fillStyle = '#fff'; ctx.fill();
  ctx.lineWidth = 2; ctx.strokeStyle = '#000'; ctx.stroke();
  if (user) {
    ctx.font = 'bold 12px "Cinzel", serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(0,0,0,0.9)';
    ctx.fillText(user.username, ps.x + 1, ps.y - 9);
    ctx.fillStyle = '#fff8d0';
    ctx.fillText(user.username, ps.x, ps.y - 10);
  }
  ctx.fillStyle = '#e8c560';
  ctx.font = 'bold 14px "Cinzel", serif';
  ctx.textAlign = 'left';
  ctx.fillText('N ↑', 10, 18);
}

// ============================================================
//                       HUD
// ============================================================

function setupHud() {
  hudHpValue = document.getElementById('hudHpValue');
  hudPrayerValue = document.getElementById('hudPrayerValue');
  hudRunValue = document.getElementById('hudRunValue');
  hudStatRun = document.getElementById('hudStatRun');
  if (hudHpValue) hudHpValue.textContent = '10';
  if (hudPrayerValue) hudPrayerValue.textContent = '10';
  if (hudRunValue) hudRunValue.textContent = '100';
  if (hudStatRun) {
    addL(hudStatRun, 'pointerup', (ev) => {
      if (ev.button !== undefined && ev.button !== 0) return;
      ev.preventDefault();
      toggleRunMode();
    });
  }
}

function toggleRunMode() {
  runMode = !runMode;
  if (hudStatRun) {
    if (runMode) hudStatRun.classList.add('active');
    else hudStatRun.classList.remove('active');
  }
}

// ============================================================
//                       Position persistence
// ============================================================

async function fetchPosition() {
  if (!authToken) return null;
  const res = await fetch(`${API_BASE}/api/position`, {
    method: 'GET',
    headers: { 'Authorization': `Bearer ${authToken}` },
  });
  if (!res.ok) return null;
  return await res.json();
}

async function savePosition(x, z) {
  if (!authToken) return;
  try {
    const res = await fetch(`${API_BASE}/api/position`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${authToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ x, z }),
    });
    if (res.ok) { lastSavedX = x; lastSavedZ = z; }
  } catch (err) { console.warn('savePosition failed:', err); }
}

function savePositionBeacon(x, z) {
  if (!authToken) return;
  try {
    fetch(`${API_BASE}/api/position`, {
      method: 'POST', keepalive: true,
      headers: { 'Authorization': `Bearer ${authToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ x, z }),
    });
  } catch (err) {}
}

// ============================================================
//                       Tooltips / Region / Banner
// ============================================================

function ensureTooltipEl() {
  let el = document.getElementById('worldTooltip');
  if (el) return el;
  el = document.createElement('div');
  el.id = 'worldTooltip';
  el.style.cssText = `position: absolute; z-index: 30; pointer-events: none;
    background: rgba(20, 14, 8, 0.92); border: 1.5px solid #c8a043; color: #e8c560;
    font-family: 'IM Fell English', serif; font-size: 14px;
    padding: 10px 14px; border-radius: 4px;
    text-shadow: 0 1px 2px rgba(0,0,0,0.9);
    transition: opacity 0.22s; opacity: 0; max-width: 240px; line-height: 1.45;
    box-shadow: 0 4px 14px rgba(0,0,0,0.55);
    backdrop-filter: blur(4px); -webkit-backdrop-filter: blur(4px);`;
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
    </div>`;
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
  el.style.cssText = `position: absolute;
    top: calc(env(safe-area-inset-top, 0px) + 60px);
    left: 50%; transform: translateX(-50%); z-index: 12; pointer-events: none;
    background: rgba(20, 14, 8, 0.78);
    border: 1px solid rgba(200, 170, 120, 0.4);
    color: rgba(232, 197, 96, 0.95);
    font-family: 'IM Fell English SC', serif;
    font-size: 13px; padding: 5px 14px; border-radius: 999px;
    backdrop-filter: blur(4px); -webkit-backdrop-filter: blur(4px);
    text-shadow: 0 1px 2px rgba(0,0,0,0.9);
    letter-spacing: 0.05em;
    transition: opacity 0.3s, color 0.3s, border-color 0.3s;`;
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
  // Mostrar y programar fade tras 4s
  el.style.transition = 'opacity 0.6s';
  el.style.opacity = '1';
  if (regionFadeTimer) clearTimeout(regionFadeTimer);
  regionFadeTimer = setTimeout(() => {
    el.style.opacity = '0';
  }, 4000);
}

function ensureBannerEl() {
  let el = document.getElementById('worldBanner');
  if (el) return el;
  el = document.createElement('div');
  el.id = 'worldBanner';
  el.style.cssText = `position: absolute; top: 30%; left: 50%;
    transform: translate(-50%, -45%); z-index: 25; pointer-events: none;
    background: rgba(20, 14, 8, 0.88); border: 2px solid #c8a043;
    color: #fff8d0; font-family: 'Cinzel', serif; font-weight: 700;
    font-size: 22px; padding: 14px 30px; border-radius: 4px;
    text-shadow: 0 2px 6px rgba(0,0,0,0.9);
    transition: opacity 0.5s, transform 0.5s;
    letter-spacing: 0.08em; text-align: center;
    box-shadow: 0 8px 24px rgba(0,0,0,0.6);
    opacity: 0; white-space: nowrap; max-width: 90vw;`;
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
  // pointermove/up van en window para que el drag continúe aunque el
  // dedo se salga del canvas durante el arrastre
  addL(window, 'pointermove', onCanvasPointerMove);
  addL(window, 'pointerup',   onCanvasPointerUp);
  addL(window, 'pointercancel', onCanvasPointerUp);
  addL(canvas, 'contextmenu', e => e.preventDefault());
  addL(window, 'keydown', onKeyDown);
  setupJoystick();
  setupTouchCamera();
  addL(window, 'resize', onResize);
}

// === Tap vs Drag con 1 dedo ===
// Si el dedo se mueve más de TAP_DRAG_THRESHOLD pixels antes de soltar,
// es DRAG → rota la cámara. Si no, es TAP → goto / atacar NPC.
const TAP_DRAG_THRESHOLD = 8;          // px
const CAMERA_DRAG_YAW_SENS = 0.005;    // rad/px horizontal
const CAMERA_DRAG_PITCH_SENS = 0.004;  // rad/px vertical
let canvasPointer = null;

function onCanvasPointerDown(e) {
  if (e.button !== undefined && e.button !== 0) return;
  if (e.target !== canvas) return;
  canvasPointer = {
    x0: e.clientX, y0: e.clientY,
    lastX: e.clientX, lastY: e.clientY,
    isDrag: false,
    pointerId: e.pointerId,
  };
}

function onCanvasPointerMove(e) {
  if (!canvasPointer) return;
  if (canvasPointer.pointerId !== undefined && e.pointerId !== canvasPointer.pointerId) return;
  const totalDist = Math.hypot(e.clientX - canvasPointer.x0, e.clientY - canvasPointer.y0);
  if (!canvasPointer.isDrag && totalDist < TAP_DRAG_THRESHOLD) return;
  canvasPointer.isDrag = true;
  const ddx = e.clientX - canvasPointer.lastX;
  const ddy = e.clientY - canvasPointer.lastY;
  cameraYaw   -= ddx * CAMERA_DRAG_YAW_SENS;
  cameraPitch -= ddy * CAMERA_DRAG_PITCH_SENS;
  cameraPitch = Math.max(0.1, Math.min(1.3, cameraPitch));
  canvasPointer.lastX = e.clientX;
  canvasPointer.lastY = e.clientY;
}

function onCanvasPointerUp(e) {
  if (!canvasPointer) return;
  if (canvasPointer.pointerId !== undefined && e.pointerId !== canvasPointer.pointerId) {
    canvasPointer = null;
    return;
  }
  const wasDrag = canvasPointer.isDrag;
  canvasPointer = null;
  if (wasDrag) return;
  doCanvasTap(e);
}

function doCanvasTap(e) {
  const rect = canvas.getBoundingClientRect();
  const nx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  const ny = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera({ x: nx, y: ny }, camera);

  // 1) Tap NPC → auto-walk hacia él y engage cuando lleguemos cerca
  const npcMeshList = [];
  for (const group of npcMeshes.values()) {
    group.traverse(obj => { if (obj.userData?.kind === 'npc-body') npcMeshList.push(obj); });
  }
  if (npcMeshList.length > 0) {
    const npcHits = raycaster.intersectObjects(npcMeshList, false);
    if (npcHits.length > 0) {
      const hit = npcHits[0];
      const npcId = hit.object.userData.npcId;
      const npc = npcDataList.find(n => n.id === npcId);
      if (npc) {
        const dx = npc.x - player.position.x;
        const dz = npc.z - player.position.z;
        const dist = Math.hypot(dx, dz);
        pendingEngageNpcId = npcId;
        if (dist <= NPC_ENGAGE_RANGE) {
          pendingEngageNpcId = null;
          combat.engageNpc(npcId);
        } else {
          setPlayerTarget(npc.x, npc.z);
          combat.feedLog?.('info', `Vas hacia ${npc.name}...`);
        }
        return;
      }
    }
  }

  // 2) Tap árbol → tooltip
  const treeHits = raycaster.intersectObjects(interactableMeshes, false);
  if (treeHits.length > 0) {
    const hit = treeHits[0];
    const treeType = hit.object.userData.treeType;
    if (treeType) {
      showTreeTooltip(treeType, e.clientX, e.clientY);
      return;
    }
  }

  // 3) Tap suelo → goto
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

/**
 * Joystick izquierdo: movimiento.
 */
function setupJoystick() {
  const joyEl = document.getElementById('joystick');
  const joyKnob = document.getElementById('joystickKnob');
  if (!joyEl || !joyKnob) return;
  let centerX = 0, centerY = 0;
  const MAX_R = 42;
  function setKnob(dx, dy) { joyKnob.style.transform = `translate(${dx}px, ${dy}px)`; }
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
    let dx = cx - centerX, dy = cy - centerY;
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
  function onEnd() { joyState.active = false; joyState.x = 0; joyState.y = 0; setKnob(0, 0); }
  addL(joyEl, 'touchstart', onStart, { passive: false });
  addL(joyEl, 'touchmove', onMove, { passive: false });
  addL(joyEl, 'touchend', onEnd);
  addL(joyEl, 'touchcancel', onEnd);
  addL(joyEl, 'mousedown', onStart);
  addL(window, 'mousemove', onMove);
  addL(window, 'mouseup', onEnd);
}

/**
 * Pinch zoom + rotación con 2 dedos. Activo SOLO si los dedos están
 * fuera del joystick izquierdo (evitamos conflicto).
 */
function setupTouchCamera() {
  let active = false;
  let lastMidX = 0, lastMidY = 0;
  let lastPinchDist = 0;

  function touchInsideJoystick(touch) {
    const joyL = document.getElementById('joystick');
    if (!joyL) return false;
    const r = joyL.getBoundingClientRect();
    return touch.clientX >= r.left && touch.clientX <= r.right &&
           touch.clientY >= r.top  && touch.clientY <= r.bottom;
  }

  addL(canvas, 'touchstart', e => {
    if (e.touches.length === 2) {
      if (touchInsideJoystick(e.touches[0]) || touchInsideJoystick(e.touches[1])) return;
      active = true;
      lastMidX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
      lastMidY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
      lastPinchDist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY);
    }
  });

  addL(canvas, 'touchmove', e => {
    if (active && e.touches.length === 2) {
      e.preventDefault();
      const mx = (e.touches[0].clientX + e.touches[1].clientX) / 2;
      const my = (e.touches[0].clientY + e.touches[1].clientY) / 2;
      // Rotación con movimiento del midpoint
      cameraYaw += (mx - lastMidX) * 0.005;
      cameraPitch -= (my - lastMidY) * 0.005;
      cameraPitch = Math.max(0.1, Math.min(1.3, cameraPitch));
      // Pinch zoom
      const newPinch = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY);
      const pinchDelta = newPinch - lastPinchDist;
      cameraDist -= pinchDelta * 0.05;
      cameraDist = Math.max(CAMERA_DIST_MIN, Math.min(CAMERA_DIST_MAX, cameraDist));
      lastMidX = mx; lastMidY = my;
      lastPinchDist = newPinch;
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
  updateCamera(dt);
  updateMarker();
  updateSpinners(dt);
  if (character) {
    character.update(dt);
    // Y del player: -1.10 hardcodeado tras calibración (modelo de Nico
    // tiene root motion / huesos elevados respecto al bbox; sin esto flota).
    // El override window.__sebasOffsetY sigue disponible para futuras pruebas.
    if (player && !characterFallback) {
      player.position.y = (typeof window !== 'undefined' && typeof window.__sebasOffsetY === 'number')
        ? window.__sebasOffsetY
        : -1.10;
    }
  }
  updateNameTag();
  updateRegionTracking();
  updateNpcPatrol(dt);
  updateNpcHpBars();
  updateNpcPolling(dt);
  drawMinimap();
  updatePositionSave(dt);
  renderer.render(scene, camera);
}

function updatePositionSave(dt) {
  if (!authToken) return;
  positionSaveTimer += dt * 1000;
  if (positionSaveTimer < POSITION_SAVE_INTERVAL) return;
  positionSaveTimer = 0;
  const dx = player.position.x - lastSavedX;
  const dz = player.position.z - lastSavedZ;
  if (dx * dx + dz * dz < POSITION_SAVE_MIN_DELTA * POSITION_SAVE_MIN_DELTA) return;
  savePosition(player.position.x, player.position.z);
}

function updatePlayer(dt) {
  let isMoving = false;
  let moveSpeed = 0;
  const maxSpeed = runMode ? PLAYER_RUN * PLAYER_RUN_BOOST : PLAYER_RUN;

  if (joyState.active && (Math.abs(joyState.x) > 0.15 || Math.abs(joyState.y) > 0.15)) {
    // User mueve con joystick → cancela cualquier auto-engage pendiente
    if (pendingEngageNpcId !== null) pendingEngageNpcId = null;
    const len = Math.hypot(joyState.x, joyState.y);
    const speedScale = Math.min(1, len);
    const camForwardX = -Math.sin(cameraYaw);
    const camForwardZ = -Math.cos(cameraYaw);
    const camRightX = Math.cos(cameraYaw);
    const camRightZ = -Math.sin(cameraYaw);
    const wx = camRightX * joyState.x + camForwardX * (-joyState.y);
    const wz = camRightZ * joyState.x + camForwardZ * (-joyState.y);
    const speed = maxSpeed * speedScale;
    const nextX = player.position.x + wx * speed * dt;
    const nextZ = player.position.z + wz * speed * dt;
    const adjusted = applyTreeCollision(player.position.x, player.position.z, nextX, nextZ);
    player.position.x = adjusted.x;
    player.position.z = adjusted.z;
    if (wx !== 0 || wz !== 0) player.rotation.y = Math.atan2(wx, wz);
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
      const step = maxSpeed * dt;
      let nextX, nextZ;
      if (step >= dist) { nextX = playerTarget.x; nextZ = playerTarget.z; }
      else {
        const nx = dx / dist, nz = dz / dist;
        nextX = player.position.x + nx * step;
        nextZ = player.position.z + nz * step;
      }
      const adjusted = applyTreeCollision(player.position.x, player.position.z, nextX, nextZ);
      const moved = Math.hypot(adjusted.x - player.position.x, adjusted.z - player.position.z);
      if (moved < 0.01) {
        playerTarget = null;
        marker.visible = false;
      } else {
        player.position.x = adjusted.x;
        player.position.z = adjusted.z;
        if (step >= dist && moved >= dist - 0.05) {
          playerTarget = null;
          marker.visible = false;
        }
        player.rotation.y = Math.atan2(dx, dz);
        isMoving = true;
        moveSpeed = 1.0;
      }
    }
  }

  player.position.x = Math.max(-WORLD_HALF + 1, Math.min(WORLD_HALF - 1, player.position.x));
  player.position.z = Math.max(-WORLD_HALF + 1, Math.min(WORLD_HALF - 1, player.position.z));

  if (character && character.loaded) {
    if (!isMoving) character.play('idle');
    else if (moveSpeed > 0.7) character.play('run');
    else character.play('walk');
  }

  // Auto-engage cuando llegamos cerca de un NPC marcado como pending,
  // y persigue al NPC si se mueve (actualiza el target con su posición actual)
  if (pendingEngageNpcId !== null) {
    const npc = npcDataList.find(n => n.id === pendingEngageNpcId);
    if (npc) {
      const dx = npc.x - player.position.x;
      const dz = npc.z - player.position.z;
      const dist = Math.hypot(dx, dz);
      if (dist <= NPC_ENGAGE_RANGE) {
        const id = pendingEngageNpcId;
        pendingEngageNpcId = null;
        playerTarget = null;
        marker.visible = false;
        combat.engageNpc(id);
      } else if (playerTarget) {
        // Persigue al NPC: actualiza coordenadas del target con su posición actual
        playerTarget.x = npc.x;
        playerTarget.z = npc.z;
        marker.position.set(npc.x, 0.05, npc.z);
      }
    } else {
      // NPC ya no existe (murió o se fue de rango). Cancelar.
      pendingEngageNpcId = null;
    }
  }
}

function updateCamera(dt) {
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
  tag.style.top = sy + 'px';
}

function updateRegionTracking() {
  const region = getRegionInfo(player.position.x, player.position.z);
  applyWildernessVisuals(region.isWild);
  if (region.name !== lastRegionName) {
    updateRegionDisplay(region);
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
//                       Collision
// ============================================================

function applyTreeCollision(x0, z0, x1, z1) {
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
//                       Loading UI
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
