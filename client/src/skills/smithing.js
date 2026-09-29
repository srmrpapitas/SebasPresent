/**
 * SebasPresent — Horno y Yunque (cliente) · Sesión 50
 *
 *   - Dibuja las estaciones de shared/smithing.js: horno de piedra con boca
 *     incandescente (luz que parpadea, brasas y humo) y yunque sobre tocón.
 *   - Tocar → caminar → al llegar se abre el panel:
 *       Horno: mineral → lingote (1 / 5 / Todo)
 *       Yunque: lingotes → piezas de armadura (1 / Todo), por material
 *   - Bucle de trabajo encadenado (como "Cocinar todo"): anim + sonido +
 *     chispas + POST al server por pieza. Tocar el mundo lo corta.
 *
 * Uso desde world.js (igual que mining.js):
 *   smithing.registerKeepouts(terrain);
 *   smithing.start({ scene, getPlayer, getCharacter, setPlayerTarget, feedLog });
 *   smithing.update(dt);
 *   smithing.tryHandleTap(raycaster) / openActionMenuAt(raycaster, cx, cy, openMenu)
 *   smithing.stopWork(reason);  smithing.stop();
 */

import * as THREE from 'three';
import * as api from '../api.js';
import * as skills from '../skills.js';
import * as inventory from '../inventory.js';
import * as audio from '../audio.js';
import { getItemIconHtml } from '../item_icons.js';
import { STATIONS, MATERIALS, MATERIAL_NAMES } from '../shared/smithing.js';

const APPROACH_DIST_M = 2.4;
const USE_DIST_M = 3.2;
const WORK_TICK_MS = 1700;

let scene = null;
let getPlayer = null, getCharacter = null, setPlayerTargetCb = null;
let feedLog = () => {};
let started = false;

const stationObjs = new Map();   // id → { st, group, hit, light?, mouth?, embers?, smoke? }
const pickMeshes = [];
let timeAcc = 0;
let pendingOpen = null;          // estación a la que caminamos para abrir el panel
let work = null;                 // { st, kind, key, remaining, lastAt, waiting, gen }
let workGen = 0;
let recipes = null;              // { smelt: [...], smith: [...] }
let panelEl = null;
const sparks = [];
let RES = null;

// ============================================================
// Recursos
// ============================================================
function softTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.4, 'rgba(255,255,255,0.5)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

