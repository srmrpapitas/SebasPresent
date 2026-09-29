/**
 * SebasPresent — Flechería y Artesanía (Sesión 50)
 *
 * MÓDULO COMPARTIDO cliente + servidor. Recetas que se hacen desde la
 * mochila (sin estación): tallar troncos, montar flechas, curtir cuero,
 * coser armadura de cuero...
 *
 * Receta:
 *   id, skill ('fletching' | 'crafting'), level, xp
 *   tool:  item que hay que llevar (no se gasta) o null
 *   in:    [[item_id, qty], ...]   se gastan
 *   out:   [item_id, qty]
 *   group: pestaña del panel
 */

export const SKILL_LABEL = { fletching: 'Flechería', crafting: 'Artesanía' };

// Flechas: material → [nivel, xp por tanda de 15]
const ARROWS = [
  ['bronze', 'Bronce', 1, 20], ['hierro', 'Hierro', 10, 40], ['acero', 'Acero', 20, 75],
  ['oro', 'Oro', 30, 110], ['obsidiana', 'Obsidiana', 45, 150], ['basaltita', 'Basaltita', 60, 190],
  ['teiderio', 'Teiderio', 75, 240],
];
// Arcos: [item, nombre, troncos, nivel, xp]
const BOWS = [
  ['bow_normal', 'Arco normal', 'logs', 5, 25],
  ['bow_oak', 'Arco de roble', 'oak_logs', 20, 50],
  ['bow_willow', 'Arco de sauce', 'willow_logs', 35, 80],
  ['bow_maple', 'Arco de arce', 'maple_logs', 50, 110],
  ['bow_yew', 'Arco de tejo', 'yew_logs', 65, 170],
  ['bow_magic', 'Arco mágico', 'magic_logs', 80, 250],
];

export const RECIPES = [
  // ---------------- Flechería ----------------
  { id: 'shafts_logs', skill: 'fletching', group: 'Astiles', name: '15 astiles', level: 1, xp: 5,
    tool: 'knife', in: [['logs', 1]], out: ['arrow_shaft', 15] },
  { id: 'shafts_oak', skill: 'fletching', group: 'Astiles', name: '30 astiles (roble)', level: 15, xp: 10,
    tool: 'knife', in: [['oak_logs', 1]], out: ['arrow_shaft', 30] },
  { id: 'shafts_willow', skill: 'fletching', group: 'Astiles', name: '45 astiles (sauce)', level: 30, xp: 15,
    tool: 'knife', in: [['willow_logs', 1]], out: ['arrow_shaft', 45] },
  { id: 'headless', skill: 'fletching', group: 'Flechas', name: '15 flechas sin punta', level: 1, xp: 15,
    tool: null, in: [['arrow_shaft', 15], ['feather', 15]], out: ['headless_arrow', 15] },
  ...ARROWS.map(([m, n, level, xp]) => ({
    id: `arrow_${m}`, skill: 'fletching', group: 'Flechas', name: `15 flechas de ${n.toLowerCase()}`, level, xp,
    tool: null, in: [['headless_arrow', 15], [`bar_${m}`, 1]], out: [`arrow_${m}`, 15],
  })),
  ...BOWS.map(([id, name, logs, level, xp]) => ({
    id, skill: 'fletching', group: 'Arcos', name, level, xp,
    tool: 'knife', in: [[logs, 1], ['bowstring', 1]], out: [id, 1],
  })),

  // ---------------- Artesanía ----------------
  { id: 'tan', skill: 'crafting', group: 'Cuero', name: 'Curtir cuero (2)', level: 1, xp: 3,
    tool: null, in: [['cowhide', 1]], out: ['leather', 2] },
  { id: 'bowstring', skill: 'crafting', group: 'Cuero', name: '2 cuerdas de arco', level: 1, xp: 4,
    tool: null, in: [['leather', 1]], out: ['bowstring', 2] },
  { id: 'gloves_cuero', skill: 'crafting', group: 'Armadura de cuero', name: 'Guantes de cuero', level: 1, xp: 14,
    tool: 'needle', in: [['leather', 1], ['thread', 1]], out: ['gloves_cuero', 1] },
  { id: 'boots_cuero', skill: 'crafting', group: 'Armadura de cuero', name: 'Botas de cuero', level: 7, xp: 16,
    tool: 'needle', in: [['leather', 1], ['thread', 1]], out: ['boots_cuero', 1] },
  { id: 'helm_cuero', skill: 'crafting', group: 'Armadura de cuero', name: 'Capucha de cuero', level: 9, xp: 18,
    tool: 'needle', in: [['leather', 1], ['thread', 1]], out: ['helm_cuero', 1] },
  { id: 'body_cuero', skill: 'crafting', group: 'Armadura de cuero', name: 'Chaqueta de cuero', level: 14, xp: 25,
    tool: 'needle', in: [['leather', 3], ['thread', 1]], out: ['body_cuero', 1] },
  { id: 'legs_cuero', skill: 'crafting', group: 'Armadura de cuero', name: 'Pantalones de cuero', level: 18, xp: 27,
    tool: 'needle', in: [['leather', 2], ['thread', 1]], out: ['legs_cuero', 1] },
  { id: 'quiver_bronze', skill: 'crafting', group: 'Armadura de cuero', name: 'Carcaj de cuero', level: 20, xp: 40,
    tool: 'needle', in: [['leather', 4], ['thread', 2]], out: ['quiver_bronze', 1] },
];

export const RECIPES_BY_ID = Object.fromEntries(RECIPES.map(r => [r.id, r]));

export const TOOL_NAMES = { knife: 'un cuchillo', needle: 'una aguja' };

/** Recetas en las que interviene un item (como material o herramienta). */
export function recipesUsing(itemId) {
  return RECIPES.filter(r => r.tool === itemId || r.in.some(([id]) => id === itemId));
}

export const CRAFT_TICK_MS = 1200;       // cliente
export const CRAFT_MIN_TICK_MS = 900;    // server (cerrojo)
