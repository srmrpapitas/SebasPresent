-- Sesión 51 — Armas legendarias (diseños propios, mitología guanche)
INSERT OR REPLACE INTO items (id,name,icon,stackable,description,created_at,base_price,equip_slot,weapon_type,attack_bonus,defence_bonus,ranged_bonus,material,tier) VALUES
('gs_achaman','Espadón de Achamán','⚔️',0,'Forjado con la luz del cielo de Achamán. Especial: Juicio de Achamán (+37,5 % daño, precisión ×2).',0,2500000,'weapon','2h_sword',74,0,0,'dios',9),
('gs_tibicena','Espadón de Tibicena','⚔️',0,'Hoja dentada como las fauces de los tibicenas. Especial: Mordisco de Tibicena (baja la defensa del enemigo tanto como el daño).',0,1800000,'weapon','2h_sword',72,0,0,'dios',9),
('gs_magec','Espadón de Magec','⚔️',0,'Arde con el sol de Magec. Especial: Luz de Magec (te cura la mitad del daño).',0,2000000,'weapon','2h_sword',72,0,0,'dios',9),
('gs_guayota','Espadón de Guayota','⚔️',0,'Obsidiana del corazón del Teide. Especial: Prisión de Guayota (congela al enemigo 10 s).',0,1500000,'weapon','2h_sword',72,0,0,'dios',9),
('sword_tindaya','Espada larga de Tindaya','🗡️',0,'Hoja antigua grabada con los petroglifos de Tindaya. Especial: Finta de Tindaya (+20 % daño, nunca pega menos del 20 % del máximo).',0,3000000,'weapon','1h_sword',46,0,0,'antiguo',9),
('claws_dragon','Garras de dragón','🐾',0,'Cuatro cuchillas curvas de escama de dragón. Especial: Tajo de cuatro garras (4 golpes en cascada).',0,2500000,'weapon','1h_sword',40,0,0,'dragon',8),
('dagger_dragon','Daga de dragón','🗡️',0,'Daga ligera de hoja roja. Especial: Puñalada doble.',0,80000,'weapon','1h_sword',30,0,0,'dragon',8);
-- Sesión 51 — capas
INSERT OR REPLACE INTO items (id,name,icon,stackable,description,created_at,base_price,equip_slot,weapon_type,attack_bonus,defence_bonus,ranged_bonus,material,tier) VALUES
('cape_magma','Capa de magma','🧥',0,'Forjada en el corazón del Teide: el magma fluye por ella y gotea sin parar. La mejor capa para el cuerpo a cuerpo.',0,400000,'cape',NULL,8,14,0,'magma',10),
('cape_achaman','Capa de Achamán','🧥',0,'Capa de mago del cielo estrellado de Achamán. +2 al golpe máximo de los hechizos.',0,75000,'cape',NULL,0,3,0,'mago',8),
('cape_magec','Capa de Magec','🧥',0,'Capa de mago del sol de Magec. +2 al golpe máximo de los hechizos.',0,75000,'cape',NULL,0,3,0,'mago',8),
('cape_chaxiraxi','Capa de Chaxiraxi','🧥',0,'Capa de mago de la tierra y la luna de Chaxiraxi. +2 al golpe máximo de los hechizos.',0,75000,'cape',NULL,0,3,0,'mago',8);
