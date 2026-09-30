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
import * as spellbook from './spellbook.js';   // Sesión 41 — hechizos de combate
import * as groundItems from './ground_items.js';
import * as terrain from './terrain.js';
import * as mapRender from './map_render.js';   // Sesión 50 — minimapa/mapa nuevos
import * as bossFx from './boss_fx.js';         // Sesión 50 — jefes
import * as fosa from './fosa.js';              // Sesión 50 — Fosa de Guayota
import * as potions from './potions.js';        // Sesión 50 — pociones
import * as guancheVillage from './guanche_village.js';   // Sesión 50 — poblado guanche
import * as houses from './houses.js';                     // Sesión 50 — casas de jugador
import * as roadsRender from './roads_render.js';          // Sesión 50 — caminos y postes
import * as mounts from './mounts.js';                     // Sesión 50 — monturas
import * as trade from './trade.js';                       // Sesión 50 — comercio entre jugadores
import * as follow from './follow.js';                     // Sesión 50 — seguir a un jugador
import * as social from './social.js';                     // Sesión 50 — pestaña Amigos / Monturas
import { insideFosa } from './shared/fosa.js';
import { BOSSES } from './shared/bosses.js';
import * as buildings from './buildings.js';
import * as interiors from './interiors.js';
import * as bank from './bank.js';
import * as ge from './ge.js';
import * as audio from './audio.js';
import * as skills from './skills.js';
import * as highscores from './highscores.js';   // Sesión 42 — ranking / highscore
import * as equipment from './equipment.js';
import * as inventory from './inventory.js';
import * as shop from './shop.js';
import * as damageSplat from './damage_splat.js';
import * as combatProjectiles from './combat_projectiles.js';  // Sesión 34
import * as npcRenderer from './npc_renderer.js';
import * as worldSnapshot from './world_snapshot.js';   // Sesión 27 Bloque 1
// Sesión 31 — skills movidas a client/src/skills/. Mismo API, paths nuevos.
import * as woodcutting from './skills/woodcutting.js';
import * as mining from './skills/mining.js';   // Sesión 50 — minería
import * as fishing from './skills/fishing.js'; // Sesión 50 — pesca
import * as crafting from './skills/crafting.js'; // Sesión 50 — flechería/artesanía
import * as realtime from './realtime.js';        // Sesión 50 — WebSocket (PvP en vivo, menos peticiones)
import * as bankChests from './bank_chests.js';  // Sesión 50 — cofres de banco por el mapa
import * as townNpcs from './town_npcs.js';      // Sesión 50 — habitantes y diálogos
import * as tablets from './teleport_tablets.js'; // Sesión 50 — tabletas de teletransporte
import * as smithing from './skills/smithing.js';   // Sesión 50 — horno + yunque
import * as quests from './quests.js';   // Sesión 50 — misiones
import * as prayer from './prayer.js';   // Sesión 50 — plegaria
import * as skull from './skull.js';   // Sesión 50 — calavera PvP
import * as firemaking  from './skills/firemaking.js';
// Sesión 31 — extraído de world.js: setup de three.js + cámara orbital.
import * as sceneSetup    from './core/scene.js';
import * as cameraOrbital from './core/camera.js';
import * as combatHooks   from './core/combat_hooks.js';
import { getSkillIconHtml } from './item_icons.js';
import { openSkillGuide } from './skill_guides.js';   // Sesión 50 — libro por skill
import {
  PALETTE, PLACES, BIOMES,
  WORLD_HALF, WILDERNESS_X, FOG_NEAR, FOG_FAR,
  biomeAt, getRegionInfo,
} from './terrain.js';
import { NPC_MINIMAP_RADIUS } from './npc_renderer.js';

// ============================================================
// Sesión 38 (fix v3) — Tamaño del HUD lateral (sidebar) en DESKTOP.
// ============================================================
// Se inyecta desde JS — NO sólo desde style.css — porque el deploy venía
// aplicando los módulos JS pero a veces no el style.css.
//
// CLAVE: en vez de tocar tamaños elemento por elemento (lo que desproporcionaba
// los iconos respecto al marco), usamos ZOOM uniforme sobre TODO el sidebar.
// El layout mobile ya tiene buenas proporciones; el zoom lo agranda entero
// (marco + slots + iconos + texto) en la MISMA proporción. Resultado: se ve
// igual que en mobile pero más grande, sin nada desproporcionado.
//
// Factor 1.6 ≈ 20% menos que la versión anterior (que era ~2.0). Mobile
// (<=800px) NO se toca.
(function injectDesktopHubSizing() {
  if (typeof document === 'undefined') return;
  if (document.getElementById('desktop-hub-sizing')) return;
  const style = document.createElement('style');
  style.id = 'desktop-hub-sizing';
  style.textContent = `
    @media (min-width: 801px) {
      #osrsSidebar.osrs-sidebar {
        zoom: 1.6;
        bottom: 10px !important;
        right: 10px !important;
      }
    }
  `;
  document.head.appendChild(style);
})();

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
// Sesión 31 — combatTargetNpcId movido a core/combat_hooks.js.
// Se accede via combatHooks.getCombatTargetNpcId().
let user = null;
let running = false;
let canvas = null;

