import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { OmitType, PartialType } from '@nestjs/mapped-types';
import { EstadoActivo, Periodo } from '@prisma/client';
import {
  Equals,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { CurrentUser, Roles, SinBitacora, UsuarioActual } from '../common/decorators';
import { ParseBigIntPipe } from '../common/parse-bigint.pipe';
import { LIMITE_MAXIMO_CREDITO, MAX_CUOTAS } from '../parametros/parametros.service';
import { ClientesService } from './clientes.service';

class TasasDto {
  @IsNumber({ maxDecimalPlaces: 7 }) @Min(0.0000001) @Max(100000)
  tasaInteres: number;
  @IsEnum(Periodo) periodoTasa: Periodo;

  @IsNumber({ maxDecimalPlaces: 7 }) @Min(0) @Max(100000)
  tasaMora: number;
  @IsEnum(Periodo) periodoTasaMora: Periodo;
}

class CrearClienteDto extends TasasDto {
  @Matches(/^\d{8}$/, { message: 'El DNI tiene 8 dígitos' }) dni: string;
  @IsString() @IsNotEmpty() @MaxLength(80) nombres: string;
  @IsString() @IsNotEmpty() @MaxLength(80) apellidos: string;
  @IsOptional() @IsString() @MaxLength(150) direccion?: string;
  @IsOptional() @Matches(/^\+?[0-9 -]{6,15}$/, { message: 'Teléfono inválido' }) telefono?: string;

  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01, { message: 'El límite de crédito debe ser mayor a 0' })
  @Max(LIMITE_MAXIMO_CREDITO, { message: `El límite de crédito no puede superar S/ ${LIMITE_MAXIMO_CREDITO}` })
  limiteCredito: number;
  @IsInt() @Min(1) @Max(MAX_CUOTAS) maxCuotas: number;
  @IsInt() @Min(1) @Max(31) diaCorte: number;
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'horaCorte debe ser HH:mm' }) horaCorte: string;
  @IsInt() @Min(1) @Max(31) diaPago: number;

  @IsBoolean() @Equals(true, { message: 'El cliente debe aceptar la política de privacidad (Ley 29733)' })
  aceptaPrivacidad: boolean;
}

// El DNI no se cambia por esta vía.
class ActualizarClienteDto extends PartialType(OmitType(CrearClienteDto, ['dni'] as const)) {
  @IsOptional() @IsEnum(EstadoActivo) estado?: EstadoActivo;
}

@Controller('clientes')
@Roles('ADMIN_NEGOCIO')
export class ClientesController {
  constructor(private readonly svc: ClientesService) {}

  /** Panel "Lo que calcula la app": p, TEM, TEA y validación contra los topes (no guarda nada). */
  @Post('calcular')
  @HttpCode(200)
  @SinBitacora()
  calcular(@Body() dto: TasasDto) {
    return this.svc.previsualizar(dto);
  }

  @Get()
  listar(@CurrentUser() u: UsuarioActual, @Query('estado') estado?: string, @Query('q') q?: string) {
    return this.svc.listar(u.tiendaId!, { estado: Object.values(EstadoActivo).find((e) => e === estado), q });
  }

  @Get(':id')
  obtener(@CurrentUser() u: UsuarioActual, @Param('id', ParseBigIntPipe) id: bigint) {
    return this.svc.obtener(u.tiendaId!, id);
  }

  @Post()
  crear(@CurrentUser() u: UsuarioActual, @Body() dto: CrearClienteDto) {
    return this.svc.crear(u.tiendaId!, dto);
  }

  @Patch(':id')
  actualizar(@CurrentUser() u: UsuarioActual, @Param('id', ParseBigIntPipe) id: bigint, @Body() dto: ActualizarClienteDto) {
    return this.svc.actualizar(u.tiendaId!, id, dto);
  }

  @Delete(':id')
  baja(@CurrentUser() u: UsuarioActual, @Param('id', ParseBigIntPipe) id: bigint) {
    return this.svc.baja(u.tiendaId!, id);
  }
}
