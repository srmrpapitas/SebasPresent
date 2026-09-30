/**
 * SebasPresent — Monturas (Sesión 50)
 *
 *   🐎 Caballo (nivel 5)  · 🦅 Guirre (nivel 25, vuela)
 *
 * Botón redondo junto a vida/plegaria/correr: tocar = montar / bajar.
 * Reglas (shared/mounts.js):
 *   · Te atacan → no puedes montar en 10 s (el orbe muestra la cuenta atrás).
 *   · Te GOLPEAN (daño > 0) montado → te caes. Que te persigan no te baja.
 *   · Atacar, recoger, entrar en interiores/Fosa o morir → te bajas.
 * El guirre vuela a 9 m: pasa por encima de árboles, casas y murallas. Al
 * bajar busca un hueco libre en el suelo.
 *
 * Los modelos se añaden a la escena (no como hijos del personaje, que puede
 * tener escala) y se sincronizan cada frame. Los otros jugadores ven tu
 * montura: realtime.js manda el id y multiplayer.js la pinta con peerMount().
 */
import * as THREE from 'three';
import * as api from './api.js';
import { MOUNTS, MOUNT_COMBAT_LOCK_MS } from './shared/mounts.js';

const HIP = 0.95;                  // altura de la cadera del personaje sobre sus pies
const SEAT = { caballo: 1.55, guirre: 0.95 };   // silla sobre la base de la montura

let scene = null;
let getPlayer = () => null;
let feedLog = () => {};
let canMountHere = () => null;     // → texto con el motivo si NO se puede, o null
let findLanding = null;            // (x,z) → {x,z} libre para aterrizar
let started = false;

let owned = [];
let current = null;                // id de la montura o null
let obj = null;                    // modelo
let lastAttackedAt = 0;
let alt = 0;                       // altura actual de vuelo (sube/baja suave)
let lastPos = null, speedNow = 0, t = 0;
let orbEl = null, orbVal = null, menuEl = null;
let preferred = null;

// ============================================================
// Modelos
// ============================================================
const L = (c) => new THREE.MeshLambertMaterial({ color: c, flatShading: true });
const bx = (w, h, d, m, x = 0, y = 0, z = 0) => { const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); b.position.set(x, y, z); return b; };

export function buildHorse(color = 0x6a3f22) {
  const g = new THREE.Group(); g.userData.kind = 'mount-horse';
  const coat = L(color), dark = L(0x2a1a10), hoof = L(0x1a1a1a), saddle = L(0x4a2a14), cloth = L(0xa02a2a), metal = L(0x9a9aa0);
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.36, 1.25, 4, 10), coat);
  body.rotation.x = Math.PI / 2; body.position.set(0, 1.18, 0); g.add(body);
  // cuello + cabeza
  const neck = new THREE.Group(); neck.position.set(0, 1.35, 0.75); neck.rotation.x = -0.75; g.add(neck);
  const nk = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.26, 0.85, 8), coat); nk.position.y = 0.38; neck.add(nk);
  const head = new THREE.Group(); head.position.set(0, 0.8, 0.02); head.rotation.x = 1.55; neck.add(head);
  head.add(bx(0.24, 0.62, 0.3, coat, 0, 0.26, 0));
  head.add(bx(0.2, 0.16, 0.26, dark, 0, 0.6, 0.0));
  for (const sx of [-0.09, 0.09]) { const ear = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.16, 4), coat); ear.position.set(sx, -0.05, -0.12); ear.rotation.x = -1.4; head.add(ear); }
  for (const sx of [-0.125, 0.125]) head.add(bx(0.02, 0.05, 0.05, dark, sx, 0.15, 0.05));
  // crin
  for (let i = 0; i < 6; i++) neck.add(bx(0.06, 0.18, 0.14, dark, 0, 0.05 + i * 0.14, -0.2));
  // cola
  const tail = new THREE.Group(); tail.position.set(0, 1.3, -0.95); g.add(tail);
  const tl = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.85, 6), dark); tl.position.y = -0.4; tl.rotation.x = Math.PI; tail.add(tl);
  tail.rotation.x = 0.5;
  // patas (pivote en la cadera, para galopar)
  const legs = [];
  for (const [x, z] of [[-0.2, 0.62], [0.2, 0.62], [-0.2, -0.62], [0.2, -0.62]]) {
    const leg = new THREE.Group(); leg.position.set(x, 1.0, z);
    const up = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.07, 0.6, 6), coat); up.position.y = -0.3; leg.add(up);
    const lo = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.055, 0.42, 6), coat); lo.position.y = -0.78; leg.add(lo);
    leg.add(bx(0.13, 0.08, 0.15, hoof, 0, -0.98, 0.01));
    g.add(leg); legs.push(leg);
  }
  // silla, manta, faldones (tapan las piernas del jinete) y estribos
  g.add(bx(0.8, 0.05, 0.8, cloth, 0, 1.5, -0.05));
  g.add(bx(0.5, 0.14, 0.62, saddle, 0, 1.58, -0.05));
  g.add(bx(0.46, 0.2, 0.08, saddle, 0, 1.68, 0.24));
  for (const sx of [-1, 1]) {
    g.add(bx(0.05, 0.7, 0.5, saddle, sx * 0.4, 1.2, 0.02));
    g.add(bx(0.14, 0.04, 0.1, metal, sx * 0.42, 0.82, 0.08));
  }
  g.userData.legs = legs; g.userData.neck = neck; g.userData.tail = tail;
  return g;
}

