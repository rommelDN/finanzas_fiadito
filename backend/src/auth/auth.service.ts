import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
import { createHash, randomBytes } from 'crypto';
import { BitacoraService } from '../bitacora/bitacora.service';
import { UsuarioActual } from '../common/decorators';
import { PrismaService } from '../common/prisma.service';

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
// Hash falso para igualar el tiempo de respuesta cuando el usuario no existe.
const HASH_FALSO = bcrypt.hashSync('no-existe', 10);

@Injectable()
export class AuthService {
  private readonly horas: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly bitacora: BitacoraService,
    config: ConfigService,
  ) {
    this.horas = Number(config.get('SESSION_HOURS') ?? 8);
  }

  async login(username: string, password: string, ip?: string) {
    const u = await this.prisma.usuario.findUnique({ where: { username }});
    const ok = await bcrypt.compare(password, u?.passwordHash ?? HASH_FALSO);
    if (!u || !ok || u.estado !== 'ACTIVO') {
      await this.bitacora.registrar({
        usuarioId: u?.id,
        accion: 'LOGIN_FALLIDO',
        entidad: 'usuario',
        entidadId: u?.id,
        detalle: { username, motivo: u && ok ? 'usuario inactivo' : 'credenciales inválidas' },
        ip,
      });
      // Mismo mensaje para todos los casos: no revela si el usuario existe.
      throw new UnauthorizedException('Usuario o contraseña incorrectos');
    }

    const token = randomBytes(32).toString('hex');
    await this.prisma.sesion.deleteMany({ where: { expiraEn: { lt: new Date() } } });
    await this.prisma.sesion.create({
      data: { usuarioId: u.id, tokenHash: sha256(token), expiraEn: new Date(Date.now() + this.horas * 3600_000) },
    });
    await this.bitacora.registrar({ usuarioId: u.id, accion: 'LOGIN', entidad: 'usuario', entidadId: u.id, ip });

    return { token, usuario: this.aActual(u) };
  }

  async logout(token: string, usuarioId: bigint, ip?: string) {
    await this.prisma.sesion.deleteMany({ where: { tokenHash: sha256(token) } });
    await this.bitacora.registrar({ usuarioId, accion: 'LOGOUT', entidad: 'usuario', entidadId: usuarioId, ip });
  }

  /** Devuelve el usuario de un token válido, o lanza 401. */
  async validarToken(token: string): Promise<UsuarioActual> {
    const s = await this.prisma.sesion.findUnique({
      where: { tokenHash: sha256(token) },
      include: { usuario: true },
    });
    if (!s || s.expiraEn <= new Date() || s.usuario.estado !== 'ACTIVO') {
      throw new UnauthorizedException('Sesión inválida o vencida');
    }
    return this.aActual(s.usuario);
  }

  private aActual(
    u: { id: bigint; username: string; nombre: string; rol: UsuarioActual['rol']; tiendaId: bigint | null },
  ): UsuarioActual {
    return { id: u.id, username: u.username, nombre: u.nombre, rol: u.rol, tiendaId: u.tiendaId };
  }
}
