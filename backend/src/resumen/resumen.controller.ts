import { Controller, Get } from '@nestjs/common';
import { CurrentUser, Roles, UsuarioActual } from '../common/decorators';
import { ResumenService } from './resumen.service';

@Controller('resumen')
export class ResumenController {
  constructor(private readonly svc: ResumenService) {}

  /** Dashboard: el administrador ve su tienda; el cliente, solo lo suyo. */
  @Get()
  @Roles('ADMIN_NEGOCIO', 'CLIENTE')
  obtener(@CurrentUser() u: UsuarioActual) {
    return this.svc.obtener({ tiendaId: u.tiendaId!, clienteId: u.clienteId });
  }
}
