import type Decimal from 'decimal.js';
import { Dec, dec, red2 } from './decimal';
import { Fecha, cmpFecha, dias360, minutos, mk, sumarMeses } from './fechas';
import { PERIODOS, Periodo, tasaPeriodo } from './tasas';

export interface ReglasCiclo {
  diaCorte: number;
  /** "HH:mm". La compra de las HH:mm todavía entra al ciclo. */
  horaCorte: string;
  diaPago: number;
}

export interface Ciclo {
  corte: Fecha;
  finGracia: Fecha;
}

/** fechaCorteCiclo = primer corte ≥ compra; fechaFinGracia = primer día de pago posterior al corte. */
export const calcularCiclo = (r: ReglasCiclo, fecha: Fecha, hora: string): Ciclo => {
  let corte = mk(fecha.y, fecha.m, r.diaCorte);
  const cmp = cmpFecha(fecha, corte);
  // Se toma el minuto completo: 23:59:59 todavía entra, 00:00 del día siguiente no.
  const despues = cmp > 0 || (cmp === 0 && minutos(hora) > minutos(r.horaCorte));
  if (despues) corte = mk(fecha.y, fecha.m + 1, r.diaCorte);
  let finGracia = mk(corte.y, corte.m, r.diaPago);
  if (cmpFecha(finGracia, corte) <= 0) finGracia = mk(corte.y, corte.m + 1, r.diaPago);
  return { corte, finGracia };
};

export interface CuotaCalc {
  numero: number;
  vencimiento: Fecha;
  saldoInicial: Dec;
  interes: Dec;
  amortizacion: Dec;
  monto: Dec;
  saldoFinal: Dec;
}

/** Método francés vencido. La última cuota absorbe el redondeo. */
export const cronogramaFrances = (
  capitalFinanciado: Dec,
  tem: Dec,
  n: number,
  finGracia: Fecha,
  diaPago: number,
): { cuotaRegular: Dec; cuotas: CuotaCalc[] } => {
  const Cg = capitalFinanciado;
  const R = tem.gt(0)
    ? red2(Cg.times(tem).div(dec(1).minus(dec(1).plus(tem).pow(-n))))
    : red2(Cg.div(n));
  const cuotas: CuotaCalc[] = [];
  let saldo = Cg;
  for (let k = 1; k <= n; k++) {
    const interes = red2(saldo.times(tem));
    const ultima = k === n;
    const amortizacion = ultima ? saldo : R.minus(interes);
    const monto = ultima ? amortizacion.plus(interes) : R;
    const saldoFinal = saldo.minus(amortizacion);
    cuotas.push({
      numero: k,
      vencimiento: sumarMeses(finGracia, k, diaPago),
      saldoInicial: saldo,
      interes,
      amortizacion,
      monto,
      saldoFinal,
    });
    saldo = saldoFinal;
  }
  return { cuotaRegular: R, cuotas };
};

export interface EntradaCompra {
  cliente: ReglasCiclo & {
    tasaInteres: Decimal.Value;
    periodoTasa: Periodo;
  };
  fecha: Fecha;
  /** "HH:mm" */
  hora: string;
  items: { cantidad: Decimal.Value; precioContado: Decimal.Value }[];
  nCuotas: number;
}

export interface ResultadoCompra {
  subtotales: Dec[];
  capitalInicial: Dec;
  corte: Fecha;
  finGracia: Fecha;
  diasGracia: number;
  tasaGracia: Dec;
  interesGracia: Dec;
  capitalFinanciado: Dec;
  tem: Dec;
  tea: Dec;
  cuotaRegular: Dec;
  cuotas: CuotaCalc[];
  totalIntereses: Dec;
  totalProgramado: Dec;
}

export const calcularCompra = (e: EntradaCompra): ResultadoCompra => {
  const p = PERIODOS[e.cliente.periodoTasa];
  const subtotales = e.items.map((it) => red2(dec(it.cantidad).times(it.precioContado)));
  const C = subtotales.reduce((s, x) => s.plus(x), dec(0));
  const { corte, finGracia } = calcularCiclo(e.cliente, e.fecha, e.hora);
  const diasGracia = dias360(e.fecha, finGracia);
  const tasaGracia = tasaPeriodo(e.cliente.tasaInteres, p, diasGracia);
  const Cg = red2(C.times(dec(1).plus(tasaGracia)));
  const tem = tasaPeriodo(e.cliente.tasaInteres, p, 30);
  const tea = tasaPeriodo(e.cliente.tasaInteres, p, 360);
  const { cuotaRegular, cuotas } = cronogramaFrances(Cg, tem, e.nCuotas, finGracia, e.cliente.diaPago);
  const interesGracia = Cg.minus(C);
  const sumaInteres = cuotas.reduce((s, c) => s.plus(c.interes), dec(0));
  return {
    subtotales,
    capitalInicial: C,
    corte,
    finGracia,
    diasGracia,
    tasaGracia,
    interesGracia,
    capitalFinanciado: Cg,
    tem,
    tea,
    cuotaRegular,
    cuotas,
    totalIntereses: interesGracia.plus(sumaInteres),
    totalProgramado: cuotas.reduce((s, c) => s.plus(c.monto), dec(0)),
  };
};

/** Cuotas máximas permitidas = min(cliente, cada producto). */
export const maxCuotasPermitidas = (maxCliente: number, maxProductos: number[]): number =>
  Math.min(maxCliente, ...maxProductos);

/** Suma `dias` días de calendario a una fecha. */
export const sumarDias = (f: Fecha, dias: number): Fecha => {
  const t = new Date(Date.UTC(f.y, f.m - 1, f.d + dias));
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
};

export interface EntradaGracia {
  /** Capital de la compra (suma de subtotales al contado). */
  capital: Decimal.Value;
  tasaInteres: Decimal.Value;
  periodoTasa: Periodo;
  fecha: Fecha;
  /** Días de gracia pactados: el fin de gracia es la fecha de compra + esos días. */
  diasGracia: number;
  nCuotas: number;
}

/**
 * Cronograma francés con días de gracia elegidos por el comerciante (no derivados del corte).
 * El capital se capitaliza durante la gracia; la primera cuota vence un mes después del fin de gracia.
 */
export const calcularConGracia = (e: EntradaGracia) => {
  const p = PERIODOS[e.periodoTasa];
  const C = red2(e.capital);
  const finGracia = sumarDias(e.fecha, e.diasGracia);
  const tasaGracia = tasaPeriodo(e.tasaInteres, p, e.diasGracia);
  const Cg = red2(C.times(dec(1).plus(tasaGracia)));
  const tem = tasaPeriodo(e.tasaInteres, p, 30);
  const tea = tasaPeriodo(e.tasaInteres, p, 360);
  // El día del primer vencimiento se conserva en los meses siguientes.
  const { cuotaRegular, cuotas } = cronogramaFrances(Cg, tem, e.nCuotas, finGracia, finGracia.d);
  const interesGracia = Cg.minus(C);
  const sumaInteres = cuotas.reduce((s, c) => s.plus(c.interes), dec(0));
  return {
    capitalInicial: C,
    finGracia,
    diasGracia: e.diasGracia,
    tasaGracia,
    interesGracia,
    capitalFinanciado: Cg,
    tem,
    tea,
    cuotaRegular,
    cuotas,
    totalIntereses: interesGracia.plus(sumaInteres),
    totalProgramado: cuotas.reduce((s, c) => s.plus(c.monto), dec(0)),
  };
};
