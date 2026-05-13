/**
 * SebasPresent — Combat module (Slice 5a)
 *
 * Maneja:
 *   - Tab ⚔️ del sidebar: stats (atk/str/def/hp) con XP bars, HP/HPmax,
 *     lista de NPCs vivos con boton "Atacar", boton "Respawn" si muerto.
 *   - HUD top-right: actualiza hudHpValue cuando cambia el HP del user.
 *   - Auto-attack loop: cuando engageNpc(id) esta activo, llama
 *     attackNpc cada TICK_MS hasta que matas, mueres, o disengage().
 *   - Hit splats flotantes: contenedor en worldScreen, animacion CSS.
 *
 * API publica para integracion con three.js (en otra iteracion):
 *   - combat.engageNpc(id)
 *   - combat.disengage()
 *   - combat.getStateSnapshot()  -> { stats, npcs, currentTarget }
 *   - combat.onUpdate(cb)         -> cb({ stats, npcs })
 *   - combat.refresh()
 *
 * En slice 5a hoy: el combate se hace via el tab. Cuando integremos
 * con el world 3D, el tap-NPC llamara engageNpc(id) y el render del
 * mundo escuchara onUpdate para actualizar HP bars sobre cada NPC.
 */

import * as api from './api.js';

// ============================================================
// CONFIG
// ============================================================

const TICK_MS = 600;          // mismo que server. NO bajar, server enforce.
const POLL_INTERVAL_MS = 3000; // refresh del state cuando tab abierto pero no en combate
const HIT_SPLAT_DURATION_MS = 900;

// ============================================================
// ESTADO MODULO
// ============================================================

let isInitialized = false;
let isTabOpen = false;
let state = null;             // { stats, position, npcs }
let currentTarget = null;     // npc_id actualmente en combate
let attackTimer = null;
let pollTimer = null;
let listeners = [];           // callbacks de onUpdate
let splatContainer = null;
let panelEl = null;

// ============================================================
// LIFECYCLE
// ============================================================

export function init() {
  if (isInitialized) return;
  // Crear contenedor de hit splats sobre el worldScreen
  ensureSplatContainer();
  isInitialized = true;
}

export async function onOpen() {
  isTabOpen = true;
  panelEl = document.querySelector('.osrs-tab-pane[data-tab="combat"]');
  if (!panelEl) return;
  panelEl.innerHTML = '<div class="combat-loading">Cargando combate…</div>';
  await refresh();
  startPolling();
}

export function onClose() {
  isTabOpen = false;
  stopPolling();
  // Nota: disengage NO se hace al cerrar tab — el user puede querer
  // seguir atacando desde el mundo 3D aunque no este viendo el tab.
}

// ============================================================
// DATA
// ============================================================

export async function refresh() {
  try {
    state = await api.getCombatState();
    updateHpHud();
    if (isTabOpen) render();
    notify();
  } catch (err) {
    console.warn('[combat] refresh err', err);
    if (isTabOpen && panelEl) {
      panelEl.innerHTML = `<div class="combat-error">${err.message || 'Error'}</div>`;
    }
  }
}

export function getStateSnapshot() {
  return state ? { stats: state.stats, npcs: state.npcs, currentTarget } : null;
}

export function onUpdate(cb) {
  listeners.push(cb);
  return () => { listeners = listeners.filter(x => x !== cb); };
}

function notify() {
  if (!state) return;
  for (const cb of listeners) {
    try { cb({ stats: state.stats, npcs: state.npcs }); } catch (e) { console.warn(e); }
  }
}

// ============================================================
// HP HUD (top-right)
// ============================================================

function updateHpHud() {
  if (!state) return;
  const hpEl = document.getElementById('hudHpValue');
  if (hpEl) hpEl.textContent = String(state.stats.hp_current);
  // Color rojo si HP bajo
  const card = document.getElementById('hudStatHp');
  if (card) {
    const ratio = state.stats.hp_current / Math.max(1, state.stats.hp_max);
    if (ratio <= 0.3) card.classList.add('hp-low');
    else card.classList.remove('hp-low');
  }
}

