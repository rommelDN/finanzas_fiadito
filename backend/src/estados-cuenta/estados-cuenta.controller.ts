import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { Matches } from 'class-validator';
import { CurrentUser, Roles, UsuarioActual } from '../common/decorators';
import { ParseBigIntPipe } from '../common/parse-bigint.pipe';
import { EstadosCuentaService } from './estados-cuenta.service';

class GenerarDto {
  @Matches(/^\d{1,18}$/, { message: 'clienteId inválido' }) clienteId: string;
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'fechaCorte debe ser YYYY-MM-DD' }) fechaCorte: string;
}

const idONada = (s?: string) => (s && /^\d{1,18}$/.test(s) ? BigInt(s) : undefined);

/** Estado de cuenta: documento que se genera en cada corte. El pago se hace desde el Cronograma de pagos. */
@Controller('estados-cuenta')
export class EstadosCuentaController {
  constructor(private readonly svc: EstadosCuentaService) {}

  /** Genera el estado de un cliente en un corte (la tarea diaria hace lo mismo automáticamente). */
  @Post('generar')
  @Roles('ADMIN_NEGOCIO')
  generar(@CurrentUser() u: UsuarioActual, @Body() dto: GenerarDto) {
    return this.svc.generar(u.tiendaId!, BigInt(dto.clienteId), dto.fechaCorte);
  }

  @Get()
  @Roles('ADMIN_NEGOCIO')
  listar(@CurrentUser() u: UsuarioActual, @Query('clienteId') clienteId?: string, @Query('estado') estado?: string) {
    return this.svc.listar(u.tiendaId!, {
      clienteId: idONada(clienteId),
      estado: estado === 'PENDIENTE' || estado === 'PAGADO' ? estado : undefined,
    });
  }

  @Get(':id')
  @Roles('ADMIN_NEGOCIO')
  obtener(@CurrentUser() u: UsuarioActual, @Param('id', ParseBigIntPipe) id: bigint) {
    return this.svc.obtener(u.tiendaId!, id);
  }

  /** Ejecuta a mano la tarea diaria (útil para demostración y pruebas). */
  @Post('tarea/ejecutar')
  @HttpCode(200)
  @Roles('ADMIN_SISTEMA')
  ejecutarTarea() {
    return this.svc.generarVencidos();
  }
}
