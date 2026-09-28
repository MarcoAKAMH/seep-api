-- Removes the discontinued barcode feature from the inventory product master.
ALTER TABLE inv_producto DROP INDEX uq_inv_producto_barcode;
ALTER TABLE inv_producto DROP COLUMN codigo_barras;
