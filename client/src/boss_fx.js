/**
 * SebasPresent — Jefes en el cliente (Sesión 50)
 *
 *   - Rocas de cada guarida (se ven, bloquean al jugador y al jefe → safespot)
 *     y un círculo tenue que marca el borde de la guarida.
 *   - Avisos en el suelo de los ataques especiales (se llenan hasta que caen),
 *     explosión al caer, charcos de veneno, onda alrededor del jefe.
 *   - Ataques del jefe: animación + proyectil (aliento de fuego, veneno, magia).
 *   - Barra de vida grande arriba (estilo OSRS) cuando estás en su guarida,
 *     con el nombre y un consejo de estrategia.
 *   - Leviatán: color según su estilo (verde = proyectiles, azul = magia).
 * Todo sale de snapshot.bosses (server/bosses.js).
 */
import * as THREE from 'three';
import { BOSSES, allBossRocks, bossLairAt } from './shared/bosses.js';

let scene = null, getPlayer = () => null, getSnapshot = () => null, feedLog = () => {}, getPeerPos = () => null;
let started = false;
const rockMeshes = [];
const lairRings = [];
const hazards = new Map();     // key → { mesh, h, bossId, landed }
const bursts = [];
const lastAtk = new Map();     // bossId → at
const lastSpec = new Map();
const lastStyle = new Map();
const npcAtk = new Map();       // npcId → last_attack_at visto
let hud = null, banner = null, bannerTimer = 0;
let clockOffset = 0;           // serverNow - Date.now()
let lastSnapNow = 0;
const ROCKS = allBossRocks();

export function start(opts) {
  if (started) stop();
  scene = opts.scene;
  getPlayer = opts.getPlayer || (() => null);
  getSnapshot = opts.getSnapshot || (() => null);
  feedLog = opts.feedLog || (() => {});
  getPeerPos = opts.getPeerPos || (() => null);
  started = true;
  buildRocks();
  ensureHud();
  if (typeof window !== 'undefined') window.__bosses = () => ({ hazards: [...hazards.keys()], offset: clockOffset, snap: getSnapshot()?.bosses });
}

export function stop() {
  for (const m of [...rockMeshes, ...lairRings]) scene?.remove(m);
  rockMeshes.length = 0; lairRings.length = 0;
  for (const h of hazards.values()) scene?.remove(h.mesh);
  hazards.clear();
  for (const b of bursts) scene?.remove(b.g);
  bursts.length = 0;
  hud?.remove(); hud = null; banner?.remove(); banner = null;
  started = false;
}

// ------------------------------------------------------------
// Rocas + borde de guarida
// ------------------------------------------------------------
function buildRocks() {
  const rockMat = new THREE.MeshStandardMaterial({ color: 0x6a6660, roughness: 0.95, flatShading: true });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x3a3632, roughness: 0.95, flatShading: true });
  for (const r of ROCKS) {
    const g = new THREE.Group();
    g.position.set(r.x, 0, r.z);
    const main = new THREE.Mesh(new THREE.DodecahedronGeometry(r.r, 0), rockMat);
    main.scale.set(1, 1.15, 0.95);
    main.position.y = r.r * 0.75;
    main.rotation.set(r.x * 0.7, r.z * 0.3, 0);
    g.add(main);
    for (let k = 0; k < 3; k++) {
      const s = new THREE.Mesh(new THREE.DodecahedronGeometry(r.r * 0.35, 0), darkMat);
      const a = k * 2.1 + r.x;
      s.position.set(Math.cos(a) * r.r * 0.9, r.r * 0.2, Math.sin(a) * r.r * 0.9);
      g.add(s);
    }
    scene.add(g);
    rockMeshes.push(g);
  }
  for (const [id, b] of Object.entries(BOSSES)) {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(b.lairR - 0.35, b.lairR, 64),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(b.color), transparent: true, opacity: 0.18, depthWrite: false, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(b.x, 0.04, b.z);
    ring.userData.boss = id;
    scene.add(ring);
    lairRings.push(ring);
  }
}

/** El jugador no atraviesa las rocas de las guaridas (resbala por el borde). */
export function applyCollision(x0, z0, x1, z1) {
  const PAD = 0.45;
  let x = x1, z = z1;
  for (const r of ROCKS) {
    const dx = x - r.x, dz = z - r.z;
    const d = Math.hypot(dx, dz), R = r.r + PAD;
    if (d < R) {
      if (d < 1e-4) return { x: x0, z: z0 };
      x = r.x + dx / d * R; z = r.z + dz / d * R;
    }
  }
  return { x, z };
}

