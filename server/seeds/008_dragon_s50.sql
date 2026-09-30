-- Sesión 50 — Equipo de dragón. NO se fabrica: cada jefe suelta una pieza (1/20).
-- Requisito: nivel 60 (Defensa para la armadura, Distancia para el arco, Magia para el bastón).
INSERT OR REPLACE INTO items (id,name,icon,stackable,equip_slot,weapon_type,attack_bonus,defence_bonus,ranged_bonus,material,tier,smith_level,bars_required,base_price,description,created_at) VALUES
('helm_dragon','Yelmo de dragón','⛑',0,'helm',NULL,0,17,0,'dragon',8,NULL,NULL,60000,'Forjado con escamas de dragón. Lo suelta un jefe.',0),
('body_dragon','Pechera de dragón','🛡',0,'body',NULL,0,42,0,'dragon',8,NULL,NULL,180000,'Escamas de dragón superpuestas. Lo suelta un jefe.',0),
('legs_dragon','Grebas de dragón','👖',0,'legs',NULL,0,26,0,'dragon',8,NULL,NULL,120000,'Escamas de dragón. Lo suelta un jefe.',0),
('boots_dragon','Botas de dragón','🥾',0,'boots',NULL,0,9,0,'dragon',8,NULL,NULL,50000,'Garras de dragón en la punta. Lo suelta un jefe.',0),
('gloves_dragon','Guantes de dragón','🧤',0,'gloves',NULL,9,9,0,'dragon',8,NULL,NULL,50000,'Guanteletes de escama. Lo suelta un jefe.',0),
('shield_dragon','Escudo de dragón','🛡',0,'shield',NULL,0,26,0,'dragon',8,NULL,NULL,120000,'Escudo de escamas de dragón. Lo suelta un jefe.',0),
('bow_dragon','Arco de garras de dragón','🏹',0,'weapon','bow',0,0,45,'dragon',8,NULL,NULL,250000,'Palas de garras de dragón y cuerda de fuego. Ataque especial: Aliento del dragón.',0),
('staff_dragomante','Bastón de Dragomante','🪄',0,'weapon','staff',0,5,0,'dragon',8,NULL,NULL,220000,'Cráneo de dragón con un orbe de fuego. +5 al daño de los hechizos y +60 de maná.',0);
