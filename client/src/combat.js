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
import * as spellbook from './spellbook.js';   // Sesión 41 — hechizo seleccionado
import * as equipment from './equipment.js';
import * as inventory from './inventory.js';        // Sesión 35 — sync local de arrows
import * as skills from './skills.js';
import * as multiplayer from './multiplayer.js';   // Sesión 27 Bloque 3 — PVP
import * as worldSnapshot from './world_snapshot.js'; // Sesión 27 Bloque 3 — auto-retaliate
import * as audio from './audio.js';               // Sesión 32 — SFX de combat
import * as combatStyles from './combat_styles.js'; // Sesión 33 día 2 — selector de estilo

// Sesión 25 — TICK_MS sincronizado con server (combat_engine.js). 900ms.
const TICK_MS = 900;
const POLL_INTERVAL_MS = 3000;
const FEED_MAX_LINES = 50;

// Sesión 17 — mapping skill_id interno → skill_id del catálogo nuevo.
// Sesión 35 — agregado ranged (para el banner de level-up).
const SKILL_ID_MAP = {
  attack: 'attack',
  strength: 'strength',
  defence: 'defence',
  hp: 'hitpoints',
  ranged: 'ranged',
};

let isInitialized = false;
let isTabOpen = false;
let state = null;
let currentTarget = null;
// Sesión 27 Bloque 3 — Target dual. Solo uno puede estar activo a la vez.
// currentTarget (legacy, lee npc id) se mantiene como alias de
// currentTargetNpcId para compatibilidad con npc_renderer.js u otros
// módulos que esperaban un id de NPC.
let currentTargetNpcId    = null;
let currentTargetPlayerId = null;
let attackTimer = null;
// Sesión 39 — fix exploit multi-click: token de generación. Cada engage (o
// disengage) lo incrementa. Cada tick recuerda con qué generación arrancó y
// NO reprograma su setTimeout si la generación ya cambió (clickeaste otro
// target durante el await del ataque). Sin esto, cambiar de target rápido
// dejaba CADENAS de ataque huérfanas corriendo en paralelo → atacabas a
// varios NPCs a la vez ganando XP múltiple.
let attackGen = 0;
let pollTimer = null;
let listeners = [];
let panelEl = null;
let feedEl = null;

// Sesión 37 — Guard para que el detector de muerte en refresh() no dispare
// __playerDeath dos veces. Se setea true cuando vemos hp<=0 por primera
// vez, se resetea cuando vemos hp>0 (server respawneó). Ver refresh().
let _localDeathHandled = false;

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

  // Sesión 27 Bloque 3 — Inyectar este módulo en multiplayer para que
  // multiplayer pueda llamar a engagePlayer() al hacer tap en un peer.
  // (Evita import circular: combat → multiplayer, multiplayer ← combat
  // se resuelve por late-binding aquí.)
  try {
    multiplayer.setCombatModule({ engagePlayer });
    multiplayer.setFeedLog(feedLog);
  } catch (e) { console.warn('[combat] multiplayer wire:', e); }

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
    // Sesión 37 — Safety net death detection. El path PRIMARIO de "te
    // mataron" es server-driven vía world_snapshot (me.you_died_recently
    // del snapshot cada ~250ms). Este chequeo extra es para el caso edge
    // donde world_snapshot está down/desfasado: si /combat/state nos llega
    // con hp_current<=0 y no se procesó muerte aún, disparamos
    // __playerDeath igual. Latencia: hasta 3s (POLL_INTERVAL_MS) vs
    // ~250ms del server-driven path.
    try {
      const hp = state?.stats?.hp_current;
      if (typeof hp === 'number' && hp <= 0 && !_localDeathHandled) {
        _localDeathHandled = true;
        if (typeof window !== 'undefined' && typeof window.__playerDeath === 'function') {
          try { window.__playerDeath(); } catch {}
        }
        showDeathOverlay();
        disengage();
      } else if (typeof hp === 'number' && hp > 0 && _localDeathHandled) {
        // Server respawneó. Reset.
        _localDeathHandled = false;
      }
    } catch (e) { console.warn('[combat] death-safety-net check failed:', e); }
    updateHpHud();
    if (isTabOpen) render();
    notify();
  } catch (err) {
    console.warn('[combat] refresh err', err);
    if (isTabOpen && panelEl) panelEl.innerHTML = `<div class="combat-error">${err.message || 'Error'}</div>`;
  }
}

