import { HttpException } from '@nestjs/common';
// 【安全任务日志】只记录定位信息与稳定错误码，不把异常原文、SQL或凭据写进日志。
export function backgroundFailure(task: string, phase: string, error: unknown, recordId?: string) {
  let code = 'UNEXPECTED_ERROR';
  if (error instanceof HttpException) {
    const body = error.getResponse();
    const candidate =
      typeof body === 'object' && body !== null
        ? (body as Record<string, unknown>).code
        : undefined;
    code =
      typeof candidate === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/.test(candidate)
        ? candidate
        : 'HTTP_' + error.getStatus();
  } else if (error && typeof error === 'object') {
    const candidate = (error as Record<string, unknown>).code;
    if (typeof candidate === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/.test(candidate)) code = candidate;
  }
  return { event: 'BACKGROUND_TASK_FAILURE', task, phase, ...(recordId ? { recordId } : {}), code };
}