function initResources() {
  if (RES) return;
  const soft = softTexture();
  RES = {
    soft,
    stone: new THREE.MeshLambertMaterial({ color: 0x8a8078, flatShading: true }),
    stoneDark: new THREE.MeshLambertMaterial({ color: 0x5e5650, flatShading: true }),
    soot: new THREE.MeshLambertMaterial({ color: 0x2a2522, flatShading: true }),
    mouthGlow: new THREE.MeshBasicMaterial({ color: 0xff7a1f }),
    wood: new THREE.MeshLambertMaterial({ color: 0x6b4a2b, flatShading: true }),
    woodTop: new THREE.MeshLambertMaterial({ color: 0x9a7a52, flatShading: true }),
    iron: new THREE.MeshPhongMaterial({ color: 0x3e4247, shininess: 70, specular: 0x999999, flatShading: true }),
    hitMat: new THREE.MeshBasicMaterial({ visible: false }),
    emberMat: new THREE.PointsMaterial({ color: 0xffa040, map: soft, size: 0.18, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
    smokeMat: new THREE.SpriteMaterial({ map: soft, color: 0x8a8580, transparent: true, opacity: 0.35, depthWrite: false }),
    sparkMat: new THREE.MeshBasicMaterial({ color: 0xffd060 }),
    sparkGeom: new THREE.BoxGeometry(0.05, 0.05, 0.05),
  };
}

// ============================================================
// Construcción de las estaciones
// ============================================================
function jitterBox(w, h, d, seed) {
  const g = new THREE.BoxGeometry(w, h, d, 2, 2, 2);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const n = Math.sin(i * 12.9898 + seed * 78.233) * 43758.5453;
    const f = (n - Math.floor(n) - 0.5) * 0.08;
    p.setXYZ(i, p.getX(i) * (1 + f), p.getY(i) * (1 + f * 0.5), p.getZ(i) * (1 + f));
  }
  g.computeVertexNormals();
  return g;
}

function buildFurnace(st) {
  const g = new THREE.Group();
  // Cuerpo
  const base = new THREE.Mesh(jitterBox(2.4, 1.6, 2.0, 1), RES.stone);
  base.position.y = 0.8;
  g.add(base);
  const top = new THREE.Mesh(jitterBox(2.0, 0.6, 1.7, 2), RES.stoneDark);
  top.position.y = 1.9;
  g.add(top);
  // Chimenea
  const chim = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.45, 1.7, 8), RES.stoneDark);
  chim.position.set(0, 2.9, -0.35);
  g.add(chim);
  const lip = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.15, 8), RES.soot);
  lip.position.set(0, 3.78, -0.35);
  g.add(lip);
  // Boca: marco oscuro + fuego
  const frame = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.95, 0.12), RES.soot);
  frame.position.set(0, 0.62, 1.0);
  g.add(frame);
  const mouth = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.7), RES.mouthGlow.clone());
  mouth.position.set(0, 0.6, 1.065);
  g.add(mouth);
  // Halo del fuego en la boca
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: RES.soft, color: 0xff8a3a, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending }));
  halo.scale.set(1.8, 1.4, 1);
  halo.position.set(0, 0.62, 1.2);
  g.add(halo);
  // Montón de carbón junto a la boca
  const coalGeo = new THREE.IcosahedronGeometry(0.13, 0);
  for (let i = 0; i < 9; i++) {
    const c = new THREE.Mesh(coalGeo, RES.soot);
    const a = i * 2.4;
    c.position.set(0.95 + Math.cos(a) * 0.22 * (i % 3), 0.08 + (i > 5 ? 0.12 : 0), 1.25 + Math.sin(a) * 0.2);
    c.rotation.set(i, i * 2, 0);
    g.add(c);
  }
  // Piedras sueltas en la base
  for (let i = 0; i < 6; i++) {
    const a0 = (i / 6) * Math.PI * 2 + 0.4;
    if (Math.sin(a0) > 0.4) continue;
    const r = new THREE.Mesh(jitterBox(0.5, 0.35, 0.4, 10 + i), i % 2 ? RES.stone : RES.stoneDark);
    const a = (i / 6) * Math.PI * 2 + 0.4;
    r.position.set(Math.cos(a) * 1.35, 0.15, Math.sin(a) * 1.15 - 0.1);
    r.rotation.y = a;
    g.add(r);
  }
  // Luz del fuego
  const light = new THREE.PointLight(0xff7a2a, 1.4, 9, 1.6);
  light.position.set(0, 0.8, 1.6);
  g.add(light);
  // Brasas
  const N = 16;
  const pos = new Float32Array(N * 3);
  const seeds = [];
  for (let i = 0; i < N; i++) seeds.push({ x: (Math.random() - 0.5) * 0.7, z: 1.1 + Math.random() * 0.2, t: Math.random() });
  const eg = new THREE.BufferGeometry();
  eg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const embers = new THREE.Points(eg, RES.emberMat);
  g.add(embers);
  // Humo
  const smoke = [];
  for (let i = 0; i < 5; i++) {
    const sp = new THREE.Sprite(RES.smokeMat.clone());
    sp.userData.t = i / 5;
    g.add(sp);
    smoke.push(sp);
  }
  return { group: g, light, mouth, embers, emberSeeds: seeds, smoke, hitH: 3.0, hitR: 1.7 };
}

