-- Sesión 53 — Tesoros escondidos: qué cofres has encontrado y el último día que abriste cada uno.
CREATE TABLE IF NOT EXISTS user_treasures (
  user_id INTEGER NOT NULL,
  treasure_id TEXT NOT NULL,
  first_at INTEGER NOT NULL,
  last_day INTEGER NOT NULL,
  opens INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (user_id, treasure_id)
);
