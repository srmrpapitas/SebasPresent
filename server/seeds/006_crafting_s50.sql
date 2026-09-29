-- Sesión 50 — Flechería y Artesanía: herramientas, materiales, flechas,
-- arcos y armadura de cuero. Idempotente.
INSERT OR IGNORE INTO items (id,name,icon,stackable,description,created_at,base_price,equip_slot,weapon_type,attack_bonus,defence_bonus,ranged_bonus,material,tier) VALUES
 ('knife','Cuchillo','🔪',0,'Para tallar madera (Flechería).',1790900000000,5,NULL,NULL,0,0,0,NULL,NULL),
 ('needle','Aguja','🪡',0,'Para coser cuero (Artesanía).',1790900000000,5,NULL,NULL,0,0,0,NULL,NULL),
 ('thread','Hilo','🧵',1,'Se gasta al coser.',1790900000000,1,NULL,NULL,0,0,0,NULL,NULL),
 ('arrow_shaft','Astil','🥢',1,'Palo recto para flechas.',1790900000000,1,NULL,NULL,0,0,0,NULL,NULL),
 ('headless_arrow','Flecha sin punta','➳',1,'Astil con plumas. Falta la punta de metal.',1790900000000,2,NULL,NULL,0,0,0,NULL,NULL),
 ('bowstring','Cuerda de arco','〰️',1,'Para montar arcos.',1790900000000,5,NULL,NULL,0,0,0,NULL,NULL),
 ('arrow_hierro','Flecha de hierro','➳',1,NULL,1790900000000,3,NULL,NULL,0,0,2,'hierro',2),
 ('arrow_acero','Flecha de acero','➳',1,NULL,1790900000000,6,NULL,NULL,0,0,4,'acero',3),
 ('arrow_oro','Flecha de oro','➳',1,NULL,1790900000000,12,NULL,NULL,0,0,6,'oro',4),
 ('arrow_obsidiana','Flecha de obsidiana','➳',1,NULL,1790900000000,25,NULL,NULL,0,0,9,'obsidiana',5),
 ('arrow_basaltita','Flecha de basaltita','➳',1,NULL,1790900000000,45,NULL,NULL,0,0,12,'basaltita',6),
 ('arrow_teiderio','Flecha de teiderio','➳',1,NULL,1790900000000,80,NULL,NULL,0,0,15,'teiderio',7),
 ('bow_willow','Arco de sauce','🏹',0,NULL,1790900000000,400,'weapon','bow',0,0,12,NULL,NULL),
 ('bow_maple','Arco de arce','🏹',0,NULL,1790900000000,900,'weapon','bow',0,0,18,NULL,NULL),
 ('bow_yew','Arco de tejo','🏹',0,NULL,1790900000000,2000,'weapon','bow',0,0,26,NULL,NULL),
 ('bow_magic','Arco mágico','🏹',0,NULL,1790900000000,4500,'weapon','bow',0,0,35,NULL,NULL),
 ('gloves_cuero','Guantes de cuero','🧤',0,NULL,1790900000000,20,'gloves',NULL,0,1,1,'cuero',0),
 ('boots_cuero','Botas de cuero','🥾',0,NULL,1790900000000,25,'boots',NULL,0,1,1,'cuero',0),
 ('helm_cuero','Capucha de cuero','⛑',0,NULL,1790900000000,30,'helm',NULL,0,2,2,'cuero',0),
 ('body_cuero','Chaqueta de cuero','🛡',0,NULL,1790900000000,60,'body',NULL,0,5,4,'cuero',0),
 ('legs_cuero','Pantalones de cuero','👖',0,NULL,1790900000000,45,'legs',NULL,0,3,3,'cuero',0);

INSERT OR REPLACE INTO shop_stock (shop_id, item_id, current_qty, max_qty, buy_price, sell_price, last_restock_at) VALUES
 ('general_store', 'knife',  10,  10,  1, 5, 0),
 ('general_store', 'needle', 10,  10,  1, 5, 0),
 ('general_store', 'thread', 500, 500, 0, 1, 0);
