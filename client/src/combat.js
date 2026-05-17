/**
 * SebasPresent — Combat module v2 (Slice 5a v2 + Sesión 17 hooks)
 *
 * Sesión 17: tras cada attack tick, dispara 3 efectos visuales via hooks
 * globales registrados por damage_splat.js (a través de world.js):
 *
 *   window.__spawnXpDrops(xpMap)
 *     Floating "+5 Ataque XP" arriba del minimapa. Una pildora por skill
 *     con XP > 0 (1-4 simultáneas según stance).
 *
 *   window.__spawnPlayerSplat(damage, hit)
 *     Cuadrado rojo/azul OSRS sobre el sprite del player cuando RECIBE
 *     daño del NPC en el counter-attack.
 *
 *   window.__spawnLevelUpBanner(skillId, newLevel)
 *     Banner centrado "¡Has subido a Nivel X de Ataque!" cuando hay
 *     level up. Solo el primer skill que sube si hay varios.
 *
 * Si los hooks no están registrados (damage_splat no cargado todavía),
 * los try/catch los ignoran silenciosamente.
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
import * as equipment from './equipment.js';

const TICK_MS = 600;
const POLL_INTERVAL_MS = 3000;
const FEED_MAX_LINES = 50;

// Sesión 17 — mapping skill_id interno → skill_id del catálogo nuevo
const SKILL_ID_MAP = {
  attack: 'attack',
  strength: 'strength',
  defence: 'defence',
  hp: 'hitpoints',
};

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
  ensureStyles();  // Slice 5b: inyecta CSS de los botones de estilo de combate

  // Sesión 22: cuando cambia el equipment, refrescar el tab si está abierto.
  // Esto reescribe los stances según el arma nueva.
  try {
    equipment.onChange?.(() => {
      // Reset UI stance para que se recalcule según nueva arma
      uiSelectedStance = null;
      if (isTabOpen) render();
    });
  } catch (e) { console.warn('[combat] equipment.onChange:', e); }

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
  // Slice 5d — animación: world.js decide si desenvainar (primera vez)
  // o solo cambiar el target (target switch sin envainar entre medio).
  if (typeof window !== 'undefined' && typeof window.__playerEnterCombat === 'function') {
    try { window.__playerEnterCombat(npcId); } catch {}
  }
  if (isTabOpen) render();
  await doAttackTick();
}

export function disengage() {
  const wasEngaged = currentTarget !== null;
  currentTarget = null;
  if (attackTimer) { clearTimeout(attackTimer); attackTimer = null; }
  // Slice 5d — animación: si estábamos en combate, envaina la espada.
  if (wasEngaged && typeof window !== 'undefined' && typeof window.__playerExitCombat === 'function') {
    try { window.__playerExitCombat(); } catch {}
  }
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

  // Slice 5b: dispara la animación de swing del player en CADA tick (hit
  // o miss — en OSRS el personaje hace el gesto siempre). El hook global
  // lo expone world.js y rebota a character.playAttack().
  if (typeof window !== 'undefined' && typeof window.__playerPlayAttack === 'function') {
    try { window.__playerPlayAttack(); } catch {}
  }

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
  // Hitsplat OSRS sobre el NPC — gota roja para daño, escudo azul para miss/0.
  // Se dispara siempre, igual que en OSRS clásico (también muestra el "0").
  if (typeof window !== 'undefined' && typeof window.__worldSpawnHitsplat === 'function') {
    try { window.__worldSpawnHitsplat(npcId, result.your_damage || 0); } catch {}
  }

  // Sesión 17 — XP DROPS: pildoras flotantes arriba del minimapa por cada
  // skill que ganó XP. Solo se muestran si damage_splat.js está cargado.
  if (typeof window !== 'undefined' && typeof window.__spawnXpDrops === 'function' && result.xp_gained) {
    try { window.__spawnXpDrops(result.xp_gained); } catch {}
  }

  if (result.npc_hit !== null && result.npc_hit !== undefined) {
    if (result.npc_hit) feedLog('player-hit', `${npcName} te pega ${result.npc_damage} HP.`);
    else feedLog('player-miss', `${npcName} falla el ataque.`);

    // Sesión 17 — PLAYER SPLAT: cuadrado rojo/azul sobre el player cuando
    // recibe daño del NPC. damage=0 con miss → splat azul "0" OSRS-style.
    if (typeof window !== 'undefined' && typeof window.__spawnPlayerSplat === 'function') {
      try { window.__spawnPlayerSplat(result.npc_damage || 0, result.npc_hit); } catch {}
    }
  }

  if (result.level_ups && result.level_ups.length) {
    for (const skill of result.level_ups) {
      const lvl = result.your_levels[skill];
      feedLog('levelup', `¡Subes a nivel ${lvl} de ${skillLabel(skill)}!`);
    }
    // Sesión 17 — LEVEL UP BANNER: solo el primer skill que sube (varios
    // simultáneos es raro y un solo banner es más limpio que apilarlos).
    if (typeof window !== 'undefined' && typeof window.__spawnLevelUpBanner === 'function') {
      const firstSkill = result.level_ups[0];
      const mappedId = SKILL_ID_MAP[firstSkill] || firstSkill;
      const lvl = result.your_levels[firstSkill];
      try { window.__spawnLevelUpBanner(mappedId, lvl); } catch {}
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
    // Slice 5d — animación de muerte del player
    if (typeof window !== 'undefined' && typeof window.__playerDeath === 'function') {
      try { window.__playerDeath(); } catch {}
    }
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
// Sesión 18 — Sistema de armas dinámico estilo OSRS
// ============================================================
// El tab Combate muestra stances distintos según el arma equipada.
// detectEquippedWeapon() hoy devuelve siempre 'unarmed' (no hay equipment
// todavía). Cuando se añada equipment, solo hay que cambiar esta función.

const WEAPON_STANCES = {
  unarmed: {
    name: 'Unarmed',
    category: 'Unarmed',
    hasSpecial: false,
    stances: [
      { id: 'punch', label: 'Punch', icon: '👊', server: 'accurate'   },
      { id: 'kick',  label: 'Kick',  icon: '🦵', server: 'aggressive' },
      { id: 'block', label: 'Block', icon: '🛡', server: 'defensive'  },
    ],
  },
  // Preparado para futuro equipment (sesión 19+). No se renderizan hoy
  // porque detectEquippedWeapon() devuelve siempre 'unarmed'.
  '1h_sword': {
    name: 'Bronze sword',
    category: '1H Sword',
    hasSpecial: false,
    stances: [
      { id: 'chop',  label: 'Chop',  icon: '⚔', server: 'accurate'   },
      { id: 'slash', label: 'Slash', icon: '⚔', server: 'aggressive' },
      { id: 'smash', label: 'Smash', icon: '💢', server: 'controlled' },
      { id: 'block', label: 'Block', icon: '🛡', server: 'defensive'  },
    ],
  },
  '2h_sword': {
    name: 'Two-handed sword',
    category: '2H Sword',
    hasSpecial: true,
    stances: [
      { id: 'chop',  label: 'Chop',  icon: '⚔', server: 'accurate'   },
      { id: 'slash', label: 'Slash', icon: '⚔', server: 'aggressive' },
      { id: 'smash', label: 'Smash', icon: '💢', server: 'controlled' },
      { id: 'block', label: 'Block', icon: '🛡', server: 'defensive'  },
    ],
  },
  bow: {
    name: 'Shortbow',
    category: 'Bow',
    hasSpecial: false,
    stances: [
      { id: 'accurate_bow', label: 'Accurate', icon: '🏹', server: 'accurate'   },
      { id: 'rapid',        label: 'Rapid',    icon: '🏹', server: 'aggressive' },
      { id: 'longrange',    label: 'Longrange',icon: '🎯', server: 'defensive'  },
    ],
  },
  staff: {
    name: 'Staff',
    category: 'Staff',
    hasSpecial: false,
    stances: [
      { id: 'bash',  label: 'Bash',  icon: '🔨', server: 'accurate'   },
      { id: 'pound', label: 'Pound', icon: '💥', server: 'aggressive' },
      { id: 'focus', label: 'Focus', icon: '✨', server: 'defensive'  },
    ],
  },
};

// Mapping server-stance → UI-stance-id para la weapon activa
function uiStanceFromServer(weaponKey, serverStance) {
  const w = WEAPON_STANCES[weaponKey];
  if (!w) return null;
  const match = w.stances.find(s => s.server === serverStance);
  return match ? match.id : w.stances[0].id;
}

/**
 * Sesión 22: detecta el arma equipada vía el módulo equipment.
 * Devuelve la key de WEAPON_STANCES correspondiente.
 *   'unarmed' | '1h_sword' | '2h_sword' | 'bow' | 'staff'
 */
