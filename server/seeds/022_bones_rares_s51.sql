-- Sesión 51 — Huesos grandes / súper huesos y objetos raros de los jefes
-- (idempotente: se puede ejecutar más de una vez)

-- 1) Objetos nuevos
INSERT OR REPLACE INTO items (id,name,icon,stackable,description,created_at,base_price) VALUES
('big_bones','Huesos grandes','🦴',1,'Huesos de un animal grande. Entiérralos: 20 XP de Plegaria.',0,400),
('super_bones','Súper huesos','🦴',1,'Huesos de un jefe legendario. Entiérralos: 2000 XP de Plegaria.',0,40000);

-- 2) Jefes → súper huesos (siempre)
UPDATE npc_loot_table SET item_id = 'super_bones'
 WHERE item_id = 'bones' AND npc_def_id IN ('dragon_negro','dragon_rojo','coloso_obsidiana','rey_esqueleto','leviatan','magister_cabildo','reina_escorpion','rey_yeti','bruja_pantano');

-- 3) Animales grandes → huesos grandes (siempre)
UPDATE npc_loot_table SET item_id = 'big_bones'
 WHERE item_id = 'bones' AND npc_def_id IN ('ogro_anaga','ogro_anaga_jefe','yeti','yeti_jefe','bruto_echeyde','boar_jefe','wolf_jefe','zombi_igneo_jefe');

-- 4) Raros de jefe: el resto de la tabla ×5 (una sola vez) para que el raro
--    pueda ser más raro que una pieza de dragón (1/50 frente a 1/20)
UPDATE npc_loot_table SET weight = weight * 5
 WHERE is_always = 0
   AND npc_def_id IN ('dragon_negro','dragon_rojo','coloso_obsidiana','rey_esqueleto','leviatan','magister_cabildo','reina_escorpion','rey_yeti','bruja_pantano')
   AND npc_def_id NOT IN (SELECT npc_def_id FROM npc_loot_table
                           WHERE item_id IN ('claws_dragon','cape_magma','gs_guayota','gs_tibicena','gs_magec','gs_achaman','sword_tindaya','dagger_dragon','cape_achaman','cape_magec','cape_chaxiraxi'));

WITH v(npc, item, w) AS (VALUES ('dragon_negro','claws_dragon',2),('dragon_negro','dagger_dragon',4),('dragon_rojo','cape_magma',2),('dragon_rojo','dagger_dragon',4),('coloso_obsidiana','gs_guayota',2),('rey_esqueleto','gs_tibicena',2),('reina_escorpion','gs_magec',2),('rey_yeti','gs_achaman',2),('bruja_pantano','sword_tindaya',2),('leviatan','dagger_dragon',4),('leviatan','cape_chaxiraxi',3),('magister_cabildo','cape_achaman',3),('magister_cabildo','cape_magec',3),('magister_cabildo','cape_chaxiraxi',3))
INSERT INTO npc_loot_table (npc_def_id, item_id, qty_min, qty_max, weight, is_always)
SELECT v.npc, v.item, 1, 1, v.w, 0 FROM v
WHERE NOT EXISTS (SELECT 1 FROM npc_loot_table l WHERE l.npc_def_id = v.npc AND l.item_id = v.item)
  AND EXISTS (SELECT 1 FROM npc_defs d WHERE d.id = v.npc)
  AND EXISTS (SELECT 1 FROM items i WHERE i.id = v.item);