// Sesión 31 — cameraDist/Yaw/Pitch + savedDist/Pitch movidos a core/camera.js.
// Se accede via cameraOrbital.getYaw() / .onDrag() / .pushInteriorOverrides() etc.

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

  showWorldLoading('Cargando la isla…');

  try {
    // Sesión 31 — scene/camera/renderer/raycaster/canvas/ocean ahora salen
    // de core/scene.js. Las refs siguen siendo locales a world.js para no
    // tocar el resto del archivo.
    ({ scene, camera, renderer, raycaster, canvas } = sceneSetup.init({
      canvasId: 'worldCanvas',
      palette: PALETTE,
      fogNear: FOG_NEAR,
      fogFar:  FOG_FAR,
    }));
    ocean = sceneSetup.setupOcean({ scene, palette: PALETTE, worldHalf: WORLD_HALF });
    showWorldLoading('Cargando terreno…');
    await terrain.start({ scene });
    // Sesión 50 — que no crezcan árboles encima de las vetas de mineral.
    try { mining.registerKeepouts(terrain); } catch (e) { console.warn('[world] mining keepouts:', e); }
    try { fishing.registerKeepouts(terrain); } catch (e) { console.warn('[world] fishing keepouts:', e); }
    try { smithing.registerKeepouts(terrain); } catch (e) { console.warn('[world] smithing keepouts:', e); }
    try { prayer.registerKeepouts(terrain); } catch (e) { console.warn('[world] prayer keepouts:', e); }
    try { bankChests.registerKeepouts(terrain); } catch (e) { console.warn('[world] bank keepouts:', e); }
    try { townNpcs.registerKeepouts(terrain); } catch (e) { console.warn('[world] npc keepouts:', e); }
    try { fosa.registerKeepouts(terrain); } catch {}
    try { guancheVillage.registerKeepouts(terrain); } catch {}
    try { houses.registerKeepouts(terrain); } catch {}
    // Sesión 50 — guaridas de jefes sin árboles
    try { for (const b of Object.values(BOSSES)) { terrain.addKeepout?.(b.x, b.z, b.lairR + 2); terrain.clearTreesNear?.(b.x, b.z, b.lairR + 2); } } catch {}
    // Sesión 11a — buildings (GLB del edificio + 3 instancias decorativas)
    // Sesión 11b parcial — camera/canvas/feedLog para tap + colisión sólida
    // Sesión 11c-1 — onTapBuilding dispara interiors.enter()
    // Sesión 36 (B-019 parcial) — gate de distancia. Antes el tap entraba al
    // interior desde cualquier punto del mapa (raycast→callback sin validar
    // proximidad). Ahora pedimos que el player esté a ≤BUILDING_ENTRY_RANGE_M
    // del anchor del edificio. Si no, feedLog "acércate" y no entra.
    // Iter 1: 1.0m → muy estricto, no entraba parado en la puerta (el anchor
    // del edificio queda en el centro del footprint, la puerta está a ~2-3m
    // del centro, queda fuera del radio).
    // Iter 2: 7.0m → suficiente para entrar parado en la puerta, sigue
    // bloqueando entradas "desde lejos en el medio del mapa".
    // Iter 3: 10.0m (Nico pidió +3m al iter 2) → margen cómodo para entrar
    // sin tener que estar pegado a la puerta exacta. Si se siente demasiado
    // generoso (entrás desde afuera del footprint visual), bajar.
    showWorldLoading('Cargando edificios…');
    const BUILDING_ENTRY_RANGE_M = 10.0;
    await buildings.start({
      scene, camera, canvas,
      feedLog: (type, msg) => combat.feedLog?.(type, msg),
      onTapBuilding: (id, buildingPos) => {
        // Gate de distancia. Si buildingPos no llegó (versión vieja del
        // buildings.js o caso raro), fail-open y entra igual — preserva
        // comportamiento pre-S36 antes que romper.
        if (buildingPos) {
          const dx = player.position.x - buildingPos.x;
          const dz = player.position.z - buildingPos.z;
          const dist = Math.sqrt(dx * dx + dz * dz);
          if (dist > BUILDING_ENTRY_RANGE_M) {
            try { combat.feedLog?.('warning', 'Acércate al edificio para entrar.'); } catch {}
            return;
          }
        }
        interiors.enter(id);
      },
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
        // exterior (typical 7-10m con pitch hasta 1.3) se sitúa a sin(1.3)*10=9.6m
        // sobre el player — POR ENCIMA del techo de 8m. Fix: ajustar a valores
        // que quepan en la sala. Sesión 31 — delegado a core/camera.js.
        // Sesión 36 — ajuste de ángulo: antes era { dist: 5, pitch: 0.55 } que
        // daba ángulo cinematográfico de lado (sin(0.55)*5 = 2.6m sobre player).
        // Iter 1 (rechazada por Nico): dist=7, pitch=0.95 — quedó muy cerca.
        // Iter 2 (rechazada por Nico): dist=10, pitch=0.85 — sigue cerca y muy
        // top-down. La foto que Nico pidió matchear se ve con la cámara MUCHO
        // más atrás y con pitch más shallow (se ven las caras frontales de
        // mesas/sillas, no solo el techo de las cosas).
        // Iter 3: dist=14, pitch=0.55 — EXACTAMENTE los valores default de la
        // cámara exterior. Ventaja: el user mantiene la misma perspectiva
        // OSRS-style al entrar a un interior. Y=sin(0.55)*14=7.3m (margen
        // 0.7m bajo el techo de 8m). Si Nico arrastra la cámara mucho hacia
        // arriba (pitch→1.3), va a clipar el techo, pero la geometría
        // probablemente es one-sided (visible desde dentro, invisible desde
        // afuera/arriba), así que no debería verse "agujereado".
        cameraOrbital.pushInteriorOverrides(buildingId === 'house' ? { dist: 11, pitch: 0.8 } : { dist: 14, pitch: 0.55 });
        // Forzar refresh del label de región tras salir/entrar
        lastRegionName = '';
        const el = document.getElementById('worldRegion');
        if (el) { el.textContent = buildingId === 'house' ? '🏠 Tu casa' : 'Interior'; el.style.opacity = '1'; }
        // Sesión 13 — SFX puerta al entrar; pausar música ambient
        try { audio.sfx('door_open'); audio.music(null); } catch {}
      },
      onLeave: () => {
        // Sesión 11c-1 — restaurar cámara exterior (Sesión 31: via core/camera.js).
        cameraOrbital.popInteriorOverrides();
        try { terrain.primeChunks(player.position.x, player.position.z); } catch {}
        lastRegionName = '';
        playerTarget = null;
        if (marker) marker.visible = false;
        // Sesión 13 — SFX puerta cierre + restaurar música del bioma actual.
        // Sesión 36 — Si el user muteó la música (botón 🔇), NO la re-arrancamos
        // al salir. Antes musicForBiome creaba un Audio nuevo y lo reproducía
        // (a volumen 0 por prefs, pero en iOS el efecto puede ser jittery
        // y/o un re-load de la mp3). Si el user quiere música, que toque el
        // botón de unmute — al desmutear, audio.js hace musicAudio.play()
        // resumiendo desde donde estaba.
        try {
          audio.sfx('door_close');
          if (!audio.isMuted?.()) {
            const biome = terrain.biomeAt(player.position.x, player.position.z);
            audio.musicForBiome(biome.id);
          }
        } catch {}
      },
    });
    await setupPlayer();
    // Sesión 31 — cámara orbital ahora vive en core/camera.js. Init después
    // de setupPlayer para tener el getter al player listo.
    cameraOrbital.init({
      threeCamera: camera,
      getPlayer:   () => player,
      isCharacterFallback: () => characterFallback,
      distMin: CAMERA_DIST_MIN,
      distMax: CAMERA_DIST_MAX,
    });
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

    // Sesión 41 — spellbook (hechizos de combate en el tab Magia). Lee maná y
    // nivel de Magia del snapshot (me block).
    spellbook.start({
      feedLog: (type, msg) => combat.feedLog?.(type, msg),
      onAutocastChange: () => { try { combat.refreshCombatTab?.(); } catch {} },
      getMagicLevel: () => {
        try {
          const me = worldSnapshot.getMe?.();
          return me ? skills.xpToLevel(me.magic_xp || 0) : 1;
        } catch { return 1; }
      },
      getMana: () => {
        try {
          const me = worldSnapshot.getMe?.();
          if (!me) return { current: 0, max: 20 };
          // Sesión 41 — pool = 20 base + 100 si hay staff equipado. Mostramos
          // el maná REGENERANDO en vivo (raw del server + tiempo transcurrido)
          // para que en el HUD se vea subir, no solo al castear.
          const hasStaff = (() => { try { return equipment.getWeaponType?.() === 'staff'; } catch { return false; } })();
          const max = 20 + (hasStaff ? 100 : 0);
          const rate = hasStaff ? 1.0 : 0.2;   // maná/seg (1.0 = 10 cada 10s)
          const raw = me.mana_current || 0;
          const updatedAt = me.mana_updated_at || 0;
          const now = worldSnapshot.getServerNow?.() || Date.now();
          let current;
          if (!updatedAt) {
            current = max;   // nunca casteó → pozo lleno
          } else {
            const elapsed = Math.max(0, (now - updatedAt) / 1000);
            current = Math.min(max, Math.floor(raw + elapsed * rate));
          }
          return { current, max };
        } catch { return { current: 0, max: 20 }; }
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
      // Sesion 45 — + quiver (carcaj). Reusa la misma maquinaria de armor
      // (attachArmor/detachArmor); character.js resuelve el GLB de nombre fijo.
      const ARMOR_SLOTS = ['body', 'shield', 'helm', 'cape', 'quiver', 'legs', 'boots', 'gloves'];   // S50: + legs/boots/gloves (procedurales)
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

    // Sesión 31 — registrar combat hooks (antes vivían inline). Después de
    // equipment.init para que getWeaponType() ya pueda leer.
    combatHooks.register({
      getCharacter:  () => character,
      getWeaponType: () => {
        try { return equipment.getWeaponType?.() || 'unarmed'; }
        catch { return 'unarmed'; }
      },
      onRespawn: () => {
        if (!player) return;
        player.position.x = 0;
        player.position.z = 0;
        playerTarget = null;
        if (marker) marker.visible = false;
        try { terrain.primeChunks(0, 0); } catch {}
      },
    });

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
      window.__spawnPlayerSplat = (damage, hit) => {
        try { mounts.onAttacked(hit ? (damage || 0) : 0); } catch {}   // Sesión 50 — te atacan: 10 s sin montar; si te dan, al suelo
        return damageSplat.spawnPlayerDamageSplat(damage, hit);
      };
      window.__spawnLevelUpBanner = (skillId, newLevel) => damageSplat.spawnLevelUpBanner(skillId, newLevel);
      // Sesión 32 — exponer feedLog para que world_snapshot mande mensajes
      // "X te pega Y HP" cuando detecta hits vía snapshot (caso PvP donde
      // el atacante inicia sin que vos estés atacando).
      window.__feedLog = (type, text) => {
        try { combat.feedLog(type, text); } catch {}
      };
      // Sesión 32 — exponer playHitReaction para que world_snapshot dispare
      // la anim cuando detecta un hit recibido.
      window.__playerReact = () => {
        try {
          if (window.__combatDebugOn) console.log('%c[combat-dbg]', 'color:#e0a030', 'HIT recibido → react');
          character?.playHitReaction?.();
        } catch {}
      };
      // Sesión 32 — exponer audio.sfx para que cualquier módulo pueda
      // disparar SFX sin import circular (world_snapshot, multiplayer, etc).
      window.__playSfx = (name, opts) => {
        try { audio.sfx(name, opts); } catch {}
      };
      // Sesión 49 — exponer la anim de gathering (kneel/woodcut) para que el
      // inventario la dispare por pieza al "Cocinar todo" (encadenado OSRS).
      window.__playerGather = (animKey, ms) => {
        try { if (mounts.isMounted()) mounts.dismount('Te bajas de la montura para trabajar.'); } catch {}
        try { character?.playGather?.(animKey || 'kneel', ms || 1000); } catch {}
      };
      // Level up banner también vía skills.onLevelUp (cubre grants vía API directa)
      skills.onLevelUp((evt) => {
        try { damageSplat.spawnLevelUpBanner(evt.skillId, evt.newLevel); } catch {}
      });
    } catch (e) { console.warn('[world] damage_splat start:', e); }

    // Sesión 34 — Combat projectiles (stub ranged hoy, real próxima sesión).
    // Expone window.__worldFireProjectile(fromVec3, toVec3, opts) para que
    // combat.js lo dispare tras recibir respuesta del server con arrow_consumed.
    try {
      combatProjectiles.start({ scene });
      window.__worldFireProjectile = (from, to, opts) => {
        try { combatProjectiles.fireProjectile(from, to, opts); } catch {}
      };
    } catch (e) { console.warn('[world] combat_projectiles start:', e); }

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
    // Sesión 50 — canal en tiempo real. Debug: window.__rt()
    try {
      realtime.start({
        apiBase: API_BASE,
        getToken: () => authToken,
        getPlayer: () => player,
        isInCombat: () => worldSnapshot.isInCombat?.(),
      });
    } catch (e) { console.warn('[world] realtime start:', e); }

    // Sesión 30 — Woodcutting + Firemaking
    // Verificar en Eruda: window.__wcDebug(), window.__fmDebug()
    try {
      woodcutting.start({
        getPlayer:      () => player,
        getAuthToken:   () => authToken,
        getCharacter:   () => character,
        getTerrain:     () => terrain,
        setPlayerTarget:(x, z) => setPlayerTarget(x, z),
        feedLog:        (type, msg) => combat.feedLog?.(type, msg),
        getSnapshot:    () => worldSnapshot.getSnapshot(),
      });
    } catch (e) { console.warn('[world] woodcutting start:', e); }
    // Sesión 50 — Minería (vetas + loop). Debug: window.__miningDebug()
    try {
      mining.start({
        scene,
        getPlayer:       () => player,
        getCharacter:    () => character,
        setPlayerTarget: (x, z) => setPlayerTarget(x, z),
        feedLog:         (type, msg) => combat.feedLog?.(type, msg),
        getSnapshot:     () => worldSnapshot.getSnapshot(),
      });
    } catch (e) { console.warn('[world] mining start:', e); }
    // Sesión 50 — Pesca (estanques + bancos). Debug: window.__fishingDebug()
    try {
      fishing.start({
        scene,
        getPlayer:       () => player,
        getCharacter:    () => character,
        setPlayerTarget: (x, z) => setPlayerTarget(x, z),
        feedLog:         (type, msg) => combat.feedLog?.(type, msg),
      });
    } catch (e) { console.warn('[world] fishing start:', e); }
    try {
      crafting.start({ feedLog: (type, msg) => combat.feedLog?.(type, msg), getCharacter: () => character });
    } catch (e) { console.warn('[world] crafting start:', e); }
    // Sesión 50 — Horno + yunque. Debug: window.__smithingDebug()
    try {
      smithing.start({
        scene,
        getPlayer:       () => player,
        getCharacter:    () => character,
        setPlayerTarget: (x, z) => setPlayerTarget(x, z),
        feedLog:         (type, msg) => combat.feedLog?.(type, msg),
      });
    } catch (e) { console.warn('[world] smithing start:', e); }
    // Sesión 50 — Plegaria (pestaña, orbe del HUD, altares). Debug: window.__prayer.state()
    try {
      prayer.start({
        scene,
        getPlayer:       () => player,
        getCharacter:    () => character,
        getSnapshot:     () => worldSnapshot.getSnapshot(),
        setPlayerTarget: (x, z) => setPlayerTarget(x, z),
        feedLog:         (type, msg) => combat.feedLog?.(type, msg),
      });
    } catch (e) { console.warn('[world] prayer start:', e); }
    // Sesión 50 — Jefes: rocas, avisos, barra de vida
    try {
      bossFx.start({
        scene,
        getPlayer:   () => player,
        getSnapshot: () => worldSnapshot.getSnapshot(),
        feedLog:     (type, msg) => combat.feedLog?.(type, msg),
        getPeerPos:  (uid) => multiplayer.getPeerVisualPosition?.(uid),
      });
    } catch (e) { console.warn('[world] boss fx start:', e); }
    // Sesión 50 — Cofres de banco por el mapa
    try {
      bankChests.start({
        scene,
        getPlayer:       () => player,
        setPlayerTarget: (x, z) => setPlayerTarget(x, z),
        feedLog:         (type, msg) => combat.feedLog?.(type, msg),
        onOpenBank: () => {
          try { bank.onOpen?.(); } catch (e) { console.warn('[world] bank.onOpen:', e); }
          try { audio.sfx('coins'); } catch {}
          openBankOverlay();
        },
      });
    } catch (e) { console.warn('[world] bank chests start:', e); }
    // Sesión 50 — Habitantes con diálogos y misiones. Debug: window.__townNpcs()
    try {
      townNpcs.start({
        scene,
        getPlayer:       () => player,
        setPlayerTarget: (x, z) => setPlayerTarget(x, z),
        feedLog:         (type, msg) => combat.feedLog?.(type, msg),
        onOpenBank: () => {
          try { bank.onOpen?.(); } catch (e) { console.warn('[world] bank.onOpen:', e); }
          try { audio.sfx('coins'); } catch {}
          openBankOverlay();
        },
        onOpenGE: () => { try { audio.sfx('book_open'); } catch {} try { ge.openOverlay?.(); } catch (e) { console.warn('[world] ge:', e); } },
        onOpenShop: (shopId) => {
          try { audio.sfx('coins'); } catch {}
          try { shop.open(shopId); } catch (e) { console.warn('[world] shop.open:', e); }
        },
      });
    } catch (e) { console.warn('[world] town npcs start:', e); }
    // Sesión 50 — tabletas de teletransporte (se rompen desde la mochila)
    try {
      tablets.start({
        scene,
        getPlayer: () => player,
        feedLog:   (type, msg) => combat.feedLog?.(type, msg),
        onBeforeTeleport: () => {
          try { window.__playerExitCombat?.(); } catch {}
          try { npcRenderer.cancelAutoEngage?.(); } catch {}
          try { multiplayer.cancelAutoEngage?.(); } catch {}
          try { mining.stopMining?.('teleport'); } catch {}
          try { fishing.stopFishing?.('teleport'); } catch {}
          try { woodcutting.stopChop?.('teleport'); } catch {}
          try { smithing.stopWork?.('teleport'); } catch {}
          try { crafting.stopWork?.('teleport'); } catch {}
          playerTarget = null;
        },
        onTeleported: () => {
          try { if (interiors.isActive()) interiors.forceLeave(); } catch {}
          try { terrain.primeChunks(player.position.x, player.position.z); } catch {}
          playerTarget = null;
        },
      });
    } catch (e) { console.warn('[world] tablets start:', e); }
    try { guancheVillage.start({ scene }); } catch (e) { console.warn('[world] poblado:', e); }
    try { roadsRender.start({ scene, biomeAt: terrain.biomeAt }); } catch (e) { console.warn('[world] caminos:', e); }
    // Sesión 50 — castillos y casas de jugador
    const openBankHere = () => {
      try { bank.onOpen?.(); } catch (e) { console.warn('[world] bank.onOpen:', e); }
      try { audio.sfx('coins'); } catch {}
      openBankOverlay();
    };
    try {
      houses.start({
        scene, camera, canvas,
        getPlayer: () => player,
        setPlayerTarget: (x, z) => setPlayerTarget(x, z),
        feedLog: (type, msg) => combat.feedLog?.(type, msg),
        onOpenBank: openBankHere,
      });
    } catch (e) { console.warn('[world] houses start:', e); }
    try {
      mounts.start({
        scene,
        getPlayer: () => player,
        feedLog: (type, msg) => combat.feedLog?.(type, msg),
        findLanding: (x, z) => findLandingSpot(x, z),
        canMountHere: () => {
          if (interiors.isActive()) return 'No puedes montar dentro de un edificio.';
          if (character?.isDead) return 'No puedes montar ahora.';
          if (player && insideFosa(player.position.x, player.position.z, 2)) return 'No puedes montar en la Fosa.';
          let inCombat = false;
          try { inCombat = !!combat.getStateSnapshot?.()?.currentTarget || combatHooks.getCombatTargetNpcId() !== null; } catch {}
          if (inCombat) return 'No puedes montar en pleno combate.';
          return null;
        },
      });
    } catch (e) { console.warn('[world] mounts start:', e); }
    try {
      const fl = (type, msg) => combat.feedLog?.(type, msg);
      trade.start({ userId: user?.id, feedLog: fl, onInventoryChanged: () => { try { inventory.refresh(); } catch {} } });
      follow.start({ getPlayer: () => player, setPlayerTarget: (x, z) => setPlayerTarget(x, z), getPeers: () => multiplayer.getPeerPositions(), feedLog: fl });
      social.start({
        getPlayer: () => player, getPeers: () => multiplayer.getPeerPositions(), feedLog: fl,
        onFollow: (id, name) => follow.follow(id, name),
        onTrade: (id, name) => trade.requestTrade(id, name),
      });
    } catch (e) { console.warn('[world] trade/follow/social:', e); }
    try { potions.start({ getSnapshot: () => worldSnapshot.getSnapshot(), feedLog: (type, msg) => combat.feedLog?.(type, msg) }); } catch (e) { console.warn('[world] potions start:', e); }
    // Sesión 50 — La Fosa de Guayota (oleadas)
    try {
      fosa.start({
        scene,
        getPlayer:   () => player,
        getSnapshot: () => worldSnapshot.getSnapshot(),
        feedLog:     (type, msg) => combat.feedLog?.(type, msg),
        onTeleported: () => {
          try { window.__playerExitCombat?.(); } catch {}
          try { npcRenderer.cancelAutoEngage?.(); } catch {}
          try { terrain.primeChunks(player.position.x, player.position.z); } catch {}
          playerTarget = null;
        },
      });
    } catch (e) { console.warn('[world] fosa start:', e); }
    // Sesión 50 — Calavera PvP sobre la cabeza.
    try {
      skull.start({
        getSnapshot: () => worldSnapshot.getSnapshot(),
        getOverheadPrayer: () => prayer.getOverheadPrayer?.(),
        getPlayer:   () => player,
        getCamera:   () => camera,
        feedLog:     (type, msg) => combat.feedLog?.(type, msg),
      });
    } catch (e) { console.warn('[world] skull start:', e); }
    // Sesión 50 — Misiones (tutorial). Debug: window.__questsDebug()
    try {
      quests.start({
        scene,
        getPlayer:   () => player,
        getSnapshot: () => worldSnapshot.getSnapshot(),
        feedLog:     (type, msg) => combat.feedLog?.(type, msg),
      });
    } catch (e) { console.warn('[world] quests start:', e); }
    try {
      firemaking.start({
        scene,
        getPlayer:    () => player,
        getCharacter: () => character,
        getSnapshot:  () => worldSnapshot.getSnapshot(),
        feedLog:      (type, msg) => combat.feedLog?.(type, msg),
      });
    } catch (e) { console.warn('[world] firemaking start:', e); }

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
  try { realtime.stop(); } catch {}
  try { bankChests.stop(); } catch {}
  try { townNpcs.stop(); } catch {}

  // Sesión 29 — chat cleanup (quita root DOM + bubbles + polling)
  try { chat.stop(); } catch {}

  // Sesión 30 — woodcutting + firemaking cleanup
  try { woodcutting.stop(); } catch {}
  try { mining.stop(); } catch {}
  try { fishing.stop(); } catch {}
  try { crafting.stop(); } catch {}
  try { smithing.stop(); } catch {}
  try { quests.stop(); } catch {}
  try { prayer.stop(); } catch {}
  try { skull.stop(); } catch {}
  try { firemaking.stop(); } catch {}

  // Sesión 3 refactor — detener multiplayer (limpia peers, name tags, timers)
  multiplayer.stop();

  // Sesión 4 refactor — detener home_teleport (quita botón, clear interval)
  homeTele.stop();
  try { spellbook.stop(); } catch {}

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

  try { bossFx.stop(); } catch {}
  try { fosa.stop(); } catch {}
  try { guancheVillage.stop(); } catch {}
  try { roadsRender.stop(); } catch {}
  try { houses.stop(); } catch {}
  try { mounts.stop(); } catch {}
  try { trade.stop(); social.stop(); follow.stop(true); } catch {}
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
// Sesión 31 — setupScene() y setupOcean() movidos a core/scene.js.
// Llamados desde startWorld() directamente.

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
// Sesión 31 — TODO el bloque movido a core/combat_hooks.js. Se registra desde
// startWorld() después de equipment.init() vía combatHooks.register(...).
// combatTargetNpcId también vive ahora ahí; se accede con
// combatHooks.getCombatTargetNpcId().



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
    const RANGE = mmRange();
    const scale = (W / 2) / RANGE;
    const dx = (cx - W / 2) / scale;
    const dz = (cy - H / 2) / scale;
    const tx = player.position.x + dx;
    const tz = player.position.z + dz;
    setPlayerTarget(tx, tz);
  });

  try { setupMinimapZoomButtons(); } catch (e) { console.warn('[world] mm zoom:', e); }

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

