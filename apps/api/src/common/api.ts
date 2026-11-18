import {
  ArgumentsHost,
  CallHandler,
  Catch,
  ExceptionFilter,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, catchError, map, tap } from 'rxjs';
import { randomUUID } from 'node:crypto';
import type { Request, Response } from 'express';
import { PrismaService } from '../prisma/prisma.service';

export interface AuthUser {
  id: string;
  username: string;
  name: string;
  regionId: string | null;
  storeId: string | null;
  permissions: string[];
  roles: {
    code: string;
    name: string;
    dataScope: 'ALL' | 'REGION' | 'STORE';
  }[];
}

@Injectable()
export class ResponseInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<Request & { requestId?: string }>();
    request.requestId = request.headers['x-request-id']?.toString() || `req_${randomUUID()}`;
    return next.handle().pipe(
      tap(() => undefined),
      catchError((error: unknown) => {
        throw error;
      }),
      map((data: unknown) => ({
        code: 0,
        message: 'success',
        data,
        requestId: request.requestId,
      })),
    );
  }
}

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request & { requestId?: string }>();
    const status =
      exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const raw = exception instanceof HttpException ? exception.getResponse() : null;
    const body =
      typeof raw === 'string' ? { message: raw } : (raw as Record<string, unknown> | null);
    const rawMessage = body?.message;
    const message = Array.isArray(rawMessage)
      ? rawMessage.map(String).join('；')
      : typeof rawMessage === 'string'
        ? rawMessage
        : status === 500
          ? '服务器内部错误'
          : '请求失败';
    const code = typeof body?.code === 'string' ? body.code : `HTTP_${status}`;
    response.status(status).json({
      code,
      message,
      details: body?.details || [],
      requestId: request.requestId,
    });
  }
}

@Injectable()
export class OperationLogInterceptor implements NestInterceptor {
  constructor(private readonly prisma: PrismaService) {}
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    if (!['POST', 'PATCH', 'PUT', 'DELETE'].includes(req.method)) return next.handle();
    const started = Date.now();
    const write = (success: boolean, error?: string) =>
      this.prisma.operationLog
        .create({
          data: {
            userId: req.user?.id,
            module: req.path.split('/').filter(Boolean)[2] || 'system',
            action: `${req.method} ${req.path}`,
            method: req.method,
            path: req.originalUrl,
            ip: req.ip,
            success,
            error: error?.slice(0, 500),
          },
        })
        .catch(() => undefined);
    return next.handle().pipe(
      tap(() => void write(true)),
      catchError((error: unknown) => {
        void write(false, error instanceof Error ? error.message : 'unknown');
        throw error;
      }),
      tap(() => void started),
    );
  }
}

export function pagination(page = 1, pageSize = 20) {
  // 查询参数可能来自未使用DTO的旧列表；禁止小数/Infinity进入Prisma偏移量。
  const pageValue = Number(page),
    sizeValue = Number(pageSize);
  const safePage =
    Number.isSafeInteger(pageValue) && pageValue > 0 ? Math.min(1000000, pageValue) : 1;
  const safeSize = Number.isSafeInteger(sizeValue) && sizeValue > 0 ? Math.min(100, sizeValue) : 20;
  return {
    page: safePage,
    pageSize: safeSize,
    skip: (safePage - 1) * safeSize,
    take: safeSize,
  };
}
