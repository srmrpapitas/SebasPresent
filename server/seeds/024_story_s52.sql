-- Sesión 52 — Historia principal «El Sello de Achamán»: objetos, tibicenas, Guayota y su botín.
-- Re-ejecutable.
INSERT OR REPLACE INTO items (id,name,icon,stackable,description,created_at,base_price,equip_slot,weapon_type,attack_bonus,defence_bonus,ranged_bonus,strength_bonus,material,tier) VALUES
('muestra_azufre','Piedra de azufre','🟡',0,'Azufre tibio de la grieta de Las Cañadas. Late como si tuviera pulso.',1793000000000,1,NULL,NULL,0,0,0,0,NULL,NULL),
('lagrima_chaxiraxi','Lágrima de Chaxiraxi','💧',0,'Primera llave del sello de Achamán. Dentro, el agua se mueve como el mar.',1793000000000,1,NULL,NULL,0,0,0,0,NULL,NULL),
('piedra_echeyde','Piedra de Echeyde','🪨',0,'Segunda llave del sello. Una piedra negra que brilla como un ascua.',1793000000000,1,NULL,NULL,0,0,0,0,NULL,NULL),
('anepa_tinerfe','Añepa de Tinerfe','🦯',0,'Tercera llave del sello: el bastón del primer mencey de la isla.',1793000000000,1,NULL,NULL,0,0,0,0,NULL,NULL),
('corona_varkhul','Corona de Varkhul','👑',0,'Corona de hueso negro del mencey traidor. Deja caminar por el fuego de Guayota… y susurra.',1793000000000,1,NULL,NULL,0,0,0,0,NULL,NULL),
('cape_sello','Capa del Sello de Achamán','🌞',0,'La luz de Magec tejida en una capa. Solo la lleva quien volvió a sellar el Teide. +3 al golpe máximo de los hechizos.',1793000000000,200000,'cape',NULL,5,15,5,3,'sello',10),
('cape_guayota','Capa de Guayota','🔥',0,'Magma vivo que obedece a quien se quedó con el corazón de Guayota. Arde sin quemarte… todavía.',1793000000000,200000,'cape',NULL,10,12,0,9,'guayota',10);

INSERT OR REPLACE INTO npc_defs (id,name,max_hp,attack_lvl,strength_lvl,defence_lvl,attack_speed_ticks,max_hit,xp_per_kill,respawn_ms,spawn_x,spawn_z,attack_range,model,behavior,aggro_radius,style) VALUES
('tibicena','Tibicena',30,22,22,16,4,5,0,40000,420,-1560,1.6,'tibicena','aggressive',7,'melee'),
('tibicena_guayota','Tibicena de Guayota',50,62,58,42,4,9,0,999999999999,640,-1620,1.8,'tibicena','aggressive',30,'melee'),
('guayota','Guayota',700,80,76,70,5,26,0,180000,640,-1620,4.4,'guayota','boss',0,'magic');

-- Botín
DELETE FROM npc_loot_table WHERE npc_def_id IN ('tibicena','tibicena_guayota','guayota');
INSERT INTO npc_loot_table (npc_def_id,item_id,qty_min,qty_max,weight,is_always) VALUES
('tibicena','big_bones',1,1,1,1),('tibicena','coins',5,25,5,0),('tibicena','piel_lobo',1,1,3,0),('tibicena','raw_beef',1,1,2,0),
('tibicena_guayota','big_bones',1,1,1,1),
('guayota','super_bones',1,1,1,1),('guayota','shark',2,2,1,1),
('guayota','coins',6000,15000,30,0),('guayota','bar_teiderio',3,6,20,0),('guayota','arrow_teiderio',50,100,20,0),
('guayota','pocion_plegaria_3',2,4,15,0),('guayota','escama_dragon',2,4,10,0),('guayota','gs_guayota',1,1,2,0);

-- Instancias: 8 tibicenas en la grieta, 3 de Guayota DORMIDOS (los despierta en la fase 2) y Guayota.
DELETE FROM npc_instances WHERE def_id IN ('tibicena','tibicena_guayota','guayota');
INSERT INTO npc_instances (def_id, hp_current, x, z, status, spawn_x, spawn_z) VALUES
('tibicena',-1,410.5,-1548.2,0,410.5,-1548.2),('tibicena',-1,432.8,-1551.6,0,432.8,-1551.6),('tibicena',-1,438.1,-1569.9,0,438.1,-1569.9),
('tibicena',-1,425.2,-1577.4,0,425.2,-1577.4),('tibicena',-1,404.6,-1572.3,0,404.6,-1572.3),('tibicena',-1,399.8,-1556.1,0,399.8,-1556.1),
('tibicena',-1,418.9,-1540.2,0,418.9,-1540.2),('tibicena',-1,444.3,-1559.8,0,444.3,-1559.8),
('guayota',-1,640,-1620,0,640,-1620);
INSERT INTO npc_instances (def_id, hp_current, x, z, status, died_at, spawn_x, spawn_z) VALUES
('tibicena_guayota',-1,636,-1612,1,1793000000000,636,-1612),('tibicena_guayota',-1,646,-1626,1,1793000000000,646,-1626),('tibicena_guayota',-1,632,-1628,1,1793000000000,632,-1628);
UPDATE npc_instances SET hp_current = (SELECT max_hp FROM npc_defs WHERE id = npc_instances.def_id) WHERE hp_current = -1 AND def_id IN ('tibicena','tibicena_guayota','guayota');

-- Acólitos que guardan la subida al cráter (solo si no están ya)
INSERT INTO npc_instances (def_id, hp_current, x, z, status, spawn_x, spawn_z)
SELECT 'acolito_cabildo', (SELECT max_hp FROM npc_defs WHERE id = 'acolito_cabildo'), v.x, v.z, 0, v.x, v.z
FROM (SELECT 604.0 AS x, -1590.0 AS z UNION ALL SELECT 616.0, -1582.0 UNION ALL SELECT 598.0, -1600.0 UNION ALL SELECT 620.0, -1596.0) v
WHERE EXISTS (SELECT 1 FROM npc_defs WHERE id = 'acolito_cabildo')
  AND NOT EXISTS (SELECT 1 FROM npc_instances WHERE def_id = 'acolito_cabildo' AND spawn_x BETWEEN 590 AND 630 AND spawn_z BETWEEN -1610 AND -1575);

-- Sesión 52 — nombre viejo: el seed 009 llamaba "Morgath" a Chona (ya corregido en 012)
UPDATE npc_defs SET name = 'Chona' WHERE id = 'bruja_pantano';
