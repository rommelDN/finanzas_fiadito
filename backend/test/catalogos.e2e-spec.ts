import { INestApplication } from '@nestjs/common';
import { db, iniciarApp } from './helpers';

// Requiere MySQL con el seed aplicado.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

describe('Tiendas, productos, clientes y parámetros (e2e)', () => {
  let app: INestApplication;
  let t: Awaited<ReturnType<typeof iniciarApp>>;
  const api = () => t.api();
  const auth = (u: string) => t.auth(u);

  const creados = { rucs: ['20555555551'], dnis: ['70000001', '70000002'], usernames: ['tienda_e2e'] };
  const sufijo = Date.now().toString().slice(-6);
  const codigoProd = `T${sufijo}`;

  const clienteValido = (dni: string, extra: object = {}) => ({
    dni, nombres: 'Prueba', apellidos: 'E2E',
    tasaInteres: 6.1363551, periodoTasa: 'BIMESTRAL', tasaMora: 6.1208, periodoTasaMora: 'SEMESTRAL',
    limiteCredito: 200, maxCuotas: 4, diaCorte: 20, horaCorte: '23:59', diaPago: 26, aceptaPrivacidad: true,
    ...extra,
  });

  beforeAll(async () => {
    t = await iniciarApp();
    app = t.app;
    await t.login('admin', 'ltorres');
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
      await api().get('/api/tiendas').set(auth('ltorres')).expect(403);
    });

    it('alta de tienda crea su administrador, que puede iniciar sesión', async () => {
      const r = await api().post('/api/tiendas').set(auth('admin')).send(nueva).expect(201);
      id = r.body.id;
      expect(r.body.estado).toBe('ACTIVA');
      expect(r.body.usuarios[0]).toMatchObject({ username: 'tienda_e2e' });
      expect(JSON.stringify(r.body)).not.toMatch(/passwordHash|ClaveSegura1/);
      const login = await api().post('/api/auth/login').send({ username: 'tienda_e2e', password: 'ClaveSegura1' }).expect(200);
      t.tokens.tienda_e2e = login.body.token;
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
      expect(r.body).toMatchObject({ codigo: codigoProd, permiteCredito: true, estado: 'ACTIVO', precioContado: '3.5' });
      expect(r.body).not.toHaveProperty('monedaPrecio');
    });

    it('rechaza código repetido, precios inválidos o fuera de rango, y al administrador del sistema', async () => {
      await api().post('/api/productos').set(auth('ltorres')).send(prod).expect(409);
      await api().post('/api/productos').set(auth('ltorres')).send({ ...prod, codigo: 'X', precioContado: 0 }).expect(400);
      await api().post('/api/productos').set(auth('ltorres')).send({ ...prod, codigo: 'X', precioContado: 1.234 }).expect(400);
      await api().post('/api/productos').set(auth('ltorres')).send({ ...prod, codigo: 'X', precioContado: 251 }).expect(400);
      await api().post('/api/productos').set(auth('ltorres')).send({ ...prod, codigo: 'X', maxCuotasProducto: 13 }).expect(400);
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
      const ajeno = 'tienda_e2e';
      const lista = await api().get('/api/productos').set(auth(ajeno)).expect(200);
      expect(lista.body).toHaveLength(0);
      await api().get(`/api/productos/${id}`).set(auth(ajeno)).expect(404);
      await api().patch(`/api/productos/${id}`).set(auth(ajeno)).send({ marca: 'Hack' }).expect(404);
      await api().delete(`/api/productos/${id}`).set(auth(ajeno)).expect(404);
    });

    it('la baja es lógica y se puede filtrar por estado', async () => {
      const baja = await api().delete(`/api/productos/${id}`).set(auth('ltorres')).expect(200);
      expect(baja.body.estado).toBe('INACTIVO');
      const inactivos = await api().get('/api/productos?estado=INACTIVO').set(auth('ltorres')).expect(200);
      expect(inactivos.body.some((p: any) => p.codigo === codigoProd)).toBe(true);
      const activos = await api().get('/api/productos?estado=ACTIVO').set(auth('ltorres')).expect(200);
      expect(activos.body.some((p: any) => p.codigo === codigoProd)).toBe(false);
    });
  });

  describe('clientes y topes de TEA', () => {
    it('crea un cliente (sin cuenta de acceso) y devuelve los cálculos de tasas', async () => {
      const r = await api().post('/api/clientes').set(auth('ltorres')).send(clienteValido('70000001')).expect(201);
      expect(r.body).toMatchObject({ dni: '70000001', horaCorte: '23:59', estado: 'ACTIVO', limiteCredito: '200' });
      expect(r.body.calculos).toMatchObject({ p: 60, pMora: 180 });
      expect(Number(r.body.calculos.teaInteresPct)).toBeGreaterThan(40);
      expect(Number(r.body.calculos.teaInteresPct)).toBeLessThan(45);
      expect(r.body).not.toHaveProperty('moneda');
      expect(r.body).not.toHaveProperty('usuarioId');
    });

    it('rechaza tasas que superan los topes (60 % de interés y 15 % de mora, TEA)', async () => {
      const r = await api().post('/api/clientes').set(auth('ltorres'))
        .send(clienteValido('70000002', { tasaInteres: 10, periodoTasa: 'MENSUAL' })).expect(400);
      expect(JSON.stringify(r.body.message)).toMatch(/TEA de interés.*supera el tope/);
      const m = await api().post('/api/clientes').set(auth('ltorres'))
        .send(clienteValido('70000002', { tasaMora: 5, periodoTasaMora: 'MENSUAL' })).expect(400);
      expect(JSON.stringify(m.body.message)).toMatch(/TEA de mora.*supera el tope/);
    });

    it('el límite de crédito no puede pasar de S/ 250 ni las cuotas de 12', async () => {
      const r = await api().post('/api/clientes').set(auth('ltorres')).send(clienteValido('70000002', { limiteCredito: 251 })).expect(400);
      expect(JSON.stringify(r.body.message)).toMatch(/no puede superar S\/ 250/);
      await api().post('/api/clientes').set(auth('ltorres')).send(clienteValido('70000002', { limiteCredito: 250 })).expect(201);
      await api().post('/api/clientes').set(auth('ltorres')).send(clienteValido('70000003', { maxCuotas: 13 })).expect(400);
    });

    it('exige aceptar la privacidad, DNI válido y ser administrador de negocio', async () => {
      await api().post('/api/clientes').set(auth('ltorres')).send(clienteValido('70000009', { aceptaPrivacidad: false })).expect(400);
      await api().post('/api/clientes').set(auth('ltorres')).send(clienteValido('123')).expect(400);
      await api().post('/api/clientes').set(auth('ltorres')).send(clienteValido('70000001')).expect(409);
      await api().post('/api/clientes').set(auth('admin')).send(clienteValido('70000009')).expect(403);
    });

    it('/calcular previsualiza sin guardar y marca si excede los topes', async () => {
      const ok = await api().post('/api/clientes/calcular').set(auth('ltorres'))
        .send({ tasaInteres: 6.1363551, periodoTasa: 'BIMESTRAL', tasaMora: 6.1208, periodoTasaMora: 'SEMESTRAL' }).expect(200);
      expect(ok.body).toMatchObject({ ok: true, errores: [], topes: { topeInteresTEA: '60', topeMoraTEA: '15' } });
      const mal = await api().post('/api/clientes/calcular').set(auth('ltorres'))
        .send({ tasaInteres: 10, periodoTasa: 'MENSUAL', tasaMora: 1, periodoTasaMora: 'ANUAL' }).expect(200);
      expect(mal.body.ok).toBe(false);
      expect(mal.body.errores).toHaveLength(1);
    });

    it('no existe tasa nominal: el cuerpo solo acepta tasas efectivas con su periodo', async () => {
      const r = await api().post('/api/clientes').set(auth('ltorres'))
        .send(clienteValido('70000004', { tipoTasa: 'NOMINAL', capitalizacion: 'MENSUAL' }));
      // Los campos extra se ignoran (whitelist) y se crea con la tasa efectiva.
      expect([201, 409]).toContain(r.status);
      expect(JSON.stringify(r.body)).not.toMatch(/nominal|capitalizacion/i);
      await db.cliente.deleteMany({ where: { dni: '70000004' } });
    });

    it('actualiza datos, revalida tasas y no cambia el DNI', async () => {
      const lista = await api().get('/api/clientes?q=70000001').set(auth('ltorres')).expect(200);
      const id = lista.body[0].id;
      const u = await api().patch(`/api/clientes/${id}`).set(auth('ltorres')).send({ limiteCredito: 150, horaCorte: '18:30' }).expect(200);
      expect(u.body).toMatchObject({ limiteCredito: '150', horaCorte: '18:30' });
      await api().patch(`/api/clientes/${id}`).set(auth('ltorres')).send({ limiteCredito: 300 }).expect(400);
      await api().patch(`/api/clientes/${id}`).set(auth('ltorres')).send({ tasaInteres: 10, periodoTasa: 'MENSUAL' }).expect(400);
      await api().patch(`/api/clientes/${id}`).set(auth('ltorres')).send({ dni: '99999999' }).expect(200);
      expect((await api().get(`/api/clientes/${id}`).set(auth('ltorres')).expect(200)).body.dni).toBe('70000001');
    });

    it('la baja es lógica; no se permite con cuotas pendientes', async () => {
      const lista = await api().get('/api/clientes?q=70000001').set(auth('ltorres')).expect(200);
      const baja = await api().delete(`/api/clientes/${lista.body[0].id}`).set(auth('ltorres')).expect(200);
      expect(baja.body.estado).toBe('INACTIVO');

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

    it('aislamiento: otra tienda no ve los clientes de Don Lucho', async () => {
      const lista = await api().get('/api/clientes').set(auth('tienda_e2e')).expect(200);
      expect(lista.body).toHaveLength(0);
      const rosa = await db.cliente.findFirstOrThrow({ where: { dni: '40000001' } });
      await api().get(`/api/clientes/${rosa.id}`).set(auth('tienda_e2e')).expect(404);
    });
  });

  describe('parámetros', () => {
    it('ambos administradores consultan los topes vigentes; los límites del proyecto son fijos', async () => {
      const r = await api().get('/api/parametros/topes').set(auth('ltorres')).expect(200);
      expect(r.body).toEqual({ topeInteresTEA: '60', topeMoraTEA: '15' });
      const p = await api().get('/api/parametros').set(auth('admin')).expect(200);
      expect(p.body.limites).toEqual({ limiteMaximoCredito: 250, maxCuotas: 12 });
      expect(JSON.stringify(p.body)).not.toMatch(/USD|moneda/);
    });

    it('solo ADMIN_SISTEMA fija topes; se cierra la vigencia anterior', async () => {
      const dto = { topeInteresTEA: 50, topeMoraTEA: 12, vigenteDesde: '2031-01-01' };
      await api().put('/api/parametros/topes').set(auth('ltorres')).send(dto).expect(403);
      await api().put('/api/parametros/topes').set(auth('admin')).send({ ...dto, vigenteDesde: 'mañana' }).expect(400);
      await api().put('/api/parametros/topes').set(auth('admin')).send({ topeInteresTEA: 50, vigenteDesde: '2031-01-01' }).expect(400);

      const r = await api().put('/api/parametros/topes').set(auth('admin')).send(dto).expect(200);
      const nuevos = r.body.filter((p: any) => p.vigenteDesde.startsWith('2031-01-01'));
      expect(nuevos.find((p: any) => p.clave === 'topeInteresTEA').valor).toBe('50');
      expect(nuevos.find((p: any) => p.clave === 'topeMoraTEA').valor).toBe('12');
      expect(r.body.some((p: any) => p.clave === 'topeInteresTEA' && p.vigenteHasta?.startsWith('2030-12-31'))).toBe(true);
      // Hoy sigue rigiendo la vigencia anterior (la nueva empieza en 2031).
      const hoy = await api().get('/api/parametros/topes').set(auth('admin')).expect(200);
      expect(hoy.body.topeInteresTEA).toBe('60');
    });
  });

  it('las operaciones de escritura quedan en la bitácora', async () => {
    const r = await api().get('/api/bitacora?limit=200').set(auth('admin')).expect(200);
    const entidades = r.body.map((b: any) => b.entidad);
    expect(entidades).toEqual(expect.arrayContaining(['tiendas', 'productos', 'clientes']));
    expect(JSON.stringify(r.body)).not.toContain('ClaveSegura1');
  });
});
