import type Decimal from 'decimal.js';
import { Dec, dec, red2 } from './decimal';
import { Fecha, dias360 } from './fechas';
import { PERIODOS, Periodo, tasaPeriodo } from './tasas';

export interface ObligacionVencida {
  /** Vencimiento original de la cuota (las de ciclos anteriores conservan el suyo). */
  vencimiento: Fecha;
  interes: Dec;
  amortizacion: Dec;
}

export interface MoraObligacion {
  diasMora: number;
  tasaMoraPeriodo: Dec;
  mora: Dec;
}

export interface ResultadoPago {
  totalCapital: Dec;
  totalInteresesCuotas: Dec;
  interesesMora: Dec;
  totalPagar: Dec;
  /** Días de mora del estado de cuenta (respecto de su fecha de pago). */
  diasMora: number;
  tasaMoraPeriodo: Dec;
  detalleMora: MoraObligacion[];
}

/**
 * Mora de un estado de cuenta (baseMora = TOTAL_VENCIDO):
 *   diasMora = max(0, dias360(vencimiento, pagoReal))
 *   mora = red₂(saldoVencido × ((1+im)^(diasMora/pMora) − 1)), saldoVencido = capital + interés de la cuota.
 * Imputación: mora → intereses → capital.
 */
export const calcularPago = (
  obligaciones: ObligacionVencida[],
  fechaPagoEstado: Fecha,
  fechaPagoReal: Fecha,
  tasaMora: Decimal.Value,
  periodoMora: Periodo,
): ResultadoPago => {
  const pMora = PERIODOS[periodoMora];
  const detalleMora = obligaciones.map((o) => {
    const diasMora = Math.max(0, dias360(o.vencimiento, fechaPagoReal));
    const tasaMoraPeriodo = diasMora > 0 ? tasaPeriodo(tasaMora, pMora, diasMora) : dec(0);
    const mora = red2(o.interes.plus(o.amortizacion).times(tasaMoraPeriodo));
    return { diasMora, tasaMoraPeriodo, mora };
  });
  const totalCapital = obligaciones.reduce((s, o) => s.plus(o.amortizacion), dec(0));
  const totalInteresesCuotas = obligaciones.reduce((s, o) => s.plus(o.interes), dec(0));
  const interesesMora = detalleMora.reduce((s, m) => s.plus(m.mora), dec(0));
  const diasMora = Math.max(0, dias360(fechaPagoEstado, fechaPagoReal));
  return {
    totalCapital,
    totalInteresesCuotas,
    interesesMora,
    totalPagar: totalCapital.plus(totalInteresesCuotas).plus(interesesMora),
    diasMora,
    tasaMoraPeriodo: diasMora > 0 ? tasaPeriodo(tasaMora, pMora, diasMora) : dec(0),
    detalleMora,
  };
};
