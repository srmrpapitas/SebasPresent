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
import * as input from './input.js';
import * as multiplayer from './multiplayer.js';
import * as homeTele from './home_teleport.js';
import * as groundItems from './ground_items.js';
import * as terrain from './terrain.js';
import {
  PALETTE, PLACES, BIOMES,
  WORLD_HALF, WILDERNESS_X, FOG_NEAR, FOG_FAR,
  biomeAt, getRegionInfo, bakeGlbModel,
} from './terrain.js';

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

// Constantes que se quedan en world (NO en terrain):
const PLAYER_RUN = 7.0;
const PLAYER_RUN_BOOST = 1.6;
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


// ============================================================
//                       Module state
// ============================================================

let scene, camera, renderer, clock, raycaster, ocean;
let player, marker;
let character = null;
let characterFallback = false;
// Slice 5d — animaciones de combate. ID del NPC que estamos atacando.
// Cuando != null, el player rota hacia el NPC (no hacia donde camina) y la
// dirección de movimiento se calcula relativa al facing.
let combatTargetNpcId = null;
let user = null;
let running = false;
let canvas = null;

// CAMARA OSRS: alejada y elevada
let cameraDist = 14;
let cameraYaw = Math.PI * 0.25;
let cameraPitch = 0.55;

let playerTarget = null;
let joyState = { active: false, x: 0, y: 0 };

let listeners = [];
let resizeRaf = null;
let inputDispose = null;

let NPC_GEOMS = null;

// ============================================================
// Slice 5c.5 — Multiplayer (peers locales)
// ============================================================
// El estado y lógica del multiplayer vive ahora en ./multiplayer.js.
// World.js solo lo arranca, lo actualiza por frame y lo detiene.

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
    setupScene();
    setupOcean();
    showWorldLoading('Cargando terreno…');
    await terrain.start({ scene });
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
    terrain.primeChunks(player.position.x, player.position.z);

    // Sesión 3 refactor — arrancar multiplayer ahora que scene/camera/player
    // están listos y tenemos token. character puede ser null (fallback capsule):
    // multiplayer detecta eso y usa cápsulas para los peers también.
    multiplayer.start({
      scene, camera, canvas,
      player,
      character,
      authToken,
      apiBase: API_BASE,
    });

    // Sesión 4 refactor — arrancar home_teleport (botón + cast + cooldown)
    homeTele.start({
      getPlayer:    () => player,
      getAuthToken: () => authToken,
      apiBase:      API_BASE,
      getCombatHp:  () => combat.getStateSnapshot?.()?.hp ?? null,
      feedLog:      (type, msg) => combat.feedLog?.(type, msg),
      onTeleported: () => { try { terrain.primeChunks(player.position.x, player.position.z); } catch {} },
    });

    // Sesión 4 refactor — arrancar ground_items (loot polling + auto-pickup)
    groundItems.start({
      scene, camera, canvas,
      getPlayer:       () => player,
      getAuthToken:    () => authToken,
      apiBase:         API_BASE,
      setPlayerTarget: (x, z) => setPlayerTarget(x, z),
    });

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

  // Sesión 3 refactor — detener multiplayer (limpia peers, name tags, timers)
  multiplayer.stop();

  // Sesión 4 refactor — detener home_teleport (quita botón, clear interval)
  homeTele.stop();

  // Sesión 4 refactor — detener ground_items (quita meshes, limpia timers)
  groundItems.stop();

  for (const { target, type, fn, opts } of listeners) {
    try { target.removeEventListener(type, fn, opts); } catch {}
  }
  listeners = [];

  // Sesión 2 refactor — desenganchar input.js
  if (inputDispose) { try { inputDispose(); } catch {} inputDispose = null; }

  // Sesión 5 refactor — terrain (chunks, árboles, decoración, places, colliders)
  terrain.stop();

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

  player = marker = camera = clock = ocean = null;
  user = null;
  playerTarget = null;
  lastRegionName = '';
  lastRegionWasWild = false;

  const nameTag = document.getElementById('playerNameTag');
  if (nameTag) { nameTag.classList.add('hidden'); nameTag.style.display = 'none'; }
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

// ============================================================
//                       Scene
// ============================================================

