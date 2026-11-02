import { INestApplication } from '@nestjs/common';
import { CR1, cuerpoCompra, db, fijarLimites, idsClientes, iniciarApp, limpiarCompras } from './helpers';

// Requiere MySQL con el seed aplicado (límites del seed: 250 + 200 + 150).
describe('Resumen del inicio (e2e)', () => {
  let app: INestApplication;
  let t: Awaited<ReturnType<typeof iniciarApp>>;
  let rosaId: string;
  const api = () => t.api();
  const auth = (u: string) => t.auth(u);

  beforeAll(async () => {
    t = await iniciarApp();
    app = t.app;
    await t.login('admin', 'ltorres');
    rosaId = (await idsClientes()).rosa;
    await limpiarCompras();
    await fijarLimites('seed');
  });

  afterAll(async () => {
    await limpiarCompras();
    await app.close();
    await db.$disconnect();
  });

  it('sin compras: deuda 0, todo el límite disponible (créditos pequeños) y sin vencimientos', async () => {
    const r = await api().get('/api/resumen').set(auth('ltorres')).expect(200);
    expect(r.body.totales).toMatchObject({ clientes: 3, limiteCredito: '600.00', deudaPendiente: '0.00', creditoDisponible: '600.00' });
    expect(r.body.proximoVencimiento).toBeNull();
    expect(r.body.enMora).toMatchObject({ clientes: 0, cuotas: 0, monto: '0.00' });
  });

  it('con CR1: deuda, crédito disponible por cliente, mora y compras recientes', async () => {
    await api().post('/api/compras').set(auth('ltorres')).send(cuerpoCompra(rosaId, '2026-09-15T10:30', CR1, 3)).expect(201);

    const r = await api().get('/api/resumen').set(auth('ltorres')).expect(200);
    expect(r.body.totales).toMatchObject({ deudaPendiente: '132.74', creditoDisponible: '467.26' });
    const rosa = r.body.clientes.find((c: any) => c.id === rosaId);
    expect(rosa).toMatchObject({ limiteCredito: '250.00', deudaPendiente: '132.74', creditoDisponible: '117.26' });
    expect(r.body.comprasRecientes).toHaveLength(1);

    // Las cuotas vencidas se separan de las que están por vencer, según la fecha de hoy.
    expect(r.body.cuotasVencidas.length + r.body.proximosVencimientos.length).toBe(3);
    expect(r.body.enMora.cuotas).toBe(r.body.cuotasVencidas.length);
    expect(rosa.enMora).toBe(r.body.enMora.cuotas > 0);
  });

  it('el pago de una cuota baja la deuda y la saca de la mora', async () => {
    const compra = await db.compra.findFirstOrThrow({ where: { clienteId: BigInt(rosaId) } });
    await api().post(`/api/cronograma/${compra.id}/pagar`).set(auth('ltorres'))
      .send({ numeroCuota: 1, medioPago: 'EFECTIVO', montoPagado: 46.95, diasMora: 0 }).expect(201);
    const r = await api().get('/api/resumen').set(auth('ltorres')).expect(200);
    expect(r.body.totales.deudaPendiente).toBe('89.80'); // 132.74 − 42.94
    expect(r.body.cuotasVencidas.length + r.body.proximosVencimientos.length).toBe(2);
  });

  it('solo el administrador del negocio tiene resumen de tienda', async () => {
    await api().get('/api/resumen').set(auth('admin')).expect(403);
    await api().get('/api/resumen').expect(401);
  });
});
