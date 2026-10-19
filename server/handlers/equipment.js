/**
 * SebasPresent — Equipment handlers (Sesión 22 + Sesión 26 auto-desequip)
 *
 * Endpoints:
 *   GET  /api/equipment
 *     Devuelve { slots: { weapon: {...}, shield: {...}, ... } } con los items
 *     equipados por slot. Si un slot está vacío, NO aparece.
 *
 *   POST /api/equipment/equip { slot_index }
 *     Coge el item del slot_index del inventario y lo equipa en el slot
 *     correspondiente a item.equip_slot. Si ese slot ya tenía algo, lo
 *     deja en el slot del inventario donde estaba el item nuevo (swap).
 *
 *     SESIÓN 26 — Auto-desequip 2H ↔ Shield:
 *       - Equipar 2H (weapon_type='2h_sword') con escudo equipado →
 *         el escudo se va al inventario automáticamente.
 *       - Equipar escudo con 2H equipada → la 2H se va al inventario.
 *       - Si la mochila no tiene slot libre para el item desplazado →
 *         error 'bag_full', el equip se cancela y NO se cambia nada.
 *
 *   POST /api/equipment/unequip { slot_id }
 *     Devuelve el item al primer slot libre del inventario. Si no hay
 *     slots libres, error.
 *
 * Tablas usadas:
 *   user_equipment (user_id, slot_id, item_id, equipped_at)
 *   items (id, name, icon, equip_slot, weapon_type, attack_bonus, defence_bonus, ...)
 *   user_inventory (user_id, slot_index, item_id, quantity, updated_at)
 *
 * Slots válidos (mismos que OSRS):
 *   weapon, shield, helm, body, legs, boots, cape, amulet, ring
 *
 * Single-item por slot (no stackable en equipment).
 */

import { json, readJson } from '../lib/db.js';
import { requireSession } from '../lib/auth.js';
import { questEvent } from '../lib/quests.js';   // Sesión 50
import { pushRealtime } from '../lib/realtime.js';   // Sesión 50
import { xpToLevel } from '../lib/skills_engine.js';
import { equipRequirement, requirementText, magicDefOf } from '../../client/src/shared/equip_reqs.js';   // Sesión 50/51
import { guardConds, slotCond, slotEmptyCond, atomicBatch, changed } from '../lib/atomic.js';   // Sesión 51

const INVENTORY_SLOTS = 20;
// Sesión 34 — Agregado slot 'quiver' (Bloque 2). Container especial para
// flechas: las flechas se almacenan dentro del quiver mientras está
// equipado (user_quiver table), en lugar de ocupar slot del inv.
const VALID_EQUIP_SLOTS = ['weapon', 'shield', 'helm', 'body', 'legs', 'boots', 'gloves', 'cape', 'amulet', 'ring', 'quiver'];

// Sesión 35 — Tipos de arma que ocupan ambas manos. Equipar cualquiera de
// estos cuando hay escudo equipado fuerza al escudo al inv (y viceversa).
// Antes solo se chequeaba '2h_sword' literal, lo cual dejaba al `bow`
// fuera del conflict check: te dejaba equipar escudo encima del arco
// (bug visto en S35 smoke test del path ranged).
// Cuando agreguemos 'staff' (Bloque 2 días 8-11), va acá también.
const TWO_HANDED_WEAPON_TYPES = new Set(['2h_sword', 'bow']);
// Sesión 51 — armas a dos manos por item (no por tipo): las garras van una en
// cada mano, así que no dejan llevar escudo.
const TWO_HANDED_ITEM_IDS = new Set(['claws_dragon']);

// ============================================================
// GET /api/equipment
// ============================================================

// Sesión 50 — avisar al resto de jugadores (tiempo real) del equipo nuevo
async function pushEquipState(env, userId) {
  try {
    const r = await env.DB.prepare(
      `SELECT (SELECT group_concat(slot_id || ':' || item_id, ',') FROM user_equipment WHERE user_id = ?) AS equip,
              (SELECT e.item_id FROM user_equipment e WHERE e.user_id = ? AND e.slot_id = 'weapon') AS w,
              (SELECT i.weapon_type FROM user_equipment e JOIN items i ON i.id = e.item_id WHERE e.user_id = ? AND e.slot_id = 'weapon') AS wt`
    ).bind(userId, userId, userId).first();
    await pushRealtime(env, { t: 'eq', id: userId, equip: r?.equip || '', w: r?.w || null, wt: r?.wt || null });
  } catch {}
}

