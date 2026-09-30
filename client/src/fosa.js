/**
 * SebasPresent — La Fosa de Guayota (cliente) · Sesión 50
 *
 *   - Dibuja la arena: cráter de roca volcánica con ríos de lava y humo.
 *   - enter(): pide entrar al server (Kargath) y te baja a la arena.
 *   - HUD: "Ronda X / 12", cuenta atrás entre rondas, botón Rendirse.
 *   - Guayota: su brillo (verde/azul) avisa del próximo ataque.
 *   - Ataques de las criaturas: proyectiles hacia ti.
 *   - Resultado: premios, victoria (Capa de fuego) o derrota (te saca fuera).
 * Todo el estado viene de snapshot.me.fosa (server/minigame.js).
 */
import * as THREE from 'three';
import * as api from './api.js';
import * as audio from './audio.js';
import { FOSA, FOSA_MOBS } from './shared/fosa.js';

let scene = null, getPlayer = () => null, getSnapshot = () => null, feedLog = () => {}, onTeleported = () => {};
let started = false;
let group = null, lavaMats = [];
let hud = null;
let lastResultAt = 0, lastAtkAt = 0, lastWave = -1, lastTeleAt = 0, busy = false;
let timeAcc = 0;

export function start(opts) {
  if (started) stop();
  scene = opts.scene;
  getPlayer = opts.getPlayer || (() => null);
  getSnapshot = opts.getSnapshot || (() => null);
  feedLog = opts.feedLog || (() => {});
  onTeleported = opts.onTeleported || (() => {});
  started = true;
  buildArena();
  ensureHud();
  if (typeof window !== 'undefined') window.__fosa = { enter, leave, state: () => getSnapshot()?.me?.fosa };
}

export function stop() {
  if (group) scene?.remove(group);
  group = null; lavaMats = [];
  hud?.remove(); hud = null;
  started = false;
}

export function registerKeepouts(terrain) {
  try { terrain.addKeepout?.(FOSA.x, FOSA.z, FOSA.r + 12); terrain.clearTreesNear?.(FOSA.x, FOSA.z, FOSA.r + 12); } catch {}
}

// ------------------------------------------------------------
// Arena
// ------------------------------------------------------------
function buildArena() {
  group = new THREE.Group();
  group.position.set(FOSA.x, 0, FOSA.z);
  const floor = new THREE.Mesh(new THREE.CircleGeometry(FOSA.r + 1, 48),
    new THREE.MeshStandardMaterial({ color: 0x2a1c16, roughness: 1, flatShading: true }));
  floor.rotation.x = -Math.PI / 2; floor.position.y = 0.03;
  group.add(floor);
  // Grietas de lava en el suelo
  const lava = new THREE.MeshStandardMaterial({ color: 0xff5a10, emissive: 0xff3000, emissiveIntensity: 1.2, roughness: 0.6 });
  lavaMats.push(lava);
  for (let k = 0; k < 9; k++) {
    const a = k * 0.7 + 0.3, len = 4 + (k % 3) * 2.5;
    const crack = new THREE.Mesh(new THREE.PlaneGeometry(0.35, len), lava);
    crack.rotation.set(-Math.PI / 2, 0, a);
    const rr = 4 + (k * 1.7) % (FOSA.r - 6);
    crack.position.set(Math.cos(a * 1.3) * rr, 0.05, Math.sin(a * 1.3) * rr);
    group.add(crack);
  }
  // Río de lava alrededor y muro de roca volcánica (con hueco de entrada al norte, hacia Kargath)
  const river = new THREE.Mesh(new THREE.RingGeometry(FOSA.r + 1, FOSA.r + 2.4, 64), lava);
  river.rotation.x = -Math.PI / 2; river.position.y = 0.04;
  group.add(river);
  const rockM = new THREE.MeshStandardMaterial({ color: 0x3a2e28, roughness: 0.95, flatShading: true });
  const rockD = new THREE.MeshStandardMaterial({ color: 0x1e1612, roughness: 0.95, flatShading: true });
  for (let k = 0; k < 34; k++) {
    const a = (k / 34) * Math.PI * 2;
    // hueco de entrada (norte, −z → hacia z = -309 está al sur en coordenadas: entrada en +z)
    if (Math.abs(Math.atan2(Math.sin(a - Math.PI / 2), Math.cos(a - Math.PI / 2))) < 0.22) continue;
    const s = 1.8 + ((k * 7) % 5) * 0.35;
    const r = new THREE.Mesh(new THREE.DodecahedronGeometry(s, 0), k % 3 ? rockM : rockD);
    r.position.set(Math.cos(a) * (FOSA.r + 3.6), s * 0.7, Math.sin(a) * (FOSA.r + 3.6));
    r.rotation.set(k, k * 0.5, 0);
    r.scale.y = 1.3 + (k % 4) * 0.2;
    group.add(r);
  }
  // Pilares de entrada con braseros
  for (const sx of [-1, 1]) {
    const p = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.7, 4, 6), rockD);
    p.position.set(sx * 3, 2, FOSA.r + 3.2);
    group.add(p);
    const fire = new THREE.Mesh(new THREE.ConeGeometry(0.45, 1.1, 6), lava);
    fire.position.set(sx * 3, 4.5, FOSA.r + 3.2);
    fire.userData.flame = true;
    group.add(fire);
  }
  scene.add(group);
}