function setupScene() {
  canvas = document.getElementById('worldCanvas');
  if (!canvas) throw new Error('No #worldCanvas element in DOM');
  // Bloquear pinch-zoom nativo del browser sobre el canvas (sin tocar
  // joystick/minimapa, que tienen sus propios listeners).
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
  // Slice 5d: hooks de animación de combate. combat.js los llama al
  // engage/disengage para que el player desenvaine/envaine la espada,
  // y al morir/respawn para muerte y revive.
  window.__playerEnterCombat = (npcId) => {
    const wasEngaged = combatTargetNpcId !== null;
    combatTargetNpcId = npcId;
    // Solo desenvainar la primera vez (target switch sin envainar entre medio
    // no debe rejugar la animación de draw).
    if (!wasEngaged) {
      try { character?.playDraw?.(); } catch (e) { console.warn('[world] playDraw:', e); }
    }
  };
  window.__playerExitCombat = () => {
    combatTargetNpcId = null;
    try { character?.playSheath?.(); } catch (e) { console.warn('[world] playSheath:', e); }
  };
  window.__playerDeath = () => {
    combatTargetNpcId = null;
    try { character?.playDeath?.(); } catch (e) { console.warn('[world] playDeath:', e); }
  };
  window.__playerRevive = () => {
    combatTargetNpcId = null;
    try { character?.revive?.(); } catch (e) { console.warn('[world] revive:', e); }
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
  for (const m of terrain.getInteractableMeshes()) {
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
  for (const peer of multiplayer.getPeerPositions()) {
    const dx = peer.x - px, dz = peer.z - pz;
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
  // Sesión 2 refactor — toda la detección de gestos vive en input.js.
  // World.js solo proporciona los callbacks (qué hacer con cada gesto).
  inputDispose = input.setup({
    canvas,
    joystickEl: document.getElementById('joystick'),
    joystickKnobEl: document.getElementById('joystickKnob'),

    // Al tocar la pantalla: cerrar el menú contextual si está abierto.
    onTouchStart: () => closeActionMenu(),

    // Tap simple → goto / atacar NPC / pickup item / tooltip árbol
    onTap: (cx, cy) => doCanvasTap(cx, cy),

    // Long-press → menú contextual estilo OSRS
    onLongPress: (cx, cy) => openActionMenuAt(cx, cy),

    // Drag del dedo en canvas O rotación con dos dedos → rotar cámara
    onCameraDrag: (dyaw, dpitch) => {
      cameraYaw   -= dyaw;
      cameraPitch -= dpitch;
      cameraPitch = Math.max(0.1, Math.min(1.3, cameraPitch));
    },

    // Pinch con dos dedos → zoom de cámara
    onCameraZoom: (deltaDist) => {
      cameraDist += deltaDist;
      cameraDist = Math.max(CAMERA_DIST_MIN, Math.min(CAMERA_DIST_MAX, cameraDist));
    },

    // Joystick virtual → escribe en joyState que usa updatePlayer
    onJoystickMove: (s) => {
      joyState.active = s.active;
      joyState.x = s.x;
      joyState.y = s.y;
    },

    // Teclado (debug en PC) → Q/E giran cámara
    onKey: (key) => {
      if (key === 'q' || key === 'Q') cameraYaw += 0.15;
      if (key === 'e' || key === 'E') cameraYaw -= 0.15;
    },
  });

  // Resize: lo gestiona world porque toca camera/renderer
  addL(window, 'resize', onResize);
}

// Constante de tolerancia screen-space para tap sobre NPC (la usa findNpcNearTap)
const NPC_TAP_SCREEN_PX = 56;

function doCanvasTap(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  const nx = ((clientX - rect.left) / rect.width) * 2 - 1;
  const ny = -((clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera({ x: nx, y: ny }, camera);

  // 1) Tap NPC → auto-walk hacia él y engage cuando lleguemos cerca.
  // Probamos primero el raycast clásico (mesh exacto). Si falla, hacemos
  // proximidad por screen-space (el dedo cubre ~40-50px; aceptamos taps
  // dentro de NPC_TAP_SCREEN_PX del centro proyectado del NPC más cercano).
  const npc = findNpcNearTap(clientX, clientY);
  if (npc) {
    triggerNpcTap(npc.id);
    return;
  }

  // 2) Tap item del suelo → caminar hacia él (auto-pickup al llegar).
  //    Solo si el tap impacta DIRECTAMENTE el hitbox del item (sin
  //    proximidad screen-space). Si lo erras, el tap cae al suelo y
  //    cuando pases cerca del item el auto-pickup lo recoge solo.
  if (groundItems.tryHandleTap(clientX, clientY)) return;

  // 3) Tap árbol → tooltip
  const treeHits = raycaster.intersectObjects(terrain.getInteractableMeshes(), false);
  if (treeHits.length > 0) {
    const hit = treeHits[0];
    const treeType = hit.object.userData.treeType;
    if (treeType) {
      showTreeTooltip(treeType, clientX, clientY);
      return;
    }
  }

  // 4) Tap suelo → goto
  const hits = raycaster.intersectObjects(terrain.getTerrainMeshes());
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

// Sesión 2 refactor — onKeyDown, setupJoystick, setupTouchCamera
// se han movido a input.js. World.js los conecta vía callbacks en setupInput().

// ============================================================
//                       Animation loop
// ============================================================

function animate() {
  if (!running) return;
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.1);
  updatePlayer(dt);
  terrain.update(dt, player.position.x, player.position.z);
  updateCamera(dt);
  updateMarker();
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
  multiplayer.update(dt);
  groundItems.update(dt);
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
// Slice 5c.5 — Multiplayer
// ============================================================
// Toda la lógica vive en ./multiplayer.js. La inicialización se hace
// al final de startWorld() vía multiplayer.start(). El loop la llama
// con multiplayer.update(dt). El minimap lee posiciones con
// multiplayer.getPeerPositions().


function updatePlayer(dt) {
  let isMoving = false;
  let moveSpeed = 0;
  let moveWx = 0;   // Slice 5d — vector de movimiento (mundo) para calcular
  let moveWz = 0;   //            dirección relativa al facing en combate
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
    const adjusted = terrain.applyCollision(player.position.x, player.position.z, nextX, nextZ);
    player.position.x = adjusted.x;
    player.position.z = adjusted.z;
    moveWx = wx;
    moveWz = wz;
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
      const adjusted = terrain.applyCollision(player.position.x, player.position.z, nextX, nextZ);
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
        moveWx = dx;
        moveWz = dz;
        isMoving = true;
        moveSpeed = 1.0;
      }
    }
  }

  // ============================================================
  // Slice 5d — Rotación + locomoción direccional
  // ============================================================
  // En combate (combatTargetNpcId != null): el player se queda mirando al NPC.
  // El movimiento puede ir en cualquier dirección relativa a ese facing
  // (forward/back/left/right) y la animación cambia según la dirección.
  //
  // Fuera de combate: el player rota hacia donde se mueve (forward siempre).
  // ============================================================
  let facingLockedToNpc = false;
  if (combatTargetNpcId !== null) {
    const mesh = npcMeshes.get(combatTargetNpcId);
    if (mesh) {
      const tx = mesh.position.x - player.position.x;
      const tz = mesh.position.z - player.position.z;
      if (Math.hypot(tx, tz) > 0.01) {
        player.rotation.y = Math.atan2(tx, tz);
        facingLockedToNpc = true;
      }
    }
  }
  // Si no estamos lockeados al NPC y nos movemos, rotar a donde vamos
  if (!facingLockedToNpc && isMoving && (moveWx !== 0 || moveWz !== 0)) {
    player.rotation.y = Math.atan2(moveWx, moveWz);
  }

  player.position.x = Math.max(-WORLD_HALF + 1, Math.min(WORLD_HALF - 1, player.position.x));
  player.position.z = Math.max(-WORLD_HALF + 1, Math.min(WORLD_HALF - 1, player.position.z));

  if (character && character.loaded) {
    if (!isMoving) {
      character.play('idle');
    } else {
      // Calcular dirección relativa al facing del player.
      // Solo es != 'forward' cuando el facing está lockeado al NPC y el
      // movimiento va en otra dirección. Si no, siempre 'forward'.
      let direction = 'forward';
      if (facingLockedToNpc) {
        const fx = Math.sin(player.rotation.y);
        const fz = Math.cos(player.rotation.y);
        const rx = Math.cos(player.rotation.y);
        const rz = -Math.sin(player.rotation.y);
        const localForward = moveWx * fx + moveWz * fz;
        const localRight   = moveWx * rx + moveWz * rz;
        if (Math.abs(localForward) >= Math.abs(localRight)) {
          direction = localForward >= 0 ? 'forward' : 'back';
        } else {
          direction = localRight >= 0 ? 'right' : 'left';
        }
      }
      const state = moveSpeed > 0.7 ? 'run' : 'walk';
      character.play(state, direction);
    }
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
// Sesión 4 refactor:
// Home Teleport vive ahora en ./home_teleport.js
// Ground Items vive ahora en ./ground_items.js
// World.js los inicia desde startWorld() y los para desde stopWorld().
// groundItems.update(dt) se invoca desde el animate loop.
// El tap sobre items lejanos se delega vía groundItems.tryHandleTap().
// ============================================================
