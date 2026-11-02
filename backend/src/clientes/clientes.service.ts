import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Cliente, EstadoActivo, Moneda, Periodo, Prisma } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../common/prisma.service';
import { calcularTasas } from '../finanzas';
import { ParametrosService } from '../parametros/parametros.service';

export interface DatosTasas {
  moneda: Moneda;
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
  cuenta?: { username: string; password: string };
}

const aHora = (hhmm: string) => new Date(`1970-01-01T${hhmm}:00Z`);
const deHora = (d: Date) => d.toISOString().slice(11, 16);

/** Cliente con sus cálculos de tasas (panel "Lo que calcula la app") y la hora como HH:mm. */
const presentar = (c: Cliente & { usuario?: { username: string } | null }) => ({
  ...c,
  horaCorte: deHora(c.horaCorte),
  cuenta: c.usuario?.username ?? null,
  usuario: undefined,
  calculos: resumenTasas(c),
});

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

  /** Valida TEA de interés y de mora contra los topes BCRP vigentes de la moneda. */
  async validarTopes(d: DatosTasas) {
    const calculos = resumenTasas(d);
    const topes = await this.parametros.topes(d.moneda);
    const errores: string[] = [];
    if (Number(calculos.teaInteresPct) > Number(topes.topeInteresTEA)) {
      errores.push(`La TEA de interés (${calculos.teaInteresPct}%) supera el tope BCRP de ${topes.topeInteresTEA}% para ${d.moneda}`);
    }
    if (Number(calculos.teaMoraPct) > Number(topes.topeMoraTEA)) {
      errores.push(`La TEA de mora (${calculos.teaMoraPct}%) supera el tope BCRP de ${topes.topeMoraTEA}% para ${d.moneda}`);
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
      include: { usuario: { select: { username: true } } },
    });
    return filas.map(presentar);
  }

  async obtener(tiendaId: bigint, id: bigint) {
    const c = await this.prisma.cliente.findFirst({
      where: { id, tiendaId },
      include: { usuario: { select: { username: true } } },
    });
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

    const { cuenta, horaCorte, ...resto } = d;
    let usuario: Prisma.UsuarioCreateNestedOneWithoutClienteInput | undefined;
    if (cuenta) {
      if (await this.prisma.usuario.findUnique({ where: { username: cuenta.username } })) {
        throw new ConflictException('El nombre de usuario ya está en uso');
      }
      usuario = {
        create: {
          username: cuenta.username,
          passwordHash: await bcrypt.hash(cuenta.password, 10),
          nombre: `${d.nombres} ${d.apellidos}`,
          rol: 'CLIENTE',
          tienda: { connect: { id: tiendaId } },
        },
      };
    }
    const creado = await this.prisma.cliente.create({
      data: { ...resto, horaCorte: aHora(horaCorte), tienda: { connect: { id: tiendaId } }, usuario },
      include: { usuario: { select: { username: true } } },
    });
    return presentar(creado);
  }

  async actualizar(tiendaId: bigint, id: bigint, d: Partial<Omit<DatosCliente, 'cuenta' | 'dni'>>) {
    const actual = await this.prisma.cliente.findFirst({ where: { id, tiendaId } });
    if (!actual) throw new NotFoundException('Cliente no encontrado');

    const tocaTasas = ['moneda', 'tasaInteres', 'periodoTasa', 'tasaMora', 'periodoTasaMora'].some((k) => (d as any)[k] !== undefined);
    if (tocaTasas) {
      await this.exigirTopes({
        moneda: d.moneda ?? actual.moneda,
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
      include: { usuario: { select: { username: true } } },
    });
    // La cuenta de acceso sigue el estado del cliente: un cliente dado de baja no puede entrar.
    if (d.estado && actual.usuarioId) {
      await this.prisma.usuario.update({
        where: { id: actual.usuarioId },
        data: { estado: d.estado === 'ACTIVO' ? 'ACTIVO' : 'INACTIVO' },
      });
    }
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

  /** Datos del propio cliente (rol CLIENTE). */
  async propio(tiendaId: bigint, clienteId: bigint) {
    return this.obtener(tiendaId, clienteId);
  }

  previsualizar(d: DatosTasas) {
    return this.validarTopes(d);
  }
}