// Sesión 50 — Minimapa nuevo: vista local (≈110 m) con el terreno pintado
// (biomas suaves, agua, plazas), árboles como en OSRS, iconos y zoom.
const MM_ZOOMS = [55, 110, 220, 450];
let mmZoomIdx = 1;
let mmTex = null;          // { canvas, x0, z0, mpp, range }
function mmRange() { return MM_ZOOMS[mmZoomIdx]; }
function ensureMinimapTexture(px, pz, range) {
  if (mmTex && mmTex.range === range) {
    const cxm = mmTex.x0 + mmTex.size * mmTex.mpp / 2, czm = mmTex.z0 + mmTex.size * mmTex.mpp / 2;
    if (Math.abs(px - cxm) < range * 0.35 && Math.abs(pz - czm) < range * 0.35) return mmTex;
  }
  const mpp = range / 70;
  const size = 196;
  const half = size * mpp / 2;
  const x0 = px - half, z0 = pz - half;
  mmTex = { canvas: mapRender.renderRegion(x0, z0, size, size, mpp), x0, z0, mpp, size, range };
  return mmTex;
}

function drawMinimap() {
  if (!minimapCtx || !player) return;
  if (interiors.isActive()) {
    drawMinimapInterior();
    return;
  }
  // Nitidez en pantallas retina: resolución interna = tamaño CSS × DPR
  const dpr = Math.min(3, window.devicePixelRatio || 1);
  const cssW = minimapCanvas.clientWidth || 130;
  if (minimapCanvas.width !== Math.round(cssW * dpr)) {
    minimapCanvas.width = Math.round(cssW * dpr);
    minimapCanvas.height = Math.round(cssW * dpr);
  }
  const ctx = minimapCtx;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const W = cssW, H = cssW;
  const RANGE = mmRange();
  const cx = W / 2, cy = H / 2;
  const scale = (W / 2) / RANGE;
  const px = player.position.x;
  const pz = player.position.z;

  ctx.clearRect(0, 0, W, H);
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, W / 2 - 1, 0, Math.PI * 2);
  ctx.clip();

  // Terreno
  const tex = ensureMinimapTexture(px, pz, RANGE);
  ctx.imageSmoothingEnabled = true;
  const tScale = tex.mpp * scale;   // px de pantalla por px de textura
  ctx.drawImage(tex.canvas, cx + (tex.x0 - px) * scale, cy + (tex.z0 - pz) * scale, tex.size * tScale, tex.size * tScale);

  const RANGE_SQ = RANGE * RANGE * 1.1;
  const inView = (x, z) => { const dx = x - px, dz = z - pz; return dx * dx + dz * dz <= RANGE_SQ; };
  const S = (x, z) => [cx + (x - px) * scale, cy + (z - pz) * scale];

  // Árboles (bolitas verdes con brillo, como en OSRS)
  const tr = Math.max(1.1, 1.4 * scale);
  for (const m of terrain.getInteractableMeshes()) {
    const list = m.userData?.trees;
    if (!list || m.userData?.kind !== 'tree-trunk') continue;
    const bush = /bush/.test(m.userData.typeId || '');
    const dead = m.userData.typeId === 'dead';
    for (const t of list) {
      if (!inView(t.x, t.z)) continue;
      const [sx, sy] = S(t.x, t.z);
      const r = bush ? tr * 0.7 : tr;
      ctx.beginPath(); ctx.arc(sx, sy, r, 0, Math.PI * 2);
      ctx.fillStyle = dead ? '#5a4030' : (bush ? '#3f6a28' : '#23461a'); ctx.fill();
      if (r > 1.5) {
        ctx.beginPath(); ctx.arc(sx - r * 0.3, sy - r * 0.3, r * 0.45, 0, Math.PI * 2);
        ctx.fillStyle = dead ? '#7a5a40' : '#4f8a34'; ctx.fill();
      }
    }
  }

  // Vetas de mineral
  try {
    for (const v of mining.getLoadedVeins()) {
      if (!inView(v.x, v.z)) continue;
      const [sx, sy] = S(v.x, v.z);
      ctx.fillStyle = '#3a3a3a'; ctx.fillRect(sx - 2.2, sy - 2.2, 4.4, 4.4);
      ctx.fillStyle = v.depleted ? '#777' : v.color; ctx.fillRect(sx - 1.3, sy - 1.3, 2.6, 2.6);
    }
  } catch {}

  const IR = 5.2;   // radio de los iconos
  try {
    for (const sp of fishing.getSpotsForMinimap()) {
      if (!inView(sp.x, sp.z)) continue;
      const [sx, sy] = S(sp.x, sp.z);
      mapRender.drawIcon(ctx, 'fish', sx, sy, IR * 0.8);
    }
    for (const b of bankChests.getBanksForMinimap()) {
      if (!inView(b.x, b.z)) continue;
      const [sx, sy] = S(b.x, b.z);
      mapRender.drawIcon(ctx, 'bank', sx, sy, IR);
    }
    for (const m of houses.getMapIcons()) {   // Sesión 50
      if (!inView(m.x, m.z)) continue;
      const [sx, sy] = S(m.x, m.z);
      mapRender.drawIcon(ctx, m.kind, sx, sy, IR * 1.1);
    }
    for (const st of smithing.getStationsForMinimap()) {
      if (!inView(st.x, st.z)) continue;
      const [sx, sy] = S(st.x, st.z);
      mapRender.drawIcon(ctx, st.kind === 'furnace' ? 'furnace' : 'anvil', sx, sy, IR);
    }
    for (const a of prayer.getAltarsForMinimap()) {
      if (!inView(a.x, a.z)) continue;
      const [sx, sy] = S(a.x, a.z);
      mapRender.drawIcon(ctx, 'altar', sx, sy, IR);
    }
  } catch {}

  // NPCs (amarillo en la wilderness, blanco fuera) — como OSRS
  const NPC_RAD_SQ = Math.min(RANGE_SQ, NPC_MINIMAP_RADIUS * NPC_MINIMAP_RADIUS);
  for (const npc of npcRenderer.getNpcDataList()) {
    const dx = npc.x - px, dz = npc.z - pz;
    if (dx * dx + dz * dz > NPC_RAD_SQ) continue;
    const [sx, sy] = S(npc.x, npc.z);
    ctx.beginPath(); ctx.arc(sx, sy, 1.9, 0, Math.PI * 2);
    ctx.fillStyle = (npc.x < WILDERNESS_X) ? '#ffd040' : '#ffff60'; ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.8)'; ctx.lineWidth = 0.7; ctx.stroke();
  }
  // Habitantes: punto amarillo / "!" / "?"
  try {
    for (const m of townNpcs.getMinimapMarks()) {
      if (!inView(m.x, m.z)) continue;
      const [mx, my] = S(m.x, m.z);
      if (m.mark === 'offer' || m.mark === 'turnin') mapRender.drawIcon(ctx, 'quest', mx, my, 4.2, { mark: m.mark });
      else {
        ctx.beginPath(); ctx.arc(mx, my, 1.9, 0, Math.PI * 2);
        ctx.fillStyle = m.mark === 'doing' ? '#d0d0d0' : '#ffff40'; ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.8)'; ctx.lineWidth = 0.7; ctx.stroke();
      }
    }
  } catch {}

  // Otros jugadores: blanco (verde si es de tu grupo)
  const myPartyId = party.getMyPartyId();
  for (const peer of multiplayer.getPeerPositions()) {
    if (!inView(peer.x, peer.z)) continue;
    const [sx, sy] = S(peer.x, peer.z);
    const sameParty = myPartyId != null && peer.party_id === myPartyId;
    ctx.beginPath(); ctx.arc(sx, sy, 2.6, 0, Math.PI * 2);
    ctx.fillStyle = sameParty ? '#4adc4a' : '#ffffff'; ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.9)'; ctx.lineWidth = 1; ctx.stroke();
  }

  // Jefes + Fosa de Guayota
  for (const b of bossFx.getBossesForMap()) {
    if (!inView(b.x, b.z)) continue;
    const [sx, sy] = S(b.x, b.z);
    mapRender.drawIcon(ctx, 'boss', sx, sy, 5.5);
  }
  { const fz = fosa.getForMap(); if (inView(fz.x, fz.z)) { const [sx, sy] = S(fz.x, fz.z); mapRender.drawIcon(ctx, 'minigame', sx, sy, 6); } }

  // Lugares (icono + nombre)
  for (const p of PLACES) {
    const [sx, sy] = S(p.x, p.z);
    if (sx < -20 || sx > W + 20 || sy < -20 || sy > H + 20) continue;
    mapRender.drawIcon(ctx, mapRender.placeIconKind(p), sx, sy, 6, { color: '#' + (p.color >>> 0).toString(16).padStart(6, '0') });
    mapRender.label(ctx, p.name, sx, sy + 12, 9, '#fff8d0', true);
  }

  // Objetivo de la misión: rombo dorado (pegado al borde si está lejos)
  try {
    const h = quests.getHintPos();
    if (h) {
      let dx = (h.x - px) * scale, dz = (h.z - pz) * scale;
      const lim = Math.min(W, H) / 2 - 7;
      const d = Math.hypot(dx, dz);
      if (d > lim) { dx = dx / d * lim; dz = dz / d * lim; }
      const hx = cx + dx, hy = cy + dz;
      ctx.fillStyle = '#ffd35a';
      ctx.strokeStyle = '#000'; ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(hx, hy - 5); ctx.lineTo(hx + 4, hy); ctx.lineTo(hx, hy + 5); ctx.lineTo(hx - 4, hy); ctx.closePath();
      ctx.fill(); ctx.stroke();
    }
  } catch {}

  // Viñeta suave en el borde
  const vg = ctx.createRadialGradient(cx, cy, W * 0.36, cx, cy, W / 2);
  vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.35)');
  ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);
  ctx.restore();

  // Tú: flecha blanca
  mapRender.drawPlayerArrow(ctx, cx, cy, player.rotation.y, 5.5);

  // Aro dorado + brújula
  ctx.beginPath(); ctx.arc(cx, cy, W / 2 - 1, 0, Math.PI * 2);
  ctx.lineWidth = 2; ctx.strokeStyle = '#8a6a30'; ctx.stroke();
  mapRender.label(ctx, 'N', cx, 9, 11, '#ff5040', true);
  // Zoom actual
  ctx.save();
  ctx.font = 'bold 8px sans-serif'; ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(255,240,200,0.85)';
  ctx.fillText(`${RANGE * 2} m`, cx, H - 6);
  ctx.restore();
}

