import { mkdirSync } from 'fs';
import { join } from 'path';

/** Carpeta raíz de archivos subidos (se sirve en /uploads). Configurable con UPLOADS_DIR. */
export const UPLOADS_DIR = process.env.UPLOADS_DIR ?? join(process.cwd(), 'uploads');
export const PRODUCTOS_DIR = join(UPLOADS_DIR, 'productos');
export const PRODUCTOS_URL = '/uploads/productos';

mkdirSync(PRODUCTOS_DIR, { recursive: true });

export const MIME_IMAGEN: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
};
export const MAX_IMAGEN_BYTES = 2 * 1024 * 1024;