function buildAnvil() {
  const g = new THREE.Group();
  const stump = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.55, 0.7, 10), RES.wood);
  stump.position.y = 0.35;
  g.add(stump);
  const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.44, 0.44, 0.02, 10), RES.woodTop);
  ring.position.y = 0.71;
  g.add(ring);
  const b = (w, h, d, x, y) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), RES.iron); m.position.set(x, y, 0); g.add(m); return m; };
  b(0.7, 0.16, 0.46, 0, 0.8);
  b(0.34, 0.24, 0.28, 0, 1.0);
  b(1.0, 0.22, 0.42, 0.05, 1.22);
  const horn = new THREE.Mesh(new THREE.ConeGeometry(0.15, 0.5, 8), RES.iron);
  horn.rotation.z = -Math.PI / 2;
  horn.position.set(0.78, 1.24, 0);
  g.add(horn);
  // Martillo apoyado
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.5, 6), RES.woodTop);
  handle.rotation.z = Math.PI / 2;
  handle.rotation.y = 0.5;
  handle.position.set(-0.15, 1.36, 0.08);
  g.add(handle);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.2), RES.iron);
  head.position.set(-0.36, 1.37, -0.03);
  head.rotation.y = 0.5;
  g.add(head);
  g.scale.setScalar(1.3);
  return { group: g, hitH: 2.0, hitR: 1.3 };
}

function buildStation(st) {
  const o = st.type === 'furnace' ? buildFurnace(st) : buildAnvil(st);
  o.group.position.set(st.x, 0, st.z);
  o.group.rotation.y = st.rotY || 0;
  const hit = new THREE.Mesh(new THREE.CylinderGeometry(o.hitR, o.hitR, o.hitH, 8), RES.hitMat);
  hit.position.y = o.hitH / 2;
  hit.userData = { kind: 'smith-station', stationId: st.id };
  o.group.add(hit);
  o.hit = hit;
  o.st = st;
  scene.add(o.group);
  pickMeshes.push(hit);
  stationObjs.set(st.id, o);
}

// ============================================================
// Chispas del martillo / horno
// ============================================================
function spawnSparks(st, n) {
  const o = stationObjs.get(st.id);
  if (!o) return;
  const base = new THREE.Vector3(0, st.type === 'anvil' ? 1.35 : 0.8, st.type === 'anvil' ? 0 : 1.2);
  o.group.localToWorld(base);
  for (let i = 0; i < n; i++) {
    const m = new THREE.Mesh(RES.sparkGeom, RES.sparkMat);
    m.position.copy(base);
    const a = Math.random() * Math.PI * 2;
    const sp = 1.5 + Math.random() * 2.5;
    sparks.push({ m, life: 0.35 + Math.random() * 0.35, vx: Math.cos(a) * sp, vy: 1.5 + Math.random() * 3, vz: Math.sin(a) * sp });
    scene.add(m);
  }
}
function updateSparks(dt) {
  for (let i = sparks.length - 1; i >= 0; i--) {
    const s = sparks[i];
    s.life -= dt;
    s.vy -= 9 * dt;
    s.m.position.x += s.vx * dt;
    s.m.position.y = Math.max(0.02, s.m.position.y + s.vy * dt);
    s.m.position.z += s.vz * dt;
    if (s.life <= 0) { scene?.remove(s.m); sparks.splice(i, 1); }
  }
}

// ============================================================
// API pública
// ============================================================
export function registerKeepouts(terrain) {
  for (const st of STATIONS) {
    try { terrain.addKeepout?.(st.x, st.z, 4.5); terrain.clearTreesNear?.(st.x, st.z, 4.5); } catch {}
  }
}

export function start(opts) {
  if (started) stop();
  scene = opts.scene;
  getPlayer = opts.getPlayer;
  getCharacter = opts.getCharacter || (() => null);
  setPlayerTargetCb = opts.setPlayerTarget || (() => {});
  feedLog = opts.feedLog || (() => {});
  initResources();
  ensureCss();
  for (const st of STATIONS) buildStation(st);
  started = true;
  if (typeof window !== 'undefined') {
    window.__smithingDebug = () => ({ work, pendingOpen: pendingOpen?.id, recipes: !!recipes });
  }
}

