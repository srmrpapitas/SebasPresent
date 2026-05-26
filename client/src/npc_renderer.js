/**
 * SebasPresent — NPC Renderer module
 *
 * ============================================================
 * Sesión 27 Bloque 2.5 — REFACTOR SERVER-AUTHORITATIVE (OSRS-style)
 * ============================================================
 *
 * CAMBIO CLAVE: el cliente YA NO simula el movimiento de los NPCs. Antes
 * cada NPC orbitaba su spawn point con un patrol procedural (radio 3m).
 * Eso causaba que la mesh visual estuviera HASTA 3m de la posición que
 * el server creía que tenía → "Fuera de alcance" al atacar de cerca.
 *
 * Ahora:
 *   - Server tiene la posición autoritativa (npc.x, npc.z en snapshot).
 *   - Cliente dibuja la mesh EXACTAMENTE donde el server dice.
 *   - Para que el movimiento sea fluido cuando el server mueva NPCs
 *     (Bloque 3+), entre snapshot y snapshot interpolamos suavemente
 *     (entity interpolation, técnica estándar en MMOs: Albion, New World,
 *     CS:GO usan la misma idea).
 *
 * Resultado:
 *   - Hit-box VISUAL = hit-box REAL del server. Cero desfase.
 *   - "Fuera de alcance" desaparece (combinado con que combat.js manda
 *     la pos del player en el body del attack).
 *   - PVP futuro: peers usarán EL MISMO patrón. multiplayer.js leerá el
 *     mismo snapshot y aplicará interpolación idéntica. Cero discrepancia
 *     entre lo que ves de un peer y lo que el server cree de él.
 *   - Cuando el server tickee y mueva NPCs server-side (Bloque 3), los
 *     verás moverse fluido SIN tocar nada del cliente — el lerp ya está.
 *
 * Trade-off temporal: hasta Bloque 3, los NPCs están QUIETOS en su
 * spawn server. Sin patrol orbital cliente. Eso es la base OSRS-correcta
 * — en OSRS clásico el server controla TODO movimiento de NPCs, el
 * cliente no inventa nada.
 *
 * ============================================================
 * Cosas que cambiaron respecto a la versión anterior:
 * ============================================================
 *
 * ELIMINADO:
 *   - NPC_PATROL_RADIUS, NPC_PATROL_SPEED_RPS, NPC_PATROL_BOB_*
 *   - `patrol` object dentro de mesh.userData
 *   - `frozenX/Z` hack (era compensación del patrol)
 *   - COMBAT_FOLLOW_RANGE y updateCombatFollow() (NPC ya no se mueve
 *     client-side, no hay nada que perseguir)
 *   - Lógica de "re-anclar patrol center si npc.x/z saltó"
 *
 * AÑADIDO:
 *   - `interp` object dentro de mesh.userData:
 *       prevX, prevZ          - pos al inicio del lerp actual
 *       targetX, targetZ      - pos del último snapshot
 *       startMs               - performance.now() del inicio del lerp
 *       durationMs            - cuánto dura el lerp (≈ período snapshot)
 *       lastFacingY           - rotación cuando no hay delta de movimiento
 *   - updateInterpolation() en lugar de updatePatrol()
 *
 * IDÉNTICO (no se ha tocado):
 *   - Carga GLB de NPCs
 *   - HP bars (geometría, billboard, update)
 *   - Hit reaction (kick + flash emissive)
 *   - Tap detection (raycast + screen-space proximity)
 *   - Action menu / long-press / examine
 *   - Hitsplats DOM
 *   - Hooks globales (__worldFlashNpcHit, __worldSpawnHitsplat,
 *     __getPlayerPosition)
 *
 * ============================================================
 * Sesión 27 Bloque 2 (mantenido):
 * ============================================================
 *
 * La FUENTE de NPCs es world_snapshot.getNpcs() (poll 250ms al server).
 * Procesamos solo cuando snap.now cambia. combat.onUpdate ya no se usa
 * para refrescar NPCs — solo para sus stats internas (currentTarget,
 * level-ups, etc).
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as combat from './combat.js';
import * as equipment from './equipment.js';   // Sesión 35 — engage range dinámico por weapon_type
import * as worldSnapshot from './world_snapshot.js';
import { bakeGlbModel } from './terrain.js';
// Sesión 39 — pipeline esquelético (goblin animado). Forma A: malla del GLB +
// clips FBX sueltos desde R2. Los NPCs no animados siguen por bakeGlbModel.
import * as npcAnimated from './npc_animated.js';

const R2_BASE = 'https://pub-bb63b96c76c745f59a39649cde6678c0.r2.dev';

// ============================================================
// Datos NPC (catalogación por tipo)
// ============================================================
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

export const NPC_TARGET_HEIGHTS = {
  chicken: 1.0,
  cow:     1.4,
  goblin:  1.6,
  wolf:    1.0,
};

const NPC_GLB_FORCE_NO_ZUP = { cow: true };
const NPC_GLB_FORCE_ZUP = {};
const NPC_GLB_FORCE_ZUP_INVERT = {};

// Algunos modelos GLB vienen con el "frente" mirando a -Z en vez de +Z.
// Para esos, añadimos PI a la rotación Y para que caminen mirando bien.
const NPC_FACING_REVERSED = { cow: true };

// ============================================================
// Constantes de comportamiento
// ============================================================
//
// Hit reaction (kick + flash) — sin cambios respecto a versiones previas.
const NPC_REACT_DURATION_S = 0.18;
const NPC_REACT_KICK_DIST  = 0.35;

// Distancia para engage automático: si tapeas un NPC y ya estás a esta
// distancia, engage directo sin caminar. Coincide con el rango efectivo
// del server (que ahora bifurca por weapon_type).
//   - Melee: ≈2m (npc.attack_range + RANGE_TOLERANCE en server).
//   - Bow:   ≈8m (server permite hasta 10, dejamos ~2m de buffer).
// Sesión 35 — Antes era constante 2.0 fija, lo cual hacía que con bow
// igual te acercaras a melee antes de tirar la primera flecha (defeated
// el propósito del bow). Ahora getNpcEngageRange() lo calcula on-demand
// según el arma equipada.
const NPC_MELEE_ENGAGE_RANGE  = 2.0;
const NPC_RANGED_ENGAGE_RANGE = 8.0;

function getNpcEngageRange() {
  try {
    const wt = equipment.getWeaponType?.();
    if (wt === 'bow') return NPC_RANGED_ENGAGE_RANGE;
    // Cuando agreguemos 'staff' (Bloque 2 días 8-11), va acá también.
  } catch {}
  return NPC_MELEE_ENGAGE_RANGE;
}

// Hit-box generosa en screen-space para dedos en móvil.
const NPC_TAP_SCREEN_PX    = 90;

// Culling: solo dibujamos NPCs dentro de este radio del player.
const NPC_RENDER_RADIUS    = 100;
export const NPC_MINIMAP_RADIUS = 500;

// ------------------------------------------------------------
// Interpolación entre snapshots (Sesión 27 Bloque 2.5)
// ------------------------------------------------------------
// Los snapshots llegan cada ~250ms (world_snapshot.js, POLL_INTERVAL_MS).
// Cuando llega uno nuevo, lerpeamos la mesh desde la pos actual hacia la
// nueva pos durante INTERP_DURATION_MS. Si llega otro antes de terminar,
// reanudamos desde la pos actual (sin saltos).
//
// Usamos un buffer ligeramente mayor que el periodo de snapshot para
// absorber jitter de red (un snapshot que llega 50ms tarde no causa que
// el NPC se quede congelado). Estándar industria: 1.1×–1.2× el periodo.
const INTERP_DURATION_MS = 280;

// Si la nueva pos se aleja más de este umbral de la anterior, asumimos
// teleport/respawn y NO interpolamos — snapeamos a la nueva pos al instante.
// Evita ver un NPC "esquiar" 50m suavemente si el server reposiciona.
const INTERP_TELEPORT_THRESHOLD_M = 6.0;

// ============================================================
// Estado del módulo (privado)
// ============================================================
let scene = null;
let camera = null;
let canvas = null;
let raycaster = null;

let getPlayer = null;
let setPlayerTargetCb = null;
let clearPlayerTargetCb = null;
let feedLog = null;

let NPC_GEOMS = null;
const npcMeshes = new Map();
let npcDataList = [];

// Sesión 39 — Pieza 1: ventana de supresión por NPC. combat.js marca aquí
// (markLocalHit) cuando el jugador local pega, para que el feedback derivado
// del snapshot no le DUPLIQUE el hitsplat que ya mostró al instante.
const _localHitSuppress = new Map();   // npcId -> performance.now() límite
const LOCAL_HIT_SUPPRESS_MS = 600;     // > período de snapshot (250ms) con margen

/**
 * Llamado por combat.js cuando el jugador LOCAL acaba de pegarle a un NPC.
 * Marca una ventana donde el feedback snapshot-driven se omite para este NPC
 * (evita doble hitsplat: el local ya se mostró sin lag).
 */
