/**
 * SebasPresent — Home Teleport module (Sesión 4 refactor)
 *
 * Slice 5c — Teletransporte a casa.
 *
 * Botón discreto en esquina superior izquierda (debajo del botón Salir).
 * Click → cast de 10s con barra de progreso. Cancela si:
 *   - El player se mueve durante el cast
 *   - El player recibe daño durante el cast
 * Tras 10s sin interrupción → POST /api/magic/home_teleport/finish y TP.
 * Cooldown de 15 min tras teleport. El botón muestra "M:SS" mientras está
 * en cooldown.
 *
 * Cómo se usa desde world.js:
 *
 *   import * as homeTele from './home_teleport.js';
 *
 *   homeTele.start({
 *     getPlayer:    () => player,                    // ref al group del player
 *     getAuthToken: () => authToken,
 *     apiBase:      API_BASE,
 *     getCombatHp:  () => combat.getStateSnapshot?.()?.hp ?? null,
 *     feedLog:      (type, msg) => combat.feedLog?.(type, msg),
 *     onTeleported: () => primeInitialChunks(),      // refresh chunks tras TP
 *   });
 *
 *   // Al salir del mundo:
 *   homeTele.stop();
 *
 * Diferencia importante vs el código original: stop() ahora limpia
 * correctamente botón + interval + estado. Antes el setInterval seguía
 * corriendo tras logout y el botón se quedaba apilado al re-entrar.
 */

// ============================================================
// Constantes
// ============================================================
const CAST_MS = 10_000;            // duración del cast
const COOLDOWN_MS = 15 * 60 * 1000; // cooldown tras teleport
const TICK_MS = 100;               // frecuencia del interval visual
const MOVE_CANCEL_DIST = 0.5;      // si te mueves más de esto, cancela

// ============================================================
// Estado del módulo (privado)
// ============================================================
let getPlayer = null;
let getAuthToken = null;
let apiBase = null;
let getCombatHp = null;
let feedLog = null;
let onTeleported = null;

let btnEl = null;
let barEl = null;
let cdLabelEl = null;
let intervalHandle = null;

let castingUntil = 0;
let cooldownUntil = 0;
let playerStartPos = null;
let playerStartHp = null;

let started = false;

// ============================================================
// API pública
// ============================================================

export function start(opts) {
  if (started) {
    console.warn('[home_teleport] start() llamado dos veces sin stop()');
    stop();
  }
  getPlayer    = opts.getPlayer;
  getAuthToken = opts.getAuthToken;
  apiBase      = opts.apiBase;
  getCombatHp  = opts.getCombatHp  || (() => null);
  feedLog      = opts.feedLog      || (() => {});
  onTeleported = opts.onTeleported || (() => {});

  ensureCss();
  createButton();
  intervalHandle = setInterval(updateVisuals, TICK_MS);
  started = true;
}

export function stop() {
  if (!started) return;
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
  if (btnEl) {
    btnEl.remove();
    btnEl = null;
  }
  barEl = null;
  cdLabelEl = null;
  castingUntil = 0;
  cooldownUntil = 0;
  playerStartPos = null;
  playerStartHp = null;
  getPlayer = getAuthToken = apiBase = getCombatHp = feedLog = onTeleported = null;
  started = false;
}

// ============================================================
// DOM + CSS
// ============================================================
function createButton() {
  const btn = document.createElement('div');
  btn.className = 'osrs-home-tele-btn';
  btn.innerHTML = `
    <div class="osrs-home-tele-icon">🏠</div>
    <div class="osrs-home-tele-label">Casa</div>
    <div class="osrs-home-tele-progress"><div class="osrs-home-tele-bar"></div></div>
    <div class="osrs-home-tele-cd"></div>
  `;
  document.body.appendChild(btn);
  btnEl = btn;
  barEl = btn.querySelector('.osrs-home-tele-bar');
  cdLabelEl = btn.querySelector('.osrs-home-tele-cd');
  btn.addEventListener('click', onClick);
}

function ensureCss() {
  if (document.getElementById('osrs-home-tele-css')) return;
  const style = document.createElement('style');
  style.id = 'osrs-home-tele-css';
  style.textContent = `
    .osrs-home-tele-btn {
      position: fixed;
      top: 84px;
      left: 16px;
      z-index: 80;
      width: 64px;
      min-height: 78px;
      padding: 6px 4px;
      background: rgba(20, 14, 8, 0.92);
      border: 2px solid #c8a043;
      border-radius: 6px;
      box-shadow: 0 4px 10px rgba(0,0,0,0.5);
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      user-select: none;
      -webkit-user-select: none;
      font-family: 'Cinzel', serif;
    }
    .osrs-home-tele-btn:active {
      background: rgba(40, 28, 16, 0.95);
    }
    .osrs-home-tele-btn.casting {
      border-color: #88ddff;
    }
    .osrs-home-tele-btn.cooldown {
      opacity: 0.55;
      pointer-events: none;
      border-color: #666;
    }
    .osrs-home-tele-icon {
      font-size: 24px;
      line-height: 1;
      margin-bottom: 2px;
    }
    .osrs-home-tele-label {
      font-size: 10px;
      color: #f0e0b0;
      font-weight: 700;
      text-shadow: 1px 1px 0 #000;
      letter-spacing: 0.4px;
    }
    .osrs-home-tele-progress {
      width: 100%;
      height: 4px;
      margin-top: 4px;
      background: rgba(0,0,0,0.6);
      border-radius: 2px;
      overflow: hidden;
      display: none;
    }
    .osrs-home-tele-btn.casting .osrs-home-tele-progress {
      display: block;
    }
    .osrs-home-tele-bar {
      width: 0%;
      height: 100%;
      background: linear-gradient(90deg, #88ddff, #c8a043);
      transition: width 0.1s linear;
    }
    .osrs-home-tele-cd {
      font-size: 9px;
      color: #ff9090;
      margin-top: 2px;
      font-family: 'IM Fell English', serif;
      display: none;
    }
    .osrs-home-tele-btn.cooldown .osrs-home-tele-cd {
      display: block;
    }
  `;
  document.head.appendChild(style);
}

