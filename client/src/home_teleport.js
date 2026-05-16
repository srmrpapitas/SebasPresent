/**
 * SebasPresent — Home Teleport module (Sesión 10)
 *
 * Vive dentro del panel Magic 🔮 del sidebar OSRS como un "spell" estilo
 * spellbook OSRS. Mantiene toda la lógica de cast/cooldown intacta — solo
 * cambia DÓNDE se monta el DOM (antes flotante esquina sup izq, ahora
 * dentro de #magicSpellGrid del sidebar).
 *
 * Cambios respecto a versión anterior:
 *   - El botón ya no es position:fixed en esquina.
 *   - Se inserta dentro del contenedor #magicSpellGrid (sidebar → tab Magic).
 *   - El CSS vive 100% en style.css. ensureCss() es no-op (placeholder
 *     siguiendo el patrón de sesión 9).
 *   - Si #magicSpellGrid no existe, el módulo lo reporta por consola pero
 *     no crashea; start() sale temprano y queda inerte.
 *
 * Lógica server-side intacta — handlers /api/magic/home_teleport[/cancel,/finish]
 * sin tocar.
 *
 * Cómo se usa desde world.js (sin cambios respecto a antes):
 *
 *   import * as homeTele from './home_teleport.js';
 *
 *   homeTele.start({
 *     getPlayer:    () => player,
 *     getAuthToken: () => authToken,
 *     apiBase:      API_BASE,
 *     getCombatHp:  () => combat.getStateSnapshot?.()?.hp ?? null,
 *     feedLog:      (type, msg) => combat.feedLog?.(type, msg),
 *     onTeleported: () => primeInitialChunks(),
 *   });
 *
 *   // Al salir del mundo:
 *   homeTele.stop();
 */

// ============================================================
// Constantes
// ============================================================
const CAST_MS = 10_000;
const COOLDOWN_MS = 15 * 60 * 1000;
const TICK_MS = 100;
const MOVE_CANCEL_DIST = 0.5;

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
  if (!createButton()) {
    // Contenedor del magic grid no existe — no arrancamos el interval ni nada.
    started = false;
    return;
  }
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
// DOM
// ============================================================
function createButton() {
  const grid = document.getElementById('magicSpellGrid');
  if (!grid) {
    console.warn(
      '[home_teleport] #magicSpellGrid no existe en el DOM. ' +
      'Asegúrate de que index.html tiene el contenedor del spellbook ' +
      'dentro de <section data-tab="magic">.'
    );
    return false;
  }
  // Limpia residual de una sesión anterior si el módulo no terminó de stop().
  const stale = document.getElementById('magicSpellHomeTele');
  if (stale) stale.remove();

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.id = 'magicSpellHomeTele';
  btn.className = 'magic-spell';
  btn.title = 'Home Teleport — vuelve al hub (10s cast, 15min cooldown)';
  btn.innerHTML = `
    <div class="magic-spell-icon">🏠</div>
    <div class="magic-spell-name">Home</div>
    <div class="magic-spell-cd"></div>
    <div class="magic-spell-progress"><div class="magic-spell-bar"></div></div>
  `;
  grid.appendChild(btn);
  btnEl = btn;
  barEl = btn.querySelector('.magic-spell-bar');
  cdLabelEl = btn.querySelector('.magic-spell-cd');
  btn.addEventListener('click', onClick);
  return true;
}

// Sesión 9 + 10 — CSS vive en style.css. Esta función queda como
// no-op placeholder para no tocar call sites. Si en el futuro hace
// falta CSS dinámico (por ejemplo iconos generados runtime), aquí.
function ensureCss() { /* no-op */ }

// ============================================================
// Lógica del cast (sin cambios funcionales)
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