export function markLocalHit(npcId) {
  if (npcId == null) return;
  _localHitSuppress.set(npcId, performance.now() + LOCAL_HIT_SUPPRESS_MS);
}

// Guard: solo procesamos syncMeshes cuando llega un snapshot con timestamp
// distinto al último visto.
let lastProcessedSnapshotNow = 0;

let pendingEngageNpcId = null;

let actionMenuEl = null;
let hitsplatLayerEl = null;
let cssInjectedActionMenu = false;

let started = false;

// ============================================================
// API pública — lifecycle
// ============================================================
export async function start(opts) {
  if (started) {
    console.warn('[npc_renderer] start() llamado dos veces sin stop()');
    stop();
  }
  scene              = opts.scene;
  camera             = opts.camera;
  canvas             = opts.canvas;
  getPlayer          = opts.getPlayer;
  setPlayerTargetCb  = opts.setPlayerTarget    || (() => {});
  clearPlayerTargetCb= opts.clearPlayerTarget  || (() => {});
  feedLog            = opts.feedLog            || (() => {});

  raycaster = new THREE.Raycaster();
  pendingEngageNpcId = null;
  npcDataList = [];
  lastProcessedSnapshotNow = 0;

  await loadGLBs();

  // Lista de NPCs viene del world_snapshot (poll 250ms server-side).
  // Procesamos en update(dt) si el timestamp del snap cambió.

  // Hooks globales para que combat.js dispare efectos visuales sin tener
  // que importarnos directamente (evita circular imports).
  if (typeof window !== 'undefined') {
    window.__worldFlashNpcHit = flashHit;
    window.__worldSpawnHitsplat = spawnHitsplat;
    // Sesión 39 — Pieza 1: combat.js marca aquí su hit local para de-dup del
    // feedback compartido (ver markLocalHit / _localHitSuppress).
    window.__worldMarkLocalHit = markLocalHit;
    // Hook para que combat.js mande la pos actual del player en el body
    // del attack. Devuelve {x, z} o null si no hay player aún.
    window.__getPlayerPosition = () => {
      const p = getPlayer?.();
      if (!p || !p.position) return null;
      return { x: p.position.x, z: p.position.z };
    };
    // Sesión 40 — DEBUG DEL GOBLIN. Corré window.__goblinDebug() en Eruda:
    // imprime, por cada goblin visible, si su mesh es ANIMADA u HORNEADA, qué
    // clip está sonando, su rootY, la Y MUNDIAL del pie más bajo (debería ser
    // ~0 con auto-ground), y el estado del template (qué clips cargó el GLB).
    // Es el dato que dice si flota (pieY≠0), si está en T (mesh horneada / sin
    // idle) y qué animaciones trajo el GLB realmente.
    window.__goblinDebug = () => {
      const out = { template: npcAnimated.getGroundState(), goblins: [] };
      for (const [id, group] of npcMeshes.entries()) {
        const ud = group.userData;
        if (!ud || ud.npc?.def_id !== 'goblin') continue;
        const entry = {
          id,
          groupPos: {
            x: +group.position.x.toFixed(2),
            y: +group.position.y.toFixed(2),
            z: +group.position.z.toFixed(2),
          },
          animated: !!ud.anim,
        };
        if (ud.anim) Object.assign(entry, npcAnimated.probeInstance(ud.anim));
        else entry.note = 'HORNEADO (sin esqueleto) → T-pose. Template no listo al spawnear.';
        out.goblins.push(entry);
      }
      console.log('[goblinDebug]', JSON.stringify(out, null, 2));
      return out;
    };
  }

  started = true;
}