export async function handleGetEquipment(request, env) {
  const session = await requireSession(request, env);
  if (!session) return json({ error: 'unauthorized' }, 401);

  const result = await env.DB.prepare(
    `SELECT eq.slot_id, eq.item_id, eq.equipped_at,
            i.name, i.icon, i.equip_slot, i.weapon_type,
            i.attack_bonus, i.defence_bonus, i.ranged_bonus, i.description,
            i.strength_bonus, i.material
     FROM user_equipment eq
     JOIN items i ON i.id = eq.item_id
     WHERE eq.user_id = ?`
  ).bind(session.user_id).all();

  const slots = {};
  for (const r of (result.results || [])) {
    slots[r.slot_id] = {
      item_id: r.item_id,
      name: r.name,
      icon: r.icon,
      equip_slot: r.equip_slot,
      weapon_type: r.weapon_type,
      attack_bonus: r.attack_bonus | 0,
      defence_bonus: r.defence_bonus | 0,
      ranged_bonus: r.ranged_bonus | 0,
      strength_bonus: r.strength_bonus | 0,                       // Sesión 51
      magic_defence: magicDefOf(r.material, r.defence_bonus | 0), // Sesión 51
      description: r.description,
      equipped_at: r.equipped_at,
    };
  }
  return json({ slots });
}

