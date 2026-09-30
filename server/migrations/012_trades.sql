-- Sesión 50 — comercio entre jugadores
CREATE TABLE IF NOT EXISTS trades (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  a_id INTEGER NOT NULL,
  b_id INTEGER NOT NULL,
  status TEXT NOT NULL,
  a_ok INTEGER NOT NULL DEFAULT 0,
  b_ok INTEGER NOT NULL DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_trades_a ON trades(a_id, status);
CREATE INDEX IF NOT EXISTS idx_trades_b ON trades(b_id, status);
CREATE TABLE IF NOT EXISTS trade_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  trade_id INTEGER NOT NULL,
  owner_id INTEGER NOT NULL,
  item_id TEXT NOT NULL,
  qty INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_trade_items ON trade_items(trade_id);
