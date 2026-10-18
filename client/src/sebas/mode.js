/**
 * SEBAS PRESENT — «La Cruzada» · modo historia de acción (estilo John Wick)
 *
 * Pantalla aparte (el mundo del MMO se pausa y no habla con el servidor):
 *   menú de capítulos → escena → oleadas → jefe → escena final → resultado.
 * Controles
 *   Móvil: joystick a la izquierda; 👊 golpe (combo de 3), 🔫 disparo (apunta solo),
 *          🌀 esquivar (invulnerable), ⭐ compañero, ⏱ tiempo bala (con la barra llena).
 *   PC:    WASD/flechas · J o clic = golpe · K o clic derecho = disparo · Espacio = esquivar
 *          · E = compañero · Q = tiempo bala · Esc = pausa.
 * Progreso en localStorage (no gasta servidor).
 */
import * as THREE from 'three';
import * as mixamoRig from '../mixamo_rig.js';
import * as afk from '../core/afk.js';
import * as audio from '../audio.js';
import { CAST, ALLIES, CHAPTERS } from './chapters.js';
import { buildArena } from './arena.js';

const SAVE_KEY = 'sp_sebas_v1';
const ANIMS = 'mago';
const ENEMY_MODELS = {
  thug: ['m33', 'm34', 'm38', 'm39', 'm43', 'killer_09', 'f36', 'f40'],
  gunner: ['sheriff_n', 'sheriff_n_01', 'm45', 'f43'],
  tank: ['m37', 'm44', 'guardia2'],
};

// ------------------------------------------------------------
// Guardado
// ------------------------------------------------------------
function loadSave() {
  try { const s = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null'); if (s && s.done) return s; } catch {}
  return { done: {}, allies: [], pick: null };
}
function writeSave() { try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch {} }
let save = loadSave();
const unlocked = (ch) => ch.n === 1 || !!save.done[CHAPTERS[ch.n - 2].id];

// ------------------------------------------------------------
// Estado general
// ------------------------------------------------------------
let root = null, canvas = null, renderer = null, scene = null, camera = null, raf = 0, clock = null;
let screen = 'off';   // off | menu | loading | cutscene | play | pause | result | dead
let G = null;         // partida en curso
const keys = new Set();
let joy = { id: null, ox: 0, oy: 0, x: 0, y: 0 };
let worldWasPaused = false;
let unAfk = null;

export function isOpen() { return screen !== 'off'; }

export function open() {
  if (screen !== 'off') return;
  ensureCss();
  root = document.createElement('div');
  root.id = 'sebasMode';
  root.innerHTML = `<canvas class="sm-canvas"></canvas><div class="sm-ui"></div>`;
  document.body.appendChild(root);
  root.addEventListener('pointerdown', e => e.stopPropagation());
  root.addEventListener('contextmenu', e => e.preventDefault());
  canvas = root.querySelector('.sm-canvas');
  window.__sebasModeOn = true;
  worldWasPaused = afk.isPaused();
  try { afk.pauseFor?.('sebas'); } catch {}
  // si la pestaña se oculta y vuelve, el mundo se reanudaría: lo volvemos a dormir mientras estés aquí
  unAfk = afk.onChange?.((paused) => { if (!paused && screen !== 'off') setTimeout(() => { if (screen !== 'off') afk.pauseFor('sebas'); }, 0); });
  try { audio.setMusicPaused?.(true); } catch {}
  window.addEventListener('keydown', onKey, true);
  window.addEventListener('keyup', onKeyUp, true);
  window.addEventListener('resize', onResize);
  showMenu();
}

export function close() {
  stopGame();
  window.removeEventListener('keydown', onKey, true);
  window.removeEventListener('keyup', onKeyUp, true);
  window.removeEventListener('resize', onResize);
  if (renderer) { renderer.dispose(); renderer.forceContextLoss?.(); renderer = null; }
  root?.remove(); root = null; canvas = null; scene = null; camera = null;
  screen = 'off';
  try { unAfk?.(); } catch {} unAfk = null;
  window.__sebasModeOn = false;
  if (!worldWasPaused) { try { afk.resume(); } catch {} }
  try { audio.setMusicPaused?.(false); } catch {}
}

const ui = () => root.querySelector('.sm-ui');
function esc(s) { return String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

// ------------------------------------------------------------
// Sonido (sintetizado, sin archivos)
// ------------------------------------------------------------
let actx = null;
function ctx() {
  if (actx) return actx;
  try { actx = audio.getContext?.() || new (window.AudioContext || window.webkitAudioContext)(); } catch { actx = null; }
  return actx;
}
function sfx(kind) {
  const c = ctx(); if (!c) return;
  let vol = 0.6; try { vol = audio.getPrefs?.().sfx ?? 0.6; } catch {}
  if (vol <= 0) return;
  const now = c.currentTime;
  const out = c.createGain(); out.connect(c.destination);
  const noise = (dur, f, q = 1, v = 0.6) => {
    const b = c.createBuffer(1, Math.ceil(c.sampleRate * dur), c.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length) ** 2;
    const s = c.createBufferSource(); s.buffer = b;
    const fl = c.createBiquadFilter(); fl.type = 'bandpass'; fl.frequency.value = f; fl.Q.value = q;
    const g = c.createGain(); g.gain.value = v * vol;
    s.connect(fl); fl.connect(g); g.connect(out); s.start(now);
  };
  const tone = (f0, f1, dur, type = 'sine', v = 0.4) => {
    const o = c.createOscillator(), g = c.createGain(); o.type = type;
    o.frequency.setValueAtTime(f0, now); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), now + dur);
    g.gain.setValueAtTime(v * vol, now); g.gain.exponentialRampToValueAtTime(0.001, now + dur);
    o.connect(g); g.connect(out); o.start(now); o.stop(now + dur + 0.02);
  };
  if (kind === 'punch') { noise(0.12, 900, 0.8, 0.7); tone(160, 60, 0.12, 'sine', 0.5); }
  else if (kind === 'heavy') { noise(0.2, 500, 0.7, 0.9); tone(120, 40, 0.25, 'sine', 0.7); }
  else if (kind === 'shot') { noise(0.18, 2200, 0.5, 1.0); tone(400, 80, 0.08, 'square', 0.25); }
  else if (kind === 'eshot') { noise(0.14, 1500, 0.6, 0.5); }
  else if (kind === 'hurt') { tone(300, 120, 0.2, 'sawtooth', 0.25); }
  else if (kind === 'dodge') { noise(0.15, 3000, 0.4, 0.35); }
  else if (kind === 'kill') { tone(220, 55, 0.35, 'triangle', 0.5); }
  else if (kind === 'reload') { tone(1200, 900, 0.05, 'square', 0.15); setTimeout(() => sfx('click'), 200); }
  else if (kind === 'click') { tone(1500, 1400, 0.03, 'square', 0.12); }
  else if (kind === 'ally') { tone(440, 880, 0.25, 'triangle', 0.35); }
  else if (kind === 'bt') { tone(200, 60, 0.8, 'sine', 0.5); }
  else if (kind === 'pickup') { tone(660, 1320, 0.15, 'triangle', 0.35); }
  else if (kind === 'win') { [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => { try { const cc = ctx(); const o = cc.createOscillator(), g = cc.createGain(); o.type = 'triangle'; o.frequency.value = f; g.gain.setValueAtTime(0.25 * vol, cc.currentTime); g.gain.exponentialRampToValueAtTime(0.001, cc.currentTime + 0.4); o.connect(g); g.connect(cc.destination); o.start(); o.stop(cc.currentTime + 0.42); } catch {} }, i * 130)); }
}

// ------------------------------------------------------------
// MENÚ
// ------------------------------------------------------------
function showMenu() {
  stopGame();
  screen = 'menu';
  const rankOf = (id) => save.done[id]?.rank || '';
  const crew = Object.entries(ALLIES).map(([id, a]) => {
    const has = save.allies.includes(id);
    return `<div class="sm-crew${has ? '' : ' off'}" title="${esc(a.desc)}"><div class="i">${has ? a.icon : '🔒'}</div><div class="n">${esc(has ? CAST[id].name : '???')}</div>${has ? `<div class="s">${esc(a.skill)}</div>` : ''}</div>`;
  }).join('');
  ui().innerHTML = `
    <div class="sm-menu">
      <button class="sm-x" data-act="close" aria-label="Salir">✕</button>
      <div class="sm-logo"><div class="a">SEBAS PRESENT</div><div class="b">La Cruzada</div></div>
      <div class="sm-tag">Un argentino. Una maleta. Cuarenta pesetas. Y una isla entera en contra.</div>
      <div class="sm-chapters">${CHAPTERS.map(ch => {
        const ok = unlocked(ch), r = rankOf(ch.id);
        return `<button class="sm-ch${ok ? '' : ' locked'}" data-ch="${ch.id}" ${ok ? '' : 'disabled'}>
          <div class="n">${ch.n}</div><div class="t"><b>${esc(ch.title)}</b><span>${esc(ch.date)} · ${esc(ch.place)}</span></div>
          <div class="r">${ok ? (r ? `<span class="rank r${r}">${r}</span>` : '▶') : '🔒'}</div></button>`;
      }).join('')}</div>
      <div class="sm-h">La banda</div>
      <div class="sm-crewrow">${crew}</div>
      <div class="sm-help">PC: WASD · J golpe · K disparo · Espacio esquivar · E compañero · Q tiempo bala</div>
    </div>`;
  ui().onclick = (e) => {
    const b = e.target.closest('[data-ch],[data-act]'); if (!b) return;
    sfx('click');
    if (b.dataset.act === 'close') { close(); return; }
    if (b.dataset.ch) pickAllyThen(b.dataset.ch);
  };
}

function pickAllyThen(chId) {
  const ch = CHAPTERS.find(c => c.id === chId);
  const have = save.allies.filter(a => ALLIES[a]);
  if (!have.length) { startChapter(ch, null); return; }
  const pick = have.includes(save.pick) ? save.pick : have[0];
  ui().innerHTML = `<div class="sm-menu">
    <div class="sm-h big">Capítulo ${ch.n}: ${esc(ch.title)}</div>
    <div class="sm-tag">¿Quién te acompaña? (botón ⭐ en combate)</div>
    <div class="sm-crewrow pick">${have.map(id => `<button class="sm-crew${id === pick ? ' sel' : ''}" data-ally="${id}"><div class="i">${ALLIES[id].icon}</div><div class="n">${esc(CAST[id].name)}</div><div class="s">${esc(ALLIES[id].skill)}</div><div class="d">${esc(ALLIES[id].desc)}</div></button>`).join('')}</div>
    <div class="sm-btns"><button class="sm-btn" data-act="back">← Volver</button><button class="sm-btn go" data-act="go">¡A pelear!</button></div></div>`;
  let sel = pick;
  ui().onclick = (e) => {
    const a = e.target.closest('[data-ally]');
    if (a) { sel = a.dataset.ally; ui().querySelectorAll('[data-ally]').forEach(x => x.classList.toggle('sel', x.dataset.ally === sel)); sfx('click'); return; }
    const b = e.target.closest('[data-act]'); if (!b) return;
    sfx('click');
    if (b.dataset.act === 'back') showMenu();
    else { save.pick = sel; writeSave(); startChapter(ch, sel); }
  };
}

// ------------------------------------------------------------
// MOTOR: escena, actores
// ------------------------------------------------------------
function ensureRenderer() {
  if (renderer) return;
  renderer = new THREE.WebGLRenderer({ canvas, antialias: (window.devicePixelRatio || 1) <= 1 });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.25));
  onResize();
}
function onResize() {
  if (!renderer || !canvas) return;
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  if (camera) { camera.aspect = w / h; camera.updateProjectionMatrix(); }
}

