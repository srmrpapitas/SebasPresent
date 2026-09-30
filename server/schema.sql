-- SebasPresent — Esquema COMPLETO de D1 (extraído de producción, 2026-09-29)
-- Uso (base nueva):  npx wrangler d1 execute sebaspresent-db --local --file=server/schema.sql
-- Solo estructura: los datos base (items, npc_defs, npc_instances, npc_loot_table,
-- shop_stock, ge_seed_config) van en un seed aparte.

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_login INTEGER,
  last_x REAL, last_z REAL,
  combat_style TEXT NOT NULL DEFAULT 'controlled',
  home_tele_cooldown_until INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS items (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, icon TEXT NOT NULL,
  stackable INTEGER NOT NULL DEFAULT 0, description TEXT,
  created_at INTEGER NOT NULL, base_price INTEGER NOT NULL DEFAULT 1,
  equip_slot TEXT, weapon_type TEXT,
  attack_bonus INTEGER DEFAULT 0, defence_bonus INTEGER DEFAULT 0,
  ranged_bonus INTEGER NOT NULL DEFAULT 0,
  tint_hex TEXT, base_model TEXT, material TEXT, tier INTEGER,
  smith_level INTEGER, bars_required INTEGER
);

CREATE TABLE IF NOT EXISTS user_inventory (
  user_id INTEGER NOT NULL, slot_index INTEGER NOT NULL,
  item_id TEXT NOT NULL, quantity INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, slot_index),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (item_id) REFERENCES items(id)
);

