import { INestApplication, ValidationPipe } from '@nestjs/common';

/** Configuración común de la app (la usan main.ts y los tests e2e). */
export function configurarApp(app: INestApplication) {
  app.setGlobalPrefix('api');
  app.enableCors();
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
}
