-- Sesión 51 — Home teleport: el servidor guarda cuándo empezó el lanzamiento
-- (antes /finish no comprobaba nada → huida instantánea de la wilderness).
ALTER TABLE users ADD COLUMN home_tele_started_at INTEGER NOT NULL DEFAULT 0;
