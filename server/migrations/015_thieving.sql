-- Sesión 50 — Robo (pickpocket)
CREATE TABLE IF NOT EXISTS user_thieving (
  user_id INTEGER PRIMARY KEY,
  last_at INTEGER NOT NULL DEFAULT 0,
  locked_until INTEGER NOT NULL DEFAULT 0
);
-- Criaturas temporales (los guardias que te persiguen si te pillan robando)
ALTER TABLE npc_instances ADD COLUMN expires_at INTEGER;