// ------------------------------------------------------------
// HUD
// ------------------------------------------------------------
function ensureHud() {
  if (!document.getElementById('fosa-css')) {
    const s = document.createElement('style');
    s.id = 'fosa-css';
    s.textContent = `
      .fosa-hud { position: fixed; top: calc(env(safe-area-inset-top, 0px) + 6px); left: 50%; transform: translateX(-50%); z-index: 25;
        display: none; align-items: center; gap: 8px; padding: 4px 10px; background: rgba(40,10,4,0.85); border: 2px solid #ff7a1a;
        border-radius: 6px; font-family: 'Cinzel', serif; color: #ffd8a0; font-size: 13px; box-shadow: 0 0 12px rgba(255,90,0,.5); }
      .fosa-hud b { color: #fff0c0; }
      .fosa-hud button { font: inherit; font-size: 11px; padding: 3px 8px; color: #fff; background: #7a1a0a; border: 1px solid #ffb070; border-radius: 4px; }
      .fosa-hud .tele { font-weight: 700; padding: 1px 6px; border-radius: 3px; }
      .fosa-hud .tele.ranged { background: #1f8a2a; } .fosa-hud .tele.magic { background: #2a4ac0; }
    `;
    document.head.appendChild(s);
  }
  hud = document.createElement('div');
  hud.className = 'fosa-hud';
  hud.innerHTML = '<span class="w"></span><span class="tele" style="display:none"></span><button type="button">Rendirse</button>';
  hud.querySelector('button').addEventListener('pointerup', (e) => { e.preventDefault(); e.stopPropagation(); leave(); });
  hud.addEventListener('pointerdown', (e) => e.stopPropagation());
  document.body.appendChild(hud);
}

// ------------------------------------------------------------
// Acciones
// ------------------------------------------------------------
function movePlayer(x, z) {
  const p = getPlayer?.();
  if (p) { p.position.x = x; p.position.z = z; }
  try { onTeleported({ x, z }); } catch {}
}

export async function enter() {
  if (busy) return;
  busy = true;
  try {
    const r = await api.fosaStart();
    if (r?.ok) {
      movePlayer(r.x, r.z);
      feedLog('warning', '🔥 Bajas a la Fosa de Guayota. ¡Prepárate, la primera ronda empieza ya!');
      try { audio.synth?.('altar', { volume: 0.8, pitch: 0.6 }); } catch {}
    }
  } catch (err) {
    feedLog('error', err?.message || 'No puedes entrar ahora.');
  } finally { busy = false; }
}

export async function leave() {
  if (busy) return;
  busy = true;
  try {
    const r = await api.fosaLeave();
    if (r?.x != null) movePlayer(r.x, r.z);
    feedLog('info', 'Sales de la Fosa. Kargath te mira decepcionado.');
  } catch {} finally { busy = false; }
}

