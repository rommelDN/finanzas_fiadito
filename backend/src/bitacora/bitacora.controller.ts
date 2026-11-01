import { Controller, Get, Query } from '@nestjs/common';
import { CurrentUser, Roles, UsuarioActual } from '../common/decorators';
import { PrismaService } from '../common/prisma.service';

@Controller('bitacora')
@Roles('ADMIN_SISTEMA', 'ADMIN_NEGOCIO')
export class BitacoraController {
  constructor(private readonly prisma: PrismaService) {}

  /** ADMIN_SISTEMA ve todo; ADMIN_NEGOCIO solo lo de los usuarios de su tienda. */
  @Get()
  listar(@CurrentUser() u: UsuarioActual, @Query('limit') limit?: string, @Query('entidad') entidad?: string) {
    const take = Math.min(Math.max(parseInt(limit ?? '100', 10) || 100, 1), 500);
    return this.prisma.bitacora.findMany({
      where: {
        ...(entidad ? { entidad } : {}),
        ...(u.rol === 'ADMIN_NEGOCIO' ? { usuario: { tiendaId: u.tiendaId! } } : {}),
      },
      orderBy: { id: 'desc' },
      take,
      include: { usuario: { select: { username: true, nombre: true, rol: true } } },
    });
  }
}
