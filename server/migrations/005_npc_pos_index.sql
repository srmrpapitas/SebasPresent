-- Sesión 50 — el snapshot, el agro y el deambular de NPCs filtran por
-- status + caja (x, z). Con solo idx(status, died_at) se leían ~260 filas en
-- cada petición. Con este índice se lee solo la franja de x cercana.
CREATE INDEX IF NOT EXISTS idx_npc_instances_pos ON npc_instances(status, x, z);
