import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { MedioPago } from '@prisma/client';
import Decimal from 'decimal.js';
import { hoyLimaISO, fechaISOValida } from '../common/lima';
import { PrismaService } from '../common/prisma.service';
import { deudaPendiente } from '../compras/compras.service';
import { calcularConGracia, calcularPago, cmpFecha, dec, dias360, fechaISO, parseISO } from '../finanzas';
import type { Fecha } from '../finanzas';
import { refrescarEstado } from '../estados-cuenta/estados-cuenta.service';

const m2 = (x: Decimal) => x.toFixed(2);
const fechaDe = (d: Date): Fecha => parseISO(d.toISOString());
const aDate = (f: Fecha) => new Date(`${fechaISO(f)}T00:00:00Z`);

@Injectable()
export class CronogramaService {
  constructor(private readonly prisma: PrismaService) {}

  private async cargar(tiendaId: bigint, compraId: bigint) {
    const c = await this.prisma.compra.findFirst({
      where: { id: compraId, tiendaId },
      include: {
        cliente: true,
        cuotas: { orderBy: { numero: 'asc' }, include: { pago: true } },
      },
    });
    if (!c) throw new NotFoundException('Compra no encontrada');
    return c;
  }

  /** La gracia solo se puede cambiar mientras el cronograma no se haya empezado a usar. */
  private motivoNoEditable(c: { cuotas: { estado: string; estadoCuentaId: bigint | null }[] }): string | null {
    if (c.cuotas.some((q) => q.estado === 'PAGADA')) return 'Ya se pagó una cuota: el cronograma no se puede recalcular';
    if (c.cuotas.some((q) => q.estadoCuentaId)) return 'Las cuotas ya están en un estado de cuenta: el cronograma no se puede recalcular';
    return null;
  }

  /** Cronograma francés de la compra con otros días de gracia (sin guardar). */
  private recalcular(c: Awaited<ReturnType<CronogramaService['cargar']>>, diasGracia: number) {
    return calcularConGracia({
      capital: c.capitalInicial.toString(),
      tasaInteres: c.cliente.tasaInteres.toString(),
      periodoTasa: c.cliente.periodoTasa,
      fecha: fechaDe(c.fechaHora),
      diasGracia,
      nCuotas: c.nCuotas,
    });
  }

  private validarGracia(dias: number) {
    if (!Number.isInteger(dias) || dias < 0 || dias > 90) throw new BadRequestException('Los días de gracia deben ser un entero entre 0 y 90');
  }

  /**
   * Cronograma de pagos de una compra. Con `diasGracia` distinto del guardado devuelve una vista previa
   * (lo que pasaría con esa gracia) sin modificar nada.
   */
  async obtener(tiendaId: bigint, compraId: bigint, diasGracia?: number) {
    const c = await this.cargar(tiendaId, compraId);
    const motivo = this.motivoNoEditable(c);
    const proxima = c.cuotas.find((q) => q.estado === 'PENDIENTE');
    const hoy = parseISO(hoyLimaISO());

    const base = {
      compra: {
        id: c.id,
        estado: c.estado,
        fechaHora: c.fechaHora,
        nCuotas: c.nCuotas,
        cliente: { id: c.cliente.id, nombre: `${c.cliente.nombres} ${c.cliente.apellidos}`, dni: c.cliente.dni },
        fechaCorteCiclo: c.fechaCorteCiclo,
      },
      editable: !motivo,
      motivoNoEditable: motivo,
      proxima: proxima
        ? {
            cuotaId: proxima.id,
            numero: proxima.numero,
            fechaVencimiento: fechaISO(fechaDe(proxima.fechaVencimiento)),
            montoCuota: m2(dec(proxima.montoCuota.toString())),
            diasMoraSugeridos: Math.max(0, dias360(fechaDe(proxima.fechaVencimiento), hoy)),
          }
        : null,
    };

    if (diasGracia !== undefined && diasGracia !== c.diasGracia) {
      this.validarGracia(diasGracia);
      const r = this.recalcular(c, diasGracia);
      return {
        ...base,
        vistaPrevia: true,
        resumen: {
          capitalInicial: m2(r.capitalInicial),
          diasGracia: r.diasGracia,
          fechaFinGracia: fechaISO(r.finGracia),
          tasaGracia: r.tasaGracia.toFixed(12),
          interesGracia: m2(r.interesGracia),
          capitalFinanciado: m2(r.capitalFinanciado),
          temPct: r.tem.times(100).toFixed(7),
          teaPct: r.tea.times(100).toFixed(7),
          cuotaRegular: m2(r.cuotaRegular),
          totalIntereses: m2(r.totalIntereses),
          totalProgramado: m2(r.totalProgramado),
        },
        cuotas: r.cuotas.map((q) => ({
          numero: q.numero,
          fechaVencimiento: fechaISO(q.vencimiento),
          saldoInicial: m2(q.saldoInicial),
          interes: m2(q.interes),
          amortizacion: m2(q.amortizacion),
          montoCuota: m2(q.monto),
          saldoFinal: m2(q.saldoFinal),
          estado: 'PENDIENTE' as const,
          pago: null,
        })),
      };
    }

    const sumaInteres = c.cuotas.reduce((s, q) => s.plus(q.interes.toString()), dec(0));
    return {
      ...base,
      vistaPrevia: false,
      resumen: {
        capitalInicial: m2(dec(c.capitalInicial.toString())),
        diasGracia: c.diasGracia,
        fechaFinGracia: fechaISO(fechaDe(c.fechaFinGracia)),
        tasaGracia: c.tasaGracia.toString(),
        interesGracia: m2(dec(c.interesGracia.toString())),
        capitalFinanciado: m2(dec(c.capitalFinanciado.toString())),
        temPct: dec(c.tem.toString()).times(100).toFixed(7),
        teaPct: c.tea.toString(),
        cuotaRegular: m2(dec(c.cuotaRegular.toString())),
        totalIntereses: m2(dec(c.interesGracia.toString()).plus(sumaInteres)),
        totalProgramado: m2(c.cuotas.reduce((s, q) => s.plus(q.montoCuota.toString()), dec(0))),
      },
      cuotas: c.cuotas.map((q) => ({
        numero: q.numero,
        fechaVencimiento: fechaISO(fechaDe(q.fechaVencimiento)),
        saldoInicial: m2(dec(q.saldoInicial.toString())),
        interes: m2(dec(q.interes.toString())),
        amortizacion: m2(dec(q.amortizacion.toString())),
        montoCuota: m2(dec(q.montoCuota.toString())),
        saldoFinal: m2(dec(q.saldoFinal.toString())),
        estado: q.estado,
        pago: q.pago && {
          fechaPagoReal: fechaISO(fechaDe(q.pago.fechaPagoReal)),
          diasMora: q.pago.diasMora,
          montoMora: q.pago.montoMora.toString(),
          montoTotal: q.pago.montoTotal.toString(),
          medioPago: q.pago.medioPago,
        },
      })),
    };
  }

