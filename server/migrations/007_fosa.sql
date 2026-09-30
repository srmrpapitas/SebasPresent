-- Sesión 50 — La Fosa de Fuego (minijuego de oleadas)
ALTER TABLE npc_instances ADD COLUMN owner_user_id INTEGER;
CREATE INDEX IF NOT EXISTS idx_npc_owner ON npc_instances(owner_user_id);
CREATE TABLE IF NOT EXISTS user_fosa (
  user_id INTEGER PRIMARY KEY,
  active INTEGER NOT NULL DEFAULT 0,
  wave INTEGER NOT NULL DEFAULT 0,
  next_wave_at INTEGER DEFAULT 0,
  rewarded INTEGER DEFAULT 0,
  best_wave INTEGER DEFAULT 0,
  last_tick INTEGER NOT NULL DEFAULT 0,
  prev_tick INTEGER,
  tele TEXT,
  last_attacks TEXT,
  result TEXT,
  started_at INTEGER
);