function detectEquippedWeapon() {
  try {
    const wt = equipment.getWeaponType?.();
    if (wt && wt !== 'unarmed') return wt;
  } catch {}
  return 'unarmed';
}

// Estado local de UI: stance seleccionada y auto-retaliate.
let uiSelectedStance = null;
let autoRetaliate = false;  // TODO: persistir cuando server lo soporte

// ============================================================
// RENDER TAB
// ============================================================

function render() {
  if (!panelEl) return;
  if (!state) { panelEl.innerHTML = '<div class="combat-loading">Cargando…</div>'; return; }
  const s = state.stats;
  const dead = s.hp_current <= 0;

  const weaponKey = detectEquippedWeapon();
  const weapon = WEAPON_STANCES[weaponKey];
  const serverStance = state.combat_style || 'accurate';
  // Sincronizar uiSelectedStance con server stance si no hay selección local
  if (!uiSelectedStance || !weapon.stances.find(s => s.id === uiSelectedStance)) {
    uiSelectedStance = uiStanceFromServer(weaponKey, serverStance);
  }
  const combatLvl = computeCombatLvl(s);

  panelEl.innerHTML = `
    <div class="combat-osrs">
      <div class="combat-osrs-header">
        <div class="combat-osrs-weapon">${escapeHtml(weapon.name)}</div>
        <div class="combat-osrs-cb-level">Combat Lvl: <b>${combatLvl}</b></div>
      </div>

      <div class="combat-osrs-hp-row">
        <div class="combat-osrs-hp-bar">
          <div class="combat-osrs-hp-fill" style="width:${pctFill(s.hp_current, s.hp_max)}%"></div>
          <div class="combat-osrs-hp-text">${s.hp_current} / ${s.hp_max}</div>
        </div>
      </div>

      ${dead ? '<button class="combat-respawn" data-action="respawn">⚱ Respawn</button>' : ''}

      <div class="combat-osrs-stances ${weapon.stances.length === 3 ? 'stances-3' : 'stances-4'}">
        ${weapon.stances.map(st => `
          <button class="combat-osrs-stance ${st.id === uiSelectedStance ? 'selected' : ''}"
                  data-action="ui-stance" data-stance-id="${st.id}" data-server-style="${st.server}">
            <div class="combat-osrs-stance-icon">${st.icon}</div>
            <div class="combat-osrs-stance-label">${st.label}</div>
          </button>
        `).join('')}
      </div>

      <button class="combat-osrs-retaliate ${autoRetaliate ? 'on' : 'off'}" data-action="toggle-retaliate">
        <span class="combat-osrs-retaliate-icon">🛡</span>
        Auto Retaliate (${autoRetaliate ? 'On' : 'Off'})
      </button>

      ${weapon.hasSpecial ? `
        <div class="combat-osrs-special">
          <div class="combat-osrs-special-label">Special Attack: 100%</div>
          <div class="combat-osrs-special-bar"><div class="combat-osrs-special-fill" style="width:100%"></div></div>
        </div>` : ''}

      <div class="combat-osrs-category">Category: ${weapon.category}</div>

      <div class="combat-osrs-npcs-label">Cerca de ti</div>
      <div class="combat-osrs-npcs">${renderNpcs(state.npcs)}</div>
    </div>`;
  attachHandlers();
}

