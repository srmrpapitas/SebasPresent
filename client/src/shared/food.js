/**
 * SebasPresent — Comida (Sesión 50)
 *
 * MÓDULO COMPARTIDO cliente + servidor. Antes estas tablas estaban
 * duplicadas en server/handlers/skills/cooking.js y client/src/inventory.js.
 * Ahora las dos leen de aquí (incluye los peces de shared/fishing.js).
 */

import { FISH } from './fishing.js';

// Qué se puede comer y cuánto cura.
export const EDIBLE = {
  raw_chicken:    { heal: 1 },
  cooked_chicken: { heal: 3 },
  raw_beef:       { heal: 1 },
  cooked_beef:    { heal: 5 },
};
// Qué se puede cocinar: resultado, quemado, nivel de Cocina y XP.
export const COOKABLE = {
  raw_chicken: { cooked: 'cooked_chicken', burnt: 'burnt_chicken', cookLevel: 1, xp: 30 },
  raw_beef:    { cooked: 'cooked_beef',    burnt: 'burnt_beef',    cookLevel: 5, xp: 40 },
};

for (const [rawId, f] of Object.entries(FISH)) {
  COOKABLE[rawId] = { cooked: f.cooked, burnt: 'burnt_fish', cookLevel: f.cookLevel, xp: f.cookXp };
  EDIBLE[f.cooked] = { heal: f.heal };
}

export const EDIBLE_IDS = new Set(Object.keys(EDIBLE));
export const COOKABLE_IDS = new Set(Object.keys(COOKABLE));
