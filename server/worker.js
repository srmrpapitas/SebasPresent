/**
 * SebasPresent — Cloudflare Worker
 *
 * Solo router. La lógica vive en:
 *   - server/handlers/<dominio>.js — handlers HTTP por dominio
 *   - server/lib/<utility>.js      — db adapter, auth, cors
 *   - combat_engine.js, ge_engine.js, skills_engine.js — engines puros
 *
 * Endpoints:
 *   POST /api/register, /login, /me, /logout                   → handlers/auth.js
 *   GET  /api/position, POST /api/position                      → handlers/position.js
 *   GET  /api/inventory, POST /api/inventory/swap               → handlers/inventory.js
 *   GET  /api/bank, POST /api/bank/deposit /withdraw /swap      → handlers/bank.js
 *   GET  /api/ge/orders /item/:id /item/:id/history /search,
 *   POST /api/ge/place /cancel /claim_all                       → handlers/ge.js
 *   GET  /api/combat/state, POST /attack /respawn /style        → handlers/combat.js
 *   POST /api/world/heartbeat, GET /api/world/peers             → handlers/world.js
 *   GET  /api/world/snapshot                                    → handlers/snapshot.js (Sesión 27)
 *   POST /api/magic/home_teleport (+ /cancel /finish)           → handlers/home_teleport.js
 *   GET  /api/ground_items, POST /pickup                        → handlers/ground_items.js
 *   GET  /api/skills, POST /api/skills/grant                    → handlers/skills.js   (Sesión 14)
 *   GET  /api/equipment, POST /equip /unequip                   → handlers/equipment.js (Sesión 22)
 *   GET  /api/party/state, POST /invite /accept /decline /leave /kick → handlers/party.js (S27)
 *   GET  /api/duel/state,  POST /challenge /accept /decline /cancel /leave → handlers/duel.js (S28)
 *   GET  /api/chat/recent, POST /api/chat/send                  → handlers/chat.js (S29)
 *   POST /api/woodcutting/chop                                  → handlers/woodcutting.js (S30)
 *   POST /api/firemaking/light                                  → handlers/firemaking.js (S30)
 *   GET  /api/health
 *
 *   Cron (cada 1 min): GE matcher, NPC revive, ground_items cleanup,
 *                      shop restock, chat cleanup (>24h).
 */

import { json, corsResponse, withCors } from './lib/db.js';

