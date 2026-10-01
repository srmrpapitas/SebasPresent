-- Sesión 50 — saltos de posición autorizados por el servidor (teletransportes,
-- respawn, Fosa…). El Realm acepta un salto grande solo si coincide con uno.
ALTER TABLE users ADD COLUMN warp_x REAL;
ALTER TABLE users ADD COLUMN warp_z REAL;
ALTER TABLE users ADD COLUMN warp_at INTEGER;
