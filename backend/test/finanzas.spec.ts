import {
  calcularCiclo,
  calcularCompra,
  calcularPago,
  calcularTasas,
  cronogramaFrances,
  dec,
  dias360,
  fechaDMY,
  maxCuotasPermitidas,
  mk,
  Periodo,
  sumarMeses,
} from '../src/finanzas';

const f = (s: string) => {
  const [d, m, y] = s.split('/').map(Number);
  return { y, m, d };
};

const PROD: Record<string, number> = {
  P001: 22.0, P002: 9.5, P003: 4.2, P004: 5.0, P005: 3.3, P006: 16.5, P007: 50.0,
};

const CLI = {
  rosa: { tasaInteres: '6.1363551', periodoTasa: 'BIMESTRAL' as Periodo, tasaMora: '6.1208', periodoTasaMora: 'SEMESTRAL' as Periodo, diaCorte: 20, horaCorte: '23:59', diaPago: 26 },
  carlos: { tasaInteres: '20.0000000', periodoTasa: 'SEMESTRAL' as Periodo, tasaMora: '6.0', periodoTasaMora: 'SEMESTRAL' as Periodo, diaCorte: 25, horaCorte: '23:59', diaPago: 5 },
  mario: { tasaInteres: '1.5105456', periodoTasa: 'QUINCENAL' as Periodo, tasaMora: '0.4007475', periodoTasaMora: 'QUINCENAL' as Periodo, diaCorte: 20, horaCorte: '23:59', diaPago: 26 },
};

type Row = [string, keyof typeof CLI, string, string, number, [string, number][], string, string, number, string, string, string, string, string];
// nombre, cliente, fecha, hora, n, items, C, corte, finGracia(dias), 1ªcuota, intGracia, Cg, R
const COMPRAS: Record<string, any> = {
  CR1: { cli: 'rosa', fecha: '15/09/2026', hora: '10:30', n: 3, items: [['P001', 2], ['P002', 2], ['P003', 6], ['P004', 4], ['P005', 2], ['P006', 1]], C: '131.30', corte: '20/09/2026', fin: '26/09/2026', dg: 11, prim: '26/10/2026', ig: '1.44', Cg: '132.74', R: '46.95', ti: '9.54', tp: '140.84' },
  CC1: { cli: 'carlos', fecha: '27/09/2026', hora: '14:00', n: 2, items: [['P007', 1], ['P001', 2], ['P002', 1], ['P004', 4]], C: '123.50', corte: '25/10/2026', fin: '05/11/2026', dg: 38, prim: '05/12/2026', ig: '4.85', Cg: '128.35', R: '67.16', ti: '10.82', tp: '134.32' },
  CM1: { cli: 'mario', fecha: '10/08/2026', hora: '09:00', n: 3, items: [['P001', 2], ['P002', 2], ['P004', 4], ['P006', 1]], C: '99.50', corte: '20/08/2026', fin: '26/08/2026', dg: 16, prim: '26/09/2026', ig: '1.60', Cg: '101.10', R: '35.77', ti: '7.82', tp: '107.32' },
  CM2: { cli: 'mario', fecha: '03/09/2026', hora: '18:00', n: 1, items: [['P007', 1]], C: '50.00', corte: '20/09/2026', fin: '26/09/2026', dg: 23, prim: '26/10/2026', ig: '1.16', Cg: '51.16', R: '52.72', ti: '2.72', tp: '52.72' },
  CM3: { cli: 'mario', fecha: '15/09/2026', hora: '11:00', n: 2, items: [['P003', 12], ['P005', 5], ['P002', 2]], C: '85.90', corte: '20/09/2026', fin: '26/09/2026', dg: 11, prim: '26/10/2026', ig: '0.95', Cg: '86.85', R: '45.42', ti: '4.93', tp: '90.83' },
  CM4: { cli: 'mario', fecha: '24/09/2026', hora: '16:00', n: 1, items: [['P001', 1], ['P005', 2]], C: '28.60', corte: '20/10/2026', fin: '26/10/2026', dg: 32, prim: '26/11/2026', ig: '0.93', Cg: '29.53', R: '30.43', ti: '1.83', tp: '30.43' },
};

