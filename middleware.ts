import { NextRequest, NextResponse } from 'next/server';

const PUBLIC_PATHS = ['/login', '/api/screener-auth'];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Pass through auth routes and static assets
  if (PUBLIC_PATHS.some(p => pathname.startsWith(p)) ||
      pathname.startsWith('/_next') || pathname.startsWith('/favicon')) {
    return NextResponse.next();
  }

  const authCookie = req.cookies.get('screener_auth');
  if (authCookie?.value === process.env.SCREENER_PASSWORD) {
    return NextResponse.next();
  }

  const loginUrl = req.nextUrl.clone();
  loginUrl.pathname = '/login';
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