// ============================================================
// POLLING
// ============================================================

function startPolling() {
  stopPolling();
  pollTimer = setInterval(() => {
    if (isTabOpen && !currentTarget) {
      refresh().catch(() => {});
    }
  }, POLL_INTERVAL_MS);
}

function stopPolling() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
}

// ============================================================
// AUTO-ATTACK LOOP
// ============================================================

export async function engageNpc(npcId) {
  if (currentTarget === npcId && attackTimer) return; // ya engaged
  currentTarget = npcId;
  if (isTabOpen) render();
  await doAttackTick();
}

export function disengage() {
  currentTarget = null;
  if (attackTimer) { clearTimeout(attackTimer); attackTimer = null; }
  if (isTabOpen) render();
}

async function doAttackTick() {
  if (!currentTarget) return;
  const npcId = currentTarget;

  let result;
  try {
    result = await api.attackNpc(npcId);
  } catch (err) {
    // 400 con codigo: lo tratamos abajo. Otros: paramos.
    if (err.code) {
      result = { error: err.code, ...(err.cooldown_remaining_ms ? { cooldown_remaining_ms: err.cooldown_remaining_ms } : {}) };
    } else {
      disengage();
      if (isTabOpen) render();
      return;
    }
  }

  if (result.error) {
    if (result.error === 'on_cooldown') {
      // Re-tick despues del cooldown restante
      const wait = (result.cooldown_remaining_ms || TICK_MS) + 50;
      attackTimer = setTimeout(() => doAttackTick(), wait);
      return;
    }
    if (result.error === 'out_of_range') {
      // El cliente debe acercarse. Por ahora, disengage.
      flashError('Fuera de rango');
      disengage();
      return;
    }
    if (result.error === 'npc_dead' || result.error === 'npc_not_found') {
      disengage();
      await refresh();
      return;
    }
    if (result.error === 'user_dead') {
      disengage();
      await refresh();
      return;
    }
    disengage();
    return;
  }

  // ---- Aplicar resultado ----
  // Hit splats
  if (result.your_hit) {
    showHitSplatOnNpc(npcId, result.your_damage);
  } else {
    showHitSplatOnNpc(npcId, 0); // miss = "0" azul
  }
  if (result.npc_hit !== null && result.npc_hit !== undefined) {
    showHitSplatOnPlayer(result.npc_damage, result.npc_hit);
  }

  // Mensajes de level up (1 toast por skill)
  if (result.level_ups && result.level_ups.length) {
    for (const skill of result.level_ups) {
      const lvl = result.your_levels[skill];
      flashToast(`¡Subiste a nivel ${lvl} de ${skillLabel(skill)}!`);
    }
  }

  // Refrescar state local con lo que devolvio el server
  if (state) {
    state.stats.hp_current = result.your_hp;
    state.stats.hp_max = result.your_hp_max;
    state.stats.attack.level = result.your_levels.attack;
    state.stats.strength.level = result.your_levels.strength;
    state.stats.defence.level = result.your_levels.defence;
    state.stats.hp.level = result.your_levels.hp;
    // XP no nos lo devuelve crudo; mejor refrescar entero
    const npc = state.npcs.find(n => n.id === npcId);
    if (npc) {
      if (result.npc_killed) {
        state.npcs = state.npcs.filter(n => n.id !== npcId);
      } else {
        npc.hp_current = result.npc_hp;
      }
    }
  }
  updateHpHud();
  if (isTabOpen) render();
  notify();

  if (result.npc_killed) {
    flashToast(`¡Mataste al objetivo!`);
    disengage();
    // Refresh entero (XP exacto, etc)
    await refresh();
    return;
  }
  if (result.you_died) {
    flashToast('Has muerto. Respawn al hub.');
    disengage();
    await refresh();
    return;
  }

  // Programar siguiente tick
  attackTimer = setTimeout(() => doAttackTick(), TICK_MS);
}