export function stop() {
  if (!started) return;
  for (const m of npcMeshes.values()) {
    if (m.parent) m.parent.remove(m);
    m.traverse?.(obj => {
      if (obj.geometry && !obj.userData?.shared) obj.geometry.dispose?.();
      if (obj.material && !obj.userData?.shared) {
        if (Array.isArray(obj.material)) obj.material.forEach(mm => mm.dispose());
        else obj.material.dispose();
      }
    });
  }
  npcMeshes.clear();
  npcDataList = [];
  lastProcessedSnapshotNow = 0;
  pendingEngageNpcId = null;

  if (NPC_GEOMS) {
    for (const n of Object.values(NPC_GEOMS)) {
      if (n.glbParts) for (const p of n.glbParts) { p.geometry?.dispose(); p.material?.dispose(); }
    }
    NPC_GEOMS = null;
  }

  closeActionMenu();
  if (hitsplatLayerEl) { hitsplatLayerEl.remove(); hitsplatLayerEl = null; }

  if (typeof window !== 'undefined') {
    if (window.__worldFlashNpcHit === flashHit) delete window.__worldFlashNpcHit;
    if (window.__worldSpawnHitsplat === spawnHitsplat) delete window.__worldSpawnHitsplat;
    if (window.__getPlayerPosition) delete window.__getPlayerPosition;
  }

  scene = camera = canvas = raycaster = null;
  getPlayer = setPlayerTargetCb = clearPlayerTargetCb = feedLog = null;
  started = false;
}

export function update(dt) {
  if (!started) return;
  pollSnapshotForNpcs();
  upgradeBakedGoblins();     // Sesión 40 — barrido por-frame: si un goblin quedó
                             // horneado (T-pose) y el template YA cargó, lo pasa a
                             // animado sin esperar un snapshot nuevo.
  updateInterpolation(dt);   // sustituye al antiguo updatePatrol
  updateHpBars();
}

