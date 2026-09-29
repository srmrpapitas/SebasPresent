-- Sesión 50 — Misiones (tutorial "Primeros pasos").
-- Ejecutada en producción el 2026-09-29.
CREATE TABLE IF NOT EXISTS user_quests (
  user_id    INTEGER NOT NULL,
  quest_id   TEXT NOT NULL,
  step       INTEGER NOT NULL DEFAULT 0,
  progress   INTEGER NOT NULL DEFAULT 0,
  status     INTEGER NOT NULL DEFAULT 0,   -- 0 activa · 1 completada
  started_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, quest_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