// ------------------------------------------------------------
// Update
// ------------------------------------------------------------
export function update(dt) {
  if (!started) return;
  timeAcc += dt;
  for (const m of lavaMats) m.emissiveIntensity = 1.0 + Math.sin(timeAcc * 2) * 0.3;
  group?.children.forEach(o => { if (o.userData.flame) o.scale.set(1, 1 + Math.sin(timeAcc * 9 + o.position.x) * 0.2, 1); });

  const f = getSnapshot?.()?.me?.fosa;
  if (!f) { if (hud) hud.style.display = 'none'; return; }
  const clock = Date.now() + ((f.now || Date.now()) - (getSnapshot()?._receivedAt || Date.now()));

  // Resultado (una vez por resultado)
  if (f.result && f.result.at && f.result.at !== lastResultAt) {
    const first = lastResultAt === 0;
    lastResultAt = f.result.at;
    if (!first && clock - f.result.at < 15000) {
      const r = f.result;
      if (r.k === 'reward') feedLog('info', `🏅 ¡Ronda ${r.wave} superada! Recibes ${r.coins?.toLocaleString?.('es-ES') || r.coins} monedas.`);
      else if (r.k === 'won') {
        feedLog('warning', `🔥🏆 ¡HAS VENCIDO A GUAYOTA! Recibes la CAPA DE FUEGO y ${r.coins} monedas.`);
        try { window.__spawnLevelUpBanner?.('fosa', 'CAPA DE FUEGO'); } catch {}
        try { audio.synth?.('level_up', { volume: 1 }); } catch {}
      } else if (r.k === 'lost') {
        feedLog('error', `☠ Caes en la ronda ${r.wave}. Kargath te saca de la Fosa (no pierdes nada).`);
        if (r.x != null) movePlayer(r.x, r.z);
      } else if (r.k === 'left') {
        feedLog('info', 'Has abandonado la Fosa.');
      }
    }
  }

  if (!hud) return;
  if (!f.active) { hud.style.display = 'none'; lastWave = -1; return; }
  hud.style.display = 'flex';
  const w = hud.querySelector('.w');
  if (f.next_wave_at && f.next_wave_at > clock) {
    w.innerHTML = `🔥 Ronda <b>${f.wave + 1}</b> / ${f.waves} en ${Math.ceil((f.next_wave_at - clock) / 1000)} s`;
  } else {
    w.innerHTML = `🔥 Ronda <b>${f.wave}</b> / ${f.waves}`;
  }
  if (f.wave !== lastWave) {
    if (lastWave >= 0 && f.wave > 0) {
      feedLog('warning', f.wave === f.waves ? '🔥 ¡ÚLTIMA RONDA! Aparece GUAYOTA. Mira su brillo: verde = proyectiles, azul = magia.' : `🔥 ¡Ronda ${f.wave}!`);
      try { audio.synth?.('pray_on', { volume: 0.8, pitch: 0.7 }); } catch {}
    }
    lastWave = f.wave;
  }

  // Aviso de Guayota
  const tEl = hud.querySelector('.tele');
  if (f.tele && f.tele.at > clock - 200) {
    tEl.style.display = '';
    tEl.className = `tele ${f.tele.s}`;
    tEl.textContent = f.tele.s === 'magic' ? '🔵 ¡MAGIA!' : '🟢 ¡PROYECTILES!';
    if (f.tele.t0 !== lastTeleAt) {
      lastTeleAt = f.tele.t0;
      try { window.__getNpcProc?.(f.tele.n)?.setGlow?.(f.tele.s); } catch {}
      try { audio.synth?.('pray_off', { volume: 0.7 }); } catch {}
    }
  } else tEl.style.display = 'none';

  // Ataques de las criaturas → proyectiles hacia ti
  for (const a of f.atk || []) {
    if (a.at <= lastAtkAt) continue;
    lastAtkAt = Math.max(lastAtkAt, a.at);
    if (clock - a.at > 2500) continue;
    try { window.__getNpcProc?.(a.n)?.attack?.(); } catch {}
    const from = window.__getNpcPosition?.(a.n), p = getPlayer?.();
    if (from && p && a.s !== 'melee' && window.__worldFireProjectile) {
      const spell = a.s === 'magic' ? 'fire_strike' : 'entangle';
      window.__worldFireProjectile({ x: from.x, y: 0, z: from.z }, { x: p.position.x, y: 0, z: p.position.z },
        { type: 'spell', spellId: spell, color: a.s === 'magic' ? 0xff6a1a : 0x60ff40, windupMs: 120 });
    }
    if (a.blk) feedLog('info', '🙏 Tu plegaria bloquea el ataque.');
  }
}

export function getForMap() { return { x: FOSA.x, z: FOSA.z, name: 'Fosa de Guayota' }; }
export const FOSA_MOB_IDS = Object.keys(FOSA_MOBS);
