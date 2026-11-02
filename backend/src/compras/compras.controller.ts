import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { CurrentUser, Roles, SinBitacora, UsuarioActual } from '../common/decorators';
import { ParseBigIntPipe } from '../common/parse-bigint.pipe';
import { ComprasService, EntradaCompraDto } from './compras.service';

class ItemCompraDto {
  @IsString() @IsNotEmpty() @MaxLength(20)
  codigoProducto: string;

  @IsNumber({ maxDecimalPlaces: 3 }) @Min(0.001) @Max(9_999_999)
  cantidad: number;
}

class CompraDto {
  @Matches(/^\d{1,18}$/, { message: 'clienteId inválido' })
  clienteId: string;

  /** "YYYY-MM-DDTHH:mm" (hora de Lima). Si se omite, se usa el momento actual. */
  @IsOptional() @IsString() @MaxLength(16)
  fechaHora?: string;

  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(50) @ValidateNested({ each: true }) @Type(() => ItemCompraDto)
  items: ItemCompraDto[];

  @IsInt() @Min(1) @Max(36)
  nCuotas: number;
}

const aEntrada = (d: CompraDto): EntradaCompraDto => ({ ...d, clienteId: BigInt(d.clienteId) });

@Controller('compras')
export class ComprasController {
  constructor(private readonly svc: ComprasService) {}

  /** Cálculo en vivo (corte, gracia, TEA, cuotas, crédito disponible después). No guarda. */
  @Post('simular')
  @HttpCode(200)
  @SinBitacora()
  @Roles('ADMIN_NEGOCIO')
  simular(@CurrentUser() u: UsuarioActual, @Body() dto: CompraDto) {
    return this.svc.simular(u.tiendaId!, aEntrada(dto));
  }

  @Post()
  @Roles('ADMIN_NEGOCIO')
  registrar(@CurrentUser() u: UsuarioActual, @Body() dto: CompraDto) {
    return this.svc.registrar(u.tiendaId!, aEntrada(dto));
  }

  /** Límite, deuda y crédito disponible del cliente (?clienteId=). */
  @Get('credito')
  @Roles('ADMIN_NEGOCIO')
  credito(@CurrentUser() u: UsuarioActual, @Query('clienteId') clienteId?: string) {
    if (!clienteId || !/^\d{1,18}$/.test(clienteId)) throw new BadRequestException('Falta clienteId');
    return this.svc.credito(u.tiendaId!, BigInt(clienteId));
  }

  @Get()
  @Roles('ADMIN_NEGOCIO')
  listar(@CurrentUser() u: UsuarioActual, @Query('clienteId') clienteId?: string) {
    const filtro = clienteId && /^\d{1,18}$/.test(clienteId) ? BigInt(clienteId) : undefined;
    return this.svc.listar({ tiendaId: u.tiendaId! }, filtro);
  }

  @Get(':id')
  @Roles('ADMIN_NEGOCIO')
  obtener(@CurrentUser() u: UsuarioActual, @Param('id', ParseBigIntPipe) id: bigint) {
    return this.svc.obtener({ tiendaId: u.tiendaId! }, id);
  }
}