// Combat level OSRS-style. Replica skills_engine.combatLevel pero local
// porque no queremos acoplar combat.js a skills.js todavía.
function computeCombatLvl(stats) {
  const att = stats.attack?.level || 1;
  const str = stats.strength?.level || 1;
  const def = stats.defence?.level || 1;
  const hp  = stats.hp?.level || 10;
  const base = (def + hp) / 4;
  const melee = (att + str) * 13 / 40;
  return Math.floor(base + melee);
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
          // Slice 5d — animación: vuelve a idle, sin combate
          if (typeof window !== 'undefined' && typeof window.__playerRevive === 'function') {
            try { window.__playerRevive(); } catch {}
          }
          feedLog('info', '¡Estas de vuelta!');
        } catch (e) { feedLog('warning', e.message || 'Error'); }
      } else if (action === 'ui-stance') {
        // Sesión 18 — Click en stance OSRS (Punch/Kick/Block/etc).
        // El data-server-style mapea a accurate/aggressive/defensive/controlled.
        const stanceId = el.dataset.stanceId;
        const serverStyle = el.dataset.serverStyle;
        if (!stanceId || !serverStyle) return;
        const prev = state?.combat_style;
        const prevUi = uiSelectedStance;
        try {
          uiSelectedStance = stanceId;
          if (state) state.combat_style = serverStyle;
          render();
          await api.setCombatStyle(serverStyle);
        } catch (e) {
          uiSelectedStance = prevUi;
          if (state) state.combat_style = prev;
          render();
          feedLog('warning', e.message || 'No se pudo cambiar la postura.');
        }
      } else if (action === 'toggle-retaliate') {
        // Sesión 18 — Auto Retaliate (local-only por ahora; cuando el server
        // soporte el flag, mandar POST /api/combat/retaliate).
        autoRetaliate = !autoRetaliate;
        render();
      } else if (action === 'style') {
        // Legacy: botones viejos de "style" (accurate/aggressive/defensive/
        // controlled). Mantenido por compatibilidad si algún otro código
        // los renderiza, aunque el nuevo UI usa ui-stance.
        const style = el.dataset.style;
        if (!style) return;
        const prev = state?.combat_style;
        try {
          if (state) state.combat_style = style;
          render();
          await api.setCombatStyle(style);
          feedLog('info', `Estilo: ${combatStyleLabel(style)}.`);
        } catch (e) {
          if (state) state.combat_style = prev;
          render();
          feedLog('warning', e.message || 'No se pudo cambiar el estilo.');
        }
      }
    });
  });
}

