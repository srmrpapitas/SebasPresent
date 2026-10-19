-- 19 oct — Taberna La Vieja Aguere (La Laguna): Fefo vende comida.
-- Mismos objetos que Comidas de Vilaflor, algo más cara (es la capital).
INSERT OR REPLACE INTO shop_stock (shop_id, item_id, current_qty, max_qty, buy_price, sell_price, last_restock_at) VALUES
 ('taberna_laguna', 'pan',            15, 15, 3, 10, 0),
 ('taberna_laguna', 'gofio',          10, 10, 12, 36, 0),
 ('taberna_laguna', 'cooked_chicken', 15, 15, 2, 7, 0),
 ('taberna_laguna', 'cooked_beef',    15, 15, 4, 12, 0),
 ('taberna_laguna', 'sardine',        10, 10, 4, 15, 0),
 ('taberna_laguna', 'trout',          10, 10, 12, 36, 0);
