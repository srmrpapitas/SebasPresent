-- SebasPresent — Slice 1 schema
-- Run via: npx wrangler d1 execute sebaspresent-db --local --file=server/schema.sql

-- Users: account credentials + basic profile
CREATE TABLE IF NOT EXISTS users (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  username     TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,         -- format: "pbkdf2$iterations$salt_hex$hash_hex"
  created_at   INTEGER NOT NULL,       -- unix ms
  last_login   INTEGER                 -- unix ms, nullable
);

CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);

-- Sessions: opaque random tokens, easier to revoke than JWTs
CREATE TABLE IF NOT EXISTS sessions (
  token        TEXT PRIMARY KEY,       -- 64-char hex (32 random bytes)
  user_id      INTEGER NOT NULL,
  created_at   INTEGER NOT NULL,
  expires_at   INTEGER NOT NULL,       -- unix ms
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