CREATE TABLE IF NOT EXISTS user_bank (
  user_id INTEGER NOT NULL, slot_index INTEGER NOT NULL,
  item_id TEXT NOT NULL, quantity INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, slot_index),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (item_id) REFERENCES items(id)
);
CREATE INDEX IF NOT EXISTS idx_bank_user ON user_bank(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_bank_user_item ON user_bank(user_id, item_id);

CREATE TABLE IF NOT EXISTS user_equipment (
  user_id INTEGER NOT NULL, slot_id TEXT NOT NULL,
  item_id TEXT NOT NULL, equipped_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, slot_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (item_id) REFERENCES items(id)
);

CREATE TABLE IF NOT EXISTS user_quiver (
  user_id INTEGER PRIMARY KEY, arrow_item_id TEXT,
  arrow_quantity INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS user_skills (
  user_id INTEGER NOT NULL, skill_id TEXT NOT NULL,
  xp INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, skill_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_user_skills_user ON user_skills(user_id);

CREATE TABLE IF NOT EXISTS combat_stats (
  user_id INTEGER PRIMARY KEY,
  attack_xp INTEGER NOT NULL DEFAULT 0, strength_xp INTEGER NOT NULL DEFAULT 0,
  defence_xp INTEGER NOT NULL DEFAULT 0, hp_xp INTEGER NOT NULL DEFAULT 1154,
  hp_current INTEGER NOT NULL DEFAULT 10,
  last_attack_at INTEGER, last_died_at INTEGER,
  last_hit_from_user_id INTEGER, last_hit_damage INTEGER,
  last_hit_at INTEGER, last_hit_is_crit INTEGER,
  ranged_xp INTEGER NOT NULL DEFAULT 0, magic_xp INTEGER NOT NULL DEFAULT 0,
  prayer_xp INTEGER NOT NULL DEFAULT 0,
  mana_current INTEGER DEFAULT 0, mana_updated_at INTEGER DEFAULT 0,
  spec_energy INTEGER NOT NULL DEFAULT 100, spec_updated_at INTEGER NOT NULL DEFAULT 0,
  last_eat_at INTEGER NOT NULL DEFAULT 0,
  prayer_points REAL,                                  -- S50 (migración 003)
  prayer_updated_at INTEGER NOT NULL DEFAULT 0,
  active_prayers TEXT NOT NULL DEFAULT '',
  skulled_until INTEGER NOT NULL DEFAULT 0,          -- S50 calavera (migración 004)
  FOREIGN KEY (user_id) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_combat_stats_last_hit_at ON combat_stats(last_hit_at);

CREATE TABLE IF NOT EXISTS combat_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL,
  attacker_type INTEGER NOT NULL CHECK (attacker_type IN (0, 1)),
  attacker_id INTEGER NOT NULL,
  target_type INTEGER NOT NULL CHECK (target_type IN (0, 1)),
  target_id INTEGER NOT NULL, damage INTEGER NOT NULL,
  hit INTEGER NOT NULL CHECK (hit IN (0, 1)),
  killed INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_combat_log_ts ON combat_log(ts);

CREATE TABLE IF NOT EXISTS npc_defs (
  id TEXT PRIMARY KEY, name TEXT NOT NULL,
  max_hp INTEGER NOT NULL CHECK (max_hp > 0),
  attack_lvl INTEGER NOT NULL CHECK (attack_lvl >= 1),
  strength_lvl INTEGER NOT NULL CHECK (strength_lvl >= 1),
  defence_lvl INTEGER NOT NULL CHECK (defence_lvl >= 1),
  attack_speed_ticks INTEGER NOT NULL DEFAULT 4,
  max_hit INTEGER NOT NULL CHECK (max_hit >= 0),
  xp_per_kill INTEGER NOT NULL DEFAULT 0,
  respawn_ms INTEGER NOT NULL DEFAULT 30000,
  spawn_x REAL NOT NULL DEFAULT 0, spawn_z REAL NOT NULL DEFAULT 0,
  attack_range REAL NOT NULL DEFAULT 1.5,
  model TEXT NOT NULL DEFAULT 'box',
  behavior TEXT NOT NULL DEFAULT 'passive',
  aggro_radius REAL NOT NULL DEFAULT 0,
  style TEXT DEFAULT 'melee'
);

CREATE TABLE IF NOT EXISTS npc_instances (
  id INTEGER PRIMARY KEY AUTOINCREMENT, def_id TEXT NOT NULL,
  hp_current INTEGER NOT NULL, x REAL NOT NULL, z REAL NOT NULL,
  status INTEGER NOT NULL DEFAULT 0 CHECK (status IN (0, 1)),
  died_at INTEGER, in_combat_with INTEGER, last_attack_at INTEGER,
  spawn_x REAL, spawn_z REAL, last_moved_at INTEGER,
  FOREIGN KEY (def_id) REFERENCES npc_defs(id)
);
CREATE INDEX IF NOT EXISTS idx_npc_instances_status ON npc_instances(status, died_at);

CREATE TABLE IF NOT EXISTS npc_loot_table (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  npc_def_id TEXT NOT NULL REFERENCES npc_defs(id),
  item_id TEXT NOT NULL REFERENCES items(id),
  qty_min INTEGER NOT NULL DEFAULT 1, qty_max INTEGER NOT NULL DEFAULT 1,
  weight INTEGER NOT NULL DEFAULT 1, is_always INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS ground_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id TEXT NOT NULL REFERENCES items(id),
  qty INTEGER NOT NULL DEFAULT 1, x REAL NOT NULL, z REAL NOT NULL,
  dropped_at INTEGER NOT NULL,
  dropped_by_user INTEGER REFERENCES users(id),
  despawn_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ground_items_despawn ON ground_items(despawn_at);
CREATE INDEX IF NOT EXISTS idx_ground_items_pos ON ground_items(x, z);

CREATE TABLE IF NOT EXISTS shop_stock (
  shop_id TEXT NOT NULL, item_id TEXT NOT NULL,
  current_qty INTEGER NOT NULL, max_qty INTEGER NOT NULL,
  buy_price INTEGER NOT NULL,   -- lo que la tienda PAGA al jugador
  sell_price INTEGER NOT NULL,  -- lo que la tienda COBRA al jugador
  last_restock_at INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (shop_id, item_id)
);

CREATE TABLE IF NOT EXISTS ge_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL, item_id TEXT NOT NULL,
  side INTEGER NOT NULL CHECK (side IN (0, 1)),
  price INTEGER NOT NULL CHECK (price > 0),
  qty_total INTEGER NOT NULL CHECK (qty_total > 0),
  qty_filled INTEGER NOT NULL DEFAULT 0,
  status INTEGER NOT NULL DEFAULT 0 CHECK (status IN (0, 1, 2)),
  coin_escrow INTEGER NOT NULL DEFAULT 0, item_escrow INTEGER NOT NULL DEFAULT 0,
  avg_fill_price REAL NOT NULL DEFAULT 0,
  coins_recovered INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL, completed_at INTEGER,
  pending_coins INTEGER NOT NULL DEFAULT 0,
  pending_items INTEGER NOT NULL DEFAULT 0,
  claimed_at INTEGER,
  FOREIGN KEY (item_id) REFERENCES items(id)
);
CREATE INDEX IF NOT EXISTS idx_ge_orders_match ON ge_orders(item_id, side, status, price, created_at);
CREATE INDEX IF NOT EXISTS idx_ge_orders_user_open ON ge_orders(user_id, status, created_at);

CREATE TABLE IF NOT EXISTS ge_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT, item_id TEXT NOT NULL,
  buy_order_id INTEGER NOT NULL, sell_order_id INTEGER NOT NULL,
  buyer_id INTEGER NOT NULL, seller_id INTEGER NOT NULL,
  matched_price INTEGER NOT NULL, qty INTEGER NOT NULL,
  matched_at INTEGER NOT NULL,
  FOREIGN KEY (item_id) REFERENCES items(id),
  FOREIGN KEY (buy_order_id) REFERENCES ge_orders(id),
  FOREIGN KEY (sell_order_id) REFERENCES ge_orders(id)
);
CREATE INDEX IF NOT EXISTS idx_ge_history_item_time ON ge_history(item_id, matched_at);

CREATE TABLE IF NOT EXISTS ge_seed_config (
  item_id TEXT NOT NULL,
  side INTEGER NOT NULL CHECK (side IN (0, 1)),
  target_volume INTEGER NOT NULL, price_offset_bps INTEGER NOT NULL,
  PRIMARY KEY (item_id, side),
  FOREIGN KEY (item_id) REFERENCES items(id)
);

CREATE TABLE IF NOT EXISTS online_users (
  user_id INTEGER PRIMARY KEY REFERENCES users(id),
  username TEXT NOT NULL,
  x REAL NOT NULL DEFAULT 0, z REAL NOT NULL DEFAULT 0,
  yaw REAL NOT NULL DEFAULT 0, state TEXT NOT NULL DEFAULT 'idle',
  last_seen INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_online_last_seen ON online_users(last_seen);
CREATE INDEX IF NOT EXISTS idx_online_pos ON online_users(x, z);

CREATE TABLE IF NOT EXISTS parties (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  leader_user_id INTEGER NOT NULL, created_at INTEGER NOT NULL,
  max_size INTEGER NOT NULL DEFAULT 4,
  FOREIGN KEY (leader_user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS party_members (
  party_id INTEGER NOT NULL, user_id INTEGER NOT NULL UNIQUE,
  joined_at INTEGER NOT NULL,
  PRIMARY KEY (party_id, user_id),
  FOREIGN KEY (party_id) REFERENCES parties(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_party_members_user ON party_members(user_id);
CREATE TABLE IF NOT EXISTS party_invites (
  id INTEGER PRIMARY KEY AUTOINCREMENT, party_id INTEGER,
  from_user_id INTEGER NOT NULL, to_user_id INTEGER NOT NULL,
  sent_at INTEGER NOT NULL, expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS duels (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_a_id INTEGER NOT NULL, user_b_id INTEGER NOT NULL,
  started_at INTEGER NOT NULL,
  leaving_a_at INTEGER, leaving_b_at INTEGER,
  leave_cast_ends_at INTEGER, ended_at INTEGER,
  FOREIGN KEY (user_a_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (user_b_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_duels_ended ON duels(ended_at);
CREATE INDEX IF NOT EXISTS idx_duels_started ON duels(started_at);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_duel_active_a ON duels(user_a_id) WHERE ended_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_duel_active_b ON duels(user_b_id) WHERE ended_at IS NULL;

CREATE TABLE IF NOT EXISTS duel_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_user_id INTEGER NOT NULL, to_user_id INTEGER NOT NULL,
  created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  FOREIGN KEY (from_user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (to_user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE(from_user_id, to_user_id)
);
CREATE INDEX IF NOT EXISTS idx_duel_requests_expires ON duel_requests(expires_at);
CREATE INDEX IF NOT EXISTS idx_duel_requests_from ON duel_requests(from_user_id);
CREATE INDEX IF NOT EXISTS idx_duel_requests_to ON duel_requests(to_user_id);

CREATE TABLE IF NOT EXISTS chat_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL, username TEXT NOT NULL,
  channel TEXT NOT NULL DEFAULT 'global',
  message TEXT NOT NULL, sent_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_chat_messages_channel_sent ON chat_messages(channel, sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_messages_user_sent ON chat_messages(user_id, sent_at);

CREATE TABLE IF NOT EXISTS fires (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  x REAL NOT NULL, z REAL NOT NULL, log_type TEXT NOT NULL,
  user_id INTEGER NOT NULL, lit_at INTEGER NOT NULL, expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_fires_expires ON fires(expires_at);

CREATE TABLE IF NOT EXISTS tree_state (
  x REAL NOT NULL, z REAL NOT NULL, tree_type TEXT NOT NULL,
  depleted_until INTEGER NOT NULL,
  PRIMARY KEY (x, z)
);
CREATE INDEX IF NOT EXISTS idx_tree_state_until ON tree_state(depleted_until);

-- Sesión 50 — Minería (ver migrations/001_rock_state.sql)
CREATE TABLE IF NOT EXISTS rock_state (
  vein_id TEXT PRIMARY KEY,
  depleted_until INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rock_state_until ON rock_state(depleted_until);

-- Sesión 50 — Misiones (ver migrations/002_user_quests.sql)
CREATE TABLE IF NOT EXISTS user_quests (
  user_id    INTEGER NOT NULL,
  quest_id   TEXT NOT NULL,
  step       INTEGER NOT NULL DEFAULT 0,
  progress   INTEGER NOT NULL DEFAULT 0,
  status     INTEGER NOT NULL DEFAULT 0,   -- 0 activa · 1 completada
  started_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, quest_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
-- Sesión 50 — Estado de los jefes (server/bosses.js)
CREATE TABLE IF NOT EXISTS boss_state (
  boss_id TEXT PRIMARY KEY,
  last_tick INTEGER NOT NULL DEFAULT 0,
  prev_tick INTEGER,
  hazards TEXT NOT NULL DEFAULT '[]',
  style TEXT,
  next_attack_at INTEGER DEFAULT 0,
  next_special_at INTEGER DEFAULT 0,
  special_idx INTEGER DEFAULT 0,
  empty_since INTEGER DEFAULT 0,
  last_attack TEXT,
  last_special TEXT
);
-- Sesión 50 — La Fosa de Fuego (minijuego de oleadas)
ALTER TABLE npc_instances ADD COLUMN owner_user_id INTEGER;
CREATE INDEX IF NOT EXISTS idx_npc_owner ON npc_instances(owner_user_id);
CREATE TABLE IF NOT EXISTS user_fosa (
  user_id INTEGER PRIMARY KEY,
  active INTEGER NOT NULL DEFAULT 0,
  wave INTEGER NOT NULL DEFAULT 0,
  next_wave_at INTEGER DEFAULT 0,
  rewarded INTEGER DEFAULT 0,
  best_wave INTEGER DEFAULT 0,
  last_tick INTEGER NOT NULL DEFAULT 0,
  prev_tick INTEGER,
  tele TEXT,
  last_attacks TEXT,
  result TEXT,
  started_at INTEGER
);
ALTER TABLE combat_stats ADD COLUMN boosts TEXT;

-- Sesión 50 — socios de La ASO
CREATE TABLE IF NOT EXISTS aso_members (
  user_id INTEGER PRIMARY KEY,
  joined_at INTEGER NOT NULL,
  via TEXT NOT NULL,
  sponsor_id INTEGER
);
