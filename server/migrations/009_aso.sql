-- Sesión 50 — socios de La ASO (hay que ser socio para comprar hierbas)
CREATE TABLE IF NOT EXISTS aso_members (
  user_id INTEGER PRIMARY KEY,
  joined_at INTEGER NOT NULL,
  via TEXT NOT NULL,            -- 'pavos' | 'socio'
  sponsor_id INTEGER
);
