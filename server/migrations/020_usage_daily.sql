-- Sesión 51 — contador diario para el tope (server/lib/budget.js)
CREATE TABLE IF NOT EXISTS usage_daily (day TEXT PRIMARY KEY, reads INTEGER NOT NULL DEFAULT 0, writes INTEGER NOT NULL DEFAULT 0);