// ============================================================
// Lógica del cast
// ============================================================
async function onClick() {
  if (castingUntil > Date.now()) return;     // ya casteando
  if (cooldownUntil > Date.now()) return;    // en cooldown
  const token = getAuthToken();
  if (!token) return;

  try {
    const r = await fetch(`${apiBase}/api/magic/home_teleport`, {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + token },
    });
    const data = await r.json();
    if (!r.ok || data.error) {
      if (data.error === 'on_cooldown' && data.cooldown_remaining_ms) {
        cooldownUntil = Date.now() + data.cooldown_remaining_ms;
        feedLog('warn', data.message || 'En cooldown');
      } else {
        feedLog('warn', 'No puedes teletransportarte ahora');
      }
      return;
    }
    // Cast iniciado
    castingUntil = Date.now() + CAST_MS;
    const player = getPlayer();
    if (player) {
      playerStartPos = { x: player.position.x, z: player.position.z };
    }
    playerStartHp = getCombatHp();
    btnEl?.classList.add('casting');
    feedLog('info', 'Concentrándote para teletransportarte... (10s)');
  } catch (err) {
    console.warn('home tele start failed:', err);
  }
}

function cancel(reason) {
  if (castingUntil <= Date.now()) return;
  castingUntil = 0;
  btnEl?.classList.remove('casting');
  const token = getAuthToken();
  if (token) {
    fetch(`${apiBase}/api/magic/home_teleport/cancel`, {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + token },
    }).catch(() => {});
  }
  feedLog('warn', `Teletransporte cancelado (${reason}).`);
}

async function finish() {
  const token = getAuthToken();
  if (!token) return;
  try {
    const r = await fetch(`${apiBase}/api/magic/home_teleport/finish`, {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + token },
    });
    const data = await r.json();
    if (!r.ok || data.error) {
      feedLog('warn', 'No se pudo completar el teletransporte');
      btnEl?.classList.remove('casting');
      castingUntil = 0;
      return;
    }
    // Teletransportar visualmente
    const player = getPlayer();
    if (player) {
      player.position.x = data.spawn.x;
      player.position.z = data.spawn.z;
    }
    if (typeof window !== 'undefined') window.scrollTo(0, 0);
    castingUntil = 0;
    cooldownUntil = data.cooldown_until || (Date.now() + COOLDOWN_MS);
    btnEl?.classList.remove('casting');
    btnEl?.classList.add('cooldown');
    feedLog('hit', '¡Estás en casa!');
    // Resetear chunks alrededor del nuevo spawn
    try { onTeleported(); } catch {}
  } catch (err) {
    console.warn('home tele finish failed:', err);
    btnEl?.classList.remove('casting');
    castingUntil = 0;
  }
}

// ============================================================
// Tick visual (interval cada 100ms)
// ============================================================
function updateVisuals() {
  if (!btnEl) return;
  const now = Date.now();

  // Casteando
  if (castingUntil > 0) {
    const remaining = castingUntil - now;
    if (remaining <= 0) {
      finish();
    } else {
      // Actualizar barra de progreso
      const elapsed = CAST_MS - remaining;
      const pct = Math.max(0, Math.min(100, (elapsed / CAST_MS) * 100));
      if (barEl) barEl.style.width = pct + '%';
      // Cancelación por movimiento
      const player = getPlayer();
      if (playerStartPos && player) {
        const dx = player.position.x - playerStartPos.x;
        const dz = player.position.z - playerStartPos.z;
        if (dx * dx + dz * dz > MOVE_CANCEL_DIST * MOVE_CANCEL_DIST) {
          cancel('te has movido');
        }
      }
      // Cancelación por daño recibido
      if (playerStartHp !== null) {
        const hp = getCombatHp();
        if (hp !== null && hp < playerStartHp) {
          cancel('recibiste daño');
        }
      }
    }
  }

  // Cooldown
  if (cooldownUntil > now) {
    btnEl.classList.add('cooldown');
    const remaining = Math.ceil((cooldownUntil - now) / 1000);
    const m = Math.floor(remaining / 60);
    const s = remaining % 60;
    if (cdLabelEl) {
      cdLabelEl.textContent = `${m}:${String(s).padStart(2, '0')}`;
    }
  } else if (cooldownUntil > 0) {
    cooldownUntil = 0;
    btnEl.classList.remove('cooldown');
    if (cdLabelEl) cdLabelEl.textContent = '';
  }
}
