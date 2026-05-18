/**
 * SebasPresent — Multiplayer module
 *
 * Sesión 27 Bloque 3 — REFACTOR SERVER-AUTHORITATIVE (PVP-ready)
 * ============================================================
 *
 * ANTES: este módulo tenía su propio poll a /api/world/peers cada 500ms.
 *
 * AHORA: leemos los peers del world_snapshot global (poll 250ms unificado
 * con NPCs). Esto da:
 *   - 50% menos requests al server (1 endpoint en vez de 2).
 *   - Peers se mueven 2× más fluido (snap cada 250ms vs 500ms).
 *   - Misma fuente de verdad que NPCs → consistencia total para PVP:
 *     si vas a atacar a un peer y ves su mesh visualmente al lado, el
 *     server cree que está exactamente ahí también (con leve lerp).
 *
 * El HEARTBEAT (cliente → server) sigue corriendo cada 500ms. Es 1-way
 * y necesario para que el server sepa nuestra pos.
 *
 * Interpolación reducida de 500ms a 280ms (mismo valor que NPCs) para
 * que los peers se sientan responsivos.
 *
 * --- resto del comentario original ---
 *
 * Slice 5c.5 — peers locales (otros jugadores cercanos).
 *
 * Sesión 18: añadida HP bar doble cara (verde/rojo) sobre cada peer.
 *
 * Responsabilidades:
 *   - Heartbeat: cada 500ms envía tu posición/yaw/estado al server.
 *   - Lectura snapshot: cada update(), comprueba si el world_snapshot
 *     tiene un timestamp nuevo y procesa los peers actualizados.
 *   - Render: por cada peer, crea un grupo 3D (clon de Nico si está
 *     disponible, fallback cápsula si no) + un nameTag DOM flotante
 *     + una HP bar DOM flotante.
 *   - Interpolación: cada frame, mueve cada peer suavemente entre el
 *     último snapshot recibido y el actual.
 *
 * Debug:
 *   En consola: window.__mpPlayers()  → tabla de peers activos.
 */

import * as THREE from 'three';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import * as worldSnapshot from './world_snapshot.js';

// ============================================================
// Constantes
// ============================================================
const MP_HEARTBEAT_INTERVAL = 500;     // ms entre heartbeats al server
const MP_PEER_INTERP_MS     = 280;     // ms de interpolación visual (≈ período snapshot + buffer)
const MP_PEER_TIMEOUT_MS    = 10_000;  // sin update tras esto → peer offline

const NICO_Y_OFFSET = -1.03;           // mismo offset que el player principal
const NAME_TAG_HEIGHT = 2.0;           // m sobre el grupo del peer
const HP_BAR_OFFSET_PX = 16;           // px arriba del name tag

// ============================================================
// Estado del módulo (privado)
// ============================================================
let scene = null;
let camera = null;
let canvas = null;
let playerRef = null;       // ref al group del player local
let characterRef = null;    // ref a la instancia Character (para clonar Nico)
let authToken = null;
let apiBase = null;

let mpLastPeerMap = new Map();   // user_id → peer { group, mixer, actions, ... }
let mpHeartbeatTimer = 0;
let mpInFlightHeartbeat = false;
let mpPlayerState = 'idle';

// Sesión 27 Bloque 3 — guard: solo procesamos peers cuando el snapshot
// global tiene un timestamp nuevo respecto al último visto.
let mpLastProcessedSnapshotNow = 0;

// Velocidad del player local, para reportar state al server
let _lastPlayerX = 0, _lastPlayerZ = 0, _lastSpeedTime = 0;

let started = false;

// Sesión 18 — estilos CSS para HP bar de peers (inyectados una sola vez)
let hpBarStylesInjected = false;

// ============================================================
// API pública
// ============================================================

export function start(opts) {
  if (started) {
    console.warn('[multiplayer] start() llamado dos veces sin stop()');
    stop();
  }
  scene        = opts.scene;
  camera       = opts.camera;
  canvas       = opts.canvas;
  playerRef    = opts.player;
  characterRef = opts.character;
  authToken    = opts.authToken;
  apiBase      = opts.apiBase;

  mpHeartbeatTimer = 0;
  mpInFlightHeartbeat = false;
  mpPlayerState = 'idle';
  mpLastProcessedSnapshotNow = 0;
  _lastSpeedTime = 0;

  // Sesión 18 — estilos HP bar
  ensurePeerHpBarStyles();

  // Hook de debug accesible desde Eruda
  if (typeof window !== 'undefined') {
    window.__mpPlayers = debugListPlayers;
  }

  started = true;
}

