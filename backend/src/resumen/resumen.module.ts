import { Module } from '@nestjs/common';
import { ResumenController } from './resumen.controller';
import { ResumenService } from './resumen.service';

@Module({ controllers: [ResumenController], providers: [ResumenService] })
export class ResumenModule {}
