import { BadRequestException, Injectable } from '@nestjs/common';
import { Moneda } from '@prisma/client';
import { fechaUTC } from '../common/parse-bigint.pipe';
import { PrismaService } from '../common/prisma.service';
import { dec } from '../finanzas';

export interface Topes {
  /** % TEA máxima de interés compensatorio vigente. */
  topeInteresTEA: string;
  /** % TEA máxima de interés moratorio vigente. */
  topeMoraTEA: string;
}

const hoyUTC = () => fechaUTC(new Date().toISOString().slice(0, 10));

@Injectable()
export class ParametrosService {
  constructor(private readonly prisma: PrismaService) {}

  async listar(moneda?: Moneda) {
    const hoy = hoyUTC();
    const filas = await this.prisma.parametro.findMany({
      where: moneda ? { moneda } : {},
      orderBy: [{ moneda: 'asc' }, { clave: 'asc' }, { vigenteDesde: 'desc' }],
    });
    return filas.map((f) => ({
      ...f,
      vigente: f.vigenteDesde <= hoy && (!f.vigenteHasta || f.vigenteHasta >= hoy),
    }));
  }

  /** Topes BCRP vigentes para la moneda en la fecha dada (por defecto hoy). */
  async topes(moneda: Moneda, fecha: Date = hoyUTC()): Promise<Topes> {
    const filas = await this.prisma.parametro.findMany({
      where: {
        moneda,
        clave: { in: ['topeInteresTEA', 'topeMoraTEA'] },
        vigenteDesde: { lte: fecha },
        OR: [{ vigenteHasta: null }, { vigenteHasta: { gte: fecha } }],
      },
      orderBy: { vigenteDesde: 'desc' },
    });
    const valor = (clave: string) => filas.find((f) => f.clave === clave)?.valor;
    const topeInteresTEA = valor('topeInteresTEA');
    const topeMoraTEA = valor('topeMoraTEA');
    if (!topeInteresTEA || !topeMoraTEA) {
      throw new BadRequestException(`No hay topes BCRP vigentes configurados para ${moneda}`);
    }
    return { topeInteresTEA, topeMoraTEA };
  }

  /**
   * Registra una nueva vigencia de topes. Cierra la vigencia abierta anterior
   * un día antes de `vigenteDesde`. Si no se da topeMoraTEA se usa 0.15 × topeInteresTEA
   * (Circular BCRP 0008-2021).
   */
  async fijarTopes(d: { moneda: Moneda; topeInteresTEA: number; topeMoraTEA?: number; vigenteDesde: string }) {
    const desde = fechaUTC(d.vigenteDesde);
    if (Number.isNaN(desde.getTime())) throw new BadRequestException('vigenteDesde no es una fecha válida');
    const cierre = new Date(desde.getTime() - 86_400_000);
    const interes = dec(d.topeInteresTEA);
    const mora = d.topeMoraTEA !== undefined ? dec(d.topeMoraTEA) : interes.times('0.15');
    const filas: [string, string][] = [
      ['topeInteresTEA', interes.toDecimalPlaces(7).toString()],
      ['topeMoraTEA', mora.toDecimalPlaces(7).toString()],
    ];
    await this.prisma.$transaction(async (tx) => {
      for (const [clave, valor] of filas) {
        await tx.parametro.updateMany({
          where: { clave, moneda: d.moneda, vigenteHasta: null, vigenteDesde: { lt: desde } },
          data: { vigenteHasta: cierre },
        });
        await tx.parametro.upsert({
          where: { clave_moneda_vigenteDesde: { clave, moneda: d.moneda, vigenteDesde: desde } },
          update: { valor, vigenteHasta: null },
          create: { clave, moneda: d.moneda, valor, vigenteDesde: desde },
        });
      }
    });
    return this.listar(d.moneda);
  }
}
