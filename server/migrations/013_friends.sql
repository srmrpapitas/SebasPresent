-- Sesión 50 — lista de amigos
CREATE TABLE IF NOT EXISTS user_friends (
  user_id INTEGER NOT NULL,
  friend_id INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, friend_id)
);
