-- Sesión 50 — Estado de los jefes (server/bosses.js)
CREATE TABLE IF NOT EXISTS boss_state (
  boss_id TEXT PRIMARY KEY,
  last_tick INTEGER NOT NULL DEFAULT 0,
  prev_tick INTEGER,
  hazards TEXT NOT NULL DEFAULT '[]',
  style TEXT,
  next_attack_at INTEGER DEFAULT 0,
  next_special_at INTEGER DEFAULT 0,
  special_idx INTEGER DEFAULT 0,
  empty_since INTEGER DEFAULT 0,
  last_attack TEXT,
  last_special TEXT
);
