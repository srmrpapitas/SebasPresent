-- Sesión 53 — Evento de la isla «¡El Teide ruge!»: quién le ha pegado a la Tibicena Mayor en cada evento.
CREATE TABLE IF NOT EXISTS event_hits (
  event_start INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  at INTEGER NOT NULL,
  PRIMARY KEY (event_start, user_id)
);
