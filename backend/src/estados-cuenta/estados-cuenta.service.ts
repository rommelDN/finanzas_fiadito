import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cliente, Prisma } from '@prisma/client';
import Decimal from 'decimal.js';
import { fechaISOValida, hoyLimaISO } from '../common/lima';
import { PrismaService } from '../common/prisma.service';
import { Fecha, calcularPago, cmpFecha, dec, fechaISO, mk, parseISO } from '../finanzas';

const m2 = (x: Decimal) => x.toFixed(2);
const fechaDe = (d: Date): Fecha => parseISO(d.toISOString());
const aDate = (f: Fecha) => new Date(`${fechaISO(f)}T00:00:00Z`);

/** Fecha de pago del ciclo: primer día de pago posterior al corte. */
export const fechaPagoDeCorte = (corte: Fecha, diaPago: number): Fecha => {
  const f = mk(corte.y, corte.m, diaPago);
  return cmpFecha(f, corte) <= 0 ? mk(corte.y, corte.m + 1, diaPago) : f;
};

/** ¿La fecha es un día de corte del cliente? (el día 31 en febrero cae el último día del mes) */
export const esDiaDeCorte = (corte: Fecha, diaCorte: number): boolean => mk(corte.y, corte.m, diaCorte).d === corte.d;

/** Último corte del cliente que ya ocurrió (≤ hasta). */
export const ultimoCorte = (diaCorte: number, hasta: Fecha): Fecha => {
  const c = mk(hasta.y, hasta.m, diaCorte);
  return cmpFecha(c, hasta) > 0 ? mk(hasta.y, hasta.m - 1, diaCorte) : c;
};

/** Marca el estado de cuenta como PAGADO cuando todas sus cuotas están pagadas. */
export async function refrescarEstado(tx: Prisma.TransactionClient, estadoCuentaId: bigint | null) {
  if (!estadoCuentaId) return;
  const pendientes = await tx.cuota.count({ where: { estadoCuentaId, estado: 'PENDIENTE' } });
  await tx.estadoCuenta.update({ where: { id: estadoCuentaId }, data: { estado: pendientes ? 'PENDIENTE' : 'PAGADO' } });
}

const incluir = {
  cliente: { select: { id: true, dni: true, nombres: true, apellidos: true, tasaMora: true, periodoTasaMora: true } },
  items: { orderBy: { id: 'asc' as const } },
  cuotas: {
    orderBy: [{ compraId: 'asc' as const }, { numero: 'asc' as const }],
    include: { pago: true, compra: { select: { id: true, nCuotas: true } } },
  },
};

@Injectable()
export class EstadosCuentaService {
  private readonly log = new Logger('EstadosCuenta');
  constructor(private readonly prisma: PrismaService) {}

  // ---------------------------------------------------------------- generación

  /**
   * Genera el estado de cuenta del cliente para un corte: las cuotas pendientes aún no incluidas en
   * ningún estado que vencen hasta la fecha de pago del ciclo, ordenadas por fecha de compra.
   * Es idempotente: (cliente, corte) es único. Devuelve null si no hay nada que cobrar.
   */
  async generarParaCliente(cliente: Cliente, corte: Fecha) {
    const buscar = () =>
      this.prisma.estadoCuenta.findUnique({
        where: { clienteId_fechaCorte: { clienteId: cliente.id, fechaCorte: aDate(corte) } },
        include: incluir,
      });
    const existente = await buscar();
    if (existente) return { estado: existente, creado: false };

    const fechaPago = fechaPagoDeCorte(corte, cliente.diaPago);
    try {
      const estado = await this.prisma.$transaction(async (tx) => {
        const cuotas = await tx.cuota.findMany({
          where: {
            estado: 'PENDIENTE',
            estadoCuentaId: null,
            fechaVencimiento: { lte: aDate(fechaPago) },
            compra: { clienteId: cliente.id },
          },
          include: { compra: { select: { fechaHora: true, nCuotas: true } } },
          orderBy: [{ compra: { fechaHora: 'asc' } }, { compraId: 'asc' }, { numero: 'asc' }],
        });
        if (!cuotas.length) return null;

        const suma = (f: (c: (typeof cuotas)[number]) => Prisma.Decimal) =>
          cuotas.reduce((s, c) => s.plus(f(c).toString()), dec(0));
        const totalCapital = suma((c) => c.amortizacion);
        const totalIntereses = suma((c) => c.interes);
        const creado = await tx.estadoCuenta.create({
          data: {
            clienteId: cliente.id,
            fechaCorte: aDate(corte),
            fechaPago: aDate(fechaPago),
            totalCapital: m2(totalCapital),
            totalInteresesCuotas: m2(totalIntereses),
            total: m2(totalCapital.plus(totalIntereses)),
            items: {
              create: cuotas.map((c) => ({
                cuotaId: c.id,
                tipo: 'CUOTA' as const,
                fecha: c.fechaVencimiento,
                descripcion: `Compra #${c.compraId} - cuota ${c.numero}/${c.compra.nCuotas}`,
                capital: c.amortizacion,
                interes: c.interes,
                subtotal: c.montoCuota,
              })),
            },
          },
        });
        await tx.cuota.updateMany({ where: { id: { in: cuotas.map((c) => c.id) } }, data: { estadoCuentaId: creado.id } });
        return creado;
      });
      if (!estado) return { estado: null, creado: false };
      return { estado: await buscar(), creado: true };
    } catch (e: any) {
      // Otra ejecución (tarea o manual) lo creó al mismo tiempo.
      if (e?.code === 'P2002') return { estado: await buscar(), creado: false };
      throw e;
    }
  }

