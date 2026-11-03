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

  it('simula CR1 (131.30, 3 cuotas, sin gracia) sin guardar nada', async () => {
    const r = await simular(cr1()).expect(200);
    expect(r.body).toMatchObject({ valido: true, errores: [], maxCuotasPermitidas: 8, creditoDisponibleAntes: '1000.00' });
    expect(r.body.calculo).toMatchObject({
      capitalInicial: '131.30',
      cuotasGracia: 0,
      interesGracia: '0.00',
      capitalFinanciado: '131.30',
      cuotaRegular: '46.44',
      totalIntereses: '8.01',
      totalProgramado: '139.31',
      creditoDisponibleDespues: '868.70',
    });
    expect(Number(r.body.calculo.teaPct)).toBeCloseTo(42.9502815, 6);
    expect(r.body.calculo.cuotas.map((c: any) => c.montoCuota)).toEqual(['46.44', '46.44', '46.43']);
    expect(JSON.stringify(r.body)).not.toMatch(/moneda|TCEA|diasGracia|fechaFinGracia/i);
    expect(await db.compra.count({ where: { clienteId: BigInt(ids.rosa) } })).toBe(0);
  });

  it('1 cuota de gracia: el interés se capitaliza y es el saldo inicial de la cuota siguiente', async () => {
    const r = await simular({ ...cr1(), cuotasGracia: 1 }).expect(200);
    expect(r.body.calculo).toMatchObject({ cuotasGracia: 1, interesGracia: '3.97', capitalFinanciado: '135.27', cuotaRegular: '70.72', totalIntereses: '10.13', totalProgramado: '141.43' });
    expect(r.body.calculo.cuotas.map((c: any) => [c.gracia, c.saldoInicial, c.interes, c.amortizacion, c.montoCuota, c.saldoFinal])).toEqual([
      [true, '131.30', '3.97', '0.00', '0.00', '135.27'],
      [false, '135.27', '4.09', '66.63', '70.72', '68.64'],
      [false, '68.64', '2.07', '68.64', '70.71', '0.00'],
    ]);
  });

  it('registra CR1 con 1 cuota de gracia: guarda cabecera, detalle y cuotas (la de gracia en estado GRACIA)', async () => {
    const r = await registrar({ ...cr1(), cuotasGracia: 1 }).expect(201);
    expect(r.body).toMatchObject({ capitalInicial: '131.3', capitalFinanciado: '135.27', cuotaRegular: '70.72', nCuotas: 3, cuotasGracia: 1, interesGracia: '3.97', estado: 'VIGENTE' });
    expect(r.body.detalles).toHaveLength(6);
    const p001 = r.body.detalles.find((d: any) => d.producto.codigo === 'P001');
    expect(p001).toMatchObject({ cantidad: '2', precioUnitarioAplicado: '22', subtotal: '44' });
    expect(r.body.cuotas.map((c: any) => [c.estado, c.fechaVencimiento.slice(0, 10), c.interes, c.amortizacion, c.montoCuota, c.saldoFinal])).toEqual([
      ['GRACIA', '2026-10-15', '3.97', '0', '0', '135.27'],
      ['PENDIENTE', '2026-11-15', '4.09', '66.63', '70.72', '68.64'],
      ['PENDIENTE', '2026-12-15', '2.07', '68.64', '70.71', '0'],
    ]);
    const cred = await api().get(`/api/compras/credito?clienteId=${ids.rosa}`).set(auth('ltorres')).expect(200);
    expect(cred.body).toMatchObject({ limiteCredito: '1000.00', deudaPendiente: '135.27', creditoDisponible: '864.73' });
  });

  it('las compras acumulan la deuda del cliente', async () => {
    const casos: [string, [string, number][], number, string][] = [
      ['2026-08-10T09:00', [['P001', 2], ['P002', 2], ['P004', 4], ['P006', 1]], 3, '99.50'],
      ['2026-09-03T18:00', [['P007', 1]], 1, '50.00'],
    ];
    let acumulado = 0;
    for (const [fecha, items, n, cg] of casos) {
      const b = cuerpoCompra(ids.mario, fecha, items, n);
      const sim = await simular(b).expect(200);
      expect(sim.body.calculo.capitalFinanciado).toBe(cg); // sin cuotas de gracia no se capitaliza nada
      acumulado += Number(sim.body.calculo.capitalFinanciado);
      await registrar(b).expect(201);
    }
    const lista = await api().get(`/api/compras?clienteId=${ids.mario}`).set(auth('ltorres')).expect(200);
    expect(lista.body).toHaveLength(2);
    expect(lista.body[0].fechaHora.slice(0, 10)).toBe('2026-09-03'); // más reciente primero
    const cred = await api().get(`/api/compras/credito?clienteId=${ids.mario}`).set(auth('ltorres')).expect(200);
    expect(Number(cred.body.deudaPendiente)).toBeCloseTo(acumulado, 2);
  });

  it('el período de las cuotas cambia la tasa efectiva y los vencimientos (TEQ y TES)', async () => {
    const mensual = (await simular(cr1()).expect(200)).body.calculo;
    const q = (await simular({ ...cr1(), periodoCuota: 'QUINCENAL' }).expect(200)).body;
    expect(q.periodoCuota).toBe('QUINCENAL');
    expect(q.calculo.cuotas).toHaveLength(3);
    // Rosa: 6.1363551 % bimestral → TEQ = (1+i)^(15/60) − 1
    expect(Number(q.calculo.temPct)).toBeCloseTo((Math.pow(1.061363551, 15 / 60) - 1) * 100, 5);
    expect(Number(q.calculo.temPct)).toBeLessThan(Number(mensual.temPct));
    expect(q.calculo.cuotas.map((c: any) => c.fechaVencimiento.slice(0, 10))).toEqual(['2026-09-30', '2026-10-15', '2026-10-30']);
    const s = (await simular({ ...cr1(), periodoCuota: 'SEMESTRAL' }).expect(200)).body;
    expect(Number(s.calculo.temPct)).toBeCloseTo((Math.pow(1.061363551, 180 / 60) - 1) * 100, 5);
    await simular({ ...cr1(), periodoCuota: 'SEMANAL' }).expect(400);
  });

  it('las cuotas de gracia no pueden superar 3 ni ser todas las cuotas', async () => {
    await simular({ ...cr1(), cuotasGracia: 4 }).expect(400);
    await simular({ ...cr1(), cuotasGracia: -1 }).expect(400);
    const r = await simular({ ...cr1(), cuotasGracia: 3 }).expect(200); // 3 de 3: no queda ninguna cuota que pagar
    expect(r.body.valido).toBe(false);
    expect(JSON.stringify(r.body.errores)).toMatch(/cuotas de gracia deben ser un entero entre 0 y 2/);
    await registrar({ ...cr1(), cuotasGracia: 3 }).expect(400);
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

    it('crédito insuficiente: Cg 131.30 > disponible 131.00; con límite justo 131.30 sí se acepta', async () => {
      await limpiarCompras();
      await db.cliente.update({ where: { id: BigInt(ids.rosa) }, data: { limiteCredito: '131.00' } });
      try {
        const r = await registrar(cr1()).expect(400);
        expect(errores(r)).toMatch(/excede el crédito disponible \(131\.00\)/);
        await db.cliente.update({ where: { id: BigInt(ids.rosa) }, data: { limiteCredito: '131.30' } });
        const ok = await registrar(cr1()).expect(201);
        expect(ok.body.capitalFinanciado).toBe('131.3');
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
