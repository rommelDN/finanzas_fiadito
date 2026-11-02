import { Module } from '@nestjs/common';
import { EstadosCuentaController } from './estados-cuenta.controller';
import { EstadosCuentaService } from './estados-cuenta.service';
import { EstadosCuentaTarea } from './estados-cuenta.tarea';

@Module({
  controllers: [EstadosCuentaController],
  providers: [EstadosCuentaService, EstadosCuentaTarea],
  exports: [EstadosCuentaService],
})
export class EstadosCuentaModule {}
