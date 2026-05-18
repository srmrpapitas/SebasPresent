/**
 * SebasPresent — NPC Renderer module (Sesión 6 refactor)
 *
 * Sesión 27 Bloque 2: La FUENTE DE NPCs cambia. Antes:
 *   - combat.onUpdate(({npcs}) => syncMeshes())  cada vez que combat polea
 *     /api/combat/state (cada 5s).
 *   - combat.refresh() inicial para arrancar.
 *
 * Ahora:
 *   - Leemos npcs desde world_snapshot.getNpcs() en cada frame. El polling
 *     del snapshot va a 250ms (4Hz), así que los NPCs se mueven/pierden HP
 *     20× más rápido en pantalla.
 *   - Usamos un guard "lastProcessedSnapshotNow" para llamar syncMeshes()
 *     SOLO cuando hay un snapshot nuevo, no en cada frame. Eso evita CPU
 *     innecesaria cuando no hay datos nuevos.
 *
 * combat.js sigue intacto: continúa poleando /api/combat/state para tener
 * stats del player, currentTarget, level-ups, etc. No le tocamos nada.
 * Los hooks window.__worldFlashNpcHit y window.__worldSpawnHitsplat siguen
 * vivos para que combat.js dispare los efectos visuales al recibir hits.
 *
 * --- resto del comentario original ---
 *
 * Sesión 20 fixes:
 *   - Tap más perdonable: NPC_TAP_SCREEN_PX 56 → 90, busca el NPC más
 *     cercano al tap dentro del radio aunque el raycast NO acierte.
 *   - NPC_ENGAGE_RANGE 1.4 → 2.0 (margen melee). Coincide con server.
 *   - PERSEGUIR durante combate: si el NPC se aleja >MELEE_RANGE, el cliente
 *     ordena auto-walk hacia él para no atacar de lejos. Esto soluciona
 *     "pego desde lejos sin moverme".
 *
 * Todo lo relacionado con NPCs:
 *   - Carga de GLBs por tipo (chicken, cow, goblin...) con placeholder fallback.
 *   - Mesh creation por NPC con HP bar billboard + materiales propios.
 *   - Patrol procedural (cada NPC orbita su spawn point).
 *   - Hit reaction (kick + flash rojo emissive) al recibir golpe del player.
 *   - HP bars 2D que miran a cámara.
 *   - Tap (raycast + screen-space proximity) y long-press (menú acciones).
 *   - Auto-engage: caminar hacia un NPC tapeado lejos y enganchar al llegar.
 *   - Hitsplats DOM (gota roja con daño / escudo azul con miss).
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as combat from './combat.js';
import * as worldSnapshot from './world_snapshot.js';   // Sesión 27 Bloque 2
import { bakeGlbModel } from './terrain.js';

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

// Sesión 25 — Algunos modelos GLB vienen con el "frente" mirando en la
// dirección -Z en lugar de la +Z que three.js asume por defecto. Para esos,
// añadimos PI a la rotación Y para que caminen mirando hacia delante.
// La vaca tenía este bug: caminaba hacia atrás en la patrulla.
const NPC_FACING_REVERSED = { cow: true };

// ============================================================
// Constantes de comportamiento
// ============================================================
const NPC_PATROL_RADIUS    = 3.0;
const NPC_PATROL_SPEED_RPS = 0.18;
const NPC_PATROL_BOB_AMP   = 0.04;
const NPC_PATROL_BOB_HZ    = 1.8;

const NPC_REACT_DURATION_S = 0.18;
const NPC_REACT_KICK_DIST  = 0.35;

// Sesión 27 Bloque 2 — NPC_POLL_INTERVAL_MS eliminado. Ya no poleamos.
// El snapshot global llega cada 250ms via world_snapshot.js.

const NPC_RENDER_RADIUS    = 100;
export const NPC_MINIMAP_RADIUS = 500;

// Sesión 20 — engage range subido a 2.0 (era 1.4) para coincidir con melee
// del server. Tap screen-space radius subido a 90px (era 56) — hit-box más
// generosa en móvil.
const NPC_ENGAGE_RANGE     = 2.0;
const NPC_TAP_SCREEN_PX    = 90;

// Sesión 20 — Si estoy peleando contra un NPC y se aleja más de este rango,
// el cliente auto-walk hacia él para no pegar de lejos (server rechazará
// el attack si excede su tolerancia). Antes el cliente solo perseguía
// ANTES de engage, no DESPUÉS. Resultado: te alejabas y seguías pegando.
const COMBAT_FOLLOW_RANGE  = 2.5;

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
// Sesión 27 Bloque 2 — guard para procesar el snapshot solo cuando es nuevo.
// Se compara contra worldSnapshot.getSnapshot().now (timestamp server).
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

  // Sesión 27 Bloque 2 — Ya no nos suscribimos a combat.onUpdate ni hacemos
  // combat.refresh() inicial. La lista de NPCs llega vía world_snapshot
  // poleando /api/world/snapshot cada 250ms. Se procesa en update(dt).

  // Hooks globales para que combat.js dispare efectos visuales sin tener que
  // importarnos directamente (evita circular imports).
  if (typeof window !== 'undefined') {
    window.__worldFlashNpcHit = flashHit;
    window.__worldSpawnHitsplat = spawnHitsplat;
    // Sesión 27 — hook para que combat.js mande la pos actual del player
    // en el body del attack. Devuelve {x, z} o null si no hay player aún.
    window.__getPlayerPosition = () => {
      const p = getPlayer?.();
      if (!p || !p.position) return null;
      return { x: p.position.x, z: p.position.z };
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
    // Sesión 27 — cleanup del hook de posición
    if (window.__getPlayerPosition) delete window.__getPlayerPosition;
  }

  scene = camera = canvas = raycaster = null;
  getPlayer = setPlayerTargetCb = clearPlayerTargetCb = feedLog = null;
  started = false;
}

export function update(dt) {
  if (!started) return;
  // Sesión 27 Bloque 2 — Leer NPCs del snapshot global. Solo procesa si hay
  // snapshot nuevo (timestamp distinto del último visto), evitando ejecutar
  // syncMeshes() en cada frame cuando no hay datos nuevos.
  pollSnapshotForNpcs();
  updatePatrol(dt);
  updateHpBars();
  // Sesión 20 — perseguir NPC si me alejo durante combate
  updateCombatFollow();
}

// ============================================================
// Sesión 27 Bloque 2 — Lectura de NPCs del snapshot global
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
 * Tap simple. Devuelve true si era un NPC y se gestionó (auto-walk + engage
 * o engage directo), false si no había NPC bajo el tap.
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
  const mesh = npcMeshes.get(pendingEngageNpcId);
  const tx = mesh ? mesh.position.x : npc.x;
  const tz = mesh ? mesh.position.z : npc.z;
  const dx = tx - playerX;
  const dz = tz - playerZ;
  if (Math.hypot(dx, dz) <= NPC_ENGAGE_RANGE) {
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
// Sesión 20 — Follow target durante combate activo
// ============================================================
/**
 * Si estoy peleando contra un NPC (combat.currentTarget != null) y el NPC
 * está más lejos de COMBAT_FOLLOW_RANGE metros, ordeno auto-walk hacia él.
 *
 * Por qué: antes, una vez engaged, el cliente NO perseguía. Si el NPC
 * orbitaba o tú te alejabas, seguías pegando "desde lejos" porque el
 * server validaba contra una posición vieja (guardada cada 10s).
 *
 * Ahora: el cliente persigue activamente al NPC. Si te alejas a propósito
 * (joystick), tu joystick cancela el playerTarget en updatePlayer y el
 * server eventualmente rechaza por out_of_range. Si NO te alejas, te
 * mantienes pegado al NPC en su órbita.
 */
