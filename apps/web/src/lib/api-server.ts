import 'server-only';
import { cookies } from 'next/headers';
import type { AuthUser } from '@/store/store';

type ApiEnvelope<T> = { data: T; message?: string };
const API_BASE_URL = process.env.API_BASE_URL ?? 'http://localhost:3200/api/v1';

export class ServerApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'ServerApiError';
  }
}

export async function serverApiFetch<T>(
  path: string,
  init: RequestInit & { next?: { revalidate?: number } } = {},
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, init);
  } catch {
    throw new ServerApiError('业务服务暂时不可用');
  }

  if (!response.ok) {
    let message = `请求失败（${response.status}）`;
    try {
      const body = (await response.json()) as { message?: string };
      if (body.message) message = body.message;
    } catch {
      // Non-JSON error responses use the status-based message above.
    }
    throw new ServerApiError(message, response.status);
  }

  try {
    const body = (await response.json()) as ApiEnvelope<T>;
    return body.data;
  } catch {
    throw new ServerApiError('业务服务返回了无效数据', response.status);
  }
}

export async function getSessionCookieHeader(): Promise<string | null> {
  const cookieStore = await cookies();
  const session = cookieStore.get('sunny_session');
  if (!session) return null;
  // 【独立演示】SSR请求必须携带演示凭据，网关才能路由至当前访客的数据副本。
  const demo = cookieStore.get('commerce_demo');
  return `${session.name}=${session.value}${demo ? `; ${demo.name}=${demo.value}` : ''}`;
}

export async function authenticatedServerFetch<T>(path: string): Promise<T> {
  const cookie = await getSessionCookieHeader();
  if (!cookie) throw new ServerApiError('登录会话不存在', 401);
  return serverApiFetch<T>(path, { headers: { cookie }, cache: 'no-store' });
}

export async function loadAuthenticatedUser(): Promise<AuthUser | null> {
  try {
    return await authenticatedServerFetch<AuthUser>('/auth/me');
  } catch {
    return null;
  }
}