export function stop() {
  if (!started) return;
  stopWork('module_stop');
  closePanel();
  for (const o of stationObjs.values()) scene?.remove(o.group);
  stationObjs.clear();
  pickMeshes.length = 0;
  for (const s of sparks) scene?.remove(s.m);
  sparks.length = 0;
  started = false;
}

export function getStationsForMinimap() {
  return STATIONS.map(s => ({ x: s.x, z: s.z, color: s.type === 'furnace' ? '#ff8a3a' : '#c0c6cc' }));
}

function stationUnderRay(raycaster) {
  if (!started) return null;
  const hits = raycaster.intersectObjects(pickMeshes, false);
  if (!hits.length) return null;
  return stationObjs.get(hits[0].object.userData?.stationId)?.st || null;
}

function examine(st) {
  feedLog('info', st.type === 'furnace'
    ? `${st.name}: funde mineral en lingotes (Herrería).`
    : `${st.name}: forja lingotes en armaduras (Herrería).`);
}

export function tryHandleTap(raycaster) {
  const st = stationUnderRay(raycaster);
  if (!st) return false;
  goUse(st);
  return true;
}

export function openActionMenuAt(raycaster, cx, cy, openMenu) {
  const st = stationUnderRay(raycaster);
  if (!st) return false;
  openMenu(st.name, [
    { label: st.type === 'furnace' ? '🔥 Fundir' : '🔨 Forjar', onPick: () => goUse(st) },
    { label: '🔍 Examinar', onPick: () => examine(st) },
  ], cx, cy);
  return true;
}

export function isBusy() { return !!work; }

function goUse(st) {
  stopWork('new_order');
  const p = getPlayer?.();
  if (!p) return;
  const dx = p.position.x - st.x, dz = p.position.z - st.z;
  const d = Math.hypot(dx, dz);
  if (d > USE_DIST_M) {
    const ux = d > 0 ? dx / d : 1, uz = d > 0 ? dz / d : 0;
    setPlayerTargetCb(st.x + ux * APPROACH_DIST_M, st.z + uz * APPROACH_DIST_M);
    pendingOpen = st;
  } else {
    openPanel(st);
  }
}

/** Corta el trabajo en curso (tocar el mundo, combate, etc.). */
export function stopWork(reason = 'user') {
  pendingOpen = reason === 'new_order' ? pendingOpen : null;
  if (reason === 'tap_ground') closePanel();
  if (!work) return;
  workGen++;
  work = null;
  if (reason !== 'user' && reason !== 'tap_ground' && reason !== 'new_order') console.log('[smithing] stop:', reason);
}
export function cancel(reason = 'external') { stopWork(reason); closePanel(); pendingOpen = null; }

// ============================================================
// Panel
// ============================================================
function countItem(id) {
  let n = 0;
  for (const s of inventory.getState?.() || []) if (s && s.item_id === id) n += s.quantity || 1;
  return n;
}
function freeSlots() {
  return (inventory.getState?.() || []).filter(s => !s).length;
}

async function ensureRecipes() {
  if (recipes) return recipes;
  try { recipes = await api.smithingRecipes(); } catch (e) { feedLog('error', 'No se pudieron cargar las recetas.'); }
  return recipes;
}

function closePanel() {
  if (panelEl) { panelEl.remove(); panelEl = null; }
}

let anvilTab = null;