export function buildGuirre() {
  const g = new THREE.Group(); g.userData.kind = 'mount-guirre';
  const cream = L(0xeee6d2), buff = L(0xd8c49a), black = L(0x1c1a18), yellow = L(0xf2b42a), horn = L(0x3a3228), eye = L(0x8a1a10);
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.55, 12, 9), cream); body.scale.set(0.95, 0.72, 1.55); body.position.y = 0.55; g.add(body);
  // cuello (plumas despeinadas) + cabeza amarilla con pico ganchudo
  const ruff = new THREE.Mesh(new THREE.IcosahedronGeometry(0.3, 0), buff); ruff.position.set(0, 0.72, 0.72); ruff.scale.set(1, 0.9, 1.1); g.add(ruff);
  const head = new THREE.Group(); head.position.set(0, 0.88, 1.0); g.add(head);
  const face = new THREE.Mesh(new THREE.SphereGeometry(0.17, 10, 8), yellow); face.scale.set(0.9, 0.95, 1.25); head.add(face);
  const crown = new THREE.Mesh(new THREE.SphereGeometry(0.15, 10, 8, 0, Math.PI * 2, 0, Math.PI / 2), cream); crown.position.set(0, 0.05, -0.06); head.add(crown);
  const beak = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.3, 6), horn); beak.rotation.x = Math.PI / 2; beak.position.set(0, -0.02, 0.28); head.add(beak);
  const hook = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.1, 5), horn); hook.position.set(0, -0.07, 0.4); hook.rotation.x = Math.PI; head.add(hook);
  for (const sx of [-0.1, 0.1]) head.add(bx(0.03, 0.04, 0.04, eye, sx, 0.04, 0.1));
  // cola en cuña
  const tail = new THREE.Mesh(new THREE.ConeGeometry(0.42, 0.9, 4), cream); tail.rotation.x = -Math.PI / 2; tail.rotation.y = Math.PI / 4; tail.scale.set(1, 1, 0.25); tail.position.set(0, 0.55, -1.15); g.add(tail);
  // alas: cobertoras blancas, remeras negras
  const wings = [];
  for (const s of [-1, 1]) {
    const w = new THREE.Group(); w.position.set(s * 0.45, 0.7, 0.1); g.add(w);
    const inner = bx(1.4, 0.07, 0.95, cream, s * 0.7, 0, 0); w.add(inner);
    const outer = new THREE.Group(); outer.position.set(s * 1.4, 0, 0); w.add(outer);
    outer.add(bx(1.2, 0.06, 0.8, cream, s * 0.55, 0, 0.05));
    for (let i = 0; i < 6; i++) outer.add(bx(0.85, 0.04, 0.16, black, s * (0.9 + i * 0.05), -0.01, -0.35 + i * 0.12 - 0.05).translateX(s * 0.2));
    for (let i = 0; i < 5; i++) w.add(bx(0.24, 0.04, 0.5, black, s * (0.15 + i * 0.3), -0.02, -0.6));
    w.userData.outer = outer; w.userData.side = s;
    wings.push(w);
  }
  // patas recogidas
  for (const sx of [-0.18, 0.18]) g.add(bx(0.08, 0.2, 0.28, L(0xb8b0a0), sx, 0.12, -0.2));
  // silla de cuero en la espalda
  g.add(bx(0.55, 0.12, 0.7, L(0x4a2a14), 0, 0.93, 0.05));
  for (const sx of [-1, 1]) g.add(bx(0.05, 0.45, 0.45, L(0x4a2a14), sx * 0.46, 0.72, 0.05));
  g.userData.wings = wings; g.userData.head = head;
  return g;
}

