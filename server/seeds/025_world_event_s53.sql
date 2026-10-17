-- Sesión 53 — Evento de la isla «¡El Teide ruge!»: la Tibicena Mayor (dormida hasta que empieza el evento).
-- Re-ejecutable.
INSERT OR REPLACE INTO npc_defs (id,name,max_hp,attack_lvl,strength_lvl,defence_lvl,attack_speed_ticks,max_hit,xp_per_kill,respawn_ms,spawn_x,spawn_z,attack_range,model,behavior,aggro_radius,style) VALUES
('tibicena_mayor','Tibicena Mayor',1600,45,40,30,5,12,0,999999999999,465,-835,3.6,'tibicena','boss',0,'melee');

DELETE FROM npc_loot_table WHERE npc_def_id = 'tibicena_mayor';
INSERT INTO npc_loot_table (npc_def_id,item_id,qty_min,qty_max,weight,is_always) VALUES
('tibicena_mayor','super_bones',1,1,1,1),
('tibicena_mayor','shark',3,5,25,0),('tibicena_mayor','pocion_plegaria_3',2,3,20,0),
('tibicena_mayor','bar_teiderio',2,4,15,0),('tibicena_mayor','arrow_teiderio',40,80,15,0),
('tibicena_mayor','coins',2000,5000,14,0),('tibicena_mayor','escama_dragon',1,2,10,0),
('tibicena_mayor','gs_guayota',1,1,1,0);

-- Una sola instancia, dormida (la despierta el cron al empezar el evento).
DELETE FROM npc_instances WHERE def_id = 'tibicena_mayor';
INSERT INTO npc_instances (def_id, hp_current, x, z, status, died_at, spawn_x, spawn_z) VALUES
('tibicena_mayor', 1600, 465, -835, 1, 0, 465, -835);
