-- Sesión 50 — casas de jugador
CREATE TABLE IF NOT EXISTS user_houses (
  user_id INTEGER PRIMARY KEY,
  tier TEXT NOT NULL,
  bought_at INTEGER NOT NULL,
  last_rest INTEGER
);