function updateCombatFollow() {
  let engagedId = null;
  try {
    const snap = combat.getStateSnapshot?.();
    engagedId = snap ? snap.currentTarget : null;
  } catch {}
  if (engagedId === null || engagedId === undefined) return;
  const player = getPlayer?.();
  if (!player) return;
  const mesh = npcMeshes.get(engagedId);
  if (!mesh) return;
  const tx = mesh.position.x;
  const tz = mesh.position.z;
  const dx = tx - player.position.x;
  const dz = tz - player.position.z;
  const dist = Math.hypot(dx, dz);
  if (dist > COMBAT_FOLLOW_RANGE) {
    // Ordenar walk hacia el NPC. Esto setea playerTarget en world.js que
    // mueve al player en el siguiente frame.
    setPlayerTargetCb(tx, tz);
  }
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
}

// ============================================================
// Sync mesh ↔ data list
// ============================================================
function syncMeshes() {
  const player = getPlayer?.();
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
      mesh = createMesh(npc);
      if (!mesh) continue;
      scene.add(mesh);
      npcMeshes.set(npc.id, mesh);
    }
    // Server pos = patrol CENTER. Solo re-anclamos si reportó cambio grande
    // (>2m): respawn o reposicionamiento real.
    // Sesión 26 — pero NO re-anclar si el NPC está engaged o pending engage:
    // un cambio del server (p.ej. respawn con jitter) no debe hacer saltar
    // la mesh visualmente cuando el player ya la ha seleccionado.
    let engagedSnap = null;
    try { engagedSnap = combat.getStateSnapshot?.()?.currentTarget; } catch {}
    const isLockedToPlayer = (npc.id === engagedSnap) || (npc.id === pendingEngageNpcId);
    const pp = mesh.userData.patrol;
    if (pp && !isLockedToPlayer) {
      const ddx = npc.x - pp.centerX;
      const ddz = npc.z - pp.centerZ;
      if (ddx*ddx + ddz*ddz > 4.0) {
        pp.centerX = npc.x;
        pp.centerZ = npc.z;
      }
    }
    updateHpBar(mesh, npc.hp_current, npc.max_hp);
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