// ============================================================
// HIT SPLATS
// ============================================================

function ensureSplatContainer() {
  if (splatContainer) return;
  splatContainer = document.createElement('div');
  splatContainer.id = 'combatSplats';
  splatContainer.className = 'combat-splat-container';
  document.body.appendChild(splatContainer);
}

function showSplat(x, y, damage, opts = {}) {
  ensureSplatContainer();
  const splat = document.createElement('div');
  splat.className = 'combat-splat';
  if (damage === 0 && !opts.miss) splat.classList.add('zero');
  if (opts.miss) splat.classList.add('miss');
  if (opts.player) splat.classList.add('player');
  splat.textContent = opts.miss ? '0' : String(damage);
  splat.style.left = `${x}px`;
  splat.style.top = `${y}px`;
  splatContainer.appendChild(splat);
  setTimeout(() => splat.remove(), HIT_SPLAT_DURATION_MS);
}

function showHitSplatOnNpc(npcId, damage) {
  // Sin integracion three.js todavia: pintamos en el centro de la pantalla.
  // Cuando se integre, esto recibira coords del mesh proyectado.
  const cx = window.innerWidth / 2;
  const cy = window.innerHeight / 2 - 40;
  showSplat(cx + (Math.random() * 30 - 15), cy, damage, { miss: damage === 0 });
}

function showHitSplatOnPlayer(damage, hit) {
  // Sobre el player (asumimos centro de pantalla por ahora)
  const cx = window.innerWidth / 2;
  const cy = window.innerHeight / 2 + 20;
  showSplat(cx + (Math.random() * 30 - 15), cy, damage, { miss: !hit, player: true });
}

// ============================================================
// TOAST + ERROR
// ============================================================

function flashToast(msg) {
  ensureSplatContainer();
  const t = document.createElement('div');
  t.className = 'combat-toast';
  t.textContent = msg;
  splatContainer.appendChild(t);
  setTimeout(() => t.classList.add('fading'), 1800);
  setTimeout(() => t.remove(), 2500);
}

function flashError(msg) {
  flashToast('⚠ ' + msg);
}

// ============================================================
// RENDER del tab
// ============================================================

function render() {
  if (!panelEl) return;
  if (!state) { panelEl.innerHTML = '<div class="combat-loading">Cargando…</div>'; return; }

  const s = state.stats;
  const dead = s.hp_current <= 0;

  panelEl.innerHTML = `
    <div class="combat-root">
      <div class="combat-header">
        <div class="combat-title">Combate</div>
        ${dead ? '<button class="combat-respawn" data-action="respawn">⚱ Respawn</button>' : ''}
      </div>

      <div class="combat-hp-row">
        <div class="combat-hp-label">HP</div>
        <div class="combat-hp-bar">
          <div class="combat-hp-fill" style="width:${pctFill(s.hp_current, s.hp_max)}%"></div>
          <div class="combat-hp-text">${s.hp_current} / ${s.hp_max}</div>
        </div>
      </div>

      <div class="combat-skills">
        ${renderSkill('attack', '⚔', s.attack)}
        ${renderSkill('strength', '💪', s.strength)}
        ${renderSkill('defence', '🛡', s.defence)}
        ${renderSkill('hp', '❤', s.hp)}
      </div>

      <div class="combat-npcs-label">Cerca de ti</div>
      <div class="combat-npcs">
        ${renderNpcs(state.npcs)}
      </div>
    </div>
  `;
  attachHandlers();
}

