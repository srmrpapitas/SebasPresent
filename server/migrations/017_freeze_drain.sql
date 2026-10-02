-- Sesión 51 — Congelar (especiales / Enredadera) y bajar defensa (especial de Tibicena)
ALTER TABLE npc_instances ADD COLUMN frozen_until INTEGER NOT NULL DEFAULT 0;
ALTER TABLE npc_instances ADD COLUMN def_drain INTEGER NOT NULL DEFAULT 0;
ALTER TABLE npc_instances ADD COLUMN def_drain_until INTEGER NOT NULL DEFAULT 0;
