-- Sesión 51 — Ahorro de lecturas D1 (aplicar DESPUÉS del reparto por zonas)
--
-- 1) Celda de 32×32 m de cada monstruo (columna calculada, no ocupa espacio)
--    + índice (status, cell): "monstruos a 40 m" lee solo los de esas celdas
--    en vez de una franja del mapa de punta a punta.
--    La fórmula tiene que coincidir con client/src/shared/grid.js.
ALTER TABLE npc_instances ADD COLUMN cell INTEGER
  GENERATED ALWAYS AS (CAST(x / 32.0 + 1024 AS INTEGER) * 4096 + CAST(z / 32.0 + 1024 AS INTEGER)) VIRTUAL;
CREATE INDEX IF NOT EXISTS idx_npc_cell ON npc_instances(status, cell);

-- 2) Índices que ya no usa nadie y encarecen cada escritura
--    (la posición de los monstruos que persiguen y la de los jugadores).
DROP INDEX IF EXISTS idx_npc_instances_pos;
DROP INDEX IF EXISTS idx_online_pos;

-- 3) Gran Bazar: el cron solo mira artículos con órdenes de jugadores.
CREATE INDEX IF NOT EXISTS idx_ge_open_player ON ge_orders(item_id) WHERE status = 0 AND user_id != 0;