export function stop() {
  if (!started) return;
  for (const userId of Array.from(mpLastPeerMap.keys())) {
    removePeer(userId);
  }
  mpLastPeerMap.clear();
  scene = camera = canvas = null;
  playerRef = characterRef = null;
  authToken = apiBase = null;
  mpHeartbeatTimer = 0;
  mpLastProcessedSnapshotNow = 0;
  started = false;
}

/**
 * Actualiza el sistema de multiplayer un frame. Llamar desde el loop
 * de animación del mundo. dt en segundos.
 */
export function update(dt) {
  if (!started) return;
  if (!authToken || !playerRef) return;

  // 1) Heartbeat periódico (cliente → server, sigue siendo 500ms)
  mpHeartbeatTimer += dt * 1000;
  if (mpHeartbeatTimer >= MP_HEARTBEAT_INTERVAL && !mpInFlightHeartbeat) {
    mpHeartbeatTimer = 0;
    sendHeartbeat();
  }

  // 2) Sesión 27 Bloque 3 — Procesar peers del world_snapshot global.
  // El snapshot se actualiza cada 250ms server-side. Aquí solo procesamos
  // si el timestamp del snap ha cambiado respecto al último visto.
  processSnapshotPeers();

  // 3) Interpolar peers + actualizar mixers + name tags
  const now = performance.now();
  for (const [userId, peer] of mpLastPeerMap) {
    if (!peer.group) continue;

    // Limpieza por timeout
    if (Date.now() - peer.lastUpdate > MP_PEER_TIMEOUT_MS) {
      removePeer(userId);
      continue;
    }

    // Interpolación lineal posición + yaw (shortest path)
    const t = Math.min(1, (now - peer.interpStart) / MP_PEER_INTERP_MS);
    peer.group.position.x = peer.fromX + (peer.toX - peer.fromX) * t;
    peer.group.position.z = peer.fromZ + (peer.toZ - peer.fromZ) * t;
    let dyaw = peer.toYaw - peer.fromYaw;
    while (dyaw > Math.PI) dyaw -= Math.PI * 2;
    while (dyaw < -Math.PI) dyaw += Math.PI * 2;
    peer.group.rotation.y = peer.fromYaw + dyaw * t;

    // Mixer (solo si es Nico clonado)
    if (peer.mixer) peer.mixer.update(dt);

    // Crossfade entre clips según state. Los clips reales (de Character)
    // se llaman 'idle', 'run_forward', 'walk_forward', 'attack_1', etc.,
    // NO 'run' o 'attack' a secas. Aquí hacemos el mapeo state → clip.
    if (peer.actions && Object.keys(peer.actions).length > 0) {
      let desiredName = 'idle';
      if (peer.state === 'run')         desiredName = 'run_forward';
      else if (peer.state === 'walk')   desiredName = 'walk_forward';
      else if (peer.state === 'attack') desiredName = 'attack_1';
      // Fallback chain: el clip pedido → run_forward → idle.
      // (Si el server reporta 'walk' pero solo cargó 'run_forward', usa run.)
      const desiredAction =
        peer.actions[desiredName] ||
        peer.actions.run_forward ||
        peer.actions.idle;
      if (desiredAction && desiredAction !== peer.currentAction) {
        desiredAction.reset();
        desiredAction.play();
        if (peer.currentAction) {
          desiredAction.crossFadeFrom(peer.currentAction, 0.22, true);
        }
        peer.currentAction = desiredAction;
      }
    }

    // Name tag + HP bar DOM sobre la cabeza
    if (peer.nameTagDiv) updatePeerNameTag(peer);
  }
}

/**
 * Devuelve las posiciones de todos los peers visibles. Lo usa el minimap
 * de world.js para pintar puntos azules. Iterable de {x, z, username}.
 */
