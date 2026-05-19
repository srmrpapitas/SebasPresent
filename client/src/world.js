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
 *   - Sesión 27 Bloque 1: world_snapshot polea /api/world/snapshot en paralelo
 */

import * as THREE from 'three';
import { Character } from './character.js';
import * as combat from './combat.js';
import * as input from './input.js';
import * as multiplayer from './multiplayer.js';
import * as party from './party.js';                  // Sesión 27 Bloque 3 — Party
import * as duel from './duel.js';                    // Sesión 28 — Duelos PVP no-wild
import * as chat from './chat.js';                    // Sesión 29 — Chat global
import * as homeTele from './home_teleport.js';
import * as groundItems from './ground_items.js';
import * as terrain from './terrain.js';
import * as buildings from './buildings.js';
import * as interiors from './interiors.js';
import * as bank from './bank.js';
import * as ge from './ge.js';
import * as audio from './audio.js';
import * as skills from './skills.js';
import * as equipment from './equipment.js';
import * as inventory from './inventory.js';
import * as shop from './shop.js';
import * as damageSplat from './damage_splat.js';
import * as npcRenderer from './npc_renderer.js';
import * as worldSnapshot from './world_snapshot.js';   // Sesión 27 Bloque 1
import { getSkillIconHtml } from './item_icons.js';
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
// Sesión 11c-1 — override de cámara mientras estamos en interior (sala pequeña)
let savedCameraDist = null;
let savedCameraPitch = null;

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

