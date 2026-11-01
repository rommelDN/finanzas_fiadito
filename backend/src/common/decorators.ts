import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import { Rol } from '@prisma/client';

/** Ruta sin login (solo /auth/login). */
export const IS_PUBLIC = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** Roles autorizados; sin este decorador basta con estar autenticado. */
export const ROLES = 'roles';
export const Roles = (...roles: Rol[]) => SetMetadata(ROLES, roles);

/** El endpoint registra su propia bitácora; el interceptor general lo omite. */
export const SIN_BITACORA = 'sinBitacora';
export const SinBitacora = () => SetMetadata(SIN_BITACORA, true);

export interface UsuarioActual {
  id: bigint;
  username: string;
  nombre: string;
  rol: Rol;
  /** null para ADMIN_SISTEMA. */
  tiendaId: bigint | null;
  /** Solo para rol CLIENTE. */
  clienteId: bigint | null;
}

export const CurrentUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): UsuarioActual => ctx.switchToHttp().getRequest().user,
);

/**
 * Aislamiento multi-tienda: devuelve el filtro `tiendaId` que debe aplicar toda consulta.
 * ADMIN_SISTEMA no tiene tienda propia (ve todas), así que no se filtra.
 */
export const filtroTienda = (u: UsuarioActual): { tiendaId?: bigint } =>
  u.rol === 'ADMIN_SISTEMA' ? {} : { tiendaId: u.tiendaId! };
