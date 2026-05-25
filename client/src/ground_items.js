/**
 * SebasPresent — Ground Items module (Sesión 4 refactor)
 *
 * Slice 5c — loot drops en el suelo.
 *
 * Cómo funciona:
 *   1) Cada GROUND_ITEMS_POLL_INTERVAL ms pregunta /api/ground_items?x=&z=
 *      al server y recibe los items en radio 30m alrededor del player.
 *   2) Renderiza cada item como caja con label en el suelo. Items que ya
 *      no aparecen en la respuesta se quitan de la escena.
 *   3) Al tap sobre un item lejano → auto-walk; cuando el player llega
 *      cerca, el auto-pickup recoge solo.
 *   4) Auto-pickup: cualquier item dentro de GROUND_ITEM_AUTO_RADIUS_M se
 *      intenta recoger sin necesidad de tap (con cooldown anti-spam).
 *
 * Los items se autodestruyen en server a los 120s (cron). El cliente no
 * gestiona expiraciones — confía en que dejen de venir en el poll.
 *
 * Cómo se usa desde world.js:
 *
 *   import * as groundItems from './ground_items.js';
 *
 *   groundItems.start({
 *     scene, camera, canvas,
 *     getPlayer:       () => player,
 *     getAuthToken:    () => authToken,
 *     apiBase:         API_BASE,
 *     setPlayerTarget: (x, z) => setPlayerTarget(x, z),  // para auto-walk
 *   });
 *
 *   // En animate():
 *   groundItems.update(dt);
 *
 *   // En doCanvasTap, antes de los demás handlers:
 *   if (groundItems.tryHandleTap(clientX, clientY)) return;
 *
 *   // Al salir del mundo:
 *   groundItems.stop();
 */

import * as THREE from 'three';

// ============================================================
// Constantes
// ============================================================
const POLL_INTERVAL = 1000;          // ms entre polls al server
const AUTO_RADIUS_M = 2.2;           // dentro de este radio → pickup auto
const PICKUP_RADIUS_M = 2.5;         // tolerancia para "estoy cerca"
const PICKUP_COOLDOWN_MS = 800;      // entre intentos del mismo item
const TOAST_DURATION_MS = 1600;
const ITEM_GROUND_Y = 0.15;
const ITEM_BOB_AMP = 0.05;
const ITEM_BOB_HZ = 0.002;           // factor para performance.now()
const ITEM_ROT_RPS = 1.2;            // rotación visual del item por segundo

// ============================================================
// Estado del módulo (privado)
// ============================================================
let scene = null;
let camera = null;
let canvas = null;
let getPlayer = null;
let getAuthToken = null;
let apiBase = null;
let setPlayerTargetCb = null;

let groundItemsMap = new Map();      // id → { id, item_id, qty, x, z, name, group, mesh, hitMesh, lastSeen, lastAttempt }
let pollTimer = 0;
let inFlight = false;
let pendingPickupItemId = null;
let pendingPickupAll = null;   // Sesión 39 — {x,z} destino para "Coger todo"

// Raycaster propio del módulo (independiente del que usa world.js)
let raycaster = null;

let toastEl = null;
let toastTimer = null;

let started = false;

// ============================================================
// API pública
// ============================================================

export function start(opts) {
  if (started) {
    console.warn('[ground_items] start() llamado dos veces sin stop()');
    stop();
  }
  scene             = opts.scene;
  camera            = opts.camera;
  canvas            = opts.canvas;
  getPlayer         = opts.getPlayer;
  getAuthToken      = opts.getAuthToken;
  apiBase           = opts.apiBase;
  setPlayerTargetCb = opts.setPlayerTarget || (() => {});

  raycaster = new THREE.Raycaster();
  pollTimer = 0;
  inFlight = false;
  pendingPickupItemId = null;
  pendingPickupAll = null;
  started = true;
}

export function stop() {
  if (!started) return;
  closeLootMenu();   // Sesión 39 — cerrar menú de loot si quedó abierto
  // Quitar todos los meshes de items de la escena
  for (const id of Array.from(groundItemsMap.keys())) {
    removeItem(id);
  }
  groundItemsMap.clear();
  // Limpiar toast si está visible
  if (toastEl) {
    toastEl.remove();
    toastEl = null;
  }
  if (toastTimer) {
    clearTimeout(toastTimer);
    toastTimer = null;
  }
  scene = camera = canvas = null;
  getPlayer = getAuthToken = apiBase = setPlayerTargetCb = null;
  raycaster = null;
  pollTimer = 0;
  pendingPickupItemId = null;
  pendingPickupAll = null;
  started = false;
}

