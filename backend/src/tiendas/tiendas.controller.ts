import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { EstadoTienda } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsEnum, IsNotEmpty, IsOptional, IsString, Matches, MaxLength, MinLength, ValidateNested } from 'class-validator';
import { CurrentUser, Roles, UsuarioActual } from '../common/decorators';
import { ParseBigIntPipe } from '../common/parse-bigint.pipe';
import { TiendasService } from './tiendas.service';

class AdminNegocioDto {
  @IsString() @Matches(/^[A-Za-z0-9._-]{3,40}$/, { message: 'username: 3-40 caracteres (letras, números, . _ -)' })
  username: string;

  @IsString() @MinLength(8, { message: 'La clave debe tener al menos 8 caracteres' }) @MaxLength(100)
  password: string;

  @IsString() @IsNotEmpty() @MaxLength(150)
  nombre: string;
}

class CrearTiendaDto {
  @Matches(/^\d{11}$/, { message: 'El RUC tiene 11 dígitos' })
  ruc: string;

  @IsString() @IsNotEmpty() @MaxLength(150) razonSocial: string;
  @IsString() @IsNotEmpty() @MaxLength(100) nombreComercial: string;
  @IsString() @IsNotEmpty() @MaxLength(60) giroNegocio: string;
  @IsString() @IsNotEmpty() @MaxLength(200) direccion: string;

  @ValidateNested() @Type(() => AdminNegocioDto)
  admin: AdminNegocioDto;
}

class ActualizarMiTiendaDto {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(150) razonSocial?: string;
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(100) nombreComercial?: string;
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(60) giroNegocio?: string;
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(200) direccion?: string;
}

class ActualizarTiendaDto extends ActualizarMiTiendaDto {
  @IsOptional() @IsEnum(EstadoTienda) estado?: EstadoTienda;
}

@Controller('tiendas')
export class TiendasController {
  constructor(private readonly svc: TiendasService) {}

  // --- ADMIN_NEGOCIO: datos de su propia tienda (pantalla Parámetros). Va antes de :id. ---
  @Get('mi')
  @Roles('ADMIN_NEGOCIO')
  mi(@CurrentUser() u: UsuarioActual) {
    return this.svc.obtener(u.tiendaId!);
  }

  @Patch('mi')
  @Roles('ADMIN_NEGOCIO')
  actualizarMi(@CurrentUser() u: UsuarioActual, @Body() dto: ActualizarMiTiendaDto) {
    return this.svc.actualizar(u.tiendaId!, dto);
  }

  // --- ADMIN_SISTEMA: alta y baja de tiendas ---
  @Get()
  @Roles('ADMIN_SISTEMA')
  listar() {
    return this.svc.listar();
  }

  @Post()
  @Roles('ADMIN_SISTEMA')
  crear(@Body() dto: CrearTiendaDto) {
    return this.svc.crear(dto);
  }

  @Get(':id')
  @Roles('ADMIN_SISTEMA')
  obtener(@Param('id', ParseBigIntPipe) id: bigint) {
    return this.svc.obtener(id);
  }

  @Patch(':id')
  @Roles('ADMIN_SISTEMA')
  actualizar(@Param('id', ParseBigIntPipe) id: bigint, @Body() dto: ActualizarTiendaDto) {
    return this.svc.actualizar(id, dto);
  }

  @Delete(':id')
  @Roles('ADMIN_SISTEMA')
  baja(@Param('id', ParseBigIntPipe) id: bigint) {
    return this.svc.baja(id);
  }
}
