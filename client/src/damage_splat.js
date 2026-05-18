/**
 * SebasPresent — Damage Splat / XP Drops / Level Up Banner (Sesión 17)
 *
 * Tres componentes visuales sincronizados al combate:
 *
 *   1. spawnXpDrop(skillId, amount)
 *      Flotante "+5 Ataque XP" arriba a la izquierda del minimapa que sube
 *      y hace fade out en 1.5s. Múltiples drops simultáneos se apilan.
 *
 *   2. spawnLevelUpBanner(skillName, newLevel)
 *      Banner grande centrado tipo OSRS: "¡Has subido a Nivel X de Ataque!".
 *      Dura 3s con fade in/out + escala. Suena el jingle de level_up (ya en
 *      audio.js).
 *
 *   3. La lógica de damage splats sobre NPCs/player NO va aquí — ya existe
 *      en npc_renderer.js vía window.__worldSpawnHitsplat. Solo añadimos
 *      el splat sobre EL PROPIO PLAYER cuando recibimos daño, vía
 *      spawnPlayerDamageSplat(damage, hit).
 *
 * Diseño visual:
 *   - XP drop: pildora dorada con icono skill + número
 *   - Level up: banner centrado con borde dorado, animación pulse
 *   - Player splat: cuadrado rojo OSRS clásico sobre el sprite del player
 *
 * No requiere Three.js — todo DOM/CSS para evitar dependencias.
 */

import * as skills from './skills.js';
import { getSkillIconHtml } from './item_icons.js';

// ============================================================
// Estado
// ============================================================
let xpStackEl = null;     // contenedor donde se apilan los XP drops
let bannerEl = null;      // banner reutilizable para level up
let playerSplatLayerEl = null; // capa fija sobre el player para splats recibidos

let started = false;
let getPlayerWorldPos = null; // función provista por world para saber dónde dibujar el splat del player
let getCameraProjection = null;

// ============================================================
// API pública
// ============================================================

export function start(opts = {}) {
  if (started) return;
  getPlayerWorldPos = opts.getPlayerWorldPos || null;
  getCameraProjection = opts.getCameraProjection || null;
  injectStyles();
  ensureXpStack();
  ensureBanner();
  ensurePlayerSplatLayer();
  started = true;
  console.log('[damage_splat] start OK');
}

export function stop() {
  if (!started) return;
  if (xpStackEl) { xpStackEl.remove(); xpStackEl = null; }
  if (bannerEl) { bannerEl.remove(); bannerEl = null; }
  if (playerSplatLayerEl) { playerSplatLayerEl.remove(); playerSplatLayerEl = null; }
  started = false;
}

/**
 * Spawna un XP drop flotante. amount es entero (positivo).
 * skillId debe estar en skills.SKILL_DEFS_BY_ID.
 */
export function spawnXpDrop(skillId, amount) {
  if (!started || amount <= 0) return;
  ensureXpStack();
  const def = skills.SKILL_DEFS_BY_ID[skillId];
  if (!def) return;
  const el = document.createElement('div');
  el.className = 'xp-drop';
  el.innerHTML = `<span class="xp-drop-icon">${getSkillIconHtml(def.id, def.icon)}</span><span class="xp-drop-amount">+${amount}</span><span class="xp-drop-skill">${def.name}</span>`;
  xpStackEl.appendChild(el);
  // Animar con CSS: la animación dura 1500ms, luego se elimina
  setTimeout(() => { try { el.remove(); } catch {} }, 1600);
}

/**
 * Spawna 1+ XP drops a partir de un objeto {skill_id: amount, ...}.
 * Para el caso típico de combate controlled: cuatro splats apilados.
 */
export function spawnXpDrops(xpMap) {
  if (!xpMap) return;
  // xp_gained del server viene como { attack, strength, defence, hp }
  // mapeo a skill_ids reales.
  const map = {
    attack: 'attack',
    strength: 'strength',
    defence: 'defence',
    hp: 'hitpoints',
  };
  for (const [key, amount] of Object.entries(xpMap)) {
    if (!amount || amount <= 0) continue;
    const skillId = map[key] || key;
    spawnXpDrop(skillId, amount);
  }
}

