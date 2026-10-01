-- Sesión 50 — Robo: el pan y los guardias que te persiguen si te pillan.
INSERT OR REPLACE INTO items (id,name,icon,stackable,equip_slot,weapon_type,attack_bonus,defence_bonus,ranged_bonus,material,tier,smith_level,bars_required,base_price,description,created_at) VALUES ('pan','Pan','🍞',0,NULL,NULL,0,0,0,NULL,NULL,NULL,NULL,8,'Pan de leña, todavía tibio. Cura 4 de vida.',0);
INSERT OR REPLACE INTO npc_defs (id,name,max_hp,attack_lvl,strength_lvl,defence_lvl,attack_speed_ticks,max_hit,xp_per_kill,respawn_ms,spawn_x,spawn_z,attack_range,model,behavior,aggro_radius,style) VALUES ('guardia_ciudad','Guardia',60,40,38,40,4,6,0,600000,0,0,1.6,'guardia_ciudad','aggressive',16,'melee');
DELETE FROM npc_loot_table WHERE npc_def_id = 'guardia_ciudad';
INSERT INTO npc_loot_table (npc_def_id,item_id,qty_min,qty_max,weight,is_always) VALUES ('guardia_ciudad','bones',1,1,1,1),('guardia_ciudad','coins',5,25,3,0),('guardia_ciudad','pan',1,1,2,0);
