import { NextRequest, NextResponse } from 'next/server';
import { isAuthorizedScreenerRequest, isScreenerAuthConfigured } from '@/lib/screenerSession';

const PUBLIC_PATHS = ['/login', '/api/screener-auth', '/api/nightly-update', '/api/batch-screener', '/api/batch-results', '/api/label-uc-outcomes'];

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Pass through auth routes and static assets
  if (PUBLIC_PATHS.some(p => pathname === p || pathname.startsWith(`${p}/`)) ||
      pathname.startsWith('/_next') || pathname.startsWith('/favicon')) {
    return NextResponse.next();
  }

  if (isScreenerAuthConfigured() && await isAuthorizedScreenerRequest(req)) {
    return NextResponse.next();
  }

  const loginUrl = req.nextUrl.clone();
  loginUrl.pathname = '/login';
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