/**
 * Banner grande centrado: "¡Subiste al nivel X de Ataque!".
 */
export function spawnLevelUpBanner(skillId, newLevel) {
  if (!started) return;
  ensureBanner();
  const def = skills.SKILL_DEFS_BY_ID[skillId];
  const skillName = def?.name || skillId;
  const iconHtml = def ? getSkillIconHtml(def.id, def.icon) : '⭐';
  bannerEl.innerHTML = `
    <div class="lvup-icon">${iconHtml}</div>
    <div class="lvup-text">¡Has subido al<br><b>Nivel ${newLevel}</b> de <b>${skillName}</b>!</div>
  `;
  bannerEl.classList.remove('visible');
  // Reflow para reset animation
  // eslint-disable-next-line no-unused-expressions
  void bannerEl.offsetWidth;
  bannerEl.classList.add('visible');
  setTimeout(() => bannerEl.classList.remove('visible'), 3000);
}

/**
 * Splat sobre el player cuando recibe daño. damage=0 + hit=false → splat azul "0".
 * damage>0 → splat rojo con número.
 * Llamado desde combat.js con la respuesta del server.
 */
export function spawnPlayerDamageSplat(damage, hit) {
  if (!started) return;
  ensurePlayerSplatLayer();
  if (!getPlayerWorldPos || !getCameraProjection) return;
  const proj = getCameraProjection();
  if (!proj || proj.behind) return;

  const splat = document.createElement('div');
  splat.className = 'dmg-splat ' + (hit && damage > 0 ? 'dmg-hit' : 'dmg-miss');
  splat.textContent = String(damage || 0);
  splat.style.left = proj.x + 'px';
  splat.style.top = proj.y + 'px';
  playerSplatLayerEl.appendChild(splat);
  setTimeout(() => { try { splat.remove(); } catch {} }, 900);
}

// ============================================================
// Internals
// ============================================================

