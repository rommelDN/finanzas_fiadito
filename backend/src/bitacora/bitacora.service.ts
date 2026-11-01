import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma.service';

export interface EntradaBitacora {
  usuarioId?: bigint | null;
  accion: string;
  entidad: string;
  entidadId?: bigint | null;
  detalle?: Prisma.InputJsonValue;
  ip?: string | null;
}

@Injectable()
export class BitacoraService {
  constructor(private readonly prisma: PrismaService) {}

  async registrar(e: EntradaBitacora): Promise<void> {
    await this.prisma.bitacora.create({
      data: {
        usuarioId: e.usuarioId ?? null,
        accion: e.accion.slice(0, 40),
        entidad: e.entidad.slice(0, 40),
        entidadId: e.entidadId ?? null,
        detalleJson: e.detalle,
        ip: e.ip ? e.ip.slice(0, 45) : null,
      },
    });
  }
}
