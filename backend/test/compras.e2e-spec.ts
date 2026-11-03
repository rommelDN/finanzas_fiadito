import { INestApplication } from '@nestjs/common';
import { CR1, cuerpoCompra, db, fijarLimites, idsClientes, iniciarApp, limpiarCompras } from './helpers';

// Requiere MySQL con el seed aplicado. Usa los datos de la sección 8 del contexto
// (para reproducirlos exactos se suben temporalmente los límites a 1000/800/600).
describe('Compras al crédito (e2e)', () => {
  let app: INestApplication;
  let t: Awaited<ReturnType<typeof iniciarApp>>;
  let ids: Awaited<ReturnType<typeof idsClientes>>;
  const api = () => t.api();
  const auth = (u: string) => t.auth(u);
  const simular = (b: object) => api().post('/api/compras/simular').set(auth('ltorres')).send(b);
  const registrar = (b: object) => api().post('/api/compras').set(auth('ltorres')).send(b);
  const cr1 = () => cuerpoCompra(ids.rosa, '2026-09-15T10:30', CR1, 3);

  beforeAll(async () => {
    t = await iniciarApp();
    app = t.app;
    await t.login('admin', 'ltorres');
    ids = await idsClientes();
    await limpiarCompras();
    await fijarLimites('seccion8');
  });

  afterAll(async () => {
    await limpiarCompras();
    await fijarLimites('seed');
    await app.close();
    await db.$disconnect();
  });

  it('simula CR1 con los valores de la sección 8 sin guardar nada', async () => {
    const r = await simular(cr1()).expect(200);
    expect(r.body).toMatchObject({ valido: true, errores: [], maxCuotasPermitidas: 8, creditoDisponibleAntes: '1000.00' });
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
    expect(JSON.stringify(r.body)).not.toMatch(/moneda|TCEA/i);
    expect(await db.compra.count({ where: { clienteId: BigInt(ids.rosa) } })).toBe(0);
  });

  it('registra CR1: guarda cabecera, detalle y las 3 cuotas del cronograma', async () => {
    const r = await registrar(cr1()).expect(201);
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
    const b = cuerpoCompra(ids.carlos, '2026-09-27T14:00', [['P007', 1], ['P001', 2], ['P002', 1], ['P004', 4]], 2);
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
      const b = cuerpoCompra(ids.mario, fecha, items, n);
      const sim = await simular(b).expect(200);
      expect(sim.body.calculo).toMatchObject({ capitalFinanciado: cg, creditoDisponibleDespues: despues });
      await registrar(b).expect(201);
    }
    const lista = await api().get(`/api/compras?clienteId=${ids.mario}`).set(auth('ltorres')).expect(200);
    expect(lista.body).toHaveLength(4);
    expect(lista.body[0].fechaHora.slice(0, 10)).toBe('2026-09-24'); // más reciente primero
  });

  it('cambio de ciclo: 20/09 23:59 entra al corte del 20/09; 21/09 00:00 pasa al 20/10', async () => {
    const a = await simular(cuerpoCompra(ids.rosa, '2026-09-20T23:59', [['P001', 1]], 1)).expect(200);
    const b = await simular(cuerpoCompra(ids.rosa, '2026-09-21T00:00', [['P001', 1]], 1)).expect(200);
    expect(a.body.calculo.fechaCorteCiclo).toBe('2026-09-20');
    expect(b.body.calculo.fechaCorteCiclo).toBe('2026-10-20');
  });

  it('el período de las cuotas cambia la tasa efectiva y los vencimientos (TEQ y TES)', async () => {
    const mensual = (await simular(cr1()).expect(200)).body.calculo;
    const q = (await simular({ ...cr1(), periodoCuota: 'QUINCENAL' }).expect(200)).body;
    expect(q.periodoCuota).toBe('QUINCENAL');
    expect(q.calculo.cuotas).toHaveLength(3);
    // Rosa: 6.1363551 % bimestral → TEQ = (1+i)^(15/60) − 1
    expect(Number(q.calculo.temPct)).toBeCloseTo((Math.pow(1.061363551, 15 / 60) - 1) * 100, 5);
    expect(Number(q.calculo.temPct)).toBeLessThan(Number(mensual.temPct));
    expect(q.calculo.cuotas[1].fechaVencimiento.slice(0, 10) > q.calculo.cuotas[0].fechaVencimiento.slice(0, 10)).toBe(true);
    const s = (await simular({ ...cr1(), periodoCuota: 'SEMESTRAL' }).expect(200)).body;
    expect(Number(s.calculo.temPct)).toBeCloseTo((Math.pow(1.061363551, 180 / 60) - 1) * 100, 5);
    await simular({ ...cr1(), periodoCuota: 'SEMANAL' }).expect(400);
  });

  describe('rechazos', () => {
    const errores = (r: any) => JSON.stringify(r.body.message ?? r.body.errores);

    it('P007 en 3 cuotas: máximo 2', async () => {
      const r = await registrar(cuerpoCompra(ids.rosa, '2026-09-15T10:30', [['P007', 1]], 3)).expect(400);
      expect(errores(r)).toMatch(/entre 1 y 2/);
    });

    it('P008 (no permite crédito), P009 (inactivo) y producto inexistente', async () => {
      expect(errores(await registrar(cuerpoCompra(ids.rosa, '2026-09-15T10:30', [['P008', 1]], 1)).expect(400))).toMatch(/no se vende al crédito/);
      expect(errores(await registrar(cuerpoCompra(ids.rosa, '2026-09-15T10:30', [['P009', 1]], 1)).expect(400))).toMatch(/inactivo/);
      expect(errores(await registrar(cuerpoCompra(ids.rosa, '2026-09-15T10:30', [['NOEXISTE', 1]], 1)).expect(400))).toMatch(/no existe/);
    });

    it('más de 8 cuotas se rechaza (tope general)', async () => {
      await registrar(cuerpoCompra(ids.carlos, '2026-09-15T10:30', [['P001', 1]], 9)).expect(400);
    });

    it('crédito insuficiente: Cg 132.74 > disponible 132.00; con límite justo 132.74 sí se acepta', async () => {
      await limpiarCompras();
      await db.cliente.update({ where: { id: BigInt(ids.rosa) }, data: { limiteCredito: '132.00' } });
      try {
        const r = await registrar(cr1()).expect(400);
        expect(errores(r)).toMatch(/excede el crédito disponible \(132\.00\)/);
        await db.cliente.update({ where: { id: BigInt(ids.rosa) }, data: { limiteCredito: '132.74' } });
        const ok = await registrar(cr1()).expect(201);
        expect(ok.body.capitalFinanciado).toBe('132.74');
      } finally {
        await db.cliente.update({ where: { id: BigInt(ids.rosa) }, data: { limiteCredito: '1000.00' } });
        await limpiarCompras();
      }
    });

    it('cliente inactivo, tienda dada de baja y datos mal formados', async () => {
      await db.cliente.update({ where: { id: BigInt(ids.rosa) }, data: { estado: 'INACTIVO' } });
      try {
        expect(errores(await registrar(cr1()).expect(400))).toMatch(/cliente está inactivo/);
      } finally {
        await db.cliente.update({ where: { id: BigInt(ids.rosa) }, data: { estado: 'ACTIVO' } });
      }
      const tienda = await db.tienda.findFirstOrThrow({ where: { ruc: '20100000001' } });
      await db.tienda.update({ where: { id: tienda.id }, data: { estado: 'INACTIVA' } });
      try {
        expect(errores(await registrar(cr1()).expect(400))).toMatch(/tienda está dada de baja/);
      } finally {
        await db.tienda.update({ where: { id: tienda.id }, data: { estado: 'ACTIVA' } });
      }
      await registrar({ ...cr1(), items: [] }).expect(400);
      await registrar({ ...cr1(), nCuotas: 0 }).expect(400);
      await registrar({ ...cr1(), fechaHora: '2026-02-31T10:00' }).expect(400);
      await registrar({ ...cr1(), clienteId: '999999' }).expect(404);
      expect(await db.compra.count({ where: { clienteId: BigInt(ids.rosa) } })).toBe(0);
    });
  });

  it('dos compras simultáneas no pueden superar juntas el límite del cliente', async () => {
    await limpiarCompras();
    const b = cuerpoCompra(ids.mario, '2026-09-03T18:00', [['P007', 7]], 2); // ~S/ 360 cada una, límite 600
    const rs = await Promise.all([registrar(b), registrar(b)]);
    expect(rs.map((r) => r.status).sort()).toEqual([201, 400]);
    const cred = await api().get(`/api/compras/credito?clienteId=${ids.mario}`).set(auth('ltorres')).expect(200);
    expect(Number(cred.body.deudaPendiente)).toBeLessThanOrEqual(600);
    await limpiarCompras();
  });

  describe('permisos y aislamiento', () => {
    it('solo el administrador del negocio opera compras; el del sistema no', async () => {
      await api().post('/api/compras').set(auth('admin')).send(cr1()).expect(403);
      await api().post('/api/compras/simular').set(auth('admin')).send(cr1()).expect(403);
      await api().get('/api/compras').set(auth('admin')).expect(403);
      await api().get('/api/compras').expect(401);
    });

    it('la simulación no deja bitácora; el registro sí', async () => {
      const antes = await db.bitacora.count({ where: { entidad: 'compras' } });
      await simular(cr1()).expect(200);
      expect(await db.bitacora.count({ where: { entidad: 'compras' } })).toBe(antes);
      await registrar(cuerpoCompra(ids.rosa, '2026-09-16T10:00', [['P003', 1]], 1)).expect(201);
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