const RING_MAT = new THREE.MeshBasicMaterial({ color: 0xff2a1a, transparent: true, opacity: 0.0, depthWrite: false, side: THREE.DoubleSide });
function makeActor(who, opts = {}) {
  const c = CAST[who] || {};
  const model = opts.model || c.model || 'm33';
  const tint = opts.tint !== undefined ? opts.tint : c.tint;
  const scale = opts.scale || c.scale || 1;
  const rig = mixamoRig.create(model, { tint, anims: ANIMS, scale, phase: Math.random() * 10 });
  const g = new THREE.Group();
  if (rig) g.add(rig.root);
  else {
    const m = new THREE.Mesh(new THREE.CapsuleGeometry(0.35, 1.0, 4, 8), new THREE.MeshLambertMaterial({ color: opts.team === 'enemy' ? 0x8a2a2a : 0x2a4a8a }));
    m.position.y = 0.9; g.add(m);
  }
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.6, 0.85, 24), RING_MAT.clone());
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.04; g.add(ring);
  g.position.set(opts.x || 0, 0, opts.z || 0);
  scene.add(g);
  const a = {
    who, rig, g, ring, team: opts.team || 'enemy', kind: opts.kind || 'thug', name: c.name || '',
    x: opts.x || 0, z: opts.z || 0, yaw: opts.yaw || 0, vx: 0, vz: 0, kx: 0, kz: 0,
    hp: opts.hp || 40, maxHp: opts.hp || 40, dead: false, deadT: 0,
    anim: null, onceT: 0, st: 'chase', stT: 0, cd: 1 + Math.random(), wind: 0, scale,
    hurtFlash: 0, statusT: 0, status: null, speed: opts.speed || 3, dmg: opts.dmg || 8, boss: !!opts.boss,
  };
  play(a, 'idle');
  return a;
}
function removeActor(a) { if (!a) return; scene?.remove(a.g); try { a.rig?.dispose(); } catch {} }

function play(a, name, opts = {}) {
  const acts = a.rig?.actions; if (!acts) return;
  const act = acts[name]; if (!act) return;
  const { once = false, ts = 1, fade = 0.12 } = opts;
  if (a.anim === act && !once) { act.setEffectiveTimeScale(ts); return; }
  act.reset();
  act.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, once ? 1 : Infinity);
  act.clampWhenFinished = once;
  act.setEffectiveTimeScale(ts); act.setEffectiveWeight(1); act.play();
  if (a.anim && a.anim !== act) act.crossFadeFrom(a.anim, fade, true);
  a.anim = act;
  a.onceT = once ? act.getClip().duration / ts * 0.92 : 0;
}

function faceTo(a, x, z) { a.yaw = Math.atan2(x - a.x, z - a.z); }
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

// colisión con el escenario (círculo del actor contra cajas y círculos)
function collide(a, r = 0.45) {
  const A = G.arena;
  a.x = Math.max(-A.hw, Math.min(A.hw, a.x)); a.z = Math.max(-A.hd, Math.min(A.hd, a.z));
  for (const b of A.boxes) {
    const px = b.hx + r - Math.abs(a.x - b.x), pz = b.hz + r - Math.abs(a.z - b.z);
    if (px > 0 && pz > 0) { if (px < pz) a.x += Math.sign(a.x - b.x || 1) * px; else a.z += Math.sign(a.z - b.z || 1) * pz; }
  }
  for (const c of A.circles) {
    const dx = a.x - c.x, dz = a.z - c.z, d = Math.hypot(dx, dz), m = c.r + r;
    if (d < m) { const k = (m - d) / (d || 1); a.x += dx * k; a.z += dz * k; }
  }
}

// ------------------------------------------------------------
// PARTIDA
// ------------------------------------------------------------
function stopGame() {
  cancelAnimationFrame(raf); raf = 0;
  if (G) {
    for (const a of [G.p, ...G.enemies, ...G.extras, G.ally?.a].filter(Boolean)) removeActor(a);
    G = null;
  }
  if (scene) { scene.traverse(o => { o.geometry?.dispose?.(); }); scene = null; }
}

async function startChapter(ch, ally) {
  stopGame();
  screen = 'loading';
  ui().innerHTML = `<div class="sm-loading"><div class="t">Capítulo ${ch.n}</div><div class="b">${esc(ch.title)}</div><div class="c">${esc(ch.date)} · ${esc(ch.place)}</div><div class="bar"><i></i></div></div>`;
  ui().onclick = null;
  ensureRenderer();
  // modelos que hacen falta
  const need = new Set([CAST.sebas.model]);
  for (const l of [...ch.intro, ...ch.outro]) if (CAST[l[0]]?.model) need.add(CAST[l[0]].model);
  if (ch.boss) { need.add(CAST[ch.boss.who].model); for (const w of ch.boss.adds || []) need.add(CAST[w].model); }
  if (ally) need.add(CAST[ally].model);
  for (const list of Object.values(ENEMY_MODELS)) for (const m of list.slice(0, 4)) need.add(m);
  const list = [...need];
  let done = 0;
  const bar = ui().querySelector('.bar i');
  await Promise.all(list.map(m => mixamoRig.preload(m, ANIMS).catch(() => null).then(() => { done++; if (bar) bar.style.width = `${Math.round(done / list.length * 100)}%`; })));
  if (screen !== 'loading') return;

  scene = new THREE.Scene();
  const arena = buildArena(ch.theme);
  scene.background = new THREE.Color(arena.sky);
  scene.fog = new THREE.Fog(arena.sky, arena.fog[0], arena.fog[1]);
  scene.add(new THREE.HemisphereLight(0xfff4e0, 0x3a3040, 1.0));
  const sun = new THREE.DirectionalLight(0xffffff, 1.1); sun.position.set(-8, 20, 10); scene.add(sun);
  scene.add(arena.group);
  camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 200);
  onResize();

  const diff = 1 + (ch.n - 1) * 0.12;
  G = {
    ch, arena, diff, allyId: ally, t: 0, time: 0,
    p: null, enemies: [], extras: [], projectiles: [], pickups: [], fx: [],
    wave: -1, waveDelay: 0, phase: 'intro', boss: null,
    score: 0, combo: 0, comboT: 0, maxCombo: 0, dmgTaken: 0, deaths: 0,
    meter: 0, bt: 0, hitstop: 0, shake: 0, slowmo: 0,
    ammo: 12, maxAmmo: 12, reloadT: 0, shootCd: 0, atkT: 0, comboStep: 0, comboWin: 0, dodgeT: 0, dodgeCd: 0, inv: 0,
    allyCd: 0, ally: null, bossSummons: 0, buffered: null,
    camPos: new THREE.Vector3(0, 16, 16),
  };
  G.p = makeActor('sebas', { team: 'player', x: 0, z: 6, hp: 100, yaw: Math.PI });
  G.p.hp = G.p.maxHp = 100;
  buildHud();
  clock = new THREE.Clock();
  loop();
  runCutscene(ch.intro, () => { G.phase = 'waves'; nextWave(); if (ch.tutorial) tutorial(); });
}

function tutorial() {
  const tips = isTouch()
    ? ['🕹 Muévete con el joystick (izquierda)', '👊 Golpea: tres toques seguidos = combo', '🌀 Esquiva: eres invulnerable mientras ruedas', '⏱ Llena la barra amarilla y activa el tiempo bala']
    : ['🕹 WASD para moverte', '👊 J o clic: combo de tres golpes', '🌀 Espacio: esquivar (invulnerable)', '🔫 K o clic derecho: disparar · ⏱ Q: tiempo bala'];
  tips.forEach((t, i) => setTimeout(() => toast(t, 3200), 600 + i * 3600));
}

// ------------------------------------------------------------
// Oleadas y jefe
// ------------------------------------------------------------
const STATS = {
  thug:   { hp: 40, speed: 3.3, dmg: 9 },
  gunner: { hp: 34, speed: 2.7, dmg: 12 },
  tank:   { hp: 130, speed: 2.1, dmg: 18 },
};
function spawnEnemy(kind, pos, extra = {}) {
  const S = STATS[kind] || STATS.thug;
  const pool = ENEMY_MODELS[kind] || ENEMY_MODELS.thug;
  const model = extra.model || pool.filter(m => mixamoRig.isLoaded(m))[Math.floor(Math.random() * pool.length) % Math.max(1, pool.filter(m => mixamoRig.isLoaded(m)).length)] || pool[0];
  const tint = extra.tint !== undefined ? extra.tint : { hue: Math.floor(Math.random() * 6) / 6, sat: 1.1, val: [0.6, 0.85][Math.floor(Math.random() * 2)] };   // pocos tintes = materiales compartidos
  const e = makeActor(extra.who || null, { team: 'enemy', kind, model, tint, x: pos.x, z: pos.z, hp: Math.round((extra.hp || S.hp) * (extra.hp ? 1 : G.diff)), speed: S.speed, dmg: Math.round(S.dmg * (1 + (G.ch.n - 1) * 0.08)), boss: extra.boss, scale: extra.scale || (kind === 'tank' ? 1.18 : 1) });
  e.cd = 1.2 + Math.random() * 1.5;
  e.bossKind = extra.bossKind || null;
  e.who = extra.who || null;
  G.enemies.push(e);
  return e;
}
function nextWave() {
  G.wave++;
  const waves = G.ch.waves;
  if (G.wave < waves.length) {
    banner(`Oleada ${G.wave + 1} / ${waves.length}`, '');
    let i = 0;
    for (const [kind, n] of waves[G.wave]) for (let k = 0; k < n; k++) {
      const sp = G.arena.spawns[(i++ * 7 + G.wave * 3) % G.arena.spawns.length];
      setTimeout(() => { if (G && screen !== 'off') spawnEnemy(kind, { x: sp.x + (Math.random() - 0.5) * 3, z: sp.z }); }, k * 260 + Math.random() * 300);
    }
  } else if (G.ch.boss && !G.boss) {
    const B = G.ch.boss, c = CAST[B.who];
    G.phase = 'boss';
    const kind = B.kind === 'tank' || B.kind === 'tankboss' ? 'tank' : B.kind === 'final' ? 'gunner' : 'gunner';
    G.boss = spawnEnemy(kind, { x: 0, z: -G.arena.hd + 2 }, { who: B.who, model: c.model, tint: c.tint ?? null, hp: B.hp, boss: true, bossKind: B.kind, scale: (c.scale || 1) * 1.12 });
    G.boss.name = c.name;
    banner(c.name.toUpperCase(), c.title, true);
    sfx('bt');
  } else {
    winChapter();
  }
}

