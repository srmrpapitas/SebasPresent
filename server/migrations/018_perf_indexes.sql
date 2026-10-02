-- Sesión 51 — Rendimiento / límites de D1
-- Limpieza de criaturas temporales: antes recorría toda npc_instances.
CREATE INDEX IF NOT EXISTS idx_npc_expires ON npc_instances(expires_at) WHERE expires_at IS NOT NULL;
-- Jefes: buscan su NPC por def_id en cada tick.
CREATE INDEX IF NOT EXISTS idx_npc_def ON npc_instances(def_id);