// Sesión 40 — Upgrade horneado→animado desacoplado del snapshot. El bug de la
// T-pose persistente venía de que el upgrade SOLO corría al llegar un snapshot
// NUEVO (pollSnapshotForNpcs). Un goblin quieto manda snapshots iguales → no se
// reprocesaba → si el template cargó tarde, quedaba horneado (T-pose) para
// siempre. Ahora barremos cada frame: barato (un Set.has + flag) y definitivo.
function upgradeBakedGoblins() {
  if (!scene) return;
  if (!npcAnimated.isReady()) return;       // template aún no listo: nada que hacer
  for (const [id, mesh] of npcMeshes.entries()) {
    const npc = mesh.userData?.npc;
    if (!npc) continue;
    if (!npcAnimated.ANIMATED_NPC_TYPES.has(npc.def_id)) continue;
    if (mesh.userData.anim) continue;        // ya es animado
    // Recrear como animado, conservando posición/rotación visual actual.
    const curX = mesh.position.x, curZ = mesh.position.z, curRotY = mesh.rotation.y;
    scene.remove(mesh);
    mesh.traverse?.(obj => {
      if (obj.geometry && !obj.userData?.shared) obj.geometry.dispose?.();
      if (obj.material && !obj.userData?.shared) {
        if (Array.isArray(obj.material)) obj.material.forEach(m => m.dispose());
        else obj.material.dispose();
      }
    });
    const fresh = createMesh(npc);
    if (!fresh) continue;
    fresh.position.x = curX; fresh.position.z = curZ; fresh.rotation.y = curRotY;
    scene.add(fresh);
    npcMeshes.set(id, fresh);
    console.log(`[npc_renderer] goblin ${id} upgradeado a animado (barrido por-frame)`);
  }
}

// ============================================================
// Lectura del snapshot global
// ============================================================
function pollSnapshotForNpcs() {
  const snap = worldSnapshot.getSnapshot();
  if (!snap) return;
  if (snap.now === lastProcessedSnapshotNow) return; // nada nuevo
  lastProcessedSnapshotNow = snap.now;
  npcDataList = snap.npcs || [];
  syncMeshes();
}

// ============================================================
// API pública — queries para minimap
// ============================================================
export function getNpcDataList() { return npcDataList; }
export function getNpcMeshes() { return npcMeshes; }

// ============================================================
// API pública — tap handling
// ============================================================
/**
 * Tap simple. Devuelve true si era un NPC y se gestionó (auto-walk +
 * engage o engage directo), false si no había NPC bajo el tap.
 */
export function tryHandleTap(clientX, clientY) {
  if (!started) return false;
  const rect = canvas.getBoundingClientRect();
  const nx = ((clientX - rect.left) / rect.width) * 2 - 1;
  const ny = -((clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera({ x: nx, y: ny }, camera);

  const npc = findNpcNearTap(clientX, clientY);
  if (!npc) return false;
  triggerNpcTap(npc.id);
  return true;
}

/**
 * Long-press: abrir menú contextual. Si no hay NPC bajo el tap, no abre.
 * Devuelve true si abrió menú.
 */
export function openActionMenuAt(cx, cy) {
  if (!started) return false;
  closeActionMenu();
  ensureActionMenuCss();

  const rect = canvas.getBoundingClientRect();
  const nx = ((cx - rect.left) / rect.width) * 2 - 1;
  const ny = -((cy - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera({ x: nx, y: ny }, camera);
  const npc = findNpcNearTap(cx, cy);
  if (!npc) return false;

  const menu = document.createElement('div');
  menu.className = 'osrs-action-menu';
  menu.innerHTML = `
    <div class="osrs-action-menu-header">${escapeHtmlSafe(npc.name)}</div>
    <div class="osrs-action-row" data-act="attack">⚔ Atacar</div>
    <div class="osrs-action-row" data-act="examine">🔍 Examinar</div>
    <div class="osrs-action-row danger" data-act="cancel">✕ Cancelar</div>
  `;
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
    });
  });

  setTimeout(() => { if (actionMenuEl === menu) closeActionMenu(); }, 5000);
  return true;
}

// ============================================================
// API pública — auto-engage (proximity check + cancel)
// ============================================================
/**
 * Llamar cada frame desde updatePlayer. Devuelve null si no hay engage
 * pendiente, o un objeto:
 *   { reached: true }                       → llegamos, cancela target en world
 *   { chasing: true, targetX, targetZ }     → seguimos persiguiendo
 */
export function tickAutoEngage(playerX, playerZ) {
  if (!started || pendingEngageNpcId === null) return null;
  const npc = npcDataList.find(n => n.id === pendingEngageNpcId);
  if (!npc) {
    pendingEngageNpcId = null;
    return null;
  }
  // Bloque 2.5: usamos mesh.position (pos interpolada actual) que YA
  // coincide con la pos server (o muy cerca, en mitad del lerp).
  const mesh = npcMeshes.get(pendingEngageNpcId);
  const tx = mesh ? mesh.position.x : npc.x;
  const tz = mesh ? mesh.position.z : npc.z;
  const dx = tx - playerX;
  const dz = tz - playerZ;
  if (Math.hypot(dx, dz) <= getNpcEngageRange()) {
    const id = pendingEngageNpcId;
    pendingEngageNpcId = null;
    combat.engageNpc(id);
    return { reached: true };
  }
  return { chasing: true, targetX: tx, targetZ: tz };
}

