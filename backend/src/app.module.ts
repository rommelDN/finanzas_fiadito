import './common/bigint';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { AuthModule } from './auth/auth.module';
import { BitacoraModule } from './bitacora/bitacora.module';
import { ClientesModule } from './clientes/clientes.module';
import { ComprasModule } from './compras/compras.module';
import { EstadosCuentaModule } from './estados-cuenta/estados-cuenta.module';
import { PrismaModule } from './common/prisma.service';
import { ParametrosModule } from './parametros/parametros.module';
import { ProductosModule } from './productos/productos.module';
import { TiendasModule } from './tiendas/tiendas.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    PrismaModule,
    BitacoraModule,
    AuthModule,
    ParametrosModule,
    TiendasModule,
    ProductosModule,
    ClientesModule,
    ComprasModule,
    EstadosCuentaModule,
  ],
})
export class AppModule {}