async function openPanel(st) {
  closePanel();
  const r = await ensureRecipes();
  if (!r) return;
  const lvl = skills.getLevel?.('smithing') ?? 1;
  const el = document.createElement('div');
  el.className = 'smith-panel';
  const title = st.type === 'furnace' ? '🔥 ' + st.name : '🔨 ' + st.name;
  let body = '';

  if (st.type === 'furnace') {
    for (const s of r.smelt) {
      const have = countItem(s.ore);
      const locked = lvl < s.level;
      body += `<div class="smith-row${locked ? ' locked' : ''}${have ? '' : ' empty'}">
        <span class="smith-icon">${getItemIconHtml(s.bar, '🧱')}</span>
        <span class="smith-info"><b>Lingote de ${s.name}</b>
          <small>${locked ? '🔒 ' : ''}Nv ${s.level} · ${s.xp} XP · mineral: ${have}</small></span>
        <span class="smith-btns">${locked || !have ? '' :
          `<button data-a="smelt" data-k="${s.material}" data-n="1">1</button>
           <button data-a="smelt" data-k="${s.material}" data-n="5">5</button>
           <button data-a="smelt" data-k="${s.material}" data-n="all">Todo</button>`}</span>
      </div>`;
    }
  } else {
    // Pestañas por material (primero el que más lingotes tengas)
    const mats = MATERIALS.filter(m => r.smith.some(x => x.material === m));
    if (!anvilTab || !mats.includes(anvilTab)) {
      anvilTab = mats.slice().sort((a, b) => countItem(`bar_${b}`) - countItem(`bar_${a}`))[0] || mats[0];
    }
    body += `<div class="smith-tabs">${mats.map(m =>
      `<button class="smith-tab${m === anvilTab ? ' on' : ''}" data-tab="${m}">${MATERIAL_NAMES[m]} <small>(${countItem(`bar_${m}`)})</small></button>`).join('')}</div>`;
    const bars = countItem(`bar_${anvilTab}`);
    for (const it of r.smith.filter(x => x.material === anvilTab)) {
      const locked = lvl < it.level;
      const can = !locked && bars >= it.bars;
      const stat = it.defence_bonus ? `+${it.defence_bonus} def` : (it.attack_bonus ? `+${it.attack_bonus} atq` : '');
      body += `<div class="smith-row${locked ? ' locked' : ''}${can ? '' : ' empty'}">
        <span class="smith-icon">${getItemIconHtml(it.id, it.icon)}</span>
        <span class="smith-info"><b>${escapeHtml(it.name)}</b>
          <small>${locked ? '🔒 ' : ''}Nv ${it.level} · ${it.bars} lingote${it.bars > 1 ? 's' : ''} · ${it.xp} XP${stat ? ' · ' + stat : ''}</small></span>
        <span class="smith-btns">${can ?
          `<button data-a="smith" data-k="${it.id}" data-n="1">1</button>
           <button data-a="smith" data-k="${it.id}" data-n="all">Todo</button>` : ''}</span>
      </div>`;
    }
  }

  el.innerHTML = `<div class="smith-head"><span>${escapeHtml(title)}</span><small>Herrería nv ${lvl}</small><button class="smith-x" data-a="close">✕</button></div>
    <div class="smith-body">${body}</div>`;
  document.body.appendChild(el);
  panelEl = el;

  el.addEventListener('pointerdown', ev => ev.stopPropagation());
  el.addEventListener('pointerup', ev => {
    ev.stopPropagation();
    const t = ev.target.closest('[data-a],[data-tab]');
    if (!t) return;
    if (t.dataset.tab) { anvilTab = t.dataset.tab; openPanel(st); return; }
    const a = t.dataset.a;
    if (a === 'close') { closePanel(); return; }
    const n = t.dataset.n === 'all' ? 999 : Number(t.dataset.n);
    closePanel();
    startWork(st, a, t.dataset.k, n);
  });
}

// ============================================================
// Bucle de trabajo
// ============================================================
function startWork(st, kind, key, n) {
  workGen++;
  work = { st, kind, key, remaining: n, lastAt: 0, waiting: false, gen: workGen, done: 0 };
  feedLog('info', kind === 'smelt' ? 'Empiezas a fundir...' : 'Empiezas a forjar...');
}

