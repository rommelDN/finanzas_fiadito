-- La gracia pasa de "dias" a "cuotas de gracia" (dentro de las cuotas totales, con interes capitalizado).
-- Se eliminan los campos del ciclo corte/pago y de los dias de gracia.
ALTER TABLE `compra`
    DROP COLUMN `fecha_corte_ciclo`,
    DROP COLUMN `fecha_fin_gracia`,
    DROP COLUMN `dias_gracia`,
    DROP COLUMN `tasa_gracia`,
    ADD COLUMN `cuotas_gracia` TINYINT NOT NULL DEFAULT 0 AFTER `periodo_cuota`;

-- Estado de las cuotas de gracia (no se pagan; su interes se capitaliza).
ALTER TABLE `cuota` MODIFY `estado` ENUM('PENDIENTE', 'PAGADA', 'GRACIA') NOT NULL DEFAULT 'PENDIENTE';