function createMesh(npc) {
  const typeId = npc.def_id;
  const group = new THREE.Group();
  group.position.set(npc.x, 0, npc.z);
  group.userData = {
    kind: 'npc',
    npc,
    patrol: {
      centerX: npc.x,
      centerZ: npc.z,
      angle:   Math.random() * Math.PI * 2,
      bobT:    Math.random() * Math.PI * 2,
    },
    reaction: { until: 0, kickX: 0, kickZ: 0 },
    bodyMaterials: [],
  };

  const glb = NPC_GEOMS && NPC_GEOMS[typeId];
  if (glb && glb.glbParts) {
    for (const part of glb.glbParts) {
      // Material propio por NPC para flashear independientemente.
      // Geometría sí compartida.
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
// Patrol + hit reaction
// ============================================================
function updatePatrol(dt) {
  if (!scene) return;
  let engagedId = null;
  try {
    const snap = combat.getStateSnapshot?.();
    engagedId = snap ? snap.currentTarget : null;
  } catch {}

  const now = performance.now() / 1000;

  for (const [npcId, group] of npcMeshes) {
    const ud = group.userData;
    if (!ud) continue;

    const p = ud.patrol;
    if (p) {
      let baseX = p.centerX;
      let baseZ = p.centerZ;
      let baseY = 0;

      // Sesión 26 — Bug fix: ANTES la órbita seguía aunque el player
      // hubiera tappeado el NPC (pendingEngageNpcId). El target visual
      // se movía mientras el player corría, y el player veía que se
      // desplazaba "un poco a donde tendría que estar". Ahora pausamos
      // la órbita tanto si está engaged como si está pendiente de engage.
      const isPaused = (npcId === engagedId) || (npcId === pendingEngageNpcId);
      if (!isPaused) {
        // Sesión 26 — al volver a estado normal (ya no paused), limpiar
        // la posición congelada por si fue establecida en un tap anterior.
        if (p.frozenX !== undefined) {
          p.frozenX = undefined;
          p.frozenZ = undefined;
        }
        p.angle += NPC_PATROL_SPEED_RPS * dt;
        p.bobT  += NPC_PATROL_BOB_HZ * Math.PI * 2 * dt;
        const dx = Math.cos(p.angle) * NPC_PATROL_RADIUS;
        const dz = Math.sin(p.angle) * NPC_PATROL_RADIUS;
        baseX += dx;
        baseZ += dz;
        baseY  = Math.abs(Math.sin(p.bobT)) * NPC_PATROL_BOB_AMP;
        const tx = -Math.sin(p.angle);
        const tz =  Math.cos(p.angle);
        // Sesión 25 — corregir vacas hacia atrás. NPC_FACING_REVERSED añade
        // PI a la rotación para modelos cuyo frente apunta a -Z en lugar de +Z.
        const facingOffset = NPC_FACING_REVERSED[ud.npc?.def_id] ? Math.PI : 0;
        group.rotation.y = Math.atan2(tx, tz) + facingOffset;
      } else if (p.frozenX !== undefined) {
        // Sesión 26 — Usar la posición FROZEN capturada al hacer tap.
        // Esto sobreescribe cualquier recálculo orbital y previene saltos
        // si syncMeshes re-ancla el centro mientras está pendiente engage.
        baseX = p.frozenX;
        baseZ = p.frozenZ;
        baseY = Math.abs(Math.sin(p.bobT)) * NPC_PATROL_BOB_AMP;
      } else {
        // Fallback (no frozenX): mantener última posición orbital.
        const dx = Math.cos(p.angle) * NPC_PATROL_RADIUS;
        const dz = Math.sin(p.angle) * NPC_PATROL_RADIUS;
        baseX += dx;
        baseZ += dz;
        baseY = Math.abs(Math.sin(p.bobT)) * NPC_PATROL_BOB_AMP;
      }

      const r = ud.reaction;
      let kickX = 0, kickZ = 0;
      if (r && r.until > now) {
        const remaining = (r.until - now) / NPC_REACT_DURATION_S;
        kickX = r.kickX * remaining;
        kickZ = r.kickZ * remaining;
      }

      group.position.set(baseX + kickX, baseY, baseZ + kickZ);
    }

    // Flash rojo via emissive (no .color, para no machacar texturas/base)
    if (ud.bodyMaterials && ud.bodyMaterials.length) {
      const r = ud.reaction;
      if (r && r.until > now) {
        const intensity = (r.until - now) / NPC_REACT_DURATION_S;
        for (const m of ud.bodyMaterials) {
          if (m && m.emissive) m.emissive.setRGB(intensity * 0.8, 0, 0);
        }
      } else if (ud.reaction && ud.reaction.wasFlashing) {
        for (const m of ud.bodyMaterials) {
          if (m && m.emissive) m.emissive.setRGB(0, 0, 0);
        }
        ud.reaction.wasFlashing = false;
      }
    }
  }
}

function flashHit(npcId) {
  const group = npcMeshes.get(npcId);
  if (!group || !group.userData) return;
  const player = getPlayer?.();
  if (!player) return;
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
  // world quaternion del padre (NPC group rota con patrol).
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

// Sesión 27 Bloque 2 — updatePolling() eliminado. Ya no poleamos directamente
// /api/combat/state desde aquí. Los datos vienen del world_snapshot (250ms).

// ============================================================
// Tap detection (Sesión 20 — más perdonable)
// ============================================================
/**
 * Estrategia de 2 pasos para detectar tap sobre NPC en móvil:
 *
 *   Paso 1: raycast clásico (solo cuenta si pegamos en el mesh exacto).
 *   Paso 2: si el raycast falló, screen-space: buscar el NPC más cercano
 *           al tap dentro de NPC_TAP_SCREEN_PX. Subido a 90px en sesión 20
 *           (era 56px) — hit-box generosa para dedos en mobile.
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
 * Si estás cerca → engage directo, si lejos → auto-walk hasta llegar y
 * enganchar (vía tickAutoEngage en el animate loop).
 */
function triggerNpcTap(npcId) {
  const npc = npcDataList.find(n => n.id === npcId);
  if (!npc) return;
  const player = getPlayer?.();
  if (!player) return;
  // Usar posición VISUAL del NPC (orbitando), no npc.x/z (centro del server).
  const mesh = npcMeshes.get(npcId);
  const targetX = mesh ? mesh.position.x : npc.x;
  const targetZ = mesh ? mesh.position.z : npc.z;

  // Sesión 26 — Bug fix: congelar la posición visual del NPC en el
  // instante exacto del tap. Antes, si entre el tap y el engage final
  // entraba un syncMeshes que detectara un cambio >2m en npc.x/z del
  // server (p.ej. respawn con jitter), el patrol se re-anclaba y la
  // mesh saltaba unos metros — el player veía que el NPC "se movía a
  // donde tendría que estar". Con frozenX/Z, updatePatrol y syncMeshes
  // respetan esta posición mientras el NPC esté seleccionado/pending.
  if (mesh && mesh.userData.patrol) {
    mesh.userData.patrol.frozenX = targetX;
    mesh.userData.patrol.frozenZ = targetZ;
  }

  const dx = targetX - player.position.x;
  const dz = targetZ - player.position.z;
  const dist = Math.hypot(dx, dz);
  pendingEngageNpcId = npcId;
  if (dist <= NPC_ENGAGE_RANGE) {
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
