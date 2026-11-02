import { Body, Controller, Get, Put, Query } from '@nestjs/common';
import { Moneda } from '@prisma/client';
import { IsEnum, IsNumber, IsOptional, IsPositive, Matches, Max } from 'class-validator';
import { Roles } from '../common/decorators';
import { ParametrosService } from './parametros.service';

class FijarTopesDto {
  @IsEnum(Moneda) moneda: Moneda;

  @IsNumber({ maxDecimalPlaces: 7 }) @IsPositive() @Max(1000)
  topeInteresTEA: number;

  @IsOptional() @IsNumber({ maxDecimalPlaces: 7 }) @IsPositive() @Max(1000)
  topeMoraTEA?: number;

  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'vigenteDesde debe ser YYYY-MM-DD' })
  vigenteDesde: string;
}

@Controller('parametros')
export class ParametrosController {
  constructor(private readonly svc: ParametrosService) {}

  @Get()
  @Roles('ADMIN_SISTEMA', 'ADMIN_NEGOCIO')
  listar(@Query('moneda') moneda?: Moneda) {
    return this.svc.listar(moneda && Object.values(Moneda).includes(moneda) ? moneda : undefined);
  }

  /** Topes BCRP vigentes hoy (los usa el formulario de clientes). */
  @Get('topes')
  @Roles('ADMIN_SISTEMA', 'ADMIN_NEGOCIO')
  async topes() {
    const [PEN, USD] = await Promise.all([this.svc.topes('PEN'), this.svc.topes('USD')]);
    return { PEN, USD };
  }

  @Put('topes')
  @Roles('ADMIN_SISTEMA')
  fijar(@Body() dto: FijarTopesDto) {
    return this.svc.fijarTopes(dto);
  }
}