export function buildMount(id) { return id === 'guirre' ? buildGuirre() : buildHorse(); }

/** Anima una montura. moving: 0..1 (velocidad relativa), time en s. */
export function animateMount(o, id, moving, time, flying) {
  if (!o) return;
  if (id === 'guirre') {
    const flap = flying ? (moving > 0.2 ? 0.35 : 0.75) : 0.15;
    const speed = moving > 0.2 ? 4.2 : 6.5;
    for (const w of o.userData.wings || []) {
      const a = Math.sin(time * speed) * flap;
      w.rotation.z = w.userData.side * (a + (flying ? 0.05 : 1.1));
      w.userData.outer.rotation.z = w.userData.side * (Math.sin(time * speed - 0.6) * flap * 0.6);
    }
    o.userData.head.rotation.x = Math.sin(time * 1.3) * 0.08;
  } else {
    const legs = o.userData.legs || [];
    const amp = Math.min(1, moving) * 0.75;
    const ph = [0, Math.PI * 0.5, Math.PI, Math.PI * 1.5];
    legs.forEach((l, i) => { l.rotation.x = Math.sin(time * 11 + ph[i]) * amp; });
    if (o.userData.neck) o.userData.neck.rotation.x = -0.75 + Math.sin(time * 11) * 0.08 * amp;
    if (o.userData.tail) o.userData.tail.rotation.x = 0.5 + amp * 0.5 + Math.sin(time * 3) * 0.08;
  }
}

/** Altura extra del jinete (sobre su altura normal). */
export function riderLift(id, altitude = 0) {
  if (!id) return 0;
  return SEAT[id] - HIP + (id === 'guirre' ? altitude : 0);
}

// ============================================================
// Jugador local
// ============================================================
export function id() { return current; }
export function isMounted() { return !!current; }
export function isFlying() { return current === 'guirre' && alt > 0.5; }
export function speedMult() { return current ? MOUNTS[current].speed : 1; }
export function liftY() { return riderLift(current, alt); }

function lockLeft() { return Math.max(0, MOUNT_COMBAT_LOCK_MS - (Date.now() - lastAttackedAt)); }

/** Llamar cuando al jugador le atacan (acierte o falle). */
export function onAttacked(damage) {
  lastAttackedAt = Date.now();
  if (current && damage > 0) dismount('💥 ¡Te han tirado de la montura!');
}

export function mount(which) {
  const p = getPlayer();
  if (!p || current) return;
  const lock = lockLeft();
  if (lock > 0) { feedLog('warning', `🐾 Te están atacando: no puedes montar hasta dentro de ${Math.ceil(lock / 1000)} s.`); return; }
  const why = canMountHere();
  if (why) { feedLog('warning', why); return; }
  if (!owned.includes(which)) { feedLog('info', 'Todavía no tienes montura. Tanausú, el cuadrero de La Laguna, te vende una.'); return; }
  current = which; preferred = which;
  obj = buildMount(which);
  scene.add(obj);
  alt = 0;
  sync(0);
  feedLog('info', which === 'guirre' ? '🦅 Te subes al guirre y levantas el vuelo.' : '🐎 Te subes al caballo.');
  try { window.__playSfx?.('door_open'); } catch {}
  renderOrb();
}

