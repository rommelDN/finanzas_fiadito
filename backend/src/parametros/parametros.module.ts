import { Module } from '@nestjs/common';
import { ParametrosController } from './parametros.controller';
import { ParametrosService } from './parametros.service';

@Module({
  controllers: [ParametrosController],
  providers: [ParametrosService],
  exports: [ParametrosService],
})
export class ParametrosModule {}