function renderSkill(key, icon, sk) {
  const xpInLevel = sk.xp_next > 0 ? Math.max(0, sk.xp_next - (sk.xp_next - (sk.xp - levelStart(sk.level)))) : 0;
  const range = Math.max(1, sk.xp_next - levelStart(sk.level));
  const into = Math.max(0, sk.xp - levelStart(sk.level));
  const pct = Math.min(100, Math.round((into / range) * 100));
  return `
    <div class="combat-skill">
      <div class="combat-skill-icon">${icon}</div>
      <div class="combat-skill-body">
        <div class="combat-skill-top">
          <span class="combat-skill-name">${skillLabel(key)}</span>
          <span class="combat-skill-level">${sk.level}</span>
        </div>
        <div class="combat-skill-bar">
          <div class="combat-skill-fill" style="width:${pct}%"></div>
        </div>
        <div class="combat-skill-xp">${formatXp(sk.xp)} XP</div>
      </div>
    </div>
  `;
}

function renderNpcs(npcs) {
  if (!npcs || !npcs.length) return '<div class="combat-empty">Nadie por aquí.</div>';
  return npcs.map(n => {
    const isTarget = currentTarget === n.id;
    const userPos = state && state.position;
    let inRange = true;
    let dist = null;
    if (userPos) {
      const dx = userPos.x - n.x, dz = userPos.z - n.z;
      dist = Math.sqrt(dx * dx + dz * dz);
      inRange = dist <= n.attack_range + 0.5;
    }
    return `
      <div class="combat-npc ${isTarget ? 'engaged' : ''} ${inRange ? '' : 'far'}">
        <div class="combat-npc-info">
          <div class="combat-npc-name">${escapeHtml(n.name)}</div>
          <div class="combat-npc-hp-bar">
            <div class="combat-npc-hp-fill" style="width:${pctFill(n.hp_current, n.max_hp)}%"></div>
          </div>
          <div class="combat-npc-meta">${n.hp_current}/${n.max_hp} HP · ${formatDist(dist)}</div>
        </div>
        <button class="combat-npc-attack" data-action="${isTarget ? 'stop' : 'attack'}" data-npc-id="${n.id}">
          ${isTarget ? '✕' : '⚔'}
        </button>
      </div>
    `;
  }).join('');
}

function attachHandlers() {
  if (!panelEl) return;
  panelEl.querySelectorAll('[data-action]').forEach(el => {
    el.addEventListener('click', async (ev) => {
      ev.preventDefault();
      const action = el.dataset.action;
      if (action === 'attack') {
        const npcId = parseInt(el.dataset.npcId, 10);
        await engageNpc(npcId);
      } else if (action === 'stop') {
        disengage();
      } else if (action === 'respawn') {
        try {
          await api.respawnUser();
          await refresh();
          flashToast('¡Estás de vuelta!');
        } catch (e) {
          flashError(e.message || 'Error');
        }
      }
    });
  });
}

// ============================================================
// UTILS
// ============================================================

function levelStart(level) {
  // Necesitamos la tabla XP. Simplificamos: pedimos al server via xp_next.
  // Como render usa esto solo para mostrar progress bar, podemos aproximar:
  // levelStart(L) = xp_next del nivel anterior. Pero solo tenemos xp_next del actual.
  // Simplificacion: si tenemos xp y xp_next, asumimos progress como xp / xp_next
  // (no es exacto pero es visualmente correcto para alpha).
  // El skill render usa Math.max(0, sk.xp - levelStart(...)) — devolvemos 0 y dejamos
  // que la formula calcule como porcentaje del xp_next.
  return 0;
}

function pctFill(cur, max) {
  if (!max || max <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((cur / max) * 100)));
}

function skillLabel(key) {
  return {
    attack: 'Ataque',
    strength: 'Fuerza',
    defence: 'Defensa',
    hp: 'Vitalidad',
  }[key] || key;
}

function formatXp(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
  return String(n);
}

function formatDist(d) {
  if (d === null || d === undefined) return '? m';
  if (d < 2) return 'al lado';
  return d.toFixed(1) + ' m';
}

function escapeHtml(s) {
  if (s === null || s === undefined) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
