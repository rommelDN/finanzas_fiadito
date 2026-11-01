import { Body, Controller, Get, HttpCode, Post, Req } from '@nestjs/common';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { CurrentUser, Public, SinBitacora, UsuarioActual } from '../common/decorators';
import { extraerToken } from './auth.guard';
import { AuthService } from './auth.service';

class LoginDto {
  @IsString() @IsNotEmpty() @MaxLength(40)
  username: string;

  @IsString() @IsNotEmpty() @MaxLength(100)
  password: string;
}

@Controller('auth')
@SinBitacora() // AuthService registra LOGIN / LOGIN_FALLIDO / LOGOUT por su cuenta
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  login(@Body() dto: LoginDto, @Req() req: any) {
    return this.auth.login(dto.username, dto.password, req.ip);
  }

  @Post('logout')
  @HttpCode(204)
  async logout(@CurrentUser() u: UsuarioActual, @Req() req: any) {
    await this.auth.logout(extraerToken(req)!, u.id, req.ip);
  }

  @Get('me')
  me(@CurrentUser() u: UsuarioActual) {
    return u;
  }
}
