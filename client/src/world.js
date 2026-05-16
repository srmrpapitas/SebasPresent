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
import { Character } from './character.js';
import * as combat from './combat.js';
import * as input from './input.js';
import * as multiplayer from './multiplayer.js';
import * as homeTele from './home_teleport.js';
import * as groundItems from './ground_items.js';
import * as terrain from './terrain.js';
import * as buildings from './buildings.js';
import * as interiors from './interiors.js';
import * as npcRenderer from './npc_renderer.js';
import {
  PALETTE, PLACES, BIOMES,
  WORLD_HALF, WILDERNESS_X, FOG_NEAR, FOG_FAR,
  biomeAt, getRegionInfo,
} from './terrain.js';
import { NPC_MINIMAP_RADIUS } from './npc_renderer.js';

// Constantes que se quedan en world (NO en terrain ni npc_renderer):
const PLAYER_RUN = 7.0;
const PLAYER_RUN_BOOST = 1.6;
const POSITION_SAVE_INTERVAL = 10_000;
const POSITION_SAVE_MIN_DELTA = 5.0;

const API_BASE = 'https://sebaspresent.srmrpapitas.workers.dev';

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
    for (const [id, group] of npcRenderer.getNpcMeshes().entries()) {
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
    // Sesión 11a — buildings (GLB del edificio + 3 instancias decorativas)
    // Sesión 11b parcial — camera/canvas/feedLog para tap + colisión sólida
    // Sesión 11c-1 — onTapBuilding dispara interiors.enter()
    showWorldLoading('Cargando edificios…');
    await buildings.start({
      scene, camera, canvas,
      feedLog: (type, msg) => combat.feedLog?.(type, msg),
      onTapBuilding: (id) => interiors.enter(id),
    });
    // Sesión 11c-1 — interiors (switch exterior↔interior, sin NPC todavía)
    showWorldLoading('Cargando interior…');
    await interiors.start({
      scene,
      getPlayer: () => player,
      onEnter: (buildingId) => {
        // Forzar disengage de combat si engaged (el NPC queda lejos)
        try { window.__playerExitCombat?.(); } catch {}
        npcRenderer.cancelAutoEngage?.();
        playerTarget = null;
        if (marker) marker.visible = false;
        // Forzar refresh del label de región tras salir/entrar
        lastRegionName = '';
        const el = document.getElementById('worldRegion');
        if (el) { el.textContent = 'Interior'; el.style.opacity = '1'; }
      },
      onLeave: () => {
        try { terrain.primeChunks(player.position.x, player.position.z); } catch {}
        lastRegionName = '';
        playerTarget = null;
        if (marker) marker.visible = false;
      },
    });
    await setupPlayer();
    setupMarker();
    setupInput();
    setupMinimap();
    setupFullMap();
    setupHud();

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
      onTeleported: () => {
        // Sesión 11c-1 — si home-teleport mientras en interior, hay que
        // limpiar el estado UI (el teleport ya cambió la posición a 0,0,
        // así que NO podemos hacer leave() porque revertiría a coords interior).
        try { if (interiors.isActive()) interiors.forceLeave(); } catch {}
        try { terrain.primeChunks(player.position.x, player.position.z); } catch {}
      },
    });

    // Sesión 4 refactor — arrancar ground_items (loot polling + auto-pickup)
    groundItems.start({
      scene, camera, canvas,
      getPlayer:       () => player,
      getAuthToken:    () => authToken,
      apiBase:         API_BASE,
      setPlayerTarget: (x, z) => setPlayerTarget(x, z),
    });

    // Sesión 6 refactor — arrancar npc_renderer (mesh + patrol + hpbars +
    // tap + auto-engage + hitsplats). Internamente registra los hooks
    // window.__worldFlashNpcHit y window.__worldSpawnHitsplat para combat.js.
    showWorldLoading('Cargando criaturas…');
    await npcRenderer.start({
      scene, camera, canvas,
      getPlayer:         () => player,
      setPlayerTarget:   (x, z) => setPlayerTarget(x, z),
      clearPlayerTarget: () => { playerTarget = null; if (marker) marker.visible = false; },
      feedLog:           (type, msg) => combat.feedLog?.(type, msg),
    });

    hideWorldLoading();
    animate();
  } catch (err) {
    console.error('World init failed:', err);
    console.error('Stack:', err?.stack);
    const msg = err?.message || err?.name || String(err) || 'desconocido';
    showWorldLoading('Error cargando el mundo: ' + msg);
  }
}