export function getStateSnapshot() {
  return state ? {
    stats: state.stats,
    npcs: state.npcs,
    currentTarget: currentTargetNpcId,     // legacy: id del NPC engaged (null si PVP)
    currentTargetPlayer: currentTargetPlayerId,  // Sesión 27 Bloque 3
  } : null;
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
    // Sesión 26 — Polling siempre activo (no solo cuando tab Combate
    // está abierto) para que el HUD vea la HP regen pasiva calculada
    // por el server cada vez que pedimos state. Mientras hay un target
    // de combate activo (NPC o player PVP), el auto-attack ya está
    // refrescando por su lado.
    if (currentTargetNpcId === null && currentTargetPlayerId === null) {
      refresh().catch(() => {});
    }
  }, POLL_INTERVAL_MS);
  // Sesión 27 Bloque 3 — arrancar también el loop de auto-retaliate.
  // Es independiente del tab y se activa solo si autoRetaliate=ON.
  startAutoRetaliateLoop();
}

function stopPolling() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  stopAutoRetaliateLoop();
}

// ============================================================
// AUTO-ATTACK
// ============================================================

export async function engageNpc(npcId) {
  clog('engageNpc(', npcId, ') — caller:', new Error().stack?.split('\n')[2]?.trim());
  if (currentTargetNpcId === npcId && attackTimer) return;
  // Sesión 39 — fix exploit: cancelar CUALQUIER loop de ataque previo antes
  // de arrancar el nuevo target, y bumpear la generación para invalidar ticks
  // viejos que estén a mitad de su await. Un solo target a la vez.
  if (attackTimer) { clearTimeout(attackTimer); attackTimer = null; }
  attackGen++;
  const myGen = attackGen;
  // Si veníamos atacando otro target, lo limpiamos
  currentTargetPlayerId = null;
  // Reset anti-loop de auto-retaliate (engage manual recalibra)
  lastAutoEngagedAttackerKey = null;
  const npc = state?.npcs?.find(n => n.id === npcId);
  if (npc) feedLog('info', `Atacas: ${npc.name}.`);
  currentTargetNpcId = npcId;
  currentTarget = npcId; // legacy alias
  // Slice 5d — animación: world.js decide si desenvainar (primera vez)
  // o solo cambiar el target (target switch sin envainar entre medio).
  if (typeof window !== 'undefined' && typeof window.__playerEnterCombat === 'function') {
    try { window.__playerEnterCombat(npcId); } catch {}
  }
  if (isTabOpen) render();
  await doAttackTick(myGen);
}

/**
 * Sesión 27 Bloque 3 — engagePlayer
 * Mismo flujo que engageNpc pero target = otro player.
 */
export async function engagePlayer(targetUserId) {
  clog('engagePlayer(', targetUserId, ') — caller:', new Error().stack?.split('\n')[2]?.trim());
  if (currentTargetPlayerId === targetUserId && attackTimer) return;
  // Sesión 39 — fix exploit: mismo patrón que engageNpc.
  if (attackTimer) { clearTimeout(attackTimer); attackTimer = null; }
  attackGen++;
  const myGen = attackGen;
  currentTargetNpcId = null;
  currentTarget = null;
  currentTargetPlayerId = targetUserId;
  // Reset anti-loop de auto-retaliate
  lastAutoEngagedAttackerKey = null;
  const peer = multiplayer.getPeerById?.(targetUserId);
  const name = peer?.username || 'jugador';
  feedLog('info', `Atacas a ${name}.`);
  // Animación: enterCombat (sin npcId concreto, le pasamos targetUserId
  // como identificador genérico — el hook solo lo usa para desenvainar.)
  if (typeof window !== 'undefined' && typeof window.__playerEnterCombat === 'function') {
    try { window.__playerEnterCombat(`player_${targetUserId}`); } catch {}
  }
  if (isTabOpen) render();
  await doAttackTick(myGen);
}

export function disengage() {
  const wasEngaged = currentTargetNpcId !== null || currentTargetPlayerId !== null;
  currentTargetNpcId = null;
  currentTargetPlayerId = null;
  currentTarget = null;
  attackGen++;   // Sesión 39 — invalida cualquier tick en vuelo
  if (attackTimer) { clearTimeout(attackTimer); attackTimer = null; }
  // Slice 5d — animación: si estábamos en combate, envaina la espada.
  if (wasEngaged && typeof window !== 'undefined' && typeof window.__playerExitCombat === 'function') {
    try { window.__playerExitCombat(); } catch {}
  }
  if (isTabOpen) render();
}

async function doAttackTick(gen = attackGen) {
  // Sesión 39 — si la generación cambió (otro engage/disengage ocurrió),
  // este tick es de un target viejo: abortar sin atacar ni reprogramar.
  if (gen !== attackGen) return;
  // Sesión 27 Bloque 3 — Target dual NPC/player.
  if (currentTargetNpcId !== null) {
    await doAttackTickNpc(gen);
  } else if (currentTargetPlayerId !== null) {
    await doAttackTickPlayer(gen);
  }
}

