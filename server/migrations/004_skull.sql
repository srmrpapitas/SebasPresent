-- Sesión 50 — Calavera PvP (wilderness). Ejecutada en producción el 2026-09-29.
ALTER TABLE combat_stats ADD COLUMN skulled_until INTEGER NOT NULL DEFAULT 0;