export function stopWorld() {
  // Sesión 11c-1 — si estamos en interior, salir silenciosamente para que
  // la posición guardada sea la exterior, no las coords (10000, 10000).
  if (running && interiors.isActive()) {
    const player2 = player;
    if (player2) {
      // forceLeave NO teleporta. leave() sí. Usamos leave() para volver
      // a lastExteriorPos antes del save.
      interiors.leave();
    }
  }
  if (running && player && authToken) savePositionBeacon(player.position.x, player.position.z);
  running = false;

  // Sesión 6 refactor — npc_renderer (limpia meshes, hpbars, action menu,
  // hitsplats layer, hooks window.__world*, polling timer)
  npcRenderer.stop();

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

  // Sesión 11c-1 — interiors (limpia interior group, floor mesh, exit button)
  interiors.stop();

  // Sesión 11a — buildings (GLB instances)
  buildings.stop();

  // Sesión 5 refactor — terrain (chunks, árboles, decoración, places, colliders)
  terrain.stop();

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
//   Player animation hooks (combat.js → character.js)
// ============================================================
// combat.js dispara estos hooks vía window.__player* para reproducir las
// animaciones del personaje del jugador (atacar, desenvainar, morir...).
// Los registramos al inicio del módulo (una sola vez) para que estén
// disponibles antes incluso del primer startWorld(). Lo único que tocan es
// el `character` del player y la variable `combatTargetNpcId` que viven
// aquí en world.js.
if (typeof window !== 'undefined') {
  // Slice 5b: trigger del swing del player. combat.js lo llama cada
  // attack tick (hit O miss — OSRS anima ambos).
  window.__playerPlayAttack = () => {
    try { character?.playAttack?.(); } catch (e) { console.warn('[world] playAttack:', e); }
  };
  // Slice 5d: animaciones de combate (engage/disengage = draw/sheath
  // espada; death/revive cuando mueres/respawneas).
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
    // Slice 5c mini-fix: hook revive robusto.
    // - Si character tiene revive(), lo usa (Character clase real).
    // - Si character es fallback (cápsula sin métodos), no rompe.
    // - Si revive() falla por lo que sea, forzamos arranque de idle directo
    //   en el mixer para que el modelo no se quede en pose de muerte.
    try {
      if (character?.revive) {
        character.revive();
      } else if (character?.mixer && character?.actions?.idle) {
        // Plan B: no hay método revive() pero sí mixer + idle clip.
        character.isDead = false;
        character.isAttacking = false;
        character.isInTransition = false;
        character.mixer.stopAllAction();
        character.mixer.setTime(0);
        character.actions.idle.reset();
        character.actions.idle.setEffectiveWeight(1);
        character.actions.idle.enabled = true;
        character.actions.idle.play();
        character.current = character.actions.idle;
      }
    } catch (e) {
      console.warn('[world] revive failed:', e);
    }
    // Teleport al hub (0,0) + refresh chunks.
    // El server (combatRespawnUser) solo restaura HP, no toca posición.
    try {
      if (player) {
        player.position.x = 0;
        player.position.z = 0;
        playerTarget = null;
        if (marker) marker.visible = false;
        terrain.primeChunks(0, 0);
      }
    } catch (e) { console.warn('[world] respawn teleport:', e); }
  };
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
    if (interiors.isActive()) return; // dentro del interior, el minimap no navega
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
  // Sesión 11c-1 — vista distinta para interior (no tiene sentido dibujar
  // biomas/PLACES/NPCs porque el player está en coords (10000,10000) muy
  // lejos del mundo real).
  if (interiors.isActive()) {
    drawMinimapInterior();
    return;
  }
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
  for (const npc of npcRenderer.getNpcDataList()) {
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

// Sesión 11c-1 — minimap minimalista para cuando estamos en interior.
// No tiene sentido dibujar biomas/PLACES/NPCs reales (player en 10000,10000).
function drawMinimapInterior() {
  const ctx = minimapCtx;
  const W = minimapCanvas.width;
  const H = minimapCanvas.height;
  const cx = W / 2, cy = H / 2;
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, W / 2 - 2, 0, Math.PI * 2);
  ctx.clip();
  ctx.fillStyle = '#1a1410';
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
  // Punto central representando al player
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(cx, cy, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = '#000';
  ctx.stroke();
  // Label "Interior"
  ctx.fillStyle = '#e8c560';
  ctx.font = 'bold 11px "Cinzel", serif';
  ctx.textAlign = 'center';
  ctx.fillText('Interior', cx, cy - 12);
  // Norte
  ctx.font = 'bold 12px serif';
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
  if (interiors.isActive()) return; // interiors gestiona bg/fog mientras dentro
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
    onTouchStart: () => npcRenderer.closeActionMenu(),

    // Tap simple → goto / atacar NPC / pickup item / tooltip árbol
    onTap: (cx, cy) => doCanvasTap(cx, cy),

    // Long-press → menú contextual estilo OSRS
    onLongPress: (cx, cy) => npcRenderer.openActionMenuAt(cx, cy),

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

function doCanvasTap(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  const nx = ((clientX - rect.left) / rect.width) * 2 - 1;
  const ny = -((clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera({ x: nx, y: ny }, camera);

  // Sesión 11c-1 — dentro del interior, solo aceptamos tap-to-walk en el
  // floor interior (el resto de raycasts apuntan a coords del exterior).
  // En 11c-2 añadiremos aquí el tap contra el NPC del mostrador.
  if (interiors.isActive()) {
    const floor = interiors.getFloorMesh();
    if (floor) {
      const hits = raycaster.intersectObject(floor);
      if (hits.length > 0) {
        const p = hits[0].point;
        setPlayerTarget(p.x, p.z);
      }
    }
    return;
  }

  // 1) Tap NPC → auto-walk hacia él y engage cuando lleguemos cerca.
  //    npcRenderer hace raycast + proximidad screen-space (más perdonable en móvil)
  //    y se encarga del auto-walk si está lejos.
  if (npcRenderer.tryHandleTap(clientX, clientY)) return;

  // 2) Tap item del suelo → caminar hacia él (auto-pickup al llegar).
  //    Solo si el tap impacta DIRECTAMENTE el hitbox del item (sin
  //    proximidad screen-space). Si lo erras, el tap cae al suelo y
  //    cuando pases cerca del item el auto-pickup lo recoge solo.
  if (groundItems.tryHandleTap(clientX, clientY)) return;

  // Sesión 11b parcial — Tap edificio → placeholder (en 11c será "entrar")
  if (buildings.tryHandleTap(clientX, clientY)) return;

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
  npcRenderer.update(dt);
  multiplayer.update(dt);
  groundItems.update(dt);
  drawMinimap();
  updatePositionSave(dt);
  renderer.render(scene, camera);
}

function updatePositionSave(dt) {
  if (!authToken) return;
  if (interiors.isActive()) return; // no guardar coords del interior (10000,10000) al server
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
    npcRenderer.cancelAutoEngage();
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
    const a1 = terrain.applyCollision(player.position.x, player.position.z, nextX, nextZ);
    const a2 = buildings.applyCollision(player.position.x, player.position.z, a1.x, a1.z);
    const adjusted = interiors.applyCollision(player.position.x, player.position.z, a2.x, a2.z);
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
      const adjusted = (() => {
        const a1 = terrain.applyCollision(player.position.x, player.position.z, nextX, nextZ);
        const a2 = buildings.applyCollision(player.position.x, player.position.z, a1.x, a1.z);
        return interiors.applyCollision(player.position.x, player.position.z, a2.x, a2.z);
      })();
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
    const mesh = npcRenderer.getNpcMeshes().get(combatTargetNpcId);
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

  // Auto-engage: npcRenderer mantiene el pending NPC y comprueba proximidad.
  // World reacciona al resultado actualizando playerTarget/marker.
  const ae = npcRenderer.tickAutoEngage(player.position.x, player.position.z);
  if (ae) {
    if (ae.reached) {
      playerTarget = null;
      if (marker) marker.visible = false;
    } else if (ae.chasing) {
      // Persigue al NPC visual: actualiza target a su pos orbitando
      if (playerTarget) {
        playerTarget.x = ae.targetX;
        playerTarget.z = ae.targetZ;
      }
      if (marker) marker.position.set(ae.targetX, 0.05, ae.targetZ);
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
  if (interiors.isActive()) return; // interiors gestiona bg/fog/label
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
