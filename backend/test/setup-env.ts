// En producción el crédito es siempre de exactamente 8 cuotas (CUOTAS_MIN = CUOTAS_MAX = 8).
// Los casos de la sección 8 usan 1 a 4 cuotas, así que las pruebas amplían solo el mínimo.
process.env.CUOTAS_MIN = '1';