  /** Generación manual para un cliente de la tienda en una fecha de corte concreta. */
  async generar(tiendaId: bigint, clienteId: bigint, fechaCorte: string) {
    if (!fechaISOValida(fechaCorte)) throw new BadRequestException('fechaCorte debe ser una fecha YYYY-MM-DD válida');
    const cliente = await this.prisma.cliente.findFirst({ where: { id: clienteId, tiendaId } });
    if (!cliente) throw new NotFoundException('Cliente no encontrado');
    const corte = parseISO(fechaCorte);
    if (!esDiaDeCorte(corte, cliente.diaCorte)) {
      throw new BadRequestException(`${fechaCorte} no es un día de corte del cliente (día ${cliente.diaCorte} de cada mes)`);
    }
    const r = await this.generarParaCliente(cliente, corte);
    if (!r.estado) throw new NotFoundException('No hay cuotas por cobrar en ese ciclo: no se genera estado de cuenta');
    return this.conMora(r.estado);
  }

  /**
   * Tarea diaria: genera el estado del último corte ya ocurrido (≤ ayer) para los clientes con cuotas
   * pendientes de incluir. Se ejecuta de madrugada, cuando la hora de corte del día anterior ya pasó.
   */
  async generarVencidos(hoy: Fecha = parseISO(hoyLimaISO())) {
    const ayer = parseISO(new Date(aDate(hoy).getTime() - 86_400_000).toISOString());
    const clientes = await this.prisma.cliente.findMany({
      where: { compras: { some: { cuotas: { some: { estado: 'PENDIENTE', estadoCuentaId: null } } } } },
    });
    let generados = 0;
    for (const c of clientes) {
      try {
        const r = await this.generarParaCliente(c, ultimoCorte(c.diaCorte, ayer));
        if (r.creado) generados++;
      } catch (e: any) {
        this.log.error(`Cliente ${c.id}: ${e.message}`);
      }
    }
    this.log.log(`Estados de cuenta generados: ${generados} (clientes revisados: ${clientes.length})`);
    return { revisados: clientes.length, generados };
  }

  // ---------------------------------------------------------------- consulta

  listar(tiendaId: bigint, f: { clienteId?: bigint; estado?: 'PENDIENTE' | 'PAGADO' }) {
    return this.prisma.estadoCuenta.findMany({
      where: {
        cliente: { tiendaId },
        ...(f.clienteId ? { clienteId: f.clienteId } : {}),
        ...(f.estado ? { estado: f.estado } : {}),
      },
      orderBy: [{ fechaCorte: 'desc' }, { id: 'desc' }],
      include: { cliente: { select: { id: true, dni: true, nombres: true, apellidos: true } } },
    });
  }

  async obtener(tiendaId: bigint, id: bigint) {
    const e = await this.prisma.estadoCuenta.findFirst({ where: { id, cliente: { tiendaId } }, include: incluir });
    if (!e) throw new NotFoundException('Estado de cuenta no encontrado');
    return this.conMora(e);
  }

  /**
   * Agrega la mora acumulada a hoy de las cuotas vencidas sin pagar (ítem separado "intereses por mora").
   * La mora definitiva se fija al pagar cada cuota.
   */
  private conMora<T extends { cliente: { tasaMora: Prisma.Decimal; periodoTasaMora: any }; cuotas: any[]; fechaPago: Date }>(e: T) {
    const hoy = parseISO(hoyLimaISO());
    const moraHoy = e.cuotas
      .filter((c) => c.estado === 'PENDIENTE' && cmpFecha(fechaDe(c.fechaVencimiento), hoy) < 0)
      .map((c) => {
        const r = calcularPago(
          [{ vencimiento: fechaDe(c.fechaVencimiento), interes: dec(c.interes.toString()), amortizacion: dec(c.amortizacion.toString()) }],
          fechaDe(c.fechaVencimiento),
          hoy,
          e.cliente.tasaMora.toString(),
          e.cliente.periodoTasaMora,
        );
        return { cuotaId: c.id, compraId: c.compra.id, numero: c.numero, dias: r.diasMora, mora: m2(r.interesesMora) };
      });
    const total = moraHoy.reduce((s, m) => s.plus(m.mora), dec(0));
    return { ...e, moraHoy: { cuotas: moraHoy, total: m2(total) } };
  }
}
