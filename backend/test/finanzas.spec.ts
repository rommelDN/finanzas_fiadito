import {
  calcularCompra,
  calcularCronograma,
  calcularPago,
  calcularTasas,
  cronogramaConGracia,
  dec,
  dias360,
  fechaDMY,
  maxCuotasPermitidas,
  mk,
  Periodo,
  sumarDias,
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

describe('Cuotas de gracia (el interés se capitaliza)', () => {
  it('tasa cero y 1 cuota de gracia: la gracia no cambia el saldo; 33.33, 33.33, 33.34', () => {
    const { cuotas, capitalFinanciado } = cronogramaConGracia(dec(100), dec(0), 4, 1, f('15/09/2026'));
    expect(capitalFinanciado.toFixed(2)).toBe('100.00');
    expect(cuotas.map((c) => c.monto.toFixed(2))).toEqual(['0.00', '33.33', '33.33', '33.34']);
    expect(cuotas.map((c) => c.gracia)).toEqual([true, false, false, false]);
  });

  it('S/ 100, 10 % mensual, 3 cuotas con 1 de gracia: 110.00 pasa a ser el saldo inicial de la cuota 2', () => {
    const r = calcularCronograma({ capital: 100, tasaInteres: 10, periodoTasa: 'MENSUAL', fecha: f('15/09/2026'), nCuotas: 3, cuotasGracia: 1 });
    expect(r.cuotas.map((q) => [fechaDMY(q.vencimiento), q.saldoInicial.toFixed(2), q.interes.toFixed(2), q.amortizacion.toFixed(2), q.monto.toFixed(2), q.saldoFinal.toFixed(2)])).toEqual([
      ['15/10/2026', '100.00', '10.00', '0.00', '0.00', '110.00'],
      ['15/11/2026', '110.00', '11.00', '52.38', '63.38', '57.62'],
      ['15/12/2026', '57.62', '5.76', '57.62', '63.38', '0.00'],
    ]);
    expect(r.interesGracia.toFixed(2)).toBe('10.00');
    expect(r.capitalFinanciado.toFixed(2)).toBe('110.00');
    expect(r.cuotaRegular.toFixed(2)).toBe('63.38');
    expect(r.totalIntereses.toFixed(2)).toBe('26.76');
    expect(r.totalProgramado.toFixed(2)).toBe('126.76');
  });

  it('sin cuotas de gracia el cronograma es el francés normal (S/ 100, 10 %, 3 cuotas: 40.21)', () => {
    const r = calcularCronograma({ capital: 100, tasaInteres: 10, periodoTasa: 'MENSUAL', fecha: f('15/09/2026'), nCuotas: 3 });
    expect(r.cuotas.every((q) => !q.gracia)).toBe(true);
    expect(r.cuotaRegular.toFixed(2)).toBe('40.21');
    expect(r.interesGracia.toFixed(2)).toBe('0.00');
    expect(r.cuotas[2].saldoFinal.toFixed(2)).toBe('0.00');
  });

  it('8 cuotas con 0 a 3 de gracia: encadena los saldos, amortiza todo y la cuota es constante', () => {
    for (const g of [0, 1, 2, 3]) {
      const r = calcularCompra({ cliente: CLI.rosa, fecha: f('15/09/2026'), items: [{ cantidad: 1, precioContado: '131.30' }], nCuotas: 8, cuotasGracia: g });
      expect(r.cuotas).toHaveLength(8);
      expect(r.cuotas.filter((q) => q.gracia)).toHaveLength(g);
      r.cuotas.forEach((q, k) => {
        if (k > 0) expect(q.saldoInicial.eq(r.cuotas[k - 1].saldoFinal)).toBe(true);
        if (q.gracia) {
          expect(q.monto.toFixed(2)).toBe('0.00');
          expect(q.saldoFinal.eq(q.saldoInicial.plus(q.interes))).toBe(true);
        }
      });
      expect(r.cuotas.reduce((s, q) => s.plus(q.amortizacion), dec(0)).eq(r.capitalFinanciado)).toBe(true);
      expect(r.cuotas[7].saldoFinal.toFixed(2)).toBe('0.00');
      expect(r.capitalFinanciado.minus(r.capitalInicial).eq(r.interesGracia)).toBe(true);
      const pagos = r.cuotas.filter((q) => !q.gracia).slice(0, -1).map((q) => q.monto.toFixed(2));
      expect(new Set(pagos).size).toBe(1);
    }
  });

  it('más gracia = más capital financiado y cuotas mayores', () => {
    const cr = (g: number) => calcularCronograma({ capital: 131.3, tasaInteres: '6.1363551', periodoTasa: 'BIMESTRAL', fecha: f('15/09/2026'), nCuotas: 8, cuotasGracia: g });
    expect(cr(2).capitalFinanciado.gt(cr(1).capitalFinanciado)).toBe(true);
    expect(cr(2).cuotaRegular.gt(cr(0).cuotaRegular)).toBe(true);
  });

  it('las cuotas de gracia deben ser menores que el total de cuotas', () => {
    expect(() => cronogramaConGracia(dec(100), dec(0.1), 3, 3, f('15/09/2026'))).toThrow();
    expect(() => cronogramaConGracia(dec(100), dec(0.1), 3, -1, f('15/09/2026'))).toThrow();
  });
});

describe('Casos de validación', () => {
  it('cuotas máximas: P007 (2) limita a 2', () => {
    expect(maxCuotasPermitidas(6, [2, 6])).toBe(2);
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

describe('Días de mora indicados a mano', () => {
  it('Rosa con 10 días de mora (aunque la fecha real sea distinta): mora 0.16, total 47.11', () => {
    const o = [{ vencimiento: f('26/10/2026'), interes: dec('4.01'), amortizacion: dec('42.94') }];
    const r = calcularPago(o, f('26/10/2026'), f('26/10/2026'), CLI.rosa.tasaMora, CLI.rosa.periodoTasaMora, 10);
    expect(r.diasMora).toBe(10);
    expect(r.interesesMora.toFixed(2)).toBe('0.16');
    expect(r.totalPagar.toFixed(2)).toBe('47.11');
  });

  it('0 días de mora anula la mora aunque la fecha real sea posterior', () => {
    const o = [{ vencimiento: f('26/10/2026'), interes: dec('4.01'), amortizacion: dec('42.94') }];
    const r = calcularPago(o, f('26/10/2026'), f('06/11/2026'), CLI.rosa.tasaMora, CLI.rosa.periodoTasaMora, 0);
    expect(r.interesesMora.toFixed(2)).toBe('0.00');
    expect(r.totalPagar.toFixed(2)).toBe('46.95');
  });
});


describe('sumarDias en base 30/360', () => {
  it('un mes son 30 días y un año 360', () => {
    expect(fechaDMY(sumarDias(mk(2026, 1, 15), 30))).toBe('15/02/2026');
    expect(fechaDMY(sumarDias(mk(2026, 9, 15), 11))).toBe('26/09/2026');
    expect(fechaDMY(sumarDias(mk(2026, 3, 10), 360))).toBe('10/03/2027');
  });
  it('el día 31 cuenta como 30 y los 30 de febrero se recortan al último día', () => {
    expect(fechaDMY(sumarDias(mk(2026, 1, 31), 30))).toBe('28/02/2026');
    expect(fechaDMY(sumarDias(mk(2026, 1, 31), 0))).toBe('30/01/2026');
    expect(fechaDMY(sumarDias(mk(2026, 12, 20), 15))).toBe('05/01/2027');
  });
});


describe('período de las cuotas (TED, TEQ, TEM, TEB, TET, TEC, TES, TEA)', () => {
  const base = { capital: '100', tasaInteres: '12', periodoTasa: 'ANUAL' as const, fecha: f('15/09/2026'), nCuotas: 8 };

  it('8 cuotas con la tasa efectiva del período elegido y cuota constante', () => {
    for (const [periodo, dias] of [['DIARIA', 1], ['QUINCENAL', 15], ['MENSUAL', 30], ['BIMESTRAL', 60], ['TRIMESTRAL', 90], ['CUATRIMESTRAL', 120], ['SEMESTRAL', 180], ['ANUAL', 360]] as const) {
      const r = calcularCronograma({ ...base, periodoCuota: periodo, cuotasGracia: 1 });
      expect(r.cuotas).toHaveLength(8);
      // Tasa del período = (1+12%)^(dias/360) − 1
      expect(r.tem.toNumber()).toBeCloseTo(Math.pow(1.12, dias / 360) - 1, 10);
      expect(r.cuotas[7].saldoFinal.toFixed(2)).toBe('0.00');
      expect(new Set(r.cuotas.slice(1, 7).map((c) => c.monto.toFixed(2))).size).toBe(1);
    }
  });

  it('vencimientos cada `dias` días desde la compra en base 30/360 (mensual conserva el día del mes)', () => {
    const q = calcularCronograma({ ...base, periodoCuota: 'QUINCENAL' });
    expect(q.cuotas.slice(0, 3).map((c) => fechaDMY(c.vencimiento))).toEqual(['30/09/2026', '15/10/2026', '30/10/2026']);
    const s = calcularCronograma({ ...base, periodoCuota: 'SEMESTRAL' });
    expect(s.cuotas.slice(0, 2).map((c) => fechaDMY(c.vencimiento))).toEqual(['15/03/2027', '15/09/2027']);
    const m = calcularCronograma({ ...base });
    expect(m.cuotas[0].vencimiento).toEqual(mk(2026, 10, 15));
  });
});
