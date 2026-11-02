import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Cliente, EstadoActivo, Periodo } from '@prisma/client';
import { PrismaService } from '../common/prisma.service';
import { calcularTasas } from '../finanzas';
import { ParametrosService } from '../parametros/parametros.service';

/** Tasas efectivas pactadas (no existe tasa nominal en Fiadito). */
export interface DatosTasas {
  tasaInteres: number | string;
  periodoTasa: Periodo;
  tasaMora: number | string;
  periodoTasaMora: Periodo;
}

export interface DatosCliente extends DatosTasas {
  dni: string;
  nombres: string;
  apellidos: string;
  direccion?: string;
  telefono?: string;
  limiteCredito: number;
  maxCuotas: number;
  diaCorte: number;
  horaCorte: string; // HH:mm
  diaPago: number;
  aceptaPrivacidad: boolean;
  estado?: EstadoActivo;
}

const aHora = (hhmm: string) => new Date(`1970-01-01T${hhmm}:00Z`);
const deHora = (d: Date) => d.toISOString().slice(11, 16);

/** Cliente con sus cálculos de tasas (panel "Lo que calcula la app") y la hora como HH:mm. */
const presentar = (c: Cliente) => ({ ...c, horaCorte: deHora(c.horaCorte), calculos: resumenTasas(c) });

const resumenTasas = (c: DatosTasas | Cliente) => {
  const t = calcularTasas({
    tasaInteres: c.tasaInteres.toString(),
    periodoTasa: c.periodoTasa,
    tasaMora: c.tasaMora.toString(),
    periodoTasaMora: c.periodoTasaMora,
  });
  return {
    p: t.p,
    pMora: t.pMora,
    /** TEM en decimal (ej. 0.0299999). */
    tem: t.tem.toFixed(12),
    temPct: t.tem.times(100).toFixed(7),
    teaInteresPct: t.teaInteres.times(100).toFixed(7),
    teaMoraPct: t.teaMora.times(100).toFixed(7),
  };
};

@Injectable()
export class ClientesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly parametros: ParametrosService,
  ) {}

  /** Valida TEA de interés y de mora contra los topes vigentes. */
  async validarTopes(d: DatosTasas) {
    const calculos = resumenTasas(d);
    const topes = await this.parametros.topes();
    const errores: string[] = [];
    if (Number(calculos.teaInteresPct) > Number(topes.topeInteresTEA)) {
      errores.push(`La TEA de interés (${calculos.teaInteresPct}%) supera el tope de ${topes.topeInteresTEA}%`);
    }
    if (Number(calculos.teaMoraPct) > Number(topes.topeMoraTEA)) {
      errores.push(`La TEA de mora (${calculos.teaMoraPct}%) supera el tope de ${topes.topeMoraTEA}%`);
    }
    return { ok: errores.length === 0, errores, calculos, topes };
  }

  private async exigirTopes(d: DatosTasas) {
    const v = await this.validarTopes(d);
    if (!v.ok) throw new BadRequestException(v.errores);
  }

  async listar(tiendaId: bigint, f: { estado?: EstadoActivo; q?: string }) {
    const q = f.q?.trim();
    const filas = await this.prisma.cliente.findMany({
      where: {
        tiendaId,
        ...(f.estado ? { estado: f.estado } : {}),
        ...(q ? { OR: [{ dni: { contains: q } }, { nombres: { contains: q } }, { apellidos: { contains: q } }] } : {}),
      },
      orderBy: [{ apellidos: 'asc' }, { nombres: 'asc' }],
    });
    return filas.map(presentar);
  }

  async obtener(tiendaId: bigint, id: bigint) {
    const c = await this.prisma.cliente.findFirst({ where: { id, tiendaId } });
    if (!c) throw new NotFoundException('Cliente no encontrado');
    return presentar(c);
  }

  async crear(tiendaId: bigint, d: DatosCliente) {
    if (!d.aceptaPrivacidad) {
      throw new BadRequestException('El cliente debe aceptar la política de privacidad (Ley 29733)');
    }
    if (await this.prisma.cliente.findUnique({ where: { tiendaId_dni: { tiendaId, dni: d.dni } } })) {
      throw new ConflictException('Ya existe un cliente con ese DNI en la tienda');
    }
    await this.exigirTopes(d);
    const { horaCorte, ...resto } = d;
    const creado = await this.prisma.cliente.create({
      data: { ...resto, horaCorte: aHora(horaCorte), tienda: { connect: { id: tiendaId } } },
    });
    return presentar(creado);
  }

  async actualizar(tiendaId: bigint, id: bigint, d: Partial<Omit<DatosCliente, 'dni'>>) {
    const actual = await this.prisma.cliente.findFirst({ where: { id, tiendaId } });
    if (!actual) throw new NotFoundException('Cliente no encontrado');

    const tocaTasas = ['tasaInteres', 'periodoTasa', 'tasaMora', 'periodoTasaMora'].some((k) => (d as any)[k] !== undefined);
    if (tocaTasas) {
      await this.exigirTopes({
        tasaInteres: d.tasaInteres ?? actual.tasaInteres.toString(),
        periodoTasa: d.periodoTasa ?? actual.periodoTasa,
        tasaMora: d.tasaMora ?? actual.tasaMora.toString(),
        periodoTasaMora: d.periodoTasaMora ?? actual.periodoTasaMora,
      });
    }
    const { horaCorte, ...resto } = d;
    const actualizado = await this.prisma.cliente.update({
      where: { id },
      data: { ...resto, ...(horaCorte ? { horaCorte: aHora(horaCorte) } : {}) },
    });
    return presentar(actualizado);
  }

  /** Baja lógica. No se permite si el cliente tiene cuotas pendientes de pago. */
  async baja(tiendaId: bigint, id: bigint) {
    const pendientes = await this.prisma.cuota.count({
      where: { estado: 'PENDIENTE', compra: { clienteId: id, tiendaId } },
    });
    if (pendientes > 0) {
      throw new ConflictException(`No se puede dar de baja: el cliente tiene ${pendientes} cuota(s) pendiente(s)`);
    }
    return this.actualizar(tiendaId, id, { estado: 'INACTIVO' });
  }

  previsualizar(d: DatosTasas) {
    return this.validarTopes(d);
  }
}