export function getPeerPositions() {
  const result = [];
  for (const peer of mpLastPeerMap.values()) {
    if (!peer.group) continue;
    result.push({
      x: peer.group.position.x,
      z: peer.group.position.z,
      username: peer.username,
    });
  }
  return result;
}

// ============================================================
// Sesión 27 Bloque 3 — API pública para PVP (Bloque 3 tanda 2)
// ============================================================
/**
 * Devuelve el peer (objeto interno con su group THREE) por user_id, o null.
 * Lo usa combat.js / npc_renderer.js para resolver target PVP.
 */
export function getPeerById(userId) {
  return mpLastPeerMap.get(userId) || null;
}

/**
 * Posición VISUAL actual del peer (la interpolada, no la última snapshot).
 * Devuelve {x, z} o null. Esto es lo que combat.js usará para validar el
 * rango client-side y para el auto-engage PVP.
 */
export function getPeerVisualPosition(userId) {
  const peer = mpLastPeerMap.get(userId);
  if (!peer || !peer.group) return null;
  return { x: peer.group.position.x, z: peer.group.position.z };
}

/**
 * Itera todos los peers para tap-detection. Devuelve array de:
 *   { user_id, username, x, z, group, hp_current, hp_max, combat_lvl }
 * usando la pos VISUAL (interpolada).
 */
export function getPeersForTap() {
  const out = [];
  for (const [userId, peer] of mpLastPeerMap) {
    if (!peer.group) continue;
    out.push({
      user_id:    userId,
      username:   peer.username,
      x:          peer.group.position.x,
      z:          peer.group.position.z,
      group:      peer.group,
      hp_current: peer.hp,
      hp_max:     peer.hpMax,
      combat_lvl: peer.combatLvl || 1,
    });
  }
  return out;
}

// ============================================================
// Heartbeat — envía mi posición al server
// ============================================================
async function sendHeartbeat() {
  mpInFlightHeartbeat = true;
  try {
    const speed = computePlayerSpeed();
    let state = 'idle';
    if (speed > 0.1) state = 'run';  // todo es 'run' por ahora (no hay walk anim)
    mpPlayerState = state;

    await fetch(`${apiBase}/api/world/heartbeat`, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + authToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        x: playerRef.position.x,
        z: playerRef.position.z,
        yaw: playerRef.rotation.y,
        state,
      }),
    });
  } catch (err) {
    // Silencioso — no spammear si la red se cae 1s
  } finally {
    mpInFlightHeartbeat = false;
  }
}

function computePlayerSpeed() {
  const now = performance.now();
  if (!_lastSpeedTime) {
    _lastSpeedTime = now;
    _lastPlayerX = playerRef.position.x;
    _lastPlayerZ = playerRef.position.z;
    return 0;
  }
  const dt = (now - _lastSpeedTime) / 1000;
  if (dt < 0.05) return 0;
  const dx = playerRef.position.x - _lastPlayerX;
  const dz = playerRef.position.z - _lastPlayerZ;
  const dist = Math.hypot(dx, dz);
  const speed = dist / dt;
  _lastSpeedTime = now;
  _lastPlayerX = playerRef.position.x;
  _lastPlayerZ = playerRef.position.z;
  return speed;
}

// ============================================================
// Sesión 27 Bloque 3 — Procesar peers desde el snapshot global
// ============================================================
//
// Sustituye al antiguo pollPeers() que hacía fetch a /api/world/peers
// cada 500ms. Ahora leemos los players[] del world_snapshot que ya está
// haciendo poll cada 250ms — una sola petición sirve para NPCs + peers.
function processSnapshotPeers() {
  const snap = worldSnapshot.getSnapshot();
  if (!snap) return;
  if (snap.now === mpLastProcessedSnapshotNow) return; // nada nuevo
  mpLastProcessedSnapshotNow = snap.now;

  const peers = snap.players || [];
  const seenIds = new Set();
  for (const p of peers) {
    seenIds.add(p.user_id);
    upsertPeer(p);
  }
  // Quitar peers que ya no aparecen en el snapshot (salieron del radio
  // o desconectaron). Damos 2s de gracia por si fue un snapshot perdido.
  for (const userId of mpLastPeerMap.keys()) {
    if (!seenIds.has(userId)) {
      const peer = mpLastPeerMap.get(userId);
      if (Date.now() - peer.lastUpdate > 2000) {
        removePeer(userId);
      }
    }
  }
}

