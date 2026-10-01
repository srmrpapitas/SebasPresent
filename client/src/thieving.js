/**
 * SebasPresent — Robo (pickpocket), cliente · Sesión 50
 * Menú de pulsación larga: "🫳 Robar" en habitantes (y en jugadores desde
 * nivel 50). El servidor decide si te pillan; si pasa, aparecen guardias que
 * te persiguen: ¡huye! Funciona también montado (te bajas al robar).
 */
import * as api from './api.js';
import * as skills from './skills.js';
import { profileOf, PLAYER_STEAL_LEVEL, THIEF_SKILL, catchChance, playerCatchChance } from './shared/thieving.js';
import { onMessage } from './realtime.js';

let feedLog = () => {}, onInventoryChanged = () => {}, myId = null;
let busy = false;

function myLevel() { try { return skills.getLevel(THIEF_SKILL) || 1; } catch { return 1; } }

/** Texto para el menú: "🫳 Robar (nivel 15 · 25 %)" */
export function npcMenuLabel(npcId) {
  const P = profileOf(npcId), lv = myLevel();
  if (lv < P.level) return `🫳 Robar (nivel ${P.level} 🔒)`;
  const c = catchChance(lv, P.level);
  return `🫳 Robar (te pillan ${Math.round(c * 100)} %)`;
}
export function playerMenuLabel() {
  const lv = myLevel();
  if (lv < PLAYER_STEAL_LEVEL) return null;
  return `🫳 Robar (te pillan ${Math.round(playerCatchChance(lv) * 100)} %)`;
}

async function after(r) {
  if (r?.xp) { try { window.__spawnXpDrops?.({ [THIEF_SKILL]: r.xp }); } catch {} try { await skills.reload?.(); } catch {} }
  onInventoryChanged();
}

export async function stealNpc(npcId, name) {
  if (busy) return; busy = true;
  try { if (window.__mounts?.id?.()) window.__mounts.toggle(); } catch {}
  try { window.__playerGather?.('punching', 600); } catch {}
  try {
    const r = await api.tradeCall('/api/thieving/npc', { npc_id: npcId });
    if (r.caught) {
      feedLog('player-hit', `🚨 ${r.message}`);
      try { window.__playSfx?.('hit_blade'); } catch {}
    } else {
      feedLog('info', `🫳 Le robas a ${name}: ${r.qty > 1 ? r.qty + ' × ' : ''}${r.name}.`);
      try { window.__playSfx?.('coins'); } catch {}
    }
    await after(r);
  } catch (e) { feedLog('warning', `🫳 ${e.message}`); }
  finally { setTimeout(() => { busy = false; }, 400); }
}

export async function stealPlayer(userId, name) {
  if (busy) return; busy = true;
  try { if (window.__mounts?.id?.()) window.__mounts.toggle(); } catch {}
  try {
    const r = await api.tradeCall('/api/thieving/player', { target_user_id: userId });
    if (r.caught) feedLog('player-hit', `🚨 ${r.message}`);
    else if (r.empty) feedLog('info', `🫳 ${r.message}`);
    else { feedLog('info', `🫳 Le robas a ${name}: ${r.qty > 1 ? r.qty + ' × ' : ''}${r.name}.`); try { window.__playSfx?.('coins'); } catch {} }
    await after(r);
  } catch (e) { feedLog('warning', `🫳 ${e.message}`); }
  finally { setTimeout(() => { busy = false; }, 400); }
}

export function start(opts) {
  feedLog = opts.feedLog || (() => {});
  onInventoryChanged = opts.onInventoryChanged || (() => {});
  myId = opts.userId;
  onMessage((m) => {
    if (m.t !== 'theft' || m.to !== myId) return;
    if (m.caught) { feedLog('warning', `🚨 ¡${m.name} ha intentado robarte!`); try { window.__playSfx?.('book_open'); } catch {} }
    else onInventoryChanged();   // te han quitado algo sin que te enteres
  });
  if (typeof window !== 'undefined') window.__thieving = { stealNpc, stealPlayer, npcMenuLabel, playerMenuLabel };
}