// ------------------------------------------------------------
// Avisos en el suelo
// ------------------------------------------------------------
function makeHazardMesh(h, color) {
  const g = new THREE.Group();
  const col = new THREE.Color(h.k === 'pool' ? 0x50e040 : color);
  const edge = new THREE.Mesh(new THREE.RingGeometry(h.r - 0.12, h.r, 40),
    new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }));
  const fill = new THREE.Mesh(new THREE.CircleGeometry(h.r, 40),
    new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.28, depthWrite: false, side: THREE.DoubleSide }));
  edge.rotation.x = fill.rotation.x = -Math.PI / 2;
  edge.position.y = 0.07; fill.position.y = 0.06;
  g.add(fill, edge);
  g.userData = { edge, fill };
  if (h.k === 'pool') {
    const bub = [];
    for (let k = 0; k < 6; k++) {
      const b = new THREE.Mesh(new THREE.SphereGeometry(0.12, 6, 4), new THREE.MeshBasicMaterial({ color: 0x9fff7a, transparent: true, opacity: 0.8 }));
      g.add(b); bub.push(b);
    }
    g.userData.bub = bub;
  } else if (h.k === 'aoe') {
    // Algo cae del cielo sobre el círculo (roca, bola de fuego…)
    const drop = new THREE.Mesh(new THREE.DodecahedronGeometry(Math.max(0.35, h.r * 0.28), 0),
      new THREE.MeshBasicMaterial({ color: col.clone().lerp(new THREE.Color(0xffffff), 0.35) }));
    drop.position.y = 14;
    g.add(drop);
    g.userData.drop = drop;
  }
  g.position.set(h.x, 0, h.z);
  return g;
}

