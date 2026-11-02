import { Body, Controller, Delete, ForbiddenException, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { PartialType, OmitType } from '@nestjs/mapped-types';
import { Type } from 'class-transformer';
import { EstadoActivo, Moneda, Periodo } from '@prisma/client';
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
  MinLength,
  ValidateNested,
} from 'class-validator';
import { CurrentUser, Roles, SinBitacora, UsuarioActual } from '../common/decorators';
import { ParseBigIntPipe } from '../common/parse-bigint.pipe';
import { ClientesService } from './clientes.service';

class TasasDto {
  @IsEnum(Moneda) moneda: Moneda;

  @IsNumber({ maxDecimalPlaces: 7 }) @Min(0.0000001) @Max(100000)
  tasaInteres: number;
  @IsEnum(Periodo) periodoTasa: Periodo;

  @IsNumber({ maxDecimalPlaces: 7 }) @Min(0) @Max(100000)
  tasaMora: number;
  @IsEnum(Periodo) periodoTasaMora: Periodo;
}

class CuentaDto {
  @IsString() @Matches(/^[A-Za-z0-9._-]{3,40}$/, { message: 'username: 3-40 caracteres (letras, números, . _ -)' })
  username: string;

  @IsString() @MinLength(8, { message: 'La clave debe tener al menos 8 caracteres' }) @MaxLength(100)
  password: string;
}

class CrearClienteDto extends TasasDto {
  @Matches(/^\d{8}$/, { message: 'El DNI tiene 8 dígitos' }) dni: string;
  @IsString() @IsNotEmpty() @MaxLength(80) nombres: string;
  @IsString() @IsNotEmpty() @MaxLength(80) apellidos: string;
  @IsOptional() @IsString() @MaxLength(150) direccion?: string;
  @IsOptional() @Matches(/^\+?[0-9 -]{6,15}$/, { message: 'Teléfono inválido' }) telefono?: string;

  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) @Max(9999999999) limiteCredito: number;
  @IsInt() @Min(1) @Max(36) maxCuotas: number;
  @IsInt() @Min(1) @Max(31) diaCorte: number;
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'horaCorte debe ser HH:mm' }) horaCorte: string;
  @IsInt() @Min(1) @Max(31) diaPago: number;

  @IsBoolean() @Equals(true, { message: 'El cliente debe aceptar la política de privacidad (Ley 29733)' })
  aceptaPrivacidad: boolean;

  /** Opcional: crea la cuenta de acceso (rol CLIENTE) para que el cliente consulte su estado. */
  @IsOptional() @ValidateNested() @Type(() => CuentaDto)
  cuenta?: CuentaDto;
}

// El DNI y la cuenta no se cambian por esta vía.
class ActualizarClienteDto extends PartialType(OmitType(CrearClienteDto, ['dni', 'cuenta'] as const)) {
  @IsOptional() @IsEnum(EstadoActivo) estado?: EstadoActivo;
}

@Controller('clientes')
export class ClientesController {
  constructor(private readonly svc: ClientesService) {}

  /** El propio cliente consulta sus datos. Va antes de :id. */
  @Get('mi')
  @Roles('CLIENTE')
  mi(@CurrentUser() u: UsuarioActual) {
    if (!u.clienteId) throw new ForbiddenException('La cuenta no está vinculada a un cliente');
    return this.svc.propio(u.tiendaId!, u.clienteId);
  }

  /** Panel "Lo que calcula la app": p, TEM, TEA y validación contra los topes BCRP (no guarda nada). */
  @Post('calcular')
  @HttpCode(200)
  @SinBitacora()
  @Roles('ADMIN_NEGOCIO')
  calcular(@Body() dto: TasasDto) {
    return this.svc.previsualizar(dto);
  }

  @Get()
  @Roles('ADMIN_NEGOCIO')
  listar(@CurrentUser() u: UsuarioActual, @Query('estado') estado?: string, @Query('q') q?: string) {
    return this.svc.listar(u.tiendaId!, { estado: Object.values(EstadoActivo).find((e) => e === estado), q });
  }

  @Get(':id')
  @Roles('ADMIN_NEGOCIO')
  obtener(@CurrentUser() u: UsuarioActual, @Param('id', ParseBigIntPipe) id: bigint) {
    return this.svc.obtener(u.tiendaId!, id);
  }

  @Post()
  @Roles('ADMIN_NEGOCIO')
  crear(@CurrentUser() u: UsuarioActual, @Body() dto: CrearClienteDto) {
    return this.svc.crear(u.tiendaId!, dto);
  }

  @Patch(':id')
  @Roles('ADMIN_NEGOCIO')
  actualizar(@CurrentUser() u: UsuarioActual, @Param('id', ParseBigIntPipe) id: bigint, @Body() dto: ActualizarClienteDto) {
    return this.svc.actualizar(u.tiendaId!, id, dto);
  }

  @Delete(':id')
  @Roles('ADMIN_NEGOCIO')
  baja(@CurrentUser() u: UsuarioActual, @Param('id', ParseBigIntPipe) id: bigint) {
    return this.svc.baja(u.tiendaId!, id);
  }
}
