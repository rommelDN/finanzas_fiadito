import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, tap } from 'rxjs';
import { SIN_BITACORA } from '../common/decorators';
import { BitacoraService } from './bitacora.service';

const ACCION: Record<string, string> = { POST: 'CREAR', PUT: 'ACTUALIZAR', PATCH: 'ACTUALIZAR', DELETE: 'ELIMINAR' };
const SENSIBLE = /pass|clave|token|secret/i;

const limpiar = (v: any, depth = 0): any => {
  if (v === null || typeof v !== 'object' || depth > 4) return v;
  if (Array.isArray(v)) return v.map((x) => limpiar(x, depth + 1));
  return Object.fromEntries(
    Object.entries(v).map(([k, val]) => [k, SENSIBLE.test(k) ? '***' : limpiar(val, depth + 1)]),
  );
};

const aBigInt = (x: unknown): bigint | null => {
  try {
    return x === undefined || x === null ? null : BigInt(x as any);
  } catch {
    return null;
  }
};

/** Registra en la bitácora toda operación que modifica datos y termina con éxito. */
@Injectable()
export class BitacoraInterceptor implements NestInterceptor {
  private readonly log = new Logger('Bitacora');
  constructor(
    private readonly reflector: Reflector,
    private readonly bitacora: BitacoraService,
  ) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = ctx.switchToHttp().getRequest();
    const accion = ACCION[req.method];
    if (!accion || this.reflector.getAllAndOverride<boolean>(SIN_BITACORA, [ctx.getHandler(), ctx.getClass()])) {
      return next.handle();
    }
    return next.handle().pipe(
      tap((respuesta: any) => {
        // Ruta tipo /api/clientes/5/algo → entidad "clientes".
        const entidad = String(req.originalUrl ?? req.url).split('?')[0].replace(/^\/api\//, '').split('/')[0] || 'sistema';
        this.bitacora
          .registrar({
            usuarioId: req.user?.id,
            accion,
            entidad,
            entidadId: aBigInt(respuesta?.id ?? req.params?.id),
            detalle: { ruta: `${req.method} ${String(req.originalUrl ?? req.url).split('?')[0]}`, cuerpo: limpiar(req.body) },
            ip: req.ip,
          })
          // La bitácora nunca debe tumbar una operación ya realizada, pero el fallo se deja en el log.
          .catch((e) => this.log.error(`No se pudo registrar bitácora: ${e.message}`));
      }),
    );
  }
}