function spawnBurst(x, z, r, color) {
  const g = new THREE.Group();
  g.position.set(x, 0.1, z);
  const ring = new THREE.Mesh(new THREE.RingGeometry(r * 0.6, r, 40),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  ring.rotation.x = -Math.PI / 2;
  g.add(ring);
  const parts = [];
  for (let k = 0; k < 14; k++) {
    const p = new THREE.Mesh(new THREE.OctahedronGeometry(0.16, 0),
      new THREE.MeshBasicMaterial({ color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    const a = Math.random() * Math.PI * 2, sp = 2 + Math.random() * 3;
    p.userData.v = new THREE.Vector3(Math.cos(a) * sp, 3 + Math.random() * 4, Math.sin(a) * sp);
    g.add(p); parts.push(p);
  }
  scene.add(g);
  bursts.push({ g, ring, parts, t: 0 });
}

// ------------------------------------------------------------
// HUD: barra de vida del jefe + avisos
// ------------------------------------------------------------
function ensureHud() {
  if (!document.getElementById('boss-css')) {
    const s = document.createElement('style');
    s.id = 'boss-css';
    s.textContent = `
      .boss-hud { position: fixed; top: calc(env(safe-area-inset-top, 0px) + 6px); left: 50%; transform: translateX(-50%);
        width: min(420px, 62vw); z-index: 25; pointer-events: none; display: none; text-align: center; font-family: 'Cinzel', serif; }
      .boss-hud .bn { color: #ffe9a8; font-weight: 700; font-size: 13px; text-shadow: 0 1px 2px #000, 0 0 6px #000; }
      .boss-hud .bn small { font-family: 'IM Fell English', serif; font-weight: 400; color: #e0c890; }
      .boss-hud .bar { height: 14px; margin-top: 2px; background: #3a0808; border: 2px solid #120604; border-radius: 3px; overflow: hidden; box-shadow: 0 2px 6px rgba(0,0,0,.6); }
      .boss-hud .fill { height: 100%; background: linear-gradient(#3fd03a, #1f8a1a); transition: width .25s; }
      .boss-hud .hpt { position: relative; top: -15px; font: bold 10px sans-serif; color: #fff; text-shadow: 0 1px 1px #000; }
      .boss-hud .tip { margin-top: -10px; font-family: 'IM Fell English', serif; font-size: 11px; color: #f0e0b8; text-shadow: 0 1px 2px #000; }
      .boss-banner { position: fixed; top: 22%; left: 50%; transform: translateX(-50%); z-index: 26; pointer-events: none;
        font-family: 'Cinzel', serif; font-weight: 700; font-size: clamp(15px, 3.6vw, 22px); color: #ffdf7a; text-align: center;
        text-shadow: 0 2px 3px #000, 0 0 10px rgba(255,80,0,.7); opacity: 0; transition: opacity .25s; width: 90vw; }
      .boss-banner.show { opacity: 1; }
    `;
    document.head.appendChild(s);
  }
  hud = document.createElement('div');
  hud.className = 'boss-hud';
  hud.innerHTML = '<div class="bn"></div><div class="bar"><div class="fill"></div></div><div class="hpt"></div><div class="tip"></div>';
  document.body.appendChild(hud);
  banner = document.createElement('div');
  banner.className = 'boss-banner';
  document.body.appendChild(banner);
}

function showBanner(text) {
  if (!banner || !text) return;
  banner.textContent = text;
  banner.classList.add('show');
  bannerTimer = 2.6;
}

// ------------------------------------------------------------
// Update
// ------------------------------------------------------------
function targetPos(uid, me) {
  if (uid && me?.user_id === uid) { const p = getPlayer?.(); return p ? { x: p.position.x, z: p.position.z } : null; }
  return getPeerPos(uid);
}

export function update(dt) {
  if (!started) return;
  const snap = getSnapshot?.();
  if (snap?.now && snap.now !== lastSnapNow) { lastSnapNow = snap.now; clockOffset = snap.now - (snap._receivedAt || Date.now()); }
  const sNow = Date.now() + clockOffset;
  const list = snap?.bosses || [];
  const me = snap?.me || null;
  const seen = new Set();

  for (const b of list) {
    const B = BOSSES[b.id];
    if (!B) continue;
    const proc = window.__getNpcProc?.(b.npc_id);
    const bpos = window.__getNpcPosition?.(b.npc_id);
    // Estilo del Leviatán
    if (b.style && lastStyle.get(b.id) !== b.style) {
      lastStyle.set(b.id, b.style);
      try { proc?.setStyle?.(b.style); } catch {}
    }
    // Ataque nuevo → animación + proyectil
    if (b.atk && b.atk.at && lastAtk.get(b.id) !== b.atk.at) {
      const first = !lastAtk.has(b.id);
      lastAtk.set(b.id, b.atk.at);
      if (!first && sNow - b.atk.at < 2500) {
        try { proc?.attack?.(b.atk.b ? 'breath' : 'hit'); } catch {}
        const to = targetPos(b.atk.t, me);
        if (bpos && to && b.atk.s !== 'melee' && window.__worldFireProjectile) {
          const from = { x: bpos.x, y: 0, z: bpos.z }, dst = { x: to.x, y: 0, z: to.z };
          if (b.atk.b) {
            for (let k = 0; k < 4; k++) window.__worldFireProjectile(from, dst, { type: 'spell', spellId: 'fire_strike', windupMs: 150 + k * 90, arcHeight: 0.6 });
          } else if (b.atk.s === 'ranged') {
            window.__worldFireProjectile(from, dst, { type: 'spell', spellId: 'entangle', windupMs: 200 });
          } else {
            window.__worldFireProjectile(from, dst, { type: 'spell', spellId: b.id === 'leviatan' ? 'ice_spear' : 'thunderbolt', windupMs: 200 });
          }
        }
        if (b.atk.t === me?.user_id && b.atk.blk) feedLog('info', `🙏 Tu plegaria bloquea el ataque de ${B.name}.`);
      }
    }
    // Especial nuevo → aviso
    if (b.spec && b.spec.at && lastSpec.get(b.id) !== b.spec.at) {
      const first = !lastSpec.has(b.id);
      lastSpec.set(b.id, b.spec.at);
      if (!first && sNow - b.spec.at < 4000) {
        const inLair = me && getPlayer?.() && bossLairAt(getPlayer().position.x, getPlayer().position.z) === b.id;
        if (inLair) { showBanner(b.spec.n); feedLog('warning', `⚠ ${b.spec.n}`); }
      }
    }
    // Peligros
    for (const h of b.hz || []) {
      const key = `${b.id}:${h.t0}:${h.x}:${h.z}`;
      seen.add(key);
      let e = hazards.get(key);
      if (!e) {
        e = { mesh: makeHazardMesh(h, B.color), h, bossId: b.id, landed: false, npcId: b.npc_id };
        scene.add(e.mesh);
        hazards.set(key, e);
      }
      e.h = h;
    }
  }

  // Sesión 50 — monstruos normales que atacan a distancia (acólitos del Cabildo…)
  for (const n of snap?.npcs || []) {
    if (!n.style || n.style === 'melee' || BOSSES[n.def_id] || !n.last_attack_at) continue;
    const prev = npcAtk.get(n.id);
    npcAtk.set(n.id, n.last_attack_at);
    if (prev == null || prev === n.last_attack_at || !n.in_combat_with) continue;
    if (sNow - n.last_attack_at > 2500) continue;
    const from = window.__getNpcPosition?.(n.id), to = targetPos(n.in_combat_with, me);
    try { window.__getNpcProc?.(n.id)?.attack?.(); } catch {}
    if (from && to && window.__worldFireProjectile) {
      window.__worldFireProjectile({ x: from.x, y: 0, z: from.z }, { x: to.x, y: 0, z: to.z },
        { type: 'spell', spellId: n.style === 'magic' ? (n.def_id === 'acolito_cabildo' ? 'fire_strike' : 'thunderbolt') : 'entangle', windupMs: 150 });
    }
  }

  // Animar / retirar peligros
  for (const [key, e] of hazards) {
    const h = e.h;
    const end = h.until || h.at;
    if (!seen.has(key) && sNow > end + 400) { scene.remove(e.mesh); hazards.delete(key); continue; }
    const ud = e.mesh.userData;
    if (h.k === 'ring') {
      const bp = window.__getNpcPosition?.(e.npcId);
      if (bp) e.mesh.position.set(bp.x, 0, bp.z);
    }
    const prog = Math.max(0, Math.min(1, (sNow - h.t0) / Math.max(1, h.at - h.t0)));
    if (h.k === 'pool') {
      ud.fill.material.opacity = sNow < h.at ? 0.15 + prog * 0.2 : 0.45 + Math.sin(sNow / 150) * 0.08;
      ud.bub?.forEach((bb, i) => {
        const a = i * 1.05 + sNow / 900;
        const ph = ((sNow / 700) + i * 0.37) % 1;
        bb.position.set(Math.cos(a) * h.r * 0.55, 0.05 + ph * 0.4, Math.sin(a) * h.r * 0.55);
        bb.material.opacity = 0.8 * (1 - ph);
      });
      if (sNow > end) { scene.remove(e.mesh); hazards.delete(key); }
      continue;
    }
    if (!e.landed) {
      ud.fill.scale.setScalar(Math.max(0.02, prog));
      ud.fill.material.opacity = 0.2 + prog * 0.35;
      ud.edge.material.opacity = 0.5 + Math.sin(sNow / 90) * 0.35;
      if (ud.drop) { ud.drop.position.y = 14 * (1 - prog * prog); ud.drop.rotation.x += dt * 4; }
      if (sNow >= h.at) {
        e.landed = true;
        spawnBurst(e.mesh.position.x, e.mesh.position.z, h.r, new THREE.Color(BOSSES[e.bossId]?.color || '#ff5020'));
        scene.remove(e.mesh);
      }
    }
  }

  // Explosiones
  for (let i = bursts.length - 1; i >= 0; i--) {
    const b = bursts[i];
    b.t += dt;
    const k = b.t / 0.7;
    if (k >= 1) { scene.remove(b.g); b.g.traverse(o => { o.geometry?.dispose?.(); o.material?.dispose?.(); }); bursts.splice(i, 1); continue; }
    b.ring.scale.setScalar(1 + k * 0.8);
    b.ring.material.opacity = 0.9 * (1 - k);
    for (const p of b.parts) {
      p.userData.v.y -= 12 * dt;
      p.position.addScaledVector(p.userData.v, dt);
      p.material.opacity = 1 - k;
    }
  }

  // Borde de la guarida: más visible cuando estás cerca
  const pl = getPlayer?.();
  for (const ring of lairRings) {
    const B = BOSSES[ring.userData.boss];
    const d = pl ? Math.hypot(pl.position.x - B.x, pl.position.z - B.z) : 999;
    ring.material.opacity = d < B.lairR + 15 ? 0.35 + Math.sin(performance.now() / 400) * 0.1 : 0.12;
  }

  // HUD del jefe
  const lair = pl ? bossLairAt(pl.position.x, pl.position.z) : null;
  const bInfo = lair ? list.find(b => b.id === lair) : null;
  const npc = bInfo ? (snap?.npcs || []).find(n => n.id === bInfo.npc_id) : null;
  if (hud) {
    if (bInfo && npc && bInfo.alive) {
      const B = BOSSES[lair];
      hud.style.display = 'block';
      const key = `${lair}|${npc.hp_current}|${npc.max_hp}|${bInfo.style || ''}`;
      if (hud.dataset.k !== key) {
        hud.dataset.k = key;
        const styleTxt = bInfo.style ? (bInfo.style === 'magic' ? ' · 🔵 MAGIA' : ' · 🟢 PROYECTILES') : '';
        hud.querySelector('.bn').innerHTML = `${B.name} <small>${B.title}${styleTxt}</small>`;
        hud.querySelector('.fill').style.width = `${Math.max(0, Math.min(100, (npc.hp_current / (npc.max_hp || 1)) * 100))}%`;
        hud.querySelector('.hpt').textContent = `${npc.hp_current} / ${npc.max_hp}`;
        hud.querySelector('.tip').textContent = `💡 ${B.tip}`;
      }
    } else hud.style.display = 'none';
  }
  if (bannerTimer > 0) { bannerTimer -= dt; if (bannerTimer <= 0) banner?.classList.remove('show'); }
}

export function getBossesForMap() {
  return Object.entries(BOSSES).map(([id, b]) => ({ id, x: b.x, z: b.z, name: b.name }));
}