// ============================================================
// Gestión de peers
// ============================================================
function upsertPeer(p) {
  let peer = mpLastPeerMap.get(p.user_id);
  if (!peer) {
    peer = createPeer(p);
    mpLastPeerMap.set(p.user_id, peer);
  }
  // Nueva interpolación: from = posición visual actual, to = la del server
  peer.fromX = peer.group.position.x;
  peer.fromZ = peer.group.position.z;
  peer.fromYaw = peer.group.rotation.y;
  peer.toX = p.x;
  peer.toZ = p.z;
  peer.toYaw = p.yaw || 0;
  peer.state = p.state || 'idle';
  peer.interpStart = performance.now();
  peer.lastUpdate = Date.now();

  // HP actual y máximo
  if (typeof p.hp_current === 'number') peer.hp = p.hp_current;
  if (typeof p.hp_max === 'number') peer.hpMax = p.hp_max;

  // Sesión 27 Bloque 3 — Niveles + combat_lvl (los necesita el menú PVP
  // para mostrar "Atacar a Nico (lvl 7)"). Si el server no los devuelve
  // todavía, defaults seguros.
  if (typeof p.combat_lvl === 'number') peer.combatLvl = p.combat_lvl;
  if (typeof p.attack_lvl === 'number') peer.attackLvl = p.attack_lvl;
  if (typeof p.strength_lvl === 'number') peer.strengthLvl = p.strength_lvl;
  if (typeof p.defence_lvl === 'number') peer.defenceLvl = p.defence_lvl;
  if (typeof p.in_combat === 'boolean') peer.inCombat = p.in_combat;
}

function createPeer(p) {
  const group = new THREE.Group();
  group.position.set(p.x, 0, p.z);
  group.rotation.y = p.yaw || 0;

  let peerMixer = null;
  let peerActions = {};
  let usedNico = false;

  // Slice 5c.5 — Nico clonado: si el character principal está cargado,
  // clonamos su skeleton/mesh con SkeletonUtils para que cada peer se vea
  // como Nico con su propio mixer (independiente del player principal).
  if (characterRef?.loaded && characterRef.mesh && characterRef.clips) {
    try {
      // SkeletonUtils.clone preserva el esqueleto correctamente — un simple
      // .clone() del mesh comparte el skeleton entre instancias y se queda quieto.
      const clonedMesh = SkeletonUtils.clone(characterRef.mesh);
      clonedMesh.scale.copy(characterRef.mesh.scale);
      clonedMesh.position.y = NICO_Y_OFFSET;

      // Tinte de color por hash del username (para distinguir peers)
      const hue = hashStr(p.username || ('user' + p.user_id)) % 360;
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

      peerMixer = new THREE.AnimationMixer(clonedMesh);
      for (const name of Object.keys(characterRef.clips)) {
        const clip = characterRef.clips[name];
        if (!clip) continue;
        const action = peerMixer.clipAction(clip);
        action.setEffectiveTimeScale(1);
        action.setEffectiveWeight(1);
        peerActions[name] = action;
      }
      if (peerActions.idle) peerActions.idle.play();
      usedNico = true;
    } catch (err) {
      console.warn('[multiplayer] Failed to clone Nico, fallback a cápsula:', err.message);
    }
  }

  // Fallback cápsula si no hay Nico o si el clone falló
  if (!usedNico) {
    const hue = hashStr(p.username || ('user' + p.user_id)) % 360;
    const color = new THREE.Color().setHSL(hue / 360, 0.55, 0.50);
    const body = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.35, 0.9, 4, 12),
      new THREE.MeshLambertMaterial({ color, flatShading: true })
    );
    body.position.y = 0.85;
    group.add(body);
    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.22, 16, 12),
      new THREE.MeshLambertMaterial({ color: 0xffd5b0, flatShading: true })
    );
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

  // Sesión 18 — HP bar doble cara DOM sobre la cabeza del peer.
  // Mismo estilo que la del player local (definido en world.js como
  // .player-hpbar). Aquí usamos .peer-hpbar para que tengan su propio
  // namespace y estilos en este módulo.
  const hpBarDiv = document.createElement('div');
  hpBarDiv.className = 'peer-hpbar';
  hpBarDiv.innerHTML = '<div class="peer-hpbar-fill" style="width:100%"></div>';
  document.body.appendChild(hpBarDiv);

  return {
    group, nameTagDiv, hpBarDiv,
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
    // HP por defecto al 100% hasta que el server lo mande.
    hp:    typeof p.hp_current === 'number' ? p.hp_current : 10,
    hpMax: typeof p.hp_max     === 'number' ? p.hp_max     : 10,
  };
}

