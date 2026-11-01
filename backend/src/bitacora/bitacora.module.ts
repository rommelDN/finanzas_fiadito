import { Global, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { BitacoraController } from './bitacora.controller';
import { BitacoraInterceptor } from './bitacora.interceptor';
import { BitacoraService } from './bitacora.service';

@Global()
@Module({
  controllers: [BitacoraController],
  providers: [BitacoraService, { provide: APP_INTERCEPTOR, useClass: BitacoraInterceptor }],
  exports: [BitacoraService],
})
export class BitacoraModule {}