  /** Guarda los días de gracia y recalcula el cronograma (si aún no se usó). */
  async cambiarGracia(tiendaId: bigint, compraId: bigint, diasGracia: number) {
    this.validarGracia(diasGracia);
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM compra WHERE id = ${compraId} AND tienda_id = ${tiendaId} FOR UPDATE`;
      const c = await tx.compra.findFirst({
        where: { id: compraId, tiendaId },
        include: { cliente: true, cuotas: { orderBy: { numero: 'asc' } } },
      });
      if (!c) throw new NotFoundException('Compra no encontrada');
      const motivo = this.motivoNoEditable(c);
      if (motivo) throw new ConflictException(motivo);
      if (diasGracia === c.diasGracia) return;

      const r = this.recalcular(c as any, diasGracia);
      // El capital financiado crece con la gracia: no puede pasarse del límite del cliente.
      const deudaOtras = (await deudaPendiente(tx, c.clienteId)).minus(c.capitalFinanciado.toString());
      const disponible = dec(c.cliente.limiteCredito.toString()).minus(deudaOtras);
      if (r.capitalFinanciado.gt(disponible)) {
        throw new BadRequestException(
          `Con ${diasGracia} días de gracia el capital financiado (${m2(r.capitalFinanciado)}) excede el crédito disponible (${m2(disponible)})`,
        );
      }
      await tx.compra.update({
        where: { id: compraId },
        data: {
          diasGracia,
          fechaFinGracia: aDate(r.finGracia),
          tasaGracia: r.tasaGracia.toFixed(12),
          interesGracia: m2(r.interesGracia),
          capitalFinanciado: m2(r.capitalFinanciado),
          cuotaRegular: m2(r.cuotaRegular),
        },
      });
      for (const q of r.cuotas) {
        await tx.cuota.update({
          where: { compraId_numero: { compraId, numero: q.numero } },
          data: {
            fechaVencimiento: aDate(q.vencimiento),
            saldoInicial: m2(q.saldoInicial),
            interes: m2(q.interes),
            amortizacion: m2(q.amortizacion),
            montoCuota: m2(q.monto),
            saldoFinal: m2(q.saldoFinal),
          },
        });
      }
    });
    return this.obtener(tiendaId, compraId);
  }

  // ---------------------------------------------------------------- pago de la próxima cuota

  private calcularProxima(c: Awaited<ReturnType<CronogramaService['cargar']>>, diasMora?: number, fechaPagoReal?: string) {
    const cuota = c.cuotas.find((q) => q.estado === 'PENDIENTE');
    if (!cuota) throw new ConflictException('La compra no tiene cuotas pendientes');
    const real = parseISO(fechaPagoReal ?? hoyLimaISO());
    const venc = fechaDe(cuota.fechaVencimiento);
    if (diasMora !== undefined && (!Number.isInteger(diasMora) || diasMora < 0 || diasMora > 3650)) {
      throw new BadRequestException('Los días de mora deben ser un entero entre 0 y 3650');
    }
    const r = calcularPago(
      [{ vencimiento: venc, interes: dec(cuota.interes.toString()), amortizacion: dec(cuota.amortizacion.toString()) }],
      venc,
      real,
      c.cliente.tasaMora.toString(),
      c.cliente.periodoTasaMora,
      diasMora,
    );
    return { cuota, r, real, venc };
  }

  /** Vista previa del pago de la próxima cuota con los días de mora indicados (o los de hoy). */
  async previsualizarPago(tiendaId: bigint, compraId: bigint, diasMora?: number) {
    const c = await this.cargar(tiendaId, compraId);
    const { cuota, r, venc } = this.calcularProxima(c, diasMora);
    return {
      cuotaId: cuota.id,
      numero: cuota.numero,
      nCuotas: c.nCuotas,
      fechaVencimiento: fechaISO(venc),
      diasMoraSugeridos: Math.max(0, dias360(venc, parseISO(hoyLimaISO()))),
      diasMora: r.diasMora,
      tasaMoraPeriodoPct: r.tasaMoraPeriodo.times(100).toFixed(7),
      capital: m2(r.totalCapital),
      intereses: m2(r.totalInteresesCuotas),
      mora: m2(r.interesesMora),
      totalPagar: m2(r.totalPagar),
      /** Prelación: mora → intereses → capital. */
      imputacion: { mora: m2(r.interesesMora), intereses: m2(r.totalInteresesCuotas), capital: m2(r.totalCapital) },
    };
  }

  /** Paga la próxima cuota pendiente completa (sin pagos parciales) y una sola vez. */
  async pagar(
    tiendaId: bigint,
    compraId: bigint,
    d: { numeroCuota: number; medioPago: MedioPago; montoPagado: number; diasMora?: number; fechaPagoReal?: string },
  ) {
    if (d.fechaPagoReal && !fechaISOValida(d.fechaPagoReal)) throw new BadRequestException('fechaPagoReal debe ser una fecha YYYY-MM-DD válida');
    try {
      await this.prisma.$transaction(async (tx) => {
        // Bloquea la compra: dos pagos simultáneos no pueden cancelar la misma cuota dos veces.
        await tx.$queryRaw`SELECT id FROM compra WHERE id = ${compraId} AND tienda_id = ${tiendaId} FOR UPDATE`;
        const c = await tx.compra.findFirst({
          where: { id: compraId, tiendaId },
          include: { cliente: true, cuotas: { orderBy: { numero: 'asc' }, include: { pago: true } } },
        });
        if (!c) throw new NotFoundException('Compra no encontrada');
        const { cuota, r, real } = this.calcularProxima(c as any, d.diasMora, d.fechaPagoReal);
        // Evita pagar dos cuotas por un doble clic: solo se paga la cuota que el usuario estaba viendo.
        if (cuota.numero !== d.numeroCuota) {
          throw new ConflictException(`La cuota ${d.numeroCuota} ya fue pagada o no es la próxima a pagar (ahora toca la ${cuota.numero})`);
        }
        if (cmpFecha(real, fechaDe(c.fechaHora)) < 0) throw new BadRequestException('La fecha de pago no puede ser anterior a la compra');
        if (!dec(d.montoPagado).eq(r.totalPagar)) {
          throw new BadRequestException(
            `El pago debe ser exactamente ${m2(r.totalPagar)} (cuota completa, sin pagos parciales); se recibió ${m2(dec(d.montoPagado))}`,
          );
        }
        await tx.pago.create({
          data: {
            cuotaId: cuota.id,
            fechaPagoReal: aDate(real),
            diasMora: r.diasMora,
            tasaMoraPeriodo: r.diasMora > 0 ? r.tasaMoraPeriodo.toFixed(12) : null,
            montoMora: m2(r.interesesMora),
            montoInteres: m2(r.totalInteresesCuotas),
            montoCapital: m2(r.totalCapital),
            montoTotal: m2(r.totalPagar),
            medioPago: d.medioPago,
          },
        });
        await tx.cuota.update({ where: { id: cuota.id }, data: { estado: 'PAGADA' } });
        // En el estado de cuenta la mora aparece como ítem separado "intereses por mora".
        if (cuota.estadoCuentaId && r.interesesMora.gt(0)) {
          await tx.estadoCuentaItem.create({
            data: {
              estadoCuentaId: cuota.estadoCuentaId,
              cuotaId: cuota.id,
              tipo: 'MORA',
              fecha: aDate(real),
              descripcion: `Intereses por mora - compra #${compraId} cuota ${cuota.numero}/${c.nCuotas}`,
              capital: '0.00',
              dias: r.diasMora,
              tasaPeriodo: r.tasaMoraPeriodo.toFixed(12),
              interes: m2(r.interesesMora),
              subtotal: m2(r.interesesMora),
            },
          });
        }
        await refrescarEstado(tx, cuota.estadoCuentaId);
        if (!c.cuotas.some((q) => q.estado === 'PENDIENTE' && q.id !== cuota.id)) {
          await tx.compra.update({ where: { id: compraId }, data: { estado: 'CANCELADA' } });
        }
      });
    } catch (e: any) {
      if (e?.code === 'P2002') throw new ConflictException('La cuota ya fue pagada');
      throw e;
    }
    return this.obtener(tiendaId, compraId);
  }
}