function setupMinimapZoomButtons() {
  if (document.getElementById('mmZoomIn')) return;
  const host = minimapCanvas?.parentElement;
  if (!host) return;
  if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
  const css = document.createElement('style');
  css.textContent = `.mm-zoom{position:absolute;width:22px;height:22px;border-radius:50%;border:1.5px solid #8a6a30;
    background:rgba(30,20,10,0.9);color:#f0d890;font:bold 15px/18px sans-serif;padding:0;pointer-events:auto;z-index:3;
    -webkit-tap-highlight-color:transparent;touch-action:manipulation}.mm-zoom:active{background:#6a4a20}`;
  document.head.appendChild(css);
  const mk = (id, txt, dir) => {
    const b = document.createElement('button');
    b.id = id; b.className = 'mm-zoom'; b.textContent = txt;
    addL(b, 'pointerup', (ev) => {
      ev.preventDefault(); ev.stopPropagation();
      mmZoomIdx = Math.max(0, Math.min(MM_ZOOMS.length - 1, mmZoomIdx + dir));
    });
    addL(b, 'pointerdown', (ev) => ev.stopPropagation());
    host.appendChild(b);
    return b;
  };
  const place = () => {
    const r = minimapCanvas.getBoundingClientRect(), hr = host.getBoundingClientRect();
    const left = r.left - hr.left, top = r.top - hr.top;
    zin.style.left = (left - 4) + 'px'; zin.style.top = (top + r.height - 22) + 'px';
    zout.style.left = (left + 18) + 'px'; zout.style.top = (top + r.height - 8) + 'px';
  };
  const zin = mk('mmZoomIn', '+', -1);
  const zout = mk('mmZoomOut', '−', +1);
  place();
  addL(window, 'resize', place);
  setTimeout(place, 500);
}

