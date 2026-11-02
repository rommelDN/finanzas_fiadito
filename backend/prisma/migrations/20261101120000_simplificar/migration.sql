-- Simplificación del alcance: solo soles, solo dos roles (los clientes no acceden al sistema)
-- y el pago pasa a ser por cuota.

-- 1) Eliminar las cuentas de acceso de clientes y todo lo que las referencia.
UPDATE `cliente` SET `usuario_id` = NULL;
DELETE FROM `sesion` WHERE `usuario_id` IN (SELECT `id` FROM `usuario` WHERE `rol` = 'CLIENTE');
DELETE FROM `bitacora` WHERE `usuario_id` IN (SELECT `id` FROM `usuario` WHERE `rol` = 'CLIENTE');
DELETE FROM `usuario` WHERE `rol` = 'CLIENTE';

ALTER TABLE `cliente` DROP FOREIGN KEY `cliente_usuario_id_fkey`;
DROP INDEX `cliente_usuario_id_key` ON `cliente`;
ALTER TABLE `cliente` DROP COLUMN `usuario_id`;
ALTER TABLE `usuario` MODIFY `rol` ENUM('ADMIN_SISTEMA', 'ADMIN_NEGOCIO') NOT NULL;

-- 2) Eliminar la moneda (todo es en soles).
ALTER TABLE `cliente` DROP COLUMN `moneda`;
ALTER TABLE `producto` DROP COLUMN `moneda_precio`;
DELETE FROM `parametro` WHERE `moneda` = 'USD';
ALTER TABLE `parametro` DROP INDEX `parametro_clave_moneda_vigente_desde_key`;
ALTER TABLE `parametro` DROP COLUMN `moneda`;
CREATE UNIQUE INDEX `parametro_clave_vigente_desde_key` ON `parametro`(`clave`, `vigente_desde`);

-- 3) El pago ahora es por cuota (antes era por estado de cuenta). Los datos previos eran de prueba.
ALTER TABLE `pago` DROP FOREIGN KEY `pago_estado_cuenta_id_fkey`;
DROP TABLE `pago`;
CREATE TABLE `pago` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `cuota_id` BIGINT NOT NULL,
    `fecha_pago_real` DATE NOT NULL,
    `dias_mora` INTEGER NOT NULL,
    `tasa_mora_periodo` DECIMAL(18, 12) NULL,
    `monto_mora` DECIMAL(12, 2) NOT NULL,
    `monto_interes` DECIMAL(12, 2) NOT NULL,
    `monto_capital` DECIMAL(12, 2) NOT NULL,
    `monto_total` DECIMAL(12, 2) NOT NULL,
    `medio_pago` ENUM('EFECTIVO', 'YAPE', 'PLIN', 'TRANSFERENCIA') NOT NULL,

    UNIQUE INDEX `pago_cuota_id_key`(`cuota_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `pago` ADD CONSTRAINT `pago_cuota_id_fkey` FOREIGN KEY (`cuota_id`) REFERENCES `cuota`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- Las compras de prueba quedan con cuotas sin pagos: se marcan como pendientes para no inconsistir.
UPDATE `cuota` SET `estado` = 'PENDIENTE' WHERE `estado` = 'PAGADA';
UPDATE `compra` SET `estado` = 'VIGENTE' WHERE `estado` = 'CANCELADA';
UPDATE `estado_cuenta` SET `estado` = 'PENDIENTE' WHERE `estado` = 'PAGADO';
