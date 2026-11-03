-- El cliente ya no tiene dia de corte, hora de corte ni dia de pago: la gracia se maneja con cuotas de gracia.
ALTER TABLE `cliente`
    DROP COLUMN `dia_corte`,
    DROP COLUMN `hora_corte`,
    DROP COLUMN `dia_pago`;