// Sesión 11c-1 — minimap minimalista para cuando estamos en interior.
// No tiene sentido dibujar biomas/PLACES/NPCs reales (player en 10000,10000).
function drawMinimapInterior() {
  const ctx = minimapCtx;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
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

// Sesión 50 — Mapa grande nuevo: se arrastra y se hace zoom (pellizco,
// rueda o botones), terreno pintado con biomas suaves, iconos, nombres,
// tu flecha, jugadores, misión y leyenda.
const fm = { cx: 0, cz: 0, ppm: 0.2, base: null, pointers: new Map(), pinch: null, drag: null, timer: null, raf: 0 };
const FM_MIN_PPM = 0.08, FM_MAX_PPM = 4;

function setupFullMap() {
  fullMapOverlay = document.getElementById('fullMapOverlay');
  fullMapCanvas = document.getElementById('worldFullMap');
  if (!fullMapOverlay || !fullMapCanvas) { console.warn('Full map elements not found'); return; }
  fullMapCtx = fullMapCanvas.getContext('2d');
  ensureFullMapCss();
  const closeBtn = document.getElementById('fullMapClose');
  if (closeBtn) {
    addL(closeBtn, 'pointerup', (ev) => {
      if (ev.button !== undefined && ev.button !== 0) return;
      ev.preventDefault();
      closeFullMap();
    });
    // Botones de zoom junto a la ✕
    if (!document.getElementById('fmZoomIn')) {
      const bar = document.createElement('div');
      bar.className = 'fm-btns';
      bar.innerHTML = '<button id="fmCenter" title="Centrar en mí">⌖</button><button id="fmZoomOut">−</button><button id="fmZoomIn">+</button>';
      closeBtn.parentElement.insertBefore(bar, closeBtn);
      addL(bar, 'pointerup', (ev) => {
        const b = ev.target.closest('button'); if (!b) return;
        ev.preventDefault();
        if (b.id === 'fmZoomIn') fmZoomAt(1.6);
        else if (b.id === 'fmZoomOut') fmZoomAt(1 / 1.6);
        else if (b.id === 'fmCenter' && player) { fm.cx = player.position.x; fm.cz = player.position.z; fm.ppm = Math.max(fm.ppm, 0.9); }
        requestFullMapDraw();
      });
    }
  }
  const footer = fullMapOverlay.querySelector('.osrs-fullmap-footer');
  if (footer) {
    footer.innerHTML = [
      ['bank', 'Banco'], ['house', 'Tu casa'], ['quest', 'Misión'], ['anvil', 'Herrería'], ['altar', 'Altar'], ['fish', 'Pesca'], ['boss', 'Jefe'],
    ].map(([k, t]) => `<span class="fm-leg"><canvas data-ic="${k}" width="36" height="36"></canvas>${t}</span>`).join('')
      + '<span class="fm-leg fm-hint">Arrastra para moverte · pellizca para zoom</span>';
    for (const c of footer.querySelectorAll('canvas[data-ic]')) {
      const g = c.getContext('2d');
      mapRender.drawIcon(g, c.dataset.ic, 18, 18, 13, { mark: 'offer' });
    }
  }
  const cv = fullMapCanvas;
  cv.style.touchAction = 'none';
  addL(cv, 'pointerdown', (ev) => {
    cv.setPointerCapture?.(ev.pointerId);
    fm.pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    if (fm.pointers.size === 1) fm.drag = { x: ev.clientX, y: ev.clientY, cx: fm.cx, cz: fm.cz };
    if (fm.pointers.size === 2) {
      const [a, b] = [...fm.pointers.values()];
      fm.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), ppm: fm.ppm };
      fm.drag = null;
    }
  });
  addL(cv, 'pointermove', (ev) => {
    if (!fm.pointers.has(ev.pointerId)) return;
    fm.pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    if (fm.pinch && fm.pointers.size >= 2) {
      const [a, b] = [...fm.pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      fm.ppm = Math.max(FM_MIN_PPM, Math.min(FM_MAX_PPM, fm.pinch.ppm * d / Math.max(10, fm.pinch.d)));
      requestFullMapDraw();
    } else if (fm.drag) {
      fm.cx = fm.drag.cx - (ev.clientX - fm.drag.x) / fm.ppm;
      fm.cz = fm.drag.cz - (ev.clientY - fm.drag.y) / fm.ppm;
      clampFullMap();
      requestFullMapDraw();
    }
  });
  const up = (ev) => {
    fm.pointers.delete(ev.pointerId);
    if (fm.pointers.size < 2) fm.pinch = null;
    if (fm.pointers.size === 1) {
      const [a] = [...fm.pointers.values()];
      fm.drag = { x: a.x, y: a.y, cx: fm.cx, cz: fm.cz };
    } else if (fm.pointers.size === 0) fm.drag = null;
  };
  addL(cv, 'pointerup', up);
  addL(cv, 'pointercancel', up);
  addL(cv, 'wheel', (ev) => { ev.preventDefault(); fmZoomAt(ev.deltaY < 0 ? 1.25 : 0.8); }, { passive: false });
  addL(fullMapOverlay, 'click', (e) => { if (e.target === fullMapOverlay) closeFullMap(); });
  addL(window, 'resize', () => { if (fullMapVisible) { sizeFullMap(); requestFullMapDraw(); } });
}

function ensureFullMapCss() {
  if (document.getElementById('fm-css')) return;
  const st = document.createElement('style');
  st.id = 'fm-css';
  st.textContent = `
    .osrs-fullmap-frame { width: min(96vw, 980px); height: min(88vh, 900px); box-sizing: border-box; display: flex; flex-direction: column; padding: 8px !important; }
    #worldFullMap { flex: 1; min-height: 0; width: 100%; height: 100%; cursor: grab; }
    .osrs-fullmap-header { padding: 0 2px 6px !important; margin-bottom: 6px !important; gap: 6px; }
    .fm-btns { display: flex; gap: 6px; margin-left: auto; }
    .fm-btns button { width: 32px; height: 32px; background: rgba(60,30,20,0.95); border: 2px solid #c8a043; color: #e8c560;
      font-size: 18px; font-weight: bold; border-radius: 4px; padding: 0; -webkit-tap-highlight-color: transparent; }
    .fm-btns button:active { transform: scale(0.9); }
    .osrs-fullmap-footer { display: flex; flex-wrap: wrap; gap: 4px 10px; justify-content: center; align-items: center; }
    .fm-leg { display: inline-flex; align-items: center; gap: 3px; color: #e8d8a8; font-size: 11px; }
    .fm-leg canvas { width: 16px; height: 16px; }
    .fm-hint { color: rgba(200,160,67,0.7); }
  `;
  document.head.appendChild(st);
}

function sizeFullMap() {
  const r = fullMapCanvas.getBoundingClientRect();
  const dpr = Math.min(2.5, window.devicePixelRatio || 1);
  const w = Math.max(100, Math.round(r.width * dpr)), h = Math.max(100, Math.round(r.height * dpr));
  if (fullMapCanvas.width !== w || fullMapCanvas.height !== h) { fullMapCanvas.width = w; fullMapCanvas.height = h; }
}
function clampFullMap() {
  const L = WORLD_HALF + 200;
  fm.cx = Math.max(-L, Math.min(L, fm.cx));
  fm.cz = Math.max(-L, Math.min(L, fm.cz));
}
function fmZoomAt(f) {
  fm.ppm = Math.max(FM_MIN_PPM, Math.min(FM_MAX_PPM, fm.ppm * f));
  requestFullMapDraw();
}
function requestFullMapDraw() {
  if (fm.raf) return;
  fm.raf = requestAnimationFrame(() => { fm.raf = 0; drawFullMap(); });
}

function openFullMap() {
  if (!fullMapOverlay || !fullMapCanvas) return;
  fullMapOverlay.classList.add('visible');
  fullMapVisible = true;
  sizeFullMap();
  if (player) { fm.cx = player.position.x; fm.cz = player.position.z; }
  // Zoom inicial: ~1.2 km de ancho alrededor tuyo
  const r = fullMapCanvas.getBoundingClientRect();
  fm.ppm = Math.max(FM_MIN_PPM, r.width / 1200);
  mapRender.getWorldBase().then(b => { fm.base = b; requestFullMapDraw(); });
  drawFullMap();
  clearInterval(fm.timer);
  fm.timer = setInterval(() => { if (fullMapVisible) requestFullMapDraw(); }, 500);
}