function workTick() {
  const p = getPlayer?.();
  if (!work || !p) return;
  const st = work.st;
  if (Math.hypot(p.position.x - st.x, p.position.z - st.z) > USE_DIST_M + 1.5) { stopWork('walked_away'); return; }
  const now = performance.now();
  if (work.waiting || now - work.lastAt < WORK_TICK_MS) return;

  // ¿Quedan materiales? (el server valida igual; esto evita peticiones inútiles)
  if (work.kind === 'smelt' && countItem(`ore_${work.key}`) < 1) { finishWork('Te has quedado sin mineral.'); return; }
  if (work.kind === 'smith') {
    const rec = recipes?.smith?.find(x => x.id === work.key);
    if (rec && countItem(`bar_${rec.material}`) < rec.bars) { finishWork('No te quedan lingotes suficientes.'); return; }
  }

  work.lastAt = now;
  work.waiting = true;
  const gen = work.gen;
  try { getCharacter?.()?.playGather?.('punching', 0); } catch {}
  setTimeout(() => {
    if (!work || work.gen !== gen) return;
    if (work.kind === 'smith') { audio.synth('anvil', { pitch: 0.95 + Math.random() * 0.1 }); spawnSparks(st, 8); }
    else { audio.synth('smelt'); spawnSparks(st, 5); }
  }, 320);

  const call = work.kind === 'smelt'
    ? api.smithingSmelt(st.id, work.key)
    : api.smithingSmith(st.id, work.key);
  call.then(async res => {
    if (!work || work.gen !== gen) return;
    work.waiting = false;
    if (!res?.ok) return;
    work.done++;
    work.remaining--;
    audio.synth('craft_done', { volume: 0.5 });
    try { await window.inventory?.refresh?.(); } catch {}
    try { await skills.reload(); } catch {}
    const what = res.action === 'smelt'
      ? `Lingote de ${MATERIAL_NAMES[res.material] || res.material}`
      : (res.produced_name || res.produced);
    feedLog('xp', `+${res.xp_gained} XP Herrería (${what})`);
    if (res.level_up) {
      feedLog('info', `¡Subes a nivel ${res.new_level} de Herrería!`);
      try { window.__spawnLevelUpBanner?.('smithing', res.new_level); } catch {}
    }
    if (work && work.remaining <= 0) finishWork(null);
  }).catch(err => {
    if (!work || work.gen !== gen) return;
    work.waiting = false;
    if (err?.code === 'too_fast') return;
    finishWork(err?.message || 'No se pudo completar.');
  });
}

function finishWork(msg) {
  if (msg) feedLog('info', msg);
  else if (work?.done) feedLog('info', 'Terminas el trabajo.');
  workGen++;
  work = null;
}

export function update(dt) {
  if (!started) return;
  timeAcc += dt;

  // Animación de hornos: fuego que parpadea, brasas y humo
  for (const o of stationObjs.values()) {
    if (o.st.type !== 'furnace') continue;
    const flick = 0.75 + 0.25 * Math.sin(timeAcc * 11 + o.st.x) * Math.sin(timeAcc * 7.3);
    const boost = work && work.st.id === o.st.id ? 1.5 : 1;
    o.light.intensity = 1.2 * flick * boost;
    o.mouth.material.color.setRGB(1, 0.38 + 0.18 * flick, 0.08 + 0.05 * flick);
    const pos = o.embers.geometry.attributes.position;
    o.emberSeeds.forEach((s, i) => {
      s.t = (s.t + dt * (0.35 + (i % 5) * 0.05)) % 1;
      pos.setXYZ(i, s.x + Math.sin(timeAcc * 2 + i) * 0.1, 0.5 + s.t * 1.4, s.z + s.t * 0.3);
    });
    pos.needsUpdate = true;
    o.embers.material.opacity = 0.9;
    for (const sp of o.smoke) {
      sp.userData.t = (sp.userData.t + dt * 0.12) % 1;
      const t = sp.userData.t;
      sp.position.set(Math.sin(t * 6 + o.st.z) * 0.25, 3.9 + t * 3.2, -0.35 - t * 0.4);
      const sc = 0.6 + t * 1.8;
      sp.scale.set(sc, sc, 1);
      sp.material.opacity = 0.32 * (1 - t);
    }
  }
  updateSparks(dt);

  // Llegar a la estación → abrir panel
  const p = getPlayer?.();
  if (pendingOpen && p) {
    if (Math.hypot(p.position.x - pendingOpen.x, p.position.z - pendingOpen.z) <= USE_DIST_M) {
      const st = pendingOpen;
      pendingOpen = null;
      openPanel(st);
    }
  }
  if (work) workTick();
}

