import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { hoyLimaISO } from '../common/lima';
import { PrismaService } from '../common/prisma.service';
import { dec } from '../finanzas';

type Alcance = { tiendaId: bigint };
const m2 = (x: { toFixed(n: number): string }) => x.toFixed(2);
const dia = (d: Date) => d.toISOString().slice(0, 10);

/** Datos del Inicio (dashboard): deuda por cobrar, crédito disponible, próximo vencimiento y mora. */
@Injectable()
export class ResumenService {
  constructor(private readonly prisma: PrismaService) {}

  async obtener(a: Alcance) {
    const hoy = new Date(`${hoyLimaISO()}T00:00:00Z`);
    const filtroCompra = { tiendaId: a.tiendaId };
    const filtroCuota = { compra: filtroCompra, estado: 'PENDIENTE' as const };

    const [clientes, financiado, pagado, proximas, vencidas, recientes] = await Promise.all([
      this.prisma.cliente.findMany({
        where: { tiendaId: a.tiendaId, estado: 'ACTIVO' },
        orderBy: [{ apellidos: 'asc' }, { nombres: 'asc' }],
      }),
      this.prisma.compra.groupBy({ by: ['clienteId'], where: filtroCompra, _sum: { capitalFinanciado: true } }),
      this.prisma.$queryRaw<{ clienteId: bigint; total: Prisma.Decimal }[]>`
        SELECT c.cliente_id AS clienteId, SUM(q.amortizacion) AS total
        FROM cuota q JOIN compra c ON c.id = q.compra_id
        WHERE q.estado = 'PAGADA' AND c.tienda_id = ${a.tiendaId}
        GROUP BY c.cliente_id`,
      this.prisma.cuota.findMany({
        where: { ...filtroCuota, fechaVencimiento: { gte: hoy } },
        orderBy: [{ fechaVencimiento: 'asc' }, { id: 'asc' }],
        include: { compra: { include: { cliente: { select: { id: true, nombres: true, apellidos: true } } } } },
      }),
      this.prisma.cuota.findMany({
        where: { ...filtroCuota, fechaVencimiento: { lt: hoy } },
        orderBy: { fechaVencimiento: 'asc' },
        include: { compra: { include: { cliente: { select: { id: true, nombres: true, apellidos: true } } } } },
      }),
      this.prisma.compra.findMany({
        where: filtroCompra,
        orderBy: [{ fechaHora: 'desc' }, { id: 'desc' }],
        take: 6,
        include: { cliente: { select: { id: true, nombres: true, apellidos: true } } },
      }),
    ]);

    const fin = new Map(financiado.map((f) => [f.clienteId.toString(), dec(f._sum.capitalFinanciado?.toString() ?? 0)]));
    const pag = new Map(pagado.map((p) => [p.clienteId.toString(), dec(p.total.toString())]));
    const vencidoPor = new Map<string, ReturnType<typeof dec>>();
    for (const q of vencidas) {
      const k = q.compra.clienteId.toString();
      vencidoPor.set(k, (vencidoPor.get(k) ?? dec(0)).plus(q.montoCuota.toString()));
    }

    const filas = clientes.map((c) => {
      const deuda = (fin.get(c.id.toString()) ?? dec(0)).minus(pag.get(c.id.toString()) ?? dec(0));
      const limite = dec(c.limiteCredito.toString());
      const mora = vencidoPor.get(c.id.toString());
      return {
        id: c.id,
        nombre: `${c.nombres} ${c.apellidos}`,
        limiteCredito: m2(limite),
        deudaPendiente: m2(deuda),
        creditoDisponible: m2(limite.minus(deuda)),
        montoVencido: mora ? m2(mora) : '0.00',
        enMora: !!mora,
      };
    });
    const suma = (k: 'limiteCredito' | 'deudaPendiente' | 'creditoDisponible' | 'montoVencido') =>
      filas.reduce((s, f) => s.plus(f[k]), dec(0));

    // Próximo día de pago: todas las cuotas que vencen en la fecha más cercana.
    const primera = proximas[0]?.fechaVencimiento;
    const delDia = primera ? proximas.filter((q) => +q.fechaVencimiento === +primera) : [];

    const quien = (q: (typeof proximas)[number]) => ({
      cuotaId: q.id,
      compraId: q.compraId,
      clienteId: q.compra.clienteId,
      cliente: `${q.compra.cliente.nombres} ${q.compra.cliente.apellidos}`,
      numero: q.numero,
      nCuotas: q.compra.nCuotas,
      fechaVencimiento: dia(q.fechaVencimiento),
      montoCuota: q.montoCuota,
    });

    return {
      fecha: dia(hoy),
      totales: {
        clientes: filas.length,
        limiteCredito: m2(suma('limiteCredito')),
        deudaPendiente: m2(suma('deudaPendiente')),
        creditoDisponible: m2(suma('creditoDisponible')),
      },
      proximoVencimiento: primera
        ? { fecha: dia(primera), cuotas: delDia.length, total: m2(delDia.reduce((s, q) => s.plus(q.montoCuota.toString()), dec(0))) }
        : null,
      enMora: {
        clientes: vencidoPor.size,
        cuotas: vencidas.length,
        monto: m2(suma('montoVencido')),
      },
      clientes: filas,
      proximosVencimientos: proximas.slice(0, 8).map(quien),
      cuotasVencidas: vencidas.slice(0, 8).map(quien),
      comprasRecientes: recientes.map((c) => ({
        id: c.id,
        clienteId: c.clienteId,
        cliente: `${c.cliente.nombres} ${c.cliente.apellidos}`,
        fechaHora: c.fechaHora,
        nCuotas: c.nCuotas,
        capitalInicial: c.capitalInicial,
        capitalFinanciado: c.capitalFinanciado,
      })),
    };
  }
}
