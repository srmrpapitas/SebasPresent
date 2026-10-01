-- Sesión 50 — Mundo lleno: mini jefes (variantes grandes y de otro color) y monstruos ×20
-- (gallinas y vacas ×5). No toca jefes, minijuegos, poblado guanche, Cabildo ni cuevas.
-- Nada agresivo aparece dentro de pueblos, junto a las montañas de cueva o las guaridas de jefes.

-- 1) Mini jefes
WITH names(id, nm) AS (VALUES
  ('rat','Rata colosal'),('spider','Araña reina'),('boar','Jabalí cornudo'),('wolf','Lobo alfa'),
  ('scorpion','Escorpión carmesí'),('golem','Gólem ancestral'),('yeti','Yeti albino'),('skeleton','Esqueleto capitán'),
  ('goblin','Goblin cabecilla'),('zombi','Zombi putrefacto'),('zombi_igneo','Zombi infernal'),
  ('bandido','Jefe de bandidos'),('ogro_anaga','Ogro gigante'))
INSERT OR REPLACE INTO npc_defs (id,name,max_hp,attack_lvl,strength_lvl,defence_lvl,attack_speed_ticks,max_hit,xp_per_kill,respawn_ms,spawn_x,spawn_z,attack_range,model,behavior,aggro_radius,style)
SELECT d.id || '_jefe', n.nm, d.max_hp * 4, d.attack_lvl + 12, d.strength_lvl + 12, d.defence_lvl + 12, d.attack_speed_ticks,
       CAST(d.max_hit * 1.6 + 1 AS INTEGER), d.xp_per_kill, d.respawn_ms * 3, d.spawn_x, d.spawn_z, d.attack_range * 1.3,
       d.id || '_jefe', 'aggressive', MAX(d.aggro_radius, 4) + 3, d.style
FROM npc_defs d JOIN names n ON n.id = d.id;

DELETE FROM npc_loot_table WHERE npc_def_id LIKE '%\_jefe' ESCAPE '\';
INSERT INTO npc_loot_table (npc_def_id,item_id,qty_min,qty_max,weight,is_always)
SELECT npc_def_id || '_jefe', item_id, qty_min * 2, qty_max * 3, weight, is_always FROM npc_loot_table
WHERE npc_def_id IN ('rat','spider','boar','wolf','scorpion','golem','yeti','skeleton','goblin','zombi','zombi_igneo','bandido','ogro_anaga');
INSERT INTO npc_loot_table (npc_def_id,item_id,qty_min,qty_max,weight,is_always)
SELECT id, 'coins', max_hp / 2, max_hp * 2, 1, 1 FROM npc_defs WHERE id LIKE '%\_jefe' ESCAPE '\';

-- 2) Monstruos ×20 (+ ~25 % de los originales con un mini jefe al lado)
WITH RECURSIVE n(k) AS (SELECT 1 UNION ALL SELECT k + 1 FROM n WHERE k < 19),
avoid(ax, az, r) AS (VALUES
  (4,-4,90),(-280,-682,60),(-686,-184,55),(-390,396,55),(-786,1396,45),(-286,1694,60),(404,-884,45),(210,-1676,50),
  (712,-1078,55),(1184,-1448,30),(1504,92,60),(1012,1196,60),(1712,-788,60),(1100,600,60),(0,-1200,50),(700,1450,45),
  (-620,140,70),(-40,-600,60),(-749,-309,35),(273,-1602,35),(-1464,-1093,35),
  (-1850,40,60),(-1600,-1540,60),(-1500,-440,60),(480,-1900,60),(1330,-1560,60),(1480,400,60),(-640,760,60)),
base AS (
  SELECT i.def_id, d.max_hp, i.spawn_x AS sx, i.spawn_z AS sz, CASE WHEN i.spawn_x < -1024 THEN 95.0 ELSE 60.0 END AS spread
  FROM npc_instances i JOIN npc_defs d ON d.id = i.def_id
  WHERE i.expires_at IS NULL AND i.owner_user_id IS NULL AND i.status = 0
    AND i.spawn_x BETWEEN -2048 AND 2048
    AND d.id IN ('chicken','cow','rat','spider','boar','wolf','scorpion','golem','yeti','skeleton','goblin','zombi','zombi_igneo','bandido','ogro_anaga')),
cand AS (
  SELECT b.def_id, b.max_hp,
         MAX(-2020, MIN(2020, b.sx + ((abs(random()) % 2001) - 1000) / 1000.0 * b.spread)) AS x,
         MAX(-2020, MIN(2020, b.sz + ((abs(random()) % 2001) - 1000) / 1000.0 * b.spread)) AS z
  FROM base b, n WHERE b.def_id NOT IN ('chicken','cow') OR n.k <= 4
  UNION ALL
  SELECT b.def_id || '_jefe', b.max_hp * 4,
         MAX(-2020, MIN(2020, b.sx + ((abs(random()) % 2001) - 1000) / 1000.0 * 25)),
         MAX(-2020, MIN(2020, b.sz + ((abs(random()) % 2001) - 1000) / 1000.0 * 25))
  FROM base b WHERE b.def_id NOT IN ('chicken','cow') AND abs(random()) % 4 = 0)
INSERT INTO npc_instances (def_id, hp_current, x, z, status, spawn_x, spawn_z)
SELECT def_id, max_hp, round(x, 1), round(z, 1), 0, round(x, 1), round(z, 1) FROM cand c
WHERE c.def_id IN ('chicken','cow')
   OR NOT EXISTS (SELECT 1 FROM avoid a WHERE (c.x - a.ax) * (c.x - a.ax) + (c.z - a.az) * (c.z - a.az) < a.r * a.r);
