-- Sesión 50 — Espadas, espadones y escudos de los 7 materiales (forjables en el yunque)
INSERT OR IGNORE INTO items (id,name,icon,stackable,description,created_at,base_price,equip_slot,weapon_type,attack_bonus,defence_bonus,ranged_bonus,material,tier,smith_level,bars_required) VALUES
 ('sword_hierro','Espada de Hierro','⚔️',0,'Espada de una mano.',1790800000000,135,'weapon','1h_sword',8,0,0,'hierro',2,5,1),
 ('sword_hierro_2h','Espadón de Hierro','⚔',0,'Espada a dos manos: más daño, sin escudo.',1790800000000,390,'weapon','2h_sword',15,0,0,'hierro',2,9,3),
 ('shield_hierro','Escudo de Hierro','🛡',0,'Escudo redondo.',1790800000000,260,'shield',NULL,0,6,0,'hierro',2,7,2),
 ('sword_acero','Espada de Acero','⚔️',0,'Espada de una mano.',1790800000000,335,'weapon','1h_sword',12,0,0,'acero',3,15,1),
 ('sword_acero_2h','Espadón de Acero','⚔',0,'Espada a dos manos: más daño, sin escudo.',1790800000000,990,'weapon','2h_sword',22,0,0,'acero',3,19,3),
 ('shield_acero','Escudo de Acero','🛡',0,'Escudo redondo.',1790800000000,660,'shield',NULL,0,9,0,'acero',3,17,2),
 ('sword_oro','Espada de Oro','⚔️',0,'Espada de una mano.',1790800000000,665,'weapon','1h_sword',16,0,0,'oro',4,25,1),
 ('sword_oro_2h','Espadón de Oro','⚔',0,'Espada a dos manos: más daño, sin escudo.',1790800000000,1980,'weapon','2h_sword',30,0,0,'oro',4,29,3),
 ('shield_oro','Escudo de Oro','🛡',0,'Escudo redondo.',1790800000000,1320,'shield',NULL,0,12,0,'oro',4,27,2),
 ('sword_obsidiana','Espada de Obsidiana','⚔️',0,'Espada de una mano.',1790800000000,1105,'weapon','1h_sword',21,0,0,'obsidiana',5,35,1),
 ('sword_obsidiana_2h','Espadón de Obsidiana','⚔',0,'Espada a dos manos: más daño, sin escudo.',1790800000000,3300,'weapon','2h_sword',39,0,0,'obsidiana',5,39,3),
 ('shield_obsidiana','Escudo de Obsidiana','🛡',0,'Escudo redondo.',1790800000000,2200,'shield',NULL,0,15,0,'obsidiana',5,37,2),
 ('sword_basaltita','Espada de Basaltita','⚔️',0,'Espada de una mano.',1790800000000,1765,'weapon','1h_sword',26,0,0,'basaltita',6,50,1),
 ('sword_basaltita_2h','Espadón de Basaltita','⚔',0,'Espada a dos manos: más daño, sin escudo.',1790800000000,5280,'weapon','2h_sword',48,0,0,'basaltita',6,54,3),
 ('shield_basaltita','Escudo de Basaltita','🛡',0,'Escudo redondo.',1790800000000,3520,'shield',NULL,0,18,0,'basaltita',6,52,2),
 ('sword_teiderio','Espada de Teiderio','⚔️',0,'Espada de una mano.',1790800000000,2645,'weapon','1h_sword',32,0,0,'teiderio',7,65,1),
 ('sword_teiderio_2h','Espadón de Teiderio','⚔',0,'Espada a dos manos: más daño, sin escudo.',1790800000000,7920,'weapon','2h_sword',58,0,0,'teiderio',7,69,3),
 ('shield_teiderio','Escudo de Teiderio','🛡',0,'Escudo redondo.',1790800000000,5280,'shield',NULL,0,21,0,'teiderio',7,67,2);
UPDATE items SET smith_level=1, bars_required=1, material='bronze', tier=1 WHERE id='sword_bronze';
UPDATE items SET smith_level=5, bars_required=3, material='bronze', tier=1 WHERE id='sword_bronze_2h';
UPDATE items SET smith_level=3, bars_required=2, material='bronze', tier=1 WHERE id='shield_bronze';
