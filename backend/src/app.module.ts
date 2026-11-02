import './common/bigint';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from './auth/auth.module';
import { BitacoraModule } from './bitacora/bitacora.module';
import { ClientesModule } from './clientes/clientes.module';
import { PrismaModule } from './common/prisma.service';
import { ParametrosModule } from './parametros/parametros.module';
import { ProductosModule } from './productos/productos.module';
import { TiendasModule } from './tiendas/tiendas.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    BitacoraModule,
    AuthModule,
    ParametrosModule,
    TiendasModule,
    ProductosModule,
    ClientesModule,
  ],
})
export class AppModule {}
