import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configurarApp } from '../src/setup';

// Requiere MySQL levantado y con el seed aplicado.
const PASS = process.env.SEED_PASSWORD ?? 'Fiadito2026!';
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

describe('Etapa 4: tiendas, productos, clientes y parámetros (e2e)', () => {
  let app: INestApplication;
  const db = new PrismaClient();
  const api = () => request(app.getHttpServer());
  const tokens: Record<string, string> = {};
  const auth = (u: string) => ({ Authorization: `Bearer ${tokens[u]}` });

  const creados = { rucs: ['20555555551'], dnis: ['70000001', '70000002'], usernames: ['tienda_e2e', 'cliente_e2e'] };
  const sufijo = Date.now().toString().slice(-6);
  const codigoProd = `T${sufijo}`;

  const clienteValido = (dni: string, extra: object = {}) => ({
    dni, nombres: 'Prueba', apellidos: 'E2E', moneda: 'PEN',
    tasaInteres: 6.1363551, periodoTasa: 'BIMESTRAL', tasaMora: 6.1208, periodoTasaMora: 'SEMESTRAL',
    limiteCredito: 500, maxCuotas: 4, diaCorte: 20, horaCorte: '23:59', diaPago: 26, aceptaPrivacidad: true,
    ...extra,
  });

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    configurarApp(app);
    await app.init();
    for (const u of ['admin', 'ltorres', 'rosa']) {
      tokens[u] = (await api().post('/api/auth/login').send({ username: u, password: PASS })).body.token;
    }
    await limpiar();
  });

  async function limpiar() {
    const usuarios = await db.usuario.findMany({ where: { username: { in: creados.usernames } }, select: { id: true } });
    const ids = usuarios.map((u) => u.id);
    await db.cliente.deleteMany({ where: { dni: { in: creados.dnis } } });
    await db.producto.deleteMany({ where: { codigo: { startsWith: 'T' }, descripcion: { startsWith: 'E2E' } } });
    await db.bitacora.deleteMany({ where: { usuarioId: { in: ids } } });
    await db.sesion.deleteMany({ where: { usuarioId: { in: ids } } });
    await db.usuario.deleteMany({ where: { id: { in: ids } } });
    await db.tienda.deleteMany({ where: { ruc: { in: creados.rucs } } });
    await db.parametro.deleteMany({ where: { vigenteDesde: new Date('2031-01-01T00:00:00Z') } });
    await db.parametro.updateMany({ where: { vigenteHasta: new Date('2030-12-31T00:00:00Z') }, data: { vigenteHasta: null } });
  }

  afterAll(async () => {
    await limpiar();
    await app.close();
    await db.$disconnect();
  });

  describe('tiendas', () => {
    const nueva = {
      ruc: '20555555551', razonSocial: 'Tienda E2E SAC', nombreComercial: 'E2E', giroNegocio: 'Panadería', direccion: 'Jr. Prueba 1',
      admin: { username: 'tienda_e2e', password: 'ClaveSegura1', nombre: 'Admin E2E' },
    };
    let id: string;

    it('solo ADMIN_SISTEMA puede dar de alta tiendas', async () => {
      await api().post('/api/tiendas').set(auth('ltorres')).send(nueva).expect(403);
      await api().get('/api/tiendas').set(auth('rosa')).expect(403);
    });

    it('alta de tienda crea su administrador, que puede iniciar sesión', async () => {
      const r = await api().post('/api/tiendas').set(auth('admin')).send(nueva).expect(201);
      id = r.body.id;
      expect(r.body.estado).toBe('ACTIVA');
      expect(r.body.usuarios[0]).toMatchObject({ username: 'tienda_e2e' });
      expect(JSON.stringify(r.body)).not.toMatch(/passwordHash|ClaveSegura1/);
      const login = await api().post('/api/auth/login').send({ username: 'tienda_e2e', password: 'ClaveSegura1' }).expect(200);
      tokens.tienda_e2e = login.body.token;
      expect(login.body.usuario).toMatchObject({ rol: 'ADMIN_NEGOCIO' });
    });

    it('rechaza RUC o usuario repetidos y datos inválidos', async () => {
      await api().post('/api/tiendas').set(auth('admin')).send(nueva).expect(409);
      await api().post('/api/tiendas').set(auth('admin')).send({ ...nueva, ruc: '123' }).expect(400);
      await api().post('/api/tiendas').set(auth('admin'))
        .send({ ...nueva, ruc: '20555555552', admin: { ...nueva.admin, password: 'corta' } }).expect(400);
    });

    it('el administrador de negocio edita los datos de su tienda pero no el RUC ni el estado', async () => {
      const r = await api().patch('/api/tiendas/mi').set(auth('tienda_e2e'))
        .send({ nombreComercial: 'E2E Renombrada', ruc: '20999999990', estado: 'INACTIVA' }).expect(200);
      expect(r.body).toMatchObject({ nombreComercial: 'E2E Renombrada', ruc: '20555555551', estado: 'ACTIVA' });
    });

    it('la baja es lógica: la tienda queda INACTIVA y se conserva', async () => {
      const r = await api().delete(`/api/tiendas/${id}`).set(auth('admin')).expect(200);
      expect(r.body.estado).toBe('INACTIVA');
      const otra = await api().get(`/api/tiendas/${id}`).set(auth('admin')).expect(200);
      expect(otra.body.ruc).toBe('20555555551');
      await api().get('/api/tiendas/999999').set(auth('admin')).expect(404);
      await api().get('/api/tiendas/abc').set(auth('admin')).expect(400);
    });
  });

  describe('productos', () => {
    const prod = {
      codigo: codigoProd, descripcion: 'E2E Galletas', unidadMedida: 'PAQ', precioContado: 3.5, precioCredito: 3.8, maxCuotasProducto: 3,
    };
    let id: string;

    it('el administrador de negocio crea un producto con valores por defecto', async () => {
      const r = await api().post('/api/productos').set(auth('ltorres')).send(prod).expect(201);
      id = r.body.id;
      expect(r.body).toMatchObject({ codigo: codigoProd, permiteCredito: true, estado: 'ACTIVO', monedaPrecio: 'PEN', precioContado: '3.5' });
    });

    it('rechaza código repetido, precio inválido y creación por cliente', async () => {
      await api().post('/api/productos').set(auth('ltorres')).send(prod).expect(409);
      await api().post('/api/productos').set(auth('ltorres')).send({ ...prod, codigo: 'X', precioContado: 0 }).expect(400);
      await api().post('/api/productos').set(auth('ltorres')).send({ ...prod, codigo: 'X', precioContado: 1.234 }).expect(400);
      await api().post('/api/productos').set(auth('rosa')).send({ ...prod, codigo: 'X' }).expect(403);
      await api().post('/api/productos').set(auth('admin')).send({ ...prod, codigo: 'X' }).expect(403);
    });

    it('actualiza parcialmente y no deja pisar el código de otro producto', async () => {
      const r = await api().patch(`/api/productos/${id}`).set(auth('ltorres')).send({ precioContado: 4.1 }).expect(200);
      expect(r.body.precioContado).toBe('4.1');
      await api().patch(`/api/productos/${id}`).set(auth('ltorres')).send({ codigo: 'P001' }).expect(409);
    });

    it('sube una imagen, la sirve y rechaza archivos que no son imagen', async () => {
      const r = await api().post(`/api/productos/${id}/imagen`).set(auth('ltorres'))
        .attach('imagen', PNG, { filename: 'a.png', contentType: 'image/png' }).expect(201);
      expect(r.body.imagenUrl).toMatch(/^\/uploads\/productos\/[0-9a-f]{24}\.png$/);
      await api().get(r.body.imagenUrl).expect(200);
      await api().post(`/api/productos/${id}/imagen`).set(auth('ltorres'))
        .attach('imagen', Buffer.from('hola'), { filename: 'a.txt', contentType: 'text/plain' }).expect(400);
      await api().post(`/api/productos/${id}/imagen`).set(auth('ltorres')).expect(400);
    });

    it('aislamiento: otra tienda no ve ni edita este producto', async () => {
      // Administrador de la tienda creada en el bloque anterior (distinta de Don Lucho).
      const ajeno = tokens.tienda_e2e;
      const lista = await api().get('/api/productos').set('Authorization', `Bearer ${ajeno}`).expect(200);
      expect(lista.body).toHaveLength(0);
      await api().get(`/api/productos/${id}`).set('Authorization', `Bearer ${ajeno}`).expect(404);
      await api().patch(`/api/productos/${id}`).set('Authorization', `Bearer ${ajeno}`).send({ marca: 'Hack' }).expect(404);
      await api().delete(`/api/productos/${id}`).set('Authorization', `Bearer ${ajeno}`).expect(404);
    });

    it('el cliente solo ve productos activos; la baja es lógica', async () => {
      const antes = await api().get('/api/productos').set(auth('rosa')).expect(200);
      expect(antes.body.some((p: any) => p.codigo === codigoProd)).toBe(true);
      expect(antes.body.every((p: any) => p.estado === 'ACTIVO')).toBe(true);
      expect(antes.body.some((p: any) => p.codigo === 'P009')).toBe(false); // inactivo en el seed

      const baja = await api().delete(`/api/productos/${id}`).set(auth('ltorres')).expect(200);
      expect(baja.body.estado).toBe('INACTIVO');
      const despues = await api().get('/api/productos').set(auth('rosa')).expect(200);
      expect(despues.body.some((p: any) => p.codigo === codigoProd)).toBe(false);
      const admin = await api().get('/api/productos?estado=INACTIVO').set(auth('ltorres')).expect(200);
      expect(admin.body.some((p: any) => p.codigo === codigoProd)).toBe(true);
    });
  });

  describe('clientes y topes BCRP', () => {
    it('crea un cliente con cuenta de acceso y devuelve los cálculos de tasas', async () => {
      const r = await api().post('/api/clientes').set(auth('ltorres'))
        .send(clienteValido('70000001', { cuenta: { username: 'cliente_e2e', password: 'ClaveSegura1' } })).expect(201);
      expect(r.body).toMatchObject({ dni: '70000001', horaCorte: '23:59', cuenta: 'cliente_e2e', estado: 'ACTIVO' });
      expect(r.body.calculos).toMatchObject({ p: 60, pMora: 180 });
      expect(Number(r.body.calculos.teaInteresPct)).toBeGreaterThan(40);
      expect(Number(r.body.calculos.teaInteresPct)).toBeLessThan(45);
      expect(JSON.stringify(r.body)).not.toMatch(/passwordHash/);
      await api().post('/api/auth/login').send({ username: 'cliente_e2e', password: 'ClaveSegura1' }).expect(200);
    });

    it('rechaza tasas que superan los topes BCRP', async () => {
      const r = await api().post('/api/clientes').set(auth('ltorres'))
        .send(clienteValido('70000002', { tasaInteres: 10, periodoTasa: 'MENSUAL' })).expect(400);
      expect(JSON.stringify(r.body.message)).toMatch(/TEA de interés.*tope BCRP/);
      const m = await api().post('/api/clientes').set(auth('ltorres'))
        .send(clienteValido('70000002', { tasaMora: 5, periodoTasaMora: 'MENSUAL' })).expect(400);
      expect(JSON.stringify(m.body.message)).toMatch(/TEA de mora.*tope BCRP/);
    });

    it('exige aceptar la privacidad, DNI válido y ser administrador de negocio', async () => {
      await api().post('/api/clientes').set(auth('ltorres')).send(clienteValido('70000002', { aceptaPrivacidad: false })).expect(400);
      await api().post('/api/clientes').set(auth('ltorres')).send(clienteValido('123')).expect(400);
      await api().post('/api/clientes').set(auth('ltorres')).send(clienteValido('70000001')).expect(409);
      await api().post('/api/clientes').set(auth('rosa')).send(clienteValido('70000002')).expect(403);
    });

    it('/calcular previsualiza sin guardar y marca si excede los topes', async () => {
      const ok = await api().post('/api/clientes/calcular').set(auth('ltorres'))
        .send({ moneda: 'PEN', tasaInteres: 6.1363551, periodoTasa: 'BIMESTRAL', tasaMora: 6.1208, periodoTasaMora: 'SEMESTRAL' }).expect(200);
      expect(ok.body).toMatchObject({ ok: true, errores: [] });
      const mal = await api().post('/api/clientes/calcular').set(auth('ltorres'))
        .send({ moneda: 'PEN', tasaInteres: 10, periodoTasa: 'MENSUAL', tasaMora: 1, periodoTasaMora: 'ANUAL' }).expect(200);
      expect(mal.body.ok).toBe(false);
      expect(mal.body.errores).toHaveLength(1);
    });

    it('actualiza datos, revalida tasas y dar de baja inactiva también su cuenta', async () => {
      const lista = await api().get('/api/clientes?q=70000001').set(auth('ltorres')).expect(200);
      const id = lista.body[0].id;
      const u = await api().patch(`/api/clientes/${id}`).set(auth('ltorres')).send({ limiteCredito: 750, horaCorte: '18:30' }).expect(200);
      expect(u.body).toMatchObject({ limiteCredito: '750', horaCorte: '18:30' });
      await api().patch(`/api/clientes/${id}`).set(auth('ltorres')).send({ tasaInteres: 10, periodoTasa: 'MENSUAL' }).expect(400);
      await api().patch(`/api/clientes/${id}`).set(auth('ltorres')).send({ dni: '99999999' }).expect(200); // dni ignorado
      const sin = await api().get(`/api/clientes/${id}`).set(auth('ltorres')).expect(200);
      expect(sin.body.dni).toBe('70000001');

      const baja = await api().delete(`/api/clientes/${id}`).set(auth('ltorres')).expect(200);
      expect(baja.body.estado).toBe('INACTIVO');
      await api().post('/api/auth/login').send({ username: 'cliente_e2e', password: 'ClaveSegura1' }).expect(401);
      await api().patch(`/api/clientes/${id}`).set(auth('ltorres')).send({ estado: 'ACTIVO' }).expect(200);
      await api().post('/api/auth/login').send({ username: 'cliente_e2e', password: 'ClaveSegura1' }).expect(200);
    });

    it('un cliente con cuotas pendientes no se puede dar de baja', async () => {
      const rosa = await db.cliente.findFirstOrThrow({ where: { dni: '40000001' } });
      const compra = await db.compra.create({
        data: {
          tiendaId: rosa.tiendaId, clienteId: rosa.id, fechaHora: new Date(), capitalInicial: 10, nCuotas: 1,
          fechaCorteCiclo: new Date(), fechaFinGracia: new Date(), diasGracia: 0, tasaGracia: 0, interesGracia: 0,
          capitalFinanciado: 10, tem: 0.01, cuotaRegular: 10, tea: 10,
        },
      });
      await db.cuota.create({
        data: { compraId: compra.id, numero: 1, fechaVencimiento: new Date(), saldoInicial: 10, interes: 0, amortizacion: 10, montoCuota: 10, saldoFinal: 0 },
      });
      try {
        const r = await api().delete(`/api/clientes/${rosa.id}`).set(auth('ltorres')).expect(409);
        expect(r.body.message).toMatch(/cuota\(s\) pendiente/);
      } finally {
        await db.cuota.deleteMany({ where: { compraId: compra.id } });
        await db.compra.delete({ where: { id: compra.id } });
      }
    });

    it('el cliente consulta solo sus propios datos y no el listado', async () => {
      const r = await api().get('/api/clientes/mi').set(auth('rosa')).expect(200);
      expect(r.body).toMatchObject({ dni: '40000001', horaCorte: '23:59' });
      await api().get('/api/clientes').set(auth('rosa')).expect(403);
      await api().get('/api/clientes/mi').set(auth('ltorres')).expect(403);
    });

    it('aislamiento: otra tienda no ve los clientes de Don Lucho', async () => {
      const lista = await api().get('/api/clientes').set(auth('tienda_e2e')).expect(200);
      expect(lista.body).toHaveLength(0);
      const rosa = await db.cliente.findFirstOrThrow({ where: { dni: '40000001' } });
      await api().get(`/api/clientes/${rosa.id}`).set(auth('tienda_e2e')).expect(404);
    });
  });

  describe('parámetros', () => {
    it('admin del sistema y del negocio consultan topes vigentes; el cliente no', async () => {
      const r = await api().get('/api/parametros/topes').set(auth('ltorres')).expect(200);
      expect(r.body.PEN).toHaveProperty('topeInteresTEA');
      expect(r.body.USD).toHaveProperty('topeMoraTEA');
      await api().get('/api/parametros').set(auth('admin')).expect(200);
      await api().get('/api/parametros').set(auth('rosa')).expect(403);
    });

    it('solo ADMIN_SISTEMA fija topes; se cierra la vigencia anterior y la mora por defecto es 0.15 × interés', async () => {
      await api().put('/api/parametros/topes').set(auth('ltorres'))
        .send({ moneda: 'USD', topeInteresTEA: 50, vigenteDesde: '2031-01-01' }).expect(403);
      await api().put('/api/parametros/topes').set(auth('admin'))
        .send({ moneda: 'USD', topeInteresTEA: 50, vigenteDesde: 'mañana' }).expect(400);

      const r = await api().put('/api/parametros/topes').set(auth('admin'))
        .send({ moneda: 'USD', topeInteresTEA: 50, vigenteDesde: '2031-01-01' }).expect(200);
      const nuevos = r.body.filter((p: any) => p.vigenteDesde.startsWith('2031-01-01'));
      expect(nuevos.find((p: any) => p.clave === 'topeInteresTEA').valor).toBe('50');
      expect(nuevos.find((p: any) => p.clave === 'topeMoraTEA').valor).toBe('7.5');
      const anterior = r.body.find((p: any) => p.clave === 'topeInteresTEA' && p.vigenteHasta?.startsWith('2030-12-31'));
      expect(anterior).toBeDefined();
      // Hoy sigue rigiendo la vigencia anterior (la nueva empieza en 2031).
      const hoy = await api().get('/api/parametros/topes').set(auth('admin')).expect(200);
      expect(hoy.body.USD.topeInteresTEA).not.toBe('50');
    });
  });

  it('las operaciones de escritura quedan en la bitácora', async () => {
    const r = await api().get('/api/bitacora?limit=200').set(auth('admin')).expect(200);
    const entidades = r.body.map((b: any) => b.entidad);
    expect(entidades).toEqual(expect.arrayContaining(['tiendas', 'productos', 'clientes']));
    expect(JSON.stringify(r.body)).not.toContain('ClaveSegura1');
  });
});
