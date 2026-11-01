import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Rol } from '@prisma/client';
import { IS_PUBLIC, ROLES } from '../common/decorators';
import { AuthService } from './auth.service';

export const extraerToken = (req: any): string | null => {
  const h: string | undefined = req.headers?.authorization;
  return h?.startsWith('Bearer ') ? h.slice(7).trim() : null;
};

/** Toda ruta exige sesión válida salvo las marcadas con @Public(). */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly auth: AuthService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [ctx.getHandler(), ctx.getClass()])) return true;
    const req = ctx.switchToHttp().getRequest();
    const token = extraerToken(req);
    if (!token) throw new UnauthorizedException('Falta iniciar sesión');
    req.user = await this.auth.validarToken(token);
    return true;
  }
}

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const roles = this.reflector.getAllAndOverride<Rol[] | undefined>(ROLES, [ctx.getHandler(), ctx.getClass()]);
    if (!roles?.length) return true;
    const user = ctx.switchToHttp().getRequest().user;
    if (!user || !roles.includes(user.rol)) throw new ForbiddenException('No tienes permiso para esta operación');
    return true;
  }
}