function closeFullMap() {
  if (!fullMapOverlay) return;
  fullMapOverlay.classList.remove('visible');
  fullMapVisible = false;
  clearInterval(fm.timer); fm.timer = null;
}

function drawFullMap() {
  if (!fullMapCtx || !player || !fullMapVisible) return;
  const ctx = fullMapCtx;
  const dpr = fullMapCanvas.width / Math.max(1, fullMapCanvas.getBoundingClientRect().width);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const W = fullMapCanvas.width / dpr, H = fullMapCanvas.height / dpr;
  const ppm = fm.ppm;
  const S = (x, z) => [W / 2 + (x - fm.cx) * ppm, H / 2 + (z - fm.cz) * ppm];
  const vis = (x, z, m = 30) => { const [sx, sy] = S(x, z); return sx > -m && sx < W + m && sy > -m && sy < H + m; };

  ctx.fillStyle = '#26496e'; ctx.fillRect(0, 0, W, H);
  if (fm.base) {
    const b = fm.base;
    ctx.imageSmoothingEnabled = ppm < 1.2;
    const [bx, by] = S(b.x0, b.z0);
    const sz = b.canvas.width * b.mpp * ppm;
    ctx.drawImage(b.canvas, bx, by, sz, sz);
  } else {
    mapRender.label(ctx, 'Dibujando el mapa…', W / 2, H / 2, 16, '#e8c560', true);
  }

  // Cerca: árboles cargados (como el minimapa)
  if (ppm >= 1.2) {
    for (const m of terrain.getInteractableMeshes()) {
      const list = m.userData?.trees;
      if (!list || m.userData?.kind !== 'tree-trunk') continue;
      for (const t of list) {
        if (!vis(t.x, t.z, 5)) continue;
        const [sx, sy] = S(t.x, t.z);
        ctx.beginPath(); ctx.arc(sx, sy, Math.max(1.5, 1.4 * ppm), 0, Math.PI * 2);
        ctx.fillStyle = m.userData.typeId === 'dead' ? '#5a4030' : '#23461a'; ctx.fill();
      }
    }
  }

  // Malpaís: rótulo
  {
    const [wx] = S(WILDERNESS_X, 0);
    if (wx > 40) mapRender.label(ctx, 'EL MALPAÍS', Math.min(wx / 2, wx - 70), 22, 14, '#ff7060', true);
  }

  const IR = Math.max(5, Math.min(9, 4 + ppm * 3));
  // Servicios (aparecen al acercar)
  if (ppm >= 0.18) {
    try {
      for (const b of bankChests.getBanksForMinimap()) if (vis(b.x, b.z)) mapRender.drawIcon(ctx, 'bank', ...S(b.x, b.z), IR);
      for (const m of houses.getMapIcons()) if (vis(m.x, m.z)) mapRender.drawIcon(ctx, m.kind, ...S(m.x, m.z), IR * 1.15);
      for (const st of smithing.getStationsForMinimap()) if (vis(st.x, st.z)) mapRender.drawIcon(ctx, st.kind === 'furnace' ? 'furnace' : 'anvil', ...S(st.x, st.z), IR);
      for (const a of prayer.getAltarsForMinimap()) if (vis(a.x, a.z)) mapRender.drawIcon(ctx, 'altar', ...S(a.x, a.z), IR);
      for (const pd of fishing.getPondsForMinimap()) if (vis(pd.x, pd.z)) mapRender.drawIcon(ctx, 'fish', ...S(pd.x, pd.z + pd.r + 6), IR * 0.9);
      for (const m of townNpcs.getMinimapMarks()) {
        if (!vis(m.x, m.z)) continue;
        if (m.mark === 'offer' || m.mark === 'turnin') mapRender.drawIcon(ctx, 'quest', ...S(m.x, m.z - 6), IR * 0.9, { mark: m.mark });
      }
    } catch {}
  }

  // Lugares
  for (const p of PLACES) {
    if (!vis(p.x, p.z, 80)) continue;
    const [sx, sy] = S(p.x, p.z);
    const big = p.type === 'city';
    const r = big ? IR + 2 : IR;
    mapRender.drawIcon(ctx, mapRender.placeIconKind(p), sx, sy, r, { color: '#' + (p.color >>> 0).toString(16).padStart(6, '0') });
    if (big || ppm >= 0.14) mapRender.label(ctx, p.name, sx, sy + r + 9, big ? 13 : 11, big ? '#fff3c0' : '#e8d8a8', big);
  }

  // Fosa de Guayota
  { const fz = fosa.getForMap(); if (vis(fz.x, fz.z, 60)) { const [sx, sy] = S(fz.x, fz.z); mapRender.drawIcon(ctx, 'minigame', sx, sy, IR + 1); if (ppm >= 0.12) mapRender.label(ctx, fz.name, sx, sy + IR + 10, 11, '#ffc080', true); } }
  // Jefes (siempre visibles: calavera roja + nombre)
  for (const b of bossFx.getBossesForMap()) {
    if (!vis(b.x, b.z, 60)) continue;
    const [sx, sy] = S(b.x, b.z);
    mapRender.drawIcon(ctx, 'boss', sx, sy, IR + 1);
    if (ppm >= 0.12) mapRender.label(ctx, b.name, sx, sy + IR + 10, 11, '#ffb0a0', true);
  }

  // Otros jugadores
  const myPartyId = party.getMyPartyId();
  for (const peer of multiplayer.getPeerPositions()) {
    if (!vis(peer.x, peer.z)) continue;
    const [sx, sy] = S(peer.x, peer.z);
    ctx.beginPath(); ctx.arc(sx, sy, 4, 0, Math.PI * 2);
    ctx.fillStyle = (myPartyId != null && peer.party_id === myPartyId) ? '#4adc4a' : '#ffffff'; ctx.fill();
    ctx.lineWidth = 1.2; ctx.strokeStyle = '#000'; ctx.stroke();
    if (peer.username && ppm >= 0.3) mapRender.label(ctx, peer.username, sx, sy - 10, 10);
  }

  // Objetivo de misión
  try {
    const h = quests.getHintPos();
    if (h) {
      const [hx, hy] = S(h.x, h.z);
      ctx.fillStyle = '#ffd35a'; ctx.strokeStyle = '#000'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(hx, hy - 8); ctx.lineTo(hx + 6, hy); ctx.lineTo(hx, hy + 8); ctx.lineTo(hx - 6, hy); ctx.closePath();
      ctx.fill(); ctx.stroke();
    }
  } catch {}

  // Tú
  const [ps, pz] = S(player.position.x, player.position.z);
  const grad = ctx.createRadialGradient(ps, pz, 0, ps, pz, 18);
  grad.addColorStop(0, 'rgba(255,255,255,0.55)'); grad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grad; ctx.beginPath(); ctx.arc(ps, pz, 18, 0, Math.PI * 2); ctx.fill();
  mapRender.drawPlayerArrow(ctx, ps, pz, player.rotation.y, 8);
  if (user) mapRender.label(ctx, user.username, ps, pz - 16, 12, '#fff8d0', true);

  // Brújula + escala
  mapRender.label(ctx, 'N ↑', 22, 16, 14, '#e8c560', true);
  const meters = [50, 100, 250, 500, 1000][[50, 100, 250, 500, 1000].findIndex(m => m * ppm > 60)] || 1000;
  const bw = meters * ppm;
  ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(W - bw - 18, H - 22, bw + 10, 14);
  ctx.fillStyle = '#e8d8a8'; ctx.fillRect(W - bw - 13, H - 16, bw, 3);
  mapRender.label(ctx, `${meters} m`, W - bw / 2 - 13, H - 28, 10);
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

  // Sesión 11c-2 — Mochila estilo OSRS: 4 columnas, slots 42×42px sin scroll.
  // Sesión 33 — Reducido de 28 (4×7) → 20 (4×5) para que entre sin scroll
  // en mobile aún con la barra de navegación del browser. El grid-auto-rows
  // del CSS hace que con 20 items se rendericen 5 filas naturalmente.
  injectInventoryGridCss();
}

