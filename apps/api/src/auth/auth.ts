import {
  Body,
  CanActivate,
  Controller,
  createParamDecorator,
  ExecutionContext,
  ForbiddenException,
  Get,
  Injectable,
  Module,
  Post,
  Res,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Reflector } from '@nestjs/core';
import { IsString, MinLength } from 'class-validator';
import { compare, hash } from 'bcryptjs';
import type { Request, Response } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthUser } from '../common/api';
import { getClearCookieOptions, getCookieName, getSessionCookieOptions } from './auth.constants';

export class LoginDto {
  @IsString() username!: string;
  @IsString() @MinLength(6) password!: string;
}
export class ChangePasswordDto {
  @IsString() oldPassword!: string;
  @IsString() @MinLength(8) newPassword!: string;
}

export const Public = () => SetMetadata('public', true);
export const RequirePermissions = (...permissions: string[]) =>
  SetMetadata('permissions', permissions);
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext) =>
    ctx.switchToHttp().getRequest<Request & { user: AuthUser }>().user,
);

export function extractJwtToken(
  request: Pick<Request, 'headers' | 'cookies'>,
  cookieName = 'sunny_session',
): string | null {
  const bearer = request.headers.authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (bearer) return bearer;

  const cookies: unknown = request.cookies;
  if (!cookies || typeof cookies !== 'object') return null;
  const cookieToken = (cookies as Record<string, unknown>)[cookieName];
  return typeof cookieToken === 'string' && cookieToken.length > 0 ? cookieToken : null;
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}
  async canActivate(context: ExecutionContext) {
    if (
      this.reflector.getAllAndOverride<boolean>('public', [
        context.getHandler(),
        context.getClass(),
      ])
    )
      return true;
    const req = context.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    const token = extractJwtToken(req, getCookieName(this.config));
    if (!token) throw new UnauthorizedException('请先登录');
    try {
      const payload = await this.jwt.verifyAsync<{ sub: string }>(token);
      const user = await this.prisma.user.findUnique({
        where: { id: payload.sub },
        include: {
          roles: {
            include: {
              role: {
                include: { permissions: { include: { permission: true } } },
              },
            },
          },
        },
      });
      if (!user?.enabled) throw new UnauthorizedException('账号已停用');
      req.user = {
        id: user.id,
        username: user.username,
        name: user.name,
        regionId: user.regionId,
        storeId: user.storeId,
        roles: user.roles.map(({ role }) => ({
          code: role.code,
          name: role.name,
          dataScope: role.dataScope,
        })),
        permissions: [
          ...new Set(
            user.roles.flatMap(({ role }) =>
              role.permissions.map(({ permission }) => permission.code),
            ),
          ),
        ],
      };
      return true;
    } catch (error) {
      if (error instanceof UnauthorizedException) throw error;
      throw new UnauthorizedException('登录状态已失效');
    }
  }
}

@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}
  canActivate(context: ExecutionContext) {
    const required =
      this.reflector.getAllAndOverride<string[]>('permissions', [
        context.getHandler(),
        context.getClass(),
      ]) || [];
    if (!required.length) return true;
    const user = context.switchToHttp().getRequest<Request & { user: AuthUser }>().user;
    if (!required.every((code) => user.permissions.includes(code)))
      throw new ForbiddenException('没有执行此操作的权限');
    return true;
  }
}

@Injectable()
export class DataScopeService {
  storeWhere(user: AuthUser): Record<string, unknown> {
    if (user.roles.some((role) => role.dataScope === 'ALL')) return {};
    // 绑定资料不授予范围；按每个角色的范围取并集，缺失绑定时不向上扩大。
    const scopes: Record<string, unknown>[] = [];
    if (user.regionId && user.roles.some((role) => role.dataScope === 'REGION'))
      scopes.push({ regionId: user.regionId });
    if (user.storeId && user.roles.some((role) => role.dataScope === 'STORE'))
      scopes.push({ id: user.storeId });
    if (scopes.length === 1) return scopes[0];
    return scopes.length ? { OR: scopes } : { id: { in: [] } };
  }
  orderWhere(user: AuthUser): Record<string, unknown> {
    const store = this.storeWhere(user);
    return Object.keys(store).length ? { store } : {};
  }
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}
  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({
      where: { username: dto.username },
    });
    if (!user?.enabled || !(await compare(dto.password, user.passwordHash)))
      throw new UnauthorizedException('用户名或密码错误');
    return {
      accessToken: await this.jwt.signAsync({
        sub: user.id,
        username: user.username,
      }),
    };
  }
  async changePassword(user: AuthUser, dto: ChangePasswordDto) {
    const entity = await this.prisma.user.findUniqueOrThrow({
      where: { id: user.id },
    });
    if (!(await compare(dto.oldPassword, entity.passwordHash)))
      throw new ForbiddenException('原密码不正确');
    await this.prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await hash(dto.newPassword, 10) },
    });
    return { changed: true };
  }
}

@Controller('auth')
export class AuthController {
  constructor(
    private readonly service: AuthService,
    private readonly config: ConfigService,
  ) {}
  @Public()
  @Post('login')
  async login(@Body() dto: LoginDto, @Res({ passthrough: true }) response: Response) {
    const result = await this.service.login(dto);
    response.cookie(
      getCookieName(this.config),
      result.accessToken,
      getSessionCookieOptions(this.config),
    );
    return result;
  }
  @Public()
  @Post('logout')
  logout(@Res({ passthrough: true }) response: Response) {
    response.clearCookie(getCookieName(this.config), getClearCookieOptions(this.config));
    return { loggedOut: true };
  }
  @Get('me') me(@CurrentUser() user: AuthUser) {
    // 获取当前用户信息，nestjs框架注册的全局守卫会拿到用户信息放在req.user
    return user; //再通过@CurrentUser()获取到用户信息，返回到user
  }
  @Post('change-password') changePassword(
    @CurrentUser() user: AuthUser,
    @Body() dto: ChangePasswordDto,
  ) {
    return this.service.changePassword(user, dto);
  }
}

@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_SECRET'),
        signOptions: { expiresIn: config.get('JWT_EXPIRES_IN', '8h') },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtAuthGuard, PermissionGuard, DataScopeService],
  exports: [JwtAuthGuard, PermissionGuard, DataScopeService],
})
export class AuthModule {}
