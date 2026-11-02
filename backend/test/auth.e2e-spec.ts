import { INestApplication } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { PASS, db, iniciarApp } from './helpers';

// Requiere MySQL levantado y con el seed aplicado (usuarios admin y ltorres).
describe('Auth, roles y bitácora (e2e)', () => {
  let app: INestApplication;
  let api: Awaited<ReturnType<typeof iniciarApp>>['api'];

  const login = (username: string, password = PASS) => api().post('/api/auth/login').send({ username, password });
  const tokenDe = async (username: string) => (await login(username)).body.token as string;

  beforeAll(async () => {
    const t = await iniciarApp();
    app = t.app;
    api = t.api;
  });

  afterAll(async () => {
    await app.close();
    await db.$disconnect();
  });

  it('rechaza rutas sin token', async () => {
    await api().get('/api/auth/me').expect(401);
    await api().get('/api/bitacora').expect(401);
  });

  it('login correcto devuelve token y usuario, sin exponer el hash', async () => {
    const r = await login('ltorres').expect(200);
    expect(r.body.token).toHaveLength(64);
    expect(r.body.usuario).toMatchObject({ username: 'ltorres', rol: 'ADMIN_NEGOCIO' });
    expect(JSON.stringify(r.body)).not.toMatch(/passwordHash|password_hash/);
    const me = await api().get('/api/auth/me').set('Authorization', `Bearer ${r.body.token}`).expect(200);
    expect(me.body.username).toBe('ltorres');
  });

  it('solo existen dos tipos de usuario: administrador del sistema y administrador del negocio', async () => {
    const roles = await db.usuario.findMany({ distinct: ['rol'], select: { rol: true } });
    expect(roles.map((r) => r.rol).sort()).toEqual(['ADMIN_NEGOCIO', 'ADMIN_SISTEMA']);
    // Los clientes no tienen cuenta: ni usuarios de cliente del seed ni forma de iniciar sesión.
    for (const u of ['rosa', 'carlos', 'mario']) await login(u).expect(401);
  });

  it('clave incorrecta y usuario inexistente dan el mismo error', async () => {
    const a = await login('ltorres', 'mala').expect(401);
    const b = await login('nadie', 'mala').expect(401);
    expect(a.body.message).toBe(b.body.message);
  });

  it('el token solo se guarda como hash en la BD', async () => {
    const token = await tokenDe('ltorres');
    expect(await db.sesion.findMany({ where: { tokenHash: token } })).toHaveLength(0);
  });

  it('logout invalida el token', async () => {
    const token = await tokenDe('ltorres');
    await api().post('/api/auth/logout').set('Authorization', `Bearer ${token}`).expect(204);
    await api().get('/api/auth/me').set('Authorization', `Bearer ${token}`).expect(401);
  });

  it('una sesión vencida se rechaza', async () => {
    const token = await tokenDe('ltorres');
    await db.sesion.updateMany({ where: { usuario: { username: 'ltorres' } }, data: { expiraEn: new Date(Date.now() - 1000) } });
    await api().get('/api/auth/me').set('Authorization', `Bearer ${token}`).expect(401);
  });

  it('un usuario inactivo no puede entrar ni usar su sesión', async () => {
    const token = await tokenDe('ltorres');
    await db.usuario.update({ where: { username: 'ltorres' }, data: { estado: 'INACTIVO' } });
    try {
      await login('ltorres').expect(401);
      await api().get('/api/auth/me').set('Authorization', `Bearer ${token}`).expect(401);
    } finally {
      await db.usuario.update({ where: { username: 'ltorres' }, data: { estado: 'ACTIVO' } });
    }
  });

  it('los roles restringen las rutas', async () => {
    const negocio = await tokenDe('ltorres');
    const admin = await tokenDe('admin');
    await api().get('/api/tiendas').set('Authorization', `Bearer ${negocio}`).expect(403);
    await api().get('/api/tiendas').set('Authorization', `Bearer ${admin}`).expect(200);
    await api().get('/api/clientes').set('Authorization', `Bearer ${admin}`).expect(403);
    await api().get('/api/resumen').set('Authorization', `Bearer ${admin}`).expect(403);
  });

  it('login, login fallido y logout quedan en la bitácora', async () => {
    await login('ltorres', 'mala');
    const admin = await tokenDe('admin');
    const r = await api().get('/api/bitacora?limit=50').set('Authorization', `Bearer ${admin}`).expect(200);
    const acciones = r.body.map((b: any) => b.accion);
    expect(acciones).toEqual(expect.arrayContaining(['LOGIN', 'LOGIN_FALLIDO', 'LOGOUT']));
    // La bitácora no guarda contraseñas.
    expect(JSON.stringify(r.body)).not.toContain('"mala"');
  });

  it('ADMIN_NEGOCIO solo ve la bitácora de su tienda', async () => {
    const t2 = await db.tienda.create({
      data: { ruc: '20999999999', razonSocial: 'Otra SAC', nombreComercial: 'Otra', giroNegocio: 'Panadería', direccion: 'X' },
    });
    const u2 = await db.usuario.create({
      data: { username: 'otro_admin', passwordHash: bcrypt.hashSync(PASS, 10), nombre: 'Otro', rol: 'ADMIN_NEGOCIO', tiendaId: t2.id },
    });
    try {
      const t2Token = await tokenDe('otro_admin');
      const propio = await api().get('/api/bitacora').set('Authorization', `Bearer ${t2Token}`).expect(200);
      expect(propio.body.length).toBeGreaterThan(0);
      expect(propio.body.every((b: any) => b.usuario.username === 'otro_admin')).toBe(true);

      const lt = await tokenDe('ltorres');
      const ajeno = await api().get('/api/bitacora?limit=500').set('Authorization', `Bearer ${lt}`).expect(200);
      expect(ajeno.body.some((b: any) => b.usuario?.username === 'otro_admin')).toBe(false);
    } finally {
      await db.bitacora.deleteMany({ where: { usuarioId: u2.id } });
      await db.sesion.deleteMany({ where: { usuarioId: u2.id } });
      await db.usuario.delete({ where: { id: u2.id } });
      await db.tienda.delete({ where: { id: t2.id } });
    }
  });
});
