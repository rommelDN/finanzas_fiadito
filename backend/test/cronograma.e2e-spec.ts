import { INestApplication } from '@nestjs/common';
import { CR1, cuerpoCompra, db, fijarLimites, idsClientes, iniciarApp, limpiarCompras } from './helpers';

// Requiere MySQL con el seed aplicado. Cronograma francés, días de gracia, mora y pago por cuota (sección 8).
describe('Cronograma de pagos (e2e)', () => {
  let app: INestApplication;
  let t: Awaited<ReturnType<typeof iniciarApp>>;
  let ids: Awaited<ReturnType<typeof idsClientes>>;
  const api = () => t.api();
  const auth = (u: string) => t.auth(u);
  const compras: Record<string, string> = {};

  const registrar = async (clave: string, c: 'rosa' | 'carlos' | 'mario', fechaHora: string, items: [string, number][], n: number) => {
    const r = await api().post('/api/compras').set(auth('ltorres')).send(cuerpoCompra(ids[c], fechaHora, items, n)).expect(201);
    compras[clave] = r.body.id;
  };
  const cron = (clave: string, query = '') => api().get(`/api/cronograma/${compras[clave]}${query}`).set(auth('ltorres'));
  const pago = (clave: string, diasMora?: number) =>
    api().get(`/api/cronograma/${compras[clave]}/pago${diasMora === undefined ? '' : `?diasMora=${diasMora}`}`).set(auth('ltorres'));
  const pagar = (clave: string, body: object) => api().post(`/api/cronograma/${compras[clave]}/pagar`).set(auth('ltorres')).send(body);
  const gracia = (clave: string, diasGracia: number) =>
    api().patch(`/api/cronograma/${compras[clave]}/gracia`).set(auth('ltorres')).send({ diasGracia });
  const credito = async (c: 'rosa' | 'carlos' | 'mario') => (await api().get(`/api/compras/credito?clienteId=${ids[c]}`).set(auth('ltorres')).expect(200)).body;

  beforeAll(async () => {
    t = await iniciarApp();
    app = t.app;
    await t.login('admin', 'ltorres');
    ids = await idsClientes();
    await limpiarCompras();
    await fijarLimites('seccion8');
    await registrar('cr1', 'rosa', '2026-09-15T10:30', CR1, 3);
    await registrar('cc1', 'carlos', '2026-09-27T14:00', [['P007', 1], ['P001', 2], ['P002', 1], ['P004', 4]], 2);
    await registrar('cm1', 'mario', '2026-08-10T09:00', [['P001', 2], ['P002', 2], ['P004', 4], ['P006', 1]], 3);
    await registrar('cm2', 'mario', '2026-09-03T18:00', [['P007', 1]], 1);
    await registrar('cm3', 'mario', '2026-09-15T11:00', [['P003', 12], ['P005', 5], ['P002', 2]], 2);
  });

  afterAll(async () => {
    await limpiarCompras();
    await fijarLimites('seed');
    await app.close();
    await db.$disconnect();
  });

  describe('cronograma francés', () => {
    it('muestra la tabla de CR1 con su gracia, cuota regular y próxima cuota', async () => {
      const r = await cron('cr1').expect(200);
      expect(r.body).toMatchObject({ vistaPrevia: false, editable: true, motivoNoEditable: null });
      expect(r.body.resumen).toMatchObject({ diasGracia: 11, capitalFinanciado: '132.74', cuotaRegular: '46.95', interesGracia: '1.44', totalIntereses: '9.54', totalProgramado: '140.84' });
      expect(r.body.cuotas.map((c: any) => [c.numero, c.fechaVencimiento, c.interes, c.amortizacion, c.montoCuota, c.saldoFinal, c.estado])).toEqual([
        [1, '2026-10-26', '4.01', '42.94', '46.95', '89.80', 'PENDIENTE'],
        [2, '2026-11-26', '2.71', '44.24', '46.95', '45.56', 'PENDIENTE'],
        [3, '2026-12-26', '1.38', '45.56', '46.94', '0.00', 'PENDIENTE'],
      ]);
      expect(r.body.proxima).toMatchObject({ numero: 1, fechaVencimiento: '2026-10-26', montoCuota: '46.95' });
    });

    it('con otros días de gracia devuelve una vista previa sin guardar nada', async () => {
      const r = await cron('cr1', '?diasGracia=30').expect(200);
      expect(r.body.vistaPrevia).toBe(true);
      // 30 días = 1 mes = TEM (3.0225 %): 131.30 × 0.030225 = 3.97
      expect(r.body.resumen).toMatchObject({ diasGracia: 30, interesGracia: '3.97', capitalFinanciado: '135.27', fechaFinGracia: '2026-10-15' });
      expect(r.body.cuotas[0].fechaVencimiento).toBe('2026-11-15');
      const amortizado = r.body.cuotas.reduce((s: number, c: any) => s + Number(c.amortizacion), 0);
      expect(amortizado).toBeCloseTo(135.27, 2);
      expect(r.body.cuotas[2].saldoFinal).toBe('0.00');
      expect((await db.compra.findUniqueOrThrow({ where: { id: BigInt(compras.cr1) } })).diasGracia).toBe(11);

      const cero = await cron('cr1', '?diasGracia=0').expect(200);
      expect(cero.body.resumen).toMatchObject({ interesGracia: '0.00', capitalFinanciado: '131.30', fechaFinGracia: '2026-09-15' });
      expect(cero.body.cuotas[0].fechaVencimiento).toBe('2026-10-15');
    });

    it('valida los días de gracia (0 a 90) y el rol', async () => {
      await cron('cr1', '?diasGracia=91').expect(400);
      await gracia('cr1', -1).expect(400);
      await gracia('cr1', 91).expect(400);
      await api().patch(`/api/cronograma/${compras.cr1}/gracia`).set(auth('admin')).send({ diasGracia: 5 }).expect(403);
      await api().get(`/api/cronograma/${compras.cr1}`).set(auth('admin')).expect(403);
      await api().get('/api/cronograma/999999').set(auth('ltorres')).expect(404);
    });

    it('no deja pasarse del límite de crédito al aumentar la gracia', async () => {
      await db.cliente.update({ where: { id: BigInt(ids.rosa) }, data: { limiteCredito: '135.00' } });
      try {
        const r = await gracia('cr1', 30).expect(400);
        expect(JSON.stringify(r.body.message)).toMatch(/excede el crédito disponible/);
      } finally {
        await db.cliente.update({ where: { id: BigInt(ids.rosa) }, data: { limiteCredito: '1000.00' } });
      }
    });

    it('aplica la gracia: recalcula y guarda el cronograma; volver al valor original lo restaura', async () => {
      const r = await gracia('cr1', 30).expect(200);
      expect(r.body.resumen).toMatchObject({ diasGracia: 30, capitalFinanciado: '135.27', fechaFinGracia: '2026-10-15' });
      expect(r.body.cuotas[0].fechaVencimiento).toBe('2026-11-15');
      const bd = await db.compra.findUniqueOrThrow({ where: { id: BigInt(compras.cr1) }, include: { cuotas: true } });
      expect(bd.capitalFinanciado.toString()).toBe('135.27');
      expect(bd.cuotas).toHaveLength(3);
      expect((await credito('rosa')).deudaPendiente).toBe('135.27');

      const vuelta = await gracia('cr1', 11).expect(200);
      expect(vuelta.body.resumen).toMatchObject({ diasGracia: 11, capitalFinanciado: '132.74', cuotaRegular: '46.95', fechaFinGracia: '2026-09-26' });
      expect(vuelta.body.cuotas.map((c: any) => c.fechaVencimiento)).toEqual(['2026-10-26', '2026-11-26', '2026-12-26']);
    });
  });

  describe('mora y pago de la próxima cuota', () => {
    it('calcula la mora con los días indicados: Rosa, 10 días → tasa 0.3305890 %, mora 0.16, total 47.11', async () => {
      const r = await pago('cr1', 10).expect(200);
      expect(r.body).toMatchObject({
        numero: 1, nCuotas: 3, diasMora: 10, tasaMoraPeriodoPct: '0.3305890', mora: '0.16', totalPagar: '47.11',
        imputacion: { mora: '0.16', intereses: '4.01', capital: '42.94' },
      });
      const puntual = await pago('cr1', 0).expect(200);
      expect(puntual.body).toMatchObject({ diasMora: 0, mora: '0.00', totalPagar: '46.95' });
      const sug = await pago('cr1').expect(200);
      expect(sug.body.diasMora).toBe(sug.body.diasMoraSugeridos);
    });

    it('rechaza montos distintos del total, cuota que no es la próxima y datos inválidos', async () => {
      const base = { numeroCuota: 1, medioPago: 'EFECTIVO', diasMora: 10 };
      const parcial = await pagar('cr1', { ...base, montoPagado: 40 }).expect(400);
      expect(JSON.stringify(parcial.body.message)).toMatch(/exactamente 47\.11/);
      await pagar('cr1', { ...base, montoPagado: 46.95 }).expect(400); // sin la mora
      await pagar('cr1', { ...base, montoPagado: 50 }).expect(400); // excedente
      await pagar('cr1', { ...base, numeroCuota: 2, montoPagado: 47.11 }).expect(409);
      await pagar('cr1', { ...base, medioPago: 'BITCOIN', montoPagado: 47.11 }).expect(400);
      await pagar('cr1', { ...base, diasMora: -1, montoPagado: 47.11 }).expect(400);
      expect(await db.pago.count()).toBe(0);
    });

    it('Rosa paga la cuota 1 con 10 días de mora: imputa mora → interés → capital y libera solo el capital', async () => {
      const r = await pagar('cr1', { numeroCuota: 1, medioPago: 'YAPE', montoPagado: 47.11, diasMora: 10 }).expect(201);
      expect(r.body.cuotas[0]).toMatchObject({ estado: 'PAGADA', pago: { diasMora: 10, montoMora: '0.16', montoTotal: '47.11', medioPago: 'YAPE' } });
      expect(r.body.proxima.numero).toBe(2);
      expect(r.body.editable).toBe(false);
      expect(r.body.motivoNoEditable).toMatch(/Ya se pagó una cuota/);
      const bd = await db.pago.findFirstOrThrow({ where: { cuota: { compraId: BigInt(compras.cr1), numero: 1 } } });
      expect([bd.montoMora.toString(), bd.montoInteres.toString(), bd.montoCapital.toString()]).toEqual(['0.16', '4.01', '42.94']);
      expect((await credito('rosa')).creditoDisponible).toBe('910.20');
      await gracia('cr1', 5).expect(409);
    });

    it('un doble clic no paga dos cuotas: solo se acepta una de dos solicitudes simultáneas', async () => {
      const body = { numeroCuota: 2, medioPago: 'EFECTIVO', montoPagado: 46.95, diasMora: 0 };
      const rs = await Promise.all([pagar('cr1', body), pagar('cr1', body)]);
      expect(rs.map((r) => r.status).sort()).toEqual([201, 409]);
      expect(await db.pago.count({ where: { cuota: { compraId: BigInt(compras.cr1) } } })).toBe(2);
    });

    it('al pagar la última cuota la compra queda CANCELADA y no admite más pagos', async () => {
      const r = await pagar('cr1', { numeroCuota: 3, medioPago: 'EFECTIVO', montoPagado: 46.94, diasMora: 0 }).expect(201);
      expect(r.body.compra.estado).toBe('CANCELADA');
      expect(r.body.proxima).toBeNull();
      const otra = await pagar('cr1', { numeroCuota: 3, medioPago: 'EFECTIVO', montoPagado: 46.94, diasMora: 0 }).expect(409);
      expect(JSON.stringify(otra.body.message)).toMatch(/no tiene cuotas pendientes/);
      await pago('cr1').expect(409);
      expect((await credito('rosa')).deudaPendiente).toBe('0.00');
    });

    it('Carlos paga CC1 cuota 1 puntual: sin mora, total 67.16, crédito 734.85', async () => {
      const r = await pagar('cc1', { numeroCuota: 1, medioPago: 'TRANSFERENCIA', montoPagado: 67.16, diasMora: 0 }).expect(201);
      expect(r.body.cuotas[0].pago).toMatchObject({ diasMora: 0, montoMora: '0', montoTotal: '67.16' });
      expect((await credito('carlos')).creditoDisponible).toBe('734.85');
    });
  });

  describe('pagos de Mario', () => {
    it('pagar la cuota 1 de CM1 deja su pago registrado', async () => {
      await pagar('cm1', { numeroCuota: 1, medioPago: 'EFECTIVO', montoPagado: 35.77, diasMora: 0 }).expect(201);
      const c = await cron('cm1').expect(200);
      expect(c.body.cuotas[0].pago).toMatchObject({ montoTotal: '35.77' });
    });

    it('cuota 2 de CM1, 1 de CM2 y 1 de CM3 con 10 días de mora: mora total 0.36, total 134.27', async () => {
      let mora = 0;
      let total = 0;
      for (const [clave, numero] of [['cm1', 2], ['cm2', 1], ['cm3', 1]] as const) {
        const p = await pago(clave, 10).expect(200);
        expect(p.body.numero).toBe(numero);
        mora += Number(p.body.mora);
        total += Number(p.body.totalPagar);
        await pagar(clave, { numeroCuota: numero, medioPago: 'PLIN', montoPagado: Number(p.body.totalPagar), diasMora: 10 }).expect(201);
      }
      expect(mora.toFixed(2)).toBe('0.36');
      expect(total.toFixed(2)).toBe('134.27');
    });

    it('deuda pendiente 78.79 (108.32 con CM4) y crédito 521.21; CM2 queda CANCELADA y CM1 vigente', async () => {
      expect(await credito('mario')).toMatchObject({ deudaPendiente: '78.79', creditoDisponible: '521.21' });
      expect((await cron('cm2').expect(200)).body.compra.estado).toBe('CANCELADA');
      const cm1 = await cron('cm1').expect(200);
      expect(cm1.body.compra.estado).toBe('VIGENTE');
      expect(cm1.body.cuotas.map((c: any) => c.estado)).toEqual(['PAGADA', 'PAGADA', 'PENDIENTE']);
    });
  });
});