export function dismount(msg = null) {
  if (!current) return;
  const p = getPlayer();
  // aterrizar en un sitio libre si venías volando
  if (p && current === 'guirre' && findLanding) {
    try { const f = findLanding(p.position.x, p.position.z); if (f) { p.position.x = f.x; p.position.z = f.z; } } catch {}
  }
  if (obj) { scene.remove(obj); obj.traverse(o => { if (o.geometry) o.geometry.dispose(); }); }
  obj = null; current = null; alt = 0;
  if (msg) feedLog('warning', msg);
  renderOrb();
}

export function toggle() {
  if (current) { dismount(); return; }
  if (!owned.length) { feedLog('info', '🐎 No tienes montura. Tanausú, el cuadrero de La Laguna (junto a la plaza), te vende una.'); return; }
  if (owned.length === 1) { mount(owned[0]); return; }
  openChooser();
}

function sync(dt) {
  const p = getPlayer();
  if (!p || !obj) return;
  obj.position.set(p.position.x, current === 'guirre' ? alt : 0, p.position.z);
  obj.rotation.y = p.rotation.y;
}

export function update(dt) {
  if (!started) return;
  t += dt;
  const p = getPlayer();
  if (p) {
    if (lastPos) {
      const d = Math.hypot(p.position.x - lastPos.x, p.position.z - lastPos.z);
      const v = dt > 0 ? d / dt : 0;
      speedNow = speedNow * 0.8 + Math.min(1.5, v / 12) * 0.2;
    }
    lastPos = { x: p.position.x, z: p.position.z };
  }
  if (current) {
    const why = canMountHere();
    if (why) { dismount(why.replace('No puedes montar', 'Te bajas de la montura')); return; }
    const M = MOUNTS[current];
    const target = M.fly ? M.alt + Math.sin(t * 1.4) * 0.35 : 0;
    alt += (target - alt) * Math.min(1, dt * 1.6);
    sync(dt);
    animateMount(obj, current, speedNow, t, alt > 0.5);
  }
  // cuenta atrás del bloqueo en el orbe
  if (orbVal) {
    const lock = lockLeft();
    const txt = lock > 0 ? `${Math.ceil(lock / 1000)}s` : (current ? MOUNTS[current].icon : (owned.length ? '🐾' : '—'));
    if (orbVal.textContent !== txt) orbVal.textContent = txt;
    orbEl.classList.toggle('locked', lock > 0 && !current);
  }
}

// ============================================================
// HUD: orbe y selector
// ============================================================
function ensureCss() {
  if (document.getElementById('mountCss')) return;
  const s = document.createElement('style'); s.id = 'mountCss';
  s.textContent = `
    #hudStatMount { cursor: pointer; }
    #hudStatMount .osrs-stat-icon { display:flex; align-items:center; justify-content:center; font-size: 17px; line-height: 1; }
    #hudStatMount.active { box-shadow: 0 0 0 2px #ffd35a, 0 0 10px rgba(255,211,90,0.7); }
    #hudStatMount.locked { filter: grayscale(0.7); opacity: 0.8; }
    #hudStatMount .osrs-stat-value { font-size: 11px; }
    .mount-menu { position: fixed; z-index: 90; background: rgba(20,14,8,0.96); border: 2px solid #c8a043; border-radius: 8px; padding: 6px; display: flex; flex-direction: column; gap: 5px; }
    .mount-menu button { background: #3a2f1c; color: #f0e6d2; border: 1px solid #a88040; border-radius: 6px; padding: 9px 12px; font: bold 14px sans-serif; text-align: left; }
  `;
  document.head.appendChild(s);
}

function buildOrb() {
  ensureCss();
  const col = document.querySelector('.osrs-stats-column');
  if (!col || document.getElementById('hudStatMount')) return;
  orbEl = document.createElement('div');
  orbEl.className = 'osrs-stat mount';
  orbEl.id = 'hudStatMount';
  orbEl.title = 'Montura';
  orbEl.innerHTML = `<div class="osrs-stat-icon">🐎</div><div class="osrs-stat-value">—</div>`;
  orbVal = orbEl.querySelector('.osrs-stat-value');
  orbEl.addEventListener('pointerup', (ev) => {
    if (ev.button !== undefined && ev.button !== 0) return;
    ev.preventDefault(); ev.stopPropagation();
    toggle();
  });
  col.appendChild(orbEl);
  renderOrb();
}

