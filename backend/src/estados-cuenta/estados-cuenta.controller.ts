import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { MedioPago } from '@prisma/client';
import { IsEnum, IsNumber, IsOptional, Matches, Max, Min } from 'class-validator';
import { CurrentUser, Roles, SinBitacora, UsuarioActual } from '../common/decorators';
import { ParseBigIntPipe } from '../common/parse-bigint.pipe';
import { EstadosCuentaService } from './estados-cuenta.service';

class GenerarDto {
  @Matches(/^\d{1,18}$/, { message: 'clienteId inválido' }) clienteId: string;
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'fechaCorte debe ser YYYY-MM-DD' }) fechaCorte: string;
}

class PagarDto {
  /** Si se omite, hoy (hora de Lima). */
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'fechaPagoReal debe ser YYYY-MM-DD' })
  fechaPagoReal?: string;

  @IsEnum(MedioPago) medioPago: MedioPago;

  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) @Max(9999999999)
  montoPagado: number;
}

const idONada = (s?: string) => (s && /^\d{1,18}$/.test(s) ? BigInt(s) : undefined);

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
  @Roles('ADMIN_NEGOCIO', 'CLIENTE')
  listar(@CurrentUser() u: UsuarioActual, @Query('clienteId') clienteId?: string, @Query('estado') estado?: string) {
    return this.svc.listar(
      { tiendaId: u.tiendaId!, clienteId: u.clienteId },
      { clienteId: idONada(clienteId), estado: estado === 'PENDIENTE' || estado === 'PAGADO' ? estado : undefined },
    );
  }

  @Get(':id')
  @Roles('ADMIN_NEGOCIO', 'CLIENTE')
  obtener(@CurrentUser() u: UsuarioActual, @Param('id', ParseBigIntPipe) id: bigint) {
    return this.svc.obtener({ tiendaId: u.tiendaId!, clienteId: u.clienteId }, id);
  }

  /** Cálculo del pago a una fecha: días de mora, tasa, mora, total e imputación. */
  @Get(':id/calculo-pago')
  @Roles('ADMIN_NEGOCIO', 'CLIENTE')
  calculo(@CurrentUser() u: UsuarioActual, @Param('id', ParseBigIntPipe) id: bigint, @Query('fechaPagoReal') fecha?: string) {
    return this.svc.calculoPago({ tiendaId: u.tiendaId!, clienteId: u.clienteId }, id, fecha);
  }

  @Post(':id/pagos')
  @Roles('ADMIN_NEGOCIO')
  pagar(@CurrentUser() u: UsuarioActual, @Param('id', ParseBigIntPipe) id: bigint, @Body() dto: PagarDto) {
    return this.svc.pagar({ tiendaId: u.tiendaId! }, id, dto);
  }

  /** Ejecuta a mano la tarea diaria (útil para demostración y pruebas). */
  @Post('tarea/ejecutar')
  @HttpCode(200)
  @Roles('ADMIN_SISTEMA')
  ejecutarTarea() {
    return this.svc.generarVencidos();
  }
}
