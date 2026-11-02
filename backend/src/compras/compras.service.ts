import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import Decimal from 'decimal.js';
import { PrismaService } from '../common/prisma.service';
import { Fecha, calcularCompra, dec, fechaISO, maxCuotasPermitidas, parseISO } from '../finanzas';

type Db = PrismaService | Prisma.TransactionClient;

export interface EntradaCompraDto {
  clienteId: bigint;
  /** "YYYY-MM-DDTHH:mm" o "YYYY-MM-DD HH:mm" (hora de Lima). Si falta, se usa el momento actual. */
  fechaHora?: string;
  items: { codigoProducto: string; cantidad: number }[];
  nCuotas: number;
}

const ahoraLima = (): string => new Date(Date.now() - 5 * 3_600_000).toISOString().slice(0, 16);
const m2 = (x: Decimal) => x.toFixed(2);
const horaHHmm = (d: Date) => d.toISOString().slice(11, 16);
/** Las columnas DATETIME/DATE guardan la hora de pared de Lima tal cual (como UTC), sin conversiones. */
const aUTC = (f: Fecha, hhmm = '00:00') => new Date(`${fechaISO(f)}T${hhmm}:00Z`);

export const fechaHoraValida = (s: string): boolean => {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})$/.exec(s);
  if (!m) return false;
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  const t = new Date(Date.UTC(y, mo - 1, d, h, mi));
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d && h < 24 && mi < 60;
};

/** deudaPendiente = Σ capitalFinanciado de las compras − Σ amortizaciones pagadas (sin intereses futuros ni mora). */
export async function deudaPendiente(db: Db, clienteId: bigint): Promise<Decimal> {
  const [compras, pagado] = await Promise.all([
    db.compra.aggregate({ _sum: { capitalFinanciado: true }, where: { clienteId } }),
    db.cuota.aggregate({ _sum: { amortizacion: true }, where: { estado: 'PAGADA', compra: { clienteId } } }),
  ]);
  return dec(compras._sum.capitalFinanciado?.toString() ?? 0).minus(pagado._sum.amortizacion?.toString() ?? 0);
}