function injectInventoryGridCss() {
  const STYLE_ID = 'inventory-osrs-grid-4x7';
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    /* Sesión 11c-2 v3: mochila estilo OSRS — slots 42×42px en grid 4 cols
       centrado. CRÍTICO: scope a .active para no romper el toggle de tabs.
       Si aplico display:flex siempre, la mochila se ve encima de stats/magic.
       Sesión 33: ahora 4×5 (20 slots) en lugar de 4×7. grid-auto-rows hace
       que se ajuste solo, no hay que cambiar nada del CSS. */
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
      overflow: visible !important;
    }
    /* Sesión 30 — fix qty mal posicionado en columna izquierda.
       El número de cantidad estaba con left:2px y se cortaba/pegaba al
       borde del slot. Lo movemos a top:2px/left:3px con padding y
       fondo semi-transparente para legibilidad sobre cualquier icono. */
    .osrs-tab-pane[data-tab="inventory"] .inv-qty {
      top: 2px !important;
      left: 3px !important;
      padding: 1px 3px !important;
      font-size: 10px !important;
      background: rgba(0, 0, 0, 0.4) !important;
      border-radius: 2px !important;
      z-index: 2 !important;
      pointer-events: none !important;
    }
    /* Asegurar que el icono SVG NO se sale de su slot */
    .osrs-tab-pane[data-tab="inventory"] .inv-icon {
      width: 36px !important;
      height: 36px !important;
      max-width: 36px !important;
      max-height: 36px !important;
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
    }
    .osrs-tab-pane[data-tab="inventory"] .inv-icon svg {
      width: 100% !important;
      height: 100% !important;
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
      // Sesión 36 — Si el user DESmutea, forzar el restart de la música del
      // bioma actual. Antes esto no era necesario porque toggleMute() resumía
      // el `musicAudio` existente, pero ahora musicForBiome se skipea cuando
      // está muteado → no hay musicAudio para resumir. Sin este call, después
      // de mutear+entrar a edificio+salir+desmutear, no se escuchaba música
      // hasta cambiar de bioma manualmente.
      if (!nowMuted && !interiors.isActive?.() && player) {
        try {
          const biome = terrain.biomeAt(player.position.x, player.position.z);
          audio.musicForBiome(biome.id);
        } catch (e) { console.warn('[world] resume music on unmute:', e); }
      }
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
  // Sesión 42b — 2 slots vacíos de relleno: con 13 skills, esto empuja los
  // 3 especiales (Combate/Total/Ranking) a una misma fila de 3 columnas.
  html += `<div class="skill-slot" style="opacity:0; pointer-events:none;"></div>`;
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
  // Sesión 42b — Ranking (Highscores): slot especial al lado de Combate/Total.
  // Al tocarlo abre el libro de ranking (highscores.open()).
  html += `
    <div class="skill-slot special" id="statsHighscoreSlot" style="cursor:pointer;">
      <span class="skill-slot-name">Ranking</span>
      <span class="skill-slot-special-value">🏆</span>
    </div>
  `;
  html += '</div>';
  html += '</div>';
  pane.innerHTML = html;

  // Sesión 42b — cablear el slot de ranking (se re-cablea en cada render).
  const hsSlot = pane.querySelector('#statsHighscoreSlot');
  if (hsSlot) {
    hsSlot.addEventListener('pointerup', (ev) => {
      if (ev.button !== undefined && ev.button !== 0) return;
      ev.preventDefault();
      ev.stopPropagation();
      try { highscores.open(); } catch (e) { console.warn('[world] highscores.open:', e); }
    });
  }

  // Listeners: tap en cada skill abre tooltip
  pane.querySelectorAll('.skill-slot[data-skill-id]').forEach(slot => {
    slot.addEventListener('pointerup', (ev) => {
      if (ev.button !== undefined && ev.button !== 0) return;
      ev.preventDefault();
      ev.stopPropagation();
      // Sesión 50 — abrir el libro de la skill (qué desbloqueas y a qué nivel).
      openSkillGuide(slot.dataset.skillId).catch?.(() => showSkillTooltip(slot.dataset.skillId, ev.clientX, ev.clientY));
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
  try { bankChests.onBankClosed(); } catch {}
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
  // Sesión 30 — bajado de 3500ms a 1200ms para no tapar al char durante
  // la animación de tala.
  el._hideTimer = setTimeout(() => { el.style.opacity = '0'; }, 1200);
}

// Sesión 30 — Ocultar tooltip inmediatamente (llamado al empezar tala).
function hideTreeTooltipNow() {
  const el = document.getElementById('worldTooltip');
  if (!el) return;
  clearTimeout(el._hideTimer);
  el.style.opacity = '0';
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
      // Sesión 39 — primero el loot del suelo: si hay ítems bajo el dedo,
      // abrir la lista para elegir cuál coger (estilo OSRS). Es lo más
      // "foreground" y lo que el jugador espera priorizar.
      if (groundItems.openLootMenuAt(cx, cy)) return;
      // Sesión 27 Bloque 3 — luego peer (PVP); si no impactó, NPC.
      if (multiplayer.openActionMenuAt(cx, cy)) return;
      if (npcRenderer.openActionMenuAt(cx, cy)) return;
      // Sesión 50 — veta de mineral / árbol → menú "Minar|Talar / Examinar".
      if (openSkillMenuAt(cx, cy)) return;
      // Sesión 38 — fallback: examinar árbol (tooltip).
      tryExamineTreeAt(cx, cy);
    },

    // Drag del dedo en canvas O rotación con dos dedos → rotar cámara
    // Sesión 31 — delegado a core/camera.js.
    onCameraDrag: (dyaw, dpitch) => cameraOrbital.onDrag(dyaw, dpitch),

    // Pinch con dos dedos → zoom de cámara
    onCameraZoom: (deltaDist) => cameraOrbital.onZoom(deltaDist),

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
      // Sesión 37 — ESC: cancela target de combate + cancela auto-engage
      // pendiente. NO toca panel del sidebar (decisión: el sidebar es
      // always-visible OSRS-style, no se cierra con ESC).
      if (key === 'Escape') {
        try { combat.disengage?.(); } catch {}
        try { npcRenderer.cancelAutoEngage?.(); } catch {}
        try { multiplayer.cancelAutoEngage?.(); } catch {}
        playerTarget = null;
        if (marker) marker.visible = false;
      }
    },
  });

  // Resize: lo gestiona world porque toca camera/renderer
  addL(window, 'resize', onResize);
}