function injectStyles() {
  if (document.getElementById('damage-splat-styles')) return;
  const style = document.createElement('style');
  style.id = 'damage-splat-styles';
  style.textContent = `
    /* ============ XP Drops Stack ============ */
    .xp-drop-stack {
      position: fixed;
      top: calc(env(safe-area-inset-top, 0px) + 156px);
      right: 8px;
      z-index: 35;
      display: flex;
      flex-direction: column;
      gap: 4px;
      pointer-events: none;
      align-items: flex-end;
    }
    .xp-drop {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 5px 10px;
      background: rgba(20, 14, 8, 0.92);
      border: 1.5px solid #c8a043;
      border-radius: 999px;
      color: #ffd060;
      font-family: 'IM Fell English', serif;
      font-size: 13px;
      font-weight: bold;
      text-shadow: 1px 1px 0 #000, -1px 1px 0 #000, 1px -1px 0 #000, -1px -1px 0 #000;
      box-shadow: 0 3px 8px rgba(0,0,0,0.6), 0 0 12px rgba(200,160,67,0.3);
      animation: xpDropFloat 1.5s ease-out forwards;
      white-space: nowrap;
    }
    .xp-drop-icon { font-size: 14px; filter: drop-shadow(0 1px 1px rgba(0,0,0,0.7)); }
    .xp-drop-amount { color: #fff8d0; }
    .xp-drop-skill { font-size: 10px; opacity: 0.85; }
    @keyframes xpDropFloat {
      0%   { opacity: 0; transform: translateY(8px) scale(0.85); }
      15%  { opacity: 1; transform: translateY(0) scale(1.05); }
      25%  { opacity: 1; transform: translateY(-4px) scale(1); }
      80%  { opacity: 1; transform: translateY(-30px) scale(1); }
      100% { opacity: 0; transform: translateY(-44px) scale(0.95); }
    }

    /* ============ Level Up Banner ============ */
    .lvup-banner {
      position: fixed;
      top: 32%;
      left: 50%;
      transform: translate(-50%, -50%) scale(0.6);
      z-index: 110;
      background: linear-gradient(180deg, rgba(40, 25, 15, 0.97), rgba(20, 14, 8, 0.97));
      border: 3px solid #ffd060;
      border-radius: 8px;
      padding: 20px 32px;
      color: #fff8d0;
      font-family: 'Cinzel', serif;
      text-align: center;
      box-shadow: 0 0 40px rgba(255, 208, 96, 0.5), 0 12px 40px rgba(0,0,0,0.8);
      opacity: 0;
      pointer-events: none;
      transition: opacity 0.4s, transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
      max-width: 90vw;
    }
    .lvup-banner.visible {
      opacity: 1;
      transform: translate(-50%, -50%) scale(1);
      animation: lvupPulse 1.5s ease-in-out infinite;
    }
    @keyframes lvupPulse {
      0%, 100% { box-shadow: 0 0 40px rgba(255, 208, 96, 0.5), 0 12px 40px rgba(0,0,0,0.8); }
      50%      { box-shadow: 0 0 60px rgba(255, 208, 96, 0.85), 0 12px 40px rgba(0,0,0,0.8); }
    }
    .lvup-icon {
      font-size: 38px;
      margin-bottom: 6px;
      filter: drop-shadow(0 2px 8px rgba(255,200,80,0.6));
    }
    .lvup-text {
      font-size: 16px;
      letter-spacing: 0.04em;
      line-height: 1.4;
      text-shadow: 0 2px 6px rgba(0,0,0,0.9);
    }
    .lvup-text b {
      color: #ffd060;
      font-size: 18px;
    }

    /* ============ Player Damage Splat ============ */
    .player-splat-layer {
      position: fixed;
      inset: 0;
      pointer-events: none;
      z-index: 22;
      overflow: hidden;
    }
    .dmg-splat {
      position: absolute;
      transform: translate(-50%, -50%);
      width: 26px;
      height: 26px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-family: 'IM Fell English', serif;
      font-weight: bold;
      font-size: 14px;
      color: #fff;
      text-shadow: 1px 1px 0 #000, -1px 1px 0 #000, 1px -1px 0 #000, -1px -1px 0 #000;
      animation: splatFloat 0.9s ease-out forwards;
      box-shadow: 0 2px 4px rgba(0,0,0,0.6);
    }
    .dmg-hit  { background: #c83030; border: 1.5px solid #800; }
    .dmg-miss { background: #3060b0; border: 1.5px solid #114; }
    @keyframes splatFloat {
      0%   { opacity: 0; transform: translate(-50%, -50%) scale(0.4); }
      15%  { opacity: 1; transform: translate(-50%, -55%) scale(1.15); }
      30%  { opacity: 1; transform: translate(-50%, -60%) scale(1); }
      100% { opacity: 0; transform: translate(-50%, -120%) scale(1); }
    }
  `;
  document.head.appendChild(style);
}

function ensureXpStack() {
  if (xpStackEl) return xpStackEl;
  xpStackEl = document.createElement('div');
  xpStackEl.id = 'xpDropStack';
  xpStackEl.className = 'xp-drop-stack';
  document.body.appendChild(xpStackEl);
  return xpStackEl;
}

function ensureBanner() {
  if (bannerEl) return bannerEl;
  bannerEl = document.createElement('div');
  bannerEl.id = 'lvupBanner';
  bannerEl.className = 'lvup-banner';
  document.body.appendChild(bannerEl);
  return bannerEl;
}

function ensurePlayerSplatLayer() {
  if (playerSplatLayerEl) return playerSplatLayerEl;
  playerSplatLayerEl = document.createElement('div');
  playerSplatLayerEl.id = 'playerSplatLayer';
  playerSplatLayerEl.className = 'player-splat-layer';
  document.body.appendChild(playerSplatLayerEl);
  return playerSplatLayerEl;
}