function renderOrb() {
  if (!orbEl) return;
  orbEl.classList.toggle('active', !!current);
  const icon = orbEl.querySelector('.osrs-stat-icon');
  icon.textContent = current ? '⬇' : (preferred ? MOUNTS[preferred].icon : (owned.includes('guirre') ? '🦅' : '🐎'));
}

function openChooser() {
  closeChooser();
  menuEl = document.createElement('div');
  menuEl.className = 'mount-menu';
  const r = orbEl?.getBoundingClientRect();
  menuEl.style.left = `${Math.max(8, (r?.left ?? 100) - 150)}px`;
  menuEl.style.top = `${(r?.top ?? 100)}px`;
  for (const id of owned) {
    const b = document.createElement('button');
    b.textContent = `${MOUNTS[id].icon} ${MOUNTS[id].name}`;
    b.addEventListener('pointerup', (e) => { e.preventDefault(); e.stopPropagation(); closeChooser(); mount(id); });
    menuEl.appendChild(b);
  }
  document.body.appendChild(menuEl);
  setTimeout(() => document.addEventListener('pointerdown', outside, true), 50);
}
function outside(e) { if (menuEl && !menuEl.contains(e.target)) closeChooser(); }
function closeChooser() { document.removeEventListener('pointerdown', outside, true); if (menuEl) { menuEl.remove(); menuEl = null; } }

export async function refresh() {
  try { const r = await api.mountsGet(); owned = r?.owned || []; } catch {}
  renderOrb();
}

export function start(opts) {
  if (started) stop();
  scene = opts.scene;
  getPlayer = opts.getPlayer || (() => null);
  feedLog = opts.feedLog || (() => {});
  canMountHere = opts.canMountHere || (() => null);
  findLanding = opts.findLanding || null;
  started = true;
  buildOrb();
  refresh();
  if (typeof window !== 'undefined') window.__mounts = { refresh, id: () => current, toggle, onAttacked };
}

export function stop() {
  dismount();
  closeChooser();
  if (orbEl) { orbEl.remove(); orbEl = null; orbVal = null; }
  started = false; owned = []; lastPos = null;
}

// ============================================================
// Otros jugadores
// ============================================================
/** Pone/quita la montura de un peer (peer.group) y la anima. Llamar cada frame. */
export function updatePeerMount(peer, mountId, dt, time) {
  if (!scene || !peer?.group) return;
  if ((peer._mountId || null) !== (mountId || null)) {
    if (peer._mountObj) { scene.remove(peer._mountObj); peer._mountObj = null; }
    peer._mountId = mountId || null;
    peer._mountAlt = 0;
    if (mountId && MOUNTS[mountId]) { peer._mountObj = buildMount(mountId); scene.add(peer._mountObj); }
  }
  if (!peer._mountObj) { if (peer._liftApplied) { peer.group.position.y = 0; peer._liftApplied = false; } return; }
  const M = MOUNTS[peer._mountId];
  const target = M.fly ? M.alt + Math.sin(time * 1.4) * 0.35 : 0;
  peer._mountAlt += (target - peer._mountAlt) * Math.min(1, dt * 1.6);
  const moving = peer.state === 'run' ? 1 : 0;
  peer.group.position.y = riderLift(peer._mountId, peer._mountAlt);
  peer._liftApplied = true;
  peer._mountObj.position.set(peer.group.position.x, M.fly ? peer._mountAlt : 0, peer.group.position.z);
  peer._mountObj.rotation.y = peer.group.rotation.y;
  animateMount(peer._mountObj, peer._mountId, moving, time, peer._mountAlt > 0.5);
}
export function removePeerMount(peer) {
  if (peer?._mountObj && scene) scene.remove(peer._mountObj);
  if (peer) { peer._mountObj = null; peer._mountId = null; }
}
