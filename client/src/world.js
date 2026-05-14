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
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
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
 * Per-NPC: skip auto-detect Z-up. Para modelos cuyo bbox raw despista a
 * detectsZUp pero que en realidad son Y-up.
 */
const NPC_GLB_FORCE_NO_ZUP = {
  cow: true,   // bbox raw tiene Z alto pero el modelo es Y-up native
};

/**
 * Per-NPC config: cuándo forzar rotación Z-up.
 *
 * NOTA Slice 5b post-fix: la vaca low_poly_cow.glb originalmente
 * parecía Z-up por su bbox (alto en Y), pero tras probar tanto -π/2
 * como +π/2 en X resulta que es Y-up nativo con un bbox raro. Sin
 * rotación se ve correctamente.
 */
const NPC_GLB_FORCE_ZUP = {
  // cow: false   ← NO se rota
};

/**
 * Per-NPC: si Z-up estándar (rot X = -π/2) deja el modelo boca arriba,
 * invertimos a +π/2. (Por ahora ningún NPC lo necesita.)
 */
const NPC_GLB_FORCE_ZUP_INVERT = {
  // (vacío)
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

// ============================================================
// Slice 5c.5 — Multiplayer (peers locales)
// ============================================================
const MP_HEARTBEAT_INTERVAL = 500;   // ms entre heartbeats al server
const MP_PEERS_POLL_INTERVAL = 500;  // ms entre polls de peers cercanos
const MP_PEER_INTERP_MS = 500;       // interpolación entre snapshots
const MP_PEER_TIMEOUT_MS = 10_000;   // si no llega update en 10s, peer offline

let mpHeartbeatTimer = 0;
let mpPeersPollTimer = 0;
let mpLastPeerMap = new Map();   // user_id → { group, mixer, actions, currentAction, fromX, fromZ, toX, toZ, fromYaw, toYaw, interpStart, state, nameTagDiv }
let mpInFlightPeers = false;
let mpInFlightHeartbeat = false;
let mpPlayerState = 'idle';      // tu estado actual reportado al server

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
    setupHomeTeleportButton();

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

  // Slice 5c.5 — Limpiar peers de multiplayer
  for (const userId of Array.from(mpLastPeerMap.keys())) {
    removeMpPeer(userId);
  }
  mpHeartbeatTimer = 0;
  mpPeersPollTimer = 0;

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
  // BUG FIX: bloquear pan/zoom nativo del browser sobre el canvas. Esto
  // impide que el navegador interprete gestos de 2 dedos (joystick +
  // rotar cámara) como pinch-zoom de la página.
  canvas.style.touchAction = 'none';
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
 * forceZUp: si true, rota aunque detectsZUp() no lo detecte.
 * forceZUpInvert: si true, rota +π/2 en X (en lugar del default -π/2).
 *   Lo usa la vaca low-poly nueva que viene Z-up con eje frontal invertido.
 */
/**
 * Mide la bbox Y de un modelo recorriendo cada mesh y aplicando su
 * matrixWorld a su geometry.boundingBox. Funciona en SkinnedMesh donde
 * setFromObject puede devolver un bbox erróneo si el esqueleto no
 * está bind-poseado en el render loop todavía.
 */
function measureSkinnedBbox(root) {
  let minY = Infinity, maxY = -Infinity;
  let found = false;
  root.traverse(obj => {
    if (!obj.isMesh || !obj.geometry) return;
    if (!obj.geometry.boundingBox) obj.geometry.computeBoundingBox();
    const bb = obj.geometry.boundingBox;
    if (!bb) return;
    // 8 esquinas en world space, recogemos Y min/max
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

function bakeGlbModel(root, targetHeight, fallbackColor, forceZUp, forceZUpInvert, forceNoZUp) {
  if (!forceNoZUp && (forceZUp || detectsZUp(root))) {
    root.rotation.x = forceZUpInvert ? (Math.PI / 2) : (-Math.PI / 2);
    root.updateMatrixWorld(true);
  }

  // Para SkinnedMesh hay que actualizar la bind matrix antes de medir el bbox,
  // si no Three.js mide los vértices en posición "raw" sin esqueleto y devuelve
  // un bbox minúsculo → escala explosiva. Forzamos updateMatrixWorld profundo.
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

  // Defensa contra modelos cuyo bbox sale mal medido (típico: SkinnedMesh
  // de pollo Sketchfab cuyo bind pose no se aplica antes del setFromObject,
  // resultando en bbox de ~4mm y scale ×242). Si el scale resultante es
  // claramente absurdo, intentamos medir con boundingBox de cada mesh
  // individualmente sumando manualmente.
  if (scaleFactor > 50 || scaleFactor < 0.0001) {
    const measured = measureSkinnedBbox(root);
    if (measured && measured.sizeY > 0.001) {
      sizeY = measured.sizeY;
      scaleFactor = targetHeight / sizeY;
      bbox.min.y = measured.minY;
      bbox.max.y = measured.maxY;
      console.warn(`bbox fallback applied: sizeY=${sizeY.toFixed(3)} new scale=${scaleFactor.toFixed(4)}`);
    } else {
      // Última red de seguridad: clamp a un rango sano.
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

    // Slice 5b post-fix — preservar el material ORIGINAL del GLB en vez de
    // recrearlo como Lambert. Los GLBs modernos (Sketchfab, Quaternius) usan
    // MeshStandardMaterial con baseColorTexture; al recrear como Lambert
    // perdíamos el mapping de UV/textura (vaca y pollo salían plateados).
    // Ahora .clone() preserva map, color, emissive y demás propiedades.
    let srcMat = m.material;
    if (Array.isArray(srcMat)) srcMat = srcMat[0];
    let material;
    if (srcMat && (srcMat.isMeshStandardMaterial || srcMat.isMeshLambertMaterial || srcMat.isMeshBasicMaterial)) {
      material = srcMat.clone();
      // Asegurar que el material tiene emissive (lo usamos para flash de hit).
      // MeshStandard ya tiene; MeshLambert también; Basic no — fallback a Lambert.
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
      // Sin material en el source — fallback de color sólido
      material = new THREE.MeshLambertMaterial({ color: fallbackColor || 0x808080, side: THREE.DoubleSide });
    }
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
        !!NPC_GLB_FORCE_ZUP_INVERT[typeId],
        !!NPC_GLB_FORCE_NO_ZUP[typeId],
      );
      if (!baked) return;
      NPC_GEOMS[typeId] = { id: typeId, glbParts: baked.parts };
      console.log(`Loaded NPC '${typeId}' — scaleFactor=${baked.scaleFactor.toFixed(4)} target=${NPC_TARGET_HEIGHTS[typeId] || 1.0}m`);
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
  const bgMat = new THREE.MeshBasicMaterial({ color: 0x202020, depthTest: false, transparent: true, opacity: 0.85, side: THREE.DoubleSide });
  const bg = new THREE.Mesh(new THREE.PlaneGeometry(W, H), bgMat);
  bg.renderOrder = 999;
  group.add(bg);
  const ratio = max > 0 ? Math.max(0, Math.min(1, cur / max)) : 0;
  const fillMat = new THREE.MeshBasicMaterial({ color: 0xc02020, depthTest: false, side: THREE.DoubleSide });
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
    // SLICE 5b post-fix: usamos `emissive` (color añadido) en vez de `color`
    // (color base). Tocar `color` machacaba el color base del material y
    // sumado a la textura daba el bug "todos plateados". Con emissive el
    // material conserva su look normal y solo añadimos un tinte rojo.
    if (ud.bodyMaterials && ud.bodyMaterials.length) {
      const r = ud.reaction;
      if (r && r.until > now) {
        const intensity = (r.until - now) / NPC_REACT_DURATION_S; // 1 → 0
        for (const m of ud.bodyMaterials) {
          if (m && m.emissive) {
            m.emissive.setRGB(intensity * 0.8, 0, 0);
          }
        }
      } else if (ud.reaction && ud.reaction.wasFlashing) {
        // Restaurar emissive a negro (sin tinte) al terminar el flash
        for (const m of ud.bodyMaterials) {
          if (m && m.emissive) m.emissive.setRGB(0, 0, 0);
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
  // Slice 5b: trigger del swing del player. combat.js lo llama cada
  // attack tick (hit O miss — OSRS anima ambos).
  window.__playerPlayAttack = () => {
    try { character?.playAttack?.(); } catch (e) { console.warn('[world] playAttack:', e); }
  };
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
  // Para que la HP bar mire siempre a cámara hace falta:
  //  1) Usar el WORLD quaternion de la cámara (no su local), por si la
  //     cámara cuelga de algún rig.
  //  2) Descontar el world quaternion del padre (NPC group, que rota
  //     con el patrol):  localQuat = invParentWorldQuat * cameraWorldQuat
  //  3) Material a DoubleSide (lo hicimos en createHpBar) para que aunque
  //     la cara frontal del plano quede al revés, se siga viendo.
  const tmpParentQ = new THREE.Quaternion();
  const tmpCamQ = new THREE.Quaternion();
  const tmpResultQ = new THREE.Quaternion();
  camera.getWorldQuaternion(tmpCamQ);
  for (const mesh of npcMeshes.values()) {
    const bar = mesh.userData.hpBar;
    if (!bar || !bar.parent) continue;
    bar.parent.getWorldQuaternion(tmpParentQ);
    tmpParentQ.invert();
    tmpResultQ.multiplyQuaternions(tmpParentQ, tmpCamQ);
    bar.quaternion.copy(tmpResultQ);
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
  // BUG FIX: bloquear pan/zoom nativo del browser sobre el minimapa.
  el.style.touchAction = 'none';
  minimapCanvas = el;
  minimapCtx = el.getContext('2d');

  // CAMBIO: tap simple en minimapa → goto, no abre el mapa.
  addL(el, 'pointerup', (ev) => {
    if (ev.button !== undefined && ev.button !== 0) return;
    ev.preventDefault();
    const rect = el.getBoundingClientRect();
    const cx = ev.clientX - rect.left;
    const cy = ev.clientY - rect.top;
    // BUG FIX: usar rect.width/height (CSS) en lugar de el.width/height
    // (resolución interna del canvas). Mezclarlas hacía que el tap mandara
    // al player a la dirección equivocada (o ni se movía).
    const W = rect.width;
    const H = rect.height;
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

  // Slice 5c.5 — Otros players como puntos azules brillantes en minimapa
  for (const peer of mpLastPeerMap.values()) {
    if (!peer.group) continue;
    const dx = peer.group.position.x - px, dz = peer.group.position.z - pz;
    if (dx * dx + dz * dz > NPC_RAD_SQ) continue;
    const sx = cx + dx * scale, sy = cy + dz * scale;
    ctx.beginPath();
    ctx.arc(sx, sy, 3, 0, Math.PI * 2);
    ctx.fillStyle = '#4090ff';
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.85)';
    ctx.lineWidth = 1;
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
// Reglas (cumplir CUALQUIERA hace que sea TAP, en orden):
//   • Si soltaste en < TAP_QUICK_MS Y moviste < TAP_QUICK_DIST_PX → TAP
//     (cubre el caso del dedo que tiembla un poco al pulsar rápido)
//   • Si NUNCA superaste TAP_DRAG_THRESHOLD durante el touch → TAP
//   • En cualquier otro caso → DRAG (rotar cámara)
// Antes el threshold era 8 px y bastaba con cruzarlo una vez para
// matar el tap. En móvil 8 px es ridículamente poco — el dedo es grande
// y al pulsar/levantar siempre se mueve algo.
const TAP_DRAG_THRESHOLD = 30;          // px
const TAP_QUICK_MS = 220;               // ms: tap rápido siempre cuenta
const TAP_QUICK_DIST_PX = 60;           // px: distancia máx para tap rápido
const CAMERA_DRAG_YAW_SENS = 0.005;    // rad/px horizontal
const CAMERA_DRAG_PITCH_SENS = 0.004;  // rad/px vertical
let canvasPointer = null;

// ============================================================
// Long-press menu (Slice 5b — tap contextual estilo OSRS)
// ============================================================
// Tap simple sobre NPC = atacar directo (comportamiento OSRS móvil oficial).
// Tap-largo (>= LONG_PRESS_MS) = abrir menú con acciones (Atacar / Examinar
// / Cancelar). Si el dedo se mueve durante el long-press se cancela
// (es un drag de cámara, no un tap).

const LONG_PRESS_MS = 320;
const NPC_TAP_SCREEN_PX = 56;   // radio de captura por proximidad en pantalla

function onCanvasPointerDown(e) {
  if (e.button !== undefined && e.button !== 0) return;
  // (Antes había `if (e.target !== canvas) return;` que en algunos casos
  // descartaba taps válidos. El listener está en `canvas`, así que si llega
  // aquí ya estamos sobre el canvas; no hace falta filtrar más.)
  canvasPointer = {
    x0: e.clientX, y0: e.clientY,
    lastX: e.clientX, lastY: e.clientY,
    maxDist: 0,                    // distancia MÁXIMA recorrida durante el touch
    startTime: performance.now(),  // ms de inicio (para distinguir tap rápido)
    isDrag: false,
    pointerId: e.pointerId,
    longPressFired: false,
    longPressTimer: null,
  };
  closeActionMenu();
  canvasPointer.longPressTimer = setTimeout(() => {
    if (!canvasPointer || canvasPointer.isDrag) return;
    canvasPointer.longPressFired = true;
    openActionMenuAt(canvasPointer.lastX, canvasPointer.lastY);
  }, LONG_PRESS_MS);
}

function onCanvasPointerMove(e) {
  if (!canvasPointer) return;
  if (canvasPointer.pointerId !== undefined && e.pointerId !== canvasPointer.pointerId) return;
  const totalDist = Math.hypot(e.clientX - canvasPointer.x0, e.clientY - canvasPointer.y0);
  if (totalDist > canvasPointer.maxDist) canvasPointer.maxDist = totalDist;
  if (!canvasPointer.isDrag && totalDist < TAP_DRAG_THRESHOLD) return;
  canvasPointer.isDrag = true;
  if (canvasPointer.longPressTimer) {
    clearTimeout(canvasPointer.longPressTimer);
    canvasPointer.longPressTimer = null;
  }
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
  if (canvasPointer.longPressTimer) {
    clearTimeout(canvasPointer.longPressTimer);
  }
  const wasDrag = canvasPointer.isDrag;
  const longPressFired = canvasPointer.longPressFired;
  const duration = performance.now() - canvasPointer.startTime;
  const maxDist = canvasPointer.maxDist;
  canvasPointer = null;
  if (longPressFired) return;  // el menú ya está abierto
  // TAP detección con dos reglas (cualquiera vale):
  //   A) Fue un tap rápido (corto en tiempo) y no se movió demasiado
  //   B) Nunca superó el threshold de drag durante el touch
  const isQuickTap = duration <= TAP_QUICK_MS && maxDist <= TAP_QUICK_DIST_PX;
  if (isQuickTap || !wasDrag) {
    doCanvasTap(e);
  }
}

function doCanvasTap(e) {
  const rect = canvas.getBoundingClientRect();
  const nx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  const ny = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera({ x: nx, y: ny }, camera);

  // 1) Tap NPC → auto-walk hacia él y engage cuando lleguemos cerca.
  // Probamos primero el raycast clásico (mesh exacto). Si falla, hacemos
  // proximidad por screen-space (el dedo cubre ~40-50px; aceptamos taps
  // dentro de NPC_TAP_SCREEN_PX del centro proyectado del NPC más cercano).
  const npc = findNpcNearTap(e.clientX, e.clientY);
  if (npc) {
    triggerNpcTap(npc.id);
    return;
  }

  // 2) Tap item del suelo → caminar hacia él (auto-pickup al llegar).
  //    Solo si el tap impacta DIRECTAMENTE el hitbox del item (sin
  //    proximidad screen-space). Si lo erras, el tap cae al suelo y
  //    cuando pases cerca del item el auto-pickup lo recoge solo.
  const lootHit = findGroundItemAtTap();
  if (lootHit) {
    triggerGroundItemPickup(lootHit);
    return;
  }

  // 3) Tap árbol → tooltip
  const treeHits = raycaster.intersectObjects(interactableMeshes, false);
  if (treeHits.length > 0) {
    const hit = treeHits[0];
    const treeType = hit.object.userData.treeType;
    if (treeType) {
      showTreeTooltip(treeType, e.clientX, e.clientY);
      return;
    }
  }

  // 4) Tap suelo → goto
  const hits = raycaster.intersectObjects(terrainMeshes);
  if (hits.length > 0) {
    const p = hits[0].point;
    setPlayerTarget(p.x, p.z);
  }
}

/**
 * Busca el NPC más cercano al tap. Estrategia en dos pasos:
 *  1. Raycast clásico contra los meshes de NPC (preciso).
 *  2. Si no hay hit, proyecta cada NPC vivo a screen space y devuelve
 *     el más cercano al tap dentro de NPC_TAP_SCREEN_PX píxeles.
 *
 * Resultado: el "área tappable" de un NPC es su mesh + un disco de
 * tolerancia en pantalla, mucho más perdonable en móvil.
 */
function findNpcNearTap(clientX, clientY) {
  // Paso 1: raycast clásico
  const npcMeshList = [];
  for (const group of npcMeshes.values()) {
    group.traverse(obj => { if (obj.userData?.kind === 'npc-body') npcMeshList.push(obj); });
  }
  if (npcMeshList.length > 0) {
    const npcHits = raycaster.intersectObjects(npcMeshList, false);
    if (npcHits.length > 0) {
      const npcId = npcHits[0].object.userData.npcId;
      const npc = npcDataList.find(n => n.id === npcId);
      if (npc) return npc;
    }
  }

  // Paso 2: proximidad en pantalla. Proyectamos cada NPC vivo y nos
  // quedamos con el más cercano al tap dentro de la tolerancia.
  const rect = canvas.getBoundingClientRect();
  const localX = clientX - rect.left;
  const localY = clientY - rect.top;
  const tmpV = new THREE.Vector3();
  let best = null;
  let bestDist = NPC_TAP_SCREEN_PX;
  for (const [npcId, group] of npcMeshes) {
    // Centro del cuerpo del NPC (encima del suelo). Usamos el centroide
    // del bbox del grupo; suficientemente fiable.
    const npcData = npcDataList.find(n => n.id === npcId);
    if (!npcData) continue;
    const targetH = NPC_TARGET_HEIGHTS[npcData.def_id] || 1.0;
    tmpV.set(group.position.x, group.position.y + targetH * 0.5, group.position.z);
    tmpV.project(camera);
    // Si está detrás de la cámara, descartar.
    if (tmpV.z > 1 || tmpV.z < -1) continue;
    const sx = (tmpV.x * 0.5 + 0.5) * rect.width;
    const sy = (-tmpV.y * 0.5 + 0.5) * rect.height;
    const d = Math.hypot(sx - localX, sy - localY);
    if (d < bestDist) { bestDist = d; best = npcData; }
  }
  return best;
}

/**
 * Lanza el tap "atacar" sobre un NPC: si estás cerca → engage directo,
 * si lejos → auto-walk hasta llegar y enganchar.
 */
function triggerNpcTap(npcId) {
  const npc = npcDataList.find(n => n.id === npcId);
  if (!npc) return;
  // BUG FIX: usar la posición VISUAL del NPC (orbitando) en lugar de
  // npc.x/z (centro de patrol del server). El cliente dibuja al NPC
  // orbitando hasta NPC_PATROL_RADIUS del centro, así que el centro no
  // es donde el jugador ve al NPC. Caminar al centro hace que el player
  // pase de largo o el marker amarillo aparezca lejos del NPC.
  const mesh = npcMeshes.get(npcId);
  const targetX = mesh ? mesh.position.x : npc.x;
  const targetZ = mesh ? mesh.position.z : npc.z;
  const dx = targetX - player.position.x;
  const dz = targetZ - player.position.z;
  const dist = Math.hypot(dx, dz);
  pendingEngageNpcId = npcId;
  if (dist <= NPC_ENGAGE_RANGE) {
    pendingEngageNpcId = null;
    combat.engageNpc(npcId);
  } else {
    setPlayerTarget(targetX, targetZ);
    combat.feedLog?.('info', `Vas hacia ${npc.name}...`);
  }
}

// ============================================================
// Action menu OSRS (long-press) + Hitsplats (Slice 5b v2)
// ============================================================
// Menú contextual al hacer tap-largo sobre un NPC. Si el tap-largo cae
// en suelo o vacío, no abre menú (al tap simple sigue caminando como
// siempre). Si cae sobre NPC, muestra opciones:
//    ⚔ Atacar  ·  🔍 Examinar  ·  ✕ Cancelar
//
// Hitsplats: pequeños sprites DOM (no Three.js) que aparecen sobre el NPC
// al recibir hit. Gota roja con número blanco para daño > 0, cuadrado
// azul con "0" para fallo/miss. Vida 900ms, sube ~30px, fade-out.

let actionMenuEl = null;
let hitsplatLayerEl = null;
let cssInjectedActionMenu = false;

function ensureActionMenuCss() {
  if (cssInjectedActionMenu) return;
  cssInjectedActionMenu = true;
  const style = document.createElement('style');
  style.id = 'osrs-action-menu-css';
  style.textContent = `
    .osrs-action-menu {
      position: fixed;
      z-index: 200;
      min-width: 160px;
      background: rgba(20, 14, 8, 0.97);
      border: 2px solid #c8a043;
      border-radius: 4px;
      box-shadow: 0 6px 20px rgba(0,0,0,0.75);
      padding: 4px;
      font-family: 'IM Fell English', serif;
      user-select: none;
      -webkit-user-select: none;
      animation: osrsMenuFadeIn 0.12s ease-out;
    }
    @keyframes osrsMenuFadeIn {
      from { opacity: 0; transform: translateY(-4px); }
      to   { opacity: 1; transform: translateY(0); }
    }
    .osrs-action-menu-header {
      padding: 4px 10px 6px 10px;
      font-family: 'Cinzel', serif;
      font-weight: 700;
      font-size: 12px;
      color: #e8c560;
      text-shadow: 1px 1px 0 #000;
      border-bottom: 1px solid rgba(200,160,67,0.3);
      margin-bottom: 4px;
    }
    .osrs-action-row {
      padding: 8px 12px;
      font-size: 14px;
      color: #f0e0b0;
      cursor: pointer;
      border-radius: 3px;
      display: flex;
      align-items: center;
      gap: 8px;
      text-shadow: 1px 1px 0 #000;
    }
    .osrs-action-row:active {
      background: rgba(200,160,67,0.25);
      color: #fff;
    }
    .osrs-action-row.danger { color: #ff9090; }
    .osrs-action-row.danger:active { background: rgba(180,40,40,0.35); }

    /* Hitsplats */
    .osrs-hitsplat-layer {
      position: absolute;
      inset: 0;
      pointer-events: none;
      overflow: visible;
      z-index: 50;
    }
    .osrs-hitsplat {
      position: absolute;
      width: 26px;
      height: 26px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-family: 'IM Fell English', serif;
      font-weight: bold;
      font-size: 13px;
      color: #fff;
      text-shadow: 1px 1px 0 #000, -1px 1px 0 #000, 1px -1px 0 #000, -1px -1px 0 #000;
      transform: translate(-50%, -50%);
      animation: osrsHitsplatFly 0.9s ease-out forwards;
    }
    /* Gota de sangre roja para daño */
    .osrs-hitsplat.dmg {
      background: radial-gradient(ellipse at 35% 35%, #c83030, #800000 70%);
      border: 1.5px solid #200000;
      border-radius: 50% 50% 50% 0;
      transform-origin: center;
      transform: translate(-50%, -50%) rotate(-45deg);
    }
    .osrs-hitsplat.dmg span { transform: rotate(45deg); display:block; }
    /* Escudo azul para miss/bloqueo */
    .osrs-hitsplat.miss {
      background: radial-gradient(ellipse at 35% 35%, #4080d0, #1a3870 70%);
      border: 1.5px solid #001030;
      border-radius: 50% 50% 35% 35% / 50% 50% 65% 65%;
    }
    @keyframes osrsHitsplatFly {
      0%   { opacity: 0; transform: translate(-50%, -50%) scale(0.6); }
      15%  { opacity: 1; transform: translate(-50%, -50%) scale(1.1); }
      25%  { transform: translate(-50%, -50%) scale(1.0); }
      100% { opacity: 0; transform: translate(-50%, -130%) scale(0.95); }
    }
    /* Variantes "dmg" tienen que mantener la rotación de la gota: */
    .osrs-hitsplat.dmg {
      animation: osrsHitsplatFlyDrop 0.9s ease-out forwards;
    }
    @keyframes osrsHitsplatFlyDrop {
      0%   { opacity: 0; transform: translate(-50%, -50%) rotate(-45deg) scale(0.6); }
      15%  { opacity: 1; transform: translate(-50%, -50%) rotate(-45deg) scale(1.1); }
      25%  { transform: translate(-50%, -50%) rotate(-45deg) scale(1.0); }
      100% { opacity: 0; transform: translate(-50%, -130%) rotate(-45deg) scale(0.95); }
    }
  `;
  document.head.appendChild(style);
}

function ensureHitsplatLayer() {
  if (hitsplatLayerEl) return hitsplatLayerEl;
  const parent = document.getElementById('worldScreen') || document.body;
  hitsplatLayerEl = document.createElement('div');
  hitsplatLayerEl.className = 'osrs-hitsplat-layer';
  parent.appendChild(hitsplatLayerEl);
  return hitsplatLayerEl;
}

function closeActionMenu() {
  if (!actionMenuEl) return;
  actionMenuEl.remove();
  actionMenuEl = null;
}

/**
 * Abre el menú contextual en la posición (cx, cy). Detecta qué hay
 * debajo del tap (NPC, suelo) y muestra acciones apropiadas. Si no
 * hay nada interesante (suelo + nada), no abre nada.
 */
function openActionMenuAt(cx, cy) {
  closeActionMenu();
  ensureActionMenuCss();

  // ¿Hay un NPC bajo / cerca del tap?
  const rect = canvas.getBoundingClientRect();
  const nx = ((cx - rect.left) / rect.width) * 2 - 1;
  const ny = -((cy - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera({ x: nx, y: ny }, camera);
  const npc = findNpcNearTap(cx, cy);

  if (!npc) {
    // Tap-largo en suelo: no abrimos menú. (Podríamos meter "Caminar aquí"
    // / "Examinar suelo" pero suma ruido sin valor en alpha.)
    return;
  }

  // Construye el menú
  const menu = document.createElement('div');
  menu.className = 'osrs-action-menu';
  menu.innerHTML = `
    <div class="osrs-action-menu-header">${escapeHtmlSafe(npc.name)}</div>
    <div class="osrs-action-row" data-act="attack">⚔ Atacar</div>
    <div class="osrs-action-row" data-act="examine">🔍 Examinar</div>
    <div class="osrs-action-row danger" data-act="cancel">✕ Cancelar</div>
  `;

  // Posicionado clamp-to-viewport
  document.body.appendChild(menu);
  const mw = menu.offsetWidth;
  const mh = menu.offsetHeight;
  let left = cx + 8;
  let top = cy + 8;
  if (left + mw > window.innerWidth - 4) left = window.innerWidth - mw - 4;
  if (top + mh > window.innerHeight - 4) top = cy - mh - 8;
  if (top < 4) top = 4;
  menu.style.left = left + 'px';
  menu.style.top  = top + 'px';
  actionMenuEl = menu;

  menu.querySelectorAll('[data-act]').forEach(row => {
    row.addEventListener('pointerup', ev => {
      ev.preventDefault();
      ev.stopPropagation();
      const act = row.getAttribute('data-act');
      closeActionMenu();
      if (act === 'attack')        triggerNpcTap(npc.id);
      else if (act === 'examine')  examineNpc(npc);
      // 'cancel' no hace nada — solo cierra.
    });
  });

  // Auto-close en 5s si el user no toca nada
  setTimeout(() => { if (actionMenuEl === menu) closeActionMenu(); }, 5000);
}

function examineNpc(npc) {
  // Por ahora un mensaje al feed con stats del NPC. Más adelante
  // se puede meter un modal bonito.
  const msg = `${npc.name} — nivel ${npc.attack_lvl}, ${npc.max_hp} HP.`;
  combat.feedLog?.('info', msg);
}

function escapeHtmlSafe(s) {
  if (s == null) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Pinta un hitsplat OSRS sobre la cabeza del NPC.
 *   damage > 0 → gota roja con el número
 *   damage === 0 → escudo azul con "0"
 * Lo llama combat.js (via window.__worldSpawnHitsplat).
 */
function spawnHitsplatOnNpc(npcId, damage) {
  const group = npcMeshes.get(npcId);
  if (!group) return;
  ensureActionMenuCss();
  const layer = ensureHitsplatLayer();

  // Proyectar la cabeza del NPC a screen-space
  const npc = npcDataList.find(n => n.id === npcId);
  const targetH = npc ? (NPC_TARGET_HEIGHTS[npc.def_id] || 1.0) : 1.0;
  const v = new THREE.Vector3(group.position.x, group.position.y + targetH * 0.85, group.position.z);
  v.project(camera);
  if (v.z > 1 || v.z < -1) return;  // detrás de cámara
  const rect = canvas.getBoundingClientRect();
  const sx = (v.x * 0.5 + 0.5) * rect.width;
  const sy = (-v.y * 0.5 + 0.5) * rect.height;

  // Jitter horizontal pequeño para que splats apilados no se solapen
  const jitter = (Math.random() - 0.5) * 22;

  const splat = document.createElement('div');
  if (damage > 0) {
    splat.className = 'osrs-hitsplat dmg';
    splat.innerHTML = `<span>${damage}</span>`;
  } else {
    splat.className = 'osrs-hitsplat miss';
    splat.textContent = '0';
  }
  splat.style.left = (sx + jitter) + 'px';
  splat.style.top  = sy + 'px';
  layer.appendChild(splat);
  setTimeout(() => splat.remove(), 950);
}

if (typeof window !== 'undefined') {
  window.__worldSpawnHitsplat = spawnHitsplatOnNpc;
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
  // BUG FIX: bloquear pan/zoom nativo del browser sobre el joystick.
  // Sin esto, mover el dedo en el joystick podía disparar pinch-zoom
  // junto con otro dedo en pantalla.
  joyEl.style.touchAction = 'none';
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

  // BUG FIX: bloquear el pinch-zoom NATIVO del navegador cuando hay 2+
  // dedos en cualquier parte del documento. Antes, si usabas el joystick
  // con un dedo y un segundo dedo en el canvas para rotar la cámara, el
  // browser hacía zoom de la página HTML porque setupTouchCamera solo
  // llamaba preventDefault si ambos dedos estaban fuera del joystick.
  addL(document, 'touchmove', (e) => {
    if (e.touches.length >= 2) e.preventDefault();
  }, { passive: false });
  // Bloquear también gesturestart de iOS (otro vector de pinch-zoom)
  addL(document, 'gesturestart', (e) => { e.preventDefault(); });

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
    // Y del player: -1.03 tras recalibración (era -1.10, el personaje
    // quedaba un pelín hundido). El override window.__sebasOffsetY sigue
    // disponible para futuras pruebas.
    if (player && !characterFallback) {
      player.position.y = (typeof window !== 'undefined' && typeof window.__sebasOffsetY === 'number')
        ? window.__sebasOffsetY
        : -1.03;
    }
  }
  updateNameTag();
  updateRegionTracking();
  updateNpcPatrol(dt);
  updateNpcHpBars();
  updateNpcPolling(dt);
  updateMultiplayer(dt);
  updateGroundItems(dt);
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

// ============================================================
// Slice 5c.5 — Multiplayer básico
// ============================================================
// updateMultiplayer (llamado cada frame) hace tres cosas:
//   1) Cada 500ms manda heartbeat al server con tu posición/yaw/estado
//   2) Cada 500ms pide peers cercanos al server
//   3) Cada frame interpola la posición de cada peer entre snapshots
//      (los peers reciben actualizaciones cada 500ms, pero queremos verlos
//      moviéndose suave sin teleports)

function updateMultiplayer(dt) {
  if (!authToken || !player) return;

  // 1) Heartbeat periódico
  mpHeartbeatTimer += dt * 1000;
  if (mpHeartbeatTimer >= MP_HEARTBEAT_INTERVAL && !mpInFlightHeartbeat) {
    mpHeartbeatTimer = 0;
    sendMpHeartbeat();
  }

  // 2) Poll periódico de peers
  mpPeersPollTimer += dt * 1000;
  if (mpPeersPollTimer >= MP_PEERS_POLL_INTERVAL && !mpInFlightPeers) {
    mpPeersPollTimer = 0;
    pollMpPeers();
  }

  // 3) Interpolar visual de peers cada frame + actualizar sus mixers
  const now = performance.now();
  for (const [userId, peer] of mpLastPeerMap) {
    if (!peer.group) continue;
    // Quitar peers que llevan rato sin update
    if (Date.now() - peer.lastUpdate > MP_PEER_TIMEOUT_MS) {
      removeMpPeer(userId);
      continue;
    }
    // Interpolación lineal entre fromXYZ y toXYZ
    const t = Math.min(1, (now - peer.interpStart) / MP_PEER_INTERP_MS);
    peer.group.position.x = peer.fromX + (peer.toX - peer.fromX) * t;
    peer.group.position.z = peer.fromZ + (peer.toZ - peer.fromZ) * t;
    // Yaw con shortest-path para no girar 350º cuando podía girar 10º
    let dyaw = peer.toYaw - peer.fromYaw;
    while (dyaw > Math.PI) dyaw -= Math.PI * 2;
    while (dyaw < -Math.PI) dyaw += Math.PI * 2;
    peer.group.rotation.y = peer.fromYaw + dyaw * t;

    // Mixer del peer (si está usando Nico clonado, hace falta tick por frame)
    if (peer.mixer) {
      peer.mixer.update(dt);
    }

    // Crossfade idle ↔ run según state
    if (peer.actions && Object.keys(peer.actions).length > 0) {
      // Determinar acción deseada según state recibido
      let desiredName = 'idle';
      if (peer.state === 'run' || peer.state === 'walk') desiredName = 'run';
      else if (peer.state === 'attack' && peer.actions.attack) desiredName = 'attack';
      const desiredAction = peer.actions[desiredName] || peer.actions.idle;
      if (desiredAction && desiredAction !== peer.currentAction) {
        desiredAction.reset();
        desiredAction.play();
        if (peer.currentAction) {
          desiredAction.crossFadeFrom(peer.currentAction, 0.22, true);
        }
        peer.currentAction = desiredAction;
      }
    }

    // Updatear nameTag posición sobre la cabeza
    if (peer.nameTagDiv) {
      updateMpPeerNameTag(peer);
    }
  }
}

async function sendMpHeartbeat() {
  mpInFlightHeartbeat = true;
  try {
    // Determinar estado de movimiento actual
    const speed = computePlayerSpeed();
    let state = 'idle';
    if (speed > 0.1) state = speed > 4 ? 'run' : 'run'; // todo run por ahora (no tenemos walk anim)
    mpPlayerState = state;

    await fetch(`${API_BASE}/api/world/heartbeat`, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + authToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        x: player.position.x,
        z: player.position.z,
        yaw: player.rotation.y,
        state,
      }),
    });
  } catch (err) {
    // Silencioso — no quereremos spammear si la red se cae 1s
  } finally {
    mpInFlightHeartbeat = false;
  }
}

let _mpLastPlayerX = 0, _mpLastPlayerZ = 0, _mpLastSpeedTime = 0;
function computePlayerSpeed() {
  const now = performance.now();
  if (!_mpLastSpeedTime) {
    _mpLastSpeedTime = now;
    _mpLastPlayerX = player.position.x;
    _mpLastPlayerZ = player.position.z;
    return 0;
  }
  const dt = (now - _mpLastSpeedTime) / 1000;
  if (dt < 0.05) return 0;
  const dx = player.position.x - _mpLastPlayerX;
  const dz = player.position.z - _mpLastPlayerZ;
  const dist = Math.hypot(dx, dz);
  const speed = dist / dt;
  _mpLastSpeedTime = now;
  _mpLastPlayerX = player.position.x;
  _mpLastPlayerZ = player.position.z;
  return speed;
}

async function pollMpPeers() {
  mpInFlightPeers = true;
  try {
    const r = await fetch(
      `${API_BASE}/api/world/peers?x=${player.position.x.toFixed(2)}&z=${player.position.z.toFixed(2)}`,
      { headers: { 'Authorization': 'Bearer ' + authToken } }
    );
    if (!r.ok) return;
    const data = await r.json();
    const peers = data?.peers || [];
    const seenIds = new Set();
    for (const p of peers) {
      seenIds.add(p.user_id);
      upsertMpPeer(p);
    }
    // Eliminar peers que ya no aparecen en la respuesta (salieron del radio)
    for (const userId of mpLastPeerMap.keys()) {
      if (!seenIds.has(userId)) {
        // Le damos margen: si lleva más de 2s sin aparecer en la lista, quitar
        const peer = mpLastPeerMap.get(userId);
        if (Date.now() - peer.lastUpdate > 2000) {
          removeMpPeer(userId);
        }
      }
    }
  } catch (err) {
    // Silencioso
  } finally {
    mpInFlightPeers = false;
  }
}

function upsertMpPeer(p) {
  let peer = mpLastPeerMap.get(p.user_id);
  if (!peer) {
    peer = createMpPeer(p);
    mpLastPeerMap.set(p.user_id, peer);
  }
  // Iniciar interpolación nueva: from = posición visual actual, to = nueva
  peer.fromX = peer.group.position.x;
  peer.fromZ = peer.group.position.z;
  peer.fromYaw = peer.group.rotation.y;
  peer.toX = p.x;
  peer.toZ = p.z;
  peer.toYaw = p.yaw || 0;
  peer.state = p.state || 'idle';
  peer.interpStart = performance.now();
  peer.lastUpdate = Date.now();
}

function createMpPeer(p) {
  // Slice 5c.5 — Nico clonado: si el character principal está cargado,
  // clonamos su skeleton/mesh con SkeletonUtils para que cada peer se vea
  // como Nico con su propio mixer (independiente del player principal).
  // Si character no está listo aún, fallback a cápsula.

  const group = new THREE.Group();
  group.position.set(p.x, 0, p.z);
  group.rotation.y = p.yaw || 0;

  let peerMixer = null;
  let peerActions = {};
  let usedNico = false;

  if (character?.loaded && character.mesh && character.clips) {
    try {
      // SkeletonUtils.clone preserva el esqueleto correctamente — un simple
      // .clone() del mesh comparte el skeleton entre instancias y se queda quieto.
      const clonedMesh = SkeletonUtils.clone(character.mesh);
      // Aplicamos la misma escala que tu personaje principal (0.01).
      // El SkeletonUtils clona la jerarquía pero NO copia las transforms del
      // root parent, así que lo escalamos aquí.
      clonedMesh.scale.copy(character.mesh.scale);
      // Mismo Y offset que el player principal (-1.03) — sin esto los peers
      // flotan en el aire porque el FBX tiene los pies sobre el origen.
      clonedMesh.position.y = -1.03;

      // Para distinguir peers entre sí, tintamos la ropa con un color por hash.
      // Recorremos todas las meshes y multiplicamos su color base.
      const hue = (hashStr(p.username || ('user' + p.user_id))) % 360;
      const tint = new THREE.Color().setHSL(hue / 360, 0.45, 0.55);
      clonedMesh.traverse(obj => {
        if (obj.isMesh && obj.material) {
          // Clonar el material para no afectar al player principal
          if (Array.isArray(obj.material)) {
            obj.material = obj.material.map(m => {
              const cloned = m.clone();
              if (cloned.color) cloned.color.multiply(tint);
              return cloned;
            });
          } else {
            obj.material = obj.material.clone();
            if (obj.material.color) obj.material.color.multiply(tint);
          }
          obj.frustumCulled = false;
        }
      });

      group.add(clonedMesh);

      // Mixer + actions independientes para este peer
      peerMixer = new THREE.AnimationMixer(clonedMesh);
      for (const name of Object.keys(character.clips)) {
        const clip = character.clips[name];
        if (!clip) continue;
        const action = peerMixer.clipAction(clip);
        action.setEffectiveTimeScale(1);
        action.setEffectiveWeight(1);
        peerActions[name] = action;
      }
      // Empezar en idle
      if (peerActions.idle) {
        peerActions.idle.play();
      }
      usedNico = true;
    } catch (err) {
      console.warn('[mp] Failed to clone Nico for peer, fallback to capsule:', err.message);
    }
  }

  // Fallback cápsula si no hay Nico disponible o si el clone falló
  if (!usedNico) {
    const hue = (hashStr(p.username || ('user' + p.user_id))) % 360;
    const color = new THREE.Color().setHSL(hue / 360, 0.55, 0.50);
    const bodyGeom = new THREE.CapsuleGeometry(0.35, 0.9, 4, 12);
    const bodyMat = new THREE.MeshLambertMaterial({ color, flatShading: true });
    const body = new THREE.Mesh(bodyGeom, bodyMat);
    body.position.y = 0.85;
    group.add(body);
    const headGeom = new THREE.SphereGeometry(0.22, 16, 12);
    const headMat = new THREE.MeshLambertMaterial({ color: 0xffd5b0, flatShading: true });
    const head = new THREE.Mesh(headGeom, headMat);
    head.position.y = 1.55;
    group.add(head);
  }

  scene.add(group);

  // Etiqueta DOM con username flotante sobre la cabeza
  const nameTagDiv = document.createElement('div');
  nameTagDiv.className = 'osrs-peer-nametag';
  nameTagDiv.textContent = p.username || ('user' + p.user_id);
  Object.assign(nameTagDiv.style, {
    position: 'fixed',
    pointerEvents: 'none',
    background: 'rgba(20, 14, 8, 0.85)',
    border: '1.5px solid #c8a043',
    borderRadius: '3px',
    padding: '2px 8px',
    color: '#f0e0b0',
    fontFamily: "'Cinzel', serif",
    fontWeight: '600',
    fontSize: '12px',
    textShadow: '1px 1px 0 #000',
    transform: 'translate(-50%, -50%)',
    zIndex: '40',
    display: 'none',
  });
  document.body.appendChild(nameTagDiv);

  return {
    group, nameTagDiv,
    mixer: peerMixer,
    actions: peerActions,
    currentAction: peerActions.idle || null,
    usedNico,
    fromX: p.x, fromZ: p.z, fromYaw: p.yaw || 0,
    toX: p.x,   toZ: p.z,   toYaw: p.yaw || 0,
    state: p.state || 'idle',
    interpStart: performance.now(),
    lastUpdate: Date.now(),
    username: p.username,
  };
}

function removeMpPeer(userId) {
  const peer = mpLastPeerMap.get(userId);
  if (!peer) return;
  if (peer.mixer) {
    peer.mixer.stopAllAction();
  }
  if (peer.group) {
    scene.remove(peer.group);
    peer.group.traverse(o => {
      if (o.geometry) o.geometry.dispose?.();
      if (o.material) {
        if (Array.isArray(o.material)) o.material.forEach(m => m.dispose?.());
        else o.material.dispose?.();
      }
    });
  }
  if (peer.nameTagDiv) peer.nameTagDiv.remove();
  mpLastPeerMap.delete(userId);
}

function updateMpPeerNameTag(peer) {
  const v = new THREE.Vector3(peer.group.position.x, peer.group.position.y + 2.0, peer.group.position.z);
  v.project(camera);
  if (v.z > 1 || v.z < -1) {
    peer.nameTagDiv.style.display = 'none';
    return;
  }
  const rect = canvas.getBoundingClientRect();
  const sx = (v.x * 0.5 + 0.5) * rect.width + rect.left;
  const sy = (-v.y * 0.5 + 0.5) * rect.height + rect.top;
  peer.nameTagDiv.style.left = sx + 'px';
  peer.nameTagDiv.style.top = sy + 'px';
  peer.nameTagDiv.style.display = 'block';
}

function hashStr(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h) + s.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
}

// Hook global de debug — el usuario pidió poder ver peers desde Eruda
if (typeof window !== 'undefined') {
  window.__mpPlayers = () => {
    const list = [];
    for (const [uid, p] of mpLastPeerMap) {
      list.push({
        user_id: uid,
        username: p.username,
        x: p.group.position.x.toFixed(1),
        z: p.group.position.z.toFixed(1),
        state: p.state,
        lastUpdate_ms_ago: Date.now() - p.lastUpdate,
      });
    }
    console.table(list);
    return list;
  };
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
      // Misma corrección que triggerNpcTap: usar pos visual del mesh.
      const mesh = npcMeshes.get(pendingEngageNpcId);
      const tx = mesh ? mesh.position.x : npc.x;
      const tz = mesh ? mesh.position.z : npc.z;
      const dx = tx - player.position.x;
      const dz = tz - player.position.z;
      const dist = Math.hypot(dx, dz);
      if (dist <= NPC_ENGAGE_RANGE) {
        const id = pendingEngageNpcId;
        pendingEngageNpcId = null;
        playerTarget = null;
        marker.visible = false;
        combat.engageNpc(id);
      } else if (playerTarget) {
        // Persigue al NPC visual: actualiza el target a su pos orbitando
        playerTarget.x = tx;
        playerTarget.z = tz;
        marker.position.set(tx, 0.05, tz);
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

// ============================================================
// Home Teleport (Slice 5c) — botón flotante con cast 10s
// ============================================================
// Botón discreto en esquina superior izquierda (debajo del Salir).
// Click → cast de 10s con barra de progreso + sound visual.
// Cancela si: te mueves (joystick activo o tap) o recibes daño.
// Tras 10s sin interrupción → POST /api/magic/home_teleport/finish y TP.
// Cooldown 15 min con tooltip "Disponible en X:XX".

const HOME_TELE_CAST_MS_CLIENT = 10_000;
const HOME_TELE_COOLDOWN_MS_CLIENT = 15 * 60 * 1000;

let homeTeleBtnEl = null;
let homeTeleBarEl = null;
let homeTeleCdLabelEl = null;
let homeTeleCastingUntil = 0;
let homeTeleCooldownUntil = 0;
let homeTelePlayerStartPos = null;   // posición al iniciar cast
let homeTelePlayerStartHp = null;    // HP al iniciar cast
let homeTeleRafHandle = null;

function setupHomeTeleportButton() {
  if (homeTeleBtnEl) return;
  ensureHomeTeleCss();
  const btn = document.createElement('div');
  btn.className = 'osrs-home-tele-btn';
  btn.innerHTML = `
    <div class="osrs-home-tele-icon">🏠</div>
    <div class="osrs-home-tele-label">Casa</div>
    <div class="osrs-home-tele-progress"><div class="osrs-home-tele-bar"></div></div>
    <div class="osrs-home-tele-cd"></div>
  `;
  document.body.appendChild(btn);
  homeTeleBtnEl = btn;
  homeTeleBarEl = btn.querySelector('.osrs-home-tele-bar');
  homeTeleCdLabelEl = btn.querySelector('.osrs-home-tele-cd');

  btn.addEventListener('click', onHomeTeleClick);
  // Tick visual cada 100ms para actualizar barra y cooldown label
  setInterval(updateHomeTeleVisuals, 100);
}

function ensureHomeTeleCss() {
  if (document.getElementById('osrs-home-tele-css')) return;
  const style = document.createElement('style');
  style.id = 'osrs-home-tele-css';
  style.textContent = `
    .osrs-home-tele-btn {
      position: fixed;
      top: 84px;
      left: 16px;
      z-index: 80;
      width: 64px;
      min-height: 78px;
      padding: 6px 4px;
      background: rgba(20, 14, 8, 0.92);
      border: 2px solid #c8a043;
      border-radius: 6px;
      box-shadow: 0 4px 10px rgba(0,0,0,0.5);
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      user-select: none;
      -webkit-user-select: none;
      font-family: 'Cinzel', serif;
    }
    .osrs-home-tele-btn:active {
      background: rgba(40, 28, 16, 0.95);
    }
    .osrs-home-tele-btn.casting {
      border-color: #88ddff;
    }
    .osrs-home-tele-btn.cooldown {
      opacity: 0.55;
      pointer-events: none;
      border-color: #666;
    }
    .osrs-home-tele-icon {
      font-size: 24px;
      line-height: 1;
      margin-bottom: 2px;
    }
    .osrs-home-tele-label {
      font-size: 10px;
      color: #f0e0b0;
      font-weight: 700;
      text-shadow: 1px 1px 0 #000;
      letter-spacing: 0.4px;
    }
    .osrs-home-tele-progress {
      width: 100%;
      height: 4px;
      margin-top: 4px;
      background: rgba(0,0,0,0.6);
      border-radius: 2px;
      overflow: hidden;
      display: none;
    }
    .osrs-home-tele-btn.casting .osrs-home-tele-progress {
      display: block;
    }
    .osrs-home-tele-bar {
      width: 0%;
      height: 100%;
      background: linear-gradient(90deg, #88ddff, #c8a043);
      transition: width 0.1s linear;
    }
    .osrs-home-tele-cd {
      font-size: 9px;
      color: #ff9090;
      margin-top: 2px;
      font-family: 'IM Fell English', serif;
      display: none;
    }
    .osrs-home-tele-btn.cooldown .osrs-home-tele-cd {
      display: block;
    }
  `;
  document.head.appendChild(style);
}

async function onHomeTeleClick() {
  if (homeTeleCastingUntil > Date.now()) return;   // ya casteando
  if (homeTeleCooldownUntil > Date.now()) return;  // en cooldown
  if (!authToken) return;

  try {
    const r = await fetch(`${API_BASE}/api/magic/home_teleport`, {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + authToken },
    });
    const data = await r.json();
    if (!r.ok || data.error) {
      if (data.error === 'on_cooldown' && data.cooldown_remaining_ms) {
        homeTeleCooldownUntil = Date.now() + data.cooldown_remaining_ms;
        if (combat?.feedLog) combat.feedLog('warn', data.message || 'En cooldown');
      } else {
        if (combat?.feedLog) combat.feedLog('warn', 'No puedes teletransportarte ahora');
      }
      return;
    }
    // Cast iniciado
    homeTeleCastingUntil = Date.now() + HOME_TELE_CAST_MS_CLIENT;
    homeTelePlayerStartPos = { x: player.position.x, z: player.position.z };
    // Si tenemos info de HP en combat state, la guardamos para detectar daño
    const cs = combat?.getStateSnapshot?.();
    homeTelePlayerStartHp = cs?.hp ?? null;
    homeTeleBtnEl?.classList.add('casting');
    if (combat?.feedLog) combat.feedLog('info', 'Concentrándote para teletransportarte... (10s)');
  } catch (err) {
    console.warn('home tele start failed:', err);
  }
}

function cancelHomeTele(reason) {
  if (homeTeleCastingUntil <= Date.now()) return;
  homeTeleCastingUntil = 0;
  homeTeleBtnEl?.classList.remove('casting');
  fetch(`${API_BASE}/api/magic/home_teleport/cancel`, {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + authToken },
  }).catch(() => {});
  if (combat?.feedLog) {
    combat.feedLog('warn', `Teletransporte cancelado (${reason}).`);
  }
}

async function finishHomeTele() {
  if (!authToken) return;
  try {
    const r = await fetch(`${API_BASE}/api/magic/home_teleport/finish`, {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + authToken },
    });
    const data = await r.json();
    if (!r.ok || data.error) {
      if (combat?.feedLog) combat.feedLog('warn', 'No se pudo completar el teletransporte');
      homeTeleBtnEl?.classList.remove('casting');
      homeTeleCastingUntil = 0;
      return;
    }
    // Teletransportar visualmente
    player.position.x = data.spawn.x;
    player.position.z = data.spawn.z;
    if (typeof window !== 'undefined') {
      window.scrollTo(0, 0);
    }
    homeTeleCastingUntil = 0;
    homeTeleCooldownUntil = data.cooldown_until || (Date.now() + HOME_TELE_COOLDOWN_MS_CLIENT);
    homeTeleBtnEl?.classList.remove('casting');
    homeTeleBtnEl?.classList.add('cooldown');
    if (combat?.feedLog) combat.feedLog('hit', '¡Estás en casa!');
    // Resetear chunks alrededor del nuevo spawn
    if (typeof primeInitialChunks === 'function') {
      try { primeInitialChunks(); } catch {}
    }
  } catch (err) {
    console.warn('home tele finish failed:', err);
    homeTeleBtnEl?.classList.remove('casting');
    homeTeleCastingUntil = 0;
  }
}

function updateHomeTeleVisuals() {
  if (!homeTeleBtnEl) return;
  const now = Date.now();

  // Casteando
  if (homeTeleCastingUntil > 0) {
    const remaining = homeTeleCastingUntil - now;
    if (remaining <= 0) {
      // Cast completado
      finishHomeTele();
    } else {
      // Actualizar barra
      const elapsed = HOME_TELE_CAST_MS_CLIENT - remaining;
      const pct = Math.max(0, Math.min(100, (elapsed / HOME_TELE_CAST_MS_CLIENT) * 100));
      if (homeTeleBarEl) homeTeleBarEl.style.width = pct + '%';
      // Verificar cancelaciones: movimiento
      if (homeTelePlayerStartPos && player) {
        const dx = player.position.x - homeTelePlayerStartPos.x;
        const dz = player.position.z - homeTelePlayerStartPos.z;
        if (dx * dx + dz * dz > 0.25) {   // movido más de 0.5m
          cancelHomeTele('te has movido');
        }
      }
      // Verificar cancelaciones: daño recibido
      if (homeTelePlayerStartHp !== null) {
        const cs = combat?.getStateSnapshot?.();
        if (cs && cs.hp !== null && cs.hp < homeTelePlayerStartHp) {
          cancelHomeTele('recibiste daño');
        }
      }
    }
  }

  // Cooldown
  if (homeTeleCooldownUntil > now) {
    homeTeleBtnEl.classList.add('cooldown');
    const remaining = Math.ceil((homeTeleCooldownUntil - now) / 1000);
    const m = Math.floor(remaining / 60);
    const s = remaining % 60;
    if (homeTeleCdLabelEl) {
      homeTeleCdLabelEl.textContent = `${m}:${String(s).padStart(2, '0')}`;
    }
  } else if (homeTeleCooldownUntil > 0) {
    homeTeleCooldownUntil = 0;
    homeTeleBtnEl.classList.remove('cooldown');
    if (homeTeleCdLabelEl) homeTeleCdLabelEl.textContent = '';
  }
}

// ============================================================
// Slice 5c — Ground items (loot drops)
// ============================================================
// El server inserta items en la tabla ground_items cuando un NPC muere.
// El cliente:
//   1) Cada GROUND_ITEMS_POLL_INTERVAL ms pregunta /api/ground_items?x=&z=
//      al server y recibe los items en radio 30m alrededor del player.
//   2) Renderiza cada item como un sprite pequeño en el suelo. Items que
//      ya no aparecen en la respuesta se quitan de la escena.
//   3) Al tap sobre un item: si estás cerca → llama a /api/ground_items/pickup
//      directamente. Si lejos → auto-walk al item, y al llegar haces pickup.
// Los items se autodestruyen en server a los 120s (cron). El cliente no
// gestiona expiraciones — confía en que dejen de venir en el poll.

const GROUND_ITEMS_POLL_INTERVAL = 1000;   // ms entre polls al server
const GROUND_ITEM_AUTO_RADIUS_M  = 2.2;    // si estás dentro de esto, pickup auto
const GROUND_ITEM_PICKUP_RADIUS_M = 2.5;   // tolerancia para decidir "estoy cerca"
const GROUND_ITEM_PICKUP_COOLDOWN_MS = 800; // entre intentos del mismo item

// Mapa id → { id, item_id, qty, x, z, name, group(THREE.Group), lastSeen, lastAttempt }
const groundItemsMap = new Map();
let groundItemsPollTimer = 0;
let groundItemsInFlight = false;
let pendingPickupItemId = null;   // si lejos: auto-walk + pickup al llegar

function updateGroundItems(dt) {
  if (!authToken || !player) return;
  try {
    _updateGroundItemsImpl(dt);
  } catch (err) {
    // Defensivo: que un error suelto en el loot no congele el frame loop.
    console.error('[ground_items/update]', err);
  }
}

function _updateGroundItemsImpl(dt) {
  // 1) Poll periódico
  groundItemsPollTimer += dt * 1000;
  if (groundItemsPollTimer >= GROUND_ITEMS_POLL_INTERVAL && !groundItemsInFlight) {
    groundItemsPollTimer = 0;
    pollGroundItems();
  }

  // 2) Auto-pickup: cualquier item dentro del radio se intenta recoger
  //    automáticamente (cooldown por item para no spammear el server).
  const now = Date.now();
  for (const item of groundItemsMap.values()) {
    const dx = item.x - player.position.x;
    const dz = item.z - player.position.z;
    const d2 = dx * dx + dz * dz;
    if (d2 <= GROUND_ITEM_AUTO_RADIUS_M * GROUND_ITEM_AUTO_RADIUS_M) {
      if (!item.lastAttempt || now - item.lastAttempt > GROUND_ITEM_PICKUP_COOLDOWN_MS) {
        item.lastAttempt = now;
        pickupGroundItem(item.id);
      }
    }
  }

  // 3) Pickup pendiente por tap (item lejos): si ya estamos cerca, dispararlo.
  //    Es redundante con el auto-pickup de arriba, pero limpia el flag.
  if (pendingPickupItemId !== null) {
    const item = groundItemsMap.get(pendingPickupItemId);
    if (!item) {
      pendingPickupItemId = null;
    } else {
      const dx = item.x - player.position.x;
      const dz = item.z - player.position.z;
      const d = Math.hypot(dx, dz);
      if (d <= GROUND_ITEM_PICKUP_RADIUS_M) {
        pendingPickupItemId = null;
      }
    }
  }

  // 4) Animación leve de bobbing (los items "flotan" un poco para verse)
  const t = performance.now() * 0.002;
  for (const item of groundItemsMap.values()) {
    if (item.group) {
      item.group.position.y = 0.15 + Math.sin(t + item.id * 0.7) * 0.05;
      item.group.rotation.y += dt * 1.2;
    }
  }
}

async function pollGroundItems() {
  groundItemsInFlight = true;
  try {
    const r = await fetch(
      `${API_BASE}/api/ground_items?x=${player.position.x.toFixed(2)}&z=${player.position.z.toFixed(2)}`,
      { headers: { 'Authorization': 'Bearer ' + authToken } }
    );
    if (!r.ok) return;
    const data = await r.json();
    const items = data?.items || [];
    const seenIds = new Set();
    for (const it of items) {
      seenIds.add(it.id);
      upsertGroundItem(it);
    }
    // Quitar items que el server ya no devuelve (expiraron, recogidos por
    // otro, salieron del radio…)
    for (const id of Array.from(groundItemsMap.keys())) {
      if (!seenIds.has(id)) removeGroundItem(id);
    }
  } catch (err) {
    // Silencioso — reintenta al siguiente tick
  } finally {
    groundItemsInFlight = false;
  }
}

function upsertGroundItem(it) {
  let item = groundItemsMap.get(it.id);
  if (item) {
    // Actualizar metadatos por si cambian (qty no debería, pero por si acaso)
    item.qty = it.qty;
    item.lastSeen = Date.now();
    return;
  }
  // Crear nuevo mesh visual
  const group = new THREE.Group();
  group.position.set(it.x, 0.15, it.z);

  // Caja pequeña con color según tipo. Es un placeholder visual decente
  // hasta que tengamos sprites/iconos reales.
  const color = colorForItemId(it.item_id);
  const mat = new THREE.MeshStandardMaterial({
    color,
    emissive: color,
    emissiveIntensity: 0.25,
    roughness: 0.6,
    metalness: 0.2,
  });
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.3), mat);
  mesh.castShadow = false;
  mesh.userData.kind = 'ground-item';
  mesh.userData.itemDropId = it.id;
  group.add(mesh);

  // Hitbox invisible más grande para que tapearlo en móvil sea fácil.
  // No tiene material visible pero el raycaster sí lo detecta.
  const hitMat = new THREE.MeshBasicMaterial({ visible: false, depthWrite: false });
  const hitMesh = new THREE.Mesh(new THREE.BoxGeometry(1.0, 1.0, 1.0), hitMat);
  hitMesh.position.y = 0.2;
  hitMesh.userData.kind = 'ground-item-hitbox';
  hitMesh.userData.itemDropId = it.id;
  group.add(hitMesh);

  // Etiqueta con el nombre (canvas sprite)
  const label = makeGroundItemLabel(it.name || it.item_id, it.qty);
  if (label) {
    label.position.set(0, 0.6, 0);
    group.add(label);
  }

  scene.add(group);

  item = {
    id: it.id,
    item_id: it.item_id,
    qty: it.qty,
    x: it.x,
    z: it.z,
    name: it.name || it.item_id,
    group,
    mesh,
    hitMesh,
    lastSeen: Date.now(),
  };
  groundItemsMap.set(it.id, item);
}

function removeGroundItem(id) {
  const item = groundItemsMap.get(id);
  if (!item) return;
  if (item.group) {
    scene.remove(item.group);
    item.group.traverse(obj => {
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) {
        if (Array.isArray(obj.material)) obj.material.forEach(m => m.dispose());
        else obj.material.dispose();
      }
    });
  }
  groundItemsMap.delete(id);
  if (pendingPickupItemId === id) pendingPickupItemId = null;
}

function colorForItemId(itemId) {
  // Colores rápidos por tipo. Si hay icono real, ya lo cambiaremos.
  switch (itemId) {
    case 'bones':       return 0xeeeecc;
    case 'raw_beef':    return 0xc0392b;
    case 'cowhide':     return 0x8b4513;
    case 'raw_chicken': return 0xffd7a0;
    case 'feather':     return 0xffffff;
    case 'coins':       return 0xffd700;
    case 'bronze_dagger': return 0xb87333;
    case 'bronze_sword':  return 0xcd7f32;
    case 'goblin_mail':   return 0x556b2f;
    default:            return 0xaaaaaa;
  }
}

function makeGroundItemLabel(name, qty) {
  try {
    const c = document.createElement('canvas');
    c.width = 256; c.height = 64;
    const ctx = c.getContext('2d');
    ctx.font = 'bold 28px Arial';
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(0, 0, 256, 64);
    ctx.fillStyle = '#ffeb88';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const text = qty > 1 ? `${name} x${qty}` : name;
    ctx.fillText(text, 128, 32);
    const tex = new THREE.CanvasTexture(c);
    tex.minFilter = THREE.LinearFilter;
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(1.2, 0.3, 1);
    sprite.renderOrder = 999;
    return sprite;
  } catch (e) {
    return null;
  }
}

function findGroundItemAtTap() {
  // Solo raycast directo al hitbox del item. Y solo consideramos items
  // LEJANOS (más allá del auto-pickup): los cercanos los recoge solo
  // el auto-pickup, así no consumimos el tap y permitimos tap al suelo
  // donde haya items cerca del player.
  const meshList = [];
  for (const item of groundItemsMap.values()) {
    if (!item.hitMesh) continue;
    const dx = item.x - player.position.x;
    const dz = item.z - player.position.z;
    const d2 = dx * dx + dz * dz;
    if (d2 <= GROUND_ITEM_AUTO_RADIUS_M * GROUND_ITEM_AUTO_RADIUS_M) continue;
    meshList.push(item.hitMesh);
  }
  if (meshList.length === 0) return null;
  const hits = raycaster.intersectObjects(meshList, false);
  if (hits.length === 0) return null;
  const dropId = hits[0].object.userData.itemDropId;
  return groundItemsMap.get(dropId) || null;
}

function triggerGroundItemPickup(item) {
  if (!item) return;
  const dx = item.x - player.position.x;
  const dz = item.z - player.position.z;
  const d = Math.hypot(dx, dz);
  if (d <= GROUND_ITEM_AUTO_RADIUS_M) {
    // Ya estamos encima → auto-pickup lo recogerá en el siguiente frame.
    return;
  }
  // Lejos: caminamos hacia el item y dejamos que el auto-pickup haga su parte.
  pendingPickupItemId = item.id;
  setPlayerTarget(item.x, item.z);
}

async function pickupGroundItem(itemDropId) {
  if (!authToken) return;
  try {
    const r = await fetch(`${API_BASE}/api/ground_items/pickup`, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + authToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ids: [itemDropId] }),
    });
    if (!r.ok) return;
    const data = await r.json();
    // Procesar items recogidos: los quitamos de la escena
    const pickedUp = data?.picked_up || [];
    for (const pu of pickedUp) {
      const id = pu.id || pu;
      removeGroundItem(id);
    }
    // Procesar skipped: mostramos al user por qué no se pudo recoger
    const skipped = data?.skipped || [];
    for (const sk of skipped) {
      const reason = sk.reason || 'unknown';
      // Si fue too_far, no mostramos nada: el auto-pickup reintenta solo
      // cuando el server vea al player cerca, no hay nada que decir al user.
      if (reason === 'too_far') continue;
      const item = groundItemsMap.get(sk.id);
      const itemName = item ? item.name : 'item';
      let msg = '';
      switch (reason) {
        case 'inventory_full': msg = 'Mochila llena'; break;
        case 'private':        msg = `${itemName}: de otro jugador`; break;
        case 'expired':        msg = `${itemName}: desapareció`; break;
        default:               msg = `${itemName}: ${reason}`;
      }
      showLootToast(msg, '#e57373');
    }
    // Forzar próximo poll inmediato para refrescar el estado real
    groundItemsPollTimer = GROUND_ITEMS_POLL_INTERVAL;
  } catch (err) {
    // Silencioso — el próximo poll corregirá
  }
}

// Toast pequeño centrado-arriba para feedback de pickup. Reusamos el mismo
// div si ya existe (overlay). Auto-oculta en 1.6s.
let _lootToastEl = null;
let _lootToastTimer = null;
function showLootToast(text, color) {
  try {
    if (!_lootToastEl) {
      _lootToastEl = document.createElement('div');
      const s = _lootToastEl.style;
      s.position = 'fixed';
      s.left = '50%';
      s.top = '14%';
      s.transform = 'translateX(-50%)';
      s.padding = '8px 14px';
      s.background = 'rgba(20,14,8,0.92)';
      s.color = '#ffd76e';
      s.border = '1px solid #6b5536';
      s.borderRadius = '8px';
      s.font = 'bold 14px Arial, sans-serif';
      s.zIndex = '9999';
      s.pointerEvents = 'none';
      s.transition = 'opacity 0.25s';
      document.body.appendChild(_lootToastEl);
    }
    _lootToastEl.textContent = text;
    if (color) _lootToastEl.style.color = color;
    _lootToastEl.style.opacity = '1';
    if (_lootToastTimer) clearTimeout(_lootToastTimer);
    _lootToastTimer = setTimeout(() => {
      if (_lootToastEl) _lootToastEl.style.opacity = '0';
    }, 1600);
  } catch (e) { /* silencioso */ }
}