@Injectable()
export class ComprasService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Calcula la compra y aplica todas las reglas de negocio sin guardar nada.
   * Las violaciones de regla se devuelven en `errores` (la simulación las muestra; el registro las rechaza).
   */
  async evaluar(db: Db, tiendaId: bigint, d: EntradaCompraDto) {
    const errores: string[] = [];
    const fechaHora = d.fechaHora ?? ahoraLima();
    if (!fechaHoraValida(fechaHora)) throw new BadRequestException('fechaHora debe ser YYYY-MM-DDTHH:mm');

    const tienda = await db.tienda.findUnique({ where: { id: tiendaId } });
    if (tienda?.estado !== 'ACTIVA') errores.push('La tienda está dada de baja: no se permiten compras nuevas');

    const cliente = await db.cliente.findFirst({ where: { id: d.clienteId, tiendaId } });
    if (!cliente) throw new NotFoundException('Cliente no encontrado');
    if (cliente.estado !== 'ACTIVO') errores.push('El cliente está inactivo');
    if (!cliente.aceptaPrivacidad) errores.push('El cliente no aceptó la política de privacidad');

    // --- Productos ---
    const codigos = [...new Set(d.items.map((i) => i.codigoProducto))];
    const productos = await db.producto.findMany({ where: { tiendaId, codigo: { in: codigos } } });
    const porCodigo = new Map(productos.map((p) => [p.codigo, p]));
    for (const c of codigos) {
      const p = porCodigo.get(c);
      if (!p) errores.push(`El producto ${c} no existe`);
      else {
        if (p.estado !== 'ACTIVO') errores.push(`El producto ${c} está inactivo`);
        if (!p.permiteCredito) errores.push(`El producto ${c} no se vende al crédito`);
        if (p.monedaPrecio !== cliente.moneda) {
          errores.push(`El producto ${c} está en ${p.monedaPrecio} y el cliente opera en ${cliente.moneda}`);
        }
      }
    }
    const completos = codigos.every((c) => porCodigo.has(c));

    const maxCuotas = maxCuotasPermitidas(
      cliente.maxCuotas,
      productos.map((p) => p.maxCuotasProducto),
    );
    if (d.nCuotas < 1 || d.nCuotas > maxCuotas) {
      errores.push(`El número de cuotas debe estar entre 1 y ${maxCuotas} (límite del cliente y de los productos)`);
    }

    const deuda = await deudaPendiente(db, cliente.id);
    const disponibleAntes = dec(cliente.limiteCredito.toString()).minus(deuda);

    const base = {
      cliente: { id: cliente.id, nombre: `${cliente.nombres} ${cliente.apellidos}`, moneda: cliente.moneda },
      fechaHora,
      nCuotas: d.nCuotas,
      maxCuotasPermitidas: maxCuotas,
      limiteCredito: m2(dec(cliente.limiteCredito.toString())),
      deudaPendiente: m2(deuda),
      creditoDisponibleAntes: m2(disponibleAntes),
    };
    if (!completos || d.nCuotas < 1) return { valido: false, errores, ...base, calculo: null, interno: null };

    // --- Cálculo financiero (precio de contado vigente al momento de la compra) ---
    const [fecha, hora] = [parseISO(fechaHora), fechaHora.slice(11, 16)];
    const calculo = calcularCompra({
      cliente: {
        tasaInteres: cliente.tasaInteres.toString(),
        periodoTasa: cliente.periodoTasa,
        diaCorte: cliente.diaCorte,
        horaCorte: horaHHmm(cliente.horaCorte),
        diaPago: cliente.diaPago,
      },
      fecha,
      hora,
      items: d.items.map((i) => ({ cantidad: i.cantidad, precioContado: porCodigo.get(i.codigoProducto)!.precioContado.toString() })),
      nCuotas: Math.max(d.nCuotas, 1),
    });

    if (calculo.capitalFinanciado.gt(disponibleAntes)) {
      errores.push(
        `La compra (${m2(calculo.capitalFinanciado)}) excede el crédito disponible (${m2(disponibleAntes)})`,
      );
    }

    const respuesta = {
      valido: errores.length === 0,
      errores,
      ...base,
      calculo: {
        items: d.items.map((i, k) => {
          const p = porCodigo.get(i.codigoProducto)!;
          return {
            codigoProducto: p.codigo,
            descripcion: p.descripcion,
            cantidad: i.cantidad,
            precioUnitarioAplicado: m2(dec(p.precioContado.toString())),
            subtotal: m2(calculo.subtotales[k]),
          };
        }),
        capitalInicial: m2(calculo.capitalInicial),
        fechaCorteCiclo: fechaISO(calculo.corte),
        fechaFinGracia: fechaISO(calculo.finGracia),
        diasGracia: calculo.diasGracia,
        tasaGracia: calculo.tasaGracia.toFixed(12),
        interesGracia: m2(calculo.interesGracia),
        capitalFinanciado: m2(calculo.capitalFinanciado),
        tem: calculo.tem.toFixed(12),
        temPct: calculo.tem.times(100).toFixed(7),
        teaPct: calculo.tea.times(100).toFixed(7),
        cuotaRegular: m2(calculo.cuotaRegular),
        cuotas: calculo.cuotas.map((c) => ({
          numero: c.numero,
          fechaVencimiento: fechaISO(c.vencimiento),
          saldoInicial: m2(c.saldoInicial),
          interes: m2(c.interes),
          amortizacion: m2(c.amortizacion),
          montoCuota: m2(c.monto),
          saldoFinal: m2(c.saldoFinal),
        })),
        totalIntereses: m2(calculo.totalIntereses),
        totalProgramado: m2(calculo.totalProgramado),
        creditoDisponibleDespues: m2(disponibleAntes.minus(calculo.capitalFinanciado)),
      },
    };
    return { ...respuesta, interno: { calculo, cliente, porCodigo, horaCorte: horaHHmm(cliente.horaCorte) } };
  }

  /** Simulación en vivo para el formulario "Nueva compra al crédito": no guarda nada. */
  async simular(tiendaId: bigint, d: EntradaCompraDto) {
    const { interno, ...r } = await this.evaluar(this.prisma, tiendaId, d);
    return r;
  }

  async registrar(tiendaId: bigint, d: EntradaCompraDto) {
    const id = await this.prisma.$transaction(async (tx) => {
      // Bloquea la fila del cliente: dos compras simultáneas no pueden pasarse del límite.
      await tx.$queryRaw`SELECT id FROM cliente WHERE id = ${d.clienteId} AND tienda_id = ${tiendaId} FOR UPDATE`;
      const ev = await this.evaluar(tx, tiendaId, d);
      if (!ev.valido || !ev.interno) throw new BadRequestException(ev.errores);
      const { calculo: c, cliente, porCodigo } = ev.interno;

      const compra = await tx.compra.create({
        data: {
          tiendaId,
          clienteId: cliente.id,
          fechaHora: new Date(`${ev.fechaHora.slice(0, 10)}T${ev.fechaHora.slice(11, 16)}:00Z`),
          capitalInicial: m2(c.capitalInicial),
          nCuotas: d.nCuotas,
          fechaCorteCiclo: aUTC(c.corte, ev.interno.horaCorte),
          fechaFinGracia: aUTC(c.finGracia),
          diasGracia: c.diasGracia,
          tasaGracia: c.tasaGracia.toFixed(12),
          interesGracia: m2(c.interesGracia),
          capitalFinanciado: m2(c.capitalFinanciado),
          tem: c.tem.toFixed(12),
          cuotaRegular: m2(c.cuotaRegular),
          tea: c.tea.times(100).toFixed(7),
          detalles: {
            create: d.items.map((i, k) => {
              const p = porCodigo.get(i.codigoProducto)!;
              return {
                productoId: p.id,
                cantidad: i.cantidad,
                precioUnitarioAplicado: p.precioContado,
                subtotal: m2(c.subtotales[k]),
              };
            }),
          },
          cuotas: {
            create: c.cuotas.map((q) => ({
              numero: q.numero,
              fechaVencimiento: aUTC(q.vencimiento),
              saldoInicial: m2(q.saldoInicial),
              interes: m2(q.interes),
              amortizacion: m2(q.amortizacion),
              montoCuota: m2(q.monto),
              saldoFinal: m2(q.saldoFinal),
            })),
          },
        },
      });
      return compra.id;
    });
    return this.obtener({ tiendaId }, id);
  }

  /** Alcance de consulta: el administrador ve la tienda; el cliente solo sus compras. */
  private alcance(a: { tiendaId: bigint; clienteId?: bigint | null }): Prisma.CompraWhereInput {
    return { tiendaId: a.tiendaId, ...(a.clienteId ? { clienteId: a.clienteId } : {}) };
  }

  listar(a: { tiendaId: bigint; clienteId?: bigint | null }, filtroCliente?: bigint) {
    return this.prisma.compra.findMany({
      where: { ...this.alcance(a), ...(filtroCliente && !a.clienteId ? { clienteId: filtroCliente } : {}) },
      orderBy: [{ fechaHora: 'desc' }, { id: 'desc' }],
      include: { cliente: { select: { id: true, dni: true, nombres: true, apellidos: true } } },
    });
  }

  async obtener(a: { tiendaId: bigint; clienteId?: bigint | null }, id: bigint) {
    const c = await this.prisma.compra.findFirst({
      where: { id, ...this.alcance(a) },
      include: {
        cliente: { select: { id: true, dni: true, nombres: true, apellidos: true } },
        detalles: { include: { producto: { select: { codigo: true, descripcion: true, unidadMedida: true } } } },
        cuotas: { orderBy: { numero: 'asc' } },
      },
    });
    if (!c) throw new NotFoundException('Compra no encontrada');
    return c;
  }

  /** Situación de crédito del cliente: límite, deuda (solo capital) y disponible. */
  async credito(tiendaId: bigint, clienteId: bigint) {
    const cliente = await this.prisma.cliente.findFirst({ where: { id: clienteId, tiendaId } });
    if (!cliente) throw new NotFoundException('Cliente no encontrado');
    const deuda = await deudaPendiente(this.prisma, clienteId);
    const limite = dec(cliente.limiteCredito.toString());
    return {
      clienteId,
      limiteCredito: m2(limite),
      deudaPendiente: m2(deuda),
      creditoDisponible: m2(limite.minus(deuda)),
    };
  }
}