// ============================================================
// CSS
// ============================================================
function escapeHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function ensureCss() {
  if (document.getElementById('smith-panel-css')) return;
  const style = document.createElement('style');
  style.id = 'smith-panel-css';
  style.textContent = `
    .smith-panel { position: fixed; left: 50%; bottom: 12px; transform: translateX(-50%);
      width: min(440px, calc(100vw - 16px)); max-height: 62vh; display: flex; flex-direction: column;
      background: rgba(20,14,8,0.97); border: 2px solid #c8a043; border-radius: 6px; z-index: 210;
      box-shadow: 0 8px 26px rgba(0,0,0,0.8); font-family: 'IM Fell English', serif; color: #f0e0b0;
      user-select: none; -webkit-user-select: none; animation: smithIn .14s ease-out; }
    @keyframes smithIn { from { opacity: 0; transform: translate(-50%, 8px); } to { opacity: 1; transform: translate(-50%, 0); } }
    .smith-head { display: flex; align-items: center; gap: 8px; padding: 8px 10px; border-bottom: 1px solid rgba(200,160,67,0.35);
      font-family: 'Cinzel', serif; font-weight: 700; color: #e8c560; text-shadow: 1px 1px 0 #000; }
    .smith-head small { font-family: inherit; font-weight: 400; color: #bba878; font-size: 11px; margin-left: auto; }
    .smith-x { background: none; border: 1px solid #7a6030; color: #ff9090; border-radius: 4px; padding: 2px 8px; font-size: 14px; }
    .smith-body { overflow-y: auto; padding: 6px; -webkit-overflow-scrolling: touch; }
    .smith-row { display: flex; align-items: center; gap: 8px; padding: 6px; border-radius: 4px; }
    .smith-row + .smith-row { border-top: 1px solid rgba(200,160,67,0.12); }
    .smith-row.empty .smith-icon, .smith-row.empty .smith-info { opacity: 0.55; }
    .smith-row.locked { opacity: 0.4; }
    .smith-icon { width: 34px; height: 34px; flex: 0 0 34px; display: flex; align-items: center; justify-content: center; font-size: 22px;
      background: rgba(0,0,0,0.35); border: 1px solid #5a4520; border-radius: 4px; }
    .smith-icon svg { width: 30px; height: 30px; }
    .smith-info { flex: 1; display: flex; flex-direction: column; line-height: 1.15; min-width: 0; }
    .smith-info b { font-size: 14px; color: #fff0c8; text-shadow: 1px 1px 0 #000; }
    .smith-info small { font-size: 11px; color: #bba878; }
    .smith-btns { display: flex; gap: 4px; }
    .smith-btns button, .smith-tab { background: linear-gradient(#5a4520, #3a2a10); border: 1px solid #c8a043; color: #f0e0b0;
      border-radius: 4px; padding: 6px 9px; font-size: 13px; font-family: inherit; min-width: 36px; }
    .smith-btns button:active, .smith-tab:active { background: #c8a043; color: #000; }
    .smith-tabs { display: flex; gap: 4px; overflow-x: auto; padding: 2px 2px 8px; }
    .smith-tab { white-space: nowrap; padding: 5px 8px; opacity: 0.7; }
    .smith-tab.on { opacity: 1; background: linear-gradient(#8a6a28, #5a4520); }
    .smith-tab small { color: #d8c89a; }
  `;
  document.head.appendChild(style);
}
