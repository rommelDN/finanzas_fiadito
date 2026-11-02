import { Controller, Get } from '@nestjs/common';
import { CurrentUser, Roles, UsuarioActual } from '../common/decorators';
import { ResumenService } from './resumen.service';

@Controller('resumen')
export class ResumenController {
  constructor(private readonly svc: ResumenService) {}

  /** Dashboard de la tienda. */
  @Get()
  @Roles('ADMIN_NEGOCIO')
  obtener(@CurrentUser() u: UsuarioActual) {
    return this.svc.obtener({ tiendaId: u.tiendaId! });
  }
}