function removePeer(userId) {
  const peer = mpLastPeerMap.get(userId);
  if (!peer) return;
  if (peer.mixer) peer.mixer.stopAllAction();
  if (peer.group) {
    if (scene) scene.remove(peer.group);
    peer.group.traverse(o => {
      if (o.geometry) o.geometry.dispose?.();
      if (o.material) {
        if (Array.isArray(o.material)) o.material.forEach(m => m.dispose?.());
        else o.material.dispose?.();
      }
    });
  }
  if (peer.nameTagDiv) peer.nameTagDiv.remove();
  // Sesión 18 — limpiar HP bar del peer
  if (peer.hpBarDiv) peer.hpBarDiv.remove();
  mpLastPeerMap.delete(userId);
}

function updatePeerNameTag(peer) {
  const v = new THREE.Vector3(
    peer.group.position.x,
    peer.group.position.y + NAME_TAG_HEIGHT,
    peer.group.position.z
  );
  v.project(camera);
  if (v.z > 1 || v.z < -1) {
    peer.nameTagDiv.style.display = 'none';
    // Sesión 18 — esconder HP bar también si el peer está fuera de cámara
    if (peer.hpBarDiv) peer.hpBarDiv.style.display = 'none';
    return;
  }
  const rect = canvas.getBoundingClientRect();
  const sx = (v.x * 0.5 + 0.5) * rect.width + rect.left;
  const sy = (-v.y * 0.5 + 0.5) * rect.height + rect.top;
  peer.nameTagDiv.style.left = sx + 'px';
  peer.nameTagDiv.style.top  = sy + 'px';
  peer.nameTagDiv.style.display = 'block';

  // Sesión 18 — HP bar doble cara justo arriba del nametag
  if (peer.hpBarDiv) {
    peer.hpBarDiv.style.left = sx + 'px';
    peer.hpBarDiv.style.top  = (sy - HP_BAR_OFFSET_PX) + 'px';
    peer.hpBarDiv.style.display = 'flex';
    const pct = peer.hpMax > 0
      ? Math.max(0, Math.min(100, (peer.hp / peer.hpMax) * 100))
      : 100;
    const fill = peer.hpBarDiv.querySelector('.peer-hpbar-fill');
    if (fill) fill.style.width = pct + '%';
  }
}

// ============================================================
// Sesión 18 — Estilos HP bar de peers
// ============================================================
function ensurePeerHpBarStyles() {
  if (hpBarStylesInjected) return;
  if (document.getElementById('peer-hpbar-styles')) {
    hpBarStylesInjected = true;
    return;
  }
  const style = document.createElement('style');
  style.id = 'peer-hpbar-styles';
  style.textContent = `
    .peer-hpbar {
      position: fixed;
      z-index: 41;
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
    .peer-hpbar-fill {
      height: 100%;
      background: linear-gradient(180deg, #4abc4a, #2e7a2e);
      transition: width 0.25s;
    }
  `;
  document.head.appendChild(style);
  hpBarStylesInjected = true;
}

// ============================================================
// Utilidades internas
// ============================================================
function hashStr(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h) + s.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
}

// Hook debug — accesible como window.__mpPlayers() en Eruda
function debugListPlayers() {
  const list = [];
  for (const [uid, p] of mpLastPeerMap) {
    list.push({
      user_id: uid,
      username: p.username,
      x: p.group.position.x.toFixed(1),
      z: p.group.position.z.toFixed(1),
      state: p.state,
      hp: p.hp + '/' + p.hpMax,
      lastUpdate_ms_ago: Date.now() - p.lastUpdate,
    });
  }
  console.table(list);
  return list;
}
