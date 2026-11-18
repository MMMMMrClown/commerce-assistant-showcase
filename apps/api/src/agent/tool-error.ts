import { HttpException } from '@nestjs/common';
import { z } from 'zod';
// 【业务错误】只保留预期的业务拒绝原因，未知异常不暴露连接串、堆栈或密钥。
export function toolError(error: unknown) {
  if (error instanceof z.ZodError)
    return {
      ok: false,
      code: 'INVALID_ARGUMENT',
      message:
        '参数需要调整：' + error.issues.map((i) => i.path.join('.') || '输入字段').join('、'),
      retryable: false,
    };
  const status = error instanceof HttpException ? error.getStatus() : 500;
  let code =
    (
      { 400: 'INVALID_ARGUMENT', 403: 'FORBIDDEN', 404: 'NOT_FOUND', 409: 'CONFLICT' } as Record<
        number,
        string
      >
    )[status] || 'BUSINESS_UNAVAILABLE';
  const response = error instanceof HttpException ? error.getResponse() : undefined;
  const body =
    typeof response === 'object' && response
      ? (response as { code?: unknown; details?: unknown })
      : undefined;
  if (status < 500 && typeof body?.code === 'string' && /^[A-Z][A-Z0-9_]{1,79}$/.test(body.code))
    code = body.code;
  const allowed = new Set([
    'SELECT_PRODUCT',
    'REQUOTE',
    'INITIALIZE_STOCK',
    'RELOAD_STOCK',
    'CHECK_STOCK_MOVEMENTS',
    'RESTORE_PRODUCT',
    'REOPEN_STOCK_EDITOR',
    'SELECT_COUPON',
    'RELOAD_COUPONS',
  ]);
  const nextActions =
    status < 500 && Array.isArray(body?.details)
      ? [
          ...new Set(
            body.details.flatMap((d: unknown) => {
              const action =
                d && typeof d === 'object' ? (d as { nextAction?: unknown }).nextAction : undefined;
              return typeof action === 'string' && allowed.has(action) ? [action] : [];
            }),
          ),
        ]
      : [];
  const value =
    typeof response === 'string'
      ? response
      : (response as { message?: string | string[] } | undefined)?.message;
  const raw = Array.isArray(value) ? value.join('；') : value;
  const safe =
    typeof raw === 'string'
      ? raw
          .replace(/\b\d{11}\b/g, '[手机号已脱敏]')
          .replace(/(?:postgres(?:ql)?:\/\/|sk-)[^\s]+/gi, '[敏感信息已隐藏]')
          .slice(0, 300)
      : undefined;
  return {
    ok: false,
    code,
    message:
      status >= 500
        ? '业务服务暂不可用，请稍后重试'
        : safe || '当前业务条件不允许此操作，请调整条件',
    retryable: status >= 500,
    ...(nextActions.length ? { nextActions } : {}),
  };
}