// Sesión 26 — Run energy. Cliente-side (no se persiste entre sesiones).
//   - Drenaje:   RUN_DRAIN_PER_SEC mientras el joystick está activo y runMode=true
//   - Regeneración: RUN_RECOVERY_PER_SEC mientras no se corre (parado o andando)
//   - Si llega a 0, se fuerza runMode=false hasta que vuelva a haber energía.
const RUN_DRAIN_PER_SEC = 6;      // 100 → 0 en ~17s corriendo (similar OSRS)
const RUN_RECOVERY_PER_SEC = 3;   // 0 → 100 en ~33s parado
let runEnergy = 100;              // 0..100
let lastHudRunRendered = 100;     // para no escribir DOM cada frame

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
    // Sesión 11c-1 — interiors (switch exterior↔interior)
    // Sesión 11c-2 — añadidos camera/canvas + callbacks Banco/GE para NPC menú
    showWorldLoading('Cargando interior…');
    await interiors.start({
      scene, camera, canvas,
      getPlayer: () => player,
      onOpenBank: () => {
        // 1. Refrescar data del banco
        try { bank.onOpen?.(); } catch (e) { console.warn('[world] bank.onOpen:', e); }
        // 2. SFX
        try { audio.sfx('coins'); } catch {}
        // 3. Abrir el banco como overlay grande estilo GE — NO dentro del sidebar.
        openBankOverlay();
      },
      onOpenGE: () => {
        // ge.openOverlay() es self-contained: abre overlay fullscreen propio.
        try { audio.sfx('book_open'); } catch {}
        try { ge.openOverlay?.(); } catch (e) { console.warn('[world] ge.openOverlay:', e); }
      },
      // Sesión 23 — Shop callback
      onOpenShop: () => {
        try { audio.sfx('coins'); } catch {}
        try { shop.open('general_store'); } catch (e) { console.warn('[world] shop.open:', e); }
      },
      onEnter: (buildingId) => {
        // Forzar disengage de combat si engaged (el NPC queda lejos)
        try { window.__playerExitCombat?.(); } catch {}
        npcRenderer.cancelAutoEngage?.();
        multiplayer.cancelAutoEngage?.();  // Sesión 27 Bloque 3 — también peer
        playerTarget = null;
        if (marker) marker.visible = false;
        // Sesión 11c-2 v3 — sala reducida a 8m de alto. La cámara orbital
        // exterior (cameraDist típicamente 7-10m con cameraPitch hasta 1.3)
        // se sitúa a sin(1.3)*10=9.6m sobre el player — POR ENCIMA del techo
        // de 8m. La cámara atraviesa el techo y el pitch queda clampeado al
        // máximo, dando la sensación de que la cámara no se mueve vertical.
        // Fix: ajustar cámara a valores que quepan dentro de la sala.
        if (savedCameraDist === null)  savedCameraDist  = cameraDist;
        if (savedCameraPitch === null) savedCameraPitch = cameraPitch;
        cameraDist  = 5;     // antes ~7-10m → ahora 5m (cabe en sala 8m alto)
        cameraPitch = 0.55;  // ~31° — vista intermedia (lejos del clamp max)
        // Forzar refresh del label de región tras salir/entrar
        lastRegionName = '';
        const el = document.getElementById('worldRegion');
        if (el) { el.textContent = 'Interior'; el.style.opacity = '1'; }
        // Sesión 13 — SFX puerta al entrar; pausar música ambient
        try { audio.sfx('door_open'); audio.music(null); } catch {}
      },
      onLeave: () => {
        // Sesión 11c-1 — restaurar cámara exterior (por si se hubiera forzado)
        if (savedCameraDist !== null) { cameraDist = savedCameraDist; savedCameraDist = null; }
        if (savedCameraPitch !== null) { cameraPitch = savedCameraPitch; savedCameraPitch = null; }
        try { terrain.primeChunks(player.position.x, player.position.z); } catch {}
        lastRegionName = '';
        playerTarget = null;
        if (marker) marker.visible = false;
        // Sesión 13 — SFX puerta cierre + restaurar música del bioma actual
        try {
          audio.sfx('door_close');
          const biome = terrain.biomeAt(player.position.x, player.position.z);
          audio.musicForBiome(biome.id);
        } catch {}
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

    // Sesión 27 Bloque 3 — arrancar party. Lee el user_id propio via api.me()
    // y empieza a hacer poll cada 4s para detectar invites + actualizar
    // estado del grupo. No bloqueante.
    party.start({
      feedLog: (type, msg) => combat.feedLog?.(type, msg),
    }).catch(e => console.warn('[party.start]', e));

    // Sesión 28 — arrancar duel. NO hace polling propio (lee me.duel /
    // me.duel_invites_in del snapshot via duel.onSnapshotMe llamado
    // desde world_snapshot.js cada 250ms). start() solo cachea userId
    // y monta CSS.
    duel.start({
      feedLog: (type, msg) => combat.feedLog?.(type, msg),
    }).catch(e => console.warn('[duel.start]', e));

    // Sesión 29 — arrancar chat global. Polling cada 2.5s a /api/chat/recent.
    // El overhead text sobre la cabeza usa getCamera + getCanvas para
    // proyectar pos 3D → pos 2D pantalla cada frame (igual patrón que
    // multiplayer.updatePeerNameTag). chat.update(dt) se llama desde animate().
    chat.start({
      getPlayer:    () => player,
      getCamera:    () => camera,
      getCanvas:    () => canvas,
      feedLog:      (type, msg) => combat.feedLog?.(type, msg),
    }).catch(e => console.warn('[chat.start]', e));

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

    // Sesión 11c-2 — quitar tabs 🏦 (banco) y 🏛️ (GE) del sidebar. Su acceso
    // queda solo via NPC del interior del edificio.
    hideHubTabsInSidebar();

    // Sesión 13 — Inyectar panel de audio dentro del tab Settings ⚙ del sidebar.
    injectAudioSettingsPanel();

    // Sesión 13 — Audio: arrancar SFX engine y música ambient del bioma
    // donde aparece el player. El audio.init es idempotente y empieza
    // precarga de SFX en background. La música ambient queda encolada
    // y arranca tras primer touch del usuario (Safari requiere gesto).
    try {
      audio.init();
      if (!interiors.isActive() && player) {
        const biome = terrain.biomeAt(player.position.x, player.position.z);
        audio.musicForBiome(biome.id);
      }
    } catch (e) { console.warn('[world] audio init:', e); }

    // Sesión 14 — Skills: cargar XP/niveles de los 13 skills desde server.
    // IMPORTANTE: se hace ANTES de injectSkillsPanel para que el panel pueda
    // leer datos reales en su primer render.
    try {
      await skills.start({
        apiBase: API_BASE,
        getToken: () => authToken,
      });
      // Exponer para testing en eruda: window.skills.getLevel('attack')
      window.skills = skills;
      // Sesión 24 — exponer character para tweakWeapon() desde eruda
      window.character = character;
    } catch (e) { console.warn('[world] skills start:', e); }

    // Sesión 22 — Equipment system: 9 slots (weapon/shield/helm/...)
    try {
      await equipment.init({
        apiBase: API_BASE,
        getToken: () => authToken,
      });
      window.equipment = equipment;

      // Sesión 24 — Cuando cambie el equipment, attach/detach el arma 3D
      // en la mano del personaje. character.attachWeapon es async pero no
      // bloqueamos: si tarda, el render irá apareciendo en cuanto cargue.
      //
      // Sesión 26 — También attach/detach armor (body, shield, helm, cape)
      // a los huesos del cuerpo.
      const ARMOR_SLOTS = ['body', 'shield', 'helm', 'cape'];
      equipment.onChange((slots) => {
        if (!character || !character.loaded) return;
        const weapon = slots.weapon;
        if (weapon && weapon.item_id && weapon.weapon_type) {
          character.attachWeapon(weapon.item_id, weapon.weapon_type).catch(e => {
            console.warn('[world] attachWeapon:', e);
          });
        } else {
          character.detachWeapon();
        }
        // Armor slots
        for (const slotId of ARMOR_SLOTS) {
          const armor = slots[slotId];
          if (armor && armor.item_id) {
            character.attachArmor(armor.item_id, slotId).catch(e => {
              console.warn(`[world] attachArmor(${slotId}):`, e);
            });
          } else {
            character.detachArmor(slotId);
          }
        }
      });

      // Aplicar arma inicial si ya hay una equipada al cargar el mundo
      // (equipment.init ya hizo refresh, así que getEquipped tiene datos).
      const initialWeapon = equipment.getEquipped('weapon');
      if (character && character.loaded && initialWeapon?.item_id && initialWeapon?.weapon_type) {
        character.attachWeapon(initialWeapon.item_id, initialWeapon.weapon_type).catch(e => {
          console.warn('[world] attachWeapon inicial:', e);
        });
      }
      // Sesión 26 — Aplicar armor inicial
      for (const slotId of ARMOR_SLOTS) {
        const armor = equipment.getEquipped(slotId);
        if (character && character.loaded && armor?.item_id) {
          character.attachArmor(armor.item_id, slotId).catch(e => {
            console.warn(`[world] attachArmor inicial ${slotId}:`, e);
          });
        }
      }
    } catch (e) { console.warn('[world] equipment init:', e); }

    // Sesión 23 — Shop (overlay tienda del banker)
    try {
      shop.init({
        apiBase: API_BASE,
        getToken: () => authToken,
        onInventoryChange: () => {
          // Cuando se compra/vende, refrescar inventory para que se actualice la mochila
          try { inventory.refresh?.(); } catch {}
        },
      });
      window.shop = shop;
    } catch (e) { console.warn('[world] shop init:', e); }

    // Sesión 25 — exponer inventory en window para que el overlay de
    // muerte pueda refrescarlo tras drop+respawn.
    window.inventory = inventory;

    // Sesión 15 — Inyectar panel de Skills (tab Stats 📊) con grid 5×3.
    // Se inyecta DESPUÉS de skills.start() para que tenga datos.
    try { injectSkillsPanel(); } catch (e) { console.warn('[world] skills panel:', e); }

    // Sesión 21 — Reintegrar damage_splat (XP drops + player splat + level up banner)
    // Va DESPUÉS de skills.start() porque damage_splat lee skills.SKILL_DEFS_BY_ID.
    // El bug que tenía sesión 17 era el orden de carga; ahora resuelto.
    try {
      damageSplat.start({
        getPlayerWorldPos: () => player ? player.position : null,
        getCameraProjection: () => {
          if (!player || !camera) return null;
          const headY = player.position.y + (characterFallback ? 1.5 : 1.95);
          const v = new THREE.Vector3(player.position.x, headY, player.position.z);
          v.project(camera);
          if (v.z > 1 || v.z < -1) return { behind: true };
          const sx = (v.x * 0.5 + 0.5) * window.innerWidth;
          const sy = (-v.y * 0.5 + 0.5) * window.innerHeight;
          return { x: sx, y: sy, behind: false };
        },
      });
      // Hooks globales que combat.js consume tras cada attack tick
      window.__spawnXpDrops = (xpMap) => damageSplat.spawnXpDrops(xpMap);
      window.__spawnPlayerSplat = (damage, hit) => damageSplat.spawnPlayerDamageSplat(damage, hit);
      window.__spawnLevelUpBanner = (skillId, newLevel) => damageSplat.spawnLevelUpBanner(skillId, newLevel);
      // Level up banner también vía skills.onLevelUp (cubre grants vía API directa)
      skills.onLevelUp((evt) => {
        try { damageSplat.spawnLevelUpBanner(evt.skillId, evt.newLevel); } catch {}
      });
    } catch (e) { console.warn('[world] damage_splat start:', e); }

    // Sesión 27 Bloque 1 — arrancar polling del snapshot server-authoritative.
    // Vive en paralelo con multiplayer.js y npc_renderer.js. En Bloque 2 esos
    // dos migran a leer del snapshot y los pollings antiguos mueren.
    // Verificar en Eruda: window.__snapshotDebug()
    try {
      worldSnapshot.start({
        getPlayer:    () => player,
        getAuthToken: () => authToken,
        apiBase:      API_BASE,
      });
    } catch (e) { console.warn('[world] world_snapshot start:', e); }

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

  // Sesión 21 — damage_splat cleanup
  try { damageSplat.stop(); } catch {}

  // Sesión 27 Bloque 1 — world_snapshot cleanup
  try { worldSnapshot.stop(); } catch {}

  // Sesión 29 — chat cleanup (quita root DOM + bubbles + polling)
  try { chat.stop(); } catch {}

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
  // Sesión 19 — limpiar HP bar
  const hpBar = document.getElementById('playerHpBar');
  if (hpBar) hpBar.remove();
  authToken = null;
  positionSaveTimer = 0;
  runMode = false;
  runEnergy = 100;
  lastHudRunRendered = 100;

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
  // Sesión 27 fix — luz ambient subida de 0.55 a 0.72 para que zonas
  // densas de árboles (swamp, jungle) no queden en penumbra excesiva.
  const ambient = new THREE.AmbientLight(0x6088a0, 0.72);
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
  // Sesión 26 — combat.js pasa stance + weaponType + cooldownMs. El
  // character usa weaponType para decidir qué FBX usar (1H=Punching,
  // 2H=Sword_Attack_X según stance) y escala la anim a cooldownMs.
  // Backwards compatible: si combat.js antiguo solo pasa stance, los
  // otros params son undefined y character.js cae a defaults.
  window.__playerPlayAttack = (stanceKey, weaponType, cooldownMs) => {
    try { character?.playAttack?.(stanceKey, weaponType, cooldownMs); } catch (e) { console.warn('[world] playAttack:', e); }
  };
  // Slice 5d: animaciones de combate (engage/disengage = draw/sheath
  // espada; death/revive cuando mueres/respawneas).
  //
  // Sesión 25: con equipment ya integrado, reactivamos playDraw/playSheath
  // SOLO si el arma equipada es melee (1h_sword / 2h_sword). Para bow/staff
  // no tiene sentido el sword_draw. Para unarmed tampoco.
  window.__playerEnterCombat = (npcId) => {
    const wasEngaged = combatTargetNpcId !== null;
    combatTargetNpcId = npcId;
    if (!wasEngaged) {
      let weaponType = 'unarmed';
      try { weaponType = equipment.getWeaponType?.() || 'unarmed'; } catch {}
      const isMelee = weaponType === '1h_sword' || weaponType === '2h_sword';
      if (isMelee) {
        try { character?.playDraw?.(); } catch (e) { console.warn('[world] playDraw:', e); }
      } else if (weaponType !== 'unarmed') {
        // Bow/staff: activar combatStance manualmente (no hay anim de draw
        // específica, pero queremos que las anims de attack_1..4 se usen
        // cuando se ataque en lugar de punch).
        try { character?.setCombatStance?.(true); } catch {}
      }
    }
  };
  window.__playerExitCombat = () => {
    combatTargetNpcId = null;
    let weaponType = 'unarmed';
    try { weaponType = equipment.getWeaponType?.() || 'unarmed'; } catch {}
    const isMelee = weaponType === '1h_sword' || weaponType === '2h_sword';
    if (isMelee) {
      try { character?.playSheath?.(); } catch (e) { console.warn('[world] playSheath:', e); }
    } else if (weaponType !== 'unarmed') {
      try { character?.setCombatStance?.(false); } catch {}
    }
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

  // NPCs como puntos en el minimapa.
  // Sesión 27 Bloque 3 — NPCs en wilderness (x < WILDERNESS_X) salen
  // en AMARILLO (zona hostil / PVE-PVP mixto). Fuera de wilderness,
  // siguen blancos como antes.
  const NPC_RAD_SQ = NPC_MINIMAP_RADIUS * NPC_MINIMAP_RADIUS;
  for (const npc of npcRenderer.getNpcDataList()) {
    const dx = npc.x - px, dz = npc.z - pz;
    if (dx * dx + dz * dz > NPC_RAD_SQ) continue;
    const sx = cx + dx * scale, sy = cy + dz * scale;
    ctx.beginPath();
    ctx.arc(sx, sy, 2, 0, Math.PI * 2);
    ctx.fillStyle = (npc.x < WILDERNESS_X) ? '#ffd040' : '#fff';
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.7)';
    ctx.lineWidth = 0.8;
    ctx.stroke();
  }

  // Otros players como puntos en el minimapa.
  // Sesión 27 Bloque 3 — Color según relación:
  //   - Mi party → verde brillante.
  //   - Otros (PVP rivals / desconocidos) → azul (default).
  const myPartyId = party.getMyPartyId();
  for (const peer of multiplayer.getPeerPositions()) {
    const dx = peer.x - px, dz = peer.z - pz;
    if (dx * dx + dz * dz > NPC_RAD_SQ) continue;
    const sx = cx + dx * scale, sy = cy + dz * scale;
    ctx.beginPath();
    ctx.arc(sx, sy, 3, 0, Math.PI * 2);
    const sameParty = myPartyId != null && peer.party_id === myPartyId;
    ctx.fillStyle = sameParty ? '#4adc4a' : '#4090ff';
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

  // Sesión 27 Bloque 3 — Botón flotante "Grupo" (HUD lateral).
  // Posición: arriba-izquierda, debajo del minimap.
  // Click → abre modal de party. El contador (1/4) se actualiza cada vez
  // que cambia el snapshot global.
  setupPartyButton();
}

function setupPartyButton() {
  if (document.getElementById('partyHudBtn')) return;
  const btn = document.createElement('div');
  btn.id = 'partyHudBtn';
  btn.style.cssText = `
    position: absolute;
    top: calc(env(safe-area-inset-top, 0px) + 160px);
    right: 8px;
    z-index: 22;
    background: rgba(20, 14, 8, 0.85);
    border: 1.5px solid #c8a043;
    border-radius: 4px;
    color: #f0e0b0;
    font-family: 'Cinzel', serif;
    font-size: 11px;
    font-weight: 700;
    padding: 5px 9px;
    cursor: pointer;
    user-select: none;
    -webkit-user-select: none;
    text-shadow: 1px 1px 0 #000;
    box-shadow: 0 2px 4px rgba(0,0,0,0.6);
    display: flex;
    align-items: center;
    gap: 4px;
  `;
  btn.innerHTML = `<span>👥</span><span id="partyHudCount">Grupo</span>`;
  document.body.appendChild(btn);
  btn.addEventListener('pointerup', (ev) => {
    if (ev.button !== undefined && ev.button !== 0) return;
    ev.preventDefault();
    party.openModal?.();
  });
  // Refresh contador cada segundo
  setInterval(() => {
    const countEl = document.getElementById('partyHudCount');
    if (!countEl) return;
    const state = party.getState?.();
    const p = state?.party;
    if (p && p.members) {
      countEl.textContent = `${p.members.length}/${p.max_size}`;
      btn.style.borderColor = '#4abc4a';
    } else {
      countEl.textContent = 'Grupo';
      btn.style.borderColor = '#c8a043';
    }
    // Indicador rojo si hay invites pendientes
    const inv = state?.invites_in || [];
    if (inv.length > 0) {
      btn.style.boxShadow = '0 0 12px rgba(255,80,80,0.7), 0 2px 4px rgba(0,0,0,0.6)';
    } else {
      btn.style.boxShadow = '0 2px 4px rgba(0,0,0,0.6)';
    }
  }, 1000);
}

function toggleRunMode() {
  // Sesión 26 — Si intenta activar run sin energía, no hacer nada.
  if (!runMode && runEnergy <= 0) return;
  runMode = !runMode;
  if (hudStatRun) {
    if (runMode) hudStatRun.classList.add('active');
    else hudStatRun.classList.remove('active');
  }
}

// Sesión 11c-2 — ocultar los iconos del sidebar para bank y GE.
// El HTML del sidebar usa data-tab-btn (no data-tab — confirmado en
// index.html). Los panes internos siguen usando data-tab="bank" y NO
// los ocultamos, porque bank.onOpen() necesita activarlos al tappear NPC.
function hideHubTabsInSidebar() {
  const STYLE_ID = 'interiors-hide-hub-tabs';
  if (!document.getElementById(STYLE_ID)) {
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      /* Sesión 11c-2: ocultar tabs banco y GE del sidebar.
         Usamos visibility:hidden + width:0 + margin:0 (no display:none)
         para NO romper el grid/flex del sidebar y dejar magic/settings/etc.
         en su sitio original. */
      .osrs-sidebar-tab[data-tab-btn="bank"],
      .osrs-sidebar-tab[data-tab-btn="ge"] {
        visibility: hidden !important;
        pointer-events: none !important;
        width: 0 !important;
        height: 0 !important;
        min-width: 0 !important;
        min-height: 0 !important;
        max-width: 0 !important;
        max-height: 0 !important;
        margin: 0 !important;
        padding: 0 !important;
        border: 0 !important;
        overflow: hidden !important;
        position: absolute !important;
        opacity: 0 !important;
      }
    `;
    document.head.appendChild(style);
  }

  // Diagnóstico: contar cuántos se ocultaron
  const found = document.querySelectorAll('[data-tab-btn="bank"], [data-tab-btn="ge"]').length;
  if (found > 0) {
    console.log(`[world] Sesión 11c-2: ocultados ${found} iconos de banco/GE del sidebar.`);
  } else {
    console.warn('[world] Sesión 11c-2: no se encontraron iconos con [data-tab-btn="bank"|"ge"]. ' +
      'Si los iconos siguen visibles, pásame el HTML actual del sidebar.');
  }

  // Sesión 11c-2 — Mochila estilo OSRS: 4 columnas × 7 filas = 28 slots
  // sin scroll. CSS defensivo: cubre varios selectores posibles que pueda
  // usar inventory.js (no lo tengo en mano). Si tu inventory.js usa otro
  // class name, pásamelo y ajusto. Mientras tanto, esto evita el scroll
  // mostrando todos los 28 slots a la vez.
  injectInventoryGridCss();
}

function injectInventoryGridCss() {
  const STYLE_ID = 'inventory-osrs-grid-4x7';
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    /* Sesión 11c-2 v3: mochila estilo OSRS — slots 42×42px en grid 4×7
       centrado. CRÍTICO: scope a .active para no romper el toggle de tabs.
       Si aplico display:flex siempre, la mochila se ve encima de stats/magic. */
    .osrs-tab-pane[data-tab="inventory"].active {
      overflow: hidden !important;
      padding: 8px !important;
      display: flex !important;
      flex-direction: column !important;
      align-items: center !important;
      justify-content: flex-start !important;
    }
    /* La grid interna que crea inventory.js (sin :active porque solo
       afecta a hijos del pane, que solo existen visiblemente cuando
       el pane está active). */
    .osrs-tab-pane[data-tab="inventory"] .inventory-grid,
    .osrs-tab-pane[data-tab="inventory"] .inv-grid,
    .osrs-tab-pane[data-tab="inventory"] .osrs-inv-grid,
    .osrs-tab-pane[data-tab="inventory"] [class*="inventory-grid"],
    .osrs-tab-pane[data-tab="inventory"] [class*="inv-grid"] {
      display: grid !important;
      grid-template-columns: repeat(4, 42px) !important;
      grid-auto-rows: 42px !important;
      gap: 4px !important;
      overflow: hidden !important;
      width: auto !important;
      flex: 0 0 auto !important;
      padding: 0 !important;
      margin: 0 !important;
    }
    /* Slots individuales: 42x42 fijo, OSRS-like */
    .osrs-tab-pane[data-tab="inventory"] .inventory-slot,
    .osrs-tab-pane[data-tab="inventory"] .inv-slot,
    .osrs-tab-pane[data-tab="inventory"] .osrs-inv-slot,
    .osrs-tab-pane[data-tab="inventory"] [class*="inventory-slot"],
    .osrs-tab-pane[data-tab="inventory"] [class*="inv-slot"] {
      width: 42px !important;
      height: 42px !important;
      min-width: 42px !important;
      min-height: 42px !important;
      max-width: 42px !important;
      max-height: 42px !important;
      box-sizing: border-box !important;
    }
  `;
  document.head.appendChild(style);
  console.log('[world] Inyectado CSS para grid 4x7 de mochila.');
}

// ============================================================
// Sesión 13 — Panel de audio (sliders volumen + mute) dentro del tab ⚙
// ============================================================
// Inyecta UI dentro del pane `.osrs-tab-pane[data-tab="settings"]` para
// controlar master/sfx/music/mute. No requiere tocar index.html ni ui.js.

function injectAudioSettingsPanel() {
  const pane = document.querySelector('.osrs-tab-pane[data-tab="settings"]');
  if (!pane) {
    console.warn('[world] Sesión 13: pane settings no encontrado, no se inyecta panel audio.');
    return;
  }

  // Estilos del panel
  if (!document.getElementById('audio-settings-styles')) {
    const style = document.createElement('style');
    style.id = 'audio-settings-styles';
    style.textContent = `
      .audio-settings {
        padding: 14px 12px;
        color: #e8c560;
        font-family: 'Cinzel', serif;
      }
      .audio-settings-title {
        font-size: 16px;
        font-weight: 700;
        letter-spacing: 0.06em;
        margin: 0 0 10px 0;
        text-align: center;
        text-shadow: 0 2px 4px rgba(0,0,0,0.8);
      }
      .audio-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        margin: 10px 0;
      }
      .audio-row label {
        flex: 0 0 auto;
        font-size: 12px;
        min-width: 64px;
        color: #d4b850;
      }
      .audio-row input[type="range"] {
        flex: 1 1 auto;
        min-width: 0;
        accent-color: #c8a043;
      }
      .audio-row .audio-val {
        flex: 0 0 36px;
        text-align: right;
        font-size: 11px;
        font-family: 'IM Fell English', serif;
        color: #ffd060;
      }
      .audio-mute-btn {
        display: block;
        width: 100%;
        margin-top: 12px;
        padding: 10px 14px;
        background: rgba(20, 14, 8, 0.92);
        border: 2px solid #c8a043;
        color: #e8c560;
        font-family: 'Cinzel', serif;
        font-size: 13px;
        font-weight: 700;
        border-radius: 4px;
        letter-spacing: 0.05em;
        cursor: pointer;
        -webkit-tap-highlight-color: transparent;
      }
      .audio-mute-btn.muted {
        background: rgba(120, 30, 30, 0.85);
        border-color: #a05a3a;
      }
      .audio-mute-btn:active { transform: scale(0.97); }
    `;
    document.head.appendChild(style);
  }

  // Reemplazar contenido del placeholder de settings
  const prefs = audio.getPrefs();
  pane.innerHTML = `
    <div class="audio-settings">
      <h3 class="audio-settings-title">⚙ Ajustes</h3>
      <button class="audio-mute-btn ${prefs.muted ? 'muted' : ''}" data-audio-mute>
        ${prefs.muted ? '🔇 Música silenciada · Tap para activar' : '🔊 Silenciar música'}
      </button>
    </div>
  `;

  // Listener mute (único control)
  const muteBtn = pane.querySelector('[data-audio-mute]');
  if (muteBtn) {
    muteBtn.addEventListener('pointerup', (ev) => {
      if (ev.button !== undefined && ev.button !== 0) return;
      ev.preventDefault();
      const nowMuted = audio.toggleMute();
      muteBtn.classList.toggle('muted', nowMuted);
      muteBtn.textContent = nowMuted ? '🔇 Música silenciada · Tap para activar' : '🔊 Silenciar música';
    });
  }

  console.log('[world] Sesión 13: panel audio inyectado (solo mute).');
}

// ============================================================
// Sesión 15 — Panel de Skills (tab Stats 📊) estilo OSRS
// ============================================================
// Grid 3 columnas × 5 filas (15 slots) en el pane data-tab="stats".
// 13 skills + 2 slots para Combat level y Total level al final.
// Cada slot: icono, nivel actual / nivel máximo (1/99, 50/99, etc.).
// Tap en un slot abre un tooltip con XP exacto y XP para siguiente.
// Auto-refresh vía skills.onChange().

function injectSkillsPanel() {
  const pane = document.querySelector('.osrs-tab-pane[data-tab="stats"]');
  if (!pane) {
    console.warn('[world] Sesión 15: pane stats no encontrado.');
    return;
  }

  // Estilos del panel
  if (!document.getElementById('skills-panel-styles')) {
    const style = document.createElement('style');
    style.id = 'skills-panel-styles';
    style.textContent = `
      .skills-panel {
        padding: 8px 6px;
        color: #e8c560;
        font-family: 'Cinzel', serif;
        display: flex;
        flex-direction: column;
        height: 100%;
      }
      .skills-panel-grid {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 4px;
        flex: 1 1 auto;
      }
      /* Cada skill slot — fondo oscuro con icon arriba-izq y nivel abajo-der,
         estilo OSRS clásico (esquinas internas con nivel actual/máximo).
         Usamos 2 ::before/::after para no abusar de HTML. */
      .skill-slot {
        background: linear-gradient(135deg, rgba(60, 45, 30, 0.95), rgba(30, 20, 12, 0.95));
        border: 1.5px solid #5a4a30;
        border-radius: 3px;
        padding: 4px 6px;
        height: 38px;
        position: relative;
        cursor: pointer;
        -webkit-tap-highlight-color: transparent;
        user-select: none;
        transition: transform 0.08s, border-color 0.15s;
        overflow: hidden;
      }
      .skill-slot:active {
        transform: scale(0.95);
        border-color: #c8a043;
      }
      .skill-slot.combat-skill { border-color: #6a3a2a; }
      .skill-slot.gathering-skill { border-color: #2a5a3a; }
      .skill-slot-icon {
        position: absolute;
        top: 4px;
        left: 6px;
        width: 22px;
        height: 22px;
        line-height: 1;
        font-size: 18px;
        filter: drop-shadow(0 1px 2px rgba(0,0,0,0.8));
      }
      .skill-slot-current {
        position: absolute;
        top: 2px;
        right: 5px;
        font-family: 'IM Fell English', serif;
        font-size: 12px;
        font-weight: bold;
        color: #ffff00;
        text-shadow: 1px 1px 0 #000, -1px 1px 0 #000, 1px -1px 0 #000, -1px -1px 0 #000;
        line-height: 1;
      }
      .skill-slot-max {
        position: absolute;
        bottom: 3px;
        right: 5px;
        font-family: 'IM Fell English', serif;
        font-size: 11px;
        font-weight: bold;
        color: #ffff00;
        text-shadow: 1px 1px 0 #000, -1px 1px 0 #000, 1px -1px 0 #000, -1px -1px 0 #000;
        line-height: 1;
      }
      .skill-slot-name {
        position: absolute;
        bottom: 3px;
        left: 6px;
        font-size: 9px;
        color: rgba(232, 197, 96, 0.7);
        font-family: 'Cinzel', serif;
        letter-spacing: 0.02em;
        line-height: 1;
      }
      /* Special slots: combat level y total level */
      .skill-slot.special {
        background: linear-gradient(135deg, rgba(80, 60, 30, 0.95), rgba(50, 35, 18, 0.95));
        border-color: #c8a043;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: 2px 4px;
      }
      .skill-slot.special .skill-slot-name {
        position: static;
        font-size: 9px;
        color: #c8a043;
        margin-bottom: 1px;
      }
      .skill-slot.special .skill-slot-special-value {
        font-family: 'IM Fell English', serif;
        font-size: 16px;
        font-weight: bold;
        color: #ffd060;
        text-shadow: 1px 1px 0 #000, -1px 1px 0 #000, 1px -1px 0 #000, -1px -1px 0 #000;
        line-height: 1;
      }

      /* Tooltip al tap de un skill */
      .skill-tooltip {
        position: fixed;
        z-index: 200;
        background: rgba(20, 14, 8, 0.96);
        border: 2px solid #c8a043;
        border-radius: 6px;
        padding: 10px 14px;
        min-width: 200px;
        max-width: 260px;
        color: #e8c560;
        font-family: 'IM Fell English', serif;
        font-size: 13px;
        box-shadow: 0 8px 24px rgba(0,0,0,0.7);
        pointer-events: auto;
      }
      .skill-tooltip-title {
        font-family: 'Cinzel', serif;
        font-weight: 700;
        font-size: 15px;
        color: #fff8d0;
        margin-bottom: 6px;
        display: flex;
        align-items: center;
        gap: 6px;
      }
      .skill-tooltip-title-icon {
        display: inline-block;
        width: 22px;
        height: 22px;
        flex-shrink: 0;
      }
      .skill-tooltip-row {
        display: flex;
        justify-content: space-between;
        margin: 2px 0;
        font-size: 12px;
        color: #d4b850;
      }
      .skill-tooltip-row b { color: #fff8d0; }
      .skill-tooltip-progress {
        margin-top: 8px;
        height: 6px;
        background: rgba(40, 25, 15, 0.95);
        border: 1px solid #5a4a30;
        border-radius: 3px;
        overflow: hidden;
      }
      .skill-tooltip-progress-fill {
        height: 100%;
        background: linear-gradient(90deg, #c8a043, #ffd060);
        transition: width 0.3s;
      }
      .skill-tooltip-close {
        position: absolute;
        top: 4px;
        right: 6px;
        width: 22px;
        height: 22px;
        background: rgba(60, 30, 20, 0.9);
        border: 1px solid #c8a043;
        color: #e8c560;
        font-size: 12px;
        font-weight: bold;
        border-radius: 3px;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
      }
    `;
    document.head.appendChild(style);
  }

  // Render inicial
  renderSkillsPanel(pane);

  // Suscribirse a cambios (XP gain redibuja el panel)
  skills.onChange(() => {
    renderSkillsPanel(pane);
  });

  // Animación de level up: jingle audio
  skills.onLevelUp((evt) => {
    try { audio.playLevelUp(); } catch {}
    const def = skills.SKILL_DEFS_BY_ID[evt.skillId];
    const skillName = def?.name || evt.skillId;
    console.log(`[world] LEVEL UP! ${skillName} → ${evt.newLevel}`);
  });

  console.log('[world] Sesión 15: panel skills inyectado.');
}

function renderSkillsPanel(pane) {
  const defs = skills.SKILL_DEFS;
  const totalLvl = skills.getTotalLevel();
  const combatLvl = skills.getCombatLevel();

  // 13 skills + 1 slot vacío + 2 special = 16... no cuadra. Mejor 3 columnas
  // y last row con [vacío, total, combat]. Pero queda raro. Solución limpia:
  // 13 skill slots + dejamos los 2 últimos slots del grid 3x5 (15) para
  // combat y total level — quedan 14 de 15, sobra 1 vacío.
  let html = '<div class="skills-panel">';
  html += '<div class="skills-panel-grid">';
  for (const def of defs) {
    const level = skills.getLevel(def.id);
    const categoryClass = def.combat ? 'combat-skill' : (def.gathering ? 'gathering-skill' : '');
    html += `
      <div class="skill-slot ${categoryClass}" data-skill-id="${def.id}">
        <span class="skill-slot-icon">${getSkillIconHtml(def.id, def.icon)}</span>
        <span class="skill-slot-current">${level}</span>
        <span class="skill-slot-max">${level}</span>
        <span class="skill-slot-name">${def.name}</span>
      </div>
    `;
  }
  // Slot vacío para alinear
  html += `<div class="skill-slot" style="opacity:0; pointer-events:none;"></div>`;
  // Combat level
  html += `
    <div class="skill-slot special">
      <span class="skill-slot-name">Combate</span>
      <span class="skill-slot-special-value">${combatLvl}</span>
    </div>
  `;
  // Total level
  html += `
    <div class="skill-slot special">
      <span class="skill-slot-name">Total</span>
      <span class="skill-slot-special-value">${totalLvl}</span>
    </div>
  `;
  html += '</div>';
  html += '</div>';
  pane.innerHTML = html;

  // Listeners: tap en cada skill abre tooltip
  pane.querySelectorAll('.skill-slot[data-skill-id]').forEach(slot => {
    slot.addEventListener('pointerup', (ev) => {
      if (ev.button !== undefined && ev.button !== 0) return;
      ev.preventDefault();
      ev.stopPropagation();
      showSkillTooltip(slot.dataset.skillId, ev.clientX, ev.clientY);
    });
  });
}

function showSkillTooltip(skillId, clientX, clientY) {
  // Cerrar tooltip previo si existe
  const old = document.getElementById('skillTooltip');
  if (old) old.remove();

  const def = skills.SKILL_DEFS_BY_ID[skillId];
  if (!def) return;
  const level = skills.getLevel(skillId);
  const xp = skills.getXp(skillId);
  const nextXp = level < 99 ? skills.levelToXp(level + 1) : null;
  const curLevelXp = skills.levelToXp(level);
  const xpInLevel = xp - curLevelXp;
  const xpForNextLevel = nextXp !== null ? nextXp - curLevelXp : 0;
  const pct = nextXp !== null ? Math.min(100, Math.floor((xpInLevel / xpForNextLevel) * 100)) : 100;

  const el = document.createElement('div');
  el.id = 'skillTooltip';
  el.className = 'skill-tooltip';
  el.innerHTML = `
    <button class="skill-tooltip-close" aria-label="Cerrar">✕</button>
    <div class="skill-tooltip-title"><span class="skill-tooltip-title-icon">${getSkillIconHtml(def.id, def.icon)}</span> ${def.name}</div>
    <div class="skill-tooltip-row"><span>Nivel actual:</span><b>${level} / 99</b></div>
    <div class="skill-tooltip-row"><span>XP total:</span><b>${xp.toLocaleString('es-ES')}</b></div>
    ${nextXp !== null
      ? `<div class="skill-tooltip-row"><span>XP siguiente:</span><b>${(nextXp - xp).toLocaleString('es-ES')}</b></div>
         <div class="skill-tooltip-progress"><div class="skill-tooltip-progress-fill" style="width:${pct}%"></div></div>
         <div style="text-align:center;font-size:10px;margin-top:4px;color:#c8a043;">${pct}% del nivel ${level + 1}</div>`
      : `<div style="text-align:center;font-size:12px;margin-top:6px;color:#ffd060;">⭐ Nivel máximo alcanzado ⭐</div>`
    }
  `;
  document.body.appendChild(el);

  // Posicionar evitando bordes
  const maxX = window.innerWidth - el.offsetWidth - 10;
  const maxY = window.innerHeight - el.offsetHeight - 10;
  el.style.left = Math.min(Math.max(10, clientX - el.offsetWidth / 2), maxX) + 'px';
  el.style.top  = Math.min(Math.max(10, clientY - el.offsetHeight - 10), maxY) + 'px';

  // Cerrar al tap en X o fuera
  const closeBtn = el.querySelector('.skill-tooltip-close');
  closeBtn?.addEventListener('pointerup', (e) => { e.preventDefault(); e.stopPropagation(); el.remove(); });
  const outsideClose = (e) => {
    if (!el.contains(e.target)) {
      el.remove();
      document.removeEventListener('pointerdown', outsideClose, true);
    }
  };
  // delay un poco para no cerrar inmediatamente con el mismo tap
  setTimeout(() => document.addEventListener('pointerdown', outsideClose, true), 100);
}


// ============================================================
// Sesión 11c-2 — Bank overlay (fuera del sidebar, estilo GE)
// ============================================================
// El user quiere el banco como overlay grande fullscreen, NO incrustado
// abajo del inventario del sidebar.
//
// Estrategia: bank.js cliente renderiza dentro del pane
// `.osrs-tab-pane[data-tab="bank"]` (busca por querySelector al init).
// Para mostrarlo fullscreen sin reescribir bank.js:
//   1. Creo un overlay `#bankOverlay` dinámicamente.
//   2. Al abrir, MUEVO el pane del sidebar al overlay (preserva listeners).
//   3. Al cerrar, MUEVO el pane de vuelta al sidebar.
//
// Esto no requiere cambios en bank.js cliente ni en el HTML.

let bankOverlayEl = null;
let bankPaneOriginalParent = null;     // referencia al sidebar para devolver el pane
let bankPaneOriginalNextSibling = null; // para devolverlo a la misma posición

function ensureBankOverlay() {
  if (bankOverlayEl) return bankOverlayEl;

  // CSS — replica estilo GE overlay
  if (!document.getElementById('bank-overlay-styles')) {
    const style = document.createElement('style');
    style.id = 'bank-overlay-styles';
    style.textContent = `
      .bank-overlay {
        position: fixed;
        inset: 0;
        background: rgba(0, 0, 0, 0.78);
        backdrop-filter: blur(4px);
        -webkit-backdrop-filter: blur(4px);
        z-index: 50;
        display: none;
        align-items: center;
        justify-content: center;
        padding: env(safe-area-inset-top, 0px) 12px env(safe-area-inset-bottom, 0px) 12px;
      }
      .bank-overlay.visible { display: flex; }
      .bank-overlay-frame {
        position: relative;
        width: 100%;
        max-width: 720px;
        height: calc(100vh - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px) - 24px);
        max-height: 100%;
        background: rgba(20, 14, 8, 0.97);
        border: 3px solid #c8a043;
        border-radius: 6px;
        box-shadow: 0 0 60px rgba(200, 160, 67, 0.4), 0 12px 40px rgba(0,0,0,0.8);
        display: flex;
        flex-direction: column;
        overflow: hidden;
      }
      .bank-overlay-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 10px 14px;
        border-bottom: 2px solid rgba(200, 160, 67, 0.3);
        background: rgba(40, 25, 15, 0.6);
        flex: 0 0 auto;
      }
      .bank-overlay-title {
        font-family: 'Cinzel', serif;
        font-weight: 900;
        font-size: 18px;
        color: #e8c560;
        letter-spacing: 0.05em;
        text-shadow: 0 2px 4px rgba(0,0,0,0.9);
      }
      .bank-overlay-close {
        width: 36px; height: 36px;
        background: rgba(60, 30, 20, 0.95);
        border: 2px solid #c8a043;
        color: #e8c560;
        font-size: 18px;
        font-weight: bold;
        border-radius: 4px;
        cursor: pointer;
        display: flex; align-items: center; justify-content: center;
        -webkit-tap-highlight-color: transparent;
      }
      .bank-overlay-close:active { transform: scale(0.92); background: rgba(120,60,40,0.95); }

      /* El pane del banco se mete aquí dentro y necesita rellenar el frame */
      .bank-overlay-body {
        flex: 1 1 auto;
        overflow-y: auto;
        padding: 0;
      }
      .bank-overlay-body .osrs-tab-pane[data-tab="bank"] {
        display: block !important;
        height: auto !important;
        padding: 12px !important;
        background: transparent !important;
      }
    `;
    document.head.appendChild(style);
  }

  bankOverlayEl = document.createElement('div');
  bankOverlayEl.id = 'bankOverlay';
  bankOverlayEl.className = 'bank-overlay';
  bankOverlayEl.innerHTML = `
    <div class="bank-overlay-frame">
      <div class="bank-overlay-header">
        <div class="bank-overlay-title">Banco</div>
        <button class="bank-overlay-close" id="bankOverlayClose" aria-label="Cerrar">✕</button>
      </div>
      <div class="bank-overlay-body" id="bankOverlayBody"></div>
    </div>
  `;
  document.body.appendChild(bankOverlayEl);

  // Click en backdrop cierra
  bankOverlayEl.addEventListener('pointerup', (ev) => {
    if (ev.target === bankOverlayEl) closeBankOverlay();
  });
  // Botón ✕ cierra
  bankOverlayEl.querySelector('#bankOverlayClose')?.addEventListener('pointerup', (ev) => {
    if (ev.button !== undefined && ev.button !== 0) return;
    ev.preventDefault();
    ev.stopPropagation();
    closeBankOverlay();
  });

  return bankOverlayEl;
}

function openBankOverlay() {
  const overlay = ensureBankOverlay();
  const body = overlay.querySelector('#bankOverlayBody');
  const pane = document.querySelector('.osrs-tab-pane[data-tab="bank"]');

  if (!pane) {
    console.warn('[world] No se encontró .osrs-tab-pane[data-tab="bank"]. ¿bank.init() todavía no corrió?');
    return;
  }
  if (!body) {
    console.warn('[world] bankOverlayBody no encontrado.');
    return;
  }

  // Guardar referencias del padre original SOLO la primera vez (si el pane
  // ya está dentro del overlay, no machaqueamos).
  if (pane.parentElement !== body) {
    bankPaneOriginalParent = pane.parentElement;
    bankPaneOriginalNextSibling = pane.nextSibling;
    body.appendChild(pane);
  }

  // Asegurar pane visible (.active normalmente lo controla la lógica de tabs;
  // dentro del overlay forzamos display block)
  pane.classList.add('active');
  pane.style.display = 'block';

  overlay.classList.add('visible');
  console.log('[world] Banco overlay abierto.');
}

function closeBankOverlay() {
  if (!bankOverlayEl) return;
  bankOverlayEl.classList.remove('visible');

  // Mover el pane de vuelta al sidebar (su lugar original)
  const pane = document.querySelector('.osrs-tab-pane[data-tab="bank"]');
  if (pane && bankPaneOriginalParent) {
    pane.classList.remove('active');
    pane.style.display = '';
    if (bankPaneOriginalNextSibling && bankPaneOriginalNextSibling.parentElement === bankPaneOriginalParent) {
      bankPaneOriginalParent.insertBefore(pane, bankPaneOriginalNextSibling);
    } else {
      bankPaneOriginalParent.appendChild(pane);
    }
  }

  // Notificar al módulo del banco que se cierra (limpia drag a medias, etc.)
  try { bank.onClose?.(); } catch (e) { console.warn('[world] bank.onClose:', e); }
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
  // Sesión 27 fix — Bajado a 210px para no solaparse con el HUD lateral
  // (HP/Prayer/Run icons + minimap ocupan los primeros ~200px arriba-derecha).
  // z-index 30 (era 12) para que aparezca por encima de cualquier HUD.
  el.style.cssText = `position: absolute;
    top: calc(env(safe-area-inset-top, 0px) + 210px);
    left: 50%; transform: translateX(-50%); z-index: 30; pointer-events: none;
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
  // Sesión 27 fix — z-index 30 (era 25) para garantizar que aparece por
  // encima del HUD lateral en cualquier resolución.
  el.style.cssText = `position: absolute; top: 30%; left: 50%;
    transform: translate(-50%, -45%); z-index: 30; pointer-events: none;
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
    onLongPress: (cx, cy) => {
      // Sesión 27 Bloque 3 — long-press primero intenta peer (PVP);
      // si no impactó un peer, intenta NPC.
      if (multiplayer.openActionMenuAt(cx, cy)) return;
      npcRenderer.openActionMenuAt(cx, cy);
    },

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

    // Teclado: input.js gestiona WASD (movimiento) y flechas (cámara)
    // internamente, emitiendo a los callbacks de joystick y cameraDrag.
    // Esto deja onKey solo para teclas globales futuras (hotkeys de UI,
    // chat, etc.). Q/E retirados en Sesión 29 — se sustituyeron por
    // flechas izq/der.
    onKey: (key) => {
      // (vacío por ahora — espacio para hotkeys futuras)
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
  // Sesión 11c-2 — tap NPC primero, abre el menú Banco/GE.
  if (interiors.isActive()) {
    if (interiors.tryHandleNpcTap?.(clientX, clientY)) return;
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

  // Sesión 27 Bloque 3 — Tap PVP: ¿el tap impacta otro player?
  // Primero peers (PVP), después NPCs. Si el peer cae bajo el tap,
  // multiplayer maneja el auto-walk + engagePlayer.
  if (multiplayer.tryHandleTap(clientX, clientY)) return;

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
  // Sesión 11c-1 — skip clamp si interior activo (coords 10000,10000 exceden WORLD_HALF)
  if (!interiors.isActive()) {
    x = Math.max(-WORLD_HALF + 2, Math.min(WORLD_HALF - 2, x));
    z = Math.max(-WORLD_HALF + 2, Math.min(WORLD_HALF - 2, z));
  }
  playerTarget = { x, z };
  marker.position.set(x, 0.05, z);
  marker.scale.set(1, 1, 1);
  marker.material.opacity = 0.9;
  marker.visible = true;
  marker.userData.spawnTime = clock.getElapsedTime();
}

// Sesión 27 Bloque 3 — exponer setPlayerTarget como hook global para
// que multiplayer.js pueda hacer auto-walk al hacer tap en un peer
// sin tener que pasar callbacks (multiplayer.js no se inicializa con
// opts.setPlayerTarget directamente).
if (typeof window !== 'undefined') {
  window.__setPlayerTarget = setPlayerTarget;
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
  worldSnapshot.update(dt);   // Sesión 27 Bloque 1
  chat.update(dt);            // Sesión 29 — refrescar pos overhead bubbles
  groundItems.update(dt);
  interiors.update?.(dt);  // Sesión 11c-2 — tick del mixer del NPC del interior
  drawMinimap();
  updatePositionSave(dt);
  renderer.render(scene, camera);
}

function updatePositionSave(dt) {
  if (!authToken) return;
  if (interiors.isActive()) return; // no guardar coords del interior (10000,10000) al server
  positionSaveTimer += dt * 1000;

  // Sesión 20 — Si estoy en combate, guardar cada 500ms (no 10s) para
  // que el server tenga mi posición actualizada y pueda validar rango
  // correctamente. Sin esto, el server creía que estaba cerca cuando ya
  // me había alejado → "pegar desde lejos" bug.
  let inCombat = false;
  try { inCombat = !!combat.getStateSnapshot?.()?.currentTarget; } catch {}
  const saveInterval = inCombat ? 500 : POSITION_SAVE_INTERVAL;
  // Delta mínima también más permisiva en combate (0.5m vs 5m default)
  const minDelta = inCombat ? 0.5 : POSITION_SAVE_MIN_DELTA;

  if (positionSaveTimer < saveInterval) return;
  positionSaveTimer = 0;
  const dx = player.position.x - lastSavedX;
  const dz = player.position.z - lastSavedZ;
  if (dx * dx + dz * dz < minDelta * minDelta) return;
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

  // Sesión 26 — Run energy: si la energía se acaba, forzar walking aunque
  // el toggle esté activo. La velocidad efectiva se calcula AQUÍ.
  const effectiveRun = runMode && runEnergy > 0;
  const maxSpeed = effectiveRun ? PLAYER_RUN * PLAYER_RUN_BOOST : PLAYER_RUN;

  // Sesión 25 — Si el player está muerto, NO procesar input. El joystick
  // y el playerTarget se ignoran hasta que respawnee. Esto soluciona el bug
  // "te quedas tumbado y te puedes mover" — antes la animación de muerte
  // se reproducía pero el input seguía activo.
  if (character?.isDead) {
    // Forzar animación death para que no se vuelva a idle por algún tick
    // (character.play se hace abajo y respeta isDead, pero por si acaso).
    playerTarget = null;
    if (marker) marker.visible = false;
    return;
  }

  if (joyState.active && (Math.abs(joyState.x) > 0.15 || Math.abs(joyState.y) > 0.15)) {
    // User mueve con joystick → cancela cualquier auto-engage pendiente
    npcRenderer.cancelAutoEngage();
    multiplayer.cancelAutoEngage?.();   // Sesión 27 Bloque 3 — también peer
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

  // Sesión 11c-1 — skip clamp si estamos en el interior (coords 10000,10000
  // exceden WORLD_HALF=2048 y los clamps lo metían de vuelta dentro del mundo,
  // sacándolo del interior).
  if (!interiors.isActive()) {
    player.position.x = Math.max(-WORLD_HALF + 1, Math.min(WORLD_HALF - 1, player.position.x));
    player.position.z = Math.max(-WORLD_HALF + 1, Math.min(WORLD_HALF - 1, player.position.z));
  }

  if (character && character.loaded) {
    if (!isMoving) {
      character.play('idle');
    } else {
      // Sesión 13 — SFX de paso (audio.step() tiene throttle interno 220ms)
      try { audio.step(); } catch {}
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

  // Sesión 27 Bloque 3 — Auto-engage PVP (mismo patrón). Si hay un peer
  // marcado como pending tras tap/menú, le perseguimos hasta entrar en
  // rango y entonces multiplayer.tickAutoEngage llama a combat.engagePlayer.
  const aep = multiplayer.tickAutoEngage(player.position.x, player.position.z);
  if (aep) {
    if (aep.reached) {
      playerTarget = null;
      if (marker) marker.visible = false;
    } else if (aep.chasing) {
      if (playerTarget) {
        playerTarget.x = aep.targetX;
        playerTarget.z = aep.targetZ;
      }
      if (marker) marker.position.set(aep.targetX, 0.05, aep.targetZ);
    }
  }

  // Sesión 26 — Tick de Run energy.
  //   - Drena si efectivamente corriendo y el player se mueve.
  //   - Regenera siempre que no esté corriendo (incluso parado).
  //   - Si runEnergy llega a 0 mientras runMode=true, se desactiva el toggle.
  if (effectiveRun && isMoving) {
    runEnergy = Math.max(0, runEnergy - RUN_DRAIN_PER_SEC * dt);
    if (runEnergy <= 0 && runMode) {
      // Se acabó la energía: apagar toggle. El próximo frame ya irá a walk.
      runMode = false;
      if (hudStatRun) hudStatRun.classList.remove('active');
    }
  } else if (!runMode) {
    runEnergy = Math.min(100, runEnergy + RUN_RECOVERY_PER_SEC * dt);
  }
  // Update DOM solo si cambió el entero mostrado
  const newRunShown = Math.round(runEnergy);
  if (hudRunValue && newRunShown !== lastHudRunRendered) {
    hudRunValue.textContent = String(newRunShown);
    lastHudRunRendered = newRunShown;
  }
}

function updateCamera(dt) {
  // Sesión 11c-2 v4 — antes hardcodeaba pitch=0.3 y r=5 dentro del interior,
  // lo cual ignoraba cameraPitch del input → drag vertical no movía la cámara
  // visualmente aunque cameraPitch cambiase matemáticamente. AHORA el onEnter
  // de interiors ajusta cameraDist=5 y cameraPitch=0.55 una sola vez al entrar,
  // y respetamos cameraPitch normalmente para que drag vertical funcione.
  const r = cameraDist;
  const pitch = cameraPitch;
  const desiredX = player.position.x + Math.sin(cameraYaw) * Math.cos(pitch) * r;
  const desiredY = player.position.y + Math.sin(pitch) * r;
  const desiredZ = player.position.z + Math.cos(cameraYaw) * Math.cos(pitch) * r;
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
  // Sesión 20 — nombre y HP bar más arriba: antes 1.95m, ahora 2.55m
  const tagY = characterFallback ? 2.0 : 2.55;
  const v = new THREE.Vector3(player.position.x, player.position.y + tagY, player.position.z);
  v.project(camera);
  if (v.z > 1 || v.z < -1) {
    tag.style.display = 'none';
    const hpBar = document.getElementById('playerHpBar');
    if (hpBar) hpBar.style.display = 'none';
    return;
  }
  const sx = (v.x * 0.5 + 0.5) * window.innerWidth;
  const sy = (-v.y * 0.5 + 0.5) * window.innerHeight;

  // Sesión 19 — nombre + combat level estilo OSRS: "Username (lvl X)"
  if (user && tag.textContent !== undefined) {
    let cbLvl = null;
    try {
      // Preferir skills (single source of truth tras sesión 16)
      if (typeof skills !== 'undefined' && skills.getCombatLevel) {
        cbLvl = skills.getCombatLevel();
      }
    } catch {}
    const desired = cbLvl ? `${user.username} (lvl ${cbLvl})` : user.username;
    if (tag.textContent !== desired) tag.textContent = desired;
  }

  tag.style.display = 'block';
  tag.style.left = sx + 'px';
  tag.style.top = sy + 'px';

  // Sesión 19 — HP bar doble cara estilo OSRS sobre el player
  try { updatePlayerHpBar(sx, sy); } catch {}
}

// ============================================================
// Sesión 19 — HP bar doble cara estilo OSRS sobre el player
// ============================================================
// Verde (HP actual) + fondo rojo (HP perdido). Self-contained, NO depende
// de damage_splat para no romper si ese módulo no carga.

function ensurePlayerHpBar() {
  let bar = document.getElementById('playerHpBar');
  if (bar) return bar;
  if (!document.getElementById('player-hpbar-styles')) {
    const style = document.createElement('style');
    style.id = 'player-hpbar-styles';
    style.textContent = `
      .player-hpbar {
        position: absolute;
        z-index: 11;
        pointer-events: none;
        transform: translate(-50%, -100%);
        width: 60px;
        height: 7px;
        border: 1.5px solid #000;
        border-radius: 2px;
        box-shadow: 0 1px 3px rgba(0,0,0,0.7);
        background: #5a0e0e;
        overflow: hidden;
        display: none;
      }
      .player-hpbar-fill {
        height: 100%;
        background: linear-gradient(180deg, #4abc4a, #2e7a2e);
        transition: width 0.25s;
      }
      /* Sesión 20.1 — nametag más pequeño (override del CSS de index.html).
         El !important es necesario porque la regla original está en style.css. */
      #playerNameTag {
        font-size: 11px !important;
        padding: 2px 8px !important;
        letter-spacing: 0.02em !important;
        font-weight: 600 !important;
      }
    `;
    document.head.appendChild(style);
  }
  bar = document.createElement('div');
  bar.id = 'playerHpBar';
  bar.className = 'player-hpbar';
  bar.innerHTML = '<div class="player-hpbar-fill" style="width:100%"></div>';
  (document.getElementById('worldScreen') || document.body).appendChild(bar);
  return bar;
}

function updatePlayerHpBar(playerScreenX, playerScreenY) {
  const bar = ensurePlayerHpBar();
  let snap = null;
  try { snap = combat.getStateSnapshot?.(); } catch {}
  const hp = snap?.stats?.hp_current;
  const hpMax = snap?.stats?.hp_max;
  if (typeof hp !== 'number' || typeof hpMax !== 'number' || hpMax <= 0) {
    bar.style.display = 'none';
    return;
  }
  bar.style.display = 'flex';
  bar.style.left = playerScreenX + 'px';
  bar.style.top  = (playerScreenY - 16) + 'px';
  const pct = Math.max(0, Math.min(100, (hp / hpMax) * 100));
  const fill = bar.querySelector('.player-hpbar-fill');
  if (fill) fill.style.width = pct + '%';
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
    // Sesión 13 — Cambiar música ambient si cambia el bioma
    try {
      const biome = terrain.biomeAt(player.position.x, player.position.z);
      audio.musicForBiome(biome.id);
    } catch {}
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
