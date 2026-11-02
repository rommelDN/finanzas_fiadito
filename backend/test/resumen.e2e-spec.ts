import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configurarApp } from '../src/setup';

// Requiere MySQL con el seed aplicado.
const PASS = process.env.SEED_PASSWORD ?? 'Fiadito2026!';

describe('Resumen del inicio (e2e)', () => {
  let app: INestApplication;
  const db = new PrismaClient();
  const api = () => request(app.getHttpServer());
  const tokens: Record<string, string> = {};
  const auth = (u: string) => ({ Authorization: `Bearer ${tokens[u]}` });
  let rosaId: string;

  async function limpiar() {
    const compras = await db.compra.findMany({ where: { cliente: { dni: { in: ['40000001', '40000002', '40000003'] } } }, select: { id: true } });
    const compraId = { in: compras.map((c) => c.id) };
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
    rosaId = (await db.cliente.findFirstOrThrow({ where: { dni: '40000001' } })).id.toString();
    await limpiar();
  });

  afterAll(async () => {
    await limpiar();
    await app.close();
    await db.$disconnect();
  });

  it('sin compras: deuda 0, todo el límite disponible y sin vencimientos', async () => {
    const r = await api().get('/api/resumen').set(auth('ltorres')).expect(200);
    expect(r.body.totales).toMatchObject({ clientes: 3, limiteCredito: '2400.00', deudaPendiente: '0.00', creditoDisponible: '2400.00' });
    expect(r.body.proximoVencimiento).toBeNull();
    expect(r.body.enMora).toMatchObject({ clientes: 0, cuotas: 0, monto: '0.00' });
  });

  it('con CR1 (cuotas en 2026) todas vencidas hoy: deuda, mora y compras recientes', async () => {
    await api().post('/api/compras').set(auth('ltorres')).send({
      clienteId: rosaId, fechaHora: '2026-09-15T10:30', nCuotas: 3,
      items: [['P001', 2], ['P002', 2], ['P003', 6], ['P004', 4], ['P005', 2], ['P006', 1]].map(([codigoProducto, cantidad]) => ({ codigoProducto, cantidad })),
    }).expect(201);

    const r = await api().get('/api/resumen').set(auth('ltorres')).expect(200);
    expect(r.body.totales).toMatchObject({ deudaPendiente: '132.74', creditoDisponible: '2267.26' });
    const rosa = r.body.clientes.find((c: any) => c.id === rosaId);
    expect(rosa).toMatchObject({ deudaPendiente: '132.74', creditoDisponible: '867.26' });
    expect(r.body.comprasRecientes).toHaveLength(1);

    // Las cuotas vencidas se separan de las que están por vencer, según la fecha de hoy.
    const total = r.body.cuotasVencidas.length + r.body.proximosVencimientos.length;
    expect(total).toBe(3);
    expect(r.body.enMora.cuotas).toBe(r.body.cuotasVencidas.length);
    expect(rosa.enMora).toBe(r.body.enMora.cuotas > 0);
  });

  it('el cliente solo ve su propia situación', async () => {
    const r = await api().get('/api/resumen').set(auth('rosa')).expect(200);
    expect(r.body.totales).toMatchObject({ clientes: 1, limiteCredito: '1000.00', deudaPendiente: '132.74' });
    expect(r.body.clientes.every((c: any) => c.id === rosaId)).toBe(true);
    const otro = await api().get('/api/resumen').set(auth('carlos')).expect(200);
    expect(otro.body.totales).toMatchObject({ clientes: 1, deudaPendiente: '0.00' });
  });

  it('el administrador del sistema no tiene resumen de tienda', async () => {
    await api().get('/api/resumen').set(auth('admin')).expect(403);
    await api().get('/api/resumen').expect(401);
  });
});
