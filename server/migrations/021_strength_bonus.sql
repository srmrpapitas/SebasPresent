-- Sesión 51 — bonus de FUERZA del equipo (sube el golpe máximo cuerpo a cuerpo)
ALTER TABLE items ADD COLUMN strength_bonus INTEGER NOT NULL DEFAULT 0;
UPDATE items SET strength_bonus = 4 WHERE id = 'boots_dragon';
UPDATE items SET strength_bonus = 4 WHERE id = 'cape_fuego';
UPDATE items SET strength_bonus = 3 WHERE id = 'cape_lava';
UPDATE items SET strength_bonus = 6 WHERE id = 'cape_magma';