async function doAttackTickNpc(gen = attackGen) {
  if (currentTargetNpcId === null) return;
  if (gen !== attackGen) return;   // Sesión 39 — target cambió antes de empezar

  // Sesión 33 día 2 — el style decide si podemos atacar (ammo/runas/etc).
  // Para melee siempre devuelve {ok:true}. Cuando se implemente ranged/magic,
  // esto chequea recursos antes de mandar el request al server. Envuelto
  // en try/catch para que un fallo del style NO bloquee combate.
  let canAttackResult = { ok: true };
  try { canAttackResult = combatStyles.getActiveStyle().canAttack(); }
  catch (e) { console.warn('[combat] canAttack threw, defaulting to ok:', e); }
  if (!canAttackResult.ok) {
    feedLog('warning', canAttackResult.message || 'No puedes atacar ahora.');
    disengage();
    return;
  }

  const npcId = currentTargetNpcId;
  let result;
  try {
    let pos = null;
    try {
      const p = window.__getPlayerPosition?.();
      if (p && Number.isFinite(p.x) && Number.isFinite(p.z)) pos = p;
    } catch {}
    result = await api.attackNpc(npcId, pos, spellbook.getSelectedSpellId?.());
    try { worldSnapshot.markCombatActivity?.(); } catch {}  // Sesión 41 — poll rápido en combate
  } catch (err) {
    if (err.code) {
      result = { error: err.code, ...(err.cooldown_remaining_ms ? { cooldown_remaining_ms: err.cooldown_remaining_ms } : {}) };
    } else {
      disengage();
      if (isTabOpen) render();
      return;
    }
  }

  // Sesión 39 — fix exploit multi-click: si mientras esperábamos la respuesta
  // del server el jugador cambió de target (otro engage/disengage), ESTE tick
  // quedó obsoleto. Abortar ANTES de procesar XP/hitsplat/reprogramar, para no
  // dejar dos cadenas de ataque vivas a la vez. El daño ya lo aplicó el server
  // (autoritativo), pero NO seguimos atacando a este NPC viejo.
  if (gen !== attackGen || currentTargetNpcId !== npcId) return;

  if (result.error) {
    if (result.error === 'on_cooldown') {
      const wait = (result.cooldown_remaining_ms || TICK_MS) + 50;
      if (gen === attackGen) attackTimer = setTimeout(() => doAttackTick(gen), wait);
      return;
    }
    if (result.error === 'out_of_range') {
      feedLog('warning', 'Fuera de rango. Acércate.');
      disengage();
      return;
    }
    // Sesión 34 — Bow sin flechas: el server devuelve 'no_ammo' antes de
    // procesar el ataque. Feedback inmediato y disengage para evitar spam.
    if (result.error === 'no_ammo') {
      feedLog('warning', 'Sin flechas. Equipa o consigue munición.');
      disengage();
      return;
    }
    // Sesión 41 — errores de magia: avisar al jugador (antes era disengage mudo).
    if (result.error === 'no_mana') {
      feedLog('warning', `Sin maná suficiente (${result.mana_current ?? 0}/${result.mana_cost} para el hechizo). Espera a que regenere.`);
      disengage();
      return;
    }
    if (result.error === 'magic_level_too_low') {
      feedLog('warning', `Necesitas nivel ${result.required} de Magia para ese hechizo.`);
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

  if (typeof window !== 'undefined' && typeof window.__playerPlayAttack === 'function') {
    try {
      const animResult = window.__playerPlayAttack(
        uiSelectedStance,
        result.weapon_type,
        result.cooldown_ms
      );
      clog('playAttack(npc) →', animResult, '| weapon:', result.weapon_type, 'stance:', uiSelectedStance);
    } catch {}
  }

  // Sesión 34 — Si fue un ataque ranged (server consumió una flecha), disparar
  // el proyectil visual del player → NPC.
  // Sesión 35 — Stub reemplazado por mesh real de flecha (arrow.glb).
  // Sesión 36 — windupMs=200ms sincroniza la flecha con el frame de release
  // de Bow_Recoil. Sin esto, la flecha aparecía al inicio de Bow_Overdraw
  // (visualmente: salía ANTES de que el char la soltara). El valor 200 matchea
  // BOW_OVERDRAW_MS en character.js — si cambia uno cambian los dos.
  if (result.arrow_consumed && npc && typeof window !== 'undefined' &&
      typeof window.__worldFireProjectile === 'function') {
    try {
      const playerPos = window.__getPlayerPosition?.();
      if (playerPos) {
        window.__worldFireProjectile(
          { x: playerPos.x, y: 0, z: playerPos.z },
          { x: npc.x, y: 0, z: npc.z },
          { type: 'arrow', arrowItemId: result.arrow_consumed.item_id, windupMs: 200 }
        );
      }
    } catch {}
  }

  // Sesión 35 — Sync del inv local cuando el server consume una flecha.
  // Server es source-of-truth en DB, pero el cliente necesita reflejar el
  // cambio visualmente sin un refresh() completo del inv. Si source es
  // 'inventory', restamos 1 al stack local. Si es 'quiver', no hay UI de
  // quiver todavía (Bloque 8 polish), así que es no-op.
  // Sin esto, el contador del inv quedaba "pegado" en su valor inicial y
  // las flechas solo "desaparecían" al re-login (bug visto en S35 smoke test).
  if (result.arrow_consumed && result.arrow_consumed.source === 'inventory') {
    try { inventory.decrementItem(result.arrow_consumed.item_id, 1); } catch {}
  }

  if (result.your_hit) {
    if (result.is_crit) {
      feedLog('hit', `⚡ ¡CRÍTICO! Golpe demoledor a ${npcName}: ${result.your_damage} HP.`);
    } else {
      feedLog('hit', `Le pegas a ${npcName} y le quitas ${result.your_damage} HP.`);
    }
    // Sesión 32 — SFX hit. Solo en hits que conectan (los misses tendrán
    // su propio SFX más adelante cuando lo tengamos en R2).
    try { audio.sfx('hit_blade'); } catch {}
    if (typeof window !== 'undefined' && typeof window.__worldFlashNpcHit === 'function') {
      try { window.__worldFlashNpcHit(npcId); } catch {}
    }
  } else {
    feedLog('miss', `Fallas a ${npcName}.`);
  }
  if (typeof window !== 'undefined' && typeof window.__worldSpawnHitsplat === 'function') {
    try { window.__worldSpawnHitsplat(npcId, result.your_damage || 0); } catch {}
  }
  // Sesión 39 — Pieza 1: marcar este hit como LOCAL para que el feedback
  // derivado del snapshot (que ven los demás jugadores) no se lo duplique a
  // este cliente, que ya mostró el hitsplat al instante arriba.
  if (typeof window !== 'undefined' && typeof window.__worldMarkLocalHit === 'function') {
    try { window.__worldMarkLocalHit(npcId); } catch {}
  }

  if (typeof window !== 'undefined' && typeof window.__spawnXpDrops === 'function' && result.xp_gained) {
    try { window.__spawnXpDrops(result.xp_gained); } catch {}
  }

  if (result.npc_hit !== null && result.npc_hit !== undefined) {
    if (result.npc_hit) feedLog('player-hit', `${npcName} te pega ${result.npc_damage} HP.`);
    else feedLog('player-miss', `${npcName} falla el ataque.`);

    if (typeof window !== 'undefined' && typeof window.__spawnPlayerSplat === 'function') {
      try { window.__spawnPlayerSplat(result.npc_damage || 0, result.npc_hit); } catch {}
    }
  }

  if (result.level_ups && result.level_ups.length) {
    for (const skill of result.level_ups) {
      const lvl = result.your_levels[skill];
      feedLog('levelup', `¡Subes a nivel ${lvl} de ${skillLabel(skill)}!`);
    }
    if (typeof window !== 'undefined' && typeof window.__spawnLevelUpBanner === 'function') {
      const firstSkill = result.level_ups[0];
      const mappedId = SKILL_ID_MAP[firstSkill] || firstSkill;
      const lvl = result.your_levels[firstSkill];
      try { window.__spawnLevelUpBanner(mappedId, lvl); } catch {}
    }
  }

  const gotXp = result.xp_gained && (
    result.xp_gained.attack > 0 ||
    result.xp_gained.strength > 0 ||
    result.xp_gained.defence > 0 ||
    result.xp_gained.hp > 0 ||
    // Sesión 35 — Agregadas las 3 nuevas skills de combate. Sin esto, un
    // ataque ranged puro (solo ranged_xp > 0, todos los otros 0) hacía que
    // gotXp diera false y skills.reload() no se llamara, dejando el panel
    // del cliente "pegado" al valor cacheado. Magic y prayer se incluyen
    // ahora para no tener el mismo bug cuando lleguen en días 8-12.
    result.xp_gained.ranged > 0 ||
    result.xp_gained.magic > 0 ||
    result.xp_gained.prayer > 0
  );
  if (gotXp) {
    skills.reload().catch(e => console.warn('[combat] skills reload:', e));
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
    feedLog('death', 'Has muerto. Toca el botón para volver al spawn.');
    if (typeof window !== 'undefined' && typeof window.__playerDeath === 'function') {
      try { window.__playerDeath(); } catch {}
    }
    showDeathOverlay();
    disengage();
    await refresh();
    return;
  }

  const nextTickMs = (result && typeof result.cooldown_ms === 'number')
    ? result.cooldown_ms
    : TICK_MS;
  if (gen === attackGen) attackTimer = setTimeout(() => doAttackTick(gen), nextTickMs);
}

// ============================================================
// Sesión 27 Bloque 3 — Tick PVP (target = otro player)
// ============================================================
async function doAttackTickPlayer(gen = attackGen) {
  if (currentTargetPlayerId === null) return;
  if (gen !== attackGen) return;   // Sesión 39 — target cambió antes de empezar

  // Sesión 33 día 2 — mismo canAttack check que en doAttackTickNpc.
  let canAttackResult = { ok: true };
  try { canAttackResult = combatStyles.getActiveStyle().canAttack(); }
  catch (e) { console.warn('[combat] canAttack threw, defaulting to ok:', e); }
  if (!canAttackResult.ok) {
    feedLog('warning', canAttackResult.message || 'No puedes atacar ahora.');
    disengage();
    return;
  }

  const targetId = currentTargetPlayerId;
  let result;
  try {
    let pos = null;
    try {
      const p = window.__getPlayerPosition?.();
      if (p && Number.isFinite(p.x) && Number.isFinite(p.z)) pos = p;
    } catch {}
    // Sesión 27 Bloque 3 fix — Pos visual del target tal como la veo yo
    // (la interpolada del peer en multiplayer.js). Server la valida
    // contra la pos persistida y la usa si es plausible.
    let targetVisualPos = null;
    try {
      targetVisualPos = multiplayer.getPeerVisualPosition?.(targetId);
    } catch {}
    result = await api.attackPlayer(targetId, pos, targetVisualPos);
    try { worldSnapshot.markCombatActivity?.(); } catch {}  // Sesión 41 — poll rápido en PvP
  } catch (err) {
    if (err.code) {
      result = { error: err.code, ...(err.cooldown_remaining_ms ? { cooldown_remaining_ms: err.cooldown_remaining_ms } : {}) };
    } else {
      disengage();
      if (isTabOpen) render();
      return;
    }
  }

  // Sesión 39 — fix exploit multi-click (PVP): abortar si el target cambió
  // durante el await. Mismo razonamiento que en doAttackTickNpc.
  if (gen !== attackGen || currentTargetPlayerId !== targetId) return;

  if (result.error) {
    if (result.error === 'on_cooldown') {
      const wait = (result.cooldown_remaining_ms || TICK_MS) + 50;
      if (gen === attackGen) attackTimer = setTimeout(() => doAttackTick(gen), wait);
      return;
    }
    if (result.error === 'out_of_range') {
      feedLog('warning', 'Fuera de rango. Acércate.');
      disengage();
      return;
    }
    if (result.error === 'not_in_wilderness') {
      // Legacy S27 — el server S28 ya no devuelve este código pero
      // mantenemos handler por si algún flujo viejo lo dispara.
      const who = result.reason === 'target' ? 'tu objetivo está' : 'estás';
      feedLog('warning', `No puedes atacar: ${who} fuera del Wilderness.`);
      disengage();
      return;
    }
    if (result.error === 'not_in_wilderness_no_duel') {
      // Sesión 28 — fuera de wilderness solo PVP si hay duelo activo.
      const who = result.reason === 'target' ? 'tu objetivo está' : 'estás';
      feedLog('warning', `${who} fuera del Wilderness. Reta a duelo o entrad ambos al wild.`);
      disengage();
      return;
    }
    if (result.error === 'same_party') {
      feedLog('warning', 'No puedes atacar a un miembro de tu grupo.');
      disengage();
      return;
    }
    if (result.error === 'target_dead' || result.error === 'target_not_found') {
      disengage();
      await refresh();
      return;
    }
    if (result.error === 'user_dead' || result.error === 'cannot_attack_self') {
      disengage();
      await refresh();
      return;
    }
    disengage();
    return;
  }

  const peer = multiplayer.getPeerById?.(targetId);
  const targetName = peer?.username || 'el jugador';

  // Animación de swing del player (igual que NPC)
  if (typeof window !== 'undefined' && typeof window.__playerPlayAttack === 'function') {
    try {
      const animResult = window.__playerPlayAttack(
        uiSelectedStance,
        result.weapon_type,
        result.cooldown_ms
      );
      clog('playAttack(pvp) →', animResult, '| weapon:', result.weapon_type, 'stance:', uiSelectedStance);
    } catch {}
  }

  // Mensaje de hit/miss
  if (result.your_hit) {
    if (result.is_crit) {
      feedLog('hit', `⚡ ¡CRÍTICO! ${targetName}: ${result.your_damage} HP.`);
    } else {
      feedLog('hit', `Le pegas a ${targetName}: ${result.your_damage} HP.`);
    }
    // Sesión 32 — SFX hit (igual que NPC)
    try { audio.sfx('hit_blade'); } catch {}
    // Flash visual sobre el peer
    if (typeof window !== 'undefined' && typeof window.__worldFlashPeerHit === 'function') {
      try { window.__worldFlashPeerHit(targetId); } catch {}
    }
  } else {
    feedLog('miss', `Fallas a ${targetName}.`);
  }
  // Hitsplat sobre el peer (gota roja / escudo azul)
  if (typeof window !== 'undefined' && typeof window.__worldSpawnPlayerHitsplat === 'function') {
    try { window.__worldSpawnPlayerHitsplat(targetId, result.your_damage || 0); } catch {}
  }

  // XP drops (igual que NPC)
  if (typeof window !== 'undefined' && typeof window.__spawnXpDrops === 'function' && result.xp_gained) {
    try { window.__spawnXpDrops(result.xp_gained); } catch {}
  }

  // Contraataque del target sobre nosotros
  if (result.target_hit !== null && result.target_hit !== undefined) {
    if (result.target_hit) feedLog('player-hit', `${targetName} te pega ${result.target_damage} HP.`);
    else feedLog('player-miss', `${targetName} falla el ataque.`);
    if (typeof window !== 'undefined' && typeof window.__spawnPlayerSplat === 'function') {
      try { window.__spawnPlayerSplat(result.target_damage || 0, result.target_hit); } catch {}
    }
  }

  // Level ups (igual que NPC)
  if (result.level_ups && result.level_ups.length) {
    for (const skill of result.level_ups) {
      const lvl = result.your_levels[skill];
      feedLog('levelup', `¡Subes a nivel ${lvl} de ${skillLabel(skill)}!`);
    }
    if (typeof window !== 'undefined' && typeof window.__spawnLevelUpBanner === 'function') {
      const firstSkill = result.level_ups[0];
      const mappedId = SKILL_ID_MAP[firstSkill] || firstSkill;
      const lvl = result.your_levels[firstSkill];
      try { window.__spawnLevelUpBanner(mappedId, lvl); } catch {}
    }
  }

  const gotXp = result.xp_gained && (
    result.xp_gained.attack > 0 ||
    result.xp_gained.strength > 0 ||
    result.xp_gained.defence > 0 ||
    result.xp_gained.hp > 0 ||
    // Sesión 35 — Mismo fix que en el path NPC (ver arriba). Aplica acá
    // también para cuando hagamos PvP ranged (hoy B-012 — diferido a Bloque 3).
    result.xp_gained.ranged > 0 ||
    result.xp_gained.magic > 0 ||
    result.xp_gained.prayer > 0
  );
  if (gotXp) {
    skills.reload().catch(e => console.warn('[combat] skills reload:', e));
  }

  // Update local stats
  if (state) {
    state.stats.hp_current = result.your_hp;
    state.stats.hp_max = result.your_hp_max;
    state.stats.attack.level = result.your_levels.attack;
    state.stats.strength.level = result.your_levels.strength;
    state.stats.defence.level = result.your_levels.defence;
    state.stats.hp.level = result.your_levels.hp;
  }
  updateHpHud();
  if (isTabOpen) render();
  notify();

  // Target murió
  if (result.target_killed) {
    feedLog('kill', `¡Has matado a ${targetName}!`);
    disengage();
    await refresh();
    return;
  }
  // Yo morí
  if (result.you_died) {
    feedLog('death', `Has caído ante ${targetName}. Toca el botón para volver al spawn.`);
    if (typeof window !== 'undefined' && typeof window.__playerDeath === 'function') {
      try { window.__playerDeath(); } catch {}
    }
    showDeathOverlay();
    disengage();
    await refresh();
    return;
  }

  // Siguiente tick
  const nextTickMs = (result && typeof result.cooldown_ms === 'number')
    ? result.cooldown_ms
    : TICK_MS;
  if (gen === attackGen) attackTimer = setTimeout(() => doAttackTick(gen), nextTickMs);
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

// Sesión 41 — Diagnóstico del auto-ataque/retaliate. Activar en Eruda con
// window.__combatDebug(true). Loguea CADA decisión del flujo de combate para
// ver exactamente qué dispara un ataque y si la animación se ejecutó o se
// bloqueó. Solo loguea — no cambia comportamiento.
let _combatDebug = false;
function clog(...args) {
  if (_combatDebug) console.log('%c[combat-dbg]', 'color:#e0a030', ...args);
}
if (typeof window !== 'undefined') {
  window.__combatDebug = (on = true) => {
    _combatDebug = !!on;
    window.__combatDebugOn = _combatDebug;   // visible para hooks en world.js
    console.log('[combat-dbg]', _combatDebug ? 'ON — reproducí el bug ahora' : 'OFF');
    console.log('[combat-dbg] estado actual:', {
      autoRetaliate,
      currentTargetNpcId,
      currentTargetPlayerId,
    });
    return _combatDebug;
  };
}

// ============================================================
// Sesión 27 Bloque 3 — AUTO RETALIATE real
// ============================================================
//
// Loop que cada 300ms comprueba el snapshot global y, si:
//   - autoRetaliate=ON
//   - currentTargetNpcId === null && currentTargetPlayerId === null
//   - me.last_attacker existe y es reciente (<5s desde el último ataque)
// entonces engagea automáticamente al atacante (NPC o player según
// type del log).
//
// Esto reproduce el Auto Retaliate de OSRS: si te pegan y está ON,
// devuelves el golpe sin necesidad de tocar nada. Para parar:
//   - mover joystick (combat se cancela en world.js)
//   - tocar otro target (combat cambia el currentTarget)
//   - apagar Auto Retaliate desde el tab.
//
const AUTO_RETALIATE_CHECK_MS = 300;
const AUTO_RETALIATE_FRESHNESS_MS = 5000;
let autoRetaliateTimer = null;
let lastAutoEngagedAttackerKey = null;   // anti-loop: no re-engagear al mismo

function startAutoRetaliateLoop() {
  if (autoRetaliateTimer) return;
  autoRetaliateTimer = setInterval(tryAutoRetaliate, AUTO_RETALIATE_CHECK_MS);
}

function stopAutoRetaliateLoop() {
  if (autoRetaliateTimer) { clearInterval(autoRetaliateTimer); autoRetaliateTimer = null; }
}

function tryAutoRetaliate() {
  if (!autoRetaliate) return;
  // Ya tengo target → no engagear nada nuevo.
  if (currentTargetNpcId !== null || currentTargetPlayerId !== null) return;
  // Estoy muerto → no atacar
  if (state?.stats?.hp_current === 0) return;

  const me = worldSnapshot.getMe?.();
  const atk = me?.last_attacker;
  if (!atk) return;
  // Fresco?
  const serverNow = worldSnapshot.getServerNow?.();
  if (!serverNow || (serverNow - atk.at) > AUTO_RETALIATE_FRESHNESS_MS) return;

  // Anti-loop: si ya engagee a este atacante en este "incidente", no repetir
  // hasta que el snapshot diga "nuevo ataque" (at diferente).
  const key = `${atk.type}:${atk.id}:${atk.at}`;
  if (key === lastAutoEngagedAttackerKey) return;
  lastAutoEngagedAttackerKey = key;

  clog('tryAutoRetaliate → ENGAGE (retaliate ON). atacante:', atk);
  if (atk.type === 1) {
    // NPC me atacó → engagear NPC (atk.id es npc_instance_id)
    engageNpc(atk.id).catch(e => console.warn('[auto-retaliate npc]', e));
  } else if (atk.type === 0) {
    // Player me atacó → engagear player
    engagePlayer(atk.id).catch(e => console.warn('[auto-retaliate player]', e));
  }
}

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
  // Sesión 34 — Display name dinámico. Si hay un arma equipada, mostrar
  // el name real del item (ej. "Arco de roble", "Sword of bronze").
  // Si no hay arma o el item no tiene name, fallback al name hardcoded
  // del WEAPON_STANCES (que es típicamente "Unarmed" para puños vacíos).
  const equippedWeaponItem = equipment.getEquipped?.('weapon');
  const weaponDisplayName = equippedWeaponItem?.name || weapon.name;
  const serverStance = state.combat_style || 'accurate';
  // Sincronizar uiSelectedStance con server stance si no hay selección local
  if (!uiSelectedStance || !weapon.stances.find(s => s.id === uiSelectedStance)) {
    uiSelectedStance = uiStanceFromServer(weaponKey, serverStance);
  }
  const combatLvl = computeCombatLvl(s);

  panelEl.innerHTML = `
    <div class="combat-osrs">
      <div class="combat-osrs-header">
        <div class="combat-osrs-weapon">${escapeHtml(weaponDisplayName)}</div>
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
    // Sesión 26 — Antes era 'click'. En mobile el 'click' tarda 300ms y si
    // el joystick está activo (player corriendo) la mayoría de pointerdowns
    // se cancelan y el click nunca llega. pointerup dispara antes y de
    // forma fiable, así puedes cambiar de stance/atacar en movimiento.
    el.addEventListener('pointerup', async (ev) => {
      if (ev.button !== undefined && ev.button !== 0) return;
      ev.preventDefault();
      ev.stopPropagation();
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
        clog('toggle-retaliate → autoRetaliate =', autoRetaliate);
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

    /* Sesión 38 (fix v3) — El escalado desktop NO se hace por elemento (eso
       desproporcionaba los iconos). Ahora se hace con zoom uniforme sobre todo
       el sidebar (ver world.js / style.css), que escala marco + iconos + texto
       en la MISMA proporción que mobile. Por eso aquí no hay overrides. */
  `;
  document.head.appendChild(style);
}

// ============================================================
// UTILS
// ============================================================

function pctFill(cur, max) { return max > 0 ? Math.max(0, Math.min(100, Math.round((cur / max) * 100))) : 0; }
function skillLabel(key) { return { attack: 'Ataque', strength: 'Fuerza', defence: 'Defensa', hp: 'Vitalidad', ranged: 'Distancia', magic: 'Magia', prayer: 'Oración' }[key] || key; }
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

// ============================================================
// Sesión 25 — Death overlay (OSRS-style)
// ============================================================
/**
 * Pinta un overlay grande sobre la pantalla cuando el user muere.
 * Botón "⚱ Volver al spawn" llama respawnUser, recarga inventario
 * (por el drop) y dispara __playerRevive para teleportar visual.
 *
 * Mientras el overlay está visible, el botón es lo único interactivo
 * (el resto del juego sigue corriendo pero el user no puede jugar
 * porque __playerDeath ya bloqueó el input vía character.isDead).
 */
export function showDeathOverlay() {
  // No duplicar
  if (document.getElementById('deathOverlay')) return;

  // Inyectar CSS una vez
  if (!document.getElementById('death-overlay-styles')) {
    const style = document.createElement('style');
    style.id = 'death-overlay-styles';
    style.textContent = `
      .death-overlay {
        position: fixed; inset: 0; z-index: 9000;
        background: radial-gradient(ellipse at center,
          rgba(80, 10, 10, 0.55) 0%, rgba(10, 0, 0, 0.92) 70%);
        display: flex; flex-direction: column;
        align-items: center; justify-content: center;
        animation: deathFadeIn 0.6s ease-out;
        pointer-events: auto;
      }
      @keyframes deathFadeIn {
        from { opacity: 0; }
        to   { opacity: 1; }
      }
      .death-overlay-title {
        font-family: 'Cinzel', serif;
        font-size: 42px;
        font-weight: 900;
        color: #ff5040;
        letter-spacing: 0.12em;
        text-shadow: 0 0 24px rgba(255, 60, 40, 0.6),
                     0 4px 8px rgba(0,0,0,0.9);
        margin-bottom: 20px;
        text-align: center;
        animation: deathTitlePulse 2.4s ease-in-out infinite;
      }
      @keyframes deathTitlePulse {
        0%, 100% { transform: scale(1); }
        50%      { transform: scale(1.04); }
      }
      .death-overlay-subtitle {
        font-family: 'IM Fell English', serif;
        font-size: 16px;
        color: #d8b878;
        text-align: center;
        margin-bottom: 36px;
        max-width: 320px;
        line-height: 1.5;
        text-shadow: 0 2px 4px rgba(0,0,0,0.9);
      }
      .death-overlay-btn {
        padding: 14px 36px;
        background: linear-gradient(180deg, #c84830, #802018);
        border: 3px solid #ffaa44;
        color: #fff8d0;
        font-family: 'Cinzel', serif;
        font-weight: 700;
        font-size: 18px;
        letter-spacing: 0.06em;
        border-radius: 6px;
        cursor: pointer;
        box-shadow: 0 0 20px rgba(255, 100, 50, 0.55),
                    inset 0 1px 0 rgba(255,255,255,0.2);
        -webkit-tap-highlight-color: transparent;
        transition: transform 0.1s;
      }
      .death-overlay-btn:active {
        transform: scale(0.96);
        box-shadow: 0 0 10px rgba(255, 100, 50, 0.4);
      }
    `;
    document.head.appendChild(style);
  }

  const overlay = document.createElement('div');
  overlay.id = 'deathOverlay';
  overlay.className = 'death-overlay';
  overlay.innerHTML = `
    <div class="death-overlay-title">HAS MUERTO</div>
    <div class="death-overlay-subtitle">
      Conservas tus 3 ítems más valiosos.<br>
      El resto cayó al suelo donde moriste.
    </div>
    <button class="death-overlay-btn" id="deathRespawnBtn">⚱ Volver al spawn</button>
  `;
  document.body.appendChild(overlay);

  const btn = overlay.querySelector('#deathRespawnBtn');
  btn.addEventListener('pointerup', async (ev) => {
    if (ev.button !== undefined && ev.button !== 0) return;
    ev.preventDefault();
    btn.disabled = true;
    btn.textContent = 'Respawneando…';
    try {
      await api.respawnUser();
      // Refrescar combat state (HP a tope, posición server)
      await refresh();
      // Revive visual: anim idle + teleport al spawn
      if (typeof window !== 'undefined' && typeof window.__playerRevive === 'function') {
        try { window.__playerRevive(); } catch {}
      }
      // Refrescar inventory para que reflejen los items que CAYERON
      // (dropExcessInventoryOnDeath quitó slots; sin refresh, el cliente
      // seguiría mostrando lo que tenía antes).
      if (typeof window !== 'undefined' && window.inventory?.refresh) {
        try { await window.inventory.refresh(); } catch (e) { console.warn('[combat/respawn] inv refresh:', e); }
      }
      feedLog('info', '¡Estás de vuelta en el spawn!');
    } catch (e) {
      feedLog('warning', 'No se pudo respawnear: ' + (e.message || e));
      btn.disabled = false;
      btn.textContent = '⚱ Volver al spawn';
      return;
    }
    hideDeathOverlay();
  });
}

function hideDeathOverlay() {
  const overlay = document.getElementById('deathOverlay');
  if (overlay) overlay.remove();
}