export function update(dt) {
  if (!started) return;
  const token = getAuthToken?.();
  const player = getPlayer?.();
  if (!token || !player) return;
  try {
    updateImpl(dt, player);
  } catch (err) {
    // Defensivo: que un error suelto en el loot no congele el frame loop.
    console.error('[ground_items/update]', err);
  }
}

/**
 * Intenta gestionar un tap en (clientX, clientY) como tap sobre un item
 * del suelo. Devuelve true si lo consumió (era un item lejano y se inicia
 * auto-walk hacia él), false si no había ningún item bajo el tap (el
 * caller debe seguir intentando otras cosas: NPC, terreno, etc.).
 */
export function tryHandleTap(clientX, clientY) {
  if (!started) return false;
  // Set raycaster desde coordenadas de pantalla
  const rect = canvas.getBoundingClientRect();
  const nx = ((clientX - rect.left) / rect.width) * 2 - 1;
  const ny = -((clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera({ x: nx, y: ny }, camera);

  const item = findItemAtTap();
  if (!item) return false;

  triggerPickup(item);
  return true;
}

// ============================================================
// Sesión 39 — LONG-PRESS: menú de loot (lista de ítems, elegís cuál coger)
// ============================================================
let lootMenuEl = null;

function ensureLootMenuCss() {
  if (document.getElementById('lootMenuCss')) return;
  const st = document.createElement('style');
  st.id = 'lootMenuCss';
  // Reusa el look del menú OSRS de NPCs. Si esa clase ya existe, esto solo
  // agrega lo específico de loot (cantidad a la derecha).
  st.textContent = `
    .loot-menu { position: fixed; z-index: 10000; min-width: 160px; max-width: 240px;
      background: rgba(28,22,14,0.97); border: 1px solid #8a6d3b; border-radius: 8px;
      box-shadow: 0 4px 18px rgba(0,0,0,0.55); overflow: hidden; font-size: 14px; }
    .loot-menu-header { padding: 8px 12px; font-weight: 700; color: #e8d9a8;
      background: rgba(0,0,0,0.25); border-bottom: 1px solid #6b542d; }
    .loot-menu-row { padding: 9px 12px; color: #e6e0cf; display: flex; justify-content: space-between;
      gap: 10px; cursor: pointer; }
    .loot-menu-row:active { background: rgba(138,109,59,0.35); }
    .loot-menu-row .qty { color: #b9a66f; }
    .loot-menu-row.all { border-top: 1px solid #6b542d; color: #cbe8a0; }
    .loot-menu-row.cancel { border-top: 1px solid #6b542d; color: #d88; }
  `;
  document.head.appendChild(st);
}

function closeLootMenu() {
  if (lootMenuEl) { lootMenuEl.remove(); lootMenuEl = null; }
}

/**
 * Long-press sobre loot: muestra la LISTA de ítems del montón tapeado y deja
 * elegir cuál coger (o coger todo). Devuelve true si abrió el menú (consumió
 * el gesto), false si no había loot bajo el dedo.
 */
export function openLootMenuAt(clientX, clientY) {
  if (!started) return false;
  closeLootMenu();

  const rect = canvas.getBoundingClientRect();
  const nx = ((clientX - rect.left) / rect.width) * 2 - 1;
  const ny = -((clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera({ x: nx, y: ny }, camera);

  const tapped = findItemAtTap();
  if (!tapped) return false;

  // Juntar todos los ítems del "montón": los que están cerca del tapeado.
  const PILE_R = 1.2;
  const pile = [];
  for (const it of groundItemsMap.values()) {
    const dx = it.x - tapped.x, dz = it.z - tapped.z;
    if (dx * dx + dz * dz <= PILE_R * PILE_R) pile.push(it);
  }
  if (pile.length === 0) pile.push(tapped);

  ensureLootMenuCss();
  const menu = document.createElement('div');
  menu.className = 'loot-menu';
  let html = `<div class="loot-menu-header">Suelo (${pile.length})</div>`;
  for (const it of pile) {
    const qty = it.qty > 1 ? `<span class="qty">x${it.qty}</span>` : '';
    html += `<div class="loot-menu-row" data-pick="${it.id}"><span>${escapeLoot(it.name || it.item_id)}</span>${qty}</div>`;
  }
  if (pile.length > 1) {
    html += `<div class="loot-menu-row all" data-pickall="1">⤓ Coger todo</div>`;
  }
  html += `<div class="loot-menu-row cancel" data-cancel="1">✕ Cancelar</div>`;
  menu.innerHTML = html;
  document.body.appendChild(menu);

  const mw = menu.offsetWidth, mh = menu.offsetHeight;
  let left = clientX + 8, top = clientY + 8;
  if (left + mw > window.innerWidth - 4) left = window.innerWidth - mw - 4;
  if (top + mh > window.innerHeight - 4) top = clientY - mh - 8;
  if (top < 4) top = 4;
  menu.style.left = left + 'px';
  menu.style.top = top + 'px';
  lootMenuEl = menu;

  // Sesión 39 fix — bloquear pointerdown/up A NIVEL DEL MENÚ para que el tap
  // NO se propague al canvas de abajo (si no, tocar "Coger todo" también
  // movía al personaje a ese punto, como un tap-to-move al mapa).
  ['pointerdown', 'pointerup', 'click'].forEach(evt => {
    menu.addEventListener(evt, e => e.stopPropagation());
  });

  menu.querySelectorAll('[data-pick],[data-pickall],[data-cancel]').forEach(row => {
    row.addEventListener('pointerup', ev => {
      ev.preventDefault();
      ev.stopPropagation();
      if (row.dataset.cancel) { closeLootMenu(); return; }
      if (row.dataset.pickall) {
        // Coger todo. Recoger ya los que estén en rango; si alguno está lejos,
        // caminar al centro del montón y recoger el resto al llegar.
        const player = getPlayer();
        let cx = 0, cz = 0, far = false;
        for (const it of pile) {
          cx += it.x; cz += it.z;
          const dx = it.x - player.position.x, dz = it.z - player.position.z;
          if (Math.hypot(dx, dz) <= PICKUP_RADIUS_M) {
            if (!it.lastAttempt || Date.now() - it.lastAttempt > PICKUP_COOLDOWN_MS) {
              it.lastAttempt = Date.now();
              pickupItem(it.id);
            }
          } else {
            far = true;
          }
        }
        if (far) {
          pendingPickupAll = { x: cx / pile.length, z: cz / pile.length };
          setPlayerTargetCb(pendingPickupAll.x, pendingPickupAll.z);
        }
        closeLootMenu();
        return;
      }
      const id = parseInt(row.dataset.pick, 10);
      const it = groundItemsMap.get(id);
      if (it) requestPickup(it);
      closeLootMenu();
    });
  });

  // Cerrar al tocar fuera, y autocierre por tiempo.
  const outside = (e) => {
    if (lootMenuEl && !lootMenuEl.contains(e.target)) { closeLootMenu(); cleanup(); }
  };
  const cleanup = () => document.removeEventListener('pointerdown', outside, true);
  setTimeout(() => document.addEventListener('pointerdown', outside, true), 100);
  setTimeout(() => { if (lootMenuEl === menu) { closeLootMenu(); cleanup(); } }, 6000);
  return true;
}

/**
 * Pide recoger un ítem: si estamos cerca lo recoge ya; si no, camina hacia él
 * y lo recoge al llegar (mismo mecanismo que el tap). Para "coger todo" se
 * encola el último como pendiente de auto-walk; los que ya estén en rango se
 * recogen al instante.
 */
function requestPickup(item) {
  if (!item) return;
  const player = getPlayer();
  if (!player) return;
  const dx = item.x - player.position.x;
  const dz = item.z - player.position.z;
  if (Math.hypot(dx, dz) <= PICKUP_RADIUS_M) {
    pickupItem(item.id);
  } else {
    pendingPickupItemId = item.id;
    setPlayerTargetCb(item.x, item.z);
  }
}

function escapeLoot(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

// ============================================================
// Loop interno (llamado desde update)
// ============================================================
function updateImpl(dt, player) {
  // 1) Poll periódico al server
  pollTimer += dt * 1000;
  if (pollTimer >= POLL_INTERVAL && !inFlight) {
    pollTimer = 0;
    pollItems(player);
  }

  // 2) Sesión 39 — AUTO-PICKUP DESACTIVADO (pedido de Nico, estilo OSRS).
  //    Antes: cualquier item dentro de AUTO_RADIUS_M se recogía solo. Eso hacía
  //    que al SOLTAR un item lo recogieras al instante (caía a tus pies, dentro
  //    del radio). Ahora el pickup es SIEMPRE manual: tocás el item en el suelo
  //    para recogerlo (ver onGroundTap / pendingPickupItemId). Así podés soltar
  //    cosas y dejarlas, y elegir qué levantar.
  //    NOTA: el auto-walk + pickup por TAP sigue funcionando (bloque 3).
  const now = Date.now();
  // (bucle de auto-pickup eliminado intencionalmente)

  // 3) Pickup pendiente por tap: caminamos hacia un item tapeado. Cuando
  //    llegamos cerca, lo recogemos (Sesión 39: antes lo hacía el auto-pickup;
  //    ahora que está desactivado, el grab al llegar lo hace este bloque).
  if (pendingPickupItemId !== null) {
    const item = groundItemsMap.get(pendingPickupItemId);
    if (!item) {
      pendingPickupItemId = null;
    } else {
      const dx = item.x - player.position.x;
      const dz = item.z - player.position.z;
      if (Math.hypot(dx, dz) <= PICKUP_RADIUS_M) {
        if (!item.lastAttempt || now - item.lastAttempt > PICKUP_COOLDOWN_MS) {
          item.lastAttempt = now;
          pickupItem(item.id);
        }
        pendingPickupItemId = null;
      }
    }
  }

  // 3b) Sesión 39 — "Coger todo": caminamos al montón; al llegar, recogemos
  //     TODOS los ítems dentro del radio de pickup (no solo uno).
  if (pendingPickupAll) {
    const dx = pendingPickupAll.x - player.position.x;
    const dz = pendingPickupAll.z - player.position.z;
    if (Math.hypot(dx, dz) <= PICKUP_RADIUS_M) {
      for (const it of groundItemsMap.values()) {
        const idx = it.x - player.position.x;
        const idz = it.z - player.position.z;
        if (idx * idx + idz * idz <= PICKUP_RADIUS_M * PICKUP_RADIUS_M) {
          if (!it.lastAttempt || now - it.lastAttempt > PICKUP_COOLDOWN_MS) {
            it.lastAttempt = now;
            pickupItem(it.id);
          }
        }
      }
      pendingPickupAll = null;
    }
  }

  // 4) Animación leve: items flotan + rotan
  const t = performance.now() * ITEM_BOB_HZ;
  for (const item of groundItemsMap.values()) {
    if (item.group) {
      item.group.position.y = ITEM_GROUND_Y + Math.sin(t + item.id * 0.7) * ITEM_BOB_AMP;
      item.group.rotation.y += dt * ITEM_ROT_RPS;
    }
  }
}

// ============================================================
// Poll al server
// ============================================================
async function pollItems(player) {
  inFlight = true;
  try {
    const token = getAuthToken();
    if (!token) return;
    const r = await fetch(
      `${apiBase}/api/ground_items?x=${player.position.x.toFixed(2)}&z=${player.position.z.toFixed(2)}`,
      { headers: { 'Authorization': 'Bearer ' + token } }
    );
    if (!r.ok) return;
    const data = await r.json();
    const items = data?.items || [];
    const seenIds = new Set();
    for (const it of items) {
      seenIds.add(it.id);
      upsertItem(it);
    }
    // Quitar items que el server ya no devuelve (expiraron, recogidos por
    // otro player, salieron del radio…)
    for (const id of Array.from(groundItemsMap.keys())) {
      if (!seenIds.has(id)) removeItem(id);
    }
  } catch (err) {
    // Silencioso — el próximo tick lo reintenta
  } finally {
    inFlight = false;
  }
}

// ============================================================
// Gestión de items individuales
// ============================================================
function upsertItem(it) {
  let item = groundItemsMap.get(it.id);
  if (item) {
    // Solo actualizamos metadatos por si cambian (qty no debería pero por si acaso)
    item.qty = it.qty;
    item.lastSeen = Date.now();
    return;
  }
  // Crear mesh visual
  const group = new THREE.Group();
  group.position.set(it.x, ITEM_GROUND_Y, it.z);

  // Caja pequeña con color según tipo (placeholder hasta tener iconos reales)
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

  // Hitbox invisible más grande para facilitar tap en móvil
  const hitMat = new THREE.MeshBasicMaterial({ visible: false, depthWrite: false });
  const hitMesh = new THREE.Mesh(new THREE.BoxGeometry(1.0, 1.0, 1.0), hitMat);
  hitMesh.position.y = 0.2;
  hitMesh.userData.kind = 'ground-item-hitbox';
  hitMesh.userData.itemDropId = it.id;
  group.add(hitMesh);

  // Etiqueta con el nombre
  const label = makeItemLabel(it.name || it.item_id, it.qty);
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

function removeItem(id) {
  const item = groundItemsMap.get(id);
  if (!item) return;
  if (item.group) {
    if (scene) scene.remove(item.group);
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

// ============================================================
// Tap / pickup
// ============================================================
function findItemAtTap() {
  // Solo consideramos items LEJANOS (más allá del auto-pickup radius).
  // Los cercanos los recoge solo el auto-pickup; así no consumimos el tap
  // si hay un item junto al jugador y permitimos que el tap caiga al suelo
  // para hacer goto.
  const player = getPlayer();
  if (!player) return null;
  const meshList = [];
  for (const item of groundItemsMap.values()) {
    if (!item.hitMesh) continue;
    // Sesión 39 — Antes saltábamos los items muy cercanos (el auto-pickup los
    // recogía igual, y así el tap caía al suelo para moverse). Ahora que el
    // pickup es manual, SÍ permitimos tapear items adyacentes para recogerlos.
    meshList.push(item.hitMesh);
  }
  if (meshList.length === 0) return null;
  const hits = raycaster.intersectObjects(meshList, false);
  if (hits.length === 0) return null;
  const dropId = hits[0].object.userData.itemDropId;
  return groundItemsMap.get(dropId) || null;
}

function triggerPickup(item) {
  if (!item) return;
  const player = getPlayer();
  if (!player) return;
  const dx = item.x - player.position.x;
  const dz = item.z - player.position.z;
  const d = Math.hypot(dx, dz);
  if (d <= PICKUP_RADIUS_M) {
    // Sesión 39 — Ya estamos cerca: recoger AHORA (antes lo hacía el auto-pickup,
    // que está desactivado). El tap es la acción explícita de recoger.
    pickupItem(item.id);
    pendingPickupItemId = null;
    return;
  }
  // Lejos: caminamos hacia él y marcamos pendiente; al llegar (bloque 3) se recoge.
  pendingPickupItemId = item.id;
  setPlayerTargetCb(item.x, item.z);
}

async function pickupItem(itemDropId) {
  const token = getAuthToken();
  if (!token) return;
  try {
    // Sesión 35 — Incluimos pos actual del player en el body. El server la
    // usa para el check de distancia (validación anti-cheat lado server).
    // Sin esto, los items dropeados de NPCs muertos no se recogían porque
    // el server miraba una pos vieja (POSITION_SAVE_INTERVAL = 10s fuera
    // de combate), rechazando con `too_far` silencioso.
    const player = typeof getPlayer === 'function' ? getPlayer() : null;
    const body = { ids: [itemDropId] };
    if (player && player.position) {
      body.userPos = { x: player.position.x, z: player.position.z };
    }
    const r = await fetch(`${apiBase}/api/ground_items/pickup`, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + token,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (!r.ok) return;
    const data = await r.json();
    // Procesar recogidos: los quitamos de la escena
    const pickedUp = data?.picked_up || [];
    for (const pu of pickedUp) {
      const id = pu.id || pu;
      removeItem(id);
    }
    // Sesión 32 — SFX al recoger item (solo si recogió al menos uno)
    if (pickedUp.length > 0) {
      try {
        if (typeof window.__playSfx === 'function') {
          window.__playSfx('item_grab');
        }
      } catch {}
    }
    // Procesar skipped: feedback al user
    const skipped = data?.skipped || [];
    for (const sk of skipped) {
      const reason = sk.reason || 'unknown';
      // too_far → silencioso, el auto-pickup reintenta al llegar
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
      showToast(msg, '#e57373');
    }
    // Forzar próximo poll inmediato para refrescar el estado real
    pollTimer = POLL_INTERVAL;
  } catch (err) {
    // Silencioso — el próximo poll corregirá
  }
}

// ============================================================
// Visuales auxiliares
// ============================================================
function colorForItemId(itemId) {
  switch (itemId) {
    case 'bones':         return 0xeeeecc;
    case 'raw_beef':      return 0xc0392b;
    case 'cowhide':       return 0x8b4513;
    case 'raw_chicken':   return 0xffd7a0;
    case 'feather':       return 0xffffff;
    case 'coins':         return 0xffd700;
    case 'bronze_dagger': return 0xb87333;
    case 'bronze_sword':  return 0xcd7f32;
    case 'goblin_mail':   return 0x556b2f;
    default:              return 0xaaaaaa;
  }
}

function makeItemLabel(name, qty) {
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

// Toast centrado-arriba para feedback de pickup. Reusa el mismo div.
function showToast(text, color) {
  try {
    if (!toastEl) {
      toastEl = document.createElement('div');
      const s = toastEl.style;
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
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = text;
    if (color) toastEl.style.color = color;
    toastEl.style.opacity = '1';
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      if (toastEl) toastEl.style.opacity = '0';
    }, TOAST_DURATION_MS);
  } catch (e) { /* silencioso */ }
}