/**
 * Cancela el engage pendiente (típicamente cuando user mueve joystick).
 */
export function cancelAutoEngage() {
  pendingEngageNpcId = null;
}

// ============================================================
// Carga GLB
// ============================================================
async function loadGLBs() {
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

  // Sesión 39 — además del horneado (fallback), arrancamos la carga del
  // pipeline ANIMADO para los tipos que lo usan (goblin). Si falla, isReady()
  // queda false y createMesh cae al horneado de arriba. No bloquea el resto.
  for (const typeId of npcAnimated.ANIMATED_NPC_TYPES) {
    const url = NPC_GLB_URLS[typeId];
    if (url) npcAnimated.loadAnimatedTemplate(url).catch(() => {});
  }
}

// ============================================================
// Sync mesh ↔ snapshot data
// ============================================================
function syncMeshes() {
  const player = getPlayer?.();
  if (!scene || !player) return;
  const px = player.position.x;
  const pz = player.position.z;
  const aliveIds = new Set();
  const nowMs = performance.now();

  for (const npc of npcDataList) {
    const dx = npc.x - px;
    const dz = npc.z - pz;
    if (dx * dx + dz * dz > NPC_RENDER_RADIUS * NPC_RENDER_RADIUS) continue;
    aliveIds.add(npc.id);

    let mesh = npcMeshes.get(npc.id);
    if (!mesh) {
      mesh = createMesh(npc);
      if (!mesh) continue;
      scene.add(mesh);
      npcMeshes.set(npc.id, mesh);
    } else {
      // Sesión 39 FIX (el bug real del T-pose): si este NPC es de tipo animado
      // (goblin) pero su mesh se creó ANTES de que el template terminara de
      // cargar, quedó HORNEADO (sin esqueleto) para siempre → se veía en T-pose
      // y flotando, sin animar nunca. Ahora que el template está listo, lo
      // UPGRADEAMOS: quitamos el mesh horneado y creamos el animado.
      if (npcAnimated.ANIMATED_NPC_TYPES.has(npc.def_id)
          && !mesh.userData.anim
          && npcAnimated.isReady()) {
        scene.remove(mesh);
        if (mesh.userData?.anim) {
          try { npcAnimated.disposeAnimatedInstance(mesh.userData.anim); } catch {}
        }
        mesh.traverse?.(obj => {
          if (obj.geometry && !obj.userData?.shared) obj.geometry.dispose?.();
          if (obj.material && !obj.userData?.shared) {
            if (Array.isArray(obj.material)) obj.material.forEach(m => m.dispose());
            else obj.material.dispose();
          }
        });
        mesh = createMesh(npc);
        if (!mesh) continue;
        scene.add(mesh);
        npcMeshes.set(npc.id, mesh);
        console.log('[npc_renderer] goblin upgradeado a animado (template ya listo)');
      }
      // Mesh ya existía: arrancar un nuevo lerp desde la pos VISUAL actual
      // hacia la pos del nuevo snapshot. Si el delta es muy grande, snap
      // directo (probable respawn/teleport del server).
      const interp = mesh.userData.interp;
      const curX = mesh.position.x;
      const curZ = mesh.position.z;
      const newX = npc.x;
      const newZ = npc.z;
      const moveDist = Math.hypot(newX - curX, newZ - curZ);
      if (moveDist > INTERP_TELEPORT_THRESHOLD_M) {
        // Snap: no interpolar
        interp.prevX = newX;
        interp.prevZ = newZ;
        interp.targetX = newX;
        interp.targetZ = newZ;
        interp.startMs = nowMs;
        interp.durationMs = 1; // termina inmediato
      } else {
        // Lerp normal
        interp.prevX = curX;
        interp.prevZ = curZ;
        interp.targetX = newX;
        interp.targetZ = newZ;
        interp.startMs = nowMs;
        interp.durationMs = INTERP_DURATION_MS;
      }
    }
    updateHpBar(mesh, npc.hp_current, npc.max_hp);

    // ============================================================
    // Sesión 39 — Pieza 1: FEEDBACK DE COMBATE COMPARTIDO
    // ============================================================
    // Antes, el flash/hitsplat/React del NPC se disparaba SOLO en la pantalla
    // del que atacaba (combat.js, local). Resultado: si otro jugador pegaba al
    // mismo goblin, vos no veías nada. Ahora lo derivamos del SNAPSHOT: si el
    // hp_current del NPC bajó desde el snapshot anterior, hubo daño → mostramos
    // hitsplat + flash + React para TODOS los que tengan al NPC a la vista.
    //
    // De-dup: el atacante LOCAL ya mostró su hitsplat al instante (mejor feel,
    // sin esperar 250ms). Para no duplicárselo, combat.js marca el NPC vía
    // markLocalHit(); dentro de esa ventana, ignoramos el daño que ya se mostró.
    const prev = mesh.userData.npc;
    if (prev && typeof prev.hp_current === 'number' && typeof npc.hp_current === 'number') {
      const dmg = prev.hp_current - npc.hp_current;
      if (dmg > 0) {
        const supp = _localHitSuppress.get(npc.id) || 0;
        const localCovered = nowMs < supp;
        if (!localCovered) {
          // Daño causado por OTRO jugador (o por el NPC contraatacando a otro):
          // mostrarlo para que este cliente también lo vea.
          try { spawnHitsplat(npc.id, dmg); } catch {}
          try { flashHit(npc.id); } catch {}
        }
        // Sea local o remoto, limpiamos la marca tras consumirla.
        if (localCovered) _localHitSuppress.delete(npc.id);
      }
    }

    mesh.userData.npc = npc;
  }

  for (const [id, mesh] of npcMeshes.entries()) {
    if (!aliveIds.has(id)) {
      scene.remove(mesh);
      _localHitSuppress.delete(id);   // Sesión 39 — evitar leak del map de de-dup
      // Sesión 39 — liberar mixer/clon del goblin animado si lo hubiera.
      if (mesh.userData?.anim) {
        try { npcAnimated.disposeAnimatedInstance(mesh.userData.anim); } catch {}
      }
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

function createMesh(npc) {
  const typeId = npc.def_id;
  const group = new THREE.Group();
  group.position.set(npc.x, 0, npc.z);

  // Facing inicial: si el GLB tiene reverse, aplicar el offset PI desde
  // ya para que no se vea "mirando al revés" al spawnear.
  const facingOffset = NPC_FACING_REVERSED[typeId] ? Math.PI : 0;
  group.rotation.y = facingOffset;

  group.userData = {
    kind: 'npc',
    npc,
    // Bloque 2.5 — estado de interpolación entre snapshots.
    // Al crear: prev = target = pos snapshot → el lerp termina al instante
    // y la mesh aparece exactamente donde el server dice (sin saltos).
    interp: {
      prevX: npc.x,
      prevZ: npc.z,
      targetX: npc.x,
      targetZ: npc.z,
      startMs: performance.now(),
      durationMs: 1, // termina inmediato en el primer frame
      lastFacingY: facingOffset,
    },
    reaction: { until: 0, kickX: 0, kickZ: 0, wasFlashing: false },
    bodyMaterials: [],
  };

  const glb = NPC_GEOMS && NPC_GEOMS[typeId];
  // Sesión 39 — intento ANIMADO primero (goblin). Si el template no está
  // listo (assets fallaron o aún cargando), cae al horneado de abajo.
  let animInst = null;
  if (npcAnimated.ANIMATED_NPC_TYPES.has(typeId)) {
    try { animInst = npcAnimated.createAnimatedInstance(); } catch (e) { animInst = null; }
  }

  if (animInst) {
    group.add(animInst.root);
    group.userData.anim = animInst;
    // Reusar los materiales clonados de la instancia para el flash rojo.
    group.userData.bodyMaterials = animInst.bodyMaterials || [];
  } else if (glb && glb.glbParts) {
    for (const part of glb.glbParts) {
      const ownMat = part.material.clone();
      ownMat.userData = { baseColor: ownMat.color.clone() };
      const mesh = new THREE.Mesh(part.geometry, ownMat);
      mesh.userData = { kind: 'npc-body', npcId: npc.id, shared: true };
      group.add(mesh);
      group.userData.bodyMaterials.push(ownMat);
    }
  } else {
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
// Interpolación + hit reaction (Sesión 27 Bloque 2.5)
// ============================================================
//
// Reemplaza al antiguo updatePatrol(). Cada frame:
//   1. Calcular t = (now - startMs) / durationMs, clampeado a [0, 1].
//   2. Lerpear pos entre prev y target.
//   3. Facing: dirección del vector (target - prev) si la distancia es
//      perceptible. Si no, mantener la última rotación (lastFacingY).
//   4. Aplicar kick de hit reaction encima de la pos lerpeada.
//   5. Actualizar emissive del flash.
//
function updateInterpolation(dt = 0) {
  if (!scene) return;
  const nowMs = performance.now();
  const nowS = nowMs / 1000;

  for (const group of npcMeshes.values()) {
    const ud = group.userData;
    if (!ud || !ud.interp) continue;

    const I = ud.interp;

    // ---- Lerp posicional ----
    const elapsed = nowMs - I.startMs;
    let t = I.durationMs > 0 ? elapsed / I.durationMs : 1;
    if (t < 0) t = 0;
    else if (t > 1) t = 1;
    const lerpX = I.prevX + (I.targetX - I.prevX) * t;
    const lerpZ = I.prevZ + (I.targetZ - I.prevZ) * t;

    // ---- Facing ----
    // Si el NPC se está moviendo perceptiblemente en este lerp, mirar en
    // la dirección de movimiento. Si está prácticamente quieto, mantener
    // la última rotación (lastFacingY) para evitar girar erráticamente
    // por ruido sub-pixel.
    const moveDx = I.targetX - I.prevX;
    const moveDz = I.targetZ - I.prevZ;
    const moveLen2 = moveDx * moveDx + moveDz * moveDz;
    if (moveLen2 > 0.01) { // umbral 10cm
      const facingOffset = NPC_FACING_REVERSED[ud.npc?.def_id] ? Math.PI : 0;
      const targetYaw = Math.atan2(moveDx, moveDz) + facingOffset;
      // Suavizar la rotación con un lerp angular sencillo (evita snap).
      let dyaw = targetYaw - group.rotation.y;
      // Normalizar a [-PI, PI] para que no gire la vuelta entera
      while (dyaw > Math.PI) dyaw -= Math.PI * 2;
      while (dyaw < -Math.PI) dyaw += Math.PI * 2;
      // 30% por frame hacia el target → giro suave en ~5 frames.
      group.rotation.y += dyaw * 0.3;
      I.lastFacingY = group.rotation.y;
    } else {
      // NPC quieto: mantener última rotación
      group.rotation.y = I.lastFacingY;
    }

    // ---- Sesión 39 — Animación esquelética (goblin) ----
    // El goblin anima EN EL SITIO: la posición la sigue mandando el lerp de
    // arriba (server-authoritative). Aquí solo elegimos walk/quieto según si
    // hay desplazamiento en este intervalo de snapshot, y avanzamos el mixer.
    if (ud.anim) {
      // "moving" = el goblin se está desplazando entre snapshots Y el lerp aún
      // no terminó (t<1). Cuando t llega a 1 y no hay nuevo target, queda quieto.
      const moving = moveLen2 > 0.01 && t < 1;
      const speed = moving ? Math.sqrt(moveLen2) : 0;
      try {
        npcAnimated.setLocomotion(ud.anim, moving, speed);
        npcAnimated.updateAnimatedInstance(ud.anim, dt);
      } catch {}
    }

    // ---- Hit reaction kick ----
    // Sesión 39 — Para NPCs animados, el "kick" posicional se desactiva: el
    // flinch del React (animación) reemplaza el empujón. Mantenemos el flash.
    const r = ud.reaction;
    let kickX = 0, kickZ = 0;
    if (!ud.anim && r && r.until > nowS) {
      const remaining = (r.until - nowS) / NPC_REACT_DURATION_S;
      kickX = r.kickX * remaining;
      kickZ = r.kickZ * remaining;
    }

    // ---- Aplicar posición final ----
    group.position.set(lerpX + kickX, 0, lerpZ + kickZ);

    // ---- Flash emissive (rojo) durante la reacción ----
    if (ud.bodyMaterials && ud.bodyMaterials.length) {
      if (r && r.until > nowS) {
        const intensity = (r.until - nowS) / NPC_REACT_DURATION_S;
        for (const m of ud.bodyMaterials) {
          if (m && m.emissive) m.emissive.setRGB(intensity * 0.8, 0, 0);
        }
      } else if (r && r.wasFlashing) {
        for (const m of ud.bodyMaterials) {
          if (m && m.emissive) m.emissive.setRGB(0, 0, 0);
        }
        r.wasFlashing = false;
      }
    }
  }
}

function flashHit(npcId) {
  const group = npcMeshes.get(npcId);
  if (!group || !group.userData) return;
  const player = getPlayer?.();
  if (!player) return;

  // Sesión 39 — Si el NPC es animado, disparar la animación React (flinch).
  // El flash rojo se mantiene (abajo, vía r.wasFlashing) pero el kick NO.
  if (group.userData.anim) {
    try { npcAnimated.triggerReact(group.userData.anim); } catch {}
    const r = group.userData.reaction;
    r.until = (performance.now() / 1000) + NPC_REACT_DURATION_S;
    r.wasFlashing = true;
    return;
  }

  // Bloque 2.5: kick desde la pos visual actual (lerpeada) hacia donde el
  // player NO está — empuja al NPC en dirección opuesta al player.
  const cx = group.position.x;
  const cz = group.position.z;
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

function updateHpBar(npcMesh, cur, max) {
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

function updateHpBars() {
  if (!camera) return;
  // HP bar mira a cámara: usar world quaternion de la cámara, descontar el
  // world quaternion del padre (el NPC group puede rotar).
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

// ============================================================
// Tap detection (sin cambios respecto a versiones previas)
// ============================================================
/**
 * Estrategia de 2 pasos para detectar tap sobre NPC en móvil:
 *
 *   Paso 1: raycast clásico (solo cuenta si pegamos en el mesh exacto).
 *   Paso 2: si el raycast falló, screen-space: buscar el NPC más cercano
 *           al tap dentro de NPC_TAP_SCREEN_PX (90px).
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
  // Paso 2: proximidad screen-space dentro de NPC_TAP_SCREEN_PX
  const rect = canvas.getBoundingClientRect();
  const localX = clientX - rect.left;
  const localY = clientY - rect.top;
  const tmpV = new THREE.Vector3();
  let best = null;
  let bestDist = NPC_TAP_SCREEN_PX;
  for (const [npcId, group] of npcMeshes) {
    const npcData = npcDataList.find(n => n.id === npcId);
    if (!npcData) continue;
    const targetH = NPC_TARGET_HEIGHTS[npcData.def_id] || 1.0;
    tmpV.set(group.position.x, group.position.y + targetH * 0.5, group.position.z);
    tmpV.project(camera);
    if (tmpV.z > 1 || tmpV.z < -1) continue;
    const sx = (tmpV.x * 0.5 + 0.5) * rect.width;
    const sy = (-tmpV.y * 0.5 + 0.5) * rect.height;
    const d = Math.hypot(sx - localX, sy - localY);
    if (d < bestDist) { bestDist = d; best = npcData; }
  }
  return best;
}

/**
 * Si estás cerca → engage directo. Si lejos → auto-walk hasta llegar y
 * enganchar (vía tickAutoEngage en el animate loop).
 *
 * Bloque 2.5: ya no congelamos posición visual del NPC (`frozenX/Z`).
 * Eso era un hack para compensar el patrol orbital. Sin patrol, la pos
 * visual ES la pos server (con leve lerp) → al hacer tap el target está
 * donde ves.
 */
function triggerNpcTap(npcId) {
  const npc = npcDataList.find(n => n.id === npcId);
  if (!npc) return;
  const player = getPlayer?.();
  if (!player) return;
  // Usar la pos VISUAL (lerpeada) del NPC, que ahora coincide con la pos
  // server.
  const mesh = npcMeshes.get(npcId);
  const targetX = mesh ? mesh.position.x : npc.x;
  const targetZ = mesh ? mesh.position.z : npc.z;

  const dx = targetX - player.position.x;
  const dz = targetZ - player.position.z;
  const dist = Math.hypot(dx, dz);
  pendingEngageNpcId = npcId;
  if (dist <= getNpcEngageRange()) {
    pendingEngageNpcId = null;
    combat.engageNpc(npcId);
  } else {
    setPlayerTargetCb(targetX, targetZ);
    feedLog('info', `Vas hacia ${npc.name}...`);
  }
}

// ============================================================
// Action menu (long-press) + Examine
// ============================================================
export function closeActionMenu() {
  if (!actionMenuEl) return;
  actionMenuEl.remove();
  actionMenuEl = null;
}

function examineNpc(npc) {
  feedLog('info', `${npc.name} — nivel ${npc.attack_lvl}, ${npc.max_hp} HP.`);
}

function escapeHtmlSafe(s) {
  if (s == null) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ============================================================
// Hitsplats DOM
// ============================================================
function spawnHitsplat(npcId, damage) {
  const group = npcMeshes.get(npcId);
  if (!group) return;
  ensureActionMenuCss();
  const layer = ensureHitsplatLayer();

  const npc = npcDataList.find(n => n.id === npcId);
  const targetH = npc ? (NPC_TARGET_HEIGHTS[npc.def_id] || 1.0) : 1.0;
  const v = new THREE.Vector3(group.position.x, group.position.y + targetH * 0.85, group.position.z);
  v.project(camera);
  if (v.z > 1 || v.z < -1) return;
  const rect = canvas.getBoundingClientRect();
  const sx = (v.x * 0.5 + 0.5) * rect.width;
  const sy = (-v.y * 0.5 + 0.5) * rect.height;
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

function ensureHitsplatLayer() {
  if (hitsplatLayerEl) return hitsplatLayerEl;
  const parent = document.getElementById('worldScreen') || document.body;
  hitsplatLayerEl = document.createElement('div');
  hitsplatLayerEl.className = 'osrs-hitsplat-layer';
  parent.appendChild(hitsplatLayerEl);
  return hitsplatLayerEl;
}

// ============================================================
// CSS (action menu + hitsplats)
// ============================================================
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
    .osrs-hitsplat.dmg {
      background: radial-gradient(ellipse at 35% 35%, #c83030, #800000 70%);
      border: 1.5px solid #200000;
      border-radius: 50% 50% 50% 0;
      transform-origin: center;
      transform: translate(-50%, -50%) rotate(-45deg);
    }
    .osrs-hitsplat.dmg span { transform: rotate(45deg); display:block; }
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
