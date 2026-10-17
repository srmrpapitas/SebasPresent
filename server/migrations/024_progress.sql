-- Sesión 53 — Contador de muertes por monstruo (jefes incluidos), registro de colección y logros.
CREATE TABLE IF NOT EXISTS user_kc (
  user_id INTEGER NOT NULL,
  npc_def_id TEXT NOT NULL,
  kills INTEGER NOT NULL DEFAULT 0,
  first_at INTEGER,
  PRIMARY KEY (user_id, npc_def_id)
);
CREATE INDEX IF NOT EXISTS idx_kc_def ON user_kc(npc_def_id, kills);
CREATE TABLE IF NOT EXISTS user_collection (
  user_id INTEGER NOT NULL,
  item_id TEXT NOT NULL,
  qty INTEGER NOT NULL DEFAULT 0,
  first_at INTEGER,
  PRIMARY KEY (user_id, item_id)
);
CREATE TABLE IF NOT EXISTS user_achievements (
  user_id INTEGER NOT NULL,
  ach_id TEXT NOT NULL,
  at INTEGER NOT NULL,
  PRIMARY KEY (user_id, ach_id)
);
CREATE INDEX IF NOT EXISTS idx_fosa_best ON user_fosa(best_wave);
