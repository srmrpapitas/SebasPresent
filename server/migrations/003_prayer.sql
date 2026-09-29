-- Sesión 50 — Plegaria: puntos + plegarias activas en combat_stats.
-- Ejecutada en producción el 2026-09-29.
ALTER TABLE combat_stats ADD COLUMN prayer_points REAL;
ALTER TABLE combat_stats ADD COLUMN prayer_updated_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE combat_stats ADD COLUMN active_prayers TEXT NOT NULL DEFAULT '';
