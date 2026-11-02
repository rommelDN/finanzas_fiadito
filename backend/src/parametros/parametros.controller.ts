import { Body, Controller, Get, Put } from '@nestjs/common';
import { IsNumber, IsPositive, Matches, Max } from 'class-validator';
import { Roles } from '../common/decorators';
import { LIMITE_MAXIMO_CREDITO, MAX_CUOTAS, ParametrosService } from './parametros.service';

class FijarTopesDto {
  @IsNumber({ maxDecimalPlaces: 7 }) @IsPositive() @Max(1000)
  topeInteresTEA: number;

  @IsNumber({ maxDecimalPlaces: 7 }) @IsPositive() @Max(1000)
  topeMoraTEA: number;

  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'vigenteDesde debe ser YYYY-MM-DD' })
  vigenteDesde: string;
}

@Controller('parametros')
export class ParametrosController {
  constructor(private readonly svc: ParametrosService) {}

  @Get()
  @Roles('ADMIN_SISTEMA', 'ADMIN_NEGOCIO')
  async listar() {
    return {
      parametros: await this.svc.listar(),
      limites: { limiteMaximoCredito: LIMITE_MAXIMO_CREDITO, maxCuotas: MAX_CUOTAS },
    };
  }

  /** Topes de TEA vigentes hoy (los usa el formulario de clientes). */
  @Get('topes')
  @Roles('ADMIN_SISTEMA', 'ADMIN_NEGOCIO')
  topes() {
    return this.svc.topes();
  }

  @Put('topes')
  @Roles('ADMIN_SISTEMA')
  fijar(@Body() dto: FijarTopesDto) {
    return this.svc.fijarTopes(dto);
  }
}