// ------------------------------------------------------------
// BUCLE
// ------------------------------------------------------------
function loop() {
  raf = requestAnimationFrame(loop);
  if (!G || !renderer) return;
  let dt = Math.min(0.05, clock.getDelta());
  if (screen === 'pause') { renderer.render(scene, camera); return; }
  G.time += dt;
  if (G.hitstop > 0) { G.hitstop -= dt; dt *= 0.05; }
  if (G.slowmo > 0) { G.slowmo -= dt; dt *= 0.3; }
  const edt = G.bt > 0 ? dt * 0.3 : dt;   // enemigos en tiempo bala
  if (G.bt > 0) { G.bt -= dt; if (G.bt <= 0) canvas.classList.remove('bt'); }
  if (screen === 'play') {
    updatePlayer(dt);
    updateEnemies(edt);
    updateProjectiles(edt);
    updatePickups(dt);
    updateAlly(dt, edt);
    if (G.phase === 'waves' && !G.enemies.some(e => !e.dead) && G.waveDelay <= 0 && G.wave >= 0) { G.waveDelay = 1.6; }
    if (G.waveDelay > 0) { G.waveDelay -= dt; if (G.waveDelay <= 0 && !G.enemies.some(e => !e.dead)) nextWave(); }
    if (G.comboT > 0) { G.comboT -= dt; if (G.comboT <= 0) G.combo = 0; }
  }
  // animaciones y transformaciones
  for (const a of [G.p, ...G.enemies, ...G.extras, G.ally?.a].filter(Boolean)) {
    const adt = a.team === 'enemy' ? edt : dt;
    a.rig?.mixer?.update(adt);
    if (a.rig && !a.rig.hasClips) a.rig.update(adt, { moving: a.moving, speed: a.speed, attack: a._atkFlag, hurt: a._hurtFlag, dead: a.dead });
    a._atkFlag = a._hurtFlag = false;
    a.g.position.set(a.x, 0, a.z);
    a.g.rotation.y += ((a.yaw - a.g.rotation.y + Math.PI * 3) % (Math.PI * 2) - Math.PI) * Math.min(1, adt * 14);
    if (a.onceT > 0) a.onceT -= adt;
    a.ring.material.opacity = a.wind > 0 ? 0.35 + 0.4 * Math.sin(G.time * 30) : 0;
  }
  updateFx(dt);
  updateCamera(dt);
  renderer.render(scene, camera);
  updateHud();
}

function updateCamera(dt) {
  const p = G.p;
  const close = screen === 'cutscene';
  const portrait = camera.aspect < 0.9;
  // en vertical (móvil) más alta y más lejos: se ve la sala entera y las columnas no tapan
  const off = close ? (portrait ? new THREE.Vector3(0, 8, 12.5) : new THREE.Vector3(0, 6.5, 9))
                    : (portrait ? new THREE.Vector3(0, 23, 9.5) : new THREE.Vector3(0, 15.5, 11.5));
  const fov = portrait ? 58 : 50;
  if (camera.fov !== fov) { camera.fov = fov; camera.updateProjectionMatrix(); }
  const ahead = close ? 0 : (portrait ? 3.2 : 1);
  const target = new THREE.Vector3(p.x, 0, p.z + (close ? -1.5 : 0));
  if (close && G.cutTarget) target.set((p.x + G.cutTarget.x) / 2, 0, (p.z + G.cutTarget.z) / 2);
  const want = target.clone().add(off); want.z -= ahead;
  G.camPos.lerp(want, Math.min(1, dt * (close ? 3 : 6)));
  camera.position.copy(G.camPos);
  if (G.shake > 0) { G.shake -= dt; camera.position.x += (Math.random() - 0.5) * G.shake * 1.2; camera.position.y += (Math.random() - 0.5) * G.shake * 1.2; }
  camera.lookAt(target.x, close ? 1.2 : 0.6, target.z - ahead - (close ? 0 : 1));
}

// ------------------------------------------------------------
// JUGADOR
// ------------------------------------------------------------
function inputVec() {
  let x = 0, z = 0;
  if (keys.has('KeyW') || keys.has('ArrowUp')) z -= 1;
  if (keys.has('KeyS') || keys.has('ArrowDown')) z += 1;
  if (keys.has('KeyA') || keys.has('ArrowLeft')) x -= 1;
  if (keys.has('KeyD') || keys.has('ArrowRight')) x += 1;
  if (joy.id != null) { x = joy.x; z = joy.y; }
  const l = Math.hypot(x, z);
  return l > 1 ? { x: x / l, z: z / l } : { x, z };
}
function nearestEnemy(maxD, from = G.p) {
  let best = null, bd = maxD;
  for (const e of G.enemies) { if (e.dead) continue; const d = dist(from, e); if (d < bd) { bd = d; best = e; } }
  return best;
}

function updatePlayer(dt) {
  const p = G.p;
  if (p.dead) return;
  G.atkT -= dt; G.shootCd -= dt; G.dodgeCd -= dt; G.inv -= dt; G.allyCd -= dt; G.comboWin -= dt;
  if (G.reloadT > 0) { G.reloadT -= dt; if (G.reloadT <= 0) { G.ammo = G.maxAmmo; sfx('click'); } }
  const v = inputVec();
  if (G.dodgeT > 0) {
    G.dodgeT -= dt;
    p.x += G.dodgeX * 15 * dt; p.z += G.dodgeZ * 15 * dt;
  } else if (G.atkT > 0) {
    p.x += p.kx * dt; p.z += p.kz * dt; p.kx *= 0.85; p.kz *= 0.85;
  } else {
    const sp = 6.2;
    p.x += v.x * sp * dt; p.z += v.z * sp * dt;
    p.moving = Math.hypot(v.x, v.z) > 0.1;
    if (p.moving) { p.yaw = Math.atan2(v.x, v.z); if (p.onceT <= 0) play(p, 'run', { ts: 1.1 }); }
    else if (p.onceT <= 0) play(p, 'idle');
    if (G.buffered && G.atkT <= 0) { const b = G.buffered; G.buffered = null; if (b === 'punch') doPunch(); }
  }
  collide(p, 0.4);
}

