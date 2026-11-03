import { INestApplication } from '@nestjs/common';
import { CR1, cuerpoCompra, db, fijarLimites, idsClientes, iniciarApp, limpiarCompras } from './helpers';

// Requiere MySQL con el seed aplicado. Cronograma francés con cuotas de gracia (interés capitalizado), mora y pago por cuota.
// CR1 (Rosa, S/ 131.30, 3 cuotas mensuales, TEM 3.0225 %): sin gracia 46.44 / 46.44 / 46.43; con 1 cuota de gracia 0 / 70.72 / 70.71.
describe('Cronograma de pagos (e2e)', () => {
  let app: INestApplication;
  let t: Awaited<ReturnType<typeof iniciarApp>>;
  let ids: Awaited<ReturnType<typeof idsClientes>>;
  const api = () => t.api();
  const auth = (u: string) => t.auth(u);
  const compras: Record<string, string> = {};

  const registrar = async (clave: string, c: 'rosa' | 'carlos' | 'mario', fechaHora: string, items: [string, number][], n: number, extra: object = {}) => {
    const r = await api().post('/api/compras').set(auth('ltorres')).send({ ...cuerpoCompra(ids[c], fechaHora, items, n), ...extra }).expect(201);
    compras[clave] = r.body.id;
  };
  const cron = (clave: string, query = '') => api().get(`/api/cronograma/${compras[clave]}${query}`).set(auth('ltorres'));
  const pago = (clave: string, diasMora?: number) =>
    api().get(`/api/cronograma/${compras[clave]}/pago${diasMora === undefined ? '' : `?diasMora=${diasMora}`}`).set(auth('ltorres'));
  const pagar = (clave: string, body: object) => api().post(`/api/cronograma/${compras[clave]}/pagar`).set(auth('ltorres')).send(body);
  const gracia = (clave: string, cuotasGracia: number) =>
    api().patch(`/api/cronograma/${compras[clave]}/gracia`).set(auth('ltorres')).send({ cuotasGracia });
  const credito = async (c: 'rosa' | 'carlos' | 'mario') => (await api().get(`/api/compras/credito?clienteId=${ids[c]}`).set(auth('ltorres')).expect(200)).body;

  beforeAll(async () => {
    t = await iniciarApp();
    app = t.app;
    await t.login('admin', 'ltorres');
    ids = await idsClientes();
    await limpiarCompras();
    await fijarLimites('seccion8');
    await registrar('cr1', 'rosa', '2026-09-15T10:30', CR1, 3);
  });

  afterAll(async () => {
    await limpiarCompras();
    await fijarLimites('seed');
    await app.close();
    await db.$disconnect();
  });

  describe('cronograma francés con cuotas de gracia', () => {
    it('muestra la tabla de CR1 sin gracia, con cuota regular y próxima cuota', async () => {
      const r = await cron('cr1').expect(200);
      expect(r.body).toMatchObject({ vistaPrevia: false, editable: true, motivoNoEditable: null });
      expect(r.body.resumen).toMatchObject({ cuotasGracia: 0, capitalFinanciado: '131.30', cuotaRegular: '46.44', interesGracia: '0.00', totalIntereses: '8.01', totalProgramado: '139.31' });
      expect(r.body.cuotas.map((c: any) => [c.numero, c.fechaVencimiento, c.interes, c.amortizacion, c.montoCuota, c.saldoFinal, c.estado])).toEqual([
        [1, '2026-10-15', '3.97', '42.47', '46.44', '88.83', 'PENDIENTE'],
        [2, '2026-11-15', '2.68', '43.76', '46.44', '45.07', 'PENDIENTE'],
        [3, '2026-12-15', '1.36', '45.07', '46.43', '0.00', 'PENDIENTE'],
      ]);
      expect(r.body.proxima).toMatchObject({ numero: 1, fechaVencimiento: '2026-10-15', montoCuota: '46.44' });
    });

    it('con 1 cuota de gracia devuelve una vista previa: el interés se suma al saldo y pasa a ser el saldo inicial siguiente', async () => {
      const r = await cron('cr1', '?cuotasGracia=1').expect(200);
      expect(r.body.vistaPrevia).toBe(true);
      expect(r.body.resumen).toMatchObject({ cuotasGracia: 1, interesGracia: '3.97', capitalFinanciado: '135.27', cuotaRegular: '70.72', totalIntereses: '10.13' });
      expect(r.body.cuotas.map((c: any) => [c.numero, c.estado, c.saldoInicial, c.interes, c.amortizacion, c.montoCuota, c.saldoFinal])).toEqual([
        [1, 'GRACIA', '131.30', '3.97', '0.00', '0.00', '135.27'],
        [2, 'PENDIENTE', '135.27', '4.09', '66.63', '70.72', '68.64'],
        [3, 'PENDIENTE', '68.64', '2.07', '68.64', '70.71', '0.00'],
      ]);
      expect((await db.compra.findUniqueOrThrow({ where: { id: BigInt(compras.cr1) } })).cuotasGracia).toBe(0);
    });

    it('valida las cuotas de gracia (0 a 3 y menos que el total) y el rol', async () => {
      await cron('cr1', '?cuotasGracia=4').expect(400);
      await cron('cr1', '?cuotasGracia=3').expect(400); // 3 de 3 cuotas: no quedaría ninguna a pagar
      await gracia('cr1', -1).expect(400);
      await gracia('cr1', 4).expect(400);
      const r = await gracia('cr1', 3).expect(400);
      expect(JSON.stringify(r.body.message)).toMatch(/entre 0 y 2/);
      await api().patch(`/api/cronograma/${compras.cr1}/gracia`).set(auth('admin')).send({ cuotasGracia: 1 }).expect(403);
      await api().get(`/api/cronograma/${compras.cr1}`).set(auth('admin')).expect(403);
      await api().get('/api/cronograma/999999').set(auth('ltorres')).expect(404);
    });

    it('no deja pasarse del límite de crédito al aumentar la gracia', async () => {
      await db.cliente.update({ where: { id: BigInt(ids.rosa) }, data: { limiteCredito: '135.00' } });
      try {
        const r = await gracia('cr1', 1).expect(400);
        expect(JSON.stringify(r.body.message)).toMatch(/excede el crédito disponible/);
      } finally {
        await db.cliente.update({ where: { id: BigInt(ids.rosa) }, data: { limiteCredito: '1000.00' } });
      }
    });

    it('aplica la gracia: recalcula y guarda; volver a 0 restaura el cronograma original', async () => {
      const r = await gracia('cr1', 1).expect(200);
      expect(r.body.resumen).toMatchObject({ cuotasGracia: 1, capitalFinanciado: '135.27', cuotaRegular: '70.72' });
      expect(r.body.cuotas.map((c: any) => c.estado)).toEqual(['GRACIA', 'PENDIENTE', 'PENDIENTE']);
      expect(r.body.proxima).toMatchObject({ numero: 2, montoCuota: '70.72' }); // la cuota de gracia no se cobra
      const bd = await db.compra.findUniqueOrThrow({ where: { id: BigInt(compras.cr1) }, include: { cuotas: true } });
      expect(bd.capitalFinanciado.toString()).toBe('135.27');
      expect(bd.cuotas).toHaveLength(3);
      expect((await credito('rosa')).deudaPendiente).toBe('135.27');

      const vuelta = await gracia('cr1', 0).expect(200);
      expect(vuelta.body.resumen).toMatchObject({ cuotasGracia: 0, capitalFinanciado: '131.30', cuotaRegular: '46.44' });
      expect(vuelta.body.cuotas.map((c: any) => c.estado)).toEqual(['PENDIENTE', 'PENDIENTE', 'PENDIENTE']);
      expect(vuelta.body.proxima.numero).toBe(1);
    });
  });

  describe('mora y pago de la próxima cuota', () => {
    it('calcula la mora con los días indicados: Rosa, 10 días → tasa 0.3305890 %, mora 0.15, total 46.59', async () => {
      const r = await pago('cr1', 10).expect(200);
      expect(r.body).toMatchObject({
        numero: 1, nCuotas: 3, diasMora: 10, tasaMoraPeriodoPct: '0.3305890', mora: '0.15', totalPagar: '46.59',
        imputacion: { mora: '0.15', intereses: '3.97', capital: '42.47' },
      });
      const puntual = await pago('cr1', 0).expect(200);
      expect(puntual.body).toMatchObject({ diasMora: 0, mora: '0.00', totalPagar: '46.44' });
      const sug = await pago('cr1').expect(200);
      expect(sug.body.diasMora).toBe(sug.body.diasMoraSugeridos);
    });

    it('rechaza montos distintos del total, cuota que no es la próxima y datos inválidos', async () => {
      const base = { numeroCuota: 1, medioPago: 'EFECTIVO', diasMora: 10 };
      const parcial = await pagar('cr1', { ...base, montoPagado: 40 }).expect(400);
      expect(JSON.stringify(parcial.body.message)).toMatch(/exactamente 46\.59/);
      await pagar('cr1', { ...base, montoPagado: 46.44 }).expect(400); // sin la mora
      await pagar('cr1', { ...base, montoPagado: 50 }).expect(400); // excedente
      await pagar('cr1', { ...base, numeroCuota: 2, montoPagado: 46.59 }).expect(409);
      await pagar('cr1', { ...base, medioPago: 'BITCOIN', montoPagado: 46.59 }).expect(400);
      await pagar('cr1', { ...base, diasMora: -1, montoPagado: 46.59 }).expect(400);
      expect(await db.pago.count()).toBe(0);
    });

    it('Rosa paga la cuota 1 con 10 días de mora: imputa mora → interés → capital y libera solo el capital', async () => {
      const r = await pagar('cr1', { numeroCuota: 1, medioPago: 'YAPE', montoPagado: 46.59, diasMora: 10 }).expect(201);
      expect(r.body.cuotas[0]).toMatchObject({ estado: 'PAGADA', pago: { diasMora: 10, montoMora: '0.15', montoTotal: '46.59', medioPago: 'YAPE' } });
      expect(r.body.proxima.numero).toBe(2);
      expect(r.body.editable).toBe(false);
      expect(r.body.motivoNoEditable).toMatch(/Ya se pagó una cuota/);
      const bd = await db.pago.findFirstOrThrow({ where: { cuota: { compraId: BigInt(compras.cr1), numero: 1 } } });
      expect([bd.montoMora.toString(), bd.montoInteres.toString(), bd.montoCapital.toString()]).toEqual(['0.15', '3.97', '42.47']);
      expect((await credito('rosa')).creditoDisponible).toBe('911.17');
      await gracia('cr1', 1).expect(409);
    });

    it('un doble clic no paga dos cuotas: solo se acepta una de dos solicitudes simultáneas', async () => {
      const body = { numeroCuota: 2, medioPago: 'EFECTIVO', montoPagado: 46.44, diasMora: 0 };
      const rs = await Promise.all([pagar('cr1', body), pagar('cr1', body)]);
      expect(rs.map((r) => r.status).sort()).toEqual([201, 409]);
      expect(await db.pago.count({ where: { cuota: { compraId: BigInt(compras.cr1) } } })).toBe(2);
    });

    it('al pagar la última cuota la compra queda CANCELADA y no admite más pagos', async () => {
      const r = await pagar('cr1', { numeroCuota: 3, medioPago: 'EFECTIVO', montoPagado: 46.43, diasMora: 0 }).expect(201);
      expect(r.body.compra.estado).toBe('CANCELADA');
      expect(r.body.proxima).toBeNull();
      const otra = await pagar('cr1', { numeroCuota: 3, medioPago: 'EFECTIVO', montoPagado: 46.43, diasMora: 0 }).expect(409);
      expect(JSON.stringify(otra.body.message)).toMatch(/no tiene cuotas pendientes/);
      await pago('cr1').expect(409);
      expect((await credito('rosa')).deudaPendiente).toBe('0.00');
    });
  });

  describe('compra con 1 cuota de gracia', () => {
    beforeAll(async () => {
      await registrar('cg', 'rosa', '2026-09-15T10:30', CR1, 3, { cuotasGracia: 1 });
    });

    it('la cuota de gracia no se cobra: se paga desde la cuota 2 y la compra se cancela al terminar', async () => {
      const c = await cron('cg').expect(200);
      expect(c.body.cuotas.map((q: any) => q.estado)).toEqual(['GRACIA', 'PENDIENTE', 'PENDIENTE']);
      expect(c.body.proxima).toMatchObject({ numero: 2, montoCuota: '70.72' });
      await pagar('cg', { numeroCuota: 1, medioPago: 'EFECTIVO', montoPagado: 0.01, diasMora: 0 }).expect(409);
      expect((await pago('cg', 0).expect(200)).body).toMatchObject({ numero: 2, totalPagar: '70.72' });
      await pagar('cg', { numeroCuota: 2, medioPago: 'EFECTIVO', montoPagado: 70.72, diasMora: 0 }).expect(201);
      const fin = await pagar('cg', { numeroCuota: 3, medioPago: 'EFECTIVO', montoPagado: 70.71, diasMora: 0 }).expect(201);
      expect(fin.body.compra.estado).toBe('CANCELADA');
      expect(fin.body.cuotas.map((q: any) => q.estado)).toEqual(['GRACIA', 'PAGADA', 'PAGADA']);
      expect((await credito('rosa')).deudaPendiente).toBe('0.00'); // 135.27 financiados − 66.63 − 68.64
    });
  });
});