// cuota: venc | saldoIni | interés | amort | importe | saldoFin
const CRONO: Record<string, string[][]> = {
  CR1: [['26/10/2026', '132.74', '4.01', '42.94', '46.95', '89.80'], ['26/11/2026', '89.80', '2.71', '44.24', '46.95', '45.56'], ['26/12/2026', '45.56', '1.38', '45.56', '46.94', '0.00']],
  CC1: [['05/12/2026', '128.35', '3.96', '63.20', '67.16', '65.15'], ['05/01/2027', '65.15', '2.01', '65.15', '67.16', '0.00']],
  CM1: [['26/09/2026', '101.10', '3.08', '32.69', '35.77', '68.41'], ['26/10/2026', '68.41', '2.08', '33.69', '35.77', '34.72'], ['26/11/2026', '34.72', '1.06', '34.72', '35.78', '0.00']],
  CM2: [['26/10/2026', '51.16', '1.56', '51.16', '52.72', '0.00']],
  CM3: [['26/10/2026', '86.85', '2.64', '42.78', '45.42', '44.07'], ['26/11/2026', '44.07', '1.34', '44.07', '45.41', '0.00']],
  CM4: [['26/11/2026', '29.53', '0.90', '29.53', '30.43', '0.00']],
};

describe('Tasas', () => {
  it.each([
    ['rosa', '3.0225000', '42.9502815'],
    ['carlos', '3.0853321', '44.0000000'],
    ['mario', '3.0439087', '43.3071598'],
  ] as const)('TEM y TEA de %s', (c, tem, tea) => {
    const t = calcularTasas(CLI[c]);
    expect(t.tem.times(100).toFixed(7)).toBe(tem);
    expect(t.teaInteres.times(100).toFixed(7)).toBe(tea);
  });
});

describe('Compras (sección 8)', () => {
  it.each(Object.keys(COMPRAS))('%s: ciclo, gracia y capital', (nombre) => {
    const c = COMPRAS[nombre];
    const r = calcularCompra({
      cliente: CLI[c.cli as keyof typeof CLI],
      fecha: f(c.fecha),
      hora: c.hora,
      items: c.items.map(([cod, q]: [string, number]) => ({ cantidad: q, precioContado: PROD[cod] })),
      nCuotas: c.n,
    });
    expect(r.capitalInicial.toFixed(2)).toBe(c.C);
    expect(fechaDMY(r.corte)).toBe(c.corte);
    expect(fechaDMY(r.finGracia)).toBe(c.fin);
    expect(r.diasGracia).toBe(c.dg);
    expect(fechaDMY(r.cuotas[0].vencimiento)).toBe(c.prim);
    expect(r.interesGracia.toFixed(2)).toBe(c.ig);
    expect(r.capitalFinanciado.toFixed(2)).toBe(c.Cg);
    expect(r.cuotaRegular.toFixed(2)).toBe(c.R);
    expect(r.totalIntereses.toFixed(2)).toBe(c.ti);
    expect(r.totalProgramado.toFixed(2)).toBe(c.tp);
    expect(r.cuotas.map((q) => [fechaDMY(q.vencimiento), q.saldoInicial.toFixed(2), q.interes.toFixed(2), q.amortizacion.toFixed(2), q.monto.toFixed(2), q.saldoFinal.toFixed(2)])).toEqual(CRONO[nombre]);
  });

  it('tasa de gracia de CR1', () => {
    const r = calcularCompra({ cliente: CLI.rosa, fecha: f('15/09/2026'), hora: '10:30', items: [{ cantidad: 1, precioContado: '131.30' }], nCuotas: 3 });
    expect(r.tasaGracia.toFixed(10)).toBe('0.0109781382');
  });
});

