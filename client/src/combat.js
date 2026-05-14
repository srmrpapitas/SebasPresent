/**
 * SebasPresent — Combat module v2 (Slice 5a v2)
 *
 * Cambios respecto a v1:
 *   - Feed estilo OSRS abajo izquierda (#combatFeed) en vez de toasts
 *     centrales y splats grandes. Cada hit/level/etc emite una linea.
 *   - export feedLog(type, text): world.js u otros modulos pueden
 *     emitir mensajes al feed.
 *
 * API publica:
 *   - init(), onOpen(), onClose(), refresh()
 *   - engageNpc(npcId), disengage()
 *   - onUpdate(cb), getStateSnapshot()
 *   - feedLog(type, text)
 */

import * as api from './api.js';

const TICK_MS = 600;
const POLL_INTERVAL_MS = 3000;
const FEED_MAX_LINES = 50;

let isInitialized = false;
let isTabOpen = false;
let state = null;
let currentTarget = null;
let attackTimer = null;
let pollTimer = null;
let listeners = [];
let panelEl = null;
let feedEl = null;

// ============================================================
// LIFECYCLE
// ============================================================

export function init() {
  if (isInitialized) return;
  ensureFeedEl();
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
    if (isTabOpen && panelEl) panelEl.innerHTML = `<div class="combat-error">${err.message || 'Error'}</div>`;
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

function updateHpHud() {
  if (!state) return;
  const hpEl = document.getElementById('hudHpValue');
  if (hpEl) hpEl.textContent = String(state.stats.hp_current);
  const card = document.getElementById('hudStatHp');
  if (card) {
    const ratio = state.stats.hp_current / Math.max(1, state.stats.hp_max);
    if (ratio <= 0.3) card.classList.add('hp-low');
    else card.classList.remove('hp-low');
  }
}

function startPolling() {
  stopPolling();
  pollTimer = setInterval(() => {
    if (isTabOpen && !currentTarget) refresh().catch(() => {});
  }, POLL_INTERVAL_MS);
}

function stopPolling() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
}

// ============================================================
// AUTO-ATTACK
// ============================================================

export async function engageNpc(npcId) {
  if (currentTarget === npcId && attackTimer) return;
  const npc = state?.npcs?.find(n => n.id === npcId);
  if (npc) feedLog('info', `Atacas: ${npc.name}.`);
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
      const wait = (result.cooldown_remaining_ms || TICK_MS) + 50;
      attackTimer = setTimeout(() => doAttackTick(), wait);
      return;
    }
    if (result.error === 'out_of_range') {
      feedLog('warning', 'Fuera de rango. Acércate.');
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

  const npc = state?.npcs?.find(n => n.id === npcId);
  const npcName = npc ? npc.name : 'el objetivo';
  if (result.your_hit) {
    feedLog('hit', `Le pegas a ${npcName} y le quitas ${result.your_damage} HP.`);
    // Dispara el efecto visual de "recibí hit" en world.js (flash + jerk).
    // Hook global expuesto por world.js para no acoplar módulos.
    if (typeof window !== 'undefined' && typeof window.__worldFlashNpcHit === 'function') {
      try { window.__worldFlashNpcHit(npcId); } catch {}
    }
  } else {
    feedLog('miss', `Fallas a ${npcName}.`);
  }
  if (result.npc_hit !== null && result.npc_hit !== undefined) {
    if (result.npc_hit) feedLog('player-hit', `${npcName} te pega ${result.npc_damage} HP.`);
    else feedLog('player-miss', `${npcName} falla el ataque.`);
  }
  if (result.level_ups && result.level_ups.length) {
    for (const skill of result.level_ups) {
      const lvl = result.your_levels[skill];
      feedLog('levelup', `¡Subes a nivel ${lvl} de ${skillLabel(skill)}!`);
    }
  }

  if (state) {
    state.stats.hp_current = result.your_hp;
    state.stats.hp_max = result.your_hp_max;
    state.stats.attack.level = result.your_levels.attack;
    state.stats.strength.level = result.your_levels.strength;
    state.stats.defence.level = result.your_levels.defence;
    state.stats.hp.level = result.your_levels.hp;
    const n = state.npcs.find(n => n.id === npcId);
    if (n) {
      if (result.npc_killed) state.npcs = state.npcs.filter(x => x.id !== npcId);
      else n.hp_current = result.npc_hp;
    }
  }
  updateHpHud();
  if (isTabOpen) render();
  notify();

  if (result.npc_killed) {
    feedLog('kill', `¡Has matado a ${npcName}!`);
    disengage();
    await refresh();
    return;
  }
  if (result.you_died) {
    feedLog('death', 'Has muerto. Reapareces en el hub.');
    disengage();
    await refresh();
    return;
  }

  attackTimer = setTimeout(() => doAttackTick(), TICK_MS);
}

