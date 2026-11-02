import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { EstadosCuentaService } from './estados-cuenta.service';

/** Tarea diaria: a las 00:05 (Lima) genera los estados de cuenta del corte del día anterior. */
@Injectable()
export class EstadosCuentaTarea {
  constructor(private readonly svc: EstadosCuentaService) {}

  @Cron('5 0 * * *', { timeZone: 'America/Lima' })
  generar() {
    return this.svc.generarVencidos();
  }
}
