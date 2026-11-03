import type Decimal from 'decimal.js';
import { Dec, dec, red2 } from './decimal';
import { Fecha, mk, sumarMeses } from './fechas';
import { PERIODOS, Periodo, tasaPeriodo } from './tasas';

export interface CuotaCalc {
  numero: number;
  vencimiento: Fecha;
  saldoInicial: Dec;
  interes: Dec;
  amortizacion: Dec;
  monto: Dec;
  saldoFinal: Dec;
  /** Cuota de gracia: no se paga nada y el interés se suma al saldo (se capitaliza). */
  gracia: boolean;
}

/** Suma `dias` días en base 30/360 (mes de 30 días, año de 360): 15/01 + 30 = 15/02, 31/01 se toma como 30/01.
 *  Si el día resultante no existe en el calendario (30/02) se recorta al último día del mes. */
export const sumarDias = (f: Fecha, dias: number): Fecha => {
  const n = f.y * 360 + (f.m - 1) * 30 + (Math.min(f.d, 30) - 1) + dias;
  const y = Math.floor(n / 360);
  const resto = n - y * 360;
  return mk(y, Math.floor(resto / 30) + 1, (resto % 30) + 1);
};

/**
 * Método francés vencido con cuotas de gracia totales al inicio.
 * - Cuotas 1..g (gracia): no se paga; interés = saldo × tasa del período, que se suma al saldo
 *   (saldo final = saldo inicial + interés) y pasa a ser el saldo inicial de la cuota siguiente.
 * - Cuotas g+1..n: cuota constante sobre el saldo capitalizado; la última absorbe el redondeo.
 * Vencimiento de la cuota k: k períodos después de la compra (mensual: mismo día de cada mes;
 * otro período: k × días del período en base 30/360).
 */
export const cronogramaConGracia = (
  capital: Dec,
  tem: Dec,
  n: number,
  cuotasGracia: number,
  fecha: Fecha,
  diasPeriodo: number = 30,
): { capitalFinanciado: Dec; cuotaRegular: Dec; cuotas: CuotaCalc[] } => {
  if (!Number.isInteger(cuotasGracia) || cuotasGracia < 0 || cuotasGracia >= n) {
    throw new Error(`Las cuotas de gracia deben estar entre 0 y ${n - 1}`);
  }
  const venc = (k: number) => (diasPeriodo === 30 ? sumarMeses(fecha, k, fecha.d) : sumarDias(fecha, k * diasPeriodo));
  const cuotas: CuotaCalc[] = [];
  let saldo = capital;
  for (let k = 1; k <= cuotasGracia; k++) {
    const interes = red2(saldo.times(tem));
    const saldoFinal = saldo.plus(interes);
    cuotas.push({ numero: k, vencimiento: venc(k), saldoInicial: saldo, interes, amortizacion: dec(0), monto: dec(0), saldoFinal, gracia: true });
    saldo = saldoFinal;
  }
  const Cg = saldo; // capital financiado = capital + intereses capitalizados
  const m = n - cuotasGracia;
  const R = tem.gt(0) ? red2(Cg.times(tem).div(dec(1).minus(dec(1).plus(tem).pow(-m)))) : red2(Cg.div(m));
  for (let k = cuotasGracia + 1; k <= n; k++) {
    const interes = red2(saldo.times(tem));
    const ultima = k === n;
    const amortizacion = ultima ? saldo : R.minus(interes);
    const monto = ultima ? amortizacion.plus(interes) : R;
    const saldoFinal = saldo.minus(amortizacion);
    cuotas.push({ numero: k, vencimiento: venc(k), saldoInicial: saldo, interes, amortizacion, monto, saldoFinal, gracia: false });
    saldo = saldoFinal;
  }
  return { capitalFinanciado: Cg, cuotaRegular: R, cuotas };
};

export interface EntradaCronograma {
  /** Capital de la compra (suma de subtotales al contado). */
  capital: Decimal.Value;
  tasaInteres: Decimal.Value;
  periodoTasa: Periodo;
  fecha: Fecha;
  nCuotas: number;
  /** Período de las cuotas y de la tasa efectiva aplicada (por defecto MENSUAL = TEM). */
  periodoCuota?: Periodo;
  /** Cuotas de gracia al inicio (0 = sin gracia). Cuentan dentro de `nCuotas`. */
  cuotasGracia?: number;
}

export const calcularCronograma = (e: EntradaCronograma) => {
  const p = PERIODOS[e.periodoTasa];
  const C = red2(e.capital);
  const diasCuota = PERIODOS[e.periodoCuota ?? 'MENSUAL'];
  const tem = tasaPeriodo(e.tasaInteres, p, diasCuota);
  const tea = tasaPeriodo(e.tasaInteres, p, 360);
  const cuotasGracia = e.cuotasGracia ?? 0;
  const { capitalFinanciado, cuotaRegular, cuotas } = cronogramaConGracia(C, tem, e.nCuotas, cuotasGracia, e.fecha, diasCuota);
  const interesGracia = capitalFinanciado.minus(C);
  const sumaInteres = cuotas.reduce((s, c) => s.plus(c.interes), dec(0));
  return {
    capitalInicial: C,
    cuotasGracia,
    interesGracia,
    capitalFinanciado,
    tem,
    tea,
    cuotaRegular,
    cuotas,
    totalIntereses: sumaInteres,
    totalProgramado: cuotas.reduce((s, c) => s.plus(c.monto), dec(0)),
  };
};

export interface EntradaCompra {
  cliente: { tasaInteres: Decimal.Value; periodoTasa: Periodo };
  fecha: Fecha;
  items: { cantidad: Decimal.Value; precioContado: Decimal.Value }[];
  nCuotas: number;
  periodoCuota?: Periodo;
  cuotasGracia?: number;
}

export const calcularCompra = (e: EntradaCompra) => {
  const subtotales = e.items.map((it) => red2(dec(it.cantidad).times(it.precioContado)));
  const C = subtotales.reduce((s, x) => s.plus(x), dec(0));
  return {
    subtotales,
    ...calcularCronograma({
      capital: C,
      tasaInteres: e.cliente.tasaInteres,
      periodoTasa: e.cliente.periodoTasa,
      fecha: e.fecha,
      nCuotas: e.nCuotas,
      periodoCuota: e.periodoCuota,
      cuotasGracia: e.cuotasGracia,
    }),
  };
};

/** Cuotas máximas permitidas = min(cliente, cada producto). */
export const maxCuotasPermitidas = (maxCliente: number, maxProductos: number[]): number =>
  Math.min(maxCliente, ...maxProductos);