// ============================================================
// POST /api/equipment/equip { slot_index }
// ============================================================
export async function handleEquip(request, env) {
  const session = await requireSession(request, env);
  if (!session) return json({ error: 'unauthorized' }, 401);

  const body = await readJson(request);
  if (!body || !Number.isInteger(body.slot_index)) {
    return json({ error: 'bad_request', message: 'slot_index requerido' }, 400);
  }
  const slotIndex = body.slot_index;
  if (slotIndex < 0 || slotIndex >= INVENTORY_SLOTS) {
    return json({ error: 'invalid_slot' }, 400);
  }

  // 1. Leer item del inventario en ese slot (incluyendo weapon_type para la lógica 2H)
  const invItem = await env.DB.prepare(
    `SELECT inv.item_id, inv.quantity, i.equip_slot, i.weapon_type, i.name, i.material
     FROM user_inventory inv
     JOIN items i ON i.id = inv.item_id
     WHERE inv.user_id = ? AND inv.slot_index = ?`
  ).bind(session.user_id, slotIndex).first();

  if (!invItem) return json({ error: 'slot_empty' }, 400);
  if (!invItem.equip_slot) {
    return json({ error: 'not_equipable', message: 'Este item no se puede equipar' }, 400);
  }
  if (!VALID_EQUIP_SLOTS.includes(invItem.equip_slot)) {
    return json({ error: 'invalid_equip_slot' }, 500);
  }

  // Sesión 50 — requisito de nivel (Ataque para espadas, Defensa para armadura)
  const req = equipRequirement(invItem);
  const targetSlot = invItem.equip_slot;
  // 19 oct — las lecturas que no dependen unas de otras, a la vez
  const reqCol = req ? { attack: 'attack_xp', defence: 'defence_xp', ranged: 'ranged_xp', magic: 'magic_xp' }[req.skill] : null;
  const isEquipping2H = (targetSlot === 'weapon' && (TWO_HANDED_WEAPON_TYPES.has(invItem.weapon_type) || TWO_HANDED_ITEM_IDS.has(invItem.item_id)));
  const isEquippingShield = (targetSlot === 'shield');
  const twoHandedList = Array.from(TWO_HANDED_WEAPON_TYPES);
  const [reqStat, equippedItem, conflictRow] = await Promise.all([
    reqCol ? env.DB.prepare(`SELECT ${reqCol} AS xp FROM combat_stats WHERE user_id = ?`).bind(session.user_id).first() : null,
    // 2. ¿Hay algo equipado en el target slot? Si sí, lo desequipamos al inventario.
    env.DB.prepare(`SELECT item_id FROM user_equipment WHERE user_id = ? AND slot_id = ?`).bind(session.user_id, targetSlot).first(),
    // Sesión 26/35 — conflicto 2H ↔ escudo (ver abajo)
    isEquipping2H
      ? env.DB.prepare(`SELECT item_id FROM user_equipment WHERE user_id = ? AND slot_id = 'shield'`).bind(session.user_id).first()
      : isEquippingShield
        ? env.DB.prepare(
            `SELECT eq.item_id
             FROM user_equipment eq
             JOIN items i ON i.id = eq.item_id
             WHERE eq.user_id = ? AND eq.slot_id = 'weapon'
               AND (i.weapon_type IN (${twoHandedList.map(() => '?').join(',')}) OR eq.item_id IN (${[...TWO_HANDED_ITEM_IDS].map(() => '?').join(',')}))`
          ).bind(session.user_id, ...twoHandedList, ...TWO_HANDED_ITEM_IDS).first()
        : null,
  ]);
  if (req) {
    const st = reqStat;
    const have = xpToLevel(st?.xp || 0);
    if (have < req.level) {
      return json({
        error: 'level_too_low',
        message: `Necesitas ${requirementText(req)} para equipar ${invItem.name} (tienes ${have}).`,
        skill: req.skill, required_level: req.level, current_level: have,
      }, 400);
    }
  }

  const now = Date.now();

  // SESIÓN 26 — conflicto 2H ↔ escudo (leído arriba): equipar una 2H con escudo
  // puesto manda el escudo a la mochila, y al revés. Sesión 35 — TWO_HANDED_WEAPON_TYPES
  // incluye el arco.
  let conflictItem = null;   // { slot_id, item_id } del item a desequipar por conflicto
  if (conflictRow) conflictItem = { slot_id: isEquipping2H ? 'shield' : 'weapon', item_id: conflictRow.item_id };

  // ============================================================
  // SESIÓN 26 — Si hay conflicto, asegurar que cabe en mochila
  // ============================================================
  // Cálculo de slots ocupados después del swap normal:
  //   - slotIndex se vacía (el item nuevo se va a equipment).
  //   - Si había equippedItem en targetSlot, se vuelve a llenar con ese
  //     (swap back). Si no, slotIndex queda libre.
  // Para el item de conflicto necesito UN slot libre extra.
  let conflictDestSlot = null;
  if (conflictItem) {
    const occRes = await env.DB.prepare(
      `SELECT slot_index FROM user_inventory WHERE user_id = ?`
    ).bind(session.user_id).all();
    const taken = new Set((occRes.results || []).map(r => r.slot_index));

    // Modelamos el estado post-swap:
    taken.delete(slotIndex);                // se va el item original
    if (equippedItem) taken.add(slotIndex); // swap back ocupa el slot

    for (let i = 0; i < INVENTORY_SLOTS; i++) {
      if (!taken.has(i)) { conflictDestSlot = i; break; }
    }
    if (conflictDestSlot === null) {
      return json({
        error: 'bag_full',
        message: 'Mochila llena. Vacía un slot para equipar.',
      }, 400);
    }
  }

  // ============================================================
  // 3. Operaciones atómicas (batch)
  // ============================================================
  const ops = [];
  const uid = session.user_id;
  // Sesión 51 — GUARDA: todo sigue como lo leímos (mochila, equipo, escudo/arma
  // en conflicto y hueco de destino). Si otra petición cambió algo a la vez
  // (equipar dos cosas, equipar + desequipar, mover el objeto…), no se hace
  // nada y el cliente reintenta. Antes así se duplicaban armas.
  const eqIs = (slotId, itemId) => ({ sql: '(SELECT item_id FROM user_equipment WHERE user_id = ? AND slot_id = ?) IS ?', params: [uid, slotId, itemId ?? null] });
  ops.push(guardConds(env, [
    slotCond(uid, slotIndex, invItem.item_id, invItem.quantity),
    eqIs(targetSlot, equippedItem?.item_id),
    conflictItem ? eqIs(conflictItem.slot_id, conflictItem.item_id) : (isEquipping2H ? eqIs('shield', null) : null),
    // (si el hueco de destino es el del propio objeto que se equipa, se libera en este mismo lote)
    conflictDestSlot !== null && conflictDestSlot !== slotIndex ? slotEmptyCond(uid, conflictDestSlot) : null,
  ]));

  // Quitar item del inventario en slotIndex
  ops.push(env.DB.prepare(
    `DELETE FROM user_inventory WHERE user_id = ? AND slot_index = ?`
  ).bind(session.user_id, slotIndex));

  // Si había algo equipado, ponerlo en el slot del inventario que acabamos de vaciar
  if (equippedItem) {
    ops.push(env.DB.prepare(
      `INSERT INTO user_inventory (user_id, slot_index, item_id, quantity, updated_at)
       VALUES (?, ?, ?, 1, ?)`
    ).bind(session.user_id, slotIndex, equippedItem.item_id, now));
  }

  // Upsert el item nuevo en user_equipment
  ops.push(env.DB.prepare(
    `INSERT INTO user_equipment (user_id, slot_id, item_id, equipped_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id, slot_id) DO UPDATE SET
       item_id = excluded.item_id,
       equipped_at = excluded.equipped_at`
  ).bind(session.user_id, targetSlot, invItem.item_id, now));

  // SESIÓN 26 — Si hay conflict (2H↔shield), desequipar al inventario.
  if (conflictItem && conflictDestSlot !== null) {
    ops.push(env.DB.prepare(
      `DELETE FROM user_equipment WHERE user_id = ? AND slot_id = ?`
    ).bind(session.user_id, conflictItem.slot_id));
    ops.push(env.DB.prepare(
      `INSERT INTO user_inventory (user_id, slot_index, item_id, quantity, updated_at)
       VALUES (?, ?, ?, 1, ?)`
    ).bind(session.user_id, conflictDestSlot, conflictItem.item_id, now));
  }

  if (!(await atomicBatch(env, ops))) return changed('Tu equipo cambió mientras tanto. Inténtalo otra vez.');
  // 19 oct — misiones y aviso a los demás a la vez (antes uno detrás de otro)
  await Promise.all([
    questEvent(env, session.user_id, 'equip', invItem.item_id),   // Sesión 50 — misiones
    pushEquipState(env, session.user_id),
  ]);
  return json({
    ok: true,
    equipped: { slot_id: targetSlot, item_id: invItem.item_id },
    swapped_back: equippedItem ? { slot_index: slotIndex, item_id: equippedItem.item_id } : null,
    auto_unequipped: conflictItem ? {
      slot_id: conflictItem.slot_id,
      item_id: conflictItem.item_id,
      to_inventory_slot: conflictDestSlot,
    } : null,
  });
}

