import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cliente, MedioPago, Prisma } from '@prisma/client';
import Decimal from 'decimal.js';
import { fechaISOValida, hoyLimaISO } from '../common/lima';
import { PrismaService } from '../common/prisma.service';
import { Fecha, calcularPago, cmpFecha, dec, fechaISO, mk, parseISO } from '../finanzas';

type Db = PrismaService | Prisma.TransactionClient;
type Alcance = { tiendaId: bigint; clienteId?: bigint | null };

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

const incluir = {
  cliente: { select: { id: true, dni: true, nombres: true, apellidos: true } },
  items: { orderBy: { id: 'asc' as const } },
  pago: true,
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
    return r.estado;
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

  private where(a: Alcance): Prisma.EstadoCuentaWhereInput {
    return { cliente: { tiendaId: a.tiendaId, ...(a.clienteId ? { id: a.clienteId } : {}) } };
  }

  listar(a: Alcance, f: { clienteId?: bigint; estado?: 'PENDIENTE' | 'PAGADO' }) {
    return this.prisma.estadoCuenta.findMany({
      where: {
        ...this.where(a),
        ...(f.clienteId && !a.clienteId ? { clienteId: f.clienteId } : {}),
        ...(f.estado ? { estado: f.estado } : {}),
      },
      orderBy: [{ fechaCorte: 'desc' }, { id: 'desc' }],
      include: { cliente: { select: { id: true, dni: true, nombres: true, apellidos: true } }, pago: true },
    });
  }

  async obtener(a: Alcance, id: bigint) {
    const e = await this.prisma.estadoCuenta.findFirst({ where: { id, ...this.where(a) }, include: incluir });
    if (!e) throw new NotFoundException('Estado de cuenta no encontrado');
    return e;
  }

  // ---------------------------------------------------------------- pago y mora

  private async calcular(db: Db, a: Alcance, id: bigint, fechaPagoReal: string) {
    if (!fechaISOValida(fechaPagoReal)) throw new BadRequestException('fechaPagoReal debe ser una fecha YYYY-MM-DD válida');
    const estado = await db.estadoCuenta.findFirst({
      where: { id, ...this.where(a) },
      include: { cliente: true, cuotas: { orderBy: [{ compraId: 'asc' }, { numero: 'asc' }] } },
    });
    if (!estado) throw new NotFoundException('Estado de cuenta no encontrado');
    const real = parseISO(fechaPagoReal);
    if (cmpFecha(real, fechaDe(estado.fechaCorte)) < 0) {
      throw new BadRequestException('La fecha de pago no puede ser anterior a la fecha de corte del estado de cuenta');
    }
    const r = calcularPago(
      estado.cuotas.map((c) => ({
        vencimiento: fechaDe(c.fechaVencimiento),
        interes: dec(c.interes.toString()),
        amortizacion: dec(c.amortizacion.toString()),
      })),
      fechaDe(estado.fechaPago),
      real,
      estado.cliente.tasaMora.toString(),
      estado.cliente.periodoTasaMora,
    );
    return { estado, r, real };
  }

  /** Vista previa del pago ("Pagos"): días de mora, tasa, mora, total a pagar e imputación. No guarda. */
  async calculoPago(a: Alcance, id: bigint, fechaPagoReal: string = hoyLimaISO()) {
    const { estado, r } = await this.calcular(this.prisma, a, id, fechaPagoReal);
    return {
      estadoCuentaId: estado.id,
      estado: estado.estado,
      fechaPago: fechaISO(fechaDe(estado.fechaPago)),
      fechaPagoReal,
      diasMora: r.diasMora,
      tasaMoraPeriodoPct: r.tasaMoraPeriodo.times(100).toFixed(7),
      totalCapital: m2(r.totalCapital),
      totalInteresesCuotas: m2(r.totalInteresesCuotas),
      interesesMora: m2(r.interesesMora),
      totalPagar: m2(r.totalPagar),
      /** Prelación: mora → intereses de cuotas → capital. */
      imputacion: { mora: m2(r.interesesMora), intereses: m2(r.totalInteresesCuotas), capital: m2(r.totalCapital) },
    };
  }

  /** Registra el pago. Debe ser exactamente el total (sin pagos parciales) y un estado solo se paga una vez. */
  async pagar(a: Alcance, id: bigint, d: { fechaPagoReal?: string; medioPago: MedioPago; montoPagado: number }) {
    const fechaPagoReal = d.fechaPagoReal ?? hoyLimaISO();
    await this.prisma.$transaction(async (tx) => {
      // Bloquea el estado: dos pagos simultáneos no pueden cancelarlo dos veces.
      await tx.$queryRaw`SELECT id FROM estado_cuenta WHERE id = ${id} FOR UPDATE`;
      const { estado, r } = await this.calcular(tx, a, id, fechaPagoReal);
      if (estado.estado === 'PAGADO') throw new ConflictException('El estado de cuenta ya fue cancelado');
      if (!dec(d.montoPagado).eq(r.totalPagar)) {
        throw new BadRequestException(
          `El pago debe ser exactamente ${m2(r.totalPagar)} (no se aceptan pagos parciales ni excedentes); se recibió ${m2(dec(d.montoPagado))}`,
        );
      }
      await tx.pago.create({
        data: {
          estadoCuentaId: id,
          fechaPagoReal: aDate(parseISO(fechaPagoReal)),
          diasMora: r.diasMora,
          tasaMoraPeriodo: r.diasMora > 0 ? r.tasaMoraPeriodo.toFixed(12) : null,
          montoMora: m2(r.interesesMora),
          montoInteres: m2(r.totalInteresesCuotas),
          montoCapital: m2(r.totalCapital),
          montoTotal: m2(r.totalPagar),
          medioPago: d.medioPago,
        },
      });
      // La mora aparece como ítem separado "intereses por mora".
      if (r.interesesMora.gt(0)) {
        await tx.estadoCuentaItem.create({
          data: {
            estadoCuentaId: id,
            tipo: 'MORA',
            fecha: aDate(parseISO(fechaPagoReal)),
            descripcion: 'Intereses por mora',
            capital: '0.00',
            dias: r.diasMora,
            tasaPeriodo: r.tasaMoraPeriodo.toFixed(12),
            interes: m2(r.interesesMora),
            subtotal: m2(r.interesesMora),
          },
        });
      }
      await tx.cuota.updateMany({ where: { estadoCuentaId: id }, data: { estado: 'PAGADA' } });
      await tx.estadoCuenta.update({ where: { id }, data: { estado: 'PAGADO' } });
      // Una compra sin cuotas pendientes queda cancelada.
      const compraIds = [...new Set(estado.cuotas.map((c) => c.compraId))];
      for (const compraId of compraIds) {
        const pendientes = await tx.cuota.count({ where: { compraId, estado: 'PENDIENTE' } });
        if (!pendientes) await tx.compra.update({ where: { id: compraId }, data: { estado: 'CANCELADA' } });
      }
    });
    return this.obtener(a, id);
  }
}
