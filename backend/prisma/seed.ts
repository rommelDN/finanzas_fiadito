import { PrismaClient, Moneda, Periodo } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

// Clave de demostración para TODAS las cuentas del seed. Cambiarla fuera de desarrollo.
const DEMO_PASSWORD = process.env.SEED_PASSWORD ?? 'Fiadito2026!';
const utcDate = (iso: string) => new Date(`${iso}T00:00:00Z`);
const hora = (hhmm: string) => new Date(`1970-01-01T${hhmm}:00Z`);

async function main() {
  const hash = await bcrypt.hash(DEMO_PASSWORD, 10);

  // ---- Parámetros ----
  const globales: [string, string][] = [
    ['baseDias', '360'],
    ['diasMes', '30'],
    ['decimalesMoneda', '2'],
    ['decimalesTasaMinimos', '7'],
    ['baseMora', 'TOTAL_VENCIDO'],
  ];
  // VALORES REFERENCIALES: actualizar con la circular BCRP vigente (se recalculan en mayo y noviembre).
  // topeMoraTEA = 0.15 × topeInteresTEA (Circular BCRP 0008-2021).
  const topes: Record<Moneda, { interes: string; mora: string }> = {
    PEN: { interes: '100', mora: '15' },
    USD: { interes: '60', mora: '9' },
  };
  for (const moneda of ['PEN', 'USD'] as Moneda[]) {
    const filas = [...globales, ['topeInteresTEA', topes[moneda].interes], ['topeMoraTEA', topes[moneda].mora]];
    for (const [clave, valor] of filas) {
      await prisma.parametro.upsert({
        where: { clave_moneda_vigenteDesde: { clave, moneda, vigenteDesde: utcDate('2026-01-01') } },
        update: { valor },
        create: { clave, moneda, valor, vigenteDesde: utcDate('2026-01-01') },
      });
    }
  }

  // ---- Administrador del sistema ----
  await prisma.usuario.upsert({
    where: { username: 'admin' },
    update: {},
    create: { username: 'admin', passwordHash: hash, nombre: 'Administrador del sistema', rol: 'ADMIN_SISTEMA' },
  });

  // ---- Tienda de ejemplo ----
  const tienda = await prisma.tienda.upsert({
    where: { ruc: '20100000001' },
    update: {},
    create: {
      ruc: '20100000001',
      razonSocial: 'Bodega Don Lucho E.I.R.L.',
      nombreComercial: 'Bodega Don Lucho',
      giroNegocio: 'Bodega',
      direccion: 'Av. Los Olivos 123, Lima',
    },
  });

  await prisma.usuario.upsert({
    where: { username: 'ltorres' },
    update: {},
    create: { username: 'ltorres', passwordHash: hash, nombre: 'Luis Torres', rol: 'ADMIN_NEGOCIO', tiendaId: tienda.id },
  });

  // ---- Productos (sección 8) ----
  const productos = [
    ['P001', 'Arroz extra 5 kg', 'UND', '22.00', '24.00', 6, true, 'ACTIVO'],
    ['P002', 'Aceite vegetal 1 L', 'LT', '9.50', '10.50', 6, true, 'ACTIVO'],
    ['P003', 'Leche evaporada 400 g', 'UND', '4.20', '4.60', 6, true, 'ACTIVO'],
    ['P004', 'Atún en aceite 170 g', 'UND', '5.00', '5.50', 6, true, 'ACTIVO'],
    ['P005', 'Azúcar rubia 1 kg', 'KG', '3.30', '3.60', 6, true, 'ACTIVO'],
    ['P006', 'Detergente 2 kg', 'UND', '16.50', '18.00', 6, true, 'ACTIVO'],
    ['P007', 'Balón de gas 10 kg', 'UND', '50.00', '55.00', 2, true, 'ACTIVO'],
    ['P008', 'Recarga celular S/ 10', 'SERVICIO', '10.00', '10.00', 1, false, 'ACTIVO'],
    ['P009', 'Fideos spaghetti 500 g', 'UND', '2.80', '3.00', 6, true, 'INACTIVO'],
  ] as const;
  for (const [codigo, descripcion, unidadMedida, contado, credito, maxCuotasProducto, permiteCredito, estado] of productos) {
    await prisma.producto.upsert({
      where: { tiendaId_codigo: { tiendaId: tienda.id, codigo } },
      update: {},
      create: {
        tiendaId: tienda.id, codigo, descripcion, unidadMedida,
        precioContado: contado, precioCredito: credito, maxCuotasProducto, permiteCredito, estado,
      },
    });
  }

  // ---- Clientes (sección 8) ----
  const clientes: {
    user: string; dni: string; nombres: string; apellidos: string;
    tasa: string; per: Periodo; mora: string; perMora: Periodo;
    limite: string; maxCuotas: number; corte: number; pago: number;
  }[] = [
    { user: 'rosa', dni: '40000001', nombres: 'Rosa', apellidos: 'Quispe Huamán', tasa: '6.1363551', per: 'BIMESTRAL', mora: '6.1208000', perMora: 'SEMESTRAL', limite: '1000.00', maxCuotas: 6, corte: 20, pago: 26 },
    { user: 'carlos', dni: '40000002', nombres: 'Carlos', apellidos: 'Mendoza Ríos', tasa: '20.0000000', per: 'SEMESTRAL', mora: '6.0000000', perMora: 'SEMESTRAL', limite: '800.00', maxCuotas: 4, corte: 25, pago: 5 },
    { user: 'mario', dni: '40000003', nombres: 'Mario', apellidos: 'Paredes Salas', tasa: '1.5105456', per: 'QUINCENAL', mora: '0.4007475', perMora: 'QUINCENAL', limite: '600.00', maxCuotas: 4, corte: 20, pago: 26 },
  ];
  for (const c of clientes) {
    const u = await prisma.usuario.upsert({
      where: { username: c.user },
      update: {},
      create: { username: c.user, passwordHash: hash, nombre: `${c.nombres} ${c.apellidos}`, rol: 'CLIENTE', tiendaId: tienda.id },
    });
    await prisma.cliente.upsert({
      where: { tiendaId_dni: { tiendaId: tienda.id, dni: c.dni } },
      update: {},
      create: {
        tiendaId: tienda.id, usuarioId: u.id, dni: c.dni, nombres: c.nombres, apellidos: c.apellidos,
        moneda: 'PEN', tasaInteres: c.tasa, periodoTasa: c.per, tasaMora: c.mora, periodoTasaMora: c.perMora,
        limiteCredito: c.limite, maxCuotas: c.maxCuotas, diaCorte: c.corte, horaCorte: hora('23:59'), diaPago: c.pago,
        aceptaPrivacidad: true,
      },
    });
  }

  console.log(`Seed listo. Usuarios: admin, ltorres, rosa, carlos, mario — clave: ${DEMO_PASSWORD}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
