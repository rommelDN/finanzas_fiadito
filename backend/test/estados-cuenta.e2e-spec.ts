import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { EstadosCuentaService } from '../src/estados-cuenta/estados-cuenta.service';
import { configurarApp } from '../src/setup';

// Requiere MySQL con el seed aplicado. Reproduce los escenarios de pago de la sección 8.
const PASS = process.env.SEED_PASSWORD ?? 'Fiadito2026!';
const DNIS = { rosa: '40000001', carlos: '40000002', mario: '40000003' };

describe('Etapa 6: estados de cuenta y pagos con mora (e2e)', () => {
  let app: INestApplication;
  const db = new PrismaClient();
  const api = () => request(app.getHttpServer());
  const tokens: Record<string, string> = {};
  const auth = (u: string) => ({ Authorization: `Bearer ${tokens[u]}` });
  const ids: Record<string, string> = {};
  const estados: Record<string, string> = {};

  const compra = (c: 'rosa' | 'carlos' | 'mario', fechaHora: string, items: [string, number][], nCuotas: number) =>
    api()
      .post('/api/compras')
      .set(auth('ltorres'))
      .send({ clienteId: ids[c], fechaHora, nCuotas, items: items.map(([codigoProducto, cantidad]) => ({ codigoProducto, cantidad })) })
      .expect(201);
  const generar = (c: string, fechaCorte: string) =>
    api().post('/api/estados-cuenta/generar').set(auth('ltorres')).send({ clienteId: ids[c], fechaCorte });
  const pagar = (id: string, montoPagado: number, fechaPagoReal: string, medioPago = 'EFECTIVO') =>
    api().post(`/api/estados-cuenta/${id}/pagos`).set(auth('ltorres')).send({ montoPagado, fechaPagoReal, medioPago });
  const credito = async (c: string) =>
    (await api().get(`/api/compras/credito?clienteId=${ids[c]}`).set(auth('ltorres')).expect(200)).body;

  async function limpiar() {
    const clientes = await db.cliente.findMany({ where: { dni: { in: Object.values(DNIS) } }, select: { id: true } });
    const clienteId = { in: clientes.map((c) => c.id) };
    const compras = await db.compra.findMany({ where: { clienteId }, select: { id: true } });
    const compraId = { in: compras.map((c) => c.id) };
    const ecs = await db.estadoCuenta.findMany({ where: { clienteId }, select: { id: true } });
    const estadoCuentaId = { in: ecs.map((e) => e.id) };
    await db.pago.deleteMany({ where: { estadoCuentaId } });
    await db.estadoCuentaItem.deleteMany({ where: { estadoCuentaId } });
    await db.cuota.updateMany({ where: { compraId }, data: { estadoCuentaId: null } });
    await db.estadoCuenta.deleteMany({ where: { id: estadoCuentaId } });
    await db.cuota.deleteMany({ where: { compraId } });
    await db.detalleCompra.deleteMany({ where: { compraId } });
    await db.compra.deleteMany({ where: { id: compraId } });
  }

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    configurarApp(app);
    await app.init();
    for (const u of ['admin', 'ltorres', 'rosa', 'carlos']) {
      tokens[u] = (await api().post('/api/auth/login').send({ username: u, password: PASS })).body.token;
    }
    for (const [k, dni] of Object.entries(DNIS)) ids[k] = (await db.cliente.findFirstOrThrow({ where: { dni } })).id.toString();
    await limpiar();

    // Compras de la sección 8.
    await compra('rosa', '2026-09-15T10:30', [['P001', 2], ['P002', 2], ['P003', 6], ['P004', 4], ['P005', 2], ['P006', 1]], 3);
    await compra('carlos', '2026-09-27T14:00', [['P007', 1], ['P001', 2], ['P002', 1], ['P004', 4]], 2);
    await compra('mario', '2026-08-10T09:00', [['P001', 2], ['P002', 2], ['P004', 4], ['P006', 1]], 3);
    await compra('mario', '2026-09-03T18:00', [['P007', 1]], 1);
    await compra('mario', '2026-09-15T11:00', [['P003', 12], ['P005', 5], ['P002', 2]], 2);
    await compra('mario', '2026-09-24T16:00', [['P001', 1], ['P005', 2]], 1);
  });

  afterAll(async () => {
    await limpiar();
    await app.close();
    await db.$disconnect();
  });

  describe('generación del estado de cuenta', () => {
    it('Mario, corte 20/09: solo la cuota 1 de CM1 vence en el ciclo (35.77)', async () => {
      const r = await generar('mario', '2026-09-20').expect(201);
      estados.mario1 = r.body.id;
      expect(r.body).toMatchObject({ totalCapital: '32.69', totalInteresesCuotas: '3.08', total: '35.77', estado: 'PENDIENTE' });
      expect(r.body.fechaPago.slice(0, 10)).toBe('2026-09-26');
      expect(r.body.items).toHaveLength(1);
      expect(r.body.items[0]).toMatchObject({ tipo: 'CUOTA', capital: '32.69', interes: '3.08', subtotal: '35.77' });
    });

    it('es idempotente: regenerar el mismo corte devuelve el mismo estado', async () => {
      const r = await generar('mario', '2026-09-20').expect(201);
      expect(r.body.id).toBe(estados.mario1);
      expect(await db.estadoCuenta.count({ where: { clienteId: BigInt(ids.mario) } })).toBe(1);
    });

    it('rechaza fechas que no son corte del cliente y ciclos sin cuotas por cobrar', async () => {
      await generar('mario', '2026-09-21').expect(400);
      await generar('mario', '2026-02-31').expect(400);
      await generar('mario', '2026-08-20').expect(404); // CM1 venció su primera cuota recién el 26/09
      await api().post('/api/estados-cuenta/generar').set(auth('ltorres')).send({ clienteId: '99999999', fechaCorte: '2026-09-20' }).expect(404);
    });

    it('Mario, corte 20/10: cuotas ordenadas por compra, CM4 no entra (vence 26/11)', async () => {
      // Se paga primero el estado anterior, tal como indica la sección 8.
      await pagar(estados.mario1, 35.77, '2026-09-26').expect(201);
      const r = await generar('mario', '2026-10-20').expect(201);
      estados.mario2 = r.body.id;
      expect(r.body).toMatchObject({ totalCapital: '127.63', totalInteresesCuotas: '6.28', total: '133.91' });
      expect(r.body.items.map((i: any) => [i.descripcion.replace(/#\d+/, '#'), i.capital, i.interes, i.subtotal])).toEqual([
        ['Compra # - cuota 2/3', '33.69', '2.08', '35.77'],
        ['Compra # - cuota 1/1', '51.16', '1.56', '52.72'],
        ['Compra # - cuota 1/2', '42.78', '2.64', '45.42'],
      ]);
    });

    it('Rosa y Carlos: fecha de pago según su día de pago', async () => {
      const rosa = await generar('rosa', '2026-10-20').expect(201);
      estados.rosa1 = rosa.body.id;
      expect(rosa.body.total).toBe('46.95');
      expect(rosa.body.fechaPago.slice(0, 10)).toBe('2026-10-26');
      const carlos = await generar('carlos', '2026-11-25').expect(201); // corte 25, pago el 5 del mes siguiente
      estados.carlos1 = carlos.body.id;
      expect(carlos.body.total).toBe('67.16');
      expect(carlos.body.fechaPago.slice(0, 10)).toBe('2026-12-05');
    });
  });

  describe('cálculo de la mora y pagos', () => {
    it('vista previa: Mario paga el 06/11 → 10 días, tasa 0.2669869 %, mora 0.36, total 134.27', async () => {
      const r = await api().get(`/api/estados-cuenta/${estados.mario2}/calculo-pago?fechaPagoReal=2026-11-06`).set(auth('ltorres')).expect(200);
      expect(r.body).toMatchObject({
        diasMora: 10,
        tasaMoraPeriodoPct: '0.2669869',
        interesesMora: '0.36',
        totalPagar: '134.27',
        imputacion: { mora: '0.36', intereses: '6.28', capital: '127.63' },
      });
      const puntual = await api().get(`/api/estados-cuenta/${estados.mario2}/calculo-pago?fechaPagoReal=2026-10-26`).set(auth('ltorres')).expect(200);
      expect(puntual.body).toMatchObject({ diasMora: 0, interesesMora: '0.00', totalPagar: '133.91' });
    });

    it('rechaza pagos parciales, excedentes, fechas anteriores al corte y fechas inválidas', async () => {
      const parcial = await pagar(estados.mario2, 130, '2026-11-06').expect(400);
      expect(JSON.stringify(parcial.body.message)).toMatch(/exactamente 134\.27/);
      await pagar(estados.mario2, 140, '2026-11-06').expect(400);
      await pagar(estados.mario2, 133.91, '2026-11-06').expect(400); // sin la mora
      await pagar(estados.mario2, 133.91, '2026-10-19').expect(400); // antes del corte
      await pagar(estados.mario2, 133.91, '2026-13-01').expect(400);
      await api().post(`/api/estados-cuenta/${estados.mario2}/pagos`).set(auth('ltorres')).send({ montoPagado: 134.27, medioPago: 'BITCOIN' }).expect(400);
      expect((await db.estadoCuenta.findUniqueOrThrow({ where: { id: BigInt(estados.mario2) } })).estado).toBe('PENDIENTE');
    });

    it('Mario paga 134.27 el 06/11: imputa mora → interés → capital y libera solo el capital', async () => {
      const r = await pagar(estados.mario2, 134.27, '2026-11-06', 'YAPE').expect(201);
      expect(r.body.estado).toBe('PAGADO');
      expect(r.body.pago).toMatchObject({ diasMora: 10, montoMora: '0.36', montoInteres: '6.28', montoCapital: '127.63', montoTotal: '134.27', medioPago: 'YAPE' });
      const mora = r.body.items.find((i: any) => i.tipo === 'MORA');
      expect(mora).toMatchObject({ descripcion: 'Intereses por mora', interes: '0.36', subtotal: '0.36', dias: 10 });
      expect(await credito('mario')).toMatchObject({ deudaPendiente: '108.32', creditoDisponible: '491.68' });
    });

    it('no se puede pagar dos veces un estado cancelado', async () => {
      const r = await pagar(estados.mario2, 134.27, '2026-11-06').expect(409);
      expect(r.body.message).toMatch(/ya fue cancelado/);
      expect(await db.pago.count({ where: { estadoCuentaId: BigInt(estados.mario2) } })).toBe(1);
    });

    it('las cuotas pagadas quedan PAGADA y la compra de una sola cuota (CM2) queda CANCELADA', async () => {
      const cm2 = await db.compra.findFirstOrThrow({ where: { clienteId: BigInt(ids.mario), nCuotas: 1, capitalInicial: '50.00' } });
      expect(cm2.estado).toBe('CANCELADA');
      const cm1 = await db.compra.findFirstOrThrow({ where: { clienteId: BigInt(ids.mario), nCuotas: 3 } });
      expect(cm1.estado).toBe('VIGENTE');
      const cuotas = await db.cuota.findMany({ where: { compraId: cm1.id }, orderBy: { numero: 'asc' } });
      expect(cuotas.map((c) => c.estado)).toEqual(['PAGADA', 'PAGADA', 'PENDIENTE']);
    });

    it('Rosa paga CR1 cuota 1 el 06/11: mora 0.16, total 47.11, crédito 910.20', async () => {
      const prev = await api().get(`/api/estados-cuenta/${estados.rosa1}/calculo-pago?fechaPagoReal=2026-11-06`).set(auth('ltorres')).expect(200);
      expect(prev.body).toMatchObject({ diasMora: 10, tasaMoraPeriodoPct: '0.3305890', interesesMora: '0.16', totalPagar: '47.11' });
      await pagar(estados.rosa1, 47.11, '2026-11-06', 'PLIN').expect(201);
      expect((await credito('rosa')).creditoDisponible).toBe('910.20');
    });

    it('Carlos paga CC1 cuota 1 puntual el 05/12: sin mora, total 67.16, crédito 734.85', async () => {
      const r = await pagar(estados.carlos1, 67.16, '2026-12-05', 'TRANSFERENCIA').expect(201);
      expect(r.body.pago).toMatchObject({ diasMora: 0, montoMora: '0', montoTotal: '67.16' });
      expect(r.body.items.some((i: any) => i.tipo === 'MORA')).toBe(false);
      expect((await credito('carlos')).creditoDisponible).toBe('734.85');
    });
  });

  describe('tarea diaria', () => {
    it('genera los estados del último corte (≤ ayer) de quienes tienen cuotas pendientes, y es idempotente', async () => {
      const svc = app.get(EstadosCuentaService);
      // "Hoy" = 21/11/2026 → ayer 20/11: corte de Rosa y Mario; Carlos (corte 25) aún no tiene cuotas en ciclo.
      const r = await svc.generarVencidos({ y: 2026, m: 11, d: 21 });
      expect(r.generados).toBeGreaterThanOrEqual(2);

      const mario = await db.estadoCuenta.findFirstOrThrow({
        where: { clienteId: BigInt(ids.mario), fechaCorte: new Date('2026-11-20T00:00:00Z') },
        include: { items: { orderBy: { id: 'asc' } } },
      });
      // CM1 cuota 3 (35.78), CM3 cuota 2 (45.41) y CM4 cuota 1 (30.43), por orden de compra.
      expect(mario.total.toString()).toBe('111.62');
      expect(mario.fechaPago.toISOString().slice(0, 10)).toBe('2026-11-26');
      expect(mario.items.map((i) => i.subtotal.toString())).toEqual(['35.78', '45.41', '30.43']);
      const rosa = await db.estadoCuenta.findFirstOrThrow({
        where: { clienteId: BigInt(ids.rosa), fechaCorte: new Date('2026-11-20T00:00:00Z') },
      });
      expect(rosa.total.toString()).toBe('46.95');
      estados.rosa2 = rosa.id.toString();
      expect(await db.estadoCuenta.count({ where: { clienteId: BigInt(ids.carlos), fechaCorte: new Date('2026-11-20T00:00:00Z') } })).toBe(0);

      const otra = await svc.generarVencidos({ y: 2026, m: 11, d: 21 });
      expect(otra.generados).toBe(0);
    });

    it('un administrador de negocio no puede lanzar la tarea; el del sistema sí', async () => {
      await api().post('/api/estados-cuenta/tarea/ejecutar').set(auth('ltorres')).expect(403);
      await api().post('/api/estados-cuenta/tarea/ejecutar').set(auth('admin')).expect(200);
    });

    it('dos pagos simultáneos del mismo estado: solo uno se acepta', async () => {
      const rs = await Promise.all([pagar(estados.rosa2, 46.95, '2026-11-26'), pagar(estados.rosa2, 46.95, '2026-11-26')]);
      expect(rs.map((r) => r.status).sort()).toEqual([201, 409]);
      expect(await db.pago.count({ where: { estadoCuentaId: BigInt(estados.rosa2) } })).toBe(1);
    });
  });

  describe('permisos y aislamiento', () => {
    it('el cliente ve sus estados y no los de otro; no puede pagar ni generar', async () => {
      const lista = await api().get('/api/estados-cuenta').set(auth('rosa')).expect(200);
      expect(lista.body.length).toBeGreaterThan(0);
      expect(lista.body.every((e: any) => e.clienteId === ids.rosa)).toBe(true);
      await api().get(`/api/estados-cuenta/${estados.rosa1}`).set(auth('rosa')).expect(200);
      await api().get(`/api/estados-cuenta/${estados.carlos1}`).set(auth('rosa')).expect(404);
      await api().get(`/api/estados-cuenta/${estados.carlos1}/calculo-pago`).set(auth('rosa')).expect(404);
      await api().post(`/api/estados-cuenta/${estados.rosa1}/pagos`).set(auth('rosa')).send({ montoPagado: 1, medioPago: 'EFECTIVO' }).expect(403);
      await api().post('/api/estados-cuenta/generar').set(auth('rosa')).send({ clienteId: ids.rosa, fechaCorte: '2026-10-20' }).expect(403);
    });

    it('filtra por estado y por cliente (administrador)', async () => {
      const pend = await api().get(`/api/estados-cuenta?estado=PENDIENTE&clienteId=${ids.mario}`).set(auth('ltorres')).expect(200);
      expect(pend.body.length).toBe(1);
      expect(pend.body[0].estado).toBe('PENDIENTE');
      const pagados = await api().get(`/api/estados-cuenta?estado=PAGADO&clienteId=${ids.mario}`).set(auth('ltorres')).expect(200);
      expect(pagados.body.length).toBe(2);
    });
  });
});