describe('Casos de validación', () => {
  it('tasa cero: 33.33, 33.33, 33.34', () => {
    const { cuotas } = cronogramaFrances(dec(100), dec(0), 3, f('26/09/2026'), 26);
    expect(cuotas.map((c) => c.monto.toFixed(2))).toEqual(['33.33', '33.33', '33.34']);
  });

  it('cuota única: Cg 101.09, cuota 104.12', () => {
    const r = calcularCompra({
      cliente: { tasaInteres: '3', periodoTasa: 'MENSUAL', diaCorte: 20, horaCorte: '23:59', diaPago: 26 },
      fecha: f('15/09/2026'), hora: '10:00', items: [{ cantidad: 1, precioContado: 100 }], nCuotas: 1,
    });
    expect(r.diasGracia).toBe(11);
    expect(r.capitalFinanciado.toFixed(2)).toBe('101.09');
    expect(r.cuotas[0].monto.toFixed(2)).toBe('104.12');
  });

  it('cuotas máximas: P007 (2) limita a 2', () => {
    expect(maxCuotasPermitidas(6, [2, 6])).toBe(2);
  });

  it('cambio de ciclo: 20/09 23:59 entra, 21/09 00:00 no', () => {
    expect(fechaDMY(calcularCiclo(CLI.rosa, f('20/09/2026'), '23:59').corte)).toBe('20/09/2026');
    expect(fechaDMY(calcularCiclo(CLI.rosa, f('21/09/2026'), '00:00').corte)).toBe('20/10/2026');
  });

  it('día de pago 31: 28/02/2027 y 31/03/2027', () => {
    const fin = mk(2027, 1, 31);
    expect(fechaDMY(sumarMeses(fin, 1, 31))).toBe('28/02/2027');
    expect(fechaDMY(sumarMeses(fin, 2, 31))).toBe('31/03/2027');
  });

  it('30E/360', () => {
    expect(dias360(f('15/09/2026'), f('26/09/2026'))).toBe(11);
    expect(dias360(f('31/01/2026'), f('28/02/2026'))).toBe(28);
  });
});

describe('Pago y mora', () => {
  const mario = [
    { vencimiento: f('26/10/2026'), interes: dec('2.08'), amortizacion: dec('33.69') },
    { vencimiento: f('26/10/2026'), interes: dec('1.56'), amortizacion: dec('51.16') },
    { vencimiento: f('26/10/2026'), interes: dec('2.64'), amortizacion: dec('42.78') },
  ];

  it('Mario paga puntual: 133.91', () => {
    const r = calcularPago(mario, f('26/10/2026'), f('26/10/2026'), CLI.mario.tasaMora, CLI.mario.periodoTasaMora);
    expect(r.totalCapital.toFixed(2)).toBe('127.63');
    expect(r.totalInteresesCuotas.toFixed(2)).toBe('6.28');
    expect(r.interesesMora.toFixed(2)).toBe('0.00');
    expect(r.totalPagar.toFixed(2)).toBe('133.91');
  });

  it('Mario paga el 06/11: 10 días, mora 0.36, total 134.27', () => {
    const r = calcularPago(mario, f('26/10/2026'), f('06/11/2026'), CLI.mario.tasaMora, CLI.mario.periodoTasaMora);
    expect(r.diasMora).toBe(10);
    expect(r.tasaMoraPeriodo.times(100).toFixed(7)).toBe('0.2669869');
    expect(r.interesesMora.toFixed(2)).toBe('0.36');
    expect(r.totalPagar.toFixed(2)).toBe('134.27');
  });

  it('Rosa paga CR1 cuota 1 el 06/11: 10 días, tasa 0.3305890 %, mora 0.16, total 47.11', () => {
    const o = [{ vencimiento: f('26/10/2026'), interes: dec('4.01'), amortizacion: dec('42.94') }];
    const r = calcularPago(o, f('26/10/2026'), f('06/11/2026'), CLI.rosa.tasaMora, CLI.rosa.periodoTasaMora);
    expect(r.diasMora).toBe(10);
    expect(r.tasaMoraPeriodo.times(100).toFixed(7)).toBe('0.3305890');
    expect(r.interesesMora.toFixed(2)).toBe('0.16');
    expect(r.totalPagar.toFixed(2)).toBe('47.11');
  });

  it('Carlos paga puntual CC1 cuota 1: 67.16', () => {
    const o = [{ vencimiento: f('05/12/2026'), interes: dec('3.96'), amortizacion: dec('63.20') }];
    const r = calcularPago(o, f('05/12/2026'), f('05/12/2026'), CLI.carlos.tasaMora, CLI.carlos.periodoTasaMora);
    expect(r.interesesMora.toFixed(2)).toBe('0.00');
    expect(r.totalPagar.toFixed(2)).toBe('67.16');
  });
});
