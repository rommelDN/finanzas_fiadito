import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { MedioPago } from '@prisma/client';
import { IsEnum, IsInt, IsNumber, IsOptional, Matches, Max, Min } from 'class-validator';
import { CurrentUser, Roles, UsuarioActual } from '../common/decorators';
import { ParseBigIntPipe } from '../common/parse-bigint.pipe';
import { CronogramaService } from './cronograma.service';

class GraciaDto {
  @IsInt() @Min(0) @Max(90) diasGracia: number;
}

class PagarDto {
  /** Número de la cuota que se está pagando (debe ser la próxima pendiente). */
  @IsInt() @Min(1) @Max(36) numeroCuota: number;

  @IsEnum(MedioPago) medioPago: MedioPago;

  /** Debe ser exactamente el total a pagar mostrado (cuota + mora). */
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) @Max(100000)
  montoPagado: number;

  /** Días de mora. Si se omite se calculan con la fecha de pago. */
  @IsOptional() @IsInt() @Min(0) @Max(3650) diasMora?: number;

  /** Si se omite, hoy (hora de Lima). */
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'fechaPagoReal debe ser YYYY-MM-DD' }) fechaPagoReal?: string;
}

const entero = (s?: string) => (s !== undefined && s !== '' && /^\d{1,4}$/.test(s) ? Number(s) : undefined);

/** Cronograma de pagos de una compra (método francés): gracia, mora y pago de la próxima cuota. */
@Controller('cronograma')
@Roles('ADMIN_NEGOCIO')
export class CronogramaController {
  constructor(private readonly svc: CronogramaService) {}

  /** Cronograma; con ?diasGracia= distinto del guardado devuelve una vista previa sin guardar. */
  @Get(':compraId')
  obtener(@CurrentUser() u: UsuarioActual, @Param('compraId', ParseBigIntPipe) id: bigint, @Query('diasGracia') diasGracia?: string) {
    return this.svc.obtener(u.tiendaId!, id, entero(diasGracia));
  }

  @Patch(':compraId/gracia')
  gracia(@CurrentUser() u: UsuarioActual, @Param('compraId', ParseBigIntPipe) id: bigint, @Body() dto: GraciaDto) {
    return this.svc.cambiarGracia(u.tiendaId!, id, dto.diasGracia);
  }

  /** Cálculo del pago de la próxima cuota con los días de mora indicados. */
  @Get(':compraId/pago')
  pago(@CurrentUser() u: UsuarioActual, @Param('compraId', ParseBigIntPipe) id: bigint, @Query('diasMora') diasMora?: string) {
    return this.svc.previsualizarPago(u.tiendaId!, id, entero(diasMora));
  }

  @Post(':compraId/pagar')
  pagar(@CurrentUser() u: UsuarioActual, @Param('compraId', ParseBigIntPipe) id: bigint, @Body() dto: PagarDto) {
    return this.svc.pagar(u.tiendaId!, id, dto);
  }
}
