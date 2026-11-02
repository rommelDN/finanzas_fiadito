import { INestApplication, ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { UPLOADS_DIR } from './productos/uploads';

/** Configuración común de la app (la usan main.ts y los tests e2e). */
export function configurarApp(app: INestApplication) {
  app.setGlobalPrefix('api');
  app.enableCors();
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  // Imágenes de productos: GET /uploads/productos/<archivo> (fuera del prefijo /api).
  (app as NestExpressApplication).useStaticAssets(UPLOADS_DIR, { prefix: '/uploads' });
}
