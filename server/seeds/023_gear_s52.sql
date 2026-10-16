-- Sesión 52 — armaduras de arquero por animal + túnicas de mago (generado por scripts/gen_gear_s52.mjs)
INSERT OR REPLACE INTO items (id,name,icon,stackable,description,created_at,base_price,equip_slot,weapon_type,attack_bonus,defence_bonus,ranged_bonus,material,tier) VALUES
('piel_lobo','Piel de lobo','🐺',0,'Piel sin curtir. Cúrtela (Artesanía 20) para coser armadura de arquero.',1793000000000,35,NULL,NULL,0,0,0,NULL,NULL),
('cuero_lobo','Cuero de lobo','🟫',1,'Cuero de lobo curtido. Con aguja e hilo: armadura de arquero (Artesanía 20+).',1793000000000,60,NULL,NULL,0,0,0,NULL,NULL),
('caparazon_escorpion','Caparazón de escorpión','🦂',0,'Caparazón duro. Límpialo (Artesanía 35) para sacar placas.',1793000000000,90,NULL,NULL,0,0,0,NULL,NULL),
('placa_escorpion','Placa de escorpión','🟧',1,'Placa de quitina. Con aguja e hilo: armadura de arquero (Artesanía 35+).',1793000000000,150,NULL,NULL,0,0,0,NULL,NULL),
('piel_yeti','Piel de yeti','🤍',0,'Piel blanca y espesa. Cúrtela (Artesanía 50).',1793000000000,240,NULL,NULL,0,0,0,NULL,NULL),
('cuero_yeti','Cuero de yeti','⬜',1,'Cuero de yeti curtido. Frena muy bien la magia. Armadura de arquero (Artesanía 50+).',1793000000000,400,NULL,NULL,0,0,0,NULL,NULL),
('escama_dragon','Escama de dragón','🔺',1,'Escama de Vermithrax o Nidhogg. Con aguja e hilo: armadura de arquero (Artesanía 70+).',1793000000000,1500,NULL,NULL,0,0,0,NULL,NULL),
('tela_algodon','Tela de algodón','🧻',1,'Para coser túnicas de mago (Artesanía 1+).',1793000000000,15,NULL,NULL,0,0,0,NULL,NULL),
('tela_lino','Tela de lino','📜',1,'Para coser túnicas de mago (Artesanía 25+).',1793000000000,50,NULL,NULL,0,0,0,NULL,NULL),
('tela_seda','Tela de seda','🎀',1,'Para coser túnicas de mago (Artesanía 45+).',1793000000000,150,NULL,NULL,0,0,0,NULL,NULL),
('helm_lobo','Capucha de lobo','⛑',0,'Armadura de arquero. Necesitas nivel 20 de Distancia. Frena la magia.',1793000000000,45,'helm',NULL,0,4,3,'lobo',0),
('body_lobo','Chaqueta de lobo','🛡',0,'Armadura de arquero. Necesitas nivel 20 de Distancia. Frena la magia.',1793000000000,90,'body',NULL,0,9,6,'lobo',0),
('legs_lobo','Pantalones de lobo','👖',0,'Armadura de arquero. Necesitas nivel 20 de Distancia. Frena la magia.',1793000000000,68,'legs',NULL,0,6,5,'lobo',0),
('gloves_lobo','Guantes de lobo','🧤',0,'Armadura de arquero. Necesitas nivel 20 de Distancia. Frena la magia.',1793000000000,31,'gloves',NULL,0,2,2,'lobo',0),
('boots_lobo','Botas de lobo','🥾',0,'Armadura de arquero. Necesitas nivel 20 de Distancia. Frena la magia.',1793000000000,36,'boots',NULL,0,2,2,'lobo',0),
('helm_escorpion','Capucha de escorpión','⛑',0,'Armadura de arquero. Necesitas nivel 35 de Distancia. Frena la magia.',1793000000000,120,'helm',NULL,0,6,4,'escorpion',0),
('body_escorpion','Chaqueta de escorpión','🛡',0,'Armadura de arquero. Necesitas nivel 35 de Distancia. Frena la magia.',1793000000000,240,'body',NULL,0,14,9,'escorpion',0),
('legs_escorpion','Pantalones de escorpión','👖',0,'Armadura de arquero. Necesitas nivel 35 de Distancia. Frena la magia.',1793000000000,180,'legs',NULL,0,9,7,'escorpion',0),
('gloves_escorpion','Guantes de escorpión','🧤',0,'Armadura de arquero. Necesitas nivel 35 de Distancia. Frena la magia.',1793000000000,84,'gloves',NULL,0,3,3,'escorpion',0),
('boots_escorpion','Botas de escorpión','🥾',0,'Armadura de arquero. Necesitas nivel 35 de Distancia. Frena la magia.',1793000000000,96,'boots',NULL,0,3,3,'escorpion',0),
('helm_yeti','Capucha de yeti','⛑',0,'Armadura de arquero. Necesitas nivel 50 de Distancia. Frena la magia.',1793000000000,325,'helm',NULL,0,8,6,'yeti',0),
('body_yeti','Chaqueta de yeti','🛡',0,'Armadura de arquero. Necesitas nivel 50 de Distancia. Frena la magia.',1793000000000,650,'body',NULL,0,18,12,'yeti',0),
('legs_yeti','Pantalones de yeti','👖',0,'Armadura de arquero. Necesitas nivel 50 de Distancia. Frena la magia.',1793000000000,488,'legs',NULL,0,12,9,'yeti',0),
('gloves_yeti','Guantes de yeti','🧤',0,'Armadura de arquero. Necesitas nivel 50 de Distancia. Frena la magia.',1793000000000,227,'gloves',NULL,0,4,4,'yeti',0),
('boots_yeti','Botas de yeti','🥾',0,'Armadura de arquero. Necesitas nivel 50 de Distancia. Frena la magia.',1793000000000,260,'boots',NULL,0,4,3,'yeti',0),
('helm_escama','Capucha de escamas de dragón','⛑',0,'Armadura de arquero. Necesitas nivel 70 de Distancia. Frena la magia.',1793000000000,3000,'helm',NULL,0,10,7,'escama',0),
('body_escama','Chaqueta de escamas de dragón','🛡',0,'Armadura de arquero. Necesitas nivel 70 de Distancia. Frena la magia.',1793000000000,6000,'body',NULL,0,24,16,'escama',0),
('legs_escama','Pantalones de escamas de dragón','👖',0,'Armadura de arquero. Necesitas nivel 70 de Distancia. Frena la magia.',1793000000000,4500,'legs',NULL,0,16,12,'escama',0),
('gloves_escama','Guantes de escamas de dragón','🧤',0,'Armadura de arquero. Necesitas nivel 70 de Distancia. Frena la magia.',1793000000000,2100,'gloves',NULL,0,5,5,'escama',0),
('boots_escama','Botas de escamas de dragón','🥾',0,'Armadura de arquero. Necesitas nivel 70 de Distancia. Frena la magia.',1793000000000,2400,'boots',NULL,0,5,4,'escama',0),
('helm_algodon','Sombrero de algodón','🎩',0,'Ropa de mago. Cada pieza suma poder mágico (golpe máximo de los hechizos) y maná.',1793000000000,20,'helm',NULL,0,1,0,'algodon',0),
('body_algodon','Túnica de algodón','🥋',0,'Ropa de mago. Cada pieza suma poder mágico (golpe máximo de los hechizos) y maná.',1793000000000,40,'body',NULL,0,2,0,'algodon',0),
('legs_algodon','Falda de algodón','👗',0,'Ropa de mago. Cada pieza suma poder mágico (golpe máximo de los hechizos) y maná.',1793000000000,30,'legs',NULL,0,1,0,'algodon',0),
('gloves_algodon','Guantes de algodón','🧤',0,'Ropa de mago. Cada pieza suma poder mágico (golpe máximo de los hechizos) y maná.',1793000000000,14,'gloves',NULL,0,0,0,'algodon',0),
('boots_algodon','Botas de algodón','🥿',0,'Ropa de mago. Cada pieza suma poder mágico (golpe máximo de los hechizos) y maná.',1793000000000,16,'boots',NULL,0,1,0,'algodon',0),
('helm_lino','Sombrero de lino','🎩',0,'Ropa de mago. Necesitas nivel 25 de Magia. Cada pieza suma poder mágico (golpe máximo de los hechizos) y maná.',1793000000000,80,'helm',NULL,0,1,0,'lino',0),
('body_lino','Túnica de lino','🥋',0,'Ropa de mago. Necesitas nivel 25 de Magia. Cada pieza suma poder mágico (golpe máximo de los hechizos) y maná.',1793000000000,160,'body',NULL,0,3,0,'lino',0),
('legs_lino','Falda de lino','👗',0,'Ropa de mago. Necesitas nivel 25 de Magia. Cada pieza suma poder mágico (golpe máximo de los hechizos) y maná.',1793000000000,120,'legs',NULL,0,2,0,'lino',0),
('gloves_lino','Guantes de lino','🧤',0,'Ropa de mago. Necesitas nivel 25 de Magia. Cada pieza suma poder mágico (golpe máximo de los hechizos) y maná.',1793000000000,56,'gloves',NULL,0,1,0,'lino',0),
('boots_lino','Botas de lino','🥿',0,'Ropa de mago. Necesitas nivel 25 de Magia. Cada pieza suma poder mágico (golpe máximo de los hechizos) y maná.',1793000000000,64,'boots',NULL,0,1,0,'lino',0),
('helm_seda','Sombrero de seda','🎩',0,'Ropa de mago. Necesitas nivel 45 de Magia. Cada pieza suma poder mágico (golpe máximo de los hechizos) y maná.',1793000000000,260,'helm',NULL,0,2,0,'seda',0),
('body_seda','Túnica de seda','🥋',0,'Ropa de mago. Necesitas nivel 45 de Magia. Cada pieza suma poder mágico (golpe máximo de los hechizos) y maná.',1793000000000,520,'body',NULL,0,4,0,'seda',0),
('legs_seda','Falda de seda','👗',0,'Ropa de mago. Necesitas nivel 45 de Magia. Cada pieza suma poder mágico (golpe máximo de los hechizos) y maná.',1793000000000,390,'legs',NULL,0,3,0,'seda',0),
('gloves_seda','Guantes de seda','🧤',0,'Ropa de mago. Necesitas nivel 45 de Magia. Cada pieza suma poder mágico (golpe máximo de los hechizos) y maná.',1793000000000,182,'gloves',NULL,0,1,0,'seda',0),
('boots_seda','Botas de seda','🥿',0,'Ropa de mago. Necesitas nivel 45 de Magia. Cada pieza suma poder mágico (golpe máximo de los hechizos) y maná.',1793000000000,208,'boots',NULL,0,1,0,'seda',0),
('helm_cabildo','Sombrero del Cabildo','🎩',0,'Ropa de mago. Necesitas nivel 60 de Magia. Cada pieza suma poder mágico (golpe máximo de los hechizos) y maná.',1793000000000,4500,'helm',NULL,0,2,0,'cabildo',0),
('body_cabildo','Túnica del Cabildo','🥋',0,'Ropa de mago. Necesitas nivel 60 de Magia. Cada pieza suma poder mágico (golpe máximo de los hechizos) y maná.',1793000000000,9000,'body',NULL,0,5,0,'cabildo',0),
('legs_cabildo','Falda del Cabildo','👗',0,'Ropa de mago. Necesitas nivel 60 de Magia. Cada pieza suma poder mágico (golpe máximo de los hechizos) y maná.',1793000000000,6750,'legs',NULL,0,4,0,'cabildo',0),
('gloves_cabildo','Guantes del Cabildo','🧤',0,'Ropa de mago. Necesitas nivel 60 de Magia. Cada pieza suma poder mágico (golpe máximo de los hechizos) y maná.',1793000000000,3150,'gloves',NULL,0,2,0,'cabildo',0),
('boots_cabildo','Botas del Cabildo','🥿',0,'Ropa de mago. Necesitas nivel 60 de Magia. Cada pieza suma poder mágico (golpe máximo de los hechizos) y maná.',1793000000000,3600,'boots',NULL,0,2,0,'cabildo',0),
('helm_magister','Sombrero del Magister','🎩',0,'Ropa de mago. Necesitas nivel 70 de Magia. Cada pieza suma poder mágico (golpe máximo de los hechizos) y maná.',1793000000000,30000,'helm',NULL,0,3,0,'magister',0),
('body_magister','Túnica del Magister','🥋',0,'Ropa de mago. Necesitas nivel 70 de Magia. Cada pieza suma poder mágico (golpe máximo de los hechizos) y maná.',1793000000000,60000,'body',NULL,0,7,0,'magister',0),
('legs_magister','Falda del Magister','👗',0,'Ropa de mago. Necesitas nivel 70 de Magia. Cada pieza suma poder mágico (golpe máximo de los hechizos) y maná.',1793000000000,45000,'legs',NULL,0,5,0,'magister',0),
('gloves_magister','Guantes del Magister','🧤',0,'Ropa de mago. Necesitas nivel 70 de Magia. Cada pieza suma poder mágico (golpe máximo de los hechizos) y maná.',1793000000000,21000,'gloves',NULL,0,2,0,'magister',0),
('boots_magister','Botas del Magister','🥿',0,'Ropa de mago. Necesitas nivel 70 de Magia. Cada pieza suma poder mágico (golpe máximo de los hechizos) y maná.',1793000000000,24000,'boots',NULL,0,2,0,'magister',0);
-- Animales: su piel
INSERT INTO npc_loot_table (npc_def_id,item_id,qty_min,qty_max,weight,is_always) SELECT 'wolf','piel_lobo',1,1,4,0 WHERE NOT EXISTS (SELECT 1 FROM npc_loot_table WHERE npc_def_id='wolf' AND item_id='piel_lobo') AND EXISTS (SELECT 1 FROM npc_defs WHERE id='wolf');
INSERT INTO npc_loot_table (npc_def_id,item_id,qty_min,qty_max,weight,is_always) SELECT 'scorpion','caparazon_escorpion',1,1,4,0 WHERE NOT EXISTS (SELECT 1 FROM npc_loot_table WHERE npc_def_id='scorpion' AND item_id='caparazon_escorpion') AND EXISTS (SELECT 1 FROM npc_defs WHERE id='scorpion');
INSERT INTO npc_loot_table (npc_def_id,item_id,qty_min,qty_max,weight,is_always) SELECT 'yeti','piel_yeti',1,1,5,0 WHERE NOT EXISTS (SELECT 1 FROM npc_loot_table WHERE npc_def_id='yeti' AND item_id='piel_yeti') AND EXISTS (SELECT 1 FROM npc_defs WHERE id='yeti');
-- Jefes: muchas pieles / escamas
INSERT INTO npc_loot_table (npc_def_id,item_id,qty_min,qty_max,weight,is_always) SELECT 'rey_yeti','piel_yeti',5,10,15,0 WHERE NOT EXISTS (SELECT 1 FROM npc_loot_table WHERE npc_def_id='rey_yeti' AND item_id='piel_yeti') AND EXISTS (SELECT 1 FROM npc_defs WHERE id='rey_yeti');
INSERT INTO npc_loot_table (npc_def_id,item_id,qty_min,qty_max,weight,is_always) SELECT 'reina_escorpion','caparazon_escorpion',5,10,15,0 WHERE NOT EXISTS (SELECT 1 FROM npc_loot_table WHERE npc_def_id='reina_escorpion' AND item_id='caparazon_escorpion') AND EXISTS (SELECT 1 FROM npc_defs WHERE id='reina_escorpion');
INSERT INTO npc_loot_table (npc_def_id,item_id,qty_min,qty_max,weight,is_always) SELECT 'dragon_rojo','escama_dragon',1,2,1,1 WHERE NOT EXISTS (SELECT 1 FROM npc_loot_table WHERE npc_def_id='dragon_rojo' AND item_id='escama_dragon') AND EXISTS (SELECT 1 FROM npc_defs WHERE id='dragon_rojo');
INSERT INTO npc_loot_table (npc_def_id,item_id,qty_min,qty_max,weight,is_always) SELECT 'dragon_negro','escama_dragon',1,2,1,1 WHERE NOT EXISTS (SELECT 1 FROM npc_loot_table WHERE npc_def_id='dragon_negro' AND item_id='escama_dragon') AND EXISTS (SELECT 1 FROM npc_defs WHERE id='dragon_negro');
-- Acólitos del Cabildo: ropa del Cabildo (rara). Se multiplica antes su tabla ×4 (una sola vez)
UPDATE npc_loot_table SET weight = weight * 4 WHERE npc_def_id='acolito_cabildo' AND is_always=0 AND NOT EXISTS (SELECT 1 FROM npc_loot_table WHERE npc_def_id='acolito_cabildo' AND item_id LIKE '%_cabildo');
INSERT INTO npc_loot_table (npc_def_id,item_id,qty_min,qty_max,weight,is_always) SELECT 'acolito_cabildo','helm_cabildo',1,1,1,0 WHERE NOT EXISTS (SELECT 1 FROM npc_loot_table WHERE npc_def_id='acolito_cabildo' AND item_id='helm_cabildo') AND EXISTS (SELECT 1 FROM npc_defs WHERE id='acolito_cabildo');
INSERT INTO npc_loot_table (npc_def_id,item_id,qty_min,qty_max,weight,is_always) SELECT 'acolito_cabildo','body_cabildo',1,1,1,0 WHERE NOT EXISTS (SELECT 1 FROM npc_loot_table WHERE npc_def_id='acolito_cabildo' AND item_id='body_cabildo') AND EXISTS (SELECT 1 FROM npc_defs WHERE id='acolito_cabildo');
INSERT INTO npc_loot_table (npc_def_id,item_id,qty_min,qty_max,weight,is_always) SELECT 'acolito_cabildo','legs_cabildo',1,1,1,0 WHERE NOT EXISTS (SELECT 1 FROM npc_loot_table WHERE npc_def_id='acolito_cabildo' AND item_id='legs_cabildo') AND EXISTS (SELECT 1 FROM npc_defs WHERE id='acolito_cabildo');
INSERT INTO npc_loot_table (npc_def_id,item_id,qty_min,qty_max,weight,is_always) SELECT 'acolito_cabildo','gloves_cabildo',1,1,1,0 WHERE NOT EXISTS (SELECT 1 FROM npc_loot_table WHERE npc_def_id='acolito_cabildo' AND item_id='gloves_cabildo') AND EXISTS (SELECT 1 FROM npc_defs WHERE id='acolito_cabildo');
INSERT INTO npc_loot_table (npc_def_id,item_id,qty_min,qty_max,weight,is_always) SELECT 'acolito_cabildo','boots_cabildo',1,1,1,0 WHERE NOT EXISTS (SELECT 1 FROM npc_loot_table WHERE npc_def_id='acolito_cabildo' AND item_id='boots_cabildo') AND EXISTS (SELECT 1 FROM npc_defs WHERE id='acolito_cabildo');
-- Chona y el Magister Perdomo: ropa del Magister (1 de ~20 cada pieza)
INSERT INTO npc_loot_table (npc_def_id,item_id,qty_min,qty_max,weight,is_always) SELECT 'bruja_pantano','helm_magister',1,1,5,0 WHERE NOT EXISTS (SELECT 1 FROM npc_loot_table WHERE npc_def_id='bruja_pantano' AND item_id='helm_magister') AND EXISTS (SELECT 1 FROM npc_defs WHERE id='bruja_pantano');
INSERT INTO npc_loot_table (npc_def_id,item_id,qty_min,qty_max,weight,is_always) SELECT 'bruja_pantano','body_magister',1,1,5,0 WHERE NOT EXISTS (SELECT 1 FROM npc_loot_table WHERE npc_def_id='bruja_pantano' AND item_id='body_magister') AND EXISTS (SELECT 1 FROM npc_defs WHERE id='bruja_pantano');
INSERT INTO npc_loot_table (npc_def_id,item_id,qty_min,qty_max,weight,is_always) SELECT 'bruja_pantano','legs_magister',1,1,5,0 WHERE NOT EXISTS (SELECT 1 FROM npc_loot_table WHERE npc_def_id='bruja_pantano' AND item_id='legs_magister') AND EXISTS (SELECT 1 FROM npc_defs WHERE id='bruja_pantano');
INSERT INTO npc_loot_table (npc_def_id,item_id,qty_min,qty_max,weight,is_always) SELECT 'bruja_pantano','gloves_magister',1,1,5,0 WHERE NOT EXISTS (SELECT 1 FROM npc_loot_table WHERE npc_def_id='bruja_pantano' AND item_id='gloves_magister') AND EXISTS (SELECT 1 FROM npc_defs WHERE id='bruja_pantano');
INSERT INTO npc_loot_table (npc_def_id,item_id,qty_min,qty_max,weight,is_always) SELECT 'bruja_pantano','boots_magister',1,1,5,0 WHERE NOT EXISTS (SELECT 1 FROM npc_loot_table WHERE npc_def_id='bruja_pantano' AND item_id='boots_magister') AND EXISTS (SELECT 1 FROM npc_defs WHERE id='bruja_pantano');
INSERT INTO npc_loot_table (npc_def_id,item_id,qty_min,qty_max,weight,is_always) SELECT 'magister_cabildo','helm_magister',1,1,5,0 WHERE NOT EXISTS (SELECT 1 FROM npc_loot_table WHERE npc_def_id='magister_cabildo' AND item_id='helm_magister') AND EXISTS (SELECT 1 FROM npc_defs WHERE id='magister_cabildo');
INSERT INTO npc_loot_table (npc_def_id,item_id,qty_min,qty_max,weight,is_always) SELECT 'magister_cabildo','body_magister',1,1,5,0 WHERE NOT EXISTS (SELECT 1 FROM npc_loot_table WHERE npc_def_id='magister_cabildo' AND item_id='body_magister') AND EXISTS (SELECT 1 FROM npc_defs WHERE id='magister_cabildo');
INSERT INTO npc_loot_table (npc_def_id,item_id,qty_min,qty_max,weight,is_always) SELECT 'magister_cabildo','legs_magister',1,1,5,0 WHERE NOT EXISTS (SELECT 1 FROM npc_loot_table WHERE npc_def_id='magister_cabildo' AND item_id='legs_magister') AND EXISTS (SELECT 1 FROM npc_defs WHERE id='magister_cabildo');
INSERT INTO npc_loot_table (npc_def_id,item_id,qty_min,qty_max,weight,is_always) SELECT 'magister_cabildo','gloves_magister',1,1,5,0 WHERE NOT EXISTS (SELECT 1 FROM npc_loot_table WHERE npc_def_id='magister_cabildo' AND item_id='gloves_magister') AND EXISTS (SELECT 1 FROM npc_defs WHERE id='magister_cabildo');
INSERT INTO npc_loot_table (npc_def_id,item_id,qty_min,qty_max,weight,is_always) SELECT 'magister_cabildo','boots_magister',1,1,5,0 WHERE NOT EXISTS (SELECT 1 FROM npc_loot_table WHERE npc_def_id='magister_cabildo' AND item_id='boots_magister') AND EXISTS (SELECT 1 FROM npc_defs WHERE id='magister_cabildo');
-- Telas a la venta
INSERT OR IGNORE INTO shop_stock (shop_id,item_id,current_qty,max_qty,buy_price,sell_price,last_restock_at) VALUES ('pieles_esperanza','tela_algodon',200,200,6,15,0);
INSERT OR IGNORE INTO shop_stock (shop_id,item_id,current_qty,max_qty,buy_price,sell_price,last_restock_at) VALUES ('pieles_esperanza','tela_lino',100,100,20,50,0);
INSERT OR IGNORE INTO shop_stock (shop_id,item_id,current_qty,max_qty,buy_price,sell_price,last_restock_at) VALUES ('pieles_esperanza','tela_seda',50,50,60,150,0);
INSERT OR IGNORE INTO shop_stock (shop_id,item_id,current_qty,max_qty,buy_price,sell_price,last_restock_at) VALUES ('magic_store','tela_algodon',200,200,6,15,0);
INSERT OR IGNORE INTO shop_stock (shop_id,item_id,current_qty,max_qty,buy_price,sell_price,last_restock_at) VALUES ('magic_store','tela_lino',100,100,20,50,0);
INSERT OR IGNORE INTO shop_stock (shop_id,item_id,current_qty,max_qty,buy_price,sell_price,last_restock_at) VALUES ('magic_store','tela_seda',50,50,60,150,0);
