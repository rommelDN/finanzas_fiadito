import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configurarApp } from '../src/setup';

// Requiere MySQL con el seed aplicado. Usa los datos de la sección 8 del contexto.
const PASS = process.env.SEED_PASSWORD ?? 'Fiadito2026!';
const DNIS = { rosa: '40000001', carlos: '40000002', mario: '40000003' };

describe('Etapa 5: compras al crédito (e2e)', () => {
  let app: INestApplication;
  const db = new PrismaClient();
  const api = () => request(app.getHttpServer());
  const tokens: Record<string, string> = {};
  const auth = (u: string) => ({ Authorization: `Bearer ${tokens[u]}` });
  const ids: Record<string, string> = {};

  const body = (c: 'rosa' | 'carlos' | 'mario', fechaHora: string, items: [string, number][], nCuotas: number) => ({
    clienteId: ids[c],
    fechaHora,
    nCuotas,
    items: items.map(([codigoProducto, cantidad]) => ({ codigoProducto, cantidad })),
  });
  const simular = (b: object) => api().post('/api/compras/simular').set(auth('ltorres')).send(b);
  const registrar = (b: object) => api().post('/api/compras').set(auth('ltorres')).send(b);

  const CR1 = () =>
    body('rosa', '2026-09-15T10:30', [['P001', 2], ['P002', 2], ['P003', 6], ['P004', 4], ['P005', 2], ['P006', 1]], 3);

  async function limpiarCompras() {
    const clientes = await db.cliente.findMany({ where: { dni: { in: Object.values(DNIS) } }, select: { id: true } });
    const where = { clienteId: { in: clientes.map((c) => c.id) } };
    const compras = await db.compra.findMany({ where, select: { id: true } });
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
    for (const [k, dni] of Object.entries(DNIS)) {
      ids[k] = (await db.cliente.findFirstOrThrow({ where: { dni } })).id.toString();
    }
    await limpiarCompras();
  });

  afterAll(async () => {
    await limpiarCompras();
    await app.close();
    await db.$disconnect();
  });

  it('simula CR1 con los valores de la sección 8 sin guardar nada', async () => {
    const r = await simular(CR1()).expect(200);
    expect(r.body).toMatchObject({ valido: true, errores: [], maxCuotasPermitidas: 6, creditoDisponibleAntes: '1000.00' });
    expect(r.body.calculo).toMatchObject({
      capitalInicial: '131.30',
      fechaCorteCiclo: '2026-09-20',
      fechaFinGracia: '2026-09-26',
      diasGracia: 11,
      interesGracia: '1.44',
      capitalFinanciado: '132.74',
      cuotaRegular: '46.95',
      totalIntereses: '9.54',
      totalProgramado: '140.84',
      creditoDisponibleDespues: '867.26',
    });
    expect(Number(r.body.calculo.tasaGracia)).toBeCloseTo(0.0109781382, 9);
    expect(Number(r.body.calculo.teaPct)).toBeCloseTo(42.9502815, 6);
    expect(await db.compra.count({ where: { clienteId: BigInt(ids.rosa) } })).toBe(0);
  });

  it('registra CR1: guarda cabecera, detalle y las 3 cuotas del cronograma', async () => {
    const r = await registrar(CR1()).expect(201);
    expect(r.body).toMatchObject({ capitalInicial: '131.3', capitalFinanciado: '132.74', cuotaRegular: '46.95', nCuotas: 3, estado: 'VIGENTE' });
    expect(r.body.detalles).toHaveLength(6);
    const p001 = r.body.detalles.find((d: any) => d.producto.codigo === 'P001');
    expect(p001).toMatchObject({ cantidad: '2', precioUnitarioAplicado: '22', subtotal: '44' });
    expect(r.body.cuotas.map((c: any) => [c.fechaVencimiento.slice(0, 10), c.interes, c.amortizacion, c.montoCuota, c.saldoFinal])).toEqual([
      ['2026-10-26', '4.01', '42.94', '46.95', '89.8'],
      ['2026-11-26', '2.71', '44.24', '46.95', '45.56'],
      ['2026-12-26', '1.38', '45.56', '46.94', '0'],
    ]);
    const cred = await api().get(`/api/compras/credito?clienteId=${ids.rosa}`).set(auth('ltorres')).expect(200);
    expect(cred.body).toMatchObject({ limiteCredito: '1000.00', deudaPendiente: '132.74', creditoDisponible: '867.26' });
  });

  it('CC1 de Carlos pasa al ciclo siguiente por llegar después del corte', async () => {
    const b = body('carlos', '2026-09-27T14:00', [['P007', 1], ['P001', 2], ['P002', 1], ['P004', 4]], 2);
    const r = await registrar(b).expect(201);
    expect(r.body).toMatchObject({ capitalFinanciado: '128.35', cuotaRegular: '67.16', diasGracia: 38 });
    expect(r.body.fechaFinGracia.slice(0, 10)).toBe('2026-11-05');
    expect(r.body.cuotas.map((c: any) => c.fechaVencimiento.slice(0, 10))).toEqual(['2026-12-05', '2027-01-05']);
  });

  it('las compras de Mario (CM1-CM4) descuentan el crédito acumulado', async () => {
    const casos: [string, [string, number][], number, string, string][] = [
      ['2026-08-10T09:00', [['P001', 2], ['P002', 2], ['P004', 4], ['P006', 1]], 3, '101.10', '498.90'],
      ['2026-09-03T18:00', [['P007', 1]], 1, '51.16', '447.74'],
      ['2026-09-15T11:00', [['P003', 12], ['P005', 5], ['P002', 2]], 2, '86.85', '360.89'],
      ['2026-09-24T16:00', [['P001', 1], ['P005', 2]], 1, '29.53', '331.36'],
    ];
    for (const [fecha, items, n, cg, despues] of casos) {
      const b = body('mario', fecha, items, n);
      const sim = await simular(b).expect(200);
      expect(sim.body.calculo).toMatchObject({ capitalFinanciado: cg, creditoDisponibleDespues: despues });
      await registrar(b).expect(201);
    }
    const lista = await api().get(`/api/compras?clienteId=${ids.mario}`).set(auth('ltorres')).expect(200);
    expect(lista.body).toHaveLength(4);
    // Más reciente primero.
    expect(lista.body[0].fechaHora.slice(0, 10)).toBe('2026-09-24');
  });

  it('cambio de ciclo: 20/09 23:59 entra al corte del 20/09; 21/09 00:00 pasa al 20/10', async () => {
    const a = await simular(body('rosa', '2026-09-20T23:59', [['P001', 1]], 1)).expect(200);
    const b = await simular(body('rosa', '2026-09-21T00:00', [['P001', 1]], 1)).expect(200);
    expect(a.body.calculo.fechaCorteCiclo).toBe('2026-09-20');
    expect(b.body.calculo.fechaCorteCiclo).toBe('2026-10-20');
  });

  describe('rechazos', () => {
    const errores = (r: any) => JSON.stringify(r.body.message ?? r.body.errores);

    it('P007 en 3 cuotas: máximo 2', async () => {
      const r = await registrar(body('rosa', '2026-09-15T10:30', [['P007', 1]], 3)).expect(400);
      expect(errores(r)).toMatch(/entre 1 y 2/);
    });

    it('P008 (no permite crédito) y P009 (inactivo) y producto inexistente', async () => {
      expect(errores(await registrar(body('rosa', '2026-09-15T10:30', [['P008', 1]], 1)).expect(400))).toMatch(/no se vende al crédito/);
      expect(errores(await registrar(body('rosa', '2026-09-15T10:30', [['P009', 1]], 1)).expect(400))).toMatch(/inactivo/);
      expect(errores(await registrar(body('rosa', '2026-09-15T10:30', [['NOEXISTE', 1]], 1)).expect(400))).toMatch(/no existe/);
    });

    it('cuotas por encima del máximo del cliente (Carlos: 4)', async () => {
      const r = await registrar(body('carlos', '2026-09-15T10:30', [['P001', 1]], 5)).expect(400);
      expect(errores(r)).toMatch(/entre 1 y 4/);
    });

    it('crédito insuficiente: Cg 132.74 > disponible 132.00', async () => {
      await limpiarCompras();
      await db.cliente.update({ where: { id: BigInt(ids.rosa) }, data: { limiteCredito: '132.00' } });
      try {
        const r = await registrar(CR1()).expect(400);
        expect(errores(r)).toMatch(/excede el crédito disponible \(132\.00\)/);
        // Con límite justo 132.74 sí se acepta (Cg ≤ disponible).
        await db.cliente.update({ where: { id: BigInt(ids.rosa) }, data: { limiteCredito: '132.74' } });
        const ok = await registrar(CR1()).expect(201);
        expect(ok.body.capitalFinanciado).toBe('132.74');
      } finally {
        await db.cliente.update({ where: { id: BigInt(ids.rosa) }, data: { limiteCredito: '1000.00' } });
        await limpiarCompras();
      }
    });

    it('cliente inactivo, tienda dada de baja y datos mal formados', async () => {
      await db.cliente.update({ where: { id: BigInt(ids.rosa) }, data: { estado: 'INACTIVO' } });
      try {
        expect(errores(await registrar(CR1()).expect(400))).toMatch(/cliente está inactivo/);
      } finally {
        await db.cliente.update({ where: { id: BigInt(ids.rosa) }, data: { estado: 'ACTIVO' } });
      }
      const tienda = await db.tienda.findFirstOrThrow({ where: { ruc: '20100000001' } });
      await db.tienda.update({ where: { id: tienda.id }, data: { estado: 'INACTIVA' } });
      try {
        expect(errores(await registrar(CR1()).expect(400))).toMatch(/tienda está dada de baja/);
      } finally {
        await db.tienda.update({ where: { id: tienda.id }, data: { estado: 'ACTIVA' } });
      }
      await registrar({ ...CR1(), items: [] }).expect(400);
      await registrar({ ...CR1(), nCuotas: 0 }).expect(400);
      await registrar({ ...CR1(), fechaHora: '2026-02-31T10:00' }).expect(400);
      await registrar({ ...CR1(), clienteId: '999999' }).expect(404);
      expect(await db.compra.count({ where: { clienteId: BigInt(ids.rosa) } })).toBe(0);
    });
  });

  it('dos compras simultáneas no pueden superar juntas el límite del cliente', async () => {
    await limpiarCompras();
    const b = body('mario', '2026-09-03T18:00', [['P007', 7]], 2); // ~S/ 360 cada una, límite 600
    const rs = await Promise.all([registrar(b), registrar(b)]);
    expect(rs.map((r) => r.status).sort()).toEqual([201, 400]);
    const cred = await api().get(`/api/compras/credito?clienteId=${ids.mario}`).set(auth('ltorres')).expect(200);
    expect(Number(cred.body.deudaPendiente)).toBeLessThanOrEqual(600);
    await limpiarCompras();
  });

  it('el crédito disponible solo se libera con amortizaciones pagadas', async () => {
    const r = await registrar(CR1()).expect(201);
    await db.cuota.updateMany({ where: { compraId: BigInt(r.body.id), numero: 1 }, data: { estado: 'PAGADA' } });
    const cred = await api().get(`/api/compras/credito?clienteId=${ids.rosa}`).set(auth('ltorres')).expect(200);
    // 132.74 − 42.94 = 89.80 de deuda; disponible 910.20 (dato de la sección 8).
    expect(cred.body).toMatchObject({ deudaPendiente: '89.80', creditoDisponible: '910.20' });
  });

  describe('permisos y aislamiento', () => {
    it('el cliente ve solo sus compras y su crédito; no puede registrar ni simular', async () => {
      const lista = await api().get('/api/compras').set(auth('rosa')).expect(200);
      expect(lista.body.length).toBeGreaterThan(0);
      expect(lista.body.every((c: any) => c.clienteId === ids.rosa)).toBe(true);
      const cred = await api().get('/api/compras/credito').set(auth('rosa')).expect(200);
      expect(cred.body.creditoDisponible).toBe('910.20');
      await registrar(CR1()).set(auth('rosa')).expect(403);
      await api().post('/api/compras/simular').set(auth('rosa')).send(CR1()).expect(403);
      await api().post('/api/compras').set(auth('admin')).send(CR1()).expect(403);
    });

    it('un cliente no ve la compra de otro, ni pidiendo su id', async () => {
      const carlos = await registrar(body('carlos', '2026-09-27T14:00', [['P001', 1]], 1)).expect(201);
      await api().get(`/api/compras/${carlos.body.id}`).set(auth('rosa')).expect(404);
      await api().get(`/api/compras/${carlos.body.id}`).set(auth('carlos')).expect(200);
      const filtrado = await api().get(`/api/compras?clienteId=${ids.carlos}`).set(auth('rosa')).expect(200);
      expect(filtrado.body.every((c: any) => c.clienteId === ids.rosa)).toBe(true);
    });

    it('la simulación no deja bitácora; el registro sí', async () => {
      const antes = await db.bitacora.count({ where: { entidad: 'compras' } });
      await simular(CR1()).expect(200);
      expect(await db.bitacora.count({ where: { entidad: 'compras' } })).toBe(antes);
      await registrar(body('rosa', '2026-09-16T10:00', [['P003', 1]], 1)).expect(201);
      // La bitácora se escribe sin bloquear la respuesta: esperar a que aparezca.
      let despues = antes;
      for (let i = 0; i < 20 && despues === antes; i++) {
        await new Promise((r) => setTimeout(r, 100));
        despues = await db.bitacora.count({ where: { entidad: 'compras' } });
      }
      expect(despues).toBe(antes + 1);
    });
  });
});
