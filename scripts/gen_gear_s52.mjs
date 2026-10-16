// Sesión 52 — genera server/seeds/023_gear_s52.sql a partir de client/src/shared/gear_sets.js
// Uso: node scripts/gen_gear_s52.mjs > server/seeds/023_gear_s52.sql
import { ARCHER_SETS, MAGE_SETS, GEAR_SLOTS, ARCHER_PIECE_NAMES, MAGE_PIECE_NAMES } from '../client/src/shared/gear_sets.js';

const q = (v) => v == null ? 'NULL' : typeof v === 'number' ? String(v) : `'${String(v).replace(/'/g, "''")}'`;
const T = 1793000000000;
const ICON = { helm: '⛑', body: '🛡', legs: '👖', gloves: '🧤', boots: '🥾' };
const MAGE_ICON = { helm: '🎩', body: '🥋', legs: '👗', gloves: '🧤', boots: '🥿' };
const PRICE_K = { helm: 0.5, body: 1, legs: 0.75, gloves: 0.35, boots: 0.4 };
const items = [];
const item = (id, name, icon, stackable, desc, price, slot = null, def = 0, rng = 0, mat = null, tier = null) =>
  items.push(`(${[id, name, icon, stackable, desc, T, price, slot, null, 0, def, rng, mat, tier].map(q).join(',')})`);

// Materiales
item('piel_lobo', 'Piel de lobo', '🐺', 0, 'Piel sin curtir. Cúrtela (Artesanía 20) para coser armadura de arquero.', 35);
item('cuero_lobo', 'Cuero de lobo', '🟫', 1, 'Cuero de lobo curtido. Con aguja e hilo: armadura de arquero (Artesanía 20+).', 60);
item('caparazon_escorpion', 'Caparazón de escorpión', '🦂', 0, 'Caparazón duro. Límpialo (Artesanía 35) para sacar placas.', 90);
item('placa_escorpion', 'Placa de escorpión', '🟧', 1, 'Placa de quitina. Con aguja e hilo: armadura de arquero (Artesanía 35+).', 150);
item('piel_yeti', 'Piel de yeti', '🤍', 0, 'Piel blanca y espesa. Cúrtela (Artesanía 50).', 240);
item('cuero_yeti', 'Cuero de yeti', '⬜', 1, 'Cuero de yeti curtido. Frena muy bien la magia. Armadura de arquero (Artesanía 50+).', 400);
item('escama_dragon', 'Escama de dragón', '🔺', 1, 'Escama de Vermithrax o Nidhogg. Con aguja e hilo: armadura de arquero (Artesanía 70+).', 1500);
item('tela_algodon', 'Tela de algodón', '🧻', 1, 'Para coser túnicas de mago (Artesanía 1+).', 15);
item('tela_lino', 'Tela de lino', '📜', 1, 'Para coser túnicas de mago (Artesanía 25+).', 50);
item('tela_seda', 'Tela de seda', '🎀', 1, 'Para coser túnicas de mago (Artesanía 45+).', 150);

for (const [m, s] of Object.entries(ARCHER_SETS)) {
  GEAR_SLOTS.forEach((slot, i) => {
    const name = `${ARCHER_PIECE_NAMES[slot]} ${s.label}`;
    const desc = `Armadura de arquero. Necesitas nivel ${s.level} de Distancia. Frena la magia.`;
    item(`${slot}_${m}`, name, ICON[slot], 0, desc, Math.round(s.price * PRICE_K[slot]), slot, s.defence[slot], s.ranged[slot], m, 0);
  });
}
for (const [m, s] of Object.entries(MAGE_SETS)) {
  GEAR_SLOTS.forEach((slot) => {
    const name = `${MAGE_PIECE_NAMES[slot]} ${s.label}`;
    const req = s.level > 1 ? `Necesitas nivel ${s.level} de Magia. ` : '';
    const desc = `Ropa de mago. ${req}Cada pieza suma poder mágico (golpe máximo de los hechizos) y maná.`;
    item(`${slot}_${m}`, name, MAGE_ICON[slot], 0, desc, Math.round(s.price * PRICE_K[slot]), slot, s.defence[slot], 0, m, 0);
  });
}

const out = [];
out.push('-- Sesión 52 — armaduras de arquero por animal + túnicas de mago (generado por scripts/gen_gear_s52.mjs)');
out.push('INSERT OR REPLACE INTO items (id,name,icon,stackable,description,created_at,base_price,equip_slot,weapon_type,attack_bonus,defence_bonus,ranged_bonus,material,tier) VALUES');
out.push(items.join(',\n') + ';');

// Botín: cada fila solo si no existe ya (re-ejecutable)
const loot = (npc, it, a, b, w, always = 0) =>
  `INSERT INTO npc_loot_table (npc_def_id,item_id,qty_min,qty_max,weight,is_always) SELECT '${npc}','${it}',${a},${b},${w},${always} WHERE NOT EXISTS (SELECT 1 FROM npc_loot_table WHERE npc_def_id='${npc}' AND item_id='${it}') AND EXISTS (SELECT 1 FROM npc_defs WHERE id='${npc}');`;
out.push('-- Animales: su piel');
out.push(loot('wolf', 'piel_lobo', 1, 1, 4));
out.push(loot('scorpion', 'caparazon_escorpion', 1, 1, 4));
out.push(loot('yeti', 'piel_yeti', 1, 1, 5));
out.push('-- Jefes: muchas pieles / escamas');
out.push(loot('rey_yeti', 'piel_yeti', 5, 10, 15));
out.push(loot('reina_escorpion', 'caparazon_escorpion', 5, 10, 15));
out.push(loot('dragon_rojo', 'escama_dragon', 1, 2, 1, 1));
out.push(loot('dragon_negro', 'escama_dragon', 1, 2, 1, 1));
out.push('-- Acólitos del Cabildo: ropa del Cabildo (rara). Se multiplica antes su tabla ×4 (una sola vez)');
out.push(`UPDATE npc_loot_table SET weight = weight * 4 WHERE npc_def_id='acolito_cabildo' AND is_always=0 AND NOT EXISTS (SELECT 1 FROM npc_loot_table WHERE npc_def_id='acolito_cabildo' AND item_id LIKE '%_cabildo');`);
for (const slot of GEAR_SLOTS) out.push(loot('acolito_cabildo', `${slot}_cabildo`, 1, 1, 1));
out.push('-- Chona y el Magister Perdomo: ropa del Magister (1 de ~20 cada pieza)');
for (const boss of ['bruja_pantano', 'magister_cabildo']) for (const slot of GEAR_SLOTS) out.push(loot(boss, `${slot}_magister`, 1, 1, 5));

// Tiendas: telas (Gara y las tiendas de magia)
const stock = (shop, it, max, buy, sell) =>
  `INSERT OR IGNORE INTO shop_stock (shop_id,item_id,current_qty,max_qty,buy_price,sell_price,last_restock_at) VALUES ('${shop}','${it}',${max},${max},${buy},${sell},0);`;
out.push('-- Telas a la venta');
for (const shop of ['pieles_esperanza', 'magic_store']) {
  out.push(stock(shop, 'tela_algodon', 200, 6, 15));
  out.push(stock(shop, 'tela_lino', 100, 20, 50));
  out.push(stock(shop, 'tela_seda', 50, 60, 150));
}
console.log(out.join('\n'));
