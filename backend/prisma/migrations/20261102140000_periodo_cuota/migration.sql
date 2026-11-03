-- Período de las cuotas de cada compra (y de la tasa efectiva aplicada). Las compras previas eran mensuales (TEM).
ALTER TABLE `compra` ADD COLUMN `periodo_cuota` ENUM('DIARIA', 'QUINCENAL', 'MENSUAL', 'BIMESTRAL', 'TRIMESTRAL', 'CUATRIMESTRAL', 'SEMESTRAL', 'ANUAL') NOT NULL DEFAULT 'MENSUAL' AFTER `n_cuotas`;
