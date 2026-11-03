-- Se elimina la funcionalidad de Estado de cuenta: tablas, relacion con cuota y columna asociada.
ALTER TABLE `estado_cuenta_item` DROP FOREIGN KEY `estado_cuenta_item_estado_cuenta_id_fkey`;
ALTER TABLE `estado_cuenta_item` DROP FOREIGN KEY `estado_cuenta_item_cuota_id_fkey`;
ALTER TABLE `cuota` DROP FOREIGN KEY `cuota_estado_cuenta_id_fkey`;
ALTER TABLE `estado_cuenta` DROP FOREIGN KEY `estado_cuenta_cliente_id_fkey`;

DROP INDEX `cuota_estado_cuenta_id_idx` ON `cuota`;
ALTER TABLE `cuota` DROP COLUMN `estado_cuenta_id`;

DROP TABLE `estado_cuenta_item`;
DROP TABLE `estado_cuenta`;
