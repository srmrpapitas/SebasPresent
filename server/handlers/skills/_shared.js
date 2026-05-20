/**
 * SebasPresent — Skills shared helpers (Sesión 32)
 *
 * Helpers comunes entre handlers de skills (woodcutting, firemaking, cooking,
 * mining, etc). Estos helpers son SOLO para skills server-side; no compartir
 * con handlers de combat, inventory, etc para no acoplar capas.
 *
 * Por qué existe este archivo:
 *   - Antes (S30/S31), hasAxeAvailable() y findInventorySpotForItem() estaban
 *     duplicados en woodcutting.js. Cuando agregamos mining, hubiera sido
 *     hasPickaxeAvailable() — duplicación. Esto centraliza la lógica.
 *
 * Convenciones:
 *   - Funciones puramente async (siempre devuelven Promise).
 *   - Defensive: si una tabla no existe, devuelven valor neutro (false/null/empty).
 *   - NO loguean errores excepto que sea genuinamente inesperado.
 */

const INVENTORY_SLOTS = 28;

/**
 * Verifica si una tabla D1 existe. Helper genérico.
 * Reemplaza wcTablesExist / fmTablesExist / etc.
 *
 * @param {object} env - Bindings de Cloudflare Worker
 * @param {string} tableName - nombre de la tabla
 * @returns {Promise<boolean>}
 */
export async function tableExists(env, tableName) {
  try {
    await env.DB.prepare(`SELECT 1 FROM ${tableName} LIMIT 1`).all();
    return true;
  } catch {
    return false;
  }
}

/**
 * ¿El player tiene un item específico (ej 'axe', 'pickaxe_bronze', 'tinderbox')
 * disponible para usar? Busca en:
 *   1) user_inventory (cualquier slot)
 *   2) user_equipment (slot weapon, si aplica para esa skill)
 *
 * Para herramientas como axe/pickaxe, equiparlas en weapon también sirve para
 * la skill — es lo natural.
 *
 * @param {object} env
 * @param {string} userId
 * @param {string} itemId - ej 'axe', 'tinderbox'
 * @param {object} [opts]
 * @param {boolean} [opts.checkWeaponSlot=true] - también buscar en equipment.weapon
 * @returns {Promise<boolean>}
 */
export async function hasItemAvailable(env, userId, itemId, opts = {}) {
  const checkWeaponSlot = opts.checkWeaponSlot !== false;

  // 1) Inventario
  const invRow = await env.DB.prepare(
    'SELECT 1 FROM user_inventory WHERE user_id = ? AND item_id = ? LIMIT 1'
  ).bind(userId, itemId).first();
  if (invRow) return true;

  // 2) Equipment (weapon slot)
  if (checkWeaponSlot) {
    try {
      const eqRow = await env.DB.prepare(
        "SELECT 1 FROM user_equipment WHERE user_id = ? AND slot_id = 'weapon' AND item_id = ? LIMIT 1"
      ).bind(userId, itemId).first();
      if (eqRow) return true;
    } catch {
      // user_equipment puede no existir en algunos despliegues — silencio.
    }
  }

  return false;
}

/**
 * Encuentra un spot en el inventario para agregar un item.
 * Prioriza stack existente sobre slot vacío.
 *
 * @param {object} env
 * @param {string} userId
 * @param {string} itemId
 * @returns {Promise<{kind: 'stack'|'empty'|'full', slot?: number}>}
 *   - 'stack': hay un stack existente del mismo item en `slot`
 *   - 'empty': hay un slot vacío en `slot`
 *   - 'full':  el inventario está completamente lleno
 */
export async function findInventorySpotForItem(env, userId, itemId) {
  // 1) Stack existente
  const stackRow = await env.DB.prepare(
    'SELECT slot_index, quantity FROM user_inventory WHERE user_id = ? AND item_id = ? LIMIT 1'
  ).bind(userId, itemId).first();
  if (stackRow) return { kind: 'stack', slot: stackRow.slot_index };

  // 2) Slot vacío
  const usedRows = await env.DB.prepare(
    'SELECT slot_index FROM user_inventory WHERE user_id = ?'
  ).bind(userId).all();
  const used = new Set((usedRows.results || []).map(r => r.slot_index));
  for (let i = 0; i < INVENTORY_SLOTS; i++) {
    if (!used.has(i)) return { kind: 'empty', slot: i };
  }

  return { kind: 'full' };
}

/**
 * Calcula la posición del player en este momento (heartbeat más reciente).
 *
 * @param {object} env
 * @param {string} userId
 * @returns {Promise<{x: number, z: number}|null>}
 */
export async function getPlayerPosition(env, userId) {
  const row = await env.DB.prepare(
    'SELECT x, z FROM online_users WHERE user_id = ?'
  ).bind(userId).first();
  if (!row) return null;
  return { x: row.x, z: row.z };
}

/**
 * Valida que la pos del player esté a <= maxDist de un target (x, z).
 * Usado para validaciones de proximidad en skills (talar, encender fuego,
 * minar, etc).
 *
 * @param {{x: number, z: number}} playerPos
 * @param {number} targetX
 * @param {number} targetZ
 * @param {number} maxDist
 * @returns {{ok: boolean, distance: number}}
 */
export function isWithinDistance(playerPos, targetX, targetZ, maxDist) {
  const dx = playerPos.x - targetX;
  const dz = playerPos.z - targetZ;
  const distSq = dx * dx + dz * dz;
  return {
    ok: distSq <= maxDist * maxDist,
    distance: Math.sqrt(distSq),
  };
}
