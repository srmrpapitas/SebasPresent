-- Sesión 50 — Pesca: herramientas, peces crudos/cocinados, pescado quemado
-- y stock en la tienda general. Idempotente (INSERT OR IGNORE / OR REPLACE).
INSERT OR IGNORE INTO items (id, name, icon, stackable, description, created_at, base_price, equip_slot, weapon_type, attack_bonus, defence_bonus, ranged_bonus) VALUES
 ('small_net',   'Red pequeña',     '🥅', 0, 'Para pescar gambas en aguas poco profundas.', 1790700000000, 5,  NULL, NULL, 0, 0, 0),
 ('fishing_rod', 'Caña de pescar',  '🎣', 0, 'Pesca en ríos y lagos. Usa plumas como cebo.', 1790700000000, 5,  NULL, NULL, 0, 0, 0),
 ('harpoon',     'Arpón',           '🔱', 0, 'Para peces grandes: atún, pez espada, tiburón.', 1790700000000, 45, NULL, NULL, 0, 0, 0),
 ('raw_shrimp',    'Gambas crudas',     '🦐', 0, 'Mejor cocinarlas.', 1790700000000, 5,   NULL, NULL, 0, 0, 0),
 ('raw_sardine',   'Sardina cruda',     '🐟', 0, 'Mejor cocinarla.', 1790700000000, 8,   NULL, NULL, 0, 0, 0),
 ('raw_herring',   'Arenque crudo',     '🐟', 0, 'Mejor cocinarlo.', 1790700000000, 12,  NULL, NULL, 0, 0, 0),
 ('raw_trout',     'Trucha cruda',      '🐟', 0, 'Mejor cocinarla.', 1790700000000, 20,  NULL, NULL, 0, 0, 0),
 ('raw_salmon',    'Salmón crudo',      '🐟', 0, 'Mejor cocinarlo.', 1790700000000, 35,  NULL, NULL, 0, 0, 0),
 ('raw_tuna',      'Atún crudo',        '🐟', 0, 'Mejor cocinarlo.', 1790700000000, 50,  NULL, NULL, 0, 0, 0),
 ('raw_swordfish', 'Pez espada crudo',  '🐡', 0, 'Mejor cocinarlo.', 1790700000000, 120, NULL, NULL, 0, 0, 0),
 ('raw_shark',     'Tiburón crudo',     '🦈', 0, 'Solo en las aguas profundas del Malpaís.', 1790700000000, 400, NULL, NULL, 0, 0, 0),
 ('shrimp',    'Gambas',     '🦐', 0, 'Cura 3 de vida.',  1790700000000, 8,   NULL, NULL, 0, 0, 0),
 ('sardine',   'Sardina',    '🐟', 0, 'Cura 4 de vida.',  1790700000000, 12,  NULL, NULL, 0, 0, 0),
 ('herring',   'Arenque',    '🐟', 0, 'Cura 5 de vida.',  1790700000000, 18,  NULL, NULL, 0, 0, 0),
 ('trout',     'Trucha',     '🐟', 0, 'Cura 7 de vida.',  1790700000000, 30,  NULL, NULL, 0, 0, 0),
 ('salmon',    'Salmón',     '🐟', 0, 'Cura 9 de vida.',  1790700000000, 50,  NULL, NULL, 0, 0, 0),
 ('tuna',      'Atún',       '🐟', 0, 'Cura 10 de vida.', 1790700000000, 70,  NULL, NULL, 0, 0, 0),
 ('swordfish', 'Pez espada', '🐡', 0, 'Cura 14 de vida.', 1790700000000, 180, NULL, NULL, 0, 0, 0),
 ('shark',     'Tiburón',    '🦈', 0, 'Cura 20 de vida.', 1790700000000, 600, NULL, NULL, 0, 0, 0),
 ('burnt_fish','Pescado quemado','🍂', 0, 'Se te ha quemado.', 1790700000000, 0, NULL, NULL, 0, 0, 0);

INSERT OR REPLACE INTO shop_stock (shop_id, item_id, current_qty, max_qty, buy_price, sell_price, last_restock_at) VALUES
 ('general_store', 'small_net',   5,   5,   2,  10, 0),
 ('general_store', 'fishing_rod', 5,   5,   2,  15, 0),
 ('general_store', 'harpoon',     3,   3,   20, 90, 0),
 ('general_store', 'feather',     500, 500, 1,  3,  0);
