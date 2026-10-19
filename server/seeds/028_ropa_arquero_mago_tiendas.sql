-- 19 oct — Ropa de arquero y de mago también en tiendas (antes solo por Artesanía).
-- Pieles de Esperanza: el juego de lobo (arquero, Distancia 20) caro a propósito
-- (×3) para que fabricarlo siga compensando; 5 de cada.
-- Tienda de magia: la túnica de algodón (mago, nivel 1) a precio normal.
INSERT OR REPLACE INTO shop_stock (shop_id, item_id, current_qty, max_qty, buy_price, sell_price, last_restock_at) VALUES
 ('pieles_esperanza', 'helm_lobo',   5, 5, 18, 135, 0),
 ('pieles_esperanza', 'body_lobo',   5, 5, 36, 270, 0),
 ('pieles_esperanza', 'legs_lobo',   5, 5, 27, 204, 0),
 ('pieles_esperanza', 'gloves_lobo', 5, 5, 12, 93, 0),
 ('pieles_esperanza', 'boots_lobo',  5, 5, 14, 108, 0),
 ('magic_store', 'helm_algodon',   10, 10, 8, 22, 0),
 ('magic_store', 'body_algodon',   10, 10, 16, 44, 0),
 ('magic_store', 'legs_algodon',   10, 10, 12, 33, 0),
 ('magic_store', 'gloves_algodon', 10, 10, 6, 15, 0),
 ('magic_store', 'boots_algodon',  10, 10, 6, 18, 0);
