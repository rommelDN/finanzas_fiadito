import { INestApplication } from '@nestjs/common';
import { EstadosCuentaService } from '../src/estados-cuenta/estados-cuenta.service';
import { CR1, cuerpoCompra, db, fijarLimites, idsClientes, iniciarApp, limpiarCompras } from './helpers';

// Requiere MySQL con el seed aplicado. Reproduce los estados de cuenta de la sección 8.
describe('Estados de cuenta (e2e)', () => {
  let app: INestApplication;
  let t: Awaited<ReturnType<typeof iniciarApp>>;
  let ids: Awaited<ReturnType<typeof idsClientes>>;
  const api = () => t.api();
  const auth = (u: string) => t.auth(u);
  const estados: Record<string, string> = {};

  const compra = (c: 'rosa' | 'carlos' | 'mario', fechaHora: string, items: [string, number][], n: number) =>
    api().post('/api/compras').set(auth('ltorres')).send(cuerpoCompra(ids[c], fechaHora, items, n)).expect(201);
  const generar = (c: 'rosa' | 'carlos' | 'mario', fechaCorte: string) =>
    api().post('/api/estados-cuenta/generar').set(auth('ltorres')).send({ clienteId: ids[c], fechaCorte });

  beforeAll(async () => {
    t = await iniciarApp();
    app = t.app;
    await t.login('admin', 'ltorres');
    ids = await idsClientes();
    await limpiarCompras();
    await fijarLimites('seccion8');
    await compra('rosa', '2026-09-15T10:30', CR1, 3);
    await compra('carlos', '2026-09-27T14:00', [['P007', 1], ['P001', 2], ['P002', 1], ['P004', 4]], 2);
    await compra('mario', '2026-08-10T09:00', [['P001', 2], ['P002', 2], ['P004', 4], ['P006', 1]], 3);
    await compra('mario', '2026-09-03T18:00', [['P007', 1]], 1);
    await compra('mario', '2026-09-15T11:00', [['P003', 12], ['P005', 5], ['P002', 2]], 2);
    await compra('mario', '2026-09-24T16:00', [['P001', 1], ['P005', 2]], 1);
  });

  afterAll(async () => {
    await limpiarCompras();
    await fijarLimites('seed');
    await app.close();
    await db.$disconnect();
  });

  describe('generación', () => {
    it('Mario, corte 20/09: solo la cuota 1 de CM1 vence en el ciclo (35.77)', async () => {
      const r = await generar('mario', '2026-09-20').expect(201);
      estados.mario1 = r.body.id;
      expect(r.body).toMatchObject({ totalCapital: '32.69', totalInteresesCuotas: '3.08', total: '35.77', estado: 'PENDIENTE' });
      expect(r.body.fechaPago.slice(0, 10)).toBe('2026-09-26');
      expect(r.body.items).toHaveLength(1);
      expect(r.body.items[0]).toMatchObject({ tipo: 'CUOTA', capital: '32.69', interes: '3.08', subtotal: '35.77' });
      expect(r.body.cuotas).toHaveLength(1);
    });

    it('es idempotente: regenerar el mismo corte devuelve el mismo estado', async () => {
      const r = await generar('mario', '2026-09-20').expect(201);
      expect(r.body.id).toBe(estados.mario1);
      expect(await db.estadoCuenta.count({ where: { clienteId: BigInt(ids.mario) } })).toBe(1);
    });

    it('rechaza fechas que no son corte del cliente y ciclos sin cuotas por cobrar', async () => {
      await generar('mario', '2026-09-21').expect(400);
      await generar('mario', '2026-02-31').expect(400);
      await generar('mario', '2026-08-20').expect(404); // la primera cuota de CM1 vence recién el 26/09
      await api().post('/api/estados-cuenta/generar').set(auth('ltorres')).send({ clienteId: '99999999', fechaCorte: '2026-09-20' }).expect(404);
    });

    it('Mario, corte 20/10: cuotas ordenadas por compra, CM4 no entra (vence 26/11)', async () => {
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
      expect(rosa.body.total).toBe('46.95');
      expect(rosa.body.fechaPago.slice(0, 10)).toBe('2026-10-26');
      const carlos = await generar('carlos', '2026-11-25').expect(201); // corte 25, pago el 5 del mes siguiente
      expect(carlos.body.total).toBe('67.16');
      expect(carlos.body.fechaPago.slice(0, 10)).toBe('2026-12-05');
    });

    it('el detalle muestra la mora acumulada a hoy como ítem aparte (no se cobra hasta pagar)', async () => {
      const r = await api().get(`/api/estados-cuenta/${estados.mario2}`).set(auth('ltorres')).expect(200);
      expect(r.body.moraHoy).toHaveProperty('total');
      const hoy = new Date(Date.now() - 5 * 3_600_000).toISOString().slice(0, 10);
      if (hoy > '2026-10-26') {
        expect(r.body.moraHoy.cuotas).toHaveLength(3);
        expect(Number(r.body.moraHoy.total)).toBeGreaterThan(0);
      }
      // No hay endpoint de pago en el estado de cuenta: se paga desde el cronograma.
      await api().post(`/api/estados-cuenta/${estados.mario2}/pagos`).set(auth('ltorres')).send({ montoPagado: 1, medioPago: 'EFECTIVO' }).expect(404);
    });
  });

  describe('tarea diaria', () => {
    it('genera los estados del último corte (≤ ayer) de quienes tienen cuotas pendientes, y es idempotente', async () => {
      const svc = app.get(EstadosCuentaService);
      // "Hoy" = 21/11/2026 → ayer 20/11: corte de Rosa y Mario; Carlos (corte 25) aún no tiene cuotas en ciclo.
      const r = await svc.generarVencidos({ y: 2026, m: 11, d: 21 });
      expect(r.generados).toBeGreaterThanOrEqual(2);

      const corte = new Date('2026-11-20T00:00:00Z');
      const mario = await db.estadoCuenta.findFirstOrThrow({
        where: { clienteId: BigInt(ids.mario), fechaCorte: corte },
        include: { items: { orderBy: { id: 'asc' } } },
      });
      // CM1 cuota 3 (35.78), CM3 cuota 2 (45.41) y CM4 cuota 1 (30.43), por orden de compra.
      expect(mario.total.toString()).toBe('111.62');
      expect(mario.fechaPago.toISOString().slice(0, 10)).toBe('2026-11-26');
      expect(mario.items.map((i) => i.subtotal.toString())).toEqual(['35.78', '45.41', '30.43']);
      const rosa = await db.estadoCuenta.findFirstOrThrow({ where: { clienteId: BigInt(ids.rosa), fechaCorte: corte } });
      expect(rosa.total.toString()).toBe('46.95');
      expect(await db.estadoCuenta.count({ where: { clienteId: BigInt(ids.carlos), fechaCorte: corte } })).toBe(0);

      expect((await svc.generarVencidos({ y: 2026, m: 11, d: 21 })).generados).toBe(0);
    });

    it('un administrador de negocio no puede lanzar la tarea; el del sistema sí', async () => {
      await api().post('/api/estados-cuenta/tarea/ejecutar').set(auth('ltorres')).expect(403);
      await api().post('/api/estados-cuenta/tarea/ejecutar').set(auth('admin')).expect(200);
    });
  });

  it('solo el administrador del negocio ve los estados de cuenta, filtrados por estado y cliente', async () => {
    await api().get('/api/estados-cuenta').set(auth('admin')).expect(403);
    const mario = await api().get(`/api/estados-cuenta?clienteId=${ids.mario}`).set(auth('ltorres')).expect(200);
    expect(mario.body.every((e: any) => e.clienteId === ids.mario)).toBe(true);
    const pend = await api().get('/api/estados-cuenta?estado=PENDIENTE').set(auth('ltorres')).expect(200);
    expect(pend.body.every((e: any) => e.estado === 'PENDIENTE')).toBe(true);
  });
});
