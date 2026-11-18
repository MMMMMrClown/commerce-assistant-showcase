import { NextResponse, type NextRequest } from 'next/server';

const publicPaths = new Set(['/login', '/help', '/status']);

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const hasSession = request.cookies.has('sunny_session');

  if (!hasSession && !publicPaths.has(pathname)) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  if (hasSession && pathname === '/login') {
    return NextResponse.redirect(new URL('/dashboard', request.url));
  }

  return NextResponse.next();
}

export const config = {
  // 放行静态资源（public 下的图片等），避免被登录校验重定向
  matcher: [
    '/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:jpg|jpeg|png|svg|webp|gif|ico|woff|woff2)$).*)',
  ],
};