function combatStyleLabel(key) {
  return ({
    accurate:   'Preciso (Atk)',
    aggressive: 'Agresivo (Str)',
    defensive:  'Defensivo (Def)',
    controlled: 'Equilibrado',
  })[key] || key;
}

// Slice 5b — CSS de los botones de estilo de combate. Se inyecta una sola
// vez en init() para mantener todo el styling del módulo de combat
// encapsulado aquí y no tener que tocar style.css.
function ensureStyles() {
  if (typeof document === 'undefined') return;
  if (document.getElementById('combat-styles-css')) return;
  const style = document.createElement('style');
  style.id = 'combat-styles-css';
  style.textContent = `
    /* Sesión 18 — Tab Combate estilo OSRS clásico */
    .combat-osrs {
      padding: 8px 6px;
      display: flex;
      flex-direction: column;
      gap: 8px;
      font-family: 'Cinzel', serif;
      color: #e8c560;
    }
    .combat-osrs-header {
      text-align: center;
      padding: 4px 0 6px 0;
      border-bottom: 1px solid rgba(200, 160, 67, 0.3);
    }
    .combat-osrs-weapon {
      font-family: 'Cinzel', serif;
      font-size: 15px;
      font-weight: 900;
      color: #fff8d0;
      letter-spacing: 0.04em;
      text-shadow: 0 2px 4px rgba(0,0,0,0.9);
      line-height: 1.2;
    }
    .combat-osrs-cb-level {
      font-family: 'IM Fell English', serif;
      font-size: 12px;
      color: #c8a043;
      margin-top: 2px;
    }
    .combat-osrs-cb-level b { color: #ffd060; }

    /* HP bar dentro del tab */
    .combat-osrs-hp-row {
      padding: 0 4px;
    }
    .combat-osrs-hp-bar {
      position: relative;
      height: 14px;
      background: rgba(40, 25, 15, 0.95);
      border: 1.5px solid #5a4a30;
      border-radius: 3px;
      overflow: hidden;
    }
    .combat-osrs-hp-fill {
      height: 100%;
      background: linear-gradient(180deg, #4abc4a, #2e7a2e);
      transition: width 0.3s;
    }
    .combat-osrs-hp-text {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      font-family: 'IM Fell English', serif;
      font-size: 11px;
      font-weight: bold;
      color: #fff;
      text-shadow: 1px 1px 0 #000, -1px 1px 0 #000, 1px -1px 0 #000, -1px -1px 0 #000;
      line-height: 1;
    }

    /* Grid de stances: 3 columnas si hay 3 (Unarmed/Staff/Bow),
       2 columnas × 2 filas si hay 4 (1H/2H Sword) */
    .combat-osrs-stances {
      display: grid;
      gap: 6px;
    }
    .combat-osrs-stances.stances-3 { grid-template-columns: repeat(3, 1fr); }
    .combat-osrs-stances.stances-4 { grid-template-columns: repeat(2, 1fr); }

    .combat-osrs-stance {
      background: linear-gradient(180deg, rgba(80, 55, 30, 0.95), rgba(50, 30, 18, 0.95));
      border: 2px solid #5a4a30;
      border-radius: 4px;
      padding: 10px 4px;
      cursor: pointer;
      -webkit-tap-highlight-color: transparent;
      user-select: none;
      transition: transform 0.08s, border-color 0.15s, box-shadow 0.15s, background 0.15s;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 4px;
      min-height: 64px;
      color: rgba(232, 197, 96, 0.75);
      font-family: 'Cinzel', serif;
    }
    .combat-osrs-stance:active { transform: scale(0.94); }
    .combat-osrs-stance.selected {
      background: linear-gradient(180deg, rgba(180, 60, 40, 0.95), rgba(120, 30, 20, 0.95));
      border-color: #ff6040;
      box-shadow: 0 0 14px rgba(255, 96, 64, 0.45), inset 0 0 6px rgba(255, 96, 64, 0.25);
      color: #fff8d0;
    }
    .combat-osrs-stance-icon {
      font-size: 24px;
      line-height: 1;
      filter: drop-shadow(0 2px 4px rgba(0,0,0,0.8));
    }
    .combat-osrs-stance-label {
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.04em;
      text-shadow: 0 1px 2px rgba(0,0,0,0.9);
    }

    /* Auto Retaliate */
    .combat-osrs-retaliate {
      background: linear-gradient(180deg, rgba(60, 45, 30, 0.95), rgba(35, 22, 12, 0.95));
      border: 2px solid #5a4a30;
      border-radius: 4px;
      padding: 10px 12px;
      cursor: pointer;
      -webkit-tap-highlight-color: transparent;
      user-select: none;
      color: #e8c560;
      font-family: 'Cinzel', serif;
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0.05em;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      transition: transform 0.08s, border-color 0.15s, box-shadow 0.15s;
    }
    .combat-osrs-retaliate:active { transform: scale(0.97); }
    .combat-osrs-retaliate.on {
      border-color: #4abc4a;
      box-shadow: 0 0 12px rgba(74, 188, 74, 0.35);
      color: #b4f4b4;
    }
    .combat-osrs-retaliate-icon {
      font-size: 16px;
      filter: drop-shadow(0 1px 2px rgba(0,0,0,0.8));
    }

    /* Special Attack bar (solo arms 2H) */
    .combat-osrs-special {
      margin: 4px 0;
    }
    .combat-osrs-special-label {
      font-family: 'IM Fell English', serif;
      font-size: 11px;
      color: #4abc4a;
      text-align: center;
      margin-bottom: 3px;
    }
    .combat-osrs-special-bar {
      height: 10px;
      background: rgba(40, 25, 15, 0.95);
      border: 1.5px solid #5a4a30;
      border-radius: 3px;
      overflow: hidden;
    }
    .combat-osrs-special-fill {
      height: 100%;
      background: linear-gradient(180deg, #4abc4a, #2e7a2e);
      transition: width 0.4s;
    }

    /* Category footer */
    .combat-osrs-category {
      text-align: center;
      font-family: 'IM Fell English', serif;
      font-size: 11px;
      color: rgba(200, 160, 67, 0.7);
      padding: 4px 0;
      border-top: 1px solid rgba(200, 160, 67, 0.2);
    }

    /* NPCs cerca (mantenemos esta sección, útil) */
    .combat-osrs-npcs-label {
      font-family: 'Cinzel', serif;
      font-size: 11px;
      color: #c8a043;
      text-align: center;
      letter-spacing: 0.04em;
      margin-top: 4px;
    }
    .combat-osrs-npcs {
      display: flex;
      flex-direction: column;
      gap: 4px;
      max-height: 220px;
      overflow-y: auto;
    }

    /* Reutilizamos clases combat-npc del CSS viejo, pero por si no están
       en style.css los definimos básicos aquí. */
    .combat-npc {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 5px 6px;
      background: rgba(30, 22, 14, 0.85);
      border: 1px solid #5a4a30;
      border-radius: 3px;
    }
    .combat-npc.engaged { border-color: #ff6040; }
    .combat-npc.far { opacity: 0.55; }
    .combat-npc-info { flex: 1 1 auto; min-width: 0; }
    .combat-npc-name {
      font-size: 11px;
      color: #fff8d0;
      font-weight: 700;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .combat-npc-hp-bar {
      height: 4px;
      background: rgba(80, 30, 30, 0.9);
      border-radius: 2px;
      margin: 2px 0;
      overflow: hidden;
    }
    .combat-npc-hp-fill {
      height: 100%;
      background: #4abc4a;
    }
    .combat-npc-meta {
      font-size: 9px;
      color: rgba(200, 160, 67, 0.7);
      font-family: 'IM Fell English', serif;
    }
    .combat-npc-attack {
      flex: 0 0 auto;
      width: 28px;
      height: 28px;
      background: rgba(120, 30, 20, 0.95);
      border: 1.5px solid #c8a043;
      border-radius: 3px;
      color: #ffd060;
      font-size: 13px;
      cursor: pointer;
      -webkit-tap-highlight-color: transparent;
    }
    .combat-npc-attack:active { transform: scale(0.9); }

    .combat-respawn {
      align-self: center;
      padding: 8px 18px;
      background: linear-gradient(180deg, #c84830, #802018);
      border: 2px solid #ffaa44;
      color: #fff8d0;
      font-family: 'Cinzel', serif;
      font-weight: 700;
      font-size: 13px;
      border-radius: 4px;
      cursor: pointer;
      box-shadow: 0 0 10px rgba(255,100,50,0.5);
    }
    .combat-loading, .combat-error, .combat-empty {
      text-align: center;
      padding: 12px;
      color: rgba(200, 160, 67, 0.7);
      font-family: 'IM Fell English', serif;
      font-size: 12px;
    }
  `;
  document.head.appendChild(style);
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
