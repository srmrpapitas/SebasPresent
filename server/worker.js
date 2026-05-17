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
 *   POST /api/magic/home_teleport (+ /cancel /finish)           → handlers/home_teleport.js
 *   GET  /api/ground_items, POST /pickup                        → handlers/ground_items.js
 *   GET  /api/skills, POST /api/skills/grant                    → handlers/skills.js   (Sesión 14)
 *   GET  /api/health
 *
 *   Cron (cada 1 min): GE matcher, NPC revive, ground_items cleanup.
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
import * as homeTele from './handlers/home_teleport.js';
import * as groundItems from './handlers/ground_items.js';
import * as skills from './handlers/skills.js';
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
      } else if (path === '/api/combat/respawn' && method === 'POST') {
        response = await combat.handleCombatRespawn(request, env);
      } else if (path === '/api/combat/style' && method === 'POST') {
        response = await combat.handleCombatStyle(request, env);

      // ----- World (multiplayer) -----
      } else if (path === '/api/world/heartbeat' && method === 'POST') {
        response = await world.handleWorldHeartbeat(request, env);
      } else if (path === '/api/world/peers' && method === 'GET') {
        response = await world.handleWorldPeers(request, env);

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
