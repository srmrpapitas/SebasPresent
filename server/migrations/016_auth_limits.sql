-- Sesión 50 — Límite de intentos de login/registro (fuerza bruta)
CREATE TABLE IF NOT EXISTS auth_limits (
  k   TEXT PRIMARY KEY,          -- 'login_ip:1.2.3.4', 'login_fail:nico', 'reg_ip:1.2.3.4'
  win INTEGER NOT NULL,          -- inicio de la ventana (ms)
  n   INTEGER NOT NULL DEFAULT 0
);