// Sesión 50 — Pulsación larga sobre veta / árbol → menú contextual.
function openSkillMenuAt(clientX, clientY) {
  if (interiors.isActive()) return false;
  const rect = canvas.getBoundingClientRect();
  const nx = ((clientX - rect.left) / rect.width) * 2 - 1;
  const ny = -((clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera({ x: nx, y: ny }, camera);
  const openMenu = (title, rows, cx, cy) => npcRenderer.openGenericActionMenu(title, rows, cx, cy);
  if (townNpcs.openActionMenuAt(raycaster, clientX, clientY, openMenu)) return true;    // Sesión 50
  if (bankChests.openActionMenuAt(raycaster, clientX, clientY, openMenu)) return true;   // Sesión 50
  if (prayer.openActionMenuAt(raycaster, clientX, clientY, openMenu)) return true;
  if (smithing.openActionMenuAt(raycaster, clientX, clientY, openMenu)) return true;
  if (mining.openActionMenuAt(raycaster, clientX, clientY, openMenu)) return true;
  if (fishing.openActionMenuAt(raycaster, clientX, clientY, openMenu)) return true;

  const treeHits = raycaster.intersectObjects(terrain.getInteractableMeshes(), false);
  if (treeHits.length > 0) {
    const hit = treeHits[0];
    const ud = hit.object.userData;
    const tree = (Array.isArray(ud?.trees) && hit.instanceId != null) ? ud.trees[hit.instanceId] : null;
    if (ud?.treeType && ud?.typeId && tree) {
      openMenu(ud.treeType.name, [
        { label: '🪓 Talar', onPick: () => {
            try { mining.stopMining?.('tap_ground'); } catch {}
            try { woodcutting.startChopAt(ud.typeId, tree.x, tree.z); } catch (e) { console.warn(e); }
          } },
        { label: '🔍 Examinar', onPick: () => showTreeTooltip(ud.treeType, clientX, clientY) },
      ], clientX, clientY);
      return true;
    }
  }
  return false;
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

  // Sesión 50 — Cada toque es una orden nueva: corta la tala/minería en curso.
  // Si el toque cae en otra veta/árbol, más abajo arranca la acción nueva.
  try { mining.stopMining?.('tap_ground'); } catch {}
  try { fishing.stopFishing?.('tap_ground'); } catch {}
  try { crafting.stopWork?.('tap_ground'); } catch {}
  try { woodcutting.stopChop?.('tap_ground'); } catch {}
  try { smithing.stopWork?.('tap_ground'); } catch {}
  try { prayer.cancel?.(); } catch {}
  try { houses.cancel?.(); } catch {}
  try { follow.stop(); } catch {}   // Sesión 50 — tocar en cualquier sitio deja de seguir
  try { bankChests.cancel?.(); } catch {}
  try { townNpcs.cancel?.(); } catch {}

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

  // 2a--) Tap habitante → caminar + hablar (Sesión 50).
  if (townNpcs.tryHandleTap(raycaster)) return;

  // Sesión 50 — puerta de tu casa.
  try { if (houses.tryHandleTap(raycaster)) return; } catch (e) { console.warn('[houses] tap', e); }

  // 2a-) Tap cofre de banco → caminar + abrir banco (Sesión 50).
  if (bankChests.tryHandleTap(raycaster)) return;

  // 2a0) Tap altar → caminar + rezar (Sesión 50).
  if (prayer.tryHandleTap(raycaster)) return;

  // 2a) Tap horno/yunque → caminar + abrir panel (Sesión 50).
  if (smithing.tryHandleTap(raycaster)) return;

  // 2a1) Tap banco de peces → caminar a la orilla + pescar (Sesión 50).
  if (fishing.tryHandleTap(raycaster)) return;

  // 2b) Tap veta de mineral → caminar + picar (Sesión 50).
  if (mining.tryHandleTap(raycaster)) {
    try { woodcutting.stopChop?.('tap_ground'); } catch {}
    return;
  }

  // 3) Tap árbol → arrancar chop (Sesión 30).
  //    El raycast contra InstancedMesh devuelve `instanceId` que apunta al
  //    índice del árbol en userData.trees. Sacamos x,z reales y tipo, y le
  //    pasamos a woodcutting.startChopAt — él se ocupa de caminar + chopear.
  //    Mostramos el tooltip como feedback (auto-fade en 3.5s).
  const treeHits = raycaster.intersectObjects(terrain.getInteractableMeshes(), false);
  if (treeHits.length > 0) {
    const hit = treeHits[0];
    const ud = hit.object.userData;
    const treeType = ud?.treeType;
    const typeId = ud?.typeId;
    const idx = hit.instanceId;
    const tree = (Array.isArray(ud?.trees) && idx != null) ? ud.trees[idx] : null;
    if (treeType && typeId && tree) {
      showTreeTooltip(treeType, clientX, clientY);
      try { mining.stopMining?.('tap_ground'); } catch {}
      try { woodcutting.startChopAt(typeId, tree.x, tree.z); }
      catch (e) { console.warn('[world] startChopAt err:', e); }
      // Sesión 30 — ocultar tooltip rápido (~600ms) si el char ya está
      // cerca y va a talar. El tooltip estorba la vista del char.
      setTimeout(() => { try { hideTreeTooltipNow(); } catch {} }, 600);
      return;
    }
    // Fallback (no instanceId disponible) — solo tooltip
    if (treeType) {
      showTreeTooltip(treeType, clientX, clientY);
      return;
    }
  }

  // 4) Tap suelo → goto (cualquier tap al suelo cancela un chop activo)
  try { woodcutting.stopChop?.('tap_ground'); } catch {}
  try { mining.stopMining?.('tap_ground'); } catch {}
  const hits = raycaster.intersectObjects(terrain.getTerrainMeshes());
  if (hits.length > 0) {
    const p = hits[0].point;
    setPlayerTarget(p.x, p.z);
  }
}


// Sesión 38 — Examinar árbol (long-press móvil / click derecho desktop).
// Raycast contra los árboles; si impacta uno, muestra su tooltip (nombre +
// nivel de tala + XP) SIN arrancar la tala. Devuelve true si examinó algo.
function tryExamineTreeAt(clientX, clientY) {
  if (interiors.isActive()) return false;
  const rect = canvas.getBoundingClientRect();
  const nx = ((clientX - rect.left) / rect.width) * 2 - 1;
  const ny = -((clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera({ x: nx, y: ny }, camera);
  if (mining.tryHandleTap(raycaster, true)) return true;   // Sesión 50 — examinar veta
  if (fishing.tryHandleTap(raycaster, true)) return true;  // Sesión 50 — examinar banco de peces
  const treeHits = raycaster.intersectObjects(terrain.getInteractableMeshes(), false);
  if (treeHits.length > 0) {
    const treeType = treeHits[0].object.userData?.treeType;
    if (treeType) {
      showTreeTooltip(treeType, clientX, clientY);
      return true;
    }
  }
  return false;
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
  // Sesión 31 — cámara delegada a core/camera.js
  cameraOrbital.update();
  updateMarker();
  // Sesión 34 — proyectiles ranged (stub líneas + futuro arrow mesh)
  try { combatProjectiles.update(); } catch {}
  if (character) {
    character.update(dt);
    // Y del player: -1.03 tras recalibración (era -1.10, el personaje
    // quedaba un pelín hundido). El override window.__sebasOffsetY sigue
    // disponible para futuras pruebas.
    //
    // Sesión 30 — durante gathering (woodcut/kneel), las anims tienen
    // los huesos en otra altura relativa a los pies del modelo. Aplicamos
    // un offset ADICIONAL por anim para que el char quede al ras del suelo.
    // Cada anim tiene su offset independiente (woodcut baja menos que kneel).
    // Configurables desde Eruda en runtime:
    //   window.__gatherOffsets = { woodcut: 0.0, kneel: 0.85 };
    if (player && !characterFallback) {
      const baseY = (typeof window !== 'undefined' && typeof window.__sebasOffsetY === 'number')
        ? window.__sebasOffsetY
        : -1.03;
      // Sesión 30 — Solo aplicamos offset especial para 'kneel' (fuego).
      // Para 'punching' (tala), no tocamos Y porque es una anim que no
      // baja el centro del char — usa el mismo -1.03 que idle/walk.
      // Configurable: window.__gatherY = { kneel: -0.6 }
      let targetY = baseY + mounts.liftY();   // Sesión 50 — en la silla / volando
      if (character?._gatheringActive && character._gatherAnimName === 'kneel') {
        const overrides = (typeof window !== 'undefined' && window.__gatherY) || {};
        targetY = overrides.kneel != null ? overrides.kneel : -0.6;
      }
      // Sesión 30 — Lerp suave para evitar "flash teleport" al terminar
      // anim de gathering (cuando Y vuelve de -0.6 a -1.03).
      // Si la diferencia es >0.005, hacemos lerp; si es chica, asignación directa.
      //
      // Sesión 31 fix kneel — antes k=8 + threshold 0.02. El lerp tardaba
      // ~500ms y la transición de anim (crossfade 250ms a idle) terminaba
      // ANTES de que el Y llegara al target → flash visible.
      // Ahora k=15 → lerp ~250ms, alineado con el crossfade.
      // Threshold a 0.005 para que el snap final sea imperceptible.
      const currentY = player.position.y;
      const diff = targetY - currentY;
      if (Math.abs(diff) < 0.005) {
        player.position.y = targetY;
      } else {
        const k = Math.min(1, dt * 15);
        player.position.y = currentY + diff * k;
      }
    }
  }
  updateNameTag();
  updateRegionTracking();
  npcRenderer.update(dt);
  multiplayer.update(dt);
  worldSnapshot.update(dt);   // Sesión 27 Bloque 1
  realtime.update();          // Sesión 50 — posición por WebSocket
  chat.update(dt);            // Sesión 29 — refrescar pos overhead bubbles
  woodcutting.update(dt);     // Sesión 30 — chop loop + sync depletadas
  mining.update(dt);          // Sesión 50 — vetas + loop de picar
  fishing.update(dt);         // Sesión 50 — estanques + bancos + loop de pesca
  crafting.update(dt);        // Sesión 50 — bucle de flechería/artesanía
  bankChests.update(dt);      // Sesión 50 — cofres de banco
  try { bossFx.update(dt); } catch (e) { if (!window.__bossErr) { window.__bossErr = e; console.warn('[boss]', e); } }
  try { potions.update(dt); } catch {}
  try { guancheVillage.update(dt); } catch {}
  try { houses.update(dt); } catch {}
  try { follow.update(dt); } catch {}
  try { mounts.update(dt); } catch (e) { if (!window.__mtErr) { window.__mtErr = e; console.warn('[mounts]', e); } }
  try { fosa.update(dt); } catch (e) { if (!window.__fosaErr) { window.__fosaErr = e; console.warn('[fosa]', e); } }
  townNpcs.update(dt);        // Sesión 50 — habitantes
  tablets.update(dt);         // Sesión 50 — efecto de teletransporte
  smithing.update(dt);        // Sesión 50 — hornos/yunques + trabajo
  quests.update(dt);          // Sesión 50 — misiones (tracker + haz)
  prayer.update(dt);          // Sesión 50 — plegaria (HUD, altares, aura)
  skull.update();             // Sesión 50 — calavera
  firemaking.update(dt);      // Sesión 30 — sync fires + flicker anim
  groundItems.update(dt);
  interiors.update?.(dt);  // Sesión 11c-2 — tick del mixer del NPC del interior
  try { drawMinimap(); } catch (e) { if (!window.__mmErr) { window.__mmErr = e; console.warn('[minimap]', e); } }
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


// Sesión 50 — toda la cadena de colisiones en un sitio. Volando en la pardela
// no chocas con nada (árboles, casas, rocas…).
function collideStep(x0, z0, x1, z1) {
  if (mounts.isFlying()) return { x: x1, z: z1 };
  const a1 = terrain.applyCollision(x0, z0, x1, z1);
  const a2 = buildings.applyCollision(x0, z0, a1.x, a1.z);
  const a3 = bossFx.applyCollision(x0, z0, a2.x, a2.z);          // rocas de jefes
  const a4 = guancheVillage.applyCollision(x0, z0, a3.x, a3.z);  // casas guanches
  const a6 = houses.applyCollision(x0, z0, a4.x, a4.z);          // urbanizaciones, casonas, Arico
  return interiors.applyCollision(x0, z0, a6.x, a6.z);
}
// ¿Se puede estar de pie aquí? (para aterrizar al bajar de la pardela)
function groundFreeAt(x, z) {
  const probes = [[0.6, 0], [-0.6, 0], [0, 0.6], [0, -0.6]];
  return probes.every(([dx, dz]) => {
    const a1 = terrain.applyCollision(x + dx, z + dz, x, z);
    const a2 = buildings.applyCollision(x + dx, z + dz, a1.x, a1.z);
    const a3 = bossFx.applyCollision(x + dx, z + dz, a2.x, a2.z);
    const a4 = guancheVillage.applyCollision(x + dx, z + dz, a3.x, a3.z);
    const a6 = houses.applyCollision(x + dx, z + dz, a4.x, a4.z);
    return Math.hypot(a6.x - x, a6.z - z) < 0.05;
  });
}
function findLandingSpot(x, z) {
  if (groundFreeAt(x, z)) return { x, z };
  for (let r = 1.5; r <= 40; r += 1.5) {
    const n = Math.ceil(r * 3);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
      if (groundFreeAt(px, pz)) return { x: px, z: pz };
    }
  }
  return { x, z };
}

function updatePlayer(dt) {
  let isMoving = false;
  let moveSpeed = 0;
  let moveWx = 0;   // Slice 5d — vector de movimiento (mundo) para calcular
  let moveWz = 0;   //            dirección relativa al facing en combate

  // Sesión 26 — Run energy: si la energía se acaba, forzar walking aunque
  // el toggle esté activo. La velocidad efectiva se calcula AQUÍ.
  const effectiveRun = runMode && runEnergy > 0;
  const maxSpeed = mounts.isMounted()
    ? PLAYER_RUN * PLAYER_RUN_BOOST * mounts.speedMult()     // Sesión 50 — montado: rápido y sin gastar energía
    : (effectiveRun ? PLAYER_RUN * PLAYER_RUN_BOOST : PLAYER_RUN);

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
    try { follow.stop(); } catch {}   // Sesión 50 — el joystick corta el "seguir"
    // User mueve con joystick → cancela cualquier auto-engage pendiente
    npcRenderer.cancelAutoEngage();
    multiplayer.cancelAutoEngage?.();   // Sesión 27 Bloque 3 — también peer
    const len = Math.hypot(joyState.x, joyState.y);
    const speedScale = Math.min(1, len);
    // Sesión 31 — yaw via core/camera.js
    const _yaw = cameraOrbital.getYaw();
    const camForwardX = -Math.sin(_yaw);
    const camForwardZ = -Math.cos(_yaw);
    const camRightX = Math.cos(_yaw);
    const camRightZ = -Math.sin(_yaw);
    const wx = camRightX * joyState.x + camForwardX * (-joyState.y);
    const wz = camRightZ * joyState.x + camForwardZ * (-joyState.y);
    const speed = maxSpeed * speedScale;
    const nextX = player.position.x + wx * speed * dt;
    const nextZ = player.position.z + wz * speed * dt;
    const adjusted = collideStep(player.position.x, player.position.z, nextX, nextZ);
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
      const adjusted = collideStep(player.position.x, player.position.z, nextX, nextZ);
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
  // En combate (target != null): el player se queda mirando al NPC.
  // El movimiento puede ir en cualquier dirección relativa a ese facing
  // (forward/back/left/right) y la animación cambia según la dirección.
  //
  // Fuera de combate: el player rota hacia donde se mueve (forward siempre).
  // Sesión 31 — target ahora vive en core/combat_hooks.js.
  // ============================================================
  let facingLockedToNpc = false;
  const _combatTarget = combatHooks.getCombatTargetNpcId();
  if (_combatTarget !== null) {
    const mesh = npcRenderer.getNpcMeshes().get(_combatTarget);
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
    if (!isMoving || mounts.isMounted()) {
      character.play('idle');   // montado: el animal corre, tú vas sentado
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
  if (effectiveRun && isMoving && !mounts.isMounted()) {
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

// Sesión 31 — updateCamera() movida a core/camera.js (cameraOrbital.update()).

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