// ============================================================
// FEED (estilo OSRS chatbox)
// ============================================================

function ensureFeedEl() {
  if (feedEl) return feedEl;
  let el = document.getElementById('combatFeed');
  if (!el) {
    el = document.createElement('div');
    el.id = 'combatFeed';
    el.className = 'combat-feed';
    const parent = document.getElementById('worldScreen') || document.body;
    parent.appendChild(el);
  }
  feedEl = el;
  return el;
}

/**
 * Push una linea al feed. Tipos: hit, miss, player-hit, player-miss,
 * kill, death, levelup, info, warning.
 */
export function feedLog(type, text) {
  const el = ensureFeedEl();
  const line = document.createElement('div');
  line.className = `feed-line feed-${type}`;
  line.textContent = text;
  el.appendChild(line);
  while (el.children.length > FEED_MAX_LINES) el.removeChild(el.firstChild);
  el.scrollTop = el.scrollHeight;
  // Auto-fade y remover tras 8s para no atascar la pantalla
  setTimeout(() => {
    line.style.transition = 'opacity 0.8s';
    line.style.opacity = '0';
    setTimeout(() => {
      if (line.parentNode) line.parentNode.removeChild(line);
    }, 800);
  }, 8000);
}

// ============================================================
// RENDER TAB
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
      <div class="combat-npcs">${renderNpcs(state.npcs)}</div>
    </div>`;
  attachHandlers();
}

function renderSkill(key, icon, sk) {
  const range = Math.max(1, sk.xp_next || 1);
  const pct = Math.min(100, Math.round((sk.xp / range) * 100));
  return `
    <div class="combat-skill">
      <div class="combat-skill-icon">${icon}</div>
      <div class="combat-skill-body">
        <div class="combat-skill-top">
          <span class="combat-skill-name">${skillLabel(key)}</span>
          <span class="combat-skill-level">${sk.level}</span>
        </div>
        <div class="combat-skill-bar"><div class="combat-skill-fill" style="width:${pct}%"></div></div>
        <div class="combat-skill-xp">${formatXp(sk.xp)} XP</div>
      </div>
    </div>`;
}

function renderNpcs(npcs) {
  if (!npcs || !npcs.length) return '<div class="combat-empty">Nadie por aqui.</div>';
  const userPos = state?.position;
  return npcs.slice(0, 30).map(n => {
    const isTarget = currentTarget === n.id;
    let inRange = true, dist = null;
    if (userPos) {
      const dx = userPos.x - n.x, dz = userPos.z - n.z;
      dist = Math.sqrt(dx * dx + dz * dz);
      inRange = dist <= n.attack_range + 0.5;
    }
    return `
      <div class="combat-npc ${isTarget ? 'engaged' : ''} ${inRange ? '' : 'far'}">
        <div class="combat-npc-info">
          <div class="combat-npc-name">${escapeHtml(n.name)}</div>
          <div class="combat-npc-hp-bar"><div class="combat-npc-hp-fill" style="width:${pctFill(n.hp_current, n.max_hp)}%"></div></div>
          <div class="combat-npc-meta">${n.hp_current}/${n.max_hp} HP · ${formatDist(dist)}</div>
        </div>
        <button class="combat-npc-attack" data-action="${isTarget ? 'stop' : 'attack'}" data-npc-id="${n.id}">${isTarget ? '✕' : '⚔'}</button>
      </div>`;
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
          feedLog('info', '¡Estas de vuelta!');
        } catch (e) { feedLog('warning', e.message || 'Error'); }
      }
    });
  });
}

// ============================================================
// UTILS
// ============================================================

function pctFill(cur, max) { return max > 0 ? Math.max(0, Math.min(100, Math.round((cur / max) * 100))) : 0; }
function skillLabel(key) { return { attack: 'Ataque', strength: 'Fuerza', defence: 'Defensa', hp: 'Vitalidad' }[key] || key; }
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
  if (s == null) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