// Handlers por dominio
import * as auth from './handlers/auth.js';
import * as position from './handlers/position.js';
import * as inventory from './handlers/inventory.js';
import * as bank from './handlers/bank.js';
import * as ge from './handlers/ge.js';
import * as combat from './handlers/combat.js';
import * as world from './handlers/world.js';
import * as snapshot from './handlers/snapshot.js';   // Sesión 27 Bloque 1
import * as homeTele from './handlers/home_teleport.js';
import * as groundItems from './handlers/ground_items.js';
import * as skills from './handlers/skills.js';
import * as equipment from './handlers/equipment.js';
import * as shop from './handlers/shop.js';
import * as party from './handlers/party.js';        // Sesión 27 Bloque 3 — Party
import * as duel from './handlers/duel.js';          // Sesión 28 — Duelos PVP no-wild
import * as chat from './handlers/chat.js';          // Sesión 29 — Chat global
import * as woodcutting from './handlers/woodcutting.js';  // Sesión 30
import * as firemaking from './handlers/firemaking.js';    // Sesión 30
import { scheduledHandler } from './handlers/cron.js';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return corsResponse(request, env);
    }

    try {
      let response;
      const path = url.pathname;
      const method = request.method;

      // ----- Auth -----
      if (path === '/api/register' && method === 'POST') {
        response = await auth.handleRegister(request, env);
      } else if (path === '/api/login' && method === 'POST') {
        response = await auth.handleLogin(request, env);
      } else if (path === '/api/me' && method === 'GET') {
        response = await auth.handleMe(request, env);
      } else if (path === '/api/logout' && method === 'POST') {
        response = await auth.handleLogout(request, env);

      // ----- Position -----
      } else if (path === '/api/position' && method === 'GET') {
        response = await position.handleGetPosition(request, env);
      } else if (path === '/api/position' && method === 'POST') {
        response = await position.handleSavePosition(request, env);

      // ----- Inventory -----
      } else if (path === '/api/inventory' && method === 'GET') {
        response = await inventory.handleGetInventory(request, env);
      } else if (path === '/api/inventory/swap' && method === 'POST') {
        response = await inventory.handleSwapInventory(request, env);

      // ----- Bank -----
      } else if (path === '/api/bank' && method === 'GET') {
        response = await bank.handleGetBank(request, env);
      } else if (path === '/api/bank/deposit' && method === 'POST') {
        response = await bank.handleBankDeposit(request, env);
      } else if (path === '/api/bank/withdraw' && method === 'POST') {
        response = await bank.handleBankWithdraw(request, env);
      } else if (path === '/api/bank/swap' && method === 'POST') {
        response = await bank.handleBankSwap(request, env);

      // ----- Grand Exchange -----
      } else if (path === '/api/ge/orders' && method === 'GET') {
        response = await ge.handleGeGetOrders(request, env);
      } else if (path === '/api/ge/place' && method === 'POST') {
        response = await ge.handleGePlace(request, env);
      } else if (path === '/api/ge/cancel' && method === 'POST') {
        response = await ge.handleGeCancel(request, env);
      } else if (path === '/api/ge/claim_all' && method === 'POST') {
        response = await ge.handleGeClaimAll(request, env);
      } else if (path === '/api/ge/search' && method === 'GET') {
        response = await ge.handleGeSearch(request, env);
      } else if (path.startsWith('/api/ge/item/') && path.endsWith('/history') && method === 'GET') {
        const itemId = path.split('/')[4];
        response = await ge.handleGeItemHistory(request, env, itemId);
      } else if (path.startsWith('/api/ge/item/') && method === 'GET') {
        const itemId = path.split('/')[4];
        response = await ge.handleGeItemInfo(request, env, itemId);

      // ----- Combat -----
      } else if (path === '/api/combat/state' && method === 'GET') {
        response = await combat.handleCombatState(request, env);
      } else if (path === '/api/combat/attack' && method === 'POST') {
        response = await combat.handleCombatAttack(request, env);
      } else if (path === '/api/combat/attack_player' && method === 'POST') {
        // Sesión 27 Bloque 3 — PVP
        response = await combat.handleCombatAttackPlayer(request, env);
      } else if (path === '/api/combat/respawn' && method === 'POST') {
        response = await combat.handleCombatRespawn(request, env);
      } else if (path === '/api/combat/style' && method === 'POST') {
        response = await combat.handleCombatStyle(request, env);

      // ----- Party (Sesión 27 Bloque 3) -----
      } else if (path === '/api/party/state' && method === 'GET') {
        response = await party.handlePartyState(request, env);
      } else if (path === '/api/party/invite' && method === 'POST') {
        response = await party.handlePartyInvite(request, env);
      } else if (path === '/api/party/accept' && method === 'POST') {
        response = await party.handlePartyAccept(request, env);
      } else if (path === '/api/party/decline' && method === 'POST') {
        response = await party.handlePartyDecline(request, env);
      } else if (path === '/api/party/leave' && method === 'POST') {
        response = await party.handlePartyLeave(request, env);
      } else if (path === '/api/party/kick' && method === 'POST') {
        response = await party.handlePartyKick(request, env);

      // ----- Duel (Sesión 28) -----
      } else if (path === '/api/duel/state' && method === 'GET') {
        response = await duel.handleDuelState(request, env);
      } else if (path === '/api/duel/challenge' && method === 'POST') {
        response = await duel.handleDuelChallenge(request, env);
      } else if (path === '/api/duel/accept' && method === 'POST') {
        response = await duel.handleDuelAccept(request, env);
      } else if (path === '/api/duel/decline' && method === 'POST') {
        response = await duel.handleDuelDecline(request, env);
      } else if (path === '/api/duel/cancel' && method === 'POST') {
        response = await duel.handleDuelCancel(request, env);
      } else if (path === '/api/duel/leave' && method === 'POST') {
        response = await duel.handleDuelLeave(request, env);

      // ----- Chat global (Sesión 29) -----
      } else if (path === '/api/chat/recent' && method === 'GET') {
        response = await chat.handleChatRecent(request, env);
      } else if (path === '/api/chat/send' && method === 'POST') {
        response = await chat.handleChatSend(request, env);

      // ----- World (multiplayer) -----
      } else if (path === '/api/world/heartbeat' && method === 'POST') {
        response = await world.handleWorldHeartbeat(request, env);
      } else if (path === '/api/world/peers' && method === 'GET') {
        response = await world.handleWorldPeers(request, env);
      // ----- World Snapshot (Sesión 27 Bloque 1) -----
      // Endpoint server-authoritative que devuelve players+NPCs+timestamp.
      // Vive en paralelo con peers y combat/state durante Bloque 1.
      } else if (path === '/api/world/snapshot' && method === 'GET') {
        response = await snapshot.handleWorldSnapshot(request, env);

      // ----- Home Teleport -----
      } else if (path === '/api/magic/home_teleport' && method === 'POST') {
        response = await homeTele.handleHomeTeleportStart(request, env);
      } else if (path === '/api/magic/home_teleport/cancel' && method === 'POST') {
        response = await homeTele.handleHomeTeleportCancel(request, env);
      } else if (path === '/api/magic/home_teleport/finish' && method === 'POST') {
        response = await homeTele.handleHomeTeleportFinish(request, env);

      // ----- Ground items -----
      } else if (path === '/api/ground_items' && method === 'GET') {
        response = await groundItems.handleGroundItemsList(request, env);
      } else if (path === '/api/ground_items/pickup' && method === 'POST') {
        response = await groundItems.handleGroundItemsPickup(request, env);

      // ----- Skills (Sesión 14) -----
      } else if (path === '/api/skills' && method === 'GET') {
        response = await skills.handleGetSkills(request, env);
      } else if (path === '/api/skills/grant' && method === 'POST') {
        response = await skills.handleGrantXp(request, env);

      // ----- Equipment (Sesión 22) -----
      } else if (path === '/api/equipment' && method === 'GET') {
        response = await equipment.handleGetEquipment(request, env);
      } else if (path === '/api/equipment/equip' && method === 'POST') {
        response = await equipment.handleEquip(request, env);
      } else if (path === '/api/equipment/unequip' && method === 'POST') {
        response = await equipment.handleUnequip(request, env);

      // ----- Shop (Sesión 23) -----
      } else if (path === '/api/shop' && method === 'GET') {
        response = await shop.handleGetShop(request, env);
      } else if (path === '/api/shop/buy' && method === 'POST') {
        response = await shop.handleShopBuy(request, env);
      } else if (path === '/api/shop/sell' && method === 'POST') {
        response = await shop.handleShopSell(request, env);

      // ----- Woodcutting + Firemaking (Sesión 30) -----
      } else if (path === '/api/woodcutting/chop' && method === 'POST') {
        response = await woodcutting.handleWoodcuttingChop(request, env);
      } else if (path === '/api/firemaking/light' && method === 'POST') {
        response = await firemaking.handleFiremakingLight(request, env);

      // ----- Health + 404 -----
      } else if (path === '/api/health') {
        response = json({ ok: true, ts: Date.now() });
      } else {
        response = json({ error: 'not_found' }, 404);
      }

      return withCors(response, request, env);
    } catch (err) {
      console.error('Worker error:', err);
      return withCors(
        json({ error: 'internal_error', message: err.message }, 500),
        request, env
      );
    }
  },

  scheduled: scheduledHandler,
};
