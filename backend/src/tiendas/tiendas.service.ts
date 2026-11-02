import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { EstadoTienda } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../common/prisma.service';

export interface DatosTienda {
  razonSocial?: string;
  nombreComercial?: string;
  giroNegocio?: string;
  direccion?: string;
}

const conAdmins = {
  usuarios: {
    where: { rol: 'ADMIN_NEGOCIO' as const },
    select: { id: true, username: true, nombre: true, estado: true },
  },
};

@Injectable()
export class TiendasService {
  constructor(private readonly prisma: PrismaService) {}

  listar() {
    return this.prisma.tienda.findMany({ orderBy: { id: 'asc' }, include: conAdmins });
  }

  async obtener(id: bigint) {
    const t = await this.prisma.tienda.findUnique({ where: { id }, include: conAdmins });
    if (!t) throw new NotFoundException('Tienda no encontrada');
    return t;
  }

  /** Alta de tienda junto con su administrador de negocio (credenciales). */
  async crear(
    d: Required<DatosTienda> & { ruc: string; admin: { username: string; password: string; nombre: string } },
  ) {
    if (await this.prisma.tienda.findUnique({ where: { ruc: d.ruc } })) {
      throw new ConflictException('Ya existe una tienda con ese RUC');
    }
    if (await this.prisma.usuario.findUnique({ where: { username: d.admin.username } })) {
      throw new ConflictException('El nombre de usuario ya está en uso');
    }
    const passwordHash = await bcrypt.hash(d.admin.password, 10);
    return this.prisma.tienda.create({
      data: {
        ruc: d.ruc,
        razonSocial: d.razonSocial,
        nombreComercial: d.nombreComercial,
        giroNegocio: d.giroNegocio,
        direccion: d.direccion,
        usuarios: {
          create: { username: d.admin.username, passwordHash, nombre: d.admin.nombre, rol: 'ADMIN_NEGOCIO' },
        },
      },
      include: conAdmins,
    });
  }

  async actualizar(id: bigint, d: DatosTienda & { estado?: EstadoTienda }) {
    await this.obtener(id);
    return this.prisma.tienda.update({ where: { id }, data: d, include: conAdmins });
  }

  /** Baja lógica: conserva el historial y bloquea compras nuevas. */
  baja(id: bigint) {
    return this.actualizar(id, { estado: 'INACTIVA' });
  }
}
