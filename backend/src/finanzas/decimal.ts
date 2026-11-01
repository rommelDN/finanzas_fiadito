import Decimal from 'decimal.js';

// Precisión interna alta; el redondeo a 2 decimales se hace solo con red2().
export const D = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });
export type Dec = Decimal;

export const dec = (x: Decimal.Value): Dec => new D(x);

/** red₂(x): 2 decimales, medio céntimo hacia arriba (Anexo A). */
export const red2 = (x: Decimal.Value): Dec => new D(x).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
