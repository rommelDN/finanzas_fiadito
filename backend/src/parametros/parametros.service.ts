import { BadRequestException, Injectable } from '@nestjs/common';
import { fechaUTC } from '../common/parse-bigint.pipe';
import { PrismaService } from '../common/prisma.service';
import { dec } from '../finanzas';

/** Límites propios de los créditos de tienda de barrio (no se configuran: son del alcance del proyecto). */
export const LIMITE_MAXIMO_CREDITO = 250;
export const MAX_CUOTAS = 12;

export interface Topes {
  /** % TEA máxima de interés compensatorio vigente. */
  topeInteresTEA: string;
  /** % TEA máxima de interés moratorio vigente. */
  topeMoraTEA: string;
}

const hoyUTC = () => fechaUTC(new Date(Date.now() - 5 * 3_600_000).toISOString().slice(0, 10));

@Injectable()
export class ParametrosService {
  constructor(private readonly prisma: PrismaService) {}

  async listar() {
    const hoy = hoyUTC();
    const filas = await this.prisma.parametro.findMany({ orderBy: [{ clave: 'asc' }, { vigenteDesde: 'desc' }] });
    return filas.map((f) => ({
      ...f,
      vigente: f.vigenteDesde <= hoy && (!f.vigenteHasta || f.vigenteHasta >= hoy),
    }));
  }

  /** Topes de TEA vigentes en la fecha dada (por defecto hoy). */
  async topes(fecha: Date = hoyUTC()): Promise<Topes> {
    const filas = await this.prisma.parametro.findMany({
      where: {
        clave: { in: ['topeInteresTEA', 'topeMoraTEA'] },
        vigenteDesde: { lte: fecha },
        OR: [{ vigenteHasta: null }, { vigenteHasta: { gte: fecha } }],
      },
      orderBy: { vigenteDesde: 'desc' },
    });
    const valor = (clave: string) => filas.find((f) => f.clave === clave)?.valor;
    const topeInteresTEA = valor('topeInteresTEA');
    const topeMoraTEA = valor('topeMoraTEA');
    if (!topeInteresTEA || !topeMoraTEA) throw new BadRequestException('No hay topes de TEA vigentes configurados');
    return { topeInteresTEA, topeMoraTEA };
  }

  /**
   * Registra una nueva vigencia de topes. Cierra la vigencia abierta anterior
   * un día antes de `vigenteDesde`.
   */
  async fijarTopes(d: { topeInteresTEA: number; topeMoraTEA: number; vigenteDesde: string }) {
    const desde = fechaUTC(d.vigenteDesde);
    if (Number.isNaN(desde.getTime())) throw new BadRequestException('vigenteDesde no es una fecha válida');
    const cierre = new Date(desde.getTime() - 86_400_000);
    const filas: [string, string][] = [
      ['topeInteresTEA', dec(d.topeInteresTEA).toDecimalPlaces(7).toString()],
      ['topeMoraTEA', dec(d.topeMoraTEA).toDecimalPlaces(7).toString()],
    ];
    await this.prisma.$transaction(async (tx) => {
      for (const [clave, valor] of filas) {
        await tx.parametro.updateMany({
          where: { clave, vigenteHasta: null, vigenteDesde: { lt: desde } },
          data: { vigenteHasta: cierre },
        });
        await tx.parametro.upsert({
          where: { clave_vigenteDesde: { clave, vigenteDesde: desde } },
          update: { valor, vigenteHasta: null },
          create: { clave, valor, vigenteDesde: desde },
        });
      }
    });
    return this.listar();
  }
}
