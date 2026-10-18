-- Sesión 53 — La tienda del Banco/Mercado (el chico de la tienda del GE) vende tiburones.
-- Mismo precio que la pescadería del faro (660), 20 en stock; se repone con el cron.
INSERT OR REPLACE INTO shop_stock (shop_id, item_id, current_qty, max_qty, buy_price, sell_price, last_restock_at) VALUES
 ('general_store', 'shark', 20, 20, 240, 660, 0);
