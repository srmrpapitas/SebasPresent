-- Sesión 52 — Historia principal "El Sello de Achamán"
-- Decisiones del jugador en las misiones (a quién avisas, cómo tratas al
-- mencey, qué haces con el corazón de Guayota…). Una fila por decisión.
CREATE TABLE IF NOT EXISTS user_quest_flags (
  user_id INTEGER NOT NULL,
  flag TEXT NOT NULL,
  value TEXT NOT NULL,
  set_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, flag)
);
-- Fase actual de los jefes con fases (Guayota).
ALTER TABLE boss_state ADD COLUMN phase INTEGER NOT NULL DEFAULT 0;
