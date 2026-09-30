-- Sesión 50 — monturas
CREATE TABLE IF NOT EXISTS user_mounts (
  user_id INTEGER NOT NULL,
  mount_id TEXT NOT NULL,
  bought_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, mount_id)
);
