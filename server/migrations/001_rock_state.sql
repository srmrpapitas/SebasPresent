-- Sesión 50 — Minería: vetas agotadas.
-- Ejecutada en producción el 2026-09-29.
CREATE TABLE IF NOT EXISTS rock_state (
  vein_id        TEXT PRIMARY KEY,
  depleted_until INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rock_state_until ON rock_state(depleted_until);