function doPunch() {
  if (screen !== 'play' || G.p.dead) return;
  if (G.atkT > 0 || G.dodgeT > 0) { G.buffered = 'punch'; return; }
  const p = G.p;
  G.comboStep = G.comboWin > 0 ? (G.comboStep + 1) % 3 : 0;
  G.comboWin = 0.75;
  const step = G.comboStep;
  const t = nearestEnemy(3.2);
  if (t) { faceTo(p, t.x, t.z); const d = Math.max(0, dist(p, t) - 1.1); p.kx = Math.sin(p.yaw) * d * 7; p.kz = Math.cos(p.yaw) * d * 7; }
  else { p.kx = Math.sin(p.yaw) * 2.5; p.kz = Math.cos(p.yaw) * 2.5; }
  const anim = ['atk1h_2', 'atk1h_3', 'atk2h_1'][step];
  play(p, anim, { once: true, ts: step === 2 ? 1.7 : 2.1, fade: 0.05 });
  p._atkFlag = true;
  G.atkT = step === 2 ? 0.42 : 0.28;
  setTimeout(() => {
    if (!G || G.p.dead) return;
    const dmg = [13, 13, 28][step], kb = [1.2, 1.2, 7][step];
    let hit = 0;
    for (const e of G.enemies) {
      if (e.dead) continue;
      const d = dist(p, e); if (d > 2.0 + (e.boss ? 0.5 : 0)) continue;
      const ang = Math.atan2(e.x - p.x, e.z - p.z), diffA = Math.abs(((ang - p.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
      if (diffA > 1.3 && d > 1.0) continue;
      damageEnemy(e, dmg, Math.sin(ang) * kb, Math.cos(ang) * kb, step === 2);
      hit++;
    }
    if (hit) { sfx(step === 2 ? 'heavy' : 'punch'); G.hitstop = step === 2 ? 0.09 : 0.045; G.shake = step === 2 ? 0.25 : 0.1; }
  }, step === 2 ? 170 : 110);
}

function doShoot() {
  if (screen !== 'play' || G.p.dead || G.dodgeT > 0) return;
  if (G.reloadT > 0 || G.shootCd > 0) return;
  if (G.ammo <= 0) { G.reloadT = 1.2; sfx('reload'); toast('🔫 Recargando…', 1000); return; }
  const p = G.p;
  const t = nearestEnemy(17);
  if (t) faceTo(p, t.x, t.z);
  play(p, 'cast1h', { once: true, ts: 2.6, fade: 0.04 });
  G.atkT = 0.16; G.shootCd = 0.26; G.ammo--;
  sfx('shot');
  const sx = p.x + Math.sin(p.yaw) * 0.7, sz = p.z + Math.cos(p.yaw) * 0.7;
  let ex = p.x + Math.sin(p.yaw) * 17, ez = p.z + Math.cos(p.yaw) * 17;
  if (t) { ex = t.x; ez = t.z; damageEnemy(t, 30, Math.sin(p.yaw) * 2.5, Math.cos(p.yaw) * 2.5, false, true); }
  tracer(sx, sz, ex, ez);
  flash(sx, 1.35, sz, 0xffd27a, 0.08, 1.2);
  G.shake = Math.max(G.shake, 0.08);
  if (G.ammo <= 0) { G.reloadT = 1.2; sfx('reload'); }
}

function doDodge() {
  if (screen !== 'play' || G.p.dead || G.dodgeCd > 0) return;
  const v = inputVec(), p = G.p;
  let dx = v.x, dz = v.z;
  if (Math.hypot(dx, dz) < 0.1) { dx = -Math.sin(p.yaw); dz = -Math.cos(p.yaw); }
  const l = Math.hypot(dx, dz) || 1;
  G.dodgeX = dx / l; G.dodgeZ = dz / l;
  G.dodgeT = 0.24; G.dodgeCd = 0.5; G.inv = 0.4; G.atkT = 0;
  p.yaw = Math.atan2(G.dodgeX, G.dodgeZ);
  play(p, 'jump', { once: true, ts: 2.4, fade: 0.04 });
  sfx('dodge');
  afterimage(p);
}

function doBulletTime() {
  if (screen !== 'play' || G.meter < 100 || G.bt > 0) return;
  G.meter = 0; G.bt = 5.0;
  canvas.classList.add('bt');
  sfx('bt');
  banner('TIEMPO BALA', '', false, 1200);
}

function hurtPlayer(dmg, kx = 0, kz = 0) {
  const p = G.p;
  if (p.dead || G.inv > 0 || screen !== 'play') return;
  p.hp -= dmg; G.dmgTaken += dmg; G.inv = 0.35;
  p.kx = kx; p.kz = kz; p.x += kx * 0.15; p.z += kz * 0.15;
  G.combo = 0; G.comboT = 0;
  sfx('hurt'); G.shake = 0.3;
  play(p, dmg >= 15 ? 'react_big' : 'react', { once: true, ts: 1.8, fade: 0.05 });
  root.querySelector('.sm-hurt')?.classList.remove('on'); void root.querySelector('.sm-hurt')?.offsetWidth; root.querySelector('.sm-hurt')?.classList.add('on');
  floatText(p.x, 2.2, p.z, `-${dmg}`, '#ff5a4a');
  if (p.hp <= 0) { p.hp = 0; p.dead = true; play(p, 'death', { once: true, fade: 0.1 }); G.deaths++; setTimeout(() => G && showDead(), 1400); }
}

// ------------------------------------------------------------
// ENEMIGOS
// ------------------------------------------------------------
function damageEnemy(e, dmg, kx, kz, heavy = false, shot = false) {
  if (e.dead) return;
  if (e.status === 'fear') dmg *= 2;
  dmg = Math.round(Math.min(dmg, e.hp + 30));   // sin puntos inflados por remates enormes
  e.hp -= dmg;
  e.kx += kx; e.kz += kz;
  e.wind = 0;
  if (e.st !== 'charge') { e.st = 'stagger'; e.stT = heavy ? 0.6 : 0.3; }
  if (!e.boss || heavy) play(e, heavy ? 'react_big' : 'react', { once: true, ts: 1.8, fade: 0.04 });
  e._hurtFlag = true;
  G.combo++; G.comboT = 2.6; G.maxCombo = Math.max(G.maxCombo, G.combo);
  G.meter = Math.min(100, G.meter + (heavy ? 6 : 3));
  G.score += Math.round(dmg * (1 + G.combo * 0.1));
  floatText(e.x, 2.3 * e.scale, e.z, String(dmg), heavy ? '#ffd040' : shot ? '#ffffff' : '#ffe6b0', heavy);
  spark(e.x, 1.2 * e.scale, e.z, shot ? 0xfff0c0 : 0xffb040);
  if (e.hp <= 0) killEnemy(e);
  else if (e.boss) checkBossPhase(e);
}

function killEnemy(e) {
  e.dead = true; e.hp = 0; e.deadT = 2.5; e.wind = 0;
  play(e, Math.random() < 0.5 ? 'death' : 'death_fwd', { once: true, fade: 0.06 });
  sfx('kill');
  G.meter = Math.min(100, G.meter + 18);
  G.score += e.boss ? 1500 : 100 + G.combo * 10;
  const lines = ['¡IMPECABLE!', '¡QUÉ PIÑA!', '¡BOLUDO!', '¡LIMPIO!', '¡DE UNA!', '¡AFUERA!', '¡TOMÁ!'];
  if (G.combo >= 5 && Math.random() < 0.5) stylish(lines[Math.floor(Math.random() * lines.length)]);
  // botín: empanada (vida) o munición
  const r = Math.random();
  if (r < (G.p.hp < 45 ? 0.38 : 0.16)) dropPickup('empanada', e.x, e.z);
  else if (e.kind === 'gunner' && r < 0.6) dropPickup('ammo', e.x, e.z);
  if (e.boss && e === G.boss) {
    // el jefe cae: rematar a los que queden y cámara lenta
    for (const o of G.enemies) if (!o.dead && o !== e && !o.boss) killEnemy(o);
    if (!G.enemies.some(o => !o.dead && o.boss)) { G.slowmo = 1.4; stylish('¡K.O.!'); setTimeout(() => G && winChapter(), 2000); }
  } else if (e.boss && !G.enemies.some(o => !o.dead && o.boss) && G.boss?.dead) { G.slowmo = 1.4; setTimeout(() => G && winChapter(), 2000); }
  else if (!G.enemies.some(o => !o.dead) && G.phase === 'waves' && G.wave === G.ch.waves.length - 1) { G.slowmo = 0.7; }
}

function checkBossPhase(e) {
  const f = e.hp / e.maxHp;
  const B = G.ch.boss;
  if (e !== G.boss) return;
  if (B.kind === 'final') {
    if (f < 0.7 && G.bossSummons === 0) { G.bossSummons = 1; summonBoss('diva', 'gunboss', 260); }
    if (f < 0.4 && G.bossSummons === 1) { G.bossSummons = 2; summonBoss('coronel', 'tankboss', 300); }
  } else if ((f < 0.66 && G.bossSummons === 0) || (f < 0.33 && G.bossSummons === 1)) {
    G.bossSummons++;
    const n = 2 + G.bossSummons;
    for (let i = 0; i < n; i++) { const sp = G.arena.spawns[(i * 5 + G.bossSummons) % G.arena.spawns.length]; spawnEnemy(i % 2 ? 'gunner' : 'thug', sp); }
    say(e, B.betrayal ? '¡Muchachos, cobren ustedes, que yo me voy!' : '¡A por él!');
  }
}
function summonBoss(who, kind, hp) {
  const c = CAST[who];
  const e = spawnEnemy(kind === 'tankboss' ? 'tank' : 'gunner', { x: who === 'diva' ? -10 : 10, z: -G.arena.hd + 2 }, { who, model: c.model, tint: c.tint ?? null, hp, boss: true, bossKind: kind, scale: (c.scale || 1) * 1.08 });
  e.name = c.name;
  banner(c.name.toUpperCase(), c.title, true, 1600);
  say(e, who === 'diva' ? '¡Corten! ¡Esto no estaba en el guion!' : '¡Rodeen al argentino!');
}

function updateEnemies(dt) {
  const p = G.p;
  for (const e of G.enemies) {
    if (e.dead) { e.deadT -= dt; continue; }
    e.cd -= dt; e.stT -= dt;
    if (e.statusT > 0) { e.statusT -= dt; if (e.statusT <= 0) { e.status = null; e.over?.remove(); e.over = null; } }
    // retroceso
    e.x += e.kx * dt; e.z += e.kz * dt; e.kx *= Math.pow(0.02, dt); e.kz *= Math.pow(0.02, dt);
    const d = dist(e, p);
    const bk = e.bossKind;
    const isTank = e.kind === 'tank';
    const isGun = e.kind === 'gunner';
    e.moving = false;
    if (e.status === 'laugh') { if (e.onceT <= 0) play(e, 'idle3', { ts: 1.5 }); e.wind = 0; collide(e); continue; }
    if (e.status === 'stun') { e.wind = 0; collide(e); continue; }
    if (e.status === 'fear') {
      const ax = e.x - p.x, az = e.z - p.z, l = Math.hypot(ax, az) || 1;
      e.x += ax / l * e.speed * 1.2 * dt; e.z += az / l * e.speed * 1.2 * dt; e.yaw = Math.atan2(ax, az); e.moving = true; play(e, 'run'); collide(e); continue;
    }
    if (e.st === 'stagger') { if (e.stT <= 0) e.st = 'chase'; collide(e); continue; }
    if (p.dead) { if (e.onceT <= 0) play(e, 'idle'); continue; }

    if (e.st === 'charge') {
      e.x += e.cx * 14 * dt; e.z += e.cz * 14 * dt; e.stT -= 0;
      if (d < 1.4 * e.scale) { hurtPlayer(Math.round(e.dmg * 1.3), e.cx * 10, e.cz * 10); e.st = 'recover'; e.stT = 0.8; }
      if (e.stT <= 0) { e.st = 'recover'; e.stT = 0.7; }
      collide(e, 0.6); continue;
    }
    if (e.st === 'recover') { if (e.stT <= 0) e.st = 'chase'; if (e.onceT <= 0) play(e, 'idle'); collide(e); continue; }
    if (e.st === 'wind') {
      e.wind -= dt; faceTo(e, p.x, p.z);
      if (isGun && e.laser) updateLaser(e, p);
      if (e.wind <= 0) {
        e.laser && (e.laser.visible = false);
        if (e.attackType === 'melee') {
          play(e, 'atk1h_2', { once: true, ts: 1.6, fade: 0.05 }); e._atkFlag = true;
          if (d < 1.8 * e.scale) hurtPlayer(e.dmg, Math.sin(e.yaw) * 5, Math.cos(e.yaw) * 5);
          e.st = 'recover'; e.stT = 0.5; e.cd = 1.1 + Math.random() * 0.8;
        } else if (e.attackType === 'shot') {
          play(e, 'cast1h', { once: true, ts: 2.2, fade: 0.05 });
          const n = bk === 'final' ? 5 : (bk === 'gunboss' ? 3 : 1);
          for (let i = 0; i < n; i++) fireProjectile(e, (i - (n - 1) / 2) * 0.22, bk === 'final' ? 0xffe040 : 0xff8a30);
          sfx('eshot');
          e.st = 'recover'; e.stT = 0.4; e.cd = (e.boss ? 1.4 : 2.2) + Math.random();
        } else if (e.attackType === 'charge') {
          e.st = 'charge'; e.stT = 0.75; e.cx = Math.sin(e.yaw); e.cz = Math.cos(e.yaw); play(e, 'sprint', { ts: 1.4 });
        } else if (e.attackType === 'quake') {
          play(e, 'area2h_1', { once: true, ts: 1.6 });
          quakeRing(e.x, e.z, 3.8);
          if (d < 3.8) hurtPlayer(Math.round(e.dmg * 1.1), (p.x - e.x) * 2, (p.z - e.z) * 2);
          e.st = 'recover'; e.stT = 0.9; e.cd = 2.5;
        }
      }
      collide(e); continue;
    }
    // perseguir / mantener distancia
    let want = isGun ? 8 : 1.3 * e.scale;
    let mx = 0, mz = 0;
    if (isGun) {
      if (d > want + 2) { mx = p.x - e.x; mz = p.z - e.z; }
      else if (d < want - 2.5) { mx = e.x - p.x; mz = e.z - p.z; }
      else { const s = Math.sin(G.time * 0.7 + e.x) > 0 ? 1 : -1; mx = (p.z - e.z) * s; mz = -(p.x - e.x) * s; }
    } else if (d > want) { mx = p.x - e.x; mz = p.z - e.z; }
    // separación entre enemigos
    for (const o of G.enemies) { if (o === e || o.dead) continue; const dx = e.x - o.x, dz = e.z - o.z, dd = Math.hypot(dx, dz); if (dd < 1.2 && dd > 0.01) { mx += dx / dd * 1.5; mz += dz / dd * 1.5; } }
    const l = Math.hypot(mx, mz);
    if (l > 0.05) {
      const sp = e.speed * (isGun && d < want + 2 && d > want - 2.5 ? 0.5 : 1);
      e.x += mx / l * sp * dt; e.z += mz / l * sp * dt; e.moving = true;
      e.yaw = isGun ? Math.atan2(p.x - e.x, p.z - e.z) : Math.atan2(mx, mz);
      if (e.onceT <= 0) play(e, sp > 3 ? 'run' : 'walk', { ts: sp > 3 ? 1 : 1.2 });
    } else { faceTo(e, p.x, p.z); if (e.onceT <= 0) play(e, 'idle'); }
    // decidir ataque
    if (e.cd <= 0) {
      if (isTank && (bk === 'tankboss' ? Math.random() < 0.45 : true) && d > 3 && d < 14) { e.st = 'wind'; e.wind = 0.8; e.attackType = 'charge'; }
      else if (bk === 'tankboss' && d < 4) { e.st = 'wind'; e.wind = 0.75; e.attackType = 'quake'; }
      else if (isGun && d < 18) { e.st = 'wind'; e.wind = e.boss ? 0.6 : 0.85; e.attackType = 'shot'; ensureLaser(e); }
      else if (!isGun && d < 1.9 * e.scale) { e.st = 'wind'; e.wind = e.boss ? 0.4 : 0.48; e.attackType = 'melee'; }
      else if (isTank && d < 2) { e.st = 'wind'; e.wind = 0.5; e.attackType = 'melee'; }
    }
    collide(e, isTank ? 0.6 : 0.45);
  }
  // quitar cadáveres
  for (let i = G.enemies.length - 1; i >= 0; i--) { const e = G.enemies[i]; if (e.dead && e.deadT <= 0 && e !== G.boss) { removeActor(e); e.over?.remove(); G.enemies.splice(i, 1); } }
}

// láser de los tiradores (aviso)
const LASER_MAT = new THREE.LineBasicMaterial({ color: 0xff2020, transparent: true, opacity: 0.7 });
function ensureLaser(e) {
  if (!e.laser) { const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]); e.laser = new THREE.Line(g, LASER_MAT); scene.add(e.laser); }
  e.laser.visible = true;
}
function updateLaser(e, p) {
  const pos = e.laser.geometry.attributes.position;
  pos.setXYZ(0, e.x, 1.35, e.z); pos.setXYZ(1, p.x, 1.1, p.z); pos.needsUpdate = true;
  LASER_MAT.opacity = 0.35 + 0.35 * Math.sin(G.time * 40);
}

// ------------------------------------------------------------
// Proyectiles, recogibles, efectos
// ------------------------------------------------------------
const PGEO = new THREE.SphereGeometry(0.16, 8, 6);
function fireProjectile(e, spread, color) {
  const yaw = e.yaw + spread;
  const m = new THREE.Mesh(PGEO, new THREE.MeshBasicMaterial({ color }));
  m.position.set(e.x, 1.3, e.z); scene.add(m);
  G.projectiles.push({ m, x: e.x + Math.sin(yaw) * 0.8, z: e.z + Math.cos(yaw) * 0.8, vx: Math.sin(yaw) * 13, vz: Math.cos(yaw) * 13, life: 2.2, dmg: e.dmg });
  flash(e.x + Math.sin(yaw) * 0.8, 1.3, e.z + Math.cos(yaw) * 0.8, color, 0.07, 0.9);
}
function updateProjectiles(dt) {
  const p = G.p, A = G.arena;
  for (let i = G.projectiles.length - 1; i >= 0; i--) {
    const b = G.projectiles[i];
    b.x += b.vx * dt; b.z += b.vz * dt; b.life -= dt;
    b.m.position.set(b.x, 1.3, b.z);
    let gone = b.life <= 0 || Math.abs(b.x) > A.hw + 2 || Math.abs(b.z) > A.hd + 2;
    for (const bx of A.boxes) if (Math.abs(b.x - bx.x) < bx.hx && Math.abs(b.z - bx.z) < bx.hz) gone = true;
    if (!gone && !p.dead && Math.hypot(b.x - p.x, b.z - p.z) < 0.55) {
      if (G.inv > 0) { if (G.dodgeT > 0 && !b.grazed) { b.grazed = true; G.meter = Math.min(100, G.meter + 8); floatText(p.x, 2.4, p.z, '¡ROCE!', '#8fe0ff'); } }
      else { hurtPlayer(b.dmg, b.vx * 0.3, b.vz * 0.3); gone = true; }
    }
    if (gone) { scene.remove(b.m); b.m.material.dispose(); G.projectiles.splice(i, 1); }
  }
}
function dropPickup(kind, x, z) {
  const m = new THREE.Mesh(kind === 'empanada' ? new THREE.SphereGeometry(0.32, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2) : new THREE.BoxGeometry(0.5, 0.35, 0.35),
    new THREE.MeshLambertMaterial({ color: kind === 'empanada' ? 0xd8a050 : 0x6a7a3a, emissive: kind === 'empanada' ? 0x5a3010 : 0x203010, flatShading: true }));
  if (kind === 'empanada') m.scale.set(1.4, 0.7, 0.8);
  m.position.set(x, 0.5, z); scene.add(m);
  G.pickups.push({ kind, m, x, z, t: 0, life: 14 });
}
function updatePickups(dt) {
  const p = G.p;
  for (let i = G.pickups.length - 1; i >= 0; i--) {
    const k = G.pickups[i]; k.t += dt; k.life -= dt;
    k.m.position.y = 0.5 + Math.sin(k.t * 4) * 0.12; k.m.rotation.y += dt * 2;
    let take = !p.dead && Math.hypot(p.x - k.x, p.z - k.z) < 1.1;
    if (take) {
      if (k.kind === 'empanada') { p.hp = Math.min(p.maxHp, p.hp + 25); floatText(p.x, 2.3, p.z, '+25 🥟', '#8fe08f'); }
      else { G.ammo = Math.min(G.maxAmmo + 12, G.ammo + 6); G.reloadT = 0; floatText(p.x, 2.3, p.z, '+6 🔫', '#e0e08f'); }
      sfx('pickup');
    }
    if (take || k.life <= 0) { scene.remove(k.m); k.m.geometry.dispose(); k.m.material.dispose(); G.pickups.splice(i, 1); }
  }
}

const TRACER_MAT = new THREE.LineBasicMaterial({ color: 0xfff0b0, transparent: true, opacity: 1 });
function tracer(x0, z0, x1, z1) {
  const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(x0, 1.35, z0), new THREE.Vector3(x1, 1.2, z1)]);
  const l = new THREE.Line(g, TRACER_MAT.clone()); scene.add(l);
  G.fx.push({ o: l, t: 0.09, upd: (f, k) => { k.o.material.opacity = f; } });
}
function flash(x, y, z, color, life, size) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(0.25 * size, 6, 4), new THREE.MeshBasicMaterial({ color, transparent: true }));
  m.position.set(x, y, z); scene.add(m);
  G.fx.push({ o: m, t: life, t0: life, upd: (f, k) => { k.o.material.opacity = f; k.o.scale.setScalar(1 + (1 - f)); } });
}
function spark(x, y, z, color) {
  for (let i = 0; i < 5; i++) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.08), new THREE.MeshBasicMaterial({ color, transparent: true }));
    m.position.set(x, y, z); scene.add(m);
    const vx = (Math.random() - 0.5) * 6, vy = Math.random() * 4 + 1, vz = (Math.random() - 0.5) * 6;
    G.fx.push({ o: m, t: 0.35, t0: 0.35, upd: (f, k, dt) => { k.o.position.x += vx * dt; k.o.position.y += vy * dt; k.o.position.z += vz * dt; k.o.material.opacity = f; } });
  }
}
function quakeRing(x, z, r) {
  const m = new THREE.Mesh(new THREE.RingGeometry(0.2, 0.5, 32), new THREE.MeshBasicMaterial({ color: 0xffa040, transparent: true, side: THREE.DoubleSide, depthWrite: false }));
  m.rotation.x = -Math.PI / 2; m.position.set(x, 0.06, z); scene.add(m);
  G.fx.push({ o: m, t: 0.45, t0: 0.45, upd: (f, k) => { const s = (1 - f) * r / 0.5 + 0.4; k.o.scale.setScalar(s); k.o.material.opacity = f; } });
  G.shake = 0.35;
}
function wave(x, z, yaw, color, r) {
  const m = new THREE.Mesh(new THREE.RingGeometry(0.5, 0.9, 32, 1, -0.7, 1.4), new THREE.MeshBasicMaterial({ color, transparent: true, side: THREE.DoubleSide, depthWrite: false }));
  m.rotation.x = -Math.PI / 2; m.rotation.z = yaw - Math.PI / 2; m.position.set(x, 0.3, z); scene.add(m);
  G.fx.push({ o: m, t: 0.5, t0: 0.5, upd: (f, k) => { k.o.scale.setScalar(1 + (1 - f) * r); k.o.material.opacity = f; } });
}
function afterimage(a) {
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.3, 0.5, 20), new THREE.MeshBasicMaterial({ color: 0x8fd0ff, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
  ring.rotation.x = -Math.PI / 2; ring.position.set(a.x, 0.05, a.z); scene.add(ring);
  G.fx.push({ o: ring, t: 0.35, t0: 0.35, upd: (f, k) => { k.o.scale.setScalar(1 + (1 - f) * 2); k.o.material.opacity = f; } });
}
function updateFx(dt) {
  for (let i = G.fx.length - 1; i >= 0; i--) {
    const k = G.fx[i]; k.t -= dt;
    const f = Math.max(0, k.t / (k.t0 || 0.09));
    try { k.upd(f, k, dt); } catch {}
    if (k.t <= 0) { scene.remove(k.o); k.o.geometry?.dispose(); k.o.material?.dispose(); G.fx.splice(i, 1); }
  }
}

// ------------------------------------------------------------
// COMPAÑEROS (⭐)
// ------------------------------------------------------------
function doAlly() {
  if (screen !== 'play' || !G.allyId || G.allyCd > 0 || G.p.dead || G.ally) return;
  const id = G.allyId, A = ALLIES[id], p = G.p;
  G.allyCd = A.cd;
  const side = Math.random() < 0.5 ? -1 : 1;
  const a = makeActor(id, { team: 'ally', x: p.x + side * 1.6, z: p.z + 1.2, hp: 999 });
  faceTo(a, p.x + Math.sin(p.yaw) * 5, p.z + Math.cos(p.yaw) * 5);
  G.ally = { id, a, t: id === 'miguel' ? 4.2 : 3.2, hitT: 0 };
  sfx('ally');
  say(a, A.lines[Math.floor(Math.random() * A.lines.length)], 3000);
  if (id === 'choro') {
    play(a, 'cast2h', { once: true, ts: 1 });
    for (const e of G.enemies) if (!e.dead && dist(e, p) < 10 && !e.boss) { setStatus(e, 'laugh', 4.5, '😂'); }
    for (const e of G.enemies) if (!e.dead && e.boss && dist(e, p) < 10) setStatus(e, 'laugh', 1.6, '😂');
  } else if (id === 'ale') {
    const t = nearestEnemy(30); if (t) faceTo(a, t.x, t.z);
    play(a, 'area2h_2', { once: true, ts: 1.3 });
    setTimeout(() => {
      if (!G) return;
      wave(a.x, a.z, a.yaw, 0xff60c0, 9); G.shake = 0.3; sfx('heavy');
      for (const e of G.enemies) {
        if (e.dead || dist(e, a) > 9.5) continue;
        const ang = Math.atan2(e.x - a.x, e.z - a.z), dA = Math.abs(((ang - a.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
        if (dA > 0.9) continue;
        damageEnemy(e, e.boss ? 25 : 18, Math.sin(ang) * 16, Math.cos(ang) * 16, true);
        setStatus(e, 'stun', 1.2, '💫');
      }
    }, 350);
  } else if (id === 'roland') {
    play(a, 'block_idle', { ts: 1 });
    G.shake = 0.2;
    for (const e of G.enemies) if (!e.dead) setStatus(e, e.boss ? 'stun' : 'fear', e.boss ? 1.5 : 5.2, '😱');
  } else if (id === 'mohit') {
    play(a, 'cast1h', { once: true, ts: 1.4 });
    let n = 0;
    for (const e of G.enemies) {
      if (e.dead || e.kind !== 'gunner' || e.boss || dist(e, p) > 14) continue;
      e.kind = 'thug'; e.speed = 3.3; setStatus(e, 'stun', 0.8, '📱'); n++;
      floatText(e.x, 2.5, e.z, '¡SIN PISTOLA!', '#8fe0ff');
    }
    G.ammo = Math.min(G.maxAmmo + 12, G.ammo + 8); G.reloadT = 0;
    floatText(p.x, 2.6, p.z, `+8 🔫${n ? ` · ${n} desarmados` : ''}`, '#e0e08f');
  }
}
function updateAlly(dt, edt) {
  const A = G.ally; if (!A) return;
  A.t -= dt;
  const a = A.a;
  if (A.id === 'miguel' && A.t > 0.4) {
    const t = nearestEnemy(30, a);
    if (t) { const d = dist(a, t); if (d > 1.2) { a.x += (t.x - a.x) / d * 7 * dt; a.z += (t.z - a.z) / d * 7 * dt; } }
    a.yaw += dt * 18; a.g.rotation.y = a.yaw;
    if (a.onceT <= 0) play(a, 'atk2h_4', { ts: 2.2 });
    A.hitT -= dt;
    if (A.hitT <= 0) {
      A.hitT = 0.3;
      for (const e of G.enemies) if (!e.dead && dist(e, a) < 2.4) { const ang = Math.atan2(e.x - a.x, e.z - a.z); damageEnemy(e, e.boss ? 10 : 15, Math.sin(ang) * 6, Math.cos(ang) * 6, false); }
    }
    collide(a);
  } else if (A.t <= 0.4) {
    // se va andando
    a.x += Math.sin(a.yaw) * 5 * dt; a.z += Math.cos(a.yaw) * 5 * dt;
    if (a.onceT <= 0) play(a, 'run');
  } else if (a.onceT <= 0) play(a, 'idle2');
  if (A.t <= 0) { removeActor(a); a.over?.remove(); G.ally = null; }
}
function setStatus(e, kind, t, icon) {
  e.status = kind; e.statusT = t; e.wind = 0; if (e.laser) e.laser.visible = false;
  if (e.st === 'wind' || e.st === 'charge') e.st = 'chase';
  if (!e.over) { e.over = document.createElement('div'); e.over.className = 'sm-over'; ui().appendChild(e.over); }
  e.over.textContent = icon;
}

// ------------------------------------------------------------
// ESCENAS (cutscenes) con caras
// ------------------------------------------------------------
function runCutscene(lines, done) {
  screen = 'cutscene';
  root.classList.add('cine');
  const actors = {};
  let i = 0;
  const place = (who) => {
    if (who === 'narr' || who === 'sebas' || actors[who]) return actors[who] || (who === 'sebas' ? G.p : null);
    const n = Object.keys(actors).length;
    const a = makeActor(who, { team: 'npc', x: G.p.x + (n % 2 ? 2.4 : -2.4) * (1 + Math.floor(n / 2) * 0.6), z: G.p.z - 3.2 - Math.floor(n / 2) * 0.8, hp: 999 });
    faceTo(a, G.p.x, G.p.z);
    G.extras.push(a);
    actors[who] = a;
    return a;
  };
  for (const [who] of lines) place(who);   // todos en escena desde el principio
  const box = document.createElement('div');
  box.className = 'sm-dlg';
  box.innerHTML = `<canvas class="face" width="128" height="128"></canvas><div class="m"><div class="n"></div><div class="t"></div><div class="h">Toca para seguir ▸</div></div><button class="skip">Saltar ⏭</button>`;
  ui().appendChild(box);
  const finish = () => {
    box.remove(); root.classList.remove('cine');
    for (const a of Object.values(actors)) { removeActor(a); const k = G?.extras.indexOf(a); if (k >= 0) G.extras.splice(k, 1); }
    G && (G.cutTarget = null);
    screen = 'play';
    done?.();
  };
  let typing = null;
  const show = () => {
    if (i >= lines.length) { finish(); return; }
    const [who, text] = lines[i];
    const c = CAST[who] || {};
    const a = place(who);
    G.cutTarget = a && a !== G.p ? a : null;
    if (a && a !== G.p) { faceTo(G.p, a.x, a.z); faceTo(a, G.p.x, G.p.z); play(a, 'idle3'); }
    box.classList.toggle('narr', who === 'narr');
    box.querySelector('.n').innerHTML = who === 'narr' ? '' : `${esc(c.name)} <small>${esc(c.title || '')}</small>`;
    const face = box.querySelector('.face');
    face.style.display = who === 'narr' ? 'none' : '';
    if (a) setTimeout(() => drawFace(a, face), 30);
    const tEl = box.querySelector('.t');
    let k = 0; clearInterval(typing);
    typing = setInterval(() => { k += 2; tEl.textContent = text.slice(0, k); if (k >= text.length) { clearInterval(typing); typing = null; } }, 16);
    box.dataset.full = text;
  };
  box.addEventListener('pointerup', (e) => {
    e.stopPropagation();
    if (e.target.closest('.skip')) { clearInterval(typing); finish(); return; }
    if (typing) { clearInterval(typing); typing = null; box.querySelector('.t').textContent = box.dataset.full; return; }
    i++; sfx('click'); show();
  });
  show();
}

// cara del personaje (cabeza 3D, como los diálogos del juego)
let faceRT = null, faceCam = null, faceBuf = null;
function drawFace(a, cv) {
  if (!renderer || !a?.rig) return;
  let head = null; a.g.traverse(o => { if (!head && o.isBone && /head$/i.test(o.name)) head = o; });
  if (!head) return;
  const S = 128;
  if (!faceRT) { faceRT = new THREE.WebGLRenderTarget(S, S); faceRT.texture.colorSpace = THREE.SRGBColorSpace; faceCam = new THREE.PerspectiveCamera(30, 1, 0.05, 3); faceBuf = new Uint8Array(S * S * 4); }
  const hp = new THREE.Vector3(); head.getWorldPosition(hp); hp.y += 0.07 * a.scale;
  const f = new THREE.Vector3(Math.sin(a.g.rotation.y), 0, Math.cos(a.g.rotation.y));
  faceCam.position.copy(hp).addScaledVector(f, 0.95 * a.scale); faceCam.position.y += 0.03; faceCam.lookAt(hp);
  const bg = scene.background; scene.background = null;
  renderer.setClearColor(0x000000, 0);
  renderer.setRenderTarget(faceRT); renderer.clear(); renderer.render(scene, faceCam);
  renderer.readRenderTargetPixels(faceRT, 0, 0, S, S, faceBuf);
  renderer.setRenderTarget(null); scene.background = bg;
  const g = cv.getContext('2d'), img = g.createImageData(S, S), row = S * 4;
  for (let y = 0; y < S; y++) img.data.set(faceBuf.subarray((S - 1 - y) * row, (S - y) * row), y * row);
  g.putImageData(img, 0, 0);
}

// ------------------------------------------------------------
// FIN DE CAPÍTULO / MUERTE
// ------------------------------------------------------------
function winChapter() {
  if (!G || G.phase === 'won') return;
  G.phase = 'won';
  for (const b of G.projectiles) scene.remove(b.m); G.projectiles.length = 0;
  sfx('win');
  setTimeout(() => {
    if (!G) return;
    for (const e of G.enemies) { removeActor(e); e.over?.remove(); } G.enemies = []; G.boss = null;
    G.p.hp = G.p.maxHp;
    runCutscene(G.ch.outro, () => showResult());
  }, 900);
}
function rankFor() {
  const t = G.dmgTaken + G.deaths * 60;
  return t < 25 ? 'S' : t < 60 ? 'A' : t < 110 ? 'B' : 'C';
}
function showResult() {
  screen = 'result';
  const ch = G.ch, rank = rankFor();
  const prev = save.done[ch.id];
  const best = !prev || 'SABC'.indexOf(rank) < 'SABC'.indexOf(prev.rank) || G.score > prev.score;
  save.done[ch.id] = { rank: prev && 'SABC'.indexOf(prev.rank) < 'SABC'.indexOf(rank) ? prev.rank : rank, score: Math.max(G.score, prev?.score || 0) };
  const newAllies = [].concat(ch.unlock || []).filter(a => !save.allies.includes(a));
  save.allies.push(...newAllies);
  writeSave();
  const next = CHAPTERS[ch.n];
  ui().querySelector('.sm-hud')?.remove();
  ui().insertAdjacentHTML('beforeend', `<div class="sm-result">
    <div class="h">CAPÍTULO ${ch.n} COMPLETADO</div><div class="tt">${esc(ch.title)}</div>
    <div class="rank r${rank}">${rank}</div>
    <div class="stats"><div>Puntos <b>${G.score.toLocaleString('es-ES')}</b></div><div>Combo máx. <b>×${G.maxCombo}</b></div>
    <div>Daño recibido <b>${G.dmgTaken}</b></div><div>Tiempo <b>${fmtT(G.time)}</b></div></div>
    ${newAllies.length ? `<div class="new">⭐ Nuevo en la banda: ${newAllies.map(a => `${ALLIES[a].icon} ${esc(CAST[a].name)}`).join(' · ')}</div>` : ''}
    ${best && prev ? '<div class="new">🏆 ¡Nuevo récord!</div>' : ''}
    <div class="sm-btns"><button class="sm-btn" data-act="menu">Menú</button><button class="sm-btn" data-act="retry">Repetir</button>${next ? '<button class="sm-btn go" data-act="next">Siguiente ▶</button>' : ''}</div></div>`);
  ui().onclick = (e) => {
    const b = e.target.closest('[data-act]'); if (!b) return; sfx('click');
    if (b.dataset.act === 'menu') showMenu();
    else if (b.dataset.act === 'retry') pickAllyThen(ch.id);
    else if (b.dataset.act === 'next' && next) pickAllyThen(next.id);
  };
}
function showDead() {
  if (!G || screen !== 'play') return;
  screen = 'dead';
  ui().insertAdjacentHTML('beforeend', `<div class="sm-result dead"><div class="h">HAS CAÍDO</div>
    <div class="tt">${esc(['«Mañana a las 6 en punto me levanto», dijo Sebas.', 'Hasta John Wick pierde alguna.', 'El Choro ya está contando un chiste en tu funeral.'][Math.floor(Math.random() * 3)])}</div>
    <div class="sm-btns"><button class="sm-btn" data-act="menu">Menú</button><button class="sm-btn go" data-act="wave">Reintentar la oleada</button></div></div>`);
  ui().onclick = (e) => {
    const b = e.target.closest('[data-act]'); if (!b) return; sfx('click');
    if (b.dataset.act === 'menu') { showMenu(); return; }
    // revivir en la misma oleada
    ui().querySelector('.sm-result')?.remove();
    for (const en of G.enemies) { removeActor(en); en.over?.remove(); en.laser && scene.remove(en.laser); }
    G.enemies = []; G.boss = null; G.bossSummons = 0;
    for (const b2 of G.projectiles) scene.remove(b2.m); G.projectiles.length = 0;
    const p = G.p; p.dead = false; p.hp = p.maxHp; p.x = 0; p.z = 6; play(p, 'idle');
    G.ammo = G.maxAmmo; G.reloadT = 0; G.meter = 50;
    screen = 'play';
    if (G.phase === 'boss') { G.wave = G.ch.waves.length - 1; G.phase = 'waves'; }
    else G.wave = Math.max(-1, G.wave - 1);
    nextWave();
  };
}
const fmtT = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

// ------------------------------------------------------------
// HUD y controles
// ------------------------------------------------------------
const isTouch = () => matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
function buildHud() {
  ui().onclick = null;
  ui().innerHTML = `<div class="sm-hud">
    <div class="sm-top">
      <div class="hp"><div class="who">SEBAS</div><div class="bar"><i class="hpb"></i></div><div class="bar m"><i class="mb"></i></div></div>
      <div class="mid"><div class="obj"></div><div class="bossbar"><div class="bn"></div><div class="bar"><i></i></div></div></div>
      <div class="sc"><div class="score">0</div><div class="combo"></div></div>
      <button class="pause" data-act="pause" aria-label="Pausa">⏸</button>
    </div>
    <div class="sm-joy"><div class="base"></div><div class="knob"></div></div>
    <div class="sm-pad">
      <button class="b punch" data-b="punch">👊</button>
      <button class="b shoot" data-b="shoot">🔫<span class="ammo"></span></button>
      <button class="b dodge" data-b="dodge">🌀</button>
      <button class="b ally" data-b="ally">${G.allyId ? ALLIES[G.allyId].icon : '—'}<span class="cd"></span></button>
      <button class="b bt" data-b="bt">⏱</button>
    </div>
    <div class="sm-hurt"></div><div class="sm-banner"></div><div class="sm-toast"></div><div class="sm-floats"></div>
  </div>`;
  const pad = ui().querySelector('.sm-pad');
  pad.addEventListener('pointerdown', (e) => {
    const b = e.target.closest('[data-b]'); if (!b) return;
    e.preventDefault(); e.stopPropagation(); ctx()?.resume?.();
    b.classList.add('down'); setTimeout(() => b.classList.remove('down'), 120);
    ({ punch: doPunch, shoot: doShoot, dodge: doDodge, ally: doAlly, bt: doBulletTime })[b.dataset.b]?.();
  });
  ui().querySelector('[data-act="pause"]').addEventListener('pointerup', (e) => { e.stopPropagation(); togglePause(); });
  // joystick: toque en la mitad izquierda
  const hud = ui().querySelector('.sm-hud');
  const jEl = ui().querySelector('.sm-joy');
  hud.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.sm-pad, button, .sm-dlg')) return;
    if (e.pointerType === 'mouse') { ctx()?.resume?.(); if (e.button === 2) doShoot(); else doPunch(); return; }
    if (e.clientX > window.innerWidth * 0.55 || joy.id != null) return;
    joy = { id: e.pointerId, ox: e.clientX, oy: e.clientY, x: 0, y: 0 };
    jEl.style.left = `${e.clientX}px`; jEl.style.top = `${e.clientY}px`; jEl.classList.add('on');
    try { hud.setPointerCapture(e.pointerId); } catch {}
  });
  hud.addEventListener('pointermove', (e) => {
    if (e.pointerId !== joy.id) return;
    let dx = e.clientX - joy.ox, dy = e.clientY - joy.oy; const l = Math.hypot(dx, dy), R = 55;
    if (l > R) { dx = dx / l * R; dy = dy / l * R; }
    joy.x = dx / R; joy.y = dy / R;
    jEl.querySelector('.knob').style.transform = `translate(${dx}px, ${dy}px)`;
  });
  const end = (e) => { if (e.pointerId !== joy.id) return; joy = { id: null, ox: 0, oy: 0, x: 0, y: 0 }; jEl.classList.remove('on'); jEl.querySelector('.knob').style.transform = ''; };
  hud.addEventListener('pointerup', end); hud.addEventListener('pointercancel', end);
}
function togglePause() {
  if (screen === 'play') {
    screen = 'pause';
    ui().insertAdjacentHTML('beforeend', `<div class="sm-result pausebox"><div class="h">PAUSA</div><div class="sm-btns"><button class="sm-btn" data-act="quit">Salir al menú</button><button class="sm-btn go" data-act="cont">Continuar</button></div></div>`);
    ui().onclick = (e) => {
      const b = e.target.closest('[data-act]'); if (!b) return;
      if (b.dataset.act === 'quit') showMenu();
      else if (b.dataset.act === 'cont') { ui().querySelector('.pausebox')?.remove(); screen = 'play'; clock.getDelta(); ui().onclick = null; }
    };
  } else if (screen === 'pause') { ui().querySelector('.pausebox')?.remove(); screen = 'play'; ui().onclick = null; }
}
function updateHud() {
  const h = ui()?.querySelector('.sm-hud'); if (!h || !G) return;
  const p = G.p;
  h.querySelector('.hpb').style.width = `${Math.max(0, p.hp / p.maxHp * 100)}%`;
  h.querySelector('.hpb').classList.toggle('low', p.hp < 35);
  h.querySelector('.mb').style.width = `${G.meter}%`;
  h.querySelector('.mb').classList.toggle('full', G.meter >= 100);
  h.querySelector('.score').textContent = G.score.toLocaleString('es-ES');
  h.querySelector('.combo').textContent = G.combo >= 2 ? `×${G.combo} COMBO` : '';
  h.querySelector('.ammo').textContent = G.reloadT > 0 ? '…' : G.ammo;
  const cdEl = h.querySelector('.ally .cd');
  if (cdEl) cdEl.textContent = G.allyId ? (G.allyCd > 0 ? Math.ceil(G.allyCd) : '') : '';
  h.querySelector('.ally').classList.toggle('ready', !!G.allyId && G.allyCd <= 0 && !G.ally);
  h.querySelector('.bt').classList.toggle('ready', G.meter >= 100 && G.bt <= 0);
  h.querySelector('.obj').textContent = screen === 'cutscene' ? '' : G.phase === 'boss' ? '' : G.wave >= 0 && G.wave < G.ch.waves.length ? `Oleada ${G.wave + 1}/${G.ch.waves.length} · Enemigos: ${G.enemies.filter(e => !e.dead).length}` : '';
  const bosses = G.enemies.filter(e => e.boss && !e.dead);
  const bb = h.querySelector('.bossbar');
  if (bosses.length) {
    const b = bosses.find(x => x === G.boss) || bosses[0];
    bb.style.display = ''; bb.querySelector('.bn').textContent = bosses.map(x => x.name).join(' · ');
    bb.querySelector('i').style.width = `${Math.max(0, b.hp / b.maxHp * 100)}%`;
  } else bb.style.display = 'none';
  h.classList.toggle('hidden', screen === 'cutscene');
  // textos flotantes y bocadillos encima de las cabezas
  const v = new THREE.Vector3();
  for (const f of floats) {
    f.t -= 1 / 60;
    v.set(f.x, f.y + (1 - f.t / f.t0) * 1.2, f.z).project(camera);
    f.el.style.transform = `translate(${(v.x * 0.5 + 0.5) * window.innerWidth}px, ${(-v.y * 0.5 + 0.5) * window.innerHeight}px) translate(-50%, -50%)`;
    f.el.style.opacity = Math.min(1, f.t / f.t0 * 2);
  }
  for (let i = floats.length - 1; i >= 0; i--) if (floats[i].t <= 0) { floats[i].el.remove(); floats.splice(i, 1); }
  for (const a of [...G.enemies, G.ally?.a, ...G.extras].filter(Boolean)) {
    for (const el of [a.over, a.bubble]) {
      if (!el) continue;
      v.set(a.x, (el === a.bubble ? 2.6 : 2.4) * a.scale, a.z).project(camera);
      el.style.transform = `translate(${(v.x * 0.5 + 0.5) * window.innerWidth}px, ${(-v.y * 0.5 + 0.5) * window.innerHeight}px) translate(-50%, -100%)`;
    }
    if (a.bubble && performance.now() > a.bubbleUntil) { a.bubble.remove(); a.bubble = null; }
  }
}
const floats = [];
function floatText(x, y, z, text, color, big = false) {
  const fl = ui()?.querySelector('.sm-floats'); if (!fl) return;
  if (floats.length > 24) { floats[0].el.remove(); floats.shift(); }
  const el = document.createElement('div'); el.className = 'sm-float' + (big ? ' big' : ''); el.textContent = text; el.style.color = color;
  fl.appendChild(el);
  floats.push({ el, x, y, z, t: 0.8, t0: 0.8 });
}
function say(a, text, ms = 2500) {
  if (!a) return;
  a.bubble?.remove();
  a.bubble = document.createElement('div'); a.bubble.className = 'sm-say'; a.bubble.textContent = text;
  ui().appendChild(a.bubble); a.bubbleUntil = performance.now() + ms;
}
function banner(title, sub, boss = false, ms = 2000) {
  const b = ui()?.querySelector('.sm-banner'); if (!b) return;
  b.innerHTML = `<div class="a">${esc(title)}</div>${sub ? `<div class="b">${esc(sub)}</div>` : ''}`;
  b.className = 'sm-banner on' + (boss ? ' boss' : '');
  clearTimeout(b._t); b._t = setTimeout(() => b.classList.remove('on'), ms);
}
function stylish(text) {
  const b = ui()?.querySelector('.sm-floats'); if (!b) return;
  const el = document.createElement('div'); el.className = 'sm-style'; el.textContent = text; b.appendChild(el);
  setTimeout(() => el.remove(), 900);
}
function toast(text, ms = 2000) {
  const t = ui()?.querySelector('.sm-toast'); if (!t) return;
  t.textContent = text; t.classList.add('on'); clearTimeout(t._t); t._t = setTimeout(() => t.classList.remove('on'), ms);
}

function onKey(e) {
  if (screen === 'off') return;
  e.stopPropagation();
  if (e.code === 'Escape') { if (screen === 'play' || screen === 'pause') togglePause(); else if (screen === 'menu') close(); e.preventDefault(); return; }
  if (screen !== 'play') return;
  if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
  if (e.repeat) { keys.add(e.code); return; }
  keys.add(e.code);
  ctx()?.resume?.();
  if (e.code === 'KeyJ') doPunch();
  else if (e.code === 'KeyK') doShoot();
  else if (e.code === 'Space' || e.code === 'ShiftLeft') doDodge();
  else if (e.code === 'KeyE') doAlly();
  else if (e.code === 'KeyQ') doBulletTime();
}
function onKeyUp(e) { keys.delete(e.code); if (screen !== 'off') e.stopPropagation(); }

// ------------------------------------------------------------
// CSS
// ------------------------------------------------------------
function ensureCss() {
  if (document.getElementById('sebas-css')) return;
  const s = document.createElement('style'); s.id = 'sebas-css';
  s.textContent = `
  #sebasMode { position: fixed; inset: 0; z-index: 400; background: #000; font-family: 'Cinzel', Georgia, serif; color: #fff; user-select: none; -webkit-user-select: none; touch-action: none; overflow: hidden; }
  #sebasMode .sm-canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; transition: filter .3s; }
  #sebasMode .sm-canvas.bt { filter: saturate(0.35) contrast(1.25) brightness(0.95) hue-rotate(-12deg); }
  #sebasMode .sm-ui { position: absolute; inset: 0; }
  #sebasMode.cine::before, #sebasMode.cine::after { content: ''; position: absolute; left: 0; right: 0; height: 9vh; background: #000; z-index: 5; }
  #sebasMode.cine::before { top: 0; } #sebasMode.cine::after { bottom: 0; }
  #sebasMode button { font-family: inherit; cursor: pointer; -webkit-tap-highlight-color: transparent; }
  /* Menú */
  .sm-menu { position: absolute; inset: 0; overflow-y: auto; padding: calc(env(safe-area-inset-top,0px) + 18px) 16px 24px; box-sizing: border-box;
    background: radial-gradient(ellipse at 50% 0%, #3a0a14 0%, #0a0406 60%), #0a0406; }
  .sm-logo { text-align: center; margin: 10px 0 6px; }
  .sm-logo .a { font-size: clamp(34px, 9vw, 62px); font-weight: 900; letter-spacing: .08em; color: #f4f0e8; text-shadow: 0 0 22px #d0102a, 0 3px 0 #5a0a14; }
  .sm-logo .b { font-size: clamp(16px, 4vw, 24px); color: #e8c560; letter-spacing: .4em; text-transform: uppercase; margin-top: 2px; }
  .sm-tag { text-align: center; font-style: italic; color: #d8c8b0; font-size: 14px; margin: 6px auto 16px; max-width: 520px; font-family: Georgia, serif; }
  .sm-chapters { display: flex; flex-direction: column; gap: 8px; max-width: 560px; margin: 0 auto; }
  .sm-ch { display: flex; align-items: center; gap: 12px; padding: 10px 12px; border-radius: 8px; border: 1px solid #6a2030; background: linear-gradient(90deg, #2a0a10, #160608); color: #fff; text-align: left; }
  .sm-ch .n { font-size: 26px; font-weight: 900; color: #e8c560; width: 30px; text-align: center; }
  .sm-ch .t { flex: 1; display: flex; flex-direction: column; } .sm-ch .t b { font-size: 16px; } .sm-ch .t span { font-size: 12px; color: #c8b8a0; font-family: Georgia, serif; }
  .sm-ch .r { font-size: 18px; color: #e8c560; }
  .sm-ch.locked { opacity: .45; } .sm-ch:not(.locked):active { transform: scale(.98); }
  .rank { display: inline-block; font-weight: 900; font-size: 20px; padding: 0 6px; border-radius: 4px; }
  .rank.rS, .sm-result .rank.rS { color: #ffd040; text-shadow: 0 0 12px #ffb000; } .rank.rA { color: #8fe0ff; } .rank.rB { color: #8fe08f; } .rank.rC { color: #c8c8c8; }
  .sm-h { text-align: center; color: #e8c560; letter-spacing: .2em; text-transform: uppercase; margin: 22px 0 8px; font-size: 14px; } .sm-h.big { font-size: 20px; letter-spacing: .05em; text-transform: none; margin-top: 40px; }
  .sm-crewrow { display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; max-width: 620px; margin: 0 auto; }
  .sm-crew { width: 104px; padding: 8px 6px; border-radius: 8px; background: #1a0a0e; border: 1px solid #5a2030; text-align: center; color: #fff; }
  .sm-crew .i { font-size: 26px; } .sm-crew .n { font-size: 12px; font-weight: 700; } .sm-crew .s { font-size: 10px; color: #e8c560; font-family: Georgia, serif; }
  .sm-crew .d { font-size: 10px; color: #c8b8a0; font-family: Georgia, serif; margin-top: 4px; }
  .sm-crew.off { opacity: .4; } .sm-crew.sel { border-color: #ffd040; box-shadow: 0 0 14px rgba(255,200,40,.45); background: #2a1a0a; }
  .sm-crewrow.pick .sm-crew { width: 150px; }
  .sm-help { text-align: center; font-size: 11px; color: #8a7a68; margin-top: 18px; font-family: Georgia, serif; }
  .sm-x { position: absolute; top: calc(env(safe-area-inset-top,0px) + 10px); right: 12px; width: 38px; height: 38px; border-radius: 50%; border: 1px solid #8a3040; background: #2a0a10; color: #fff; font-size: 16px; }
  .sm-btns { display: flex; gap: 10px; justify-content: center; margin-top: 18px; flex-wrap: wrap; }
  .sm-btn { padding: 11px 20px; border-radius: 8px; border: 1px solid #8a6a40; background: #2a1a0a; color: #f4e8c8; font-size: 15px; font-weight: 700; }
  .sm-btn.go { background: linear-gradient(#b0102a, #6a0a18); border-color: #ff6070; color: #fff; }
  .sm-loading { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; background: #0a0406; }
  .sm-loading .t { color: #e8c560; letter-spacing: .3em; } .sm-loading .b { font-size: clamp(28px, 7vw, 46px); font-weight: 900; margin: 6px 0; text-shadow: 0 0 18px #d0102a; }
  .sm-loading .c { font-family: Georgia, serif; font-style: italic; color: #c8b8a0; } .sm-loading .bar { width: 220px; height: 6px; background: #2a1014; border-radius: 3px; margin-top: 18px; overflow: hidden; } .sm-loading .bar i { display: block; height: 100%; width: 0; background: #e8c560; transition: width .2s; }
  /* HUD */
  .sm-hud.hidden .sm-top, .sm-hud.hidden .sm-pad { opacity: 0; pointer-events: none; }
  .sm-top { position: absolute; top: calc(env(safe-area-inset-top,0px) + 8px); left: 8px; right: 8px; display: flex; align-items: flex-start; gap: 8px; pointer-events: none; }
  .sm-top .hp { width: min(40vw, 220px); } .sm-top .who { font-size: 12px; font-weight: 900; letter-spacing: .15em; text-shadow: 0 2px 2px #000; }
  .sm-top .bar { height: 12px; background: rgba(0,0,0,.6); border: 1px solid #5a2a2a; border-radius: 3px; overflow: hidden; margin-top: 3px; } .sm-top .bar.m { height: 6px; border-color: #5a4a1a; }
  .sm-top .hpb { display: block; height: 100%; background: linear-gradient(#e83a3a, #a01a1a); transition: width .15s; } .sm-top .hpb.low { animation: smLow .5s infinite alternate; }
  @keyframes smLow { to { filter: brightness(1.8); } }
  .sm-top .mb { display: block; height: 100%; background: linear-gradient(#ffe060, #c89a20); } .sm-top .mb.full { animation: smLow .35s infinite alternate; }
  .sm-top .mid { flex: 1; text-align: center; } .sm-top .obj { font-size: 12px; text-shadow: 0 2px 2px #000; color: #f4e8c8; }
  .sm-top .bossbar { margin: 2px auto 0; width: min(60vw, 380px); } .sm-top .bossbar .bn { font-size: 13px; font-weight: 900; color: #ffb0b0; text-shadow: 0 2px 2px #000; }
  .sm-top .bossbar .bar { height: 10px; } .sm-top .bossbar i { display: block; height: 100%; background: linear-gradient(#ff7a2a, #b02a0a); }
  .sm-top .sc { text-align: right; min-width: 70px; } .sm-top .score { font-size: 18px; font-weight: 900; text-shadow: 0 2px 2px #000; } .sm-top .combo { font-size: 13px; color: #ffd040; font-weight: 900; text-shadow: 0 0 8px #ff8000; }
  .sm-top .pause { pointer-events: auto; width: 36px; height: 36px; border-radius: 50%; border: 1px solid #fff4; background: rgba(0,0,0,.45); color: #fff; font-size: 14px; }
  .sm-joy { position: absolute; width: 0; height: 0; display: none; } .sm-joy.on { display: block; }
  .sm-joy .base { position: absolute; left: -55px; top: -55px; width: 110px; height: 110px; border-radius: 50%; border: 2px solid rgba(255,255,255,.35); background: rgba(0,0,0,.2); }
  .sm-joy .knob { position: absolute; left: -24px; top: -24px; width: 48px; height: 48px; border-radius: 50%; background: rgba(255,255,255,.55); }
  .sm-pad { position: absolute; right: calc(env(safe-area-inset-right,0px) + 10px); bottom: calc(env(safe-area-inset-bottom,0px) + 14px); width: 210px; height: 200px; }
  .sm-pad .b { position: absolute; border-radius: 50%; border: 2px solid rgba(255,255,255,.4); background: rgba(20,8,10,.55); color: #fff; font-size: 24px; display: flex; align-items: center; justify-content: center; touch-action: none; }
  .sm-pad .b.down { transform: scale(.9); background: rgba(200,40,60,.6); }
  .sm-pad .punch { right: 0; bottom: 0; width: 86px; height: 86px; font-size: 36px; border-color: #ff8090; }
  .sm-pad .shoot { right: 96px; bottom: 8px; width: 66px; height: 66px; } .sm-pad .shoot .ammo { position: absolute; bottom: 4px; right: 8px; font-size: 11px; font-family: sans-serif; font-weight: 700; }
  .sm-pad .dodge { right: 8px; bottom: 96px; width: 62px; height: 62px; }
  .sm-pad .ally { right: 84px; bottom: 84px; width: 58px; height: 58px; opacity: .55; } .sm-pad .ally.ready { opacity: 1; border-color: #ffd040; box-shadow: 0 0 14px rgba(255,200,40,.6); }
  .sm-pad .ally .cd { position: absolute; font-size: 14px; font-family: sans-serif; font-weight: 900; text-shadow: 0 0 4px #000; }
  .sm-pad .bt { right: 150px; bottom: 90px; width: 54px; height: 54px; opacity: .35; } .sm-pad .bt.ready { opacity: 1; border-color: #ffe060; animation: smLow .4s infinite alternate; }
  .sm-hurt { position: absolute; inset: 0; pointer-events: none; box-shadow: inset 0 0 90px rgba(255,0,0,.0); }
  .sm-hurt.on { animation: smHurt .35s ease-out; } @keyframes smHurt { from { box-shadow: inset 0 0 120px rgba(255,0,0,.75); } to { box-shadow: inset 0 0 90px rgba(255,0,0,0); } }
  .sm-banner { position: absolute; top: 22%; left: 0; right: 0; text-align: center; pointer-events: none; opacity: 0; transform: scale(1.3); transition: opacity .25s, transform .25s; }
  .sm-banner.on { opacity: 1; transform: scale(1); } .sm-banner .a { font-size: clamp(26px, 7vw, 48px); font-weight: 900; letter-spacing: .06em; text-shadow: 0 0 16px #d0102a, 0 3px 0 #000; }
  .sm-banner.boss .a { color: #ffd0d0; } .sm-banner .b { font-family: Georgia, serif; font-style: italic; color: #e8c560; text-shadow: 0 2px 2px #000; }
  .sm-toast { position: absolute; bottom: 32%; left: 50%; transform: translateX(-50%); padding: 8px 14px; border-radius: 8px; background: rgba(0,0,0,.7); border: 1px solid #e8c56088; font-size: 14px; opacity: 0; transition: opacity .25s; pointer-events: none; white-space: nowrap; font-family: Georgia, serif; }
  .sm-toast.on { opacity: 1; }
  .sm-floats { position: absolute; inset: 0; pointer-events: none; overflow: hidden; }
  .sm-float { position: absolute; left: 0; top: 0; font-family: Impact, 'Arial Black', sans-serif; font-size: 20px; text-shadow: 0 2px 0 #000, 0 0 6px #000; white-space: nowrap; } .sm-float.big { font-size: 30px; }
  .sm-style { position: absolute; top: 34%; left: 50%; transform: translate(-50%,-50%) rotate(-6deg); font-family: Impact, 'Arial Black', sans-serif; font-size: clamp(30px, 9vw, 64px); color: #ffd040; text-shadow: 0 0 18px #ff6000, 0 4px 0 #000; animation: smStyle .9s ease-out forwards; }
  @keyframes smStyle { 0% { transform: translate(-50%,-50%) rotate(-6deg) scale(2); opacity: 0; } 15% { transform: translate(-50%,-50%) rotate(-6deg) scale(1); opacity: 1; } 100% { transform: translate(-50%,-80%) rotate(-6deg) scale(1); opacity: 0; } }
  .sm-over { position: absolute; left: 0; top: 0; font-size: 22px; pointer-events: none; }
  .sm-say { position: absolute; left: 0; top: 0; max-width: 220px; padding: 6px 10px; border-radius: 10px; background: #fff; color: #1a1a1a; font: 700 13px/1.25 Georgia, serif; pointer-events: none; box-shadow: 0 3px 8px rgba(0,0,0,.5); }
  /* Diálogo de las escenas */
  .sm-dlg { position: absolute; left: 50%; bottom: calc(9vh + 8px); transform: translateX(-50%); width: min(640px, calc(100vw - 20px)); z-index: 6; display: flex; gap: 12px; align-items: center;
    padding: 12px 14px; box-sizing: border-box; background: rgba(12,4,6,.92); border: 2px solid #8a2a3a; border-radius: 8px; }
  .sm-dlg .face { width: 88px; height: 88px; border-radius: 6px; background: radial-gradient(circle at 50% 40%, #5a2a2a, #1a0608); flex: 0 0 88px; }
  .sm-dlg .m { flex: 1; min-width: 0; } .sm-dlg .n { font-weight: 900; color: #ff9aa8; font-size: 16px; } .sm-dlg .n small { font-family: Georgia, serif; font-weight: 400; color: #c8b8a0; font-size: 12px; margin-left: 6px; }
  .sm-dlg .t { font-family: Georgia, serif; font-size: 16px; line-height: 1.35; min-height: 44px; margin-top: 2px; } .sm-dlg.narr .t { font-style: italic; color: #e8d8b8; text-align: center; }
  .sm-dlg .h { font-size: 11px; color: #e8c560; text-align: right; } .sm-dlg .skip { position: absolute; top: -34px; right: 0; padding: 5px 10px; border-radius: 6px; border: 1px solid #fff4; background: rgba(0,0,0,.6); color: #fff; font-size: 12px; }
  /* Resultado */
  .sm-result { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; background: rgba(8,2,4,.82); z-index: 8; padding: 20px; text-align: center; }
  .sm-result .h { font-size: clamp(22px, 6vw, 36px); font-weight: 900; letter-spacing: .08em; text-shadow: 0 0 14px #d0102a; } .sm-result .tt { font-family: Georgia, serif; font-style: italic; color: #e8c560; margin: 4px 0 10px; }
  .sm-result .rank { font-size: 96px; font-family: Impact, 'Arial Black', sans-serif; line-height: 1; margin: 6px 0; }
  .sm-result .stats { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 22px; font-family: Georgia, serif; font-size: 15px; } .sm-result .stats b { color: #ffd040; margin-left: 6px; }
  .sm-result .new { margin-top: 12px; color: #ffd040; font-weight: 700; }
  .sm-result.dead .h { color: #ff6a6a; }
  `;
  document.head.appendChild(s);
}

if (typeof window !== 'undefined') window.__sebasMode = { open, close, debug: () => ({ screen, G }), killAll: () => { if (G) for (const e of [...G.enemies]) if (!e.dead) damageEnemy(e, 99999, 0, 0, true); }, input: { punch: () => doPunch(), shoot: () => doShoot(), dodge: () => doDodge(), ally: () => doAlly(), bt: () => doBulletTime() } };
