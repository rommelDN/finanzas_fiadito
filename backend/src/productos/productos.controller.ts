import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { PartialType } from '@nestjs/mapped-types';
import { EstadoActivo, UnidadMedida } from '@prisma/client';
import {
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
import { randomBytes } from 'crypto';
import { unlink } from 'fs/promises';
import { diskStorage } from 'multer';
import { join } from 'path';
import { CurrentUser, Roles, UsuarioActual } from '../common/decorators';
import { ParseBigIntPipe } from '../common/parse-bigint.pipe';
import { MAX_CUOTAS } from '../parametros/parametros.service';
import { ProductosService } from './productos.service';
import { MAX_IMAGEN_BYTES, MIME_IMAGEN, PRODUCTOS_DIR } from './uploads';

class CrearProductoDto {
  @Matches(/^[A-Za-z0-9._-]{1,20}$/, { message: 'codigo: hasta 20 caracteres (letras, números, . _ -)' })
  codigo: string;

  @IsString() @IsNotEmpty() @MaxLength(120) descripcion: string;
  @IsOptional() @IsString() @MaxLength(60) marca?: string;
  @IsOptional() @IsString() @MaxLength(100) proveedor?: string;
  @IsEnum(UnidadMedida) unidadMedida: UnidadMedida;

  /** Ruta subida (/uploads/...) o URL externa http(s). También se puede subir el archivo con POST :id/imagen. */
  @IsOptional() @IsString() @MaxLength(255)
  @Matches(/^(https?:\/\/\S+|\/uploads\/\S+)$/, { message: 'imagenUrl debe ser una URL http(s) o una ruta /uploads/...' })
  imagenUrl?: string;

  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) @Max(250)
  precioContado: number;

  /** Referencial: no entra en los cálculos. */
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(250)
  precioCredito?: number;

  @IsOptional() @IsBoolean() permiteCredito?: boolean;
  @IsOptional() @IsInt() @Min(1) @Max(MAX_CUOTAS) maxCuotasProducto?: number;
  @IsOptional() @IsEnum(EstadoActivo) estado?: EstadoActivo;
}

class ActualizarProductoDto extends PartialType(CrearProductoDto) {}

@Controller('productos')
export class ProductosController {
  constructor(private readonly svc: ProductosService) {}

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
  crear(@CurrentUser() u: UsuarioActual, @Body() dto: CrearProductoDto) {
    return this.svc.crear(u.tiendaId!, dto);
  }

  @Patch(':id')
  @Roles('ADMIN_NEGOCIO')
  actualizar(@CurrentUser() u: UsuarioActual, @Param('id', ParseBigIntPipe) id: bigint, @Body() dto: ActualizarProductoDto) {
    return this.svc.actualizar(u.tiendaId!, id, dto);
  }

  @Delete(':id')
  @Roles('ADMIN_NEGOCIO')
  baja(@CurrentUser() u: UsuarioActual, @Param('id', ParseBigIntPipe) id: bigint) {
    return this.svc.baja(u.tiendaId!, id);
  }

  /** Sube la imagen (campo multipart "imagen": JPG, PNG o WEBP, máx. 2 MB). */
  @Post(':id/imagen')
  @Roles('ADMIN_NEGOCIO')
  @UseInterceptors(
    FileInterceptor('imagen', {
      limits: { fileSize: MAX_IMAGEN_BYTES },
      storage: diskStorage({
        destination: PRODUCTOS_DIR,
        filename: (_req, file, cb) => cb(null, `${randomBytes(12).toString('hex')}${MIME_IMAGEN[file.mimetype] ?? ''}`),
      }),
      fileFilter: (_req, file, cb) =>
        MIME_IMAGEN[file.mimetype]
          ? cb(null, true)
          : cb(new BadRequestException('La imagen debe ser JPG, PNG o WEBP'), false),
    }),
  )
  async subirImagen(
    @CurrentUser() u: UsuarioActual,
    @Param('id', ParseBigIntPipe) id: bigint,
    @UploadedFile() archivo?: Express.Multer.File,
  ) {
    if (!archivo) throw new BadRequestException('Falta el archivo en el campo "imagen"');
    try {
      return await this.svc.asignarImagen(u.tiendaId!, id, archivo.filename);
    } catch (e) {
      await unlink(join(PRODUCTOS_DIR, archivo.filename)).catch(() => undefined);
      throw e;
    }
  }
}
