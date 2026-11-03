import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configurarApp } from '../src/setup';

export const PASS = process.env.SEED_PASSWORD ?? 'Fiadito2026!';

/** DNI de los clientes del seed (sección 8 del contexto). */
export const DNIS = { rosa: '40000001', carlos: '40000002', mario: '40000003' };
/** Límites del seed (créditos pequeños) y límites de la sección 8, usados para reproducir sus datos exactos. */
const LIMITES_SEED = { [DNIS.rosa]: '250.00', [DNIS.carlos]: '200.00', [DNIS.mario]: '150.00' };
const LIMITES_SECCION8 = { [DNIS.rosa]: '1000.00', [DNIS.carlos]: '800.00', [DNIS.mario]: '600.00' };

export const db = new PrismaClient();

export async function iniciarApp() {
  const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app: INestApplication = mod.createNestApplication();
  configurarApp(app);
  await app.init();
  const api = () => request(app.getHttpServer());
  const tokens: Record<string, string> = {};
  const auth = (u: string) => ({ Authorization: `Bearer ${tokens[u]}` });
  const login = async (...usuarios: string[]) => {
    for (const u of usuarios) {
      tokens[u] = (await api().post('/api/auth/login').send({ username: u, password: PASS })).body.token;
    }
  };
  return { app, api, auth, login, tokens };
}

/** Fija los límites de crédito: los de la sección 8 (1000/800/600) o los del seed (250/200/150). */
export async function fijarLimites(modo: 'seccion8' | 'seed') {
  const limites = modo === 'seccion8' ? LIMITES_SECCION8 : LIMITES_SEED;
  for (const [dni, limiteCredito] of Object.entries(limites)) await db.cliente.updateMany({ where: { dni }, data: { limiteCredito } });
}

export async function idsClientes(): Promise<Record<'rosa' | 'carlos' | 'mario', string>> {
  const out: any = {};
  for (const [k, dni] of Object.entries(DNIS)) out[k] = (await db.cliente.findFirstOrThrow({ where: { dni } })).id.toString();
  return out;
}

/** Borra compras, cuotas y pagos de los clientes del seed. */
export async function limpiarCompras() {
  const clientes = await db.cliente.findMany({ where: { dni: { in: Object.values(DNIS) } }, select: { id: true } });
  const clienteId = { in: clientes.map((c) => c.id) };
  const compras = await db.compra.findMany({ where: { clienteId }, select: { id: true } });
  const compraId = { in: compras.map((c) => c.id) };
  const cuotas = await db.cuota.findMany({ where: { compraId }, select: { id: true } });
  await db.pago.deleteMany({ where: { cuotaId: { in: cuotas.map((c) => c.id) } } });
  await db.cuota.deleteMany({ where: { compraId } });
  await db.detalleCompra.deleteMany({ where: { compraId } });
  await db.compra.deleteMany({ where: { id: compraId } });
}

/** Cuerpo de una compra para la API. */
export const cuerpoCompra = (clienteId: string, fechaHora: string, items: [string, number][], nCuotas: number) => ({
  clienteId,
  fechaHora,
  nCuotas,
  items: items.map(([codigoProducto, cantidad]) => ({ codigoProducto, cantidad })),
});

export const CR1: [string, number][] = [['P001', 2], ['P002', 2], ['P003', 6], ['P004', 4], ['P005', 2], ['P006', 1]];