// ============================================================
// POST /api/equipment/unequip { slot_id }
// ============================================================
export async function handleUnequip(request, env) {
  const session = await requireSession(request, env);
  if (!session) return json({ error: 'unauthorized' }, 401);

  const body = await readJson(request);
  if (!body || typeof body.slot_id !== 'string') {
    return json({ error: 'bad_request', message: 'slot_id requerido' }, 400);
  }
  const slotId = body.slot_id;
  if (!VALID_EQUIP_SLOTS.includes(slotId)) {
    return json({ error: 'invalid_slot_id' }, 400);
  }

  // 1. ¿Tiene algo equipado en ese slot?
  // 2. Inventario actual para calcular espacio disponible (19 oct: a la vez)
  const [equipped, invRows] = await Promise.all([
    env.DB.prepare(`SELECT item_id FROM user_equipment WHERE user_id = ? AND slot_id = ?`).bind(session.user_id, slotId).first(),
    env.DB.prepare(`SELECT slot_index, item_id, quantity FROM user_inventory WHERE user_id = ?`).bind(session.user_id).all(),
  ]);
  if (!equipped) return json({ error: 'slot_empty' }, 400);
  const occupied = invRows.results || [];
  const taken = new Set(occupied.map(r => r.slot_index));

  function firstFreeSlot(excluding = new Set()) {
    for (let i = 0; i < INVENTORY_SLOTS; i++) {
      if (!taken.has(i) && !excluding.has(i)) return i;
    }
    return null;
  }

  // ============================================================
  // Sesión 34 — Caso especial: desequipar quiver con flechas adentro.
  // ============================================================
  // El quiver, al estar equipado, almacena flechas en user_quiver.
  // Al desequiparse, ese contenido vuelve al inventario:
  //   - Si ya hay un stack del mismo arrow_item_id → suma quantity ahí (no
  //     ocupa slot nuevo).
  //   - Si no → necesita un slot libre extra (además del que ocupa el quiver).
  // Si la mochila no tiene espacio para ambos → error 'inventory_full'
  // y NO se modifica nada (atómico).
  if (slotId === 'quiver') {
    const q = await env.DB.prepare(
      `SELECT arrow_item_id, arrow_quantity FROM user_quiver WHERE user_id = ?`
    ).bind(session.user_id).first();

    const hasArrows = q && q.arrow_item_id && q.arrow_quantity > 0;

    // Slot para el quiver mismo
    const quiverDestSlot = firstFreeSlot();
    if (quiverDestSlot === null) {
      return json({ error: 'inventory_full', message: 'Mochila llena' }, 400);
    }

    const now = Date.now();
    const uid = session.user_id;
    const conds = [
      { sql: "(SELECT item_id FROM user_equipment WHERE user_id = ? AND slot_id = 'quiver') IS ?", params: [uid, equipped.item_id] },
      slotEmptyCond(uid, quiverDestSlot),
      // Sesión 51 — el contenido del carcaj sigue siendo el que leímos (antes,
      // desequipar + sacar flechas a la vez las duplicaba)
      q ? { sql: '(SELECT arrow_item_id IS ? AND arrow_quantity = ? FROM user_quiver WHERE user_id = ?)', params: [q.arrow_item_id ?? null, q.arrow_quantity | 0, uid] }
        : { sql: 'NOT EXISTS (SELECT 1 FROM user_quiver WHERE user_id = ? AND arrow_quantity > 0)', params: [uid] },
    ];
    const stmts = [
      null,   // guarda (se pone al final, cuando sabemos todos los huecos)
      env.DB.prepare(
        `DELETE FROM user_equipment WHERE user_id = ? AND slot_id = 'quiver'`
      ).bind(session.user_id),
      env.DB.prepare(
        `INSERT INTO user_inventory (user_id, slot_index, item_id, quantity, updated_at)
         VALUES (?, ?, ?, 1, ?)`
      ).bind(session.user_id, quiverDestSlot, equipped.item_id, now),
    ];

    if (hasArrows) {
      // ¿Ya hay stack del mismo tipo de flecha en inv?
      const existingArrowStack = occupied.find(r => r.item_id === q.arrow_item_id);
      if (existingArrowStack) {
        conds.push(slotCond(uid, existingArrowStack.slot_index, q.arrow_item_id));
        stmts.push(env.DB.prepare(
          `UPDATE user_inventory SET quantity = quantity + ?, updated_at = ?
           WHERE user_id = ? AND slot_index = ? AND item_id = ?`
        ).bind(q.arrow_quantity, now, session.user_id, existingArrowStack.slot_index, q.arrow_item_id));
      } else {
        // Slot extra para las flechas (no puede ser el mismo que usamos para el quiver)
        const arrowDestSlot = firstFreeSlot(new Set([quiverDestSlot]));
        if (arrowDestSlot === null) {
          return json({ error: 'inventory_full', message: 'Mochila llena (flechas del carcaj no caben)' }, 400);
        }
        conds.push(slotEmptyCond(uid, arrowDestSlot));
        stmts.push(env.DB.prepare(
          `INSERT INTO user_inventory (user_id, slot_index, item_id, quantity, updated_at)
           VALUES (?, ?, ?, ?, ?)`
        ).bind(session.user_id, arrowDestSlot, q.arrow_item_id, q.arrow_quantity, now));
      }
      // Vaciar el quiver storage
      stmts.push(env.DB.prepare(
        `UPDATE user_quiver SET arrow_item_id = NULL, arrow_quantity = 0, updated_at = ?
         WHERE user_id = ?`
      ).bind(now, session.user_id));
    }

    stmts[0] = guardConds(env, conds);
    if (!(await atomicBatch(env, stmts))) return changed('Tu equipo cambió mientras tanto. Inténtalo otra vez.');
    await pushEquipState(env, session.user_id);
    return json({
      ok: true,
      unequipped: { slot_id: slotId, item_id: equipped.item_id, to_inventory_slot: quiverDestSlot },
      arrows_returned: hasArrows ? { item_id: q.arrow_item_id, quantity: q.arrow_quantity } : null,
    });
  }

  // ============================================================
  // Caso normal (todos los demás slots): mover 1 item al primer slot libre
  // ============================================================
  const freeSlot = firstFreeSlot();
  if (freeSlot === null) {
    return json({ error: 'inventory_full', message: 'Mochila llena' }, 400);
  }

  const now = Date.now();

  // 3. Batch: borrar del equipment, insertar al inventario
  // Sesión 51 — con guarda: dos "Quitar" seguidos ya no duplican el objeto
  const okUn = await atomicBatch(env, [
    guardConds(env, [
      { sql: '(SELECT item_id FROM user_equipment WHERE user_id = ? AND slot_id = ?) IS ?', params: [session.user_id, slotId, equipped.item_id] },
      slotEmptyCond(session.user_id, freeSlot),
    ]),
    env.DB.prepare(
      `DELETE FROM user_equipment WHERE user_id = ? AND slot_id = ?`
    ).bind(session.user_id, slotId),
    env.DB.prepare(
      `INSERT INTO user_inventory (user_id, slot_index, item_id, quantity, updated_at)
       VALUES (?, ?, ?, 1, ?)`
    ).bind(session.user_id, freeSlot, equipped.item_id, now),
  ]);
  if (!okUn) return changed('Tu equipo cambió mientras tanto. Inténtalo otra vez.');

  await pushEquipState(env, session.user_id);
  return json({
    ok: true,
    unequipped: { slot_id: slotId, item_id: equipped.item_id, to_inventory_slot: freeSlot },
  });
}
